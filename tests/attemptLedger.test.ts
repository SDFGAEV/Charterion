import { describe, expect, it } from 'vitest';
import { retainAttemptLedger } from '../src/attemptLedger';
import type { AgentMessage, AgentTask, SendAttemptRecord } from '../src/contracts';

function attempt(id: string, link?: 'task' | 'message'): SendAttemptRecord {
  const value: SendAttemptRecord = {
    attemptId: id, batchId: 'b', tabId: 1, conversationKey: `conversation:${id}`,
    state: 'reply-observed', textLength: 1, baselineAssistantMessageCount: 0, createdAt: 1, updatedAt: 1,
  };
  if (link === 'task') value.taskId = 'task';
  if (link === 'message') value.messageId = 'message';
  return value;
}

const task: AgentTask = {
  id: 'task', kind: 'work', completionPolicy: 'reply', title: 'T', project: 'P', instruction: 'do',
  targetRole: 'worker', dependsOn: [], attemptIds: ['old-task'], createdAt: 1, updatedAt: 1,
};
const message: AgentMessage = {
  id: 'message', project: 'P', fromRole: 'worker', target: { kind: 'role', role: 'reviewer' },
  type: 'result', content: 'done', attemptIds: ['old-message'], createdAt: 1, updatedAt: 1,
};

describe('attempt ledger retention', () => {
  it('never trims attempts referenced by durable tasks or messages', () => {
    const attempts = [
      attempt('old-task', 'task'),
      attempt('old-message', 'message'),
      attempt('manual-1'),
      attempt('manual-2'),
      attempt('manual-3'),
    ];
    expect(retainAttemptLedger(attempts, [task], [message], 1).map((item) => item.attemptId))
      .toEqual(['old-task', 'old-message', 'manual-3']);
  });

  it('preserves linked records even before their owner attemptIds mutation is visible', () => {
    const taskLinked = attempt('new-task', 'task');
    const messageLinked = attempt('new-message', 'message');
    expect(retainAttemptLedger([taskLinked, messageLinked], [], [], 0).map((item) => item.attemptId))
      .toEqual(['new-task', 'new-message']);
  });
});
