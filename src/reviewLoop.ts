import { parseReviewResult } from './review';
import { DEFAULT_MAX_REVIEW_ROUNDS } from './taskPolicy';
import type { AgentTask, SendAttemptRecord } from './contracts';

export interface ReviewLoopUpdate {
  reviewTask: AgentTask;
  targetTask: AgentTask;
}

export function applyReviewRemediation(
  reviewTask: AgentTask,
  targetTask: AgentTask,
  reviewAttempt: SendAttemptRecord,
  targetAttempt: SendAttemptRecord,
  now = Date.now(),
): ReviewLoopUpdate {
  if (reviewTask.kind !== 'review') throw new Error('Task is not a review task');
  if (reviewTask.reviewTargetTaskId !== targetTask.id) throw new Error('Review target does not match the selected task');
  if (reviewAttempt.state !== 'reply-observed') throw new Error('Review attempt has no completed reply');
  if (targetAttempt.state !== 'reply-observed') throw new Error('Review target has no completed reply');
  if (reviewTask.attemptIds.at(-1) !== reviewAttempt.attemptId) throw new Error('Review attempt is stale');
  if (targetTask.attemptIds.at(-1) !== targetAttempt.attemptId) throw new Error('Review target attempt is stale');
  const parsed = parseReviewResult(reviewAttempt.replyTextTail ?? '');
  if (!parsed.ok || parsed.result.decision !== 'fail') throw new Error('Only an explicit failed review can request remediation');
  const maxRounds = reviewTask.maxReviewRounds ?? DEFAULT_MAX_REVIEW_ROUNDS;
  if (reviewTask.attemptIds.length >= maxRounds) throw new Error('Review loop has reached its maximum number of rounds');

  return {
    reviewTask: {
      ...reviewTask,
      retryAfterAttemptId: reviewAttempt.attemptId,
      updatedAt: now,
    },
    targetTask: {
      ...targetTask,
      retryAfterAttemptId: targetAttempt.attemptId,
      revisionInstruction: parsed.result.nextInstruction,
      revisionFromReviewAttemptId: reviewAttempt.attemptId,
      updatedAt: now,
    },
  };
}
