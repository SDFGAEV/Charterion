import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';
import { RpcRouter } from '../src/rpc';

const cleanups: Array<() => void> = [];
function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'gam-fleet-rpc-'));
  const db = new ControlDatabase(join(dir, 'state.db'));
  const plane = new ControlPlane(db);
  const router = new RpcRouter(plane, 'admin', 'browser');
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { plane, router };
}
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

describe('Supervisor fleet authority', () => {
  it('lets Supervisor manage desired worker lifecycle while Browser only reports observation', () => {
    const h = harness();
    const project = h.plane.createProject({ name: 'P', rootPath: 'E:/p', maxSlots: 2 });
    const supervisor = h.plane.issueCapability({ subject: 'supervisor', projectId: project.id, scopes: ['agent:fleet','agent:read'], ttlMs: 60_000 });
    const worker = h.plane.issueCapability({ subject: 'worker', projectId: project.id, scopes: ['agent:read'], ttlMs: 60_000 });
    const denied = h.router.handle({ id: 'w', method: 'agent.spawn', auth: { capabilityToken: worker.token }, params: { projectId: project.id, role: 'ROLE01' } });
    expect(denied.ok).toBe(false);

    const spawned = h.router.handle({ id: 's', method: 'agent.spawn', auth: { capabilityToken: supervisor.token }, params: { projectId: project.id, role: 'ROLE01' } });
    expect(spawned.ok).toBe(true);
    if (!spawned.ok) return;
    const slot = spawned.result as { id: string };

    const browserOpen = h.router.handle({ id: 'b', method: 'agent.browser-report', auth: { browserToken: 'browser' }, params: {
      slotId: slot.id, profileId: 'gam-default', browserState: 'open', tabId: 33, conversationKey: 'conversation:worker-1', observedAt: Date.now(),
    } });
    expect(browserOpen).toMatchObject({ ok: true, result: { desiredState: 'active', browserState: 'open', conversationKey: 'conversation:worker-1' } });

    const browserCannotSpawn = h.router.handle({ id: 'b2', method: 'agent.spawn', auth: { browserToken: 'browser' }, params: { projectId: project.id, role: 'ROLE02' } });
    expect(browserCannotSpawn.ok).toBe(false);

    const suspended = h.router.handle({ id: 'x', method: 'agent.suspend', auth: { capabilityToken: supervisor.token }, params: { slotId: slot.id } });
    expect(suspended).toMatchObject({ ok: true, result: { desiredState: 'suspended' } });
    const resumed = h.router.handle({ id: 'r', method: 'agent.resume', auth: { capabilityToken: supervisor.token }, params: { slotId: slot.id } });
    expect(resumed).toMatchObject({ ok: true, result: { desiredState: 'active' } });
    const retiring = h.router.handle({ id: 'z', method: 'agent.retire', auth: { capabilityToken: supervisor.token }, params: { slotId: slot.id } });
    expect(retiring).toMatchObject({ ok: true, result: { desiredState: 'retired', status: 'assigned', browserState: 'open' } });
    const retired = h.router.handle({ id: 'z2', method: 'agent.browser-report', auth: { browserToken: 'browser' }, params: {
      slotId: slot.id, profileId: 'gam-default', browserState: 'absent', observedAt: Date.now(),
    } });
    expect(retired).toMatchObject({ ok: true, result: { desiredState: 'retired', status: 'retired', browserState: 'absent' } });
  });

  it('enforces maxSlots and rejects Browser desired-state mutation or reopening suspended workers', () => {
    const h = harness(); const project = h.plane.createProject({ name: 'P2', rootPath: 'E:/p2', maxSlots: 1 });
    const supervisor = h.plane.issueCapability({ subject: 'supervisor', projectId: project.id, scopes: ['agent:fleet'], ttlMs: 60_000 });
    const auth = { capabilityToken: supervisor.token };
    const first = h.router.handle({ id: 'a', method: 'agent.spawn', auth, params: { projectId: project.id, role: 'ROLE01' } });
    expect(first.ok).toBe(true); if (!first.ok) return; const slot = first.result as { id: string };
    expect(h.router.handle({ id: 'b', method: 'agent.spawn', auth, params: { projectId: project.id, role: 'ROLE02' } }).ok).toBe(false);
    expect(h.router.handle({ id: 's', method: 'agent.suspend', auth, params: { slotId: slot.id } }).ok).toBe(true);
    const browserReopen = h.router.handle({ id: 'bo', method: 'agent.browser-report', auth: { browserToken: 'browser' }, params: { slotId: slot.id, profileId: 'gam-default', browserState: 'open', tabId: 44, observedAt: Date.now() } });
    expect(browserReopen.ok).toBe(false);
    const browserResume = h.router.handle({ id: 'br', method: 'agent.resume', auth: { browserToken: 'browser' }, params: { slotId: slot.id } });
    expect(browserResume.ok).toBe(false);
    expect(h.router.handle({ id: 'c', method: 'agent.spawn', auth, params: { projectId: project.id, role: 'ROLE02' } }).ok).toBe(true);
    expect(h.router.handle({ id: 'r', method: 'agent.resume', auth, params: { slotId: slot.id } }).ok).toBe(false);
  });
});


describe('Elastic fleet reconciliation authority', () => {
  it('lets only Browser trigger Kernel decisions and blocks cleanup while a browser effect is unsettled', () => {
    const h = harness();
    const project = h.plane.createProject({ name: 'Elastic', rootPath: 'E:/elastic', minSlots: 0, maxSlots: 2 });
    const supervisor = h.plane.issueCapability({ subject: 'supervisor', projectId: project.id, scopes: ['agent:fleet'], ttlMs: 60_000 });
    const spawned = h.router.handle({ id: 'spawn', method: 'agent.spawn', auth: { capabilityToken: supervisor.token }, params: { projectId: project.id, role: 'WORKER' } });
    expect(spawned.ok).toBe(true); if (!spawned.ok) return;
    const slot = spawned.result as { id: string };
    const observedAt = Date.now() - 300_000;
    expect(h.router.handle({ id: 'open', method: 'agent.browser-report', auth: { browserToken: 'browser' }, params: { slotId: slot.id, profileId: 'gam-default', browserState: 'open', tabId: 77, observedAt } }).ok).toBe(true);
    expect(h.router.handle({ id: 'runtime', method: 'agent.runtime-report', auth: { browserToken: 'browser' }, params: { slotId: slot.id, profileId: 'gam-default', tabId: 77, contentEpoch: 'epoch-1', revision: 1, pageStatus: 'idle', semanticSignature: 'idle', observedAt: observedAt + 1 } }).ok).toBe(true);

    h.plane.browser.planOperation({ id: 'op1', idempotencyKey: 'op1', operation: 'prompt.send', projectId: project.id, slotId: slot.id, tabId: 77, contentEpoch: 'epoch-1', preconditionsHash: 'abc', plannedAt: observedAt + 2 });
    const held = h.router.handle({ id: 'held', method: 'fleet.reconcile', auth: { browserToken: 'browser' }, params: {} });
    expect(held).toMatchObject({ ok: true, result: [] });
    expect(h.plane.getAgentSlot(slot.id).desiredState).toBe('active');

    h.plane.browser.settleOperation('op1', 'failed', { reason: 'test' }, Date.now());
    const cleaned = h.router.handle({ id: 'clean', method: 'fleet.reconcile', auth: { browserToken: 'browser' }, params: {} });
    expect(cleaned).toMatchObject({ ok: true, result: [{ kind: 'suspend', slotId: slot.id }] });
    expect(h.plane.getAgentSlot(slot.id).desiredState).toBe('suspended');
  });

  it('rejects unauthenticated and capability callers for the browser-only reconcile trigger', () => {
    const h = harness();
    const project = h.plane.createProject({ name: 'Elastic Auth', rootPath: 'E:/elastic-auth', minSlots: 0, maxSlots: 1 });
    const supervisor = h.plane.issueCapability({ subject: 'supervisor', projectId: project.id, scopes: ['agent:fleet'], ttlMs: 60_000 });
    expect(h.router.handle({ id: 'none', method: 'fleet.reconcile', params: {} }).ok).toBe(false);
    expect(h.router.handle({ id: 'cap', method: 'fleet.reconcile', auth: { capabilityToken: supervisor.token }, params: {} }).ok).toBe(false);
    expect(h.router.handle({ id: 'browser', method: 'fleet.reconcile', auth: { browserToken: 'browser' }, params: {} }).ok).toBe(true);
  });
});
