import type { WorkflowAsset } from '../../types';

/** 根级网格 / 大图列表：新到旧（createdAt 降序） */
export function sortRootWorkflowAssetsNewestFirst(list: WorkflowAsset[]): WorkflowAsset[] {
  return [...list].sort((a, b) => {
    const ca = a.createdAt ?? 0;
    const cb = b.createdAt ?? 0;
    if (cb !== ca) return cb - ca;
    return a.id.localeCompare(b.id);
  });
}

/** 大纲：子资产沿 parentAssetId 得到 viewStack（不含子资产自身），用于组内子卡片定位 */
export function workflowOutlineAncestorStack(childAssetId: string, assets: WorkflowAsset[]): { assetId: string }[] {
  const target = assets.find((a) => a.id === childAssetId);
  if (!target?.parentAssetId) return [];
  const chain: string[] = [];
  let pid: string | undefined = target.parentAssetId;
  while (pid) {
    chain.push(pid);
    const p = assets.find((x) => x.id === pid);
    pid = p?.parentAssetId;
  }
  chain.reverse();
  return chain.map((id) => ({ assetId: id }));
}

/** 进入某组内部：栈为从根到该组（含该组） */
export function workflowOutlineDrillStackToEnterGroup(groupId: string, assets: WorkflowAsset[]): { assetId: string }[] {
  const chain: string[] = [];
  let id: string | undefined = groupId;
  while (id) {
    chain.push(id);
    const n = assets.find((a) => a.id === id);
    id = n?.parentAssetId;
  }
  chain.reverse();
  return chain.map((i) => ({ assetId: i }));
}

export function workflowFindGroupItemIndex(parent: WorkflowAsset, childAssetId: string): number | null {
  const items = parent.cutImageGroup ?? [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it && typeof it === 'object' && 'assetId' in it && (it as { assetId: string }).assetId === childAssetId) {
      return i;
    }
  }
  return null;
}

/** 大纲树中所有「有子项」的组节点 id（与 outlineTreeRows 遍历一致，含嵌套引用子资产） */
export function workflowOutlineExpandableGroupIds(assets: WorkflowAsset[], visibleRoots: WorkflowAsset[]): Set<string> {
  const ids = new Set<string>();
  const visit = (a: WorkflowAsset, visited: Set<string>) => {
    if (visited.has(a.id)) return;
    visited.add(a.id);
    const items = a.cutImageGroup ?? [];
    if (items.length > 0) ids.add(a.id);
    items.forEach((item) => {
      const isRef = item && typeof item === 'object' && 'assetId' in item;
      const childId = isRef ? (item as { assetId: string }).assetId : '';
      if (typeof item === 'string' || (item && typeof item === 'object' && 'r2Key' in item && !isRef)) return;
      if (isRef && childId) {
        const child = assets.find((x) => x.id === childId);
        if (child) visit(child, visited);
      }
    });
  };
  const seen = new Set<string>();
  visibleRoots.forEach((root) => visit(root, seen));
  return ids;
}
