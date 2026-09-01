import { describe, expect, it } from 'vitest';
import { rehydrateContentRuntimes } from '../src/contentRuntimeRehydration';

describe('rehydrateContentRuntimes', () => {
  it('keeps responsive runtimes and reinjects only stale managed tabs', async () => {
    const responsive = new Set([11]);
    const injected: number[] = [];
    const results = await rehydrateContentRuntimes(
      [11, 12, 12],
      async (tabId) => responsive.has(tabId),
      async (tabId) => { injected.push(tabId); responsive.add(tabId); },
    );
    expect(injected).toEqual([12]);
    expect(results).toEqual([
      { tabId: 11, status: 'responsive' },
      { tabId: 12, status: 'reinjected' },
    ]);
  });

  it('isolates a failed reinjection instead of blocking later managed tabs', async () => {
    const responsive = new Set<number>();
    const injected: number[] = [];
    const results = await rehydrateContentRuntimes(
      [21, 22],
      async (tabId) => responsive.has(tabId),
      async (tabId) => {
        injected.push(tabId);
        if (tabId === 21) throw new Error('tab disappeared');
        responsive.add(tabId);
      },
    );
    expect(injected).toEqual([21, 22]);
    expect(results[0]).toMatchObject({ tabId: 21, status: 'unavailable', error: 'tab disappeared' });
    expect(results[1]).toEqual({ tabId: 22, status: 'reinjected' });
  });
});
