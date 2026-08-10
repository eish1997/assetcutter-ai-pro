/**
 * Deterministic plan copy for assistant bubbles (P10 / section 16.1).
 * No LLM. Runtime perception can prefix the plan with the current target.
 */

import type { AgentPlannedTool } from '../../types/projectAgent';
import type { ProjectAgentPerceptionContext } from '../../types/runtimePerception';
import { formatPerceptionForPlanPrefix } from '../runtimePerception/visibleSummary';
import { getExpertProfile } from './experts/registry';

function prefixFromPerception(perception?: ProjectAgentPerceptionContext): string {
  const prefix = formatPerceptionForPlanPrefix(perception);
  return prefix ? `${prefix} -> ` : '';
}

function presetPlanLabel(step: AgentPlannedTool): string {
  const name = typeof step.args?.presetId === 'string' ? step.args.presetId.trim() : '';
  return name ? `run preset "${name}"` : step.label;
}

function expertPlanLabel(step: AgentPlannedTool): string {
  const expertId = typeof step.args?.expertId === 'string' ? step.args.expertId.trim() : '';
  const profile = expertId ? getExpertProfile(expertId) : null;
  if (profile) return `ask expert "${profile.displayName}"`;
  if (expertId) return `ask expert "${expertId}"`;
  return step.label;
}

function stepLabel(step: AgentPlannedTool): string {
  if (step.toolId === 'run_preset') return presetPlanLabel(step);
  if (step.toolId === 'invoke_expert') return expertPlanLabel(step);
  return step.label;
}

export function formatPlanTemplate(
  plan: AgentPlannedTool[],
  perception?: ProjectAgentPerceptionContext
): string {
  const prefix = prefixFromPerception(perception);
  if (!plan.length) return `${prefix}Plan: no available step`;
  if (plan.length === 1) return `${prefix}Plan: ${stepLabel(plan[0]!)}`;

  const labels = plan.map(stepLabel);
  const allSame = labels.every((label) => label === labels[0]);
  if (allSame) return `${prefix}Plan: ${labels[0]} x${plan.length}`;
  return `${prefix}Plan: ${labels.join(' -> ')}`;
}
