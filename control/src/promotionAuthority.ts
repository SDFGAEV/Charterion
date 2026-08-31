import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ControlDatabase } from './database';
import type {
  ApplySelfHostingPromotionInput,
  DecideSelfHostingPromotionInput,
  RequestSelfHostingPromotionInput,
  SelfHostingPromotion,
} from './contracts';

type Row = Record<string, string | number | null>;
const GIT_SHA = /^[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$/;
const TARGET_REF = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/;

function required(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function sameSha(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function promotionFrom(row: Row): SelfHostingPromotion {
  const result: SelfHostingPromotion = {
    id: String(row.id), projectId: String(row.project_id), idempotencyKey: String(row.idempotency_key),
    claimId: String(row.claim_id), candidateSubject: String(row.candidate_subject), candidateSha: String(row.candidate_sha),
    targetRef: String(row.target_ref), expectedParentSha: String(row.expected_parent_sha), requestedBy: String(row.requested_by),
    status: String(row.status) as SelfHostingPromotion['status'], createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
  if (row.decision_by !== null) result.decisionBy = String(row.decision_by);
  if (row.decision_reason !== null) result.decisionReason = String(row.decision_reason);
  if (row.decision_at !== null) result.decisionAt = Number(row.decision_at);
  if (row.promoted_at !== null) result.promotedAt = Number(row.promoted_at);
  return result;
}

export class PromotionAuthority {
  constructor(private readonly database: ControlDatabase, private readonly gitPath = 'git') {}

  private event(projectId: string, type: string, subject: string, payload: Record<string, unknown>, now: number): void {
    this.database.db.prepare(`INSERT INTO events(project_id,type,subject,payload_json,created_at) VALUES(?,?,?,?,?)`)
      .run(projectId, type, subject, JSON.stringify(payload), now);
  }

  private projectRoot(projectId: string): string {
    const row = this.database.db.prepare('SELECT root_path,status FROM projects WHERE id=?').get(projectId) as { root_path?: string; status?: string } | undefined;
    if (!row?.root_path) throw new Error(`Project ${projectId} does not exist`);
    if (!['active', 'draining'].includes(String(row.status))) throw new Error(`Project ${projectId} cannot promote while ${String(row.status)}`);
    return row.root_path;
  }

  private verifiedExactClaim(claimId: string, projectId: string, candidateSha: string): Row {
    const claim = this.database.db.prepare('SELECT * FROM claims WHERE id=?').get(claimId) as Row | undefined;
    if (!claim) throw new Error(`Claim ${claimId} does not exist`);
    if (String(claim.project_id) !== projectId) throw new Error('Promotion claim belongs to another project');
    if (String(claim.status) !== 'verified') throw new Error('Promotion requires a verified claim');
    if (claim.commit_sha === null || !sameSha(String(claim.commit_sha), candidateSha)) {
      throw new Error('Promotion candidateSha must exactly match the verified claim commit');
    }
    const verification = this.database.db.prepare(
      "SELECT id FROM verifications WHERE claim_id=? AND status='passed' ORDER BY completed_at DESC,id DESC LIMIT 1",
    ).get(claimId) as { id?: string } | undefined;
    if (!verification?.id) throw new Error('Promotion claim lacks passed verification evidence');
    return claim;
  }

  private git(projectId: string, args: string[]): string {
    const root = this.projectRoot(projectId);
    const result = spawnSync(this.gitPath, ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false });
    if (result.status !== 0) throw new Error((result.stderr || result.error?.message || `git ${args[0]} failed`).trim());
    return result.stdout.trim();
  }

  private validateGitState(projectId: string, candidateSha: string, expectedParentSha: string, targetRef: string): void {
    if (!GIT_SHA.test(candidateSha) || !GIT_SHA.test(expectedParentSha)) throw new Error('Promotion SHAs must be full Git object ids');
    if (!TARGET_REF.test(targetRef) || targetRef.includes('..') || targetRef.includes('@{') || targetRef.endsWith('/')) {
      throw new Error('Promotion targetRef must be a concrete refs/heads/* ref');
    }
    this.git(projectId, ['cat-file', '-e', `${candidateSha}^{commit}`]);
    this.git(projectId, ['cat-file', '-e', `${expectedParentSha}^{commit}`]);
    const current = this.git(projectId, ['rev-parse', '--verify', `${targetRef}^{commit}`]);
    if (!sameSha(current, expectedParentSha)) throw new Error('Promotion expectedParentSha does not match the current parent ref');
    this.git(projectId, ['merge-base', '--is-ancestor', expectedParentSha, candidateSha]);
  }

  get(id: string): SelfHostingPromotion {
    const row = this.database.db.prepare('SELECT * FROM self_hosting_promotions WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error(`Self-hosting promotion ${id} does not exist`);
    return promotionFrom(row);
  }

  list(projectId?: string): SelfHostingPromotion[] {
    const rows = (projectId
      ? this.database.db.prepare('SELECT * FROM self_hosting_promotions WHERE project_id=? ORDER BY created_at,id').all(projectId)
      : this.database.db.prepare('SELECT * FROM self_hosting_promotions ORDER BY created_at,id').all()) as Row[];
    return rows.map(promotionFrom);
  }

  request(input: RequestSelfHostingPromotionInput, now = Date.now()): SelfHostingPromotion {
    const projectId = required(input.projectId, 'Project id');
    const idempotencyKey = required(input.idempotencyKey, 'Promotion idempotency key');
    const claimId = required(input.claimId, 'Claim id');
    const candidateSha = required(input.candidateSha, 'Candidate SHA');
    const expectedParentSha = required(input.expectedParentSha, 'Expected parent SHA');
    const targetRef = required(input.targetRef, 'Target ref');
    const requestedBy = required(input.requestedBy, 'Promotion requester');
    const replayMatches = (current: SelfHostingPromotion): boolean => current.claimId === claimId &&
      sameSha(current.candidateSha, candidateSha) && current.targetRef === targetRef &&
      sameSha(current.expectedParentSha, expectedParentSha) && current.requestedBy === requestedBy;
    const replay = this.database.db.prepare(
      'SELECT * FROM self_hosting_promotions WHERE project_id=? AND idempotency_key=?',
    ).get(projectId, idempotencyKey) as Row | undefined;
    if (replay) {
      const current = promotionFrom(replay);
      if (!replayMatches(current)) throw new Error('Promotion idempotency key was replayed with different authority facts');
      return current;
    }
    const claim = this.verifiedExactClaim(claimId, projectId, candidateSha);
    const candidateSubject = String(claim.subject);
    this.validateGitState(projectId, candidateSha, expectedParentSha, targetRef);
    return this.database.transaction(() => {
      const existing = this.database.db.prepare(
        'SELECT * FROM self_hosting_promotions WHERE project_id=? AND idempotency_key=?',
      ).get(projectId, idempotencyKey) as Row | undefined;
      if (existing) {
        const current = promotionFrom(existing);
        if (!replayMatches(current) || current.candidateSubject !== candidateSubject) {
          throw new Error('Promotion idempotency key was replayed with different authority facts');
        }
        return current;
      }
      const id = randomUUID();
      this.database.db.prepare(`
        INSERT INTO self_hosting_promotions(
          id,project_id,idempotency_key,claim_id,candidate_subject,candidate_sha,target_ref,expected_parent_sha,requested_by,status,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?)
      `).run(id, projectId, idempotencyKey, claimId, candidateSubject, candidateSha, targetRef, expectedParentSha, requestedBy, now, now);
      this.event(projectId, 'SELF_HOSTING_PROMOTION_REQUESTED', id, { claimId, candidateSubject, candidateSha, targetRef, expectedParentSha, requestedBy }, now);
      return this.get(id);
    });
  }

  decide(input: DecideSelfHostingPromotionInput, now = Date.now()): SelfHostingPromotion {
    const current = this.get(required(input.promotionId, 'Promotion id'));
    const authority = required(input.authoritySubject, 'Promotion authority subject');
    const reason = required(input.reason, 'Promotion decision reason');
    if (authority === current.candidateSubject) throw new Error('Candidate author cannot decide its own promotion');
    if (!['approve', 'reject'].includes(input.decision)) throw new Error('Promotion decision is invalid');
    const desiredStatus = input.decision === 'approve' ? 'approved' : 'rejected';
    if (current.status !== 'pending') {
      if (current.status === desiredStatus && current.decisionBy === authority && current.decisionReason === reason) return current;
      if (current.status === 'promoted' && input.decision === 'approve' && current.decisionBy === authority && current.decisionReason === reason) return current;
      throw new Error(`Self-hosting promotion ${current.id} is already ${current.status}`);
    }
    if (input.decision === 'approve') {
      this.verifiedExactClaim(current.claimId, current.projectId, current.candidateSha);
    }
    return this.database.transaction(() => {
      this.database.db.prepare(`
        UPDATE self_hosting_promotions SET status=?,decision_by=?,decision_reason=?,decision_at=?,updated_at=? WHERE id=? AND status='pending'
      `).run(desiredStatus, authority, reason, now, now, current.id);
      const next = this.get(current.id);
      if (next.status !== desiredStatus || next.decisionBy !== authority) throw new Error('Promotion decision lost a concurrent race');
      this.event(current.projectId, input.decision === 'approve' ? 'SELF_HOSTING_PROMOTION_APPROVED' : 'SELF_HOSTING_PROMOTION_REJECTED', current.id, {
        authoritySubject: authority, candidateSha: current.candidateSha, targetRef: current.targetRef, reason,
      }, now);
      return next;
    });
  }

  private markPromoted(current: SelfHostingPromotion, now: number): SelfHostingPromotion {
    return this.database.transaction(() => {
      const latest = this.get(current.id);
      if (latest.status === 'promoted') return latest;
      if (latest.status !== 'approved') throw new Error(`Self-hosting promotion ${latest.id} cannot finalize while ${latest.status}`);
      this.database.db.prepare("UPDATE self_hosting_promotions SET status='promoted',promoted_at=?,updated_at=? WHERE id=? AND status='approved'")
        .run(now, now, latest.id);
      const next = this.get(latest.id);
      if (next.status !== 'promoted') throw new Error('Promotion finalization lost a concurrent race');
      this.event(next.projectId, 'SELF_HOSTING_PROMOTION_APPLIED', next.id, {
        candidateSha: next.candidateSha, targetRef: next.targetRef, expectedParentSha: next.expectedParentSha,
      }, now);
      return next;
    });
  }

  apply(input: ApplySelfHostingPromotionInput, now = Date.now()): SelfHostingPromotion {
    const current = this.get(required(input.promotionId, 'Promotion id'));
    const authority = required(input.authoritySubject, 'Promotion authority subject');
    if (authority === current.candidateSubject) throw new Error('Candidate author cannot apply its own promotion');
    if (current.status === 'promoted') {
      if (current.decisionBy !== authority) throw new Error('Promotion replay authority does not match the approving authority');
      return current;
    }
    if (current.status === 'rejected') throw new Error('Rejected promotion is preserved and cannot be applied');
    if (current.status !== 'approved' || !current.decisionBy) throw new Error(`Self-hosting promotion ${current.id} is not approved`);
    if (current.decisionBy !== authority) throw new Error('Only the approving independent authority may apply this promotion');
    this.verifiedExactClaim(current.claimId, current.projectId, current.candidateSha);
    this.git(current.projectId, ['cat-file', '-e', `${current.candidateSha}^{commit}`]);
    const observed = this.git(current.projectId, ['rev-parse', '--verify', `${current.targetRef}^{commit}`]);
    if (sameSha(observed, current.candidateSha)) return this.markPromoted(current, now);
    if (!sameSha(observed, current.expectedParentSha)) {
      throw new Error(`Parent ref drifted to ${observed}; promotion CAS refused`);
    }
    this.git(current.projectId, ['merge-base', '--is-ancestor', current.expectedParentSha, current.candidateSha]);
    this.git(current.projectId, ['update-ref', current.targetRef, current.candidateSha, current.expectedParentSha]);
    const after = this.git(current.projectId, ['rev-parse', '--verify', `${current.targetRef}^{commit}`]);
    if (!sameSha(after, current.candidateSha)) throw new Error('Parent ref did not converge to the approved candidate SHA');
    return this.markPromoted(current, now);
  }
}
