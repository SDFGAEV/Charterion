import { describe, expect, it } from 'vitest';
import { controlFeedbackMessages } from '../src/controlFeedback';
import type { NativeControlSnapshot } from '../src/nativeControl';

function snapshot(): NativeControlSnapshot {
  return {
    protocolVersion: 2,
    projects: [{
      id: 'p1', name: 'Project', rootPath: 'E:/p', status: 'active',
      isolationTier: 'c0-host', minSlots: 0, maxSlots: 3, weight: 1,
    }],
    agents: [
      { id: 'worker-1', projectId: 'p1', role: 'ROLE01', status: 'assigned', desiredState: 'active', browserState: 'open', conversationGeneration: 1, rolloverState: 'idle', browserQuarantined: false, leaseEpoch: 1 },
      { id: 'supervisor-1', projectId: 'p1', role: 'SUPERVISOR', status: 'assigned', desiredState: 'active', browserState: 'open', conversationGeneration: 1, rolloverState: 'idle', browserQuarantined: false, leaseEpoch: 1 },
    ],
    resources: [], leases: [], browserRuntime: [], workerRequests: [], events: [],
    changeRequests: [{
      id: 'cr1', projectId: 'p1', taskId: 'task-1', authorSubject: 'worker-1',
      branch: 'task/1', targetBranch: 'main', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
      claimId: 'claim-1', revision: 1, status: 'changes-requested',
    }],
    reviews: [], mergeQueue: [],
  };
}

describe('Kernel feedback messages', () => {
  it('turns a changes-requested review into one deterministic Worker message', () => {
    const state = snapshot();
    state.reviews.push({
      id: 'review-1', projectId: 'p1', changeRequestId: 'cr1', reviewerSubject: 'supervisor-1',
      headSha: 'b'.repeat(40), verdict: 'request-changes', body: 'Fix the race.', createdAt: 50,
    });
    const messages = controlFeedbackMessages(state);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'control-review-feedback:review-1', fromRole: 'SUPERVISOR',
      target: { kind: 'role', role: 'ROLE01' }, type: 'review-result', taskId: 'task-1',
    });
    expect(messages[0]?.content).toContain('Fix the race.');
    expect(controlFeedbackMessages(state, new Set([messages[0]!.id]))).toEqual([]);
  });

  it('turns a failed merge candidate into an actionable blocker', () => {
    const state = snapshot();
    state.mergeQueue.push({
      id: 'queue-1', projectId: 'p1', changeRequestId: 'cr1', headSha: 'b'.repeat(40),
      targetBranch: 'main', status: 'failed', queuedAt: 40, updatedAt: 60, error: 'merge conflict',
    });
    const messages = controlFeedbackMessages(state);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'control-merge-failure:queue-1', fromRole: 'SUPERVISOR',
      target: { kind: 'role', role: 'ROLE01' }, type: 'blocker', taskId: 'task-1',
    });
    expect(messages[0]?.content).toContain('merge conflict');
  });

  it('does not guess a Worker identity from a conversation address or role text', () => {
    const state = snapshot();
    state.changeRequests[0]!.authorSubject = 'unknown-subject';
    state.reviews.push({
      id: 'review-2', projectId: 'p1', changeRequestId: 'cr1', reviewerSubject: 'supervisor-1',
      headSha: 'b'.repeat(40), verdict: 'request-changes', body: 'Fix it.', createdAt: 50,
    });
    expect(controlFeedbackMessages(state)).toEqual([]);
  });
});
