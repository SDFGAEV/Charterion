import { normalizedRole, rolesAreCompatible } from '../shared/agentRole';
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

function candidateScore(task: AgentTask, tab: ManagedTab): number | undefined {
  if (tab.snapshot.status !== 'idle' || !attemptAllowsDispatch(task, tab)) return undefined;
  if (task.project && tab.binding.project.trim() !== task.project) return undefined;
  if (!rolesAreCompatible(task.targetRole, tab.binding.role)) return undefined;

  let score = normalizedRole(task.targetRole) === normalizedRole(tab.binding.role) ? 100 : 50;
  if (tab.snapshot.conversationKey.startsWith('conversation:')) score += 20;
  if (tab.binding.agentSlotId) score += 10;
  return score;
}
export function planReadyDispatches(tasks: readonly ManagedTask[], tabs: readonly ManagedTab[]): DispatchDecision[] {
  const claimedTabs = new Set<number>();
  const decisions: DispatchDecision[] = [];
  for (const managed of tasks) {
    if (managed.status !== 'ready') continue;
    const candidates = tabs
      .filter((tab) => !claimedTabs.has(tab.tabId))
      .map((tab) => ({ tab, score: candidateScore(managed.task, tab) }))
      .filter((item): item is { tab: ManagedTab; score: number } => item.score !== undefined)
      .sort((left, right) => right.score - left.score || left.tab.tabId - right.tab.tabId);

    const selected = candidates[0];
    if (!selected) {
      decisions.push({
        taskId: managed.task.id,
        error: `No idle reusable ChatGPT agent is compatible with role ${managed.task.targetRole}`,
      });
      continue;
    }
    claimedTabs.add(selected.tab.tabId);
    decisions.push({ taskId: managed.task.id, tabId: selected.tab.tabId });
  }
  return decisions;
}
