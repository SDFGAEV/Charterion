export type OrganizationAgentConversationStatus = 'active' | 'closed';

export interface OrganizationAgentConversationRecord {
  id: string;
  organizationId: string;
  agentId: string;
  generation: number;
  conversationKey: string;
  status: OrganizationAgentConversationStatus;
  predecessorConversationKey?: string;
  runtimeSlotId?: string;
  startedAt: number;
  endedAt?: number;
  closeReason?: string;
}

export interface BindOrganizationAgentConversationInput {
  agentId: string;
  conversationKey: string;
  runtimeSlotId?: string | undefined;
  generationHint?: number | undefined;
}

export interface RolloverOrganizationAgentConversationInput {
  agentId: string;
  fromConversationKey: string;
  toConversationKey: string;
  runtimeSlotId: string;
  reason: string;
}
