import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CONTROL_SCHEMA_VERSION, ControlDatabase } from '../src/database';

describe('control database migrations', () => {
  it('migrates v9 browser runtime rows to v10 page health semantics', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gam-db-v9-'));
    const path = join(dir, 'global.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      INSERT INTO schema_meta(key,value) VALUES('schema_version','9');
      CREATE TABLE browser_runtime (profile_id TEXT PRIMARY KEY,
        auth_status TEXT NOT NULL CHECK(auth_status IN ('unknown','authenticated','authentication-required')),
        open_tabs INTEGER NOT NULL CHECK(open_tabs >= 0), extension_version TEXT NOT NULL, observed_at INTEGER NOT NULL) STRICT;
      INSERT INTO browser_runtime VALUES('gam-default','authenticated',2,'0.4.1',100);`);
    legacy.close();
    const database = new ControlDatabase(path);
    const row = database.db.prepare('SELECT * FROM browser_runtime WHERE profile_id=?').get('gam-default') as Record<string, unknown>;
    const version = database.db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get() as { value: string };
    expect(row.page_health).toBe('unknown');
    expect(Number(version.value)).toBe(CONTROL_SCHEMA_VERSION);
    database.close(); rmSync(dir, { recursive: true, force: true });
  });
});
