import { randomUUID } from 'node:crypto';
import type { ControlDatabase } from './database';
import { parseJsonRecord } from './persistenceCodec';
import type {
  AgentSlot, BrowserOperationOutcome, BrowserOperationRecord,
  PlanBrowserOperationInput, ReportAgentRuntimeInput, ResourceLease, RuntimeIncident,
} from './contracts';

type Row = Record<string, string | number | null>;

function nonEmpty(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function parseJson(value: string): Record<string, unknown> {
  return parseJsonRecord(value, 'Browser persisted evidence');
}

function operationFrom(row: Row): BrowserOperationRecord {
  const value: BrowserOperationRecord = {
    id: String(row.id), idempotencyKey: String(row.idempotency_key), operation: String(row.operation),
    preconditionsHash: String(row.preconditions_hash), state: String(row.state) as BrowserOperationRecord['state'],
    evidence: parseJson(String(row.evidence_json)), plannedAt: Number(row.planned_at), updatedAt: Number(row.updated_at),
  };
  if (row.project_id !== null) value.projectId = String(row.project_id);
  if (row.slot_id !== null) value.slotId = String(row.slot_id);
  if (row.conversation_key !== null) value.conversationKey = String(row.conversation_key);
  if (row.tab_id !== null) value.tabId = Number(row.tab_id);
  if (row.content_epoch !== null) value.contentEpoch = String(row.content_epoch);
  if (row.outcome !== null) value.outcome = String(row.outcome) as BrowserOperationOutcome;
  if (row.dispatched_at !== null) value.dispatchedAt = Number(row.dispatched_at);
  if (row.settled_at !== null) value.settledAt = Number(row.settled_at);
  return value;
}

function incidentFrom(row: Row): RuntimeIncident {
  const value: RuntimeIncident = {
    id: String(row.id), scope: String(row.scope), severity: String(row.severity) as RuntimeIncident['severity'],
    code: String(row.code), subject: String(row.subject), detail: parseJson(String(row.detail_json)), createdAt: Number(row.created_at),
  };
  if (row.resolved_at !== null) value.resolvedAt = Number(row.resolved_at);
  return value;
}

function leaseFrom(row: Row): ResourceLease {
  const value: ResourceLease = {
    id: String(row.id), resourceId: String(row.resource_id), projectId: String(row.project_id), holderId: String(row.holder_id),
    mode: String(row.mode) as ResourceLease['mode'], epoch: Number(row.epoch), status: String(row.status) as ResourceLease['status'],
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
  if (row.task_id !== null) value.taskId = String(row.task_id);
  if (row.expires_at !== null) value.expiresAt = Number(row.expires_at);
  return value;
}

export class BrowserAuthority {
  constructor(private readonly database: ControlDatabase) {}

  private event(projectId: string | undefined, type: string, subject: string, payload: Record<string, unknown>, now: number): void {
    this.database.db.prepare('INSERT INTO events(project_id,type,subject,payload_json,created_at) VALUES(?,?,?,?,?)')
      .run(projectId ?? null, type, subject, JSON.stringify(payload), now);
  }

  ensureOccupancy(slot: AgentSlot, profileId: string, tabId: number, now: number): ResourceLease {
    const profile = nonEmpty(profileId, 'Browser profile id');
    if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('Browser tabId is invalid');
    const resourceId = `browser-tab:${profile}:${tabId}`;
    const existingResource = this.database.db.prepare('SELECT id FROM resources WHERE id=?').get(resourceId) as { id?: string } | undefined;
    if (!existingResource?.id) {
      this.database.db.prepare(`INSERT INTO resources(id,project_id,parent_id,kind,label,metadata_json,lease_epoch,created_at,updated_at)
        VALUES(?,NULL,NULL,'browser-capacity',?,?,0,?,?)`)
        .run(resourceId, `Browser tab ${profile}/${tabId}`, JSON.stringify({ profileId: profile, tabId }), now, now);
    }

    const activeRows = this.database.db.prepare("SELECT * FROM leases WHERE resource_id=? AND status='active' ORDER BY created_at").all(resourceId) as Row[];
    const owned = activeRows.find((row) => String(row.holder_id) === slot.id);
    if (owned) return leaseFrom(owned);
    if (activeRows.length) throw new Error(`Browser tab ${profile}/${tabId} is already leased by another AgentSlot`);
    const epochRow = this.database.db.prepare('SELECT lease_epoch FROM resources WHERE id=?').get(resourceId) as { lease_epoch: number };
    const epoch = Number(epochRow.lease_epoch) + 1;
    this.database.db.prepare('UPDATE resources SET lease_epoch=?,updated_at=? WHERE id=?').run(epoch, now, resourceId);
    const id = randomUUID();
    this.database.db.prepare(`INSERT INTO leases(id,resource_id,project_id,holder_id,task_id,mode,epoch,status,expires_at,created_at,updated_at)
      VALUES(?,?,?,?,NULL,'exclusive',?,'active',NULL,?,?)`)
      .run(id, resourceId, slot.projectId, slot.id, epoch, now, now);
    this.event(slot.projectId, 'BROWSER_OCCUPANCY_ACQUIRED', slot.id, { resourceId, leaseId: id, epoch, profileId: profile, tabId }, now);
    return leaseFrom(this.database.db.prepare('SELECT * FROM leases WHERE id=?').get(id) as Row);
  }

  releaseOccupancy(slot: AgentSlot, now: number): void {
    if (!slot.browserLeaseId) return;
    const row = this.database.db.prepare('SELECT * FROM leases WHERE id=?').get(slot.browserLeaseId) as Row | undefined;
    if (!row || String(row.status) !== 'active') return;
    this.database.db.prepare("UPDATE leases SET status='released',updated_at=? WHERE id=?").run(now, slot.browserLeaseId);
    this.event(slot.projectId, 'BROWSER_OCCUPANCY_RELEASED', slot.id, {
      leaseId: slot.browserLeaseId, resourceId: String(row.resource_id), epoch: Number(row.epoch),
    }, now);
  }

  reportRuntime(slot: AgentSlot, input: ReportAgentRuntimeInput): void {
    const now = input.observedAt;
    if (!Number.isInteger(now) || now <= 0) throw new Error('Browser runtime observedAt is invalid');
    if (slot.browserProfileId !== input.profileId || slot.browserTabId !== input.tabId) throw new Error('Browser runtime does not own the current AgentSlot address');
    if (!input.contentEpoch.trim() || !Number.isInteger(input.revision) || input.revision < 1) throw new Error('Browser runtime identity is invalid');
    if (!input.semanticSignature.trim()) throw new Error('Browser runtime semantic signature is required');
    if (slot.browserRuntimeObservedAt !== undefined && now < slot.browserRuntimeObservedAt) throw new Error('Stale AgentSlot runtime observation');
    const sameEpoch = slot.browserContentEpoch === input.contentEpoch;
    if (sameEpoch && slot.browserObservationRevision !== undefined && input.revision <= slot.browserObservationRevision) {
      throw new Error('Stale AgentSlot runtime revision');
    }

    let quarantined = slot.browserQuarantined;
    let quarantineReason = slot.browserQuarantineReason;
    if (slot.browserContentEpoch && !sameEpoch) {
      const unsettled = this.database.db.prepare("SELECT id FROM browser_operations WHERE slot_id=? AND state<>'settled'")
        .all(slot.id) as { id: string }[];
      if (unsettled.length) {
        const evidence = JSON.stringify({ reason: 'content-runtime-generation-changed', from: slot.browserContentEpoch, to: input.contentEpoch });
        this.database.db.prepare("UPDATE browser_operations SET state='settled',outcome='uncertain',evidence_json=?,settled_at=?,updated_at=? WHERE slot_id=? AND state<>'settled'")
          .run(evidence, now, now, slot.id);
        quarantined = true;
        quarantineReason = `Content runtime changed with ${unsettled.length} unsettled browser operation(s)`;
      }
    } else if (sameEpoch && quarantined) {
      const remaining = this.database.db.prepare("SELECT COUNT(*) AS count FROM browser_operations WHERE slot_id=? AND state<>'settled' AND content_epoch<>?")
        .get(slot.id, input.contentEpoch) as { count: number };
      if (Number(remaining.count) === 0) { quarantined = false; quarantineReason = undefined; }
    }

    this.database.db.prepare(`UPDATE agent_slots SET browser_content_epoch=?,browser_observation_revision=?,browser_page_status=?,
      browser_runtime_observed_at=?,browser_quarantined=?,browser_quarantine_reason=?,updated_at=? WHERE id=?`)
      .run(input.contentEpoch, input.revision, input.pageStatus, now, quarantined ? 1 : 0, quarantineReason ?? null, now, slot.id);
    this.event(slot.projectId, 'AGENT_BROWSER_RUNTIME_OBSERVED', slot.id, {
      tabId: input.tabId, contentEpoch: input.contentEpoch, revision: input.revision,
      pageStatus: input.pageStatus, semanticSignature: input.semanticSignature, quarantined,
    }, now);
    return;
  }

  planOperation(input: PlanBrowserOperationInput, now = input.plannedAt ?? Date.now()): BrowserOperationRecord {
    const id = nonEmpty(input.id, 'Browser operation id');
    const idempotencyKey = nonEmpty(input.idempotencyKey, 'Browser operation idempotency key');
    const operation = nonEmpty(input.operation, 'Browser operation');
    const preconditionsHash = nonEmpty(input.preconditionsHash, 'Browser operation preconditions hash');
    const prior = this.database.db.prepare('SELECT * FROM browser_operations WHERE id=? OR idempotency_key=?').get(id, idempotencyKey) as Row | undefined;
    if (prior) {
      const current = operationFrom(prior);
      if (current.id !== id || current.idempotencyKey !== idempotencyKey || current.operation !== operation || current.preconditionsHash !== preconditionsHash) {
        throw new Error('Browser operation idempotency identity conflicts with an existing operation');
      }
      return current;
    }
    let projectId = input.projectId;
    if (input.slotId) {
      const slot = this.database.db.prepare('SELECT project_id,desired_state,browser_tab_id,browser_content_epoch,browser_quarantined FROM agent_slots WHERE id=?')
        .get(input.slotId) as Row | undefined;
      if (!slot) throw new Error(`Agent slot ${input.slotId} does not exist`);
      if (String(slot.desired_state) !== 'active') throw new Error('Browser operation AgentSlot is not active');
      if (Number(slot.browser_quarantined ?? 0) === 1) throw new Error('Browser operation AgentSlot is quarantined');
      if (projectId && projectId !== String(slot.project_id)) throw new Error('Browser operation project does not match AgentSlot');
      projectId = String(slot.project_id);
      if (input.tabId !== undefined && Number(slot.browser_tab_id) !== input.tabId) throw new Error('Browser operation tab does not match AgentSlot occupancy');
      if (input.contentEpoch && String(slot.browser_content_epoch ?? '') !== input.contentEpoch) throw new Error('Browser operation content runtime is stale');
    }
    this.database.db.prepare(`INSERT INTO browser_operations(id,idempotency_key,operation,project_id,slot_id,conversation_key,tab_id,content_epoch,
      preconditions_hash,state,outcome,evidence_json,planned_at,dispatched_at,settled_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,'planned',NULL,'{}',?,NULL,NULL,?)`)
      .run(id, idempotencyKey, operation, projectId ?? null, input.slotId ?? null, input.conversationKey ?? null,
        input.tabId ?? null, input.contentEpoch ?? null, preconditionsHash, now, now);
    this.event(projectId, 'BROWSER_OPERATION_PLANNED', id, { operation, slotId: input.slotId ?? null, tabId: input.tabId ?? null }, now);
    return this.getOperation(id);
  }

  getOperation(id: string): BrowserOperationRecord {
    const row = this.database.db.prepare('SELECT * FROM browser_operations WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Browser operation ${id} does not exist`);
    return operationFrom(row);
  }

  dispatchOperation(id: string, now = Date.now()): BrowserOperationRecord {
    const current = this.getOperation(id);
    if (current.state === 'settled' || current.state === 'dispatched') return current;
    if (current.slotId && current.contentEpoch) {
      const row = this.database.db.prepare('SELECT browser_content_epoch,browser_quarantined FROM agent_slots WHERE id=?').get(current.slotId) as Row | undefined;
      if (!row || String(row.browser_content_epoch ?? '') !== current.contentEpoch || Number(row.browser_quarantined ?? 0) === 1) {
        const evidence = JSON.stringify({ reason: 'runtime-precondition-failed-before-dispatch' });
        this.database.db.prepare("UPDATE browser_operations SET state='settled',outcome='failed',evidence_json=?,settled_at=?,updated_at=? WHERE id=?")
          .run(evidence, now, now, id);
        throw new Error('Browser operation runtime precondition failed before dispatch');
      }
    }
    this.database.db.prepare("UPDATE browser_operations SET state='dispatched',dispatched_at=?,updated_at=? WHERE id=?")
      .run(now, now, id);
    this.event(current.projectId, 'BROWSER_OPERATION_DISPATCHED', id, { operation: current.operation }, now);
    return this.getOperation(id);
  }

  settleOperation(id: string, outcome: BrowserOperationOutcome, evidence: Record<string, unknown>, now = Date.now()): BrowserOperationRecord {
    const current = this.getOperation(id);
    if (current.state === 'settled') {
      if (current.outcome === outcome) return current;
      const upgrade = (current.outcome === 'acknowledged' || current.outcome === 'uncertain') && outcome === 'reply-observed';
      if (!upgrade) throw new Error(`Browser operation ${id} is already settled as ${current.outcome}`);
    }
    if (current.state === 'planned' && outcome === 'acknowledged') throw new Error('Browser operation cannot acknowledge before dispatch');
    this.database.db.prepare("UPDATE browser_operations SET state='settled',outcome=?,evidence_json=?,settled_at=?,updated_at=? WHERE id=?")
      .run(outcome, JSON.stringify(evidence), now, now, id);
    this.event(current.projectId, 'BROWSER_OPERATION_SETTLED', id, { operation: current.operation, outcome, evidence }, now);
    return this.getOperation(id);
  }

  settleUnfinishedForSlot(slotId: string, reason: string, now = Date.now()): number {
    const rows = this.database.db.prepare("SELECT id,project_id,operation FROM browser_operations WHERE slot_id=? AND state<>'settled'").all(slotId) as Row[];
    for (const row of rows) {
      const evidence = { reason };
      this.database.db.prepare("UPDATE browser_operations SET state='settled',outcome='uncertain',evidence_json=?,settled_at=?,updated_at=? WHERE id=?")
        .run(JSON.stringify(evidence), now, now, String(row.id));
      this.event(row.project_id === null ? undefined : String(row.project_id), 'BROWSER_OPERATION_SETTLED', String(row.id), { operation: String(row.operation), outcome: 'uncertain', evidence }, now);
    }
    return rows.length;
  }

  listOperations(slotId?: string): BrowserOperationRecord[] {
    const rows = (slotId
      ? this.database.db.prepare('SELECT * FROM browser_operations WHERE slot_id=? ORDER BY planned_at,id').all(slotId)
      : this.database.db.prepare('SELECT * FROM browser_operations ORDER BY planned_at,id').all()) as Row[];
    return rows.map(operationFrom);
  }

  reportIncident(input: { scope: string; severity: RuntimeIncident['severity']; code: string; subject: string; detail?: Record<string, unknown> }, now = Date.now()): RuntimeIncident {
    const id = randomUUID();
    const scope = nonEmpty(input.scope, 'Incident scope');
    const code = nonEmpty(input.code, 'Incident code');
    const subject = nonEmpty(input.subject, 'Incident subject');
    this.database.db.prepare(`INSERT INTO runtime_incidents(id,scope,severity,code,subject,detail_json,created_at,resolved_at)
      VALUES(?,?,?,?,?,?,?,NULL)`)
      .run(id, scope, input.severity, code, subject, JSON.stringify(input.detail ?? {}), now);
    this.event(undefined, 'RUNTIME_INCIDENT_REPORTED', id, { scope, severity: input.severity, code, subject }, now);
    return incidentFrom(this.database.db.prepare('SELECT * FROM runtime_incidents WHERE id=?').get(id) as Row);
  }

  listIncidents(openOnly = false): RuntimeIncident[] {
    const rows = (openOnly
      ? this.database.db.prepare('SELECT * FROM runtime_incidents WHERE resolved_at IS NULL ORDER BY created_at,id').all()
      : this.database.db.prepare('SELECT * FROM runtime_incidents ORDER BY created_at,id').all()) as Row[];
    return rows.map(incidentFrom);
  }

  resolveIncident(id: string, now = Date.now()): RuntimeIncident {
    const row = this.database.db.prepare('SELECT * FROM runtime_incidents WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Runtime incident ${id} does not exist`);
    if (row.resolved_at === null) this.database.db.prepare('UPDATE runtime_incidents SET resolved_at=? WHERE id=?').run(now, id);
    return incidentFrom(this.database.db.prepare('SELECT * FROM runtime_incidents WHERE id=?').get(id) as Row);
  }
}
