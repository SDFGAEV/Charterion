import { roleMatchScore } from '../shared/agentRole';
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
  const roleScore = roleMatchScore(task.targetRole, tab.binding.role);
  if (roleScore === undefined) return undefined;

  let score = roleScore;
  if (tab.snapshot.conversationKey.startsWith('conversation:')) score += 20;
  if (tab.binding.agentSlotId) score += 10;
  return score;
}

interface TaskCandidates {
  managed: ManagedTask;
  index: number;
  candidates: Array<{ tab: ManagedTab; score: number }>;
}
export function planReadyDispatches(tasks: readonly ManagedTask[], tabs: readonly ManagedTab[]): DispatchDecision[] {
  const ready: TaskCandidates[] = tasks.flatMap((managed, index) => {
    if (managed.status !== 'ready') return [];
    const candidates = tabs
      .map((tab) => ({ tab, score: candidateScore(managed.task, tab) }))
      .filter((item): item is { tab: ManagedTab; score: number } => item.score !== undefined)
      .sort((left, right) => right.score - left.score || left.tab.tabId - right.tab.tabId);
    return [{ managed, index, candidates }];
  });

  // Minimum-remaining-values first prevents a flexible task from consuming
  // the only compatible tab for a constrained task.
  const tabFlexibility = new Map<number, number>();
  for (const item of ready) {
    for (const candidate of item.candidates) {
      tabFlexibility.set(candidate.tab.tabId, (tabFlexibility.get(candidate.tab.tabId) ?? 0) + 1);
    }
  }

  const claimedTabs = new Set<number>();
  const selectedByIndex = new Map<number, DispatchDecision>();
  const allocationOrder = [...ready].sort((left, right) =>
    left.candidates.length - right.candidates.length ||
    left.managed.task.createdAt - right.managed.task.createdAt ||
    left.managed.task.updatedAt - right.managed.task.updatedAt ||
    left.managed.task.id.localeCompare(right.managed.task.id)
  );

  for (const item of allocationOrder) {
    const selected = item.candidates
      .filter((candidate) => !claimedTabs.has(candidate.tab.tabId))
      .sort((left, right) =>
        right.score - left.score ||
        (tabFlexibility.get(left.tab.tabId) ?? 0) - (tabFlexibility.get(right.tab.tabId) ?? 0) ||
        left.tab.tabId - right.tab.tabId
      )[0];

    if (!selected) {
      selectedByIndex.set(item.index, {
        taskId: item.managed.task.id,
        error: `No idle reusable ChatGPT agent is compatible with role ${item.managed.task.targetRole}`,
      });
      continue;
    }
    claimedTabs.add(selected.tab.tabId);
    selectedByIndex.set(item.index, { taskId: item.managed.task.id, tabId: selected.tab.tabId });
  }

  // Allocation is optimized independently of input order, while the result
  // remains stable for callers and preserves deterministic dispatch output.
  return tasks.flatMap((_, index) => {
    const decision = selectedByIndex.get(index);
    return decision ? [decision] : [];
  });
}
