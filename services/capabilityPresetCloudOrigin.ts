import { loadInstalledPacks } from './storePackHistory';
import type { RemotePresetItem } from './storeCatalogHook';

export function presetIdFromStorePackId(packId: string): string | null {
  const id = String(packId || '').trim();
  if (id.startsWith('preset_')) return id.slice('preset_'.length);
  return null;
}

/** 来自能力商店 catalog / 已安装远程包的能力预设 id 集合 */
export function buildCloudPresetIdSet(remoteItems: RemotePresetItem[] = []): Set<string> {
  const set = new Set<string>();
  for (const row of remoteItems) {
    const pid = String(row.preset?.id || '').trim();
    if (pid) set.add(pid);
  }
  for (const pack of loadInstalledPacks()) {
    if (pack.type !== 'capability_presets') continue;
    const pid = presetIdFromStorePackId(pack.id);
    if (pid) set.add(pid);
  }
  return set;
}

export function isCloudCapabilityPreset(presetId: string, cloudPresetIds: ReadonlySet<string> | null | undefined): boolean {
  const id = String(presetId || '').trim();
  if (!id || !cloudPresetIds) return false;
  return cloudPresetIds.has(id);
}

export type CapabilitySidebarOriginFilter = 'cloud' | 'mine';

export function matchesCapabilitySidebarOriginFilter(
  presetId: string,
  filter: CapabilitySidebarOriginFilter | null | undefined,
  cloudPresetIds: ReadonlySet<string> | null | undefined
): boolean {
  if (!filter) return true;
  const cloud = isCloudCapabilityPreset(presetId, cloudPresetIds);
  return filter === 'cloud' ? cloud : !cloud;
}
