import type { ChatSnapshot } from './contracts';

export interface ReplyBaseline {
  assistantMessageCount: number;
  latestAssistantMessageId?: string;
}

export function hasNewAssistantReply(snapshot: ChatSnapshot, baseline: ReplyBaseline): boolean {
  if (snapshot.status !== 'idle' || !snapshot.latestAssistantText.trim()) return false;
  if (
    snapshot.latestAssistantMessageId &&
    baseline.latestAssistantMessageId &&
    snapshot.latestAssistantMessageId !== baseline.latestAssistantMessageId
  ) {
    return true;
  }
  return snapshot.assistantMessageCount > baseline.assistantMessageCount;
}