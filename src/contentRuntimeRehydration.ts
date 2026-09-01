export type ContentRuntimeProbe = (tabId: number) => Promise<boolean>;
export type ContentRuntimeInjector = (tabId: number) => Promise<void>;

export interface ContentRuntimeRehydrationResult {
  tabId: number;
  status: 'responsive' | 'reinjected' | 'unavailable';
  error?: string;
}

export async function rehydrateContentRuntimes(
  tabIds: readonly number[],
  probe: ContentRuntimeProbe,
  inject: ContentRuntimeInjector,
): Promise<ContentRuntimeRehydrationResult[]> {
  const results: ContentRuntimeRehydrationResult[] = [];
  for (const tabId of [...new Set(tabIds)]) {
    if (await probe(tabId)) {
      results.push({ tabId, status: 'responsive' });
      continue;
    }
    try {
      await inject(tabId);
      results.push({ tabId, status: await probe(tabId) ? 'reinjected' : 'unavailable' });
    } catch (error) {
      results.push({ tabId, status: 'unavailable', error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
