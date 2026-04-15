import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  useLayoutEffect,
  startTransition,
  Suspense,
  lazy,
} from 'react';
import { useWorkflowWorkspacePanes } from '../hooks/useWorkflowWorkspacePanes';
import { useWorkflowMarquee } from '../hooks/useWorkflowMarquee';
import { createPortal } from 'react-dom';
import type { WorkflowAsset, WorkflowPendingTask, CapabilitySet, VgpGenStepCapture } from '../types';
import type { CustomAppModule, LibraryItem, WorkflowCutGroupItem } from '../types';
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
  applyVgpAfterCutStep,
  attachInitialVgpToNewAsset,
} from '../services/vgp/vgpStore';
import { WorkflowGenerationRecordPanel } from './WorkflowGenerationRecordPanel';
import { triggerImageDownload } from '../services/imageDataUrl';
import { readLocalJson, workflowFavoritesStorageKey, writeLocalJson } from '../services/clientPersist';
import {
  buildWorkflowImageTags,
  normalizeWorkflowTagMapToChinese,
  refineWorkflowImageTagsLowCost,
} from '../services/workflowImageTags';
import AppIcon from './ui/AppIcon';
import { ImagePreviewOverlay } from './ImagePreviewOverlay';
import { resolveCapabilityPreviewSrc } from '../services/capabilityPreviewUrl';
import { WorkflowCapabilityHoverPreview } from './WorkflowCapabilityHoverPreview';
import { WorkflowGridImage } from './ProgressivePreviewImage';
import WorkflowPixelBusyOverlay from './WorkflowPixelBusyOverlay';
import { workflowSafeImgSrc } from '../services/workflowImageDisplay';
import {
  type AcWorkflowExportPayload,
  DT_AC_CAPABILITY_ACTION,
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
  dragTransferHasPlainText,
  cloneCapabilityPresetPanelWithScrollRef,
  cropBoxes,
} from './workflow/workflowSectionHelpers';
import { CutSelectModal, PromptTweakModal, ArchivedDetailModal, type PromptTweakTarget } from './workflow/modals';
import {
  SET_ACTION_PREFIX,
  SECTION_HEADER_CLASS,
  SECTION_TITLE_CLASS,
  TITLE_ROW_BTN_BASE,
  TITLE_ROW_BTN_NEUTRAL,
  TITLE_ROW_BTN_ACTIVE,
} from './workflow/workflowSectionUiConstants';
import {
  sortRootWorkflowAssetsNewestFirst,
  workflowOutlineAncestorStack,
  workflowOutlineDrillStackToEnterGroup,
  workflowFindGroupItemIndex,
  workflowOutlineExpandableGroupIds,
} from './workflow/workflowOutlineUtils';
import { isWorkflowEditableTarget } from './workflow/workflowDomUtils';
import {
  clampWorkflowCardAspectRatio,
  mergeCardAspectFromIntrinsic,
  persistWorkflowCardAspects,
  readSessionWorkflowCardAspects,
} from './workflow/workflowCardAspect';
import { groupCapabilityPresetsByCategory } from './workflow/workflowCapabilityGroups';
import { workflowTopTitleGridStyle } from './workflow/workflowPaneLayout';
import { WorkflowSidebarColumn, type WorkflowSidebarFavoriteEntry } from './workflow/WorkflowSidebarColumn';
import { buildWorkflowComposerSeedFromTwoPresets } from './workflow/buildWorkflowComposerSeed';
import type { CapabilityAssetCandidate } from './CapabilitySetCanvas';

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

function normalizeWorkflowGenerateCount(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(WORKFLOW_GROUP_GENERATE_COUNT_HARD_MAX, n));
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
  onAddGenerate3DJob?: (preset: CustomAppModule, imageBase64: string) => void;
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
}) => {
  const assets = Array.isArray(assetsProp) ? assetsProp : [];
  const pending = Array.isArray(pendingProp) ? pendingProp : [];
  const capabilitySets = Array.isArray(capabilitySetsProp) ? capabilitySetsProp : [];
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
  } | null>(null);
  const [viewStack, setViewStack] = useState<{ assetId: string }[]>([]);
  const viewStackRef = useRef(viewStack);
  viewStackRef.current = viewStack;
  const [showAllInGroup, setShowAllInGroup] = useState(false);
  const [groupStringLightboxIndex, setGroupStringLightboxIndex] = useState<number | null>(null);
  const [draggingGroupItems, setDraggingGroupItems] = useState<{ groupAssetId: string; itemIndexes: number[] } | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [selectedGroupItemKeys, setSelectedGroupItemKeys] = useState<Set<string>>(new Set());
  const [capabilityPresetViewMode, setCapabilityPresetViewMode] = useState<'presets' | 'image_process' | 'sets'>('presets');
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
  }, []);
  const sidebarWidth = 320;
  const paneWidth = Math.max(320, workspaceViewportWidth || 0);
  const listPaneWidth = Math.max(320, paneWidth - sidebarWidth);
  const presetPaneWidth = listPaneWidth;
  const trackTotalWidth = listPaneWidth + sidebarWidth + listPaneWidth + sidebarWidth + presetPaneWidth;
  const marqueeStartRef = useRef(false);
  const {
    workspacePane,
    setWorkspacePane,
    workspacePaneRef,
    setWorkspacePaneRaf,
    snapWorkspacePaneToNode,
    handlePaneWheel,
    workspaceOffsetPx,
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
    viewStackRef,
    pendingRef,
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
      if (!asset.parentAssetId) {
        setViewStack([]);
        setSelectedGroupItemKeys(new Set());
        setSelectedAssetIds(new Set([asset.id]));
        requestAnimationFrame(() => {
          cardRefs.current.get(asset.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
        return;
      }
      const parent = assets.find((p) => p.id === asset.parentAssetId);
      if (!parent) return;
      const idx = workflowFindGroupItemIndex(parent, asset.id);
      if (idx == null) return;
      setViewStack(workflowOutlineAncestorStack(asset.id, assets));
      setSelectedAssetIds(new Set());
      setSelectedGroupItemKeys(new Set([`${parent.id}::${idx}`]));
      requestAnimationFrame(() => {
        cardRefs.current.get(`${parent.id}::${idx}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    },
    [assets]
  );

  const navigateOutlineToGroupItem = useCallback(
    (group: WorkflowAsset, itemIndex: number) => {
      setViewStack(workflowOutlineDrillStackToEnterGroup(group.id, assets));
      setSelectedAssetIds(new Set());
      setSelectedGroupItemKeys(new Set([`${group.id}::${itemIndex}`]));
      requestAnimationFrame(() => {
        cardRefs.current.get(`${group.id}::${itemIndex}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    },
    [assets]
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

  const getModule = (id: string) => actionModules.find((m) => m.id === id);
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
  const getSet = (id: string) => capabilitySets.find((s) => s.id === id);
  const getActionLabel = (actionType: string) => {
    if (actionType.startsWith(SET_ACTION_PREFIX)) {
      const set = getSet(actionType.slice(SET_ACTION_PREFIX.length));
      return set?.label ?? actionType;
    }
    return getModule(actionType)?.label ?? actionType;
  };
  const getGenerationRecordStepLabel = (stepKey: string) => {
    if (stepKey === 'original') return '原图';
    if (stepKey === 'cut_image') return '切割';
    if (stepKey.startsWith(SET_ACTION_PREFIX)) {
      const s = getSet(stepKey.slice(SET_ACTION_PREFIX.length));
      return s?.label ?? stepKey;
    }
    return getModule(baseActionId(stepKey))?.label ?? stepKey;
  };
  const getAssetDisplayImage = (a: WorkflowAsset, assetsList: WorkflowAsset[] = assets, visited: Set<string> = new Set()): string => {
    const orig = asWorkflowImageString(a.original);
    if (isWorkflowTextAsset(a)) {
      if (a.displayKey === 'original') return orig;
      const fromResults = (a.results as Record<string, unknown>)[a.displayKey];
      return asWorkflowImageString(fromResults) || orig;
    }
    if (a.displayKey === 'original') return orig;
    if (a.displayKey === 'cut_image' && a.cutImageGroup?.length) {
      const first = a.cutImageGroup[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object' && 'r2Key' in first) return orig;
      if (visited.has(a.id)) return orig;
      visited.add(a.id);
      const ref = first && typeof first === 'object' && 'assetId' in first ? (first as { assetId: string }).assetId : '';
      const child = ref ? assetsList.find((x) => x.id === ref) : undefined;
      return child ? getAssetDisplayImage(child, assetsList, visited) : orig;
    }
    const fromResults = (a.results as Record<string, unknown>)[a.displayKey];
    return asWorkflowImageString(fromResults) || orig;
  };
  const getAssetDisplayText = (a: WorkflowAsset): string => {
    if (!isWorkflowTextAsset(a)) return '';
    if (a.displayKey === 'original') return (a.textBody ?? '').trim();
    return ((a.textResults || {})[a.displayKey] ?? '').trim();
  };
  const getAssetDisplayTypeLabel = (a: WorkflowAsset): string => {
    if (isWorkflowTextAsset(a)) return '文字';
    if (a.displayKey === 'original') return '原始';
    if (a.displayKey === 'cut_image') return a.groupKind === 'manual' ? '组' : '切割';
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
  const getLightboxPreviewImageSrc = useCallback((asset: WorkflowAsset): string => {
    const display = getAssetDisplayImage(asset).trim();
    if (display) return workflowSafeImgSrc(display);
    return buildTextLightboxPreviewDataUrl(asset.textTitle || '', getAssetDisplayText(asset));
  }, [buildTextLightboxPreviewDataUrl]);
  const repositoryItems = useMemo<WorkflowAsset[]>(() => {
    const q = libraryTagQuery.trim().toLowerCase();
    const base = assets.filter((a) => {
      if (a.parentAssetId) return false;
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
  }, [assets, libraryFilter, libraryTagQuery]);
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
      if (isWorkflowTextAsset(asset)) {
        if (!mod || !workflowPresetAcceptsTextCardDrag(mod)) {
          onLog?.('warn', '文字资产请拖入「文字能力」或「生图」类预设');
          return null;
        }
      }
      const inputImage = getAssetDisplayImage(asset);
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
  }, [onLog]);

  const addTasksToPending = useCallback((tasks: WorkflowPendingTask[]) => {
    if (tasks.length === 0) return;
    setPending((prev) => [...prev, ...tasks]);
  }, []);

  const removeFromPending = useCallback((taskId: string) => {
    const task = pending.find((t) => t.id === taskId);
    setPending((prev) => prev.filter((t) => t.id !== taskId));
    if (task) {
      setAssets((prev) => prev.map((x) => (x.id === task.assetId ? { ...x, hiddenInGrid: false } : x)));
    }
  }, [pending]);

  const runTask = async (
    task: WorkflowPendingTask,
    batchGroup?: { key: string; expected: number }
  ): Promise<{ image: string | null; text?: string; vgpSteps?: VgpGenStepCapture[] }> => {
    const { actionType, inputImage, inputText } = task;
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
        const result = await executeCapabilitySet(set, inputImage ?? '', {
          presets: actionModules,
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
        return result.kind === 'image'
          ? { image: result.image, vgpSteps: result.vgpSteps }
          : { image: null };
      } finally {
        clearSetRunUi();
      }
    }
    const module = getModule(actionType);
    if (module?.category === 'generate_3d') {
      const msg = '生成3D 请拖图到能力框提交，不进入执行队列';
      onLog?.('warn', msg);
      setAssetError(task.assetId, msg);
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
        const out = await executeCapability(preset, inputImage ?? '', { onLog }, {
          inputText,
          ...(batchGroup ? { batchGroupKey: batchGroup.key, batchGroupExpected: batchGroup.expected } : {}),
        });
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
  };

  const replaceGroupItemWithSubAsset = useCallback((groupAssetId: string, itemIndex: number, subAssetId: string) => {
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== groupAssetId || !a.cutImageGroup) return a;
        const next = [...a.cutImageGroup];
        if (itemIndex >= 0 && itemIndex < next.length) next[itemIndex] = { assetId: subAssetId };
        return { ...a, cutImageGroup: next };
      })
    );
  }, []);

  /** 一次性将组内多个槽位移出到上一级，避免多次 setAssets 导致下标错位 */
  const moveGroupItemsToUpperLevel = useCallback(
    (groupAssetId: string, itemIndexes: number[]) => {
      if (itemIndexes.length === 0) return;
      setAssets((prev) => {
        const list = [...prev];
        const groupIdx = list.findIndex((a) => a.id === groupAssetId);
        if (groupIdx === -1) return prev;
        const group = list[groupIdx];
        const items = group.cutImageGroup ?? [];
        const dedupIndexes = Array.from(new Set(itemIndexes)).filter((i) => i >= 0 && i < items.length);
        if (dedupIndexes.length === 0) return prev;
        const indexSet = new Set(dedupIndexes);
        const nextItems = items.filter((_, i) => !indexSet.has(i));
        const parentId = group.parentAssetId;

        const childIds: string[] = [];
        const childIdSeen = new Set<string>();
        items.forEach((item, i) => {
          if (!indexSet.has(i)) return;
          const childId =
            typeof item === 'object' && item && 'assetId' in item ? (item as { assetId: string }).assetId : null;
          if (childId && !childIdSeen.has(childId)) {
            childIdSeen.add(childId);
            childIds.push(childId);
          }
        });

        if (nextItems.length === 0) {
          list.splice(groupIdx, 1);
          if (parentId) {
            const parentIdx = list.findIndex((a) => a.id === parentId);
            if (parentIdx !== -1) {
              const parent = list[parentIdx];
              const parentItems = (parent.cutImageGroup ?? []).filter(
                (it) => !(typeof it === 'object' && it && 'assetId' in it && (it as { assetId: string }).assetId === groupAssetId)
              );
              list[parentIdx] = { ...parent, cutImageGroup: parentItems.length ? parentItems : undefined };
            }
          }
        } else {
          list[groupIdx] = { ...group, cutImageGroup: nextItems };
        }

        childIds.forEach((childId) => {
          const childIdx = list.findIndex((a) => a.id === childId);
          if (childIdx === -1) return;
          const child = list[childIdx];
          if (parentId) {
            const parentIdx = list.findIndex((a) => a.id === parentId);
            if (parentIdx !== -1) {
              const parent = list[parentIdx];
              const existsInParent = (parent.cutImageGroup ?? []).some(
                (it) => typeof it === 'object' && it && 'assetId' in it && (it as { assetId: string }).assetId === childId
              );
              const parentItems = existsInParent
                ? [...(parent.cutImageGroup ?? [])]
                : [...(parent.cutImageGroup ?? []), { assetId: childId }];
              list[parentIdx] = { ...parent, cutImageGroup: parentItems };
              list[childIdx] = { ...child, parentAssetId: parent.id };
            } else {
              list[childIdx] = { ...child, parentAssetId: undefined };
            }
          } else {
            list[childIdx] = { ...child, parentAssetId: undefined };
          }
        });
        return list;
      });
      setViewStack((s) => s.filter((x) => x.assetId !== groupAssetId));
      setSelectedGroupItemKeys((prev) => {
        const next = new Set(prev);
        next.forEach((key) => {
          if (String(key).startsWith(`${groupAssetId}::`)) next.delete(key);
        });
        return next;
      });
    },
    [setAssets]
  );

  const moveGroupItemToUpperLevel = useCallback(
    (groupAssetId: string, itemIndex: number) => {
      moveGroupItemsToUpperLevel(groupAssetId, [itemIndex]);
    },
    [moveGroupItemsToUpperLevel]
  );

  const removeFromGroup = useCallback(
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
            return;
          }
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
                parentAssetId: task.assetId,
              })
            );
            const cutImageGroup = newAssets.map((x) => ({ assetId: x.id }));
            const nextOrder = [...(taskAsset.resultOrder || []), task.actionType];
            const nextMeta = {
              ...(taskAsset.resultMeta || {}),
              [task.actionType]: { executedAt: Date.now() },
            };
            const next = [...prev, ...newAssets];
            const usedLabels = new Set<string>(prev.map((a) => a.groupLabel).filter((x): x is string => !!x));
            return next.map((a) => {
              if (a.id !== task.assetId) return a;
              const updated: WorkflowAsset = {
                ...a,
                cutImageGroup,
                groupKind: 'cut',
                groupLabel: getRandomGroupCodeName(usedLabels),
                resultOrder: nextOrder,
                resultMeta: nextMeta,
                displayKey: 'cut_image',
                hiddenInGrid: a.parentAssetId ? a.hiddenInGrid : false,
              };
              return cropped.length > 0
                ? applyVgpAfterCutStep(updated, {
                    stepKey: task.actionType,
                    inputSourceDisplayKey: task.inputSourceDisplayKey,
                  })
                : updated;
            });
          });
          if (task.sourceGroupAssetId != null && task.sourceItemIndex != null) {
            replaceGroupItemWithSubAsset(
              task.sourceGroupAssetId,
              task.sourceItemIndex,
              task.assetId
            );
          }
            onLog?.('info', `${logBatch} ${taskLabel} 完成（${cropped.length} 张入组）`);
            setCompletedTaskIds((prev) => {
              const next = new Set(prev);
              next.add(task.id);
              return next;
            });
            return;
          }

          onLog?.('info', `${logBatch} ${taskLabel} 执行中…`);
          const { image: result, text: textResult, vgpSteps } = await runTask(task, batchGroup);
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
                hiddenInGrid: a.parentAssetId ? a.hiddenInGrid : false,
              };
              return next;
            })
          );
        } else {
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
              hiddenInGrid: a.parentAssetId ? a.hiddenInGrid : false,
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
        }
          setCompletedTaskIds((prev) => {
            const next = new Set(prev);
            next.add(task.id);
            return next;
          });
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
      replaceGroupItemWithSubAsset,
      runTask,
      actionModules,
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
        if (mod?.category === 'generate_3d' && onAddGenerate3DJob) {
          const img = getAssetDisplayImage(targetAsset);
          if (img) onAddGenerate3DJob(mod, img);
          else onLog?.('warn', '无法读取图片，无法提交生成 3D');
          return;
        }
        if (mod && !isWorkflowTextAsset(targetAsset) && !workflowAssetAllowedForCapabilityDrop(targetAsset, mod)) {
          onLog?.('warn', '该能力与当前资产类型不匹配');
          return;
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
      onAddGenerate3DJob,
      onLog,
      setPending,
    ]
  );

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
            parentAssetId: task.assetId,
          })
        );
        const cutImageGroup = newAssets.map((x) => ({ assetId: x.id }));
        const nextOrder = [...(taskAsset.resultOrder || []), task.actionType];
        const nextMeta = { ...(taskAsset.resultMeta || {}), [task.actionType]: { executedAt: Date.now() } };
        const next = [...prev, ...newAssets];
        return next.map((a) => {
          if (a.id !== task.assetId) return a;
          const updated: WorkflowAsset = {
            ...a,
            cutImageGroup,
            resultOrder: nextOrder,
            resultMeta: nextMeta,
            displayKey: 'cut_image',
            hiddenInGrid: false,
          };
          return applyVgpAfterCutStep(updated, {
            stepKey: task.actionType,
            inputSourceDisplayKey: task.inputSourceDisplayKey,
          });
        });
      });
      if (task.sourceGroupAssetId != null && task.sourceItemIndex != null) {
        replaceGroupItemWithSubAsset(task.sourceGroupAssetId, task.sourceItemIndex, task.assetId);
      }
      setCutSelectState(null);
      if (remaining.length > 0) executePending(remaining);
      else setExecuting(false);
    },
    [cutSelectState, setAssets, setPending, executePending, replaceGroupItemWithSubAsset, actionModules]
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
            const groupCtx =
              viewStack.length > 0
                ? prev.find((a) => a.id === viewStack[viewStack.length - 1].assetId)
                : null;
            const newAsset: WorkflowAsset = attachInitialVgpToNewAsset({
              id: newId,
              original: base64,
              displayKey: 'original',
              results: {},
              resultOrder: [],
              archived: false,
              hiddenInGrid: false,
              createdAt: batchBase + (n - 1 - fileIdx),
              ...(groupCtx ? { parentAssetId: groupCtx.id } : {}),
            });
            if (!groupCtx) {
              return [...prev, newAsset];
            }
            return prev
              .map((a) => {
                if (a.id === groupCtx.id) {
                  const items = [...(a.cutImageGroup ?? [])];
                  items.push({ assetId: newId });
                  return { ...a, cutImageGroup: items };
                }
                return a;
              })
              .concat(newAsset);
          });
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
  }, [viewStack, setAssets]);

  const handleBatchUploadCorrect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    addImagesFromFiles(Array.from(files));
    e.target.value = '';
  };

  const hasImageFileTransfer = useCallback((dt?: DataTransfer | null) => {
    if (!dt) return false;
    if (dt.files?.length) {
      for (let i = 0; i < dt.files.length; i += 1) {
        if (dt.files[i].type?.startsWith('image/')) return true;
      }
    }
    if (dt.items?.length) {
      for (let i = 0; i < dt.items.length; i += 1) {
        if (dt.items[i].kind === 'file' && dt.items[i].type?.startsWith('image/')) return true;
      }
    }
    const types = dt.types ? Array.from(dt.types) : [];
    if (types.includes('text/uri-list') || types.includes('text/html')) return true;
    return false;
  }, []);
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
      if (!hasImageFileTransfer(e.dataTransfer)) return;
      e.preventDefault();
    };

    const onWindowDrop = (e: DragEvent) => {
      if (showArchived) return;
      if (isGlobalUploadBlockedTarget(e.target)) return;
      const dt = e.dataTransfer;
      if (!hasImageFileTransfer(dt)) return;
      e.preventDefault();
      const files = Array.from(dt?.files || []).filter((f) => f.type?.startsWith('image/'));
      if (files.length) {
        addImagesFromFiles(files);
        return;
      }
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
  }, [addImagesFromFiles, collectImageLikeUrlsFromDataTransfer, fetchImageFilesFromUrls, hasImageFileTransfer, isGlobalUploadBlockedTarget, showArchived]);

  const visibleAssets = useMemo(() => {
    // 仅展示“根资产”：归档状态匹配，且不是子资产（没有 parentAssetId）；新导入在前（createdAt 降序）
    const list = assets.filter(
      (a) => !a.archived && (!a.hiddenInGrid || a.archived) && !a.parentAssetId && !a.inRepository
    );
    return sortRootWorkflowAssetsNewestFirst(list);
  }, [assets]);
  const rootCanvasAssets = useMemo(() => {
    if (!showAllInGroup) return visibleAssets;
    return [...assets]
      .filter((a) => {
        if (a.archived || a.inRepository) return false;
        // 显示全部：隐藏“组容器”本体，仅展示可见叶子资产（含组内子资产）
        if (a.cutImageGroup?.length) return false;
        if (a.parentAssetId) return true;
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
      const label = isWorkflowTextAsset(a)
        ? workflowTextAssetOutlineLabel(a)
        : a.groupLabel ||
          (a.cutImageGroup?.length ? (a.groupKind === 'manual' ? '组' : '切割') : null) ||
          `图片 ${a.id.slice(0, 8)}`;
      const items = a.cutImageGroup ?? [];
      const hasChildren = items.length > 0;
      const expanded = !hasChildren || !outlineCollapsedIds.has(a.id);
      const isSel =
        parent != null && indexInParent != null
          ? selectedGroupItemKeys.has(`${parent.id}::${indexInParent}`)
          : selectedAssetIds.has(a.id) && viewStack.length === 0;

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
              isSel ? 'border-blue-500 bg-[#152642] text-blue-200' : 'border-white/[0.06] bg-[#141416] text-gray-300 hover:bg-[#1c1c22]'
            }`}
          >
            {a.archived ? <span className="text-gray-500 mr-1">已归</span> : null}
            {label}
            {hasChildren ? (
              <span className="text-gray-500 ml-1 tabular-nums font-mono text-[8px]">({items.length})</span>
            ) : null}
          </button>
        </div>
      );

      if (!hasChildren || !expanded) return;

      items.forEach((item, idx) => {
        const isRef = item && typeof item === 'object' && 'assetId' in item;
        const childId = isRef ? (item as { assetId: string }).assetId : '';
        if (typeof item === 'string' || (item && typeof item === 'object' && 'r2Key' in item && !isRef)) {
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
                  sel ? 'border-blue-500 bg-[#152642] text-blue-200' : 'border-white/[0.06] bg-[#141416] text-gray-300 hover:bg-[#1c1c22]'
                }`}
              >
                <span className="text-gray-500 mr-1">图</span>子项 {idx + 1}
              </button>
            </div>
          );
          return;
        }
        if (isRef && childId) {
          const child = assets.find((x) => x.id === childId);
          if (child) {
            visit(child, depth + 1, a, idx, visited);
          } else {
            rows.push(
              <div
                key={`ol-miss-${a.id}-${idx}`}
                className="text-[8px] text-amber-600/90 pl-2 py-0.5"
                style={{ paddingLeft: (depth + 1) * 10 + 20 }}
              >
                引用缺失 #{idx + 1}
              </div>
            );
          }
        }
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
    viewStack.length,
    navigateOutlineToAsset,
    navigateOutlineToGroupItem,
    toggleOutlineGroupCollapsed,
  ]);

  /** 第 0 页大纲列：仓库条目（与左侧网格多选同步），非工作区资产树 */
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
                if (item.cutImageGroup?.length && !isWorkflowTextAsset(item)) {
                  setViewStack([{ assetId: item.id }]);
                  return;
                }
                setLightboxSourceSlot(null);
                setLightboxAssetId(item.id);
              }}
              className="flex-1 min-w-0 text-left rounded-lg px-2 py-1.5 text-[9px] border transition-colors truncate border-white/[0.06] bg-[#141416] text-gray-300 hover:bg-[#1c1c22]"
            >
              {label}
            </button>
          </div>
        );
      }),
    [repositoryVisibleItems, setLightboxAssetId, setLightboxSourceSlot, setViewStack]
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
                : 'border-white/[0.06] bg-[#141416] text-gray-300 hover:bg-[#1c1c22]'
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
    window.addEventListener('ac:capability-preset-view-mode-changed', onModeChanged as EventListener);
    return () => {
      window.removeEventListener('ac:capability-preset-view-mode-changed', onModeChanged as EventListener);
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
  }, [lightboxAsset, assets]);
  const goLightbox = (delta: number) => {
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
  }, [lightboxAssetId]);

  const setDisplayKey = (assetId: string, key: string) => {
    setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, displayKey: key } : a)));
  };

  const getDisplayKeysForAsset = (a: WorkflowAsset): string[] => {
    const keys: string[] = ['original'];
    if (isWorkflowTextAsset(a)) {
      (a.resultOrder || []).forEach((k) => {
        if ((a.textResults || {})[k] || asWorkflowImageString(a.results?.[k]).trim()) keys.push(k);
      });
      return keys;
    }
    if (a.cutImageGroup?.length && a.groupKind !== 'manual') keys.push('cut_image');
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
            parentAssetId: parentGroupId ?? undefined,
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
            const items = [...(g.cutImageGroup ?? []), ...newIds.map((id) => ({ assetId: id }))];
            next = next.map((a, i) => (i === gi ? { ...a, cutImageGroup: items } : a));
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
    const baseId = baseActionId(actionType);
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== assetId) return a;
        const nextResults = { ...a.results };
        delete nextResults[actionType];
        const nextTextResults = { ...(a.textResults || {}) };
        delete nextTextResults[actionType];
        const nextOrder = (a.resultOrder || []).filter((k) => k !== actionType);
        const nextMeta = { ...a.resultMeta };
        delete nextMeta[actionType];
        const displayKey = a.displayKey === actionType ? 'original' : a.displayKey;
        const cutImageGroup = baseId === 'cut_image' ? undefined : a.cutImageGroup;
        return {
          ...a,
          results: nextResults,
          textResults: nextTextResults,
          resultOrder: nextOrder,
          resultMeta: nextMeta,
          displayKey,
          cutImageGroup,
        };
      })
    );
  };

  const markArchived = (assetId: string) => {
    const snapshot = assets.find((a) => a.id === assetId) || null;
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id === assetId) {
          return { ...a, archived: true, inRepository: true, hiddenInGrid: false, parentAssetId: undefined };
        }
        if (a.cutImageGroup?.length) {
          const filtered = a.cutImageGroup.filter(
            (item) => !(typeof item === 'object' && item && 'assetId' in item && item.assetId === assetId)
          );
          if (filtered.length !== a.cutImageGroup.length) {
            return { ...a, cutImageGroup: filtered.length ? filtered : undefined };
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
    setAssets((prev) => prev.filter((a) => a.id !== assetId));
    setPending((prev) => prev.filter((t) => t.assetId !== assetId));
    if (lightboxAssetId === assetId) setLightboxAssetId(null);
    if (archivedDetailAssetId === assetId) setArchivedDetailAssetId(null);
    setViewStack((s) => s.filter((x) => x.assetId !== assetId));
  }, [lightboxAssetId, archivedDetailAssetId]);

  const archivedDetailAsset = archivedDetailAssetId ? assets.find((a) => a.id === archivedDetailAssetId) : null;

  const currentGroupAsset = viewStack.length > 0 ? assets.find((a) => a.id === viewStack[viewStack.length - 1].assetId) : null;
  const currentGroupItems = currentGroupAsset?.cutImageGroup ?? [];
  /** 组内拖到功能区/队列时以 drag state 中的组 id 为准，避免 viewStack 与拖拽源短暂不一致导致无法入队 */
  const groupAssetForDrag = useMemo(
    () =>
      draggingGroupItems
        ? assets.find((a) => a.id === draggingGroupItems.groupAssetId) ?? null
        : null,
    [draggingGroupItems, assets]
  );
  const dragGroupCutItems = groupAssetForDrag?.cutImageGroup ?? [];

  const flattenGroupImages = useCallback(
    (asset: WorkflowAsset, visited: Set<string> = new Set()): string[] => {
      if (visited.has(asset.id)) return [];
      visited.add(asset.id);
      const out: string[] = [];
      for (const item of asset.cutImageGroup ?? []) {
        if (typeof item === 'string') out.push(item);
        else if (item && typeof item === 'object' && 'r2Key' in item) continue;
        else if (item && typeof item === 'object' && 'assetId' in item) {
          const child = assets.find((x) => x.id === item.assetId);
          if (child?.cutImageGroup?.length) out.push(...flattenGroupImages(child, visited));
          else if (child) out.push(getAssetDisplayImage(child));
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
    if (viewStack.length === 0) {
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
        const capU = Math.min(currentGroupItems.length, seedUnlockGroup);
        const capH = Math.min(currentGroupItems.length, seedHotGroup);
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
    viewStack.length,
    currentGroupAsset,
    columnCount,
    showAllImages,
    currentGroupItems.length,
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
    viewStack.length,
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
    viewStack.length,
    currentGroupAsset?.id,
    currentGroupItems.length,
    columnCount,
    showAllImages?.length,
    showArchived,
    showAllInGroup,
  ]);

  const groupBreadcrumb = useMemo(() => {
    if (viewStack.length === 0) return [];
    return viewStack
      .map((item) => assets.find((a) => a.id === item.assetId))
      .filter((a): a is WorkflowAsset => !!a)
      .map((a, idx) => ({
        id: a.id,
        label: a.groupLabel ?? (a.groupKind === 'manual' ? `组 ${idx + 1}` : `切割 ${idx + 1}`),
      }));
  }, [viewStack, assets]);

  /** 将组内项解析为资产 id 列表：引用项直接取 assetId；base64 项先创建子资产并更新组，再返回新 id */
  const ensureGroupItemsAsAssets = useCallback(
    (prev: WorkflowAsset[], groupAssetId: string, itemIndexes: number[]): { nextAssets: WorkflowAsset[]; assetIds: string[] } => {
      const group = prev.find((a) => a.id === groupAssetId);
      if (!group?.cutImageGroup?.length) return { nextAssets: prev, assetIds: [] };
      const assetIds: string[] = [];
      const updates: { index: number; assetId: string }[] = [];
      const newAssets: WorkflowAsset[] = [];
      for (const idx of itemIndexes) {
        if (idx < 0 || idx >= group.cutImageGroup!.length) continue;
        const item = group.cutImageGroup![idx];
        if (typeof item === 'object' && item && 'assetId' in item) {
          assetIds.push((item as { assetId: string }).assetId);
        } else if (typeof item === 'string') {
          const newId = uuid();
          newAssets.push({
            id: newId,
            original: item,
            displayKey: 'original',
            results: {},
            resultOrder: [],
            archived: false,
            hiddenInGrid: false,
            createdAt: Date.now(),
            parentAssetId: groupAssetId,
          });
          assetIds.push(newId);
          updates.push({ index: idx, assetId: newId });
        }
      }
      if (assetIds.length === 0) return { nextAssets: prev, assetIds: [] };
      let nextAssets: WorkflowAsset[] = [...prev, ...newAssets];
      const groupIdx = nextAssets.findIndex((a) => a.id === groupAssetId);
      if (groupIdx === -1) return { nextAssets: prev, assetIds: [] };
      if (updates.length > 0) {
        const g = nextAssets[groupIdx];
        const newGroupItems = [...(g.cutImageGroup ?? [])];
        for (const { index, assetId } of updates) {
          newGroupItems[index] = { assetId };
        }
        nextAssets = nextAssets.map((a, i) => (i === groupIdx ? { ...a, cutImageGroup: newGroupItems } : a));
      }
      return { nextAssets, assetIds };
    },
    []
  );

  /** 从组中移除指定下标的格；若组变空则移除组并清理父组引用。返回新 assets。 */
  const removeGroupItems = useCallback(
    (prev: WorkflowAsset[], groupAssetId: string, itemIndexes: number[]): WorkflowAsset[] => {
      const groupIdx = prev.findIndex((a) => a.id === groupAssetId);
      if (groupIdx === -1 || !prev[groupIdx].cutImageGroup?.length) return prev;
      const group = prev[groupIdx];
      const sorted = [...itemIndexes].filter((i) => i >= 0 && i < group.cutImageGroup!.length).sort((a, b) => b - a);
      if (sorted.length === 0) return prev;
      const nextGroupItems = [...group.cutImageGroup!];
      for (const i of sorted) nextGroupItems.splice(i, 1);
      let next = prev.map((a, i) =>
        i === groupIdx ? { ...a, cutImageGroup: nextGroupItems.length ? nextGroupItems : undefined } : a
      );
      if (nextGroupItems.length === 0) {
        next = next.filter((a) => a.id !== groupAssetId);
        if (group.parentAssetId) {
          const parentIdx = next.findIndex((a) => a.id === group.parentAssetId);
          if (parentIdx !== -1) {
            const parent = next[parentIdx];
            const filtered = (parent.cutImageGroup ?? []).filter(
              (x) => typeof x !== 'object' || (x as { assetId: string }).assetId !== groupAssetId
            );
            next = next.map((a, i) =>
              i === parentIdx ? { ...a, cutImageGroup: filtered.length ? filtered : undefined } : a
            );
          }
        }
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
          if (groupIdx >= 0 && Array.isArray(next[groupIdx].cutImageGroup)) {
            const group = next[groupIdx];
            const cut = [...(group.cutImageGroup || [])];
            if (opts!.sourceItemIndex! >= 0 && opts!.sourceItemIndex! < cut.length) {
              cut[opts!.sourceItemIndex!] = { assetId: newAsset.id };
              next[groupIdx] = { ...group, cutImageGroup: cut };
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
    },
    [setAssets, setPending, onLog]
  );

  /** 在给定 `prev` 上插入手动组（供「建组」与组内拖入非组卡一次 setAssets 复用） */
  const insertManualGroupForAssetIds = useCallback((
    prev: WorkflowAsset[],
    assetIds: string[],
    opts?: { allowTextAssets?: boolean }
  ): WorkflowAsset[] => {
    const allowTextAssets = opts?.allowTextAssets === true;
    const ids = [...new Set(assetIds)].filter((id) => {
      const x = prev.find((a) => a.id === id);
      if (!x) return false;
      if (!allowTextAssets && isWorkflowTextAsset(x)) return false;
      return true;
    });
    if (ids.length < 2) return prev;
    const first = prev.find((x) => x.id === ids[0]);
    const coverImage = first ? getAssetDisplayImage(first, prev) : '';
    const groupId = uuid();
    const usedLabels = new Set<string>(prev.map((x) => x.groupLabel).filter((x): x is string => !!x));
    const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
      id: groupId,
      original: coverImage,
      displayKey: 'original',
      results: {},
      resultOrder: [],
      cutImageGroup: ids.map((id) => ({ assetId: id })),
      groupKind: 'manual',
      groupLabel: getRandomGroupCodeName(usedLabels),
      archived: false,
      hiddenInGrid: false,
      createdAt: Date.now(),
    });
    const mapped = prev.map((x) => {
      if (x.id === groupId) return x;
      if (ids.includes(x.id)) return { ...x, parentAssetId: groupId };
      if (x.cutImageGroup?.length) {
        const filtered = x.cutImageGroup.filter(
          (it) => !(typeof it === 'object' && it && 'assetId' in it && ids.includes((it as { assetId: string }).assetId))
        );
        if (filtered.length !== x.cutImageGroup.length) return { ...x, cutImageGroup: filtered.length ? filtered : undefined };
      }
      return x;
    });
    const insertIndex = prev.findIndex((x) => !x.parentAssetId && ids.includes(x.id));
    const idx = insertIndex >= 0 ? insertIndex : prev.length;
    return [...mapped.slice(0, idx), newGroup, ...mapped.slice(idx)];
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
        if (!source || source.parentAssetId || (!opts?.allowTextAssetsForExpansion && isWorkflowTextAsset(source))) {
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
          next.push({
            ...src,
            id: plan.cloneId,
            parentAssetId: undefined,
            archived: false,
            hiddenInGrid: false,
            createdAt: Date.now(),
          });
        }
        for (const ids of groupPlans) {
          next = insertManualGroupForAssetIds(next, ids, {
            allowTextAssets: opts?.allowTextAssetsForGrouping === true,
          });
        }
        return next;
      });
      return { rootIds, cloneTaskSeeds };
    },
    [assets, setAssets, insertManualGroupForAssetIds]
  );

  /** 将已存在的子资产 id 并入某张根级组卡（与根网格 onDrop 并入组同构） */
  const mergeAssetIdsIntoGroupCardAssets = useCallback(
    (prev: WorkflowAsset[], targetGroupAssetId: string, movingAssetIds: string[]): WorkflowAsset[] => {
      const moving = movingAssetIds.filter((id) => {
        const x = prev.find((a) => a.id === id);
        return x && !isWorkflowTextAsset(x);
      });
      if (moving.length === 0) return prev;
      return prev.map((asset) => {
        if (asset.id === targetGroupAssetId) {
          const groupItems = [...(asset.cutImageGroup ?? [])];
          moving.forEach((id) => groupItems.push({ assetId: id }));
          return { ...asset, cutImageGroup: groupItems };
        }
        if (moving.includes(asset.id)) {
          return { ...asset, parentAssetId: targetGroupAssetId };
        }
        if (asset.cutImageGroup?.length) {
          const filtered = asset.cutImageGroup.filter(
            (x) =>
              !(typeof x === 'object' && x && 'assetId' in x && moving.includes((x as { assetId: string }).assetId))
          );
          if (filtered.length !== asset.cutImageGroup.length) {
            return { ...asset, cutImageGroup: filtered.length ? filtered : undefined };
          }
        }
        return asset;
      });
    },
    []
  );

  const createGroupFromAssets = useCallback(
    (assetIds: string[]) => {
      if (!assetIds.length) return;
      setAssets((prev) => insertManualGroupForAssetIds(prev, assetIds));
      setSelectedAssetIds(new Set());
    },
    [insertManualGroupForAssetIds, setAssets, setSelectedAssetIds]
  );

  const createNestedGroupFromGroupItem = useCallback(
    (groupAssetId: string, itemIndex: number) => {
      setAssets((prev) => {
        const group = prev.find((a) => a.id === groupAssetId);
        if (!group?.cutImageGroup || itemIndex < 0 || itemIndex >= group.cutImageGroup.length) return prev;
        const item = group.cutImageGroup[itemIndex];
        if (!item || typeof item !== 'object' || !('assetId' in item)) return prev;
        const childId = (item as { assetId: string }).assetId;
        const child = prev.find((a) => a.id === childId);
        const coverImage = child ? getAssetDisplayImage(child) : '';
        const newGroupId = uuid();
        const usedLabels = new Set<string>(prev.map((a) => a.groupLabel).filter((x): x is string => !!x));
        const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
          id: newGroupId,
          original: coverImage,
          displayKey: 'original',
          results: {},
          resultOrder: [],
          cutImageGroup: [{ assetId: childId }],
          groupKind: 'manual',
          groupLabel: getRandomGroupCodeName(usedLabels),
          archived: false,
          hiddenInGrid: false,
          createdAt: Date.now(),
          parentAssetId: groupAssetId,
        });
        return prev
          .map((a) => {
            if (a.id === groupAssetId && a.cutImageGroup) {
              const nextGroupItems = [...a.cutImageGroup];
              nextGroupItems[itemIndex] = { assetId: newGroupId };
              return { ...a, cutImageGroup: nextGroupItems };
            }
            if (a.id === childId) {
              return { ...a, parentAssetId: newGroupId };
            }
            return a;
          })
          .concat(newGroup);
      });
    },
    [getAssetDisplayImage, setAssets]
  );

  const getEffectiveAssetIdsForAction = useCallback(
    (ids: string[]): string[] => {
      const out = new Set<string>();
      ids.forEach((id) => {
        const asset = assets.find((a) => a.id === id);
        if (!asset) return;
        if (
          asset.cutImageGroup &&
          asset.cutImageGroup.length > 0 &&
          asset.cutImageGroup.every((item) => typeof item === 'object' && item && 'assetId' in item)
        ) {
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
  const favoriteActionSet = useMemo(() => new Set(favoriteActionIds), [favoriteActionIds]);
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

      if (tweakPrompt) {
        const targets: Array<
          | {
              assetId: string;
              inputImage: string;
              inputSourceDisplayKey?: string;
              sourceGroupAssetId?: string;
              sourceItemIndex?: number;
            }
          | { imageBase64: string; parentAssetId: string; sourceGroupAssetId: string; sourceItemIndex: number }
        > = [];
        for (const source of sources) {
          if (source.kind === 'root') {
            const effectiveIds = getEffectiveAssetIdsForAction(source.assetIds).filter((id) => {
              const x = assets.find((a) => a.id === id);
              return x != null && workflowAssetAllowedForCapabilityDrop(x, mod);
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
            const cut = group?.cutImageGroup;
            if (!group || !cut?.length) continue;
            const groupId = group.id;
            for (const itemIndex of source.itemIndexes) {
              const item = cut[itemIndex];
              if (!item) continue;
              if (typeof item === 'string') {
                targets.push({
                  imageBase64: item,
                  parentAssetId: groupId,
                  sourceGroupAssetId: groupId,
                  sourceItemIndex: itemIndex,
                });
              } else if (item && typeof item === 'object' && 'assetId' in item) {
                const child = assets.find((x) => x.id === (item as { assetId: string }).assetId);
                if (child && workflowAssetAllowedForCapabilityDrop(child, mod)) {
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
        if (targets.length > 0) setPromptTweakModal({ preset: mod, targets, overrides: groupOverrides });
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
            return x != null && workflowAssetAllowedForCapabilityDrop(x, mod);
          });
          if (mod.category === 'generate_3d' && onAddGenerate3DJob) {
            const firstId = effectiveIds[0];
            const a = firstId ? assets.find((x) => x.id === firstId) : null;
            const img = a ? getAssetDisplayImage(a) : null;
            if (img) onAddGenerate3DJob(mod, img);
            continue;
          }
          const { rootIds, cloneTaskSeeds } =
            generateCount > 1
              ? expandRootAssetsForGenerateCount(effectiveIds, generateCount, {
                  allowTextAssetsForExpansion: mod.category === 'text_to_text',
                  allowTextAssetsForGrouping: mod.category === 'text_to_text',
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
        const cut = groupAssetForSrc?.cutImageGroup;
        if (!groupAssetForSrc || !cut?.length) continue;
        const groupId = groupAssetForSrc.id;
        if (mod.category === 'generate_3d' && onAddGenerate3DJob) {
          const firstIndex = source.itemIndexes[0];
          const item = firstIndex !== undefined ? cut[firstIndex] : undefined;
          let img: string | null = null;
          if (typeof item === 'string') img = item;
          else if (item && typeof item === 'object' && 'assetId' in item) {
            const child = assets.find((x) => x.id === item.assetId);
            if (child) img = getAssetDisplayImage(child);
          }
          if (img) onAddGenerate3DJob(mod, img);
          continue;
        }
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
      onAddGenerate3DJob,
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
  }, [lightboxAsset, selectedAssetIds, assets]);

  const composerAssetCandidates = useMemo<CapabilityAssetCandidate[]>(() => {
    const out: CapabilityAssetCandidate[] = [];
    for (const a of assets) {
      if (isWorkflowTextAsset(a)) continue;
      const img = getAssetDisplayImage(a).trim();
      if (!img) continue;
      out.push({
        id: a.id,
        label: a.groupLabel?.trim() || `资产 ${a.id.slice(0, 6)}`,
        scope: a.inRepository ? 'repository' : 'workspace',
        image: img,
      });
    }
    return out.sort((x, y) => x.label.localeCompare(y.label, 'zh-CN'));
  }, [assets, getAssetDisplayImage]);

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
        const cut = groupAssetForSrc?.cutImageGroup;
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

  function importLibraryItemsIntoWorkflow(items: Array<WorkflowAsset | LibraryItem>) {
    const workflowIds = new Set<string>();
    const externalImages: string[] = [];
    items.forEach((item) => {
      if (!item) return;
      if ('inRepository' in item) {
        if (item.id) workflowIds.add(item.id);
        return;
      }
      if (item.data) externalImages.push(item.data);
    });
    if (workflowIds.size === 0 && externalImages.length === 0) return;
    setAssets((prev) => {
      let next = [...prev];
      if (workflowIds.size > 0) {
        const sourceAssets = prev.filter((a) => workflowIds.has(a.id));
        const clonedFromRepo: WorkflowAsset[] = sourceAssets.map((a, idx) => ({
          ...a,
          id: uuid(),
          parentAssetId: undefined,
          inRepository: false,
          archived: false,
          hiddenInGrid: false,
          createdAt: Date.now() + idx,
        }));
        next = next.concat(clonedFromRepo);
      }
      if (externalImages.length > 0) {
        const baseT = Date.now();
        const n = externalImages.length;
        const created: WorkflowAsset[] = externalImages.map((src, idx) => ({
          id: uuid(),
          original: src,
          displayKey: 'original',
          results: {},
          resultOrder: [],
          archived: false,
          hiddenInGrid: false,
          inRepository: false,
          createdAt: baseT + (n - 1 - idx),
        }));
        next = next.concat(created);
      }
      return next;
    });
    setWorkspacePane(2);
  }

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
        <div className="flex items-center gap-2 whitespace-nowrap flex-wrap">
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
      desc: '窄栏与功能区同宽；右侧为完整工作区',
      actions: (
        <div className="flex items-center gap-2 whitespace-nowrap flex-wrap">
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
            <div className="flex flex-wrap items-center gap-2 justify-end min-w-0">
              <span className="text-[9px] font-black text-gray-500 uppercase shrink-0">筛选</span>
              <input
                value={libraryTagQuery}
                onChange={(e) => setLibraryTagQuery(e.target.value)}
                placeholder="标签检索：style:anime lighting:neon"
                className="h-8 min-w-[12rem] max-w-[20rem] bg-[#1c1c22] border border-[#2e2e32] rounded-lg px-2 text-[9px] text-gray-200 outline-none focus:border-blue-500"
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
              <div className="h-8 inline-flex items-center rounded-lg border border-[#2e2e32] bg-[#1c1c22] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setColumnCount((n) => Math.max(2, n - 1))}
                  disabled={columnCount <= 2}
                  className="w-8 h-8 text-[11px] font-black text-gray-300 hover:bg-[#2e2e36] disabled:opacity-35 disabled:hover:bg-transparent"
                  aria-label="减少列数"
                >
                  −
                </button>
                <span className="w-9 h-8 inline-flex items-center justify-center text-[9px] font-black text-blue-300 border-x border-[#2e2e32]">
                  {columnCount}
                </span>
                <button
                  type="button"
                  onClick={() => setColumnCount((n) => Math.min(6, n + 1))}
                  disabled={columnCount >= 6}
                  className="w-8 h-8 text-[11px] font-black text-gray-300 hover:bg-[#2e2e36] disabled:opacity-35 disabled:hover:bg-transparent"
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
        (a) => !pending.some((t) => t.assetId === a.id)
      ).length;
      const allSelectableIds = new Set(
        visibleAssets
          .filter((a) => !pending.some((t) => t.assetId === a.id))
          .map((a) => a.id)
      );
      const allSelected = selectedAssetIds.size === selectableCount && selectableCount > 0;
      const inGroupView = !!currentGroupAsset;
      const groupSelectableKeys =
        currentGroupAsset && !showAllInGroup
          ? currentGroupItems
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
              <div className="flex items-center gap-2 whitespace-nowrap">
                {!showArchived && (
                  <button
                    type="button"
                    onClick={() => addWorkflowTextAsset()}
                    className="h-8 px-3 rounded-lg border border-emerald-800/50 bg-emerald-950/40 text-[9px] font-black uppercase text-emerald-200 hover:bg-emerald-900/35"
                  >
                    添加文字
                  </button>
                )}
                <label className={`${TITLE_ROW_BTN_NEUTRAL} cursor-pointer`}>
                  导入图片
                  <input type="file" className="hidden" accept="image/*" multiple onChange={handleBatchUploadCorrect} />
                </label>
                {onOpenLibraryPicker && (
                  <button
                    type="button"
                    onClick={() => onOpenLibraryPicker((items) => importLibraryItemsIntoWorkflow(items))}
                    className={TITLE_ROW_BTN_NEUTRAL}
                  >
                    从仓库导入
                  </button>
                )}
                <div className="h-8 inline-flex items-center rounded-lg border border-[#2e2e32] bg-[#1c1c22] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setColumnCount((n) => Math.max(2, n - 1))}
                    disabled={columnCount <= 2}
                    className="w-8 h-8 text-[11px] font-black text-gray-300 hover:bg-[#2e2e36] disabled:opacity-35 disabled:hover:bg-transparent"
                    aria-label="减少列数"
                  >
                    −
                  </button>
                  <span className="w-9 h-8 inline-flex items-center justify-center text-[9px] font-black text-blue-300 border-x border-[#2e2e32]">
                    {columnCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setColumnCount((n) => Math.min(6, n + 1))}
                    disabled={columnCount >= 6}
                    className="w-8 h-8 text-[11px] font-black text-gray-300 hover:bg-[#2e2e36] disabled:opacity-35 disabled:hover:bg-transparent"
                    aria-label="增加列数"
                  >
                    +
                  </button>
                </div>
              </div>
              {archiveHint && !showArchived && (
                <div className="h-8 flex items-center gap-2 px-3 rounded-lg bg-[#152642] border border-[#3b6fb8] text-[9px] text-blue-200">
                  <span className="font-black uppercase">已归档</span>
                  <span className="text-gray-300">已移入资产仓库</span>
                </div>
              )}
              {!showArchived && (inGroupView || visibleAssets.length > 0) && (
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => {
                      if (!inGroupView) setViewStack([]);
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
                      setSelectedAssetIds((prev) =>
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
            <div className="flex items-center gap-2 whitespace-nowrap">
              <button
                type="button"
                onClick={() => executePending()}
                disabled={pending.length === 0 || executing}
                className={`${TITLE_ROW_BTN_BASE} bg-blue-600 hover:bg-blue-500 border-[#60a5fa] text-white disabled:opacity-40 disabled:hover:bg-blue-600`}
              >
                {executing
                  ? `执行中 ${executingQueueDoneCount}/${executingQueue?.total ?? 0}`
                  : `一键执行（${pending.length}）`}
              </button>
              {(pending.length > 0 || executingQueue) && (
                <div className="h-8 flex items-center gap-2 px-3 rounded-lg bg-[#1c1c22] border border-[#2e2e32]">
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
      if (activePaneNode === 1) return [outlineWorkflowTopBarColumn, workspaceAndFunctionCols[0]!];
      return workspaceAndFunctionCols;
    }
    return [
      {
        title: '功能区',
        desc: '基础能力与复合能力',
        actions: (
          <div className="flex items-center gap-2 whitespace-nowrap">
            <button
              type="button"
              onClick={() => executePending()}
              disabled={pending.length === 0 || executing}
              className={`${TITLE_ROW_BTN_BASE} bg-blue-600 hover:bg-blue-500 border-[#60a5fa] text-white disabled:opacity-40 disabled:hover:bg-blue-600`}
            >
              {executing
                ? `执行中 ${executingQueueDoneCount}/${executingQueue?.total ?? 0}`
                : `一键执行（${pending.length}）`}
            </button>
            {(pending.length > 0 || executingQueue) && (
              <div className="h-8 flex items-center gap-2 px-3 rounded-lg bg-[#1c1c22] border border-[#2e2e32]">
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
        title: capabilityPresetViewMode === 'sets' ? '能力集合' : capabilityPresetViewMode === 'image_process' ? '图像处理' : '基础能力',
        desc: '当前能力配置与预设编辑',
        actions: (
          <div className="flex items-center gap-2 whitespace-nowrap">
            <div className="h-8 inline-flex items-center rounded-lg border border-[#2e2e32] bg-[#1c1c22] overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setCapabilityPresetViewMode('presets');
                  if (typeof window === 'undefined') return;
                  window.dispatchEvent(new CustomEvent('ac:capability-preset-view-mode', { detail: { mode: 'presets' } }));
                }}
                className={`h-8 px-3 text-[9px] font-black uppercase ${
                  capabilityPresetViewMode === 'presets'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-[#2e2e36]'
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
                className={`h-8 px-3 text-[9px] font-black uppercase border-l border-[#2e2e32] ${
                  capabilityPresetViewMode === 'image_process'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-[#2e2e36]'
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
                className={`h-8 px-3 text-[9px] font-black uppercase border-l border-[#2e2e32] ${
                  capabilityPresetViewMode === 'sets'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-[#2e2e36]'
                }`}
              >
                能力集合
              </button>
            </div>
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
    currentGroupItems,
    selectedAssetIds,
    selectedGroupItemKeys,
    showAllInGroup,
    setArchiveHint,
    setArchivedDetailAssetId,
    setColumnCount,
    setPending,
    setSelectedAssetIds,
    setSelectedGroupItemKeys,
    setViewStack,
    showArchived,
    visibleAssets,
    capabilityPresetViewMode,
    libraryFilter,
    repositoryOutlineMode,
    repositorySelectedTags,
    snapWorkspacePaneToNode,
    outlineCollapsedIds,
    outlineExpandableGroupIds,
    expandOutlineAll,
    collapseOutlineAll,
    repositoryItems,
    repositoryVisibleItems,
  ]);
  const topTitleGridStyle = useMemo(
    () => workflowTopTitleGridStyle(activePaneNode, listPaneWidth, sidebarWidth, presetPaneWidth),
    [activePaneNode, listPaneWidth, sidebarWidth, presetPaneWidth]
  );

  const sidebarOpsAllowed = workflowDragSourceAllowsSidebarOps(
    parseWorkflowDragSource(draggingAssetIds, draggingGroupItems),
    showArchived
  );

  return (
    <div className="flex flex-col min-h-[400px] h-[calc(100dvh-6rem)] gap-4">
      <div className="flex flex-col flex-1 min-h-0 gap-4 min-w-0">
      <div className="flex flex-col items-stretch gap-2 shrink-0 px-0.5">
        <div
          className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-2 shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
          onWheelCapture={handlePaneWheel}
        >
          <div className="flex items-center gap-2 min-h-5 rounded-lg px-2 py-0.5">
            <span className="text-[8px] font-black uppercase text-gray-600/80 w-7 shrink-0 text-right">仓库</span>
            <div className="relative flex-1 min-h-5 flex items-center">
              {/* 圆点必须在滑条之上：原生 range 整块可点区域会盖住下层；pointer-events-none 让操作仍落在 input 上 */}
              <input
                type="range"
                min={0}
                max={3}
                step={0.01}
                value={workspacePane}
                onChange={(e) => setWorkspacePaneRaf(Number(e.target.value))}
                onMouseUp={() => snapWorkspacePaneToNode(workspacePaneRef.current)}
                onTouchEnd={() => snapWorkspacePaneToNode(workspacePaneRef.current)}
                onKeyUp={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
                    snapWorkspacePaneToNode(workspacePaneRef.current);
                  }
                }}
                className="relative z-10 w-full h-1 rounded-full appearance-none cursor-pointer bg-white/[0.05] accent-blue-400/65 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/35
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-1.5 [&::-webkit-slider-thumb]:w-1.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-400/80 [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-white/10 [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(59,130,246,0.08)]
                [&::-moz-range-thumb]:h-1.5 [&::-moz-range-thumb]:w-1.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-400/80 [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-white/10"
                aria-valuemin={0}
                aria-valuemax={3}
                aria-valuenow={workspacePane}
                aria-label="页面：仓库与大纲、大纲与工作区、工作区与功能区、功能区与能力。快捷键 1–4、0 切换"
              />
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center" aria-hidden>
                {(() => {
                  /** 与 [&::-webkit-slider-thumb]:w-1.5 / h-1.5（6px）一致；拇指中心在轨道内为线性内缩，非 0%~100% 贴边 */
                  const thumbPx = 6;
                  const thumbR = thumbPx / 2;
                  /** 当前值与该档距离小于此阈值时隐藏白点，避免叠在蓝拇指上露边 */
                  const hideDotNearThumb = 0.13;
                  return [0, 1, 2, 3].map((i) => {
                    const hiddenByThumb = Math.abs(workspacePane - i) < hideDotNearThumb;
                    return (
                      <span
                        key={i}
                        className={`absolute top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.18] shadow-[0_0_0_1px_rgba(0,0,0,0.35)] transition-opacity duration-150 ${
                          hiddenByThumb ? 'opacity-0' : 'opacity-100'
                        }`}
                        style={{
                          left: `calc(${thumbR}px + (100% - ${thumbPx}px) * ${i / 3})`,
                        }}
                      />
                    );
                  });
                })()}
              </div>
            </div>
            <span className="text-[8px] font-black uppercase text-gray-600/80 w-7 shrink-0">能力</span>
          </div>
          <div
            className={`mt-1 grid gap-2 border-t border-white/[0.06] pt-1.5 ${topTitleColumns.length > 1 ? 'grid-cols-2 divide-x divide-white/[0.05]' : 'grid-cols-1'}`}
            style={topTitleColumns.length > 1 ? topTitleGridStyle : undefined}
          >
            {topTitleColumns.map((item) => (
              <div key={item.title} className={SECTION_HEADER_CLASS}>
                <div className="flex items-center gap-2">
                  <div className={`${SECTION_TITLE_CLASS} shrink-0`}>{item.title}</div>
                  {item.actions ? (
                    <div className="min-w-0 flex-1 flex flex-wrap items-center gap-2 justify-end overflow-x-auto no-scrollbar">
                      {item.actions}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
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
            style={{ width: `${trackTotalWidth}px`, transform: `translate3d(${-workspaceOffsetPx}px, 0, 0)` }}
          >
        <div className="h-full min-h-0 shrink-0 flex flex-col pr-3 border-r border-white/[0.06]" style={{ width: `${listPaneWidth}px` }}>
          <div ref={libraryScrollRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
            {repositoryVisibleItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-gray-600 gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider">暂无资产</span>
                <span className="text-[8px] text-gray-600">对话与其它入口生成的图会进入资产库</span>
              </div>
            ) : (
              <div className="p-6 min-w-0">
                <div className="gap-4 relative" style={{ columnCount, columnFill: 'balance' as const }}>
                  {repositoryVisibleItems.map((item) => (
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
                        className={`group relative rounded-2xl border overflow-hidden bg-[#16161a] transition-colors ${
                          item.cutImageGroup?.length
                            ? 'border-blue-400'
                            : isWorkflowTextAsset(item)
                            ? 'border-emerald-900/45'
                            : 'border-[#2e2e32]'
                        }`}
                        onWheel={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (item.cutImageGroup?.length) {
                            const delta = e.deltaY > 0 ? 1 : -1;
                            setGroupPreviewIndexById((prev) => {
                              const current = prev[item.id] ?? 0;
                              const len = item.cutImageGroup ? item.cutImageGroup.length : 1;
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
                        {item.cutImageGroup?.length && !isWorkflowTextAsset(item) && (
                          <>
                            <div className="absolute inset-0 rounded-2xl bg-[#16161a] border border-[#3b6fb8] translate-x-[16px] translate-y-[16px] -rotate-3 opacity-70 shadow-xl shadow-[#000000] pointer-events-none" />
                            <div className="absolute inset-0 rounded-2xl bg-[#1a1a1e] border border-[#6090d0] translate-x-[8px] translate-y-[8px] rotate-1 opacity-90 shadow-xl shadow-[#000000] pointer-events-none" />
                          </>
                        )}
                        <div
                          className="relative cursor-pointer"
                          role="presentation"
                          onClick={() => {
                            if (item.cutImageGroup?.length && !isWorkflowTextAsset(item)) {
                              setViewStack([{ assetId: item.id }]);
                              return;
                            }
                            setLightboxSourceSlot(null);
                            setLightboxAssetId(item.id);
                          }}
                        >
                          {isWorkflowTextAsset(item) ? (
                            <div
                              className="relative w-full bg-[#0d1110] flex flex-col justify-start p-3 text-left border-t border-emerald-950/25"
                              style={{ aspectRatio: `${3 / 4}`, minHeight: '10rem' }}
                            >
                              <span className="text-[8px] font-black uppercase text-emerald-500/90 mb-1.5">文字</span>
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
                                cacheKey={`repo:${item.id}:${item.displayKey}`}
                                className="relative z-0 block w-full h-full min-h-[5rem]"
                                imgClassName="relative z-0 block w-full h-full object-contain"
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
                          {isWorkflowTextAsset(item) ? (
                            <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-emerald-900/85 text-emerald-100">
                              文字
                            </span>
                          ) : item.cutImageGroup?.length ? (
                            <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-[#1d4ed8]">
                              {(item.groupLabel ?? (item.groupKind === 'manual' ? '组' : '切割'))} {item.cutImageGroup.length}
                            </span>
                          ) : null}
                        </div>
                        {!item.cutImageGroup?.length && (
                          <div className="p-2 flex flex-col gap-1.5 border-t border-[#252528] bg-[#050505]">
                            <div className="flex gap-1 flex-wrap items-center justify-between min-h-[18px]">
                              <span className="inline-flex items-center gap-1 rounded-full border border-[#2e2e32] bg-[#151518] px-2 py-0.5 text-[7px] text-gray-300/95 select-none">
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
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          data-workflow-outline
          className="h-full min-h-0 shrink-0 flex flex-col border-r border-white/[0.06] pr-2 min-w-0"
          style={{ width: `${sidebarWidth}px` }}
        >
          <div ref={outlineScrollRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-0.5 px-1 pt-2 pb-2">
            {activePaneNode === 0 ? (
              repositoryVisibleItems.length === 0 ? (
                <div className="text-[9px] text-gray-600 py-6 text-center leading-relaxed">
                  {repositoryOutlineMode === 'tags' ? '暂无标签 · 试试切回列表或调整筛选' : '暂无资产 · 与左侧筛选一致'}
                </div>
              ) : (
                repositoryOutlineMode === 'tags' ? repositoryOutlineTagRows : repositoryOutlineRows
              )
            ) : visibleAssets.length === 0 ? (
              <div className="text-[9px] text-gray-600 py-6 text-center leading-relaxed">暂无资产 · 导入或生成后将显示在此</div>
            ) : (
              outlineTreeRows
            )}
          </div>
          {(activePaneNode === 0 || activePaneNode === 1) && (
            <div
              data-workflow-outline-footer
              className="shrink-0 border-t border-white/[0.06] pt-2 pb-2 px-1 bg-[#0a0a0c]/95"
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
                    从左侧仓库或上方列表拖入条目
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

        <div className="min-w-0 min-h-0 h-full flex flex-col shrink-0" style={{ width: `${listPaneWidth}px` }}>
        <div
          ref={centerScrollRef}
          className="flex-1 min-w-0 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-3 rounded-xl transition-colors"
          onDragOver={(e) => {
            if (!hasImageFileTransfer(e.dataTransfer)) return;
            e.preventDefault();
          }}
          tabIndex={0}
        >
          {viewStack.length > 0 ? (
            <>
              <div className="flex items-center gap-2 shrink-0 px-2">
                <button
                  type="button"
                  onClick={() => startTransition(() => setViewStack((s) => s.slice(0, -1)))}
                  className="px-3 py-1.5 rounded-lg bg-[#26262c] text-[9px] font-black uppercase hover:bg-[#383842]"
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
                          onClick={() =>
                            setViewStack((s) => {
                              const pos = s.findIndex((x) => x.assetId === b.id);
                              return pos === -1 ? s : s.slice(0, pos + 1);
                            })
                          }
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
                      组内 ({currentGroupItems.length})
                    </span>
                  </>
                )}
              </div>
              <div
                className="gap-4 flex-1 px-6 pt-4"
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
                          className="break-inside-avoid mb-4 rounded-2xl border border-[#2e2e32] bg-[#141416] overflow-hidden flex justify-center"
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
                              imgClassName="relative z-0 block w-full h-full object-contain"
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
                        return (
                          <div key={idx} className="break-inside-avoid mb-6 relative" data-workflow-thumb-key={groupKey}>
                            {childAsset.cutImageGroup?.length && (
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
                              const cGLen = childAsset.cutImageGroup?.length ?? 0;
                              const cSafe = cGLen ? ((cRaw % cGLen) + cGLen) % cGLen : 0;
                              const childGridPreviewSrc = !childAsset.cutImageGroup?.length
                                ? img
                                : (() => {
                                    const groupItems = childAsset.cutImageGroup!;
                                    const itemInGroup = groupItems[cSafe] ?? groupItems[0];
                                    if (typeof itemInGroup === 'string') return itemInGroup;
                                    if (itemInGroup && typeof itemInGroup === 'object' && 'r2Key' in itemInGroup)
                                      return childAsset.original;
                                    const nestedId =
                                      itemInGroup && typeof itemInGroup === 'object' && 'assetId' in itemInGroup
                                        ? (itemInGroup as { assetId: string }).assetId
                                        : '';
                                    const nestedChild = nestedId ? assets.find((x) => x.id === nestedId) : undefined;
                                    return nestedChild ? getAssetDisplayImage(nestedChild) : img;
                                  })();
                              const childTextDisplay = getAssetDisplayText(childAsset);
                              const hasChildDisplayImage = childGridPreviewSrc.trim() !== '';
                              const hasChildTextPayload =
                                !!childTextDisplay ||
                                !!(childAsset.textTitle || '').trim() ||
                                Object.values(childAsset.textResults || {}).some((v) => String(v || '').trim() !== '');
                              const childGridCacheKey = childAsset.cutImageGroup?.length
                                ? `${childAsset.id}:${childAsset.displayKey}:g${cSafe}`
                                : `${childAsset.id}:${childAsset.displayKey}`;
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
                                  className={`group relative rounded-2xl border bg-[#16161a] overflow-hidden ${
                                    selectedGroupItemKeys.has(groupKey)
                                      ? 'border-blue-500 ring-2 ring-blue-500/50'
                                      : dragOverGroupItemKey === groupKey
                                      ? 'border-blue-500 ring-2 ring-blue-500/50'
                                      : childAsset.cutImageGroup?.length
                                      ? 'border-blue-400'
                                      : 'border-[#2e2e32]'
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
                                      assetIds.includes(a.id) ? { ...a, parentAssetId: newGroupId } : a
                                    );
                                    const groupIdx = updated.findIndex((a) => a.id === groupAssetId);
                                    if (groupIdx !== -1) {
                                      const g = updated[groupIdx];
                                      const items = [...(g.cutImageGroup ?? [])];
                                      const sorted = allIndexes.filter((i) => i >= 0 && i < items.length).sort((a, b) => a - b);
                                      const keep: typeof items = [];
                                      items.forEach((it, i) => {
                                        if (!sorted.includes(i)) keep.push(it);
                                      });
                                      const insertPos = sorted.length ? sorted[0] : keep.length;
                                      const withGroup = [...keep];
                                      withGroup.splice(insertPos, 0, { assetId: newGroupId });
                                      updated = updated.map((a, i) =>
                                        i === groupIdx ? { ...a, cutImageGroup: withGroup } : a
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
                                    setDraggingGroupItems(null);
                                  }}
                                  {...((getDisplayKeysForAsset(childAsset).length > 1 || (childAsset.cutImageGroup?.length ?? 0) > 1)
                                    ? { 'data-prevent-wheel-scroll': '' }
                                    : {})}
                                  onWheel={(e) => {
                                    if (isBusyGroupItem) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (childAsset.cutImageGroup?.length) {
                                      if (childAsset.cutImageGroup.length <= 1) return;
                                      const delta = e.deltaY > 0 ? 1 : -1;
                                      setGroupPreviewIndexById((prev) => {
                                        const current = prev[childAsset.id] ?? 0;
                                        const len = childAsset.cutImageGroup?.length ?? 1;
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
                                      if (childAsset.cutImageGroup?.length) {
                                        setViewStack((s) => [...s, { assetId: childAsset.id }]);
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
                                    {!hasChildDisplayImage ? (
                                      <div
                                        className="relative w-full bg-[#141416] flex flex-col justify-start p-3 text-left"
                                        style={{ aspectRatio: `${3 / 4}`, minHeight: '10rem' }}
                                      >
                                        <span className="text-[8px] font-black uppercase text-blue-300 mb-1.5">文本</span>
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
                                          imgClassName="relative z-0 block w-full h-full object-contain"
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
                                          className="w-8 h-8 rounded-full flex items-center justify-center bg-[#26262c] border border-[#3a3a40] text-gray-400 hover:bg-[#4a1c1c] hover:border-[#c87878] hover:text-red-300 text-base font-medium leading-none"
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
                                    {childAsset.cutImageGroup?.length ? (
                                      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-[#1d4ed8]">
                                        {(childAsset.groupLabel ?? (childAsset.groupKind === 'manual' ? '组' : '切割'))} {childAsset.cutImageGroup.length}
                                      </span>
                                    ) : hasChildTextPayload ? (
                                      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-[#1d4ed8] text-white">
                                        文本
                                      </span>
                                    ) : null}
                                  </div>
                                  {!childAsset.cutImageGroup?.length && (
                                    <div className="p-2 flex flex-col gap-1.5 border-t border-[#252528]">
                                      <div className="flex gap-1 flex-wrap items-center justify-between min-h-[18px]">
                                        <span className="inline-flex items-center gap-1 rounded-full border border-[#2e2e32] bg-[#151518] px-2 py-0.5 text-[7px] text-gray-300/95 select-none">
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
                          className={`break-inside-avoid mb-4 group relative rounded-2xl border bg-[#16161a] overflow-hidden ${
                            selectedGroupItemKeys.has(groupKey)
                              ? 'border-blue-500 ring-2 ring-blue-500/50'
                              : 'border-[#2e2e32]'
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
                                imgClassName="relative z-0 block w-full h-full object-contain"
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
                                  className="w-8 h-8 rounded-full flex items-center justify-center bg-[#26262c] border border-[#3a3a40] text-gray-400 hover:bg-[#4a1c1c] hover:border-[#c87878] hover:text-red-300 text-base font-medium leading-none"
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
                <div className="flex flex-col items-center justify-center py-12 text-gray-500 text-[9px]">此组暂无内容</div>
              )}
            </>
          ) : rootCanvasAssets.length === 0 ? (
            <div className="flex flex-1 min-h-0 flex-col items-center justify-center px-6 py-10 text-gray-500">
              <AppIcon name="camera" className="w-10 h-10 mb-2" />
              <p className="text-[10px] font-black uppercase">暂无内容</p>
              <p className="text-[9px] mt-1 text-center max-w-sm">
                使用「导入图片」添加图片，或点顶栏「添加文字」建文字卡片
              </p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 p-6 min-w-0">
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
                  const gLen = a.cutImageGroup?.length ?? 0;
                  const gSafe = gLen ? ((rawG % gLen) + gLen) % gLen : 0;
                  const groupPreviewItem = a.cutImageGroup?.[gSafe] ?? a.cutImageGroup?.[0];
                  const groupPreviewTextAsset =
                    groupPreviewItem &&
                    typeof groupPreviewItem === 'object' &&
                    'assetId' in groupPreviewItem
                      ? assets.find((x) => x.id === groupPreviewItem.assetId)
                      : null;
                  const isAllTextGroup =
                    !!a.cutImageGroup?.length &&
                    a.cutImageGroup.every((groupItem) => {
                      if (!(typeof groupItem === 'object' && groupItem && 'assetId' in groupItem)) return false;
                      const child = assets.find((x) => x.id === groupItem.assetId);
                      return !!child && isWorkflowTextAsset(child);
                    });
                  const rootTextPreviewAsset =
                    isAllTextGroup && groupPreviewTextAsset && isWorkflowTextAsset(groupPreviewTextAsset)
                      ? groupPreviewTextAsset
                      : null;
                  const gridPreviewSrc = !hasDisplayImage
                    ? ''
                    : !a.cutImageGroup?.length
                    ? baseDisplayImage
                    : (() => {
                        const groupItems = a.cutImageGroup!;
                        const item = groupItems[gSafe] ?? groupItems[0];
                        if (typeof item === 'string') return item;
                        const child = assets.find((x) => x.id === item.assetId);
                        return child ? getAssetDisplayImage(child) : baseDisplayImage;
                      })();
                  const gridPreviewCacheKey = a.cutImageGroup?.length
                    ? `${a.id}:${a.displayKey}:g${gSafe}`
                    : `${a.id}:${a.displayKey}`;
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
                      {a.cutImageGroup?.length ? (
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
                        className={`group relative rounded-2xl border overflow-hidden bg-[#16161a] ${
                          selectedAssetIds.has(a.id)
                            ? 'border-blue-500 ring-2 ring-blue-500/50'
                            : dragOverAssetId === a.id
                            ? a.cutImageGroup?.length
                              ? 'border-blue-400 ring-2 ring-blue-400/60'
                              : 'border-blue-500 ring-2 ring-blue-500/50'
                            : a.cutImageGroup?.length
                            ? 'border-blue-400'
                            : 'border-[#2e2e32]'
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
                            setDragOverAssetId(null);
                            setDraggingAssetIds(null);
                            setDraggingGroupItems(null);
                            updateDraggingActionId(null);
                            if (capId) runCapabilityOnAssetCardImmediate(a, capId);
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
                              if (a.cutImageGroup?.length) {
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
                              queueMicrotask(() =>
                                setViewStack((s) => s.filter((x) => x.assetId !== groupAssetId))
                              );
                            }
                            const targetInPrev = afterRemove.find((x) => x.id === targetId);
                            const targetHasGroup = !!targetInPrev?.cutImageGroup?.length;
                            if (targetHasGroup) {
                              return mergeAssetIdsIntoGroupCardAssets(afterRemove, targetId, assetIds);
                            }
                            return insertManualGroupForAssetIds(afterRemove, [...assetIds, targetId]);
                          });
                          finish();
                        }}
                        {...((!isBusy && !showArchived && (getDisplayKeysForAsset(a).length > 1 || (a.cutImageGroup?.length ?? 0) > 1))
                          ? { 'data-prevent-wheel-scroll': '' }
                          : {})}
                        onWheel={(e) => {
                          if (isBusy) return;
                          e.preventDefault();
                          e.stopPropagation();
                          if (showArchived) return;
                          if (a.cutImageGroup?.length) {
                            if (!a.cutImageGroup.length) return;
                            const delta = e.deltaY > 0 ? 1 : -1;
                            setGroupPreviewIndexById((prev) => {
                              const current = prev[a.id] ?? 0;
                              const len = a.cutImageGroup ? a.cutImageGroup.length : 1;
                              const next = ((current + delta) % len + len) % len;
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
                            } else if (a.cutImageGroup?.length) {
                              setViewStack([{ assetId: a.id }]);
                            } else {
                              setLightboxSourceSlot(null);
                              setLightboxAssetId(a.id);
                            }
                          }}
                        >
                          {!hasDisplayImage || isAllTextGroup ? (
                            <div
                              className="relative w-full bg-[#141416] flex flex-col justify-start p-3 text-left"
                              style={{ aspectRatio: `${3 / 4}`, minHeight: '10rem' }}
                            >
                              <span className="text-[8px] font-black uppercase text-blue-300 mb-1.5">文本</span>
                              {(rootTextPreviewAsset?.textTitle || a.textTitle)?.trim() ? (
                                <p className="text-[11px] font-bold text-gray-100 line-clamp-2 mb-1.5">
                                  {(rootTextPreviewAsset?.textTitle || a.textTitle || '').trim()}
                                </p>
                              ) : null}
                              <p
                                className={`text-[10px] text-gray-400 leading-snug whitespace-pre-wrap flex-1 overflow-hidden ${
                                  ((rootTextPreviewAsset?.textTitle || a.textTitle || '').trim()) ? 'line-clamp-6' : 'line-clamp-8'
                                }`}
                              >
                                {rootTextPreviewAsset
                                  ? (getAssetDisplayText(rootTextPreviewAsset) || '（空白，点击编辑）')
                                  : (textDisplay || '（空白，点击编辑）')}
                              </p>
                            </div>
                          ) : (
                            <div className="relative w-full bg-[#141416] flex justify-center" style={{ aspectRatio: `${cardAspect}` }}>
                              <WorkflowGridImage
                                fullSrc={gridPreviewSrcEffective}
                                cacheKey={gridPreviewCacheKeyEffective}
                                deferThumbnail={!thumbUnlockKeys.has(a.id)}
                                thumbDecodePriority={thumbHotKeys.has(a.id) ? 'high' : 'low'}
                                imageFetchPriority={thumbHotKeys.has(a.id) ? 'high' : 'auto'}
                                className="relative z-0 block w-full h-full min-h-[5rem]"
                                imgClassName="relative z-0 block w-full h-full object-contain"
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
                          {a.cutImageGroup?.length ? (
                            <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-[#1d4ed8]">
                              {(a.groupLabel ?? (a.groupKind === 'manual' ? '组' : '切割'))} {a.cutImageGroup.length}
                            </span>
                          ) : hasTextPayload ? (
                            <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-[#1d4ed8] text-white">
                              文本
                            </span>
                          ) : null}
                        </div>
                        {!showArchived && !a.cutImageGroup?.length && (
                          <div className="p-2 flex flex-col gap-1.5 border-t border-[#252528] bg-[#050505]">
                            <div className="flex gap-1 flex-wrap items-center justify-between min-h-[18px]">
                              <span className="inline-flex items-center gap-1 rounded-full border border-[#2e2e32] bg-[#151518] px-2 py-0.5 text-[7px] text-gray-300/95 select-none">
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
        <div className="h-full min-h-0 shrink-0 flex flex-col min-w-0" style={{ width: `${sidebarWidth}px` }}>
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
            setSelectedGroupItemKeys={setSelectedGroupItemKeys}
            viewStackLength={viewStack.length}
            moveGroupItemsToUpperLevel={moveGroupItemsToUpperLevel}
            sidebarOpsAllowed={sidebarOpsAllowed}
            groupAssetForDrag={groupAssetForDrag}
            currentGroupAsset={currentGroupAsset}
            duplicateAssetInPlace={duplicateAssetInPlace}
            removeAsset={removeAsset}
            removeGroupItems={removeGroupItems}
            setViewStack={setViewStack}
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
            onComposeCapabilities={handleComposeCapabilities}
          />
        </div>

        {/* 右侧：能力预设列 */}
        <div className={`h-full min-h-0 shrink-0 flex flex-col overflow-hidden border-l border-white/[0.06] pl-4`} style={{ width: `${presetPaneWidth}px` }}>
          {capabilityPresetPanel ? (
            <div
              data-workflow-preset
              className="flex flex-col flex-1 min-h-0 overflow-hidden rounded-xl border border-white/[0.06] bg-[#0a0a0c] p-2"
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
                  if (mod.category === 'generate_3d' && onAddGenerate3DJob) {
                    onAddGenerate3DJob(mod, getAssetDisplayImage(lightboxAsset));
                  } else {
                    addToPending(lightboxAsset.id, mod.id, {
                      ...(lightboxSourceSlot
                        ? {
                            sourceGroupAssetId: lightboxSourceSlot.sourceGroupAssetId,
                            sourceItemIndex: lightboxSourceSlot.sourceItemIndex,
                          }
                        : {}),
                    });
                  }
                  setLightboxSourceSlot(null);
                  setLightboxAssetId(nextAsset?.id ?? null);
                }}
                className="inline-flex w-auto px-3 py-1.5 rounded-lg bg-[#26262c]/95 border border-[#3a3a40] text-[9px] font-black uppercase hover:bg-[#305a90] hover:border-[#3b82f6]"
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
                    className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border bg-[#26262c] border-[#3a3a40] hover:bg-[#383842]"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => textLightboxCenterRef.current?.setEditingMode(false)}
                    className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border bg-[#26262c] border-[#3a3a40] hover:bg-[#383842]"
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
              <span className="text-[8px] font-black text-gray-500 uppercase mr-1">显示</span>
              <button
                type="button"
                onClick={() => setDisplayKey(lightboxAsset.id, 'original')}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${lightboxAsset.displayKey === 'original' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#26262c] border-[#3a3a40] hover:bg-[#383842]'}`}
              >
                原始
              </button>
              {lightboxAsset.cutImageGroup?.length ? (
                <button
                  type="button"
                  onClick={() => setDisplayKey(lightboxAsset.id, 'cut_image')}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${lightboxAsset.displayKey === 'cut_image' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#26262c] border-[#3a3a40] hover:bg-[#383842]'}`}
                >
                  切割
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
                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${lightboxAsset.displayKey === k ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#26262c] border-[#3a3a40] hover:bg-[#383842]'}`}
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
          onConfirm={(editedPrompt) => {
            const trimmed = editedPrompt.trim();
            const generateCount = normalizeWorkflowGenerateCount(promptTweakModal.overrides?.generateCount);
            if (
              generateCount > WORKFLOW_GROUP_GENERATE_CONFIRM_THRESHOLD &&
              typeof window !== 'undefined' &&
              !window.confirm(`当前生成数量为 ${generateCount}，将创建大量任务，是否继续？`)
            ) {
              return;
            }
            const taskOptions: WorkflowPendingTaskOptions = {
              ...(trimmed ? { promptOverride: trimmed } : {}),
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
                  next.push({
                    ...src,
                    id: plan.cloneId,
                    parentAssetId: undefined,
                    archived: false,
                    hiddenInGrid: false,
                    createdAt: Date.now(),
                  });
                }
                for (const ids of groupPlans) next = insertManualGroupForAssetIds(next, ids);
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
  );
};

export default WorkflowSection;
