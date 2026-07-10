/**
 * Thin HostPort factory for WorkflowSection (lives under components — may close over WS state).
 * Runtime must not import WorkflowSection; this adapter is the bridge.
 */

import type { WorkflowPendingTask } from '../../types';
import type {
  AgentPlannedTool,
  AgentSurfaceContext,
  ProjectAgentExecutePlanResult,
  ProjectAgentHostPort,
  ProjectAgentHostQueueSnapshot,
  ProjectAgentHostThread,
  ProjectAgentHostThreadStoreKey,
  ProjectAgentIntent,
} from '../../types/projectAgent';

export type WorkflowProjectAgentHostDeps = {
  enqueueTasks: (tasks: WorkflowPendingTask[]) => string[];
  getQueueSnapshot: () => ProjectAgentHostQueueSnapshot;
  resolveAssetDisplay: (assetId: string) => { previewSrc?: string; label?: string };
  reportSurfaceContext: () => AgentSurfaceContext;
  /**
   * Map planned tools + intent → existing submitQuickCompose / lightbox pipelines.
   * Must not paste full chat history into image prompts (spec §5.2).
   */
  executePlan: (
    intent: ProjectAgentIntent,
    plan: AgentPlannedTool[]
  ) => ProjectAgentExecutePlanResult | Promise<ProjectAgentExecutePlanResult>;
  /** §16.1 / 3A：取消仍在队列中的 task */
  cancelTasks?: (taskIds: string[]) => void;
  /** Optional hot thread for runtime B-layer assembly (§18.5). */
  getThread?: () => ProjectAgentHostThread | null;
  getThreadStoreKey?: () => ProjectAgentHostThreadStoreKey | null;
};

export function createWorkflowProjectAgentHostPort(
  deps: WorkflowProjectAgentHostDeps
): ProjectAgentHostPort {
  return {
    enqueueTasks: deps.enqueueTasks,
    getQueueSnapshot: deps.getQueueSnapshot,
    resolveAssetDisplay: deps.resolveAssetDisplay,
    reportSurfaceContext: deps.reportSurfaceContext,
    executePlan: deps.executePlan,
    ...(deps.cancelTasks ? { cancelTasks: deps.cancelTasks } : {}),
    ...(deps.getThread ? { getThread: deps.getThread } : {}),
    ...(deps.getThreadStoreKey ? { getThreadStoreKey: deps.getThreadStoreKey } : {}),
  };
}
