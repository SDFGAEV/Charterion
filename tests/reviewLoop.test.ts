import { describe, expect, it } from 'vitest';
import { applyReviewRemediation } from '../src/reviewLoop';
import { deriveManagedTasks } from '../src/taskGraph';
import type { AgentTask, SendAttemptRecord } from '../src/contracts';

function work(attemptId = 'work-a1'): AgentTask {
  return {
    id: 'work', kind: 'work', completionPolicy: 'reply', title: 'Work', project: '',
    instruction: 'implement', targetRole: 'worker', dependsOn: [], attemptIds: [attemptId],
    createdAt: 1, updatedAt: 1,
  };
}

function review(attemptIds = ['review-a1'], maxReviewRounds = 3): AgentTask {
  return {
    id: 'review', kind: 'review', completionPolicy: 'review-pass', title: 'Review', project: '',
    instruction: 'review', targetRole: 'reviewer', dependsOn: ['work'], attemptIds,
    reviewTargetTaskId: 'work', maxReviewRounds, createdAt: 1, updatedAt: 1,
  };
}

function attempt(id: string, taskId: string, reply: string): SendAttemptRecord {
  return {
    attemptId: id, batchId: 'batch', tabId: 1, conversationKey: `conversation:${taskId}`,
    contentEpoch: 'content-epoch',
    taskId, state: 'reply-observed', textLength: 1, baselineAssistantMessageCount: 0,
    replyTextTail: reply, createdAt: 1, updatedAt: 2,
  };
}
const FAIL = '<GAM_REVIEW>{"decision":"fail","reason":"bug","nextInstruction":"fix the bug"}</GAM_REVIEW>';

describe('bounded review loop', () => {
  it('turns a failed review into a producer revision followed by re-review', () => {
    const producer = work();
    const reviewer = review();
    const producerAttempt = attempt('work-a1', 'work', 'candidate');
    const reviewAttempt = attempt('review-a1', 'review', FAIL);
    const updated = applyReviewRemediation(reviewer, producer, reviewAttempt, producerAttempt, 10);

    expect(updated.targetTask.retryAfterAttemptId).toBe('work-a1');
    expect(updated.targetTask.revisionInstruction).toBe('fix the bug');
    expect(updated.reviewTask.retryAfterAttemptId).toBe('review-a1');

    const first = deriveManagedTasks([updated.targetTask, updated.reviewTask], [producerAttempt, reviewAttempt]);
    expect(first.map((item) => item.status)).toEqual(['ready', 'pending']);

    updated.targetTask.attemptIds.push('work-a2');
    const revised = attempt('work-a2', 'work', 'fixed candidate');
    const second = deriveManagedTasks([updated.targetTask, updated.reviewTask], [producerAttempt, reviewAttempt, revised]);
    expect(second.map((item) => item.status)).toEqual(['completed', 'ready']);
  });

  it('refuses remediation after the configured review bound is exhausted', () => {
    const producer = work();
    const reviewer = review(['review-a1', 'review-a2'], 2);
    const producerAttempt = attempt('work-a1', 'work', 'candidate');
    const reviewAttempt = attempt('review-a2', 'review', FAIL);
    expect(() => applyReviewRemediation(reviewer, producer, reviewAttempt, producerAttempt)).toThrow(/maximum/i);
    expect(deriveManagedTasks([producer, reviewer], [producerAttempt, reviewAttempt])[1]?.status).toBe('error');
  });
});
