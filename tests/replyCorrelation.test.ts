import { describe, expect, it } from 'vitest';
import { hasNewAssistantReply } from '../src/replyCorrelation';
import type { ChatSnapshot } from '../src/contracts';

function snapshot(overrides: Partial<ChatSnapshot> = {}): ChatSnapshot {
  return {
    conversationKey: 'conversation:c1',
    title: 'ChatGPT',
    url: 'https://chatgpt.com/c/c1',
    status: 'idle',
    confidence: 'direct',
    signals: ['composer-ready'],
    assistantMessageCount: 3,
    latestAssistantMessageId: 'message:m3',
    latestAssistantText: 'same answer',
    observedAt: 1,
    ...overrides,
  };
}

describe('reply correlation', () => {
  it('accepts a new message id even when the reply text repeats', () => {
    expect(hasNewAssistantReply(snapshot({ latestAssistantMessageId: 'message:m4' }), {
      assistantMessageCount: 3,
      latestAssistantMessageId: 'message:m3',
    })).toBe(true);
  });

  it('falls back to assistant count when no stable message id exists', () => {
    const withoutId = snapshot({ assistantMessageCount: 4 });
    delete withoutId.latestAssistantMessageId;
    expect(hasNewAssistantReply(withoutId, {
      assistantMessageCount: 3,
    })).toBe(true);
  });

  it('rejects historical latest replies when identity and count did not advance', () => {
    expect(hasNewAssistantReply(snapshot(), {
      assistantMessageCount: 3,
      latestAssistantMessageId: 'message:m3',
    })).toBe(false);
  });

  it('does not finalize while ChatGPT is still generating', () => {
    expect(hasNewAssistantReply(snapshot({ status: 'generating', latestAssistantMessageId: 'message:m4' }), {
      assistantMessageCount: 3,
      latestAssistantMessageId: 'message:m3',
    })).toBe(false);
  });
});