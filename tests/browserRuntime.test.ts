import { describe, expect, it } from 'vitest';
import { deriveBrowserRuntimeObservation, pageHealthAllowsFleetExpansion } from '../src/browserRuntime';

describe('browser runtime semantics', () => {
  it('treats only ready/generating pages as authentication evidence', () => {
    expect(deriveBrowserRuntimeObservation(['idle'])).toEqual({ authStatus: 'authenticated', pageHealth: 'ready' });
    expect(deriveBrowserRuntimeObservation(['generating'])).toEqual({ authStatus: 'authenticated', pageHealth: 'generating' });
    expect(deriveBrowserRuntimeObservation(['blocked'])).toEqual({ authStatus: 'unknown', pageHealth: 'blocked' });
    expect(deriveBrowserRuntimeObservation(['error'])).toEqual({ authStatus: 'unknown', pageHealth: 'error' });
    expect(deriveBrowserRuntimeObservation(['unauthorized'])).toEqual({ authStatus: 'authentication-required', pageHealth: 'unknown' });
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
