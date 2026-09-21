import React, { type Dispatch, type DragEvent, type RefObject, type SetStateAction } from 'react';
import { getRandomGroupCodeName } from '../../data/groupCodeNames';
import { isGroupAsset } from '../../services/groupHelpers';
import {
  duplicateStoryboardTableOnAsset,
  isWorkflowStoryboardTableAsset,
} from '../../services/storyboardTableAsset';
import { attachInitialVgpToNewAsset } from '../../services/vgp/vgpStore';
import {
  DT_AC_CAPABILITY_ACTION,
  DT_AC_CAPABILITY_FROM_EDITOR,
  DT_AC_WORKFLOW_EXPORT,
  resolveCapabilityDropDragSources,
  type WorkflowDragSource,
} from '../../services/workflowDragPipeline';
import { markWorkflowDropTarget, workflowDropDragLeave } from '../../services/workflowDropHighlight';
import type { WorkflowAsset } from '../../types';
import { uuid } from './workflowIds';
import { WORKBENCH_PRIMARY_BTN_INLINE, WORKFLOW_EDGE_GUTTER } from './workflowSectionUiConstants';

const SLOT_BASE =
  'box-border rounded-md h-9 w-14 shrink-0 px-1 inline-flex cursor-default items-center justify-center gap-0.5 border border-dashed border-white/[0.16] bg-transparent text-center transition-[box-shadow,background-color,border-color]';
const SLOT = `${SLOT_BASE} [&[data-drag-over='1']]:border-solid [&[data-drag-over='1']]:border-transparent [&[data-drag-over='1']]:ring-2 [&[data-drag-over='1']]:ring-inset [&[data-drag-over='1']]:ring-white/40 [&[data-drag-over='1']]:bg-white/[0.1]`;
const SLOT_DELETE = `${SLOT_BASE} border-red-400/25 [&[data-drag-over='1']]:border-solid [&[data-drag-over='1']]:border-transparent [&[data-drag-over='1']]:ring-2 [&[data-drag-over='1']]:ring-inset [&[data-drag-over='1']]:ring-red-500 [&[data-drag-over='1']]:bg-[#3a1818]`;
const SLOT_LABEL = 'text-[8px] font-black uppercase leading-none whitespace-nowrap text-[#8b8b93]';

function slotDragOver(e: DragEvent<HTMLElement>): void {
  e.preventDefault();
  markWorkflowDropTarget(e.currentTarget);
}

function slotDragLeave(e: DragEvent<HTMLElement>): void {
  workflowDropDragLeave(e.currentTarget, e);
}

function hasAssetDrag(
  draggingAssetIdsRef: RefObject<string[] | null>,
  draggingGroupItemsRef: RefObject<{ groupAssetId: string; itemIndexes: number[] } | null>,
): boolean {
  return Boolean(draggingAssetIdsRef.current?.length || draggingGroupItemsRef.current?.itemIndexes?.length);
}

function hasAssetDragFromEvent(
  e: DragEvent<HTMLElement>,
  draggingAssetIdsRef: RefObject<string[] | null>,
  draggingGroupItemsRef: RefObject<{ groupAssetId: string; itemIndexes: number[] } | null>,
): boolean {
  if (hasAssetDrag(draggingAssetIdsRef, draggingGroupItemsRef)) return true;
  try {
    const types = Array.from(e.dataTransfer?.types || []);
    if (types.includes(DT_AC_CAPABILITY_ACTION) || types.includes(DT_AC_CAPABILITY_FROM_EDITOR)) return false;
    return types.includes(DT_AC_WORKFLOW_EXPORT) || types.includes('text/plain');
  } catch {
    return false;
  }
}

function dropSources(
  e: DragEvent<HTMLElement>,
  draggingAssetIdsRef: RefObject<string[] | null>,
  draggingGroupItemsRef: RefObject<{ groupAssetId: string; itemIndexes: number[] } | null>,
) {
  return resolveCapabilityDropDragSources(draggingAssetIdsRef.current, draggingGroupItemsRef.current, e.dataTransfer);
}

export type WorkflowAssetActionStripProps = {
  draggingAssetIdsRef: RefObject<string[] | null>;
  draggingGroupItemsRef: RefObject<{ groupAssetId: string; itemIndexes: number[] } | null>;
  clearWorkflowDragSession: () => void;
  createGroupFromAssets: (ids: string[]) => void;
  createNestedGroupFromGroupItem: (groupAssetId: string, itemIndex: number) => void;
  ensureGroupItemsAsAssets: (
    prev: WorkflowAsset[],
    groupAssetId: string,
    itemIndexes: number[],
  ) => { nextAssets: WorkflowAsset[]; assetIds: string[] };
  assets: WorkflowAsset[];
  getAssetDisplayImage: (a: WorkflowAsset, assetsList?: WorkflowAsset[]) => string;
  setAssets: Dispatch<SetStateAction<WorkflowAsset[]>>;
  selectedGroupItemKeys: Set<string>;
  setSelectedGroupItemKeys: Dispatch<SetStateAction<Set<string>>>;
  moveGroupItemsToUpperLevel: (groupAssetId: string, itemIndexes: number[]) => void;
  moveRootAssetsToUpperLevel?: (assetIds: string[]) => void;
  canMoveRootToUpperLevel?: boolean;
  sidebarOpsAllowed: boolean;
  groupAssetForDrag: WorkflowAsset | null;
  currentGroupAsset: WorkflowAsset | null;
  duplicateAssetInPlace: (sourceIds: string[], parentGroupId: string | null) => void;
  removeAsset: (assetId: string) => void;
  removeGroupItems: (prev: WorkflowAsset[], groupAssetId: string, itemIndexes: number[]) => WorkflowAsset[];
  setGroupFilterId: Dispatch<SetStateAction<string | null>>;
  onDownloadWorkflowAssets: (sources: WorkflowDragSource[]) => void;
  onDownloadSelectedWorkflowAssets: () => void;
  onExecutePending: () => void;
  onClearPending?: () => void;
  pendingCount: number;
  executing: boolean;
  executingDoneCount: number;
  executingTotal: number;
  /** false 时不加左右 gutter（嵌在导航条内） */
  padded?: boolean;
  /** execute=仅一键执行；ops=仅组操作；all=两者 */
  segment?: 'all' | 'execute' | 'ops';
};

export function WorkflowAssetActionStrip(props: WorkflowAssetActionStripProps): React.ReactElement {
  const {
    draggingAssetIdsRef,
    draggingGroupItemsRef,
    clearWorkflowDragSession,
    createGroupFromAssets,
    createNestedGroupFromGroupItem,
    ensureGroupItemsAsAssets,
    assets,
    getAssetDisplayImage,
    setAssets,
    selectedGroupItemKeys,
    setSelectedGroupItemKeys,
    moveGroupItemsToUpperLevel,
    moveRootAssetsToUpperLevel,
    canMoveRootToUpperLevel = false,
    sidebarOpsAllowed,
    groupAssetForDrag,
    currentGroupAsset,
    duplicateAssetInPlace,
    removeAsset,
    removeGroupItems,
    setGroupFilterId,
    onDownloadWorkflowAssets,
    onDownloadSelectedWorkflowAssets,
    onExecutePending,
    onClearPending,
    pendingCount,
    executing,
    executingDoneCount,
    executingTotal,
    padded = true,
    segment = 'all',
  } = props;
  const showClear = pendingCount > 0 && !executing && onClearPending;
  const showExecute = segment !== 'ops';
  const showOps = segment !== 'execute';

  return (
    <div
      data-workflow-asset-action-strip={segment}
      className={`flex min-w-0 shrink-0 items-center justify-end gap-1 ${segment === 'ops' ? '' : 'w-full'} ${padded ? `${WORKFLOW_EDGE_GUTTER} py-0.5` : ''}`}
    >
      {showExecute ? (
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => onExecutePending()}
          disabled={pendingCount === 0 || executing}
          title={
            executing
              ? `执行中 ${executingDoneCount}/${executingTotal}`
              : pendingCount > 0
                ? `执行待处理队列（${pendingCount}）`
                : '没有待处理任务'
          }
          className={`${WORKBENCH_PRIMARY_BTN_INLINE} ${showClear ? 'pr-8' : ''}`}
        >
          {executing ? `执行中 ${executingDoneCount}/${executingTotal}` : `一键执行（${pendingCount}）`}
        </button>
        {showClear ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClearPending();
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[8px] font-medium text-[#0a0a0c]/50 hover:text-[#0a0a0c]"
          >
            清空
          </button>
        ) : null}
      </div>
      ) : null}
      {showOps ? (
      <div
        data-workflow-asset-drop-rail
        className="ml-1 flex shrink-0 items-center gap-1 border-l border-white/[0.08] pl-2"
      >
        <div
          aria-dropeffect="execute"
          onDragOver={slotDragOver}
          onDragLeave={slotDragLeave}
          onDrop={(e) => {
            e.preventDefault();
            const rootIds = draggingAssetIdsRef.current;
            const groupDrag = draggingGroupItemsRef.current;
            if (currentGroupAsset && selectedGroupItemKeys.size > 0) {
              const indexes = [...selectedGroupItemKeys]
                .map((key) => {
                  const parts = String(key).split('::');
                  if (parts.length !== 2 || parts[0] !== currentGroupAsset.id) return null;
                  const idx = Number(parts[1]);
                  return Number.isNaN(idx) ? null : idx;
                })
                .filter((idx): idx is number => idx !== null);
              if (indexes.length >= 2) {
                if (indexes.length === 2) {
                  createNestedGroupFromGroupItem(currentGroupAsset.id, indexes[0]);
                } else {
                  setAssets((prev) => {
                    const group = prev.find((a) => a.id === currentGroupAsset.id);
                    if (!group || !isGroupAsset(group)) return prev;

                    const assetIds = indexes.map((idx) => group.assetIds?.[idx]).filter((id): id is string => !!id);

                    if (assetIds.length < 2) return prev;

                    const firstAsset = prev.find((a) => a.id === assetIds[0]);
                    const coverImage = firstAsset ? getAssetDisplayImage(firstAsset, prev) : '';
                    const newGroupId = uuid();
                    const usedLabels = new Set<string>(prev.map((a) => a.groupLabel).filter((x): x is string => !!x));

                    const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
                      id: newGroupId,
                      isGroup: true,
                      original: coverImage,
                      displayKey: 'original',
                      results: {},
                      resultOrder: [],
                      assetIds,
                      groupId: currentGroupAsset.id,
                      groupLabel: getRandomGroupCodeName(usedLabels),
                      archived: false,
                      hiddenInGrid: false,
                      createdAt: Date.now(),
                    });

                    let updated = prev.map((a) => {
                      if (assetIds.includes(a.id)) {
                        return { ...a, groupId: newGroupId };
                      }
                      return a;
                    });

                    const parentAssetIds = [...(group.assetIds ?? [])];
                    indexes.sort((a, b) => b - a);
                    for (const idx of indexes) {
                      parentAssetIds.splice(idx, 1);
                    }
                    const insertIdx = indexes[indexes.length - 1];
                    parentAssetIds.splice(insertIdx, 0, newGroupId);

                    updated = updated.map((a) => {
                      if (a.id === currentGroupAsset.id) {
                        return { ...a, assetIds: parentAssetIds };
                      }
                      return a;
                    });

                    return [...updated, newGroup];
                  });
                }
                setSelectedGroupItemKeys(new Set());
              }
            } else if (rootIds?.length) {
              createGroupFromAssets(rootIds);
            } else if (groupDrag) {
              const { itemIndexes, groupAssetId } = groupDrag;
              if (itemIndexes.length === 1) {
                createNestedGroupFromGroupItem(groupAssetId, itemIndexes[0]);
              } else if (itemIndexes.length > 1) {
                const { nextAssets, assetIds } = ensureGroupItemsAsAssets(assets, groupAssetId, itemIndexes);
                if (assetIds.length > 0) {
                  const firstAsset = nextAssets.find((a) => a.id === assetIds[0]);
                  const coverImage = firstAsset ? getAssetDisplayImage(firstAsset, nextAssets) : '';
                  const newGroupId = uuid();
                  let updated = nextAssets.map((a) => (assetIds.includes(a.id) ? { ...a, groupId: newGroupId } : a));
                  const parentGroupIdx = updated.findIndex((a) => a.id === groupAssetId);
                  if (parentGroupIdx !== -1) {
                    const g = updated[parentGroupIdx];
                    const existingIds = g.assetIds ?? [];
                    const sorted = [...itemIndexes].filter((i) => i >= 0 && i < existingIds.length).sort((a, b) => a - b);
                    const keep: string[] = [];
                    existingIds.forEach((id, idx) => {
                      if (!sorted.includes(idx)) keep.push(id);
                    });
                    const insertPos = sorted.length ? sorted[0] : keep.length;
                    keep.splice(insertPos, 0, newGroupId);
                    updated = updated.map((a, idx) => (idx === parentGroupIdx ? { ...a, assetIds: keep } : a));
                  }
                  const usedLabels = new Set<string>(updated.map((a) => a.groupLabel).filter((x): x is string => !!x));
                  const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
                    id: newGroupId,
                    isGroup: true,
                    original: coverImage,
                    displayKey: 'original',
                    results: {},
                    resultOrder: [],
                    assetIds,
                    groupId: groupAssetId,
                    groupLabel: getRandomGroupCodeName(usedLabels),
                    archived: false,
                    hiddenInGrid: false,
                    createdAt: Date.now(),
                  });
                  setAssets([...updated, newGroup]);
                  setSelectedGroupItemKeys(new Set());
                }
              }
            }
            clearWorkflowDragSession();
          }}
          title="将选中图片拖入建组（组内同效）"
          className={SLOT}
        >
          <svg viewBox="0 0 20 20" className="h-3 w-3 text-[#8b8b93]" aria-hidden>
            <path d="M3 4h6v5H3zM11 4h6v5h-6zM3 11h6v5H3zM11 11h6v5h-6z" fill="currentColor" />
          </svg>
          <span className={SLOT_LABEL}>组</span>
        </div>
        <div
          aria-dropeffect="execute"
          onDragOver={(e) => {
            const groupDrag = draggingGroupItemsRef.current;
            const rootIds = draggingAssetIdsRef.current;
            if (
              !groupDrag &&
              !(canMoveRootToUpperLevel && (rootIds?.length || hasAssetDragFromEvent(e, draggingAssetIdsRef, draggingGroupItemsRef)))
            ) {
              return;
            }
            slotDragOver(e);
          }}
          onDragLeave={slotDragLeave}
          onDrop={(e) => {
            e.preventDefault();
            const sources = dropSources(e, draggingAssetIdsRef, draggingGroupItemsRef);
            const groupSrc = sources.find((s) => s.kind === 'group');
            const rootSrc = sources.find((s) => s.kind === 'root');
            if (groupSrc && groupSrc.kind === 'group') {
              moveGroupItemsToUpperLevel(groupSrc.groupAssetId, groupSrc.itemIndexes);
            } else if (canMoveRootToUpperLevel && rootSrc && rootSrc.kind === 'root') {
              moveRootAssetsToUpperLevel?.(rootSrc.assetIds);
            }
            clearWorkflowDragSession();
          }}
          title="将组内子卡片拖到此处，移到上一级"
          className={SLOT}
        >
          <svg viewBox="0 0 20 20" className="h-3 w-3 text-[#8b8b93]" aria-hidden>
            <path d="M7 5h10v10H7zM3 9l4-4v3h5v2H7v3z" fill="currentColor" />
          </svg>
          <span className={SLOT_LABEL}>移出组</span>
        </div>
        <div
          aria-dropeffect="execute"
          onDragOver={(e) => {
            if (!hasAssetDragFromEvent(e, draggingAssetIdsRef, draggingGroupItemsRef)) return;
            slotDragOver(e);
          }}
          onDragLeave={slotDragLeave}
          onDrop={(e) => {
            e.preventDefault();
            const sources = dropSources(e, draggingAssetIdsRef, draggingGroupItemsRef);
            for (const src of sources) {
              if (src.kind === 'root') {
                duplicateAssetInPlace(src.assetIds, null);
                continue;
              }
              const groupDrag = src;
              if (!groupAssetForDrag || !currentGroupAsset) continue;
              const groupId = currentGroupAsset.id;
              setAssets((prev) => {
                const { nextAssets, assetIds } = ensureGroupItemsAsAssets(prev, groupDrag.groupAssetId, groupDrag.itemIndexes);
                if (assetIds.length === 0) return prev;
                const copies: WorkflowAsset[] = [];
                const newIds: string[] = [];
                assetIds.forEach((id) => {
                  const found = nextAssets.find((a) => a.id === id);
                  if (!found) return;
                  const newId = uuid();
                  newIds.push(newId);
                  copies.push(
                    isWorkflowStoryboardTableAsset(found)
                      ? duplicateStoryboardTableOnAsset(found, newId)
                      : {
                          ...found,
                          id: newId,
                          parentAssetId: groupId,
                          archived: false,
                          hiddenInGrid: false,
                          createdAt: Date.now(),
                        },
                  );
                });
                if (copies.length === 0) return nextAssets;
                let next = [...nextAssets, ...copies];
                const gi = next.findIndex((a) => a.id === groupId);
                if (gi !== -1) {
                  const g = next[gi];
                  const items = [...(g.assetIds ?? []), ...newIds];
                  next = next.map((a, i) => (i === gi ? { ...a, assetIds: items } : a));
                }
                return next;
              });
              setSelectedGroupItemKeys(new Set());
            }
            clearWorkflowDragSession();
          }}
          title="拖入后在当前位置复制一份"
          className={SLOT}
        >
          <svg viewBox="0 0 20 20" className="h-3 w-3 text-[#8b8b93]" aria-hidden>
            <path d="M6 6h9v10H6zM4 4h9v1H5v9H4z" fill="currentColor" />
          </svg>
          <span className={SLOT_LABEL}>复制</span>
        </div>
        <div
          aria-dropeffect="execute"
          onDragOver={(e) => {
            if (!hasAssetDragFromEvent(e, draggingAssetIdsRef, draggingGroupItemsRef)) return;
            slotDragOver(e);
          }}
          onDragLeave={slotDragLeave}
          onDrop={(e) => {
            e.preventDefault();
            const sources = dropSources(e, draggingAssetIdsRef, draggingGroupItemsRef);
            for (const src of sources) {
              if (src.kind === 'root') {
                src.assetIds.forEach((id) => removeAsset(id));
                continue;
              }
              const { nextAssets, assetIds } = ensureGroupItemsAsAssets(assets, src.groupAssetId, src.itemIndexes);
              if (assetIds.length > 0) {
                const afterRemove = removeGroupItems(nextAssets, src.groupAssetId, src.itemIndexes);
                const groupRemoved = !afterRemove.some((a) => a.id === src.groupAssetId);
                setAssets(afterRemove);
                assetIds.forEach((id) => removeAsset(id));
                setSelectedGroupItemKeys(new Set());
                if (groupRemoved) {
                  setGroupFilterId(null);
                }
              }
            }
            clearWorkflowDragSession();
          }}
          title="将图片拖到此处从工作流中删除（组内同效）"
          className={SLOT_DELETE}
        >
          <svg viewBox="0 0 20 20" className="h-3 w-3 text-red-400/80" aria-hidden>
            <path d="M6 6h8l-.6 10H6.6L6 6zm2-2h4l1 1h3v2H4V5h3l1-1z" fill="currentColor" />
          </svg>
          <span className={`${SLOT_LABEL} text-red-400/80`}>删除</span>
        </div>
        <div
          role="button"
          aria-dropeffect="execute"
          tabIndex={sidebarOpsAllowed ? 0 : -1}
          onClick={() => {
            if (!sidebarOpsAllowed) return;
            onDownloadSelectedWorkflowAssets();
          }}
          onKeyDown={(e) => {
            if (!sidebarOpsAllowed) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onDownloadSelectedWorkflowAssets();
            }
          }}
          onDragOver={(e) => {
            if (!hasAssetDragFromEvent(e, draggingAssetIdsRef, draggingGroupItemsRef)) return;
            slotDragOver(e);
          }}
          onDragLeave={slotDragLeave}
          onDrop={(e) => {
            e.preventDefault();
            const sources = dropSources(e, draggingAssetIdsRef, draggingGroupItemsRef);
            if (sources.length) onDownloadWorkflowAssets(sources);
            clearWorkflowDragSession();
          }}
          title="点击或拖入：下载选中资产当前展示内容（文字/图片/3D 等）"
          className={[SLOT, sidebarOpsAllowed ? 'cursor-pointer' : ''].join(' ')}
        >
          <svg viewBox="0 0 20 20" className="h-3 w-3 text-[#8b8b93]" aria-hidden>
            <path
              d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5M4 14v2h12v-2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className={SLOT_LABEL}>下载</span>
        </div>
      </div>
      ) : null}
    </div>
  );
}
