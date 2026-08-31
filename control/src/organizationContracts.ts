export type OrganizationStatus = 'active' | 'paused' | 'archived';
export type DepartmentStatus = 'active' | 'archived';
export type DomainStatus = 'active' | 'archived';
export type OrganizationAgentStatus = 'active' | 'suspended' | 'retired';
export type MissionStatus = 'proposed' | 'active' | 'blocked' | 'completed' | 'cancelled';
export type WorkItemStatus = 'proposed' | 'ready' | 'active' | 'blocked' | 'completed' | 'cancelled';
export type MissionMemberRole = 'contributor' | 'reviewer' | 'advisor' | 'observer';

export interface OrganizationRecord {
  id: string;
  name: string;
  status: OrganizationStatus;
  purpose: string;
  createdAt: number;
  updatedAt: number;
}

export interface DepartmentRecord {
  id: string;
  organizationId: string;
  name: string;
  purpose: string;
  status: DepartmentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface DomainRecord {
  id: string;
  organizationId: string;
  departmentId: string;
  name: string;
  purpose: string;
  status: DomainStatus;
  createdAt: number;
  updatedAt: number;
}

export interface OrganizationAgentRecord {
  id: string;
  organizationId: string;
  displayName: string;
  primaryDepartmentId?: string | undefined;
  runtimeSlotId?: string;
  status: OrganizationAgentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface AgentDomainAssignment {
  agentId: string;
  domainId: string;
  responsibility: 'primary' | 'secondary';
  assignedAt: number;
}

export interface MissionRecord {
  id: string;
  organizationId: string;
  projectId?: string | undefined;
  title: string;
  objective: string;
  status: MissionStatus;
  driAgentId?: string | undefined;
  sourceRequestId?: string | undefined;
  createdAt: number;
  updatedAt: number;
}

export interface MissionMemberRecord {
  missionId: string;
  agentId: string;
  role: MissionMemberRole;
  joinedAt: number;
}

export interface WorkItemRecord {
  id: string;
  missionId: string;
  title: string;
  objective: string;
  ownerAgentId?: string | undefined;
  status: WorkItemStatus;
  dependsOn: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateOrganizationInput {
  name: string;
  purpose?: string | undefined;
}

export interface CreateDepartmentInput {
  organizationId: string;
  name: string;
  purpose?: string | undefined;
}

export interface CreateDomainInput {
  organizationId: string;
  departmentId: string;
  name: string;
  purpose?: string | undefined;
}

export interface RegisterOrganizationAgentInput {
  organizationId: string;
  displayName: string;
  primaryDepartmentId?: string | undefined;
}

export interface CreateMissionInput {
  organizationId: string;
  projectId?: string | undefined;
  title: string;
  objective: string;
  driAgentId?: string | undefined;
  sourceRequestId?: string | undefined;
}

export interface CreateWorkItemInput {
  missionId: string;
  title: string;
  objective: string;
  ownerAgentId?: string | undefined;
  dependsOn?: string[] | undefined;
}

export interface OrganizationSnapshot {
  organizations: OrganizationRecord[];
  departments: DepartmentRecord[];
  domains: DomainRecord[];
  agents: OrganizationAgentRecord[];
  agentDomains: AgentDomainAssignment[];
  missions: MissionRecord[];
  missionMembers: MissionMemberRecord[];
  workItems: WorkItemRecord[];
}


export type AgentWorkspaceIsolationTier = 'c0-host' | 'c1-container' | 'c2-hypervisor' | 'c3-ephemeral-vm';
export type AgentWorkspaceBackendKind = 'host' | 'container' | 'hypervisor-vm' | 'ephemeral-vm' | 'remote-host';
export type AgentWorkspaceStatus = 'provisioning' | 'ready' | 'suspended' | 'error' | 'retired';

export interface AgentWorkspaceRecord {
  id: string;
  organizationId: string;
  agentId: string;
  generation: number;
  isolationTier: AgentWorkspaceIsolationTier;
  backendKind?: AgentWorkspaceBackendKind;
  rootRef?: string;
  browserProfileId?: string;
  toolProfileRef?: string;
  endpointRefs: string[];
  mountedResourceRefs: string[];
  status: AgentWorkspaceStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RequestAgentWorkspaceInput {
  agentId: string;
  isolationTier?: AgentWorkspaceIsolationTier | undefined;
}

export interface MarkAgentWorkspaceReadyInput {
  workspaceId: string;
  backendKind: AgentWorkspaceBackendKind;
  rootRef: string;
  browserProfileId: string;
  toolProfileRef: string;
  endpointRefs?: string[] | undefined;
  mountedResourceRefs?: string[] | undefined;
  allowUnsafeHostAccess?: boolean | undefined;
}

export interface ReplaceAgentWorkspaceInput {
  agentId: string;
  isolationTier?: AgentWorkspaceIsolationTier | undefined;
  reason: string;
}

export interface AgentWorkspaceSnapshot {
  workspaces: AgentWorkspaceRecord[];
}

export interface OrganizationSnapshot {
  agentWorkspaces: AgentWorkspaceRecord[];
}