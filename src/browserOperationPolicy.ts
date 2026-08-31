export type BrowserOperationClass = 'read' | 'write' | 'control';
export type BrowserRetryPolicy = 'always' | 'if-proven-not-started' | 'never';
export type BrowserOperationOwner = 'content-adapter' | 'fleet-runtime' | 'observation-runtime';

export interface BrowserOperationPolicy {
  operation: BrowserOperation;
  operationClass: BrowserOperationClass;
  retryPolicy: BrowserRetryPolicy;
  recoveryEvidence: string;
  owner: BrowserOperationOwner;
}

export type BrowserOperation =
  | 'page.snapshot'
  | 'prompt.send'
  | 'tab.open'
  | 'tab.close'
  | 'binding.update'
  | 'runtime.observe';

const policies: Record<BrowserOperation, BrowserOperationPolicy> = {
  'page.snapshot': { operation: 'page.snapshot', operationClass: 'read', retryPolicy: 'always', recoveryEvidence: 'fresh content observation', owner: 'observation-runtime' },
  'prompt.send': { operation: 'prompt.send', operationClass: 'write', retryPolicy: 'never', recoveryEvidence: 'submitted user turn or generation/composer transition', owner: 'content-adapter' },
  'tab.open': { operation: 'tab.open', operationClass: 'write', retryPolicy: 'if-proven-not-started', recoveryEvidence: 'AgentSlot has no owned live tab', owner: 'fleet-runtime' },
  'tab.close': { operation: 'tab.close', operationClass: 'write', retryPolicy: 'if-proven-not-started', recoveryEvidence: 'owned tab absence', owner: 'fleet-runtime' },
  'binding.update': { operation: 'binding.update', operationClass: 'control', retryPolicy: 'always', recoveryEvidence: 'exact AgentSlot binding projection', owner: 'fleet-runtime' },
  'runtime.observe': { operation: 'runtime.observe', operationClass: 'read', retryPolicy: 'always', recoveryEvidence: 'contentEpoch + revision + observedAt', owner: 'observation-runtime' },
};

export function browserOperationPolicy(operation: BrowserOperation): BrowserOperationPolicy {
  return policies[operation];
}

export function browserOperationPolicies(): BrowserOperationPolicy[] {
  return Object.values(policies);
}
