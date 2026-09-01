import { randomUUID } from 'node:crypto';
import type { ControlDatabase } from './database';
import type {
  BindOrganizationAgentConversationInput,
  OrganizationAgentConversationRecord,
  RolloverOrganizationAgentConversationInput,
} from './agentContinuityContracts';

type Row = Record<string, string | number | null>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function canonicalConversationKey(value: string): string {
  const key = required(value, 'Conversation key');
  if (!key.startsWith('conversation:')) throw new Error('Only canonical ChatGPT conversation identities may bind an Organization Agent');
  const suffix = key.slice('conversation:'.length);
  if (!suffix || suffix === 'new' || /^WEB:/i.test(suffix)) throw new Error('Conversation key must be durable and canonical');
  return key;
}
function conversationFrom(row: Row): OrganizationAgentConversationRecord {
  const value: OrganizationAgentConversationRecord = {
    id: String(row.id),
    organizationId: String(row.organization_id),
    agentId: String(row.agent_id),
    generation: Number(row.generation),
    conversationKey: String(row.conversation_key),
    status: String(row.status) as OrganizationAgentConversationRecord['status'],
    startedAt: Number(row.started_at),
  };
  if (row.predecessor_conversation_key !== null) value.predecessorConversationKey = String(row.predecessor_conversation_key);
  if (row.runtime_slot_id !== null) value.runtimeSlotId = String(row.runtime_slot_id);
  if (row.ended_at !== null) value.endedAt = Number(row.ended_at);
  if (row.close_reason !== null) value.closeReason = String(row.close_reason);
  return value;
}

export class AgentContinuityAuthority {
  constructor(private readonly database: ControlDatabase) {}

  private event(type: string, subject: string, payload: Record<string, unknown>, now: number): void {
    this.database.db.prepare('INSERT INTO events(project_id,type,subject,payload_json,created_at) VALUES(NULL,?,?,?,?)')
      .run(type, subject, JSON.stringify(payload), now);
  }
  list(agentId?: string): OrganizationAgentConversationRecord[] {
    const rows = agentId
      ? this.database.db.prepare('SELECT * FROM organization_agent_conversations WHERE agent_id=? ORDER BY generation').all(agentId)
      : this.database.db.prepare('SELECT * FROM organization_agent_conversations ORDER BY organization_id,agent_id,generation').all();
    return (rows as Row[]).map(conversationFrom);
  }

  active(agentId: string): OrganizationAgentConversationRecord | undefined {
    const row = this.database.db.prepare("SELECT * FROM organization_agent_conversations WHERE agent_id=? AND status='active' ORDER BY generation DESC LIMIT 1").get(agentId) as Row | undefined;
    return row ? conversationFrom(row) : undefined;
  }

  byKey(conversationKey: string): OrganizationAgentConversationRecord | undefined {
    const key = canonicalConversationKey(conversationKey);
    const row = this.database.db.prepare('SELECT * FROM organization_agent_conversations WHERE conversation_key=?').get(key) as Row | undefined;
    return row ? conversationFrom(row) : undefined;
  }

  private agent(agentId: string): { id: string; organization_id: string; status: string; runtime_slot_id: string | null } {
    const row = this.database.db.prepare('SELECT id,organization_id,status,runtime_slot_id FROM organization_agents WHERE id=?').get(agentId) as { id?: string; organization_id?: string; status?: string; runtime_slot_id?: string | null } | undefined;
    if (!row?.id || !row.organization_id || !row.status) throw new Error(`Organization Agent ${agentId} does not exist`);
    return { id: row.id, organization_id: row.organization_id, status: row.status, runtime_slot_id: row.runtime_slot_id ?? null };
  }
  bind(input: BindOrganizationAgentConversationInput, now = Date.now()): OrganizationAgentConversationRecord {
    const agent = this.agent(input.agentId);
    if (agent.status === 'retired') throw new Error('Retired Organization Agent cannot bind a conversation');
    const key = canonicalConversationKey(input.conversationKey);
    const existingKey = this.byKey(key);
    if (existingKey && existingKey.agentId !== agent.id) throw new Error(`Conversation ${key} belongs to another Organization Agent`);
    const active = this.active(agent.id);
    if (active) {
      if (active.conversationKey !== key) throw new Error('Replacing an Organization Agent conversation requires rollover');
      if (input.runtimeSlotId && active.runtimeSlotId !== input.runtimeSlotId) this.attachRuntimeSlot(agent.id, input.runtimeSlotId, now);
      return this.active(agent.id)!;
    }
    if (existingKey) throw new Error('A closed Organization Agent conversation cannot be reactivated');
    const generationRow = this.database.db.prepare('SELECT COALESCE(MAX(generation),0) AS generation FROM organization_agent_conversations WHERE agent_id=?').get(agent.id) as { generation: number };
    const previousGeneration = Number(generationRow.generation);
    const generation = input.generationHint !== undefined && Number.isInteger(input.generationHint) && input.generationHint > previousGeneration
      ? input.generationHint
      : previousGeneration + 1;
    const id = randomUUID();
    this.database.db.prepare(`INSERT INTO organization_agent_conversations(
      id,organization_id,agent_id,generation,conversation_key,status,predecessor_conversation_key,runtime_slot_id,started_at,ended_at,close_reason
    ) VALUES(?,?,?,?,?,'active',NULL,?,?,NULL,NULL)`).run(id, agent.organization_id, agent.id, generation, key, input.runtimeSlotId ?? null, now);
    this.event('ORGANIZATION_AGENT_CONVERSATION_BOUND', agent.id, { conversationKey: key, generation, runtimeSlotId: input.runtimeSlotId ?? null }, now);
    return this.active(agent.id)!;
  }
  attachRuntimeSlot(agentId: string, slotId: string, now = Date.now()): OrganizationAgentConversationRecord | undefined {
    const agent = this.agent(agentId);
    const slot = required(slotId, 'Runtime slot id');
    if (agent.runtime_slot_id !== slot) throw new Error('Runtime slot is not currently bound to this Organization Agent');
    const active = this.active(agent.id);
    if (!active) return undefined;
    const conflict = this.database.db.prepare("SELECT agent_id FROM organization_agent_conversations WHERE runtime_slot_id=? AND status='active' AND agent_id<>?").get(slot, agent.id) as { agent_id?: string } | undefined;
    if (conflict?.agent_id) throw new Error(`Runtime slot ${slot} projects another Organization Agent conversation`);
    this.database.db.prepare("UPDATE organization_agent_conversations SET runtime_slot_id=? WHERE agent_id=? AND status='active'").run(slot, agent.id);
    this.event('ORGANIZATION_AGENT_CONVERSATION_RUNTIME_ATTACHED', agent.id, { conversationKey: active.conversationKey, runtimeSlotId: slot }, now);
    return this.active(agent.id);
  }

  detachRuntimeSlot(agentId: string, slotId: string, now = Date.now()): OrganizationAgentConversationRecord | undefined {
    const active = this.active(agentId);
    if (!active || active.runtimeSlotId !== slotId) return active;
    this.database.db.prepare("UPDATE organization_agent_conversations SET runtime_slot_id=NULL WHERE agent_id=? AND status='active'").run(agentId);
    this.event('ORGANIZATION_AGENT_CONVERSATION_RUNTIME_DETACHED', agentId, { conversationKey: active.conversationKey, runtimeSlotId: slotId }, now);
    return this.active(agentId);
  }
  rollover(input: RolloverOrganizationAgentConversationInput, now = Date.now()): OrganizationAgentConversationRecord {
    const agent = this.agent(input.agentId);
    const fromKey = canonicalConversationKey(input.fromConversationKey);
    const toKey = canonicalConversationKey(input.toConversationKey);
    if (fromKey === toKey) throw new Error('Conversation rollover destination must differ from source');
    if (agent.runtime_slot_id !== input.runtimeSlotId) throw new Error('Conversation rollover runtime slot is not bound to this Organization Agent');
    const active = this.active(agent.id);
    if (!active || active.conversationKey !== fromKey) throw new Error('Organization Agent rollover source is not the active conversation');
    const existingDestination = this.byKey(toKey);
    if (existingDestination) {
      if (existingDestination.agentId !== agent.id || existingDestination.status !== 'active' || existingDestination.predecessorConversationKey !== fromKey) {
        throw new Error(`Conversation ${toKey} is already owned incompatibly`);
      }
      return existingDestination;
    }
    const reason = required(input.reason, 'Conversation rollover reason');
    const generation = active.generation + 1;
    this.database.db.prepare("UPDATE organization_agent_conversations SET status='closed',runtime_slot_id=NULL,ended_at=?,close_reason=? WHERE id=?")
      .run(now, reason, active.id);
    this.database.db.prepare(`INSERT INTO organization_agent_conversations(
      id,organization_id,agent_id,generation,conversation_key,status,predecessor_conversation_key,runtime_slot_id,started_at,ended_at,close_reason
    ) VALUES(?,?,?,?,?,'active',?,?,?,NULL,NULL)`).run(randomUUID(), agent.organization_id, agent.id, generation, toKey, fromKey, input.runtimeSlotId, now);
    this.event('ORGANIZATION_AGENT_CONVERSATION_ROLLED_OVER', agent.id, { fromConversationKey: fromKey, toConversationKey: toKey, generation, runtimeSlotId: input.runtimeSlotId, reason }, now);
    return this.active(agent.id)!;
  }
}
