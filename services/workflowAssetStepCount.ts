import type { WorkflowAsset } from '../types';
import { computeAssetSetStats, isWorkflowAssetSetAsset } from './assetSet/assetSetAsset';
import { isGroupAsset } from './groupHelpers';
import {
  computeStoryboardTableStats,
  isWorkflowStoryboardTableAsset,
} from './storyboardTableAsset';

const RESULT_VER_SEP = '__v__';

function baseActionId(k: string): string {
  return k.includes(RESULT_VER_SEP) ? k.split(RESULT_VER_SEP)[0]! : k;
}

/** 与滚轮切换 / 步骤时间线一致的版本链（不含 cut_image 中间态） */
export function getWorkflowAssetStepKeys(asset: WorkflowAsset): string[] {
  if (isWorkflowStoryboardTableAsset(asset)) return ['original'];
  const keys: string[] = ['original'];
  for (const k of asset.resultOrder ?? []) {
    if (baseActionId(k) !== 'cut_image') keys.push(k);
  }
  return keys;
}

function countFlattenedGroupMemberSteps(asset: WorkflowAsset, allAssets: WorkflowAsset[]): number {
  const visited = new Set<string>();
  const walk = (node: WorkflowAsset): number => {
    if (visited.has(node.id)) return 0;
    visited.add(node.id);

    if (node.isGroup === true && node.assetIds?.length) {
      let sum = 0;
      for (const childId of node.assetIds) {
        const child = allAssets.find((x) => x.id === childId);
        if (!child) continue;
        if (isGroupAsset(child)) sum += walk(child);
        else sum += 1;
      }
      return sum;
    }

    let sum = 0;
    for (const item of node.cutImageGroup ?? []) {
      if (typeof item === 'string') {
        if (item.trim()) sum += 1;
        continue;
      }
      if (item && typeof item === 'object' && 'assetId' in item) {
        const child = allAssets.find((x) => x.id === item.assetId);
        if (!child) continue;
        if (isGroupAsset(child)) sum += walk(child);
        else sum += 1;
      } else if (item && typeof item === 'object' && 'r2Key' in item) {
        sum += 1;
      }
    }
    return sum;
  };
  return walk(asset);
}

/**
 * 资产卡片「内部步骤数」：按版本链 / 容器规模计数，不要求每步都有图（含文生文、3D 等）。
 */
export function resolveWorkflowAssetStepCount(
  asset: WorkflowAsset,
  allAssets: WorkflowAsset[]
): number {
  if (isWorkflowStoryboardTableAsset(asset)) {
    if (!asset.storyboardTable) return 0;
    return computeStoryboardTableStats(asset.storyboardTable).rowCount;
  }
  if (isWorkflowAssetSetAsset(asset)) {
    if (!asset.assetSet) return 0;
    return computeAssetSetStats(asset.assetSet).componentCount;
  }
  if (isGroupAsset(asset)) {
    return countFlattenedGroupMemberSteps(asset, allAssets);
  }
  return getWorkflowAssetStepKeys(asset).length;
}

export function shouldShowWorkflowAssetStepCountBadge(
  asset: WorkflowAsset,
  count: number
): boolean {
  if (count <= 0) return false;
  if (
    isGroupAsset(asset) ||
    isWorkflowStoryboardTableAsset(asset) ||
    isWorkflowAssetSetAsset(asset)
  ) {
    return count > 0;
  }
  return count > 1;
}

/** 与滚轮 / 大图切换一致的当前步（1-based） */
export function resolveWorkflowAssetDisplayStepIndex(asset: WorkflowAsset): number {
  const keys = getWorkflowAssetStepKeys(asset);
  if (keys.length <= 0) return 1;
  const idx = keys.indexOf(asset.displayKey);
  return (idx >= 0 ? idx : 0) + 1;
}

export type WorkflowAssetStepBadge = {
  current: number;
  total: number;
};

/**
 * 卡片角标：当前步 / 总步数（仅数字，如 2/5）。
 * 组卡片用 stack 预览索引；分镜表 / 资产集当前步固定为 1。
 */
export function resolveWorkflowAssetStepBadge(
  asset: WorkflowAsset,
  allAssets: WorkflowAsset[],
  opts: { groupPreviewIndex?: number } = {}
): WorkflowAssetStepBadge | null {
  const total = resolveWorkflowAssetStepCount(asset, allAssets);

  if (isGroupAsset(asset)) {
    const len = asset.assetIds?.length ?? 0;
    if (len > 1) {
      const raw = opts.groupPreviewIndex ?? 0;
      const current = ((raw % len) + len) % len + 1;
      return { current, total: len };
    }
    if (!shouldShowWorkflowAssetStepCountBadge(asset, total)) return null;
    return { current: 1, total };
  }

  if (!shouldShowWorkflowAssetStepCountBadge(asset, total)) return null;

  if (isWorkflowStoryboardTableAsset(asset) || isWorkflowAssetSetAsset(asset)) {
    return { current: 1, total };
  }

  return {
    current: resolveWorkflowAssetDisplayStepIndex(asset),
    total,
  };
}

/** @deprecated 使用 resolveWorkflowAssetStepCount */
export const getWorkflowAssetVersionKeys = getWorkflowAssetStepKeys;
