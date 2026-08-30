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
