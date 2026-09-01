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

  it('reuses one durable ProjectCell for the same repository root across iteration names', () => {
    const { plane } = harness();
    const first = plane.createProject({ name: 'Recursive Wave 1', rootPath: 'E:/Agent/Charterion', minSlots: 0, maxSlots: 4 }, 1);
    const second = plane.createProject({ name: 'Recursive Wave 2', rootPath: 'e:\\agent\\charterion\\.', minSlots: 0, maxSlots: 8 }, 2);
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Recursive Wave 1');
    expect(plane.listProjects()).toHaveLength(1);
    expect(plane.listEvents(first.id).map((event) => event.type)).toContain('PROJECT_REUSED');
  });

  it('selects the conversation-rich legacy duplicate as the canonical reusable project', () => {
    const { plane } = harness();
    const sparse = plane.createProject({ name: 'Sparse Wave', rootPath: 'E:/Agent/Charterion', minSlots: 0, maxSlots: 2 }, 1);
    plane.database.db.prepare(`
      INSERT INTO projects(id,name,root_path,status,isolation_tier,min_slots,max_slots,weight,created_at,updated_at)
      VALUES('legacy-rich','Rich Wave','e:\\agent\\charterion','paused','c0-host',1,6,1,2,2)
    `).run();
    const slot = plane.createAgentSlot(sparse.id, 'ARCHITECT', 3);
    plane.bindAgentConversation(slot.id, 'conversation:sparse', 4);
    plane.database.db.prepare(`UPDATE agent_slots SET project_id='legacy-rich' WHERE id=?`).run(slot.id);
    plane.database.db.prepare(`UPDATE agent_conversations SET project_id='legacy-rich' WHERE slot_id=?`).run(slot.id);
    const reused = plane.createProject({ name: 'Future Wave', rootPath: 'E:/AGENT/CHARTERION/.', minSlots: 0, maxSlots: 3 }, 5);
    expect(reused.id).toBe('legacy-rich');
    expect(reused.status).toBe('active');
    expect(reused.maxSlots).toBe(6);
    expect(reused.minSlots).toBe(0);
    const event = plane.listEvents(reused.id).find((item) => item.type === 'PROJECT_REUSED');
    expect(event?.payload.duplicateProjectIds).toContain(sparse.id);
  });

  it('rolls a persistent AgentSlot onto a new conversation without losing lineage', () => {
    const { plane } = harness();
    const project = plane.createProject({ name: 'Alpha', rootPath: 'E:/alpha' }, 1);
    const slot = plane.createAgentSlot(project.id, 'runtime-owner', 2);
    const first = plane.bindAgentConversation(slot.id, 'conversation:a', 3);
    expect(first).toMatchObject({ conversationKey: 'conversation:a', conversationGeneration: 1, leaseEpoch: 1, rolloverState: 'idle' });
    expect(() => plane.bindAgentConversation(slot.id, 'conversation:b', 4)).toThrow(/requires an AgentSlot rollover/i);

    const requested = plane.requestAgentConversationRollover(slot.id, 'conversation-limit', 'handoff body', { taskId: 'T1' }, 5);
    expect(requested).toMatchObject({ fromConversationKey: 'conversation:a', fromGeneration: 1, toGeneration: 2, status: 'requested' });
    expect(plane.getAgentSlot(slot.id)).toMatchObject({ conversationKey: 'conversation:a', rolloverState: 'requested', activeRolloverId: requested.id });
    expect(plane.conversations.checkpoint(requested.checkpointId)).toMatchObject({ handoffText: 'handoff body', state: { taskId: 'T1' } });

    plane.beginAgentConversationRollover(slot.id, requested.id, 6);
    expect(plane.getAgentSlot(slot.id)).toMatchObject({ conversationGeneration: 1, rolloverState: 'opening', leaseEpoch: 2 });
    expect(plane.getAgentSlot(slot.id).conversationKey).toBeUndefined();
    plane.reportAgentBrowser({ slotId: slot.id, profileId: 'gam-default', browserState: 'opening', tabId: 9 }, 7);
    const canonical = plane.reportAgentBrowser({ slotId: slot.id, profileId: 'gam-default', browserState: 'open', tabId: 9, conversationKey: 'conversation:b' }, 8);
    expect(canonical).toMatchObject({ conversationKey: 'conversation:b', conversationGeneration: 2, rolloverState: 'opening', leaseEpoch: 3 });

    plane.browser.planOperation({ id: 'bootstrap-1', idempotencyKey: 'rollover:bootstrap-1', operation: 'prompt.send', slotId: slot.id, preconditionsHash: 'semantic-hash' }, 9);
    plane.browser.dispatchOperation('bootstrap-1', 10);
    plane.markAgentRolloverBootstrap(slot.id, requested.id, 'bootstrap-1', 11);
    expect(() => plane.completeAgentConversationRollover(slot.id, 'bootstrap-1', 12)).toThrow(/verified reply evidence/i);
    plane.browser.settleOperation('bootstrap-1', 'reply-observed', { assistantMessageId: 'm1' }, 13);
    const completed = plane.completeAgentConversationRollover(slot.id, 'bootstrap-1', 14);
    expect(completed).toMatchObject({ status: 'completed', fromConversationKey: 'conversation:a', toConversationKey: 'conversation:b', toGeneration: 2 });
    expect(plane.getAgentSlot(slot.id)).toMatchObject({ conversationKey: 'conversation:b', conversationGeneration: 2, rolloverState: 'idle', leaseEpoch: 3 });
    expect(plane.getAgentSlot(slot.id).activeRolloverId).toBeUndefined();
    expect(plane.conversations.listConversations(slot.id)).toMatchObject([
      { generation: 1, conversationKey: 'conversation:a', status: 'closed', closeReason: 'conversation-limit' },
      { generation: 2, conversationKey: 'conversation:b', status: 'active', predecessorConversationKey: 'conversation:a' },
    ]);
    expect(plane.conversations.listCheckpoints(slot.id)).toHaveLength(1);
    expect(plane.conversations.listRollovers(slot.id)).toHaveLength(1);
  });

  it('rejects provisional conversation identities at Kernel authority', () => {
    const { plane } = harness();
    const project = plane.createProject({ name: 'Canonical', rootPath: 'E:/canonical' }, 1);
    const slot = plane.createAgentSlot(project.id, 'ROLE01', 2);
    expect(() => plane.bindAgentConversation(slot.id, 'conversation:WEB:temporary', 3)).toThrow(/canonical durable/i);
    expect(() => plane.bindAgentConversation(slot.id, 'conversation:new', 4)).toThrow(/canonical durable/i);
    expect(() => plane.reportAgentBrowser({ slotId: slot.id, profileId: 'gam-default', browserState: 'open', tabId: 9, conversationKey: 'conversation:WEB:temporary' }, 5)).toThrow(/canonical durable/i);
    expect(plane.getAgentSlot(slot.id)).toMatchObject({ status: 'idle', browserState: 'absent' });
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

  it('kernel reconcile spawns once then reuses the same suspended role-class slot', () => {
    const { plane } = harness();
    const project = plane.createProject({ name: 'Recursive Company', rootPath: 'E:/recursive-company', minSlots: 0, maxSlots: 2 }, 1);
    plane.work.replace({
      expectedRevision: 0, transportGeneration: 'reuse-test', transportSequence: 1, transportMessageId: 'reuse-test-1',
      tasks: [{ id: 't1', project: project.name, targetRole: 'PAR_IMPL_RECOVERY_20260831', completionPolicy: 'verified-claim', dependsOn: [], attemptIds: [] }],
      attempts: [], messages: [],
    }, 2);
    const spawned = plane.reconcileElasticFleet(3, 0);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ kind: 'spawn', role: 'IMPLEMENTER', affinityKey: 'class:implementer' });
    const slotId = spawned[0]?.kind === 'spawn' ? spawned[0].slotId : undefined;
    expect(slotId).toBeTruthy();
    expect(plane.getAgentSlot(slotId!)).toMatchObject({ role: 'IMPLEMENTER', desiredState: 'active' });
    plane.suspendAgentSlot(slotId!, 4);
    const reused = plane.reconcileElasticFleet(5, 0);
    expect(reused).toEqual([{ kind: 'resume', slotId, reason: 'ready work reuses class:implementer' }]);
    expect(plane.listAgentSlots(project.id)).toHaveLength(1);
  });
});

describe('browser observation monotonicity', () => {
  it('rejects stale AgentSlot and browser-runtime observations', () => {
    const { plane } = harness();
    const project = plane.createProject({ name: 'Observed', rootPath: 'E:/observed' }, 1);
    const slot = plane.createAgentSlot(project.id, 'ROLE01', 2);
    plane.reportAgentBrowser({
      slotId: slot.id, profileId: 'gam-default', browserState: 'opening', tabId: 10,
    }, 100);
    expect(() => plane.reportAgentBrowser({
      slotId: slot.id, profileId: 'gam-default', browserState: 'absent',
    }, 99)).toThrow(/stale agent browser observation/i);
    expect(plane.getAgentSlot(slot.id).browserState).toBe('opening');

    plane.reportBrowserRuntime({
      profileId: 'gam-default', authStatus: 'authenticated', pageHealth: 'ready',
      openTabs: 1, extensionVersion: '0.5.0', observedAt: 200,
    });
    expect(() => plane.reportBrowserRuntime({
      profileId: 'gam-default', authStatus: 'authentication-required', pageHealth: 'unknown',
      openTabs: 0, extensionVersion: '0.5.0', observedAt: 199,
    })).toThrow(/stale browser runtime observation/i);
    expect(plane.listBrowserRuntime()[0]).toMatchObject({ authStatus: 'authenticated', observedAt: 200 });
  });
});
