import { describe, expect, it } from 'vitest';
import { CoalescingRunner } from '../src/coalescingRunner';

describe('CoalescingRunner', () => {
  it('coalesces kicks during a run into one required follow-up run', async () => {
    let runs = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const runner = new CoalescingRunner(async () => {
      runs += 1;
      if (runs === 1) await firstGate;
    });

    runner.kick();
    await Promise.resolve();
    expect(runs).toBe(1);
    runner.kick();
    runner.kick();
    releaseFirst();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(runs).toBe(2);
  });

  it('continues accepting kicks after a failed run', async () => {
    let runs = 0;
    const errors: unknown[] = [];
    const runner = new CoalescingRunner(async () => {
      runs += 1;
      if (runs === 1) throw new Error('boom');
    }, (error) => errors.push(error));
    runner.kick();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    runner.kick();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(runs).toBe(2);
    expect(errors).toHaveLength(1);
  });
});
