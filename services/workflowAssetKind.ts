import type { WorkflowAsset } from '../types';

/** 轻量资产 kind 判定：供 `workflowCompanionAssets` 等底层模块使用，避免拉取分镜/套图重依赖链。 */

export function isWorkflowTextAsset(a: WorkflowAsset): boolean {
  return a.assetKind === 'text';
}

export function hasWorkflowStoryboardTablePayload(a: WorkflowAsset): boolean {
  const table = a.storyboardTable;
  return Boolean(table && typeof table === 'object' && Array.isArray(table.rows));
}

export function isWorkflowStoryboardTableAsset(a: WorkflowAsset): boolean {
  return a.assetKind === 'storyboard_table' || hasWorkflowStoryboardTablePayload(a);
}

export function hasWorkflowAssetSetPayload(a: WorkflowAsset): boolean {
  const doc = a.assetSet;
  return Boolean(doc && typeof doc === 'object' && Array.isArray(doc.sourceAssets));
}

export function isWorkflowAssetSetAsset(a: WorkflowAsset): boolean {
  return a.assetKind === 'asset_set' || hasWorkflowAssetSetPayload(a);
}
