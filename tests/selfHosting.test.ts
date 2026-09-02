import { describe, expect, it } from 'vitest';
import { assertSelfHostingIsolation, type SelfHostingRuntimeBoundary } from '../src/selfHosting';

const parent: SelfHostingRuntimeBoundary = {
  repoPath: 'C:\\GAM\\parent',
  gamHome: 'C:\\GAM-State\\parent',
  databasePath: 'C:\\GAM-State\\parent\\gam.sqlite3',
  pipeName: 'charterion-parent',
  browserProfilePath: 'C:\\GAM-State\\parent\\browser-profile',
};

const candidate: SelfHostingRuntimeBoundary = {
  repoPath: 'D:\\GAM\\candidate',
  gamHome: 'D:\\GAM-State\\candidate',
  databasePath: 'D:\\GAM-State\\candidate\\gam.sqlite3',
  pipeName: 'charterion-candidate',
  browserProfilePath: 'D:\\GAM-State\\candidate\\browser-profile',
};

function withCandidate(
  field: keyof SelfHostingRuntimeBoundary,
  value: string,
): SelfHostingRuntimeBoundary {
  return { ...candidate, [field]: value };
}

describe('self-hosting isolation', () => {
  it('accepts an isolated candidate runtime', () => {
    expect(() => assertSelfHostingIsolation(parent, candidate)).not.toThrow();
  });
  it.each([
    ['repoPath', parent.repoPath],
    ['gamHome', parent.gamHome],
    ['databasePath', parent.databasePath],
    ['browserProfilePath', parent.browserProfilePath],
    ['pipeName', parent.pipeName],
  ] as const)('rejects an exact %s collision', (field, value) => {
    expect(() => assertSelfHostingIsolation(parent, withCandidate(field, value))).toThrow(/collision|distinct/i);
  });

  it.each([
    ['repoPath', 'c:/gam/PARENT/'],
    ['gamHome', 'c:/gam-state/PARENT/'],
    ['databasePath', 'c:/gam-state/PARENT/gam.sqlite3'],
    ['browserProfilePath', 'c:/gam-state/PARENT/browser-profile/'],
  ] as const)('rejects Windows slash/case aliasing for %s', (field, value) => {
    expect(() => assertSelfHostingIsolation(parent, withCandidate(field, value))).toThrow(
      new RegExp(field, 'i'),
    );
  });

  it('rejects a candidate GAM_HOME nested inside parent GAM_HOME', () => {
    const nested = withCandidate('gamHome', 'c:/GAM-state/PARENT/candidate-state');
    expect(() => assertSelfHostingIsolation(parent, nested)).toThrow(/nested inside parent gamHome/i);
  });
});
