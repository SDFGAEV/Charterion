import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';

const cleanups: Array<() => void> = [];
const gitPath = process.env.GAM_GIT_PATH || 'git';
function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(gitPath, args, { cwd, encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}
function initRepo(root: string): void {
  const init = spawnSync(gitPath, ['init', '-b', 'main', root], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (init.status !== 0) throw new Error(init.stderr);
  git(root, 'config', 'user.name', 'Charterion Test'); git(root, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'README.md'), 'base\n'); git(root, 'add', 'README.md'); git(root, 'commit', '-m', 'base');
}
function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'charterion-org-exec-'));
  const repo = join(dir, 'repo'); initRepo(repo);
  const database = new ControlDatabase(join(dir, 'global.db'));
  const plane = new ControlPlane(database, gitPath);
  const project = plane.createProject({ name: 'Charterion', rootPath: repo }, 1);
  const slot = plane.createAgentSlot(project.id, 'CONTROL_ENGINEER_A', 2);
  const org = plane.organization.createOrganization({ name: 'Charterion Engineering' }, 3);
  const dep = plane.organization.createDepartment({ organizationId: org.id, name: 'Control Plane' }, 4);
  const agent = plane.organization.registerAgent({ organizationId: org.id, displayName: 'Control Engineer A', primaryDepartmentId: dep.id }, 5);
  const workspace = plane.organization.activeAgentWorkspace(agent.id)!;
  plane.organization.configureAgentWorkspace({
    workspaceId: workspace.id, rootRef: `E:/agents/${agent.id}`, browserProfileId: `profile-${agent.id}`,
    toolProfileRef: `tools-${agent.id}`, allowedRefs: [repo], forbiddenRefs: ['kernel://authority'],
  }, 6);
  plane.organizationRuntime.requestAndAcquire({ organizationId: org.id, agentId: agent.id, projectId: project.id, role: slot.role, idempotencyKey: 'execution-harness' }, 7);
  const mission = plane.organization.createMission({ organizationId: org.id, projectId: project.id, title: 'Self improve execution', objective: 'Improve Charterion safely through evidence-backed changes.', driAgentId: agent.id }, 8);
  plane.organization.setMissionStatus(mission.id, 'active', 9);
  cleanups.push(() => { database.close(); rmSync(dir, { recursive: true, force: true }); });
  return { plane, project, slot, org, agent, mission, repo };
}
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });
describe('OrganizationExecutionBridge', () => {
  it('projects durable Organization Work into one idempotent verified-claim task and real Git worktree', () => {
    const h = harness();
    const work = h.plane.organization.createWorkItem({
      missionId: h.mission.id, title: 'Implement the next self-evolution primitive',
      objective: 'Inspect the current architecture, implement the highest-leverage missing primitive, test it, and provide exact evidence.',
      ownerAgentId: h.agent.id,
    }, 10);
    h.plane.organization.setWorkStatus(work.id, 'ready', 11);

    const projected = h.plane.organizationExecution.materialize(work.id, 12);
    expect(projected).toMatchObject({
      workItemId: work.id, missionId: h.mission.id, organizationAgentId: h.agent.id,
      projectId: h.project.id, runtimeSlotId: h.slot.id,
    });
    expect(projected.managerTaskId).toBe(`org-work-${work.id}`);
    expect(projected.task).toMatchObject({
      kind: 'work', completionPolicy: 'verified-claim', project: 'Charterion', targetRole: 'CONTROL_ENGINEER_A',
      organizationWorkItemId: work.id, missionId: h.mission.id, organizationAgentId: h.agent.id,
    });
    const revisionAfterFirst = h.plane.work.snapshot().revision;
    const again = h.plane.organizationExecution.materialize(work.id, 13);
    expect(again.managerTaskId).toBe(projected.managerTaskId);
    expect(h.plane.work.snapshot().revision).toBe(revisionAfterFirst);

    const taskWorkspace = h.plane.provisionTaskWorkspace(h.project.id, h.slot.id, projected.managerTaskId, 14);
    expect(taskWorkspace.status).toBe('active');
    expect(taskWorkspace.slotId).toBe(h.slot.id);
    expect(taskWorkspace.taskId).toBe(projected.managerTaskId);
    expect(taskWorkspace.branch).toContain(projected.managerTaskId);
    expect(taskWorkspace.path).not.toBe(h.repo);
    expect(existsSync(taskWorkspace.path)).toBe(true);
    expect(h.plane.getLease(taskWorkspace.leaseId)).toMatchObject({ holderId: h.slot.id, taskId: projected.managerTaskId, status: 'active' });
  }, 30_000);

  it('projects an explicitly browser-only WorkItem as a structured-result task', () => {
    const h = harness();
    const work = h.plane.organization.createWorkItem({
      missionId: h.mission.id, title: 'Report browser observation',
      objective: 'Inspect the visible ChatGPT conversation and return a factual report.',
      ownerAgentId: h.agent.id, completionPolicy: 'structured-result',
    }, 20);
    h.plane.organization.setWorkStatus(work.id, 'ready', 21);

    const projected = h.plane.organizationExecution.materialize(work.id, 22);
    expect(work.completionPolicy).toBe('structured-result');
    expect(projected.task).toMatchObject({ kind: 'work', completionPolicy: 'structured-result', organizationWorkItemId: work.id });
    expect(h.plane.work.getTask(projected.managerTaskId)?.completionPolicy).toBe('structured-result');
  });
});
