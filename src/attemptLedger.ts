import type { AgentMessage, AgentTask, SendAttemptRecord } from './contracts';

export const MAX_UNLINKED_SEND_ATTEMPTS = 500;

export function retainAttemptLedger(
  attempts: readonly SendAttemptRecord[],
  tasks: readonly AgentTask[],
  messages: readonly AgentMessage[],
  maxUnlinked = MAX_UNLINKED_SEND_ATTEMPTS,
): SendAttemptRecord[] {
  const linkedIds = new Set<string>();
  for (const task of tasks) for (const id of task.attemptIds) linkedIds.add(id);
  for (const message of messages) for (const id of message.attemptIds) linkedIds.add(id);

  const unlinkedIds = attempts
    .filter((attempt) =>
      !linkedIds.has(attempt.attemptId) && !attempt.taskId && !attempt.messageId,
    )
    .slice(-Math.max(0, maxUnlinked))
    .map((attempt) => attempt.attemptId);
  const retainedUnlinked = new Set(unlinkedIds);

  return attempts.filter((attempt) =>
    linkedIds.has(attempt.attemptId) ||
    Boolean(attempt.taskId) ||
    Boolean(attempt.messageId) ||
    retainedUnlinked.has(attempt.attemptId),
  );
}
