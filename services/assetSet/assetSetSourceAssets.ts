import type { AssetSetSourceAsset, AssetSetSourceSlotKind } from '../../types';
import { pickStoryboardNamedAssetImageFields } from '../storyboardNamedAssetImage';

const id = () => Math.random().toString(36).slice(2, 11);

const SLOT_DEFAULT_NAMES: Record<Exclude<AssetSetSourceSlotKind, 'custom'>, string> = {
  original: '原画',
  styled: '转风格',
  multiview: '多视角',
};

export function defaultAssetSetSourceAssetName(
  slotKind: AssetSetSourceSlotKind | undefined,
  index: number
): string {
  if (slotKind && slotKind !== 'custom' && SLOT_DEFAULT_NAMES[slotKind]) {
    return SLOT_DEFAULT_NAMES[slotKind];
  }
  return `参考图 ${Math.max(1, index + 1)}`;
}

export function createAssetSetSourceAsset(
  partial?: Partial<AssetSetSourceAsset>,
  index = 0
): AssetSetSourceAsset {
  const slotKind = partial?.slotKind;
  const name =
    partial && 'name' in partial
      ? String(partial.name ?? '').trim()
      : defaultAssetSetSourceAssetName(slotKind, index);
  return {
    id: partial?.id?.trim() || id(),
    name,
    ...(slotKind ? { slotKind } : {}),
    ...pickStoryboardNamedAssetImageFields(partial),
  };
}

export function normalizeAssetSetSourceAssets(raw: unknown): AssetSetSourceAsset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      return createAssetSetSourceAsset(item as AssetSetSourceAsset, index);
    })
    .filter((item): item is AssetSetSourceAsset => Boolean(item));
}

export function createDefaultAssetSetSourceAssets(originalImage?: string): AssetSetSourceAsset[] {
  return [
    createAssetSetSourceAsset({ slotKind: 'original', image: originalImage }, 0),
    createAssetSetSourceAsset({ slotKind: 'styled' }, 1),
    createAssetSetSourceAsset({ slotKind: 'multiview' }, 2),
  ];
}

export function resolveAssetSetSourceAssetBySlot(
  assets: AssetSetSourceAsset[],
  slotKind: AssetSetSourceSlotKind
): AssetSetSourceAsset | undefined {
  return assets.find((a) => a.slotKind === slotKind);
}

export function assetSetSourceAssetCompanionKey(sourceAssetId: string): string {
  return `asset-set-source-${sourceAssetId}`;
}
