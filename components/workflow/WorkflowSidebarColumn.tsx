import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import { getRandomGroupCodeName } from '../../data/groupCodeNames';
import { attachInitialVgpToNewAsset } from '../../services/vgp/vgpStore';
import {
  DIALOG_IMAGE_GEARS,
  SUPPORTED_ASPECT_RATIOS,
  SUPPORTED_IMAGE_SIZES,
} from '../../types';
import type { CustomAppModule, CapabilitySet, WorkflowAsset } from '../../types';
import { capabilityUsesGenImageEngine } from '../../services/capabilityExecutor';
import { CustomDropdown } from '../ui/CustomDropdown';
import {
  DT_AC_CAPABILITY_ACTION,
  DT_AC_CAPABILITY_ACTION_SOURCE,
  DT_AC_CAPABILITY_FROM_EDITOR,
} from '../../services/workflowDragPipeline';
import { dragTransferHasPlainText } from './workflowSectionHelpers';
import { SET_ACTION_PREFIX } from './workflowSectionUiConstants';
import { uuid } from './workflowIds';
import type { CapabilityCategoryGroup } from './workflowCapabilityGroups';

const DRAG_SCROLL_EDGE_PX = 64;
const DRAG_SCROLL_MAX_STEP_PX = 24;

function autoScrollContainerOnDrag(
  container: HTMLElement,
  clientY: number,
  edgePx = DRAG_SCROLL_EDGE_PX,
  maxStepPx = DRAG_SCROLL_MAX_STEP_PX
): void {
  if (!Number.isFinite(clientY) || clientY <= 0) return;
  const rect = container.getBoundingClientRect();
  if (!rect.height) return;
  let delta = 0;
  if (clientY < rect.top + edgePx) {
    const ratio = (rect.top + edgePx - clientY) / edgePx;
    delta = -Math.ceil(Math.max(0, Math.min(1, ratio)) * maxStepPx);
  } else if (clientY > rect.bottom - edgePx) {
    const ratio = (clientY - (rect.bottom - edgePx)) / edgePx;
    delta = Math.ceil(Math.max(0, Math.min(1, ratio)) * maxStepPx);
  }
  if (delta !== 0) container.scrollTop += delta;
}

function normalizeWheelDeltaY(e: React.WheelEvent<HTMLElement>): number {
  let dy = e.deltaY;
  if (Math.abs(e.deltaX) > Math.abs(dy)) dy = e.deltaX;
  if (e.deltaMode === 1) dy *= 16;
  if (e.deltaMode === 2) dy *= 120;
  if (!dy && typeof (e as unknown as { wheelDelta?: number }).wheelDelta === 'number') {
    dy = -(e as unknown as { wheelDelta: number }).wheelDelta / 3;
  }
  return dy;
}

function hasAnyTextPayload(asset: WorkflowAsset): boolean {
  if ((asset.textBody || '').trim()) return true;
  const textResults = asset.textResults || {};
  return Object.values(textResults).some((v) => String(v || '').trim() !== '');
}

function hasAnyImagePayload(asset: WorkflowAsset): boolean {
  if (String(asset.original || '').trim()) return true;
  if (asset.displayKey && asset.displayKey !== 'original') {
    const curr = String((asset.results || {})[asset.displayKey] || '').trim();
    if (curr) return true;
  }
  const results = asset.results || {};
  if (Object.values(results).some((v) => String(v || '').trim() !== '')) return true;
  if ((asset.cutImageGroup || []).some((it) => typeof it === 'string' && it.trim() !== '')) return true;
  return false;
}

function moduleSupportsDraggedPayload(
  mod: CustomAppModule,
  payload: { hasText: boolean; hasImage: boolean; hasDrag: boolean }
): boolean {
  if (!payload.hasDrag) return false;
  if (mod.category === 'text_to_text' || mod.category === 'text_to_image') {
    return payload.hasText;
  }
  if (mod.category === 'image_to_image' || mod.category === 'image_to_text' || mod.category === 'generate_3d') {
    return payload.hasImage;
  }
  return false;
}

function tryConsumeCapabilityComposeDrop(
  e: DragEvent<HTMLElement>,
  targetMod: CustomAppModule,
  draggingActionIdRef: RefObject<string | null>,
  onComposeCapabilities: ((sourceId: string, targetId: string) => void) | undefined,
  setDragOverAction: Dispatch<SetStateAction<string | null>>,
  updateDraggingActionId: (id: string | null) => void
): boolean {
  if (!onComposeCapabilities) return false;
  const src = draggingActionIdRef.current;
  if (!src || src.startsWith(SET_ACTION_PREFIX) || src === targetMod.id) return false;
  e.preventDefault();
  e.stopPropagation();
  setDragOverAction(null);
  updateDraggingActionId(null);
  onComposeCapabilities(src, targetMod.id);
  return true;
}

export type WorkflowSidebarFavoriteEntry =
  | { id: string; label: string; kind: 'module'; mod: CustomAppModule }
  | { id: string; label: string; kind: 'set'; set: CapabilitySet };

type SidebarCapabilityColorKey = CustomAppModule['category'] | 'set';

function getSidebarCapabilityTone(key: SidebarCapabilityColorKey): {
  idleBorderClass: string;
  hoverBorderClass: string;
  dividerBorderClass: string;
} {
  switch (key) {
    case 'text_to_text':
      return {
        idleBorderClass: 'border-[#4f5a74]',
        hoverBorderClass: 'hover:border-[#5f6d8c]',
        dividerBorderClass: 'border-[#475169]',
      };
    case 'text_to_image':
      return {
        idleBorderClass: 'border-[#615a42]',
        hoverBorderClass: 'hover:border-[#756c4e]',
        dividerBorderClass: 'border-[#57513b]',
      };
    case 'image_to_image':
      return {
        idleBorderClass: 'border-[#4a6661]',
        hoverBorderClass: 'hover:border-[#5a7c75]',
        dividerBorderClass: 'border-[#425a55]',
      };
    case 'image_to_text':
      return {
        idleBorderClass: 'border-[#665575]',
        hoverBorderClass: 'hover:border-[#7a668d]',
        dividerBorderClass: 'border-[#5b4c67]',
      };
    case 'generate_3d':
      return {
        idleBorderClass: 'border-[#6f5b49]',
        hoverBorderClass: 'hover:border-[#846b55]',
        dividerBorderClass: 'border-[#645340]',
      };
    case 'set':
      return {
        idleBorderClass: 'border-[#55657a]',
        hoverBorderClass: 'hover:border-[#667990]',
        dividerBorderClass: 'border-[#4b5970]',
      };
    default:
      return {
        idleBorderClass: 'border-[#3a3a40]',
        hoverBorderClass: 'hover:border-[#484850]',
        dividerBorderClass: 'border-[#2e2e32]',
      };
  }
}

export type WorkflowSidebarTopActionMode = 'asset' | 'capabilityPreset';
export type WorkflowSidebarPresetDropAction = 'edit' | 'copy' | 'delete';

export type WorkflowSidebarColumnProps = {
  wide?: boolean;
  variant?: 'dock' | 'splitLeft';
  actionModules: CustomAppModule[];
  capabilitySets: CapabilitySet[];
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
  handleDropToModuleAction: (
    mod: CustomAppModule,
    tweakPrompt: boolean,
    dropEvent?: DragEvent<HTMLElement>,
    groupOverrides?: {
      imageGear?: CustomAppModule['imageGear'];
      imageAspectRatio?: string;
      imageSize?: string;
      understand?: boolean;
      generateCount?: number;
    }
  ) => void;
  handleDropToSetAction: (setActionId: string, e: DragEvent<HTMLElement>) => void;
  jumpToCapabilityPreset: (preset: CustomAppModule) => void;
  /** 能力区预设卡片拖入侧栏任意处：启用并入队当前选中资产 */
  onDropPresetFromEditor?: (presetId: string) => void;
  /** 能力页模式下：将预设拖到顶部动作块（编辑/删除等） */
  onDropPresetAction?: (action: WorkflowSidebarPresetDropAction, presetId: string) => void;
  /** 顶部动作块模式：工作流资产操作 / 能力预设操作 */
  topActionMode?: WorkflowSidebarTopActionMode;
  /** 将一能力拖到另一能力主区域：打开工作流创建 */
  onComposeCapabilities?: (sourcePresetId: string, targetPresetId: string) => void;
};

export function WorkflowSidebarColumn({
  wide,
  variant = 'dock',
  actionModules,
  capabilitySets,
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
  onDropPresetFromEditor,
  onDropPresetAction,
  topActionMode = 'asset',
  onComposeCapabilities,
}: WorkflowSidebarColumnProps) {
  const [groupOverrideByCategory, setGroupOverrideByCategory] = useState<
    Record<
      string,
      {
        enabled?: boolean;
        imageGear?: CustomAppModule['imageGear'];
        imageAspectRatio?: string;
        imageSize?: string;
        understand?: boolean;
        generateCount?: number;
      }
    >
  >({});
  const [countCustomEditingByCategory, setCountCustomEditingByCategory] = useState<Record<string, boolean>>({});
  const [countCustomDraftByCategory, setCountCustomDraftByCategory] = useState<Record<string, string>>({});
  const getGroupOverridesForCategory = (categoryId: string) => {
    const cfg = groupOverrideByCategory[categoryId];
    const countRaw = Number(cfg?.generateCount ?? 1);
    const generateCount = Number.isFinite(countRaw) ? Math.max(1, Math.floor(countRaw)) : 1;
    if (!cfg?.enabled && generateCount <= 1) return undefined;
    return {
      ...(cfg?.enabled
        ? {
            ...(cfg.imageGear ? { imageGear: cfg.imageGear } : {}),
            ...(cfg.imageAspectRatio ? { imageAspectRatio: cfg.imageAspectRatio } : {}),
            ...(cfg.imageSize ? { imageSize: cfg.imageSize } : {}),
            ...(typeof cfg.understand === 'boolean' ? { understand: cfg.understand } : {}),
          }
        : {}),
      ...(generateCount > 1 ? { generateCount } : {}),
    };
  };
  const FAVORITE_GROUP_KEY = '__favorites__';
  const favoriteModuleEntries = useMemo(
    () => favoriteEntries.filter((entry): entry is Extract<WorkflowSidebarFavoriteEntry, { kind: 'module' }> => entry.kind === 'module'),
    [favoriteEntries]
  );
  const favoriteHasImageParamOptions = favoriteModuleEntries.some((entry) => capabilityUsesGenImageEngine(entry.mod));
  const favoriteHasGenerateCountOptions =
    favoriteHasImageParamOptions || favoriteModuleEntries.some((entry) => entry.mod.category === 'text_to_text');
  const favoriteCfg = groupOverrideByCategory[FAVORITE_GROUP_KEY] || {};
  const favoriteGearChanged = Boolean(favoriteCfg.imageGear);
  const favoriteRatioChanged = Boolean(favoriteCfg.imageAspectRatio);
  const favoriteSizeChanged = Boolean(favoriteCfg.imageSize);
  const favoriteCountValue = Number.isFinite(favoriteCfg.generateCount)
    ? Math.max(1, Math.floor(favoriteCfg.generateCount as number))
    : 1;
  const favoriteCountChanged = favoriteCountValue > 1;
  const favoriteIsCountCustomEditing = !!countCustomEditingByCategory[FAVORITE_GROUP_KEY];
  const favoriteCountCustomDraft = countCustomDraftByCategory[FAVORITE_GROUP_KEY] ?? String(favoriteCountValue);
  const applyFavoriteCustomCount = () => {
    const n = Math.floor(Number(favoriteCountCustomDraft));
    if (!Number.isFinite(n) || n < 1) return;
    setGroupOverrideByCategory((prev) => ({
      ...prev,
      [FAVORITE_GROUP_KEY]: {
        ...(prev[FAVORITE_GROUP_KEY] || {}),
        generateCount: n,
      },
    }));
    setCountCustomEditingByCategory((prev) => ({ ...prev, [FAVORITE_GROUP_KEY]: false }));
  };
  const favoriteGearText = favoriteGearChanged
    ? (DIALOG_IMAGE_GEARS.find((g) => g.id === favoriteCfg.imageGear)?.label || String(favoriteCfg.imageGear)).slice(0, 1)
    : '档';
  const favoriteRatioText = favoriteRatioChanged ? String(favoriteCfg.imageAspectRatio).slice(0, 1) : '比';
  const favoriteSizeText = favoriteSizeChanged ? String(favoriteCfg.imageSize).slice(0, 1) : '寸';
  const typesHasCapabilityFromEditor = (dt: DataTransfer | null) => {
    if (!dt?.types) return false;
    try {
      return Array.from(dt.types).includes(DT_AC_CAPABILITY_FROM_EDITOR);
    } catch {
      return false;
    }
  };
  const readPresetIdFromTransfer = (dt: DataTransfer | null): string => {
    const readFromWindow = (): string => {
      if (typeof window === 'undefined') return '';
      try {
        return ((window as Window & { __acDraggingPresetId?: string | null }).__acDraggingPresetId || '').trim();
      } catch {
        return '';
      }
    };
    if (!dt) return readFromWindow();
    let id = '';
    try {
      id = dt.getData(DT_AC_CAPABILITY_FROM_EDITOR) || dt.getData('text/plain') || '';
    } catch {
      id = '';
    }
    const trimmed = id.trim();
    return trimmed || readFromWindow();
  };
  const readFavoriteActionIdFromTransfer = (dt: DataTransfer | null): string => {
    let id = draggingActionIdRef.current || '';
    if (!id && dt) {
      try {
        id = dt.getData(DT_AC_CAPABILITY_ACTION) || dt.getData('text/plain') || '';
      } catch {
        id = '';
      }
    }
    return id.trim();
  };
  const isValidFavoriteActionId = (id: string): boolean =>
    actionModules.some((m) => m.id === id) ||
    (id.startsWith(SET_ACTION_PREFIX) && capabilitySets.some((s) => s.id === id.slice(SET_ACTION_PREFIX.length)));
  const tryAddActionToFavoriteFromEvent = (e: DragEvent<HTMLElement>): boolean => {
    const id = readFavoriteActionIdFromTransfer(e.dataTransfer);
    if (!id || !isValidFavoriteActionId(id)) return false;
    setFavoriteActionIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActionDroppedInFavorite(true);
    return true;
  };
  const allowGlobalPresetDrop = !!onDropPresetFromEditor;
  const draggedPayload = useMemo(() => {
    const result = { hasDrag: false, hasText: false, hasImage: false };
    const appendFromAsset = (asset: WorkflowAsset | undefined | null) => {
      if (!asset) return;
      result.hasDrag = true;
      if (hasAnyTextPayload(asset)) result.hasText = true;
      if (hasAnyImagePayload(asset)) result.hasImage = true;
    };
    if (draggingAssetIds?.length) {
      draggingAssetIds.forEach((id) => appendFromAsset(assets.find((a) => a.id === id)));
    }
    if (draggingGroupItems?.itemIndexes?.length) {
      const group = assets.find((a) => a.id === draggingGroupItems.groupAssetId);
      const items = group?.cutImageGroup || [];
      draggingGroupItems.itemIndexes.forEach((idx) => {
        const item = items[idx];
        if (!item) return;
        if (typeof item === 'string') {
          result.hasDrag = true;
          if (item.trim()) result.hasImage = true;
          return;
        }
        if (typeof item === 'object' && item && 'assetId' in item) {
          appendFromAsset(assets.find((a) => a.id === item.assetId));
        }
      });
    }
    return result;
  }, [draggingAssetIds, draggingGroupItems, assets]);
  const isAssetPayloadDragging = draggedPayload.hasDrag;
  const DROP_TARGET_ACTIVE_CLASS =
    'border-blue-300 bg-[#213c66] ring-2 ring-blue-400/70 shadow-[0_0_0_1px_rgba(147,197,253,0.45),0_10px_22px_rgba(37,99,235,0.35)] -translate-y-[1px]';
  const DROP_TARGET_TWEAK_ACTIVE_CLASS =
    'border-[#7db6ff] bg-[#224168] ring-2 ring-[#60a5fa]/65 shadow-[0_0_0_1px_rgba(125,182,255,0.45),0_10px_22px_rgba(37,99,235,0.35)] -translate-y-[1px]';
  const DROP_TARGET_ELIGIBLE_CLASS =
    'border-blue-400/75 bg-[#182d4d] ring-1 ring-blue-300/45 shadow-[0_0_0_1px_rgba(96,165,250,0.35)]';
  const DROP_TARGET_INELIGIBLE_CLASS = 'opacity-45 saturate-50';
  const sidebarRootRef = useRef<HTMLDivElement | null>(null);
  const sidebarListScrollRef = useRef<HTMLDivElement | null>(null);
  const hasPresetEditorDragging = () => {
    if (typeof window === 'undefined') return false;
    try {
      return Boolean((window as Window & { __acDraggingPresetId?: string | null }).__acDraggingPresetId);
    } catch {
      return false;
    }
  };
  const isAnyDragActive = () =>
    Boolean(draggingAssetIds?.length) ||
    Boolean(draggingGroupItems?.itemIndexes?.length) ||
    Boolean(draggingActionIdRef.current) ||
    hasPresetEditorDragging();
  useEffect(() => {
    const root = sidebarRootRef.current;
    if (!root) return;
    const onWheelNative = (ev: WheelEvent) => {
      // React onWheelCapture 已处理时避免重复滚动
      if (ev.defaultPrevented) return;
      if (!isAnyDragActive()) return;
      let dy = ev.deltaY;
      if (Math.abs(ev.deltaX) > Math.abs(dy)) dy = ev.deltaX;
      if (ev.deltaMode === 1) dy *= 16;
      if (ev.deltaMode === 2) dy *= 120;
      if (!Number.isFinite(dy) || Math.abs(dy) < 0.1) return;
      ev.preventDefault();
      ev.stopPropagation();
      const target = sidebarListScrollRef.current || root;
      target.scrollTop += dy;
    };
    const onWindowWheelCapture = (ev: WheelEvent) => {
      if (ev.defaultPrevented) return;
      if (!isAnyDragActive()) return;
      const rootEl = sidebarRootRef.current;
      if (!rootEl) return;
      const rect = rootEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) {
        return;
      }
      let dy = ev.deltaY;
      if (Math.abs(ev.deltaX) > Math.abs(dy)) dy = ev.deltaX;
      if (ev.deltaMode === 1) dy *= 16;
      if (ev.deltaMode === 2) dy *= 120;
      if (!Number.isFinite(dy) || Math.abs(dy) < 0.1) return;
      const target = sidebarListScrollRef.current || rootEl;
      if (target.scrollHeight <= target.clientHeight) return;
      ev.preventDefault();
      ev.stopPropagation();
      target.scrollTop += dy;
    };
    root.addEventListener('wheel', onWheelNative, { passive: false });
    window.addEventListener('wheel', onWindowWheelCapture, { passive: false, capture: true });
    return () => {
      root.removeEventListener('wheel', onWheelNative);
      window.removeEventListener('wheel', onWindowWheelCapture, true);
    };
  }, [draggingAssetIds, draggingGroupItems, draggingActionIdRef]);
  return (
    <div
      ref={sidebarRootRef}
      data-workflow-sidebar
      onWheelCapture={(e) => {
        if (!isAnyDragActive()) return;
        const dy = normalizeWheelDeltaY(e);
        if (!Number.isFinite(dy) || Math.abs(dy) < 0.1) return;
        e.preventDefault();
        e.stopPropagation();
        const target = sidebarListScrollRef.current || sidebarRootRef.current || (e.currentTarget as HTMLDivElement);
        target.scrollTop += dy;
      }}
      onDragOverCapture={(e) => {
        autoScrollContainerOnDrag((sidebarListScrollRef.current || (e.currentTarget as HTMLElement)), e.clientY);
        if (!allowGlobalPresetDrop) return;
        if (!typesHasCapabilityFromEditor(e.dataTransfer)) return;
        if (
          topActionMode === 'capabilityPreset' &&
          e.target instanceof Element &&
          e.target.closest('[data-capability-preset-action-drop]')
        ) {
          return;
        }
        e.preventDefault();
        try {
          e.dataTransfer.dropEffect = 'copy';
        } catch {
          /* ignore */
        }
      }}
      onDropCapture={(e) => {
        if (!allowGlobalPresetDrop) return;
        if (!typesHasCapabilityFromEditor(e.dataTransfer)) return;
        if (
          topActionMode === 'capabilityPreset' &&
          e.target instanceof Element &&
          e.target.closest('[data-capability-preset-action-drop]')
        ) {
          return;
        }
        let id = '';
        try {
          id =
            e.dataTransfer.getData(DT_AC_CAPABILITY_FROM_EDITOR) ||
            e.dataTransfer.getData('text/plain') ||
            '';
        } catch {
          id = '';
        }
        const trimmed = id.trim();
        if (!trimmed) return;
        e.preventDefault();
        e.stopPropagation();
        onDropPresetFromEditor(trimmed);
      }}
      className={
        variant === 'splitLeft'
          ? 'w-full min-h-0 flex-1 flex flex-col gap-3 overflow-hidden relative isolate'
          : wide
            ? 'w-full min-h-0 flex flex-col gap-3 overflow-hidden no-scrollbar shrink-0 max-h-[min(52vh,520px)] relative isolate'
            : 'w-80 shrink-0 min-h-0 flex-1 flex flex-col gap-3 overflow-hidden relative isolate'
      }
    >
      <div className="sticky top-0 z-40 bg-gradient-to-b from-[#0b0b0d]/96 via-[#0b0b0d]/90 to-transparent pt-2 pb-3">
      {topActionMode === 'capabilityPreset' ? (
        <div className="grid grid-cols-5 gap-2" data-capability-preset-action-drop>
          {[
            {
              id: 'edit' as const,
              label: '编辑',
              title: '将能力预设拖到此处打开编辑',
              activeClass: 'border-blue-500 bg-[#152642]',
              idleClass: 'border-[#3d4754] bg-[#0e0f12] hover:border-[#4b6a9e] hover:bg-[#1a1d26]',
              iconClass: 'text-gray-300',
              textClass: 'text-gray-200',
              iconPath: 'M4 13.5V16h2.5l7.2-7.2-2.5-2.5L4 13.5zm10.7-6.8a.7.7 0 000-1L13.3 4.3a.7.7 0 00-1 0l-1.1 1.1 2.5 2.5 1-1.2z',
            },
            {
              id: 'copy' as const,
              label: '复制',
              title: '将能力预设拖到此处复制一份',
              activeClass: 'border-blue-500 bg-[#152642]',
              idleClass: 'border-[#3d4754] bg-[#0e0f12] hover:border-[#4b6a9e] hover:bg-[#1a1d26]',
              iconClass: 'text-gray-300',
              textClass: 'text-gray-200',
              iconPath: 'M6 6h9v10H6zM4 4h9v1H5v9H4z',
            },
            {
              id: 'delete' as const,
              label: '删除',
              title: '将能力预设拖到此处删除',
              activeClass: 'border-red-500 bg-[#3a1818]',
              idleClass: 'border-[#3d4754] bg-[#0e0f12] hover:border-[#b85454] hover:bg-[#1f1416]',
              iconClass: 'text-red-300',
              textClass: 'text-red-400',
              iconPath: 'M6 6h8l-.6 10H6.6L6 6zm2-2h4l1 1h3v2H4V5h3l1-1z',
            },
          ].map((action) => {
            const dragKey = `__preset_${action.id}__`;
            const enabled = !!onDropPresetAction;
            return (
              <div
                key={action.id}
                data-capability-preset-action-drop
                onDragOver={(e) => {
                  if (!enabled) return;
                  const presetId = readPresetIdFromTransfer(e.dataTransfer);
                  if (!presetId) return;
                  e.preventDefault();
                  setDragOverAction(dragKey);
                }}
                onDragLeave={() => {
                  if (dragOverAction === dragKey) setDragOverAction(null);
                }}
                onDrop={(e) => {
                  if (!enabled || !onDropPresetAction) return;
                  const presetId = readPresetIdFromTransfer(e.dataTransfer);
                  if (!presetId) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverAction(null);
                  onDropPresetAction(action.id, presetId);
                }}
                title={action.title}
                className={`rounded-xl border-2 border-dashed h-[52px] px-1 flex flex-col items-center justify-center text-center transition-colors ${
                  dragOverAction === dragKey ? action.activeClass : action.idleClass
                } ${enabled ? '' : 'opacity-60 cursor-not-allowed'}`}
              >
                <svg viewBox="0 0 20 20" className={`w-3 h-3 mb-0.5 ${action.iconClass}`} aria-hidden>
                  <path d={action.iconPath} fill="currentColor" />
                </svg>
                <span className={`text-[8px] font-black uppercase ${action.textClass}`}>{action.label}</span>
              </div>
            );
          })}
          {Array.from({ length: 2 }).map((_, idx) => (
            <div
              key={`capability-preset-action-placeholder-${idx}`}
              aria-hidden
              className="h-[52px] pointer-events-none opacity-0"
            />
          ))}
        </div>
      ) : (
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
      )}
      </div>
          {favoriteEntries.length > 0 || visiblePresets.length > 0 ? (
            <div className="shrink-0 space-y-2">
              <div className="space-y-2">
                <div
                  onDragOver={(e) => {
                    if (!draggingActionIdRef.current && !dragTransferHasPlainText(e)) return;
                    e.preventDefault();
                    try {
                      e.dataTransfer.dropEffect = 'copy';
                    } catch {
                      /* ignore */
                    }
                    setDragOverAction('__favorite_group_header__');
                  }}
                  onDragLeave={(ev) => {
                    const next = ev.relatedTarget as Node | null;
                    if (next && ev.currentTarget.contains(next)) return;
                    if (dragOverAction === '__favorite_group_header__') setDragOverAction(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverAction(null);
                    setFavoriteDropActive(false);
                    tryAddActionToFavoriteFromEvent(e);
                  }}
                  className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 transition-colors ${
                    dragOverAction === '__favorite_group_header__'
                      ? 'border-blue-400 bg-[#1a2a41]'
                      : 'border-[#2e2e32] bg-[#16161a]'
                  }`}
                >
                  <span className="text-[8px] font-black text-blue-300 uppercase tracking-wide">常用功能</span>
                  <div className="flex-1 min-w-0 flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {favoriteHasGenerateCountOptions ? (
                      <>
                        {favoriteIsCountCustomEditing ? (
                          <div
                            className="h-6 rounded-full border border-blue-500 text-blue-200 bg-blue-950/35 inline-flex items-center px-1 gap-1"
                            title="输入数量后点✓确认"
                          >
                            <input
                              value={favoriteCountCustomDraft}
                              onChange={(e) =>
                                setCountCustomDraftByCategory((prev) => ({ ...prev, [FAVORITE_GROUP_KEY]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') applyFavoriteCustomCount();
                                if (e.key === 'Escape') {
                                  setCountCustomEditingByCategory((prev) => ({ ...prev, [FAVORITE_GROUP_KEY]: false }));
                                }
                              }}
                              className="w-8 bg-transparent text-[9px] font-black text-center outline-none"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={applyFavoriteCustomCount}
                              className="text-[9px] leading-none font-black text-blue-300 hover:text-blue-100"
                              title="确认数量"
                            >
                              ✓
                            </button>
                          </div>
                        ) : (
                          <CustomDropdown
                            options={[
                              ...Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}` })),
                              { value: '__custom__', label: '自定义…' },
                            ]}
                            value={String(Math.min(10, Math.max(1, favoriteCountValue)))}
                            onChange={(v) => {
                              if (v === '__custom__') {
                                setCountCustomDraftByCategory((prev) => ({ ...prev, [FAVORITE_GROUP_KEY]: String(favoriteCountValue) }));
                                setCountCustomEditingByCategory((prev) => ({ ...prev, [FAVORITE_GROUP_KEY]: true }));
                                return;
                              }
                              const n = Math.max(1, Math.floor(Number(v) || 1));
                              setGroupOverrideByCategory((prev) => ({
                                ...prev,
                                [FAVORITE_GROUP_KEY]: {
                                  ...(prev[FAVORITE_GROUP_KEY] || {}),
                                  generateCount: n,
                                },
                              }));
                            }}
                            triggerClassName="p-0 w-6 h-6 inline-flex items-center justify-center bg-transparent border-0 rounded-none hover:bg-transparent align-middle"
                            renderTrigger={() => (
                              <span
                                title={favoriteCountChanged ? `生成数量：${favoriteCountValue} 张` : '生成数量：1 张（默认）'}
                                className={`w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${
                                  favoriteCountChanged
                                    ? 'border-blue-500 text-blue-300 bg-blue-950/35'
                                    : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'
                                }`}
                              >
                                {favoriteCountChanged ? String(favoriteCountValue) : '数'}
                              </span>
                            )}
                          />
                        )}
                        {favoriteHasImageParamOptions ? (
                          <>
                            <button
                              type="button"
                              title="覆盖参数开关"
                              onClick={() =>
                                setGroupOverrideByCategory((prev) => ({
                                  ...prev,
                                  [FAVORITE_GROUP_KEY]: {
                                    ...(prev[FAVORITE_GROUP_KEY] || {}),
                                    enabled: !(prev[FAVORITE_GROUP_KEY]?.enabled === true),
                                  },
                                }))
                              }
                              className={`shrink-0 w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${
                                groupOverrideByCategory[FAVORITE_GROUP_KEY]?.enabled
                                  ? 'border-blue-500 text-blue-300 bg-blue-950/35'
                                  : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'
                              }`}
                            >
                              覆
                            </button>
                            <CustomDropdown
                              options={[{ value: '', label: '默认' }, ...DIALOG_IMAGE_GEARS.map((g) => ({ value: g.id, label: g.label }))]}
                              value={groupOverrideByCategory[FAVORITE_GROUP_KEY]?.imageGear || ''}
                              onChange={(v) =>
                                setGroupOverrideByCategory((prev) => ({
                                  ...prev,
                                  [FAVORITE_GROUP_KEY]: {
                                    ...(prev[FAVORITE_GROUP_KEY] || {}),
                                    imageGear: (v || undefined) as CustomAppModule['imageGear'] | undefined,
                                  },
                                }))
                              }
                              disabled={!groupOverrideByCategory[FAVORITE_GROUP_KEY]?.enabled}
                              triggerClassName="p-0 w-6 h-6 inline-flex items-center justify-center bg-transparent border-0 rounded-none hover:bg-transparent align-middle"
                              renderTrigger={() => (
                                <span
                                  title={
                                    favoriteGearChanged
                                      ? `档位：${DIALOG_IMAGE_GEARS.find((g) => g.id === favoriteCfg.imageGear)?.label || favoriteCfg.imageGear}`
                                      : '档位：默认'
                                  }
                                  className={`w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${
                                    favoriteGearChanged
                                      ? 'border-blue-500 text-blue-300 bg-blue-950/35'
                                      : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'
                                  }`}
                                >
                                  {favoriteGearText}
                                </span>
                              )}
                            />
                            <CustomDropdown
                              options={[{ value: '', label: '默认' }, ...SUPPORTED_ASPECT_RATIOS.map((r) => ({ value: r.value, label: r.label }))]}
                              value={groupOverrideByCategory[FAVORITE_GROUP_KEY]?.imageAspectRatio || ''}
                              onChange={(v) =>
                                setGroupOverrideByCategory((prev) => ({
                                  ...prev,
                                  [FAVORITE_GROUP_KEY]: {
                                    ...(prev[FAVORITE_GROUP_KEY] || {}),
                                    imageAspectRatio: v || undefined,
                                  },
                                }))
                              }
                              disabled={!groupOverrideByCategory[FAVORITE_GROUP_KEY]?.enabled}
                              triggerClassName="p-0 w-6 h-6 inline-flex items-center justify-center bg-transparent border-0 rounded-none hover:bg-transparent align-middle"
                              renderTrigger={() => (
                                <span
                                  title={favoriteRatioChanged ? `比例：${favoriteCfg.imageAspectRatio}` : '比例：默认'}
                                  className={`w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${
                                    favoriteRatioChanged
                                      ? 'border-blue-500 text-blue-300 bg-blue-950/35'
                                      : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'
                                  }`}
                                >
                                  {favoriteRatioText}
                                </span>
                              )}
                            />
                            <CustomDropdown
                              options={[{ value: '', label: '默认' }, ...SUPPORTED_IMAGE_SIZES.map((s) => ({ value: s.value, label: s.label }))]}
                              value={groupOverrideByCategory[FAVORITE_GROUP_KEY]?.imageSize || ''}
                              onChange={(v) =>
                                setGroupOverrideByCategory((prev) => ({
                                  ...prev,
                                  [FAVORITE_GROUP_KEY]: {
                                    ...(prev[FAVORITE_GROUP_KEY] || {}),
                                    imageSize: v || undefined,
                                  },
                                }))
                              }
                              disabled={!groupOverrideByCategory[FAVORITE_GROUP_KEY]?.enabled}
                              triggerClassName="p-0 w-6 h-6 inline-flex items-center justify-center bg-transparent border-0 rounded-none hover:bg-transparent align-middle"
                              renderTrigger={() => (
                                <span
                                  title={favoriteSizeChanged ? `尺寸：${favoriteCfg.imageSize}` : '尺寸：默认'}
                                  className={`w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${
                                    favoriteSizeChanged
                                      ? 'border-blue-500 text-blue-300 bg-blue-950/35'
                                      : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'
                                  }`}
                                >
                                  {favoriteSizeText}
                                </span>
                              )}
                            />
                            <button
                              type="button"
                              title="理解开关"
                              disabled={!groupOverrideByCategory[FAVORITE_GROUP_KEY]?.enabled}
                              onClick={() =>
                                setGroupOverrideByCategory((prev) => ({
                                  ...prev,
                                  [FAVORITE_GROUP_KEY]: {
                                    ...(prev[FAVORITE_GROUP_KEY] || {}),
                                    understand: prev[FAVORITE_GROUP_KEY]?.understand === false,
                                  },
                                }))
                              }
                              className={`shrink-0 w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${
                                groupOverrideByCategory[FAVORITE_GROUP_KEY]?.understand !== false
                                  ? 'border-blue-500 text-blue-300 bg-blue-950/35'
                                  : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'
                              } disabled:opacity-50`}
                            >
                              解
                            </button>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-[8px] text-gray-500">拖入收藏</span>
                    )}
                  </div>
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
                    tryAddActionToFavoriteFromEvent(e);
                  }}
                  className="space-y-2"
                >
                  {favoriteEntries.length === 0 ? (
                    <div className={`text-[8px] text-center py-2 ${favoriteDropActive ? 'text-blue-300' : 'text-gray-500'}`}>
                      把功能块拖到这里，作为常用功能
                    </div>
                  ) : (
                    <div className="grid grid-cols-5 gap-1.5">
                      {favoriteEntries.map((entry) => {
                        const hasTweakSlot =
                          entry.kind === 'module' && entry.mod && capabilityUsesGenImageEngine(entry.mod);
                        return (
                        <div
                          key={`fav-${entry.id}`}
                          data-capability-hover-id={entry.kind === 'module' ? entry.mod?.id : undefined}
                          className={`rounded-xl border h-[52px] min-h-[52px] flex overflow-hidden transition-all duration-150 ${
                            hasTweakSlot ? 'col-span-2' : 'col-span-1'
                          } ${
                            dragOverAction === entry.id
                              ? DROP_TARGET_ACTIVE_CLASS
                              : dragOverAction === entry.id + '__tweak'
                                ? DROP_TARGET_TWEAK_ACTIVE_CLASS
                                : isAssetPayloadDragging
                                  ? (entry.kind === 'module'
                                      ? moduleSupportsDraggedPayload(entry.mod, draggedPayload)
                                      : true)
                                    ? DROP_TARGET_ELIGIBLE_CLASS
                                    : `${getSidebarCapabilityTone(entry.kind === 'module' ? entry.mod.category : 'set').idleBorderClass} bg-[#1c1c22] ${DROP_TARGET_INELIGIBLE_CLASS}`
                                  : `${getSidebarCapabilityTone(entry.kind === 'module' ? entry.mod.category : 'set').idleBorderClass} bg-[#1c1c22] ${getSidebarCapabilityTone(entry.kind === 'module' ? entry.mod.category : 'set').hoverBorderClass}`
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
                              e.dataTransfer.setData(DT_AC_CAPABILITY_ACTION, entry.id);
                              e.dataTransfer.setData(DT_AC_CAPABILITY_ACTION_SOURCE, 'favorite');
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
                            className={`flex-1 px-1.5 py-1 flex flex-col items-center justify-center text-center min-w-0 transition-colors ${
                              entry.kind === 'module' && entry.mod && capabilityUsesGenImageEngine(entry.mod)
                                ? `border-r ${getSidebarCapabilityTone(entry.mod.category).dividerBorderClass}`
                                : ''
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
              if (entry.kind === 'module' && entry.mod) {
                if (
                  tryConsumeCapabilityComposeDrop(
                    e,
                    entry.mod,
                    draggingActionIdRef,
                    onComposeCapabilities,
                    setDragOverAction,
                    updateDraggingActionId
                  )
                ) {
                  return;
                }
              }
              e.preventDefault();
              setDragOverAction(null);
              if (entry.kind === 'set') {
                handleDropToSetAction(entry.id, e);
              } else if (entry.mod) {
                handleDropToModuleAction(entry.mod, false, e, getGroupOverridesForCategory(FAVORITE_GROUP_KEY));
              }
            }}
                          >
                            <span className="text-[8px] leading-tight font-black uppercase truncate w-full">{entry.label}</span>
                          </div>
                          {hasTweakSlot && (
                            <div
                              className={`w-1/4 min-w-[1.75rem] shrink-0 flex flex-col items-center justify-center rounded-r-lg transition-colors cursor-pointer ${
                                dragOverAction === entry.id + '__tweak'
                                  ? 'bg-[#223d5c]'
                                  : 'bg-[#1c1c22] hover:bg-[#2e2e36]'
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
                                if (entry.mod) handleDropToModuleAction(entry.mod, true, e, getGroupOverridesForCategory(FAVORITE_GROUP_KEY));
                              }}
                            >
                              <span className="text-[8px] text-blue-400 font-bold leading-none" title="微调提示词">词</span>
                            </div>
                          )}
                        </div>
                      )})}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div ref={sidebarListScrollRef} className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
            {visiblePresets.length === 0 && visibleCapabilitySets.length === 0 && favoriteEntries.length === 0 && (
              <div className="rounded-xl border border-dashed border-[#3a3a40] p-4 text-center text-[9px] text-gray-500">
                暂无能力预设，请先在「能力」界面添加
              </div>
            )}

            {visiblePresets.length > 0 && (
            <div className="space-y-4">
              {visibleByCategory.length > 0 ? (
                <>
              {visibleByCategory.map(({ category, list }) => (
                <div key={category.id}>
                  <div
                    onDragOver={(e) => {
                      if (!draggingActionIdRef.current && !dragTransferHasPlainText(e)) return;
                      e.preventDefault();
                      try {
                        e.dataTransfer.dropEffect = 'copy';
                      } catch {
                        /* ignore */
                      }
                      setDragOverAction(`__favorite_group_header__:${category.id}`);
                    }}
                    onDragLeave={(ev) => {
                      const next = ev.relatedTarget as Node | null;
                      if (next && ev.currentTarget.contains(next)) return;
                      if (dragOverAction === `__favorite_group_header__:${category.id}`) setDragOverAction(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverAction(null);
                      setFavoriteDropActive(false);
                      tryAddActionToFavoriteFromEvent(e);
                    }}
                    className={`mb-1 rounded-lg border px-2 py-1 flex items-center gap-1.5 min-h-[1.6rem] transition-colors ${
                      dragOverAction === `__favorite_group_header__:${category.id}`
                        ? 'border-blue-400 bg-[#1a2a41]'
                        : 'border-[#2e2e32] bg-[#121214]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSectionCollapsed(`cat:${category.id}`)}
                      className="shrink-0 text-left inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wide text-gray-400 hover:text-gray-200 transition-colors"
                    >
                      <span>{category.label}</span>
                      <span className="text-[10px] text-gray-500">{collapsedSectionIds[`cat:${category.id}`] ? '▼' : '▲'}</span>
                    </button>
                    <div className="flex-1 min-w-0 flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const hasImageParamOptions = list.some((m) => capabilityUsesGenImageEngine(m));
                        const hasGenerateCountOptions =
                          hasImageParamOptions || category.id === 'text_to_text';
                        const cfg = groupOverrideByCategory[category.id] || {};
                        const gearChanged = Boolean(cfg.imageGear);
                        const ratioChanged = Boolean(cfg.imageAspectRatio);
                        const sizeChanged = Boolean(cfg.imageSize);
                        const countValue = Number.isFinite(cfg.generateCount)
                          ? Math.max(1, Math.floor(cfg.generateCount as number))
                          : 1;
                        const countChanged = countValue > 1;
                        const isCountCustomEditing = !!countCustomEditingByCategory[category.id];
                        const countCustomDraft = countCustomDraftByCategory[category.id] ?? String(countValue);
                        const applyCustomCount = () => {
                          const n = Math.floor(Number(countCustomDraft));
                          if (!Number.isFinite(n) || n < 1) return;
                          setGroupOverrideByCategory((prev) => ({
                            ...prev,
                            [category.id]: {
                              ...(prev[category.id] || {}),
                              generateCount: n,
                            },
                          }));
                          setCountCustomEditingByCategory((prev) => ({ ...prev, [category.id]: false }));
                        };
                        const gearText = gearChanged
                          ? (DIALOG_IMAGE_GEARS.find((g) => g.id === cfg.imageGear)?.label || String(cfg.imageGear)).slice(0, 1)
                          : '档';
                        const ratioText = ratioChanged ? String(cfg.imageAspectRatio).slice(0, 1) : '比';
                        const sizeText = sizeChanged ? String(cfg.imageSize).slice(0, 1) : '寸';
                        return (
                          <>
                      {hasGenerateCountOptions ? (
                        <>
                      {isCountCustomEditing ? (
                        <div
                          className="h-6 rounded-full border border-blue-500 text-blue-200 bg-blue-950/35 inline-flex items-center px-1 gap-1"
                          title="输入数量后点✓确认"
                        >
                          <input
                            value={countCustomDraft}
                            onChange={(e) =>
                              setCountCustomDraftByCategory((prev) => ({ ...prev, [category.id]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') applyCustomCount();
                              if (e.key === 'Escape') {
                                setCountCustomEditingByCategory((prev) => ({ ...prev, [category.id]: false }));
                              }
                            }}
                            className="w-8 bg-transparent text-[9px] font-black text-center outline-none"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={applyCustomCount}
                            className="text-[9px] leading-none font-black text-blue-300 hover:text-blue-100"
                            title="确认数量"
                          >
                            ✓
                          </button>
                        </div>
                      ) : (
                        <CustomDropdown
                          options={[
                            ...Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}` })),
                            { value: '__custom__', label: '自定义…' },
                          ]}
                          value={String(Math.min(10, Math.max(1, countValue)))}
                          onChange={(v) => {
                            if (v === '__custom__') {
                              setCountCustomDraftByCategory((prev) => ({ ...prev, [category.id]: String(countValue) }));
                              setCountCustomEditingByCategory((prev) => ({ ...prev, [category.id]: true }));
                              return;
                            }
                            const n = Math.max(1, Math.floor(Number(v) || 1));
                            setGroupOverrideByCategory((prev) => ({
                              ...prev,
                              [category.id]: {
                                ...(prev[category.id] || {}),
                                generateCount: n,
                              },
                            }));
                          }}
                          triggerClassName="p-0 w-6 h-6 inline-flex items-center justify-center bg-transparent border-0 rounded-none hover:bg-transparent align-middle"
                          renderTrigger={() => (
                            <span
                              title={countChanged ? `生成数量：${countValue} 张` : '生成数量：1 张（默认）'}
                              className={`w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${
                                countChanged ? 'border-blue-500 text-blue-300 bg-blue-950/35' : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'
                              }`}
                            >
                              {countChanged ? String(countValue) : '数'}
                            </span>
                          )}
                        />
                      )}
                      {hasImageParamOptions ? (
                        <>
                          <button
                            type="button"
                            title="覆盖参数开关"
                            onClick={() =>
                              setGroupOverrideByCategory((prev) => ({
                                ...prev,
                                [category.id]: {
                                  ...(prev[category.id] || {}),
                                  enabled: !(prev[category.id]?.enabled === true),
                                },
                              }))
                            }
                            className={`shrink-0 w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${groupOverrideByCategory[category.id]?.enabled ? 'border-blue-500 text-blue-300 bg-blue-950/35' : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'}`}
                          >
                            覆
                          </button>
                          <CustomDropdown
                            options={[{ value: '', label: '默认' }, ...DIALOG_IMAGE_GEARS.map((g) => ({ value: g.id, label: g.label }))]}
                            value={groupOverrideByCategory[category.id]?.imageGear || ''}
                            onChange={(v) =>
                              setGroupOverrideByCategory((prev) => ({
                                ...prev,
                                [category.id]: { ...(prev[category.id] || {}), imageGear: (v || undefined) as CustomAppModule['imageGear'] | undefined },
                              }))
                            }
                            disabled={!groupOverrideByCategory[category.id]?.enabled}
                            triggerClassName="p-0 w-6 h-6 inline-flex items-center justify-center bg-transparent border-0 rounded-none hover:bg-transparent align-middle"
                            renderTrigger={() => (
                              <span
                                title={gearChanged ? `档位：${DIALOG_IMAGE_GEARS.find((g) => g.id === cfg.imageGear)?.label || cfg.imageGear}` : '档位：默认'}
                                className={`w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${
                                  gearChanged ? 'border-blue-500 text-blue-300 bg-blue-950/35' : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'
                                }`}
                              >
                                {gearText}
                              </span>
                            )}
                          />
                          <CustomDropdown
                            options={[{ value: '', label: '默认' }, ...SUPPORTED_ASPECT_RATIOS.map((r) => ({ value: r.value, label: r.label }))]}
                            value={groupOverrideByCategory[category.id]?.imageAspectRatio || ''}
                            onChange={(v) =>
                              setGroupOverrideByCategory((prev) => ({
                                ...prev,
                                [category.id]: { ...(prev[category.id] || {}), imageAspectRatio: v || undefined },
                              }))
                            }
                            disabled={!groupOverrideByCategory[category.id]?.enabled}
                            triggerClassName="p-0 w-6 h-6 inline-flex items-center justify-center bg-transparent border-0 rounded-none hover:bg-transparent align-middle"
                            renderTrigger={() => (
                              <span
                                title={ratioChanged ? `比例：${cfg.imageAspectRatio}` : '比例：默认'}
                                className={`w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${
                                  ratioChanged ? 'border-blue-500 text-blue-300 bg-blue-950/35' : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'
                                }`}
                              >
                                {ratioText}
                              </span>
                            )}
                          />
                          <CustomDropdown
                            options={[{ value: '', label: '默认' }, ...SUPPORTED_IMAGE_SIZES.map((s) => ({ value: s.value, label: s.label }))]}
                            value={groupOverrideByCategory[category.id]?.imageSize || ''}
                            onChange={(v) =>
                              setGroupOverrideByCategory((prev) => ({
                                ...prev,
                                [category.id]: { ...(prev[category.id] || {}), imageSize: v || undefined },
                              }))
                            }
                            disabled={!groupOverrideByCategory[category.id]?.enabled}
                            triggerClassName="p-0 w-6 h-6 inline-flex items-center justify-center bg-transparent border-0 rounded-none hover:bg-transparent align-middle"
                            renderTrigger={() => (
                              <span
                                title={sizeChanged ? `尺寸：${cfg.imageSize}` : '尺寸：默认'}
                                className={`w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${
                                  sizeChanged ? 'border-blue-500 text-blue-300 bg-blue-950/35' : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'
                                }`}
                              >
                                {sizeText}
                              </span>
                            )}
                          />
                          <button
                            type="button"
                            title="理解开关"
                            disabled={!groupOverrideByCategory[category.id]?.enabled}
                            onClick={() =>
                              setGroupOverrideByCategory((prev) => ({
                                ...prev,
                                [category.id]: {
                                  ...(prev[category.id] || {}),
                                  understand: prev[category.id]?.understand === false,
                                },
                              }))
                            }
                            className={`shrink-0 w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${groupOverrideByCategory[category.id]?.understand !== false ? 'border-blue-500 text-blue-300 bg-blue-950/35' : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'} disabled:opacity-50`}
                          >
                            解
                          </button>
                        </>
                      ) : null}
                        </>
                      ) : null}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  {!collapsedSectionIds[`cat:${category.id}`] && (
                  <div className="grid grid-cols-2 gap-2">
                    {list.map((mod) => (
                      <div
                        key={mod.id}
                        data-capability-hover-id={mod.id}
                        className={`rounded-xl border min-h-[60px] flex overflow-hidden transition-all duration-150 ${
                          dragOverAction === mod.id
                            ? DROP_TARGET_ACTIVE_CLASS
                            : dragOverAction === mod.id + '__tweak'
                              ? DROP_TARGET_TWEAK_ACTIVE_CLASS
                              : isAssetPayloadDragging
                                ? moduleSupportsDraggedPayload(mod, draggedPayload)
                                  ? DROP_TARGET_ELIGIBLE_CLASS
                                  : `${getSidebarCapabilityTone(mod.category).idleBorderClass} bg-[#1c1c22] ${DROP_TARGET_INELIGIBLE_CLASS}`
                                : `${getSidebarCapabilityTone(mod.category).idleBorderClass} bg-[#1c1c22] ${getSidebarCapabilityTone(mod.category).hoverBorderClass}`
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
                            e.dataTransfer.setData(DT_AC_CAPABILITY_ACTION, mod.id);
                            e.dataTransfer.setData(DT_AC_CAPABILITY_ACTION_SOURCE, 'catalog');
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
                            capabilityUsesGenImageEngine(mod) ? `border-r ${getSidebarCapabilityTone(mod.category).dividerBorderClass}` : ''
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
                            if (
                              tryConsumeCapabilityComposeDrop(
                                e,
                                mod,
                                draggingActionIdRef,
                                onComposeCapabilities,
                                setDragOverAction,
                                updateDraggingActionId
                              )
                            ) {
                              return;
                            }
                            e.preventDefault();
                            setDragOverAction(null);
                            handleDropToModuleAction(mod, false, e, getGroupOverridesForCategory(category.id));
                          }}
                        >
                          <span className="text-[9px] font-black uppercase">{mod.label}</span>
                        </div>
                        {capabilityUsesGenImageEngine(mod) && (
                          <div
                            className={`w-11 shrink-0 flex flex-col items-center justify-center rounded-r-lg transition-colors cursor-pointer ${
                              dragOverAction === mod.id + '__tweak'
                                ? 'bg-[#223d5c]'
                                : 'bg-[#1c1c22] hover:bg-[#2e2e36]'
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
                              handleDropToModuleAction(mod, true, e, getGroupOverridesForCategory(category.id));
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
                onDragOver={(e) => {
                  if (!draggingActionIdRef.current && !dragTransferHasPlainText(e)) return;
                  e.preventDefault();
                  try {
                    e.dataTransfer.dropEffect = 'copy';
                  } catch {
                    /* ignore */
                  }
                  setDragOverAction('__favorite_group_header__:all-presets');
                }}
                onDragLeave={() => {
                  if (dragOverAction === '__favorite_group_header__:all-presets') setDragOverAction(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverAction(null);
                  setFavoriteDropActive(false);
                  tryAddActionToFavoriteFromEvent(e);
                }}
                onClick={() => toggleSectionCollapsed('__all_presets__')}
                className={`w-full text-left mb-1.5 flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[8px] font-black uppercase tracking-wide text-gray-400 hover:bg-[#18181c] hover:text-gray-200 transition-colors ${
                  dragOverAction === '__favorite_group_header__:all-presets'
                    ? 'border-blue-400 bg-[#1a2a41] text-blue-200'
                    : 'border-[#2e2e32] bg-[#121214]'
                }`}
              >
                <span>功能</span>
                <span className="text-[10px] text-gray-500">{collapsedSectionIds.__all_presets__ ? '▼' : '▲'}</span>
              </button>
              {!collapsedSectionIds.__all_presets__ && (
            <div className="grid grid-cols-2 gap-2">
              {visiblePresets.map((mod) => (
                <div
                  key={mod.id}
                  className={`rounded-xl border min-h-[60px] flex overflow-hidden transition-all duration-150 ${
                    dragOverAction === mod.id
                      ? DROP_TARGET_ACTIVE_CLASS
                      : dragOverAction === mod.id + '__tweak'
                        ? DROP_TARGET_TWEAK_ACTIVE_CLASS
                        : isAssetPayloadDragging
                          ? moduleSupportsDraggedPayload(mod, draggedPayload)
                            ? DROP_TARGET_ELIGIBLE_CLASS
                            : `${getSidebarCapabilityTone(mod.category).idleBorderClass} bg-[#1c1c22] ${DROP_TARGET_INELIGIBLE_CLASS}`
                          : `${getSidebarCapabilityTone(mod.category).idleBorderClass} bg-[#1c1c22] ${getSidebarCapabilityTone(mod.category).hoverBorderClass}`
                  }`}
                  draggable
                  onDragStart={(e) => {
                    try {
                      e.dataTransfer.setData(DT_AC_CAPABILITY_ACTION, mod.id);
                      e.dataTransfer.setData(DT_AC_CAPABILITY_ACTION_SOURCE, 'catalog');
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
                      capabilityUsesGenImageEngine(mod) ? `border-r ${getSidebarCapabilityTone(mod.category).dividerBorderClass}` : ''
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
                      if (
                        tryConsumeCapabilityComposeDrop(
                          e,
                          mod,
                          draggingActionIdRef,
                          onComposeCapabilities,
                          setDragOverAction,
                          updateDraggingActionId
                        )
                      ) {
                        return;
                      }
                      e.preventDefault();
                      setDragOverAction(null);
                      handleDropToModuleAction(mod, false, e);
                    }}
                  >
                    <span className="text-[9px] font-black uppercase">{mod.label}</span>
                  </div>
                  {capabilityUsesGenImageEngine(mod) && (
                    <div
                      className={`w-11 shrink-0 flex flex-col items-center justify-center rounded-r-lg transition-colors cursor-pointer ${
                        dragOverAction === mod.id + '__tweak'
                          ? 'bg-[#223d5c]'
                          : 'bg-[#1c1c22] hover:bg-[#2e2e36]'
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

          {visibleCapabilitySets.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onDragOver={(e) => {
                  if (!draggingActionIdRef.current && !dragTransferHasPlainText(e)) return;
                  e.preventDefault();
                  try {
                    e.dataTransfer.dropEffect = 'copy';
                  } catch {
                    /* ignore */
                  }
                  setDragOverAction('__favorite_group_header__:sets');
                }}
                onDragLeave={() => {
                  if (dragOverAction === '__favorite_group_header__:sets') setDragOverAction(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverAction(null);
                  setFavoriteDropActive(false);
                  tryAddActionToFavoriteFromEvent(e);
                }}
                onClick={() => toggleSectionCollapsed('__capability_sets__')}
                className={`w-full text-left mb-1.5 flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[8px] font-black uppercase tracking-wide text-gray-400 hover:bg-[#18181c] hover:text-gray-200 transition-colors ${
                  dragOverAction === '__favorite_group_header__:sets'
                    ? 'border-blue-400 bg-[#1a2a41] text-blue-200'
                    : 'border-[#2e2e32] bg-[#121214]'
                }`}
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
                          e.dataTransfer.setData(DT_AC_CAPABILITY_ACTION, setActionId);
                          e.dataTransfer.setData(DT_AC_CAPABILITY_ACTION_SOURCE, 'catalog');
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
                      className={`rounded-xl border p-2.5 min-h-[60px] flex flex-col items-center justify-center text-center transition-all duration-150 ${
                        dragOverAction === setActionId
                          ? DROP_TARGET_ACTIVE_CLASS
                          : isAssetPayloadDragging
                            ? DROP_TARGET_ELIGIBLE_CLASS
                            : `${getSidebarCapabilityTone('set').idleBorderClass} bg-[#1c1c22] ${getSidebarCapabilityTone('set').hoverBorderClass}`
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
    </div>
  );
}
