import { advanceAttempt } from './attempts';
import { deriveManagedTasks } from './taskGraph';
import {
  completeNativeAgentRollover, markNativeAgentRolloverBootstrap, readNativeAgentRolloverStatus,
  readNativeControlSnapshot, readNativeWorkSnapshot, replaceNativeWorkState, requestNativeAgentRollover,
  type ControlAgentView,
} from './nativeControl';
import type { ChatSnapshot, RoleBinding, SendAttemptRecord, SendResult } from './contracts';

const requesting = new Set<string>();
const bootstrapping = new Set<string>();

export function isConversationLimitSnapshot(snapshot: ChatSnapshot): boolean {
  return snapshot.confidence === 'direct' && snapshot.status === 'error' && snapshot.signals.includes('conversation-limit');
}

function relevantCheckpointState(agent: ControlAgentView, projectName: string, snapshot: ChatSnapshot, work: Awaited<ReturnType<typeof readNativeWorkSnapshot>>) {
  const managed = deriveManagedTasks(work.tasks, work.attempts).filter((item) => item.task.project === projectName && item.task.targetRole === agent.role);
  const tasks = managed.map((item) => ({ id: item.task.id, title: item.task.title, status: item.status, instruction: item.task.instruction.slice(0, 4000), lastAttemptState: item.lastAttempt?.state ?? null }));
  const messages = work.messages.filter((message) => message.project === projectName && (message.target.kind === 'project' || message.target.role === agent.role)).slice(-20)
    .map((message) => ({ id: message.id, fromRole: message.fromRole, type: message.type, content: message.content.slice(0, 2000) }));
  return { slotId: agent.id, role: agent.role, project: projectName, previousConversationKey: agent.conversationKey ?? null, conversationGeneration: agent.conversationGeneration, reason: 'conversation-limit', pageDetail: snapshot.statusDetail ?? '', latestAssistantText: snapshot.latestAssistantText.slice(-3000), tasks, messages, capturedAt: Date.now() };
}
function handoffText(state: ReturnType<typeof relevantCheckpointState>): string {
  const taskLines = state.tasks.length ? state.tasks.map((task) => `- [${task.status}] ${task.id} ${task.title}\n  ${task.instruction}`).join('\n') : '- No role-targeted task is currently recorded.';
  const messageLines = state.messages.length ? state.messages.map((message) => `- ${message.fromRole}/${message.type}: ${message.content}`).join('\n') : '- No recent role-targeted messages.';
  return [
    'GAM CONVERSATION ROLLOVER HANDOFF',
    `You are the same persistent Worker, not a replacement Worker. AgentSlot: ${state.slotId}`,
    `Role: ${state.role}`, `Project: ${state.project}`, `Previous conversation: ${state.previousConversationKey ?? 'none'}`,
    `Previous generation: ${state.conversationGeneration}`, 'Reason: the previous ChatGPT conversation reached its direct conversation-length limit.',
    '', 'Persistent task state:', taskLines, '', 'Recent relevant messages:', messageLines,
    '', 'Latest assistant tail from the previous conversation:', state.latestAssistantText || '(none)',
    '', 'Continuity rules:',
    '- Preserve the same role, project ownership, task responsibilities, and safety constraints.',
    '- Do not claim an interrupted task succeeded unless durable GAM/task/file/Git evidence proves it.',
    '- Continue from durable project and Kernel state; the old chat is historical context, not authority.',
    '- Acknowledge this handoff with GAM_ROLLOVER_READY and briefly state the next action before continuing work.',
  ].join('\n').slice(0, 24000);
}

export function conversationLimitRetryTransition(attempt: SendAttemptRecord, snapshot: ChatSnapshot, now = Date.now()): SendAttemptRecord | undefined {
  if (!isConversationLimitSnapshot(snapshot) || !['dispatched','acknowledged'].includes(attempt.state)) return undefined;
  if (snapshot.assistantMessageCount !== attempt.baselineAssistantMessageCount) return undefined;
  const error = 'Direct ChatGPT conversation-limit UI observed with no assistant reply; safe to retry after conversation rollover';
  return advanceAttempt(attempt, 'failed', now, error);
}

async function makeInterruptedAttemptRetryable(tabId: number, snapshot: ChatSnapshot): Promise<void> {
  for (let pass = 0; pass < 2; pass += 1) {
    const work = await readNativeWorkSnapshot();
    const candidate = [...work.attempts].reverse().find((attempt) => attempt.tabId === tabId && ['dispatched','acknowledged'].includes(attempt.state));
    if (!candidate) return;
    const rejected = conversationLimitRetryTransition(candidate, snapshot);
    if (!rejected) return;
    const attempts = work.attempts.map((attempt) => attempt.attemptId === rejected.attemptId ? rejected : attempt);
    const tasks = candidate.taskId ? work.tasks.map((task) => task.id === candidate.taskId
      ? { ...task, retryAfterAttemptId: candidate.attemptId, updatedAt: Date.now() }
      : task) : work.tasks;
    try { await replaceNativeWorkState({ ...work, attempts, tasks }); return; }
    catch (error) { if (pass === 1 || !String(error).includes('revision')) throw error; }
  }
}

export async function requestAutomaticConversationRollover(tabId: number, binding: RoleBinding, snapshot: ChatSnapshot): Promise<boolean> {
  const slotId = binding.agentSlotId;
  if (!slotId || !isConversationLimitSnapshot(snapshot) || requesting.has(slotId)) return false;
  requesting.add(slotId);
  try {
    const control = await readNativeControlSnapshot();
    const agent = control.agents.find((item) => item.id === slotId);
    if (!agent || agent.desiredState !== 'active' || agent.rolloverState !== 'idle' || !agent.conversationKey) return false;
    const project = control.projects.find((item) => item.id === agent.projectId);
    if (!project) throw new Error(`Project ${agent.projectId} is missing from the control snapshot`);
    await makeInterruptedAttemptRetryable(tabId, snapshot);
    const work = await readNativeWorkSnapshot();
    const state = relevantCheckpointState(agent, project.name, snapshot, work);
    await requestNativeAgentRollover({ slotId, reason: 'conversation-limit', handoffText: handoffText(state), state });
    return true;
  } finally { requesting.delete(slotId); }
}
export async function bootstrapPendingConversationRollover(
  tabId: number,
  binding: RoleBinding,
  snapshot: ChatSnapshot,
  dispatch: (tabId: number, text: string) => Promise<SendResult>,
): Promise<boolean> {
  const slotId = binding.agentSlotId;
  if (!slotId || snapshot.status !== 'idle' || bootstrapping.has(slotId)) return false;
  const status = await readNativeAgentRolloverStatus(slotId);
  if (!status || status.rollover.status !== 'opening') return false;
  bootstrapping.add(slotId);
  try {
    const result = await dispatch(tabId, status.checkpoint.handoffText);
    const uncertain = !result.ok && Boolean(result.error?.includes('uncertain'));
    if (!result.ok && !uncertain) return false;
    await markNativeAgentRolloverBootstrap(slotId, status.rollover.id, result.attemptId);
    const work = await readNativeWorkSnapshot();
    const attempt = work.attempts.find((item) => item.attemptId === result.attemptId);
    if (attempt?.state === 'reply-observed') await completeNativeAgentRollover(slotId, result.attemptId);
    return true;
  } finally { bootstrapping.delete(slotId); }
}

export function hasBootstrapReplyMarkerEvidence(attempt: SendAttemptRecord, snapshot: ChatSnapshot, expectedConversationKey: string): boolean {
  return ['acknowledged','uncertain'].includes(attempt.state) && snapshot.conversationKey === expectedConversationKey &&
    Boolean(snapshot.latestAssistantMessageId) && snapshot.assistantMessageCount > attempt.baselineAssistantMessageCount &&
    /(^|\n)\s*GAM_ROLLOVER_READY\b/.test(snapshot.latestAssistantText);
}

export async function bootstrapReplyAttemptId(binding: RoleBinding, snapshot: ChatSnapshot): Promise<string | undefined> {
  const slotId = binding.agentSlotId; if (!slotId) return undefined;
  const status = await readNativeAgentRolloverStatus(slotId);
  if (!status || status.rollover.status !== 'bootstrapping' || !status.rollover.bootstrapAttemptId || !status.rollover.toConversationKey) return undefined;
  const work = await readNativeWorkSnapshot();
  const attempt = work.attempts.find((item) => item.attemptId === status.rollover.bootstrapAttemptId);
  return attempt && hasBootstrapReplyMarkerEvidence(attempt, snapshot, status.rollover.toConversationKey) ? attempt.attemptId : undefined;
}

export async function completeConversationRolloverForReply(binding: RoleBinding, attemptId: string): Promise<boolean> {
  const slotId = binding.agentSlotId;
  if (!slotId) return false;
  const status = await readNativeAgentRolloverStatus(slotId);
  if (!status || status.rollover.status !== 'bootstrapping' || status.rollover.bootstrapAttemptId !== attemptId) return false;
  await completeNativeAgentRollover(slotId, attemptId);
  return true;
}