import type { WorkflowAsset, WorkflowPendingTask } from '../types';
import { isGroupAsset } from './groupHelpers';
import {
  isWorkflowAssetSetAsset,
  normalizeAssetSetOnAsset,
  upgradeLegacyWorkflowAssetSetAsset,
} from './assetSet/assetSetAsset';
import {
  isWorkflowStoryboardTableAsset,
  normalizeStoryboardTableOnAsset,
  upgradeLegacyWorkflowStoryboardTableAsset,
} from './storyboardTableAsset';

export type WorkflowBundleSanitizeStats = {
  /** 从组 assetIds 中移除的无效或重复引用条数 */
  repairedGroupRefSlots: number;
  /** 因成员全部无效而降级为非组卡片的组数量 */
  demotedEmptyGroups: number;
  /** 从 pending 中移除的孤儿任务数 */
  prunedPendingTasks: number;
};

/**
 * 项目加载后自愈：修复组 `assetIds` 幽灵引用、重复 id；空组降级为普通卡；
 * 并移除指向不存在资产的队列任务（避免执行时报错/污染状态）。
 */
export function sanitizeWorkflowProjectBundle(
  assets: WorkflowAsset[],
  pending: WorkflowPendingTask[]
): {
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
  stats: WorkflowBundleSanitizeStats;
} {
  const stats: WorkflowBundleSanitizeStats = {
    repairedGroupRefSlots: 0,
    demotedEmptyGroups: 0,
    prunedPendingTasks: 0,
  };

  const validIds = new Set(assets.map((a) => a.id));

  const nextAssets = assets.map((a) => {
    const upgradedSet = upgradeLegacyWorkflowAssetSetAsset(a);
    if (isWorkflowAssetSetAsset(upgradedSet)) {
      try {
        return normalizeAssetSetOnAsset(upgradedSet);
      } catch (e) {
        console.warn('[workspace] asset_set normalize failed, keeping raw asset', upgradedSet.id, e);
        return upgradedSet.assetKind === 'asset_set'
          ? upgradedSet
          : { ...upgradedSet, assetKind: 'asset_set' as const };
      }
    }
    const upgraded = upgradeLegacyWorkflowStoryboardTableAsset(upgradedSet);
    if (isWorkflowStoryboardTableAsset(upgraded)) {
      try {
        return normalizeStoryboardTableOnAsset(upgraded);
      } catch (e) {
        console.warn('[workspace] storyboard_table normalize failed, keeping raw asset', upgraded.id, e);
        return upgraded.assetKind === 'storyboard_table'
          ? upgraded
          : { ...upgraded, assetKind: 'storyboard_table' as const };
      }
    }
    if (!isGroupAsset(a) || !Array.isArray(a.assetIds)) {
      if (!isGroupAsset(a) && a.assetIds != null) {
        const { assetIds: _drop, ...rest } = a;
        return rest as WorkflowAsset;
      }
      return a;
    }

    const origLen = a.assetIds.length;
    const seen = new Set<string>();
    const next: string[] = [];
    for (const raw of a.assetIds) {
      const id = String(raw || '').trim();
      if (!id || !validIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      next.push(id);
    }

    if (next.length === 0) {
      stats.demotedEmptyGroups += 1;
      stats.repairedGroupRefSlots += origLen;
      const { isGroup: _ig, assetIds: _ai, ...rest } = a;
      return rest as WorkflowAsset;
    }

    if (next.length !== origLen || next.some((id, i) => id !== a.assetIds![i])) {
      stats.repairedGroupRefSlots += origLen - next.length;
      return { ...a, assetIds: next };
    }
    return a;
  });

  const validAfter = new Set(nextAssets.map((x) => x.id));
  const nextPending = pending.filter((t) => {
    const aid = String(t.assetId || '').trim();
    if (!aid || !validAfter.has(aid)) {
      stats.prunedPendingTasks += 1;
      return false;
    }
    return true;
  });

  return { assets: nextAssets, pending: nextPending, stats };
}
