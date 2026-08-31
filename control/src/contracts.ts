export type ProjectStatus = 'active' | 'draining' | 'paused' | 'archived';
export type IsolationTier = 'c0-host' | 'c1-container' | 'c2-hypervisor' | 'c3-ephemeral-vm';
export type AgentSlotStatus = 'idle' | 'assigned' | 'suspended' | 'retired';
export type AgentDesiredState = 'active' | 'suspended' | 'retired';
export type AgentBrowserState = 'absent' | 'opening' | 'open' | 'closing' | 'error';
export type AgentRolloverState = 'idle' | 'requested' | 'opening' | 'bootstrapping';
export type AgentPageStatus = 'idle' | 'generating' | 'blocked' | 'unauthorized' | 'error' | 'unknown' | 'unavailable';
export type ResourceKind =
  | 'workspace'
  | 'repo'
  | 'branch'
  | 'server'
  | 'gpu'
  | 'port'
  | 'service'
  | 'database'
  | 'dataset'
  | 'browser-capacity'
  | 'remote-lane';
export type LeaseMode = 'shared' | 'exclusive';
export type LeaseStatus = 'active' | 'released' | 'expired';

export interface ProjectCell {
  id: string;
  name: string;
  rootPath: string;
  status: ProjectStatus;
  isolationTier: IsolationTier;
  minSlots: number;
  maxSlots: number;
  weight: number;
  createdAt: number;
  updatedAt: number;
}
export interface AgentSlot {
  id: string;
  projectId: string;
  role: string;
  status: AgentSlotStatus;
  desiredState: AgentDesiredState;
  browserState: AgentBrowserState;
  conversationKey?: string;
  conversationGeneration: number;
  rolloverState: AgentRolloverState;
  activeRolloverId?: string;
  browserProfileId?: string;
  browserTabId?: number;
  browserError?: string;
  browserObservedAt?: number;
  browserLeaseId?: string;
  browserLeaseEpoch?: number;
  browserContentEpoch?: string;
  browserObservationRevision?: number;
  browserPageStatus?: AgentPageStatus;
  browserRuntimeObservedAt?: number;
  browserQuarantined: boolean;
  browserQuarantineReason?: string;
  leaseEpoch: number;
  createdAt: number;
  updatedAt: number;
}

export type ConversationLifecycleStatus = 'active' | 'closed';
export type ConversationRolloverStatus = 'requested' | 'opening' | 'bootstrapping' | 'completed' | 'failed';
export interface AgentConversationRecord { id: string; projectId: string; slotId: string; generation: number; conversationKey: string; status: ConversationLifecycleStatus; predecessorConversationKey?: string; startedAt: number; endedAt?: number; closeReason?: string; }
export interface WorkerCheckpoint { id: string; projectId: string; slotId: string; reason: string; handoffText: string; state: Record<string, unknown>; createdAt: number; }
export interface AgentConversationRollover { id: string; projectId: string; slotId: string; fromConversationKey: string; toConversationKey?: string; fromGeneration: number; toGeneration: number; checkpointId: string; status: ConversationRolloverStatus; reason: string; bootstrapAttemptId?: string; error?: string; requestedAt: number; updatedAt: number; completedAt?: number; }

export type TaskWorkspaceStatus = 'active' | 'released';
export interface TaskWorkspace {
  id: string; projectId: string; taskId: string; slotId: string; repoPath: string; path: string; branch: string; baseSha: string;
  resourceId: string; leaseId: string; leaseEpoch: number; capabilityId: string; capabilityTokenPath: string; status: TaskWorkspaceStatus;
  createdAt: number; updatedAt: number;
}

export interface ResourceRecord {
  id: string;
  projectId?: string;
  parentId?: string;
  kind: ResourceKind;
  label: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ResourceLease {
  id: string;
  resourceId: string;
  projectId: string;
  holderId: string;
  taskId?: string;
  mode: LeaseMode;
  epoch: number;
  status: LeaseStatus;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
}
export interface CapabilityGrant {
  id: string;
  subject: string;
  projectId: string;
  agentSlotId?: string;
  taskId?: string;
  leaseEpoch?: number;
  scopes: string[];
  resourceIds: string[];
  expiresAt: number;
  revokedAt?: number;
  createdAt: number;
}

export interface IssuedCapability extends CapabilityGrant {
  token: string;
}

export interface ControlEvent {
  seq: number;
  projectId?: string;
  type: string;
  subject: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface CreateProjectInput {
  name: string;
  rootPath: string;
  isolationTier?: IsolationTier;
  minSlots?: number;
  maxSlots?: number;
  weight?: number;
}

export interface AcquireLeaseInput {
  resourceId: string;
  projectId: string;
  holderId: string;
  taskId?: string;
  mode: LeaseMode;
  ttlMs?: number;
}
export interface IssueCapabilityInput {
  subject: string;
  projectId: string;
  agentSlotId?: string;
  taskId?: string;
  leaseEpoch?: number;
  scopes: string[];
  resourceIds?: string[];
  ttlMs: number;
}

export type ClaimStatus = 'submitted' | 'verified' | 'rejected';
export type ArtifactKind = 'file' | 'test-log' | 'report' | 'git-bundle' | 'other';
export type VerificationStatus = 'passed' | 'failed';
export interface VerifiedTaskCompletion { kind: 'verified-claim'; claimId: string; verificationId: string; completedAt: number; commitSha?: string; }

export interface WorkClaim {
  id: string;
  projectId: string;
  taskId: string;
  attemptId?: string;
  subject: string;
  resourceId: string;
  leaseId: string;
  leaseEpoch: number;
  summary: string;
  commitSha?: string;
  status: ClaimStatus;
  createdAt: number;
  updatedAt: number;
}

export interface EvidenceArtifact {
  id: string;
  projectId: string;
  claimId: string;
  kind: ArtifactKind;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface VerificationRecord {
  id: string;
  projectId: string;
  claimId: string;
  status: VerificationStatus;
  checks: VerificationCheck[];
  createdAt: number;
  completedAt: number;
}
export interface SubmitClaimInput {
  projectId: string;
  taskId: string;
  attemptId?: string;
  subject: string;
  resourceId: string;
  leaseEpoch: number;
  summary: string;
  commitSha?: string;
}

export interface RegisterArtifactInput {
  claimId: string;
  subject: string;
  path: string;
  kind: ArtifactKind;
  metadata?: Record<string, unknown>;
}
export type SelfHostingPromotionStatus = 'pending' | 'approved' | 'rejected' | 'promoted';
export interface SelfHostingPromotion {
  id: string; projectId: string; idempotencyKey: string; claimId: string; candidateSubject: string; candidateSha: string;
  targetRef: string; expectedParentSha: string; requestedBy: string; status: SelfHostingPromotionStatus;
  decisionBy?: string; decisionReason?: string; decisionAt?: number; promotedAt?: number; createdAt: number; updatedAt: number;
}
export interface RequestSelfHostingPromotionInput {
  projectId: string; idempotencyKey: string; claimId: string; candidateSha: string; targetRef: string; expectedParentSha: string; requestedBy: string;
}
export interface DecideSelfHostingPromotionInput {
  promotionId: string; authoritySubject: string; decision: 'approve' | 'reject'; reason: string;
}
export interface ApplySelfHostingPromotionInput { promotionId: string; authoritySubject: string; }
export type ChangeRequestStatus = 'open' | 'changes-requested' | 'approved' | 'queued' | 'integrated' | 'closed';
export type SupervisorReviewVerdict = 'approve' | 'request-changes';
export type MergeQueueStatus = 'queued' | 'validating' | 'integrated' | 'failed' | 'cancelled';

export interface ChangeRequest {
  id: string; projectId: string; taskId: string; authorSubject: string; branch: string; targetBranch: string;
  baseSha: string; headSha: string; claimId: string; revision: number; status: ChangeRequestStatus;
  createdAt: number; updatedAt: number;
}

export interface ChangeRequestRevision {
  id: string; changeRequestId: string; revision: number; claimId: string; headSha: string; submittedAt: number;
}

export interface SupervisorReview {
  id: string; projectId: string; changeRequestId: string; reviewerSubject: string; headSha: string;
  verdict: SupervisorReviewVerdict; body: string; createdAt: number;
}

export interface MergeQueueEntry {
  id: string; projectId: string; changeRequestId: string; headSha: string; targetBranch: string; status: MergeQueueStatus;
  queuedAt: number; updatedAt: number; candidateBaseSha?: string; candidateSha?: string; error?: string; integratedSha?: string;
}

export interface OpenChangeRequestInput {
  projectId: string; taskId: string; subject: string; branch: string; targetBranch: string; baseSha: string; headSha: string; claimId: string;
}
export interface UpdateChangeRequestInput { changeRequestId: string; subject: string; headSha: string; claimId: string; }
export interface SubmitSupervisorReviewInput {
  changeRequestId: string; reviewerSubject: string; headSha: string; verdict: SupervisorReviewVerdict; body: string;
}

export interface RpcRequest {
  id: string;
  method: string;
  instanceId?: string;
  params?: Record<string, unknown>;
  auth?: { adminToken?: string; browserToken?: string; capabilityToken?: string };
}

export interface RpcSuccess {
  id: string;
  ok: true;
  result: unknown;
}

export interface RpcFailure {
  id: string;
  ok: false;
  error: { code: string; message: string };
}

export type RpcResponse = RpcSuccess | RpcFailure;

export interface DaemonConfig {
  homeDir: string;
  instanceId: string;
  databasePath: string;
  adminTokenPath: string;
  browserTokenPath: string;
  gitPath: string;
  pipeName: string;
}

export type BrowserAuthStatus = 'unknown' | 'authenticated' | 'authentication-required';
export type BrowserPageHealth = 'unknown' | 'ready' | 'generating' | 'blocked' | 'error' | 'unavailable';

export interface BrowserRuntimeStatus {
  profileId: string;
  authStatus: BrowserAuthStatus;
  pageHealth: BrowserPageHealth;
  openTabs: number;
  extensionVersion: string;
  observedAt: number;
}

export interface ReportBrowserRuntimeInput {
  profileId: string;
  authStatus: BrowserAuthStatus;
  pageHealth: BrowserPageHealth;
  openTabs: number;
  extensionVersion: string;
  observedAt?: number;
}

export interface ReportAgentBrowserInput {
  slotId: string; profileId: string; browserState: AgentBrowserState;
  tabId?: number; conversationKey?: string; error?: string; observedAt?: number;
}

export interface ReportAgentRuntimeInput {
  slotId: string; profileId: string; tabId: number; contentEpoch: string; revision: number;
  pageStatus: AgentPageStatus; semanticSignature: string; observedAt: number;
}

export type BrowserOperationState = 'planned' | 'dispatched' | 'settled';
export type BrowserOperationOutcome = 'acknowledged' | 'reply-observed' | 'failed' | 'uncertain';
export interface BrowserOperationRecord {
  id: string; idempotencyKey: string; operation: string; projectId?: string; slotId?: string; conversationKey?: string;
  tabId?: number; contentEpoch?: string; preconditionsHash: string; state: BrowserOperationState; outcome?: BrowserOperationOutcome;
  evidence: Record<string, unknown>; plannedAt: number; dispatchedAt?: number; settledAt?: number; updatedAt: number;
}
export interface PlanBrowserOperationInput {
  id: string; idempotencyKey: string; operation: string; projectId?: string; slotId?: string; conversationKey?: string;
  tabId?: number; contentEpoch?: string; preconditionsHash: string; plannedAt?: number;
}
export interface RuntimeIncident { id: string; scope: string; severity: 'warning'|'error'|'critical'; code: string; subject: string; detail: Record<string, unknown>; createdAt: number; resolvedAt?: number; }

export type WorkerRequestType =
  | 'suggestion' | 'blocker' | 'question' | 'resource-request' | 'scope-change'
  | 'dependency-request' | 'cross-system-request' | 'review-request' | 'risk-alert' | 'worker-request';
export type WorkerRequestStatus = 'open' | 'accepted' | 'rejected' | 'resolved';

export interface WorkerRequest {
  id: string;
  projectId: string;
  taskId?: string;
  fromSubject: string;
  type: WorkerRequestType;
  title: string;
  body: string;
  suggestedAction?: string;
  status: WorkerRequestStatus;
  decidedBy?: string;
  decisionNote?: string;
  createdAt: number;
  updatedAt: number;
}
export interface SubmitWorkerRequestInput {
  projectId: string;
  taskId?: string;
  fromSubject: string;
  type: WorkerRequestType;
  title: string;
  body: string;
  suggestedAction?: string;
}

export interface DecideWorkerRequestInput {
  requestId: string;
  supervisorSubject: string;
  decision: 'accept' | 'reject';
  note: string;
}
