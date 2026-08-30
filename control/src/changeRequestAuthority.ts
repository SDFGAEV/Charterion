import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ControlDatabase } from './database';
import type {
  ChangeRequest,
  ChangeRequestRevision,
  MergeQueueEntry,
  OpenChangeRequestInput,
  SubmitSupervisorReviewInput,
  SupervisorReview,
  UpdateChangeRequestInput,
} from './contracts';

type Row = Record<string, string | number | null>;
const GIT_SHA = /^[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/;

function required(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}
function changeRequestFrom(row: Row): ChangeRequest {
  return {
    id: String(row.id), projectId: String(row.project_id), taskId: String(row.task_id),
    authorSubject: String(row.author_subject), branch: String(row.branch), targetBranch: String(row.target_branch),
    baseSha: String(row.base_sha), headSha: String(row.head_sha), claimId: String(row.claim_id),
    revision: Number(row.revision), status: String(row.status) as ChangeRequest['status'],
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

function revisionFrom(row: Row): ChangeRequestRevision {
  return {
    id: String(row.id), changeRequestId: String(row.change_request_id),
    revision: Number(row.revision), claimId: String(row.claim_id),
    headSha: String(row.head_sha), submittedAt: Number(row.submitted_at),
  };
}

function reviewFrom(row: Row): SupervisorReview {
  return {
    id: String(row.id), projectId: String(row.project_id), changeRequestId: String(row.change_request_id),
    reviewerSubject: String(row.reviewer_subject), headSha: String(row.head_sha),
    verdict: String(row.verdict) as SupervisorReview['verdict'], body: String(row.body), createdAt: Number(row.created_at),
  };
}
function queueFrom(row: Row): MergeQueueEntry {
  const value: MergeQueueEntry = {
    id: String(row.id), projectId: String(row.project_id), changeRequestId: String(row.change_request_id),
    headSha: String(row.head_sha), targetBranch: String(row.target_branch), status: String(row.status) as MergeQueueEntry['status'],
    queuedAt: Number(row.queued_at), updatedAt: Number(row.updated_at),
  };
  if (row.candidate_base_sha !== null) value.candidateBaseSha = String(row.candidate_base_sha);
  if (row.candidate_sha !== null) value.candidateSha = String(row.candidate_sha);
  if (row.error !== null) value.error = String(row.error);
  if (row.integrated_sha !== null) value.integratedSha = String(row.integrated_sha);
  return value;
}

export class ChangeRequestAuthority {
  constructor(private readonly database: ControlDatabase, private readonly gitPath = 'git') {}

  private event(projectId: string, type: string, subject: string, payload: Record<string, unknown>, now: number): void {
    this.database.db.prepare(`
      INSERT INTO events(project_id,type,subject,payload_json,created_at) VALUES(?,?,?,?,?)
    `).run(projectId, type, subject, JSON.stringify(payload), now);
  }

  private projectRoot(projectId: string): string {
    const row = this.database.db.prepare('SELECT root_path FROM projects WHERE id=?').get(projectId) as { root_path?: string } | undefined;
    if (!row?.root_path) throw new Error(`Project ${projectId} does not exist`);
    return row.root_path;
  }
  private gitCheck(projectId: string, baseSha: string, headSha: string, branch: string): void {
    if (!GIT_SHA.test(baseSha) || !GIT_SHA.test(headSha)) throw new Error('baseSha/headSha must be full Git object ids');
    if (!BRANCH.test(branch) || branch.includes('..') || branch.endsWith('/') || branch.includes('@{')) throw new Error('branch is invalid');
    const root = this.projectRoot(projectId);
    for (const sha of [baseSha, headSha]) {
      const exists = spawnSync(this.gitPath, ['-C', root, 'cat-file', '-e', `${sha}^{commit}`], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false });
      if (exists.status !== 0) throw new Error(`Git commit ${sha} does not exist`);
    }
    const ancestor = spawnSync(this.gitPath, ['-C', root, 'merge-base', '--is-ancestor', baseSha, headSha], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false });
    if (ancestor.status !== 0) throw new Error('Change Request head is not descended from base');
    const tip = spawnSync(this.gitPath, ['-C', root, 'rev-parse', '--verify', `${branch}^{commit}`], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false });
    if (tip.status !== 0 || tip.stdout.trim().toLowerCase() !== headSha.toLowerCase()) throw new Error('Change Request branch tip does not match headSha');
  }

  private verifiedClaim(claimId: string, projectId: string, taskId: string, subject: string, headSha: string): void {
    const row = this.database.db.prepare('SELECT * FROM claims WHERE id=?').get(claimId) as Row | undefined;
    if (!row) throw new Error(`Claim ${claimId} does not exist`);
    if (String(row.project_id) !== projectId || String(row.task_id) !== taskId || String(row.subject) !== subject) throw new Error('Claim identity does not match Change Request');
    if (String(row.status) !== 'verified') throw new Error('Change Request requires evidence-valid claim');
    if (row.commit_sha === null || String(row.commit_sha).toLowerCase() !== headSha.toLowerCase()) throw new Error('Claim commit does not match Change Request head');
  }
  getChangeRequest(id: string): ChangeRequest {
    const row = this.database.db.prepare('SELECT * FROM change_requests WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Change Request ${id} does not exist`);
    return changeRequestFrom(row);
  }

  listChangeRequests(projectId?: string): ChangeRequest[] {
    const rows = (projectId
      ? this.database.db.prepare('SELECT * FROM change_requests WHERE project_id=? ORDER BY created_at,id').all(projectId)
      : this.database.db.prepare('SELECT * FROM change_requests ORDER BY created_at,id').all()) as Row[];
    return rows.map(changeRequestFrom);
  }

  listRevisions(changeRequestId: string): ChangeRequestRevision[] {
    return (this.database.db.prepare('SELECT * FROM change_request_revisions WHERE change_request_id=? ORDER BY revision').all(changeRequestId) as Row[]).map(revisionFrom);
  }

  open(input: OpenChangeRequestInput, now = Date.now()): ChangeRequest {
    const projectId = required(input.projectId, 'Project id');
    const taskId = required(input.taskId, 'Task id');
    const subject = required(input.subject, 'Author subject');
    const branch = required(input.branch, 'Branch');
    const targetBranch = required(input.targetBranch, 'Target branch');
    if (branch === targetBranch) throw new Error('Source and target branches must differ');
    const baseSha = required(input.baseSha, 'Base SHA');
    const headSha = required(input.headSha, 'Head SHA');
    this.verifiedClaim(input.claimId, projectId, taskId, subject, headSha);
    this.gitCheck(projectId, baseSha, headSha, branch);
    if (!BRANCH.test(targetBranch)) throw new Error('targetBranch is invalid');
    const targetTip = spawnSync(this.gitPath, ['-C', this.projectRoot(projectId), 'rev-parse', '--verify', `${targetBranch}^{commit}`], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false });
    if (targetTip.status !== 0 || targetTip.stdout.trim().toLowerCase() !== baseSha.toLowerCase()) throw new Error('Change Request baseSha does not match target branch tip');
    return this.database.transaction(() => {
      const duplicate = this.database.db.prepare(`
        SELECT id FROM change_requests WHERE project_id=? AND task_id=? AND status NOT IN ('integrated','closed')
      `).get(projectId, taskId) as { id?: string } | undefined;
      if (duplicate?.id) throw new Error(`Task ${taskId} already has active Change Request ${duplicate.id}`);
      const id = randomUUID();
      this.database.db.prepare(`
        INSERT INTO change_requests(id,project_id,task_id,author_subject,branch,target_branch,base_sha,head_sha,claim_id,revision,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,1,'open',?,?)
      `).run(id, projectId, taskId, subject, branch, targetBranch, baseSha, headSha, input.claimId, now, now);
      this.database.db.prepare(`
        INSERT INTO change_request_revisions(id,change_request_id,revision,claim_id,head_sha,submitted_at)
        VALUES(?,?,?,?,?,?)
      `).run(randomUUID(), id, 1, input.claimId, headSha, now);
      this.event(projectId, 'CHANGE_REQUEST_OPENED', id, { taskId, branch, baseSha, headSha, claimId: input.claimId }, now);
      return this.getChangeRequest(id);
    });
  }

  update(input: UpdateChangeRequestInput, now = Date.now()): ChangeRequest {
    const current = this.getChangeRequest(input.changeRequestId);
    if (!['open','changes-requested'].includes(current.status)) throw new Error(`Change Request ${current.id} cannot accept a revision while ${current.status}`);
    const subject = required(input.subject, 'Author subject');
    if (subject !== current.authorSubject) throw new Error('Only the Change Request author may submit a revision');
    const headSha = required(input.headSha, 'Head SHA');
    if (headSha.toLowerCase() === current.headSha.toLowerCase()) throw new Error('Revision headSha must change');
    this.verifiedClaim(input.claimId, current.projectId, current.taskId, subject, headSha);
    this.gitCheck(current.projectId, current.baseSha, headSha, current.branch);
    return this.database.transaction(() => {
      const revision = current.revision + 1;
      this.database.db.prepare(`
        UPDATE change_requests SET head_sha=?,claim_id=?,revision=?,status='open',updated_at=? WHERE id=?
      `).run(headSha, input.claimId, revision, now, current.id);
      this.database.db.prepare(`
        INSERT INTO change_request_revisions(id,change_request_id,revision,claim_id,head_sha,submitted_at)
        VALUES(?,?,?,?,?,?)
      `).run(randomUUID(), current.id, revision, input.claimId, headSha, now);
      this.event(current.projectId, 'CHANGE_REQUEST_REVISION_SUBMITTED', current.id, { revision, headSha, claimId: input.claimId }, now);
      return this.getChangeRequest(current.id);
    });
  }

  listReviews(changeRequestId: string): SupervisorReview[] {
    return (this.database.db.prepare('SELECT * FROM supervisor_reviews WHERE change_request_id=? ORDER BY created_at,id').all(changeRequestId) as Row[]).map(reviewFrom);
  }

  review(input: SubmitSupervisorReviewInput, now = Date.now()): SupervisorReview {
    const current = this.getChangeRequest(input.changeRequestId);
    if (current.status !== 'open') throw new Error(`Change Request ${current.id} is not reviewable while ${current.status}`);
    const reviewer = required(input.reviewerSubject, 'Reviewer subject');
    if (reviewer === current.authorSubject) throw new Error('Change Request author cannot approve their own work');
    if (input.headSha.toLowerCase() !== current.headSha.toLowerCase()) throw new Error('Supervisor review headSha is stale');
    const verdict = input.verdict;
    if (verdict !== 'approve' && verdict !== 'request-changes') throw new Error('Review verdict is invalid');
    const body = required(input.body, 'Review body');
    return this.database.transaction(() => {
      const id = randomUUID();
      this.database.db.prepare(`
        INSERT INTO supervisor_reviews(id,project_id,change_request_id,reviewer_subject,head_sha,verdict,body,created_at)
        VALUES(?,?,?,?,?,?,?,?)
      `).run(id, current.projectId, current.id, reviewer, current.headSha, verdict, body, now);
      const nextStatus = verdict === 'approve' ? 'approved' : 'changes-requested';
      this.database.db.prepare('UPDATE change_requests SET status=?,updated_at=? WHERE id=?').run(nextStatus, now, current.id);
      this.event(current.projectId, verdict === 'approve' ? 'CHANGE_REQUEST_APPROVED' : 'CHANGE_REQUEST_CHANGES_REQUESTED', current.id, {
        reviewer, headSha: current.headSha, reviewId: id,
      }, now);
      return reviewFrom(this.database.db.prepare('SELECT * FROM supervisor_reviews WHERE id=?').get(id) as Row);
    });
  }

  listQueue(projectId?: string): MergeQueueEntry[] {
    const rows = (projectId
      ? this.database.db.prepare('SELECT * FROM merge_queue WHERE project_id=? ORDER BY queued_at,id').all(projectId)
      : this.database.db.prepare('SELECT * FROM merge_queue ORDER BY queued_at,id').all()) as Row[];
    return rows.map(queueFrom);
  }
  queue(changeRequestId: string, now = Date.now()): MergeQueueEntry {
    const current = this.getChangeRequest(changeRequestId);
    if (current.status !== 'approved') throw new Error(`Change Request ${current.id} is not approved`);
    const latestReview = this.database.db.prepare(`
      SELECT * FROM supervisor_reviews WHERE change_request_id=? ORDER BY created_at DESC,id DESC LIMIT 1
    `).get(current.id) as Row | undefined;
    if (!latestReview || String(latestReview.verdict) !== 'approve' || String(latestReview.head_sha).toLowerCase() !== current.headSha.toLowerCase()) {
      throw new Error('Current Change Request head lacks Supervisor approval');
    }
    const claim = this.database.db.prepare('SELECT status FROM claims WHERE id=?').get(current.claimId) as { status?: string } | undefined;
    if (claim?.status !== 'verified') throw new Error('Current Change Request head lacks valid machine evidence');
    return this.database.transaction(() => {
      const existing = this.database.db.prepare(`SELECT * FROM merge_queue WHERE change_request_id=? AND status IN ('queued','validating')`).get(current.id) as Row | undefined;
      if (existing) return queueFrom(existing);
      const id = randomUUID();
      this.database.db.prepare(`
        INSERT INTO merge_queue(id,project_id,change_request_id,head_sha,target_branch,status,queued_at,updated_at)
        VALUES(?,?,?,?,?, 'queued',?,?)
      `).run(id, current.projectId, current.id, current.headSha, current.targetBranch, now, now);
      this.database.db.prepare(`UPDATE change_requests SET status='queued',updated_at=? WHERE id=?`).run(now, current.id);
      this.event(current.projectId, 'CHANGE_REQUEST_QUEUED', current.id, { queueEntryId: id, headSha: current.headSha, targetBranch: current.targetBranch }, now);
      return queueFrom(this.database.db.prepare('SELECT * FROM merge_queue WHERE id=?').get(id) as Row);
    });
  }
  private failMergeCandidate(entry: MergeQueueEntry, message: string, now: number): MergeQueueEntry {
    return this.database.transaction(() => {
      this.database.db.prepare(`UPDATE merge_queue SET status='failed',error=?,updated_at=? WHERE id=?`).run(message, now, entry.id);
      this.database.db.prepare(`UPDATE change_requests SET status='changes-requested',updated_at=? WHERE id=?`).run(now, entry.changeRequestId);
      this.event(entry.projectId, 'MERGE_CANDIDATE_FAILED', entry.changeRequestId, { queueEntryId: entry.id, error: message }, now);
      return queueFrom(this.database.db.prepare('SELECT * FROM merge_queue WHERE id=?').get(entry.id) as Row);
    });
  }

  prepareMergeCandidate(queueEntryId: string, now = Date.now()): MergeQueueEntry {
    const row = this.database.db.prepare('SELECT * FROM merge_queue WHERE id=?').get(queueEntryId) as Row | undefined;
    if (!row) throw new Error(`Merge queue entry ${queueEntryId} does not exist`);
    const entry = queueFrom(row);
    if (entry.status !== 'queued') throw new Error(`Merge queue entry ${entry.id} is not queued`);
    const current = this.getChangeRequest(entry.changeRequestId);
    if (current.status !== 'queued' || current.headSha.toLowerCase() !== entry.headSha.toLowerCase()) throw new Error('Merge queue entry is stale');
    const root = this.projectRoot(entry.projectId);
    const target = spawnSync(this.gitPath, ['-C', root, 'rev-parse', '--verify', `${entry.targetBranch}^{commit}`], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false });
    if (target.status !== 0) return this.failMergeCandidate(entry, 'Target branch cannot be resolved', now);
    const targetTip = target.stdout.trim();    const baseStillAncestor = spawnSync(this.gitPath, ['-C', root, 'merge-base', '--is-ancestor', current.baseSha, targetTip], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false });
    if (baseStillAncestor.status !== 0) return this.failMergeCandidate(entry, 'Target branch history no longer descends from the reviewed base', now);
    const ff = spawnSync(this.gitPath, ['-C', root, 'merge-base', '--is-ancestor', targetTip, current.headSha], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false });
    let candidateSha = current.headSha;
    if (ff.status !== 0) {
      const tree = spawnSync(this.gitPath, ['-C', root, 'merge-tree', '--write-tree', targetTip, current.headSha], { encoding: 'utf8', windowsHide: true, timeout: 10_000, shell: false });
      if (tree.status !== 0) return this.failMergeCandidate(entry, (tree.stdout || tree.stderr || 'Merge conflict').trim(), now);
      const treeSha = tree.stdout.trim().split(/\s+/)[0] ?? '';
      if (!GIT_SHA.test(treeSha)) return this.failMergeCandidate(entry, 'git merge-tree did not produce a tree id', now);
      const env = { ...process.env, GIT_AUTHOR_NAME: 'GAM Merge Queue', GIT_AUTHOR_EMAIL: 'gam-merge@example.invalid', GIT_COMMITTER_NAME: 'GAM Merge Queue', GIT_COMMITTER_EMAIL: 'gam-merge@example.invalid' };
      const commit = spawnSync(this.gitPath, ['-C', root, 'commit-tree', treeSha, '-p', targetTip, '-p', current.headSha, '-m', `GAM merge ${current.id}`], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false, env });
      if (commit.status !== 0 || !GIT_SHA.test(commit.stdout.trim())) return this.failMergeCandidate(entry, (commit.stderr || 'git commit-tree failed').trim(), now);
      candidateSha = commit.stdout.trim();
    }
    const diffCheck = spawnSync(this.gitPath, ['-C', root, 'diff', '--check', targetTip, candidateSha], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false });
    if (diffCheck.status !== 0) return this.failMergeCandidate(entry, (diffCheck.stdout || diffCheck.stderr || 'git diff --check failed').trim(), now);    return this.database.transaction(() => {
      this.database.db.prepare(`UPDATE merge_queue SET status='validating',candidate_base_sha=?,candidate_sha=?,error=NULL,updated_at=? WHERE id=?`)
        .run(targetTip, candidateSha, now, entry.id);
      this.event(entry.projectId, 'MERGE_CANDIDATE_PREPARED', entry.changeRequestId, { queueEntryId: entry.id, targetBranch: entry.targetBranch, candidateBaseSha: targetTip, candidateSha }, now);
      return queueFrom(this.database.db.prepare('SELECT * FROM merge_queue WHERE id=?').get(entry.id) as Row);
    });
  }

  observeIntegration(queueEntryId: string, now = Date.now()): MergeQueueEntry {
    const row = this.database.db.prepare('SELECT * FROM merge_queue WHERE id=?').get(queueEntryId) as Row | undefined;
    if (!row) throw new Error(`Merge queue entry ${queueEntryId} does not exist`);
    const entry = queueFrom(row);
    if (entry.status !== 'validating' || !entry.candidateSha) throw new Error(`Merge queue entry ${entry.id} has no validated candidate`);
    const root = this.projectRoot(entry.projectId);
    const target = spawnSync(this.gitPath, ['-C', root, 'rev-parse', '--verify', `${entry.targetBranch}^{commit}`], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false });
    if (target.status !== 0) throw new Error('Target branch cannot be resolved');
    const targetTip = target.stdout.trim();
    const candidateIncluded = spawnSync(this.gitPath, ['-C', root, 'merge-base', '--is-ancestor', entry.candidateSha, targetTip], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false });
    const headIncluded = spawnSync(this.gitPath, ['-C', root, 'merge-base', '--is-ancestor', entry.headSha, targetTip], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false });
    if (candidateIncluded.status !== 0 && headIncluded.status !== 0) throw new Error('Target branch does not yet contain the approved Change Request');
    return this.database.transaction(() => {
      this.database.db.prepare(`UPDATE merge_queue SET status='integrated',integrated_sha=?,updated_at=? WHERE id=?`).run(targetTip, now, entry.id);
      this.database.db.prepare(`UPDATE change_requests SET status='integrated',updated_at=? WHERE id=?`).run(now, entry.changeRequestId);
      this.event(entry.projectId, 'CHANGE_REQUEST_INTEGRATED', entry.changeRequestId, { queueEntryId: entry.id, integratedSha: targetTip }, now);
      return queueFrom(this.database.db.prepare('SELECT * FROM merge_queue WHERE id=?').get(entry.id) as Row);
    });
  }
}
