import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';

const cleanups: Array<() => void> = [];
const gitPath = process.env.GAM_GIT_PATH || 'git';

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(gitPath, args, { cwd, encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(root: string, message: string, text: string): string {
  writeFileSync(join(root, 'work.txt'), text);
  git(root, 'add', 'work.txt');
  git(root, 'commit', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}
function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'gam-cr-'));
  const repo = join(dir, 'repo');
  const db = join(dir, 'state.db');
  const init = spawnSync(gitPath, ['init', '-b', 'main', repo], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (init.status !== 0) throw new Error(init.stderr);
  git(repo, 'config', 'user.name', 'GAM Test');
  git(repo, 'config', 'user.email', 'gam-test@example.invalid');
  const baseSha = commit(repo, 'base', 'base\n');
  git(repo, 'switch', '-c', 'gam/test/T1/A1');
  const headSha = commit(repo, 'head-1', 'head one\n');
  const database = new ControlDatabase(db);
  const plane = new ControlPlane(database, gitPath);
  const project = plane.createProject({ name: 'P', rootPath: repo });
  const resource = plane.declareResource({ projectId: project.id, kind: 'workspace', label: 'T1' });
  const lease = plane.acquireLease({ resourceId: resource.id, projectId: project.id, holderId: 'worker', taskId: 'T1', mode: 'exclusive', ttlMs: 60_000 });
  cleanups.push(() => { database.close(); rmSync(dir, { recursive: true, force: true }); });
  return { repo, plane, project, resource, lease, baseSha, headSha };
}

afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });
function verifiedClaim(h: ReturnType<typeof harness>, headSha = h.headSha) {
  const claim = h.plane.evidence.submitClaim({
    projectId: h.project.id, taskId: 'T1', subject: 'worker', resourceId: h.resource.id,
    leaseEpoch: h.lease.epoch, summary: 'ready for review', commitSha: headSha,
  });
  expect(h.plane.evidence.verifyClaim(claim.id).status).toBe('passed');
  return h.plane.evidence.getClaim(claim.id);
}

describe('Change Request workflow', () => {
  it('requires evidence-valid commit and prevents self review', () => {
    const h = harness();
    const claim = verifiedClaim(h);
    const cr = h.plane.changes.open({
      projectId: h.project.id, taskId: 'T1', subject: 'worker', branch: 'gam/test/T1/A1', targetBranch: 'main',
      baseSha: h.baseSha, headSha: h.headSha, claimId: claim.id,
    });
    expect(cr.status).toBe('open');
    expect(() => h.plane.changes.review({
      changeRequestId: cr.id, reviewerSubject: 'worker', headSha: cr.headSha,
      verdict: 'approve', body: 'self approve',
    })).toThrow(/own work/i);
  }, 30_000);
  it('invalidates old approval after a new head and requires current approval before queueing', () => {
    const h = harness();
    const firstClaim = verifiedClaim(h);
    const cr = h.plane.changes.open({
      projectId: h.project.id, taskId: 'T1', subject: 'worker', branch: 'gam/test/T1/A1', targetBranch: 'main',
      baseSha: h.baseSha, headSha: h.headSha, claimId: firstClaim.id,
    });
    const changes = h.plane.changes.review({
      changeRequestId: cr.id, reviewerSubject: 'supervisor', headSha: cr.headSha,
      verdict: 'request-changes', body: 'add the missing failure test',
    });
    expect(changes.verdict).toBe('request-changes');
    const head2 = commit(h.repo, 'head-2', 'head two\n');
    const secondClaim = verifiedClaim(h, head2);
    const revised = h.plane.changes.update({ changeRequestId: cr.id, subject: 'worker', headSha: head2, claimId: secondClaim.id });
    expect(revised.revision).toBe(2);
    expect(revised.status).toBe('open');
    expect(() => h.plane.changes.queue(cr.id)).toThrow(/not approved/i);
    expect(() => h.plane.changes.review({
      changeRequestId: cr.id, reviewerSubject: 'supervisor', headSha: h.headSha,
      verdict: 'approve', body: 'stale review',
    })).toThrow(/stale/i);
  }, 30_000);
  it('queues only the current approved head with valid machine evidence', () => {
    const h = harness();
    const claim = verifiedClaim(h);
    const cr = h.plane.changes.open({
      projectId: h.project.id, taskId: 'T1', subject: 'worker', branch: 'gam/test/T1/A1', targetBranch: 'main',
      baseSha: h.baseSha, headSha: h.headSha, claimId: claim.id,
    });
    const review = h.plane.changes.review({
      changeRequestId: cr.id, reviewerSubject: 'supervisor', headSha: cr.headSha,
      verdict: 'approve', body: 'architecture and tests look good',
    });
    expect(review.verdict).toBe('approve');
    const queued = h.plane.changes.queue(cr.id);
    expect(queued.status).toBe('queued');
    expect(queued.headSha).toBe(h.headSha);
    expect(h.plane.changes.getChangeRequest(cr.id).status).toBe('queued');
    expect(() => h.plane.changes.review({
      changeRequestId: cr.id, reviewerSubject: 'other', headSha: cr.headSha,
      verdict: 'approve', body: 'late review',
    })).toThrow(/not reviewable/i);
  }, 30_000);
  it('prepares a merge candidate against the latest target branch and observes real integration', () => {
    const h = harness();
    const claim = verifiedClaim(h);
    const cr = h.plane.changes.open({ projectId: h.project.id, taskId: 'T1', subject: 'worker', branch: 'gam/test/T1/A1', targetBranch: 'main', baseSha: h.baseSha, headSha: h.headSha, claimId: claim.id });
    h.plane.changes.review({ changeRequestId: cr.id, reviewerSubject: 'supervisor', headSha: cr.headSha, verdict: 'approve', body: 'ready' });
    const queued = h.plane.changes.queue(cr.id);
    git(h.repo, 'switch', 'main');
    writeFileSync(join(h.repo, 'main-only.txt'), 'advanced main\n');
    git(h.repo, 'add', 'main-only.txt'); git(h.repo, 'commit', '-m', 'advance main');
    const latestMain = git(h.repo, 'rev-parse', 'main');
    const candidate = h.plane.changes.prepareMergeCandidate(queued.id);
    expect(candidate.status).toBe('validating');
    expect(candidate.candidateBaseSha).toBe(latestMain);
    expect(candidate.candidateSha).toBeTruthy();
    expect(() => h.plane.changes.observeIntegration(queued.id)).toThrow(/does not yet contain/i);
    git(h.repo, 'update-ref', 'refs/heads/main', candidate.candidateSha!);
    const integrated = h.plane.changes.observeIntegration(queued.id);
    expect(integrated.status).toBe('integrated');
    expect(h.plane.changes.getChangeRequest(cr.id).status).toBe('integrated');
  }, 25_000);

  it('fails the merge candidate and requests changes when latest target conflicts', () => {
    const h = harness();
    const claim = verifiedClaim(h);
    const cr = h.plane.changes.open({ projectId: h.project.id, taskId: 'T1', subject: 'worker', branch: 'gam/test/T1/A1', targetBranch: 'main', baseSha: h.baseSha, headSha: h.headSha, claimId: claim.id });
    h.plane.changes.review({ changeRequestId: cr.id, reviewerSubject: 'supervisor', headSha: cr.headSha, verdict: 'approve', body: 'ready' });
    const queued = h.plane.changes.queue(cr.id);
    git(h.repo, 'switch', 'main');
    writeFileSync(join(h.repo, 'work.txt'), 'conflicting main edit\n');
    git(h.repo, 'add', 'work.txt'); git(h.repo, 'commit', '-m', 'conflict on main');
    const failed = h.plane.changes.prepareMergeCandidate(queued.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBeTruthy();
    expect(h.plane.changes.getChangeRequest(cr.id).status).toBe('changes-requested');
  }, 25_000);});
