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
    contentEpoch: 'content-epoch',
    state: 'reply-observed', textLength: 1, baselineAssistantMessageCount: 0,
    replyMessageId: `message:${id}`, replyTextTail: output, createdAt: 1, updatedAt: 2,
  };
  t.attemptIds = [attempt.attemptId];
  return { task: t, status: 'completed', lastAttempt: attempt, attemptHistory: [attempt] };
}

describe('task dispatch prompt', () => {
  it('places company policy and role charter before the task brief', () => {
    const current = { ...task('impl'), project: 'Platform', targetRole: 'ROLE_IMPL_ENGINEER' };
    const prompt = buildTaskDispatchPrompt(current, []);
    expect(prompt).toContain('policyVersion: gam-company-v1');
    expect(prompt).toContain('roleClass: implementer');
    expect(prompt.indexOf('--- GAM company system policy ---')).toBeLessThan(prompt.indexOf('--- GAM task brief ---'));
    expect(prompt.indexOf('--- GAM task brief ---')).toBeLessThan(prompt.indexOf('Do impl'));
  });

  it('routes direct dependency evidence with provenance into the next agent prompt', () => {
    const current = { ...task('b'), dependsOn: ['a'] };
    const prompt = buildTaskDispatchPrompt(current, [dependency('a', 'implemented feature X')]);
    expect(prompt).toContain('Do b');
    expect(prompt).toContain('Dependency task: Task a');
    expect(prompt).toContain('taskId: a');
    expect(prompt).toContain('role: role-a');
    expect(prompt).toContain('replyMessageId: message:a');
    expect(prompt).toContain('implemented feature X');
    expect(prompt).toContain('Company System Policy and Task Brief above are authoritative in that order');
  });

  it('does not route unfinished dependencies', () => {
    const dep = dependency('a', 'should not appear'); dep.status = 'running';
    const prompt = buildTaskDispatchPrompt(task('b'), [dep]);
    expect(prompt).toContain('Do b');
    expect(prompt).not.toContain('should not appear');
  });

  it('bounds dependency context even for very large replies', () => {
    const huge = 'x'.repeat(MAX_DEPENDENCY_CONTEXT_CHARS * 2);
    const prompt = buildTaskDispatchPrompt(task('b'), [dependency('a', huge)]);
    expect(prompt.length).toBeLessThan(MAX_DEPENDENCY_CONTEXT_CHARS + 10000);
  });

  it('adds the strict review protocol after dependency evidence for review tasks', () => {
    const prompt = buildTaskDispatchPrompt(task('review', 'review'), [dependency('a', 'candidate result')]);
    expect(prompt).toContain('candidate result');
    expect(prompt).toContain('<GAM_REVIEW>');
    expect(prompt.trim().endsWith('Do not place any text after the closing tag.')).toBe(true);
  });
  it('adds the strict structured-result protocol for semantic work', () => {
    const structured = { ...task('audit'), completionPolicy: 'structured-result' as const };
    const prompt = buildTaskDispatchPrompt(structured, []);
    expect(prompt).toContain('<GAM_RESULT>');
    expect(prompt).toContain('exactly status, summary, and evidence');
    expect(prompt.trim().endsWith('Do not place any text after the closing tag.')).toBe(true);
  });

  it('makes protocol retries explicit in the next structured-result dispatch', () => {
    const structured = { ...task('audit'), completionPolicy: 'structured-result' as const, retryAfterAttemptId: 'attempt-bad' };
    const prompt = buildTaskDispatchPrompt(structured, [], undefined, {
      attemptId: 'attempt-bad',
      error: 'Structured-result reply must end with one <GAM_RESULT> JSON block',
    });
    expect(prompt).toContain('Protocol retry: prior attempt attempt-bad was rejected');
    expect(prompt).toContain('explicit retry of that protocol-invalid reply');
  });

  it('requires a Kernel workspace for verified-claim work', () => {
    const verified = { ...task('verified'), completionPolicy: 'verified-claim' as const };
    expect(() => buildTaskDispatchPrompt(verified, [])).toThrow(/requires a Kernel-provisioned workspace/i);
  });

  it('injects only scoped capability completion instructions for verified-claim work', () => {
    const verified = { ...task('verified'), completionPolicy: 'verified-claim' as const };
    const prompt = buildTaskDispatchPrompt(verified, [], {
      projectId: 'project-1', taskId: verified.id, slotId: 'slot-1', path: 'E:\\gam\\worktrees\\worker',
      branch: 'gam/worker/verified', baseSha: 'a'.repeat(40), resourceId: 'resource-1', leaseEpoch: 3,
      capabilityTokenPath: 'E:\\gam\\capabilities\\task.token', controlCliPath: 'E:\\gam\\GAMCTL.cmd',
    });
    expect(prompt).toContain('Work only inside the assigned worktree');
    expect(prompt).toContain('claim.verify');
    expect(prompt).toContain('--capability-file');
    expect(prompt).toContain('--stdin');
    expect(prompt).toContain('leaseEpoch: 3');
    expect(prompt).toContain('Never use --admin');
    expect(prompt).not.toContain('adminToken');
  });
});
