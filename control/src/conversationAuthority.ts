import { randomUUID } from 'node:crypto';
import type { ControlDatabase } from './database';
import type {
  AgentConversationRecord, AgentConversationRollover, AgentSlot, WorkerCheckpoint,
} from './contracts';

type Row = Record<string, string | number | null>;

function nonEmpty(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function parseState(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}

function conversationFrom(row: Row): AgentConversationRecord {
  const value: AgentConversationRecord = {
    id: String(row.id), projectId: String(row.project_id), slotId: String(row.slot_id),
    generation: Number(row.generation), conversationKey: String(row.conversation_key),
    status: String(row.status) as AgentConversationRecord['status'], startedAt: Number(row.started_at),
  };
  if (row.predecessor_conversation_key !== null) value.predecessorConversationKey = String(row.predecessor_conversation_key);
  if (row.ended_at !== null) value.endedAt = Number(row.ended_at);
  if (row.close_reason !== null) value.closeReason = String(row.close_reason);
  return value;
}
function checkpointFrom(row: Row): WorkerCheckpoint {
  return {
    id: String(row.id), projectId: String(row.project_id), slotId: String(row.slot_id),
    reason: String(row.reason), handoffText: String(row.handoff_text), state: parseState(String(row.state_json)),
    createdAt: Number(row.created_at),
  };
}

function rolloverFrom(row: Row): AgentConversationRollover {
  const value: AgentConversationRollover = {
    id: String(row.id), projectId: String(row.project_id), slotId: String(row.slot_id),
    fromConversationKey: String(row.from_conversation_key), fromGeneration: Number(row.from_generation),
    toGeneration: Number(row.to_generation), checkpointId: String(row.checkpoint_id),
    status: String(row.status) as AgentConversationRollover['status'], reason: String(row.reason),
    requestedAt: Number(row.requested_at), updatedAt: Number(row.updated_at),
  };
  if (row.to_conversation_key !== null) value.toConversationKey = String(row.to_conversation_key);
  if (row.bootstrap_attempt_id !== null) value.bootstrapAttemptId = String(row.bootstrap_attempt_id);
  if (row.error !== null) value.error = String(row.error);
  if (row.completed_at !== null) value.completedAt = Number(row.completed_at);
  return value;
}

export class ConversationAuthority {
  constructor(private readonly database: ControlDatabase) {}

  private event(projectId: string, type: string, subject: string, payload: Record<string, unknown>, now: number): void {
    this.database.db.prepare('INSERT INTO events(project_id,type,subject,payload_json,created_at) VALUES(?,?,?,?,?)')
      .run(projectId, type, subject, JSON.stringify(payload), now);
  }
  listConversations(slotId?: string): AgentConversationRecord[] {
    const rows = (slotId
      ? this.database.db.prepare('SELECT * FROM agent_conversations WHERE slot_id=? ORDER BY generation').all(slotId)
      : this.database.db.prepare('SELECT * FROM agent_conversations ORDER BY project_id,slot_id,generation').all()) as Row[];
    return rows.map(conversationFrom);
  }

  listCheckpoints(slotId?: string): WorkerCheckpoint[] {
    const rows = (slotId
      ? this.database.db.prepare('SELECT * FROM worker_checkpoints WHERE slot_id=? ORDER BY created_at').all(slotId)
      : this.database.db.prepare('SELECT * FROM worker_checkpoints ORDER BY project_id,slot_id,created_at').all()) as Row[];
    return rows.map(checkpointFrom);
  }

  listRollovers(slotId?: string): AgentConversationRollover[] {
    const rows = (slotId
      ? this.database.db.prepare('SELECT * FROM agent_rollovers WHERE slot_id=? ORDER BY requested_at').all(slotId)
      : this.database.db.prepare('SELECT * FROM agent_rollovers ORDER BY project_id,slot_id,requested_at').all()) as Row[];
    return rows.map(rolloverFrom);
  }

  activeRollover(slotId: string): AgentConversationRollover | undefined {
    const row = this.database.db.prepare("SELECT * FROM agent_rollovers WHERE slot_id=? AND status IN ('requested','opening','bootstrapping') ORDER BY requested_at DESC LIMIT 1").get(slotId) as Row | undefined;
    return row ? rolloverFrom(row) : undefined;
  }

  checkpoint(id: string): WorkerCheckpoint {
    const row = this.database.db.prepare('SELECT * FROM worker_checkpoints WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Worker checkpoint ${id} does not exist`);
    return checkpointFrom(row);
  }
  recordCanonical(slot: AgentSlot, conversationKey: string, now: number): number {
    const existing = this.database.db.prepare('SELECT * FROM agent_conversations WHERE project_id=? AND conversation_key=?').get(slot.projectId, conversationKey) as Row | undefined;
    if (existing) {
      if (String(existing.slot_id) !== slot.id) throw new Error(`Conversation ${conversationKey} belongs to another AgentSlot`);
      return Number(existing.generation);
    }
    const generation = slot.conversationGeneration > 0 ? slot.conversationGeneration : 1;
    const id = randomUUID();
    this.database.db.prepare(`INSERT INTO agent_conversations(id,project_id,slot_id,generation,conversation_key,status,predecessor_conversation_key,started_at,ended_at,close_reason)
      VALUES(?,?,?,?,?,'active',NULL,?,NULL,NULL)`).run(id, slot.projectId, slot.id, generation, conversationKey, now);
    this.event(slot.projectId, 'AGENT_CONVERSATION_RECORDED', slot.id, { conversationKey, generation }, now);
    return generation;
  }

  request(slot: AgentSlot, reason: string, handoffText: string, state: Record<string, unknown>, now = Date.now()): AgentConversationRollover {
    const why = nonEmpty(reason, 'Rollover reason');
    const handoff = nonEmpty(handoffText, 'Rollover handoff');
    if (!slot.conversationKey) throw new Error('Agent slot has no durable conversation to roll over');
    const fromConversationKey = slot.conversationKey;
    if (slot.rolloverState !== 'idle' || slot.activeRolloverId) throw new Error('Agent slot already has an active conversation rollover');
    return this.database.transaction(() => {
      const generation = this.recordCanonical(slot, fromConversationKey, now);
      const checkpointId = randomUUID();
      this.database.db.prepare(`INSERT INTO worker_checkpoints(id,project_id,slot_id,reason,handoff_text,state_json,created_at)
        VALUES(?,?,?,?,?,?,?)`).run(checkpointId, slot.projectId, slot.id, why, handoff, JSON.stringify(state), now);
      const rolloverId = randomUUID();
      this.database.db.prepare(`INSERT INTO agent_rollovers(id,project_id,slot_id,from_conversation_key,to_conversation_key,from_generation,to_generation,checkpoint_id,status,reason,bootstrap_attempt_id,error,requested_at,updated_at,completed_at)
        VALUES(?,?,?,?,NULL,?,?,?,'requested',?,NULL,NULL,?,?,NULL)`)
        .run(rolloverId, slot.projectId, slot.id, fromConversationKey, generation, generation + 1, checkpointId, why, now, now);
      this.database.db.prepare("UPDATE agent_slots SET rollover_state='requested',active_rollover_id=?,updated_at=? WHERE id=?").run(rolloverId, now, slot.id);
      this.event(slot.projectId, 'AGENT_CONVERSATION_ROLLOVER_REQUESTED', slot.id, { rolloverId, fromConversationKey, checkpointId, reason: why }, now);
      return this.activeRollover(slot.id)!;
    });
  }
  begin(slot: AgentSlot, rolloverId: string, now = Date.now()): AgentConversationRollover {
    return this.database.transaction(() => {
      const active = this.activeRollover(slot.id);
      if (!active || active.id !== rolloverId || active.status !== 'requested') throw new Error('Conversation rollover is not request-ready');
      if (slot.activeRolloverId !== rolloverId || slot.rolloverState !== 'requested') throw new Error('AgentSlot rollover projection is stale');
      this.database.db.prepare(`UPDATE agent_conversations SET status='closed',ended_at=?,close_reason=?
        WHERE slot_id=? AND conversation_key=? AND status='active'`).run(now, active.reason, slot.id, active.fromConversationKey);
      this.database.db.prepare("UPDATE agent_rollovers SET status='opening',updated_at=? WHERE id=?").run(now, rolloverId);
      this.database.db.prepare("UPDATE agent_slots SET conversation_key=NULL,status='idle',rollover_state='opening',lease_epoch=lease_epoch+1,updated_at=? WHERE id=?")
        .run(now, slot.id);
      this.event(slot.projectId, 'AGENT_CONVERSATION_ROLLOVER_OPENING', slot.id, { rolloverId, fromConversationKey: active.fromConversationKey, toGeneration: active.toGeneration }, now);
      return this.activeRollover(slot.id)!;
    });
  }

  acceptCanonical(slot: AgentSlot, conversationKey: string, now: number): { generation: number; rollover?: AgentConversationRollover } {
    const active = this.activeRollover(slot.id);
    if (!active) return { generation: this.recordCanonical(slot, conversationKey, now) };
    if (!['opening','bootstrapping'].includes(active.status)) throw new Error('Conversation rollover cannot accept a canonical conversation yet');
    if (active.toConversationKey && active.toConversationKey !== conversationKey) throw new Error('Conversation rollover cannot change its canonical destination');
    const conflict = this.database.db.prepare('SELECT slot_id FROM agent_conversations WHERE project_id=? AND conversation_key=?').get(slot.projectId, conversationKey) as { slot_id?: string } | undefined;
    if (conflict?.slot_id && conflict.slot_id !== slot.id) throw new Error(`Conversation ${conversationKey} belongs to another AgentSlot`);
    this.database.db.prepare(`INSERT OR IGNORE INTO agent_conversations(id,project_id,slot_id,generation,conversation_key,status,predecessor_conversation_key,started_at,ended_at,close_reason)
      VALUES(?,?,?,?,?,'active',?,?,NULL,NULL)`).run(randomUUID(), slot.projectId, slot.id, active.toGeneration, conversationKey, active.fromConversationKey, now);
    this.database.db.prepare('UPDATE agent_rollovers SET to_conversation_key=?,updated_at=? WHERE id=?').run(conversationKey, now, active.id);
    this.event(slot.projectId, 'AGENT_CONVERSATION_CANONICALIZED', slot.id, { rolloverId: active.id, conversationKey, generation: active.toGeneration }, now);
    const rollover = this.activeRollover(slot.id);
    return rollover ? { generation: active.toGeneration, rollover } : { generation: active.toGeneration };
  }
  markBootstrap(slot: AgentSlot, rolloverId: string, attemptId: string, now = Date.now()): AgentConversationRollover {
    const attempt = nonEmpty(attemptId, 'Bootstrap attempt id');
    return this.database.transaction(() => {
      const active = this.activeRollover(slot.id);
      if (!active || active.id !== rolloverId || !['opening','bootstrapping'].includes(active.status)) throw new Error('Conversation rollover is not bootstrap-ready');
      if (active.bootstrapAttemptId && active.bootstrapAttemptId !== attempt) throw new Error('Conversation rollover already has a different bootstrap attempt');
      this.database.db.prepare("UPDATE agent_rollovers SET status='bootstrapping',bootstrap_attempt_id=?,updated_at=? WHERE id=?").run(attempt, now, rolloverId);
      this.database.db.prepare("UPDATE agent_slots SET rollover_state='bootstrapping',updated_at=? WHERE id=?").run(now, slot.id);
      this.event(slot.projectId, 'AGENT_CONVERSATION_BOOTSTRAP_DISPATCHED', slot.id, { rolloverId, attemptId: attempt }, now);
      return this.activeRollover(slot.id)!;
    });
  }

  complete(slot: AgentSlot, attemptId: string, now = Date.now()): AgentConversationRollover {
    const attempt = nonEmpty(attemptId, 'Bootstrap attempt id');
    return this.database.transaction(() => {
      const active = this.activeRollover(slot.id);
      if (!active || active.status !== 'bootstrapping') throw new Error('Agent slot has no bootstrapping conversation rollover');
      if (active.bootstrapAttemptId !== attempt) throw new Error('Bootstrap attempt does not own the active conversation rollover');
      if (!active.toConversationKey) throw new Error('Conversation rollover has not canonicalized a destination yet');
      const operation = this.database.db.prepare('SELECT slot_id,state,outcome FROM browser_operations WHERE id=?').get(attempt) as { slot_id?: string; state?: string; outcome?: string } | undefined;
      if (!operation || operation.slot_id !== slot.id || operation.state !== 'settled' || operation.outcome !== 'reply-observed') {
        throw new Error('Conversation rollover bootstrap requires Kernel-verified reply evidence');
      }
      this.database.db.prepare("UPDATE agent_rollovers SET status='completed',updated_at=?,completed_at=? WHERE id=?").run(now, now, active.id);
      this.database.db.prepare("UPDATE agent_slots SET rollover_state='idle',active_rollover_id=NULL,updated_at=? WHERE id=?").run(now, slot.id);
      this.event(slot.projectId, 'AGENT_CONVERSATION_ROLLOVER_COMPLETED', slot.id, { rolloverId: active.id, fromConversationKey: active.fromConversationKey, toConversationKey: active.toConversationKey, generation: active.toGeneration }, now);
      return this.listRollovers(slot.id).find((item) => item.id === active.id)!;
    });
  }

  fail(slot: AgentSlot, error: string, now = Date.now()): AgentConversationRollover {
    const detail = nonEmpty(error, 'Rollover error');
    return this.database.transaction(() => {
      const active = this.activeRollover(slot.id);
      if (!active) throw new Error('Agent slot has no active conversation rollover');
      this.database.db.prepare("UPDATE agent_rollovers SET status='failed',error=?,updated_at=?,completed_at=? WHERE id=?").run(detail, now, now, active.id);
      this.database.db.prepare("UPDATE agent_slots SET rollover_state='idle',active_rollover_id=NULL,updated_at=? WHERE id=?").run(now, slot.id);
      this.event(slot.projectId, 'AGENT_CONVERSATION_ROLLOVER_FAILED', slot.id, { rolloverId: active.id, error: detail }, now);
      return this.listRollovers(slot.id).find((item) => item.id === active.id)!;
    });
  }
}