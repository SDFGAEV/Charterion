export type ProjectStatus = 'active' | 'draining' | 'paused' | 'archived';
export type IsolationTier = 'c0-host' | 'c1-container' | 'c2-hypervisor' | 'c3-ephemeral-vm';
export type AgentSlotStatus = 'idle' | 'assigned' | 'suspended' | 'retired';
export type AgentDesiredState = 'active' | 'suspended' | 'retired';
export type AgentBrowserState = 'absent' | 'opening' | 'open' | 'closing' | 'error';
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
  browserProfileId?: string;
  browserTabId?: number;
  browserError?: string;
  browserObservedAt?: number;
  leaseEpoch: number;
  createdAt: number;
  updatedAt: number;
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
