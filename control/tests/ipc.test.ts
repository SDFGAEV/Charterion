import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';
import { sendRpc, startIpcServer } from '../src/ipc';
import { RpcRouter } from '../src/rpc';
import type { RpcRequest } from '../src/contracts';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

function setup(): { plane: ControlPlane; router: RpcRouter; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gam-rpc-'));
  const db = new ControlDatabase(join(dir, 'db.sqlite'));
  const plane = new ControlPlane(db);
  const close = (): void => { db.close(); rmSync(dir, { recursive: true, force: true }); };
  cleanups.push(close);
  return { plane, router: new RpcRouter(plane, 'admin-secret', 'browser-secret'), close };
}
describe('RPC authentication', () => {
  it('allows health without auth and rejects admin mutations with a bad token', () => {
    const { router } = setup();
    expect(router.handle({ id: 'h', method: 'health' })).toMatchObject({ ok: true });
    const denied = router.handle({
      id: 'x', method: 'project.create', auth: { adminToken: 'wrong' },
      params: { name: 'P', rootPath: 'E:/p' },
    });
    expect(denied).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('uses capability scopes for read-only agent access', () => {
    const { plane, router } = setup();
    const project = plane.createProject({ name: 'P', rootPath: 'E:/p' });
    plane.createAgentSlot(project.id, 'worker');
    const cap = plane.issueCapability({
      subject: 'worker', projectId: project.id, scopes: ['agent:read'], ttlMs: 100000,
    });
    const request: RpcRequest = {
      id: 'agents', method: 'agent.list', auth: { capabilityToken: cap.token }, params: { projectId: project.id },
    };
    const allowed = router.handle(request);
    expect(allowed.ok).toBe(true);
    const denied = router.handle({ ...request, id: 'events', method: 'events.list' });
    expect(denied).toMatchObject({ ok: false });
  });
});
describe('named-pipe transport', () => {
  it('round-trips one RPC request over the daemon transport', async () => {
    const { router } = setup();
    const pipe = process.platform === 'win32'
      ? `\\\\.\\pipe\\gam-test-${randomUUID()}`
      : join(tmpdir(), `gam-test-${randomUUID()}.sock`);
    const server = await startIpcServer(pipe, router);
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const response = await sendRpc(pipe, { id: 'health', method: 'health' });
    expect(response).toEqual({ id: 'health', ok: true, result: { status: 'ok', protocolVersion: 2, instanceId: null } });
  });
});

describe('browser control credential', () => {
  it('allows read-only control-plane queries but not mutations', () => {
    const { plane, router } = setup();
    const project = plane.createProject({ name: 'Browser Project', rootPath: 'E:/browser' });
    const listed = router.handle({ id: 'p', method: 'project.list', auth: { browserToken: 'browser-secret' } });
    expect(listed).toMatchObject({ ok: true });
    const denied = router.handle({
      id: 'write', method: 'project.status', auth: { browserToken: 'browser-secret' },
      params: { projectId: project.id, status: 'paused' },
    });
    expect(denied).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('rejects a wrong browser credential', () => {
    const { router } = setup();
    const denied = router.handle({ id: 'p', method: 'project.list', auth: { browserToken: 'wrong' } });
    expect(denied).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
  });
});

describe('browser runtime reporting', () => {
  it('allows the browser credential to report auth state without granting control mutations', () => {
    const { plane, router } = setup();
    const reported = router.handle({ id: 'report', method: 'browser.report', auth: { browserToken: 'browser-secret' }, params: {
      profileId: 'gam-default', authStatus: 'authentication-required', openTabs: 1, extensionVersion: '0.4.0', observedAt: 100,
    }});
    expect(reported).toMatchObject({ ok: true, result: { authStatus: 'authentication-required', openTabs: 1 } });
    expect(plane.listBrowserRuntime()).toHaveLength(1);
    const denied = router.handle({ id: 'mutate', method: 'project.create', auth: { browserToken: 'browser-secret' }, params: { name: 'No', rootPath: 'E:/no' } });
    expect(denied).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('lets the browser report AgentSlot observations without granting fleet authority', () => {
    const { plane, router } = setup();
    const project = plane.createProject({ name: 'Fleet Browser', rootPath: 'E:/fleet-browser' });
    const slot = plane.createAgentSlot(project.id, 'ROLE01');
    const observed = router.handle({ id: 'agent-observe', method: 'agent.browser-report', auth: { browserToken: 'browser-secret' }, params: {
      slotId: slot.id, profileId: 'gam-default', browserState: 'open', tabId: 42, conversationKey: 'conversation:role01', observedAt: 100,
    }});
    expect(observed).toMatchObject({ ok: true, result: { desiredState: 'active', browserState: 'open', browserTabId: 42 } });
    const denied = router.handle({ id: 'agent-stop', method: 'agent.suspend', auth: { browserToken: 'browser-secret' }, params: { slotId: slot.id } });
    expect(denied).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('rejects invalid browser reports and exposes status only to browser/admin credentials', () => {
    const { router } = setup();
    const bad = router.handle({ id: 'bad', method: 'browser.report', auth: { browserToken: 'browser-secret' }, params: {
      profileId: 'gam-default', authStatus: 'logged-in', openTabs: 1, extensionVersion: '0.4.0', observedAt: 100,
    }});
    expect(bad.ok).toBe(false);
    const listed = router.handle({ id: 'status', method: 'browser.status', auth: { browserToken: 'browser-secret' } });
    expect(listed.ok).toBe(true);
    const denied = router.handle({ id: 'status2', method: 'browser.status', auth: { capabilityToken: 'not-a-browser-token' } });
    expect(denied.ok).toBe(false);
  });
});
