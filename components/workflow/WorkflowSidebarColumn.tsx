import React, {
  useCallback,
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
import { labelForImageModelRegistryId } from '../../services/modelRegistry/imageModels';
import { labelForTextModelRegistryId } from '../../services/modelRegistry/textModels';
import { SUPPORTED_ASPECT_RATIOS, SUPPORTED_IMAGE_SIZES } from '../../types';
import { useEffectiveImageModelRows } from '../../hooks/useEffectiveImageGearRows';
import { useEffectiveTextModelRows } from '../../hooks/useEffectiveTextModelRows';
import type { CustomAppModule, CapabilitySet, WorkflowAsset } from '../../types';
import { capabilityUsesGenImageEngine } from '../../services/capabilityExecutor';
import { CustomDropdown } from '../ui/CustomDropdown';
import {
  DT_AC_CAPABILITY_ACTION,
  DT_AC_CAPABILITY_ACTION_SOURCE,
  DT_AC_CAPABILITY_FROM_EDITOR,
} from '../../services/workflowDragPipeline';
import { isGroupAsset } from '../../services/groupHelpers';
import { dragTransferHasPlainText } from './workflowSectionHelpers';
import { SET_ACTION_PREFIX, WORKFLOW_EDGE_GUTTER } from './workflowSectionUiConstants';
import { uuid } from './workflowIds';
import type { CapabilityCategoryGroup } from './workflowCapabilityGroups';
import {
  extractCapabilitySearchKeywords,
  keywordsMatchCapabilityLabelId,
  keywordsMatchCapabilityModule,
} from './capabilitySearchMatch';

/** 复合能力内引用的预设 id，用于与左侧能力预设列联动高亮 */
function collectPresetIdsFromCapabilitySet(set: CapabilitySet | null | undefined): string[] {
  if (!set?.nodes?.length) return [];
  const s = new Set<string>();
  for (const n of set.nodes) {
    if (n.type !== 'preset') continue;
    const id = String(n.data?.presetId ?? '').trim();
    if (id) s.add(id);
  }
  return Array.from(s);
}

function leaveSidebarRowLinkHover(
  e: React.MouseEvent<HTMLElement>,
  onLinkHoverPresetIds?: (ids: string[] | null) => void
) {
  if (!onLinkHoverPresetIds) return;
  const next = e.relatedTarget as Node | null;
  if (next && e.currentTarget.contains(next)) return;
  onLinkHoverPresetIds(null);
}

const DRAG_SCROLL_EDGE_PX = 64;
const DRAG_SCROLL_MAX_STEP_PX = 24;

/** 功能区顶行拖放槽：实线 ring，与侧栏其它控件一致（替代虚线占位感） */
const SIDEBAR_TOP_DROP_SLOT_BASE =
  'rounded-xl min-h-[52px] h-auto px-1 py-1.5 flex flex-col items-center justify-center text-center transition-[box-shadow,background-color]';
const SIDEBAR_TOP_DROP_IDLE = `${SIDEBAR_TOP_DROP_SLOT_BASE} ring-1 ring-inset ring-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:ring-white/[0.12]`;
const SIDEBAR_TOP_DROP_ACTIVE_BLUE = `${SIDEBAR_TOP_DROP_SLOT_BASE} ring-2 ring-inset ring-blue-500/90 bg-[#152642] shadow-[inset_0_0_0_1px_rgba(59,130,246,0.28)]`;
const SIDEBAR_TOP_DROP_DELETE_IDLE = `${SIDEBAR_TOP_DROP_SLOT_BASE} ring-1 ring-inset ring-white/[0.08] bg-white/[0.03] hover:bg-red-950/30 hover:ring-red-500/40`;
const SIDEBAR_TOP_DROP_DELETE_ACTIVE = `${SIDEBAR_TOP_DROP_SLOT_BASE} ring-2 ring-inset ring-red-500 bg-[#3a1818]`;

/** 侧栏分组标题行：统一高度、无边框；拖入高亮用 ring */
const SIDEBAR_GROUP_HEADER_BASE =
  'flex w-full flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg px-2.5 min-h-8 transition-[background-color,box-shadow]';
const SIDEBAR_GROUP_HEADER_IDLE = `${SIDEBAR_GROUP_HEADER_BASE} bg-white/[0.04]`;
const SIDEBAR_GROUP_HEADER_DROP = `${SIDEBAR_GROUP_HEADER_BASE} bg-[#1a2a41] ring-1 ring-inset ring-blue-400/45`;

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
  if (asset.assetIds?.length) return true;
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
  if (mod.category === 'generate_video') {
    return payload.hasText || payload.hasImage;
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
    case 'image_process':
      return {
        idleBorderClass: 'border-[#4a5a66]',
        hoverBorderClass: 'hover:border-[#5a6f7c]',
        dividerBorderClass: 'border-[#425058]',
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
    case 'generate_video':
      return {
        idleBorderClass: 'border-[#4a5f6f]',
        hoverBorderClass: 'hover:border-[#5a7390]',
        dividerBorderClass: 'border-[#425566]',
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
  selectedGroupItemKeys: Set<string>;
  setSelectedGroupItemKeys: Dispatch<SetStateAction<Set<string>>>;
  moveGroupItemsToUpperLevel: (groupAssetId: string, itemIndexes: number[]) => void;
  sidebarOpsAllowed: boolean;
  groupAssetForDrag: WorkflowAsset | null;
  currentGroupAsset: WorkflowAsset | null;
  duplicateAssetInPlace: (sourceIds: string[], parentGroupId: string | null) => void;
  removeAsset: (assetId: string) => void;
  removeGroupItems: (prev: WorkflowAsset[], groupAssetId: string, itemIndexes: number[]) => WorkflowAsset[];
  setGroupFilterId: Dispatch<SetStateAction<string | null>>;
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
      imageModelRegistryId?: string;
      /** @deprecated */
      imageGear?: CustomAppModule['imageGear'];
      textModelRegistryId?: string;
      imageAspectRatio?: string;
      imageSize?: string;
      understand?: boolean;
      generateCount?: number;
    }
  ) => void;
  handleDropToSetAction: (setActionId: string, e: DragEvent<HTMLElement>) => void;
  jumpToCapabilityPreset: (preset: CustomAppModule) => void;
  /** 双击复合能力块：滑到能力列并滚动到对应能力集合 */
  jumpToCapabilitySet?: (setId: string) => void;
  /** 能力区预设卡片拖入侧栏任意处：启用并入队当前选中资产 */
  onDropPresetFromEditor?: (presetId: string) => void;
  /** 能力页模式下：将预设拖到顶部动作块（编辑/删除等） */
  onDropPresetAction?: (action: WorkflowSidebarPresetDropAction, presetId: string) => void;
  /** 顶部动作块模式：工作流资产操作 / 能力预设操作 */
  topActionMode?: WorkflowSidebarTopActionMode;
  /** 将一能力拖到另一能力主区域：打开工作流创建 */
  onComposeCapabilities?: (sourcePresetId: string, targetPresetId: string) => void;
  /**
   * 底部快捷栏输入：非空时按与「搜索功能」相同规则（名称/id/分类/提示词片段）筛选本区列表，
   * 且优先于本区搜索框内容；清空后恢复仅按本区搜索框筛选。
   */
  linkedComposeSearchQuery?: string;
  /**
   * 悬停功能区某能力块时，传入对应预设 id 列表；左侧能力预设列据此压暗其它卡片。
   * `null` 表示不压暗。
   */
  onLinkHoverPresetIds?: (presetIds: string[] | null) => void;
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
  selectedGroupItemKeys,
  setSelectedGroupItemKeys,
  moveGroupItemsToUpperLevel,
  sidebarOpsAllowed,
  groupAssetForDrag,
  currentGroupAsset,
  duplicateAssetInPlace,
  removeAsset,
  removeGroupItems,
  setGroupFilterId,
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
  jumpToCapabilitySet,
  onDropPresetFromEditor,
  onDropPresetAction,
  topActionMode = 'asset',
  onComposeCapabilities,
  linkedComposeSearchQuery = '',
  onLinkHoverPresetIds,
}: WorkflowSidebarColumnProps) {
  const { rows: effectiveModelRows } = useEffectiveImageModelRows();
  const { rows: effectiveTextModelRows } = useEffectiveTextModelRows();
  const [groupOverrideByCategory, setGroupOverrideByCategory] = useState<
    Record<
      string,
      {
        enabled?: boolean;
        imageModelRegistryId?: string;
      /** @deprecated */
      imageGear?: CustomAppModule['imageGear'];
        textModelRegistryId?: string;
        imageAspectRatio?: string;
        imageSize?: string;
        understand?: boolean;
        generateCount?: number;
      }
    >
  >({});
  const [countCustomEditingByCategory, setCountCustomEditingByCategory] = useState<Record<string, boolean>>({});
  const [countCustomDraftByCategory, setCountCustomDraftByCategory] = useState<Record<string, string>>({});
  const [jumpFlashActionId, setJumpFlashActionId] = useState<string | null>(null);
  const jumpFlashTimerRef = useRef<number>();
  useEffect(
    () => () => {
      if (jumpFlashTimerRef.current) window.clearTimeout(jumpFlashTimerRef.current);
    },
    []
  );
  const flashSidebarLocate = useCallback((actionId: string) => {
    setJumpFlashActionId(actionId);
    if (jumpFlashTimerRef.current) window.clearTimeout(jumpFlashTimerRef.current);
    jumpFlashTimerRef.current = window.setTimeout(() => setJumpFlashActionId(null), 720) as unknown as number;
  }, []);
  const sidebarLocateFlashClass = useCallback(
    (actionId: string) => (jumpFlashActionId === actionId ? ' ac-workflow-capability-jump-flash' : ''),
    [jumpFlashActionId]
  );
  const onLocatePresetDoubleClick = useCallback(
    (mod: CustomAppModule, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      jumpToCapabilityPreset(mod);
      flashSidebarLocate(mod.id);
    },
    [jumpToCapabilityPreset, flashSidebarLocate]
  );
  const onLocateSetDoubleClick = useCallback(
    (set: CapabilitySet, e: React.MouseEvent) => {
      if (!jumpToCapabilitySet) return;
      e.preventDefault();
      e.stopPropagation();
      jumpToCapabilitySet(set.id);
      flashSidebarLocate(SET_ACTION_PREFIX + set.id);
    },
    [jumpToCapabilitySet, flashSidebarLocate]
  );
  const getGroupOverridesForCategory = (categoryId: string) => {
    const cfg = groupOverrideByCategory[categoryId];
    const countRaw = Number(cfg?.generateCount ?? 1);
    const generateCount = Number.isFinite(countRaw) ? Math.max(1, Math.floor(countRaw)) : 1;
    if (!cfg?.enabled && generateCount <= 1) return undefined;
    return {
      ...(cfg?.enabled
        ? {
            ...(cfg.imageModelRegistryId || cfg.imageGear
              ? {
                  imageModelRegistryId: cfg.imageModelRegistryId ?? cfg.imageGear,
                }
              : {}),
            ...(cfg.imageAspectRatio ? { imageAspectRatio: cfg.imageAspectRatio } : {}),
            ...(cfg.imageSize ? { imageSize: cfg.imageSize } : {}),
            ...(typeof cfg.understand === 'boolean' ? { understand: cfg.understand } : {}),
          }
        : {}),
      ...(cfg?.textModelRegistryId ? { textModelRegistryId: cfg.textModelRegistryId } : {}),
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
  const favoriteHasTextParamOptions = favoriteModuleEntries.some(
    (entry) => entry.mod.category === 'text_to_text' || entry.mod.category === 'image_to_text'
  );
  const favoriteCfg = groupOverrideByCategory[FAVORITE_GROUP_KEY] || {};
  const favoriteModelChanged = Boolean(favoriteCfg.imageModelRegistryId || favoriteCfg.imageGear);
  const favoriteTextModelChanged = Boolean(favoriteCfg.textModelRegistryId);
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
  const favoriteModelText = favoriteModelChanged
    ? labelForImageModelRegistryId(favoriteCfg.imageModelRegistryId ?? favoriteCfg.imageGear ?? '').slice(0, 2)
    : '模';
  const favoriteTextModelText = favoriteTextModelChanged
    ? labelForTextModelRegistryId(favoriteCfg.textModelRegistryId ?? '').slice(0, 2)
    : '文';
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
      const ids = group?.assetIds ?? [];
      draggingGroupItems.itemIndexes.forEach((idx) => {
        const childId = ids[idx];
        if (childId) {
          appendFromAsset(assets.find((a) => a.id === childId));
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
  /** 无收藏时默认收起占位区；有收藏时始终展开 */
  const [favoritesBodyExpanded, setFavoritesBodyExpanded] = useState(() => favoriteEntries.length > 0);
  const prevFavoriteCountRef = useRef<number | null>(null);
  useEffect(() => {
    const n = favoriteEntries.length;
    const prev = prevFavoriteCountRef.current;
    prevFavoriteCountRef.current = n;
    if (n > 0) {
      setFavoritesBodyExpanded(true);
    } else if (prev !== null && prev > 0 && n === 0) {
      setFavoritesBodyExpanded(false);
    }
  }, [favoriteEntries.length]);
  const showFavoritesDropBody = favoriteEntries.length > 0 || favoritesBodyExpanded;
  const [sidebarCapabilitySearch, setSidebarCapabilitySearch] = useState('');
  const linkedTrim = (typeof linkedComposeSearchQuery === 'string' ? linkedComposeSearchQuery : '').trim();
  const sidebarTrim = sidebarCapabilitySearch.trim();
  const rawForCapabilitySearch = linkedTrim.length > 0 ? linkedTrim : sidebarTrim;
  const capabilitySearchKeywords = useMemo(
    () => extractCapabilitySearchKeywords(rawForCapabilitySearch),
    [rawForCapabilitySearch]
  );
  const moduleMatchesSearch = useCallback(
    (mod: CustomAppModule) => {
      if (capabilitySearchKeywords.length === 0) return true;
      return keywordsMatchCapabilityModule(capabilitySearchKeywords, mod);
    },
    [capabilitySearchKeywords]
  );
  const linkedComposeActive = linkedTrim.length > 0;
  const setMatchesSearch = useCallback(
    (set: CapabilitySet) => {
      if (capabilitySearchKeywords.length === 0) return true;
      return keywordsMatchCapabilityLabelId(capabilitySearchKeywords, set.label, set.id);
    },
    [capabilitySearchKeywords]
  );
  const favoriteMatchesSearch = useCallback(
    (entry: WorkflowSidebarFavoriteEntry) => {
      if (capabilitySearchKeywords.length === 0) return true;
      return keywordsMatchCapabilityLabelId(capabilitySearchKeywords, entry.label, entry.id);
    },
    [capabilitySearchKeywords]
  );
  const filteredVisiblePresets = useMemo(
    () => visiblePresets.filter(moduleMatchesSearch),
    [visiblePresets, moduleMatchesSearch]
  );
  const filteredVisibleByCategory = useMemo(
    () =>
      visibleByCategory
        .map(({ category, list }) => ({
          category,
          list: list.filter(moduleMatchesSearch),
        }))
        .filter((g) => g.list.length > 0),
    [visibleByCategory, moduleMatchesSearch]
  );
  const filteredVisibleCapabilitySets = useMemo(
    () => visibleCapabilitySets.filter(setMatchesSearch),
    [visibleCapabilitySets, setMatchesSearch]
  );
  const filteredFavoriteEntries = useMemo(
    () => favoriteEntries.filter(favoriteMatchesSearch),
    [favoriteEntries, favoriteMatchesSearch]
  );
  /** 有检索词但无一命中时，列表回退为「全部」，避免空白 */
  const sidebarSearchFallbackAll =
    capabilitySearchKeywords.length > 0 &&
    (visiblePresets.length > 0 || visibleCapabilitySets.length > 0 || favoriteEntries.length > 0) &&
    filteredVisiblePresets.length === 0 &&
    filteredVisibleByCategory.length === 0 &&
    filteredVisibleCapabilitySets.length === 0 &&
    filteredFavoriteEntries.length === 0;
  const displayFavoriteEntries = sidebarSearchFallbackAll ? favoriteEntries : filteredFavoriteEntries;
  const displayVisibleByCategory = sidebarSearchFallbackAll ? visibleByCategory : filteredVisibleByCategory;
  const displayVisiblePresets = sidebarSearchFallbackAll ? visiblePresets : filteredVisiblePresets;
  const displayCapabilitySets = sidebarSearchFallbackAll ? visibleCapabilitySets : filteredVisibleCapabilitySets;
  const hasPresetEditorDragging = useCallback(() => {
    if (typeof window === 'undefined') return false;
    try {
      return Boolean((window as Window & { __acDraggingPresetId?: string | null }).__acDraggingPresetId);
    } catch {
      return false;
    }
  }, []);
  const isAnyDragActive = useCallback(() =>
    Boolean(draggingAssetIds?.length) ||
    Boolean(draggingGroupItems?.itemIndexes?.length) ||
    Boolean(draggingActionIdRef.current) ||
    hasPresetEditorDragging(), [draggingAssetIds, draggingGroupItems, draggingActionIdRef, hasPresetEditorDragging]);
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
  }, [draggingAssetIds, draggingGroupItems, draggingActionIdRef, isAnyDragActive]);
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
        target.scrollTo({ top: target.scrollTop + dy });
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
          ? `w-full min-h-0 flex-1 flex flex-col gap-2 overflow-hidden relative isolate ${WORKFLOW_EDGE_GUTTER}`
          : wide
            ? `w-full min-h-0 flex flex-col gap-2 overflow-hidden no-scrollbar shrink-0 max-h-[min(52vh,520px)] relative isolate ${WORKFLOW_EDGE_GUTTER}`
            : `w-80 shrink-0 min-h-0 flex-1 flex flex-col gap-2 overflow-hidden relative isolate ${WORKFLOW_EDGE_GUTTER}`
      }
    >
      <div className="sticky top-0 z-40 bg-gradient-to-b from-[#0b0b0d]/96 via-[#0b0b0d]/90 to-transparent pt-2 pb-1">
      {topActionMode === 'capabilityPreset' ? (
        <div className="grid grid-cols-5 gap-2" data-capability-preset-action-drop>
          {[
            {
              id: 'edit' as const,
              label: '编辑',
              title: '将能力预设拖到此处打开编辑',
              activeClass: SIDEBAR_TOP_DROP_ACTIVE_BLUE,
              idleClass: SIDEBAR_TOP_DROP_IDLE,
              iconClass: 'text-gray-300',
              textClass: 'text-gray-200',
              iconPath: 'M4 13.5V16h2.5l7.2-7.2-2.5-2.5L4 13.5zm10.7-6.8a.7.7 0 000-1L13.3 4.3a.7.7 0 00-1 0l-1.1 1.1 2.5 2.5 1-1.2z',
            },
            {
              id: 'copy' as const,
              label: '复制',
              title: '将能力预设拖到此处复制一份',
              activeClass: SIDEBAR_TOP_DROP_ACTIVE_BLUE,
              idleClass: SIDEBAR_TOP_DROP_IDLE,
              iconClass: 'text-gray-300',
              textClass: 'text-gray-200',
              iconPath: 'M6 6h9v10H6zM4 4h9v1H5v9H4z',
            },
            {
              id: 'delete' as const,
              label: '删除',
              title: '将能力预设拖到此处删除',
              activeClass: SIDEBAR_TOP_DROP_DELETE_ACTIVE,
              idleClass: SIDEBAR_TOP_DROP_DELETE_IDLE,
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
                className={`${dragOverAction === dragKey ? action.activeClass : action.idleClass} ${
                  enabled ? '' : 'opacity-60 cursor-not-allowed'
                }`}
              >
                <svg viewBox="0 0 20 20" className={`w-3 h-3 mb-0.5 ${action.iconClass}`} aria-hidden>
                  <path d={action.iconPath} fill="currentColor" />
                </svg>
                <span
                  className={`w-full max-w-full text-[8px] font-black uppercase break-words line-clamp-2 leading-tight ${action.textClass}`}
                >
                  {action.label}
                </span>
              </div>
            );
          })}
          {Array.from({ length: 2 }).map((_, idx) => (
            <div
              key={`capability-preset-action-placeholder-${idx}`}
              aria-hidden
              className="min-h-[52px] pointer-events-none opacity-0"
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
              // 如果当前在组视图中，使用 selectedGroupItemKeys 在组内创建嵌套组
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
                  // 组内成组
                  if (indexes.length === 2) {
                    createNestedGroupFromGroupItem(currentGroupAsset.id, indexes[0]);
                  } else {
                    // 多个资产成组：在当前组内创建嵌套组
                    setAssets((prev) => {
                      const group = prev.find((a) => a.id === currentGroupAsset.id);
                      if (!group || !isGroupAsset(group)) return prev;

                      const assetIds = indexes
                        .map((idx) => group.assetIds?.[idx])
                        .filter((id): id is string => !!id);

                      if (assetIds.length < 2) return prev;

                      const firstAsset = prev.find((a) => a.id === assetIds[0]);
                      const coverImage = firstAsset ? getAssetDisplayImage(firstAsset, prev) : '';
                      const newGroupId = uuid();
                      const usedLabels = new Set<string>(
                        prev.map((a) => a.groupLabel).filter((x): x is string => !!x)
                      );

                      const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
                        id: newGroupId,
                        isGroup: true,
                        original: coverImage,
                        displayKey: 'original',
                        results: {},
                        resultOrder: [],
                        assetIds,
                        groupId: currentGroupAsset.id, // 继承父组的 groupId，使其成为嵌套组
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

                      // 更新当前组：将选中的资产替换为嵌套组的引用
                      const parentAssetIds = [...(group.assetIds ?? [])];
                      indexes.sort((a, b) => b - a); // 降序删除
                      const removedIds: string[] = [];
                      for (const idx of indexes) {
                        removedIds.push(parentAssetIds[idx]);
                        parentAssetIds.splice(idx, 1);
                      }
                      // 在第一个被移除的位置插入嵌套组
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
              } else if (draggingAssetIds?.length) {
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
                      assetIds.includes(a.id) ? { ...a, groupId: newGroupId } : a
                    );
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
                      updated = updated.map((a, idx) =>
                        idx === parentGroupIdx ? { ...a, assetIds: keep } : a
                      );
                    }
                    const usedLabels = new Set<string>(
                      updated.map((a) => a.groupLabel).filter((x): x is string => !!x)
                    );
                    const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
                      id: newGroupId,
                      isGroup: true,
                      original: coverImage,
                      displayKey: 'original',
                      results: {},
                      resultOrder: [],
                      assetIds,
                      groupId: groupAssetId, // 继承父组的 groupId，使其成为嵌套组
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
              setDragOverAction(null);
              setDraggingAssetIds(null);
              setDraggingGroupItems(null);
            }}
            title="将选中图片拖入建组（组内同效）"
            className={
              dragOverAction === '__group__' ? SIDEBAR_TOP_DROP_ACTIVE_BLUE : SIDEBAR_TOP_DROP_IDLE
            }
          >
            <svg viewBox="0 0 20 20" className="w-3 h-3 text-gray-400 mb-0.5" aria-hidden>
              <path d="M3 4h6v5H3zM11 4h6v5h-6zM3 11h6v5H3zM11 11h6v5h-6z" fill="currentColor" />
            </svg>
            <span className="w-full max-w-full text-[8px] font-black uppercase text-gray-200 break-words line-clamp-2 leading-tight">
              组
            </span>
          </div>
          <div
            onDragOver={(e) => {
              if (!draggingGroupItems) return;
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
            className={
              dragOverAction === '__ungroup__' ? SIDEBAR_TOP_DROP_ACTIVE_BLUE : SIDEBAR_TOP_DROP_IDLE
            }
          >
            <svg viewBox="0 0 20 20" className="w-3 h-3 text-gray-400 mb-0.5" aria-hidden>
              <path d="M7 5h10v10H7zM3 9l4-4v3h5v2H7v3z" fill="currentColor" />
            </svg>
            <span className="w-full max-w-full text-[8px] font-black uppercase text-gray-200 break-words line-clamp-2 leading-tight">
              移出组
            </span>
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
                    const items = [...(g.assetIds ?? []), ...newIds];
                    next = next.map((a, i) => (i === gi ? { ...a, assetIds: items } : a));
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
            className={
              dragOverAction === '__copy__' ? SIDEBAR_TOP_DROP_ACTIVE_BLUE : SIDEBAR_TOP_DROP_IDLE
            }
          >
            <svg viewBox="0 0 20 20" className="w-3 h-3 text-gray-400 mb-0.5" aria-hidden>
              <path d="M6 6h9v10H6zM4 4h9v1H5v9H4z" fill="currentColor" />
            </svg>
            <span className="w-full max-w-full text-[8px] font-black uppercase text-gray-200 break-words line-clamp-2 leading-tight">
              复制
            </span>
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
                    setGroupFilterId(null);
                  }
                }
              }
              setDragOverAction(null);
              setDraggingAssetIds(null);
              setDraggingGroupItems(null);
            }}
            title="将图片拖到此处从工作流中删除（组内同效）"
            className={
              dragOverAction === '__delete__' ? SIDEBAR_TOP_DROP_DELETE_ACTIVE : SIDEBAR_TOP_DROP_DELETE_IDLE
            }
          >
            <svg viewBox="0 0 20 20" className="w-3 h-3 text-red-300 mb-0.5" aria-hidden>
              <path d="M6 6h8l-.6 10H6.6L6 6zm2-2h4l1 1h3v2H4V5h3l1-1z" fill="currentColor" />
            </svg>
            <span className="w-full max-w-full text-[8px] font-black uppercase text-red-400 break-words line-clamp-2 leading-tight">
              删除
            </span>
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
                    setGroupFilterId(null);
                  }
                }
              }
              setDragOverAction(null);
              setDraggingAssetIds(null);
              setDraggingGroupItems(null);
            }}
            title="将图片拖到此处标记为已完成（组内同效）"
            className={
              dragOverAction === '__archive__' ? SIDEBAR_TOP_DROP_ACTIVE_BLUE : SIDEBAR_TOP_DROP_IDLE
            }
          >
            <svg viewBox="0 0 20 20" className="w-3 h-3 text-gray-400 mb-0.5" aria-hidden>
              <path d="M4 4h12v3H4zM5 8h10v8H5zM8 10h4v2H8z" fill="currentColor" />
            </svg>
            <span className="w-full max-w-full text-[8px] font-black uppercase text-gray-200 break-words line-clamp-2 leading-tight">
              归档
            </span>
          </div>
          </div>
      )}
      <div className="mt-1.5">
        <label className="sr-only" htmlFor="workflow-sidebar-cap-search">
          搜索功能
        </label>
        <input
          id="workflow-sidebar-cap-search"
          type="search"
          value={sidebarCapabilitySearch}
          onChange={(e) => setSidebarCapabilitySearch(e.target.value)}
          placeholder="搜索功能…"
          autoComplete="off"
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[10px] text-gray-200 placeholder:text-gray-500 outline-none focus:border-blue-500/45 focus:ring-1 focus:ring-blue-500/30"
        />
        {linkedComposeActive ? (
          <p className="mt-0.5 text-[8px] text-gray-600 leading-tight">与底部快捷栏输入联动筛选；清空底部输入后恢复仅按上方搜索。</p>
        ) : null}
      </div>
      </div>
          {favoriteEntries.length > 0 || visiblePresets.length > 0 ? (
            <div className="shrink-0 space-y-1.5">
              <div className="space-y-1.5">
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
                  className={
                    dragOverAction === '__favorite_group_header__'
                      ? SIDEBAR_GROUP_HEADER_DROP
                      : `${SIDEBAR_GROUP_HEADER_IDLE} hover:bg-white/[0.07]`
                  }
                >
                  <span className="min-w-0 max-w-full text-[8px] font-black text-blue-300 uppercase tracking-wide break-words line-clamp-2 leading-tight">
                    常用功能
                  </span>
                  <div
                    className="min-w-0 w-full sm:w-auto sm:flex-1 flex flex-wrap items-center justify-end gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {favoriteEntries.length === 0 && !showFavoritesDropBody ? (
                      <>
                        <span
                          className="min-w-0 max-w-full flex-1 basis-[12rem] text-[8px] text-gray-500 break-words line-clamp-2 leading-tight text-left sm:text-right"
                          title="将能力卡拖到本行即可加入常用；展开后可在下方区域拖放"
                        >
                          拖到本行加入，或点展开
                        </span>
                        <button
                          type="button"
                          onClick={() => setFavoritesBodyExpanded(true)}
                          className="shrink-0 text-[8px] font-black text-blue-300/95 hover:text-blue-200 px-1.5 py-0.5 rounded-md ring-1 ring-inset ring-white/[0.08] bg-white/[0.03]"
                          title="展开常用功能区"
                          aria-expanded={showFavoritesDropBody}
                        >
                          展开
                        </button>
                      </>
                    ) : favoriteHasGenerateCountOptions ? (
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
                        {favoriteHasTextParamOptions ? (
                          <CustomDropdown
                            options={[
                              { value: '', label: '默认' },
                              ...effectiveTextModelRows.map((g) => ({
                                value: g.registryId,
                                label: g.label,
                                disabled: g.disabled,
                                title: g.disabledReason,
                              })),
                            ]}
                            value={groupOverrideByCategory[FAVORITE_GROUP_KEY]?.textModelRegistryId || ''}
                            onChange={(v) => {
                              if (v) {
                                const row = effectiveTextModelRows.find((g) => g.registryId === v);
                                if (row?.disabled) return;
                              }
                              setGroupOverrideByCategory((prev) => ({
                                ...prev,
                                [FAVORITE_GROUP_KEY]: {
                                  ...(prev[FAVORITE_GROUP_KEY] || {}),
                                  textModelRegistryId: v || undefined,
                                },
                              }));
                            }}
                            triggerClassName="p-0 w-6 h-6 inline-flex items-center justify-center bg-transparent border-0 rounded-none hover:bg-transparent align-middle"
                            renderTrigger={() => (
                              <span
                                title={
                                  favoriteTextModelChanged
                                    ? `文字模型：${labelForTextModelRegistryId(favoriteCfg.textModelRegistryId ?? '')}`
                                    : '文字模型：默认'
                                }
                                className={`w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${
                                  favoriteTextModelChanged
                                    ? 'border-emerald-500 text-emerald-300 bg-emerald-950/35'
                                    : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'
                                }`}
                              >
                                {favoriteTextModelText}
                              </span>
                            )}
                          />
                        ) : null}
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
                              options={[
                                { value: '', label: '默认' },
                                ...effectiveModelRows.map((g) => ({
                                  value: g.registryId,
                                  label: g.label,
                                  disabled: g.disabled,
                                  title: g.disabledReason,
                                })),
                              ]}
                              value={
                                groupOverrideByCategory[FAVORITE_GROUP_KEY]?.imageModelRegistryId ||
                                groupOverrideByCategory[FAVORITE_GROUP_KEY]?.imageGear ||
                                ''
                              }
                              onChange={(v) =>
                                setGroupOverrideByCategory((prev) => ({
                                  ...prev,
                                  [FAVORITE_GROUP_KEY]: {
                                    ...(prev[FAVORITE_GROUP_KEY] || {}),
                                    imageModelRegistryId: v || undefined,
                                    imageGear: undefined,
                                  },
                                }))
                              }
                              disabled={!groupOverrideByCategory[FAVORITE_GROUP_KEY]?.enabled}
                              triggerClassName="p-0 w-6 h-6 inline-flex items-center justify-center bg-transparent border-0 rounded-none hover:bg-transparent align-middle"
                              renderTrigger={() => (
                                <span
                                  title={
                                    favoriteModelChanged
                                      ? `模型：${labelForImageModelRegistryId(favoriteCfg.imageModelRegistryId ?? favoriteCfg.imageGear ?? '')}`
                                      : '模型：默认'
                                  }
                                  className={`w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${
                                    favoriteModelChanged
                                      ? 'border-blue-500 text-blue-300 bg-blue-950/35'
                                      : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'
                                  }`}
                                >
                                  {favoriteModelText}
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
                                setGroupOverrideByCategory((prev) => {
                                  const wasOn = prev[FAVORITE_GROUP_KEY]?.understand !== false;
                                  return {
                                    ...prev,
                                    [FAVORITE_GROUP_KEY]: {
                                      ...(prev[FAVORITE_GROUP_KEY] || {}),
                                      understand: wasOn ? false : true,
                                    },
                                  };
                                })
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
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[8px] text-gray-500">拖入收藏</span>
                        {favoriteEntries.length === 0 && favoritesBodyExpanded ? (
                          <button
                            type="button"
                            onClick={() => setFavoritesBodyExpanded(false)}
                            className="shrink-0 text-[8px] font-black text-gray-500 hover:text-gray-300 px-1 py-0.5 rounded-md ring-1 ring-inset ring-white/[0.06]"
                            title="收起常用功能占位区"
                            aria-expanded={showFavoritesDropBody}
                          >
                            收起
                          </button>
                        ) : null}
                      </span>
                    )}
                  </div>
                </div>
                {showFavoritesDropBody ? (
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
                    <div className={`text-[8px] text-center py-1 leading-tight ${favoriteDropActive ? 'text-blue-300' : 'text-gray-500'}`}>
                      拖拽能力卡到此处加入常用（也可拖到本区标题或分类标题）
                    </div>
                  ) : displayFavoriteEntries.length === 0 && capabilitySearchKeywords.length > 0 ? (
                    <div className="text-[8px] text-center py-2 leading-tight text-gray-500">无匹配的常用功能</div>
                  ) : (
                    <div className="grid grid-cols-5 gap-1.5">
                      {displayFavoriteEntries.map((entry) => {
                        const hasTweakSlot =
                          entry.kind === 'module' && entry.mod && capabilityUsesGenImageEngine(entry.mod);
                        return (
                        <div
                          key={`fav-${entry.id}`}
                          data-capability-hover-id={entry.kind === 'module' ? entry.mod?.id : undefined}
                          className={`rounded-xl border min-h-[52px] h-auto flex overflow-hidden transition-all duration-150${
                            sidebarLocateFlashClass(entry.id)
                          } ${
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
                            if (entry.kind === 'module' && entry.mod) {
                              setHoverPreview({ mod: entry.mod, x: e.clientX, y: e.clientY });
                              onLinkHoverPresetIds?.([entry.mod.id]);
                            } else if (entry.kind === 'set') {
                              const ids = collectPresetIdsFromCapabilitySet(entry.set);
                              onLinkHoverPresetIds?.(ids.length ? ids : null);
                            }
                          }}
                          onMouseMove={(e) => {
                            if (entry.kind !== 'module' || !entry.mod) return;
                            setHoverPreview((prev) =>
                              prev && prev.mod.id === entry.mod!.id
                                ? { ...prev, x: e.clientX, y: e.clientY }
                                : { mod: entry.mod, x: e.clientX, y: e.clientY }
                            );
                          }}
                          onMouseLeave={(e) => {
                            leaveSidebarRowLinkHover(e, onLinkHoverPresetIds);
                            if (entry.kind !== 'module' || !entry.mod) return;
                            const next = e.relatedTarget as Node | null;
                            if (next && e.currentTarget.contains(next)) return;
                            setHoverPreview((prev) => (prev?.mod.id === entry.mod!.id ? null : prev));
                          }}
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
                            className={`flex-1 px-1.5 py-1 flex flex-col items-center justify-center text-center min-w-0 transition-colors cursor-default ${
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
                            title={
                              entry.kind === 'module'
                                ? '双击定位左侧预设'
                                : entry.kind === 'set'
                                  ? '双击定位左侧能力集合'
                                  : undefined
                            }
                            onDoubleClick={(e) => {
                              if (entry.kind === 'module' && entry.mod) onLocatePresetDoubleClick(entry.mod, e);
                              else if (entry.kind === 'set' && entry.set) onLocateSetDoubleClick(entry.set, e);
                            }}
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
                            onMouseLeave={() =>
                              setHoverPreview((prev) =>
                                entry.kind === 'module' && entry.mod && prev?.mod.id === entry.mod.id ? null : prev
                              )
                            }
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
                            <span className="w-full min-w-0 text-[8px] leading-tight font-black uppercase break-words line-clamp-2 text-center">
                              {entry.label}
                            </span>
                          </div>
                          {hasTweakSlot && (
                            <div
                              className={`w-1/4 min-w-[1.75rem] shrink-0 flex flex-col items-center justify-center rounded-r-lg transition-colors cursor-pointer ${
                                dragOverAction === entry.id + '__tweak'
                                  ? 'bg-[#223d5c]'
                                  : 'bg-white/[0.05] hover:bg-white/[0.09]'
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
                ) : null}
              </div>
            </div>
          ) : null}

          <div ref={sidebarListScrollRef} className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
            {visiblePresets.length === 0 && visibleCapabilitySets.length === 0 && favoriteEntries.length === 0 && (
              <div className="rounded-xl border border-dashed border-[#3a3a40] p-4 text-center text-[9px] text-gray-500">
                暂无能力预设，请先在「能力」界面添加
              </div>
            )}

            {sidebarSearchFallbackAll && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-[9px] text-gray-400 leading-snug">
                未匹配关键词，已显示全部功能预设
              </div>
            )}

            {visiblePresets.length > 0 && (
            <div className="space-y-4">
              {displayVisibleByCategory.length > 0 ? (
                <>
              {displayVisibleByCategory.map(({ category, list }) => (
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
                    className={`mb-1 flex w-full flex-wrap items-center justify-between gap-x-1.5 gap-y-1 ${
                      dragOverAction === `__favorite_group_header__:${category.id}`
                        ? SIDEBAR_GROUP_HEADER_DROP
                        : `${SIDEBAR_GROUP_HEADER_IDLE} hover:bg-white/[0.07]`
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSectionCollapsed(`cat:${category.id}`)}
                      className="min-w-0 max-w-[min(100%,11rem)] shrink text-left inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wide text-gray-400 hover:text-gray-200 transition-colors"
                    >
                      <span className="min-w-0 break-words line-clamp-2 leading-tight">{category.label}</span>
                      <span className="shrink-0 text-[10px] text-gray-500">{collapsedSectionIds[`cat:${category.id}`] ? '▼' : '▲'}</span>
                    </button>
                    <div
                      className="min-w-0 w-full sm:w-auto sm:flex-1 flex flex-wrap items-center justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(() => {
                        const hasImageParamOptions = list.some((m) => capabilityUsesGenImageEngine(m));
                        const hasTextParamOptions =
                          category.id === 'text_to_text' || category.id === 'image_to_text';
                        const hasGenerateCountOptions =
                          hasImageParamOptions || category.id === 'text_to_text';
                        const cfg = groupOverrideByCategory[category.id] || {};
                        const modelChanged = Boolean(cfg.imageModelRegistryId || cfg.imageGear);
                        const textModelChanged = Boolean(cfg.textModelRegistryId);
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
                        const modelText = modelChanged
                          ? labelForImageModelRegistryId(cfg.imageModelRegistryId ?? cfg.imageGear ?? '').slice(0, 2)
                          : '模';
                        const textModelChipText = textModelChanged
                          ? labelForTextModelRegistryId(cfg.textModelRegistryId ?? '').slice(0, 2)
                          : '文';
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
                      {hasTextParamOptions ? (
                        <CustomDropdown
                          options={[
                            { value: '', label: '默认' },
                            ...effectiveTextModelRows.map((g) => ({
                              value: g.registryId,
                              label: g.label,
                              disabled: g.disabled,
                              title: g.disabledReason,
                            })),
                          ]}
                          value={groupOverrideByCategory[category.id]?.textModelRegistryId || ''}
                          onChange={(v) => {
                            if (v) {
                              const row = effectiveTextModelRows.find((g) => g.registryId === v);
                              if (row?.disabled) return;
                            }
                            setGroupOverrideByCategory((prev) => ({
                              ...prev,
                              [category.id]: {
                                ...(prev[category.id] || {}),
                                textModelRegistryId: v || undefined,
                              },
                            }));
                          }}
                          triggerClassName="p-0 w-6 h-6 inline-flex items-center justify-center bg-transparent border-0 rounded-none hover:bg-transparent align-middle"
                          renderTrigger={() => (
                            <span
                              title={
                                textModelChanged
                                  ? `文字模型：${labelForTextModelRegistryId(cfg.textModelRegistryId ?? '')}`
                                  : '文字模型：默认'
                              }
                              className={`w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${
                                textModelChanged
                                  ? 'border-emerald-500 text-emerald-300 bg-emerald-950/35'
                                  : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'
                              }`}
                            >
                              {textModelChipText}
                            </span>
                          )}
                        />
                      ) : null}
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
                            options={[
                                { value: '', label: '默认' },
                                ...effectiveModelRows.map((g) => ({
                                  value: g.registryId,
                                  label: g.label,
                                  disabled: g.disabled,
                                  title: g.disabledReason,
                                })),
                              ]}
                            value={
                              groupOverrideByCategory[category.id]?.imageModelRegistryId ||
                              groupOverrideByCategory[category.id]?.imageGear ||
                              ''
                            }
                            onChange={(v) =>
                              setGroupOverrideByCategory((prev) => ({
                                ...prev,
                                [category.id]: {
                                  ...(prev[category.id] || {}),
                                  imageModelRegistryId: v || undefined,
                                  imageGear: undefined,
                                },
                              }))
                            }
                            disabled={!groupOverrideByCategory[category.id]?.enabled}
                            triggerClassName="p-0 w-6 h-6 inline-flex items-center justify-center bg-transparent border-0 rounded-none hover:bg-transparent align-middle"
                            renderTrigger={() => (
                              <span
                                title={
                                  modelChanged
                                    ? `模型：${labelForImageModelRegistryId(cfg.imageModelRegistryId ?? cfg.imageGear ?? '')}`
                                    : '模型：默认'
                                }
                                className={`w-6 h-6 rounded-full border inline-flex items-center justify-center leading-none text-[9px] font-black ${
                                  modelChanged ? 'border-blue-500 text-blue-300 bg-blue-950/35' : 'border-[#3a3a40] text-gray-300 bg-[#1a1a20]'
                                }`}
                              >
                                {modelText}
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
                              setGroupOverrideByCategory((prev) => {
                                const wasOn = prev[category.id]?.understand !== false;
                                return {
                                  ...prev,
                                  [category.id]: {
                                    ...(prev[category.id] || {}),
                                    understand: wasOn ? false : true,
                                  },
                                };
                              })
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
                  <div className="grid grid-cols-2 gap-2 items-stretch">
                    {list.map((mod) => (
                      <div
                        key={mod.id}
                        data-capability-hover-id={mod.id}
                        className={`rounded-xl border min-h-[60px] h-auto flex overflow-hidden transition-all duration-150${sidebarLocateFlashClass(
                          mod.id
                        )} ${
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
                        onMouseEnter={(e) => {
                          setHoverPreview({ mod, x: e.clientX, y: e.clientY });
                          onLinkHoverPresetIds?.([mod.id]);
                        }}
                        onMouseMove={(e) =>
                          setHoverPreview((prev) =>
                            prev && prev.mod.id === mod.id
                              ? { ...prev, x: e.clientX, y: e.clientY }
                              : { mod, x: e.clientX, y: e.clientY }
                          )
                        }
                        onMouseLeave={(e) => {
                          leaveSidebarRowLinkHover(e, onLinkHoverPresetIds);
                          const next = e.relatedTarget as Node | null;
                          if (next && e.currentTarget.contains(next)) return;
                          setHoverPreview((prev) => (prev?.mod.id === mod.id ? null : prev));
                        }}
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
                          className={`flex-1 p-3 flex flex-col items-center justify-center text-center min-w-0 transition-colors cursor-default ${
                            capabilityUsesGenImageEngine(mod) ? `border-r ${getSidebarCapabilityTone(mod.category).dividerBorderClass}` : ''
                          } ${
                            dragOverAction === mod.id + '__tweak'
                              ? 'bg-[#121214]'
                              : dragOverAction === mod.id
                                ? 'bg-[#1a3354]'
                                : ''
                          }`}
                          title="双击定位左侧预设"
                          onDoubleClick={(e) => onLocatePresetDoubleClick(mod, e)}
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
                          <span className="w-full min-w-0 text-[9px] font-black uppercase break-words line-clamp-2 text-center leading-tight">
                            {mod.label}
                          </span>
                        </div>
                        {capabilityUsesGenImageEngine(mod) && (
                          <div
                            className={`w-11 shrink-0 flex flex-col items-center justify-center rounded-r-lg transition-colors cursor-pointer ${
                              dragOverAction === mod.id + '__tweak'
                                ? 'bg-[#223d5c]'
                                : 'bg-white/[0.05] hover:bg-white/[0.09]'
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
              ) : visibleByCategory.length === 0 ? (
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
                className={`w-full text-left mb-1.5 text-[8px] font-black uppercase tracking-wide text-gray-400 transition-colors ${
                  dragOverAction === '__favorite_group_header__:all-presets'
                    ? `${SIDEBAR_GROUP_HEADER_DROP} text-blue-200`
                    : `${SIDEBAR_GROUP_HEADER_IDLE} hover:bg-white/[0.07] hover:text-gray-200`
                }`}
              >
                <span>功能</span>
                <span className="text-[10px] text-gray-500">{collapsedSectionIds.__all_presets__ ? '▼' : '▲'}</span>
              </button>
              {!collapsedSectionIds.__all_presets__ && (
            <div className="grid grid-cols-2 gap-2 items-stretch">
              {displayVisiblePresets.map((mod) => (
                <div
                  key={mod.id}
                  data-capability-hover-id={mod.id}
                  className={`rounded-xl border min-h-[60px] h-auto flex overflow-hidden transition-all duration-150${sidebarLocateFlashClass(
                    mod.id
                  )} ${
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
                  onMouseEnter={(e) => {
                    setHoverPreview({ mod, x: e.clientX, y: e.clientY });
                    onLinkHoverPresetIds?.([mod.id]);
                  }}
                  onMouseMove={(e) =>
                    setHoverPreview((prev) =>
                      prev && prev.mod.id === mod.id
                        ? { ...prev, x: e.clientX, y: e.clientY }
                        : { mod, x: e.clientX, y: e.clientY }
                    )
                  }
                  onMouseLeave={(e) => {
                    leaveSidebarRowLinkHover(e, onLinkHoverPresetIds);
                    const next = e.relatedTarget as Node | null;
                    if (next && e.currentTarget.contains(next)) return;
                    setHoverPreview((prev) => (prev?.mod.id === mod.id ? null : prev));
                  }}
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
                    className={`flex-1 p-3 flex flex-col items-center justify-center text-center min-w-0 transition-colors cursor-default ${
                      capabilityUsesGenImageEngine(mod) ? `border-r ${getSidebarCapabilityTone(mod.category).dividerBorderClass}` : ''
                    } ${
                      dragOverAction === mod.id + '__tweak'
                        ? 'bg-[#121214]'
                        : dragOverAction === mod.id
                          ? 'bg-[#1a3354]'
                          : ''
                    }`}
                    title="双击定位左侧预设"
                    onDoubleClick={(e) => onLocatePresetDoubleClick(mod, e)}
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
                    <span className="w-full min-w-0 text-[9px] font-black uppercase break-words line-clamp-2 text-center leading-tight">
                      {mod.label}
                    </span>
                  </div>
                  {capabilityUsesGenImageEngine(mod) && (
                    <div
                      className={`w-11 shrink-0 flex flex-col items-center justify-center rounded-r-lg transition-colors cursor-pointer ${
                        dragOverAction === mod.id + '__tweak'
                          ? 'bg-[#223d5c]'
                          : 'bg-white/[0.05] hover:bg-white/[0.09]'
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
              ) : null}
            </div>
          )}

          {displayCapabilitySets.length > 0 && (
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
                className={`w-full text-left mb-1.5 text-[8px] font-black uppercase tracking-wide text-gray-400 transition-colors ${
                  dragOverAction === '__favorite_group_header__:sets'
                    ? `${SIDEBAR_GROUP_HEADER_DROP} text-blue-200`
                    : `${SIDEBAR_GROUP_HEADER_IDLE} hover:bg-white/[0.07] hover:text-gray-200`
                }`}
              >
                <span>复合能力</span>
                <span className="text-[10px] text-gray-500">{collapsedSectionIds.__capability_sets__ ? '▼' : '▲'}</span>
              </button>
              {!collapsedSectionIds.__capability_sets__ && (
              <div className="grid grid-cols-2 gap-2">
                {displayCapabilitySets.map((set) => {
                  const setActionId = SET_ACTION_PREFIX + set.id;
                  return (
                    <div
                      key={set.id}
                      title="双击定位左侧能力集合"
                      onDoubleClick={(e) => onLocateSetDoubleClick(set, e)}
                      draggable
                      onMouseEnter={() => {
                        const ids = collectPresetIdsFromCapabilitySet(set);
                        onLinkHoverPresetIds?.(ids.length ? ids : null);
                      }}
                      onMouseLeave={(e) => leaveSidebarRowLinkHover(e, onLinkHoverPresetIds)}
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
                      className={`rounded-xl border p-2.5 min-h-[60px] flex flex-col items-center justify-center text-center transition-all duration-150 cursor-default${sidebarLocateFlashClass(
                        setActionId
                      )} ${
                        dragOverAction === setActionId
                          ? DROP_TARGET_ACTIVE_CLASS
                          : isAssetPayloadDragging
                            ? DROP_TARGET_ELIGIBLE_CLASS
                            : `${getSidebarCapabilityTone('set').idleBorderClass} bg-[#1c1c22] ${getSidebarCapabilityTone('set').hoverBorderClass}`
                      }`}
                    >
                      <span className="w-full min-w-0 text-[9px] font-black uppercase text-gray-200 break-words line-clamp-2 text-center leading-tight">
                        {set.label}
                      </span>
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
