import type { AgentTask, ManagedTask, SendAttemptRecord, TaskDisplayStatus } from './contracts';

export function validateTaskGraph(tasks: readonly AgentTask[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error('Task ids must be unique');
  for (const task of tasks) {
    if (!task.title.trim() || !task.instruction.trim() || !task.targetRole.trim()) {
      throw new Error('Task title, instruction, and target role are required');
    }
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) throw new Error(`Task ${task.id} cannot depend on itself`);
      if (!byId.has(dependency)) throw new Error(`Task ${task.id} depends on missing task ${dependency}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskId: string): void => {
    if (visited.has(taskId)) return;
    if (visiting.has(taskId)) throw new Error('Task dependencies must form a DAG');
    visiting.add(taskId);
    for (const dependency of byId.get(taskId)?.dependsOn ?? []) visit(dependency);
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const task of tasks) visit(task.id);
}

function statusFromAttempt(attempt: SendAttemptRecord | undefined): TaskDisplayStatus | undefined {
  switch (attempt?.state) {
    case 'reply-observed': return 'completed';
    case 'prepared':
    case 'dispatched':
    case 'acknowledged': return 'running';
    case 'failed': return 'error';
    case 'uncertain': return 'attention';
    default: return undefined;
  }
}

export function deriveManagedTasks(
  tasks: readonly AgentTask[],
  attempts: readonly SendAttemptRecord[],
): ManagedTask[] {
  const attemptsById = new Map(attempts.map((attempt) => [attempt.attemptId, attempt]));
  const result = new Map<string, ManagedTask>();

  const derive = (task: AgentTask): ManagedTask => {
    const cached = result.get(task.id);
    if (cached) return cached;
    const lastAttemptId = task.attemptIds.at(-1);
    const lastAttempt = lastAttemptId ? attemptsById.get(lastAttemptId) : undefined;
    const retryRequested = Boolean(
      lastAttempt &&
      task.retryAfterAttemptId === lastAttempt.attemptId &&
      (lastAttempt.state === 'failed' || lastAttempt.state === 'uncertain'),
    );
    const attemptStatus = retryRequested ? undefined : statusFromAttempt(lastAttempt);
    let status: TaskDisplayStatus;
    if (attemptStatus) {
      status = attemptStatus;
    } else {
      const dependencies = task.dependsOn.map((id) => tasks.find((candidate) => candidate.id === id)).filter(Boolean) as AgentTask[];
      const dependencyStates = dependencies.map((dependency) => derive(dependency).status);
      if (dependencyStates.some((state) => ['error', 'attention', 'blocked'].includes(state))) status = 'blocked';
      else if (dependencyStates.every((state) => state === 'completed')) status = 'ready';
      else status = task.dependsOn.length === 0 ? 'ready' : 'pending';
    }
    const managed: ManagedTask = { task, status };
    if (lastAttempt) managed.lastAttempt = lastAttempt;
    result.set(task.id, managed);
    return managed;
  };

  return tasks.map(derive);
}