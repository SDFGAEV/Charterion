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

export interface ContentObservationIdentity {
  contentEpoch: string;
  revision: number;
  semanticSignature: string;
  observedAt: number;
}

export interface RoleBinding {
  role: string;
  project: string;
  notes: string;
  /** Kernel AgentSlot identity. Runtime delivery addresses must not stand in for this identity. */
  agentSlotId?: string;
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
  contentEpoch: string;
  taskId?: string;
  messageId?: string;
  retryOfAttemptId?: string;
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
  contentEpoch: string;
  baselineAssistantMessageCount: number;
  baselineAssistantMessageId?: string;
  startedAt: number;
}

export interface ContentRecoveryState {
  observation: ContentObservationIdentity;
  snapshot: ChatSnapshot;
  deliveredAttemptIds: string[];
  pendingAttempt?: PendingPromptEvidence;
}

export type TaskKind = 'work' | 'review' | 'human';
export type TaskCompletionPolicy = 'reply' | 'review-pass' | 'human-approval';
export type TaskDisplayStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'waiting-human'
  | 'completed'
  | 'skipped'
  | 'cancelled'
  | 'rejected'
  | 'blocked'
  | 'error'
  | 'attention';

export type ReviewDecision = 'pass' | 'fail';

export interface ReviewResult {
  decision: ReviewDecision;
  reason: string;
  nextInstruction: string;
}

export type HumanDecision = 'approve' | 'reject';

export interface HumanDecisionRecord {
  decision: HumanDecision;
  reason: string;
  decidedAt: number;
}

export type AgentMessageType =
  | 'result'
  | 'blocker'
  | 'question'
  | 'answer'
  | 'review-request'
  | 'review-result'
  | 'announcement';

export type AgentMessageTarget =
  | { kind: 'role'; role: string }
  | { kind: 'project' };

export interface AgentMessage {
  id: string;
  project: string;
  fromRole: string;
  target: AgentMessageTarget;
  type: AgentMessageType;
  content: string;
  taskId?: string;
  attemptIds: string[];
  recipientConversationKeys?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ManagedMessage {
  message: AgentMessage;
  attemptHistory: SendAttemptRecord[];
}

export interface AgentTask {
  id: string;
  kind: TaskKind;
  completionPolicy: TaskCompletionPolicy;
  title: string;
  project: string;
  instruction: string;
  targetRole: string;
  dependsOn: string[];
  attemptIds: string[];
  retryAfterAttemptId?: string;
  revisionInstruction?: string;
  revisionFromReviewAttemptId?: string;
  reviewTargetTaskId?: string;
  maxReviewRounds?: number;
  humanDecision?: HumanDecisionRecord;
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
  attemptHistory: SendAttemptRecord[];
  reviewResult?: ReviewResult;
  reviewError?: string;
  reviewRound?: number;
  reviewLoopExhausted?: boolean;
}

export interface CreateTaskInput {
  kind: TaskKind;
  completionPolicy?: TaskCompletionPolicy;
  title: string;
  project: string;
  instruction: string;
  targetRole: string;
  dependsOn: string[];
  reviewTargetTaskId?: string;
  maxReviewRounds?: number;
}

export interface CreateAgentMessageInput {
  project: string;
  fromRole: string;
  target: AgentMessageTarget;
  type: AgentMessageType;
  content: string;
  taskId?: string;
}

export interface TaskDispatchResult {
  taskId: string;
  ok: boolean;
  attemptId?: string;
  error?: string;
}

export type PortableSendAttemptRecord = Omit<SendAttemptRecord, 'contentEpoch'>;

export interface PortableManagerState {
  schemaVersion: 3;
  exportedAt: number;
  bindings: Record<string, RoleBinding>;
  tasks: AgentTask[];
  attempts: PortableSendAttemptRecord[];
  messages: AgentMessage[];
  supervisorEnabled: boolean;
}

export type ContentRequest =
  | { type: 'content:get-snapshot' }
  | { type: 'content:get-recovery-state' }
  | { type: 'content:send'; text: string; attemptId: string; expectedContentEpoch: string };

export type ManagerRequest =
  | { type: 'manager:list' }
  | { type: 'manager:update-binding'; tabId: number; conversationKey: string; binding: RoleBinding }
  | { type: 'manager:send'; tabIds: number[]; text: string }
  | { type: 'manager:create-task'; input: CreateTaskInput }
  | { type: 'manager:create-message'; input: CreateAgentMessageInput }
  | { type: 'manager:dispatch-message'; messageId: string }
  | { type: 'manager:run-ready-tasks' }
  | { type: 'manager:retry-task'; taskId: string }
  | { type: 'manager:retry-review-loop'; taskId: string }
  | { type: 'manager:decide-human-task'; taskId: string; decision: HumanDecision; reason?: string }
  | { type: 'manager:skip-task'; taskId: string; reason?: string }
  | { type: 'manager:cancel-task'; taskId: string; reason?: string }
  | { type: 'manager:control-snapshot' }
  | { type: 'manager:export-state' }
  | { type: 'manager:import-state'; document: string }
  | { type: 'manager:set-supervisor-enabled'; enabled: boolean }
  | { type: 'manager:focus'; tabId: number };

export type RuntimeNotice =
  | { type: 'content:changed'; observation: ContentObservationIdentity; snapshot: ChatSnapshot }
  | { type: 'content:reply-observed'; attemptId: string; observation: ContentObservationIdentity; snapshot: ChatSnapshot }
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
