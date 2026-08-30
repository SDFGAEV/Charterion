import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';

const cleanups: Array<() => void> = [];

function harness(): { plane: ControlPlane; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gam-control-'));
  const database = new ControlDatabase(join(dir, 'global.db'));
  const plane = new ControlPlane(database);
  const close = (): void => {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  };
  cleanups.push(close);
  return { plane, close };
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});
describe('project cells and agent slots', () => {
  it('persists project state transitions and rejects changes after archival', () => {
    const { plane } = harness();
    const project = plane.createProject({ name: 'Alpha', rootPath: 'E:/alpha', minSlots: 1, maxSlots: 4, weight: 2 }, 10);
    expect(project.status).toBe('active');
    expect(plane.setProjectStatus(project.id, 'draining', 20).status).toBe('draining');
    expect(plane.setProjectStatus(project.id, 'paused', 30).status).toBe('paused');
    expect(plane.setProjectStatus(project.id, 'active', 40).status).toBe('active');
    expect(plane.setProjectStatus(project.id, 'archived', 50).status).toBe('archived');
    expect(() => plane.setProjectStatus(project.id, 'active', 60)).toThrow(/cannot transition/i);
    expect(plane.listEvents(project.id).map((event) => event.type)).toContain('PROJECT_STATUS_CHANGED');
  });

  it('rotates the agent epoch whenever a conversation binding is replaced', () => {
    const { plane } = harness();
    const project = plane.createProject({ name: 'Alpha', rootPath: 'E:/alpha' }, 1);
    const slot = plane.createAgentSlot(project.id, 'runtime-owner', 2);
    const first = plane.bindAgentConversation(slot.id, 'conversation:a', 3);
    const second = plane.bindAgentConversation(slot.id, 'conversation:b', 4);
    expect(first.leaseEpoch).toBe(1);
    expect(second.leaseEpoch).toBe(2);
    expect(second.conversationKey).toBe('conversation:b');
  });
});
describe('resource leases', () => {
  it('enforces shared/exclusive conflicts and monotonic resource epochs', () => {
    const { plane } = harness();
    const project = plane.createProject({ name: 'Alpha', rootPath: 'E:/alpha' }, 1);
    const resource = plane.declareResource({ projectId: project.id, kind: 'workspace', label: 'runtime' }, 2);
    const first = plane.acquireLease({ resourceId: resource.id, projectId: project.id, holderId: 'a', mode: 'shared' }, 3);
    const second = plane.acquireLease({ resourceId: resource.id, projectId: project.id, holderId: 'b', mode: 'shared' }, 4);
    expect([first.epoch, second.epoch]).toEqual([1, 2]);
    expect(() => plane.acquireLease({ resourceId: resource.id, projectId: project.id, holderId: 'c', mode: 'exclusive' }, 5)).toThrow(/incompatibly/i);
    plane.releaseLease(first.id, first.epoch, 6);
    plane.releaseLease(second.id, second.epoch, 7);
    const exclusive = plane.acquireLease({ resourceId: resource.id, projectId: project.id, holderId: 'c', mode: 'exclusive' }, 8);
    expect(exclusive.epoch).toBe(3);
    expect(() => plane.releaseLease(exclusive.id, 2, 9)).toThrow(/stale/i);
  });

  it('expires TTL leases before conflict checks and permits drain-only renewal', () => {
    const { plane } = harness();
    const project = plane.createProject({ name: 'Alpha', rootPath: 'E:/alpha' }, 1);
    const resource = plane.declareResource({ projectId: project.id, kind: 'gpu', label: 'gpu0' }, 2);
    const old = plane.acquireLease({ resourceId: resource.id, projectId: project.id, holderId: 'a', mode: 'exclusive', ttlMs: 10 }, 100);
    const next = plane.acquireLease({ resourceId: resource.id, projectId: project.id, holderId: 'b', mode: 'exclusive', ttlMs: 50 }, 111);
    expect(plane.getLease(old.id).status).toBe('expired');
    plane.setProjectStatus(project.id, 'draining', 120);
    expect(plane.renewLease(next.id, next.epoch, 100, 121).expiresAt).toBe(221);
    plane.setProjectStatus(project.id, 'paused', 122);
    expect(() => plane.renewLease(next.id, next.epoch, 100, 123)).toThrow(/cannot renew/i);
  });
});
describe('capabilities', () => {
  it('binds scopes, project, resources, expiry and lease epoch into one grant', () => {
    const { plane } = harness();
    const project = plane.createProject({ name: 'Alpha', rootPath: 'E:/alpha' }, 1);
    const resource = plane.declareResource({ projectId: project.id, kind: 'workspace', label: 'task-1' }, 2);
    const lease = plane.acquireLease({ resourceId: resource.id, projectId: project.id, holderId: 'agent-1', taskId: 'task-1', mode: 'exclusive', ttlMs: 100 }, 3);
    const issued = plane.issueCapability({
      subject: 'agent-1', projectId: project.id, taskId: 'task-1', leaseEpoch: lease.epoch,
      scopes: ['artifact:register', 'claim:submit'], resourceIds: [resource.id], ttlMs: 100,
    }, 10);
    const verified = plane.verifyCapability(issued.token, 'claim:submit', {
      projectId: project.id, resourceId: resource.id, leaseEpoch: lease.epoch, now: 50,
    });
    expect(verified.subject).toBe('agent-1');
    expect(() => plane.verifyCapability(issued.token, 'review:submit', { now: 50 })).toThrow(/scope/i);
    expect(() => plane.verifyCapability(issued.token, 'claim:submit', { leaseEpoch: lease.epoch + 1, now: 50 })).toThrow(/stale/i);
    expect(() => plane.verifyCapability(issued.token, 'claim:submit', { now: 111 })).toThrow(/expired/i);
  });

  it('revokes grants without ever storing the plaintext token in SQLite rows', () => {
    const { plane } = harness();
    const project = plane.createProject({ name: 'Alpha', rootPath: 'E:/alpha' }, 1);
    const issued = plane.issueCapability({ subject: 'agent-1', projectId: project.id, scopes: ['status:read'], ttlMs: 1000 }, 10);
    const before = JSON.stringify(plane.database.db.prepare('SELECT * FROM capabilities').all());
    expect(before).not.toContain(issued.token);
    plane.revokeCapability(issued.id, 20);
    expect(() => plane.verifyCapability(issued.token, 'status:read', { now: 21 })).toThrow(/revoked/i);
  });
});

describe('task-write capability issuance', () => {
  it('requires one exact active task lease', () => {
    const { plane } = harness();
    const project = plane.createProject({ name: 'Alpha', rootPath: 'E:/alpha' }, 1);
    const resource = plane.declareResource({ projectId: project.id, kind: 'workspace', label: 'task-1' }, 2);
    expect(() => plane.issueCapability({
      subject: 'agent-1', projectId: project.id, taskId: 'task-1', leaseEpoch: 1,
      scopes: ['claim:submit'], resourceIds: [resource.id], ttlMs: 100,
    }, 3)).toThrow(/active lease/i);
    const lease = plane.acquireLease({
      resourceId: resource.id, projectId: project.id, holderId: 'agent-1', taskId: 'task-1', mode: 'exclusive', ttlMs: 100,
    }, 4);
    expect(() => plane.issueCapability({
      subject: 'agent-1', projectId: project.id, taskId: 'task-1', leaseEpoch: lease.epoch,
      scopes: ['claim:submit'], resourceIds: [], ttlMs: 100,
    }, 5)).toThrow(/exactly one resource/i);
  });
});
describe('supervisor-managed agent fleet lifecycle', () => {
  it('enforces project capacity and separates desired state from browser observation', () => {
    const { plane } = harness();
    const project = plane.createProject({ name: 'Fleet', rootPath: 'E:/fleet', minSlots: 0, maxSlots: 2 }, 1);
    const first = plane.createAgentSlot(project.id, 'ROLE01', 2);
    const second = plane.createAgentSlot(project.id, 'ROLE02', 3);
    expect(first).toMatchObject({ desiredState: 'active', browserState: 'absent', status: 'idle' });
    expect(() => plane.createAgentSlot(project.id, 'ROLE03', 4)).toThrow(/maxSlots/i);

    const opening = plane.reportAgentBrowser({ slotId: first.id, profileId: 'gam-default', browserState: 'opening', tabId: 10 }, 5);
    expect(opening).toMatchObject({ desiredState: 'active', browserState: 'opening', browserTabId: 10 });
    const opened = plane.reportAgentBrowser({ slotId: first.id, profileId: 'gam-default', browserState: 'open', tabId: 10, conversationKey: 'conversation:first' }, 6);
    expect(opened).toMatchObject({ status: 'assigned', conversationKey: 'conversation:first', browserState: 'open' });
    expect(opened.leaseEpoch).toBe(1);
    const resource = plane.declareResource({ projectId: project.id, kind: 'workspace', label: 'worker-1' }, 6);
    const lease = plane.acquireLease({ resourceId: resource.id, projectId: project.id, holderId: first.id, taskId: 'T1', mode: 'exclusive', ttlMs: 100 }, 6);
    expect(() => plane.issueCapability({ subject: 'other-worker', projectId: project.id, agentSlotId: first.id, scopes: ['status:read'], ttlMs: 100 }, 6)).toThrow(/subject.*agentSlotId/i);
    const grant = plane.issueCapability({ subject: first.id, projectId: project.id, agentSlotId: first.id, scopes: ['status:read'], ttlMs: 100 }, 6);
    expect(grant.agentSlotId).toBe(first.id);

    const draining = plane.suspendAgentSlot(first.id, 7);
    expect(draining).toMatchObject({ desiredState: 'suspended', status: 'assigned', browserState: 'open' });
    expect(plane.getLease(lease.id).status).toBe('active');
    expect(plane.verifyCapability(grant.token, 'status:read', { now: 8 }).id).toBe(grant.id);
    expect(() => plane.acquireLease({ resourceId: resource.id, projectId: project.id, holderId: first.id, taskId: 'T2', mode: 'exclusive', ttlMs: 100 }, 8)).toThrow(/not active/i);
    expect(() => plane.reportAgentBrowser({ slotId: first.id, profileId: 'gam-default', browserState: 'open', tabId: 10 }, 8)).toThrow(/non-active/i);
    const suspended = plane.reportAgentBrowser({ slotId: first.id, profileId: 'gam-default', browserState: 'absent' }, 9);
    expect(suspended).toMatchObject({ desiredState: 'suspended', status: 'suspended', browserState: 'absent' });
    expect(plane.getLease(lease.id).status).toBe('released');
    expect(() => plane.verifyCapability(grant.token, 'status:read', { now: 10 })).toThrow(/revoked/i);

    const resumed = plane.resumeAgentSlot(first.id, 10);
    expect(resumed).toMatchObject({ desiredState: 'active', status: 'assigned', conversationKey: 'conversation:first' });
    expect(plane.retireAgentSlot(first.id, 11)).toMatchObject({ desiredState: 'retired', status: 'retired' });
    expect(() => plane.resumeAgentSlot(first.id, 12)).toThrow(/retired/i);
    expect(second.desiredState).toBe('active');
  });
});
