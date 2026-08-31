export type ReviewRisk = 'low' | 'normal' | 'high' | 'critical';
export type ReviewRequestStatus = 'open' | 'approved' | 'changes-requested' | 'rejected' | 'superseded';
export type ReviewSlotState = 'open' | 'claimed' | 'approved' | 'changes-requested' | 'rejected';
export type ReviewDecision = 'approve' | 'request-changes' | 'reject';

export interface ReviewRequestRecord {
  id: string;
  organizationId: string;
  projectId: string;
  changeRequestId: string;
  revision: number;
  headSha: string;
  authorSubject: string;
  risk: ReviewRisk;
  status: ReviewRequestStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ReviewSlotRecord {
  id: string;
  reviewRequestId: string;
  dimension: string;
  required: boolean;
  requiredDomainId?: string;
  state: ReviewSlotState;
  reviewerAgentId?: string;
  claimedAt?: number;
  decidedAt?: number;
  decisionNote?: string;
}
export interface OpenReviewSlotInput {
  dimension: string;
  required?: boolean;
  requiredDomainId?: string;
}

export interface OpenReviewRequestInput {
  organizationId: string;
  changeRequestId: string;
  risk?: ReviewRisk;
  slots: OpenReviewSlotInput[];
}

export interface ClaimReviewSlotInput {
  slotId: string;
  reviewerAgentId: string;
}

export interface DecideReviewSlotInput {
  slotId: string;
  reviewerAgentId: string;
  decision: ReviewDecision;
  note: string;
}

export interface ReviewQueueItem {
  request: ReviewRequestRecord;
  slot: ReviewSlotRecord;
  ageMs: number;
}
