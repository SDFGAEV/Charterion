import { describe, expect, it, vi } from 'vitest';
import type { ControlPlane } from '../src/controlPlane';
import type { CapabilityGrant, SelfHostingPromotion } from '../src/contracts';
import { RpcRouter } from '../src/rpc';

const promotion: SelfHostingPromotion = {
  id: 'promotion-1', projectId: 'project-1', idempotencyKey: 'key-1', claimId: 'claim-1',
  candidateSubject: 'candidate-author', candidateSha: 'a'.repeat(40), targetRef: 'refs/heads/main',
  expectedParentSha: 'b'.repeat(40), requestedBy: 'requester', status: 'pending', createdAt: 1, updatedAt: 1,
};

function grant(taskBound: boolean): CapabilityGrant {
  return {
    id: 'cap-1', subject: 'promotion-authority', projectId: 'project-1',
    scopes: ['promotion:decide'], resourceIds: [], expiresAt: Date.now() + 60_000, createdAt: 1,
    ...(taskBound ? { taskId: 'candidate-task' } : {}),
  };
}

function routerFor(taskBound: boolean) {
  const decide = vi.fn(() => ({ ...promotion, status: 'approved' as const, decisionBy: 'promotion-authority' }));
  const plane = {
    promotions: { get: vi.fn(() => promotion), decide },
    verifyCapability: vi.fn(() => grant(taskBound)),
  } as unknown as ControlPlane;
  return { router: new RpcRouter(plane, 'admin-token', 'browser-token', 'instance-1'), decide };
}

function request() {
  return {
    id: 'rpc-1', method: 'promotion.decide', instanceId: 'instance-1',
    auth: { capabilityToken: 'capability-token' },
    params: {
      promotionId: promotion.id, authoritySubject: 'promotion-authority', decision: 'approve', reason: 'independent review passed',
    },
  };
}

describe('promotion RPC authority', () => {
  it('rejects task-bound capabilities as promotion decision authority', () => {
    const { router, decide } = routerFor(true);
    const response = router.handle(request());
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.message).toMatch(/task-bound capability cannot decide/i);
    expect(decide).not.toHaveBeenCalled();
  });

  it('allows a task-independent promotion authority capability', () => {
    const { router, decide } = routerFor(false);
    const response = router.handle(request());
    expect(response.ok).toBe(true);
    expect(decide).toHaveBeenCalledTimes(1);
  });
});
