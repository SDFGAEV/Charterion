import { describe, expect, it } from 'vitest';
import {
  CapabilityRegistry,
  assertOperationAllowed,
  invokeCapability,
  type CapabilityProvider,
  type OperationRequest,
} from '../src/capabilityContracts';

const descriptor = {
  capabilityId: 'filesystem',
  providerId: 'local',
  operations: ['read'],
  inputSchema: { name: 'ReadInput', version: 1 },
  outputSchema: { name: 'ReadOutput', version: 1 },
  effectClass: 'read-only' as const,
  authorityRequirements: ['observe'],
  recoverability: 'idempotent' as const,
  observability: 'receipt-and-evidence' as const,
};

function request(overrides: Partial<OperationRequest> = {}): OperationRequest {
  return {
    requestId: 'req-1', capabilityId: 'filesystem', operationId: 'read', actorId: 'agent-1',
    resourceRefs: ['file:a'], idempotencyKey: 'idem-1', effectClass: 'read-only',
    authoritySnapshot: ['observe'], payload: { path: 'a' }, requestedAt: 1, ...overrides,
  };
}
describe('capability contracts', () => {
  it('registers typed providers and rejects duplicate capability identities', () => {
    const registry = new CapabilityRegistry();
    const provider = { descriptor, invoke: async () => ({ requestId: 'req-1', capabilityId: 'filesystem', operationId: 'read', outcome: 'completed' as const, retryable: false, evidenceRefs: [], artifactRefs: [], observedAt: 2 }) } as CapabilityProvider;
    registry.register(provider);
    expect(registry.list()).toEqual([descriptor]);
    expect(() => registry.register(provider)).toThrow('already registered');
  });

  it('keeps capability, authority, and operation effect checks independent', () => {
    expect(() => assertOperationAllowed(descriptor, request({ authoritySnapshot: [] }))).toThrow('Missing authority');
    expect(() => assertOperationAllowed(descriptor, request({ operationId: 'write' }))).toThrow('not declared');
    expect(() => assertOperationAllowed(descriptor, request({ effectClass: 'reversible' }))).toThrow('effect class');
  });

  it('returns a receipt and rejects forged or incomplete provider receipts', async () => {
    const provider: CapabilityProvider = {
      descriptor,
      invoke: async () => ({ requestId: 'req-1', capabilityId: 'filesystem', operationId: 'read', outcome: 'completed', retryable: false, output: { text: 'ok' }, evidenceRefs: ['e1'], artifactRefs: [], observedAt: 2 }),
    };
    await expect(invokeCapability(provider, request())).resolves.toMatchObject({ outcome: 'completed', evidenceRefs: ['e1'] });
    const bad: CapabilityProvider = { ...provider, invoke: async () => ({ ...await provider.invoke(request()), requestId: 'other' }) };
    await expect(invokeCapability(bad, request())).rejects.toThrow('requestId mismatch');
  });

  it('requires an error for failed receipts and permits uncertain outcomes', async () => {
    const failed: CapabilityProvider = { descriptor, invoke: async () => ({ requestId: 'req-1', capabilityId: 'filesystem', operationId: 'read', outcome: 'failed', retryable: true, evidenceRefs: [], artifactRefs: [], observedAt: 2 }) };
    await expect(invokeCapability(failed, request())).rejects.toThrow('requires an error');
    const uncertain: CapabilityProvider = { descriptor, invoke: async () => ({ requestId: 'req-1', capabilityId: 'filesystem', operationId: 'read', outcome: 'uncertain', retryable: true, evidenceRefs: [], artifactRefs: [], observedAt: 2 }) };
    await expect(invokeCapability(uncertain, request())).resolves.toMatchObject({ outcome: 'uncertain', retryable: true });
  });
});
