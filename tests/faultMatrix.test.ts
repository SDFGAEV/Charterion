import { describe, expect, it } from 'vitest';
import { advanceAttempt } from '../src/attempts';
import { CoalescingRunner } from '../src/coalescingRunner';
import { ContentRuntimeFence } from '../src/contentRuntimeFence';
import { TabOperationQueue } from '../src/tabOperationQueue';
import type { SendAttemptRecord } from '../src/contracts';

function uncertainAttempt(): SendAttemptRecord {
  return {
    attemptId: 'a1', batchId: 'b1', tabId: 7, conversationKey: 'conversation:c1',
    contentEpoch: 'epoch-a', state: 'uncertain', textLength: 3,
    baselineAssistantMessageCount: 0, createdAt: 1, updatedAt: 1,
  };
}

describe('browser fault matrix invariants', () => {
  it('never promotes an uncertain write back to acknowledged', () => {
    expect(advanceAttempt(uncertainAttempt(), 'acknowledged').state).toBe('uncertain');
    expect(advanceAttempt(uncertainAttempt(), 'reply-observed').state).toBe('reply-observed');
  });

  it('releases a per-tab write queue after an operation throws', async () => {
    const queue = new TabOperationQueue();
    const first = queue.run(7, async () => { throw new Error('transport failed'); });
    const second = queue.run(7, async () => 'recovered-next-operation');
    await expect(first).rejects.toThrow('transport failed');
    await expect(second).resolves.toBe('recovered-next-operation');
    expect(queue.pending(7)).toBe(false);
  });

  it('coalesces a wake that arrives while the runner is already active', async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runner = new CoalescingRunner(async () => {
      runs += 1;
      if (runs === 1) await gate;
    });
    runner.kick();
    await Promise.resolve();
    runner.kick();
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runs).toBe(2);
  });

  it('rejects observations from a retired content generation', () => {
    const fence = new ContentRuntimeFence();
    const obs = (contentEpoch: string, revision: number) => ({
      contentEpoch, revision, semanticSignature: `${contentEpoch}:${revision}`, observedAt: revision,
    });
    expect(fence.observe(7, obs('epoch-a', 1))).toBe(true);
    expect(fence.observe(7, obs('epoch-b', 1))).toBe(true);
    expect(fence.observe(7, obs('epoch-a', 99))).toBe(false);
  });
});
