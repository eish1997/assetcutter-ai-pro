/**
 * Project Agent — frozen Phase-1 contracts (spec §5 / §16).
 * Runtime must depend on these types + HostPort + tool registry only.
 * Do not import WorkflowSection from services/projectAgent/**.
 */

import type { WorkflowPendingTask } from '../types';
import type { QuickComposeThreadMessage } from './quickComposeThread';

/** P0+P1 tool ids — P0 media ≤6; P1 adds invoke_expert (still one id for all experts). */
export const PROJECT_AGENT_TOOL_IDS = [
  'run_plain_text',
  'run_plain_i2t',
  'run_plain_t2i',
  'run_plain_i2i',
  'run_preset',
  'run_lightbox_local_edit',
  'run_plain_3d',
  'invoke_expert',
] as const;

export type ProjectAgentToolId = (typeof PROJECT_AGENT_TOOL_IDS)[number];

export const PROJECT_AGENT_MAX_TOOL_STEPS = 8 as const;

export type AgentComposerMode = 'text' | 'image' | '3d' | 'auto';

/**
 * Phase 5 / U4 — agents-as-tools 子 run 进度卡（§11 P2）。
 * 挂在主助手气泡下；工人不抢用户会话。无媒体字节。
 */
export type AgentChildRunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export type AgentChildRun = {
  id: string;
  /** 所属主 turn / 助手消息关联 */
  parentMessageId?: string;
  kind: 'expert' | 'tool';
  label: string;
  expertId?: string;
  toolId?: ProjectAgentToolId;
  status: AgentChildRunStatus;
  taskIds?: string[];
  artifactIds?: string[];
  errorMessage?: string;
  startedAt: number;
  endedAt?: number;
};

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

export type AgentSkillPermissionLevel = 'none' | 'light' | 'cost' | 'destructive';

export type AgentSkillSource = 'local' | 'imported' | 'preset' | 'expert';

export type AgentSkill = {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  toolIds: ProjectAgentToolId[];
  permissionLevel: AgentSkillPermissionLevel;
  source: AgentSkillSource;
  enabled: boolean;
  createdAt: number;
  updatedAt?: number;
  deletedAt?: number;
  safetyWarnings?: string[];
};

export type AgentSkillImportPreview = {
  ok: boolean;
  skill?: Omit<AgentSkill, 'createdAt' | 'updatedAt' | 'deletedAt' | 'enabled'>;
  warnings: string[];
  errors: string[];
  requiresConfirmation: boolean;
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
  /** True when the turn includes image bytes that are not represented by a durable asset id. */
  hasInlineImageRefs?: boolean;
  imageSettings?: AgentImageSettingsSummary;
  textModel?: string;
  /** True when at least one enabled generate_3d preset exists in host catalog. */
  hasEnabled3dPreset?: boolean;
  /** Enabled local Skill routing hints. Skills still resolve to existing whitelisted tool ids. */
  enabledSkills?: AgentSkill[];
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

export type AgentPlannerDecisionTraceItem = {
  stage: 'candidate' | 'validate' | 'fallback' | 'clarify';
  message: string;
  toolId?: ProjectAgentToolId;
  reason?: string;
};

export type AgentPlannerValidationIssue = {
  code:
    | 'empty_plan'
    | 'unknown_tool'
    | 'too_many_steps'
    | 'missing_text'
    | 'missing_asset'
    | 'missing_preset'
    | 'missing_3d_preset'
    | 'missing_scope'
    | 'invalid_args';
  message: string;
  stepIndex?: number;
  toolId?: string;
  severity: 'error' | 'warning';
};

export type AgentPlannerOutput = {
  source: 'controlled' | 'rule_fallback';
  plan: AgentPlannedTool[];
  decisionTrace: AgentPlannerDecisionTraceItem[];
  validationIssues: AgentPlannerValidationIssue[];
};

export type AgentControlledPlannerResult =
  | {
      ok: true;
      plan: AgentPlannedTool[];
      decisionTrace?: AgentPlannerDecisionTraceItem[];
    }
  | {
      ok: false;
      errorMessage?: string;
      clarifyMessage?: string;
      decisionTrace?: AgentPlannerDecisionTraceItem[];
    };

export type AgentControlledPlanner = (intent: ProjectAgentIntent) => AgentControlledPlannerResult;

export type AgentPlanResult =
  | { ok: true; plan: AgentPlannedTool[]; planner?: AgentPlannerOutput }
  | { ok: false; errorMessage: string; clarifyMessage?: string; planner?: AgentPlannerOutput };

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
  plannerTrace?: AgentPlannerDecisionTraceItem[];
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

// ─── Phase 4 / U3 frozen contracts (§17 / §18) ─────────────────────────────

export type ExpertId = string;

/** §17.2 Expert identity (versioned). */
export type ExpertProfile = {
  expertId: ExpertId;
  version: number;
  displayName: string;
  mentionAliases: string[];
  mission: string;
  styleRules: string[];
  taboos: string[];
  fewShotRefIds?: string[];
  knowledgeRef?: string;
  /** Whitelist of ProjectAgentToolId or expert-local skill ids */
  toolIds: string[];
};

export type ExpertMemoryScope = {
  userId: string;
  expertId: ExpertId;
  /** Omit = user-level across projects */
  workspaceProjectId?: string;
};

export type ExpertMemoryEntry = {
  id: string;
  scope: ExpertMemoryScope;
  kind: 'preference' | 'rejection' | 'summary' | 'pointer';
  /** Short text only — no base64 */
  text: string;
  pointer?: { type: 'artifact' | 'preset' | 'asset'; id: string };
  sourceTurnId?: string;
  createdAt: number;
  deletedAt?: number;
};

export type ProjectAgentKnowledgeScope = {
  userId: string;
  workspaceProjectId: string;
};

export type ProjectAgentKnowledgeKind =
  | 'product_knowledge'
  | 'project_knowledge'
  | 'user_preference'
  | 'asset_rule'
  /** legacy aliases kept for existing local stores */
  | 'preference'
  | 'brand_rule'
  | 'workflow'
  | 'style'
  | 'note';

export type ProjectAgentKnowledgeEntry = {
  id: string;
  scope: ProjectAgentKnowledgeScope;
  kind: ProjectAgentKnowledgeKind;
  /** Short text only — no base64/media. */
  text: string;
  label?: string;
  sourceTurnId?: string;
  createdAt: number;
  updatedAt?: number;
  disabledAt?: number;
  deletedAt?: number;
};

export type ProjectAgentSkillRegistryEntry = AgentSkill;

/** Session-scoped L2 artifact (no media bytes). */
export type ProjectAgentArtifact = {
  id: string;
  workspaceProjectId: string;
  kind: string;
  text?: string;
  meta?: Record<string, unknown>;
  expertId?: ExpertId;
  sourceTurnId?: string;
  createdAt: number;
};

export type ExpertInvokeInput = {
  expertId: ExpertId;
  userText: string;
  turnId: string;
  threadId: string;
  workspaceProjectId: string;
  userId: string;
  /** Explicit artifact ids to inject (P12 — not auto) */
  artifactIds?: string[];
  /** 文本模型 registryId（Host 传入；LLM 路径使用） */
  textModel?: string;
  /**
   * Host 注入的真 LLM。省略或 `preferDeterministicDraft` 时走 Profile 模板草稿（测试/离线）。
   * 禁止在 generateText 内写 Memory/改 Profile。
   */
  generateText?: (args: {
    system: string;
    user: string;
    model?: string;
  }) => Promise<string>;
  /** 强制模板草稿（单测 / 排障） */
  preferDeterministicDraft?: boolean;
};

export type ExpertInvokeResult = {
  ok: boolean;
  expertId: ExpertId;
  artifactIds: string[];
  memoryIdsInjected: string[];
  text?: string;
  errorMessage?: string;
  /** Pending profile patch — must not apply until user confirms */
  pendingProfilePatch?: Partial<ExpertProfile> & { baseVersion: number };
  /** Skill change request — studio confirm only */
  skillRequest?: { toolIds: string[]; note?: string };
};

export type ExpertTuneKind = 'memory' | 'profilePatch' | 'skillRequest';

export type ExpertTuneProposal = {
  kind: ExpertTuneKind;
  expertId: ExpertId;
  /** For memory writes */
  memoryDraft?: Omit<ExpertMemoryEntry, 'id' | 'createdAt' | 'deletedAt'>;
  profilePatch?: Partial<ExpertProfile> & { baseVersion: number };
  skillRequest?: { toolIds: string[]; note?: string };
};

/** §18.5 compaction blob (no LLM required for v0). */
export type ProjectAgentCompaction = {
  workspaceProjectId: string;
  /** Truncation-style summary of older turns */
  summaryText: string;
  /** Message ids covered by summary */
  coveredMessageIds: string[];
  updatedAt: number;
};

/** B-layer assembly result for submitTurn context. */
export type ProjectAgentAssembledContext = {
  /** Recent K rounds of lean message text */
  recentText: string;
  compactionSummary?: string;
  expertContext?: string;
  projectKnowledge?: string;
  projectKnowledgeIdsInjected?: string[];
  truncated: boolean;
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
  /** Immediate text result (e.g. invoke_expert) — no media task. */
  resultText?: string;
  /** L2 artifact ids produced during execute (e.g. expert output). */
  artifactIds?: string[];
};

/** Hot-thread shape for HostPort.getThread (mirrors threadStore.ProjectAgentThread). */
export type ProjectAgentHostThread = {
  id: string;
  workspaceProjectId: string;
  messages: QuickComposeThreadMessage[];
  createdAt: number;
  updatedAt: number;
};

export type ProjectAgentHostThreadStoreKey = {
  userId: string | null;
  workspaceProjectId: string;
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
  /**
   * Optional Phase 5 controlled planner. planTools validates its output before
   * execution and falls back to deterministic routing when unsafe.
   */
  controlledPlanner?: AgentControlledPlanner;
  /**
   * Optional hot thread for B-layer assembly in submitTurn (§18.5 / A23).
   * Runtime injects recentText/compactionSummary into text/expert intents only (§16.8).
   */
  getThread?: () => ProjectAgentHostThread | null;
  /** Store key paired with getThread (compaction + assembly scoped storage). */
  getThreadStoreKey?: () => ProjectAgentHostThreadStoreKey | null;
  /**
   * §16.1 取消：跳过仍 queued/running 的媒体 task（已 done 的 L1 不删）。
   * P0d / 阶段 3A。
   */
  cancelTasks?: (taskIds: string[]) => void;
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
  /** Immediate text (invoke_expert etc.) for assistant bubble resultText. */
  resultText?: string;
  artifactIds?: string[];
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
