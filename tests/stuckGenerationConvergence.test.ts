import { describe, expect, it } from 'vitest';
import {
  convergeStuckGeneration,
  type StuckGenerationInput,
} from '../src/stuckGenerationConvergence';

function input(overrides: Partial<StuckGenerationInput> = {}): StuckGenerationInput {
  const base: StuckGenerationInput = {
    now: 20_000,
    staleDeadlineAt: 15_000,
    recentProgressSince: 17_000,
    page: {
      ownership: 'gam',
      slotId: 'slot-1',
      taskId: 'task-1',
      activity: 'generating',
      confidence: 'direct',
      observedAt: 19_000,
    },
    slot: {
      ownership: 'gam',
      slotId: 'slot-1',
      taskId: 'task-1',
      resourceId: 'task-workspace:project:task-1',
      leaseEpoch: 7,
    },
    attempt: {
      attemptId: 'attempt-1',
      taskId: 'task-1',
      state: 'acknowledged',
      updatedAt: 10_000,
    },
    progressEvidence: [],
  };
  return { ...base, ...overrides };
}

describe('stuck generation convergence policy', () => {
  it('requests only an authority-checked stop for stale acknowledged generation with no progress', () => {
    expect(convergeStuckGeneration(input())).toEqual({
      action: 'request-authority-checked-stop',
      reason: 'stale-no-progress',
      target: {
        taskId: 'task-1',
        slotId: 'slot-1',
        resourceId: 'task-workspace:project:task-1',
        leaseEpoch: 7,
        attemptId: 'attempt-1',
      },
      allowPromptResend: false,
    });
  });

  it('fails closed while under the stale deadline', () => {
    expect(convergeStuckGeneration(input({ now: 14_999 }))).toEqual({
      action: 'hold',
      reason: 'under-stale-deadline',
      allowPromptResend: false,
    });
  });

  it('requires a direct generating observation from at or after the stale deadline', () => {
    expect(convergeStuckGeneration(input({
      page: { ...input().page, confidence: 'inferred' },
    })).reason).toBe('page-observation-not-direct');
    expect(convergeStuckGeneration(input({
      page: { ...input().page, observedAt: 14_999 },
    })).reason).toBe('stale-observation-predates-deadline');
  });

  it('never auto-resends an uncertain prompt', () => {
    expect(convergeStuckGeneration(input({
      attempt: { ...input().attempt, state: 'uncertain' },
    }))).toEqual({
      action: 'hold',
      reason: 'attempt-not-safe-for-stop',
      allowPromptResend: false,
    });
  });

  it('fails closed for unknown, non-GAM, mismatched, and ordinary idle facts', () => {
    expect(convergeStuckGeneration(input({
      page: { ...input().page, ownership: 'unknown' },
    })).reason).toBe('identity-unknown-or-not-gam');
    expect(convergeStuckGeneration(input({
      slot: { ...input().slot, ownership: 'non-gam' },
    })).reason).toBe('identity-unknown-or-not-gam');
    expect(convergeStuckGeneration(input({
      page: { ...input().page, slotId: 'slot-other' },
    })).reason).toBe('identity-mismatch');
    expect(convergeStuckGeneration(input({
      page: { ...input().page, activity: 'idle' },
    })).reason).toBe('page-idle-without-cleanup-proof');
    expect(convergeStuckGeneration(input({
      page: { ...input().page, activity: 'unknown' },
    })).reason).toBe('page-state-unknown');
  });

  it('blocks stop while exact recent engineering progress exists', () => {
    const decision = convergeStuckGeneration(input({
      progressEvidence: [
        { kind: 'test-activity', taskId: 'task-1', slotId: 'slot-1', observedAt: 19_500 },
      ],
    }));
    expect(decision.reason).toBe('recent-engineering-progress');
  });

  it('ignores unrelated or old progress evidence', () => {
    const decision = convergeStuckGeneration(input({
      progressEvidence: [
        { kind: 'workspace-change', taskId: 'task-other', slotId: 'slot-1', observedAt: 19_500 },
        { kind: 'tool-activity', taskId: 'task-1', slotId: 'slot-other', observedAt: 19_500 },
        { kind: 'test-activity', taskId: 'task-1', slotId: 'slot-1', observedAt: 16_999 },
        { kind: 'claim-activity', taskId: 'task-1', slotId: 'slot-1', observedAt: 20_001 },
      ],
    }));
    expect(decision.action).toBe('request-authority-checked-stop');
  });

  it('does not repeat stop after authority already approved it while generation continues', () => {
    const decision = convergeStuckGeneration(input({
      authorizedStop: {
        taskId: 'task-1', slotId: 'slot-1', resourceId: 'task-workspace:project:task-1',
        leaseEpoch: 7, requestedAt: 20_000, authorizedAt: 20_100,
      },
      now: 20_200,
      page: { ...input().page, observedAt: 20_200 },
    }));
    expect(decision).toEqual({
      action: 'hold',
      reason: 'authorized-stop-awaiting-direct-idle',
      allowPromptResend: false,
    });
  });

  it('requests cleanup only after a later direct idle observation for the authorized lease', () => {
    const authorizedStop = {
      taskId: 'task-1', slotId: 'slot-1', resourceId: 'task-workspace:project:task-1',
      leaseEpoch: 7, requestedAt: 20_000, authorizedAt: 20_100,
    };
    const decision = convergeStuckGeneration(input({
      now: 20_300,
      authorizedStop,
      page: { ...input().page, activity: 'idle', observedAt: 20_300 },
    }));
    expect(decision.action).toBe('request-cleanup');
    expect(decision.allowPromptResend).toBe(false);
  });

  it('rejects idle evidence that is not later, direct, and bound to the current lease', () => {
    const stop = {
      taskId: 'task-1', slotId: 'slot-1', resourceId: 'task-workspace:project:task-1',
      leaseEpoch: 7, requestedAt: 20_000, authorizedAt: 20_100,
    };
    expect(convergeStuckGeneration(input({
      authorizedStop: stop,
      page: { ...input().page, activity: 'idle', observedAt: 20_100 },
    })).reason).toBe('page-idle-without-cleanup-proof');

    expect(convergeStuckGeneration(input({
      authorizedStop: stop,
      page: { ...input().page, activity: 'idle', confidence: 'inferred', observedAt: 20_300 },
    })).reason).toBe('page-observation-not-direct');

    expect(convergeStuckGeneration(input({
      authorizedStop: { ...stop, leaseEpoch: 6 },
      page: { ...input().page, activity: 'idle', observedAt: 20_300 },
    })).reason).toBe('page-idle-without-cleanup-proof');
  });

  it('treats every non-acknowledged attempt state as unsafe for stop', () => {
    for (const state of ['prepared', 'dispatched', 'reply-observed', 'failed', 'uncertain'] as const) {
      const decision = convergeStuckGeneration(input({
        attempt: { ...input().attempt, state },
      }));
      expect(decision.action).toBe('hold');
      expect(decision.allowPromptResend).toBe(false);
    }
  });
});
