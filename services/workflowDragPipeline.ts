import type { WorkflowAsset } from '../types';

/** 与 `WorkflowSection` 内 `dataTransfer.setData` 一致，避免 MIME 字符串散落 */
export const DT_AC_WORKFLOW_EXPORT = 'application/x-ac-workflow-export';

/** 功能区能力块 / 常用入口 / 复合能力：拖起时写入，便于主区域右侧留白识别「禁用能力」拖拽（`text/plain` 过宽，不能单独用于 dragover） */
export const DT_AC_CAPABILITY_ACTION = 'application/x-ac-capability-action';
/** 功能能力拖拽来源：`favorite`(常用区) / `catalog`(原始分组区) */
export const DT_AC_CAPABILITY_ACTION_SOURCE = 'application/x-ac-capability-action-source';

/** 工作区「能力」列底部预设卡片拖向功能区侧栏时写入，与侧栏能力块拖拽区分 */
export const DT_AC_CAPABILITY_FROM_EDITOR = 'application/x-ac-capability-from-editor';

/** 与 `WorkflowSection` 中 `onDragStart` 写入的 JSON 结构一致（大纲 / 根网格共用） */
export type AcWorkflowExportPayload =
  | { mode: 'roots'; assetIds: string[] }
  | { mode: 'groupItems'; items: Array<{ parentId: string; index: number }> };

/** 功能区 Drop、侧栏归档/删除等共用的「拖拽来源」 */
export type WorkflowDragSourceRoot = { kind: 'root'; assetIds: string[] };
export type WorkflowDragSourceGroup = { kind: 'group'; groupAssetId: string; itemIndexes: number[] };
export type WorkflowDragSource = WorkflowDragSourceRoot | WorkflowDragSourceGroup;

export type WorkflowEffectiveSelection =
  | { kind: 'none' }
  | { kind: 'root'; primaryAssetId: string; selectedRootIds: string[] }
  | {
      kind: 'group';
      groupAssetId: string;
      selectedGroupKeys: string[];
      /** 首个选中槽若为 `{ assetId }` 则有值，纯 string 槽为 null */
      primaryChildAssetId: string | null;
      primarySlotIndex: number | null;
    };

const uniqSortedIndexes = (indexes: number[]): number[] =>
  [...new Set(indexes.filter((i) => typeof i === 'number' && i >= 0))].sort((a, b) => a - b);

/** 由 React 拖拽 state 解析为统一来源（组内优先于根，与现有「组内拖出」语义一致） */
export function parseWorkflowDragSource(
  draggingAssetIds: string[] | null | undefined,
  draggingGroupItems: { groupAssetId: string; itemIndexes: number[] } | null | undefined
): WorkflowDragSource | null {
  if (draggingGroupItems?.itemIndexes?.length) {
    return {
      kind: 'group',
      groupAssetId: draggingGroupItems.groupAssetId,
      itemIndexes: uniqSortedIndexes(draggingGroupItems.itemIndexes),
    };
  }
  if (draggingAssetIds?.length) {
    return { kind: 'root', assetIds: [...new Set(draggingAssetIds)] };
  }
  return null;
}

/** 大纲等仅写入 DataTransfer、无 React 拖拽 state 时使用 */
export function parseAcWorkflowExportDragSources(dataTransfer: DataTransfer | null | undefined): WorkflowDragSource[] {
  if (!dataTransfer) return [];
  let raw: string;
  try {
    raw = dataTransfer.getData(DT_AC_WORKFLOW_EXPORT);
  } catch {
    return [];
  }
  if (!raw?.trim()) return [];
  let payload: AcWorkflowExportPayload;
  try {
    payload = JSON.parse(raw) as AcWorkflowExportPayload;
  } catch {
    return [];
  }
  if (payload.mode === 'roots' && Array.isArray(payload.assetIds) && payload.assetIds.length > 0) {
    return [{ kind: 'root', assetIds: [...new Set(payload.assetIds)] }];
  }
  if (payload.mode === 'groupItems' && Array.isArray(payload.items) && payload.items.length > 0) {
    const byParent = new Map<string, number[]>();
    for (const it of payload.items) {
      if (!it?.parentId || typeof it.index !== 'number' || it.index < 0) continue;
      const arr = byParent.get(it.parentId) ?? [];
      arr.push(it.index);
      byParent.set(it.parentId, arr);
    }
    const out: WorkflowDragSource[] = [];
    for (const [groupAssetId, idxs] of byParent) {
      const itemIndexes = uniqSortedIndexes(idxs);
      if (itemIndexes.length > 0) out.push({ kind: 'group', groupAssetId, itemIndexes });
    }
    return out;
  }
  return [];
}

/**
 * 能力区 / 预设格 Drop：优先使用 React 拖拽 state（网格拖起时与 DataTransfer 并存，避免重复入队）；
 * 若无 state 则解析大纲等的 `application/x-ac-workflow-export`。
 */
export function resolveCapabilityDropDragSources(
  draggingAssetIds: string[] | null | undefined,
  draggingGroupItems: { groupAssetId: string; itemIndexes: number[] } | null | undefined,
  dataTransfer: DataTransfer | null | undefined
): WorkflowDragSource[] {
  const fromState = parseWorkflowDragSource(draggingAssetIds, draggingGroupItems);
  if (fromState) return [fromState];
  return parseAcWorkflowExportDragSources(dataTransfer ?? null);
}

/** 侧栏复制/删除/归档等：与进行中视图、归档视图的组合条件 */
export function workflowDragSourceAllowsSidebarOps(
  source: WorkflowDragSource | null,
  showArchived: boolean
): boolean {
  if (!source || showArchived) return false;
  return true;
}

/** Planner、后续「单资产」入口：根取首张；组内取首个 `{ assetId }` 槽，否则无有效 id */
export function computeWorkflowEffectiveSelection(
  selectedAssetIds: Set<string>,
  selectedGroupItemKeys: Set<string>,
  currentGroupAsset: WorkflowAsset | null
): WorkflowEffectiveSelection {
  if (selectedAssetIds.size > 0) {
    const selectedRootIds = [...selectedAssetIds];
    return {
      kind: 'root',
      primaryAssetId: selectedRootIds[0]!,
      selectedRootIds,
    };
  }
  if (!currentGroupAsset || selectedGroupItemKeys.size === 0) return { kind: 'none' };
  const selectedGroupKeys = [...selectedGroupItemKeys];
  const firstKey = selectedGroupKeys[0]!;
  const idxRaw = String(firstKey).split('::').pop();
  const idx = idxRaw !== undefined ? Number(idxRaw) : NaN;
  let primaryChildAssetId: string | null = null;
  let primarySlotIndex: number | null = null;
  if (!Number.isNaN(idx) && idx >= 0) {
    primarySlotIndex = idx;
    const item = currentGroupAsset.cutImageGroup?.[idx];
    if (item && typeof item === 'object' && 'assetId' in item) {
      primaryChildAssetId = (item as { assetId: string }).assetId;
    }
  }
  return {
    kind: 'group',
    groupAssetId: currentGroupAsset.id,
    selectedGroupKeys,
    primaryChildAssetId,
    primarySlotIndex,
  };
}

export function plannerTargetAssetIdFromEffectiveSelection(sel: WorkflowEffectiveSelection): string | null {
  if (sel.kind === 'root') return sel.primaryAssetId;
  if (sel.kind === 'group') return sel.primaryChildAssetId;
  return null;
}
