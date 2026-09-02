import { PromptSubmissionError, sendPrompt, snapshotFromDocument, snapshotSemanticKey } from './chatgptAdapter';
import { hasNewAssistantReply } from './replyCorrelation';
import type { ContentRecoveryState, ContentRequest, PendingPromptEvidence, RuntimeNotice } from './contracts';

const DELIVERED_ATTEMPTS_KEY = 'charterion.delivered-attempts.v1';
const PENDING_PROMPT_KEY = 'charterion.pending-prompt.v1';
const MAX_DELIVERED_ATTEMPTS = 100;
const contentEpoch = crypto.randomUUID();
let observationRevision = 0;
let lastSemanticKey = '';
let snapshotCache: ReturnType<typeof snapshotFromDocument> | undefined;
let snapshotDirty = true;
let publishTimer: number | undefined;
let publishRunning = false;
let publishPending = false;
const inflightAttempts = new Set<string>();
const deliveredInMemory = new Set<string>();
let pendingInMemory: PendingPromptEvidence | undefined;

function snapshot() {
  if (!snapshotDirty && snapshotCache) return { ...snapshotCache, observedAt: Date.now() };
  snapshotCache = snapshotFromDocument(document, location.href, `provisional:${contentEpoch}`);
  snapshotDirty = false;
  return snapshotCache;
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

function readPendingPrompt(): PendingPromptEvidence | undefined {
  try {
    const raw = sessionStorage.getItem(PENDING_PROMPT_KEY);
    if (raw === null) return pendingInMemory;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const item = parsed as Record<string, unknown>;
    if (typeof item.attemptId !== 'string' || typeof item.baselineAssistantMessageCount !== 'number') return undefined;
    if (typeof item.contentEpoch !== 'string' || item.contentEpoch !== contentEpoch) return undefined;
    const pending: PendingPromptEvidence = {
      attemptId: item.attemptId,
      contentEpoch,
      baselineAssistantMessageCount: item.baselineAssistantMessageCount,
      startedAt: typeof item.startedAt === 'number' ? item.startedAt : 0,
    };
    if (typeof item.baselineAssistantMessageId === 'string') pending.baselineAssistantMessageId = item.baselineAssistantMessageId;
    return pending;
  } catch { return pendingInMemory; }
}

function writePendingPrompt(pending: PendingPromptEvidence): void {
  pendingInMemory = pending;
  try { sessionStorage.setItem(PENDING_PROMPT_KEY, JSON.stringify(pending)); } catch { /* memory remains the live-session fallback */ }
}

function clearPendingPrompt(attemptId: string): void {
  const pending = readPendingPrompt();
  if (!pending || pending.attemptId === attemptId) {
    pendingInMemory = undefined;
    try { sessionStorage.removeItem(PENDING_PROMPT_KEY); } catch { /* storage may be unavailable */ }
  }
}

function observationIdentity(snapshotValue: ReturnType<typeof snapshot>, semanticSignature: string) {
  return { contentEpoch, revision: observationRevision, semanticSignature, observedAt: snapshotValue.observedAt };
}

async function reportReplyIfReady(next = snapshot(), semanticSignature = snapshotSemanticKey(next)): Promise<void> {
  const pending = readPendingPrompt();
  if (!pending || !hasNewAssistantReply(next, {
    assistantMessageCount: pending.baselineAssistantMessageCount,
    ...(pending.baselineAssistantMessageId ? { latestAssistantMessageId: pending.baselineAssistantMessageId } : {}),
  })) return;
  const notice: RuntimeNotice = { type: 'content:reply-observed', attemptId: pending.attemptId, observation: observationIdentity(next, semanticSignature), snapshot: next };
  try {
    const response = await chrome.runtime.sendMessage(notice) as { ok?: boolean } | undefined;
    if (response?.ok) clearPendingPrompt(pending.attemptId);
  } catch {
    // Keep pending evidence until the service worker durably acknowledges it.
  }
}

async function publishChanged(): Promise<void> {
  if (publishRunning) {
    publishPending = true;
    return;
  }
  publishRunning = true;
  try {
    do {
      publishPending = false;
      const next = snapshot();
      observationRevision += 1;
      const semanticKey = snapshotSemanticKey(next);
      if (semanticKey !== lastSemanticKey) {
        lastSemanticKey = semanticKey;
        const notice: RuntimeNotice = { type: 'content:changed', observation: observationIdentity(next, semanticKey), snapshot: next };
        try { await chrome.runtime.sendMessage(notice); } catch { /* old content script may be detached */ }
      }
      await reportReplyIfReady(next, semanticKey);
    } while (publishPending);
  } finally {
    publishRunning = false;
  }
}

function schedulePublish(): void {
  snapshotDirty = true;
  if (publishTimer !== undefined) window.clearTimeout(publishTimer);
  publishTimer = window.setTimeout(() => {
    publishTimer = undefined;
    void publishChanged();
  }, 180);
}

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  if (message.type === 'content:get-snapshot') {
    sendResponse({ ok: true, snapshot: snapshot() });
    return false;
  }
  if (message.type === 'content:get-recovery-state') {
    const next = snapshot();
    observationRevision += 1;
    const semanticSignature = snapshotSemanticKey(next);
    const state: ContentRecoveryState = {
      observation: observationIdentity(next, semanticSignature),
      snapshot: next,
      deliveredAttemptIds: deliveredAttempts(),
    };
    const pending = readPendingPrompt();
    if (pending) state.pendingAttempt = pending;
    sendResponse({ ok: true, state });
    return false;
  }
  if (message.type === 'content:send') {
    void (async () => {
      if (message.expectedContentEpoch !== contentEpoch) {
        sendResponse({ ok: false, error: 'Content runtime generation changed before dispatch', contentEpoch });
        return;
      }
      if (wasDelivered(message.attemptId)) {
        sendResponse({ ok: true, duplicate: true, contentEpoch, snapshot: snapshot() });
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
      const pending: PendingPromptEvidence = {
        attemptId: message.attemptId,
        contentEpoch,
        baselineAssistantMessageCount: baseline.assistantMessageCount,
        startedAt: Date.now(),
      };
      if (baseline.latestAssistantMessageId) pending.baselineAssistantMessageId = baseline.latestAssistantMessageId;
      try {
        writePendingPrompt(pending);
        await sendPrompt(document, message.text);
        rememberDelivered(message.attemptId);
        schedulePublish();
        sendResponse({ ok: true, duplicate: false, contentEpoch, snapshot: snapshot() });
      } catch (error) {
        clearPendingPrompt(message.attemptId);
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error), outcome: error instanceof PromptSubmissionError ? error.outcome : 'uncertain', contentEpoch });
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