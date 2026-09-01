import { randomUUID } from 'node:crypto';
import type { AgentSlot } from './contracts';
import type { ControlDatabase } from './database';
import type { OrganizationAuthority } from './organizationAuthority';

export type OrganizationRuntimeAcquisitionStatus =
  | 'requested'
  | 'acquiring'
  | 'acquired'
  | 'released'
  | 'failed';

export interface RequestOrganizationRuntimeAcquisitionInput {
  organizationId: string;
  agentId: string;
  projectId: string;
  role: string;
  idempotencyKey: string;
}

export interface OrganizationRuntimeAcquisitionRecord {
  id: string;
  organizationId: string;
  agentId: string;
  projectId: string;
  role: string;
  idempotencyKey: string;
  status: OrganizationRuntimeAcquisitionStatus;
  runtimeSlotId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

type Row = Record<string, string | number | null>;
type SlotFactory = (projectId: string, role: string, now: number) => AgentSlot;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(label + ' is required');
  return normalized;
}

function recordFrom(row: Row): OrganizationRuntimeAcquisitionRecord {
  const record: OrganizationRuntimeAcquisitionRecord = {
    id: String(row.id),
    organizationId: String(row.organization_id),
    agentId: String(row.agent_id),
    projectId: String(row.project_id),
    role: String(row.role),
    idempotencyKey: String(row.idempotency_key),
    status: String(row.status) as OrganizationRuntimeAcquisitionStatus,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
  if (row.runtime_slot_id !== null) record.runtimeSlotId = String(row.runtime_slot_id);
  if (row.error !== null) record.error = String(row.error);
  return record;
}

export class OrganizationRuntimeAcquisitionAuthority {
  constructor(
    private readonly database: ControlDatabase,
    private readonly organization: OrganizationAuthority,
    private readonly createSlot: SlotFactory,
  ) {}

  private event(projectId: string, type: string, subject: string, payload: Record<string, unknown>, now: number): void {
    this.database.db.prepare(
      'INSERT INTO events(project_id,type,subject,payload_json,created_at) VALUES(?,?,?,?,?)',
    ).run(projectId, type, subject, JSON.stringify(payload), now);
  }

  private project(projectId: string): { id: string; status: string } {
    const row = this.database.db.prepare('SELECT id,status FROM projects WHERE id=?').get(projectId) as Row | undefined;
    if (!row || !row.id) throw new Error('Project ' + projectId + ' does not exist');
    return { id: String(row.id), status: String(row.status) };
  }

  private validateInput(input: RequestOrganizationRuntimeAcquisitionInput): {
    organizationId: string; agentId: string; projectId: string; role: string; idempotencyKey: string;
  } {
    const organizationId = required(input.organizationId, 'Organization id');
    const agentId = required(input.agentId, 'Organization Agent id');
    const projectId = required(input.projectId, 'Project id');
    const role = required(input.role, 'Runtime role');
    const idempotencyKey = required(input.idempotencyKey, 'Runtime acquisition idempotency key');
    const organization = this.organization.getOrganization(organizationId);
    const agent = this.organization.getAgent(agentId);
    const project = this.project(projectId);
    if (organization.status !== 'active') throw new Error('Runtime acquisition requires an active organization');
    if (agent.organizationId !== organization.id || agent.status !== 'active') throw new Error('Runtime acquisition Agent is not active in the organization');
    if (project.status !== 'active') throw new Error('Runtime acquisition requires an active project');
    return { organizationId, agentId, projectId, role, idempotencyKey };
  }

  get(id: string): OrganizationRuntimeAcquisitionRecord {
    const key = required(id, 'Runtime acquisition id');
    const row = this.database.db.prepare(
      'SELECT * FROM organization_runtime_acquisitions WHERE id=?',
    ).get(key) as Row | undefined;
    if (!row) throw new Error('Runtime acquisition ' + key + ' does not exist');
    return recordFrom(row);
  }

  list(organizationId?: string, projectId?: string): OrganizationRuntimeAcquisitionRecord[] {
    const org = organizationId?.trim();
    const project = projectId?.trim();
    let rows: unknown[];
    if (org && project) rows = this.database.db.prepare(
      'SELECT * FROM organization_runtime_acquisitions WHERE organization_id=? AND project_id=? ORDER BY created_at,id',
    ).all(org, project);
    else if (org) rows = this.database.db.prepare(
      'SELECT * FROM organization_runtime_acquisitions WHERE organization_id=? ORDER BY created_at,id',
    ).all(org);
    else if (project) rows = this.database.db.prepare(
      'SELECT * FROM organization_runtime_acquisitions WHERE project_id=? ORDER BY created_at,id',
    ).all(project);
    else rows = this.database.db.prepare(
      'SELECT * FROM organization_runtime_acquisitions ORDER BY created_at,id',
    ).all();
    return (rows as Row[]).map(recordFrom);
  }

  request(input: RequestOrganizationRuntimeAcquisitionInput, now = Date.now()): OrganizationRuntimeAcquisitionRecord {
    const normalized = this.validateInput(input);
    const existing = this.database.db.prepare(
      'SELECT * FROM organization_runtime_acquisitions WHERE organization_id=? AND idempotency_key=?',
    ).get(normalized.organizationId, normalized.idempotencyKey) as Row | undefined;
    if (existing) {
      const record = recordFrom(existing);
      if (record.agentId !== normalized.agentId || record.projectId !== normalized.projectId || record.role !== normalized.role) {
        throw new Error('Runtime acquisition idempotency key is bound to different intent');
      }
      return record;
    }
    const live = this.database.db.prepare(
      "SELECT id FROM organization_runtime_acquisitions WHERE agent_id=? AND status IN ('requested','acquiring','acquired')",
    ).get(normalized.agentId) as { id?: string } | undefined;
    if (live?.id) throw new Error('Organization Agent already has a live runtime acquisition ' + live.id);
    const id = randomUUID();
    return this.database.transaction(() => {
      this.database.db.prepare(
        "INSERT INTO organization_runtime_acquisitions(id,organization_id,agent_id,project_id,role,idempotency_key,status,runtime_slot_id,error,created_at,updated_at) VALUES(?,?,?,?,?,?, 'requested',NULL,NULL,?,?)",
      ).run(id, normalized.organizationId, normalized.agentId, normalized.projectId, normalized.role, normalized.idempotencyKey, now, now);
      this.event(normalized.projectId, 'ORGANIZATION_RUNTIME_ACQUISITION_REQUESTED', id, normalized, now);
      return this.get(id);
    });
  }

  requestAndAcquire(input: RequestOrganizationRuntimeAcquisitionInput, now = Date.now()): OrganizationRuntimeAcquisitionRecord {
    const request = this.request(input, now);
    return this.acquire(request.id, now);
  }

  retry(id: string, now = Date.now()): OrganizationRuntimeAcquisitionRecord {
    const current = this.get(id);
    if (current.status !== 'failed') throw new Error('Only a failed runtime acquisition can be retried');
    return this.database.transaction(() => {
      this.database.db.prepare(
        "UPDATE organization_runtime_acquisitions SET status='requested',error=NULL,updated_at=? WHERE id=? AND status='failed'",
      ).run(now, current.id);
      this.event(current.projectId, 'ORGANIZATION_RUNTIME_ACQUISITION_RETRIED', current.id, {}, now);
      return this.get(current.id);
    });
  }

  private candidate(projectId: string, role: string): AgentSlot | undefined {
    const row = this.database.db.prepare(
      "SELECT s.* FROM agent_slots s WHERE s.project_id=? AND s.role=? AND s.status='idle' AND s.desired_state='active' AND s.browser_state='absent' AND NOT EXISTS (SELECT 1 FROM organization_agents a WHERE a.runtime_slot_id=s.id) ORDER BY s.created_at,s.id LIMIT 1",
    ).get(projectId, role) as Row | undefined;
    return row ? this.databaseAgentSlot(row) : undefined;
  }

  private databaseAgentSlot(row: Row): AgentSlot {
    const slot: AgentSlot = {
      id: String(row.id),
      projectId: String(row.project_id),
      role: String(row.role),
      status: String(row.status) as AgentSlot['status'],
      desiredState: String(row.desired_state) as AgentSlot['desiredState'],
      browserState: String(row.browser_state) as AgentSlot['browserState'],
      conversationGeneration: Number(row.conversation_generation),
      rolloverState: String(row.rollover_state) as AgentSlot['rolloverState'],
      browserQuarantined: Boolean(row.browser_quarantined),
      leaseEpoch: Number(row.lease_epoch),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
    if (row.conversation_key !== null) slot.conversationKey = String(row.conversation_key);
    if (row.browser_profile_id !== null) slot.browserProfileId = String(row.browser_profile_id);
    return slot;
  }

  private slot(id: string): AgentSlot {
    const row = this.database.db.prepare('SELECT * FROM agent_slots WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error('Runtime slot ' + id + ' does not exist');
    return this.databaseAgentSlot(row);
  }

  private markFailed(current: OrganizationRuntimeAcquisitionRecord, error: unknown, now: number): OrganizationRuntimeAcquisitionRecord {
    const message = error instanceof Error ? error.message : String(error);
    return this.database.transaction(() => {
      this.database.db.prepare(
        "UPDATE organization_runtime_acquisitions SET status='failed',error=?,updated_at=? WHERE id=? AND status='acquiring'",
      ).run(message, now, current.id);
      this.event(current.projectId, 'ORGANIZATION_RUNTIME_ACQUISITION_FAILED', current.id, { error: message }, now);
      return this.get(current.id);
    });
  }

  private markAcquired(current: OrganizationRuntimeAcquisitionRecord, slotId: string, now: number): OrganizationRuntimeAcquisitionRecord {
    return this.database.transaction(() => {
      this.database.db.prepare(
        "UPDATE organization_runtime_acquisitions SET status='acquired',runtime_slot_id=?,error=NULL,updated_at=? WHERE id=? AND status='acquiring'",
      ).run(slotId, now, current.id);
      this.event(current.projectId, 'ORGANIZATION_RUNTIME_ACQUIRED', current.id, { agentId: current.agentId, runtimeSlotId: slotId }, now);
      return this.get(current.id);
    });
  }  acquire(id: string, now = Date.now()): OrganizationRuntimeAcquisitionRecord {
    const current = this.get(id);
    if (current.status === 'released') throw new Error('Released runtime acquisition cannot be acquired');
    if (current.status === 'failed') throw new Error('Retry the failed runtime acquisition before acquiring');
    if (current.status === 'acquired') {
      const agent = this.organization.getAgent(current.agentId);
      if (agent.runtimeSlotId !== current.runtimeSlotId) throw new Error('Acquired runtime no longer matches Agent binding');
      return current;
    }
    this.database.transaction(() => {
      this.database.db.prepare(
        "UPDATE organization_runtime_acquisitions SET status='acquiring',updated_at=? WHERE id=? AND status IN ('requested','acquiring')",
      ).run(now, current.id);
    });
    const acquiring = this.get(current.id);
    const agent = this.organization.getAgent(acquiring.agentId);
    let slotId = agent.runtimeSlotId;
    try {
      if (slotId) {
        const slot = this.slot(slotId);
        if (slot.projectId !== acquiring.projectId || slot.role !== acquiring.role || slot.desiredState !== 'active' || slot.status === 'retired') {
          throw new Error('Existing Agent runtime slot does not satisfy acquisition intent');
        }
      } else {
        const candidate = this.candidate(acquiring.projectId, acquiring.role) ?? this.createSlot(acquiring.projectId, acquiring.role, now);
        if (candidate.projectId !== acquiring.projectId || candidate.role !== acquiring.role) throw new Error('Runtime slot factory returned an incompatible slot');
        slotId = candidate.id;
      }
      if (agent.runtimeSlotId !== slotId) this.organization.bindRuntimeSlot(agent.id, slotId, now);
      const rebound = this.organization.getAgent(agent.id);
      if (rebound.runtimeSlotId !== slotId) throw new Error('Runtime binding did not converge');
      return this.markAcquired(acquiring, slotId, now);
    } catch (error) {
      const rebound = this.organization.getAgent(agent.id);
      if (slotId && rebound.runtimeSlotId === slotId) return this.markAcquired(acquiring, slotId, now);
      return this.markFailed(acquiring, error, now);
    }
  }

  release(id: string, now = Date.now()): OrganizationRuntimeAcquisitionRecord {
    const current = this.get(id);
    if (current.status === 'released') return current;
    const agent = this.organization.getAgent(current.agentId);
    if (agent.runtimeSlotId && agent.runtimeSlotId !== current.runtimeSlotId) {
      if (current.status !== 'acquiring') throw new Error('Runtime acquisition is bound to a different Agent slot');
      const bound = this.slot(agent.runtimeSlotId);
      if (bound.projectId !== current.projectId || bound.role !== current.role) throw new Error('Acquiring runtime is bound to an incompatible Agent slot');
    }
    if (agent.runtimeSlotId) this.organization.unbindRuntimeSlot(agent.id, now);
    return this.database.transaction(() => {
      this.database.db.prepare(
        "UPDATE organization_runtime_acquisitions SET status='released',updated_at=? WHERE id=? AND status<>'released'",
      ).run(now, current.id);
      this.event(current.projectId, 'ORGANIZATION_RUNTIME_ACQUISITION_RELEASED', current.id, { agentId: current.agentId, runtimeSlotId: current.runtimeSlotId ?? null }, now);
      return this.get(current.id);
    });
  }
}
