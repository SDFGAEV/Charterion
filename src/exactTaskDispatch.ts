import type { ManagedTask, TaskCompletionPolicy } from './contracts';

export interface ExactTaskDispatchRequest {
  taskId: string;
  project: string;
}

export type ExactTaskDispatchRejection =
  | 'invalid-request'
  | 'task-not-found'
  | 'ambiguous-task-id'
  | 'project-mismatch'
  | 'human-task'
  | 'cancelled-task'
  | 'terminal-task'
  | 'task-not-ready';

export interface ExactTaskDispatchSuccess {
  ok: true;
  taskId: string;
  project: string;
  managedTask: ManagedTask;
  completionPolicy: TaskCompletionPolicy;
  dispatchBoundary: 'prompt-governor-required';
}
export interface ExactTaskDispatchFailure {
  ok: false;
  taskId: string;
  project: string;
  reason: ExactTaskDispatchRejection;
  error: string;
}

export type ExactTaskDispatchPlan = ExactTaskDispatchSuccess | ExactTaskDispatchFailure;

const TERMINAL_STATUSES = new Set<ManagedTask['status']>([
  'completed',
  'skipped',
  'rejected',
]);

function reject(
  request: ExactTaskDispatchRequest,
  reason: ExactTaskDispatchRejection,
  error: string,
): ExactTaskDispatchFailure {
  return { ok: false, taskId: request.taskId, project: request.project, reason, error };
}
export function planExactTaskDispatch(
  tasks: readonly ManagedTask[],
  request: ExactTaskDispatchRequest,
): ExactTaskDispatchPlan {
  if (!request.taskId.trim() || !request.project.trim()) {
    return reject(request, 'invalid-request', 'Exact task id and project are required');
  }

  const matches = tasks.filter((managed) => managed.task.id === request.taskId);
  if (matches.length === 0) {
    return reject(request, 'task-not-found', `Task ${request.taskId} was not found`);
  }
  if (matches.length !== 1) {
    return reject(request, 'ambiguous-task-id', `Task id ${request.taskId} is not unique`);
  }

  const managed = matches[0]!;
  const task = managed.task;
  if (task.project !== request.project) {
    return reject(request, 'project-mismatch', `Task ${request.taskId} does not belong to project ${request.project}`);
  }
  if (task.kind === 'human') {
    return reject(request, 'human-task', `Human task ${request.taskId} cannot be browser-dispatched`);
  }
  if (task.cancelledAt !== undefined || managed.status === 'cancelled') {
    return reject(request, 'cancelled-task', `Task ${request.taskId} is cancelled`);
  }
  if (
    task.skippedAt !== undefined ||
    task.machineCompletion !== undefined ||
    TERMINAL_STATUSES.has(managed.status)
  ) {
    return reject(request, 'terminal-task', `Task ${request.taskId} is already terminal`);
  }
  if (managed.status !== 'ready') {
    return reject(request, 'task-not-ready', `Task ${request.taskId} is ${managed.status}, not ready`);
  }

  return {
    ok: true,
    taskId: task.id,
    project: task.project,
    managedTask: managed,
    completionPolicy: task.completionPolicy,
    dispatchBoundary: 'prompt-governor-required',
  };
}
