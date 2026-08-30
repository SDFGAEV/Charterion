import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { StatementSync } from 'node:sqlite';
import { ControlDatabase } from './database';
import { EvidenceAuthority } from './evidenceAuthority';
import { ChangeRequestAuthority } from './changeRequestAuthority';
import { RequestAuthority } from './requestAuthority';
import type {
  AcquireLeaseInput,
  AgentSlot,
  CapabilityGrant,
  ControlEvent,
  CreateProjectInput,
  IssueCapabilityInput,
  IssuedCapability,
  ProjectCell,
  ProjectStatus,
  ResourceKind,
  ResourceLease,
  ResourceRecord,
  BrowserRuntimeStatus,
  ReportBrowserRuntimeInput,
  AgentDesiredState,
  AgentBrowserState,
  ReportAgentBrowserInput,
} from './contracts';

type Row = Record<string, string | number | null>;

function nonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}

function positiveInt(value: number, label: string, allowZero = false): number {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`${label} is invalid`);
  return value;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
function projectFrom(row: Row): ProjectCell {
  return {
    id: String(row.id),
    name: String(row.name),
    rootPath: String(row.root_path),
    status: String(row.status) as ProjectCell['status'],
    isolationTier: String(row.isolation_tier) as ProjectCell['isolationTier'],
    minSlots: Number(row.min_slots),
    maxSlots: Number(row.max_slots),
    weight: Number(row.weight),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function agentFrom(row: Row): AgentSlot {
  const value: AgentSlot = {
    id: String(row.id),
    projectId: String(row.project_id),
    role: String(row.role),
    status: String(row.status) as AgentSlot['status'],
    desiredState: String(row.desired_state) as AgentSlot['desiredState'],
    browserState: String(row.browser_state) as AgentSlot['browserState'],
    leaseEpoch: Number(row.lease_epoch),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
  if (row.conversation_key !== null) value.conversationKey = String(row.conversation_key);
  if (row.browser_profile_id !== null) value.browserProfileId = String(row.browser_profile_id);
  if (row.browser_tab_id !== null) value.browserTabId = Number(row.browser_tab_id);
  if (row.browser_error !== null) value.browserError = String(row.browser_error);
  if (row.browser_observed_at !== null) value.browserObservedAt = Number(row.browser_observed_at);
  return value;
}

function resourceFrom(row: Row): ResourceRecord {
  const value: ResourceRecord = {
    id: String(row.id),
    kind: String(row.kind) as ResourceKind,
    label: String(row.label),
    metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
  if (row.project_id !== null) value.projectId = String(row.project_id);
  if (row.parent_id !== null) value.parentId = String(row.parent_id);
  return value;
}
function leaseFrom(row: Row): ResourceLease {
  const value: ResourceLease = {
    id: String(row.id),
    resourceId: String(row.resource_id),
    projectId: String(row.project_id),
    holderId: String(row.holder_id),
    mode: String(row.mode) as ResourceLease['mode'],
    epoch: Number(row.epoch),
    status: String(row.status) as ResourceLease['status'],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
  if (row.task_id !== null) value.taskId = String(row.task_id);
  if (row.expires_at !== null) value.expiresAt = Number(row.expires_at);
  return value;
}

function capabilityFrom(row: Row): CapabilityGrant {
  const value: CapabilityGrant = {
    id: String(row.id),
    subject: String(row.subject),
    projectId: String(row.project_id),
    scopes: parseJson<string[]>(String(row.scopes_json)),
    resourceIds: parseJson<string[]>(String(row.resource_ids_json)),
    expiresAt: Number(row.expires_at),
    createdAt: Number(row.created_at),
  };
  if (row.agent_slot_id !== null) value.agentSlotId = String(row.agent_slot_id);
  if (row.task_id !== null) value.taskId = String(row.task_id);
  if (row.lease_epoch !== null) value.leaseEpoch = Number(row.lease_epoch);
  if (row.revoked_at !== null) value.revokedAt = Number(row.revoked_at);
  return value;
}

const PROJECT_TRANSITIONS: Record<ProjectStatus, ReadonlySet<ProjectStatus>> = {
  active: new Set(['draining', 'paused', 'archived']),
  draining: new Set(['active', 'paused', 'archived']),
  paused: new Set(['active', 'archived']),
  archived: new Set(),
};
export class ControlPlane {
  readonly evidence: EvidenceAuthority;
  readonly changes: ChangeRequestAuthority;
  readonly requests: RequestAuthority;
  constructor(readonly database: ControlDatabase, gitPath = 'git') {
    this.evidence = new EvidenceAuthority(database, gitPath);
    this.changes = new ChangeRequestAuthority(database, gitPath);
    this.requests = new RequestAuthority(database);
  }

  private event(projectId: string | undefined, type: string, subject: string, payload: Record<string, unknown>, now: number): void {
    this.database.db.prepare(`
      INSERT INTO events(project_id, type, subject, payload_json, created_at)
      VALUES(?, ?, ?, ?, ?)
    `).run(projectId ?? null, type, subject, JSON.stringify(payload), now);
  }

  private requireProject(projectId: string): ProjectCell {
    const row = this.database.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Row | undefined;
    if (!row) throw new Error(`Project ${projectId} does not exist`);
    return projectFrom(row);
  }

  createProject(input: CreateProjectInput, now = Date.now()): ProjectCell {
    const name = nonEmpty(input.name, 'Project name');
    const rootPath = nonEmpty(input.rootPath, 'Project root path');
    const minSlots = positiveInt(input.minSlots ?? 0, 'minSlots', true);
    const maxSlots = positiveInt(input.maxSlots ?? Math.max(minSlots, 1), 'maxSlots', true);
    if (maxSlots < minSlots) throw new Error('maxSlots must be >= minSlots');
    const weight = positiveInt(input.weight ?? 1, 'weight');
    const id = randomUUID();
    return this.database.transaction(() => {
      this.database.db.prepare(`
        INSERT INTO projects(id, name, root_path, status, isolation_tier, min_slots, max_slots, weight, created_at, updated_at)
        VALUES(?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
      `).run(id, name, rootPath, input.isolationTier ?? 'c1-container', minSlots, maxSlots, weight, now, now);
      this.event(id, 'PROJECT_CREATED', id, { name, rootPath }, now);
      return this.requireProject(id);
    });
  }

  listProjects(): ProjectCell[] {
    return (this.database.db.prepare('SELECT * FROM projects ORDER BY created_at, id').all() as Row[]).map(projectFrom);
  }
  setProjectStatus(projectId: string, status: ProjectStatus, now = Date.now()): ProjectCell {
    return this.database.transaction(() => {
      const current = this.requireProject(projectId);
      if (current.status === status) return current;
      if (!PROJECT_TRANSITIONS[current.status].has(status)) {
        throw new Error(`Project ${projectId} cannot transition from ${current.status} to ${status}`);
      }
      this.database.db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(status, now, projectId);
      this.event(projectId, 'PROJECT_STATUS_CHANGED', projectId, { from: current.status, to: status }, now);
      return this.requireProject(projectId);
    });
  }

  createAgentSlot(projectId: string, role: string, now = Date.now()): AgentSlot {
    const normalizedRole = nonEmpty(role, 'Agent role');
    return this.database.transaction(() => {
      const project = this.requireProject(projectId);
      if (project.status !== 'active') throw new Error('Agent slots can only be created in an active project');
      const active = this.database.db.prepare("SELECT COUNT(*) AS count FROM agent_slots WHERE project_id=? AND desired_state='active' AND status<>'retired'").get(projectId) as { count: number };
      if (Number(active.count) >= project.maxSlots) throw new Error(`Project ${projectId} has reached maxSlots ${project.maxSlots}`);
      const sameRole = this.database.db.prepare("SELECT id FROM agent_slots WHERE project_id=? AND role=? AND desired_state='active' AND status<>'retired' LIMIT 1").get(projectId, normalizedRole) as { id?: string } | undefined;
      if (sameRole?.id) throw new Error(`Active agent role ${normalizedRole} already exists; use a distinct worker role`);
      const id = randomUUID();
      this.database.db.prepare(`
        INSERT INTO agent_slots(id, project_id, role, status, desired_state, browser_state, lease_epoch, created_at, updated_at)
        VALUES(?, ?, ?, 'idle', 'active', 'absent', 0, ?, ?)
      `).run(id, projectId, normalizedRole, now, now);
      this.event(projectId, 'AGENT_SLOT_CREATED', id, { role: normalizedRole, desiredState: 'active' }, now);
      return this.getAgentSlot(id);
    });
  }

  getAgentSlot(id: string): AgentSlot {
    const row = this.database.db.prepare('SELECT * FROM agent_slots WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error(`Agent slot ${id} does not exist`);
    return agentFrom(row);
  }

  listAgentSlots(projectId?: string): AgentSlot[] {
    const statement = projectId
      ? this.database.db.prepare('SELECT * FROM agent_slots WHERE project_id = ? ORDER BY created_at, id')
      : this.database.db.prepare('SELECT * FROM agent_slots ORDER BY created_at, id');
    const rows = (projectId ? statement.all(projectId) : statement.all()) as Row[];
    return rows.map(agentFrom);
  }
  bindAgentConversation(slotId: string, conversationKey: string, now = Date.now()): AgentSlot {
    const key = nonEmpty(conversationKey, 'Conversation key');
    return this.database.transaction(() => {
      const slot = this.getAgentSlot(slotId);
      const project = this.requireProject(slot.projectId);
      if (project.status === 'archived') throw new Error('Cannot bind an agent in an archived project');
      if (slot.desiredState !== 'active') throw new Error('Cannot bind a non-active agent slot');
      const conflict = this.database.db.prepare(`
        SELECT id FROM agent_slots WHERE project_id = ? AND conversation_key = ? AND id <> ?
      `).get(slot.projectId, key, slotId) as { id?: string } | undefined;
      if (conflict?.id) throw new Error(`Conversation ${key} is already bound inside project ${slot.projectId}`);
      const nextEpoch = slot.leaseEpoch + 1;
      this.database.db.prepare(`
        UPDATE agent_slots SET conversation_key = ?, status = 'assigned', lease_epoch = ?, updated_at = ? WHERE id = ?
      `).run(key, nextEpoch, now, slotId);
      this.event(slot.projectId, 'AGENT_CONVERSATION_BOUND', slotId, { conversationKey: key, epoch: nextEpoch }, now);
      return this.getAgentSlot(slotId);
    });
  }

  private fenceAgentAuthority(slotId: string, projectId: string, now: number): void {
    this.database.db.prepare('UPDATE capabilities SET revoked_at=? WHERE project_id=? AND (agent_slot_id=? OR (agent_slot_id IS NULL AND subject=?)) AND revoked_at IS NULL').run(now, projectId, slotId, slotId);
    this.database.db.prepare("UPDATE leases SET status='released',updated_at=? WHERE project_id=? AND holder_id=? AND status='active'").run(now, projectId, slotId);
  }

  suspendAgentSlot(slotId: string, now = Date.now()): AgentSlot {
    return this.database.transaction(() => {
      const slot = this.getAgentSlot(slotId);
      if (slot.status === 'retired' || slot.desiredState === 'retired') throw new Error('Retired agent slot cannot be suspended');
      if (slot.desiredState === 'suspended') return slot;
      const project = this.requireProject(slot.projectId);
      const active = this.database.db.prepare("SELECT COUNT(*) AS count FROM agent_slots WHERE project_id=? AND desired_state='active' AND status<>'retired'").get(slot.projectId) as { count: number };
      if (project.status === 'active' && Number(active.count) - 1 < project.minSlots) throw new Error(`Suspending this slot would violate minSlots ${project.minSlots}`);
      if (slot.browserState === 'absent') {
        this.fenceAgentAuthority(slot.id, slot.projectId, now);
        this.database.db.prepare("UPDATE agent_slots SET desired_state='suspended',status='suspended',lease_epoch=lease_epoch+1,updated_at=? WHERE id=?").run(now, slotId);
        this.event(slot.projectId, 'AGENT_SLOT_SUSPENDED', slotId, { previousDesiredState: slot.desiredState, finalized: true }, now);
      } else {
        this.database.db.prepare("UPDATE agent_slots SET desired_state='suspended',updated_at=? WHERE id=?").run(now, slotId);
        this.event(slot.projectId, 'AGENT_SLOT_DRAIN_REQUESTED', slotId, { previousDesiredState: slot.desiredState, browserState: slot.browserState }, now);
      }
      return this.getAgentSlot(slotId);
    });
  }

  resumeAgentSlot(slotId: string, now = Date.now()): AgentSlot {
    return this.database.transaction(() => {
      const slot = this.getAgentSlot(slotId);
      if (slot.status === 'retired' || slot.desiredState === 'retired') throw new Error('Retired agent slot cannot be resumed');
      if (slot.desiredState === 'active') return slot;
      const project = this.requireProject(slot.projectId);
      if (project.status !== 'active') throw new Error('Agent slots can only resume in an active project');
      const active = this.database.db.prepare("SELECT COUNT(*) AS count FROM agent_slots WHERE project_id=? AND desired_state='active' AND status<>'retired'").get(slot.projectId) as { count: number };
      if (Number(active.count) >= project.maxSlots) throw new Error(`Project ${slot.projectId} has reached maxSlots ${project.maxSlots}`);
      const status = slot.conversationKey ? 'assigned' : 'idle';
      this.database.db.prepare("UPDATE agent_slots SET desired_state='active',status=?,lease_epoch=lease_epoch+1,updated_at=? WHERE id=?").run(status, now, slotId);
      this.event(slot.projectId, 'AGENT_SLOT_RESUMED', slotId, { conversationKey: slot.conversationKey ?? null }, now);
      return this.getAgentSlot(slotId);
    });
  }

  retireAgentSlot(slotId: string, now = Date.now()): AgentSlot {
    return this.database.transaction(() => {
      const slot = this.getAgentSlot(slotId);
      if (slot.status === 'retired' && slot.desiredState === 'retired') return slot;
      const project = this.requireProject(slot.projectId);
      if (slot.desiredState === 'active' && project.status === 'active') {
        const active = this.database.db.prepare("SELECT COUNT(*) AS count FROM agent_slots WHERE project_id=? AND desired_state='active' AND status<>'retired'").get(slot.projectId) as { count: number };
        if (Number(active.count) - 1 < project.minSlots) throw new Error('Retiring this slot would violate minSlots ' + project.minSlots);
      }
      if (slot.browserState === 'absent') {
        this.fenceAgentAuthority(slot.id, slot.projectId, now);
        this.database.db.prepare("UPDATE agent_slots SET desired_state='retired',status='retired',lease_epoch=lease_epoch+1,updated_at=? WHERE id=?").run(now, slotId);
        this.event(slot.projectId, 'AGENT_SLOT_RETIRED', slotId, { conversationKey: slot.conversationKey ?? null, finalized: true }, now);
      } else {
        this.database.db.prepare("UPDATE agent_slots SET desired_state='retired',updated_at=? WHERE id=?").run(now, slotId);
        this.event(slot.projectId, 'AGENT_SLOT_RETIRE_REQUESTED', slotId, { conversationKey: slot.conversationKey ?? null, browserState: slot.browserState }, now);
      }
      return this.getAgentSlot(slotId);
    });
  }

  reportAgentBrowser(input: ReportAgentBrowserInput, now = input.observedAt ?? Date.now()): AgentSlot {
    const profileId = nonEmpty(input.profileId, 'Browser profile id');
    if (!['absent','opening','open','closing','error'].includes(input.browserState)) throw new Error('Agent browser state is invalid');
    if (input.tabId !== undefined && (!Number.isInteger(input.tabId) || input.tabId <= 0)) throw new Error('Agent browser tabId is invalid');
    if (!Number.isInteger(now) || now <= 0) throw new Error('Agent browser observedAt is invalid');
    return this.database.transaction(() => {
      const slot = this.getAgentSlot(input.slotId);
      if (['opening','open'].includes(input.browserState) && slot.desiredState !== 'active') throw new Error('Browser cannot open a non-active agent slot');
      let conversationKey = slot.conversationKey;
      let nextEpoch = slot.leaseEpoch;
      if (input.conversationKey) {
        const key = nonEmpty(input.conversationKey, 'Conversation key');
        if (!key.startsWith('conversation:')) throw new Error('Only durable ChatGPT conversation identities may bind an agent slot');
        if (conversationKey && conversationKey !== key) throw new Error('Browser cannot rebind an agent slot to a different durable conversation');
        const conflict = this.database.db.prepare('SELECT id FROM agent_slots WHERE project_id=? AND conversation_key=? AND id<>?').get(slot.projectId, key, slot.id) as { id?: string } | undefined;
        if (conflict?.id) throw new Error(`Conversation ${key} is already bound inside project ${slot.projectId}`);
        if (!conversationKey) { conversationKey = key; nextEpoch += 1; }
      }
      let status = slot.desiredState === 'active' ? (conversationKey ? 'assigned' : 'idle') : slot.status;
      const finalizingStop = input.browserState === 'absent' && slot.desiredState !== 'active' && slot.status !== slot.desiredState;
      if (finalizingStop) {
        this.fenceAgentAuthority(slot.id, slot.projectId, now);
        nextEpoch += 1;
        status = slot.desiredState === 'retired' ? 'retired' : 'suspended';
      }
      const tabId = input.browserState === 'absent' ? null : input.tabId ?? slot.browserTabId ?? null;
      const error = input.browserState === 'error' ? nonEmpty(input.error ?? 'Browser runtime reported an error', 'Browser error') : null;
      this.database.db.prepare(`UPDATE agent_slots SET conversation_key=?,status=?,browser_state=?,browser_profile_id=?,browser_tab_id=?,browser_error=?,browser_observed_at=?,lease_epoch=?,updated_at=? WHERE id=?`)
        .run(conversationKey ?? null, status, input.browserState, profileId, tabId, error, now, nextEpoch, now, slot.id);
      const next = this.getAgentSlot(slot.id);
      if (finalizingStop) {
        this.event(slot.projectId, slot.desiredState === 'retired' ? 'AGENT_SLOT_RETIRED' : 'AGENT_SLOT_SUSPENDED', slot.id, { conversationKey: next.conversationKey ?? null, finalized: true }, now);
      }
      if (slot.browserState !== next.browserState || slot.browserTabId !== next.browserTabId || slot.conversationKey !== next.conversationKey) {
        this.event(slot.projectId, 'AGENT_BROWSER_OBSERVED', slot.id, { browserState: next.browserState, tabId: next.browserTabId ?? null, conversationKey: next.conversationKey ?? null }, now);
      }
      return next;
    });
  }

  declareResource(input: {
    id?: string;
    projectId?: string;
    parentId?: string;
    kind: ResourceKind;
    label: string;
    metadata?: Record<string, unknown>;
  }, now = Date.now()): ResourceRecord {
    const id = input.id?.trim() || randomUUID();
    const label = nonEmpty(input.label, 'Resource label');
    return this.database.transaction(() => {
      if (input.projectId) this.requireProject(input.projectId);
      if (input.parentId) this.requireResource(input.parentId);
      this.database.db.prepare(`
        INSERT INTO resources(id, project_id, parent_id, kind, label, metadata_json, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.projectId ?? null, input.parentId ?? null, input.kind, label, JSON.stringify(input.metadata ?? {}), now, now);
      this.event(input.projectId, 'RESOURCE_DECLARED', id, { kind: input.kind, label }, now);
      return this.requireResource(id);
    });
  }
  requireResource(id: string): ResourceRecord {
    const row = this.database.db.prepare('SELECT * FROM resources WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error(`Resource ${id} does not exist`);
    return resourceFrom(row);
  }

  listResources(projectId?: string): ResourceRecord[] {
    const statement = projectId
      ? this.database.db.prepare('SELECT * FROM resources WHERE project_id = ? OR project_id IS NULL ORDER BY created_at, id')
      : this.database.db.prepare('SELECT * FROM resources ORDER BY created_at, id');
    const rows = (projectId ? statement.all(projectId) : statement.all()) as Row[];
    return rows.map(resourceFrom);
  }

  private expireResourceLeases(resourceId: string, now: number): void {
    this.database.db.prepare(`
      UPDATE leases SET status = 'expired', updated_at = ?
      WHERE resource_id = ? AND status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?
    `).run(now, resourceId, now);
  }

  private activeLeaseRows(resourceId: string): Row[] {
    return this.database.db.prepare(`
      SELECT * FROM leases WHERE resource_id = ? AND status = 'active' ORDER BY created_at, id
    `).all(resourceId) as Row[];
  }
  acquireLease(input: AcquireLeaseInput, now = Date.now()): ResourceLease {
    return this.database.transaction(() => {
      const resource = this.requireResource(input.resourceId);
      const project = this.requireProject(input.projectId);
      if (project.status !== 'active') throw new Error(`Project ${project.id} is not active`);
      if (resource.projectId && resource.projectId !== project.id) {
        throw new Error(`Resource ${resource.id} belongs to project ${resource.projectId}`);
      }
      const holderId = nonEmpty(input.holderId, 'Lease holder');
      const holderSlot = this.database.db.prepare('SELECT id, desired_state, status FROM agent_slots WHERE id = ? AND project_id = ?').get(holderId, project.id) as { id?: string; desired_state?: string; status?: string } | undefined;
      if (holderSlot?.id && (holderSlot.desired_state !== 'active' || holderSlot.status === 'retired')) {
        throw new Error(`Agent slot ${holderId} is not active and cannot acquire a lease`);
      }
      if (input.ttlMs !== undefined && (!Number.isInteger(input.ttlMs) || input.ttlMs <= 0)) {
        throw new Error('Lease ttlMs must be a positive integer');
      }
      this.expireResourceLeases(resource.id, now);
      const active = this.activeLeaseRows(resource.id).map(leaseFrom);
      const conflict = input.mode === 'exclusive'
        ? active.length > 0
        : active.some((lease) => lease.mode === 'exclusive');
      if (conflict) throw new Error(`Resource ${resource.id} is already leased incompatibly`);
      const epochRow = this.database.db.prepare('SELECT lease_epoch FROM resources WHERE id = ?').get(resource.id) as { lease_epoch: number };
      const epoch = Number(epochRow.lease_epoch) + 1;
      this.database.db.prepare('UPDATE resources SET lease_epoch = ?, updated_at = ? WHERE id = ?').run(epoch, now, resource.id);
      const id = randomUUID();
      const expiresAt = input.ttlMs === undefined ? null : now + input.ttlMs;
      this.database.db.prepare(`
        INSERT INTO leases(id, resource_id, project_id, holder_id, task_id, mode, epoch, status, expires_at, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      `).run(id, resource.id, project.id, input.holderId.trim(), input.taskId?.trim() || null, input.mode, epoch, expiresAt, now, now);
      this.event(project.id, 'LEASE_ACQUIRED', id, { resourceId: resource.id, holderId: input.holderId, mode: input.mode, epoch }, now);
      return this.getLease(id);
    });
  }
  getLease(id: string): ResourceLease {
    const row = this.database.db.prepare('SELECT * FROM leases WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error(`Lease ${id} does not exist`);
    return leaseFrom(row);
  }

  listLeases(resourceId?: string): ResourceLease[] {
    const statement = resourceId
      ? this.database.db.prepare('SELECT * FROM leases WHERE resource_id = ? ORDER BY created_at, id')
      : this.database.db.prepare('SELECT * FROM leases ORDER BY created_at, id');
    const rows = (resourceId ? statement.all(resourceId) : statement.all()) as Row[];
    return rows.map(leaseFrom);
  }

  renewLease(id: string, epoch: number, ttlMs: number, now = Date.now()): ResourceLease {
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new Error('Lease ttlMs must be a positive integer');
    return this.database.transaction(() => {
      const lease = this.getLease(id);
      this.expireResourceLeases(lease.resourceId, now);
      const current = this.getLease(id);
      if (current.status !== 'active') throw new Error(`Lease ${id} is not active`);
      if (current.epoch !== epoch) throw new Error(`Lease ${id} epoch is stale`);
      const project = this.requireProject(current.projectId);
      if (!['active', 'draining'].includes(project.status)) throw new Error(`Project ${project.id} cannot renew leases while ${project.status}`);
      const expiresAt = now + ttlMs;
      this.database.db.prepare('UPDATE leases SET expires_at = ?, updated_at = ? WHERE id = ?').run(expiresAt, now, id);
      this.event(project.id, 'LEASE_RENEWED', id, { epoch, expiresAt }, now);
      return this.getLease(id);
    });
  }
  releaseLease(id: string, epoch: number, now = Date.now()): ResourceLease {
    return this.database.transaction(() => {
      const lease = this.getLease(id);
      this.expireResourceLeases(lease.resourceId, now);
      const current = this.getLease(id);
      if (current.status !== 'active') throw new Error(`Lease ${id} is not active`);
      if (current.epoch !== epoch) throw new Error(`Lease ${id} epoch is stale`);
      this.database.db.prepare(`UPDATE leases SET status = 'released', updated_at = ? WHERE id = ?`).run(now, id);
      this.event(current.projectId, 'LEASE_RELEASED', id, { resourceId: current.resourceId, epoch }, now);
      return this.getLease(id);
    });
  }

  issueCapability(input: IssueCapabilityInput, now = Date.now()): IssuedCapability {
    if (!Number.isInteger(input.ttlMs) || input.ttlMs <= 0) throw new Error('Capability ttlMs must be a positive integer');
    const subject = nonEmpty(input.subject, 'Capability subject');
    const scopes = [...new Set(input.scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
    if (scopes.length === 0) throw new Error('Capability scopes are required');
    const resourceIds = [...new Set(input.resourceIds ?? [])].sort();
    return this.database.transaction(() => {
      this.requireProject(input.projectId);
      if (input.agentSlotId) {
        const slot = this.getAgentSlot(input.agentSlotId);
        if (slot.projectId !== input.projectId) throw new Error('Capability agent slot belongs to another project');
        if (slot.desiredState !== 'active' || slot.status === 'retired') throw new Error('Capability agent slot is not active');
        if (subject !== slot.id) throw new Error('Agent-bound capability subject must equal agentSlotId');
      }
      for (const resourceId of resourceIds) {
        const resource = this.requireResource(resourceId);
        if (resource.projectId && resource.projectId !== input.projectId) {
          throw new Error(`Capability cannot include resource ${resourceId} from another project`);
        }
      }
      const taskWrite = scopes.some((scope) => ['claim:submit','artifact:register','change:open','change:update'].includes(scope));
      if (taskWrite) {
        const taskId = input.taskId?.trim();
        if (!taskId) throw new Error('Task-write capability requires taskId');
        if (!Number.isInteger(input.leaseEpoch) || input.leaseEpoch! <= 0) throw new Error('Task-write capability requires leaseEpoch');
        if (resourceIds.length !== 1) throw new Error('Task-write capability requires exactly one resource');
        const lease = this.database.db.prepare(`
          SELECT id FROM leases WHERE resource_id=? AND project_id=? AND holder_id=? AND task_id=? AND epoch=?
            AND status='active' AND (expires_at IS NULL OR expires_at > ?)
        `).get(resourceIds[0]!, input.projectId, subject, taskId, input.leaseEpoch!, now) as { id?: string } | undefined;
        if (!lease?.id) throw new Error('Task-write capability does not match an active lease');
      }
      const id = randomUUID();
      const token = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const expiresAt = now + input.ttlMs;
      this.database.db.prepare(`
        INSERT INTO capabilities(id, token_hash, subject, project_id, agent_slot_id, task_id, lease_epoch, scopes_json, resource_ids_json, expires_at, created_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tokenHash, subject, input.projectId, input.agentSlotId ?? null, input.taskId?.trim() || null, input.leaseEpoch ?? null, JSON.stringify(scopes), JSON.stringify(resourceIds), expiresAt, now);
      this.event(input.projectId, 'CAPABILITY_ISSUED', id, { subject, agentSlotId: input.agentSlotId ?? null, scopes, resourceIds, expiresAt }, now);
      return { ...this.getCapabilityByHash(tokenHash), token };
    });
  }
  private getCapabilityByHash(tokenHash: string): CapabilityGrant {
    const row = this.database.db.prepare('SELECT * FROM capabilities WHERE token_hash = ?').get(tokenHash) as Row | undefined;
    if (!row) throw new Error('Capability token is invalid');
    return capabilityFrom(row);
  }

  verifyCapability(token: string, requiredScope: string, options: {
    projectId?: string;
    resourceId?: string;
    leaseEpoch?: number;
    now?: number;
  } = {}): CapabilityGrant {
    const now = options.now ?? Date.now();
    const tokenHash = createHash('sha256').update(nonEmpty(token, 'Capability token')).digest('hex');
    const capability = this.getCapabilityByHash(tokenHash);
    if (capability.revokedAt !== undefined) throw new Error('Capability token is revoked');
    if (capability.expiresAt <= now) throw new Error('Capability token is expired');
    if (!capability.scopes.includes(requiredScope)) throw new Error(`Capability does not grant scope ${requiredScope}`);
    if (options.projectId && capability.projectId !== options.projectId) throw new Error('Capability project does not match');
    if (options.resourceId && !capability.resourceIds.includes(options.resourceId)) throw new Error('Capability does not grant this resource');
    if (options.leaseEpoch !== undefined && capability.leaseEpoch !== options.leaseEpoch) throw new Error('Capability lease epoch is stale');
    return capability;
  }

  revokeCapability(id: string, now = Date.now()): CapabilityGrant {
    return this.database.transaction(() => {
      const row = this.database.db.prepare('SELECT * FROM capabilities WHERE id = ?').get(id) as Row | undefined;
      if (!row) throw new Error(`Capability ${id} does not exist`);
      const current = capabilityFrom(row);
      if (current.revokedAt === undefined) {
        this.database.db.prepare('UPDATE capabilities SET revoked_at = ? WHERE id = ?').run(now, id);
        this.event(current.projectId, 'CAPABILITY_REVOKED', id, {}, now);
      }
      const next = this.database.db.prepare('SELECT * FROM capabilities WHERE id = ?').get(id) as Row;
      return capabilityFrom(next);
    });
  }
  reportBrowserRuntime(input: ReportBrowserRuntimeInput, now = input.observedAt ?? Date.now()): BrowserRuntimeStatus {
    const profileId = nonEmpty(input.profileId, 'Browser profile id');
    if (!['unknown', 'authenticated', 'authentication-required'].includes(input.authStatus)) throw new Error('Browser auth status is invalid');
    if (!['unknown','ready','generating','blocked','error','unavailable'].includes(input.pageHealth)) throw new Error('Browser page health is invalid');
    if (!Number.isInteger(input.openTabs) || input.openTabs < 0) throw new Error('Browser openTabs is invalid');
    const extensionVersion = nonEmpty(input.extensionVersion, 'Extension version');
    if (!Number.isInteger(now) || now <= 0) throw new Error('Browser observedAt is invalid');
    this.database.db.prepare(`
      INSERT INTO browser_runtime(profile_id,auth_status,page_health,open_tabs,extension_version,observed_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(profile_id) DO UPDATE SET auth_status=excluded.auth_status,page_health=excluded.page_health,open_tabs=excluded.open_tabs,
        extension_version=excluded.extension_version,observed_at=excluded.observed_at
    `).run(profileId, input.authStatus, input.pageHealth, input.openTabs, extensionVersion, now);
    return { profileId, authStatus: input.authStatus, pageHealth: input.pageHealth, openTabs: input.openTabs, extensionVersion, observedAt: now };
  }

  listBrowserRuntime(): BrowserRuntimeStatus[] {
    const rows = this.database.db.prepare('SELECT * FROM browser_runtime ORDER BY profile_id').all() as Row[];
    return rows.map((row) => ({
      profileId: String(row.profile_id), authStatus: String(row.auth_status) as BrowserRuntimeStatus['authStatus'],
      pageHealth: String(row.page_health) as BrowserRuntimeStatus['pageHealth'],
      openTabs: Number(row.open_tabs), extensionVersion: String(row.extension_version), observedAt: Number(row.observed_at),
    }));
  }
  listEvents(projectId?: string, afterSeq = 0, limit = 200): ControlEvent[] {
    if (!Number.isInteger(afterSeq) || afterSeq < 0) throw new Error('afterSeq is invalid');
    if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw new Error('limit is invalid');
    const rows = (projectId
      ? this.database.db.prepare(`SELECT * FROM events WHERE project_id = ? AND seq > ? ORDER BY seq LIMIT ?`).all(projectId, afterSeq, limit)
      : this.database.db.prepare(`SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?`).all(afterSeq, limit)) as Row[];
    return rows.map((row) => {
      const event: ControlEvent = {
        seq: Number(row.seq),
        type: String(row.type),
        subject: String(row.subject),
        payload: parseJson<Record<string, unknown>>(String(row.payload_json)),
        createdAt: Number(row.created_at),
      };
      if (row.project_id !== null) event.projectId = String(row.project_id);
      return event;
    });
  }
}
