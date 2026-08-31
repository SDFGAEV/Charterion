import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';

const cleanups: Array<() => void> = [];
function harness(): ControlPlane {
  const dir = mkdtempSync(join(tmpdir(), 'charterion-ingress-'));
  const database = new ControlDatabase(join(dir, 'global.db'));
  cleanups.push(() => { database.close(); rmSync(dir, { recursive: true, force: true }); });
  return new ControlPlane(database);
}
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

describe('WorkIngressAuthority', () => {
  it('accepts the same normalized work request from human or external AI without encoding task kind', () => {
    const plane = harness();
    const org = plane.organization.createOrganization({ name: 'General Company' }, 10);
    const human = plane.ingress.submit({ organizationId: org.id, requesterKind: 'human', requesterIdentity: 'human:owner', objective: 'Research a topic, write a paper, and create slides', desiredOutputs: ['paper', 'slides'], idempotencyKey: 'goal-1' }, 20);
    expect(human).toMatchObject({ status: 'received', requesterKind: 'human', desiredOutputs: ['paper','slides'] });
    const replay = plane.ingress.submit({ organizationId: org.id, requesterKind: 'human', requesterIdentity: 'human:owner', objective: 'Research a topic, write a paper, and create slides', desiredOutputs: ['paper', 'slides'], idempotencyKey: 'goal-1' }, 21);
    expect(replay.id).toBe(human.id);
    expect(() => plane.ingress.submit({ organizationId: org.id, requesterKind: 'human', requesterIdentity: 'human:owner', objective: 'Different objective', idempotencyKey: 'goal-1' }, 22)).toThrow(/different payload/i);
  });

  it('atomically materializes accepted external work into one Mission and top-level Work item', () => {
    const plane = harness();
    const org = plane.organization.createOrganization({ name: 'Company' }, 10);
    const dep = plane.organization.createDepartment({ organizationId: org.id, name: 'Research' }, 11);
    const agent = plane.organization.registerAgent({ organizationId: org.id, displayName: 'Researcher A', primaryDepartmentId: dep.id }, 12);
    const request = plane.ingress.submit({ organizationId: org.id, requesterKind: 'external-ai', requesterIdentity: 'external-ai:planner', objective: 'Investigate memory methods', contextRefs: ['https://example.invalid/task'], priority: 'high' }, 20);
    const accepted = plane.ingress.accept({ requestId: request.id, acceptedBy: 'human:owner', driAgentId: agent.id }, 30);
    expect(accepted.status).toBe('accepted');
    expect(accepted.missionId).toBeTruthy();
    const mission = plane.ingress.missionFor(request.id)!;
    expect(mission).toMatchObject({ status: 'active', driAgentId: agent.id, sourceRequestId: request.id });
    expect(plane.ingress.workFor(request.id)).toEqual([
      expect.objectContaining({ missionId: mission.id, ownerAgentId: agent.id, status: 'ready', objective: 'Investigate memory methods' }),
    ]);
    expect(plane.ingress.accept({ requestId: request.id, acceptedBy: 'another-reviewer' }, 31).missionId).toBe(mission.id);
  });

  it('stores only outcome references and lets the Mission close when its Work closes', () => {
    const plane = harness();
    const org = plane.organization.createOrganization({ name: 'Company' }, 10);
    const dep = plane.organization.createDepartment({ organizationId: org.id, name: 'General' }, 11);
    const agent = plane.organization.registerAgent({ organizationId: org.id, displayName: 'Agent A', primaryDepartmentId: dep.id }, 12);
    const request = plane.ingress.submit({ organizationId: org.id, requesterKind: 'human', requesterIdentity: 'human:owner', objective: 'Produce any useful deliverable' }, 20);
    plane.ingress.accept({ requestId: request.id, acceptedBy: 'human:owner', driAgentId: agent.id }, 30);
    const work = plane.ingress.workFor(request.id)[0]!;
    const outcome = plane.ingress.completeWorkItem({ workItemId: work.id, completedBy: agent.id, summary: 'Delivered', producedRefs: ['file:E:/shared/report.pdf','url:https://example.invalid/result'] }, 40);
    expect(outcome).toMatchObject({ summary: 'Delivered', producedRefs: ['file:E:/shared/report.pdf','url:https://example.invalid/result'] });
    expect(plane.organization.getWorkItem(work.id).status).toBe('completed');
    expect(plane.ingress.missionFor(request.id)?.status).toBe('completed');
    expect(plane.ingress.completeWorkItem({ workItemId: work.id, completedBy: agent.id, summary: 'ignored replay' }, 50)).toEqual(outcome);
  });

  it('rejects completion by an unrelated Agent', () => {
    const plane = harness();
    const org = plane.organization.createOrganization({ name: 'Company' }, 10);
    const a = plane.organization.registerAgent({ organizationId: org.id, displayName: 'A' }, 11);
    const b = plane.organization.registerAgent({ organizationId: org.id, displayName: 'B' }, 12);
    const request = plane.ingress.submit({ organizationId: org.id, requesterKind: 'human', requesterIdentity: 'human:owner', objective: 'Do work' }, 20);
    plane.ingress.accept({ requestId: request.id, acceptedBy: 'human:owner', driAgentId: a.id }, 30);
    const work = plane.ingress.workFor(request.id)[0]!;
    expect(() => plane.ingress.completeWorkItem({ workItemId: work.id, completedBy: b.id, summary: 'claim' }, 40)).toThrow(/owner or Mission DRI/i);
  });
});
