export type WorkRequesterKind = 'human' | 'external-ai' | 'internal-agent' | 'system';
export type WorkRequestStatus = 'received' | 'accepted' | 'rejected' | 'cancelled';
export type WorkPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface WorkRequestRecord {
  id: string;
  organizationId: string;
  projectId?: string | undefined;
  requesterKind: WorkRequesterKind;
  requesterIdentity: string;
  objective: string;
  contextRefs: string[];
  constraints: string[];
  desiredOutputs: string[];
  priority: WorkPriority;
  deadline?: number | undefined;
  idempotencyKey?: string | undefined;
  status: WorkRequestStatus;
  missionId?: string;
  decisionBy?: string;
  decisionReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SubmitWorkRequestInput {
  organizationId: string;
  projectId?: string | undefined;
  requesterKind: WorkRequesterKind;
  requesterIdentity: string;
  objective: string;
  contextRefs?: string[] | undefined;
  constraints?: string[] | undefined;
  desiredOutputs?: string[] | undefined;
  priority?: WorkPriority | undefined;
  deadline?: number | undefined;
  idempotencyKey?: string | undefined;
}

export interface AcceptWorkRequestInput {
  requestId: string;
  acceptedBy: string;
  missionTitle?: string | undefined;
  driAgentId?: string | undefined;
}

export interface DecideWorkRequestInput {
  requestId: string;
  decidedBy: string;
  reason: string;
}

export interface WorkOutcomeRecord {
  workItemId: string;
  disposition: 'completed' | 'cancelled';
  summary: string;
  producedRefs: string[];
  decisionRefs: string[];
  blockerRefs: string[];
  completedAt: number;
}

export interface CompleteWorkItemInput {
  workItemId: string;
  completedBy: string;
  summary: string;
  producedRefs?: string[] | undefined;
  decisionRefs?: string[] | undefined;
  blockerRefs?: string[] | undefined;
}
