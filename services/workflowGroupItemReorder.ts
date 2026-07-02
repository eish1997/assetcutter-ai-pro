import type { WorkflowAsset } from '../types';
import { isGroupAsset } from './groupHelpers';

function normalizeIndexes(indexes: readonly number[], max: number): number[] {
  return [...new Set(indexes)]
    .filter((i) => i >= 0 && i < max)
    .sort((a, b) => a - b);
}

/** 组内 `assetIds` 顺序调整（拖放到间隙时） */
export function reorderManualGroupItemIndexes(
  assets: WorkflowAsset[],
  groupAssetId: string,
  dragIndexes: readonly number[],
  targetIndex: number,
  position: 'before' | 'after'
): WorkflowAsset[] {
  const groupIdx = assets.findIndex((a) => a.id === groupAssetId);
  if (groupIdx < 0) return assets;
  const group = assets[groupIdx];
  if (!isGroupAsset(group)) return assets;

  const items = [...(group.assetIds ?? [])];
  const max = items.length;
  const from = normalizeIndexes(dragIndexes, max);
  if (from.length === 0 || targetIndex < 0 || targetIndex >= max) return assets;

  const moving = from.map((i) => items[i]).filter(Boolean);
  if (moving.length === 0) return assets;

  const remaining = items.filter((_id, i) => !from.includes(i));
  let insertAt = position === 'before' ? targetIndex : targetIndex + 1;
  for (const i of from) {
    if (i < insertAt) insertAt -= 1;
  }
  insertAt = Math.max(0, Math.min(remaining.length, insertAt));
  remaining.splice(insertAt, 0, ...moving);

  const orderById = new Map<string, number>();
  remaining.forEach((id, i) => orderById.set(id, i));

  return assets.map((asset) => {
    if (asset.id === groupAssetId && isGroupAsset(asset)) {
      return { ...asset, assetIds: remaining };
    }
    const ord = orderById.get(asset.id);
    if (ord != null && asset.groupId === groupAssetId) {
      return { ...asset, groupOrder: ord };
    }
    return asset;
  });
}
