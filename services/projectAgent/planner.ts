/**
 * Phase 5 controlled planner.
 *
 * This is intentionally deterministic for now: it gives us the structured
 * planner/validator contract, traceability, and safe fallback before any LLM
 * planner is introduced.
 */

import type {
  AgentControlledPlanner,
  AgentPlannedTool,
  AgentPlannerDecisionTraceItem,
  AgentPlannerOutput,
  AgentPlannerValidationIssue,
  ProjectAgentIntent,
  ProjectAgentToolId,
} from '../../types/projectAgent';
import { PROJECT_AGENT_MAX_TOOL_STEPS, PROJECT_AGENT_TOOL_IDS } from '../../types/projectAgent';
import { resolveComposerMode } from './autoMode';
import { getExpertProfile, resolveExpertByMention } from './experts/registry';
import { resolveAgentSkillsForIntent } from './skillRegistry';
import { getToolDefinition } from './tools/registry';

export type ControlledPlannerResult =
  | { ok: true; output: AgentPlannerOutput }
  | {
      ok: false;
      action: 'fallback' | 'clarify';
      errorMessage: string;
      output: AgentPlannerOutput;
    };

function labelFor(toolId: ProjectAgentToolId): string {
  return getToolDefinition(toolId)?.label ?? toolId;
}

function step(toolId: ProjectAgentToolId, args?: Record<string, unknown>): AgentPlannedTool {
  return { toolId, label: labelFor(toolId), ...(args ? { args } : {}) };
}

function pushTrace(
  trace: AgentPlannerDecisionTraceItem[],
  item: AgentPlannerDecisionTraceItem
): void {
  trace.push(item);
}

function textNonEmpty(intent: ProjectAgentIntent): boolean {
  return intent.text.trim().length > 0;
}

function hasMainImage(intent: ProjectAgentIntent): boolean {
  if (intent.hasInlineImageRefs === true) return true;
  if (intent.mainAssetId?.trim()) return true;
  if (intent.surface.kind === 'lightbox' && intent.surface.assetId.trim()) return true;
  if (intent.surface.kind === 'canvas' && intent.surface.selectedAssetIds.some((id) => id.trim())) {
    return true;
  }
  return false;
}

function wantsVisualAnswer(intent: ProjectAgentIntent): boolean {
  if (!hasMainImage(intent)) return false;
  const text = intent.text.trim();
  if (!text) return false;
  if (intent.mode === 'image' || intent.mode === '3d') return false;
  return /(?:这是什么|是什么东西|是什么|看一下|识别|描述|分析|画面|图里|图片|current|what\s+is|what's|describe|identify)/i.test(text);
}

function resolveMainAssetId(intent: ProjectAgentIntent): string | undefined {
  if (intent.mainAssetId?.trim()) return intent.mainAssetId.trim();
  if (intent.surface.kind === 'lightbox') return intent.surface.assetId.trim() || undefined;
  if (intent.surface.kind === 'canvas') {
    return intent.surface.selectedAssetIds.find((id) => id.trim())?.trim();
  }
  return undefined;
}

function hasAnyRef(intent: ProjectAgentIntent): boolean {
  if (hasMainImage(intent)) return true;
  if ((intent.referenceAssetIds ?? []).some((id) => id.trim())) return true;
  return intent.mentions.some((m) => m.kind === 'asset' && m.id.trim());
}

function collectPresetIds(intent: ProjectAgentIntent): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [
    ...(intent.presetIds ?? []),
    ...intent.mentions.filter((m) => m.kind === 'preset').map((m) => m.id),
  ]) {
    const clean = id.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function collectExpertIds(intent: ProjectAgentIntent): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string, label?: string) => {
    const profile =
      getExpertProfile(raw) ??
      resolveExpertByMention(raw) ??
      (label ? resolveExpertByMention(label) : null);
    if (!profile || seen.has(profile.expertId)) return;
    seen.add(profile.expertId);
    out.push(profile.expertId);
  };

  for (const mention of intent.mentions) {
    if (mention.kind === 'expert') push(mention.id, mention.label);
  }

  const atRe = /@([^\s@，。,.;!?？！]+)/g;
  let match: RegExpExecArray | null;
  while ((match = atRe.exec(intent.text)) !== null) {
    push(match[1] || '');
  }
  return out;
}

function collectSkillPlan(intent: ProjectAgentIntent): AgentPlannedTool[] {
  const skills = resolveAgentSkillsForIntent({
    text: intent.text,
    mentions: intent.mentions,
    skills: intent.enabledSkills ?? [],
  });
  const plan: AgentPlannedTool[] = [];
  for (const skill of skills) {
    for (const toolId of skill.toolIds) {
      plan.push(step(toolId, { skillId: skill.id, skillName: skill.name, text: intent.text }));
    }
  }
  return plan;
}

function wantsTextAndImage(intent: ProjectAgentIntent): boolean {
  const text = intent.text.toLowerCase();
  const wantsCopy = /文案|标题|卖点|旁白|copy|caption|headline/.test(text);
  const wantsImage = /主图|海报|图片|生图|出图|image|poster|visual/.test(text);
  return intent.mode === 'auto' && wantsCopy && wantsImage;
}

function buildCandidatePlan(intent: ProjectAgentIntent, trace: AgentPlannerDecisionTraceItem[]): AgentPlannedTool[] {
  const presetIds = collectPresetIds(intent);
  if (presetIds.length > 0) {
    pushTrace(trace, { stage: 'candidate', message: 'explicit presets take priority' });
    return presetIds.map((presetId) => step('run_preset', { presetId }));
  }

  const skillPlan = collectSkillPlan(intent);
  if (skillPlan.length > 0) {
    pushTrace(trace, { stage: 'candidate', message: 'matched enabled local skills' });
    return skillPlan;
  }

  const expertIds = collectExpertIds(intent);
  if (expertIds.length > 0) {
    pushTrace(trace, { stage: 'candidate', message: 'matched expert mentions' });
    return expertIds.map((expertId) => step('invoke_expert', { expertId }));
  }

  if (intent.surface.kind === 'lightbox' && intent.surface.hasLocalEdit === true) {
    pushTrace(trace, { stage: 'candidate', message: 'lightbox local edit context detected' });
    return [
      step('run_lightbox_local_edit', {
        assetId: intent.surface.assetId,
        displayKey: intent.surface.displayKey,
        localEdit: true,
        text: intent.text,
      }),
    ];
  }

  const mode = intent.mode === 'auto' ? resolveComposerMode(intent) : intent.mode;
  if (wantsVisualAnswer(intent)) {
    pushTrace(trace, { stage: 'candidate', message: 'visual question with image reference' });
    return [
      step('run_plain_i2t', {
        text: intent.text,
        mainAssetId: resolveMainAssetId(intent),
        referenceAssetIds: intent.referenceAssetIds,
      }),
    ];
  }
  if (wantsTextAndImage(intent)) {
    pushTrace(trace, { stage: 'candidate', message: 'split compound copy plus image request' });
    return [
      step('run_plain_text', { text: intent.text, textModel: intent.textModel }),
      hasMainImage(intent)
        ? step('run_plain_i2i', {
            text: intent.text,
            mainAssetId: resolveMainAssetId(intent),
            referenceAssetIds: intent.referenceAssetIds,
          })
        : step('run_plain_t2i', { text: intent.text }),
    ];
  }

  if (mode === '3d') {
    pushTrace(trace, { stage: 'candidate', message: 'resolved composer mode to 3d' });
    return [step('run_plain_3d', { text: intent.text, mainAssetId: resolveMainAssetId(intent) })];
  }

  if (mode === 'image') {
    pushTrace(trace, { stage: 'candidate', message: 'resolved composer mode to image' });
    if (hasMainImage(intent)) {
      return [
        step('run_plain_i2i', {
          text: intent.text,
          mainAssetId: resolveMainAssetId(intent),
          referenceAssetIds: intent.referenceAssetIds,
        }),
      ];
    }
    return [step('run_plain_t2i', { text: intent.text })];
  }

  pushTrace(trace, { stage: 'candidate', message: 'resolved composer mode to text' });
  return [step('run_plain_text', { text: intent.text, textModel: intent.textModel })];
}

function stringArg(stepItem: AgentPlannedTool, key: string): string {
  const value = stepItem.args?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

export function validateControlledPlan(
  intent: ProjectAgentIntent,
  plan: readonly AgentPlannedTool[]
): AgentPlannerValidationIssue[] {
  const issues: AgentPlannerValidationIssue[] = [];
  const toolIds = new Set<string>(PROJECT_AGENT_TOOL_IDS);

  if (plan.length === 0) {
    issues.push({ code: 'empty_plan', message: 'Planner returned no steps', severity: 'error' });
  }
  if (plan.length > PROJECT_AGENT_MAX_TOOL_STEPS) {
    issues.push({
      code: 'too_many_steps',
      message: `Plan exceeds max ${PROJECT_AGENT_MAX_TOOL_STEPS} tool steps`,
      severity: 'error',
    });
  }

  plan.forEach((item, index) => {
    if (!toolIds.has(item.toolId)) {
      issues.push({
        code: 'unknown_tool',
        message: `Unknown Project Agent tool: ${item.toolId}`,
        stepIndex: index,
        toolId: item.toolId,
        severity: 'error',
      });
      return;
    }

    if (!isJsonObject(item.args)) {
      issues.push({
        code: 'invalid_args',
        message: `${item.toolId} args must be a JSON object`,
        stepIndex: index,
        toolId: item.toolId,
        severity: 'error',
      });
      return;
    }

    if (item.toolId === 'run_plain_text' && !textNonEmpty(intent)) {
      issues.push({
        code: 'missing_text',
        message: 'Text planning requires non-empty text',
        stepIndex: index,
        toolId: item.toolId,
        severity: 'error',
      });
    }
    if (item.toolId === 'run_plain_i2t' && !hasMainImage(intent)) {
      issues.push({
        code: 'missing_asset',
        message: 'Image-to-text requires an image',
        stepIndex: index,
        toolId: item.toolId,
        severity: 'error',
      });
    }
    if (item.toolId === 'run_plain_t2i' && !textNonEmpty(intent)) {
      issues.push({
        code: 'missing_text',
        message: 'Text-to-image requires a prompt',
        stepIndex: index,
        toolId: item.toolId,
        severity: 'error',
      });
    }
    if (item.toolId === 'run_plain_i2i' && !stringArg(item, 'mainAssetId')) {
      issues.push({
        code: 'missing_asset',
        message: 'Image-to-image requires a main asset',
        stepIndex: index,
        toolId: item.toolId,
        severity: 'error',
      });
    }
    if (item.toolId === 'run_preset' && !stringArg(item, 'presetId')) {
      issues.push({
        code: 'missing_preset',
        message: 'Preset execution requires presetId',
        stepIndex: index,
        toolId: item.toolId,
        severity: 'error',
      });
    }
    if (item.toolId === 'run_lightbox_local_edit' && !stringArg(item, 'assetId')) {
      issues.push({
        code: 'missing_asset',
        message: 'Lightbox local edit requires assetId',
        stepIndex: index,
        toolId: item.toolId,
        severity: 'error',
      });
    }
    if (item.toolId === 'run_plain_3d' && !intent.hasEnabled3dPreset) {
      issues.push({
        code: 'missing_3d_preset',
        message: 'No enabled 3D preset available',
        stepIndex: index,
        toolId: item.toolId,
        severity: 'error',
      });
    }
  });

  if (!textNonEmpty(intent) && !hasAnyRef(intent) && collectPresetIds(intent).length === 0) {
    issues.push({
      code: 'missing_text',
      message: 'Empty text with no attachment or preset',
      severity: 'error',
    });
  }

  return issues;
}

function firstValidationAction(issue: AgentPlannerValidationIssue): 'fallback' | 'clarify' {
  return issue.code === 'missing_text' || issue.code === 'missing_asset' ? 'clarify' : 'fallback';
}

function createPlannerOutput(input: {
  source: AgentPlannerOutput['source'];
  plan: AgentPlannedTool[];
  decisionTrace: AgentPlannerDecisionTraceItem[];
  validationIssues: AgentPlannerValidationIssue[];
}): AgentPlannerOutput {
  return {
    source: input.source,
    plan: input.plan,
    decisionTrace: input.decisionTrace,
    validationIssues: input.validationIssues,
  };
}

function normalizePlannerPlan(plan: readonly AgentPlannedTool[]): AgentPlannedTool[] {
  return plan.map((item) => ({
    ...item,
    label:
      typeof item.label === 'string' && item.label.trim()
        ? item.label.trim()
        : PROJECT_AGENT_TOOL_IDS.includes(item.toolId)
          ? labelFor(item.toolId)
          : String(item.toolId),
  }));
}

function createInjectedControlledPlan(
  intent: ProjectAgentIntent,
  controlledPlanner: AgentControlledPlanner
): ControlledPlannerResult {
  const decisionTrace: AgentPlannerDecisionTraceItem[] = [];
  try {
    const result = controlledPlanner(intent);
    decisionTrace.push(...(result.decisionTrace ?? []));
    if (!result.ok) {
      const clarifyMessage = 'clarifyMessage' in result ? result.clarifyMessage?.trim() : '';
      const errorMessage = 'errorMessage' in result ? result.errorMessage?.trim() : '';
      if (clarifyMessage) {
        pushTrace(decisionTrace, {
          stage: 'clarify',
          message: clarifyMessage,
          reason: errorMessage,
        });
        return {
          ok: false,
          action: 'clarify',
          errorMessage: clarifyMessage,
          output: createPlannerOutput({
            source: 'controlled',
            plan: [],
            decisionTrace,
            validationIssues: [],
          }),
        };
      }
      pushTrace(decisionTrace, {
        stage: 'fallback',
        message: errorMessage || 'controlled planner declined',
      });
      return {
        ok: false,
        action: 'fallback',
        errorMessage: errorMessage || 'Controlled planner declined',
        output: createPlannerOutput({
          source: 'rule_fallback',
          plan: [],
          decisionTrace,
          validationIssues: [],
        }),
      };
    }

    const candidate = normalizePlannerPlan(result.plan);
    const validationIssues = validateControlledPlan(intent, candidate);
    for (const issue of validationIssues) {
      pushTrace(decisionTrace, {
        stage: 'validate',
        message: issue.message,
        toolId: issue.toolId as ProjectAgentToolId | undefined,
        reason: issue.code,
      });
    }
    const output = createPlannerOutput({
      source: 'controlled',
      plan: candidate,
      decisionTrace,
      validationIssues,
    });
    const firstError =
      validationIssues.find((issue) => issue.severity === 'error' && issue.stepIndex == null) ??
      validationIssues.find((issue) => issue.severity === 'error');
    if (!firstError) {
      pushTrace(decisionTrace, {
        stage: 'validate',
        message: 'controlled planner output accepted',
      });
      return { ok: true, output };
    }

    const action = firstValidationAction(firstError);
    pushTrace(decisionTrace, {
      stage: action,
      message: action === 'clarify' ? 'planner needs user clarification' : 'planner will use rule fallback',
      reason: firstError.code,
    });
    return {
      ok: false,
      action,
      errorMessage: firstError.message,
      output,
    };
  } catch (error) {
    pushTrace(decisionTrace, {
      stage: 'fallback',
      message: 'controlled planner threw; falling back to rule router',
      reason: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      action: 'fallback',
      errorMessage: 'Controlled planner failed',
      output: createPlannerOutput({
        source: 'rule_fallback',
        plan: [],
        decisionTrace,
        validationIssues: [],
      }),
    };
  }
}

function createDefaultControlledPlan(intent: ProjectAgentIntent): ControlledPlannerResult {
  const decisionTrace: AgentPlannerDecisionTraceItem[] = [];
  const candidate = buildCandidatePlan(intent, decisionTrace);
  const validationIssues = validateControlledPlan(intent, candidate);
  for (const issue of validationIssues) {
    pushTrace(decisionTrace, {
      stage: 'validate',
      message: issue.message,
      toolId: issue.toolId as ProjectAgentToolId | undefined,
      reason: issue.code,
    });
  }

  const output: AgentPlannerOutput = {
    source: 'controlled',
    plan: candidate,
    decisionTrace,
    validationIssues,
  };
  const firstError =
    validationIssues.find((issue) => issue.severity === 'error' && issue.stepIndex == null) ??
    validationIssues.find((issue) => issue.severity === 'error');
  if (!firstError) return { ok: true, output };

  const action = firstValidationAction(firstError);
  pushTrace(decisionTrace, {
    stage: action,
    message: action === 'clarify' ? 'planner needs user clarification' : 'planner will use rule fallback',
    reason: firstError.code,
  });
  return {
    ok: false,
    action,
    errorMessage: firstError.message,
    output,
  };
}

export function createControlledPlan(
  intent: ProjectAgentIntent,
  controlledPlanner?: AgentControlledPlanner
): ControlledPlannerResult {
  return controlledPlanner
    ? createInjectedControlledPlan(intent, controlledPlanner)
    : createDefaultControlledPlan(intent);
}
