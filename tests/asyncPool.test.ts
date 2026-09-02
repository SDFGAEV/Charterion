import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../src/asyncPool';

describe('mapWithConcurrency', () => {
  it('preserves input order while bounding active operations', async () => {
    let active = 0;
    let maximumActive = 0;
    const result = await mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, item === 0 ? 15 : 2));
      active -= 1;
      return item * 2;
    });
    expect(result).toEqual([0, 2, 4, 6, 8, 10]);
    expect(maximumActive).toBe(2);
  });

  it('normalizes invalid concurrency to one worker', async () => {
    let active = 0;
    let maximumActive = 0;
    await mapWithConcurrency([1, 2, 3], 0, async (item) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve(item);
      active -= 1;
      return item;
    });
    expect(maximumActive).toBe(1);
  });

  it('does not start work for an empty input', async () => {
    let called = false;
    const result = await mapWithConcurrency([], 3, async () => { called = true; return 1; });
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });
});
