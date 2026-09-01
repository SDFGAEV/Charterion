import { unavailableSnapshot, type ChatSnapshot } from './contracts';
import { isChatSnapshot, isContentRecoveryState } from './runtimeCodec';
import type { AttemptRecoveryObservation } from './recovery';

export async function recoveryStateForTab(tab: chrome.tabs.Tab): Promise<AttemptRecoveryObservation | undefined> {
  if (tab.id === undefined) return undefined;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'content:get-recovery-state' });
    if (!response?.ok || !response.state) return undefined;
    if (!isContentRecoveryState(response.state)) return undefined;
    return { tabId: tab.id, state: response.state };
  } catch {
    return undefined;
  }
}

export async function snapshotForTab(tab: chrome.tabs.Tab): Promise<ChatSnapshot> {
  const url = tab.url ?? 'https://chatgpt.com/';
  if (tab.id === undefined) return unavailableSnapshot(url, tab.title ?? 'ChatGPT');
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'content:get-snapshot' });
    if (response?.ok && isChatSnapshot(response.snapshot)) return response.snapshot;
  } catch {
    // Loading/sleeping tabs may not yet have the current content script.
  }
  return unavailableSnapshot(url, tab.title ?? 'ChatGPT');
}
