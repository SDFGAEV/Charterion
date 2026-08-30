import { describe, expect, it } from 'vitest';
import { parseNativeControlSnapshot } from '../src/nativeControl';

function snapshot() {
  return {
    protocolVersion: 2,
    projects: [{ id: 'p', name: 'P', rootPath: 'E:/p', status: 'active', isolationTier: 'c1-container', minSlots: 1, maxSlots: 4, weight: 1 }],
    agents: [{ id: 'a', projectId: 'p', role: 'worker', status: 'assigned', desiredState: 'active', browserState: 'open', conversationKey: 'conversation:x', browserProfileId: 'gam-default', browserTabId: 7, browserObservedAt: 4, leaseEpoch: 2 }],
    resources: [{ id: 'r', projectId: 'p', kind: 'workspace', label: 'W', metadata: {} }],
    leases: [{ id: 'l', resourceId: 'r', projectId: 'p', holderId: 'a', mode: 'exclusive', epoch: 3, status: 'active' }],
    changeRequests: [{ id: 'cr', projectId: 'p', taskId: 'T1', authorSubject: 'worker', branch: 'gam/p/T1/A1', targetBranch: 'main', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), claimId: 'c', revision: 1, status: 'open' }],
    reviews: [{ id: 'rv', projectId: 'p', changeRequestId: 'cr', reviewerSubject: 'supervisor', headSha: 'b'.repeat(40), verdict: 'approve', body: 'ok', createdAt: 2 }],
    mergeQueue: [{ id: 'mq', projectId: 'p', changeRequestId: 'cr', headSha: 'b'.repeat(40), targetBranch: 'main', status: 'queued', queuedAt: 3, updatedAt: 3 }],
    workerRequests: [{ id: 'wr', projectId: 'p', taskId: 'T1', fromSubject: 'worker', type: 'suggestion', title: 'Split task', body: 'This should be parallelized', suggestedAction: 'spawn ROLE02', status: 'open', createdAt: 4, updatedAt: 4 }],
    browserRuntime: [{ profileId: 'gam-default', authStatus: 'authenticated', pageHealth: 'ready', openTabs: 3, extensionVersion: '0.4.0', observedAt: 4 }],
    events: [{ seq: 1, projectId: 'p', type: 'PROJECT_CREATED', subject: 'p', payload: {}, createdAt: 1 }],
  };
}

describe('native control snapshot parser', () => {
  it('accepts a typed control snapshot', () => {
    const parsed = parseNativeControlSnapshot(snapshot());
    expect(parsed.projects[0]?.name).toBe('P');
    expect(parsed.agents[0]?.leaseEpoch).toBe(2);
    expect(parsed.leases[0]?.mode).toBe('exclusive');
    expect(parsed.changeRequests[0]?.status).toBe('open');
    expect(parsed.reviews[0]?.verdict).toBe('approve');
  });

  it('rejects unknown protocol versions and enum drift', () => {
    expect(() => parseNativeControlSnapshot({ ...snapshot(), protocolVersion: 1 })).toThrow(/protocol/i);
    const bad = snapshot();
    bad.projects[0]!.status = 'mystery';
    expect(() => parseNativeControlSnapshot(bad)).toThrow(/project.status is invalid/);
  });

  it('rejects structurally incomplete native responses', () => {
    const bad = snapshot() as Record<string, unknown>;
    delete bad.resources;
    expect(() => parseNativeControlSnapshot(bad)).toThrow(/resources must be an array/);
  });
});
