import type { ManagedTab, RoleBinding, RuntimeNotice, SendResult } from './contracts';

const agentsRoot = required<HTMLDivElement>('agents');
const emptyState = required<HTMLDivElement>('empty');
const summary = required<HTMLSpanElement>('summary');
const instruction = required<HTMLTextAreaElement>('instruction');
const sendStatus = required<HTMLParagraphElement>('send-status');
const selected = new Set<number>();
let tabs: ManagedTab[] = [];
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

function setSendStatus(text: string, isError = false): void {
  sendStatus.textContent = text;
  sendStatus.classList.toggle('error', isError);
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
  await request({
    type: 'manager:update-binding',
    tabId: tab.tabId,
    conversationKey: tab.snapshot.conversationKey,
    binding,
  });
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
  for (const input of inputs) {
    input.addEventListener('change', () => {
      void persistBinding(tab, inputs).catch((error) => setSendStatus(String(error), true));
    });
  }
  grid.append(role.wrap, project.wrap, notes.wrap);
  card.append(grid);

  if (tab.snapshot.latestAssistantText) {
    const latest = el('div', 'latest');
    latest.textContent = tab.snapshot.latestAssistantText;
    card.append(latest);
  }

  const actions = el('div', 'agent-actions');
  const focus = el('button');
  focus.type = 'button';
  focus.textContent = 'Focus tab';
  focus.addEventListener('click', () => {
    void request({ type: 'manager:focus', tabId: tab.tabId }).catch((error) => setSendStatus(String(error), true));
  });
  actions.append(focus);
  card.append(actions);
  return card;
}
function render(): void {
  agentsRoot.replaceChildren(...tabs.map(renderAgent));
  emptyState.hidden = tabs.length !== 0;
  const idle = tabs.filter((tab) => tab.snapshot.status === 'idle').length;
  const generating = tabs.filter((tab) => tab.snapshot.status === 'generating').length;
  summary.textContent = `${tabs.length} open · ${idle} idle · ${generating} generating`;
}

async function refresh(): Promise<void> {
  try {
    const response = await request<{ tabs: ManagedTab[] }>({ type: 'manager:list' });
    tabs = response.tabs;
    const present = new Set(tabs.map((tab) => tab.tabId));
    for (const tabId of [...selected]) if (!present.has(tabId)) selected.delete(tabId);
    render();
  } catch (error) {
    setSendStatus(error instanceof Error ? error.message : String(error), true);
  }
}

function scheduleRefresh(): void {
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refresh(), 120);
}

async function sendSelected(): Promise<void> {
  const text = instruction.value.trim();
  if (!text) return setSendStatus('Enter an instruction first.', true);
  const tabIds = [...selected];
  if (tabIds.length === 0) return setSendStatus('Select at least one agent.', true);
  setSendStatus(`Sending to ${tabIds.length} selected agent(s)…`);
  try {
    const response = await request<{ results: SendResult[] }>({ type: 'manager:send', tabIds, text });
    const failed = response.results.filter((result) => !result.ok);
    if (failed.length === 0) setSendStatus(`Sent to ${response.results.length} agent(s).`);
    else setSendStatus(`${failed.length}/${response.results.length} send(s) failed.`, true);
    await refresh();
  } catch (error) {
    setSendStatus(error instanceof Error ? error.message : String(error), true);
  }
}
required<HTMLButtonElement>('refresh').addEventListener('click', () => void refresh());
required<HTMLButtonElement>('send-selected').addEventListener('click', () => void sendSelected());
required<HTMLButtonElement>('select-idle').addEventListener('click', () => {
  for (const tab of tabs) if (tab.snapshot.status === 'idle') selected.add(tab.tabId);
  render();
});
required<HTMLButtonElement>('clear-selection').addEventListener('click', () => {
  selected.clear();
  render();
});

chrome.runtime.onMessage.addListener((message: RuntimeNotice) => {
  if (message.type === 'manager:changed') scheduleRefresh();
  return false;
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refresh();
});

void refresh();
