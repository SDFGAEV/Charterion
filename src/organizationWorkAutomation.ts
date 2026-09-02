import type { AgentTask } from './contracts';

/** Identifies system-owned Organization execution projections. */
export function hasOrganizationExecutionTask(tasks: readonly AgentTask[]): boolean {
  return tasks.some((task) => {
    const organizationTask = task as AgentTask & { organizationWorkItemId?: unknown };
    return task.kind === 'work' && typeof organizationTask.organizationWorkItemId === 'string';
  });
}
