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
  };
}
