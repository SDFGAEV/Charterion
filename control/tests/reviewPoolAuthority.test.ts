import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
function commit(root: string, message: string, text: string): string {
  writeFileSync(join(root, 'work.txt'), text); git(root, 'add', 'work.txt'); git(root, 'commit', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}
function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'charterion-review-pool-'));
  const repo = join(dir, 'repo');
  const database = new ControlDatabase(join(dir, 'global.db'));
  const init = spawnSync(gitPath, ['init', '-b', 'main', repo], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (init.status !== 0) throw new Error(init.stderr);
  git(repo, 'config', 'user.name', 'Charterion Test'); git(repo, 'config', 'user.email', 'test@example.invalid');
  const baseSha = commit(repo, 'base', 'base\n'); git(repo, 'switch', '-c', 'change/review-pool');
  const headSha = commit(repo, 'head', 'head\n');
  const plane = new ControlPlane(database, gitPath);
  const project = plane.createProject({ name: 'Repo', rootPath: repo });
  const org = plane.organization.createOrganization({ name: 'Company' });
  const dep = plane.organization.createDepartment({ organizationId: org.id, name: 'Control' });
  const domain = plane.organization.createDomain({ organizationId: org.id, departmentId: dep.id, name: 'Persistence' });
  const author = plane.organization.registerAgent({ organizationId: org.id, displayName: 'Author', primaryDepartmentId: dep.id });
  const maintainer = plane.organization.registerAgent({ organizationId: org.id, displayName: 'Maintainer', primaryDepartmentId: dep.id });
  const peer = plane.organization.registerAgent({ organizationId: org.id, displayName: 'Peer', primaryDepartmentId: dep.id });
  plane.organization.assignAgentDomain(maintainer.id, domain.id, 'primary');
  const resource = plane.declareResource({ projectId: project.id, kind: 'workspace', label: 'change' });
  const lease = plane.acquireLease({ resourceId: resource.id, projectId: project.id, holderId: author.id, taskId: 'T1', mode: 'exclusive', ttlMs: 60_000 });
  const claim = plane.evidence.submitClaim({ projectId: project.id, taskId: 'T1', subject: author.id, resourceId: resource.id, leaseEpoch: lease.epoch, summary: 'ready', commitSha: headSha });
  expect(plane.evidence.verifyClaim(claim.id).status).toBe('passed');
  const cr = plane.changes.open({
    projectId: project.id, taskId: 'T1', subject: author.id, branch: 'change/review-pool', targetBranch: 'main',
    baseSha, headSha, claimId: claim.id,
  });
  cleanups.push(() => { database.close(); rmSync(dir, { recursive: true, force: true }); });
  return { plane, project, org, domain, author, maintainer, peer, cr, claim };
}
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

describe('pull-based Review Pool', () => {
  it('offers exact-head review slots only to eligible independent Agents', () => {
    const h = harness();
    const request = h.plane.reviewPool.open({
      organizationId: h.org.id, changeRequestId: h.cr.id, risk: 'high',
      slots: [{ dimension: 'peer' }, { dimension: 'domain-maintainer', requiredDomainId: h.domain.id }],
    }, 100);
    expect(request).toMatchObject({ headSha: h.cr.headSha, revision: 1, status: 'open', risk: 'high' });
    expect(h.plane.reviewPool.queueForAgent(h.author.id, 110)).toHaveLength(0);
    expect(h.plane.reviewPool.queueForAgent(h.peer.id, 110).map((item) => item.slot.dimension)).toEqual(['peer']);
    expect(h.plane.reviewPool.queueForAgent(h.maintainer.id, 110).map((item) => item.slot.dimension).sort()).toEqual(['domain-maintainer', 'peer']);

    const slots = h.plane.reviewPool.listSlots(request.id);
    const peerSlot = slots.find((slot) => slot.dimension === 'peer')!;
    const domainSlot = slots.find((slot) => slot.dimension === 'domain-maintainer')!;
    expect(() => h.plane.reviewPool.claim({ slotId: domainSlot.id, reviewerAgentId: h.peer.id }, 111)).toThrow(/not eligible/i);
    expect(h.plane.reviewPool.claim({ slotId: peerSlot.id, reviewerAgentId: h.peer.id }, 112).state).toBe('claimed');
    expect(h.plane.reviewPool.claim({ slotId: domainSlot.id, reviewerAgentId: h.maintainer.id }, 113).state).toBe('claimed');

    expect(h.plane.reviewPool.decide({ slotId: peerSlot.id, reviewerAgentId: h.peer.id, decision: 'approve', note: 'looks correct' }, 114).request.status).toBe('open');
    expect(h.plane.reviewPool.decide({ slotId: domainSlot.id, reviewerAgentId: h.maintainer.id, decision: 'approve', note: 'domain invariants hold' }, 115).request.status).toBe('approved');
  }, 30_000);
});
