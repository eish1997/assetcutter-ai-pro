import React, {
  type Dispatch,
  type DragEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import { getRandomGroupCodeName } from '../../data/groupCodeNames';
import { attachInitialVgpToNewAsset } from '../../services/vgp/vgpStore';
import type { CustomAppModule, CapabilitySet, WorkflowAsset } from '../../types';
import { WorkflowPlannerBar } from '../WorkflowPlannerBar';
import { dragTransferHasPlainText } from './workflowSectionHelpers';
import { SET_ACTION_PREFIX } from './workflowSectionUiConstants';
import { uuid } from './workflowIds';
import type { CapabilityCategoryGroup } from './workflowCapabilityGroups';

export type WorkflowSidebarFavoriteEntry =
  | { id: string; label: string; kind: 'module'; mod: CustomAppModule }
  | { id: string; label: string; kind: 'set'; set: CapabilitySet };

export type WorkflowSidebarColumnProps = {
  wide?: boolean;
  variant?: 'dock' | 'splitLeft';
  actionModules: CustomAppModule[];
  capabilitySets: CapabilitySet[];
  plannerTargetAssetId: string | null;
  onPlannerAddToQueue: (presetId: string) => void;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
  dragOverAction: string | null;
  setDragOverAction: Dispatch<SetStateAction<string | null>>;
  draggingAssetIds: string[] | null;
  setDraggingAssetIds: Dispatch<SetStateAction<string[] | null>>;
  draggingGroupItems: { groupAssetId: string; itemIndexes: number[] } | null;
  setDraggingGroupItems: Dispatch<SetStateAction<{ groupAssetId: string; itemIndexes: number[] } | null>>;
  createGroupFromAssets: (ids: string[]) => void;
  createNestedGroupFromGroupItem: (groupAssetId: string, itemIndex: number) => void;
  ensureGroupItemsAsAssets: (
    prev: WorkflowAsset[],
    groupAssetId: string,
    itemIndexes: number[]
  ) => { nextAssets: WorkflowAsset[]; assetIds: string[] };
  assets: WorkflowAsset[];
  getAssetDisplayImage: (a: WorkflowAsset, assetsList?: WorkflowAsset[]) => string;
  setAssets: Dispatch<SetStateAction<WorkflowAsset[]>>;
  setSelectedGroupItemKeys: Dispatch<SetStateAction<Set<string>>>;
  viewStackLength: number;
  moveGroupItemsToUpperLevel: (groupAssetId: string, itemIndexes: number[]) => void;
  sidebarOpsAllowed: boolean;
  groupAssetForDrag: WorkflowAsset | null;
  currentGroupAsset: WorkflowAsset | null;
  duplicateAssetInPlace: (sourceIds: string[], parentGroupId: string | null) => void;
  removeAsset: (assetId: string) => void;
  removeGroupItems: (prev: WorkflowAsset[], groupAssetId: string, itemIndexes: number[]) => WorkflowAsset[];
  setViewStack: Dispatch<SetStateAction<{ assetId: string }[]>>;
  markArchived: (assetId: string) => void;
  visiblePresets: CustomAppModule[];
  visibleCapabilitySets: CapabilitySet[];
  visibleByCategory: CapabilityCategoryGroup[];
  favoriteEntries: WorkflowSidebarFavoriteEntry[];
  draggingActionIdRef: RefObject<string | null>;
  favoriteDropActive: boolean;
  setFavoriteDropActive: Dispatch<SetStateAction<boolean>>;
  setFavoriteActionIds: Dispatch<SetStateAction<string[]>>;
  collapsedSectionIds: Record<string, boolean>;
  toggleSectionCollapsed: (sectionId: string) => void;
  updateDraggingActionId: (id: string | null) => void;
  draggingActionFromFavorite: boolean;
  actionDroppedInFavorite: boolean;
  setDraggingActionFromFavorite: Dispatch<SetStateAction<boolean>>;
  setActionDroppedInFavorite: Dispatch<SetStateAction<boolean>>;
  removeActionFromFavorite: (actionId: string) => void;
  setHoverPreview: Dispatch<SetStateAction<{ mod: CustomAppModule; x: number; y: number } | null>>;
  handleDropToModuleAction: (mod: CustomAppModule, tweakPrompt: boolean, dropEvent?: DragEvent<HTMLElement>) => void;
  handleDropToSetAction: (setActionId: string, e: DragEvent<HTMLElement>) => void;
  jumpToCapabilityPreset: (preset: CustomAppModule) => void;
};

export function WorkflowSidebarColumn({
  wide,
  variant = 'dock',
  actionModules,
  capabilitySets,
  plannerTargetAssetId,
  onPlannerAddToQueue,
  onLog,
  dragOverAction,
  setDragOverAction,
  draggingAssetIds,
  setDraggingAssetIds,
  draggingGroupItems,
  setDraggingGroupItems,
  createGroupFromAssets,
  createNestedGroupFromGroupItem,
  ensureGroupItemsAsAssets,
  assets,
  getAssetDisplayImage,
  setAssets,
  setSelectedGroupItemKeys,
  viewStackLength,
  moveGroupItemsToUpperLevel,
  sidebarOpsAllowed,
  groupAssetForDrag,
  currentGroupAsset,
  duplicateAssetInPlace,
  removeAsset,
  removeGroupItems,
  setViewStack,
  markArchived,
  visiblePresets,
  visibleCapabilitySets,
  visibleByCategory,
  favoriteEntries,
  draggingActionIdRef,
  favoriteDropActive,
  setFavoriteDropActive,
  setFavoriteActionIds,
  collapsedSectionIds,
  toggleSectionCollapsed,
  updateDraggingActionId,
  draggingActionFromFavorite,
  actionDroppedInFavorite,
  setDraggingActionFromFavorite,
  setActionDroppedInFavorite,
  removeActionFromFavorite,
  setHoverPreview,
  handleDropToModuleAction,
  handleDropToSetAction,
  jumpToCapabilityPreset,
}: WorkflowSidebarColumnProps) {
  return (
    <div
      data-workflow-sidebar
      className={
        variant === 'splitLeft'
          ? 'w-full min-h-0 flex-1 flex flex-col gap-3 overflow-y-auto no-scrollbar'
          : wide
            ? 'w-full min-h-0 flex flex-col gap-3 overflow-y-auto no-scrollbar shrink-0 max-h-[min(52vh,520px)]'
            : 'w-80 shrink-0 min-h-0 flex-1 flex flex-col gap-3 overflow-y-auto no-scrollbar'
      }
    >
          <WorkflowPlannerBar
            actionModules={actionModules}
            selectedAssetId={plannerTargetAssetId}
            onAddToQueue={onPlannerAddToQueue}
            onLog={onLog}
          />

          <div className="grid grid-cols-5 gap-2">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverAction('__group__');
            }}
            onDragLeave={() => {
              if (dragOverAction === '__group__') setDragOverAction(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (draggingAssetIds?.length) {
                createGroupFromAssets(draggingAssetIds);
              } else if (draggingGroupItems) {
                const { itemIndexes, groupAssetId } = draggingGroupItems;
                if (itemIndexes.length === 1) {
                  createNestedGroupFromGroupItem(groupAssetId, itemIndexes[0]);
                } else if (itemIndexes.length > 1) {
                  const { nextAssets, assetIds } = ensureGroupItemsAsAssets(assets, groupAssetId, itemIndexes);
                  if (assetIds.length > 0) {
                    const firstAsset = nextAssets.find((a) => a.id === assetIds[0]);
                    const coverImage = firstAsset ? getAssetDisplayImage(firstAsset, nextAssets) : '';
                    const newGroupId = uuid();
                    let updated = nextAssets.map((a) =>
                      assetIds.includes(a.id) ? { ...a, parentAssetId: newGroupId } : a
                    );
                    const groupIdx = updated.findIndex((a) => a.id === groupAssetId);
                    if (groupIdx !== -1) {
                      const g = updated[groupIdx];
                      const items = [...(g.cutImageGroup ?? [])];
                      const sorted = [...itemIndexes]
                        .filter((i) => i >= 0 && i < items.length)
                        .sort((a, b) => a - b);
                      const keep: typeof items = [];
                      items.forEach((it, idx) => {
                        if (!sorted.includes(idx)) keep.push(it);
                      });
                      const insertPos = sorted.length ? sorted[0] : keep.length;
                      const withGroup = [...keep];
                      withGroup.splice(insertPos, 0, { assetId: newGroupId });
                      updated = updated.map((a, idx) =>
                        idx === groupIdx ? { ...a, cutImageGroup: withGroup } : a
                      );
                    }
                    const usedLabels = new Set<string>(
                      updated.map((a) => a.groupLabel).filter((x): x is string => !!x)
                    );
                    const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
                      id: newGroupId,
                      original: coverImage,
                      displayKey: 'original',
                      results: {},
                      resultOrder: [],
                      cutImageGroup: assetIds.map((id) => ({ assetId: id })),
                      groupKind: 'manual',
                      groupLabel: getRandomGroupCodeName(usedLabels),
                      archived: false,
                      hiddenInGrid: false,
                      createdAt: Date.now(),
                      parentAssetId: groupAssetId,
                    });
                    setAssets([...updated, newGroup]);
                    setSelectedGroupItemKeys(new Set());
                  }
                }
              }
              setDragOverAction(null);
              setDraggingAssetIds(null);
              setDraggingGroupItems(null);
            }}
            title="将选中图片拖入建组（组内同效）"
            className={`rounded-xl border-2 border-dashed h-[52px] px-1 flex flex-col items-center justify-center text-center transition-colors ${
              dragOverAction === '__group__'
                ? 'border-blue-500 bg-[#152642]'
                : 'border-[#3d4754] bg-[#0e0f12] hover:border-[#4b6a9e] hover:bg-[#1a1d26]'
            }`}
          >
            <svg viewBox="0 0 20 20" className="w-3 h-3 text-gray-400 mb-0.5" aria-hidden>
              <path d="M3 4h6v5H3zM11 4h6v5h-6zM3 11h6v5H3zM11 11h6v5h-6z" fill="currentColor" />
            </svg>
            <span className="text-[8px] font-black uppercase text-gray-200">组</span>
          </div>
          <div
            onDragOver={(e) => {
              if (!viewStackLength || !draggingGroupItems) return;
              e.preventDefault();
              setDragOverAction('__ungroup__');
            }}
            onDragLeave={() => {
              if (dragOverAction === '__ungroup__') setDragOverAction(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragOverAction === '__ungroup__' && draggingGroupItems) {
                const { groupAssetId, itemIndexes } = draggingGroupItems;
                moveGroupItemsToUpperLevel(groupAssetId, itemIndexes);
              }
              setDragOverAction(null);
              setDraggingGroupItems(null);
            }}
            title="将组内子卡片拖到此处，移到上一级"
            className={`rounded-xl border-2 border-dashed h-[52px] px-1 flex flex-col items-center justify-center text-center transition-colors ${
              dragOverAction === '__ungroup__'
                ? 'border-blue-500 bg-[#152642]'
                : 'border-[#3d4754] bg-[#0e0f12] hover:border-[#4b6a9e] hover:bg-[#1a1d26]'
            }`}
          >
            <svg viewBox="0 0 20 20" className="w-3 h-3 text-gray-400 mb-0.5" aria-hidden>
              <path d="M7 5h10v10H7zM3 9l4-4v3h5v2H7v3z" fill="currentColor" />
            </svg>
            <span className="text-[8px] font-black uppercase text-gray-200">移出组</span>
          </div>
          <div
            onDragOver={(e) => {
              if (!sidebarOpsAllowed) return;
              e.preventDefault();
              setDragOverAction('__copy__');
            }}
            onDragLeave={() => {
              if (dragOverAction === '__copy__') setDragOverAction(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragOverAction !== '__copy__') {
                setDragOverAction(null);
                setDraggingAssetIds(null);
                setDraggingGroupItems(null);
                return;
              }
              if (draggingAssetIds?.length) {
                duplicateAssetInPlace(draggingAssetIds, null);
              } else if (draggingGroupItems && groupAssetForDrag && currentGroupAsset) {
                const groupId = currentGroupAsset.id;
                setAssets((prev) => {
                  const { nextAssets, assetIds } = ensureGroupItemsAsAssets(
                    prev,
                    draggingGroupItems.groupAssetId,
                    draggingGroupItems.itemIndexes
                  );
                  if (assetIds.length === 0) return prev;
                  const copies: WorkflowAsset[] = [];
                  const newIds: string[] = [];
                  assetIds.forEach((id) => {
                    const src = nextAssets.find((a) => a.id === id);
                    if (!src) return;
                    const newId = uuid();
                    newIds.push(newId);
                    copies.push({
                      ...src,
                      id: newId,
                      parentAssetId: groupId,
                      archived: false,
                      hiddenInGrid: false,
                      createdAt: Date.now(),
                    });
                  });
                  if (copies.length === 0) return nextAssets;
                  let next = [...nextAssets, ...copies];
                  const gi = next.findIndex((a) => a.id === groupId);
                  if (gi !== -1) {
                    const g = next[gi];
                    const items = [...(g.cutImageGroup ?? []), ...newIds.map((id) => ({ assetId: id }))];
                    next = next.map((a, i) => (i === gi ? { ...a, cutImageGroup: items } : a));
                  }
                  return next;
                });
                setSelectedGroupItemKeys(new Set());
              }
              setDragOverAction(null);
              setDraggingAssetIds(null);
              setDraggingGroupItems(null);
            }}
            title="拖入后在当前位置复制一份"
            className={`rounded-xl border-2 border-dashed h-[52px] px-1 flex flex-col items-center justify-center text-center transition-colors ${
              dragOverAction === '__copy__'
                ? 'border-blue-500 bg-[#152642]'
                : 'border-[#3d4754] bg-[#0e0f12] hover:border-[#4b6a9e] hover:bg-[#1a1d26]'
            }`}
          >
            <svg viewBox="0 0 20 20" className="w-3 h-3 text-gray-400 mb-0.5" aria-hidden>
              <path d="M6 6h9v10H6zM4 4h9v1H5v9H4z" fill="currentColor" />
            </svg>
            <span className="text-[8px] font-black uppercase text-gray-200">复制</span>
          </div>
          <div
            onDragOver={(e) => {
              if (!sidebarOpsAllowed) return;
              e.preventDefault();
              setDragOverAction('__delete__');
            }}
            onDragLeave={() => {
              if (dragOverAction === '__delete__') setDragOverAction(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragOverAction !== '__delete__') {
                setDragOverAction(null);
                setDraggingAssetIds(null);
                setDraggingGroupItems(null);
                return;
              }
              if (draggingAssetIds?.length) {
                draggingAssetIds.forEach((id) => removeAsset(id));
              } else if (draggingGroupItems) {
                const { nextAssets, assetIds } = ensureGroupItemsAsAssets(
                  assets,
                  draggingGroupItems.groupAssetId,
                  draggingGroupItems.itemIndexes
                );
                if (assetIds.length > 0) {
                  const afterRemove = removeGroupItems(
                    nextAssets,
                    draggingGroupItems.groupAssetId,
                    draggingGroupItems.itemIndexes
                  );
                  const groupRemoved = !afterRemove.some((a) => a.id === draggingGroupItems.groupAssetId);
                  setAssets(afterRemove);
                  assetIds.forEach((id) => removeAsset(id));
                  setSelectedGroupItemKeys(new Set());
                  if (groupRemoved) {
                    setViewStack((s) => s.filter((x) => x.assetId !== draggingGroupItems.groupAssetId));
                  }
                }
              }
              setDragOverAction(null);
              setDraggingAssetIds(null);
              setDraggingGroupItems(null);
            }}
            title="将图片拖到此处从工作流中删除（组内同效）"
            className={`rounded-xl border-2 border-dashed h-[52px] px-1 flex flex-col items-center justify-center text-center transition-colors ${
              dragOverAction === '__delete__'
                ? 'border-red-500 bg-[#3a1818]'
                : 'border-[#3d4754] bg-[#0e0f12] hover:border-[#b85454] hover:bg-[#1f1416]'
            }`}
          >
            <svg viewBox="0 0 20 20" className="w-3 h-3 text-red-300 mb-0.5" aria-hidden>
              <path d="M6 6h8l-.6 10H6.6L6 6zm2-2h4l1 1h3v2H4V5h3l1-1z" fill="currentColor" />
            </svg>
            <span className="text-[8px] font-black uppercase text-red-400">删除</span>
          </div>
          <div
            onDragOver={(e) => {
              if (!sidebarOpsAllowed) return;
              e.preventDefault();
              setDragOverAction('__archive__');
            }}
            onDragLeave={() => {
              if (dragOverAction === '__archive__') setDragOverAction(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragOverAction !== '__archive__') {
                setDragOverAction(null);
                setDraggingAssetIds(null);
                setDraggingGroupItems(null);
                return;
              }
              if (draggingAssetIds?.length) {
                draggingAssetIds.forEach((id) => markArchived(id));
              } else if (draggingGroupItems) {
                const { nextAssets, assetIds } = ensureGroupItemsAsAssets(
                  assets,
                  draggingGroupItems.groupAssetId,
                  draggingGroupItems.itemIndexes
                );
                if (assetIds.length > 0) {
                  const afterRemove = removeGroupItems(
                    nextAssets,
                    draggingGroupItems.groupAssetId,
                    draggingGroupItems.itemIndexes
                  );
                  const groupRemoved = !afterRemove.some((a) => a.id === draggingGroupItems.groupAssetId);
                  setAssets(afterRemove);
                  assetIds.forEach((id) => markArchived(id));
                  setSelectedGroupItemKeys(new Set());
                  if (groupRemoved) {
                    setViewStack((s) => s.filter((x) => x.assetId !== draggingGroupItems.groupAssetId));
                  }
                }
              }
              setDragOverAction(null);
              setDraggingAssetIds(null);
              setDraggingGroupItems(null);
            }}
            title="将图片拖到此处标记为已完成（组内同效）"
            className={`rounded-xl border-2 border-dashed h-[52px] px-1 flex flex-col items-center justify-center text-center transition-colors ${
              dragOverAction === '__archive__'
                ? 'border-blue-500 bg-[#152642]'
                : 'border-[#3d4754] bg-[#0e0f12] hover:border-[#4b6a9e] hover:bg-[#1a1d26]'
            }`}
          >
            <svg viewBox="0 0 20 20" className="w-3 h-3 text-gray-400 mb-0.5" aria-hidden>
              <path d="M4 4h12v3H4zM5 8h10v8H5zM8 10h4v2H8z" fill="currentColor" />
            </svg>
            <span className="text-[8px] font-black uppercase text-gray-200">归档</span>
          </div>
          </div>
          {visiblePresets.length === 0 && visibleCapabilitySets.length === 0 && favoriteEntries.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#3a3a40] p-4 text-center text-[9px] text-gray-500">
              暂无能力预设，请先在「能力」界面添加
            </div>
          )}
          {favoriteEntries.length > 0 || visiblePresets.length > 0 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-[#2e2e32] bg-[#16161a] px-2.5 py-1.5">
                  <span className="text-[8px] font-black text-blue-300 uppercase tracking-wide">常用功能</span>
                  <span className="text-[8px] text-gray-500">拖入收藏</span>
                </div>
                <div
                  onDropCapture={() => {
                    if (draggingActionIdRef.current) setActionDroppedInFavorite(true);
                  }}
                  onDragOver={(e) => {
                    if (!draggingActionIdRef.current && !dragTransferHasPlainText(e)) return;
                    e.preventDefault();
                    try {
                      e.dataTransfer.dropEffect = 'copy';
                    } catch {
                      /* ignore */
                    }
                    setFavoriteDropActive(true);
                  }}
                  onDragLeave={(ev) => {
                    const next = ev.relatedTarget as Node | null;
                    if (next && ev.currentTarget.contains(next)) return;
                    setFavoriteDropActive(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setFavoriteDropActive(false);
                    let id = draggingActionIdRef.current;
                    if (!id) {
                      try {
                        id = e.dataTransfer.getData('text/plain') || null;
                      } catch {
                        /* ignore */
                      }
                    }
                    if (!id?.trim()) return;
                    const validFavoriteId =
                      actionModules.some((m) => m.id === id) ||
                      (id.startsWith(SET_ACTION_PREFIX) &&
                        capabilitySets.some((s) => s.id === id.slice(SET_ACTION_PREFIX.length)));
                    if (!validFavoriteId) return;
                    setFavoriteActionIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
                    setActionDroppedInFavorite(true);
                  }}
                  className="space-y-2"
                >
                  {favoriteEntries.length === 0 ? (
                    <div className={`text-[8px] text-center py-2 ${favoriteDropActive ? 'text-blue-300' : 'text-gray-500'}`}>
                      把功能块拖到这里，作为常用功能
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {favoriteEntries.map((entry) => (
                        <div
                          key={`fav-${entry.id}`}
                          data-capability-hover-id={entry.kind === 'module' ? entry.mod?.id : undefined}
                          className={`rounded-xl border-2 border-dashed min-h-[60px] flex transition-colors ${
                            dragOverAction === entry.id
                              ? 'border-blue-500 bg-[#1a3354]'
                              : dragOverAction === entry.id + '__tweak'
                                ? 'border-[#4b6a9e] bg-[#1e3558] ring-1 ring-[#3b82f6]'
                                : 'border-[#3a3a40] bg-[#1c1c22] hover:border-[#484850]'
                          }`}
                          draggable
                          onMouseEnter={(e) => {
                            if (entry.kind !== 'module' || !entry.mod) return;
                            setHoverPreview({ mod: entry.mod, x: e.clientX, y: e.clientY });
                          }}
                          onMouseMove={(e) => {
                            if (entry.kind !== 'module' || !entry.mod) return;
                            setHoverPreview((prev) =>
                              prev && prev.mod.id === entry.mod!.id
                                ? { ...prev, x: e.clientX, y: e.clientY }
                                : { mod: entry.mod, x: e.clientX, y: e.clientY }
                            );
                          }}
                          onMouseLeave={() => setHoverPreview((prev) => (prev?.mod.id === entry.id ? null : prev))}
                          onDragStart={(e) => {
                            try {
                              e.dataTransfer.setData('text/plain', entry.id);
                              e.dataTransfer.effectAllowed = 'copyMove';
                            } catch {
                              /* ignore */
                            }
                            updateDraggingActionId(entry.id);
                            setDraggingActionFromFavorite(true);
                            setActionDroppedInFavorite(false);
                          }}
                          onDragEnd={() => {
                            if (draggingActionFromFavorite && !actionDroppedInFavorite) {
                              removeActionFromFavorite(entry.id);
                            }
                            updateDraggingActionId(null);
                            setDraggingActionFromFavorite(false);
                            setActionDroppedInFavorite(false);
                            setFavoriteDropActive(false);
                          }}
                        >
                          <div
                            className={`flex-1 p-3 flex flex-col items-center justify-center text-center min-w-0 transition-colors ${
                              entry.kind === 'module' && entry.mod?.category === 'image_gen' ? 'border-r border-[#2e2e32]' : ''
                            } ${
                              dragOverAction === entry.id + '__tweak'
                                ? 'bg-[#121214]'
                                : dragOverAction === entry.id
                                  ? 'bg-[#1a3354]'
                                  : ''
                            }`}
                            onDragOver={(e) => {
                              e.preventDefault();
                              setDragOverAction(entry.id);
                            }}
                            onDragLeave={() => setDragOverAction(null)}
                            onMouseEnter={(e) => {
                              if (entry.kind !== 'module' || !entry.mod) return;
                              setHoverPreview({ mod: entry.mod, x: e.clientX, y: e.clientY });
                            }}
                            onMouseMove={(e) => {
                              if (entry.kind !== 'module' || !entry.mod) return;
                              setHoverPreview((prev) =>
                                prev && prev.mod.id === entry.mod!.id
                                  ? { ...prev, x: e.clientX, y: e.clientY }
                                  : { mod: entry.mod, x: e.clientX, y: e.clientY }
                              );
                            }}
                            onMouseLeave={() => setHoverPreview((prev) => (prev?.mod.id === entry.id ? null : prev))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverAction(null);
              if (entry.kind === 'set') {
                handleDropToSetAction(entry.id, e);
              } else if (entry.mod) {
                handleDropToModuleAction(entry.mod, false, e);
              }
            }}
                          >
                            <span className="text-[9px] font-black uppercase">{entry.label}</span>
                          </div>
                          {entry.kind === 'module' && entry.mod?.category === 'image_gen' && (
                            <div
                              className={`w-11 shrink-0 flex flex-col items-center justify-center rounded-r-lg transition-colors cursor-pointer ${
                                dragOverAction === entry.id + '__tweak'
                                  ? 'bg-[#223d5c] border-l border-[#5080c0]'
                                  : 'bg-[#1c1c22] border-l border-[#2e2e32] hover:bg-[#2e2e36]'
                              }`}
                              title="拖到此处可微调提示词后加入队列；点击前往能力页调整预设"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (entry.kind === 'module' && entry.mod) jumpToCapabilityPreset(entry.mod);
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDragOverAction(entry.id + '__tweak');
                              }}
                              onDragLeave={() => setDragOverAction(null)}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDragOverAction(null);
                                if (entry.mod) handleDropToModuleAction(entry.mod, true, e);
                              }}
                            >
                              <span className="text-[10px] text-blue-400 font-bold" title="微调提示词">词</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
          {visiblePresets.length > 0 && (
            <div className="space-y-4">
              {visibleByCategory.length > 0 ? (
                <>
              {visibleByCategory.map(({ category, list }) => (
                <div key={category.id}>
                  <button
                    type="button"
                    onClick={() => toggleSectionCollapsed(`cat:${category.id}`)}
                    className="w-full text-left mb-1.5 flex items-center justify-between rounded-lg border border-[#2e2e32] bg-[#121214] px-2.5 py-1.5 text-[8px] font-black uppercase tracking-wide text-gray-400 hover:bg-[#18181c] hover:text-gray-200 transition-colors"
                  >
                    <span>{category.label}</span>
                    <span className="text-[10px] text-gray-500">{collapsedSectionIds[`cat:${category.id}`] ? '▼' : '▲'}</span>
                  </button>
                  {!collapsedSectionIds[`cat:${category.id}`] && (
                  <div className="grid grid-cols-2 gap-2">
                    {list.map((mod) => (
                      <div
                        key={mod.id}
                        data-capability-hover-id={mod.id}
                        className={`rounded-xl border-2 border-dashed min-h-[60px] flex transition-colors ${
                          dragOverAction === mod.id
                            ? 'border-blue-500 bg-[#1a3354]'
                            : dragOverAction === mod.id + '__tweak'
                              ? 'border-[#4b6a9e] bg-[#1e3558] ring-1 ring-[#3b82f6]'
                              : 'border-[#3a3a40] bg-[#1c1c22] hover:border-[#484850]'
                        }`}
                        draggable
                        onMouseEnter={(e) => setHoverPreview({ mod, x: e.clientX, y: e.clientY })}
                        onMouseMove={(e) =>
                          setHoverPreview((prev) =>
                            prev && prev.mod.id === mod.id
                              ? { ...prev, x: e.clientX, y: e.clientY }
                              : { mod, x: e.clientX, y: e.clientY }
                          )
                        }
                        onMouseLeave={() => setHoverPreview((prev) => (prev?.mod.id === mod.id ? null : prev))}
                        onDragStart={(e) => {
                          try {
                            e.dataTransfer.setData('text/plain', mod.id);
                            e.dataTransfer.effectAllowed = 'copyMove';
                          } catch {
                            /* ignore */
                          }
                          updateDraggingActionId(mod.id);
                          setDraggingActionFromFavorite(false);
                          setActionDroppedInFavorite(false);
                        }}
                        onDragEnd={() => {
                          updateDraggingActionId(null);
                          setDraggingActionFromFavorite(false);
                          setActionDroppedInFavorite(false);
                          setFavoriteDropActive(false);
                        }}
                      >
                        <div
                          className={`flex-1 p-3 flex flex-col items-center justify-center text-center min-w-0 transition-colors ${
                            mod.category === 'image_gen' ? 'border-r border-[#2e2e32]' : ''
                          } ${
                            dragOverAction === mod.id + '__tweak'
                              ? 'bg-[#121214]'
                              : dragOverAction === mod.id
                                ? 'bg-[#1a3354]'
                                : ''
                          }`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setDragOverAction(mod.id);
                          }}
                          onDragLeave={() => setDragOverAction(null)}
                          onMouseEnter={(e) => setHoverPreview({ mod, x: e.clientX, y: e.clientY })}
                          onMouseMove={(e) =>
                            setHoverPreview((prev) =>
                              prev && prev.mod.id === mod.id
                                ? { ...prev, x: e.clientX, y: e.clientY }
                                : { mod, x: e.clientX, y: e.clientY }
                            )
                          }
                          onMouseLeave={() => setHoverPreview((prev) => (prev?.mod.id === mod.id ? null : prev))}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragOverAction(null);
                            handleDropToModuleAction(mod, false, e);
                          }}
                        >
                          <span className="text-[9px] font-black uppercase">{mod.label}</span>
                        </div>
                        {mod.category === 'image_gen' && (
                          <div
                            className={`w-11 shrink-0 flex flex-col items-center justify-center rounded-r-lg transition-colors cursor-pointer ${
                              dragOverAction === mod.id + '__tweak'
                                ? 'bg-[#223d5c] border-l border-[#5080c0]'
                                : 'bg-[#1c1c22] border-l border-[#2e2e32] hover:bg-[#2e2e36]'
                            }`}
                            title="拖到此处可微调提示词后加入队列；点击前往能力页调整预设"
                            onClick={(e) => {
                              e.stopPropagation();
                              jumpToCapabilityPreset(mod);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDragOverAction(mod.id + '__tweak');
                            }}
                            onDragLeave={() => setDragOverAction(null)}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDragOverAction(null);
                              handleDropToModuleAction(mod, true, e);
                            }}
                          >
                            <span className="text-[10px] text-blue-400 font-bold" title="微调提示词">词</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  )}
                </div>
              ))}
                </>
              ) : (
            <div>
              <button
                type="button"
                onClick={() => toggleSectionCollapsed('__all_presets__')}
                className="w-full text-left mb-1.5 flex items-center justify-between rounded-lg border border-[#2e2e32] bg-[#121214] px-2.5 py-1.5 text-[8px] font-black uppercase tracking-wide text-gray-400 hover:bg-[#18181c] hover:text-gray-200 transition-colors"
              >
                <span>功能</span>
                <span className="text-[10px] text-gray-500">{collapsedSectionIds.__all_presets__ ? '▼' : '▲'}</span>
              </button>
              {!collapsedSectionIds.__all_presets__ && (
            <div className="grid grid-cols-2 gap-2">
              {visiblePresets.map((mod) => (
                <div
                  key={mod.id}
                  className={`rounded-xl border-2 border-dashed min-h-[60px] flex transition-colors ${
                    dragOverAction === mod.id
                      ? 'border-blue-500 bg-[#1a3354]'
                      : dragOverAction === mod.id + '__tweak'
                        ? 'border-[#4b6a9e] bg-[#1e3558] ring-1 ring-[#3b82f6]'
                        : 'border-[#3a3a40] bg-[#1c1c22] hover:border-[#484850]'
                  }`}
                  draggable
                  onDragStart={(e) => {
                    try {
                      e.dataTransfer.setData('text/plain', mod.id);
                      e.dataTransfer.effectAllowed = 'copyMove';
                    } catch {
                      /* ignore */
                    }
                    updateDraggingActionId(mod.id);
                    setDraggingActionFromFavorite(false);
                    setActionDroppedInFavorite(false);
                  }}
                  onDragEnd={() => {
                    updateDraggingActionId(null);
                    setDraggingActionFromFavorite(false);
                    setActionDroppedInFavorite(false);
                    setFavoriteDropActive(false);
                  }}
                >
                  <div
                    className={`flex-1 p-3 flex flex-col items-center justify-center text-center min-w-0 transition-colors ${
                      mod.category === 'image_gen' ? 'border-r border-[#2e2e32]' : ''
                    } ${
                      dragOverAction === mod.id + '__tweak'
                        ? 'bg-[#121214]'
                        : dragOverAction === mod.id
                          ? 'bg-[#1a3354]'
                          : ''
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverAction(mod.id);
                    }}
                    onDragLeave={() => setDragOverAction(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverAction(null);
                      handleDropToModuleAction(mod, false, e);
                    }}
                  >
                    <span className="text-[9px] font-black uppercase">{mod.label}</span>
                  </div>
                  {mod.category === 'image_gen' && (
                    <div
                      className={`w-11 shrink-0 flex flex-col items-center justify-center rounded-r-lg transition-colors cursor-pointer ${
                        dragOverAction === mod.id + '__tweak'
                          ? 'bg-[#223d5c] border-l border-[#5080c0]'
                          : 'bg-[#1c1c22] border-l border-[#2e2e32] hover:bg-[#2e2e36]'
                      }`}
                      title="拖到此处可微调提示词后加入队列；点击前往能力页调整预设"
                      onClick={(e) => {
                        e.stopPropagation();
                        jumpToCapabilityPreset(mod);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOverAction(mod.id + '__tweak');
                      }}
                      onDragLeave={() => setDragOverAction(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOverAction(null);
                        handleDropToModuleAction(mod, true, e);
                      }}
                    >
                      <span className="text-[10px] text-blue-400 font-bold" title="微调提示词">词</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
              )}
            </div>
              )}
            </div>
          )}
            </div>
          ) : null}

          {visibleCapabilitySets.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => toggleSectionCollapsed('__capability_sets__')}
                className="w-full text-left mb-1.5 flex items-center justify-between rounded-lg border border-[#2e2e32] bg-[#121214] px-2.5 py-1.5 text-[8px] font-black uppercase tracking-wide text-gray-400 hover:bg-[#18181c] hover:text-gray-200 transition-colors"
              >
                <span>复合能力</span>
                <span className="text-[10px] text-gray-500">{collapsedSectionIds.__capability_sets__ ? '▼' : '▲'}</span>
              </button>
              {!collapsedSectionIds.__capability_sets__ && (
              <div className="grid grid-cols-2 gap-2">
                {visibleCapabilitySets.map((set) => {
                  const setActionId = SET_ACTION_PREFIX + set.id;
                  return (
                    <div
                      key={set.id}
                      draggable
                      onDragStart={(e) => {
                        try {
                          e.dataTransfer.setData('text/plain', setActionId);
                          e.dataTransfer.effectAllowed = 'copyMove';
                        } catch {
                          /* ignore */
                        }
                        updateDraggingActionId(setActionId);
                        setDraggingActionFromFavorite(false);
                        setActionDroppedInFavorite(false);
                      }}
                      onDragEnd={() => {
                        updateDraggingActionId(null);
                        setDraggingActionFromFavorite(false);
                        setActionDroppedInFavorite(false);
                        setFavoriteDropActive(false);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverAction(setActionId);
                      }}
                      onDragLeave={() => setDragOverAction(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverAction(null);
                        handleDropToSetAction(setActionId, e);
                      }}
                      className={`rounded-xl border-2 border-dashed p-2.5 min-h-[60px] flex flex-col items-center justify-center text-center transition-colors ${
                        dragOverAction === setActionId
                          ? 'border-blue-500 bg-[#1a3354]'
                          : 'border-[#3a3a40] bg-[#1c1c22] hover:border-[#484850]'
                      }`}
                    >
                      <span className="text-[9px] font-black uppercase text-gray-200">{set.label}</span>
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          )}
    </div>
  );
}
