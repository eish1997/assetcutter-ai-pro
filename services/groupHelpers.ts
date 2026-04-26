/**
 * 组兼容辅助函数
 * 统一使用 isGroup === true 作为组的唯一判断标准
 */
import type { WorkflowAsset, WorkflowCutGroupItem } from '../types';
import { generateGroupId } from './assetGroupMigration';

/** 判断是否为组容器资产（统一标准：isGroup === true） */
export function isGroupAsset(asset: WorkflowAsset): boolean {
  return asset.isGroup === true;
}

/** 获取组成员 ID 列表 */
export function getGroupMemberIds(asset: WorkflowAsset): string[] {
  return asset.assetIds ?? [];
}

/** 获取组成员资产列表 */
export function getGroupMemberAssets(asset: WorkflowAsset, allAssets: WorkflowAsset[]): WorkflowAsset[] {
  const memberIds = getGroupMemberIds(asset);
  return memberIds.map((id) => allAssets.find((a) => a.id === id)).filter((a): a is WorkflowAsset => !!a);
}

/** 获取组的封面图片 */
export function getGroupCoverImage(asset: WorkflowAsset, allAssets: WorkflowAsset[], getDisplayImage: (a: WorkflowAsset) => string): string {
  const memberIds = getGroupMemberIds(asset);
  for (const id of memberIds) {
    const member = allAssets.find((a) => a.id === id);
    if (member) {
      const img = getDisplayImage(member);
      if (img) return img;
    }
  }
  return asset.original || '';
}

/** 判断资产是否在组内（作为子项） */
export function isGroupChildAsset(asset: WorkflowAsset): boolean {
  return !!asset.groupId && asset.groupOrder !== -1;
}

/** 获取资产所属的 groupId */
export function getAssetGroupId(asset: WorkflowAsset): string | null {
  return asset.groupId ?? null;
}

/** 获取组标签 */
export function getGroupDisplayLabel(asset: WorkflowAsset): string {
  if (asset.groupLabel) return asset.groupLabel;
  return '组';
}

/** 判断资产是否为根资产（不是组的子项） */
export function isRootAsset(asset: WorkflowAsset): boolean {
  return !asset.groupId || asset.groupOrder === -1;
}

/** 为资产创建新组 */
export function assignAssetToNewGroup(
  assets: WorkflowAsset[],
  assetIds: string[],
  groupLabel?: string
): WorkflowAsset[] {
  const groupId = generateGroupId();
  const usedLabels = new Set(assets.map((a) => a.groupLabel).filter(Boolean));
  const label = groupLabel || generateGroupLabel(usedLabels, '组');

  return assets.map((asset) => {
    if (!assetIds.includes(asset.id)) return asset;
    const order = assetIds.indexOf(asset.id);
    return {
      ...asset,
      groupId,
      groupLabel: label,
      groupOrder: order,
    };
  });
}

/** 批量将资产移出组 */
export function removeAssetsFromGroup(assets: WorkflowAsset[], assetIds: string[]): WorkflowAsset[] {
  return assets.map((asset) => {
    if (!assetIds.includes(asset.id)) return asset;
    return {
      ...asset,
      groupId: undefined,
      groupLabel: undefined,
      groupOrder: undefined,
    };
  });
}

/** 生成组标签（避免重复） */
function generateGroupLabel(usedLabels: Set<string>, base: string): string {
  let counter = 1;
  let label = base;
  while (usedLabels.has(label)) {
    label = `${base} ${counter++}`;
  }
  return label;
}

/** 兼容旧数据：迁移旧组资产到新格式 */
export function migrateLegacyGroupToNewFormat(
  coverAsset: WorkflowAsset,
  childAssets: WorkflowAsset[]
): WorkflowAsset[] {
  if (!coverAsset.cutImageGroup?.length) return [coverAsset, ...childAssets];

  const groupId = coverAsset.groupId || generateGroupId();
  const label = coverAsset.groupLabel || getGroupDisplayLabel(coverAsset);

  // 更新封面
  const migratedCover: WorkflowAsset = {
    ...coverAsset,
    isGroup: true,
    groupId,
    groupLabel: label,
    groupOrder: -1,
    assetIds: childAssets.map((a) => a.id),
    // 清理旧字段
    cutImageGroup: undefined,
    parentAssetId: undefined,
  };

  // 更新子资产
  const migratedChildren = childAssets.map((child, idx) => ({
    ...child,
    groupId,
    groupLabel: label,
    groupOrder: idx,
    parentAssetId: undefined,
  }));

  return [migratedCover, ...migratedChildren];
}
