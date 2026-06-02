import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BoundingBox, CustomAppModule, StoryboardParseFieldDef, StoryboardRoleAsset, StoryboardTableRow, WorkflowAsset } from '../../types';
import {
  applyAutoShotNumbers,
  computeStoryboardTableStats,
  createStoryboardTableRow,
  duplicateStoryboardRow,
  normalizeStoryboardTableDoc,
  readStoryboardTableTitleRaw,
  reindexStoryboardRows,
  resolveStoryboardTableTitle,
} from '../../services/storyboardTableAsset';
import { reorderStoryboardRowsInLayer, collapseStoryboardTimelineTopLayer, clampStoryboardTimelineLayerCount } from '../../services/storyboardVideoTimeline';
import {
  executeStoryboardFeedbackSheetRedraw,
  formatStoryboardFeedbackBatchLabel,
  listStoryboardFeedbackRedrawEligibleRows,
  normalizeFeedbackCollageLimit,
  planStoryboardFeedbackRedrawTasks,
  STORYBOARD_EDIT_FEEDBACK_COLLAGE_LIMIT_KEY,
  STORYBOARD_FEEDBACK_COLLAGE_LIMIT_DEFAULT,
  splitStoryboardFeedbackCollageByLayout,
  type FeedbackCollageLayout,
  type StoryboardFeedbackRedrawBatchRecord,
} from '../../services/storyboardFeedbackSheetRedraw';
import {
  readStoryboardFeedbackRedrawHistory,
  readStoryboardFeedbackRedrawHistorySelection,
  writeStoryboardFeedbackRedrawHistory,
  writeStoryboardFeedbackRedrawHistorySelection,
} from '../../services/storyboardFeedbackRedrawHistory';
import {
  buildStoryboardRowPromptText,
  isStoryboardFeedbackRedrawEligible,
  listStoryboardFeedbackRedrawRows,
  listStoryboardRowsWithEditFeedback,
  listStoryboardFeedbackCollageRedrawPresets,
  pickDefaultStoryboardFeedbackCollagePresetId,
  resolveStoryboardFeedbackCollagePreset,
  STORYBOARD_EDIT_FEEDBACK_COLLAGE_MODEL_KEY,
  STORYBOARD_EDIT_FEEDBACK_COLLAGE_PRESET_KEY,
  STORYBOARD_EDIT_FEEDBACK_REDRAW_UNDERSTAND_KEY,
  STORYBOARD_EDIT_REDRAW_MODEL_KEY,
  type StoryboardRowRedrawInvokeOptions,
} from '../../services/storyboardTableRedraw';
import { canPatchStoryboardPassedRow, storyboardRowIsPassed } from './storyboardRowDisplay';
import { createStoryboardRoleAsset } from '../../services/storyboardRoleAssets';
import { appendStoryboardFrameRoleMark } from '../../services/storyboardFrameRoleMarks';
import {
  executeStoryboardRoleReplaceCollageBatch,
  listStoryboardRoleReplaceEligibleRows,
  planStoryboardRoleReplaceTasks,
} from '../../services/storyboardRoleReplaceRedraw';
import { storyboardRowHasFrameRef } from '../../services/storyboardFrameImageUrl';
import {
  executeStoryboardSheetGen,
  executeStoryboardSheetGenBatch,
  planStoryboardSheetGenTasks,
  probeStoryboardSheetGenCompanionReady,
  storyboardSheetGenCompanionProbeMessage,
  StoryboardSheetGenBatchController,
  type StoryboardSheetGenBatchRequest,
} from '../../services/storyboardTableSheetGen';
import {
  buildLayoutSheetGridBoxes,
  detectStoryboardSheetPanels,
  splitStoryboardSheetByVision,
  splitStoryboardSheetFromBoxes,
  type StoryboardSheetVisionSplitResult,
} from '../../services/storyboardSheetVisionSplit';
import {
  applyHydratedSheetPreviewImages,
  buildSheetPreviewLabel,
  commitStoryboardSheetPreviewList,
  createSheetPreviewItem,
  createSheetGenPlaceholderItems,
  cleanupStoryboardSheetPreviewAssets,
  ensureStoryboardRowsForShotNos,
  formatSheetPreviewShotLabel,
  hydrateStoryboardSheetPreviews,
  isStoryboardSheetPreviewSplittable,
  listSplittableStoryboardSheetPreviews,
  loadStoryboardSheetPreviewsStored,
  mergeStoryboardSheetPreviews,
  parseSheetPreviewShotRange,
  prependStoryboardSheetPreview,
  prepareStoryboardSheetPreviewForSave,
  readStoryboardSheetPreviews,
  removeStoryboardSheetPreview,
  resolveSheetTaskRows,
  resolveStoryboardSheetPreviewDataUrl,
  updateStoryboardSheetPreview,
  upsertStoryboardSheetPreview,
  writeStoryboardSheetPreviewsToCompanion,
  type StoryboardSheetPreviewItem,
} from '../../services/storyboardSheetPreview';
import {
  activateSheetPreviewHistoryVersion,
  replaceSheetPreviewActiveImage,
} from '../../services/storyboardSheetPreviewHistory';
import {
  clearStoryboardSheetGenSessionBusy,
  findStoryboardSheetGenSessionPreview,
  getStoryboardSheetGenSession,
  isStoryboardSheetGenSessionBusy,
  mergeStoryboardSheetGenSessionPreviews,
  patchStoryboardSheetGenSession,
  syncStoryboardSheetGenSessionPreviews,
  subscribeStoryboardSheetGenSession,
} from '../../services/storyboardSheetGenSession';
import {
  clearStoryboardSheetSplitSessionBusy,
  getStoryboardSheetSplitSession,
  isStoryboardSheetSplitSessionBusy,
  patchStoryboardSheetSplitSession,
  subscribeStoryboardSheetSplitSession,
  type StoryboardSheetSplitSessionState,
} from '../../services/storyboardSheetSplitSession';
import { WORKFLOW_CUT_DETECT_TIMEOUT_MS } from '../workflow/workflowConstants';
import {
  applyShotFieldsPatch,
  listStoryboardParsePresets,
  listStoryboardOptimizePresets,
  parseStoryboardRowWithPreset,
  parseStoryboardRowsBatch,
  optimizeStoryboardRowWithPreset,
  pickDefaultStoryboardParsePresetId,
  pickDefaultStoryboardOptimizePresetId,
  getBuiltinStoryboardParsePreset,
  getBuiltinStoryboardOptimizePreset,
  maybeWarnLargeFieldCatalog,
  rowHasStructuredFieldValues,
  resolveStoryboardParseInput,
  STORYBOARD_PARSE_PRESET_KEY,
  STORYBOARD_OPTIMIZE_PRESET_KEY,
  STORYBOARD_OPTIMIZE_ALLOW_DIALOGUE_KEY,
} from '../../services/storyboardTableParse';
import { readLocalJson, writeLocalJson } from '../../services/clientPersist';
import {
  coerceImageModelRegistryId,
  DEFAULT_IMAGE_MODEL_REGISTRY_ID,
  DIALOG_IMAGE_MODELS,
} from '../../services/modelRegistry/imageModels';
import {
  STORYBOARD_GRID_SECONDS_PER_TILE_KEY,
  STORYBOARD_GRID_SECONDS_PRESETS,
  groupStoryboardRowsForGridPreview,
  normalizeStoryboardGridSecondsPerTile,
} from '../../services/storyboardGridDurationGroups';
import {
  downloadAllStoryboardGroupMosaics,
  downloadStoryboardGroupMosaic,
  normalizeStoryboardGridExportWidth,
  readStoryboardGridExportWidth,
  STORYBOARD_GRID_EXPORT_WIDTH_PRESETS,
  writeStoryboardGridExportWidth,
} from '../../services/storyboardGridExport';
import {
  compressStoryboardFrameDataUrl,
  readStoryboardFrameFromClipboard,
  readStoryboardFrameFromFile,
} from './storyboardFrameImage';
import {
  clearStoryboardRowFrameWithHistory,
  replaceStoryboardRowFrame,
  restoreStoryboardRowFrameVersion,
} from '../../services/storyboardFrameHistory';
import { ImagePreviewOverlay } from '../ImagePreviewOverlay';
import { Download } from 'lucide-react';
import { triggerImageDownload } from '../../services/imageDataUrl';
import { IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE } from '../workflow/workflowSectionUiConstants';
import AppIcon from '../ui/AppIcon';
import { CustomDropdown } from '../ui/CustomDropdown';
import StoryboardTableInputView, {
  type StoryboardTableInputViewHandle,
} from './StoryboardTableInputView';
import StoryboardTableEditView, {
  type StoryboardTableEditViewHandle,
} from './StoryboardTableEditView';
import StoryboardSheetSplitAdjustModal from './StoryboardSheetSplitAdjustModal';
import type { StoryboardRowInteractionValue } from './StoryboardRowInteractionContext';
import StoryboardTableGridPreview from './StoryboardTableGridPreview';
import StoryboardTableVideoPreview from './StoryboardTableVideoPreview';
import {
  canExportStoryboardVideo,
  startStoryboardVideoExportTask,
  useStoryboardVideoExportTask,
} from './useStoryboardVideoExport';
import StoryboardVideoExportProgress from './StoryboardVideoExportProgress';
import {
  STORYBOARD_ADD_ROW_DASHED,
  STORYBOARD_GAP_TIGHT,
  STORYBOARD_PAD_HEADER_INNER,
  STORYBOARD_PAD_PANEL,
  STORYBOARD_PAD_TOOLBAR,
  STORYBOARD_STAT_CHIP,
  STORYBOARD_TOOL_BTN_GHOST,
  STORYBOARD_TOOL_BTN_NEUTRAL,
  STORYBOARD_TOOL_BTN_PRIMARY,
  STORYBOARD_VIEW_TOGGLE,
  STORYBOARD_VIEW_TOGGLE_ACTIVE,
  STORYBOARD_VIEW_TOGGLE_BTN,
  STORYBOARD_VIEW_TOGGLE_IDLE,
} from './storyboardTableUi';

type StoryboardPanelViewMode = 'input' | 'edit' | 'grid' | 'video';

const STORYBOARD_VIEW_STORAGE_KEY = 'ac_storyboard_panel_view_v1';

type Props = {
  asset: WorkflowAsset;
  onClose: () => void;
  readOnly?: boolean;
  onNotify?: (level: 'info' | 'warn', message: string) => void;
  redrawPresets?: CustomAppModule[];
  defaultRedrawPresetId?: string;
  redrawPresetStorageKey?: string;
  parsePresets?: CustomAppModule[];
  defaultParsePresetId?: string;
  optimizePresets?: CustomAppModule[];
  defaultOptimizePresetId?: string;
  capabilityTextModel?: string;
  onRedrawRow?: (
    rowId: string,
    imageModelRegistryId: string,
    options?: StoryboardRowRedrawInvokeOptions
  ) => Promise<void>;
  onPatchAsset: (
    patch: Partial<WorkflowAsset> | ((prev: WorkflowAsset) => WorkflowAsset)
  ) => void;
  companionBaseUrl?: string;
  companionProjectId?: string;
};

/** 高于面板 z-[2160] */
const STORYBOARD_LIGHTBOX_Z = 'z-[2180]';
const STORYBOARD_PANEL_DROPDOWN_Z = { backdrop: 2170, list: 2171 };

function formatDurationLabel(sec: number, hasGaps: boolean): string {
  if (hasGaps) return `已填 ${sec.toFixed(1)}s+`;
  return `${sec.toFixed(1)}s`;
}

export default function StoryboardTablePanel({
  asset,
  onClose,
  readOnly = false,
  onNotify,
  redrawPresets = [],
  defaultRedrawPresetId = '',
  redrawPresetStorageKey = 'ac_storyboard_redraw_preset_v1',
  parsePresets = [],
  defaultParsePresetId = '',
  optimizePresets = [],
  defaultOptimizePresetId = '',
  capabilityTextModel = '',
  onRedrawRow,
  onPatchAsset,
  companionBaseUrl = '',
  companionProjectId = '',
}: Props) {
  const table = useMemo(() => normalizeStoryboardTableDoc(asset.storyboardTable), [asset.storyboardTable]);
  const effectiveParsePresets = useMemo(
    () => (parsePresets.length > 0 ? parsePresets : listStoryboardParsePresets([])),
    [parsePresets]
  );
  const effectiveOptimizePresets = useMemo(
    () => (optimizePresets.length > 0 ? optimizePresets : listStoryboardOptimizePresets([])),
    [optimizePresets]
  );
  const stats = useMemo(() => computeStoryboardTableStats(table), [table]);
  const storyboardExportTask = useStoryboardVideoExportTask();
  const isExportRunning = storyboardExportTask?.status === 'running';
  const isThisAssetExporting =
    isExportRunning && storyboardExportTask.assetId === asset.id;
  const canExportVideo = useMemo(
    () => canExportStoryboardVideo(table.rows, table.timelineLayerCount, table.fieldCatalog),
    [table.fieldCatalog, table.rows, table.timelineLayerCount]
  );
  const timelineLayerCount = table.timelineLayerCount ?? 1;

  const handleStartVideoExport = useCallback(() => {
    const title = resolveStoryboardTableTitle(asset);
    void startStoryboardVideoExportTask({
      assetId: asset.id,
      assetTitle: title,
      rows: table.rows,
      fieldCatalog: table.fieldCatalog,
      timelineLayerCount,
      onNotify,
    });
  }, [asset, onNotify, table.fieldCatalog, table.rows, timelineLayerCount]);
  const [viewMode, setViewMode] = useState<StoryboardPanelViewMode>(() =>
    readLocalJson(STORYBOARD_VIEW_STORAGE_KEY, 'edit', (v) =>
      v === 'input' || v === 'grid' || v === 'edit' || v === 'video' ? v : null
    )
  );
  const [gridSecondsPerTile, setGridSecondsPerTile] = useState(() =>
    normalizeStoryboardGridSecondsPerTile(
      readLocalJson(STORYBOARD_GRID_SECONDS_PER_TILE_KEY, 5, (v) => v)
    )
  );
  const [gridExportWidth, setGridExportWidth] = useState(() => readStoryboardGridExportWidth());
  const [gridDownloadBusy, setGridDownloadBusy] = useState(false);
  const isGridView = viewMode === 'grid';
  const isVideoView = viewMode === 'video';
  const isEditView = viewMode === 'edit';
  const isInputView = viewMode === 'input';
  const [activeRowId, setActiveRowId] = useState<string | null>(table.rows[0]?.id ?? null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxSheetPreviewId, setLightboxSheetPreviewId] = useState<string | null>(null);
  const [imageBusyRowId, setImageBusyRowId] = useState<string | null>(null);
  const [roleAssetBusyId, setRoleAssetBusyId] = useState<string | null>(null);
  const [roleReplaceBatchBusy, setRoleReplaceBatchBusy] = useState(false);
  const [roleReplaceBatchProgress, setRoleReplaceBatchProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [redrawBusyRowId, setRedrawBusyRowId] = useState<string | null>(null);
  const [feedbackRedrawUnderstand, setFeedbackRedrawUnderstand] = useState(() =>
    readLocalJson(STORYBOARD_EDIT_FEEDBACK_REDRAW_UNDERSTAND_KEY, true, (v) =>
      typeof v === 'boolean' ? v : null
    )
  );

  const toggleFeedbackRedrawUnderstand = useCallback(() => {
    setFeedbackRedrawUnderstand((prev) => {
      const next = !prev;
      writeLocalJson(STORYBOARD_EDIT_FEEDBACK_REDRAW_UNDERSTAND_KEY, next);
      return next;
    });
  }, []);
  const [feedbackBatchBusy, setFeedbackBatchBusy] = useState(false);
  const [feedbackBatchProgress, setFeedbackBatchProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [feedbackRedrawHistory, setFeedbackRedrawHistory] = useState<
    StoryboardFeedbackRedrawBatchRecord[]
  >(() => readStoryboardFeedbackRedrawHistory(asset.id));
  const [selectedFeedbackHistoryId, setSelectedFeedbackHistoryId] = useState<string | null>(() =>
    readStoryboardFeedbackRedrawHistorySelection(asset.id)
  );
  const [feedbackCollageLimit, setFeedbackCollageLimit] = useState(() =>
    normalizeFeedbackCollageLimit(
      readLocalJson(
        STORYBOARD_EDIT_FEEDBACK_COLLAGE_LIMIT_KEY,
        STORYBOARD_FEEDBACK_COLLAGE_LIMIT_DEFAULT,
        (v) => (typeof v === 'number' ? v : null)
      )
    )
  );

  const setFeedbackCollageLimitPersisted = useCallback((limit: number) => {
    const normalized = normalizeFeedbackCollageLimit(limit);
    setFeedbackCollageLimit(normalized);
    writeLocalJson(STORYBOARD_EDIT_FEEDBACK_COLLAGE_LIMIT_KEY, normalized);
  }, []);
  const [sheetGenBusy, setSheetGenBusy] = useState(false);
  const [sheetGenProgress, setSheetGenProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [sheetPreviews, setSheetPreviews] = useState<StoryboardSheetPreviewItem[]>([]);
  const sheetPreviewsRef = useRef<StoryboardSheetPreviewItem[]>([]);
  const sheetGenBusyRef = useRef(false);
  const sheetSplitBatchBusyRef = useRef(
    getStoryboardSheetSplitSession(asset.id)?.batchBusy ?? false
  );
  const sheetPreviewSaveChainRef = useRef(Promise.resolve());
  const sheetGenControllerRef = useRef<StoryboardSheetGenBatchController | null>(null);
  const sheetGenPlaceholderIdsRef = useRef<Map<number, string>>(new Map());
  const [sheetSplitBusyId, setSheetSplitBusyId] = useState<string | null>(
    () => getStoryboardSheetSplitSession(asset.id)?.busyPreviewId ?? null
  );
  const [sheetRegenBusyId, setSheetRegenBusyId] = useState<string | null>(null);
  const [sheetSplitBatchBusy, setSheetSplitBatchBusy] = useState(
    () => getStoryboardSheetSplitSession(asset.id)?.batchBusy ?? false
  );
  const [sheetSplitProgress, setSheetSplitProgress] = useState<{ done: number; total: number } | null>(
    () => getStoryboardSheetSplitSession(asset.id)?.progress ?? null
  );
  const splitAdjustResolverRef = useRef<((boxes: BoundingBox[] | null) => void) | null>(null);
  const [splitAdjustDraft, setSplitAdjustDraft] = useState<{
    previewId: string;
    imageSrc: string;
    boxes: BoundingBox[];
    expectedShotNos: string[];
    sheetLabel: string;
    detecting: boolean;
    applying: boolean;
  } | null>(null);

  const syncSheetSplitSession = useCallback(
    (patch: Partial<StoryboardSheetSplitSessionState>) => {
      const next = patchStoryboardSheetSplitSession(asset.id, patch);
      sheetSplitBatchBusyRef.current = next.batchBusy;
      setSheetSplitBatchBusy(next.batchBusy);
      setSheetSplitProgress(next.progress);
      setSheetSplitBusyId(next.busyPreviewId);
      return next;
    },
    [asset.id]
  );
  const [parseBusyRowId, setParseBusyRowId] = useState<string | null>(null);
  const [parseAllBusy, setParseAllBusy] = useState(false);
  const [optimizeBusyRowId, setOptimizeBusyRowId] = useState<string | null>(null);
  const [allowOptimizeDialogue, setAllowOptimizeDialogue] = useState(() =>
    readLocalJson(STORYBOARD_OPTIMIZE_ALLOW_DIALOGUE_KEY, false, (v) => (typeof v === 'boolean' ? v : null))
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRowIdRef = useRef<string | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const editViewRef = useRef<StoryboardTableEditViewHandle>(null);
  const inputViewRef = useRef<StoryboardTableInputViewHandle>(null);
  const gridScrollToRowRef = useRef<((rowId: string) => void) | null>(null);
  const pendingEditRowIdRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const navigateToRow = useCallback(
    (rowId: string) => {
      setActiveRowId(rowId);
      requestAnimationFrame(() => {
        if (viewMode === 'grid') {
          gridScrollToRowRef.current?.(rowId);
          return;
        }
        if (viewMode === 'input') {
          inputViewRef.current?.scrollToRow(rowId);
          return;
        }
        if (viewMode === 'video') return;
        editViewRef.current?.scrollToRow(rowId);
      });
    },
    [viewMode]
  );

  const syncSheetPreviewListToCompanion = useCallback(
    async (items: StoryboardSheetPreviewItem[]) => {
      if (!companionBaseUrl.trim() || !companionProjectId.trim()) return false;
      return writeStoryboardSheetPreviewsToCompanion(
        asset.id,
        items,
        companionBaseUrl,
        companionProjectId
      );
    },
    [asset.id, companionBaseUrl, companionProjectId]
  );

  const commitSheetPreviews = useCallback(
    (updater: (prev: StoryboardSheetPreviewItem[]) => StoryboardSheetPreviewItem[], persist = false) => {
      const next = updater(sheetPreviewsRef.current);
      sheetPreviewsRef.current = next;
      setSheetPreviews(next);
      syncStoryboardSheetGenSessionPreviews(asset.id, next);
      if (persist) {
        const result = commitStoryboardSheetPreviewList(asset.id, next);
        void syncSheetPreviewListToCompanion(result.items).then((persistedCompanion) => {
          if (!result.persisted && !persistedCompanion) {
            onNotify?.('warn', '拼图列表未能持久化，请连接本地伴侣或清理浏览器存储');
          } else if (!persistedCompanion && companionBaseUrl.trim() && companionProjectId.trim()) {
            onNotify?.('warn', '拼图列表仅缓存在浏览器内，建议保持本地伴侣连接');
          }
        });
      }
      return next;
    },
    [asset.id, companionBaseUrl, companionProjectId, onNotify, syncSheetPreviewListToCompanion]
  );

  const sheetPreviewWheelItems = useMemo(
    () => sheetPreviews.filter((item) => String(item.imageDataUrl || '').trim()),
    [sheetPreviews]
  );

  const openStoryboardLightbox = useCallback((src: string) => {
    setLightboxSrc(src);
    setLightboxSheetPreviewId(null);
  }, []);

  const openSheetPreviewLightbox = useCallback(
    (preview: StoryboardSheetPreviewItem) => {
      const src = String(preview.imageDataUrl || '').trim();
      if (!src) {
        onNotify?.('warn', '拼图仍在加载，请稍后再试');
        return;
      }
      setLightboxSrc(src);
      setLightboxSheetPreviewId(preview.id);
    },
    [onNotify]
  );

  const navigateSheetPreviewLightbox = useCallback(
    (delta: number) => {
      if (!lightboxSheetPreviewId || sheetPreviewWheelItems.length <= 1) return;
      const idx = sheetPreviewWheelItems.findIndex((item) => item.id === lightboxSheetPreviewId);
      if (idx < 0) return;
      const next =
        sheetPreviewWheelItems[
          (idx + delta + sheetPreviewWheelItems.length) % sheetPreviewWheelItems.length
        ];
      if (!next) return;
      setLightboxSrc(next.imageDataUrl);
      setLightboxSheetPreviewId(next.id);
    },
    [lightboxSheetPreviewId, sheetPreviewWheelItems]
  );

  const closeStoryboardLightbox = useCallback(() => {
    setLightboxSrc(null);
    setLightboxSheetPreviewId(null);
  }, []);

  const rehydrateSheetPreviews = useCallback(async () => {
    const stored = await loadStoryboardSheetPreviewsStored(
      asset.id,
      companionBaseUrl,
      companionProjectId
    );
    const hydrated = await hydrateStoryboardSheetPreviews(
      stored,
      asset.id,
      companionBaseUrl,
      companionProjectId
    );
    commitSheetPreviews((prev) => {
      const inFlight = prev.filter(
        (item) => item.genStatus === 'pending' || item.genStatus === 'generating'
      );
      const merged = mergeStoryboardSheetPreviews(hydrated, inFlight, prev);
      return applyHydratedSheetPreviewImages(merged, hydrated);
    });
  }, [asset.id, commitSheetPreviews, companionBaseUrl, companionProjectId]);

  useEffect(() => {
    let cancelled = false;

    const applySessionState = (session: NonNullable<ReturnType<typeof getStoryboardSheetGenSession>>) => {
      sheetGenBusyRef.current = session.busy;
      setSheetGenBusy(session.busy);
      setSheetGenProgress(session.progress);
      sheetGenControllerRef.current = session.controller;
      sheetGenPlaceholderIdsRef.current = session.placeholderIdByChunk;

      if (session.busy) {
        sheetPreviewsRef.current = session.previews;
        setSheetPreviews(session.previews);
        return;
      }

      if (session.previews.length > 0) {
        const merged = mergeStoryboardSheetPreviews(session.previews, sheetPreviewsRef.current);
        sheetPreviewsRef.current = merged;
        setSheetPreviews(merged);
      }
    };

    const unsubscribe = subscribeStoryboardSheetGenSession(asset.id, (session) => {
      if (cancelled) return;
      applySessionState(session);
    });

    void (async () => {
      const genBusy = isStoryboardSheetGenSessionBusy(asset.id);

      const stored = await loadStoryboardSheetPreviewsStored(
        asset.id,
        companionBaseUrl,
        companionProjectId
      );
      if (cancelled) return;

      const hydrated = await hydrateStoryboardSheetPreviews(
        stored,
        asset.id,
        companionBaseUrl,
        companionProjectId
      );
      if (cancelled) return;

      const sessionPreviews = getStoryboardSheetGenSession(asset.id)?.previews ?? [];

      if (isStoryboardSheetGenSessionBusy(asset.id) || genBusy) {
        mergeStoryboardSheetGenSessionPreviews(asset.id, hydrated, sessionPreviews);
        return;
      }

      commitSheetPreviews((prev) => {
        const merged = mergeStoryboardSheetPreviews(hydrated, sessionPreviews, prev);
        return applyHydratedSheetPreviewImages(merged, hydrated);
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [asset.id, commitSheetPreviews, companionBaseUrl, companionProjectId]);

  useEffect(() => {
    const unsubscribe = subscribeStoryboardSheetSplitSession(asset.id, (session) => {
      sheetSplitBatchBusyRef.current = session.batchBusy;
      setSheetSplitBatchBusy(session.batchBusy);
      setSheetSplitProgress(session.progress);
      setSheetSplitBusyId(session.busyPreviewId);
    });
    return unsubscribe;
  }, [asset.id]);

  useEffect(() => {
    if (sheetGenBusy) return;
    void rehydrateSheetPreviews();
  }, [sheetGenBusy, rehydrateSheetPreviews]);

  useEffect(() => {
    setFeedbackRedrawHistory(readStoryboardFeedbackRedrawHistory(asset.id));
    setSelectedFeedbackHistoryId(readStoryboardFeedbackRedrawHistorySelection(asset.id));
  }, [asset.id]);

  const commitFeedbackRedrawHistory = useCallback(
    (
      updater: (
        prev: StoryboardFeedbackRedrawBatchRecord[]
      ) => StoryboardFeedbackRedrawBatchRecord[]
    ) => {
      setFeedbackRedrawHistory((prev) => {
        const next = updater(prev);
        writeStoryboardFeedbackRedrawHistory(asset.id, next);
        return next;
      });
    },
    [asset.id]
  );

  const onSelectFeedbackHistory = useCallback(
    (id: string | null) => {
      setSelectedFeedbackHistoryId(id);
      writeStoryboardFeedbackRedrawHistorySelection(asset.id, id);
    },
    [asset.id]
  );

  useEffect(() => {
    if (!selectedFeedbackHistoryId) return;
    if (!feedbackRedrawHistory.some((r) => r.id === selectedFeedbackHistoryId)) {
      onSelectFeedbackHistory(null);
    }
  }, [feedbackRedrawHistory, selectedFeedbackHistoryId, onSelectFeedbackHistory]);

  const openRowInEditor = useCallback(
    (rowId: string) => {
      setActiveRowId(rowId);
      pendingEditRowIdRef.current = rowId;
      setViewMode('edit');
      writeLocalJson(STORYBOARD_VIEW_STORAGE_KEY, 'edit');
    },
    []
  );

  useEffect(() => {
    const rowId = pendingEditRowIdRef.current;
    if (viewMode !== 'edit' || !rowId) return;
    pendingEditRowIdRef.current = null;
    let outer = 0;
    let inner = 0;
    outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => editViewRef.current?.scrollToRow(rowId));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [viewMode]);

  const setPanelViewMode = useCallback((mode: StoryboardPanelViewMode) => {
    setViewMode(mode);
    writeLocalJson(STORYBOARD_VIEW_STORAGE_KEY, mode);
  }, []);

  const setGridSecondsPerTilePersisted = useCallback((raw: number) => {
    const next = normalizeStoryboardGridSecondsPerTile(raw);
    setGridSecondsPerTile(next);
    writeLocalJson(STORYBOARD_GRID_SECONDS_PER_TILE_KEY, next);
  }, []);

  const setGridExportWidthPersisted = useCallback((raw: number) => {
    const next = normalizeStoryboardGridExportWidth(raw);
    setGridExportWidth(next);
    writeStoryboardGridExportWidth(next);
  }, []);

  const gridExportWidthOptions = useMemo(
    () =>
      STORYBOARD_GRID_EXPORT_WIDTH_PRESETS.map((w) => ({
        value: String(w),
        label: `${w}px 宽`,
      })),
    []
  );

  const gridGroups = useMemo(
    () =>
      groupStoryboardRowsForGridPreview(table.rows, gridSecondsPerTile, timelineLayerCount),
    [gridSecondsPerTile, table.rows, timelineLayerCount]
  );

  const handleDownloadGridGroup = useCallback(
    async (group: (typeof gridGroups)[number]) => {
      if (gridDownloadBusy) return;
      setGridDownloadBusy(true);
      try {
        const filename = await downloadStoryboardGroupMosaic(
          group,
          table.fieldCatalog,
          gridExportWidth
        );
        if (filename) {
          onNotify?.('info', `分镜拼图已保存到浏览器下载文件夹：${filename}`);
        } else {
          onNotify?.('warn', '拼图导出失败');
        }
      } finally {
        setGridDownloadBusy(false);
      }
    },
    [gridDownloadBusy, gridExportWidth, onNotify, table.fieldCatalog]
  );

  const handleDownloadAllGridGroups = useCallback(async () => {
    if (gridDownloadBusy || !gridGroups.length) return;
    setGridDownloadBusy(true);
    try {
      const count = await downloadAllStoryboardGroupMosaics(
        gridGroups,
        table.fieldCatalog,
        gridExportWidth
      );
      if (count > 0) {
        onNotify?.(
          'info',
          `已保存 ${count} 张分镜拼图到浏览器下载文件夹（${gridExportWidth}px 宽，文件名以 storyboard- 开头）`
        );
      } else {
        onNotify?.('warn', '没有可导出的拼图');
      }
    } finally {
      setGridDownloadBusy(false);
    }
  }, [gridDownloadBusy, gridExportWidth, gridGroups, onNotify, table.fieldCatalog]);

  const gridSecondsOptions = useMemo(() => {
    const base = STORYBOARD_GRID_SECONDS_PRESETS.map((sec) => ({
      value: String(sec),
      label: `${sec} 秒/张`,
    }));
    const cur = String(gridSecondsPerTile);
    if (!base.some((o) => o.value === cur)) {
      base.push({ value: cur, label: `${gridSecondsPerTile} 秒/张` });
    }
    return base.sort((a, b) => Number(a.value) - Number(b.value));
  }, [gridSecondsPerTile]);

  useEffect(() => {
    if (viewMode !== 'edit') return;
    const firstId = table.rows[0]?.id;
    if (firstId) editViewRef.current?.scrollToRow(firstId);
  }, [asset.id, viewMode]);

  const title = readStoryboardTableTitleRaw(asset);

  const resolvedRedrawPresetId = useMemo(() => {
    const stored = readLocalJson(redrawPresetStorageKey, defaultRedrawPresetId, (v) =>
      typeof v === 'string' ? v : null
    );
    if (stored && redrawPresets.some((p) => p.id === stored)) return stored;
    if (defaultRedrawPresetId && redrawPresets.some((p) => p.id === defaultRedrawPresetId)) {
      return defaultRedrawPresetId;
    }
    return redrawPresets[0]?.id ?? '';
  }, [defaultRedrawPresetId, redrawPresets, redrawPresetStorageKey]);

  const [redrawPresetId, setRedrawPresetId] = useState(resolvedRedrawPresetId);

  useEffect(() => {
    setRedrawPresetId(resolvedRedrawPresetId);
  }, [asset.id, resolvedRedrawPresetId]);

  const effectiveRedrawPresetId = redrawPresetId;

  const resolvedEditRedrawModelId = useMemo(() => {
    const stored = readLocalJson(STORYBOARD_EDIT_REDRAW_MODEL_KEY, DEFAULT_IMAGE_MODEL_REGISTRY_ID, (v) =>
      typeof v === 'string' ? v : null
    );
    return coerceImageModelRegistryId(stored);
  }, []);

  const [editRedrawModelId, setEditRedrawModelId] = useState(resolvedEditRedrawModelId);

  useEffect(() => {
    setEditRedrawModelId(resolvedEditRedrawModelId);
  }, [asset.id, resolvedEditRedrawModelId]);

  const effectiveEditRedrawModelId = editRedrawModelId;

  const setEditRedrawModelIdPersisted = useCallback((modelId: string) => {
    const coerced = coerceImageModelRegistryId(modelId);
    setEditRedrawModelId(coerced);
    writeLocalJson(STORYBOARD_EDIT_REDRAW_MODEL_KEY, coerced);
  }, []);

  const feedbackCollagePresetList = useMemo(
    () => listStoryboardFeedbackCollageRedrawPresets(redrawPresets),
    [redrawPresets]
  );

  const resolvedFeedbackCollagePresetId = useMemo(() => {
    const stored = readLocalJson(
      STORYBOARD_EDIT_FEEDBACK_COLLAGE_PRESET_KEY,
      pickDefaultStoryboardFeedbackCollagePresetId(redrawPresets),
      (v) => (typeof v === 'string' ? v : null)
    );
    if (stored && feedbackCollagePresetList.some((p) => p.id === stored)) return stored;
    return pickDefaultStoryboardFeedbackCollagePresetId(redrawPresets);
  }, [feedbackCollagePresetList, redrawPresets]);

  const [feedbackCollagePresetId, setFeedbackCollagePresetId] = useState(
    resolvedFeedbackCollagePresetId
  );

  useEffect(() => {
    setFeedbackCollagePresetId(resolvedFeedbackCollagePresetId);
  }, [asset.id, resolvedFeedbackCollagePresetId]);

  const effectiveFeedbackCollagePresetId = feedbackCollagePresetId;

  const activeFeedbackCollagePreset = useMemo(
    () => resolveStoryboardFeedbackCollagePreset(redrawPresets, effectiveFeedbackCollagePresetId),
    [effectiveFeedbackCollagePresetId, redrawPresets]
  );

  const setFeedbackCollagePresetIdPersisted = useCallback((presetId: string) => {
    setFeedbackCollagePresetId(presetId);
    writeLocalJson(STORYBOARD_EDIT_FEEDBACK_COLLAGE_PRESET_KEY, presetId);
  }, []);

  const feedbackCollagePresetOptions = useMemo(
    () =>
      feedbackCollagePresetList.map((preset) => ({
        value: preset.id,
        label: preset.label || preset.id,
      })),
    [feedbackCollagePresetList]
  );

  const resolvedFeedbackCollageModelId = useMemo(() => {
    const fallback = readLocalJson(STORYBOARD_EDIT_REDRAW_MODEL_KEY, DEFAULT_IMAGE_MODEL_REGISTRY_ID, (v) =>
      typeof v === 'string' ? v : null
    );
    const stored = readLocalJson(STORYBOARD_EDIT_FEEDBACK_COLLAGE_MODEL_KEY, fallback, (v) =>
      typeof v === 'string' ? v : null
    );
    return coerceImageModelRegistryId(stored);
  }, []);

  const [feedbackCollageModelId, setFeedbackCollageModelId] = useState(resolvedFeedbackCollageModelId);

  useEffect(() => {
    setFeedbackCollageModelId(resolvedFeedbackCollageModelId);
  }, [asset.id, resolvedFeedbackCollageModelId]);

  const effectiveFeedbackCollageModelId = feedbackCollageModelId;

  const setFeedbackCollageModelIdPersisted = useCallback((modelId: string) => {
    const coerced = coerceImageModelRegistryId(modelId);
    setFeedbackCollageModelId(coerced);
    writeLocalJson(STORYBOARD_EDIT_FEEDBACK_COLLAGE_MODEL_KEY, coerced);
  }, []);

  const feedbackCollageModelOptions = useMemo(
    () => DIALOG_IMAGE_MODELS.map((m) => ({ value: m.id, label: m.label })),
    []
  );

  const editRedrawModelOptions = useMemo(
    () => DIALOG_IMAGE_MODELS.map((m) => ({ value: m.id, label: m.label })),
    []
  );

  const redrawPresetOptions = useMemo(
    () => redrawPresets.map((preset) => ({ value: preset.id, label: preset.label || preset.id })),
    [redrawPresets]
  );

  const setRedrawPresetIdPersisted = useCallback(
    (presetId: string) => {
      setRedrawPresetId(presetId);
      writeLocalJson(redrawPresetStorageKey, presetId);
    },
    [redrawPresetStorageKey]
  );

  const effectiveParsePresetId = useMemo(() => {
    const fromTable = table.parsePresetId?.trim();
    if (fromTable && effectiveParsePresets.some((p) => p.id === fromTable)) return fromTable;
    const stored = readLocalJson(STORYBOARD_PARSE_PRESET_KEY, defaultParsePresetId, (v) =>
      typeof v === 'string' ? v : null
    );
    if (stored && effectiveParsePresets.some((p) => p.id === stored)) return stored;
    const picked = pickDefaultStoryboardParsePresetId(effectiveParsePresets);
    if (picked) return picked;
    if (defaultParsePresetId && effectiveParsePresets.some((p) => p.id === defaultParsePresetId)) {
      return defaultParsePresetId;
    }
    return effectiveParsePresets[0]?.id ?? '';
  }, [defaultParsePresetId, effectiveParsePresets, table.parsePresetId]);

  const effectiveOptimizePresetId = useMemo(() => {
    const fromTable = table.optimizePresetId?.trim();
    if (fromTable && effectiveOptimizePresets.some((p) => p.id === fromTable)) return fromTable;
    const stored = readLocalJson(STORYBOARD_OPTIMIZE_PRESET_KEY, defaultOptimizePresetId, (v) =>
      typeof v === 'string' ? v : null
    );
    if (stored && effectiveOptimizePresets.some((p) => p.id === stored)) return stored;
    const picked = pickDefaultStoryboardOptimizePresetId(effectiveOptimizePresets);
    if (picked) return picked;
    if (defaultOptimizePresetId && effectiveOptimizePresets.some((p) => p.id === defaultOptimizePresetId)) {
      return defaultOptimizePresetId;
    }
    return effectiveOptimizePresets[0]?.id ?? '';
  }, [defaultOptimizePresetId, effectiveOptimizePresets, table.optimizePresetId]);

  const parsePresetOptions = useMemo(
    () => effectiveParsePresets.map((p) => ({ value: p.id, label: p.label || p.id })),
    [effectiveParsePresets]
  );

  const activeParsePreset = useMemo(() => {
    if (effectiveParsePresetId) {
      const matched = effectiveParsePresets.find((preset) => preset.id === effectiveParsePresetId);
      if (matched) return matched;
    }
    return effectiveParsePresets[0] ?? getBuiltinStoryboardParsePreset();
  }, [effectiveParsePresetId, effectiveParsePresets]);

  const optimizePresetOptions = useMemo(
    () => effectiveOptimizePresets.map((p) => ({ value: p.id, label: p.label || p.id })),
    [effectiveOptimizePresets]
  );

  const setParsePresetId = useCallback(
    (presetId: string) => {
      writeLocalJson(STORYBOARD_PARSE_PRESET_KEY, presetId);
      onPatchAsset((cur) => {
        const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
        const titleRaw = readStoryboardTableTitleRaw(cur);
        return {
          ...cur,
          textTitle: titleRaw,
          storyboardTable: { ...doc, title: titleRaw, parsePresetId: presetId },
        };
      });
    },
    [onPatchAsset]
  );

  const setOptimizePresetId = useCallback(
    (presetId: string) => {
      writeLocalJson(STORYBOARD_OPTIMIZE_PRESET_KEY, presetId);
      onPatchAsset((cur) => {
        const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
        const titleRaw = readStoryboardTableTitleRaw(cur);
        return {
          ...cur,
          textTitle: titleRaw,
          storyboardTable: { ...doc, title: titleRaw, optimizePresetId: presetId },
        };
      });
    },
    [onPatchAsset]
  );

  const toggleAllowOptimizeDialogue = useCallback(() => {
    setAllowOptimizeDialogue((prev) => {
      const next = !prev;
      writeLocalJson(STORYBOARD_OPTIMIZE_ALLOW_DIALOGUE_KEY, next);
      return next;
    });
  }, []);

  const notifyCatalogSize = useCallback(
    (catalog: StoryboardParseFieldDef[]) => {
      maybeWarnLargeFieldCatalog(catalog, (msg) => onNotify?.('info', msg));
    },
    [onNotify]
  );

  const parseCtx = useMemo(
    () => ({
      onLog: (level: 'info' | 'warn', message: string) =>
        onNotify?.(level === 'warn' ? 'warn' : 'info', message),
      textModelRegistryId: capabilityTextModel,
    }),
    [capabilityTextModel, onNotify]
  );

  useEffect(() => {
    if (!table.rows.length) {
      setActiveRowId(null);
      return;
    }
    if (!activeRowId || !table.rows.some((r) => r.id === activeRowId)) {
      setActiveRowId(table.rows[0]!.id);
    }
  }, [activeRowId, table.rows]);

  /** 仅挂载时抢焦点到关闭钮；勿把 onClose 放进 deps（父组件每次 patch 会换新函数，会反复抢走行内输入焦点）。 */
  useEffect(() => {
    closeBtnRef.current?.focus({ preventScroll: true });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !lightboxSrc) {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [lightboxSrc]);

  const patchTable = useCallback(
    (
      mutate: (rows: StoryboardTableRow[]) => StoryboardTableRow[],
      options?: { fieldCatalog?: StoryboardParseFieldDef[] }
    ) => {
      onPatchAsset((cur) => {
        const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
        const titleRaw = readStoryboardTableTitleRaw(cur);
        const catalog = options?.fieldCatalog ?? doc.fieldCatalog;
        const nextRows = reindexStoryboardRows(mutate([...doc.rows])).map((r) =>
          applyShotFieldsPatch(r, catalog, r.shotFields)
        );
        return {
          ...cur,
          textTitle: titleRaw,
          storyboardTable: {
            ...doc,
            title: titleRaw,
            fieldCatalog: catalog,
            rows: nextRows,
          },
        };
      });
    },
    [onPatchAsset]
  );

  const patchRow = useCallback(
    (rowId: string, patch: Partial<StoryboardTableRow>) => {
      onPatchAsset((cur) => {
        const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
        const titleRaw = readStoryboardTableTitleRaw(cur);
        const rows = doc.rows.map((r) => {
          if (r.id !== rowId) return r;
          if (storyboardRowIsPassed(r) && !canPatchStoryboardPassedRow(patch)) return r;
          if (patch.shotFields) {
            return applyShotFieldsPatch(
              { ...r, ...patch },
              doc.fieldCatalog,
              { ...r.shotFields, ...patch.shotFields }
            );
          }
          const next = { ...r, ...patch };
          return applyShotFieldsPatch(next, doc.fieldCatalog, next.shotFields);
        });
        return {
          ...cur,
          textTitle: titleRaw,
          storyboardTable: { ...doc, title: titleRaw, rows },
        };
      });
    },
    [onPatchAsset]
  );

  const patchRoleAssets = useCallback(
    (mutate: (assets: StoryboardRoleAsset[]) => StoryboardRoleAsset[]) => {
      onPatchAsset((cur) => {
        const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
        const titleRaw = readStoryboardTableTitleRaw(cur);
        const nextAssets = mutate([...(doc.roleAssets ?? [])]);
        return {
          ...cur,
          textTitle: titleRaw,
          storyboardTable: {
            ...doc,
            title: titleRaw,
            roleAssets: nextAssets.length ? nextAssets : undefined,
          },
        };
      });
    },
    [onPatchAsset]
  );

  const addRoleAsset = useCallback(() => {
    if (readOnly) return;
    patchRoleAssets((assets) => [...assets, createStoryboardRoleAsset(undefined, assets.length)]);
  }, [patchRoleAssets, readOnly]);

  const removeRoleAsset = useCallback(
    (id: string) => {
      if (readOnly) return;
      patchRoleAssets((assets) => assets.filter((item) => item.id !== id));
    },
    [patchRoleAssets, readOnly]
  );

  const renameRoleAsset = useCallback(
    (id: string, name: string) => {
      if (readOnly) return;
      patchRoleAssets((assets) =>
        assets.map((item) => (item.id === id ? { ...item, name } : item))
      );
    },
    [patchRoleAssets, readOnly]
  );

  const assignRoleAssetImage = useCallback(
    async (id: string, file: File) => {
      if (readOnly) return;
      setRoleAssetBusyId(id);
      try {
        const dataUrl = await readStoryboardFrameFromFile(file);
        patchRoleAssets((assets) =>
          assets.map((item) => (item.id === id ? { ...item, image: dataUrl } : item))
        );
      } catch (err) {
        onNotify?.('warn', err instanceof Error ? err.message : '图片处理失败');
      } finally {
        setRoleAssetBusyId(null);
      }
    },
    [onNotify, patchRoleAssets, readOnly]
  );

  const clearRoleAssetImage = useCallback(
    (id: string) => {
      if (readOnly) return;
      patchRoleAssets((assets) =>
        assets.map((item) => (item.id === id ? { ...item, image: undefined } : item))
      );
    },
    [patchRoleAssets, readOnly]
  );

  const addFrameRoleMark = useCallback(
    (
      rowId: string,
      mark: { name: string; x: number; y: number; roleAssetId?: string }
    ) => {
      if (readOnly) return;
      const row = table.rows.find((item) => item.id === rowId);
      if (!row) return;
      if (storyboardRowIsPassed(row)) {
        onNotify?.('warn', '该镜头已通过，无法标注角色');
        return;
      }
      patchRow(rowId, {
        frameRoleMarks: appendStoryboardFrameRoleMark(row.frameRoleMarks, mark),
      });
    },
    [onNotify, patchRow, readOnly, table.rows]
  );

  const patchRows = useCallback(
    (rowIds: string[], patch: Partial<StoryboardTableRow>) => {
      const idSet = new Set(rowIds);
      if (!idSet.size) return;
      onPatchAsset((cur) => {
        const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
        const titleRaw = readStoryboardTableTitleRaw(cur);
        const rows = doc.rows.map((r) => {
          if (!idSet.has(r.id)) return r;
          if (storyboardRowIsPassed(r) && !canPatchStoryboardPassedRow(patch)) return r;
          if (patch.shotFields) {
            return applyShotFieldsPatch(
              { ...r, ...patch },
              doc.fieldCatalog,
              { ...r.shotFields, ...patch.shotFields }
            );
          }
          const next = { ...r, ...patch };
          return applyShotFieldsPatch(next, doc.fieldCatalog, next.shotFields);
        });
        return {
          ...cur,
          textTitle: titleRaw,
          storyboardTable: { ...doc, title: titleRaw, rows },
        };
      });
    },
    [onPatchAsset]
  );

  const clearEditFeedbackForRows = useCallback(
    (rowIds: string[]) => {
      const ids = [...new Set(rowIds.filter(Boolean))];
      if (!ids.length) return;
      patchRows(ids, { editFeedback: '' });
    },
    [patchRows]
  );

  const clearAllEditFeedback = useCallback(() => {
    const rowIds = listStoryboardRowsWithEditFeedback(table.rows)
      .filter((row) => !storyboardRowIsPassed(row))
      .map((row) => row.id);
    if (!rowIds.length) {
      onNotify?.('warn', '没有可清除的修改反馈');
      return;
    }
    if (!window.confirm(`清除全部 ${rowIds.length} 镜的修改反馈？`)) return;
    clearEditFeedbackForRows(rowIds);
    onNotify?.('info', `已清除 ${rowIds.length} 镜修改反馈`);
  }, [clearEditFeedbackForRows, onNotify, table.rows]);

  const importInputRows = useCallback(
    (result: { catalog: StoryboardParseFieldDef[]; rows: StoryboardTableRow[] }) => {
      patchTable(() => reindexStoryboardRows(result.rows), { fieldCatalog: result.catalog });
      const firstId = result.rows[0]?.id;
      if (firstId) navigateToRow(firstId);
    },
    [patchTable, navigateToRow]
  );

  const applySheetVisionSplitResult = useCallback(
    async (
      split: StoryboardSheetVisionSplitResult,
      taskRows: StoryboardTableRow[],
      fieldCatalog: StoryboardParseFieldDef[],
      lookupRows: StoryboardTableRow[]
    ) => {
      const rowLookup = new Map<string, StoryboardTableRow>();
      for (const row of [...lookupRows, ...(split.createdRows ?? [])]) {
        rowLookup.set(row.id, row);
      }

      const rowPatches = new Map<string, Partial<StoryboardTableRow>>();
      const rowImages: Record<string, string> = {};
      for (const match of split.matches) {
        let compressed = match.image;
        try {
          compressed = await compressStoryboardFrameDataUrl(match.image);
        } catch {
          /* keep raw */
        }
        const tableRow = rowLookup.get(match.rowId) ?? taskRows.find((row) => row.id === match.rowId);
        if (!tableRow) continue;
        rowImages[match.rowId] = compressed;
        const patch = await replaceStoryboardRowFrame({
          row: tableRow,
          dataUrl: compressed,
          assetId: asset.id,
          companionBaseUrl,
          companionProjectId,
          source: 'sheet_split',
        });
        rowPatches.set(match.rowId, patch);
      }

      const createdRowsToAdd = (split.createdRows ?? []).filter(
        (row) => !lookupRows.some((item) => item.id === row.id)
      );
      if (rowPatches.size > 0 || createdRowsToAdd.length > 0) {
        patchTable(
          (rows) => {
            const existing = new Set(rows.map((row) => row.id));
            let next = [...rows];
            for (const row of createdRowsToAdd) {
              if (!existing.has(row.id)) {
                next.push(row);
                existing.add(row.id);
              }
            }
            next = reindexStoryboardRows(next);
            return next.map((row) =>
              rowPatches.has(row.id) ? { ...row, ...rowPatches.get(row.id) } : row
            );
          },
          { fieldCatalog }
        );
      }

      return { matchedCount: split.matches.length, warn: split.warn, rowImages };
    },
    [asset.id, companionBaseUrl, companionProjectId, patchTable]
  );

  const commitSheetVisionSplit = useCallback(
    async (
      sheetImage: string,
      taskRows: StoryboardTableRow[],
      fieldCatalog: StoryboardParseFieldDef[],
      feedbackLayout?: FeedbackCollageLayout,
      opts?: {
        allRows?: StoryboardTableRow[];
        expectedShotNos?: string[];
        autoCreateRows?: boolean;
        allowGridFallback?: boolean;
        layoutGrid?: { cols: number; rows: number };
      }
    ) => {
      let normalized = sheetImage;
      try {
        normalized = await compressStoryboardFrameDataUrl(sheetImage);
      } catch {
        /* keep raw */
      }

      const lookupRows = opts?.allRows ?? taskRows;
      const split = feedbackLayout
        ? await splitStoryboardFeedbackCollageByLayout(normalized, feedbackLayout, taskRows)
        : await splitStoryboardSheetByVision(
            normalized,
            taskRows,
            capabilityTextModel,
            {
              timeoutMs: WORKFLOW_CUT_DETECT_TIMEOUT_MS,
              autoCreateRows: opts?.autoCreateRows,
              expectedShotNos: opts?.expectedShotNos,
              allowGridFallback: opts?.allowGridFallback,
              layoutGrid: opts?.layoutGrid,
            }
          );

      return applySheetVisionSplitResult(split, taskRows, fieldCatalog, lookupRows);
    },
    [applySheetVisionSplitResult, capabilityTextModel]
  );

  const promptSheetSplitBoxAdjust = useCallback(
    (
      draft: Omit<NonNullable<typeof splitAdjustDraft>, 'detecting' | 'applying'>,
      detectBoxes: () => Promise<BoundingBox[]>
    ) =>
      new Promise<BoundingBox[] | null>((resolve) => {
        splitAdjustResolverRef.current = resolve;
        setSplitAdjustDraft({ ...draft, detecting: true, applying: false });
        void detectBoxes()
          .then((boxes) => {
            setSplitAdjustDraft((prev) =>
              prev?.previewId === draft.previewId ? { ...prev, boxes, detecting: false } : prev
            );
          })
          .catch((error) => {
            setSplitAdjustDraft((prev) =>
              prev?.previewId === draft.previewId ? { ...prev, detecting: false } : prev
            );
            onNotify?.(
              'warn',
              error instanceof Error ? error.message : '识别切分框失败，可手动框选后确认'
            );
          });
      }),
    [onNotify]
  );

  const closeSheetSplitBoxAdjust = useCallback(() => {
    splitAdjustResolverRef.current?.(null);
    splitAdjustResolverRef.current = null;
    setSplitAdjustDraft(null);
  }, []);

  const confirmSheetSplitBoxAdjust = useCallback((boxes: BoundingBox[]) => {
    splitAdjustResolverRef.current?.(boxes);
    splitAdjustResolverRef.current = null;
    setSplitAdjustDraft((prev) => (prev ? { ...prev, applying: true, detecting: false } : prev));
  }, []);

  const saveSheetPreviewItem = useCallback(
    async (
      partial: Omit<StoryboardSheetPreviewItem, 'id' | 'createdAt' | 'matchedCount'> & {
        matchedCount?: number;
        id?: string;
      }
    ): Promise<StoryboardSheetPreviewItem> => {
      const run = async (): Promise<StoryboardSheetPreviewItem> => {
        const existingId = String(partial.id || '').trim();
        const existing = existingId
          ? sheetPreviewsRef.current.find((item) => item.id === existingId) ??
            findStoryboardSheetGenSessionPreview(asset.id, existingId)
          : undefined;
        const draft = existing
          ? { ...existing, ...partial, id: existing.id }
          : createSheetPreviewItem(partial);
        const prepared = await prepareStoryboardSheetPreviewForSave({
          assetId: asset.id,
          preview: draft,
          companionBaseUrl,
          companionProjectId,
        });

        commitSheetPreviews((prev) => {
          const result = existing
            ? upsertStoryboardSheetPreview(asset.id, prepared.preview, prev)
            : prependStoryboardSheetPreview(asset.id, prepared.preview, prev);
          if (!result.persisted) {
            if (prepared.persistedImage === 'companion' || prepared.persistedImage === 'idb') {
              onNotify?.('warn', '拼图元数据写入失败，图片已落盘但刷新后可能无法恢复列表');
            } else if (prepared.persistedImage === 'inline') {
              onNotify?.('warn', '拼图未能持久化，请连接本地伴侣或清理浏览器存储');
            }
          } else if (prepared.persistedImage === 'inline') {
            onNotify?.('warn', '拼图仅缓存在浏览器内，建议连接本地伴侣');
          }
          void syncSheetPreviewListToCompanion(result.items);
          return result.items;
        });
        return prepared.preview;
      };

      const next = sheetPreviewSaveChainRef.current.then(run, run);
      sheetPreviewSaveChainRef.current = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
    [asset.id, commitSheetPreviews, companionBaseUrl, companionProjectId, onNotify, syncSheetPreviewListToCompanion]
  );

  const patchSheetPreviewInMemory = useCallback(
    (previewId: string, patch: Partial<StoryboardSheetPreviewItem>) => {
      commitSheetPreviews((prev) =>
        prev.map((item) => (item.id === previewId ? { ...item, ...patch } : item))
      );
    },
    [commitSheetPreviews]
  );

  const splitSheetPreviewById = useCallback(
    async (
      previewId: string
    ): Promise<{ matchedCount: number; warn?: string; label: string } | null> => {
      const item = sheetPreviewsRef.current.find((preview) => preview.id === previewId);
      if (!item) return null;

      let workingRows = table.rows;
      if (item.shotNos.length) {
        const ensured = ensureStoryboardRowsForShotNos(workingRows, item.shotNos);
        if (ensured.createdIds.length) {
          patchTable(() => reindexStoryboardRows(ensured.nextTableRows), {
            fieldCatalog: table.fieldCatalog,
          });
          workingRows = ensured.nextTableRows;
        }
      }

      const taskRows = resolveSheetTaskRows(workingRows, item.rowIds, item.shotNos);
      if (!taskRows.length) {
        return { matchedCount: 0, warn: '找不到对应镜头，请检查镜号范围', label: item.label };
      }

      const resolved = await resolveStoryboardSheetPreviewDataUrl(
        item,
        asset.id,
        companionBaseUrl,
        companionProjectId
      );
      if (!resolved.ok) {
        return { matchedCount: 0, warn: resolved.error, label: item.label };
      }

      const layoutGrid =
        item.layoutCols != null && item.layoutRows != null
          ? { cols: item.layoutCols, rows: item.layoutRows }
          : undefined;

      let normalized = resolved.dataUrl;
      try {
        normalized = await compressStoryboardFrameDataUrl(resolved.dataUrl);
      } catch {
        /* keep raw */
      }

      try {
        const adjustedBoxes = await promptSheetSplitBoxAdjust(
          {
            previewId,
            imageSrc: normalized,
            boxes: [],
            expectedShotNos: item.shotNos,
            sheetLabel: item.label,
          },
          async () => {
            let boxes = await detectStoryboardSheetPanels(
              normalized,
              item.shotNos,
              capabilityTextModel,
              { timeoutMs: WORKFLOW_CUT_DETECT_TIMEOUT_MS }
            );
            if (!boxes.length && layoutGrid) {
              boxes = buildLayoutSheetGridBoxes(
                layoutGrid,
                Math.max(taskRows.length, item.shotNos.length || 1)
              );
            }
            return boxes;
          }
        );
        if (!adjustedBoxes) {
          return null;
        }

        const split = await splitStoryboardSheetFromBoxes(normalized, taskRows, adjustedBoxes, {
          expectedShotNos: item.shotNos,
          autoCreateRows: true,
          allowGridFallback: false,
          layoutGrid,
        });
        const { matchedCount, warn } = await applySheetVisionSplitResult(
          split,
          taskRows,
          table.fieldCatalog,
          workingRows
        );
        const nextRowIds = taskRows.map((row) => row.id);
        const updateResult = updateStoryboardSheetPreview(
          asset.id,
          previewId,
          { matchedCount, rowIds: nextRowIds },
          sheetPreviewsRef.current
        );
        commitSheetPreviews(() => updateResult.items);
        void syncSheetPreviewListToCompanion(updateResult.items);
        return { matchedCount, warn, label: item.label };
      } finally {
        setSplitAdjustDraft(null);
      }
    },
    [
      applySheetVisionSplitResult,
      asset.id,
      capabilityTextModel,
      commitSheetPreviews,
      companionBaseUrl,
      companionProjectId,
      patchTable,
      promptSheetSplitBoxAdjust,
      syncSheetPreviewListToCompanion,
      table.fieldCatalog,
      table.rows,
    ]
  );

  const applySheetPreview = useCallback(
    async (previewId: string): Promise<{ matchedCount: number } | void> => {
      if (isStoryboardSheetSplitSessionBusy(asset.id)) {
        onNotify?.('info', '切分仍在进行中，请稍候');
        return;
      }
      syncSheetSplitSession({
        busy: true,
        batchBusy: false,
        progress: null,
        busyPreviewId: previewId,
      });
      try {
        const result = await splitSheetPreviewById(previewId);
        if (!result) return;
        if (result.matchedCount > 0) {
          onNotify?.('info', `已切分回填 ${result.matchedCount} 镜`);
          return { matchedCount: result.matchedCount };
        }
        onNotify?.('warn', result.warn || '未能切分匹配到镜头，请检查拼图镜号');
      } catch (error) {
        onNotify?.('warn', error instanceof Error ? error.message : '切分回填失败');
      } finally {
        clearStoryboardSheetSplitSessionBusy(asset.id);
      }
    },
    [asset.id, onNotify, splitSheetPreviewById, syncSheetSplitSession]
  );

  const activateSheetPreviewVersion = useCallback(
    async (previewId: string, versionId: string) => {
      const item = sheetPreviewsRef.current.find((preview) => preview.id === previewId);
      if (!item) return;
      try {
        const next = await activateSheetPreviewHistoryVersion(item, versionId, {
          assetId: asset.id,
          companionBaseUrl,
          companionProjectId,
        });
        const updateResult = updateStoryboardSheetPreview(
          asset.id,
          previewId,
          {
            imageDataUrl: next.imageDataUrl,
            imageCompanionKey: next.imageCompanionKey,
            imageIdbKey: next.imageIdbKey,
            imageHistory: next.imageHistory,
            matchedCount: next.matchedCount,
          },
          sheetPreviewsRef.current
        );
        commitSheetPreviews(() => updateResult.items);
        void syncSheetPreviewListToCompanion(updateResult.items);
      } catch (error) {
        onNotify?.('warn', error instanceof Error ? error.message : '切换历史版本失败');
      }
    },
    [asset.id, commitSheetPreviews, companionBaseUrl, companionProjectId, onNotify, syncSheetPreviewListToCompanion]
  );

  const regenerateSheetPreview = useCallback(
    async (previewId: string) => {
      const probe = await probeStoryboardSheetGenCompanionReady(
        companionBaseUrl,
        companionProjectId
      );
      if (!probe.ok) {
        onNotify?.('warn', storyboardSheetGenCompanionProbeMessage(probe.reason));
        return;
      }

      const item = sheetPreviewsRef.current.find((preview) => preview.id === previewId);
      if (!item || item.source !== 'generated') return;
      if (item.genStatus === 'pending' || item.genStatus === 'generating') return;

      const preset = redrawPresets.find((entry) => entry.id === effectiveRedrawPresetId);
      if (!preset) {
        onNotify?.('warn', redrawPresets.length ? '请选择有效的生图能力' : '请先在功能区启用文生图/图生图能力');
        return;
      }

      let workingRows = table.rows;
      if (item.shotNos.length) {
        const ensured = ensureStoryboardRowsForShotNos(workingRows, item.shotNos);
        if (ensured.createdIds.length) {
          patchTable(() => reindexStoryboardRows(ensured.nextTableRows), {
            fieldCatalog: table.fieldCatalog,
          });
          workingRows = ensured.nextTableRows;
        }
      }

      const taskRows = resolveSheetTaskRows(workingRows, item.rowIds, item.shotNos);
      if (!taskRows.length) {
        onNotify?.('warn', '找不到对应镜头，无法重生成');
        return;
      }

      setSheetRegenBusyId(previewId);
      patchSheetPreviewInMemory(previewId, { genStatus: 'generating', genError: undefined });
      try {
        const result = await executeStoryboardSheetGen({
          preset,
          rows: taskRows,
          fieldCatalog: table.fieldCatalog,
          ctx: parseCtx,
          forceTextToImage: preset.category === 'image_to_image',
          chunkIndex: item.chunkIndex,
        });
        if (!result.ok) {
          patchSheetPreviewInMemory(previewId, { genStatus: 'failed', genError: result.error });
          onNotify?.('warn', result.error);
          return;
        }

        let sheetImage = result.image;
        try {
          sheetImage = await compressStoryboardFrameDataUrl(sheetImage);
        } catch {
          /* keep raw */
        }

        const current = sheetPreviewsRef.current.find((preview) => preview.id === previewId);
        if (!current) return;
        const replaced = await replaceSheetPreviewActiveImage(current, sheetImage, 'regenerate', {
          assetId: asset.id,
          companionBaseUrl,
          companionProjectId,
        });
        const updateResult = updateStoryboardSheetPreview(
          asset.id,
          previewId,
          {
            imageDataUrl: replaced.imageDataUrl,
            imageCompanionKey: replaced.imageCompanionKey,
            imageIdbKey: replaced.imageIdbKey,
            imageHistory: replaced.imageHistory,
            matchedCount: replaced.matchedCount,
            genStatus: replaced.genStatus,
            genError: replaced.genError,
          },
          sheetPreviewsRef.current
        );
        commitSheetPreviews(() => updateResult.items);
        void syncSheetPreviewListToCompanion(updateResult.items);
        onNotify?.('info', '拼图已重新生成，可切分当前版本');
      } catch (error) {
        patchSheetPreviewInMemory(previewId, {
          genStatus: 'failed',
          genError: error instanceof Error ? error.message : '重生成失败',
        });
        onNotify?.('warn', error instanceof Error ? error.message : '重生成失败');
      } finally {
        setSheetRegenBusyId(null);
      }
    },
    [
      asset.id,
      companionBaseUrl,
      companionProjectId,
      effectiveRedrawPresetId,
      onNotify,
      parseCtx,
      commitSheetPreviews,
      patchSheetPreviewInMemory,
      patchTable,
      redrawPresets,
      syncSheetPreviewListToCompanion,
      table.fieldCatalog,
      table.rows,
    ]
  );

  const batchSplitSheetPreviews = useCallback(async (): Promise<{ matchedCount: number } | void> => {
    if (isStoryboardSheetSplitSessionBusy(asset.id)) {
      onNotify?.('info', '切分仍在进行中，请稍候');
      return;
    }

    const candidates = listSplittableStoryboardSheetPreviews(sheetPreviewsRef.current).sort(
      (a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0) || a.createdAt - b.createdAt
    );
    if (!candidates.length) {
      onNotify?.('warn', '没有可切分的拼图，请先生成或上传');
      return;
    }

    syncSheetSplitSession({
      busy: true,
      batchBusy: true,
      progress: { done: 0, total: candidates.length },
      busyPreviewId: null,
    });
    let totalMatched = 0;
    let okSheets = 0;

    try {
      for (let i = 0; i < candidates.length; i += 1) {
        const item = candidates[i]!;
        syncSheetSplitSession({
          busyPreviewId: item.id,
          progress: { done: i, total: candidates.length },
        });
        const result = await splitSheetPreviewById(item.id);
        if (result === null) {
          onNotify?.('info', '已取消切分');
          break;
        }
        if (result.matchedCount) {
          totalMatched += result.matchedCount;
          okSheets += 1;
        } else if (result?.warn) {
          onNotify?.('warn', `${result.label}：${result.warn}`);
        }
        syncSheetSplitSession({ progress: { done: i + 1, total: candidates.length } });
      }

      if (totalMatched > 0) {
        onNotify?.('info', `切分完成：${okSheets}/${candidates.length} 张拼图，共回填 ${totalMatched} 镜`);
        return { matchedCount: totalMatched };
      }
      onNotify?.('warn', '切分完成，但未能匹配到镜头，请检查拼图镜号与表内 shotNo');
    } catch (error) {
      onNotify?.('warn', error instanceof Error ? error.message : '批量切分失败');
    } finally {
      clearStoryboardSheetSplitSessionBusy(asset.id);
    }
  }, [asset.id, onNotify, splitSheetPreviewById, syncSheetSplitSession]);

  const cancelSheetGen = useCallback(() => {
    const controller = sheetGenControllerRef.current;
    if (!controller || !sheetGenBusyRef.current) return;

    const pendingChunks = sheetPreviewsRef.current
      .filter((item) => item.genStatus === 'pending' && item.chunkIndex != null)
      .map((item) => item.chunkIndex as number);
    if (!pendingChunks.length) {
      onNotify?.('info', '没有可取消的排队任务');
      return;
    }

    controller.cancelPendingChunks(pendingChunks);
    commitSheetPreviews((prev) =>
      prev.filter((item) => item.genStatus !== 'pending')
    );
    onNotify?.('info', `已取消 ${pendingChunks.length} 个排队任务`);
  }, [commitSheetPreviews, onNotify]);

  const cancelSheetGenTask = useCallback(
    (previewId: string) => {
      const controller = sheetGenControllerRef.current;
      if (!controller || !sheetGenBusyRef.current) return;
      const item = sheetPreviewsRef.current.find((preview) => preview.id === previewId);
      if (!item || item.genStatus !== 'pending' || item.chunkIndex == null) return;

      controller.cancelChunk(item.chunkIndex);
      commitSheetPreviews((prev) => prev.filter((preview) => preview.id !== previewId));
    },
    [commitSheetPreviews]
  );

  const uploadSheetPreview = useCallback(
    async (
      dataUrl: string,
      payload: {
        shotFrom: string;
        shotTo: string;
        layoutCols?: number;
        layoutRows?: number;
      }
    ) => {
      const parsed = parseSheetPreviewShotRange(payload.shotFrom, payload.shotTo);
      if (!parsed.ok) {
        onNotify?.('warn', parsed.error);
        return;
      }
      const ensured = ensureStoryboardRowsForShotNos(table.rows, parsed.shotNos);
      if (ensured.createdIds.length) {
        patchTable(() => reindexStoryboardRows(ensured.nextTableRows), {
          fieldCatalog: table.fieldCatalog,
        });
      }
      await saveSheetPreviewItem({
        imageDataUrl: dataUrl,
        label: buildSheetPreviewLabel('上传拼图', parsed.shotNos),
        source: 'uploaded',
        genStatus: 'done',
        rowIds: ensured.rows.map((row) => row.id),
        shotNos: parsed.shotNos,
        layoutCols: payload.layoutCols,
        layoutRows: payload.layoutRows,
      });
      onNotify?.(
        'info',
        `拼图已加入预览（${formatSheetPreviewShotLabel(parsed.shotNos)}），可点「切分」写入镜头`
      );
    },
    [onNotify, patchTable, saveSheetPreviewItem, table.fieldCatalog, table.rows]
  );

  const updateSheetPreviewShotRange = useCallback(
    async (
      previewId: string,
      payload: {
        shotFrom: string;
        shotTo: string;
        layoutCols?: number;
        layoutRows?: number;
      }
    ) => {
      const parsed = parseSheetPreviewShotRange(payload.shotFrom, payload.shotTo);
      if (!parsed.ok) {
        onNotify?.('warn', parsed.error);
        return;
      }
      const item = sheetPreviewsRef.current.find((preview) => preview.id === previewId);
      if (!item || item.source !== 'uploaded') return;

      await saveSheetPreviewItem({
        id: previewId,
        imageDataUrl: item.imageDataUrl,
        imageCompanionKey: item.imageCompanionKey,
        imageIdbKey: item.imageIdbKey,
        label: buildSheetPreviewLabel('上传拼图', parsed.shotNos),
        source: 'uploaded',
        genStatus: item.genStatus,
        rowIds: [],
        shotNos: parsed.shotNos,
        matchedCount: 0,
        layoutCols: payload.layoutCols,
        layoutRows: payload.layoutRows,
      });
      onNotify?.('info', `镜号范围已更新为 ${formatSheetPreviewShotLabel(parsed.shotNos)}`);
    },
    [onNotify, saveSheetPreviewItem]
  );

  const removeSheetPreview = useCallback(
    (previewId: string) => {
      if (readOnly) return;
      const item = sheetPreviewsRef.current.find((preview) => preview.id === previewId);
      if (!item || item.source !== 'uploaded') return;

      const { items, persisted, removed } = removeStoryboardSheetPreview(
        asset.id,
        previewId,
        sheetPreviewsRef.current
      );
      commitSheetPreviews(() => items);
      void syncSheetPreviewListToCompanion(items);

      if (lightboxSheetPreviewId === previewId) {
        setLightboxSrc(null);
        setLightboxSheetPreviewId(null);
      }

      if (!persisted) {
        onNotify?.('warn', '拼图已从列表移除，但元数据写入失败');
      }

      if (removed) {
        void cleanupStoryboardSheetPreviewAssets({
          assetId: asset.id,
          preview: removed,
          companionBaseUrl,
          companionProjectId,
        });
      }
    },
    [
      asset.id,
      companionBaseUrl,
      companionProjectId,
      lightboxSheetPreviewId,
      onNotify,
      commitSheetPreviews,
      readOnly,
      syncSheetPreviewListToCompanion,
    ]
  );

  const addRow = () => {
    const row = createStoryboardTableRow({}, table.rows.length);
    patchTable((rows) => [...rows, row]);
    navigateToRow(row.id);
  };

  const duplicateRow = (rowId: string) => {
    const i = table.rows.findIndex((r) => r.id === rowId);
    if (i < 0) return;
    const copy = duplicateStoryboardRow(table.rows[i]!, table.rows.length);
    patchTable((rows) => {
      const next = [...rows];
      next.splice(i + 1, 0, copy);
      return next;
    });
    navigateToRow(copy.id);
  };

  const removeRows = useCallback(
    (rowIds: string[]): boolean => {
      const ids = [...new Set(rowIds.map((id) => String(id || '').trim()).filter(Boolean))];
      if (!ids.length) return false;
      if (table.rows.some((row) => ids.includes(row.id) && storyboardRowIsPassed(row))) {
        onNotify?.('warn', '所选镜头含已通过项，请先取消通过');
        return false;
      }
      const deletingAll = ids.length >= table.rows.length;
      const message = deletingAll
        ? '删除全部镜头？表将变为空，可再添加或导入。'
        : ids.length === 1
          ? '删除该镜头行？'
          : `删除选中的 ${ids.length} 镜？`;
      if (!window.confirm(message)) return false;
      patchTable((rows) => rows.filter((row) => !ids.includes(row.id)));
      if (activeRowId && ids.includes(activeRowId)) setActiveRowId(null);
      return true;
    },
    [activeRowId, onNotify, patchTable, table.rows]
  );

  const removeRow = (rowId: string) => {
    removeRows([rowId]);
  };

  const moveRow = (rowId: string, dir: -1 | 1) => {
    const row = table.rows.find((r) => r.id === rowId);
    if (row && storyboardRowIsPassed(row)) {
      onNotify?.('warn', '该镜头已通过，请先取消通过');
      return;
    }
    patchTable((rows) => {
      const i = rows.findIndex((r) => r.id === rowId);
      if (i < 0) return rows;
      const j = i + dir;
      if (j < 0 || j >= rows.length) return rows;
      const next = [...rows];
      const [item] = next.splice(i, 1);
      next.splice(j, 0, item);
      return next;
    });
  };

  const openFileForRow = (rowId: string) => {
    const row = table.rows.find((r) => r.id === rowId);
    if (row && storyboardRowIsPassed(row)) {
      onNotify?.('warn', '该镜头已通过，请先取消通过');
      return;
    }
    pendingRowIdRef.current = rowId;
    fileInputRef.current?.click();
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const rowId = pendingRowIdRef.current;
    pendingRowIdRef.current = null;
    if (!file || !rowId) return;
    await assignFrameImage(rowId, file);
  };

  const assignFrameImage = useCallback(
    async (rowId: string, file: File | null, clipboard?: DataTransfer | null) => {
      setImageBusyRowId(rowId);
      try {
        let dataUrl: string | null = null;
        if (file) dataUrl = await readStoryboardFrameFromFile(file);
        else dataUrl = await readStoryboardFrameFromClipboard(clipboard ?? null);
        if (!dataUrl) return;
        const row = table.rows.find((r) => r.id === rowId);
        if (!row) return;
        if (storyboardRowIsPassed(row)) {
          onNotify?.('warn', '该镜头已通过，请先取消通过');
          return;
        }
        const patch = await replaceStoryboardRowFrame({
          row,
          dataUrl,
          assetId: asset.id,
          companionBaseUrl,
          companionProjectId,
          source: file ? 'upload' : 'paste',
        });
        patchRow(rowId, patch);
      } catch (err) {
        onNotify?.('warn', err instanceof Error ? err.message : '图片处理失败');
      } finally {
        setImageBusyRowId(null);
      }
    },
    [asset.id, companionBaseUrl, companionProjectId, onNotify, patchRow, table.rows]
  );

  const restoreFrameVersion = useCallback(
    async (rowId: string, versionId: string) => {
      if (readOnly) return;
      const row = table.rows.find((r) => r.id === rowId);
      if (!row) return;
      if (storyboardRowIsPassed(row)) {
        onNotify?.('warn', '该镜头已通过，请先取消通过');
        return;
      }
      setImageBusyRowId(rowId);
      try {
        const patch = await restoreStoryboardRowFrameVersion(row, versionId, {
          assetId: asset.id,
          companionBaseUrl,
          companionProjectId,
        });
        if (!patch) {
          onNotify?.('warn', '找不到该历史版本');
          return;
        }
        patchRow(rowId, patch);
        onNotify?.('info', '已回退到历史分镜图');
      } catch (error) {
        onNotify?.('warn', error instanceof Error ? error.message : '回退失败');
      } finally {
        setImageBusyRowId(null);
      }
    },
    [asset.id, companionBaseUrl, companionProjectId, onNotify, patchRow, readOnly, table.rows]
  );

  const clearRowImage = useCallback(
    async (rowId: string) => {
      const row = table.rows.find((r) => r.id === rowId);
      if (!row) return;
      if (storyboardRowIsPassed(row)) {
        onNotify?.('warn', '该镜头已通过，请先取消通过');
        return;
      }
      const patch = await clearStoryboardRowFrameWithHistory(row, {
        assetId: asset.id,
        companionBaseUrl,
        companionProjectId,
      });
      patchRow(rowId, patch);
    },
    [asset.id, companionBaseUrl, companionProjectId, onNotify, patchRow, table.rows]
  );

  const runRedraw = useCallback(
    async (rowId: string) => {
      const row = table.rows.find((r) => r.id === rowId);
      if (!row) return;
      if (row.locked) {
        onNotify?.('warn', '该镜头已通过');
        return;
      }
      if (!buildStoryboardRowPromptText(row, table.fieldCatalog)) {
        onNotify?.('warn', '请先解析、填写画面类字段或修改反馈');
        return;
      }
      const useCollage = storyboardRowHasFrameRef(row);
      if (useCollage) {
        if (!activeFeedbackCollagePreset) {
          onNotify?.('warn', '请先在编辑页选择拼图改图能力（图生图）');
          return;
        }
        if (!effectiveFeedbackCollageModelId) {
          onNotify?.('warn', '请先在编辑页选择拼图改图模型');
          return;
        }
      } else if (!onRedrawRow || !effectiveEditRedrawModelId) {
        onNotify?.('warn', '请先在编辑页选择重绘模型');
        return;
      }
      if (!onRedrawRow) {
        onNotify?.('warn', '无法重绘');
        return;
      }
      setRedrawBusyRowId(rowId);
      try {
        await onRedrawRow(
          rowId,
          useCollage ? effectiveFeedbackCollageModelId : effectiveEditRedrawModelId,
          useCollage ? { collagePresetId: effectiveFeedbackCollagePresetId } : undefined
        );
      } catch (e) {
        onNotify?.('warn', e instanceof Error ? e.message : '重绘失败');
      } finally {
        setRedrawBusyRowId(null);
      }
    },
    [
      activeFeedbackCollagePreset,
      effectiveEditRedrawModelId,
      effectiveFeedbackCollageModelId,
      effectiveFeedbackCollagePresetId,
      onNotify,
      onRedrawRow,
      table.fieldCatalog,
      table.rows,
    ]
  );

  const runFeedbackBatchRedraw = useCallback(async () => {
    const preset = activeFeedbackCollagePreset;
    if (!preset) {
      onNotify?.('warn', '请先在编辑页选择拼图改图能力（图生图）');
      return;
    }
    if (!effectiveFeedbackCollageModelId) {
      onNotify?.('warn', '请先在编辑页选择拼图改图模型');
      return;
    }
    const eligible = listStoryboardFeedbackRedrawEligibleRows(table.rows);
    if (!eligible.length) {
      onNotify?.('warn', '没有可改图的镜头（需填写修改反馈且已有分镜图）');
      return;
    }
    const tasks = planStoryboardFeedbackRedrawTasks(table.rows, feedbackCollageLimit);
    if (!tasks.length) {
      onNotify?.('warn', '没有可执行的拼图任务');
      return;
    }
    const understandLabel = feedbackRedrawUnderstand ? '理解后生图' : '直发拼图提示';
    if (
      !window.confirm(
        `按修改反馈拼图改图 ${eligible.length} 镜？（每批最多 ${feedbackCollageLimit} 镜 · ${tasks.length} 张拼图 · ${understandLabel}）`
      )
    ) {
      return;
    }

    const batchId = `fbr_${Date.now()}`;
    const createdAt = Date.now();
    const batchRecord: StoryboardFeedbackRedrawBatchRecord = {
      id: batchId,
      createdAt,
      label: formatStoryboardFeedbackBatchLabel(createdAt, eligible.length),
      rowIds: eligible.map((row) => row.id),
      status: 'running',
      totalTasks: tasks.length,
      matchedCount: 0,
    };
    commitFeedbackRedrawHistory((prev) => [batchRecord, ...prev].slice(0, 24));
    onSelectFeedbackHistory(batchId);
    setFeedbackBatchBusy(true);
    setFeedbackBatchProgress({ done: 0, total: tasks.length });

    let okTasks = 0;
    let failTasks = 0;
    let totalMatched = 0;
    let batchRowImages: Record<string, string> = {};
    const feedbackClearedRowIds = new Set<string>();

    try {
      for (const task of tasks) {
        setRedrawBusyRowId(task.rowIds[0] ?? null);
        try {
          const outcome = await executeStoryboardFeedbackSheetRedraw({
            preset,
            rows: task.rows,
            fieldCatalog: table.fieldCatalog,
            ctx: parseCtx,
            imageModelRegistryId: effectiveFeedbackCollageModelId,
            understand: feedbackRedrawUnderstand,
            chunkIndex: task.chunkIndex,
          });
          if (!outcome.ok) {
            failTasks += 1;
            onNotify?.('warn', `拼图 ${task.chunkIndex + 1} 失败：${outcome.error}`);
            continue;
          }

          let sheetImage = outcome.image;
          try {
            sheetImage = await compressStoryboardFrameDataUrl(sheetImage);
          } catch {
            /* keep raw */
          }

          const { matchedCount, warn, rowImages } = await commitSheetVisionSplit(
            sheetImage,
            task.rows,
            table.fieldCatalog,
            outcome.layout
          );
          totalMatched += matchedCount;
          if (rowImages && Object.keys(rowImages).length) {
            batchRowImages = { ...batchRowImages, ...rowImages };
            for (const rowId of Object.keys(rowImages)) {
              feedbackClearedRowIds.add(rowId);
            }
          }
          okTasks += 1;
          if (warn) {
            onNotify?.('warn', `拼图 ${task.chunkIndex + 1}：${warn}`);
          }
        } catch (error) {
          failTasks += 1;
          onNotify?.(
            'warn',
            error instanceof Error ? error.message : `拼图 ${task.chunkIndex + 1} 失败`
          );
        } finally {
          setFeedbackBatchProgress({ done: okTasks + failTasks, total: tasks.length });
          commitFeedbackRedrawHistory((prev) =>
            prev.map((item) =>
              item.id === batchId
                ? { ...item, matchedCount: totalMatched, rowImages: batchRowImages }
                : item
            )
          );
        }
      }

      const status: StoryboardFeedbackRedrawBatchRecord['status'] =
        failTasks > 0 ? (okTasks > 0 ? 'partial' : 'failed') : 'done';
      commitFeedbackRedrawHistory((prev) =>
        prev.map((item) =>
          item.id === batchId
            ? {
                ...item,
                status,
                matchedCount: totalMatched,
                totalTasks: tasks.length,
                rowImages: batchRowImages,
              }
            : item
        )
      );

      if (failTasks > 0) {
        onNotify?.(
          'warn',
          `拼图改图完成：成功 ${okTasks} 张，失败 ${failTasks} 张；已切分回填 ${totalMatched} 镜`
        );
      } else if (totalMatched > 0) {
        onNotify?.('info', `拼图改图完成：${okTasks} 张拼图，已切分回填 ${totalMatched} 镜`);
      } else {
        onNotify?.('warn', `拼图改图 ${okTasks} 张完成，但未能自动切分回填，请检查镜号`);
      }

      if (feedbackClearedRowIds.size > 0) {
        clearEditFeedbackForRows([...feedbackClearedRowIds]);
      }
    } finally {
      setRedrawBusyRowId(null);
      setFeedbackBatchBusy(false);
      setFeedbackBatchProgress(null);
    }
  }, [
    activeFeedbackCollagePreset,
    clearEditFeedbackForRows,
    commitSheetVisionSplit,
    commitFeedbackRedrawHistory,
    effectiveFeedbackCollageModelId,
    feedbackCollageLimit,
    feedbackRedrawUnderstand,
    onNotify,
    onSelectFeedbackHistory,
    parseCtx,
    table.fieldCatalog,
    table.rows,
  ]);

  const runRoleReplaceBatch = useCallback(async () => {
    if (readOnly) return;
    const preset = activeFeedbackCollagePreset;
    if (!preset) {
      onNotify?.('warn', '请先在编辑页选择拼图改图/角色替换能力（图生图）');
      return;
    }
    if (!effectiveFeedbackCollageModelId) {
      onNotify?.('warn', '请先在编辑页选择拼图改图模型');
      return;
    }
    const roleAssets = table.roleAssets ?? [];
    const eligible = listStoryboardRoleReplaceEligibleRows(table.rows, roleAssets);
    if (!eligible.length) {
      onNotify?.(
        'warn',
        '没有可替换的镜头（需有分镜图、画板角色标注，且解析页有对应参考图）'
      );
      return;
    }
    const tasks = planStoryboardRoleReplaceTasks(table.rows, roleAssets, feedbackCollageLimit);
    if (!tasks.length) {
      onNotify?.('warn', '没有可执行的拼图任务');
      return;
    }
    const understandLabel = feedbackRedrawUnderstand ? '理解后生图' : '直发拼图提示';
    if (
      !window.confirm(
        `按角色标注拼图替换 ${eligible.length} 镜？（每批最多 ${feedbackCollageLimit} 镜 · ${tasks.length} 张拼图 · ${understandLabel}）`
      )
    ) {
      return;
    }

    setRoleReplaceBatchBusy(true);
    setRoleReplaceBatchProgress({ done: 0, total: tasks.length });

    let okTasks = 0;
    let failTasks = 0;
    let totalMatched = 0;

    try {
      for (const task of tasks) {
        setRedrawBusyRowId(task.rowIds[0] ?? null);
        try {
          const outcome = await executeStoryboardRoleReplaceCollageBatch({
            preset,
            rows: task.rows,
            roleAssets,
            fieldCatalog: table.fieldCatalog,
            ctx: parseCtx,
            imageModelRegistryId: effectiveFeedbackCollageModelId,
            understand: feedbackRedrawUnderstand,
            chunkIndex: task.chunkIndex,
          });
          if (!outcome.ok) {
            failTasks += 1;
            onNotify?.('warn', `角色替换拼图 ${task.chunkIndex + 1} 失败：${outcome.error}`);
            continue;
          }

          const { matchedCount, warn } = await commitSheetVisionSplit(
            outcome.image,
            task.rows,
            table.fieldCatalog,
            outcome.layout
          );
          totalMatched += matchedCount;
          okTasks += 1;
          if (warn) {
            onNotify?.('warn', `角色替换拼图 ${task.chunkIndex + 1}：${warn}`);
          }
        } catch (error) {
          failTasks += 1;
          onNotify?.(
            'warn',
            error instanceof Error ? error.message : `角色替换拼图 ${task.chunkIndex + 1} 失败`
          );
        } finally {
          setRoleReplaceBatchProgress({ done: okTasks + failTasks, total: tasks.length });
        }
      }

      if (failTasks > 0) {
        onNotify?.(
          'warn',
          `角色替换完成：成功 ${okTasks} 张，失败 ${failTasks} 张；已切分回填 ${totalMatched} 镜`
        );
      } else if (totalMatched > 0) {
        onNotify?.('info', `角色替换完成：${okTasks} 张拼图，已切分回填 ${totalMatched} 镜`);
      } else {
        onNotify?.('warn', `角色替换 ${okTasks} 张完成，但未能自动切分回填，请检查镜号`);
      }
    } finally {
      setRedrawBusyRowId(null);
      setRoleReplaceBatchBusy(false);
      setRoleReplaceBatchProgress(null);
    }
  }, [
    activeFeedbackCollagePreset,
    commitSheetVisionSplit,
    effectiveFeedbackCollageModelId,
    feedbackCollageLimit,
    feedbackRedrawUnderstand,
    onNotify,
    parseCtx,
    readOnly,
    table.fieldCatalog,
    table.roleAssets,
    table.rows,
  ]);

  const runSheetGen = useCallback(
    async (request: StoryboardSheetGenBatchRequest) => {
      if (isStoryboardSheetGenSessionBusy(asset.id)) {
        onNotify?.('warn', '已有批次正在生图，请等待完成或先取消排队任务');
        return;
      }

      const preset = redrawPresets.find((item) => item.id === request.presetId);
      if (!preset) {
        onNotify?.(
          'warn',
          redrawPresets.length ? '请选择有效的生图能力' : '请先在功能区启用文生图/图生图能力'
        );
        return;
      }

      const allTasks = planStoryboardSheetGenTasks(request.sourceRows, request.shotsPerSheet);
      const selectedSet =
        request.selectedChunkIndexes && request.selectedChunkIndexes.length > 0
          ? new Set(request.selectedChunkIndexes)
          : null;
      const tasks = selectedSet
        ? allTasks.filter((task) => selectedSet.has(task.chunkIndex))
        : allTasks;
      if (!tasks.length) {
        onNotify?.('warn', '请至少选择一个批次');
        return;
      }

      const tableIdSet = new Set(table.rows.map((row) => row.id));
      const needsImport = request.sourceRows.some((row) => !tableIdSet.has(row.id));
      if (needsImport) {
        patchTable(() => reindexStoryboardRows(request.sourceRows), {
          fieldCatalog: request.fieldCatalog,
        });
      }

      const controller = new StoryboardSheetGenBatchController();
      sheetGenControllerRef.current = controller;
      const placeholders = createSheetGenPlaceholderItems(tasks);
      const placeholderIdByChunk = new Map<number, string>();
      for (const placeholder of placeholders) {
        if (placeholder.chunkIndex != null) {
          placeholderIdByChunk.set(placeholder.chunkIndex, placeholder.id);
        }
      }
      sheetGenPlaceholderIdsRef.current = placeholderIdByChunk;

      setSheetGenBusy(true);
      sheetGenBusyRef.current = true;
      setSheetGenProgress({ done: 0, total: tasks.length });
      commitSheetPreviews((prev) => mergeStoryboardSheetPreviews(placeholders, prev));
      patchStoryboardSheetGenSession(asset.id, {
        busy: true,
        progress: { done: 0, total: tasks.length },
        controller,
        placeholderIdByChunk,
      });

      let okCount = 0;
      let failCount = 0;
      let cancelCount = 0;

      try {
        await executeStoryboardSheetGenBatch({
          preset,
          tasks,
          fieldCatalog: request.fieldCatalog,
          ctx: parseCtx,
          promptExtra: request.promptExtra,
          forceTextToImage: request.forceTextToImage,
          controller,
          onTaskComplete: (done, total) => {
            const progress = { done, total };
            setSheetGenProgress(progress);
            patchStoryboardSheetGenSession(asset.id, { progress });
          },
          onTaskStart: (chunkIndex) => {
            const previewId = placeholderIdByChunk.get(chunkIndex);
            if (!previewId) return;
            patchSheetPreviewInMemory(previewId, { genStatus: 'generating' });
          },
          onChunkReady: async (result) => {
            const previewId = placeholderIdByChunk.get(result.chunkIndex);
            if (!previewId) return;

            if (result.cancelled) {
              cancelCount += 1;
              patchSheetPreviewInMemory(previewId, {
                genStatus: 'cancelled',
                genError: '已取消',
              });
              return;
            }

            if (!result.ok) {
              failCount += 1;
              patchSheetPreviewInMemory(previewId, {
                genStatus: 'failed',
                genError: result.error,
              });
              onNotify?.('warn', `任务 ${result.chunkIndex + 1} 失败：${result.error}`);
              return;
            }

            okCount += 1;
            const task = tasks.find((item) => item.chunkIndex === result.chunkIndex);
            if (!task) return;

            let sheetImage = result.image;
            try {
              sheetImage = await compressStoryboardFrameDataUrl(sheetImage);
            } catch {
              /* keep raw */
            }

            patchSheetPreviewInMemory(previewId, {
              imageDataUrl: sheetImage,
              genStatus: 'generating',
            });

            const shotNos = task.rows.map((row) => row.shotNo?.trim() || '').filter(Boolean);
            await saveSheetPreviewItem({
              id: previewId,
              imageDataUrl: sheetImage,
              label: buildSheetPreviewLabel(`任务 ${result.chunkIndex + 1}`, shotNos),
              source: 'generated',
              rowIds: task.rowIds,
              shotNos,
              chunkIndex: result.chunkIndex,
              genStatus: 'done',
              matchedCount: 0,
            });
          },
        });

        commitSheetPreviews(
          (prev) =>
            prev.filter(
              (item) =>
                item.genStatus !== 'cancelled' &&
                !(item.genStatus === 'pending' && item.chunkIndex != null)
            ),
          true
        );

        if (cancelCount > 0 && okCount === 0 && failCount === 0) {
          onNotify?.('info', `已取消 ${cancelCount} 个任务`);
        } else if (failCount > 0) {
          onNotify?.(
            'warn',
            `生图完成：成功 ${okCount} 张，失败 ${failCount} 张${cancelCount ? `，取消 ${cancelCount} 张` : ''}；可点「切分」回填镜头`
          );
        } else if (okCount > 0) {
          onNotify?.(
            'info',
            `生图完成：共 ${okCount} 张${cancelCount ? `，取消 ${cancelCount} 张` : ''}；可点「切分」回填镜头`
          );
        }
      } catch (error) {
        onNotify?.('warn', error instanceof Error ? error.message : '批量生图失败');
      } finally {
        sheetGenControllerRef.current = null;
        sheetGenPlaceholderIdsRef.current = new Map();
        sheetGenBusyRef.current = false;
        setSheetGenBusy(false);
        setSheetGenProgress(null);
        clearStoryboardSheetGenSessionBusy(asset.id);
        void rehydrateSheetPreviews();
      }
    },
    [
      asset.id,
      commitSheetPreviews,
      onNotify,
      parseCtx,
      patchSheetPreviewInMemory,
      patchTable,
      redrawPresets,
      rehydrateSheetPreviews,
      saveSheetPreviewItem,
      table.rows,
    ]
  );

  const resolveParsePreset = useCallback(() => {
    if (!effectiveParsePresetId) return null;
    return (
      effectiveParsePresets.find((p) => p.id === effectiveParsePresetId) ??
      getBuiltinStoryboardParsePreset()
    );
  }, [effectiveParsePresetId, effectiveParsePresets]);

  const resolveOptimizePreset = useCallback(() => {
    if (!effectiveOptimizePresetId) return null;
    return (
      effectiveOptimizePresets.find((p) => p.id === effectiveOptimizePresetId) ??
      getBuiltinStoryboardOptimizePreset()
    );
  }, [effectiveOptimizePresetId, effectiveOptimizePresets]);

  const runParse = useCallback(
    async (rowId: string) => {
      const preset = resolveParsePreset();
      if (!preset) {
        onNotify?.('warn', '请选择结构化解析预设');
        return;
      }
      const row = table.rows.find((r) => r.id === rowId);
      if (!row) return;
      if (row.locked) {
        onNotify?.('warn', '该镜头已通过');
        return;
      }
      if (!(resolveStoryboardParseInput(row, table.fieldCatalog) || '').trim()) {
        onNotify?.('warn', '请先填写原文或结构化字段');
        return;
      }
      setParseBusyRowId(rowId);
      try {
        const merged = await parseStoryboardRowWithPreset(
          row,
          table.fieldCatalog,
          preset,
          parseCtx
        );
        patchTable(
          (rows) => rows.map((r) => (r.id === rowId ? merged.row : r)),
          { fieldCatalog: merged.catalog }
        );
        notifyCatalogSize(merged.catalog);
        const filledCount = Object.values(merged.row.shotFields ?? {}).filter((value) =>
          String(value ?? '').trim()
        ).length;
        const shotLabel = merged.row.shotNo?.trim() || row.shotNo?.trim();
        const shotSuffix = shotLabel ? `（镜 ${shotLabel}）` : '';
        onNotify?.(
          filledCount > 0 ? 'info' : 'warn',
          filledCount > 0
            ? `解析完成：已填入 ${filledCount} 个字段${shotSuffix}`
            : `解析完成，但未识别到有效字段${shotSuffix}`
        );
      } catch (e) {
        onNotify?.('warn', e instanceof Error ? e.message : '解析失败');
      } finally {
        setParseBusyRowId(null);
      }
    },
    [
      onNotify,
      parseCtx,
      patchTable,
      resolveParsePreset,
      table.fieldCatalog,
      table.rows,
      notifyCatalogSize,
    ]
  );

  const runOptimize = useCallback(
    async (rowId: string) => {
      const preset = resolveOptimizePreset();
      if (!preset) {
        onNotify?.('warn', '请选择结构化优化预设');
        return;
      }
      const row = table.rows.find((r) => r.id === rowId);
      if (!row) return;
      if (row.locked) {
        onNotify?.('warn', '该镜头已通过');
        return;
      }
      if (!table.fieldCatalog.length) {
        onNotify?.('warn', '请先解析出结构化字段');
        return;
      }
      setOptimizeBusyRowId(rowId);
      try {
        const nextRow = await optimizeStoryboardRowWithPreset(
          row,
          table.fieldCatalog,
          preset,
          parseCtx,
          { allowDialogueEdit: allowOptimizeDialogue }
        );
        patchRow(rowId, { shotFields: nextRow.shotFields });
      } catch (e) {
        onNotify?.('warn', e instanceof Error ? e.message : '优化失败');
      } finally {
        setOptimizeBusyRowId(null);
      }
    },
    [
      allowOptimizeDialogue,
      onNotify,
      parseCtx,
      patchRow,
      resolveOptimizePreset,
      table.fieldCatalog,
      table.rows,
    ]
  );

  const runParseAll = useCallback(async () => {
    const preset = resolveParsePreset();
    if (!preset) {
      onNotify?.('warn', '请选择结构化解析预设');
      return;
    }
    const eligible = table.rows.filter(
      (r) => !r.locked && (resolveStoryboardParseInput(r, table.fieldCatalog) || '').trim()
    );
    if (!eligible.length) {
      onNotify?.('warn', '没有可解析的镜头（需原文/结构化内容且未通过）');
      return;
    }
    if (!window.confirm(`解析全表 ${eligible.length} 镜？将调用文字模型。`)) return;
    setParseAllBusy(true);
    try {
      const batch = await parseStoryboardRowsBatch(
        table.rows,
        table.fieldCatalog,
        preset,
        parseCtx,
        {
          shouldSkip: (r) =>
            r.locked || !(resolveStoryboardParseInput(r, table.fieldCatalog) || '').trim(),
        }
      );
      patchTable(() => batch.rows, { fieldCatalog: batch.catalog });
      notifyCatalogSize(batch.catalog);
      const ok = batch.results.filter((r) => r.ok).length;
      const fail = batch.results.length - ok;
      onNotify?.(
        fail > 0 ? 'warn' : 'info',
        fail > 0 ? `解析完成：成功 ${ok}，失败 ${fail}` : `解析完成：${ok} 镜`
      );
    } catch (e) {
      onNotify?.('warn', e instanceof Error ? e.message : '批量解析失败');
    } finally {
      setParseAllBusy(false);
    }
  }, [
    onNotify,
    parseCtx,
    patchTable,
    resolveParsePreset,
    table.fieldCatalog,
    table.rows,
    notifyCatalogSize,
  ]);

  const reorderLayerRows = useCallback(
    (layer: number, fromIndex: number, toIndex: number) => {
      patchTable((rows) => reorderStoryboardRowsInLayer(rows, layer, fromIndex, toIndex));
    },
    [patchTable]
  );

  const addTimelineLayer = useCallback(() => {
    onPatchAsset((cur) => {
      const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
      const titleRaw = readStoryboardTableTitleRaw(cur);
      const nextCount = clampStoryboardTimelineLayerCount((doc.timelineLayerCount ?? 1) + 1);
      return {
        ...cur,
        textTitle: titleRaw,
        storyboardTable: { ...doc, title: titleRaw, timelineLayerCount: nextCount },
      };
    });
  }, [onPatchAsset]);

  const removeTimelineLayer = useCallback(() => {
    if (timelineLayerCount <= 1) return;
    onPatchAsset((cur) => {
      const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
      const titleRaw = readStoryboardTableTitleRaw(cur);
      const collapsed = collapseStoryboardTimelineTopLayer(doc.rows, doc.timelineLayerCount ?? 1);
      return {
        ...cur,
        textTitle: titleRaw,
        storyboardTable: {
          ...doc,
          title: titleRaw,
          rows: reindexStoryboardRows(collapsed.rows),
          timelineLayerCount: collapsed.layerCount,
        },
      };
    });
  }, [onPatchAsset, timelineLayerCount]);

  const redrawRowDisabledReason = useCallback(
    (row: StoryboardTableRow): string | undefined => {
      if (readOnly) return '只读模式';
      if (row.locked) return '已通过';
      if (!redrawPresets.length) return '无可用生图能力';
      if (!buildStoryboardRowPromptText(row, table.fieldCatalog)) {
        return '需先解析、填写画面类字段或修改反馈';
      }
      return undefined;
    },
    [readOnly, redrawPresets, table.fieldCatalog]
  );

  const feedbackRedrawEligibleCount = useMemo(() => {
    return listStoryboardFeedbackRedrawRows(table.rows).filter(isStoryboardFeedbackRedrawEligible).length;
  }, [table.rows]);

  const roleReplaceEligibleCount = useMemo(
    () => listStoryboardRoleReplaceEligibleRows(table.rows, table.roleAssets ?? []).length,
    [table.roleAssets, table.rows]
  );

  const rowInteraction = useMemo((): StoryboardRowInteractionValue => {
    return {
      rowCount: table.rows.length,
      readOnly,
      timelineLayerCount,
      fieldCatalog: table.fieldCatalog,
      hasRedrawHandler: Boolean(onRedrawRow),
      hasParseHandler: true,
      hasOptimizeHandler: true,
      allowOptimizeDialogue,
      focusRow: setActiveRowId,
      patchRow,
      moveRow,
      removeRow,
      openFileForRow,
      clearRowImage: (rowId) => {
        void clearRowImage(rowId);
      },
      restoreFrameVersion: (rowId, versionId) => {
        void restoreFrameVersion(rowId, versionId);
      },
      assignFrameImageFromDrop: (rowId, e) =>
        void assignFrameImage(rowId, e.dataTransfer.files?.[0] ?? null, e.dataTransfer),
      assignFrameImageFromPaste: (rowId, e) => {
        const file = e.clipboardData.files?.[0];
        if (file) {
          e.preventDefault();
          void assignFrameImage(rowId, file, e.clipboardData);
        }
      },
      runRedraw,
      runParse,
      runOptimize,
      previewImage: openStoryboardLightbox,
      redrawDisabledReason: redrawRowDisabledReason,
    };
  }, [
    assignFrameImage,
    clearRowImage,
    restoreFrameVersion,
    moveRow,
    onRedrawRow,
    openFileForRow,
    patchRow,
    readOnly,
    redrawRowDisabledReason,
    removeRow,
    runOptimize,
    runParse,
    runRedraw,
    openStoryboardLightbox,
    allowOptimizeDialogue,
    table.fieldCatalog,
    table.rows.length,
    timelineLayerCount,
  ]);

  const activeRow = useMemo(
    () => (activeRowId ? table.rows.find((r) => r.id === activeRowId) : undefined),
    [activeRowId, table.rows]
  );
  const activeRowCanOptimize = useMemo(
    () => Boolean(activeRow && rowHasStructuredFieldValues(table.fieldCatalog, activeRow)),
    [activeRow, table.fieldCatalog]
  );

  const panel = (
    <div
      className="fixed inset-0 z-[2160] flex flex-col bg-[#040508]/90 backdrop-blur-xl"
      role="dialog"
      aria-modal
      aria-label={readOnly ? '分镜表（只读）' : '分镜表'}
      data-ac-block-workflow-marquee
    >
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFilePicked} />

      <header className={`shrink-0 border-b border-white/[0.04] ${STORYBOARD_PAD_PANEL} pb-2`}>
        <div className={`flex items-center ${STORYBOARD_PAD_HEADER_INNER}`}>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            title="关闭（Esc）"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-gray-400 ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.08] hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-white/25"
            aria-label="关闭"
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>

          <div className={STORYBOARD_VIEW_TOGGLE} role="group" aria-label="分镜表视图">
            <button
              type="button"
              onClick={() => setPanelViewMode('input')}
              className={`${STORYBOARD_VIEW_TOGGLE_BTN} ${
                isInputView ? STORYBOARD_VIEW_TOGGLE_ACTIVE : STORYBOARD_VIEW_TOGGLE_IDLE
              }`}
              aria-pressed={isInputView}
            >
              解析
            </button>
            <button
              type="button"
              onClick={() => setPanelViewMode('edit')}
              className={`${STORYBOARD_VIEW_TOGGLE_BTN} ${
                isEditView ? STORYBOARD_VIEW_TOGGLE_ACTIVE : STORYBOARD_VIEW_TOGGLE_IDLE
              }`}
              aria-pressed={isEditView}
            >
              编辑
            </button>
            <button
              type="button"
              onClick={() => setPanelViewMode('grid')}
              className={`${STORYBOARD_VIEW_TOGGLE_BTN} ${
                isGridView ? STORYBOARD_VIEW_TOGGLE_ACTIVE : STORYBOARD_VIEW_TOGGLE_IDLE
              }`}
              aria-pressed={isGridView}
            >
              输出
            </button>
            <button
              type="button"
              onClick={() => setPanelViewMode('video')}
              className={`${STORYBOARD_VIEW_TOGGLE_BTN} ${
                isVideoView ? STORYBOARD_VIEW_TOGGLE_ACTIVE : STORYBOARD_VIEW_TOGGLE_IDLE
              }`}
              aria-pressed={isVideoView}
            >
              预览
            </button>
          </div>

          <input
            value={title}
            readOnly={readOnly}
            onChange={(e) => {
              const v = e.target.value;
              onPatchAsset((cur) => {
                const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
                return {
                  ...cur,
                  textTitle: v,
                  storyboardTable: { ...doc, title: v },
                };
              });
            }}
            className="min-w-0 flex-1 bg-transparent text-base font-semibold tracking-tight text-white outline-none placeholder:text-gray-600 read-only:cursor-default sm:text-lg"
            placeholder="未命名分镜表"
          />

          <div className={`hidden shrink-0 items-center sm:flex ${STORYBOARD_GAP_TIGHT}`}>
            <span className={STORYBOARD_STAT_CHIP}>{stats.rowCount} 镜</span>
            <span className={STORYBOARD_STAT_CHIP}>{stats.withImageCount} 配图</span>
            <span className={STORYBOARD_STAT_CHIP}>
              {formatDurationLabel(stats.totalDurationSec, stats.hasGaps)}
            </span>
            {stats.lockedCount > 0 ? (
              <span className={STORYBOARD_STAT_CHIP}>{stats.lockedCount} 已通过</span>
            ) : null}
          </div>
        </div>

        <div className={`mt-1.5 flex flex-wrap items-center ${STORYBOARD_GAP_TIGHT} pl-11 sm:hidden`}>
          <span className={STORYBOARD_STAT_CHIP}>{stats.rowCount} 镜</span>
          <span className={STORYBOARD_STAT_CHIP}>{stats.withImageCount} 配图</span>
          <span className={STORYBOARD_STAT_CHIP}>
            {formatDurationLabel(stats.totalDurationSec, stats.hasGaps)}
          </span>
        </div>

        {isInputView && !readOnly ? (
          <div className={`mt-2 flex flex-wrap items-center ${STORYBOARD_GAP_TIGHT} pl-11`}>
            {parsePresetOptions.length > 0 ? (
              <div className="flex min-w-[10rem] max-w-xs items-center gap-1.5">
                <span className="shrink-0 text-[10px] text-gray-500">结构化解析</span>
                <CustomDropdown
                  value={effectiveParsePresetId}
                  options={parsePresetOptions}
                  onChange={setParsePresetId}
                  triggerClassName="h-8 min-w-[8rem] flex-1 rounded-lg bg-white/[0.04] px-2.5 text-[10px] text-gray-200 ring-1 ring-white/[0.07] hover:bg-white/[0.07]"
                  portalZIndex={STORYBOARD_PANEL_DROPDOWN_Z}
                />
              </div>
            ) : null}
            <button type="button" onClick={addRow} className={STORYBOARD_TOOL_BTN_PRIMARY}>
              添加镜头
            </button>
            <button
              type="button"
              disabled={parseBusyRowId != null || parseAllBusy}
              onClick={() => void runParseAll()}
              className={STORYBOARD_TOOL_BTN_NEUTRAL}
            >
              {parseAllBusy ? '批量解析中…' : '解析全表'}
            </button>
            <button
              type="button"
              onClick={() => setPanelViewMode('edit')}
              className={STORYBOARD_TOOL_BTN_NEUTRAL}
            >
              进入编辑
            </button>
          </div>
        ) : null}

        {isEditView && !readOnly ? (
          <div className={`mt-2 flex flex-wrap items-center ${STORYBOARD_GAP_TIGHT} pl-11`}>
            {parsePresetOptions.length > 0 ? (
              <div className="flex min-w-[10rem] max-w-xs items-center gap-1.5">
                <span className="shrink-0 text-[10px] text-gray-500">结构化解析</span>
                <CustomDropdown
                  value={effectiveParsePresetId}
                  options={parsePresetOptions}
                  onChange={setParsePresetId}
                  triggerClassName="h-8 min-w-[8rem] flex-1 rounded-lg bg-white/[0.04] px-2.5 text-[10px] text-gray-200 ring-1 ring-white/[0.07] hover:bg-white/[0.07]"
                  portalZIndex={STORYBOARD_PANEL_DROPDOWN_Z}
                />
              </div>
            ) : null}
            {optimizePresetOptions.length > 0 ? (
              <div className="flex min-w-[10rem] max-w-xs items-center gap-1.5">
                <span className="shrink-0 text-[10px] text-gray-500">结构化优化</span>
                <CustomDropdown
                  value={effectiveOptimizePresetId}
                  options={optimizePresetOptions}
                  onChange={setOptimizePresetId}
                  triggerClassName="h-8 min-w-[8rem] flex-1 rounded-lg bg-white/[0.04] px-2.5 text-[10px] text-gray-200 ring-1 ring-white/[0.07] hover:bg-white/[0.07]"
                  portalZIndex={STORYBOARD_PANEL_DROPDOWN_Z}
                />
              </div>
            ) : null}
            {editRedrawModelOptions.length > 0 && redrawPresets.length > 0 ? (
              <div className="flex min-w-[10rem] max-w-xs items-center gap-1.5">
                <span className="shrink-0 text-[10px] text-gray-500">重绘模型</span>
                <CustomDropdown
                  value={effectiveEditRedrawModelId}
                  options={editRedrawModelOptions}
                  onChange={setEditRedrawModelIdPersisted}
                  triggerClassName="h-8 min-w-[8rem] flex-1 rounded-lg bg-white/[0.04] px-2.5 text-[10px] text-gray-200 ring-1 ring-white/[0.07] hover:bg-white/[0.07]"
                  portalZIndex={STORYBOARD_PANEL_DROPDOWN_Z}
                />
              </div>
            ) : null}
            {feedbackCollagePresetOptions.length > 0 ? (
              <div className="flex min-w-[10rem] max-w-xs items-center gap-1.5">
                <span className="shrink-0 text-[10px] text-gray-500">拼图改图</span>
                <CustomDropdown
                  value={effectiveFeedbackCollagePresetId}
                  options={feedbackCollagePresetOptions}
                  onChange={setFeedbackCollagePresetIdPersisted}
                  triggerClassName="h-8 min-w-[8rem] flex-1 rounded-lg bg-white/[0.04] px-2.5 text-[10px] text-gray-200 ring-1 ring-white/[0.07] hover:bg-white/[0.07]"
                  portalZIndex={STORYBOARD_PANEL_DROPDOWN_Z}
                />
              </div>
            ) : null}
            {feedbackCollageModelOptions.length > 0 && feedbackCollagePresetOptions.length > 0 ? (
              <div className="flex min-w-[10rem] max-w-xs items-center gap-1.5">
                <span className="shrink-0 text-[10px] text-gray-500">拼图模型</span>
                <CustomDropdown
                  value={effectiveFeedbackCollageModelId}
                  options={feedbackCollageModelOptions}
                  onChange={setFeedbackCollageModelIdPersisted}
                  triggerClassName="h-8 min-w-[8rem] flex-1 rounded-lg bg-white/[0.04] px-2.5 text-[10px] text-gray-200 ring-1 ring-white/[0.07] hover:bg-white/[0.07]"
                  portalZIndex={STORYBOARD_PANEL_DROPDOWN_Z}
                />
              </div>
            ) : null}
            <button type="button" onClick={addRow} className={STORYBOARD_TOOL_BTN_PRIMARY}>
              添加镜头
            </button>
            {activeRowId ? (
              <button
                type="button"
                disabled={parseBusyRowId != null || parseAllBusy}
                onClick={() => void runParse(activeRowId)}
                className={STORYBOARD_TOOL_BTN_NEUTRAL}
              >
                {parseBusyRowId === activeRowId ? '解析中…' : '解析本镜'}
              </button>
            ) : null}
            <button
              type="button"
              disabled={parseBusyRowId != null || parseAllBusy}
              onClick={() => void runParseAll()}
              className={STORYBOARD_TOOL_BTN_NEUTRAL}
            >
              {parseAllBusy ? '批量解析中…' : '解析全表'}
            </button>
            {activeRowId ? (
              <button
                type="button"
                disabled={
                  optimizeBusyRowId != null ||
                  parseBusyRowId != null ||
                  parseAllBusy ||
                  !activeRowCanOptimize
                }
                onClick={() => void runOptimize(activeRowId)}
                className={STORYBOARD_TOOL_BTN_NEUTRAL}
              >
                {optimizeBusyRowId === activeRowId ? '优化中…' : '优化本镜'}
              </button>
            ) : null}
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[10px] text-gray-500">
              <input
                type="checkbox"
                checked={allowOptimizeDialogue}
                onChange={toggleAllowOptimizeDialogue}
                className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 text-white/80"
              />
              可改对白
            </label>
            <button
              type="button"
              onClick={() => patchTable((rows) => applyAutoShotNumbers(rows))}
              className={STORYBOARD_TOOL_BTN_NEUTRAL}
            >
              自动镜头号
            </button>
            {activeRowId ? (
              <button
                type="button"
                onClick={() => duplicateRow(activeRowId)}
                className={STORYBOARD_TOOL_BTN_GHOST}
              >
                复制当前镜
              </button>
            ) : null}
          </div>
        ) : null}

        {isGridView ? (
          <div className={`mt-2 flex flex-wrap items-center ${STORYBOARD_GAP_TIGHT} pl-11`}>
            <span className="shrink-0 text-[10px] text-gray-500">合成秒数</span>
            <CustomDropdown
              value={String(gridSecondsPerTile)}
              options={gridSecondsOptions}
              onChange={(v) => setGridSecondsPerTilePersisted(Number(v))}
              triggerClassName="h-8 min-w-[7.5rem] rounded-lg bg-white/[0.04] px-2.5 text-[10px] text-gray-200 ring-1 ring-white/[0.07] hover:bg-white/[0.07]"
              portalZIndex={STORYBOARD_PANEL_DROPDOWN_Z}
            />
            <label className="inline-flex items-center gap-1.5 text-[10px] text-gray-500">
              <span className="shrink-0">自定义</span>
              <input
                type="number"
                min={1}
                max={60}
                step={0.5}
                value={gridSecondsPerTile}
                onChange={(e) => setGridSecondsPerTilePersisted(Number(e.target.value))}
                className="h-8 w-[4.5rem] rounded-lg bg-white/[0.05] ring-1 ring-white/[0.06] px-2 text-[10px] text-gray-100 outline-none focus-visible:ring-2 focus-visible:ring-white/25"
              />
              <span>秒</span>
            </label>
            <span className="text-[9px] text-gray-600">
              页面内 DOM 拼图实时展示；下载时按设定宽度渲染高清图；未填时长按 2s*
            </span>
            <span className="shrink-0 text-[10px] text-gray-500">导出宽度</span>
            <CustomDropdown
              value={String(gridExportWidth)}
              options={gridExportWidthOptions}
              onChange={(v) => setGridExportWidthPersisted(Number(v))}
              triggerClassName="h-8 min-w-[7rem] rounded-lg bg-white/[0.04] px-2.5 text-[10px] text-gray-200 ring-1 ring-white/[0.07] hover:bg-white/[0.07]"
              portalZIndex={STORYBOARD_PANEL_DROPDOWN_Z}
            />
            <button
              type="button"
              disabled={gridDownloadBusy || !gridGroups.length}
              onClick={() => void handleDownloadAllGridGroups()}
              className={STORYBOARD_TOOL_BTN_NEUTRAL}
            >
              {gridDownloadBusy ? '导出中…' : '下载全部拼图'}
            </button>
          </div>
        ) : null}

        {storyboardExportTask?.status === 'running' && storyboardExportTask.assetId === asset.id ? (
          <StoryboardVideoExportProgress
            progress={storyboardExportTask.progress}
            className="mt-2 pl-11"
          />
        ) : null}

      </header>

      {isInputView ? (
        <StoryboardTableInputView
          ref={inputViewRef}
          assetId={asset.id}
          rows={table.rows}
          fieldCatalog={table.fieldCatalog}
          roleAssets={table.roleAssets ?? []}
          roleAssetBusyId={roleAssetBusyId}
          parsePreset={activeParsePreset}
          parseCtx={parseCtx}
          readOnly={readOnly}
          onImportRows={importInputRows}
          redrawPresets={redrawPresets}
          redrawPresetId={effectiveRedrawPresetId}
          sheetGenBusy={sheetGenBusy}
          sheetGenProgress={sheetGenProgress}
          onRedrawPresetChange={setRedrawPresetIdPersisted}
          onSheetGenRun={runSheetGen}
          companionBaseUrl={companionBaseUrl}
          companionProjectId={companionProjectId}
          sheetPreviews={sheetPreviews}
          sheetSplitBusyId={sheetSplitBusyId}
          sheetRegenBusyId={sheetRegenBusyId}
          sheetSplitBatchBusy={sheetSplitBatchBusy}
          sheetSplitProgress={sheetSplitProgress}
          splittableSheetCount={sheetPreviews.filter(isStoryboardSheetPreviewSplittable).length}
          onPreviewSheetImage={openSheetPreviewLightbox}
          onUploadSheetPreview={uploadSheetPreview}
          onUpdateSheetPreviewShotRange={updateSheetPreviewShotRange}
          onApplySheetPreview={applySheetPreview}
          onRegenerateSheetPreview={regenerateSheetPreview}
          onActivateSheetPreviewVersion={activateSheetPreviewVersion}
          onBatchSplitSheetPreviews={batchSplitSheetPreviews}
          onDeleteSheetPreview={removeSheetPreview}
          onCancelSheetGen={cancelSheetGen}
          onCancelSheetGenTask={cancelSheetGenTask}
          onGoToEdit={() => setPanelViewMode('edit')}
          onNotify={onNotify}
          onAddRoleAsset={addRoleAsset}
          onRemoveRoleAsset={removeRoleAsset}
          onRenameRoleAsset={renameRoleAsset}
          onAssignRoleAssetImage={assignRoleAssetImage}
          onClearRoleAssetImage={clearRoleAssetImage}
          onPreviewRoleAssetImage={openStoryboardLightbox}
        />
      ) : isGridView ? (
        <StoryboardTableGridPreview
          rows={table.rows}
          fieldCatalog={table.fieldCatalog}
          secondsPerTile={gridSecondsPerTile}
          timelineLayerCount={timelineLayerCount}
          gridExportWidth={gridExportWidth}
          activeRowId={activeRowId}
          onSelect={(rowId) => navigateToRow(rowId)}
          onPreviewImage={openStoryboardLightbox}
          onPreviewMosaicError={(message) => onNotify?.('warn', message)}
          onDownloadGroup={(group) => void handleDownloadGridGroup(group)}
          scrollToRowRef={gridScrollToRowRef}
        />
      ) : isVideoView ? (
        <StoryboardTableVideoPreview
          rows={table.rows}
          fieldCatalog={table.fieldCatalog}
          timelineLayerCount={timelineLayerCount}
          activeRowId={activeRowId}
          readOnly={readOnly}
          canExport={canExportVideo}
          exporting={isThisAssetExporting}
          exportDisabled={isExportRunning}
          onExport={handleStartVideoExport}
          onSelectRow={(rowId) => setActiveRowId(rowId)}
          onActiveRowFromPlayback={setActiveRowId}
          onReorderLayer={reorderLayerRows}
          onAddTimelineLayer={addTimelineLayer}
          onRemoveTimelineLayer={removeTimelineLayer}
        />
      ) : (
        <StoryboardTableEditView
          key={asset.id}
          rows={table.rows}
          roleAssets={table.roleAssets ?? []}
          activeRowId={activeRowId}
          imageBusyRowId={imageBusyRowId}
          redrawBusyRowId={redrawBusyRowId}
          feedbackBatchBusy={feedbackBatchBusy}
          feedbackBatchProgress={feedbackBatchProgress}
          feedbackRedrawEligibleCount={feedbackRedrawEligibleCount}
          feedbackRedrawUnderstand={feedbackRedrawUnderstand}
          onToggleFeedbackRedrawUnderstand={toggleFeedbackRedrawUnderstand}
          onFeedbackBatchRedraw={!readOnly ? () => void runFeedbackBatchRedraw() : undefined}
          onClearAllFeedback={!readOnly ? clearAllEditFeedback : undefined}
          feedbackCollageLimit={feedbackCollageLimit}
          onFeedbackCollageLimitChange={setFeedbackCollageLimitPersisted}
          feedbackRedrawHistory={feedbackRedrawHistory}
          selectedFeedbackHistoryId={selectedFeedbackHistoryId}
          onSelectFeedbackHistory={onSelectFeedbackHistory}
          parseBusyRowId={parseBusyRowId}
          parseAllBusy={parseAllBusy}
          optimizeBusyRowId={optimizeBusyRowId}
          interaction={rowInteraction}
          onActiveRowIdChange={setActiveRowId}
          onPatchRows={patchRows}
          onRemoveRows={!readOnly ? removeRows : undefined}
          onAddFrameRoleMark={!readOnly ? addFrameRoleMark : undefined}
          roleReplaceEligibleCount={roleReplaceEligibleCount}
          roleReplaceBatchBusy={roleReplaceBatchBusy}
          roleReplaceBatchProgress={roleReplaceBatchProgress}
          onRoleReplaceBatch={!readOnly ? () => void runRoleReplaceBatch() : undefined}
          readOnly={readOnly}
          redrawRowDisabledReason={redrawRowDisabledReason}
          editScrollRef={editViewRef}
          footerAddRow={
            !readOnly ? (
              <button type="button" onClick={addRow} className={STORYBOARD_ADD_ROW_DASHED}>
                <span className="text-base leading-none text-white/60">+</span>
                添加镜头
              </button>
            ) : null
          }
        />
      )}

    </div>
  );

  return (
    <>
      {typeof document !== 'undefined' ? createPortal(panel, document.body) : panel}
      {lightboxSrc ? (
        <ImagePreviewOverlay
          open
          resetKey={lightboxSheetPreviewId ?? lightboxSrc}
          imageSrc={lightboxSrc}
          onClose={closeStoryboardLightbox}
          wheelListLength={lightboxSheetPreviewId ? sheetPreviewWheelItems.length : 1}
          onWheelNavigate={(delta) => {
            if (lightboxSheetPreviewId) navigateSheetPreviewLightbox(delta);
          }}
          topRightExtra={
            <button
              type="button"
              onClick={() => {
                const preview = lightboxSheetPreviewId
                  ? sheetPreviewWheelItems.find((item) => item.id === lightboxSheetPreviewId)
                  : null;
                const base =
                  preview?.label?.replace(/[^\w\u4e00-\u9fff-]+/g, '-').trim() ||
                  'storyboard-sheet';
                void triggerImageDownload(lightboxSrc, base || 'storyboard-sheet');
              }}
              className={IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE}
              title="下载图片"
              aria-label="下载图片"
            >
              <Download size={17} strokeWidth={1.75} aria-hidden />
            </button>
          }
          shellZIndexClassName={STORYBOARD_LIGHTBOX_Z}
        />
      ) : null}
      {splitAdjustDraft ? (
        <StoryboardSheetSplitAdjustModal
          open
          busy={splitAdjustDraft.applying}
          detecting={splitAdjustDraft.detecting}
          imageSrc={splitAdjustDraft.imageSrc}
          boxes={splitAdjustDraft.boxes}
          expectedShotNos={splitAdjustDraft.expectedShotNos}
          sheetLabel={splitAdjustDraft.sheetLabel}
          onClose={closeSheetSplitBoxAdjust}
          onConfirm={confirmSheetSplitBoxAdjust}
        />
      ) : null}
    </>
  );
}
