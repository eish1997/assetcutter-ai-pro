import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BoundingBox, CustomAppModule, StoryboardGeneratedImageRecord, StoryboardParseFieldDef, StoryboardRoleAsset, StoryboardSceneAsset, StoryboardTableRow, WorkflowAsset } from '../../types';
import {
  applyAutoShotNumbers,
  applySequentialShotNumbers,
  computeStoryboardTableStats,
  normalizeStoryboardTableDoc,
  normalizeStoryboardTableOnAsset,
  readStoryboardTableTitleRaw,
  reindexStoryboardRows,
  resolveStoryboardTableTitle,
  sortStoryboardRowsByShotNo,
} from '../../services/storyboardTableAsset';
import { reorderStoryboardRows, reorderStoryboardRowsInLayer, collapseStoryboardTimelineTopLayer, clampStoryboardTimelineLayerCount } from '../../services/storyboardVideoTimeline';
import {
  executeStoryboardFeedbackSheetRedraw,
  formatStoryboardFeedbackBatchLabel,
  listStoryboardFeedbackRedrawEligibleRows,
  normalizeFeedbackCollageLimit,
  planStoryboardFeedbackRedrawTasks,
  STORYBOARD_EDIT_FEEDBACK_COLLAGE_LIMIT_KEY,
  STORYBOARD_FEEDBACK_COLLAGE_LIMIT_DEFAULT,
  feedbackCollageLayoutToBoxes,
  feedbackCollageLayoutToManualAdjustBoxes,
  splitStoryboardFeedbackCollageWithBoxes,
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
  resolveStoryboardRowFrameDataUrl,
} from '../../services/storyboardTableRedraw';
import { canPatchStoryboardPassedRow, storyboardRowIsPassed } from './storyboardRowDisplay';
import { createStoryboardRoleAsset } from '../../services/storyboardRoleAssets';
import { createStoryboardSceneAsset } from '../../services/storyboardSceneAssets';
import {
  appendStoryboardFrameRoleMark,
  rebindStoryboardFrameRoleMark,
  removeStoryboardFrameRoleMark,
  setStoryboardFrameRoleMarkCustomName,
  updateStoryboardFrameRoleMark,
} from '../../services/storyboardFrameRoleMarks';
import {
  clearStoryboardNamedAssetImageFields,
  persistStoryboardNamedAssetImage,
} from '../../services/storyboardNamedAssetImage';
import { planStoryboardNamedAssetImportAssignments } from '../../services/storyboardNamedAssetImport';
import {
  executeStoryboardRoleReplaceCollageBatch,
  listStoryboardRoleReplaceEligibleRows,
  planStoryboardRoleReplaceTasks,
} from '../../services/storyboardRoleReplaceRedraw';
import {
  resolveStoryboardRowFrameDisplaySrc,
  storyboardRowHasFrameRef,
} from '../../services/storyboardFrameImageUrl';
import {
  executeStoryboardSheetGen,
  executeStoryboardSheetGenBatch,
  planStoryboardSheetGenTasks,
  probeStoryboardSheetGenCompanionReady,
  resolveStoryboardSheetGridDimensions,
  rowHasSheetGenPrompt,
  storyboardSheetGenCompanionProbeMessage,
  StoryboardSheetGenBatchController,
  type StoryboardSheetGenBatchRequest,
} from '../../services/storyboardTableSheetGen';
import {
  clampStoryboardSheetSplitBox,
  detectStoryboardSheetPanels,
  estimateStoryboardSheetPanelCountFromImage,
  isCollapsedStoryboardSheetVisionDetect,
  isUsableStoryboardSheetSplitDraftBoxes,
  refineStoryboardSheetDetectBoxesToIllustration,
  splitStoryboardSheetByVision,
  splitStoryboardSheetFromBoxes,
  type StoryboardSheetLayoutGrid,
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
  hasStoryboardSheetPreviewSplitCache,
  hydrateStoryboardSheetPreviews,
  isStoryboardSheetPreviewSplittable,
  isStoryboardSheetSplitDetectPending,
  listSplittableStoryboardSheetPreviews,
  loadStoryboardSheetPreviewsStored,
  mergeLiveStoryboardSheetPreviewSplitState,
  mergeStoryboardSheetPreviews,
  prependStoryboardSheetPreview,
  prepareStoryboardSheetPreviewForSave,
  readStoryboardSheetPreviews,
  removeStoryboardSheetPreview,
  resolveSheetTaskRows,
  resolveStoryboardSheetPreviewDataUrl,
  shotNosFromSheetSplitBoxes,
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
  clearStoryboardCollageBatchSession,
  getStoryboardCollageBatchSession,
  isStoryboardCollageBatchSessionBusy,
  patchStoryboardCollageBatchSession,
  queuedStoryboardCollageRowIdsFromTasks,
  subscribeStoryboardCollageBatchSession,
  type StoryboardCollageBatchSessionState,
} from '../../services/storyboardCollageBatchSession';
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
  normalizeStoryboardShotNoInput,
} from '../../services/storyboardTableParse';
import { readLocalJson, writeLocalJson } from '../../services/clientPersist';
import {
  coerceImageModelRegistryId,
  DEFAULT_IMAGE_MODEL_REGISTRY_ID,
} from '../../services/modelRegistry/imageModels';
import { useEffectiveImageModelRows } from '../../hooks/useEffectiveImageGearRows';
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
  readStoryboardGridIncludeShotText,
  readStoryboardGridOverlayRoleMarks,
  STORYBOARD_GRID_EXPORT_WIDTH_PRESETS,
  writeStoryboardGridExportWidth,
  writeStoryboardGridIncludeShotText,
  writeStoryboardGridOverlayRoleMarks,
} from '../../services/storyboardGridExport';
import {
  compressStoryboardFrameDataUrl,
  readStoryboardFrameFromClipboard,
  readStoryboardFrameFromFile,
} from './storyboardFrameImage';
import {
  buildStoryboardFrameDropSplitFallbackBoxes,
  collectStoryboardFrameImageFiles,
  normalizeStoryboardFrameDropSplitBoxes,
  planStoryboardFrameDropSplitScope,
  planStoryboardFrameImportAssignmentForTargetRow,
  planStoryboardFrameImportAssignments,
  resolveStoryboardFrameDropSplitTaskRows,
  shouldStoryboardFrameDropUseSheetSplit,
} from '../../services/storyboardTableFrameImport';
import { collectStoryboardFrameImageInputForDrop } from '../../services/storyboardFrameDrag';
import {
  appendStoryboardGeneratedImageHistoryBatch,
  backfillStoryboardGeneratedImageHistory,
  collectStoryboardGeneratedImageRecordsFromPatches,
  listStoryboardGeneratedImageAssets,
  normalizeStoryboardGeneratedImageHistory,
} from '../../services/storyboardGeneratedAssets';
import {
  applyStoryboardFrameHistoryCompanionHydrateResults,
  applyStoryboardGeneratedImageHistoryCompanionHydrateResults,
  hydrateStoryboardFrameHistoryCompanionTasks,
  hydrateStoryboardGeneratedImageHistoryCompanionTasks,
  listStoryboardFrameHistoryCompanionHydrateTasks,
  listStoryboardGeneratedImageHistoryCompanionHydrateTasks,
  revokeStoryboardFrameCompanionHydrateUrls,
} from '../../services/storyboardFrameCompanion';
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
import StoryboardFrameCropModal, {
  type StoryboardFrameCropNorm,
  isNearlyFullCropNorm,
} from './StoryboardFrameCropModal';
import StoryboardInsertShotModal from './StoryboardInsertShotModal';
import {
  computeInsertShotNoAfterRow,
  computeInsertShotNoBeforeRow,
} from '../../services/storyboardInsertShot';
import { cropDataUrlByViewportNorm } from '../../services/panoViewportCapture';
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
  capabilityTextModel = '',
  onRedrawRow,
  onPatchAsset,
  companionBaseUrl = '',
  companionProjectId = '',
}: Props) {
  const { rows: effectiveImageModelRows, coerceModelId: coerceEffectiveImageModelId } =
    useEffectiveImageModelRows();
  const table = useMemo(() => normalizeStoryboardTableDoc(asset.storyboardTable), [asset.storyboardTable]);
  const stats = useMemo(() => computeStoryboardTableStats(table), [table]);
  const generatedImageAssets = useMemo(
    () =>
      listStoryboardGeneratedImageAssets(
        table.rows,
        table.generatedImageHistory
      ),
    [table.generatedImageHistory, table.rows]
  );
  const [genHistoryHydrateSeq, setGenHistoryHydrateSeq] = useState(0);
  const genHistoryHydrateDebounceRef = useRef(0);
  const requestGeneratedImageHistoryHydrate = useCallback(() => {
    const now = Date.now();
    if (now - genHistoryHydrateDebounceRef.current < 800) return;
    genHistoryHydrateDebounceRef.current = now;
    setGenHistoryHydrateSeq((seq) => seq + 1);
  }, []);

  useEffect(() => {
    if (!genHistoryHydrateSeq) return;
    const base = String(companionBaseUrl || '').trim();
    const pid = String(companionProjectId || '').trim();
    if (!base || !pid) return;
    let cancelled = false;
    void (async () => {
      const snapshot = normalizeStoryboardTableOnAsset(asset);
      const genTasks = listStoryboardGeneratedImageHistoryCompanionHydrateTasks([snapshot]);
      const historyTasks = listStoryboardFrameHistoryCompanionHydrateTasks([snapshot]);
      const [genResult, historyResult] = await Promise.all([
        hydrateStoryboardGeneratedImageHistoryCompanionTasks(genTasks, base, pid),
        hydrateStoryboardFrameHistoryCompanionTasks(historyTasks, base, pid),
      ]);
      if (cancelled) {
        revokeStoryboardFrameCompanionHydrateUrls([
          ...genResult.hydrated,
          ...historyResult.hydrated,
        ]);
        return;
      }
      if (!genResult.hydrated.length && !historyResult.hydrated.length) return;
      onPatchAsset((cur) => {
        if (cur.id !== asset.id) return cur;
        let next = cur;
        if (historyResult.hydrated.length) {
          next =
            applyStoryboardFrameHistoryCompanionHydrateResults([next], historyResult.hydrated)[0] ??
            next;
        }
        if (genResult.hydrated.length) {
          next =
            applyStoryboardGeneratedImageHistoryCompanionHydrateResults(
              [next],
              genResult.hydrated
            )[0] ?? next;
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    asset,
    companionBaseUrl,
    companionProjectId,
    genHistoryHydrateSeq,
    onPatchAsset,
  ]);
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
  const [gridOverlayRoleMarks, setGridOverlayRoleMarks] = useState(() =>
    readStoryboardGridOverlayRoleMarks()
  );
  const [gridIncludeShotText, setGridIncludeShotText] = useState(() =>
    readStoryboardGridIncludeShotText()
  );
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
  const [sceneAssetBusyId, setSceneAssetBusyId] = useState<string | null>(null);
  const [collageBatchSession, setCollageBatchSession] = useState<StoryboardCollageBatchSessionState>(
    () =>
      getStoryboardCollageBatchSession(asset.id) ?? {
        busy: false,
        kind: null,
        rowIds: [],
        queuedRowIds: [],
        progress: null,
      }
  );
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
  const [sheetGenBusy, setSheetGenBusy] = useState(() => isStoryboardSheetGenSessionBusy(asset.id));
  const [sheetGenProgress, setSheetGenProgress] = useState<{ done: number; total: number } | null>(
    () => getStoryboardSheetGenSession(asset.id)?.progress ?? null
  );
  const [sheetPreviews, setSheetPreviews] = useState<StoryboardSheetPreviewItem[]>(
    () => getStoryboardSheetGenSession(asset.id)?.previews ?? []
  );
  const sheetPreviewsRef = useRef<StoryboardSheetPreviewItem[]>(
    getStoryboardSheetGenSession(asset.id)?.previews ?? []
  );
  const sheetGenBusyRef = useRef(isStoryboardSheetGenSessionBusy(asset.id));
  const sheetSplitBatchBusyRef = useRef(
    getStoryboardSheetSplitSession(asset.id)?.batchBusy ?? false
  );
  const sheetPreviewSaveChainRef = useRef(Promise.resolve());
  const sheetSplitDetectJobsRef = useRef(new Map<string, Promise<BoundingBox[]>>());
  const sheetSplitDetectQueueRef = useRef<Array<{ previewId: string; dataUrl: string }>>([]);
  const sheetSplitDetectDrainingRef = useRef(false);
  const sheetGenControllerRef = useRef<StoryboardSheetGenBatchController | null>(
    getStoryboardSheetGenSession(asset.id)?.controller ?? null
  );
  const sheetGenPlaceholderIdsRef = useRef<Map<number, string>>(
    new Map(getStoryboardSheetGenSession(asset.id)?.placeholderIdByChunk ?? [])
  );
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
  type StoryboardSheetSplitAdjustDraft = {
    previewId: string;
    imageSrc: string;
    boxes: BoundingBox[];
    expectedShotNos: string[];
    sheetLabel: string;
    detecting: boolean;
    applying: boolean;
    detectStatus?: string;
    initialSelectedId?: string | null;
  };
  type StoryboardSheetSplitAdjustDetectApi = {
    setStatus: (message: string) => void;
    patchDraft: (patch: Partial<Pick<StoryboardSheetSplitAdjustDraft, 'expectedShotNos' | 'sheetLabel'>>) => void;
  };
  const [splitAdjustDraft, setSplitAdjustDraft] = useState<StoryboardSheetSplitAdjustDraft | null>(null);
  const [frameCropDraft, setFrameCropDraft] = useState<{
    current: { rowId: string; imageSrc: string; shotNo?: string };
    rest: Array<{ rowId: string; imageSrc: string; shotNo?: string }>;
    applying: boolean;
    mode?: 'import' | 'recrop';
    initialCropNorm?: StoryboardFrameCropNorm | null;
  } | null>(null);
  const [frameCollageSplitCtx, setFrameCollageSplitCtx] = useState<{
    previewId: string;
    sheetImage: string;
    layout: FeedbackCollageLayout;
    boxes: BoundingBox[];
    rowIds: string[];
    sheetLabel: string;
  } | null>(null);
  const [insertShotModalOpen, setInsertShotModalOpen] = useState(false);
  const [insertShotInitialNo, setInsertShotInitialNo] = useState<string | null>(null);

  const panelMountedRef = useRef(true);
  const syncSheetSplitSession = useCallback(
    (patch: Partial<StoryboardSheetSplitSessionState>) => {
      const next = patchStoryboardSheetSplitSession(asset.id, patch);
      if (!panelMountedRef.current) return next;
      sheetSplitBatchBusyRef.current = next.batchBusy;
      setSheetSplitBatchBusy(next.batchBusy);
      setSheetSplitProgress(next.progress);
      setSheetSplitBusyId(next.busyPreviewId);
      return next;
    },
    [asset.id]
  );
  const syncCollageBatchSession = useCallback(
    (patch: Partial<StoryboardCollageBatchSessionState>) => {
      const next = patchStoryboardCollageBatchSession(asset.id, patch);
      if (panelMountedRef.current) {
        setCollageBatchSession(next);
      }
      return next;
    },
    [asset.id]
  );
  const collageProcessing = useMemo(() => {
    if (!collageBatchSession.busy || !collageBatchSession.kind) return null;
    return {
      kind: collageBatchSession.kind,
      rowIds: collageBatchSession.rowIds,
      queuedRowIds: collageBatchSession.queuedRowIds,
    };
  }, [collageBatchSession]);
  const feedbackBatchBusy =
    collageBatchSession.busy && collageBatchSession.kind === 'feedback';
  const feedbackBatchProgress = feedbackBatchBusy ? collageBatchSession.progress : null;
  const roleReplaceBatchBusy =
    collageBatchSession.busy && collageBatchSession.kind === 'roleReplace';
  const roleReplaceBatchProgress = roleReplaceBatchBusy ? collageBatchSession.progress : null;
  const selectedSheetGenBatchBusy =
    collageBatchSession.busy && collageBatchSession.kind === 'sheetGen';
  const selectedSheetGenBatchProgress = selectedSheetGenBatchBusy
    ? collageBatchSession.progress
    : null;
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
    panelMountedRef.current = true;
    const splitSession = getStoryboardSheetSplitSession(asset.id);
    if (splitSession?.busy && !splitSession.batchBusy) {
      patchStoryboardSheetSplitSession(asset.id, { busy: false, busyPreviewId: null });
    }

    const unsubscribeSplit = subscribeStoryboardSheetSplitSession(asset.id, (session) => {
      if (!panelMountedRef.current) return;
      sheetSplitBatchBusyRef.current = session.batchBusy;
      setSheetSplitBatchBusy(session.batchBusy);
      setSheetSplitProgress(session.progress);
      setSheetSplitBusyId(session.busyPreviewId);
    });

    const unsubscribeCollage = subscribeStoryboardCollageBatchSession(asset.id, (session) => {
      if (panelMountedRef.current) {
        setCollageBatchSession(session);
      }
    });

    return () => {
      panelMountedRef.current = false;
      splitAdjustResolverRef.current?.(null);
      splitAdjustResolverRef.current = null;
      unsubscribeSplit();
      unsubscribeCollage();
    };
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

  const toggleGridOverlayRoleMarks = useCallback(() => {
    setGridOverlayRoleMarks((prev) => {
      const next = !prev;
      writeStoryboardGridOverlayRoleMarks(next);
      return next;
    });
  }, []);

  const toggleGridIncludeShotText = useCallback(() => {
    setGridIncludeShotText((prev) => {
      const next = !prev;
      writeStoryboardGridIncludeShotText(next);
      return next;
    });
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
          gridExportWidth,
          gridOverlayRoleMarks,
          gridIncludeShotText
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
    [gridDownloadBusy, gridExportWidth, gridIncludeShotText, gridOverlayRoleMarks, onNotify, table.fieldCatalog]
  );

  const handleDownloadAllGridGroups = useCallback(async () => {
    if (gridDownloadBusy || !gridGroups.length) return;
    setGridDownloadBusy(true);
    try {
      const count = await downloadAllStoryboardGroupMosaics(
        gridGroups,
        table.fieldCatalog,
        gridExportWidth,
        gridOverlayRoleMarks,
        gridIncludeShotText
      );
      if (count > 0) {
        const extras: string[] = [];
        if (gridOverlayRoleMarks) extras.push('含人名标签');
        if (gridIncludeShotText) extras.push('含分镜文本');
        onNotify?.(
          'info',
          `已保存 ${count} 张分镜拼图到浏览器下载文件夹（${gridExportWidth}px 宽${
            extras.length ? `，${extras.join('、')}` : ''
          }，文件名以 storyboard- 开头）`
        );
      } else {
        onNotify?.('warn', '没有可导出的拼图');
      }
    } finally {
      setGridDownloadBusy(false);
    }
  }, [gridDownloadBusy, gridExportWidth, gridGroups, gridIncludeShotText, gridOverlayRoleMarks, onNotify, table.fieldCatalog]);

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
    return coerceEffectiveImageModelId(coerceImageModelRegistryId(stored));
  }, [coerceEffectiveImageModelId]);

  const [editRedrawModelId, setEditRedrawModelId] = useState(resolvedEditRedrawModelId);

  useEffect(() => {
    setEditRedrawModelId(resolvedEditRedrawModelId);
  }, [asset.id, resolvedEditRedrawModelId]);

  const effectiveEditRedrawModelId = editRedrawModelId;

  const setEditRedrawModelIdPersisted = useCallback((modelId: string) => {
    const coerced = coerceEffectiveImageModelId(coerceImageModelRegistryId(modelId));
    setEditRedrawModelId(coerced);
    writeLocalJson(STORYBOARD_EDIT_REDRAW_MODEL_KEY, coerced);
  }, [coerceEffectiveImageModelId]);

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
    return coerceEffectiveImageModelId(coerceImageModelRegistryId(stored));
  }, [coerceEffectiveImageModelId]);

  const [feedbackCollageModelId, setFeedbackCollageModelId] = useState(resolvedFeedbackCollageModelId);

  useEffect(() => {
    setFeedbackCollageModelId(resolvedFeedbackCollageModelId);
  }, [asset.id, resolvedFeedbackCollageModelId]);

  const effectiveFeedbackCollageModelId = feedbackCollageModelId;

  const setFeedbackCollageModelIdPersisted = useCallback((modelId: string) => {
    const coerced = coerceEffectiveImageModelId(coerceImageModelRegistryId(modelId));
    setFeedbackCollageModelId(coerced);
    writeLocalJson(STORYBOARD_EDIT_FEEDBACK_COLLAGE_MODEL_KEY, coerced);
  }, [coerceEffectiveImageModelId]);

  const feedbackCollageModelOptions = useMemo(
    () => effectiveImageModelRows.map((m) => ({ value: m.registryId, label: m.label })),
    [effectiveImageModelRows]
  );

  const editRedrawModelOptions = useMemo(
    () => effectiveImageModelRows.map((m) => ({ value: m.registryId, label: m.label })),
    [effectiveImageModelRows]
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

  const parseCtx = useMemo(
    () => ({
      onLog: (level: 'info' | 'warn', message: string) =>
        onNotify?.(level === 'warn' ? 'warn' : 'info', message),
      textModelRegistryId: capabilityTextModel,
      storyboardAssetId: asset.id,
    }),
    [asset.id, capabilityTextModel, onNotify]
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
    const escBlockedByOverlay =
      Boolean(lightboxSrc) ||
      Boolean(frameCropDraft) ||
      Boolean(splitAdjustDraft) ||
      insertShotModalOpen;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !escBlockedByOverlay) {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [frameCropDraft, insertShotModalOpen, lightboxSrc, splitAdjustDraft]);

  useEffect(() => {
    const persisted = normalizeStoryboardGeneratedImageHistory(
      asset.storyboardTable?.generatedImageHistory
    );
    const backfilled = backfillStoryboardGeneratedImageHistory(persisted, table.rows);
    if (backfilled.length <= persisted.length) return;
    onPatchAsset((cur) => {
      const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
      return {
        ...cur,
        storyboardTable: {
          ...doc,
          generatedImageHistory: backfilled,
        },
      };
    });
  }, [asset.id, asset.storyboardTable?.generatedImageHistory, onPatchAsset, table.rows]);

  const patchTable = useCallback(
    (
      mutate: (rows: StoryboardTableRow[]) => StoryboardTableRow[],
      options?: {
        fieldCatalog?: StoryboardParseFieldDef[];
        generatedImageRecords?: StoryboardGeneratedImageRecord[];
      }
    ) => {
      onPatchAsset((cur) => {
        const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
        const titleRaw = readStoryboardTableTitleRaw(cur);
        const catalog = options?.fieldCatalog ?? doc.fieldCatalog;
        const nextRows = reindexStoryboardRows(mutate([...doc.rows])).map((r) =>
          applyShotFieldsPatch(r, catalog, r.shotFields)
        );
        const generatedImageHistory = options?.generatedImageRecords?.length
          ? appendStoryboardGeneratedImageHistoryBatch(
              doc.generatedImageHistory,
              options.generatedImageRecords
            )
          : doc.generatedImageHistory;
        return {
          ...cur,
          textTitle: titleRaw,
          storyboardTable: {
            ...doc,
            title: titleRaw,
            fieldCatalog: catalog,
            rows: nextRows,
            ...(generatedImageHistory?.length ? { generatedImageHistory } : {}),
          },
        };
      });
    },
    [onPatchAsset]
  );

  const patchRow = useCallback(
    (rowId: string, patch: Partial<StoryboardTableRow>) => {
      onPatchAsset((cur) => {
        const doc = cur.storyboardTable;
        if (!doc?.rows?.length) return cur;
        const titleRaw = readStoryboardTableTitleRaw(cur);
        const fieldCatalog = doc.fieldCatalog ?? [];
        const rows = doc.rows.map((r) => {
          if (r.id !== rowId) return r;
          if (storyboardRowIsPassed(r) && !canPatchStoryboardPassedRow(patch)) return r;
          if (patch.shotFields) {
            return applyShotFieldsPatch(
              { ...r, ...patch },
              fieldCatalog,
              { ...r.shotFields, ...patch.shotFields }
            );
          }
          const next = { ...r, ...patch };
          if ('shotNo' in patch && !String(patch.shotNo ?? '').trim()) {
            next.shotNo = undefined;
          }
          return applyShotFieldsPatch(next, fieldCatalog, next.shotFields);
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

  const commitRowShotNo = useCallback(
    (rowId: string, raw: string) => {
      if (readOnly) return;
      const trimmed = raw.trim();
      const shotNo = trimmed ? normalizeStoryboardShotNoInput(trimmed) : '';
      onPatchAsset((cur) => {
        const doc = cur.storyboardTable;
        if (!doc?.rows?.length) return cur;
        const titleRaw = readStoryboardTableTitleRaw(cur);
        let rows = doc.rows.map((r) => {
          if (r.id !== rowId) return r;
          if (storyboardRowIsPassed(r)) return r;
          return { ...r, shotNo: shotNo || undefined };
        });
        if (shotNo) {
          const targetNum = Number(shotNo);
          if (Number.isFinite(targetNum) && targetNum >= 1) {
            const fromIdx = rows.findIndex((r) => r.id === rowId);
            const toIdx = Math.min(rows.length - 1, Math.max(0, targetNum - 1));
            if (fromIdx >= 0 && fromIdx !== toIdx) {
              rows = reorderStoryboardRows(rows, fromIdx, toIdx);
            }
          }
        }
        rows = applySequentialShotNumbers(rows);
        return {
          ...cur,
          textTitle: titleRaw,
          storyboardTable: { ...doc, title: titleRaw, rows },
        };
      });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => navigateToRow(rowId));
      });
    },
    [navigateToRow, onPatchAsset, readOnly]
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

  const patchSceneAssets = useCallback(
    (mutate: (assets: StoryboardSceneAsset[]) => StoryboardSceneAsset[]) => {
      onPatchAsset((cur) => {
        const doc = normalizeStoryboardTableDoc(cur.storyboardTable);
        const titleRaw = readStoryboardTableTitleRaw(cur);
        const nextAssets = mutate([...(doc.sceneAssets ?? [])]);
        return {
          ...cur,
          textTitle: titleRaw,
          storyboardTable: {
            ...doc,
            title: titleRaw,
            sceneAssets: nextAssets.length ? nextAssets : undefined,
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
        const imagePatch = await persistStoryboardNamedAssetImage({
          dataUrl,
          tableAssetId: asset.id,
          namedAssetId: id,
          kind: 'role',
          companionBaseUrl,
          companionProjectId,
        });
        patchRoleAssets((assets) =>
          assets.map((item) => (item.id === id ? { ...item, ...imagePatch } : item))
        );
        if (!imagePatch.imageCompanionKey && dataUrl.startsWith('data:')) {
          onNotify?.(
            'warn',
            companionBaseUrl.trim() && companionProjectId.trim()
              ? '角色图已暂存于浏览器；伴侣写入失败，换设备前请确认云同步'
              : '角色图已写入分镜表；连接本地伴侣后可落盘，便于跨设备恢复'
          );
        }
      } catch (err) {
        onNotify?.('warn', err instanceof Error ? err.message : '图片处理失败');
      } finally {
        setRoleAssetBusyId(null);
      }
    },
    [asset.id, companionBaseUrl, companionProjectId, onNotify, patchRoleAssets, readOnly]
  );

  const clearRoleAssetImage = useCallback(
    (id: string) => {
      if (readOnly) return;
      patchRoleAssets((assets) =>
        assets.map((item) => (item.id === id ? { ...item, ...clearStoryboardNamedAssetImageFields() } : item))
      );
    },
    [patchRoleAssets, readOnly]
  );

  const addSceneAsset = useCallback(() => {
    if (readOnly) return;
    patchSceneAssets((assets) => [...assets, createStoryboardSceneAsset(undefined, assets.length)]);
  }, [patchSceneAssets, readOnly]);

  const removeSceneAsset = useCallback(
    (id: string) => {
      if (readOnly) return;
      patchSceneAssets((assets) => assets.filter((item) => item.id !== id));
    },
    [patchSceneAssets, readOnly]
  );

  const renameSceneAsset = useCallback(
    (id: string, name: string) => {
      if (readOnly) return;
      patchSceneAssets((assets) =>
        assets.map((item) => (item.id === id ? { ...item, name } : item))
      );
    },
    [patchSceneAssets, readOnly]
  );

  const assignSceneAssetImage = useCallback(
    async (id: string, file: File) => {
      if (readOnly) return;
      setSceneAssetBusyId(id);
      try {
        const dataUrl = await readStoryboardFrameFromFile(file);
        const imagePatch = await persistStoryboardNamedAssetImage({
          dataUrl,
          tableAssetId: asset.id,
          namedAssetId: id,
          kind: 'scene',
          companionBaseUrl,
          companionProjectId,
        });
        patchSceneAssets((assets) =>
          assets.map((item) => (item.id === id ? { ...item, ...imagePatch } : item))
        );
        if (!imagePatch.imageCompanionKey && dataUrl.startsWith('data:')) {
          onNotify?.(
            'warn',
            companionBaseUrl.trim() && companionProjectId.trim()
              ? '场景图已暂存于浏览器；伴侣写入失败，换设备前请确认云同步'
              : '场景图已写入分镜表；连接本地伴侣后可落盘，便于跨设备恢复'
          );
        }
      } catch (err) {
        onNotify?.('warn', err instanceof Error ? err.message : '图片处理失败');
      } finally {
        setSceneAssetBusyId(null);
      }
    },
    [asset.id, companionBaseUrl, companionProjectId, onNotify, patchSceneAssets, readOnly]
  );

  const assignRoleAssetImages = useCallback(
    async (startAssetId: string | null, files: File[]) => {
      if (readOnly) return;
      const imageFiles = collectStoryboardFrameImageFiles(files);
      if (!imageFiles.length) return;
      const assets = table.roleAssets ?? [];
      const { assignments, skippedFilled, unusedFiles } = planStoryboardNamedAssetImportAssignments(
        assets,
        startAssetId,
        imageFiles.length,
        { overwriteStart: Boolean(startAssetId) }
      );
      if (!assignments.length) {
        onNotify?.(
          'warn',
          skippedFilled > 0 ? '角色槽位均已配图，请先清除或拖到指定角色上覆盖' : '请先添加角色'
        );
        return;
      }
      for (const { assetId, fileIndex } of assignments) {
        await assignRoleAssetImage(assetId, imageFiles[fileIndex]!);
      }
      if (assignments.length > 0) {
        const parts = [`已为 ${assignments.length} 个角色配图`];
        if (unusedFiles > 0) parts.push(`${unusedFiles} 张未使用`);
        onNotify?.('info', parts.join('，'));
      }
    },
    [assignRoleAssetImage, onNotify, readOnly, table.roleAssets]
  );

  const assignSceneAssetImages = useCallback(
    async (startAssetId: string | null, files: File[]) => {
      if (readOnly) return;
      const imageFiles = collectStoryboardFrameImageFiles(files);
      if (!imageFiles.length) return;
      const assets = table.sceneAssets ?? [];
      const { assignments, skippedFilled, unusedFiles } = planStoryboardNamedAssetImportAssignments(
        assets,
        startAssetId,
        imageFiles.length,
        { overwriteStart: Boolean(startAssetId) }
      );
      if (!assignments.length) {
        onNotify?.(
          'warn',
          skippedFilled > 0 ? '场景槽位均已配图，请先清除或拖到指定场景上覆盖' : '请先添加场景'
        );
        return;
      }
      for (const { assetId, fileIndex } of assignments) {
        await assignSceneAssetImage(assetId, imageFiles[fileIndex]!);
      }
      if (assignments.length > 0) {
        const parts = [`已为 ${assignments.length} 个场景配图`];
        if (unusedFiles > 0) parts.push(`${unusedFiles} 张未使用`);
        onNotify?.('info', parts.join('，'));
      }
    },
    [assignSceneAssetImage, onNotify, readOnly, table.sceneAssets]
  );

  const clearSceneAssetImage = useCallback(
    (id: string) => {
      if (readOnly) return;
      patchSceneAssets((assets) =>
        assets.map((item) => (item.id === id ? { ...item, ...clearStoryboardNamedAssetImageFields() } : item))
      );
    },
    [patchSceneAssets, readOnly]
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

  const updateFrameRoleMark = useCallback(
    (
      rowId: string,
      markId: string,
      patch: { x?: number; y?: number }
    ) => {
      if (readOnly) return;
      const row = table.rows.find((item) => item.id === rowId);
      if (!row) return;
      if (storyboardRowIsPassed(row)) return;
      patchRow(rowId, {
        frameRoleMarks: updateStoryboardFrameRoleMark(row.frameRoleMarks, markId, patch),
      });
    },
    [patchRow, readOnly, table.rows]
  );

  const removeFrameRoleMark = useCallback(
    (rowId: string, markId: string) => {
      if (readOnly) return;
      const row = table.rows.find((item) => item.id === rowId);
      if (!row) return;
      if (storyboardRowIsPassed(row)) return;
      patchRow(rowId, {
        frameRoleMarks: removeStoryboardFrameRoleMark(row.frameRoleMarks, markId),
      });
    },
    [patchRow, readOnly, table.rows]
  );

  const rebindFrameRoleMark = useCallback(
    (rowId: string, markId: string, asset: { id: string; name: string }) => {
      if (readOnly) return;
      const row = table.rows.find((item) => item.id === rowId);
      if (!row) return;
      if (storyboardRowIsPassed(row)) return;
      patchRow(rowId, {
        frameRoleMarks: rebindStoryboardFrameRoleMark(row.frameRoleMarks, markId, asset),
      });
    },
    [patchRow, readOnly, table.rows]
  );

  const setFrameRoleMarkCustomName = useCallback(
    (rowId: string, markId: string, name: string) => {
      if (readOnly) return;
      const row = table.rows.find((item) => item.id === rowId);
      if (!row) return;
      if (storyboardRowIsPassed(row)) return;
      patchRow(rowId, {
        frameRoleMarks: setStoryboardFrameRoleMarkCustomName(row.frameRoleMarks, markId, name),
      });
    },
    [patchRow, readOnly, table.rows]
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
      const patchResults = await Promise.all(
        split.matches.map(async (match) => {
          let compressed = match.image;
          try {
            compressed = await compressStoryboardFrameDataUrl(match.image);
          } catch {
            /* keep raw */
          }
          const tableRow =
            rowLookup.get(match.rowId) ?? taskRows.find((row) => row.id === match.rowId);
          if (!tableRow) return null;
          const patch = await replaceStoryboardRowFrame({
            row: tableRow,
            dataUrl: compressed,
            assetId: asset.id,
            companionBaseUrl,
            companionProjectId,
            source: 'sheet_split',
          });
          return { rowId: match.rowId, compressed, patch };
        })
      );
      for (const item of patchResults) {
        if (!item) continue;
        rowImages[item.rowId] = item.compressed;
        rowPatches.set(item.rowId, item.patch);
      }

      const createdRowsToAdd = (split.createdRows ?? []).filter(
        (row) => !lookupRows.some((item) => item.id === row.id)
      );
      if (rowPatches.size > 0 || createdRowsToAdd.length > 0) {
        const generatedImageRecords = collectStoryboardGeneratedImageRecordsFromPatches(
          [...lookupRows, ...createdRowsToAdd],
          rowPatches
        );
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
          { fieldCatalog, generatedImageRecords }
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
        adjustedBoxes?: BoundingBox[];
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
        ? opts?.adjustedBoxes?.length
          ? await splitStoryboardFeedbackCollageWithBoxes(
              normalized,
              feedbackLayout,
              opts.adjustedBoxes,
              taskRows
            )
          : await splitStoryboardFeedbackCollageWithBoxes(
              normalized,
              feedbackLayout,
              feedbackCollageLayoutToBoxes(feedbackLayout),
              taskRows
            )
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
              storyboardAssetId: asset.id,
            }
          );

      return applySheetVisionSplitResult(split, taskRows, fieldCatalog, lookupRows);
    },
    [applySheetVisionSplitResult, asset.id, capabilityTextModel]
  );

  const promptSheetSplitBoxAdjust = useCallback(
    (
      draft: Omit<StoryboardSheetSplitAdjustDraft, 'detecting' | 'applying' | 'detectStatus'>,
      detectBoxes: (api: StoryboardSheetSplitAdjustDetectApi) => Promise<BoundingBox[]>
    ) =>
      new Promise<BoundingBox[] | null>((resolve) => {
        splitAdjustResolverRef.current = resolve;
        const hasInitialBoxes = draft.boxes.length > 0;
        setSplitAdjustDraft({
          ...draft,
          detecting: !hasInitialBoxes,
          applying: false,
          detectStatus: hasInitialBoxes ? undefined : '正在识别分镜结构…',
        });
        if (hasInitialBoxes) return;
        const api: StoryboardSheetSplitAdjustDetectApi = {
          setStatus: (message) => {
            setSplitAdjustDraft((prev) =>
              prev?.previewId === draft.previewId ? { ...prev, detectStatus: message } : prev
            );
          },
          patchDraft: (patch) => {
            setSplitAdjustDraft((prev) =>
              prev?.previewId === draft.previewId ? { ...prev, ...patch } : prev
            );
          },
        };
        void detectBoxes(api)
          .then((boxes) => {
            setSplitAdjustDraft((prev) =>
              prev?.previewId === draft.previewId
                ? { ...prev, boxes, detecting: false, detectStatus: undefined }
                : prev
            );
          })
          .catch((error) => {
            setSplitAdjustDraft((prev) =>
              prev?.previewId === draft.previewId
                ? { ...prev, detecting: false, detectStatus: undefined }
                : prev
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
    const resolve = splitAdjustResolverRef.current;
    splitAdjustResolverRef.current = null;
    setSplitAdjustDraft(null);
    resolve?.(boxes);
  }, []);

  const promptFeedbackCollageSplitAdjust = useCallback(
    async (args: {
      previewId: string;
      sheetImage: string;
      layout: FeedbackCollageLayout;
      rowIds: string[];
      sheetLabel: string;
      focusRowId?: string | null;
    }) => {
      const expectedShotNos = args.rowIds
        .map((id) => table.rows.find((r) => r.id === id)?.shotNo?.trim())
        .filter((s): s is string => Boolean(s));
      const initialBoxes = feedbackCollageLayoutToManualAdjustBoxes(args.layout);
      return promptSheetSplitBoxAdjust(
        {
          previewId: args.previewId,
          imageSrc: args.sheetImage,
          boxes: initialBoxes,
          expectedShotNos,
          sheetLabel: args.sheetLabel,
          initialSelectedId: args.focusRowId ?? null,
        },
        async (_api) => initialBoxes
      );
    },
    [promptSheetSplitBoxAdjust, table.rows]
  );

  const beginFrameRecropFromRow = useCallback(
    async (rowId: string) => {
      if (frameCropDraft) return;
      const row = table.rows.find((r) => r.id === rowId);
      if (!row || !storyboardRowHasFrameRef(row)) return;
      if (readOnly || storyboardRowIsPassed(row)) {
        const src = resolveStoryboardRowFrameDisplaySrc(row);
        if (src) openStoryboardLightbox(src);
        return;
      }

      let imageSrc = resolveStoryboardRowFrameDisplaySrc(row);
      if (!imageSrc) {
        onNotify?.('warn', '分镜图仍在加载，请稍后再试');
        return;
      }
      if (!/^data:/i.test(imageSrc) && !/^blob:/i.test(imageSrc)) {
        const resolved = await resolveStoryboardRowFrameDataUrl(
          row,
          companionBaseUrl,
          companionProjectId
        );
        if (!resolved.ok) {
          onNotify?.('warn', resolved.error || '分镜图加载失败');
          return;
        }
        imageSrc = resolved.dataUrl;
      }

      setFrameCropDraft({
        current: {
          rowId,
          imageSrc,
          shotNo: row.shotNo?.trim() || undefined,
        },
        rest: [],
        applying: false,
        mode: 'recrop',
        initialCropNorm: { x: 0, y: 0, w: 1, h: 1 },
      });
    },
    [companionBaseUrl, companionProjectId, frameCropDraft, onNotify, openStoryboardLightbox, readOnly, table.rows]
  );

  const previewRowFrame = useCallback(
    (row: StoryboardTableRow) => {
      const ctx = frameCollageSplitCtx;
      if (ctx?.rowIds.includes(row.id)) {
        void (async () => {
          const adjusted = await promptFeedbackCollageSplitAdjust({
            previewId: ctx.previewId,
            sheetImage: ctx.sheetImage,
            layout: ctx.layout,
            rowIds: ctx.rowIds,
            sheetLabel: ctx.sheetLabel,
            focusRowId: row.id,
          });
          if (!adjusted) return;
          setFrameCollageSplitCtx({ ...ctx, boxes: adjusted });
          const taskRows = table.rows.filter((r) => ctx.rowIds.includes(r.id));
          const split = await splitStoryboardFeedbackCollageWithBoxes(
            ctx.sheetImage,
            ctx.layout,
            adjusted,
            taskRows
          );
          const match = split.matches.find((m) => m.rowId === row.id);
          if (!match?.image) {
            onNotify?.('warn', split.warn || '裁切回填失败');
            return;
          }
          let compressed = match.image;
          try {
            compressed = await compressStoryboardFrameDataUrl(match.image);
          } catch {
            /* keep raw */
          }
          const framePatch = await replaceStoryboardRowFrame({
            row,
            dataUrl: compressed,
            assetId: asset.id,
            companionBaseUrl,
            companionProjectId,
            source: 'sheet_split',
          });
          patchRow(row.id, framePatch);
          onNotify?.('info', '已按裁切框更新本镜分镜图');
        })();
        return;
      }
      void beginFrameRecropFromRow(row.id);
    },
    [
      asset.id,
      beginFrameRecropFromRow,
      companionBaseUrl,
      companionProjectId,
      frameCollageSplitCtx,
      onNotify,
      patchRow,
      promptFeedbackCollageSplitAdjust,
      table.rows,
    ]
  );

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
        const live = sheetPreviewsRef.current.find((item) => item.id === prepared.preview.id);
        const preview = mergeLiveStoryboardSheetPreviewSplitState(prepared.preview, live);

        commitSheetPreviews((prev) => {
          const result = existing
            ? upsertStoryboardSheetPreview(asset.id, preview, prev)
            : prependStoryboardSheetPreview(asset.id, preview, prev);
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
        return preview;
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

  const persistSheetPreviewPatch = useCallback(
    (previewId: string, patch: Partial<StoryboardSheetPreviewItem>) => {
      commitSheetPreviews((prev) => {
        const updateResult = updateStoryboardSheetPreview(asset.id, previewId, patch, prev);
        void syncSheetPreviewListToCompanion(updateResult.items);
        return updateResult.items;
      });
    },
    [asset.id, commitSheetPreviews, syncSheetPreviewListToCompanion]
  );

  const resolveSheetPreviewSplitDraftBoxes = useCallback(
    async (previewId: string): Promise<BoundingBox[]> => {
      const pending = sheetSplitDetectJobsRef.current.get(previewId);
      if (pending) {
        try {
          await pending;
        } catch {
          /* failed state persisted in runSheetPreviewSplitDetect */
        }
      }
      const item = sheetPreviewsRef.current.find((preview) => preview.id === previewId);
      return (item?.splitDraftBoxes ?? []).map((box) => clampStoryboardSheetSplitBox(box));
    },
    []
  );

  const runSheetPreviewSplitDetect = useCallback(
    (previewId: string, dataUrl: string): Promise<BoundingBox[]> => {
      const existing = sheetSplitDetectJobsRef.current.get(previewId);
      if (existing) return existing;

      const job = (async () => {
        patchSheetPreviewInMemory(previewId, {
          splitDetectStatus: 'detecting',
          splitDetectError: undefined,
        });
        try {
          const current = sheetPreviewsRef.current.find((preview) => preview.id === previewId);
          const expectedShotNos =
            current?.shotNos?.map((shot) => shot.trim()).filter(Boolean) ?? [];
          const layoutGrid =
            current?.layoutCols != null && current?.layoutRows != null
              ? { cols: current.layoutCols, rows: current.layoutRows }
              : undefined;
          const rawBoxes = await detectStoryboardSheetPanels(
            dataUrl,
            expectedShotNos,
            capabilityTextModel,
            {
              timeoutMs: WORKFLOW_CUT_DETECT_TIMEOUT_MS,
              storyboardAssetId: asset.id,
              layoutGrid,
              skipVisionDetect: Boolean(layoutGrid),
            }
          );
          const boxes = rawBoxes.map((box) => clampStoryboardSheetSplitBox(box));
          const collapsed = isCollapsedStoryboardSheetVisionDetect(boxes);
          const detectedShotNos = shotNosFromSheetSplitBoxes(boxes);
          if (!current) return boxes;

          let normalized = dataUrl;
          try {
            normalized = await compressStoryboardFrameDataUrl(dataUrl);
          } catch {
            /* keep raw */
          }
          if (normalized !== dataUrl) {
            patchSheetPreviewInMemory(previewId, { imageDataUrl: normalized });
          }

          setSplitAdjustDraft((prev) =>
            prev?.previewId === previewId && prev.detecting
              ? { ...prev, boxes, detecting: false }
              : prev
          );

          const nextShotNos = current.shotNos.length ? current.shotNos : detectedShotNos;
          const labelStem =
            current.label.split(' · ')[0]?.trim() ||
            (current.source === 'uploaded' ? '上传拼图' : '拼图');
          const patch: Partial<StoryboardSheetPreviewItem> = {
            shotNos: nextShotNos,
            label: nextShotNos.length
              ? buildSheetPreviewLabel(labelStem, nextShotNos)
              : current.label,
            splitDraftBoxes: collapsed ? undefined : boxes,
            splitDetectStatus: boxes.length && !collapsed ? 'ready' : 'failed',
            splitDetectError: collapsed
              ? '只识别到整图，请删除预览重新上传，或在拼图信息中填写列×行（如 5×4）'
              : boxes.length
                ? undefined
                : '未识别到分镜格，切分时可手动框选',
          };
          persistSheetPreviewPatch(previewId, patch);
          return boxes;
        } catch (error) {
          const message = error instanceof Error ? error.message : '识别切分框失败';
          persistSheetPreviewPatch(previewId, {
            splitDetectStatus: 'failed',
            splitDetectError: message,
          });
          setSplitAdjustDraft((prev) =>
            prev?.previewId === previewId && prev.detecting
              ? { ...prev, detecting: false }
              : prev
          );
          throw error;
        } finally {
          sheetSplitDetectJobsRef.current.delete(previewId);
        }
      })();

      sheetSplitDetectJobsRef.current.set(previewId, job);
      return job;
    },
    [
      asset.id,
      capabilityTextModel,
      persistSheetPreviewPatch,
      patchSheetPreviewInMemory,
    ]
  );

  const drainSheetPreviewSplitDetectQueue = useCallback(async () => {
    if (sheetSplitDetectDrainingRef.current) return;
    sheetSplitDetectDrainingRef.current = true;
    try {
      for (;;) {
        const next = sheetSplitDetectQueueRef.current.shift();
        if (!next) break;
        if (sheetSplitDetectJobsRef.current.has(next.previewId)) {
          await sheetSplitDetectJobsRef.current.get(next.previewId)!.catch(() => undefined);
          continue;
        }
        try {
          await runSheetPreviewSplitDetect(next.previewId, next.dataUrl);
        } catch {
          /* failed state persisted in runSheetPreviewSplitDetect */
        }
      }
    } finally {
      sheetSplitDetectDrainingRef.current = false;
      if (sheetSplitDetectQueueRef.current.length) {
        void drainSheetPreviewSplitDetectQueue();
      }
    }
  }, [runSheetPreviewSplitDetect]);

  const enqueueSheetPreviewSplitDetect = useCallback(
    (previewId: string, dataUrl: string) => {
      const alreadyQueued = sheetSplitDetectQueueRef.current.some(
        (item) => item.previewId === previewId
      );
      if (alreadyQueued || sheetSplitDetectJobsRef.current.has(previewId)) return;
      sheetSplitDetectQueueRef.current.push({ previewId, dataUrl });
      void drainSheetPreviewSplitDetectQueue();
    },
    [drainSheetPreviewSplitDetectQueue]
  );

  const scheduleSheetPreviewSplitDetect = useCallback(
    (previewId: string, dataUrl: string) => {
      const item = sheetPreviewsRef.current.find((preview) => preview.id === previewId);
      if (item && hasStoryboardSheetPreviewSplitCache(item)) return;
      if (!item || item.splitDetectStatus !== 'detecting') {
        persistSheetPreviewPatch(previewId, {
          splitDetectStatus: 'detecting',
          splitDetectError: undefined,
          ...(item && !hasStoryboardSheetPreviewSplitCache(item)
            ? { splitDraftBoxes: undefined }
            : {}),
        });
      }
      enqueueSheetPreviewSplitDetect(previewId, dataUrl);
    },
    [enqueueSheetPreviewSplitDetect, persistSheetPreviewPatch]
  );

  /** 刷新/中断后 metadata 仍为 detecting 但内存无任务时，自动续跑识别 */
  const resumePendingSheetPreviewSplitDetects = useCallback(async () => {
    const pending = sheetPreviewsRef.current.filter(isStoryboardSheetSplitDetectPending);
    for (const item of pending) {
      if (
        sheetSplitDetectJobsRef.current.has(item.id) ||
        sheetSplitDetectQueueRef.current.some((q) => q.previewId === item.id)
      ) {
        continue;
      }
      const resolved = await resolveStoryboardSheetPreviewDataUrl(
        item,
        asset.id,
        companionBaseUrl,
        companionProjectId
      );
      if (!resolved.ok) {
        persistSheetPreviewPatch(item.id, {
          splitDetectStatus: 'failed',
          splitDetectError: resolved.error || '拼图图片不可用',
        });
        continue;
      }
      enqueueSheetPreviewSplitDetect(item.id, resolved.dataUrl);
    }
  }, [
    asset.id,
    companionBaseUrl,
    companionProjectId,
    enqueueSheetPreviewSplitDetect,
    persistSheetPreviewPatch,
  ]);

  useEffect(() => {
    if (sheetGenBusy) return;
    void resumePendingSheetPreviewSplitDetects();
  }, [sheetGenBusy, sheetPreviews, resumePendingSheetPreviewSplitDetects]);

  const splitSheetPreviewById = useCallback(
    async (
      previewId: string
    ): Promise<{ matchedCount: number; warn?: string; label: string } | null> => {
      let item = sheetPreviewsRef.current.find((preview) => preview.id === previewId);
      if (!item) return null;

      const resolved = await resolveStoryboardSheetPreviewDataUrl(
        item,
        asset.id,
        companionBaseUrl,
        companionProjectId
      );
      if (!resolved.ok) {
        return { matchedCount: 0, warn: resolved.error, label: item.label };
      }

      let normalized = resolved.dataUrl;
      try {
        normalized = await compressStoryboardFrameDataUrl(resolved.dataUrl);
      } catch {
        /* keep raw */
      }

      item = sheetPreviewsRef.current.find((preview) => preview.id === previewId) ?? item;
      let cachedBoxes = await resolveSheetPreviewSplitDraftBoxes(previewId);
      item = sheetPreviewsRef.current.find((preview) => preview.id === previewId) ?? item;
      if (!isUsableStoryboardSheetSplitDraftBoxes(cachedBoxes)) {
        try {
          cachedBoxes = await runSheetPreviewSplitDetect(previewId, resolved.dataUrl);
        } catch {
          cachedBoxes = [];
        }
        item = sheetPreviewsRef.current.find((preview) => preview.id === previewId) ?? item;
      }
      const shotNosFromBoxes = shotNosFromSheetSplitBoxes(cachedBoxes);
      const effectiveShotNos = item.shotNos.length ? item.shotNos : shotNosFromBoxes;

      let workingRows = table.rows;
      if (effectiveShotNos.length) {
        const ensured = ensureStoryboardRowsForShotNos(workingRows, effectiveShotNos);
        if (ensured.createdIds.length) {
          patchTable(() => reindexStoryboardRows(ensured.nextTableRows), {
            fieldCatalog: table.fieldCatalog,
          });
          workingRows = ensured.nextTableRows;
        }
      }

      let taskRows = resolveSheetTaskRows(workingRows, item.rowIds, effectiveShotNos);
      if (!taskRows.length) {
        if (item.rowIds.length || effectiveShotNos.length) {
          taskRows = workingRows;
        } else {
          taskRows = [];
        }
      }

      const layoutGrid =
        item.layoutCols != null && item.layoutRows != null
          ? { cols: item.layoutCols, rows: item.layoutRows }
          : undefined;

      let adjustedBoxes: BoundingBox[] | null;
      if (hasStoryboardSheetPreviewSplitCache(item)) {
        adjustedBoxes = cachedBoxes;
      } else {
        adjustedBoxes = await promptSheetSplitBoxAdjust(
          {
            previewId,
            imageSrc: normalized,
            boxes: cachedBoxes,
            expectedShotNos: effectiveShotNos,
            sheetLabel: item.label,
          },
          async (_api) => {
            const boxes = await resolveSheetPreviewSplitDraftBoxes(previewId);
            return boxes;
          }
        );
      }

      try {
        if (!adjustedBoxes) {
          return null;
        }

        const splitExpectedShotNos = effectiveShotNos.length
          ? effectiveShotNos
          : shotNosFromSheetSplitBoxes(adjustedBoxes);

        const split = await splitStoryboardSheetFromBoxes(normalized, taskRows, adjustedBoxes, {
          expectedShotNos: splitExpectedShotNos,
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
        const nextRowIds = split.matches.map((match) => match.rowId);
        const nextShotNos = splitExpectedShotNos.length
          ? splitExpectedShotNos
          : shotNosFromSheetSplitBoxes(adjustedBoxes);
        const updateResult = updateStoryboardSheetPreview(
          asset.id,
          previewId,
          {
            matchedCount,
            rowIds: nextRowIds,
            shotNos: nextShotNos,
            splitDraftBoxes: adjustedBoxes.map((box) => clampStoryboardSheetSplitBox(box)),
            splitDetectStatus: 'ready',
            splitDetectError: undefined,
          },
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
      commitSheetPreviews,
      companionBaseUrl,
      companionProjectId,
      patchTable,
      promptSheetSplitBoxAdjust,
      resolveSheetPreviewSplitDraftBoxes,
      runSheetPreviewSplitDetect,
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
    (dataUrl: string) => {
      const draft = createSheetPreviewItem({
        imageDataUrl: dataUrl,
        label: '上传拼图',
        source: 'uploaded',
        genStatus: 'done',
        rowIds: [],
        shotNos: [],
        splitDetectStatus: 'detecting',
      });

      commitSheetPreviews((prev) => {
        const result = prependStoryboardSheetPreview(asset.id, draft, prev);
        void syncSheetPreviewListToCompanion(result.items);
        return result.items;
      });

      onNotify?.('info', '拼图已加入预览，正在后台识别切分框…');
      scheduleSheetPreviewSplitDetect(draft.id, dataUrl);
      void saveSheetPreviewItem({
        id: draft.id,
        imageDataUrl: dataUrl,
        label: draft.label,
        source: 'uploaded',
        genStatus: 'done',
        rowIds: [],
        shotNos: [],
        splitDetectStatus: 'detecting',
      });
    },
    [
      asset.id,
      commitSheetPreviews,
      onNotify,
      scheduleSheetPreviewSplitDetect,
      saveSheetPreviewItem,
      syncSheetPreviewListToCompanion,
    ]
  );

  const removeSheetPreview = useCallback(
    (previewId: string) => {
      if (readOnly) return;
      const item = sheetPreviewsRef.current.find((preview) => preview.id === previewId);
      if (!item) return;
      const canRemove =
        item.source === 'uploaded' ||
        (item.source === 'generated' &&
          item.genStatus !== 'pending' &&
          item.genStatus !== 'generating');
      if (!canRemove) return;

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

  const openInsertShotModal = useCallback(
    (initialShotNo?: string) => {
      if (readOnly) {
        onNotify?.('warn', '只读模式无法添加镜头');
        return;
      }
      setInsertShotInitialNo(initialShotNo?.trim() || null);
      setInsertShotModalOpen(true);
    },
    [onNotify, readOnly]
  );

  const closeInsertShotModal = useCallback(() => {
    setInsertShotModalOpen(false);
    setInsertShotInitialNo(null);
  }, []);

  const handleOutlineInsertShotBefore = useCallback(
    (rowIndex: number) => {
      openInsertShotModal(computeInsertShotNoBeforeRow(table.rows, rowIndex));
    },
    [openInsertShotModal, table.rows]
  );

  const handleOutlineInsertShotAfter = useCallback(
    (rowIndex: number) => {
      openInsertShotModal(computeInsertShotNoAfterRow(table.rows, rowIndex));
    },
    [openInsertShotModal, table.rows]
  );

  const confirmInsertShot = useCallback(
    (payload: { newRows: StoryboardTableRow[]; nextRows: StoryboardTableRow[] }) => {
      const first = payload.newRows[0];
      const last = payload.newRows[payload.newRows.length - 1];
      const shotLabel =
        payload.newRows.length === 1
          ? first?.shotNo?.trim() || '新镜头'
          : `${first?.shotNo ?? ''}–${last?.shotNo ?? ''}`;
      patchTable(() => payload.nextRows);
      closeInsertShotModal();
      if (first) navigateToRow(first.id);
      onNotify?.(
        'info',
        payload.newRows.length === 1 ? `已插入镜头 ${shotLabel}` : `已插入 ${payload.newRows.length} 镜（${shotLabel}）`
      );
    },
    [closeInsertShotModal, navigateToRow, onNotify, patchTable]
  );

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
      patchTable((rows) => applySequentialShotNumbers(rows.filter((row) => !ids.includes(row.id))));
      if (activeRowId && ids.includes(activeRowId)) setActiveRowId(null);
      return true;
    },
    [activeRowId, onNotify, patchTable, table.rows]
  );

  const removeRow = (rowId: string) => {
    removeRows([rowId]);
  };

  const moveRow = (rowId: string, dir: -1 | 1) => {
    patchTable((rows) => {
      const i = rows.findIndex((r) => r.id === rowId);
      if (i < 0) return rows;
      const j = i + dir;
      if (j < 0 || j >= rows.length) return rows;
      const next = reorderStoryboardRows(rows, i, j);
      return applySequentialShotNumbers(next);
    });
  };

  const reorderOutlineRows = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (readOnly) return;
      patchTable((rows) => {
        const reordered = reorderStoryboardRows(rows, fromIndex, toIndex);
        return applySequentialShotNumbers(reordered);
      });
    },
    [patchTable, readOnly]
  );

  const openFileForRow = (rowId: string) => {
    const row = table.rows.find((r) => r.id === rowId);
    if (row && storyboardRowIsPassed(row)) {
      onNotify?.('warn', '该镜头已通过，请先取消通过');
      return;
    }
    pendingRowIdRef.current = rowId;
    fileInputRef.current?.click();
  };

  const applyCroppedFrameToRow = useCallback(
    async (rowId: string, dataUrl: string) => {
      const row = table.rows.find((r) => r.id === rowId);
      if (!row) return;
      if (storyboardRowIsPassed(row)) {
        onNotify?.('warn', '该镜头已通过，请先取消通过');
        return;
      }
      setImageBusyRowId(rowId);
      try {
        const patch = await replaceStoryboardRowFrame({
          row,
          dataUrl,
          assetId: asset.id,
          companionBaseUrl,
          companionProjectId,
          source: 'upload',
        });
        patchRow(rowId, patch);
      } finally {
        setImageBusyRowId(null);
      }
    },
    [asset.id, companionBaseUrl, companionProjectId, onNotify, patchRow, table.rows]
  );

  const openFrameCropQueue = useCallback(
    (
      queue: Array<{ rowId: string; imageSrc: string; shotNo?: string }>,
      options?: { unusedFiles?: number }
    ) => {
      if (!queue.length) return;
      const [current, ...rest] = queue;
      setFrameCropDraft({ current: current!, rest, applying: false, mode: 'import' });
      if (options?.unusedFiles && options.unusedFiles > 0) {
        onNotify?.('info', `${options.unusedFiles} 张图片超出可配图镜头数，已忽略`);
      }
    },
    [onNotify]
  );

  const beginFrameCropFromDataUrl = useCallback(
    (rowId: string, dataUrl: string) => {
      if (readOnly) return;
      const row = table.rows.find((r) => r.id === rowId);
      if (row && storyboardRowIsPassed(row)) {
        onNotify?.('warn', '该镜头已通过，请先取消通过');
        return;
      }
      openFrameCropQueue([
        { rowId, imageSrc: dataUrl, shotNo: row?.shotNo?.trim() || undefined },
      ]);
    },
    [onNotify, openFrameCropQueue, readOnly, table.rows]
  );

  const beginFrameCropFromFiles = useCallback(
    async (startRowId: string, files: File[]) => {
      if (readOnly) return;
      const imageFiles = collectStoryboardFrameImageFiles(files);
      if (!imageFiles.length) return;

      const { assignments, skippedLocked, unusedFiles } = planStoryboardFrameImportAssignments(
        table.rows,
        startRowId,
        imageFiles.length
      );
      if (!assignments.length) {
        onNotify?.(
          'warn',
          skippedLocked > 0 ? '可配图的镜头均已通过，请先取消通过' : '没有可配图的镜头'
        );
        return;
      }

      const queue: Array<{ rowId: string; imageSrc: string; shotNo?: string }> = [];
      for (const { rowId, fileIndex } of assignments) {
        try {
          const dataUrl = await readStoryboardFrameFromFile(imageFiles[fileIndex]!);
          const row = table.rows.find((r) => r.id === rowId);
          queue.push({ rowId, imageSrc: dataUrl, shotNo: row?.shotNo?.trim() || undefined });
        } catch (err) {
          onNotify?.('warn', err instanceof Error ? err.message : '图片读取失败');
        }
      }
      if (!queue.length) return;
      openFrameCropQueue(queue, { unusedFiles });
    },
    [onNotify, openFrameCropQueue, readOnly, table.rows]
  );

  const beginFrameCropForDropTarget = useCallback(
    async (targetRowId: string, file: File) => {
      if (readOnly) return;
      const { assignment, skippedLocked } = planStoryboardFrameImportAssignmentForTargetRow(
        table.rows,
        targetRowId
      );
      if (!assignment) {
        onNotify?.(
          'warn',
          skippedLocked ? '该镜头已通过，请先取消通过' : '目标镜头不存在'
        );
        return;
      }
      try {
        const dataUrl = await readStoryboardFrameFromFile(file);
        const row = table.rows.find((entry) => entry.id === targetRowId);
        openFrameCropQueue([
          {
            rowId: targetRowId,
            imageSrc: dataUrl,
            shotNo: row?.shotNo?.trim() || undefined,
          },
        ]);
      } catch (err) {
        onNotify?.('warn', err instanceof Error ? err.message : '图片读取失败');
      }
    },
    [onNotify, openFrameCropQueue, readOnly, table.rows]
  );

  const beginFrameSheetSplitFromDrop = useCallback(
    async (selectedRowIds: string[], file: File) => {
      if (readOnly) return;
      if (
        frameCropDraft ||
        splitAdjustDraft ||
        isStoryboardCollageBatchSessionBusy(asset.id)
      ) {
        onNotify?.('warn', '请等待当前任务完成');
        return;
      }

      const taskRows = resolveStoryboardFrameDropSplitTaskRows(table.rows, selectedRowIds);
      if (!taskRows.length) {
        onNotify?.('warn', '所选镜头均已通过，请先取消通过');
        return;
      }

      const skippedLocked = selectedRowIds.length - taskRows.length;
      if (skippedLocked > 0) {
        onNotify?.('info', `已跳过 ${skippedLocked} 个已通过镜头，切分 ${taskRows.length} 镜`);
      }

      let sheetImage = await readStoryboardFrameFromFile(file);
      try {
        sheetImage = await compressStoryboardFrameDataUrl(sheetImage);
      } catch {
        /* keep raw */
      }

      const previewId = `drop-split-${Date.now()}`;
      let dropSplitContext: {
        assignRows: StoryboardTableRow[];
        layoutGrid: StoryboardSheetLayoutGrid;
        expectedShotNos: string[];
      } | null = null;
      try {
        const adjusted = await promptSheetSplitBoxAdjust(
          {
            previewId,
            imageSrc: sheetImage,
            boxes: [],
            expectedShotNos: [],
            sheetLabel: `拖入配图 · 选 ${taskRows.length} 镜 · 识别中…`,
          },
          async (api) => {
            const imageEstimate = await estimateStoryboardSheetPanelCountFromImage(sheetImage, {
              hintCount: taskRows.length,
              textModel: capabilityTextModel,
              timeoutMs: WORKFLOW_CUT_DETECT_TIMEOUT_MS,
              onDetectStatus: api.setStatus,
            });
            const splitPlan = planStoryboardFrameDropSplitScope(
              taskRows,
              imageEstimate.panelCount,
              imageEstimate.layoutGrid
            );
            if (splitPlan.mismatchMessage) {
              onNotify?.('info', splitPlan.mismatchMessage);
            }
            const { assignRows, panelCount, layoutGrid, expectedShotNos } = splitPlan;
            dropSplitContext = { assignRows, layoutGrid, expectedShotNos };
            const contentBounds = imageEstimate.contentBounds;
            api.patchDraft({
              expectedShotNos,
              sheetLabel: `拖入配图 · 图 ${panelCount} 格 / 选 ${splitPlan.selectionCount} 镜`,
            });
            try {
              const rawBoxes = await detectStoryboardSheetPanels(
                sheetImage,
                expectedShotNos,
                capabilityTextModel,
                {
                  timeoutMs: WORKFLOW_CUT_DETECT_TIMEOUT_MS,
                  storyboardAssetId: asset.id,
                  layoutGrid,
                  panelCount,
                  contentBounds,
                  structureAnalysis: imageEstimate.structureAnalysis,
                  onDetectStatus: api.setStatus,
                }
              );
              return normalizeStoryboardFrameDropSplitBoxes(rawBoxes, panelCount, assignRows);
            } catch (error) {
              onNotify?.(
                'warn',
                error instanceof Error ? error.message : '识别切分框失败，已生成默认网格，可手动调整'
              );
              return refineStoryboardSheetDetectBoxesToIllustration(
                sheetImage,
                buildStoryboardFrameDropSplitFallbackBoxes(panelCount, assignRows)
              );
            }
          }
        );
        if (!adjusted || !dropSplitContext) return;

        const { assignRows, layoutGrid, expectedShotNos } = dropSplitContext;
        try {
          const split = await splitStoryboardSheetFromBoxes(
            sheetImage,
            assignRows,
            adjusted,
            {
              expectedShotNos,
              autoCreateRows: false,
              allowGridFallback: false,
              layoutGrid,
              trimSplitCrops: false,
              sequentialLayoutMatch: true,
            }
          );
          const { matchedCount, warn } = await applySheetVisionSplitResult(
            split,
            assignRows,
            table.fieldCatalog,
            table.rows
          );
          if (warn) {
            onNotify?.('warn', warn);
          } else if (matchedCount > 0) {
            onNotify?.('info', `已切分回填 ${matchedCount} 镜`);
          } else {
            onNotify?.('warn', '未能切分回填，请检查切分框与镜号');
          }
        } catch (splitError) {
          onNotify?.(
            'warn',
            splitError instanceof Error ? splitError.message : '切分回填失败'
          );
        } finally {
          setSplitAdjustDraft(null);
        }
      } catch (err) {
        onNotify?.('warn', err instanceof Error ? err.message : '图片读取失败');
        setSplitAdjustDraft(null);
      }
    },
    [
      applySheetVisionSplitResult,
      asset.id,
      capabilityTextModel,
      frameCropDraft,
      onNotify,
      promptSheetSplitBoxAdjust,
      readOnly,
      splitAdjustDraft,
      table.fieldCatalog,
      table.rows,
    ]
  );

  const onFilePicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = collectStoryboardFrameImageFiles(e.target.files);
      e.target.value = '';
      const rowId = pendingRowIdRef.current;
      pendingRowIdRef.current = null;
      if (!files.length || !rowId) return;
      await beginFrameCropFromFiles(rowId, files);
    },
    [beginFrameCropFromFiles]
  );

  const closeFrameCrop = useCallback(() => {
    setFrameCropDraft(null);
  }, []);

  const confirmFrameCrop = useCallback(
    async (cropNorm: StoryboardFrameCropNorm) => {
      const draft = frameCropDraft;
      if (!draft || draft.applying) return;
      if (draft.mode === 'recrop' && isNearlyFullCropNorm(cropNorm)) {
        setFrameCropDraft(null);
        return;
      }
      setFrameCropDraft({ ...draft, applying: true });
      try {
        const cropped = await cropDataUrlByViewportNorm(draft.current.imageSrc, cropNorm);
        if (!cropped) {
          onNotify?.('warn', '裁切失败');
          setFrameCropDraft((prev) => (prev ? { ...prev, applying: false } : null));
          return;
        }
        const compressed = await compressStoryboardFrameDataUrl(cropped);
        await applyCroppedFrameToRow(draft.current.rowId, compressed);
        if (draft.rest.length) {
          const [next, ...remaining] = draft.rest;
          setFrameCropDraft({
            current: next!,
            rest: remaining,
            applying: false,
            mode: draft.mode,
            initialCropNorm: draft.mode === 'recrop' ? draft.initialCropNorm : undefined,
          });
        } else {
          setFrameCropDraft(null);
          onNotify?.('info', draft.mode === 'recrop' ? '已更新裁切' : '已配图');
        }
      } catch (err) {
        onNotify?.('warn', err instanceof Error ? err.message : '裁切失败');
        setFrameCropDraft((prev) => (prev ? { ...prev, applying: false } : null));
      }
    },
    [applyCroppedFrameToRow, frameCropDraft, onNotify]
  );

  const useFullFrameCropImage = useCallback(async () => {
    const draft = frameCropDraft;
    if (!draft || draft.applying) return;
    if (draft.mode === 'recrop') {
      setFrameCropDraft(null);
      return;
    }
    setFrameCropDraft({ ...draft, applying: true });
    try {
      await applyCroppedFrameToRow(draft.current.rowId, draft.current.imageSrc);
      if (draft.rest.length) {
        const [next, ...remaining] = draft.rest;
        setFrameCropDraft({
          current: next!,
          rest: remaining,
          applying: false,
          mode: draft.mode,
          initialCropNorm: undefined,
        });
      } else {
        setFrameCropDraft(null);
        onNotify?.('info', '已配图');
      }
    } catch (err) {
      onNotify?.('warn', err instanceof Error ? err.message : '配图失败');
      setFrameCropDraft((prev) => (prev ? { ...prev, applying: false } : null));
    }
  }, [applyCroppedFrameToRow, frameCropDraft, onNotify]);

  const assignFrameImageFromPaste = useCallback(
    async (rowId: string, e: React.ClipboardEvent) => {
      const files = collectStoryboardFrameImageFiles(e.clipboardData);
      if (files.length) {
        e.preventDefault();
        await beginFrameCropFromFiles(rowId, files);
        return;
      }
      const file = e.clipboardData.files?.[0];
      if (file) {
        e.preventDefault();
        await beginFrameCropFromFiles(rowId, [file]);
        return;
      }
      try {
        const dataUrl = await readStoryboardFrameFromClipboard(e.clipboardData ?? null);
        if (!dataUrl) return;
        e.preventDefault();
        beginFrameCropFromDataUrl(rowId, dataUrl);
      } catch (err) {
        onNotify?.('warn', err instanceof Error ? err.message : '图片处理失败');
      }
    },
    [beginFrameCropFromDataUrl, beginFrameCropFromFiles, onNotify]
  );

  const clearRowImage = useCallback(
    async (rowId: string) => {
      const row = table.rows.find((r) => r.id === rowId);
      if (!row) return;
      if (storyboardRowIsPassed(row)) {
        onNotify?.('warn', '该镜头已通过，请先取消通过');
        return;
      }
      const prevImg = String(row.frameImage || '').trim();
      if (/^blob:/i.test(prevImg)) {
        try {
          URL.revokeObjectURL(prevImg);
        } catch {
          /* ignore */
        }
      }
      patchRow(rowId, {
        frameImage: undefined,
        frameImageObjectKey: undefined,
        frameImageCompanionKey: undefined,
      });
      try {
        const patch = await clearStoryboardRowFrameWithHistory(row, {
          assetId: asset.id,
          companionBaseUrl,
          companionProjectId,
        });
        patchRow(rowId, { frameImageHistory: patch.frameImageHistory });
      } catch (err) {
        onNotify?.('warn', err instanceof Error ? err.message : '清除分镜图失败');
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

  const runRedraw = useCallback(
    async (rowId: string) => {
      const row = table.rows.find((r) => r.id === rowId);
      if (!row) return;
      if (row.locked) {
        onNotify?.('warn', '该镜头已通过');
        return;
      }
      const useCollage = storyboardRowHasFrameRef(row);
      if (useCollage) {
        if (!(row.editFeedback ?? '').trim()) {
          onNotify?.('warn', '拼图改图请先填写修改反馈');
          return;
        }
        if (!activeFeedbackCollagePreset) {
          onNotify?.('warn', '请先在编辑页选择拼图改图能力（图生图）');
          return;
        }
        if (!effectiveFeedbackCollageModelId) {
          onNotify?.('warn', '请先在编辑页选择拼图改图模型');
          return;
        }
      } else if (!buildStoryboardRowPromptText(row, table.fieldCatalog)) {
        onNotify?.('warn', '请先解析、填写画面类字段或修改反馈');
        return;
      } else if (!onRedrawRow || !effectiveEditRedrawModelId) {
        onNotify?.('warn', '请先在编辑页选择重绘模型');
        return;
      }
      if (!onRedrawRow) {
        onNotify?.('warn', '无法重绘');
        return;
      }
      setRedrawBusyRowId(rowId);
      if (useCollage) {
        syncCollageBatchSession({
          busy: true,
          kind: 'feedback',
          rowIds: [rowId],
          queuedRowIds: [],
          progress: null,
        });
      }
      try {
        await onRedrawRow(
          rowId,
          useCollage ? effectiveFeedbackCollageModelId : effectiveEditRedrawModelId,
          useCollage
            ? {
                collagePresetId: effectiveFeedbackCollagePresetId,
                feedbackOnly: true,
              }
            : undefined
        );
      } catch (e) {
        onNotify?.('warn', e instanceof Error ? e.message : '重绘失败');
      } finally {
        setRedrawBusyRowId(null);
        if (useCollage) {
          clearStoryboardCollageBatchSession(asset.id);
        }
      }
    },
    [
      activeFeedbackCollagePreset,
      asset.id,
      effectiveEditRedrawModelId,
      effectiveFeedbackCollageModelId,
      effectiveFeedbackCollagePresetId,
      onNotify,
      onRedrawRow,
      syncCollageBatchSession,
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
    syncCollageBatchSession({
      busy: true,
      kind: 'feedback',
      rowIds: tasks[0]?.rowIds ?? eligible.map((row) => row.id),
      queuedRowIds: queuedStoryboardCollageRowIdsFromTasks(tasks, 0),
      progress: { done: 0, total: tasks.length },
    });

    let okTasks = 0;
    let failTasks = 0;
    let totalMatched = 0;
    let batchRowImages: Record<string, string> = {};
    const feedbackClearedRowIds = new Set<string>();

    try {
      for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
        const task = tasks[taskIndex]!;
        syncCollageBatchSession({
          kind: 'feedback',
          rowIds: task.rowIds,
          queuedRowIds: queuedStoryboardCollageRowIdsFromTasks(tasks, taskIndex),
          progress: { done: okTasks + failTasks, total: tasks.length },
        });
        try {
          const outcome = await executeStoryboardFeedbackSheetRedraw({
            preset,
            rows: task.rows,
            fieldCatalog: table.fieldCatalog,
            ctx: parseCtx,
            imageModelRegistryId: effectiveFeedbackCollageModelId,
            understand: feedbackRedrawUnderstand,
            chunkIndex: task.chunkIndex,
            companionBaseUrl,
            companionProjectId,
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

          const previewId = `collage-feedback-${task.chunkIndex}`;
          const adjusted = await promptFeedbackCollageSplitAdjust({
            previewId,
            sheetImage,
            layout: outcome.layout,
            rowIds: task.rowIds,
            sheetLabel: `拼图改图 ${task.chunkIndex + 1}`,
          });
          if (!adjusted) {
            failTasks += 1;
            onNotify?.('warn', `拼图 ${task.chunkIndex + 1}：已取消裁切确认`);
            continue;
          }

          setFrameCollageSplitCtx({
            previewId,
            sheetImage,
            layout: outcome.layout,
            boxes: adjusted,
            rowIds: task.rowIds,
            sheetLabel: `拼图改图 ${task.chunkIndex + 1}`,
          });

          try {
            const { matchedCount, warn, rowImages } = await commitSheetVisionSplit(
              sheetImage,
              task.rows,
              table.fieldCatalog,
              outcome.layout,
              { adjustedBoxes: adjusted }
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
          } catch (splitError) {
            failTasks += 1;
            onNotify?.(
              'warn',
              splitError instanceof Error
                ? splitError.message
                : `拼图 ${task.chunkIndex + 1} 切分回填失败`
            );
          } finally {
            setSplitAdjustDraft(null);
          }
        } catch (error) {
          failTasks += 1;
          onNotify?.(
            'warn',
            error instanceof Error ? error.message : `拼图 ${task.chunkIndex + 1} 失败`
          );
          setSplitAdjustDraft(null);
        } finally {
          syncCollageBatchSession({
            progress: { done: okTasks + failTasks, total: tasks.length },
          });
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
      clearStoryboardCollageBatchSession(asset.id);
    }
  }, [
    activeFeedbackCollagePreset,
    asset.id,
    clearEditFeedbackForRows,
    commitSheetVisionSplit,
    commitFeedbackRedrawHistory,
    companionBaseUrl,
    companionProjectId,
    effectiveFeedbackCollageModelId,
    feedbackCollageLimit,
    feedbackRedrawUnderstand,
    onNotify,
    onSelectFeedbackHistory,
    parseCtx,
    promptFeedbackCollageSplitAdjust,
    table.fieldCatalog,
    table.rows,
    syncCollageBatchSession,
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
      onNotify?.('warn', '没有可执行的角色替换任务');
      return;
    }
    const understandLabel = feedbackRedrawUnderstand ? '理解后生图' : '直发拼图提示';
    if (
      !window.confirm(
        `按角色标注拼图替换 ${eligible.length} 镜？（每批最多 ${feedbackCollageLimit} 镜 · ${tasks.length} 张拼图 · 参考图 1=拼图 2+=角色资产 · ${understandLabel}）`
      )
    ) {
      return;
    }

    syncCollageBatchSession({
      busy: true,
      kind: 'roleReplace',
      rowIds: tasks[0]?.rowIds ?? eligible.map((row) => row.id),
      queuedRowIds: queuedStoryboardCollageRowIdsFromTasks(tasks, 0),
      progress: { done: 0, total: tasks.length },
    });

    let okTasks = 0;
    let failTasks = 0;
    let totalMatched = 0;

    try {
      for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
        const task = tasks[taskIndex]!;
        syncCollageBatchSession({
          kind: 'roleReplace',
          rowIds: task.rowIds,
          queuedRowIds: queuedStoryboardCollageRowIdsFromTasks(tasks, taskIndex),
          progress: { done: okTasks + failTasks, total: tasks.length },
        });
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
            companionBaseUrl,
            companionProjectId,
          });
          if (!outcome.ok) {
            failTasks += 1;
            onNotify?.('warn', `拼图替换 ${task.chunkIndex + 1} 失败：${outcome.error}`);
            continue;
          }

          let sheetImage = outcome.image;
          try {
            sheetImage = await compressStoryboardFrameDataUrl(sheetImage);
          } catch {
            /* keep raw */
          }

          const previewId = `collage-role-replace-${task.chunkIndex}`;
          const adjusted = await promptFeedbackCollageSplitAdjust({
            previewId,
            sheetImage,
            layout: outcome.layout,
            rowIds: task.rowIds,
            sheetLabel: `拼图替换 ${task.chunkIndex + 1}`,
          });
          if (!adjusted) {
            failTasks += 1;
            onNotify?.('warn', `拼图替换 ${task.chunkIndex + 1}：已取消裁切确认`);
            continue;
          }

          setFrameCollageSplitCtx({
            previewId,
            sheetImage,
            layout: outcome.layout,
            boxes: adjusted,
            rowIds: task.rowIds,
            sheetLabel: `拼图替换 ${task.chunkIndex + 1}`,
          });

          try {
            const { matchedCount, warn } = await commitSheetVisionSplit(
              sheetImage,
              task.rows,
              table.fieldCatalog,
              outcome.layout,
              { adjustedBoxes: adjusted }
            );
            totalMatched += matchedCount;
            okTasks += 1;
            if (warn) {
              onNotify?.('warn', `拼图替换 ${task.chunkIndex + 1}：${warn}`);
            }
          } catch (splitError) {
            failTasks += 1;
            onNotify?.(
              'warn',
              splitError instanceof Error
                ? splitError.message
                : `拼图替换 ${task.chunkIndex + 1} 切分回填失败`
            );
          } finally {
            setSplitAdjustDraft(null);
          }
        } catch (error) {
          failTasks += 1;
          onNotify?.(
            'warn',
            error instanceof Error ? error.message : `拼图替换 ${task.chunkIndex + 1} 失败`
          );
          setSplitAdjustDraft(null);
        } finally {
          syncCollageBatchSession({
            progress: { done: okTasks + failTasks, total: tasks.length },
          });
        }
      }

      if (failTasks > 0) {
        onNotify?.(
          'warn',
          `拼图替换完成：成功 ${okTasks} 张，失败 ${failTasks} 张；已切分回填 ${totalMatched} 镜`
        );
      } else if (totalMatched > 0) {
        onNotify?.('info', `拼图替换完成：${okTasks} 张拼图，已切分回填 ${totalMatched} 镜`);
      } else {
        onNotify?.('warn', `拼图替换 ${okTasks} 张完成，但未能自动切分回填，请检查镜号`);
      }
    } finally {
      clearStoryboardCollageBatchSession(asset.id);
    }
  }, [
    activeFeedbackCollagePreset,
    asset.id,
    commitSheetVisionSplit,
    companionBaseUrl,
    companionProjectId,
    effectiveFeedbackCollageModelId,
    feedbackCollageLimit,
    feedbackRedrawUnderstand,
    onNotify,
    parseCtx,
    promptFeedbackCollageSplitAdjust,
    readOnly,
    syncCollageBatchSession,
    table.fieldCatalog,
    table.roleAssets,
    table.rows,
  ]);

  const runSelectedSheetGen = useCallback(
    async (selectedRowIds: string[]) => {
      if (readOnly) return;
      if (selectedSheetGenBatchBusy || sheetGenBusy || isStoryboardCollageBatchSessionBusy(asset.id)) {
        onNotify?.('warn', '已有分镜生图任务进行中，请稍候');
        return;
      }

      const probe = await probeStoryboardSheetGenCompanionReady(
        companionBaseUrl,
        companionProjectId
      );
      if (!probe.ok) {
        onNotify?.('warn', storyboardSheetGenCompanionProbeMessage(probe.reason));
        return;
      }

      const preset = redrawPresets.find((entry) => entry.id === effectiveRedrawPresetId);
      if (!preset) {
        onNotify?.(
          'warn',
          redrawPresets.length ? '请先在编辑页选择生图能力' : '请先在功能区启用文生图/图生图能力'
        );
        return;
      }

      const idSet = new Set(selectedRowIds);
      const eligible = table.rows.filter(
        (row) =>
          idSet.has(row.id) &&
          !row.locked &&
          rowHasSheetGenPrompt(row, table.fieldCatalog)
      );
      if (!eligible.length) {
        onNotify?.('warn', '所选镜头中没有可生图的（需有镜头原文/画面描述且未锁定）');
        return;
      }

      const tasks = planStoryboardSheetGenTasks(eligible, feedbackCollageLimit);
      if (!tasks.length) {
        onNotify?.('warn', '没有可执行的分镜生图任务');
        return;
      }

      if (
        !window.confirm(
          `为所选 ${eligible.length} 镜生成分镜拼图？（每批最多 ${feedbackCollageLimit} 镜 · ${tasks.length} 张拼图）`
        )
      ) {
        return;
      }

      syncCollageBatchSession({
        busy: true,
        kind: 'sheetGen',
        rowIds: tasks[0]?.rowIds ?? eligible.map((row) => row.id),
        queuedRowIds: queuedStoryboardCollageRowIdsFromTasks(tasks, 0),
        progress: { done: 0, total: tasks.length },
      });

      let okTasks = 0;
      let failTasks = 0;
      let totalMatched = 0;

      try {
        for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
          const task = tasks[taskIndex]!;
          syncCollageBatchSession({
            kind: 'sheetGen',
            rowIds: task.rowIds,
            queuedRowIds: queuedStoryboardCollageRowIdsFromTasks(tasks, taskIndex),
            progress: { done: okTasks + failTasks, total: tasks.length },
          });
          try {
            const outcome = await executeStoryboardSheetGen({
              preset,
              rows: task.rows,
              fieldCatalog: table.fieldCatalog,
              ctx: parseCtx,
              forceTextToImage: preset.category === 'image_to_image',
              chunkIndex: task.chunkIndex,
            });
            if (!outcome.ok) {
              failTasks += 1;
              onNotify?.('warn', `分镜生图 ${task.chunkIndex + 1} 失败：${outcome.error}`);
              continue;
            }

            let sheetImage = outcome.image;
            try {
              sheetImage = await compressStoryboardFrameDataUrl(sheetImage);
            } catch {
              /* keep raw */
            }

            const previewId = `edit-sheet-gen-${task.chunkIndex}-${Date.now()}`;
            const layoutGrid = resolveStoryboardSheetGridDimensions(task.rows.length);
            const expectedShotNos = task.rows
              .map((row) => row.shotNo?.trim())
              .filter((shotNo): shotNo is string => Boolean(shotNo));

            let boxes: BoundingBox[] = [];
            try {
              const rawBoxes = await detectStoryboardSheetPanels(
                sheetImage,
                expectedShotNos,
                capabilityTextModel,
                {
                  timeoutMs: WORKFLOW_CUT_DETECT_TIMEOUT_MS,
                  storyboardAssetId: asset.id,
                  layoutGrid,
                  skipVisionDetect: true,
                }
              );
              boxes = rawBoxes.map((box) => clampStoryboardSheetSplitBox(box));
              if (isCollapsedStoryboardSheetVisionDetect(boxes)) {
                boxes = [];
              }
            } catch (error) {
              onNotify?.(
                'warn',
                error instanceof Error ? error.message : '识别切分框失败，可手动框选后确认'
              );
            }

            const adjusted = await promptSheetSplitBoxAdjust(
              {
                previewId,
                imageSrc: sheetImage,
                boxes,
                expectedShotNos,
                sheetLabel: `分镜生图 ${task.chunkIndex + 1}`,
              },
              async (_api) => boxes
            );
            if (!adjusted) {
              failTasks += 1;
              onNotify?.('warn', `分镜生图 ${task.chunkIndex + 1}：已取消裁切确认`);
              continue;
            }

            try {
              const split = await splitStoryboardSheetFromBoxes(
                sheetImage,
                task.rows,
                adjusted,
                {
                  expectedShotNos,
                  autoCreateRows: false,
                  allowGridFallback: false,
                  layoutGrid,
                  trimSplitCrops: false,
                }
              );
              const { matchedCount, warn } = await applySheetVisionSplitResult(
                split,
                task.rows,
                table.fieldCatalog,
                table.rows
              );
              totalMatched += matchedCount;
              okTasks += 1;
              if (warn) {
                onNotify?.('warn', `分镜生图 ${task.chunkIndex + 1}：${warn}`);
              }
            } catch (splitError) {
              failTasks += 1;
              onNotify?.(
                'warn',
                splitError instanceof Error
                  ? splitError.message
                  : `分镜生图 ${task.chunkIndex + 1} 切分回填失败`
              );
            } finally {
              setSplitAdjustDraft(null);
            }
          } catch (error) {
            failTasks += 1;
            onNotify?.(
              'warn',
              error instanceof Error ? error.message : `分镜生图 ${task.chunkIndex + 1} 失败`
            );
            setSplitAdjustDraft(null);
          } finally {
            syncCollageBatchSession({
              progress: { done: okTasks + failTasks, total: tasks.length },
            });
          }
        }

        if (failTasks > 0) {
          onNotify?.(
            'warn',
            `分镜生图完成：成功 ${okTasks} 张，失败 ${failTasks} 张；已切分回填 ${totalMatched} 镜`
          );
        } else if (totalMatched > 0) {
          onNotify?.('info', `分镜生图完成：${okTasks} 张拼图，已切分回填 ${totalMatched} 镜`);
        } else {
          onNotify?.('warn', `分镜生图 ${okTasks} 张完成，但未能自动切分回填，请检查镜号`);
        }
      } finally {
        clearStoryboardCollageBatchSession(asset.id);
      }
    },
    [
      applySheetVisionSplitResult,
      asset.id,
      capabilityTextModel,
      companionBaseUrl,
      companionProjectId,
      effectiveRedrawPresetId,
      feedbackCollageLimit,
      onNotify,
      parseCtx,
      promptSheetSplitBoxAdjust,
      readOnly,
      redrawPresets,
      selectedSheetGenBatchBusy,
      sheetGenBusy,
      syncCollageBatchSession,
      table.fieldCatalog,
      table.rows,
    ]
  );

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
              splitDetectStatus: 'detecting',
            });
            scheduleSheetPreviewSplitDetect(previewId, sheetImage);
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
      scheduleSheetPreviewSplitDetect,
      saveSheetPreviewItem,
      table.rows,
    ]
  );

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
      if (storyboardRowHasFrameRef(row)) {
        if (!(row.editFeedback ?? '').trim()) return '拼图改图需先填写修改反馈';
        return undefined;
      }
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
      focusRow: setActiveRowId,
      patchRow,
      commitRowShotNo,
      moveRow,
      removeRow,
      openFileForRow,
      clearRowImage: (rowId) => {
        void clearRowImage(rowId);
      },
      restoreFrameVersion: (rowId, versionId) => {
        void restoreFrameVersion(rowId, versionId);
      },
      assignFrameImageFromDrop: (rowId, e, selectedRowIds) => {
        e.preventDefault();
        e.stopPropagation();
        void (async () => {
          const file = await collectStoryboardFrameImageInputForDrop(e.dataTransfer);
          if (!file) return;
          if (shouldStoryboardFrameDropUseSheetSplit(rowId, selectedRowIds)) {
            void beginFrameSheetSplitFromDrop(selectedRowIds!, file);
            return;
          }
          void beginFrameCropForDropTarget(rowId, file);
        })();
      },
      assignFrameImageFromPaste: (rowId, e) => {
        void assignFrameImageFromPaste(rowId, e);
      },
      runRedraw,
      previewRowFrame,
      redrawDisabledReason: redrawRowDisabledReason,
    };
  }, [
    assignFrameImageFromPaste,
    beginFrameCropForDropTarget,
    beginFrameSheetSplitFromDrop,
    beginFrameCropFromFiles,
    clearRowImage,
    restoreFrameVersion,
    moveRow,
    onRedrawRow,
    openFileForRow,
    patchRow,
    commitRowShotNo,
    readOnly,
    redrawRowDisabledReason,
    removeRow,
    runRedraw,
    previewRowFrame,
    table.fieldCatalog,
    table.rows.length,
    timelineLayerCount,
  ]);

  const activeRow = useMemo(
    () => (activeRowId ? table.rows.find((r) => r.id === activeRowId) : undefined),
    [activeRowId, table.rows]
  );

  const panel = (
    <div
      className="fixed inset-0 z-[2160] flex flex-col bg-[#040508]/90 backdrop-blur-xl"
      role="dialog"
      aria-modal
      aria-label={readOnly ? '分镜表（只读）' : '分镜表'}
      data-ac-block-workflow-marquee
      data-no-global-image-drop
    >
      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFilePicked} />

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
              输入
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

          <div className="ml-auto flex shrink-0 items-center gap-2">
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
            <button type="button" onClick={() => openInsertShotModal()} className={STORYBOARD_TOOL_BTN_PRIMARY}>
              添加镜头
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
            {redrawPresetOptions.length > 0 ? (
              <div className="flex min-w-[10rem] max-w-xs items-center gap-1.5">
                <span className="shrink-0 text-[10px] text-gray-500">生图能力</span>
                <CustomDropdown
                  value={effectiveRedrawPresetId}
                  options={redrawPresetOptions}
                  onChange={setRedrawPresetIdPersisted}
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
            <button type="button" onClick={() => openInsertShotModal()} className={STORYBOARD_TOOL_BTN_PRIMARY}>
              添加镜头
            </button>
            <button
              type="button"
              onClick={() => patchTable((rows) => applyAutoShotNumbers(rows))}
              className={STORYBOARD_TOOL_BTN_NEUTRAL}
            >
              自动镜头号
            </button>
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
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[10px] text-gray-500">
              <input
                type="checkbox"
                checked={gridOverlayRoleMarks}
                onChange={toggleGridOverlayRoleMarks}
                className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 text-white/80"
              />
              叠加人名标签
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[10px] text-gray-500">
              <input
                type="checkbox"
                checked={gridIncludeShotText}
                onChange={toggleGridIncludeShotText}
                className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 text-white/80"
              />
              叠加分镜文本
            </label>
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
          sceneAssets={table.sceneAssets ?? []}
          sceneAssetBusyId={sceneAssetBusyId}
          readOnly={readOnly}
          onImportRows={importInputRows}
          companionBaseUrl={companionBaseUrl}
          companionProjectId={companionProjectId}
          onGoToEdit={() => setPanelViewMode('edit')}
          onNotify={onNotify}
          onAddRoleAsset={addRoleAsset}
          onRemoveRoleAsset={removeRoleAsset}
          onRenameRoleAsset={renameRoleAsset}
          onAssignRoleAssetImage={assignRoleAssetImage}
          onAssignRoleAssetImages={assignRoleAssetImages}
          onClearRoleAssetImage={clearRoleAssetImage}
          onPreviewRoleAssetImage={openStoryboardLightbox}
          onAddSceneAsset={addSceneAsset}
          onRemoveSceneAsset={removeSceneAsset}
          onRenameSceneAsset={renameSceneAsset}
          onAssignSceneAssetImage={assignSceneAssetImage}
          onAssignSceneAssetImages={assignSceneAssetImages}
          onClearSceneAssetImage={clearSceneAssetImage}
          onPreviewSceneAssetImage={openStoryboardLightbox}
        />
      ) : isGridView ? (
        <StoryboardTableGridPreview
          rows={table.rows}
          fieldCatalog={table.fieldCatalog}
          secondsPerTile={gridSecondsPerTile}
          timelineLayerCount={timelineLayerCount}
          gridExportWidth={gridExportWidth}
          overlayRoleMarks={gridOverlayRoleMarks}
          includeShotText={gridIncludeShotText}
          roleAssets={table.roleAssets ?? []}
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
          assetId={asset.id}
          rows={table.rows}
          generatedImageAssets={generatedImageAssets}
          onPreviewGeneratedImage={(src) => openStoryboardLightbox(src)}
          onGenHistoryPanelVisible={requestGeneratedImageHistoryHydrate}
          onGeneratedImageHistoryLoadError={requestGeneratedImageHistoryHydrate}
          roleAssets={table.roleAssets ?? []}
          activeRowId={activeRowId}
          imageBusyRowId={imageBusyRowId}
          collageProcessing={collageProcessing}
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
          interaction={rowInteraction}
          onActiveRowIdChange={setActiveRowId}
          onPatchRows={patchRows}
          onRemoveRows={!readOnly ? removeRows : undefined}
          onReorderRows={!readOnly ? reorderOutlineRows : undefined}
          onInsertShotBefore={!readOnly ? handleOutlineInsertShotBefore : undefined}
          onInsertShotAfter={!readOnly ? handleOutlineInsertShotAfter : undefined}
          onAddFrameRoleMark={!readOnly ? addFrameRoleMark : undefined}
          onUpdateFrameRoleMark={!readOnly ? updateFrameRoleMark : undefined}
          onRemoveFrameRoleMark={!readOnly ? removeFrameRoleMark : undefined}
          onRebindFrameRoleMark={!readOnly ? rebindFrameRoleMark : undefined}
          onSetFrameRoleMarkCustomName={!readOnly ? setFrameRoleMarkCustomName : undefined}
          roleReplaceEligibleCount={roleReplaceEligibleCount}
          roleReplaceBatchBusy={roleReplaceBatchBusy}
          roleReplaceBatchProgress={roleReplaceBatchProgress}
          onRoleReplaceBatch={!readOnly ? () => void runRoleReplaceBatch() : undefined}
          selectedSheetGenBatchBusy={selectedSheetGenBatchBusy}
          selectedSheetGenBatchProgress={selectedSheetGenBatchProgress}
          onSelectedSheetGen={
            !readOnly ? (rowIds) => void runSelectedSheetGen(rowIds) : undefined
          }
          readOnly={readOnly}
          redrawRowDisabledReason={redrawRowDisabledReason}
          editScrollRef={editViewRef}
          footerAddRow={
            !readOnly ? (
              <button
                type="button"
                onClick={() => openInsertShotModal()}
                className={STORYBOARD_ADD_ROW_DASHED}
              >
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
      {frameCropDraft ? (
        <StoryboardFrameCropModal
          key={`${frameCropDraft.current.rowId}:${frameCropDraft.current.imageSrc}`}
          open
          busy={frameCropDraft.applying}
          imageSrc={frameCropDraft.current.imageSrc}
          shotLabel={
            frameCropDraft.current.shotNo
              ? `镜 ${frameCropDraft.current.shotNo}`
              : undefined
          }
          queueHint={
            frameCropDraft.rest.length > 0
              ? `还有 ${frameCropDraft.rest.length} 张待裁切`
              : undefined
          }
          headerTitle={frameCropDraft.mode === 'recrop' ? '预览与裁切' : undefined}
          initialCropNorm={frameCropDraft.initialCropNorm ?? null}
          onClose={closeFrameCrop}
          onConfirm={(crop) => void confirmFrameCrop(crop)}
          onUseFullImage={() => void useFullFrameCropImage()}
        />
      ) : null}
      {splitAdjustDraft ? (
        <StoryboardSheetSplitAdjustModal
          open
          busy={splitAdjustDraft.applying}
          detecting={splitAdjustDraft.detecting}
          detectStatus={splitAdjustDraft.detectStatus}
          imageSrc={splitAdjustDraft.imageSrc}
          boxes={splitAdjustDraft.boxes}
          expectedShotNos={splitAdjustDraft.expectedShotNos}
          sheetLabel={splitAdjustDraft.sheetLabel}
          initialSelectedId={splitAdjustDraft.initialSelectedId}
          onClose={closeSheetSplitBoxAdjust}
          onConfirm={confirmSheetSplitBoxAdjust}
        />
      ) : null}
      <StoryboardInsertShotModal
        open={insertShotModalOpen}
        rows={table.rows}
        initialShotNo={insertShotInitialNo}
        onClose={closeInsertShotModal}
        onConfirm={confirmInsertShot}
      />
    </>
  );
}
