import { describe, expect, it } from 'vitest';
import { recoverAttempt, type AttemptRecoveryObservation } from '../src/recovery';
import type { ChatSnapshot, SendAttemptRecord } from '../src/contracts';

function attempt(state: SendAttemptRecord['state']): SendAttemptRecord {
  return {
    attemptId: 'attempt-1', batchId: 'batch-1', tabId: 7,
    conversationKey: 'conversation:c1', state, textLength: 5,
    contentEpoch: 'content-epoch',
    baselineAssistantMessageCount: 2, baselineAssistantMessageId: 'message:m2',
    createdAt: 1000, updatedAt: 1000,
  };
}

function snapshot(): ChatSnapshot {
  return {
    conversationKey: 'conversation:c1', conversationId: 'c1', title: 'ChatGPT',
    url: 'https://chatgpt.com/c/c1', status: 'idle', confidence: 'direct',
    signals: ['composer-ready'], assistantMessageCount: 2,
    latestAssistantMessageId: 'message:m2', latestAssistantText: 'old', observedAt: 2000,
  };
}

function observation(options: { delivered?: boolean; pending?: boolean; startedAt?: number } = {}): AttemptRecoveryObservation {
  const snap = snapshot();
  const state: AttemptRecoveryObservation['state'] = {
    observation: { contentEpoch: 'content-epoch', revision: 1, semanticSignature: 'sig-1', observedAt: snap.observedAt },
    snapshot: snap,
    deliveredAttemptIds: options.delivered === false ? [] : ['attempt-1'],
  };
  if (options.pending !== false) {
    state.pendingAttempt = {
      attemptId: 'attempt-1', contentEpoch: 'content-epoch', baselineAssistantMessageCount: 2,
      baselineAssistantMessageId: 'message:m2', startedAt: options.startedAt ?? 1500,
    };
  }
  return { tabId: 7, state };
}

describe('restart attempt recovery', () => {
  it('fails a prepared attempt because browser dispatch never started', () => {
    expect(recoverAttempt(attempt('prepared'), undefined)).toMatchObject({ nextState: 'failed' });
  });

  it('recovers dispatched to acknowledged only with matching delivered and pending evidence', () => {
    expect(recoverAttempt(attempt('dispatched'), observation(), 2000)).toEqual({
      attemptId: 'attempt-1', nextState: 'acknowledged',
    });
  });

  it('keeps a fresh in-page dispatch pending while the content script may still finish it', () => {
    expect(recoverAttempt(attempt('dispatched'), observation({ delivered: false, startedAt: 1900 }), 2000))
      .toEqual({ attemptId: 'attempt-1' });
  });

  it('marks stale or missing dispatch evidence uncertain instead of resending', () => {
    expect(recoverAttempt(attempt('dispatched'), observation({ delivered: false, startedAt: 0 }), 200001).nextState)
      .toBe('uncertain');
    expect(recoverAttempt(attempt('dispatched'), undefined).nextState).toBe('uncertain');
  });

  it('keeps acknowledged only while the exact reply-correlation baseline survives', () => {
    expect(recoverAttempt(attempt('acknowledged'), observation())).toEqual({ attemptId: 'attempt-1' });
    expect(recoverAttempt(attempt('acknowledged'), observation({ pending: false })).nextState).toBe('uncertain');
  });

  it('rejects evidence from a different content runtime generation', () => {
    const wrongEpoch = observation();
    wrongEpoch.state.observation = { ...wrongEpoch.state.observation, contentEpoch: 'content-epoch-new' };
    expect(recoverAttempt(attempt('acknowledged'), wrongEpoch).nextState).toBe('uncertain');
  });

  it('rejects evidence from another tab or conversation', () => {
    const wrongTab = observation(); wrongTab.tabId = 8;
    expect(recoverAttempt(attempt('acknowledged'), wrongTab).nextState).toBe('uncertain');
    const wrongConversation = observation();
    wrongConversation.state.snapshot = { ...wrongConversation.state.snapshot, conversationKey: 'conversation:other' };
    expect(recoverAttempt(attempt('acknowledged'), wrongConversation).nextState).toBe('uncertain');
  });

  it('accepts root-to-canonical recovery only when Kernel owns the canonical destination', () => {
    const root = { ...attempt('acknowledged'), conversationKey: 'url:https://chatgpt.com/' };
    const canonical = observation();
    expect(recoverAttempt(root, canonical).nextState).toBe('uncertain');
    canonical.authoritativeConversationKey = 'conversation:c1';
    expect(recoverAttempt(root, canonical)).toEqual({ attemptId: 'attempt-1' });
    canonical.authoritativeConversationKey = 'conversation:other';
    expect(recoverAttempt(root, canonical).nextState).toBe('uncertain');
  });

  it('never auto-retries terminal or already-uncertain states', () => {
    for (const state of ['failed', 'reply-observed', 'uncertain'] as const) {
      expect(recoverAttempt(attempt(state), observation())).toEqual({ attemptId: 'attempt-1' });
    }
  });
});
