/**
 * 资产组迁移工具
 * 将旧的 cutImageGroup + parentAssetId 结构迁移为新的 groupId 结构
 */
import type { WorkflowAsset } from '../types';

/** 生成唯一 groupId */
export function generateGroupId(): string {
  return `grp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** 迁移资产数组（读取时调用）
 * 旧结构：父资产有 cutImageGroup，子资产有 parentAssetId
 * 新结构：所有同组资产共享 groupId
 */
export function migrateLegacyAssets(assets: WorkflowAsset[]): WorkflowAsset[] {
  // 已经有新结构（groupId）的不需要迁移
  if (!assets.some((a) => a.cutImageGroup?.length || a.parentAssetId)) {
    return assets;
  }

  // 建立 parentId -> groupInfo 的映射
  const parentGroupMap = new Map<string, { groupId: string; groupLabel: string }>();
  const migrated: WorkflowAsset[] = [];

  // 第一遍：处理有 cutImageGroup 的资产（父资产）
  for (const asset of assets) {
    if (asset.groupId !== undefined) {
      // 已经是新结构
      migrated.push(asset);
      continue;
    }

    if (asset.cutImageGroup?.length) {
      // 这是父资产，创建新 group
      const groupId = generateGroupId();
      const groupLabel = asset.groupLabel || '组';
      parentGroupMap.set(asset.id, { groupId, groupLabel });

      migrated.push({
        ...asset,
        groupId,
        groupLabel,
        groupOrder: 0,
        // 清理旧字段
        cutImageGroup: undefined,
        groupKind: undefined,
        parentAssetId: undefined,
      });
    } else if (!asset.parentAssetId) {
      // 既没有 cutImageGroup 也没有 parentAssetId，不在组内
      migrated.push({
        ...asset,
        groupId: undefined,
        cutImageGroup: undefined,
        groupKind: undefined,
        parentAssetId: undefined,
      });
    }
    // 有 parentAssetId 的暂时跳过，第二遍处理
  }

  // 第二遍：处理子资产（通过 parentAssetId 引用父资产）
  for (const asset of assets) {
    if (asset.groupId !== undefined) continue; // 已在第一遍处理
    if (!asset.parentAssetId) continue; // 不在组内

    const parentInfo = parentGroupMap.get(asset.parentAssetId);
    if (!parentInfo) {
      // 父资产不在列表中，创建一个新组
      const groupId = generateGroupId();
      const groupLabel = '组';
      parentGroupMap.set(asset.parentAssetId, { groupId, groupLabel });
      migrated.push({
        ...asset,
        groupId,
        groupLabel,
        groupOrder: 0,
        cutImageGroup: undefined,
        groupKind: undefined,
        parentAssetId: undefined,
      });
    } else {
      migrated.push({
        ...asset,
        groupId: parentInfo.groupId,
        groupLabel: parentInfo.groupLabel,
        groupOrder: 0,
        cutImageGroup: undefined,
        groupKind: undefined,
        parentAssetId: undefined,
      });
    }
  }

  return migrated;
}

/** 迁移单个资产（需要传入完整资产数组以解析引用关系）
 * @deprecated 建议使用 migrateLegacyAssets
 */
export function migrateLegacyAsset(asset: WorkflowAsset, allAssets?: WorkflowAsset[]): WorkflowAsset {
  if (asset.groupId !== undefined) return asset;
  if (!asset.cutImageGroup?.length && !asset.parentAssetId) return asset;

  if (allAssets && asset.parentAssetId) {
    const parent = allAssets.find((a) => a.id === asset.parentAssetId);
    if (parent) {
      const migrated = migrateLegacyAssets([...allAssets]);
      return migrated.find((a) => a.id === asset.id) || asset;
    }
  }

  // 简化版：只处理父资产
  const groupId = generateGroupId();
  const groupLabel = asset.groupLabel || (asset.groupKind === 'manual' ? '组' : '切割');
  return {
    ...asset,
    groupId,
    groupLabel,
    groupOrder: 0,
    cutImageGroup: undefined,
    groupKind: undefined,
    parentAssetId: undefined,
  };
}
