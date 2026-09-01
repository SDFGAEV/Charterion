import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';

const cleanups: Array<() => void> = [];
function harness(): ControlPlane {
  const dir = mkdtempSync(join(tmpdir(), 'charterion-runtime-acq-'));
  const database = new ControlDatabase(join(dir, 'global.db'));
  cleanups.push(() => { database.close(); rmSync(dir, { recursive: true, force: true }); });
  return new ControlPlane(database);
}

afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

function setup(plane: ControlPlane, withSlot = true) {
  const project = plane.createProject({ name: 'Runtime project', rootPath: 'E:/runtime-project', maxSlots: 2 }, 1);
  const slot = withSlot ? plane.createAgentSlot(project.id, 'ENGINEER', 2) : undefined;
  const organization = plane.organization.createOrganization({ name: 'Runtime org' }, 3);
  const agent = plane.organization.registerAgent({ organizationId: organization.id, displayName: 'Engineer' }, 4);
  const workspace = plane.organization.activeAgentWorkspace(agent.id)!;
  plane.organization.configureAgentWorkspace({
    workspaceId: workspace.id,
    rootRef: 'workspace://engineer',
    browserProfileId: 'profile-engineer',
    toolProfileRef: 'tools-engineer',
  }, 5);
  return { project, slot, organization, agent };
}

describe('OrganizationRuntimeAcquisitionAuthority', () => {
  it('provides idempotent, role-scoped acquisition and binds the selected idle slot', () => {
    const plane = harness();
    const { project, slot, organization, agent } = setup(plane);
    const input = { organizationId: organization.id, agentId: agent.id, projectId: project.id, role: 'ENGINEER', idempotencyKey: 'mission-1' };
    const requested = plane.organizationRuntime.request(input, 10);
    expect(plane.organizationRuntime.request(input, 11).id).toBe(requested.id);
    const acquired = plane.organizationRuntime.acquire(requested.id, 12);
    expect(acquired).toMatchObject({ status: 'acquired', runtimeSlotId: slot!.id });
    expect(plane.organization.getAgent(agent.id).runtimeSlotId).toBe(slot!.id);
    expect(plane.organizationRuntime.list(organization.id, project.id)).toHaveLength(1);
    expect(plane.listEvents(project.id).map((event) => event.type)).toContain('ORGANIZATION_RUNTIME_ACQUIRED');
  });

  it('creates capacity through the injected slot factory when no compatible idle slot exists', () => {
    const plane = harness();
    const { project, organization, agent } = setup(plane, false);
    const acquired = plane.organizationRuntime.requestAndAcquire({
      organizationId: organization.id, agentId: agent.id, projectId: project.id, role: 'RESEARCHER', idempotencyKey: 'mission-2',
    }, 10);
    expect(acquired.status).toBe('acquired');
    expect(acquired.runtimeSlotId).toBeTruthy();
    expect(plane.getAgentSlot(acquired.runtimeSlotId!).role).toBe('RESEARCHER');
  });

  it('fails closed before workspace readiness and supports explicit retry after recovery', () => {
    const plane = harness();
    const project = plane.createProject({ name: 'Blocked project', rootPath: 'E:/blocked', maxSlots: 1 }, 1);
    const organization = plane.organization.createOrganization({ name: 'Blocked org' }, 2);
    const agent = plane.organization.registerAgent({ organizationId: organization.id, displayName: 'Blocked' }, 3);
    const request = plane.organizationRuntime.request({
      organizationId: organization.id, agentId: agent.id, projectId: project.id, role: 'ENGINEER', idempotencyKey: 'mission-3',
    }, 4);
    const failed = plane.organizationRuntime.acquire(request.id, 5);
    expect(failed).toMatchObject({ status: 'failed' });
    const workspace = plane.organization.activeAgentWorkspace(agent.id)!;
    plane.organization.configureAgentWorkspace({
      workspaceId: workspace.id, rootRef: 'workspace://blocked', browserProfileId: 'profile-blocked', toolProfileRef: 'tools-blocked',
    }, 6);
    expect(plane.organizationRuntime.retry(request.id, 7).status).toBe('requested');
    expect(plane.organizationRuntime.acquire(request.id, 8).status).toBe('acquired');
  });  it('converges an acquiring record after a crash between runtime bind and ledger finalization', () => {
    const plane = harness();
    const { project, slot, organization, agent } = setup(plane);
    const request = plane.organizationRuntime.request({
      organizationId: organization.id, agentId: agent.id, projectId: project.id, role: 'ENGINEER', idempotencyKey: 'mission-4',
    }, 10);
    plane.database.db.prepare(
      "UPDATE organization_runtime_acquisitions SET status='acquiring' WHERE id=?",
    ).run(request.id);
    plane.organization.bindRuntimeSlot(agent.id, slot!.id, 11);
    const recovered = plane.organizationRuntime.acquire(request.id, 12);
    expect(recovered).toMatchObject({ status: 'acquired', runtimeSlotId: slot!.id });
  });

  it('releases idempotently and permits a later generation to acquire the same Agent', () => {
    const plane = harness();
    const { project, organization, agent } = setup(plane);
    const first = plane.organizationRuntime.requestAndAcquire({
      organizationId: organization.id, agentId: agent.id, projectId: project.id, role: 'ENGINEER', idempotencyKey: 'generation-1',
    }, 10);
    expect(plane.organizationRuntime.release(first.id, 11).status).toBe('released');
    expect(plane.organization.getAgent(agent.id).runtimeSlotId).toBeUndefined();
    expect(plane.organizationRuntime.release(first.id, 12).status).toBe('released');
    const second = plane.organizationRuntime.requestAndAcquire({
      organizationId: organization.id, agentId: agent.id, projectId: project.id, role: 'ENGINEER', idempotencyKey: 'generation-2',
    }, 13);
    expect(second.status).toBe('acquired');
  });

  it('enforces the acquired-state runtime-slot invariant at the database boundary', () => {
    const plane = harness();
    const { project, organization, agent } = setup(plane);
    const insert = plane.database.db.prepare(
      "INSERT INTO organization_runtime_acquisitions(id,organization_id,agent_id,project_id,role,idempotency_key,status,runtime_slot_id,error,created_at,updated_at) VALUES(?,?,?,?,?,?, 'acquired',NULL,NULL,?,?)",
    );
    expect(() => insert.run('corrupt-insert', organization.id, agent.id, project.id, 'ENGINEER', 'corrupt-insert', 10, 10)).toThrow(/requires a runtime slot/i);
    plane.database.db.prepare(
      "INSERT INTO organization_runtime_acquisitions(id,organization_id,agent_id,project_id,role,idempotency_key,status,runtime_slot_id,error,created_at,updated_at) VALUES(?,?,?,?,?,?, 'requested',NULL,NULL,?,?)",
    ).run('corrupt-update', organization.id, agent.id, project.id, 'ENGINEER', 'corrupt-update', 10, 10);
    expect(() => plane.database.db.prepare("UPDATE organization_runtime_acquisitions SET status='acquired' WHERE id=?").run('corrupt-update')).toThrow(/requires a runtime slot/i);
  });

  it('enforces cross-table project-role and Agent-binding invariants', () => {
    const plane = harness();
    const { project, slot, organization, agent } = setup(plane);
    const other = plane.createProject({ name: 'Other project', rootPath: 'E:/other-project', maxSlots: 1 }, 10);
    const wrongSlot = plane.createAgentSlot(other.id, 'ENGINEER', 11);
    plane.database.db.prepare(
      "INSERT INTO organization_runtime_acquisitions(id,organization_id,agent_id,project_id,role,idempotency_key,status,runtime_slot_id,error,created_at,updated_at) VALUES(?,?,?,?,?,?, 'requested',NULL,NULL,?,?)",
    ).run('cross-table', organization.id, agent.id, project.id, 'ENGINEER', 'cross-table', 12, 12);
    expect(() => plane.database.db.prepare("UPDATE organization_runtime_acquisitions SET status='acquired',runtime_slot_id=? WHERE id=?").run(wrongSlot.id, 'cross-table')).toThrow(/project and role intent/i);
    expect(() => plane.database.db.prepare("UPDATE organization_runtime_acquisitions SET status='acquired',runtime_slot_id=? WHERE id=?").run(slot!.id, 'cross-table')).toThrow(/not bound to the Organization Agent/i);
  });

  it('rejects a second live acquisition with a domain error instead of leaking SQLite constraints', () => {
    const plane = harness();
    const { project, organization, agent } = setup(plane);
    plane.organizationRuntime.request({
      organizationId: organization.id, agentId: agent.id, projectId: project.id, role: 'ENGINEER', idempotencyKey: 'live-1',
    }, 10);
    expect(() => plane.organizationRuntime.request({
      organizationId: organization.id, agentId: agent.id, projectId: project.id, role: 'REVIEWER', idempotencyKey: 'live-2',
    }, 11)).toThrow(/already has a live runtime acquisition/i);
  });

  it('rejects an idempotency key reused for a different runtime intent', () => {
    const plane = harness();
    const { project, organization, agent } = setup(plane);
    const input = { organizationId: organization.id, agentId: agent.id, projectId: project.id, role: 'ENGINEER', idempotencyKey: 'same-key' };
    plane.organizationRuntime.request(input, 10);
    expect(() => plane.organizationRuntime.request({ ...input, role: 'REVIEWER' }, 11)).toThrow(/different intent/i);
  });
});