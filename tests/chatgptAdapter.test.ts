import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  conversationKey,
  extractConversationId,
  normalizePageTitle,
  snapshotFromDocument,
} from '../src/chatgptAdapter';

describe('ChatGPT adapter identity', () => {
  it('extracts stable conversation ids only from /c/ routes', () => {
    expect(extractConversationId('https://chatgpt.com/c/abc-123')).toBe('abc-123');
    expect(extractConversationId('https://chatgpt.com/')).toBeUndefined();
    expect(conversationKey('https://chatgpt.com/c/a%20b')).toBe('conversation:a b');
  });

  it('normalizes the browser page title without inventing a role', () => {
    expect(normalizePageTitle('Worker 01 - ChatGPT')).toBe('Worker 01');
    expect(normalizePageTitle('ChatGPT')).toBe('ChatGPT');
  });
});

describe('ChatGPT adapter snapshots', () => {
  it('marks a ready composer idle and captures the latest assistant message', () => {
    const dom = new JSDOM(`<!doctype html><title>Role 02 - ChatGPT</title>
      <div data-message-author-role="assistant">first</div>
      <div data-message-author-role="assistant">latest result</div>
      <textarea id="prompt-textarea"></textarea>`);
    const snapshot = snapshotFromDocument(dom.window.document, 'https://chatgpt.com/c/session-2');
    expect(snapshot.status).toBe('idle');
    expect(snapshot.latestAssistantText).toBe('latest result');
    expect(snapshot.conversationId).toBe('session-2');
  });
  it('marks a page generating when the stop control is present', () => {
    const dom = new JSDOM(`<!doctype html><title>ChatGPT</title>
      <textarea id="prompt-textarea"></textarea>
      <button data-testid="stop-button"></button>`);
    const snapshot = snapshotFromDocument(dom.window.document, 'https://chatgpt.com/c/live');
    expect(snapshot.status).toBe('generating');
  });

  it('fails closed when no known composer exists', () => {
    const dom = new JSDOM('<!doctype html><title>ChatGPT</title><main>loading</main>');
    const snapshot = snapshotFromDocument(dom.window.document, 'https://chatgpt.com/');
    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.latestAssistantText).toBe('');
  });
});
