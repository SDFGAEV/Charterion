export const NATIVE_CONTROL_HOST = 'com.gpt_agent_manager.control';
const PROJECT_STATUSES = new Set(['active', 'draining', 'paused', 'archived']);
const AGENT_STATUSES = new Set(['idle', 'assigned', 'suspended', 'retired']);
const AGENT_DESIRED_STATES = new Set(['active','suspended','retired']);
const AGENT_BROWSER_STATES = new Set(['absent','opening','open','closing','error']);
const LEASE_MODES = new Set(['shared', 'exclusive']);
const LEASE_STATUSES = new Set(['active', 'released', 'expired']);
const CHANGE_STATUSES = new Set(['open','changes-requested','approved','queued','integrated','closed']);
const REVIEW_VERDICTS = new Set(['approve','request-changes']);
const QUEUE_STATUSES = new Set(['queued','validating','integrated','failed','cancelled']);
const BROWSER_AUTH_STATUSES = new Set(['unknown','authenticated','authentication-required']);
const BROWSER_PAGE_HEALTHS = new Set(['unknown','ready','generating','blocked','error','unavailable']);
const WORKER_REQUEST_TYPES = new Set(['suggestion','blocker','question','resource-request','scope-change','dependency-request','cross-system-request','review-request','risk-alert','worker-request']);
const WORKER_REQUEST_STATUSES = new Set(['open','accepted','rejected','resolved']);

export interface ControlProjectView {
  id: string;
  name: string;
  rootPath: string;
  status: 'active' | 'draining' | 'paused' | 'archived';
  isolationTier: string;
  minSlots: number;
  maxSlots: number;
  weight: number;
}

export interface ControlAgentView {
  id: string;
  projectId: string;
  role: string;
  status: 'idle' | 'assigned' | 'suspended' | 'retired';
  desiredState: 'active' | 'suspended' | 'retired';
  browserState: 'absent' | 'opening' | 'open' | 'closing' | 'error';
  conversationKey?: string;
  browserProfileId?: string;
  browserTabId?: number;
  browserError?: string;
  browserObservedAt?: number;
  leaseEpoch: number;
}

export interface ControlResourceView {
  id: string;
  projectId?: string;
  parentId?: string;
  kind: string;
  label: string;
  metadata: Record<string, unknown>;
}

export interface ControlLeaseView {
  id: string;
  resourceId: string;
  projectId: string;
  holderId: string;
  taskId?: string;
  mode: 'shared' | 'exclusive';
  epoch: number;
  status: 'active' | 'released' | 'expired';
  expiresAt?: number;
}

export interface ControlEventView {
  seq: number;
  projectId?: string;
  type: string;
  subject: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface ControlChangeRequestView {
  id: string; projectId: string; taskId: string; authorSubject: string; branch: string; targetBranch: string; baseSha: string; headSha: string; claimId: string;
  revision: number; status: 'open'|'changes-requested'|'approved'|'queued'|'integrated'|'closed';
}
export interface ControlReviewView {
  id: string; projectId: string; changeRequestId: string; reviewerSubject: string; headSha: string; verdict: 'approve'|'request-changes'; body: string; createdAt: number;
}
export interface ControlMergeQueueView {
  id: string; projectId: string; changeRequestId: string; headSha: string; targetBranch: string; status: 'queued'|'validating'|'integrated'|'failed'|'cancelled'; queuedAt: number; updatedAt: number;
  candidateBaseSha?: string; candidateSha?: string; error?: string; integratedSha?: string;
}

export interface ControlBrowserRuntimeView {
  profileId: string;
  authStatus: 'unknown' | 'authenticated' | 'authentication-required';
  pageHealth: 'unknown' | 'ready' | 'generating' | 'blocked' | 'error' | 'unavailable';
  openTabs: number;
  extensionVersion: string;
  observedAt: number;
}

export interface BrowserRuntimeReportInput {
  profileId: string;
  authStatus: ControlBrowserRuntimeView['authStatus'];
  pageHealth: ControlBrowserRuntimeView['pageHealth'];
  openTabs: number;
  extensionVersion: string;
  observedAt: number;
}
export interface ControlWorkerRequestView {
  id: string; projectId: string; taskId?: string; fromSubject: string;
  type: 'suggestion'|'blocker'|'question'|'resource-request'|'scope-change'|'dependency-request'|'cross-system-request'|'review-request'|'risk-alert'|'worker-request';
  title: string; body: string; suggestedAction?: string; status: 'open'|'accepted'|'rejected'|'resolved';
  decidedBy?: string; decisionNote?: string; createdAt: number; updatedAt: number;
}

export interface NativeControlSnapshot {
  protocolVersion: 2;
  projects: ControlProjectView[];
  agents: ControlAgentView[];
  resources: ControlResourceView[];
  leases: ControlLeaseView[];
  changeRequests: ControlChangeRequestView[];
  reviews: ControlReviewView[];
  mergeQueue: ControlMergeQueueView[];
  workerRequests: ControlWorkerRequestView[];
  browserRuntime: ControlBrowserRuntimeView[];
  events: ControlEventView[];
}

interface NativeRpcResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value as Record<string, unknown>;
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

function numberField(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a number`);
  return value;
}

function enumField(value: unknown, label: string, allowed: ReadonlySet<string>): string {
  const text = stringField(value, label);
  if (!allowed.has(text)) throw new Error(label + ' is invalid');
  return text;
}

function arrayField(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

export function parseNativeControlSnapshot(value: unknown): NativeControlSnapshot {
  const root = record(value, 'control snapshot');
  if (root.protocolVersion !== 2) throw new Error('Unsupported control protocol version');
  const projects = arrayField(root.projects, 'projects').map((entry, index) => {
    const item = record(entry, `projects[${index}]`);
    return {
      id: stringField(item.id, 'project.id'), name: stringField(item.name, 'project.name'),
      rootPath: stringField(item.rootPath, 'project.rootPath'), status: enumField(item.status, 'project.status', PROJECT_STATUSES) as ControlProjectView['status'],
      isolationTier: stringField(item.isolationTier, 'project.isolationTier'), minSlots: numberField(item.minSlots, 'project.minSlots'),
      maxSlots: numberField(item.maxSlots, 'project.maxSlots'), weight: numberField(item.weight, 'project.weight'),
    };
  });
  const agents = arrayField(root.agents, 'agents').map((entry, index) => {
    const item = record(entry, `agents[${index}]`);
    const agent: ControlAgentView = {
      id: stringField(item.id, 'agent.id'), projectId: stringField(item.projectId, 'agent.projectId'),
      role: stringField(item.role, 'agent.role'), status: enumField(item.status, 'agent.status', AGENT_STATUSES) as ControlAgentView['status'],
      desiredState: enumField(item.desiredState, 'agent.desiredState', AGENT_DESIRED_STATES) as ControlAgentView['desiredState'],
      browserState: enumField(item.browserState, 'agent.browserState', AGENT_BROWSER_STATES) as ControlAgentView['browserState'],
      leaseEpoch: numberField(item.leaseEpoch, 'agent.leaseEpoch'),
    };
    if (item.conversationKey !== undefined) agent.conversationKey = stringField(item.conversationKey, 'agent.conversationKey');
    if (item.browserProfileId !== undefined) agent.browserProfileId = stringField(item.browserProfileId, 'agent.browserProfileId');
    if (item.browserTabId !== undefined) agent.browserTabId = numberField(item.browserTabId, 'agent.browserTabId');
    if (item.browserError !== undefined) agent.browserError = stringField(item.browserError, 'agent.browserError');
    if (item.browserObservedAt !== undefined) agent.browserObservedAt = numberField(item.browserObservedAt, 'agent.browserObservedAt');
    return agent;
  });
  const resources = arrayField(root.resources, 'resources').map((entry, index) => {
    const item = record(entry, `resources[${index}]`);
    const resource: ControlResourceView = {
      id: stringField(item.id, 'resource.id'), kind: stringField(item.kind, 'resource.kind'),
      label: stringField(item.label, 'resource.label'), metadata: record(item.metadata, 'resource.metadata'),
    };
    if (item.projectId !== undefined) resource.projectId = stringField(item.projectId, 'resource.projectId');
    if (item.parentId !== undefined) resource.parentId = stringField(item.parentId, 'resource.parentId');
    return resource;
  });
  const leases = arrayField(root.leases, 'leases').map((entry, index) => {
    const item = record(entry, `leases[${index}]`);
    const lease: ControlLeaseView = {
      id: stringField(item.id, 'lease.id'), resourceId: stringField(item.resourceId, 'lease.resourceId'),
      projectId: stringField(item.projectId, 'lease.projectId'), holderId: stringField(item.holderId, 'lease.holderId'),
      mode: enumField(item.mode, 'lease.mode', LEASE_MODES) as ControlLeaseView['mode'], epoch: numberField(item.epoch, 'lease.epoch'),
      status: enumField(item.status, 'lease.status', LEASE_STATUSES) as ControlLeaseView['status'],
    };
    if (item.taskId !== undefined) lease.taskId = stringField(item.taskId, 'lease.taskId');
    if (item.expiresAt !== undefined) lease.expiresAt = numberField(item.expiresAt, 'lease.expiresAt');
    return lease;
  });
  const changeRequests = arrayField(root.changeRequests, 'changeRequests').map((entry, index) => {
    const item = record(entry, `changeRequests[${index}]`);
    return { id: stringField(item.id,'change.id'), projectId: stringField(item.projectId,'change.projectId'), taskId: stringField(item.taskId,'change.taskId'),
      authorSubject: stringField(item.authorSubject,'change.authorSubject'), branch: stringField(item.branch,'change.branch'), targetBranch: stringField(item.targetBranch,'change.targetBranch'),
      baseSha: stringField(item.baseSha,'change.baseSha'), headSha: stringField(item.headSha,'change.headSha'), claimId: stringField(item.claimId,'change.claimId'),
      revision: numberField(item.revision,'change.revision'), status: enumField(item.status,'change.status',CHANGE_STATUSES) as ControlChangeRequestView['status'] };
  });
  const reviews = arrayField(root.reviews, 'reviews').map((entry, index) => {
    const item = record(entry, `reviews[${index}]`);
    return { id: stringField(item.id,'review.id'), projectId: stringField(item.projectId,'review.projectId'), changeRequestId: stringField(item.changeRequestId,'review.changeRequestId'),
      reviewerSubject: stringField(item.reviewerSubject,'review.reviewerSubject'), headSha: stringField(item.headSha,'review.headSha'),
      verdict: enumField(item.verdict,'review.verdict',REVIEW_VERDICTS) as ControlReviewView['verdict'], body: stringField(item.body,'review.body'), createdAt: numberField(item.createdAt,'review.createdAt') };
  });
  const mergeQueue = arrayField(root.mergeQueue, 'mergeQueue').map((entry, index) => {
    const item = record(entry, `mergeQueue[${index}]`);
    const queue: ControlMergeQueueView = { id: stringField(item.id,'queue.id'), projectId: stringField(item.projectId,'queue.projectId'), changeRequestId: stringField(item.changeRequestId,'queue.changeRequestId'),
      headSha: stringField(item.headSha,'queue.headSha'), targetBranch: stringField(item.targetBranch,'queue.targetBranch'), status: enumField(item.status,'queue.status',QUEUE_STATUSES) as ControlMergeQueueView['status'],
      queuedAt: numberField(item.queuedAt,'queue.queuedAt'), updatedAt: numberField(item.updatedAt,'queue.updatedAt') };
    if (item.candidateBaseSha !== undefined) queue.candidateBaseSha = stringField(item.candidateBaseSha,'queue.candidateBaseSha');
    if (item.candidateSha !== undefined) queue.candidateSha = stringField(item.candidateSha,'queue.candidateSha');
    if (item.error !== undefined) queue.error = stringField(item.error,'queue.error');
    if (item.integratedSha !== undefined) queue.integratedSha = stringField(item.integratedSha,'queue.integratedSha');
    return queue;
  });
  const workerRequests = arrayField(root.workerRequests, 'workerRequests').map((entry, index) => {
    const item = record(entry, `workerRequests[${index}]`);
    const request: ControlWorkerRequestView = {
      id: stringField(item.id,'request.id'), projectId: stringField(item.projectId,'request.projectId'), fromSubject: stringField(item.fromSubject,'request.fromSubject'),
      type: enumField(item.type,'request.type',WORKER_REQUEST_TYPES) as ControlWorkerRequestView['type'], title: stringField(item.title,'request.title'), body: stringField(item.body,'request.body'),
      status: enumField(item.status,'request.status',WORKER_REQUEST_STATUSES) as ControlWorkerRequestView['status'], createdAt: numberField(item.createdAt,'request.createdAt'), updatedAt: numberField(item.updatedAt,'request.updatedAt'),
    };
    if (item.taskId !== undefined) request.taskId = stringField(item.taskId,'request.taskId');
    if (item.suggestedAction !== undefined) request.suggestedAction = stringField(item.suggestedAction,'request.suggestedAction');
    if (item.decidedBy !== undefined) request.decidedBy = stringField(item.decidedBy,'request.decidedBy');
    if (item.decisionNote !== undefined) request.decisionNote = stringField(item.decisionNote,'request.decisionNote');
    return request;
  });
  const browserRuntime = arrayField(root.browserRuntime, 'browserRuntime').map((entry, index) => {
    const item = record(entry, `browserRuntime[${index}]`);
    return {
      profileId: stringField(item.profileId, 'browser.profileId'),
      authStatus: enumField(item.authStatus, 'browser.authStatus', BROWSER_AUTH_STATUSES) as ControlBrowserRuntimeView['authStatus'],
      pageHealth: enumField(item.pageHealth, 'browser.pageHealth', BROWSER_PAGE_HEALTHS) as ControlBrowserRuntimeView['pageHealth'],
      openTabs: numberField(item.openTabs, 'browser.openTabs'),
      extensionVersion: stringField(item.extensionVersion, 'browser.extensionVersion'),
      observedAt: numberField(item.observedAt, 'browser.observedAt'),
    };
  });  const events = arrayField(root.events, 'events').map((entry, index) => {
    const item = record(entry, `events[${index}]`);
    const event: ControlEventView = {
      seq: numberField(item.seq, 'event.seq'), type: stringField(item.type, 'event.type'),
      subject: stringField(item.subject, 'event.subject'), payload: record(item.payload, 'event.payload'),
      createdAt: numberField(item.createdAt, 'event.createdAt'),
    };
    if (item.projectId !== undefined) event.projectId = stringField(item.projectId, 'event.projectId');
    return event;
  });
  return { protocolVersion: 2, projects, agents, resources, leases, changeRequests, reviews, mergeQueue, workerRequests, browserRuntime, events };
}

export async function readNativeControlSnapshot(): Promise<NativeControlSnapshot> {
  const request = { id: crypto.randomUUID(), method: 'control.snapshot', params: {} };
  let response: NativeRpcResponse;
  try {
    response = await chrome.runtime.sendNativeMessage(NATIVE_CONTROL_HOST, request) as NativeRpcResponse;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Native control plane is unavailable: ${reason}`);
  }
  if (!response?.ok) {
    const reason = response?.error?.message ?? 'Native control host rejected the request';
    throw new Error(reason);
  }
  return parseNativeControlSnapshot(response.result);
}

export async function reportNativeBrowserRuntime(input: BrowserRuntimeReportInput): Promise<void> {
  const request = { id: crypto.randomUUID(), method: 'browser.report', params: input };
  let response: NativeRpcResponse;
  try {
    response = await chrome.runtime.sendNativeMessage(NATIVE_CONTROL_HOST, request) as NativeRpcResponse;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Native control plane is unavailable: ${reason}`);
  }
  if (!response?.ok) throw new Error(response?.error?.message ?? 'Native control host rejected browser runtime report');
}

export interface AgentBrowserReportInput {
  slotId: string; profileId: string; browserState: ControlAgentView['browserState'];
  tabId?: number; conversationKey?: string; error?: string; observedAt: number;
}

export async function reportNativeAgentBrowser(input: AgentBrowserReportInput): Promise<void> {
  const request = { id: crypto.randomUUID(), method: 'agent.browser-report', params: input };
  let response: NativeRpcResponse;
  try { response = await chrome.runtime.sendNativeMessage(NATIVE_CONTROL_HOST, request) as NativeRpcResponse; }
  catch (error) { throw new Error(`Native control plane is unavailable: ${error instanceof Error ? error.message : String(error)}`); }
  if (!response?.ok) throw new Error(response?.error?.message ?? 'Native control host rejected agent browser report');
}
