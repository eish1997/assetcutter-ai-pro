import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  useLayoutEffect,
  Suspense,
  lazy,
} from 'react';
import { useWorkflowWorkspacePanes } from '../hooks/useWorkflowWorkspacePanes';
import { useWorkflowMarquee } from '../hooks/useWorkflowMarquee';
import { createPortal, flushSync } from 'react-dom';
import type { WorkflowAsset, WorkflowPendingTask, CapabilitySet, VgpGenStepCapture } from '../types';
import type { CustomAppModule, LibraryItem } from '../types';
import type { BoundingBox } from '../types';
import { getRandomGroupCodeName } from '../data/groupCodeNames';
import { detectObjectsInImage, DEFAULT_PROMPTS } from '../services/geminiService';
import { normalizeApiErrorMessage } from '../services/geminiService';
import { getGeminiImageBatchBoxSizeForCurrentProvider } from '../services/geminiService';
import {
  executeCapability,
  executeCapabilitySet,
  getCapabilityEngine,
} from '../services/capabilityExecutor';
import {
  applyVgpAfterSuccessfulGen,
  attachInitialVgpToNewAsset,
} from '../services/vgp/vgpStore';
import { WorkflowGenerationRecordPanel } from './WorkflowGenerationRecordPanel';
import { triggerImageDownload } from '../services/imageDataUrl';
import { readLocalJson, scopedStorageKey, workflowFavoritesStorageKey, writeLocalJson } from '../services/clientPersist';
import {
  buildWorkflowImageTags,
  normalizeWorkflowTagMapToChinese,
  refineWorkflowImageTagsLowCost,
} from '../services/workflowImageTags';
import AppIcon from './ui/AppIcon';
import { ImagePreviewOverlay } from './ImagePreviewOverlay';
import { CustomDropdown } from './ui/CustomDropdown';
import { resolveCapabilityPreviewSrc } from '../services/capabilityPreviewUrl';
import { WorkflowCapabilityHoverPreview } from './WorkflowCapabilityHoverPreview';
import { WorkflowGridImage } from './ProgressivePreviewImage';
import WorkflowPixelBusyOverlay from './WorkflowPixelBusyOverlay';
import { workflowSafeImgSrc } from '../services/workflowImageDisplay';
import { previewSrcCacheFingerprint } from '../services/workflowImageThumb';
import {
  type AcWorkflowExportPayload,
  DT_AC_CAPABILITY_ACTION,
  DT_AC_CAPABILITY_ACTION_SOURCE,
  DT_AC_CAPABILITY_FROM_EDITOR,
  DT_AC_WORKFLOW_EXPORT,
  parseAcWorkflowExportDragSources,
  parseWorkflowDragSource,
  resolveCapabilityDropDragSources,
  workflowDragSourceAllowsSidebarOps,
  type WorkflowDragSource,
} from '../services/workflowDragPipeline';
import { WORKFLOW_CUT_DETECT_TIMEOUT_MS } from './workflow/workflowConstants';
import WorkflowTextLightboxCenter, {
  type WorkflowTextLightboxCenterHandle,
} from './workflow/WorkflowTextLightboxCenter';
import {
  buildComposerTextAssetThumbDataUrl,
  clampWorkflowTextBody,
  isWorkflowTextAsset,
  workflowAssetAllowedForCapabilityDrop,
  workflowAssetToInputText,
  workflowPresetAcceptsTextCardDrag,
  workflowTextAssetOutlineLabel,
} from '../services/workflowTextAsset';
import { uuid, baseActionId, makeVersionKey } from './workflow/workflowIds';
import {
  asWorkflowImageString,
  safeUnknownToString,
  collectImageLikeUrlsFromText,
  collectImageLikeUrlsFromHtml,
  dataTransferItemToString,
  cloneCapabilityPresetPanelWithScrollRef,
  cropBoxes,
} from './workflow/workflowSectionHelpers';
import { CutSelectModal, PromptTweakModal, ArchivedDetailModal, type PromptTweakTarget } from './workflow/modals';
import {
  SET_ACTION_PREFIX,
  TITLE_ROW_BTN_NEUTRAL,
  TITLE_ROW_BTN_ACTIVE,
  TITLE_ROW_BTN_PRIMARY,
  TITLE_ROW_STEPPER_SHELL,
  TITLE_ROW_STEPPER_VALUE,
  TITLE_ROW_STEPPER_BTN,
  TITLE_ROW_TAG_FILTER_INPUT,
  TITLE_ROW_QUEUE_CHIP,
  TITLE_ROW_DROPDOWN_TRIGGER,
  WORKFLOW_CARD_SURFACE_IDLE,
  WORKFLOW_META_PILL,
  WORKFLOW_EDGE_GUTTER,
  WORKFLOW_CHROME_BTN_NEUTRAL,
  WORKFLOW_TOPBAR_ICON_BTN,
  WORKFLOW_LIGHTBOX_TAB_IDLE,
  WORKFLOW_CARD_DISMISS_ICON_BTN,
} from './workflow/workflowSectionUiConstants';
import {
  sortRootWorkflowAssetsNewestFirst,
  workflowOutlineExpandableGroupIds,
} from './workflow/workflowOutlineUtils';
import {
  getGroupMemberIds,
  isGroupAsset,
  isGroupChildAsset,
} from '../services/groupHelpers';
import { isWorkflowEditableTarget } from './workflow/workflowDomUtils';
import {
  clampWorkflowCardAspectRatio,
  mergeCardAspectFromIntrinsic,
  persistWorkflowCardAspects,
  readSessionWorkflowCardAspects,
} from './workflow/workflowCardAspect';
import { groupCapabilityPresetsByCategory } from './workflow/workflowCapabilityGroups';
import { WorkflowSidebarColumn, type WorkflowSidebarFavoriteEntry } from './workflow/WorkflowSidebarColumn';
import WorkspaceQuickComposeBar from './WorkspaceQuickComposeBar';
import { buildWorkflowComposerSeedFromTwoPresets } from './workflow/buildWorkflowComposerSeed';
import type { CapabilityAssetCandidate } from './CapabilitySetCanvas';
import { BUILTIN_IMAGE_PROCESS_IDS } from '../services/capabilityPresetStore';
import {
  formatWorkflowModelPreviewLimitLabel,
  revokeWorkflowModelBlobUrlsAfterAssetRemoved,
  workflowLocalModelFileExceedsPreviewLimit,
} from '../services/workflowModelBlob';
import { captureWorkflowModelThumbnailDataUrl } from '../services/workflowModelPreviewCapture';
import { getCompanionLocalBaseUrl } from '../services/companionLocalPrefs';
import {
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  parseDataUrlToBlob,
  putWorkflowOriginalImageFromAnyUrl,
  putWorkflowOriginalImageToCompanion,
  putWorkflowResultImageToCompanion,
  resolveCapabilityInputImageForExecute,
  workflowAssetNeedsCompanionOriginalHydrate,
  workflowAssetNeedsCompanionResultHydrate,
} from '../services/workflowCompanionAssets';

const WORKFLOW_MODEL_EXT_RE = /\.(glb|gltf|fbx|obj)$/i;

type InsertManualGroupResult = {
  next: WorkflowAsset[];
  createdGroup: { id: string; coverImage: string } | null;
};

function isWorkflowModelFile(file: File): boolean {
  const name = file.name || '';
  if (WORKFLOW_MODEL_EXT_RE.test(name)) return true;
  const t = (file.type || '').toLowerCase();
  if (t === 'model/gltf-binary' || t.includes('gltf')) return true;
  return false;
}

function workflowModelItemLooksLikeModel(it: DataTransferItem): boolean {
  if (it.kind !== 'file') return false;
  const f = it.getAsFile();
  if (f && isWorkflowModelFile(f)) return true;
  const wk = it as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null };
  try {
    const ent = wk.webkitGetAsEntry?.();
    if (ent && ent.isFile) {
      return WORKFLOW_MODEL_EXT_RE.test((ent as FileSystemFileEntry).name || '');
    }
  } catch {
    /* ignore */
  }
  return false;
}

const WorkflowComposerOverlay = lazy(() => import('./WorkflowComposerOverlay'));

type WorkflowPendingTaskOptions = {
  promptOverride?: string;
  sourceGroupAssetId?: string;
  sourceItemIndex?: number;
  inputText?: string;
  overrideImageGear?: CustomAppModule['imageGear'];
  overrideImageAspectRatio?: string;
  overrideImageSize?: string;
  overrideSkipUnderstand?: boolean;
};

type WorkflowGroupOverrides = {
  imageGear?: CustomAppModule['imageGear'];
  imageAspectRatio?: string;
  imageSize?: string;
  understand?: boolean;
  generateCount?: number;
};

const WORKFLOW_GROUP_GENERATE_COUNT_HARD_MAX = 999;
const WORKFLOW_GROUP_GENERATE_CONFIRM_THRESHOLD = 20;
const CAPABILITY_PRESET_COLUMNS_KEY = 'ac_capability_preset_columns_v1';
const CAPABILITY_PRESET_COLUMNS_MIN = 2;
const CAPABILITY_PRESET_COLUMNS_MAX = 6;

type CapabilityPresetTypeFilter = 'all' | 'text_to_text' | 'text_to_image' | 'image_to_image' | 'image_to_text';
const CAPABILITY_PRESET_TYPE_FILTER_OPTIONS: Array<{ value: CapabilityPresetTypeFilter; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'text_to_text', label: '文生文' },
  { value: 'text_to_image', label: '文生图' },
  { value: 'image_to_image', label: '图生图' },
  { value: 'image_to_text', label: '图生文' },
];
const DRAG_SCROLL_EDGE_PX = 64;
const DRAG_SCROLL_MAX_STEP_PX = 28;

function normalizeWorkflowGenerateCount(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(WORKFLOW_GROUP_GENERATE_COUNT_HARD_MAX, n));
}

function normalizeCapabilityPresetColumnCount(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 6;
  return Math.max(CAPABILITY_PRESET_COLUMNS_MIN, Math.min(CAPABILITY_PRESET_COLUMNS_MAX, n));
}

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

function readCapabilityDragActionId(dataTransfer: DataTransfer | null): string | null {
  if (!dataTransfer) return null;
  let raw = '';
  try {
    raw =
      dataTransfer.getData(DT_AC_CAPABILITY_ACTION) ||
      dataTransfer.getData(DT_AC_CAPABILITY_FROM_EDITOR) ||
      dataTransfer.getData('text/plain') ||
      '';
  } catch {
    return null;
  }
  const id = raw.trim();
  return id || null;
}

function readCapabilityDragSource(dataTransfer: DataTransfer | null): string {
  if (!dataTransfer) return '';
  try {
    return (dataTransfer.getData(DT_AC_CAPABILITY_ACTION_SOURCE) || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

const WorkflowSection: React.FC<{
  capabilityPresets: CustomAppModule[];
  capabilitySets?: CapabilitySet[];
  assets: WorkflowAsset[];
  onAssetsChange: (value: React.SetStateAction<WorkflowAsset[]>) => void;
  pending: WorkflowPendingTask[];
  onPendingChange: (value: React.SetStateAction<WorkflowPendingTask[]>) => void;
  onOpenLibraryPicker?: (callback: (items: LibraryItem[]) => void) => void;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
  /** 拖图到「生成3D」能力时调用，不进入执行队列，直接提交 3D 任务 */
  onAddGenerate3DJob?: (
    preset: CustomAppModule,
    imageBase64: string,
    task?: WorkflowPendingTask,
    options?: { forceNewTask?: boolean }
  ) => Promise<void> | void;
  /** 用于按账号隔离常用功能偏好；未传时走 guest */
  preferenceScope?: string | null;
  /** 由 App 主滚动层注册，使列表两侧留白等网页空白处也能开始框选 */
  registerMarqueeStartHandler?: (handler: ((e: React.MouseEvent) => void) | null) => void;
  /** 由 App 主滚动层注册：左右留白区域滚轮可横向切页 */
  registerPaneWheelHandler?: (handler: ((e: React.WheelEvent) => void) | null) => void;
  /** 左侧「仓库」页：资产库条目（与弹窗导入同源） */
  libraryItems?: LibraryItem[];
  /** 大纲底部「放到仓库」：将选中工作区资产写入资产库（与 App 内 addToLibrary 同源） */
  onAddToLibrary?: (items: Partial<LibraryItem>[]) => void;
  /** 右侧「能力」页底部：能力预设编辑区（由 App 传入 Suspense 包裹的 CapabilityPresetSection） */
  capabilityPresetPanel?: React.ReactNode;
  /** 与能力页 `onUpdate` 同源：用于从工作区侧栏启用被禁用的预设并持久化 */
  onUpdateCapabilityPresets?: (next: CustomAppModule[]) => void;
  /** 与能力页 `onUpdateSets` 同源：工作流创建保存为复合能力 */
  onUpdateCapabilitySets?: (next: CapabilitySet[]) => void;
  /** 首次进入项目时的导览键（同一键仅执行一次横扫导览） */
  onboardingKey?: string | null;
  /** 顶栏左侧：返回项目列表 + 切换项目（位于 1–4 分档前）；不传则不渲染 */
  workspaceProjectChrome?: {
    projectOptions: Array<{ value: string; label: string }>;
    activeProjectId: string;
    activeProjectName: string;
    onBackToProjectList: () => void | Promise<void>;
    onSelectProject: (id: string) => void | Promise<void>;
  };
  /**
   * 底部快捷输入条用 portal 挂到 body，不受侧栏/模式容器 `hidden` 影响；需由 App 在「仅工作区模式」为 true，
   * 否则切到设置等页面时条仍会盖在最上层。
   */
  quickComposeShellActive?: boolean;
}> = ({
  capabilityPresets,
  capabilitySets: capabilitySetsProp = [],
  assets: assetsProp,
  onAssetsChange: setAssets,
  pending: pendingProp,
  onPendingChange: setPending,
  onOpenLibraryPicker,
  onLog,
  onAddGenerate3DJob,
  preferenceScope = null,
  registerMarqueeStartHandler,
  registerPaneWheelHandler,
  onAddToLibrary,
  capabilityPresetPanel,
  onUpdateCapabilityPresets,
  onUpdateCapabilitySets,
  onboardingKey = null,
  workspaceProjectChrome,
  quickComposeShellActive = true,
}) => {
  const assets = useMemo(() => (Array.isArray(assetsProp) ? assetsProp : []), [assetsProp]);
  const pending = useMemo(() => (Array.isArray(pendingProp) ? pendingProp : []), [pendingProp]);
  const capabilitySets = useMemo(
    () => (Array.isArray(capabilitySetsProp) ? capabilitySetsProp : []),
    [capabilitySetsProp]
  );
  const pendingRef = React.useRef(pending);
  pendingRef.current = pending;
  const assetsRef = React.useRef(assets);
  assetsRef.current = assets;
  const presets = useMemo(() => {
    const list = Array.isArray(capabilityPresets) ? capabilityPresets : [];
    return list
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => p.enabled !== false)
      .sort((a, b) => (a.p.order ?? a.idx) - (b.p.order ?? b.idx))
      .map(({ p }) => p);
  }, [capabilityPresets]);
  const actionModules: CustomAppModule[] = presets;
  const textAssetActionModules = useMemo(
    () => actionModules.filter((mod) => workflowPresetAcceptsTextCardDrag(mod)),
    [actionModules]
  );
  const byCategory = useMemo(() => groupCapabilityPresetsByCategory(presets), [presets]);
  const [columnCount, setColumnCount] = useState(4);
  const showArchived = false;
  const [archiveHint, setArchiveHint] = useState<{ assetId: string; ts: number } | null>(null);
  const [refiningTagKeys, setRefiningTagKeys] = useState<Set<string>>(new Set());
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const textLightboxCenterRef = useRef<WorkflowTextLightboxCenterHandle | null>(null);
  const [lightboxMetaText, setLightboxMetaText] = useState<string>('');
  /** 从组内网格打开大图时记录槽位，预设入队可带 sourceGroup* 与拖拽一致 */
  const [lightboxSourceSlot, setLightboxSourceSlot] = useState<{
    sourceGroupAssetId: string;
    sourceItemIndex: number;
  } | null>(null);
  const [archivedDetailAssetId, setArchivedDetailAssetId] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executingQueue, setExecutingQueue] = useState<{ total: number; tasks: WorkflowPendingTask[] } | null>(null);
  /** 并发执行中：已由 worker 取出、尚未结束的任务（用于卡片「执行中」与工具栏进度，避免误用单一 current 索引） */
  const [activeTaskIds, setActiveTaskIds] = useState<Set<string>>(() => new Set());
  /** 工作区队列执行能力集合时：逐步预览与阶段文案（按 assetId，与画布试运行一致） */
  const [capabilitySetRunByAssetId, setCapabilitySetRunByAssetId] = useState<
    Record<string, { taskId: string; progressLine: string; latestImage: string | null }>
  >({});
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(new Set());
  /** 批处理已开始后用户从卡片取消「排队中」项：worker 仍会从本地 queue shift，此处跳过执行 */
  const cancelledTaskIdsRef = useRef<Set<string>>(new Set());
  const [draggingAssetIds, setDraggingAssetIds] = useState<string[] | null>(null);
  const [dragOverAction, setDragOverAction] = useState<string | null>(null);
  /** 功能块拖拽 id（仅 ref，不用 state：dragover 首帧时 setState 尚未提交会导致未 preventDefault、drop 失败） */
  const draggingActionIdRef = useRef<string | null>(null);
  const updateDraggingActionId = useCallback((id: string | null) => {
    draggingActionIdRef.current = id;
  }, []);
  const [draggingActionFromFavorite, setDraggingActionFromFavorite] = useState(false);
  const [actionDroppedInFavorite, setActionDroppedInFavorite] = useState(false);
  const [favoriteDropActive, setFavoriteDropActive] = useState(false);
  type LocalComposerSession = { id: string; initialSet: CapabilitySet | null; sessionKey: number };
  const [composerSessions, setComposerSessions] = useState<LocalComposerSession[]>([]);
  const [composerActiveId, setComposerActiveId] = useState<string | null>(null);
  const [composerMinimized, setComposerMinimized] = useState<Record<string, boolean>>({});
  const composerActiveIdRef = useRef<string | null>(null);
  useEffect(() => {
    composerActiveIdRef.current = composerActiveId;
  }, [composerActiveId]);
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Record<string, boolean>>({});
  const [cutSelectState, setCutSelectState] = useState<{
    task: WorkflowPendingTask;
    inputImage: string;
    boxes: BoundingBox[];
    remaining: WorkflowPendingTask[];
  } | null>(null);
  const [promptTweakModal, setPromptTweakModal] = useState<{
    preset: CustomAppModule;
    targets: PromptTweakTarget[];
    overrides?: WorkflowGroupOverrides;
    mode?: 'replace' | 'append';
    initialText?: string;
    titleText?: string;
    helperText?: string;
    placeholderText?: string;
    requireNonEmpty?: boolean;
  } | null>(null);
  const [quickComposeDraft, setQuickComposeDraft] = useState('');
  const [quickComposeImage, setQuickComposeImage] = useState<string | null>(null);
  const [quickComposeActionId, setQuickComposeActionId] = useState('');
  const [showAllInGroup, setShowAllInGroup] = useState(false);
  /** 组筛选 ID：用于查看组内资产 */
  const [groupFilterId, setGroupFilterId] = useState<string | null>(null);
  const groupFilterIdRef = useRef(groupFilterId);
  groupFilterIdRef.current = groupFilterId;
  const [groupStringLightboxIndex, setGroupStringLightboxIndex] = useState<number | null>(null);
  const [draggingGroupItems, setDraggingGroupItems] = useState<{ groupAssetId: string; itemIndexes: number[] } | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [selectedGroupItemKeys, setSelectedGroupItemKeys] = useState<Set<string>>(new Set());
  const [capabilityPresetViewMode, setCapabilityPresetViewMode] = useState<'presets' | 'image_process' | 'sets'>('presets');
  const [capabilityPresetTypeFilter, setCapabilityPresetTypeFilter] = useState<CapabilityPresetTypeFilter>('all');
  const [capabilityPresetColumnCount, setCapabilityPresetColumnCount] = useState<number>(() =>
    readLocalJson<number>(CAPABILITY_PRESET_COLUMNS_KEY, 6, (parsed) =>
      typeof parsed === 'number' ? normalizeCapabilityPresetColumnCount(parsed) : null
    )
  );
  const [cardAspectByAssetId, setCardAspectByAssetId] = useState<Record<string, number>>(
    () => readSessionWorkflowCardAspects()
  );
  const [thumbUnlockKeys, setThumbUnlockKeys] = useState<Set<string>>(() => new Set());
  /** 当前视口内（严格 intersect）卡片：缩略解码队列 high，优先于屏外 */
  const [thumbHotKeys, setThumbHotKeys] = useState<Set<string>>(() => new Set());
  const thumbOnboardingRef = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const workspaceViewportRef = useRef<HTMLDivElement>(null);
  const workspaceTrackRef = useRef<HTMLDivElement>(null);
  const libraryScrollRef = useRef<HTMLDivElement>(null);
  const outlineScrollRef = useRef<HTMLDivElement>(null);
  /** 大纲：有 id 表示该组折叠子项；默认全展开 */
  const [outlineCollapsedIds, setOutlineCollapsedIds] = useState<Set<string>>(() => new Set());
  const centerScrollRef = useRef<HTMLDivElement>(null);
  const presetScrollRef = useRef<HTMLDivElement>(null);
  const [workspaceViewportWidth, setWorkspaceViewportWidth] = useState(0);
  const handleCenterWheelDuringDrag = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const hasPresetDrag = (() => {
      if (typeof window === 'undefined') return false;
      try {
        return Boolean((window as Window & { __acDraggingPresetId?: string | null }).__acDraggingPresetId);
      } catch {
        return false;
      }
    })();
    const isDragging =
      Boolean(draggingAssetIds?.length) ||
      Boolean(draggingGroupItems?.itemIndexes?.length) ||
      Boolean(draggingActionIdRef.current) ||
      hasPresetDrag;
    if (!isDragging) return;
    const dy = normalizeWheelDeltaY(e);
    if (!Number.isFinite(dy) || Math.abs(dy) < 0.1) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).scrollTop += dy;
  }, [draggingAssetIds, draggingGroupItems]);
  useEffect(() => {
    const el = centerScrollRef.current;
    if (!el) return;
    const onWheelNative = (ev: WheelEvent) => {
      // React onWheelCapture 已处理时避免重复滚动
      if (ev.defaultPrevented) return;
      const hasPresetDrag = (() => {
        if (typeof window === 'undefined') return false;
        try {
          return Boolean((window as Window & { __acDraggingPresetId?: string | null }).__acDraggingPresetId);
        } catch {
          return false;
        }
      })();
      const isDragging =
        Boolean(draggingAssetIds?.length) ||
        Boolean(draggingGroupItems?.itemIndexes?.length) ||
        Boolean(draggingActionIdRef.current) ||
        hasPresetDrag;
      if (!isDragging) return;
      let dy = ev.deltaY;
      if (Math.abs(ev.deltaX) > Math.abs(dy)) dy = ev.deltaX;
      if (ev.deltaMode === 1) dy *= 16;
      if (ev.deltaMode === 2) dy *= 120;
      if (!Number.isFinite(dy) || Math.abs(dy) < 0.1) return;
      ev.preventDefault();
      ev.stopPropagation();
      el.scrollTop += dy;
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheelNative);
    };
  }, [draggingAssetIds, draggingGroupItems]);

  useLayoutEffect(() => {
    const key = onboardingKey ?? '';
    if (thumbOnboardingRef.current === null) {
      thumbOnboardingRef.current = key;
      return;
    }
    if (thumbOnboardingRef.current !== key) {
      thumbOnboardingRef.current = key;
      setThumbUnlockKeys(new Set());
      setThumbHotKeys(new Set());
    }
  }, [onboardingKey]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      persistWorkflowCardAspects(cardAspectByAssetId);
    }, 400);
    return () => window.clearTimeout(t);
  }, [cardAspectByAssetId]);

  useLayoutEffect(() => {
    const el = workspaceViewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setWorkspaceViewportWidth(el.clientWidth || 0);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setAssets]);
  const sidebarWidth = 320;
  const paneWidth = Math.max(320, workspaceViewportWidth || 0);
  const listPaneWidth = Math.max(320, paneWidth - sidebarWidth);
  const presetPaneWidth = listPaneWidth;
  const trackTotalWidth = listPaneWidth + sidebarWidth + listPaneWidth + sidebarWidth + presetPaneWidth;
  const marqueeStartRef = useRef(false);
  const {
    workspacePane,
    setWorkspacePane,
    snapWorkspacePaneToNode,
    handlePaneWheel,
    spacePanEnabled,
    spacePanDragging,
    suppressClickAfterPanRef,
    workspaceViewportTouchHandlers,
  } = useWorkflowWorkspacePanes({
    workspaceTrackRef,
    registerPaneWheelHandler,
    listPaneWidth,
    sidebarWidth,
    marqueeStartRef,
  });
  /** 从功能区「词」进入能力页：横向滑到能力列并滚动到对应预设卡片 */
  const jumpToCapabilityPreset = useCallback((preset: CustomAppModule) => {
    const mode: 'presets' | 'image_process' =
      preset.category === 'image_to_image' && getCapabilityEngine(preset) === 'builtin' ? 'image_process' : 'presets';
    setCapabilityPresetViewMode(mode);
    if (typeof window !== 'undefined') {
      const emitJump = () => {
        window.dispatchEvent(new CustomEvent('ac:capability-preset-view-mode', { detail: { mode } }));
        window.dispatchEvent(new CustomEvent('ac:capability-jump-to-preset', { detail: { presetId: preset.id } }));
      };
      emitJump();
      window.requestAnimationFrame(emitJump);
      window.setTimeout(emitJump, 220);
    }
    snapWorkspacePaneToNode(3);
  }, [snapWorkspacePaneToNode]);
  /** 大纲底部拖入区高亮 */
  const [outlineFooterDropOver, setOutlineFooterDropOver] = useState<'toWorkspace' | 'toLibrary' | null>(null);
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'library' | 'archived'>('all');
  const [libraryTagQuery, setLibraryTagQuery] = useState('');
  const [repositoryOutlineMode, setRepositoryOutlineMode] = useState<'list' | 'tags'>('list');
  const [repositorySelectedTags, setRepositorySelectedTags] = useState<Set<string>>(new Set());
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const libraryCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const setSelectedRootAssetIds = useCallback<React.Dispatch<React.SetStateAction<Set<string>>>>(
    (value) => {
      setSelectedAssetIds((prev) => {
        const resolved = typeof value === 'function' ? value(prev) : value;
        const next = new Set<string>();
        resolved.forEach((id) => {
          const asset = assetsRef.current.find((x) => x.id === id);
          if (!isGroupAsset(asset)) {
            next.add(id);
          }
        });
        if (next.size === prev.size) {
          let unchanged = true;
          next.forEach((id) => {
            if (!prev.has(id)) unchanged = false;
          });
          if (unchanged) return prev;
        }
        return next;
      });
    },
    []
  );
  const {
    marqueeActive,
    marqueeOverlayElRef,
    marqueePaneRef,
  } = useWorkflowMarquee({
    registerMarqueeStartHandler,
    showArchived,
    workspacePane,
    marqueeStartRef,
    libraryCardRefs,
    cardRefs,
    pendingRef,
    groupFilterIdRef,
    setSelectedAssetIds,
    setSelectedGroupItemKeys,
  });

  const toggleOutlineGroupCollapsed = useCallback((groupId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOutlineCollapsedIds((prev) => {
      const n = new Set(prev);
      if (n.has(groupId)) n.delete(groupId);
      else n.add(groupId);
      return n;
    });
  }, []);

  const navigateOutlineToAsset = useCallback(
    (asset: WorkflowAsset) => {
      if (asset.isGroup === true) {
        setGroupFilterId(asset.id);
        setSelectedGroupItemKeys(new Set());
        setSelectedRootAssetIds(new Set());
        return;
      }
      // 如果资产属于某个组，先进入该组
      if (asset.groupId) {
        const group = assets.find((a) => a.id === asset.groupId);
        if (group) {
          setGroupFilterId(group.id);
        }
      }
      setSelectedGroupItemKeys(new Set());
      setSelectedRootAssetIds(new Set([asset.id]));
      requestAnimationFrame(() => {
        cardRefs.current.get(asset.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    },
    [assets, setSelectedRootAssetIds]
  );

  const navigateOutlineToGroupItem = useCallback(
    (group: WorkflowAsset, itemIndex: number) => {
      // 进入组视图
      setGroupFilterId(group.id);
      setSelectedRootAssetIds(new Set());
      setSelectedGroupItemKeys(new Set([`${group.id}::${itemIndex}`]));
      requestAnimationFrame(() => {
        cardRefs.current.get(`${group.id}::${itemIndex}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    },
    [setSelectedRootAssetIds]
  );

  const [dragOverAssetId, setDragOverAssetId] = useState<string | null>(null);
  const [dragOverGroupItemKey, setDragOverGroupItemKey] = useState<string | null>(null);
  const [assetErrors, setAssetErrors] = useState<Map<string, string>>(new Map());
  const [groupPreviewIndexById, setGroupPreviewIndexById] = useState<Record<string, number>>({});
  const [groupBounceStateById, setGroupBounceStateById] = useState<Record<string, 'idle' | 'up' | 'down'>>({});
  const [hoverPreview, setHoverPreview] = useState<{ mod: CustomAppModule; x: number; y: number } | null>(null);

  const setAssetError = useCallback((assetId: string, message: string | null) => {
    setAssetErrors((prev) => {
      const next = new Map(prev);
      if (!message) {
        next.delete(assetId);
      } else {
        next.set(assetId, message);
      }
      return next;
    });
  }, []);

  const getModule = useCallback((id: string) => actionModules.find((m) => m.id === id), [actionModules]);
  const getModulePreviewOriginal = useCallback(
    (mod: CustomAppModule): string | null =>
      resolveCapabilityPreviewSrc(mod.previewOriginalThumbImage) ||
      resolveCapabilityPreviewSrc(mod.previewOriginalImage) ||
      resolveCapabilityPreviewSrc(mod.previewImage) ||
      null,
    []
  );
  const getModulePreviewGenerated = useCallback(
    (mod: CustomAppModule): string | null =>
      resolveCapabilityPreviewSrc(mod.previewGeneratedThumbImage) ||
      resolveCapabilityPreviewSrc(mod.previewGeneratedImage) ||
      resolveCapabilityPreviewSrc(mod.previewImage) ||
      null,
    []
  );
  useEffect(() => {
    if (!hoverPreview || typeof window === 'undefined' || typeof document === 'undefined') return;
    const targetId = hoverPreview.mod.id;
    const onMove = (ev: MouseEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      if (!el) {
        setHoverPreview(null);
        return;
      }
      const holder = el.closest(`[data-capability-hover-id="${targetId}"]`);
      if (!holder) setHoverPreview(null);
    };
    const onBlur = () => setHoverPreview(null);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [hoverPreview]);
  const getSet = useCallback((id: string) => capabilitySets.find((s) => s.id === id), [capabilitySets]);
  const getActionLabel = useCallback((actionType: string) => {
    if (actionType.startsWith(SET_ACTION_PREFIX)) {
      const set = getSet(actionType.slice(SET_ACTION_PREFIX.length));
      return set?.label ?? actionType;
    }
    return getModule(actionType)?.label ?? actionType;
  }, [getModule, getSet]);
  const getGenerationRecordStepLabel = (stepKey: string) => {
    if (stepKey === 'original') return '原图';
    if (stepKey === 'cut_image') return '切割';
    if (stepKey.startsWith(SET_ACTION_PREFIX)) {
      const s = getSet(stepKey.slice(SET_ACTION_PREFIX.length));
      return s?.label ?? stepKey;
    }
    return getModule(baseActionId(stepKey))?.label ?? stepKey;
  };
  const getAssetDisplayImage = useCallback((
    a: WorkflowAsset,
    _assetsList?: WorkflowAsset[],
    _visited?: Set<string>
  ): string => {
    const orig = asWorkflowImageString(a.original);
    if (isWorkflowTextAsset(a)) {
      if (a.displayKey === 'original') return orig;
      const fromResults = (a.results as Record<string, unknown>)[a.displayKey];
      return asWorkflowImageString(fromResults) || orig;
    }
    if (a.displayKey === 'original') return orig;
    const fromResults = (a.results as Record<string, unknown>)[a.displayKey];
    return asWorkflowImageString(fromResults) || orig;
  }, []);

  const companionHydrateKey = useMemo(() => {
    return assets
      .filter(workflowAssetNeedsCompanionOriginalHydrate)
      .map((a) => `${a.id}:${String(a.originalCompanionKey || '').trim()}`)
      .sort()
      .join('|');
  }, [assets]);

  const companionResultsHydrateKey = useMemo(() => {
    const parts: string[] = [];
    for (const a of assets) {
      if (!workflowAssetNeedsCompanionResultHydrate(a)) continue;
      const rck = a.resultsCompanionKeys || {};
      for (const sid of Object.keys(rck)) {
        const ck = String(rck[sid] || '').trim();
        if (!ck || String(a.results?.[sid] ?? '').trim()) continue;
        parts.push(`${a.id}:${sid}:${ck}`);
      }
    }
    return parts.sort().join('|');
  }, [assets]);

  useEffect(() => {
    const projectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
    const base = String(getCompanionLocalBaseUrl() || '').trim();
    if (!companionHydrateKey || !projectId || !base) return;
    const targets = assetsRef.current.filter(workflowAssetNeedsCompanionOriginalHydrate);
    if (targets.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const a of targets) {
        const key = String(a.originalCompanionKey || '').trim();
        if (!key) continue;
        const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, projectId, key);
        if (cancelled) return;
        if (got.ok === false) {
          onLog?.('warn', '本地伴侣原图恢复失败', `${a.id}: ${got.error}`);
          continue;
        }
        setAssets((prev) =>
          prev.map((x) => {
            if (x.id !== a.id) return x;
            const prevO = String(x.original || '').trim();
            if (/^blob:/i.test(prevO)) {
              try {
                URL.revokeObjectURL(prevO);
              } catch {
                /* ignore */
              }
            }
            return { ...x, original: got.objectUrl };
          })
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companionHydrateKey, workspaceProjectChrome?.activeProjectId, setAssets, onLog]);

  useEffect(() => {
    const projectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
    const base = String(getCompanionLocalBaseUrl() || '').trim();
    if (!companionResultsHydrateKey || !projectId || !base) return;
    const targets = assetsRef.current.filter(workflowAssetNeedsCompanionResultHydrate);
    if (targets.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const a of targets) {
        const rck = a.resultsCompanionKeys || {};
        for (const stepId of Object.keys(rck)) {
          const ck = String(rck[stepId] || '').trim();
          if (!ck || String(a.results?.[stepId] ?? '').trim()) continue;
          const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, projectId, ck);
          if (cancelled) return;
          if (got.ok === false) {
            onLog?.('warn', '本地伴侣步骤结果图恢复失败', `${a.id}/${stepId}: ${got.error}`);
            continue;
          }
          setAssets((prev) =>
            prev.map((x) => {
              if (x.id !== a.id) return x;
              const prevV = String((x.results || {})[stepId] || '').trim();
              if (/^blob:/i.test(prevV)) {
                try {
                  URL.revokeObjectURL(prevV);
                } catch {
                  /* ignore */
                }
              }
              return {
                ...x,
                results: { ...(x.results || {}), [stepId]: got.objectUrl },
              };
            })
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companionResultsHydrateKey, workspaceProjectChrome?.activeProjectId, setAssets, onLog]);

  const scheduleCompanionPersistOriginal = useCallback(
    (assetId: string, imageDataUrl: string) => {
      if (!parseDataUrlToBlob(imageDataUrl)) return;
      const base = String(getCompanionLocalBaseUrl() || '').trim();
      const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
      if (!base || !pid) return;
      void (async () => {
        const put = await putWorkflowOriginalImageToCompanion(base, pid, assetId, imageDataUrl);
        if (put.ok === false) {
          onLog?.('warn', '本地伴侣原图落盘失败（画布仍在内存）', put.error);
          return;
        }
        setAssets((prev) =>
          prev.some((x) => x.id === assetId)
            ? prev.map((x) => (x.id === assetId ? { ...x, originalCompanionKey: put.key } : x))
            : prev
        );
      })();
    },
    [onLog, setAssets, workspaceProjectChrome?.activeProjectId]
  );

  /** data / blob / http / 旧版裸 base64 → 伴侣原图键；data: 走同步路径 */
  const scheduleCompanionPersistOriginalAny = useCallback(
    (assetId: string, imageSrc: string) => {
      const s = String(imageSrc || '').trim();
      if (!s) return;
      const base = String(getCompanionLocalBaseUrl() || '').trim();
      const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
      if (!base || !pid) return;
      if (parseDataUrlToBlob(s)) {
        scheduleCompanionPersistOriginal(assetId, s);
        return;
      }
      void (async () => {
        const put = await putWorkflowOriginalImageFromAnyUrl(base, pid, assetId, s);
        if (put.ok === false) {
          onLog?.('warn', '本地伴侣原图落盘失败（画布仍在内存）', put.error);
          return;
        }
        setAssets((prev) =>
          prev.some((x) => x.id === assetId)
            ? prev.map((x) => (x.id === assetId ? { ...x, originalCompanionKey: put.key } : x))
            : prev
        );
      })();
    },
    [onLog, scheduleCompanionPersistOriginal, setAssets, workspaceProjectChrome?.activeProjectId]
  );

  const scheduleCompanionPersistResult = useCallback(
    (assetId: string, resultKey: string, imageDataUrl: string) => {
      if (!parseDataUrlToBlob(imageDataUrl)) return;
      const base = String(getCompanionLocalBaseUrl() || '').trim();
      const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
      if (!base || !pid) return;
      void (async () => {
        const put = await putWorkflowResultImageToCompanion(base, pid, assetId, resultKey, imageDataUrl);
        if (put.ok === false) {
          onLog?.('warn', '本地伴侣步骤结果落盘失败（画布仍在内存）', put.error);
          return;
        }
        setAssets((prev) =>
          prev.some((x) => x.id === assetId)
            ? prev.map((x) =>
                x.id === assetId
                  ? { ...x, resultsCompanionKeys: { ...(x.resultsCompanionKeys || {}), [resultKey]: put.key } }
                  : x
              )
            : prev
        );
      })();
    },
    [onLog, setAssets, workspaceProjectChrome?.activeProjectId]
  );

  const getAssetDisplayText = useCallback((a: WorkflowAsset): string => {
    if (!isWorkflowTextAsset(a)) return '';
    if (a.displayKey === 'original') return (a.textBody ?? '').trim();
    return ((a.textResults || {})[a.displayKey] ?? '').trim();
  }, []);
  const getAssetDisplayTypeLabel = (a: WorkflowAsset): string => {
    if (isWorkflowTextAsset(a)) {
      const dk = (a.displayKey || 'original').trim() || 'original';
      if (dk !== 'original') {
        const img = asWorkflowImageString((a.results as Record<string, unknown>)[dk]).trim();
        if (img && !img.includes('image/svg+xml')) {
          if (dk === 'cut_image') return '切割';
          const baseId = baseActionId(dk);
          return getModule(baseId)?.label ?? baseId;
        }
      }
      return '文字';
    }
    if ((a.modelUrls?.length ?? 0) > 0 && a.displayKey === 'original') return '3D 模型';
    if (a.displayKey === 'original') return '原始';
    if (a.displayKey === 'cut_image') return '切割';
    const baseId = baseActionId(a.displayKey);
    return getModule(baseId)?.label ?? baseId;
  };
  const buildTextLightboxPreviewDataUrl = useCallback((titleRaw: string, bodyRaw: string): string => {
    const esc = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const title = esc((titleRaw || '').trim() || '文本资产');
    const body = esc((bodyRaw || '').trim() || '（空白内容）');
    const lines = body.split(/\r?\n/).filter(Boolean).slice(0, 14);
    const lineSvg = lines
      .map((line, i) => `<text x="64" y="${228 + i * 46}" fill="#a3b3d6" font-size="30">${line}</text>`)
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#111827"/>
    <stop offset="100%" stop-color="#0b1220"/>
  </linearGradient>
</defs>
<rect width="1600" height="1000" fill="url(#bg)"/>
<rect x="48" y="48" width="1504" height="904" rx="32" fill="#121826" stroke="#30466e" stroke-width="2"/>
<text x="64" y="136" fill="#60a5fa" font-size="24" font-weight="700">文本预览</text>
<text x="64" y="188" fill="#f8fafc" font-size="42" font-weight="700">${title}</text>
${lineSvg}
</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, []);
  const buildWorkflowModelPlaceholderDataUrl = useCallback((fileNameRaw: string): string => {
    const esc = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const base = esc((fileNameRaw || '').trim() || 'model.bin');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
<defs>
  <linearGradient id="wfm" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#0f172a"/>
    <stop offset="100%" stop-color="#020617"/>
  </linearGradient>
</defs>
<rect width="1600" height="1000" fill="url(#wfm)"/>
<rect x="48" y="48" width="1504" height="904" rx="32" fill="#111827" stroke="#38bdf8" stroke-width="2" stroke-opacity="0.35"/>
<text x="64" y="136" fill="#38bdf8" font-size="24" font-weight="700">3D 模型</text>
<text x="64" y="228" fill="#f8fafc" font-size="34" font-weight="600">本地预览</text>
<text x="64" y="296" fill="#94a3b8" font-size="26">${base}</text>
</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, []);
  const getLightboxPreviewImageSrc = useCallback((asset: WorkflowAsset): string => {
    const display = getAssetDisplayImage(asset).trim();
    if (display) return workflowSafeImgSrc(display);
    return buildTextLightboxPreviewDataUrl(asset.textTitle || '', getAssetDisplayText(asset));
  }, [buildTextLightboxPreviewDataUrl, getAssetDisplayImage, getAssetDisplayText]);
  const repositoryItems = useMemo<WorkflowAsset[]>(() => {
    const q = libraryTagQuery.trim().toLowerCase();
    const base = assets.filter((a) => {
      if (isGroupChildAsset(a)) return false;
      if (!a.inRepository) return false;
      if (libraryFilter === 'library') return !a.archived;
      if (libraryFilter === 'archived') return !!a.archived;
      return true;
    });
    if (!q) return base;
    const words = q.split(/\s+/).filter(Boolean);
    return base.filter((item) => {
      const tags = (item.imageTags?.[item.displayKey] || []).join(' ');
      const hay = `${item.groupLabel || ''} ${tags} ${getAssetDisplayText(item)}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [assets, libraryFilter, libraryTagQuery, getAssetDisplayText]);
  useEffect(() => {
    setAssets((prev) => {
      let changed = false;
      const next = prev.map((a) => {
        const { next: normalized, changed: tagChanged } = normalizeWorkflowTagMapToChinese(a.imageTags);
        if (!tagChanged) return a;
        changed = true;
        return { ...a, imageTags: normalized };
      });
      return changed ? next : prev;
    });
  }, [setAssets]);
  const repositoryTagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    repositoryItems.forEach((item) => {
      const tags = item.imageTags?.[item.displayKey] || [];
      tags.forEach((tag) => {
        const t = tag.trim();
        if (!t) return;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      });
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [repositoryItems]);
  const repositoryVisibleItems = useMemo(() => {
    if (repositorySelectedTags.size === 0) return repositoryItems;
    const selected = [...repositorySelectedTags];
    return repositoryItems.filter((item) => {
      const tags = new Set((item.imageTags?.[item.displayKey] || []).filter(Boolean));
      return selected.every((tag) => tags.has(tag));
    });
  }, [repositoryItems, repositorySelectedTags]);
  const buildPendingTaskFromAssetSnapshot = useCallback(
    (
      asset: WorkflowAsset,
      targetAssetId: string,
      actionType: string,
      options?: WorkflowPendingTaskOptions
    ): WorkflowPendingTask | null => {
      const mod =
        actionModules.find((m) => m.id === actionType) ??
        capabilityPresets.find((p) => p.id === actionType);
      const inputImage = getAssetDisplayImage(asset);
      if (isWorkflowTextAsset(asset)) {
        const textPresetOk = mod && workflowPresetAcceptsTextCardDrag(mod);
        const textRasterOk =
          mod &&
          !workflowPresetAcceptsTextCardDrag(mod) &&
          workflowAssetAllowedForCapabilityDrop(asset, mod) &&
          inputImage.trim() !== '';
        if (!mod || (!textPresetOk && !textRasterOk)) {
          onLog?.(
            'warn',
            '文字资产请拖入文生文/文生图类能力；若已对正文做过文生图，请将卡片切换到该图版本后再拖入图生图、图像处理、图生文等'
          );
          return null;
        }
      }
      const inputTextFromCard =
        options?.inputText ??
        (isWorkflowTextAsset(asset) ? workflowAssetToInputText(asset) : undefined);
      const fromGroup =
        options?.sourceGroupAssetId != null && options?.sourceItemIndex != null;
      const task: WorkflowPendingTask = {
        id: uuid(),
        assetId: targetAssetId,
        actionType,
        inputImage,
        addedAt: Date.now(),
        inputSourceDisplayKey: asset.displayKey,
        ...(options?.promptOverride != null ? { promptOverride: options.promptOverride } : {}),
        ...(options?.overrideImageGear ? { overrideImageGear: options.overrideImageGear } : {}),
        ...(options?.overrideImageAspectRatio ? { overrideImageAspectRatio: options.overrideImageAspectRatio } : {}),
        ...(options?.overrideImageSize ? { overrideImageSize: options.overrideImageSize } : {}),
        ...(typeof options?.overrideSkipUnderstand === 'boolean'
          ? { overrideSkipUnderstand: options.overrideSkipUnderstand }
          : {}),
        ...(inputTextFromCard != null && String(inputTextFromCard).trim() !== ''
          ? { inputText: String(inputTextFromCard).trim() }
          : {}),
        ...(fromGroup
          ? {
              sourceGroupAssetId: options!.sourceGroupAssetId,
              sourceItemIndex: options!.sourceItemIndex,
            }
          : {}),
      };
      return task;
    },
    [getAssetDisplayImage, onLog, actionModules, capabilityPresets]
  );

  const makePendingTaskForAsset = useCallback(
    (assetId: string, actionType: string, options?: WorkflowPendingTaskOptions): WorkflowPendingTask | null => {
      const asset = assets.find((x) => x.id === assetId);
      if (!asset) return null;
      return buildPendingTaskFromAssetSnapshot(asset, assetId, actionType, options);
    },
    [assets, buildPendingTaskFromAssetSnapshot]
  );

  const addToPending = useCallback(
    (assetId: string, actionType: string, options?: WorkflowPendingTaskOptions) => {
      const task = makePendingTaskForAsset(assetId, actionType, options);
      if (task) setPending((prev) => [...prev, task]);
    },
    [makePendingTaskForAsset, setPending]
  );

  const addWorkflowTextAsset = useCallback((initialText?: string) => {
    const raw = (initialText || '').trim();
    const id = uuid();
    const next = attachInitialVgpToNewAsset({
      id,
      original: '',
      displayKey: 'original',
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      createdAt: Date.now(),
      assetKind: 'text',
      textTitle: '',
      textBody: raw ? clampWorkflowTextBody(raw) : '',
    });
    setAssets((prev) => [...prev, next]);
    setLightboxAssetId(id);
    onLog?.('info', raw ? '已粘贴为文字资产' : '已添加文字资产');
  }, [onLog, setAssets]);

  const addTasksToPending = useCallback((tasks: WorkflowPendingTask[]) => {
    if (tasks.length === 0) return;
    setPending((prev) => [...prev, ...tasks]);
  }, [setPending]);

  const _removeFromPending = useCallback((taskId: string) => {
    const task = pending.find((t) => t.id === taskId);
    setPending((prev) => prev.filter((t) => t.id !== taskId));
    if (task) {
      setAssets((prev) => prev.map((x) => (x.id === task.assetId ? { ...x, hiddenInGrid: false } : x)));
    }
  }, [pending, setAssets, setPending]);

  const runTask = useCallback(async (
    task: WorkflowPendingTask,
    batchGroup?: { key: string; expected: number }
  ): Promise<{ image: string | null; text?: string; vgpSteps?: VgpGenStepCapture[] }> => {
    const { actionType, inputImage, inputText } = task;
    let resolvedInputImage = inputImage ?? '';
    const inputTrimmed = String(resolvedInputImage).trim();
    if (inputTrimmed) {
      const companionProjectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
      const companionBaseUrl = String(getCompanionLocalBaseUrl() || '').trim();
      const assetForInput = assetsRef.current.find((a) => a.id === task.assetId) ?? null;
      const resolvedImg = await resolveCapabilityInputImageForExecute({
        inputImage: inputTrimmed,
        asset: assetForInput,
        sourceDisplayKey: task.inputSourceDisplayKey,
        companionBaseUrl,
        companionProjectId,
      });
      if (resolvedImg.ok === false) {
        const al = getActionLabel(actionType);
        const msg = `[${al}] ${resolvedImg.error}`;
        onLog?.('warn', msg);
        setAssetError(task.assetId, msg);
        return { image: null };
      }
      resolvedInputImage = resolvedImg.dataUrl;
    }

    if (actionType.startsWith(SET_ACTION_PREFIX)) {
      const set = getSet(actionType.slice(SET_ACTION_PREFIX.length));
      if (!set) {
        const msg = `[${getActionLabel(actionType)}] 能力集合不存在`;
        onLog?.('warn', msg);
        setAssetError(task.assetId, msg);
        return { image: null };
      }
      const assetId = task.assetId;
      const clearSetRunUi = () => {
        setCapabilitySetRunByAssetId((prev) => {
          const cur = prev[assetId];
          if (cur?.taskId !== task.id) return prev;
          const next = { ...prev };
          delete next[assetId];
          return next;
        });
      };
      setCapabilitySetRunByAssetId((prev) => ({
        ...prev,
        [assetId]: {
          taskId: task.id,
          progressLine: '准备执行能力集合…',
          latestImage: null,
        },
      }));
      try {
        const result = await executeCapabilitySet(set, resolvedInputImage ?? '', {
          presets: actionModules,
          companionProjectId: workspaceProjectChrome?.activeProjectId?.trim() || undefined,
          onLog,
          onRunProgress: (line) => {
            setCapabilitySetRunByAssetId((prev) => {
              const cur = prev[assetId];
              if (cur?.taskId !== task.id) return prev;
              return { ...prev, [assetId]: { ...cur, progressLine: line } };
            });
          },
          onNodeImageOutput: (_nodeId, image) => {
            setCapabilitySetRunByAssetId((prev) => {
              const cur = prev[assetId];
              if (cur?.taskId !== task.id) return prev;
              return { ...prev, [assetId]: { ...cur, latestImage: image } };
            });
          },
        });
        if (result.ok === false) {
          const msg = `[${getActionLabel(actionType)}] ${result.error}`;
          onLog?.('warn', msg);
          setAssetError(task.assetId, msg);
          return { image: null };
        }
        setAssetError(task.assetId, null);
        if (result.kind === 'text') {
          return { image: null, text: result.text };
        }
        return result.kind === 'image'
          ? { image: result.image, vgpSteps: result.vgpSteps }
          : { image: null };
      } finally {
        clearSetRunUi();
      }
    }
    const module = getModule(actionType);
    if (module?.category === 'generate_3d') {
      if (!onAddGenerate3DJob) {
        const msg = '未配置 3D 执行器，无法提交生成3D任务';
        onLog?.('warn', msg);
        setAssetError(task.assetId, msg);
        return { image: null };
      }
      if (!resolvedInputImage?.trim()) {
        const msg = '生成3D 需要图片输入';
        onLog?.('warn', msg);
        setAssetError(task.assetId, msg);
        return { image: null };
      }
      try {
        await onAddGenerate3DJob(module, resolvedInputImage, task);
        setAssetError(task.assetId, null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : safeUnknownToString(err);
        const full = `[${getActionLabel(actionType)}] ${msg}`;
        onLog?.('error', full);
        setAssetError(task.assetId, full);
      }
      return { image: null };
    }
    const actionLabel = getActionLabel(actionType);
    try {
      if (module) {
        const presetBase =
          task.promptOverride != null && task.promptOverride.trim() !== ''
            ? { ...module, instruction: task.promptOverride.trim() }
            : module;
        const preset = {
          ...presetBase,
          ...(task.overrideImageGear ? { imageGear: task.overrideImageGear } : {}),
          ...(task.overrideImageAspectRatio ? { imageAspectRatio: task.overrideImageAspectRatio } : {}),
          ...(task.overrideImageSize ? { imageSize: task.overrideImageSize } : {}),
          ...(typeof task.overrideSkipUnderstand === 'boolean'
            ? { skipUnderstand: !task.overrideSkipUnderstand }
            : {}),
        };
        const out = await executeCapability(
          preset,
          resolvedInputImage ?? '',
          {
            onLog,
            companionProjectId: workspaceProjectChrome?.activeProjectId?.trim() || undefined,
          },
          {
            inputText,
            ...(batchGroup ? { batchGroupKey: batchGroup.key, batchGroupExpected: batchGroup.expected } : {}),
          }
        );
        if (out.ok === false) {
          const msg = `[${actionLabel}] ${out.error}`;
          onLog?.('warn', msg);
          setAssetError(task.assetId, msg);
          return { image: null };
        }
        setAssetError(task.assetId, null);
        if (out.kind === 'text') {
          return { image: null, text: out.text };
        }
        return { image: out.image, vgpSteps: out.vgpSteps };
      }
      if (actionType === 'cut_image') {
        return { image: null };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : safeUnknownToString(err);
      const full = `[${actionLabel}] 失败：${msg}`;
      onLog?.('error', full, msg);
      setAssetError(task.assetId, full);
      return { image: null };
    }
    const fallbackMsg = `[${actionLabel}] 未能获得结果（请重试或检查配置）`;
    setAssetError(task.assetId, fallbackMsg);
    return { image: null };
  }, [
    actionModules,
    getActionLabel,
    getModule,
    getSet,
    onAddGenerate3DJob,
    onLog,
    setAssetError,
    workspaceProjectChrome?.activeProjectId,
  ]);
  const runTaskRef = useRef(runTask);
  useEffect(() => {
    runTaskRef.current = runTask;
  }, [runTask]);

  /** 替换组内某项为另一个资产 */
  const replaceGroupItemWithSubAsset = useCallback((groupAssetId: string, itemIndex: number, subAssetId: string) => {
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== groupAssetId) return a;
        if (!isGroupAsset(a)) return a;
        const next = [...(a.assetIds ?? [])];
        if (itemIndex >= 0 && itemIndex < next.length) next[itemIndex] = subAssetId;
        return { ...a, assetIds: next };
      })
    );
  }, [setAssets]);

  /** 将组内多个成员移到组外（脱离组） */
  const moveGroupItemsToUpperLevel = useCallback(
    (groupAssetId: string, itemIndexes: number[]) => {
      if (itemIndexes.length === 0) return;
      setAssets((prev) => {
        const groupIdx = prev.findIndex((a) => a.id === groupAssetId);
        if (groupIdx === -1) return prev;
        const group = prev[groupIdx];
        if (!isGroupAsset(group)) return prev;

        const dedupIndexes = Array.from(new Set(itemIndexes)).filter((i) => i >= 0 && i < (group.assetIds?.length ?? 0));
        if (dedupIndexes.length === 0) return prev;

        const indexSet = new Set(dedupIndexes);
        const childIds = dedupIndexes.map((i) => group.assetIds![i]).filter(Boolean);

        // 从组中移除这些成员
        const nextAssetIds = (group.assetIds ?? []).filter((_, i) => !indexSet.has(i));

        let next = prev.map((a, i) => {
          if (i === groupIdx) {
            return { ...a, assetIds: nextAssetIds.length ? nextAssetIds : undefined };
          }
          return a;
        });

        // 如果组变空，移除组
        if (nextAssetIds.length === 0) {
          next = next.filter((a) => a.id !== groupAssetId);
        }

        // 将子资产移出组
        next = next.map((a) => {
          if (childIds.includes(a.id)) {
            return { ...a, groupId: undefined, groupLabel: undefined, groupOrder: undefined };
          }
          return a;
        });

        return next;
      });
      setGroupFilterId(null);
      setSelectedGroupItemKeys((prev) => {
        const next = new Set(prev);
        next.forEach((key) => {
          if (String(key).startsWith(`${groupAssetId}::`)) next.delete(key);
        });
        return next;
      });
    },
    [setAssets, setGroupFilterId]
  );

  const moveGroupItemToUpperLevel = useCallback(
    (groupAssetId: string, itemIndex: number) => {
      moveGroupItemsToUpperLevel(groupAssetId, [itemIndex]);
    },
    [moveGroupItemsToUpperLevel]
  );

  const _removeFromGroup = useCallback(
    (groupAssetId: string, itemIndex: number) => {
      moveGroupItemToUpperLevel(groupAssetId, itemIndex);
    },
    [moveGroupItemToUpperLevel]
  );

  const BASE_MAX_CONCURRENCY = 3;

  const executePending = useCallback(
    async (overridePending?: WorkflowPendingTask[]) => {
      const queue = overridePending ? [...overridePending] : [...pendingRef.current];
      // 允许在 cut_image 弹窗确认后用 overridePending 继续执行剩余任务
      if (queue.length === 0 || (executing && !overridePending)) return;
      // 新一轮批处理前清空已完成任务标记；本批快照已写入 queue，始终清空 pending（含递归续跑），避免完成后仍误判「在队列内」
      setCompletedTaskIds(new Set());
      cancelledTaskIdsRef.current = new Set();
      setPending([]);
      setActiveTaskIds(new Set());
      setExecuting(true);
      setExecutingQueue({ total: queue.length, tasks: [...queue] });
      const imageBatchWorkers = getGeminiImageBatchBoxSizeForCurrentProvider();
      onLog?.('info', `开始执行队列（${queue.length} 项，常规并发 ${BASE_MAX_CONCURRENCY}，生图理解并发 ${imageBatchWorkers}）`);

      const total = queue.length;
      const logBatch = `[${total}项·常规≤${BASE_MAX_CONCURRENCY}/生图理解≤${imageBatchWorkers}]`;

      const processTask = async (
        task: WorkflowPendingTask,
        batchGroup?: { key: string; expected: number }
      ) => {
        if (cancelledTaskIdsRef.current.has(task.id)) {
          return;
        }
        setActiveTaskIds((prev) => new Set(prev).add(task.id));
        try {
          const taskLabel = getActionLabel(task.actionType);

          if (task.actionType === 'cut_image') {
            onLog?.('info', `${logBatch} ${taskLabel} 识别并切割中…`);
            let inputImage =
              task.inputImage || assetsRef.current.find((a) => a.id === task.assetId)?.original;
            if (!inputImage || typeof inputImage !== 'string') {
              const msg = `[${taskLabel}] 找不到输入图片，已跳过此任务`;
              onLog?.('warn', msg);
              setAssetError(task.assetId, msg);
              setCompletedTaskIds((prev) => { const next = new Set(prev); next.add(task.id); return next; });
            } else {
              if (!inputImage.startsWith('data:')) {
                const fromAsset = assetsRef.current.find((a) => a.id === task.assetId)?.original;
                if (fromAsset && fromAsset.startsWith('data:')) inputImage = fromAsset;
                else {
                  const msg = `[${taskLabel}] 输入图不是 data URL，尝试使用原图`;
                  onLog?.('warn', msg);
                  setAssetError(task.assetId, msg);
                }
              }
              let boxes: BoundingBox[] = [];
              try {
                boxes = await detectObjectsInImage(
                  inputImage,
                  'gemini-3-flash-preview',
                  DEFAULT_PROMPTS.detect_blocks,
                  { timeoutMs: WORKFLOW_CUT_DETECT_TIMEOUT_MS }
                );
              } catch (e) {
                const msg = e instanceof Error ? e.message : safeUnknownToString(e);
                const full = `[${taskLabel}] 区域识别超时或失败（${msg}），将整图作为一块裁剪`;
                onLog?.('warn', full);
                setAssetError(task.assetId, full);
              }
              if (!boxes.length) {
                boxes = [{ id: 'full', label: '整图', xmin: 0, ymin: 0, xmax: 1000, ymax: 1000 }];
              }
              const cutPreset = getModule(task.actionType);
              const cutOverflowPx =
                task.actionType === 'cut_image' && cutPreset?.cutOverflowPx != null && Number.isFinite(cutPreset.cutOverflowPx)
                  ? Math.max(0, Math.min(512, Math.round(cutPreset.cutOverflowPx)))
                  : 0;
              const allIndexes = boxes.map((_, j) => j);
              let cropped = await cropBoxes(inputImage, boxes, allIndexes, cutOverflowPx);
              if (cropped.length === 0 && boxes.length > 0) {
                const msg = `[${taskLabel}] 裁剪失败，尝试整图`;
                onLog?.('warn', msg);
                setAssetError(task.assetId, msg);
                cropped = await cropBoxes(
                  inputImage,
                  [{ id: 'full', label: '整图', xmin: 0, ymin: 0, xmax: 1000, ymax: 1000 }],
                  [0],
                  cutOverflowPx
                );
              }
              if (cropped.length === 0) {
                const msg = `[${taskLabel}] 未能生成裁剪图（请检查图片格式或重试）`;
                onLog?.('warn', msg);
                setAssetError(task.assetId, msg);
              } else {
                setAssetError(task.assetId, null);
              }
              setAssets((prev) => {
                const taskAsset = prev.find((x) => x.id === task.assetId);
                if (!taskAsset) return prev;
                const base = taskAsset.original;
                const imagesToAdd: string[] = base ? [base, ...cropped] : cropped;
                const newAssets: WorkflowAsset[] = imagesToAdd.map((original) =>
                  attachInitialVgpToNewAsset({
                    id: uuid(),
                    original,
                    displayKey: 'original',
                    results: {},
                    resultOrder: [],
                    archived: false,
                    hiddenInGrid: false,
                    createdAt: Date.now(),
                  })
                );
                const assetIds = newAssets.map((x) => x.id);
                const usedLabels = new Set<string>(prev.map((a) => a.groupLabel).filter((x): x is string => !!x));
                const groupId = uuid();
                const groupLabel = getRandomGroupCodeName(usedLabels);

                const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
                  id: groupId,
                  isGroup: true,
                  original: taskAsset.original,
                  displayKey: 'original',
                  results: {},
                  resultOrder: [],
                  assetIds,
                  groupLabel,
                  archived: false,
                  hiddenInGrid: false,
                  createdAt: Date.now(),
                });

                const next = [
                  ...prev.filter((a) => a.id !== task.assetId),
                  ...newAssets.map((a) => ({ ...a, groupId, groupLabel, groupOrder: assetIds.indexOf(a.id) })),
                  newGroup,
                ];

                revokeWorkflowModelBlobUrlsAfterAssetRemoved(taskAsset, next);
                return next;
              });

              if (task.sourceGroupAssetId != null && task.sourceItemIndex != null) {
                replaceGroupItemWithSubAsset(task.sourceGroupAssetId, task.sourceItemIndex, task.assetId);
              }

              onLog?.('info', `${logBatch} ${taskLabel} 完成（${cropped.length} 张入组）`);
              setCompletedTaskIds((prev) => {
                const next = new Set(prev);
                next.add(task.id);
                return next;
              });
            }
          } else {
            onLog?.('info', `${logBatch} ${taskLabel} 执行中…`);
            const { image: result, text: textResult, vgpSteps } = await runTaskRef.current(task, batchGroup);
            if (textResult != null && textResult !== '') {
              setAssets((prev) =>
                prev.map((a) => {
                  if (a.id !== task.assetId) return a;
                  const baseId = task.actionType;
                  const hasAnyText = Object.keys(a.textResults || {}).some((k) => baseActionId(k) === baseId);
                  const tKey = hasAnyText ? makeVersionKey(baseId) : baseId;
                  const nextOrder = [...(a.resultOrder || []), tKey];
                  const nextMeta = { ...(a.resultMeta || {}), [tKey]: { executedAt: Date.now() } };
                  const next: WorkflowAsset = {
                    ...a,
                    textResults: { ...(a.textResults || {}), [tKey]: textResult },
                    resultOrder: nextOrder,
                    resultMeta: nextMeta,
                    displayKey: tKey,
                    hiddenInGrid: a.groupId ? a.hiddenInGrid : false,
                  };
                  return next;
                })
              );
            } else {
              flushSync(() => {
                setAssets((prev) =>
                  prev.map((a) => {
                    if (a.id !== task.assetId) return a;
                    const baseId = task.actionType;
                    const hasAnyVersion =
                      Object.keys(a.results || {}).some((k) => baseActionId(k) === baseId) ||
                      (a.resultOrder || []).some((k) => baseActionId(k) === baseId);
                    const key = result ? (hasAnyVersion ? makeVersionKey(baseId) : baseId) : baseId;
                    const nextResults = result ? { ...a.results, [key]: result } : a.results;
                    const nextOrder = result ? [...(a.resultOrder || []), key] : a.resultOrder || [];
                    const nextMeta = { ...(a.resultMeta || {}), [key]: { executedAt: Date.now() } };
                    const tagList =
                      result
                        ? buildWorkflowImageTags({
                            actionLabel: getActionLabel(task.actionType),
                            actionId: baseActionId(task.actionType),
                            presetInstruction: getModule(task.actionType)?.instruction,
                            promptOverride: task.promptOverride,
                            inputText: task.inputText,
                          })
                        : [];
                    let next: WorkflowAsset = {
                      ...a,
                      results: nextResults,
                      resultOrder: nextOrder,
                      resultMeta: nextMeta,
                      ...(result
                        ? {
                            imageTags: { ...(a.imageTags || {}), [key]: tagList },
                            imageTagStage: { ...(a.imageTagStage || {}), [key]: 'coarse' as const },
                          }
                        : {}),
                      displayKey: result ? key : a.displayKey,
                      hiddenInGrid: a.groupId ? a.hiddenInGrid : false,
                    };
                    if (result) {
                      const hadOverride = task.promptOverride != null && task.promptOverride.trim() !== '';
                      const summaryLabel = getActionLabel(task.actionType);
                      next = applyVgpAfterSuccessfulGen(next, {
                        resultKey: key,
                        vgpSteps: vgpSteps ?? [],
                        semanticSummary: hadOverride ? `${summaryLabel}（用户微调）` : summaryLabel,
                        hadPromptOverride: hadOverride,
                        inputSourceDisplayKey: task.inputSourceDisplayKey,
                      });
                    }
                    return next;
                  })
                );
              });
              const after = assetsRef.current.find((x) => x.id === task.assetId);
              if (
                after &&
                result &&
                parseDataUrlToBlob(result) &&
                !isWorkflowTextAsset(after)
              ) {
                const order = after.resultOrder || [];
                const lastKey = order[order.length - 1];
                if (lastKey && String(after.results?.[lastKey] || '') === String(result)) {
                  scheduleCompanionPersistResult(task.assetId, lastKey, result);
                }
              }
              setCompletedTaskIds((prev) => {
                const next = new Set(prev);
                next.add(task.id);
                return next;
              });
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : safeUnknownToString(e);
          const label = getActionLabel(task.actionType);
          onLog?.('error', `${logBatch} ${label} 失败：${msg}`);
          setAssetError(task.assetId, msg);
          setCompletedTaskIds((prev) => new Set(prev).add(task.id));
        } finally {
          setActiveTaskIds((prev) => {
            const next = new Set(prev);
            next.delete(task.id);
            return next;
          });
        }
      };

      try {
        for (let i = 0; i < queue.length;) {
          const leadTask = queue[i];
          const leadTaskIsGenImage = (() => {
            if (!leadTask || leadTask.actionType === 'cut_image' || leadTask.actionType.startsWith(SET_ACTION_PREFIX)) {
              return false;
            }
            const mod = getModule(leadTask.actionType);
            return !!mod && getCapabilityEngine(mod) === 'gen_image';
          })();
          const chunkSize = leadTaskIsGenImage ? imageBatchWorkers : BASE_MAX_CONCURRENCY;
          const chunk = queue.slice(i, i + chunkSize);
          const genImageTasks = chunk.filter((task) => {
            if (task.actionType === 'cut_image' || task.actionType.startsWith(SET_ACTION_PREFIX)) return false;
            const mod = getModule(task.actionType);
            return !!mod && getCapabilityEngine(mod) === 'gen_image';
          });
          const batchGroup =
            genImageTasks.length > 1
              ? { key: `wf-batch-${Date.now()}-${i}`, expected: genImageTasks.length }
              : undefined;
          await Promise.all(
            chunk.map((task) =>
              processTask(
                task,
                batchGroup &&
                  genImageTasks.some((x) => x.id === task.id)
                  ? batchGroup
                  : undefined
              )
            )
          );
          i += chunk.length;
        }
        onLog?.('info', '队列执行完成');
      } catch (e) {
        const msg = e instanceof Error ? e.message : safeUnknownToString(e);
        onLog?.('error', `队列执行异常：${msg}`);
      } finally {
        cancelledTaskIdsRef.current = new Set();
        setExecuting(false);
        setExecutingQueue(null);
        setActiveTaskIds(new Set());
      }

      // 若在本批执行期间又新增了任务（pending），自动继续下一批
      if (!overridePending) {
        const next = [...pendingRef.current];
        if (next.length > 0) {
          onLog?.('info', `检测到新加入的任务 ${next.length} 项，继续执行下一批…`);
          void executePending(next);
        }
      }
    },
    [
      executing,
      onLog,
      setPending,
      setAssets,
      getActionLabel,
      getModule,
      replaceGroupItemWithSubAsset,
      setAssetError,
      scheduleCompanionPersistResult,
    ]
  );

  /** 能力块拖到资产卡：以该卡为唯一输入立即执行（插队），不单独停留在待执行列表 */
  const runCapabilityOnAssetCardImmediate = useCallback(
    (targetAsset: WorkflowAsset, actionType: string) => {
      const trimmed = actionType.trim();
      if (!trimmed) return;
      if (trimmed.startsWith(SET_ACTION_PREFIX)) {
        if (isWorkflowTextAsset(targetAsset)) {
          onLog?.('warn', '复合能力需要图片资产作为输入');
          return;
        }
      } else {
        const mod =
          actionModules.find((m) => m.id === trimmed) ??
          capabilityPresets.find((p) => p.id === trimmed);
        if (mod && !workflowAssetAllowedForCapabilityDrop(targetAsset, mod)) {
          onLog?.('warn', '该能力与当前资产类型不匹配');
          return;
        }
        if (mod && isWorkflowTextAsset(targetAsset)) {
          const img = getAssetDisplayImage(targetAsset);
          const textPresetOk = workflowPresetAcceptsTextCardDrag(mod);
          const textRasterOk =
            !textPresetOk &&
            workflowAssetAllowedForCapabilityDrop(targetAsset, mod) &&
            img.trim() !== '';
          if (!textPresetOk && !textRasterOk) {
            onLog?.(
              'warn',
              '文字资产请使用文生文/文生图，或将卡片切换到文生图结果后再使用图类能力'
            );
            return;
          }
        }
      }
      const task = makePendingTaskForAsset(targetAsset.id, trimmed, undefined);
      if (!task) return;
      if (executing) {
        setPending((prev) => [task, ...prev]);
      } else {
        void executePending([task, ...pendingRef.current]);
      }
    },
    [
      actionModules,
      capabilityPresets,
      executing,
      executePending,
      getAssetDisplayImage,
      makePendingTaskForAsset,
      onLog,
      setPending,
    ]
  );

  const submitQuickCompose = useCallback(() => {
    const mod =
      actionModules.find((m) => m.id === quickComposeActionId) ??
      capabilityPresets.find((p) => p.id === quickComposeActionId);
    if (!mod || mod.disabled) {
      onLog?.('warn', '底部快捷栏：请在下拉中选择一个能力');
      return;
    }
    const text = quickComposeDraft.trim();
    const img = quickComposeImage;

    if (!text && !img) {
      onLog?.('warn', '底部快捷栏：请输入文字或点击 + 添加图片');
      return;
    }

    if (img) {
      const probe = attachInitialVgpToNewAsset({
        id: '__qc_probe__',
        original: img,
        displayKey: 'original',
        results: {},
        resultOrder: [],
        archived: false,
        hiddenInGrid: true,
        createdAt: Date.now(),
      });
      if (!workflowAssetAllowedForCapabilityDrop(probe, mod)) {
        onLog?.(
          'warn',
          '底部快捷栏：当前能力与图片输入不匹配（文生类需纯文字）。有图时请选图生图/图生文等；仅文字请去掉图片并选文生文/文生图'
        );
        return;
      }
      const newId = uuid();
      const newAsset = attachInitialVgpToNewAsset({
        id: newId,
        original: img,
        displayKey: 'original',
        results: {},
        resultOrder: [],
        archived: false,
        hiddenInGrid: true,
        createdAt: Date.now(),
      });
      const newTask: WorkflowPendingTask = {
        id: uuid(),
        assetId: newId,
        actionType: mod.id,
        inputImage: img,
        addedAt: Date.now(),
        inputSourceDisplayKey: 'original',
        ...(text ? { promptOverride: text } : {}),
      };
      setAssets((prev) => [...prev, newAsset]);
      if (executing) {
        setPending((prev) => [...prev, newTask]);
      } else {
        void executePending([newTask, ...pendingRef.current]);
      }
    } else {
      if (!workflowPresetAcceptsTextCardDrag(mod)) {
        onLog?.('warn', '底部快捷栏：纯文字请选用「文生文」或「文生图」类能力');
        return;
      }
      const body = clampWorkflowTextBody(text);
      const newId = uuid();
      const asset = attachInitialVgpToNewAsset({
        id: newId,
        original: '',
        displayKey: 'original',
        results: {},
        resultOrder: [],
        archived: false,
        hiddenInGrid: false,
        createdAt: Date.now(),
        assetKind: 'text',
        textTitle: '',
        textBody: body,
      });
      const task = buildPendingTaskFromAssetSnapshot(asset, asset.id, mod.id);
      if (!task) {
        onLog?.('warn', '底部快捷栏：无法创建任务');
        return;
      }
      setAssets((prev) => [...prev, asset]);
      if (executing) {
        setPending((prev) => [...prev, task]);
      } else {
        void executePending([task, ...pendingRef.current]);
      }
    }

    setQuickComposeDraft('');
    setQuickComposeImage(null);
    onLog?.('info', '底部快捷栏：已加入执行队列');
  }, [
    quickComposeActionId,
    quickComposeDraft,
    quickComposeImage,
    actionModules,
    capabilityPresets,
    onLog,
    setAssets,
    setPending,
    executing,
    executePending,
    buildPendingTaskFromAssetSnapshot,
  ]);

  const cancelQueuedTaskInBatch = useCallback((taskId: string) => {
    if (!taskId) return;
    cancelledTaskIdsRef.current.add(taskId);
    setCompletedTaskIds((prev) => new Set(prev).add(taskId));
  }, []);

  const onCutConfirm = useCallback(
    async (selectedIndexes: number[]) => {
      if (!cutSelectState) return;
      const { task, inputImage, boxes, remaining } = cutSelectState;
      const cutPreset = actionModules.find((m) => m.id === task.actionType);
      const cutOverflowPx =
        task.actionType === 'cut_image' && cutPreset?.cutOverflowPx != null && Number.isFinite(cutPreset.cutOverflowPx)
          ? Math.max(0, Math.min(512, Math.round(cutPreset.cutOverflowPx)))
          : 0;
      const cropped = await cropBoxes(inputImage, boxes, selectedIndexes, cutOverflowPx);
      if (cropped.length === 0) {
        setCutSelectState(null);
        setPending(remaining);
        setExecuting(false);
        return;
      }
      setAssets((prev) => {
        const taskAsset = prev.find((x) => x.id === task.assetId);
        if (!taskAsset) return prev;
        const base = taskAsset.original;
        const imagesToAdd: string[] = base ? [base, ...cropped] : cropped;
        const newAssets: WorkflowAsset[] = imagesToAdd.map((original) =>
          attachInitialVgpToNewAsset({
            id: uuid(),
            original,
            displayKey: 'original',
            results: {},
            resultOrder: [],
            archived: false,
            hiddenInGrid: false,
            createdAt: Date.now(),
          })
        );
        const assetIds = newAssets.map((x) => x.id);
        const usedLabels = new Set<string>(prev.map((a) => a.groupLabel).filter((x): x is string => !!x));
        const groupId = uuid();
        const groupLabel = getRandomGroupCodeName(usedLabels);

        const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
          id: groupId,
          isGroup: true,
          original: taskAsset.original,
          displayKey: 'original',
          results: {},
          resultOrder: [],
          assetIds,
          groupLabel,
          archived: false,
          hiddenInGrid: false,
          createdAt: Date.now(),
        });

        const next = [
          ...prev.filter((a) => a.id !== task.assetId),
          ...newAssets.map((a) => ({ ...a, groupId, groupLabel, groupOrder: assetIds.indexOf(a.id) })),
          newGroup,
        ];

        for (const a of newAssets) {
          const o = String(a.original || '').trim();
          if (o) scheduleCompanionPersistOriginalAny(a.id, o);
        }
        const go = String(newGroup.original || '').trim();
        if (go) scheduleCompanionPersistOriginalAny(newGroup.id, go);

        revokeWorkflowModelBlobUrlsAfterAssetRemoved(taskAsset, next);
        return next;
      });
      if (task.sourceGroupAssetId != null && task.sourceItemIndex != null) {
        replaceGroupItemWithSubAsset(task.sourceGroupAssetId, task.sourceItemIndex, task.assetId);
      }
      setCutSelectState(null);
      if (remaining.length > 0) executePending(remaining);
      else setExecuting(false);
    },
    [
      cutSelectState,
      setAssets,
      setPending,
      executePending,
      replaceGroupItemWithSubAsset,
      actionModules,
      scheduleCompanionPersistOriginalAny,
    ]
  );

  const addImagesFromFiles = useCallback((files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/')).slice(0, 50);
    const batchBase = Date.now();
    const n = imageFiles.length;
    imageFiles.forEach((file, fileIdx) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        const newId = uuid();
        const pushNewAsset = () => {
          setAssets((prev) => {
            // 上传时：如果当前在组内，新增资产应该成为该组的成员
            const parentGroup = groupFilterId ? prev.find((a) => a.id === groupFilterId) : null;
            const newAsset: WorkflowAsset = attachInitialVgpToNewAsset({
              id: newId,
              original: base64,
              displayKey: 'original',
              results: {},
              resultOrder: [],
              archived: false,
              hiddenInGrid: false,
              createdAt: batchBase + (n - 1 - fileIdx),
              ...(parentGroup ? { groupId: parentGroup.id } : {}),
            });
            if (!parentGroup) {
              return [...prev, newAsset];
            }
            // 将新资产添加到组的 assetIds 中（新版 isGroup 结构）
            return prev
              .map((a) => {
                if (a.id === parentGroup.id) {
                  return { ...a, assetIds: [...(a.assetIds ?? []), newId] };
                }
                return a;
              })
              .concat(newAsset);
          });
          scheduleCompanionPersistOriginalAny(newId, base64);
        };
        const im = new Image();
        im.onload = () => {
          const ratio = clampWorkflowCardAspectRatio(im.naturalWidth, im.naturalHeight);
          setCardAspectByAssetId((prev) => (prev[newId] != null ? prev : { ...prev, [newId]: ratio }));
          setThumbUnlockKeys((prev) => {
            if (prev.has(newId)) return prev;
            const next = new Set(prev);
            next.add(newId);
            return next;
          });
          setThumbHotKeys((prev) => {
            if (prev.has(newId)) return prev;
            const next = new Set(prev);
            next.add(newId);
            return next;
          });
          pushNewAsset();
        };
        im.onerror = () => {
          setThumbUnlockKeys((prev) => {
            if (prev.has(newId)) return prev;
            const next = new Set(prev);
            next.add(newId);
            return next;
          });
          setThumbHotKeys((prev) => {
            if (prev.has(newId)) return prev;
            const next = new Set(prev);
            next.add(newId);
            return next;
          });
          pushNewAsset();
        };
        im.src = base64;
      };
      reader.readAsDataURL(file);
    });
  }, [groupFilterId, setAssets, scheduleCompanionPersistOriginalAny]);

  const addModelsFromFiles = useCallback(
    (files: File[]) => {
      const skippedOversized: string[] = [];
      const modelFiles = files
        .filter((f) => isWorkflowModelFile(f))
        .filter((f) => {
          if (workflowLocalModelFileExceedsPreviewLimit(f.size)) {
            skippedOversized.push(f.name || '未命名');
            return false;
          }
          return true;
        })
        .slice(0, 50);
      if (skippedOversized.length) {
        const cap = 5;
        const head = skippedOversized.slice(0, cap).join('、');
        const tail = skippedOversized.length > cap ? ` 等 ${skippedOversized.length} 个` : '';
        onLog?.(
          'warn',
          `以下模型超过本地预览上限（${formatWorkflowModelPreviewLimitLabel()}），已跳过：${head}${tail}`
        );
      }
      const batchBase = Date.now();
      const n = modelFiles.length;
      const ratio = clampWorkflowCardAspectRatio(1600, 1000);
      modelFiles.forEach((file, fileIdx) => {
        const newId = uuid();
        const blobUrl = URL.createObjectURL(file);
        const placeholder = buildWorkflowModelPlaceholderDataUrl(file.name);
        setCardAspectByAssetId((prev) => (prev[newId] != null ? prev : { ...prev, [newId]: ratio }));
        setThumbUnlockKeys((prev) => {
          if (prev.has(newId)) return prev;
          const next = new Set(prev);
          next.add(newId);
          return next;
        });
        setThumbHotKeys((prev) => {
          if (prev.has(newId)) return prev;
          const next = new Set(prev);
          next.add(newId);
          return next;
        });
        setAssets((prev) => {
          const parentGroup = groupFilterId ? prev.find((a) => a.id === groupFilterId) : null;
          const newAsset: WorkflowAsset = attachInitialVgpToNewAsset({
            id: newId,
            original: placeholder,
            displayKey: 'original',
            results: {},
            resultOrder: [],
            modelUrls: [blobUrl],
            modelSourceName: file.name,
            archived: false,
            hiddenInGrid: false,
            createdAt: batchBase + (n - 1 - fileIdx),
            ...(parentGroup ? { groupId: parentGroup.id } : {}),
          });
          if (!parentGroup) {
            return [...prev, newAsset];
          }
          return prev
            .map((a) => {
              if (a.id === parentGroup.id) {
                return { ...a, assetIds: [...(a.assetIds ?? []), newId] };
              }
              return a;
            })
            .concat(newAsset);
        });
        void captureWorkflowModelThumbnailDataUrl({
          modelSrc: blobUrl,
          modelFileName: file.name,
        }).then((thumb) => {
          if (!thumb) return;
          const thumbRatio = clampWorkflowCardAspectRatio(1280, 800);
          setAssets((prev) => {
            if (!prev.some((x) => x.id === newId)) return prev;
            return prev.map((x) => {
              if (x.id !== newId) return x;
              const stillBlob = (x.modelUrls || []).some((u) => u === blobUrl);
              if (!stillBlob) return x;
              const o = String(x.original || '');
              if (!o.includes('image/svg+xml')) return x;
              return { ...x, original: thumb };
            });
          });
          setCardAspectByAssetId((prev) => ({ ...prev, [newId]: thumbRatio }));
        });
      });
    },
    [buildWorkflowModelPlaceholderDataUrl, groupFilterId, onLog, setAssets]
  );

  const handleBatchUploadCorrect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const list = Array.from(files);
    addImagesFromFiles(list);
    addModelsFromFiles(list);
    e.target.value = '';
  }, [addImagesFromFiles, addModelsFromFiles]);

  const hasWorkflowDropTransfer = useCallback((dt?: DataTransfer | null) => {
    if (!dt) return false;
    const types = dt.types ? Array.from(dt.types) : [];
    if (dt.files?.length) {
      for (let i = 0; i < dt.files.length; i += 1) {
        const f = dt.files[i];
        if (f.type?.startsWith('image/')) return true;
        if (isWorkflowModelFile(f)) return true;
      }
    }
    if (dt.items?.length) {
      for (let i = 0; i < dt.items.length; i += 1) {
        const it = dt.items[i];
        if (it.kind === 'file' && it.type?.startsWith('image/')) return true;
        if (workflowModelItemLooksLikeModel(it)) return true;
        // dragover 阶段：.glb/.fbx 等常为 '' 或 application/octet-stream，且 getAsFile 可能为空
        if (it.kind === 'file') {
          const t = (it.type || '').toLowerCase();
          if (t === '' || t === 'application/octet-stream') return true;
        }
      }
    }
    if (types.includes('text/uri-list') || types.includes('text/html')) return true;
    // 部分浏览器在 dragover 时暂不暴露 items，仅含 Files
    if (types.includes('Files')) return true;
    return false;
  }, []);

  /** 处理系统拖入的本机文件（图片 + 工作区模型）；有消费则返回 true */
  const ingestWorkflowFilesFromDataTransfer = useCallback((dt: DataTransfer | null | undefined) => {
    if (!dt) return false;
    const allFiles = Array.from(dt.files || []);
    const imageFiles = allFiles.filter((f) => f.type?.startsWith('image/'));
    const modelFiles = allFiles.filter((f) => isWorkflowModelFile(f));
    if (imageFiles.length === 0 && modelFiles.length === 0) return false;
    if (imageFiles.length) addImagesFromFiles(imageFiles);
    if (modelFiles.length) addModelsFromFiles(modelFiles);
    return true;
  }, [addImagesFromFiles, addModelsFromFiles]);
  const collectImageLikeUrlsFromDataTransfer = useCallback(async (dt?: DataTransfer | null) => {
    if (!dt) return [] as string[];
    const urls = new Set<string>();
    collectImageLikeUrlsFromText(dt.getData('text/uri-list') || '').forEach((u) => urls.add(u));
    collectImageLikeUrlsFromText(dt.getData('text/plain') || '').forEach((u) => urls.add(u));
    collectImageLikeUrlsFromHtml(dt.getData('text/html') || '').forEach((u) => urls.add(u));
    if (dt.items?.length) {
      const pending: Promise<void>[] = [];
      for (let i = 0; i < dt.items.length; i += 1) {
        const it = dt.items[i];
        if (it.kind !== 'string') continue;
        if (it.type === 'text/uri-list' || it.type === 'text/plain') {
          pending.push(
            dataTransferItemToString(it).then((raw) => {
              collectImageLikeUrlsFromText(raw).forEach((u) => urls.add(u));
            })
          );
        } else if (it.type === 'text/html') {
          pending.push(
            dataTransferItemToString(it).then((raw) => {
              collectImageLikeUrlsFromHtml(raw).forEach((u) => urls.add(u));
            })
          );
        }
      }
      if (pending.length) await Promise.all(pending);
    }
    return Array.from(urls).slice(0, 20);
  }, []);
  const fetchImageFilesFromUrls = useCallback(async (urls: string[]) => {
    const extFromType = (type: string) => {
      if (type === 'image/jpeg') return 'jpg';
      if (type === 'image/png') return 'png';
      if (type === 'image/webp') return 'webp';
      if (type === 'image/gif') return 'gif';
      return 'png';
    };
    const files: File[] = [];
    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) continue;
        const type = (res.headers.get('content-type') || '').split(';')[0].trim();
        if (!type.startsWith('image/')) continue;
        const blob = await res.blob();
        const file = new File([blob], `web-drop-${Date.now()}-${i}.${extFromType(type)}`, { type: blob.type || type });
        files.push(file);
      } catch {
        // 某些站点会因 CORS 阻止读取，跳过并继续处理其他链接
      }
    }
    return files;
  }, []);
  const favoriteStorageKey = useMemo(() => workflowFavoritesStorageKey(preferenceScope), [preferenceScope]);
  const parseFavoriteIds = useCallback((parsed: unknown): string[] | null => {
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === 'string');
  }, []);
  const [favoriteActionIds, setFavoriteActionIds] = useState<string[]>(() =>
    readLocalJson<string[]>(favoriteStorageKey, [], parseFavoriteIds)
  );
  useEffect(() => {
    setFavoriteActionIds(readLocalJson<string[]>(favoriteStorageKey, [], parseFavoriteIds));
  }, [favoriteStorageKey, parseFavoriteIds]);
  useEffect(() => {
    writeLocalJson(favoriteStorageKey, favoriteActionIds);
  }, [favoriteActionIds, favoriteStorageKey]);
  /** 能力被禁用或复合能力被删后，从常用功能里剔除无效 id */
  useEffect(() => {
    setFavoriteActionIds((prev) =>
      prev.filter((id) => {
        if (id.startsWith(SET_ACTION_PREFIX)) {
          const sid = id.slice(SET_ACTION_PREFIX.length);
          return capabilitySets.some((s) => s.id === sid);
        }
        const p = capabilityPresets.find((m) => m.id === id);
        return p != null && p.enabled !== false;
      })
    );
  }, [capabilityPresets, capabilitySets]);
  const collectImageFilesFromClipboardItems = useCallback((items?: DataTransferItemList | null) => {
    if (!items?.length) return [] as File[];
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (!items[i].type.startsWith('image/')) continue;
      const f = items[i].getAsFile();
      if (f) files.push(f);
    }
    return files;
  }, []);

  const isGlobalUploadBlockedTarget = useCallback((target: EventTarget | null) => {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    if (isWorkflowEditableTarget(el)) return true;
    // Do not hijack drag/drop on explicit interactive controls or icon buttons.
    if (el.closest('button, a, label, [role="button"], [role="menuitem"], [data-no-global-image-drop]')) return true;
    return false;
  }, []);

  useEffect(() => {
    const onWindowPaste = (e: ClipboardEvent) => {
      if (showArchived) return;
      /** 仅让出真正的可编辑区；不要用 isGlobalUploadBlockedTarget(e.target)，否则焦点在顶部 Tab 等按钮上时，在列表里粘贴会被误拦截 */
      const active = document.activeElement;
      if (active && isWorkflowEditableTarget(active)) return;
      const files = collectImageFilesFromClipboardItems(e.clipboardData?.items);
      if (files.length) {
        e.preventDefault();
        addImagesFromFiles(files);
        return;
      }
      const text = (e.clipboardData?.getData('text/plain') || '').trim();
      if (!text) return;
      e.preventDefault();
      addWorkflowTextAsset(text);
    };
    window.addEventListener('paste', onWindowPaste);
    return () => {
      window.removeEventListener('paste', onWindowPaste);
    };
  }, [addImagesFromFiles, addWorkflowTextAsset, collectImageFilesFromClipboardItems, showArchived]);

  useEffect(() => {
    const onWindowDragOver = (e: DragEvent) => {
      if (showArchived) return;
      if (isGlobalUploadBlockedTarget(e.target)) return;
      if (!hasWorkflowDropTransfer(e.dataTransfer)) return;
      e.preventDefault();
    };

    const onWindowDrop = (e: DragEvent) => {
      if (showArchived) return;
      if (isGlobalUploadBlockedTarget(e.target)) return;
      const dt = e.dataTransfer;
      if (!hasWorkflowDropTransfer(dt)) return;
      e.preventDefault();
      if (ingestWorkflowFilesFromDataTransfer(dt)) return;
      void (async () => {
        const urls = await collectImageLikeUrlsFromDataTransfer(dt);
        if (!urls.length) return;
        const remoteFiles = await fetchImageFilesFromUrls(urls);
        if (remoteFiles.length) addImagesFromFiles(remoteFiles);
      })();
    };

    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, [
    addImagesFromFiles,
    collectImageLikeUrlsFromDataTransfer,
    fetchImageFilesFromUrls,
    hasWorkflowDropTransfer,
    ingestWorkflowFilesFromDataTransfer,
    isGlobalUploadBlockedTarget,
    showArchived,
  ]);

  const visibleAssets = useMemo(() => {
    const base = assets.filter((a) => !a.archived && !a.inRepository);
    // 组筛选模式：显示该组成员
    if (groupFilterId) {
      const group = base.find((a) => a.id === groupFilterId);
      if (group) {
        // 新版 isGroup 卡片：用 assetIds + groupId 关联
        if (isGroupAsset(group)) {
          return base.filter((a) => group.assetIds?.includes(a.id));
        }
        // 旧版组：用 parentAssetId
        return base.filter((a) => a.parentAssetId === groupFilterId);
      }
      setGroupFilterId(null);
      return [];
    }
    // 正常模式：显示所有根资产
    // 组本身没有 groupId，所以 !a.groupId 会包含组
    // 组的子成员有 groupId，所以 !a.groupId 会排除它们
    return sortRootWorkflowAssetsNewestFirst(
      base.filter((a) => !a.groupId)
    );
  }, [assets, groupFilterId]);
  const rootCanvasAssets = useMemo(() => {
    if (!showAllInGroup) return visibleAssets;
    return [...assets]
      .filter((a) => {
        if (a.archived || a.inRepository) return false;
        // 显示全部：隐藏“组容器”本体，仅展示可见叶子资产（含组内子资产）
        if (isGroupAsset(a)) return false;
        if (isGroupChildAsset(a)) return true;
        return !a.hiddenInGrid;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [assets, showAllInGroup, visibleAssets]);

  const outlineExpandableGroupIds = useMemo(
    () => workflowOutlineExpandableGroupIds(assets, visibleAssets),
    [assets, visibleAssets]
  );

  const expandOutlineAll = useCallback(() => {
    setOutlineCollapsedIds(new Set());
  }, []);

  const collapseOutlineAll = useCallback(() => {
    setOutlineCollapsedIds(new Set(outlineExpandableGroupIds));
  }, [outlineExpandableGroupIds]);

  const outlineTreeRows = useMemo(() => {
    const rows: React.ReactElement[] = [];
    const visit = (
      a: WorkflowAsset,
      depth: number,
      parent: WorkflowAsset | null,
      indexInParent: number | null,
      visited: Set<string>
    ) => {
      if (visited.has(a.id)) return;
      visited.add(a.id);

      // 获取标签
      const label = isWorkflowTextAsset(a)
        ? workflowTextAssetOutlineLabel(a)
        : a.groupLabel ||
          (isGroupAsset(a) ? (a.groupKind === 'manual' ? '组' : '切割') : null) ||
          `图片 ${a.id.slice(0, 8)}`;

      // 获取子成员 ID 列表
      const childIds = getGroupMemberIds(a);
      const hasChildren = childIds.length > 0;
      const expanded = !hasChildren || !outlineCollapsedIds.has(a.id);
      const isSel =
        parent != null && indexInParent != null
          ? selectedGroupItemKeys.has(`${parent.id}::${indexInParent}`)
          : selectedAssetIds.has(a.id) && !groupFilterId;

      rows.push(
        <div
          key={`ol-${a.id}-d${depth}-p${parent?.id ?? 'root'}i${indexInParent ?? -1}`}
          className="flex items-stretch gap-0.5 min-w-0"
          style={{ paddingLeft: depth * 10 }}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? '折叠子项' : '展开子项'}
              onClick={(e) => toggleOutlineGroupCollapsed(a.id, e)}
              className="shrink-0 w-5 h-7 flex items-center justify-center rounded-md text-gray-400 hover:bg-white/10 hover:text-white outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50"
            >
              <span className="text-[9px] font-bold leading-none" aria-hidden>
                {expanded ? '▼' : '▶'}
              </span>
            </button>
          ) : (
            <span className="shrink-0 w-5 h-7" aria-hidden />
          )}
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              try {
                const payload: AcWorkflowExportPayload = { mode: 'roots', assetIds: [a.id] };
                e.dataTransfer.setData(DT_AC_WORKFLOW_EXPORT, JSON.stringify(payload));
                e.dataTransfer.effectAllowed = 'copy';
              } catch {
                /* ignore */
              }
            }}
            onClick={() => {
              navigateOutlineToAsset(a);
            }}
            className={`flex-1 min-w-0 text-left rounded-lg px-2 py-1.5 text-[9px] border transition-colors truncate ${
              isSel ? 'border-blue-500 bg-[#152642] text-blue-200' : 'border-white/[0.06] bg-[#141416] text-gray-300 hover:bg-white/[0.06]'
            }`}
          >
            {a.archived ? <span className="text-gray-500 mr-1">已归</span> : null}
            {label}
            {hasChildren ? (
              <span className="text-gray-500 ml-1 tabular-nums font-mono text-[8px]">({childIds.length})</span>
            ) : null}
          </button>
        </div>
      );

      if (!hasChildren || !expanded) return;

      // 遍历子成员
      childIds.forEach((childId, idx) => {
        const child = assets.find((x) => x.id === childId);
        if (!child) {
          rows.push(
            <div
              key={`ol-miss-${a.id}-${idx}`}
              className="text-[8px] text-amber-600/90 pl-2 py-0.5"
              style={{ paddingLeft: (depth + 1) * 10 + 20 }}
            >
              引用缺失 #{idx + 1}
            </div>
          );
          return;
        }
        // 新版结构：子成员直接是资产
        if (isGroupAsset(child)) {
          // 子成员也是组，递归遍历
          visit(child, depth + 1, a, idx, visited);
        } else {
          // 普通资产卡片
          const gk = `${a.id}::${idx}`;
          const sel = selectedGroupItemKeys.has(gk);
          rows.push(
            <div
              key={`ol-${a.id}-slot-${idx}`}
              className="flex items-stretch gap-0.5 min-w-0"
              style={{ paddingLeft: (depth + 1) * 10 }}
            >
              <span className="shrink-0 w-5 h-7" aria-hidden />
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  try {
                    const payload: AcWorkflowExportPayload = {
                      mode: 'groupItems',
                      items: [{ parentId: a.id, index: idx }],
                    };
                    e.dataTransfer.setData(DT_AC_WORKFLOW_EXPORT, JSON.stringify(payload));
                    e.dataTransfer.effectAllowed = 'copy';
                  } catch {
                    /* ignore */
                  }
                }}
                onClick={() => {
                  navigateOutlineToGroupItem(a, idx);
                }}
                className={`flex-1 min-w-0 text-left rounded-lg px-2 py-1.5 text-[9px] border transition-colors truncate ${
                  sel ? 'border-blue-500 bg-[#152642] text-blue-200' : 'border-white/[0.06] bg-[#141416] text-gray-300 hover:bg-white/[0.06]'
                }`}
              >
                <span className="text-gray-500 mr-1">图</span>子项 {idx + 1}
              </button>
            </div>
          );
        }
      });

      // 旧版 cutImageGroup 中的纯字符串项（已废弃，但仍兼容）
      const legacyStringItems = a.cutImageGroup?.filter((item): item is string => typeof item === 'string') ?? [];
      legacyStringItems.forEach((_item, idx) => {
        rows.push(
          <div
            key={`ol-legacy-${a.id}-${idx}`}
            className="flex items-stretch gap-0.5 min-w-0"
            style={{ paddingLeft: (depth + 1) * 10 }}
          >
            <span className="shrink-0 w-5 h-7" aria-hidden />
            <div className="flex-1 min-w-0 text-left rounded-lg px-2 py-1.5 text-[9px] border border-white/[0.06] bg-[#141416] text-gray-500 truncate">
              <span className="text-gray-500 mr-1">图</span>legacy #{idx + 1}
            </div>
          </div>
        );
      });
    };

    const seen = new Set<string>();
    visibleAssets.forEach((root) => visit(root, 0, null, null, seen));
    return rows;
  }, [
    assets,
    visibleAssets,
    outlineCollapsedIds,
    selectedAssetIds,
    selectedGroupItemKeys,
    groupFilterId,
    navigateOutlineToAsset,
    navigateOutlineToGroupItem,
    toggleOutlineGroupCollapsed,
  ]);

    /** 第 0 页大纲列：仓库条目（与左侧仓库卡片网格同屏），非工作区资产树 */
  const repositoryOutlineRows = useMemo(
    () =>
      repositoryVisibleItems.map((item) => {
        const label =
          item.groupLabel ||
          (isWorkflowTextAsset(item)
            ? workflowTextAssetOutlineLabel(item)
            : `图片 ${item.id.slice(0, 8)}`);
        return (
          <div key={`repo-ol-${item.id}`} className="flex items-stretch gap-0.5 min-w-0">
            <span className="shrink-0 w-5 h-7" aria-hidden />
            <button
              type="button"
              draggable
              onDragStart={(e) => {
                try {
                  const payload: AcWorkflowExportPayload = { mode: 'roots', assetIds: [item.id] };
                  e.dataTransfer.setData(DT_AC_WORKFLOW_EXPORT, JSON.stringify(payload));
                  e.dataTransfer.effectAllowed = 'copy';
                } catch {
                  /* ignore */
                }
              }}
              onClick={() => {
                // 使用 isGroupAsset 兼容新旧结构
                if (isGroupAsset(item) && !isWorkflowTextAsset(item)) {
                  setGroupFilterId(item.id);
                  return;
                }
                setLightboxSourceSlot(null);
                setLightboxAssetId(item.id);
              }}
              className="flex-1 min-w-0 text-left rounded-lg px-2 py-1.5 text-[9px] border transition-colors truncate border-white/[0.06] bg-[#141416] text-gray-300 hover:bg-white/[0.06]"
            >
              {label}
            </button>
          </div>
        );
      }),
    [repositoryVisibleItems, setLightboxAssetId, setLightboxSourceSlot]
  );
  const repositoryOutlineTagRows = useMemo(
    () =>
      repositoryTagOptions.map(([tag, count]) => {
        const active = repositorySelectedTags.has(tag);
        return (
          <button
            key={`repo-tag-${tag}`}
            type="button"
            onClick={() =>
              setRepositorySelectedTags((prev) => {
                const next = new Set(prev);
                if (next.has(tag)) next.delete(tag);
                else next.add(tag);
                return next;
              })
            }
            className={`w-full text-left rounded-lg px-2 py-1.5 text-[9px] border transition-colors ${
              active
                ? 'border-blue-500 bg-[#152642] text-blue-200'
                : 'border-white/[0.06] bg-[#141416] text-gray-300 hover:bg-white/[0.06]'
            }`}
          >
            <span className="truncate">{tag}</span>
            <span className="ml-2 text-[8px] text-gray-500">{count}</span>
          </button>
        );
      }),
    [repositoryTagOptions, repositorySelectedTags]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onModeChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: string }>).detail;
      if (detail?.mode === 'presets' || detail?.mode === 'image_process' || detail?.mode === 'sets') {
        setCapabilityPresetViewMode(detail.mode);
      }
    };
    const onColumnChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ value?: number }>).detail;
      if (typeof detail?.value !== 'number') return;
      setCapabilityPresetColumnCount(normalizeCapabilityPresetColumnCount(detail.value));
    };
    const onTypeFilterChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ filter?: CapabilityPresetTypeFilter }>).detail;
      const filter = detail?.filter;
      if (
        filter === 'all' ||
        filter === 'text_to_text' ||
        filter === 'text_to_image' ||
        filter === 'image_to_image' ||
        filter === 'image_to_text'
      ) {
        setCapabilityPresetTypeFilter(filter);
      }
    };
    window.addEventListener('ac:capability-preset-view-mode-changed', onModeChanged as EventListener);
    window.addEventListener('ac:capability-preset-column-count-changed', onColumnChanged as EventListener);
    window.addEventListener('ac:capability-preset-type-filter-changed', onTypeFilterChanged as EventListener);
    return () => {
      window.removeEventListener('ac:capability-preset-view-mode-changed', onModeChanged as EventListener);
      window.removeEventListener('ac:capability-preset-column-count-changed', onColumnChanged as EventListener);
      window.removeEventListener('ac:capability-preset-type-filter-changed', onTypeFilterChanged as EventListener);
    };
  }, []);

  const busyAssetIds = useMemo(() => {
    const busy = new Set<string>();
    pending.forEach((t) => busy.add(t.assetId));
    if (executingQueue) {
      executingQueue.tasks.forEach((t) => {
        if (!completedTaskIds.has(t.id)) busy.add(t.assetId);
      });
    }
    return busy;
  }, [pending, executingQueue, completedTaskIds]);

  const executingQueueDoneCount = useMemo(() => {
    if (!executingQueue) return 0;
    return executingQueue.tasks.reduce((n, t) => n + (completedTaskIds.has(t.id) ? 1 : 0), 0);
  }, [executingQueue, completedTaskIds]);

  const lightboxAsset = lightboxAssetId ? assets.find((a) => a.id === lightboxAssetId) : null;
  const lightboxShowsImage = Boolean(lightboxAsset && getAssetDisplayImage(lightboxAsset).trim());
  const lightboxModelUrls = useMemo(
    () => (lightboxAsset?.modelUrls || []).map((u) => String(u || '').trim()).filter(Boolean),
    [lightboxAsset?.modelUrls]
  );
  const lightboxList = useMemo(
    () =>
      sortRootWorkflowAssetsNewestFirst(
        assets.filter((a) => !a.archived && !a.hiddenInGrid && !a.parentAssetId)
      ),
    [assets]
  );
  const lightboxListRef = useRef(lightboxList);
  lightboxListRef.current = lightboxList;
  const lightboxIndex = lightboxAssetId ? lightboxList.findIndex((a) => a.id === lightboxAssetId) : -1;
  useEffect(() => {
    if (!lightboxAsset) {
      setLightboxMetaText('');
      return;
    }
    const src = getAssetDisplayImage(lightboxAsset);
    if (!src.trim() && isWorkflowTextAsset(lightboxAsset)) {
      const body = getAssetDisplayText(lightboxAsset);
      const titleLen = (lightboxAsset.textTitle || '').trim().length;
      setLightboxMetaText(
        `文字 · 标题 ${titleLen} 字 · 正文 ${body.length} 字 · ${body ? body.split(/\r?\n/).length : 0} 行`
      );
      return;
    }
    if (!src.trim()) {
      setLightboxMetaText('');
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      const ratio = w > 0 && h > 0 ? (w / h).toFixed(3) : '-';
      let mime = 'unknown';
      let approxBytes = 0;
      const m = src.match(/^data:([^;,]+);base64,(.+)$/i);
      if (m) {
        mime = (m[1] || 'unknown').toLowerCase();
        const base64 = m[2] || '';
        const padding = (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
        approxBytes = Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
      } else if (/^https?:\/\//i.test(src)) {
        try {
          const u = new URL(src);
          const ext = u.pathname.split('.').pop()?.toLowerCase() || '';
          mime =
            ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
              : ext === 'png' ? 'image/png'
              : ext === 'webp' ? 'image/webp'
              : ext === 'gif' ? 'image/gif'
              : ext === 'bmp' ? 'image/bmp'
              : ext === 'svg' ? 'image/svg+xml'
              : 'remote';
        } catch {
          mime = 'remote';
        }
      }
      const kb = approxBytes > 0 ? `${(approxBytes / 1024).toFixed(1)} KB` : '-';
      setLightboxMetaText(`元数据 · ${w}×${h} · 比例 ${ratio} · ${mime} · 约 ${kb}`);
    };
    img.onerror = () => {
      if (cancelled) return;
      setLightboxMetaText('');
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [lightboxAsset, assets, getAssetDisplayImage, getAssetDisplayText]);
  const _goLightbox = (delta: number) => {
    if (lightboxList.length === 0) return;
    const next = (lightboxIndex + delta + lightboxList.length) % lightboxList.length;
    setLightboxSourceSlot(null);
    setLightboxAssetId(lightboxList[next].id);
  };

  const handleLightboxWheelNavigate = useCallback((deltaSteps: number) => {
    setLightboxAssetId((prev) => {
      if (!prev) return null;
      const list = lightboxListRef.current;
      if (list.length <= 1) return prev;
      const i = list.findIndex((a) => a.id === prev);
      if (i < 0) return prev;
      let ni = i;
      const dir = deltaSteps > 0 ? 1 : -1;
      for (let k = 0; k < Math.abs(deltaSteps); k++) {
        ni = (ni + dir + list.length) % list.length;
      }
      return list[ni].id;
    });
    setLightboxSourceSlot(null);
  }, []);

  /** 大图预览：普通滚轮在本资产内切换 displayKey */
  const handleLightboxWheelCycleDisplay = useCallback((deltaSteps: number) => {
    setAssets((prev) => {
      const id = lightboxAssetId;
      if (!id) return prev;
      const a = prev.find((x) => x.id === id);
      if (!a) return prev;
      const keys = getDisplayKeysForAsset(a);
      if (keys.length <= 1) return prev;
      const idx = Math.max(0, keys.indexOf(a.displayKey));
      const nextIdx = ((idx + deltaSteps) % keys.length + keys.length) % keys.length;
      return prev.map((x) => (x.id === id ? { ...x, displayKey: keys[nextIdx] } : x));
    });
  }, [lightboxAssetId, setAssets]);

  const setDisplayKey = (assetId: string, key: string) => {
    setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, displayKey: key } : a)));
  };

  /** 文字/图片/组内子项：统一用 resultOrder 版本链（与滚轮切换一致），不按资产类型区分 */
  const getDisplayKeysForAsset = (a: WorkflowAsset): string[] => {
    const keys: string[] = ['original'];
    (a.resultOrder || []).forEach((k) => {
      if (baseActionId(k) !== 'cut_image') keys.push(k);
    });
    return keys;
  };
  const getGeneratedImageCount = (a: WorkflowAsset): number =>
    Math.max(0, getDisplayKeysForAsset(a).length - 1);

  const cycleDisplayKey = (assetId: string, delta: number) => {
    const a = assets.find((x) => x.id === assetId);
    if (!a) return;
    const keys = getDisplayKeysForAsset(a);
    if (keys.length <= 1) return;
    const idx = keys.indexOf(a.displayKey);
    const current = idx >= 0 ? idx : 0;
    const next = (current + (delta > 0 ? 1 : -1) + keys.length) % keys.length;
    setDisplayKey(assetId, keys[next]);
  };

  const duplicateAssetInPlace = useCallback(
    (sourceIds: string[], parentGroupId: string | null) => {
      setAssets((prev) => {
        const copies: WorkflowAsset[] = [];
        const newIds: string[] = [];
        sourceIds.forEach((id) => {
          const src = prev.find((a) => a.id === id);
          if (!src) return;
          const newId = uuid();
          newIds.push(newId);
          copies.push({
            ...src,
            id: newId,
            archived: false,
            hiddenInGrid: false,
            createdAt: Date.now(),
          });
        });
        if (copies.length === 0) return prev;
        let next = [...prev, ...copies];
        if (parentGroupId) {
          const gi = next.findIndex((a) => a.id === parentGroupId);
          if (gi !== -1) {
            const g = next[gi];
            const items = [...(g.assetIds ?? []), ...newIds];
            next = next.map((a, i) => (i === gi ? { ...a, assetIds: items } : a));
          }
        }
        return next;
      });
    },
    [setAssets]
  );

  useEffect(() => {
    const pendingAssetIds = new Set(pending.map((t) => t.assetId));
    const pendingGroupKeys = new Set(
      pending
        .filter((t) => t.sourceGroupAssetId != null && t.sourceItemIndex != null)
        .map((t) => `${t.sourceGroupAssetId}::${t.sourceItemIndex}`)
    );
    if (pendingAssetIds.size === 0 && pendingGroupKeys.size === 0) return;
    setSelectedAssetIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      prev.forEach((id) => {
        if (pendingAssetIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setSelectedGroupItemKeys((prev) => {
      let changed = false;
      const next = new Set(prev);
      prev.forEach((key) => {
        if (pendingGroupKeys.has(key)) {
          next.delete(key);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [pending]);

  useEffect(() => {
    const handler = (e: WheelEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('[data-prevent-wheel-scroll]')) {
        e.preventDefault();
      }
    };
    document.addEventListener('wheel', handler, { passive: false, capture: true });
    return () => document.removeEventListener('wheel', handler, { capture: true });
  }, []);

  const discardResult = (assetId: string, actionType: string) => {
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== assetId) return a;
        const nextResults = { ...a.results };
        delete nextResults[actionType];
        const nextTextResults = { ...(a.textResults || {}) };
        delete nextTextResults[actionType];
        const nextRc = { ...(a.resultsCompanionKeys || {}) };
        delete nextRc[actionType];
        const nextOrder = (a.resultOrder || []).filter((k) => k !== actionType);
        const nextMeta = { ...a.resultMeta };
        delete nextMeta[actionType];
        const displayKey = a.displayKey === actionType ? 'original' : a.displayKey;
        return {
          ...a,
          results: nextResults,
          textResults: nextTextResults,
          resultOrder: nextOrder,
          resultMeta: nextMeta,
          displayKey,
          resultsCompanionKeys: Object.keys(nextRc).length ? nextRc : undefined,
        };
      })
    );
  };

  const markArchived = (assetId: string) => {
    const snapshot = assets.find((a) => a.id === assetId) || null;
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id === assetId) {
          return { ...a, archived: true, inRepository: true, hiddenInGrid: false, groupId: undefined, groupLabel: undefined, groupOrder: undefined };
        }
        // 如果是组容器，从 assetIds 中移除
        if (isGroupAsset(a)) {
          const filtered = (a.assetIds ?? []).filter((id) => id !== assetId);
          if (filtered.length !== (a.assetIds?.length ?? 0)) {
            return { ...a, assetIds: filtered.length ? filtered : undefined };
          }
        }
        return a;
      })
    );
    setArchiveHint({ assetId, ts: Date.now() });
    setTimeout(() => setArchiveHint((h) => (h?.assetId === assetId ? null : h)), 4000);
    if (!snapshot || isWorkflowTextAsset(snapshot)) return;
    const versionKey = snapshot.displayKey;
    const coarse = snapshot.imageTags?.[versionKey] || [];
    if (!coarse.length) return;
    if (snapshot.imageTagStage?.[versionKey] === 'refined') return;
    const rk = `${snapshot.id}:${versionKey}`;
    if (refiningTagKeys.has(rk)) return;
    setRefiningTagKeys((prev) => new Set(prev).add(rk));
    void (async () => {
      try {
        const refined = await refineWorkflowImageTagsLowCost({
          coarseTags: coarse,
          actionId: baseActionId(versionKey),
          actionLabel: getActionLabel(baseActionId(versionKey)),
          promptHint: (snapshot.resultMeta && snapshot.resultMeta[versionKey]?.semanticSummary) || '',
        });
        if (refined.length > 0) {
          setAssets((prev) =>
            prev.map((a) =>
              a.id === snapshot.id
                ? {
                    ...a,
                    imageTags: { ...(a.imageTags || {}), [versionKey]: refined },
                    imageTagStage: { ...(a.imageTagStage || {}), [versionKey]: 'refined' as const },
                  }
                : a
            )
          );
          onLog?.('info', `已精修标签（低成本）: ${snapshot.id.slice(0, 6)} · ${versionKey}`);
        }
      } catch (e) {
        onLog?.('warn', '标签精修失败，已保留粗标签', normalizeApiErrorMessage(e));
      } finally {
        setRefiningTagKeys((prev) => {
          const next = new Set(prev);
          next.delete(rk);
          return next;
        });
      }
    })();
  };

  const removeAsset = useCallback((assetId: string) => {
    setAssets((prev) => {
      const removed = prev.find((a) => a.id === assetId);
      const next = prev.filter((a) => a.id !== assetId);
      if (removed) revokeWorkflowModelBlobUrlsAfterAssetRemoved(removed, next);
      return next;
    });
    setPending((prev) => prev.filter((t) => t.assetId !== assetId));
    if (lightboxAssetId === assetId) setLightboxAssetId(null);
    if (archivedDetailAssetId === assetId) setArchivedDetailAssetId(null);
    // 如果删除的是当前查看的组，清除组筛选
    if (groupFilterId === assetId) setGroupFilterId(null);
  }, [lightboxAssetId, archivedDetailAssetId, groupFilterId, setAssets, setPending]);

  const archivedDetailAsset = archivedDetailAssetId ? assets.find((a) => a.id === archivedDetailAssetId) : null;

  const currentGroupAsset = groupFilterId ? assets.find((a) => a.id === groupFilterId) : null;
  const currentGroupMemberIds = useMemo(
    () => (currentGroupAsset ? getGroupMemberIds(currentGroupAsset) : []),
    [currentGroupAsset]
  );
  /** 兼容层：将新的 string[] 转换为旧代码期望的对象数组格式 */
  const currentGroupItems: Array<string | { assetId: string } | { r2Key: string }> = currentGroupMemberIds.map((id) => ({ assetId: id }));
  /** 组内拖到功能区/队列时以 drag state 中的组 id 为准 */
  const groupAssetForDrag = useMemo(
    () =>
      draggingGroupItems
        ? assets.find((a) => a.id === draggingGroupItems.groupAssetId) ?? null
        : null,
    [draggingGroupItems, assets]
  );
  const _dragGroupMemberIds = groupAssetForDrag ? getGroupMemberIds(groupAssetForDrag) : [];

  const flattenGroupImages = useCallback(
    (asset: WorkflowAsset, visited: Set<string> = new Set()): string[] => {
      if (visited.has(asset.id)) return [];
      visited.add(asset.id);
      const out: string[] = [];

      // 新版：使用 assetIds
      if (asset.isGroup === true && asset.assetIds?.length) {
        for (const childId of asset.assetIds) {
          const child = assets.find((x) => x.id === childId);
          if (!child) continue;
          if (isGroupAsset(child)) {
            out.push(...flattenGroupImages(child, visited));
          } else {
            const img = getAssetDisplayImage(child);
            if (img) out.push(img);
          }
        }
        return out;
      }

      // 旧版：使用 cutImageGroup
      for (const item of asset.cutImageGroup ?? []) {
        if (typeof item === 'string') out.push(item);
        else if (item && typeof item === 'object' && 'r2Key' in item) continue;
        else if (item && typeof item === 'object' && 'assetId' in item) {
          const child = assets.find((x) => x.id === item.assetId);
          if (!child) continue;
          if (isGroupAsset(child)) {
            out.push(...flattenGroupImages(child, visited));
          } else {
            const img = getAssetDisplayImage(child);
            if (img) out.push(img);
          }
        }
      }
      return out;
    },
    [assets, getAssetDisplayImage]
  );
  const showAllImages = useMemo(() => {
    if (!currentGroupAsset || !showAllInGroup) return null;
    return flattenGroupImages(currentGroupAsset);
  }, [currentGroupAsset, showAllInGroup, flattenGroupImages]);

  const mergeThumbUnlockKeys = useCallback((prev: Set<string>, keys: Iterable<string>) => {
    const next = new Set(prev);
    let changed = false;
    for (const k of keys) {
      if (!next.has(k)) {
        next.add(k);
        changed = true;
      }
    }
    return changed ? next : prev;
  }, []);

  useEffect(() => {
    const unlockKeys: string[] = [];
    const hotKeys: string[] = [];
    const seedUnlockRoot = Math.min(visibleAssets.length, columnCount * 3);
    const seedHotRoot = Math.min(visibleAssets.length, columnCount);
    const seedUnlockGroup = columnCount * 3;
    const seedHotGroup = columnCount;
    if (!groupFilterId) {
      visibleAssets.slice(0, seedUnlockRoot).forEach((a) => unlockKeys.push(a.id));
      visibleAssets.slice(0, seedHotRoot).forEach((a) => hotKeys.push(a.id));
    } else if (currentGroupAsset) {
      if (showAllImages?.length) {
        const capU = Math.min(showAllImages.length, seedUnlockGroup);
        const capH = Math.min(showAllImages.length, seedHotGroup);
        for (let i = 0; i < capU; i++) {
          unlockKeys.push(`gall:${currentGroupAsset.id}:${i}`);
        }
        for (let i = 0; i < capH; i++) {
          hotKeys.push(`gall:${currentGroupAsset.id}:${i}`);
        }
      } else {
        const capU = Math.min(currentGroupMemberIds.length, seedUnlockGroup);
        const capH = Math.min(currentGroupMemberIds.length, seedHotGroup);
        for (let i = 0; i < capU; i++) {
          unlockKeys.push(`${currentGroupAsset.id}::${i}`);
        }
        for (let i = 0; i < capH; i++) {
          hotKeys.push(`${currentGroupAsset.id}::${i}`);
        }
      }
    }
    setThumbUnlockKeys((prev) => mergeThumbUnlockKeys(prev, unlockKeys));
    setThumbHotKeys((prev) => mergeThumbUnlockKeys(prev, hotKeys));
  }, [
    visibleAssets,
    groupFilterId,
    currentGroupAsset,
    columnCount,
    showAllImages,
    currentGroupMemberIds.length,
    mergeThumbUnlockKeys,
  ]);

  useEffect(() => {
    const root = centerScrollRef.current;
    if (!root) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (cancelled) return;
        setThumbUnlockKeys((prev) => {
          let next: Set<string> | null = null;
          for (const en of entries) {
            if (!en.isIntersecting) continue;
            const k = (en.target as HTMLElement).getAttribute('data-workflow-thumb-key');
            if (!k) continue;
            if (!prev.has(k)) {
              if (!next) next = new Set(prev);
              next.add(k);
            }
          }
          return next ?? prev;
        });
      },
      { root, rootMargin: '200px 0px 280px 0px', threshold: 0.01 }
    );
    const run = () => {
      if (cancelled) return;
      root.querySelectorAll('[data-workflow-thumb-key]').forEach((el) => io.observe(el));
    };
    const raf = window.requestAnimationFrame(() => window.requestAnimationFrame(run));
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [
    visibleAssets.length,
    groupFilterId,
    currentGroupAsset?.id,
    currentGroupItems.length,
    columnCount,
    showAllImages?.length,
    showArchived,
    showAllInGroup,
  ]);

  useEffect(() => {
    const root = centerScrollRef.current;
    if (!root) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (cancelled) return;
        setThumbHotKeys((prev) => {
          const next = new Set(prev);
          for (const en of entries) {
            const k = (en.target as HTMLElement).getAttribute('data-workflow-thumb-key');
            if (!k) continue;
            if (en.isIntersecting) next.add(k);
            else next.delete(k);
          }
          return next;
        });
      },
      { root, rootMargin: '0px', threshold: 0.05 }
    );
    const run = () => {
      if (cancelled) return;
      root.querySelectorAll('[data-workflow-thumb-key]').forEach((el) => io.observe(el));
    };
    const raf = window.requestAnimationFrame(() => window.requestAnimationFrame(run));
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [
    visibleAssets.length,
    groupFilterId,
    currentGroupAsset?.id,
    currentGroupItems.length,
    columnCount,
    showAllImages?.length,
    showArchived,
    showAllInGroup,
  ]);

  /** 面包屑项，包含父级 ID 用于返回导航 */
  const groupBreadcrumb = useMemo((): { id: string; label: string; parentId: string | null }[] => {
    if (!groupFilterId) return [];
    // 构建从根到当前组的完整路径
    const path: { id: string; label: string; parentId: string | null }[] = [];
    let currentId: string | null = groupFilterId;
    while (currentId) {
      const group = assets.find((a) => a.id === currentId);
      if (!group) break;
      // 向上追溯：找到引用当前组的父组
      const parentGroup = assets.find((a) => isGroupAsset(a) && a.assetIds?.includes(group.id));
      path.unshift({
        id: group.id,
        label: group.groupLabel ?? '组',
        parentId: parentGroup?.id ?? null,
      });
      currentId = parentGroup?.id ?? null;
    }
    return path;
  }, [groupFilterId, assets]);

  /** 将组内项解析为资产 id 列表 */
  const ensureGroupItemsAsAssets = useCallback(
    (prev: WorkflowAsset[], groupAssetId: string, itemIndexes: number[]): { nextAssets: WorkflowAsset[]; assetIds: string[] } => {
      const group = prev.find((a) => a.id === groupAssetId);
      if (!isGroupAsset(group)) return { nextAssets: prev, assetIds: [] };
      const assetIds = itemIndexes
        .filter((idx) => idx >= 0 && idx < (group.assetIds?.length ?? 0))
        .map((idx) => group.assetIds![idx]);
      return { nextAssets: prev, assetIds };
    },
    []
  );

  /** 从组中移除指定下标的成员；若组变空则移除组。返回新 assets。 */
  const removeGroupItems = useCallback(
    (prev: WorkflowAsset[], groupAssetId: string, itemIndexes: number[]): WorkflowAsset[] => {
      const groupIdx = prev.findIndex((a) => a.id === groupAssetId);
      if (groupIdx === -1) return prev;
      const group = prev[groupIdx];
      if (!isGroupAsset(group)) return prev;

      const sorted = [...itemIndexes].filter((i) => i >= 0 && i < (group.assetIds?.length ?? 0)).sort((a, b) => b - a);
      if (sorted.length === 0) return prev;

      const nextAssetIds = [...(group.assetIds ?? [])];
      for (const i of sorted) nextAssetIds.splice(i, 1);

      let next = prev.map((a, i) =>
        i === groupIdx ? { ...a, assetIds: nextAssetIds.length ? nextAssetIds : undefined } : a
      );

      // 如果组变空，移除组
      if (nextAssetIds.length === 0) {
        next = next.filter((a) => a.id !== groupAssetId);
      }

      return next;
    },
    []
  );

  const addImageToPending = useCallback(
    (
      imageBase64: string,
      actionType: string,
      opts?: {
        parentAssetId?: string;
        sourceGroupAssetId?: string;
        sourceItemIndex?: number;
        promptOverride?: string;
        overrideImageGear?: CustomAppModule['imageGear'];
        overrideImageAspectRatio?: string;
        overrideImageSize?: string;
        overrideSkipUnderstand?: boolean;
      }
    ) => {
      const newAsset: WorkflowAsset = attachInitialVgpToNewAsset({
        id: uuid(),
        original: imageBase64,
        displayKey: 'original',
        results: {},
        resultOrder: [],
        archived: false,
        hiddenInGrid: true,
        createdAt: Date.now(),
        ...(opts?.parentAssetId ? { parentAssetId: opts.parentAssetId } : {}),
      });
      const fromGroup = opts?.sourceGroupAssetId != null && opts.sourceItemIndex != null;
      setAssets((prev) => {
        const next = [...prev, newAsset];
        if (fromGroup) {
          const groupIdx = next.findIndex((a) => a.id === opts!.sourceGroupAssetId);
          if (groupIdx >= 0 && isGroupAsset(next[groupIdx])) {
            const group = next[groupIdx];
            const assetIds = [...(group.assetIds ?? [])];
            if (opts!.sourceItemIndex! >= 0 && opts!.sourceItemIndex! < assetIds.length) {
              assetIds[opts!.sourceItemIndex!] = newAsset.id;
              next[groupIdx] = { ...group, assetIds };
            }
          }
        }
        return next;
      });
      if (fromGroup) {
        onLog?.(
          'info',
          '已将组内图片升级为可复用资产：后续可在工作流与归档视图中作为独立节点追踪'
        );
      }
      setPending((prev) => [
        ...prev,
        {
          id: uuid(),
          assetId: newAsset.id,
          actionType,
          inputImage: imageBase64,
          addedAt: Date.now(),
          inputSourceDisplayKey: 'original',
          ...(opts?.promptOverride != null ? { promptOverride: opts.promptOverride } : {}),
          ...(opts?.overrideImageGear ? { overrideImageGear: opts.overrideImageGear } : {}),
          ...(opts?.overrideImageAspectRatio ? { overrideImageAspectRatio: opts.overrideImageAspectRatio } : {}),
          ...(opts?.overrideImageSize ? { overrideImageSize: opts.overrideImageSize } : {}),
          ...(typeof opts?.overrideSkipUnderstand === 'boolean'
            ? { overrideSkipUnderstand: opts.overrideSkipUnderstand }
            : {}),
          ...(fromGroup
            ? { sourceGroupAssetId: opts!.sourceGroupAssetId, sourceItemIndex: opts!.sourceItemIndex }
            : {}),
        },
      ]);
      scheduleCompanionPersistOriginalAny(newAsset.id, imageBase64);
    },
    [setAssets, setPending, onLog, scheduleCompanionPersistOriginalAny]
  );

  /** 在给定 `prev` 上插入手动组（供「建组」与组内拖入非组卡一次 setAssets 复用） */
  const insertManualGroupForAssetIds = useCallback((
    prev: WorkflowAsset[],
    assetIds: string[],
    opts?: { allowTextAssets?: boolean }
  ): InsertManualGroupResult => {
    const allowTextAssets = opts?.allowTextAssets === true;
    const ids = [...new Set(assetIds)].filter((id) => {
      const x = prev.find((a) => a.id === id);
      if (!x) return false;
      if (!allowTextAssets && isWorkflowTextAsset(x)) return false;
      return true;
    });
    if (ids.length < 2) return { next: prev, createdGroup: null };
    const first = prev.find((x) => x.id === ids[0]);
    const coverImage = first ? getAssetDisplayImage(first, prev) : '';
    const groupId = uuid();
    const usedLabels = new Set<string>(prev.map((x) => x.groupLabel).filter((x): x is string => !!x));
    const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
      id: groupId,
      isGroup: true,
      original: coverImage,
      displayKey: 'original',
      results: {},
      resultOrder: [],
      assetIds: ids,
      groupKind: 'manual',
      groupLabel: getRandomGroupCodeName(usedLabels),
      archived: false,
      hiddenInGrid: false,
      createdAt: Date.now(),
    });
    const mapped = prev.map((x) => {
      if (x.id === groupId) return x;
      if (ids.includes(x.id)) return { ...x, groupId, groupOrder: ids.indexOf(x.id) };
      return x;
    });
    return {
      next: [...mapped, newGroup],
      createdGroup: { id: groupId, coverImage },
    };
  }, [getAssetDisplayImage]);

  const expandRootAssetsForGenerateCount = useCallback(
    (
      assetIds: string[],
      generateCount: number,
      opts?: { allowTextAssetsForExpansion?: boolean; allowTextAssetsForGrouping?: boolean }
    ): { rootIds: string[]; cloneTaskSeeds: Array<{ sourceAsset: WorkflowAsset; targetAssetId: string }> } => {
      if (generateCount <= 1) return { rootIds: assetIds, cloneTaskSeeds: [] };
      type ClonePlan = { sourceId: string; cloneId: string; sourceAsset: WorkflowAsset };
      const clonePlans: ClonePlan[] = [];
      const groupPlans: string[][] = [];
      const rootIds: string[] = [];
      const cloneTaskSeeds: Array<{ sourceAsset: WorkflowAsset; targetAssetId: string }> = [];
      for (const id of assetIds) {
        const source = assets.find((a) => a.id === id);
        if (!source || isGroupChildAsset(source) || (!opts?.allowTextAssetsForExpansion && isWorkflowTextAsset(source))) {
          rootIds.push(id);
          continue;
        }
        rootIds.push(id);
        const idsForGroup = [id];
        for (let i = 1; i < generateCount; i += 1) {
          const cloneId = uuid();
          clonePlans.push({ sourceId: id, cloneId, sourceAsset: source });
          cloneTaskSeeds.push({ sourceAsset: source, targetAssetId: cloneId });
          idsForGroup.push(cloneId);
        }
        if (idsForGroup.length > 1) groupPlans.push(idsForGroup);
      }
      if (clonePlans.length === 0) return { rootIds, cloneTaskSeeds };
      setAssets((prev) => {
        let next = [...prev];
        for (const plan of clonePlans) {
          const src = next.find((a) => a.id === plan.sourceId);
          if (!src) continue;
          const clone: WorkflowAsset = {
            ...src,
            id: plan.cloneId,
            parentAssetId: undefined,
            archived: false,
            hiddenInGrid: false,
            createdAt: Date.now(),
          };
          next.push(clone);
          const o = String(clone.original || '').trim();
          if (o) queueMicrotask(() => scheduleCompanionPersistOriginalAny(plan.cloneId, o));
        }
        for (const ids of groupPlans) {
          const r = insertManualGroupForAssetIds(next, ids, {
            allowTextAssets: opts?.allowTextAssetsForGrouping === true,
          });
          next = r.next;
          if (r.createdGroup) {
            const cg = r.createdGroup;
            queueMicrotask(() => scheduleCompanionPersistOriginalAny(cg.id, cg.coverImage));
          }
        }
        return next;
      });
      return { rootIds, cloneTaskSeeds };
    },
    [assets, setAssets, insertManualGroupForAssetIds, scheduleCompanionPersistOriginalAny]
  );

  /** 将资产添加到组的 assetIds 中 */
  const mergeAssetIdsIntoGroupCardAssets = useCallback(
    (prev: WorkflowAsset[], targetGroupAssetId: string, movingAssetIds: string[]): WorkflowAsset[] => {
      const moving = movingAssetIds.filter((id) => {
        const x = prev.find((a) => a.id === id);
        return x && !isWorkflowTextAsset(x);
      });
      if (moving.length === 0) return prev;
      return prev.map((asset) => {
        if (asset.id === targetGroupAssetId && isGroupAsset(asset)) {
          const existingIds = asset.assetIds ?? [];
          const newIds = moving.filter((id) => !existingIds.includes(id));
          if (newIds.length === 0) return asset;
          return { ...asset, assetIds: [...existingIds, ...newIds] };
        }
        if (moving.includes(asset.id)) {
          return { ...asset, groupId: targetGroupAssetId };
        }
        return asset;
      });
    },
    []
  );

  const createGroupFromAssets = useCallback(
    (assetIds: string[]) => {
      if (!assetIds.length) return;
      setAssets((prev) => {
        const r = insertManualGroupForAssetIds(prev, assetIds);
        if (r.createdGroup) {
          const cg = r.createdGroup;
          queueMicrotask(() => scheduleCompanionPersistOriginalAny(cg.id, cg.coverImage));
        }
        return r.next;
      });
      setSelectedAssetIds(new Set());
    },
    [insertManualGroupForAssetIds, scheduleCompanionPersistOriginalAny, setAssets, setSelectedAssetIds]
  );

  /** 从组的 assetIds 创建嵌套组 */
  const createNestedGroupFromGroupItem = useCallback(
    (groupAssetId: string, itemIndex: number) => {
      setAssets((prev) => {
        const group = prev.find((a) => a.id === groupAssetId);
        if (!group || !isGroupAsset(group)) return prev;
        const childId = group.assetIds?.[itemIndex];
        if (!childId) return prev;

        const child = prev.find((a) => a.id === childId);
        const coverImage = child ? getAssetDisplayImage(child) : '';
        const newGroupId = uuid();
        const usedLabels = new Set<string>(prev.map((a) => a.groupLabel).filter((x): x is string => !!x));

        const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
          id: newGroupId,
          isGroup: true,
          original: coverImage,
          displayKey: 'original',
          results: {},
          resultOrder: [],
          assetIds: [childId],
          groupId: groupAssetId, // 继承父组的 groupId，使其成为嵌套组
          groupLabel: getRandomGroupCodeName(usedLabels),
          archived: false,
          hiddenInGrid: false,
          createdAt: Date.now(),
        });

        const next = prev
          .map((a) => {
            if (a.id === groupAssetId && isGroupAsset(a)) {
              const nextAssetIds = [...(a.assetIds ?? [])];
              nextAssetIds[itemIndex] = newGroupId;
              return { ...a, assetIds: nextAssetIds };
            }
            if (a.id === childId) {
              return { ...a, groupId: newGroupId };
            }
            return a;
          })
          .concat(newGroup);
        queueMicrotask(() => scheduleCompanionPersistOriginalAny(newGroupId, coverImage));
        return next;
      });
    },
    [getAssetDisplayImage, scheduleCompanionPersistOriginalAny, setAssets]
  );

  const getEffectiveAssetIdsForAction = useCallback(
    (ids: string[]): string[] => {
      const out = new Set<string>();
      ids.forEach((id) => {
        const asset = assets.find((a) => a.id === id);
        if (!asset) return;
        // 优先使用新版 isGroup 结构
        if (isGroupAsset(asset) && asset.assetIds?.length) {
          asset.assetIds.forEach((childId) => out.add(childId));
        } else if (
          asset.cutImageGroup &&
          asset.cutImageGroup.length > 0 &&
          asset.cutImageGroup.every((item) => typeof item === 'object' && item && 'assetId' in item)
        ) {
          // 旧版 cutImageGroup 兼容
          asset.cutImageGroup.forEach((item) => {
            if (typeof item === 'object' && item && 'assetId' in item) {
              out.add((item as { assetId: string }).assetId);
            }
          });
        } else {
          out.add(id);
        }
      });
      return Array.from(out);
    },
    [assets]
  );
  const _favoriteActionSet = useMemo(() => new Set(favoriteActionIds), [favoriteActionIds]);
  // 常用功能只做“置顶快捷入口”，不从原列表移除，避免用户误以为模块丢失
  const visibleByCategory = useMemo(() => byCategory, [byCategory]);
  const visiblePresets = useMemo(() => presets, [presets]);
  const visibleCapabilitySets = useMemo(() => capabilitySets, [capabilitySets]);
  const favoriteEntries = useMemo((): WorkflowSidebarFavoriteEntry[] => {
    return favoriteActionIds
      .map((id) => {
        if (id.startsWith(SET_ACTION_PREFIX)) {
          const sid = id.slice(SET_ACTION_PREFIX.length);
          const set = capabilitySets.find((s) => s.id === sid);
          if (!set) return null;
          return { id, label: set.label, kind: 'set' as const, set };
        }
        const mod = actionModules.find((m) => m.id === id);
        if (!mod) return null;
        return { id, label: mod.label, kind: 'module' as const, mod };
      })
      .filter((x): x is WorkflowSidebarFavoriteEntry => x != null);
  }, [favoriteActionIds, capabilitySets, actionModules]);

  const quickComposeStorageKey = useMemo(
    () => scopedStorageKey('workflow_quick_compose_action', preferenceScope),
    [preferenceScope]
  );

  const quickComposeOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    const allowEngine = (p: CustomAppModule) => {
      const eng = getCapabilityEngine(p);
      if (eng === 'gen_image' || eng === 'gen_text') return true;
      if (eng === 'builtin' && p.category === 'image_to_image') return true;
      return false;
    };
    for (const e of favoriteEntries) {
      if (e.kind !== 'module') continue;
      const p = e.mod;
      if (p.disabled || p.id === 'cut_image' || p.category === 'generate_3d') continue;
      if (!allowEngine(p)) continue;
      seen.add(p.id);
      out.push({ value: p.id, label: p.label });
    }
    for (const p of capabilityPresets) {
      if (p.disabled || seen.has(p.id) || p.id === 'cut_image' || p.category === 'generate_3d') continue;
      if (!allowEngine(p)) continue;
      seen.add(p.id);
      out.push({ value: p.id, label: p.label });
    }
    return out;
  }, [favoriteEntries, capabilityPresets]);

  useEffect(() => {
    if (quickComposeOptions.length === 0) {
      setQuickComposeActionId('');
      return;
    }
    const saved = readLocalJson<string>(quickComposeStorageKey, '', (parsed) =>
      typeof parsed === 'string' ? parsed : null
    );
    setQuickComposeActionId((cur) => {
      if (cur && quickComposeOptions.some((o) => o.value === cur)) return cur;
      if (saved && quickComposeOptions.some((o) => o.value === saved)) return saved;
      return quickComposeOptions[0]!.value;
    });
  }, [quickComposeOptions, quickComposeStorageKey]);

  useEffect(() => {
    if (!quickComposeActionId) return;
    writeLocalJson(quickComposeStorageKey, quickComposeActionId);
  }, [quickComposeActionId, quickComposeStorageKey]);

  const removeActionFromFavorite = useCallback((actionId: string) => {
    setFavoriteActionIds((prev) => prev.filter((id) => id !== actionId));
  }, []);
  const toggleSectionCollapsed = useCallback((sectionId: string) => {
    setCollapsedSectionIds((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }, []);

  const buildWorkflowSelectionDragSources = useCallback((): WorkflowDragSource[] => {
    if (showArchived) return [];
    if (selectedAssetIds.size > 0) {
      return [{ kind: 'root', assetIds: [...selectedAssetIds] }];
    }
    if (currentGroupAsset && selectedGroupItemKeys.size > 0) {
      const gid = currentGroupAsset.id;
      const prefix = `${gid}::`;
      const indexes: number[] = [];
      for (const key of selectedGroupItemKeys) {
        if (!key.startsWith(prefix)) continue;
        const idx = Number(key.slice(prefix.length));
        if (!Number.isNaN(idx) && idx >= 0) indexes.push(idx);
      }
      const uniq = [...new Set(indexes)].sort((a, b) => a - b);
      if (uniq.length > 0) return [{ kind: 'group', groupAssetId: gid, itemIndexes: uniq }];
    }
    return [];
  }, [showArchived, selectedAssetIds, currentGroupAsset, selectedGroupItemKeys]);

  const handleDropToModuleAction = useCallback(
    (
      mod: CustomAppModule,
      tweakPrompt = false,
      dropEvent?: React.DragEvent,
      groupOverrides?: WorkflowGroupOverrides,
      explicitSources?: WorkflowDragSource[]
    ) => {
      const sources =
        explicitSources !== undefined
          ? explicitSources
          : resolveCapabilityDropDragSources(
              draggingAssetIds,
              draggingGroupItems,
              dropEvent?.dataTransfer ?? null
            );
      if (sources.length === 0) return;

      const collectPromptTargets = (incoming: WorkflowDragSource[]): PromptTweakTarget[] => {
        const targets: PromptTweakTarget[] = [];
        for (const source of incoming) {
          if (source.kind === 'root') {
            const effectiveIds = getEffectiveAssetIdsForAction(source.assetIds).filter((id) => {
              const x = assets.find((a) => a.id === id);
              if (x == null || !workflowAssetAllowedForCapabilityDrop(x, mod)) return false;
              if (isWorkflowTextAsset(x)) {
                if (workflowPresetAcceptsTextCardDrag(mod)) return true;
                return getAssetDisplayImage(x).trim() !== '';
              }
              return true;
            });
            effectiveIds.forEach((id) => {
              const a = assets.find((x) => x.id === id);
              if (a) {
                targets.push({
                  assetId: id,
                  inputImage: getAssetDisplayImage(a),
                  inputSourceDisplayKey: a.displayKey,
                  ...(isWorkflowTextAsset(a) ? { inputText: workflowAssetToInputText(a) } : {}),
                });
              }
            });
          } else {
            const group = assets.find((x) => x.id === source.groupAssetId);
            // 优先使用新版 isGroup 结构，否则兼容旧版 cutImageGroup
            const cut = isGroupAsset(group) ? group?.assetIds : group?.cutImageGroup;
            if (!group || !cut?.length) continue;
            const groupId = group.id;
            for (const itemIndex of source.itemIndexes) {
              const item = cut[itemIndex];
              if (!item) continue;
              // 新版 assetIds 是字符串数组
              if (Array.isArray(cut) && typeof item === 'string') {
                const child = assets.find((x) => x.id === item);
                if (!child || !workflowAssetAllowedForCapabilityDrop(child, mod)) continue;
                const passChildText =
                  !isWorkflowTextAsset(child) ||
                  workflowPresetAcceptsTextCardDrag(mod) ||
                  (workflowAssetAllowedForCapabilityDrop(child, mod) && getAssetDisplayImage(child).trim() !== '');
                if (passChildText) {
                  targets.push({
                    assetId: child.id,
                    inputImage: getAssetDisplayImage(child),
                    inputSourceDisplayKey: child.displayKey,
                    sourceGroupAssetId: groupId,
                    sourceItemIndex: itemIndex,
                  });
                }
                continue;
              }
              // 旧版 cutImageGroup 格式
              if (typeof item === 'string') {
                targets.push({
                  imageBase64: item,
                  parentAssetId: groupId,
                  sourceGroupAssetId: groupId,
                  sourceItemIndex: itemIndex,
                });
              } else if (item && typeof item === 'object' && 'assetId' in item) {
                const child = assets.find((x) => x.id === (item as { assetId: string }).assetId);
                if (!child || !workflowAssetAllowedForCapabilityDrop(child, mod)) continue;
                const passLegacyChildText =
                  !isWorkflowTextAsset(child) ||
                  workflowPresetAcceptsTextCardDrag(mod) ||
                  (workflowAssetAllowedForCapabilityDrop(child, mod) && getAssetDisplayImage(child).trim() !== '');
                if (passLegacyChildText) {
                  targets.push({
                    assetId: child.id,
                    inputImage: getAssetDisplayImage(child),
                    inputSourceDisplayKey: child.displayKey,
                    sourceGroupAssetId: groupId,
                    sourceItemIndex: itemIndex,
                    ...(isWorkflowTextAsset(child) ? { inputText: workflowAssetToInputText(child) } : {}),
                  });
                }
              }
            }
          }
        }
        return targets;
      };

      if (tweakPrompt) {
        const targets = collectPromptTargets(sources);
        if (targets.length > 0) {
          setPromptTweakModal({
            preset: mod,
            targets,
            overrides: groupOverrides,
            mode: 'replace',
            initialText: mod.instruction || '',
            titleText: `微调提示词 · ${mod.label}`,
            helperText: `可修改下方提示词后加入执行队列（${targets.length} 项）`,
            placeholderText: '预设提示词',
            requireNonEmpty: false,
          });
        }
        return;
      }

      if (mod.category === 'text_to_text' && mod.requirePromptOnTextDrop === true) {
        const targets = collectPromptTargets(sources);
        if (targets.length > 0) {
          setPromptTweakModal({
            preset: mod,
            targets,
            overrides: groupOverrides,
            mode: 'append',
            initialText: '',
            titleText: `输入临时提示词 · ${mod.label}`,
            helperText: `请输入本次额外要求（必填，${targets.length} 项）；提交后将与预设提示词一起发送。`,
            placeholderText: '请输入本次临时提示词',
            requireNonEmpty: true,
          });
        }
        return;
      }
      const queueOverrideOptions =
        groupOverrides && getCapabilityEngine(mod) === 'gen_image'
          ? {
              ...(groupOverrides.imageGear ? { overrideImageGear: groupOverrides.imageGear } : {}),
              ...(groupOverrides.imageAspectRatio ? { overrideImageAspectRatio: groupOverrides.imageAspectRatio } : {}),
              ...(groupOverrides.imageSize ? { overrideImageSize: groupOverrides.imageSize } : {}),
              ...(typeof groupOverrides.understand === 'boolean'
                ? { overrideSkipUnderstand: groupOverrides.understand }
                : {}),
            }
          : undefined;
      const generateCountApplies =
        getCapabilityEngine(mod) === 'gen_image' || mod.category === 'text_to_text';
      const generateCount =
        groupOverrides && generateCountApplies
          ? normalizeWorkflowGenerateCount(groupOverrides.generateCount)
          : 1;
      if (
        generateCount > WORKFLOW_GROUP_GENERATE_CONFIRM_THRESHOLD &&
        typeof window !== 'undefined' &&
        !window.confirm(`当前生成数量为 ${generateCount}，将创建大量任务，是否继续？`)
      ) {
        return;
      }

      for (const source of sources) {
        if (source.kind === 'root') {
          const effectiveIds = getEffectiveAssetIdsForAction(source.assetIds).filter((id) => {
            const x = assets.find((a) => a.id === id);
            if (x == null || !workflowAssetAllowedForCapabilityDrop(x, mod)) return false;
            if (isWorkflowTextAsset(x)) {
              if (workflowPresetAcceptsTextCardDrag(mod)) return true;
              return getAssetDisplayImage(x).trim() !== '';
            }
            return true;
          });
          const allowTextAssetsForGenerateCount =
            mod.category === 'text_to_text' || mod.category === 'text_to_image';
          const { rootIds, cloneTaskSeeds } =
            generateCount > 1
              ? expandRootAssetsForGenerateCount(effectiveIds, generateCount, {
                  allowTextAssetsForExpansion: allowTextAssetsForGenerateCount,
                  allowTextAssetsForGrouping: allowTextAssetsForGenerateCount,
                })
              : { rootIds: effectiveIds, cloneTaskSeeds: [] as Array<{ sourceAsset: WorkflowAsset; targetAssetId: string }> };
          const rootTasks: WorkflowPendingTask[] = [];
          for (const id of rootIds) {
            const task = makePendingTaskForAsset(id, mod.id, queueOverrideOptions);
            if (task) rootTasks.push(task);
          }
          for (const seed of cloneTaskSeeds) {
            const task = buildPendingTaskFromAssetSnapshot(
              seed.sourceAsset,
              seed.targetAssetId,
              mod.id,
              queueOverrideOptions
            );
            if (task) rootTasks.push(task);
          }
          if (rootTasks.length > 0) setPending((prev) => [...prev, ...rootTasks]);
          continue;
        }
        const groupAssetForSrc = assets.find((x) => x.id === source.groupAssetId);
        const cut = isGroupAsset(groupAssetForSrc) ? groupAssetForSrc?.assetIds : groupAssetForSrc?.cutImageGroup;
        if (!groupAssetForSrc || !cut?.length) continue;
        const groupId = groupAssetForSrc.id;
        for (const itemIndex of source.itemIndexes) {
          const item = cut[itemIndex];
          if (!item) continue;
          if (typeof item === 'string') {
            addImageToPending(item, mod.id, {
              parentAssetId: groupId,
              sourceGroupAssetId: groupId,
              sourceItemIndex: itemIndex,
              ...(queueOverrideOptions ?? {}),
            });
          } else {
            const child = assets.find((x) => x.id === (item as { assetId: string }).assetId);
            if (!child || !workflowAssetAllowedForCapabilityDrop(child, mod)) continue;
            addToPending(child.id, mod.id, {
              sourceGroupAssetId: groupId,
              sourceItemIndex: itemIndex,
              ...(queueOverrideOptions ?? {}),
            });
          }
        }
      }
    },
    [
      draggingAssetIds,
      draggingGroupItems,
      getEffectiveAssetIdsForAction,
      assets,
      getAssetDisplayImage,
      addToPending,
      addImageToPending,
      makePendingTaskForAsset,
      buildPendingTaskFromAssetSnapshot,
      expandRootAssetsForGenerateCount,
      setPending,
      setPromptTweakModal,
    ]
  );

  const handleActivatePresetFromEditorDrop = useCallback(
    (presetId: string) => {
      const raw = capabilityPresets.find((p) => p.id === presetId);
      if (!raw) {
        onLog?.('warn', '未找到该能力预设', presetId);
        return;
      }
      if (raw.enabled === false) {
        if (!onUpdateCapabilityPresets) {
          onLog?.('warn', '无法启用已禁用的预设：未连接保存');
          return;
        }
        onUpdateCapabilityPresets(capabilityPresets.map((p) => (p.id === presetId ? { ...p, enabled: true } : p)));
      }
      const mod: CustomAppModule = { ...raw, enabled: true };
      const sources = buildWorkflowSelectionDragSources();
      if (sources.length === 0) {
        onLog?.('info', `已就绪「${mod.label}」：请选中工作区图片后拖入功能块，或再次从能力区拖入此处执行`);
        return;
      }
      handleDropToModuleAction(mod, false, undefined, undefined, sources);
    },
    [
      capabilityPresets,
      onUpdateCapabilityPresets,
      onLog,
      buildWorkflowSelectionDragSources,
      handleDropToModuleAction,
    ]
  );

  const handlePresetActionDrop = useCallback(
    (action: 'edit' | 'copy' | 'delete', presetId: string) => {
      const preset = capabilityPresets.find((p) => p.id === presetId);
      if (!preset) {
        onLog?.('warn', '未找到该能力预设', presetId);
        return;
      }
      if (action === 'edit') {
        jumpToCapabilityPreset(preset);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('ac:capability-preset-open-detail', {
              detail: { presetId, edit: true },
            })
          );
        }
        onLog?.('info', `已打开能力预设编辑：${preset.label}`);
        return;
      }
      if (action === 'copy') {
        if (!onUpdateCapabilityPresets) {
          onLog?.('warn', '无法复制能力预设：未连接保存');
          return;
        }
        const copiedLabelBase = `${preset.label} 副本`;
        const taken = new Set(capabilityPresets.map((p) => p.label.trim()));
        let copiedLabel = copiedLabelBase;
        let suffix = 2;
        while (taken.has(copiedLabel)) {
          copiedLabel = `${copiedLabelBase} ${suffix}`;
          suffix += 1;
        }
        const maxOrder = capabilityPresets.reduce((m, p, idx) => Math.max(m, typeof p.order === 'number' ? p.order : idx), 0);
        const copiedPreset: CustomAppModule = {
          ...preset,
          id: `preset_${uuid()}`,
          label: copiedLabel,
          order: maxOrder + 1,
        };
        onUpdateCapabilityPresets([...capabilityPresets, copiedPreset]);
        onLog?.('info', `已复制能力预设：${preset.label} → ${copiedLabel}`);
        return;
      }
      if (!onUpdateCapabilityPresets) {
        onLog?.('warn', '无法删除能力预设：未连接保存');
        return;
      }
      if (BUILTIN_IMAGE_PROCESS_IDS.includes(preset.id as (typeof BUILTIN_IMAGE_PROCESS_IDS)[number])) {
        onLog?.('warn', `内置能力「${preset.label}」不可删除`);
        return;
      }
      onUpdateCapabilityPresets(capabilityPresets.filter((p) => p.id !== presetId));
      onLog?.('info', `已删除能力预设：${preset.label}`);
    },
    [capabilityPresets, jumpToCapabilityPreset, onLog, onUpdateCapabilityPresets]
  );

  const handleComposeCapabilities = useCallback(
    (sourcePresetId: string, targetPresetId: string) => {
      const a = capabilityPresets.find((p) => p.id === sourcePresetId);
      const b = capabilityPresets.find((p) => p.id === targetPresetId);
      if (!a || !b) {
        onLog?.('warn', '仅能对已存在的能力预设创建工作流');
        return;
      }
      const id = uuid();
      setComposerSessions((prev) => [
        ...prev,
        { id, initialSet: buildWorkflowComposerSeedFromTwoPresets(a, b), sessionKey: Date.now() },
      ]);
      setComposerActiveId(id);
    },
    [capabilityPresets, onLog]
  );
  const openUnifiedComposer = useCallback((initialSet: CapabilitySet | null) => {
    const id = uuid();
    setComposerSessions((prev) => [...prev, { id, initialSet, sessionKey: Date.now() }]);
    setComposerActiveId(id);
  }, []);
  const closeComposerSession = useCallback((id: string) => {
    setComposerSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      const wasActive = composerActiveIdRef.current === id;
      if (wasActive) {
        const nextActive = next[0]?.id ?? null;
        composerActiveIdRef.current = nextActive;
        setComposerActiveId(nextActive);
      }
      return next;
    });
    setComposerMinimized((m) => {
      if (!(id in m)) return m;
      const { [id]: _, ...rest } = m;
      return rest;
    });
  }, []);
  const getComposerDockStackIndex = useCallback(
    (sessionId: string) => {
      const minimizedOrdered = composerSessions.filter((s) => composerMinimized[s.id]);
      const idx = minimizedOrdered.findIndex((s) => s.id === sessionId);
      if (idx >= 0) return idx;
      return minimizedOrdered.length;
    },
    [composerSessions, composerMinimized]
  );
  const getComposerDockStackCount = useCallback(
    (sessionId: string) => {
      const minimizedOrdered = composerSessions.filter((s) => composerMinimized[s.id]);
      if (composerMinimized[sessionId]) {
        return Math.max(1, minimizedOrdered.length);
      }
      return Math.max(1, minimizedOrdered.length + 1);
    },
    [composerSessions, composerMinimized]
  );

  const handleComposerSave = useCallback(
    (set: CapabilitySet) => {
      if (!onUpdateCapabilitySets) {
        onLog?.('warn', '无法保存工作流：未连接复合能力存储');
        return;
      }
      const next = capabilitySets.some((s) => s.id === set.id)
        ? capabilitySets.map((s) => (s.id === set.id ? set : s))
        : [...capabilitySets, set];
      onUpdateCapabilitySets(next);
      onLog?.('info', `已保存工作流：${set.label}`);
    },
    [capabilitySets, onUpdateCapabilitySets, onLog]
  );

  const getComposerPartialTestInputImage = useCallback((): string | null => {
    if (lightboxAsset && !isWorkflowTextAsset(lightboxAsset)) {
      const img = getAssetDisplayImage(lightboxAsset);
      return img.trim() || null;
    }
    for (const id of Array.from(selectedAssetIds)) {
      const a = assets.find((x) => x.id === id);
      if (!a || isWorkflowTextAsset(a)) continue;
      const img = getAssetDisplayImage(a);
      if (img.trim()) return img.trim();
    }
    return null;
  }, [lightboxAsset, selectedAssetIds, assets, getAssetDisplayImage]);

  const composerAssetCandidates = useMemo<CapabilityAssetCandidate[]>(() => {
    const out: CapabilityAssetCandidate[] = [];
    for (const a of assets) {
      const label = a.groupLabel?.trim() || `资产 ${a.id.slice(0, 6)}`;
      const scope = a.inRepository ? 'repository' : 'workspace';
      if (isWorkflowTextAsset(a)) {
        const textContent = workflowAssetToInputText(a).trim();
        if (!textContent) continue;
        out.push({
          id: a.id,
          label,
          scope,
          image: buildComposerTextAssetThumbDataUrl(a.textTitle || '', getAssetDisplayText(a)),
          textContent,
        });
        continue;
      }
      const img = getAssetDisplayImage(a).trim();
      if (!img) continue;
      out.push({ id: a.id, label, scope, image: img });
    }
    return out.sort((x, y) => x.label.localeCompare(y.label, 'zh-CN'));
  }, [assets, getAssetDisplayImage, getAssetDisplayText]);

  const handleDropToSetAction = useCallback(
    (setActionId: string, dropEvent?: React.DragEvent) => {
      const sources = resolveCapabilityDropDragSources(
        draggingAssetIds,
        draggingGroupItems,
        dropEvent?.dataTransfer ?? null
      );
      if (sources.length === 0) return;
      for (const source of sources) {
        if (source.kind === 'root') {
          const effectiveIds = getEffectiveAssetIdsForAction(source.assetIds).filter((id) => {
            const x = assets.find((a) => a.id === id);
            return x && !isWorkflowTextAsset(x);
          });
          effectiveIds.forEach((id) => addToPending(id, setActionId));
          continue;
        }
        const groupAssetForSrc = assets.find((x) => x.id === source.groupAssetId);
        const cut = isGroupAsset(groupAssetForSrc) ? groupAssetForSrc?.assetIds : groupAssetForSrc?.cutImageGroup;
        if (!groupAssetForSrc || !cut?.length) continue;
        const groupId = groupAssetForSrc.id;
        for (const itemIndex of source.itemIndexes) {
          const item = cut[itemIndex];
          if (!item) continue;
          if (typeof item === 'string') {
            addImageToPending(item, setActionId, {
              parentAssetId: groupId,
              sourceGroupAssetId: groupId,
              sourceItemIndex: itemIndex,
            });
          } else {
            const child = assets.find((x) => x.id === (item as { assetId: string }).assetId);
            if (child && isWorkflowTextAsset(child)) continue;
            const inputImage = child ? getAssetDisplayImage(child) : '';
            setPending((prev) => [
              ...prev,
              {
                id: uuid(),
                assetId: (item as { assetId: string }).assetId,
                actionType: setActionId,
                inputImage,
                addedAt: Date.now(),
                inputSourceDisplayKey: child?.displayKey,
                sourceGroupAssetId: groupId,
                sourceItemIndex: itemIndex,
              },
            ]);
          }
        }
      }
    },
    [
      draggingAssetIds,
      draggingGroupItems,
      getEffectiveAssetIdsForAction,
      addToPending,
      addImageToPending,
      assets,
      getAssetDisplayImage,
      setPending,
    ]
  );

  const importLibraryItemsIntoWorkflow = useCallback(
    (items: Array<WorkflowAsset | LibraryItem>) => {
      const workflowIds = new Set<string>();
      const externalImages: string[] = [];
      items.forEach((item) => {
        if (!item) return;
        if ('type' in item && item.type) {
          if (item.id) workflowIds.add(item.id);
        } else if (!('inRepository' in item)) {
          /* 预留：外链图等 */
        }
      });
      if (workflowIds.size === 0 && externalImages.length === 0) return;

      const prevSnap = assetsRef.current;
      const clones: WorkflowAsset[] = [];
      if (workflowIds.size > 0) {
        const sourceAssets = prevSnap.filter((a) => workflowIds.has(a.id));
        sourceAssets.forEach((a, idx) => {
          clones.push({
            ...a,
            id: uuid(),
            parentAssetId: undefined,
            inRepository: false,
            archived: false,
            hiddenInGrid: false,
            createdAt: Date.now() + idx,
          });
        });
      }
      const createdExternal: WorkflowAsset[] = [];
      if (externalImages.length > 0) {
        const baseT = Date.now();
        const n = externalImages.length;
        externalImages.forEach((src, idx) => {
          createdExternal.push({
            id: uuid(),
            original: src,
            displayKey: 'original',
            results: {},
            resultOrder: [],
            archived: false,
            hiddenInGrid: false,
            inRepository: false,
            createdAt: baseT + (n - 1 - idx),
          });
        });
      }

      setAssets((prev) => {
        let next = [...prev];
        if (clones.length) next = next.concat(clones);
        if (createdExternal.length) next = next.concat(createdExternal);
        return next;
      });
      for (const c of clones) {
        const o = String(c.original || '').trim();
        if (o) scheduleCompanionPersistOriginalAny(c.id, o);
      }
      for (const c of createdExternal) {
        const o = String(c.original || '').trim();
        if (o) scheduleCompanionPersistOriginalAny(c.id, o);
      }
      setWorkspacePane(2);
    },
    [setAssets, scheduleCompanionPersistOriginalAny, setWorkspacePane]
  );

  const handleOutlineDropToWorkspace = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const sources = parseAcWorkflowExportDragSources(e.dataTransfer);
      const rootIds = new Set<string>();
      sources.forEach((src) => {
        if (src.kind === 'root') src.assetIds.forEach((id) => rootIds.add(id));
      });
      if (rootIds.size === 0) return;
      const picked = repositoryVisibleItems.filter((i) => rootIds.has(i.id));
      if (!picked.length) return;
      importLibraryItemsIntoWorkflow(picked);
    },
    [repositoryVisibleItems, importLibraryItemsIntoWorkflow]
  );

  const handleOutlineDropToLibrary = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!onAddToLibrary) {
        onLog?.('warn', '未配置外部仓库写入，改为工作区内仓库切换', undefined);
      }
      const sources = parseAcWorkflowExportDragSources(e.dataTransfer);
      const rootIds = new Set<string>();
      sources.forEach((src) => {
        if (src.kind === 'root') src.assetIds.forEach((id) => rootIds.add(id));
      });
      if (rootIds.size === 0) {
        onLog?.('warn', '未写入仓库', '仅支持根资产');
        return;
      }
      setAssets((prev) => prev.map((a) => (rootIds.has(a.id) ? { ...a, inRepository: true, hiddenInGrid: false } : a)));
      onLog?.('info', `已写入仓库 ${rootIds.size} 条`, undefined);
    },
    [onAddToLibrary, onLog, setAssets]
  );

  const activePaneNode = Math.max(0, Math.min(3, Math.round(workspacePane)));
  const topTitleColumns = useMemo(() => {
    const outlineExpandDisabled =
      outlineExpandableGroupIds.size === 0 || outlineCollapsedIds.size === 0;
    const outlineCollapseDisabled =
      outlineExpandableGroupIds.size === 0 ||
      [...outlineExpandableGroupIds].every((id) => outlineCollapsedIds.has(id));

    /** 第 0 页：大纲列对应仓库条目列表 */
    const outlineRepoTopBarColumn = {
      title: '大纲',
      desc: repositoryOutlineMode === 'tags' ? '按标签筛选仓库资产（支持多选）' : '当前筛选下的仓库条目；点击行预览大图',
      actions: (
        <div className="flex flex-wrap items-center gap-1.5 whitespace-nowrap">
          <button
            type="button"
            onClick={() => setRepositoryOutlineMode('list')}
            className={repositoryOutlineMode === 'list' ? TITLE_ROW_BTN_ACTIVE : TITLE_ROW_BTN_NEUTRAL}
          >
            列表
          </button>
          <button
            type="button"
            onClick={() => setRepositoryOutlineMode('tags')}
            className={repositoryOutlineMode === 'tags' ? TITLE_ROW_BTN_ACTIVE : TITLE_ROW_BTN_NEUTRAL}
          >
            标签
          </button>
          {repositorySelectedTags.size > 0 && (
            <button type="button" onClick={() => setRepositorySelectedTags(new Set())} className={TITLE_ROW_BTN_NEUTRAL}>
              清空标签（{repositorySelectedTags.size}）
            </button>
          )}
        </div>
      ),
    };

    /** 第 1 页起：工作区资产树大纲 */
    const outlineWorkflowTopBarColumn = {
      title: '大纲',
      desc: '窄栏与功能区同宽；与工作区同屏时在视口右侧',
      actions: (
        <div className="flex flex-wrap items-center gap-1.5 whitespace-nowrap">
          <button
            type="button"
            onClick={expandOutlineAll}
            disabled={outlineExpandDisabled}
            className={TITLE_ROW_BTN_NEUTRAL}
          >
            展开
          </button>
          <button
            type="button"
            onClick={collapseOutlineAll}
            disabled={outlineCollapseDisabled}
            className={TITLE_ROW_BTN_NEUTRAL}
          >
            折叠
          </button>
        </div>
      ),
    };

    if (activePaneNode === 0) {
      return [
        {
          title: '资产仓库',
          desc: '筛选后点击预览；列数与工作区画布共用设置；右侧大纲支持列表/标签模式',
          actions: (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
              <span className="shrink-0 text-[8px] font-black uppercase tracking-wide text-gray-500">筛选</span>
              <input
                value={libraryTagQuery}
                onChange={(e) => setLibraryTagQuery(e.target.value)}
                placeholder="标签检索：style:anime lighting:neon"
                className={TITLE_ROW_TAG_FILTER_INPUT}
              />
              <button
                type="button"
                onClick={() => setLibraryFilter('all')}
                className={libraryFilter === 'all' ? TITLE_ROW_BTN_ACTIVE : TITLE_ROW_BTN_NEUTRAL}
              >
                全部
              </button>
              <button
                type="button"
                onClick={() => setLibraryFilter('library')}
                className={libraryFilter === 'library' ? TITLE_ROW_BTN_ACTIVE : TITLE_ROW_BTN_NEUTRAL}
              >
                仓库
              </button>
              <button
                type="button"
                onClick={() => setLibraryFilter('archived')}
                className={libraryFilter === 'archived' ? TITLE_ROW_BTN_ACTIVE : TITLE_ROW_BTN_NEUTRAL}
              >
                归档
              </button>
              <div className={TITLE_ROW_STEPPER_SHELL}>
                <button
                  type="button"
                  onClick={() => setColumnCount((n) => Math.max(2, n - 1))}
                  disabled={columnCount <= 2}
                  className={TITLE_ROW_STEPPER_BTN}
                  aria-label="减少列数"
                >
                  −
                </button>
                <span className={TITLE_ROW_STEPPER_VALUE}>{columnCount}</span>
                <button
                  type="button"
                  onClick={() => setColumnCount((n) => Math.min(6, n + 1))}
                  disabled={columnCount >= 6}
                  className={TITLE_ROW_STEPPER_BTN}
                  aria-label="增加列数"
                >
                  +
                </button>
              </div>
            </div>
          ),
        },
        outlineRepoTopBarColumn,
      ];
    }
    if (activePaneNode === 1 || activePaneNode === 2) {
      const selectableCount = visibleAssets.filter(
        (a) => !isGroupAsset(a) && !pending.some((t) => t.assetId === a.id)
      ).length;
      const allSelectableIds = new Set(
        visibleAssets
          .filter((a) => !isGroupAsset(a) && !pending.some((t) => t.assetId === a.id))
          .map((a) => a.id)
      );
      const allSelected = selectedAssetIds.size === selectableCount && selectableCount > 0;
      const inGroupView = !!currentGroupAsset;
      const groupSelectableKeys =
        currentGroupAsset && !showAllInGroup
          ? currentGroupMemberIds
              .map((_, i) => `${currentGroupAsset.id}::${i}`)
              .filter(
                (_, i) =>
                  !pending.some(
                    (t) =>
                      t.sourceGroupAssetId === currentGroupAsset.id &&
                      t.sourceItemIndex === i
                  )
              )
          : [];
      const groupAllSelected =
        inGroupView &&
        groupSelectableKeys.length > 0 &&
        selectedGroupItemKeys.size === groupSelectableKeys.length;

      const workspaceAndFunctionCols = [
        {
          title: inGroupView
            ? selectedGroupItemKeys.size > 0
              ? `工作区 · 已选 ${selectedGroupItemKeys.size}`
              : '工作区'
            : selectedAssetIds.size > 0
            ? `工作区 · 已选 ${selectedAssetIds.size}`
            : '工作区',
          desc: '工作区资产管理',
          actions: (
            <>
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <div className={TITLE_ROW_STEPPER_SHELL}>
                  <button
                    type="button"
                    onClick={() => setColumnCount((n) => Math.max(2, n - 1))}
                    disabled={columnCount <= 2}
                    className={TITLE_ROW_STEPPER_BTN}
                    aria-label="减少列数"
                  >
                    −
                  </button>
                  <span className={TITLE_ROW_STEPPER_VALUE}>{columnCount}</span>
                  <button
                    type="button"
                    onClick={() => setColumnCount((n) => Math.min(6, n + 1))}
                    disabled={columnCount >= 6}
                    className={TITLE_ROW_STEPPER_BTN}
                    aria-label="增加列数"
                  >
                    +
                  </button>
                </div>
              </div>
              {archiveHint && !showArchived && (
                <div className="flex h-7 items-center gap-1.5 rounded-md bg-[#152642] px-2.5 text-[8px] text-blue-200 ring-1 ring-blue-500/35">
                  <span className="font-black uppercase tracking-wide">已归档</span>
                  <span className="text-gray-300">已移入资产仓库</span>
                </div>
              )}
              {!showArchived && (inGroupView || visibleAssets.length > 0) && (
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => {
                      if (!inGroupView) setGroupFilterId(null);
                      setShowAllInGroup((v) => !v);
                      setSelectedGroupItemKeys(new Set());
                    }}
                    className={TITLE_ROW_BTN_NEUTRAL}
                  >
                    {showAllInGroup ? '显示层级' : '显示全部'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (inGroupView) {
                        const allKeys = new Set(groupSelectableKeys);
                        setSelectedGroupItemKeys((prev) =>
                          prev.size === allKeys.size ? new Set() : allKeys
                        );
                        return;
                      }
                      setSelectedRootAssetIds((prev) =>
                        prev.size === allSelectableIds.size ? new Set() : allSelectableIds
                      );
                    }}
                    className={TITLE_ROW_BTN_NEUTRAL}
                  >
                    {inGroupView
                      ? groupAllSelected
                        ? '取消全选'
                        : '全选'
                      : allSelected
                      ? '取消全选'
                      : '全选'}
                  </button>
                </div>
              )}
            </>
          ),
        },
        {
          title: '功能区',
          desc: '基础能力与复合能力',
          actions: (
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <button
                type="button"
                onClick={() => executePending()}
                disabled={pending.length === 0 || executing}
                className={TITLE_ROW_BTN_PRIMARY}
              >
                {executing
                  ? `执行中 ${executingQueueDoneCount}/${executingQueue?.total ?? 0}`
                  : `一键执行（${pending.length}）`}
              </button>
              {(pending.length > 0 || executingQueue) && (
                <div className={TITLE_ROW_QUEUE_CHIP}>
                  {executingQueue ? (
                    <>
                      <span className="text-[8px] font-black uppercase text-blue-300">执行中</span>
                      <span className="text-[8px] text-gray-300">
                        {executingQueueDoneCount} / {executingQueue.total}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[8px] font-black uppercase text-blue-300">待处理</span>
                      <span className="text-[8px] text-gray-300">{pending.length} 项等待执行</span>
                      <button
                        type="button"
                        onClick={() => setPending([])}
                        className="text-[8px] text-blue-400 hover:text-blue-300 font-medium ml-1 leading-none"
                      >
                        清空
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ),
        },
      ];
      if (activePaneNode === 1) return [workspaceAndFunctionCols[0]!, outlineWorkflowTopBarColumn];
      return [workspaceAndFunctionCols[1]!, workspaceAndFunctionCols[0]!];
    }
    return [
      {
        title: '功能区',
        desc: '基础能力与复合能力',
        actions: (
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <button
              type="button"
              onClick={() => executePending()}
              disabled={pending.length === 0 || executing}
              className={TITLE_ROW_BTN_PRIMARY}
            >
              {executing
                ? `执行中 ${executingQueueDoneCount}/${executingQueue?.total ?? 0}`
                : `一键执行（${pending.length}）`}
            </button>
            {(pending.length > 0 || executingQueue) && (
              <div className={TITLE_ROW_QUEUE_CHIP}>
                {executingQueue ? (
                  <>
                    <span className="text-[8px] font-black uppercase text-blue-300">执行中</span>
                    <span className="text-[8px] text-gray-300">
                      {executingQueueDoneCount} / {executingQueue.total}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-[8px] font-black uppercase text-blue-300">待处理</span>
                    <span className="text-[8px] text-gray-300">{pending.length} 项等待执行</span>
                    <button
                      type="button"
                      onClick={() => setPending([])}
                      className="text-[8px] text-blue-400 hover:text-blue-300 font-medium ml-1 leading-none"
                    >
                      清空
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ),
      },
      {
        title: '能力预设',
        desc: '当前能力配置与预设编辑',
        actions: (
          <div className="flex w-full min-w-0 items-center justify-between gap-1.5 whitespace-nowrap">
            <div className={TITLE_ROW_STEPPER_SHELL}>
              <button
                type="button"
                onClick={() => {
                  setCapabilityPresetViewMode('presets');
                  if (typeof window === 'undefined') return;
                  window.dispatchEvent(new CustomEvent('ac:capability-preset-view-mode', { detail: { mode: 'presets' } }));
                }}
                className={`h-7 px-2.5 text-[8px] font-black uppercase tracking-wide ${
                  capabilityPresetViewMode === 'presets'
                    ? 'bg-blue-600 text-white ring-1 ring-inset ring-blue-400/30'
                    : 'text-gray-300 hover:bg-white/[0.08]'
                }`}
              >
                基础能力
              </button>
              <button
                type="button"
                onClick={() => {
                  setCapabilityPresetViewMode('image_process');
                  if (typeof window === 'undefined') return;
                  window.dispatchEvent(new CustomEvent('ac:capability-preset-view-mode', { detail: { mode: 'image_process' } }));
                }}
                className={`h-7 border-l border-white/[0.08] px-2.5 text-[8px] font-black uppercase tracking-wide ${
                  capabilityPresetViewMode === 'image_process'
                    ? 'bg-blue-600 text-white ring-1 ring-inset ring-blue-400/30'
                    : 'text-gray-300 hover:bg-white/[0.08]'
                }`}
              >
                图像处理
              </button>
              <button
                type="button"
                onClick={() => {
                  setCapabilityPresetViewMode('sets');
                  if (typeof window === 'undefined') return;
                  window.dispatchEvent(new CustomEvent('ac:capability-preset-view-mode', { detail: { mode: 'sets' } }));
                }}
                className={`h-7 border-l border-white/[0.08] px-2.5 text-[8px] font-black uppercase tracking-wide ${
                  capabilityPresetViewMode === 'sets'
                    ? 'bg-blue-600 text-white ring-1 ring-inset ring-blue-400/30'
                    : 'text-gray-300 hover:bg-white/[0.08]'
                }`}
              >
                能力集合
              </button>
            </div>
            <div className="flex min-w-0 items-center justify-end gap-1.5">
              {(capabilityPresetViewMode === 'presets' || capabilityPresetViewMode === 'image_process') && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window === 'undefined') return;
                      window.dispatchEvent(new CustomEvent('ac:capability-preset-toolbar-action', { detail: { action: 'toggle-import-export' } }));
                    }}
                    className={TITLE_ROW_BTN_NEUTRAL}
                  >
                    导入/导出
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window === 'undefined') return;
                      window.dispatchEvent(new CustomEvent('ac:capability-preset-toolbar-action', { detail: { action: 'refresh-remote' } }));
                    }}
                    className={TITLE_ROW_BTN_NEUTRAL}
                  >
                    刷新同步
                  </button>
                  {capabilityPresetViewMode === 'presets' && (
                    <CustomDropdown
                      options={CAPABILITY_PRESET_TYPE_FILTER_OPTIONS}
                      value={capabilityPresetTypeFilter}
                      onChange={(value) => {
                        const filter = value as CapabilityPresetTypeFilter;
                        setCapabilityPresetTypeFilter(filter);
                        if (typeof window === 'undefined') return;
                        window.dispatchEvent(
                          new CustomEvent('ac:capability-preset-type-filter', { detail: { filter } })
                        );
                      }}
                      triggerClassName={TITLE_ROW_DROPDOWN_TRIGGER}
                    />
                  )}
                  {capabilityPresetViewMode === 'presets' && (
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof window === 'undefined') return;
                        window.dispatchEvent(new CustomEvent('ac:capability-preset-toolbar-action', { detail: { action: 'add-preset' } }));
                      }}
                      className={TITLE_ROW_BTN_ACTIVE}
                    >
                      新增能力
                    </button>
                  )}
                </>
              )}
              {capabilityPresetViewMode === 'sets' && (
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window === 'undefined') return;
                    window.dispatchEvent(new CustomEvent('ac:capability-preset-toolbar-action', { detail: { action: 'add-set' } }));
                  }}
                  className={TITLE_ROW_BTN_ACTIVE}
                >
                  添加能力集合
                </button>
              )}
              <div className={TITLE_ROW_STEPPER_SHELL}>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window === 'undefined') return;
                    window.dispatchEvent(
                      new CustomEvent('ac:capability-preset-column-count', { detail: { delta: -1 } })
                    );
                  }}
                  disabled={capabilityPresetColumnCount <= CAPABILITY_PRESET_COLUMNS_MIN}
                  className={TITLE_ROW_STEPPER_BTN}
                  aria-label="减少能力预设列数"
                >
                  −
                </button>
                <span className={TITLE_ROW_STEPPER_VALUE}>{capabilityPresetColumnCount}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window === 'undefined') return;
                    window.dispatchEvent(
                      new CustomEvent('ac:capability-preset-column-count', { detail: { delta: 1 } })
                    );
                  }}
                  disabled={capabilityPresetColumnCount >= CAPABILITY_PRESET_COLUMNS_MAX}
                  className={TITLE_ROW_STEPPER_BTN}
                  aria-label="增加能力预设列数"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        ),
      },
    ];
  }, [
    activePaneNode,
    archiveHint,
    columnCount,
    executing,
    executingQueue,
    executingQueueDoneCount,
    executePending,
    handleBatchUploadCorrect,
    importLibraryItemsIntoWorkflow,
    onOpenLibraryPicker,
    pending,
    currentGroupAsset,
    selectedAssetIds,
    selectedGroupItemKeys,
    showAllInGroup,
    setColumnCount,
    setPending,
    setSelectedRootAssetIds,
    setSelectedGroupItemKeys,
    setGroupFilterId,
    showArchived,
    visibleAssets,
    capabilityPresetViewMode,
    capabilityPresetTypeFilter,
    libraryFilter,
    repositoryOutlineMode,
    repositorySelectedTags,
    addWorkflowTextAsset,
    capabilityPresetColumnCount,
    currentGroupMemberIds,
    libraryTagQuery,
    outlineCollapsedIds,
    outlineExpandableGroupIds,
    expandOutlineAll,
    collapseOutlineAll,
  ]);
  const sidebarOpsAllowed = workflowDragSourceAllowsSidebarOps(
    parseWorkflowDragSource(draggingAssetIds, draggingGroupItems),
    showArchived
  );

  return (
    <>
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div className={`flex flex-col items-stretch gap-1.5 shrink-0 ${WORKFLOW_EDGE_GUTTER}`}>
        <div className="py-0.5" onWheelCapture={handlePaneWheel} data-workflow-topbar>
          <div className="flex min-h-7 items-center gap-1.5">
            {workspaceProjectChrome ? (
              <div className="mr-1 flex shrink-0 items-center gap-1 pr-1">
                <button
                  type="button"
                  onClick={() => {
                    void workspaceProjectChrome.onBackToProjectList();
                  }}
                  className={WORKFLOW_TOPBAR_ICON_BTN}
                  title="返回项目列表（将先同步到云端）"
                  aria-label="返回项目列表"
                >
                  <svg aria-hidden viewBox="0 0 20 20" className="h-3 w-3" fill="none">
                    <path
                      d="M12.5 4.5L7 10l5.5 5.5"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <div className="min-w-0 max-w-[min(11rem,32vw)]">
                  <CustomDropdown
                    options={workspaceProjectChrome.projectOptions}
                    value={workspaceProjectChrome.activeProjectId}
                    onChange={(id) => {
                      if (!id || id === workspaceProjectChrome.activeProjectId) return;
                      void workspaceProjectChrome.onSelectProject(id);
                    }}
                    placeholder={workspaceProjectChrome.activeProjectName || '项目'}
                    triggerAriaLabel={`当前项目：${workspaceProjectChrome.activeProjectName || '选择项目'}`}
                    renderTrigger={({ open }) => (
                      <span
                        className={`flex h-7 min-w-0 max-w-full items-center gap-1 rounded-md bg-white/[0.05] px-2 outline-none ring-1 transition-colors ${
                          open
                            ? 'shadow-[inset_0_0_0_1px_rgba(59,130,246,0.35)] ring-blue-500/50'
                            : 'ring-white/[0.06] hover:bg-white/[0.09]'
                        }`}
                        title={workspaceProjectChrome.activeProjectName || '切换项目'}
                      >
                        <svg viewBox="0 0 20 20" className="h-3 w-3 shrink-0 text-blue-300/90" fill="none" aria-hidden>
                          <path
                            d="M4 6.5h12v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Z"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinejoin="round"
                          />
                          <path d="M4 8.5h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                        <span className="min-w-0 truncate text-[8px] font-black uppercase leading-none tracking-wide text-gray-300">
                          {workspaceProjectChrome.activeProjectName || '项目'}
                        </span>
                      </span>
                    )}
                    triggerClassName="w-full min-w-0 p-0 border-0 bg-transparent"
                    portalZIndex={{ backdrop: 1100, list: 1101 }}
                  />
                </div>
              </div>
            ) : null}
            <div
              className="flex shrink-0 items-center gap-0.5"
              role="group"
              aria-label="卷轴分档：1 能力 2 功能区+工作区 3 工作区+大纲 4 仓库"
            >
              {(
                [
                  { pane: 3 as const, k: '1', t: '能力 + 功能区' },
                  { pane: 2 as const, k: '2', t: '功能区 + 工作区' },
                  { pane: 1 as const, k: '3', t: '工作区 + 大纲' },
                  { pane: 0 as const, k: '4', t: '大纲 + 仓库' },
                ] as const
              ).map(({ pane, k, t }) => {
                const on = Math.round(workspacePane) === pane;
                return (
                  <button
                    key={pane}
                    type="button"
                    title={t}
                    onClick={() => snapWorkspacePaneToNode(pane)}
                    className={`h-7 min-w-[1.625rem] rounded-[0.2rem] px-1 text-[8px] font-black tabular-nums tracking-wide transition-colors ${
                      on
                        ? 'bg-blue-600 text-white ring-1 ring-inset ring-blue-400/35'
                        : 'text-gray-400 hover:bg-white/[0.07] hover:text-gray-200'
                    }`}
                  >
                    {k}
                  </button>
                );
              })}
            </div>
            <div className="flex min-h-7 min-w-0 flex-1 items-center gap-2 overflow-x-auto pl-1.5 no-scrollbar">
              {topTitleColumns.map((item) => (
                <div key={item.title} className="flex shrink-0 items-center gap-1 pr-1">
                  <span
                    className="max-w-[6.5rem] min-w-0 whitespace-normal break-words line-clamp-2 leading-tight text-[8px] font-black uppercase tracking-wide text-blue-300/90"
                    title={item.desc}
                  >
                    {item.title}
                  </span>
                  {item.actions ? (
                    <div className="flex shrink-0 flex-nowrap items-center gap-1">{item.actions}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2.5 h-0.5 w-full overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
            <div
              className="h-full rounded-full bg-blue-500/40 transition-[width] duration-150 ease-out"
              style={{
                width: `${Math.max(0, Math.min(100, ((3 - workspacePane) / 3) * 100))}%`,
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden min-w-0">
        <div
          ref={workspaceViewportRef}
          className={`flex-1 min-h-0 overflow-hidden ${spacePanEnabled ? (spacePanDragging ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
          onClickCapture={(e) => {
            if (!suppressClickAfterPanRef.current) return;
            suppressClickAfterPanRef.current = false;
            e.preventDefault();
            e.stopPropagation();
          }}
          {...workspaceViewportTouchHandlers}
        >
          <div
            ref={workspaceTrackRef}
            className="flex h-full will-change-transform motion-reduce:transition-none"
            style={{ width: `${trackTotalWidth}px` }}
          >
        {/* 从左到右：能力预设 | 功能区 | 工作区 | 大纲 | 仓库（前两列锁在同一 flex 行内，避免被压成上下叠） */}
        <div
          className="flex h-full min-h-0 shrink-0 flex-row flex-nowrap"
          style={{ width: `${presetPaneWidth + sidebarWidth}px` }}
        >
        <div
          className={`h-full min-h-0 shrink-0 flex flex-col overflow-hidden border-r border-white/[0.05] pl-3 pr-0`}
          style={{ width: `${presetPaneWidth}px` }}
        >
          {capabilityPresetPanel ? (
            <div
              data-workflow-preset
              className="flex flex-col flex-1 min-h-0 overflow-hidden rounded-xl bg-transparent py-2 pr-3"
            >
              {cloneCapabilityPresetPanelWithScrollRef(capabilityPresetPanel, presetScrollRef, {
                onOpenWorkflowComposer: openUnifiedComposer,
              })}
            </div>
          ) : (
            <div className="flex-1 min-h-0 rounded-xl border border-dashed border-white/10 bg-white/[0.02] flex items-center justify-center text-[9px] text-gray-600">
              未挂载能力预设
            </div>
          )}
        </div>
        <div className="h-full min-h-0 shrink-0 flex flex-col" style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}>
          <WorkflowSidebarColumn
            actionModules={actionModules}
            capabilitySets={capabilitySets}
            dragOverAction={dragOverAction}
            setDragOverAction={setDragOverAction}
            draggingAssetIds={draggingAssetIds}
            setDraggingAssetIds={setDraggingAssetIds}
            draggingGroupItems={draggingGroupItems}
            setDraggingGroupItems={setDraggingGroupItems}
            createGroupFromAssets={createGroupFromAssets}
            createNestedGroupFromGroupItem={createNestedGroupFromGroupItem}
            ensureGroupItemsAsAssets={ensureGroupItemsAsAssets}
            assets={assets}
            getAssetDisplayImage={getAssetDisplayImage}
            setAssets={setAssets}
            selectedGroupItemKeys={selectedGroupItemKeys}
            setSelectedGroupItemKeys={setSelectedGroupItemKeys}
            moveGroupItemsToUpperLevel={moveGroupItemsToUpperLevel}
            sidebarOpsAllowed={sidebarOpsAllowed}
            groupAssetForDrag={groupAssetForDrag}
            currentGroupAsset={currentGroupAsset}
            duplicateAssetInPlace={duplicateAssetInPlace}
            removeAsset={removeAsset}
            removeGroupItems={removeGroupItems}
            setGroupFilterId={setGroupFilterId}
            markArchived={markArchived}
            visiblePresets={visiblePresets}
            visibleCapabilitySets={visibleCapabilitySets}
            visibleByCategory={visibleByCategory}
            favoriteEntries={favoriteEntries}
            draggingActionIdRef={draggingActionIdRef}
            favoriteDropActive={favoriteDropActive}
            setFavoriteDropActive={setFavoriteDropActive}
            setFavoriteActionIds={setFavoriteActionIds}
            collapsedSectionIds={collapsedSectionIds}
            toggleSectionCollapsed={toggleSectionCollapsed}
            updateDraggingActionId={updateDraggingActionId}
            draggingActionFromFavorite={draggingActionFromFavorite}
            actionDroppedInFavorite={actionDroppedInFavorite}
            setDraggingActionFromFavorite={setDraggingActionFromFavorite}
            setActionDroppedInFavorite={setActionDroppedInFavorite}
            removeActionFromFavorite={removeActionFromFavorite}
            setHoverPreview={setHoverPreview}
            handleDropToModuleAction={handleDropToModuleAction}
            handleDropToSetAction={handleDropToSetAction}
            jumpToCapabilityPreset={jumpToCapabilityPreset}
            onDropPresetFromEditor={handleActivatePresetFromEditorDrop}
            onDropPresetAction={handlePresetActionDrop}
            topActionMode={activePaneNode === 3 ? 'capabilityPreset' : 'asset'}
            onComposeCapabilities={handleComposeCapabilities}
          />
        </div>
        </div>
        <div className="min-w-0 min-h-0 h-full flex flex-col shrink-0" style={{ width: `${listPaneWidth}px` }}>
        <div
          ref={centerScrollRef}
          className="flex-1 min-w-0 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-3 rounded-xl transition-colors"
          onWheelCapture={handleCenterWheelDuringDrag}
          onDragOver={(e) => {
            autoScrollContainerOnDrag(e.currentTarget as HTMLElement, e.clientY);
            if (!hasWorkflowDropTransfer(e.dataTransfer)) return;
            e.preventDefault();
          }}
          tabIndex={0}
        >
          {groupFilterId ? (
            <>
              <div className={`flex items-center gap-2 shrink-0 ${WORKFLOW_EDGE_GUTTER}`}>
                <button
                  type="button"
                  onClick={() => setGroupFilterId(groupBreadcrumb[groupBreadcrumb.length - 1]?.parentId ?? null)}
                  className={WORKFLOW_CHROME_BTN_NEUTRAL}
                >
                  ← 返回
                </button>
                {groupBreadcrumb.length > 0 && (
                  <div className="flex items-center gap-1 text-[8px] text-gray-400">
                    {groupBreadcrumb.map((b, idx) => (
                      <React.Fragment key={b.id}>
                        {idx > 0 && <span>/</span>}
                        <button
                          type="button"
                          onClick={() => setGroupFilterId(b.id)}
                          className="underline-offset-2 hover:underline"
                        >
                          {b.label}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                )}
                {!currentGroupAsset ? (
                  <span className="text-[9px] text-amber-400">组不存在</span>
                ) : (
                  <>
                    <span className="text-[9px] text-gray-500">
                      {currentGroupAsset.groupLabel ??
                        (currentGroupAsset.groupKind === 'manual' ? '组' : '切割')}{' '}
                      组内 ({currentGroupMemberIds.length})
                    </span>
                  </>
                )}
              </div>
              <div
                className={`gap-4 flex-1 pt-4 ${WORKFLOW_EDGE_GUTTER}`}
                style={{
                  columnCount: showAllInGroup ? Math.max(2, columnCount) : columnCount,
                  columnFill: 'balance' as const,
                }}
              >
                {!currentGroupAsset ? (
                  <div className="py-8 text-center text-[9px] text-gray-500">该组已被删除或不存在，请返回</div>
                ) : showAllImages
                  ? showAllImages.map((img, idx) => {
                      const gallKey = `gall:${currentGroupAsset?.id ?? 'x'}:${idx}`;
                      return (
                        <div
                          key={idx}
                          data-workflow-card
                          data-workflow-thumb-key={gallKey}
                          className={`break-inside-avoid mb-4 rounded-2xl overflow-hidden bg-[#141416] flex justify-center ${WORKFLOW_CARD_SURFACE_IDLE}`}
                        >
                          <div
                            className="relative w-full bg-[#141416] flex justify-center"
                            style={{ aspectRatio: `${cardAspectByAssetId[gallKey] ?? 1}` }}
                          >
                            <WorkflowGridImage
                              fullSrc={img}
                              cacheKey={gallKey}
                              deferThumbnail={!thumbUnlockKeys.has(gallKey)}
                              thumbDecodePriority={thumbHotKeys.has(gallKey) ? 'high' : 'low'}
                              imageFetchPriority={thumbHotKeys.has(gallKey) ? 'high' : 'auto'}
                              className="relative z-0 block w-full h-full min-h-[5rem]"
                              imgClassName="relative z-0 block w-full h-full object-cover"
                              draggable={false}
                              onDragStart={(e) => e.preventDefault()}
                              onIntrinsicSize={(w, h) => {
                                setCardAspectByAssetId(
                                  (prev) => mergeCardAspectFromIntrinsic(prev, gallKey, w, h) ?? prev
                                );
                              }}
                            />
                          </div>
                        </div>
                      );
                    })
                  : currentGroupItems.map((item, idx) => {
                      const isAssetRef = typeof item === 'object' && item && 'assetId' in item;
                      const childAsset = isAssetRef ? assets.find((x) => x.id === (item as { assetId: string }).assetId) : null;
                      const img =
                        isAssetRef && childAsset
                          ? getAssetDisplayImage(childAsset)
                          : typeof item === 'string'
                            ? item
                            : currentGroupAsset?.original ?? '';
                      const groupKey = currentGroupAsset ? `${currentGroupAsset.id}::${idx}` : `${idx}`;
                      const taskMatchesGroupSlot = (t: WorkflowPendingTask) =>
                        t.sourceGroupAssetId === currentGroupAsset?.id && t.sourceItemIndex === idx;
                      const taskMatchesCurrentItem = (t: WorkflowPendingTask) =>
                        taskMatchesGroupSlot(t) || (!!childAsset && t.assetId === childAsset.id);
                      const isPendingItem =
                        pending.some(taskMatchesCurrentItem) ||
                        !!executingQueue?.tasks.find(
                          (t) => taskMatchesCurrentItem(t) && !completedTaskIds.has(t.id)
                        );
                      const isPendingOnly = pending.some(taskMatchesCurrentItem) && !executingQueue;
                      const taskForGroupSlot =
                        executingQueue?.tasks.find(
                          (t) => taskMatchesCurrentItem(t) && !completedTaskIds.has(t.id)
                        ) ?? null;
                      const isExecutingCurrentItem =
                        !!taskForGroupSlot && activeTaskIds.has(taskForGroupSlot.id);
                      const pendingTaskForGroupSlot =
                        pending.find(taskMatchesCurrentItem) ?? null;
                      const groupBatchQueuedCancelId =
                        taskForGroupSlot && !activeTaskIds.has(taskForGroupSlot.id)
                          ? taskForGroupSlot.id
                          : null;
                      const groupPendingDuringBatchCancelId =
                        executingQueue != null &&
                        pendingTaskForGroupSlot != null &&
                        !executingQueue.tasks.some((t) => t.id === pendingTaskForGroupSlot.id) &&
                        groupBatchQueuedCancelId == null
                          ? pendingTaskForGroupSlot.id
                          : null;
                      const showGroupQueueCancelBtn =
                        groupBatchQueuedCancelId != null || groupPendingDuringBatchCancelId != null;
                      const isBusyGroupItem = isPendingItem;

                      if (isAssetRef && childAsset) {
                        const childIsGroup = isGroupAsset(childAsset);
                        const childGroupLen = childIsGroup ? (childAsset.assetIds?.length ?? 0) : 0;
                        return (
                          <div key={idx} className="break-inside-avoid mb-6 relative" data-workflow-thumb-key={groupKey}>
                            {childIsGroup && childGroupLen > 0 && (
                              <>
                                <div className="absolute inset-0 rounded-2xl bg-[#16161a] border border-[#3b6fb8] translate-x-[16px] translate-y-[16px] -rotate-3 opacity-70 shadow-xl shadow-[#000000] pointer-events-none" />
                                <div className="absolute inset-0 rounded-2xl bg-[#1a1a1e] border border-[#6090d0] translate-x-[8px] translate-y-[8px] rotate-1 opacity-90 shadow-xl shadow-[#000000] pointer-events-none" />
                              </>
                            )}
                            {(() => {
                              const bounce = groupBounceStateById[childAsset.id] ?? 'idle';
                              const motionClass =
                                bounce === 'up'
                                  ? '-translate-y-0.5 -rotate-[0.6deg] scale-[0.985]'
                                  : bounce === 'down'
                                  ? 'translate-y-0.5 rotate-[0.6deg] scale-[0.985]'
                                  : '';
                              const cRaw = groupPreviewIndexById[childAsset.id] ?? 0;
                              const cGLen = childIsGroup ? (childAsset.assetIds?.length ?? 0) : 0;
                              const cSafe = cGLen ? ((cRaw % cGLen) + cGLen) % cGLen : 0;
                              const childGridPreviewSrc = childIsGroup
                                ? (() => {
                                    const nestedId = childAsset.assetIds?.[cSafe] ?? childAsset.assetIds?.[0];
                                    const nestedChild = nestedId ? assets.find((x) => x.id === nestedId) : undefined;
                                    return nestedChild ? getAssetDisplayImage(nestedChild) : img;
                                  })()
                                : img;
                              const childTextDisplay = getAssetDisplayText(childAsset);
                              const hasChildDisplayImage = childGridPreviewSrc.trim() !== '';
                              const hasChildTextPayload =
                                !!childTextDisplay ||
                                !!(childAsset.textTitle || '').trim() ||
                                Object.values(childAsset.textResults || {}).some((v) => String(v || '').trim() !== '');
                              const childGridCacheKeyBase = childIsGroup
                                ? `${childAsset.id}:${childAsset.displayKey}:g${cSafe}`
                                : `${childAsset.id}:${childAsset.displayKey}`;
                              const childGridCacheKey = `${childGridCacheKeyBase}:fp${previewSrcCacheFingerprint(childGridPreviewSrc)}`;
                              const childSetRunUi = capabilitySetRunByAssetId[childAsset.id];
                              const showChildSetRunProgress =
                                isExecutingCurrentItem &&
                                !!taskForGroupSlot &&
                                taskForGroupSlot.actionType.startsWith(SET_ACTION_PREFIX) &&
                                !!childSetRunUi &&
                                childSetRunUi.taskId === taskForGroupSlot.id;
                              const childGridPreviewSrcEffective =
                                showChildSetRunProgress && childSetRunUi.latestImage
                                  ? childSetRunUi.latestImage
                                  : childGridPreviewSrc;
                              const childGridCacheKeyEffective =
                                showChildSetRunProgress && childSetRunUi.latestImage
                                  ? `${childGridCacheKey}:sr:${childSetRunUi.latestImage.length}`
                                  : childGridCacheKey;
                              const childSetRunAccentClass =
                                showChildSetRunProgress && !selectedGroupItemKeys.has(groupKey)
                                  ? 'ring-2 ring-blue-500/35 shadow-[0_0_22px_rgba(59,130,246,0.14)]'
                                  : '';
                              return (
                                <div
                                  data-workflow-card
                                  ref={(el) => {
                                    if (!currentGroupAsset) return;
                                    if (el) cardRefs.current.set(groupKey, el);
                                    else cardRefs.current.delete(groupKey);
                                  }}
                                  className={`group relative rounded-2xl overflow-hidden bg-[#16161a] ${
                                    selectedGroupItemKeys.has(groupKey)
                                      ? 'border-0 ring-2 ring-blue-500/50'
                                      : dragOverGroupItemKey === groupKey
                                      ? 'border-0 ring-2 ring-blue-500/50'
                                      : childIsGroup
                                      ? 'border-0 ring-2 ring-blue-400/45'
                                      : WORKFLOW_CARD_SURFACE_IDLE
                                  } ${childSetRunAccentClass} transition-transform duration-150 ease-out will-change-transform ${motionClass}`}
                                  draggable={!isBusyGroupItem}
                                  onDragStart={() => {
                                    if (isBusyGroupItem) return;
                                    if (!currentGroupAsset) return;
                                    const keys = selectedGroupItemKeys.has(groupKey)
                                      ? Array.from(selectedGroupItemKeys)
                                      : [groupKey];
                                    const itemIndexes = keys
                                      .filter((k) => String(k).startsWith(`${currentGroupAsset.id}::`))
                                      .map((k) => Number(String(k).split('::')[1]))
                                      .filter((n) => !Number.isNaN(n));
                                    if (itemIndexes.length === 0) return;
                                    setDraggingGroupItems({ groupAssetId: currentGroupAsset.id, itemIndexes });
                                  }}
                                  onDragEnd={() => {
                                    setDraggingGroupItems(null);
                                    setDragOverAction(null);
                                    setDragOverGroupItemKey(null);
                                  }}
                                  onDragOver={(e) => {
                                    if (!draggingGroupItems?.itemIndexes?.length || currentGroupAsset?.id !== draggingGroupItems.groupAssetId) return;
                                    e.preventDefault();
                                    if (!draggingGroupItems.itemIndexes.includes(idx)) setDragOverGroupItemKey(groupKey);
                                  }}
                                  onDragLeave={() => {
                                    if (dragOverGroupItemKey === groupKey) setDragOverGroupItemKey(null);
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    setDragOverGroupItemKey(null);
                                    if (!showArchived && ingestWorkflowFilesFromDataTransfer(e.dataTransfer)) {
                                      setDraggingGroupItems(null);
                                      return;
                                    }
                                    if (!draggingGroupItems?.itemIndexes?.length || !currentGroupAsset) {
                                      setDraggingGroupItems(null);
                                      return;
                                    }
                                    const targetIdx = idx;
                                    const allIndexes = [...new Set([...draggingGroupItems.itemIndexes, targetIdx])].sort((a, b) => a - b);
                                    if (allIndexes.length < 2) {
                                      setDraggingGroupItems(null);
                                      return;
                                    }
                                    const groupAssetId = currentGroupAsset.id;
                                    const { nextAssets, assetIds } = ensureGroupItemsAsAssets(assets, groupAssetId, allIndexes);
                                    if (assetIds.length === 0) {
                                      setDraggingGroupItems(null);
                                      return;
                                    }
                                    const firstAsset = nextAssets.find((x) => x.id === assetIds[0]);
                                    const coverImage = firstAsset ? getAssetDisplayImage(firstAsset, nextAssets) : '';
                                    const newGroupId = uuid();
                                    let updated = nextAssets.map((a) =>
                                      assetIds.includes(a.id) ? { ...a, groupId: newGroupId } : a
                                    );
                                    const groupIdx = updated.findIndex((a) => a.id === groupAssetId);
                                    if (groupIdx !== -1) {
                                      const g = updated[groupIdx];
                                      if (isGroupAsset(g)) {
                                        const items = [...(g.assetIds ?? [])];
                                        const sorted = allIndexes.filter((i) => i >= 0 && i < items.length).sort((a, b) => a - b);
                                        const keep: string[] = [];
                                        items.forEach((it, i) => {
                                          if (!sorted.includes(i)) keep.push(it);
                                        });
                                        const insertPos = sorted.length ? sorted[0] : keep.length;
                                        keep.splice(insertPos, 0, newGroupId);
                                        updated = updated.map((a, i) =>
                                          i === groupIdx ? { ...a, assetIds: keep } : a
                                        );
                                      }
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
                                      groupKind: 'manual',
                                      groupLabel: getRandomGroupCodeName(usedLabels),
                                      archived: false,
                                      hiddenInGrid: false,
                                      createdAt: Date.now(),
                                    });
                                    setAssets([...updated, newGroup]);
                                    setSelectedGroupItemKeys(new Set());
                                    setDraggingGroupItems(null);
                                  }}
                                  {...((getDisplayKeysForAsset(childAsset).length > 1 || (childAsset.assetIds?.length ?? 0) > 1)
                                    ? { 'data-prevent-wheel-scroll': '' }
                                    : {})}
                                  onWheel={(e) => {
                                    if (isBusyGroupItem) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (isGroupAsset(childAsset) && (childAsset.assetIds?.length ?? 0) > 0) {
                                      const delta = e.deltaY > 0 ? 1 : -1;
                                      setGroupPreviewIndexById((prev) => {
                                        const current = prev[childAsset.id] ?? 0;
                                        const len = childAsset.assetIds?.length ?? 1;
                                        const next = ((current + delta) % len + len) % len;
                                        return { ...prev, [childAsset.id]: next };
                                      });
                                      const direction: 'up' | 'down' = e.deltaY > 0 ? 'down' : 'up';
                                      setGroupBounceStateById((prev) => ({ ...prev, [childAsset.id]: direction }));
                                      window.setTimeout(() => {
                                        setGroupBounceStateById((prev) => ({ ...prev, [childAsset.id]: 'idle' }));
                                      }, 180);
                                      return;
                                    }
                                    if (getDisplayKeysForAsset(childAsset).length <= 1) return;
                                    cycleDisplayKey(childAsset.id, e.deltaY);
                                  }}
                                >
                                  <div
                                    className="relative cursor-pointer"
                                    onClick={() => {
                                      // 使用 isGroupAsset 兼容新旧结构
                                      if (isGroupAsset(childAsset)) {
                                        setGroupFilterId(childAsset.id);
                                      } else if (currentGroupAsset) {
                                        setLightboxSourceSlot({
                                          sourceGroupAssetId: currentGroupAsset.id,
                                          sourceItemIndex: idx,
                                        });
                                        setLightboxAssetId(childAsset.id);
                                      } else {
                                        setLightboxSourceSlot(null);
                                        setLightboxAssetId(childAsset.id);
                                      }
                                    }}
                                  >
                                    {!hasChildDisplayImage && isWorkflowTextAsset(childAsset) ? (
                                      <div
                                        className="relative w-full bg-[#141416] flex flex-col justify-start p-3 text-left"
                                        style={{ aspectRatio: `${3 / 4}`, minHeight: '10rem' }}
                                      >
                                        {childAsset.textTitle?.trim() ? (
                                          <p className="text-[11px] font-bold text-gray-100 line-clamp-2 mb-1.5">
                                            {childAsset.textTitle.trim()}
                                          </p>
                                        ) : null}
                                        <p
                                          className={`text-[10px] text-gray-400 leading-snug whitespace-pre-wrap flex-1 overflow-hidden ${
                                            childAsset.textTitle?.trim() ? 'line-clamp-6' : 'line-clamp-8'
                                          }`}
                                        >
                                          {childTextDisplay || '（空白，点击编辑）'}
                                        </p>
                                      </div>
                                    ) : (
                                      <div
                                        className="relative w-full bg-[#141416] flex justify-center"
                                        style={{ aspectRatio: `${cardAspectByAssetId[childAsset.id] ?? 1}` }}
                                      >
                                        <WorkflowGridImage
                                          fullSrc={childGridPreviewSrcEffective}
                                          cacheKey={childGridCacheKeyEffective}
                                          deferThumbnail={!thumbUnlockKeys.has(groupKey)}
                                          thumbDecodePriority={thumbHotKeys.has(groupKey) ? 'high' : 'low'}
                                          imageFetchPriority={thumbHotKeys.has(groupKey) ? 'high' : 'auto'}
                                          className="relative z-0 block w-full h-full min-h-[5rem]"
                                          imgClassName="relative z-0 block w-full h-full object-cover"
                                          draggable={false}
                                          onDragStart={(e) => e.preventDefault()}
                                          onIntrinsicSize={(w, h) => {
                                            setCardAspectByAssetId(
                                              (prev) =>
                                                mergeCardAspectFromIntrinsic(prev, childAsset.id, w, h) ?? prev
                                            );
                                          }}
                                        />
                                        <div
                                          aria-hidden
                                          className="absolute inset-0 z-[1]"
                                          draggable={false}
                                          onDragStart={(e) => e.preventDefault()}
                                        />
                                      </div>
                                    )}
                                    {isPendingOnly && (
                                      <div
                                        className="absolute inset-0 z-10 bg-[#16161a] flex items-center justify-center"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setPending((prev) =>
                                              prev.filter(
                                                (t) =>
                                                  !(
                                                    t.sourceGroupAssetId === currentGroupAsset?.id &&
                                                    t.sourceItemIndex === idx
                                                  )
                                              )
                                            )
                                          }
                                          className={WORKFLOW_CARD_DISMISS_ICON_BTN}
                                          title="从队列移除"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    )}
                                    {isPendingItem && !isPendingOnly && (
                                      <>
                                        <div
                                          className="absolute inset-0 z-[9] bg-transparent"
                                          onClick={(e) => e.stopPropagation()}
                                          onPointerDown={(e) => e.stopPropagation()}
                                          aria-hidden
                                        />
                                        <WorkflowPixelBusyOverlay
                                          executing={isExecutingCurrentItem}
                                          accentExecuting={showChildSetRunProgress}
                                          progressDetail={showChildSetRunProgress ? childSetRunUi?.progressLine : null}
                                          backdropImageSrc={showChildSetRunProgress ? childSetRunUi?.latestImage : null}
                                        />
                                        {showGroupQueueCancelBtn && (
                                          <div className="absolute inset-0 z-[11] flex items-center justify-center pointer-events-none">
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (groupBatchQueuedCancelId != null) {
                                                  cancelQueuedTaskInBatch(groupBatchQueuedCancelId);
                                                } else if (groupPendingDuringBatchCancelId != null) {
                                                  setPending((prev) =>
                                                    prev.filter((t) => t.id !== groupPendingDuringBatchCancelId)
                                                  );
                                                }
                                              }}
                                              className="pointer-events-auto w-8 h-8 rounded-full flex items-center justify-center bg-[#111827]/80 backdrop-blur border border-white/20 text-gray-200 hover:bg-[#4a1c1c]/85 hover:border-[#c87878] hover:text-red-200 text-base font-medium leading-none"
                                              title="从队列移除"
                                            >
                                              ×
                                            </button>
                                          </div>
                                        )}
                                      </>
                                    )}
                                    {assetErrors.has(childAsset.id) && (
                                      <span className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-[#b91c1c] text-[8px] font-black text-white">
                                        执行出错
                                      </span>
                                    )}
                                    {isGroupAsset(childAsset) && (childAsset.assetIds?.length ?? 0) > 0 ? (
                                      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-[#1d4ed8]">
                                        {(childAsset.groupLabel ?? '组')} {childAsset.assetIds?.length}
                                      </span>
                                    ) : hasChildTextPayload ? (
                                      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-[#1d4ed8] text-white">
                                        文本
                                      </span>
                                    ) : null}
                                  </div>
                                  {!isGroupAsset(childAsset) && !hasChildTextPayload && (
                                    <div className="p-2 flex flex-col gap-1.5 border-t border-white/[0.06] bg-[#08080b]/80">
                                      <div className="flex gap-1 flex-wrap items-center justify-between min-h-[18px]">
                                        <span className={WORKFLOW_META_PILL}>
                                          <span className="font-black text-blue-300">{getGeneratedImageCount(childAsset)}</span>
                                          <span className="text-gray-500">·</span>
                                          <span className="text-gray-400">{getAssetDisplayTypeLabel(childAsset)}</span>
                                        </span>
                                        {childAsset.displayKey !== 'original' && (
                                          <button
                                            onClick={() => discardResult(childAsset.id, childAsset.displayKey)}
                                            className="px-1.5 py-0.5 rounded text-[7px] text-red-400 hover:bg-[#4a1c1c]"
                                            title="丢弃当前显示的版本"
                                          >
                                            丢弃当前版本
                                          </button>
                                        )}
                                        {childAsset.displayKey === 'original' && (
                                          <span
                                            aria-hidden
                                            className="px-1.5 py-0.5 text-[7px] opacity-0 select-none pointer-events-none"
                                          >
                                            丢弃当前版本
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      }

                      return (
                        <div
                          key={idx}
                          data-workflow-card
                          data-workflow-thumb-key={groupKey}
                          ref={(el) => {
                            if (!currentGroupAsset) return;
                            if (el) cardRefs.current.set(groupKey, el);
                            else cardRefs.current.delete(groupKey);
                          }}
                          className={`break-inside-avoid mb-4 group relative rounded-2xl overflow-hidden bg-[#16161a] ${
                            selectedGroupItemKeys.has(groupKey)
                              ? 'border-0 ring-2 ring-blue-500/50'
                              : WORKFLOW_CARD_SURFACE_IDLE
                          }`}
                          draggable={!isBusyGroupItem}
                          onDragStart={() => {
                            if (isBusyGroupItem) return;
                            if (!currentGroupAsset) return;
                            const keys = selectedGroupItemKeys.has(groupKey)
                              ? Array.from(selectedGroupItemKeys)
                              : [groupKey];
                            const itemIndexes = keys
                              .filter((k) => String(k).startsWith(`${currentGroupAsset.id}::`))
                              .map((k) => Number(String(k).split('::')[1]))
                              .filter((n) => !Number.isNaN(n));
                            if (itemIndexes.length === 0) return;
                            setDraggingGroupItems({ groupAssetId: currentGroupAsset.id, itemIndexes });
                          }}
                          onDragEnd={() => {
                            setDraggingGroupItems(null);
                            setDragOverAction(null);
                          }}
                        >
                          <div className="relative cursor-pointer" onClick={() => setGroupStringLightboxIndex(idx)}>
                            <div
                              className="relative w-full bg-[#141416] flex justify-center"
                              style={{ aspectRatio: `${cardAspectByAssetId[groupKey] ?? 1}` }}
                            >
                              <WorkflowGridImage
                                fullSrc={img}
                                cacheKey={`gstr:${currentGroupAsset?.id ?? 'x'}:${idx}`}
                                deferThumbnail={!thumbUnlockKeys.has(groupKey)}
                                thumbDecodePriority={thumbHotKeys.has(groupKey) ? 'high' : 'low'}
                                imageFetchPriority={thumbHotKeys.has(groupKey) ? 'high' : 'auto'}
                                className="relative z-0 block w-full h-full min-h-[5rem]"
                                imgClassName="relative z-0 block w-full h-full object-cover"
                                draggable={false}
                                onDragStart={(e) => e.preventDefault()}
                                onIntrinsicSize={(w, h) => {
                                  setCardAspectByAssetId(
                                    (prev) => mergeCardAspectFromIntrinsic(prev, groupKey, w, h) ?? prev
                                  );
                                }}
                              />
                              <div
                                aria-hidden
                                className="absolute inset-0 z-[1]"
                                draggable={false}
                                onDragStart={(e) => e.preventDefault()}
                              />
                            </div>
                            {isPendingOnly && (
                              <div
                                className="absolute inset-0 z-10 bg-[#16161a] flex items-center justify-center"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPending((prev) =>
                                      prev.filter(
                                        (t) =>
                                          !(
                                            t.sourceGroupAssetId === currentGroupAsset?.id &&
                                            t.sourceItemIndex === idx
                                          )
                                      )
                                    )
                                  }
                                  className={WORKFLOW_CARD_DISMISS_ICON_BTN}
                                  title="从队列移除"
                                >
                                  ×
                                </button>
                              </div>
                            )}
                            {isPendingItem && !isPendingOnly && (
                              <>
                                <div
                                  className="absolute inset-0 z-[9] bg-transparent"
                                  onClick={(e) => e.stopPropagation()}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  aria-hidden
                                />
                                <div className="absolute inset-0 z-10 bg-[#16161a] flex items-center justify-center pointer-events-none">
                                  <div
                                    className={`h-7 w-7 rounded-full border-[3px] ${
                                      isExecutingCurrentItem
                                        ? 'border-blue-400 border-t-transparent animate-spin'
                                        : 'border-[#484850] border-t-transparent'
                                    }`}
                                  />
                                </div>
                                {showGroupQueueCancelBtn && (
                                  <div className="absolute inset-0 z-[11] flex items-center justify-center pointer-events-none">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (groupBatchQueuedCancelId != null) {
                                          cancelQueuedTaskInBatch(groupBatchQueuedCancelId);
                                        } else if (groupPendingDuringBatchCancelId != null) {
                                          setPending((prev) =>
                                            prev.filter((t) => t.id !== groupPendingDuringBatchCancelId)
                                          );
                                        }
                                      }}
                                      className="pointer-events-auto w-8 h-8 rounded-full flex items-center justify-center bg-[#111827]/80 backdrop-blur border border-white/20 text-gray-200 hover:bg-[#4a1c1c]/85 hover:border-[#c87878] hover:text-red-200 text-base font-medium leading-none"
                                      title="从队列移除"
                                    >
                                      ×
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          {/* 组内纯图片项不再保留底部留白 */}
                        </div>
                      );
                    })}
              </div>
              {groupStringLightboxIndex != null && typeof currentGroupItems[groupStringLightboxIndex] === 'string' && (
                <div
                  className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/78 backdrop-blur-sm p-4"
                  onClick={() => setGroupStringLightboxIndex(null)}
                >
                  <img
                    src={currentGroupItems[groupStringLightboxIndex] as string}
                    alt=""
                    className="max-w-full max-h-[90vh] object-contain rounded-lg"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    type="button"
                    className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center text-white/60 hover:text-white rounded-full bg-[#16161a]"
                    onClick={() => setGroupStringLightboxIndex(null)}
                  >
                    <AppIcon name="close" className="w-4 h-4" />
                  </button>
                </div>
              )}
              {currentGroupAsset && currentGroupItems.length === 0 && !showAllImages && (
                <div className="mx-auto my-auto flex max-w-sm flex-col items-center justify-center rounded-2xl bg-white/[0.03] px-8 py-10 text-center ring-1 ring-white/[0.06]">
                  <p className="text-[10px] font-black uppercase tracking-wide text-gray-400">此组暂无内容</p>
                  <p className="mt-1.5 text-[9px] leading-relaxed text-gray-600">在左侧大纲选中其他组，或向本组拖入资产</p>
                </div>
              )}
            </>
          ) : rootCanvasAssets.length === 0 ? (
            <div className="mx-auto flex max-w-md flex-1 min-h-0 flex-col items-center justify-center px-6 py-12">
              <div className="flex w-full flex-col items-center rounded-2xl bg-white/[0.03] px-8 py-10 text-center ring-1 ring-white/[0.07]">
                <AppIcon name="camera" className="mb-3 h-11 w-11 text-gray-500" />
                <p className="text-[11px] font-black uppercase tracking-wide text-gray-300">画布为空</p>
                <p className="mt-2 text-[9px] leading-relaxed text-gray-500">
                  将图片或模型<strong className="text-gray-400">拖入画布</strong>，在左侧「仓库」拖入条目，或使用<strong className="text-gray-400">粘贴</strong>、功能区能力生成内容
                </p>
              </div>
            </div>
          ) : (
            <div className={`flex-1 min-h-0 min-w-0 py-6 ${WORKFLOW_EDGE_GUTTER}`}>
              <div
                ref={gridRef}
                className="gap-4 relative"
                style={{ columnCount, columnFill: 'balance' as const }}
              >
                {rootCanvasAssets.map((a) => {
                  const textDisplay = getAssetDisplayText(a);
                  const hasTextPayload =
                    !!textDisplay ||
                    !!(a.textTitle || '').trim() ||
                    Object.values(a.textResults || {}).some((v) => String(v || '').trim() !== '');
                  const baseDisplayImage = getAssetDisplayImage(a);
                  const hasDisplayImage = baseDisplayImage.trim() !== '';
                  const cardAspect = hasDisplayImage ? cardAspectByAssetId[a.id] ?? 1 : 3 / 4;
                  const isBusy = busyAssetIds.has(a.id);
                  const isPendingOnly =
                    pending.some((t) => t.assetId === a.id) && !executingQueue;
                  const taskForRootSlot =
                    executingQueue?.tasks.find((t) => t.assetId === a.id && !completedTaskIds.has(t.id)) ?? null;
                  const isExecutingCurrent =
                    !!taskForRootSlot && activeTaskIds.has(taskForRootSlot.id);
                  /** 批处理进行中时新拖入的任务只进 pending，不在本批 executingQueue.tasks，仍会 busy +「排队中」，须单独给 × */
                  const pendingTaskForRootAsset = pending.find((t) => t.assetId === a.id) ?? null;
                  const rootBatchQueuedCancelId =
                    taskForRootSlot && !activeTaskIds.has(taskForRootSlot.id) ? taskForRootSlot.id : null;
                  const rootPendingDuringBatchCancelId =
                    executingQueue != null &&
                    pendingTaskForRootAsset != null &&
                    !executingQueue.tasks.some((t) => t.id === pendingTaskForRootAsset.id) &&
                    rootBatchQueuedCancelId == null
                      ? pendingTaskForRootAsset.id
                      : null;
                  const showRootQueueCancelBtn =
                    rootBatchQueuedCancelId != null || rootPendingDuringBatchCancelId != null;
                  const bounce = groupBounceStateById[a.id] ?? 'idle';
                  const motionClass =
                    bounce === 'up'
                      ? '-translate-y-0.5 -rotate-[0.6deg] scale-[0.985]'
                      : bounce === 'down'
                      ? 'translate-y-0.5 rotate-[0.6deg] scale-[0.985]'
                      : '';
                  /** 仅「执行中」整卡禁指针；「排队中」要可点 ×，不能用整卡 pointer-events-none */
                  const busyClass =
                    isBusy && !isPendingOnly && isExecutingCurrent ? 'pointer-events-none' : '';
                  const rawG = groupPreviewIndexById[a.id] ?? 0;
                  const isGroupCard = isGroupAsset(a);
                  const gLen = isGroupCard ? (a.assetIds?.length ?? 0) : 0;
                  const gSafe = gLen ? ((rawG % gLen) + gLen) % gLen : 0;
                  const gridPreviewSrc = !hasDisplayImage
                    ? ''
                    : isGroupCard
                    ? (() => {
                        const childId = a.assetIds?.[gSafe] ?? a.assetIds?.[0];
                        const child = childId ? assets.find((x) => x.id === childId) : null;
                        return child ? getAssetDisplayImage(child) : baseDisplayImage;
                      })()
                    : baseDisplayImage;
                  const gridPreviewCacheKeyBase = isGroupCard
                    ? `${a.id}:${a.displayKey}:g${gSafe}`
                    : `${a.id}:${a.displayKey}`;
                  const gridPreviewCacheKey = `${gridPreviewCacheKeyBase}:fp${previewSrcCacheFingerprint(gridPreviewSrc)}`;
                  const setRunUi = capabilitySetRunByAssetId[a.id];
                  const showSetRunProgress =
                    isExecutingCurrent &&
                    !!taskForRootSlot &&
                    taskForRootSlot.actionType.startsWith(SET_ACTION_PREFIX) &&
                    !!setRunUi &&
                    setRunUi.taskId === taskForRootSlot.id;
                  const gridPreviewSrcEffective =
                    showSetRunProgress && setRunUi.latestImage ? setRunUi.latestImage : gridPreviewSrc;
                  const gridPreviewCacheKeyEffective =
                    showSetRunProgress && setRunUi.latestImage
                      ? `${gridPreviewCacheKey}:sr:${setRunUi.latestImage.length}`
                      : gridPreviewCacheKey;
                  const setRunAccentClass =
                    showSetRunProgress && !selectedAssetIds.has(a.id)
                      ? 'ring-2 ring-blue-500/35 shadow-[0_0_22px_rgba(59,130,246,0.14)]'
                      : '';

                  return (
                    <div key={a.id} className="break-inside-avoid mb-6 relative" data-workflow-thumb-key={a.id}>
                      {isGroupCard ? (
                        <>
                          <div className="absolute inset-0 rounded-2xl bg-[#16161a] border border-[#3b6fb8] translate-x-[16px] translate-y-[16px] -rotate-3 opacity-70 shadow-xl shadow-[#000000] pointer-events-none" />
                          <div className="absolute inset-0 rounded-2xl bg-[#1a1a1e] border border-[#6090d0] translate-x-[8px] translate-y-[8px] rotate-1 opacity-90 shadow-xl shadow-[#000000] pointer-events-none" />
                        </>
                      ) : null}
                      <div
                        data-workflow-card
                        ref={(el) => {
                          if (el) cardRefs.current.set(a.id, el);
                          else cardRefs.current.delete(a.id);
                        }}
                        className={`group relative rounded-2xl overflow-hidden bg-[#16161a] ${
                          selectedAssetIds.has(a.id)
                            ? 'border-0 ring-2 ring-blue-500/50'
                            : dragOverAssetId === a.id
                            ? isGroupCard
                              ? 'border-0 ring-2 ring-blue-400/60'
                              : 'border-0 ring-2 ring-blue-500/50'
                            : isGroupCard
                            ? 'border-0 ring-2 ring-blue-400/45'
                            : WORKFLOW_CARD_SURFACE_IDLE
                        } ${setRunAccentClass} ${busyClass} transition-transform duration-150 ease-out will-change-transform ${motionClass}`}
                        draggable={!showArchived && !isBusy}
                        onDragStart={(e) => {
                          if (showArchived || isBusy) return;
                          const ids =
                            selectedAssetIds.has(a.id) && selectedAssetIds.size > 0
                              ? Array.from(selectedAssetIds)
                              : [a.id];
                          setDraggingAssetIds(ids);
                          try {
                            const payload: AcWorkflowExportPayload = { mode: 'roots', assetIds: ids };
                            e.dataTransfer.setData(DT_AC_WORKFLOW_EXPORT, JSON.stringify(payload));
                            e.dataTransfer.effectAllowed = 'copyMove';
                          } catch {
                            /* ignore */
                          }
                        }}
                        onDragEnd={() => {
                          setDraggingAssetIds(null);
                          setDragOverAction(null);
                          setDragOverAssetId(null);
                        }}
                        onDragOver={(e) => {
                          if (isBusy) return;
                          let types: string[] = [];
                          try {
                            types = Array.from(e.dataTransfer.types);
                          } catch {
                            types = [];
                          }
                          if (
                            types.includes(DT_AC_CAPABILITY_ACTION) ||
                            types.includes(DT_AC_CAPABILITY_FROM_EDITOR)
                          ) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'copy';
                            setDragOverAssetId(a.id);
                            return;
                          }
                          if (draggingAssetIds?.length || draggingGroupItems?.itemIndexes?.length) {
                            e.preventDefault();
                            setDragOverAssetId(a.id);
                            return;
                          }
                          try {
                            if (types.includes(DT_AC_WORKFLOW_EXPORT)) {
                              e.preventDefault();
                              setDragOverAssetId(a.id);
                            }
                          } catch {
                            /* ignore */
                          }
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          if (dragOverAssetId === a.id) setDragOverAssetId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (isBusy) {
                            setDragOverAssetId(null);
                            return;
                          }
                          let capTypes: string[] = [];
                          try {
                            capTypes = Array.from(e.dataTransfer.types);
                          } catch {
                            capTypes = [];
                          }
                          const isCapabilityDrop =
                            capTypes.includes(DT_AC_CAPABILITY_ACTION) ||
                            capTypes.includes(DT_AC_CAPABILITY_FROM_EDITOR);
                          if (isCapabilityDrop) {
                            const capId = readCapabilityDragActionId(e.dataTransfer);
                            const capSource = readCapabilityDragSource(e.dataTransfer);
                            setDragOverAssetId(null);
                            setDraggingAssetIds(null);
                            setDraggingGroupItems(null);
                            updateDraggingActionId(null);
                            if (capId) {
                              runCapabilityOnAssetCardImmediate(a, capId);
                              if (capSource === 'favorite') {
                                setActionDroppedInFavorite(true);
                              }
                            }
                            return;
                          }
                          if (ingestWorkflowFilesFromDataTransfer(e.dataTransfer)) {
                            setDragOverAssetId(null);
                            setDraggingAssetIds(null);
                            setDraggingGroupItems(null);
                            return;
                          }
                          const fromState = parseWorkflowDragSource(draggingAssetIds, draggingGroupItems);
                          const sources = fromState ? [fromState] : parseAcWorkflowExportDragSources(e.dataTransfer);
                          const finish = () => {
                            setDragOverAssetId(null);
                            setDraggingAssetIds(null);
                            setDraggingGroupItems(null);
                          };
                          if (sources.length !== 1) {
                            finish();
                            return;
                          }
                          const src = sources[0]!;
                          if (isWorkflowTextAsset(a)) {
                            finish();
                            return;
                          }
                          const targetId = a.id;
                          if (src.kind === 'root') {
                            const dragIds = Array.from(new Set(src.assetIds.filter((id) => id !== targetId))).filter((id) => {
                              const ast = assets.find((x) => x.id === id);
                              return ast != null && !isWorkflowTextAsset(ast);
                            });
                            if (dragIds.length > 0) {
                              if (isGroupAsset(a)) {
                                setAssets((prev) => mergeAssetIdsIntoGroupCardAssets(prev, targetId, dragIds));
                              } else {
                                const members = Array.from(new Set([...dragIds, targetId]));
                                if (members.length > 1) createGroupFromAssets(members);
                              }
                            }
                            finish();
                            return;
                          }
                          const { groupAssetId, itemIndexes } = src;
                          if (groupAssetId === targetId) {
                            finish();
                            return;
                          }
                          setAssets((prev) => {
                            const { nextAssets, assetIds } = ensureGroupItemsAsAssets(prev, groupAssetId, itemIndexes);
                            if (assetIds.length === 0) return prev;
                            const afterRemove = removeGroupItems(nextAssets, groupAssetId, itemIndexes);
                            const groupRemoved = !afterRemove.some((x) => x.id === groupAssetId);
                            if (groupRemoved) {
                              queueMicrotask(() => setGroupFilterId(null));
                            }
                            const targetInPrev = afterRemove.find((x) => x.id === targetId);
                            const targetHasGroup = !!targetInPrev && isGroupAsset(targetInPrev);
                            if (targetHasGroup) {
                              return mergeAssetIdsIntoGroupCardAssets(afterRemove, targetId, assetIds);
                            }
                            const r = insertManualGroupForAssetIds(afterRemove, [...assetIds, targetId]);
                            if (r.createdGroup) {
                              const cg = r.createdGroup;
                              queueMicrotask(() => scheduleCompanionPersistOriginalAny(cg.id, cg.coverImage));
                            }
                            return r.next;
                          });
                          finish();
                        }}
                        {...((!isBusy && !showArchived && (getDisplayKeysForAsset(a).length > 1 || gLen > 1))
                          ? { 'data-prevent-wheel-scroll': '' }
                          : {})}
                        onWheel={(e) => {
                          if (isBusy) return;
                          e.preventDefault();
                          e.stopPropagation();
                          if (showArchived) return;
                          if (isGroupCard) {
                            if (gLen <= 1) return;
                            const delta = e.deltaY > 0 ? 1 : -1;
                            setGroupPreviewIndexById((prev) => {
                              const current = prev[a.id] ?? 0;
                              const next = ((current + delta) % gLen + gLen) % gLen;
                              return { ...prev, [a.id]: next };
                            });
                            const direction: 'up' | 'down' = e.deltaY > 0 ? 'down' : 'up';
                            const assetId = a.id;
                            setGroupBounceStateById((prev) => ({ ...prev, [assetId]: direction }));
                            window.setTimeout(() => {
                              setGroupBounceStateById((prev) => ({ ...prev, [assetId]: 'idle' }));
                            }, 180);
                            return;
                          }
                          if (getDisplayKeysForAsset(a).length <= 1) return;
                          cycleDisplayKey(a.id, e.deltaY);
                        }}
                      >
                        <div
                          className="relative cursor-pointer"
                          onClick={() => {
                            if (showArchived) {
                              setArchivedDetailAssetId(a.id);
                            } else if (isGroupCard) {
                              setGroupFilterId(a.id);
                            } else {
                              setLightboxSourceSlot(null);
                              setLightboxAssetId(a.id);
                            }
                          }}
                        >
                          {!hasDisplayImage && isWorkflowTextAsset(a) ? (
                            <div
                              className="relative w-full bg-[#141416] flex flex-col justify-start p-3 text-left"
                              style={{ aspectRatio: `${3 / 4}`, minHeight: '10rem' }}
                            >
                              {a.textTitle?.trim() ? (
                                <p className="text-[11px] font-bold text-gray-100 line-clamp-2 mb-1.5">
                                  {a.textTitle.trim()}
                                </p>
                              ) : null}
                              <p
                                className={`text-[10px] text-gray-400 leading-snug whitespace-pre-wrap flex-1 overflow-hidden ${
                                  a.textTitle?.trim() ? 'line-clamp-6' : 'line-clamp-8'
                                }`}
                              >
                                {textDisplay || '（空白，点击编辑）'}
                              </p>
                            </div>
                          ) : (
                            <div className="relative w-full bg-[#141416] flex justify-center" style={{ aspectRatio: `${cardAspect}` }}>
                              <WorkflowGridImage
                                fullSrc={gridPreviewSrcEffective}
                                cacheKey={gridPreviewCacheKeyEffective}
                                thumbMaxEdge={(a.modelUrls?.length ?? 0) > 0 ? 896 : undefined}
                                deferThumbnail={!thumbUnlockKeys.has(a.id)}
                                thumbDecodePriority={thumbHotKeys.has(a.id) ? 'high' : 'low'}
                                imageFetchPriority={thumbHotKeys.has(a.id) ? 'high' : 'auto'}
                                className="relative z-0 block w-full h-full min-h-[5rem]"
                                imgClassName="relative z-0 block w-full h-full object-cover"
                                draggable={false}
                                onDragStart={(e) => e.preventDefault()}
                                onIntrinsicSize={(w, h) => {
                                  setCardAspectByAssetId(
                                    (prev) => mergeCardAspectFromIntrinsic(prev, a.id, w, h) ?? prev
                                  );
                                }}
                              />
                              <div
                                aria-hidden
                                className="absolute inset-0 z-[1]"
                                draggable={false}
                                onDragStart={(e) => e.preventDefault()}
                              />
                            </div>
                          )}
                          {isPendingOnly && (
                            <div
                              className="absolute inset-0 z-10 bg-[#0b1220]/35 backdrop-blur-[2px] flex items-center justify-center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setPending((prev) =>
                                    prev.filter((t) => t.assetId !== a.id)
                                  )
                                }
                                className="w-8 h-8 rounded-full flex items-center justify-center bg-[#111827]/80 backdrop-blur border border-white/20 text-gray-200 hover:bg-[#4a1c1c]/85 hover:border-[#c87878] hover:text-red-200 text-base font-medium leading-none"
                                title="从队列移除"
                              >
                                ×
                              </button>
                            </div>
                          )}
                          {isBusy && !isPendingOnly && (
                            <>
                              {/* 像素遮罩为 pointer-events-none，需单独挡住点击，否则会点到下层打开大图 */}
                              <div
                                className="absolute inset-0 z-[9] bg-transparent"
                                onClick={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                                aria-hidden
                              />
                              <WorkflowPixelBusyOverlay
                                executing={isExecutingCurrent}
                                accentExecuting={showSetRunProgress}
                                progressDetail={showSetRunProgress ? setRunUi?.progressLine : null}
                                backdropImageSrc={showSetRunProgress ? setRunUi?.latestImage : null}
                              />
                              {showRootQueueCancelBtn && (
                                <div className="absolute inset-0 z-[11] flex items-center justify-center pointer-events-none">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (rootBatchQueuedCancelId != null) {
                                        cancelQueuedTaskInBatch(rootBatchQueuedCancelId);
                                      } else if (rootPendingDuringBatchCancelId != null) {
                                        setPending((prev) =>
                                          prev.filter((t) => t.id !== rootPendingDuringBatchCancelId)
                                        );
                                      }
                                    }}
                                    className="pointer-events-auto w-8 h-8 rounded-full flex items-center justify-center bg-[#111827]/80 backdrop-blur border border-white/20 text-gray-200 hover:bg-[#4a1c1c]/85 hover:border-[#c87878] hover:text-red-200 text-base font-medium leading-none"
                                    title="从队列移除"
                                  >
                                    ×
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                          {assetErrors.has(a.id) && (
                            <span className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-[#b91c1c] text-[8px] font-black text-white">
                              执行出错
                            </span>
                          )}
                          {isGroupAsset(a) && (a.assetIds?.length ?? 0) > 0 ? (
                            <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-[#1d4ed8]">
                              {(a.groupLabel ?? '组')} {a.assetIds?.length}
                            </span>
                          ) : hasTextPayload && !isWorkflowTextAsset(a) ? (
                            <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-[#1d4ed8] text-white">
                              文本
                            </span>
                          ) : null}
                        </div>
                        {!showArchived &&
                          !isGroupAsset(a) &&
                          (!hasTextPayload || isWorkflowTextAsset(a)) && (
                          <div className="p-2 flex flex-col gap-1.5 border-t border-white/[0.06] bg-[#08080b]/80">
                            <div className="flex gap-1 flex-wrap items-center justify-between min-h-[18px]">
                              <span className={WORKFLOW_META_PILL}>
                                <span className="font-black text-blue-300">{getGeneratedImageCount(a)}</span>
                                <span className="text-gray-500">·</span>
                                <span className="text-gray-400">{getAssetDisplayTypeLabel(a)}</span>
                              </span>
                              {a.displayKey !== 'original' && (
                                <button
                                  onClick={() => discardResult(a.id, a.displayKey)}
                                  className="px-1.5 py-0.5 rounded text-[7px] text-red-400 hover:bg-[#4a1c1c]"
                                  title="丢弃当前显示的版本"
                                >
                                  丢弃当前版本
                                </button>
                              )}
                              {a.displayKey === 'original' && (
                                <span
                                  aria-hidden
                                  className="px-1.5 py-0.5 text-[7px] opacity-0 select-none pointer-events-none"
                                >
                                  丢弃当前版本
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 全局框选矩形：根级 / 组内均可见，仅进行中视图展示 */}
        {marqueeActive && (marqueePaneRef.current === 0 || !showArchived) && typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={marqueeOverlayElRef}
              className="fixed pointer-events-none z-[150] rounded-[3px] border-2 border-solid border-[#4570b0] bg-[#121a28]/50 shadow-[inset_0_0_0_1px_rgba(69,112,176,0.2)]"
              style={{ left: 0, top: 0, width: 0, height: 0 }}
            />,
            document.body
          )}
        </div>
        <div
          data-workflow-outline
          className="h-full min-h-0 shrink-0 flex flex-col pr-3 min-w-0"
          style={{ width: `${sidebarWidth}px` }}
        >
          <div ref={outlineScrollRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-0.5 px-3 pt-2 pb-2">
            {activePaneNode === 0 ? (
              repositoryVisibleItems.length === 0 ? (
                <div className="my-3 flex flex-col items-center rounded-xl bg-white/[0.03] px-4 py-6 text-center ring-1 ring-white/[0.06]">
                  <p className="text-[9px] font-black uppercase tracking-wide text-gray-500">暂无条目</p>
                  <p className="mt-1.5 max-w-[14rem] text-[8px] leading-relaxed text-gray-600">
                    {repositoryOutlineMode === 'tags'
                      ? '切回列表模式或清空标签筛选后重试'
                      : '当前筛选下没有仓库资产 · 与顶栏「资产仓库」筛选一致'}
                  </p>
                </div>
              ) : (
                repositoryOutlineMode === 'tags' ? repositoryOutlineTagRows : repositoryOutlineRows
              )
            ) : visibleAssets.length === 0 ? (
              <div className="my-3 flex flex-col items-center rounded-xl bg-white/[0.03] px-4 py-6 text-center ring-1 ring-white/[0.06]">
                <p className="text-[9px] font-black uppercase tracking-wide text-gray-500">大纲为空</p>
                <p className="mt-1.5 max-w-[14rem] text-[8px] leading-relaxed text-gray-600">
                  导入图片或使用能力生成后，根资产将按层级显示在此
                </p>
              </div>
            ) : (
              outlineTreeRows
            )}
          </div>
          {(activePaneNode === 0 || activePaneNode === 1) && (
            <div
              data-workflow-outline-footer
              className="shrink-0 border-t border-white/[0.05] pt-2 pb-2 px-3 bg-[#0a0a0c]/95"
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOutlineFooterDropOver(null);
              }}
            >
              {activePaneNode === 0 ? (
                <div
                  className={`min-h-[5.75rem] rounded-xl border border-dashed px-3 py-3 flex flex-col items-center justify-center gap-1.5 transition-colors ${
                    outlineFooterDropOver === 'toWorkspace'
                      ? 'border-blue-400 bg-blue-950/45'
                      : 'border-white/15 bg-[#0f0f12]'
                  }`}
                  onDragEnter={(e) => {
                    if (Array.from(e.dataTransfer.types).includes(DT_AC_WORKFLOW_EXPORT)) {
                      setOutlineFooterDropOver('toWorkspace');
                    }
                  }}
                  onDragOver={(e) => {
                    if (!Array.from(e.dataTransfer.types).includes(DT_AC_WORKFLOW_EXPORT)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(e) => {
                    setOutlineFooterDropOver(null);
                    handleOutlineDropToWorkspace(e);
                  }}
                >
                  <p className="text-[8px] text-gray-500 text-center leading-snug">
                    从资产仓库或上方列表拖入条目
                  </p>
                  <span className="text-[9px] font-black uppercase text-blue-200/90">放到工作区</span>
                </div>
              ) : (
                <div
                  className={`min-h-[5.75rem] rounded-xl border border-dashed px-3 py-3 flex flex-col items-center justify-center gap-1.5 transition-colors ${
                    outlineFooterDropOver === 'toLibrary'
                      ? 'border-blue-400 bg-blue-950/45'
                      : 'border-white/15 bg-[#0f0f12]'
                  }`}
                  onDragEnter={(e) => {
                    if (Array.from(e.dataTransfer.types).includes(DT_AC_WORKFLOW_EXPORT)) {
                      setOutlineFooterDropOver('toLibrary');
                    }
                  }}
                  onDragOver={(e) => {
                    if (!Array.from(e.dataTransfer.types).includes(DT_AC_WORKFLOW_EXPORT)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(e) => {
                    setOutlineFooterDropOver(null);
                    handleOutlineDropToLibrary(e);
                  }}
                >
                  <p className="text-[8px] text-gray-500 text-center leading-snug">
                    从画布卡片或上方大纲拖入资产
                  </p>
                  <span className="text-[9px] font-black uppercase text-blue-200/90">放到仓库</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="h-full min-h-0 shrink-0 flex flex-col pr-3" style={{ width: `${listPaneWidth}px` }}>
          <div ref={libraryScrollRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
            {repositoryVisibleItems.length === 0 ? (
              <div className="mx-4 flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/[0.03] px-6 py-14 text-center ring-1 ring-white/[0.07]">
                <span className="text-[10px] font-black uppercase tracking-wide text-gray-400">暂无资产</span>
                <span className="max-w-xs text-[8px] leading-relaxed text-gray-600">
                  调整顶栏「筛选 / 全部·仓库·归档」后重试；对话与其它入口生成的图会进入资产库
                </span>
              </div>
            ) : (
              <div className={`min-w-0 py-6 ${WORKFLOW_EDGE_GUTTER}`}>
                <div className="gap-4 relative" style={{ columnCount, columnFill: 'balance' as const }}>
                  {repositoryVisibleItems.map((item) => {
                    const itemTextDisplay = getAssetDisplayText(item);
                    const itemHasTextPayload =
                      !!itemTextDisplay ||
                      !!(item.textTitle || '').trim() ||
                      Object.values(item.textResults || {}).some((v) => String(v || '').trim() !== '');
                    return (
                    <div key={item.id} className="break-inside-avoid mb-6 relative">
                      <div
                        data-workflow-library-card
                        ref={(el) => {
                          if (el) libraryCardRefs.current.set(item.id, el);
                          else libraryCardRefs.current.delete(item.id);
                        }}
                        draggable
                        onDragStart={(e) => {
                          try {
                            const payload: AcWorkflowExportPayload = { mode: 'roots', assetIds: [item.id] };
                            e.dataTransfer.setData(DT_AC_WORKFLOW_EXPORT, JSON.stringify(payload));
                            e.dataTransfer.effectAllowed = 'copy';
                          } catch {
                            /* ignore */
                          }
                        }}
                        className={`group relative rounded-2xl overflow-hidden bg-[#16161a] transition-colors ${
                          isGroupAsset(item) && (item.assetIds?.length ?? 0) > 0
                            ? 'border-0 ring-2 ring-blue-400/45'
                            : WORKFLOW_CARD_SURFACE_IDLE
                        }`}
                        onWheel={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (isGroupAsset(item) && (item.assetIds?.length ?? 0) > 0) {
                            const delta = e.deltaY > 0 ? 1 : -1;
                            setGroupPreviewIndexById((prev) => {
                              const current = prev[item.id] ?? 0;
                              const len = item.assetIds?.length ?? 1;
                              const next = ((current + delta) % len + len) % len;
                              return { ...prev, [item.id]: next };
                            });
                            const direction: 'up' | 'down' = e.deltaY > 0 ? 'down' : 'up';
                            const assetId = item.id;
                            setGroupBounceStateById((prev) => ({ ...prev, [assetId]: direction }));
                            window.setTimeout(() => {
                              setGroupBounceStateById((prev) => ({ ...prev, [assetId]: 'idle' }));
                            }, 180);
                            return;
                          }
                          if (getDisplayKeysForAsset(item).length <= 1) return;
                          cycleDisplayKey(item.id, e.deltaY);
                        }}
                      >
                        {isGroupAsset(item) && (item.assetIds?.length ?? 0) > 0 && !isWorkflowTextAsset(item) && (
                          <>
                            <div className="absolute inset-0 rounded-2xl bg-[#16161a] border border-[#3b6fb8] translate-x-[16px] translate-y-[16px] -rotate-3 opacity-70 shadow-xl shadow-[#000000] pointer-events-none" />
                            <div className="absolute inset-0 rounded-2xl bg-[#1a1a1e] border border-[#6090d0] translate-x-[8px] translate-y-[8px] rotate-1 opacity-90 shadow-xl shadow-[#000000] pointer-events-none" />
                          </>
                        )}
                        <div
                          className="relative cursor-pointer"
                          role="presentation"
                          onClick={() => {
                            // 使用 isGroupAsset 兼容新旧结构
                            if (isGroupAsset(item) && !isWorkflowTextAsset(item)) {
                              setGroupFilterId(item.id);
                              return;
                            }
                            setLightboxSourceSlot(null);
                            setLightboxAssetId(item.id);
                          }}
                        >
                          {!getAssetDisplayImage(item).trim() && isWorkflowTextAsset(item) ? (
                            <div
                              className="relative w-full bg-[#141416] flex flex-col justify-start p-3 text-left"
                              style={{ aspectRatio: `${3 / 4}`, minHeight: '10rem' }}
                            >
                              {item.textTitle?.trim() ? (
                                <p className="text-[11px] font-bold text-gray-100 line-clamp-2 mb-1.5">{item.textTitle.trim()}</p>
                              ) : null}
                              <p
                                className={`text-[10px] text-gray-400 leading-snug whitespace-pre-wrap flex-1 overflow-hidden ${
                                  item.textTitle?.trim() ? 'line-clamp-6' : 'line-clamp-8'
                                }`}
                              >
                                {getAssetDisplayText(item) || '（空白，点击编辑）'}
                              </p>
                            </div>
                          ) : (
                            <div
                              className="relative w-full bg-[#141416] flex justify-center"
                              style={{ aspectRatio: `${cardAspectByAssetId[item.id] ?? 1}` }}
                            >
                              <WorkflowGridImage
                                fullSrc={getAssetDisplayImage(item)}
                                cacheKey={`repo:${item.id}:${item.displayKey}:fp${previewSrcCacheFingerprint(getAssetDisplayImage(item))}`}
                                className="relative z-0 block w-full h-full min-h-[5rem]"
                                imgClassName="relative z-0 block w-full h-full object-cover"
                                draggable={false}
                                onDragStart={(ev) => ev.preventDefault()}
                                onIntrinsicSize={(w, h) => {
                                  setCardAspectByAssetId((prev) => mergeCardAspectFromIntrinsic(prev, item.id, w, h) ?? prev);
                                }}
                              />
                              <div
                                aria-hidden
                                className="absolute inset-0 z-[1]"
                                draggable={false}
                                onDragStart={(e) => e.preventDefault()}
                              />
                            </div>
                          )}
                          {isGroupAsset(item) && (item.assetIds?.length ?? 0) > 0 ? (
                            <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-[#1d4ed8]">
                              {(item.groupLabel ?? '组')} {item.assetIds?.length}
                            </span>
                          ) : !isGroupAsset(item) ? (
                            <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-emerald-900/85 text-emerald-100">
                              资产
                            </span>
                          ) : null}
                        </div>
                        {!isGroupAsset(item) && (!itemHasTextPayload || isWorkflowTextAsset(item)) && (
                          <div className="p-2 flex flex-col gap-1.5 border-t border-white/[0.06] bg-[#08080b]/80">
                            <div className="flex gap-1 flex-wrap items-center justify-between min-h-[18px]">
                              <span className={WORKFLOW_META_PILL}>
                                <span className="font-black text-blue-300">{getGeneratedImageCount(item)}</span>
                                <span className="text-gray-500">·</span>
                                <span className="text-gray-400">{getAssetDisplayTypeLabel(item)}</span>
                              </span>
                              {item.displayKey !== 'original' ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    discardResult(item.id, item.displayKey);
                                  }}
                                  className="px-1.5 py-0.5 rounded text-[7px] text-red-400 hover:bg-[#4a1c1c]"
                                  title="丢弃当前显示的版本"
                                >
                                  丢弃当前版本
                                </button>
                              ) : (
                                <span aria-hidden className="px-1.5 py-0.5 text-[7px] opacity-0 select-none pointer-events-none">
                                  丢弃当前版本
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
        </div>
      </div>
      </div>

      {/* 进行中：大图弹窗；外壳统一为 ImagePreviewOverlay，当前版本为纯文本时仅中央为文字编辑区 */}
      {lightboxAsset && !showArchived && (
        <ImagePreviewOverlay
          open
          resetKey={lightboxAsset.id}
          imageSrc={
            lightboxShowsImage || !isWorkflowTextAsset(lightboxAsset)
              ? getLightboxPreviewImageSrc(lightboxAsset)
              : undefined
          }
          centerSlot={
            !lightboxShowsImage && isWorkflowTextAsset(lightboxAsset) ? (
              <WorkflowTextLightboxCenter
                ref={textLightboxCenterRef}
                resetKey={`${lightboxAsset.id}:${lightboxAsset.displayKey}`}
                title={lightboxAsset.textTitle ?? ''}
                body={getAssetDisplayText(lightboxAsset)}
                onPersist={(next) => {
                  const id = lightboxAsset.id;
                  const currentKey = lightboxAsset.displayKey;
                  setAssets((prev) =>
                    prev.map((x) => {
                      if (x.id !== id) return x;
                      if (currentKey !== 'original') {
                        return {
                          ...x,
                          textTitle: next.textTitle,
                          textResults: { ...(x.textResults || {}), [currentKey]: next.textBody },
                        };
                      }
                      return { ...x, textTitle: next.textTitle, textBody: next.textBody };
                    })
                  );
                }}
                onSaveAndClose={() => {
                  setLightboxAssetId(null);
                  setLightboxSourceSlot(null);
                }}
              />
            ) : undefined
          }
          onClose={() => {
            setLightboxAssetId(null);
            setLightboxSourceSlot(null);
          }}
          wheelListLength={lightboxList.length}
          onWheelNavigate={handleLightboxWheelNavigate}
          innerWheelOptionCount={getDisplayKeysForAsset(lightboxAsset).length}
          onWheelInnerNavigate={handleLightboxWheelCycleDisplay}
          innerLayoutStableKey={lightboxShowsImage ? lightboxAsset.id : undefined}
          contentRightInset="0px"
          enablePanoramaMode={lightboxShowsImage}
          modelUrls={lightboxModelUrls}
          modelFileName={lightboxAsset.modelSourceName}
          layoutReferenceSrc={
            lightboxShowsImage && asWorkflowImageString(lightboxAsset.original).trim()
              ? workflowSafeImgSrc(lightboxAsset.original)
              : undefined
          }
        >
          <div className="absolute left-4 bottom-4 z-10 flex flex-col items-start gap-2" data-image-preview-no-wheel>
            {(isWorkflowTextAsset(lightboxAsset) ? textAssetActionModules : actionModules).map((mod) => (
              <button
                key={mod.id}
                type="button"
                onClick={() => {
                  const idx = lightboxList.findIndex((a) => a.id === lightboxAsset.id);
                  const nextAsset = idx >= 0 && idx < lightboxList.length - 1 ? lightboxList[idx + 1] : null;
                  addToPending(lightboxAsset.id, mod.id, {
                    ...(lightboxSourceSlot
                      ? {
                          sourceGroupAssetId: lightboxSourceSlot.sourceGroupAssetId,
                          sourceItemIndex: lightboxSourceSlot.sourceItemIndex,
                        }
                      : {}),
                  });
                  setLightboxSourceSlot(null);
                  setLightboxAssetId(nextAsset?.id ?? null);
                }}
                className="inline-flex w-auto rounded-lg bg-white/[0.07] px-3 py-1.5 text-[9px] font-black uppercase text-gray-200 ring-1 ring-white/[0.1] hover:bg-blue-950/50 hover:ring-blue-500/40 transition-colors"
              >
                {mod.label}
              </button>
            ))}
          </div>
          <div
            className="absolute top-16 right-4 z-[9] w-[min(24rem,30vw)] max-h-[72vh]"
            data-image-preview-no-wheel
            data-image-preview-scroll
          >
            <div className="h-full overflow-y-auto rounded-2xl border border-white/10 bg-[#0f0f12]/98 shadow-xl backdrop-blur-[2px]">
              {lightboxMetaText ? (
                <div className="px-3 pt-3 pb-2 border-b border-white/10 text-[8px] text-gray-400">
                  {lightboxMetaText}
                </div>
              ) : null}
              {(() => {
                const displayKey = lightboxAsset.displayKey;
                const saved = (lightboxAsset.imageTags?.[displayKey] || []).filter(Boolean);
                const tags =
                  saved.length > 0
                    ? saved
                    : displayKey !== 'original'
                      ? buildWorkflowImageTags({
                          actionLabel: getActionLabel(baseActionId(displayKey)),
                          actionId: baseActionId(displayKey),
                          presetInstruction: getModule(baseActionId(displayKey))?.instruction,
                        })
                      : [];
                return (
                  <div className="px-3 pt-3 pb-2 border-b border-white/10">
                    <div className="text-[8px] font-black text-gray-500 uppercase mb-1.5">标签</div>
                    {tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                        {tags.map((tag) => (
                          <span
                            key={`${lightboxAsset.id}:${lightboxAsset.displayKey}:${tag}:right`}
                            className="px-2 py-0.5 rounded-md border border-[#314767] bg-[#182235] text-[8px] text-blue-200/95"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[8px] text-gray-600">当前版本暂无标签</div>
                    )}
                  </div>
                );
              })()}
              {isWorkflowTextAsset(lightboxAsset) && lightboxAsset.displayKey !== 'original' ? (
                <div className="px-3 py-3 border-b border-white/10">
                  <button
                    type="button"
                    onClick={() => discardResult(lightboxAsset.id, lightboxAsset.displayKey)}
                    className="w-full px-2 py-1.5 rounded text-[9px] font-black text-red-300 border border-red-900/60 bg-red-950/25 hover:bg-red-900/30"
                  >
                    丢弃当前版本
                  </button>
                </div>
              ) : null}
              <WorkflowGenerationRecordPanel
                asset={lightboxAsset}
                getStepLabel={getGenerationRecordStepLabel}
                mode="inline"
                onSelectDisplayKey={(key) => setDisplayKey(lightboxAsset.id, key)}
              />
            </div>
          </div>
          <div
            className="absolute bottom-4 z-10 max-h-[42vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0f0f12]/98 p-3 sm:p-4 space-y-3 shadow-xl backdrop-blur-[2px]"
            style={{
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'min(58rem, calc(100vw - 3rem))',
            }}
            data-image-preview-no-wheel
            data-image-preview-scroll
          >
            <div className="flex flex-wrap gap-1.5 justify-center items-center">
              {!lightboxShowsImage ? (
                <>
                  <button
                    type="button"
                    onClick={() => textLightboxCenterRef.current?.setEditingMode(true)}
                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${WORKFLOW_LIGHTBOX_TAB_IDLE}`}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => textLightboxCenterRef.current?.setEditingMode(false)}
                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${WORKFLOW_LIGHTBOX_TAB_IDLE}`}
                  >
                    预览
                  </button>
                  <button
                    type="button"
                    onClick={() => textLightboxCenterRef.current?.save()}
                    className="px-3 py-1.5 rounded-lg bg-[#1e40af] border border-[#3b6fb8] text-[9px] font-black uppercase hover:bg-blue-500"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => textLightboxCenterRef.current?.saveAndClose()}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 border border-blue-500 text-[9px] font-black uppercase text-white hover:bg-blue-500"
                  >
                    保存并关闭
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (!lightboxShowsImage) {
                    const title = (lightboxAsset.textTitle || '').trim();
                    const body = getAssetDisplayText(lightboxAsset);
                    const t = title ? `${title}\n\n${body}` : body;
                    const blob = new Blob([t], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    try {
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `workflow-text-${lightboxAsset.id.slice(0, 6)}.txt`;
                      a.click();
                    } finally {
                      URL.revokeObjectURL(url);
                    }
                    return;
                  }
                  void triggerImageDownload(
                    getAssetDisplayImage(lightboxAsset),
                    `workflow-preview-${lightboxAsset.id.slice(0, 6)}`
                  );
                }}
                className="px-3 py-1.5 rounded-lg bg-[#1e40af] border border-[#3b6fb8] text-[9px] font-black uppercase hover:bg-blue-500"
              >
                下载
              </button>
              {lightboxModelUrls.map((url, idx) => (
                <a
                  key={`${url}:${idx}`}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-[#3730a3] border border-[#6366f1] text-[9px] font-black uppercase text-indigo-200 hover:bg-[#4f46e5]"
                >
                  下载模型{lightboxModelUrls.length > 1 ? ` ${idx + 1}` : ''}
                </a>
              ))}
              <span className="text-[8px] font-black text-gray-500 uppercase mr-1">显示</span>
              <button
                type="button"
                onClick={() => setDisplayKey(lightboxAsset.id, 'original')}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${lightboxAsset.displayKey === 'original' ? 'bg-blue-600 border-blue-500 text-white' : WORKFLOW_LIGHTBOX_TAB_IDLE}`}
              >
                原始
              </button>
              {isGroupAsset(lightboxAsset) && (lightboxAsset.assetIds?.length ?? 0) > 0 ? (
                <button
                  type="button"
                  onClick={() => setDisplayKey(lightboxAsset.id, 'group_preview')}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${lightboxAsset.displayKey === 'group_preview' ? 'bg-blue-600 border-blue-500 text-white' : WORKFLOW_LIGHTBOX_TAB_IDLE}`}
                >
                  组预览
                </button>
              ) : null}
              {(lightboxAsset.resultOrder || []).map((k) => {
                if (baseActionId(k) === 'cut_image') return null;
                const mod = getModule(baseActionId(k));
                const label = mod?.label ?? baseActionId(k);
                if (isWorkflowTextAsset(lightboxAsset)) {
                  const hasText = Boolean((lightboxAsset.textResults || {})[k]);
                  const hasImg = Boolean(asWorkflowImageString(lightboxAsset.results?.[k]).trim());
                  if (!hasText && !hasImg) return null;
                } else if (!lightboxAsset.results?.[k]) {
                  return null;
                }
                return (
                  <button
                    type="button"
                    key={k}
                    onClick={() => setDisplayKey(lightboxAsset.id, k)}
                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${lightboxAsset.displayKey === k ? 'bg-blue-600 border-blue-500 text-white' : WORKFLOW_LIGHTBOX_TAB_IDLE}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </ImagePreviewOverlay>
      )}

      {hoverPreview ? (
        <WorkflowCapabilityHoverPreview
          label={hoverPreview.mod.label}
          x={hoverPreview.x}
          y={hoverPreview.y}
          original={getModulePreviewOriginal(hoverPreview.mod) ?? ''}
          generated={getModulePreviewGenerated(hoverPreview.mod) ?? ''}
        />
      ) : null}

      {/* 已完成：归档详情弹窗（流程图 + 下载） */}
      {archivedDetailAsset && (
        <ArchivedDetailModal
          asset={archivedDetailAsset}
          assets={assets}
          modules={actionModules}
          onClose={() => setArchivedDetailAssetId(null)}
        />
      )}

      {/* 切割图片：识别物体后选择区域 */}
      {cutSelectState && (
        <CutSelectModal
          inputImage={cutSelectState.inputImage}
          boxes={cutSelectState.boxes}
          onConfirm={onCutConfirm}
          onCancel={() => {
            const task = cutSelectState.task;
            setCutSelectState(null);
            setPending(cutSelectState.remaining);
            setAssets((prev) => prev.map((a) => (a.id === task.assetId ? { ...a, hiddenInGrid: false } : a)));
            setExecuting(false);
          }}
        />
      )}
      {composerSessions.map((sess) => (
        <Suspense key={sess.id} fallback={null}>
          <WorkflowComposerOverlay
            open
            onClose={() => closeComposerSession(sess.id)}
            sessionKey={sess.sessionKey}
            presets={capabilityPresets}
            initialSet={sess.initialSet}
            isForeground={sess.id === composerActiveId}
            dockStackIndex={getComposerDockStackIndex(sess.id)}
            dockStackCount={getComposerDockStackCount(sess.id)}
            onRequestForeground={() => setComposerActiveId(sess.id)}
            onMinimizedChange={(minimized) =>
              setComposerMinimized((prev) => {
                if (prev[sess.id] === minimized) return prev;
                return { ...prev, [sess.id]: minimized };
              })
            }
            onSave={handleComposerSave}
            onLog={onLog}
            getPartialTestInputImage={getComposerPartialTestInputImage}
            assetCandidates={composerAssetCandidates}
          />
        </Suspense>
      ))}

      {promptTweakModal && (
        <PromptTweakModal
          preset={promptTweakModal.preset}
          targets={promptTweakModal.targets}
          mode={promptTweakModal.mode}
          initialText={promptTweakModal.initialText}
          titleText={promptTweakModal.titleText}
          helperText={promptTweakModal.helperText}
          placeholderText={promptTweakModal.placeholderText}
          requireNonEmpty={promptTweakModal.requireNonEmpty}
          onConfirm={(editedPrompt) => {
            const trimmed = editedPrompt.trim();
            if (promptTweakModal.requireNonEmpty && !trimmed) return;
            const mode = promptTweakModal.mode ?? 'replace';
            const promptForExecution =
              mode === 'append'
                ? [promptTweakModal.preset.instruction?.trim() || '', trimmed].filter(Boolean).join('\n\n').trim()
                : trimmed;
            const generateCount = normalizeWorkflowGenerateCount(promptTweakModal.overrides?.generateCount);
            if (
              generateCount > WORKFLOW_GROUP_GENERATE_CONFIRM_THRESHOLD &&
              typeof window !== 'undefined' &&
              !window.confirm(`当前生成数量为 ${generateCount}，将创建大量任务，是否继续？`)
            ) {
              return;
            }
            const taskOptions: WorkflowPendingTaskOptions = {
              ...(promptForExecution ? { promptOverride: promptForExecution } : {}),
              ...(promptTweakModal.overrides?.imageGear ? { overrideImageGear: promptTweakModal.overrides.imageGear } : {}),
              ...(promptTweakModal.overrides?.imageAspectRatio ? { overrideImageAspectRatio: promptTweakModal.overrides.imageAspectRatio } : {}),
              ...(promptTweakModal.overrides?.imageSize ? { overrideImageSize: promptTweakModal.overrides.imageSize } : {}),
              ...(typeof promptTweakModal.overrides?.understand === 'boolean'
                ? { overrideSkipUnderstand: promptTweakModal.overrides.understand }
                : {}),
            };
            const tasks: WorkflowPendingTask[] = [];
            const clonePlans: Array<{ sourceId: string; cloneId: string }> = [];
            const groupPlans: string[][] = [];
            for (const t of promptTweakModal.targets) {
              if ('assetId' in t) {
                tasks.push({
                  id: uuid(),
                  assetId: t.assetId,
                  actionType: promptTweakModal.preset.id,
                  inputImage: t.inputImage,
                  addedAt: Date.now(),
                  ...(t.inputSourceDisplayKey != null ? { inputSourceDisplayKey: t.inputSourceDisplayKey } : {}),
                  ...(taskOptions.promptOverride != null ? { promptOverride: taskOptions.promptOverride } : {}),
                  ...(taskOptions.overrideImageGear ? { overrideImageGear: taskOptions.overrideImageGear } : {}),
                  ...(taskOptions.overrideImageAspectRatio ? { overrideImageAspectRatio: taskOptions.overrideImageAspectRatio } : {}),
                  ...(taskOptions.overrideImageSize ? { overrideImageSize: taskOptions.overrideImageSize } : {}),
                  ...(typeof taskOptions.overrideSkipUnderstand === 'boolean'
                    ? { overrideSkipUnderstand: taskOptions.overrideSkipUnderstand }
                    : {}),
                  ...(t.sourceGroupAssetId != null ? { sourceGroupAssetId: t.sourceGroupAssetId, sourceItemIndex: t.sourceItemIndex } : {}),
                  ...(t.inputText != null && t.inputText.trim() !== '' ? { inputText: t.inputText.trim() } : {}),
                });
                if (generateCount > 1 && t.sourceGroupAssetId == null) {
                  const sourceAsset = assets.find((a) => a.id === t.assetId);
                  if (sourceAsset && !sourceAsset.parentAssetId) {
                    const idsForGroup = [t.assetId];
                    for (let i = 1; i < generateCount; i += 1) {
                      const cloneId = uuid();
                      clonePlans.push({ sourceId: t.assetId, cloneId });
                      idsForGroup.push(cloneId);
                      tasks.push({
                        id: uuid(),
                        assetId: cloneId,
                        actionType: promptTweakModal.preset.id,
                        inputImage: t.inputImage,
                        addedAt: Date.now(),
                        ...(t.inputSourceDisplayKey != null ? { inputSourceDisplayKey: t.inputSourceDisplayKey } : {}),
                        ...(taskOptions.promptOverride != null ? { promptOverride: taskOptions.promptOverride } : {}),
                        ...(taskOptions.overrideImageGear ? { overrideImageGear: taskOptions.overrideImageGear } : {}),
                        ...(taskOptions.overrideImageAspectRatio ? { overrideImageAspectRatio: taskOptions.overrideImageAspectRatio } : {}),
                        ...(taskOptions.overrideImageSize ? { overrideImageSize: taskOptions.overrideImageSize } : {}),
                        ...(typeof taskOptions.overrideSkipUnderstand === 'boolean'
                          ? { overrideSkipUnderstand: taskOptions.overrideSkipUnderstand }
                          : {}),
                        ...(t.inputText != null && t.inputText.trim() !== '' ? { inputText: t.inputText.trim() } : {}),
                      });
                    }
                    if (idsForGroup.length > 1) groupPlans.push(idsForGroup);
                  }
                }
              } else {
                const runTimes = generateCount > 1 ? generateCount : 1;
                for (let i = 0; i < runTimes; i += 1) {
                  addImageToPending(t.imageBase64, promptTweakModal.preset.id, {
                    parentAssetId: t.parentAssetId,
                    sourceGroupAssetId: t.sourceGroupAssetId,
                    sourceItemIndex: t.sourceItemIndex,
                    ...(taskOptions.promptOverride != null ? { promptOverride: taskOptions.promptOverride } : {}),
                    ...(taskOptions.overrideImageGear ? { overrideImageGear: taskOptions.overrideImageGear } : {}),
                    ...(taskOptions.overrideImageAspectRatio ? { overrideImageAspectRatio: taskOptions.overrideImageAspectRatio } : {}),
                    ...(taskOptions.overrideImageSize ? { overrideImageSize: taskOptions.overrideImageSize } : {}),
                    ...(typeof taskOptions.overrideSkipUnderstand === 'boolean'
                      ? { overrideSkipUnderstand: taskOptions.overrideSkipUnderstand }
                      : {}),
                  });
                }
              }
            }
            if (clonePlans.length > 0) {
              setAssets((prev) => {
                let next = [...prev];
                for (const plan of clonePlans) {
                  const src = next.find((a) => a.id === plan.sourceId);
                  if (!src) continue;
                  const clone: WorkflowAsset = {
                    ...src,
                    id: plan.cloneId,
                    parentAssetId: undefined,
                    archived: false,
                    hiddenInGrid: false,
                    createdAt: Date.now(),
                  };
                  next.push(clone);
                  const o = String(clone.original || '').trim();
                  if (o) queueMicrotask(() => scheduleCompanionPersistOriginalAny(plan.cloneId, o));
                }
                const allowTextAssetsForGenerateCount =
                  promptTweakModal.preset.category === 'text_to_text' ||
                  promptTweakModal.preset.category === 'text_to_image';
                for (const ids of groupPlans) {
                  const r = insertManualGroupForAssetIds(next, ids, {
                    allowTextAssets: allowTextAssetsForGenerateCount,
                  });
                  next = r.next;
                  if (r.createdGroup) {
                    const cg = r.createdGroup;
                    queueMicrotask(() => scheduleCompanionPersistOriginalAny(cg.id, cg.coverImage));
                  }
                }
                return next;
              });
            }
            if (tasks.length > 0) addTasksToPending(tasks);
            setPromptTweakModal(null);
            setDraggingAssetIds(null);
            setDraggingGroupItems(null);
          }}
          onCancel={() => {
            setPromptTweakModal(null);
            setDraggingAssetIds(null);
            setDraggingGroupItems(null);
          }}
        />
      )}
    </div>
    {typeof document !== 'undefined'
      ? createPortal(
          <WorkspaceQuickComposeBar
            visible={
              quickComposeShellActive &&
              quickComposeOptions.length > 0 &&
              !lightboxAsset &&
              !cutSelectState &&
              !promptTweakModal
            }
            options={quickComposeOptions}
            actionId={quickComposeActionId}
            onActionChange={setQuickComposeActionId}
            draft={quickComposeDraft}
            onDraftChange={setQuickComposeDraft}
            attachedImage={quickComposeImage}
            onAttachImage={setQuickComposeImage}
            onClearAttachment={() => setQuickComposeImage(null)}
            onSubmit={submitQuickCompose}
          />,
          document.body
        )
      : null}
    </>
  );
};

export default WorkflowSection;
