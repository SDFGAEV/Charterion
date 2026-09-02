import { describe, expect, it } from 'vitest';
import { dispatchReadyManagedTasks } from '../src/taskDispatchRuntime';
import type { AgentTask, ManagedTab, ManagedTask, SendAttemptRecord } from '../src/contracts';
import type { NativeControlSnapshot } from '../src/nativeControl';

const badAttempt: SendAttemptRecord = {
  attemptId: 'attempt-bad', batchId: 'batch-1', tabId: 7, conversationKey: 'conversation:c1',
  contentEpoch: 'epoch-1', taskId: 'audit', state: 'reply-observed', textLength: 5,
  baselineAssistantMessageCount: 0, replyTextTail: 'Read', createdAt: 1, updatedAt: 2,
};

const task: AgentTask = {
  id: 'audit', kind: 'work', completionPolicy: 'structured-result', title: 'Audit', project: 'P',
  instruction: 'Audit completion semantics', targetRole: 'auditor', dependsOn: [],
  attemptIds: ['attempt-bad'], retryAfterAttemptId: 'attempt-bad', createdAt: 1, updatedAt: 3,
};

const managed: ManagedTask = {
  task, status: 'ready', lastAttempt: badAttempt, attemptHistory: [badAttempt],
  structuredResultError: 'Structured-result reply must end with one <GAM_RESULT> JSON block',
};

const tab: ManagedTab = {
  tabId: 7, windowId: 1, active: false,
  snapshot: {
    conversationKey: 'conversation:c1', title: 'Audit', url: 'https://chatgpt.com/c/c1',
    status: 'idle', confidence: 'direct', signals: [], assistantMessageCount: 1,
    latestAssistantText: 'Read', observedAt: 4,
  },
  binding: { role: 'auditor', project: 'P', notes: '', agentSlotId: 'slot-1' },
  lastAttempt: badAttempt,
};

const control: NativeControlSnapshot = {
  protocolVersion: 2, projects: [], resources: [], leases: [], changeRequests: [], reviews: [],
  mergeQueue: [], workerRequests: [], browserRuntime: [], events: [],
  agents: [{
    id: 'slot-1', projectId: 'project-1', role: 'auditor', status: 'idle', desiredState: 'active',
    browserState: 'open', conversationGeneration: 1, rolloverState: 'idle',
    browserQuarantined: false, leaseEpoch: 1,
  }],
};

describe('structured-result retry dispatch', () => {
  it('propagates protocol-invalid retry context into the fresh prompt', async () => {
    let prompt = '';
    const results = await dispatchReadyManagedTasks(
      [managed], [tab], control, { 'slot-1': 7 }, 'batch-2',
      async (_tabId, text) => {
        prompt = text;
        return { tabId: 7, attemptId: 'attempt-retry', ok: true };
      },
    );

    expect(results).toEqual([{ taskId: 'audit', ok: true, attemptId: 'attempt-retry' }]);
    expect(prompt).toContain('Protocol retry: prior attempt attempt-bad was rejected');
    expect(prompt).toContain('Structured-result reply must end with one <GAM_RESULT> JSON block');
    expect(prompt.trim().endsWith('Do not place any text after the closing tag.')).toBe(true);
  });
});

describe('parallel task dispatch', () => {
  const secondTask: AgentTask = (() => {
    const copy: AgentTask = { ...task, id: 'audit-2', title: 'Audit 2', attemptIds: [] };
    delete copy.retryAfterAttemptId;
    return copy;
  })();

  const secondManaged: ManagedTask = {
    task: secondTask,
    status: 'ready',
    attemptHistory: [],
  };

  const secondTab: ManagedTab = {
    ...tab,
    tabId: 8,
    binding: { ...tab.binding, agentSlotId: 'slot-2' },
  };

  const twoAgentControl: NativeControlSnapshot = {
    ...control,
    agents: [...control.agents, {
      ...control.agents[0]!,
      id: 'slot-2',
      role: 'auditor',
    }],
  };

  it('runs independent tab decisions concurrently', async () => {
    let active = 0;
    let maximumActive = 0;
    const results = await dispatchReadyManagedTasks(
      [managed, secondManaged],
      [tab, secondTab],
      twoAgentControl,
      { 'slot-1': 7, 'slot-2': 8 },
      'batch-parallel',
      async (tabId) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return { tabId, attemptId: 'attempt-' + tabId, ok: true };
      },
    );

    expect(maximumActive).toBe(2);
    expect(results.map((result) => result.taskId)).toEqual(['audit', 'audit-2']);
  });

  it('isolates one tab failure from other independent decisions', async () => {
    const results = await dispatchReadyManagedTasks(
      [managed, secondManaged],
      [tab, secondTab],
      twoAgentControl,
      { 'slot-1': 7, 'slot-2': 8 },
      'batch-isolated',
      async (tabId) => {
        if (tabId === 7) throw new Error('tab 7 failed');
        return { tabId, attemptId: 'attempt-8', ok: true };
      },
    );

    expect(results).toEqual([
      { taskId: 'audit', ok: false, error: 'tab 7 failed' },
      { taskId: 'audit-2', ok: true, attemptId: 'attempt-8' },
    ]);
  });
});
