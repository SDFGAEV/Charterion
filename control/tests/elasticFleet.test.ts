import { describe, expect, it } from 'vitest';
import { planElasticFleet } from '../src/elasticFleet';
import type { AgentSlot, ProjectCell } from '../src/contracts';
import type { KernelWorkSnapshot } from '../src/workAuthority';

const NOW = 1_000_000;

function project(overrides: Partial<ProjectCell> = {}): ProjectCell {
  return {
    id: 'p1', name: 'Project One', rootPath: 'C:/repo', status: 'active', isolationTier: 'c0-host',
    minSlots: 1, maxSlots: 4, weight: 1, createdAt: 1, updatedAt: 1, ...overrides,
  };
}

function agent(id: string, role: string, overrides: Partial<AgentSlot> = {}): AgentSlot {
  return {
    id, projectId: 'p1', role, status: 'assigned', desiredState: 'active', browserState: 'open',
    conversationGeneration: 1, rolloverState: 'idle', browserProfileId: 'gam-default', browserTabId: Number(id.replace(/\D/g, '')) + 10,
    browserObservedAt: NOW - 100_000, browserPageStatus: 'idle', browserRuntimeObservedAt: NOW - 100_000,
    browserQuarantined: false, leaseEpoch: 1, createdAt: 1, updatedAt: 1, ...overrides,
  };
}

function work(tasks: Record<string, unknown>[] = [], attempts: Record<string, unknown>[] = []): KernelWorkSnapshot {
  return { revision: 1, tasks, attempts, messages: [] };
}
describe('elastic fleet planner', () => {
  it('scales an active project down to minSlots using the longest-idle eligible slots first', () => {
    const decisions = planElasticFleet({
      project: project(), agents: [
        agent('a1', 'R1', { browserRuntimeObservedAt: NOW - 500_000 }),
        agent('a2', 'R2', { browserRuntimeObservedAt: NOW - 400_000 }),
        agent('a3', 'R3', { browserRuntimeObservedAt: NOW - 300_000 }),
      ], work: work(), activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 60_000,
    });
    expect(decisions).toEqual([
      { kind: 'suspend', slotId: 'a1', reason: 'idle beyond 60000ms and above target 1' },
      { kind: 'suspend', slotId: 'a2', reason: 'idle beyond 60000ms and above target 1' },
    ]);
  });

  it('never suspends unsafe or still-demanded slots', () => {
    const agents = [
      agent('a1', 'GENERATING', { browserPageStatus: 'generating' }),
      agent('a2', 'UNKNOWN', { browserPageStatus: 'unknown' }),
      agent('a3', 'QUARANTINED', { browserQuarantined: true }),
      agent('a4', 'EFFECT'), agent('a5', 'LEASE'), agent('a6', 'WORK'),
    ];
    const tasks = [{ id: 't1', project: 'Project One', targetRole: 'WORK', completionPolicy: 'verified-claim', dependsOn: [], attemptIds: [] }];
    const decisions = planElasticFleet({ project: project({ minSlots: 0 }), agents, work: work(tasks), activeLeaseHolderIds: new Set(['a5']), unsettledBrowserSlotIds: new Set(['a4']), now: NOW, idleGraceMs: 0 });
    expect(decisions).toEqual([]);
  });
  it('lets paused and archived projects drain below minSlots without deleting durable identity', () => {
    for (const status of ['paused', 'archived'] as const) {
      const decisions = planElasticFleet({
        project: project({ status, minSlots: 2 }), agents: [agent('a1', 'R1'), agent('a2', 'R2')], work: work(),
        activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 0,
      });
      expect(decisions.map((item) => [item.kind, item.slotId])).toEqual([['suspend', 'a1'], ['suspend', 'a2']]);
    }
  });

  it('enforces the idle grace and fails closed when trusted idle time is absent', () => {
    const decisions = planElasticFleet({
      project: project({ minSlots: 0 }), agents: [
        agent('a1', 'R1', { browserRuntimeObservedAt: NOW - 59_999 }),
        (() => { const value = agent('a2', 'R2'); delete value.browserRuntimeObservedAt; return value; })(),
      ], work: work(), activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 60_000,
    });
    expect(decisions).toEqual([]);
  });

  it('resumes the same durable suspended role when ready work appears', () => {
    const suspended = agent('a2', 'WORKER', { status: 'suspended', desiredState: 'suspended', browserState: 'absent', updatedAt: 50 }); delete suspended.browserPageStatus; delete suspended.browserRuntimeObservedAt;
    const tasks = [{ id: 't1', project: 'Project One', targetRole: 'WORKER', completionPolicy: 'verified-claim', dependsOn: [], attemptIds: [] }];
    const decisions = planElasticFleet({ project: project({ minSlots: 0 }), agents: [suspended], work: work(tasks), activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 0 });
    expect(decisions).toEqual([{ kind: 'resume', slotId: 'a2', reason: 'ready work reuses class:implementer' }]);
  });
  it('reuses a suspended canonical agent across wave-specific implementer role names', () => {
    const suspended = agent('a2', 'PAR_IMPL_DISPATCH_20260831', {
      status: 'suspended', desiredState: 'suspended', browserState: 'absent',
      conversationKey: 'conversation:persistent-worker', updatedAt: 50,
    });
    delete suspended.browserPageStatus; delete suspended.browserRuntimeObservedAt;
    const tasks = [{ id: 't1', project: 'Project One', targetRole: 'W2_RECOVERY_IMPL_20260831', completionPolicy: 'verified-claim', dependsOn: [], attemptIds: [] }];
    const decisions = planElasticFleet({ project: project({ minSlots: 0 }), agents: [suspended], work: work(tasks), activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 0 });
    expect(decisions).toEqual([{ kind: 'resume', slotId: 'a2', reason: 'ready work reuses class:implementer' }]);
  });

  it('spawns a stable pooled role only when no reusable compatible slot exists', () => {
    const tasks = [{ id: 't1', project: 'Project One', targetRole: 'PAR_IMPL_RECOVERY_20260831', completionPolicy: 'verified-claim', dependsOn: [], attemptIds: [] }];
    const decisions = planElasticFleet({ project: project({ minSlots: 0 }), agents: [], work: work(tasks), activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 0 });
    expect(decisions).toEqual([{ kind: 'spawn', role: 'IMPLEMENTER', affinityKey: 'class:implementer', reason: 'ready work requires new class:implementer; no reusable slot exists' }]);
  });

  it('does not resume a dependent role until its dependency is terminal', () => {
    const suspended = agent('a2', 'WORKER', { status: 'suspended', desiredState: 'suspended', browserState: 'absent' }); delete suspended.browserPageStatus; delete suspended.browserRuntimeObservedAt;
    const dependency = { id: 'dep', project: 'Project One', targetRole: 'PREP', completionPolicy: 'verified-claim', dependsOn: [], attemptIds: [] };
    const target = { id: 't1', project: 'Project One', targetRole: 'WORKER', completionPolicy: 'verified-claim', dependsOn: ['dep'], attemptIds: [] };
    const blocked = planElasticFleet({ project: project({ minSlots: 0 }), agents: [suspended], work: work([dependency, target]), activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 0 });
    expect(blocked).toEqual([{ kind: 'spawn', role: 'PREP', affinityKey: 'role:prep', reason: 'ready work requires new role:prep; no reusable slot exists' }]);
    expect(blocked.some((item) => item.kind === 'resume' && item.slotId === 'a2')).toBe(false);
    const completed = { ...dependency, machineCompletion: { kind: 'verified-claim', claimId: 'c', verificationId: 'v', completedAt: NOW } };
    const ready = planElasticFleet({ project: project({ minSlots: 0 }), agents: [suspended], work: work([completed, target]), activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 0 });
    expect(ready.map((item) => item.kind)).toEqual(['resume']);
  });

  it('stops treating a reply-completed task as demand', () => {
    const task = { id: 't1', project: 'Project One', targetRole: 'WORKER', completionPolicy: 'reply', dependsOn: [], attemptIds: ['x1'] };
    const decisions = planElasticFleet({
      project: project({ minSlots: 0 }), agents: [agent('a1', 'WORKER')], work: work([task], [{ attemptId: 'x1', state: 'reply-observed' }]),
      activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 0,
    });
    expect(decisions.map((item) => item.kind)).toEqual(['suspend']);
  });
  it('stops treating a valid structured-result task as demand', () => {
    const task = { id: 't1', project: 'Project One', targetRole: 'WORKER', completionPolicy: 'structured-result', dependsOn: [], attemptIds: ['x1'] };
    const replyTextTail = '<GAM_RESULT>\n{"status":"completed","summary":"Observed the requested browser state","evidence":["assistant reply was captured"]}\n</GAM_RESULT>';
    const decisions = planElasticFleet({
      project: project({ minSlots: 0 }), agents: [agent('a1', 'WORKER')], work: work([task], [{ attemptId: 'x1', state: 'reply-observed', replyTextTail }]),
      activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 0,
    });
    expect(decisions.map((item) => item.kind)).toEqual(['suspend']);
  });

  it('keeps reviewer demand after an explicit failed review', () => {
    const task = { id: 'r1', project: 'Project One', targetRole: 'REVIEWER', completionPolicy: 'review-pass', dependsOn: [], attemptIds: ['x1'] };
    const replyTextTail = 'review\n<GAM_REVIEW>\n{"decision":"fail","reason":"needs fix","nextInstruction":"fix it"}\n</GAM_REVIEW>';
    const decisions = planElasticFleet({ project: project({ minSlots: 0 }), agents: [agent('a1', 'REVIEWER')], work: work([task], [{ attemptId: 'x1', state: 'reply-observed', replyTextTail }]), activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 0 });
    expect(decisions).toEqual([]);
  });

  it('fails closed on protocol-invalid review replies', () => {
    const task = { id: 'r1', project: 'Project One', targetRole: 'REVIEWER', completionPolicy: 'review-pass', dependsOn: [], attemptIds: ['x1'] };
    const decisions = planElasticFleet({ project: project({ minSlots: 0 }), agents: [agent('a1', 'REVIEWER')], work: work([task], [{ attemptId: 'x1', state: 'reply-observed', replyTextTail: 'SUPERVISOR_REJECTED' }]), activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 0 });
    expect(decisions).toEqual([]);
  });

  it('releases reviewer demand only after a strict passing review protocol', () => {
    const task = { id: 'r1', project: 'Project One', targetRole: 'REVIEWER', completionPolicy: 'review-pass', dependsOn: [], attemptIds: ['x1'] };
    const replyTextTail = 'review\n<GAM_REVIEW>\n{"decision":"pass","reason":"verified","nextInstruction":""}\n</GAM_REVIEW>';
    const decisions = planElasticFleet({ project: project({ minSlots: 0 }), agents: [agent('a1', 'REVIEWER')], work: work([task], [{ attemptId: 'x1', state: 'reply-observed', replyTextTail }]), activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 0 });
    expect(decisions.map((item) => item.kind)).toEqual(['suspend']);
  });

  it('keeps only the number of same-role workers required by ready demand', () => {
    const task = { id: 't1', project: 'Project One', targetRole: 'WORKER', completionPolicy: 'verified-claim', dependsOn: [], attemptIds: [] };
    const decisions = planElasticFleet({
      project: project({ minSlots: 0 }), agents: [agent('a1', 'WORKER', { browserRuntimeObservedAt: NOW - 300_000 }), agent('a2', 'WORKER', { browserRuntimeObservedAt: NOW - 200_000 })],
      work: work([task]), activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 0,
    });
    expect(decisions).toEqual([{ kind: 'suspend', slotId: 'a1', reason: 'idle beyond 0ms and above target 0' }]);
  });

  it('releases reviewer capacity after a strict passing review is observed', () => {
    const task = { id: 'r1', project: 'Project One', targetRole: 'REVIEWER', completionPolicy: 'review-pass', dependsOn: [], attemptIds: ['r-a1'] };
    const replyTextTail = 'review\n<GAM_REVIEW>\n{"decision":"pass","reason":"verified","nextInstruction":""}\n</GAM_REVIEW>';
    const decisions = planElasticFleet({ project: project({ minSlots: 0 }), agents: [agent('a1', 'REVIEWER')], work: work([task], [{ attemptId: 'r-a1', state: 'reply-observed', replyTextTail }]), activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 0 });
    expect(decisions.map((item) => item.kind)).toEqual(['suspend']);
  });

  it('wakes a suspended role after an explicit retry of the latest completed attempt', () => {
    const suspended = agent('a2', 'WORKER', { status: 'suspended', desiredState: 'suspended', browserState: 'absent' }); delete suspended.browserPageStatus; delete suspended.browserRuntimeObservedAt;
    const task = { id: 't1', project: 'Project One', targetRole: 'WORKER', completionPolicy: 'reply', dependsOn: [], attemptIds: ['x1'], retryAfterAttemptId: 'x1' };
    const decisions = planElasticFleet({ project: project({ minSlots: 0 }), agents: [suspended], work: work([task], [{ attemptId: 'x1', state: 'reply-observed' }]), activeLeaseHolderIds: new Set(), unsettledBrowserSlotIds: new Set(), now: NOW, idleGraceMs: 0 });
    expect(decisions).toEqual([{ kind: 'resume', slotId: 'a2', reason: 'ready work reuses class:implementer' }]);
  });

});
