import { randomUUID } from 'node:crypto';
import type { ControlDatabase } from './database';
import type {
  AgentDomainAssignment,
  CreateDepartmentInput,
  CreateDomainInput,
  CreateMissionInput,
  CreateOrganizationInput,
  CreateWorkItemInput,
  DepartmentRecord,
  DomainRecord,
  MissionMemberRecord,
  MissionMemberRole,
  MissionRecord,
  MissionStatus,
  OrganizationAgentRecord,
  OrganizationRecord,
  OrganizationSnapshot,
  RegisterOrganizationAgentInput,
  WorkItemRecord,
  WorkItemStatus,
} from './organizationContracts';

import type {
  AgentWorkspaceRecord,
  AgentWorkspaceSecurityMode,
  ConfigureAgentWorkspaceInput,
  RequestAgentWorkspaceInput,
} from './organizationContracts';
import { buildWorkspacePolicy, WORKSPACE_CHARTER_VERSION } from './workspacePolicy';
type Row = Record<string, string | number | null>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function organizationFrom(row: Row): OrganizationRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    status: String(row.status) as OrganizationRecord['status'],
    purpose: String(row.purpose),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function departmentFrom(row: Row): DepartmentRecord {
  return {
    id: String(row.id), organizationId: String(row.organization_id), name: String(row.name),
    purpose: String(row.purpose), status: String(row.status) as DepartmentRecord['status'],
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

function domainFrom(row: Row): DomainRecord {
  return {
    id: String(row.id), organizationId: String(row.organization_id), departmentId: String(row.department_id),
    name: String(row.name), purpose: String(row.purpose), status: String(row.status) as DomainRecord['status'],
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

function agentFrom(row: Row): OrganizationAgentRecord {
  const value: OrganizationAgentRecord = {
    id: String(row.id), organizationId: String(row.organization_id), displayName: String(row.display_name),
    status: String(row.status) as OrganizationAgentRecord['status'], createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
  if (row.primary_department_id !== null) value.primaryDepartmentId = String(row.primary_department_id);
  if (row.runtime_slot_id !== null) value.runtimeSlotId = String(row.runtime_slot_id);
  return value;
}

function missionFrom(row: Row): MissionRecord {
  const value: MissionRecord = {
    id: String(row.id), organizationId: String(row.organization_id), title: String(row.title), objective: String(row.objective),
    status: String(row.status) as MissionRecord['status'], createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
  if (row.project_id !== null) value.projectId = String(row.project_id);
  if (row.dri_agent_id !== null) value.driAgentId = String(row.dri_agent_id);
  if (row.source_request_id !== null) value.sourceRequestId = String(row.source_request_id);
  return value;
}

function workItemFrom(row: Row): WorkItemRecord {
  const value: WorkItemRecord = {
    id: String(row.id), missionId: String(row.mission_id), title: String(row.title), objective: String(row.objective),
    status: String(row.status) as WorkItemRecord['status'], dependsOn: JSON.parse(String(row.depends_on_json)) as string[],
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
  if (row.owner_agent_id !== null) value.ownerAgentId = String(row.owner_agent_id);
  return value;
}

function workspaceFrom(row: Row): AgentWorkspaceRecord {
  const value: AgentWorkspaceRecord = {
    id: String(row.id), organizationId: String(row.organization_id), agentId: String(row.agent_id),
    generation: Number(row.generation), securityMode: String(row.security_mode) as AgentWorkspaceSecurityMode,
    endpointRefs: JSON.parse(String(row.endpoint_refs_json)) as string[],
    allowedRefs: JSON.parse(String(row.allowed_refs_json)) as string[],
    forbiddenRefs: JSON.parse(String(row.forbidden_refs_json)) as string[],
    workspaceCharterVersion: String(row.workspace_charter_version),
    workspaceCharterDigest: String(row.workspace_charter_digest),
    dangerousActionPolicy: String(row.dangerous_action_policy) as AgentWorkspaceRecord['dangerousActionPolicy'],
    toolPolicyState: String(row.tool_policy_state) as AgentWorkspaceRecord['toolPolicyState'],
    status: String(row.status) as AgentWorkspaceRecord['status'], createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
  if (row.root_ref !== null) value.rootRef = String(row.root_ref);
  if (row.browser_profile_id !== null) value.browserProfileId = String(row.browser_profile_id);
  if (row.tool_profile_ref !== null) value.toolProfileRef = String(row.tool_profile_ref);
  if (row.error !== null) value.error = String(row.error);
  return value;
}
export class OrganizationAuthority {
  constructor(private readonly database: ControlDatabase) {}

  private event(type: string, subject: string, payload: Record<string, unknown>, now: number): void {
    this.database.db.prepare('INSERT INTO events(project_id,type,subject,payload_json,created_at) VALUES(NULL,?,?,?,?)')
      .run(type, subject, JSON.stringify(payload), now);
  }

  getOrganization(id: string): OrganizationRecord {
    const row = this.database.db.prepare('SELECT * FROM organizations WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Organization ${id} does not exist`);
    return organizationFrom(row);
  }

  listOrganizations(): OrganizationRecord[] {
    return (this.database.db.prepare('SELECT * FROM organizations ORDER BY created_at,id').all() as Row[]).map(organizationFrom);
  }

  createOrganization(input: CreateOrganizationInput, now = Date.now()): OrganizationRecord {
    const name = required(input.name, 'Organization name');
    const purpose = input.purpose?.trim() ?? '';
    const id = randomUUID();
    return this.database.transaction(() => {
      this.database.db.prepare("INSERT INTO organizations(id,name,status,purpose,created_at,updated_at) VALUES(?,?,'active',?,?,?)")
        .run(id, name, purpose, now, now);
      this.event('ORGANIZATION_CREATED', id, { name }, now);
      return this.getOrganization(id);
    });
  }

  getDepartment(id: string): DepartmentRecord {
    const row = this.database.db.prepare('SELECT * FROM departments WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Department ${id} does not exist`);
    return departmentFrom(row);
  }

  listDepartments(organizationId?: string): DepartmentRecord[] {
    const rows = organizationId
      ? this.database.db.prepare('SELECT * FROM departments WHERE organization_id=? ORDER BY created_at,id').all(organizationId)
      : this.database.db.prepare('SELECT * FROM departments ORDER BY created_at,id').all();
    return (rows as Row[]).map(departmentFrom);
  }

  createDepartment(input: CreateDepartmentInput, now = Date.now()): DepartmentRecord {
    const organization = this.getOrganization(input.organizationId);
    if (organization.status !== 'active') throw new Error('Department requires an active organization');
    const name = required(input.name, 'Department name');
    const id = randomUUID();
    return this.database.transaction(() => {
      this.database.db.prepare("INSERT INTO departments(id,organization_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,?, 'active',?,?)")
        .run(id, organization.id, name, input.purpose?.trim() ?? '', now, now);
      this.event('DEPARTMENT_CREATED', id, { organizationId: organization.id, name }, now);
      return this.getDepartment(id);
    });
  }

  getDomain(id: string): DomainRecord {
    const row = this.database.db.prepare('SELECT * FROM organization_domains WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Domain ${id} does not exist`);
    return domainFrom(row);
  }

  listDomains(organizationId?: string): DomainRecord[] {
    const rows = organizationId
      ? this.database.db.prepare('SELECT * FROM organization_domains WHERE organization_id=? ORDER BY created_at,id').all(organizationId)
      : this.database.db.prepare('SELECT * FROM organization_domains ORDER BY created_at,id').all();
    return (rows as Row[]).map(domainFrom);
  }

  createDomain(input: CreateDomainInput, now = Date.now()): DomainRecord {
    const organization = this.getOrganization(input.organizationId);
    const department = this.getDepartment(input.departmentId);
    if (organization.status !== 'active' || department.status !== 'active') throw new Error('Domain requires active organization and department');
    if (department.organizationId !== organization.id) throw new Error('Department belongs to another organization');
    const name = required(input.name, 'Domain name');
    const id = randomUUID();
    return this.database.transaction(() => {
      this.database.db.prepare("INSERT INTO organization_domains(id,organization_id,department_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,?,?,'active',?,?)")
        .run(id, organization.id, department.id, name, input.purpose?.trim() ?? '', now, now);
      this.event('DOMAIN_CREATED', id, { organizationId: organization.id, departmentId: department.id, name }, now);
      return this.getDomain(id);
    });
  }

  getAgent(id: string): OrganizationAgentRecord {
    const row = this.database.db.prepare('SELECT * FROM organization_agents WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Organization Agent ${id} does not exist`);
    return agentFrom(row);
  }

  listAgents(organizationId?: string): OrganizationAgentRecord[] {
    const rows = organizationId
      ? this.database.db.prepare('SELECT * FROM organization_agents WHERE organization_id=? ORDER BY created_at,id').all(organizationId)
      : this.database.db.prepare('SELECT * FROM organization_agents ORDER BY created_at,id').all();
    return (rows as Row[]).map(agentFrom);
  }

  registerAgent(input: RegisterOrganizationAgentInput, now = Date.now()): OrganizationAgentRecord {
    const organization = this.getOrganization(input.organizationId);
    if (organization.status !== 'active') throw new Error('Agent requires an active organization');
    let departmentId: string | null = null;
    if (input.primaryDepartmentId) {
      const department = this.getDepartment(input.primaryDepartmentId);
      if (department.organizationId !== organization.id || department.status !== 'active') throw new Error('Primary department is not active in this organization');
      departmentId = department.id;
    }
    const displayName = required(input.displayName, 'Agent display name');
    const id = randomUUID();
    return this.database.transaction(() => {
      this.database.db.prepare("INSERT INTO organization_agents(id,organization_id,display_name,primary_department_id,status,created_at,updated_at) VALUES(?,?,?,?, 'active',?,?)")
        .run(id, organization.id, displayName, departmentId, now, now);
      const workspaceId = randomUUID();
      this.database.db.prepare(`INSERT INTO agent_workspaces(id,organization_id,agent_id,generation,security_mode,workspace_charter_version,workspace_charter_digest,dangerous_action_policy,tool_policy_state,status,created_at,updated_at)
        VALUES(?,?,?,1,'prompt-guarded',?,'','approval-required','unconfigured','configuring',?,?)`).run(workspaceId, organization.id, id, WORKSPACE_CHARTER_VERSION, now, now);
      this.event('ORGANIZATION_AGENT_REGISTERED', id, { organizationId: organization.id, displayName, primaryDepartmentId: departmentId }, now);
      this.event('AGENT_WORKSPACE_REQUESTED', workspaceId, { agentId: id, generation: 1, securityMode: 'prompt-guarded' }, now);
      return this.getAgent(id);
    });
  }

  getAgentWorkspace(id: string): AgentWorkspaceRecord {
    const row = this.database.db.prepare('SELECT * FROM agent_workspaces WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Agent workspace ${id} does not exist`);
    return workspaceFrom(row);
  }

  listAgentWorkspaces(agentId?: string): AgentWorkspaceRecord[] {
    const rows = agentId
      ? this.database.db.prepare('SELECT * FROM agent_workspaces WHERE agent_id=? ORDER BY generation').all(agentId)
      : this.database.db.prepare('SELECT * FROM agent_workspaces ORDER BY organization_id,agent_id,generation').all();
    return (rows as Row[]).map(workspaceFrom);
  }

  activeAgentWorkspace(agentId: string): AgentWorkspaceRecord | undefined {
    const row = this.database.db.prepare("SELECT * FROM agent_workspaces WHERE agent_id=? AND status<>'retired' ORDER BY generation DESC LIMIT 1").get(agentId) as Row | undefined;
    return row ? workspaceFrom(row) : undefined;
  }

  requestAgentWorkspace(input: RequestAgentWorkspaceInput, now = Date.now()): AgentWorkspaceRecord {
    return this.database.transaction(() => {
      const agent = this.getAgent(input.agentId);
      if (agent.status === 'retired') throw new Error('Retired Agent cannot receive a workspace');
      if (this.activeAgentWorkspace(agent.id)) throw new Error('Agent already has a live workspace generation');
      const row = this.database.db.prepare('SELECT COALESCE(MAX(generation),0) AS generation FROM agent_workspaces WHERE agent_id=?').get(agent.id) as { generation: number };
      const generation = Number(row.generation) + 1;
      const id = randomUUID();
      this.database.db.prepare(`INSERT INTO agent_workspaces(id,organization_id,agent_id,generation,security_mode,workspace_charter_version,workspace_charter_digest,dangerous_action_policy,tool_policy_state,status,created_at,updated_at)
        VALUES(?,?,?,?,'prompt-guarded',?,'','approval-required','unconfigured','configuring',?,?)`).run(id, agent.organizationId, agent.id, generation, WORKSPACE_CHARTER_VERSION, now, now);
      this.event('AGENT_WORKSPACE_REQUESTED', id, { agentId: agent.id, generation, securityMode: 'prompt-guarded' }, now);
      return this.getAgentWorkspace(id);
    });
  }

  configureAgentWorkspace(input: ConfigureAgentWorkspaceInput, now = Date.now()): AgentWorkspaceRecord {
    return this.database.transaction(() => {
      const current = this.getAgentWorkspace(input.workspaceId);
      if (current.status !== 'configuring' && current.status !== 'error') throw new Error('Only configuring/error workspace can be configured');
      const securityMode = input.securityMode ?? 'prompt-guarded';
      const rootRef = required(input.rootRef, 'Workspace root ref');
      const browserProfileId = required(input.browserProfileId, 'Workspace browser profile id');
      const toolProfileRef = required(input.toolProfileRef, 'Workspace tool profile ref');
      const endpointRefs = [...new Set(input.endpointRefs ?? [])].map((value) => required(value, 'Workspace endpoint ref'));
      const allowedRefs = [...new Set(input.allowedRefs ?? [])].map((value) => required(value, 'Workspace allowed ref'));
      const forbiddenRefs = [...new Set(input.forbiddenRefs ?? [])].map((value) => required(value, 'Workspace forbidden ref'));
      const dangerousActionPolicy = input.dangerousActionPolicy ?? 'approval-required';
      const toolPolicyState = input.toolPolicyState ?? (securityMode === 'tool-scoped' ? 'configured' : 'unconfigured');
      if (securityMode === 'tool-scoped' && toolPolicyState !== 'configured') throw new Error('tool-scoped workspace requires configured tool policy');
      const policy = buildWorkspacePolicy({ agentId: current.agentId, rootRef, browserProfileId, toolProfileRef, securityMode, allowedRefs, forbiddenRefs, dangerousActionPolicy, toolPolicyState });
      this.database.db.prepare(`UPDATE agent_workspaces SET security_mode=?,root_ref=?,browser_profile_id=?,tool_profile_ref=?,endpoint_refs_json=?,allowed_refs_json=?,forbidden_refs_json=?,workspace_charter_version=?,workspace_charter_digest=?,dangerous_action_policy=?,tool_policy_state=?,status='ready',error=NULL,updated_at=? WHERE id=?`)
        .run(securityMode, rootRef, browserProfileId, toolProfileRef, JSON.stringify(endpointRefs), JSON.stringify(policy.allowedRefs), JSON.stringify(policy.forbiddenRefs), policy.version, policy.digest, dangerousActionPolicy, toolPolicyState, now, current.id);
      this.event('AGENT_WORKSPACE_CONFIGURED', current.id, { agentId: current.agentId, generation: current.generation, securityMode, toolPolicyState, charterDigest: policy.digest }, now);
      return this.getAgentWorkspace(current.id);
    });
  }

  workspacePrompt(workspaceId: string): string {
    const current = this.getAgentWorkspace(workspaceId);
    if (current.status !== 'ready' || !current.rootRef || !current.browserProfileId || !current.toolProfileRef) throw new Error('Workspace must be ready before its charter prompt is issued');
    return buildWorkspacePolicy({
      agentId: current.agentId, rootRef: current.rootRef, browserProfileId: current.browserProfileId,
      toolProfileRef: current.toolProfileRef, securityMode: current.securityMode, allowedRefs: current.allowedRefs,
      forbiddenRefs: current.forbiddenRefs, dangerousActionPolicy: current.dangerousActionPolicy, toolPolicyState: current.toolPolicyState,
    }).prompt;
  }
  failAgentWorkspace(workspaceId: string, error: string, now = Date.now()): AgentWorkspaceRecord {
    return this.database.transaction(() => {
      const current = this.getAgentWorkspace(workspaceId);
      if (current.status === 'retired') throw new Error('Retired workspace cannot fail');
      const detail = required(error, 'Workspace error');
      this.database.db.prepare("UPDATE agent_workspaces SET status='error',error=?,updated_at=? WHERE id=?").run(detail, now, current.id);
      this.event('AGENT_WORKSPACE_FAILED', current.id, { agentId: current.agentId, generation: current.generation, error: detail }, now);
      return this.getAgentWorkspace(current.id);
    });
  }
  retireAgentWorkspace(workspaceId: string, reason: string, now = Date.now()): AgentWorkspaceRecord {
    return this.database.transaction(() => {
      const current = this.getAgentWorkspace(workspaceId);
      if (current.status === 'retired') return current;
      const agent = this.getAgent(current.agentId);
      if (agent.runtimeSlotId) throw new Error('Unbind the Agent runtime slot before retiring its workspace');
      this.database.db.prepare("UPDATE agent_workspaces SET status='retired',error=?,updated_at=? WHERE id=?")
        .run(required(reason, 'Workspace retirement reason'), now, current.id);
      this.event('AGENT_WORKSPACE_RETIRED', current.id, { agentId: current.agentId, generation: current.generation, reason }, now);
      return this.getAgentWorkspace(current.id);
    });
  }

  unbindRuntimeSlot(agentId: string, now = Date.now()): OrganizationAgentRecord {
    return this.database.transaction(() => {
      const agent = this.getAgent(agentId);
      if (!agent.runtimeSlotId) return agent;
      const previous = agent.runtimeSlotId;
      const slot = this.database.db.prepare('SELECT browser_state FROM agent_slots WHERE id=?').get(previous) as { browser_state?: string } | undefined;
      if (slot?.browser_state && slot.browser_state !== 'absent') throw new Error('Organization Agent runtime must be browser-absent before unbinding');
      this.database.db.prepare('UPDATE organization_agents SET runtime_slot_id=NULL,updated_at=? WHERE id=?').run(now, agent.id);
      this.database.db.prepare("UPDATE organization_agent_conversations SET runtime_slot_id=NULL WHERE agent_id=? AND status='active' AND runtime_slot_id=?").run(agent.id, previous);
      this.event('ORGANIZATION_AGENT_RUNTIME_UNBOUND', agent.id, { runtimeSlotId: previous }, now);
      return this.getAgent(agent.id);
    });
  }
  bindRuntimeSlot(agentId: string, slotId: string, now = Date.now()): OrganizationAgentRecord {
    return this.database.transaction(() => {
      const agent = this.getAgent(agentId);
      if (agent.status !== 'active') throw new Error('Only an active organization Agent can bind a runtime slot');
      const workspace = this.activeAgentWorkspace(agent.id);
      if (!workspace || workspace.status !== 'ready') throw new Error('Organization Agent requires one ready dedicated workspace before runtime binding');
      if (agent.runtimeSlotId && agent.runtimeSlotId !== slotId) throw new Error('Unbind the Organization Agent runtime slot before moving it');
      const slot = this.database.db.prepare('SELECT id,conversation_key FROM agent_slots WHERE id=?').get(required(slotId, 'Runtime slot id')) as { id?: string; conversation_key?: string | null } | undefined;
      if (!slot?.id) throw new Error(`Agent slot ${slotId} does not exist`);
      const activeConversation = this.database.db.prepare("SELECT conversation_key FROM organization_agent_conversations WHERE agent_id=? AND status='active'").get(agent.id) as { conversation_key?: string } | undefined;
      if (activeConversation?.conversation_key && slot.conversation_key && slot.conversation_key !== activeConversation.conversation_key) {
        throw new Error('Runtime slot conversation conflicts with the persistent Organization Agent conversation');
      }
      const conflict = this.database.db.prepare('SELECT id FROM organization_agents WHERE runtime_slot_id=? AND id<>?').get(slotId, agent.id) as { id?: string } | undefined;
      if (conflict?.id) throw new Error(`Runtime slot ${slotId} is already bound to organization Agent ${conflict.id}`);
      this.database.db.prepare('UPDATE organization_agents SET runtime_slot_id=?,updated_at=? WHERE id=?').run(slotId, now, agent.id);
      this.database.db.prepare("UPDATE organization_agent_conversations SET runtime_slot_id=? WHERE agent_id=? AND status='active'").run(slotId, agent.id);
      this.event('ORGANIZATION_AGENT_RUNTIME_BOUND', agent.id, { runtimeSlotId: slotId, conversationKey: activeConversation?.conversation_key ?? null }, now);
      return this.getAgent(agent.id);
    });
  }

  assignAgentDomain(agentId: string, domainId: string, responsibility: 'primary' | 'secondary', now = Date.now()): AgentDomainAssignment {
    return this.database.transaction(() => {
      const agent = this.getAgent(agentId);
      const domain = this.getDomain(domainId);
      if (agent.organizationId !== domain.organizationId) throw new Error('Agent and Domain belong to different organizations');
      this.database.db.prepare(`INSERT INTO agent_domain_assignments(agent_id,domain_id,responsibility,assigned_at) VALUES(?,?,?,?)
        ON CONFLICT(agent_id,domain_id) DO UPDATE SET responsibility=excluded.responsibility,assigned_at=excluded.assigned_at`)
        .run(agent.id, domain.id, responsibility, now);
      this.event('AGENT_DOMAIN_ASSIGNED', agent.id, { domainId: domain.id, responsibility }, now);
      return { agentId: agent.id, domainId: domain.id, responsibility, assignedAt: now };
    });
  }

  listAgentDomains(agentId?: string): AgentDomainAssignment[] {
    const rows = agentId
      ? this.database.db.prepare('SELECT * FROM agent_domain_assignments WHERE agent_id=? ORDER BY domain_id').all(agentId)
      : this.database.db.prepare('SELECT * FROM agent_domain_assignments ORDER BY agent_id,domain_id').all();
    return (rows as Row[]).map((row) => ({
      agentId: String(row.agent_id), domainId: String(row.domain_id),
      responsibility: String(row.responsibility) as AgentDomainAssignment['responsibility'], assignedAt: Number(row.assigned_at),
    }));
  }

  getMission(id: string): MissionRecord {
    const row = this.database.db.prepare('SELECT * FROM missions WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Mission ${id} does not exist`);
    return missionFrom(row);
  }

  listMissions(organizationId?: string): MissionRecord[] {
    const rows = organizationId
      ? this.database.db.prepare('SELECT * FROM missions WHERE organization_id=? ORDER BY created_at,id').all(organizationId)
      : this.database.db.prepare('SELECT * FROM missions ORDER BY created_at,id').all();
    return (rows as Row[]).map(missionFrom);
  }

  createMission(input: CreateMissionInput, now = Date.now()): MissionRecord {
    const organization = this.getOrganization(input.organizationId);
    if (organization.status !== 'active') throw new Error('Mission requires an active organization');
    if (input.projectId) {
      const project = this.database.db.prepare('SELECT status FROM projects WHERE id=?').get(input.projectId) as { status?: string } | undefined;
      if (!project) throw new Error(`Project ${input.projectId} does not exist`);
      if (project.status === 'archived') throw new Error('Mission cannot target an archived project');
    }
    let dri: string | null = null;
    if (input.driAgentId) {
      const agent = this.getAgent(input.driAgentId);
      if (agent.organizationId !== organization.id || agent.status !== 'active') throw new Error('Mission DRI must be an active Agent in the organization');
      dri = agent.id;
    }
    const title = required(input.title, 'Mission title');
    const objective = required(input.objective, 'Mission objective');
    const id = randomUUID();
    return this.database.transaction(() => {
      this.database.db.prepare(`INSERT INTO missions(id,organization_id,project_id,title,objective,status,dri_agent_id,source_request_id,created_at,updated_at)
        VALUES(?,?,?,?,?,'proposed',?,?,?,?)`)
        .run(id, organization.id, input.projectId ?? null, title, objective, dri, input.sourceRequestId?.trim() || null, now, now);
      if (dri) this.database.db.prepare("INSERT INTO mission_members(mission_id,agent_id,role,joined_at) VALUES(?,?,'contributor',?)").run(id, dri, now);
      this.event('MISSION_CREATED', id, { organizationId: organization.id, projectId: input.projectId ?? null, driAgentId: dri }, now);
      return this.getMission(id);
    });
  }

  assignMissionDri(missionId: string, agentId: string, now = Date.now()): MissionRecord {
    return this.database.transaction(() => {
      const mission = this.getMission(missionId);
      if (['completed','cancelled'].includes(mission.status)) throw new Error('Terminal Mission cannot change DRI');
      const agent = this.getAgent(agentId);
      if (agent.organizationId !== mission.organizationId || agent.status !== 'active') throw new Error('Mission DRI must be an active Agent in the same organization');
      this.database.db.prepare('UPDATE missions SET dri_agent_id=?,updated_at=? WHERE id=?').run(agent.id, now, mission.id);
      this.database.db.prepare(`INSERT INTO mission_members(mission_id,agent_id,role,joined_at) VALUES(?,?,'contributor',?)
        ON CONFLICT(mission_id,agent_id) DO NOTHING`).run(mission.id, agent.id, now);
      this.event('MISSION_DRI_CHANGED', mission.id, { from: mission.driAgentId ?? null, to: agent.id }, now);
      return this.getMission(mission.id);
    });
  }

  addMissionMember(missionId: string, agentId: string, role: MissionMemberRole, now = Date.now()): MissionMemberRecord {
    return this.database.transaction(() => {
      const mission = this.getMission(missionId);
      const agent = this.getAgent(agentId);
      if (agent.organizationId !== mission.organizationId) throw new Error('Mission member belongs to another organization');
      if (agent.status === 'retired') throw new Error('Retired Agent cannot join a Mission');
      this.database.db.prepare(`INSERT INTO mission_members(mission_id,agent_id,role,joined_at) VALUES(?,?,?,?)
        ON CONFLICT(mission_id,agent_id) DO UPDATE SET role=excluded.role`).run(mission.id, agent.id, role, now);
      this.event('MISSION_MEMBER_ADDED', mission.id, { agentId: agent.id, role }, now);
      return { missionId: mission.id, agentId: agent.id, role, joinedAt: now };
    });
  }

  listMissionMembers(missionId?: string): MissionMemberRecord[] {
    const rows = missionId
      ? this.database.db.prepare('SELECT * FROM mission_members WHERE mission_id=? ORDER BY joined_at,agent_id').all(missionId)
      : this.database.db.prepare('SELECT * FROM mission_members ORDER BY mission_id,joined_at,agent_id').all();
    return (rows as Row[]).map((row) => ({
      missionId: String(row.mission_id), agentId: String(row.agent_id),
      role: String(row.role) as MissionMemberRole, joinedAt: Number(row.joined_at),
    }));
  }

  setMissionStatus(missionId: string, status: MissionStatus, now = Date.now()): MissionRecord {
    return this.database.transaction(() => {
      const mission = this.getMission(missionId);
      if (mission.status === status) return mission;
      if (['completed','cancelled'].includes(mission.status)) throw new Error('Terminal Mission cannot transition');
      if (status === 'active' && !mission.driAgentId) throw new Error('Active Mission requires one DRI');
      this.database.db.prepare('UPDATE missions SET status=?,updated_at=? WHERE id=?').run(status, now, mission.id);
      this.event('MISSION_STATUS_CHANGED', mission.id, { from: mission.status, to: status }, now);
      return this.getMission(mission.id);
    });
  }

  getWorkItem(id: string): WorkItemRecord {
    const row = this.database.db.prepare('SELECT * FROM organization_work_items WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Work item ${id} does not exist`);
    return workItemFrom(row);
  }

  listWorkItems(missionId?: string): WorkItemRecord[] {
    const rows = missionId
      ? this.database.db.prepare('SELECT * FROM organization_work_items WHERE mission_id=? ORDER BY created_at,id').all(missionId)
      : this.database.db.prepare('SELECT * FROM organization_work_items ORDER BY created_at,id').all();
    return (rows as Row[]).map(workItemFrom);
  }

  createWorkItem(input: CreateWorkItemInput, now = Date.now()): WorkItemRecord {
    const mission = this.getMission(input.missionId);
    if (['completed','cancelled'].includes(mission.status)) throw new Error('Cannot add work to a terminal Mission');
    let owner: string | null = null;
    if (input.ownerAgentId) {
      const agent = this.getAgent(input.ownerAgentId);
      if (agent.organizationId !== mission.organizationId || agent.status !== 'active') throw new Error('Work owner must be an active Agent in the Mission organization');
      owner = agent.id;
    }
    const dependsOn = [...new Set(input.dependsOn ?? [])];
    for (const dependencyId of dependsOn) {
      const dependency = this.getWorkItem(dependencyId);
      if (dependency.missionId !== mission.id) throw new Error('Work dependency belongs to another Mission');
    }
    const id = randomUUID();
    return this.database.transaction(() => {
      this.database.db.prepare(`INSERT INTO organization_work_items(id,mission_id,title,objective,owner_agent_id,status,depends_on_json,created_at,updated_at)
        VALUES(?,?,?,?,?,'proposed',?,?,?)`).run(id, mission.id, required(input.title, 'Work title'), required(input.objective, 'Work objective'), owner, JSON.stringify(dependsOn), now, now);
      this.event('WORK_ITEM_CREATED', id, { missionId: mission.id, ownerAgentId: owner, dependsOn }, now);
      return this.getWorkItem(id);
    });
  }

  assignWorkOwner(workItemId: string, agentId: string, now = Date.now()): WorkItemRecord {
    return this.database.transaction(() => {
      const work = this.getWorkItem(workItemId);
      if (['completed','cancelled'].includes(work.status)) throw new Error('Terminal work item cannot change owner');
      const mission = this.getMission(work.missionId);
      const agent = this.getAgent(agentId);
      if (agent.organizationId !== mission.organizationId || agent.status !== 'active') throw new Error('Work owner must be an active Agent in the Mission organization');
      this.database.db.prepare('UPDATE organization_work_items SET owner_agent_id=?,updated_at=? WHERE id=?').run(agent.id, now, work.id);
      this.event('WORK_ITEM_OWNER_CHANGED', work.id, { from: work.ownerAgentId ?? null, to: agent.id }, now);
      return this.getWorkItem(work.id);
    });
  }

  setWorkStatus(workItemId: string, status: WorkItemStatus, now = Date.now()): WorkItemRecord {
    return this.database.transaction(() => {
      const work = this.getWorkItem(workItemId);
      if (work.status === status) return work;
      if (['completed','cancelled'].includes(work.status)) throw new Error('Terminal work item cannot transition');
      if (status === 'active') {
        if (!work.ownerAgentId) throw new Error('Active work item requires one owner');
        const workspace = this.activeAgentWorkspace(work.ownerAgentId);
        if (!workspace || workspace.status !== 'ready') throw new Error('Active work owner requires one ready dedicated Agent workspace');
      }
      this.database.db.prepare('UPDATE organization_work_items SET status=?,updated_at=? WHERE id=?').run(status, now, work.id);
      this.event('WORK_ITEM_STATUS_CHANGED', work.id, { from: work.status, to: status }, now);
      return this.getWorkItem(work.id);
    });
  }

  snapshot(): OrganizationSnapshot {
    return {
      organizations: this.listOrganizations(),
      departments: this.listDepartments(),
      domains: this.listDomains(),
      agents: this.listAgents(),
      agentWorkspaces: this.listAgentWorkspaces(),
      agentDomains: this.listAgentDomains(),
      missions: this.listMissions(),
      missionMembers: this.listMissionMembers(),
      workItems: this.listWorkItems(),
    };
  }
}
