import type {
  CreateTaskInput,
  ManagedTab,
  ManagedTask,
  RoleBinding,
  RuntimeNotice,
  SendResult,
  TaskDispatchResult,
  TaskKind,
} from './contracts';

const agentsRoot = required<HTMLDivElement>('agents');
const tasksRoot = required<HTMLDivElement>('tasks');
const emptyState = required<HTMLDivElement>('empty');
const summary = required<HTMLSpanElement>('summary');
const instruction = required<HTMLTextAreaElement>('instruction');
const sendStatus = required<HTMLParagraphElement>('send-status');
const taskStatus = required<HTMLParagraphElement>('task-status');
const selected = new Set<number>();
let tabs: ManagedTab[] = [];
let tasks: ManagedTask[] = [];
let supervisorEnabled = false;
let refreshTimer: number | undefined;

function required<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing side panel element #${id}`);
  return node as T;
}

async function request<T>(message: object): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error ?? 'Manager request failed');
  return response as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function setStatus(node: HTMLElement, text: string, isError = false): void {
  node.textContent = text;
  node.classList.toggle('error', isError);
}

function bindingInput(labelText: string, value: string, wide = false): { wrap: HTMLLabelElement; input: HTMLInputElement } {
  const wrap = el('label', wide ? 'wide' : undefined);
  wrap.append(document.createTextNode(labelText));
  const input = el('input');
  input.value = value;
  input.autocomplete = 'off';
  wrap.append(input);
  return { wrap, input };
}

async function persistBinding(tab: ManagedTab, inputs: readonly [HTMLInputElement, HTMLInputElement, HTMLInputElement]): Promise<void> {
  const binding: RoleBinding = {
    role: inputs[0].value.trim(),
    project: inputs[1].value.trim(),
    notes: inputs[2].value.trim(),
  };
  await request({ type: 'manager:update-binding', tabId: tab.tabId, conversationKey: tab.snapshot.conversationKey, binding });
}

function renderAgent(tab: ManagedTab): HTMLElement {
  const card = el('article', 'agent-card');
  const head = el('div', 'agent-head');
  const checkbox = el('input', 'agent-select');
  checkbox.type = 'checkbox';
  checkbox.checked = selected.has(tab.tabId);
  checkbox.addEventListener('change', () => checkbox.checked ? selected.add(tab.tabId) : selected.delete(tab.tabId));

  const title = el('div', 'agent-title');
  const strong = el('strong');
  strong.textContent = tab.binding.role || tab.snapshot.title;
  const small = el('small');
  small.textContent = tab.binding.project || tab.snapshot.title;
  title.append(strong, small);

  const badge = el('span', `status status-${tab.snapshot.status}`);
  badge.textContent = tab.snapshot.status;
  head.append(checkbox, title, badge);
  card.append(head);

  const grid = el('div', 'binding-grid');
  const role = bindingInput('Role', tab.binding.role);
  const project = bindingInput('Project', tab.binding.project);
  const notes = bindingInput('Notes', tab.binding.notes, true);
  const inputs = [role.input, project.input, notes.input] as const;
  for (const input of inputs) input.addEventListener('change', () => {
    void persistBinding(tab, inputs).catch((error) => setStatus(sendStatus, String(error), true));
  });
  grid.append(role.wrap, project.wrap, notes.wrap);
  card.append(grid);

  if (tab.snapshot.latestAssistantText) {
    const latest = el('div', 'latest');
    latest.textContent = tab.snapshot.latestAssistantText;
    card.append(latest);
  }
  if (tab.lastAttempt) {
    const attempt = el('div', `attempt attempt-${tab.lastAttempt.state}`);
    const replySuffix = tab.lastAttempt.replyMessageId ? ` · ${tab.lastAttempt.replyMessageId}` : '';
    attempt.textContent = `Last send: ${tab.lastAttempt.state}${replySuffix}`;
    card.append(attempt);
  }

  const actions = el('div', 'agent-actions');
  const focus = el('button');
  focus.type = 'button';
  focus.textContent = 'Focus tab';
  focus.addEventListener('click', () => {
    void request({ type: 'manager:focus', tabId: tab.tabId }).catch((error) => setStatus(sendStatus, String(error), true));
  });
  actions.append(focus);
  card.append(actions);
  return card;
}

function renderTask(managed: ManagedTask): HTMLElement {
  const card = el('article', 'task-card');
  const head = el('div', 'task-head');
  const title = el('div', 'task-title');
  const strong = el('strong');
  strong.textContent = managed.task.title;
  const small = el('small');
  small.textContent = `${managed.task.kind} · ${managed.task.targetRole}${managed.task.project ? ` · ${managed.task.project}` : ''}`;
  title.append(strong, small);
  const badge = el('span', `task-state task-state-${managed.status}`);
  badge.textContent = managed.status;
  head.append(title, badge);
  card.append(head);

  const id = el('code', 'task-id');
  id.textContent = managed.task.id;
  card.append(id);
  if (managed.task.dependsOn.length > 0) {
    const deps = el('div', 'task-deps');
    deps.textContent = `Depends on: ${managed.task.dependsOn.join(', ')}`;
    card.append(deps);
  }
  const body = el('div', 'task-instruction');
  body.textContent = managed.task.instruction;
  card.append(body);
  if (managed.lastAttempt?.error) {
    const error = el('div', 'task-error');
    error.textContent = managed.lastAttempt.error;
    card.append(error);
  }
  if (managed.reviewResult) {
    const review = el('div', `task-review task-review-${managed.reviewResult.decision}`);
    review.textContent = `Review ${managed.reviewResult.decision.toUpperCase()}: ${managed.reviewResult.reason}`;
    card.append(review);
    if (managed.reviewResult.nextInstruction) {
      const remediation = el('div', 'task-review-remediation');
      remediation.textContent = `Next: ${managed.reviewResult.nextInstruction}`;
      card.append(remediation);
    }
  } else if (managed.reviewError) {
    const reviewError = el('div', 'task-error');
    reviewError.textContent = `Review protocol error: ${managed.reviewError}`;
    card.append(reviewError);
  }
  const actions = el('div', 'task-actions');
  let hasAction = false;
  if (managed.status === 'error' || managed.status === 'attention') {
    const retry = el('button');
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => {
      void request({ type: 'manager:retry-task', taskId: managed.task.id })
        .then(async () => { setStatus(taskStatus, 'Retry requested.'); await refresh(); })
        .catch((error) => setStatus(taskStatus, String(error), true));
    });
    actions.append(retry);
    hasAction = true;
  }
  if (['pending', 'ready', 'error', 'attention', 'blocked'].includes(managed.status)) {
    const skip = el('button');
    skip.type = 'button';
    skip.textContent = 'Skip';
    skip.addEventListener('click', () => {
      void request({ type: 'manager:skip-task', taskId: managed.task.id })
        .then(async () => { setStatus(taskStatus, 'Task skipped.'); await refresh(); })
        .catch((error) => setStatus(taskStatus, String(error), true));
    });
    actions.append(skip);
    hasAction = true;
  }
  if (!['completed', 'skipped', 'cancelled'].includes(managed.status)) {
    const cancel = el('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      void request({ type: 'manager:cancel-task', taskId: managed.task.id })
        .then(async () => {
          setStatus(taskStatus, managed.status === 'running'
            ? 'Task orchestration cancelled; any already-sent ChatGPT generation may still finish.'
            : 'Task cancelled.');
          await refresh();
        })
        .catch((error) => setStatus(taskStatus, String(error), true));
    });
    actions.append(cancel);
    hasAction = true;
  }
  if (hasAction) card.append(actions);
  return card;
}

function render(): void {
  agentsRoot.replaceChildren(...tabs.map(renderAgent));
  tasksRoot.replaceChildren(...tasks.map(renderTask));
  emptyState.hidden = tabs.length !== 0;
  const idle = tabs.filter((tab) => tab.snapshot.status === 'idle').length;
  const generating = tabs.filter((tab) => tab.snapshot.status === 'generating').length;
  const attention = tabs.filter((tab) => !['idle', 'generating'].includes(tab.snapshot.status)).length;
  summary.textContent = `${tabs.length} open · ${idle} idle · ${generating} generating · ${attention} attention`;
}

async function refresh(): Promise<void> {
  try {
    const response = await request<{ tabs: ManagedTab[]; tasks: ManagedTask[]; supervisorEnabled: boolean }>({ type: 'manager:list' });
    tabs = response.tabs;
    tasks = response.tasks;
    supervisorEnabled = response.supervisorEnabled;
    required<HTMLInputElement>('supervisor-enabled').checked = supervisorEnabled;
    const present = new Set(tabs.map((tab) => tab.tabId));
    for (const tabId of [...selected]) if (!present.has(tabId)) selected.delete(tabId);
    render();
  } catch (error) {
    setStatus(sendStatus, error instanceof Error ? error.message : String(error), true);
  }
}

function scheduleRefresh(): void {
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refresh(), 120);
}

async function sendSelected(): Promise<void> {
  const text = instruction.value.trim();
  if (!text) return setStatus(sendStatus, 'Enter an instruction first.', true);
  const tabIds = [...selected];
  if (tabIds.length === 0) return setStatus(sendStatus, 'Select at least one agent.', true);
  setStatus(sendStatus, `Sending to ${tabIds.length} selected agent(s)…`);
  try {
    const response = await request<{ results: SendResult[] }>({ type: 'manager:send', tabIds, text });
    const failed = response.results.filter((result) => !result.ok);
    setStatus(sendStatus,
      failed.length === 0 ? `Sent to ${response.results.length} agent(s).` : `${failed.length}/${response.results.length} send(s) failed.`,
      failed.length > 0,
    );
    await refresh();
  } catch (error) {
    setStatus(sendStatus, error instanceof Error ? error.message : String(error), true);
  }
}

function dependencyIds(): string[] {
  return required<HTMLInputElement>('task-deps').value.split(',').map((value) => value.trim()).filter(Boolean);
}

async function createTask(): Promise<void> {
  const input: CreateTaskInput = {
    kind: required<HTMLSelectElement>('task-kind').value as TaskKind,
    title: required<HTMLInputElement>('task-title').value.trim(),
    project: required<HTMLInputElement>('task-project').value.trim(),
    instruction: required<HTMLTextAreaElement>('task-instruction').value.trim(),
    targetRole: required<HTMLInputElement>('task-role').value.trim(),
    dependsOn: dependencyIds(),
  };
  setStatus(taskStatus, 'Creating task…');
  try {
    await request({ type: 'manager:create-task', input });
    setStatus(taskStatus, 'Task created.');
    required<HTMLInputElement>('task-title').value = '';
    required<HTMLTextAreaElement>('task-instruction').value = '';
    required<HTMLInputElement>('task-deps').value = '';
    await refresh();
  } catch (error) {
    setStatus(taskStatus, error instanceof Error ? error.message : String(error), true);
  }
}

async function runReadyTasks(): Promise<void> {
  setStatus(taskStatus, 'Dispatching ready tasks…');
  try {
    const response = await request<{ results: TaskDispatchResult[] }>({ type: 'manager:run-ready-tasks' });
    const failed = response.results.filter((result) => !result.ok);
    const sent = response.results.length - failed.length;
    setStatus(taskStatus,
      response.results.length === 0 ? 'No tasks are ready.' : `${sent} task(s) dispatched · ${failed.length} not dispatched.`,
      failed.length > 0,
    );
    await refresh();
  } catch (error) {
    setStatus(taskStatus, error instanceof Error ? error.message : String(error), true);
  }
}

async function setSupervisorMode(enabled: boolean): Promise<void> {
  setStatus(taskStatus, enabled ? 'Enabling auto supervisor…' : 'Disabling auto supervisor…');
  try {
    await request({ type: 'manager:set-supervisor-enabled', enabled });
    supervisorEnabled = enabled;
    setStatus(taskStatus, enabled ? 'Auto supervisor enabled.' : 'Auto supervisor disabled.');
    await refresh();
  } catch (error) {
    required<HTMLInputElement>('supervisor-enabled').checked = supervisorEnabled;
    setStatus(taskStatus, error instanceof Error ? error.message : String(error), true);
  }
}
required<HTMLButtonElement>('refresh').addEventListener('click', () => void refresh());
required<HTMLButtonElement>('send-selected').addEventListener('click', () => void sendSelected());
required<HTMLButtonElement>('create-task').addEventListener('click', () => void createTask());
required<HTMLButtonElement>('run-ready').addEventListener('click', () => void runReadyTasks());
required<HTMLInputElement>('supervisor-enabled').addEventListener('change', (event) => {
  void setSupervisorMode((event.currentTarget as HTMLInputElement).checked);
});
required<HTMLButtonElement>('select-idle').addEventListener('click', () => {
  for (const tab of tabs) if (tab.snapshot.status === 'idle') selected.add(tab.tabId);
  render();
});
required<HTMLButtonElement>('clear-selection').addEventListener('click', () => { selected.clear(); render(); });

chrome.runtime.onMessage.addListener((message: RuntimeNotice) => {
  if (message.type === 'manager:changed') scheduleRefresh();
  return false;
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refresh();
});
void refresh();