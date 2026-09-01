import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';

const cleanups: Array<() => void> = [];
function harness(): ControlPlane {
  const dir = mkdtempSync(join(tmpdir(), 'charterion-continuity-'));
  const database = new ControlDatabase(join(dir, 'global.db'));
  cleanups.push(() => { database.close(); rmSync(dir, { recursive: true, force: true }); });
  return new ControlPlane(database);
}
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

function configureWorkspace(plane: ControlPlane, agentId: string, now: number) {
  const workspace = plane.organization.activeAgentWorkspace(agentId)!;
  return plane.organization.configureAgentWorkspace({
    workspaceId: workspace.id,
    rootRef: `E:/agents/${agentId}`,
    browserProfileId: `browser-${agentId}`,
    toolProfileRef: `tools-${agentId}`,
    allowedRefs: ['E:/repo'],
    forbiddenRefs: ['E:/kernel'],
  }, now);
}
describe('persistent Organization Agent conversation continuity', () => {
  it('moves one canonical conversation across runtime slots without changing Agent identity', () => {
    const plane = harness();
    const project = plane.createProject({ name: 'Repo', rootPath: 'E:/repo', maxSlots: 2 }, 1);
    const first = plane.createAgentSlot(project.id, 'ENGINEER_A', 2);
    const second = plane.createAgentSlot(project.id, 'ENGINEER_B', 3);
    const org = plane.organization.createOrganization({ name: 'Company' }, 4);
    const agent = plane.organization.registerAgent({ organizationId: org.id, displayName: 'Engineer' }, 5);
    configureWorkspace(plane, agent.id, 6);

    plane.organization.bindRuntimeSlot(agent.id, first.id, 7);
    plane.bindAgentConversation(first.id, 'conversation:durable-a', 8);
    expect(plane.agentContinuity.active(agent.id)).toMatchObject({
      agentId: agent.id, generation: 1, conversationKey: 'conversation:durable-a', runtimeSlotId: first.id,
    });

    plane.organization.unbindRuntimeSlot(agent.id, 9);
    plane.organization.bindRuntimeSlot(agent.id, second.id, 10);
    const moved = plane.bindAgentConversation(second.id, 'conversation:durable-a', 11);
    expect(moved).toMatchObject({ conversationKey: 'conversation:durable-a', conversationGeneration: 1 });
    expect(plane.getAgentSlot(first.id).conversationKey).toBeUndefined();
    expect(plane.agentContinuity.active(agent.id)).toMatchObject({ runtimeSlotId: second.id, generation: 1 });
  });
  it('advances persistent generation only after verified rollover bootstrap', () => {
    const plane = harness();
    const project = plane.createProject({ name: 'Repo', rootPath: 'E:/repo' }, 1);
    const slot = plane.createAgentSlot(project.id, 'ENGINEER', 2);
    const org = plane.organization.createOrganization({ name: 'Company' }, 3);
    const agent = plane.organization.registerAgent({ organizationId: org.id, displayName: 'Engineer' }, 4);
    configureWorkspace(plane, agent.id, 5);
    plane.organization.bindRuntimeSlot(agent.id, slot.id, 6);
    plane.bindAgentConversation(slot.id, 'conversation:a', 7);

    const rollover = plane.requestAgentConversationRollover(slot.id, 'limit', 'continue same mission', {}, 8);
    plane.beginAgentConversationRollover(slot.id, rollover.id, 9);
    plane.reportAgentBrowser({ slotId: slot.id, profileId: `browser-${agent.id}`, browserState: 'opening', tabId: 10 }, 10);
    plane.reportAgentBrowser({ slotId: slot.id, profileId: `browser-${agent.id}`, browserState: 'open', tabId: 10, conversationKey: 'conversation:b' }, 11);
    expect(plane.agentContinuity.active(agent.id)).toMatchObject({ generation: 1, conversationKey: 'conversation:a' });

    plane.browser.planOperation({ id: 'bootstrap', idempotencyKey: 'bootstrap', operation: 'prompt.send', slotId: slot.id, preconditionsHash: 'hash' }, 12);
    plane.browser.dispatchOperation('bootstrap', 13);
    plane.markAgentRolloverBootstrap(slot.id, rollover.id, 'bootstrap', 14);
    expect(() => plane.completeAgentConversationRollover(slot.id, 'bootstrap', 15)).toThrow(/verified reply evidence/i);
    expect(plane.agentContinuity.active(agent.id)).toMatchObject({ generation: 1, conversationKey: 'conversation:a' });
    plane.browser.settleOperation('bootstrap', 'reply-observed', { assistantMessageId: 'm1' }, 16);
    plane.completeAgentConversationRollover(slot.id, 'bootstrap', 17);
    expect(plane.agentContinuity.active(agent.id)).toMatchObject({
      generation: 2,
      conversationKey: 'conversation:b',
      predecessorConversationKey: 'conversation:a',
      runtimeSlotId: slot.id,
    });
    expect(plane.agentContinuity.list(agent.id)).toMatchObject([
      { generation: 1, conversationKey: 'conversation:a', status: 'closed' },
      { generation: 2, conversationKey: 'conversation:b', status: 'active' },
    ]);
  });
});
