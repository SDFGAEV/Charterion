import type { AgentTask, ManagedTab, ManagedTask } from './contracts';

export interface DispatchDecision {
  taskId: string;
  tabId?: number;
  error?: string;
}

function attemptAllowsDispatch(task: AgentTask, tab: ManagedTab): boolean {
  const last = tab.lastAttempt;
  if (!last) return true;
  if (last.state === 'prepared' || last.state === 'dispatched' || last.state === 'acknowledged') return false;
  if (last.state === 'uncertain') return task.retryAfterAttemptId === last.attemptId;
  return true;
}

function matchesTask(task: AgentTask, tab: ManagedTab): boolean {
  return tab.snapshot.status === 'idle' &&
    attemptAllowsDispatch(task, tab) &&
    tab.binding.role.trim() === task.targetRole &&
    (!task.project || tab.binding.project.trim() === task.project);
}

export function planReadyDispatches(tasks: readonly ManagedTask[], tabs: readonly ManagedTab[]): DispatchDecision[] {
  const byRole = new Map<string, ManagedTab[]>();
  const byRoleAndProject = new Map<string, ManagedTab[]>();
  for (const tab of tabs) {
    const role = tab.binding.role.trim();
    const project = tab.binding.project.trim();
    const roleTabs = byRole.get(role) ?? [];
    roleTabs.push(tab);
    byRole.set(role, roleTabs);
    const scopedKey = `${role}|${project}`;
    const scopedTabs = byRoleAndProject.get(scopedKey) ?? [];
    scopedTabs.push(tab);
    byRoleAndProject.set(scopedKey, scopedTabs);
  }

  const claimedTabs = new Set<number>();
  const decisions: DispatchDecision[] = [];
  for (const managed of tasks) {
    if (managed.status !== 'ready') continue;
    const task = managed.task;
    const candidates = (task.project.trim()
      ? byRoleAndProject.get(`${task.targetRole}|${task.project.trim()}`) ?? []
      : byRole.get(task.targetRole) ?? [])
      .filter((tab) => !claimedTabs.has(tab.tabId) && matchesTask(task, tab));
    if (candidates.length === 0) {
      decisions.push({ taskId: task.id, error: `No idle ChatGPT tab is uniquely bound to role ${task.targetRole}` });
      continue;
    }
    if (candidates.length > 1) {
      decisions.push({ taskId: task.id, error: `Multiple idle ChatGPT tabs match role ${task.targetRole}; routing is ambiguous` });
      continue;
    }
    const tabId = candidates[0]!.tabId;
    claimedTabs.add(tabId);
    decisions.push({ taskId: task.id, tabId });
  }
  return decisions;
}