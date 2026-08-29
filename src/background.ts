import {
  EMPTY_BINDING,
  unavailableSnapshot,
  type ChatSnapshot,
  type ManagedTab,
  type ManagerRequest,
  type RoleBinding,
  type RuntimeNotice,
  type SendResult,
} from './contracts';

const BINDINGS_KEY = 'bindings.v1';
const TAB_BINDINGS_KEY = 'tabBindings.v1';

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

async function snapshotForTab(tab: chrome.tabs.Tab): Promise<ChatSnapshot> {
  const url = tab.url ?? 'https://chatgpt.com/';
  if (tab.id === undefined) return unavailableSnapshot(url, tab.title ?? 'ChatGPT');
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'content:get-snapshot' });
    if (response?.ok && response.snapshot) return response.snapshot as ChatSnapshot;
  } catch {
    // The page may be loading, sleeping, or predate the current extension load.
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

async function managedTabs(): Promise<ManagedTab[]> {
  const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*'] });
  const managed = await Promise.all(tabs.filter((tab) => tab.id !== undefined).map(async (tab) => {
    const snapshot = await snapshotForTab(tab);
    return {
      tabId: tab.id!,
      windowId: tab.windowId,
      active: tab.active,
      snapshot,
      binding: await bindingFor(tab.id!, snapshot),
    } satisfies ManagedTab;
  }));
  return managed.sort((a, b) => a.tabId - b.tabId);
}

async function updateBinding(
  tabId: number,
  conversationKey: string,
  binding: RoleBinding,
): Promise<void> {
  const [persistent, ephemeral] = await Promise.all([localBindings(), sessionBindings()]);
  if (conversationKey.startsWith('conversation:')) {
    persistent[conversationKey] = binding;
    delete ephemeral[String(tabId)];
  } else {
    ephemeral[String(tabId)] = binding;
  }
  await Promise.all([saveLocal(persistent), saveSession(ephemeral)]);
}

async function sendToTabs(tabIds: number[], text: string): Promise<SendResult[]> {
  const results: SendResult[] = [];
  for (const tabId of [...new Set(tabIds)]) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'content:send', text });
      if (!response?.ok) throw new Error(response?.error ?? 'ChatGPT page rejected the send');
      results.push({ tabId, ok: true });
    } catch (error) {
      results.push({
        tabId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

async function focusTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

async function notifyManagerChanged(): Promise<void> {
  const notice: RuntimeNotice = { type: 'manager:changed' };
  try {
    await chrome.runtime.sendMessage(notice);
  } catch {
    // No side panel is currently open.
  }
}

chrome.runtime.onMessage.addListener((message: ManagerRequest | RuntimeNotice, _sender, sendResponse) => {
  if (message.type === 'content:changed') {
    void notifyManagerChanged();
    return false;
  }
  if (message.type === 'manager:list') {
    void managedTabs().then((tabs) => sendResponse({ ok: true, tabs }));
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
    void sendToTabs(message.tabIds, message.text)
      .then(async (results) => {
        await notifyManagerChanged();
        sendResponse({ ok: true, results });
      });
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
  if (tab.url?.startsWith('https://chatgpt.com/') &&
      (changeInfo.status === 'complete' || changeInfo.url !== undefined)) {
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
