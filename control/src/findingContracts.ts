export type FindingStatus = 'open' | 'owned' | 'in-progress' | 'resolved' | 'rejected';

export interface FindingRecord {
  id: string;
  organizationId: string;
  projectId?: string;
  domainId?: string;
  fingerprint: string;
  title: string;
  symptom: string;
  locations: string[];
  status: FindingStatus;
  owningDepartmentId?: string;
  owningAgentId?: string;
  missionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FindingEvidenceRecord {
  id: string;
  findingId: string;
  observerSubject: string;
  evidenceRefs: string[];
  note: string;
  createdAt: number;
}
export interface DiscoverFindingInput {
  organizationId: string;
  projectId?: string;
  domainId?: string;
  title: string;
  symptom: string;
  locations?: string[];
  observerSubject: string;
  evidenceRefs?: string[];
  note?: string;
  fingerprintHint?: string;
}

export interface DiscoverFindingResult {
  finding: FindingRecord;
  evidence: FindingEvidenceRecord;
  duplicate: boolean;
}

export interface ClaimFindingInput {
  findingId: string;
  agentId: string;
  missionId?: string;
}
