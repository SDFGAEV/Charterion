import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';

const cleanups: Array<() => void> = [];
function harness(): ControlPlane {
  const dir = mkdtempSync(join(tmpdir(), 'charterion-org-'));
  const database = new ControlDatabase(join(dir, 'global.db'));
  cleanups.push(() => { database.close(); rmSync(dir, { recursive: true, force: true }); });
  return new ControlPlane(database);
}
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

function readyWorkspace(plane: ControlPlane, agentId: string, now: number) {
  const workspace = plane.organization.activeAgentWorkspace(agentId);
  if (!workspace) throw new Error('expected auto-requested workspace');
  return plane.organization.configureAgentWorkspace({
    workspaceId: workspace.id,
    rootRef: `workspace://${agentId}`,
    browserProfileId: `profile-${agentId}`,
    toolProfileRef: `tools-${agentId}`,
    endpointRefs: [`remote://${agentId}`],
    allowedRefs: [`workspace://${agentId}`, 'project://assigned'],
    forbiddenRefs: ['charterion://control-state', 'workspace://other-agents', 'host://system'],
  }, now);
}

describe('OrganizationAuthority', () => {
  it('builds durable organization, department, domain and persistent Agent identity independently of runtime slots', () => {
    const plane = harness();
    const org = plane.organization.createOrganization({ name: 'Acme Research', purpose: 'general intelligent work' }, 10);
    const department = plane.organization.createDepartment({ organizationId: org.id, name: 'Research' }, 20);
    const domain = plane.organization.createDomain({ organizationId: org.id, departmentId: department.id, name: 'Agent Systems' }, 30);
    const agent = plane.organization.registerAgent({ organizationId: org.id, displayName: 'Researcher A', primaryDepartmentId: department.id }, 40);
    expect(agent.runtimeSlotId).toBeUndefined();
    expect(plane.organization.assignAgentDomain(agent.id, domain.id, 'primary', 50)).toMatchObject({ agentId: agent.id, domainId: domain.id, responsibility: 'primary' });
    expect(plane.organization.snapshot()).toMatchObject({ organizations: [{ id: org.id }], departments: [{ id: department.id }], domains: [{ id: domain.id }], agents: [{ id: agent.id }] });
  });

  it('keeps one Mission DRI while allowing multiple contributors and tool-agnostic Work', () => {
    const plane = harness();
    const org = plane.organization.createOrganization({ name: 'Company' }, 10);
    const dep = plane.organization.createDepartment({ organizationId: org.id, name: 'General' }, 20);
    const a = plane.organization.registerAgent({ organizationId: org.id, displayName: 'Agent A', primaryDepartmentId: dep.id }, 30);
    const b = plane.organization.registerAgent({ organizationId: org.id, displayName: 'Agent B', primaryDepartmentId: dep.id }, 31);
    const mission = plane.organization.createMission({ organizationId: org.id, title: 'Prepare research package', objective: 'Research, write a paper and make slides', driAgentId: a.id }, 40);
    plane.organization.addMissionMember(mission.id, b.id, 'contributor', 41);
    expect(plane.organization.assignMissionDri(mission.id, b.id, 50).driAgentId).toBe(b.id);
    expect(plane.organization.setMissionStatus(mission.id, 'active', 60).status).toBe('active');
    readyWorkspace(plane, b.id, 65);
    const work = plane.organization.createWorkItem({ missionId: mission.id, title: 'Deliver result', objective: 'Use any legitimate tools needed', ownerAgentId: b.id }, 70);
    expect(plane.organization.setWorkStatus(work.id, 'active', 80).status).toBe('active');
  });

  it('rejects cross-organization ownership and runtime-slot aliasing', () => {
    const plane = harness();
    const project = plane.createProject({ name: 'Repo', rootPath: 'E:\\repo' }, 5);
    const slot = plane.createAgentSlot(project.id, 'ENGINEER_A', 6);
    const orgA = plane.organization.createOrganization({ name: 'A' }, 10);
    const orgB = plane.organization.createOrganization({ name: 'B' }, 11);
    const depA = plane.organization.createDepartment({ organizationId: orgA.id, name: 'A-Dept' }, 12);
    const depB = plane.organization.createDepartment({ organizationId: orgB.id, name: 'B-Dept' }, 13);
    const domainB = plane.organization.createDomain({ organizationId: orgB.id, departmentId: depB.id, name: 'B-Domain' }, 14);
    const a1 = plane.organization.registerAgent({ organizationId: orgA.id, displayName: 'A1', primaryDepartmentId: depA.id }, 20);
    const a2 = plane.organization.registerAgent({ organizationId: orgA.id, displayName: 'A2', primaryDepartmentId: depA.id }, 21);
    expect(() => plane.organization.assignAgentDomain(a1.id, domainB.id, 'primary', 30)).toThrow(/different organizations/i);
    readyWorkspace(plane, a1.id, 30);
    readyWorkspace(plane, a2.id, 30);
    expect(plane.organization.bindRuntimeSlot(a1.id, slot.id, 31).runtimeSlotId).toBe(slot.id);
    expect(() => plane.reportAgentBrowser({ slotId: slot.id, profileId: 'wrong-profile', browserState: 'opening', tabId: 1 }, 31)).toThrow(/browser profile.*workspace/i);
    expect(() => plane.organization.bindRuntimeSlot(a2.id, slot.id, 32)).toThrow(/already bound/i);
  });
});

describe('Dedicated Agent workspace policy', () => {
  it('auto-requests prompt-guarded workspace and blocks runtime use before configuration', () => {
    const plane = harness();
    const project = plane.createProject({ name: 'Repo', rootPath: 'E:\\repo' }, 1);
    const slot = plane.createAgentSlot(project.id, 'ENGINEER', 2);
    const org = plane.organization.createOrganization({ name: 'Company' }, 3);
    const agent = plane.organization.registerAgent({ organizationId: org.id, displayName: 'A' }, 4);
    const workspace = plane.organization.activeAgentWorkspace(agent.id)!;
    expect(workspace).toMatchObject({ generation: 1, securityMode: 'prompt-guarded', status: 'configuring', toolPolicyState: 'unconfigured' });
    expect(() => plane.organization.bindRuntimeSlot(agent.id, slot.id, 5)).toThrow(/ready dedicated workspace/i);
  });

  it('compiles a deterministic workspace charter with scope and dangerous-action rules', () => {
    const plane = harness();
    const org = plane.organization.createOrganization({ name: 'Company' }, 1);
    const agent = plane.organization.registerAgent({ organizationId: org.id, displayName: 'A' }, 2);
    const ready = readyWorkspace(plane, agent.id, 3);
    expect(ready.workspaceCharterDigest).toMatch(/^[a-f0-9]{64}$/);
    const prompt = plane.organization.workspacePrompt(ready.id);
    expect(prompt).toContain(`Workspace root: workspace://${agent.id}`);
    expect(prompt).toContain('charterion://control-state');
    expect(prompt).toContain('require an explicit approval reference');
    expect(prompt).toContain('do not treat the absence of a hard sandbox as permission to leave scope');
  });

  it('requires configured tool policy before claiming tool-scoped enforcement', () => {
    const plane = harness();
    const org = plane.organization.createOrganization({ name: 'Company' }, 1);
    const agent = plane.organization.registerAgent({ organizationId: org.id, displayName: 'A' }, 2);
    const workspace = plane.organization.activeAgentWorkspace(agent.id)!;
    const base = { workspaceId: workspace.id, securityMode: 'tool-scoped' as const, rootRef: 'workspace://a', browserProfileId: 'profile-a', toolProfileRef: 'tools-a' };
    expect(() => plane.organization.configureAgentWorkspace({ ...base, toolPolicyState: 'unsupported' }, 3)).toThrow(/requires configured tool policy/i);
    expect(plane.organization.configureAgentWorkspace({ ...base, toolPolicyState: 'configured' }, 4)).toMatchObject({ status: 'ready', securityMode: 'tool-scoped', toolPolicyState: 'configured' });
  });

  it('replaces workspace generations without replacing persistent Agent identity', () => {
    const plane = harness();
    const org = plane.organization.createOrganization({ name: 'Company' }, 1);
    const agent = plane.organization.registerAgent({ organizationId: org.id, displayName: 'A' }, 2);
    const first = readyWorkspace(plane, agent.id, 3);
    plane.organization.retireAgentWorkspace(first.id, 'rebuild policy', 4);
    const second = plane.organization.requestAgentWorkspace({ agentId: agent.id }, 5);
    expect(second).toMatchObject({ agentId: agent.id, generation: 2, securityMode: 'prompt-guarded', status: 'configuring' });
    expect(plane.organization.getAgent(agent.id).id).toBe(agent.id);
  });

  it('does not let live Agent workspaces share one browser or tool profile', () => {
    const plane = harness();
    const org = plane.organization.createOrganization({ name: 'Company' }, 1);
    const a = plane.organization.registerAgent({ organizationId: org.id, displayName: 'A' }, 2);
    const b = plane.organization.registerAgent({ organizationId: org.id, displayName: 'B' }, 3);
    const wa = plane.organization.activeAgentWorkspace(a.id)!;
    const wb = plane.organization.activeAgentWorkspace(b.id)!;
    plane.organization.configureAgentWorkspace({ workspaceId: wa.id, rootRef: 'workspace://a', browserProfileId: 'profile-a', toolProfileRef: 'tools-a' }, 4);
    expect(() => plane.organization.configureAgentWorkspace({ workspaceId: wb.id, rootRef: 'workspace://b', browserProfileId: 'profile-a', toolProfileRef: 'tools-b' }, 5)).toThrow(/unique/i);
  });
});