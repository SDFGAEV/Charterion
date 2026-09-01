import { createHash, randomUUID } from 'node:crypto';
import type { ControlDatabase } from './database';
import type {
  ClaimFindingInput,
  DiscoverFindingInput,
  DiscoverFindingResult,
  FindingEvidenceRecord,
  FindingRecord,
  FindingStatus,
} from './findingContracts';

type Row = Record<string, string | number | null>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replaceAll('\\', '/').replace(/\s+/g, ' ');
}
function fingerprint(input: DiscoverFindingInput): string {
  if (input.fingerprintHint?.trim()) return normalizeText(input.fingerprintHint);
  const locations = [...new Set((input.locations ?? []).map(normalizeText).filter(Boolean))].sort();
  const payload = [
    input.projectId?.trim() ?? '*',
    input.domainId?.trim() ?? '*',
    normalizeText(input.title),
    normalizeText(input.symptom),
    ...locations,
  ].join('\n');
  return createHash('sha256').update(payload).digest('hex');
}

function findingFrom(row: Row): FindingRecord {
  const value: FindingRecord = {
    id: String(row.id), organizationId: String(row.organization_id), fingerprint: String(row.fingerprint),
    title: String(row.title), symptom: String(row.symptom), locations: JSON.parse(String(row.locations_json)) as string[],
    status: String(row.status) as FindingStatus, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
  if (row.project_id !== null) value.projectId = String(row.project_id);
  if (row.domain_id !== null) value.domainId = String(row.domain_id);
  if (row.owning_department_id !== null) value.owningDepartmentId = String(row.owning_department_id);
  if (row.owning_agent_id !== null) value.owningAgentId = String(row.owning_agent_id);
  if (row.mission_id !== null) value.missionId = String(row.mission_id);
  return value;
}
function evidenceFrom(row: Row): FindingEvidenceRecord {
  return {
    id: String(row.id), findingId: String(row.finding_id), observerSubject: String(row.observer_subject),
    evidenceRefs: JSON.parse(String(row.evidence_refs_json)) as string[], note: String(row.note), createdAt: Number(row.created_at),
  };
}

export class FindingAuthority {
  constructor(private readonly database: ControlDatabase) {}

  private event(type: string, subject: string, payload: Record<string, unknown>, now: number): void {
    this.database.db.prepare('INSERT INTO events(project_id,type,subject,payload_json,created_at) VALUES(NULL,?,?,?,?)')
      .run(type, subject, JSON.stringify(payload), now);
  }

  get(id: string): FindingRecord {
    const row = this.database.db.prepare('SELECT * FROM findings WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Finding ${id} does not exist`);
    return findingFrom(row);
  }

  list(organizationId?: string): FindingRecord[] {
    const rows = organizationId
      ? this.database.db.prepare('SELECT * FROM findings WHERE organization_id=? ORDER BY created_at,id').all(organizationId)
      : this.database.db.prepare('SELECT * FROM findings ORDER BY organization_id,created_at,id').all();
    return (rows as Row[]).map(findingFrom);
  }
  listEvidence(findingId: string): FindingEvidenceRecord[] {
    return (this.database.db.prepare('SELECT * FROM finding_evidence WHERE finding_id=? ORDER BY created_at,id').all(findingId) as Row[]).map(evidenceFrom);
  }

  discover(input: DiscoverFindingInput, now = Date.now()): DiscoverFindingResult {
    const organizationId = required(input.organizationId, 'Organization id');
    const title = required(input.title, 'Finding title');
    const symptom = required(input.symptom, 'Finding symptom');
    const observer = required(input.observerSubject, 'Finding observer');
    const locations = [...new Set((input.locations ?? []).map((value) => required(value, 'Finding location')))].sort();
    const evidenceRefs = [...new Set((input.evidenceRefs ?? []).map((value) => required(value, 'Finding evidence ref')))].sort();
    const key = fingerprint({ ...input, title, symptom, locations });
    return this.database.transaction(() => {
      const organization = this.database.db.prepare('SELECT status FROM organizations WHERE id=?').get(organizationId) as { status?: string } | undefined;
      if (!organization?.status) throw new Error(`Organization ${organizationId} does not exist`);
      const scope = input.projectId?.trim() || '*';
      const existing = this.database.db.prepare('SELECT * FROM findings WHERE organization_id=? AND scope_key=? AND fingerprint=?')
        .get(organizationId, scope, key) as Row | undefined;
      let finding: FindingRecord;
      let duplicate = false;
      if (existing) {
        finding = findingFrom(existing); duplicate = true;
      } else {
        const id = randomUUID();
        this.database.db.prepare(`INSERT INTO findings(
          id,organization_id,project_id,scope_key,domain_id,fingerprint,title,symptom,locations_json,status,
          owning_department_id,owning_agent_id,mission_id,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,'open',NULL,NULL,NULL,?,?)`)
          .run(id, organizationId, input.projectId?.trim() || null, scope, input.domainId?.trim() || null, key, title, symptom, JSON.stringify(locations), now, now);
        finding = this.get(id);
        this.event('FINDING_DISCOVERED', id, { organizationId, projectId: finding.projectId ?? null, domainId: finding.domainId ?? null, fingerprint: key }, now);
      }
      const evidenceId = randomUUID();
      this.database.db.prepare(`INSERT INTO finding_evidence(id,finding_id,observer_subject,evidence_refs_json,note,created_at)
        VALUES(?,?,?,?,?,?)`).run(evidenceId, finding.id, observer, JSON.stringify(evidenceRefs), input.note?.trim() ?? '', now);
      if (duplicate) this.event('FINDING_DUPLICATE_EVIDENCE_ATTACHED', finding.id, { observerSubject: observer, evidenceId }, now);
      return { finding, evidence: this.listEvidence(finding.id).find((item) => item.id === evidenceId)!, duplicate };
    });
  }

  claim(input: ClaimFindingInput, now = Date.now()): FindingRecord {
    return this.database.transaction(() => {
      const current = this.get(input.findingId);
      const agent = this.database.db.prepare('SELECT organization_id,primary_department_id,status FROM organization_agents WHERE id=?').get(input.agentId) as { organization_id?: string; primary_department_id?: string | null; status?: string } | undefined;
      if (!agent?.organization_id || agent.status !== 'active') throw new Error('Finding owner must be an active Organization Agent');
      if (agent.organization_id !== current.organizationId) throw new Error('Finding owner belongs to another Organization');
      if (current.owningAgentId && current.owningAgentId !== input.agentId) throw new Error('Finding already has an authoritative owner');
      const missionId = input.missionId?.trim() || current.missionId || null;
      if (missionId) {
        const mission = this.database.db.prepare('SELECT organization_id FROM missions WHERE id=?').get(missionId) as { organization_id?: string } | undefined;
        if (mission?.organization_id !== current.organizationId) throw new Error('Finding Mission belongs to another Organization');
      }
      this.database.db.prepare(`UPDATE findings SET owning_department_id=?,owning_agent_id=?,mission_id=?,status='owned',updated_at=? WHERE id=?`)
        .run(agent.primary_department_id ?? null, input.agentId, missionId, now, current.id);
      this.event('FINDING_OWNER_ASSIGNED', current.id, { agentId: input.agentId, missionId }, now);
      return this.get(current.id);
    });
  }

  setStatus(findingId: string, status: Extract<FindingStatus, 'in-progress' | 'resolved' | 'rejected'>, now = Date.now()): FindingRecord {
    return this.database.transaction(() => {
      const current = this.get(findingId);
      if (status === 'in-progress' && !current.owningAgentId) throw new Error('Finding needs an authoritative owner before work starts');
      if (['resolved','rejected'].includes(current.status)) return current;
      this.database.db.prepare('UPDATE findings SET status=?,updated_at=? WHERE id=?').run(status, now, current.id);
      this.event('FINDING_STATUS_CHANGED', current.id, { from: current.status, to: status }, now);
      return this.get(current.id);
    });
  }
}
