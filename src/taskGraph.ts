import { parseReviewResult } from './review';
import { parseStructuredTaskResult } from './structuredResult';
import { DEFAULT_MAX_REVIEW_ROUNDS, validateTaskPolicy } from './taskPolicy';
import type { AgentTask, ManagedTask, ReviewResult, SendAttemptRecord, StructuredTaskResult, TaskDisplayStatus } from './contracts';

export function validateTaskGraph(tasks: readonly AgentTask[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error('Task ids must be unique');
  for (const task of tasks) {
    if (!task.title.trim() || !task.instruction.trim()) {
      throw new Error('Task title and instruction are required');
    }
    validateTaskPolicy(task);
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
  structuredResult?: StructuredTaskResult;
  structuredResultError?: string;
} {
  if (task.completionPolicy === 'verified-claim' && task.machineCompletion) return { status: 'completed' };
  switch (attempt?.state) {
    case 'reply-observed': {
      if (task.completionPolicy === 'verified-claim') return { status: 'running' };
      if (task.completionPolicy === 'structured-result') {
        const parsed = parseStructuredTaskResult(attempt.replyTextTail ?? '');
        return parsed.ok
          ? { status: 'completed', structuredResult: parsed.result }
          : { status: 'attention', structuredResultError: parsed.error };
      }
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

function reviewAttemptsExhausted(task: AgentTask): boolean {
  return task.kind === 'review' &&
    task.attemptIds.length >= (task.maxReviewRounds ?? DEFAULT_MAX_REVIEW_ROUNDS);
}

export function isRetryableTaskAttempt(task: AgentTask, attempt: SendAttemptRecord | undefined): boolean {
  if (!attempt) return false;
  if (attempt.state === 'failed' || attempt.state === 'uncertain') {
    return task.kind !== 'review' || !reviewAttemptsExhausted(task);
  }
  if (attempt.state === 'reply-observed' && task.completionPolicy === 'structured-result') {
    return !parseStructuredTaskResult(attempt.replyTextTail ?? '').ok;
  }
  if (task.kind !== 'review' || attempt.state !== 'reply-observed' || reviewAttemptsExhausted(task)) return false;
  const parsed = parseReviewResult(attempt.replyTextTail ?? '');
  return !parsed.ok || parsed.result.decision === 'fail';
}

function isReviewRevisionRetry(task: AgentTask, attempt: SendAttemptRecord | undefined): boolean {
  return Boolean(
    task.kind === 'work' &&
    attempt?.state === 'reply-observed' &&
    task.retryAfterAttemptId === attempt.attemptId &&
    task.revisionFromReviewAttemptId,
  );
}

export function deriveManagedTasks(
  tasks: readonly AgentTask[],
  attempts: readonly SendAttemptRecord[],
): ManagedTask[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const attemptsById = new Map(attempts.map((attempt) => [attempt.attemptId, attempt]));
  const result = new Map<string, ManagedTask>();

  const derive = (task: AgentTask): ManagedTask => {
    const cached = result.get(task.id);
    if (cached) return cached;
    const attemptHistory = task.attemptIds
      .map((id) => attemptsById.get(id))
      .filter((attempt): attempt is SendAttemptRecord => attempt !== undefined);
    const lastAttempt = attemptHistory.at(-1);
    const retryRequested = Boolean(
      lastAttempt &&
      task.retryAfterAttemptId === lastAttempt.attemptId &&
      (isRetryableTaskAttempt(task, lastAttempt) || isReviewRevisionRetry(task, lastAttempt)),
    );
    const observedEvaluation = evaluateAttempt(task, lastAttempt);
    const evaluation = retryRequested ? {} : observedEvaluation;
    const reviewLoopExhausted = Boolean(
      task.kind === 'review' &&
      evaluation.status === 'attention' &&
      reviewAttemptsExhausted(task),
    );

    let status: TaskDisplayStatus;
    if (task.cancelledAt !== undefined) {
      status = 'cancelled';
    } else if (task.skippedAt !== undefined) {
      status = 'skipped';
    } else if (evaluation.status && !reviewLoopExhausted) {
      status = evaluation.status;
    } else if (reviewLoopExhausted) {
      status = 'error';
    } else {
      const dependencies = task.dependsOn
        .map((id) => tasksById.get(id))
        .filter((dependency): dependency is AgentTask => dependency !== undefined);
      const dependencyStates = dependencies.map((dependency) => derive(dependency).status);
      if (dependencyStates.some((state) => ['error', 'attention', 'blocked', 'cancelled', 'rejected'].includes(state))) {
        status = 'blocked';
      } else if (!dependencyStates.every((state) => state === 'completed' || state === 'skipped')) {
        status = task.dependsOn.length === 0 ? 'ready' : 'pending';
      } else if (task.kind === 'human') {
        status = task.humanDecision?.decision === 'approve'
          ? 'completed'
          : task.humanDecision?.decision === 'reject'
            ? 'rejected'
            : 'waiting-human';
      } else {
        status = 'ready';
      }
    }

    const managed: ManagedTask = { task, status, attemptHistory };
    if (lastAttempt) managed.lastAttempt = lastAttempt;
    if (observedEvaluation.reviewResult) managed.reviewResult = observedEvaluation.reviewResult;
    if (observedEvaluation.reviewError) managed.reviewError = observedEvaluation.reviewError;
    if (observedEvaluation.structuredResult) managed.structuredResult = observedEvaluation.structuredResult;
    if (observedEvaluation.structuredResultError) managed.structuredResultError = observedEvaluation.structuredResultError;
    if (task.kind === 'review') {
      managed.reviewRound = attemptHistory.length;
      managed.reviewLoopExhausted = reviewLoopExhausted;
    }
    result.set(task.id, managed);
    return managed;
  };

  return tasks.map(derive);
}
