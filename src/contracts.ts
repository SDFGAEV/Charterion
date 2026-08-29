export type AgentStatus =
  | 'idle'
  | 'generating'
  | 'blocked'
  | 'unauthorized'
  | 'error'
  | 'unknown'
  | 'unavailable';

export type ObservationConfidence = 'direct' | 'inferred' | 'unknown';

export interface ChatSnapshot {
  conversationKey: string;
  conversationId?: string;
  title: string;
  url: string;
  status: AgentStatus;
  statusDetail?: string;
  confidence: ObservationConfidence;
  signals: string[];
  assistantMessageCount: number;
  latestAssistantMessageId?: string;
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
  lastAttempt?: SendAttemptRecord;
}

export type SendAttemptState = 'prepared' | 'dispatched' | 'acknowledged' | 'reply-observed' | 'failed' | 'uncertain';

export interface SendAttemptRecord {
  attemptId: string;
  batchId: string;
  tabId: number;
  conversationKey: string;
  taskId?: string;
  state: SendAttemptState;
  textLength: number;
  baselineAssistantMessageCount: number;
  baselineAssistantMessageId?: string;
  replyMessageId?: string;
  replyTextTail?: string;
  replyObservedAt?: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface SendResult {
  tabId: number;
  attemptId: string;
  ok: boolean;
  duplicate?: boolean;
  error?: string;
}

export interface PendingPromptEvidence {
  attemptId: string;
  baselineAssistantMessageCount: number;
  baselineAssistantMessageId?: string;
  startedAt: number;
}

export interface ContentRecoveryState {
  snapshot: ChatSnapshot;
  deliveredAttemptIds: string[];
  pendingAttempt?: PendingPromptEvidence;
}

export type TaskKind = 'work' | 'review';
export type TaskDisplayStatus = 'pending' | 'ready' | 'running' | 'completed' | 'skipped' | 'cancelled' | 'blocked' | 'error' | 'attention';

export type ReviewDecision = 'pass' | 'fail';

export interface ReviewResult {
  decision: ReviewDecision;
  reason: string;
  nextInstruction: string;
}

export interface AgentTask {
  id: string;
  kind: TaskKind;
  title: string;
  project: string;
  instruction: string;
  targetRole: string;
  dependsOn: string[];
  attemptIds: string[];
  retryAfterAttemptId?: string;
  skippedAt?: number;
  skipReason?: string;
  cancelledAt?: number;
  cancelReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ManagedTask {
  task: AgentTask;
  status: TaskDisplayStatus;
  lastAttempt?: SendAttemptRecord;
  reviewResult?: ReviewResult;
  reviewError?: string;
}

export interface CreateTaskInput {
  kind: TaskKind;
  title: string;
  project: string;
  instruction: string;
  targetRole: string;
  dependsOn: string[];
}

export interface TaskDispatchResult {
  taskId: string;
  ok: boolean;
  attemptId?: string;
  error?: string;
}

export type ContentRequest =
  | { type: 'content:get-snapshot' }
  | { type: 'content:get-recovery-state' }
  | { type: 'content:send'; text: string; attemptId: string };

export type ManagerRequest =
  | { type: 'manager:list' }
  | { type: 'manager:update-binding'; tabId: number; conversationKey: string; binding: RoleBinding }
  | { type: 'manager:send'; tabIds: number[]; text: string }
  | { type: 'manager:create-task'; input: CreateTaskInput }
  | { type: 'manager:run-ready-tasks' }
  | { type: 'manager:retry-task'; taskId: string }
  | { type: 'manager:skip-task'; taskId: string; reason?: string }
  | { type: 'manager:cancel-task'; taskId: string; reason?: string }
  | { type: 'manager:set-supervisor-enabled'; enabled: boolean }
  | { type: 'manager:focus'; tabId: number };

export type RuntimeNotice =
  | { type: 'content:changed'; snapshot: ChatSnapshot }
  | { type: 'content:reply-observed'; attemptId: string; snapshot: ChatSnapshot }
  | { type: 'manager:changed' };

export const EMPTY_BINDING: RoleBinding = Object.freeze({ role: '', project: '', notes: '' });

export function unavailableSnapshot(url: string, title = 'ChatGPT'): ChatSnapshot {
  return {
    conversationKey: `url:${url}`,
    title,
    url,
    status: 'unavailable',
    statusDetail: 'Content script is not reachable yet',
    confidence: 'unknown',
    signals: [],
    assistantMessageCount: 0,
    latestAssistantText: '',
    observedAt: Date.now(),
  };
}