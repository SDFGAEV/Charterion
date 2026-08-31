import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  conversationKey,
  extractConversationId,
  normalizePageTitle,
  observePageStatus,
  findSendButton,
  readComposerText,
  sendPrompt,
  setComposerText,
  snapshotFromDocument,
  snapshotSemanticKey,
} from '../src/chatgptAdapter';

describe('ChatGPT adapter identity', () => {
  it('extracts direct and custom-GPT conversation ids', () => {
    expect(extractConversationId('https://chatgpt.com/c/abc-123')).toBe('abc-123');
    expect(extractConversationId('https://chatgpt.com/g/g-123-helper/c/custom-1')).toBe('custom-1');
    expect(extractConversationId('https://chatgpt.com/')).toBeUndefined();
    expect(conversationKey('https://chatgpt.com/c/a%20b')).toBe('conversation:a b');
    expect(extractConversationId('https://chatgpt.com/c/WEB:temporary-1')).toBeUndefined();
    expect(extractConversationId('https://chatgpt.com/c/WEB%3Atemporary-2')).toBeUndefined();
    expect(conversationKey('https://chatgpt.com/c/WEB:temporary-1')).toBe('url:https://chatgpt.com/c/WEB:temporary-1');
  });

  it('normalizes the browser page title without inventing a role', () => {
    expect(normalizePageTitle('Worker 01 - ChatGPT')).toBe('Worker 01');
    expect(normalizePageTitle('ChatGPT')).toBe('ChatGPT');
  });
});

describe('ChatGPT page observation', () => {
  it('marks a ready composer idle and captures the latest assistant message', () => {
    const dom = new JSDOM(`<!doctype html><title>Role 02 - ChatGPT</title>
      <div data-message-author-role="assistant" data-message-id="m1">first</div>
      <div data-message-author-role="assistant" data-message-id="m2">latest result</div>
      <textarea id="prompt-textarea"></textarea>`);
    const snapshot = snapshotFromDocument(dom.window.document, 'https://chatgpt.com/c/session-2');
    expect(snapshot.status).toBe('idle');
    expect(snapshot.confidence).toBe('direct');
    expect(snapshot.signals).toContain('composer-ready');
    expect(snapshot.assistantMessageCount).toBe(2);
    expect(snapshot.latestAssistantMessageId).toBe('message:m2');
    expect(snapshot.latestAssistantText).toBe('latest result');
  });

  it('uses direct generation indicators instead of composer presence', () => {
    const dom = new JSDOM(`<!doctype html><title>ChatGPT</title>
      <textarea id="prompt-textarea"></textarea><button data-testid="stop-button"></button>`);
    expect(observePageStatus(dom.window.document, 'https://chatgpt.com/c/live').status).toBe('generating');
  });

  it('detects conversation exhaustion only on direct error surfaces', () => {
    const exhausted = new JSDOM('<!doctype html><title>ChatGPT</title><div role="alert">This conversation has reached the maximum length. Start a new chat to continue.</div><textarea id="prompt-textarea"></textarea>');
    const observed = observePageStatus(exhausted.window.document, 'https://chatgpt.com/c/full');
    expect(observed).toMatchObject({ status: 'error', confidence: 'direct' });
    expect(observed.signals).toContain('conversation-limit');

    const ordinaryText = new JSDOM('<!doctype html><title>ChatGPT</title><main>This conversation has reached the maximum length.</main><textarea id="prompt-textarea"></textarea>');
    const ordinary = observePageStatus(ordinaryText.window.document, 'https://chatgpt.com/c/not-full');
    expect(ordinary.status).toBe('idle');
    expect(ordinary.signals).not.toContain('conversation-limit');
  });

  it('detects message-rate limits only on direct error surfaces', () => {
    const limited = new JSDOM('<!doctype html><title>ChatGPT</title><div role="alert">Too many messages. Please try again later.</div><textarea id="prompt-textarea"></textarea>');
    const observed = observePageStatus(limited.window.document, 'https://chatgpt.com/c/rate');
    expect(observed).toMatchObject({ status: 'error', confidence: 'direct' });
    expect(observed.signals).toContain('message-rate-limit');

    const chinese = new JSDOM('<!doctype html><title>ChatGPT</title><div role="alert">消息过多，请稍后再试。</div><textarea id="prompt-textarea"></textarea>');
    expect(observePageStatus(chinese.window.document, 'https://chatgpt.com/c/rate-cn').signals).toContain('message-rate-limit');

    const ordinaryText = new JSDOM('<!doctype html><title>ChatGPT</title><main>We should avoid too many messages.</main><textarea id="prompt-textarea"></textarea>');
    const ordinary = observePageStatus(ordinaryText.window.document, 'https://chatgpt.com/c/ordinary');
    expect(ordinary.status).toBe('idle');
    expect(ordinary.signals).not.toContain('message-rate-limit');
  });

  it('classifies access, login, and explicit error surfaces before readiness', () => {
    const blocked = new JSDOM('<!doctype html><title>Access Denied</title><main></main>');
    expect(observePageStatus(blocked.window.document, 'https://chatgpt.com/').status).toBe('blocked');

    const login = new JSDOM('<!doctype html><title>ChatGPT</title>');
    expect(observePageStatus(login.window.document, 'https://chatgpt.com/auth/login').status).toBe('unauthorized');

    const errored = new JSDOM('<!doctype html><title>ChatGPT</title><div class="error-message">Try again</div>');
    const observation = observePageStatus(errored.window.document, 'https://chatgpt.com/c/x');
    expect(observation.status).toBe('error');
    expect(observation.detail).toBe('Try again');
  });

  it('fails closed to unknown when the content script has no trusted readiness signal', () => {
    const dom = new JSDOM('<!doctype html><title>ChatGPT</title><main>loading</main>');
    const snapshot = snapshotFromDocument(dom.window.document, 'https://chatgpt.com/');
    expect(snapshot.status).toBe('unknown');
    expect(snapshot.confidence).toBe('unknown');
  });

  it('does not treat observedAt-only changes as semantic state changes', () => {
    const dom = new JSDOM('<!doctype html><title>ChatGPT</title><textarea id="prompt-textarea"></textarea>');
    const first = snapshotFromDocument(dom.window.document, 'https://chatgpt.com/c/a');
    const second = { ...first, observedAt: first.observedAt + 10_000 };
    expect(snapshotSemanticKey(first)).toBe(snapshotSemanticKey(second));
  });

  it('writes ChatGPT contenteditable composers using editor-style input events', () => {
    const dom = new JSDOM('<!doctype html><div id="prompt-textarea" contenteditable="true"></div>');
    const editor = dom.window.document.querySelector<HTMLElement>('#prompt-textarea')!;
    const events: string[] = [];
    for (const type of ['beforeinput', 'input', 'change']) editor.addEventListener(type, () => events.push(type));
    setComposerText(editor, 'hello world');
    expect(readComposerText(editor)).toBe('hello world');
    expect(editor.querySelector('p')?.textContent).toBe('hello world');
    expect(events).toEqual(['beforeinput', 'input', 'change']);
  });

  it('ignores hidden stop controls and recognizes localized send controls', () => {
    const dom = new JSDOM(`<!doctype html>
      <textarea id="prompt-textarea"></textarea>
      <button data-testid="stop-button" style="display:none"></button>
      <button aria-label="发送消息"></button>`);
    expect(observePageStatus(dom.window.document, 'https://chatgpt.com/c/x').status).toBe('idle');
    expect(findSendButton(dom.window.document)).not.toBeNull();
  });

  it('requires observable submission evidence before acknowledging a prompt', async () => {
    const accepted = new JSDOM(`<!doctype html><form><textarea id="prompt-textarea"></textarea><button type="submit" data-composer-submit></button></form>`, { url: 'https://chatgpt.com/' });
    const acceptedComposer = accepted.window.document.querySelector<HTMLTextAreaElement>('#prompt-textarea')!;
    accepted.window.document.querySelector('button')!.addEventListener('click', (event) => { event.preventDefault(); acceptedComposer.value = ''; });
    await expect(sendPrompt(accepted.window.document, 'hello', 100)).resolves.toBeUndefined();

    const rejected = new JSDOM(`<!doctype html><form><textarea id="prompt-textarea"></textarea><button type="submit" data-composer-submit></button></form>`, { url: 'https://chatgpt.com/' });
    rejected.window.document.querySelector('button')!.addEventListener('click', (event) => event.preventDefault());
    await expect(sendPrompt(rejected.window.document, 'hello', 80)).rejects.toThrow(/did not confirm prompt submission/i);
  });
});