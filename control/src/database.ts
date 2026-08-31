import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const CONTROL_SCHEMA_VERSION = 13;

export class ControlDatabase {
  readonly db: DatabaseSync;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = FULL;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  health(): { ok: boolean; quickCheck: string[]; foreignKeyViolations: number } {
    const quickCheck = (this.db.prepare('PRAGMA quick_check').all() as Record<string, unknown>[]).flatMap((row) => Object.values(row).map(String));
    const foreignKeys = this.db.prepare('PRAGMA foreign_key_check').all() as Record<string, unknown>[];
    return { ok: quickCheck.length === 1 && quickCheck[0] === 'ok' && foreignKeys.length === 0, quickCheck, foreignKeyViolations: foreignKeys.length };
  }

  checkpoint(mode: 'PASSIVE'|'FULL'|'RESTART'|'TRUNCATE' = 'FULL'): Record<string, number> {
    const row = this.db.prepare(`PRAGMA wal_checkpoint(${mode})`).get() as Record<string, number> | undefined;
    return row ?? {};
  }

  backupTo(destination: string): { path: string; health: { ok: boolean; quickCheck: string[]; foreignKeyViolations: number } } {
    if (existsSync(destination)) throw new Error('Database backup destination already exists');
    mkdirSync(dirname(destination), { recursive: true });
    this.checkpoint('FULL');
    const escaped = destination.replaceAll("'", "''");
    this.db.exec(`VACUUM INTO '${escaped}'`);
    const backup = new ControlDatabase(destination);
    try {
      const health = backup.health();
      if (!health.ok) throw new Error('Database backup verification failed');
      return { path: destination, health };
    } finally { backup.close(); }
  }

  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = operation();
      this.db.exec('COMMIT;');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK;'); } catch { /* keep original error */ }
      throw error;
    }
  }
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
    `);
    const row = this.db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('schema_version') as { value?: string } | undefined;
    const version = row?.value ? Number(row.value) : 0;
    if (version > CONTROL_SCHEMA_VERSION) {
      throw new Error(`Control database schema ${version} is newer than supported ${CONTROL_SCHEMA_VERSION}`);
    }
    if (version < 1) this.migrateV1();
    if (version < 2) this.migrateV2();
    if (version < 3) this.migrateV3();
    if (version < 4) this.migrateV4();
    if (version < 5) this.migrateV5();
    if (version < 6) this.migrateV6();
    if (version < 7) this.migrateV7();
    if (version < 8) this.migrateV8();
    if (version < 9) this.migrateV9();
    if (version < 10) this.migrateV10();
    if (version < 11) this.migrateV11();
    if (version < 12) this.migrateV12();
    if (version < 13) this.migrateV13();
    this.db.prepare(`
      INSERT INTO schema_meta(key, value) VALUES('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(CONTROL_SCHEMA_VERSION));
  }

  private migrateV1(): void {
    this.transaction(() => {
      this.createCoreTables();
      this.createLeaseTables();
      this.createCapabilityTables();
      this.createEventTables();
    });
  }

  private migrateV2(): void {
    this.transaction(() => this.createEvidenceTables());
  }

  private migrateV3(): void {
    this.transaction(() => {
      const columns = this.db.prepare('PRAGMA table_info(claims)').all();
      if (!columns.some((row) => row.name === 'lease_id')) {
        this.db.exec('ALTER TABLE claims ADD COLUMN lease_id TEXT REFERENCES leases(id) ON DELETE RESTRICT;');
      }
    });
  }

  private createEvidenceTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS claims (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        attempt_id TEXT,
        subject TEXT NOT NULL,
        resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
        lease_epoch INTEGER NOT NULL CHECK(lease_epoch > 0),
        summary TEXT NOT NULL,
        commit_sha TEXT,
        status TEXT NOT NULL CHECK(status IN ('submitted','verified','rejected')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_claims_project_task ON claims(project_id, task_id, created_at);

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('file','test-log','report','git-bundle','other')),
        relative_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(claim_id, relative_path)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_artifacts_claim ON artifacts(claim_id, created_at);

      CREATE TABLE IF NOT EXISTS verifications (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('passed','failed')),
        checks_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        completed_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_verifications_claim ON verifications(claim_id, created_at);
    `);
  }
  private migrateV4(): void {
    this.transaction(() => this.createChangeRequestTables());
  }

  private createChangeRequestTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS change_requests (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL, author_subject TEXT NOT NULL, branch TEXT NOT NULL, base_sha TEXT NOT NULL, head_sha TEXT NOT NULL,
        claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE RESTRICT, revision INTEGER NOT NULL CHECK(revision > 0),
        status TEXT NOT NULL CHECK(status IN ('open','changes-requested','approved','queued','integrated','closed')),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_change_requests_project_task ON change_requests(project_id,task_id,created_at);

      CREATE TABLE IF NOT EXISTS change_request_revisions (
        id TEXT PRIMARY KEY, change_request_id TEXT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK(revision > 0), claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE RESTRICT,
        head_sha TEXT NOT NULL, submitted_at INTEGER NOT NULL, UNIQUE(change_request_id,revision)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS supervisor_reviews (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        change_request_id TEXT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE, reviewer_subject TEXT NOT NULL,
        head_sha TEXT NOT NULL, verdict TEXT NOT NULL CHECK(verdict IN ('approve','request-changes')), body TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_reviews_change_request ON supervisor_reviews(change_request_id,created_at);
      CREATE TABLE IF NOT EXISTS merge_queue (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        change_request_id TEXT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE, head_sha TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','validating','integrated','failed','cancelled')),
        queued_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT, integrated_sha TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_merge_queue_project_status ON merge_queue(project_id,status,queued_at);
    `);
  }

  private migrateV5(): void {
    this.transaction(() => {
      const crColumns = this.db.prepare('PRAGMA table_info(change_requests)').all();
      if (!crColumns.some((row) => row.name === 'target_branch')) this.db.exec("ALTER TABLE change_requests ADD COLUMN target_branch TEXT NOT NULL DEFAULT 'main';");
      const queueColumns = this.db.prepare('PRAGMA table_info(merge_queue)').all();
      if (!queueColumns.some((row) => row.name === 'target_branch')) this.db.exec("ALTER TABLE merge_queue ADD COLUMN target_branch TEXT NOT NULL DEFAULT 'main';");
      if (!queueColumns.some((row) => row.name === 'candidate_base_sha')) this.db.exec('ALTER TABLE merge_queue ADD COLUMN candidate_base_sha TEXT;');
      if (!queueColumns.some((row) => row.name === 'candidate_sha')) this.db.exec('ALTER TABLE merge_queue ADD COLUMN candidate_sha TEXT;');
    });
  }

  private migrateV6(): void {
    this.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS browser_runtime (
          profile_id TEXT PRIMARY KEY,
          auth_status TEXT NOT NULL CHECK(auth_status IN ('unknown','authenticated','authentication-required')),
          page_health TEXT NOT NULL DEFAULT 'unknown' CHECK(page_health IN ('unknown','ready','generating','blocked','error','unavailable')),
          open_tabs INTEGER NOT NULL CHECK(open_tabs >= 0),
          extension_version TEXT NOT NULL,
          observed_at INTEGER NOT NULL
        ) STRICT;
      `);
    });
  }
  private migrateV7(): void {
    this.transaction(() => {
      const columns = this.db.prepare('PRAGMA table_info(agent_slots)').all();
      if (!columns.some((row) => row.name === 'desired_state')) this.db.exec("ALTER TABLE agent_slots ADD COLUMN desired_state TEXT NOT NULL DEFAULT 'active' CHECK(desired_state IN ('active','suspended','retired'));");
      if (!columns.some((row) => row.name === 'browser_state')) this.db.exec("ALTER TABLE agent_slots ADD COLUMN browser_state TEXT NOT NULL DEFAULT 'absent' CHECK(browser_state IN ('absent','opening','open','closing','error'));");
      if (!columns.some((row) => row.name === 'browser_profile_id')) this.db.exec('ALTER TABLE agent_slots ADD COLUMN browser_profile_id TEXT;');
      if (!columns.some((row) => row.name === 'browser_tab_id')) this.db.exec('ALTER TABLE agent_slots ADD COLUMN browser_tab_id INTEGER;');
      if (!columns.some((row) => row.name === 'browser_error')) this.db.exec('ALTER TABLE agent_slots ADD COLUMN browser_error TEXT;');
      if (!columns.some((row) => row.name === 'browser_observed_at')) this.db.exec('ALTER TABLE agent_slots ADD COLUMN browser_observed_at INTEGER;');
    });
  }
  private migrateV8(): void {
    this.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS worker_requests (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, task_id TEXT,
          from_subject TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('suggestion','blocker','question','resource-request','scope-change','dependency-request','cross-system-request','review-request','risk-alert','worker-request')),
          title TEXT NOT NULL, body TEXT NOT NULL, suggested_action TEXT,
          status TEXT NOT NULL CHECK(status IN ('open','accepted','rejected','resolved')),
          decided_by TEXT, decision_note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_worker_requests_project_status ON worker_requests(project_id,status,created_at);
      `);
    });
  }
  private migrateV9(): void {
    this.transaction(() => {
      const columns = this.db.prepare('PRAGMA table_info(capabilities)').all();
      if (!columns.some((row) => row.name === 'agent_slot_id')) this.db.exec('ALTER TABLE capabilities ADD COLUMN agent_slot_id TEXT REFERENCES agent_slots(id) ON DELETE CASCADE;');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_capabilities_agent_slot ON capabilities(agent_slot_id, expires_at);');
    });
  }
  private migrateV10(): void {
    this.transaction(() => {
      const columns = this.db.prepare('PRAGMA table_info(browser_runtime)').all();
      if (!columns.some((row) => row.name === 'page_health')) {
        this.db.exec("ALTER TABLE browser_runtime ADD COLUMN page_health TEXT NOT NULL DEFAULT 'unknown' CHECK(page_health IN ('unknown','ready','generating','blocked','error','unavailable'));");
      }
    });
  }
  private migrateV11(): void {
    this.transaction(() => this.createManagerWorkTables());
  }

  private migrateV12(): void {
    this.transaction(() => {
      const columns = this.db.prepare('PRAGMA table_info(agent_slots)').all();
      const add = (name: string, sql: string): void => { if (!columns.some((row) => row.name === name)) this.db.exec(sql); };
      add('browser_lease_id', 'ALTER TABLE agent_slots ADD COLUMN browser_lease_id TEXT;');
      add('browser_lease_epoch', 'ALTER TABLE agent_slots ADD COLUMN browser_lease_epoch INTEGER;');
      add('browser_content_epoch', 'ALTER TABLE agent_slots ADD COLUMN browser_content_epoch TEXT;');
      add('browser_observation_revision', 'ALTER TABLE agent_slots ADD COLUMN browser_observation_revision INTEGER;');
      add('browser_page_status', 'ALTER TABLE agent_slots ADD COLUMN browser_page_status TEXT;');
      add('browser_runtime_observed_at', 'ALTER TABLE agent_slots ADD COLUMN browser_runtime_observed_at INTEGER;');
      add('browser_quarantined', 'ALTER TABLE agent_slots ADD COLUMN browser_quarantined INTEGER NOT NULL DEFAULT 0 CHECK(browser_quarantined IN (0,1));');
      add('browser_quarantine_reason', 'ALTER TABLE agent_slots ADD COLUMN browser_quarantine_reason TEXT;');
      this.createBrowserAuthorityTables();
    });
  }

  private migrateV13(): void {
    this.transaction(() => {
      const columns = this.db.prepare('PRAGMA table_info(agent_slots)').all();
      const add = (name: string, sql: string): void => { if (!columns.some((row) => row.name === name)) this.db.exec(sql); };
      add('conversation_generation', 'ALTER TABLE agent_slots ADD COLUMN conversation_generation INTEGER NOT NULL DEFAULT 0 CHECK(conversation_generation >= 0);');
      add('rollover_state', "ALTER TABLE agent_slots ADD COLUMN rollover_state TEXT NOT NULL DEFAULT 'idle' CHECK(rollover_state IN ('idle','requested','opening','bootstrapping'));");
      add('active_rollover_id', 'ALTER TABLE agent_slots ADD COLUMN active_rollover_id TEXT;');
      this.createConversationContinuityTables();
      this.db.exec("UPDATE agent_slots SET conversation_generation=1 WHERE conversation_key IS NOT NULL AND conversation_generation=0;");
      this.db.exec("INSERT OR IGNORE INTO agent_conversations(id,project_id,slot_id,generation,conversation_key,status,predecessor_conversation_key,started_at,ended_at,close_reason) SELECT 'legacy:'||id,project_id,id,conversation_generation,conversation_key,'active',NULL,updated_at,NULL,NULL FROM agent_slots WHERE conversation_key IS NOT NULL;");
    });
  }

  private createConversationContinuityTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_conversations (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, slot_id TEXT NOT NULL REFERENCES agent_slots(id) ON DELETE CASCADE,
        generation INTEGER NOT NULL CHECK(generation > 0), conversation_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','closed')),
        predecessor_conversation_key TEXT, started_at INTEGER NOT NULL, ended_at INTEGER, close_reason TEXT,
        UNIQUE(slot_id,generation), UNIQUE(project_id,conversation_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_agent_conversations_slot ON agent_conversations(slot_id,generation);
      CREATE TABLE IF NOT EXISTS worker_checkpoints (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, slot_id TEXT NOT NULL REFERENCES agent_slots(id) ON DELETE CASCADE,
        reason TEXT NOT NULL, handoff_text TEXT NOT NULL, state_json TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_worker_checkpoints_slot ON worker_checkpoints(slot_id,created_at);
      CREATE TABLE IF NOT EXISTS agent_rollovers (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, slot_id TEXT NOT NULL REFERENCES agent_slots(id) ON DELETE CASCADE,
        from_conversation_key TEXT NOT NULL, to_conversation_key TEXT, from_generation INTEGER NOT NULL CHECK(from_generation > 0), to_generation INTEGER NOT NULL CHECK(to_generation > from_generation),
        checkpoint_id TEXT NOT NULL REFERENCES worker_checkpoints(id) ON DELETE RESTRICT, status TEXT NOT NULL CHECK(status IN ('requested','opening','bootstrapping','completed','failed')),
        reason TEXT NOT NULL, bootstrap_attempt_id TEXT, error TEXT, requested_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_agent_rollovers_slot ON agent_rollovers(slot_id,requested_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_rollovers_active ON agent_rollovers(slot_id) WHERE status IN ('requested','opening','bootstrapping');
    `);
  }

  private createBrowserAuthorityTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS browser_operations (
        id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, operation TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, slot_id TEXT REFERENCES agent_slots(id) ON DELETE CASCADE,
        conversation_key TEXT, tab_id INTEGER, content_epoch TEXT, preconditions_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('planned','dispatched','settled')),
        outcome TEXT CHECK(outcome IS NULL OR outcome IN ('acknowledged','reply-observed','failed','uncertain')),
        evidence_json TEXT NOT NULL DEFAULT '{}', planned_at INTEGER NOT NULL, dispatched_at INTEGER, settled_at INTEGER, updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_browser_operations_slot_state ON browser_operations(slot_id,state,updated_at);
      CREATE TABLE IF NOT EXISTS runtime_incidents (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('warning','error','critical')),
        code TEXT NOT NULL, subject TEXT NOT NULL, detail_json TEXT NOT NULL, created_at INTEGER NOT NULL, resolved_at INTEGER
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_runtime_incidents_open ON runtime_incidents(resolved_at,created_at);
      CREATE TABLE IF NOT EXISTS manager_work_mutations (
        message_id TEXT PRIMARY KEY, generation TEXT NOT NULL, sequence INTEGER NOT NULL, payload_hash TEXT NOT NULL,
        result_revision INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(generation,sequence)
      ) STRICT;
    `);
  }

  private createManagerWorkTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS manager_work_meta (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        revision INTEGER NOT NULL CHECK(revision >= 0),
        updated_at INTEGER NOT NULL
      ) STRICT;
      INSERT OR IGNORE INTO manager_work_meta(singleton,revision,updated_at) VALUES(1,0,0);
      CREATE TABLE IF NOT EXISTS manager_tasks (id TEXT PRIMARY KEY, position INTEGER NOT NULL, document_json TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS manager_attempts (id TEXT PRIMARY KEY, position INTEGER NOT NULL, document_json TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS manager_messages (id TEXT PRIMARY KEY, position INTEGER NOT NULL, document_json TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_tasks_position ON manager_tasks(position);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_attempts_position ON manager_attempts(position);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_messages_position ON manager_messages(position);
    `);
  }

  private createCoreTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','draining','paused','archived')),
        isolation_tier TEXT NOT NULL,
        min_slots INTEGER NOT NULL CHECK(min_slots >= 0),
        max_slots INTEGER NOT NULL CHECK(max_slots >= min_slots),
        weight INTEGER NOT NULL CHECK(weight > 0),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS agent_slots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('idle','assigned','suspended','retired')),
        desired_state TEXT NOT NULL DEFAULT 'active' CHECK(desired_state IN ('active','suspended','retired')),
        browser_state TEXT NOT NULL DEFAULT 'absent' CHECK(browser_state IN ('absent','opening','open','closing','error')),
        conversation_key TEXT,
        browser_profile_id TEXT,
        browser_tab_id INTEGER,
        browser_error TEXT,
        browser_observed_at INTEGER,
        lease_epoch INTEGER NOT NULL DEFAULT 0 CHECK(lease_epoch >= 0),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, conversation_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES resources(id) ON DELETE RESTRICT,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        lease_epoch INTEGER NOT NULL DEFAULT 0 CHECK(lease_epoch >= 0),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_resources_project ON resources(project_id);
    `);
  }

  private createLeaseTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS leases (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        holder_id TEXT NOT NULL,
        task_id TEXT,
        mode TEXT NOT NULL CHECK(mode IN ('shared','exclusive')),
        epoch INTEGER NOT NULL CHECK(epoch > 0),
        status TEXT NOT NULL CHECK(status IN ('active','released','expired')),
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_leases_resource_status ON leases(resource_id, status);
      CREATE INDEX IF NOT EXISTS idx_leases_holder ON leases(holder_id, status);
    `);
  }

  private createCapabilityTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS capabilities (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        subject TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        agent_slot_id TEXT REFERENCES agent_slots(id) ON DELETE CASCADE,
        task_id TEXT,
        lease_epoch INTEGER,
        scopes_json TEXT NOT NULL,
        resource_ids_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_capabilities_project ON capabilities(project_id, expires_at);
    `);
  }
  private createEventTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        subject TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_events_project_seq ON events(project_id, seq);
    `);
  }
}
