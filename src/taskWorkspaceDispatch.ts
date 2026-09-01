import type { AgentTask, ManagedTab } from './contracts';
import { provisionNativeTaskWorkspace, type NativeControlSnapshot } from './nativeControl';
import type { TaskWorkspacePromptContext } from './taskPrompt';

export async function provisionTaskWorkspaceForDispatch(
  task: AgentTask,
  tabId: number,
  tabs: readonly ManagedTab[],
  control: NativeControlSnapshot,
): Promise<TaskWorkspacePromptContext | undefined> {
  if (task.completionPolicy !== 'verified-claim') return undefined;
  const tab = tabs.find((item) => item.tabId === tabId);
  const slotId = tab?.binding.agentSlotId?.trim();
  if (!slotId) throw new Error(`Task ${task.id} dispatch tab has no durable AgentSlot binding`);
  const agent = control.agents.find((item) => item.id === slotId);
  if (!agent) throw new Error(`Task ${task.id} AgentSlot ${slotId} is missing from Kernel control state`);
  const workspace = await provisionNativeTaskWorkspace({ projectId: agent.projectId, slotId, taskId: task.id });
  return workspace;
}
