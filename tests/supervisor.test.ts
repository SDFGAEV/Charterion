import { describe, expect, it } from 'vitest';
import { planReadyDispatches } from '../src/supervisor';
import type { AgentTask, ManagedTab, ManagedTask, SendAttemptRecord } from '../src/contracts';

function task(id: string, role: string, project = ''): AgentTask {
  return { id, kind: 'work', completionPolicy: 'reply', title: id, project, instruction: id, targetRole: role, dependsOn: [], attemptIds: [], createdAt: 1, updatedAt: 1 };
}

function managed(id: string, role: string, status: ManagedTask['status'] = 'ready', project = ''): ManagedTask {
  return { task: task(id, role, project), status, attemptHistory: [] };
}

function tab(
  tabId: number,
  role: string,
  project = '',
  status: ManagedTab['snapshot']['status'] = 'idle',
  attemptState?: SendAttemptRecord['state'],
): ManagedTab {
  const result: ManagedTab = {
    tabId, windowId: 1, active: false,
    binding: { role, project, notes: '' },
    snapshot: {
      conversationKey: `conversation:${tabId}`, title: role, url: `https://chatgpt.com/c/${tabId}`,
      status, confidence: 'direct', signals: [], assistantMessageCount: 0, latestAssistantText: '', observedAt: 1,
    },
  };
  if (attemptState) {
    result.lastAttempt = {
      attemptId: 'last-attempt', batchId: 'batch', tabId,
      conversationKey: `conversation:${tabId}`, state: attemptState, textLength: 1,
      contentEpoch: 'content-epoch',
      baselineAssistantMessageCount: 0, createdAt: 1, updatedAt: 1,
    };
  }
  return result;
}

describe('supervisor dispatch planning', () => {
  it('routes one ready task to one exact idle role', () => {
    expect(planReadyDispatches([managed('a', 'worker')], [tab(1, 'worker')]))
      .toEqual([{ taskId: 'a', tabId: 1 }]);
  });

  it('deterministically reuses an exact role when multiple idle agents are compatible', () => {
    expect(planReadyDispatches([managed('a', 'worker')], [tab(2, 'worker'), tab(1, 'worker')]))
      .toEqual([{ taskId: 'a', tabId: 1 }]);
  });

  it('reuses a compatible persistent agent when wave-specific role names change', () => {
    const reused = tab(7, 'PAR_IMPL_DISPATCH_20260831', 'alpha');
    reused.binding.agentSlotId = 'slot-7';
    expect(planReadyDispatches([managed('a', 'W2_RECOVERY_IMPL_20260831', 'ready', 'alpha')], [reused]))
      .toEqual([{ taskId: 'a', tabId: 7 }]);
  });

  it('prefers a canonical conversation over a provisional compatible tab', () => {
    const provisional = tab(1, 'IMPLEMENTER_2', 'alpha');
    provisional.snapshot.conversationKey = 'provisional:content-a';
    const canonical = tab(2, 'IMPLEMENTER_3', 'alpha');
    canonical.binding.agentSlotId = 'slot-2';
    expect(planReadyDispatches([managed('a', 'PAR_IMPL_RECOVERY_20260831', 'ready', 'alpha')], [provisional, canonical]))
      .toEqual([{ taskId: 'a', tabId: 2 }]);
  });

  it('respects exact project routing when a task names a project', () => {
    expect(planReadyDispatches([managed('a', 'worker', 'ready', 'alpha')], [tab(1, 'worker', 'beta'), tab(2, 'worker', 'alpha')]))
      .toEqual([{ taskId: 'a', tabId: 2 }]);
  });

  it('never schedules two tasks onto one tab in the same pass', () => {
    const decisions = planReadyDispatches([managed('a', 'worker'), managed('b', 'worker')], [tab(1, 'worker')]);
    expect(decisions[0]).toEqual({ taskId: 'a', tabId: 1 });
    expect(decisions[1]?.tabId).toBeUndefined();
  });

  it('allocates constrained tasks before flexible tasks to preserve maximum throughput', () => {
    const flexible = managed('flexible', 'worker');
    const constrained = managed('constrained', 'worker', 'ready', 'alpha');
    const alpha = tab(1, 'worker', 'alpha');
    const beta = tab(2, 'worker', 'beta');
    expect(planReadyDispatches([flexible, constrained], [alpha, beta])).toEqual([
      { taskId: 'flexible', tabId: 2 },
      { taskId: 'constrained', tabId: 1 },
    ]);
  });

  it('prefers role-specialty affinity over a generic compatible role', () => {
    const specialized = tab(9, 'PLATFORM_DEVELOPER');
    const generic = tab(1, 'SECURITY_ENGINEER');
    expect(planReadyDispatches([managed('a', 'PLATFORM_ENGINEER')], [generic, specialized]))
      .toEqual([{ taskId: 'a', tabId: 9 }]);
  });

  it('ignores non-ready tasks and non-idle tabs', () => {
    expect(planReadyDispatches([managed('a', 'worker', 'pending')], [tab(1, 'worker')])).toEqual([]);
    expect(planReadyDispatches([managed('a', 'worker')], [tab(1, 'worker', '', 'generating')])[0]?.error).toMatch(/No idle/);
  });
  it('does not reuse a DOM-idle tab with an unresolved durable attempt', () => {
    for (const state of ['prepared', 'dispatched', 'acknowledged'] as const) {
      expect(planReadyDispatches([managed('a', 'worker')], [tab(1, 'worker', '', 'idle', state)])[0]?.tabId)
        .toBeUndefined();
    }
  });

  it('requires an explicit retry fact before reusing an uncertain tab', () => {
    const uncertainTab = tab(1, 'worker', '', 'idle', 'uncertain');
    expect(planReadyDispatches([managed('a', 'worker')], [uncertainTab])[0]?.tabId).toBeUndefined();
    const retried = managed('a', 'worker');
    retried.task.retryAfterAttemptId = 'last-attempt';
    expect(planReadyDispatches([retried], [uncertainTab])).toEqual([{ taskId: 'a', tabId: 1 }]);
  });

});