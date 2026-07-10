/**
 * Deterministic plan copy for assistant bubbles (P10 / §16.1).
 * No LLM.
 */

import type { AgentPlannedTool } from '../../types/projectAgent';

export function formatPlanTemplate(plan: AgentPlannedTool[]): string {
  if (!plan.length) return '计划：无可用步骤';
  if (plan.length === 1) {
    const p = plan[0]!;
    if (p.toolId === 'run_preset') {
      const name = typeof p.args?.presetId === 'string' ? p.args.presetId : '';
      return name ? `计划：运行预设「${name}」` : `计划：${p.label}`;
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
