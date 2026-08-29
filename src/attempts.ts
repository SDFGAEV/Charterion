import type { SendAttemptRecord, SendAttemptState } from './contracts';

const ALLOWED: Record<SendAttemptState, ReadonlySet<SendAttemptState>> = {
  prepared: new Set(['dispatched', 'failed']),
  dispatched: new Set(['acknowledged', 'reply-observed', 'failed', 'uncertain']),
  acknowledged: new Set(['reply-observed']),
  'reply-observed': new Set(),
  failed: new Set(),
  uncertain: new Set(['reply-observed']),
};

export function canAdvanceAttempt(current: SendAttemptState, next: SendAttemptState): boolean {
  return current === next || ALLOWED[current].has(next);
}

export function advanceAttempt(
  record: SendAttemptRecord,
  next: SendAttemptState,
  now = Date.now(),
  error?: string,
): SendAttemptRecord {
  if (!canAdvanceAttempt(record.state, next)) return record;
  const updated: SendAttemptRecord = { ...record, state: next, updatedAt: now };
  if (error) updated.error = error;
  else delete updated.error;
  return updated;
}