import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase, CONTROL_SCHEMA_VERSION } from '../src/database';
import { ControlPlane } from '../src/controlPlane';

interface Harness { dir: string; projectRoot: string; plane: ControlPlane; }
const cleanups: Array<() => void> = [];
function harness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'gam-evidence-'));
  const projectRoot = join(dir, 'project');
  mkdirSync(projectRoot);
  const database = new ControlDatabase(join(dir, 'global.db'));
  const plane = new ControlPlane(database);
  cleanups.push(() => { database.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, projectRoot, plane };
}
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });function leasedTask(h: Harness, holder = 'agent-1', taskId = 'task-1', now = 10) {
  const project = h.plane.createProject({ name: 'P', rootPath: h.projectRoot }, now);
  const resource = h.plane.declareResource({ projectId: project.id, kind: 'workspace', label: 'task-workspace' }, now + 1);
  const lease = h.plane.acquireLease({
    resourceId: resource.id, projectId: project.id, holderId: holder, taskId, mode: 'exclusive', ttlMs: 1000,
  }, now + 2);
  return { project, resource, lease, taskId, holder };
}

describe('evidence authority', () => {
  it('stores current schema and binds a claim to one exact lease identity', () => {
    const h = harness();
    const setup = leasedTask(h);
    const claim = h.plane.evidence.submitClaim({
      projectId: setup.project.id, taskId: setup.taskId, subject: setup.holder,
      resourceId: setup.resource.id, leaseEpoch: setup.lease.epoch, summary: 'done',
    }, 20);
    expect(CONTROL_SCHEMA_VERSION).toBe(12);
    expect(claim.leaseId).toBe(setup.lease.id);
    expect(() => h.plane.evidence.submitClaim({
      projectId: setup.project.id, taskId: setup.taskId, subject: 'other',
      resourceId: setup.resource.id, leaseEpoch: setup.lease.epoch, summary: 'spoof',
    }, 21)).toThrow(/does not own/i);
  });  it('hashes artifacts itself and verifies unchanged evidence', () => {
    const h = harness();
    const setup = leasedTask(h);
    const file = join(h.projectRoot, 'result.txt');
    writeFileSync(file, 'verified content');
    const claim = h.plane.evidence.submitClaim({
      projectId: setup.project.id, taskId: setup.taskId, subject: setup.holder,
      resourceId: setup.resource.id, leaseEpoch: setup.lease.epoch, summary: 'artifact ready',
    }, 20);
    const artifact = h.plane.evidence.registerArtifact({
      claimId: claim.id, subject: setup.holder, path: file, kind: 'report',
    }, 21);
    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.sizeBytes).toBe(Buffer.byteLength('verified content'));
    const verification = h.plane.evidence.verifyClaim(claim.id, 22);
    expect(verification.status).toBe('passed');
    expect(h.plane.evidence.getClaim(claim.id).status).toBe('verified');
  });

  it('rejects a claim when a registered artifact is modified before verification', () => {
    const h = harness();
    const setup = leasedTask(h);
    const file = join(h.projectRoot, 'result.txt');
    writeFileSync(file, 'first');
    const claim = h.plane.evidence.submitClaim({
      projectId: setup.project.id, taskId: setup.taskId, subject: setup.holder,
      resourceId: setup.resource.id, leaseEpoch: setup.lease.epoch, summary: 'artifact ready',
    }, 20);
    h.plane.evidence.registerArtifact({ claimId: claim.id, subject: setup.holder, path: file, kind: 'file' }, 21);
    writeFileSync(file, 'tampered');
    const verification = h.plane.evidence.verifyClaim(claim.id, 22);
    expect(verification.status).toBe('failed');
    expect(verification.checks.some((check) => check.name.startsWith('artifact:') && !check.passed)).toBe(true);
    expect(h.plane.evidence.getClaim(claim.id).status).toBe('rejected');
  });  it('rejects artifact paths outside the project root', () => {
    const h = harness();
    const setup = leasedTask(h);
    const outside = join(h.dir, 'outside.txt');
    writeFileSync(outside, 'nope');
    const claim = h.plane.evidence.submitClaim({
      projectId: setup.project.id, taskId: setup.taskId, subject: setup.holder,
      resourceId: setup.resource.id, leaseEpoch: setup.lease.epoch, summary: 'artifact ready',
    }, 20);
    expect(() => h.plane.evidence.registerArtifact({
      claimId: claim.id, subject: setup.holder, path: outside, kind: 'file',
    }, 21)).toThrow(/escapes/i);
  });

  it('rejects expired lease claims and evidence-free verification', () => {
    const h = harness();
    const setup = leasedTask(h, 'agent-1', 'task-1', 10);
    expect(() => h.plane.evidence.submitClaim({
      projectId: setup.project.id, taskId: setup.taskId, subject: setup.holder,
      resourceId: setup.resource.id, leaseEpoch: setup.lease.epoch, summary: 'late',
    }, 2000)).toThrow(/not active/i);

    const setup2 = leasedTask(h, 'agent-2', 'task-2', 3000);
    const claim = h.plane.evidence.submitClaim({
      projectId: setup2.project.id, taskId: setup2.taskId, subject: setup2.holder,
      resourceId: setup2.resource.id, leaseEpoch: setup2.lease.epoch, summary: 'no evidence',
    }, 3020);
    const verification = h.plane.evidence.verifyClaim(claim.id, 3021);
    expect(verification.status).toBe('failed');
    expect(verification.checks.find((check) => check.name === 'evidence.present')?.passed).toBe(false);
  });
});