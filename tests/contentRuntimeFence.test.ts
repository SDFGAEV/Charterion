import { describe, expect, it } from 'vitest';
import { ContentRuntimeFence } from '../src/contentRuntimeFence';

function observation(contentEpoch: string, revision: number, observedAt = revision) {
  return { contentEpoch, revision, semanticSignature: `${contentEpoch}:${revision}`, observedAt };
}

describe('ContentRuntimeFence', () => {
  it('accepts monotonic observations and rejects stale revisions', () => {
    const fence = new ContentRuntimeFence();
    expect(fence.observe(7, observation('epoch-a', 1))).toBe(true);
    expect(fence.observe(7, observation('epoch-a', 1))).toBe(false);
    expect(fence.observe(7, observation('epoch-a', 2))).toBe(true);
    expect(fence.observe(7, observation('epoch-a', 1))).toBe(false);
  });

  it('retires old content generations permanently for that tab lifetime', () => {
    const fence = new ContentRuntimeFence();
    expect(fence.observe(7, observation('epoch-a', 1))).toBe(true);
    expect(fence.observe(7, observation('epoch-b', 1))).toBe(true);
    expect(fence.currentEpoch(7)).toBe('epoch-b');
    expect(fence.observe(7, observation('epoch-a', 99))).toBe(false);
  });

  it('forgets retired generations only when the physical tab is removed', () => {
    const fence = new ContentRuntimeFence();
    expect(fence.observe(7, observation('epoch-a', 1))).toBe(true);
    expect(fence.observe(7, observation('epoch-b', 1))).toBe(true);
    fence.remove(7);
    expect(fence.observe(7, observation('epoch-a', 1))).toBe(true);
  });
});
