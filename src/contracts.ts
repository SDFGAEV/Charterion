export type AgentStatus = 'idle' | 'generating' | 'unavailable';

export interface ChatSnapshot {
  conversationKey: string;
  conversationId?: string;
  title: string;
  url: string;
  status: AgentStatus;
  latestAssistantText: string;
  observedAt: number;
}

export interface RoleBinding {
  role: string;
  project: string;
  notes: string;
}

export interface ManagedTab {
  tabId: number;
  windowId: number;
  active: boolean;
  snapshot: ChatSnapshot;
  binding: RoleBinding;
}

export interface SendResult {
  tabId: number;
  ok: boolean;
  error?: string;
}

export type ContentRequest =
  | { type: 'content:get-snapshot' }
  | { type: 'content:send'; text: string };

export type ManagerRequest =
  | { type: 'manager:list' }
  | { type: 'manager:update-binding'; tabId: number; conversationKey: string; binding: RoleBinding }
  | { type: 'manager:send'; tabIds: number[]; text: string }
  | { type: 'manager:focus'; tabId: number };

export type RuntimeNotice =
  | { type: 'content:changed'; snapshot: ChatSnapshot }
  | { type: 'manager:changed' };

export const EMPTY_BINDING: RoleBinding = Object.freeze({
  role: '',
  project: '',
  notes: '',
});

export function unavailableSnapshot(url: string, title = 'ChatGPT'): ChatSnapshot {
  return {
    conversationKey: `url:${url}`,
    title,
    url,
    status: 'unavailable',
    latestAssistantText: '',
    observedAt: Date.now(),
  };
}
