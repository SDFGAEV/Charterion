import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ControlDatabase } from './database';
import type {
  EvidenceArtifact,
  RegisterArtifactInput,
  SubmitClaimInput,
  VerificationCheck,
  VerificationRecord,
  WorkClaim,
} from './contracts';type Row = Record<string, string | number | null>;
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const GIT_SHA = /^[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$/;

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function nonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}

function claimFrom(row: Row): WorkClaim {
  const value: WorkClaim = {
    id: String(row.id), projectId: String(row.project_id), taskId: String(row.task_id),
    subject: String(row.subject), resourceId: String(row.resource_id), leaseId: String(row.lease_id),
    leaseEpoch: Number(row.lease_epoch), summary: String(row.summary), status: String(row.status) as WorkClaim['status'],
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
  if (row.attempt_id !== null) value.attemptId = String(row.attempt_id);
  if (row.commit_sha !== null) value.commitSha = String(row.commit_sha);
  return value;
}function artifactFrom(row: Row): EvidenceArtifact {
  return {
    id: String(row.id), projectId: String(row.project_id), claimId: String(row.claim_id),
    kind: String(row.kind) as EvidenceArtifact['kind'], relativePath: String(row.relative_path),
    sha256: String(row.sha256), sizeBytes: Number(row.size_bytes),
    metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)), createdAt: Number(row.created_at),
  };
}

function verificationFrom(row: Row): VerificationRecord {
  return {
    id: String(row.id), projectId: String(row.project_id), claimId: String(row.claim_id),
    status: String(row.status) as VerificationRecord['status'],
    checks: parseJson<VerificationCheck[]>(String(row.checks_json)),
    createdAt: Number(row.created_at), completedAt: Number(row.completed_at),
  };
}

function hashFile(path: string): { sha256: string; sizeBytes: number } {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) throw new Error('Artifact path must be a regular file');
    if (before.size > MAX_ARTIFACT_BYTES) throw new Error(`Artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`);
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < before.size) {
      const read = readSync(fd, buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      if (read <= 0) throw new Error('Artifact changed while hashing');
      hash.update(buffer.subarray(0, read));
      offset += read;
    }
    const after = fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new Error('Artifact changed while hashing');
    }
    return { sha256: hash.digest('hex'), sizeBytes: before.size };
  } finally { closeSync(fd); }
}export class EvidenceAuthority {
  constructor(private readonly database: ControlDatabase, private readonly gitPath = 'git') {}

  private event(projectId: string, type: string, subject: string, payload: Record<string, unknown>, now: number): void {
    this.database.db.prepare(`
      INSERT INTO events(project_id, type, subject, payload_json, created_at) VALUES(?, ?, ?, ?, ?)
    `).run(projectId, type, subject, JSON.stringify(payload), now);
  }

  private projectRow(projectId: string): Row {
    const row = this.database.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Row | undefined;
    if (!row) throw new Error(`Project ${projectId} does not exist`);
    return row;
  }

  getClaim(id: string): WorkClaim {
    const row = this.database.db.prepare('SELECT * FROM claims WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error(`Claim ${id} does not exist`);
    if (row.lease_id === null) throw new Error(`Claim ${id} predates lease identity and cannot be trusted`);
    return claimFrom(row);
  }

  listClaims(projectId?: string): WorkClaim[] {
    const rows = (projectId
      ? this.database.db.prepare('SELECT * FROM claims WHERE project_id = ? ORDER BY created_at, id').all(projectId)
      : this.database.db.prepare('SELECT * FROM claims ORDER BY created_at, id').all()) as Row[];
    return rows.filter((row) => row.lease_id !== null).map(claimFrom);
  }  submitClaim(input: SubmitClaimInput, now = Date.now()): WorkClaim {
    const projectId = nonEmpty(input.projectId, 'Project id');
    const taskId = nonEmpty(input.taskId, 'Task id');
    const subject = nonEmpty(input.subject, 'Claim subject');
    const resourceId = nonEmpty(input.resourceId, 'Resource id');
    const summary = nonEmpty(input.summary, 'Claim summary');
    if (!Number.isInteger(input.leaseEpoch) || input.leaseEpoch <= 0) throw new Error('leaseEpoch is invalid');
    const commitSha = input.commitSha?.trim() || undefined;
    if (commitSha && !GIT_SHA.test(commitSha)) throw new Error('commitSha must be a full 40- or 64-hex Git object id');
    return this.database.transaction(() => {
      const project = this.projectRow(projectId);
      if (String(project.status) !== 'active' && String(project.status) !== 'draining') {
        throw new Error(`Project ${projectId} cannot accept claims while ${String(project.status)}`);
      }
      const resource = this.database.db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId) as Row | undefined;
      if (!resource) throw new Error(`Resource ${resourceId} does not exist`);
      if (resource.project_id !== null && String(resource.project_id) !== projectId) throw new Error('Claim resource belongs to another project');
      this.database.db.prepare(`UPDATE leases SET status='expired', updated_at=?
        WHERE resource_id=? AND status='active' AND expires_at IS NOT NULL AND expires_at<=?`).run(now, resourceId, now);
      const lease = this.database.db.prepare(`
        SELECT * FROM leases WHERE resource_id=? AND project_id=? AND epoch=? ORDER BY created_at DESC LIMIT 1
      `).get(resourceId, projectId, input.leaseEpoch) as Row | undefined;
      if (!lease || String(lease.status) !== 'active') throw new Error('Claim lease is not active');
      if (String(lease.holder_id) !== subject) throw new Error('Claim subject does not own the lease');
      if (lease.task_id === null || String(lease.task_id) !== taskId) throw new Error('Claim task does not match the lease task');
      const id = randomUUID();
      this.database.db.prepare(`
        INSERT INTO claims(id,project_id,task_id,attempt_id,subject,resource_id,lease_id,lease_epoch,summary,commit_sha,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?, 'submitted',?,?)
      `).run(id, projectId, taskId, input.attemptId?.trim() || null, subject, resourceId, String(lease.id), input.leaseEpoch, summary, commitSha ?? null, now, now);
      this.event(projectId, 'CLAIM_SUBMITTED', id, { taskId, subject, resourceId, leaseId: String(lease.id), leaseEpoch: input.leaseEpoch }, now);
      return this.getClaim(id);
    });
  }  private resolveArtifactPath(projectRoot: string, requestedPath: string): { fullPath: string; relativePath: string } {
    const root = realpathSync(projectRoot);
    const candidate = realpathSync(isAbsolute(requestedPath) ? requestedPath : resolve(root, requestedPath));
    const rel = relative(root, candidate);
    if (!rel || rel === '.') throw new Error('Artifact path must name a file below the project root');
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Artifact path escapes the project root');
    return { fullPath: candidate, relativePath: rel.replaceAll('\\', '/') };
  }

  registerArtifact(input: RegisterArtifactInput, now = Date.now()): EvidenceArtifact {
    const claim = this.getClaim(input.claimId);
    if (claim.status !== 'submitted') throw new Error(`Claim ${claim.id} is already terminal`);
    if (nonEmpty(input.subject, 'Artifact subject') !== claim.subject) throw new Error('Artifact subject does not own the claim');
    const lease = this.database.db.prepare('SELECT * FROM leases WHERE id=?').get(claim.leaseId) as Row | undefined;
    if (!lease || String(lease.status) !== 'active') throw new Error('Artifact lease is not active');
    if (lease.expires_at !== null && Number(lease.expires_at) <= now) {
      this.database.db.prepare(`UPDATE leases SET status='expired', updated_at=? WHERE id=?`).run(now, claim.leaseId);
      throw new Error('Artifact lease is expired');
    }
    const project = this.projectRow(claim.projectId);
    const resolved = this.resolveArtifactPath(String(project.root_path), nonEmpty(input.path, 'Artifact path'));
    const digest = hashFile(resolved.fullPath);
    const id = randomUUID();
    return this.database.transaction(() => {
      this.database.db.prepare(`
        INSERT INTO artifacts(id,project_id,claim_id,kind,relative_path,sha256,size_bytes,metadata_json,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)
      `).run(id, claim.projectId, claim.id, input.kind, resolved.relativePath, digest.sha256, digest.sizeBytes, JSON.stringify(input.metadata ?? {}), now);
      this.event(claim.projectId, 'ARTIFACT_REGISTERED', id, { claimId: claim.id, relativePath: resolved.relativePath, sha256: digest.sha256, sizeBytes: digest.sizeBytes }, now);
      return this.getArtifact(id);
    });
  }

  getArtifact(id: string): EvidenceArtifact {
    const row = this.database.db.prepare('SELECT * FROM artifacts WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Artifact ${id} does not exist`);
    return artifactFrom(row);
  }

  listArtifacts(claimId?: string): EvidenceArtifact[] {
    const rows = (claimId
      ? this.database.db.prepare('SELECT * FROM artifacts WHERE claim_id=? ORDER BY created_at,id').all(claimId)
      : this.database.db.prepare('SELECT * FROM artifacts ORDER BY created_at,id').all()) as Row[];
    return rows.map(artifactFrom);
  }  private checkLeaseIdentity(claim: WorkClaim): VerificationCheck {
    const row = this.database.db.prepare('SELECT * FROM leases WHERE id=?').get(claim.leaseId) as Row | undefined;
    if (!row) return { name: 'lease.identity', passed: false, detail: 'Lease record no longer exists' };
    const passed = String(row.resource_id) === claim.resourceId && String(row.project_id) === claim.projectId &&
      String(row.holder_id) === claim.subject && String(row.task_id) === claim.taskId && Number(row.epoch) === claim.leaseEpoch;
    return { name: 'lease.identity', passed, detail: passed ? `lease ${claim.leaseId} matches claim identity` : 'Lease identity fields do not match claim' };
  }

  private checkGitCommit(claim: WorkClaim, projectRoot: string): VerificationCheck | undefined {
    if (!claim.commitSha) return undefined;
    const result = spawnSync(this.gitPath, ['-C', projectRoot, 'cat-file', '-e', `${claim.commitSha}^{commit}`], {
      encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false,
    });
    const passed = result.status === 0;
    const detail = passed ? `commit ${claim.commitSha} exists` : (result.stderr || result.error?.message || 'git cat-file rejected commit').trim();
    return { name: 'git.commit', passed, detail };
  }

  private artifactChecks(claim: WorkClaim, projectRoot: string): VerificationCheck[] {
    return this.listArtifacts(claim.id).map((artifact) => {
      try {
        const resolved = this.resolveArtifactPath(projectRoot, artifact.relativePath);
        const current = hashFile(resolved.fullPath);
        const passed = current.sha256 === artifact.sha256 && current.sizeBytes === artifact.sizeBytes;
        return { name: `artifact:${artifact.id}`, passed, detail: passed ? `${artifact.relativePath} unchanged` : `${artifact.relativePath} digest or size changed` };
      } catch (error) {
        return { name: `artifact:${artifact.id}`, passed: false, detail: error instanceof Error ? error.message : String(error) };
      }
    });
  }  verifyClaim(claimId: string, now = Date.now()): VerificationRecord {
    const claim = this.getClaim(claimId);
    if (claim.status !== 'submitted') throw new Error(`Claim ${claim.id} is already terminal`);
    const project = this.projectRow(claim.projectId);
    const projectRoot = String(project.root_path);
    const artifacts = this.listArtifacts(claim.id);
    const checks: VerificationCheck[] = [this.checkLeaseIdentity(claim)];
    const git = this.checkGitCommit(claim, projectRoot);
    if (git) checks.push(git);
    checks.push(...this.artifactChecks(claim, projectRoot));
    checks.push({
      name: 'evidence.present',
      passed: Boolean(claim.commitSha) || artifacts.length > 0,
      detail: Boolean(claim.commitSha) || artifacts.length > 0 ? 'At least one independently checkable evidence item exists' : 'No commit or artifact evidence was supplied',
    });
    const status: VerificationRecord['status'] = checks.every((check) => check.passed) ? 'passed' : 'failed';
    return this.database.transaction(() => {
      const id = randomUUID();
      this.database.db.prepare(`
        INSERT INTO verifications(id,project_id,claim_id,status,checks_json,created_at,completed_at)
        VALUES(?,?,?,?,?,?,?)
      `).run(id, claim.projectId, claim.id, status, JSON.stringify(checks), now, now);
      this.database.db.prepare('UPDATE claims SET status=?, updated_at=? WHERE id=?')
        .run(status === 'passed' ? 'verified' : 'rejected', now, claim.id);
      this.event(claim.projectId, status === 'passed' ? 'CLAIM_VERIFIED' : 'CLAIM_REJECTED', claim.id, { verificationId: id, checks }, now);
      return this.getVerification(id);
    });
  }

  getVerification(id: string): VerificationRecord {
    const row = this.database.db.prepare('SELECT * FROM verifications WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Verification ${id} does not exist`);
    return verificationFrom(row);
  }

  listVerifications(claimId?: string): VerificationRecord[] {
    const rows = (claimId
      ? this.database.db.prepare('SELECT * FROM verifications WHERE claim_id=? ORDER BY created_at,id').all(claimId)
      : this.database.db.prepare('SELECT * FROM verifications ORDER BY created_at,id').all()) as Row[];
    return rows.map(verificationFrom);
  }
}