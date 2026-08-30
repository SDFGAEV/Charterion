import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';
import { RpcRouter } from '../src/rpc';

const cleanups: Array<() => void> = [];
function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'gam-request-rpc-'));
  const db = new ControlDatabase(join(dir, 'state.db'));
  const plane = new ControlPlane(db);
  const router = new RpcRouter(plane, 'admin', 'browser');
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { plane, router };
}
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

describe('Worker request to Supervisor workflow', () => {
  it('gives Worker proposal rights and Supervisor decision rights without self-approval', () => {
    const h = harness();
    const project = h.plane.createProject({ name: 'P', rootPath: 'E:/p' });
    const worker = h.plane.issueCapability({ subject: 'worker-1', projectId: project.id, scopes: ['request:submit','request:read'], ttlMs: 60_000 });
    const supervisor = h.plane.issueCapability({ subject: 'supervisor', projectId: project.id, scopes: ['request:review','request:read'], ttlMs: 60_000 });
    const submitted = h.router.handle({
      id: 'submit', method: 'request.submit', auth: { capabilityToken: worker.token },
      params: { projectId: project.id, fromSubject: 'worker-1', type: 'suggestion', title: 'Parallelize storage work', body: 'The migration can move independently.', suggestedAction: 'spawn ROLE_STORAGE_2' },
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const request = submitted.result as { id: string; status: string };
    expect(request.status).toBe('open');

    const selfDecision = h.router.handle({
      id: 'self', method: 'request.decide', auth: { capabilityToken: worker.token },
      params: { requestId: request.id, supervisorSubject: 'worker-1', decision: 'accept' },
    });
    expect(selfDecision.ok).toBe(false);

    const accepted = h.router.handle({
      id: 'accept', method: 'request.decide', auth: { capabilityToken: supervisor.token },
      params: { requestId: request.id, supervisorSubject: 'supervisor', decision: 'accept', note: 'Approved; create a second storage worker.' },
    });
    expect(accepted).toMatchObject({ ok: true, result: { status: 'accepted', decidedBy: 'supervisor' } });

    const resolved = h.router.handle({
      id: 'resolve', method: 'request.resolve', auth: { capabilityToken: supervisor.token },
      params: { requestId: request.id, supervisorSubject: 'supervisor', note: 'Fleet action completed.' },
    });
    expect(resolved).toMatchObject({ ok: true, result: { status: 'resolved' } });

    const globalRead = h.router.handle({ id: 'global', method: 'request.list', auth: { capabilityToken: worker.token } });
    expect(globalRead.ok).toBe(false);
    const scopedRead = h.router.handle({ id: 'scoped', method: 'request.list', auth: { capabilityToken: worker.token }, params: { projectId: project.id } });
    expect(scopedRead.ok).toBe(true);
  });
});
