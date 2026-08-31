import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';

interface Harness {
  dir: string;
  projectRoot: string;
  databasePath: string;
  database: ControlDatabase;
  plane: ControlPlane;
  projectId: string;
  claimId: string;
  baseSha: string;
  candidateSha: string;
}

const cleanups: Array<() => void> = [];
const GIT_TEST_TIMEOUT = 20_000;
function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, shell: false });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'git failed').trim());
  return result.stdout.trim();
}

function harness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'gam-promotion-'));
  const projectRoot = join(dir, 'repo');
  mkdirSync(projectRoot);
  git(projectRoot, 'init', '-b', 'main');
  git(projectRoot, 'config', 'user.name', 'GAM Test');
  git(projectRoot, 'config', 'user.email', 'gam-test@example.invalid');
  writeFileSync(join(projectRoot, 'base.txt'), 'base\n');
  git(projectRoot, 'add', 'base.txt');
  git(projectRoot, 'commit', '-m', 'base');
  const baseSha = git(projectRoot, 'rev-parse', 'HEAD');
  git(projectRoot, 'checkout', '-b', 'candidate');
  writeFileSync(join(projectRoot, 'candidate.txt'), 'candidate\n');
  git(projectRoot, 'add', 'candidate.txt');
  git(projectRoot, 'commit', '-m', 'candidate');
  const candidateSha = git(projectRoot, 'rev-parse', 'HEAD');
  git(projectRoot, 'checkout', 'main');
  const databasePath = join(dir, 'global.db');
  const database = new ControlDatabase(databasePath);
  const plane = new ControlPlane(database);
  const project = plane.createProject({ name: 'GAM', rootPath: projectRoot }, 10);
  const resource = plane.declareResource({ projectId: project.id, kind: 'workspace', label: 'candidate-work' }, 11);
  const lease = plane.acquireLease({
    resourceId: resource.id, projectId: project.id, holderId: 'candidate-author', taskId: 'selfhost-task', mode: 'exclusive',
  }, 12);
  const claim = plane.evidence.submitClaim({
    projectId: project.id, taskId: 'selfhost-task', subject: 'candidate-author', resourceId: resource.id,
    leaseEpoch: lease.epoch, summary: 'candidate commit ready', commitSha: candidateSha,
  }, 13);
  expect(plane.evidence.verifyClaim(claim.id, 14).status).toBe('passed');
  const result: Harness = {
    dir, projectRoot, databasePath, database, plane, projectId: project.id, claimId: claim.id, baseSha, candidateSha,
  };
  cleanups.push(() => {
    try { result.database.close(); } catch { /* already closed during restart simulation */ }
    rmSync(dir, { recursive: true, force: true });
  });
  return result;
}

afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

function request(h: Harness, idempotencyKey = 'promotion:1') {
  return h.plane.promotions.request({
    projectId: h.projectId, idempotencyKey, claimId: h.claimId, candidateSha: h.candidateSha,
    targetRef: 'refs/heads/main', expectedParentSha: h.baseSha, requestedBy: 'promotion-requester',
  }, 20);
}

describe('durable Parent/Candidate promotion authority', () => {
  it('binds a request to exact verified SHA evidence and exact parent tip', () => {
    const h = harness();
    const promotion = request(h);
    expect(promotion).toMatchObject({
      claimId: h.claimId, candidateSubject: 'candidate-author', candidateSha: h.candidateSha,
      targetRef: 'refs/heads/main', expectedParentSha: h.baseSha, status: 'pending',
    });
    expect(() => h.plane.promotions.request({
      projectId: h.projectId, idempotencyKey: 'wrong-sha', claimId: h.claimId, candidateSha: h.baseSha,
      targetRef: 'refs/heads/main', expectedParentSha: h.baseSha, requestedBy: 'promotion-requester',
    }, 21)).toThrow(/exactly match/i);
  }, GIT_TEST_TIMEOUT);

  it('rejects self-approval and promotes only through independent authority', () => {
    const h = harness();
    const promotion = request(h);
    expect(() => h.plane.promotions.decide({
      promotionId: promotion.id, authoritySubject: 'candidate-author', decision: 'approve', reason: 'self approve',
    }, 30)).toThrow(/cannot decide its own promotion/i);
    const approved = h.plane.promotions.decide({
      promotionId: promotion.id, authoritySubject: 'promotion-authority', decision: 'approve', reason: 'independent review passed',
    }, 31);
    expect(approved.status).toBe('approved');
    expect(() => h.plane.promotions.apply({ promotionId: promotion.id, authoritySubject: 'different-authority' }, 32))
      .toThrow(/approving independent authority/i);
    const applied = h.plane.promotions.apply({ promotionId: promotion.id, authoritySubject: 'promotion-authority' }, 33);
    expect(applied.status).toBe('promoted');
    expect(git(h.projectRoot, 'rev-parse', 'refs/heads/main')).toBe(h.candidateSha);
  }, GIT_TEST_TIMEOUT);

  it('is idempotent under request, decision, and apply replay', () => {
    const h = harness();
    const first = request(h, 'replay-key');
    expect(request(h, 'replay-key').id).toBe(first.id);
    const decision = { promotionId: first.id, authoritySubject: 'promotion-authority', decision: 'approve' as const, reason: 'same review' };
    expect(h.plane.promotions.decide(decision, 30).id).toBe(first.id);
    expect(h.plane.promotions.decide(decision, 31).status).toBe('approved');
    const applied = h.plane.promotions.apply({ promotionId: first.id, authoritySubject: 'promotion-authority' }, 32);
    expect(applied.status).toBe('promoted');
    expect(h.plane.promotions.apply({ promotionId: first.id, authoritySubject: 'promotion-authority' }, 33)).toEqual(applied);
    expect(request(h, 'replay-key')).toEqual(applied);
    expect(h.plane.promotions.decide(decision, 34)).toEqual(applied);
    expect(() => h.plane.promotions.decide({ ...decision, reason: 'different replay' }, 35)).toThrow(/already promoted/i);
  }, GIT_TEST_TIMEOUT);

  it('converges after a crash between parent ref CAS and SQLite finalization', () => {
    const h = harness();
    const promotion = request(h);
    h.plane.promotions.decide({
      promotionId: promotion.id, authoritySubject: 'promotion-authority', decision: 'approve', reason: 'review passed',
    }, 30);
    git(h.projectRoot, 'update-ref', 'refs/heads/main', h.candidateSha, h.baseSha);
    h.database.close();
    h.database = new ControlDatabase(h.databasePath);
    h.plane = new ControlPlane(h.database);
    const converged = h.plane.promotions.apply({ promotionId: promotion.id, authoritySubject: 'promotion-authority' }, 40);
    expect(converged.status).toBe('promoted');
    expect(converged.promotedAt).toBe(40);
    expect(git(h.projectRoot, 'rev-parse', 'refs/heads/main')).toBe(h.candidateSha);
  }, GIT_TEST_TIMEOUT);

  it('preserves rejected candidates and never mutates the parent ref', () => {
    const h = harness();
    const promotion = request(h);
    const rejected = h.plane.promotions.decide({
      promotionId: promotion.id, authoritySubject: 'promotion-authority', decision: 'reject', reason: 'quality gate failed',
    }, 30);
    expect(rejected.status).toBe('rejected');
    expect(git(h.projectRoot, 'rev-parse', 'refs/heads/main')).toBe(h.baseSha);
    expect(git(h.projectRoot, 'cat-file', '-t', h.candidateSha)).toBe('commit');
    expect(h.plane.evidence.getClaim(h.claimId).status).toBe('verified');
    expect(() => h.plane.promotions.apply({ promotionId: promotion.id, authoritySubject: 'promotion-authority' }, 31))
      .toThrow(/preserved and cannot be applied/i);
    expect(h.plane.promotions.get(promotion.id).status).toBe('rejected');
  }, GIT_TEST_TIMEOUT);

  it('fails closed on parent drift without discarding the approved candidate', () => {
    const h = harness();
    const promotion = request(h);
    h.plane.promotions.decide({
      promotionId: promotion.id, authoritySubject: 'promotion-authority', decision: 'approve', reason: 'review passed',
    }, 30);
    writeFileSync(join(h.projectRoot, 'parent-only.txt'), 'drift\n');
    git(h.projectRoot, 'add', 'parent-only.txt');
    git(h.projectRoot, 'commit', '-m', 'parent drift');
    const driftSha = git(h.projectRoot, 'rev-parse', 'HEAD');
    expect(() => h.plane.promotions.apply({ promotionId: promotion.id, authoritySubject: 'promotion-authority' }, 31))
      .toThrow(/drifted/i);
    expect(git(h.projectRoot, 'rev-parse', 'refs/heads/main')).toBe(driftSha);
    expect(git(h.projectRoot, 'cat-file', '-t', h.candidateSha)).toBe('commit');
    expect(h.plane.promotions.get(promotion.id).status).toBe('approved');
  }, GIT_TEST_TIMEOUT);
});
