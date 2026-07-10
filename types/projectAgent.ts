/**
 * Project Agent — frozen Phase-1 contracts (spec §5 / §16).
 * Runtime must depend on these types + HostPort + tool registry only.
 * Do not import WorkflowSection from services/projectAgent/**.
 */

import type { WorkflowPendingTask } from '../types';

/** P0 tool ids — registry must stay ≤ 6 (P11 / §16.2). */
export const PROJECT_AGENT_TOOL_IDS = [
  'run_plain_text',
  'run_plain_t2i',
  'run_plain_i2i',
  'run_preset',
  'run_lightbox_local_edit',
  'run_plain_3d',
] as const;

export type ProjectAgentToolId = (typeof PROJECT_AGENT_TOOL_IDS)[number];

export const PROJECT_AGENT_MAX_TOOL_STEPS = 8 as const;

export type AgentComposerMode = 'text' | 'image' | '3d';

export type AgentSurfaceContext =
  | { kind: 'canvas'; selectedAssetIds: string[]; stepId?: string }
  | { kind: 'lightbox'; assetId: string; displayKey: string; hasLocalEdit?: boolean }
  | { kind: 'storyboard_table'; tableAssetId: string; selectedRowIds?: string[] }
  | { kind: 'asset_set'; setAssetId: string; selectedComponentIds?: string[] }
  | { kind: 'none' };

export type AgentMentionKind = 'asset' | 'preset' | 'expert' | 'skill' | 'artifact';

export type AgentMentionRef = {
  kind: AgentMentionKind;
  id: string;
  label?: string;
};

/** Generation overrides — no media bytes. */
export type AgentImageSettingsSummary = {
  model?: string;
  aspectRatio?: string;
  size?: string;
  count?: number;
  understandingEnabled?: boolean;
};

/**
 * Intent built before planTools. High-signal fields only (ids, not base64).
 */
export type ProjectAgentIntent = {
  text: string;
  mode: AgentComposerMode;
  /** Dragged / mentioned capability preset ids (order preserved). */
  presetIds: string[];
  mentions: AgentMentionRef[];
  surface: AgentSurfaceContext;
  /** Primary image asset for i2i when mode=image (or from surface). */
  mainAssetId?: string;
  referenceAssetIds?: string[];
  imageSettings?: AgentImageSettingsSummary;
  textModel?: string;
  /** True when at least one enabled generate_3d preset exists in host catalog. */
  hasEnabled3dPreset?: boolean;
};

/** Turn machine (§16.1): terminal is done | error (cancel → error + reason cancelled). */
export type AgentTurnStatus = 'idle' | 'planning' | 'executing' | 'done' | 'error';

export type AgentToolCallStatus = 'queued' | 'running' | 'done' | 'error';

export type AgentPlannedTool = {
  toolId: ProjectAgentToolId;
  label: string;
  /** Opaque args for executors; must not contain base64. */
  args?: Record<string, unknown>;
};

export type AgentPlanResult =
  | { ok: true; plan: AgentPlannedTool[] }
  | { ok: false; errorMessage: string };

export type AgentTurnTrace = {
  turnId: string;
  threadId: string;
  workspaceProjectId: string;
  startedAt: number;
  endedAt?: number;
  /** Trace may record cancelled as status for observability (§16.3). */
  status: Exclude<AgentTurnStatus, 'idle'> | 'cancelled';
  intentSnapshot: {
    text: string;
    mode: AgentComposerMode;
    mentionIds: string[];
    presetIds: string[];
    surface: AgentSurfaceContext;
  };
  plan: { toolId: ProjectAgentToolId; label: string }[];
  toolCalls: {
    id: string;
    toolId: ProjectAgentToolId;
    status: AgentToolCallStatus;
    taskIds?: string[];
    assetIds?: string[];
    artifactIds?: string[];
    errorMessage?: string;
    correlationId?: string;
  }[];
  errorMessage?: string;
};

/** P1 placeholders — types only in Phase 1. */
export type AgentArtifactDraft = {
  kind: string;
  text?: string;
  meta?: Record<string, unknown>;
};

export type PromoteTarget = {
  targetKind: 'capability_preset';
  name?: string;
};

export type ProjectAgentHostQueueSnapshot = {
  pending: WorkflowPendingTask[];
  executing: WorkflowPendingTask[];
  assetErrors: Record<string, string>;
};

/** Result of executing a planned tool list via Host (Phase 2 bridge). */
export type ProjectAgentExecutePlanResult = {
  taskIds: string[];
  taskAssetById?: Record<string, string>;
  errorMessage?: string;
};

export type ProjectAgentHostPort = {
  enqueueTasks: (tasks: WorkflowPendingTask[]) => string[];
  getQueueSnapshot: () => ProjectAgentHostQueueSnapshot;
  resolveAssetDisplay: (assetId: string) => { previewSrc?: string; label?: string };
  reportSurfaceContext?: () => AgentSurfaceContext;
  /**
   * Phase 2: run planned tools using existing workflow enqueue pipelines.
   * Prefer this over inventing per-tool enqueue in Runtime.
   */
  executePlan?: (
    intent: ProjectAgentIntent,
    plan: AgentPlannedTool[]
  ) => ProjectAgentExecutePlanResult | Promise<ProjectAgentExecutePlanResult>;
  /** P1+ */
  emitArtifact?: (a: AgentArtifactDraft) => string;
  promoteArtifact?: (
    artifactId: string,
    target: PromoteTarget
  ) => Promise<{ ok: boolean; id?: string }>;
};

export type ProjectAgentSubmitTurnInput = {
  turnId: string;
  threadId: string;
  workspaceProjectId: string;
  intent: ProjectAgentIntent;
};

export type ProjectAgentSubmitTurnResult = {
  ok: boolean;
  turnId: string;
  plan: AgentPlannedTool[];
  planText: string;
  taskIds: string[];
  taskAssetById?: Record<string, string>;
  errorMessage?: string;
  trace: AgentTurnTrace;
};

export type ProjectAgentToolDefinition = {
  id: ProjectAgentToolId;
  /** ACI: human + model facing description */
  description: string;
  label: string;
};

/** §16.4 route eval case shape */
export type AgentRouteCase = {
  id: string;
  intent: ProjectAgentIntent;
  expectToolIds: ProjectAgentToolId[];
  expectForbiddenToolIds?: ProjectAgentToolId[];
  expectError?: boolean;
};
