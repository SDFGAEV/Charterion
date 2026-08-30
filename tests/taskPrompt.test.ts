import { describe, expect, it } from 'vitest';
import { buildTaskDispatchPrompt, MAX_DEPENDENCY_CONTEXT_CHARS } from '../src/taskPrompt';
import type { AgentTask, ManagedTask, SendAttemptRecord } from '../src/contracts';

function task(id: string, kind: AgentTask['kind'] = 'work'): AgentTask {
  return { id, kind, completionPolicy: kind === 'review' ? 'review-pass' : kind === 'human' ? 'human-approval' : 'reply', title: `Task ${id}`, project: '', instruction: `Do ${id}`, targetRole: `role-${id}`, dependsOn: [], attemptIds: [], createdAt: 1, updatedAt: 1 };
}

function dependency(id: string, output: string): ManagedTask {
  const t = task(id);
  const attempt: SendAttemptRecord = {
    attemptId: `attempt-${id}`, batchId: 'batch', tabId: 1, conversationKey: `conversation:${id}`,
    state: 'reply-observed', textLength: 1, baselineAssistantMessageCount: 0,
    replyMessageId: `message:${id}`, replyTextTail: output, createdAt: 1, updatedAt: 2,
  };
  t.attemptIds = [attempt.attemptId];
  return { task: t, status: 'completed', lastAttempt: attempt, attemptHistory: [attempt] };
}

describe('task dispatch prompt', () => {
  it('routes direct dependency evidence with provenance into the next agent prompt', () => {
    const current = { ...task('b'), dependsOn: ['a'] };
    const prompt = buildTaskDispatchPrompt(current, [dependency('a', 'implemented feature X')]);
    expect(prompt).toContain('Do b');
    expect(prompt).toContain('Dependency task: Task a');
    expect(prompt).toContain('taskId: a');
    expect(prompt).toContain('role: role-a');
    expect(prompt).toContain('replyMessageId: message:a');
    expect(prompt).toContain('implemented feature X');
    expect(prompt).toContain('current task instruction above is authoritative');
  });

  it('does not route unfinished dependencies', () => {
    const dep = dependency('a', 'should not appear'); dep.status = 'running';
    expect(buildTaskDispatchPrompt(task('b'), [dep])).toBe('Do b');
  });

  it('bounds dependency context even for very large replies', () => {
    const huge = 'x'.repeat(MAX_DEPENDENCY_CONTEXT_CHARS * 2);
    const prompt = buildTaskDispatchPrompt(task('b'), [dependency('a', huge)]);
    expect(prompt.length).toBeLessThan(MAX_DEPENDENCY_CONTEXT_CHARS + 1000);
  });

  it('adds the strict review protocol after dependency evidence for review tasks', () => {
    const prompt = buildTaskDispatchPrompt(task('review', 'review'), [dependency('a', 'candidate result')]);
    expect(prompt).toContain('candidate result');
    expect(prompt).toContain('<GAM_REVIEW>');
    expect(prompt.trim().endsWith('Do not place any text after the closing tag.')).toBe(true);
  });
});
