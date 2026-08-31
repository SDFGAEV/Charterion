import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';

const cleanups: Array<() => void> = [];
function harness(): ControlPlane {
  const dir = mkdtempSync(join(tmpdir(), 'gam-browser-authority-'));
  const database = new ControlDatabase(join(dir, 'global.db'));
  cleanups.push(() => { database.close(); rmSync(dir, { recursive: true, force: true }); });
  return new ControlPlane(database);
}
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

function setup() {
  const plane = harness();
  const project = plane.createProject({ name: 'P', rootPath: 'E:/p', minSlots: 0, maxSlots: 3 }, 1);
  const a = plane.createAgentSlot(project.id, 'ROLE01', 2);
  const b = plane.createAgentSlot(project.id, 'ROLE02', 3);
  return { plane, project, a, b };
}
describe('browser authority', () => {
  it('binds one physical tab to one exclusive AgentSlot lease', () => {
    const { plane, a, b } = setup();
    const opened = plane.reportAgentBrowser({ slotId: a.id, profileId: 'gam-default', browserState: 'opening', tabId: 7 }, 10);
    expect(opened.browserLeaseId).toBeTruthy();
    expect(opened.browserLeaseEpoch).toBe(1);
    expect(() => plane.reportAgentBrowser({ slotId: b.id, profileId: 'gam-default', browserState: 'opening', tabId: 7 }, 11)).toThrow(/already leased/i);
    expect(plane.reportAgentBrowser({ slotId: a.id, profileId: 'gam-default', browserState: 'absent' }, 12).browserLeaseId).toBeUndefined();
    expect(plane.reportAgentBrowser({ slotId: b.id, profileId: 'gam-default', browserState: 'opening', tabId: 7 }, 13).browserLeaseEpoch).toBe(2);
  });

  it('quarantines a new content generation when the old runtime had an unsettled effect', () => {
    const { plane, a, project } = setup();
    plane.reportAgentBrowser({ slotId: a.id, profileId: 'gam-default', browserState: 'open', tabId: 7 }, 10);
    plane.reportAgentRuntime({ slotId: a.id, profileId: 'gam-default', tabId: 7, contentEpoch: 'epoch-a', revision: 1, pageStatus: 'idle', semanticSignature: 's1', observedAt: 11 });
    plane.browser.planOperation({ id: 'op-1', idempotencyKey: 'prompt:op-1', operation: 'prompt.send', projectId: project.id, slotId: a.id, tabId: 7, contentEpoch: 'epoch-a', conversationKey: 'url:https://chatgpt.com/', preconditionsHash: 's1' }, 12);
    plane.browser.dispatchOperation('op-1', 13);
    const changed = plane.reportAgentRuntime({ slotId: a.id, profileId: 'gam-default', tabId: 7, contentEpoch: 'epoch-b', revision: 1, pageStatus: 'idle', semanticSignature: 's2', observedAt: 14 });
    expect(changed.browserQuarantined).toBe(true);
    expect(plane.browser.getOperation('op-1')).toMatchObject({ state: 'settled', outcome: 'uncertain' });
    const recovered = plane.reportAgentRuntime({ slotId: a.id, profileId: 'gam-default', tabId: 7, contentEpoch: 'epoch-b', revision: 2, pageStatus: 'idle', semanticSignature: 's3', observedAt: 15 });
    expect(recovered.browserQuarantined).toBe(false);
  });

  it('keeps browser operation identity idempotent and permits reply evidence to refine uncertainty', () => {
    const { plane, a, project } = setup();
    plane.reportAgentBrowser({ slotId: a.id, profileId: 'gam-default', browserState: 'open', tabId: 7 }, 10);
    plane.reportAgentRuntime({ slotId: a.id, profileId: 'gam-default', tabId: 7, contentEpoch: 'epoch-a', revision: 1, pageStatus: 'idle', semanticSignature: 's1', observedAt: 11 });
    const input = { id: 'op-2', idempotencyKey: 'prompt:op-2', operation: 'prompt.send', projectId: project.id, slotId: a.id, tabId: 7, contentEpoch: 'epoch-a', preconditionsHash: 's1' };
    expect(plane.browser.planOperation(input, 12).id).toBe('op-2');
    expect(plane.browser.planOperation(input, 12).id).toBe('op-2');
    plane.browser.dispatchOperation('op-2', 13);
    expect(plane.browser.settleOperation('op-2', 'uncertain', { reason: 'transport-lost' }, 14).outcome).toBe('uncertain');
    expect(plane.browser.settleOperation('op-2', 'reply-observed', { messageId: 'assistant-1' }, 15).outcome).toBe('reply-observed');
  });
});
