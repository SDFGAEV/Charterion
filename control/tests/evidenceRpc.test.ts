import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';
import { RpcRouter } from '../src/rpc';

const cleanups: Array<() => void> = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'gam-evidence-rpc-'));
  const projectRoot = join(dir, 'project');
  mkdirSync(projectRoot);
  const db = new ControlDatabase(join(dir, 'db.sqlite'));
  const plane = new ControlPlane(db);
  const router = new RpcRouter(plane, 'admin', 'browser');
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, projectRoot, plane, router };
}
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });function taskFixture() {
  const h = setup();
  const project = h.plane.createProject({ name: 'P', rootPath: h.projectRoot });
  const resource = h.plane.declareResource({ projectId: project.id, kind: 'workspace', label: 'task-workspace' });
  const lease = h.plane.acquireLease({
    resourceId: resource.id, projectId: project.id, holderId: 'agent-1', taskId: 'task-1', mode: 'exclusive', ttlMs: 100000,
  });
  const cap = h.plane.issueCapability({
    subject: 'agent-1', projectId: project.id, taskId: 'task-1', leaseEpoch: lease.epoch,
    scopes: ['claim:submit', 'artifact:register', 'claim:read'], resourceIds: [resource.id], ttlMs: 100000,
  });
  return { ...h, project, resource, lease, cap };
}

describe('evidence RPC authorization', () => {
  it('allows one exact capability to submit its own claim and artifact', () => {
    const h = taskFixture();
    writeFileSync(join(h.projectRoot, 'result.txt'), 'rpc evidence');
    const claimResponse = h.router.handle({
      id: 'claim', method: 'claim.submit', auth: { capabilityToken: h.cap.token },
      params: { projectId: h.project.id, taskId: 'task-1', subject: 'agent-1', resourceId: h.resource.id, leaseEpoch: h.lease.epoch, summary: 'done' },
    });
    expect(claimResponse.ok).toBe(true);
    if (!claimResponse.ok) return;
    const claim = claimResponse.result as { id: string };
    const artifact = h.router.handle({
      id: 'artifact', method: 'artifact.register', auth: { capabilityToken: h.cap.token },
      params: { claimId: claim.id, path: 'result.txt', kind: 'report' },
    });
    expect(artifact.ok).toBe(true);
  });  it('rejects subject/task spoofing and global capability reads', () => {
    const h = taskFixture();
    const spoofed = h.router.handle({
      id: 'spoof', method: 'claim.submit', auth: { capabilityToken: h.cap.token },
      params: { projectId: h.project.id, taskId: 'task-1', subject: 'other', resourceId: h.resource.id, leaseEpoch: h.lease.epoch, summary: 'spoof' },
    });
    expect(spoofed.ok).toBe(false);
    const globalAgents = h.router.handle({ id: 'agents', method: 'agent.list', auth: { capabilityToken: h.cap.token } });
    expect(globalAgents.ok).toBe(false);
    const globalClaims = h.router.handle({ id: 'claims', method: 'claim.list', auth: { capabilityToken: h.cap.token } });
    expect(globalClaims.ok).toBe(false);
  });

  it('keeps verification admin-only while browser may read the resulting facts', () => {
    const h = taskFixture();
    writeFileSync(join(h.projectRoot, 'result.txt'), 'evidence');
    const claim = h.plane.evidence.submitClaim({
      projectId: h.project.id, taskId: 'task-1', subject: 'agent-1', resourceId: h.resource.id,
      leaseEpoch: h.lease.epoch, summary: 'done',
    }, 10);
    h.plane.evidence.registerArtifact({ claimId: claim.id, subject: 'agent-1', path: 'result.txt', kind: 'file' }, 11);
    const denied = h.router.handle({ id: 'verify', method: 'claim.verify', auth: { browserToken: 'browser' }, params: { claimId: claim.id } });
    expect(denied.ok).toBe(false);
    const verified = h.router.handle({ id: 'verify2', method: 'claim.verify', auth: { adminToken: 'admin' }, params: { claimId: claim.id } });
    expect(verified).toMatchObject({ ok: true, result: { status: 'passed' } });
    const snapshot = h.router.handle({ id: 'snapshot', method: 'control.snapshot', auth: { browserToken: 'browser' } });
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) expect((snapshot.result as { claims: unknown[] }).claims).toHaveLength(1);
  });
});