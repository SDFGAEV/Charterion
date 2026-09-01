import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { ControlPlane } from '../src/controlPlane';

const cleanups: Array<() => void> = [];
function harness(): ControlPlane {
  const dir = mkdtempSync(join(tmpdir(), 'charterion-findings-'));
  const database = new ControlDatabase(join(dir, 'global.db'));
  cleanups.push(() => { database.close(); rmSync(dir, { recursive: true, force: true }); });
  return new ControlPlane(database);
}
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

describe('FindingAuthority', () => {
  it('deduplicates independent discoveries and preserves all evidence', () => {
    const plane = harness();
    const org = plane.organization.createOrganization({ name: 'Company' }, 1);
    const dep = plane.organization.createDepartment({ organizationId: org.id, name: 'Control' }, 2);
    const domain = plane.organization.createDomain({ organizationId: org.id, departmentId: dep.id, name: 'Persistence' }, 3);
    const a = plane.organization.registerAgent({ organizationId: org.id, displayName: 'A', primaryDepartmentId: dep.id }, 4);
    const b = plane.organization.registerAgent({ organizationId: org.id, displayName: 'B', primaryDepartmentId: dep.id }, 5);
    const first = plane.findings.discover({
      organizationId: org.id, domainId: domain.id, title: 'Conversation projection leak',
      symptom: ' Old slot still owns the canonical conversation ', locations: ['E:\\repo\\control\\src\\conversation.ts'],
      observerSubject: a.id, evidenceRefs: ['test:first'], note: 'found during continuity work',
    }, 10);
    const second = plane.findings.discover({
      organizationId: org.id, domainId: domain.id, title: 'conversation projection leak',
      symptom: 'old slot still owns the canonical conversation', locations: ['e:/repo/control/src/conversation.ts'],
      observerSubject: b.id, evidenceRefs: ['log:second'], note: 'independent reproduction',
    }, 11);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.finding.id).toBe(first.finding.id);
    expect(plane.findings.list(org.id)).toHaveLength(1);
    expect(plane.findings.listEvidence(first.finding.id)).toMatchObject([
      { observerSubject: a.id, evidenceRefs: ['test:first'] },
      { observerSubject: b.id, evidenceRefs: ['log:second'] },
    ]);
    const owned = plane.findings.claim({ findingId: first.finding.id, agentId: a.id }, 12);
    expect(owned).toMatchObject({ owningAgentId: a.id, owningDepartmentId: dep.id, status: 'owned' });
    expect(() => plane.findings.claim({ findingId: first.finding.id, agentId: b.id }, 13)).toThrow(/authoritative owner/i);
    expect(plane.findings.setStatus(first.finding.id, 'in-progress', 14).status).toBe('in-progress');
    expect(plane.findings.setStatus(first.finding.id, 'resolved', 15).status).toBe('resolved');
  });
});
