import type { WorkflowAsset } from '../../types';

/** 按 id 去重（保留首次出现）。重复 id 会导致 justified 占两格但 React 只挂一卡 → 中间隐形空位。 */
export function dedupeWorkflowAssetsById(list: WorkflowAsset[]): WorkflowAsset[] {
  const seen = new Set<string>();
  const out: WorkflowAsset[] = [];
  for (const asset of list) {
    const id = String(asset?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(asset);
  }
  return out;
}

/** 根级网格 / 大图列表：新到旧（createdAt 降序） */
export function sortRootWorkflowAssetsNewestFirst(list: WorkflowAsset[]): WorkflowAsset[] {
  return dedupeWorkflowAssetsById(list).sort((a, b) => {
    const ca = a.createdAt ?? 0;
    const cb = b.createdAt ?? 0;
    if (cb !== ca) return cb - ca;
    return a.id.localeCompare(b.id);
  });
}

export function workflowFindGroupItemIndex(parent: WorkflowAsset, childAssetId: string): number | null {
  // 新版：使用 isGroup + assetIds
  if (parent.isGroup === true && parent.assetIds?.length) {
    const idx = parent.assetIds.indexOf(childAssetId);
    return idx >= 0 ? idx : null;
  }
  return null;
}

/** 大纲树中所有「有子项」的组节点 id（与 outlineTreeRows 遍历一致，含嵌套引用子资产） */
export function workflowOutlineExpandableGroupIds(assets: WorkflowAsset[], visibleRoots: WorkflowAsset[]): Set<string> {
  const ids = new Set<string>();
  const visit = (a: WorkflowAsset, visited: Set<string>) => {
    if (visited.has(a.id)) return;
    visited.add(a.id);
    // 新版：使用 isGroup + assetIds
    if (a.isGroup === true && a.assetIds?.length) {
      ids.add(a.id);
      a.assetIds.forEach((childId) => {
        const child = assets.find((x) => x.id === childId);
        if (child) visit(child, visited);
      });
    }
  };
  const seen = new Set<string>();
  visibleRoots.forEach((root) => visit(root, seen));
  return ids;
}
