import type { AgentTask, TaskDisplayStatus } from './contracts';

export type TaskDispositionAction = 'skip' | 'cancel';

export function canSkipTask(status: TaskDisplayStatus): boolean {
  return !['running', 'completed', 'skipped', 'cancelled'].includes(status);
}

export function canCancelTask(status: TaskDisplayStatus): boolean {
  return !['completed', 'skipped', 'cancelled'].includes(status);
}

export function applyTaskDisposition(
  task: AgentTask,
  status: TaskDisplayStatus,
  action: TaskDispositionAction,
  now = Date.now(),
  reason = '',
): AgentTask {
  const normalizedReason = reason.trim();
  if (action === 'skip') {
    if (!canSkipTask(status)) throw new Error(`Task in ${status} state cannot be skipped`);
    const next: AgentTask = { ...task, skippedAt: now, updatedAt: now };
    if (normalizedReason) next.skipReason = normalizedReason;
    return next;
  }
  if (!canCancelTask(status)) throw new Error(`Task in ${status} state cannot be cancelled`);
  const next: AgentTask = { ...task, cancelledAt: now, updatedAt: now };
  if (normalizedReason) next.cancelReason = normalizedReason;
  return next;
}
