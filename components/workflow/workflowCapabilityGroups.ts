import { CAPABILITY_CATEGORIES } from '../../types';
import type { CustomAppModule } from '../../types';

export type CapabilityCategoryGroup = {
  category: { id: string; label: string; desc: string };
  list: CustomAppModule[];
};

/** 按 `CAPABILITY_CATEGORIES` 将已启用预设分组；未知类目归入「其他」 */
export function groupCapabilityPresetsByCategory(presets: CustomAppModule[]): CapabilityCategoryGroup[] {
  const knownIds = new Set(CAPABILITY_CATEGORIES.map((c) => c.id));
  const map: Record<string, CustomAppModule[]> = {};
  CAPABILITY_CATEGORIES.forEach((c) => {
    map[c.id] = [];
  });
  const other: CustomAppModule[] = [];
  presets.forEach((p) => {
    const cat = p.category ?? 'image_process';
    if (knownIds.has(cat)) {
      map[cat].push(p);
    } else {
      other.push(p);
    }
  });
  const groups: CapabilityCategoryGroup[] = CAPABILITY_CATEGORIES.map((c) => ({
    category: c,
    list: map[c.id] ?? [],
  })).filter((g) => g.list.length > 0);
  if (other.length > 0) {
    groups.push({ category: { id: 'other', label: '其他', desc: '' }, list: other });
  }
  return groups;
}
