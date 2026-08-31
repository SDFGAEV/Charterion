import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';

const cleanups: Array<() => void> = [];
function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error((result.stderr || result.error?.message || 'git failed').trim());
  return String(result.stdout ?? '').trim();
}

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'gam-workspace-'));
  const projectRoot = join(dir, 'project');
  spawnSync('git', ['init', '-b', 'main', projectRoot], { encoding: 'utf8', windowsHide: true });
  git(projectRoot, 'config', 'user.email', 'gam-test@example.invalid');
  git(projectRoot, 'config', 'user.name', 'GAM Test');
  writeFileSync(join(projectRoot, 'README.md'), 'base\n');
  git(projectRoot, 'add', 'README.md');
  git(projectRoot, 'commit', '-m', 'base');
  const database = new ControlDatabase(join(dir, 'state', 'global.db'));
  const plane = new ControlPlane(database);
  cleanups.push(() => { database.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, projectRoot, plane };
}
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

function seedTask(h: ReturnType<typeof harness>, taskId: string, role = 'WORKER') {
  const project = h.plane.listProjects()[0] ?? h.plane.createProject({ name: 'P', rootPath: h.projectRoot, maxSlots: 4 }, 10);
  const slot = h.plane.listAgentSlots(project.id).find((item) => item.role === role) ?? h.plane.createAgentSlot(project.id, role, 11);
  const snapshot = h.plane.work.snapshot();
  const task = {
    id: taskId, kind: 'work', completionPolicy: 'verified-claim', title: taskId, project: project.name,
    instruction: `do ${taskId}`, targetRole: role, dependsOn: [], attemptIds: [], createdAt: 12, updatedAt: 12,
  };
  h.plane.work.replace({
    expectedRevision: snapshot.revision, transportGeneration: `seed-${taskId}`, transportSequence: snapshot.revision + 1,
    transportMessageId: `seed-${taskId}-${snapshot.revision + 1}`, tasks: [...snapshot.tasks, task], attempts: snapshot.attempts, messages: snapshot.messages,
  }, 12);
  return { project, slot, task };
}

describe('WorkspaceAuthority', () => {
  it('provisions an isolated task worktree with durable lease and capability identity', () => {
    const h = harness();
    const seeded = seedTask(h, 'task-1');
    const workspace = h.plane.provisionTaskWorkspace(seeded.project.id, seeded.slot.id, seeded.task.id, 20);
    expect(workspace.status).toBe('active');
    expect(workspace.branch).toBe('gam/worker/task-1');
    expect(workspace.path).not.toBe(h.projectRoot);
    expect(existsSync(workspace.path)).toBe(true);
    expect(workspace.leaseEpoch).toBeGreaterThan(0);
    expect(existsSync(workspace.capabilityTokenPath)).toBe(true);
    expect(h.plane.getLease(workspace.leaseId)).toMatchObject({ holderId: seeded.slot.id, taskId: seeded.task.id, mode: 'exclusive', status: 'active' });
    expect(h.plane.provisionTaskWorkspace(seeded.project.id, seeded.slot.id, seeded.task.id, 21).id).toBe(workspace.id);
  });

  it('requires the claim commit to be the assigned workspace branch HEAD', () => {
    const h = harness();
    const seeded = seedTask(h, 'task-claim');
    const workspace = h.plane.provisionTaskWorkspace(seeded.project.id, seeded.slot.id, seeded.task.id, 20);
    writeFileSync(join(workspace.path, 'result.txt'), 'worker result\n');
    git(workspace.path, 'add', 'result.txt');
    git(workspace.path, 'commit', '-m', 'worker result');
    const head = git(workspace.path, 'rev-parse', 'HEAD');
    const claim = h.plane.evidence.submitClaim({
      projectId: seeded.project.id, taskId: seeded.task.id, subject: seeded.slot.id,
      resourceId: workspace.resourceId, leaseEpoch: workspace.leaseEpoch, summary: 'done', commitSha: head,
    }, 30);
    const verification = h.plane.verifyClaimAndCompleteTask(claim.id, 31);
    expect(verification.status).toBe('passed');
    expect(verification.checks.find((item) => item.name === 'workspace.commit')?.passed).toBe(true);
    expect(h.plane.work.getTask(seeded.task.id)).toMatchObject({ machineCompletion: { claimId: claim.id, verificationId: verification.id, commitSha: head } });
    expect(h.plane.workspaces.get(workspace.id).status).toBe('released');
    expect(h.plane.getLease(workspace.leaseId).status).toBe('released');
    expect(existsSync(workspace.path)).toBe(false);
    expect(existsSync(workspace.capabilityTokenPath)).toBe(false);
    const revision = h.plane.work.snapshot().revision;
    expect(h.plane.verifyClaimAndCompleteTask(claim.id, 40).id).toBe(verification.id);
    expect(h.plane.work.snapshot().revision).toBe(revision);
  });

  it('fences verified authority even when physical workspace cleanup must be deferred', () => {
    const h = harness();
    const seeded = seedTask(h, 'task-deferred-release');
    const workspace = h.plane.provisionTaskWorkspace(seeded.project.id, seeded.slot.id, seeded.task.id, 20);
    writeFileSync(join(workspace.path, 'result.txt'), 'worker result\n');
    git(workspace.path, 'add', 'result.txt');
    git(workspace.path, 'commit', '-m', 'worker result');
    const head = git(workspace.path, 'rev-parse', 'HEAD');
    const claim = h.plane.evidence.submitClaim({ projectId: seeded.project.id, taskId: seeded.task.id, subject: seeded.slot.id, resourceId: workspace.resourceId, leaseEpoch: workspace.leaseEpoch, summary: 'done', commitSha: head }, 30);
    const release = vi.spyOn(h.plane.workspaces, 'release').mockImplementation(() => { throw new Error('simulated Windows worktree lock'); });
    const verification = h.plane.verifyClaimAndCompleteTask(claim.id, 31);
    expect(verification.status).toBe('passed');
    expect(h.plane.work.getTask(seeded.task.id)?.machineCompletion).toMatchObject({ claimId: claim.id, commitSha: head });
    expect(h.plane.getLease(workspace.leaseId).status).toBe('released');
    const capability = h.plane.database.db.prepare('SELECT revoked_at FROM capabilities WHERE id=?').get(workspace.capabilityId) as { revoked_at: number | null };
    expect(capability.revoked_at).toBe(31);
    expect(existsSync(workspace.capabilityTokenPath)).toBe(false);
    expect(h.plane.workspaces.get(workspace.id).status).toBe('active');
    expect(h.plane.listEvents(seeded.project.id, 0, 200).some((event) => event.type === 'TASK_WORKSPACE_RELEASE_DEFERRED')).toBe(true);
    release.mockRestore();
    expect(h.plane.verifyClaimAndCompleteTask(claim.id, 40).id).toBe(verification.id);
    expect(h.plane.workspaces.get(workspace.id).status).toBe('released');
  });

  it('converges a verified crash orphan without deleting preserved files', () => {
    const h = harness();
    const seeded = seedTask(h, 'task-orphan-replay');
    const workspace = h.plane.provisionTaskWorkspace(seeded.project.id, seeded.slot.id, seeded.task.id, 20);
    writeFileSync(join(workspace.path, 'result.txt'), 'worker result\n');
    git(workspace.path, 'add', 'result.txt');
    git(workspace.path, 'commit', '-m', 'worker result');
    const head = git(workspace.path, 'rev-parse', 'HEAD');
    const claim = h.plane.evidence.submitClaim({ projectId: seeded.project.id, taskId: seeded.task.id, subject: seeded.slot.id, resourceId: workspace.resourceId, leaseEpoch: workspace.leaseEpoch, summary: 'done', commitSha: head }, 30);
    const verification = h.plane.evidence.verifyClaim(claim.id, 31);
    expect(verification.status).toBe('passed');
    h.plane.work.completeVerifiedClaim({ taskId: seeded.task.id, claimId: claim.id, verificationId: verification.id, commitSha: head }, 31);
    const staleGitLink = readFileSync(join(workspace.path, '.git'), 'utf8');
    git(workspace.repoPath, 'worktree', 'remove', workspace.path);
    mkdirSync(workspace.path, { recursive: true });
    writeFileSync(join(workspace.path, '.git'), staleGitLink);
    writeFileSync(join(workspace.path, 'preserved.txt'), 'do not delete\n');
    expect(h.plane.verifyClaimAndCompleteTask(claim.id, 40).id).toBe(verification.id);
    expect(h.plane.workspaces.get(workspace.id).status).toBe('released');
    expect(h.plane.getLease(workspace.leaseId).status).toBe('released');
    expect(existsSync(workspace.capabilityTokenPath)).toBe(false);
    expect(existsSync(join(workspace.path, 'preserved.txt'))).toBe(true);
    expect(h.plane.listEvents(seeded.project.id, 0, 200).some((event) => event.type === 'TASK_WORKSPACE_ORPHAN_PRESERVED')).toBe(true);
  });

  it('rejects an old or unrelated commit even though the object exists', () => {
    const h = harness();
    const seeded = seedTask(h, 'task-spoof');
    const workspace = h.plane.provisionTaskWorkspace(seeded.project.id, seeded.slot.id, seeded.task.id, 20);
    const claim = h.plane.evidence.submitClaim({
      projectId: seeded.project.id, taskId: seeded.task.id, subject: seeded.slot.id,
      resourceId: workspace.resourceId, leaseEpoch: workspace.leaseEpoch, summary: 'spoof', commitSha: workspace.baseSha,
    }, 30);
    const verification = h.plane.verifyClaimAndCompleteTask(claim.id, 31);
    expect(verification.status).toBe('failed');
    expect(verification.checks.find((item) => item.name === 'workspace.commit')?.passed).toBe(false);
    expect(h.plane.work.getTask(seeded.task.id)?.machineCompletion).toBeUndefined();
  });

  it('releases only clean worktrees and fences lease/capability authority', () => {
    const h = harness();
    const seeded = seedTask(h, 'task-release');
    const workspace = h.plane.provisionTaskWorkspace(seeded.project.id, seeded.slot.id, seeded.task.id, 20);
    writeFileSync(join(workspace.path, 'committed.txt'), 'ok\n');
    git(workspace.path, 'add', 'committed.txt');
    git(workspace.path, 'commit', '-m', 'committed work');
    const released = h.plane.releaseTaskWorkspace(workspace.id, 30);
    expect(released.status).toBe('released');
    expect(existsSync(workspace.path)).toBe(false);
    expect(h.plane.getLease(workspace.leaseId).status).toBe('released');
  });

  it('refuses to remove a dirty worktree', () => {
    const h = harness();
    const seeded = seedTask(h, 'task-dirty');
    const workspace = h.plane.provisionTaskWorkspace(seeded.project.id, seeded.slot.id, seeded.task.id, 20);
    writeFileSync(join(workspace.path, 'wip.txt'), 'uncommitted\n');
    expect(() => h.plane.releaseTaskWorkspace(workspace.id, 30)).toThrow(/dirty.*refusing/i);
    expect(existsSync(join(workspace.path, 'wip.txt'))).toBe(true);
    expect(h.plane.getLease(workspace.leaseId).status).toBe('active');
    expect(h.plane.workspaces.get(workspace.id).status).toBe('active');
  });
  it('finishes lease, capability, and token fencing after a release-boundary interruption', () => {
    const h = harness();
    const seeded = seedTask(h, 'task-recover-release');
    const workspace = h.plane.provisionTaskWorkspace(seeded.project.id, seeded.slot.id, seeded.task.id, 20);
    h.plane.workspaces.release(workspace.id, 30);
    expect(h.plane.workspaces.get(workspace.id).status).toBe('released');
    expect(h.plane.getLease(workspace.leaseId).status).toBe('active');
    expect(existsSync(workspace.capabilityTokenPath)).toBe(true);
    h.plane.releaseTaskWorkspace(workspace.id, 31);
    expect(h.plane.getLease(workspace.leaseId).status).toBe('released');
    const capability = h.plane.database.db.prepare('SELECT revoked_at FROM capabilities WHERE id=?').get(workspace.capabilityId) as { revoked_at: number | null };
    expect(capability.revoked_at).toBe(31);
    expect(existsSync(workspace.capabilityTokenPath)).toBe(false);
  });
});
