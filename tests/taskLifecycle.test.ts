import { describe, expect, it } from 'vitest';
import { applyTaskDisposition, canCancelTask, canSkipTask } from '../src/taskLifecycle';
import type { AgentTask } from '../src/contracts';

function task(): AgentTask {
  return { id: 'a', kind: 'work', completionPolicy: 'reply', title: 'A', project: '', instruction: 'do A', targetRole: 'worker', dependsOn: [], attemptIds: [], createdAt: 1, updatedAt: 1 };
}

describe('task lifecycle facts', () => {
  it('records skip without deleting task history', () => {
    const original = task(); original.attemptIds = ['old-attempt'];
    const skipped = applyTaskDisposition(original, 'attention', 'skip', 10, 'not needed');
    expect(skipped.skippedAt).toBe(10);
    expect(skipped.skipReason).toBe('not needed');
    expect(skipped.attemptIds).toEqual(['old-attempt']);
  });

  it('does not skip a running or already-finalized task', () => {
    expect(canSkipTask('running')).toBe(false);
    expect(() => applyTaskDisposition(task(), 'running', 'skip')).toThrow(/cannot be skipped/);
    expect(canSkipTask('completed')).toBe(false);
  });

  it('allows cancelling a running orchestration without claiming its browser attempt stopped', () => {
    const original = task(); original.attemptIds = ['live-attempt'];
    const cancelled = applyTaskDisposition(original, 'running', 'cancel', 20);
    expect(cancelled.cancelledAt).toBe(20);
    expect(cancelled.attemptIds).toEqual(['live-attempt']);
  });

  it('does not cancel completed, skipped, or cancelled tasks', () => {
    for (const state of ['completed', 'skipped', 'cancelled'] as const) expect(canCancelTask(state)).toBe(false);
  });
});


describe('human decision nodes', () => {
  it('records an explicit approve/reject fact only while waiting for human input', async () => {
    const { applyHumanDecision } = await import('../src/taskLifecycle');
    const human: AgentTask = {
      id: 'human', kind: 'human', completionPolicy: 'human-approval', title: 'Approve', project: '',
      instruction: 'Approve the release?', targetRole: '', dependsOn: [], attemptIds: [], createdAt: 1, updatedAt: 1,
    };
    const approved = applyHumanDecision(human, 'waiting-human', 'approve', 30, 'looks good');
    expect(approved.humanDecision).toEqual({ decision: 'approve', reason: 'looks good', decidedAt: 30 });
    expect(() => applyHumanDecision(human, 'pending', 'approve')).toThrow(/cannot be decided/);
  });
});
