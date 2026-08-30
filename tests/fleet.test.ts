import { describe, expect, it } from 'vitest';
import { agentConversationUrl, filterFleetTaskTabs, planFleetReconciliation, workerRequestMessage } from '../src/fleet';
import type { ManagedTab } from '../src/contracts';
import type { ControlAgentView, ControlWorkerRequestView } from '../src/nativeControl';

function agent(overrides: Partial<ControlAgentView> = {}): ControlAgentView {
  return {
    id: 'slot-1', projectId: 'p', role: 'ROLE01', status: 'idle',
    desiredState: 'active', browserState: 'absent', leaseEpoch: 0,
    ...overrides,
  };
}

function tab(tabId: number, conversationKey: string): ManagedTab {
  return {
    tabId, windowId: 1, active: false,
    binding: { role: 'ROLE01', project: 'P', notes: '' },
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
    expect(planFleetReconciliation([agent()], [], {})).toEqual([
      { kind: 'open', slotId: 'slot-1', url: 'https://chatgpt.com/' },
    ]);
    expect(planFleetReconciliation([agent({ conversationKey: 'conversation:abc' })], [], {})).toEqual([
      { kind: 'open', slotId: 'slot-1', url: 'https://chatgpt.com/c/abc' },
    ]);
  });

  it('reports a durable conversation once an active tab acquires identity', () => {
    const actions = planFleetReconciliation([agent()], [tab(7, 'conversation:new')], { 'slot-1': 7 });
    expect(actions).toEqual([{ kind: 'report-open', slotId: 'slot-1', tabId: 7, conversationKey: 'conversation:new' }]);
  });

  it('gracefully drains a generating worker before closing its page', () => {
    const generating = tab(9, 'conversation:x'); generating.snapshot.status = 'generating';
    const suspended = agent({ desiredState: 'suspended', status: 'suspended', browserState: 'open' });
    expect(planFleetReconciliation([suspended], [generating], { 'slot-1': 9 })).toEqual([]);
  });

  it('removes non-active fleet tabs from task dispatch without hiding manual tabs', () => {
    const fleet = tab(9, 'conversation:x'); const manual = tab(10, 'conversation:manual');
    const suspended = agent({ desiredState: 'suspended', status: 'suspended', conversationKey: 'conversation:x' });
    expect(filterFleetTaskTabs([fleet, manual], [suspended], { 'slot-1': 9 }).map((item) => item.tabId)).toEqual([10]);
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
