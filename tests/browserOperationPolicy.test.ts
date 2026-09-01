import { describe, expect, it } from 'vitest';
import { browserOperationPolicies, browserOperationPolicy, browserCapabilityDescriptor } from '../src/browserOperationPolicy';

describe('browser operation policy', () => {
  it('classifies every supported operation exactly once', () => {
    const policies = browserOperationPolicies();
    expect(new Set(policies.map((item) => item.operation)).size).toBe(policies.length);
    expect(policies.map((item) => item.operation).sort()).toEqual([
      'binding.update', 'page.snapshot', 'prompt.send', 'runtime.observe', 'tab.close', 'tab.open',
    ]);
  });

  it('never retries prompt submission without effect-specific proof', () => {
    expect(browserOperationPolicy('prompt.send')).toMatchObject({
      operationClass: 'write', retryPolicy: 'never', owner: 'content-adapter',
    });
  });

  it('allows tab lifecycle retry only after proving the physical effect did not happen', () => {
    expect(browserOperationPolicy('tab.open').retryPolicy).toBe('if-proven-not-started');
    expect(browserOperationPolicy('tab.close').retryPolicy).toBe('if-proven-not-started');
  });
  it('projects browser policy into the generic capability contract without losing retry semantics', () => {
    expect(browserCapabilityDescriptor('page.snapshot')).toMatchObject({
      capabilityId: 'browser', providerId: 'chatgpt-web', effectClass: 'read-only',
      authorityRequirements: ['browser.observe'], recoverability: 'idempotent',
    });
    expect(browserCapabilityDescriptor('prompt.send')).toMatchObject({
      effectClass: 'uncertain', authorityRequirements: ['browser.write'], recoverability: 'non-replayable',
    });
  });
});
