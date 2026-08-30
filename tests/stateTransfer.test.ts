import { describe, expect, it } from 'vitest';
import { createPortableManagerState, parsePortableManagerState, stringifyPortableManagerState } from '../src/stateTransfer';
import type { AgentMessage, AgentTask, SendAttemptRecord } from '../src/contracts';

function task(): AgentTask {
  return {
    id: 'task-1', kind: 'work', completionPolicy: 'reply', title: 'Task', project: 'P',
    instruction: 'do work', targetRole: 'worker', dependsOn: [], attemptIds: ['attempt-1'],
    createdAt: 1, updatedAt: 2,
  };
}

function attempt(): SendAttemptRecord {
  return {
    attemptId: 'attempt-1', batchId: 'batch-1', tabId: 1, conversationKey: 'conversation:c1',
    taskId: 'task-1', state: 'reply-observed', textLength: 10, baselineAssistantMessageCount: 0,
    replyTextTail: 'done', createdAt: 1, updatedAt: 2,
  };
}

function message(): AgentMessage {
  return {
    id: 'message-1', project: 'P', fromRole: 'worker', target: { kind: 'role', role: 'reviewer' },
    type: 'result', content: 'Task completed.', taskId: 'task-1', attemptIds: [], createdAt: 3, updatedAt: 3,
  };
}

describe('portable manager state', () => {
  it('round-trips bindings, tasks, attempts, messages, and supervisor state', () => {
    const state = createPortableManagerState(
      { 'conversation:c1': { role: 'worker', project: 'P', notes: '' } },
      [task()], [attempt()], [message()], true, 99,
    );
    expect(parsePortableManagerState(stringifyPortableManagerState(state))).toEqual(state);
  });

  it('rejects missing attempt references and duplicate attempts', () => {
    const base = createPortableManagerState({}, [task()], [attempt()], [], false, 1);
    expect(() => parsePortableManagerState(JSON.stringify({ ...base, attempts: [] }))).toThrow(/missing attempt/i);
    expect(() => parsePortableManagerState(JSON.stringify({ ...base, attempts: [attempt(), attempt()] }))).toThrow(/Duplicate attempt/i);
  });

  it('rejects invalid JSON, unsupported schemas, and broken DAGs', () => {
    expect(() => parsePortableManagerState('{bad')).toThrow(/valid JSON/);
    expect(() => parsePortableManagerState(JSON.stringify({ schemaVersion: 999 }))).toThrow(/schemaVersion/);
    const a = { ...task(), id: 'a', attemptIds: [], dependsOn: ['b'] };
    const b = { ...task(), id: 'b', attemptIds: [], dependsOn: ['a'] };
    const state = createPortableManagerState({}, [a, b], [], [], false, 1);
    expect(() => parsePortableManagerState(JSON.stringify(state))).toThrow(/DAG/);
  });

  it('migrates schema v1 documents by adding an empty message bus', () => {
    const v2 = createPortableManagerState({}, [task()], [attempt()], [], false, 1);
    const { messages: _messages, ...legacy } = v2;
    const v1 = { ...legacy, schemaVersion: 1 };
    const parsed = parsePortableManagerState(JSON.stringify(v1));
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.messages).toEqual([]);
  });

  it('rejects broken message task and attempt references', () => {
    const base = createPortableManagerState({}, [task()], [attempt()], [message()], false, 1);
    expect(() => parsePortableManagerState(JSON.stringify({
      ...base,
      messages: [{ ...message(), taskId: 'missing' }],
    }))).toThrow(/missing task/i);
    expect(() => parsePortableManagerState(JSON.stringify({
      ...base,
      messages: [{ ...message(), attemptIds: ['missing-attempt'] }],
    }))).toThrow(/missing attempt/i);
  });
});

it('preserves and validates frozen message recipient identities', () => {
  const frozen = { ...message(), recipientConversationKeys: ['conversation:r1', 'conversation:r2'] };
  const state = createPortableManagerState({}, [task()], [attempt()], [frozen], false, 1);
  const parsed = parsePortableManagerState(stringifyPortableManagerState(state));
  expect(parsed.messages[0]?.recipientConversationKeys).toEqual(['conversation:r1', 'conversation:r2']);

  expect(() => parsePortableManagerState(JSON.stringify({
    ...state,
    messages: [{ ...frozen, recipientConversationKeys: ['conversation:r1', 'conversation:r1'] }],
  }))).toThrow(/recipients must be unique/i);
  expect(() => parsePortableManagerState(JSON.stringify({
    ...state,
    messages: [{ ...frozen, recipientConversationKeys: 'conversation:r1' }],
  }))).toThrow(/recipientConversationKeys must be a string array/i);
});

it('rejects inconsistent bidirectional attempt ownership and frozen-recipient drift', () => {
  const wrongTaskAttempt = { ...attempt(), taskId: 'other-task' };
  const wrongTaskState = createPortableManagerState({}, [task()], [wrongTaskAttempt], [], false, 1);
  expect(() => parsePortableManagerState(JSON.stringify(wrongTaskState))).toThrow(/inconsistent ownership/i);

  const messageAttempt: SendAttemptRecord = {
    attemptId: 'message-attempt', batchId: 'batch-m', tabId: 2, conversationKey: 'conversation:r1',
    messageId: 'message-1', state: 'acknowledged', textLength: 4, baselineAssistantMessageCount: 0,
    createdAt: 3, updatedAt: 4,
  };
  const frozenMessage = { ...message(), attemptIds: ['message-attempt'], recipientConversationKeys: ['conversation:r1'] };
  const valid = createPortableManagerState({}, [task()], [attempt(), messageAttempt], [frozenMessage], false, 1);
  expect(() => parsePortableManagerState(stringifyPortableManagerState(valid))).not.toThrow();

  const drifted = { ...valid, messages: [{ ...frozenMessage, recipientConversationKeys: ['conversation:r2'] }] };
  expect(() => parsePortableManagerState(JSON.stringify(drifted))).toThrow(/outside its frozen recipient set/i);

  const orphan = { ...valid, messages: [{ ...frozenMessage, attemptIds: [] }] };
  expect(() => parsePortableManagerState(JSON.stringify(orphan))).toThrow(/not referenced by owning message/i);
});
