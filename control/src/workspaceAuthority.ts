import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ControlDatabase } from './database';
import type { TaskWorkspace } from './contracts';

type Row = Record<string, string | number | null>;

function slug(value: string): string {
  const clean = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || 'worker';
}

function workspaceFrom(row: Row): TaskWorkspace {
  return {
    id: String(row.id), projectId: String(row.project_id), taskId: String(row.task_id), slotId: String(row.slot_id),
    repoPath: String(row.repo_path), path: String(row.path), branch: String(row.branch), baseSha: String(row.base_sha),
    resourceId: String(row.resource_id), leaseId: String(row.lease_id), leaseEpoch: Number(row.lease_epoch), capabilityId: String(row.capability_id),
    capabilityTokenPath: String(row.capability_token_path), status: String(row.status) as TaskWorkspace['status'],
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

export interface MaterializedWorkspace { repoPath: string; path: string; branch: string; baseSha: string; }
export interface WorkspaceObservation { headSha: string; branch: string; dirty: boolean; }
export type VerifiedWorkspaceCleanup = 'removed' | 'already-released' | 'orphan-preserved';

export class WorkspaceAuthority {
  readonly managedRoot: string;
  readonly controlCliPath: string;
  constructor(private readonly database: ControlDatabase, private readonly gitPath = 'git') {
    this.managedRoot = resolve(dirname(database.path), 'worktrees');
    this.controlCliPath = resolve(dirname(database.path), 'GAMCTL.cmd');
    mkdirSync(this.managedRoot, { recursive: true });
  }

  private git(cwd: string, args: string[], allowFailure = false): string {
    const result = spawnSync(this.gitPath, ['-C', cwd, ...args], {
      encoding: 'utf8', windowsHide: true, timeout: 15_000, shell: false,
    });
    if (result.status !== 0 && !allowFailure) {
      throw new Error((result.stderr || result.error?.message || `git ${args.join(' ')} failed`).trim());
    }
    return result.status === 0 ? String(result.stdout ?? '').trim() : '';
  }

  private validateManagedPath(path: string): string {
    const candidate = resolve(path);
    const rel = relative(this.managedRoot, candidate);
    if (!rel || rel === '.' || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Workspace path escapes GAM managed root');
    return candidate;
  }

  private repoRoot(projectRoot: string): string {
    const requested = realpathSync(projectRoot);
    const top = realpathSync(this.git(requested, ['rev-parse', '--show-toplevel']));
    if (process.platform === 'win32' ? requested.toLowerCase() !== top.toLowerCase() : requested !== top) {
      throw new Error(`Project root ${requested} must be the Git repository root ${top}`);
    }
    return top;
  }

  get(id: string): TaskWorkspace {
    const row = this.database.db.prepare('SELECT * FROM task_workspaces WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Task workspace ${id} does not exist`);
    return workspaceFrom(row);
  }

  find(projectId: string, taskId: string): TaskWorkspace | undefined {
    const row = this.database.db.prepare('SELECT * FROM task_workspaces WHERE project_id=? AND task_id=?').get(projectId, taskId) as Row | undefined;
    return row ? workspaceFrom(row) : undefined;
  }

  list(projectId?: string): TaskWorkspace[] {
    const rows = (projectId
      ? this.database.db.prepare('SELECT * FROM task_workspaces WHERE project_id=? ORDER BY created_at,id').all(projectId)
      : this.database.db.prepare('SELECT * FROM task_workspaces ORDER BY created_at,id').all()) as Row[];
    return rows.map(workspaceFrom);
  }

  materialize(input: { projectId: string; projectRoot: string; slotId: string; role: string; taskId: string }): MaterializedWorkspace {
    const existing = this.find(input.projectId, input.taskId);
    if (existing) {
      if (existing.slotId !== input.slotId) throw new Error(`Task ${input.taskId} workspace belongs to another AgentSlot`);
      if (existing.status !== 'active') throw new Error(`Task ${input.taskId} workspace is ${existing.status}`);
      return { repoPath: existing.repoPath, path: existing.path, branch: existing.branch, baseSha: existing.baseSha };
    }
    const repoPath = this.repoRoot(input.projectRoot);
    const baseSha = this.git(repoPath, ['rev-parse', '--verify', 'HEAD']);
    const branch = `gam/${slug(input.role)}/${slug(input.taskId).slice(0, 48)}`;
    const path = this.validateManagedPath(join(this.managedRoot, input.projectId, `${slug(input.role)}-${slug(input.taskId).slice(0, 32)}`));
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      const currentBranch = this.git(path, ['branch', '--show-current']);
      const headSha = this.git(path, ['rev-parse', '--verify', 'HEAD']);
      const dirty = Boolean(this.git(path, ['status', '--porcelain=v1', '--untracked-files=all']));
      if (currentBranch !== branch || headSha !== baseSha || dirty) {
        throw new Error(`Existing path ${path} is not a clean recoverable GAM worktree`);
      }
      return { repoPath, path, branch, baseSha };
    }
    const branchProbe = spawnSync(this.gitPath, ['-C', repoPath, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { windowsHide: true, timeout: 10_000, shell: false });
    if (branchProbe.status === 0) throw new Error(`Workspace branch ${branch} already exists without a durable task workspace record`);
    if (branchProbe.status !== 1) throw new Error(branchProbe.error?.message || 'Unable to inspect workspace branch identity');
    const result = spawnSync(this.gitPath, ['-C', repoPath, 'worktree', 'add', '-b', branch, path, baseSha], {
      encoding: 'utf8', windowsHide: true, timeout: 30_000, shell: false,
    });
    if (result.status !== 0) throw new Error((result.stderr || result.error?.message || 'git worktree add failed').trim());
    return { repoPath, path, branch, baseSha };
  }

  record(input: MaterializedWorkspace & {
    projectId: string; taskId: string; slotId: string; resourceId: string; leaseId: string; leaseEpoch: number;
    capabilityId: string; capabilityToken: string;
  }, now = Date.now()): TaskWorkspace {
    const existing = this.find(input.projectId, input.taskId);
    if (existing) return existing;
    const id = randomUUID();
    const tokenDir = resolve(dirname(this.database.path), 'capabilities');
    mkdirSync(tokenDir, { recursive: true });
    const capabilityTokenPath = join(tokenDir, `${id}.token`);
    writeFileSync(capabilityTokenPath, `${input.capabilityToken.trim()}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try {
      this.database.db.prepare(`
        INSERT INTO task_workspaces(id,project_id,task_id,slot_id,repo_path,path,branch,base_sha,resource_id,lease_id,lease_epoch,capability_id,capability_token_path,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?, 'active',?,?)
      `).run(id, input.projectId, input.taskId, input.slotId, input.repoPath, input.path, input.branch, input.baseSha,
        input.resourceId, input.leaseId, input.leaseEpoch, input.capabilityId, capabilityTokenPath, now, now);
    } catch (error) {
      try { rmSync(capabilityTokenPath, { force: true }); } catch { /* keep primary error */ }
      throw error;
    }
    return this.get(id);
  }

  removeCapabilityToken(id: string): void {
    const workspace = this.get(id);
    rmSync(workspace.capabilityTokenPath, { force: true });
  }

  observe(id: string): WorkspaceObservation {
    const workspace = this.get(id);
    if (workspace.status !== 'active') throw new Error(`Task workspace ${id} is ${workspace.status}`);
    const headSha = this.git(workspace.path, ['rev-parse', '--verify', 'HEAD']);
    const branch = this.git(workspace.path, ['branch', '--show-current']);
    const dirty = Boolean(this.git(workspace.path, ['status', '--porcelain=v1', '--untracked-files=all']));
    if (branch !== workspace.branch) throw new Error(`Task workspace ${id} branch drifted from ${workspace.branch} to ${branch}`);
    return { headSha, branch, dirty };
  }

  private registeredWorktree(repoPath: string, path: string): boolean {
    const wanted = resolve(path);
    return this.git(repoPath, ['worktree', 'list', '--porcelain']).split(/\r?\n/).some((line) => {
      if (!line.startsWith('worktree ')) return false;
      const actual = resolve(line.slice('worktree '.length));
      return process.platform === 'win32' ? actual.toLowerCase() === wanted.toLowerCase() : actual === wanted;
    });
  }

  finalizeVerified(id: string, now = Date.now(), options: { attempts?: number; timeoutMs?: number } = {}): { workspace: TaskWorkspace; cleanup: VerifiedWorkspaceCleanup } {
    const workspace = this.get(id);
    if (workspace.status === 'released') return { workspace, cleanup: 'already-released' };
    try {
      const released = this.release(id, now, options);
      return { workspace: released, cleanup: 'removed' };
    } catch (error) {
      if (this.registeredWorktree(workspace.repoPath, workspace.path)) throw error;
      this.database.db.prepare("UPDATE task_workspaces SET status='released',updated_at=? WHERE id=?").run(now, id);
      return { workspace: this.get(id), cleanup: 'orphan-preserved' };
    }
  }

  release(id: string, now = Date.now(), options: { attempts?: number; timeoutMs?: number } = {}): TaskWorkspace {
    const workspace = this.get(id);
    if (workspace.status === 'released') return workspace;
    const observation = this.observe(id);
    if (observation.dirty) throw new Error(`Task workspace ${id} is dirty; refusing to remove uncommitted work`);
    let error: Error | undefined;
    const attempts = options.attempts ?? (process.platform === 'win32' ? 8 : 1);
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isInteger(attempts) || attempts < 1) throw new Error('Workspace release attempts must be a positive integer');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('Workspace release timeoutMs must be a positive integer');
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = spawnSync(this.gitPath, ['-C', workspace.repoPath, 'worktree', 'remove', workspace.path], {
        encoding: 'utf8', windowsHide: true, timeout: timeoutMs, shell: false,
      });
      if (result.status === 0) { error = undefined; break; }
      error = new Error((result.stderr || result.error?.message || 'git worktree remove failed').trim());
      if (attempt + 1 < attempts) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(50 * (2 ** attempt), 500));
    }
    if (error) throw error;
    this.database.db.prepare("UPDATE task_workspaces SET status='released',updated_at=? WHERE id=?").run(now, id);
    return this.get(id);
  }
}
