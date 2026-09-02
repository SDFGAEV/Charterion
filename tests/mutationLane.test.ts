import { describe, expect, it } from 'vitest';
import { MutationLane } from '../src/mutationLane';

describe('MutationLane', () => {
  it('serializes overlapping mutations and preserves results', async () => {
    const lane = new MutationLane();
    const events: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const run = (name: string, delay: number) => lane.run(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      events.push('start:' + name);
      await new Promise((resolve) => setTimeout(resolve, delay));
      events.push('end:' + name);
      active -= 1;
      return name;
    });
    const results = await Promise.all([run('first', 10), run('second', 0), run('third', 0)]);
    expect(results).toEqual(['first', 'second', 'third']);
    expect(events).toEqual(['start:first', 'end:first', 'start:second', 'end:second', 'start:third', 'end:third']);
    expect(maximumActive).toBe(1);
  });

  it('continues with later mutations after a failed mutation', async () => {
    const lane = new MutationLane();
    const first = lane.run(async () => { throw new Error('expected'); });
    const second = lane.run(async () => 'recovered');
    await expect(first).rejects.toThrow('expected');
    await expect(second).resolves.toBe('recovered');
  });
});
