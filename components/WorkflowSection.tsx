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
import { useWorkflowAssetExecutionElapsed } from '../hooks/useWorkflowAssetExecutionElapsed';
import { createPortal, flushSync } from 'react-dom';
import {
  CloudDownload,
  Download,
  Image as ImageIcon,
  ImagePlus,
  LayoutGrid,
  Package,
  Trash2,
} from 'lucide-react';
import type {
  WorkflowAsset,
  WorkflowPendingTask,
  CapabilitySet,
  VgpGenStepCapture,
  ImageOverlayAnnotationDoc,
} from '../types';
import { maxReferenceImagesForImageModel } from '../types';
import type { CustomAppModule } from '../types';
import { getRandomGroupCodeName } from '../data/groupCodeNames';
import {
  normalizeApiErrorMessage,
  getGeminiImageBatchBoxSizeForCurrentProvider,
  workflowGenerateImage,
  getTencentCredsFromEnv,
} from '../services/unifiedAiGateway';
import { DEFAULT_MODEL_TEXT } from '../services/modelRegistry/constants';
import { detectCutImageBoxes, FALLBACK_CUT_IMAGE_PRESET, FULL_IMAGE_BOX } from '../services/cutImageExecution';
import {
  isCutImageCapabilityPreset,
  readCutImageParams,
} from '../services/capabilityProcessors/imageProcessProcessors';
import {
  coerceImageModelRegistryId,
  DEFAULT_IMAGE_MODEL_REGISTRY_ID,
} from '../services/modelRegistry/imageModels';
import { coerceTextModelRegistryId } from '../services/modelRegistry/textModels';
import {
  executeCapability,
  executeCapabilitySet,
  getCapabilityEngine,
  isImageProcessPreset,
} from '../services/capabilityExecutor';
import { overrideSkipUnderstandFromUnderstandEnabled } from '../services/workflowUnderstandOverride';
import {
  getQuickComposePlainModule,
  QUICK_COMPOSE_PLAIN_I2I_ACTION_ID,
  QUICK_COMPOSE_PLAIN_T2I_ACTION_ID,
  QUICK_COMPOSE_PLAIN_TEXT_ACTION_ID,
} from '../services/quickComposePlainPresets';
import { classifyWorkflowRunTaskBranch } from '../services/workflowRunTaskBranch';
import { getWorkflowMaxConcurrency } from '../services/workflowConcurrency';
import {
  applyVgpAfterSuccessfulGen,
  attachInitialVgpToNewAsset,
  isVgpBlockingDiscardForDisplayKey,
  pruneVgpAfterDiscard,
} from '../services/vgp/vgpStore';
import { appendWorkflowAuditEvent, appendWorkflowRunTaskFailureAudit, appendWorkflowRunTaskSuccessAudit, hydrateWorkflowAuditRingSessionFromIdbOrLocalIfEmpty, WORKFLOW_AUDIT_CODES } from '../services/workflowAuditEvents';
import { setWorkflowMirrorPreferenceScope } from '../services/workflowMirrorPreferenceScope';
import { appendWorkflowOverlayCloseSnapshot, supersedeWorkflowOverlaySnapshotsForAsset, WORKFLOW_OVERLAY_PERIODIC_SNAPSHOT_MS, hydrateWorkflowOverlayRingSessionFromIdbOrLocalIfEmpty } from '../services/workflowOverlaySnapshots';
import type { WorkflowOverlaySnapshotBucket } from '../services/workflowOverlaySnapshots';
import { compareWorkflowOverlayDraftToPersisted } from '../services/workflowOverlayDraftCompare';
import { WorkflowStepTimelineDetailPanel } from './WorkflowStepTimelineDetailPanel';
import { WorkflowStepTimelinePanel } from './WorkflowStepTimelinePanel';
import { WorkflowOverlaySnapshotRecoverPanel } from './workflow/WorkflowOverlaySnapshotRecoverPanel';
import { WorkflowStepNodeGraphOverlay } from './WorkflowStepNodeGraphOverlay';
import { triggerImageDownload } from '../services/imageDataUrl';
import type { WorkflowLightboxImageWriteBackPayload } from '../services/imagePreviewWorkflowResize';
import { readLocalJson, scopedStorageKey, workflowFavoritesStorageKey, writeLocalJson } from '../services/clientPersist';
import { getTripoApiKey } from '../services/settingsStore';
import {
  rehydrateWorkflowAssetModelsFromTripoTask,
} from '../services/workflowTripoModelRehydrate';
import { rehydrateWorkflowAssetModelsFromTencentJob } from '../services/workflowTencentModelRehydrate';
import {
  resolveWorkflowStepModelUrls,
  resolveWorkflowStepModelCompanionKeys,
  resolveWorkflowStepModelFormats,
  getWorkflowStepModelPersistStatus,
  workflowModelPersistStatusLabel,
} from '../services/workflowStepModels';
import { downloadWorkflowStepModelSlot } from '../services/downloadModelFile';
import {
  collectWorkflowAssetIdsFromDragSources,
  downloadWorkflowAssetsByIds,
} from '../services/downloadWorkflowAssetDisplay';
import { revokeWorkflowModelBlobUrlsIfOrphaned } from '../services/workflowModelBlob';
import {
  hydrateWorkflowAsset3dModelsFromCompanion,
  hydrateWorkflowAssetSingle3dResultKeyFromCompanion,
} from '../services/workflow3dCompanionHydrate';
import {
  readLightboxAnnotationPrefs,
  writeLightboxAnnotationPrefs,
  type LightboxAnnotationLastCropTool,
  type LightboxAnnotationLastLocalTool,
} from '../services/lightboxAnnotationPrefs';
import {
  buildWorkflowImageTags,
  normalizeWorkflowTagMapToChinese,
  refineWorkflowImageTagsLowCost,
} from '../services/workflowImageTags';
import AppIcon from './ui/AppIcon';
import { ImagePreviewOverlay } from './ImagePreviewOverlay';
import type {
  ImagePreviewCanvasAdjustControl,
  ImagePreviewLayoutMode,
  ImagePreviewWebCaptureApi,
  Model3DDisplayMode,
} from './preview';
import {
  ImageFlatAnnotationOverlay,
  normalizeImageOverlayDoc,
  type ImageFlatAnnotationTool,
} from './ImageFlatAnnotationOverlay';
import { ImageAnnotationLightboxToolbar } from './ImageAnnotationLightboxToolbar';
import { rasterizeCropRegion, rasterizeImageWithAnnotationBakes } from '../services/imageManualCrop';
import { cropDataUrlByViewportNorm } from '../services/panoViewportCapture';
import type { PanoramaViewportProjection } from '../services/panoViewportProjection';
import {
  buildLocalInpaintInstruction,
  buildLocalInpaintGenImageOptions,
  compositeLocalInpaintPatch,
  ensureLocalInpaintOutputPixelFloor,
  rasterizeExpandedLocalEditCrop,
} from '../services/localInpaintGemini';
import { readFlatLocalInpaintCompositeStrategy } from '../services/lightboxFlatLocalInpaintPrefs';
import type { PanoLocalReprojectSnapshot } from '../services/panoViewportProjection';
import { snapshotViewportNormFromEquirectLoop } from '../services/panoLocalEditFootprint';
import { readPanoLocalInpaintShrinkToBase } from '../services/lightboxPanoLocalInpaintPrefs';
import {
  readLocalInpaintExpandMode,
  writeLocalInpaintExpandMode,
  type LocalInpaintExpandMode,
} from '../services/lightboxLocalInpaintExpandPrefs';
import {
  compositePanoPatchOntoEquirect,
  rasterizePanoLocalEditCropFromSnapshot,
} from '../services/panoLocalInpaintPano';
import { CustomDropdown } from './ui/CustomDropdown';

const MODEL_3D_DISPLAY_MODES: Array<{ key: Model3DDisplayMode; label: string; title: string }> = [
  { key: 'material', label: '材质', title: '显示模型自带材质与贴图' },
  { key: 'clay', label: '白模', title: '使用 50% 灰白模材质查看形体' },
  { key: 'wire', label: '线框', title: '仅显示模型拓扑线框' },
  { key: 'normal', label: '法线', title: '用法线颜色检查表面方向' },
];
import { resolveCapabilityPreviewSrc } from '../services/capabilityPreviewUrl';
import { WorkflowCapabilityHoverPreview } from './WorkflowCapabilityHoverPreview';
import { WorkflowGridImage } from './ProgressivePreviewImage';
import WorkflowPixelBusyOverlay from './WorkflowPixelBusyOverlay';
import { workflowResultUsesVideoPreview, workflowSafeImgSrc } from '../services/workflowImageDisplay';
import { previewSrcCacheFingerprint } from '../services/workflowImageThumb';
import { humanMessageForSamSegmentFailure, isSamInstallHelpCode } from '../services/companionSamSegmentMessages';
import { humanMessageForRembgFailure, isRembgInstallHelpCode } from '../services/companionRembgMessages';
import { runLightboxRembgFromImageSrc } from '../services/lightboxRembg';
import {
  runLightboxSamAutoSegmentFromImageSrc,
  runLightboxSamSegmentFromSession,
  type LightboxSamSegmentSession,
} from '../services/lightboxSamSegment';
import { unionMaskDataUrlsToDataUrl } from '../services/samMaskComposite';
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
  workflowAssetCurrentDisplayIsTextChannel,
  workflowAssetLightboxRasterEligible,
  workflowAssetToInputText,
  workflowPresetAcceptsTextCardDrag,
  workflowTextAssetOutlineLabel,
} from '../services/workflowTextAsset';
import {
  createEmptyStoryboardTableAsset,
  duplicateStoryboardTableOnAsset,
  isWorkflowStoryboardTableAsset,
  normalizeStoryboardTableOnAsset,
  storyboardTableCoverImage,
  storyboardTableOutlineLabel,
} from '../services/storyboardTableAsset';
import StoryboardTablePanel from './storyboard/StoryboardTablePanel';
import StoryboardTableGridCard from './storyboard/StoryboardTableGridCard';
import { useStoryboardVideoExportTask } from './storyboard/useStoryboardVideoExport';
import { compressStoryboardFrameDataUrl } from './storyboard/storyboardFrameImage';
import {
  applyStoryboardFrameCompanionHydrateResults,
  applyStoryboardFrameHistoryCompanionHydrateResults,
  applyStoryboardNamedAssetCompanionHydrateResults,
  buildStoryboardFrameCompanionHydrateKey,
  buildStoryboardFrameHistoryCompanionHydrateKey,
  buildStoryboardNamedAssetCompanionHydrateKey,
  hydrateStoryboardFrameCompanionTasks,
  hydrateStoryboardFrameHistoryCompanionTasks,
  hydrateStoryboardNamedAssetCompanionTasks,
  listStoryboardFrameCompanionHydrateTasks,
  listStoryboardFrameHistoryCompanionHydrateTasks,
  listStoryboardNamedAssetCompanionHydrateTasks,
  revokeStoryboardFrameCompanionHydrateUrls,
} from '../services/storyboardFrameCompanion';
import {
  replaceStoryboardRowFrame,
} from '../services/storyboardFrameHistory';
import {
  executeStoryboardRowRedraw,
  pickStoryboardEditRedrawPreset,
  resolveStoryboardFeedbackCollagePreset,
  type StoryboardRowRedrawInvokeOptions,
  listStoryboardRedrawPresets,
  pickDefaultStoryboardRedrawPresetId,
  STORYBOARD_REDRAW_PRESET_KEY,
} from '../services/storyboardTableRedraw';
import { storyboardRowHasFrameRef } from '../services/storyboardFrameImageUrl';
import {
  listStoryboardParsePresets,
  pickDefaultStoryboardParsePresetId,
  listStoryboardOptimizePresets,
  pickDefaultStoryboardOptimizePresetId,
  STORYBOARD_PARSE_PRESET_KEY,
} from '../services/storyboardTableParse';
import {
  WORKFLOW_TEXT_CONFIRM_CHARS,
  WORKFLOW_TEXT_WARN_CHARS,
  maxWorkflowPendingInputTextChars,
} from '../services/workflowTextLimits';
import {
  uuid,
  baseActionId,
  makeVersionKey,
  stripResultKeyToBaseActionId,
  WORKFLOW_LIGHTBOX_RESIZE_WRITEBACK_ACTION_ID,
  WORKFLOW_LIGHTBOX_SPLIT_STRETCH_WRITEBACK_ACTION_ID,
} from './workflow/workflowIds';
import {
  asWorkflowImageString,
  safeUnknownToString,
  collectImageLikeUrlsFromText,
  collectImageLikeUrlsFromHtml,
  dataTransferItemToString,
  cloneCapabilityPresetPanelWithScrollRef,
  cropBoxes,
} from './workflow/workflowSectionHelpers';
import { PromptTweakModal, ArchivedDetailModal, type PromptTweakTarget } from './workflow/modals';
import {
  SET_ACTION_PREFIX,
  TITLE_ROW_BTN_NEUTRAL,
  TITLE_ROW_BTN_ACTIVE,
  TITLE_ROW_BTN_PRIMARY,
  TITLE_ROW_STEPPER_SHELL,
  TITLE_ROW_STEPPER_VALUE,
  TITLE_ROW_STEPPER_BTN,
  TITLE_ROW_QUEUE_CHIP,
  TITLE_ROW_DROPDOWN_TRIGGER,
  WORKFLOW_CARD_SURFACE_IDLE,
  WORKFLOW_META_PILL,
  WORKFLOW_EDGE_GUTTER,
  WORKFLOW_CHROME_BTN_NEUTRAL,
  WORKFLOW_TOPBAR_ICON_BTN,
  WORKFLOW_LIGHTBOX_BOTTOM_RAIL,
  WORKFLOW_LIGHTBOX_RIGHT_PANEL_INSET,
  WORKFLOW_LIGHTBOX_VGP_GRAPH_LEFT_INSET,
  WORKFLOW_IMAGE_PREVIEW_RAIL,
  WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER,
  WORKFLOW_CARD_DISMISS_ICON_BTN,
} from './workflow/workflowSectionUiConstants';
import {
  sortRootWorkflowAssetsNewestFirst,
  workflowOutlineExpandableGroupIds,
} from './workflow/workflowOutlineUtils';
import {
  getGroupCoverImage,
  getGroupMemberIds,
  isGroupAsset,
  isGroupChildAsset,
} from '../services/groupHelpers';
import { isWorkflowEditableTarget } from './workflow/workflowDomUtils';
import {
  clampWorkflowCardAspectRatio,
  mergeCardAspectFromIntrinsic,
  nextGridCardAspectRatioFromIntrinsic,
  persistWorkflowCardAspects,
  readSessionWorkflowCardAspects,
  resolveWorkflowGridCardAspect,
} from './workflow/workflowCardAspect';
import { groupCapabilityPresetsByCategory } from './workflow/workflowCapabilityGroups';
import { WorkflowSidebarColumn, type WorkflowSidebarFavoriteEntry } from './workflow/WorkflowSidebarColumn';
import WorkspaceQuickComposeBar, {
  type WorkspaceQuickComposeComposeMode,
  type WorkspaceQuickComposePromptCard,
} from './WorkspaceQuickComposeBar';
import type { QuickComposeDropSlot, QuickComposeMention, QuickComposeSegment } from '../services/quickComposeMention';
import {
  buildQuickComposePromptOverride,
  draftFromSegments,
  ensureQuickComposeEditableBoundaries,
  listDropSlotMentionCandidates,
  mentionsFromSegments,
  newQuickComposeTextSegment,
  resolveQuickComposeReferences,
  stripCurrentViewFromQuickComposeSegments,
  workflowAssetMentionLabel,
} from '../services/quickComposeMention';
import { buildWorkflowComposerSeedFromTwoPresets } from './workflow/buildWorkflowComposerSeed';
import type { CapabilityAssetCandidate } from './CapabilitySetCanvas';
import { BUILTIN_IMAGE_PROCESS_IDS } from '../services/capabilityPresetStore';
import {
  formatWorkflowModelPreviewLimitLabel,
  revokeWorkflowModelBlobUrlsAfterAssetRemoved,
  workflowLocalModelFileExceedsPreviewLimit,
} from '../services/workflowModelBlob';
import { captureWorkflowModelThumbnailDataUrl } from '../services/workflowModelPreviewCapture';
import { getCompanionLocalBaseUrl, normalizeCompanionBaseUrl } from '../services/companionLocalPrefs';
import { probeCompanionSamSegmentHealth } from '../services/companionClient';
import {
  cloneWorkflowModelSlotsForDuplicatedAsset,
  companionRasterSlotNeedsHydrate,
  fetchWorkflowModelFromCompanionAsObjectUrl,
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  parseDataUrlToBlob,
  putWorkflowModelFileToCompanion,
  putWorkflowOriginalImageFromAnyUrl,
  putWorkflowOriginalImageToCompanion,
  putWorkflowResultImageToCompanion,
  resolveCapabilityInputImageForExecute,
  shouldKeepExistingCompanionRasterUrl,
  workflowAssetNeedsCompanionModelHydrate,
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
  overrideImageModelRegistryId?: string;
  /** @deprecated */
  overrideImageGear?: CustomAppModule['imageGear'];
  overrideTextModelRegistryId?: string;
  overrideImageAspectRatio?: string;
  overrideImageSize?: string;
  overrideSkipUnderstand?: boolean;
  logContext?: WorkflowPendingTask['logContext'];
  tripoMultiviewImages?: WorkflowPendingTask['tripoMultiviewImages'];
};

type WorkflowGroupOverrides = {
  imageModelRegistryId?: string;
  /** @deprecated */
  imageGear?: CustomAppModule['imageGear'];
  textModelRegistryId?: string;
  imageAspectRatio?: string;
  imageSize?: string;
  understand?: boolean;
  generateCount?: number;
};

type TripoMultiviewSlot = 'front' | 'back' | 'left' | 'right';
const TRIPO_MULTIVIEW_SLOTS: Array<{ key: TripoMultiviewSlot; label: string }> = [
  { key: 'front', label: '正面' },
  { key: 'back', label: '背面' },
  { key: 'left', label: '左侧' },
  { key: 'right', label: '右侧' },
];

function promptTweakTargetImage(target: PromptTweakTarget | undefined): string {
  if (!target) return '';
  return 'assetId' in target ? target.inputImage : target.imageBase64;
}

const WORKFLOW_GROUP_GENERATE_COUNT_HARD_MAX = 999;
const WORKFLOW_GROUP_GENERATE_CONFIRM_THRESHOLD = 20;
/** 底部输入框仅图/文、未拖入预设卡片时，运行日志统一前缀（与当前快捷能力预设名解耦） */
const WORKFLOW_QUICK_COMPOSE_PLAIN_LOG_LABEL = '底部输入';
const CAPABILITY_PRESET_COLUMNS_KEY = 'ac_capability_preset_columns_v1';
const CAPABILITY_PRESET_COLUMNS_MIN = 2;
const CAPABILITY_PRESET_COLUMNS_MAX = 6;

type CapabilityPresetTypeFilter = 'all' | 'text_to_text' | 'text_to_image' | 'image_to_image' | 'image_process' | 'image_to_text';
const CAPABILITY_PRESET_TYPE_FILTER_OPTIONS: Array<{ value: CapabilityPresetTypeFilter; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'text_to_text', label: '文生文' },
  { value: 'text_to_image', label: '文生图' },
  { value: 'image_to_image', label: '图生图' },
  { value: 'image_process', label: '图像处理' },
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

/** 元数据「生成说明」：执行器未回 `vgpSteps` 时写入 VGP 的兜底文案（输入框 / 文卡 / 预设 instruction） */
function buildWorkflowTaskUserPromptRecordForMetadata(
  task: WorkflowPendingTask,
  getModule: (actionId: string) => CustomAppModule | undefined
): string {
  const override = String(task.promptOverride ?? '').trim();
  if (override) return override;
  const inputText = String(task.inputText ?? '').trim();
  if (inputText) return inputText;
  const ins = String(getModule(task.actionType)?.instruction ?? '').trim();
  if (ins) return ins;
  return '';
}

/** 写入 `resultMeta`：入队侧预设/用户输入快照与是否走「理解」链路，供步骤时间线详情对照 */
function buildWorkflowStepResultMetaInputSnapshots(
  task: WorkflowPendingTask,
  vgpSteps: VgpGenStepCapture[] | null | undefined
): {
  presetActionIdSnapshot: string;
  promptOverrideSnapshot?: string;
  inputTextSnapshot?: string;
  usedCapabilityUnderstand: boolean;
  skipUnderstandSnapshot?: boolean;
} {
  const used = Array.isArray(vgpSteps) && vgpSteps.length > 0;
  const po = String(task.promptOverride ?? '').trim();
  const it = String(task.inputText ?? '').trim();
  return {
    presetActionIdSnapshot: baseActionId(task.actionType),
    ...(po ? { promptOverrideSnapshot: po } : {}),
    ...(it ? { inputTextSnapshot: it } : {}),
    usedCapabilityUnderstand: used,
    ...(task.overrideSkipUnderstand === true ? { skipUnderstandSnapshot: true } : {}),
  };
}

/** 大图底部条图标（与标注工具条密度接近） */
const LIGHTBOX_BAR_IC = { size: 16, strokeWidth: 1.75, className: 'shrink-0' as const };
const LIGHTBOX_ICON_BTN_NEUTRAL =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-gray-300 ring-1 ring-white/[0.06] hover:bg-white/[0.09] hover:text-gray-200 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/45';
const LIGHTBOX_ICON_BTN_ACTIVE =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white ring-1 ring-blue-400/40 hover:bg-blue-500 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/45';
const LIGHTBOX_ICON_BTN_PRIMARY =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white ring-1 ring-blue-400/40 hover:bg-blue-500 disabled:opacity-40 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/45';
const LIGHTBOX_ICON_BTN_VIOLET =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-violet-200/95 ring-1 ring-violet-500/25 hover:bg-white/[0.09] hover:text-violet-50 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/45';

/** 平面资产字段不存 `panoViewportCrop`（全景独立桶） */
function overlayDocForFlatAsset(doc: ImageOverlayAnnotationDoc): ImageOverlayAnnotationDoc {
  return normalizeImageOverlayDoc({
    ...doc,
    panoViewportCrop: null,
    panoLocalEditViewport: null,
    panoLocalEditEquirect: null,
    panoLocalEditReproject: null,
  });
}

/** 本机分割写入的 mask 版本键：单独当 `<img>` 会显得「灰底+白点」（透明区透出预览背景） */
function isWorkflowInternalSamMaskDisplayKey(dk: string | undefined | null): boolean {
  return String(dk || '').trim().startsWith('ac_internal_sam_');
}

const WorkflowSection: React.FC<{
  capabilityPresets: CustomAppModule[];
  capabilitySets?: CapabilitySet[];
  assets: WorkflowAsset[];
  onAssetsChange: (value: React.SetStateAction<WorkflowAsset[]>) => void;
  /** 用户显式删除分镜表资产时通知 App，以便 autosave 允许移除 */
  onStoryboardTableAssetRemoved?: (assetId: string) => void;
  pending: WorkflowPendingTask[];
  onPendingChange: (value: React.SetStateAction<WorkflowPendingTask[]>) => void;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
  /** 拖图到「生成3D」能力时调用，不进入执行队列，直接提交 3D 任务 */
  onAddGenerate3DJob?: (
    preset: CustomAppModule,
    imageBase64: string,
    task?: WorkflowPendingTask,
    multiviewImages?: WorkflowPendingTask['tripoMultiviewImages'],
    options?: { forceNewTask?: boolean }
  ) => Promise<void> | void;
  /** 与设置页 `SystemConfig.modelText` 一致：能力理解 / gen_text / 切割视觉检测等 */
  textModelRegistryId?: string;
  /** 用于按账号隔离常用功能偏好；未传时走 guest */
  preferenceScope?: string | null;
  /** 由 App 主滚动层注册，使列表两侧留白等网页空白处也能开始框选 */
  registerMarqueeStartHandler?: (handler: ((e: React.MouseEvent) => void) | null) => void;
  /** 由 App 主滚动层注册：左右留白区域滚轮可横向切页 */
  registerPaneWheelHandler?: (handler: ((e: React.WheelEvent) => void) | null) => void;
  /** 由 App 主滚动层注册：主区内空白 / 大纲留白 / 页边留白时滚轮滚动资产列表 */
  registerWorkflowAssetListWheelHandler?: (
    handler: ((e: React.WheelEvent, origin: 'inner' | 'gutter') => boolean) | null
  ) => void;
  /** 右侧「能力」页底部：能力预设编辑区（由 App 传入 Suspense 包裹的 CapabilityPresetSection） */
  capabilityPresetPanel?: React.ReactNode;
  /** 与能力页 `onUpdate` 同源：用于从工作区侧栏启用被禁用的预设并持久化 */
  onUpdateCapabilityPresets?: (next: CustomAppModule[]) => void;
  /** 与能力页 `onUpdateSets` 同源：工作流创建保存为复合能力 */
  onUpdateCapabilitySets?: (next: CapabilitySet[]) => void;
  /** 首次进入项目时的导览键（同一键仅执行一次横扫导览） */
  onboardingKey?: string | null;
  /** 顶栏左侧：返回项目列表 + 切换项目（位于 1–3 分档前）；不传则不渲染 */
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
  onStoryboardTableAssetRemoved,
  pending: pendingProp,
  onPendingChange: setPending,
  onLog,
  onAddGenerate3DJob,
  textModelRegistryId,
  preferenceScope = null,
  registerMarqueeStartHandler,
  registerPaneWheelHandler,
  registerWorkflowAssetListWheelHandler,
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
  const capabilityTextModel = useMemo(
    () => (textModelRegistryId || '').trim() || DEFAULT_MODEL_TEXT,
    [textModelRegistryId]
  );
  useEffect(() => {
    setQuickComposeTextModel(coerceTextModelRegistryId(capabilityTextModel));
  }, [capabilityTextModel]);
  const pendingRef = React.useRef(pending);
  pendingRef.current = pending;
  const assetsRef = React.useRef(assets);
  assetsRef.current = assets;
  const onLogRef = React.useRef(onLog);
  onLogRef.current = onLog;

  useEffect(() => {
    setWorkflowMirrorPreferenceScope(preferenceScope);
    return () => setWorkflowMirrorPreferenceScope(null);
  }, [preferenceScope]);

  useEffect(() => {
    setLocalInpaintExpandMode(readLocalInpaintExpandMode(preferenceScope));
  }, [preferenceScope]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [overlayTouched] = await Promise.all([
          hydrateWorkflowOverlayRingSessionFromIdbOrLocalIfEmpty(),
          hydrateWorkflowAuditRingSessionFromIdbOrLocalIfEmpty(),
        ]);
        if (!cancelled && overlayTouched) setOverlaySnapshotRingBump((n) => n + 1);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preferenceScope]);

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
  const [storyboardPanelAssetId, setStoryboardPanelAssetId] = useState<string | null>(null);
  const lightboxAssetIdRef = useRef<string | null>(null);
  lightboxAssetIdRef.current = lightboxAssetId;
  const [lightboxTripoPullBusy, setLightboxTripoPullBusy] = useState(false);
  const [lightboxTencentPullBusy, setLightboxTencentPullBusy] = useState(false);
  const lightboxSamArmEdgeRef = useRef(false);
  const textLightboxCenterRef = useRef<WorkflowTextLightboxCenterHandle | null>(null);
  const [lightboxMetaText, setLightboxMetaText] = useState<string>('');
  const [lightboxPointerRgb, setLightboxPointerRgb] = useState<{ r: number; g: number; b: number } | null>(null);
  /** 大图本机 SAM：十字准星点选 */
  const [lightboxSamPickArmed, setLightboxSamPickArmed] = useState(false);
  /** 本机下拉展开中：Esc 先交给工具条关菜单，避免与「菜单内武装」同步冲突 */
  const lightboxSamToolbarMenuOpenRef = useRef(false);
  const [lightboxSamBusy, setLightboxSamBusy] = useState(false);
  const [lightboxSamPickSubmode, setLightboxSamPickSubmode] = useState<'point' | 'box'>('point');
  const [lightboxSamSessionPoints, setLightboxSamSessionPoints] = useState<
    Array<{ ix: number; iy: number; label: 0 | 1 }>
  >([]);
  const [lightboxSamBoxPx, setLightboxSamBoxPx] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    nw: number;
    nh: number;
  } | null>(null);
  const [lightboxSamMetrics, setLightboxSamMetrics] = useState<{ nw: number; nh: number } | null>(null);
  const [lightboxSamMultimaskChoice, setLightboxSamMultimaskChoice] = useState<{
    dataUrls: string[];
    companionKeys: string[];
    resultKey: string;
    assetId: string;
  } | null>(null);
  const [lightboxSamMultimaskIndex, setLightboxSamMultimaskIndex] = useState(0);
  /** 分割预览未写入资产：`previewLayers` 为多次运行/自动选区叠层；保存时合成一张 PNG */
  const [lightboxSamUnsaved, setLightboxSamUnsaved] = useState<{
    assetId: string;
    resultKey: string;
    outputCompanionKey: string;
    previewLayers: string[];
  } | null>(null);
  const lightboxSamUnsavedRef = useRef(lightboxSamUnsaved);
  lightboxSamUnsavedRef.current = lightboxSamUnsaved;
  const lightboxSamMultimaskChoiceRef = useRef(lightboxSamMultimaskChoice);
  lightboxSamMultimaskChoiceRef.current = lightboxSamMultimaskChoice;
  const [lightboxSamUxMode, setLightboxSamUxMode] = useState<'prompt' | 'auto'>('prompt');
  const [lightboxSamAutoLayer, setLightboxSamAutoLayer] = useState<{
    assetId: string;
    resultKey: string;
    dataUrls: string[];
    companionKeys: string[];
  } | null>(null);
  const [lightboxSamAutoHover, setLightboxSamAutoHover] = useState<number | null>(null);
  const [lightboxSamAutoPicked, setLightboxSamAutoPicked] = useState<number[]>([]);
  const [lightboxSamPreviewCompositeHref, setLightboxSamPreviewCompositeHref] = useState<string | undefined>();
  /** 经伴侣探测 SamLocal /health 的 mode：stub 仅为小圆联调，非抠物 */
  const [lightboxSamBackendMode, setLightboxSamBackendMode] = useState<'unknown' | 'stub' | 'sam'>('unknown');
  const [lightboxRembgPreview, setLightboxRembgPreview] = useState<{
    assetId: string;
    resultKey: string;
    dataUrl: string;
    outputCompanionKey: string;
  } | null>(null);
  const lightboxRembgPreviewRef = useRef(lightboxRembgPreview);
  lightboxRembgPreviewRef.current = lightboxRembgPreview;
  const [lightboxRembgBusy, setLightboxRembgBusy] = useState(false);
  const [lightboxRembgInstallModalOpen, setLightboxRembgInstallModalOpen] = useState(false);
  const [lightboxSamInstallModalOpen, setLightboxSamInstallModalOpen] = useState(false);
  /** 关大图：overlay 与资产已持久化不一致时，用 Modal 替代 `window.confirm` */
  const [lightboxOverlayDirtyCloseDialogOpen, setLightboxOverlayDirtyCloseDialogOpen] = useState(false);
  const lightboxOverlayDirtyCloseDialogOpenRef = useRef(false);
  const lightboxDirtyClosePersistedRef = useRef<{ assetId: string; displayKey: string } | null>(null);
  /** overlay 环写入 session 后递增，驱动侧栏「恢复快照」列表重读 */
  const [, setOverlaySnapshotRingBump] = useState(0);
  /** 从组内网格打开大图时记录槽位，预设入队可带 sourceGroup* 与拖拽一致 */
  const [lightboxSourceSlot, setLightboxSourceSlot] = useState<{
    sourceGroupAssetId: string;
    sourceItemIndex: number;
  } | null>(null);
  const [lightboxOverlayTool, setLightboxOverlayTool] = useState<ImageFlatAnnotationTool>('off');
  const [lightboxOverlayColor, setLightboxOverlayColor] = useState('#60a5fa');
  const [lightboxBrushWidth, setLightboxBrushWidth] = useState(3);
  const [lightboxRememberedLocal, setLightboxRememberedLocal] =
    useState<LightboxAnnotationLastLocalTool>('local_edit_rect');
  const [lightboxRememberedCrop, setLightboxRememberedCrop] =
    useState<LightboxAnnotationLastCropTool>('crop_rect');
  const [lightboxOverlayByMode, setLightboxOverlayByMode] = useState<{
    flat: ImageOverlayAnnotationDoc;
    pano: ImageOverlayAnnotationDoc;
  }>(() => ({
    flat: normalizeImageOverlayDoc(null),
    pano: normalizeImageOverlayDoc(null),
  }));
  const lightboxOverlayByModeRef = useRef(lightboxOverlayByMode);
  lightboxOverlayByModeRef.current = lightboxOverlayByMode;
  /** 与 `ImagePreviewOverlay` 同步：平面 / 全景 / 高度 3D / 3D 模型（非平面时标注写入对应桶） */
  const [lightboxPreviewLayout, setLightboxPreviewLayout] = useState<ImagePreviewLayoutMode>('flat');
  const [lightboxModel3dDisplayMode, setLightboxModel3dDisplayMode] = useState<Model3DDisplayMode>('material');
  const [lightboxCanvasSplitStretchEnabled, setLightboxCanvasSplitStretchEnabled] = useState(false);
  const [lightboxCanvasSplitStretchWriteBackPopOpen, setLightboxCanvasSplitStretchWriteBackPopOpen] =
    useState(false);
  const [lightboxCanvasResizeWriteBackPopOpen, setLightboxCanvasResizeWriteBackPopOpen] = useState(false);
  const lightboxOverlayActiveBucket: 'flat' | 'pano' =
    lightboxPreviewLayout === 'pano' ? 'pano' : 'flat';
  const lightboxOverlayDraft = lightboxOverlayByMode[lightboxOverlayActiveBucket];
  const lightboxOverlayDraftRef = useRef(lightboxOverlayDraft);
  const lightboxOverlayActiveBucketRef = useRef(lightboxOverlayActiveBucket);
  lightboxOverlayDraftRef.current = lightboxOverlayDraft;
  lightboxOverlayActiveBucketRef.current = lightboxOverlayActiveBucket;
  const lightboxPanoViewerRef = useRef<PanoramaViewportProjection | null>(null);
  /** 供 `lightboxAwaitClientResult` 异步链读取当前大图预览模式（避免闭包陈旧） */
  const lightboxPreviewLayoutRef = useRef<ImagePreviewLayoutMode>(lightboxPreviewLayout);
  lightboxPreviewLayoutRef.current = lightboxPreviewLayout;
  const lightboxWebPreviewCaptureApiRef = useRef<ImagePreviewWebCaptureApi | null>(null);
  const onLightboxWebPreviewCaptureApiChange = useCallback((api: ImagePreviewWebCaptureApi | null) => {
    lightboxWebPreviewCaptureApiRef.current = api;
  }, []);
  /** 工作流大图：高度 3D 工具条 portal 宿主（右侧详情列上方，与详情同宽） */
  const lightboxHeightfieldToolbarHostRef = useRef<HTMLDivElement | null>(null);
  /** 大图局部重绘选区底边中点（视口），快捷栏锚在框下方 */
  const [lightboxQuickComposeAnchor, setLightboxQuickComposeAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  /** 大图提交后递增，强制快捷栏回到默认贴底位置（即使 anchor 本就为 null） */
  const [lightboxQuickComposeLayoutNonce, setLightboxQuickComposeLayoutNonce] = useState(0);
  const onLocalEditAnchorClientChange = useCallback((pt: { x: number; y: number } | null) => {
    setLightboxQuickComposeAnchor((prev) => {
      if (pt == null) return prev != null ? null : prev;
      const { x, y } = pt;
      if (prev != null && Math.abs(prev.x - x) < 1 && Math.abs(prev.y - y) < 1) return prev;
      return { x, y };
    });
  }, []);
  /** 大图快捷栏：任务已入队但像素仍在客户端异步计算，`runTask` 在此 Promise 上等待 */
  const lightboxClientImageDeferredRef = useRef(
    new Map<
      string,
      {
        promise: Promise<string>;
        resolve: (v: string) => void;
        reject: (e: unknown) => void;
        /** 客户端已完成局部重绘贴回，勿再对整图 executeCapability */
        skipCapabilityExecute?: boolean;
        /** 大图 @ 多参考：合成主图后的完整参考列表（≥2 时传给 executeCapability） */
        inputImagesForExecute?: string[];
      }
    >()
  );
  const overlayHistoryPastByModeRef = useRef<{ flat: ImageOverlayAnnotationDoc[]; pano: ImageOverlayAnnotationDoc[] }>({
    flat: [],
    pano: [],
  });
  const overlayHistoryFutureByModeRef = useRef<{ flat: ImageOverlayAnnotationDoc[]; pano: ImageOverlayAnnotationDoc[] }>(
    { flat: [], pano: [] }
  );

  const cloneOverlayDoc = useCallback(
    (d: ImageOverlayAnnotationDoc): ImageOverlayAnnotationDoc => JSON.parse(JSON.stringify(d)),
    []
  );

  const pushOverlayHistory = useCallback(
    (snapshot: ImageOverlayAnnotationDoc) => {
      const bucket = lightboxOverlayActiveBucketRef.current;
      const past = overlayHistoryPastByModeRef.current[bucket];
      past.push(cloneOverlayDoc(snapshot));
      if (past.length > 100) past.shift();
      overlayHistoryFutureByModeRef.current[bucket] = [];
    },
    [cloneOverlayDoc]
  );

  const onLightboxOverlayPatch = useCallback(
    (patch: (prev: ImageOverlayAnnotationDoc) => ImageOverlayAnnotationDoc, opts?: { skipHistory?: boolean }) => {
      const bucket = lightboxOverlayActiveBucketRef.current;
      setLightboxOverlayByMode((prev) => {
        const cur = prev[bucket];
        const normalized = normalizeImageOverlayDoc(cur);
        const next = normalizeImageOverlayDoc(patch(normalized));
        if (JSON.stringify(normalized) === JSON.stringify(next)) return prev;
        if (!opts?.skipHistory) pushOverlayHistory(normalized);
        return { ...prev, [bucket]: next };
      });
    },
    [pushOverlayHistory]
  );

  const overlayBeginDragGesture = useCallback(() => {
    pushOverlayHistory(lightboxOverlayDraftRef.current);
  }, [pushOverlayHistory]);

  const overlayUndo = useCallback(() => {
    if (lightboxSamPickArmed && !lightboxSamBusy) {
      if (lightboxSamSessionPoints.length > 0) {
        setLightboxSamSessionPoints((p) => p.slice(0, -1));
        return;
      }
      if (lightboxSamBoxPx != null) {
        setLightboxSamBoxPx(null);
        return;
      }
    }
    const aid = lightboxAssetIdRef.current;
    if (lightboxSamUnsaved && aid && lightboxSamUnsaved.assetId === aid) {
      setLightboxSamUnsaved(null);
      setLightboxSamMultimaskChoice(null);
      setLightboxSamMultimaskIndex(0);
      setLightboxSamPreviewCompositeHref(undefined);
      setLightboxSamUxMode('prompt');
      setLightboxSamAutoLayer(null);
      setLightboxSamAutoPicked([]);
      setLightboxSamAutoHover(null);
      return;
    }
    const bucket = lightboxOverlayActiveBucketRef.current;
    const past = overlayHistoryPastByModeRef.current[bucket];
    if (past.length === 0) return;
    const prevHead = past.pop()!;
    setLightboxOverlayByMode((cur) => {
      const curDoc = cur[bucket];
      overlayHistoryFutureByModeRef.current[bucket].push(cloneOverlayDoc(normalizeImageOverlayDoc(curDoc)));
      return { ...cur, [bucket]: prevHead };
    });
  }, [
    cloneOverlayDoc,
    lightboxSamPickArmed,
    lightboxSamBusy,
    lightboxSamSessionPoints.length,
    lightboxSamBoxPx,
    lightboxSamUnsaved,
  ]);

  const overlayRedo = useCallback(() => {
    const bucket = lightboxOverlayActiveBucketRef.current;
    const fut = overlayHistoryFutureByModeRef.current[bucket];
    if (fut.length === 0) return;
    const nextHead = fut.pop()!;
    setLightboxOverlayByMode((cur) => {
      const curDoc = cur[bucket];
      overlayHistoryPastByModeRef.current[bucket].push(cloneOverlayDoc(normalizeImageOverlayDoc(curDoc)));
      return { ...cur, [bucket]: nextHead };
    });
  }, [cloneOverlayDoc]);

  const handleLightboxPreviewLayoutChange = useCallback((layout: ImagePreviewLayoutMode) => {
    setLightboxPreviewLayout(layout);
  }, []);

  useEffect(() => {
    if (!lightboxAssetId) setLightboxQuickComposeAnchor(null);
  }, [lightboxAssetId]);

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
  const [tripoMultiviewModal, setTripoMultiviewModal] = useState<{
    preset: CustomAppModule;
    targets: PromptTweakTarget[];
    overrides?: WorkflowGroupOverrides;
    slots: Partial<Record<TripoMultiviewSlot, PromptTweakTarget>>;
  } | null>(null);
  const [tripoMultiviewModalPos, setTripoMultiviewModalPos] = useState({ x: 720, y: 96 });
  const tripoMultiviewModalDragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const [tripoMultiviewDraggingSlot, setTripoMultiviewDraggingSlot] = useState<TripoMultiviewSlot | null>(null);
  const [quickComposeSegments, setQuickComposeSegments] = useState<QuickComposeSegment[]>(() => [
    newQuickComposeTextSegment(''),
  ]);
  /** 功能区悬停时联动左侧能力预设列：高亮对应预设 id，其余压暗 */
  const [sidebarLinkHoverPresetIds, setSidebarLinkHoverPresetIds] = useState<string[] | null>(null);
  /** 从功能区/能力列拖入文本框的预设提示词，以卡片展示并与输入框文案合并入队 */
  const [quickComposePromptCards, setQuickComposePromptCards] = useState<WorkspaceQuickComposePromptCard[]>([]);
  const [quickComposeDropSlots, setQuickComposeDropSlots] = useState<QuickComposeDropSlot[]>([]);
  /** 无拖入预设卡片时：文 / 图 / 3D 独立快捷逻辑（不读侧栏「上次预设」） */
  const [quickComposeMode, setQuickComposeMode] = useState<WorkspaceQuickComposeComposeMode>('image');
  /** 快捷栏生成设置（覆盖入队任务的档位/比例/尺寸；张数见 normalizeWorkflowGenerateCount） */
  const [quickComposeImageModel, setQuickComposeImageModel] = useState<string>(DEFAULT_IMAGE_MODEL_REGISTRY_ID);
  const [quickComposeTextModel, setQuickComposeTextModel] = useState<string>(() =>
    coerceTextModelRegistryId((textModelRegistryId || '').trim() || DEFAULT_MODEL_TEXT)
  );
  const [quickComposeAspect, setQuickComposeAspect] = useState('adaptive');
  const [quickComposeSize, setQuickComposeSize] = useState('');
  const [quickComposeCount, setQuickComposeCount] = useState(1);
  /** 与内置快捷条预设一致：默认直发（skipUnderstand）；开启后才走理解 */
  const [quickComposeUnderstand, setQuickComposeUnderstand] = useState(false);
  const [localInpaintExpandMode, setLocalInpaintExpandMode] = useState<LocalInpaintExpandMode>(() =>
    readLocalInpaintExpandMode(preferenceScope)
  );
  /**
   * 与 `quickComposeSegments` 同步；在 **setState 提交前** 即更新（见 `setQuickComposeSegmentsTracked`），
   * 避免大图/底部栏「最后一笔输入后立即点生成」读到空文案。
   */
  const quickComposeSegmentsRef = useRef<QuickComposeSegment[]>([newQuickComposeTextSegment('')]);
  const setQuickComposeSegmentsTracked = useCallback((value: React.SetStateAction<QuickComposeSegment[]>) => {
    setQuickComposeSegments((prev) => {
      const next =
        typeof value === 'function'
          ? (value as (p: QuickComposeSegment[]) => QuickComposeSegment[])(prev)
          : value;
      const bounded = ensureQuickComposeEditableBoundaries(next);
      quickComposeSegmentsRef.current = bounded;
      return bounded;
    });
  }, []);
  const quickComposeDraft = useMemo(
    () => draftFromSegments(quickComposeSegments),
    [quickComposeSegments]
  );
  const quickComposeMentions = useMemo(
    () => mentionsFromSegments(quickComposeSegments),
    [quickComposeSegments]
  );
  const getQuickComposeMaxRefs = useCallback(() => {
    if (quickComposeMode === 'text') return 10;
    if (quickComposeMode === '3d') return 1;
    return maxReferenceImagesForImageModel(quickComposeImageModel);
  }, [quickComposeMode, quickComposeImageModel]);
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
  const [cardAspectByAssetId, setCardAspectByAssetId] = useState<Record<string, number>>({});
  const cardAspectProjectRef = useRef<string | null>(null);
  const [thumbUnlockKeys, setThumbUnlockKeys] = useState<Set<string>>(() => new Set());
  /** 当前视口内（严格 intersect）卡片：缩略解码队列 high，优先于屏外 */
  const [thumbHotKeys, setThumbHotKeys] = useState<Set<string>>(() => new Set());
  const thumbOnboardingRef = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const workspaceViewportRef = useRef<HTMLDivElement>(null);
  const workspaceTrackRef = useRef<HTMLDivElement>(null);
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

  const handleWorkflowMainAssetListWheel = useCallback(
    (e: React.WheelEvent, origin: 'inner' | 'gutter'): boolean => {
      if (isWorkflowEditableTarget(e.target)) return false;
      const t = e.target as Element | null;
      if (t?.closest('[data-prevent-wheel-scroll]')) return false;
      if (t?.closest('[data-ac-dropdown-overlay], [data-ac-dropdown-list]')) return false;
      if (t?.closest('[role="dialog"]')) return false;
      const list = centerScrollRef.current;
      if (!list) return false;
      const dy = normalizeWheelDeltaY(e as React.WheelEvent<HTMLElement>);
      if (!Number.isFinite(dy) || Math.abs(dy) < 0.1) return false;

      const listCol = list.parentElement;
      const listColRect = listCol?.getBoundingClientRect();
      if (!listColRect) return false;

      const outlineEl = outlineScrollRef.current;
      const listCanUp = list.scrollTop > 0;
      const listCanDown = list.scrollTop + list.clientHeight < list.scrollHeight - 1;

      if (origin === 'gutter') {
        const y = e.clientY;
        if (y < listColRect.top || y > listColRect.bottom) return false;
        if (!listCanUp && !listCanDown) return false;
        e.preventDefault();
        e.stopPropagation();
        list.scrollTop += dy;
        return true;
      }

      if (t?.closest('[data-workflow-sidebar]') || t?.closest('[data-workflow-preset]')) {
        return false;
      }

      if (t?.closest('[data-workflow-outline]')) {
        if (!outlineEl) return false;
        const oUp = outlineEl.scrollTop > 0;
        const oDown = outlineEl.scrollTop + outlineEl.clientHeight < outlineEl.scrollHeight - 1;
        if ((dy < 0 && oUp) || (dy > 0 && oDown)) return false;
        e.preventDefault();
        e.stopPropagation();
        list.scrollTop += dy;
        return true;
      }

      if (t && list.contains(t)) {
        if ((dy < 0 && listCanUp) || (dy > 0 && listCanDown)) return false;
        return false;
      }

      const px = e.clientX;
      const py = e.clientY;
      if (px < listColRect.left || px > listColRect.right || py < listColRect.top || py > listColRect.bottom) {
        return false;
      }
      if (!listCanUp && !listCanDown) return false;
      e.preventDefault();
      e.stopPropagation();
      list.scrollTop += dy;
      return true;
    },
    []
  );

  useEffect(() => {
    if (!registerWorkflowAssetListWheelHandler) return;
    registerWorkflowAssetListWheelHandler(handleWorkflowMainAssetListWheel);
    return () => registerWorkflowAssetListWheelHandler(null);
  }, [registerWorkflowAssetListWheelHandler, handleWorkflowMainAssetListWheel]);

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

  useLayoutEffect(() => {
    const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
    const fromAssets = (): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const a of assets) {
        const g = a.gridCardAspectRatio;
        if (typeof g === 'number' && Number.isFinite(g) && g > 0) {
          out[a.id] = Math.max(0.5, Math.min(2, g));
        }
      }
      return out;
    };
    if (cardAspectProjectRef.current !== pid) {
      cardAspectProjectRef.current = pid;
      const sessionMap = readSessionWorkflowCardAspects(pid);
      setCardAspectByAssetId({ ...sessionMap, ...fromAssets() });
      return;
    }
    setCardAspectByAssetId((prev) => {
      const seed = fromAssets();
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(seed)) {
        if (next[k] !== v) {
          next[k] = v;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [workspaceProjectChrome?.activeProjectId, assets]);

  useEffect(() => {
    const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
    const t = window.setTimeout(() => {
      persistWorkflowCardAspects(pid || null, cardAspectByAssetId);
    }, 400);
    return () => window.clearTimeout(t);
  }, [cardAspectByAssetId, workspaceProjectChrome?.activeProjectId]);

  const applyIntrinsicAspectToAsset = useCallback(
    (assetId: string, w: number, h: number) => {
      setCardAspectByAssetId((prev) => mergeCardAspectFromIntrinsic(prev, assetId, w, h) ?? prev);
      setAssets((prev) => {
        const cur = prev.find((x) => x.id === assetId);
        const nextR = nextGridCardAspectRatioFromIntrinsic(cur?.gridCardAspectRatio, w, h);
        if (nextR == null) return prev;
        return prev.map((x) => (x.id === assetId ? { ...x, gridCardAspectRatio: nextR } : x));
      });
    },
    [setAssets]
  );

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
  const trackTotalWidth = listPaneWidth + sidebarWidth + presetPaneWidth + sidebarWidth;
  const marqueeStartRef = useRef(false);
  const {
    workspacePane,
    setWorkspacePane: _setWorkspacePane,
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
  /** 供 document wheel capture 读取：按住空格时不拦截滚轮，以便滚动资产列表 */
  const spacePanEnabledRef = useRef(false);
  useLayoutEffect(() => {
    spacePanEnabledRef.current = spacePanEnabled;
  }, [spacePanEnabled]);
  /** 按住空格时：在卡片上滚轮改为滚动资产列表（不依赖浏览器默认滚动穿透） */
  const applyWheelToAssetListWhileSpacePan = useCallback((e: React.WheelEvent) => {
    if (!spacePanEnabled) return;
    const list = centerScrollRef.current;
    if (!list) return;
    const dy = normalizeWheelDeltaY(e);
    if (!Number.isFinite(dy) || Math.abs(dy) < 0.1) return;
    e.preventDefault();
    e.stopPropagation();
    list.scrollTop += dy;
  }, [spacePanEnabled]);
  /** 从功能区「词」进入能力页：横向滑到能力列并滚动到对应预设卡片 */
  const jumpToCapabilityPreset = useCallback((preset: CustomAppModule) => {
    const mode: 'presets' | 'image_process' = isImageProcessPreset(preset) ? 'image_process' : 'presets';
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
    snapWorkspacePaneToNode(2);
  }, [snapWorkspacePaneToNode]);
  const jumpToCapabilitySet = useCallback(
    (setId: string) => {
      setCapabilityPresetViewMode('sets');
      if (typeof window !== 'undefined') {
        const emitJump = () => {
          window.dispatchEvent(new CustomEvent('ac:capability-preset-view-mode', { detail: { mode: 'sets' } }));
          window.dispatchEvent(new CustomEvent('ac:capability-jump-to-set', { detail: { setId } }));
        };
        emitJump();
        window.requestAnimationFrame(emitJump);
        window.setTimeout(emitJump, 220);
      }
      snapWorkspacePaneToNode(2);
    },
    [snapWorkspacePaneToNode]
  );
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
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

  const addWorkflowStoryboardTableAsset = useCallback(
    (title?: string): string => {
      const id = uuid();
      const defaultParseId = readLocalJson(
        STORYBOARD_PARSE_PRESET_KEY,
        pickDefaultStoryboardParsePresetId(capabilityPresets),
        (v) => (typeof v === 'string' ? v : null)
      );
      const newAsset = attachInitialVgpToNewAsset(
        createEmptyStoryboardTableAsset(id, title, defaultParseId)
      );
      setAssets((prev) => [...prev, newAsset]);
      onLog?.('info', '已新建分镜表');
      return id;
    },
    [capabilityPresets, onLog, setAssets]
  );

  const openStoryboardTablePanel = useCallback((assetId: string) => {
    setStoryboardPanelAssetId(assetId);
    setLightboxAssetId(null);
    setLightboxSourceSlot(null);
  }, []);

  const closeStoryboardTablePanel = useCallback(() => {
    setStoryboardPanelAssetId(null);
  }, []);

  const handleStoryboardAssetPatch = useCallback(
    (
      assetId: string,
      patch: Partial<WorkflowAsset> | ((prev: WorkflowAsset) => WorkflowAsset)
    ) => {
      const id = String(assetId || '').trim();
      if (!id) return;
      setAssets((prev) => {
        const cur = prev.find((x) => x.id === id);
        if (!cur || !isWorkflowStoryboardTableAsset(cur)) return prev;
        const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
        return prev.map((x) =>
          x.id === id ? normalizeStoryboardTableOnAsset(next) : x
        );
      });
    },
    [setAssets]
  );

  const handleWorkflowFeatureClick = useCallback(
    (featureId: string) => {
      if (featureId !== 'storyboard_flow') return;
      const id = addWorkflowStoryboardTableAsset();
      openStoryboardTablePanel(id);
    },
    [addWorkflowStoryboardTableAsset, openStoryboardTablePanel]
  );

  const storyboardRedrawPresets = useMemo(
    () => listStoryboardRedrawPresets(capabilityPresets),
    [capabilityPresets]
  );

  const storyboardParsePresets = useMemo(
    () => listStoryboardParsePresets(capabilityPresets),
    [capabilityPresets]
  );

  const storyboardOptimizePresets = useMemo(
    () => listStoryboardOptimizePresets(capabilityPresets),
    [capabilityPresets]
  );

  const handleStoryboardRowRedraw = useCallback(
    async (
      tableAssetId: string,
      rowId: string,
      imageModelRegistryId: string,
      options?: StoryboardRowRedrawInvokeOptions
    ) => {
      const tableAsset = assets.find((a) => a.id === tableAssetId);
      if (!tableAsset || !isWorkflowStoryboardTableAsset(tableAsset)) return;
      const row = tableAsset.storyboardTable?.rows.find((r) => r.id === rowId);
      if (!row) {
        onLog?.('warn', '分镜表：镜头行不存在');
        return;
      }
      if (row.locked) {
        onLog?.('warn', '该镜头已通过，跳过重绘');
        return;
      }
      const hasFrame = storyboardRowHasFrameRef(row);
      const collagePreset = hasFrame
        ? resolveStoryboardFeedbackCollagePreset(
            storyboardRedrawPresets,
            options?.collagePresetId
          )
        : null;
      const preset = options?.feedbackOnly
        ? collagePreset
        : hasFrame
          ? collagePreset
          : pickStoryboardEditRedrawPreset(storyboardRedrawPresets, row);
      if (!preset || preset.disabled) {
        onLog?.(
          'warn',
          options?.feedbackOnly || hasFrame
            ? '请选择拼图改图能力（图生图），或在能力预设中启用'
            : '无可用文生图/图生图能力，请在能力预设中启用'
        );
        return;
      }
      const result = await executeStoryboardRowRedraw({
        preset,
        collagePreset: hasFrame ? collagePreset ?? undefined : undefined,
        row,
        fieldCatalog: tableAsset.storyboardTable?.fieldCatalog ?? [],
        imageModelRegistryId,
        feedbackOnly: options?.feedbackOnly,
        understand: options?.understand,
        ctx: {
          onLog,
          textModelRegistryId: capabilityTextModel,
          companionProjectId: workspaceProjectChrome?.activeProjectId?.trim() || undefined,
        },
        companionBaseUrl: String(getCompanionLocalBaseUrl() || ''),
        companionProjectId: String(workspaceProjectChrome?.activeProjectId || ''),
      });
      if (!result.ok) {
        onLog?.('warn', `分镜重绘失败：${result.error}`);
        return;
      }
      let frameImage = result.image;
      try {
        frameImage = await compressStoryboardFrameDataUrl(frameImage);
      } catch {
        /* keep raw */
      }
      const base = String(getCompanionLocalBaseUrl() || '').trim();
      const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
      const framePatch = await replaceStoryboardRowFrame({
        row,
        dataUrl: frameImage,
        assetId: tableAssetId,
        companionBaseUrl: base,
        companionProjectId: pid,
        source: 'redraw',
      });
      setAssets((prev) =>
        prev.map((a) => {
          if (a.id !== tableAssetId || !isWorkflowStoryboardTableAsset(a)) return a;
          const doc = a.storyboardTable;
          if (!doc?.rows) return a;
          return normalizeStoryboardTableOnAsset({
            ...a,
            storyboardTable: {
              ...doc,
              rows: doc.rows.map((r) => (r.id === rowId ? { ...r, ...framePatch } : r)),
            },
          });
        })
      );
    },
    [
      assets,
      capabilityTextModel,
      onLog,
      setAssets,
      storyboardRedrawPresets,
      workspaceProjectChrome?.activeProjectId,
    ]
  );

  const navigateOutlineToAsset = useCallback(
    (asset: WorkflowAsset) => {
      if (isWorkflowStoryboardTableAsset(asset)) {
        setGroupFilterId(null);
        setSelectedGroupItemKeys(new Set());
        setSelectedRootAssetIds(new Set([asset.id]));
        openStoryboardTablePanel(asset.id);
        requestAnimationFrame(() => {
          cardRefs.current.get(asset.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
        return;
      }
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
    [assets, openStoryboardTablePanel, setSelectedRootAssetIds]
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

  const getModule = useCallback(
    (id: string) => actionModules.find((m) => m.id === id) ?? getQuickComposePlainModule(id),
    [actionModules]
  );
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
    const baseId = stripResultKeyToBaseActionId(actionType);
    return getModule(baseId)?.label ?? baseId;
  }, [getModule, getSet]);
  const getTaskLogLabel = useCallback(
    (task: WorkflowPendingTask) =>
      task.logContext === 'quick_compose_bar_plain'
        ? WORKFLOW_QUICK_COMPOSE_PLAIN_LOG_LABEL
        : getActionLabel(task.actionType),
    [getActionLabel]
  );
  const getGenerationRecordStepLabel = useCallback((stepKey: string, asset?: WorkflowAsset) => {
    if (stepKey === 'original') return '原图';
    if (stepKey === 'cut_image') return '切割';
    if (stepKey.startsWith(SET_ACTION_PREFIX)) {
      const s = getSet(stepKey.slice(SET_ACTION_PREFIX.length));
      return s?.label ?? stepKey;
    }
    const metaL = asset?.resultMeta?.[stepKey]?.displayStepLabel?.trim();
    if (metaL) return metaL;
    const baseId = stripResultKeyToBaseActionId(stepKey);
    return getModule(baseId)?.label ?? baseId;
  }, [getSet, getModule]);
  const getAssetDisplayImage = useCallback((
    a: WorkflowAsset,
    _assetsList?: WorkflowAsset[],
    _visited?: Set<string>
  ): string => {
    if (isWorkflowStoryboardTableAsset(a)) {
      return storyboardTableCoverImage(a);
    }
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

  const assetLightboxRasterEligible = useCallback(
    (a: WorkflowAsset | null | undefined): boolean => {
      if (!a || isGroupAsset(a) || isWorkflowStoryboardTableAsset(a)) return false;
      return workflowAssetLightboxRasterEligible(a, getAssetDisplayImage(a));
    },
    [getAssetDisplayImage]
  );

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
        if (!ck) continue;
        if (!companionRasterSlotNeedsHydrate(String(a.results?.[sid] ?? ''), ck)) continue;
        parts.push(`${a.id}:${sid}:${ck}`);
      }
    }
    return parts.sort().join('|');
  }, [assets]);

  const companionStoryboardFrameHydrateKey = useMemo(
    () => buildStoryboardFrameCompanionHydrateKey(assets),
    [assets]
  );

  const companionStoryboardFrameHistoryHydrateKey = useMemo(
    () => buildStoryboardFrameHistoryCompanionHydrateKey(assets),
    [assets]
  );

  const companionStoryboardNamedAssetHydrateKey = useMemo(
    () => buildStoryboardNamedAssetCompanionHydrateKey(assets),
    [assets]
  );

  const companionModelHydrateKey = useMemo(() => {
    const parts: string[] = [];
    for (const a of assets) {
      if (!workflowAssetNeedsCompanionModelHydrate(a)) continue;
      const smck = a.stepModelCompanionKeys || {};
      for (const stepKey of Object.keys(smck)) {
        const keys = smck[stepKey] || [];
        for (let i = 0; i < keys.length; i += 1) {
          const ck = String(keys[i] || '').trim();
          if (!ck) continue;
          parts.push(`${a.id}:${stepKey}:${i}:${ck}`);
        }
      }
      const mck = a.modelCompanionKeys || [];
      for (let i = 0; i < mck.length; i += 1) {
        const ck = String(mck[i] || '').trim();
        if (!ck) continue;
        parts.push(`${a.id}:legacy:${i}:${ck}`);
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
        const prevO = String(a.original || '').trim();
        if (await shouldKeepExistingCompanionRasterUrl(prevO, key)) continue;
        const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, projectId, key);
        if (cancelled) return;
        if (got.ok === false) {
          onLogRef.current?.('warn', '本地伴侣原图恢复失败', `${a.id}: ${got.error}`);
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
  }, [companionHydrateKey, workspaceProjectChrome?.activeProjectId, setAssets]);

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
          if (!ck) continue;
          const prevV = String(a.results?.[stepId] ?? '').trim();
          if (!companionRasterSlotNeedsHydrate(prevV, ck)) continue;
          if (await shouldKeepExistingCompanionRasterUrl(prevV, ck)) continue;
          const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, projectId, ck);
          if (cancelled) return;
          if (got.ok === false) {
            onLogRef.current?.('warn', '本地伴侣步骤结果图恢复失败', `${a.id}/${stepId}: ${got.error}`);
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
  }, [companionResultsHydrateKey, workspaceProjectChrome?.activeProjectId, setAssets]);

  useEffect(() => {
    const projectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
    const base = String(getCompanionLocalBaseUrl() || '').trim();
    if (!companionStoryboardFrameHydrateKey || !projectId || !base) return;
    let cancelled = false;
    void (async () => {
      const tasks = listStoryboardFrameCompanionHydrateTasks(assetsRef.current);
      const { hydrated, failures } = await hydrateStoryboardFrameCompanionTasks(
        tasks,
        base,
        projectId
      );
      if (cancelled) {
        revokeStoryboardFrameCompanionHydrateUrls(hydrated);
        return;
      }
      for (const failure of failures) {
        const task = failure.task;
        onLogRef.current?.(
          'warn',
          '分镜图伴侣恢复失败',
          `${task.assetId}/${'rowId' in task ? task.rowId : ''}: ${failure.error}`
        );
      }
      if (!hydrated.length) return;
      setAssets((prev) => applyStoryboardFrameCompanionHydrateResults(prev, hydrated));
    })();
    return () => {
      cancelled = true;
    };
  }, [companionStoryboardFrameHydrateKey, workspaceProjectChrome?.activeProjectId, setAssets]);

  useEffect(() => {
    const projectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
    const base = String(getCompanionLocalBaseUrl() || '').trim();
    if (!companionStoryboardFrameHistoryHydrateKey || !projectId || !base) return;
    let cancelled = false;
    void (async () => {
      const tasks = listStoryboardFrameHistoryCompanionHydrateTasks(assetsRef.current);
      const { hydrated, failures } = await hydrateStoryboardFrameHistoryCompanionTasks(
        tasks,
        base,
        projectId
      );
      if (cancelled) {
        revokeStoryboardFrameCompanionHydrateUrls(hydrated);
        return;
      }
      for (const failure of failures) {
        const task = failure.task;
        onLogRef.current?.(
          'warn',
          '分镜历史图伴侣恢复失败',
          `${task.assetId}/${'rowId' in task ? task.rowId : ''}/${'versionId' in task ? task.versionId : ''}: ${failure.error}`
        );
      }
      if (!hydrated.length) return;
      setAssets((prev) => applyStoryboardFrameHistoryCompanionHydrateResults(prev, hydrated));
    })();
    return () => {
      cancelled = true;
    };
  }, [companionStoryboardFrameHistoryHydrateKey, workspaceProjectChrome?.activeProjectId, setAssets]);

  useEffect(() => {
    const projectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
    const base = String(getCompanionLocalBaseUrl() || '').trim();
    if (!companionStoryboardNamedAssetHydrateKey || !projectId || !base) return;
    let cancelled = false;
    void (async () => {
      const tasks = listStoryboardNamedAssetCompanionHydrateTasks(assetsRef.current);
      const { hydrated, failures } = await hydrateStoryboardNamedAssetCompanionTasks(
        tasks,
        base,
        projectId
      );
      if (cancelled) {
        revokeStoryboardFrameCompanionHydrateUrls(hydrated);
        return;
      }
      for (const failure of failures) {
        const task = failure.task;
        onLogRef.current?.(
          'warn',
          '角色/场景资产图伴侣恢复失败',
          `${task.tableAssetId}/${task.kind}/${task.namedAssetId}: ${failure.error}`
        );
      }
      if (!hydrated.length) return;
      setAssets((prev) => applyStoryboardNamedAssetCompanionHydrateResults(prev, hydrated));
    })();
    return () => {
      cancelled = true;
    };
  }, [companionStoryboardNamedAssetHydrateKey, workspaceProjectChrome?.activeProjectId, setAssets]);

  useEffect(() => {
    const projectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
    const base = String(getCompanionLocalBaseUrl() || '').trim();
    if (!companionModelHydrateKey || !projectId || !base) return;
    const targets = assetsRef.current.filter(workflowAssetNeedsCompanionModelHydrate);
    if (targets.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const a of targets) {
        const { nextAsset, revokeBlobUrls } = await hydrateWorkflowAsset3dModelsFromCompanion({
          asset: a,
          baseUrl: base,
          projectId,
          onLog: (level, message, detail) => onLogRef.current?.(level, message, detail),
        });
        if (cancelled) return;
        if (nextAsset === a) continue;
        setAssets((prev) => prev.map((x) => (x.id === a.id ? nextAsset : x)));
        queueMicrotask(() => {
          for (const u of revokeBlobUrls) {
            revokeWorkflowModelBlobUrlsIfOrphaned(u, assetsRef.current);
          }
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companionModelHydrateKey, workspaceProjectChrome?.activeProjectId, setAssets]);

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
          const metaL = a.resultMeta?.[dk]?.displayStepLabel?.trim();
          if (metaL) return metaL;
          const baseId = stripResultKeyToBaseActionId(dk);
          return getModule(baseId)?.label ?? baseId;
        }
      }
      return '文字';
    }
    if (resolveWorkflowStepModelUrls(a, a.displayKey).length > 0) return '3D 模型';
    if (a.displayKey === 'original') return '原始';
    if (a.displayKey === 'cut_image') return '切割';
    const dk = a.displayKey;
    const metaL = a.resultMeta?.[dk]?.displayStepLabel?.trim();
    if (metaL) return metaL;
    const baseId = stripResultKeyToBaseActionId(dk);
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
  const buildPendingTaskFromAssetSnapshot = useCallback(
    (
      asset: WorkflowAsset,
      targetAssetId: string,
      actionType: string,
      options?: WorkflowPendingTaskOptions
    ): WorkflowPendingTask | null => {
      if (isWorkflowStoryboardTableAsset(asset)) {
        onLog?.('warn', '分镜表不支持拖入能力队列');
        return null;
      }
      const mod =
        actionModules.find((m) => m.id === actionType) ??
        capabilityPresets.find((p) => p.id === actionType) ??
        getQuickComposePlainModule(actionType);
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
        (isWorkflowTextAsset(asset) && workflowAssetCurrentDisplayIsTextChannel(asset)
          ? workflowAssetToInputText(asset)
          : undefined);
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
        ...(options?.overrideImageModelRegistryId || options?.overrideImageGear
          ? {
              overrideImageModelRegistryId: coerceImageModelRegistryId(
                options.overrideImageModelRegistryId ?? options.overrideImageGear
              ),
            }
          : {}),
        ...(options?.overrideTextModelRegistryId
          ? {
              overrideTextModelRegistryId: coerceTextModelRegistryId(options.overrideTextModelRegistryId),
            }
          : {}),
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
        ...(options?.logContext ? { logContext: options.logContext } : {}),
        ...(options?.tripoMultiviewImages ? { tripoMultiviewImages: options.tripoMultiviewImages } : {}),
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
    setAssets((prev) => {
      const parentGroup = groupFilterId ? prev.find((a) => a.id === groupFilterId) : null;
      const newAsset = attachInitialVgpToNewAsset({
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
        ...(parentGroup ? { groupId: parentGroup.id } : {}),
      });
      if (!parentGroup) {
        return [...prev, newAsset];
      }
      return prev
        .map((a) => {
          if (a.id === parentGroup.id) {
            return { ...a, assetIds: [...(a.assetIds ?? []), id] };
          }
          return a;
        })
        .concat(newAsset);
    });
    onLog?.('info', raw ? '已粘贴为文字资产' : '已添加文字资产');
  }, [groupFilterId, onLog, setAssets]);

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
  ): Promise<{
    image: string | null;
    text?: string;
    videoUrl?: string;
    videoMime?: string;
    vgpSteps?: VgpGenStepCapture[];
  }> => {
    const { actionType, inputImage, inputText } = task;
    const auditRunFail = (code: string, level: 'warn' | 'error', message: string, detail?: Record<string, unknown>) => {
      appendWorkflowRunTaskFailureAudit({ task, code, level, message, detail });
    };
    const prefetched = String(task.clientPrefetchedImageResult || '').trim();
    if (prefetched) {
      setAssetError(task.assetId, null);
      return { image: prefetched };
    }
    let resolvedInputImage = String(inputImage ?? '').trim();
    let resolvedInputImagesForExecute: string[] | undefined;
    let resolvedTripoMultiviewImages: WorkflowPendingTask['tripoMultiviewImages'] | undefined;

    if (task.lightboxAwaitClientResult) {
      const box = lightboxClientImageDeferredRef.current.get(task.id);
      if (!box) {
        const msg = `[${getTaskLogLabel(task)}] 大图提交状态异常（请重试）`;
        onLog?.('warn', msg);
        setAssetError(task.assetId, msg);
        auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_LIGHTBOX_DEFERRED_MISSING, 'warn', msg);
        return { image: null };
      }
      try {
        const img = await box.promise;
        const s = String(img ?? '').trim();
        if (!s) {
          const msg = `[${getTaskLogLabel(task)}] 未能取得大图预览合成底图（请重试）`;
          onLog?.('warn', msg);
          setAssetError(task.assetId, msg);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_LIGHTBOX_COMPOSITE_EMPTY, 'warn', msg);
          return { image: null };
        }
        setAssetError(task.assetId, null);
        if (box.skipCapabilityExecute) {
          return { image: s };
        }
        /** 客户端合成 = 当前预览所见（含标注烘焙等），作为图生图输入，后续仍走 `executeCapability` */
        resolvedInputImage = s;
        if (box.inputImagesForExecute && box.inputImagesForExecute.length > 0) {
          resolvedInputImagesForExecute =
            box.inputImagesForExecute.length >= 2 ? box.inputImagesForExecute : undefined;
          if (resolvedInputImagesForExecute?.length) {
            resolvedInputImage = resolvedInputImagesForExecute[0]!;
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : safeUnknownToString(err);
        const full = `[${getTaskLogLabel(task)}] ${msg}`;
        onLog?.('warn', full);
        setAssetError(task.assetId, full);
        auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_LIGHTBOX_COMPOSITE_EXCEPTION, 'warn', full, {
          error: msg,
        });
        return { image: null };
      } finally {
        lightboxClientImageDeferredRef.current.delete(task.id);
      }
    }
    if (task.tripoMultiviewImages) {
      const companionProjectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
      const companionBaseUrl = String(getCompanionLocalBaseUrl() || '').trim();
      const assetForInput = assetsRef.current.find((a) => a.id === task.assetId) ?? null;
      const nextSlots: WorkflowPendingTask['tripoMultiviewImages'] = {};
      for (const slot of TRIPO_MULTIVIEW_SLOTS) {
        const raw = String(task.tripoMultiviewImages[slot.key] || '').trim();
        if (!raw) continue;
        const resolvedImg = await resolveCapabilityInputImageForExecute({
          inputImage: raw,
          asset: assetForInput,
          sourceDisplayKey: task.inputSourceDisplayKey,
          companionBaseUrl,
          companionProjectId,
        });
        if (resolvedImg.ok === false) {
          const msg = `[${getTaskLogLabel(task)}] ${slot.label}图：${resolvedImg.error}`;
          onLog?.('warn', msg);
          setAssetError(task.assetId, msg);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_INPUT_IMAGE_RESOLVE, 'warn', msg, { slot: slot.key });
          return { image: null };
        }
        nextSlots[slot.key] = resolvedImg.dataUrl;
      }
      resolvedTripoMultiviewImages = nextSlots;
      if (nextSlots.front) resolvedInputImage = nextSlots.front;
    }

    if (task.inputImages && task.inputImages.length > 0) {
      const companionProjectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
      const companionBaseUrl = String(getCompanionLocalBaseUrl() || '').trim();
      const assetForInput = assetsRef.current.find((a) => a.id === task.assetId) ?? null;
      const out: string[] = [];
      for (const raw of task.inputImages) {
        const trimmed = String(raw || '').trim();
        if (!trimmed) continue;
        const resolvedImg = await resolveCapabilityInputImageForExecute({
          inputImage: trimmed,
          asset: assetForInput,
          sourceDisplayKey: task.inputSourceDisplayKey,
          companionBaseUrl,
          companionProjectId,
        });
        if (resolvedImg.ok === false) {
          const al = getTaskLogLabel(task);
          const msg = `[${al}] ${resolvedImg.error}`;
          onLog?.('warn', msg);
          setAssetError(task.assetId, msg);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_INPUT_IMAGE_RESOLVE, 'warn', msg, {
            inputIndex: task.inputImages!.indexOf(raw),
          });
          return { image: null };
        }
        out.push(resolvedImg.dataUrl);
      }
      if (out.length > 0) {
        resolvedInputImage = out[0]!;
        resolvedInputImagesForExecute = out.length >= 2 ? out : undefined;
      }
    } else {
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
          const al = getTaskLogLabel(task);
          const msg = `[${al}] ${resolvedImg.error}`;
          onLog?.('warn', msg);
          setAssetError(task.assetId, msg);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_INPUT_IMAGE_RESOLVE, 'warn', msg);
          return { image: null };
        }
        resolvedInputImage = resolvedImg.dataUrl;
      }
    }

    const module = getModule(actionType);
    const runTaskBranch = classifyWorkflowRunTaskBranch({ actionType, module });
    const actionLabel = getTaskLogLabel(task);

    switch (runTaskBranch) {
      case 'branch_capability_set': {
        const set = getSet(actionType.slice(SET_ACTION_PREFIX.length));
        if (!set) {
          const msg = `[${getActionLabel(actionType)}] 能力集合不存在`;
          onLog?.('warn', msg);
          setAssetError(task.assetId, msg);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_CAPABILITY_SET_NOT_FOUND, 'warn', msg);
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
          try {
            const result = await executeCapabilitySet(set, resolvedInputImage ?? '', {
              presets: actionModules,
              textModelRegistryId: capabilityTextModel,
              companionProjectId: workspaceProjectChrome?.activeProjectId?.trim() || undefined,
              workflowAssetId: task.assetId,
              workflowSourceDisplayKey: task.inputSourceDisplayKey,
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
              auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_CAPABILITY_SET_REJECTED, 'warn', msg, {
                error: result.error,
              });
              return { image: null };
            }
            setAssetError(task.assetId, null);
            if (result.kind === 'text') {
              return { image: null, text: result.text };
            }
            if (result.kind === 'video') {
              return { image: null, videoUrl: result.videoUrl, videoMime: result.mimeType, vgpSteps: result.vgpSteps };
            }
            return result.kind === 'image'
              ? { image: result.image, vgpSteps: result.vgpSteps }
              : { image: null };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : safeUnknownToString(err);
            const full = `[${getActionLabel(actionType)}] 能力集合执行异常：${msg}`;
            onLog?.('error', full, msg);
            setAssetError(task.assetId, full);
            auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_CAPABILITY_SET_EXCEPTION, 'error', full, { error: msg });
            return { image: null };
          }
        } finally {
          clearSetRunUi();
        }
      }
      case 'branch_generate_3d': {
        if (!module) {
          const fallbackMsg = `[${actionLabel}] 未能获得结果（请重试或检查配置）`;
          setAssetError(task.assetId, fallbackMsg);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_MODULE_NOT_CONFIGURED, 'warn', fallbackMsg);
          return { image: null };
        }
        if (!onAddGenerate3DJob) {
          const msg = '未配置 3D 执行器，无法提交生成3D任务';
          onLog?.('warn', msg);
          setAssetError(task.assetId, msg);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_GENERATE3D_NOT_CONFIGURED, 'warn', msg);
          return { image: null };
        }
        if (!resolvedInputImage?.trim()) {
          const msg = '生成3D 需要图片输入';
          onLog?.('warn', msg);
          setAssetError(task.assetId, msg);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_GENERATE3D_NO_INPUT, 'warn', msg);
          return { image: null };
        }
        try {
          setAssets((prev) =>
            prev.map((a) => {
              if (a.id !== task.assetId) return a;
              const key = task.actionType;
              const hasOrder = (a.resultOrder || []).includes(key);
              const old = a.resultMeta?.[key];
              return {
                ...a,
                resultOrder: hasOrder ? a.resultOrder : [...(a.resultOrder || []), key],
                resultMeta: {
                  ...(a.resultMeta || {}),
                  [key]: {
                    executedAt: Date.now(),
                    ...(old || {}),
                    ...(task.displayStepLabel ? { displayStepLabel: task.displayStepLabel } : {}),
                    ...buildWorkflowStepResultMetaInputSnapshots(task, null),
                    presetActionIdSnapshot: baseActionId(task.actionType),
                    mediaKind: 'model3d' as const,
                  },
                },
              };
            })
          );
          await onAddGenerate3DJob(module, resolvedInputImage, task, resolvedTripoMultiviewImages);
          setAssetError(task.assetId, null);
        } catch (err) {
          const msg = err instanceof Error ? err.message : safeUnknownToString(err);
          const full = `[${getTaskLogLabel(task)}] ${msg}`;
          onLog?.('error', full);
          setAssetError(task.assetId, full);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_GENERATE3D_EXCEPTION, 'error', full, { error: msg });
        }
        return { image: null };
      }
      case 'branch_preset_execute_capability': {
        if (!module) {
          const fallbackMsg = `[${actionLabel}] 未能获得结果（请重试或检查配置）`;
          setAssetError(task.assetId, fallbackMsg);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_PRESET_MODULE_MISSING, 'warn', fallbackMsg, {
            actionType,
          });
          return { image: null };
        }
        try {
          const presetBase =
            task.promptOverride != null && task.promptOverride.trim() !== ''
              ? { ...module, instruction: task.promptOverride.trim() }
              : module;
          const preset = {
            ...presetBase,
            ...(task.logContext === 'quick_compose_bar_plain'
              ? { label: WORKFLOW_QUICK_COMPOSE_PLAIN_LOG_LABEL }
              : {}),
            ...(task.overrideImageModelRegistryId || task.overrideImageGear
              ? {
                  imageModelRegistryId: coerceImageModelRegistryId(
                    task.overrideImageModelRegistryId ?? task.overrideImageGear
                  ),
                }
              : {}),
            ...(task.overrideTextModelRegistryId
              ? { textModelRegistryId: coerceTextModelRegistryId(task.overrideTextModelRegistryId) }
              : {}),
            ...(task.overrideImageAspectRatio ? { imageAspectRatio: task.overrideImageAspectRatio } : {}),
            ...(task.overrideImageSize &&
            !(task.displayStepLabel === '局部重绘' && task.lightboxAwaitClientResult)
              ? { imageSize: task.overrideImageSize }
              : {}),
            ...(typeof task.overrideSkipUnderstand === 'boolean'
              ? { skipUnderstand: task.overrideSkipUnderstand }
              : {}),
          };
          const out = await executeCapability(
            preset,
            resolvedInputImage ?? '',
            {
              onLog,
              textModelRegistryId: capabilityTextModel,
              companionProjectId: workspaceProjectChrome?.activeProjectId?.trim() || undefined,
              workflowAssetId: task.assetId,
              workflowSourceDisplayKey: task.inputSourceDisplayKey,
            },
            {
              inputText,
              ...(resolvedInputImagesForExecute ? { inputImages: resolvedInputImagesForExecute } : {}),
              ...(batchGroup ? { batchGroupKey: batchGroup.key, batchGroupExpected: batchGroup.expected } : {}),
            }
          );
          if (out.ok === false) {
            const msg = `[${actionLabel}] ${out.error}`;
            onLog?.('warn', msg);
            setAssetError(task.assetId, msg);
            auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_CAPABILITY_REJECTED, 'warn', msg, { error: out.error });
            return { image: null };
          }
          setAssetError(task.assetId, null);
          if (out.kind === 'text') {
            return { image: null, text: out.text };
          }
          if (out.kind === 'video') {
            return { image: null, videoUrl: out.videoUrl, videoMime: out.mimeType, vgpSteps: out.vgpSteps };
          }
          return { image: out.image, vgpSteps: out.vgpSteps };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : safeUnknownToString(err);
          const full = `[${actionLabel}] 失败：${msg}`;
          onLog?.('error', full, msg);
          setAssetError(task.assetId, full);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_CAPABILITY_EXCEPTION, 'error', full, { error: msg });
          return { image: null };
        }
      }
      case 'branch_cut_image': {
        const m = `[${actionLabel}] 切割任务应由队列专用路径执行，请重试或刷新页面`;
        onLog?.('warn', m);
        setAssetError(task.assetId, m);
        auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_BRANCH_CUT_NO_MODULE, 'warn', m, { actionType });
        return { image: null };
      }
      case 'branch_cut_image_no_module': {
        const m = `[${actionLabel}] 切割能力未就绪`;
        auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_BRANCH_CUT_NO_MODULE, 'warn', m, { actionType });
        return { image: null };
      }
      case 'branch_fallback_error':
      default: {
        const fallbackMsg = `[${actionLabel}] 未能获得结果（请重试或检查配置）`;
        setAssetError(task.assetId, fallbackMsg);
        auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_FALLBACK_UNKNOWN, 'warn', fallbackMsg, {
          branch: runTaskBranch,
        });
        return { image: null };
      }
    }
  }, [
    actionModules,
    capabilityTextModel,
    getActionLabel,
    getTaskLogLabel,
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

  const BASE_MAX_CONCURRENCY = getWorkflowMaxConcurrency();

  const executePending = useCallback(
    async (overridePending?: WorkflowPendingTask[]) => {
      const queue = overridePending ? [...overridePending] : [...pendingRef.current];
      // 允许在 cut_image 弹窗确认后用 overridePending 继续执行剩余任务
      if (queue.length === 0 || (executing && !overridePending)) return;
      const maxInputChars = maxWorkflowPendingInputTextChars(queue);
      if (maxInputChars >= WORKFLOW_TEXT_CONFIRM_CHARS) {
        const ok = window.confirm(
          `队列中有任务含 ${maxInputChars.toLocaleString()} 字正文（建议不超过 ${WORKFLOW_TEXT_CONFIRM_CHARS.toLocaleString()} 字）。继续执行时超出部分将按模型上限截断并优先保留末尾。仍要执行？`
        );
        if (!ok) return;
      } else if (maxInputChars >= WORKFLOW_TEXT_WARN_CHARS) {
        onLog?.(
          'warn',
          `队列最长正文约 ${maxInputChars.toLocaleString()} 字（建议 ≤ ${WORKFLOW_TEXT_WARN_CHARS.toLocaleString()} 字），送模时可能截断`
        );
      }
      // 新一轮批处理前清空已完成任务标记；本批快照已写入 queue，始终清空 pending（含递归续跑），避免完成后仍误判「在队列内」
      setCompletedTaskIds(new Set());
      cancelledTaskIdsRef.current = new Set();
      setPending([]);
      setActiveTaskIds(new Set());
      setExecuting(true);
      setExecutingQueue({ total: queue.length, tasks: [...queue] });
      const workflowMaxConcurrency = getWorkflowMaxConcurrency();
      const imageBatchWorkers = getGeminiImageBatchBoxSizeForCurrentProvider();
      onLog?.(
        'info',
        `开始执行队列（${queue.length} 项，常规并发 ${workflowMaxConcurrency}，生图理解并发 ${imageBatchWorkers}）`
      );
      onLog?.(
        'info',
        '生图/理解走 AI 代理时，右侧日志「AI代理」会显示公平排队、限流重试与是否排队；当前不排队也会提示状态。'
      );

      const total = queue.length;
      const logBatch = `[${total}项·常规≤${workflowMaxConcurrency}/生图理解≤${imageBatchWorkers}]`;

      const processTask = async (
        task: WorkflowPendingTask,
        batchGroup?: { key: string; expected: number }
      ) => {
        const markTaskCompleted = (t: WorkflowPendingTask, opts?: { auditSuccess?: boolean }) => {
          if (opts?.auditSuccess !== false && !cancelledTaskIdsRef.current.has(t.id)) {
            appendWorkflowRunTaskSuccessAudit({ task: t });
          }
          setCompletedTaskIds((prev) => new Set(prev).add(t.id));
        };
        if (cancelledTaskIdsRef.current.has(task.id)) {
          return;
        }
        setActiveTaskIds((prev) => new Set(prev).add(task.id));
        try {
          const taskLabel = getTaskLogLabel(task);

          const cutTaskPreset = getModule(task.actionType);
          const isCutImageTask =
            task.actionType === 'cut_image' || isCutImageCapabilityPreset(cutTaskPreset);
          if (isCutImageTask) {
            let inputImage =
              task.inputImage || assetsRef.current.find((a) => a.id === task.assetId)?.original;
            if (!inputImage || typeof inputImage !== 'string') {
              const msg = `[${taskLabel}] 找不到输入图片，已跳过此任务`;
              onLog?.('warn', msg);
              setAssetError(task.assetId, msg);
              setCompletedTaskIds((prev) => { const next = new Set(prev); next.add(task.id); return next; });
            } else {
              const assetForInput = assetsRef.current.find((a) => a.id === task.assetId) ?? null;
              const inputTrimmed = String(inputImage).trim();
              const resolvedImg = await resolveCapabilityInputImageForExecute({
                inputImage: inputTrimmed,
                asset: assetForInput,
                sourceDisplayKey: task.inputSourceDisplayKey,
                companionBaseUrl: String(getCompanionLocalBaseUrl() || '').trim(),
                companionProjectId: String(workspaceProjectChrome?.activeProjectId || '').trim(),
              });
              if (resolvedImg.ok === false) {
                const msg = `[${taskLabel}] ${resolvedImg.error}`;
                onLog?.('warn', msg);
                setAssetError(task.assetId, msg);
                setCompletedTaskIds((prev) => {
                  const next = new Set(prev);
                  next.add(task.id);
                  return next;
                });
                return;
              }
              inputImage = resolvedImg.dataUrl;
              const cutPreset = cutTaskPreset ?? FALLBACK_CUT_IMAGE_PRESET;
              const cutParams = readCutImageParams(cutPreset);
              onLog?.(
                'info',
                `${logBatch} ${taskLabel} ${
                  cutParams.cutMode === 'uniform'
                    ? '均匀分割中…'
                    : cutParams.cutMode === 'vision'
                      ? '视觉识别并切割中…'
                      : '自动检测分割中…'
                }`
              );
              const { boxes, warn: cutDetectWarn } = await detectCutImageBoxes(inputImage, cutPreset, {
                visionTextModel: capabilityTextModel,
                timeoutMs: WORKFLOW_CUT_DETECT_TIMEOUT_MS,
              });
              if (cutDetectWarn) {
                const full = `[${taskLabel}] ${cutDetectWarn}`;
                onLog?.('warn', full);
                setAssetError(task.assetId, full);
              }
              const cutOverflowPx = cutParams.cutOverflowPx;
              const allIndexes = boxes.map((_, j) => j);
              let cropped = await cropBoxes(inputImage, boxes, allIndexes, cutOverflowPx);
              if (cropped.length === 0 && boxes.length > 0) {
                const msg = `[${taskLabel}] 裁剪失败，尝试整图`;
                onLog?.('warn', msg);
                setAssetError(task.assetId, msg);
                cropped = await cropBoxes(inputImage, [FULL_IMAGE_BOX], [0], cutOverflowPx);
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
                const newCutGroupId = uuid();
                const groupLabel = getRandomGroupCodeName(usedLabels);

                const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
                  id: newCutGroupId,
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

                let next: WorkflowAsset[] = [
                  ...prev.filter((a) => a.id !== task.assetId),
                  ...newAssets.map((a) => ({ ...a, groupId: newCutGroupId, groupLabel, groupOrder: assetIds.indexOf(a.id) })),
                  newGroup,
                ];

                if (task.sourceGroupAssetId != null && task.sourceItemIndex != null) {
                  const gIdx = task.sourceItemIndex;
                  next = next.map((a) => {
                    if (a.id !== task.sourceGroupAssetId || !isGroupAsset(a)) return a;
                    const ids = [...(a.assetIds ?? [])];
                    if (gIdx >= 0 && gIdx < ids.length) ids[gIdx] = newCutGroupId;
                    return { ...a, assetIds: ids };
                  });
                }

                revokeWorkflowModelBlobUrlsAfterAssetRemoved(taskAsset, next);
                return next;
              });

              onLog?.('info', `${logBatch} ${taskLabel} 完成（${cropped.length} 张入组）`);
              markTaskCompleted(task);
            }
          } else {
            onLog?.('info', `${logBatch} ${taskLabel} 执行中…`);
            const { image: result, text: textResult, videoUrl: videoResultUrl, vgpSteps } = await runTaskRef.current(
              task,
              batchGroup
            );
            const videoUrl = videoResultUrl != null && String(videoResultUrl).trim() !== '' ? String(videoResultUrl).trim() : null;
            if (textResult != null && textResult !== '') {
              setAssets((prev) =>
                prev.map((a) => {
                  if (a.id !== task.assetId) return a;
                  const baseId = task.actionType;
                  const hasAnyText = Object.keys(a.textResults || {}).some((k) => baseActionId(k) === baseId);
                  const tKey = hasAnyText ? makeVersionKey(baseId) : baseId;
                  const nextOrder = [...(a.resultOrder || []), tKey];
                  const nextMeta = {
                    ...(a.resultMeta || {}),
                    [tKey]: {
                      executedAt: Date.now(),
                      ...(task.displayStepLabel ? { displayStepLabel: task.displayStepLabel } : {}),
                      ...buildWorkflowStepResultMetaInputSnapshots(task, vgpSteps ?? null),
                    },
                  };
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
            } else if (videoUrl) {
              flushSync(() => {
                setAssets((prev) =>
                  prev.map((a) => {
                    if (a.id !== task.assetId) return a;
                    const baseId = task.actionType;
                    const hasAnyVersion =
                      Object.keys(a.results || {}).some((k) => baseActionId(k) === baseId) ||
                      (a.resultOrder || []).some((k) => baseActionId(k) === baseId);
                    const key = hasAnyVersion ? makeVersionKey(baseId) : baseId;
                    const nextResults = { ...a.results, [key]: videoUrl };
                    const nextOrder = [...(a.resultOrder || []), key];
                    const nextMeta = {
                      ...(a.resultMeta || {}),
                      [key]: {
                        executedAt: Date.now(),
                        mediaKind: 'video' as const,
                        ...(task.displayStepLabel ? { displayStepLabel: task.displayStepLabel } : {}),
                        ...buildWorkflowStepResultMetaInputSnapshots(task, vgpSteps ?? null),
                      },
                    };
                    const tagList = buildWorkflowImageTags({
                      actionLabel: getTaskLogLabel(task),
                      actionId: baseActionId(task.actionType),
                      presetInstruction: getModule(task.actionType)?.instruction,
                      promptOverride: task.promptOverride,
                      inputText: task.inputText,
                    });
                    let next: WorkflowAsset = {
                      ...a,
                      results: nextResults,
                      resultOrder: nextOrder,
                      resultMeta: nextMeta,
                      imageTags: { ...(a.imageTags || {}), [key]: tagList },
                      imageTagStage: { ...(a.imageTagStage || {}), [key]: 'coarse' as const },
                      displayKey: key,
                      hiddenInGrid: a.groupId ? a.hiddenInGrid : false,
                    };
                    const hadOverride = task.promptOverride != null && task.promptOverride.trim() !== '';
                    const summaryLabel = getTaskLogLabel(task);
                    next = applyVgpAfterSuccessfulGen(next, {
                      resultKey: key,
                      vgpSteps: vgpSteps ?? [],
                      semanticSummary: hadOverride ? `${summaryLabel}（用户微调）` : summaryLabel,
                      hadPromptOverride: hadOverride,
                      inputSourceDisplayKey: task.inputSourceDisplayKey,
                      userPromptRecord: buildWorkflowTaskUserPromptRecordForMetadata(task, getModule),
                    });
                    return next;
                  })
                );
              });
              markTaskCompleted(task);
            } else {
              const delegatedGenerate3D =
                !result &&
                classifyWorkflowRunTaskBranch({
                  actionType: task.actionType,
                  module: getModule(task.actionType),
                }) === 'branch_generate_3d';
              if (!delegatedGenerate3D) {
              flushSync(() => {
                setAssets((prev) =>
                  prev.map((a) => {
                    if (a.id !== task.assetId) return a;
                    const baseId = task.actionType;
                    const hasAnyVersion =
                      Object.keys(a.results || {}).some((k) => baseActionId(k) === baseId) ||
                      (a.resultOrder || []).some((k) => baseActionId(k) === baseId);
                    const key = result ? (hasAnyVersion ? makeVersionKey(baseId) : baseId) : baseId;
                    const prevStepMeta = a.resultMeta?.[key];
                    const nextResults = result ? { ...a.results, [key]: result } : a.results;
                    const nextOrder = result ? [...(a.resultOrder || []), key] : a.resultOrder || [];
                    const nextMeta = {
                      ...(a.resultMeta || {}),
                      [key]: {
                        ...(prevStepMeta || {}),
                        executedAt: prevStepMeta?.executedAt ?? Date.now(),
                        ...(task.displayStepLabel && !prevStepMeta?.displayStepLabel?.trim()
                          ? { displayStepLabel: task.displayStepLabel }
                          : {}),
                        ...(result ? buildWorkflowStepResultMetaInputSnapshots(task, vgpSteps ?? null) : {}),
                      },
                    };
                    const tagList =
                      result
                        ? buildWorkflowImageTags({
                            actionLabel: getTaskLogLabel(task),
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
                      const summaryLabel = getTaskLogLabel(task);
                      next = applyVgpAfterSuccessfulGen(next, {
                        resultKey: key,
                        vgpSteps: vgpSteps ?? [],
                        semanticSummary: hadOverride ? `${summaryLabel}（用户微调）` : summaryLabel,
                        hadPromptOverride: hadOverride,
                        inputSourceDisplayKey: task.inputSourceDisplayKey,
                        userPromptRecord: buildWorkflowTaskUserPromptRecordForMetadata(task, getModule),
                      });
                    }
                    return next;
                  })
                );
              });
              }
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
              markTaskCompleted(task);
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : safeUnknownToString(e);
          const label = getTaskLogLabel(task);
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
      capabilityTextModel,
      getTaskLogLabel,
      getModule,
      setAssetError,
      scheduleCompanionPersistResult,
      workspaceProjectChrome?.activeProjectId,
    ]
  );

  /** 能力块拖到资产卡：以该卡为唯一输入立即执行（插队），不单独停留在待执行列表 */
  const runCapabilityOnAssetCardImmediate = useCallback(
    (targetAsset: WorkflowAsset, actionType: string) => {
      if (isWorkflowStoryboardTableAsset(targetAsset)) {
        onLog?.('warn', '分镜表请点卡片打开表格编辑');
        return;
      }
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

  const onQuickComposeInputCapabilityDrop = useCallback(
    (presetId: string) => {
      const trimmed = presetId.trim();
      if (!trimmed) return;
      const mod =
        actionModules.find((m) => m.id === trimmed) ?? capabilityPresets.find((p) => p.id === trimmed);
      if (!mod || mod.disabled) {
        onLog?.('warn', '底部快捷栏：拖入的能力无效或已禁用');
        return;
      }
      const eng = getCapabilityEngine(mod);
      const allowed =
        (eng === 'gen_image' || eng === 'gen_text' || (eng === 'builtin' && mod.category === 'image_to_image')) &&
        mod.id !== 'cut_image' &&
        mod.category !== 'generate_3d' &&
        mod.category !== 'generate_video';
      if (!allowed) {
        onLog?.('warn', '底部快捷栏：该能力不支持拖入快捷条，请选用文生图/图生图/文生文等');
        return;
      }
      const ins = String(mod.instruction ?? '').trim();
      setQuickComposePromptCards((prev) => [
        ...prev,
        { key: uuid(), presetId: trimmed, label: mod.label, instruction: ins },
      ]);
      onLog?.('info', `底部快捷栏：已加入「${mod.label}」提示词卡片，可与输入框说明一并入队`);
    },
    [actionModules, capabilityPresets, onLog]
  );

  type QuickComposeSubmitInvokeOptions = {
    overrideImageDataUrls?: string[];
    overrideUserText?: string;
    /** 带参考图时即使底部为「文」也走图/3D 链路（大图预览提交） */
    preferImagePipelineWhenImagesAttached?: boolean;
    /** 为 true 时不重置底部快捷栏文案与附图 */
    preserveBottomBarDraft?: boolean;
    /** 忽略底部拖入的预设卡片，只走「文/图/3D」内置逻辑（大图预览） */
    skipPromptCards?: boolean;
    /** 大图预览等：任务挂在该已有图片资产上，不新建隐藏卡片 */
    reuseAssetId?: string;
  };

  const submitQuickCompose = useCallback((invoke?: QuickComposeSubmitInvokeOptions) => {
    const resolved = resolveQuickComposeReferences({
      segments: quickComposeSegmentsRef.current,
      assets: assetsRef.current,
      getAssetDisplayImage,
      maxRefs: getQuickComposeMaxRefs(),
    });
    for (const w of resolved.warnings) {
      onLog?.('warn', `底部快捷栏：${w}`);
    }
    const promptText = buildQuickComposePromptOverride(resolved.userPrompt, resolved.referenceContextBlock);
    const userText = (
      invoke?.overrideUserText !== undefined ? invoke.overrideUserText.trim() : promptText
    ).trim();
    const imgsAll = (
      invoke?.overrideImageDataUrls !== undefined ? invoke.overrideImageDataUrls : resolved.refs
    ).filter((s) => String(s).trim());
    const composeMode =
      invoke?.preferImagePipelineWhenImagesAttached && imgsAll.length > 0 && quickComposeMode === 'text'
        ? 'image'
        : imgsAll.length > 0 && quickComposeMode === 'text'
          ? 'image'
          : quickComposeMode;

    const resolveQuickComposeMod = (presetId: string) =>
      actionModules.find((m) => m.id === presetId) ?? capabilityPresets.find((p) => p.id === presetId) ?? null;

    const buildQuickComposeGenOverrides = (m: CustomAppModule): WorkflowPendingTaskOptions => {
      const o: WorkflowPendingTaskOptions = {};
      const eng = getCapabilityEngine(m);
      if (eng === 'gen_image') {
        o.overrideImageModelRegistryId = coerceImageModelRegistryId(quickComposeImageModel);
        if (quickComposeAspect && quickComposeAspect !== 'adaptive') {
          o.overrideImageAspectRatio = quickComposeAspect;
        }
        if (quickComposeSize === '1K' || quickComposeSize === '2K' || quickComposeSize === '4K') {
          o.overrideImageSize = quickComposeSize;
        }
        if (quickComposeUnderstand) {
          o.overrideSkipUnderstand = overrideSkipUnderstandFromUnderstandEnabled(true);
        }
      }
      if (
        (eng === 'gen_text' || m.category === 'text_to_text' || m.category === 'image_to_text') &&
        quickComposeMode === 'text'
      ) {
        o.overrideTextModelRegistryId = coerceTextModelRegistryId(quickComposeTextModel);
      }
      return o;
    };

    const quickComposeCountForMod = (m: CustomAppModule) => {
      const eng = getCapabilityEngine(m);
      const applicable = eng === 'gen_image' || m.category === 'text_to_image' || m.category === 'text_to_text';
      return applicable ? normalizeWorkflowGenerateCount(quickComposeCount) : 1;
    };

    /** 多张预设卡片：每张单独入队（各自 presetId + instruction；输入框文案拼到每一条） */
    if (quickComposePromptCards.length > 0 && !invoke?.skipPromptCards) {
      const cardRows: Array<{ card: WorkspaceQuickComposePromptCard; mod: CustomAppModule }> = [];
      for (const card of quickComposePromptCards) {
        const m = resolveQuickComposeMod(card.presetId);
        if (!m || m.disabled) {
          onLog?.('warn', `底部快捷栏：跳过无效预设「${card.label}」(${card.presetId})`);
          continue;
        }
        cardRows.push({ card, mod: m });
      }
      if (cardRows.length === 0) {
        onLog?.('warn', '底部快捷栏：没有可用的预设卡片可执行');
        return;
      }

      let totalPlanned = 0;
      for (const { mod: m } of cardRows) {
        totalPlanned += quickComposeCountForMod(m);
      }
      if (
        totalPlanned > WORKFLOW_GROUP_GENERATE_CONFIRM_THRESHOLD &&
        typeof window !== 'undefined' &&
        !window.confirm(`将创建 ${totalPlanned} 条队列任务，是否继续？`)
      ) {
        return;
      }

      const newAssets: WorkflowAsset[] = [];
      const newTasks: WorkflowPendingTask[] = [];

      for (const { card, mod: m } of cardRows) {
        const ins = String(card.instruction ?? '').trim();
        const pieceText = [ins, userText].filter(Boolean).join('\n\n').trim();
        const maxRef = maxReferenceImagesForImageModel(m.imageModelRegistryId ?? m.imageGear);
        const imgs = imgsAll.slice(0, maxRef);
        const countN = quickComposeCountForMod(m);
        const taskOverrides = buildQuickComposeGenOverrides(m);

        if (!pieceText && imgs.length === 0) {
          onLog?.('warn', `底部快捷栏：跳过「${m.label}」（无提示词且无参考图）`);
          continue;
        }

        if (imgs.length > 0) {
          const first = imgs[0]!;
          const probe = attachInitialVgpToNewAsset({
            id: '__qc_probe__',
            original: first,
            displayKey: 'original',
            results: {},
            resultOrder: [],
            archived: false,
            hiddenInGrid: true,
            createdAt: Date.now(),
          });
          if (!workflowAssetAllowedForCapabilityDrop(probe, m)) {
            onLog?.('warn', `底部快捷栏：跳过「${m.label}」（参考图与该能力不匹配）`);
            continue;
          }
          for (let i = 0; i < countN; i += 1) {
            const newId = uuid();
            newAssets.push(
              attachInitialVgpToNewAsset({
                id: newId,
                original: first,
                displayKey: 'original',
                results: {},
                resultOrder: [],
                archived: false,
                hiddenInGrid: true,
                createdAt: Date.now(),
              })
            );
            newTasks.push({
              id: uuid(),
              assetId: newId,
              actionType: m.id,
              inputImage: first,
              addedAt: Date.now(),
              inputSourceDisplayKey: 'original',
              ...(imgs.length >= 2 ? { inputImages: imgs } : {}),
              ...(pieceText ? { promptOverride: pieceText } : {}),
              ...taskOverrides,
            });
          }
        } else {
          if (!workflowPresetAcceptsTextCardDrag(m)) {
            onLog?.('warn', `底部快捷栏：跳过「${m.label}」（纯文字模式不支持）`);
            continue;
          }
          const body = clampWorkflowTextBody(pieceText);
          if (!body.trim()) {
            onLog?.('warn', `底部快捷栏：跳过「${m.label}」（无有效正文）`);
            continue;
          }
          for (let i = 0; i < countN; i += 1) {
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
            newAssets.push(asset);
            const task = buildPendingTaskFromAssetSnapshot(asset, newId, m.id, taskOverrides);
            if (task) newTasks.push(task);
          }
        }
      }

      if (newTasks.length === 0) {
        onLog?.('warn', '底部快捷栏：未能创建任何任务（请检查能力与提示词）');
        return;
      }
      setAssets((prev) => [...prev, ...newAssets]);
      if (executing) {
        setPending((prev) => [...prev, ...newTasks]);
      } else {
        void executePending([...newTasks, ...pendingRef.current]);
      }
      if (!invoke?.preserveBottomBarDraft) {
        setQuickComposeSegmentsTracked([newQuickComposeTextSegment('')]);
        setQuickComposeDropSlots([]);
      }
      setQuickComposePromptCards([]);
      onLog?.('info', `底部快捷栏：已加入 ${newTasks.length} 条执行队列`);
      return;
    }

    /** 无拖入预设：按快捷条「文 / 图 / 3D」内置逻辑，不读侧栏默认能力或「上次预设」 */
    const plainLog: WorkflowPendingTask['logContext'] = 'quick_compose_bar_plain';
    const plainText = userText;

    const runPlainBatch = (newAssets: WorkflowAsset[], newTasks: WorkflowPendingTask[]) => {
      if (newTasks.length === 0) {
        onLog?.('warn', '底部快捷栏：无法创建任务');
        return;
      }
      setAssets((prev) => [...prev, ...newAssets]);
      if (executing) {
        setPending((prev) => [...prev, ...newTasks]);
      } else {
        void executePending([...newTasks, ...pendingRef.current]);
      }
      if (!invoke?.preserveBottomBarDraft) {
        setQuickComposeSegmentsTracked([newQuickComposeTextSegment('')]);
        setQuickComposeDropSlots([]);
      }
      setQuickComposePromptCards([]);
      onLog?.('info', '底部快捷栏：已加入执行队列');
    };

    if (composeMode === 'text') {
      if (imgsAll.length > 0) {
        onLog?.('warn', '底部快捷栏：「文」模式请以 @ 引用文字资产，或切换到「图」');
        return;
      }
      if (!plainText) {
        onLog?.('warn', '底部快捷栏：请输入文字');
        return;
      }
      const plainMod = getQuickComposePlainModule(QUICK_COMPOSE_PLAIN_TEXT_ACTION_ID)!;
      const taskOverrides = buildQuickComposeGenOverrides(plainMod);
      const countN = quickComposeCountForMod(plainMod);
      if (
        countN > WORKFLOW_GROUP_GENERATE_CONFIRM_THRESHOLD &&
        typeof window !== 'undefined' &&
        !window.confirm(`当前生成数量为 ${countN}，将创建大量任务，是否继续？`)
      ) {
        return;
      }
      const body = clampWorkflowTextBody(plainText);
      const newAssets: WorkflowAsset[] = [];
      const newTasks: WorkflowPendingTask[] = [];
      for (let i = 0; i < countN; i += 1) {
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
        newAssets.push(asset);
        const task = buildPendingTaskFromAssetSnapshot(asset, newId, QUICK_COMPOSE_PLAIN_TEXT_ACTION_ID, {
          ...taskOverrides,
          logContext: plainLog,
        });
        if (task) newTasks.push(task);
      }
      runPlainBatch(newAssets, newTasks);
      return;
    }

    if (composeMode === '3d') {
      const mod3d =
        actionModules.find((m) => m.category === 'generate_3d' && m.enabled !== false) ??
        capabilityPresets.find((m) => m.category === 'generate_3d' && m.enabled !== false) ??
        null;
      if (!mod3d) {
        onLog?.('warn', '底部快捷栏：未找到已启用的「生成3D」能力，请先在能力区添加并启用');
        return;
      }
      if (imgsAll.length === 0) {
        onLog?.('warn', '底部快捷栏：生成 3D 请 @ 引用图片资产');
        return;
      }
      const first = imgsAll[0]!;
      const taskOverrides = buildQuickComposeGenOverrides(mod3d);
      const newId = uuid();
      const newAsset = attachInitialVgpToNewAsset({
        id: newId,
        original: first,
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
        actionType: mod3d.id,
        inputImage: first,
        addedAt: Date.now(),
        inputSourceDisplayKey: 'original',
        ...(plainText ? { promptOverride: plainText } : {}),
        ...taskOverrides,
        logContext: plainLog,
      };
      runPlainBatch([newAsset], [newTask]);
      return;
    }

    /* composeMode === 'image' */
    const plainImageId = imgsAll.length > 0 ? QUICK_COMPOSE_PLAIN_I2I_ACTION_ID : QUICK_COMPOSE_PLAIN_T2I_ACTION_ID;
    const plainImgMod = getQuickComposePlainModule(plainImageId)!;
    const taskOverrides = buildQuickComposeGenOverrides(plainImgMod);
    const countN = quickComposeCountForMod(plainImgMod);
    if (
      countN > WORKFLOW_GROUP_GENERATE_CONFIRM_THRESHOLD &&
      typeof window !== 'undefined' &&
      !window.confirm(`当前生成数量为 ${countN}，将创建大量任务，是否继续？`)
    ) {
      return;
    }

    if (imgsAll.length === 0) {
      if (!plainText) {
        onLog?.('warn', '底部快捷栏：文生图请输入画面描述');
        return;
      }
      const body = clampWorkflowTextBody(plainText);
      const newAssets: WorkflowAsset[] = [];
      const newTasks: WorkflowPendingTask[] = [];
      for (let i = 0; i < countN; i += 1) {
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
        newAssets.push(asset);
        const task = buildPendingTaskFromAssetSnapshot(asset, newId, QUICK_COMPOSE_PLAIN_T2I_ACTION_ID, {
          ...taskOverrides,
          logContext: plainLog,
        });
        if (task) newTasks.push(task);
      }
      runPlainBatch(newAssets, newTasks);
      return;
    }

    const maxRef = maxReferenceImagesForImageModel(plainImgMod.imageModelRegistryId ?? plainImgMod.imageGear);
    const imgs = imgsAll.slice(0, maxRef);
    const first = imgs[0]!;
    const reuseId = invoke?.reuseAssetId?.trim();
    if (reuseId) {
      const exist = assetsRef.current.find((a) => a.id === reuseId);
      if (!exist || !assetLightboxRasterEligible(exist)) {
        onLog?.('warn', '底部快捷栏：无法将任务挂到指定资产');
        return;
      }
      const newTasks: WorkflowPendingTask[] = [];
      for (let i = 0; i < countN; i += 1) {
        newTasks.push({
          id: uuid(),
          assetId: reuseId,
          actionType: QUICK_COMPOSE_PLAIN_I2I_ACTION_ID,
          inputImage: first,
          addedAt: Date.now(),
          inputSourceDisplayKey: exist.displayKey,
          ...(imgs.length >= 2 ? { inputImages: imgs } : {}),
          ...(plainText ? { promptOverride: plainText } : {}),
          ...taskOverrides,
          logContext: plainLog,
        });
      }
      if (executing) {
        setPending((prev) => [...prev, ...newTasks]);
      } else {
        void executePending([...newTasks, ...pendingRef.current]);
      }
      if (!invoke?.preserveBottomBarDraft) {
        setQuickComposeSegmentsTracked([newQuickComposeTextSegment('')]);
        setQuickComposeDropSlots([]);
      }
      setQuickComposePromptCards([]);
      onLog?.('info', '底部快捷栏：已加入执行队列');
      return;
    }
    const newAssets: WorkflowAsset[] = [];
    const newTasks: WorkflowPendingTask[] = [];
    for (let i = 0; i < countN; i += 1) {
      const newId = uuid();
      newAssets.push(
        attachInitialVgpToNewAsset({
          id: newId,
          original: first,
          displayKey: 'original',
          results: {},
          resultOrder: [],
          archived: false,
          hiddenInGrid: true,
          createdAt: Date.now(),
        })
      );
      newTasks.push({
        id: uuid(),
        assetId: newId,
        actionType: QUICK_COMPOSE_PLAIN_I2I_ACTION_ID,
        inputImage: first,
        addedAt: Date.now(),
        inputSourceDisplayKey: 'original',
        ...(imgs.length >= 2 ? { inputImages: imgs } : {}),
        ...(plainText ? { promptOverride: plainText } : {}),
        ...taskOverrides,
        logContext: plainLog,
      });
    }
    runPlainBatch(newAssets, newTasks);
  }, [
    quickComposeMode,
    quickComposePromptCards,
    getQuickComposeMaxRefs,
    getAssetDisplayImage,
    quickComposeImageModel,
    quickComposeTextModel,
    quickComposeAspect,
    quickComposeSize,
    quickComposeCount,
    quickComposeUnderstand,
    actionModules,
    capabilityPresets,
    onLog,
    setAssets,
    setPending,
    executing,
    executePending,
    buildPendingTaskFromAssetSnapshot,
  ]);

  const submitLightboxQuickCompose = useCallback(() => {
    const id = lightboxAssetIdRef.current;
    const asset = assetsRef.current.find((a) => a.id === id);
    if (!asset || !assetLightboxRasterEligible(asset)) {
      onLog?.('warn', '大图预览：当前无可提交的图像');
      return;
    }
    const src = getLightboxPreviewImageSrc(asset).trim();
    if (!src) {
      onLog?.('warn', '大图预览：当前无可提交的图像');
      return;
    }

    const doc = lightboxOverlayDraftRef.current;
    const localEditSnapshot = doc.localEdit ?? null;
    const panoLocalVp = doc.panoLocalEditViewport ?? null;
    const panoLocalEquirect = doc.panoLocalEditEquirect ?? null;
    const panoLocalReproject = doc.panoLocalEditReproject ?? null;
    const needsPanoLocalCapture =
      Boolean(panoLocalVp) || Boolean(panoLocalEquirect && panoLocalEquirect.length >= 3);
    const itemsSnapshot = doc.items;
    const hadLocalInpaint = Boolean(localEditSnapshot || needsPanoLocalCapture);
    const segmentsSnap = [...quickComposeSegmentsRef.current];
    const partialResolved = resolveQuickComposeReferences({
      segments: segmentsSnap,
      assets: assetsRef.current,
      getAssetDisplayImage,
      maxRefs: getQuickComposeMaxRefs(),
    });
    for (const w of partialResolved.warnings) {
      onLog?.('warn', `大图预览：${w}`);
    }
    const promptOverride = buildQuickComposePromptOverride(
      partialResolved.userPrompt,
      partialResolved.referenceContextBlock
    );
    const hasCurrentView = segmentsSnap.some((s) => s.type === 'mention' && s.mention.kind === 'current_view');

    if (
      !hasCurrentView &&
      partialResolved.refs.length > 0 &&
      !needsPanoLocalCapture &&
      !localEditSnapshot
    ) {
      submitQuickCompose({
        reuseAssetId: asset.id,
        overrideUserText: promptOverride,
        skipPromptCards: true,
      });
      return;
    }

    /** 先同步清 UI，再立即入队，节点树才能马上进入「执行中」 */
    const nextOverlayForPersist = normalizeImageOverlayDoc({
      ...doc,
      localEdit: null,
      panoLocalEditViewport: null,
      panoLocalEditEquirect: null,
      panoLocalEditReproject: null,
    });
    const persistBucket = lightboxOverlayActiveBucketRef.current;
    flushSync(() => {
      setLightboxOverlayByMode((prev) => ({ ...prev, [persistBucket]: nextOverlayForPersist }));
      setLightboxQuickComposeAnchor(null);
      setLightboxQuickComposeLayoutNonce((n) => n + 1);
      setQuickComposeSegmentsTracked([newQuickComposeTextSegment('')]);
      setQuickComposeDropSlots([]);
      setQuickComposePromptCards([]);
      setAssets((prev) =>
        prev.map((a) => {
          if (a.id !== asset.id) return a;
          const dk = asset.displayKey;
          if (persistBucket === 'pano') {
            return {
              ...a,
              imageOverlayAnnotationsPano: {
                ...(a.imageOverlayAnnotationsPano || {}),
                [dk]: nextOverlayForPersist,
              },
            };
          }
          return {
            ...a,
            imageOverlayAnnotations: {
              ...(a.imageOverlayAnnotations || {}),
              [dk]: overlayDocForFlatAsset(nextOverlayForPersist),
            },
          };
        })
      );
    });

    const plainImgMod = getQuickComposePlainModule(QUICK_COMPOSE_PLAIN_I2I_ACTION_ID)!;
    const taskOverrides: WorkflowPendingTaskOptions = {};
    const eng = getCapabilityEngine(plainImgMod);
    if (eng === 'gen_image') {
      taskOverrides.overrideImageModelRegistryId = coerceImageModelRegistryId(quickComposeImageModel);
      if (quickComposeAspect && quickComposeAspect !== 'adaptive') {
        taskOverrides.overrideImageAspectRatio = quickComposeAspect;
      }
      if (quickComposeSize === '1K' || quickComposeSize === '2K' || quickComposeSize === '4K') {
        taskOverrides.overrideImageSize = quickComposeSize;
      }
      if (quickComposeUnderstand) {
        taskOverrides.overrideSkipUnderstand = overrideSkipUnderstandFromUnderstandEnabled(true);
      }
    }
    const plainLog: WorkflowPendingTask['logContext'] = 'quick_compose_bar_plain';

    let resolveClient!: (v: string) => void;
    let rejectClient!: (e: unknown) => void;
    const clientPromise = new Promise<string>((res, rej) => {
      resolveClient = res;
      rejectClient = rej;
    });
    const taskId = uuid();
    lightboxClientImageDeferredRef.current.set(taskId, {
      promise: clientPromise,
      resolve: resolveClient,
      reject: rejectClient,
    });

    const task: WorkflowPendingTask = {
      id: taskId,
      assetId: asset.id,
      actionType: QUICK_COMPOSE_PLAIN_I2I_ACTION_ID,
      inputImage: src,
      addedAt: Date.now(),
      inputSourceDisplayKey: asset.displayKey,
      ...(promptOverride ? { promptOverride } : {}),
      ...taskOverrides,
      logContext: plainLog,
      lightboxAwaitClientResult: true,
      ...(localEditSnapshot || needsPanoLocalCapture ? { displayStepLabel: '局部重绘' } : {}),
    };

    if (executing) {
      setPending((prev) => [...prev, task]);
    } else {
      void executePending([task, ...pendingRef.current]);
    }

    const localInpaintGenOptions = buildLocalInpaintGenImageOptions(quickComposeAspect, quickComposeSize);
    const localInpaintSizeLabel =
      quickComposeSize === '1K' || quickComposeSize === '2K' || quickComposeSize === '4K'
        ? quickComposeSize
        : undefined;
    const flatInpaintCompositeStrategy = readFlatLocalInpaintCompositeStrategy(preferenceScope);

    void (async () => {
      let composite = src;
      let inpaintMerged = false;
      let panoSnap: string | null = null;
      let panoRep: PanoLocalReprojectSnapshot | null = null;
      if (needsPanoLocalCapture) {
        const proj = lightboxPanoViewerRef.current;
        if (proj) {
          if (panoLocalReproject) {
            proj.applyReprojectSnapshot(panoLocalReproject);
          }
          panoSnap = proj.captureViewDataUrl('image/png');
          panoRep = proj.getReprojectSnapshot();
        }
      }
      try {
        let panoVpForCrop = panoLocalVp;
        if (!panoLocalReproject && panoLocalEquirect && panoLocalEquirect.length >= 3) {
          const proj = lightboxPanoViewerRef.current;
          if (proj) {
            const fromLoop = snapshotViewportNormFromEquirectLoop(proj, panoLocalEquirect);
            if (fromLoop) panoVpForCrop = fromLoop;
          }
        }
        if (panoVpForCrop && panoSnap && panoRep) {
          try {
            onLog?.('info', '大图预览：全景局部重绘中（视口快照 → 扩边 → 生成 → 贴回等距柱）…');
            const plan = await rasterizePanoLocalEditCropFromSnapshot(
              panoSnap,
              panoVpForCrop,
              panoRep,
              localInpaintExpandMode
            );
            if (!plan) {
              onLog?.('warn', '大图预览：全景局部裁切失败，将按整图继续');
            } else {
              const modelId = coerceImageModelRegistryId(quickComposeImageModel);
              const instruction = buildLocalInpaintInstruction(partialResolved.userPrompt, localInpaintSizeLabel);
              const genUrl = await workflowGenerateImage(
                plan.cropDataUrl,
                instruction,
                modelId,
                localInpaintGenOptions
              );
              const merged = await compositePanoPatchOntoEquirect(
                src,
                genUrl,
                plan.expandedRectPx,
                plan.reproject,
                plan.featherPx,
                { shrinkToBaseDimensions: readPanoLocalInpaintShrinkToBase(preferenceScope) }
              );
              if (merged) {
                composite = await ensureLocalInpaintOutputPixelFloor(merged, src);
                inpaintMerged = true;
              } else {
                onLog?.('warn', '大图预览：全景局部贴回失败，将按当前底图继续');
              }
            }
          } catch (err) {
            onLog?.('warn', `大图预览：全景局部重绘失败 — ${normalizeApiErrorMessage(err)}`);
          }
        } else if (needsPanoLocalCapture) {
          onLog?.('warn', '大图预览：全景局部重绘需要在大图「全景」模式下截取当前视口，请切换后重试');
        } else if (localEditSnapshot) {
          try {
            onLog?.('info', '大图预览：局部重绘中（扩边裁切 → 生成 → 贴回）…');
            const plan = await rasterizeExpandedLocalEditCrop(src, localEditSnapshot, localInpaintExpandMode);
            if (!plan) {
              onLog?.('warn', '大图预览：局部重绘裁切失败，将按整图继续');
            } else {
              const modelId = coerceImageModelRegistryId(quickComposeImageModel);
              const instruction = buildLocalInpaintInstruction(partialResolved.userPrompt, localInpaintSizeLabel);
              const genUrl = await workflowGenerateImage(
                plan.cropDataUrl,
                instruction,
                modelId,
                localInpaintGenOptions
              );
              const merged = await compositeLocalInpaintPatch(
                src,
                genUrl,
                plan.dest,
                plan.featherPx,
                flatInpaintCompositeStrategy
              );
              if (merged) {
                composite =
                  flatInpaintCompositeStrategy === 'fit_dest'
                    ? await ensureLocalInpaintOutputPixelFloor(merged, src)
                    : merged;
                inpaintMerged = true;
              } else {
                onLog?.('warn', '大图预览：局部贴回合成失败，将按当前底图继续');
              }
            }
          } catch (err) {
            onLog?.('warn', `大图预览：局部重绘失败 — ${normalizeApiErrorMessage(err)}`);
          }
        }
        /** 非局部重绘：全景 / 高度 3D / 模型 3D 以当前视口截图为图生图底图；平面仍用 `src`（当前预览合成） */
        if (!needsPanoLocalCapture && !localEditSnapshot) {
          const layout = lightboxPreviewLayoutRef.current;
          if (layout === 'pano') {
            try {
              const u = lightboxPanoViewerRef.current?.captureViewDataUrl('image/png');
              const s = String(u || '').trim();
              if (s.startsWith('data:')) {
                composite = s;
              } else {
                onLog?.('warn', '大图预览：全景视口截图为空，将按平面底图继续');
              }
            } catch (err) {
              onLog?.('warn', `大图预览：全景截屏失败 — ${normalizeApiErrorMessage(err)}`);
            }
          } else if (layout === 'heightfield' || layout === 'model3d') {
            try {
              const s = lightboxWebPreviewCaptureApiRef.current?.captureCurrentViewAsDataUrl();
              if (s && String(s).trim().startsWith('data:')) {
                composite = s;
              } else {
                onLog?.('warn', '大图预览：3D 视口截图为空，将按平面底图继续');
              }
            } catch (err) {
              onLog?.('warn', `大图预览：3D 截屏失败 — ${normalizeApiErrorMessage(err)}`);
            }
          }
        }
        let itemsBaked = false;
        if (itemsSnapshot.length > 0) {
          const baked = await rasterizeImageWithAnnotationBakes(composite, itemsSnapshot);
          if (baked) {
            composite = baked;
            itemsBaked = true;
          } else {
            onLog?.('warn', '大图预览：标注合成失败，仍使用当前底图收尾');
          }
        }
        /** 贴回像素已包含选区/标注时，清掉叠层文档，避免重复绘制与多余主线程开销 */
        const shouldWipeAnnotationOverlay =
          hadLocalInpaint &&
          ((inpaintMerged && (itemsSnapshot.length === 0 || itemsBaked)) ||
            (!inpaintMerged && itemsSnapshot.length > 0 && itemsBaked));
        if (shouldWipeAnnotationOverlay) {
          const empty = normalizeImageOverlayDoc(null);
          const emptyFlat = overlayDocForFlatAsset(empty);
          const emptyPano = normalizeImageOverlayDoc(null);
          flushSync(() => {
            setLightboxOverlayByMode({ flat: emptyFlat, pano: emptyPano });
            setAssets((prev) =>
              prev.map((a) => {
                if (a.id !== asset.id) return a;
                const dk = asset.displayKey;
                return {
                  ...a,
                  imageOverlayAnnotations: {
                    ...(a.imageOverlayAnnotations || {}),
                    [dk]: emptyFlat,
                  },
                  imageOverlayAnnotationsPano: {
                    ...(a.imageOverlayAnnotationsPano || {}),
                    [dk]: emptyPano,
                  },
                };
              })
            );
          });
        }
        const fullResolved = resolveQuickComposeReferences({
          segments: segmentsSnap,
          assets: assetsRef.current,
          getAssetDisplayImage,
          maxRefs: getQuickComposeMaxRefs(),
          currentViewDataUrl: composite,
        });
        const refsForExecute = fullResolved.refs.length > 0 ? fullResolved.refs : [composite];
        const box = lightboxClientImageDeferredRef.current.get(taskId);
        if (box) {
          if (inpaintMerged) box.skipCapabilityExecute = true;
          box.inputImagesForExecute = refsForExecute.length >= 2 ? refsForExecute : undefined;
        }
        resolveClient(refsForExecute[0] ?? composite);
      } catch (e) {
        rejectClient(e);
      }
    })();

    onLog?.('info', '大图预览：已入队（正在生成预览，结果写入当前卡片）');
  }, [
    getLightboxPreviewImageSrc,
    onLog,
    quickComposeImageModel,
    quickComposeTextModel,
    quickComposeAspect,
    quickComposeSize,
    quickComposeUnderstand,
    localInpaintExpandMode,
    preferenceScope,
    setLightboxOverlayByMode,
    setLightboxQuickComposeAnchor,
    setPending,
    executing,
    executePending,
    setQuickComposeSegmentsTracked,
    setQuickComposePromptCards,
    setAssets,
    setLightboxQuickComposeLayoutNonce,
    submitQuickCompose,
    getAssetDisplayImage,
    getQuickComposeMaxRefs,
  ]);

  const cancelQueuedTaskInBatch = useCallback((taskId: string) => {
    if (!taskId) return;
    cancelledTaskIdsRef.current.add(taskId);
    setCompletedTaskIds((prev) => new Set(prev).add(taskId));
  }, []);

  const addImagesFromFiles = useCallback((files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/')).slice(0, 50);
    const batchBase = Date.now();
    const n = imageFiles.length;
    imageFiles.forEach((file, fileIdx) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        const newId = uuid();
        const pushNewAsset = (aspectRatio?: number) => {
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
              ...(typeof aspectRatio === 'number' && aspectRatio > 0 ? { gridCardAspectRatio: aspectRatio } : {}),
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
          pushNewAsset(ratio);
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
          pushNewAsset(undefined);
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
            stepModelUrls: { original: [blobUrl] },
            modelUrls: [blobUrl],
            modelSourceName: file.name,
            archived: false,
            hiddenInGrid: false,
            createdAt: batchBase + (n - 1 - fileIdx),
            gridCardAspectRatio: ratio,
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
        void (async () => {
          const thumb = await captureWorkflowModelThumbnailDataUrl({
            modelSrc: blobUrl,
            modelFileName: file.name,
          });
          if (thumb) {
            const thumbRatio = clampWorkflowCardAspectRatio(1280, 800);
            setAssets((prev) => {
              if (!prev.some((x) => x.id === newId)) return prev;
              return prev.map((x) => {
                if (x.id !== newId) return x;
                const stillBlob = (x.modelUrls || []).some((u) => u === blobUrl);
                if (!stillBlob) return x;
                const o = String(x.original || '');
                if (!o.includes('image/svg+xml')) return x;
                return { ...x, original: thumb, gridCardAspectRatio: thumbRatio };
              });
            });
            setCardAspectByAssetId((prev) => ({ ...prev, [newId]: thumbRatio }));
          }
          const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
          const base = String(getCompanionLocalBaseUrl() || '').trim();
          if (!pid || !base) {
            onLog?.(
              'warn',
              '本地伴侣未连接',
              '3D 模型仅保存在浏览器会话内，刷新后可能无法预览；请在设置中连接本地伴侣以写入卷目录。'
            );
            return;
          }
          const put = await putWorkflowModelFileToCompanion(base, pid, newId, 0, file);
          if (put.ok === false) {
            onLog?.('warn', '3D 模型写入本地伴侣失败', put.error);
            return;
          }
          const got = await fetchWorkflowModelFromCompanionAsObjectUrl(base, pid, put.key, file.name);
          if (got.ok === false) {
            setAssets((prev) =>
              prev.map((x) =>
                x.id === newId
                  ? {
                      ...x,
                      stepModelCompanionKeys: { original: [put.key] },
                      modelCompanionKeys: [put.key],
                    }
                  : x
              )
            );
            onLog?.('warn', '3D 模型落盘后读取预览失败', got.error);
            return;
          }
          try {
            URL.revokeObjectURL(blobUrl);
          } catch {
            /* ignore */
          }
          setAssets((prev) =>
            prev.map((x) => {
              if (x.id !== newId) return x;
              const urls = [...(x.modelUrls || [])];
              urls[0] = got.objectUrl;
              return {
                ...x,
                modelUrls: urls,
                modelCompanionKeys: [put.key],
                stepModelUrls: { ...(x.stepModelUrls || {}), original: [got.objectUrl] },
                stepModelCompanionKeys: { ...(x.stepModelCompanionKeys || {}), original: [put.key] },
              };
            })
          );
        })();
      });
    },
    [buildWorkflowModelPlaceholderDataUrl, groupFilterId, onLog, setAssets, workspaceProjectChrome?.activeProjectId]
  );

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
    if (el.closest('[data-ac-block-workflow-marquee]')) return true;
    if (isWorkflowEditableTarget(el)) return true;
    // Do not hijack drag/drop on explicit interactive controls or icon buttons.
    if (el.closest('button, a, label, [role="button"], [role="menuitem"], [data-no-global-image-drop]')) return true;
    return false;
  }, []);

  useEffect(() => {
    const onWindowPaste = (e: ClipboardEvent) => {
      if (showArchived) return;
      if (typeof document !== 'undefined' && document.querySelector('[data-ac-block-workflow-marquee]')) return;
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
      const label = isWorkflowStoryboardTableAsset(a)
        ? storyboardTableOutlineLabel(a)
        : isWorkflowTextAsset(a)
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
        filter === 'image_process' ||
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

  const executionElapsedByAssetId = useWorkflowAssetExecutionElapsed(executingQueue, activeTaskIds);

  const resolveActiveExecutionForAsset = useCallback(
    (assetId: string) => {
      if (!executingQueue) return null;
      const task = executingQueue.tasks.find((t) => t.assetId === assetId && activeTaskIds.has(t.id));
      if (!task) return null;
      const mod = getModule(task.actionType);
      return {
        elapsedSeconds: executionElapsedByAssetId.get(assetId) ?? 0,
        stepLabel: (mod?.label || task.actionType).trim(),
      };
    },
    [executingQueue, activeTaskIds, executionElapsedByAssetId, getModule]
  );

  const lightboxActiveExecution = useMemo(() => {
    if (!lightboxAssetId) return null;
    return resolveActiveExecutionForAsset(lightboxAssetId);
  }, [lightboxAssetId, resolveActiveExecutionForAsset]);

  const lightboxAsset = lightboxAssetId ? assets.find((a) => a.id === lightboxAssetId) : null;
  const storyboardPanelAsset = storyboardPanelAssetId
    ? assets.find((a) => a.id === storyboardPanelAssetId && isWorkflowStoryboardTableAsset(a))
    : null;
  const storyboardExportTask = useStoryboardVideoExportTask();
  const storyboardExportRunning = storyboardExportTask?.status === 'running';
  const storyboardExportPct = storyboardExportRunning
    ? Math.round(storyboardExportTask.progress * 100)
    : 0;
  const storyboardExportTitle = storyboardExportRunning ? storyboardExportTask.assetTitle : '';

  useEffect(() => {
    if (storyboardPanelAssetId && !storyboardPanelAsset) {
      setStoryboardPanelAssetId(null);
    }
  }, [storyboardPanelAsset, storyboardPanelAssetId]);
  const lightboxShowsImage = Boolean(lightboxAsset && getAssetDisplayImage(lightboxAsset).trim());
  /** 文字资产当前版本按文本通道展示（非 results 中的位图版本） */
  const lightboxTextAssetOnTextChannel = Boolean(
    lightboxAsset &&
      isWorkflowTextAsset(lightboxAsset) &&
      workflowAssetCurrentDisplayIsTextChannel(lightboxAsset)
  );
  /** 大图按位图预览：工具条、标注、快捷输入、SAM 等完整图片 chrome */
  const lightboxRasterChrome = Boolean(lightboxAsset && assetLightboxRasterEligible(lightboxAsset));
  /** 右侧步骤时间线 / 左侧 VGP 缩略图树（含文字源资产） */
  const lightboxStepSideChrome = Boolean(lightboxAsset && !isGroupAsset(lightboxAsset));
  const lightboxModelUrls = useMemo(() => {
    if (!lightboxAsset) return [];
    return resolveWorkflowStepModelUrls(lightboxAsset, lightboxAsset.displayKey);
  }, [lightboxAsset]);
  /** blob: 预览 URL 常无扩展名；优先用 modelSourceName，否则用 stepModelFormats 推断，避免 3D 视口无法识别格式 */
  const lightboxModelFileNameHint = useMemo(() => {
    if (!lightboxAsset) return undefined;
    const raw = String(lightboxAsset.modelSourceName || '').trim();
    if (raw && /\.(glb|gltf|fbx|obj)$/i.test(raw.split(/[?#]/)[0] || '')) return raw;
    const dk = lightboxAsset.displayKey;
    const fmts = lightboxAsset.stepModelFormats?.[dk];
    const first = fmts?.[0];
    const stub = `workflow-${lightboxAsset.id.slice(0, 8)}`;
    if (first === 'fbx') return `${stub}.fbx`;
    if (first === 'glb') return `${stub}.glb`;
    return raw || `${stub}.glb`;
  }, [lightboxAsset]);
  const lightboxTripoRehydrateCtx = useMemo(() => {
    if (!lightboxAsset || !assetLightboxRasterEligible(lightboxAsset)) {
      return null;
    }
    const dk = lightboxAsset.displayKey;
    const tripoTaskId = String(lightboxAsset.resultMeta?.[dk]?.tripoTaskId || '').trim();
    if (!tripoTaskId) return null;
    return { metaKey: dk, tripoTaskId };
  }, [lightboxAsset, assetLightboxRasterEligible]);
  const lightboxTencentRehydrateCtx = useMemo(() => {
    if (!lightboxAsset || !assetLightboxRasterEligible(lightboxAsset)) {
      return null;
    }
    const dk = lightboxAsset.displayKey;
    const tencentJobId = String(lightboxAsset.resultMeta?.[dk]?.tencentJobId || '').trim();
    if (!tencentJobId) return null;
    return { metaKey: dk, tencentJobId };
  }, [lightboxAsset, assetLightboxRasterEligible]);
  const lightboxShowTripo3DToolbar = useMemo(
    () =>
      Boolean(
        lightboxRasterChrome &&
          (lightboxModelUrls.length > 0 || lightboxTripoRehydrateCtx || lightboxTencentRehydrateCtx)
      ),
    [
      lightboxRasterChrome,
      lightboxModelUrls.length,
      lightboxTripoRehydrateCtx,
      lightboxTencentRehydrateCtx,
    ]
  );
  const lightboxModelDownloadsOnRight = useMemo(
    () => Boolean(lightboxRasterChrome && lightboxModelUrls.length > 0),
    [lightboxRasterChrome, lightboxModelUrls.length]
  );

  const handleLightboxPullTripoModels = useCallback(async () => {
    const id = lightboxAssetIdRef.current;
    if (!id) return;
    const a = assetsRef.current.find((x) => x.id === id);
    if (!a) return;
    const dk = a.displayKey;
    const tripoTaskId = String(a.resultMeta?.[dk]?.tripoTaskId || '').trim();
    if (!tripoTaskId) {
      onLog?.('warn', 'Tripo 拉取模型', '当前步骤详情中未找到 tripoTaskId，请切换到生成 3D 的步骤');
      return;
    }
    const apiKey = getTripoApiKey();
    if (!String(apiKey || '').trim()) {
      onLog?.('error', 'Tripo 拉取模型', '缺少 Tripo API Key，请先在 API 密钥弹窗保存');
      return;
    }
    setLightboxTripoPullBusy(true);
    try {
      const base = String(getCompanionLocalBaseUrl() || '').trim();
      const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
      let { nextAsset, revokeBlobUrls } = await rehydrateWorkflowAssetModelsFromTripoTask({
        asset: a,
        apiKey: String(apiKey).trim(),
        companionBaseUrl: base || null,
        companionProjectId: pid || null,
        onLog: (level, message, detail) => onLog?.(level, message, detail),
      });
      if (base && pid) {
        const hydrated = await hydrateWorkflowAssetSingle3dResultKeyFromCompanion({
          asset: nextAsset,
          resultKey: dk,
          baseUrl: base,
          projectId: pid,
          onLog: (level, message, detail) => onLog?.(level, message, detail),
        });
        nextAsset = hydrated.nextAsset;
        revokeBlobUrls = [...revokeBlobUrls, ...hydrated.revokeBlobUrls];
      }
      if (!base || !pid) {
        onLog?.(
          'warn',
          'Tripo 模型已拉取到内存',
          '未连接本地伴侣时仅使用浏览器内 blob 预览，刷新后可能失效；连接伴侣后可再次拉取以写入卷目录。'
        );
      } else {
        onLog?.('info', 'Tripo 模型已重新落地', { assetId: a.id });
      }
      setAssets((prev) => {
        const next = prev.map((x) => (x.id === a.id ? nextAsset : x));
        queueMicrotask(() => {
          for (const u of revokeBlobUrls) {
            revokeWorkflowModelBlobUrlsIfOrphaned(u, next);
          }
        });
        return next;
      });
    } catch (e) {
      onLog?.('error', 'Tripo 拉取模型失败', normalizeApiErrorMessage(e));
    } finally {
      setLightboxTripoPullBusy(false);
    }
  }, [onLog, setAssets, workspaceProjectChrome?.activeProjectId]);

  const handleLightboxPullTencentModels = useCallback(async () => {
    const id = lightboxAssetIdRef.current;
    if (!id) return;
    const a = assetsRef.current.find((x) => x.id === id);
    if (!a) return;
    const dk = a.displayKey;
    const tencentJobId = String(a.resultMeta?.[dk]?.tencentJobId || '').trim();
    if (!tencentJobId) {
      onLog?.('warn', '混元拉取模型', '当前步骤详情中未找到 tencentJobId');
      return;
    }
    const creds = getTencentCredsFromEnv();
    if (!creds) {
      onLog?.('error', '混元拉取模型', '缺少腾讯云混元配置（VITE_TENCENT_PROXY）');
      return;
    }
    setLightboxTencentPullBusy(true);
    try {
      const base = String(getCompanionLocalBaseUrl() || '').trim();
      const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
      let { nextAsset, revokeBlobUrls } = await rehydrateWorkflowAssetModelsFromTencentJob({
        asset: a,
        creds,
        companionBaseUrl: base || null,
        companionProjectId: pid || null,
        onLog: (level, message, detail) => onLog?.(level, message, detail),
      });
      if (base && pid) {
        const hydrated = await hydrateWorkflowAssetSingle3dResultKeyFromCompanion({
          asset: nextAsset,
          resultKey: dk,
          baseUrl: base,
          projectId: pid,
          onLog: (level, message, detail) => onLog?.(level, message, detail),
        });
        nextAsset = hydrated.nextAsset;
        revokeBlobUrls = [...revokeBlobUrls, ...hydrated.revokeBlobUrls];
      }
      if (!base || !pid) {
        onLog?.('warn', '混元模型已拉取到内存', '未连接本地伴侣时仅浏览器内预览，刷新后可能失效。');
      } else {
        onLog?.('info', '混元模型已重新落地', { assetId: a.id, tencentJobId });
      }
      setAssets((prev) => {
        const next = prev.map((x) => (x.id === a.id ? nextAsset : x));
        queueMicrotask(() => {
          for (const u of revokeBlobUrls) {
            revokeWorkflowModelBlobUrlsIfOrphaned(u, next);
          }
        });
        return next;
      });
    } catch (e) {
      onLog?.('error', '混元拉取模型失败', normalizeApiErrorMessage(e));
    } finally {
      setLightboxTencentPullBusy(false);
    }
  }, [onLog, setAssets, workspaceProjectChrome?.activeProjectId]);

  const lightboxModelDownloadSlots = useMemo(() => {
    if (!lightboxAsset) return [];
    const dk = lightboxAsset.displayKey;
    const urls = resolveWorkflowStepModelUrls(lightboxAsset, dk);
    const keys = resolveWorkflowStepModelCompanionKeys(lightboxAsset, dk);
    const formats = resolveWorkflowStepModelFormats(lightboxAsset, dk);
    const slotCount = Math.max(urls.length, keys.length, formats.length, 1);
    return Array.from({ length: slotCount }, (_, idx) => {
      const format = formats[idx] || (idx === 0 ? 'glb' : 'fbx');
      const url = urls[idx] || '';
      const companionKey = keys[idx] || '';
      const downloadable = Boolean(String(url).trim() || String(companionKey).trim());
      return {
        index: idx,
        url,
        companionKey,
        format,
        downloadable,
      };
    }).filter((slot) => slot.downloadable || slot.format === 'fbx');
  }, [lightboxAsset]);

  const lightboxModelPersistDetail = useMemo(() => {
    if (!lightboxAsset) return null;
    return getWorkflowStepModelPersistStatus(lightboxAsset, lightboxAsset.displayKey);
  }, [lightboxAsset]);

  const lightboxModelPersistLabel = useMemo(() => {
    if (!lightboxModelPersistDetail || lightboxModelPersistDetail.status === 'none') return '';
    return workflowModelPersistStatusLabel(lightboxModelPersistDetail);
  }, [lightboxModelPersistDetail]);

  const handleLightboxDownloadModel = useCallback(
    async (slotIndex: number) => {
      const id = lightboxAssetIdRef.current;
      if (!id) return;
      const a = assetsRef.current.find((x) => x.id === id);
      if (!a) return;
      const dk = a.displayKey;
      const urls = resolveWorkflowStepModelUrls(a, dk);
      const keys = resolveWorkflowStepModelCompanionKeys(a, dk);
      const formats = resolveWorkflowStepModelFormats(a, dk);
      const url = urls[slotIndex] || '';
      const companionKey = keys[slotIndex] || '';
      const format = formats[slotIndex] || (slotIndex === 0 ? 'glb' : 'fbx');
      const base = String(getCompanionLocalBaseUrl() || '').trim();
      const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
      const nameBase = String(a.modelSourceName || a.id || 'model').replace(/\.[a-z0-9]+$/i, '');
      try {
        const downloaded = await downloadWorkflowStepModelSlot({
          assetId: a.id,
          resultKey: dk,
          slotIndex,
          url,
          companionKey,
          companionBaseUrl: base || null,
          companionProjectId: pid || null,
          fileNameHint: `${nameBase}.${format}`,
          tripoApiKey: getTripoApiKey(),
        });
        onLog?.(
          'info',
          downloaded.mode === 'workbench' ? '模型已保存到本机' : '模型下载已开始',
          {
            format: format.toUpperCase(),
            slot: slotIndex + 1,
            filename: downloaded.filename,
            path: downloaded.path,
          }
        );
      } catch (e) {
        onLog?.('error', '下载模型失败', normalizeApiErrorMessage(e));
      }
    },
    [onLog, workspaceProjectChrome?.activeProjectId]
  );

  const lightboxSamSegmentUiAllowed = useMemo(
    () =>
      Boolean(
        lightboxRasterChrome &&
          lightboxModelUrls.length === 0 &&
          lightboxPreviewLayout === 'flat'
      ),
    [
      lightboxRasterChrome,
      lightboxModelUrls.length,
      lightboxPreviewLayout,
    ]
  );

  const lightboxCanvasSuppressFlat = useMemo(
    () =>
      Boolean(
        lightboxRasterChrome &&
          lightboxSamSegmentUiAllowed &&
          lightboxSamPickArmed &&
          !lightboxSamBusy
      ),
    [
      lightboxRasterChrome,
      lightboxSamSegmentUiAllowed,
      lightboxSamPickArmed,
      lightboxSamBusy,
    ]
  );

  const lightboxCanvasSplitUiOk = useMemo(
    () =>
      Boolean(
        lightboxRasterChrome &&
          lightboxPreviewLayout === 'flat' &&
          !lightboxCanvasSuppressFlat
      ),
    [lightboxRasterChrome, lightboxPreviewLayout, lightboxCanvasSuppressFlat]
  );

  /** 与 `ImagePreviewOverlay` 的 `resizeWriteBackUiOk` 对齐：平面大图即可改尺寸写回（不受 SAM 点选武装抑制） */
  const lightboxCanvasResizeUiOk = useMemo(
    () => Boolean(lightboxRasterChrome && lightboxPreviewLayout === 'flat'),
    [lightboxRasterChrome, lightboxPreviewLayout]
  );

  useEffect(() => {
    setLightboxCanvasSplitStretchEnabled(false);
    setLightboxCanvasSplitStretchWriteBackPopOpen(false);
    setLightboxCanvasResizeWriteBackPopOpen(false);
    setLightboxTripoPullBusy(false);
  }, [lightboxAsset?.id]);

  const lightboxCanvasAdjustControl = useMemo((): ImagePreviewCanvasAdjustControl | undefined => {
    if (!lightboxRasterChrome) {
      return undefined;
    }
    return {
      splitStretchEnabled: lightboxCanvasSplitStretchEnabled,
      setSplitStretchEnabled: setLightboxCanvasSplitStretchEnabled,
      splitStretchWriteBackPopOpen: lightboxCanvasSplitStretchWriteBackPopOpen,
      setSplitStretchWriteBackPopOpen: setLightboxCanvasSplitStretchWriteBackPopOpen,
      resizeWriteBackPopOpen: lightboxCanvasResizeWriteBackPopOpen,
      setResizeWriteBackPopOpen: setLightboxCanvasResizeWriteBackPopOpen,
    };
  }, [
    lightboxRasterChrome,
    lightboxCanvasSplitStretchEnabled,
    lightboxCanvasSplitStretchWriteBackPopOpen,
    lightboxCanvasResizeWriteBackPopOpen,
  ]);

  const lightboxAnnotationCanvasAdjust = useMemo(() => {
    if (!lightboxRasterChrome) {
      return null;
    }
    return {
      splitUiOk: lightboxCanvasSplitUiOk,
      resizeUiOk: lightboxCanvasResizeUiOk,
      previewLayout: lightboxPreviewLayout,
      splitStretchEnabled: lightboxCanvasSplitStretchEnabled,
      setSplitStretchEnabled: setLightboxCanvasSplitStretchEnabled,
      splitStretchWriteBackPopOpen: lightboxCanvasSplitStretchWriteBackPopOpen,
      setSplitStretchWriteBackPopOpen: setLightboxCanvasSplitStretchWriteBackPopOpen,
      resizeWriteBackPopOpen: lightboxCanvasResizeWriteBackPopOpen,
      setResizeWriteBackPopOpen: setLightboxCanvasResizeWriteBackPopOpen,
      imageResizeWriteBackAvailable: lightboxCanvasResizeUiOk,
    };
  }, [
    lightboxRasterChrome,
    lightboxCanvasSplitUiOk,
    lightboxCanvasResizeUiOk,
    lightboxPreviewLayout,
    lightboxCanvasSplitStretchEnabled,
    lightboxCanvasSplitStretchWriteBackPopOpen,
    lightboxCanvasResizeWriteBackPopOpen,
  ]);

  /** 工具条始终显示十字入口（禁用态说明原因）；仅平面无 3D 时可点选 */
  const lightboxSamSegmentToolbarVisible = useMemo(
    () => Boolean(lightboxRasterChrome),
    [lightboxRasterChrome]
  );
  const lightboxSamSegmentDisabledTitle = useMemo(() => {
    if (!workspaceProjectChrome?.activeProjectId?.trim()) return '请先选择工作区项目';
    if (lightboxModelUrls.length > 0) return '含 3D 模型入口的资产不支持分割点选';
    if (lightboxPreviewLayout !== 'flat') return '请切换到「平面」预览后再使用分割（全景 / 高度 3D / 模型 3D 等模式不支持点选）';
    return undefined;
  }, [
    workspaceProjectChrome?.activeProjectId,
    lightboxModelUrls.length,
    lightboxPreviewLayout,
  ]);

  /** 伴侣已配置但 SamLocal 健康探测未就绪（未安装/未启动/探测失败）— 工具条短提示用 */
  const lightboxSamBackendUnready = useMemo(
    () =>
      Boolean(
        lightboxSamSegmentUiAllowed &&
          normalizeCompanionBaseUrl(String(getCompanionLocalBaseUrl() || '').trim()) &&
          lightboxSamBackendMode === 'unknown'
      ),
    [lightboxSamSegmentUiAllowed, lightboxSamBackendMode]
  );

  /** 大图 `<img>`：查看本机 mask 版本时垫原图，避免 mask 透明区透出毛玻璃/灰背景 */
  const lightboxPreviewUnderlaySrc = useMemo(() => {
    if (!lightboxAsset || !lightboxShowsImage) return '';
    if (isWorkflowInternalSamMaskDisplayKey(lightboxAsset.displayKey)) {
      const o = asWorkflowImageString(lightboxAsset.original).trim();
      if (o) return workflowSafeImgSrc(o);
    }
    return getLightboxPreviewImageSrc(lightboxAsset);
  }, [lightboxAsset, lightboxShowsImage, getLightboxPreviewImageSrc]);

  /** 已保存的 mask 版本在图上叠层（不含未保存预览） */
  const lightboxSamSavedMaskOverlayHref = useMemo(() => {
    if (!lightboxAsset || !lightboxShowsImage) return undefined;
    const dk = lightboxAsset.displayKey;
    if (!isWorkflowInternalSamMaskDisplayKey(dk)) return undefined;
    const m = lightboxAsset.results?.[dk];
    const s = typeof m === 'string' ? m.trim() : '';
    if (!s) return undefined;
    return workflowSafeImgSrc(s);
  }, [lightboxAsset, lightboxShowsImage]);

  useEffect(() => {
    let cancelled = false;
    const assetId = lightboxAsset?.id;
    const unsavedSam = lightboxSamUnsaved;
    const layers =
      unsavedSam &&
      unsavedSam.assetId === assetId &&
      unsavedSam.previewLayers.length > 0
        ? unsavedSam.previewLayers
        : [];
    const auto =
      lightboxSamUxMode === 'auto' && lightboxSamAutoLayer?.assetId === assetId ? lightboxSamAutoLayer : null;
    /** 自动拆分阶段须始终叠上全部候选，否则未勾选/未悬停时 extra 为空，画面上看不到任何分割块 */
    const extra: string[] = [];
    if (auto && auto.dataUrls.length) {
      for (const u of auto.dataUrls) {
        const s = typeof u === 'string' ? u.trim() : '';
        if (s) extra.push(s);
      }
    }
    const stack = [...layers, ...extra];
    if (stack.length === 0) {
      setLightboxSamPreviewCompositeHref(undefined);
      return () => {
        cancelled = true;
      };
    }
    void unionMaskDataUrlsToDataUrl(stack).then((u) => {
      if (cancelled || !u) return;
      setLightboxSamPreviewCompositeHref(workflowSafeImgSrc(u));
    });
    return () => {
      cancelled = true;
    };
  }, [
    lightboxAsset?.id,
    lightboxSamUnsaved?.assetId,
    lightboxSamUnsaved?.previewLayers,
    lightboxSamAutoLayer,
    lightboxSamUxMode,
  ]);

  const lightboxSamFlatMaskOverlayHref =
    lightboxSamPreviewCompositeHref ?? lightboxSamSavedMaskOverlayHref;

  const lightboxSamPickMarkers = useMemo(() => {
    if (!lightboxSamMetrics || lightboxSamSessionPoints.length === 0) return [];
    const { nw, nh } = lightboxSamMetrics;
    return lightboxSamSessionPoints.map((p) => ({
      nx: p.ix / Math.max(1, nw),
      ny: p.iy / Math.max(1, nh),
      label: (p.label === 1 ? 1 : 0) as 1 | 0,
    }));
  }, [lightboxSamSessionPoints, lightboxSamMetrics]);

  const lightboxSamCanRunSegment = useMemo(() => {
    if (!lightboxSamMetrics || lightboxSamMetrics.nw < 1 || lightboxSamMetrics.nh < 1) return false;
    if (lightboxSamSessionPoints.length > 0) return true;
    if (!lightboxSamBoxPx) return false;
    return (
      Math.abs(lightboxSamBoxPx.x2 - lightboxSamBoxPx.x1) >= 1 &&
      Math.abs(lightboxSamBoxPx.y2 - lightboxSamBoxPx.y1) >= 1
    );
  }, [lightboxSamMetrics, lightboxSamSessionPoints.length, lightboxSamBoxPx]);

  const lightboxList = useMemo(
    () =>
      sortRootWorkflowAssetsNewestFirst(
        assets.filter(
          (a) =>
            !a.archived &&
            !a.hiddenInGrid &&
            !a.parentAssetId &&
            !isWorkflowStoryboardTableAsset(a) &&
            !isGroupAsset(a)
        )
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

  useEffect(() => {
    if (!lightboxAssetId || !lightboxAsset || !lightboxRasterChrome) {
      setLightboxPointerRgb(null);
    }
  }, [lightboxAssetId, lightboxAsset, lightboxRasterChrome]);

  useEffect(() => {
    if (!lightboxAsset || !lightboxRasterChrome) return;
    const dk = lightboxAsset.displayKey;
    overlayHistoryPastByModeRef.current = { flat: [], pano: [] };
    overlayHistoryFutureByModeRef.current = { flat: [], pano: [] };
    const legacy = normalizeImageOverlayDoc(lightboxAsset.imageOverlayAnnotations?.[dk]);
    const flatDoc = overlayDocForFlatAsset(legacy);
    const panoDoc = normalizeImageOverlayDoc(lightboxAsset.imageOverlayAnnotationsPano?.[dk] ?? null);
    setLightboxOverlayByMode({ flat: flatDoc, pano: panoDoc });
    setLightboxOverlayTool('off');
  }, [lightboxAsset, lightboxRasterChrome]);

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

  const persistLightboxOverlayAnnotations = useCallback(() => {
    const id = lightboxAssetId;
    if (!id) return;
    const dk = assetsRef.current.find((x) => x.id === id)?.displayKey;
    const snap = lightboxOverlayByModeRef.current;
    setAssets((prev) => {
      const a = prev.find((x) => x.id === id);
      if (!a) return prev;
      const displayKey = a.displayKey;
      return prev.map((x) =>
        x.id !== id
          ? x
          : {
              ...x,
              imageOverlayAnnotations: {
                ...(x.imageOverlayAnnotations || {}),
                [displayKey]: overlayDocForFlatAsset(snap.flat),
              },
              imageOverlayAnnotationsPano: {
                ...(x.imageOverlayAnnotationsPano || {}),
                [displayKey]: snap.pano,
              },
            }
      );
    });
    if (dk) supersedeWorkflowOverlaySnapshotsForAsset(id, dk);
    onLog?.('info', '大图标注已写入当前显示版本（随项目保存）');
  }, [lightboxAssetId, onLog, setAssets]);

  /** 关闭大图前写入资产，使再次打开仍为上次的标注/裁切/局部重绘状态 */
  const flushLightboxOverlayToAsset = useCallback(() => {
    const id = lightboxAssetIdRef.current;
    if (!id) return;
    const snap = lightboxOverlayByModeRef.current;
    const flatW = overlayDocForFlatAsset(snap.flat);
    const panoW = normalizeImageOverlayDoc(snap.pano);
    const pre = assetsRef.current.find((x) => x.id === id);
    const dk =
      pre && assetLightboxRasterEligible(pre) ? pre.displayKey : null;
    setAssets((prev) => {
      const a = prev.find((x) => x.id === id);
      if (!a || !assetLightboxRasterEligible(a)) return prev;
      const displayKey = a.displayKey;
      return prev.map((x) =>
        x.id !== id
          ? x
          : {
              ...x,
              imageOverlayAnnotations: {
                ...(x.imageOverlayAnnotations || {}),
                [displayKey]: flatW,
              },
              imageOverlayAnnotationsPano: {
                ...(x.imageOverlayAnnotationsPano || {}),
                [displayKey]: panoW,
              },
            }
      );
    });
    if (dk) supersedeWorkflowOverlaySnapshotsForAsset(id, dk);
  }, [assetLightboxRasterEligible, setAssets]);

  const completeLightboxClose = useCallback(
    (opts: { flush: boolean; auditDiscard: boolean }) => {
      const r = lightboxDirtyClosePersistedRef.current;
      if (opts.auditDiscard && r) {
        appendWorkflowAuditEvent({
          level: 'info',
          code: WORKFLOW_AUDIT_CODES.LIGHTBOX_OVERLAY_CLOSE_DISCARDED,
          assetId: r.assetId,
          displayKey: r.displayKey,
          message: '工作流大图：关闭时未将 overlay 写回资产（用户选择丢弃）',
          detail: { context: 'workflow_lightbox_close' },
        });
      }
      if (opts.flush) flushLightboxOverlayToAsset();
      setQuickComposeSegmentsTracked((prev) => stripCurrentViewFromQuickComposeSegments(prev));
      setLightboxAssetId(null);
      setLightboxSourceSlot(null);
      setLightboxRembgPreview(null);
      setLightboxRembgInstallModalOpen(false);
      setLightboxOverlayDirtyCloseDialogOpen(false);
      lightboxOverlayDirtyCloseDialogOpenRef.current = false;
      lightboxDirtyClosePersistedRef.current = null;
    },
    [flushLightboxOverlayToAsset, setQuickComposeSegmentsTracked]
  );

  const cancelLightboxOverlayDirtyCloseDialog = useCallback(() => {
    lightboxDirtyClosePersistedRef.current = null;
    lightboxOverlayDirtyCloseDialogOpenRef.current = false;
    setLightboxOverlayDirtyCloseDialogOpen(false);
  }, []);

  const handleLightboxClose = useCallback(() => {
    if (lightboxOverlayDirtyCloseDialogOpenRef.current) return;

    textLightboxCenterRef.current?.flush();

    const id = lightboxAssetIdRef.current;
    if (id) {
      const a = assetsRef.current.find((x) => x.id === id);
      if (a && assetLightboxRasterEligible(a)) {
        const snap = lightboxOverlayByModeRef.current;
        const bucket = lightboxOverlayActiveBucketRef.current;
        const doc =
          bucket === 'flat' ? overlayDocForFlatAsset(snap.flat) : normalizeImageOverlayDoc(snap.pano);
        appendWorkflowOverlayCloseSnapshot({
          assetId: id,
          baseDisplayKey: a.displayKey,
          bucket,
          doc,
        });
        setOverlaySnapshotRingBump((n) => n + 1);
      }
    }

    if (id) {
      const a = assetsRef.current.find((x) => x.id === id);
      if (a && assetLightboxRasterEligible(a)) {
        const dk = a.displayKey;
        const snap = lightboxOverlayByModeRef.current;
        const curFlat = overlayDocForFlatAsset(snap.flat);
        const curPano = normalizeImageOverlayDoc(snap.pano);
        const storedFlat = overlayDocForFlatAsset(normalizeImageOverlayDoc(a.imageOverlayAnnotations?.[dk]));
        const storedPano = normalizeImageOverlayDoc(a.imageOverlayAnnotationsPano?.[dk]);
        const verdict = compareWorkflowOverlayDraftToPersisted({
          draftFlat: curFlat,
          draftPano: curPano,
          storedFlat,
          storedPano,
        });
        if (verdict === 'dirty') {
          lightboxDirtyClosePersistedRef.current = { assetId: id, displayKey: dk };
          lightboxOverlayDirtyCloseDialogOpenRef.current = true;
          setLightboxOverlayDirtyCloseDialogOpen(true);
          return;
        }
      }
    }
    completeLightboxClose({ flush: true, auditDiscard: false });
  }, [assetLightboxRasterEligible, completeLightboxClose]);

  /** 大图 overlay 编辑：debounce 写入 session 环 `reason: periodic`（仅当草稿与资产已持久化 **dirty** 时），与关窗 `close` 合并规则见 `workflowOverlaySnapshots` */
  useEffect(() => {
    if (!lightboxAssetId || !lightboxShowsImage) return;
    const a = assetsRef.current.find((x) => x.id === lightboxAssetId);
    if (!a || !assetLightboxRasterEligible(a)) return;
    const id = lightboxAssetId;
    const ms = WORKFLOW_OVERLAY_PERIODIC_SNAPSHOT_MS;
    const t = window.setTimeout(() => {
      const aNow = assetsRef.current.find((x) => x.id === id);
      if (!aNow || !assetLightboxRasterEligible(aNow)) return;
      const dkNow = aNow.displayKey;
      const snap = lightboxOverlayByModeRef.current;
      const curFlat = overlayDocForFlatAsset(snap.flat);
      const curPano = normalizeImageOverlayDoc(snap.pano);
      const storedFlat = overlayDocForFlatAsset(normalizeImageOverlayDoc(aNow.imageOverlayAnnotations?.[dkNow]));
      const storedPano = normalizeImageOverlayDoc(aNow.imageOverlayAnnotationsPano?.[dkNow]);
      const verdict = compareWorkflowOverlayDraftToPersisted({
        draftFlat: curFlat,
        draftPano: curPano,
        storedFlat,
        storedPano,
      });
      if (verdict !== 'dirty') return;
      const bucket = lightboxOverlayActiveBucketRef.current;
      const doc =
        bucket === 'flat' ? overlayDocForFlatAsset(snap.flat) : normalizeImageOverlayDoc(snap.pano);
      const ent = appendWorkflowOverlayCloseSnapshot({
        assetId: id,
        baseDisplayKey: dkNow,
        bucket,
        doc,
        reason: 'periodic',
      });
      if (ent) setOverlaySnapshotRingBump((n) => n + 1);
    }, ms);
    return () => window.clearTimeout(t);
  }, [lightboxOverlayByMode, lightboxAssetId, lightboxShowsImage, assetLightboxRasterEligible]);

  const restoreLightboxOverlayFromRingEntry = useCallback(
    (bucket: WorkflowOverlaySnapshotBucket, doc: ImageOverlayAnnotationDoc) => {
      const lid = lightboxAssetIdRef.current;
      if (!lid) return;
      const a = assetsRef.current.find((x) => x.id === lid);
      const dk = a?.displayKey;
      const norm = bucket === 'flat' ? overlayDocForFlatAsset(doc) : normalizeImageOverlayDoc(doc);
      overlayHistoryPastByModeRef.current[bucket] = [];
      overlayHistoryFutureByModeRef.current[bucket] = [];
      setLightboxOverlayByMode((prev) => ({ ...prev, [bucket]: norm }));
      appendWorkflowAuditEvent({
        level: 'info',
        code: WORKFLOW_AUDIT_CODES.LIGHTBOX_OVERLAY_RESTORE_FROM_RING,
        assetId: lid,
        displayKey: dk,
        message: '工作流大图：从 session 快照环加载到当前草稿',
        detail: { context: 'workflow_lightbox', bucket },
      });
      setOverlaySnapshotRingBump((n) => n + 1);
    },
    []
  );

  const resetLightboxOverlayAll = useCallback(() => {
    const id = lightboxAssetId;
    if (!id || !lightboxAsset) return;
    if (!lightboxRasterChrome) return;
    const bucket = lightboxOverlayActiveBucketRef.current;
    overlayHistoryPastByModeRef.current[bucket] = [];
    overlayHistoryFutureByModeRef.current[bucket] = [];
    const empty = normalizeImageOverlayDoc(null);
    setLightboxOverlayByMode((prev) => ({ ...prev, [bucket]: empty }));
    setLightboxOverlayTool('off');
    setLightboxQuickComposeAnchor(null);
    const dk = lightboxAsset.displayKey;
    setAssets((prev) =>
      prev.map((x) => {
        if (x.id !== id) return x;
        if (bucket === 'pano') {
          return {
            ...x,
            imageOverlayAnnotationsPano: {
              ...(x.imageOverlayAnnotationsPano || {}),
              [dk]: empty,
            },
          };
        }
        return {
          ...x,
          imageOverlayAnnotations: {
            ...(x.imageOverlayAnnotations || {}),
            [dk]: empty,
          },
        };
      })
    );
    onLog?.('info', '已清空当前预览模式下的标注、裁切与局部重绘（已写入当前显示版本）');
  }, [lightboxAssetId, lightboxAsset, lightboxRasterChrome, onLog, setAssets]);

  const handleLightboxImageResizeWriteBack = useCallback(
    async ({
      dataUrl,
      width,
      height,
      writeBackKind = 'resize',
    }: WorkflowLightboxImageWriteBackPayload) => {
      const id = lightboxAssetIdRef.current;
      const asset = assetsRef.current.find((a) => a.id === id);
      if (!asset || !assetLightboxRasterEligible(asset)) {
        onLog?.('warn', '大图预览：改尺寸写回仅支持图像资产');
        return;
      }
      if (!parseDataUrlToBlob(dataUrl)) {
        onLog?.('warn', '大图预览：写回失败（无效图像数据）');
        return;
      }
      const dk = asset.displayKey;
      const baseId =
        writeBackKind === 'split_stretch'
          ? WORKFLOW_LIGHTBOX_SPLIT_STRETCH_WRITEBACK_ACTION_ID
          : WORKFLOW_LIGHTBOX_RESIZE_WRITEBACK_ACTION_ID;
      const displayStepLabel = writeBackKind === 'split_stretch' ? '线分割变形' : '改尺寸写回';
      const hasAnyVersion =
        Object.keys(asset.results || {}).some((k) => baseActionId(k) === baseId) ||
        (asset.resultOrder || []).some((k) => baseActionId(k) === baseId);
      const newKey = hasAnyVersion ? makeVersionKey(baseId) : baseId;

      const emptyFlat = overlayDocForFlatAsset(normalizeImageOverlayDoc(null));
      const emptyPano = normalizeImageOverlayDoc(null);
      setLightboxOverlayByMode({ flat: emptyFlat, pano: emptyPano });
      setLightboxOverlayTool('off');
      setAssets((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          const nextAnn = { ...(a.imageOverlayAnnotations || {}) };
          const nextAnnPano = { ...(a.imageOverlayAnnotationsPano || {}) };
          nextAnn[dk] = emptyFlat;
          nextAnnPano[dk] = emptyPano;
          const nextResults = { ...(a.results || {}), [newKey]: dataUrl };
          const nextOrder = [...(a.resultOrder || []), newKey];
          const nextMeta = {
            ...(a.resultMeta || {}),
            [newKey]: {
              executedAt: Date.now(),
              displayStepLabel,
            },
          };
          return {
            ...a,
            results: nextResults,
            resultOrder: nextOrder,
            resultMeta: nextMeta,
            imageOverlayAnnotations: nextAnn,
            imageOverlayAnnotationsPano: nextAnnPano,
            displayKey: newKey,
          };
        })
      );
      applyIntrinsicAspectToAsset(id, width, height);
      scheduleCompanionPersistResult(id, newKey, dataUrl);
      onLog?.(
        'info',
        writeBackKind === 'split_stretch'
          ? `大图预览：线分割变形已写入新步骤（${width}×${height}）`
          : `大图预览：改尺寸已写入新步骤（${width}×${height}）`
      );
      supersedeWorkflowOverlaySnapshotsForAsset(id);
    },
    [applyIntrinsicAspectToAsset, onLog, scheduleCompanionPersistResult, setAssets]
  );

  const applyLightboxManualCrops = useCallback(async () => {
    const id = lightboxAssetId;
    if (!id) return;
    const srcAsset = assets.find((x) => x.id === id);
    if (!srcAsset || !assetLightboxRasterEligible(srcAsset)) return;
    const src = getLightboxPreviewImageSrc(srcAsset);
    if (!src.trim()) return;
    const panoCrop = lightboxOverlayDraft.panoViewportCrop;
    const crops = lightboxOverlayDraft.crops;
    const bakeItems = lightboxOverlayDraft.items;
    const outs: string[] = [];

    if (panoCrop) {
      const proj = lightboxPanoViewerRef.current;
      if (!proj) {
        onLog?.('warn', '全景矩形裁切需要在大图预览的「全景」模式下应用，请切换到全景后再试');
        return;
      }
      const snap = proj.captureViewDataUrl('image/png');
      if (!snap) {
        onLog?.('warn', '无法截取当前全景画面，请稍后重试');
        return;
      }
      const u = await cropDataUrlByViewportNorm(snap, panoCrop);
      if (u) outs.push(u);
      else onLog?.('warn', '全景裁切生成失败');
    } else if (crops.length > 0) {
      for (const c of crops) {
        const u = await rasterizeCropRegion(src, c, { bakeItems });
        if (u) outs.push(u);
      }
      if (outs.length === 0) {
        onLog?.('warn', '裁切生成失败（可能为跨域图源，请改用站内或 data URL 图）');
        return;
      }
    } else {
      onLog?.('warn', '请先添加矩形或套索裁切区域（全景下请用矩形裁切框选视口区域）');
      return;
    }

    if (outs.length === 0) {
      onLog?.('warn', '裁切生成失败');
      return;
    }

    setAssets((prev) => {
      const sourceAsset = prev.find((x) => x.id === id);
      if (!sourceAsset) return prev;

      const usedLabels = new Set<string>(prev.flatMap((a) => (a.groupLabel ? [a.groupLabel] : [])));
      const newAssets: WorkflowAsset[] = outs.map((original) =>
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
      const newIds = newAssets.map((x) => x.id);

      const existingGroupId = sourceAsset.groupId;
      if (existingGroupId) {
        const gi = prev.findIndex((a) => a.id === existingGroupId && isGroupAsset(a));
        if (gi >= 0) {
          const g = prev[gi]!;
          const prevIds = g.assetIds ?? [];
          const merged = [...prevIds, ...newIds];
          const label = g.groupLabel ?? '组';
          let next = prev.map((a, i) => (i === gi ? { ...g, assetIds: merged } : a));
          next = [
            ...next,
            ...newAssets.map((a, i) => ({
              ...a,
              groupId: g.id,
              groupLabel: label,
              groupOrder: prevIds.length + i,
            })),
          ];
          for (const a of newAssets) {
            const o = String(a.original || '').trim();
            if (o) queueMicrotask(() => scheduleCompanionPersistOriginalAny(a.id, o));
          }
          const go = String(g.original || '').trim();
          if (go) queueMicrotask(() => scheduleCompanionPersistOriginalAny(g.id, go));
          return next;
        }
      }

      const groupId = uuid();
      const groupLabel = getRandomGroupCodeName(usedLabels);
      const assetIds = [sourceAsset.id, ...newIds];
      const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
        id: groupId,
        isGroup: true,
        original: sourceAsset.original,
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
        ...prev.map((a) => {
          if (a.id === sourceAsset.id) {
            return { ...a, groupId, groupLabel, groupOrder: 0 };
          }
          return a;
        }),
        ...newAssets.map((a, i) => ({
          ...a,
          groupId,
          groupLabel,
          groupOrder: i + 1,
        })),
        newGroup,
      ];
      for (const a of newAssets) {
        const o = String(a.original || '').trim();
        if (o) queueMicrotask(() => scheduleCompanionPersistOriginalAny(a.id, o));
      }
      const go = String(newGroup.original || '').trim();
      if (go) queueMicrotask(() => scheduleCompanionPersistOriginalAny(newGroup.id, go));
      return next;
    });

    onLightboxOverlayPatch((d) => ({ ...d, crops: [], panoViewportCrop: undefined }));
    onLog?.('info', `已生成 ${outs.length} 张透明 PNG 裁切并入组（已合成当前标注层）`);
  }, [
    assets,
    getLightboxPreviewImageSrc,
    lightboxAssetId,
    lightboxOverlayDraft.crops,
    lightboxOverlayDraft.items,
    lightboxOverlayDraft.panoViewportCrop,
    onLightboxOverlayPatch,
    onLog,
    scheduleCompanionPersistOriginalAny,
    setAssets,
  ]);

  const setDisplayKey = (assetId: string, key: string) => {
    setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, displayKey: key } : a)));
  };

  /** 文字/图片/组内子项：统一用 resultOrder 版本链（与滚轮切换一致），不按资产类型区分 */
  const getDisplayKeysForAsset = (a: WorkflowAsset): string[] => {
    if (isWorkflowStoryboardTableAsset(a)) return ['original'];
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
      const base = String(getCompanionLocalBaseUrl() || '').trim();
      const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
      const plans: Array<{ src: WorkflowAsset; newId: string }> = [];
      for (const id of sourceIds) {
        const src = assets.find((a) => a.id === id);
        if (!src) continue;
        plans.push({ src, newId: uuid() });
      }
      if (plans.length === 0) return;
      const newIds = plans.map((p) => p.newId);
      setAssets((prev) => {
        const copies: WorkflowAsset[] = plans.map(({ src, newId }) => {
          if (isWorkflowStoryboardTableAsset(src)) {
            return duplicateStoryboardTableOnAsset(src, newId);
          }
          const { modelCompanionKeys: _omitModelKeys, ...rest } = src;
          return {
            ...rest,
            id: newId,
            modelCompanionKeys: undefined,
            archived: false,
            hiddenInGrid: false,
            createdAt: Date.now(),
          };
        });
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
      if (!base || !pid) return;
      for (const p of plans) {
        const has =
          (p.src.modelCompanionKeys?.some(Boolean) ?? false) ||
          (p.src.modelUrls || []).some((u) => /^blob:|^https?:|^data:/i.test(String(u || '').trim()));
        if (!has) continue;
        void cloneWorkflowModelSlotsForDuplicatedAsset({
          baseUrl: base,
          projectId: pid,
          sourceAsset: p.src,
          newAssetId: p.newId,
        }).then((r) => {
          if (!r) return;
          setAssets((prev) =>
            prev.map((a) =>
              a.id === p.newId ? { ...a, modelUrls: r.modelUrls, modelCompanionKeys: r.modelCompanionKeys } : a
            )
          );
        });
      }
    },
    [assets, setAssets, workspaceProjectChrome?.activeProjectId]
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
        if (spacePanEnabledRef.current) return;
        e.preventDefault();
      }
    };
    document.addEventListener('wheel', handler, { passive: false, capture: true });
    return () => document.removeEventListener('wheel', handler, { capture: true });
  }, []);

  const discardResult = (assetId: string, actionType: string) => {
    const cur = assetsRef.current.find((a) => a.id === assetId);
    if (!cur) return;
    if (actionType === 'original' || actionType === 'group_preview') return;
    if (cur.vgp && isVgpBlockingDiscardForDisplayKey(cur.vgp, actionType)) {
      appendWorkflowAuditEvent({
        level: 'warn',
        code: WORKFLOW_AUDIT_CODES.DISCARD_BLOCKED_VGP,
        assetId,
        displayKey: actionType,
        message: '丢弃版本被 VGP 后续版本引用，已阻止',
      });
      onLog?.('warn', '丢弃版本被 VGP 引用链阻止（已写入会话审计环）');
      return;
    }
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== assetId) return a;

        const prunedVgp = a.vgp ? pruneVgpAfterDiscard(a.vgp, actionType) : undefined;
        const nextVgp = prunedVgp ?? a.vgp;

        const nextResults = { ...a.results };
        delete nextResults[actionType];
        const nextTextResults = { ...(a.textResults || {}) };
        delete nextTextResults[actionType];
        const nextRc = { ...(a.resultsCompanionKeys || {}) };
        delete nextRc[actionType];
        const nextOrder = (a.resultOrder || []).filter((k) => k !== actionType);
        const nextMeta = { ...a.resultMeta };
        delete nextMeta[actionType];
        const nextOverlay = { ...(a.imageOverlayAnnotations || {}) };
        delete nextOverlay[actionType];
        const nextOverlayPano = { ...(a.imageOverlayAnnotationsPano || {}) };
        delete nextOverlayPano[actionType];
        const nextTags = { ...(a.imageTags || {}) };
        delete nextTags[actionType];
        const nextTagStage = { ...(a.imageTagStage || {}) };
        delete nextTagStage[actionType];
        const displayKey = a.displayKey === actionType ? 'original' : a.displayKey;
        return {
          ...a,
          vgp: nextVgp,
          results: nextResults,
          textResults: nextTextResults,
          resultOrder: nextOrder,
          resultMeta: nextMeta,
          displayKey,
          resultsCompanionKeys: Object.keys(nextRc).length ? nextRc : undefined,
          imageOverlayAnnotations: Object.keys(nextOverlay).length ? nextOverlay : undefined,
          imageOverlayAnnotationsPano: Object.keys(nextOverlayPano).length ? nextOverlayPano : undefined,
          imageTags: Object.keys(nextTags).length ? nextTags : undefined,
          imageTagStage: Object.keys(nextTagStage).length ? nextTagStage : undefined,
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
    if (!snapshot || !assetLightboxRasterEligible(snapshot)) return;
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
          textModelRegistryId: capabilityTextModel,
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
      if (removed) {
        if (isWorkflowStoryboardTableAsset(removed)) {
          onStoryboardTableAssetRemoved?.(assetId);
        }
        revokeWorkflowModelBlobUrlsAfterAssetRemoved(removed, next);
      }
      return next;
    });
    setPending((prev) => prev.filter((t) => t.assetId !== assetId));
    if (lightboxAssetId === assetId) setLightboxAssetId(null);
    if (archivedDetailAssetId === assetId) setArchivedDetailAssetId(null);
    if (storyboardPanelAssetId === assetId) setStoryboardPanelAssetId(null);
    // 如果删除的是当前查看的组，清除组筛选
    if (groupFilterId === assetId) setGroupFilterId(null);
  }, [lightboxAssetId, archivedDetailAssetId, groupFilterId, storyboardPanelAssetId, onStoryboardTableAssetRemoved, setAssets, setPending]);

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

  type GroupFlattenPreview = { src: string; mediaVariant: 'image' | 'video' };
  const flattenGroupImages = useCallback(
    (asset: WorkflowAsset, visited: Set<string> = new Set()): GroupFlattenPreview[] => {
      if (visited.has(asset.id)) return [];
      visited.add(asset.id);
      const out: GroupFlattenPreview[] = [];

      // 新版：使用 assetIds
      if (asset.isGroup === true && asset.assetIds?.length) {
        for (const childId of asset.assetIds) {
          const child = assets.find((x) => x.id === childId);
          if (!child) continue;
          if (isGroupAsset(child)) {
            out.push(...flattenGroupImages(child, visited));
          } else {
            const img = getAssetDisplayImage(child);
            if (img)
              out.push({
                src: img,
                mediaVariant: workflowResultUsesVideoPreview(child) ? 'video' : 'image',
              });
          }
        }
        return out;
      }

      // 旧版：使用 cutImageGroup
      for (const item of asset.cutImageGroup ?? []) {
        if (typeof item === 'string') {
          const s = item;
          out.push({
            src: s,
            mediaVariant: s.startsWith('data:video/') ? 'video' : 'image',
          });
        } else if (item && typeof item === 'object' && 'r2Key' in item) continue;
        else if (item && typeof item === 'object' && 'assetId' in item) {
          const child = assets.find((x) => x.id === item.assetId);
          if (!child) continue;
          if (isGroupAsset(child)) {
            out.push(...flattenGroupImages(child, visited));
          } else {
            const img = getAssetDisplayImage(child);
            if (img)
              out.push({
                src: img,
                mediaVariant: workflowResultUsesVideoPreview(child) ? 'video' : 'image',
              });
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
        overrideImageModelRegistryId?: string;
        /** @deprecated */
        overrideImageGear?: CustomAppModule['imageGear'];
        overrideTextModelRegistryId?: string;
        overrideImageAspectRatio?: string;
        overrideImageSize?: string;
        overrideSkipUnderstand?: boolean;
        tripoMultiviewImages?: WorkflowPendingTask['tripoMultiviewImages'];
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
          ...(opts?.overrideImageModelRegistryId || opts?.overrideImageGear
            ? {
                overrideImageModelRegistryId: coerceImageModelRegistryId(
                  opts.overrideImageModelRegistryId ?? opts.overrideImageGear
                ),
              }
            : {}),
          ...(opts?.overrideTextModelRegistryId
            ? { overrideTextModelRegistryId: coerceTextModelRegistryId(opts.overrideTextModelRegistryId) }
            : {}),
          ...(opts?.overrideImageAspectRatio ? { overrideImageAspectRatio: opts.overrideImageAspectRatio } : {}),
          ...(opts?.overrideImageSize ? { overrideImageSize: opts.overrideImageSize } : {}),
          ...(typeof opts?.overrideSkipUnderstand === 'boolean'
            ? { overrideSkipUnderstand: opts.overrideSkipUnderstand }
            : {}),
          ...(opts?.tripoMultiviewImages ? { tripoMultiviewImages: opts.tripoMultiviewImages } : {}),
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
      const members = assetIds.filter((id) => assets.find((x) => x.id === id) != null);
      if (members.length < 2) return;
      setAssets((prev) => {
        const r = insertManualGroupForAssetIds(prev, members);
        if (r.createdGroup) {
          const cg = r.createdGroup;
          queueMicrotask(() => scheduleCompanionPersistOriginalAny(cg.id, cg.coverImage));
        }
        return r.next;
      });
      setSelectedAssetIds(new Set());
    },
    [assets, insertManualGroupForAssetIds, scheduleCompanionPersistOriginalAny, setAssets, setSelectedAssetIds]
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

  const quickComposeModeStorageKey = useMemo(
    () => scopedStorageKey('workflow_quick_compose_mode', preferenceScope),
    [preferenceScope]
  );

  /** 仅用于参考图上限、生图参数条：与当前「图」模式档位一致 */
  const quickComposeModule = useMemo((): CustomAppModule | null => {
    if (quickComposeMode !== 'image') return null;
    const base = getQuickComposePlainModule(QUICK_COMPOSE_PLAIN_T2I_ACTION_ID);
    if (!base) return null;
    return {
      ...base,
      imageModelRegistryId: coerceImageModelRegistryId(quickComposeImageModel),
    };
  }, [quickComposeMode, quickComposeImageModel]);

  const quickComposeMaxReferenceImages = useMemo(() => {
    if (quickComposeMode === 'text') return 10;
    if (quickComposeMode === '3d') return 1;
    return maxReferenceImagesForImageModel(quickComposeImageModel);
  }, [quickComposeMode, quickComposeImageModel]);

  const lightboxCurrentViewPreviewSrc = useMemo(() => {
    if (!lightboxAssetId) return '';
    const a = assets.find((x) => x.id === lightboxAssetId);
    return a && assetLightboxRasterEligible(a) ? getAssetDisplayImage(a).trim() : '';
  }, [assets, assetLightboxRasterEligible, getAssetDisplayImage, lightboxAssetId]);

  const quickComposeMentionCandidates = useMemo(
    () =>
      listDropSlotMentionCandidates(quickComposeDropSlots, quickComposeMentions, {
        includeCurrentView: Boolean(lightboxAssetId),
        currentViewPreviewSrc: lightboxCurrentViewPreviewSrc || undefined,
      }),
    [quickComposeDropSlots, quickComposeMentions, lightboxAssetId, lightboxCurrentViewPreviewSrc]
  );

  const appendQuickComposeDropSlotsForAssetIds = useCallback(
    (assetIds: string[]) => {
      let added = 0;
      setQuickComposeDropSlots((prev) => {
        const next = [...prev];
        for (const id of assetIds) {
          const a = assetsRef.current.find((x) => x.id === id);
          if (!a || isGroupAsset(a) || !assetLightboxRasterEligible(a)) continue;
          const previewSrc = getAssetDisplayImage(a).trim();
          if (!previewSrc) continue;
          if (next.some((s) => s.assetId === id)) continue;
          next.push({
            assetId: id,
            previewSrc,
            label: workflowAssetMentionLabel(a),
          });
          added += 1;
        }
        return next;
      });
      if (added > 0) {
        onLog?.('info', `底部快捷栏：已拖入 ${added} 张参考图（点击 @ 引用，拖出待 @ 区可移除）`);
      } else if (assetIds.length > 0) {
        onLog?.('warn', '底部快捷栏：拖入项无可用预览图');
      }
    },
    [getAssetDisplayImage, onLog]
  );

  const removeQuickComposeDropSlot = useCallback(
    (assetId: string) => {
      const id = assetId.trim();
      if (!id) return;
      setQuickComposeDropSlots((prev) => {
        if (!prev.some((s) => s.assetId === id)) return prev;
        return prev.filter((s) => s.assetId !== id);
      });
    },
    []
  );

  const quickComposeShowGenImageSettings = quickComposeMode === 'image';
  const quickComposeShowGenTextSettings = quickComposeMode === 'text';

  const quickComposeAllowBatchCount = quickComposeMode === 'text' || quickComposeMode === 'image';

  useEffect(() => {
    if (!quickComposeAllowBatchCount) setQuickComposeCount(1);
  }, [quickComposeAllowBatchCount]);

  useEffect(() => {
    const saved = readLocalJson<WorkspaceQuickComposeComposeMode | ''>(
      quickComposeModeStorageKey,
      '',
      (parsed) => (parsed === 'text' || parsed === 'image' || parsed === '3d' ? parsed : null)
    );
    if (saved) setQuickComposeMode(saved);
  }, [quickComposeModeStorageKey]);

  useEffect(() => {
    writeLocalJson(quickComposeModeStorageKey, quickComposeMode);
  }, [quickComposeMode, quickComposeModeStorageKey]);

  const lightboxAnnotationPrefsKey = useMemo(
    () => scopedStorageKey('workflow_lightbox_annotation_prefs', preferenceScope),
    [preferenceScope]
  );

  useEffect(() => {
    const p = readLightboxAnnotationPrefs(lightboxAnnotationPrefsKey);
    setLightboxRememberedLocal(p.lastLocalEditTool);
    setLightboxRememberedCrop(p.lastCropTool);
    setLightboxOverlayColor(p.overlayColor);
    setLightboxBrushWidth(p.brushWidth);
  }, [lightboxAnnotationPrefsKey]);

  const applyLightboxToolChange = useCallback(
    (t: ImageFlatAnnotationTool) => {
      if (t !== 'off') {
        setLightboxSamPickArmed(false);
      }
      setLightboxOverlayTool(t);
      const disk = readLightboxAnnotationPrefs(lightboxAnnotationPrefsKey);
      const nextLocal =
        t === 'local_edit_rect' || t === 'local_edit_ellipse' || t === 'local_edit_lasso'
          ? t
          : disk.lastLocalEditTool;
      const nextCrop = t === 'crop_rect' || t === 'crop_lasso' ? t : disk.lastCropTool;
      if (t === 'local_edit_rect' || t === 'local_edit_ellipse' || t === 'local_edit_lasso') {
        setLightboxRememberedLocal(t);
      }
      if (t === 'crop_rect' || t === 'crop_lasso') {
        setLightboxRememberedCrop(t);
      }
      writeLightboxAnnotationPrefs(lightboxAnnotationPrefsKey, {
        v: 1,
        lastLocalEditTool: nextLocal,
        lastCropTool: nextCrop,
        overlayColor: lightboxOverlayColor,
        brushWidth: lightboxBrushWidth,
      });
    },
    [lightboxAnnotationPrefsKey, lightboxOverlayColor, lightboxBrushWidth]
  );

  useEffect(() => {
    if (lightboxSamPickArmed && !lightboxSamArmEdgeRef.current) {
      applyLightboxToolChange('off');
      if (lightboxSamBackendMode === 'stub') {
        onLog?.(
          'warn',
          '分割：当前 SamLocal 为 stub，只会生成点击处小圆斑（联调用），不会按物体抠出整块区域。请设置环境变量 SAM_MODE=sam、安装 ViT-B 权重并重启 SamLocal。',
        );
      } else {
        onLog?.(
          'info',
          lightboxSamBackendMode === 'sam'
            ? '分割：左键前景点、右键背景点；「框」模式拖矩形。撤销与标注相同（Ctrl/⌘+Z）。菜单内「运行」提交。Esc 取消武装。'
            : '分割：左键前景点、右键背景点；「框」模式拖矩形。若结果只是一小圆，请将 SamLocal 设为 SAM_MODE=sam（非 stub）。菜单内「运行」提交。Esc 取消武装。',
        );
      }
    }
    lightboxSamArmEdgeRef.current = lightboxSamPickArmed;
  }, [lightboxSamPickArmed, applyLightboxToolChange, onLog, lightboxSamBackendMode]);

  useEffect(() => {
    if (!lightboxAssetId) {
      setLightboxSamPickArmed(false);
      setLightboxSamBusy(false);
      setLightboxSamSessionPoints([]);
      setLightboxSamBoxPx(null);
      setLightboxSamMetrics(null);
      setLightboxSamPickSubmode('point');
      setLightboxSamMultimaskChoice(null);
      setLightboxSamMultimaskIndex(0);
      setLightboxSamBackendMode('unknown');
      setLightboxSamInstallModalOpen(false);
    }
  }, [lightboxAssetId]);

  useEffect(() => {
    if (!lightboxSamSegmentToolbarVisible || !lightboxAssetId) {
      return;
    }
    const base = normalizeCompanionBaseUrl(String(getCompanionLocalBaseUrl() || '').trim());
    if (!base) {
      setLightboxSamBackendMode('unknown');
      return;
    }
    let cancelled = false;
    void probeCompanionSamSegmentHealth(base).then((r) => {
      if (cancelled) return;
      if (!r.ok || r.body == null || typeof r.body !== 'object') {
        setLightboxSamBackendMode('unknown');
        return;
      }
      const root = r.body as { samLocal?: { body?: { mode?: string } } };
      const m = String(root.samLocal?.body?.mode ?? '').toLowerCase();
      if (m === 'stub' || m === 'sam') setLightboxSamBackendMode(m);
      else setLightboxSamBackendMode('unknown');
    });
    return () => {
      cancelled = true;
    };
  }, [lightboxSamSegmentToolbarVisible, lightboxAssetId]);

  useEffect(() => {
    if (!lightboxSamPickArmed && !lightboxSamBusy) {
      setLightboxSamSessionPoints([]);
      setLightboxSamBoxPx(null);
      setLightboxSamMetrics(null);
      setLightboxSamPickSubmode('point');
    }
  }, [lightboxSamPickArmed, lightboxSamBusy]);

  useEffect(() => {
    setLightboxSamMultimaskChoice(null);
    setLightboxSamMultimaskIndex(0);
    setLightboxSamUnsaved(null);
    setLightboxSamPreviewCompositeHref(undefined);
    setLightboxSamUxMode('prompt');
    setLightboxSamAutoLayer(null);
    setLightboxSamAutoPicked([]);
    setLightboxSamAutoHover(null);
    setLightboxRembgPreview(null);
    setLightboxRembgBusy(false);
    setLightboxSamInstallModalOpen(false);
  }, [lightboxAssetId]);

  useEffect(() => {
    setLightboxRembgPreview(null);
  }, [lightboxAsset?.displayKey]);

  useEffect(() => {
    if (!lightboxSamPickArmed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isWorkflowEditableTarget(e.target)) return;
      if (lightboxSamToolbarMenuOpenRef.current) return;
      setLightboxSamPickArmed(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [lightboxSamPickArmed]);

  useEffect(() => {
    if (lightboxPreviewLayout !== 'flat') {
      setLightboxSamPickArmed(false);
    }
  }, [lightboxPreviewLayout]);

  const toggleLightboxSamArm = useCallback(() => {
    if (lightboxSamBusy) return;
    setLightboxSamPickArmed((prev) => {
      const next = !prev;
      if (next) {
        setLightboxSamSessionPoints([]);
        setLightboxSamBoxPx(null);
        setLightboxSamMetrics(null);
        setLightboxSamPickSubmode('point');
        setLightboxSamMultimaskChoice(null);
        setLightboxSamMultimaskIndex(0);
      }
      return next;
    });
  }, [lightboxSamBusy]);

  const onLightboxSamMenuOpenChange = useCallback(
    (open: boolean) => {
      if (lightboxSamBusy && open) return;
      if (!lightboxSamSegmentUiAllowed && open) return;
      if (!open && lightboxSamUxMode === 'auto' && lightboxSamAutoLayer) {
        return;
      }
      setLightboxSamPickArmed(open);
    },
    [lightboxSamBusy, lightboxSamSegmentUiAllowed, lightboxSamUxMode, lightboxSamAutoLayer]
  );

  const handleLightboxSamPointAdd = useCallback(
    (pt: { ix: number; iy: number; nw: number; nh: number; label: 0 | 1 }) => {
      if (!lightboxSamSegmentUiAllowed || lightboxSamBusy) return;
      setLightboxSamMetrics({ nw: pt.nw, nh: pt.nh });
      setLightboxSamSessionPoints((prev) => [...prev, { ix: pt.ix, iy: pt.iy, label: pt.label }]);
    },
    [lightboxSamSegmentUiAllowed, lightboxSamBusy]
  );

  const handleLightboxSamBoxCommit = useCallback(
    (
      box: { x1: number; y1: number; x2: number; y2: number; nw: number; nh: number } | null
    ) => {
      if (!lightboxSamSegmentUiAllowed || lightboxSamBusy) return;
      if (!box) {
        setLightboxSamBoxPx(null);
        return;
      }
      setLightboxSamMetrics({ nw: box.nw, nh: box.nh });
      setLightboxSamBoxPx(box);
    },
    [lightboxSamSegmentUiAllowed, lightboxSamBusy]
  );

  const handleLightboxSamPickHint = useCallback(
    (m: string) => {
      onLog?.('warn', m);
    },
    [onLog]
  );

  const clearLightboxSamPrompts = useCallback(() => {
    if (!lightboxSamSegmentUiAllowed || lightboxSamBusy || !lightboxSamPickArmed) return;
    setLightboxSamSessionPoints([]);
    setLightboxSamBoxPx(null);
  }, [lightboxSamSegmentUiAllowed, lightboxSamBusy, lightboxSamPickArmed]);

  const lightboxSamHasPrompts = useMemo(
    () =>
      lightboxSamPickArmed &&
      !lightboxSamBusy &&
      (lightboxSamSessionPoints.length > 0 || lightboxSamBoxPx != null),
    [lightboxSamPickArmed, lightboxSamBusy, lightboxSamSessionPoints.length, lightboxSamBoxPx]
  );

  const applyLightboxSamMultimaskIndex = useCallback((idx: number) => {
    const ch = lightboxSamMultimaskChoiceRef.current;
    if (!ch || idx < 0 || idx >= ch.dataUrls.length) return;
    setLightboxSamMultimaskIndex(idx);
    setLightboxSamUnsaved((p) => {
      if (!p?.previewLayers.length) return p;
      const u = ch.dataUrls[idx];
      if (typeof u !== 'string' || !u.trim()) return p;
      const next = [...p.previewLayers];
      next[next.length - 1] = u.trim();
      return { ...p, previewLayers: next };
    });
  }, []);

  const executeLightboxSamSegment = useCallback(async () => {
    if (lightboxSamBusy) return;
    const m = lightboxSamMetrics;
    const hasPts = lightboxSamSessionPoints.length > 0;
    const boxOk =
      lightboxSamBoxPx &&
      Math.abs(lightboxSamBoxPx.x2 - lightboxSamBoxPx.x1) >= 1 &&
      Math.abs(lightboxSamBoxPx.y2 - lightboxSamBoxPx.y1) >= 1;
    if (!m || m.nw < 1 || m.nh < 1 || (!hasPts && !boxOk)) {
      onLog?.('warn', '分割：请先在大图上添加点或框选区域，再点「运行」');
      return;
    }
    const id = lightboxAssetIdRef.current;
    const asset = assetsRef.current.find((a) => a.id === id);
    const projectId = workspaceProjectChrome?.activeProjectId?.trim();
    if (!asset || !assetLightboxRasterEligible(asset)) {
      onLog?.('warn', '分割：当前无可分割的图像资产');
      setLightboxSamPickArmed(false);
      return;
    }
    if (!projectId) {
      onLog?.('warn', '分割：请先选择工作区项目（本地伴侣按项目落盘）');
      setLightboxSamPickArmed(false);
      return;
    }
    const box =
      lightboxSamBoxPx && boxOk
        ? {
            x1: Math.min(lightboxSamBoxPx.x1, lightboxSamBoxPx.x2),
            y1: Math.min(lightboxSamBoxPx.y1, lightboxSamBoxPx.y2),
            x2: Math.max(lightboxSamBoxPx.x1, lightboxSamBoxPx.x2),
            y2: Math.max(lightboxSamBoxPx.y1, lightboxSamBoxPx.y2),
          }
        : null;
    const session: LightboxSamSegmentSession = {
      nw: m.nw,
      nh: m.nh,
      points: lightboxSamSessionPoints,
      box,
    };
    setLightboxSamMultimaskChoice(null);
    setLightboxSamMultimaskIndex(0);
    setLightboxSamPickArmed(false);
    setLightboxSamBusy(true);
    setLightboxSamInstallModalOpen(false);
    onLog?.('info', '分割：正在上传当前预览图并提交分割…');
    const prevU = lightboxSamUnsavedRef.current;
    const resultKey =
      prevU?.assetId === asset.id && prevU?.resultKey
        ? prevU.resultKey
        : `ac_internal_sam_${uuid().replace(/-/g, '').slice(0, 14)}`;
    const src = getLightboxPreviewImageSrc(asset);
    try {
      const run = await runLightboxSamSegmentFromSession({
        projectId,
        assetId: asset.id,
        displayKey: asset.displayKey,
        imageSrc: src,
        session,
        resultKey,
      });
      if (run.ok === false) {
        const zh = humanMessageForSamSegmentFailure(run.code, run.error);
        onLog?.('error', run.code ? `${zh}（${run.code}）` : zh);
        if (isSamInstallHelpCode(run.code)) {
          setLightboxSamInstallModalOpen(true);
        }
        return;
      }
      const layerUrl = run.multimask?.dataUrls?.[0] ?? run.resultDataUrl;
      setLightboxSamUnsaved((prev) => {
        const same = prev?.assetId === asset.id && prev?.resultKey === resultKey;
        const previewLayers = same && prev ? [...prev.previewLayers, layerUrl] : [layerUrl];
        return {
          assetId: asset.id,
          resultKey,
          outputCompanionKey: run.outputCompanionKey,
          previewLayers,
        };
      });
      if (run.multimask && run.multimask.dataUrls.length > 1) {
        setLightboxSamMultimaskChoice({
          dataUrls: run.multimask.dataUrls,
          companionKeys: run.multimask.companionKeys,
          resultKey,
          assetId: asset.id,
        });
        setLightboxSamMultimaskIndex(0);
      } else {
        setLightboxSamMultimaskChoice(null);
        setLightboxSamMultimaskIndex(0);
      }
      onLog?.(
        'info',
        '分割完成：已叠入预览（可再次运行叠加多区域）。满意后点「保存到资产」。',
      );
    } catch (e) {
      onLog?.('error', `分割异常：${normalizeApiErrorMessage(e)}`);
    } finally {
      setLightboxSamBusy(false);
    }
  }, [
    lightboxSamBusy,
    lightboxSamMetrics,
    lightboxSamSessionPoints,
    lightboxSamBoxPx,
    workspaceProjectChrome?.activeProjectId,
    getLightboxPreviewImageSrc,
    onLog,
  ]);

  const commitLightboxSamSave = useCallback(() => {
    const pending = lightboxSamUnsaved;
    const aid = lightboxAssetIdRef.current;
    const projectId = workspaceProjectChrome?.activeProjectId?.trim();
    const base = normalizeCompanionBaseUrl(String(getCompanionLocalBaseUrl() || '').trim());
    if (!pending || !aid || pending.assetId !== aid || lightboxSamBusy) return;
    if (!pending.previewLayers.length) return;
    if (!projectId || !base) {
      onLog?.('warn', '分割：请先选择工作区项目并连接本地伴侣后再保存');
      return;
    }
    void (async () => {
      const composite = await unionMaskDataUrlsToDataUrl(pending.previewLayers);
      if (!composite) {
        onLog?.('warn', '分割：合成 mask 失败，无法保存');
        return;
      }
      const put = await putWorkflowResultImageToCompanion(
        base,
        projectId,
        pending.assetId,
        pending.resultKey,
        composite
      );
      if (put.ok === false) {
        onLog?.('error', `分割保存上传失败：${put.error}`);
        return;
      }
      const now = Date.now();
      const { resultKey } = pending;
      setAssets((prev) =>
        prev.map((a) => {
          if (a.id !== pending.assetId) return a;
          const nextResults = { ...a.results, [resultKey]: composite };
          const order = [...(a.resultOrder || []).filter((k) => k !== resultKey), resultKey];
          const nextRck = { ...(a.resultsCompanionKeys || {}), [resultKey]: put.key };
          const nextMeta = {
            ...(a.resultMeta || {}),
            [resultKey]: { executedAt: now, displayStepLabel: '分割', mediaKind: 'image' as const },
          };
          return {
            ...a,
            results: nextResults,
            resultOrder: order,
            resultsCompanionKeys: nextRck,
            resultMeta: nextMeta,
            displayKey: resultKey,
          };
        })
      );
      setLightboxSamUnsaved(null);
      setLightboxSamMultimaskChoice(null);
      setLightboxSamMultimaskIndex(0);
      setLightboxSamPreviewCompositeHref(undefined);
      onLog?.('info', '分割已保存为新版本（PNG mask），可用滚轮在版本间切换。');
    })();
  }, [lightboxSamUnsaved, lightboxSamBusy, workspaceProjectChrome?.activeProjectId, setAssets, onLog]);

  const discardLightboxRembgPreview = useCallback(() => {
    setLightboxRembgPreview(null);
  }, []);

  const commitLightboxRembgApply = useCallback(() => {
    const pending = lightboxRembgPreview;
    const aid = lightboxAssetIdRef.current;
    const projectId = workspaceProjectChrome?.activeProjectId?.trim();
    const base = normalizeCompanionBaseUrl(String(getCompanionLocalBaseUrl() || '').trim());
    if (!pending || !aid || pending.assetId !== aid || lightboxRembgBusy) return;
    if (!projectId || !base) {
      onLog?.('warn', '抠图：请先选择工作区项目并连接本地伴侣后再应用');
      return;
    }
    void (async () => {
      const put = await putWorkflowResultImageToCompanion(
        base,
        projectId,
        pending.assetId,
        pending.resultKey,
        pending.dataUrl
      );
      if (put.ok === false) {
        onLog?.('error', `抠图保存上传失败：${put.error}`);
        return;
      }
      const now = Date.now();
      const { resultKey } = pending;
      const previewUrl = pending.dataUrl;
      setAssets((prev) =>
        prev.map((a) => {
          if (a.id !== pending.assetId) return a;
          const nextResults = { ...a.results, [resultKey]: previewUrl };
          const order = [...(a.resultOrder || []).filter((k) => k !== resultKey), resultKey];
          const nextRck = { ...(a.resultsCompanionKeys || {}), [resultKey]: put.key };
          const nextMeta = {
            ...(a.resultMeta || {}),
            [resultKey]: { executedAt: now, displayStepLabel: '抠图', mediaKind: 'image' as const },
          };
          return {
            ...a,
            results: nextResults,
            resultOrder: order,
            resultsCompanionKeys: nextRck,
            resultMeta: nextMeta,
            displayKey: resultKey,
          };
        })
      );
      setLightboxRembgPreview(null);
      onLog?.('info', '抠图已应用为新版本（RGBA PNG），可用滚轮在版本间切换。');
    })();
  }, [lightboxRembgPreview, lightboxRembgBusy, workspaceProjectChrome?.activeProjectId, setAssets, onLog]);

  const runLightboxRembg = useCallback(async () => {
    const aid = lightboxAssetId;
    const asset = aid ? assets.find((a) => a.id === aid) : null;
    const projectId = workspaceProjectChrome?.activeProjectId?.trim();
    const base = normalizeCompanionBaseUrl(String(getCompanionLocalBaseUrl() || '').trim());
    if (!asset || !projectId || !base) {
      onLog?.('warn', '抠图：请先选择工作区项目并连接本地伴侣');
      return;
    }
    if (!lightboxSamSegmentUiAllowed) return;
    if (lightboxRembgBusy) return;
    setLightboxRembgInstallModalOpen(false);
    setLightboxRembgBusy(true);
    onLog?.('info', '抠图：正在上传并调用本机 rembg…');
    const prevP = lightboxRembgPreviewRef.current;
    const resultKey =
      prevP?.assetId === asset.id && prevP?.resultKey
        ? prevP.resultKey
        : `ac_internal_rembg_${uuid().replace(/-/g, '').slice(0, 14)}`;
    const src = getLightboxPreviewImageSrc(asset);
    try {
      const run = await runLightboxRembgFromImageSrc({
        projectId,
        assetId: asset.id,
        displayKey: asset.displayKey,
        imageSrc: src,
        resultKey,
      });
      if (run.ok === false) {
        const zh = humanMessageForRembgFailure(run.code, run.error);
        onLog?.('error', run.code ? `${zh}（${run.code}）` : zh);
        if (isRembgInstallHelpCode(run.code)) {
          setLightboxRembgInstallModalOpen(true);
        }
        return;
      }
      setLightboxRembgPreview({
        assetId: asset.id,
        resultKey,
        dataUrl: run.resultDataUrl,
        outputCompanionKey: run.outputCompanionKey,
      });
      onLog?.('info', '抠图完成：已叠入预览。满意后点「应用」写入资产，或点「丢弃」。');
    } catch (e) {
      onLog?.('error', `抠图异常：${normalizeApiErrorMessage(e)}`);
    } finally {
      setLightboxRembgBusy(false);
    }
  }, [
    lightboxAssetId,
    assets,
    workspaceProjectChrome?.activeProjectId,
    lightboxSamSegmentUiAllowed,
    lightboxRembgBusy,
    getLightboxPreviewImageSrc,
    onLog,
  ]);

  const exitLightboxSamAuto = useCallback(() => {
    setLightboxSamUxMode('prompt');
    setLightboxSamAutoLayer(null);
    setLightboxSamAutoPicked([]);
    setLightboxSamAutoHover(null);
  }, []);

  const clearLightboxSamPreview = useCallback(() => {
    setLightboxSamUnsaved(null);
    setLightboxSamMultimaskChoice(null);
    setLightboxSamMultimaskIndex(0);
    setLightboxSamPreviewCompositeHref(undefined);
    exitLightboxSamAuto();
  }, [exitLightboxSamAuto]);

  const toggleLightboxSamAutoPick = useCallback((i: number) => {
    setLightboxSamAutoPicked((prev) => {
      const s = new Set<number>(prev);
      if (s.has(i)) s.delete(i);
      else s.add(i);
      return Array.from(s).sort((a, b) => a - b);
    });
  }, []);

  /** 稳定引用，配合 `ImageFlatAnnotationOverlay` 的 `React.memo`，避免父级重绘时冲掉 memo */
  const lightboxImageFlatSamAutoPick = useMemo(() => {
    if (
      !lightboxSamSegmentUiAllowed ||
      !lightboxSamPickArmed ||
      lightboxSamBusy ||
      lightboxSamUxMode !== 'auto' ||
      !lightboxSamAutoLayer ||
      !lightboxAssetId
    ) {
      return null;
    }
    if (lightboxSamAutoLayer.assetId !== lightboxAssetId) return null;
    return {
      maskDataUrls: lightboxSamAutoLayer.dataUrls,
      pickedIndices: lightboxSamAutoPicked,
      hoverIndex: lightboxSamAutoHover,
      onHoverIndex: setLightboxSamAutoHover,
      onTogglePick: toggleLightboxSamAutoPick,
    };
  }, [
    lightboxSamSegmentUiAllowed,
    lightboxSamPickArmed,
    lightboxSamBusy,
    lightboxSamUxMode,
    lightboxSamAutoLayer,
    lightboxAssetId,
    lightboxSamAutoPicked,
    lightboxSamAutoHover,
    toggleLightboxSamAutoPick,
  ]);

  const mergeLightboxSamAutoToLayers = useCallback(() => {
    const layer = lightboxSamAutoLayer;
    const aid = lightboxAssetIdRef.current;
    if (!layer || layer.assetId !== aid || lightboxSamAutoPicked.length === 0) return;
    const urls = lightboxSamAutoPicked
      .map((i) => layer.dataUrls[i])
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
    void unionMaskDataUrlsToDataUrl(urls).then((merged) => {
      if (!merged) return;
      const prevU = lightboxSamUnsavedRef.current;
      const resultKey =
        prevU?.assetId === layer.assetId && prevU?.resultKey
          ? prevU.resultKey
          : `ac_internal_sam_${uuid().replace(/-/g, '').slice(0, 14)}`;
      setLightboxSamUnsaved((prev) => {
        const same = prev?.assetId === layer.assetId && prev?.resultKey === resultKey;
        const previewLayers = same && prev ? [...prev.previewLayers, merged] : [merged];
        return {
          assetId: layer.assetId,
          resultKey,
          outputCompanionKey: layer.companionKeys[0] ?? prev?.outputCompanionKey ?? '',
          previewLayers,
        };
      });
      exitLightboxSamAuto();
      onLog?.('info', '已将勾选区域叠入预览，可继续分割或点「保存到资产」。');
    });
  }, [lightboxSamAutoLayer, lightboxSamAutoPicked, exitLightboxSamAuto, onLog]);

  const executeLightboxSamAuto = useCallback(async () => {
    if (lightboxSamBusy) return;
    const id = lightboxAssetIdRef.current;
    const asset = assetsRef.current.find((a) => a.id === id);
    const projectId = workspaceProjectChrome?.activeProjectId?.trim();
    if (!asset || !assetLightboxRasterEligible(asset) || !projectId) {
      onLog?.('warn', '分割：当前无法执行自动拆分');
      return;
    }
    setLightboxSamAutoLayer(null);
    setLightboxSamAutoPicked([]);
    setLightboxSamAutoHover(null);
    setLightboxSamUxMode('auto');
    setLightboxSamPickArmed(false);
    setLightboxSamInstallModalOpen(false);
    setLightboxSamBusy(true);
    onLog?.('info', '分割：正在全图自动拆分（首次可能较慢）…');
    const resultKey = `ac_internal_sam_${uuid().replace(/-/g, '').slice(0, 14)}`;
    const src = getLightboxPreviewImageSrc(asset);
    try {
      const run = await runLightboxSamAutoSegmentFromImageSrc({
        projectId,
        assetId: asset.id,
        displayKey: asset.displayKey,
        imageSrc: src,
        resultKey,
      });
      if (run.ok === false) {
        const zh = humanMessageForSamSegmentFailure(run.code, run.error);
        onLog?.('error', run.code ? `${zh}（${run.code}）` : zh);
        if (isSamInstallHelpCode(run.code)) {
          setLightboxSamInstallModalOpen(true);
        }
        setLightboxSamUxMode('prompt');
        return;
      }
      setLightboxSamAutoLayer({
        assetId: asset.id,
        resultKey,
        dataUrls: run.multimask.dataUrls,
        companionKeys: run.multimask.companionKeys,
      });
      setLightboxSamPickArmed(true);
      onLog?.(
        'info',
        `分割：已生成 ${run.multimask.dataUrls.length} 块。悬停高亮，点击勾选后点「叠入预览」。`,
      );
    } catch (e) {
      onLog?.('error', `自动拆分异常：${normalizeApiErrorMessage(e)}`);
      setLightboxSamUxMode('prompt');
    } finally {
      setLightboxSamBusy(false);
    }
  }, [lightboxSamBusy, workspaceProjectChrome?.activeProjectId, getLightboxPreviewImageSrc, onLog]);

  const onLightboxOverlayColorChange = useCallback(
    (c: string) => {
      setLightboxOverlayColor(c);
      const disk = readLightboxAnnotationPrefs(lightboxAnnotationPrefsKey);
      writeLightboxAnnotationPrefs(lightboxAnnotationPrefsKey, { ...disk, overlayColor: c });
    },
    [lightboxAnnotationPrefsKey]
  );

  const onLightboxBrushWidthChange = useCallback(
    (n: number) => {
      const clamped = Math.max(1, Math.min(80, Math.round(n)));
      setLightboxBrushWidth(clamped);
      const disk = readLightboxAnnotationPrefs(lightboxAnnotationPrefsKey);
      writeLightboxAnnotationPrefs(lightboxAnnotationPrefsKey, { ...disk, brushWidth: clamped });
    },
    [lightboxAnnotationPrefsKey]
  );

  useEffect(() => {
    if (!lightboxAssetId || !lightboxRasterChrome) return;
    const onKey = (e: KeyboardEvent) => {
      if (isWorkflowEditableTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          if (e.shiftKey) overlayRedo();
          else overlayUndo();
        }
        return;
      }
      const ch = e.key;
      if (ch === 'b' || ch === 'B') {
        e.preventDefault();
        applyLightboxToolChange('brush');
      } else if (ch === 'c' || ch === 'C') {
        e.preventDefault();
        applyLightboxToolChange(lightboxRememberedCrop);
      } else if (ch === 'a' || ch === 'A') {
        e.preventDefault();
        applyLightboxToolChange(lightboxRememberedLocal);
      } else if (ch === 's' || ch === 'S') {
        e.preventDefault();
        if (!workspaceProjectChrome?.activeProjectId?.trim() || lightboxSamBusy) return;
        if (!lightboxSamSegmentUiAllowed) return;
        toggleLightboxSamArm();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [
    lightboxAssetId,
    lightboxRasterChrome,
    overlayRedo,
    overlayUndo,
    applyLightboxToolChange,
    lightboxRememberedCrop,
    lightboxRememberedLocal,
    workspaceProjectChrome?.activeProjectId,
    lightboxSamBusy,
    lightboxSamSegmentUiAllowed,
    toggleLightboxSamArm,
  ]);

  /** 大纲 / 画布拖入底部快捷栏：加入待 @ 缩略图区（点击后再引用） */
  const handleQuickComposeWorkflowDrop = useCallback(
    (e: React.DragEvent) => {
      const sources = resolveCapabilityDropDragSources(
        draggingAssetIds,
        draggingGroupItems,
        e.dataTransfer
      );
      if (sources.length === 0) return;

      const assetIds: string[] = [];
      const pushId = (id: string) => {
        const t = id.trim();
        if (!t || assetIds.includes(t)) return;
        assetIds.push(t);
      };

      for (const source of sources) {
        if (source.kind === 'root') {
          for (const id of getEffectiveAssetIdsForAction(source.assetIds)) {
            pushId(id);
          }
        } else {
          const group = assets.find((x) => x.id === source.groupAssetId);
          const cut = isGroupAsset(group) ? group?.assetIds : group?.cutImageGroup;
          if (!group || !cut?.length) continue;
          for (const itemIndex of source.itemIndexes) {
            const item = cut[itemIndex];
            if (!item) continue;
            if (typeof item === 'string') {
              const child = assets.find((x) => x.id === item);
              if (child && isGroupAsset(child)) {
                const coverId = child.assetIds?.[0];
                if (coverId) pushId(coverId);
              } else if (child) {
                pushId(child.id);
              }
            } else if (item && typeof item === 'object' && 'assetId' in item) {
              pushId((item as { assetId: string }).assetId);
            }
          }
        }
      }

      if (assetIds.length === 0) {
        onLog?.('warn', '底部快捷栏：拖入资产无可用项');
        return;
      }
      appendQuickComposeDropSlotsForAssetIds(assetIds);
    },
    [
      draggingAssetIds,
      draggingGroupItems,
      assets,
      getEffectiveAssetIdsForAction,
      appendQuickComposeDropSlotsForAssetIds,
      onLog,
    ]
  );

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

  const downloadWorkflowAssetsFromSources = useCallback(
    async (sources: WorkflowDragSource[]) => {
      if (!sources.length) {
        onLog?.('warn', '请先选中要下载的资产');
        return;
      }
      const allIds = collectWorkflowAssetIdsFromDragSources(
        sources,
        assetsRef.current,
        ensureGroupItemsAsAssets
      );
      const assetIds = allIds.filter((id) => {
        const a = assetsRef.current.find((x) => x.id === id);
        return a != null && !isWorkflowStoryboardTableAsset(a);
      });
      const skippedStoryboard = allIds.length - assetIds.length;
      if (!assetIds.length) {
        onLog?.(
          'warn',
          skippedStoryboard > 0 ? '分镜表暂不支持下载' : '没有可下载的资产'
        );
        return;
      }
      if (skippedStoryboard > 0) {
        onLog?.('info', `已跳过 ${skippedStoryboard} 个分镜表（暂不支持下载）`);
      }
      const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
      const base = String(getCompanionLocalBaseUrl() || '').trim();
      const { ok, failed } = await downloadWorkflowAssetsByIds(assetIds, assetsRef.current, {
        getAssetDisplayImage,
        getAssetDisplayText,
        companionBaseUrl: base || null,
        companionProjectId: pid || null,
        tripoApiKey: getTripoApiKey(),
      });
      if (ok > 0) onLog?.('info', `已触发 ${ok} 个资产下载`);
      for (const f of failed) {
        onLog?.('warn', `下载跳过 ${f.assetId.slice(0, 8)}：${f.reason}`);
      }
    },
    [ensureGroupItemsAsAssets, getAssetDisplayImage, getAssetDisplayText, onLog, workspaceProjectChrome?.activeProjectId]
  );

  const downloadSelectedWorkflowAssets = useCallback(() => {
    void downloadWorkflowAssetsFromSources(buildWorkflowSelectionDragSources());
  }, [buildWorkflowSelectionDragSources, downloadWorkflowAssetsFromSources]);

  const startTripoMultiviewModalDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      tripoMultiviewModalDragRef.current = {
        offsetX: e.clientX - tripoMultiviewModalPos.x,
        offsetY: e.clientY - tripoMultiviewModalPos.y,
      };
      const onMove = (ev: PointerEvent) => {
        const drag = tripoMultiviewModalDragRef.current;
        if (!drag) return;
        const maxX = Math.max(12, window.innerWidth - 380);
        const maxY = Math.max(12, window.innerHeight - 360);
        setTripoMultiviewModalPos({
          x: Math.min(Math.max(12, ev.clientX - drag.offsetX), maxX),
          y: Math.min(Math.max(12, ev.clientY - drag.offsetY), maxY),
        });
      };
      const onUp = () => {
        tripoMultiviewModalDragRef.current = null;
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
      };
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
    },
    [tripoMultiviewModalPos.x, tripoMultiviewModalPos.y]
  );

  const collectPromptTargetsForModule = useCallback(
    (incoming: WorkflowDragSource[], mod: CustomAppModule): PromptTweakTarget[] => {
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
                ...(isWorkflowTextAsset(a) && workflowAssetCurrentDisplayIsTextChannel(a)
                  ? { inputText: workflowAssetToInputText(a) }
                  : {}),
              });
            }
          });
        } else {
          const group = assets.find((x) => x.id === source.groupAssetId);
          const cut = isGroupAsset(group) ? group?.assetIds : group?.cutImageGroup;
          if (!group || !cut?.length) continue;
          const groupId = group.id;
          for (const itemIndex of source.itemIndexes) {
            const item = cut[itemIndex];
            if (!item) continue;
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
                  ...(isWorkflowTextAsset(child) && workflowAssetCurrentDisplayIsTextChannel(child)
                    ? { inputText: workflowAssetToInputText(child) }
                    : {}),
                });
              }
              continue;
            }
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
                  ...(isWorkflowTextAsset(child) && workflowAssetCurrentDisplayIsTextChannel(child)
                    ? { inputText: workflowAssetToInputText(child) }
                    : {}),
                });
              }
            }
          }
        }
      }
      return targets;
    },
    [assets, getAssetDisplayImage, getEffectiveAssetIdsForAction]
  );

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
                  ...(isWorkflowTextAsset(a) && workflowAssetCurrentDisplayIsTextChannel(a)
                    ? { inputText: workflowAssetToInputText(a) }
                    : {}),
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
                    ...(isWorkflowTextAsset(child) && workflowAssetCurrentDisplayIsTextChannel(child)
                      ? { inputText: workflowAssetToInputText(child) }
                      : {}),
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
                    ...(isWorkflowTextAsset(child) && workflowAssetCurrentDisplayIsTextChannel(child)
                      ? { inputText: workflowAssetToInputText(child) }
                      : {}),
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
      const queueOverrideOptions: WorkflowPendingTaskOptions | undefined = (() => {
        if (!groupOverrides) return undefined;
        const opts: WorkflowPendingTaskOptions = {};
        if (getCapabilityEngine(mod) === 'gen_image') {
          if (groupOverrides.imageModelRegistryId || groupOverrides.imageGear) {
            opts.overrideImageModelRegistryId = coerceImageModelRegistryId(
              groupOverrides.imageModelRegistryId ?? groupOverrides.imageGear
            );
          }
          if (groupOverrides.imageAspectRatio) opts.overrideImageAspectRatio = groupOverrides.imageAspectRatio;
          if (groupOverrides.imageSize) opts.overrideImageSize = groupOverrides.imageSize;
          if (typeof groupOverrides.understand === 'boolean') {
            opts.overrideSkipUnderstand = overrideSkipUnderstandFromUnderstandEnabled(groupOverrides.understand);
          }
        }
        if (
          (mod.category === 'text_to_text' || mod.category === 'image_to_text') &&
          groupOverrides.textModelRegistryId
        ) {
          opts.overrideTextModelRegistryId = coerceTextModelRegistryId(groupOverrides.textModelRegistryId);
        }
        return Object.keys(opts).length > 0 ? opts : undefined;
      })();
      const generateCountApplies =
        getCapabilityEngine(mod) === 'gen_image' || mod.category === 'text_to_text';
      if (
        mod.category === 'generate_3d' &&
        mod.generate3D?.provider !== 'tencent' &&
        mod.generate3D?.tripoTaskType === 'multiview_to_model'
      ) {
        const targets = collectPromptTargets(sources).filter((t) => promptTweakTargetImage(t).trim() !== '');
        if (targets.length === 0) return;
        const initialSlots: Partial<Record<TripoMultiviewSlot, PromptTweakTarget>> = {};
        const fillOrder: TripoMultiviewSlot[] = ['front', 'back', 'left', 'right'];
        targets.slice(0, 4).forEach((target, idx) => {
          initialSlots[fillOrder[idx]!] = target;
        });
        if (typeof window !== 'undefined') {
          const baseX = dropEvent?.clientX ?? window.innerWidth - 440;
          const baseY = dropEvent?.clientY ?? 96;
          setTripoMultiviewModalPos({
            x: Math.min(Math.max(12, baseX - 24), Math.max(12, window.innerWidth - 432)),
            y: Math.min(Math.max(12, baseY - 24), Math.max(12, window.innerHeight - 360)),
          });
        }
        setTripoMultiviewModal({
          preset: mod,
          targets,
          overrides: groupOverrides,
          slots: initialSlots,
        });
        return;
      }
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
            // 新版 isGroup：`assetIds` 存子资产 id；旧版 cut 可能存内联 base64 串，二者均为 string。
            const childById = assets.find((x) => x.id === item);
            if (childById) {
              if (!workflowAssetAllowedForCapabilityDrop(childById, mod)) continue;
              addToPending(childById.id, mod.id, {
                sourceGroupAssetId: groupId,
                sourceItemIndex: itemIndex,
                ...(queueOverrideOptions ?? {}),
              });
            } else {
              addImageToPending(item, mod.id, {
                parentAssetId: groupId,
                sourceGroupAssetId: groupId,
                sourceItemIndex: itemIndex,
                ...(queueOverrideOptions ?? {}),
              });
            }
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
      collectPromptTargetsForModule,
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
    if (lightboxAsset) {
      if (!(isWorkflowTextAsset(lightboxAsset) && workflowAssetCurrentDisplayIsTextChannel(lightboxAsset))) {
        const img = getAssetDisplayImage(lightboxAsset);
        const t = img.trim();
        if (t) return t;
      }
    }
    for (const id of Array.from(selectedAssetIds)) {
      const a = assets.find((x) => x.id === id);
      if (!a) continue;
      if (isWorkflowTextAsset(a) && workflowAssetCurrentDisplayIsTextChannel(a)) continue;
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
        if (workflowAssetCurrentDisplayIsTextChannel(a)) {
          const textContent = workflowAssetToInputText(a).trim();
          if (!textContent) continue;
          out.push({
            id: a.id,
            label,
            scope,
            image: buildComposerTextAssetThumbDataUrl(a.textTitle || '', getAssetDisplayText(a)),
            textContent,
          });
        } else {
          const img = getAssetDisplayImage(a).trim();
          if (!img) continue;
          out.push({ id: a.id, label, scope, image: img });
        }
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
            return x && !(isWorkflowTextAsset(x) && workflowAssetCurrentDisplayIsTextChannel(x));
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
            const childById = assets.find((x) => x.id === item);
            if (childById) {
              if (isWorkflowTextAsset(childById) && workflowAssetCurrentDisplayIsTextChannel(childById)) continue;
              addToPending(childById.id, setActionId, {
                sourceGroupAssetId: groupId,
                sourceItemIndex: itemIndex,
              });
            } else {
              addImageToPending(item, setActionId, {
                parentAssetId: groupId,
                sourceGroupAssetId: groupId,
                sourceItemIndex: itemIndex,
              });
            }
          } else {
            const child = assets.find((x) => x.id === (item as { assetId: string }).assetId);
            if (child && isWorkflowTextAsset(child) && workflowAssetCurrentDisplayIsTextChannel(child)) continue;
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

  const activePaneNode = Math.max(0, Math.min(2, Math.round(workspacePane)));
  const topTitleColumns = useMemo(() => {
    const outlineExpandDisabled =
      outlineExpandableGroupIds.size === 0 || outlineCollapsedIds.size === 0;
    const outlineCollapseDisabled =
      outlineExpandableGroupIds.size === 0 ||
      [...outlineExpandableGroupIds].every((id) => outlineCollapsedIds.has(id));

    /** 工作区同屏时：资产树大纲 */
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

    if (activePaneNode === 0 || activePaneNode === 1) {
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
                  <span className="text-gray-300">已移出当前工作区画布</span>
                </div>
              )}
              {!showArchived && (
                <button
                  type="button"
                  onClick={() => {
                    const id = addWorkflowStoryboardTableAsset();
                    openStoryboardTablePanel(id);
                  }}
                  className={TITLE_ROW_BTN_NEUTRAL}
                  title="新建分镜表并打开编辑"
                >
                  新建分镜表
                </button>
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
              {storyboardExportRunning ? (
                <div className={TITLE_ROW_QUEUE_CHIP} title={storyboardExportTitle}>
                  <span className="text-[8px] font-black uppercase text-violet-300">分镜导出</span>
                  <span className="text-[8px] tabular-nums text-gray-300">
                    {storyboardExportPct}%
                  </span>
                </div>
              ) : null}
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
      if (activePaneNode === 0) return [workspaceAndFunctionCols[0]!, outlineWorkflowTopBarColumn];
      return [workspaceAndFunctionCols[1]!, workspaceAndFunctionCols[0]!];
    }
    /** 能力 + 功能区同屏：顶栏不重复「功能区 / 一键执行」（一键执行仅在「功能区 + 工作区」档显示） */
    return [
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
    capabilityPresetColumnCount,
    currentGroupMemberIds,
    outlineCollapsedIds,
    outlineExpandableGroupIds,
    expandOutlineAll,
    collapseOutlineAll,
    storyboardExportRunning,
    storyboardExportPct,
    storyboardExportTitle,
    addWorkflowStoryboardTableAsset,
    openStoryboardTablePanel,
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
              aria-label="卷轴分档：1 能力+功能区 2 功能区+工作区 3 工作区+大纲"
            >
              {(
                [
                  { pane: 2 as const, k: '1', t: '能力 + 功能区' },
                  { pane: 1 as const, k: '2', t: '功能区 + 工作区' },
                  { pane: 0 as const, k: '3', t: '工作区 + 大纲' },
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
                width: `${Math.max(0, Math.min(100, ((2 - workspacePane) / 2) * 100))}%`,
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
        {/* 从左到右：能力预设 | 功能区 | 工作区 | 大纲（前两列锁在同一 flex 行内，避免被压成上下叠） */}
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
                workflowComposeSearchQuery: quickComposeDraft,
                sidebarLinkHoverPresetIds,
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
            onDownloadWorkflowAssets={(sources) => void downloadWorkflowAssetsFromSources(sources)}
            onDownloadSelectedWorkflowAssets={downloadSelectedWorkflowAssets}
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
            jumpToCapabilitySet={jumpToCapabilitySet}
            onDropPresetFromEditor={handleActivatePresetFromEditorDrop}
            onDropPresetAction={handlePresetActionDrop}
            topActionMode={activePaneNode === 2 ? 'capabilityPreset' : 'asset'}
            onComposeCapabilities={handleComposeCapabilities}
            linkedComposeSearchQuery={quickComposeDraft}
            onLinkHoverPresetIds={setSidebarLinkHoverPresetIds}
            onWorkflowFeatureClick={handleWorkflowFeatureClick}
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
                  ? showAllImages.map((flat, idx) => {
                      const img = flat.src;
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
                            style={{
                              aspectRatio: `${resolveWorkflowGridCardAspect(undefined, cardAspectByAssetId, gallKey, 1)}`,
                            }}
                          >
                            <WorkflowGridImage
                              fullSrc={img}
                              cacheKey={gallKey}
                              mediaVariant={flat.mediaVariant}
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
                                    if (spacePanEnabled) {
                                      applyWheelToAssetListWhileSpacePan(e);
                                      return;
                                    }
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
                                        style={{
                                          aspectRatio: `${resolveWorkflowGridCardAspect(
                                            childAsset,
                                            cardAspectByAssetId,
                                            groupKey,
                                            1
                                          )}`,
                                        }}
                                      >
                                        <WorkflowGridImage
                                          fullSrc={childGridPreviewSrcEffective}
                                          cacheKey={childGridCacheKeyEffective}
                                          mediaVariant={workflowResultUsesVideoPreview(childAsset) ? 'video' : 'image'}
                                          deferThumbnail={!thumbUnlockKeys.has(groupKey)}
                                          thumbDecodePriority={thumbHotKeys.has(groupKey) ? 'high' : 'low'}
                                          imageFetchPriority={thumbHotKeys.has(groupKey) ? 'high' : 'auto'}
                                          className="relative z-0 block w-full h-full min-h-[5rem]"
                                          imgClassName="relative z-0 block w-full h-full object-cover"
                                          draggable={false}
                                          onDragStart={(e) => e.preventDefault()}
                                          onIntrinsicSize={(w, h) => {
                                            applyIntrinsicAspectToAsset(childAsset.id, w, h);
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
                                          elapsedSeconds={
                                            isExecutingCurrentItem
                                              ? resolveActiveExecutionForAsset(childAsset.id)?.elapsedSeconds ?? null
                                              : null
                                          }
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
                                    ) : hasChildTextPayload && !isWorkflowStoryboardTableAsset(childAsset) ? (
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
                              style={{
                                aspectRatio: `${resolveWorkflowGridCardAspect(
                                  isAssetRef ? childAsset ?? undefined : undefined,
                                  cardAspectByAssetId,
                                  groupKey,
                                  1
                                )}`,
                              }}
                            >
                              <WorkflowGridImage
                                fullSrc={img}
                                cacheKey={`gstr:${currentGroupAsset?.id ?? 'x'}:${idx}`}
                                mediaVariant={
                                  String(img).startsWith('data:video/')
                                    ? 'video'
                                    : isAssetRef && childAsset
                                      ? workflowResultUsesVideoPreview(childAsset)
                                        ? 'video'
                                        : 'image'
                                    : 'image'
                                }
                                deferThumbnail={!thumbUnlockKeys.has(groupKey)}
                                thumbDecodePriority={thumbHotKeys.has(groupKey) ? 'high' : 'low'}
                                imageFetchPriority={thumbHotKeys.has(groupKey) ? 'high' : 'auto'}
                                className="relative z-0 block w-full h-full min-h-[5rem]"
                                imgClassName="relative z-0 block w-full h-full object-cover"
                                draggable={false}
                                onDragStart={(e) => e.preventDefault()}
                                onIntrinsicSize={(w, h) => {
                                  if (isAssetRef && childAsset) {
                                    applyIntrinsicAspectToAsset(childAsset.id, w, h);
                                  }
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
                <button
                  type="button"
                  onClick={() => {
                    const id = addWorkflowStoryboardTableAsset();
                    openStoryboardTablePanel(id);
                  }}
                  className="mt-4 rounded-xl border border-violet-500/35 bg-violet-500/10 px-4 py-2 text-[10px] font-bold text-violet-200 hover:bg-violet-500/20"
                >
                  新建分镜表
                </button>
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
                  /** 无图时仍用已持久化的 `gridCardAspectRatio` 占位（资源未 hydrate 时不至于先方后横跳） */
                  const cardAspect = isWorkflowStoryboardTableAsset(a)
                    ? 4 / 3
                    : hasDisplayImage
                      ? resolveWorkflowGridCardAspect(a, cardAspectByAssetId, undefined, 1)
                      : isWorkflowTextAsset(a) && hasTextPayload
                        ? 3 / 4
                        : resolveWorkflowGridCardAspect(a, cardAspectByAssetId, undefined, 1);
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
                          if (spacePanEnabled) {
                            applyWheelToAssetListWhileSpacePan(e);
                            return;
                          }
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
                            } else if (isWorkflowStoryboardTableAsset(a)) {
                              openStoryboardTablePanel(a.id);
                            } else {
                              setLightboxSourceSlot(null);
                              setLightboxAssetId(a.id);
                            }
                          }}
                        >
                          {isWorkflowStoryboardTableAsset(a) ? (
                            <StoryboardTableGridCard asset={a} />
                          ) : !hasDisplayImage && isWorkflowTextAsset(a) ? (
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
                                mediaVariant={workflowResultUsesVideoPreview(a) ? 'video' : 'image'}
                                thumbMaxEdge={
                                  resolveWorkflowStepModelUrls(a, a.displayKey).length > 0 ? 896 : undefined
                                }
                                deferThumbnail={!thumbUnlockKeys.has(a.id)}
                                thumbDecodePriority={thumbHotKeys.has(a.id) ? 'high' : 'low'}
                                imageFetchPriority={thumbHotKeys.has(a.id) ? 'high' : 'auto'}
                                className="relative z-0 block w-full h-full min-h-[5rem]"
                                imgClassName="relative z-0 block w-full h-full object-cover"
                                draggable={false}
                                onDragStart={(e) => e.preventDefault()}
                                onIntrinsicSize={(w, h) => {
                                  applyIntrinsicAspectToAsset(a.id, w, h);
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
                                elapsedSeconds={
                                  isExecutingCurrent
                                    ? resolveActiveExecutionForAsset(a.id)?.elapsedSeconds ?? null
                                    : null
                                }
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
                          ) : hasTextPayload && !isWorkflowTextAsset(a) && !isWorkflowStoryboardTableAsset(a) ? (
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
          <div
            ref={outlineScrollRef}
            className="flex-1 min-h-0 overflow-x-auto overflow-y-auto [scrollbar-width:thin] flex flex-col gap-0.5 px-3 pt-2 pb-2"
          >
            {visibleAssets.length === 0 ? (
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
        </div>
        </div>
        </div>
      </div>
      </div>

      {storyboardPanelAsset && !showArchived && (
        <StoryboardTablePanel
          asset={storyboardPanelAsset}
          onClose={closeStoryboardTablePanel}
          onNotify={(level, message) => onLog?.(level, message)}
          redrawPresets={storyboardRedrawPresets}
          defaultRedrawPresetId={pickDefaultStoryboardRedrawPresetId(capabilityPresets)}
          redrawPresetStorageKey={STORYBOARD_REDRAW_PRESET_KEY}
          parsePresets={storyboardParsePresets}
          defaultParsePresetId={pickDefaultStoryboardParsePresetId(capabilityPresets)}
          optimizePresets={storyboardOptimizePresets}
          defaultOptimizePresetId={pickDefaultStoryboardOptimizePresetId(capabilityPresets)}
          capabilityTextModel={capabilityTextModel}
          readOnly={Boolean(storyboardPanelAsset.archived)}
          onRedrawRow={
            storyboardPanelAssetId
              ? (rowId, imageModelRegistryId, options) =>
                  handleStoryboardRowRedraw(storyboardPanelAssetId, rowId, imageModelRegistryId, options)
              : undefined
          }
          onPatchAsset={(patch) => handleStoryboardAssetPatch(storyboardPanelAsset.id, patch)}
          companionBaseUrl={String(getCompanionLocalBaseUrl() || '')}
          companionProjectId={String(workspaceProjectChrome?.activeProjectId || '')}
        />
      )}

      {/* 进行中：大图弹窗；外壳统一为 ImagePreviewOverlay，当前版本为纯文本时仅中央为文字编辑区 */}
      {lightboxAsset && !showArchived && (
        <ImagePreviewOverlay
          open
          resetKey={lightboxAsset.id}
          suppressFlatImageInteraction={
            Boolean(
              lightboxRasterChrome &&
                lightboxSamSegmentUiAllowed &&
                lightboxSamPickArmed &&
                !lightboxSamBusy
            )
          }
          imageSrc={
            lightboxShowsImage || !lightboxTextAssetOnTextChannel
              ? lightboxShowsImage
                ? lightboxPreviewUnderlaySrc || getLightboxPreviewImageSrc(lightboxAsset)
                : getLightboxPreviewImageSrc(lightboxAsset)
              : undefined
          }
          centerSlot={
            lightboxTextAssetOnTextChannel && !lightboxShowsImage ? (
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
              />
            ) : undefined
          }
          onClose={handleLightboxClose}
          wheelListLength={lightboxList.length}
          onWheelNavigate={handleLightboxWheelNavigate}
          innerWheelOptionCount={getDisplayKeysForAsset(lightboxAsset).length}
          onWheelInnerNavigate={handleLightboxWheelCycleDisplay}
          innerLayoutStableKey={lightboxShowsImage ? lightboxAsset.id : undefined}
          onFlatImagePixelSample={
            lightboxRasterChrome && lightboxModelUrls.length === 0
              ? setLightboxPointerRgb
              : undefined
          }
          onPreviewLayoutChange={
            lightboxRasterChrome ? handleLightboxPreviewLayoutChange : undefined
          }
          contentRightInset={
            lightboxTextAssetOnTextChannel && !lightboxShowsImage
              ? WORKFLOW_LIGHTBOX_RIGHT_PANEL_INSET
              : '0px'
          }
          contentLeftInset={
            lightboxTextAssetOnTextChannel && !lightboxShowsImage && lightboxStepSideChrome
              ? WORKFLOW_LIGHTBOX_VGP_GRAPH_LEFT_INSET
              : '0px'
          }
          enablePanoramaMode={lightboxShowsImage}
          modelUrls={lightboxModelUrls}
          modelFileName={lightboxModelFileNameHint}
          model3dDisplayMode={lightboxModel3dDisplayMode}
          layoutReferenceSrc={
            lightboxShowsImage && asWorkflowImageString(lightboxAsset.original).trim()
              ? workflowSafeImgSrc(lightboxAsset.original)
              : undefined
          }
          panoViewerRef={lightboxPanoViewerRef}
          onWebPreviewCaptureApiChange={
            lightboxRasterChrome ? onLightboxWebPreviewCaptureApiChange : undefined
          }
          heightfieldToolbarHostRef={lightboxHeightfieldToolbarHostRef}
          canvasAdjustControl={lightboxCanvasAdjustControl}
          imageResizeWriteBack={
            lightboxRasterChrome ? { onCommit: handleLightboxImageResizeWriteBack } : null
          }
          flatImageOverlay={
            lightboxRasterChrome
              ? ({ imgRef, panoOverlayContainerRef, panoProjectionRef, panoViewerBindEpoch }) => (
                  <ImageFlatAnnotationOverlay
                    imgRef={imgRef}
                    panoOverlayContainerRef={panoOverlayContainerRef}
                    panoProjectionRef={panoProjectionRef}
                    panoViewerBindEpoch={panoViewerBindEpoch}
                    layoutKey={`${lightboxPreviewUnderlaySrc}|${lightboxSamFlatMaskOverlayHref ?? ''}|${lightboxRembgPreview?.assetId === lightboxAsset?.id ? (lightboxRembgPreview?.dataUrl ?? '').slice(0, 120) : ''}`}
                    doc={lightboxOverlayDraft}
                    tool={lightboxOverlayTool}
                    color={lightboxOverlayColor}
                    brushWidth={lightboxBrushWidth}
                    onDocPatch={onLightboxOverlayPatch}
                    onBeginDragGesture={overlayBeginDragGesture}
                    onLocalEditAnchorClientChange={onLocalEditAnchorClientChange}
                    samPickAwaiting={
                      lightboxSamSegmentUiAllowed && lightboxSamPickArmed && !lightboxSamBusy
                    }
                    samPickSubmode={lightboxSamPickSubmode}
                    onSamPointAdd={lightboxSamSegmentUiAllowed ? handleLightboxSamPointAdd : undefined}
                    onSamBoxCommit={lightboxSamSegmentUiAllowed ? handleLightboxSamBoxCommit : undefined}
                    onSamPickHint={
                      lightboxSamSegmentUiAllowed ? handleLightboxSamPickHint : undefined
                    }
                    samPickMarkers={lightboxSamPickMarkers}
                    samBoxPixels={lightboxSamBoxPx}
                    samPickProcessing={lightboxSamBusy}
                    samMaskOverlayHref={lightboxSamFlatMaskOverlayHref}
                    rembgPreviewHref={
                      lightboxRembgPreview && lightboxRembgPreview.assetId === lightboxAsset.id
                        ? lightboxRembgPreview.dataUrl
                        : undefined
                    }
                    samAutoPick={lightboxImageFlatSamAutoPick}
                  />
                )
              : undefined
          }
          topRightExtra={
            <>
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
                    appendWorkflowAuditEvent({
                      level: 'info',
                      code: WORKFLOW_AUDIT_CODES.EXPORT_TEXT_PREVIEW,
                      assetId: lightboxAsset.id,
                      displayKey: lightboxAsset.displayKey,
                      message: '工作流大图：下载文字预览为 TXT',
                      detail: { context: 'workflow_lightbox' },
                    });
                    return;
                  }
                  appendWorkflowAuditEvent({
                    level: 'info',
                    code: WORKFLOW_AUDIT_CODES.EXPORT_IMAGE,
                    assetId: lightboxAsset.id,
                    displayKey: lightboxAsset.displayKey,
                    message: '工作流大图：下载当前预览图',
                    detail: { context: 'workflow_lightbox' },
                  });
                  void triggerImageDownload(
                    getAssetDisplayImage(lightboxAsset),
                    `workflow-preview-${lightboxAsset.id.slice(0, 6)}`
                  );
                }}
                className={LIGHTBOX_ICON_BTN_PRIMARY}
                title={lightboxShowsImage ? '下载当前预览图' : '下载为文本文件'}
                aria-label={lightboxShowsImage ? '下载当前预览图' : '下载为文本文件'}
              >
                <Download {...LIGHTBOX_BAR_IC} aria-hidden />
              </button>
              {(() => {
                const dk = lightboxAsset.displayKey;
                const blockedByVgp = Boolean(
                  lightboxAsset.vgp && isVgpBlockingDiscardForDisplayKey(lightboxAsset.vgp, dk)
                );
                const canDiscard =
                  dk !== 'original' && dk !== 'group_preview' && !blockedByVgp;
                const discardHint = !canDiscard
                  ? dk === 'original'
                    ? '原始版本不可删除'
                    : dk === 'group_preview'
                      ? '组预览不可删除'
                      : blockedByVgp
                        ? '该版本被后续生成引用，无法删除'
                        : '不可删除'
                  : '丢弃当前展示的版本';
                return (
                  <button
                    type="button"
                    disabled={!canDiscard}
                    onClick={() => {
                      if (!canDiscard) return;
                      discardResult(lightboxAsset.id, dk);
                    }}
                    className={[
                      LIGHTBOX_ICON_BTN_NEUTRAL,
                      canDiscard
                        ? 'text-red-400/95 hover:bg-red-950/40 hover:text-red-300'
                        : 'cursor-not-allowed opacity-35 hover:bg-transparent',
                    ].join(' ')}
                    title={discardHint}
                    aria-label={discardHint}
                  >
                    <Trash2 {...LIGHTBOX_BAR_IC} aria-hidden />
                  </button>
                );
              })()}
            </>
          }
        >
          <>
          <div
            className="absolute right-4 z-[9] flex w-[min(24rem,30vw)] max-h-[72vh] min-h-0 flex-col gap-2"
            style={{ top: 'max(3.5rem, env(safe-area-inset-top, 0px))' }}
          >
            <div
              ref={lightboxHeightfieldToolbarHostRef}
              className={
                lightboxRasterChrome && lightboxPreviewLayout === 'heightfield'
                  ? `${WORKFLOW_IMAGE_PREVIEW_RAIL.replace('inline-flex', 'flex')} w-full min-w-0 shrink-0 flex-wrap pointer-events-auto`
                  : 'hidden'
              }
              role="region"
              aria-label="高度 3D 控件"
              onClick={(e) => e.stopPropagation()}
            />
            {lightboxShowTripo3DToolbar ? (
              <div
                className={`${WORKFLOW_LIGHTBOX_BOTTOM_RAIL} w-full min-w-0 shrink-0 flex-wrap justify-start pointer-events-auto`}
                role="toolbar"
                aria-label="3D 模型：拉取与下载"
                onClick={(e) => e.stopPropagation()}
              >
                {lightboxModelPersistLabel ? (
                  <span
                    className="max-w-full truncate rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-gray-300"
                    title={lightboxModelPersistLabel}
                  >
                    {lightboxModelPersistLabel}
                  </span>
                ) : null}
                {lightboxPreviewLayout === 'model3d' ? (
                  <div
                    className="flex min-w-0 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/35 p-0.5"
                    role="group"
                    aria-label="3D 显示模式"
                  >
                    {MODEL_3D_DISPLAY_MODES.map((mode) => (
                      <button
                        key={mode.key}
                        type="button"
                        title={mode.title}
                        aria-pressed={lightboxModel3dDisplayMode === mode.key}
                        onClick={(e) => {
                          e.stopPropagation();
                          setLightboxModel3dDisplayMode(mode.key);
                        }}
                        className={`h-7 px-2 text-[10px] font-black transition-colors ${
                          lightboxModel3dDisplayMode === mode.key
                            ? 'rounded-md bg-white text-black'
                            : 'rounded-md text-white/65 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {lightboxTencentRehydrateCtx ? (
                  <button
                    type="button"
                    disabled={lightboxTencentPullBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleLightboxPullTencentModels();
                    }}
                    className={LIGHTBOX_ICON_BTN_NEUTRAL}
                    title="按步骤详情中的混元 JobId 从云端重新拉取模型并写入本地伴侣"
                    aria-label="从混元拉取模型"
                  >
                    <CloudDownload {...LIGHTBOX_BAR_IC} aria-hidden />
                  </button>
                ) : null}
                {lightboxTripoRehydrateCtx ? (
                  <button
                    type="button"
                    disabled={lightboxTripoPullBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleLightboxPullTripoModels();
                    }}
                    className={LIGHTBOX_ICON_BTN_NEUTRAL}
                    title="按步骤详情中持久化的 Tripo 任务 id 从 Tripo 重新拉取模型并写入本地伴侣（本地预览丢失时可恢复）"
                    aria-label="从 Tripo 拉取模型"
                  >
                    <CloudDownload {...LIGHTBOX_BAR_IC} aria-hidden />
                  </button>
                ) : null}
                {lightboxModelDownloadSlots.map((slot) => (
                  <button
                    key={`${slot.format}:${slot.index}`}
                    type="button"
                    disabled={!slot.downloadable}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!slot.downloadable) return;
                      void handleLightboxDownloadModel(slot.index);
                    }}
                    className={
                      slot.downloadable
                        ? LIGHTBOX_ICON_BTN_VIOLET
                        : `${LIGHTBOX_ICON_BTN_NEUTRAL} cursor-not-allowed opacity-40`
                    }
                    title={
                      slot.downloadable
                        ? `下载 ${slot.format.toUpperCase()}`
                        : `${slot.format.toUpperCase()} 未归档（Tripo FBX 转换可能失败）`
                    }
                    aria-label={
                      slot.downloadable
                        ? `下载 ${slot.format.toUpperCase()} 模型`
                        : `${slot.format.toUpperCase()} 不可用`
                    }
                  >
                    <Package {...LIGHTBOX_BAR_IC} aria-hidden />
                  </button>
                ))}
              </div>
            ) : null}
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-2xl border border-white/10 bg-[#141418] shadow-xl ring-1 ring-black/40 [scrollbar-width:thin]"
              data-image-preview-no-wheel
              data-image-preview-scroll
            >
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
                      ? (() => {
                          const baseKey = stripResultKeyToBaseActionId(displayKey);
                          const actionLabel =
                            lightboxAsset.resultMeta?.[displayKey]?.displayStepLabel?.trim() ||
                            getActionLabel(baseKey);
                          return buildWorkflowImageTags({
                            actionLabel,
                            actionId: baseKey,
                            presetInstruction: getModule(baseKey)?.instruction,
                          });
                        })()
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
              {lightboxStepSideChrome ? (
                <>
                  <WorkflowStepTimelinePanel
                    asset={lightboxAsset}
                    resolveStepLabel={(k) => getGenerationRecordStepLabel(k, lightboxAsset)}
                    currentDisplayKey={lightboxAsset.displayKey}
                    onSelectDisplayKey={(key) => setDisplayKey(lightboxAsset.id, key)}
                  />
                  {lightboxRasterChrome ? (
                    <WorkflowOverlaySnapshotRecoverPanel
                      assetId={lightboxAsset.id}
                      baseDisplayKey={lightboxAsset.displayKey}
                      onRestore={restoreLightboxOverlayFromRingEntry}
                    />
                  ) : null}
                </>
              ) : null}
              {lightboxRasterChrome && lightboxModelUrls.length === 0 ? (
                <div className="px-3 pt-2 pb-2 border-b border-white/10">
                  <div className="text-[8px] font-black text-gray-500 uppercase mb-1">光标像素 RGB</div>
                  <div className="flex items-center gap-2 min-h-[30px]">
                    {lightboxPointerRgb ? (
                      <>
                        <span
                          className="h-7 w-7 shrink-0 rounded border border-white/15 shadow-inner"
                          style={{
                            backgroundColor: `rgb(${lightboxPointerRgb.r},${lightboxPointerRgb.g},${lightboxPointerRgb.b})`,
                          }}
                          title={`RGB(${lightboxPointerRgb.r}, ${lightboxPointerRgb.g}, ${lightboxPointerRgb.b})`}
                          aria-hidden
                        />
                        <div className="text-[9px] font-mono text-gray-200 leading-snug tabular-nums min-w-0">
                          <div>
                            R {lightboxPointerRgb.r} · G {lightboxPointerRgb.g} · B {lightboxPointerRgb.b}
                          </div>
                          <div className="text-[8px] text-gray-500">
                            #
                            {lightboxPointerRgb.r.toString(16).padStart(2, '0')}
                            {lightboxPointerRgb.g.toString(16).padStart(2, '0')}
                            {lightboxPointerRgb.b.toString(16).padStart(2, '0')}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-[8px] text-gray-600">在主图内容上移动指针取样（须位于图内）</div>
                    )}
                  </div>
                </div>
              ) : null}
              <WorkflowStepTimelineDetailPanel
                asset={lightboxAsset}
                getStepLabel={(k) => getGenerationRecordStepLabel(k, lightboxAsset)}
                selectedResultKey={lightboxAsset.displayKey}
                resolvePresetLabel={(pid) => capabilityPresets.find((p) => p.id === pid)?.label ?? pid}
                getPresetInstruction={(pid) => getModule(pid)?.instruction}
                onPullTripoModels={lightboxTripoRehydrateCtx ? handleLightboxPullTripoModels : undefined}
                onPullTencentModels={lightboxTencentRehydrateCtx ? handleLightboxPullTencentModels : undefined}
                pullTripoBusy={lightboxTripoPullBusy}
                pullTencentBusy={lightboxTencentPullBusy}
                executionActive={lightboxActiveExecution != null}
                executionElapsedSeconds={lightboxActiveExecution?.elapsedSeconds ?? null}
                executionStepLabel={lightboxActiveExecution?.stepLabel ?? null}
              />
          </div>
          </div>
          {!lightboxRasterChrome ||
          (lightboxModelUrls.length > 0 && !lightboxModelDownloadsOnRight) ? (
          <div
            className={`absolute bottom-4 left-1/2 z-10 max-h-[42vh] w-max max-w-[min(58rem,calc(100vw-3rem))] -translate-x-1/2 overflow-y-auto ${WORKFLOW_LIGHTBOX_BOTTOM_RAIL}`}
            data-image-preview-no-wheel
            data-image-preview-scroll
          >
            {!lightboxRasterChrome ? (
              <>
                <div className={`${WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER} shrink-0`} aria-hidden />
                <button
                  type="button"
                  onClick={() => setDisplayKey(lightboxAsset.id, 'original')}
                  className={lightboxAsset.displayKey === 'original' ? LIGHTBOX_ICON_BTN_ACTIVE : LIGHTBOX_ICON_BTN_NEUTRAL}
                  title="原始"
                  aria-label="切换到原始版本"
                >
                  <ImageIcon {...LIGHTBOX_BAR_IC} aria-hidden />
                </button>
                {isGroupAsset(lightboxAsset) && (lightboxAsset.assetIds?.length ?? 0) > 0 ? (
                  <button
                    type="button"
                    onClick={() => setDisplayKey(lightboxAsset.id, 'group_preview')}
                    className={
                      lightboxAsset.displayKey === 'group_preview' ? LIGHTBOX_ICON_BTN_ACTIVE : LIGHTBOX_ICON_BTN_NEUTRAL
                    }
                    title="组预览"
                    aria-label="切换到组预览"
                  >
                    <LayoutGrid {...LIGHTBOX_BAR_IC} aria-hidden />
                  </button>
                ) : null}
                {(lightboxAsset.resultOrder || []).map((k) => {
                  if (stripResultKeyToBaseActionId(k) === 'cut_image') return null;
                  const label =
                    lightboxAsset.resultMeta?.[k]?.displayStepLabel?.trim() ||
                    getModule(stripResultKeyToBaseActionId(k))?.label ||
                    stripResultKeyToBaseActionId(k);
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
                      className={lightboxAsset.displayKey === k ? LIGHTBOX_ICON_BTN_ACTIVE : LIGHTBOX_ICON_BTN_NEUTRAL}
                      title={label}
                      aria-label={`切换到 ${label}`}
                    >
                      <ImagePlus {...LIGHTBOX_BAR_IC} aria-hidden />
                    </button>
                  );
                })}
              </>
            ) : null}
            {!lightboxModelDownloadsOnRight
              ? lightboxModelDownloadSlots.map((slot) => (
                  <button
                    key={`${slot.format}:${slot.index}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleLightboxDownloadModel(slot.index);
                    }}
                    className={LIGHTBOX_ICON_BTN_VIOLET}
                    title={`下载 ${slot.format.toUpperCase()}`}
                    aria-label={`下载 ${slot.format.toUpperCase()} 模型`}
                  >
                    <Package {...LIGHTBOX_BAR_IC} aria-hidden />
                  </button>
                ))
              : null}
          </div>
          ) : null}
          </>
        </ImagePreviewOverlay>
      )}

      {lightboxAsset && !showArchived && lightboxStepSideChrome ? (
        <React.Fragment key={lightboxAsset.id}>
          <WorkflowStepNodeGraphOverlay
            asset={lightboxAsset}
            getStepLabel={(k) => getGenerationRecordStepLabel(k, lightboxAsset)}
            onSelectDisplayKey={(key) => setDisplayKey(lightboxAsset.id, key)}
            pixelBusy={busyAssetIds.has(lightboxAsset.id)}
          />
        </React.Fragment>
      ) : null}

      {lightboxAsset &&
        !showArchived &&
        lightboxRasterChrome &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-[2400]">
            <ImageAnnotationLightboxToolbar
              tool={lightboxOverlayTool}
              onToolChange={applyLightboxToolChange}
              color={lightboxOverlayColor}
              onColorChange={onLightboxOverlayColorChange}
              brushWidth={lightboxBrushWidth}
              onBrushWidthChange={onLightboxBrushWidthChange}
              onUndo={overlayUndo}
              onRedo={overlayRedo}
              onPersist={persistLightboxOverlayAnnotations}
              onClearAnnotations={() => onLightboxOverlayPatch((d) => ({ ...d, items: [] }))}
              onApplyCrops={() => void applyLightboxManualCrops()}
              onClearCrops={() => onLightboxOverlayPatch((d) => ({ ...d, crops: [] }))}
              onClearLocalEdit={() =>
                onLightboxOverlayPatch((d) => ({
                  ...d,
                  localEdit: null,
                  panoLocalEditViewport: null,
                  panoLocalEditEquirect: null,
                  panoLocalEditReproject: null,
                }))
              }
              localInpaintExpandMode={localInpaintExpandMode}
              onLocalInpaintExpandModeChange={(mode) => {
                setLocalInpaintExpandMode(mode);
                writeLocalInpaintExpandMode(preferenceScope, mode);
              }}
              onResetAll={resetLightboxOverlayAll}
              lightboxSamToolbarMenuOpenRef={lightboxSamToolbarMenuOpenRef}
              samSegment={
                lightboxSamSegmentToolbarVisible
                  ? {
                      busy: lightboxSamBusy,
                      armed: lightboxSamPickArmed && lightboxSamSegmentUiAllowed,
                      disabled: !lightboxSamSegmentUiAllowed,
                      disabledTitle: lightboxSamSegmentDisabledTitle,
                      onSamMenuOpenChange: onLightboxSamMenuOpenChange,
                      samBackendMode: lightboxSamBackendMode,
                      samBackendUnready: lightboxSamBackendUnready,
                      samPickSubmode: lightboxSamPickSubmode,
                      onSamPickSubmodeChange: setLightboxSamPickSubmode,
                      canRunSam: lightboxSamCanRunSegment,
                      onRunSam: () => void executeLightboxSamSegment(),
                      canClearSamPrompts: lightboxSamHasPrompts,
                      onSamClearPrompts: clearLightboxSamPrompts,
                      samUxMode: lightboxSamUxMode,
                      onAutoSegment: () => void executeLightboxSamAuto(),
                      canMergeAutoPick:
                        lightboxSamUxMode === 'auto' &&
                        !!lightboxSamAutoLayer &&
                        lightboxSamAutoLayer.assetId === lightboxAssetId &&
                        lightboxSamAutoPicked.length > 0,
                      onMergeAutoPick: () => void mergeLightboxSamAutoToLayers(),
                      onExitAuto: () => void exitLightboxSamAuto(),
                      canClearSamPreview: Boolean(
                        (lightboxSamUnsaved?.assetId === lightboxAssetId &&
                          (lightboxSamUnsaved?.previewLayers?.length ?? 0) > 0) ||
                          (lightboxSamAutoLayer?.assetId === lightboxAssetId && !!lightboxSamAutoLayer)
                      ),
                      onClearSamPreview: () => void clearLightboxSamPreview(),
                      canSaveSam:
                        !!lightboxSamUnsaved &&
                        lightboxSamUnsaved.assetId === lightboxAssetId &&
                        (lightboxSamUnsaved.previewLayers?.length ?? 0) > 0 &&
                        !lightboxSamBusy,
                      onSaveSam: () => void commitLightboxSamSave(),
                      multimask:
                        lightboxSamMultimaskChoice && lightboxSamMultimaskChoice.dataUrls.length > 1
                          ? {
                              total: lightboxSamMultimaskChoice.dataUrls.length,
                              index: lightboxSamMultimaskIndex,
                              onPrev: () =>
                                applyLightboxSamMultimaskIndex(
                                  Math.max(0, lightboxSamMultimaskIndex - 1)
                                ),
                              onNext: () =>
                                applyLightboxSamMultimaskIndex(
                                  Math.min(
                                    lightboxSamMultimaskChoice.dataUrls.length - 1,
                                    lightboxSamMultimaskIndex + 1
                                  )
                                ),
                            }
                          : undefined,
                    }
                  : undefined
              }
              removeBg={
                lightboxSamSegmentToolbarVisible
                  ? {
                      busy: lightboxRembgBusy,
                      disabled:
                        !lightboxSamSegmentUiAllowed ||
                        !workspaceProjectChrome?.activeProjectId?.trim() ||
                        !normalizeCompanionBaseUrl(String(getCompanionLocalBaseUrl() || '').trim()),
                      disabledTitle: lightboxSamSegmentDisabledTitle,
                      hasPreview: Boolean(
                        lightboxRembgPreview && lightboxRembgPreview.assetId === lightboxAssetId
                      ),
                      onRun: () => void runLightboxRembg(),
                      onApply: () => void commitLightboxRembgApply(),
                      onDiscard: () => discardLightboxRembgPreview(),
                    }
                  : undefined
              }
              canvasAdjust={lightboxAnnotationCanvasAdjust}
            />
          </div>,
          document.body
        )}

      {lightboxAsset &&
        !showArchived &&
        lightboxRasterChrome &&
        typeof document !== 'undefined' &&
        createPortal(
          <WorkspaceQuickComposeBar
            visible
            placement="lightbox"
            lightboxAnchorClient={lightboxQuickComposeAnchor}
            lightboxLayoutResetNonce={lightboxQuickComposeLayoutNonce}
            placeholderOverride="描述修改意图；需要时可 @ 当前画面或其它资产"
            composeMode={quickComposeMode}
            onComposeModeChange={setQuickComposeMode}
            inputPresetsActive={false}
            segments={quickComposeSegments}
            onSegmentsChange={setQuickComposeSegmentsTracked}
            mentionCandidates={quickComposeMentionCandidates}
            dropSlots={quickComposeDropSlots}
            onRemoveDropSlot={removeQuickComposeDropSlot}
            maxMentions={quickComposeMaxReferenceImages}
            onSubmit={() => void submitLightboxQuickCompose()}
            showGenImageSettings={quickComposeShowGenImageSettings}
            showGenTextSettings={quickComposeShowGenTextSettings}
            allowBatchCount={quickComposeAllowBatchCount}
            promptCards={[]}
            onRemovePromptCard={() => {}}
            genSettings={{
              imageModelRegistryId: quickComposeImageModel,
              onImageModelRegistryId: setQuickComposeImageModel,
              textModelRegistryId: quickComposeTextModel,
              onTextModelRegistryId: setQuickComposeTextModel,
              aspectRatio: quickComposeAspect,
              onAspectRatio: setQuickComposeAspect,
              imageSize: quickComposeSize,
              onImageSize: setQuickComposeSize,
              count: quickComposeCount,
              onCount: setQuickComposeCount,
              understand: quickComposeUnderstand,
              onUnderstand: setQuickComposeUnderstand,
            }}
          />,
          document.body
        )}

      {lightboxRembgInstallModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[2300] flex items-center justify-center bg-black/70 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rembg-install-title"
            onClick={() => setLightboxRembgInstallModalOpen(false)}
          >
            <div
              className="max-w-lg w-full rounded-2xl border border-white/10 bg-[#121216] p-5 shadow-2xl ring-1 ring-black/40"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="rembg-install-title" className="text-sm font-black text-white tracking-wide uppercase mb-3">
                启用本机抠图（rembg）
              </h2>
              <p className="text-[11px] leading-relaxed text-gray-300">
                <strong className="text-gray-200">推荐（Windows）</strong>：打开<strong className="text-gray-200">
                  桌面伴侣
                </strong>
                ，进入<strong className="text-gray-200">设置</strong> → 找到「
                <strong className="text-gray-200">本机抠图（rembg）</strong>」→ 点击
                <strong className="text-gray-200">一键安装抠图引擎</strong>。安装结束会自动重启本地伴侣，回到网站再点「去背景」即可。
              </p>
              <p className="mt-2 text-[10px] text-gray-500">
                一键安装过程中会<strong className="text-gray-400">预取默认 u2net 权重</strong>到伴侣沙盒（与运行时一致）；若未走一键安装、自行配置 Python，首次抠图仍可能下载到本机目录（常见为 ~/.u2net），请保持网络可用。
              </p>
              <details className="mt-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                <summary className="cursor-pointer text-[10px] font-semibold text-gray-400">
                  高级：已有自己的 Python / 非 Windows
                </summary>
                <ol className="mt-2 list-decimal pl-5 space-y-2 text-[10px] leading-relaxed text-gray-400">
                  <li>
                    使用 <span className="font-mono text-gray-300">Python 3.11～3.13</span>，在同一解释器中执行{' '}
                    <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-emerald-200/90">
                      pip install &quot;rembg[cpu]&quot;
                    </code>
                    。
                  </li>
                  <li>
                    将环境变量{' '}
                    <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-sky-200/90">
                      COMPANION_REMBG_PYTHON
                    </code>{' '}
                    设为该 <span className="font-mono text-gray-300">python</span> 可执行文件路径，保存后重启本地伴侣。
                  </li>
                </ol>
              </details>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-blue-600 px-4 py-2 text-[10px] font-black uppercase tracking-wide text-white hover:bg-blue-500"
                  onClick={() => setLightboxRembgInstallModalOpen(false)}
                >
                  知道了
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {lightboxSamInstallModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[2300] flex items-center justify-center bg-black/70 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sam-install-title"
            onClick={() => setLightboxSamInstallModalOpen(false)}
          >
            <div
              className="max-w-lg w-full rounded-2xl border border-white/10 bg-[#121216] p-5 shadow-2xl ring-1 ring-black/40"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="sam-install-title" className="text-sm font-black text-white tracking-wide uppercase mb-3">
                启用本机分割（SamLocal）
              </h2>
              <p className="text-[11px] leading-relaxed text-gray-300">
                <strong className="text-gray-200">推荐（Windows）</strong>：打开<strong className="text-gray-200">
                  桌面伴侣
                </strong>
                ，进入<strong className="text-gray-200">设置</strong> → 找到「
                <strong className="text-gray-200">分割引擎（SAM / SamLocal）</strong>」→ 点击
                <strong className="text-gray-200">一键安装高精度引擎</strong>。安装结束会自动重启本地伴侣，回到网站再使用「分割」即可。
              </p>
              <p className="mt-2 text-[10px] text-gray-500">
                首次安装可能下载 PyTorch 与模型（体积较大），请保持磁盘与网络可用。
              </p>
              <details className="mt-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                <summary className="cursor-pointer text-[10px] font-semibold text-gray-400">
                  高级：已有自己的 Python / 非 Windows
                </summary>
                <ol className="mt-2 list-decimal pl-5 space-y-2 text-[10px] leading-relaxed text-gray-400">
                  <li>
                    在仓库根目录按文档执行{' '}
                    <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-emerald-200/90">
                      npm run setup:sam-local
                    </code>
                    ，并确保 SamLocal 在 <span className="font-mono text-gray-300">127.0.0.1:18081</span> 可访问。
                  </li>
                  <li>
                    若伴侣无法拉起 SamLocal，可在运行伴侣的终端环境中配置文档中的环境变量（如{' '}
                    <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-sky-200/90">
                      COMPANION_SPAWN_SAM_LOCAL_*
                    </code>
                    ），保存后重启本地伴侣。
                  </li>
                </ol>
              </details>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-blue-600 px-4 py-2 text-[10px] font-black uppercase tracking-wide text-white hover:bg-blue-500"
                  onClick={() => setLightboxSamInstallModalOpen(false)}
                >
                  知道了
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {lightboxOverlayDirtyCloseDialogOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[2350] flex items-center justify-center bg-black/70 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lightbox-overlay-dirty-close-title"
            onClick={cancelLightboxOverlayDirtyCloseDialog}
          >
            <div
              className="max-w-lg w-full rounded-2xl border border-white/10 bg-[#121216] p-5 shadow-2xl ring-1 ring-black/40"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="lightbox-overlay-dirty-close-title"
                className="text-sm font-black text-white tracking-wide uppercase mb-3"
              >
                关闭大图前确认
              </h2>
              <p className="text-[11px] leading-relaxed text-gray-300">
                当前大图上的标注、裁切或局部选区与资产中已保存的版本不一致。请选择写入当前修改后关闭，或丢弃修改后关闭。
              </p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-white/[0.06] px-4 py-2 text-[10px] font-black uppercase tracking-wide text-gray-200 ring-1 ring-white/10 hover:bg-white/10"
                  onClick={cancelLightboxOverlayDirtyCloseDialog}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-amber-700/90 px-4 py-2 text-[10px] font-black uppercase tracking-wide text-white hover:bg-amber-600"
                  onClick={() => completeLightboxClose({ flush: false, auditDiscard: true })}
                >
                  丢弃并关闭
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-blue-600 px-4 py-2 text-[10px] font-black uppercase tracking-wide text-white hover:bg-blue-500"
                  onClick={() => completeLightboxClose({ flush: true, auditDiscard: false })}
                >
                  保存并关闭
                </button>
              </div>
            </div>
          </div>,
          document.body
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

      {tripoMultiviewModal && (
        <div
          className="fixed z-[2150] w-[min(420px,calc(100vw-24px))] pointer-events-none"
          style={{ left: tripoMultiviewModalPos.x, top: tripoMultiviewModalPos.y }}
          data-workflow-toolbar
        >
          <div
            className="pointer-events-auto rounded-xl border border-white/10 bg-[#0e0e14]/95 shadow-2xl p-3"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-start justify-between gap-3 mb-3 cursor-move select-none"
              onPointerDown={startTripoMultiviewModalDrag}
            >
              <div>
                <div className="text-[10px] font-black uppercase text-amber-300">Tripo 多视图生成</div>
                <div className="text-[9px] text-gray-500 mt-1">
                  将图片拖入对应槽位：正面必须，至少需要两张。
                </div>
              </div>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setTripoMultiviewModal(null);
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/[0.06] cursor-pointer"
              >
                <AppIcon name="close" className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {TRIPO_MULTIVIEW_SLOTS.map((slot) => {
                const target = tripoMultiviewModal.slots[slot.key];
                const src = promptTweakTargetImage(target);
                return (
                  <div
                    key={slot.key}
                    className="min-h-[122px] rounded-lg border border-dashed border-white/15 bg-white/[0.04] p-2"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = tripoMultiviewDraggingSlot ? 'move' : 'copy';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const raw = e.dataTransfer.getData('application/x-ac-tripo-multiview');
                      const draggedSlot =
                        raw.startsWith('slot:')
                          ? (raw.slice('slot:'.length) as TripoMultiviewSlot)
                          : tripoMultiviewDraggingSlot;
                      const incomingTargets = raw || draggedSlot
                        ? []
                        : collectPromptTargetsForModule(
                            resolveCapabilityDropDragSources(draggingAssetIds, draggingGroupItems, e.dataTransfer),
                            tripoMultiviewModal.preset
                          )
                            .filter((t) => promptTweakTargetImage(t).trim() !== '');
                      if (!raw && !draggedSlot && incomingTargets.length === 0) return;
                      setTripoMultiviewModal((prev) => {
                        if (!prev) return prev;
                        const nextSlots = { ...prev.slots };
                        if (raw.startsWith('target:')) {
                          const idx = Number(raw.slice('target:'.length));
                          const nextTarget = prev.targets[idx];
                          if (nextTarget) nextSlots[slot.key] = nextTarget;
                        } else if (draggedSlot) {
                          if (draggedSlot === slot.key) return prev;
                          const fromTarget = nextSlots[draggedSlot];
                          const toTarget = nextSlots[slot.key];
                          if (toTarget) nextSlots[draggedSlot] = toTarget;
                          else delete nextSlots[draggedSlot];
                          if (fromTarget) nextSlots[slot.key] = fromTarget;
                          else delete nextSlots[slot.key];
                        } else if (incomingTargets.length > 0) {
                          const order = TRIPO_MULTIVIEW_SLOTS.map((s) => s.key);
                          const start = Math.max(0, order.indexOf(slot.key));
                          incomingTargets.slice(0, 4).forEach((nextTarget, idx) => {
                            const targetSlot = order[(start + idx) % order.length];
                            if (targetSlot) nextSlots[targetSlot] = nextTarget;
                          });
                        }
                        return { ...prev, slots: nextSlots };
                      });
                      setTripoMultiviewDraggingSlot(null);
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-black text-gray-200">{slot.label}</span>
                      {target ? (
                        <button
                          type="button"
                          className="text-[9px] text-gray-500 hover:text-white"
                          onClick={() =>
                            setTripoMultiviewModal((prev) => {
                              if (!prev) return prev;
                              const nextSlots = { ...prev.slots };
                              delete nextSlots[slot.key];
                              return { ...prev, slots: nextSlots };
                            })
                          }
                        >
                          清空
                        </button>
                      ) : null}
                    </div>
                    {src ? (
                      <img
                        src={src}
                        alt={slot.label}
                        draggable
                        onPointerDownCapture={(e) => e.stopPropagation()}
                        onMouseDownCapture={(e) => e.stopPropagation()}
                        onDragStart={(e) => {
                          e.stopPropagation();
                          setTripoMultiviewDraggingSlot(slot.key);
                          e.dataTransfer.setData('application/x-ac-tripo-multiview', `slot:${slot.key}`);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => setTripoMultiviewDraggingSlot(null)}
                        className="h-20 w-full object-cover rounded-md border border-white/10 cursor-grab active:cursor-grabbing select-none"
                      />
                    ) : (
                      <div className="h-20 rounded-md border border-white/[0.06] bg-black/25 flex items-center justify-center text-[9px] text-gray-500">
                        拖入图片
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTripoMultiviewModal(null)}
                className="px-3 py-2 rounded-lg bg-white/[0.06] text-[10px] font-black text-gray-200"
              >
                取消
              </button>
              <button
                type="button"
                disabled={
                  !tripoMultiviewModal.slots.front ||
                  TRIPO_MULTIVIEW_SLOTS.filter((slot) => promptTweakTargetImage(tripoMultiviewModal.slots[slot.key]).trim()).length < 2
                }
                onClick={() => {
                  const modal = tripoMultiviewModal;
                  if (!modal) return;
                  const slots = modal.slots;
                  const front = slots.front;
                  const filled = TRIPO_MULTIVIEW_SLOTS.filter((slot) => promptTweakTargetImage(slots[slot.key]).trim());
                  if (!front || filled.length < 2) {
                    onLog?.('warn', 'Tripo 多视图生成需要正面图，且至少需要两张图');
                    return;
                  }
                  const tripoMultiviewImages: WorkflowPendingTask['tripoMultiviewImages'] = {};
                  for (const slot of TRIPO_MULTIVIEW_SLOTS) {
                    const src = promptTweakTargetImage(slots[slot.key]).trim();
                    if (src) tripoMultiviewImages[slot.key] = src;
                  }
                  const opts: WorkflowPendingTaskOptions = { tripoMultiviewImages };
                  let queued = false;
                  if ('assetId' in front) {
                    const asset = assetsRef.current.find((a) => a.id === front.assetId);
                    if (asset) {
                      const task = buildPendingTaskFromAssetSnapshot(asset, front.assetId, modal.preset.id, opts);
                      if (task) {
                        addTasksToPending([task]);
                        queued = true;
                      }
                    }
                  } else {
                    addImageToPending(front.imageBase64, modal.preset.id, {
                      parentAssetId: front.parentAssetId,
                      sourceGroupAssetId: front.sourceGroupAssetId,
                      sourceItemIndex: front.sourceItemIndex,
                      tripoMultiviewImages,
                    });
                    queued = true;
                  }
                  if (queued) {
                    onLog?.('info', `已加入 Tripo 多视图生成队列：${modal.preset.label}`);
                    setTripoMultiviewModal(null);
                  }
                }}
                className="px-4 py-2 rounded-lg bg-amber-600 text-[10px] font-black text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-gray-500"
              >
                确认加入队列
              </button>
            </div>
          </div>
        </div>
      )}
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
              ...(promptTweakModal.overrides?.imageModelRegistryId || promptTweakModal.overrides?.imageGear
                ? {
                    overrideImageModelRegistryId: coerceImageModelRegistryId(
                      promptTweakModal.overrides.imageModelRegistryId ?? promptTweakModal.overrides.imageGear
                    ),
                  }
                : {}),
              ...(promptTweakModal.overrides?.textModelRegistryId
                ? {
                    overrideTextModelRegistryId: coerceTextModelRegistryId(
                      promptTweakModal.overrides.textModelRegistryId
                    ),
                  }
                : {}),
              ...(promptTweakModal.overrides?.imageAspectRatio ? { overrideImageAspectRatio: promptTweakModal.overrides.imageAspectRatio } : {}),
              ...(promptTweakModal.overrides?.imageSize ? { overrideImageSize: promptTweakModal.overrides.imageSize } : {}),
              ...(typeof promptTweakModal.overrides?.understand === 'boolean'
                ? {
                    overrideSkipUnderstand: overrideSkipUnderstandFromUnderstandEnabled(
                      promptTweakModal.overrides.understand
                    ),
                  }
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
                  ...(taskOptions.overrideImageModelRegistryId || taskOptions.overrideImageGear
                    ? {
                        overrideImageModelRegistryId: coerceImageModelRegistryId(
                          taskOptions.overrideImageModelRegistryId ?? taskOptions.overrideImageGear
                        ),
                      }
                    : {}),
                  ...(taskOptions.overrideTextModelRegistryId
                    ? { overrideTextModelRegistryId: taskOptions.overrideTextModelRegistryId }
                    : {}),
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
                        ...(taskOptions.overrideImageModelRegistryId || taskOptions.overrideImageGear
                    ? {
                        overrideImageModelRegistryId: coerceImageModelRegistryId(
                          taskOptions.overrideImageModelRegistryId ?? taskOptions.overrideImageGear
                        ),
                      }
                    : {}),
                  ...(taskOptions.overrideTextModelRegistryId
                    ? { overrideTextModelRegistryId: taskOptions.overrideTextModelRegistryId }
                    : {}),
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
                    ...(taskOptions.overrideImageModelRegistryId || taskOptions.overrideImageGear
                    ? {
                        overrideImageModelRegistryId: coerceImageModelRegistryId(
                          taskOptions.overrideImageModelRegistryId ?? taskOptions.overrideImageGear
                        ),
                      }
                    : {}),
                  ...(taskOptions.overrideTextModelRegistryId
                    ? { overrideTextModelRegistryId: taskOptions.overrideTextModelRegistryId }
                    : {}),
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
              quickComposeShellActive && !lightboxAsset && !promptTweakModal
            }
            composeMode={quickComposeMode}
            onComposeModeChange={setQuickComposeMode}
            inputPresetsActive={quickComposePromptCards.length > 0}
            segments={quickComposeSegments}
            onSegmentsChange={setQuickComposeSegmentsTracked}
            mentionCandidates={quickComposeMentionCandidates}
            dropSlots={quickComposeDropSlots}
            onRemoveDropSlot={removeQuickComposeDropSlot}
            maxMentions={quickComposeMaxReferenceImages}
            onSubmit={submitQuickCompose}
            showGenImageSettings={quickComposeShowGenImageSettings}
            showGenTextSettings={quickComposeShowGenTextSettings}
            allowBatchCount={quickComposeAllowBatchCount}
            onComposeInputCapabilityDrop={onQuickComposeInputCapabilityDrop}
            onComposeInputWorkflowDrop={handleQuickComposeWorkflowDrop}
            promptCards={quickComposePromptCards}
            onRemovePromptCard={(key) =>
              setQuickComposePromptCards((prev) => prev.filter((c) => c.key !== key))
            }
            genSettings={{
              imageModelRegistryId: quickComposeImageModel,
              onImageModelRegistryId: setQuickComposeImageModel,
              textModelRegistryId: quickComposeTextModel,
              onTextModelRegistryId: setQuickComposeTextModel,
              aspectRatio: quickComposeAspect,
              onAspectRatio: setQuickComposeAspect,
              imageSize: quickComposeSize,
              onImageSize: setQuickComposeSize,
              count: quickComposeCount,
              onCount: setQuickComposeCount,
              understand: quickComposeUnderstand,
              onUnderstand: setQuickComposeUnderstand,
            }}
          />,
          document.body
        )
      : null}
    </>
  );
};

export default WorkflowSection;
