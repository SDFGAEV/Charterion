import type { ChatSnapshot, SendAttemptRecord } from './contracts';

export function attemptBelongsToTab(
  attempt: SendAttemptRecord,
  tabId: number,
  snapshot: ChatSnapshot,
): boolean {
  if (attempt.tabId === tabId) return true;
  if (!snapshot.conversationId) return false;
  return attempt.conversationKey === snapshot.conversationKey;
}
