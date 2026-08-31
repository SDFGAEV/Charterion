import type { AgentStatus, ChatSnapshot, ObservationConfidence } from './contracts';

export const CHATGPT_ADAPTER_VERSION = '2026-08-30.2';

const COMPOSER_SELECTORS = [
  'form[data-type="unified-composer"] #prompt-textarea[contenteditable="true"]',
  '#prompt-textarea[contenteditable="true"]',
  '#prompt-textarea',
  'textarea#mobile-composer-prompt',
  '[data-testid="prompt-textarea"]',
  'textarea[placeholder*="Message"]',
];
const SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[data-composer-submit]',
  'button[aria-label="Send prompt"]',
  'button[aria-label="Send message"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="发送"]',
  'button[aria-label*="提交"]',
];
const STOP_BUTTON_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop generating"]',
  'button[aria-label="Stop streaming"]',
  'button[aria-label*="Stop"]',
  'button[aria-label*="停止"]',
  'button[aria-label*="中止"]',
];
const ACTIVITY_SELECTORS = [
  '.result-streaming[aria-busy="true"]',
  '[aria-busy="true"] .result-streaming',
  '[data-testid*="thinking"]',
  '[data-testid*="reasoning"]',
];
const ERROR_SELECTORS = ['.error-message', '[data-testid="error-message"]', '[role="alert"] .text-red-500'];
const BLOCKED_SELECTORS = ['.cloudflare-challenge', '[data-testid="access-denied"]'];
const AUTH_REQUIRED_SELECTORS = [
  'button[data-mobile-auth-entry-action="login"]',
  '#mobile-auth-email',
  'input[name="login_hint"]',
];

export function extractConversationId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const direct = parsed.pathname.match(/^\/c\/([^/?#]+)/)?.[1];
    const customGpt = parsed.pathname.match(/^\/g\/[^/]+\/c\/([^/?#]+)/)?.[1];
    const value = direct ?? customGpt;
    if (!value) return undefined;
    const decoded = decodeURIComponent(value);
    return decoded !== 'new' && !/^WEB:/i.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

export function normalizePageTitle(title: string): string {
  return title.replace(/\s*[|-]\s*ChatGPT\s*$/i, '').replace(/^ChatGPT\s*[|-]\s*/i, '').trim() || 'ChatGPT';
}

export function conversationKey(url: string): string {
  const id = extractConversationId(url);
  return id ? `conversation:${id}` : `url:${url}`;
}

function isUsableElement(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  const html = element as HTMLElement;
  if (html.style.display === 'none' || html.style.visibility === 'hidden' || html.style.pointerEvents === 'none') return false;
  return true;
}

export function findComposer(doc: Document): HTMLElement | null {
  for (const selector of COMPOSER_SELECTORS) {
    const node = doc.querySelector<HTMLElement>(selector);
    if (node && isUsableElement(node) && !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true') return node;
  }
  return null;
}

export function findSendButton(doc: Document): HTMLButtonElement | null {
  for (const selector of SEND_BUTTON_SELECTORS) {
    const button = doc.querySelector<HTMLButtonElement>(selector);
    if (button && isUsableElement(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true') return button;
  }
  return null;
}

export function isGenerating(doc: Document): boolean {
  return [...STOP_BUTTON_SELECTORS, ...ACTIVITY_SELECTORS].some((selector) => {
    const element = doc.querySelector(selector);
    return element !== null && isUsableElement(element);
  });
}

export function assistantMessages(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]'));
}

export function assistantMessageId(message: HTMLElement | undefined): string | undefined {
  if (!message) return undefined;
  const direct = message.getAttribute('data-message-id');
  if (direct) return `message:${direct}`;
  const identifiedAncestor = message.closest<HTMLElement>('[data-message-id]');
  if (identifiedAncestor?.dataset.messageId) return `message:${identifiedAncestor.dataset.messageId}`;
  const turn = message.closest<HTMLElement>('[data-testid^="conversation-turn-"], [data-turn-id]');
  const turnId = turn?.getAttribute('data-turn-id') ?? turn?.getAttribute('data-testid');
  return turnId ? `turn:${turnId}` : undefined;
}

export function latestAssistantText(doc: Document): string {
  const latest = assistantMessages(doc).at(-1);
  return latest?.innerText?.trim() ?? latest?.textContent?.trim() ?? '';
}

interface StatusObservation {
  status: AgentStatus;
  confidence: ObservationConfidence;
  signals: string[];
  detail?: string;
}

export function observePageStatus(doc: Document, url: string): StatusObservation {
  const signals: string[] = [];
  let path = '';
  try { path = new URL(url).pathname; } catch { /* keep unknown path */ }

  const blocked = BLOCKED_SELECTORS.map((selector) => doc.querySelector(selector)).find((element) => Boolean(element && isUsableElement(element)));
  if (doc.title.includes('Access Denied') || blocked) {
    return { status: 'blocked', confidence: 'direct', signals: ['blocked-ui'], detail: 'Access denied or browser challenge detected' };
  }
  if (path.includes('/auth/login') || path === '/login' || path.startsWith('/login/')) {
    return { status: 'unauthorized', confidence: 'direct', signals: ['login-route'], detail: 'ChatGPT login page detected' };
  }
  const authRequired = AUTH_REQUIRED_SELECTORS.map((selector) => doc.querySelector(selector)).find((element) => Boolean(element && isUsableElement(element)));
  if (authRequired) {
    return { status: 'unauthorized', confidence: 'direct', signals: ['login-ui'], detail: 'ChatGPT authentication UI detected' };
  }
  const error = ERROR_SELECTORS.map((selector) => doc.querySelector<HTMLElement>(selector)).find((element) => Boolean(element && isUsableElement(element)));
  if (error) {
    const detail = error.textContent?.trim() || 'ChatGPT error UI detected';
    return { status: 'error', confidence: 'direct', signals: ['error-ui'], detail };
  }
  if (isGenerating(doc)) {
    return { status: 'generating', confidence: 'direct', signals: ['generation-indicator'] };
  }
  if (findComposer(doc)) {
    signals.push('composer-ready');
    return { status: 'idle', confidence: 'direct', signals };
  }
  return { status: 'unknown', confidence: 'unknown', signals, detail: 'No trusted ChatGPT readiness signal is visible' };
}

export function readComposerText(composer: HTMLElement): string {
  if (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT') return (composer as HTMLInputElement).value.trim();
  const raw = composer.innerText || composer.textContent || '';
  return raw.replace(/\u00a0/g, ' ').trim();
}

function dispatchEditorEvent(composer: HTMLElement, type: 'beforeinput' | 'input', text: string): void {
  const view = composer.ownerDocument.defaultView;
  const InputEventCtor = view?.InputEvent ?? InputEvent;
  composer.dispatchEvent(new InputEventCtor(type, { bubbles: true, inputType: 'insertText', data: text }));
}

export function setComposerText(composer: HTMLElement, text: string): void {
  composer.focus();
  if (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT') {
    const prototype = Object.getPrototypeOf(composer) as object;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(composer, text);
  } else {
    composer.replaceChildren();
    const block = composer.ownerDocument.createElement('p');
    block.textContent = text;
    composer.append(block);
  }
  dispatchEditorEvent(composer, 'beforeinput', text);
  dispatchEditorEvent(composer, 'input', text);
  const EventCtor = composer.ownerDocument.defaultView?.Event ?? Event;
  composer.dispatchEvent(new EventCtor('change', { bubbles: true }));
}

export function snapshotFromDocument(doc: Document, url: string): ChatSnapshot {
  const observation = observePageStatus(doc, url);
  const id = extractConversationId(url);
  const assistants = assistantMessages(doc);
  const latestAssistant = assistants.at(-1);
  const snapshot: ChatSnapshot = {
    conversationKey: conversationKey(url),
    title: normalizePageTitle(doc.title),
    url,
    status: observation.status,
    confidence: observation.confidence,
    signals: observation.signals,
    assistantMessageCount: assistants.length,
    latestAssistantText: (latestAssistant?.innerText?.trim() ?? latestAssistant?.textContent?.trim() ?? '').slice(-12000),
    observedAt: Date.now(),
  };
  const latestMessageId = assistantMessageId(latestAssistant);
  if (latestMessageId) snapshot.latestAssistantMessageId = latestMessageId;
  if (observation.detail) snapshot.statusDetail = observation.detail;
  if (id) snapshot.conversationId = id;
  return snapshot;
}

export function snapshotSemanticKey(snapshot: ChatSnapshot): string {
  return JSON.stringify({
    conversationKey: snapshot.conversationKey,
    title: snapshot.title,
    url: snapshot.url,
    status: snapshot.status,
    statusDetail: snapshot.statusDetail ?? '',
    confidence: snapshot.confidence,
    signals: snapshot.signals,
    assistantMessageCount: snapshot.assistantMessageCount,
    latestAssistantMessageId: snapshot.latestAssistantMessageId ?? '',
    latestAssistantText: snapshot.latestAssistantText,
  });
}

export async function waitForSendButton(doc: Document, timeoutMs = 9000): Promise<HTMLButtonElement> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const button = findSendButton(doc);
    if (button) return button;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('ChatGPT send button did not become available');
}

export type PromptSubmissionOutcome = 'proved-not-started' | 'uncertain';

export class PromptSubmissionError extends Error {
  constructor(message: string, readonly outcome: PromptSubmissionOutcome) {
    super(message);
    this.name = 'PromptSubmissionError';
  }
}

export async function sendPrompt(doc: Document, text: string, acceptanceTimeoutMs = 7000): Promise<void> {
  if (!text.trim()) throw new PromptSubmissionError('Refusing to send an empty instruction', 'proved-not-started');
  const composer = findComposer(doc);
  if (!composer) throw new PromptSubmissionError('ChatGPT composer is unavailable', 'proved-not-started');
  const beforeUrl = doc.defaultView?.location.href ?? '';
  const beforeAssistantCount = assistantMessages(doc).length;
  setComposerText(composer, text);
  if (readComposerText(composer) !== text.trim()) throw new PromptSubmissionError('ChatGPT editor did not accept the prompt text', 'proved-not-started');
  let button: HTMLButtonElement;
  try { button = await waitForSendButton(doc); }
  catch (error) { throw new PromptSubmissionError(error instanceof Error ? error.message : String(error), 'proved-not-started'); }
  try { button.click(); }
  catch (error) { throw new PromptSubmissionError(error instanceof Error ? error.message : String(error), 'uncertain'); }
  const deadline = Date.now() + acceptanceTimeoutMs;
  while (Date.now() < deadline) {
    const urlChanged = Boolean(beforeUrl && doc.defaultView?.location.href && doc.defaultView.location.href !== beforeUrl);
    const composerCleared = readComposerText(composer) === '';
    const generationStarted = isGenerating(doc);
    const assistantAdvanced = assistantMessages(doc).length > beforeAssistantCount;
    if (urlChanged || composerCleared || generationStarted || assistantAdvanced) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new PromptSubmissionError('ChatGPT did not confirm prompt submission', 'uncertain');
}