import { createHash, randomUUID } from 'node:crypto';
import type { ControlDatabase } from './database';
import type { MissionRecord, WorkItemCompletionPolicy, WorkItemRecord } from './organizationContracts';
import type {
  AcceptWorkRequestInput,
  CompleteWorkItemInput,
  DecideWorkRequestInput,
  SubmitWorkRequestInput,
  WorkOutcomeRecord,
  WorkPriority,
  WorkRequestRecord,
  WorkRequesterKind,
  WorkRequestStatus,
} from './workIngressContracts';

type Row = Record<string, string | number | null>;
const REQUESTER_KINDS = new Set<WorkRequesterKind>(['human','external-ai','internal-agent','system']);
const PRIORITIES = new Set<WorkPriority>(['low','normal','high','urgent']);

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function strings(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function requestFrom(row: Row): WorkRequestRecord {
  const value: WorkRequestRecord = {
    id: String(row.id), organizationId: String(row.organization_id), requesterKind: String(row.requester_kind) as WorkRequesterKind,
    requesterIdentity: String(row.requester_identity), objective: String(row.objective),
    contextRefs: JSON.parse(String(row.context_refs_json)) as string[], constraints: JSON.parse(String(row.constraints_json)) as string[],
    desiredOutputs: JSON.parse(String(row.desired_outputs_json)) as string[], priority: String(row.priority) as WorkPriority,
    status: String(row.status) as WorkRequestStatus, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
  if (row.project_id !== null) value.projectId = String(row.project_id);
  if (row.deadline !== null) value.deadline = Number(row.deadline);
  if (row.idempotency_key !== null) value.idempotencyKey = String(row.idempotency_key);
  if (row.mission_id !== null) value.missionId = String(row.mission_id);
  if (row.decision_by !== null) value.decisionBy = String(row.decision_by);
  if (row.decision_reason !== null) value.decisionReason = String(row.decision_reason);
  return value;
}

function outcomeFrom(row: Row): WorkOutcomeRecord {
  return {
    workItemId: String(row.work_item_id), disposition: String(row.disposition) as WorkOutcomeRecord['disposition'],
    summary: String(row.summary), producedRefs: JSON.parse(String(row.produced_refs_json)) as string[],
    decisionRefs: JSON.parse(String(row.decision_refs_json)) as string[], blockerRefs: JSON.parse(String(row.blocker_refs_json)) as string[],
    completedAt: Number(row.completed_at),
  };
}

function requestDigest(input: {
  organizationId: string; projectId?: string; requesterKind: WorkRequesterKind; requesterIdentity: string; objective: string;
  contextRefs: string[]; constraints: string[]; desiredOutputs: string[]; priority: WorkPriority; deadline?: number;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export class WorkIngressAuthority {
  constructor(private readonly database: ControlDatabase) {}

  private event(type: string, subject: string, payload: Record<string, unknown>, now: number): void {
    this.database.db.prepare('INSERT INTO events(project_id,type,subject,payload_json,created_at) VALUES(NULL,?,?,?,?)')
      .run(type, subject, JSON.stringify(payload), now);
  }

  get(id: string): WorkRequestRecord {
    const row = this.database.db.prepare('SELECT * FROM work_requests WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Work request ${id} does not exist`);
    return requestFrom(row);
  }

  list(organizationId?: string, status?: WorkRequestStatus): WorkRequestRecord[] {
    const where: string[] = []; const params: string[] = [];
    if (organizationId) { where.push('organization_id=?'); params.push(organizationId); }
    if (status) { where.push('status=?'); params.push(status); }
    const sql = `SELECT * FROM work_requests${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at,id`;
    return (this.database.db.prepare(sql).all(...params) as Row[]).map(requestFrom);
  }

  submit(input: SubmitWorkRequestInput, now = Date.now()): WorkRequestRecord {
    if (!REQUESTER_KINDS.has(input.requesterKind)) throw new Error('Requester kind is invalid');
    const organizationId = required(input.organizationId, 'Organization id');
    const organization = this.database.db.prepare('SELECT status FROM organizations WHERE id=?').get(organizationId) as { status?: string } | undefined;
    if (!organization) throw new Error(`Organization ${organizationId} does not exist`);
    if (organization.status !== 'active') throw new Error('Work can only be submitted to an active organization');
    const requesterIdentity = required(input.requesterIdentity, 'Requester identity');
    const objective = required(input.objective, 'Work objective');
    const priority = input.priority ?? 'normal';
    if (!PRIORITIES.has(priority)) throw new Error('Work priority is invalid');
    if (input.deadline !== undefined && (!Number.isInteger(input.deadline) || input.deadline <= 0)) throw new Error('Work deadline is invalid');
    if (input.projectId) {
      const project = this.database.db.prepare('SELECT status FROM projects WHERE id=?').get(input.projectId) as { status?: string } | undefined;
      if (!project) throw new Error(`Project ${input.projectId} does not exist`);
      if (project.status === 'archived') throw new Error('Cannot submit work to an archived project');
    }
    const contextRefs = strings(input.contextRefs); const constraints = strings(input.constraints); const desiredOutputs = strings(input.desiredOutputs);
    const normalized = { organizationId, ...(input.projectId ? { projectId: input.projectId } : {}), requesterKind: input.requesterKind, requesterIdentity, objective, contextRefs, constraints, desiredOutputs, priority, ...(input.deadline !== undefined ? { deadline: input.deadline } : {}) };
    const digest = requestDigest(normalized);
    const idempotencyKey = input.idempotencyKey?.trim() || undefined;
    if (idempotencyKey) {
      const existing = this.database.db.prepare(`SELECT * FROM work_requests WHERE organization_id=? AND requester_kind=? AND requester_identity=? AND idempotency_key=?`)
        .get(organizationId, input.requesterKind, requesterIdentity, idempotencyKey) as Row | undefined;
      if (existing) {
        if (String(existing.request_digest) !== digest) throw new Error('Work request idempotency key was reused with a different payload');
        return requestFrom(existing);
      }
    }
    const id = randomUUID();
    return this.database.transaction(() => {
      this.database.db.prepare(`INSERT INTO work_requests(id,organization_id,project_id,requester_kind,requester_identity,objective,context_refs_json,constraints_json,desired_outputs_json,
        priority,deadline,idempotency_key,request_digest,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'received',?,?)`)
        .run(id, organizationId, input.projectId ?? null, input.requesterKind, requesterIdentity, objective, JSON.stringify(contextRefs), JSON.stringify(constraints),
          JSON.stringify(desiredOutputs), priority, input.deadline ?? null, idempotencyKey ?? null, digest, now, now);
      this.event('WORK_REQUEST_RECEIVED', id, { organizationId, projectId: input.projectId ?? null, requesterKind: input.requesterKind, requesterIdentity }, now);
      return this.get(id);
    });
  }

  accept(input: AcceptWorkRequestInput, now = Date.now()): WorkRequestRecord {
    const acceptedBy = required(input.acceptedBy, 'Accepted by');
    return this.database.transaction(() => {
      const request = this.get(input.requestId);
      if (request.status === 'accepted') return request;
      if (request.status !== 'received') throw new Error(`Work request ${request.id} is already ${request.status}`);
      let driAgentId: string | null = null;
      if (input.driAgentId) {
        const agent = this.database.db.prepare('SELECT organization_id,status FROM organization_agents WHERE id=?').get(input.driAgentId) as { organization_id?: string; status?: string } | undefined;
        if (!agent || agent.organization_id !== request.organizationId || agent.status !== 'active') throw new Error('Work request DRI must be an active Agent in the request organization');
        driAgentId = input.driAgentId;
      }
      const missionId = randomUUID();
      const workItemId = randomUUID();
      const missionTitle = input.missionTitle?.trim() || request.objective.slice(0, 120);
      const completionPolicy = input.completionPolicy ?? 'verified-claim';
      if (!['structured-result', 'verified-claim'].includes(completionPolicy)) throw new Error('Work completion policy is invalid');
      const missionStatus = driAgentId ? 'active' : 'proposed';
      const workStatus = driAgentId ? 'ready' : 'proposed';
      this.database.db.prepare(`INSERT INTO missions(id,organization_id,project_id,title,objective,status,dri_agent_id,source_request_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(missionId, request.organizationId, request.projectId ?? null, missionTitle, request.objective, missionStatus, driAgentId, request.id, now, now);
      if (driAgentId) this.database.db.prepare("INSERT INTO mission_members(mission_id,agent_id,role,joined_at) VALUES(?,?,'contributor',?)").run(missionId, driAgentId, now);
      this.database.db.prepare(`INSERT INTO organization_work_items(id,mission_id,title,objective,owner_agent_id,status,completion_policy,depends_on_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,'[]',?,?)`).run(workItemId, missionId, missionTitle, request.objective, driAgentId, workStatus, completionPolicy, now, now);
      this.database.db.prepare("UPDATE work_requests SET status='accepted',mission_id=?,decision_by=?,updated_at=? WHERE id=?")
        .run(missionId, acceptedBy, now, request.id);
      this.event('WORK_REQUEST_ACCEPTED', request.id, { acceptedBy, missionId, workItemId, driAgentId, completionPolicy }, now);
      return this.get(request.id);
    });
  }

  reject(input: DecideWorkRequestInput, now = Date.now()): WorkRequestRecord {
    const decidedBy = required(input.decidedBy, 'Decided by');
    const reason = required(input.reason, 'Decision reason');
    return this.database.transaction(() => {
      const request = this.get(input.requestId);
      if (request.status === 'rejected') return request;
      if (request.status !== 'received') throw new Error(`Only a received work request can be rejected; current=${request.status}`);
      this.database.db.prepare("UPDATE work_requests SET status='rejected',decision_by=?,decision_reason=?,updated_at=? WHERE id=?")
        .run(decidedBy, reason, now, request.id);
      this.event('WORK_REQUEST_REJECTED', request.id, { decidedBy, reason }, now);
      return this.get(request.id);
    });
  }

  cancel(input: DecideWorkRequestInput, now = Date.now()): WorkRequestRecord {
    const decidedBy = required(input.decidedBy, 'Cancelled by');
    const reason = required(input.reason, 'Cancellation reason');
    return this.database.transaction(() => {
      const request = this.get(input.requestId);
      if (request.status === 'cancelled') return request;
      if (request.status === 'rejected') throw new Error('Rejected work request cannot be cancelled');
      this.database.db.prepare("UPDATE work_requests SET status='cancelled',decision_by=?,decision_reason=?,updated_at=? WHERE id=?")
        .run(decidedBy, reason, now, request.id);
      if (request.missionId) {
        this.database.db.prepare("UPDATE missions SET status='cancelled',updated_at=? WHERE id=? AND status NOT IN ('completed','cancelled')").run(now, request.missionId);
        this.database.db.prepare("UPDATE organization_work_items SET status='cancelled',updated_at=? WHERE mission_id=? AND status NOT IN ('completed','cancelled')").run(now, request.missionId);
      }
      this.event('WORK_REQUEST_CANCELLED', request.id, { decidedBy, reason, missionId: request.missionId ?? null }, now);
      return this.get(request.id);
    });
  }

  getOutcome(workItemId: string): WorkOutcomeRecord | undefined {
    const row = this.database.db.prepare('SELECT * FROM work_outcomes WHERE work_item_id=?').get(workItemId) as Row | undefined;
    return row ? outcomeFrom(row) : undefined;
  }

  completeWorkItem(input: CompleteWorkItemInput, now = Date.now()): WorkOutcomeRecord {
    const completedBy = required(input.completedBy, 'Completed by');
    const summary = required(input.summary, 'Outcome summary');
    return this.database.transaction(() => {
      const row = this.database.db.prepare(`SELECT w.*,m.dri_agent_id,m.status AS mission_status FROM organization_work_items w JOIN missions m ON m.id=w.mission_id WHERE w.id=?`)
        .get(input.workItemId) as Row | undefined;
      if (!row) throw new Error(`Work item ${input.workItemId} does not exist`);
      const existing = this.getOutcome(input.workItemId);
      if (existing) return existing;
      if (String(row.status) === 'cancelled') throw new Error('Cancelled work item cannot complete');
      const owner = row.owner_agent_id === null ? undefined : String(row.owner_agent_id);
      const dri = row.dri_agent_id === null ? undefined : String(row.dri_agent_id);
      if (completedBy !== owner && completedBy !== dri) throw new Error('Only the Work owner or Mission DRI may complete the Work item');
      const producedRefs = strings(input.producedRefs); const decisionRefs = strings(input.decisionRefs); const blockerRefs = strings(input.blockerRefs);
      this.database.db.prepare("UPDATE organization_work_items SET status='completed',updated_at=? WHERE id=?").run(now, input.workItemId);
      this.database.db.prepare(`INSERT INTO work_outcomes(work_item_id,disposition,summary,produced_refs_json,decision_refs_json,blocker_refs_json,completed_at)
        VALUES(?,'completed',?,?,?,?,?)`).run(input.workItemId, summary, JSON.stringify(producedRefs), JSON.stringify(decisionRefs), JSON.stringify(blockerRefs), now);
      const unfinished = this.database.db.prepare("SELECT COUNT(*) AS count FROM organization_work_items WHERE mission_id=? AND status NOT IN ('completed','cancelled')")
        .get(String(row.mission_id)) as { count: number };
      if (Number(unfinished.count) === 0 && String(row.mission_status) !== 'cancelled') this.database.db.prepare("UPDATE missions SET status='completed',updated_at=? WHERE id=?").run(now, String(row.mission_id));
      this.event('WORK_ITEM_COMPLETED', input.workItemId, { completedBy, producedRefs, decisionRefs, blockerRefs }, now);
      return this.getOutcome(input.workItemId)!;
    });
  }

  missionFor(requestId: string): MissionRecord | undefined {
    const request = this.get(requestId);
    if (!request.missionId) return undefined;
    const row = this.database.db.prepare('SELECT * FROM missions WHERE id=?').get(request.missionId) as Row | undefined;
    if (!row) return undefined;
    const mission: MissionRecord = {
      id: String(row.id), organizationId: String(row.organization_id), title: String(row.title), objective: String(row.objective),
      status: String(row.status) as MissionRecord['status'], createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    };
    if (row.project_id !== null) mission.projectId = String(row.project_id);
    if (row.dri_agent_id !== null) mission.driAgentId = String(row.dri_agent_id);
    if (row.source_request_id !== null) mission.sourceRequestId = String(row.source_request_id);
    return mission;
  }

  workFor(requestId: string): WorkItemRecord[] {
    const mission = this.missionFor(requestId);
    if (!mission) return [];
    return (this.database.db.prepare('SELECT * FROM organization_work_items WHERE mission_id=? ORDER BY created_at,id').all(mission.id) as Row[]).map((row) => {
      const item: WorkItemRecord = { id: String(row.id), missionId: String(row.mission_id), title: String(row.title), objective: String(row.objective), status: String(row.status) as WorkItemRecord['status'], completionPolicy: String(row.completion_policy ?? 'verified-claim') as WorkItemRecord['completionPolicy'], dependsOn: JSON.parse(String(row.depends_on_json)) as string[], createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
      if (row.owner_agent_id !== null) item.ownerAgentId = String(row.owner_agent_id);
      return item;
    });
  }
}
