export type ConvergenceOwnership = 'gam' | 'non-gam' | 'unknown';
export type ConvergencePageActivity = 'generating' | 'idle' | 'unknown';
export type ConvergenceObservationConfidence = 'direct' | 'inferred' | 'unknown';

export interface GamPageFact {
  ownership: ConvergenceOwnership;
  slotId?: string;
  taskId?: string;
  activity: ConvergencePageActivity;
  confidence: ConvergenceObservationConfidence;
  observedAt: number;
}

export interface GamSlotFact {
  ownership: ConvergenceOwnership;
  slotId: string;
  taskId: string;
  resourceId: string;
  leaseEpoch: number;
}

export type ConvergenceAttemptState =
  | 'prepared'
  | 'dispatched'
  | 'acknowledged'
  | 'reply-observed'
  | 'failed'
  | 'uncertain';

export interface AttemptFact {
  attemptId: string;
  taskId: string;
  state: ConvergenceAttemptState;
  updatedAt: number;
}

export type EngineeringProgressKind =
  | 'workspace-change'
  | 'tool-activity'
  | 'test-activity'
  | 'claim-activity';

export interface EngineeringProgressEvidence {
  kind: EngineeringProgressKind;
  taskId: string;
  slotId: string;
  observedAt: number;
}

export interface AuthorizedStopFact {
  taskId: string;
  slotId: string;
  resourceId: string;
  leaseEpoch: number;
  requestedAt: number;
  authorizedAt: number;
}

export interface StuckGenerationInput {
  now: number;
  staleDeadlineAt: number;
  recentProgressSince: number;
  page: GamPageFact;
  slot: GamSlotFact;
  attempt: AttemptFact;
  progressEvidence: readonly EngineeringProgressEvidence[];
  authorizedStop?: AuthorizedStopFact;
}

export type ConvergenceHoldReason =
  | 'identity-unknown-or-not-gam'
  | 'identity-mismatch'
  | 'page-observation-not-direct'
  | 'page-idle-without-cleanup-proof'
  | 'page-state-unknown'
  | 'attempt-not-safe-for-stop'
  | 'under-stale-deadline'
  | 'stale-observation-predates-deadline'
  | 'recent-engineering-progress'
  | 'authorized-stop-awaiting-direct-idle';

export interface ConvergenceTarget {
  taskId: string;
  slotId: string;
  resourceId: string;
  leaseEpoch: number;
  attemptId: string;
}

export type StuckGenerationDecision =
  | { action: 'hold'; reason: ConvergenceHoldReason; allowPromptResend: false }
  | {
      action: 'request-authority-checked-stop';
      reason: 'stale-no-progress';
      target: ConvergenceTarget;
      allowPromptResend: false;
    }
  | {
      action: 'request-cleanup';
      reason: 'direct-idle-after-authorized-stop';
      target: ConvergenceTarget;
      allowPromptResend: false;
    };

function hold(reason: ConvergenceHoldReason): StuckGenerationDecision {
  return { action: 'hold', reason, allowPromptResend: false };
}

function targetOf(input: StuckGenerationInput): ConvergenceTarget {
  return {
    taskId: input.slot.taskId,
    slotId: input.slot.slotId,
    resourceId: input.slot.resourceId,
    leaseEpoch: input.slot.leaseEpoch,
    attemptId: input.attempt.attemptId,
  };
}

function exactGamIdentity(input: StuckGenerationInput): boolean {
  return input.page.ownership === 'gam' && input.slot.ownership === 'gam';
}

function identityMatches(input: StuckGenerationInput): boolean {
  return input.page.slotId === input.slot.slotId
    && input.page.taskId === input.slot.taskId
    && input.attempt.taskId === input.slot.taskId;
}

function stopMatchesCurrentAuthority(input: StuckGenerationInput): boolean {
  const stop = input.authorizedStop;
  if (!stop) return false;
  return stop.taskId === input.slot.taskId
    && stop.slotId === input.slot.slotId
    && stop.resourceId === input.slot.resourceId
    && stop.leaseEpoch === input.slot.leaseEpoch;
}

function hasRecentProgress(input: StuckGenerationInput): boolean {
  return input.progressEvidence.some((evidence) =>
    evidence.taskId === input.slot.taskId
    && evidence.slotId === input.slot.slotId
    && evidence.observedAt >= input.recentProgressSince
    && evidence.observedAt <= input.now,
  );
}

export function convergeStuckGeneration(input: StuckGenerationInput): StuckGenerationDecision {
  if (!exactGamIdentity(input)) return hold('identity-unknown-or-not-gam');
  if (!identityMatches(input)) return hold('identity-mismatch');
  if (input.page.confidence !== 'direct') return hold('page-observation-not-direct');
  if (input.page.activity === 'unknown') return hold('page-state-unknown');

  if (input.page.activity === 'idle') {
    const stop = input.authorizedStop;
    if (!stop || !stopMatchesCurrentAuthority(input)) return hold('page-idle-without-cleanup-proof');
    if (stop.authorizedAt < stop.requestedAt || input.page.observedAt <= stop.authorizedAt) {
      return hold('page-idle-without-cleanup-proof');
    }
    return {
      action: 'request-cleanup',
      reason: 'direct-idle-after-authorized-stop',
      target: targetOf(input),
      allowPromptResend: false,
    };
  }

  if (input.authorizedStop) {
    if (!stopMatchesCurrentAuthority(input)) return hold('identity-mismatch');
    return hold('authorized-stop-awaiting-direct-idle');
  }

  if (input.attempt.state !== 'acknowledged') return hold('attempt-not-safe-for-stop');
  if (input.now < input.staleDeadlineAt) return hold('under-stale-deadline');
  if (input.page.observedAt < input.staleDeadlineAt) return hold('stale-observation-predates-deadline');
  if (hasRecentProgress(input)) return hold('recent-engineering-progress');

  return {
    action: 'request-authority-checked-stop',
    reason: 'stale-no-progress',
    target: targetOf(input),
    allowPromptResend: false,
  };
}
