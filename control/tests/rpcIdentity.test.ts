import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';
import { RpcRouter } from '../src/rpc';

describe('RPC instance fencing', () => {
  it('exposes identity on health and rejects another GAM instance before auth dispatch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gam-instance-rpc-'));
    const db = new ControlDatabase(join(dir, 'db.sqlite'));
    try {
      const plane = new ControlPlane(db);
      const instanceId = '0123456789abcdef';
      const router = new RpcRouter(plane, 'admin', 'browser', instanceId);
      expect(router.handle({ id: 'health', method: 'health' })).toEqual({
        id: 'health', ok: true, result: { status: 'ok', protocolVersion: 2, instanceId },
      });
      const missing = router.handle({ id: 'missing', method: 'project.list', auth: { browserToken: 'browser' } });
      expect(missing).toMatchObject({ ok: false, error: { code: 'INSTANCE_MISMATCH' } });
      const wrong = router.handle({ id: 'wrong', method: 'project.list', instanceId: 'fedcba9876543210', auth: { browserToken: 'browser' } });
      expect(wrong).toMatchObject({ ok: false, error: { code: 'INSTANCE_MISMATCH' } });
      const allowed = router.handle({ id: 'ok', method: 'project.list', instanceId, auth: { browserToken: 'browser' } });
      expect(allowed).toMatchObject({ ok: true, result: [] });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
