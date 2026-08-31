import type { CapabilityGrant, RpcRequest } from './contracts';
import type { ControlPlane } from './controlPlane';
import type { AgentWorkspaceDangerousActionPolicy, AgentWorkspaceSecurityMode, AgentWorkspaceToolPolicyState, MissionMemberRole, MissionStatus, WorkItemStatus } from './organizationContracts';
import type { WorkPriority, WorkRequesterKind, WorkRequestStatus } from './workIngressContracts';

type Params = Record<string, unknown>;
export interface OrganizationRpcAuth {
  requireAdmin(request: RpcRequest): void;
  requireBrowserOrAdmin(request: RpcRequest): void;
  requireCapability(request: RpcRequest, scope: string, input?: { projectId?: string }): CapabilityGrant;
}

function stringParam(params: Params, key: string, optional = false): string | undefined {
  const value = params[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a non-empty string`);
  return value.trim();
}

function numberParam(params: Params, key: string, optional = false): number | undefined {
  const value = params[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a number`);
  return value;
}

function stringArray(params: Params, key: string): string[] | undefined {
  const value = params[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`${key} must be a string array`);
  return value as string[];
}

function enumParam<T extends string>(params: Params, key: string, allowed: readonly T[], optional = false): T | undefined {
  const value = stringParam(params, key, optional);
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) throw new Error(`${key} is invalid`);
  return value as T;
}

const METHODS = new Set([
  'organization.create','organization.list','organization.snapshot',
  'department.create','department.list','domain.create','domain.list',
  'org-agent.create','org-agent.list','org-agent.bind-runtime','org-agent.unbind-runtime','org-agent.assign-domain',
  'org-agent.workspace-list','org-agent.workspace-request','org-agent.workspace-configure','org-agent.workspace-prompt','org-agent.workspace-fail','org-agent.workspace-retire',
  'mission.create','mission.list','mission.assign-dri','mission.add-member','mission.status',
  'org-work.create','org-work.list','org-work.assign-owner','org-work.status','org-work.complete','org-work.outcome',
  'work-request.submit','work-request.get','work-request.list','work-request.accept','work-request.reject','work-request.cancel',
]);

export class OrganizationRpcController {
  constructor(private readonly plane: ControlPlane, private readonly auth: OrganizationRpcAuth) {}

  canHandle(method: string): boolean { return METHODS.has(method); }

  handle(request: RpcRequest, params: Params): unknown {
    switch (request.method) {
      case 'organization.create': return this.organizationCreate(request, params);
      case 'organization.list': this.auth.requireBrowserOrAdmin(request); return this.plane.organization.listOrganizations();
      case 'organization.snapshot': this.auth.requireBrowserOrAdmin(request); return this.plane.organization.snapshot();
      case 'department.create': return this.departmentCreate(request, params);
      case 'department.list': this.auth.requireBrowserOrAdmin(request); return this.plane.organization.listDepartments(stringParam(params,'organizationId',true));
      case 'domain.create': return this.domainCreate(request, params);
      case 'domain.list': this.auth.requireBrowserOrAdmin(request); return this.plane.organization.listDomains(stringParam(params,'organizationId',true));
      case 'org-agent.create': return this.agentCreate(request, params);
      case 'org-agent.list': this.auth.requireBrowserOrAdmin(request); return this.plane.organization.listAgents(stringParam(params,'organizationId',true));
      case 'org-agent.bind-runtime': this.auth.requireAdmin(request); return this.plane.organization.bindRuntimeSlot(stringParam(params,'agentId')!, stringParam(params,'slotId')!);
      case 'org-agent.unbind-runtime': this.auth.requireAdmin(request); return this.plane.organization.unbindRuntimeSlot(stringParam(params,'agentId')!);
      case 'org-agent.workspace-list': this.auth.requireBrowserOrAdmin(request); return this.plane.organization.listAgentWorkspaces(stringParam(params,'agentId',true));
      case 'org-agent.workspace-request': return this.workspaceRequest(request, params);
      case 'org-agent.workspace-configure': return this.workspaceConfigure(request, params);
      case 'org-agent.workspace-prompt': this.auth.requireBrowserOrAdmin(request); return this.plane.organization.workspacePrompt(stringParam(params,'workspaceId')!);
      case 'org-agent.workspace-fail': this.auth.requireAdmin(request); return this.plane.organization.failAgentWorkspace(stringParam(params,'workspaceId')!, stringParam(params,'error')!);
      case 'org-agent.workspace-retire': this.auth.requireAdmin(request); return this.plane.organization.retireAgentWorkspace(stringParam(params,'workspaceId')!, stringParam(params,'reason')!);
      case 'org-agent.assign-domain': return this.agentAssignDomain(request, params);
      case 'mission.create': return this.missionCreate(request, params);
      case 'mission.list': this.auth.requireBrowserOrAdmin(request); return this.plane.organization.listMissions(stringParam(params,'organizationId',true));
      case 'mission.assign-dri': this.auth.requireAdmin(request); return this.plane.organization.assignMissionDri(stringParam(params,'missionId')!, stringParam(params,'agentId')!);
      case 'mission.add-member': return this.missionAddMember(request, params);
      case 'mission.status': return this.missionStatus(request, params);
      case 'org-work.create': return this.workCreate(request, params);
      case 'org-work.list': this.auth.requireBrowserOrAdmin(request); return this.plane.organization.listWorkItems(stringParam(params,'missionId',true));
      case 'org-work.assign-owner': this.auth.requireAdmin(request); return this.plane.organization.assignWorkOwner(stringParam(params,'workItemId')!, stringParam(params,'agentId')!);
      case 'org-work.status': return this.workStatus(request, params);
      case 'org-work.complete': return this.workComplete(request, params);
      case 'org-work.outcome': this.auth.requireBrowserOrAdmin(request); return this.plane.ingress.getOutcome(stringParam(params,'workItemId')!);
      case 'work-request.submit': return this.requestSubmit(request, params);
      case 'work-request.get': return this.requestGet(request, params);
      case 'work-request.list': return this.requestList(request, params);
      case 'work-request.accept': return this.requestAccept(request, params);
      case 'work-request.reject': return this.requestReject(request, params);
      case 'work-request.cancel': return this.requestCancel(request, params);
      default: throw new Error(`Unknown organization RPC method ${request.method}`);
    }
  }

  private organizationCreate(request: RpcRequest, params: Params): unknown {
    this.auth.requireAdmin(request);
    return this.plane.organization.createOrganization({ name: stringParam(params,'name')!, purpose: stringParam(params,'purpose',true) });
  }

  private departmentCreate(request: RpcRequest, params: Params): unknown {
    this.auth.requireAdmin(request);
    return this.plane.organization.createDepartment({ organizationId: stringParam(params,'organizationId')!, name: stringParam(params,'name')!, purpose: stringParam(params,'purpose',true) });
  }

  private domainCreate(request: RpcRequest, params: Params): unknown {
    this.auth.requireAdmin(request);
    return this.plane.organization.createDomain({ organizationId: stringParam(params,'organizationId')!, departmentId: stringParam(params,'departmentId')!, name: stringParam(params,'name')!, purpose: stringParam(params,'purpose',true) });
  }

  private agentCreate(request: RpcRequest, params: Params): unknown {
    this.auth.requireAdmin(request);
    return this.plane.organization.registerAgent({ organizationId: stringParam(params,'organizationId')!, displayName: stringParam(params,'displayName')!, primaryDepartmentId: stringParam(params,'primaryDepartmentId',true) });
  }

  private workspaceRequest(request: RpcRequest, params: Params): unknown {
    this.auth.requireAdmin(request);
    return this.plane.organization.requestAgentWorkspace({ agentId: stringParam(params,'agentId')! });
  }

  private workspaceConfigure(request: RpcRequest, params: Params): unknown {
    this.auth.requireAdmin(request);
    return this.plane.organization.configureAgentWorkspace({
      workspaceId: stringParam(params,'workspaceId')!,
      securityMode: enumParam<AgentWorkspaceSecurityMode>(params,'securityMode',['prompt-guarded','tool-scoped','sandboxed'] as const,true),
      rootRef: stringParam(params,'rootRef')!,
      browserProfileId: stringParam(params,'browserProfileId')!,
      toolProfileRef: stringParam(params,'toolProfileRef')!,
      endpointRefs: stringArray(params,'endpointRefs'),
      allowedRefs: stringArray(params,'allowedRefs'),
      forbiddenRefs: stringArray(params,'forbiddenRefs'),
      dangerousActionPolicy: enumParam<AgentWorkspaceDangerousActionPolicy>(params,'dangerousActionPolicy',['approval-required','deny'] as const,true),
      toolPolicyState: enumParam<AgentWorkspaceToolPolicyState>(params,'toolPolicyState',['unconfigured','configured','unsupported'] as const,true),
    });
  }
  private agentAssignDomain(request: RpcRequest, params: Params): unknown {
    this.auth.requireAdmin(request);
    return this.plane.organization.assignAgentDomain(stringParam(params,'agentId')!, stringParam(params,'domainId')!, enumParam(params,'responsibility',['primary','secondary'] as const)!);
  }

  private missionCreate(request: RpcRequest, params: Params): unknown {
    this.auth.requireAdmin(request);
    return this.plane.organization.createMission({
      organizationId: stringParam(params,'organizationId')!, projectId: stringParam(params,'projectId',true),
      title: stringParam(params,'title')!, objective: stringParam(params,'objective')!, driAgentId: stringParam(params,'driAgentId',true),
    });
  }

  private missionAddMember(request: RpcRequest, params: Params): unknown {
    this.auth.requireAdmin(request);
    return this.plane.organization.addMissionMember(stringParam(params,'missionId')!, stringParam(params,'agentId')!, enumParam<MissionMemberRole>(params,'role',['contributor','reviewer','advisor','observer'] as const)!);
  }

  private missionStatus(request: RpcRequest, params: Params): unknown {
    this.auth.requireAdmin(request);
    return this.plane.organization.setMissionStatus(stringParam(params,'missionId')!, enumParam<MissionStatus>(params,'status',['proposed','active','blocked','completed','cancelled'] as const)!);
  }

  private workCreate(request: RpcRequest, params: Params): unknown {
    this.auth.requireAdmin(request);
    return this.plane.organization.createWorkItem({ missionId: stringParam(params,'missionId')!, title: stringParam(params,'title')!, objective: stringParam(params,'objective')!, ownerAgentId: stringParam(params,'ownerAgentId',true), dependsOn: stringArray(params,'dependsOn') });
  }

  private workStatus(request: RpcRequest, params: Params): unknown {
    this.auth.requireAdmin(request);
    return this.plane.organization.setWorkStatus(stringParam(params,'workItemId')!, enumParam<WorkItemStatus>(params,'status',['proposed','ready','active','blocked','completed','cancelled'] as const)!);
  }

  private workComplete(request: RpcRequest, params: Params): unknown {
    const completedBy = stringParam(params,'completedBy')!;
    const workItemId = stringParam(params,'workItemId')!;
    const work = this.plane.organization.getWorkItem(workItemId);
    const mission = this.plane.organization.getMission(work.missionId);
    if (request.auth?.adminToken) this.auth.requireAdmin(request);
    else {
      if (!mission.projectId) throw new Error('Capability completion requires a project-bound Mission');
      const grant = this.auth.requireCapability(request,'work:complete',{ projectId: mission.projectId });
      if (grant.subject !== completedBy) throw new Error('Capability subject does not match work completer');
    }
    return this.plane.ingress.completeWorkItem({
      workItemId, completedBy, summary: stringParam(params,'summary')!, producedRefs: stringArray(params,'producedRefs'),
      decisionRefs: stringArray(params,'decisionRefs'), blockerRefs: stringArray(params,'blockerRefs'),
    });
  }

  private requestSubmit(request: RpcRequest, params: Params): unknown {
    const projectId = stringParam(params,'projectId',true);
    const requesterIdentity = stringParam(params,'requesterIdentity')!;
    if (request.auth?.adminToken) this.auth.requireAdmin(request);
    else {
      if (!projectId) throw new Error('External capability submission requires projectId');
      const grant = this.auth.requireCapability(request,'work:submit',{ projectId });
      if (grant.subject !== requesterIdentity) throw new Error('Capability subject does not match work requester');
    }
    return this.plane.ingress.submit({ organizationId: stringParam(params,'organizationId')!, projectId,
      requesterKind: enumParam<WorkRequesterKind>(params,'requesterKind',['human','external-ai','internal-agent','system'] as const)!, requesterIdentity,
      objective: stringParam(params,'objective')!, contextRefs: stringArray(params,'contextRefs'), constraints: stringArray(params,'constraints'),
      desiredOutputs: stringArray(params,'desiredOutputs'), priority: enumParam<WorkPriority>(params,'priority',['low','normal','high','urgent'] as const,true),
      deadline: numberParam(params,'deadline',true), idempotencyKey: stringParam(params,'idempotencyKey',true) });
  }

  private requestGet(request: RpcRequest, params: Params): unknown {
    const current = this.plane.ingress.get(stringParam(params,'requestId')!);
    if (request.auth?.adminToken) this.auth.requireAdmin(request);
    else if (request.auth?.browserToken) this.auth.requireBrowserOrAdmin(request);
    else {
      if (!current.projectId) throw new Error('Capability read requires a project-bound work request');
      this.auth.requireCapability(request,'work:read',{ projectId: current.projectId });
    }
    return { request: current, mission: this.plane.ingress.missionFor(current.id), workItems: this.plane.ingress.workFor(current.id) };
  }

  private requestList(request: RpcRequest, params: Params): unknown {
    const organizationId = stringParam(params,'organizationId',true);
    const status = enumParam<WorkRequestStatus>(params,'status',['received','accepted','rejected','cancelled'] as const,true);
    this.auth.requireBrowserOrAdmin(request);
    return this.plane.ingress.list(organizationId,status);
  }

  private requestAccept(request: RpcRequest, params: Params): unknown {
    this.auth.requireAdmin(request);
    return this.plane.ingress.accept({ requestId: stringParam(params,'requestId')!, acceptedBy: stringParam(params,'acceptedBy')!, missionTitle: stringParam(params,'missionTitle',true), driAgentId: stringParam(params,'driAgentId',true) });
  }

  private requestReject(request: RpcRequest, params: Params): unknown {
    this.auth.requireAdmin(request);
    return this.plane.ingress.reject({ requestId: stringParam(params,'requestId')!, decidedBy: stringParam(params,'decidedBy')!, reason: stringParam(params,'reason')! });
  }

  private requestCancel(request: RpcRequest, params: Params): unknown {
    this.auth.requireAdmin(request);
    return this.plane.ingress.cancel({ requestId: stringParam(params,'requestId')!, decidedBy: stringParam(params,'decidedBy')!, reason: stringParam(params,'reason')! });
  }
}
