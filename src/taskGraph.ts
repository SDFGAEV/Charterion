import { parseReviewResult } from './review';
import type { AgentTask, ManagedTask, ReviewResult, SendAttemptRecord, TaskDisplayStatus } from './contracts';

export function validateTaskGraph(tasks: readonly AgentTask[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error('Task ids must be unique');
  for (const task of tasks) {
    if (!task.title.trim() || !task.instruction.trim() || !task.targetRole.trim()) {
      throw new Error('Task title, instruction, and target role are required');
    }
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) throw new Error(`Task ${task.id} cannot depend on itself`);
      if (!byId.has(dependency)) throw new Error(`Task ${task.id} depends on missing task ${dependency}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskId: string): void => {
    if (visited.has(taskId)) return;
    if (visiting.has(taskId)) throw new Error('Task dependencies must form a DAG');
    visiting.add(taskId);
    for (const dependency of byId.get(taskId)?.dependsOn ?? []) visit(dependency);
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const task of tasks) visit(task.id);
}

function evaluateAttempt(task: AgentTask, attempt: SendAttemptRecord | undefined): {
  status?: TaskDisplayStatus;
  reviewResult?: ReviewResult;
  reviewError?: string;
} {
  switch (attempt?.state) {
    case 'reply-observed': {
      if (task.kind !== 'review') return { status: 'completed' };
      const parsed = parseReviewResult(attempt.replyTextTail ?? '');
      if (!parsed.ok) return { status: 'attention', reviewError: parsed.error };
      if (parsed.result.decision === 'fail') return { status: 'attention', reviewResult: parsed.result };
      return { status: 'completed', reviewResult: parsed.result };
    }
    case 'prepared':
    case 'dispatched':
    case 'acknowledged': return { status: 'running' };
    case 'failed': return { status: 'error' };
    case 'uncertain': return { status: 'attention' };
    default: return {};
  }
}

export function isRetryableTaskAttempt(task: AgentTask, attempt: SendAttemptRecord | undefined): boolean {
  if (!attempt) return false;
  if (attempt.state === 'failed' || attempt.state === 'uncertain') return true;
  if (task.kind !== 'review' || attempt.state !== 'reply-observed') return false;
  const parsed = parseReviewResult(attempt.replyTextTail ?? '');
  return !parsed.ok || parsed.result.decision === 'fail';
}

export function deriveManagedTasks(
  tasks: readonly AgentTask[],
  attempts: readonly SendAttemptRecord[],
): ManagedTask[] {
  const attemptsById = new Map(attempts.map((attempt) => [attempt.attemptId, attempt]));
  const result = new Map<string, ManagedTask>();

  const derive = (task: AgentTask): ManagedTask => {
    const cached = result.get(task.id);
    if (cached) return cached;
    const lastAttemptId = task.attemptIds.at(-1);
    const lastAttempt = lastAttemptId ? attemptsById.get(lastAttemptId) : undefined;
    const retryRequested = Boolean(
      lastAttempt &&
      task.retryAfterAttemptId === lastAttempt.attemptId &&
      isRetryableTaskAttempt(task, lastAttempt),
    );
    const evaluation = retryRequested ? {} : evaluateAttempt(task, lastAttempt);
    let status: TaskDisplayStatus;
    if (task.cancelledAt !== undefined) {
      status = 'cancelled';
    } else if (task.skippedAt !== undefined) {
      status = 'skipped';
    } else if (evaluation.status) {
      status = evaluation.status;
    } else {
      const dependencies = task.dependsOn.map((id) => tasks.find((candidate) => candidate.id === id)).filter(Boolean) as AgentTask[];
      const dependencyStates = dependencies.map((dependency) => derive(dependency).status);
      if (dependencyStates.some((state) => ['error', 'attention', 'blocked', 'cancelled'].includes(state))) status = 'blocked';
      else if (dependencyStates.every((state) => state === 'completed' || state === 'skipped')) status = 'ready';
      else status = task.dependsOn.length === 0 ? 'ready' : 'pending';
    }
    const managed: ManagedTask = { task, status };
    if (lastAttempt) managed.lastAttempt = lastAttempt;
    if (evaluation.reviewResult) managed.reviewResult = evaluation.reviewResult;
    if (evaluation.reviewError) managed.reviewError = evaluation.reviewError;
    result.set(task.id, managed);
    return managed;
  };

  return tasks.map(derive);
}