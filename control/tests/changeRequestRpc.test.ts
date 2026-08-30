import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';
import { RpcRouter } from '../src/rpc';

const cleanup: Array<() => void> = [];
const gitPath = process.env.GAM_GIT_PATH || 'git';
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync(gitPath, args, { cwd, encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}
afterEach(() => { while (cleanup.length) cleanup.pop()?.(); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'gam-cr-rpc-'));
  const repo = join(dir, 'repo');
  const init = spawnSync(gitPath, ['init', '-b', 'main', repo], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (init.status !== 0) throw new Error(init.stderr);
  git(repo, 'config', 'user.name', 'GAM Test');
  git(repo, 'config', 'user.email', 'gam-test@example.invalid');
  writeFileSync(join(repo, 'x.txt'), 'base\n'); git(repo, 'add', 'x.txt'); git(repo, 'commit', '-m', 'base');
  const baseSha = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'switch', '-c', 'gam/test/T1/A1');
  writeFileSync(join(repo, 'x.txt'), 'head\n'); git(repo, 'add', 'x.txt'); git(repo, 'commit', '-m', 'head');
  const headSha = git(repo, 'rev-parse', 'HEAD');
  const db = new ControlDatabase(join(dir, 'state.db'));
  const plane = new ControlPlane(db, gitPath);
  const router = new RpcRouter(plane, 'admin', 'browser');
  const project = plane.createProject({ name: 'P', rootPath: repo });
  const resource = plane.declareResource({ projectId: project.id, kind: 'workspace', label: 'T1' });
  const lease = plane.acquireLease({ resourceId: resource.id, projectId: project.id, holderId: 'worker', taskId: 'T1', mode: 'exclusive', ttlMs: 60_000 });
  cleanup.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { plane, router, project, resource, lease, baseSha, headSha };
}
describe('Change Request RPC roles', () => {
  it('lets the worker open a CR, the supervisor review it, and only admin queue it', () => {
    const h = setup();
    const worker = h.plane.issueCapability({
      subject: 'worker', projectId: h.project.id, taskId: 'T1', leaseEpoch: h.lease.epoch,
      scopes: ['claim:submit','change:open','change:read'], resourceIds: [h.resource.id], ttlMs: 60_000,
    });
    const claimResponse = h.router.handle({ id: 'claim', method: 'claim.submit', auth: { capabilityToken: worker.token }, params: {
      projectId: h.project.id, taskId: 'T1', subject: 'worker', resourceId: h.resource.id,
      leaseEpoch: h.lease.epoch, summary: 'ready', commitSha: h.headSha,
    }});
    expect(claimResponse.ok).toBe(true);
    if (!claimResponse.ok) return;
    const claim = claimResponse.result as { id: string };
    expect(h.router.handle({ id: 'verify', method: 'claim.verify', auth: { adminToken: 'admin' }, params: { claimId: claim.id } }).ok).toBe(true);
    const opened = h.router.handle({ id: 'open', method: 'change.open', auth: { capabilityToken: worker.token }, params: {
      projectId: h.project.id, taskId: 'T1', subject: 'worker', branch: 'gam/test/T1/A1', targetBranch: 'main', baseSha: h.baseSha, headSha: h.headSha, claimId: claim.id,
    }});
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const cr = opened.result as { id: string; headSha: string };
    const supervisor = h.plane.issueCapability({ subject: 'supervisor', projectId: h.project.id, scopes: ['change:review','change:read'], ttlMs: 60_000 });
    const workerReview = h.router.handle({ id: 'bad-review', method: 'review.submit', auth: { capabilityToken: worker.token }, params: {
      changeRequestId: cr.id, reviewerSubject: 'worker', headSha: cr.headSha, verdict: 'approve', body: 'approve',
    }});
    expect(workerReview.ok).toBe(false);
    const reviewed = h.router.handle({ id: 'review', method: 'review.submit', auth: { capabilityToken: supervisor.token }, params: {
      changeRequestId: cr.id, reviewerSubject: 'supervisor', headSha: cr.headSha, verdict: 'approve', body: 'looks good',
    }});
    expect(reviewed.ok).toBe(true);
    expect(h.router.handle({ id: 'queue-worker', method: 'merge.queue', auth: { capabilityToken: supervisor.token }, params: { changeRequestId: cr.id } }).ok).toBe(false);
    expect(h.router.handle({ id: 'queue-admin', method: 'merge.queue', auth: { adminToken: 'admin' }, params: { changeRequestId: cr.id } }).ok).toBe(true);
  }, 15_000);
});
