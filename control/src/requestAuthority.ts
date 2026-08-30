import { randomUUID } from 'node:crypto';
import { ControlDatabase } from './database';
import type { DecideWorkerRequestInput, SubmitWorkerRequestInput, WorkerRequest, WorkerRequestType } from './contracts';

type Row = Record<string, string | number | null>;
const TYPES = new Set<WorkerRequestType>([
  'suggestion','blocker','question','resource-request','scope-change','dependency-request',
  'cross-system-request','review-request','risk-alert','worker-request',
]);

function required(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function fromRow(row: Row): WorkerRequest {
  const value: WorkerRequest = {
    id: String(row.id), projectId: String(row.project_id), fromSubject: String(row.from_subject),
    type: String(row.type) as WorkerRequest['type'], title: String(row.title), body: String(row.body),
    status: String(row.status) as WorkerRequest['status'], createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
  if (row.task_id !== null) value.taskId = String(row.task_id);
  if (row.suggested_action !== null) value.suggestedAction = String(row.suggested_action);
  if (row.decided_by !== null) value.decidedBy = String(row.decided_by);
  if (row.decision_note !== null) value.decisionNote = String(row.decision_note);
  return value;
}

export class RequestAuthority {
  constructor(private readonly database: ControlDatabase) {}

  private event(projectId: string, type: string, subject: string, payload: Record<string, unknown>, now: number): void {
    this.database.db.prepare('INSERT INTO events(project_id,type,subject,payload_json,created_at) VALUES(?,?,?,?,?)')
      .run(projectId, type, subject, JSON.stringify(payload), now);
  }

  get(id: string): WorkerRequest {
    const row = this.database.db.prepare('SELECT * FROM worker_requests WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Worker request ${id} does not exist`);
    return fromRow(row);
  }

  list(projectId?: string, status?: WorkerRequest['status']): WorkerRequest[] {
    let sql = 'SELECT * FROM worker_requests';
    const params: string[] = [];
    const where: string[] = [];
    if (projectId) { where.push('project_id=?'); params.push(projectId); }
    if (status) { where.push('status=?'); params.push(status); }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY created_at,id';
    return (this.database.db.prepare(sql).all(...params) as Row[]).map(fromRow);
  }

  submit(input: SubmitWorkerRequestInput, now = Date.now()): WorkerRequest {
    const fromSubject = required(input.fromSubject, 'Request subject');
    const title = required(input.title, 'Request title');
    const body = required(input.body, 'Request body');
    if (!TYPES.has(input.type)) throw new Error('Worker request type is invalid');
    const project = this.database.db.prepare('SELECT status FROM projects WHERE id=?').get(input.projectId) as { status?: string } | undefined;
    if (!project) throw new Error(`Project ${input.projectId} does not exist`);
    if (project.status === 'archived') throw new Error('Cannot submit a request to an archived project');
    const id = randomUUID();
    this.database.transaction(() => {
      this.database.db.prepare(`INSERT INTO worker_requests(id,project_id,task_id,from_subject,type,title,body,suggested_action,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?, 'open',?,?)`)
        .run(id, input.projectId, input.taskId?.trim() || null, fromSubject, input.type, title, body, input.suggestedAction?.trim() || null, now, now);
      this.event(input.projectId, 'WORKER_REQUEST_SUBMITTED', id, { fromSubject, type: input.type, taskId: input.taskId ?? null }, now);
    });
    return this.get(id);
  }
  decide(input: DecideWorkerRequestInput, now = Date.now()): WorkerRequest {
    const supervisor = required(input.supervisorSubject, 'Supervisor subject');
    const note = input.note.trim();
    return this.database.transaction(() => {
      const current = this.get(input.requestId);
      if (current.status !== 'open') throw new Error(`Worker request ${current.id} is already ${current.status}`);
      if (current.fromSubject === supervisor) throw new Error('Worker cannot decide its own request');
      const status = input.decision === 'accept' ? 'accepted' : 'rejected';
      this.database.db.prepare('UPDATE worker_requests SET status=?,decided_by=?,decision_note=?,updated_at=? WHERE id=?')
        .run(status, supervisor, note || null, now, current.id);
      this.event(current.projectId, 'WORKER_REQUEST_DECIDED', current.id, { supervisor, decision: input.decision, note }, now);
      return this.get(current.id);
    });
  }

  resolve(id: string, supervisorSubject: string, note = '', now = Date.now()): WorkerRequest {
    const supervisor = required(supervisorSubject, 'Supervisor subject');
    return this.database.transaction(() => {
      const current = this.get(id);
      if (current.status !== 'accepted') throw new Error('Only an accepted worker request can be resolved');
      this.database.db.prepare("UPDATE worker_requests SET status='resolved',decided_by=?,decision_note=?,updated_at=? WHERE id=?")
        .run(supervisor, note.trim() || current.decisionNote || null, now, id);
      this.event(current.projectId, 'WORKER_REQUEST_RESOLVED', id, { supervisor, note: note.trim() }, now);
      return this.get(id);
    });
  }
}
