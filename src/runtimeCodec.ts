import type { ChatSnapshot, ContentRecoveryState } from './contracts';

const statuses = new Set(['idle', 'generating', 'blocked', 'unauthorized', 'error', 'unknown', 'unavailable']);
const confidences = new Set(['direct', 'inferred', 'unknown']);

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function isChatSnapshot(value: unknown): value is ChatSnapshot {
  const item = object(value);
  return !!item && typeof item.conversationKey === 'string' && typeof item.title === 'string' &&
    typeof item.url === 'string' && typeof item.status === 'string' && statuses.has(item.status) &&
    typeof item.confidence === 'string' && confidences.has(item.confidence) &&
    Array.isArray(item.signals) && item.signals.every((signal) => typeof signal === 'string') &&
    typeof item.assistantMessageCount === 'number' && typeof item.latestAssistantText === 'string' &&
    typeof item.observedAt === 'number';
}

export function isContentRecoveryState(value: unknown): value is ContentRecoveryState {
  const item = object(value);
  return !!item && isChatSnapshot(item.snapshot) && Array.isArray(item.deliveredAttemptIds) &&
    item.deliveredAttemptIds.every((id) => typeof id === 'string') && object(item.observation) !== undefined;
}
