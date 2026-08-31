import { describe, expect, it } from 'vitest';
import { conversationLimitRetryTransition, hasBootstrapReplyMarkerEvidence, isConversationLimitSnapshot } from '../src/conversationRollover';
import type { ChatSnapshot, SendAttemptRecord } from '../src/contracts';

function snapshot(count = 3, direct = true): ChatSnapshot {
  return {
    conversationKey: 'conversation:old', title: 'ChatGPT', url: 'https://chatgpt.com/c/old',
    status: 'error', statusDetail: 'This conversation has reached the maximum length.',
    confidence: direct ? 'direct' : 'inferred', signals: ['conversation-limit', 'error-ui'],
    assistantMessageCount: count, latestAssistantText: 'tail', observedAt: 20,
  };
}

function attempt(state: SendAttemptRecord['state']): SendAttemptRecord {
  return {
    attemptId: 'a1', batchId: 'b1', tabId: 9, conversationKey: 'conversation:old',
    contentEpoch: 'epoch-1', state, textLength: 10, baselineAssistantMessageCount: 3,
    createdAt: 1, updatedAt: 2,
  };
}

describe('conversation rollover safety', () => {
  it('recognizes only direct conversation-limit snapshots', () => {
    expect(isConversationLimitSnapshot(snapshot())).toBe(true);
    expect(isConversationLimitSnapshot(snapshot(3, false))).toBe(false);
  });
  it('marks a directly rejected dispatched or acknowledged attempt failed', () => {
    expect(conversationLimitRetryTransition(attempt('dispatched'), snapshot(), 30)).toMatchObject({
      state: 'failed', updatedAt: 30,
    });
    expect(conversationLimitRetryTransition(attempt('acknowledged'), snapshot(), 31)).toMatchObject({
      state: 'failed', updatedAt: 31,
    });
  });

  it('never auto-retries when reply evidence advanced or the limit signal is not direct', () => {
    expect(conversationLimitRetryTransition(attempt('acknowledged'), snapshot(4), 30)).toBeUndefined();
    expect(conversationLimitRetryTransition(attempt('uncertain'), snapshot(), 30)).toBeUndefined();
    expect(conversationLimitRetryTransition(attempt('acknowledged'), snapshot(3, false), 30)).toBeUndefined();
  });

  it('accepts a bootstrap marker only from the canonical destination with new assistant evidence', () => {
    const a = { ...attempt('uncertain'), baselineAssistantMessageCount: 0 };
    const reply = { ...snapshot(1), conversationKey: 'conversation:new', status: 'generating' as const, latestAssistantMessageId: 'message:m1', latestAssistantText: 'GAM_ROLLOVER_READY\nContinuing.' };
    expect(hasBootstrapReplyMarkerEvidence(a, reply, 'conversation:new')).toBe(true);
    expect(hasBootstrapReplyMarkerEvidence(a, { ...reply, conversationKey: 'conversation:other' }, 'conversation:new')).toBe(false);
    const { latestAssistantMessageId: _ignoredMessageId, ...noMessageId } = reply;
    expect(hasBootstrapReplyMarkerEvidence(a, noMessageId, 'conversation:new')).toBe(false);
    expect(hasBootstrapReplyMarkerEvidence(a, { ...reply, assistantMessageCount: 0 }, 'conversation:new')).toBe(false);
    expect(hasBootstrapReplyMarkerEvidence(a, { ...reply, latestAssistantText: 'still working' }, 'conversation:new')).toBe(false);
  });
});