import { describe, expect, it } from 'vitest';
import { advanceAttempt, canAdvanceAttempt } from '../src/attempts';
import type { SendAttemptRecord } from '../src/contracts';

function record(state: SendAttemptRecord['state']): SendAttemptRecord {
  return {
    attemptId: 'a1',
    batchId: 'b1',
    tabId: 1,
    conversationKey: 'conversation:c1',
    state,
    textLength: 10,
    baselineAssistantMessageCount: 3,
    baselineAssistantMessageId: 'message:m3',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('send attempt state machine', () => {
  it('allows the normal durable delivery path', () => {
    expect(canAdvanceAttempt('prepared', 'dispatched')).toBe(true);
    expect(canAdvanceAttempt('dispatched', 'acknowledged')).toBe(true);
    expect(canAdvanceAttempt('acknowledged', 'reply-observed')).toBe(true);
  });

  it('does not downgrade a reply-observed attempt on a late acknowledgement', () => {
    const completed = record('reply-observed');
    expect(advanceAttempt(completed, 'acknowledged')).toBe(completed);
  });

  it('lets direct reply evidence resolve an uncertain transport outcome', () => {
    const uncertain = record('uncertain');
    expect(advanceAttempt(uncertain, 'reply-observed', 20).state).toBe('reply-observed');
  });

  it('keeps explicit pre-send failures terminal', () => {
    const failed = record('failed');
    expect(advanceAttempt(failed, 'reply-observed')).toBe(failed);
  });
});