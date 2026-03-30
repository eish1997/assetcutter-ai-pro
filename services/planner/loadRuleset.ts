import type { PlannerRulesetDocument } from '../../types/planner';

const DEFAULT_RULESET_PATH = '/planner-rules/default.json';

/**
 * 拉取默认规则集（Vite `public` → 根路径）。
 */
export async function loadDefaultRuleset(
  path: string = DEFAULT_RULESET_PATH
): Promise<PlannerRulesetDocument> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`无法加载 Planner 规则：HTTP ${res.status}`);
  }
  return (await res.json()) as PlannerRulesetDocument;
}

/**
 * 校验规则中引用的 `preset_id` 是否均存在于当前能力预设列表。
 */
export function validateRulesetPresetIds(
  ruleset: PlannerRulesetDocument,
  presetIds: Set<string>
): { missing: string[] } {
  const missing = new Set<string>();
  for (const r of ruleset.rules) {
    if (r.enabled === false) continue;
    for (const s of r.then.steps) {
      if (!presetIds.has(s.preset_id)) missing.add(s.preset_id);
    }
  }
  return { missing: [...missing] };
}
