import { createHash } from 'node:crypto';
import type { ControlDatabase } from './database';

type WorkDocument = Record<string, unknown>;
type WorkKind = 'task' | 'attempt' | 'message';

const ID_FIELD: Record<WorkKind, 'id' | 'attemptId'> = { task: 'id', attempt: 'attemptId', message: 'id' };

function workId(item: WorkDocument, kind: WorkKind): string {
  const field = ID_FIELD[kind];
  const value = item[field];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${kind}.${field} is required`);
  return value;
}

export interface KernelWorkSnapshot {
  revision: number;
  tasks: WorkDocument[];
  attempts: WorkDocument[];
  messages: WorkDocument[];
}

export interface ReplaceKernelWorkInput {
  expectedRevision: number;
  transportGeneration: string;
  transportSequence: number;
  transportMessageId: string;
  tasks: WorkDocument[];
  attempts: WorkDocument[];
  messages: WorkDocument[];
}

function document(value: unknown, label: string): WorkDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const copy = JSON.parse(JSON.stringify(value)) as WorkDocument;
  return copy;
}

function stringIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0)) {
    throw new Error(`${label} must be a string array`);
  }
  return value as string[];
}

function uniqueDocuments(values: unknown[], kind: WorkKind): WorkDocument[] {
  const result = values.map((value, index) => document(value, `${kind}s[${index}]`));
  const seen = new Set<string>();
  for (const item of result) {
    const id = workId(item, kind);
    if (seen.has(id)) throw new Error(`Duplicate ${kind} id ${id}`);
    seen.add(id);
  }
  return result;
}

function validateState(input: ReplaceKernelWorkInput): ReplaceKernelWorkInput {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error('expectedRevision is invalid');
  if (!input.transportGeneration.trim() || !input.transportMessageId.trim()) throw new Error('Work transport identity is required');
  if (!Number.isInteger(input.transportSequence) || input.transportSequence !== input.expectedRevision + 1) throw new Error('Work transport sequence must equal expectedRevision + 1');
  const tasks = uniqueDocuments(input.tasks, 'task');
  const attempts = uniqueDocuments(input.attempts, 'attempt');
  const messages = uniqueDocuments(input.messages, 'message');
  const taskIds = new Set(tasks.map((item) => workId(item, 'task')));
  const attemptIds = new Set(attempts.map((item) => workId(item, 'attempt')));
  const messageIds = new Set(messages.map((item) => workId(item, 'message')));

  for (const attempt of attempts) {
    const taskId = typeof attempt.taskId === 'string' ? attempt.taskId : undefined;
    const messageId = typeof attempt.messageId === 'string' ? attempt.messageId : undefined;
    if (taskId && messageId) throw new Error(`Attempt ${workId(attempt, 'attempt')} cannot belong to both task and message`);
    if (taskId && !taskIds.has(taskId)) throw new Error(`Attempt ${workId(attempt, 'attempt')} references missing task ${taskId}`);
    if (messageId && !messageIds.has(messageId)) throw new Error(`Attempt ${workId(attempt, 'attempt')} references missing message ${messageId}`);
  }

  for (const task of tasks) {
    for (const attemptId of stringIds(task.attemptIds ?? [], `task ${task.id}.attemptIds`)) {
      if (!attemptIds.has(attemptId)) throw new Error(`Task ${workId(task, 'task')} references missing attempt ${attemptId}`);
      const attempt = attempts.find((item) => workId(item, 'attempt') === attemptId)!;
      if (attempt.taskId !== workId(task, 'task')) throw new Error(`Task ${workId(task, 'task')} does not own attempt ${attemptId}`);
    }
  }
  for (const message of messages) {
    for (const attemptId of stringIds(message.attemptIds ?? [], `message ${message.id}.attemptIds`)) {
      if (!attemptIds.has(attemptId)) throw new Error(`Message ${workId(message, 'message')} references missing attempt ${attemptId}`);
      const attempt = attempts.find((item) => workId(item, 'attempt') === attemptId)!;
      if (attempt.messageId !== workId(message, 'message')) throw new Error(`Message ${workId(message, 'message')} does not own attempt ${attemptId}`);
    }
  }
  return { expectedRevision: input.expectedRevision, transportGeneration: input.transportGeneration, transportSequence: input.transportSequence, transportMessageId: input.transportMessageId, tasks, attempts, messages };
}

function rows(database: ControlDatabase, table: string): WorkDocument[] {
  return (database.db.prepare(`SELECT document_json FROM ${table} ORDER BY position`).all() as { document_json: string }[])
    .map((row) => JSON.parse(row.document_json) as WorkDocument);
}

export class WorkAuthority {
  constructor(private readonly database: ControlDatabase) {}

  snapshot(): KernelWorkSnapshot {
    const row = this.database.db.prepare('SELECT revision FROM manager_work_meta WHERE singleton=1').get() as { revision: number };
    return {
      revision: Number(row.revision),
      tasks: rows(this.database, 'manager_tasks'),
      attempts: rows(this.database, 'manager_attempts'),
      messages: rows(this.database, 'manager_messages'),
    };
  }

  replace(input: ReplaceKernelWorkInput, now = Date.now()): KernelWorkSnapshot {
    const state = validateState(input);
    return this.database.transaction(() => {
      const payloadHash = createHash('sha256').update(JSON.stringify({ expectedRevision: state.expectedRevision, tasks: state.tasks, attempts: state.attempts, messages: state.messages })).digest('hex');
      const receipt = this.database.db.prepare('SELECT * FROM manager_work_mutations WHERE message_id=?').get(state.transportMessageId) as { generation: string; sequence: number; payload_hash: string; result_revision: number } | undefined;
      if (receipt) {
        if (receipt.generation !== state.transportGeneration || Number(receipt.sequence) !== state.transportSequence || receipt.payload_hash !== payloadHash) throw new Error('Work transport message identity conflict');
        return this.snapshot();
      }
      const sequenceConflict = this.database.db.prepare('SELECT message_id FROM manager_work_mutations WHERE generation=? AND sequence=?').get(state.transportGeneration, state.transportSequence) as { message_id?: string } | undefined;
      if (sequenceConflict?.message_id) throw new Error('Work transport sequence is already occupied by another message');
      const current = this.snapshot();
      if (current.revision !== state.expectedRevision) {
        throw new Error(`Work state revision conflict: expected ${state.expectedRevision}, current ${current.revision}`);
      }
      this.database.db.exec('DELETE FROM manager_tasks; DELETE FROM manager_attempts; DELETE FROM manager_messages;');
      const insert = (table: string, kind: WorkKind, documents: WorkDocument[]) => {
        const statement = this.database.db.prepare(`INSERT INTO ${table}(id,position,document_json,updated_at) VALUES(?,?,?,?)`);
        documents.forEach((item, index) => statement.run(workId(item, kind), index, JSON.stringify(item), now));
      };
      insert('manager_tasks', 'task', state.tasks);
      insert('manager_attempts', 'attempt', state.attempts);
      insert('manager_messages', 'message', state.messages);
      const revision = current.revision + 1;
      this.database.db.prepare('UPDATE manager_work_meta SET revision=?,updated_at=? WHERE singleton=1').run(revision, now);
      this.database.db.prepare('INSERT INTO manager_work_mutations(message_id,generation,sequence,payload_hash,result_revision,created_at) VALUES(?,?,?,?,?,?)')
        .run(state.transportMessageId, state.transportGeneration, state.transportSequence, payloadHash, revision, now);
      this.database.db.prepare(`INSERT INTO events(project_id,type,subject,payload_json,created_at) VALUES(NULL,'WORK_STATE_REPLACED','browser-manager',?,?)`)
        .run(JSON.stringify({ revision, tasks: state.tasks.length, attempts: state.attempts.length, messages: state.messages.length }), now);
      return this.snapshot();
    });
  }
}
