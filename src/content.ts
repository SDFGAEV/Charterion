import { sendPrompt, snapshotFromDocument, snapshotSemanticKey } from './chatgptAdapter';
import { hasNewAssistantReply } from './replyCorrelation';
import type { ContentRequest, RuntimeNotice } from './contracts';

const DELIVERED_ATTEMPTS_KEY = 'gpt-agent-manager.delivered-attempts.v1';
const PENDING_PROMPT_KEY = 'gpt-agent-manager.pending-prompt.v1';
const MAX_DELIVERED_ATTEMPTS = 100;
let lastSemanticKey = '';
let publishTimer: number | undefined;
const inflightAttempts = new Set<string>();
const deliveredInMemory = new Set<string>();

interface PendingPrompt {
  attemptId: string;
  baselineAssistantMessageCount: number;
  baselineAssistantMessageId?: string;
  startedAt: number;
}

function snapshot() {
  return snapshotFromDocument(document, location.href);
}

function deliveredAttempts(): string[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(DELIVERED_ATTEMPTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch { return []; }
}

function wasDelivered(attemptId: string): boolean {
  return deliveredInMemory.has(attemptId) || deliveredAttempts().includes(attemptId);
}

function rememberDelivered(attemptId: string): void {
  deliveredInMemory.add(attemptId);
  const next = [...deliveredAttempts().filter((id) => id !== attemptId), attemptId].slice(-MAX_DELIVERED_ATTEMPTS);
  try { sessionStorage.setItem(DELIVERED_ATTEMPTS_KEY, JSON.stringify(next)); } catch { /* in-memory fence still applies */ }
}

function readPendingPrompt(): PendingPrompt | undefined {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(PENDING_PROMPT_KEY) ?? 'null') as Partial<PendingPrompt> | null;
    if (!parsed || typeof parsed.attemptId !== 'string' || typeof parsed.baselineAssistantMessageCount !== 'number') return undefined;
    const pending: PendingPrompt = {
      attemptId: parsed.attemptId,
      baselineAssistantMessageCount: parsed.baselineAssistantMessageCount,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
    };
    if (typeof parsed.baselineAssistantMessageId === 'string') {
      pending.baselineAssistantMessageId = parsed.baselineAssistantMessageId;
    }
    return pending;
  } catch { return undefined; }
}

function writePendingPrompt(pending: PendingPrompt): void {
  sessionStorage.setItem(PENDING_PROMPT_KEY, JSON.stringify(pending));
}

function clearPendingPrompt(attemptId: string): void {
  const pending = readPendingPrompt();
  if (!pending || pending.attemptId === attemptId) sessionStorage.removeItem(PENDING_PROMPT_KEY);
}

async function reportReplyIfReady(next = snapshot()): Promise<void> {
  const pending = readPendingPrompt();
  if (!pending || !hasNewAssistantReply(next, {
    assistantMessageCount: pending.baselineAssistantMessageCount,
    ...(pending.baselineAssistantMessageId ? { latestAssistantMessageId: pending.baselineAssistantMessageId } : {}),
  })) return;
  const notice: RuntimeNotice = { type: 'content:reply-observed', attemptId: pending.attemptId, snapshot: next };
  try {
    await chrome.runtime.sendMessage(notice);
    clearPendingPrompt(pending.attemptId);
  } catch {
    // Keep pending evidence so a later content-script lifecycle can retry.
  }
}

async function publishChanged(): Promise<void> {
  const next = snapshot();
  const semanticKey = snapshotSemanticKey(next);
  if (semanticKey !== lastSemanticKey) {
    lastSemanticKey = semanticKey;
    const notice: RuntimeNotice = { type: 'content:changed', snapshot: next };
    try { await chrome.runtime.sendMessage(notice); } catch { /* old content script may be detached */ }
  }
  await reportReplyIfReady(next);
}

function schedulePublish(): void {
  if (publishTimer !== undefined) window.clearTimeout(publishTimer);
  publishTimer = window.setTimeout(() => void publishChanged(), 180);
}

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  if (message.type === 'content:get-snapshot') {
    sendResponse({ ok: true, snapshot: snapshot() });
    return false;
  }
  if (message.type === 'content:send') {
    void (async () => {
      if (wasDelivered(message.attemptId)) {
        sendResponse({ ok: true, duplicate: true, snapshot: snapshot() });
        return;
      }
      const existing = readPendingPrompt();
      if (existing && existing.attemptId !== message.attemptId) {
        sendResponse({ ok: false, error: 'A previous prompt is still awaiting a new assistant reply' });
        return;
      }
      if (inflightAttempts.has(message.attemptId)) {
        sendResponse({ ok: false, error: 'This send attempt is already in progress' });
        return;
      }
      inflightAttempts.add(message.attemptId);
      const baseline = snapshot();
      const pending: PendingPrompt = {
        attemptId: message.attemptId,
        baselineAssistantMessageCount: baseline.assistantMessageCount,
        startedAt: Date.now(),
      };
      if (baseline.latestAssistantMessageId) pending.baselineAssistantMessageId = baseline.latestAssistantMessageId;
      writePendingPrompt(pending);
      try {
        await sendPrompt(document, message.text);
        rememberDelivered(message.attemptId);
        schedulePublish();
        sendResponse({ ok: true, duplicate: false, snapshot: snapshot() });
      } catch (error) {
        clearPendingPrompt(message.attemptId);
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      } finally {
        inflightAttempts.delete(message.attemptId);
      }
    })();
    return true;
  }
  return false;
});

const observer = new MutationObserver(schedulePublish);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['disabled', 'aria-disabled', 'aria-busy'],
});
window.addEventListener('popstate', schedulePublish);
window.addEventListener('hashchange', schedulePublish);
document.addEventListener('visibilitychange', schedulePublish);
void publishChanged();