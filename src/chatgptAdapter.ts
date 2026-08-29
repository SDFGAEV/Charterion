import type { AgentStatus, ChatSnapshot } from './contracts';

const COMPOSER_SELECTORS = [
  '#prompt-textarea',
  '[data-testid="prompt-textarea"]',
  'textarea[placeholder*="Message"]',
];

const SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label="Send message"]',
];

const STOP_BUTTON_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop generating"]',
  'button[aria-label="Stop streaming"]',
];

export function extractConversationId(url: string): string | undefined {
  try {
    const match = new URL(url).pathname.match(/^\/c\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

export function normalizePageTitle(title: string): string {
  return title
    .replace(/\s*[|-]\s*ChatGPT\s*$/i, '')
    .replace(/^ChatGPT\s*[|-]\s*/i, '')
    .trim() || 'ChatGPT';
}

export function conversationKey(url: string): string {
  const id = extractConversationId(url);
  return id ? `conversation:${id}` : `url:${url}`;
}

export function findComposer(doc: Document): HTMLElement | null {
  for (const selector of COMPOSER_SELECTORS) {
    const node = doc.querySelector<HTMLElement>(selector);
    if (node && !node.hasAttribute('disabled')) return node;
  }
  return null;
}

export function findSendButton(doc: Document): HTMLButtonElement | null {
  for (const selector of SEND_BUTTON_SELECTORS) {
    const button = doc.querySelector<HTMLButtonElement>(selector);
    if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
      return button;
    }
  }
  return null;
}

export function isGenerating(doc: Document): boolean {
  return STOP_BUTTON_SELECTORS.some((selector) => doc.querySelector(selector) !== null);
}

export function latestAssistantText(doc: Document): string {
  const candidates = Array.from(
    doc.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]'),
  );
  const latest = candidates.at(-1);
  return latest?.innerText?.trim() ?? latest?.textContent?.trim() ?? '';
}

export function setComposerText(composer: HTMLElement, text: string): void {
  composer.focus();
  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
    const prototype = composer instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(composer, text);
  } else {
    composer.textContent = text;
  }
  composer.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: text,
  }));
}

export function snapshotFromDocument(doc: Document, url: string): ChatSnapshot {
  const status: AgentStatus = findComposer(doc)
    ? (isGenerating(doc) ? 'generating' : 'idle')
    : 'unavailable';
  const id = extractConversationId(url);
  const snapshot: ChatSnapshot = {
    conversationKey: conversationKey(url),
    title: normalizePageTitle(doc.title),
    url,
    status,
    latestAssistantText: latestAssistantText(doc).slice(-12000),
    observedAt: Date.now(),
  };
  if (id) snapshot.conversationId = id;
  return snapshot;
}

export async function waitForSendButton(doc: Document, timeoutMs = 1500): Promise<HTMLButtonElement> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const button = findSendButton(doc);
    if (button) return button;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('ChatGPT send button did not become available');
}

export async function sendPrompt(doc: Document, text: string): Promise<void> {
  if (!text.trim()) throw new Error('Refusing to send an empty instruction');
  const composer = findComposer(doc);
  if (!composer) throw new Error('ChatGPT composer is unavailable');
  setComposerText(composer, text);
  const button = await waitForSendButton(doc);
  button.click();
}
