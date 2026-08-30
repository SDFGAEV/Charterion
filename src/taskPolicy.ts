import type { AgentTask, TaskCompletionPolicy, TaskKind } from './contracts';

export const DEFAULT_MAX_REVIEW_ROUNDS = 3;
export const MAX_REVIEW_ROUNDS = 10;

export function defaultCompletionPolicy(kind: TaskKind): TaskCompletionPolicy {
  if (kind === 'review') return 'review-pass';
  if (kind === 'human') return 'human-approval';
  return 'reply';
}

export function validateTaskPolicy(task: AgentTask): void {
  const expected = defaultCompletionPolicy(task.kind);
  if (task.completionPolicy !== expected) {
    throw new Error(`Task ${task.id} kind ${task.kind} requires completion policy ${expected}`);
  }

  if (task.kind === 'human') {
    if (task.targetRole.trim()) throw new Error(`Human task ${task.id} must not target a ChatGPT role`);
    if (task.reviewTargetTaskId !== undefined || task.maxReviewRounds !== undefined) {
      throw new Error(`Human task ${task.id} cannot define review-loop settings`);
    }
    return;
  }

  if (!task.targetRole.trim()) throw new Error(`Task ${task.id} requires a target role`);

  if (task.kind === 'review') {
    if (!task.reviewTargetTaskId) throw new Error(`Review task ${task.id} requires a review target`);
    if (!task.dependsOn.includes(task.reviewTargetTaskId)) {
      throw new Error(`Review task ${task.id} target must be one of its dependencies`);
    }
    const rounds = task.maxReviewRounds ?? DEFAULT_MAX_REVIEW_ROUNDS;
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_REVIEW_ROUNDS) {
      throw new Error(`Review task ${task.id} maxReviewRounds must be an integer from 1 to ${MAX_REVIEW_ROUNDS}`);
    }
    return;
  }

  if (task.reviewTargetTaskId !== undefined || task.maxReviewRounds !== undefined) {
    throw new Error(`Work task ${task.id} cannot define review-loop settings`);
  }
}

export function normalizeTask(task: AgentTask): AgentTask {
  const legacy = task as AgentTask & { completionPolicy?: TaskCompletionPolicy };
  const next: AgentTask = {
    ...task,
    completionPolicy: legacy.completionPolicy ?? defaultCompletionPolicy(task.kind),
  };
  if (next.kind === 'review') {
    if (!next.reviewTargetTaskId && next.dependsOn.length === 1) {
      const onlyDependency = next.dependsOn[0];
      if (onlyDependency) next.reviewTargetTaskId = onlyDependency;
    }
    if (next.maxReviewRounds === undefined) next.maxReviewRounds = DEFAULT_MAX_REVIEW_ROUNDS;
  }
  return next;
}
