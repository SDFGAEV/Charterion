import { createHash } from 'node:crypto';
import type {
  AgentWorkspaceDangerousActionPolicy,
  AgentWorkspaceSecurityMode,
  AgentWorkspaceToolPolicyState,
} from './organizationContracts';

export const WORKSPACE_CHARTER_VERSION = 'workspace-charter-v2';

export interface WorkspacePolicyInput {
  agentId: string;
  rootRef: string;
  browserProfileId: string;
  toolProfileRef: string;
  securityMode: AgentWorkspaceSecurityMode;
  allowedRefs: string[];
  forbiddenRefs: string[];
  dangerousActionPolicy: AgentWorkspaceDangerousActionPolicy;
  toolPolicyState: AgentWorkspaceToolPolicyState;
}

export interface WorkspacePolicyBundle extends WorkspacePolicyInput {
  version: string;
  digest: string;
  prompt: string;
}
function sortedUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function canonicalPayload(input: WorkspacePolicyInput): Record<string, unknown> {
  return {
    agentId: input.agentId,
    rootRef: input.rootRef.trim(),
    browserProfileId: input.browserProfileId.trim(),
    toolProfileRef: input.toolProfileRef.trim(),
    securityMode: input.securityMode,
    allowedRefs: sortedUnique(input.allowedRefs),
    forbiddenRefs: sortedUnique(input.forbiddenRefs),
    dangerousActionPolicy: input.dangerousActionPolicy,
    toolPolicyState: input.toolPolicyState,
    version: WORKSPACE_CHARTER_VERSION,
  };
}

function digest(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
function renderRefs(title: string, values: string[]): string[] {
  const normalized = sortedUnique(values);
  return normalized.length > 0
    ? [title, ...normalized.map((value) => `- ${value}`)]
    : [title, '- none declared'];
}

export function buildWorkspacePolicy(input: WorkspacePolicyInput): WorkspacePolicyBundle {
  const payload = canonicalPayload(input);
  const policyDigest = digest(payload);
  const allowedRefs = payload.allowedRefs as string[];
  const forbiddenRefs = payload.forbiddenRefs as string[];
  const rootRef = String(payload.rootRef);
  const dangerous = input.dangerousActionPolicy === 'deny'
    ? 'Do not perform destructive or host-wide actions.'
    : 'Destructive, host-wide, production, or authority-changing actions require an explicit approval reference before execution.';
  const enforcement = input.securityMode === 'tool-scoped'
    ? 'Tool configuration is expected to enforce the declared scope in addition to these instructions.'
    : input.securityMode === 'sandboxed'
      ? 'A sandbox is expected, but you must still follow this charter.'
      : 'This workspace is prompt-guarded; do not treat the absence of a hard sandbox as permission to leave scope.';
  const lines = [
    `CHARTERION AGENT WORKSPACE CHARTER ${WORKSPACE_CHARTER_VERSION}`,
    `Agent: ${input.agentId}`,
    `Workspace root: ${rootRef}`,
    enforcement,
    '',
    'Operate from this dedicated workspace by default. Do not wander across the host merely because a shell or Remote tool technically can.',
    'Do not modify another Agent workspace, Charterion control state, Parent/promotion authority, user home, system directories, global services, registry, firewall, or unrelated processes unless an explicit approved work item authorizes that exact effect.',
    'Prefer project-local or workspace-local installs. Do not make machine-wide package, service, startup, credential, or environment changes for convenience.',
    'Do not weaken, disable, reconfigure, or bypass workspace/tool scope controls. If a required resource is outside scope, request access or report a blocker.',
    dangerous,
    '',
    ...renderRefs('Explicitly allowed references:', allowedRefs),
    '',
    ...renderRefs('Explicitly forbidden references:', forbiddenRefs),
    '',
    'When uncertain whether an operation leaves the workspace or changes host-wide state, do not guess: surface the intended effect and request organizational approval.',
  ];
  return {
    ...input,
    rootRef,
    allowedRefs,
    forbiddenRefs,
    version: WORKSPACE_CHARTER_VERSION,
    digest: policyDigest,
    prompt: lines.join('\n'),
  };
}
