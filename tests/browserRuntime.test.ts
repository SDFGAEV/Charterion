import { describe, expect, it } from 'vitest';
import { deriveBrowserRuntimeObservation, fleetExpansionAllowed, pageHealthAllowsFleetExpansion } from '../src/browserRuntime';

describe('browser runtime semantics', () => {
  it('treats only ready/generating pages as authentication evidence', () => {
    expect(deriveBrowserRuntimeObservation(['idle'])).toEqual({ authStatus: 'authenticated', pageHealth: 'ready' });
    expect(deriveBrowserRuntimeObservation(['generating'])).toEqual({ authStatus: 'authenticated', pageHealth: 'generating' });
    expect(deriveBrowserRuntimeObservation(['blocked'])).toEqual({ authStatus: 'unknown', pageHealth: 'blocked' });
    expect(deriveBrowserRuntimeObservation(['error'])).toEqual({ authStatus: 'unknown', pageHealth: 'error' });
    expect(deriveBrowserRuntimeObservation(['unauthorized'])).toEqual({ authStatus: 'authentication-required', pageHealth: 'unknown' });
    expect(deriveBrowserRuntimeObservation(['idle', 'unauthorized'])).toEqual({ authStatus: 'authentication-required', pageHealth: 'ready' });
  });

  it('expires stale auth/page evidence before fleet expansion decisions', () => {
    const current = { authStatus: 'unknown' as const, pageHealth: 'unknown' as const };
    expect(fleetExpansionAllowed(current, { authStatus: 'authentication-required', pageHealth: 'unknown', observedAt: 900 }, 1000, 200)).toBe(false);
    expect(fleetExpansionAllowed(current, { authStatus: 'authentication-required', pageHealth: 'blocked', observedAt: 700 }, 1000, 200)).toBe(true);
    expect(fleetExpansionAllowed({ authStatus: 'authentication-required', pageHealth: 'unknown' })).toBe(false);
  });

  it('fails closed for unhealthy page states when expanding the fleet', () => {
    expect(pageHealthAllowsFleetExpansion('ready')).toBe(true);
    expect(pageHealthAllowsFleetExpansion('generating')).toBe(true);
    expect(pageHealthAllowsFleetExpansion('unknown')).toBe(true);
    expect(pageHealthAllowsFleetExpansion('blocked')).toBe(false);
    expect(pageHealthAllowsFleetExpansion('error')).toBe(false);
    expect(pageHealthAllowsFleetExpansion('unavailable')).toBe(false);
  });
});
