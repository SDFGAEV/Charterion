import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';
import { RpcRouter } from '../src/rpc';

const cleanups: Array<() => void> = [];
function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'charterion-org-rpc-'));
  const db = new ControlDatabase(join(dir, 'state.db'));
  const plane = new ControlPlane(db);
  const router = new RpcRouter(plane, 'admin', 'browser');
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { plane, router };
}
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

describe('organization and external work ingress RPC', () => {
  it('accepts project-scoped external-AI work without granting admin authority', () => {
    const h = harness();
    const project = h.plane.createProject({ name: 'General Project', rootPath: 'E:/general' });
    const orgResponse = h.router.handle({ id: 'org', method: 'organization.create', auth: { adminToken: 'admin' }, params: { name: 'Company' } });
    expect(orgResponse.ok).toBe(true);
    if (!orgResponse.ok) return;
    const organizationId = (orgResponse.result as { id: string }).id;
    const external = h.plane.issueCapability({ subject: 'external-ai:planner', projectId: project.id, scopes: ['work:submit','work:read'], ttlMs: 60_000 });
    const submitted = h.router.handle({ id: 'submit', method: 'work-request.submit', auth: { capabilityToken: external.token }, params: {
      organizationId, projectId: project.id, requesterKind: 'external-ai', requesterIdentity: 'external-ai:planner',
      objective: 'Research memory methods and produce a report', desiredOutputs: ['report'], idempotencyKey: 'req-1',
    } });
    expect(submitted).toMatchObject({ ok: true, result: { status: 'received', requesterKind: 'external-ai' } });
    if (!submitted.ok) return;
    const requestId = (submitted.result as { id: string }).id;

    const forbiddenOrgCreate = h.router.handle({ id: 'forbidden', method: 'organization.create', auth: { capabilityToken: external.token }, params: { name: 'Escalation' } });
    expect(forbiddenOrgCreate.ok).toBe(false);

    const department = h.plane.organization.createDepartment({ organizationId, name: 'Research' });
    const agent = h.plane.organization.registerAgent({ organizationId, displayName: 'Researcher A', primaryDepartmentId: department.id });
    const accepted = h.router.handle({ id: 'accept', method: 'work-request.accept', auth: { adminToken: 'admin' }, params: {
      requestId, acceptedBy: 'human:owner', driAgentId: agent.id, completionPolicy: 'structured-result',
    } });
    expect(accepted).toMatchObject({ ok: true, result: { status: 'accepted' } });

    const inspected = h.router.handle({ id: 'inspect', method: 'work-request.get', auth: { capabilityToken: external.token }, params: { requestId } });
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    const workItem = (inspected.result as { workItems: Array<{ id: string; completionPolicy: string }> }).workItems[0]!;
    const workItemId = workItem.id;
    expect(workItem.completionPolicy).toBe('structured-result');

    const worker = h.plane.issueCapability({ subject: agent.id, projectId: project.id, scopes: ['work:complete'], ttlMs: 60_000 });
    const completed = h.router.handle({ id: 'complete', method: 'org-work.complete', auth: { capabilityToken: worker.token }, params: {
      workItemId, completedBy: agent.id, summary: 'Finished with direct tools', producedRefs: ['file:E:/shared/report.pdf'],
    } });
    expect(completed).toMatchObject({ ok: true, result: { summary: 'Finished with direct tools', producedRefs: ['file:E:/shared/report.pdf'] } });

    const final = h.router.handle({ id: 'final', method: 'work-request.get', auth: { capabilityToken: external.token }, params: { requestId } });
    expect(final).toMatchObject({ ok: true, result: { mission: { status: 'completed' }, workItems: [{ status: 'completed' }] } });
  });
});


describe('Agent workspace RPC authority', () => {
  it('keeps workspace policy configuration admin-controlled and exposes the compiled charter', () => {
    const h = harness();
    const org = h.plane.organization.createOrganization({ name: 'Company' });
    const agent = h.plane.organization.registerAgent({ organizationId: org.id, displayName: 'A' });
    const workspace = h.plane.organization.activeAgentWorkspace(agent.id)!;

    const unauthenticated = h.router.handle({ id: 'x', method: 'org-agent.workspace-configure', params: {
      workspaceId: workspace.id, rootRef: 'workspace://a', browserProfileId: 'profile-a', toolProfileRef: 'tools-a',
    } });
    expect(unauthenticated.ok).toBe(false);

    const invalidScoped = h.router.handle({ id: 'invalid', method: 'org-agent.workspace-configure', auth: { adminToken: 'admin' }, params: {
      workspaceId: workspace.id, securityMode: 'tool-scoped', toolPolicyState: 'unsupported', rootRef: 'workspace://a', browserProfileId: 'profile-a', toolProfileRef: 'tools-a',
    } });
    expect(invalidScoped.ok).toBe(false);

    const ready = h.router.handle({ id: 'ready', method: 'org-agent.workspace-configure', auth: { adminToken: 'admin' }, params: {
      workspaceId: workspace.id, rootRef: 'workspace://a', browserProfileId: 'profile-a', toolProfileRef: 'tools-a',
      endpointRefs: ['remote://a'], allowedRefs: ['project://assigned'], forbiddenRefs: ['host://system'],
    } });
    expect(ready).toMatchObject({ ok: true, result: { status: 'ready', securityMode: 'prompt-guarded', endpointRefs: ['remote://a'] } });

    const prompt = h.router.handle({ id: 'prompt', method: 'org-agent.workspace-prompt', auth: { browserToken: 'browser' }, params: { workspaceId: workspace.id } });
    expect(prompt.ok).toBe(true);
    if (prompt.ok) expect(String(prompt.result)).toContain('host://system');
  });
});