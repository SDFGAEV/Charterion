import type { AgentTask, ManagedTab, ManagedTask } from './contracts';

export interface DispatchDecision {
  taskId: string;
  tabId?: number;
  error?: string;
}

function matchesTask(task: AgentTask, tab: ManagedTab): boolean {
  return tab.snapshot.status === 'idle' &&
    tab.binding.role.trim() === task.targetRole &&
    (!task.project || tab.binding.project.trim() === task.project);
}

export function planReadyDispatches(tasks: readonly ManagedTask[], tabs: readonly ManagedTab[]): DispatchDecision[] {
  const claimedTabs = new Set<number>();
  const decisions: DispatchDecision[] = [];
  for (const managed of tasks) {
    if (managed.status !== 'ready') continue;
    const candidates = tabs.filter((tab) => !claimedTabs.has(tab.tabId) && matchesTask(managed.task, tab));
    if (candidates.length === 0) {
      decisions.push({ taskId: managed.task.id, error: `No idle ChatGPT tab is uniquely bound to role ${managed.task.targetRole}` });
      continue;
    }
    if (candidates.length > 1) {
      decisions.push({ taskId: managed.task.id, error: `Multiple idle ChatGPT tabs match role ${managed.task.targetRole}; routing is ambiguous` });
      continue;
    }
    const tabId = candidates[0]!.tabId;
    claimedTabs.add(tabId);
    decisions.push({ taskId: managed.task.id, tabId });
  }
  return decisions;
}