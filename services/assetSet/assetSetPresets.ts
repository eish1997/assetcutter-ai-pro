import type { CustomAppModule } from '../../types';
import { getCapabilityEngine } from '../capabilityExecutor';
import { normalizeGenerate3DPresetForRun } from '../generate3d/normalizePreset';

export const ASSET_SET_PANEL_PREFS_KEY = 'ac_asset_set_panel_prefs_v1';

export const DEFAULT_ASSET_SET_COMPONENT_SHEET_INSTRUCTION = `提取图片中框选的元素，保持结构不变，重新按网格排列，灰色背景。只保留框选的元素。`;

export const ASSET_SET_DEFAULT_VIEW_ROLES = [
  'perspective',
  'front',
  'back',
  'left',
  'right',
] as const;

export function listAssetSetImagePresets(presets: CustomAppModule[]): CustomAppModule[] {
  return presets.filter((p) => p.enabled !== false && getCapabilityEngine(p) === 'gen_image');
}

export function listAssetSetSingle3dPresets(presets: CustomAppModule[]): CustomAppModule[] {
  return presets.filter((p) => {
    if (p.enabled === false || !p.generate3D) return false;
    const g = normalizeGenerate3DPresetForRun(p.generate3D);
    return g.tripoTaskType !== 'multiview_to_model' && g.tripoTaskType !== 'text_to_model';
  });
}

export function listAssetSetMulti3dPresets(presets: CustomAppModule[]): CustomAppModule[] {
  return presets.filter((p) => {
    if (p.enabled === false || !p.generate3D) return false;
    const g = normalizeGenerate3DPresetForRun(p.generate3D);
    return g.tripoTaskType === 'multiview_to_model';
  });
}

export function resolveAssetSetPreset(
  presets: CustomAppModule[],
  presetId: string | undefined,
  fallback?: CustomAppModule
): CustomAppModule | null {
  const id = String(presetId || '').trim();
  if (id) {
    const hit = presets.find((p) => p.id === id);
    if (hit && hit.enabled !== false) return hit;
  }
  return fallback ?? null;
}
