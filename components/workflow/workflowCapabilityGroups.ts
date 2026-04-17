import { CAPABILITY_CATEGORIES } from '../../types';
import type { CustomAppModule } from '../../types';
import { getCapabilityEngine } from '../../services/capabilityExecutor';

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
  const imageProcess: CustomAppModule[] = [];
  const other: CustomAppModule[] = [];
  presets.forEach((p) => {
    const cat = p.category ?? 'image_to_image';
    if (cat === 'image_to_image' && getCapabilityEngine(p) === 'builtin') {
      imageProcess.push(p);
      return;
    }
    if (knownIds.has(cat)) {
      map[cat].push(p);
    } else {
      other.push(p);
    }
  });
  const groups: CapabilityCategoryGroup[] = [];
  CAPABILITY_CATEGORIES.forEach((c) => {
    if (c.id === 'image_to_image' && imageProcess.length > 0) {
      groups.push({
        category: { id: 'image_process', label: '图像处理', desc: '内置图像处理能力' },
        list: imageProcess,
      });
    }
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
