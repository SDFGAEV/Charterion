import { describe, expect, it } from 'vitest';
import { agentConversationUrl, filterFleetTaskTabs, planFleetReconciliation, workerRequestMessage } from '../src/fleet';
import type { ManagedTab } from '../src/contracts';
import type { ControlAgentView, ControlWorkerRequestView } from '../src/nativeControl';

function agent(overrides: Partial<ControlAgentView> = {}): ControlAgentView {
  return {
    id: 'slot-1', projectId: 'p', role: 'ROLE01', status: 'idle',
    desiredState: 'active', browserState: 'absent', browserQuarantined: false, leaseEpoch: 0,
    ...overrides,
  };
}

function tab(tabId: number, conversationKey: string, agentSlotId: string | null = 'slot-1'): ManagedTab {
  return {
    tabId, windowId: 1, active: false,
    binding: { role: 'ROLE01', project: 'P', notes: '', ...(agentSlotId ? { agentSlotId } : {}) },
    snapshot: {
      conversationKey, title: 'ChatGPT', url: 'https://chatgpt.com/', status: 'idle', confidence: 'direct', signals: [],
      assistantMessageCount: 0, latestAssistantText: '', observedAt: 1,
    },
  };
}
describe('agent fleet reconciliation', () => {
  it('opens an active slot and resumes a durable conversation URL', () => {
    expect(agentConversationUrl()).toBe('https://chatgpt.com/');
    expect(agentConversationUrl('conversation:abc/def')).toBe('https://chatgpt.com/c/abc%2Fdef');
    expect(agentConversationUrl('conversation:WEB:temporary')).toBe('https://chatgpt.com/');
    expect(agentConversationUrl('conversation:new')).toBe('https://chatgpt.com/');
    expect(planFleetReconciliation([agent()], [], {})).toEqual([
      { kind: 'open', slotId: 'slot-1', url: 'https://chatgpt.com/' },
    ]);
    expect(planFleetReconciliation([agent({ conversationKey: 'conversation:abc' })], [], {})).toEqual([
      { kind: 'open', slotId: 'slot-1', url: 'https://chatgpt.com/c/abc' },
    ]);
  });

  it('does not trust a stale mapped tab id without AgentSlot identity', () => {
    const unrelated = tab(7, 'url:https://chatgpt.com/', null);
    expect(planFleetReconciliation([agent({ browserState: 'open', browserTabId: 7 })], [unrelated], { 'slot-1': 7 })).toEqual([
      { kind: 'report-absent', slotId: 'slot-1' },
    ]);
  });

  it('holds a fresh opening reservation instead of spawning duplicate tabs', () => {
    const opening = agent({ browserState: 'opening', browserTabId: 7, browserObservedAt: 1_000 });
    expect(planFleetReconciliation([opening], [], { 'slot-1': 7 }, 5_000, 10_000)).toEqual([]);
    expect(planFleetReconciliation([opening], [], { 'slot-1': 7 }, 12_001, 10_000)).toEqual([
      { kind: 'report-absent', slotId: 'slot-1' },
    ]);
  });

  it('recovers a fleet tab from AgentSlot identity even when the runtime map is missing', () => {
    expect(planFleetReconciliation([agent()], [tab(8, 'url:https://chatgpt.com/')], {})).toEqual([
      { kind: 'report-open', slotId: 'slot-1', tabId: 8 },
    ]);
  });

  it('re-adopts an exact leased browser address for reconciliation without making it dispatchable', () => {
    const unbound = tab(11, 'conversation:canonical-new', null);
    const leased = agent({ browserState: 'open', browserTabId: 11, browserLeaseId: 'lease-1', browserLeaseEpoch: 1 });
    expect(planFleetReconciliation([leased], [unbound], { 'slot-1': 11 })).toEqual([
      { kind: 'report-open', slotId: 'slot-1', tabId: 11, conversationKey: 'conversation:canonical-new' },
    ]);
    expect(filterFleetTaskTabs([unbound], [leased], { 'slot-1': 11 })).toEqual([]);
  });

  it('reports a durable conversation once an active tab acquires identity', () => {
    const actions = planFleetReconciliation([agent()], [tab(7, 'conversation:canonical-new')], { 'slot-1': 7 });
    expect(actions).toEqual([{ kind: 'report-open', slotId: 'slot-1', tabId: 7, conversationKey: 'conversation:canonical-new' }]);
  });

  it('gracefully drains a generating worker before closing its page', () => {
    const generating = tab(9, 'conversation:x'); generating.snapshot.status = 'generating';
    const suspended = agent({ desiredState: 'suspended', status: 'suspended', browserState: 'open' });
    expect(planFleetReconciliation([suspended], [generating], { 'slot-1': 9 })).toEqual([]);
  });

  it('dispatches only to a live active AgentSlot binding when the Kernel is available', () => {
    const fleet = tab(9, 'conversation:x'); const manual = tab(10, 'conversation:manual', null);
    expect(filterFleetTaskTabs([fleet, manual], [agent()], { 'slot-1': 9 }).map((item) => item.tabId)).toEqual([9]);
    const suspended = agent({ desiredState: 'suspended', status: 'suspended', conversationKey: 'conversation:x' });
    expect(filterFleetTaskTabs([fleet, manual], [suspended], { 'slot-1': 9 })).toEqual([]);
  });

  it('closes suspended workers and reports already-absent workers idempotently', () => {
    const suspended = agent({ desiredState: 'suspended', status: 'suspended', browserState: 'open' });
    expect(planFleetReconciliation([suspended], [tab(9, 'conversation:x')], { 'slot-1': 9 })).toEqual([
      { kind: 'close', slotId: 'slot-1', tabId: 9 },
    ]);
    expect(planFleetReconciliation([suspended], [], {})).toEqual([{ kind: 'report-absent', slotId: 'slot-1' }]);
    expect(planFleetReconciliation([agent({ desiredState: 'retired', status: 'retired' })], [], {})).toEqual([]);
  });
});

describe('worker request supervisor notification', () => {
  it('maps one kernel request into one deterministic semantic message', () => {
    const request: ControlWorkerRequestView = {
      id: 'request-1', projectId: 'p', fromSubject: 'slot-1', type: 'suggestion',
      title: 'Add capacity', body: 'Parallel work is available.', suggestedAction: 'spawn ROLE02',
      status: 'open', createdAt: 10, updatedAt: 11,
    };
    const message = workerRequestMessage(request, 'Project P', 'ROLE01', 'SUPERVISOR');
    expect(message.id).toBe('control-request:request-1');
    expect(message.target).toEqual({ kind: 'role', role: 'SUPERVISOR' });
    expect(message.type).toBe('announcement');
    expect(message.content).toContain('Request ID');
    expect(message.content).toContain('spawn ROLE02');
  });
});
