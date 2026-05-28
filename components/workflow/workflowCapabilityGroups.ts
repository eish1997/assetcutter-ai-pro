import { CAPABILITY_CATEGORIES } from '../../types';
import type { CustomAppModule } from '../../types';
import { isImageProcessPreset } from '../../services/capabilityExecutor';

export type CapabilityCategoryGroup = {
  category: { id: string; label: string; desc: string };
  list: CustomAppModule[];
};

function resolvePresetGroupCategory(p: CustomAppModule): (typeof CAPABILITY_CATEGORIES)[number]['id'] | 'other' {
  if (isImageProcessPreset(p)) return 'image_process';
  const cat = p.category ?? 'image_to_image';
  const known = CAPABILITY_CATEGORIES.some((c) => c.id === cat);
  return known ? cat : 'other';
}

/** 按 `CAPABILITY_CATEGORIES` 将已启用预设分组；未知类目归入「其他」 */
export function groupCapabilityPresetsByCategory(presets: CustomAppModule[]): CapabilityCategoryGroup[] {
  const map: Record<string, CustomAppModule[]> = {};
  CAPABILITY_CATEGORIES.forEach((c) => {
    map[c.id] = [];
  });
  const other: CustomAppModule[] = [];
  presets.forEach((p) => {
    const cat = resolvePresetGroupCategory(p);
    if (cat === 'other') {
      other.push(p);
      return;
    }
    map[cat].push(p);
  });
  const groups: CapabilityCategoryGroup[] = [];
  CAPABILITY_CATEGORIES.forEach((c) => {
    const list = map[c.id] ?? [];
    if (list.length > 0) {
      groups.push({ category: c, list });
    }
  });
  if (other.length > 0) {
    groups.push({ category: { id: 'other', label: '其他', desc: '' }, list: other });
  }
  return groups;
}
