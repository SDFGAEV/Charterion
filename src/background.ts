import { advanceAttempt } from './attempts';
import { deriveManagedTasks, validateTaskGraph } from './taskGraph';
import { planReadyDispatches } from './supervisor';
import {
  EMPTY_BINDING,
  unavailableSnapshot,
  type AgentTask,
  type ChatSnapshot,
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
const SUPERVISOR_KEY = 'supervisor.v1';
const MAX_SEND_ATTEMPTS = 500;
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

interface WorkState {
  attempts: SendAttemptRecord[];
  tasks: AgentTask[];
}

async function readWorkState(): Promise<WorkState> {
  const stored = await chrome.storage.local.get([SEND_ATTEMPTS_KEY, TASKS_KEY]);
  return {
    attempts: Array.isArray(stored[SEND_ATTEMPTS_KEY]) ? stored[SEND_ATTEMPTS_KEY] as SendAttemptRecord[] : [],
    tasks: Array.isArray(stored[TASKS_KEY]) ? stored[TASKS_KEY] as AgentTask[] : [],
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
    const attempts = [...state.attempts.filter((item) => item.attemptId !== record.attemptId), record].slice(-MAX_SEND_ATTEMPTS);
    await chrome.storage.local.set({ [SEND_ATTEMPTS_KEY]: attempts });
  });
}

async function transitionAttempt(record: SendAttemptRecord, state: SendAttemptState, error?: string): Promise<SendAttemptRecord> {
  return serializeStateMutation(async () => {
    const currentState = await readWorkState();
    const current = currentState.attempts.find((item) => item.attemptId === record.attemptId) ?? record;
    const next = advanceAttempt(current, state, Date.now(), error);
    const attempts = [...currentState.attempts.filter((item) => item.attemptId !== next.attemptId), next].slice(-MAX_SEND_ATTEMPTS);
    await chrome.storage.local.set({ [SEND_ATTEMPTS_KEY]: attempts });
    return next;
  });
}

async function markReplyObserved(attemptId: string, snapshot: ChatSnapshot, senderTabId?: number): Promise<void> {
  await serializeStateMutation(async () => {
    const state = await readWorkState();
    const current = state.attempts.find((item) => item.attemptId === attemptId);
    if (!current || (senderTabId !== undefined && current.tabId !== senderTabId)) return;
    const advanced = advanceAttempt(current, 'reply-observed');
    if (advanced.state !== 'reply-observed') return;
    const next: SendAttemptRecord = { ...advanced, replyObservedAt: Date.now() };
    if (snapshot.latestAssistantMessageId) next.replyMessageId = snapshot.latestAssistantMessageId;
    const attempts = [...state.attempts.filter((item) => item.attemptId !== next.attemptId), next].slice(-MAX_SEND_ATTEMPTS);
    await chrome.storage.local.set({ [SEND_ATTEMPTS_KEY]: attempts });
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
      attempt.conversationKey === snapshot.conversationKey || attempt.tabId === tab.id,
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
  if (taskId) record.taskId = taskId;

  await serializeStateMutation(async () => {
    const state = await readWorkState();
    const attempts = [...state.attempts.filter((item) => item.attemptId !== record.attemptId), record].slice(-MAX_SEND_ATTEMPTS);
    if (!taskId) {
      await chrome.storage.local.set({ [SEND_ATTEMPTS_KEY]: attempts });
      return;
    }
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Task ${taskId} disappeared before dispatch`);
    const tasks = state.tasks.map((item) => item.id === taskId
      ? { ...item, attemptIds: [...item.attemptIds, record.attemptId], updatedAt: now }
      : item);
    await chrome.storage.local.set({ [SEND_ATTEMPTS_KEY]: attempts, [TASKS_KEY]: tasks });
  });
  return record;
}

async function dispatchToTab(tabId: number, text: string, batchId: string, taskId?: string): Promise<SendResult> {
  let record: SendAttemptRecord | undefined;
  const fallbackAttemptId = crypto.randomUUID();
  try {
    const tab = await chrome.tabs.get(tabId);
    const snapshot = await snapshotForTab(tab);
    record = await prepareAttempt(tabId, snapshot, text, batchId, taskId);
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
      title: input.title.trim(),
      project: input.project.trim(),
      instruction: input.instruction.trim(),
      targetRole: input.targetRole.trim(),
      dependsOn: [...new Set(input.dependsOn.map((id) => id.trim()).filter(Boolean))],
      attemptIds: [],
      createdAt: now,
      updatedAt: now,
    };
    const tasks = [...state.tasks, task];
    validateTaskGraph(tasks);
    await chrome.storage.local.set({ [TASKS_KEY]: tasks });
    return task;
  });
}

async function requestTaskRetry(taskId: string): Promise<AgentTask> {
  return serializeStateMutation(async () => {
    const state = await readWorkState();
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Task ${taskId} does not exist`);
    const lastAttemptId = task.attemptIds.at(-1);
    if (!lastAttemptId) throw new Error('Task has no failed or uncertain attempt to retry');
    const lastAttempt = state.attempts.find((attempt) => attempt.attemptId === lastAttemptId);
    if (!lastAttempt || (lastAttempt.state !== 'failed' && lastAttempt.state !== 'uncertain')) {
      throw new Error('Only failed or uncertain tasks can be retried');
    }
    const updated: AgentTask = { ...task, retryAfterAttemptId: lastAttemptId, updatedAt: Date.now() };
    const tasks = state.tasks.map((item) => item.id === taskId ? updated : item);
    await chrome.storage.local.set({ [TASKS_KEY]: tasks });
    return updated;
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
  const byTaskId = new Map(tasks.map((managed) => [managed.task.id, managed]));
  const decisions = planReadyDispatches(tasks, tabs);
  const results: TaskDispatchResult[] = [];
  const batchId = crypto.randomUUID();

  for (const decision of decisions) {
    if (decision.tabId === undefined) {
      results.push({ taskId: decision.taskId, ok: false, error: decision.error ?? 'Task is not dispatchable' });
      continue;
    }
    const managed = byTaskId.get(decision.taskId);
    if (!managed) continue;
    const sent = await dispatchToTab(decision.tabId, managed.task.instruction, batchId, managed.task.id);
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

async function notifyManagerChanged(): Promise<void> {
  const notice: RuntimeNotice = { type: 'manager:changed' };
  try { await chrome.runtime.sendMessage(notice); } catch { /* no side panel open */ }
}

chrome.runtime.onMessage.addListener((message: ManagerRequest | RuntimeNotice, sender, sendResponse) => {
  if (message.type === 'content:changed') {
    void notifyManagerChanged();
    kickSupervisor();
    return false;
  }
  if (message.type === 'content:reply-observed') {
    void markReplyObserved(message.attemptId, message.snapshot, sender.tab?.id).then(async () => {
      await notifyManagerChanged();
      kickSupervisor();
    });
    return false;
  }
  if (message.type === 'manager:list') {
    void (async () => {
      const state = await workState();
      validateTaskGraph(state.tasks);
      const [tabs, tasks] = await Promise.all([
        managedTabs(state.attempts),
        Promise.resolve(deriveManagedTasks(state.tasks, state.attempts)),
      ]);
      sendResponse({ ok: true, tabs, tasks, supervisorEnabled: await supervisorEnabled() });
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
  }  if (message.type === 'manager:set-supervisor-enabled') {
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
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const bindings = await sessionBindings();
    if (bindings[String(tabId)] === undefined) return;
    delete bindings[String(tabId)];
    await saveSession(bindings);
    await notifyManagerChanged();
  })();
});