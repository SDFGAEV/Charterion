import { describe, expect, it } from 'vitest';
import { TabOperationQueue } from '../src/tabOperationQueue';

describe('TabOperationQueue', () => {
  it('serializes operations for the same tab', async () => {
    const queue = new TabOperationQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });

    const first = queue.run(7, async () => {
      order.push('first:start');
      markFirstStarted();
      await firstGate;
      order.push('first:end');
      return 1;
    });
    const second = queue.run(7, async () => {
      order.push('second:start');
      return 2;
    });

    await firstStarted;
    expect(order).toEqual(['first:start']);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
    expect(queue.pending(7)).toBe(false);
  });
});
