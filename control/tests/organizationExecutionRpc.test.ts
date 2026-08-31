import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';
import { RpcRouter } from '../src/rpc';

const cleanups: Array<() => void> = [];
function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'charterion-org-exec-rpc-'));
  const db = new ControlDatabase(join(dir, 'state.db'));
  const plane = new ControlPlane(db);
  const router = new RpcRouter(plane, 'admin', 'browser');
  const project = plane.createProject({ name: 'Charterion', rootPath: 'E:/charterion' }, 1);
  const slot = plane.createAgentSlot(project.id, 'CONTROL_ENGINEER_A', 2);
  const org = plane.organization.createOrganization({ name: 'Charterion Engineering' }, 3);
  const department = plane.organization.createDepartment({ organizationId: org.id, name: 'Control Plane' }, 4);
  const agent = plane.organization.registerAgent({ organizationId: org.id, displayName: 'Control Engineer A', primaryDepartmentId: department.id }, 5);
  const workspace = plane.organization.activeAgentWorkspace(agent.id)!;
  plane.organization.configureAgentWorkspace({
    workspaceId: workspace.id, rootRef: 'workspace://control-a', browserProfileId: 'profile-control-a',
    toolProfileRef: 'tools-control-a', allowedRefs: ['project://charterion'], forbiddenRefs: ['authority://parent'],
  }, 6);
  plane.organization.bindRuntimeSlot(agent.id, slot.id, 7);
  const mission = plane.organization.createMission({
    organizationId: org.id, projectId: project.id, title: 'Self evolve', objective: 'Improve dispatch safely.', driAgentId: agent.id,
  }, 8);
  plane.organization.setMissionStatus(mission.id, 'active', 9);
  const work = plane.organization.createWorkItem({
    missionId: mission.id, title: 'Native organization dispatch', objective: 'Expose exact Candidate-native execution projection.', ownerAgentId: agent.id,
  }, 10);
  plane.organization.setWorkStatus(work.id, 'ready', 11);
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { plane, router, project, slot, agent, mission, work };
}
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

describe('Organization execution RPC', () => {
  it('allows browser/admin to project exactly one authoritative WorkItem idempotently', () => {
    const h = harness();
    const denied = h.router.handle({ id: 'denied', method: 'org-work.project-execution', params: { workItemId: h.work.id } });
    expect(denied.ok).toBe(false);
    const first = h.router.handle({ id: 'browser', method: 'org-work.project-execution', auth: { browserToken: 'browser' }, params: {
      workItemId: h.work.id, targetRole: 'ATTACKER', projectId: 'wrong', ownerAgentId: 'wrong',
    } });
    expect(first).toMatchObject({ ok: true, result: {
      workItemId: h.work.id, missionId: h.mission.id, organizationAgentId: h.agent.id,
      projectId: h.project.id, runtimeSlotId: h.slot.id, managerTaskId: `org-work-${h.work.id}`,
      task: { targetRole: 'CONTROL_ENGINEER_A', projectId: h.project.id, organizationWorkItemId: h.work.id },
    } });
    const revision = h.plane.work.snapshot().revision;
    const again = h.router.handle({ id: 'admin', method: 'org-work.project-execution', auth: { adminToken: 'admin' }, params: { workItemId: h.work.id } });
    expect(again).toMatchObject({ ok: true, result: { managerTaskId: `org-work-${h.work.id}` } });
    expect(h.plane.work.snapshot().revision).toBe(revision);
  });

  it('fails closed when the persistent Agent runtime slot belongs to another Project', () => {
    const h = harness();
    const other = h.plane.createProject({ name: 'Other', rootPath: 'E:/other' }, 12);
    const wrongSlot = h.plane.createAgentSlot(other.id, 'CONTROL_ENGINEER_A', 13);
    h.plane.organization.unbindRuntimeSlot(h.agent.id, 14);
    h.plane.organization.bindRuntimeSlot(h.agent.id, wrongSlot.id, 15);
    const response = h.router.handle({ id: 'wrong-project', method: 'org-work.project-execution', auth: { browserToken: 'browser' }, params: { workItemId: h.work.id } });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.message).toContain('another Project');
    expect(h.plane.work.getTask(`org-work-${h.work.id}`)).toBeUndefined();
  });
});
