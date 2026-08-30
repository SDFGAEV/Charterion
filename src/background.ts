import { advanceAttempt } from './attempts';
import { retainAttemptLedger } from './attemptLedger';
import { deriveManagedTasks, isRetryableTaskAttempt, validateTaskGraph } from './taskGraph';
import { planReadyDispatches } from './supervisor';
import { buildTaskDispatchPrompt } from './taskPrompt';
import { attemptBelongsToTab } from './tabAttempt';
import { applyHumanDecision, applyTaskDisposition } from './taskLifecycle';
import { applyReviewRemediation } from './reviewLoop';
import { defaultCompletionPolicy, DEFAULT_MAX_REVIEW_ROUNDS, normalizeTask } from './taskPolicy';
import { parseReviewResult } from './review';
import { assertMessageDeliveryAvailable, buildSemanticMessagePrompt, createAgentMessage, planMessageDispatch } from './messageBus';
import { createPortableManagerState, parsePortableManagerState, stringifyPortableManagerState } from './stateTransfer';
import { recoverAttempt, type AttemptRecoveryObservation } from './recovery';
import { readNativeControlSnapshot, reportNativeBrowserRuntime, reportNativeAgentBrowser } from './nativeControl';
import { filterFleetTaskTabs, planFleetReconciliation, workerRequestMessage } from './fleet';
import { deriveBrowserRuntimeObservation, fleetExpansionAllowed } from './browserRuntime';
import {
  EMPTY_BINDING,
  unavailableSnapshot,
  type AgentMessage,
  type AgentTask,
  type ChatSnapshot,
  type ContentRecoveryState,
  type CreateTaskInput,
  type ManagedTab,
  type ManagerRequest,
  type RoleBinding,
  type RuntimeNotice,
  type SendAttemptRecord,
  type SendAttemptState,
  type SendResult,
  type TaskDispatchResult,
} from './contracts';

const BINDINGS_KEY = 'bindings.v1';
const TAB_BINDINGS_KEY = 'tabBindings.v1';
const SEND_ATTEMPTS_KEY = 'sendAttempts.v1';
const TASKS_KEY = 'tasks.v1';
const MESSAGES_KEY = 'messages.v1';
const SUPERVISOR_KEY = 'supervisor.v1';
const FLEET_TABS_KEY = 'fleetTabs.v1';
const CONTROL_REQUEST_MESSAGE_PREFIX = 'control-request:';
let stateMutationTail: Promise<void> = Promise.resolve();

async function localBindings(): Promise<Record<string, RoleBinding>> {
  const stored = await chrome.storage.local.get(BINDINGS_KEY);
  return (stored[BINDINGS_KEY] as Record<string, RoleBinding> | undefined) ?? {};
}

async function sessionBindings(): Promise<Record<string, RoleBinding>> {
  const stored = await chrome.storage.session.get(TAB_BINDINGS_KEY);
  return (stored[TAB_BINDINGS_KEY] as Record<string, RoleBinding> | undefined) ?? {};
}

async function saveLocal(bindings: Record<string, RoleBinding>): Promise<void> {
  await chrome.storage.local.set({ [BINDINGS_KEY]: bindings });
}

async function saveSession(bindings: Record<string, RoleBinding>): Promise<void> {
  await chrome.storage.session.set({ [TAB_BINDINGS_KEY]: bindings });
}

async function fleetTabMap(): Promise<Record<string, number>> {
  const stored = await chrome.storage.session.get(FLEET_TABS_KEY);
  return (stored[FLEET_TABS_KEY] as Record<string, number> | undefined) ?? {};
}

async function saveFleetTabMap(value: Record<string, number>): Promise<void> {
  await chrome.storage.session.set({ [FLEET_TABS_KEY]: value });
}

interface WorkState {
  attempts: SendAttemptRecord[];
  tasks: AgentTask[];
  messages: AgentMessage[];
}

async function readWorkState(): Promise<WorkState> {
  const stored = await chrome.storage.local.get([SEND_ATTEMPTS_KEY, TASKS_KEY, MESSAGES_KEY]);
  return {
    attempts: Array.isArray(stored[SEND_ATTEMPTS_KEY]) ? stored[SEND_ATTEMPTS_KEY] as SendAttemptRecord[] : [],
    tasks: Array.isArray(stored[TASKS_KEY]) ? (stored[TASKS_KEY] as AgentTask[]).map(normalizeTask) : [],
    messages: Array.isArray(stored[MESSAGES_KEY]) ? stored[MESSAGES_KEY] as AgentMessage[] : [],
  };
}

function serializeStateMutation<T>(operation: () => Promise<T>): Promise<T> {
  const run = stateMutationTail.then(operation, operation);
  stateMutationTail = run.then(() => undefined, () => undefined);
  return run;
}

async function workState(): Promise<WorkState> {
  await stateMutationTail;
  return readWorkState();
}

async function persistAttempt(record: SendAttemptRecord): Promise<void> {
  await serializeStateMutation(async () => {
    const state = await readWorkState();
    const attempts = retainAttemptLedger([...state.attempts.filter((item) => item.attemptId !== record.attemptId), record], state.tasks, state.messages);
    await chrome.storage.local.set({ [SEND_ATTEMPTS_KEY]: attempts });
  });
}

async function transitionAttempt(record: SendAttemptRecord, state: SendAttemptState, error?: string): Promise<SendAttemptRecord> {
  return serializeStateMutation(async () => {
    const currentState = await readWorkState();
    const current = currentState.attempts.find((item) => item.attemptId === record.attemptId) ?? record;
    const next = advanceAttempt(current, state, Date.now(), error);
    const attempts = retainAttemptLedger([...currentState.attempts.filter((item) => item.attemptId !== next.attemptId), next], currentState.tasks, currentState.messages);
    await chrome.storage.local.set({ [SEND_ATTEMPTS_KEY]: attempts });
    return next;
  });
}

async function markReplyObserved(attemptId: string, snapshot: ChatSnapshot, senderTabId?: number): Promise<boolean> {
  return serializeStateMutation(async () => {
    const state = await readWorkState();
    const current = state.attempts.find((item) => item.attemptId === attemptId);
    if (!current || (senderTabId !== undefined && current.tabId !== senderTabId)) return false;
    if (current.state === 'reply-observed') return true;
    const advanced = advanceAttempt(current, 'reply-observed');
    if (advanced.state !== 'reply-observed') return false;
    const next: SendAttemptRecord = {
      ...advanced,
      replyObservedAt: Date.now(),
      replyTextTail: snapshot.latestAssistantText.slice(-8000),
    };
    if (snapshot.latestAssistantMessageId) next.replyMessageId = snapshot.latestAssistantMessageId;
    const attempts = retainAttemptLedger([...state.attempts.filter((item) => item.attemptId !== next.attemptId), next], state.tasks, state.messages);
    await chrome.storage.local.set({ [SEND_ATTEMPTS_KEY]: attempts });
    return true;
  });
}

async function recoveryStateForTab(tab: chrome.tabs.Tab): Promise<AttemptRecoveryObservation | undefined> {
  if (tab.id === undefined) return undefined;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'content:get-recovery-state' });
    if (!response?.ok || !response.state) return undefined;
    return { tabId: tab.id, state: response.state as ContentRecoveryState };
  } catch {
    return undefined;
  }
}

async function reconcileAfterRestart(): Promise<void> {
  const state = await workState();
  const active = state.attempts.filter((attempt) =>
    attempt.state === 'prepared' || attempt.state === 'dispatched' || attempt.state === 'acknowledged',
  );
  if (active.length === 0) return;

  const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*'] });
  const observations = (await Promise.all(tabs.map(recoveryStateForTab))).filter(
    (value): value is AttemptRecoveryObservation => value !== undefined,
  );
  const byTab = new Map(observations.map((observation) => [observation.tabId, observation]));

  await serializeStateMutation(async () => {
    const current = await readWorkState();
    let attempts = current.attempts;
    let changed = false;
    for (const record of active) {
      const latest = attempts.find((attempt) => attempt.attemptId === record.attemptId);
      if (!latest || latest.state !== record.state) continue;
      const decision = recoverAttempt(latest, byTab.get(latest.tabId));
      if (!decision.nextState) continue;
      const next = advanceAttempt(latest, decision.nextState, Date.now(), decision.error);
      if (next.state === latest.state && next.error === latest.error) continue;
      attempts = retainAttemptLedger([...attempts.filter((attempt) => attempt.attemptId !== next.attemptId), next], current.tasks, current.messages);
      changed = true;
    }
    if (changed) await chrome.storage.local.set({ [SEND_ATTEMPTS_KEY]: attempts });
  });
}

async function snapshotForTab(tab: chrome.tabs.Tab): Promise<ChatSnapshot> {
  const url = tab.url ?? 'https://chatgpt.com/';
  if (tab.id === undefined) return unavailableSnapshot(url, tab.title ?? 'ChatGPT');
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'content:get-snapshot' });
    if (response?.ok && response.snapshot) return response.snapshot as ChatSnapshot;
  } catch {
    // Loading/sleeping tabs may not yet have the current content script.
  }
  return unavailableSnapshot(url, tab.title ?? 'ChatGPT');
}

async function bindingFor(tabId: number, snapshot: ChatSnapshot): Promise<RoleBinding> {
  const [persistent, ephemeral] = await Promise.all([localBindings(), sessionBindings()]);
  const durable = persistent[snapshot.conversationKey];
  if (durable) return durable;
  const temporary = ephemeral[String(tabId)];
  if (!temporary) return { ...EMPTY_BINDING };
  if (snapshot.conversationId) {
    persistent[snapshot.conversationKey] = temporary;
    delete ephemeral[String(tabId)];
    await Promise.all([saveLocal(persistent), saveSession(ephemeral)]);
  }
  return temporary;
}

async function managedTabs(attempts?: readonly SendAttemptRecord[]): Promise<ManagedTab[]> {
  const [tabs, currentState] = await Promise.all([
    chrome.tabs.query({ url: ['https://chatgpt.com/*'] }),
    attempts ? Promise.resolve(undefined) : workState(),
  ]);
  const ledger = attempts ?? currentState?.attempts ?? [];
  const managed = await Promise.all(tabs.filter((tab) => tab.id !== undefined).map(async (tab) => {
    const snapshot = await snapshotForTab(tab);
    const lastAttempt = [...ledger].reverse().find((attempt) =>
      attemptBelongsToTab(attempt, tab.id!, snapshot),
    );
    const result: ManagedTab = {
      tabId: tab.id!,
      windowId: tab.windowId,
      active: tab.active,
      snapshot,
      binding: await bindingFor(tab.id!, snapshot),
    };
    if (lastAttempt) result.lastAttempt = lastAttempt;
    return result;
  }));
  return managed.sort((a, b) => a.tabId - b.tabId);
}

async function updateBinding(tabId: number, conversationKey: string, binding: RoleBinding): Promise<void> {
  const [persistent, ephemeral] = await Promise.all([localBindings(), sessionBindings()]);
  if (conversationKey.startsWith('conversation:')) {
    persistent[conversationKey] = binding;
    delete ephemeral[String(tabId)];
  } else {
    ephemeral[String(tabId)] = binding;
  }
  await Promise.all([saveLocal(persistent), saveSession(ephemeral)]);
}

async function prepareAttempt(
  tabId: number,
  snapshot: ChatSnapshot,
  text: string,
  batchId: string,
  taskId?: string,
  messageId?: string,
): Promise<SendAttemptRecord> {
  const now = Date.now();
  const record: SendAttemptRecord = {
    attemptId: crypto.randomUUID(),
    batchId,
    tabId,
    conversationKey: snapshot.conversationKey,
    state: 'prepared',
    textLength: text.length,
    baselineAssistantMessageCount: snapshot.assistantMessageCount,
    createdAt: now,
    updatedAt: now,
  };
  if (snapshot.latestAssistantMessageId) record.baselineAssistantMessageId = snapshot.latestAssistantMessageId;
  if (taskId && messageId) throw new Error('An attempt cannot belong to both a task and a message');
  if (taskId) record.taskId = taskId;
  if (messageId) record.messageId = messageId;

  await serializeStateMutation(async () => {
    const state = await readWorkState();
    const attempts = retainAttemptLedger([...state.attempts.filter((item) => item.attemptId !== record.attemptId), record], state.tasks, state.messages);
    const update: Record<string, unknown> = { [SEND_ATTEMPTS_KEY]: attempts };
    if (taskId) {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error(`Task ${taskId} disappeared before dispatch`);
      update[TASKS_KEY] = state.tasks.map((item) => item.id === taskId
        ? { ...item, attemptIds: [...item.attemptIds, record.attemptId], updatedAt: now }
        : item);
    }
    if (messageId) {
      const message = state.messages.find((item) => item.id === messageId);
      if (!message) throw new Error(`Message ${messageId} disappeared before dispatch`);
      assertMessageDeliveryAvailable(message, state.attempts, snapshot.conversationKey);
      update[MESSAGES_KEY] = state.messages.map((item) => item.id === messageId
        ? { ...item, attemptIds: [...item.attemptIds, record.attemptId], updatedAt: now }
        : item);
    }
    await chrome.storage.local.set(update);
  });
  return record;
}

async function dispatchToTab(tabId: number, text: string, batchId: string, taskId?: string, messageId?: string): Promise<SendResult> {
  let record: SendAttemptRecord | undefined;
  const fallbackAttemptId = crypto.randomUUID();
  try {
    const tab = await chrome.tabs.get(tabId);
    const snapshot = await snapshotForTab(tab);
    record = await prepareAttempt(tabId, snapshot, text, batchId, taskId, messageId);
    if (snapshot.status !== 'idle') {
      const error = `Refusing send while ChatGPT status is ${snapshot.status}`;
      await transitionAttempt(record, 'failed', error);
      return { tabId, attemptId: record.attemptId, ok: false, error };
    }
    record = await transitionAttempt(record, 'dispatched');
    let response: { ok?: boolean; duplicate?: boolean; error?: string } | undefined;
    try {
      response = await chrome.tabs.sendMessage(tabId, { type: 'content:send', text, attemptId: record.attemptId });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await transitionAttempt(record, 'uncertain', reason);
      return { tabId, attemptId: record.attemptId, ok: false, error: `Delivery outcome is uncertain: ${reason}` };
    }
    if (!response?.ok) {
      const error = response?.error ?? 'ChatGPT page rejected the send';
      await transitionAttempt(record, 'failed', error);
      return { tabId, attemptId: record.attemptId, ok: false, error };
    }
    await transitionAttempt(record, 'acknowledged');
    return { tabId, attemptId: record.attemptId, ok: true, duplicate: response.duplicate === true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (record) await transitionAttempt(record, record.state === 'dispatched' ? 'uncertain' : 'failed', reason);
    return { tabId, attemptId: record?.attemptId ?? fallbackAttemptId, ok: false, error: reason };
  }
}

async function sendToTabs(tabIds: number[], text: string): Promise<SendResult[]> {
  const batchId = crypto.randomUUID();
  const results: SendResult[] = [];
  for (const tabId of [...new Set(tabIds)]) results.push(await dispatchToTab(tabId, text, batchId));
  return results;
}

async function createTask(input: CreateTaskInput): Promise<AgentTask> {
  return serializeStateMutation(async () => {
    const state = await readWorkState();
    const now = Date.now();
    const task: AgentTask = {
      id: crypto.randomUUID(),
      kind: input.kind,
      completionPolicy: input.completionPolicy ?? defaultCompletionPolicy(input.kind),
      title: input.title.trim(),
      project: input.project.trim(),
      instruction: input.instruction.trim(),
      targetRole: input.kind === 'human' ? '' : input.targetRole.trim(),
      dependsOn: [...new Set(input.dependsOn.map((id) => id.trim()).filter(Boolean))],
      attemptIds: [],
      createdAt: now,
      updatedAt: now,
    };
    if (input.kind === 'review') {
      if (input.reviewTargetTaskId) task.reviewTargetTaskId = input.reviewTargetTaskId.trim();
      task.maxReviewRounds = input.maxReviewRounds ?? DEFAULT_MAX_REVIEW_ROUNDS;
    }
    const tasks = [...state.tasks, task];
    validateTaskGraph(tasks);
    await chrome.storage.local.set({ [TASKS_KEY]: tasks });
    return task;
  });
}

async function createMessage(input: import('./contracts').CreateAgentMessageInput): Promise<AgentMessage> {
  return serializeStateMutation(async () => {
    const state = await readWorkState();
    const message = createAgentMessage(input, crypto.randomUUID());
    const messages = [...state.messages, message];
    await chrome.storage.local.set({ [MESSAGES_KEY]: messages });
    return message;
  });
}

async function freezeMessageRecipients(
  messageId: string,
  recipientConversationKeys: readonly string[],
): Promise<AgentMessage> {
  return serializeStateMutation(async () => {
    const state = await readWorkState();
    const current = state.messages.find((item) => item.id === messageId);
    if (!current) throw new Error(`Message ${messageId} disappeared before recipient freeze`);
    if (current.recipientConversationKeys) return current;
    if (recipientConversationKeys.length === 0) throw new Error('Cannot freeze an empty recipient set');
    const updated: AgentMessage = {
      ...current,
      recipientConversationKeys: [...recipientConversationKeys],
      updatedAt: Date.now(),
    };
    const messages = state.messages.map((item) => item.id === messageId ? updated : item);
    await chrome.storage.local.set({ [MESSAGES_KEY]: messages });
    return updated;
  });
}

async function dispatchMessage(messageId: string): Promise<SendResult[]> {
  let state = await workState();
  let message = state.messages.find((item) => item.id === messageId);
  if (!message) throw new Error(`Message ${messageId} does not exist`);
  let tabs = await managedTabs(state.attempts);
  let plan = planMessageDispatch(message, state.attempts, tabs);
  if (plan.error) throw new Error(plan.error);

  if (!message.recipientConversationKeys) {
    if (!plan.recipientConversationKeys?.length) throw new Error('Message recipient discovery produced no recipients');
    message = await freezeMessageRecipients(message.id, plan.recipientConversationKeys);
    state = await workState();
    tabs = await managedTabs(state.attempts);
    plan = planMessageDispatch(message, state.attempts, tabs);
    if (plan.error) throw new Error(plan.error);
  }

  if (plan.tabIds.length === 0) return [];
  const prompt = buildSemanticMessagePrompt(message);
  const batchId = crypto.randomUUID();
  const results: SendResult[] = [];
  for (const tabId of plan.tabIds) {
    results.push(await dispatchToTab(tabId, prompt, batchId, undefined, message.id));
  }
  return results;
}

async function requestTaskRetry(taskId: string): Promise<AgentTask> {
  return serializeStateMutation(async () => {
    const state = await readWorkState();
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Task ${taskId} does not exist`);
    const lastAttemptId = task.attemptIds.at(-1);
    if (!lastAttemptId) throw new Error('Task has no failed or uncertain attempt to retry');
    const lastAttempt = state.attempts.find((attempt) => attempt.attemptId === lastAttemptId);
    if (!isRetryableTaskAttempt(task, lastAttempt)) {
      throw new Error('This task does not have a retryable failed, uncertain, or protocol-invalid review attempt');
    }
    if (task.kind === 'review' && lastAttempt?.state === 'reply-observed') {
      const parsed = parseReviewResult(lastAttempt.replyTextTail ?? '');
      if (parsed.ok && parsed.result.decision === 'fail') {
        throw new Error('A failed review must use the bounded revise-and-re-review action');
      }
    }
    const updated: AgentTask = { ...task, retryAfterAttemptId: lastAttemptId, updatedAt: Date.now() };
    const tasks = state.tasks.map((item) => item.id === taskId ? updated : item);
    await chrome.storage.local.set({ [TASKS_KEY]: tasks });
    return updated;
  });
}
async function setTaskDisposition(taskId: string, action: 'skip' | 'cancel', reason = ''): Promise<AgentTask> {
  return serializeStateMutation(async () => {
    const state = await readWorkState();
    const managed = deriveManagedTasks(state.tasks, state.attempts).find((item) => item.task.id === taskId);
    if (!managed) throw new Error(`Task ${taskId} does not exist`);
    const updated = applyTaskDisposition(managed.task, managed.status, action, Date.now(), reason);
    const tasks = state.tasks.map((task) => task.id === taskId ? updated : task);
    await chrome.storage.local.set({ [TASKS_KEY]: tasks });
    return updated;
  });
}

async function decideHumanTask(taskId: string, decision: 'approve' | 'reject', reason = ''): Promise<AgentTask> {
  return serializeStateMutation(async () => {
    const state = await readWorkState();
    const managed = deriveManagedTasks(state.tasks, state.attempts).find((item) => item.task.id === taskId);
    if (!managed) throw new Error(`Task ${taskId} does not exist`);
    const updated = applyHumanDecision(managed.task, managed.status, decision, Date.now(), reason);
    const tasks = state.tasks.map((task) => task.id === taskId ? updated : task);
    await chrome.storage.local.set({ [TASKS_KEY]: tasks });
    return updated;
  });
}

async function retryReviewLoop(taskId: string): Promise<{ reviewTask: AgentTask; targetTask: AgentTask }> {
  return serializeStateMutation(async () => {
    const state = await readWorkState();
    const reviewTask = state.tasks.find((task) => task.id === taskId);
    if (!reviewTask || reviewTask.kind !== 'review' || !reviewTask.reviewTargetTaskId) throw new Error(`Review task ${taskId} does not have a review target`);
    const targetTask = state.tasks.find((task) => task.id === reviewTask.reviewTargetTaskId);
    if (!targetTask) throw new Error(`Review target ${reviewTask.reviewTargetTaskId} does not exist`);
    const reviewAttemptId = reviewTask.attemptIds.at(-1);
    const targetAttemptId = targetTask.attemptIds.at(-1);
    const reviewAttempt = reviewAttemptId ? state.attempts.find((attempt) => attempt.attemptId === reviewAttemptId) : undefined;
    const targetAttempt = targetAttemptId ? state.attempts.find((attempt) => attempt.attemptId === targetAttemptId) : undefined;
    if (!reviewAttempt || !targetAttempt) throw new Error('Review loop is missing attempt evidence');
    const updated = applyReviewRemediation(reviewTask, targetTask, reviewAttempt, targetAttempt);
    const tasks = state.tasks.map((task) => task.id === updated.reviewTask.id ? updated.reviewTask : task.id === updated.targetTask.id ? updated.targetTask : task);
    validateTaskGraph(tasks);
    await chrome.storage.local.set({ [TASKS_KEY]: tasks });
    return updated;
  });
}

async function exportStateDocument(): Promise<string> {
  const [bindings, state, enabled] = await Promise.all([localBindings(), workState(), supervisorEnabled()]);
  return stringifyPortableManagerState(createPortableManagerState(bindings, state.tasks, state.attempts, state.messages, enabled));
}

async function importStateDocument(document: string): Promise<void> {
  const imported = parsePortableManagerState(document);
  await serializeStateMutation(async () => {
    await chrome.storage.local.set({
      [BINDINGS_KEY]: imported.bindings,
      [TASKS_KEY]: imported.tasks,
      [SEND_ATTEMPTS_KEY]: imported.attempts,
      [MESSAGES_KEY]: imported.messages,
      [SUPERVISOR_KEY]: imported.supervisorEnabled,
    });
    await chrome.storage.session.remove(TAB_BINDINGS_KEY);
  });
}
async function supervisorEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(SUPERVISOR_KEY);
  return stored[SUPERVISOR_KEY] === true;
}

async function setSupervisorEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [SUPERVISOR_KEY]: enabled });
}

async function runReadyTasks(): Promise<TaskDispatchResult[]> {
  const state = await workState();
  validateTaskGraph(state.tasks);
  const tasks = deriveManagedTasks(state.tasks, state.attempts);
  const tabs = await managedTabs(state.attempts);
  let dispatchTabs = tabs;
  try { const [snapshot, mapping] = await Promise.all([readNativeControlSnapshot(), fleetTabMap()]); dispatchTabs = filterFleetTaskTabs(tabs, snapshot.agents, mapping); } catch { /* local control plane is optional for browser-only orchestration */ }
  const byTaskId = new Map(tasks.map((managed) => [managed.task.id, managed]));
  const decisions = planReadyDispatches(tasks, dispatchTabs);
  const results: TaskDispatchResult[] = [];
  const batchId = crypto.randomUUID();

  for (const decision of decisions) {
    if (decision.tabId === undefined) {
      results.push({ taskId: decision.taskId, ok: false, error: decision.error ?? 'Task is not dispatchable' });
      continue;
    }
    const managed = byTaskId.get(decision.taskId);
    if (!managed) continue;
    const dependencies = managed.task.dependsOn
      .map((taskId) => byTaskId.get(taskId))
      .filter((dependency): dependency is NonNullable<typeof dependency> => dependency !== undefined);
    const instruction = buildTaskDispatchPrompt(managed.task, dependencies);
    const sent = await dispatchToTab(decision.tabId, instruction, batchId, managed.task.id);
    const result: TaskDispatchResult = { taskId: managed.task.id, ok: sent.ok, attemptId: sent.attemptId };
    if (sent.error) result.error = sent.error;
    results.push(result);
  }
  return results;
}

let supervisorRun: Promise<void> | undefined;

function kickSupervisor(): void {
  if (supervisorRun) return;
  supervisorRun = (async () => {
    if (!await supervisorEnabled()) return;
    await runReadyTasks();
    await notifyManagerChanged();
  })().catch(() => {
    // The UI derives the actionable error from task/tab state; auto mode never
    // retries by inventing a route or weakening a status gate.
  }).finally(() => {
    supervisorRun = undefined;
  });
}
async function focusTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

let browserReportTimer: number | undefined;

async function reportBrowserRuntimeFromTabs(tabs: ManagedTab[]): Promise<void> {
  const runtime = deriveBrowserRuntimeObservation(tabs.map((tab) => tab.snapshot.status));
  await reportNativeBrowserRuntime({
    profileId: 'gam-default',
    authStatus: runtime.authStatus,
    pageHealth: runtime.pageHealth,
    openTabs: tabs.length,
    extensionVersion: chrome.runtime.getManifest().version,
    observedAt: Date.now(),
  });
}

function scheduleBrowserRuntimeReport(): void {
  if (browserReportTimer !== undefined) clearTimeout(browserReportTimer);
  browserReportTimer = setTimeout(() => {
    browserReportTimer = undefined;
    void workState().then((state) => managedTabs(state.attempts)).then(reportBrowserRuntimeFromTabs).catch(() => undefined);
  }, 250) as unknown as number;
}
let fleetReconcileRun: Promise<void> | undefined;
let fleetReconcileTimer: number | undefined;

async function clearFleetBinding(conversationKey: string | undefined, tabId: number | undefined): Promise<void> {
  const [persistent, ephemeral] = await Promise.all([localBindings(), sessionBindings()]);
  if (conversationKey) delete persistent[conversationKey];
  if (tabId !== undefined) delete ephemeral[String(tabId)];
  await Promise.all([saveLocal(persistent), saveSession(ephemeral)]);
}

async function syncWorkerRequestMessages(snapshot: import('./nativeControl').NativeControlSnapshot): Promise<void> {
  await serializeStateMutation(async () => {
    const state = await readWorkState();
    const existing = new Set(state.messages.map((message) => message.id));
    const projects = new Map(snapshot.projects.map((project) => [project.id, project]));
    const agents = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
    const created: AgentMessage[] = [];
    for (const request of snapshot.workerRequests) {
      if (request.status !== 'open') continue;
      const messageId = CONTROL_REQUEST_MESSAGE_PREFIX + request.id;
      if (existing.has(messageId)) continue;
      const project = projects.get(request.projectId);
      if (!project) continue;
      const supervisors = snapshot.agents.filter((agent) =>
        agent.projectId === request.projectId && agent.desiredState === 'active' &&
        agent.role.trim().toUpperCase() === 'SUPERVISOR',
      );
      if (supervisors.length !== 1) continue;
      const supervisor = supervisors[0];
      if (!supervisor) continue;
      const senderRole = agents.get(request.fromSubject)?.role ?? request.fromSubject;
      created.push(workerRequestMessage(request, project.name, senderRole, supervisor.role));
    }
    if (created.length) {
      await chrome.storage.local.set({ [MESSAGES_KEY]: [...state.messages, ...created] });
    }
  });
}

async function deliverWorkerRequestMessages(snapshot: import('./nativeControl').NativeControlSnapshot): Promise<void> {
  await syncWorkerRequestMessages(snapshot);
  const openIds = new Set(snapshot.workerRequests
    .filter((request) => request.status === 'open')
    .map((request) => CONTROL_REQUEST_MESSAGE_PREFIX + request.id));
  const state = await workState();
  for (const message of state.messages) {
    if (!openIds.has(message.id)) continue;
    try {
      await dispatchMessage(message.id);
    } catch {
      // Busy/missing/uncertain delivery is retried or held by the existing message ledger.
    }
  }
}

async function reconcileAgentFleet(): Promise<void> {
  if (fleetReconcileRun) return fleetReconcileRun;
  fleetReconcileRun = (async () => {
    const snapshot = await readNativeControlSnapshot();
    const state = await workState();
    const currentTabs = await managedTabs(state.attempts);
    const mapping = await fleetTabMap();
    const actions = planFleetReconciliation(snapshot.agents, currentTabs, mapping);
    const latestRuntime = [...snapshot.browserRuntime].sort((a, b) => b.observedAt - a.observedAt)[0];
    const currentRuntime = deriveBrowserRuntimeObservation(currentTabs.map((tab) => tab.snapshot.status));
    const expansionAllowed = fleetExpansionAllowed(currentRuntime, latestRuntime, Date.now());
    const projects = new Map(snapshot.projects.map((project) => [project.id, project]));
    const agents = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
    for (const action of actions) {
      const agent = agents.get(action.slotId); if (!agent) continue;
      const project = projects.get(agent.projectId); if (!project) continue;
      if (action.kind === 'open') {
        if (!expansionAllowed) continue;
        const tab = await chrome.tabs.create({ url: action.url, active: false });
        if (tab.id === undefined) throw new Error(`Chrome did not return a tab id for agent slot ${agent.id}`);
        mapping[agent.id] = tab.id; await saveFleetTabMap(mapping);
        const key = agent.conversationKey ?? `url:${action.url}`;
        await updateBinding(tab.id, key, { role: agent.role, project: project.name, notes: `GAM fleet slot ${agent.id}` });
        await reportNativeAgentBrowser({ slotId: agent.id, profileId: 'gam-default', browserState: 'opening', tabId: tab.id, observedAt: Date.now() });
      } else if (action.kind === 'close') {
        await reportNativeAgentBrowser({ slotId: agent.id, profileId: 'gam-default', browserState: 'closing', tabId: action.tabId, observedAt: Date.now() });
        await clearFleetBinding(agent.conversationKey, action.tabId);
        try { await chrome.tabs.remove(action.tabId); } catch { /* tab may already be gone */ }
        delete mapping[agent.id]; await saveFleetTabMap(mapping);
        await reportNativeAgentBrowser({ slotId: agent.id, profileId: 'gam-default', browserState: 'absent', observedAt: Date.now() });
      } else if (action.kind === 'report-open') {
        mapping[agent.id] = action.tabId; await saveFleetTabMap(mapping);
        const tab = currentTabs.find((item) => item.tabId === action.tabId);
        if (tab && (tab.binding.role !== agent.role || tab.binding.project !== project.name)) {
          await updateBinding(tab.tabId, action.conversationKey ?? tab.snapshot.conversationKey, { role: agent.role, project: project.name, notes: `GAM fleet slot ${agent.id}` });
        }
        await reportNativeAgentBrowser({ slotId: agent.id, profileId: 'gam-default', browserState: 'open', tabId: action.tabId, ...(action.conversationKey ? { conversationKey: action.conversationKey } : {}), observedAt: Date.now() });
      } else {
        delete mapping[agent.id]; await saveFleetTabMap(mapping);
        await reportNativeAgentBrowser({ slotId: agent.id, profileId: 'gam-default', browserState: 'absent', observedAt: Date.now() });
      }
    }
    await deliverWorkerRequestMessages(snapshot);
  })().finally(() => { fleetReconcileRun = undefined; });
  return fleetReconcileRun;
}

function scheduleFleetReconcile(delayMs = 150): void {
  if (fleetReconcileTimer !== undefined) clearTimeout(fleetReconcileTimer);
  fleetReconcileTimer = setTimeout(() => { fleetReconcileTimer = undefined; void reconcileAgentFleet().catch(() => undefined); }, delayMs) as unknown as number;
}

async function notifyManagerChanged(): Promise<void> {
  const notice: RuntimeNotice = { type: 'manager:changed' };
  try { await chrome.runtime.sendMessage(notice); } catch { /* no side panel open */ }
}

chrome.runtime.onMessage.addListener((message: ManagerRequest | RuntimeNotice, sender, sendResponse) => {
  if (message.type === 'content:changed') {
    void notifyManagerChanged();
    scheduleBrowserRuntimeReport();
    scheduleFleetReconcile();
    kickSupervisor();
    return false;
  }
  if (message.type === 'content:reply-observed') {
    void markReplyObserved(message.attemptId, message.snapshot, sender.tab?.id)
      .then(async (persisted) => {
        if (persisted) {
          await notifyManagerChanged();
          kickSupervisor();
        }
        sendResponse({ ok: persisted });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === 'manager:list') {
    void (async () => {
      const state = await workState();
      validateTaskGraph(state.tasks);
      const [tabs, tasks] = await Promise.all([
        managedTabs(state.attempts),
        Promise.resolve(deriveManagedTasks(state.tasks, state.attempts)),
      ]);
      const attemptsById = new Map(state.attempts.map((attempt) => [attempt.attemptId, attempt]));
      const messages = state.messages.map((message) => ({
        message,
        attemptHistory: message.attemptIds.map((id) => attemptsById.get(id)).filter(Boolean),
      }));
      void reportBrowserRuntimeFromTabs(tabs).catch(() => undefined);
      sendResponse({ ok: true, tabs, tasks, messages, supervisorEnabled: await supervisorEnabled() });
    })().catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === 'manager:update-binding') {
    void updateBinding(message.tabId, message.conversationKey, message.binding)
      .then(() => notifyManagerChanged())
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === 'manager:send') {
    void sendToTabs(message.tabIds, message.text).then(async (results) => {
      await notifyManagerChanged();
      sendResponse({ ok: true, results });
    });
    return true;
  }
  if (message.type === 'manager:create-task') {
    void createTask(message.input)
      .then(async (task) => { await notifyManagerChanged(); kickSupervisor(); sendResponse({ ok: true, task }); })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === 'manager:create-message') {
    void createMessage(message.input)
      .then(async (created) => { await notifyManagerChanged(); sendResponse({ ok: true, message: created }); })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === 'manager:dispatch-message') {
    void dispatchMessage(message.messageId)
      .then(async (results) => { await notifyManagerChanged(); sendResponse({ ok: true, results }); })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === 'manager:run-ready-tasks') {
    void runReadyTasks()
      .then(async (results) => { await notifyManagerChanged(); sendResponse({ ok: true, results }); })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }  if (message.type === 'manager:retry-task') {
    void requestTaskRetry(message.taskId)
      .then(async (task) => { await notifyManagerChanged(); kickSupervisor(); sendResponse({ ok: true, task }); })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }  if (message.type === 'manager:retry-review-loop') {
    void retryReviewLoop(message.taskId)
      .then(async (updated) => { await notifyManagerChanged(); kickSupervisor(); sendResponse({ ok: true, ...updated }); })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === 'manager:decide-human-task') {
    void decideHumanTask(message.taskId, message.decision, message.reason ?? '')
      .then(async (task) => { await notifyManagerChanged(); kickSupervisor(); sendResponse({ ok: true, task }); })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === 'manager:skip-task') {
    void setTaskDisposition(message.taskId, 'skip', message.reason ?? '')
      .then(async (task) => { await notifyManagerChanged(); kickSupervisor(); sendResponse({ ok: true, task }); })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === 'manager:cancel-task') {
    void setTaskDisposition(message.taskId, 'cancel', message.reason ?? '')
      .then(async (task) => { await notifyManagerChanged(); kickSupervisor(); sendResponse({ ok: true, task }); })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === 'manager:control-snapshot') {
    if (sender.tab) {
      sendResponse({ ok: false, error: 'Native control requests are only accepted from extension UI contexts' });
      return false;
    }
    void readNativeControlSnapshot()
      .then((snapshot) => sendResponse({ ok: true, snapshot }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === 'manager:export-state') {
    void exportStateDocument()
      .then((document) => sendResponse({ ok: true, document }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === 'manager:import-state') {
    void importStateDocument(message.document)
      .then(async () => { await notifyManagerChanged(); if (await supervisorEnabled()) kickSupervisor(); sendResponse({ ok: true }); })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === 'manager:set-supervisor-enabled') {
    void setSupervisorEnabled(message.enabled)
      .then(async () => { await notifyManagerChanged(); if (message.enabled) kickSupervisor(); sendResponse({ ok: true }); })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === 'manager:focus') {
    void focusTab(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  return false;
});

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.url?.startsWith('https://chatgpt.com/') && (changeInfo.status === 'complete' || changeInfo.url !== undefined)) {
    void notifyManagerChanged();
    scheduleFleetReconcile();
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const bindings = await sessionBindings();
    if (bindings[String(tabId)] === undefined) return;
    delete bindings[String(tabId)];
    await saveSession(bindings);
    await notifyManagerChanged();
    scheduleFleetReconcile();
  })();
});

void reconcileAfterRestart().then(() => {
  void notifyManagerChanged();
  kickSupervisor();
  scheduleFleetReconcile(0);
}).catch(() => {
  // Recovery is fail-closed: unresolved attempts remain non-ready until inspected.
});
const FLEET_RECONCILE_ALARM = 'gam:fleet-reconcile';
async function ensureFleetReconcileAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(FLEET_RECONCILE_ALARM);
  if (!existing) chrome.alarms.create(FLEET_RECONCILE_ALARM, { periodInMinutes: 1 });
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== FLEET_RECONCILE_ALARM) return;
  scheduleBrowserRuntimeReport();
  scheduleFleetReconcile(0);
});
chrome.runtime.onInstalled.addListener(() => { void ensureFleetReconcileAlarm(); scheduleFleetReconcile(0); });
chrome.runtime.onStartup.addListener(() => { void ensureFleetReconcileAlarm(); scheduleFleetReconcile(0); });
void ensureFleetReconcileAlarm();
