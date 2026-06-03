import type { CustomAppModule } from '../types';

export const MAX_CAPABILITY_PRESET_TAGS = 10;

/** 规范化预设标签：去空白、去重、上限 10 条 */
export function normalizeCapabilityPresetTags(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const tag = String(item ?? '').trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_CAPABILITY_PRESET_TAGS) break;
  }
  return out.length > 0 ? out : undefined;
}

export function capabilityPresetHasTag(mod: CustomAppModule | null | undefined, tag: string): boolean {
  const needle = String(tag ?? '').trim();
  if (!needle || !mod?.tags?.length) return false;
  return mod.tags.includes(needle);
}

/** 从预设列表收集去重标签（按字典序） */
export function collectCapabilityPresetTags(presets: CustomAppModule[]): string[] {
  const seen = new Set<string>();
  for (const p of presets) {
    for (const tag of p.tags ?? []) {
      const t = String(tag ?? '').trim();
      if (t) seen.add(t);
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
