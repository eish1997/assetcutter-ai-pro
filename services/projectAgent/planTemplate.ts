/**
 * Deterministic plan copy for assistant bubbles (P10 / §16.1).
 * No LLM.
 */

import type { AgentPlannedTool } from '../../types/projectAgent';
import { getExpertProfile } from './experts/registry';

export function formatPlanTemplate(plan: AgentPlannedTool[]): string {
  if (!plan.length) return '计划：无可用步骤';
  if (plan.length === 1) {
    const p = plan[0]!;
    if (p.toolId === 'run_preset') {
      const name = typeof p.args?.presetId === 'string' ? p.args.presetId : '';
      return name ? `计划：运行预设「${name}」` : `计划：${p.label}`;
    }
    if (p.toolId === 'invoke_expert') {
      const expertId = typeof p.args?.expertId === 'string' ? p.args.expertId : '';
      const profile = expertId ? getExpertProfile(expertId) : null;
      return profile
        ? `计划：调用专家「${profile.displayName}」`
        : expertId
          ? `计划：调用专家「${expertId}」`
          : `计划：${p.label}`;
    }
    return `计划：${p.label}`;
  }
  const labels = plan.map((p) => p.label);
  const allSame = labels.every((l) => l === labels[0]);
  if (allSame) {
    return `计划：${labels[0]}×${plan.length}`;
  }
  return `计划：${labels.join(' → ')}`;
}
