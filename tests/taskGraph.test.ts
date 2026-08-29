import { describe, expect, it } from 'vitest';
import { deriveManagedTasks, validateTaskGraph } from '../src/taskGraph';
import type { AgentTask, SendAttemptRecord } from '../src/contracts';

function task(id: string, dependsOn: string[] = [], attemptIds: string[] = []): AgentTask {
  return {
    id,
    kind: 'work',
    title: id,
    project: '',
    instruction: `do ${id}`,
    targetRole: `role-${id}`,
    dependsOn,
    attemptIds,
    createdAt: 1,
    updatedAt: 1,
  };
}

function attempt(id: string, state: SendAttemptRecord['state']): SendAttemptRecord {
  return {
    attemptId: id,
    batchId: 'batch',
    tabId: 1,
    conversationKey: 'conversation:c1',
    state,
    textLength: 5,
    baselineAssistantMessageCount: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('task DAG validation', () => {
  it('accepts a valid dependency chain', () => {
    expect(() => validateTaskGraph([task('a'), task('b', ['a']), task('c', ['b'])])).not.toThrow();
  });

  it('rejects cycles and missing dependencies', () => {
    expect(() => validateTaskGraph([task('a', ['b']), task('b', ['a'])])).toThrow(/DAG/);
    expect(() => validateTaskGraph([task('a', ['missing'])])).toThrow(/missing task/);
  });
});

describe('task status derivation', () => {
  it('only makes dependents ready after dependency reply evidence is observed', () => {
    const tasks = [task('a', [], ['attempt-a']), task('b', ['a'])];
    expect(deriveManagedTasks(tasks, [attempt('attempt-a', 'acknowledged')]).map((item) => item.status))
      .toEqual(['running', 'pending']);
    expect(deriveManagedTasks(tasks, [attempt('attempt-a', 'reply-observed')]).map((item) => item.status))
      .toEqual(['completed', 'ready']);
  });

  it('surfaces uncertain delivery as attention and blocks dependents', () => {
    const tasks = [task('a', [], ['attempt-a']), task('b', ['a'])];
    expect(deriveManagedTasks(tasks, [attempt('attempt-a', 'uncertain')]).map((item) => item.status))
      .toEqual(['attention', 'blocked']);
  });

  it('keeps root tasks ready until they have an attempt', () => {
    expect(deriveManagedTasks([task('root')], [])[0]?.status).toBe('ready');
  });

  it('makes a failed task ready again only after an explicit retry fact', () => {
    const failedTask = task('a', [], ['attempt-a']);
    expect(deriveManagedTasks([failedTask], [attempt('attempt-a', 'failed')])[0]?.status).toBe('error');
    const retried = { ...failedTask, retryAfterAttemptId: 'attempt-a' };
    expect(deriveManagedTasks([retried], [attempt('attempt-a', 'failed')])[0]?.status).toBe('ready');
  });
  it('requires an explicit passing review before dependents can continue', () => {
    const review = { ...task('review', ['a'], ['review-attempt']), kind: 'review' as const };
    const downstream = task('downstream', ['review']);
    const workDone = attempt('work-attempt', 'reply-observed');
    const work = task('a', [], ['work-attempt']);

    const failedReview = { ...attempt('review-attempt', 'reply-observed'), replyTextTail: '<GAM_REVIEW>{"decision":"fail","reason":"needs fix","nextInstruction":"fix it"}</GAM_REVIEW>' };
    const failed = deriveManagedTasks([work, review, downstream], [workDone, failedReview]);
    expect(failed.map((item) => item.status)).toEqual(['completed', 'attention', 'blocked']);
    expect(failed[1]?.reviewResult?.decision).toBe('fail');

    const passReview = { ...failedReview, replyTextTail: '<GAM_REVIEW>{"decision":"pass","reason":"verified","nextInstruction":""}</GAM_REVIEW>' };
    const passed = deriveManagedTasks([work, review, downstream], [workDone, passReview]);
    expect(passed.map((item) => item.status)).toEqual(['completed', 'completed', 'ready']);
  });

  it('treats invalid review output as attention and permits only explicit review retry', () => {
    const review = { ...task('review', [], ['review-attempt']), kind: 'review' as const };
    const bad = { ...attempt('review-attempt', 'reply-observed'), replyTextTail: 'PASS probably' };
    const first = deriveManagedTasks([review], [bad])[0]!;
    expect(first.status).toBe('attention');
    expect(first.reviewError).toMatch(/GAM_REVIEW|JSON block/i);
    const retried = { ...review, retryAfterAttemptId: 'review-attempt' };
    expect(deriveManagedTasks([retried], [bad])[0]?.status).toBe('ready');
  });

});