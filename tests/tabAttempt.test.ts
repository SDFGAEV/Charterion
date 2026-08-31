import { describe, expect, it } from 'vitest';
import { attemptBelongsToTab } from '../src/tabAttempt';
import type { ChatSnapshot, SendAttemptRecord } from '../src/contracts';

function attempt(tabId: number, conversationKey: string): SendAttemptRecord {
  return {
    attemptId: `a-${tabId}-${conversationKey}`,
    batchId: 'b',
    tabId,
    conversationKey,
    contentEpoch: 'content-epoch',
    state: 'acknowledged',
    textLength: 1,
    baselineAssistantMessageCount: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function snapshot(tabKey: string, conversationId?: string): ChatSnapshot {
  const value: ChatSnapshot = {
    conversationKey: tabKey,
    title: 'ChatGPT',
    url: 'https://chatgpt.com/',
    status: 'idle',
    confidence: 'direct',
    signals: ['composer-ready'],
    assistantMessageCount: 0,
    latestAssistantText: '',
    observedAt: 1,
  };
  if (conversationId) value.conversationId = conversationId;
  return value;
}

describe('tab attempt identity', () => {
  it('does not alias two new-chat tabs that share the same URL key', () => {
    const newChat = snapshot('url:https://chatgpt.com/');
    expect(attemptBelongsToTab(attempt(1, 'url:https://chatgpt.com/'), 1, newChat)).toBe(true);
    expect(attemptBelongsToTab(attempt(1, 'url:https://chatgpt.com/'), 2, newChat)).toBe(false);
  });

  it('reconnects durable conversation attempts after the conversation moves to another tab', () => {
    const durable = snapshot('conversation:abc', 'abc');
    expect(attemptBelongsToTab(attempt(1, 'conversation:abc'), 99, durable)).toBe(true);
  });

  it('keeps an in-flight new-chat attempt attached after the same tab gains a durable conversation id', () => {
    const durable = snapshot('conversation:new-id', 'new-id');
    expect(attemptBelongsToTab(attempt(7, 'url:https://chatgpt.com/'), 7, durable)).toBe(true);
  });
});
