import type { AgentSlot, ProjectCell } from './contracts';
import type { KernelWorkSnapshot } from './workAuthority';

export const DEFAULT_IDLE_SUSPEND_GRACE_MS = 2 * 60 * 1000;

export interface ElasticFleetFacts {
  project: ProjectCell;
  agents: readonly AgentSlot[];
  work: KernelWorkSnapshot;
  activeLeaseHolderIds: ReadonlySet<string>;
  unsettledBrowserSlotIds: ReadonlySet<string>;
  now: number;
  idleGraceMs?: number;
}

export type ElasticFleetDecision =
  | { kind: 'suspend'; slotId: string; reason: string }
  | { kind: 'resume'; slotId: string; reason: string };

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function attemptStateById(work: KernelWorkSnapshot): Map<string, string> {
  return new Map(work.attempts.map((attempt) => [text(attempt.attemptId) ?? '', text(attempt.state) ?? '']));
}
function taskTerminal(task: Record<string, unknown>, attempts: ReadonlyMap<string, string>): boolean {
  if (typeof task.skippedAt === 'number' || typeof task.cancelledAt === 'number' || task.machineCompletion) return true;
  const policy = text(task.completionPolicy) ?? 'reply';
  const ids = Array.isArray(task.attemptIds) ? task.attemptIds.filter((id): id is string => typeof id === 'string') : [];
  const latestAttemptId = ids.at(-1);
  if (latestAttemptId && text(task.retryAfterAttemptId) === latestAttemptId) return false;
  if (policy === 'reply' || policy === 'review-pass') return latestAttemptId ? attempts.get(latestAttemptId) === 'reply-observed' : false;
  if (policy === 'human-approval') {
    const decision = task.humanDecision as Record<string, unknown> | undefined;
    return decision?.decision === 'approve' || decision?.decision === 'reject';
  }
  return false;
}

function roleDemand(project: ProjectCell, work: KernelWorkSnapshot): Map<string, number> {
  const attempts = attemptStateById(work);
  const tasks = new Map(work.tasks.map((task) => [text(task.id) ?? '', task]));
  const terminal = new Set([...tasks].filter(([, task]) => taskTerminal(task, attempts)).map(([id]) => id));
  const roles = new Map<string, number>();
  for (const task of work.tasks) {
    if (text(task.project) !== project.name || taskTerminal(task, attempts)) continue;
    const dependencies = Array.isArray(task.dependsOn) ? task.dependsOn.filter((id): id is string => typeof id === 'string') : [];
    if (!dependencies.every((id) => terminal.has(id))) continue;
    const role = text(task.targetRole);
    if (role) roles.set(role, (roles.get(role) ?? 0) + 1);
  }
  return roles;
}
function cleanupEligible(agent: AgentSlot, facts: ElasticFleetFacts, graceMs: number): boolean {
  if (agent.projectId !== facts.project.id || agent.desiredState !== 'active' || agent.status === 'retired') return false;
  if (agent.browserState !== 'open' || agent.rolloverState !== 'idle' || agent.browserQuarantined) return false;
  if (agent.browserPageStatus !== 'idle' || agent.browserRuntimeObservedAt === undefined) return false;
  if (facts.now - agent.browserRuntimeObservedAt < graceMs) return false;
  if (facts.unsettledBrowserSlotIds.has(agent.id) || facts.activeLeaseHolderIds.has(agent.id)) return false;
  return true;
}

export function planElasticFleet(facts: ElasticFleetFacts): ElasticFleetDecision[] {
  const graceMs = facts.idleGraceMs ?? DEFAULT_IDLE_SUSPEND_GRACE_MS;
  if (!Number.isFinite(graceMs) || graceMs < 0) throw new Error('idleGraceMs must be non-negative');
  const projectAgents = facts.agents.filter((agent) => agent.projectId === facts.project.id && agent.status !== 'retired');
  const demand = roleDemand(facts.project, facts.work);
  const active = projectAgents.filter((agent) => agent.desiredState === 'active');
  const target = facts.project.status === 'active' ? facts.project.minSlots : 0;
  const decisions: ElasticFleetDecision[] = [];

  let remainingActive = active.length;
  const roleActive = new Map<string, number>();
  for (const agent of active) roleActive.set(agent.role, (roleActive.get(agent.role) ?? 0) + 1);
  const cleanup = active.filter((agent) => cleanupEligible(agent, facts, graceMs))
    .sort((a, b) => (a.browserRuntimeObservedAt ?? facts.now) - (b.browserRuntimeObservedAt ?? facts.now) || a.id.localeCompare(b.id));
  for (const agent of cleanup) {
    if (remainingActive <= target) break;
    const required = facts.project.status === 'active' ? (demand.get(agent.role) ?? 0) : 0;
    if ((roleActive.get(agent.role) ?? 0) <= required) continue;
    decisions.push({ kind: 'suspend', slotId: agent.id, reason: `idle beyond ${graceMs}ms and above target ${target}` });
    remainingActive -= 1;
    roleActive.set(agent.role, (roleActive.get(agent.role) ?? 1) - 1);
  }
  if (facts.project.status !== 'active') return decisions;
  const suspended = projectAgents.filter((agent) => agent.desiredState === 'suspended' && agent.status === 'suspended')
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));

  for (const [role, required] of [...demand.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    while ((roleActive.get(role) ?? 0) < required && remainingActive < facts.project.maxSlots) {
      const candidate = suspended.find((agent) => agent.role === role && !decisions.some((item) => item.kind === 'resume' && item.slotId === agent.id));
      if (!candidate) break;
      decisions.push({ kind: 'resume', slotId: candidate.id, reason: `ready work demands role ${role}` });
      roleActive.set(role, (roleActive.get(role) ?? 0) + 1);
      remainingActive += 1;
    }
  }
  return decisions;
}
