import type { AgentStatus } from './contracts';

export type BrowserAuthObservation = 'unknown' | 'authenticated' | 'authentication-required';
export type BrowserPageHealth = 'unknown' | 'ready' | 'generating' | 'blocked' | 'error' | 'unavailable';

export interface BrowserRuntimeObservation {
  authStatus: BrowserAuthObservation;
  pageHealth: BrowserPageHealth;
}

const AUTHENTICATED_PAGE_STATES = new Set<AgentStatus>(['idle', 'generating']);

export function deriveBrowserRuntimeObservation(statuses: readonly AgentStatus[]): BrowserRuntimeObservation {
  const authenticated = statuses.some((status) => AUTHENTICATED_PAGE_STATES.has(status));
  const authenticationRequired = statuses.some((status) => status === 'unauthorized');
  const authStatus: BrowserAuthObservation = authenticated
    ? 'authenticated'
    : authenticationRequired
      ? 'authentication-required'
      : 'unknown';

  let pageHealth: BrowserPageHealth = 'unknown';
  if (statuses.some((status) => status === 'blocked')) pageHealth = 'blocked';
  else if (statuses.some((status) => status === 'error')) pageHealth = 'error';
  else if (statuses.some((status) => status === 'generating')) pageHealth = 'generating';
  else if (statuses.some((status) => status === 'idle')) pageHealth = 'ready';
  else if (statuses.length > 0 && statuses.every((status) => status === 'unavailable')) pageHealth = 'unavailable';

  return { authStatus, pageHealth };
}

export function pageHealthAllowsFleetExpansion(pageHealth: BrowserPageHealth): boolean {
  return pageHealth !== 'blocked' && pageHealth !== 'error' && pageHealth !== 'unavailable';
}

export interface BrowserRuntimeEvidence extends BrowserRuntimeObservation { observedAt: number; }

export function fleetExpansionAllowed(
  current: BrowserRuntimeObservation, latest?: BrowserRuntimeEvidence, now = Date.now(), maxAgeMs = 120_000,
): boolean {
  if (current.authStatus === 'authentication-required' || !pageHealthAllowsFleetExpansion(current.pageHealth)) return false;
  if (!latest || now - latest.observedAt > maxAgeMs) return true;
  return latest.authStatus !== 'authentication-required' && pageHealthAllowsFleetExpansion(latest.pageHealth);
}
