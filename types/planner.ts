/**
 * 阶段 B：规则型 Planner 与流程计划。
 * @see docs/spec/PHASE_B_PLANNER_AND_PROMPT_COMPILER.md
 */

export const PLAN_SCHEMA_VERSION = 'vgp-plan-1' as const;

/** 与规则匹配的输入侧画像（可逐步扩展） */
export type InputProfile = {
  source_kind?: 'photo' | 'sketch' | 'lineart' | 'unknown';
};

export type PlannedStep = {
  ordinal: number;
  preset_id: string;
  label?: string;
  overrides?: {
    imageGear?: string;
    imageAspectRatio?: string;
    imageSize?: string;
  };
};

export type DecisionTraceEntry = {
  rule_id: string;
  priority: number;
  matched: boolean;
  reason: string;
  detail?: Record<string, unknown>;
};

export type PipelinePlan = {
  plan_id: string;
  schema_version: typeof PLAN_SCHEMA_VERSION;
  created_at: number;
  planner_id: string;
  ruleset_version: string;
  steps: PlannedStep[];
  decision_trace: DecisionTraceEntry[];
  fallback_used: boolean;
};

/** 单条规则（JSON 文件中的逻辑模型） */
export type PlannerRuleRow = {
  id: string;
  priority: number;
  enabled?: boolean;
  /** 最小实现：当 target 摘要包含 keywords 之一，且 source_kind 匹配（若写） */
  when: {
    target_keywords_any?: string[];
    source_kind?: InputProfile['source_kind'] | 'any';
  };
  then: {
    steps: Array<{ preset_id: string; label?: string }>;
  };
  reason: string;
};

export type PlannerRulesetDocument = {
  ruleset_version: string;
  planner_id: string;
  rules: PlannerRuleRow[];
};
