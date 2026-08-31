import { describe, expect, it } from 'vitest';
import { planExactTaskDispatch } from '../src/exactTaskDispatch';
import type { AgentTask, ManagedTask, TaskDisplayStatus } from '../src/contracts';

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'target',
    kind: 'work',
    completionPolicy: 'structured-result',
    title: 'Target task',
    project: 'Project A',
    instruction: 'Do only the requested task',
    targetRole: 'IMPLEMENTER',
    dependsOn: [],
    attemptIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function managed(
  status: TaskDisplayStatus = 'ready',
  overrides: Partial<AgentTask> = {},
): ManagedTask {
  return { task: task(overrides), status, attemptHistory: [] };
}
describe('exact single-task dispatch planning', () => {
  it('returns only the exact ready task and preserves verified-claim task metadata', () => {
    const exact = managed('ready', {
      completionPolicy: 'verified-claim',
      attemptIds: ['attempt-1'],
      retryAfterAttemptId: 'attempt-1',
      revisionInstruction: 'Keep the exact workspace authority',
    });
    const sameProjectOther = managed('ready', { id: 'other' });
    const otherProject = managed('ready', { id: 'foreign', project: 'Project B' });
    const originalTask = { ...exact.task, attemptIds: [...exact.task.attemptIds] };

    const plan = planExactTaskDispatch(
      [sameProjectOther, otherProject, exact],
      { taskId: 'target', project: 'Project A' },
    );

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.taskId).toBe('target');
    expect(plan.project).toBe('Project A');
    expect(plan.managedTask).toBe(exact);
    expect(plan.completionPolicy).toBe('verified-claim');
    expect(plan.dispatchBoundary).toBe('prompt-governor-required');
    expect(exact.task).toEqual(originalTask);
  });
  it('fails closed on project mismatch and never falls through to another ready task', () => {
    const plan = planExactTaskDispatch(
      [managed('ready', { project: 'Project B' }), managed('ready', { id: 'other', project: 'Project A' })],
      { taskId: 'target', project: 'Project A' },
    );

    expect(plan).toMatchObject({ ok: false, reason: 'project-mismatch', taskId: 'target', project: 'Project A' });
  });

  it('fails closed when the requested id is missing or ambiguous', () => {
    expect(planExactTaskDispatch(
      [managed('ready', { id: 'other' })],
      { taskId: 'target', project: 'Project A' },
    )).toMatchObject({ ok: false, reason: 'task-not-found' });

    expect(planExactTaskDispatch(
      [managed(), managed('ready', { project: 'Project B' })],
      { taskId: 'target', project: 'Project A' },
    )).toMatchObject({ ok: false, reason: 'ambiguous-task-id' });
  });

  it('never dispatches human tasks even if a stale caller labels one ready', () => {
    const plan = planExactTaskDispatch(
      [managed('ready', { kind: 'human', completionPolicy: 'human-approval' })],
      { taskId: 'target', project: 'Project A' },
    );
    expect(plan).toMatchObject({ ok: false, reason: 'human-task' });
  });
  it('fails closed on cancellation and terminal facts even if status is stale-ready', () => {
    const cancelled = planExactTaskDispatch(
      [managed('ready', { cancelledAt: 9, cancelReason: 'stopped' })],
      { taskId: 'target', project: 'Project A' },
    );
    expect(cancelled).toMatchObject({ ok: false, reason: 'cancelled-task' });

    const skipped = planExactTaskDispatch(
      [managed('ready', { skippedAt: 9, skipReason: 'not needed' })],
      { taskId: 'target', project: 'Project A' },
    );
    expect(skipped).toMatchObject({ ok: false, reason: 'terminal-task' });

    const completed = managed('ready', {
      completionPolicy: 'verified-claim',
      machineCompletion: {
        kind: 'verified-claim', claimId: 'claim-1', verificationId: 'verification-1',
        completedAt: 9, commitSha: 'abc123',
      },
    });
    const before = completed.task.machineCompletion;
    expect(planExactTaskDispatch(
      [completed],
      { taskId: 'target', project: 'Project A' },
    )).toMatchObject({ ok: false, reason: 'terminal-task' });
    expect(completed.task.machineCompletion).toBe(before);
  });
  it.each<TaskDisplayStatus>([
    'pending', 'running', 'waiting-human', 'blocked', 'error', 'attention',
  ])('rejects non-ready status %s', (status) => {
    expect(planExactTaskDispatch(
      [managed(status)],
      { taskId: 'target', project: 'Project A' },
    )).toMatchObject({ ok: false, reason: 'task-not-ready' });
  });

  it.each<TaskDisplayStatus>(['completed', 'skipped', 'rejected'])(
    'rejects terminal display status %s',
    (status) => {
      expect(planExactTaskDispatch(
        [managed(status)],
        { taskId: 'target', project: 'Project A' },
      )).toMatchObject({ ok: false, reason: 'terminal-task' });
    },
  );

  it('rejects cancelled display status separately', () => {
    expect(planExactTaskDispatch(
      [managed('cancelled')],
      { taskId: 'target', project: 'Project A' },
    )).toMatchObject({ ok: false, reason: 'cancelled-task' });
  });
  it('returns a plan, never an alternate physical-send path around the governor', () => {
    const review = managed('ready', {
      kind: 'review', completionPolicy: 'review-pass', targetRole: 'SUPERVISOR',
    });
    const plan = planExactTaskDispatch(
      [review],
      { taskId: 'target', project: 'Project A' },
    );

    expect(plan).toMatchObject({ ok: true, dispatchBoundary: 'prompt-governor-required' });
    expect(Object.values(plan).some((value) => typeof value === 'function')).toBe(false);
  });

  it('rejects blank exact-task authority inputs', () => {
    expect(planExactTaskDispatch(
      [managed()],
      { taskId: ' ', project: 'Project A' },
    )).toMatchObject({ ok: false, reason: 'invalid-request' });
    expect(planExactTaskDispatch(
      [managed()],
      { taskId: 'target', project: '' },
    )).toMatchObject({ ok: false, reason: 'invalid-request' });
  });
});
