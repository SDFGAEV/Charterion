import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlDatabase } from '../src/database';
import { WorkAuthority } from '../src/workAuthority';

const cleanups: Array<() => void> = [];
function harness(): WorkAuthority {
  const dir = mkdtempSync(join(tmpdir(), 'gam-work-authority-'));
  const database = new ControlDatabase(join(dir, 'global.db'));
  cleanups.push(() => { database.close(); rmSync(dir, { recursive: true, force: true }); });
  return new WorkAuthority(database);
}
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

function transport(expectedRevision: number, messageId: string) { return { transportGeneration: 'generation-1', transportSequence: expectedRevision + 1, transportMessageId: messageId }; }

function state() {
  const task: Record<string, unknown> = { id: 'task-1', attemptIds: ['attempt-1'] };
  const attempt: Record<string, unknown> = { attemptId: 'attempt-1', taskId: 'task-1', state: 'prepared' };
  const message: Record<string, unknown> = { id: 'message-1', attemptIds: [] };
  return { tasks: [task], attempts: [attempt], messages: [message] };
}
describe('WorkAuthority', () => {
  it('persists attempts by attemptId and advances a monotonic CAS revision', () => {
    const authority = harness();
    expect(authority.snapshot()).toEqual({ revision: 0, tasks: [], attempts: [], messages: [] });
    const first = authority.replace({ expectedRevision: 0, ...transport(0, 'message-1'), ...state() }, 10);
    expect(first.revision).toBe(1);
    expect(first.attempts[0]).toMatchObject({ attemptId: 'attempt-1', taskId: 'task-1' });
    const replay = authority.replace({ expectedRevision: 0, ...transport(0, 'message-1'), ...state() }, 11);
    expect(replay.revision).toBe(1);
    expect(() => authority.replace({ expectedRevision: 0, ...transport(0, 'message-2'), ...state() }, 11)).toThrow(/sequence.*occupied/i);
  });

  it('rejects broken task/attempt ownership atomically', () => {
    const authority = harness();
    const broken = state();
    broken.attempts[0] = { ...broken.attempts[0], taskId: 'missing-task' };
    expect(() => authority.replace({ expectedRevision: 0, ...transport(0, 'broken-1'), ...broken }, 10)).toThrow(/missing task/i);
    expect(authority.snapshot().revision).toBe(0);
  });

  it('rejects an attempt owned by both a task and a message', () => {
    const authority = harness();
    const broken = state();
    broken.attempts[0] = { ...broken.attempts[0], messageId: 'message-1' };
    expect(() => authority.replace({ expectedRevision: 0, ...transport(0, 'broken-2'), ...broken }, 10)).toThrow(/both task and message/i);
  });
});

describe('WorkAuthority verified completion', () => {
  it('records one idempotent machine completion and advances revision once', () => {
    const authority = harness();
    const seeded = state();
    seeded.tasks[0] = { ...seeded.tasks[0], completionPolicy: 'verified-claim', updatedAt: 1 };
    authority.replace({ expectedRevision: 0, ...transport(0, 'seed-machine'), ...seeded }, 10);
    const completed = authority.completeVerifiedClaim({ taskId: 'task-1', claimId: 'claim-1', verificationId: 'verify-1', commitSha: 'a'.repeat(40) }, 20);
    expect(completed.revision).toBe(2);
    expect(completed.tasks[0]).toMatchObject({ machineCompletion: { kind: 'verified-claim', claimId: 'claim-1', verificationId: 'verify-1', completedAt: 20 } });
    expect(authority.completeVerifiedClaim({ taskId: 'task-1', claimId: 'claim-1', verificationId: 'verify-1', commitSha: 'a'.repeat(40) }, 30).revision).toBe(2);
    expect(() => authority.completeVerifiedClaim({ taskId: 'task-1', claimId: 'claim-1', verificationId: 'verify-2', commitSha: 'a'.repeat(40) }, 40)).toThrow(/different machine completion/i);
    expect(authority.snapshot().revision).toBe(2);
  });

  it('rejects machine completion for a reply-policy task', () => {
    const authority = harness();
    const seeded = state();
    seeded.tasks[0] = { ...seeded.tasks[0], completionPolicy: 'reply' };
    authority.replace({ expectedRevision: 0, ...transport(0, 'seed-reply'), ...seeded }, 10);
    expect(() => authority.completeVerifiedClaim({ taskId: 'task-1', claimId: 'claim-1', verificationId: 'verify-1' }, 20)).toThrow(/does not accept verified-claim/i);
  });
});