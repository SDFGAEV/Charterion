import { describe, expect, it } from 'vitest';
import { planReadyDispatches } from '../src/supervisor';
import type { AgentTask, ManagedTab, ManagedTask } from '../src/contracts';

function task(id: string, role: string, project = ''): AgentTask {
  return { id, kind: 'work', title: id, project, instruction: id, targetRole: role, dependsOn: [], attemptIds: [], createdAt: 1, updatedAt: 1 };
}

function managed(id: string, role: string, status: ManagedTask['status'] = 'ready', project = ''): ManagedTask {
  return { task: task(id, role, project), status };
}

function tab(tabId: number, role: string, project = '', status: ManagedTab['snapshot']['status'] = 'idle'): ManagedTab {
  return {
    tabId, windowId: 1, active: false,
    binding: { role, project, notes: '' },
    snapshot: {
      conversationKey: `conversation:${tabId}`, title: role, url: `https://chatgpt.com/c/${tabId}`,
      status, confidence: 'direct', signals: [], assistantMessageCount: 0, latestAssistantText: '', observedAt: 1,
    },
  };
}

describe('supervisor dispatch planning', () => {
  it('routes one ready task to one exact idle role', () => {
    expect(planReadyDispatches([managed('a', 'worker')], [tab(1, 'worker')]))
      .toEqual([{ taskId: 'a', tabId: 1 }]);
  });

  it('fails closed when role routing is ambiguous', () => {
    const [decision] = planReadyDispatches([managed('a', 'worker')], [tab(1, 'worker'), tab(2, 'worker')]);
    expect(decision?.tabId).toBeUndefined();
    expect(decision?.error).toMatch(/Multiple/);
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

  it('ignores non-ready tasks and non-idle tabs', () => {
    expect(planReadyDispatches([managed('a', 'worker', 'pending')], [tab(1, 'worker')])).toEqual([]);
    expect(planReadyDispatches([managed('a', 'worker')], [tab(1, 'worker', '', 'generating')])[0]?.error).toMatch(/No idle/);
  });
});