import { filterFleetTaskTabs } from './fleet';
import { planReadyDispatches } from './supervisor';
import { buildTaskDispatchPrompt } from './taskPrompt';
import { provisionTaskWorkspaceForDispatch } from './taskWorkspaceDispatch';
import type { ManagedTab, ManagedTask, SendResult, TaskDispatchResult } from './contracts';
import type { NativeControlSnapshot } from './nativeControl';

export async function dispatchReadyManagedTasks(
  tasks: readonly ManagedTask[],
  tabs: readonly ManagedTab[],
  control: NativeControlSnapshot,
  mappedTabs: Readonly<Record<string, number>>,
  batchId: string,
  dispatch: (tabId: number, text: string, batchId: string, taskId?: string) => Promise<SendResult>,
): Promise<TaskDispatchResult[]> {
  const dispatchTabs = filterFleetTaskTabs(tabs, control.agents, mappedTabs);
  const byTaskId = new Map(tasks.map((managed) => [managed.task.id, managed]));
  const results: TaskDispatchResult[] = [];
  for (const decision of planReadyDispatches(tasks, dispatchTabs)) {
    if (decision.tabId === undefined) {
      results.push({ taskId: decision.taskId, ok: false, error: decision.error ?? 'Task is not dispatchable' });
      continue;
    }
    const managed = byTaskId.get(decision.taskId);
    if (!managed) continue;
    const dependencies = managed.task.dependsOn.map((id) => byTaskId.get(id))
      .filter((item): item is ManagedTask => item !== undefined);
    const workspace = await provisionTaskWorkspaceForDispatch(managed.task, decision.tabId, dispatchTabs, control);
    const sent = await dispatch(decision.tabId, buildTaskDispatchPrompt(managed.task, dependencies, workspace), batchId, managed.task.id);
    const result: TaskDispatchResult = { taskId: managed.task.id, ok: sent.ok, attemptId: sent.attemptId };
    if (sent.error) result.error = sent.error;
    results.push(result);
  }
  return results;
}
