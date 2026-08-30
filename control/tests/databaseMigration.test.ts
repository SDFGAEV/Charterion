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
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL, status TEXT NOT NULL, isolation_tier TEXT NOT NULL, min_slots INTEGER NOT NULL, max_slots INTEGER NOT NULL, weight INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT;
      CREATE TABLE agent_slots (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, role TEXT NOT NULL, status TEXT NOT NULL, desired_state TEXT NOT NULL DEFAULT 'active', browser_state TEXT NOT NULL DEFAULT 'absent', conversation_key TEXT, browser_profile_id TEXT, browser_tab_id INTEGER, browser_error TEXT, browser_observed_at INTEGER, lease_epoch INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT;
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
