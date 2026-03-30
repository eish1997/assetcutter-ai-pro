import {
  PLAN_SCHEMA_VERSION,
  type PlannerRulesetDocument,
  type PipelinePlan,
  type PlannedStep,
  type InputProfile,
  type DecisionTraceEntry,
} from '../../types/planner';

function newPlanId(): string {
  return `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export type PlanPipelineInput = {
  inputProfile: InputProfile;
  /** 用户目标描述（关键词匹配用） */
  targetSummary: string;
  ruleset: PlannerRulesetDocument;
  availablePresetIds: Set<string>;
};

/**
 * 按优先级匹配第一条规则，产出有序步骤；无命中时 `fallback_used: true` 且 `steps` 为空。
 */
export function planPipeline(input: PlanPipelineInput): PipelinePlan {
  const trace: DecisionTraceEntry[] = [];
  const targetLower = input.targetSummary.trim().toLowerCase();
  const sorted = [...input.ruleset.rules]
    .filter((r) => r.enabled !== false)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of sorted) {
    const when = rule.when;
    let matched = true;
    if (when.target_keywords_any?.length) {
      const any = when.target_keywords_any.some((kw) => targetLower.includes(kw.toLowerCase()));
      if (!any) matched = false;
    }
    if (
      when.source_kind &&
      when.source_kind !== 'any' &&
      input.inputProfile.source_kind &&
      input.inputProfile.source_kind !== 'unknown'
    ) {
      if (when.source_kind !== input.inputProfile.source_kind) matched = false;
    }

    if (!matched) {
      trace.push({
        rule_id: rule.id,
        priority: rule.priority,
        matched: false,
        reason: rule.reason,
        detail: { target: input.targetSummary.slice(0, 200) },
      });
      continue;
    }

    const stepsFull: PlannedStep[] = [];
    let ordinal = 0;
    for (const s of rule.then.steps) {
      if (!input.availablePresetIds.has(s.preset_id)) continue;
      stepsFull.push({
        ordinal: ordinal++,
        preset_id: s.preset_id,
        label: s.label,
      });
    }

    if (stepsFull.length === 0) {
      trace.push({
        rule_id: rule.id,
        priority: rule.priority,
        matched: false,
        reason: rule.reason,
        detail: { note: '条件命中但无可用预设（未安装或 ID 不匹配）' },
      });
      continue;
    }

    trace.push({
      rule_id: rule.id,
      priority: rule.priority,
      matched: true,
      reason: rule.reason,
      detail: { steps: stepsFull.map((x) => x.preset_id) },
    });

    return {
      plan_id: newPlanId(),
      schema_version: PLAN_SCHEMA_VERSION,
      created_at: Date.now(),
      planner_id: input.ruleset.planner_id,
      ruleset_version: input.ruleset.ruleset_version,
      steps: stepsFull,
      decision_trace: trace,
      fallback_used: false,
    };
  }

  return {
    plan_id: newPlanId(),
    schema_version: PLAN_SCHEMA_VERSION,
    created_at: Date.now(),
    planner_id: input.ruleset.planner_id,
    ruleset_version: input.ruleset.ruleset_version,
    steps: [],
    decision_trace: trace,
    fallback_used: true,
  };
}
