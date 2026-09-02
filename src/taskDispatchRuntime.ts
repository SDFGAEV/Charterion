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
  const decisions = planReadyDispatches(tasks, dispatchTabs);
  return Promise.all(decisions.map(async (decision): Promise<TaskDispatchResult> => {
    if (decision.tabId === undefined) {
      return { taskId: decision.taskId, ok: false, error: decision.error ?? 'Task is not dispatchable' };
    }
    const managed = byTaskId.get(decision.taskId);
    if (!managed) return { taskId: decision.taskId, ok: false, error: 'Task disappeared after dispatch planning' };
    try {
      const dependencies = managed.task.dependsOn.map((id) => byTaskId.get(id))
        .filter((item): item is ManagedTask => item !== undefined);
      const workspace = await provisionTaskWorkspaceForDispatch(managed.task, decision.tabId, dispatchTabs, control);
      const lastAttempt = managed.lastAttempt;
      const structuredRetry = managed.task.completionPolicy === 'structured-result' &&
        lastAttempt && managed.task.retryAfterAttemptId === lastAttempt.attemptId && managed.structuredResultError
        ? { attemptId: lastAttempt.attemptId, error: managed.structuredResultError }
        : undefined;
      const sent = await dispatch(decision.tabId, buildTaskDispatchPrompt(managed.task, dependencies, workspace, structuredRetry), batchId, managed.task.id);
      const result: TaskDispatchResult = { taskId: managed.task.id, ok: sent.ok, attemptId: sent.attemptId };
      if (sent.error) result.error = sent.error;
      return result;
    } catch (error) {
      return { taskId: managed.task.id, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }));
}
