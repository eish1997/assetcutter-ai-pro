import type { WorkflowAsset } from '../types';
import { sortRootWorkflowAssetsNewestFirst } from '../components/workflow/workflowOutlineUtils';

function interpolateCreatedAt(before: number, after: number): number {
  if (before === after) return before + 1;
  const mid = Math.floor((before + after) / 2);
  if (mid === before || mid === after) return before + 1;
  return mid;
}

export function computeCreatedAtForRootInsert(
  sortedRoots: WorkflowAsset[],
  targetId: string,
  position: 'before' | 'after',
  excludeIds: ReadonlySet<string>
): number {
  const list = sortedRoots.filter((a) => !excludeIds.has(a.id));
  const targetIdx = list.findIndex((a) => a.id === targetId);
  if (targetIdx < 0) return Date.now();

  const targetTs = list[targetIdx]?.createdAt ?? Date.now();

  if (position === 'before') {
    const newer = targetIdx > 0 ? list[targetIdx - 1] : null;
    if (!newer) return targetTs + 1;
    return interpolateCreatedAt(targetTs, newer.createdAt ?? targetTs + 2);
  }

  const older = targetIdx < list.length - 1 ? list[targetIdx + 1] : null;
  if (!older) return targetTs - 1;
  return interpolateCreatedAt(older.createdAt ?? targetTs - 2, targetTs);
}

export function applyRootWorkflowAssetReorder(
  assets: WorkflowAsset[],
  dragIds: readonly string[],
  targetId: string,
  position: 'before' | 'after'
): WorkflowAsset[] {
  const uniqueDragIds = [...new Set(dragIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (uniqueDragIds.length === 0 || !targetId) return assets;

  const exclude = new Set(uniqueDragIds);
  const roots = sortRootWorkflowAssetsNewestFirst(
    assets.filter((a) => !a.archived && !a.inRepository && !a.groupId)
  );
  const baseTs = computeCreatedAtForRootInsert(roots, targetId, position, exclude);

  return assets.map((asset) => {
    const dragIndex = uniqueDragIds.indexOf(asset.id);
    if (dragIndex < 0) return asset;
    return {
      ...asset,
      groupId: undefined,
      groupOrder: undefined,
      createdAt: baseTs - dragIndex,
    };
  });
}
