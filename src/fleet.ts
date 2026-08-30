import type { ManagedTab } from './contracts';
import type { ControlAgentView } from './nativeControl';

export type FleetAction =
  | { kind: 'open'; slotId: string; url: string }
  | { kind: 'close'; slotId: string; tabId: number }
  | { kind: 'report-open'; slotId: string; tabId: number; conversationKey?: string }
  | { kind: 'report-absent'; slotId: string };

export function agentConversationUrl(conversationKey?: string): string {
  if (!conversationKey?.startsWith('conversation:')) return 'https://chatgpt.com/';
  const id = conversationKey.slice('conversation:'.length);
  return `https://chatgpt.com/c/${encodeURIComponent(id)}`;
}

function tabForAgent(agent: ControlAgentView, tabs: readonly ManagedTab[], mappedTabId?: number): ManagedTab | undefined {
  if (mappedTabId !== undefined) {
    const mapped = tabs.find((tab) => tab.tabId === mappedTabId);
    if (mapped) return mapped;
  }
  if (!agent.conversationKey) return undefined;
  return tabs.find((tab) => tab.snapshot.conversationKey === agent.conversationKey);
}
export function planFleetReconciliation(
  agents: readonly ControlAgentView[],
  tabs: readonly ManagedTab[],
  mappedTabs: Readonly<Record<string, number>>,
): FleetAction[] {
  const actions: FleetAction[] = [];
  for (const agent of agents) {
    const tab = tabForAgent(agent, tabs, mappedTabs[agent.id]);
    if (agent.desiredState === 'active') {
      if (!tab) {
        actions.push({ kind: 'open', slotId: agent.id, url: agentConversationUrl(agent.conversationKey) });
        continue;
      }
      const conversationKey = tab.snapshot.conversationKey.startsWith('conversation:')
        ? tab.snapshot.conversationKey
        : undefined;
      actions.push({ kind: 'report-open', slotId: agent.id, tabId: tab.tabId, ...(conversationKey ? { conversationKey } : {}) });
      continue;
    }
    if (tab && tab.snapshot.status !== 'generating') actions.push({ kind: 'close', slotId: agent.id, tabId: tab.tabId });
    else if (!tab && agent.browserState !== 'absent') actions.push({ kind: 'report-absent', slotId: agent.id });
  }
  return actions;
}

export function filterFleetTaskTabs(
  tabs: readonly ManagedTab[],
  agents: readonly ControlAgentView[],
  mappedTabs: Readonly<Record<string, number>>,
): ManagedTab[] {
  const blocked = new Set<number>();
  for (const agent of agents) {
    if (agent.desiredState === 'active') continue;
    const mapped = mappedTabs[agent.id]; if (mapped !== undefined) blocked.add(mapped);
    if (agent.conversationKey) for (const tab of tabs) if (tab.snapshot.conversationKey === agent.conversationKey) blocked.add(tab.tabId);
  }
  return tabs.filter((tab) => !blocked.has(tab.tabId));
}
