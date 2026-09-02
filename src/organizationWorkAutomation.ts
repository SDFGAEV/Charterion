import type { AgentTask } from './contracts';

let observedOrganizationExecution = false;

/** Identifies system-owned Organization execution projections. */
export function hasOrganizationExecutionTask(tasks: readonly AgentTask[]): boolean {
  return tasks.some((task) => {
    const organizationTask = task as AgentTask & { organizationWorkItemId?: unknown };
    return task.kind === 'work' && typeof organizationTask.organizationWorkItemId === 'string';
  });
}

/** Emits one durable diagnostic per service-worker lifetime. */
export function markOrganizationExecutionObserved(tasks: readonly AgentTask[]): boolean {
  if (observedOrganizationExecution || !hasOrganizationExecutionTask(tasks)) return false;
  observedOrganizationExecution = true;
  return true;
}
