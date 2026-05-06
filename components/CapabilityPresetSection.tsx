import React, { useState, useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { CustomAppModule, CapabilityCategory, CapabilityEngine, DialogImageGear, Generate3DPreset, CapabilitySet } from '../types';
import { CAPABILITY_CATEGORIES, DIALOG_IMAGE_GEARS, SUPPORTED_ASPECT_RATIOS, SUPPORTED_IMAGE_SIZES } from '../types';
import type { CapabilityTestResult } from '../services/capabilityTestRunner';
import {
  BUILTIN_CAPABILITY_EDITABLE_IDS,
  BUILTIN_IMAGE_PROCESS_IDS,
  CAPABILITY_PRESETS_VERSION,
  normalizeCapabilityPreset,
} from '../services/capabilityPresetStore';
import { readLocalJson, writeLocalJson } from '../services/clientPersist';
import { getCapabilityEngine } from '../services/capabilityExecutor';
import { useStoreCatalog } from '../services/storeCatalogHook';
import { publishPresetToUserR2Catalog } from '../services/capabilityPresetR2Publish';
import { resolveCapabilityPreviewSrc } from '../services/capabilityPreviewUrl';
import { mergeCardAspectFromIntrinsic } from './workflow/workflowCardAspect';
import {
  TITLE_ROW_STEPPER_SHELL,
  TITLE_ROW_STEPPER_VALUE,
  TITLE_ROW_STEPPER_BTN,
} from './workflow/workflowSectionUiConstants';
import { uuid } from './workflow/workflowIds';
import {
  extractCapabilitySearchKeywords,
  keywordsMatchCapabilityLabelId,
  keywordsMatchCapabilityModule,
} from './workflow/capabilitySearchMatch';
import { DT_AC_CAPABILITY_FROM_EDITOR } from '../services/workflowDragPipeline';
import WorkflowComposerOverlay from './WorkflowComposerOverlay';
import { CapabilityPreviewImg } from './CapabilityPreviewImg';
import { ImagePreviewOverlay } from './ImagePreviewOverlay';
import { CustomDropdown, DROPDOWN_TRIGGER_COMPACT } from './ui/CustomDropdown';
import AppIcon from './ui/AppIcon';
import { useEffectiveImageGearRows } from '../hooks/useEffectiveImageGearRows';

const CAPABILITY_SETS_VERSION = 1;
const CAPABILITY_PRESET_COLUMNS_KEY = 'ac_capability_preset_columns_v1';
const CAPABILITY_PRESET_COLUMNS_MIN = 2;
const CAPABILITY_PRESET_COLUMNS_MAX = 6;
const DRAG_SCROLL_EDGE_PX = 64;
const DRAG_SCROLL_MAX_STEP_PX = 24;

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

const DEFAULT_GENERATE_3D: Generate3DPreset = {
  provider: 'tripo',
  tripoTaskType: 'image_to_model',
  tripoTextureQuality: 'standard',
  tripoTexture: true,
  tripoPbr: true,
  tripoExportUv: true,
  module: 'pro',
  model: '3.0',
  enablePBR: false,
};
const TRIPO_MODEL_VERSION_OPTIONS = [
  { value: '', label: '自动（不指定）' },
  { value: 'P1-20260311', label: 'P1-20260311' },
  { value: 'v3.1-20260211', label: 'v3.1-20260211' },
  { value: 'v3.0-20250812', label: 'v3.0-20250812' },
  { value: 'v2.5-20250123', label: 'v2.5-20250123（默认）' },
  { value: 'v2.0-20240919', label: 'v2.0-20240919' },
] as const;
const DETAIL_DROPDOWN_PORTAL_ZINDEX = { backdrop: 10120, list: 10121 } as const;

type ViewMode = 'presets' | 'image_process' | 'sets';
type PresetTypeFilter = 'all' | 'text_to_text' | 'text_to_image' | 'image_to_image' | 'image_to_text';

const CapabilityPresetSection: React.FC<{
  presets: CustomAppModule[];
  onUpdate: (next: CustomAppModule[]) => void;
  sets?: CapabilitySet[];
  onUpdateSets?: (next: CapabilitySet[]) => void;
  /** 若提供则复用外层统一工作流编排房间（避免本组件再开一套 overlay） */
  onOpenWorkflowComposer?: (initialSet: CapabilitySet | null) => void;
  onRunTest?: (preset: CustomAppModule, imageBase64: string) => Promise<CapabilityTestResult>;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
  embeddedInWorkflow?: boolean;
  canUploadToR2?: boolean;
  /** 工作区侧栏：挂到「仅卡片区域」的滚动容器，供外层接管滚动行为 */
  scrollContainerRef?: React.Ref<HTMLDivElement>;
  /**
   * 工作区底部输入框文案：嵌入态下按与功能区搜索相同的规则（名称/id/分类/提示词片段）过滤本列预设，
   * 便于边打字边收窄能力卡片；清空则恢复全部（仍受类型筛选与视图模式约束）。
   */
  workflowComposeSearchQuery?: string;
  /** 工作区：功能区悬停联动，列表内 id 之外的预设卡片压暗 */
  sidebarLinkHoverPresetIds?: string[] | null;
}> = ({
  presets,
  onUpdate,
  sets = [],
  onUpdateSets,
  onOpenWorkflowComposer,
  onRunTest,
  onLog,
  embeddedInWorkflow = false,
  canUploadToR2 = false,
  scrollContainerRef,
  workflowComposeSearchQuery = '',
  sidebarLinkHoverPresetIds = null,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('presets');
  const [presetTypeFilter, setPresetTypeFilter] = useState<PresetTypeFilter>('all');
  const [presetColumnCount, setPresetColumnCount] = useState<number>(() =>
    readLocalJson<number>(CAPABILITY_PRESET_COLUMNS_KEY, 6, (parsed) =>
      typeof parsed === 'number' ? normalizeCapabilityPresetColumnCount(parsed) : null
    )
  );
  /** 与工作区顶栏步进器同一套列数；过窄时可拖宽能力预设列或调低列数 */
  const presetMasonryColumnCount = useMemo(
    () => normalizeCapabilityPresetColumnCount(presetColumnCount),
    [presetColumnCount]
  );
  const sidebarLinkHoverPresetIdSet = useMemo(() => {
    if (!embeddedInWorkflow || !sidebarLinkHoverPresetIds?.length) return null;
    return new Set(sidebarLinkHoverPresetIds);
  }, [embeddedInWorkflow, sidebarLinkHoverPresetIds]);
  type EmbedComposerSession = { id: string; initialSet: CapabilitySet | null; sessionKey: number };
  const [embedComposerSessions, setEmbedComposerSessions] = useState<EmbedComposerSession[]>([]);
  const [embedComposerActiveId, setEmbedComposerActiveId] = useState<string | null>(null);
  const [embedComposerMinimized, setEmbedComposerMinimized] = useState<Record<string, boolean>>({});
  const embedComposerActiveIdRef = useRef<string | null>(null);
  useEffect(() => {
    embedComposerActiveIdRef.current = embedComposerActiveId;
  }, [embedComposerActiveId]);
  const reindex = (list: CustomAppModule[]) => list.map((p, i) => ({ ...p, order: i }));
  const update = (list: CustomAppModule[]) => onUpdate(reindex(list));
  const { rows: effectiveGearRows, coerceGearId } = useEffectiveImageGearRows();
  const getEngine = (p: CustomAppModule): CapabilityEngine => getCapabilityEngine(p);
  const isBuiltinImagePipelinePreset = (p: CustomAppModule) =>
    p.category === 'image_to_image' && getCapabilityEngine(p) === 'builtin';
  const getGear = (p: CustomAppModule): DialogImageGear => {
    const g = (p.imageGear as DialogImageGear) || 'standard';
    return DIALOG_IMAGE_GEARS.some((x) => x.id === g) ? g : 'standard';
  };
  const genId = () => {
    try {
      const c: { randomUUID?: () => string } | null = typeof crypto !== 'undefined' ? crypto : null;
      if (c && typeof c.randomUUID === 'function') return String(c.randomUUID()).replace(/-/g, '').slice(0, 10);
    } catch {
      /* ignore crypto fallback failure */
    }
    return Math.random().toString(36).slice(2, 11);
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editCategory, setEditCategory] = useState<CapabilityCategory>('image_to_image');
  const [editEngine, setEditEngine] = useState<CapabilityEngine>('gen_image');
  const [editEnabled, setEditEnabled] = useState(true);
  const [editImageGear, setEditImageGear] = useState<DialogImageGear>('standard');
  useLayoutEffect(() => {
    if (!editingId) return;
    const next = coerceGearId(editImageGear);
    if (next !== editImageGear) setEditImageGear(next as DialogImageGear);
  }, [editingId, effectiveGearRows, coerceGearId, editImageGear]);
  const [editImageAspectRatio, setEditImageAspectRatio] = useState('');
  const [editImageSize, setEditImageSize] = useState('');
  const [editInstruction, setEditInstruction] = useState('');
  /** 仅编辑「切割图片」内置预设时使用 */
  const [editCutOverflowPx, setEditCutOverflowPx] = useState(0);
  /** 切割模式：uniform=均匀分割, auto=自动检测, vision=视觉识别 */
  const [editCutMode, setEditCutMode] = useState<'uniform' | 'auto' | 'vision'>('auto');
  /** 均匀分割行数 */
  const [editUniformRows, setEditUniformRows] = useState(2);
  /** 均匀分割列数 */
  const [editUniformCols, setEditUniformCols] = useState(2);
  const [editSkipUnderstand, setEditSkipUnderstand] = useState(false);
  const [editRequirePromptOnTextDrop, setEditRequirePromptOnTextDrop] = useState(false);
  const [editCompanionHostBundleDir, setEditCompanionHostBundleDir] = useState('');
  const [editCompanionHostBundlePhase, setEditCompanionHostBundlePhase] = useState<'exec' | 'probe'>('exec');
  const [isAdding, setIsAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newCategory, setNewCategory] = useState<CapabilityCategory>('image_to_image');
  const [newEngine, setNewEngine] = useState<CapabilityEngine>('gen_image');
  const [newEnabled, setNewEnabled] = useState(true);
  const [newImageGear, setNewImageGear] = useState<DialogImageGear>('standard');
  const [newImageAspectRatio, setNewImageAspectRatio] = useState('');
  const [newImageSize, setNewImageSize] = useState('');
  const [newInstruction, setNewInstruction] = useState('');
  const [newSkipUnderstand, setNewSkipUnderstand] = useState(false);
  const [newRequirePromptOnTextDrop, setNewRequirePromptOnTextDrop] = useState(false);
  const [newCompanionHostBundleDir, setNewCompanionHostBundleDir] = useState('');
  const [newCompanionHostBundlePhase, setNewCompanionHostBundlePhase] = useState<'exec' | 'probe'>('exec');
  const [testImage, setTestImage] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<Record<string, CapabilityTestResult | null>>({});
  const [testRunning, setTestRunning] = useState<Record<string, boolean>>({});
  /** 本地临时预览图（不落 localStorage，避免超配额） */
  const [runtimePreviewImage, setRuntimePreviewImage] = useState<Record<string, string>>({});
  const [runtimePreviewThumbImage, setRuntimePreviewThumbImage] = useState<Record<string, string>>({});
  const [previewSplitRatio, setPreviewSplitRatio] = useState<Record<string, number>>({});
  const [cardAspectByPresetId, setCardAspectByPresetId] = useState<Record<string, number>>({});
  const fileInputRef = useRef<Record<string, HTMLInputElement | null>>({});
  const [newGenerate3D, setNewGenerate3D] = useState<Generate3DPreset>({ ...DEFAULT_GENERATE_3D });
  const [editGenerate3D, setEditGenerate3D] = useState<Generate3DPreset>({ ...DEFAULT_GENERATE_3D });
  const newIsTripoV3Line = (newGenerate3D.tripoModelVersion ?? '').startsWith('v3.');
  const editIsTripoV3Line = (editGenerate3D.tripoModelVersion ?? '').startsWith('v3.');
  const newTripoGenerateParts = newGenerate3D.tripoGenerateParts === true;
  const newTripoTextureEnabled = newGenerate3D.tripoTexture !== false;
  const newTripoPbrEnabled = newGenerate3D.tripoPbr !== false;
  const editTripoGenerateParts = editGenerate3D.tripoGenerateParts === true;
  const editTripoTextureEnabled = editGenerate3D.tripoTexture !== false;
  const editTripoPbrEnabled = editGenerate3D.tripoPbr !== false;
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [lightboxCompare, setLightboxCompare] = useState<{ original: string; generated: string } | null>(null);
  const [lightboxSplitRatio, setLightboxSplitRatio] = useState(0.5);
  const [detailPresetId, setDetailPresetId] = useState<string | null>(null);
  const [detailEditMode, setDetailEditMode] = useState(false);
  useEffect(() => {
    if (!lightboxImage && !lightboxCompare) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxImage(null);
        setLightboxCompare(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxImage, lightboxCompare]);
  const [showImportExport, setShowImportExport] = useState(false);
  const [seedDropActive, setSeedDropActive] = useState(false);
  const [uploadingPresetActions, setUploadingPresetActions] = useState<Record<string, 'preview' | 'preset' | undefined>>({});
  const [syncAfterRefresh, setSyncAfterRefresh] = useState(false);
  const autoSyncedRemoteRef = useRef(false);
  const [pendingScrollTarget, setPendingScrollTarget] = useState<{ kind: 'preset' | 'set'; id: string } | null>(null);
  const [draggingPresetId, setDraggingPresetId] = useState<string | null>(null);
  const dragPreviewElRef = useRef<HTMLDivElement | null>(null);
  const presetCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const setCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  /** 仅预设「内容区」滚动容器；定位时用 scrollTo 只滚此处，避免 scrollIntoView 连带滚主布局 */
  const presetContentScrollRef = useRef<HTMLDivElement | null>(null);
  const isBuiltinImageProcess = (p: CustomAppModule) =>
    isBuiltinImagePipelinePreset(p) &&
    BUILTIN_IMAGE_PROCESS_IDS.includes(p.id as (typeof BUILTIN_IMAGE_PROCESS_IDS)[number]);

  const {
    catalog,
    loading: catalogLoading,
    error: catalogError,
    refresh: refreshCatalog,
    installPresets,
    installingAll,
    packContentsLoading,
    remotePresetItems,
  } = useStoreCatalog({ onPresetsApplied: (next) => onUpdate(next), onLog });
  const triggerRemoteRefreshSync = useCallback(async () => {
    try {
      await refreshCatalog();
    } finally {
      // 刷新目录后再触发同步，避免先用旧远程列表“空同步”导致看起来无反应
      setSyncAfterRefresh(true);
    }
  }, [refreshCatalog]);
  const openNewSet = useCallback(() => {
    if (onOpenWorkflowComposer) {
      onOpenWorkflowComposer(null);
      return;
    }
    const id = uuid();
    setEmbedComposerSessions((prev) => [...prev, { id, initialSet: null, sessionKey: Date.now() }]);
    setEmbedComposerActiveId(id);
  }, [onOpenWorkflowComposer]);

  /** 远程能力中尚未出现在当前列表的（按能力展示为卡片，每张卡片可点安装） */
  const effectiveUninstalledPresetItems = useMemo(
    () => remotePresetItems.filter((rp) => !presets.some((p) => p.id === rp.preset.id)),
    [remotePresetItems, presets]
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onToolbarAction = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      const action = detail?.action;
      if (!action) return;
      if (action === 'toggle-import-export') {
        setShowImportExport((v) => !v);
        return;
      }
      if (action === 'add-preset') {
        setIsAdding(true);
        return;
      }
      if (action === 'add-set') {
        openNewSet();
        return;
      }
      if (action === 'refresh-remote') {
        void triggerRemoteRefreshSync();
        return;
      }
    };
    window.addEventListener('ac:capability-preset-toolbar-action', onToolbarAction as EventListener);
    return () => {
      window.removeEventListener('ac:capability-preset-toolbar-action', onToolbarAction as EventListener);
    };
  }, [openNewSet, triggerRemoteRefreshSync]);

  useEffect(() => {
    if (!syncAfterRefresh) return;
    if (catalogLoading || packContentsLoading) return;
    if (catalog.length === 0) {
      onLog?.('info', 'R2 目录为空，无需同步', undefined);
      setSyncAfterRefresh(false);
      return;
    }
    const allRemote = remotePresetItems.map((rp) => rp.preset);
    // 目录已加载但远程能力尚未展开（异步时序），继续等待下一轮状态更新
    if (allRemote.length === 0) return;
    if (allRemote.length > 0) {
      installPresets(allRemote);
      onLog?.('info', `已同步 R2 预设（${allRemote.length} 条）`, undefined);
    }
    setSyncAfterRefresh(false);
  }, [syncAfterRefresh, catalogLoading, packContentsLoading, catalog, remotePresetItems, installPresets, onLog]);
  useEffect(() => {
    // 自动补齐公共仓库能力：仅在当前本地有缺失时执行一次，避免每次进入都覆盖本地排序
    if (autoSyncedRemoteRef.current) return;
    if (catalogLoading || packContentsLoading) return;
    if (effectiveUninstalledPresetItems.length === 0) return;
    const allRemote = remotePresetItems.map((rp) => rp.preset);
    if (allRemote.length === 0) return;
    installPresets(allRemote);
    autoSyncedRemoteRef.current = true;
    onLog?.('info', `已自动同步公共仓库能力（${allRemote.length} 条）`, undefined);
  }, [catalogLoading, packContentsLoading, effectiveUninstalledPresetItems, remotePresetItems, installPresets, onLog]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onViewModeSwitch = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: ViewMode }>).detail;
      const mode = detail?.mode;
      if (mode === 'presets' || mode === 'image_process' || mode === 'sets') {
        setViewMode(mode);
      }
    };
    window.addEventListener('ac:capability-preset-view-mode', onViewModeSwitch as EventListener);
    return () => {
      window.removeEventListener('ac:capability-preset-view-mode', onViewModeSwitch as EventListener);
    };
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onTypeFilterSwitch = (event: Event) => {
      const detail = (event as CustomEvent<{ filter?: PresetTypeFilter }>).detail;
      const filter = detail?.filter;
      if (
        filter === 'all' ||
        filter === 'text_to_text' ||
        filter === 'text_to_image' ||
        filter === 'image_to_image' ||
        filter === 'image_to_text'
      ) {
        setPresetTypeFilter(filter);
      }
    };
    window.addEventListener('ac:capability-preset-type-filter', onTypeFilterSwitch as EventListener);
    return () => {
      window.removeEventListener('ac:capability-preset-type-filter', onTypeFilterSwitch as EventListener);
    };
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onJumpToPreset = (event: Event) => {
      const detail = (event as CustomEvent<{ presetId?: string }>).detail;
      const id = detail?.presetId;
      if (!id) return;
      const preset = presets.find((p) => p.id === id);
      if (!preset) return;
      if (preset.category === 'image_to_image' && getCapabilityEngine(preset) === 'builtin') {
        setViewMode('image_process');
      } else {
        setViewMode('presets');
        setPresetTypeFilter('all');
      }
      setPendingScrollTarget({ kind: 'preset', id });
    };
    window.addEventListener('ac:capability-jump-to-preset', onJumpToPreset as EventListener);
    return () => {
      window.removeEventListener('ac:capability-jump-to-preset', onJumpToPreset as EventListener);
    };
  }, [presets]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('ac:capability-preset-view-mode-changed', { detail: { mode: viewMode } }));
  }, [viewMode]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('ac:capability-preset-type-filter-changed', { detail: { filter: presetTypeFilter } }));
  }, [presetTypeFilter]);

  const saveEdit = () => {
    if (!editingId) return;
    if (editingId === 'cut_image') {
      const ix = presets.findIndex((x) => x.id === 'cut_image');
      const prev = ix >= 0 ? presets[ix] : null;
      if (!prev) {
        setEditingId(null);
        return;
      }
      const {
        imageGear: _ig,
        imageAspectRatio: _iar,
        imageSize: _is,
        skipUnderstand: _su,
        ...prevRest
      } = prev;
      void _ig;
      void _iar;
      void _is;
      void _su;
      const next = normalizeCapabilityPreset(
        {
          ...prevRest,
          label: editLabel.trim() || '切割图片',
          category: 'image_to_image',
          engine: 'builtin',
          instruction: editInstruction,
          enabled: editEnabled,
          cutOverflowPx: Math.max(0, Math.min(512, Math.round(Number(editCutOverflowPx) || 0))),
          cutMode: editCutMode,
          uniformRows: editCutMode === 'uniform' ? editUniformRows : undefined,
          uniformCols: editCutMode === 'uniform' ? editUniformCols : undefined,
        },
        ix
      );
      update(presets.map((p) => (p.id === 'cut_image' ? next : p)));
      setEditingId(null);
      return;
    }
    update(
      presets.map((p) => {
        if (p.id !== editingId) return p;
        const showGenImageFields =
          editCategory === 'text_to_image' || (editCategory === 'image_to_image' && editEngine === 'gen_image');
        const showGenVideoFields = editCategory === 'generate_video';
        const next: CustomAppModule = {
          ...p,
          label: editLabel,
          category: editCategory,
          instruction: editInstruction,
          skipUnderstand: showGenImageFields || showGenVideoFields ? editSkipUnderstand : undefined,
          requirePromptOnTextDrop: editCategory === 'text_to_text' ? editRequirePromptOnTextDrop : undefined,
          enabled: editEnabled,
          imageGear: showGenImageFields ? editImageGear : undefined,
          imageAspectRatio: showGenImageFields ? editImageAspectRatio || undefined : undefined,
          imageSize: showGenImageFields ? editImageSize || undefined : undefined,
          engine:
            editCategory === 'generate_3d' || editCategory === 'generate_video'
              ? undefined
              : editCategory === 'text_to_text' || editCategory === 'image_to_text'
                ? 'gen_text'
                : editCategory === 'text_to_image'
                  ? 'gen_image'
                  : editEngine,
        };
        if (editCategory === 'generate_3d') {
          next.generate3D = { ...editGenerate3D };
          delete (next as CustomAppModule & { engine?: CapabilityEngine }).engine;
          delete (next as CustomAppModule & { companionHostBundle?: unknown }).companionHostBundle;
        } else if (editCategory === 'generate_video') {
          delete (next as CustomAppModule & { generate3D?: Generate3DPreset }).generate3D;
          delete (next as CustomAppModule & { engine?: CapabilityEngine }).engine;
          delete (next as CustomAppModule & { companionHostBundle?: unknown }).companionHostBundle;
        } else {
          delete (next as CustomAppModule & { generate3D?: Generate3DPreset }).generate3D;
          const hbDir = editCompanionHostBundleDir.trim();
          if (hbDir) {
            next.companionHostBundle =
              editCompanionHostBundlePhase === 'probe' ? { dirName: hbDir, phase: 'probe' } : { dirName: hbDir };
          } else {
            delete (next as CustomAppModule & { companionHostBundle?: unknown }).companionHostBundle;
          }
        }
        return next;
      })
    );
    setEditingId(null);
  };

  const addPreset = () => {
    const label = newLabel.trim() || '新功能';
    const id = genId();
    const showNewGenImage =
      newCategory === 'text_to_image' || (newCategory === 'image_to_image' && newEngine === 'gen_image');
    const showNewGenVideo = newCategory === 'generate_video';
    const preset: CustomAppModule = {
      id,
      label,
      category: newCategory,
      instruction: newInstruction,
      skipUnderstand: showNewGenImage || showNewGenVideo ? newSkipUnderstand : undefined,
      requirePromptOnTextDrop: newCategory === 'text_to_text' ? newRequirePromptOnTextDrop : undefined,
      enabled: newEnabled,
      order: presets.length,
      imageGear: showNewGenImage ? newImageGear : undefined,
      imageAspectRatio: showNewGenImage ? newImageAspectRatio || undefined : undefined,
      imageSize: showNewGenImage ? newImageSize || undefined : undefined,
      engine:
        newCategory === 'generate_3d' || newCategory === 'generate_video'
          ? undefined
          : newCategory === 'text_to_text' || newCategory === 'image_to_text'
            ? 'gen_text'
            : newCategory === 'text_to_image'
              ? 'gen_image'
              : newEngine,
    };
    if (newCategory === 'generate_3d') {
      preset.generate3D = { ...newGenerate3D };
    } else if (newCategory !== 'generate_video') {
      const nHb = newCompanionHostBundleDir.trim();
      if (nHb) {
        preset.companionHostBundle =
          newCompanionHostBundlePhase === 'probe' ? { dirName: nHb, phase: 'probe' } : { dirName: nHb };
      }
    }
    update([...presets, preset]);
    setNewLabel('');
    setNewCategory('image_to_image');
    setNewEngine('gen_image');
    setNewEnabled(true);
    setNewImageGear('standard');
    setNewImageAspectRatio('');
    setNewImageSize('');
    setNewInstruction('');
    setNewSkipUnderstand(false);
    setNewRequirePromptOnTextDrop(false);
    setNewCompanionHostBundleDir('');
    setNewCompanionHostBundlePhase('exec');
    setNewGenerate3D({ ...DEFAULT_GENERATE_3D });
    setIsAdding(false);
  };

  const removePreset = (id: string) => {
    update(presets.filter((p) => p.id !== id));
    if (editingId === id) setEditingId(null);
  };

  /** 应用种子格式的预设/集合数据（支持 { version, presets }、{ version, sets } 或旧版纯数组） */
  const applySeedFile = (data: unknown) => {
    if (!data) return;
    if (Array.isArray(data)) {
      const list = data.filter((x) => x && typeof x === 'object') as CustomAppModule[];
      update(list);
      onLog?.('info', `已导入 ${list.length} 条能力预设（数组格式）`, undefined);
      return;
    }
    if (typeof data !== 'object') return;
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.presets)) {
      const list = obj.presets.filter((x) => x && typeof x === 'object') as CustomAppModule[];
      update(list);
      onLog?.('info', `已导入 ${list.length} 条能力预设`, undefined);
    }
    if (Array.isArray(obj.sets) && obj.version === 1) {
      onUpdateSets?.(obj.sets as CapabilitySet[]);
      onLog?.('info', `已导入 ${(obj.sets as CapabilitySet[]).length} 个能力集合`, undefined);
    }
  };

  const loadSeedFromLocal = () => {
    Promise.all([
      fetch('/capability-seed/capability-presets.json').then((r) => (r.ok ? r.json() : null)),
      fetch('/capability-seed/capability-sets.json').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([presetsData, setsData]) => {
        if (presetsData?.presets?.length) {
          update(presetsData.presets as CustomAppModule[]);
          onLog?.('info', `已从本地种子加载 ${presetsData.presets.length} 条能力预设`, undefined);
        }
        if (setsData?.sets && setsData.version === 1) {
          onUpdateSets?.(setsData.sets as CapabilitySet[]);
          onLog?.('info', `已从本地种子加载 ${(setsData.sets as CapabilitySet[]).length} 个能力集合`, undefined);
        }
        if (!presetsData?.presets?.length && !setsData?.sets?.length) {
          onLog?.('warn', '本地种子为空或请求失败', undefined);
        }
      })
      .catch((e) => onLog?.('error', '从本地种子加载失败', e instanceof Error ? e.message : String(e)));
  };

  const handleSeedDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setSeedDropActive(false);
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    const read = (file: File) => {
      return new Promise<void>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result as string);
            applySeedFile(data);
            resolve();
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(new Error('读取失败'));
        reader.readAsText(file);
      });
    };
    Promise.all(Array.from(files as FileList).filter((f) => f.name.endsWith('.json')).map(read)).catch((err) => {
      onLog?.('error', '解析 JSON 失败', err instanceof Error ? err.message : String(err));
    });
  };

  /** 下载当前能力预设/集合为本地种子文件 */
  const exportSeedForRepo = (which: 'presets' | 'sets' | 'both') => {
    try {
      const download = (filename: string, json: object) => {
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      };
      if (which === 'presets' || which === 'both') {
        download('capability-presets.json', { version: CAPABILITY_PRESETS_VERSION, presets });
      }
      if (which === 'sets' || which === 'both') {
        download('capability-sets.json', { version: CAPABILITY_SETS_VERSION, sets });
      }
      onLog?.('info', '已下载本地种子文件', undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onLog?.('error', '导出种子失败', msg);
    }
  };

  const runTest = async (p: CustomAppModule) => {
    const hostBundleDir = p.companionHostBundle?.dirName?.trim();
    const img = testImage[p.id];
    if ((!img && !hostBundleDir) || !onRunTest) return;
    setTestRunning((prev) => ({ ...prev, [p.id]: true }));
    setTestResult((prev) => ({ ...prev, [p.id]: null }));
    onLog?.('info', `[${p.label}] 测试开始`, undefined);
    try {
      const result = await onRunTest(p, img || '');
      setTestResult((prev) => ({ ...prev, [p.id]: result }));
      if (result.ok) {
        if (result.resultImage) updatePresetPreviewImage(p.id, result.resultImage);
        onLog?.('info', `[${p.label}] 完成`, result.cutCount != null ? `裁剪 ${result.cutCount} 张` : `${result.durationMs}ms`);
      } else {
        onLog?.('warn', `[${p.label}] 失败`, result.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTestResult((prev) => ({ ...prev, [p.id]: { ok: false, error: msg, durationMs: 0 } }));
      onLog?.('error', `[${p.label}] 异常`, msg);
    } finally {
      setTestRunning((prev) => ({ ...prev, [p.id]: false }));
    }
  };

  const estimateDataUrlBytes = (value: string) => {
    const i = value.indexOf(',');
    const b64 = i >= 0 ? value.slice(i + 1) : value;
    return Math.floor((b64.length * 3) / 4);
  };

  const optimizePreviewDataUrl = async (
    source: string,
    options?: { maxSide?: number; targetBytes?: number; qualities?: number[] }
  ): Promise<string> => {
    if (!source.startsWith('data:image/')) return source;
    const rawBytes = estimateDataUrlBytes(source);
    const maxSideLimit = options?.maxSide ?? 1280;
    const targetBytes = options?.targetBytes ?? 1.6 * 1024 * 1024;
    const qualities = options?.qualities ?? [0.86, 0.76, 0.66];
    if (rawBytes <= targetBytes && maxSideLimit >= 2048) return source;
    if (typeof window === 'undefined' || typeof document === 'undefined') return source;
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error('预览图加载失败'));
      node.src = source;
    });
    const canvas = document.createElement('canvas');
    const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = maxSide > maxSideLimit ? maxSideLimit / maxSide : 1;
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return source;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of qualities) {
      const next = canvas.toDataURL('image/jpeg', q);
      if (estimateDataUrlBytes(next) <= targetBytes) return next;
    }
    return canvas.toDataURL('image/jpeg', Math.max(0.5, qualities[qualities.length - 1] ?? 0.58));
  };

  const resolvePreviewSourceForLoad = (value: string): string => resolveCapabilityPreviewSrc(value) ?? '';

  const createThumbnailDataUrlFromAny = async (
    source: string,
    options?: { maxSide?: number; targetBytes?: number; qualities?: number[] }
  ): Promise<string | undefined> => {
    const src = resolvePreviewSourceForLoad(source);
    if (!src) return undefined;
    if (src.startsWith('data:image/')) {
      return optimizePreviewDataUrl(src, options);
    }
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const maxSideLimit = options?.maxSide ?? 640;
    const targetBytes = options?.targetBytes ?? 220 * 1024;
    const qualities = options?.qualities ?? [0.8, 0.72, 0.64];
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error('缩略图源加载失败'));
      node.src = src;
    });
    const canvas = document.createElement('canvas');
    const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = maxSide > maxSideLimit ? maxSideLimit / maxSide : 1;
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of qualities) {
      const next = canvas.toDataURL('image/jpeg', q);
      if (estimateDataUrlBytes(next) <= targetBytes) return next;
    }
    return canvas.toDataURL('image/jpeg', Math.max(0.5, qualities[qualities.length - 1] ?? 0.58));
  };

  const updatePresetPreviewImage = (presetId: string, dataUrl: string | undefined) => {
    const setRuntimeThumb = (nextDataUrl: string | undefined) => {
      setRuntimePreviewThumbImage((prev) => {
        if (!nextDataUrl) {
          const next = { ...prev };
          delete next[presetId];
          return next;
        }
        return { ...prev, [presetId]: nextDataUrl };
      });
    };
    setRuntimePreviewImage((prev) => {
      if (!dataUrl) {
        const next = { ...prev };
        delete next[presetId];
        return next;
      }
      return { ...prev, [presetId]: dataUrl };
    });
    if (dataUrl && dataUrl.startsWith('data:image/')) {
      void createThumbnailDataUrlFromAny(dataUrl, { maxSide: 640, targetBytes: 220 * 1024, qualities: [0.8, 0.72, 0.64] })
        .then((thumb) => setRuntimeThumb(thumb))
        .catch(() => {
          /* ignore thumb optimize errors */
        });
    } else if (dataUrl) {
      setRuntimeThumb(dataUrl);
    }
    if (dataUrl === undefined) onLog?.('info', '已清除卡片预览图', undefined);
  };

  /** 左侧大图：优先持久化预览图，其次测试结果，其次临时测试图 */
  const getCardPreviewSrc = useCallback((p: CustomAppModule): string | null => {
    const runtimeThumb = runtimePreviewThumbImage[p.id];
    if (runtimeThumb) return runtimeThumb;
    const runtime = runtimePreviewImage[p.id];
    if (runtime) return runtime;
    const pvGenThumb = resolveCapabilityPreviewSrc(p.previewGeneratedThumbImage);
    if (pvGenThumb) return pvGenThumb;
    const pvGen = resolveCapabilityPreviewSrc(p.previewGeneratedImage);
    if (pvGen) return pvGen;
    const pvThumb = resolveCapabilityPreviewSrc(p.previewOriginalThumbImage);
    if (pvThumb) return pvThumb;
    const pv = resolveCapabilityPreviewSrc(p.previewImage);
    if (pv) return pv;
    const r = testResult[p.id]?.ok ? testResult[p.id]?.resultImage : undefined;
    if (r) return r;
    return testImage[p.id] || null;
  }, [runtimePreviewThumbImage, runtimePreviewImage, testResult, testImage]);
  const getOriginalPreviewSrc = (p: CustomAppModule): string | null => {
    const src =
      testImage[p.id] ||
      resolveCapabilityPreviewSrc(p.previewOriginalImage) ||
      runtimePreviewImage[p.id] ||
      resolveCapabilityPreviewSrc(p.previewImage) ||
      null;
    return src || null;
  };
  const getOriginalPreviewThumbSrc = (p: CustomAppModule): string | null => {
    return (
      resolveCapabilityPreviewSrc(p.previewOriginalThumbImage) ||
      testImage[p.id] ||
      resolveCapabilityPreviewSrc(p.previewOriginalImage) ||
      null
    );
  };
  const getGeneratedPreviewSrc = (p: CustomAppModule): string | null => {
    const src =
      (testResult[p.id]?.ok ? testResult[p.id]?.resultImage : null) ||
      runtimePreviewImage[p.id] ||
      resolveCapabilityPreviewSrc(p.previewGeneratedImage) ||
      resolveCapabilityPreviewSrc(p.previewImage) ||
      null;
    return src || null;
  };
  const getGeneratedPreviewThumbSrc = (p: CustomAppModule): string | null => {
    return (
      resolveCapabilityPreviewSrc(p.previewGeneratedThumbImage) ||
      (testResult[p.id]?.ok ? testResult[p.id]?.resultImage : null) ||
      runtimePreviewImage[p.id] ||
      resolveCapabilityPreviewSrc(p.previewGeneratedImage) ||
      null
    );
  };
  const clearPresetDragPreview = useCallback(() => {
    const node = dragPreviewElRef.current;
    if (node?.parentElement) node.parentElement.removeChild(node);
    dragPreviewElRef.current = null;
  }, []);
  const setGlobalDraggingPresetId = useCallback((id: string | null) => {
    if (typeof window === 'undefined') return;
    try {
      (window as Window & { __acDraggingPresetId?: string | null }).__acDraggingPresetId = id;
    } catch {
      /* ignore global drag id set errors */
    }
  }, []);
  useEffect(() => {
    return () => {
      clearPresetDragPreview();
      setGlobalDraggingPresetId(null);
    };
  }, [clearPresetDragPreview, setGlobalDraggingPresetId]);
  const applyPresetDragImage = useCallback((e: React.DragEvent<HTMLElement>, preset: CustomAppModule) => {
    if (typeof document === 'undefined') return;
    const dt = e.dataTransfer;
    if (!dt) return;
    clearPresetDragPreview();
    const previewSrc = getCardPreviewSrc(preset);
    const node = document.createElement('div');
    node.style.position = 'fixed';
    node.style.left = '-9999px';
    node.style.top = '-9999px';
    node.style.width = '184px';
    node.style.height = '52px';
    node.style.display = 'flex';
    node.style.alignItems = 'center';
    node.style.gap = '8px';
    node.style.padding = '6px 8px';
    node.style.borderRadius = '12px';
    node.style.border = '1px solid rgba(59,130,246,0.5)';
    node.style.background = 'rgba(12,14,19,0.95)';
    node.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
    node.style.color = '#dbeafe';
    node.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    if (previewSrc) {
      const img = document.createElement('img');
      img.src = previewSrc;
      img.alt = '';
      img.style.width = '40px';
      img.style.height = '40px';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '8px';
      img.style.border = '1px solid rgba(255,255,255,0.14)';
      img.style.background = '#111827';
      node.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.style.width = '40px';
      placeholder.style.height = '40px';
      placeholder.style.borderRadius = '8px';
      placeholder.style.border = '1px solid rgba(255,255,255,0.14)';
      placeholder.style.background = 'rgba(255,255,255,0.06)';
      node.appendChild(placeholder);
    }
    const textWrap = document.createElement('div');
    textWrap.style.minWidth = '0';
    textWrap.style.display = 'flex';
    textWrap.style.flexDirection = 'column';
    textWrap.style.gap = '2px';
    const title = document.createElement('div');
    title.textContent = preset.label || '能力预设';
    title.style.fontSize = '11px';
    title.style.fontWeight = '700';
    title.style.whiteSpace = 'nowrap';
    title.style.overflow = 'hidden';
    title.style.textOverflow = 'ellipsis';
    const sub = document.createElement('div');
    sub.textContent = '拖拽到功能区执行';
    sub.style.fontSize = '10px';
    sub.style.color = '#93c5fd';
    textWrap.appendChild(title);
    textWrap.appendChild(sub);
    node.appendChild(textWrap);
    document.body.appendChild(node);
    dragPreviewElRef.current = node;
    try {
      dt.setDragImage(node, 20, 20);
    } catch {
      /* ignore custom drag image errors */
    }
  }, [clearPresetDragPreview, getCardPreviewSrc]);
  const onPresetCardIntrinsicSize = useCallback((presetId: string, w: number, h: number) => {
    setCardAspectByPresetId((prev) => mergeCardAspectFromIntrinsic(prev, presetId, w, h) ?? prev);
  }, []);
  const openPresetDetail = useCallback((p: CustomAppModule) => {
    setDetailPresetId(p.id);
    setDetailEditMode(false);
    setEditingId(null);
  }, []);
  const detailPreset = detailPresetId ? presets.find((x) => x.id === detailPresetId) ?? null : null;
  const detailOriginalPreview = detailPreset
    ? getOriginalPreviewSrc(detailPreset) || getOriginalPreviewThumbSrc(detailPreset) || ''
    : '';
  const detailGeneratedPreview = detailPreset
    ? getGeneratedPreviewSrc(detailPreset) || getGeneratedPreviewThumbSrc(detailPreset) || ''
    : '';
  const detailMainPreview = detailPreset ? getCardPreviewSrc(detailPreset) || '' : '';
  const detailHasCompare = Boolean(detailOriginalPreview && detailGeneratedPreview);
  const beginDetailEdit = useCallback((p: CustomAppModule) => {
    const isLocked =
      isBuiltinImagePipelinePreset(p) &&
      BUILTIN_IMAGE_PROCESS_IDS.includes(p.id as (typeof BUILTIN_IMAGE_PROCESS_IDS)[number]) &&
      !BUILTIN_CAPABILITY_EDITABLE_IDS.includes(p.id);
    if (isLocked) return;
    if (p.id === 'cut_image') {
      setEditingId('cut_image');
      setEditLabel(p.label);
      setEditCategory('image_to_image');
      setEditEngine('builtin');
      setEditEnabled(p.enabled !== false);
      setEditInstruction(((p as { instructionFixed?: string }).instructionFixed ?? p.instruction) || '');
      setEditCutOverflowPx(
        typeof p.cutOverflowPx === 'number' && Number.isFinite(p.cutOverflowPx)
          ? Math.max(0, Math.min(512, Math.round(p.cutOverflowPx)))
          : 0
      );
      setEditCutMode(
        p.cutMode === 'uniform' || p.cutMode === 'auto' || p.cutMode === 'vision'
          ? p.cutMode
          : 'auto'
      );
      setEditUniformRows(
        typeof p.uniformRows === 'number' && Number.isFinite(p.uniformRows)
          ? Math.max(1, Math.min(10, Math.round(p.uniformRows)))
          : 2
      );
      setEditUniformCols(
        typeof p.uniformCols === 'number' && Number.isFinite(p.uniformCols)
          ? Math.max(1, Math.min(10, Math.round(p.uniformCols)))
          : 2
      );
      setDetailEditMode(true);
      return;
    }
    setEditingId(p.id);
    setEditLabel(p.label);
    setEditCategory(p.category);
    setEditEngine(getEngine(p));
    setEditEnabled(p.enabled !== false);
    setEditImageGear(getGear(p));
    setEditImageAspectRatio(p.imageAspectRatio ?? '');
    setEditImageSize(p.imageSize ?? '');
    setEditInstruction(((p as { instructionFixed?: string }).instructionFixed ?? p.instruction) || '');
    setEditSkipUnderstand(p.skipUnderstand === true);
    setEditRequirePromptOnTextDrop(p.requirePromptOnTextDrop === true);
    setEditCompanionHostBundleDir(p.companionHostBundle?.dirName ?? '');
    setEditCompanionHostBundlePhase(p.companionHostBundle?.phase === 'probe' ? 'probe' : 'exec');
    setEditGenerate3D(p.category === 'generate_3d' && p.generate3D ? { ...p.generate3D } : { ...DEFAULT_GENERATE_3D });
    setDetailEditMode(true);
  }, []);
  const saveDetailEdit = () => {
    if (!editingId) return;
    saveEdit();
    setDetailEditMode(false);
  };
  const beginDetailEditRef = useRef(beginDetailEdit);
  useEffect(() => {
    beginDetailEditRef.current = beginDetailEdit;
  }, [beginDetailEdit]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOpenPresetDetail = (event: Event) => {
      const detail = (event as CustomEvent<{ presetId?: string; edit?: boolean }>).detail;
      const id = detail?.presetId;
      if (!id) return;
      const preset = presets.find((p) => p.id === id);
      if (!preset) return;
      if (preset.category === 'image_to_image' && getCapabilityEngine(preset) === 'builtin') {
        setViewMode('image_process');
      } else {
        setViewMode('presets');
      }
      setPendingScrollTarget({ kind: 'preset', id });
      openPresetDetail(preset);
      if (detail?.edit === true) beginDetailEditRef.current(preset);
    };
    window.addEventListener('ac:capability-preset-open-detail', onOpenPresetDetail as EventListener);
    return () => {
      window.removeEventListener('ac:capability-preset-open-detail', onOpenPresetDetail as EventListener);
    };
  }, [openPresetDetail, presets]);

  const uploadPresetToR2 = async (p: CustomAppModule, mode: 'preview' | 'preset') => {
    if (!canUploadToR2) {
      onLog?.('warn', '仅管理员可上传预设到 R2', undefined);
      return;
    }
    setUploadingPresetActions((prev) => ({ ...prev, [p.id]: mode }));
    try {
      const latest = presets.find((x) => x.id === p.id) ?? p;
      const remotePreset = remotePresetItems.find((rp) => rp.preset.id === p.id)?.preset;
      const {
        previewImage: _omitPreviewImage,
        previewGeneratedImage: _omitPreviewGeneratedImage,
        previewOriginalImage: _omitPreviewOriginalImage,
        previewGeneratedThumbImage: _omitPreviewGeneratedThumbImage,
        previewOriginalThumbImage: _omitPreviewOriginalThumbImage,
        ...latestWithoutPreview
      } = latest as CustomAppModule & {
        previewImage?: string;
        previewGeneratedImage?: string;
        previewOriginalImage?: string;
        previewGeneratedThumbImage?: string;
        previewOriginalThumbImage?: string;
      };
      const remotePreviewFields = {
        ...(remotePreset?.previewImage ? { previewImage: remotePreset.previewImage } : {}),
        ...(remotePreset?.previewGeneratedImage ? { previewGeneratedImage: remotePreset.previewGeneratedImage } : {}),
        ...(remotePreset?.previewOriginalImage ? { previewOriginalImage: remotePreset.previewOriginalImage } : {}),
        ...(remotePreset?.previewGeneratedThumbImage ? { previewGeneratedThumbImage: remotePreset.previewGeneratedThumbImage } : {}),
        ...(remotePreset?.previewOriginalThumbImage ? { previewOriginalThumbImage: remotePreset.previewOriginalThumbImage } : {}),
      };

      let payload: CustomAppModule;
      if (mode === 'preview') {
        const originalRaw = testImage[p.id] || latest.previewOriginalImage;
        const generatedRaw =
          (testResult[p.id]?.ok ? testResult[p.id]?.resultImage : null) ||
          runtimePreviewImage[p.id] ||
          latest.previewGeneratedImage ||
          latest.previewImage;
        const originalThumbPreview = originalRaw
          ? await createThumbnailDataUrlFromAny(originalRaw, { maxSide: 640, targetBytes: 220 * 1024, qualities: [0.8, 0.72, 0.64] })
          : undefined;
        const generatedThumbPreview = generatedRaw
          ? await createThumbnailDataUrlFromAny(generatedRaw, { maxSide: 640, targetBytes: 220 * 1024, qualities: [0.8, 0.72, 0.64] })
          : undefined;
        const previewFields = {
          ...(generatedRaw ? { previewImage: generatedRaw, previewGeneratedImage: generatedRaw } : {}),
          ...(originalRaw ? { previewOriginalImage: originalRaw } : {}),
          ...(generatedThumbPreview ? { previewGeneratedThumbImage: generatedThumbPreview } : {}),
          ...(originalThumbPreview ? { previewOriginalThumbImage: originalThumbPreview } : {}),
        };
        payload = {
          ...(remotePreset ?? latestWithoutPreview),
          id: latest.id,
          label: latest.label,
          category: latest.category,
          enabled: latest.enabled,
          order: latest.order,
          ...previewFields,
        };
      } else {
        payload = {
          ...latestWithoutPreview,
          ...remotePreviewFields,
        };
      }
      const result = await publishPresetToUserR2Catalog({ preset: payload });
      onLog?.(
        'info',
        `${mode === 'preview' ? '已上传预览图到 R2' : '已上传预设到 R2'}：${p.label}`,
        `catalog objectKey: ${result.catalogObjectKey}`
      );
      await refreshCatalog();
      onLog?.('info', '已自动刷新远程能力列表', undefined);
    } catch (e) {
      onLog?.('error', `${mode === 'preview' ? '上传预览图失败' : '上传预设失败'}：${p.label}`, e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingPresetActions((prev) => ({ ...prev, [p.id]: undefined }));
    }
  };

  const handleFile = (presetId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setTestImage((prev) => ({ ...prev, [presetId]: dataUrl }));
      updatePresetPreviewImage(presetId, dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const openEditSet = (set: CapabilitySet) => {
    if (onOpenWorkflowComposer) {
      onOpenWorkflowComposer(set);
      return;
    }
    const id = uuid();
    setEmbedComposerSessions((prev) => [...prev, { id, initialSet: set, sessionKey: Date.now() }]);
    setEmbedComposerActiveId(id);
  };

  const closeEmbedComposerSession = useCallback((sessionId: string) => {
    setEmbedComposerSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      const wasActive = embedComposerActiveIdRef.current === sessionId;
      if (wasActive) {
        const nextActive = next[0]?.id ?? null;
        embedComposerActiveIdRef.current = nextActive;
        setEmbedComposerActiveId(nextActive);
      }
      return next;
    });
    setEmbedComposerMinimized((m) => {
      if (!(sessionId in m)) return m;
      const { [sessionId]: _, ...rest } = m;
      return rest;
    });
  }, []);

  const getEmbedComposerDockStackIndex = useCallback(
    (sessionId: string) => {
      const minimizedOrdered = embedComposerSessions.filter((s) => embedComposerMinimized[s.id]);
      const idx = minimizedOrdered.findIndex((s) => s.id === sessionId);
      if (idx >= 0) return idx;
      return minimizedOrdered.length;
    },
    [embedComposerSessions, embedComposerMinimized]
  );
  const getEmbedComposerDockStackCount = useCallback(
    (sessionId: string) => {
      const minimizedOrdered = embedComposerSessions.filter((s) => embedComposerMinimized[s.id]);
      if (embedComposerMinimized[sessionId]) {
        return Math.max(1, minimizedOrdered.length);
      }
      return Math.max(1, minimizedOrdered.length + 1);
    },
    [embedComposerSessions, embedComposerMinimized]
  );

  const handleSaveSet = (set: CapabilitySet) => {
    const next = sets.some((s) => s.id === set.id)
      ? sets.map((s) => (s.id === set.id ? set : s))
      : [...sets, set];
    onUpdateSets?.(next);
    onLog?.('info', `已保存能力集合：${set.label}`, undefined);
  };

  const removeSet = (id: string) => {
    onUpdateSets?.(sets.filter((s) => s.id !== id));
  };
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onColumnAdjust = (event: Event) => {
      const detail = (event as CustomEvent<{ delta?: number; value?: number }>).detail;
      const value = detail?.value;
      if (typeof value === 'number') {
        setPresetColumnCount(normalizeCapabilityPresetColumnCount(value));
        return;
      }
      const delta = Math.floor(Number(detail?.delta ?? 0));
      if (!Number.isFinite(delta) || delta === 0) return;
      setPresetColumnCount((n) => normalizeCapabilityPresetColumnCount(n + delta));
    };
    window.addEventListener('ac:capability-preset-column-count', onColumnAdjust as EventListener);
    return () => {
      window.removeEventListener('ac:capability-preset-column-count', onColumnAdjust as EventListener);
    };
  }, []);
  useEffect(() => {
    writeLocalJson(CAPABILITY_PRESET_COLUMNS_KEY, normalizeCapabilityPresetColumnCount(presetColumnCount));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('ac:capability-preset-column-count-changed', {
          detail: { value: normalizeCapabilityPresetColumnCount(presetColumnCount) },
        })
      );
    }
  }, [presetColumnCount]);

  const visiblePresets = useMemo(() => {
    const isBuiltinPipeline = (p: CustomAppModule) =>
      p.category === 'image_to_image' && getCapabilityEngine(p) === 'builtin';
    if (viewMode === 'image_process') return presets.filter(isBuiltinPipeline);
    return presets.filter((p) => {
      if (isBuiltinPipeline(p)) return false;
      if (presetTypeFilter === 'all') return true;
      return p.category === presetTypeFilter;
    });
  }, [presets, viewMode, presetTypeFilter]);

  const composeSearchKeywords = useMemo(
    () => (embeddedInWorkflow ? extractCapabilitySearchKeywords(workflowComposeSearchQuery) : []),
    [embeddedInWorkflow, workflowComposeSearchQuery]
  );

  const presetMatchesComposeSearch = useCallback(
    (mod: CustomAppModule) => {
      if (composeSearchKeywords.length === 0) return true;
      return keywordsMatchCapabilityModule(composeSearchKeywords, mod);
    },
    [composeSearchKeywords]
  );

  const displayPresets = useMemo(() => {
    if (composeSearchKeywords.length === 0) return visiblePresets;
    return visiblePresets.filter(presetMatchesComposeSearch);
  }, [visiblePresets, composeSearchKeywords, presetMatchesComposeSearch]);

  const displaySets = useMemo(() => {
    if (!embeddedInWorkflow || composeSearchKeywords.length === 0) return sets;
    return sets.filter((s) => keywordsMatchCapabilityLabelId(composeSearchKeywords, s.label, s.id));
  }, [sets, embeddedInWorkflow, composeSearchKeywords]);

  const displayUninstalledPresetItems = useMemo(() => {
    if (composeSearchKeywords.length === 0) return effectiveUninstalledPresetItems;
    return effectiveUninstalledPresetItems.filter((rp) => presetMatchesComposeSearch(rp.preset));
  }, [composeSearchKeywords, effectiveUninstalledPresetItems, presetMatchesComposeSearch]);

  useEffect(() => {
    if (!pendingScrollTarget) return;
    const target = pendingScrollTarget;
    const mode = viewMode;

    const scrollIntoPresetContentOnly = (targetEl: HTMLElement) => {
      const container = presetContentScrollRef.current;
      if (!container) return false;
      const top = targetEl.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top, behavior: 'smooth' });
      return true;
    };

    let cancelled = false;
    let timeoutId: number | undefined;

    const tryScroll = (attempt: number) => {
      if (cancelled) return;
      if (target.kind === 'preset' && (mode === 'presets' || mode === 'image_process')) {
        const el = presetCardRefs.current[target.id];
        if (el && scrollIntoPresetContentOnly(el)) {
          setPendingScrollTarget(null);
          return;
        }
        if (!el && attempt < 15) {
          timeoutId = window.setTimeout(() => tryScroll(attempt + 1), 48) as unknown as number;
        }
        return;
      }
      if (target.kind === 'set' && mode === 'sets') {
        const el = setCardRefs.current[target.id];
        if (el && scrollIntoPresetContentOnly(el)) {
          setPendingScrollTarget(null);
          return;
        }
        if (!el && attempt < 15) {
          timeoutId = window.setTimeout(() => tryScroll(attempt + 1), 48) as unknown as number;
        }
      }
    };

    const raf = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => tryScroll(0));
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [pendingScrollTarget, viewMode, visiblePresets, sets]);

  return (
    <div
      className={`flex flex-col gap-3 animate-in fade-in w-full min-h-0 ${embeddedInWorkflow ? 'h-full flex-1 overflow-hidden' : ''}`}
    >
      <div
        ref={(el) => {
          presetContentScrollRef.current = el;
          if (scrollContainerRef) {
            if (typeof scrollContainerRef === 'function') scrollContainerRef(el);
            else (scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          }
        }}
        className={`flex flex-col min-h-0 w-full overflow-y-auto no-scrollbar ${embeddedInWorkflow ? 'flex-1 max-w-none gap-4' : 'max-w-4xl mx-auto max-h-[calc(100dvh-12rem)] gap-6'}`}
        onWheelCapture={(e) => {
          const hasPresetDrag = (() => {
            if (typeof window === 'undefined') return false;
            try {
              return Boolean((window as Window & { __acDraggingPresetId?: string | null }).__acDraggingPresetId);
            } catch {
              return false;
            }
          })();
          const isDragging = Boolean(draggingPresetId) || hasPresetDrag;
          if (!isDragging) return;
          const dy = normalizeWheelDeltaY(e);
          if (!Number.isFinite(dy) || Math.abs(dy) < 0.1) return;
          e.preventDefault();
          e.stopPropagation();
          (e.currentTarget as HTMLDivElement).scrollTop += dy;
        }}
        onDragOverCapture={(e) => {
          autoScrollContainerOnDrag(e.currentTarget as HTMLElement, e.clientY);
        }}
      >
      {!embeddedInWorkflow && (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between w-full min-w-0">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
        <button
          type="button"
          onClick={() => setViewMode('presets')}
          className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase border ${viewMode === 'presets' ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300' : 'bg-white/[0.05] ring-1 ring-white/[0.06] text-gray-500 hover:bg-white/[0.09] border-transparent'}`}
        >
          基础能力预设
        </button>
        <button
          type="button"
          onClick={() => setViewMode('image_process')}
          className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase border ${viewMode === 'image_process' ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300' : 'bg-white/[0.05] ring-1 ring-white/[0.06] text-gray-500 hover:bg-white/[0.09] border-transparent'}`}
        >
          图像处理
        </button>
        <button
          type="button"
          onClick={() => setViewMode('sets')}
          className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase border ${viewMode === 'sets' ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300' : 'bg-white/[0.05] ring-1 ring-white/[0.06] text-gray-500 hover:bg-white/[0.09] border-transparent'}`}
        >
          能力集合
        </button>
        </div>
        <div className="flex items-center justify-end gap-2 flex-wrap w-full sm:w-auto sm:shrink-0 sm:ml-auto">
          <div className={TITLE_ROW_STEPPER_SHELL}>
            <button
              type="button"
              onClick={() => setPresetColumnCount((n) => Math.max(CAPABILITY_PRESET_COLUMNS_MIN, n - 1))}
              disabled={presetColumnCount <= CAPABILITY_PRESET_COLUMNS_MIN}
              className={TITLE_ROW_STEPPER_BTN}
              aria-label="减少能力预设列数"
            >
              −
            </button>
            <span className={TITLE_ROW_STEPPER_VALUE}>{presetColumnCount}</span>
            <button
              type="button"
              onClick={() => setPresetColumnCount((n) => Math.min(CAPABILITY_PRESET_COLUMNS_MAX, n + 1))}
              disabled={presetColumnCount >= CAPABILITY_PRESET_COLUMNS_MAX}
              className={TITLE_ROW_STEPPER_BTN}
              aria-label="增加能力预设列数"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              void triggerRemoteRefreshSync();
            }}
            disabled={catalogLoading || packContentsLoading || installingAll}
            className="px-4 py-2 rounded-xl bg-white/[0.06] ring-1 ring-white/[0.08] text-[10px] font-black uppercase hover:bg-white/[0.1] disabled:opacity-50"
          >
            {catalogLoading || packContentsLoading || installingAll ? '同步中…' : '刷新同步'}
          </button>
          {viewMode === 'presets' && (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="px-4 py-2 rounded-xl bg-blue-600 text-[10px] font-black uppercase hover:bg-blue-500"
            >
              新增能力
            </button>
          )}
        </div>
      </div>
      )}

      {viewMode === 'sets' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-[9px] text-gray-500">在画布中组合多个能力并连线，工作流中可整体使用。</p>
            {!embeddedInWorkflow && (
              <button
                type="button"
                onClick={openNewSet}
                className="px-4 py-2 rounded-xl bg-amber-600 text-[10px] font-black uppercase hover:bg-amber-500"
              >
                添加能力集合
              </button>
            )}
          </div>
          {sets.length === 0 ? (
            <div className="rounded-2xl bg-[#16161a] ring-1 ring-white/[0.07] p-8 text-center text-gray-500 text-[10px]">
              暂无能力集合，点击「添加能力集合」进入画布拖拽连线。
            </div>
          ) : displaySets.length === 0 ? (
            <div className="rounded-2xl bg-[#16161a] ring-1 ring-white/[0.07] p-8 text-center text-gray-500 text-[10px]">
              {composeSearchKeywords.length > 0
                ? '输入同步检索：无匹配的能力集合，可换关键词或清空底部输入框。'
                : '暂无可展示的能力集合。'}
            </div>
          ) : (
            <div
              className="[column-gap:0.75rem] [column-fill:_balance]"
              style={{ columnCount: presetMasonryColumnCount }}
            >
              {displaySets.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  ref={(el) => {
                    setCardRefs.current[s.id] = el;
                  }}
                  onClick={() => openEditSet(s)}
                  className="inline-block align-top mb-3 w-full break-inside-avoid rounded-2xl bg-[#16161a] ring-1 ring-white/[0.07] overflow-hidden text-left hover:ring-blue-400/40 transition-colors group"
                >
                  <div className="relative w-full bg-[#0f0f10] flex items-center justify-center min-h-[7rem]">
                    <div className="h-full w-full flex flex-col items-center justify-center gap-1 text-gray-600">
                      <AppIcon name="image" className="w-10 h-10 opacity-70" />
                      <span className="text-[8px] font-black uppercase tracking-wide text-gray-500">能力集合</span>
                    </div>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <div className="text-[10px] font-black text-white break-words line-clamp-2 leading-tight">{s.label}</div>
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                        <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-[#26262c]/95 text-gray-300">
                          组合流程
                        </span>
                        <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-[#1e3558]/95 text-blue-300">
                          可复用
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="p-2 border-t border-[#2a2a32] bg-[#141418] flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditSet(s);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#26262c] text-[9px] font-black uppercase hover:bg-[#383842]"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSet(s.id);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#4a1c1c] text-red-400 text-[9px] font-black uppercase hover:bg-[#5a2222]"
                    >
                      删除
                    </button>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {(viewMode === 'presets' || viewMode === 'image_process') && (
        <>
      {!embeddedInWorkflow && (
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[9px] text-gray-500">
          在此管理功能预设，工作流中的「功能区」将调用此处配置的项，拖拽图片到对应框即可执行。
        </p>
        <div className="flex gap-2 flex-wrap shrink-0">
          <button
            onClick={() => setShowImportExport((v) => !v)}
            className="px-4 py-2 rounded-xl bg-white/[0.06] ring-1 ring-white/[0.08] text-[10px] font-black uppercase hover:bg-white/[0.1]"
          >
            导入/导出
          </button>
        </div>
      </div>
      )}
      {catalogError && <div className="text-[10px] text-red-400 break-all">{catalogError}</div>}
      {packContentsLoading && <div className="text-[10px] text-gray-500">正在加载远程能力列表…</div>}

      {showImportExport && (
        <div className="rounded-2xl bg-[#16161a] ring-1 ring-white/[0.07] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[9px] font-black text-gray-300 uppercase">导入本地种子</div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={loadSeedFromLocal} className="px-3 py-1.5 rounded-lg bg-[#1e40af] text-[9px] font-black uppercase hover:bg-blue-500">
                从本地种子加载
              </button>
              <button onClick={() => exportSeedForRepo('both')} className="px-3 py-1.5 rounded-lg bg-[#92400e] text-[9px] font-black uppercase hover:bg-[#a86207]" title="下载 capability-presets.json / capability-sets.json 到本地">
                导出为本地种子
              </button>
              <button onClick={() => setShowImportExport(false)} className="px-3 py-1.5 rounded-lg bg-[#26262c] text-[9px] font-black uppercase hover:bg-[#383842]">
                关闭
              </button>
            </div>
          </div>
          <p className="text-[8px] text-gray-500">
            从本地种子加载：使用当前站点 public/capability-seed/ 中的默认种子。或将 capability-presets.json / capability-sets.json 拖入下方区域导入。
          </p>
          <div
            className={`min-h-[120px] rounded-xl border-2 border-dashed flex items-center justify-center transition-colors ${seedDropActive ? 'border-blue-500 bg-[#1a3354]' : 'border-[#3a3a40] bg-[#16161a]'}`}
            onDragOver={(e) => { e.preventDefault(); setSeedDropActive(true); }}
            onDragLeave={() => setSeedDropActive(false)}
            onDrop={handleSeedDrop}
          >
            <span className="text-[10px] text-gray-400">将 JSON 文件拖入此处（capability-presets.json 或 capability-sets.json）</span>
          </div>
        </div>
      )}

      {isAdding && (
        <div className="rounded-2xl border border-[#3b6fb8] bg-[#16161a] p-4 space-y-3">
          <div className="text-[9px] font-black text-blue-400 uppercase">新增</div>
          <div>
            <span className="text-[8px] font-black text-gray-500 uppercase">分类</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {CAPABILITY_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setNewCategory(c.id);
                    if (c.id === 'image_to_image') setNewEngine('gen_image');
                    if (c.id === 'text_to_text' || c.id === 'image_to_text') setNewEngine('gen_text');
                    if (c.id === 'text_to_image') setNewEngine('gen_image');
                  }}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${newCategory === c.id ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300' : 'bg-white/[0.05] ring-1 ring-white/[0.06] text-gray-500 hover:bg-white/[0.09] border-transparent'}`}
                  title={c.desc}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <p className="text-[8px] text-gray-600 mt-0.5">{CAPABILITY_CATEGORIES.find((c) => c.id === newCategory)?.desc}</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-[9px] text-gray-400">
              <input type="checkbox" checked={newEnabled} onChange={(e) => setNewEnabled(e.target.checked)} />
              <span className="font-black uppercase">启用</span>
            </label>
            {newCategory === 'image_to_image' && (
              <label className="flex items-center gap-2 text-[9px] text-gray-400">
                <span className="font-black uppercase">图生图方式</span>
                <CustomDropdown
                  options={[
                    { value: 'builtin', label: '内置图像处理（拆分/切割等）' },
                    { value: 'gen_image', label: '生图模型（提示词）' },
                  ]}
                  value={newEngine === 'gen_image' ? 'gen_image' : 'builtin'}
                  onChange={(v) => setNewEngine(v as CapabilityEngine)}
                  triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                />
              </label>
            )}
            {(newCategory === 'text_to_image' || (newCategory === 'image_to_image' && newEngine === 'gen_image')) && (
              <>
                <label className="flex items-center gap-2 text-[9px] text-gray-400">
                  <span className="font-black uppercase">生图档位</span>
                  <CustomDropdown
                    options={effectiveGearRows.map((g) => ({
                      value: g.id,
                      label: g.label,
                      disabled: g.disabled,
                      title: g.disabledReason,
                    }))}
                    value={newImageGear}
                    onChange={(v) => setNewImageGear(v as DialogImageGear)}
                    triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                  />
                </label>
                <label className="flex items-center gap-2 text-[9px] text-gray-400">
                  <span className="font-black uppercase">贴图比例</span>
                  <CustomDropdown
                    options={[{ value: '', label: '默认' }, ...SUPPORTED_ASPECT_RATIOS.map((r) => ({ value: r.value, label: r.label }))]}
                    value={newImageAspectRatio}
                    onChange={setNewImageAspectRatio}
                    placeholder="默认"
                    triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                  />
                </label>
                <label className="flex items-center gap-2 text-[9px] text-gray-400">
                  <span className="font-black uppercase">贴图尺寸</span>
                  <CustomDropdown
                    options={[{ value: '', label: '默认' }, ...SUPPORTED_IMAGE_SIZES.map((s) => ({ value: s.value, label: s.label }))]}
                    value={newImageSize}
                    onChange={setNewImageSize}
                    placeholder="默认"
                    triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                  />
                </label>
                <label className="flex items-center gap-2 text-[9px] text-gray-400 cursor-pointer" title="勾选：先由文字模型理解预设提示词再生成生图提示词；不勾选：预设提示词直发生图模型">
                  <input
                    type="checkbox"
                    checked={!newSkipUnderstand}
                    onChange={(e) => setNewSkipUnderstand(!e.target.checked)}
                  />
                  <span className="font-black uppercase">理解</span>
                </label>
              </>
            )}
            {newCategory === 'text_to_text' && (
              <span className="text-[8px] text-gray-500">工作流请拖入文字卡</span>
            )}
            {newCategory === 'text_to_image' && (
              <span className="text-[8px] text-gray-500">工作流请拖入文字卡</span>
            )}
            {newCategory === 'image_to_text' && (
              <span className="text-[8px] text-gray-500">工作流请拖入图片卡</span>
            )}
            {newCategory === 'image_to_image' && newEngine === 'gen_image' && (
              <span className="text-[8px] text-gray-500">工作流请拖入图片卡</span>
            )}
            {newCategory === 'image_to_image' && newEngine === 'builtin' && (
              <span className="text-[8px] text-gray-500">工作流请拖入图片卡（内置处理）</span>
            )}
            {newCategory === 'generate_video' && (
              <span className="text-[8px] text-gray-500">工作流请拖入文字卡或图片卡（或两者）</span>
            )}
          </div>
          <div>
            <span className="text-[8px] font-black text-gray-500 uppercase">功能名称</span>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={
                newCategory === 'image_to_image' && newEngine === 'gen_image'
                  ? '如：转赛博朋克风格、生成多视角、写实化'
                  : newCategory === 'text_to_text'
                    ? '如：扩写脚本、翻译、提取关键词'
                    : newCategory === 'image_to_text'
                      ? '如：描述附图中的主要物体与风格'
                      : newCategory === 'text_to_image'
                        ? '如：按描述生成概念图'
                        : newCategory === 'image_to_image' && newEngine === 'builtin'
                          ? '如：拆分组件、切割图片、提取主体'
                          : '如：手办白模、低面数模型'
              }
              className="mt-1 w-full bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl px-3 py-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
            />
          </div>
          {newCategory === 'generate_video' && (
            <div>
              <span className="text-[8px] font-black text-cyan-400/90 uppercase">生视频 · 预设说明</span>
              <p className="text-[8px] text-gray-500 mt-0.5">
                需构建变量 <code className="text-gray-400">VITE_WORKFLOW_VIDEO_API_URL</code>。可拖文字卡、图片卡或两者；有图时与对话生图一致可先「理解」再请求桥。
              </p>
              <label className="mt-1 flex items-center gap-2 text-[9px] text-gray-400 cursor-pointer" title="勾选：先由文字模型理解预设与画面，再 POST 生视频桥">
                <input
                  type="checkbox"
                  checked={!newSkipUnderstand}
                  onChange={(e) => setNewSkipUnderstand(!e.target.checked)}
                />
                <span className="font-black uppercase">理解</span>
              </label>
              <textarea
                value={newInstruction}
                onChange={(e) => setNewInstruction(e.target.value)}
                placeholder="如：电影感城市夜景，镜头缓慢推进，霓虹反射在雨后路面"
                rows={4}
                className="mt-1 w-full resize-none rounded-xl bg-white/[0.05] px-3 py-2 text-[11px] ring-1 ring-cyan-900/35 outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/45"
              />
            </div>
          )}
          {(newCategory === 'text_to_image' || (newCategory === 'image_to_image' && newEngine === 'gen_image')) && (
            <div>
              <span className="text-[8px] font-black text-blue-400/90 uppercase">预设提示词（必填）</span>
              <p className="text-[8px] text-gray-500 mt-0.5">
                {newCategory === 'text_to_image'
                  ? newSkipUnderstand
                    ? '工作流拖文字卡：将预设与用户文字合并后直发生图模型。'
                    : '工作流拖文字卡：先由文字模型整理画面描述，再文生图。'
                  : newSkipUnderstand
                    ? '工作流拖图片卡：将此处提示词直发生图模型（图生图）。'
                    : '工作流拖图片卡：先理解预设与图像再图生图。'}
              </p>
              <textarea
                value={newInstruction}
                onChange={(e) => setNewInstruction(e.target.value)}
                placeholder={
                  newCategory === 'text_to_image'
                    ? '如：根据用户描述生成赛博朋克街景'
                    : '如：将图片转为赛博朋克风格'
                }
                rows={4}
                className="mt-1 w-full resize-none rounded-xl bg-white/[0.05] px-3 py-2 text-[11px] ring-1 ring-blue-500/30 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              />
            </div>
          )}
          {(newCategory === 'text_to_text' || newCategory === 'image_to_text') && (
            <div>
              <span className="text-[8px] font-black text-emerald-400/90 uppercase">系统说明 / 任务（必填）</span>
              <p className="text-[8px] text-gray-500 mt-0.5">
                {newCategory === 'text_to_text'
                  ? '工作流拖入文字卡时，卡片正文作为用户输入。'
                  : '工作流拖入图片卡时，以附图配合本说明输出文字。'}
              </p>
              <textarea
                value={newInstruction}
                onChange={(e) => setNewInstruction(e.target.value)}
                placeholder={
                  newCategory === 'text_to_text'
                    ? '如：将用户文字翻译为英文并保留术语'
                    : '如：描述附图中的主要物体与风格'
                }
                rows={4}
                className="mt-1 w-full rounded-xl bg-white/[0.05] px-3 py-2 text-[11px] ring-1 ring-emerald-900/35 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/45 resize-none"
              />
              {newCategory === 'text_to_text' ? (
                <label className="mt-2 flex items-center gap-2 text-[9px] text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newRequirePromptOnTextDrop}
                    onChange={(e) => setNewRequirePromptOnTextDrop(e.target.checked)}
                  />
                  <span className="font-black uppercase">拖拽时要求输入临时提示词</span>
                </label>
              ) : null}
            </div>
          )}
          {newCategory === 'image_to_image' && newEngine === 'builtin' && (
            <div>
              <span className="text-[8px] font-black text-gray-500 uppercase">可选：补充说明或约束</span>
              <p className="text-[8px] text-gray-600 mt-0.5">多数能力有内置逻辑（如切割按版面分块），可留空；需要时可填写额外说明。</p>
              <textarea value={newInstruction} onChange={(e) => setNewInstruction(e.target.value)} placeholder="留空即使用内置逻辑；或填写如：只保留上半部分、排除背景" rows={2} className="mt-1 w-full bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl px-3 py-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 resize-none" />
            </div>
          )}
          {newCategory !== 'generate_3d' && newCategory !== 'generate_video' && (
            <div className="rounded-xl border border-emerald-900/40 bg-black/20 p-3 space-y-2">
              <div className="text-[8px] font-black text-emerald-300/90 uppercase">本机伴侣 · 宿主包（可选）</div>
              <p className="text-[8px] text-gray-500 leading-snug">
                填写目录名后，本预设会向本机伴侣提交 host_bundle 任务；留空则不走宿主包。
              </p>
              <label className="block">
                <span className="text-[9px] text-gray-500 uppercase">插件目录名</span>
                <input
                  value={newCompanionHostBundleDir}
                  onChange={(e) => setNewCompanionHostBundleDir(e.target.value)}
                  placeholder="host-bundles 下文件夹名"
                  className="mt-0.5 w-full bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl px-3 py-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/45"
                />
              </label>
              <label className="flex items-center gap-2 text-[9px] text-gray-400">
                <span className="font-black uppercase">阶段</span>
                <CustomDropdown
                  options={[
                    { value: 'exec', label: 'exec（执行）' },
                    { value: 'probe', label: 'probe（校验）' },
                  ]}
                  value={newCompanionHostBundlePhase}
                  onChange={(v) => setNewCompanionHostBundlePhase(v === 'probe' ? 'probe' : 'exec')}
                  triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                />
              </label>
            </div>
          )}
          {newCategory === 'generate_3d' && (
            <>
              <div className="rounded-xl border border-[#d97706] bg-[#221c10] p-3 space-y-2">
                <div className="text-[8px] font-black text-amber-400 uppercase">生成3D 预设（工作流拖图即按此配置提交）</div>
                <div className="flex gap-2 flex-wrap">
                  <label className="flex items-center gap-1.5 text-[9px]">
                    <span>服务商</span>
                    <CustomDropdown
                      options={[{ value: 'tripo', label: 'Tripo' }, { value: 'tencent', label: '腾讯(兼容)' }]}
                      value={newGenerate3D.provider ?? 'tripo'}
                      onChange={(v) => setNewGenerate3D((g) => ({ ...g, provider: v as 'tripo' | 'tencent' }))}
                      triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                    />
                  </label>
                  {newGenerate3D.provider !== 'tencent' && (
                    <>
                      <div className="w-full mt-1 rounded-lg border border-white/[0.08] bg-black/20 p-2 space-y-1.5">
                        <div className="text-[8px] font-black text-cyan-300 uppercase">标准参数</div>
                        <div className="text-[8px] text-gray-500">影响主结果质量与基础风格，建议优先配置。</div>
                        <div className="flex gap-2 flex-wrap">
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <span>任务</span>
                            <CustomDropdown
                              options={[{ value: 'image_to_model', label: '图生3D' }, { value: 'text_to_model', label: '文生3D' }]}
                              value={newGenerate3D.tripoTaskType ?? 'image_to_model'}
                              onChange={(v) => setNewGenerate3D((g) => ({ ...g, tripoTaskType: v as 'text_to_model' | 'image_to_model' }))}
                              triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                            />
                          </label>
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <span>版本</span>
                            <CustomDropdown
                              options={TRIPO_MODEL_VERSION_OPTIONS.map((x) => ({ value: x.value, label: x.label }))}
                              value={newGenerate3D.tripoModelVersion ?? ''}
                              onChange={(v) => setNewGenerate3D((g) => ({ ...g, tripoModelVersion: v || undefined }))}
                              triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                            />
                          </label>
                          <label className={`flex items-center gap-1.5 text-[9px] ${!newIsTripoV3Line ? 'opacity-45' : ''}`}>
                            <span>几何质量</span>
                            <CustomDropdown
                              options={[{ value: '', label: '自动（不指定）' }, { value: 'standard', label: 'standard' }, { value: 'detailed', label: 'detailed' }]}
                              value={newGenerate3D.tripoGeometryQuality ?? ''}
                              onChange={(v) => setNewGenerate3D((g) => ({ ...g, tripoGeometryQuality: (v || undefined) as 'standard' | 'detailed' | undefined }))}
                              triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                              disabled={!newIsTripoV3Line}
                            />
                          </label>
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <span>纹理质量</span>
                            <CustomDropdown
                              options={[{ value: 'standard', label: 'standard' }, { value: 'detailed', label: 'detailed' }]}
                              value={newGenerate3D.tripoTextureQuality ?? 'standard'}
                              onChange={(v) => setNewGenerate3D((g) => ({ ...g, tripoTextureQuality: v as 'standard' | 'detailed' }))}
                              triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                            />
                          </label>
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <span>面数上限</span>
                            <input
                              type="number"
                              min={500}
                              max={500000}
                              value={newGenerate3D.tripoFaceLimit ?? 100000}
                              onChange={(e) => setNewGenerate3D((g) => ({ ...g, tripoFaceLimit: e.target.value ? parseInt(e.target.value, 10) : undefined }))}
                              className="w-24 rounded bg-white/[0.06] px-2 py-1 text-[9px] ring-1 ring-white/[0.08]"
                            />
                          </label>
                        </div>
                      </div>
                      <div className="w-full rounded-lg border border-white/[0.08] bg-black/20 p-2 space-y-1.5">
                        <div className="text-[8px] font-black text-fuchsia-300 uppercase">额外功能</div>
                        <div className="text-[8px] text-gray-500">附加能力与高级开关，可能影响耗时与计费。</div>
                        <div className="flex gap-2 flex-wrap">
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <input
                              type="checkbox"
                              checked={newGenerate3D.tripoTexture ?? true}
                              onChange={(e) => setNewGenerate3D((g) => ({ ...g, tripoTexture: e.target.checked }))}
                              disabled={newTripoGenerateParts}
                            />
                            <span>纹理</span>
                          </label>
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <input
                              type="checkbox"
                              checked={newGenerate3D.tripoPbr ?? true}
                              onChange={(e) => setNewGenerate3D((g) => ({ ...g, tripoPbr: e.target.checked }))}
                              disabled={newTripoGenerateParts}
                            />
                            <span>PBR</span>
                          </label>
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <input
                              type="checkbox"
                              checked={newGenerate3D.tripoQuad ?? false}
                              onChange={(e) => setNewGenerate3D((g) => ({ ...g, tripoQuad: e.target.checked }))}
                              disabled={newTripoGenerateParts}
                            />
                            <span>Quad</span>
                          </label>
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <input type="checkbox" checked={newGenerate3D.tripoSmartLowPoly ?? false} onChange={(e) => setNewGenerate3D((g) => ({ ...g, tripoSmartLowPoly: e.target.checked }))} />
                            <span>低模</span>
                          </label>
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <input
                              type="checkbox"
                              checked={newGenerate3D.tripoGenerateParts ?? false}
                              onChange={(e) => setNewGenerate3D((g) => ({ ...g, tripoGenerateParts: e.target.checked }))}
                              disabled={newTripoTextureEnabled || newTripoPbrEnabled}
                            />
                            <span>分部件</span>
                          </label>
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <input type="checkbox" checked={newGenerate3D.tripoEnableImageAutofix ?? false} onChange={(e) => setNewGenerate3D((g) => ({ ...g, tripoEnableImageAutofix: e.target.checked }))} />
                            <span>输入图自动修复</span>
                          </label>
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <input type="checkbox" checked={newGenerate3D.tripoAutoSize ?? false} onChange={(e) => setNewGenerate3D((g) => ({ ...g, tripoAutoSize: e.target.checked }))} />
                            <span>自动尺寸</span>
                          </label>
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <input type="checkbox" checked={newGenerate3D.tripoExportUv ?? true} onChange={(e) => setNewGenerate3D((g) => ({ ...g, tripoExportUv: e.target.checked }))} />
                            <span>导出UV</span>
                          </label>
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <input type="checkbox" checked={(newGenerate3D.tripoCompress ?? undefined) === 'geometry'} onChange={(e) => setNewGenerate3D((g) => ({ ...g, tripoCompress: e.target.checked ? 'geometry' : undefined }))} />
                            <span>几何压缩</span>
                          </label>
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <span>纹理对齐</span>
                            <CustomDropdown
                              options={[{ value: '', label: '默认' }, { value: 'original_image', label: 'original_image' }, { value: 'geometry', label: 'geometry' }]}
                              value={newGenerate3D.tripoTextureAlignment ?? ''}
                              onChange={(v) => setNewGenerate3D((g) => ({ ...g, tripoTextureAlignment: (v || undefined) as 'original_image' | 'geometry' | undefined }))}
                              triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                            />
                          </label>
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <span>朝向</span>
                            <CustomDropdown
                              options={[{ value: '', label: '默认' }, { value: 'default', label: 'default' }, { value: 'align_image', label: 'align_image' }]}
                              value={newGenerate3D.tripoOrientation ?? ''}
                              onChange={(v) => setNewGenerate3D((g) => ({ ...g, tripoOrientation: (v || undefined) as 'default' | 'align_image' | undefined }))}
                              triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                            />
                          </label>
                        </div>
                      </div>
                      {(newTripoTextureEnabled || newTripoPbrEnabled) && (
                        <div className="w-full text-[8px] text-amber-300">
                          「分部件」与「纹理/PBR」互斥：请先关闭纹理和 PBR。
                        </div>
                      )}
                      {newTripoGenerateParts && (
                        <div className="w-full text-[8px] text-amber-300">
                          已开启分部件：Quad、纹理、PBR 已禁用。
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div>
                <span className="text-[8px] font-black text-gray-500 uppercase">可选：提示词补充 / 负向提示词</span>
                <textarea
                  value={newInstruction}
                  onChange={(e) => setNewInstruction(e.target.value)}
                  placeholder="正向提示词补充。文生3D未提供文字卡时，会以此作为默认 prompt。"
                  rows={1}
                  className="mt-1 w-full bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl px-3 py-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 resize-none"
                />
                <input
                  value={newGenerate3D.tripoNegativePrompt ?? ''}
                  onChange={(e) => setNewGenerate3D((g) => ({ ...g, tripoNegativePrompt: e.target.value }))}
                  placeholder="Negative Prompt（可选）"
                  className="mt-2 w-full rounded-xl bg-white/[0.05] px-3 py-2 text-[11px] ring-1 ring-white/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                />
              </div>
            </>
          )}
          <div className="flex gap-2">
            <button onClick={addPreset} className="px-4 py-2 rounded-xl bg-blue-600 text-[10px] font-black uppercase">
              添加
            </button>
            <button onClick={() => { setIsAdding(false); setNewLabel(''); setNewInstruction(''); setNewSkipUnderstand(false); }} className="px-4 py-2 rounded-xl bg-[#26262c] text-[10px] font-black uppercase">
              取消
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {displayPresets.length === 0 && displayUninstalledPresetItems.length === 0 ? (
          <div className="rounded-2xl bg-[#16161a] ring-1 ring-white/[0.07] p-8 text-center text-gray-500 text-[10px]">
            {composeSearchKeywords.length > 0 && (visiblePresets.length > 0 || effectiveUninstalledPresetItems.length > 0) ? (
              <>输入同步检索：无匹配项，可换关键词或清空底部输入框。</>
            ) : viewMode === 'image_process' ? (
              '暂无图像处理能力。'
            ) : (
              '暂无基础能力预设，点击「新增能力」添加；远程能力加载后将显示在下方。'
            )}
          </div>
        ) : (
          <>
            <div
              className="[column-gap:0.75rem] [column-fill:_balance]"
              style={{ columnCount: presetMasonryColumnCount }}
            >
              {displayPresets.map((p) => {
                const src = getCardPreviewSrc(p);
                const categoryLabel = CAPABILITY_CATEGORIES.find((c) => c.id === p.category)?.label ?? p.category;
                const iconName =
                  p.category === 'generate_3d' ? 'cube' : p.category === 'generate_video' ? 'video' : isBuiltinImagePipelinePreset(p) ? 'camera' : 'image';
                const isTextToTextPreset = p.category === 'text_to_text';
                const isDraggingThis = draggingPresetId === p.id;
                const dimPresetBySidebar =
                  !isDraggingThis &&
                  Boolean(sidebarLinkHoverPresetIdSet && !sidebarLinkHoverPresetIdSet.has(p.id));
                return (
                  <button
                    key={p.id}
                    type="button"
                    draggable={embeddedInWorkflow}
                    onDragStart={
                      embeddedInWorkflow
                        ? (e) => {
                            e.stopPropagation();
                            setDraggingPresetId(p.id);
                            setGlobalDraggingPresetId(p.id);
                            try {
                              e.dataTransfer.setData(DT_AC_CAPABILITY_FROM_EDITOR, p.id);
                              e.dataTransfer.setData('text/plain', p.id);
                              e.dataTransfer.effectAllowed = 'copy';
                            } catch {
                              /* ignore */
                            }
                            applyPresetDragImage(e, p);
                          }
                        : undefined
                    }
                    onDragEnd={
                      embeddedInWorkflow
                        ? () => {
                            setDraggingPresetId((prev) => (prev === p.id ? null : prev));
                            setGlobalDraggingPresetId(null);
                            clearPresetDragPreview();
                          }
                        : undefined
                    }
                    ref={(el) => {
                      presetCardRefs.current[p.id] = el;
                    }}
                    onClick={() => openPresetDetail(p)}
                    onMouseMove={(e) => {
                      if (!getGeneratedPreviewThumbSrc(p) || !getOriginalPreviewThumbSrc(p)) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      if (!rect.width) return;
                      const ratio = (e.clientX - rect.left) / rect.width;
                      const clamped = Math.max(0.1, Math.min(0.9, ratio));
                      setPreviewSplitRatio((prev) => ({ ...prev, [p.id]: clamped }));
                    }}
                    onMouseLeave={() => {
                      if (!getGeneratedPreviewThumbSrc(p) || !getOriginalPreviewThumbSrc(p)) return;
                      setPreviewSplitRatio((prev) => ({ ...prev, [p.id]: 0.5 }));
                    }}
                    className={`inline-block align-top mb-3 w-full break-inside-avoid rounded-2xl border bg-[#16161a] overflow-hidden text-left transition-[colors,opacity,filter] duration-150 group ${
                      draggingPresetId === p.id
                        ? 'border-blue-500/70 ring-1 ring-blue-500/40 opacity-70'
                        : dimPresetBySidebar
                          ? 'ring-1 ring-white/[0.08] border-transparent opacity-[0.32] saturate-[0.72]'
                          : 'ring-1 ring-white/[0.08] hover:ring-blue-400/40 border-transparent'
                    }`}
                  >
                    {isTextToTextPreset ? (
                      <div className="p-2.5 min-h-[4.5rem] flex flex-col justify-between gap-1.5">
                        <div className="text-[10px] font-black text-white break-words line-clamp-2 leading-tight">{p.label}</div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-[#26262c]/95 text-gray-300">{categoryLabel}</span>
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${p.enabled === false ? 'bg-[#4a1c1c]/95 text-red-300' : 'bg-[#166534]/95 text-green-300'}`}>
                            {p.enabled === false ? '禁用' : '启用'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="relative w-full bg-[#0f0f10] flex justify-center"
                        style={{ aspectRatio: `${cardAspectByPresetId[p.id] ?? 1}` }}
                      >
                        {(() => {
                          const originalThumb = getOriginalPreviewThumbSrc(p);
                          const generatedThumb = getGeneratedPreviewThumbSrc(p);
                          if (originalThumb && generatedThumb) {
                            const split = previewSplitRatio[p.id] ?? 0.5;
                            const splitPct = split * 100;
                            const slant = 4;
                            const topCut = Math.max(0, Math.min(100, splitPct + slant));
                            const bottomCut = Math.max(0, Math.min(100, splitPct - slant));
                            const lineTopLeft = Math.max(0, Math.min(100, topCut - 0.35));
                            const lineTopRight = Math.max(0, Math.min(100, topCut + 0.35));
                            const lineBottomLeft = Math.max(0, Math.min(100, bottomCut - 0.35));
                            const lineBottomRight = Math.max(0, Math.min(100, bottomCut + 0.35));
                            return (
                              <>
                                <CapabilityPreviewImg
                                  src={originalThumb}
                                  alt=""
                                  className="absolute inset-0 h-full w-full min-h-[5rem] object-contain"
                                  onIntrinsicSize={(w, h) => onPresetCardIntrinsicSize(p.id, w, h)}
                                />
                                <CapabilityPreviewImg
                                  src={generatedThumb}
                                  alt=""
                                  className="absolute inset-0 h-full w-full min-h-[5rem] object-contain"
                                  onIntrinsicSize={(w, h) => onPresetCardIntrinsicSize(p.id, w, h)}
                                  style={{ clipPath: `polygon(${topCut}% 0%, 100% 0%, 100% 100%, ${bottomCut}% 100%)` }}
                                />
                                <div
                                  className="absolute inset-0 pointer-events-none"
                                  style={{
                                    clipPath: `polygon(${lineTopLeft}% 0%, ${lineTopRight}% 0%, ${lineBottomRight}% 100%, ${lineBottomLeft}% 100%)`,
                                    background: 'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(191,219,254,0.92) 50%, rgba(255,255,255,0.78) 100%)',
                                    boxShadow: '0 0 10px rgba(59,130,246,0.35)',
                                  }}
                                />
                              </>
                            );
                          }
                          if (src) {
                            return (
                              <CapabilityPreviewImg
                                src={src}
                                alt=""
                                className="h-full w-full min-h-[5rem] object-contain"
                                onIntrinsicSize={(w, h) => onPresetCardIntrinsicSize(p.id, w, h)}
                              />
                            );
                          }
                          return (
                            <div className="h-full min-h-[5rem] w-full flex flex-col items-center justify-center gap-1 text-gray-600">
                              <AppIcon name={iconName} className="w-10 h-10 opacity-75" />
                              <span className="text-[8px] font-black uppercase tracking-wide text-gray-500">预览</span>
                            </div>
                          );
                        })()}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                          <div className="text-[10px] font-black text-white break-words line-clamp-2 leading-tight">{p.label}</div>
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-[#26262c]/95 text-gray-300">{categoryLabel}</span>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${p.enabled === false ? 'bg-[#4a1c1c]/95 text-red-300' : 'bg-[#166534]/95 text-green-300'}`}>
                              {p.enabled === false ? '禁用' : '启用'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {displayUninstalledPresetItems.length > 0 && (
              <div className="rounded-2xl bg-[#16161a] ring-1 ring-white/[0.07] p-4 text-[9px] text-gray-400">
                检测到 {displayUninstalledPresetItems.length} 条远程预设，点击上方「刷新同步」即可自动同步。
              </div>
            )}
          </>
        )}
      </div>

      {detailPreset && (
        <ImagePreviewOverlay
          open
          resetKey={`capability-preset:${detailPreset.id}`}
          imageSrc={detailHasCompare ? undefined : (detailMainPreview || undefined)}
          centerSlot={
            detailHasCompare ? (
              <div
                className="relative w-[min(80rem,calc(100vw-3rem))] max-w-[calc(100vw-3rem)] h-[min(82vh,860px)] rounded-2xl overflow-hidden shadow-2xl bg-transparent"
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (!rect.width) return;
                  const ratio = (e.clientX - rect.left) / rect.width;
                  setLightboxSplitRatio(Math.max(0.05, Math.min(0.95, ratio)));
                }}
                onMouseLeave={() => setLightboxSplitRatio(0.5)}
              >
                {(() => {
                  const splitPct = lightboxSplitRatio * 100;
                  const slant = 4;
                  const topCut = Math.max(0, Math.min(100, splitPct + slant));
                  const bottomCut = Math.max(0, Math.min(100, splitPct - slant));
                  const lineTopLeft = Math.max(0, Math.min(100, topCut - 0.25));
                  const lineTopRight = Math.max(0, Math.min(100, topCut + 0.25));
                  const lineBottomLeft = Math.max(0, Math.min(100, bottomCut - 0.25));
                  const lineBottomRight = Math.max(0, Math.min(100, bottomCut + 0.25));
                  return (
                    <>
                      <CapabilityPreviewImg src={detailOriginalPreview} alt="原图" className="absolute inset-0 h-full w-full object-contain" />
                      <CapabilityPreviewImg
                        src={detailGeneratedPreview}
                        alt="生成图"
                        className="absolute inset-0 h-full w-full object-contain"
                        style={{ clipPath: `polygon(${topCut}% 0%, 100% 0%, 100% 100%, ${bottomCut}% 100%)` }}
                      />
                      <div
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          clipPath: `polygon(${lineTopLeft}% 0%, ${lineTopRight}% 0%, ${lineBottomRight}% 100%, ${lineBottomLeft}% 100%)`,
                          background: 'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(191,219,254,0.92) 50%, rgba(255,255,255,0.78) 100%)',
                          boxShadow: '0 0 10px rgba(59,130,246,0.35)',
                        }}
                      />
                    </>
                  );
                })()}
              </div>
            ) : detailMainPreview ? undefined : (
              <div className="w-[min(80rem,calc(100vw-3rem))] max-w-[calc(100vw-3rem)] h-[min(82vh,860px)] rounded-2xl border border-white/10 bg-[#0f0f12]/98 flex items-center justify-center text-gray-500 text-[10px]">
                暂无预览图
              </div>
            )
          }
          onClose={() => setDetailPresetId(null)}
          wheelListLength={1}
          onWheelNavigate={() => {}}
          enablePanoramaMode={!detailHasCompare && Boolean(detailMainPreview)}
          shellZIndexClassName="z-[10000]"
          contentRightInset="min(24rem,30vw)"
        >
          <div
            className="absolute top-16 right-4 z-[9] w-[min(24rem,30vw)] max-h-[72vh]"
            data-image-preview-no-wheel
            data-image-preview-scroll
          >
            <div className="max-h-[72vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0f0f12]/98 p-3 md:p-4 space-y-3 shadow-xl backdrop-blur-[2px]" data-image-preview-scroll>
              <div className="rounded-2xl bg-[#16161a] ring-1 ring-white/[0.07] p-3 space-y-2">
                <div className="text-[9px] text-gray-500 uppercase tracking-wide">能力预览</div>
                <div className="text-[14px] font-black text-white break-words line-clamp-2 leading-tight">{detailPreset.label}</div>
                <div className="text-[9px] text-gray-500">左侧预览对比，右侧参数与操作</div>
              </div>
              <div className="rounded-2xl bg-[#16161a] ring-1 ring-white/[0.07] p-3 space-y-2">
                    {detailEditMode ? (
                      editingId === 'cut_image' ? (
                        <>
                          <div className="text-[9px] text-blue-300/95 font-black uppercase">内置 · 切割图片</div>
                          <label className="flex items-center gap-2 text-[10px] text-gray-300">
                            <input type="checkbox" checked={editEnabled} onChange={(e) => setEditEnabled(e.target.checked)} />
                            启用
                          </label>
                          <label className="block">
                            <div className="text-[9px] text-gray-500 uppercase mb-1">功能名称</div>
                            <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="w-full bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl px-3 py-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50" />
                          </label>
                          {/* 切割模式选择 */}
                          <div className="space-y-1.5">
                            <div className="text-[9px] text-gray-400 uppercase">切割方式</div>
                            <div className="flex gap-1.5">
                              {([
                                { value: 'uniform', label: '均匀' },
                                { value: 'auto', label: '自动' },
                                { value: 'vision', label: '视觉' },
                              ] as const).map((mode) => (
                                <button
                                  key={mode.value}
                                  type="button"
                                  onClick={() => setEditCutMode(mode.value)}
                                  className={`flex-1 px-2 py-1.5 rounded-lg text-[9px] font-black uppercase border transition-colors ${
                                    editCutMode === mode.value
                                      ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300'
                                      : 'bg-white/[0.05] ring-1 ring-white/[0.06] text-gray-500 hover:bg-white/[0.09] border-transparent'
                                  }`}
                                  title={
                                    mode.value === 'uniform' ? '按行列数等分图片' :
                                    mode.value === 'auto' ? '自动检测宫格缝隙' :
                                    '调用视觉模型识别'
                                  }
                                >
                                  {mode.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          {/* 均匀分割配置 */}
                          {editCutMode === 'uniform' && (
                            <div className="flex gap-2 items-center">
                              <label className="flex items-center gap-1.5">
                                <span className="text-[9px] text-gray-500 uppercase">行</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={10}
                                  value={editUniformRows}
                                  onChange={(e) => setEditUniformRows(Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 2))))}
                                  className="w-14 bg-white/[0.05] ring-1 ring-white/[0.06] rounded-lg px-2 py-1.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                                />
                              </label>
                              <label className="flex items-center gap-1.5">
                                <span className="text-[9px] text-gray-500 uppercase">列</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={10}
                                  value={editUniformCols}
                                  onChange={(e) => setEditUniformCols(Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 2))))}
                                  className="w-14 bg-white/[0.05] ring-1 ring-white/[0.06] rounded-lg px-2 py-1.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                                />
                              </label>
                            </div>
                          )}
                          {editCutMode !== 'uniform' && (
                            <div className="text-[8px] text-gray-600 italic">
                              {editCutMode === 'auto' ? '自动检测宫格缝隙，支持有明显分割线的图片' : '调用 Gemini 视觉模型识别区域，精度高但较慢'}
                            </div>
                          )}
                          <label className="block">
                            <div className="text-[9px] text-gray-400 uppercase mb-1">切割溢出（每边像素）</div>
                            <input
                              type="number"
                              min={0}
                              max={512}
                              step={1}
                              value={editCutOverflowPx}
                              onChange={(e) => setEditCutOverflowPx(Math.max(0, Math.min(512, Math.round(Number(e.target.value) || 0))))}
                              className="w-28 bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl px-3 py-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                            />
                          </label>
                          <label className="block">
                            <div className="text-[9px] text-gray-500 uppercase mb-1">补充说明</div>
                            <textarea value={editInstruction} onChange={(e) => setEditInstruction(e.target.value)} rows={4} className="w-full bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl px-3 py-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 resize-y" />
                          </label>
                          <div className="flex gap-2">
                            <button type="button" onClick={saveDetailEdit} className="px-3 py-1.5 rounded-lg border border-[#36578f] bg-[#1d3154] text-blue-200 text-[9px] font-black uppercase hover:bg-[#264171]">保存</button>
                            <button type="button" onClick={() => { setDetailEditMode(false); setEditingId(null); }} className="px-3 py-1.5 rounded-lg bg-[#121214] text-[9px] font-black uppercase text-gray-200 ring-1 ring-white/[0.08] hover:bg-white/[0.06]">取消</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-[9px] text-gray-500 uppercase">完整设置</div>
                          <div className="flex flex-wrap gap-2">
                            {CAPABILITY_CATEGORIES.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setEditCategory(c.id);
                                  if (c.id === 'image_to_image') setEditEngine('gen_image');
                                  if (c.id === 'text_to_text' || c.id === 'image_to_text') setEditEngine('gen_text');
                                  if (c.id === 'text_to_image') setEditEngine('gen_image');
                                  if (c.id === 'generate_3d') setEditGenerate3D(editCategory === 'generate_3d' ? { ...editGenerate3D } : { ...DEFAULT_GENERATE_3D });
                                  if (c.id === 'generate_video') setEditGenerate3D({ ...DEFAULT_GENERATE_3D });
                                }}
                                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${editCategory === c.id ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300' : 'bg-white/[0.05] ring-1 ring-white/[0.06] text-gray-500 border-transparent'}`}
                              >
                                {c.label}
                              </button>
                            ))}
                          </div>
                          <label className="flex items-center gap-2 text-[10px] text-gray-300">
                            <input type="checkbox" checked={editEnabled} onChange={(e) => setEditEnabled(e.target.checked)} />
                            启用
                          </label>
                          {editCategory === 'image_to_image' && (
                            <label className="flex items-center gap-2 text-[9px] text-gray-400">
                              <span className="font-black uppercase">图生图方式</span>
                              <CustomDropdown
                                options={[
                                  { value: 'builtin', label: '内置图像处理' },
                                  { value: 'gen_image', label: '生图模型（提示词）' },
                                ]}
                                value={editEngine === 'gen_image' ? 'gen_image' : 'builtin'}
                                onChange={(v) => setEditEngine(v as CapabilityEngine)}
                                triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                portalZIndex={DETAIL_DROPDOWN_PORTAL_ZINDEX}
                              />
                            </label>
                          )}
                          {(editCategory === 'text_to_image' || (editCategory === 'image_to_image' && editEngine === 'gen_image')) && (
                            <div className="grid grid-cols-1 gap-2">
                              <label className="flex items-center gap-2 text-[9px] text-gray-400">
                                <span className="font-black uppercase">生图档位</span>
                                <CustomDropdown
                                  options={effectiveGearRows.map((g) => ({
                      value: g.id,
                      label: g.label,
                      disabled: g.disabled,
                      title: g.disabledReason,
                    }))}
                                  value={editImageGear}
                                  onChange={(v) => setEditImageGear(v as DialogImageGear)}
                                  triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                  portalZIndex={DETAIL_DROPDOWN_PORTAL_ZINDEX}
                                />
                              </label>
                              <label className="flex items-center gap-2 text-[9px] text-gray-400">
                                <span className="font-black uppercase">贴图比例</span>
                                <CustomDropdown
                                  options={[{ value: '', label: '默认' }, ...SUPPORTED_ASPECT_RATIOS.map((r) => ({ value: r.value, label: r.label }))]}
                                  value={editImageAspectRatio}
                                  onChange={setEditImageAspectRatio}
                                  placeholder="默认"
                                  triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                  portalZIndex={DETAIL_DROPDOWN_PORTAL_ZINDEX}
                                />
                              </label>
                              <label className="flex items-center gap-2 text-[9px] text-gray-400">
                                <span className="font-black uppercase">贴图尺寸</span>
                                <CustomDropdown
                                  options={[{ value: '', label: '默认' }, ...SUPPORTED_IMAGE_SIZES.map((s) => ({ value: s.value, label: s.label }))]}
                                  value={editImageSize}
                                  onChange={setEditImageSize}
                                  placeholder="默认"
                                  triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                  portalZIndex={DETAIL_DROPDOWN_PORTAL_ZINDEX}
                                />
                              </label>
                              <label className="flex items-center gap-2 text-[9px] text-gray-400 cursor-pointer" title="勾选：先理解再生成生图提示词；不勾选：预设提示词直发">
                                <input type="checkbox" checked={!editSkipUnderstand} onChange={(e) => setEditSkipUnderstand(!e.target.checked)} />
                                <span className="font-black uppercase">理解</span>
                              </label>
                            </div>
                          )}
                          {editCategory === 'generate_video' && (
                            <div className="grid grid-cols-1 gap-2">
                              <p className="text-[8px] text-gray-500">
                                需 <code className="text-gray-400">VITE_WORKFLOW_VIDEO_API_URL</code>。有参考图时默认先理解再请求桥。
                              </p>
                              <label className="flex items-center gap-2 text-[9px] text-gray-400 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!editSkipUnderstand}
                                  onChange={(e) => setEditSkipUnderstand(!e.target.checked)}
                                />
                                <span className="font-black uppercase">理解</span>
                              </label>
                            </div>
                          )}
                          {editCategory === 'text_to_text' ? (
                            <label className="flex items-center gap-2 text-[9px] text-gray-400 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editRequirePromptOnTextDrop}
                                onChange={(e) => setEditRequirePromptOnTextDrop(e.target.checked)}
                              />
                              <span className="font-black uppercase">拖拽时要求输入临时提示词</span>
                            </label>
                          ) : null}
                          {editCategory !== 'generate_3d' && editCategory !== 'generate_video' && (
                            <div className="rounded-xl border border-emerald-900/40 bg-black/20 p-2 space-y-2">
                              <div className="text-[8px] font-black text-emerald-300/90 uppercase">本机伴侣 · 宿主包 run.json</div>
                              <p className="text-[8px] text-gray-500 leading-snug">
                                填写目录名后，工作流将向本机伴侣提交 host_bundle.exec / host_bundle.probe。拖入图片或文字卡均可触发。
                              </p>
                              <label className="block">
                                <span className="text-[9px] text-gray-500 uppercase">插件目录名</span>
                                <input
                                  value={editCompanionHostBundleDir}
                                  onChange={(e) => setEditCompanionHostBundleDir(e.target.value)}
                                  placeholder="host-bundles 下文件夹名"
                                  className="mt-0.5 w-full bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl px-3 py-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/45"
                                />
                              </label>
                              <label className="flex items-center gap-2 text-[9px] text-gray-400">
                                <span className="font-black uppercase">阶段</span>
                                <CustomDropdown
                                  options={[
                                    { value: 'exec', label: 'exec（执行）' },
                                    { value: 'probe', label: 'probe（校验）' },
                                  ]}
                                  value={editCompanionHostBundlePhase}
                                  onChange={(v) => setEditCompanionHostBundlePhase(v === 'probe' ? 'probe' : 'exec')}
                                  triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                  portalZIndex={DETAIL_DROPDOWN_PORTAL_ZINDEX}
                                />
                              </label>
                            </div>
                          )}
                          {editCategory === 'generate_3d' && (
                            <div className="rounded-xl border border-[#2e3f5d] bg-[#141b26] p-3 space-y-2">
                              <div className="text-[8px] font-black text-blue-300 uppercase">生成3D 预设</div>
                              <label className="flex items-center gap-2 text-[9px]">
                                <span>服务商</span>
                                <CustomDropdown
                                  options={[{ value: 'tripo', label: 'Tripo' }, { value: 'tencent', label: '腾讯(兼容)' }]}
                                  value={editGenerate3D.provider ?? 'tripo'}
                                  onChange={(v) => setEditGenerate3D((g) => ({ ...g, provider: v as 'tripo' | 'tencent' }))}
                                  triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                  portalZIndex={DETAIL_DROPDOWN_PORTAL_ZINDEX}
                                />
                              </label>
                              {editGenerate3D.provider !== 'tencent' && (
                                <>
                                  <div className="w-full rounded-lg border border-white/[0.08] bg-black/20 p-2 space-y-1.5">
                                    <div className="text-[8px] font-black text-cyan-300 uppercase">标准参数</div>
                                    <div className="text-[8px] text-gray-500">影响主结果质量与基础风格，建议优先配置。</div>
                                    <div className="flex gap-2 flex-wrap">
                                      <label className="flex items-center gap-2 text-[9px]">
                                        <span>任务</span>
                                        <CustomDropdown
                                          options={[{ value: 'image_to_model', label: '图生3D' }, { value: 'text_to_model', label: '文生3D' }]}
                                          value={editGenerate3D.tripoTaskType ?? 'image_to_model'}
                                          onChange={(v) => setEditGenerate3D((g) => ({ ...g, tripoTaskType: v as 'text_to_model' | 'image_to_model' }))}
                                          triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                          portalZIndex={DETAIL_DROPDOWN_PORTAL_ZINDEX}
                                        />
                                      </label>
                                      <label className="flex items-center gap-2 text-[9px]">
                                        <span>版本</span>
                                        <CustomDropdown
                                          options={TRIPO_MODEL_VERSION_OPTIONS.map((x) => ({ value: x.value, label: x.label }))}
                                          value={editGenerate3D.tripoModelVersion ?? ''}
                                          onChange={(v) => setEditGenerate3D((g) => ({ ...g, tripoModelVersion: v || undefined }))}
                                          triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                          portalZIndex={DETAIL_DROPDOWN_PORTAL_ZINDEX}
                                        />
                                      </label>
                                      <label className="flex items-center gap-2 text-[9px]">
                                        <span>面数上限</span>
                                        <input type="number" min={500} max={500000} value={editGenerate3D.tripoFaceLimit ?? 100000} onChange={(e) => setEditGenerate3D((g) => ({ ...g, tripoFaceLimit: e.target.value ? parseInt(e.target.value, 10) : undefined }))} className="w-24 rounded bg-white/[0.06] px-2 py-1 text-[9px] ring-1 ring-white/[0.08]" />
                                      </label>
                                      <label className={`flex items-center gap-2 text-[9px] ${!editIsTripoV3Line ? 'opacity-45' : ''}`}>
                                        <span>几何质量</span>
                                        <CustomDropdown
                                          options={[{ value: '', label: '自动（不指定）' }, { value: 'standard', label: 'standard' }, { value: 'detailed', label: 'detailed' }]}
                                          value={editGenerate3D.tripoGeometryQuality ?? ''}
                                          onChange={(v) => setEditGenerate3D((g) => ({ ...g, tripoGeometryQuality: (v || undefined) as 'standard' | 'detailed' | undefined }))}
                                          triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                          portalZIndex={DETAIL_DROPDOWN_PORTAL_ZINDEX}
                                          disabled={!editIsTripoV3Line}
                                        />
                                      </label>
                                      <label className="flex items-center gap-2 text-[9px]">
                                        <span>纹理质量</span>
                                        <CustomDropdown
                                          options={[{ value: 'standard', label: 'standard' }, { value: 'detailed', label: 'detailed' }]}
                                          value={editGenerate3D.tripoTextureQuality ?? 'standard'}
                                          onChange={(v) => setEditGenerate3D((g) => ({ ...g, tripoTextureQuality: v as 'standard' | 'detailed' }))}
                                          triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                          portalZIndex={DETAIL_DROPDOWN_PORTAL_ZINDEX}
                                        />
                                      </label>
                                    </div>
                                  </div>
                                  <div className="w-full rounded-lg border border-white/[0.08] bg-black/20 p-2 space-y-1.5">
                                    <div className="text-[8px] font-black text-fuchsia-300 uppercase">额外功能</div>
                                    <div className="text-[8px] text-gray-500">附加能力与高级开关，可能影响耗时与计费。</div>
                                    <div className="flex gap-2 flex-wrap">
                                      <label className="flex items-center gap-1.5 text-[9px]">
                                        <input
                                          type="checkbox"
                                          checked={editGenerate3D.tripoTexture ?? true}
                                          onChange={(e) => setEditGenerate3D((g) => ({ ...g, tripoTexture: e.target.checked }))}
                                          disabled={editTripoGenerateParts}
                                        />
                                        <span>纹理</span>
                                      </label>
                                      <label className="flex items-center gap-1.5 text-[9px]">
                                        <input
                                          type="checkbox"
                                          checked={editGenerate3D.tripoPbr ?? true}
                                          onChange={(e) => setEditGenerate3D((g) => ({ ...g, tripoPbr: e.target.checked }))}
                                          disabled={editTripoGenerateParts}
                                        />
                                        <span>PBR</span>
                                      </label>
                                      <label className="flex items-center gap-1.5 text-[9px]">
                                        <input
                                          type="checkbox"
                                          checked={editGenerate3D.tripoQuad ?? false}
                                          onChange={(e) => setEditGenerate3D((g) => ({ ...g, tripoQuad: e.target.checked }))}
                                          disabled={editTripoGenerateParts}
                                        />
                                        <span>Quad</span>
                                      </label>
                                      <label className="flex items-center gap-1.5 text-[9px]">
                                        <input type="checkbox" checked={editGenerate3D.tripoSmartLowPoly ?? false} onChange={(e) => setEditGenerate3D((g) => ({ ...g, tripoSmartLowPoly: e.target.checked }))} />
                                        <span>低模</span>
                                      </label>
                                      <label className="flex items-center gap-1.5 text-[9px]">
                                        <input
                                          type="checkbox"
                                          checked={editGenerate3D.tripoGenerateParts ?? false}
                                          onChange={(e) => setEditGenerate3D((g) => ({ ...g, tripoGenerateParts: e.target.checked }))}
                                          disabled={editTripoTextureEnabled || editTripoPbrEnabled}
                                        />
                                        <span>分部件</span>
                                      </label>
                                      <label className="flex items-center gap-1.5 text-[9px]">
                                        <input type="checkbox" checked={editGenerate3D.tripoEnableImageAutofix ?? false} onChange={(e) => setEditGenerate3D((g) => ({ ...g, tripoEnableImageAutofix: e.target.checked }))} />
                                        <span>输入图自动修复</span>
                                      </label>
                                      <label className="flex items-center gap-1.5 text-[9px]">
                                        <input type="checkbox" checked={editGenerate3D.tripoAutoSize ?? false} onChange={(e) => setEditGenerate3D((g) => ({ ...g, tripoAutoSize: e.target.checked }))} />
                                        <span>自动尺寸</span>
                                      </label>
                                      <label className="flex items-center gap-1.5 text-[9px]">
                                        <input type="checkbox" checked={editGenerate3D.tripoExportUv ?? true} onChange={(e) => setEditGenerate3D((g) => ({ ...g, tripoExportUv: e.target.checked }))} />
                                        <span>导出UV</span>
                                      </label>
                                      <label className="flex items-center gap-1.5 text-[9px]">
                                        <input type="checkbox" checked={(editGenerate3D.tripoCompress ?? undefined) === 'geometry'} onChange={(e) => setEditGenerate3D((g) => ({ ...g, tripoCompress: e.target.checked ? 'geometry' : undefined }))} />
                                        <span>几何压缩</span>
                                      </label>
                                      <label className="flex items-center gap-1.5 text-[9px]">
                                        <span>纹理对齐</span>
                                        <CustomDropdown
                                          options={[{ value: '', label: '默认' }, { value: 'original_image', label: 'original_image' }, { value: 'geometry', label: 'geometry' }]}
                                          value={editGenerate3D.tripoTextureAlignment ?? ''}
                                          onChange={(v) => setEditGenerate3D((g) => ({ ...g, tripoTextureAlignment: (v || undefined) as 'original_image' | 'geometry' | undefined }))}
                                          triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                          portalZIndex={DETAIL_DROPDOWN_PORTAL_ZINDEX}
                                        />
                                      </label>
                                      <label className="flex items-center gap-1.5 text-[9px]">
                                        <span>朝向</span>
                                        <CustomDropdown
                                          options={[{ value: '', label: '默认' }, { value: 'default', label: 'default' }, { value: 'align_image', label: 'align_image' }]}
                                          value={editGenerate3D.tripoOrientation ?? ''}
                                          onChange={(v) => setEditGenerate3D((g) => ({ ...g, tripoOrientation: (v || undefined) as 'default' | 'align_image' | undefined }))}
                                          triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                          portalZIndex={DETAIL_DROPDOWN_PORTAL_ZINDEX}
                                        />
                                      </label>
                                    </div>
                                  </div>
                                  {(editTripoTextureEnabled || editTripoPbrEnabled) && (
                                    <div className="w-full text-[8px] text-amber-300">
                                      「分部件」与「纹理/PBR」互斥：请先关闭纹理和 PBR。
                                    </div>
                                  )}
                                  {editTripoGenerateParts && (
                                    <div className="w-full text-[8px] text-amber-300">
                                      已开启分部件：Quad、纹理、PBR 已禁用。
                                    </div>
                                  )}
                                  <label className="block text-[9px] text-gray-300">
                                    <span>Negative Prompt</span>
                                    <input
                                      value={editGenerate3D.tripoNegativePrompt ?? ''}
                                      onChange={(e) => setEditGenerate3D((g) => ({ ...g, tripoNegativePrompt: e.target.value }))}
                                      placeholder="可选"
                                      className="mt-1 w-full rounded bg-white/[0.06] px-2 py-1 text-[9px] ring-1 ring-white/[0.08]"
                                    />
                                  </label>
                                </>
                              )}
                            </div>
                          )}
                          <label className="block">
                            <div className="text-[9px] text-gray-500 uppercase mb-1">功能名称</div>
                            <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="w-full bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl px-3 py-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50" />
                          </label>
                          <label className="block">
                            <div className="text-[9px] text-gray-500 uppercase mb-1">提示词 / 说明</div>
                            <textarea value={editInstruction} onChange={(e) => setEditInstruction(e.target.value)} rows={8} className="w-full bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl px-3 py-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 resize-y" />
                          </label>
                          <div className="flex gap-2">
                            <button type="button" onClick={saveDetailEdit} className="px-3 py-1.5 rounded-lg border border-[#36578f] bg-[#1d3154] text-blue-200 text-[9px] font-black uppercase hover:bg-[#264171]">保存</button>
                            <button type="button" onClick={() => { setDetailEditMode(false); setEditingId(null); }} className="px-3 py-1.5 rounded-lg bg-[#121214] text-[9px] font-black uppercase text-gray-200 ring-1 ring-white/[0.08] hover:bg-white/[0.06]">取消</button>
                          </div>
                        </>
                      )
                    ) : (
                      <>
                        <div className="text-[9px] text-gray-500 uppercase">参数概览（只读）</div>
                        <div className="grid grid-cols-2 gap-2 text-[9px]">
                          <div className="rounded-lg bg-[#1b1b21] border border-[#2a2a32] px-2 py-1.5">
                            <div className="text-gray-500">分类</div>
                            <div className="text-gray-200 mt-0.5">{CAPABILITY_CATEGORIES.find((c) => c.id === detailPreset.category)?.label ?? detailPreset.category}</div>
                          </div>
                          <div className="rounded-lg bg-[#1b1b21] border border-[#2a2a32] px-2 py-1.5">
                            <div className="text-gray-500">启用</div>
                            <div className="text-gray-200 mt-0.5">{detailPreset.enabled === false ? '否' : '是'}</div>
                          </div>
                          <div className="rounded-lg bg-[#1b1b21] border border-[#2a2a32] px-2 py-1.5">
                            <div className="text-gray-500">执行方式</div>
                            <div className="text-gray-200 mt-0.5">
                              {detailPreset.category === 'generate_3d'
                                ? '3D生成'
                                : detailPreset.category === 'generate_video'
                                  ? '生视频（HTTP 桥）'
                                : detailPreset.category === 'text_to_text'
                                  ? '文字模型（文生文）'
                                  : detailPreset.category === 'image_to_text'
                                    ? '文字模型（图生文）'
                                    : detailPreset.category === 'text_to_image'
                                      ? '生图（文生图）'
                                      : detailPreset.category === 'image_to_image' && getEngine(detailPreset) === 'builtin'
                                        ? '图像处理（内置）'
                                        : detailPreset.category === 'image_to_image'
                                          ? '生图（图生图）'
                                          : getEngine(detailPreset) === 'gen_image'
                                            ? '生图（提示词）'
                                            : '内置'}
                            </div>
                          </div>
                          <div className="rounded-lg bg-[#1b1b21] border border-[#2a2a32] px-2 py-1.5">
                            <div className="text-gray-500">生图档位</div>
                            <div className="text-gray-200 mt-0.5">{detailPreset.imageGear || '默认'}</div>
                          </div>
                          <div className="rounded-lg bg-[#1b1b21] border border-[#2a2a32] px-2 py-1.5">
                            <div className="text-gray-500">比例 / 尺寸</div>
                            <div className="text-gray-200 mt-0.5">{detailPreset.imageAspectRatio || '默认'} / {detailPreset.imageSize || '默认'}</div>
                          </div>
                          <div className="rounded-lg bg-[#1b1b21] border border-[#2a2a32] px-2 py-1.5">
                            <div className="text-gray-500">理解开关</div>
                            <div className="text-gray-200 mt-0.5">{detailPreset.skipUnderstand === true ? '直发提示词' : '先理解再生成'}</div>
                          </div>
                          <div className="rounded-lg bg-[#1b1b21] border border-[#2a2a32] px-2 py-1.5">
                            <div className="text-gray-500">拖拽临时提示词</div>
                            <div className="text-gray-200 mt-0.5">
                              {detailPreset.category === 'text_to_text'
                                ? (detailPreset.requirePromptOnTextDrop === true ? '开启（必填）' : '关闭（直接入队）')
                                : '不适用'}
                            </div>
                          </div>
                          {detailPreset.companionHostBundle?.dirName ? (
                            <div className="rounded-lg bg-[#1b1b21] border border-emerald-900/35 px-2 py-1.5 col-span-2">
                              <div className="text-gray-500">本机宿主包</div>
                              <div className="text-gray-200 mt-0.5 text-[10px]">
                                {detailPreset.companionHostBundle.dirName} ·{' '}
                                {detailPreset.companionHostBundle.phase === 'probe' ? 'probe' : 'exec'}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        {detailPreset.category === 'generate_3d' && detailPreset.generate3D && (
                          <div className="rounded-lg bg-[#1b1b21] border border-[#2a2a32] px-2 py-2 text-[9px] text-gray-300">
                            3D：{detailPreset.generate3D.provider === 'tencent' ? '腾讯(兼容)' : 'Tripo'}
                            {detailPreset.generate3D.tripoTaskType ? ` · ${detailPreset.generate3D.tripoTaskType}` : ''}
                            {detailPreset.generate3D.tripoModelVersion ? ` · ${detailPreset.generate3D.tripoModelVersion}` : ''}
                            {detailPreset.generate3D.tripoFaceLimit ? ` · ${detailPreset.generate3D.tripoFaceLimit} 面` : ''}
                            {detailPreset.generate3D.tripoPbr ? ' · PBR' : ''}
                          </div>
                        )}
                        <div className="rounded-lg bg-[#1b1b21] border border-[#2a2a32] px-2 py-2">
                          <div className="text-[9px] text-gray-500 uppercase mb-1">提示词 / 说明</div>
                          <div className="text-[11px] text-gray-300 break-words leading-relaxed">{detailPreset.instruction || '（使用内置逻辑或未设置预设提示词）'}</div>
                        </div>
                        <div className="text-[9px] text-gray-500">id: {detailPreset.id}</div>
                        <button type="button" onClick={() => beginDetailEdit(detailPreset)} className="px-3 py-1.5 rounded-lg border border-[#36578f] bg-[#1d3154] text-[9px] font-black uppercase text-blue-200 hover:bg-[#264171]">编辑参数</button>
                      </>
                    )}
              </div>
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
              <input
                ref={(el) => { fileInputRef.current[detailPreset.id] = el; }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFile(detailPreset.id, e)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current[detailPreset.id]?.click()}
                className="px-3 py-1.5 rounded-lg border border-[#36578f] bg-[#1d3154] text-blue-200 text-[9px] font-black uppercase hover:bg-[#264171]"
              >
                上传预览图
              </button>
              {onRunTest && detailPreset.category !== 'generate_3d' && (
                <button
                  type="button"
                  disabled={
                    (!testImage[detailPreset.id] && !detailPreset.companionHostBundle?.dirName?.trim()) ||
                    !!testRunning[detailPreset.id]
                  }
                  onClick={() => runTest(detailPreset)}
                  className="px-3 py-1.5 rounded-lg border border-[#36578f] bg-[#1d3154] text-blue-200 text-[9px] font-black uppercase hover:bg-[#264171] disabled:opacity-50 disabled:pointer-events-none"
                >
                  {testRunning[detailPreset.id] ? '运行中…' : '运行测试'}
                </button>
              )}
              {canUploadToR2 && (
                <>
                  <button
                    type="button"
                    onClick={() => void uploadPresetToR2(detailPreset, 'preview')}
                    disabled={!!uploadingPresetActions[detailPreset.id]}
                    className="px-3 py-1.5 rounded-lg border border-[#36578f] bg-[#1d3154] text-blue-200 text-[9px] font-black uppercase hover:bg-[#264171] disabled:opacity-50"
                  >
                    {uploadingPresetActions[detailPreset.id] === 'preview' ? '上传中…' : '上传预览图到R2'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void uploadPresetToR2(detailPreset, 'preset')}
                    disabled={!!uploadingPresetActions[detailPreset.id]}
                    className="px-3 py-1.5 rounded-lg border border-[#36578f] bg-[#1d3154] text-blue-200 text-[9px] font-black uppercase hover:bg-[#264171] disabled:opacity-50"
                  >
                    {uploadingPresetActions[detailPreset.id] === 'preset' ? '上传中…' : '上传预设到R2'}
                  </button>
                </>
              )}
              {!detailEditMode && (
                <button
                  type="button"
                  onClick={() => beginDetailEdit(detailPreset)}
                  className="px-3 py-1.5 rounded-lg border border-[#36578f] bg-[#1d3154] text-[9px] font-black uppercase text-blue-200 hover:bg-[#264171]"
                >
                  编辑参数
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  removePreset(detailPreset.id);
                  setDetailPresetId(null);
                }}
                disabled={isBuiltinImageProcess(detailPreset)}
                className="px-3 py-1.5 rounded-lg bg-[#121214] text-gray-200 text-[9px] font-black uppercase ring-1 ring-white/[0.08] hover:bg-white/[0.06] disabled:opacity-50"
              >
                删除预设
              </button>
            </div>
          </div>
        </ImagePreviewOverlay>
      )}

      {typeof document !== 'undefined' &&
        (lightboxImage || lightboxCompare) &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/78 backdrop-blur-sm p-4"
            data-ac-esc-sink
            onClick={() => {
              setLightboxImage(null);
              setLightboxCompare(null);
            }}
            role="presentation"
          >
            <button
              type="button"
              onClick={() => {
                setLightboxImage(null);
                setLightboxCompare(null);
              }}
              className="absolute top-4 right-4 z-[10001] w-10 h-10 flex items-center justify-center text-white/70 hover:text-white rounded-full bg-[#26262c]"
              aria-label="关闭"
            >
              <AppIcon name="close" className="w-4 h-4" />
            </button>
            {lightboxCompare ? (
              <div
                className="relative w-full max-w-[min(100vw-2rem,1200px)] h-[min(90vh,860px)] rounded-lg overflow-hidden shadow-2xl bg-[#0f0f10]"
                onClick={(e) => e.stopPropagation()}
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (!rect.width) return;
                  const ratio = (e.clientX - rect.left) / rect.width;
                  setLightboxSplitRatio(Math.max(0.05, Math.min(0.95, ratio)));
                }}
                onMouseLeave={() => setLightboxSplitRatio(0.5)}
              >
                {(() => {
                  const splitPct = lightboxSplitRatio * 100;
                  const slant = 4;
                  const topCut = Math.max(0, Math.min(100, splitPct + slant));
                  const bottomCut = Math.max(0, Math.min(100, splitPct - slant));
                  const lineTopLeft = Math.max(0, Math.min(100, topCut - 0.25));
                  const lineTopRight = Math.max(0, Math.min(100, topCut + 0.25));
                  const lineBottomLeft = Math.max(0, Math.min(100, bottomCut - 0.25));
                  const lineBottomRight = Math.max(0, Math.min(100, bottomCut + 0.25));
                  return (
                    <>
                      <CapabilityPreviewImg src={lightboxCompare.original} alt="原图" className="absolute inset-0 h-full w-full object-contain" />
                      <CapabilityPreviewImg
                        src={lightboxCompare.generated}
                        alt="生成图"
                        className="absolute inset-0 h-full w-full object-contain"
                        style={{ clipPath: `polygon(${topCut}% 0%, 100% 0%, 100% 100%, ${bottomCut}% 100%)` }}
                      />
                      <div
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          clipPath: `polygon(${lineTopLeft}% 0%, ${lineTopRight}% 0%, ${lineBottomRight}% 100%, ${lineBottomLeft}% 100%)`,
                          background: 'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(191,219,254,0.92) 50%, rgba(255,255,255,0.78) 100%)',
                          boxShadow: '0 0 10px rgba(59,130,246,0.35)',
                        }}
                      />
                    </>
                  );
                })()}
              </div>
            ) : (
              <CapabilityPreviewImg
                src={lightboxImage || ''}
                alt="预览大图"
                className="max-h-[90vh] max-w-[min(100vw-2rem,1200px)] w-auto object-contain rounded-lg shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </div>,
          document.body
        )}
        </>
      )}
      {!onOpenWorkflowComposer &&
        embedComposerSessions.map((sess) => (
          <React.Fragment key={sess.id}>
            <WorkflowComposerOverlay
              open
              onClose={() => closeEmbedComposerSession(sess.id)}
              sessionKey={sess.sessionKey}
              presets={presets}
              initialSet={sess.initialSet}
              isForeground={sess.id === embedComposerActiveId}
              dockStackIndex={getEmbedComposerDockStackIndex(sess.id)}
              dockStackCount={getEmbedComposerDockStackCount(sess.id)}
              onRequestForeground={() => setEmbedComposerActiveId(sess.id)}
              onMinimizedChange={(minimized) =>
                setEmbedComposerMinimized((prev) => {
                  if (prev[sess.id] === minimized) return prev;
                  return { ...prev, [sess.id]: minimized };
                })
              }
              onSave={handleSaveSet}
              onLog={onLog}
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default CapabilityPresetSection;
