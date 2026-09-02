import { roleAffinityKey, stableRoleLabel } from '../../shared/agentRole';
import { isStructuredTaskResult } from '../../shared/structuredResult';
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
  | { kind: 'resume'; slotId: string; reason: string }
  | { kind: 'spawn'; role: string; affinityKey: string; reason: string; slotId?: string };

interface RoleDemand {
  required: number;
  requestedRole: string;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function attemptById(work: KernelWorkSnapshot): Map<string, Record<string, unknown>> {
  return new Map(work.attempts.map((attempt) => [text(attempt.attemptId) ?? '', attempt]));
}

function reviewAttemptPassed(attempt: Record<string, unknown> | undefined): boolean {
  if (text(attempt?.state) !== 'reply-observed') return false;
  const reply = text(attempt?.replyTextTail);
  if (!reply) return false;
  const open = '<GAM_REVIEW>'; const close = '</GAM_REVIEW>'; const trimmed = reply.trim();
  const start = trimmed.lastIndexOf(open); const end = trimmed.lastIndexOf(close);
  if (start < 0 || end < start || end + close.length !== trimmed.length) return false;
  if (trimmed.indexOf(open) !== start || trimmed.indexOf(close) !== end) return false;
  try {
    const value = JSON.parse(trimmed.slice(start + open.length, end).trim());
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const item = value;
    const keys = Object.keys(item).sort().join(',');
    return keys === 'decision,nextInstruction,reason' && item.decision === 'pass' &&
      typeof item.reason === 'string' && item.reason.trim().length > 0 && item.nextInstruction === '';
  } catch { return false; }
}

function taskTerminal(task: Record<string, unknown>, attempts: ReadonlyMap<string, Record<string, unknown>>): boolean {
  if (typeof task.skippedAt === 'number' || typeof task.cancelledAt === 'number' || task.machineCompletion) return true;
  const policy = text(task.completionPolicy) ?? 'reply';
  const ids = Array.isArray(task.attemptIds) ? task.attemptIds.filter((id): id is string => typeof id === 'string') : [];
  const latestAttemptId = ids.at(-1);
  if (latestAttemptId && text(task.retryAfterAttemptId) === latestAttemptId) return false;
  if (policy === 'reply') return latestAttemptId ? text(attempts.get(latestAttemptId)?.state) === 'reply-observed' : false;
  if (policy === 'structured-result') {
    const attempt = latestAttemptId ? attempts.get(latestAttemptId) : undefined;
    return text(attempt?.state) === 'reply-observed' && isStructuredTaskResult(text(attempt?.replyTextTail) ?? '');
  }
  if (policy === 'review-pass') return latestAttemptId ? reviewAttemptPassed(attempts.get(latestAttemptId)) : false;
  if (policy === 'human-approval') {
    const decision = task.humanDecision as Record<string, unknown> | undefined;
    return decision?.decision === 'approve' || decision?.decision === 'reject';
  }
  return false;
}

function roleDemand(project: ProjectCell, work: KernelWorkSnapshot): Map<string, RoleDemand> {
  const attempts = attemptById(work);
  const tasks = new Map(work.tasks.map((task) => [text(task.id) ?? '', task]));
  const terminal = new Set([...tasks].filter(([, task]) => taskTerminal(task, attempts)).map(([id]) => id));
  const demand = new Map<string, RoleDemand>();
  for (const task of work.tasks) {
    if (text(task.project) !== project.name || taskTerminal(task, attempts)) continue;
    const dependencies = Array.isArray(task.dependsOn) ? task.dependsOn.filter((id): id is string => typeof id === 'string') : [];
    if (!dependencies.every((id) => terminal.has(id))) continue;
    const requestedRole = text(task.targetRole);
    if (!requestedRole) continue;
    const key = roleAffinityKey(requestedRole);
    const current = demand.get(key);
    demand.set(key, { required: (current?.required ?? 0) + 1, requestedRole: current?.requestedRole ?? requestedRole });
  }
  return demand;
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
  const affinityActive = new Map<string, number>();
  for (const agent of active) {
    const key = roleAffinityKey(agent.role);
    affinityActive.set(key, (affinityActive.get(key) ?? 0) + 1);
  }
  const cleanup = active.filter((agent) => cleanupEligible(agent, facts, graceMs))
    .sort((a, b) => (a.browserRuntimeObservedAt ?? facts.now) - (b.browserRuntimeObservedAt ?? facts.now) || a.id.localeCompare(b.id));
  for (const agent of cleanup) {
    if (remainingActive <= target) break;
    const key = roleAffinityKey(agent.role);
    const required = facts.project.status === 'active' ? (demand.get(key)?.required ?? 0) : 0;
    if ((affinityActive.get(key) ?? 0) <= required) continue;
    decisions.push({ kind: 'suspend', slotId: agent.id, reason: `idle beyond ${graceMs}ms and above target ${target}` });
    remainingActive -= 1;
    affinityActive.set(key, (affinityActive.get(key) ?? 1) - 1);
  }
  if (facts.project.status !== 'active') return decisions;

  const suspended = projectAgents.filter((agent) => agent.desiredState === 'suspended' && agent.status === 'suspended')
    .sort((a, b) => {
      const conversationDelta = Number(Boolean(b.conversationKey)) - Number(Boolean(a.conversationKey));
      return conversationDelta || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
    });
  const suspendedByAffinity = new Map<string, AgentSlot[]>();
  for (const agent of suspended) {
    const key = roleAffinityKey(agent.role);
    const group = suspendedByAffinity.get(key);
    if (group) group.push(agent);
    else suspendedByAffinity.set(key, [agent]);
  }
  const suspendedCursor = new Map<string, number>();
  const occupiedRoles = projectAgents.map((agent) => agent.role);
  for (const [key, requested] of [...demand.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    while ((affinityActive.get(key) ?? 0) < requested.required && remainingActive < facts.project.maxSlots) {
      const candidates = suspendedByAffinity.get(key) ?? [];
      const cursor = suspendedCursor.get(key) ?? 0;
      const candidate = candidates[cursor];
      if (candidate) {
        suspendedCursor.set(key, cursor + 1);
        decisions.push({ kind: 'resume', slotId: candidate.id, reason: `ready work reuses ${key}` });
        affinityActive.set(key, (affinityActive.get(key) ?? 0) + 1);
        remainingActive += 1;
        continue;
      }
      const role = stableRoleLabel(requested.requestedRole, occupiedRoles);
      occupiedRoles.push(role);
      decisions.push({ kind: 'spawn', role, affinityKey: key, reason: `ready work requires new ${key}; no reusable slot exists` });
      affinityActive.set(key, (affinityActive.get(key) ?? 0) + 1);
      remainingActive += 1;
    }
  }
  return decisions;
}
