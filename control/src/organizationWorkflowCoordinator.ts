import { spawnSync } from 'node:child_process';
import type { ControlDatabase } from './database';
import type { ChangeRequestAuthority } from './changeRequestAuthority';
import type { ReviewPoolAuthority } from './reviewPoolAuthority';
import type { WorkClaim, VerificationRecord, TaskWorkspace, ChangeRequest } from './contracts';
import type { ReviewRequestRecord } from './reviewPoolContracts';

export interface OrganizationWorkflowReconciliation {
  organizationId: string;
  workItemId: string;
  changeRequest?: ChangeRequest;
  reviewRequest?: ReviewRequestRecord;
  status: 'review-ready' | 'blocked' | 'not-applicable';
  reason?: string;
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(label + ' is required');
  return normalized;
}

export class OrganizationWorkflowCoordinator {
  constructor(
    private readonly database: ControlDatabase,
    private readonly changes: ChangeRequestAuthority,
    private readonly reviewPool: ReviewPoolAuthority,
    private readonly gitPath = 'git',
  ) {}

  private event(projectId: string, type: string, subject: string, payload: Record<string, unknown>, now: number): void {
    this.database.db.prepare('INSERT INTO events(project_id,type,subject,payload_json,created_at) VALUES(?,?,?,?,?)')
      .run(projectId, type, subject, JSON.stringify(payload), now);
  }

  private organizationFor(workItemId: string): { organizationId?: string; projectId?: string } | undefined {
    return this.database.db.prepare(`
      SELECT m.organization_id AS organization_id,m.project_id AS project_id
      FROM organization_work_items w JOIN missions m ON m.id=w.mission_id WHERE w.id=?
    `).get(workItemId) as { organizationId?: string; projectId?: string } | undefined;
  }

  private targetBranch(root: string, baseSha: string): string {
    for (const branch of ['main', 'master']) {
      const result = spawnSync(this.gitPath, ['-C', root, 'rev-parse', '--verify', `${branch}^{commit}`], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false });
      if (result.status === 0 && result.stdout.trim().toLowerCase() === baseSha.toLowerCase()) return branch;
    }
    throw new Error('No main or master target branch matches the workspace base SHA');
  }

  reconcileVerifiedWork(
    claim: WorkClaim,
    verification: VerificationRecord,
    workspace: TaskWorkspace | undefined,
    now = Date.now(),
  ): OrganizationWorkflowReconciliation {
    const workItemId = claim.taskId.startsWith('org-work-') ? claim.taskId.slice('org-work-'.length) : '';
    const identity = this.organizationFor(workItemId);
    if (!identity?.organizationId || !identity.projectId) return { organizationId: '', workItemId, status: 'not-applicable' };
    if (verification.status !== 'passed' || !claim.commitSha || !workspace) {
      return { organizationId: identity.organizationId, workItemId, status: 'blocked', reason: 'Verified organization work lacks exact commit or durable workspace' };
    }
    try {
      const project = this.database.db.prepare('SELECT root_path FROM projects WHERE id=?').get(identity.projectId) as { root_path?: string } | undefined;
      const root = required(project?.root_path, 'Project root');
      const targetBranch = this.targetBranch(root, workspace.baseSha);
      const changeRequest = this.changes.listChangeRequests(identity.projectId).find((item) => item.taskId === claim.taskId && item.status !== 'closed')
        ?? this.changes.open({
          projectId: identity.projectId, taskId: claim.taskId, subject: claim.subject, branch: workspace.branch,
          targetBranch, baseSha: workspace.baseSha, headSha: claim.commitSha, claimId: claim.id,
        }, now);
      const reviewRequest = this.reviewPool.open({
        organizationId: identity.organizationId, changeRequestId: changeRequest.id, risk: 'normal',
        slots: [{ dimension: 'architecture', required: true }, { dimension: 'correctness', required: true }],
      }, now);
      this.event(identity.projectId, 'ORGANIZATION_WORK_REVIEW_READY', workItemId, { claimId: claim.id, changeRequestId: changeRequest.id, reviewRequestId: reviewRequest.id, headSha: claim.commitSha }, now);
      return { organizationId: identity.organizationId, workItemId, changeRequest, reviewRequest, status: 'review-ready' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.event(identity.projectId, 'ORGANIZATION_WORK_REVIEW_BLOCKED', workItemId, { claimId: claim.id, reason }, now);
      return { organizationId: identity.organizationId, workItemId, status: 'blocked', reason };
    }
  }
}
