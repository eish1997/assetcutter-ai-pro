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
import { useWorkflowExecutionStartedAt } from '../hooks/useWorkflowAssetExecutionElapsed';
import { useWorkflowJustifiedLayout } from '../hooks/useWorkflowJustifiedLayout';
import { useWorkflowAssetCardHoverKeys, type WorkflowCardHoverControl } from '../hooks/useWorkflowAssetCardHoverKeys';
import { useEffectiveCapabilityModelRows } from '../hooks/useEffectiveCapabilityModelRows';
import { stepDisplayKeyInOrder } from '../services/workflowAssetDisplayKeyCycle';
import { useWorkflowLightboxBoot } from '../hooks/useWorkflowLightboxBoot';
import { createPortal, flushSync } from 'react-dom';
import {
  CloudDownload,
  Download,
  ImagePlus,
  Package,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  WorkflowAsset,
  WorkflowAssetVariant,
  WorkflowModel3dViewState,
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
import { beginAiTaskEnvelope, endAiTaskEnvelope, finalizeAiTaskEnvelopeCredits, isAiTaskBusy, prepareAiTaskEnvelopeCredits } from '../services/aiTaskEnvelope';
import { detectPipelineStepFromMessage } from '../services/aiPipelineStepError';
import {
  creditsExceededUserMessage,
  dispatchCreditsBalanceChanged,
  isCreditsExceededError,
} from '../shared/credits';
import {
  creditOverridesFromTaskLike,
  isSubmitBlockedForPlatformPlan,
  planQuickComposeRoutes,
  planWorkflowActionRoutes,
  requiresPlatformCredits,
  sumPlatformMinCredits,
} from '../services/aiBillingGate';
import { fetchAvailableCreditsForGate, fetchCreditBalance } from '../services/creditsApi';
import {
  emitWorkflowTaskReceiptNotice,
  resolveAvailableBalance,
} from '../services/workflowTaskReceiptNotice';
import { fetchMaxServerMinCreditsForStepsList, fetchServerMinCreditsForSteps } from '../services/usageQuoteGate';
import { useCreditBalance } from '../hooks/useCreditBalance';
import { useUsageQuoteForSteps } from '../hooks/useUsageQuoteForSteps';
import WorkflowZeroBalanceBanner from './WorkflowZeroBalanceBanner';
import { DEFAULT_MODEL_TEXT } from '../services/modelRegistry/constants';
import {
  applyPbrTextureAssetIdToDoc,
  collectAssetAllPbrTextureAssetIds,
  collectReferencedPbrTextureAssetIdsFromAssets,
  collectReferencedPbrTextureDataUrlsFromAssets,
  detachPbrTextureAssetIdsFromAssets,
  filterUnreferencedPbrTextureAssetIds,
  healWorkflowPbrTextureGridVisibility,
  isWorkflowAssetHiddenFromAssetGrid,
  isWorkflowPbrTextureAsset,
  normalizeWorkflowModelPbrEditDoc,
  pbrTextureEditMatchesRewriteSource,
  resolveStepModelPbrSlotKey,
  resolveWorkflowAssetPbrEditDoc,
  WORKFLOW_MODEL_PBR_EDIT_PERSIST_EVENT,
  writeWorkflowAssetStepPbrEdit,
  type WorkflowModelPbrEditPersistEventDetail,
  type WorkflowModelPbrTextureRewriteTarget,
} from '../services/workflowModelPbrEdits';
import {
  acknowledgeWorkflowModelPbrSlotGenerate,
  applyPbrSlotGenerateOverrides,
  completeWorkflowModelPbrSlotGenerate,
  reportWorkflowModelPbrSlotGenerateImage,
  reportWorkflowModelPbrSlotGenerateProgress,
  takeWorkflowModelPbrSlotGenerateAbortSignal,
  WORKFLOW_MODEL_PBR_SLOT_GENERATE_REQUEST_EVENT,
  type WorkflowModelPbrSlotGenerateImage,
  type WorkflowModelPbrSlotGenerateRequestDetail,
} from '../services/workflowModelPbrSlotGenerateBridge';
import { normalizeDataUrlForVisionApi } from '../services/workflowImageDataUrlCompress';
import {
  acknowledgePromotePbrTextureAsset,
  acknowledgeReleasePbrTextureAssets,
  completePromotePbrTextureAsset,
  completeReleasePbrTextureAssets,
  WORKFLOW_MODEL_PBR_TEXTURE_PROMOTE_REQUEST_EVENT,
  WORKFLOW_MODEL_PBR_TEXTURE_RELEASE_REQUEST_EVENT,
  type WorkflowModelPbrTexturePromoteRequestDetail,
  type WorkflowModelPbrTextureReleaseRequestDetail,
} from '../services/workflowModelPbrTextureAssetBridge';
import {
  WORKFLOW_MODEL_PBR_TEXTURE_ACTION_EVENT,
  type WorkflowModelPbrTextureAction,
} from '../services/workflowModelPbrTextureActions';
import { detectCutImageBoxes, FALLBACK_CUT_IMAGE_PRESET, FULL_IMAGE_BOX } from '../services/cutImageExecution';
import {
  isCutImageCapabilityPreset,
  presetUsesHostBundleProcessor,
  readCutImageParams,
} from '../services/capabilityProcessors/imageProcessProcessors';
import {
  coerceImageModelRegistryId,
  DEFAULT_IMAGE_MODEL_REGISTRY_ID,
} from '../services/modelRegistry/imageModels';
import { coerceTextModelRegistryId } from '../services/modelRegistry/textModels';
import { getDialogTextResponse } from '../services/unifiedAiGateway';
import {
  executeCapability,
  executeCapabilitySet,
} from '../services/capabilityExecutor';
import { getCapabilityEngine, isImageProcessPreset } from '../services/capabilityEngineKind';
import {
  isGeminiAsyncPollTimeoutError,
  type GeminiAsyncRecoveredDetail,
} from '../services/geminiAsyncJobRecovery';
import {
  extractAiWorkerProxyImageDataUrl,
  retryAllRecoverableGeminiJobs,
} from '../services/unifiedAiGateway';
import { consumeAiGatewayJobIdForImage } from '../services/aiGatewayImageResultRegistry';
import {
  applyGeminiRecoveredToWorkflowTask,
  GEMINI_ASYNC_RECOVERED_EVENT,
  scheduleWorkflowGeminiAsyncRecovery,
} from '../services/workflowGeminiAsyncRecovery';
import { overrideSkipUnderstandFromUnderstandEnabled, shouldRunCapabilityUnderstand } from '../services/workflowUnderstandOverride';
import { isWorkspaceCompanionDirectorySourceOfTruth } from '../services/workspaceCloudSync';
import {
  getQuickComposePlainModule,
  QUICK_COMPOSE_PLAIN_I2T_ACTION_ID,
  QUICK_COMPOSE_PLAIN_I2I_ACTION_ID,
  QUICK_COMPOSE_PLAIN_T2I_ACTION_ID,
  QUICK_COMPOSE_PLAIN_TEXT_ACTION_ID,
  QUICK_COMPOSE_PLAIN_VIDEO_ACTION_ID,
} from '../services/quickComposePlainPresets';
import { classifyWorkflowRunTaskBranch } from '../services/workflowRunTaskBranch';
import {
  getWorkflowMaxConcurrency,
  getWorkflowUnderstandImageConcurrency,
} from '../services/workflowConcurrency';
import {
  applyVgpAfterSuccessfulGen,
  attachInitialVgpToNewAsset,
  isVgpBlockingDiscardForDisplayKey,
  pruneVgpAfterDiscard,
} from '../services/vgp/vgpStore';
import {
  appendWorkflowAuditEvent,
  appendWorkflowRunTaskFailureAudit,
  appendWorkflowRunTaskSuccessAudit,
  hydrateWorkflowAuditRingSessionFromIdbOrLocalIfEmpty,
  readWorkflowAuditRing,
  WORKFLOW_AUDIT_CODES,
} from '../services/workflowAuditEvents';
import { clearCorrelationContext, setCorrelationContext } from '../services/observability/correlationContext';
import {
  AC_WORKFLOW_RETRY_TASK_EVENT,
  buildPendingTaskFromRetrySnapshot,
  parseRetrySnapshotFromAuditDetail,
  type WorkflowRunLogMeta,
  validateRetrySnapshot,
} from '../services/workflowTaskRetry';
import { setWorkflowMirrorPreferenceScope } from '../services/workflowMirrorPreferenceScope';
import { appendWorkflowOverlayCloseSnapshot, supersedeWorkflowOverlaySnapshotsForAsset, WORKFLOW_OVERLAY_PERIODIC_SNAPSHOT_MS, hydrateWorkflowOverlayRingSessionFromIdbOrLocalIfEmpty } from '../services/workflowOverlaySnapshots';
import type { WorkflowOverlaySnapshotBucket } from '../services/workflowOverlaySnapshots';
import { compareWorkflowOverlayDraftToPersisted } from '../services/workflowOverlayDraftCompare';
import { WorkflowStepTimelineDetailPanel } from './WorkflowStepTimelineDetailPanel';
import { WorkflowStepTimelinePanel } from './WorkflowStepTimelinePanel';
import { WorkflowOverlaySnapshotRecoverPanel } from './workflow/WorkflowOverlaySnapshotRecoverPanel';
import {
  WorkflowStepNodeGraphOverlay,
  type WorkflowStepNodeGraphMenuAction,
  type WorkflowStepNodeGraphNodeContext,
} from './WorkflowStepNodeGraphOverlay';
import { triggerImageDownload } from '../services/imageDataUrl';
import type { WorkflowLightboxImageWriteBackPayload } from '../services/imagePreviewWorkflowResize';
import { readLocalJson, scopedStorageKey, workflowFavoritesStorageKey, writeLocalJson } from '../services/clientPersist';
import { AI_GATEWAY_TRIPO_PLATFORM_KEY } from '../services/tripoService';
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
import { collectWorkflow3dBlobUrlsToRevoke } from '../services/workflowModelSlots';
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
import { dispatchWorkspaceSetFinger, publishAgentWorkbenchFinger } from '../services/agentWorkbenchBridge';
import { connectedHostsFromDrafts, readPublishedConnectionDrafts } from '../services/workspaceFingerHosts';
import {
  canvasFingerKey,
  nextSelectedAssetIdsFromFinger,
  omitConnectedHostsFromFinger,
  workspaceFingerFromUi,
  type WorkspaceFinger,
} from '../services/workspaceDocumentProtocol';
import AppIcon from './ui/AppIcon';
import { AssetPreviewOverlay } from './workflow/AssetPreviewOverlay';
import { AssetMediaPreviewCenter } from './workflow/AssetMediaPreviewCenter';
import { WorkflowLightboxModel3dRail } from './workflow/WorkflowLightboxModel3dRail';
import type {
  ImagePreviewCanvasAdjustControl,
  ImagePreviewLayoutMode,
  ImagePreviewWebCaptureApi,
  AssetCapabilityOutputAsset,
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

import { resolveCapabilityPreviewSrc } from '../services/capabilityPreviewUrl';
import { WorkflowCapabilityHoverPreview } from './WorkflowCapabilityHoverPreview';
import { WorkflowGridImage } from './ProgressivePreviewImage';
import {
  AssetCardPreviewRenderer,
  rememberAssetCardModelThumbnail,
} from './workflow/AssetCardPreviewRenderer';
import WorkflowPixelBusyOverlay from './WorkflowPixelBusyOverlay';
import { workflowResultUsesVideoPreview, workflowSafeImgSrc } from '../services/workflowImageDisplay';
import { previewSrcCacheFingerprint } from '../services/workflowImageThumb';
import {
  mergeWorkflowOriginalCompanionPersist,
  pickWorkflowGridCardPreviewSrc,
  resolveWorkflowAssetGridPreviewCompanionKey,
} from '../services/workflowGridCardPreview';
import { safeSvgDataUrl } from '../services/svgDataUrl';
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
  parseWorkflowAssetIdsFromClipboardData,
  parseWorkflowDragSource,
  resolveCapabilityDropDragSources,
  workflowDragSourceAllowsSidebarOps,
  type WorkflowDragSource,
} from '../services/workflowDragPipeline';
import {
  clearWorkflowCardDragDropSession,
  readWorkflowCardDragDropSession,
  updateWorkflowCardDragOver,
  workflowCardDragLeave,
} from '../services/workflowCardDragUi';
import { pickWorkflowCardPlaceholderSrc } from '../services/workflowListPaneSnapshot';
import {
  mountLightboxLoadingCover,
  unmountLightboxLoadingCover,
} from './workflow/WorkflowLightboxInstantShell';
import { prefetchWorkflowLightboxImage } from '../services/workflowLightboxPrefetch';
import { resolveWorkflowFunctionSidebarLayout } from '../services/workflowFunctionSidebarLayout';
import { applyRootWorkflowAssetReorder } from '../services/workflowRootAssetReorder';
import { reorderManualGroupItemIndexes } from '../services/workflowGroupItemReorder';
import { copyWorkflowAssetIdToClipboard, copyWorkflowAssetOriginalImageToClipboard } from '../services/workflowAssetClipboard';
import { WORKFLOW_CUT_DETECT_TIMEOUT_MS } from './workflow/workflowConstants';
import WorkflowTextLightboxCenter, {
  type WorkflowTextLightboxCenterHandle,
} from './workflow/WorkflowTextLightboxCenter';
import {
  buildComposerTextAssetThumbDataUrl,
  clampWorkflowTextBody,
  healWorkflowAssetDisplayKeyIfEmpty,
  isWorkflowModelSvgPlaceholderSrc,
  isWorkflowTextAsset,
  resolveWorkflowDisplaySlot,
  workflowAssetAllowedForCapabilityDrop,
  workflowAssetCurrentDisplayIsTextChannel,
  workflowAssetCardZoomEligible,
  workflowAssetLightboxRasterEligible,
  workflowAssetToInputText,
  workflowPresetAcceptsTextCardDrag,
} from '../services/workflowTextAsset';
import {
  createEmptyStoryboardTableAsset,
  duplicateStoryboardTableOnAsset,
  isWorkflowStoryboardTableAsset,
  normalizeStoryboardTableOnAsset,
  storyboardTableCoverImage,
} from '../services/storyboardTableAsset';
import StoryboardTablePanel from './storyboard/StoryboardTablePanel';
import StoryboardTableGridCard from './storyboard/StoryboardTableGridCard';
import AssetSetPanel from './asset-set/AssetSetPanel';
import AssetSetGridCard from './asset-set/AssetSetGridCard';
import {
  createAssetSetAsset,
  isWorkflowAssetSetAsset,
  normalizeAssetSetOnAsset,
} from '../services/assetSet/assetSetAsset';
import {
  applyAssetSetCompanionHydrateResults,
  buildAssetSetCompanionHydrateKey,
  hydrateAssetSetCompanionTasks,
  listAssetSetCompanionHydrateTasks,
} from '../services/assetSet/assetSetCompanion';
import { useStoryboardVideoExportTask } from './storyboard/useStoryboardVideoExport';
import { compressStoryboardFrameDataUrl } from './storyboard/storyboardFrameImage';
import {
  applyStoryboardFrameCompanionHydrateResults,
  applyStoryboardFrameHistoryCompanionHydrateResults,
  applyStoryboardGeneratedImageHistoryCompanionHydrateResults,
  applyStoryboardNamedAssetCompanionHydrateResults,
  buildStoryboardFrameCompanionHydrateKey,
  buildStoryboardFrameHistoryCompanionHydrateKey,
  buildStoryboardGeneratedImageHistoryCompanionHydrateKey,
  buildStoryboardNamedAssetCompanionHydrateKey,
  hydrateStoryboardFrameCompanionTasks,
  hydrateStoryboardFrameHistoryCompanionTasks,
  hydrateStoryboardGeneratedImageHistoryCompanionTasks,
  hydrateStoryboardNamedAssetCompanionTasks,
  listStoryboardFrameCompanionHydrateTasks,
  listStoryboardFrameHistoryCompanionHydrateTasks,
  listStoryboardGeneratedImageHistoryCompanionHydrateTasks,
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
import { resolveStoryboardFrameDisplaySrc, storyboardRowHasFrameRef } from '../services/storyboardFrameImageUrl';
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
  allocateWorkflowResultVersionKey,
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
  WORKFLOW_CARD_SHELL_PAD,
  WORKFLOW_CARD_SHELL_SELECTED,
  WORKFLOW_CARD_SHELL_IDLE,
  WORKFLOW_CARD_INNER_RADIUS,
  WORKFLOW_GROUP_CARD_FACE_CLASS,
  WORKFLOW_META_PILL,
  WORKFLOW_EDGE_GUTTER,
  WORKFLOW_CHROME_BTN_NEUTRAL,
  WORKFLOW_TOPBAR_ICON_BTN,
  WORKFLOW_LIGHTBOX_BOTTOM_RAIL,
  WORKFLOW_LIGHTBOX_VGP_GRAPH_LEFT_INSET,
  WORKFLOW_LIGHTBOX_ASSET_THUMB_STRIP_INSET,
  WORKFLOW_LIGHTBOX_COMPOSE_DOCKED_INSET,
  WORKFLOW_IMAGE_PREVIEW_RAIL,
  WORKFLOW_CARD_DISMISS_ICON_BTN,
  WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER,
} from './workflow/workflowSectionUiConstants';
import {
  dedupeWorkflowAssetsById,
  sortRootWorkflowAssetsNewestFirst,
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
  loadImageIntrinsicSize,
  persistWorkflowCardAspects,
  readSessionWorkflowCardAspects,
  resolveWorkflowCanvasCardAspect,
  resolveWorkflowGridCardAspect,
} from './workflow/workflowCardAspect';
import {
  WORKFLOW_ASSET_GRID_GAP_PX,
  workflowJustifiedTargetRowHeight,
} from '../services/workflowJustifiedLayout';
import {
  resolveWorkflowAssetStepBadge,
} from '../services/workflowAssetStepCount';
import {
  resolveWorkflowAssetActiveVariant,
  resolveWorkflowAssetVariants,
} from '../services/workflowAssetVariants';
import {
  resolveLightboxCenterRoute,
  resolveLightboxChromeSlots,
  resolveLightboxPreviewImageSrc,
} from '../services/workflowLightboxCenterRoute';
import { groupCapabilityPresetsByCategory } from './workflow/workflowCapabilityGroups';
import { WorkflowSidebarColumn, type WorkflowSidebarFavoriteEntry } from './workflow/WorkflowSidebarColumn';
import { WorkshopFileTreeColumn } from './workshop/WorkshopFileSource';
import { WorkshopCanvasNavBar } from './workshop/WorkshopCanvasNavBar';
import {
  applyWorkshopFileState,
  hasWorkbenchFileSourceApi,
  isWorkshopBrowserLibraryRoot,
  isWorkshopRecycleRoot,
  workshopRootAllowsCreate,
  parseWorkshopFileAssetId,
  selectedRelFromAssetIds,
  workshopCardDiskRel,
  workshopFileAssetId,
  workshopFileSourceApi,
  workshopMoveToParentDestRel,
  type WorkshopRootInfo,
  WORKSHOP_BROWSER_LIBRARY_ROOT,
  WORKSHOP_FOLDERS_PANE_WIDTH_PX,
  WORKSHOP_THUMB_IPC_PARALLEL,
} from '../services/workshopFileTree';
import {
  parseWorkshopCardId,
  utf8FromDataUrl,
  workshopCanvasItemsToWorkflowAssets,
  workshopHostFilePayload,
  workshopPackageCardId,
  type WorkshopCanvasItem,
  type WorkshopMediaHit,
} from '../services/workshopAssetPackage';
import {
  isWorkshopBatchEligible,
  mergeWorkshopCanvasItems,
  optimisticWorkshopPackageItem,
  remapGenerationBatchToWorkshop,
  workshopTitleFromAsset,
  type WorkshopCreatedPackage,
} from '../services/workshopGenerationRemap';
import { workshopDisplayNeedsApply } from '../services/workshopCheckoutDebounce';
import {
  countWorkshopCanvasKinds,
  emptyWorkshopNavHistory,
  filterWorkshopCanvasByKind,
  normalizeWorkshopNavLoc,
  pushWorkshopNav,
  workshopBreadcrumbSegments,
  workshopCanvasKindMatches,
  workshopNavBack,
  workshopNavCanBack,
  workshopNavCanForward,
  workshopNavCanUp,
  workshopNavForward,
  workshopNavRootLabel,
  workshopNavUpLoc,
  type WorkshopCanvasKindFilter,
  type WorkshopNavLoc,
} from '../services/workshopCanvasNav';
import { isWorkshopPlayableMediaUrl, isWorkshopSpecialRasterName, isWorkshopTextPreviewName } from '../services/workshopPreviewKind';
import { decodeWorkshopSpecialRasterToJpeg } from '../services/workshopSpecialRaster';
import WorkflowSpaceMarqueeChrome from './workflow/WorkflowSpaceMarqueeChrome';
import WorkflowMarqueeOverlay from './workflow/WorkflowMarqueeOverlay';
import WorkflowLightboxDetailEdgePanel from './workflow/WorkflowLightboxDetailEdgePanel';
import WorkflowLightboxAssetThumbStrip from './workflow/WorkflowLightboxAssetThumbStrip';
import WorkflowAssetContextMenu from './workflow/WorkflowAssetContextMenu';
import WorkflowAssetStepCountBadge from './workflow/WorkflowAssetStepCountBadge';
import WorkflowGroupCardStackPreviews from './workflow/WorkflowGroupCardStackPreviews';
import { WorkflowJustifiedVirtualGrid, type WorkflowJustifiedMarqueeHitFn } from './workflow/WorkflowJustifiedVirtualGrid';
import {
  createSmoothWheelScrollController,
  type SmoothWheelScrollController,
} from './workflow/workflowSmoothWheelScroll';
import WorkspaceQuickComposeBar, {
  type WorkspaceQuickComposeComposeMode,
  type WorkspaceQuickComposePromptCard,
} from './WorkspaceQuickComposeBar';
import type { QuickComposeDropSlot, QuickComposeDropZone, QuickComposeMention, QuickComposeSegment } from '../services/quickComposeMention';
import { composerHasSendableContent } from '../services/quickComposeSendGate';
import {
  buildQuickComposePromptOverride,
  buildQuickComposeTaskPromptOverride,
  draftFromSegments,
  ensureQuickComposeEditableBoundaries,
  listDropSlotMentionCandidates,
  listExpertMentionCandidates,
  mentionsFromSegments,
  newQuickComposeTextSegment,
  renumberQuickComposeMainDropSlotLabels,
  renumberQuickComposeReferenceDropSlotLabels,
  resolveQuickComposeImageQueues,
  resolveQuickComposeReferences,
  splitPrimaryAndReferenceImageUrls,
  stripCurrentViewFromQuickComposeSegments,
  workflowAssetMentionLabel,
} from '../services/quickComposeMention';
import type {
  AgentSuggestedAction,
  QuickComposeChatMessageView,
  QuickComposeThreadMessage,
  QuickComposeThreadScope,
} from '../types/quickComposeThread';
import {
  patchQuickComposeThreadMessageStatuses,
  resolvePlainTextPromptForModel,
} from '../services/quickComposeTurnContext';
import {
  collectQuickComposeAttachmentAssetIds,
  mapQuickComposeThreadMessagesToChatViews,
} from '../services/quickComposeChatView';
import { buildProjectAgentIntent } from '../services/projectAgent/intent';
import { planTools } from '../services/projectAgent/planTools';
import { formatPlanTemplate } from '../services/projectAgent/planTemplate';
import { createRuntimePerceptionContextBus } from '../services/runtimePerception/contextBus';
import { buildProjectAgentPerceptionContext } from '../services/runtimePerception/visibleSummary';
import {
  buildRuntimeWorkspaceState,
  buildWorkbenchPerceptionRisks,
  buildWorkbenchSelectionCapabilities,
} from '../services/runtimePerception/workbenchAdapter';
import {
  buildRuntimeWorkflowState,
  buildWorkflowCapabilities,
} from '../services/runtimePerception/workflowAdapter';
import {
  buildExternalAppCapabilities,
} from '../services/runtimePerception/externalAppAdapter';
import { readRuntimeExternalAppSnapshotFromCompanion } from '../services/runtimePerception/connectionPackageClient';
import { resolveComposerMode } from '../services/projectAgent/autoMode';
import {
  buildChildRunsFromPlan,
  patchChildRunsFromTasks,
} from '../services/projectAgent/childRuns';
import {
  createProjectAgentRuntime,
  PROJECT_AGENT_CANCELLED_MESSAGE,
  type ProjectAgentRuntime,
} from '../services/projectAgent/runtime';
import {
  archiveAndResetProjectAgentThread,
  finalizeStaleInFlightProjectAgentThread,
  loadOrCreateProjectAgentThread,
  saveProjectAgentThread,
  type ProjectAgentThread,
  type ProjectAgentThreadStoreKey,
} from '../services/projectAgent/threadStore';
import {
  cancelPendingProjectAgentHotBackup,
  hydrateProjectAgentThreadFromCloud,
  scheduleProjectAgentThreadArchiveBackup,
  scheduleProjectAgentThreadBackup,
} from '../services/projectAgent/threadCloudSync';
import { maybeCompactProjectAgentThread } from '../services/projectAgent/compaction';
import {
  addProjectAgentKnowledge,
  deleteProjectAgentKnowledge,
  deleteAgentSkill,
  downloadProjectAgentThreadSlimJson,
  hasEarlierMessagesLocal,
  installAgentSkill,
  listAgentSkills,
  listEnabledAgentSkills,
  listProjectAgentKnowledge,
  loadEarlierMessagesIntoHot,
  saveLocalThreadArchive,
  setAgentSkillEnabled,
  setProjectAgentKnowledgeEnabled,
  stashMessagesDroppedFromHot,
} from '../services/projectAgent';
import { invokeExpert } from '../services/projectAgent/experts/invoke';
import {
  applyExpertProfilePatch,
  getExpertProfile,
  listExpertProfiles,
} from '../services/projectAgent/experts/registry';
import {
  applyConfirmedMemoryProposal,
  detectExpertTuneProposals,
} from '../services/projectAgent/experts/tuneProtocol';
import { createWorkflowProjectAgentHostPort } from './project-agent/createWorkflowProjectAgentHostPort';
import { mapPlanToQuickComposeInvoke } from './project-agent/mapPlanToQuickComposeInvoke';
import {
  PROJECT_AGENT_EMPTY_HINT,
  PROJECT_AGENT_EMPTY_TITLE,
  quickComposeChatActionConfirmCopy,
  resolveComposerSubmitDisabledReason,
  shouldHardBlockComposerCredits,
} from './workflow/quickComposeChat/chatUiCopy';
import type {
  AgentChildRun,
  AgentMentionRef,
  AgentPlannedTool,
  AgentSurfaceContext,
  ProjectAgentExecutePlanResult,
  ProjectAgentIntent,
} from '../types/projectAgent';
import type {
  ProjectAgentPerceptionContext,
  RuntimeExternalAppState,
  RuntimePerceptionRisk,
} from '../types/runtimePerception';
import { buildWorkflowComposerSeedFromTwoPresets } from './workflow/buildWorkflowComposerSeed';
import type { CapabilityAssetCandidate } from './CapabilitySetCanvas';
import { BUILTIN_IMAGE_PROCESS_IDS } from '../services/capabilityPresetStore';
import { useStoreCatalog } from '../services/storeCatalogHook';
import { buildCloudPresetIdSet } from '../services/capabilityPresetCloudOrigin';
import {
  formatWorkflowModelPreviewLimitLabel,
  revokeWorkflowModelBlobUrlsAfterAssetRemoved,
  workflowLocalModelFileExceedsPreviewLimit,
} from '../services/workflowModelBlob';
import { captureWorkflowModelThumbnailDataUrl } from '../services/workflowModelPreviewCapture';
import { normalizeWorkflowModel3dViewState } from '../services/workflowModelThreeShared';
import {
  patchAssetWithModelViewportThumb,
  planModelViewportPosterPersist,
  resolveWorkflowModelStepPosterSrc,
  workflowAssetHasModelAtStep,
} from '../services/workflowModelViewportThumbPersist';
import { getCompanionLocalBaseUrl, normalizeCompanionBaseUrl } from '../services/companionLocalPrefs';
import {
  canAttemptOpenWorkflowAssetFolder,
  canOpenWorkflowAssetFolder,
  resolveWorkflowAssetLocalHandle,
  resolveWorkflowAssetLocalHandleOnDisk,
} from '../services/workflowMediaLocator';
import { ensureWorkflowAssetCompanionKeyForReveal } from '../services/workflowEnsureCompanionForReveal';
import {
  deleteCompanionAsset,
  deleteCompanionAssetDirectory,
  getCompanionAssetMeta,
  probeCompanionSamSegmentHealth,
  putCompanionAsset,
  revealCompanionAssetFolderWithProjectFallback,
} from '../services/companionClient';
import {
  cloneWorkflowModelSlotsForDuplicatedAsset,
  companionRasterSlotNeedsHydrate,
  fetchWorkflowModelFromCompanionAsObjectUrl,
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  parseDataUrlToBlob,
  putWorkflowModelFileToCompanion,
  putWorkflowOriginalBlobToCompanion,
  imageSrcToDataUrlForCompanion,
  putWorkflowOriginalImageFromAnyUrl,
  putWorkflowOriginalImageToCompanion,
  putWorkflowResultImageFromAnyUrl,
  putWorkflowResultImageToCompanion,
  putWorkflowResultMediaFromAnyUrl,
  resolveCapabilityInputImageForExecute,
  resolveWorkflowImageSlotIndex,
  sanitizeCompanionPathSegment,
  shouldKeepExistingCompanionRasterUrl,
  workflowAssetNeedsCompanionModelHydrate,
  workflowAssetNeedsCompanionOriginalHydrate,
  workflowAssetNeedsCompanionResultHydrate,
} from '../services/workflowCompanionAssets';
import {
  applyCompanionHydratePatches,
  buildCompanionHydrateSessionKey,
  runWorkflowCompanionEagerRasterHydrate,
} from '../services/workflowCompanionLazyHydrate';
import { collectReferencedCompanionKeys } from '../services/workflowManifestCrossCheck';

const WORKFLOW_MODEL_EXT_RE = /\.(glb|gltf|fbx|obj)$/i;
const WORKFLOW_VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)$/i;

function companionAssetDirectoryIdFromKey(key: string): string {
  const k = String(key || '').trim();
  if (!k.includes('/')) return '';
  return sanitizeCompanionPathSegment(k.split('/')[0] || '');
}

function workflowAssetVariantHasDirectModelUrl(variant: WorkflowAssetVariant | null | undefined): boolean {
  if (!variant || variant.kind !== 'model3d') return false;
  return Boolean(
    String(variant.url || '').trim() ||
      (variant.modelUrls || []).some((url) => String(url || '').trim())
  );
}

function workflowAssetVariantHasModelCompanionKey(variant: WorkflowAssetVariant | null | undefined): boolean {
  if (!variant || variant.kind !== 'model3d') return false;
  return (variant.modelCompanionKeys || []).some((key) => String(key || '').trim());
}

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

function inferWorkflowModelFileFormat(file: File): 'glb' | 'gltf' | 'fbx' | 'obj' {
  const name = String(file.name || '').split(/[?#]/)[0].toLowerCase();
  const type = String(file.type || '').toLowerCase();
  if (name.endsWith('.gltf') || type.includes('gltf+json')) return 'gltf';
  if (name.endsWith('.fbx') || type.includes('fbx')) return 'fbx';
  if (name.endsWith('.obj') || type.includes('model/obj')) return 'obj';
  return 'glb';
}

function isWorkflowVideoFile(file: File): boolean {
  const name = file.name || '';
  if (WORKFLOW_VIDEO_EXT_RE.test(name)) return true;
  const t = (file.type || '').toLowerCase();
  return t.startsWith('video/');
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

type WorkflowOnLog = (
  level: 'info' | 'warn' | 'error',
  message: string,
  detail?: string,
  meta?: WorkflowRunLogMeta
) => void;

function emitWorkflowTaskFailure(
  onLog: WorkflowOnLog | undefined,
  task: WorkflowPendingTask,
  args: {
    code: string;
    level: 'warn' | 'error';
    message: string;
    detail?: Record<string, unknown>;
    logDetail?: string;
  }
) {
  const ev = appendWorkflowRunTaskFailureAudit({
    task,
    code: args.code,
    level: args.level,
    message: args.message,
    detail: args.detail,
  });
  onLog?.(
    args.level,
    args.message,
    args.logDetail ?? (args.detail?.error != null ? String(args.detail.error) : undefined),
    { auditEventId: ev.id, retryable: Boolean(ev.detail?.retryable) }
  );
}

function formatWorkflowRunTaskErrorMessage(err: unknown, taskLabel: string): string {
  if (isCreditsExceededError(err)) {
    const msg =
      err instanceof Error && err.message.trim() ? err.message : creditsExceededUserMessage();
    return `[${taskLabel}] ${msg}`;
  }
  if (isGeminiAsyncPollTimeoutError(err)) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[${taskLabel}] ${msg}`;
  }
  const msg =
    err instanceof Error ? normalizeApiErrorMessage(err) : normalizeApiErrorMessage(String(err));
  if (detectPipelineStepFromMessage(msg)) return msg;
  return `[${taskLabel}] ${msg}`;
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
  overrideVideoModelRegistryId?: string;
  overrideVideoDurationSeconds?: number;
  overrideVideoAspectRatio?: string;
  overrideVideoResolution?: string;
  overrideVideoMotionStrength?: number;
  overrideModel3dRegistryId?: string;
  overrideModel3dQuality?: string;
  overrideModel3dGeometryQuality?: string;
  overrideModel3dTextureQuality?: string;
  overrideModel3dFormat?: string;
  overrideModel3dTexture?: boolean;
  overrideModel3dPbr?: boolean;
  overrideImageAspectRatio?: string;
  overrideImageSize?: string;
  overrideSkipUnderstand?: boolean;
  logContext?: WorkflowPendingTask['logContext'];
  tripoMultiviewImages?: WorkflowPendingTask['tripoMultiviewImages'];
  modelPbrTextureRewriteTarget?: WorkflowPendingTask['modelPbrTextureRewriteTarget'];
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
  inputSourceDisplayKeySnapshot?: string;
} {
  const used = Array.isArray(vgpSteps) && vgpSteps.length > 0;
  const po = String(task.promptOverride ?? '').trim();
  const it = String(task.inputText ?? '').trim();
  const src = String(task.inputSourceDisplayKey ?? '').trim();
  return {
    presetActionIdSnapshot: baseActionId(task.actionType),
    ...(po ? { promptOverrideSnapshot: po } : {}),
    ...(it ? { inputTextSnapshot: it } : {}),
    usedCapabilityUnderstand: used,
    ...(task.overrideSkipUnderstand === true ? { skipUnderstandSnapshot: true } : {}),
    ...(src ? { inputSourceDisplayKeySnapshot: src } : {}),
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
type LightboxLaunchAnimation = {
  id: string;
  src: string;
  from: { left: number; top: number; width: number; height: number };
  to: { left: number; top: number; width: number; height: number };
  active: boolean;
};

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

export type QuickComposeChatDockHandlers = {
  messages: QuickComposeChatMessageView[];
  threadTitle: string;
  /** Credits blocked — disables typing; does not block attachment drag */
  isInputDisabled: boolean;
  /** Credits / empty draft / in-flight assistant — disables send only */
  isSendDisabled: boolean;
  selectionStatusLabel: string;
  selectionStatusTone: 'idle' | 'active' | 'preview';
  perceptionContext?: ProjectAgentPerceptionContext;
  onResultPreview: (assetId: string, event: React.MouseEvent<HTMLElement>) => void;
  onSend: () => void;
  onRetry: (messageId: string) => void;
  onAction: (messageId: string, action: AgentSuggestedAction) => void;
  /** §16.1 / 3A：取消进行中的助手 turn（跳过关联 task） */
  onCancel: (messageId: string) => void;
};

const WorkflowSection: React.FC<{
  capabilityPresets: CustomAppModule[];
  capabilitySets?: CapabilitySet[];
  assets: WorkflowAsset[];
  onAssetsChange: (value: React.SetStateAction<WorkflowAsset[]>) => void;
  /** 用户显式删除分镜表资产时通知 App，以便 autosave 允许移除 */
  onStoryboardTableAssetRemoved?: (assetId: string) => void;
  pending: WorkflowPendingTask[];
  onPendingChange: (value: React.SetStateAction<WorkflowPendingTask[]>) => void;
  onLog?: WorkflowOnLog;
  /** 拖图到「生成3D」能力时调用，不进入执行队列，直接提交 3D 任务 */
  onAddGenerate3DJob?: (
    preset: CustomAppModule,
    imageBase64: string,
    task?: WorkflowPendingTask,
    multiviewImages?: WorkflowPendingTask['tripoMultiviewImages'],
    options?: { forceNewTask?: boolean; resumeExistingTask?: boolean }
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
  /** App 级右侧侧栏挂载点（工作区 / 大图共用展开态 portal 目标） */
  quickComposeWorkspaceDockHostRef?: React.RefObject<HTMLDivElement | null>;
  /** 工作区快捷栏展开态（供 App 挤压布局；大图预览壳层同步留白） */
  workspaceQuickComposeExpanded?: boolean;
  /** 工作区快捷栏展开态变化 */
  onWorkspaceQuickComposeExpandedChange?: (expanded: boolean) => void;
  /** 快捷栏展开态聊天 dock（workspace / lightbox 分线程） */
  onQuickComposeChatDockHandlersChange?: (handlers: QuickComposeChatDockHandlers | null) => void;
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
  quickComposeWorkspaceDockHostRef,
  workspaceQuickComposeExpanded = false,
  onWorkspaceQuickComposeExpandedChange,
  onQuickComposeChatDockHandlersChange,
}) => {
  const { balance: creditBalance, loading: creditBalanceLoading } = useCreditBalance(preferenceScope);
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
  const geminiRecoveryTasksRef = React.useRef<Map<string, WorkflowPendingTask>>(new Map());
  const assetsRef = React.useRef(assets);
  assetsRef.current = assets;
  const persistedModelThumbnailSlotsRef = useRef<Set<string>>(new Set());
  const onLogRef = React.useRef(onLog);
  onLogRef.current = onLog;
  const [fileSourceApi, setFileSourceApi] = useState(() => hasWorkbenchFileSourceApi());
  const [workshopActiveRoot, setWorkshopActiveRoot] = useState(WORKSHOP_BROWSER_LIBRARY_ROOT);
  const workshopDiskOpen = Boolean(fileSourceApi && !isWorkshopBrowserLibraryRoot(workshopActiveRoot));

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
  const { remotePresetItems } = useStoreCatalog({});
  const cloudPresetIds = useMemo(() => buildCloudPresetIdSet(remotePresetItems), [remotePresetItems]);
  const textAssetActionModules = useMemo(
    () => actionModules.filter((mod) => workflowPresetAcceptsTextCardDrag(mod)),
    [actionModules]
  );
  const byCategory = useMemo(() => groupCapabilityPresetsByCategory(presets), [presets]);
  const [columnCount, setColumnCount] = useState(4);
  const justifiedTargetRowHeight = useMemo(
    () => workflowJustifiedTargetRowHeight(columnCount),
    [columnCount]
  );
  const showArchived = false;
  const [archiveHint, setArchiveHint] = useState<{ assetId: string; ts: number } | null>(null);
  const [refiningTagKeys, setRefiningTagKeys] = useState<Set<string>>(new Set());
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  /** 打开大图前截取的列表视口静态图，作预览背景（列表卸载后仍可见） */
  const [lightboxListBackdropUrl, setLightboxListBackdropUrl] = useState<string | null>(null);
  const [lightboxOverlayMounted, setLightboxOverlayMounted] = useState(false);
  /**
   * 关 3D 大图：先视觉隐藏壳（露出资产列表），保留 3D 模块截缩略图后再卸载。
   */
  const [lightboxOverlayClosingHidden, setLightboxOverlayClosingHidden] = useState(false);
  const lightboxOverlayClosingHiddenRef = useRef(false);
  lightboxOverlayClosingHiddenRef.current = lightboxOverlayClosingHidden;
  /** 取消进行中的「隐藏后截图再关」 */
  const lightboxModelThumbCloseGenRef = useRef(0);
  const [lightboxPlaceholderImageSrc, setLightboxPlaceholderImageSrc] = useState<string | null>(null);
  const [lightboxLaunchAnimation, setLightboxLaunchAnimation] =
    useState<LightboxLaunchAnimation | null>(null);
  const {
    phase: lightboxBootPhase,
    beginOpen: beginLightboxBoot,
    reset: resetLightboxBoot,
    notifyPrimaryImageReady: notifyLightboxPrimaryReady,
    isChromeReady: lightboxChromeReady,
  } = useWorkflowLightboxBoot();
  const lightboxPrefetchTimerRef = useRef<number | null>(null);
  /** 取消进行中的分帧开大图（用户快速关闭时） */
  const lightboxOpenGenRef = useRef(0);
  const [workflowAssetContextMenu, setWorkflowAssetContextMenu] = useState<{
    assetId: string;
    x: number;
    y: number;
  } | null>(null);
  const [storyboardPanelAssetId, setStoryboardPanelAssetId] = useState<string | null>(null);
  const [assetSetPanelAssetId, setAssetSetPanelAssetId] = useState<string | null>(null);
  const lightboxAssetIdRef = useRef<string | null>(null);
  lightboxAssetIdRef.current = lightboxAssetId;
  const [lightboxTripoPullBusy, setLightboxTripoPullBusy] = useState(false);
  const [lightboxTencentPullBusy, setLightboxTencentPullBusy] = useState(false);
  const lightboxSamArmEdgeRef = useRef(false);
  const textLightboxCenterRef = useRef<WorkflowTextLightboxCenterHandle | null>(null);
  const [lightboxMetaText, setLightboxMetaText] = useState<string>('');
  const [lightboxPointerRgb, setLightboxPointerRgb] = useState<{ r: number; g: number; b: number } | null>(null);
  const lightboxPointerRgbPendingRef = useRef<{ r: number; g: number; b: number } | null>(null);
  const lightboxPointerRgbFrameRef = useRef<number | null>(null);
  const handleLightboxPointerRgbSample = useCallback((rgb: { r: number; g: number; b: number } | null) => {
    lightboxPointerRgbPendingRef.current = rgb;
    if (lightboxPointerRgbFrameRef.current != null) return;
    lightboxPointerRgbFrameRef.current = window.requestAnimationFrame(() => {
      lightboxPointerRgbFrameRef.current = null;
      const next = lightboxPointerRgbPendingRef.current;
      setLightboxPointerRgb((prev) => {
        if (next == null && prev == null) return prev;
        if (next != null && prev != null && next.r === prev.r && next.g === prev.g && next.b === prev.b) {
          return prev;
        }
        return next;
      });
    });
  }, []);
  useEffect(
    () => () => {
      if (lightboxPointerRgbFrameRef.current != null) {
        window.cancelAnimationFrame(lightboxPointerRgbFrameRef.current);
      }
    },
    []
  );
  const [lightboxUiHidden, setLightboxUiHidden] = useState(false);
  const [lightboxDetailPanelOpen, setLightboxDetailPanelOpen] = useState(false);
  const handleLightboxUiHiddenChange = useCallback((hidden: boolean) => {
    setLightboxUiHidden(hidden);
  }, []);
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
  const [lightboxTexturePreview, setLightboxTexturePreview] = useState<{ assetId: string; src: string } | null>(null);
  const [lightboxModel3dDisplayMode, setLightboxModel3dDisplayMode] = useState<Model3DDisplayMode>('material');
  const [lightboxModel3dResetViewNonce, setLightboxModel3dResetViewNonce] = useState(0);
  const [lightboxModel3dShowGrid, setLightboxModel3dShowGrid] = useState(true);
  const [lightboxModel3dBackfaceCulling, setLightboxModel3dBackfaceCulling] = useState(true);
  const [lightboxMediaCapturePreviewNonce, setLightboxMediaCapturePreviewNonce] = useState(0);
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
  /** 3D 预览内用户改过视角/显示/PBR 时，关闭大图后强制刷新卡片缩略图 */
  const lightboxModel3dViewDirtyRef = useRef(false);
  const markLightboxModel3dViewDirty = useCallback(() => {
    lightboxModel3dViewDirtyRef.current = true;
  }, []);
  const persistLightboxModel3dViewState = useCallback(
    (state: WorkflowModel3dViewState, assetIdHint?: string) => {
      const id = String(assetIdHint || lightboxAssetIdRef.current || '').trim();
      if (!id) return;
      const next = normalizeWorkflowModel3dViewState(state);
      if (!next) return;
      setAssets((prev) => {
        const cur = prev.find((asset) => asset.id === id);
        if (!cur) return prev;
        const prevState = normalizeWorkflowModel3dViewState(cur.model3dViewState);
        if (
          prevState &&
          prevState.camera.position[0] === next.camera.position[0] &&
          prevState.camera.position[1] === next.camera.position[1] &&
          prevState.camera.position[2] === next.camera.position[2] &&
          prevState.camera.target[0] === next.camera.target[0] &&
          prevState.camera.target[1] === next.camera.target[1] &&
          prevState.camera.target[2] === next.camera.target[2] &&
          prevState.displayMode === next.displayMode &&
          prevState.showGrid === next.showGrid &&
          prevState.backfaceCulling === next.backfaceCulling
        ) {
          return prev;
        }
        return prev.map((asset) => (asset.id === id ? { ...asset, model3dViewState: next } : asset));
      });
    },
    [setAssets]
  );
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
    setLightboxDetailPanelOpen(false);
    if (!lightboxAssetId) {
      setLightboxUiHidden(false);
      setLightboxQuickComposeAnchor(null);
    }
  }, [lightboxAssetId]);

  /** Phase 2 / P5: one project Agent thread (lightbox only changes surface context). */
  const [workspaceQuickComposeThread, setWorkspaceQuickComposeThread] = useState<ProjectAgentThread | null>(
    null
  );
  const workspaceQuickComposeThreadRef = useRef<ProjectAgentThread | null>(null);
  /** 防止连点/Enter 重复入队（thread ref 异步更新前的窗口期） */
  const quickComposeChatSendGuardRef = useRef(false);
  /** 清空对话时递增；进行中的 submit 在 await 后若 generation 变了则勿追加消息 */
  const quickComposeClearGenerationRef = useRef(0);
  const projectAgentInlineImageRefsRef = useRef<string[]>([]);
  const projectAgentInlineImageContextRef = useRef<WorkflowPendingTask['inputContext'] | null>(null);
  /** 最近一次 submitQuickCompose 创建的 taskId→assetId，供对话线程持久化 */
  const lastQuickComposeTaskAssetByIdRef = useRef<Record<string, string>>({});
  const projectAgentRuntimeRef = useRef<ProjectAgentRuntime | null>(null);
  const [projectAgentMemoryRevision, setProjectAgentMemoryRevision] = useState(0);
  const [projectAgentSkillRevision, setProjectAgentSkillRevision] = useState(0);
  const [runtimeExternalApps, setRuntimeExternalApps] = useState<RuntimeExternalAppState[]>([]);
  const [runtimeExternalRisks, setRuntimeExternalRisks] = useState<RuntimePerceptionRisk[]>([]);
  const submitLightboxQuickComposeRef = useRef<() => Promise<string[]>>(() => Promise.resolve([]));
  useEffect(() => {
    workspaceQuickComposeThreadRef.current = workspaceQuickComposeThread;
  }, [workspaceQuickComposeThread]);

  const activeWorkspaceProjectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
  const getProjectAgentThreadKey = useCallback((): ProjectAgentThreadStoreKey | null => {
    if (workshopDiskOpen) {
      const root = workshopActiveRoot.trim();
      return {
        userId: preferenceScope,
        workspaceProjectId: root ? `workshop:${root}` : 'workshop:folder',
      };
    }
    if (!activeWorkspaceProjectId) return null;
    return { userId: preferenceScope, workspaceProjectId: activeWorkspaceProjectId };
  }, [workshopDiskOpen, workshopActiveRoot, activeWorkspaceProjectId, preferenceScope]);

  const projectAgentMemoryEntries = useMemo(() => {
    const key = getProjectAgentThreadKey();
    if (!key) return [];
    return listProjectAgentKnowledge(key);
  }, [getProjectAgentThreadKey, projectAgentMemoryRevision]);

  const refreshProjectAgentMemoryPanel = useCallback(() => {
    setProjectAgentMemoryRevision((n) => n + 1);
  }, []);

  const handleProjectAgentToggleMemory = useCallback(
    (memoryId: string, enabled: boolean) => {
      const key = getProjectAgentThreadKey();
      if (!key) return;
      if (setProjectAgentKnowledgeEnabled(key, memoryId, enabled)) {
        refreshProjectAgentMemoryPanel();
        onLog?.('info', enabled ? '项目 Agent：已重新启用这条记忆' : '项目 Agent：已暂停这条记忆参与上下文');
      }
    },
    [getProjectAgentThreadKey, onLog, refreshProjectAgentMemoryPanel]
  );

  const handleProjectAgentDeleteMemory = useCallback(
    (memoryId: string) => {
      const key = getProjectAgentThreadKey();
      if (!key) return;
      if (deleteProjectAgentKnowledge(key, memoryId)) {
        refreshProjectAgentMemoryPanel();
        onLog?.('info', '项目 Agent：已删除这条项目记忆');
      }
    },
    [getProjectAgentThreadKey, onLog, refreshProjectAgentMemoryPanel]
  );

  const projectAgentSkillEntries = useMemo(() => {
    const key = getProjectAgentThreadKey();
    if (!key) return [];
    return listAgentSkills(key);
  }, [getProjectAgentThreadKey, projectAgentSkillRevision]);

  const enabledProjectAgentSkills = useMemo(() => {
    const key = getProjectAgentThreadKey();
    if (!key) return [];
    return listEnabledAgentSkills(key);
  }, [getProjectAgentThreadKey, projectAgentSkillRevision]);

  const refreshProjectAgentSkillPanel = useCallback(() => {
    setProjectAgentSkillRevision((n) => n + 1);
  }, []);

  const handleProjectAgentToggleSkill = useCallback(
    (skillId: string, enabled: boolean) => {
      const key = getProjectAgentThreadKey();
      if (!key) return;
      if (setAgentSkillEnabled(key, skillId, enabled)) {
        refreshProjectAgentSkillPanel();
        onLog?.('info', enabled ? '项目 Agent：已启用这个 Skill' : '项目 Agent：已禁用这个 Skill');
      }
    },
    [getProjectAgentThreadKey, onLog, refreshProjectAgentSkillPanel]
  );

  const handleProjectAgentDeleteSkill = useCallback(
    (skillId: string) => {
      const key = getProjectAgentThreadKey();
      if (!key) return;
      if (deleteAgentSkill(key, skillId)) {
        refreshProjectAgentSkillPanel();
        onLog?.('info', '项目 Agent：已删除这个 Skill');
      }
    },
    [getProjectAgentThreadKey, onLog, refreshProjectAgentSkillPanel]
  );

  const handleProjectAgentInstallSampleSkill = useCallback(() => {
    const key = getProjectAgentThreadKey();
    if (!key) {
      onLog?.('warn', '项目 Agent：请先登录并选择项目后再安装 Skill');
      return;
    }
    const result = installAgentSkill(
      key,
      {
        id: 'skill.product-shot-polish',
        name: 'Product Shot Polish',
        description: '把选中的商品图转成高级主图优化计划，并通过现有确认链路执行。',
        triggers: ['高级主图', 'polish product shot', '商品图优化'],
        toolIds: ['run_plain_text'],
        source: 'local',
        permissionLevel: 'none',
      },
      { confirmed: true }
    );
    if ('preview' in result) {
      onLog?.('warn', `项目 Agent：Skill 安装失败：${result.preview.errors.join('；') || '需要确认'}`);
      return;
    }

    refreshProjectAgentSkillPanel();
    onLog?.('info', `项目 Agent：已安装 Skill「${result.skill.name}」`);
  }, [getProjectAgentThreadKey, onLog, refreshProjectAgentSkillPanel]);

  const handleProjectAgentImportSkillPreview = useCallback(() => {
    onLog?.('info', '项目 Agent：外部 Skill 会先做工具白名单、危险指令和权限检查，确认前不会执行');
  }, [onLog]);

  useEffect(() => {
    const key = getProjectAgentThreadKey();
    if (!key) {
      setWorkspaceQuickComposeThread(null);
      return;
    }
    const localRaw = loadOrCreateProjectAgentThread(key);
    const localFinalized = finalizeStaleInFlightProjectAgentThread(localRaw);
    const local = localFinalized.thread;
    if (localFinalized.changed) {
      saveProjectAgentThread(key, local);
    }
    try {
      maybeCompactProjectAgentThread(key, local);
    } catch {
      /* compaction best-effort */
    }
    setWorkspaceQuickComposeThread(local);
    let cancelled = false;
    void (async () => {
      try {
        const hydrated = await hydrateProjectAgentThreadFromCloud(
          { userId: preferenceScope, workspaceProjectId: key.workspaceProjectId },
          local,
          { getFreshLocal: () => workspaceQuickComposeThreadRef.current }
        );
        if (cancelled || !hydrated) return;
        // Avoid clobbering in-flight send / clear-chat that advanced past hydrate (review P0).
        const current = workspaceQuickComposeThreadRef.current;
        if (current) {
          const currentTs = Number(current.updatedAt) || 0;
          const hydratedTs = Number(hydrated.updatedAt) || 0;
          if (currentTs > hydratedTs) return;
          // Clear/new chat: new thread id while hydrate was in flight — keep local.
          if (current.id !== hydrated.id && currentTs >= hydratedTs) return;
        }
        const cloudFinalized = finalizeStaleInFlightProjectAgentThread(hydrated);
        const nextThread = cloudFinalized.thread;
        if (cloudFinalized.changed) {
          saveProjectAgentThread(key, nextThread);
        }
        try {
          maybeCompactProjectAgentThread(key, nextThread);
        } catch {
          /* compaction best-effort */
        }
        setWorkspaceQuickComposeThread(nextThread);
      } catch {
        /* keep local — hydrate must not break open-project */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getProjectAgentThreadKey, preferenceScope]);

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
  /** 执行中任务的 AbortController：侧栏/队列取消时 abort，尽量停掉本机 fetch/重试 */
  const taskAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const [draggingAssetIds, setDraggingAssetIds] = useState<string[] | null>(null);
  const draggingAssetIdsRef = useRef<string[] | null>(null);
  /** 侧栏拖拽态样式：同步置位，避免 rAF 延迟 state 导致拖放中不重绘 */
  const [workflowAssetDragActive, setWorkflowAssetDragActive] = useState(false);
  /** 功能块拖拽 id（仅 ref，不用 state：dragover 首帧时 setState 尚未提交会导致未 preventDefault、drop 失败） */
  const draggingActionIdRef = useRef<string | null>(null);
  const updateDraggingActionId = useCallback((id: string | null) => {
    draggingActionIdRef.current = id;
  }, []);
  const [draggingActionFromFavorite, setDraggingActionFromFavorite] = useState(false);
  const [actionDroppedInFavorite, setActionDroppedInFavorite] = useState(false);
  /** 常用拖放进行中 / 刚结束：禁止 removeActionFromFavorite（防 dragEnd 后幽灵 click 点到 ×） */
  const favoriteDragActiveRef = useRef(false);
  const favoriteRemoveSuppressUntilRef = useRef(0);
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
  const [quickComposeMainDropSlots, setQuickComposeMainDropSlots] = useState<QuickComposeDropSlot[]>([]);
  const [quickComposeReferenceDropSlots, setQuickComposeReferenceDropSlots] = useState<QuickComposeDropSlot[]>([]);
  const quickComposeMainDropSlotsRef = useRef<QuickComposeDropSlot[]>([]);
  const quickComposeReferenceDropSlotsRef = useRef<QuickComposeDropSlot[]>([]);
  const appendQuickComposeDropSlotsForAssetIdsRef = useRef<
    (assetIds: string[], zone: QuickComposeDropZone) => void
  >(() => {});
  useEffect(() => {
    quickComposeMainDropSlotsRef.current = quickComposeMainDropSlots;
  }, [quickComposeMainDropSlots]);
  useEffect(() => {
    quickComposeReferenceDropSlotsRef.current = quickComposeReferenceDropSlots;
  }, [quickComposeReferenceDropSlots]);
  /** 无拖入预设卡片时：文 / 图 / 3D 独立快捷逻辑（不读侧栏「上次预设」） */
  const [quickComposeMode, setQuickComposeMode] = useState<WorkspaceQuickComposeComposeMode>('image');
  /** 快捷栏生成设置（覆盖入队任务的档位/比例/尺寸；张数见 normalizeWorkflowGenerateCount） */
  const [quickComposeImageModel, setQuickComposeImageModel] = useState<string>(DEFAULT_IMAGE_MODEL_REGISTRY_ID);
  const [quickComposeTextModel, setQuickComposeTextModel] = useState<string>(() =>
    coerceTextModelRegistryId((textModelRegistryId || '').trim() || DEFAULT_MODEL_TEXT)
  );
  const { firstReadyRegistryId: quickComposeDefaultVideoModel } = useEffectiveCapabilityModelRows('video');
  const { firstReadyRegistryId: quickComposeDefaultModel3d } = useEffectiveCapabilityModelRows('model3d');
  const [quickComposeVideoModel, setQuickComposeVideoModel] = useState<string>('');
  const [quickComposeVideoDuration, setQuickComposeVideoDuration] = useState('5');
  const [quickComposeVideoAspect, setQuickComposeVideoAspect] = useState('16:9');
  const [quickComposeVideoResolution, setQuickComposeVideoResolution] = useState('1080p');
  const [quickComposeVideoMotion, setQuickComposeVideoMotion] = useState('');
  const [quickComposeModel3dModel, setQuickComposeModel3dModel] = useState<string>('');
  const [quickComposeModel3dQuality, setQuickComposeModel3dQuality] = useState('');
  const [quickComposeModel3dGeometryQuality, setQuickComposeModel3dGeometryQuality] = useState('');
  const [quickComposeModel3dTextureQuality, setQuickComposeModel3dTextureQuality] = useState('');
  const [quickComposeModel3dFormat, setQuickComposeModel3dFormat] = useState('');
  const [quickComposeModel3dTexture, setQuickComposeModel3dTexture] = useState(true);
  const [quickComposeModel3dPbr, setQuickComposeModel3dPbr] = useState(true);
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
    if (quickComposeMode === 'video') return 1;
    if (quickComposeMode === '3d') return 1;
    // image | auto：按生图模型上限（自动挡可能落到图）
    return maxReferenceImagesForImageModel(quickComposeImageModel);
  }, [quickComposeMode, quickComposeImageModel]);
  useEffect(() => {
    if (!quickComposeVideoModel && quickComposeDefaultVideoModel) {
      setQuickComposeVideoModel(quickComposeDefaultVideoModel);
    }
  }, [quickComposeVideoModel, quickComposeDefaultVideoModel]);
  useEffect(() => {
    if (!quickComposeModel3dModel && quickComposeDefaultModel3d) {
      setQuickComposeModel3dModel(quickComposeDefaultModel3d);
    }
  }, [quickComposeModel3dModel, quickComposeDefaultModel3d]);
  const [showAllInGroup, setShowAllInGroup] = useState(false);
  /** 组筛选 ID：用于查看组内资产 */
  const [groupFilterId, setGroupFilterId] = useState<string | null>(null);
  const groupFilterIdRef = useRef(groupFilterId);
  groupFilterIdRef.current = groupFilterId;
  const [workshopCanvasKindFilter, setWorkshopCanvasKindFilter] = useState<WorkshopCanvasKindFilter>('all');
  const [workshopNavHistory, setWorkshopNavHistory] = useState(() =>
    emptyWorkshopNavHistory({ root: WORKSHOP_BROWSER_LIBRARY_ROOT, rel: '', groupId: null }),
  );
  const workshopNavHistoryRef = useRef(workshopNavHistory);
  workshopNavHistoryRef.current = workshopNavHistory;
  const [groupStringLightboxIndex, setGroupStringLightboxIndex] = useState<number | null>(null);
  const [draggingGroupItems, setDraggingGroupItems] = useState<{ groupAssetId: string; itemIndexes: number[] } | null>(null);
  const draggingGroupItemsRef = useRef<{ groupAssetId: string; itemIndexes: number[] } | null>(null);
  const syncDraggingAssetIds = useCallback((ids: string[] | null) => {
    draggingAssetIdsRef.current = ids?.length ? ids : null;
    if (ids?.length) setWorkflowAssetDragActive(true);
    requestAnimationFrame(() => setDraggingAssetIds(ids?.length ? ids : null));
  }, []);
  const syncDraggingGroupItems = useCallback(
    (payload: { groupAssetId: string; itemIndexes: number[] } | null) => {
      draggingGroupItemsRef.current = payload?.itemIndexes?.length ? payload : null;
      if (payload?.itemIndexes?.length) setWorkflowAssetDragActive(true);
      requestAnimationFrame(() => setDraggingGroupItems(payload?.itemIndexes?.length ? payload : null));
    },
    []
  );
  const clearWorkflowDragSession = useCallback(() => {
    draggingAssetIdsRef.current = null;
    draggingGroupItemsRef.current = null;
    setWorkflowAssetDragActive(false);
    setDraggingAssetIds(null);
    setDraggingGroupItems(null);
    clearWorkflowCardDragDropSession();
  }, []);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [workshopRoots, setWorkshopRoots] = useState<WorkshopRootInfo[]>([]);
  const [workshopWorkspaceDir, setWorkshopWorkspaceDir] = useState('');
  const [workshopCurrentRel, setWorkshopCurrentRel] = useState('');
  const [workshopSelectedRel, setWorkshopSelectedRel] = useState<string | null>(null);
  const [workshopCanvasItems, setWorkshopCanvasItems] = useState<WorkshopCanvasItem[]>([]);
  const [workshopOptimisticItems, setWorkshopOptimisticItems] = useState<WorkshopCanvasItem[]>([]);
  const [workshopListEpoch, setWorkshopListEpoch] = useState(0);
  const [workshopThumbById, setWorkshopThumbById] = useState<Record<string, string>>({});
  const [workshopSourceById, setWorkshopSourceById] = useState<Record<string, string>>({});
  const [workshopMediaById, setWorkshopMediaById] = useState<Record<string, WorkshopMediaHit>>({});
  const [workshopTextById, setWorkshopTextById] = useState<Record<string, string>>({});
  const [workshopFaceById, setWorkshopFaceById] = useState<Record<string, string>>({});
  const workshopThumbRequestedRef = useRef<Set<string>>(new Set());
  const workshopMediaRequestedRef = useRef<Set<string>>(new Set());
  const workshopSpecialRasterRequestedRef = useRef<Set<string>>(new Set());
  const workshopThumbByIdRef = useRef(workshopThumbById);
  workshopThumbByIdRef.current = workshopThumbById;
  const workshopThumbPendingRef = useRef<Map<string, string>>(new Map());
  const workshopThumbRafRef = useRef(0);
  const flushWorkshopThumbs = useCallback(() => {
    workshopThumbRafRef.current = 0;
    const batch = workshopThumbPendingRef.current;
    if (!batch.size) return;
    workshopThumbPendingRef.current = new Map();
    setWorkshopThumbById((prev) => {
      const next = { ...prev };
      let changed = false;
      batch.forEach((url, id) => {
        if (next[id] === url) return;
        next[id] = url;
        changed = true;
      });
      return changed ? next : prev;
    });
  }, []);
  const workshopCanvasItemsRef = useRef<WorkshopCanvasItem[]>([]);
  const workshopActiveRootRef = useRef('');
  const workshopCurrentRelRef = useRef('');
  const workshopMergedCanvasItems = useMemo(
    () => mergeWorkshopCanvasItems(workshopCanvasItems, workshopOptimisticItems),
    [workshopCanvasItems, workshopOptimisticItems],
  );
  workshopCanvasItemsRef.current = workshopMergedCanvasItems;
  workshopActiveRootRef.current = workshopActiveRoot;
  workshopCurrentRelRef.current = workshopCurrentRel;
  const workshopFaceFileId = useCallback((cardId: string, key: string) => {
    const parsed = parseWorkshopFileAssetId(cardId);
    const item = workshopCanvasItemsRef.current.find(
      (row) => parsed && row.root === parsed.root && row.rel === parsed.rel,
    );
    const raw = String(key || '').trim() || 'original';
    if (raw !== 'original') return raw;
    const files = item?.files || {};
    const original = Object.entries(files).find(([, rec]) => rec && rec.role === 'original');
    return original?.[0] || item?.checkoutFileId || item?.displayFileId || '';
  }, []);
  const workshopFileAssets = useMemo(
    () =>
      workshopCanvasItemsToWorkflowAssets(workshopMergedCanvasItems, {
        originalById: workshopSourceById,
        faceById: workshopFaceById,
        mediaById: workshopMediaById,
        textBodyById: workshopTextById,
      }),
    [workshopMergedCanvasItems, workshopSourceById, workshopFaceById, workshopMediaById, workshopTextById]
  );
  const lastDispatchedCanvasFingerKeyRef = useRef('');
  const shellRoomRef = useRef('workbench');
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
  const [thumbHotKeys, setThumbHotKeys] = useState<Set<string>>(() => new Set());
  const thumbOnboardingRef = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const groupGridRef = useRef<HTMLDivElement>(null);
  const workspaceViewportRef = useRef<HTMLDivElement>(null);
  const centerScrollRef = useRef<HTMLDivElement>(null);
  const listPaneRef = useRef<HTMLDivElement>(null);
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
      Boolean(draggingAssetIdsRef.current?.length) ||
      Boolean(draggingGroupItemsRef.current?.itemIndexes?.length) ||
      Boolean(draggingActionIdRef.current) ||
      hasPresetDrag;
    if (!isDragging) return;
    const dy = normalizeWheelDeltaY(e);
    if (!Number.isFinite(dy) || Math.abs(dy) < 0.1) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).scrollTop += dy;
  }, []);
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
        Boolean(draggingAssetIdsRef.current?.length) ||
        Boolean(draggingGroupItemsRef.current?.itemIndexes?.length) ||
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
  }, []);

  const handleWorkflowMainAssetListWheel = useCallback(
    (e: React.WheelEvent, origin: 'inner' | 'gutter') => {
      if (isWorkflowEditableTarget(e.target)) return false;
      const t = e.target as Element | null;
      if (t?.closest('[data-prevent-wheel-scroll]')) return false;
      if (t?.closest('[data-ac-dropdown-overlay], [data-ac-dropdown-list]')) return false;
      if (t?.closest('[role="dialog"]')) return false;
      if (
        t?.closest('[data-workflow-sidebar]') ||
        t?.closest('[data-workflow-function-sidebar]') ||
        t?.closest('[data-workflow-preset]')
      ) {
        return false;
      }
      const list = centerScrollRef.current;
      if (!list) return false;
      const dy = normalizeWheelDeltaY(e);
      if (!Number.isFinite(dy) || Math.abs(dy) < 0.1) return false;
      const listCol = list.parentElement;
      const listColRect = listCol?.getBoundingClientRect();
      if (!listColRect) return false;
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
      if (t && list.contains(t)) {
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
  }, []);
  const functionSidebarLayout = useMemo(
    () => resolveWorkflowFunctionSidebarLayout(workspaceViewportWidth),
    [workspaceViewportWidth]
  );
  const functionSidebarWidth = functionSidebarLayout.functionSidebarWidthPx;
  const showFunctionSidebar = functionSidebarLayout.mode !== 'hidden';
  const marqueeStartRef = useRef(false);
  const {
    workspacePane,
    snapWorkspacePaneToNode,
    handlePaneWheel,
    spaceMarqueeEnabled,
  } = useWorkflowWorkspacePanes({
    registerPaneWheelHandler,
    enableSpaceMarquee: quickComposeShellActive && !showArchived,
  });
  useEffect(() => {
    const selected = [...selectedAssetIds][0] || '';
    const parsed = parseWorkshopCardId(selected);
    const item =
      parsed?.kind === 'package'
        ? workshopFileAssets.find((a) => a.id === selected)
        : null;
    const finger = workspaceFingerFromUi({
      selectedAssetIds,
      selectedRoot: workshopDiskOpen ? workshopActiveRoot : null,
      selectedRelPath: workshopSelectedRel,
      selectedFileId: parsed?.kind === 'package' ? String(item?.displayKey || '') : null,
      assets: workshopDiskOpen ? workshopFileAssets : assets,
      lightboxAssetId,
      surface: Math.round(workspacePane) === 1 ? 'presets' : 'canvas',
      connectedHosts: connectedHostsFromDrafts(readPublishedConnectionDrafts(), {
        hasSelectedCard: selectedAssetIds.size > 0 || Boolean(workshopSelectedRel),
      }),
    });
    publishAgentWorkbenchFinger(finger);
    if (shellRoomRef.current !== 'workbench') return;
    const key = canvasFingerKey(finger);
    if (key === lastDispatchedCanvasFingerKeyRef.current) return;
    lastDispatchedCanvasFingerKeyRef.current = key;
    dispatchWorkspaceSetFinger(finger);
  }, [selectedAssetIds, workshopSelectedRel, workshopActiveRoot, workshopDiskOpen, workshopFileAssets, assets, lightboxAssetId, workspacePane]);
  useEffect(() => {
    const api = window.assetCutterWorkbench;
    if (!api || typeof api.onWorkspaceShellView !== 'function') return undefined;
    return api.onWorkspaceShellView((view) => {
      const next = String(view || 'workbench');
      shellRoomRef.current = next;
      if (next !== 'workbench') return;
      lastDispatchedCanvasFingerKeyRef.current = '';
      const selected = [...selectedAssetIds][0] || '';
      const parsed = parseWorkshopCardId(selected);
      const item =
        parsed?.kind === 'package'
          ? workshopFileAssets.find((a) => a.id === selected)
          : null;
      const finger = workspaceFingerFromUi({
        selectedAssetIds,
        selectedRoot: workshopDiskOpen ? workshopActiveRoot : null,
        selectedRelPath: workshopSelectedRel,
        selectedFileId: parsed?.kind === 'package' ? String(item?.displayKey || '') : null,
        assets: workshopDiskOpen ? workshopFileAssets : assets,
        lightboxAssetId,
        surface: Math.round(workspacePane) === 1 ? 'presets' : 'canvas',
        connectedHosts: connectedHostsFromDrafts(readPublishedConnectionDrafts(), {
          hasSelectedCard: selectedAssetIds.size > 0 || Boolean(workshopSelectedRel),
        }),
      });
      publishAgentWorkbenchFinger(finger);
      dispatchWorkspaceSetFinger(finger);
    });
  }, [selectedAssetIds, workshopSelectedRel, workshopActiveRoot, workshopDiskOpen, workshopFileAssets, assets, lightboxAssetId, workspacePane]);
  useEffect(() => {
    const on = hasWorkbenchFileSourceApi();
    setFileSourceApi(on);
    if (!on) return;
    const api = workshopFileSourceApi();
    if (!api?.getWorkshopFileState) return;
    void api.getWorkshopFileState().then((st) => {
      if (!st?.ok) return;
      const next = applyWorkshopFileState(st);
      setWorkshopRoots(next.roots);
      setWorkshopActiveRoot((cur) => {
        if (isWorkshopBrowserLibraryRoot(cur) || !cur) return WORKSHOP_BROWSER_LIBRARY_ROOT;
        if (isWorkshopRecycleRoot(cur) && String(st.workspaceDir || '').trim()) return cur;
        if (next.roots.some((r) => r.root === cur)) return cur;
        return WORKSHOP_BROWSER_LIBRARY_ROOT;
      });
      setWorkshopWorkspaceDir(String(st.workspaceDir || '').trim());
      const apiOpen = workshopFileSourceApi();
      if (apiOpen?.setWorkshopLibraryOpen) {
        void apiOpen.setWorkshopLibraryOpen({ root: '', rel: '' });
      }
    });
  }, []);
  const pickWorkshopWorkspace = useCallback(async () => {
    const api = workshopFileSourceApi();
    if (!api?.pickWorkshopWorkspace) return;
    const st = await api.pickWorkshopWorkspace();
    if (!st?.ok || st.canceled) {
      if (st && !st.canceled && st.error === 'workspace_inside_library') {
        onLog?.('warn', '库目录不能建在已挂上的素材文件夹里面');
      }
      return;
    }
    setWorkshopWorkspaceDir(String(st.workspaceDir || '').trim());
    const next = applyWorkshopFileState(st);
    setWorkshopRoots(next.roots);
    setWorkshopActiveRoot((cur) => {
      if (isWorkshopBrowserLibraryRoot(cur) || isWorkshopRecycleRoot(cur) || next.roots.some((r) => r.root === cur)) return cur;
      return WORKSHOP_BROWSER_LIBRARY_ROOT;
    });
    setWorkshopCurrentRel('');
  }, [onLog]);
  const pickWorkshopRoot = useCallback(async () => {
    const api = workshopFileSourceApi();
    if (!api?.pickWorkshopRoot) return;
    if (!String(workshopWorkspaceDir || '').trim()) {
      if (!api.pickWorkshopWorkspace) {
        onLog?.('warn', '请先指定库目录再挂素材文件夹');
        return;
      }
      const picked = await api.pickWorkshopWorkspace();
      if (!picked?.ok || picked.canceled) {
        if (picked && !picked.canceled && picked.error === 'workspace_inside_library') {
          onLog?.('warn', '库目录不能建在已挂上的素材文件夹里面');
        } else {
          onLog?.('warn', '请先指定库目录再挂素材文件夹');
        }
        return;
      }
      setWorkshopWorkspaceDir(String(picked.workspaceDir || '').trim());
      const migrated = applyWorkshopFileState(picked);
      setWorkshopRoots(migrated.roots);
    }
    const st = await api.pickWorkshopRoot();
    if (st && !st.canceled && st.error === 'no_workspace') {
      onLog?.('warn', '请先指定库目录再挂素材文件夹');
      return;
    }
    if (!st?.ok || st.canceled) return;
    const next = applyWorkshopFileState(st);
    setWorkshopRoots(next.roots);
    const added = String(st.root || '').trim();
    setWorkshopActiveRoot(added || next.activeRoot);
    setWorkshopCurrentRel('');
    setWorkshopSelectedRel(null);
    setSelectedAssetIds(new Set());
  }, [onLog, workshopWorkspaceDir]);
  const removeWorkshopRoot = useCallback(async (root: string) => {
    const api = workshopFileSourceApi();
    if (!api?.removeWorkshopRoot) return;
    const st = await api.removeWorkshopRoot({ root });
    if (!st?.ok) return;
    const next = applyWorkshopFileState(st);
    setWorkshopRoots(next.roots);
    setWorkshopActiveRoot((cur) => (cur === root ? WORKSHOP_BROWSER_LIBRARY_ROOT : cur));
    setWorkshopCurrentRel('');
    setWorkshopSelectedRel(null);
    setSelectedAssetIds(new Set());
  }, []);
  const findLiveAsset = useCallback(
    (id: string | null | undefined): WorkflowAsset | null => {
      const t = String(id || '').trim();
      if (!t) return null;
      const found = workshopFileAssets.find((a) => a.id === t) || assets.find((a) => a.id === t) || null;
      return found;
    },
    [workshopFileAssets, assets]
  );
  useEffect(() => {
    if (!fileSourceApi || isWorkshopBrowserLibraryRoot(workshopActiveRoot) || !workshopActiveRoot) {
      setWorkshopCanvasItems([]);
      return;
    }
    const api = workshopFileSourceApi();
    if (!api?.listWorkshopDir) return;
    let cancelled = false;
    workshopThumbRequestedRef.current = new Set();
    workshopSpecialRasterRequestedRef.current = new Set();
    void api
      .listWorkshopDir({
        root: workshopActiveRoot,
        rel: workshopCurrentRel,
        assetsOnly: true,
        includeSubfolders: false,
      })
      .then((out) => {
        if (cancelled) return;
        const items = out.ok && Array.isArray(out.items) ? out.items : [];
        setWorkshopCanvasItems(items);
        setWorkshopOptimisticItems((prev) =>
          prev.filter((row) => {
            if (row.kind === 'package' && row.assetId) {
              return !items.some(
                (disk) =>
                  disk.kind === 'package' &&
                  disk.assetId === row.assetId &&
                  disk.root === row.root,
              );
            }
            if ((row.kind === 'loose' || row.kind === 'folder') && row.rel) {
              return !items.some(
                (disk) => disk.kind === row.kind && disk.rel === row.rel && disk.root === row.root,
              );
            }
            return true;
          }),
        );
        const liveCardIds = new Set<string>();
        for (const item of items) {
          if (item.kind === 'package' && item.assetId) {
            liveCardIds.add(workshopPackageCardId(item.root, item.assetId));
          } else if (item.kind === 'loose' || item.kind === 'folder') {
            liveCardIds.add(workshopFileAssetId(item.root, item.rel));
          }
        }
        setWorkshopThumbById((prev) => {
          const next: Record<string, string> = {};
          for (const [key, val] of Object.entries(prev)) {
            const baseId = key.split('::')[0] || key;
            if (liveCardIds.has(baseId) || liveCardIds.has(key)) next[key] = val;
          }
          return next;
        });
        setWorkshopSourceById((prev) => {
          const next: Record<string, string> = {};
          for (const [key, val] of Object.entries(prev)) {
            const baseId = key.split('::')[0] || key;
            if (liveCardIds.has(baseId) || liveCardIds.has(key)) next[key] = val;
          }
          return next;
        });
        setWorkshopMediaById((prev) => {
          const next: Record<string, WorkshopMediaHit> = {};
          for (const [key, val] of Object.entries(prev)) {
            if (liveCardIds.has(key)) next[key] = val;
          }
          return next;
        });
        setWorkshopTextById((prev) => {
          const next: Record<string, string> = {};
          for (const [key, val] of Object.entries(prev)) {
            if (liveCardIds.has(key)) next[key] = val;
          }
          return next;
        });
        workshopMediaRequestedRef.current = new Set(
          [...workshopMediaRequestedRef.current].filter((id) => liveCardIds.has(id)),
        );
        workshopSpecialRasterRequestedRef.current = new Set(
          [...workshopSpecialRasterRequestedRef.current].filter((key) => {
            const id = key.split('::')[0] || key;
            return liveCardIds.has(id);
          }),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [fileSourceApi, workshopActiveRoot, workshopCurrentRel, workshopListEpoch]);
  useEffect(() => {
    if (!fileSourceApi || isWorkshopBrowserLibraryRoot(workshopActiveRoot)) {
      setWorkshopSelectedRel(null);
      return;
    }
    const selected = [...selectedAssetIds][0] || '';
    const parsed = parseWorkshopCardId(selected);
    if (parsed?.kind === 'package') {
      const item = workshopMergedCanvasItems.find(
        (row) => row.kind === 'package' && row.assetId === parsed.assetId && row.root === parsed.root,
      );
      setWorkshopSelectedRel(item?.displayRel || item?.rel || null);
      return;
    }
    setWorkshopSelectedRel(selectedRelFromAssetIds(selectedAssetIds, workshopActiveRoot, workshopMergedCanvasItems));
  }, [fileSourceApi, selectedAssetIds, workshopActiveRoot, workshopMergedCanvasItems]);
  useEffect(() => {
    if (!fileSourceApi) return;
    const api = workshopFileSourceApi();
    if (!api?.readWorkshopFile) return;
    let cancelled = false;
    const want = new Set<string>();
    if (lightboxAssetId) want.add(lightboxAssetId);
    for (const id of selectedAssetIds) want.add(id);
    for (const slot of quickComposeMainDropSlotsRef.current) {
      if (slot.assetId) want.add(slot.assetId);
    }
    for (const slot of quickComposeReferenceDropSlotsRef.current) {
      if (slot.assetId) want.add(slot.assetId);
    }
    for (const id of want) {
      const asset = workshopFileAssets.find((row) => row.id === id);
      const kind = String(asset?.assetKind || '');
      if (kind === 'video' || kind === 'model3d') continue;
      if (isWorkshopSpecialRasterName(String(asset?.textTitle || ''))) continue;
      const textFile = kind === 'text' || isWorkshopTextPreviewName(String(asset?.textTitle || ''));
      if (textFile) {
        if (id !== lightboxAssetId && !selectedAssetIds.has(id)) continue;
        if (workshopTextById[id]) continue;
      } else if (workshopSourceById[id]) {
        continue;
      }
      const parsed = parseWorkshopCardId(id);
      if (!parsed) continue;
      const faceKey = workshopFaceById[id] || asset?.displayKey || 'original';
      const payload = workshopHostFilePayload(parsed, {
        items: workshopMergedCanvasItems,
        fileId: workshopFaceFileId(id, faceKey),
      });
      void api.readWorkshopFile(payload).then((out) => {
        if (cancelled || !out?.ok || !out.dataUrl) return;
        if (textFile) {
          const body = utf8FromDataUrl(out.dataUrl as string);
          if (body) setWorkshopTextById((prev) => (prev[id] ? prev : { ...prev, [id]: body }));
          return;
        }
        if (kind && kind !== 'image') return;
        setWorkshopSourceById((prev) => (prev[id] ? prev : { ...prev, [id]: out.dataUrl as string }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [fileSourceApi, lightboxAssetId, selectedAssetIds, workshopMergedCanvasItems, workshopSourceById, workshopTextById, workshopFaceById, workshopFaceFileId, workshopFileAssets]);
  useEffect(() => {
    if (!workshopDiskOpen || !workshopActiveRoot) return;
    const api = workshopFileSourceApi();
    if (!api?.getWorkshopMedia) return;
    let cancelled = false;
    const want: Array<{ id: string; displayKey: string }> = [];
    const seen = new Set<string>();
    const pushMedia = (id: string, displayKey = 'original') => {
      const key = String(id || '').trim();
      if (!key || seen.has(key)) return;
      if (workshopMediaRequestedRef.current.has(key)) return;
      if (!parseWorkshopCardId(key)) return;
      seen.add(key);
      want.push({ id: key, displayKey });
    };
    for (const a of workshopFileAssets) {
      const unlocked =
        thumbUnlockKeys.has(a.id) ||
        selectedAssetIds.has(a.id) ||
        a.id === lightboxAssetId;
      if (!unlocked) continue;
      const specialRaster = a.assetKind === 'image' && isWorkshopSpecialRasterName(a.textTitle || '');
      const textFile = a.assetKind === 'text' || isWorkshopTextPreviewName(a.textTitle || '');
      if (a.assetKind === 'video' || a.assetKind === 'model3d' || textFile || specialRaster) {
        if (textFile && workshopTextById[a.id]) continue;
        if ((a.assetKind === 'video' || a.assetKind === 'model3d' || specialRaster) && workshopMediaById[a.id]?.url) continue;
        pushMedia(a.id, a.displayKey || 'original');
      }
    }
    let cursor = 0;
    const workerCount = Math.min(WORKSHOP_THUMB_IPC_PARALLEL, want.length);
    const runOne = async (row: (typeof want)[number]) => {
      workshopMediaRequestedRef.current.add(row.id);
      const parsed = parseWorkshopCardId(row.id);
      if (!parsed) return;
      const payload = workshopHostFilePayload(parsed, {
        items: workshopMergedCanvasItems,
        fileId: workshopFaceFileId(row.id, row.displayKey),
      });
      try {
        const out = await api.getWorkshopMedia(payload);
        if (!out?.ok) {
          workshopMediaRequestedRef.current.delete(row.id);
          return;
        }
        if (cancelled) return;
        const asset = workshopFileAssets.find((item) => item.id === row.id);
        const textFile =
          String(out.kind || '') === 'text' ||
          asset?.assetKind === 'text' ||
          isWorkshopTextPreviewName(String(asset?.textTitle || ''));
        let body = String(out.textPreview || '');
        if (textFile && !body.trim() && out.url && isWorkshopPlayableMediaUrl(String(out.url))) {
          try {
            const res = await fetch(String(out.url));
            if (res.ok) body = await res.text();
          } catch {
            body = '';
          }
        }
        if (textFile && body) {
          setWorkshopTextById((prev) => (prev[row.id] ? prev : { ...prev, [row.id]: body }));
        }
        if (out.url) {
          setWorkshopMediaById((prev) =>
            prev[row.id]?.url
              ? prev
              : { ...prev, [row.id]: { url: String(out.url), kind: String(out.kind || ''), textPreview: body || out.textPreview } },
          );
        }
      } catch {
        workshopMediaRequestedRef.current.delete(row.id);
      }
    };
    const pump = async () => {
      while (cursor < want.length && !cancelled) {
        const item = want[cursor];
        cursor += 1;
        if (item) await runOne(item);
      }
    };
    void Promise.all(Array.from({ length: workerCount }, () => pump()));
    return () => {
      cancelled = true;
    };
  }, [
    workshopDiskOpen,
    workshopActiveRoot,
    workshopFileAssets,
    workshopMergedCanvasItems,
    thumbUnlockKeys,
    selectedAssetIds,
    lightboxAssetId,
    workshopMediaById,
    workshopTextById,
    workshopFaceFileId,
  ]);
  useEffect(() => {
    if (!workshopDiskOpen || !workshopActiveRoot) return;
    let cancelled = false;
    const jobs: Array<{ id: string; url: string; fileName: string; lightbox: boolean }> = [];
    for (const a of workshopFileAssets) {
      if (a.assetKind !== 'image' || !isWorkshopSpecialRasterName(a.textTitle || '')) continue;
      const unlocked =
        thumbUnlockKeys.has(a.id) ||
        selectedAssetIds.has(a.id) ||
        a.id === lightboxAssetId;
      if (!unlocked) continue;
      const url = String(workshopMediaById[a.id]?.url || '').trim();
      if (!url) continue;
      const needThumb = !workshopThumbById[a.id];
      const needSource = a.id === lightboxAssetId && !workshopSourceById[a.id];
      if (!needThumb && !needSource) continue;
      const reqKey = needSource ? `${a.id}::lb` : `${a.id}::card`;
      if (workshopSpecialRasterRequestedRef.current.has(reqKey)) continue;
      jobs.push({ id: a.id, url, fileName: a.textTitle || '', lightbox: needSource });
    }
    for (const job of jobs) {
      const reqKey = job.lightbox ? `${job.id}::lb` : `${job.id}::card`;
      workshopSpecialRasterRequestedRef.current.add(reqKey);
      void decodeWorkshopSpecialRasterToJpeg({
        url: job.url,
        fileName: job.fileName,
        lightbox: job.lightbox,
      }).then((jpeg) => {
        if (cancelled || !jpeg) {
          if (cancelled) workshopSpecialRasterRequestedRef.current.delete(reqKey);
          return;
        }
        if (job.lightbox) {
          setWorkshopSourceById((prev) => (prev[job.id] ? prev : { ...prev, [job.id]: jpeg }));
        }
        setWorkshopThumbById((prev) => (prev[job.id] ? prev : { ...prev, [job.id]: jpeg }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [
    workshopDiskOpen,
    workshopActiveRoot,
    workshopFileAssets,
    workshopMediaById,
    workshopThumbById,
    workshopSourceById,
    thumbUnlockKeys,
    selectedAssetIds,
    lightboxAssetId,
  ]);
  const assetListMarqueeActive =
    quickComposeShellActive && !showArchived && Math.round(workspacePane) === 0;
  /** 供 document wheel capture 读取：按住空格时不拦截滚轮，以便滚动资产列表 */
  const spaceMarqueeEnabledRef = useRef(false);
  useLayoutEffect(() => {
    spaceMarqueeEnabledRef.current = spaceMarqueeEnabled;
  }, [spaceMarqueeEnabled]);
  /** 暗区滚轮：平滑转发到资产列表；列表区内走原生滚动（见 WorkflowSpaceMarqueeChrome） */
  const spaceMarqueeWheelScrollRef = useRef<SmoothWheelScrollController | null>(null);
  if (!spaceMarqueeWheelScrollRef.current) {
    spaceMarqueeWheelScrollRef.current = createSmoothWheelScrollController(() => centerScrollRef.current);
  }
  useEffect(() => {
    if (!spaceMarqueeEnabled) {
      spaceMarqueeWheelScrollRef.current?.cancel();
    }
  }, [spaceMarqueeEnabled]);
  const applyWheelToAssetListWhileSpaceMarquee = useCallback((e: React.WheelEvent) => {
    if (!spaceMarqueeEnabled) return;
    const dy = normalizeWheelDeltaY(e);
    if (!Number.isFinite(dy) || Math.abs(dy) < 0.1) return;
    e.preventDefault();
    e.stopPropagation();
    spaceMarqueeWheelScrollRef.current?.pushDelta(dy);
  }, [spaceMarqueeEnabled]);
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
    snapWorkspacePaneToNode(1);
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
      snapWorkspacePaneToNode(1);
    },
    [snapWorkspacePaneToNode]
  );
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const layoutMarqueeHitIdsRef = useRef<WorkflowJustifiedMarqueeHitFn | null>(null);
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
    marqueeOverlayElRef,
    beginSpaceMarqueePointerDrag,
  } = useWorkflowMarquee({
    registerMarqueeStartHandler,
    showArchived,
    workspacePane,
    spaceMarqueeEnabled,
    marqueeStartRef,
    cardRefs,
    pendingRef,
    groupFilterIdRef,
    setSelectedAssetIds,
    setSelectedGroupItemKeys,
    layoutHitIdsRef: layoutMarqueeHitIdsRef,
  });

  const addWorkflowStoryboardTableAsset = useCallback(
    (title?: string): string => {
      const id = uuid();
      const newAsset = attachInitialVgpToNewAsset(createEmptyStoryboardTableAsset(id, title));
      setAssets((prev) => [...prev, newAsset]);
      onLog?.('info', '已新建分镜表');
      return id;
    },
    [onLog, setAssets]
  );

  const addWorkflowAssetSetAsset = useCallback(
    (title?: string): string => {
      const id = uuid();
      const newAsset = attachInitialVgpToNewAsset(createAssetSetAsset(id, { title }));
      setAssets((prev) => [...prev, newAsset]);
      onLog?.('info', '已新建资产集');
      return id;
    },
    [onLog, setAssets]
  );

  const openStoryboardTablePanel = useCallback((assetId: string) => {
    setStoryboardPanelAssetId(assetId);
    setAssetSetPanelAssetId(null);
    lightboxModelThumbCloseGenRef.current += 1;
    unmountLightboxLoadingCover();
    setLightboxOverlayClosingHidden(false);
    setLightboxOverlayMounted(false);
    setLightboxAssetId(null);
    setLightboxListBackdropUrl(null);
    setLightboxPlaceholderImageSrc(null);
    resetLightboxBoot();
    setLightboxSourceSlot(null);
  }, [resetLightboxBoot]);

  const openAssetSetPanel = useCallback((assetId: string) => {
    setAssetSetPanelAssetId(assetId);
    setStoryboardPanelAssetId(null);
    lightboxModelThumbCloseGenRef.current += 1;
    unmountLightboxLoadingCover();
    setLightboxOverlayClosingHidden(false);
    setLightboxOverlayMounted(false);
    setLightboxAssetId(null);
    setLightboxListBackdropUrl(null);
    setLightboxPlaceholderImageSrc(null);
    resetLightboxBoot();
    setLightboxSourceSlot(null);
  }, [resetLightboxBoot]);

  const closeAssetSetPanel = useCallback(() => {
    setAssetSetPanelAssetId(null);
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

  const openWorkflowLightbox = useCallback(
    (
      assetId: string,
      sourceSlot?: { sourceGroupAssetId: string; sourceItemIndex: number } | null
    ) => {
      const openGen = ++lightboxOpenGenRef.current;
      mountLightboxLoadingCover(() => {
        if (lightboxOpenGenRef.current !== openGen) return;
        lightboxOpenGenRef.current += 1;
        unmountLightboxLoadingCover();
      });

      lightboxModel3dViewDirtyRef.current = false;
      lightboxModelThumbCloseGenRef.current += 1;

      window.requestAnimationFrame(() => {
        if (lightboxOpenGenRef.current !== openGen) return;
        setLightboxPlaceholderImageSrc(null);
        setLightboxListBackdropUrl(null);
        setLightboxOverlayClosingHidden(false);
        setLightboxSourceSlot(sourceSlot ?? null);
        setLightboxAssetId(assetId);
        setLightboxOverlayMounted(true);
        beginLightboxBoot();
        if (fileSourceApi && parseWorkshopCardId(assetId)) {
          setThumbUnlockKeys((prev) => {
            if (prev.has(assetId)) return prev;
            const next = new Set(prev);
            next.add(assetId);
            return next;
          });
        }
      });
    },
    [beginLightboxBoot, fileSourceApi]
  );

  const handleAssetSetAssetPatch = useCallback(
    (
      assetId: string,
      patch: Partial<WorkflowAsset> | ((prev: WorkflowAsset) => WorkflowAsset)
    ) => {
      const id = String(assetId || '').trim();
      if (!id) return;
      setAssets((prev) => {
        const cur = prev.find((x) => x.id === id);
        if (!cur || !isWorkflowAssetSetAsset(cur)) return prev;
        const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
        return prev.map((x) => (x.id === id ? normalizeAssetSetOnAsset(next) : x));
      });
    },
    [setAssets]
  );


  const storyboardRedrawPresets = useMemo(
    () => listStoryboardRedrawPresets(capabilityPresets),
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
      if (!preset || preset.enabled === false) {
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
          storyboardAssetId: tableAssetId,
        },
        companionBaseUrl: String(getCompanionLocalBaseUrl() || ''),
        companionProjectId: String(workspaceProjectChrome?.activeProjectId || ''),
      });
      if (result.ok === false) {
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
  const resolveAssetObjectKeyDisplayImage = useCallback((a: WorkflowAsset): string => {
    const dk = String(a.displayKey || 'original').trim() || 'original';
    if (dk !== 'original') {
      const resultObjectKey = String(a.resultsObjectKeys?.[dk] || '').trim();
      if (resultObjectKey) {
        return resolveStoryboardFrameDisplaySrc('', resultObjectKey) || '';
      }
    }
    const originalObjectKey = String(a.originalObjectKey || '').trim();
    return originalObjectKey ? resolveStoryboardFrameDisplaySrc('', originalObjectKey) || '' : '';
  }, []);
  const resolveAssetCompanionKeyDisplayImage = useCallback((a: WorkflowAsset): string => {
    const projectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
    if (!projectId) return '';
    const base = normalizeCompanionBaseUrl(String(getCompanionLocalBaseUrl() || '').trim());
    if (!base) return '';
    const toUrl = (key: string) =>
      key
        ? `${base}/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(key)}`
        : '';
    const dk = String(a.displayKey || 'original').trim() || 'original';
    // Model viewport / grid poster (image-thumb-*) must win over image-full / originalCompanionKey
    const modelPoster = resolveWorkflowModelStepPosterSrc(a, dk, toUrl);
    if (modelPoster) return modelPoster;
    if (dk !== 'original') {
      const stepKey = String(a.resultsCompanionKeys?.[dk] || '').trim();
      if (stepKey) return toUrl(stepKey);
      // 当前步 companion 已丢时回退原图键，避免暗空卡假「丢资产」
      const origKey = String(a.originalCompanionKey || '').trim();
      if (origKey) return toUrl(origKey);
      for (const stepId of a.resultOrder || Object.keys(a.resultsCompanionKeys || {})) {
        const alt = String(a.resultsCompanionKeys?.[stepId] || '').trim();
        if (alt) return toUrl(alt);
      }
      return '';
    }
    return toUrl(String(a.originalCompanionKey || '').trim());
  }, [workspaceProjectChrome?.activeProjectId]);
  const getWorkflowAssetActiveCompanionKey = useCallback((a: WorkflowAsset): string => {
    const dk = String(a.displayKey || 'original').trim() || 'original';
    const modelKey = resolveWorkflowStepModelCompanionKeys(a, dk).find((key) => String(key || '').trim());
    if (modelKey) return String(modelKey).trim();
    const previewKey = String(a.resultsPreviewCompanionKeys?.[dk] || '').trim();
    if (previewKey) return previewKey;
    if (dk !== 'original') {
      return (
        String(a.resultsCompanionKeys?.[dk] || '').trim() ||
        String(a.originalCompanionKey || '').trim()
      );
    }
    return String(a.originalCompanionKey || '').trim();
  }, []);
  const getAssetDisplayImage = useCallback((
    a: WorkflowAsset,
    _assetsList?: WorkflowAsset[],
    _visited?: Set<string>
  ): string => {
    if (fileSourceApi) {
      const parsed = parseWorkshopCardId(a.id);
      if (parsed) {
        if (a.assetKind === 'text' || isWorkshopTextPreviewName(a.textTitle || '')) return '';
        const full = workshopSourceById[a.id];
        if (full) return full;
        return '';
      }
    }
    if (isWorkflowStoryboardTableAsset(a)) {
      return storyboardTableCoverImage(a);
    }
    const healed = healWorkflowAssetDisplayKeyIfEmpty(a);
    const dk = String(healed.displayKey || 'original').trim() || 'original';
    const modelPoster = resolveWorkflowModelStepPosterSrc(healed, dk, null);
    if (modelPoster) return modelPoster;
    // Model cards: companion image-thumb must win over hydrated image-full in asset.original
    if (workflowAssetHasModelAtStep(healed, dk)) {
      const fromCompanion = resolveAssetCompanionKeyDisplayImage(healed);
      if (fromCompanion) return fromCompanion;
    }
    const orig = asWorkflowImageString(healed.original);
    if (isWorkflowTextAsset(healed)) {
      const slot = resolveWorkflowDisplaySlot(healed);
      if (slot.modality === 'image' || slot.modality === 'video') {
        return (
          asWorkflowImageString(slot.imageSrc) ||
          resolveAssetObjectKeyDisplayImage(healed) ||
          resolveAssetCompanionKeyDisplayImage(healed) ||
          ''
        );
      }
      return '';
    }
    const slot = resolveWorkflowDisplaySlot(healed);
    if (slot.modality === 'image' || slot.modality === 'video') {
      const fromSlot =
        asWorkflowImageString(slot.imageSrc) ||
        resolveAssetObjectKeyDisplayImage(healed) ||
        resolveAssetCompanionKeyDisplayImage(healed);
      if (fromSlot) return fromSlot;
    }
    return (
      orig ||
      resolveAssetObjectKeyDisplayImage({ ...healed, displayKey: 'original' }) ||
      resolveAssetCompanionKeyDisplayImage({ ...healed, displayKey: 'original' }) ||
      ''
    );
  }, [fileSourceApi, workshopSourceById, resolveAssetCompanionKeyDisplayImage, resolveAssetObjectKeyDisplayImage]);

  const getAssetGridDisplayImage = useCallback((a: WorkflowAsset): string => {
    if (fileSourceApi && parseWorkshopCardId(a.id)) {
      return workshopThumbById[a.id] || '';
    }
    const display = getAssetDisplayImage(a);
    const projectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
    const base = normalizeCompanionBaseUrl(String(getCompanionLocalBaseUrl() || '').trim());
    const previewKey = resolveWorkflowAssetGridPreviewCompanionKey(a);
    const previewUrl =
      previewKey && projectId && base
        ? `${base}/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(previewKey)}`
        : '';
    return pickWorkflowGridCardPreviewSrc({
      displaySrc: display,
      previewCompanionUrl: previewUrl,
    });
  }, [fileSourceApi, workshopThumbById, getAssetDisplayImage, workspaceProjectChrome?.activeProjectId]);

  /** 送模/拖入预设：作坊卡优先原文件，未加载时用缩略图兜底 */
  const getAssetComposeInputImage = useCallback((a: WorkflowAsset): string => {
    if (fileSourceApi && parseWorkshopCardId(a.id)) {
      const full = getAssetDisplayImage(a).trim();
      if (full) return full;
      return getAssetGridDisplayImage(a).trim();
    }
    return getAssetDisplayImage(a).trim();
  }, [fileSourceApi, getAssetDisplayImage, getAssetGridDisplayImage]);

  const getComposeAssets = useCallback((): WorkflowAsset[] => {
    return workshopDiskOpen ? workshopFileAssets : assetsRef.current;
  }, [workshopDiskOpen, workshopFileAssets]);

  const assetAllowedForCapabilityDrop = useCallback(
    (asset: WorkflowAsset, mod: CustomAppModule): boolean => {
      if (fileSourceApi && parseWorkshopCardId(asset.id)) {
        if (asset.assetKind === 'image') {
          if (mod.category === 'text_to_text' || mod.category === 'text_to_image') return false;
          return (
            mod.category === 'image_process' ||
            mod.category === 'image_to_image' ||
            mod.category === 'image_to_text' ||
            mod.category === 'generate_3d' ||
            mod.category === 'generate_video' ||
            presetUsesHostBundleProcessor(mod)
          );
        }
        if (asset.assetKind === 'text') {
          return mod.category === 'text_to_text' || mod.category === 'text_to_image';
        }
      }
      return workflowAssetAllowedForCapabilityDrop(asset, mod);
    },
    [fileSourceApi]
  );

  const scheduleWorkflowLightboxPrefetch = useCallback((asset: WorkflowAsset) => {
    if (isWorkflowStoryboardTableAsset(asset) || isWorkflowAssetSetAsset(asset)) return;
    const src = getAssetDisplayImage(asset).trim();
    if (!src) return;
    if (lightboxPrefetchTimerRef.current != null) {
      window.clearTimeout(lightboxPrefetchTimerRef.current);
    }
    lightboxPrefetchTimerRef.current = window.setTimeout(() => {
      lightboxPrefetchTimerRef.current = null;
      prefetchWorkflowLightboxImage(src);
      const orig = asWorkflowImageString(asset.original).trim();
      if (orig && orig !== src) prefetchWorkflowLightboxImage(orig);
    }, 200);
  }, [getAssetDisplayImage]);

  const assetLightboxRasterEligible = useCallback(
    (a: WorkflowAsset | null | undefined): boolean => {
      if (!a || isGroupAsset(a) || isWorkflowStoryboardTableAsset(a)) return false;
      if (fileSourceApi && parseWorkshopCardId(a.id) && a.assetKind === 'image') return true;
      return workflowAssetLightboxRasterEligible(a, getAssetDisplayImage(a));
    },
    [fileSourceApi, getAssetDisplayImage]
  );

  const handleQuickComposeResultPreview = useCallback(
    (assetId: string, _event: React.MouseEvent<HTMLElement>) => {
      const id = String(assetId || '').trim();
      if (!id) return;
      const asset = assetsRef.current.find((a) => a.id === id);
      if (!asset) {
        onLog?.('warn', '项目 Agent：未找到这张结果资产');
        return;
      }
      if (!assetLightboxRasterEligible(asset)) {
        onLog?.('warn', '项目 Agent：这张结果暂不支持大图预览');
        return;
      }
      openWorkflowLightbox(id);
    },
    [assetLightboxRasterEligible, onLog, openWorkflowLightbox]
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

  const companionStoryboardGeneratedImageHistoryHydrateKey = useMemo(
    () => buildStoryboardGeneratedImageHistoryCompanionHydrateKey(assets),
    [assets]
  );

  const companionStoryboardNamedAssetHydrateKey = useMemo(
    () => buildStoryboardNamedAssetCompanionHydrateKey(assets),
    [assets]
  );

  const companionAssetSetHydrateKey = useMemo(
    () => buildAssetSetCompanionHydrateKey(assets),
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

  const companionHydrateSessionKey = useMemo(
    () =>
      buildCompanionHydrateSessionKey(
        String(workspaceProjectChrome?.activeProjectId || '').trim(),
        assets
      ),
    [workspaceProjectChrome?.activeProjectId, assets]
  );

  useEffect(() => {
    const projectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
    const base = String(getCompanionLocalBaseUrl() || '').trim();
    if (!companionHydrateSessionKey || !projectId || !base) return;
    let cancelled = false;
    void runWorkflowCompanionEagerRasterHydrate({
      projectId,
      companionBaseUrl: base,
      getAssets: () => assetsRef.current,
      isCancelled: () => cancelled,
      onPatch: (patches) => {
        if (cancelled || !patches.length) return;
        setAssets((prev) => applyCompanionHydratePatches(prev, patches));
      },
      onFailure: (task, error) => {
        if (cancelled) return;
        const label =
          task.kind === 'original'
            ? `${task.assetId}: ${error}`
            : `${task.assetId}/${task.stepId}: ${error}`;
        onLogRef.current?.(
          'warn',
          task.kind === 'original' ? '本地伴侣原图恢复失败' : '本地伴侣步骤结果图恢复失败',
          label
        );
      },
    });
    return () => {
      cancelled = true;
    };
  }, [companionHydrateSessionKey, workspaceProjectChrome?.activeProjectId, setAssets]);

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
    if (!companionStoryboardGeneratedImageHistoryHydrateKey || !projectId || !base) return;
    let cancelled = false;
    void (async () => {
      const tasks = listStoryboardGeneratedImageHistoryCompanionHydrateTasks(assetsRef.current);
      const { hydrated, failures } = await hydrateStoryboardGeneratedImageHistoryCompanionTasks(
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
          '生图历史伴侣恢复失败',
          `${task.assetId}/${'recordId' in task ? task.recordId : ''}: ${failure.error}`
        );
      }
      if (!hydrated.length) return;
      setAssets((prev) => applyStoryboardGeneratedImageHistoryCompanionHydrateResults(prev, hydrated));
    })();
    return () => {
      cancelled = true;
    };
  }, [
    companionStoryboardGeneratedImageHistoryHydrateKey,
    workspaceProjectChrome?.activeProjectId,
    setAssets,
  ]);

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
    if (!companionAssetSetHydrateKey || !projectId || !base) return;
    let cancelled = false;
    void (async () => {
      const tasks = listAssetSetCompanionHydrateTasks(assetsRef.current);
      const { hydrated, failures } = await hydrateAssetSetCompanionTasks(tasks, base, projectId);
      if (cancelled) {
        revokeStoryboardFrameCompanionHydrateUrls(hydrated);
        return;
      }
      for (const failure of failures) {
        const task = failure.task;
        onLogRef.current?.(
          'warn',
          '资产集图片伴侣恢复失败',
          `${task.assetId}/${task.slot.kind}: ${failure.error}`
        );
      }
      if (!hydrated.length) return;
      setAssets((prev) => applyAssetSetCompanionHydrateResults(prev, hydrated));
    })();
    return () => {
      cancelled = true;
    };
  }, [companionAssetSetHydrateKey, workspaceProjectChrome?.activeProjectId, setAssets]);

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
            ? prev.map((x) => (x.id === assetId ? mergeWorkflowOriginalCompanionPersist(x, put) : x))
            : prev
        );
      })();
    },
    [onLog, setAssets, workspaceProjectChrome?.activeProjectId]
  );

  /** data / blob / http / 旧版裸 base64 → 伴侣原图键；data: 走同步路径 */
  const scheduleCompanionPersistOriginalAny = useCallback(
    (assetId: string, imageSrc: string) => {
      if (fileSourceApi && parseWorkshopCardId(assetId)) return;
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
            ? prev.map((x) => (x.id === assetId ? mergeWorkflowOriginalCompanionPersist(x, put) : x))
            : prev
        );
      })();
    },
    [onLog, scheduleCompanionPersistOriginal, setAssets, workspaceProjectChrome?.activeProjectId, fileSourceApi]
  );

  const previewWorkshopAssetImage = useCallback(
    (assetId: string, dataUrl: string) => {
      const id = String(assetId || '').trim();
      const src = String(dataUrl || '').trim();
      if (!id || !src || !fileSourceApi || !parseWorkshopCardId(id)) return;
      setWorkshopSourceById((prev) => (prev[id] === src ? prev : { ...prev, [id]: src }));
      setWorkshopThumbById((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      workshopThumbRequestedRef.current.delete(id);
    },
    [fileSourceApi],
  );

  const applyWorkshopRemapPackages = useCallback((created: WorkshopCreatedPackage[]) => {
    if (!created.length) return;
    setWorkshopOptimisticItems((prev) => {
      const keys = new Set(prev.map((row) => `${row.root}::${row.assetId}`));
      const next = [...prev];
      for (const pkg of created) {
        const key = `${pkg.root}::${pkg.assetId}`;
        if (keys.has(key)) continue;
        keys.add(key);
        next.push(
          optimisticWorkshopPackageItem({
            root: pkg.root,
            assetId: pkg.assetId,
            packageRel: pkg.packageRel,
            checkoutRel: pkg.checkoutRel,
            title: pkg.title,
          }),
        );
      }
      return next;
    });
    setWorkshopListEpoch((epoch) => epoch + 1);
  }, []);

  const enqueueWorkshopGenerationBatch = useCallback(
    async (
      newAssets: WorkflowAsset[],
      newTasks: WorkflowPendingTask[],
    ): Promise<{ ok: boolean; tasks: WorkflowPendingTask[] }> => {
      const api = workshopFileSourceApi();
      const root = String(workshopActiveRootRef.current || '').trim();
      const parentRel = workshopCurrentRelRef.current || '';
      if (isWorkshopRecycleRoot(root)) {
        onLog?.('warn', '作坊：回收站不能生成，请先选素材文件夹');
        return { ok: false, tasks: [] };
      }
      if (isWorkshopBrowserLibraryRoot(root)) {
        return { ok: true, tasks: newTasks };
      }
      if (!api?.createWorkshopPackage || !root) {
        onLog?.('warn', '作坊：请先挂上素材文件夹后再生成');
        return { ok: false, tasks: [] };
      }
      const st = await api.getWorkshopFileState?.();
      if (!String(st?.workspaceDir || '').trim()) {
        const picked = api.pickWorkshopWorkspace ? await api.pickWorkshopWorkspace() : null;
        if (!picked?.ok || !String(picked.workspaceDir || '').trim()) {
          onLog?.('warn', '作坊：请先指定库目录后再生成（不要用 C 盘默认目录）');
          return { ok: false, tasks: [] };
        }
        setWorkshopWorkspaceDir(String(picked.workspaceDir || '').trim());
      }
      const modules = [...actionModules, ...capabilityPresets];
      if (newAssets.length > 0 && !isWorkshopBatchEligible(newAssets, newTasks, modules)) {
        return { ok: true, tasks: newTasks };
      }
      if (newAssets.length === 0) {
        return { ok: true, tasks: newTasks };
      }
      const remapped = await remapGenerationBatchToWorkshop({
        api,
        root,
        parentRel,
        newAssets,
        newTasks,
        titleFromAsset: workshopTitleFromAsset,
      });
      if (!remapped.ok) {
        onLog?.('warn', remapped.error === 'no_workspace' ? '作坊：请先指定库目录' : '作坊：创建检出文件失败', remapped.error || 'create_failed');
        return { ok: false, tasks: [] };
      }
      applyWorkshopRemapPackages(remapped.createdPackages);
      return { ok: true, tasks: remapped.tasks };
    },
    [actionModules, capabilityPresets, applyWorkshopRemapPackages, onLog],
  );

  const scheduleCompanionPersistResult = useCallback(
    (assetId: string, resultKey: string, imageSrc: string) => {
      const source = String(imageSrc || '').trim();
      const rk = String(resultKey || '').trim();
      if (!source || !rk) return;
      if (parseWorkshopCardId(assetId)) {
        const parsed = parseWorkshopCardId(assetId);
        if (!parsed) return;
        previewWorkshopAssetImage(assetId, source);
        const api = workshopFileSourceApi();
        if (!api) return;
        void (async () => {
          if (parsed.kind === 'loose') {
            if (!api.upgradeWorkshopLoose) return;
            const out = await api.upgradeWorkshopLoose({
              root: parsed.root,
              rel: parsed.rel,
              dataUrl: source,
              step: rk,
            });
            if (!out?.ok) {
              onLog?.('warn', '作坊散文件写入工作区失败', out?.error || 'upgrade_failed');
              return;
            }
          } else if (api.writeWorkshopResult) {
            const item = workshopCanvasItemsRef.current.find(
              (row) =>
                row.kind === 'package' &&
                row.assetId === parsed.assetId &&
                row.root === parsed.root,
            );
            const out = await api.writeWorkshopResult({
              root: parsed.root,
              assetId: parsed.assetId,
              packageRel: item?.rel,
              dataUrl: source,
              step: rk,
            });
            if (!out?.ok) {
              onLog?.('warn', '作坊出图落盘失败', out?.error || 'write_failed');
              return;
            }
          }
          setWorkshopListEpoch((epoch) => epoch + 1);
        })();
        return;
      }
      const base = String(getCompanionLocalBaseUrl() || '').trim();
      const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
      if (!base || !pid) {
        onLog?.(
          'warn',
          '本地伴侣未连接或无项目，生成图仅在内存/云预览；右键「打开资产文件夹」将不可用',
          `${assetId}/${rk}`
        );
        return;
      }
      void (async () => {
        const asset = assetsRef.current.find((x) => x.id === assetId);
        const slotIndex = resolveWorkflowImageSlotIndex(asset?.resultOrder, rk);
        const put = parseDataUrlToBlob(source)
          ? await putWorkflowResultImageToCompanion(base, pid, assetId, rk, source, { slotIndex })
          : await putWorkflowResultImageFromAnyUrl(base, pid, assetId, rk, source, { slotIndex });
        if (put.ok === false) {
          onLog?.('warn', '本地伴侣步骤结果落盘失败（画布仍在内存）', put.error);
          return;
        }
        setAssets((prev) =>
          prev.some((x) => x.id === assetId)
            ? prev.map((x) =>
                x.id === assetId
                  ? {
                      ...x,
                      resultsCompanionKeys: { ...(x.resultsCompanionKeys || {}), [rk]: put.key },
                      ...(put.previewKey
                        ? {
                            resultsPreviewCompanionKeys: {
                              ...(x.resultsPreviewCompanionKeys || {}),
                              [rk]: put.previewKey,
                            },
                          }
                        : {}),
                    }
                  : x
              )
            : prev
        );
      })();
    },
    [fileSourceApi, onLog, previewWorkshopAssetImage, setAssets, setSelectedAssetIds, workspaceProjectChrome?.activeProjectId]
  );

  const clearWorkshopPreviewCache = useCallback((cardId: string) => {
    const id = String(cardId || '').trim();
    if (!id) return;
    workshopThumbRequestedRef.current.delete(id);
    setWorkshopThumbById((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setWorkshopSourceById((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const setWorkshopDisplayKey = useCallback(
    (cardId: string, displayKey: string) => {
      const key = String(displayKey || '').trim() || 'original';
      setWorkshopFaceById((prev) => (prev[cardId] === key ? prev : { ...prev, [cardId]: key }));
      clearWorkshopPreviewCache(cardId);
    },
    [clearWorkshopPreviewCache],
  );

  const workshopCardNeedsApply = useCallback(
    (cardId: string, displayKey: string) => {
      const face = workshopFaceFileId(cardId, displayKey);
      const parsed = parseWorkshopFileAssetId(cardId);
      const item = workshopCanvasItemsRef.current.find(
        (row) => parsed && row.root === parsed.root && row.rel === parsed.rel,
      );
      return workshopDisplayNeedsApply(face, String(item?.checkoutFileId || '').trim());
    },
    [workshopFaceFileId],
  );

  const applyWorkshopDisplayToCheckout = useCallback(
    async (cardId: string, displayKey: string) => {
      const fileId = workshopFaceFileId(cardId, displayKey);
      const parsed = parseWorkshopFileAssetId(cardId);
      if (!fileId || !parsed) return;
      const api = workshopFileSourceApi();
      if (!api?.applyWorkshopCheckout) return;
      const item = workshopCanvasItemsRef.current.find(
        (row) => row.root === parsed.root && row.rel === parsed.rel,
      );
      const out = await api.applyWorkshopCheckout({
        root: parsed.root,
        rel: parsed.rel,
        assetId: item?.assetId,
        fileId,
      });
      if (!out?.ok) {
        onLog?.('warn', '作坊：覆盖本地文件失败（可能被占用）', out?.error || 'apply_failed');
        return;
      }
      const nextRel = String(out.checkoutRel || parsed.rel || '').trim();
      if (nextRel && nextRel !== parsed.rel) {
        const nextId = workshopFileAssetId(parsed.root, nextRel);
        setSelectedAssetIds((prev) => {
          if (!prev.has(cardId) && lightboxAssetId !== cardId) return prev;
          const next = new Set(prev);
          if (next.has(cardId)) {
            next.delete(cardId);
            next.add(nextId);
          }
          return next;
        });
        if (lightboxAssetId === cardId) setLightboxAssetId(nextId);
      }
      setWorkshopListEpoch((epoch) => epoch + 1);
    },
    [lightboxAssetId, onLog, workshopFaceFileId],
  );

  const applyWorkshopNavLoc = useCallback((loc: WorkshopNavLoc, opts?: { fromHistory?: boolean }) => {
    const next = normalizeWorkshopNavLoc(loc);
    setWorkshopActiveRoot(next.root);
    setWorkshopCurrentRel(next.rel);
    setWorkshopSelectedRel(null);
    setSelectedAssetIds(new Set());
    setLightboxAssetId(null);
    setGroupFilterId(next.groupId);
    const api = workshopFileSourceApi();
    if (api?.setWorkshopLibraryOpen && workshopRootAllowsCreate(next.root)) {
      void api.setWorkshopLibraryOpen({ root: next.root, rel: next.rel });
    } else if (api?.setWorkshopLibraryOpen) {
      void api.setWorkshopLibraryOpen({ root: '', rel: '' });
    }
    if (!opts?.fromHistory) {
      setWorkshopNavHistory((prev) => pushWorkshopNav(prev, next));
    }
  }, []);

  const openWorkshopDiskFolder = useCallback((root: string, rel: string) => {
    applyWorkshopNavLoc({ root, rel, groupId: null });
  }, [applyWorkshopNavLoc]);

  const goWorkshopNavBack = useCallback(() => {
    const prev = workshopNavHistoryRef.current;
    if (!workshopNavCanBack(prev)) return;
    const next = workshopNavBack(prev);
    setWorkshopNavHistory(next);
    const loc = next.entries[next.index];
    if (loc) applyWorkshopNavLoc(loc, { fromHistory: true });
  }, [applyWorkshopNavLoc]);

  const goWorkshopNavForward = useCallback(() => {
    const prev = workshopNavHistoryRef.current;
    if (!workshopNavCanForward(prev)) return;
    const next = workshopNavForward(prev);
    setWorkshopNavHistory(next);
    const loc = next.entries[next.index];
    if (loc) applyWorkshopNavLoc(loc, { fromHistory: true });
  }, [applyWorkshopNavLoc]);

  const createWorkshopTextOnDisk = useCallback(
    async (body?: string): Promise<string | null> => {
      const api = workshopFileSourceApi();
      const root = String(workshopActiveRoot || '').trim();
      if (!api?.createWorkshopCheckoutFile || !workshopRootAllowsCreate(root)) {
        onLog?.('warn', '作坊：无法在当前文件夹新建文本');
        return null;
      }
      const out = await api.createWorkshopCheckoutFile({
        root,
        parentRel: workshopCurrentRel,
        title: '文本',
        ext: '.md',
        body: body || '',
      });
      if (!out?.ok || !out.rel) {
        onLog?.('warn', '作坊：新建文本失败', out?.error || 'create_failed');
        return null;
      }
      setWorkshopOptimisticItems((prev) => [
        ...prev,
        {
          kind: 'loose',
          root,
          rel: out.rel,
          name: out.name || '文本.md',
          assetKind: 'text',
          size: 0,
          mtimeMs: Date.now(),
        },
      ]);
      setWorkshopListEpoch((epoch) => epoch + 1);
      onLog?.('info', body ? '已粘贴为文字资产' : '已新建文本');
      return workshopFileAssetId(root, out.rel);
    },
    [onLog, workshopActiveRoot, workshopCurrentRel],
  );

  const importWorkshopLocalFiles = useCallback(
    async (files: File[]) => {
      const api = workshopFileSourceApi();
      const root = String(workshopActiveRoot || '').trim();
      if (!api?.importWorkshopFiles || !workshopRootAllowsCreate(root)) {
        onLog?.('warn', '作坊：无法导入到当前文件夹');
        return;
      }
      const items: Array<{ name: string; dataUrl?: string; absPath?: string }> = [];
      for (const file of files) {
        const absPath = String((file as File & { path?: string }).path || '').trim();
        if (absPath) {
          items.push({ name: file.name || 'file', absPath });
          continue;
        }
        const dataUrl = await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        });
        if (dataUrl) items.push({ name: file.name || 'file', dataUrl });
      }
      if (!items.length) return;
      const out = await api.importWorkshopFiles({
        root,
        parentRel: workshopCurrentRel,
        items,
      });
      if (!out?.ok) {
        onLog?.('warn', '作坊：导入失败', out?.error || 'import_failed');
        return;
      }
      setWorkshopListEpoch((epoch) => epoch + 1);
    },
    [onLog, workshopActiveRoot, workshopCurrentRel],
  );

  const persistCapturedWorkflowModelThumbnail = useCallback(
    (assetId: string, variantIdRaw: string, dataUrl: string, opts?: { force?: boolean }) => {
      const id = String(assetId || '').trim();
      const variantId = String(variantIdRaw || '').trim() || 'original';
      const thumb = String(dataUrl || '').trim();
      const force = Boolean(opts?.force);
      if (!id || !thumb || !parseDataUrlToBlob(thumb)) return;
      const slotKey = `${id}:${variantId}`;
      if (!force && persistedModelThumbnailSlotsRef.current.has(slotKey)) return;
      persistedModelThumbnailSlotsRef.current.add(slotKey);
      const thumbRatio = clampWorkflowCardAspectRatio(1280, 800);
      rememberAssetCardModelThumbnail(id, variantId, thumb);

      if (fileSourceApi && parseWorkshopCardId(id)) {
        setWorkshopThumbById((prev) => (prev[id] ? prev : { ...prev, [id]: thumb }));
        setCardAspectByAssetId((prev) => ({ ...prev, [id]: thumbRatio }));
        return;
      }

      const currentAsset = assetsRef.current.find((x) => x.id === id);
      if (!currentAsset) return;
      const patched = patchAssetWithModelViewportThumb(currentAsset, variantId, thumb, {
        force,
        aspectRatio: thumbRatio,
      });
      if (patched.changed) {
        setAssets((prev) => prev.map((x) => (x.id === id ? patched.asset : x)));
      }
      setCardAspectByAssetId((prev) => ({ ...prev, [id]: thumbRatio }));

      if (!patched.shouldPersistPreviewCompanion) return;
      const base = String(getCompanionLocalBaseUrl() || '').trim();
      const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
      if (!base || !pid) return;
      void (async () => {
        const asset = assetsRef.current.find((x) => x.id === id);
        const ext = /^data:image\/jpe?g/i.test(thumb) ? 'jpg' : 'png';
        const plan = planModelViewportPosterPersist(asset, id, variantId, ext);
        if (!plan) return;
        if (plan.writeFull) {
          const put = await putWorkflowResultImageToCompanion(base, pid, id, variantId, thumb, {
            slotIndex: plan.slot,
            writePreview: true,
          });
          if (put.ok === false) {
            onLog?.('warn', '3D 预览海报落盘失败', put.error);
            return;
          }
          setAssets((prev) =>
            prev.map((x) => {
              if (x.id !== id) return x;
              return {
                ...x,
                resultsCompanionKeys: {
                  ...(x.resultsCompanionKeys || {}),
                  [variantId]: put.key,
                },
                resultsPreviewCompanionKeys: {
                  ...(x.resultsPreviewCompanionKeys || {}),
                  [variantId]: put.previewKey || plan.previewKey,
                },
              };
            })
          );
          return;
        }
        const parsed = parseDataUrlToBlob(thumb);
        if (!parsed) return;
        const res = await putCompanionAsset(base, pid, plan.previewKey, parsed.blob, parsed.mime);
        if (res.ok === false) {
          onLog?.('warn', '3D 预览缩略图落盘失败', res.error);
          return;
        }
        setAssets((prev) =>
          prev.map((x) => {
            if (x.id !== id) return x;
            return {
              ...x,
              resultsPreviewCompanionKeys: {
                ...(x.resultsPreviewCompanionKeys || {}),
                [variantId]: plan.previewKey,
              },
            };
          })
        );
      })();
    },
    [fileSourceApi, onLog, setAssets, workspaceProjectChrome?.activeProjectId]
  );

  const persistCompanionResultMedia = useCallback(
    async (assetId: string, resultKey: string, mediaSrc: string, fallbackMime = 'video/mp4', providerId?: string) => {
      const source = String(mediaSrc || '').trim();
      if (!source) return;
      const base = String(getCompanionLocalBaseUrl() || '').trim();
      const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
      if (!base || !pid) {
        onLog?.('warn', '本地伴侣未连接，视频结果仅保留临时预览；请连接本地伴侣后重新生成以写入项目资产目录');
        return;
      }
      const asset = assetsRef.current.find((x) => x.id === assetId);
      const slotIndex = resolveWorkflowImageSlotIndex(asset?.resultOrder, resultKey);
      const put = await putWorkflowResultMediaFromAnyUrl(base, pid, assetId, resultKey, source, {
        fallbackMime,
        providerId,
        slotIndex,
      });
      if (put.ok === false) {
        onLog?.('warn', '视频结果写入本地伴侣失败（仍保留临时预览）', put.error);
        return;
      }
      const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, put.key);
      if (got.ok === false) {
        setAssets((prev) =>
          prev.map((x) =>
            x.id === assetId
              ? { ...x, resultsCompanionKeys: { ...(x.resultsCompanionKeys || {}), [resultKey]: put.key } }
              : x
          )
        );
        onLog?.('warn', '视频落盘后读取预览失败', got.error);
        return;
      }
      setAssets((prev) =>
        prev.map((x) =>
          x.id === assetId
            ? {
                ...x,
                results: { ...(x.results || {}), [resultKey]: got.objectUrl },
                resultsCompanionKeys: { ...(x.resultsCompanionKeys || {}), [resultKey]: put.key },
                resultMeta: {
                  ...(x.resultMeta || {}),
                  [resultKey]: {
                    ...(x.resultMeta?.[resultKey] || { executedAt: Date.now() }),
                    mediaKind: 'video' as const,
                  },
                },
              }
            : x
        )
      );
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
    return safeSvgDataUrl(svg);
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
    return safeSvgDataUrl(svg);
  }, []);
  const getLightboxStripPreviewSrc = useCallback((asset: WorkflowAsset): string => {
    if (fileSourceApi && parseWorkshopCardId(asset.id)) {
      const thumb = getAssetGridDisplayImage(asset).trim();
      if (thumb) return workflowSafeImgSrc(thumb);
    }
    const display = getAssetDisplayImage(asset).trim();
    if (display) return workflowSafeImgSrc(display);
    return buildTextLightboxPreviewDataUrl(asset.textTitle || '', getAssetDisplayText(asset));
  }, [fileSourceApi, buildTextLightboxPreviewDataUrl, getAssetDisplayImage, getAssetDisplayText, getAssetGridDisplayImage]);

  const getLightboxPreviewImageSrc = useCallback((asset: WorkflowAsset): string => {
    const workshopCard = Boolean(fileSourceApi && parseWorkshopCardId(asset.id));
    const route = resolveLightboxCenterRoute({
      asset,
      activeVariant: resolveWorkflowAssetActiveVariant(asset),
      displayImage: getAssetDisplayImage(asset),
      workshopGridThumb: workshopCard ? getAssetGridDisplayImage(asset) : '',
      isWorkshopCard: workshopCard,
    });
    return workflowSafeImgSrc(
      resolveLightboxPreviewImageSrc({
        mode: route.mode,
        displayImage: getAssetDisplayImage(asset),
        workshopGridThumb: workshopCard ? getAssetGridDisplayImage(asset) : '',
        isWorkshopCard: workshopCard,
      })
    );
  }, [fileSourceApi, getAssetDisplayImage, getAssetGridDisplayImage]);
  const workflowAssetIdSig = useMemo(
    () => assets.map((a) => String(a.id || '').trim()).join('\0'),
    [assets]
  );
  useEffect(() => {
    setAssets((prev) => {
      let changed = false;
      const next = prev.map((a) => {
        const { next: normalized, changed: tagChanged } = normalizeWorkflowTagMapToChinese(a.imageTags);
        let row = tagChanged ? { ...a, imageTags: normalized } : a;
        if (tagChanged) changed = true;
        const healed = healWorkflowAssetDisplayKeyIfEmpty(row);
        if (healed !== row && healed.displayKey !== row.displayKey) {
          changed = true;
          row = healed;
        }
        return row;
      });
      const deduped = dedupeWorkflowAssetsById(next);
      if (deduped.length !== next.length) changed = true;
      return changed ? deduped : prev;
    });
  }, [workflowAssetIdSig, setAssets]);
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
      let inputImage = getAssetComposeInputImage(asset);
      let inputSourceDisplayKey = asset.displayKey;
      // 同卡再生成 3D：当前若停在模型版本上，父节点与输入仍回到该模型的输入图（默认原图），避免 0→1→2 串联
      if (mod?.category === 'generate_3d') {
        const active = resolveWorkflowAssetActiveVariant(asset);
        if (active?.kind === 'model3d') {
          const snap = String(asset.resultMeta?.[asset.displayKey]?.inputSourceDisplayKeySnapshot || '').trim();
          inputSourceDisplayKey = snap || 'original';
          inputImage =
            getAssetComposeInputImage({ ...asset, displayKey: inputSourceDisplayKey }) ||
            asWorkflowImageString(asset.original) ||
            inputImage;
        }
      }
      if (mod && !assetAllowedForCapabilityDrop(asset, mod)) {
        onLog?.('warn', '当前显示内容与该能力不匹配（请切换到对应版本，或选用匹配能力）');
        return null;
      }
      const inputTextFromCard =
        options?.inputText ??
        (isWorkflowTextAsset(asset) &&
        (workflowAssetCurrentDisplayIsTextChannel(asset) ||
          (mod != null && workflowPresetAcceptsTextCardDrag(mod)))
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
        inputSourceDisplayKey,
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
        ...(options?.overrideVideoModelRegistryId ? { overrideVideoModelRegistryId: options.overrideVideoModelRegistryId } : {}),
        ...(typeof options?.overrideVideoDurationSeconds === 'number' ? { overrideVideoDurationSeconds: options.overrideVideoDurationSeconds } : {}),
        ...(options?.overrideVideoAspectRatio ? { overrideVideoAspectRatio: options.overrideVideoAspectRatio } : {}),
        ...(options?.overrideVideoResolution ? { overrideVideoResolution: options.overrideVideoResolution } : {}),
        ...(typeof options?.overrideVideoMotionStrength === 'number' ? { overrideVideoMotionStrength: options.overrideVideoMotionStrength } : {}),
        ...(options?.overrideModel3dRegistryId ? { overrideModel3dRegistryId: options.overrideModel3dRegistryId } : {}),
        ...(options?.overrideModel3dQuality ? { overrideModel3dQuality: options.overrideModel3dQuality } : {}),
        ...(options?.overrideModel3dGeometryQuality ? { overrideModel3dGeometryQuality: options.overrideModel3dGeometryQuality } : {}),
        ...(options?.overrideModel3dTextureQuality ? { overrideModel3dTextureQuality: options.overrideModel3dTextureQuality } : {}),
        ...(options?.overrideModel3dFormat ? { overrideModel3dFormat: options.overrideModel3dFormat } : {}),
        ...(typeof options?.overrideModel3dTexture === 'boolean' ? { overrideModel3dTexture: options.overrideModel3dTexture } : {}),
        ...(typeof options?.overrideModel3dPbr === 'boolean' ? { overrideModel3dPbr: options.overrideModel3dPbr } : {}),
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
        ...(options?.modelPbrTextureRewriteTarget ? { modelPbrTextureRewriteTarget: options.modelPbrTextureRewriteTarget } : {}),
      };
      return task;
    },
    [getAssetComposeInputImage, assetAllowedForCapabilityDrop, onLog, actionModules, capabilityPresets]
  );

  const makePendingTaskForAsset = useCallback(
    (assetId: string, actionType: string, options?: WorkflowPendingTaskOptions): WorkflowPendingTask | null => {
      const asset = findLiveAsset(assetId);
      if (!asset) return null;
      return buildPendingTaskFromAssetSnapshot(asset, assetId, actionType, options);
    },
    [findLiveAsset, buildPendingTaskFromAssetSnapshot]
  );

  const addToPending = useCallback(
    (assetId: string, actionType: string, options?: WorkflowPendingTaskOptions) => {
      void (async () => {
        const mod = getModule(actionType);
        const branch = classifyWorkflowRunTaskBranch({ actionType, module: mod ?? null });
        const overrides = creditOverridesFromTaskLike(options);
        const plan = planWorkflowActionRoutes(actionType, mod ?? null, {
          capabilitySet:
            branch === 'branch_capability_set'
              ? getSet(actionType.slice(SET_ACTION_PREFIX.length)) ?? null
              : null,
          presets: actionModules,
          overrides,
        });
        if (requiresPlatformCredits(plan)) {
          const serverMin = await fetchServerMinCreditsForSteps(plan);
          const balanceForGate =
            preferenceScope != null ? await fetchAvailableCreditsForGate() : creditBalance;
          const block = isSubmitBlockedForPlatformPlan(
            plan,
            preferenceScope,
            balanceForGate,
            balanceForGate == null && creditBalanceLoading,
            { minCreditsOverride: serverMin }
          );
          if (block.blocked) {
            onLog?.('warn', block.reason ?? creditsExceededUserMessage());
            return;
          }
        }
        const task = makePendingTaskForAsset(assetId, actionType, options);
        if (task) setPending((prev) => [...prev, task]);
      })();
    },
    [makePendingTaskForAsset, setPending, getModule, getSet, actionModules, onLog, preferenceScope, creditBalance, creditBalanceLoading]
  );

  const addWorkflowTextAsset = useCallback((initialText?: string): string => {
    const raw = (initialText || '').trim();
    if (workshopDiskOpen) {
      void createWorkshopTextOnDisk(raw);
      return '';
    }
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
    onLog?.('info', raw ? '已粘贴为文字资产' : '已新建文本');
    return id;
  }, [createWorkshopTextOnDisk, groupFilterId, onLog, setAssets, workshopDiskOpen]);

  const createWorkflowTextAssetAndOpen = useCallback(() => {
    if (workshopDiskOpen) {
      void createWorkshopTextOnDisk('').then((id) => {
        if (!id) return;
        setStoryboardPanelAssetId(null);
        setAssetSetPanelAssetId(null);
        openWorkflowLightbox(id);
      });
      return;
    }
    const id = addWorkflowTextAsset();
    setStoryboardPanelAssetId(null);
    setAssetSetPanelAssetId(null);
    openWorkflowLightbox(id);
  }, [addWorkflowTextAsset, createWorkshopTextOnDisk, openWorkflowLightbox, workshopDiskOpen]);

  const handleWorkflowFeatureClick = useCallback(
    (featureId: string) => {
      if (featureId !== 'storyboard_flow') return;
      const id = addWorkflowStoryboardTableAsset();
      openStoryboardTablePanel(id);
    },
    [addWorkflowStoryboardTableAsset, openStoryboardTablePanel]
  );

  const addTasksToPending = useCallback((tasks: WorkflowPendingTask[]) => {
    if (tasks.length === 0) return;
    setPending((prev) => [...prev, ...tasks]);
  }, [setPending]);

  const _removeFromPending = useCallback((taskId: string) => {
    const task = pending.find((t) => t.id === taskId);
    setPending((prev) => prev.filter((t) => t.id !== taskId));
    if (task) {
      setAssets((prev) =>
        prev.map((x) => {
          if (x.id !== task.assetId) return x;
          // 对话文生文 / PBR 贴图保持不入格
          if (x.assetKind === 'text' && x.hiddenInGrid) return x;
          if (isWorkflowPbrTextureAsset(x)) return { ...x, hiddenInGrid: true };
          return { ...x, hiddenInGrid: false };
        })
      );
    }
  }, [pending, setAssets, setPending]);

  const runTask = useCallback(async (
    task: WorkflowPendingTask
  ): Promise<{
    image: string | null;
    text?: string;
    videoUrl?: string;
    videoMime?: string;
    videoProviderId?: string;
    vgpSteps?: VgpGenStepCapture[];
    geminiRecoveryJobId?: string;
  }> => {
    const runAudit = appendWorkflowAuditEvent({
      level: 'info',
      code: WORKFLOW_AUDIT_CODES.RUN_TASK_EXECUTE,
      assetId: task.assetId,
      taskId: task.id,
      displayKey: task.inputSourceDisplayKey,
      message: `[${getTaskLogLabel(task)}] 开始执行`,
      detail: { actionType: task.actionType },
    });
    setCorrelationContext({
      projectId: workspaceProjectChrome?.activeProjectId?.trim() || undefined,
      actionType: String(task.actionType || '').trim() || undefined,
      assetId: task.assetId,
      correlationId: task.id,
      auditEventId: runAudit.id,
    });
    beginAiTaskEnvelope(task.id);
    let envelopeOutcome: 'success' | 'failed' = 'success';
    try {
    const taskModForEnvelope = getModule(task.actionType);
    const branchForEnvelope = classifyWorkflowRunTaskBranch({
      actionType: task.actionType,
      module: taskModForEnvelope ?? null,
    });
    await prepareAiTaskEnvelopeCredits(
      planWorkflowActionRoutes(task.actionType, taskModForEnvelope ?? null, {
        capabilitySet:
          branchForEnvelope === 'branch_capability_set'
            ? getSet(task.actionType.slice(SET_ACTION_PREFIX.length)) ?? null
            : null,
        presets: actionModules,
        overrides: creditOverridesFromTaskLike(task),
      })
    );
    const { actionType, inputImage, inputText } = task;
    const auditRunFail = (
      code: string,
      level: 'warn' | 'error',
      message: string,
      detail?: Record<string, unknown>,
      logDetail?: string
    ) => {
      envelopeOutcome = 'failed';
      emitWorkflowTaskFailure(onLog, task, { code, level, message, detail, logDetail });
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
        setAssetError(task.assetId, msg);
        auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_LIGHTBOX_DEFERRED_MISSING, 'warn', msg);
        return { image: null };
      }
      try {
        const img = await box.promise;
        const s = String(img ?? '').trim();
        if (!s) {
          const msg = `[${getTaskLogLabel(task)}] 未能取得大图预览合成底图（请重试）`;
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
          resolvedInputImagesForExecute = box.inputImagesForExecute;
        }
      } catch (err: unknown) {
        const full = formatWorkflowRunTaskErrorMessage(err, getTaskLogLabel(task));
        const msg = err instanceof Error ? err.message : safeUnknownToString(err);
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
          setAssetError(task.assetId, msg);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_INPUT_IMAGE_RESOLVE, 'warn', msg, { slot: slot.key });
          return { image: null };
        }
        nextSlots[slot.key] = resolvedImg.dataUrl;
      }
      resolvedTripoMultiviewImages = nextSlots;
      if (nextSlots.front) resolvedInputImage = nextSlots.front;
    }

    if (!task.lightboxAwaitClientResult && !task.tripoMultiviewImages) {
      const companionProjectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
      const companionBaseUrl = String(getCompanionLocalBaseUrl() || '').trim();
      const assetForInput = assetsRef.current.find((a) => a.id === task.assetId) ?? null;
      const resolveInputImageUrl = async (
        raw: string,
        inputIndex?: number
      ): Promise<string | false | null> => {
        const trimmed = String(raw || '').trim();
        if (!trimmed) return null;
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
          setAssetError(task.assetId, msg);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_INPUT_IMAGE_RESOLVE, 'warn', msg, {
            ...(typeof inputIndex === 'number' ? { inputIndex } : {}),
          });
          return false;
        }
        return resolvedImg.dataUrl;
      };

      const primaryRaw = String(resolvedInputImage || inputImage || '').trim();
      if (primaryRaw) {
        const primaryResolved = await resolveInputImageUrl(primaryRaw);
        if (primaryResolved === false) return { image: null };
        if (primaryResolved) resolvedInputImage = primaryResolved;
      }

      const refsRaw = task.inputImages ?? [];
      const resolvedRefs: string[] = [];
      for (let ri = 0; ri < refsRaw.length; ri += 1) {
        const refResolved = await resolveInputImageUrl(refsRaw[ri]!, ri);
        if (refResolved === false) return { image: null };
        if (refResolved) resolvedRefs.push(refResolved);
      }
      resolvedInputImagesForExecute = resolvedRefs.length > 0 ? resolvedRefs : undefined;
    }

    const module = getModule(actionType);
    const runTaskBranch = classifyWorkflowRunTaskBranch({ actionType, module });
    const actionLabel = getTaskLogLabel(task);

    switch (runTaskBranch) {
      case 'branch_capability_set': {
        const set = getSet(actionType.slice(SET_ACTION_PREFIX.length));
        if (!set) {
          const msg = `[${getActionLabel(actionType)}] 能力集合不存在`;
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
          const result = await executeCapabilitySet(set, resolvedInputImage ?? '', {
              presets: actionModules,
              textModelRegistryId: capabilityTextModel,
              companionProjectId: workspaceProjectChrome?.activeProjectId?.trim() || undefined,
              workflowAssetId: task.assetId,
              workflowSourceDisplayKey: task.inputSourceDisplayKey,
              inputContext: task.inputContext,
              abortSignal: taskAbortControllersRef.current.get(task.id)?.signal,
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
            if (cancelledTaskIdsRef.current.has(task.id)) {
              return { image: null };
            }
            if (result.ok === false) {
              const msg = `[${getActionLabel(actionType)}] ${result.error}`;
              if (/请求已取消|AbortError|aborted/i.test(result.error)) {
                cancelledTaskIdsRef.current.add(task.id);
                return { image: null };
              }
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
              return { image: null, videoUrl: result.videoUrl, videoMime: result.mimeType, videoProviderId: result.providerId, vgpSteps: result.vgpSteps };
            }
            return result.kind === 'image'
              ? { image: result.image, vgpSteps: result.vgpSteps }
              : { image: null };
        } catch (err: unknown) {
          if (cancelledTaskIdsRef.current.has(task.id)) {
            return { image: null };
          }
          if (isGeminiAsyncPollTimeoutError(err)) {
            const full = formatWorkflowRunTaskErrorMessage(err, actionLabel);
            setAssetError(task.assetId, full);
            auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_EXECUTE, 'warn', full, {
              error: err.message,
              retryable: true,
              geminiJobId: err.jobId,
            });
            return { image: null, geminiRecoveryJobId: err.jobId };
          }
          const msg = err instanceof Error ? err.message : safeUnknownToString(err);
          if (/请求已取消|AbortError|aborted/i.test(msg)) {
            cancelledTaskIdsRef.current.add(task.id);
            return { image: null };
          }
          const full = isCreditsExceededError(err)
            ? formatWorkflowRunTaskErrorMessage(err, actionLabel)
            : `[${actionLabel}] 能力集合执行异常：${msg}`;
          setAssetError(task.assetId, full);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_CAPABILITY_SET_EXCEPTION, 'error', full, { error: msg }, msg);
          return { image: null };
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
          setAssetError(task.assetId, msg);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_GENERATE3D_NOT_CONFIGURED, 'warn', msg);
          return { image: null };
        }
        if (!resolvedInputImage?.trim()) {
          const msg = '生成3D 需要图片输入';
          setAssetError(task.assetId, msg);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_GENERATE3D_NO_INPUT, 'warn', msg);
          return { image: null };
        }
        try {
          const assetSnap = assetsRef.current.find((a) => a.id === task.assetId);
          const baseId = baseActionId(task.actionType);
          const versionKey =
            String(task.resultKey || '').trim() ||
            (assetSnap ? allocateWorkflowResultVersionKey(assetSnap, baseId) : baseId);
          task.resultKey = versionKey;
          setAssets((prev) =>
            prev.map((a) => {
              if (a.id !== task.assetId) return a;
              const key = versionKey;
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
                    presetActionIdSnapshot: baseId,
                    mediaKind: 'model3d' as const,
                  },
                },
              };
            })
          );
          await onAddGenerate3DJob(module, resolvedInputImage, task, resolvedTripoMultiviewImages);
          setAssetError(task.assetId, null);
        } catch (err) {
          const taskLabel = getTaskLogLabel(task);
          const msg = err instanceof Error ? err.message : safeUnknownToString(err);
          const full = formatWorkflowRunTaskErrorMessage(err, taskLabel);
          setAssetError(task.assetId, full);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_GENERATE3D_EXCEPTION, 'error', full, { error: msg }, msg);
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
        const assetId = task.assetId;
        setCapabilitySetRunByAssetId((prev) => ({
          ...prev,
          [assetId]: { taskId: task.id, progressLine: '步骤 1/1 · 准备执行…', latestImage: null },
        }));
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
            ...(task.overrideVideoModelRegistryId ? { videoModelRegistryId: task.overrideVideoModelRegistryId } : {}),
            ...(typeof task.overrideVideoDurationSeconds === 'number'
              ? { videoDurationSeconds: task.overrideVideoDurationSeconds }
              : {}),
            ...(task.overrideVideoAspectRatio ? { videoAspectRatio: task.overrideVideoAspectRatio } : {}),
            ...(task.overrideVideoResolution ? { videoResolution: task.overrideVideoResolution } : {}),
            ...(typeof task.overrideVideoMotionStrength === 'number'
              ? { videoMotionStrength: task.overrideVideoMotionStrength }
              : {}),
            ...(task.overrideModel3dRegistryId ||
            task.overrideModel3dQuality ||
            task.overrideModel3dGeometryQuality ||
            task.overrideModel3dTextureQuality ||
            task.overrideModel3dFormat ||
            typeof task.overrideModel3dTexture === 'boolean' ||
            typeof task.overrideModel3dPbr === 'boolean'
              ? {
                  generate3D: {
                    ...(presetBase.generate3D ?? {
                      provider: 'tripo',
                      module: 'pro',
                      tripoTaskType: 'image_to_model',
                    }),
                    ...(task.overrideModel3dRegistryId ? { modelRegistryId: task.overrideModel3dRegistryId } : {}),
                    ...(task.overrideModel3dQuality ? { quality: task.overrideModel3dQuality } : {}),
                    ...(task.overrideModel3dGeometryQuality ? { tripoGeometryQuality: task.overrideModel3dGeometryQuality as 'standard' | 'detailed' } : {}),
                    ...(task.overrideModel3dTextureQuality ? { tripoTextureQuality: task.overrideModel3dTextureQuality as 'standard' | 'detailed' } : {}),
                    ...(task.overrideModel3dFormat ? { format: task.overrideModel3dFormat } : {}),
                    ...(typeof task.overrideModel3dTexture === 'boolean'
                      ? { texture: task.overrideModel3dTexture, tripoTexture: task.overrideModel3dTexture }
                      : {}),
                    ...(typeof task.overrideModel3dPbr === 'boolean'
                      ? { tripoPbr: task.overrideModel3dPbr, enablePBR: task.overrideModel3dPbr }
                      : {}),
                  },
                }
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
              abortSignal: taskAbortControllersRef.current.get(task.id)?.signal,
              onRunProgress: (line) => {
                setCapabilitySetRunByAssetId((prev) => {
                  const cur = prev[assetId];
                  if (cur?.taskId !== task.id) return prev;
                  return { ...prev, [assetId]: { ...cur, progressLine: line } };
                });
              },
            },
            {
              inputText,
              ...(resolvedInputImagesForExecute ? { inputImages: resolvedInputImagesForExecute } : {}),
            }
          );
          if (cancelledTaskIdsRef.current.has(task.id)) {
            return { image: null };
          }
          if (out.ok === false) {
            const msg = `[${actionLabel}] ${out.error}`;
            if (/请求已取消|AbortError|aborted/i.test(out.error)) {
              cancelledTaskIdsRef.current.add(task.id);
              return { image: null };
            }
            setAssetError(task.assetId, msg);
            auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_CAPABILITY_REJECTED, 'warn', msg, { error: out.error });
            return { image: null };
          }
          setAssetError(task.assetId, null);
          if (out.kind === 'text') {
            return { image: null, text: out.text };
          }
          if (out.kind === 'video') {
            return { image: null, videoUrl: out.videoUrl, videoMime: out.mimeType, videoProviderId: out.providerId, vgpSteps: out.vgpSteps };
          }
          if (out.kind === 'image' && out.image) {
            setCapabilitySetRunByAssetId((prev) => {
              const cur = prev[assetId];
              if (cur?.taskId !== task.id) return prev;
              return { ...prev, [assetId]: { ...cur, latestImage: out.image! } };
            });
          }
          return { image: out.image, vgpSteps: out.vgpSteps };
        } catch (err: unknown) {
          if (cancelledTaskIdsRef.current.has(task.id)) {
            return { image: null };
          }
          if (isGeminiAsyncPollTimeoutError(err)) {
            const full = formatWorkflowRunTaskErrorMessage(err, actionLabel);
            setAssetError(task.assetId, full);
            auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_CAPABILITY_EXCEPTION, 'warn', full, {
              error: err.message,
              retryable: true,
              geminiJobId: err.jobId,
            });
            return { image: null, geminiRecoveryJobId: err.jobId };
          }
          envelopeOutcome = 'failed';
          const msg = normalizeApiErrorMessage(err);
          if (/请求已取消|AbortError|aborted/i.test(msg)) {
            cancelledTaskIdsRef.current.add(task.id);
            return { image: null };
          }
          const full = detectPipelineStepFromMessage(msg)
            ? msg
            : isCreditsExceededError(err)
              ? formatWorkflowRunTaskErrorMessage(err, actionLabel)
              : `[${actionLabel}] 失败：${msg}`;
          setAssetError(task.assetId, full);
          auditRunFail(WORKFLOW_AUDIT_CODES.RUN_TASK_CAPABILITY_EXCEPTION, 'error', full, { error: msg }, msg);
          return { image: null };
        } finally {
          setCapabilitySetRunByAssetId((prev) => {
            const cur = prev[assetId];
            if (cur?.taskId !== task.id) return prev;
            const next = { ...prev };
            delete next[assetId];
            return next;
          });
        }
      }
      case 'branch_cut_image': {
        const m = `[${actionLabel}] 切割任务应由队列专用路径执行，请重试或刷新页面`;
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
    } finally {
      await finalizeAiTaskEnvelopeCredits(envelopeOutcome);
      endAiTaskEnvelope(task.id);
      clearCorrelationContext();
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
    preferenceScope,
  ]);
  const runTaskRef = useRef(runTask);
  useEffect(() => {
    runTaskRef.current = runTask;
  }, [runTask]);

  useEffect(() => {
    const onRecovered = (ev: Event) => {
      const detail = (ev as CustomEvent<GeminiAsyncRecoveredDetail>).detail;
      if (!detail?.jobId) return;
      const recoveredTasks = Array.from(geminiRecoveryTasksRef.current.values()) as WorkflowPendingTask[];
      const task =
        geminiRecoveryTasksRef.current.get(detail.jobId) ??
        (detail.workflowTaskId
          ? recoveredTasks.find((t) => t.id === detail.workflowTaskId)
          : undefined);
      if (!task) return;
      const applied = applyGeminiRecoveredToWorkflowTask({
        detail,
        task,
        extractImage: extractAiWorkerProxyImageDataUrl,
      });
      if (!applied.applied) return;
      geminiRecoveryTasksRef.current.delete(detail.jobId);
      setAssetError(task.assetId, null);
      const label = getTaskLogLabel(task);
      if (applied.text) {
        setAssets((prev) =>
          prev.map((a) => {
            if (a.id !== task.assetId) return a;
            const baseId = task.actionType;
            const hasAnyText = Object.keys(a.textResults || {}).some((k) => baseActionId(k) === baseId);
            const tKey = hasAnyText ? makeVersionKey(baseId) : baseId;
            return {
              ...a,
              textResults: { ...(a.textResults || {}), [tKey]: applied.text! },
              resultOrder: [...(a.resultOrder || []), tKey],
              resultMeta: {
                ...(a.resultMeta || {}),
                [tKey]: {
                  executedAt: Date.now(),
                  ...(task.displayStepLabel ? { displayStepLabel: task.displayStepLabel } : {}),
                },
              },
              displayKey: tKey,
              // 对话文生文资产保持 hidden；PBR 贴图永不入格；组内子项保留原值；其余生成完成后入格
              hiddenInGrid:
                isWorkflowPbrTextureAsset(a)
                  ? true
                  : a.assetKind === 'text' && a.hiddenInGrid
                    ? true
                    : a.groupId
                      ? a.hiddenInGrid
                      : false,
            };
          })
        );
      } else if (applied.image) {
        const result = applied.image;
        const aiGatewayJobId = consumeAiGatewayJobIdForImage(result);
        let persistedResultKey = '';
        flushSync(() => {
          setAssets((prev) =>
            prev.map((a) => {
              if (a.id !== task.assetId) return a;
              const baseId = task.actionType;
              const hasAnyVersion =
                Object.keys(a.results || {}).some((k) => baseActionId(k) === baseId) ||
                (a.resultOrder || []).some((k) => baseActionId(k) === baseId);
              const key = hasAnyVersion ? makeVersionKey(baseId) : baseId;
              persistedResultKey = key;
              const tagList = buildWorkflowImageTags({
                actionLabel: label,
                actionId: baseActionId(task.actionType),
                presetInstruction: getModule(task.actionType)?.instruction,
                promptOverride: task.promptOverride,
                inputText: task.inputText,
              });
              let next: WorkflowAsset = {
                ...a,
                results: { ...a.results, [key]: result },
                resultOrder: [...(a.resultOrder || []), key],
                resultMeta: {
                  ...(a.resultMeta || {}),
                  [key]: {
                    executedAt: Date.now(),
                    ...(task.displayStepLabel ? { displayStepLabel: task.displayStepLabel } : {}),
                    ...buildWorkflowStepResultMetaInputSnapshots(task, null),
                    ...(aiGatewayJobId ? { aiGatewayJobId } : {}),
                  },
                },
                imageTags: { ...(a.imageTags || {}), [key]: tagList },
                imageTagStage: { ...(a.imageTagStage || {}), [key]: 'coarse' as const },
                displayKey: key,
                hiddenInGrid: isWorkflowPbrTextureAsset(a) ? true : a.groupId ? a.hiddenInGrid : false,
              };
              const hadOverride = task.promptOverride != null && task.promptOverride.trim() !== '';
              next = applyVgpAfterSuccessfulGen(next, {
                resultKey: key,
                vgpSteps: [],
                semanticSummary: hadOverride ? `${label}（用户微调）` : label,
                hadPromptOverride: hadOverride,
                inputSourceDisplayKey: task.inputSourceDisplayKey,
                userPromptRecord: buildWorkflowTaskUserPromptRecordForMetadata(task, getModule),
              });
              return next;
            })
          );
        });
        if (result) {
          let rk = persistedResultKey;
          if (!rk) {
            rk = allocateWorkflowResultVersionKey(
              assetsRef.current.find((a) => a.id === task.assetId) || { resultOrder: [], results: {} },
              task.actionType,
            );
          }
          scheduleCompanionPersistResult(task.assetId, rk, result);
        }
        void loadImageIntrinsicSize(result).then((dim) => {
          if (dim) applyIntrinsicAspectToAsset(task.assetId, dim.w, dim.h);
        });
      }
      void (async () => {
        dispatchCreditsBalanceChanged();
      })();
      setCompletedTaskIds((prev) => new Set(prev).add(task.id));
      onLog?.('info', `[${label}] 云端任务已恢复并完成`);
      if (preferenceScope) {
        void emitWorkflowTaskReceiptNotice({
          taskId: task.id,
          taskLabel: label,
          onLog,
        });
      }
    };
    window.addEventListener(GEMINI_ASYNC_RECOVERED_EVENT, onRecovered);
    void retryAllRecoverableGeminiJobs();
    const onFocus = () => {
      void retryAllRecoverableGeminiJobs();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener(GEMINI_ASYNC_RECOVERED_EVENT, onRecovered);
      window.removeEventListener('focus', onFocus);
    };
  }, [
    applyIntrinsicAspectToAsset,
    getModule,
    getTaskLogLabel,
    onLog,
    scheduleCompanionPersistResult,
    setAssetError,
    setAssets,
    preferenceScope,
  ]);

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

  const moveRootAssetsToUpperLevel = useCallback(
    (assetIds: string[]) => {
      const destRel = workshopMoveToParentDestRel(workshopCurrentRel);
      if (destRel == null || !workshopDiskOpen) return;
      const rels = Array.from(
        new Set(
          assetIds
            .map((id) => workshopCardDiskRel(id, workshopCanvasItemsRef.current))
            .filter((rel): rel is string => Boolean(rel)),
        ),
      );
      if (rels.length === 0) return;
      const api = workshopFileSourceApi();
      if (!api?.moveWorkshopEntries) return;
      void api.moveWorkshopEntries({ root: workshopActiveRoot, destRel, rels }).then((out) => {
        if (!out?.ok) {
          onLog?.('warn', '作坊：移出组失败', out?.error || 'move_failed');
          return;
        }
        setSelectedAssetIds(new Set());
        setWorkshopListEpoch((epoch) => epoch + 1);
        applyWorkshopNavLoc({ root: workshopActiveRoot, rel: destRel, groupId: null });
      });
    },
    [applyWorkshopNavLoc, onLog, workshopActiveRoot, workshopCurrentRel, workshopDiskOpen],
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

  const buildWorkflowCreditsSteps = useCallback(
    (tasks: WorkflowPendingTask[]) => {
      const steps = [];
      for (const task of tasks) {
        const mod = getModule(task.actionType);
        const branch = classifyWorkflowRunTaskBranch({ actionType: task.actionType, module: mod ?? null });
        steps.push(
          ...planWorkflowActionRoutes(task.actionType, mod ?? null, {
            capabilitySet:
              branch === 'branch_capability_set'
                ? getSet(task.actionType.slice(SET_ACTION_PREFIX.length)) ?? null
                : null,
            presets: actionModules,
            overrides: creditOverridesFromTaskLike(task),
          })
        );
      }
      return steps;
    },
    [getModule, getSet, actionModules]
  );

  const applyModelPbrTextureRewriteResult = useCallback(
    (
      target: WorkflowModelPbrTextureRewriteTarget,
      resultSrc: string,
      actionType: string
    ): boolean => {
      const assetId = String(target.assetId || '').trim();
      const sourceSrc = String(target.sourceTextureSrc || '').trim();
      const result = String(resultSrc || '').trim();
      const targetSlots = new Set(target.slots || []);
      const targetMaterials = new Set((target.materialIds || []).map((id) => String(id || '').trim()).filter(Boolean));
      if (!assetId || !sourceSrc || !result || targetSlots.size === 0) return false;
      let applied = false;
      setAssets((prev) =>
        prev.map((asset) => {
          if (asset.id !== assetId) return asset;
          const stepKey = resolveStepModelPbrSlotKey({
            displayKey: asset.displayKey,
            variantId: asset.displayKey,
          });
          const doc = resolveWorkflowAssetPbrEditDoc(asset, {
            stepKey,
            modelKey: undefined,
          });
          if (!doc) return asset;
          const nextDoc = {
            ...doc,
            updatedAt: Date.now(),
            materials: { ...doc.materials },
          };
          let changed = false;
          for (const [materialId, material] of Object.entries(doc.materials)) {
            if (targetMaterials.size > 0 && !targetMaterials.has(materialId)) continue;
            const nextSlots = { ...(material.slots || {}) };
            let materialChanged = false;
            for (const slot of targetSlots) {
              const edit = nextSlots[slot];
              if (
                !pbrTextureEditMatchesRewriteSource(edit, target, (textureAssetId) => {
                  const tex = prev.find((a) => a.id === textureAssetId);
                  return tex ? getAssetDisplayImage(tex) : '';
                })
              ) {
                continue;
              }
              // 清旧 assetId，避免 resolve 仍指向旧正式资产；新结果以 dataUrl 展示，随后 migrate 再升格
              const { assetId: _dropAssetId, ...editRest } = edit;
              nextSlots[slot] = {
                ...editRest,
                dataUrl: result,
                fileName: target.textureLabel ? `${target.textureLabel}-regen.png` : 'texture-regen.png',
                mimeType: result.startsWith('data:image/') ? result.slice(5, result.indexOf(';')) || edit.mimeType : edit.mimeType,
                updatedAt: Date.now(),
              };
              materialChanged = true;
              changed = true;
            }
            if (materialChanged) {
              nextDoc.materials[materialId] = { ...material, slots: nextSlots };
            }
          }
          if (!changed) return asset;
          applied = true;
          return {
            ...writeWorkflowAssetStepPbrEdit(asset, stepKey || asset.displayKey || doc.modelKey, nextDoc),
            modelPbrTextureLineage: [
              ...(asset.modelPbrTextureLineage || []),
              {
                ...target,
                id: uuid(),
                resultTextureSrc: result,
                actionType,
                createdAt: Date.now(),
              },
            ].slice(-48),
          };
        })
      );
      return applied;
    },
    [getAssetDisplayImage, setAssets]
  );

  const executePending = useCallback(
    async (overridePending?: WorkflowPendingTask[]) => {
      const queue = overridePending ? [...overridePending] : [...pendingRef.current];
      // 允许在 cut_image 弹窗确认后用 overridePending 继续执行剩余任务
      if (queue.length === 0 || (executing && !overridePending)) return;
      const queueCreditsPlan = buildWorkflowCreditsSteps(queue);
      if (requiresPlatformCredits(queueCreditsPlan)) {
        const perTaskPlans = queue.map((task) => {
          const mod = getModule(task.actionType);
          const branch = classifyWorkflowRunTaskBranch({ actionType: task.actionType, module: mod ?? null });
          return planWorkflowActionRoutes(task.actionType, mod ?? null, {
            capabilitySet:
              branch === 'branch_capability_set'
                ? getSet(task.actionType.slice(SET_ACTION_PREFIX.length)) ?? null
                : null,
            presets: actionModules,
            overrides: creditOverridesFromTaskLike(task),
          });
        });
        const serverMin = await fetchMaxServerMinCreditsForStepsList(perTaskPlans);
        const clientMaxMin = perTaskPlans.reduce(
          (max, steps) => Math.max(max, sumPlatformMinCredits(steps)),
          0
        );
        const balanceForGate =
          preferenceScope != null ? await fetchAvailableCreditsForGate() : creditBalance;
        const block = isSubmitBlockedForPlatformPlan(
          queueCreditsPlan,
          preferenceScope,
          balanceForGate,
          balanceForGate == null && creditBalanceLoading,
          { minCreditsOverride: serverMin ?? clientMaxMin }
        );
        if (block.blocked) {
          onLog?.('warn', block.reason ?? creditsExceededUserMessage());
          return;
        }
      }
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
      for (const ac of taskAbortControllersRef.current.values()) {
        try {
          ac.abort();
        } catch {
          /* ignore */
        }
      }
      taskAbortControllersRef.current = new Map();
      setPending([]);
      setActiveTaskIds(new Set());
      setExecuting(true);
      setExecutingQueue({ total: queue.length, tasks: [...queue] });
      const workflowMaxConcurrency = getWorkflowMaxConcurrency();
      /** 生图并发（BATCH_BOX_SIZE，非 HTTP async-batch） */
      const imageBatchWorkersDirect = getGeminiImageBatchBoxSizeForCurrentProvider();
      const imageBatchWorkersUnderstand = getWorkflowUnderstandImageConcurrency();
      onLog?.(
        'info',
        `开始执行队列（${queue.length} 项，常规并发 ${workflowMaxConcurrency}，生图并发 ${imageBatchWorkersDirect}，生图理解并发 ${imageBatchWorkersUnderstand}）`
      );
      onLog?.(
        'info',
        '生图/理解走 AI 代理时，右侧日志「AI代理」会显示公平排队、限流重试与是否排队；当前不排队也会提示状态。'
      );

      const total = queue.length;
      const logBatch = `[${total}项·常规≤${workflowMaxConcurrency}/生图≤${imageBatchWorkersDirect}/理解≤${imageBatchWorkersUnderstand}]`;

      const processTask = async (task: WorkflowPendingTask) => {
        let balanceBeforeTask: number | null = null;
        const taskModForCredits = getModule(task.actionType);
        const taskBranchForCredits = classifyWorkflowRunTaskBranch({
          actionType: task.actionType,
          module: taskModForCredits ?? null,
        });
        const taskPlan = planWorkflowActionRoutes(task.actionType, taskModForCredits ?? null, {
          capabilitySet:
            taskBranchForCredits === 'branch_capability_set'
              ? getSet(task.actionType.slice(SET_ACTION_PREFIX.length)) ?? null
              : null,
          presets: actionModules,
          overrides: creditOverridesFromTaskLike(task),
        });
        if (requiresPlatformCredits(taskPlan) && preferenceScope) {
          try {
            balanceBeforeTask = resolveAvailableBalance(await fetchCreditBalance());
          } catch {
            balanceBeforeTask = null;
          }
        }
        const markTaskCompleted = (t: WorkflowPendingTask, opts?: { auditSuccess?: boolean }) => {
          if (opts?.auditSuccess !== false && !cancelledTaskIdsRef.current.has(t.id)) {
            appendWorkflowRunTaskSuccessAudit({ task: t });
            dispatchCreditsBalanceChanged();
            if (requiresPlatformCredits(taskPlan) && preferenceScope) {
              void emitWorkflowTaskReceiptNotice({
                taskId: t.id,
                taskLabel: getTaskLogLabel(t),
                balanceBeforeAvailable: balanceBeforeTask,
                onLog: (level, message, detail) => onLogRef.current?.(level, message, detail),
              });
            }
          }
          setCompletedTaskIds((prev) => new Set(prev).add(t.id));
        };
        if (cancelledTaskIdsRef.current.has(task.id)) {
          return;
        }
        const taskAbort = new AbortController();
        taskAbortControllersRef.current.set(task.id, taskAbort);
        setActiveTaskIds((prev) => new Set(prev).add(task.id));
        const isTaskCancelled = () => cancelledTaskIdsRef.current.has(task.id);
        const skipCancelledWrite = () => {
          markTaskCompleted(task, { auditSuccess: false });
        };
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
              setAssetError(task.assetId, msg);
              emitWorkflowTaskFailure(onLog, task, {
                code: WORKFLOW_AUDIT_CODES.RUN_TASK_INPUT_IMAGE_RESOLVE,
                level: 'warn',
                message: msg,
              });
              setCompletedTaskIds((prev) => { const next = new Set(prev); next.add(task.id); return next; });
              return;
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
                setAssetError(task.assetId, msg);
                emitWorkflowTaskFailure(onLog, task, {
                  code: WORKFLOW_AUDIT_CODES.RUN_TASK_INPUT_IMAGE_RESOLVE,
                  level: 'warn',
                  message: msg,
                });
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
              if (isTaskCancelled()) {
                skipCancelledWrite();
                return;
              }
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
                setAssetError(task.assetId, msg);
                emitWorkflowTaskFailure(onLog, task, {
                  code: WORKFLOW_AUDIT_CODES.RUN_TASK_PROCESS_EXCEPTION,
                  level: 'warn',
                  message: msg,
                });
                markTaskCompleted(task, { auditSuccess: false });
                return;
              }
              if (isTaskCancelled()) {
                skipCancelledWrite();
                return;
              }
              setAssetError(task.assetId, null);
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
            const {
              image: result,
              text: textResult,
              videoUrl: videoResultUrl,
              videoProviderId,
              vgpSteps,
              geminiRecoveryJobId,
            } = await runTaskRef.current(task);
            if (isTaskCancelled()) {
              skipCancelledWrite();
              return;
            }
            if (geminiRecoveryJobId) {
              if (isTaskCancelled()) {
                skipCancelledWrite();
                return;
              }
              geminiRecoveryTasksRef.current.set(geminiRecoveryJobId, task);
              scheduleWorkflowGeminiAsyncRecovery(task, geminiRecoveryJobId);
              onLog?.(
                'info',
                `${logBatch} ${taskLabel} 仍在云端处理，完成后将自动写入结果（任务 ${geminiRecoveryJobId}）`
              );
              return;
            }
            const videoUrl = videoResultUrl != null && String(videoResultUrl).trim() !== '' ? String(videoResultUrl).trim() : null;
            if (textResult != null && textResult !== '') {
              if (isTaskCancelled()) {
                skipCancelledWrite();
                return;
              }
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
                    // 对话文生文资产保持 hidden；PBR 贴图永不入格；组内子项保留原值；其余生成完成后入格
                    hiddenInGrid:
                      isWorkflowPbrTextureAsset(a)
                        ? true
                        : a.assetKind === 'text' && a.hiddenInGrid
                          ? true
                          : a.groupId
                            ? a.hiddenInGrid
                            : false,
                  };
                  return next;
                })
              );
              markTaskCompleted(task);
            } else if (videoUrl) {
              if (isTaskCancelled()) {
                skipCancelledWrite();
                return;
              }
              const videoBaseId = task.actionType;
              let videoResultKey = videoBaseId;
              flushSync(() => {
                setAssets((prev) =>
                  prev.map((a) => {
                    if (a.id !== task.assetId) return a;
                    const baseId = videoBaseId;
                    const hasAnyVersion =
                      Object.keys(a.results || {}).some((k) => baseActionId(k) === baseId) ||
                      (a.resultOrder || []).some((k) => baseActionId(k) === baseId);
                    videoResultKey = hasAnyVersion ? makeVersionKey(baseId) : baseId;
                    const key = videoResultKey;
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
                      hiddenInGrid: isWorkflowPbrTextureAsset(a) ? true : a.groupId ? a.hiddenInGrid : false,
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
              await persistCompanionResultMedia(task.assetId, videoResultKey, videoUrl, 'video/mp4', videoProviderId);
              if (isTaskCancelled()) {
                skipCancelledWrite();
                return;
              }
              markTaskCompleted(task);
            } else {
              if (isTaskCancelled()) {
                skipCancelledWrite();
                return;
              }
              const aiGatewayJobId = result ? consumeAiGatewayJobIdForImage(result) : null;
              const delegatedGenerate3D =
                !result &&
                classifyWorkflowRunTaskBranch({
                  actionType: task.actionType,
                  module: getModule(task.actionType),
                }) === 'branch_generate_3d';
              if (result && task.modelPbrTextureRewriteTarget) {
                const written = applyModelPbrTextureRewriteResult(
                  task.modelPbrTextureRewriteTarget,
                  result,
                  task.actionType
                );
                if (written) {
                  onLog?.('info', `${logBatch} ${taskLabel} texture written back to 3D asset`);
                  markTaskCompleted(task);
                  return;
                }
                onLog?.('warn', `${logBatch} ${taskLabel} texture target was not found; saved as a normal result`);
              }
              let persistedResultKey = '';
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
                    if (result) persistedResultKey = key;
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
                        ...(aiGatewayJobId ? { aiGatewayJobId } : {}),
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
                      hiddenInGrid: isWorkflowPbrTextureAsset(a) ? true : a.groupId ? a.hiddenInGrid : false,
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
              if (result) {
                let rk = persistedResultKey;
                if (!rk) {
                  rk = allocateWorkflowResultVersionKey(
                    findLiveAsset(task.assetId) || { resultOrder: [], results: {} },
                    task.actionType,
                  );
                }
                scheduleCompanionPersistResult(task.assetId, rk, result);
                void loadImageIntrinsicSize(result).then((dim) => {
                  if (dim) applyIntrinsicAspectToAsset(task.assetId, dim.w, dim.h);
                });
              }
              markTaskCompleted(task);
            }
          }
        } catch (e) {
          if (isTaskCancelled()) {
            skipCancelledWrite();
          } else {
            const msg = e instanceof Error ? e.message : safeUnknownToString(e);
            const aborted =
              /请求已取消|The operation was aborted|AbortError/i.test(msg) ||
              (typeof DOMException !== 'undefined' &&
                e instanceof DOMException &&
                e.name === 'AbortError');
            if (aborted) {
              cancelledTaskIdsRef.current.add(task.id);
              skipCancelledWrite();
            } else {
              const label = getTaskLogLabel(task);
              const full = `${logBatch} ${label} 失败：${msg}`;
              setAssetError(task.assetId, msg);
              emitWorkflowTaskFailure(onLog, task, {
                code: WORKFLOW_AUDIT_CODES.RUN_TASK_PROCESS_EXCEPTION,
                level: 'error',
                message: full,
                detail: { error: msg },
                logDetail: msg,
              });
              setCompletedTaskIds((prev) => new Set(prev).add(task.id));
            }
          }
        } finally {
          taskAbortControllersRef.current.delete(task.id);
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
          const leadRunsUnderstand = (() => {
            if (!leadTaskIsGenImage || !leadTask) return false;
            const mod = getModule(leadTask.actionType);
            if (!mod) return false;
            return shouldRunCapabilityUnderstand(mod, {
              overrideSkipUnderstand: leadTask.overrideSkipUnderstand,
              userText: leadTask.inputText,
            });
          })();
          const imageBatchWorkers = leadRunsUnderstand
            ? imageBatchWorkersUnderstand
            : imageBatchWorkersDirect;
          const chunkSize = leadTaskIsGenImage ? imageBatchWorkers : BASE_MAX_CONCURRENCY;
          const chunk = queue.slice(i, i + chunkSize);
          await Promise.all(chunk.map((task) => processTask(task)));
          i += chunk.length;
        }
        onLog?.('info', '队列执行完成');
      } catch (e) {
        const msg = e instanceof Error ? e.message : safeUnknownToString(e);
        onLog?.('error', `队列执行异常：${msg}`);
      } finally {
        // 勿在此清空 cancelledTaskIdsRef：批结束后状态 effect 仍需识别用户取消，
        // 否则会把「已取消」推成 done/orphan。新批开始时（上方）已会清空。
        for (const ac of taskAbortControllersRef.current.values()) {
          try {
            ac.abort();
          } catch {
            /* ignore */
          }
        }
        taskAbortControllersRef.current = new Map();
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
      getSet,
      actionModules,
      setAssetError,
      scheduleCompanionPersistResult,
      applyIntrinsicAspectToAsset,
      persistCompanionResultMedia,
      workspaceProjectChrome?.activeProjectId,
      buildWorkflowCreditsSteps,
      applyModelPbrTextureRewriteResult,
      preferenceScope,
      creditBalance,
      creditBalanceLoading,
      findLiveAsset,
    ]
  );

  const retryTaskFromSnapshot = useCallback(
    (auditEventId: string) => {
      const id = String(auditEventId || '').trim();
      if (!id) {
        onLog?.('warn', '重试失败：缺少审计事件 id');
        return;
      }
      const ev = readWorkflowAuditRing().find((e) => e.id === id);
      if (!ev) {
        onLog?.('warn', '重试失败：找不到对应失败记录（可能已过期）');
        return;
      }
      const snapshot = parseRetrySnapshotFromAuditDetail(ev.detail);
      if (!snapshot) {
        onLog?.('warn', '重试失败：该记录不可重试或快照已失效');
        return;
      }
      const assetExists = assetsRef.current.some((a) => a.id === snapshot.assetId);
      const moduleExists = (() => {
        if (snapshot.actionType === 'cut_image') return true;
        if (snapshot.actionType.startsWith(SET_ACTION_PREFIX)) {
          return !!getSet(snapshot.actionType.slice(SET_ACTION_PREFIX.length));
        }
        const mod = getModule(snapshot.actionType);
        return !!mod && !mod.disabled;
      })();
      const validationError = validateRetrySnapshot({ snapshot, assetExists, moduleExists });
      if (validationError) {
        onLog?.('warn', `重试失败：${validationError}`);
        return;
      }
      const task = buildPendingTaskFromRetrySnapshot(snapshot);
      appendWorkflowAuditEvent({
        level: 'info',
        code: WORKFLOW_AUDIT_CODES.RUN_TASK_RETRY,
        assetId: snapshot.assetId,
        taskId: task.id,
        displayKey: snapshot.inputSourceDisplayKey,
        message: `[${getTaskLogLabel(task)}] 从运行日志重试`,
        detail: {
          sourceAuditEventId: id,
          sourceTaskId: snapshot.sourceTaskId,
          actionType: snapshot.actionType,
        },
      });
      const nextPending = [task, ...pendingRef.current];
      setPending(nextPending);
      const label = getTaskLogLabel(task);
      if (executing) {
        onLog?.('info', `[${label}] 已加入重试队列（当前批次完成后执行）`);
      } else {
        onLog?.('info', `[${label}] 已加入重试队列`);
        void executePending(nextPending);
      }
    },
    [executing, executePending, getModule, getSet, getTaskLogLabel, onLog]
  );

  useEffect(() => {
    const onRetry = (ev: Event) => {
      const auditEventId = String((ev as CustomEvent<{ auditEventId?: string }>).detail?.auditEventId || '').trim();
      if (!auditEventId) return;
      retryTaskFromSnapshot(auditEventId);
    };
    window.addEventListener(AC_WORKFLOW_RETRY_TASK_EVENT, onRetry);
    return () => window.removeEventListener(AC_WORKFLOW_RETRY_TASK_EVENT, onRetry);
  }, [retryTaskFromSnapshot]);

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
        const slot = resolveWorkflowDisplaySlot(targetAsset);
        if (slot.modality !== 'image' && slot.modality !== 'video') {
          onLog?.('warn', '复合能力需要当前显示为图片的资产作为输入');
          return;
        }
      } else {
        const mod =
          actionModules.find((m) => m.id === trimmed) ??
          capabilityPresets.find((p) => p.id === trimmed);
        if (mod && !assetAllowedForCapabilityDrop(targetAsset, mod)) {
          onLog?.('warn', '当前显示内容与该能力不匹配');
          return;
        }
      }
      const task = makePendingTaskForAsset(targetAsset.id, trimmed, undefined);
      if (!task) return;
      // 闲时也先入 pending：executePending 积分闸门 await 期间状态 effect 才能找到 task，避免闪「任务已结束或失败」
      setPending((prev) => [task, ...prev.filter((t) => t.id !== task.id)]);
      if (!executing) {
        void executePending([task, ...pendingRef.current]);
      }
    },
    [
      actionModules,
      capabilityPresets,
      assetAllowedForCapabilityDrop,
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
      // 标记拖放已消费：从功能区拖出时勿按「拖出即移除」删收藏（复制到对话）
      setActionDroppedInFavorite(true);
      setQuickComposePromptCards((prev) => [
        ...prev,
        { key: uuid(), presetId: trimmed, label: mod.label, instruction: ins },
      ]);
      onLog?.('info', `底部快捷栏：已加入「${mod.label}」提示词卡片，可与输入框说明一并入队`);
    },
    [actionModules, capabilityPresets, onLog]
  );

  const buildQuickComposeAgentSurface = useCallback((): AgentSurfaceContext => {
    const lb = String(lightboxAssetIdRef.current || '').trim();
    if (lb) {
      const asset = assetsRef.current.find((a) => a.id === lb);
      const displayKey = String(asset?.displayKey || 'full');
      const hasLocalEdit = Boolean(lightboxOverlayDraft?.localEdit);
      return { kind: 'lightbox', assetId: lb, displayKey, hasLocalEdit };
    }
    const selected = [...selectedAssetIds].filter((id) => Boolean(id));
    if (selected.length) return { kind: 'canvas', selectedAssetIds: selected };
    return { kind: 'none' };
  }, [lightboxOverlayDraft, selectedAssetIds]);

  const buildQuickComposePerceptionContext = useCallback((): ProjectAgentPerceptionContext => {
    const surface = buildQuickComposeAgentSurface();
    const activeSurface =
      surface.kind === 'lightbox'
        ? 'lightbox'
        : surface.kind === 'canvas'
          ? 'canvas'
          : 'workflow';
    const workspace = buildRuntimeWorkspaceState({
      projectId: activeWorkspaceProjectId || undefined,
      projectName: workspaceProjectChrome?.activeProjectName || undefined,
      activeSurface,
      activeAssetId: surface.kind === 'lightbox' ? surface.assetId : undefined,
      selectedAssetIds: surface.kind === 'canvas' ? surface.selectedAssetIds : [...selectedAssetIds],
      activeStepId: surface.kind === 'canvas' ? surface.stepId : undefined,
      draftDirty: Boolean(lightboxOverlayDraft?.localEdit),
    });

    const queueTasks = [
      ...pendingRef.current.map((task) => {
        const row = task as WorkflowPendingTask & {
          actionId?: string;
          error?: string;
          label?: string;
          presetName?: string;
        };
        return {
          id: row.id,
          title: row.label || row.presetName || row.actionId || row.id,
          status: 'pending',
          taskIds: [row.id],
          errorMessage: row.error,
        };
      }),
      ...((executingQueue?.tasks ?? []).map((task) => {
        const row = task as WorkflowPendingTask & {
          actionId?: string;
          error?: string;
          label?: string;
          presetName?: string;
        };
        return {
          id: row.id,
          title: row.label || row.presetName || row.actionId || row.id,
          status: 'running',
          taskIds: [row.id],
          errorMessage: row.error,
        };
      })),
    ];
    const workflow = buildRuntimeWorkflowState({
      activePlanId: queueTasks.length ? 'workspace-queue' : undefined,
      steps: queueTasks,
      blockers: queueTasks
        .filter((task) => String(task.errorMessage || '').trim())
        .map((task) => String(task.errorMessage || '').trim()),
    });

    const capabilities = [
      ...buildWorkbenchSelectionCapabilities(workspace),
      ...buildWorkflowCapabilities(workflow),
      ...buildExternalAppCapabilities(runtimeExternalApps),
    ];
    const risks = [
      ...buildWorkbenchPerceptionRisks(workspace),
      ...runtimeExternalRisks,
    ];
    const bus = createRuntimePerceptionContextBus();
    bus.updatePartial({
      workspace,
      workflow,
      externalApps: runtimeExternalApps,
      capabilities,
      risks,
    });
    if (workspace.selectedAssetIds.length > 0) {
      bus.emitEvent({
        source: 'user',
        type: 'user.selection.changed',
        summary: `Selected ${workspace.selectedAssetIds.length} asset${workspace.selectedAssetIds.length === 1 ? '' : 's'}`,
      });
    }
    if (workflow.steps.some((step) => step.status === 'failed' || step.status === 'blocked')) {
      bus.emitEvent({
        source: 'workflow',
        type: 'workflow.step.failed',
        summary: 'Workflow has a failed or blocked step',
        severity: 'warn',
      });
    }
    return buildProjectAgentPerceptionContext(bus.getSnapshot());
  }, [
    activeWorkspaceProjectId,
    buildQuickComposeAgentSurface,
    executingQueue,
    lightboxOverlayDraft,
    runtimeExternalApps,
    runtimeExternalRisks,
    selectedAssetIds,
    workspaceProjectChrome?.activeProjectName,
  ]);

  type QuickComposeSubmitInvokeOptions = {
    overrideImageDataUrls?: string[];
    overrideUserText?: string;
    /** 伪多轮上下文 + 当前句（由 quickComposeTurnContext 生成） */
    pseudoMultiTurnPrompt?: string;
    /**
     * Agent 路径：runtime 已把 B 层写入 overrideUserText，文工具勿再 format 伪多轮。
     * 非 Agent 路径保持默认 false（仍注入近期轮次）。
     */
    skipThreadContextInject?: boolean;
    /** 带参考图时即使底部为「文」也走图/3D 链路（大图预览提交） */
    preferImagePipelineWhenImagesAttached?: boolean;
    /** 为 true 时不重置底部快捷栏文案与附图 */
    preserveBottomBarDraft?: boolean;
    /** 忽略底部拖入的预设卡片，只走「文/图/3D」内置逻辑（大图预览） */
    skipPromptCards?: boolean;
    /** 大图预览等：任务挂在该已有图片资产上，不新建隐藏卡片 */
    reuseAssetId?: string;
    reuseAssetIds?: string[];
    referenceAssetIds?: string[];
    inputContext?: WorkflowPendingTask['inputContext'];
    /** 侧栏对话等：无附图时强制走「文」内置链路，避免误触文生图 RPM */
    preferTextPipelineWhenNoImagesAttached?: boolean;
    /** 侧栏 Agent：带图问答走图生文，而不是普通文生文或图生图 */
    allowVisionText?: boolean;
    /** Phase 2 Agent：强制 compose 模态（覆盖底部芯片） */
    forceComposeMode?: WorkspaceQuickComposeComposeMode;
    /** Phase 2 Agent：覆盖预设卡片列表（按 plan 执行） */
    presetCardsOverride?: WorkspaceQuickComposePromptCard[];
  };

  const submitQuickComposeImpl = useCallback(async (invoke?: QuickComposeSubmitInvokeOptions): Promise<string[]> => {
    if (isAiTaskBusy()) {
      onLog?.('warn', '当前有 AI 任务执行中，请等待完成后再发送');
      return [];
    }
    const rememberTaskAssetById = (tasks: WorkflowPendingTask[]) => {
      const map: Record<string, string> = {};
      for (const t of tasks) {
        if (t.id && t.assetId) map[t.id] = t.assetId;
      }
      lastQuickComposeTaskAssetByIdRef.current = map;
    };
    const enqueueQuickComposeBatch = async (
      newAssets: WorkflowAsset[],
      newTasks: WorkflowPendingTask[],
    ): Promise<string[]> => {
      if (newTasks.length === 0) {
        onLog?.('warn', '底部快捷栏：无法创建任务');
        lastQuickComposeTaskAssetByIdRef.current = {};
        return [];
      }
      let tasks = newTasks;
      if (workshopDiskOpen && newAssets.length > 0) {
        const remapped = await enqueueWorkshopGenerationBatch(newAssets, newTasks);
        if (!remapped.ok) {
          lastQuickComposeTaskAssetByIdRef.current = {};
          return [];
        }
        tasks = remapped.tasks;
      } else if (newAssets.length > 0) {
        setAssets((prev) => [...prev, ...newAssets]);
      }
      rememberTaskAssetById(tasks);
      setPending((prev) => [...prev, ...tasks]);
      if (!executing) {
        void executePending([...tasks, ...pendingRef.current]);
      }
      if (!invoke?.preserveBottomBarDraft) {
        setQuickComposeSegmentsTracked([newQuickComposeTextSegment('')]);
        setQuickComposeMainDropSlots([]);
        setQuickComposeReferenceDropSlots([]);
      }
      setQuickComposePromptCards([]);
      onLog?.('info', '底部快捷栏：已加入执行队列');
      return tasks.map((t) => t.id);
    };
    const maxRefs = getQuickComposeMaxRefs();
    const resolved = resolveQuickComposeReferences({
      segments: quickComposeSegmentsRef.current,
      mainDropSlots: quickComposeMainDropSlotsRef.current,
      referenceDropSlots: quickComposeReferenceDropSlotsRef.current,
      assets: getComposeAssets(),
      getAssetDisplayImage: getAssetComposeInputImage,
      maxRefs,
    });
    const queues = resolveQuickComposeImageQueues({
      mainDropSlots: quickComposeMainDropSlotsRef.current,
      referenceDropSlots: quickComposeReferenceDropSlotsRef.current,
      assets: getComposeAssets(),
      getAssetDisplayImage: getAssetComposeInputImage,
      maxRefs,
    });
    for (const w of [...resolved.warnings, ...queues.warnings]) {
      onLog?.('warn', `底部快捷栏：${w}`);
    }
    const userPrompt = resolved.userPrompt;
    const overrideImgs = invoke?.overrideImageDataUrls?.filter((s) => String(s).trim()) ?? [];
    let mainUrls = overrideImgs.length > 0 ? overrideImgs : queues.mainUrls;
    let referenceUrls = overrideImgs.length > 0 ? [] : queues.referenceUrls;
    const assetImageById = (assetId: string): string => {
      const asset = findLiveAsset(assetId);
      return asset ? getAssetComposeInputImage(asset).trim() : '';
    };
    const reuseIdsForInput = [
      ...(invoke?.reuseAssetIds ?? []),
      ...(invoke?.reuseAssetId ? [invoke.reuseAssetId] : []),
    ]
      .map((id) => id.trim())
      .filter(Boolean)
      .filter((id, index, arr) => arr.indexOf(id) === index);
    const invokedReferenceUrls = (invoke?.referenceAssetIds ?? [])
      .map((id) => assetImageById(id))
      .filter((src) => src.trim());
    if (invokedReferenceUrls.length > 0) {
      referenceUrls = invokedReferenceUrls.slice(0, maxRefs);
    }
    if (reuseIdsForInput.length > 0 && mainUrls.length === 0) {
      const reuseMainUrls = reuseIdsForInput.map((id) => assetImageById(id)).filter(Boolean);
      const missing = reuseMainUrls.length !== reuseIdsForInput.length;
      if (reuseMainUrls.length > 0 && !missing) {
        mainUrls = reuseMainUrls;
      } else {
        onLog?.('warn', '项目 Agent：选中的目标资产没有可用预览，无法作为生成输入');
        lastQuickComposeTaskAssetByIdRef.current = {};
        return [];
      }
    }
    if (mainUrls.length === 0 && referenceUrls.length === 0 && resolved.refs.length > 0) {
      mainUrls = [resolved.refs[0]!];
      referenceUrls = resolved.refs.slice(1);
    }
    const imgsAll = [...mainUrls, ...referenceUrls].filter((s) => String(s).trim());
    const promptText = buildQuickComposePromptOverride(userPrompt, resolved.referenceContextBlock);
    const userText = (
      invoke?.overrideUserText !== undefined ? invoke.overrideUserText.trim() : promptText
    ).trim();
    const effectiveUserText = (
      invoke?.pseudoMultiTurnPrompt?.trim() || userText
    ).trim();
    let composeMode: WorkspaceQuickComposeComposeMode =
      invoke?.forceComposeMode ??
      (invoke?.preferTextPipelineWhenNoImagesAttached && imgsAll.length === 0
        ? 'text'
        : invoke?.preferImagePipelineWhenImagesAttached && imgsAll.length > 0 && quickComposeMode === 'text'
          ? 'image'
          : imgsAll.length > 0 && quickComposeMode === 'text'
            ? 'image'
            : quickComposeMode);
    // P23：自动挡在入队前解析为具体模态（Agent 路径通常已 forceComposeMode）
    if (composeMode === 'auto') {
      if (imgsAll.length > 0) {
        composeMode = 'image';
      } else {
        const hasEnabled3dPreset = Boolean(
          actionModules.some((m) => m.category === 'generate_3d' && m.enabled !== false) ||
            capabilityPresets.some((m) => m.category === 'generate_3d' && m.enabled !== false)
        );
        composeMode = resolveComposerMode(
          buildProjectAgentIntent({
            text: effectiveUserText,
            mode: 'auto',
            hasEnabled3dPreset,
            surface: buildQuickComposeAgentSurface(),
            ...(quickComposeMainDropSlotsRef.current[0]?.assetId
              ? { mainAssetId: quickComposeMainDropSlotsRef.current[0]!.assetId }
              : lightboxAssetIdRef.current
                ? { mainAssetId: String(lightboxAssetIdRef.current).trim() }
                : {}),
          })
        );
      }
    }

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
          const hasFixedInstruction = String(m.instruction || '').trim().length > 0;
          if (!hasFixedInstruction) {
            o.overrideSkipUnderstand = overrideSkipUnderstandFromUnderstandEnabled(true);
          }
        }
      }
      if (
        (eng === 'gen_text' || m.category === 'text_to_text' || m.category === 'image_to_text') &&
        composeMode === 'text'
      ) {
        o.overrideTextModelRegistryId = coerceTextModelRegistryId(quickComposeTextModel);
      }
      if (m.category === 'generate_video') {
        if (quickComposeVideoModel || quickComposeDefaultVideoModel) {
          o.overrideVideoModelRegistryId = quickComposeVideoModel || quickComposeDefaultVideoModel;
        }
        const durationSeconds = Number(quickComposeVideoDuration);
        if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
          o.overrideVideoDurationSeconds = durationSeconds;
        }
        if (quickComposeVideoAspect) o.overrideVideoAspectRatio = quickComposeVideoAspect;
        if (quickComposeVideoResolution) o.overrideVideoResolution = quickComposeVideoResolution;
        const motionStrength = Number(quickComposeVideoMotion);
        if (Number.isFinite(motionStrength) && quickComposeVideoMotion.trim()) {
          o.overrideVideoMotionStrength = motionStrength;
        }
      }
      if (m.category === 'generate_3d') {
        if (quickComposeModel3dModel || quickComposeDefaultModel3d) {
          o.overrideModel3dRegistryId = quickComposeModel3dModel || quickComposeDefaultModel3d;
        }
        if (quickComposeModel3dQuality) o.overrideModel3dQuality = quickComposeModel3dQuality;
        if (quickComposeModel3dGeometryQuality) o.overrideModel3dGeometryQuality = quickComposeModel3dGeometryQuality;
        if (quickComposeModel3dTextureQuality) o.overrideModel3dTextureQuality = quickComposeModel3dTextureQuality;
        if (quickComposeModel3dFormat) o.overrideModel3dFormat = quickComposeModel3dFormat;
        o.overrideModel3dTexture = quickComposeModel3dTexture;
        o.overrideModel3dPbr = quickComposeModel3dPbr;
      }
      return o;
    };

    const quickComposeCountForMod = (m: CustomAppModule) => {
      const eng = getCapabilityEngine(m);
      const applicable = eng === 'gen_image' || m.category === 'text_to_image' || m.category === 'text_to_text';
      return applicable ? normalizeWorkflowGenerateCount(quickComposeCount) : 1;
    };

    /** 多张预设卡片：每张单独入队（各自 presetId + instruction；输入框文案拼到每一条） */
    const skipPromptCardsForPlainText =
      invoke?.preferTextPipelineWhenNoImagesAttached === true && imgsAll.length === 0;
    const effectivePromptCards = invoke?.presetCardsOverride ?? quickComposePromptCards;
    if (
      effectivePromptCards.length > 0 &&
      !invoke?.skipPromptCards &&
      !skipPromptCardsForPlainText
    ) {
      const cardRows: Array<{ card: WorkspaceQuickComposePromptCard; mod: CustomAppModule }> = [];
      for (const card of effectivePromptCards) {
        const m = resolveQuickComposeMod(card.presetId);
        if (!m || m.disabled) {
          onLog?.('warn', `底部快捷栏：跳过无效预设「${card.label}」(${card.presetId})`);
          continue;
        }
        cardRows.push({ card, mod: m });
      }
      if (cardRows.length === 0) {
        onLog?.('warn', '底部快捷栏：没有可用的预设卡片可执行');
        return [];
      }

      let totalPlanned = 0;
      for (const { mod: m } of cardRows) {
        const countN = quickComposeCountForMod(m);
        const mains = mainUrls.length > 0 ? mainUrls.length : 1;
        totalPlanned += mains * countN;
      }
      if (
        totalPlanned > WORKFLOW_GROUP_GENERATE_CONFIRM_THRESHOLD &&
        typeof window !== 'undefined' &&
        !window.confirm(`将创建 ${totalPlanned} 条队列任务，是否继续？`)
      ) {
        return [];
      }

      const newAssets: WorkflowAsset[] = [];
      const newTasks: WorkflowPendingTask[] = [];

      for (const { card, mod: m } of cardRows) {
        const ins = String(card.instruction ?? '').trim();
        const maxRef = maxReferenceImagesForImageModel(m.imageModelRegistryId ?? m.imageGear);
        const countN = quickComposeCountForMod(m);
        const taskOverrides = buildQuickComposeGenOverrides(m);

        if (mainUrls.length === 0) {
          const pieceText = buildQuickComposePromptOverride(effectiveUserText, '', ins);
          if (!pieceText && referenceUrls.length === 0) {
            onLog?.('warn', `底部快捷栏：跳过「${m.label}」（无提示词且无参考图）`);
            continue;
          }
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
          continue;
        }

        for (const mainUrl of mainUrls) {
          const built = buildQuickComposeTaskPromptOverride(effectiveUserText, mainUrl, referenceUrls, maxRef, ins);
          const { primary, references, promptOverride } = built;
          if (!primary) {
            onLog?.('warn', `底部快捷栏：跳过「${m.label}」（主图无可用图片）`);
            continue;
          }
          if (!promptOverride && references.length === 0) {
            onLog?.('warn', `底部快捷栏：跳过「${m.label}」（无提示词且无参考图）`);
            continue;
          }

          const probe = attachInitialVgpToNewAsset({
            id: '__qc_probe__',
            original: primary,
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
            const startsAsVideoTask = m.category === 'generate_video';
            newAssets.push(
              attachInitialVgpToNewAsset({
                id: newId,
                original: primary,
                displayKey: 'original',
                results: {},
                resultOrder: [],
                archived: false,
                hiddenInGrid: !startsAsVideoTask,
                createdAt: Date.now(),
              })
            );
            newTasks.push({
              id: uuid(),
              assetId: newId,
              actionType: m.id,
              inputImage: primary,
              addedAt: Date.now(),
              inputSourceDisplayKey: 'original',
              ...(references.length > 0 ? { inputImages: references } : {}),
              ...(promptOverride ? { promptOverride } : {}),
              ...taskOverrides,
            });
          }
        }
      }

      if (newTasks.length === 0) {
        onLog?.('warn', '底部快捷栏：未能创建任何任务（请检查能力与提示词）');
        lastQuickComposeTaskAssetByIdRef.current = {};
        return [];
      }
      return await enqueueQuickComposeBatch(newAssets, newTasks);
    }

    /** 无拖入预设：按快捷条「文 / 图 / 3D」内置逻辑，不读侧栏默认能力或「上次预设」 */
    const plainLog: WorkflowPendingTask['logContext'] = 'quick_compose_bar_plain';
    const plainText = effectiveUserText;
    const textureRewriteTargetForInput = (src: string): WorkflowPendingTask['modelPbrTextureRewriteTarget'] => {
      const cleanSrc = String(src || '').trim();
      if (!cleanSrc) return undefined;
      return quickComposeMainDropSlotsRef.current.find(
        (slot) => slot.modelPbrTextureRewriteTarget && String(slot.previewSrc || '').trim() === cleanSrc
      )?.modelPbrTextureRewriteTarget;
    };

    const runPlainBatch = (newAssets: WorkflowAsset[], newTasks: WorkflowPendingTask[]): Promise<string[]> =>
      enqueueQuickComposeBatch(newAssets, newTasks);

    if (composeMode === 'text') {
      if (invoke?.allowVisionText && imgsAll.length > 0) {
        if (!plainText && !userText) {
          onLog?.('warn', '项目 Agent：请先输入要询问图片的问题');
          return [];
        }
        const plainMod = getQuickComposePlainModule(QUICK_COMPOSE_PLAIN_I2T_ACTION_ID)!;
        const taskOverrides = buildQuickComposeGenOverrides(plainMod);
        const priorThreadMessages = workspaceQuickComposeThreadRef.current?.messages ?? [];
        const currentTurnText = userText.trim() || plainText;
        const textForModel = resolvePlainTextPromptForModel({
          currentTurnText,
          priorMessages: priorThreadMessages,
          pseudoMultiTurnPrompt: invoke?.pseudoMultiTurnPrompt,
          skipThreadContextInject: invoke?.skipThreadContextInject,
        });
        const body = clampWorkflowTextBody(textForModel);
        const newId = uuid();
        const asset = attachInitialVgpToNewAsset({
          id: newId,
          original: '',
          displayKey: 'original',
          results: {},
          resultOrder: [],
          archived: false,
          hiddenInGrid: true,
          createdAt: Date.now(),
          assetKind: 'text',
          textTitle: '',
          textBody: body,
        });
        const task = buildPendingTaskFromAssetSnapshot(asset, newId, QUICK_COMPOSE_PLAIN_I2T_ACTION_ID, {
          ...taskOverrides,
          logContext: plainLog,
        });
        if (!task) return [];
        task.inputImage = imgsAll[0]!;
        task.inputText = body;
        if (invoke?.inputContext) task.inputContext = invoke.inputContext;
        if (imgsAll.length > 1) task.inputImages = imgsAll.slice(1);
        return await runPlainBatch([asset], [task]);
      }
      if (imgsAll.length > 0) {
        onLog?.('warn', '底部快捷栏：「文」模式请以 @ 引用文字资产，或切换到「图」');
        return [];
      }
      if (!plainText) {
        onLog?.('warn', '底部快捷栏：请输入文字');
        return [];
      }
      const plainMod = getQuickComposePlainModule(QUICK_COMPOSE_PLAIN_TEXT_ACTION_ID)!;
      const taskOverrides = buildQuickComposeGenOverrides(plainMod);
      const countN = quickComposeCountForMod(plainMod);
      if (
        countN > WORKFLOW_GROUP_GENERATE_CONFIRM_THRESHOLD &&
        typeof window !== 'undefined' &&
        !window.confirm(`当前生成数量为 ${countN}，将创建大量任务，是否继续？`)
      ) {
        return [];
      }
      // 文工具：非 Agent 注入近期轮次；Agent 已由 runtime B 层写入 override，勿双注入
      const priorThreadMessages = workspaceQuickComposeThreadRef.current?.messages ?? [];
      const currentTurnText = userText.trim() || plainText;
      const textForModel = resolvePlainTextPromptForModel({
        currentTurnText,
        priorMessages: priorThreadMessages,
        pseudoMultiTurnPrompt: invoke?.pseudoMultiTurnPrompt,
        skipThreadContextInject: invoke?.skipThreadContextInject,
      });
      const body = clampWorkflowTextBody(textForModel);
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
          hiddenInGrid: true,
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
      return await runPlainBatch(newAssets, newTasks);
    }

    if (composeMode === '3d') {
      const mod3d =
        actionModules.find((m) => m.category === 'generate_3d' && m.enabled !== false) ??
        capabilityPresets.find((m) => m.category === 'generate_3d' && m.enabled !== false) ??
        null;
      if (!mod3d) {
        onLog?.('warn', '底部快捷栏：未找到已启用的「生成3D」能力，请先在能力区添加并启用');
        return [];
      }
      if (imgsAll.length === 0) {
        onLog?.('warn', '底部快捷栏：生成 3D 请 @ 引用图片资产');
        return [];
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
      return await runPlainBatch([newAsset], [newTask]);
    }

    if (composeMode === 'video') {
      const videoMod = getQuickComposePlainModule(QUICK_COMPOSE_PLAIN_VIDEO_ACTION_ID)!;
      const taskOverrides = buildQuickComposeGenOverrides(videoMod);
      if (!plainText && imgsAll.length === 0) {
        onLog?.('warn', '底部快捷栏：生视频需要文字描述或 @ 图片');
        return [];
      }
      const primary = imgsAll[0] || '';
      const newId = uuid();
      const newAsset = attachInitialVgpToNewAsset({
        id: newId,
        original: primary,
        displayKey: 'original',
        results: {},
        resultOrder: [],
        archived: false,
        hiddenInGrid: false,
        createdAt: Date.now(),
        ...(primary ? {} : { assetKind: 'text' as const, textTitle: '', textBody: clampWorkflowTextBody(plainText) }),
      });
      const newTask: WorkflowPendingTask = {
        id: uuid(),
        assetId: newId,
        actionType: QUICK_COMPOSE_PLAIN_VIDEO_ACTION_ID,
        inputImage: primary,
        addedAt: Date.now(),
        inputSourceDisplayKey: 'original',
        ...(plainText ? { inputText: clampWorkflowTextBody(plainText), promptOverride: plainText } : {}),
        ...(imgsAll.length > 1 ? { inputImages: imgsAll.slice(1) } : {}),
        ...taskOverrides,
        logContext: plainLog,
      };
      return await runPlainBatch([newAsset], [newTask]);
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
      return [];
    }

    if (imgsAll.length === 0) {
      if (!plainText) {
        onLog?.('warn', '底部快捷栏：文生图请输入画面描述');
        return [];
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
      return await runPlainBatch(newAssets, newTasks);
    }

    const maxRef = maxReferenceImagesForImageModel(plainImgMod.imageModelRegistryId ?? plainImgMod.imageGear);
    const plainMainUrls = mainUrls.length > 0 ? mainUrls : [imgsAll[0]!];
    const plainRefUrls = mainUrls.length > 0 ? referenceUrls : imgsAll.slice(1);
    const totalPlainPlanned = plainMainUrls.length * countN;
    if (
      totalPlainPlanned > WORKFLOW_GROUP_GENERATE_CONFIRM_THRESHOLD &&
      typeof window !== 'undefined' &&
      !window.confirm(`当前将创建 ${totalPlainPlanned} 条队列任务，是否继续？`)
    ) {
      return [];
    }

    const reuseIds = [
      ...(invoke?.reuseAssetIds ?? []),
      ...(invoke?.reuseAssetId ? [invoke.reuseAssetId] : []),
    ]
      .map((id) => id.trim())
      .filter(Boolean)
      .filter((id, index, arr) => arr.indexOf(id) === index);
    if (reuseIds.length > 0) {
      const targets = reuseIds
        .map((id) => findLiveAsset(id))
        .filter((a): a is WorkflowAsset => Boolean(a));
      if (targets.length !== reuseIds.length || targets.some((a) => !assetLightboxRasterEligible(a))) {
        onLog?.('warn', '底部快捷栏：无法将任务挂到指定资产');
        return [];
      }
      const newTasks: WorkflowPendingTask[] = [];
      for (const target of targets) {
        const targetMainUrl = getAssetComposeInputImage(target).trim();
        if (!targetMainUrl) continue;
        const built = buildQuickComposeTaskPromptOverride(effectiveUserText, targetMainUrl, plainRefUrls, maxRef);
        const { primary, references, promptOverride } = built;
        for (let i = 0; i < countN; i += 1) {
          newTasks.push({
            id: uuid(),
            assetId: target.id,
            actionType: QUICK_COMPOSE_PLAIN_I2I_ACTION_ID,
            inputImage: primary || targetMainUrl,
            addedAt: Date.now(),
            inputSourceDisplayKey: target.displayKey,
            ...(references.length > 0 ? { inputImages: references } : {}),
            ...(promptOverride || plainText ? { promptOverride: promptOverride || plainText } : {}),
            ...taskOverrides,
            logContext: plainLog,
          });
        }
      }
      if (newTasks.length === 0) return [];
      rememberTaskAssetById(newTasks);
      // 闲时也先入 pending：挡住 executePending 积分闸门 await 窗口内的 orphan 误报
      setPending((prev) => [...prev, ...newTasks]);
      if (!executing) {
        void executePending([...newTasks, ...pendingRef.current]);
      }
      if (!invoke?.preserveBottomBarDraft) {
        setQuickComposeSegmentsTracked([newQuickComposeTextSegment('')]);
        setQuickComposeMainDropSlots([]);
        setQuickComposeReferenceDropSlots([]);
      }
      setQuickComposePromptCards([]);
      onLog?.('info', '底部快捷栏：已加入执行队列');
      return newTasks.map((t) => t.id);
    }
    const newAssets: WorkflowAsset[] = [];
    const newTasks: WorkflowPendingTask[] = [];
    for (const mainUrl of plainMainUrls) {
      const built = buildQuickComposeTaskPromptOverride(effectiveUserText, mainUrl, plainRefUrls, maxRef);
      const { primary, references, promptOverride } = built;
      const textureRewriteTarget = textureRewriteTargetForInput(mainUrl);
      if (!primary) continue;
      for (let i = 0; i < countN; i += 1) {
        const newId = uuid();
        newAssets.push(
          attachInitialVgpToNewAsset({
            id: newId,
            original: primary,
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
          inputImage: primary,
          addedAt: Date.now(),
          inputSourceDisplayKey: 'original',
          ...(references.length > 0 ? { inputImages: references } : {}),
          ...(promptOverride || plainText ? { promptOverride: promptOverride || plainText } : {}),
          ...(textureRewriteTarget ? { modelPbrTextureRewriteTarget: textureRewriteTarget } : {}),
          ...taskOverrides,
          logContext: plainLog,
        });
      }
    }
    return await runPlainBatch(newAssets, newTasks);
  }, [
    quickComposeMode,
    quickComposePromptCards,
    getQuickComposeMaxRefs,
    getComposeAssets,
    getAssetComposeInputImage,
    findLiveAsset,
    getAssetDisplayImage,
    quickComposeImageModel,
    quickComposeTextModel,
    quickComposeVideoModel,
    quickComposeDefaultVideoModel,
    quickComposeVideoDuration,
    quickComposeVideoAspect,
    quickComposeVideoResolution,
    quickComposeVideoMotion,
    quickComposeModel3dModel,
    quickComposeDefaultModel3d,
    quickComposeModel3dQuality,
    quickComposeModel3dGeometryQuality,
    quickComposeModel3dTextureQuality,
    quickComposeModel3dFormat,
    quickComposeModel3dTexture,
    quickComposeModel3dPbr,
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
    buildQuickComposeAgentSurface,
    fileSourceApi,
    enqueueWorkshopGenerationBatch,
  ]);

  const resolveQuickComposeMod = useCallback(
    (presetId: string) =>
      actionModules.find((m) => m.id === presetId) ??
      capabilityPresets.find((p) => p.id === presetId) ??
      null,
    [actionModules, capabilityPresets]
  );

  useEffect(() => {
    const thread = workspaceQuickComposeThread;
    if (!thread) return;
    const statusCtx = {
      pending,
      executingQueue,
      activeTaskIds,
      completedTaskIds,
      assetErrors,
      cancelledTaskIds: cancelledTaskIdsRef.current,
      resolveModule: resolveQuickComposeMod,
      resolveAssetById: (assetId: string) => findLiveAsset(assetId) ?? null,
      assetCatalogEmpty: workshopDiskOpen ? workshopFileAssets.length === 0 : assets.length === 0,
    };
    const statusPatched = patchQuickComposeThreadMessageStatuses(thread, statusCtx);
    let childRunsChanged = false;
    const nextMessages = statusPatched.map((m) => {
      if (!m.childRuns?.length) return m;
      const childRuns = patchChildRunsFromTasks(m.childRuns as AgentChildRun[], {
        ...statusCtx,
        taskAssetById: m.taskAssetById,
        messageStatus: m.status,
        messageErrorMessage: m.errorMessage,
      });
      if (childRuns === m.childRuns) return m;
      childRunsChanged = true;
      return { ...m, childRuns };
    });
    if (statusPatched === thread.messages && !childRunsChanged) return;
    setWorkspaceQuickComposeThread((prev) => {
      if (!prev || prev.id !== thread.id) return prev;
      const next: ProjectAgentThread = { ...prev, messages: nextMessages, updatedAt: Date.now() };
      const storeKey: ProjectAgentThreadStoreKey = {
        userId: preferenceScope,
        workspaceProjectId: prev.workspaceProjectId,
      };
      const persist = saveProjectAgentThread(storeKey, next);
      if (!persist.ok) {
        onLog?.('warn', '本地存储空间不足，对话未能完整保存');
        scheduleProjectAgentThreadBackup(
          { userId: storeKey.userId, workspaceProjectId: storeKey.workspaceProjectId },
          next
        );
        return next;
      }
      const persisted = persist.thread;
      if (persisted.messages.length !== next.messages.length) {
        onLog?.('warn', '本地存储空间不足，已裁剪对话…');
        stashMessagesDroppedFromHot(storeKey, next.messages, persisted.messages);
        scheduleProjectAgentThreadBackup(
          { userId: storeKey.userId, workspaceProjectId: storeKey.workspaceProjectId },
          persisted
        );
        return persisted;
      }
      scheduleProjectAgentThreadBackup(
        { userId: storeKey.userId, workspaceProjectId: storeKey.workspaceProjectId },
        persisted
      );
      return next;
    });
  }, [
    workspaceQuickComposeThread,
    pending,
    executingQueue,
    activeTaskIds,
    completedTaskIds,
    assetErrors,
    // 资产 hydrate / 文结果写入后需重算，避免默认打开误报红、结果不回写
    assets,
    preferenceScope,
    resolveQuickComposeMod,
    onLog,
  ]);

  const quickComposeCreditOverrides = useMemo(
    () =>
      quickComposeUnderstand
        ? { overrideSkipUnderstand: overrideSkipUnderstandFromUnderstandEnabled(true) }
        : undefined,
    [quickComposeUnderstand]
  );

  const quickComposePlan = useMemo(() => {
    const modeForBilling: 'text' | 'image' | '3d' =
      quickComposeMode === 'auto'
        ? resolveComposerMode(
            buildProjectAgentIntent({
              text: quickComposeDraft,
              mode: 'auto',
              mainAssetId: quickComposeMainDropSlots[0]?.assetId,
              referenceAssetIds: quickComposeReferenceDropSlots
                .map((s) => s.assetId)
                .filter((id): id is string => Boolean(id?.trim())),
              hasEnabled3dPreset: Boolean(
                actionModules.some((m) => m.category === 'generate_3d' && m.enabled !== false) ||
                  capabilityPresets.some((m) => m.category === 'generate_3d' && m.enabled !== false)
              ),
              surface: buildQuickComposeAgentSurface(),
            })
          )
        : quickComposeMode;
    return planQuickComposeRoutes({
      mode: modeForBilling,
      promptCards: quickComposePromptCards,
      resolveModule: resolveQuickComposeMod,
      imageModelRegistryId: quickComposeImageModel,
      textModelRegistryId: quickComposeTextModel,
      overrides: quickComposeCreditOverrides,
    });
  }, [
    quickComposeMode,
    quickComposeDraft,
    quickComposeMainDropSlots,
    quickComposeReferenceDropSlots,
    actionModules,
    capabilityPresets,
    quickComposePromptCards,
    resolveQuickComposeMod,
    quickComposeImageModel,
    quickComposeTextModel,
    quickComposeCreditOverrides,
    buildQuickComposeAgentSurface,
  ]);

  const quickComposeCreditsBypass = !requiresPlatformCredits(quickComposePlan);

  const { serverMinCredits: quickComposeServerMin, quoteLoading: quickComposeQuoteLoading } =
    useUsageQuoteForSteps(quickComposeCreditsBypass ? [] : quickComposePlan);

  const quickComposeSubmitGate = quickComposeCreditsBypass
    ? { blocked: false as const, estimatedMinCredits: 0 }
    : isSubmitBlockedForPlatformPlan(
        quickComposePlan,
        preferenceScope,
        creditBalance,
        creditBalanceLoading || quickComposeQuoteLoading,
        { minCreditsOverride: quickComposeServerMin }
      );
  const quickComposeSubmitDisabled = quickComposeSubmitGate.blocked;
  const quickComposeSubmitDisabledReason = quickComposeSubmitGate.reason;
  const quickComposeChatCreditsHardBlocked = shouldHardBlockComposerCredits({
    creditsBlocked: quickComposeSubmitDisabled,
    creditsBypass: quickComposeCreditsBypass,
    userId: preferenceScope,
    balance: creditBalance,
    balanceLoading: creditBalanceLoading || quickComposeQuoteLoading,
  });

  const submitQuickCompose = useCallback(
    async (invoke?: QuickComposeSubmitInvokeOptions): Promise<string[]> => {
      if (quickComposeSubmitDisabled) {
        onLog?.('warn', quickComposeSubmitDisabledReason ?? creditsExceededUserMessage());
        return [];
      }
      return submitQuickComposeImpl(invoke);
    },
    [quickComposeSubmitDisabled, quickComposeSubmitDisabledReason, onLog, submitQuickComposeImpl]
  );

  const updateProjectAgentThread = useCallback(
    (updater: (prev: ProjectAgentThread) => ProjectAgentThread) => {
      const storeKey = getProjectAgentThreadKey();
      setWorkspaceQuickComposeThread((prev) => {
        if (!prev || !storeKey) return prev;
        const next = updater(prev);
        const persist = saveProjectAgentThread(storeKey, next);
        if (!persist.ok) {
          onLog?.('warn', '本地存储空间不足，对话未能完整保存');
          workspaceQuickComposeThreadRef.current = next;
          scheduleProjectAgentThreadBackup(
            { userId: storeKey.userId, workspaceProjectId: storeKey.workspaceProjectId },
            next
          );
          try {
            maybeCompactProjectAgentThread(storeKey, next);
          } catch {
            /* ignore */
          }
          return next;
        }
        const persisted = persist.thread;
        if (persisted.messages.length !== next.messages.length) {
          onLog?.('warn', '本地存储空间不足，已裁剪对话…');
          stashMessagesDroppedFromHot(storeKey, next.messages, persisted.messages);
          workspaceQuickComposeThreadRef.current = persisted;
          scheduleProjectAgentThreadBackup(
            { userId: storeKey.userId, workspaceProjectId: storeKey.workspaceProjectId },
            persisted
          );
          try {
            maybeCompactProjectAgentThread(storeKey, persisted);
          } catch {
            /* ignore */
          }
          return persisted;
        }
        workspaceQuickComposeThreadRef.current = next;
        scheduleProjectAgentThreadBackup(
          { userId: storeKey.userId, workspaceProjectId: storeKey.workspaceProjectId },
          persisted
        );
        try {
          maybeCompactProjectAgentThread(storeKey, persisted);
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [getProjectAgentThreadKey, onLog]
  );

  const quickComposeThreadHasInFlightAssistant = useCallback((thread: ProjectAgentThread | null) => {
    if (!thread) return false;
    return thread.messages.some(
      (m) =>
        m.role === 'assistant' &&
        m.status != null &&
        m.status !== 'done' &&
        m.status !== 'error'
    );
  }, []);

  const executeAgentPlan = useCallback(
    async (
      intent: ProjectAgentIntent,
      plan: AgentPlannedTool[]
    ): Promise<ProjectAgentExecutePlanResult> => {
      if (!plan.length) {
        return { taskIds: [], errorMessage: 'Empty plan' };
      }
      const mapped = mapPlanToQuickComposeInvoke(
        intent,
        plan,
        (presetId) => {
          const mod =
            actionModules.find((m) => m.id === presetId) ??
            capabilityPresets.find((p) => p.id === presetId) ??
            null;
          if (!mod) return null;
          return {
            label: mod.label || presetId,
            instruction: String(mod.instruction ?? '').trim(),
          };
        },
        () => uuid()
      );

      const expertIds =
        mapped.invokeExpertIds ??
        (mapped.invokeExpertId ? [mapped.invokeExpertId] : []);
      if (expertIds.length > 0) {
        const storeKey = getProjectAgentThreadKey();
        const userId = storeKey?.userId?.trim() || 'guest';
        const workspaceProjectId =
          storeKey?.workspaceProjectId?.trim() || activeWorkspaceProjectId || 'workspace';
        const threadId = workspaceQuickComposeThreadRef.current?.id || 'thread';
        const turnBase = Date.now();
        const textSegments: string[] = [];
        const artifactIds: string[] = [];

        for (let i = 0; i < expertIds.length; i++) {
          const expertId = expertIds[i]!;
          const displayName =
            getExpertProfile(expertId)?.displayName?.trim() || expertId;
          const inv = await invokeExpert({
            expertId,
            userText: intent.text,
            turnId: `expert-${turnBase}-${i}`,
            threadId,
            workspaceProjectId,
            userId,
            textModel: coerceTextModelRegistryId(
              (quickComposeTextModel || '').trim() || DEFAULT_MODEL_TEXT
            ),
            generateText: async ({ system, user, model }) => {
              const prompt = `${system}\n\n${user}`;
              return getDialogTextResponse(
                [{ role: 'user', parts: [{ text: prompt }] }],
                coerceTextModelRegistryId(
                  (model || quickComposeTextModel || '').trim() || DEFAULT_MODEL_TEXT
                )
              );
            },
          });
          if (!inv.ok) {
            return {
              taskIds: [],
              ...(textSegments.length ? { resultText: textSegments.join('\n\n') } : {}),
              ...(artifactIds.length ? { artifactIds } : {}),
              errorMessage:
                inv.errorMessage || `专家「${displayName}」调用失败`,
            };
          }
          if (inv.artifactIds.length) artifactIds.push(...inv.artifactIds);
          const body = (inv.text || '').trim();
          textSegments.push(
            expertIds.length > 1
              ? `【${displayName}】\n${body}`
              : body
          );

          // §17.9 tune three-layer: confirm before Memory/Profile write; skill → Studio
          const proposals = detectExpertTuneProposals(intent, expertId, {
            userId,
            workspaceProjectId,
          });
          for (const proposal of proposals) {
            if (proposal.kind === 'memory' && proposal.memoryDraft) {
              if (window.confirm('将这条偏好记入专家记忆？')) {
                applyConfirmedMemoryProposal(proposal);
              }
            } else if (proposal.kind === 'profilePatch' && proposal.profilePatch) {
              const patch = proposal.profilePatch;
              const diffLines: string[] = [];
              if (patch.mission) diffLines.push(`使命 → ${patch.mission}`);
              if (patch.taboos?.length) {
                diffLines.push(`禁区 → ${patch.taboos.join('、')}`);
              }
              if (patch.styleRules?.length) {
                diffLines.push(`风格 → ${patch.styleRules.join('、')}`);
              }
              const diff =
                diffLines.length > 0 ? `\n${diffLines.join('\n')}` : '';
              if (
                window.confirm(
                  `确认更新「${displayName}」人设？${diff}`
                )
              ) {
                applyExpertProfilePatch(expertId, patch);
              }
            } else if (proposal.kind === 'skillRequest') {
              onLog?.(
                'info',
                '技能申请已记录，请在专家工作室确认'
              );
            }
          }
        }

        return {
          taskIds: [],
          resultText: textSegments.join('\n\n'),
          artifactIds,
        };
      }

      if (mapped.errorMessage && !mapped.useLightboxLocalEdit && !mapped.presetCardsOverride) {
        return { taskIds: [], errorMessage: mapped.errorMessage };
      }
      if (mapped.useLightboxLocalEdit) {
        const ids = (await submitLightboxQuickComposeRef.current()) || [];
        const taskAssetById = Object.fromEntries(
          ids
            .map((id) => [id, lastQuickComposeTaskAssetByIdRef.current[id]] as const)
            .filter(([, assetId]) => typeof assetId === 'string' && assetId.trim())
        );
        return {
          taskIds: ids,
          ...(Object.keys(taskAssetById).length ? { taskAssetById } : {}),
          ...(ids.length === 0 ? { errorMessage: '未能创建局部重绘任务' } : {}),
        };
      }

      const invoke: QuickComposeSubmitInvokeOptions = {
        overrideUserText: mapped.overrideUserText,
        skipPromptCards: mapped.skipPromptCards,
        /** runtime maybeInjectAssembledContext 已写入 intent.text，勿再伪多轮 */
        skipThreadContextInject: true,
        ...(mapped.forceComposeMode ? { forceComposeMode: mapped.forceComposeMode } : {}),
        ...(mapped.preferTextPipelineWhenNoImagesAttached
          ? { preferTextPipelineWhenNoImagesAttached: true }
          : {}),
        ...(mapped.allowVisionText ? { allowVisionText: true } : {}),
        ...(mapped.allowVisionText && projectAgentInlineImageRefsRef.current.length > 0
          ? { overrideImageDataUrls: projectAgentInlineImageRefsRef.current }
          : {}),
        ...(mapped.allowVisionText && projectAgentInlineImageContextRef.current
          ? { inputContext: projectAgentInlineImageContextRef.current }
          : {}),
        ...(mapped.presetCardsOverride ? { presetCardsOverride: mapped.presetCardsOverride } : {}),
        ...(mapped.reuseAssetId ? { reuseAssetId: mapped.reuseAssetId } : {}),
        ...(mapped.reuseAssetIds?.length ? { reuseAssetIds: mapped.reuseAssetIds } : {}),
        ...(mapped.referenceAssetIds?.length ? { referenceAssetIds: mapped.referenceAssetIds } : {}),
      };

      const taskIds = await submitQuickCompose(invoke);
      const taskAssetById = Object.fromEntries(
        taskIds
          .map((id) => [id, lastQuickComposeTaskAssetByIdRef.current[id]] as const)
          .filter(([, assetId]) => typeof assetId === 'string' && assetId.trim())
      );
      return {
        taskIds,
        ...(Object.keys(taskAssetById).length ? { taskAssetById } : {}),
        ...(taskIds.length === 0 ? { errorMessage: mapped.errorMessage || '未能创建任务' } : {}),
      };
    },
    [
      actionModules,
      activeWorkspaceProjectId,
      capabilityPresets,
      getProjectAgentThreadKey,
      onLog,
      quickComposeTextModel,
      submitQuickCompose,
    ]
  );

  const cancelQueuedTaskInBatch = useCallback((taskId: string) => {
    if (!taskId) return;
    cancelledTaskIdsRef.current.add(taskId);
    const ac = taskAbortControllersRef.current.get(taskId);
    if (ac) {
      try {
        ac.abort();
      } catch {
        /* ignore */
      }
      taskAbortControllersRef.current.delete(taskId);
    }
    setCompletedTaskIds((prev) => new Set(prev).add(taskId));
    setPending((prev) => prev.filter((t) => t.id !== taskId));
    setActiveTaskIds((prev) => {
      if (!prev.has(taskId)) return prev;
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  }, [setPending]);

  const cancelProjectAgentTasks = useCallback(
    (taskIds: string[]) => {
      for (const id of taskIds) {
        if (id) cancelQueuedTaskInBatch(id);
      }
    },
    [cancelQueuedTaskInBatch]
  );

  const projectAgentHostPort = useMemo(
    () =>
      createWorkflowProjectAgentHostPort({
        enqueueTasks: (tasks) => {
          if (!tasks.length) return [];
          setPending((prev) => [...prev, ...tasks]);
          return tasks.map((t) => t.id).filter(Boolean);
        },
        getQueueSnapshot: () => ({
          pending: [...pendingRef.current],
          executing: executingQueue?.tasks ? [...executingQueue.tasks] : [],
          assetErrors: Object.fromEntries(assetErrors.entries()),
        }),
        resolveAssetDisplay: (assetId) => {
          const asset = findLiveAsset(assetId);
          if (!asset) return {};
          return {
            previewSrc: getAssetComposeInputImage(asset) || undefined,
            label: workflowAssetMentionLabel(asset),
          };
        },
        reportSurfaceContext: buildQuickComposeAgentSurface,
        executePlan: executeAgentPlan,
        cancelTasks: cancelProjectAgentTasks,
        getThread: () => workspaceQuickComposeThreadRef.current,
        getThreadStoreKey: () => getProjectAgentThreadKey(),
      }),
    [
      assetErrors,
      buildQuickComposeAgentSurface,
      cancelProjectAgentTasks,
      executeAgentPlan,
      executingQueue,
      getAssetDisplayImage,
      getProjectAgentThreadKey,
      setPending,
    ]
  );

  useEffect(() => {
    projectAgentRuntimeRef.current = createProjectAgentRuntime(projectAgentHostPort);
  }, [projectAgentHostPort]);

  const submitQuickComposeWithThread = useCallback(
    async (
      _scope: QuickComposeThreadScope,
      invoke?: QuickComposeSubmitInvokeOptions
    ): Promise<string[]> => {
      void _scope;
      const thread = workspaceQuickComposeThreadRef.current;
      const storeKey = getProjectAgentThreadKey();
      const runtime = projectAgentRuntimeRef.current;
      if (!thread || !storeKey || !runtime) return [];
      if (quickComposeThreadHasInFlightAssistant(thread)) return [];

      const submittedThreadId = thread.id;
      const clearGenerationAtSubmit = quickComposeClearGenerationRef.current;

      const hasCurrentViewMention = quickComposeSegmentsRef.current.some(
        (s) => s.type === 'mention' && s.mention.kind === 'current_view'
      );
      const currentViewDataUrlForAgent = (() => {
        if (!hasCurrentViewMention) return '';
        try {
          const layout = lightboxPreviewLayoutRef.current;
          if (layout === 'pano') {
            const s = lightboxPanoViewerRef.current?.captureViewDataUrl('image/png');
            if (s && String(s).trim().startsWith('data:image/')) return String(s).trim();
          } else if (layout === 'heightfield' || layout === 'model3d') {
            const s = lightboxWebPreviewCaptureApiRef.current?.captureCurrentViewAsDataUrl();
            if (s && String(s).trim().startsWith('data:image/')) return String(s).trim();
          }
        } catch {
          /* fall back to the active asset preview */
        }
        const id = lightboxAssetIdRef.current;
        const asset = id ? findLiveAsset(id) : null;
        return asset ? getAssetComposeInputImage(asset).trim() : '';
      })();
      projectAgentInlineImageContextRef.current =
        hasCurrentViewMention && currentViewDataUrlForAgent
          ? {
              source: 'current_view',
              ...(lightboxAssetIdRef.current ? { assetId: String(lightboxAssetIdRef.current).trim() } : {}),
              ...(lightboxAssetIdRef.current
                ? {
                    displayKey:
                      assetsRef.current.find((a) => a.id === String(lightboxAssetIdRef.current).trim())?.displayKey ||
                      undefined,
                  }
                : {}),
              mimeType: 'image/png',
            }
          : null;

      const resolved = resolveQuickComposeReferences({
        segments: quickComposeSegmentsRef.current,
        mainDropSlots: quickComposeMainDropSlotsRef.current,
        referenceDropSlots: quickComposeReferenceDropSlotsRef.current,
        assets: getComposeAssets(),
        getAssetDisplayImage: getAssetComposeInputImage,
        maxRefs: getQuickComposeMaxRefs(),
        currentViewDataUrl: currentViewDataUrlForAgent || undefined,
      });
      const queues = resolveQuickComposeImageQueues({
        mainDropSlots: quickComposeMainDropSlotsRef.current,
        referenceDropSlots: quickComposeReferenceDropSlotsRef.current,
        assets: getComposeAssets(),
        getAssetDisplayImage: getAssetComposeInputImage,
        maxRefs: getQuickComposeMaxRefs(),
      });
      const promptText = buildQuickComposePromptOverride(
        resolved.userPrompt,
        resolved.referenceContextBlock
      );
      const currentUserText = (invoke?.overrideUserText ?? promptText).trim();
      projectAgentInlineImageRefsRef.current = resolved.refs.filter((src) => String(src || '').trim());
      const skipCards = invoke?.skipPromptCards === true;
      const presetIds = (
        skipCards ? [] : quickComposePromptCards.map((c) => c.presetId)
      ).filter(Boolean);
      const agentMentions: AgentMentionRef[] = mentionsFromSegments(
        quickComposeSegmentsRef.current
      ).reduce<AgentMentionRef[]>((acc, m) => {
        if (m.kind === 'expert') {
          acc.push({ kind: 'expert', id: m.expertId, label: m.label });
          return acc;
        }
        if (m.kind === 'asset') {
          acc.push({ kind: 'asset', id: m.assetId, label: m.label });
          return acc;
        }
        return acc;
      }, []);
      const assetMentionIds = agentMentions
        .filter((m) => m.kind === 'asset')
        .map((m) => m.id.trim())
        .filter(Boolean)
        .filter((id, index, arr) => arr.indexOf(id) === index);
      const hasExpertMention = agentMentions.some((m) => m.kind === 'expert');
      const hasAssetContext =
        assetMentionIds.length > 0 || selectedAssetIds.size > 0 || Boolean(lightboxAssetIdRef.current);
      if (!currentUserText && presetIds.length === 0 && !hasExpertMention && !hasAssetContext) return [];

      const surface = buildQuickComposeAgentSurface();
      const selectedTargetIds =
        surface.kind === 'canvas'
          ? surface.selectedAssetIds.map((id) => id.trim()).filter(Boolean)
          : surface.kind === 'lightbox'
            ? [surface.assetId.trim()].filter(Boolean)
            : [];
      const targetAssetIds =
        selectedTargetIds.length > 0
          ? selectedTargetIds
          : assetMentionIds[0]
            ? [assetMentionIds[0]]
            : [];
      const referenceAssetIds =
        selectedTargetIds.length > 0
          ? assetMentionIds.filter((id) => !targetAssetIds.includes(id))
          : assetMentionIds.slice(1);
      const hasEnabled3dPreset = Boolean(
        actionModules.some((m) => m.category === 'generate_3d' && m.enabled !== false) ||
          capabilityPresets.some((m) => m.category === 'generate_3d' && m.enabled !== false)
      );
      const perceptionContext = buildQuickComposePerceptionContext();
      const intent = buildProjectAgentIntent({
        text: currentUserText,
        mode: quickComposeMode,
        presetIds,
        mentions: agentMentions,
        surface,
        mainAssetId: targetAssetIds[0] || undefined,
        referenceAssetIds,
        hasInlineImageRefs: resolved.refs.length > 0,
        hasEnabled3dPreset,
        enabledSkills: enabledProjectAgentSkills,
        perception: perceptionContext,
        textModel: quickComposeTextModel,
        imageSettings: {
          model: quickComposeImageModel,
          aspectRatio: quickComposeAspect,
          size: quickComposeSize,
          count: quickComposeCount,
          understandingEnabled: quickComposeUnderstand,
        },
      });

      // 先落气泡再 await（专家真 LLM 等可能较慢，避免「点了没反应」）
      const attachmentAssetIds = collectQuickComposeAttachmentAssetIds({
        segments: quickComposeSegmentsRef.current,
        mainDropSlots: quickComposeMainDropSlotsRef.current,
        referenceDropSlots: quickComposeReferenceDropSlotsRef.current,
        lightboxAssetId: lightboxAssetIdRef.current,
      });
      const now = Date.now();
      const presetLabels = (
        skipCards ? [] : quickComposePromptCards.map((c) => c.label.trim()).filter(Boolean)
      );
      const expertLabels = agentMentions
        .filter((m) => m.kind === 'expert')
        .map((m) => (m.label || m.id).trim())
        .filter(Boolean);
      const plannedPreview = planTools(intent);
      const previewPlan = plannedPreview.ok ? plannedPreview.plan : [];
      const previewPlanText = plannedPreview.ok
        ? formatPlanTemplate(previewPlan, perceptionContext)
        : '计划：处理中…';
      const userVisibleText = (() => {
        const base = currentUserText.trim();
        if (presetLabels.length === 0) {
          if (base) return base;
          if (expertLabels.length) return `@${expertLabels.join(' @')}`;
          return previewPlanText || '(空)';
        }
        const tag =
          presetLabels.length === 1
            ? `使用能力：${presetLabels[0]}`
            : `使用能力：${presetLabels.join('、')}`;
        return base ? `${base}\n${tag}` : tag;
      })();
      const assistantPlanText = (() => {
        if (presetLabels.length === 1) return `计划：运行「${presetLabels[0]}」`;
        if (presetLabels.length > 1) return `计划：运行预设×${presetLabels.length}`;
        return previewPlanText || '计划：已提交';
      })();
      const userMessageId = uuid();
      const assistantMessageId = uuid();
      const shouldAttachChildRuns =
        previewPlan.length > 1 || previewPlan.some((p) => p.toolId === 'invoke_expert');
      const optimisticChildRuns = shouldAttachChildRuns
        ? buildChildRunsFromPlan(previewPlan, {
            parentMessageId: assistantMessageId,
            now: now + 1,
          })
        : undefined;
      const userMessage: QuickComposeThreadMessage = {
        id: userMessageId,
        role: 'user',
        text: userVisibleText,
        timestamp: now,
        status: 'submitted',
        ...(attachmentAssetIds.length ? { assetIds: attachmentAssetIds } : {}),
      };
      const optimisticAssistant: QuickComposeThreadMessage = {
        id: assistantMessageId,
        role: 'assistant',
        text: assistantPlanText,
        timestamp: now + 1,
        status: 'running',
        ...(previewPlan.length
          ? {
              planSteps: previewPlan.map((p) => ({
                label: String(p.label || '').trim() || p.toolId,
                toolId: p.toolId,
              })),
            }
          : {}),
        ...(optimisticChildRuns?.length ? { childRuns: optimisticChildRuns } : {}),
      };
      updateProjectAgentThread((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage, optimisticAssistant],
        updatedAt: Date.now(),
      }));
      // 立刻清空输入，让用户感知已发送（intent 已快照，不依赖 segments）
      setQuickComposeSegmentsTracked([newQuickComposeTextSegment('')]);

      let result: Awaited<ReturnType<typeof runtime.submitTurn>>;
      try {
        result = await runtime.submitTurn({
          turnId: uuid(),
          threadId: thread.id,
          workspaceProjectId: storeKey.workspaceProjectId,
          intent,
        });
      } catch (err) {
        const msg =
          err instanceof Error && err.message.trim()
            ? err.message.trim()
            : '专家调用异常';
        updateProjectAgentThread((prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  status: 'error' as const,
                  errorMessage: msg,
                  text: msg,
                }
              : m
          ),
          updatedAt: Date.now(),
        }));
        onLog?.('error', msg);
        return [];
      }

      // 清空对话竞态：await 期间若已清空，勿把消息写回新热线程
      const clearedDuringSubmit =
        clearGenerationAtSubmit !== quickComposeClearGenerationRef.current ||
        workspaceQuickComposeThreadRef.current?.id !== submittedThreadId;
      if (clearedDuringSubmit) {
        const orphanTaskIds = (result.taskIds ?? []).filter(Boolean);
        if (orphanTaskIds.length) {
          runtime.cancelInFlight({ taskIds: orphanTaskIds });
          cancelProjectAgentTasks(orphanTaskIds);
        }
        return [];
      }

      const failed =
        !result.ok ||
        (result.taskIds.length === 0 && !String(result.resultText || '').trim());
      const immediateResult = String(result.resultText || '').trim();
      const assistantStatus = failed ? 'error' : immediateResult ? 'done' : 'queued';
      const assistantError = failed
        ? result.errorMessage?.trim() || '未能创建任务'
        : undefined;
      const finalPlan = result.plan?.length ? result.plan : previewPlan;
      const finalPlanText = (() => {
        if (presetLabels.length === 1) return `计划：运行「${presetLabels[0]}」`;
        if (presetLabels.length > 1) return `计划：运行预设×${presetLabels.length}`;
        return result.planText || result.errorMessage || assistantPlanText;
      })();
      let childRuns =
        (finalPlan.length > 1 || finalPlan.some((p) => p.toolId === 'invoke_expert'))
          ? buildChildRunsFromPlan(finalPlan, {
              parentMessageId: assistantMessageId,
              taskIds: result.taskIds,
              now: Date.now(),
            })
          : undefined;
      if (childRuns?.length && (failed || immediateResult)) {
        childRuns = patchChildRunsFromTasks(childRuns, {
          pending: [],
          executingQueue: null,
          activeTaskIds: new Set(),
          completedTaskIds: new Set(),
          assetErrors: new Map(),
          cancelledTaskIds: new Set(),
          resolveModule: () => null,
          messageStatus: assistantStatus,
          messageErrorMessage: assistantError,
          now: Date.now(),
        });
      }
      updateProjectAgentThread((prev) => ({
        ...prev,
        messages: prev.messages.map((m) => {
          if (m.id !== assistantMessageId) return m;
          const next: QuickComposeThreadMessage = {
            ...m,
            text: failed ? result.errorMessage || finalPlanText : finalPlanText,
            status: assistantStatus,
            taskIds: result.taskIds,
            ...(finalPlan.length
              ? {
                  planSteps: finalPlan.map((p) => ({
                    label: String(p.label || '').trim() || p.toolId,
                    toolId: p.toolId,
                  })),
                }
              : {}),
            ...(childRuns?.length ? { childRuns } : {}),
            ...(result.taskAssetById && Object.keys(result.taskAssetById).length
              ? { taskAssetById: result.taskAssetById }
              : {}),
          };
          if (immediateResult) next.resultText = immediateResult;
          else delete next.resultText;
          if (assistantError) next.errorMessage = assistantError;
          else delete next.errorMessage;
          return next;
        }),
        updatedAt: Date.now(),
      }));
      return result.taskIds;
    },
    [
      actionModules,
      buildQuickComposeAgentSurface,
      buildQuickComposePerceptionContext,
      cancelProjectAgentTasks,
      capabilityPresets,
      enabledProjectAgentSkills,
      getAssetDisplayImage,
      getProjectAgentThreadKey,
      getQuickComposeMaxRefs,
      quickComposeAspect,
      quickComposeCount,
      quickComposeImageModel,
      quickComposeMode,
      quickComposePromptCards,
      quickComposeSize,
      quickComposeTextModel,
      quickComposeUnderstand,
      quickComposeThreadHasInFlightAssistant,
      onLog,
      selectedAssetIds,
      setQuickComposeSegmentsTracked,
      updateProjectAgentThread,
    ]
  );

  const quickComposeHasAttachedImages = useCallback((): boolean => {
    const maxRefs = getQuickComposeMaxRefs();
    const resolved = resolveQuickComposeReferences({
      segments: quickComposeSegmentsRef.current,
      mainDropSlots: quickComposeMainDropSlotsRef.current,
      referenceDropSlots: quickComposeReferenceDropSlotsRef.current,
      assets: getComposeAssets(),
      getAssetDisplayImage: getAssetComposeInputImage,
      maxRefs,
    });
    const queues = resolveQuickComposeImageQueues({
      mainDropSlots: quickComposeMainDropSlotsRef.current,
      referenceDropSlots: quickComposeReferenceDropSlotsRef.current,
      assets: getComposeAssets(),
      getAssetDisplayImage: getAssetComposeInputImage,
      maxRefs,
    });
    const hasUrl = (s: string) => String(s || '').trim().length > 0;
    return (
      queues.mainUrls.some(hasUrl) ||
      queues.referenceUrls.some(hasUrl) ||
      resolved.refs.some(hasUrl)
    );
  }, [getAssetComposeInputImage, getComposeAssets, getQuickComposeMaxRefs]);

  const handleQuickComposeChatSend = useCallback(() => {
    if (quickComposeChatSendGuardRef.current) return;
    const thread = workspaceQuickComposeThreadRef.current;
    if (!thread) return;
    if (quickComposeThreadHasInFlightAssistant(thread)) return;
    if (quickComposeChatCreditsHardBlocked) {
      onLog?.('warn', quickComposeSubmitDisabledReason ?? creditsExceededUserMessage());
      return;
    }
    if (isAiTaskBusy()) {
      onLog?.('warn', '当前有 AI 任务执行中，请等待完成后再发送');
      return;
    }
    quickComposeChatSendGuardRef.current = true;
    void (async () => {
      try {
        // Include prompt cards when present (A+C); otherwise plan from mode chip.
        await submitQuickComposeWithThread('workspace', {
          ...(quickComposePromptCards.length === 0 ? { skipPromptCards: true } : {}),
          preferTextPipelineWhenNoImagesAttached: !quickComposeHasAttachedImages(),
        });
      } finally {
        quickComposeChatSendGuardRef.current = false;
      }
    })();
  }, [
    quickComposeHasAttachedImages,
    quickComposePromptCards.length,
    quickComposeChatCreditsHardBlocked,
    quickComposeSubmitDisabledReason,
    quickComposeThreadHasInFlightAssistant,
    onLog,
    submitQuickComposeWithThread,
    getProjectAgentThreadKey,
  ]);

  const handleQuickComposeChatRetry = useCallback(
    (messageId: string) => {
      if (quickComposeChatSendGuardRef.current) return;
      const thread = workspaceQuickComposeThreadRef.current;
      if (!thread || quickComposeThreadHasInFlightAssistant(thread)) return;
      if (quickComposeChatCreditsHardBlocked) {
        onLog?.('warn', quickComposeSubmitDisabledReason ?? creditsExceededUserMessage());
        return;
      }
      const assistantIdx = thread.messages.findIndex((m) => m.id === messageId);
      if (assistantIdx <= 0) return;
      const assistant = thread.messages[assistantIdx];
      if (!assistant || assistant.role !== 'assistant') return;
      let userText = '';
      for (let i = assistantIdx - 1; i >= 0; i -= 1) {
        const m = thread.messages[i];
        if (m?.role === 'user') {
          // 去掉「使用能力：」展示行，重放用户原句（§16.1 整 turn 重放）
          userText = m.text
            .split('\n')
            .filter((line) => !/^使用能力[：:]/.test(line.trim()))
            .join('\n')
            .trim();
          break;
        }
      }
      if (!userText) return;
      quickComposeChatSendGuardRef.current = true;
      void (async () => {
        try {
          // §16.1：保留失败气泡；新 turnId；尽量带上当前仍挂着的预设卡
          await submitQuickComposeWithThread('workspace', {
            overrideUserText: userText,
            ...(quickComposePromptCards.length === 0 ? { skipPromptCards: true } : {}),
            preferTextPipelineWhenNoImagesAttached: !quickComposeHasAttachedImages(),
          });
        } finally {
          quickComposeChatSendGuardRef.current = false;
        }
      })();
    },
    [
      quickComposeHasAttachedImages,
      quickComposePromptCards.length,
      quickComposeChatCreditsHardBlocked,
      quickComposeSubmitDisabledReason,
      quickComposeThreadHasInFlightAssistant,
      onLog,
      submitQuickComposeWithThread,
    ]
  );

  const handleQuickComposeChatAction = useCallback(
    (messageId: string, action: AgentSuggestedAction) => {
      const perceptionContext = buildQuickComposePerceptionContext();
      const confirmCopy = quickComposeChatActionConfirmCopy({
        kind: action.kind,
        requiresConfirmation:
          action.confirmLevel === 'light' ||
          action.confirmLevel === 'cost' ||
          action.confirmLevel === 'destructive',
        requiresCost: action.confirmLevel === 'cost',
        destructive: action.confirmLevel === 'destructive',
        cost: action.costHint?.estimatedCredits,
        perception: perceptionContext,
      });
      if (confirmCopy && typeof window !== 'undefined' && !window.confirm(confirmCopy)) {
        return;
      }

      if (action.kind === 'retry') {
        handleQuickComposeChatRetry(messageId);
        return;
      }

      if (action.kind === 'save_memory') {
        onLog?.('info', `项目 Agent：已确认「${action.label}」，记忆写入将由服务层接入`);
        return;
      }

      if (
        action.kind === 'reply' ||
        action.kind === 'preview' ||
        action.kind === 'run' ||
        action.kind === 'apply' ||
        action.kind === 'save_preset'
      ) {
        const text = String(action.payload?.text ?? '').trim();
        if (text) {
          setQuickComposeSegmentsTracked([newQuickComposeTextSegment(text)]);
          onLog?.('info', `项目 Agent：已填入「${action.label}」建议，可继续发送`);
        }
        return;
      }

      if (action.kind === 'open_panel') {
        if (action.payload?.panel === 'memory') {
          onLog?.('info', '项目 Agent：已打开记忆管理入口');
        }
        return;
      }

      onLog?.('info', `项目 Agent：动作「${action.label}」将在后续阶段接入`);
    },
    [
      buildQuickComposePerceptionContext,
      handleQuickComposeChatRetry,
      onLog,
      setQuickComposeSegmentsTracked,
    ]
  );

  const handleQuickComposeChatCancel = useCallback(
    (messageId: string) => {
      const thread = workspaceQuickComposeThreadRef.current;
      if (!thread) return;
      const assistant = thread.messages.find((m) => m.id === messageId);
      if (!assistant || assistant.role !== 'assistant') return;
      if (
        assistant.status === 'done' ||
        assistant.status === 'error' ||
        assistant.status == null
      ) {
        return;
      }
      const taskIds = (assistant.taskIds ?? []).filter(Boolean);
      const runtime = projectAgentRuntimeRef.current;
      runtime?.cancelInFlight({ taskIds });
      cancelProjectAgentTasks(taskIds);
      updateProjectAgentThread((prev) => ({
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === messageId
            ? {
                ...m,
                status: 'error' as const,
                errorMessage: PROJECT_AGENT_CANCELLED_MESSAGE,
              }
            : m
        ),
        updatedAt: Date.now(),
      }));
      onLog?.('info', '项目 Agent：已取消当前回合');
    },
    [cancelProjectAgentTasks, onLog, updateProjectAgentThread]
  );

  /** P25：清空/新开 = 确认 → 取消 in-flight → 取消 pending 热备份 → 归档 → 空热 backup */
  const handleQuickComposeClearChat = useCallback(() => {
    const key = getProjectAgentThreadKey();
    if (!key) return;
    if (
      !window.confirm('清空当前对话？旧对话将归档，并开始新的对话。')
    ) {
      return;
    }
    const syncKey = {
      userId: key.userId,
      workspaceProjectId: key.workspaceProjectId,
    };

    // 1) 取消当前 in-flight（与 handleQuickComposeChatCancel 同逻辑；马上 archive 故不标气泡）
    const hot = workspaceQuickComposeThreadRef.current;
    if (hot) {
      const inFlightTaskIds = hot.messages
        .filter(
          (m) =>
            m.role === 'assistant' &&
            m.status != null &&
            m.status !== 'done' &&
            m.status !== 'error'
        )
        .flatMap((m) => m.taskIds ?? [])
        .filter(Boolean);
      if (inFlightTaskIds.length) {
        projectAgentRuntimeRef.current?.cancelInFlight({ taskIds: inFlightTaskIds });
        cancelProjectAgentTasks(inFlightTaskIds);
      }
    }

    // 2) 取消 debounce 中的旧热备份，避免清空后把旧线程写回 thread-hot.json
    cancelPendingProjectAgentHotBackup(syncKey);

    // 3) 若有进行中的 send，递增 generation，让 submit 在 await 后跳过追加
    if (quickComposeChatSendGuardRef.current) {
      quickComposeClearGenerationRef.current += 1;
    }

    // 4) archiveAndReset → set state
    const { archived, next } = archiveAndResetProjectAgentThread(key);
    // 本机归档快照：供「加载更早」拼冷段（云 list 不做）
    saveLocalThreadArchive(key, archived);
    workspaceQuickComposeThreadRef.current = next;
    setWorkspaceQuickComposeThread(next);

    // 5) 归档云备份
    scheduleProjectAgentThreadArchiveBackup(syncKey, archived);
    // 6) 立刻 schedule 空热备份（debounce 可，但必须 schedule）
    scheduleProjectAgentThreadBackup(syncKey, next);

    // 7) onLog
    onLog?.('info', '项目 Agent：已清空对话并归档');
  }, [cancelProjectAgentTasks, getProjectAgentThreadKey, onLog]);

  /** Phase 5C：从本机归档/冷袋拼更早消息进热线程（仍受 80 条热窗口） */
  const handleQuickComposeLoadEarlier = useCallback(() => {
    const key = getProjectAgentThreadKey();
    if (!key) return;
    const hot = workspaceQuickComposeThreadRef.current;
    if (!hot) return;
    if (!hasEarlierMessagesLocal(key, hot)) {
      onLog?.('info', '项目 Agent：没有可加载的更早消息');
      return;
    }
    const { thread, candidateCount } = loadEarlierMessagesIntoHot(key, hot);
    const persist = saveProjectAgentThread(key, thread);
    const next = persist.ok ? persist.thread : thread;
    if (persist.ok && persist.thread.messages.length < thread.messages.length) {
      stashMessagesDroppedFromHot(key, thread.messages, persist.thread.messages);
    }
    workspaceQuickComposeThreadRef.current = next;
    setWorkspaceQuickComposeThread(next);
    scheduleProjectAgentThreadBackup(
      { userId: key.userId, workspaceProjectId: key.workspaceProjectId },
      next
    );
    onLog?.(
      'info',
      `项目 Agent：已尝试加载更早消息（候选 ${candidateCount} 条，热窗口保留 ${next.messages.length} 条）`
    );
  }, [getProjectAgentThreadKey, onLog]);

  /** Phase 5C：导出当前热线程瘦 JSON（无媒体字节） */
  const handleQuickComposeExportChat = useCallback(() => {
    const hot = workspaceQuickComposeThreadRef.current;
    if (!hot) {
      onLog?.('warn', '项目 Agent：当前无对话可导出');
      return;
    }
    downloadProjectAgentThreadSlimJson(hot, hot.workspaceProjectId);
    onLog?.('info', '项目 Agent：已导出对话 JSON');
  }, [onLog]);

  const submitLightboxQuickCompose = useCallback(async (): Promise<string[]> => {
    const id = lightboxAssetIdRef.current;
    const asset = assetsRef.current.find((a) => a.id === id);
    if (!asset || !assetLightboxRasterEligible(asset)) {
      onLog?.('warn', '大图预览：当前无可提交的图像');
      return [];
    }
    const src = getLightboxPreviewImageSrc(asset).trim();
    if (!src) {
      onLog?.('warn', '大图预览：当前无可提交的图像');
      return [];
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
      referenceDropSlots: quickComposeReferenceDropSlotsRef.current,
      assets: getComposeAssets(),
      getAssetDisplayImage: getAssetComposeInputImage,
      maxRefs: getQuickComposeMaxRefs(),
    });
    const refQueues = resolveQuickComposeImageQueues({
      referenceDropSlots: quickComposeReferenceDropSlotsRef.current,
      assets: getComposeAssets(),
      getAssetDisplayImage: getAssetComposeInputImage,
      maxRefs: getQuickComposeMaxRefs(),
    });
    for (const w of [...partialResolved.warnings, ...refQueues.warnings]) {
      onLog?.('warn', `大图预览：${w}`);
    }
    const builtPrompt = buildQuickComposeTaskPromptOverride(
      partialResolved.userPrompt,
      src,
      refQueues.referenceUrls,
      getQuickComposeMaxRefs()
    );
    const promptOverride = builtPrompt.promptOverride;
    const hasCurrentView = segmentsSnap.some((s) => s.type === 'mention' && s.mention.kind === 'current_view');
    const hasAttachedRefs = refQueues.referenceUrls.length > 0 || partialResolved.refs.length > 0;

    if (
      !hasCurrentView &&
      hasAttachedRefs &&
      !needsPanoLocalCapture &&
      !localEditSnapshot
    ) {
      return await submitQuickCompose({
        reuseAssetId: asset.id,
        overrideUserText: promptOverride,
        skipPromptCards: true,
      });
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
      setQuickComposeMainDropSlots([]);
      setQuickComposeReferenceDropSlots([]);
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

    lastQuickComposeTaskAssetByIdRef.current = { [taskId]: asset.id };
    // 闲时也先入 pending：挡住 executePending 积分闸门 await 窗口内的 orphan 误报
    setPending((prev) => [...prev.filter((t) => t.id !== taskId), task]);
    if (!executing) {
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
          referenceDropSlots: quickComposeReferenceDropSlotsRef.current,
          assets: getComposeAssets(),
          getAssetDisplayImage: getAssetComposeInputImage,
          maxRefs: getQuickComposeMaxRefs(),
          currentViewDataUrl: composite,
        });
        const captureRefQueues = resolveQuickComposeImageQueues({
          referenceDropSlots: quickComposeReferenceDropSlotsRef.current,
          assets: getComposeAssets(),
          getAssetDisplayImage: getAssetComposeInputImage,
          maxRefs: getQuickComposeMaxRefs(),
        });
        const extraRefs = [
          ...captureRefQueues.referenceUrls,
          ...fullResolved.refs.filter((r) => r !== composite),
        ].filter((r, i, arr) => arr.indexOf(r) === i);
        const box = lightboxClientImageDeferredRef.current.get(taskId);
        if (box) {
          if (inpaintMerged) box.skipCapabilityExecute = true;
          box.inputImagesForExecute = extraRefs.length > 0 ? extraRefs : undefined;
        }
        resolveClient(composite);
      } catch (e) {
        rejectClient(e);
      }
    })();
    onLog?.('info', '大图预览：已入队（正在生成预览，结果写入当前卡片）');
    return [taskId];
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

  useEffect(() => {
    submitLightboxQuickComposeRef.current = submitLightboxQuickCompose;
  }, [submitLightboxQuickCompose]);

  const addImagesFromFiles = useCallback((files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/')).slice(0, 50);
    if (workshopDiskOpen) {
      if (imageFiles.length) void importWorkshopLocalFiles(imageFiles);
      return;
    }
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
  }, [groupFilterId, importWorkshopLocalFiles, setAssets, scheduleCompanionPersistOriginalAny, workshopDiskOpen]);

  const addVideosFromFiles = useCallback(
    (files: File[]) => {
      const videoFiles = files.filter((f) => isWorkflowVideoFile(f)).slice(0, 50);
      if (workshopDiskOpen) {
        if (videoFiles.length) void importWorkshopLocalFiles(videoFiles);
        return;
      }
      const batchBase = Date.now();
      const n = videoFiles.length;
      const fallbackRatio = clampWorkflowCardAspectRatio(1600, 900);
      videoFiles.forEach((file, fileIdx) => {
        const newId = uuid();
        const blobUrl = URL.createObjectURL(file);
        setCardAspectByAssetId((prev) => (prev[newId] != null ? prev : { ...prev, [newId]: fallbackRatio }));
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
            assetKind: 'video',
            original: blobUrl,
            displayKey: 'original',
            results: {},
            resultOrder: [],
            archived: false,
            hiddenInGrid: false,
            createdAt: batchBase + (n - 1 - fileIdx),
            gridCardAspectRatio: fallbackRatio,
            resultMeta: {
              original: {
                executedAt: Date.now(),
                mediaKind: 'video',
                displayStepLabel: file.name || 'Video',
              },
            },
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

        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          const width = video.videoWidth || 1600;
          const height = video.videoHeight || 900;
          const ratio = clampWorkflowCardAspectRatio(width, height);
          setCardAspectByAssetId((prev) => ({ ...prev, [newId]: ratio }));
          setAssets((prev) => prev.map((x) => (x.id === newId ? { ...x, gridCardAspectRatio: ratio } : x)));
        };
        video.src = blobUrl;

        void (async () => {
          const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
          const base = String(getCompanionLocalBaseUrl() || '').trim();
          if (!pid || !base) {
            onLog?.(
              'warn',
              '本地伴侣未连接',
              '视频仅保存在浏览器会话内，刷新后可能无法预览；请连接本地伴侣以写入项目资产目录。'
            );
            return;
          }
          const put = await putWorkflowOriginalBlobToCompanion(base, pid, newId, file);
          if (put.ok === false) {
            onLog?.('warn', '视频写入本地伴侣失败', put.error);
            return;
          }
          const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, put.key);
          if (got.ok === false) {
            setAssets((prev) =>
              prev.map((x) => (x.id === newId ? { ...x, originalCompanionKey: put.key } : x))
            );
            onLog?.('warn', '视频落盘后读取预览失败', got.error);
            return;
          }
          try {
            URL.revokeObjectURL(blobUrl);
          } catch {
            /* ignore */
          }
          setAssets((prev) =>
            prev.map((x) =>
              x.id === newId
                ? {
                    ...x,
                    original: got.objectUrl,
                    originalCompanionKey: put.key,
                  }
                : x
            )
          );
        })();
      });
    },
    [groupFilterId, importWorkshopLocalFiles, onLog, setAssets, workspaceProjectChrome?.activeProjectId, workshopDiskOpen]
  );

  const addModelsFromFiles = useCallback(
    (files: File[]) => {
      if (workshopDiskOpen) {
        const modelFiles = files.filter((f) => isWorkflowModelFile(f)).slice(0, 50);
        if (modelFiles.length) void importWorkshopLocalFiles(modelFiles);
        return;
      }
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
        const modelFormat = inferWorkflowModelFileFormat(file);
        const placeholder = buildWorkflowModelPlaceholderDataUrl(file.name);
        setCardAspectByAssetId((prev) => (prev[newId] != null ? prev : { ...prev, [newId]: ratio }));
        setAssets((prev) => {
          const parentGroup = groupFilterId ? prev.find((a) => a.id === groupFilterId) : null;
          const newAsset: WorkflowAsset = attachInitialVgpToNewAsset({
            id: newId,
            original: placeholder,
            displayKey: 'original',
            results: {},
            resultOrder: [],
            stepModelUrls: { original: [blobUrl] },
            stepModelFormats: { original: [modelFormat] },
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
        // Capture thumb from local blob BEFORE companion put revokes it; otherwise FBX/GLB load fails
        // and the SVG placeholder ("本地预览") sticks as the card preview.
        void (async () => {
          const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
          const base = String(getCompanionLocalBaseUrl() || '').trim();

          let thumb: string | null = null;
          try {
            thumb = await captureWorkflowModelThumbnailDataUrl({
              modelSrc: blobUrl,
              modelFileName: file.name,
            });
          } catch {
            thumb = null;
          }

          let companionModelUrl = '';
          let companionModelKey = '';
          if (!pid || !base) {
            onLog?.(
              'warn',
              '本地伴侣未连接',
              '3D 模型仅保存在浏览器会话内，刷新后可能无法预览；请在设置中连接本地伴侣以写入卷目录。'
            );
          } else {
            const put = await putWorkflowModelFileToCompanion(base, pid, newId, 0, file);
            if (put.ok === false) {
              onLog?.('warn', '3D 模型写入本地伴侣失败', put.error);
            } else {
              companionModelKey = put.key;
              const got = await fetchWorkflowModelFromCompanionAsObjectUrl(base, pid, put.key, file.name);
              if (got.ok === false) {
                const meta = await getCompanionAssetMeta(base, pid, put.key);
                if (meta.ok && meta.data.onDisk) {
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
                }
                onLog?.('warn', '3D 模型落盘后读取预览失败', got.error);
              } else {
                companionModelUrl = got.objectUrl;
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
                      stepModelFormats: { ...(x.stepModelFormats || {}), original: [modelFormat] },
                    };
                  })
                );
              }
            }
          }

          // Retry capture from companion URL if blob capture failed (queue/load race).
          if (!thumb && companionModelUrl) {
            try {
              thumb = await captureWorkflowModelThumbnailDataUrl({
                modelSrc: companionModelUrl,
                modelFileName: file.name,
              });
            } catch {
              thumb = null;
            }
          }

          if (!thumb) {
            if (companionModelKey) {
              onLog?.('warn', '3D 缩略图截取失败，卡片仍显示占位图', file.name);
            }
            return;
          }

          const thumbRatio = clampWorkflowCardAspectRatio(1280, 800);
          let thumbCompanionKey = '';
          if (pid && base) {
            const putThumb = await putWorkflowOriginalImageToCompanion(base, pid, newId, thumb);
            if (putThumb.ok === false) {
              onLog?.('warn', '3D 缩略图写入本地 companion 失败', putThumb.error);
            } else {
              thumbCompanionKey = putThumb.key;
            }
          }
          setAssets((prev) => {
            if (!prev.some((x) => x.id === newId)) return prev;
            return prev.map((x) => {
              if (x.id !== newId) return x;
              const o = String(x.original || '');
              if (o && !o.includes('image/svg+xml')) return x;
              return {
                ...x,
                original: thumb!,
                ...(thumbCompanionKey ? { originalCompanionKey: thumbCompanionKey } : {}),
                gridCardAspectRatio: thumbRatio,
              };
            });
          });
          setCardAspectByAssetId((prev) => ({ ...prev, [newId]: thumbRatio }));
        })();
      });
    },
    [buildWorkflowModelPlaceholderDataUrl, groupFilterId, importWorkshopLocalFiles, onLog, setAssets, workspaceProjectChrome?.activeProjectId, workshopDiskOpen]
  );

  const hasWorkflowDropTransfer = useCallback((dt?: DataTransfer | null) => {
    if (!dt) return false;
    const types = dt.types ? Array.from(dt.types) : [];
    if (dt.files?.length) {
      for (let i = 0; i < dt.files.length; i += 1) {
        const f = dt.files[i];
        if (f.type?.startsWith('image/')) return true;
        if (isWorkflowVideoFile(f)) return true;
        if (isWorkflowModelFile(f)) return true;
      }
    }
    if (dt.items?.length) {
      for (let i = 0; i < dt.items.length; i += 1) {
        const it = dt.items[i];
        if (it.kind === 'file' && it.type?.startsWith('image/')) return true;
        if (it.kind === 'file' && it.type?.startsWith('video/')) return true;
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
    const videoFiles = allFiles.filter((f) => isWorkflowVideoFile(f));
    const modelFiles = allFiles.filter((f) => isWorkflowModelFile(f));
    if (imageFiles.length === 0 && videoFiles.length === 0 && modelFiles.length === 0) return false;
    if (imageFiles.length) addImagesFromFiles(imageFiles);
    if (videoFiles.length) addVideosFromFiles(videoFiles);
    if (modelFiles.length) addModelsFromFiles(modelFiles);
    return true;
  }, [addImagesFromFiles, addModelsFromFiles, addVideosFromFiles]);
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
  /** 能力被禁用或复合能力被删后，从常用功能里剔除无效 id（目录未 hydrate 时勿清空） */
  useEffect(() => {
    if (!capabilityPresets.length && !capabilitySets.length) return;
    setFavoriteActionIds((prev) => {
      const next = prev.filter((id) => {
        if (id.startsWith(SET_ACTION_PREFIX)) {
          const sid = id.slice(SET_ACTION_PREFIX.length);
          return capabilitySets.some((s) => s.id === sid);
        }
        const p =
          actionModules.find((m) => m.id === id) ?? capabilityPresets.find((m) => m.id === id);
        // 目录短暂缺项时保留，避免误清空；仅明确 disabled 才剔除
        if (!p) return true;
        return p.enabled !== false;
      });
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev;
      return next;
    });
  }, [capabilityPresets, capabilitySets, actionModules]);
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

      const pastedAssetIds = parseWorkflowAssetIdsFromClipboardData(e.clipboardData);
      if (pastedAssetIds.length > 0) {
        const active = document.activeElement;
        if (active?.closest('[data-workflow-quick-compose-bar]')) return;
        e.preventDefault();
        const zone: QuickComposeDropZone = lightboxAssetIdRef.current ? 'reference' : 'main';
        appendQuickComposeDropSlotsForAssetIdsRef.current(pastedAssetIds, zone);
        return;
      }

      /**
       * 仅让出「焦点所在」的可编辑区 / 快捷栏 / 遮罩面板。
       * 禁止用 document.querySelector('[data-ac-block-workflow-marquee]')：
       * 底部快捷栏常驻该属性，会误伤资产列表粘贴文本/图片。
       */
      const active = document.activeElement;
      if (active && isWorkflowEditableTarget(active)) return;
      if (active?.closest('[data-workflow-quick-compose-bar]')) return;
      if (active?.closest('[data-ac-block-workflow-marquee]')) return;
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

  // Heal for display/filter without setState loops; persist at most once per asset-id set.
  const gridAssets = useMemo(() => healWorkflowPbrTextureGridVisibility(assets), [assets]);
  const pbrGridHideContext = useMemo(() => {
    const referencedPbrTextureIds = collectReferencedPbrTextureAssetIdsFromAssets(gridAssets);
    const pbrTextureDataUrls = collectReferencedPbrTextureDataUrlsFromAssets(gridAssets);
    return { referencedPbrTextureIds, pbrTextureDataUrls };
  }, [gridAssets]);
  const referencedPbrTextureIds = pbrGridHideContext.referencedPbrTextureIds;
  const pbrHealPersistSigRef = React.useRef('');
  useEffect(() => {
    if (gridAssets === assets) return;
    const sig = gridAssets
      .map((a) => `${a.id}:${a.hiddenInGrid ? 1 : 0}:${String(a.pbrHostAssetId || '')}`)
      .join('|');
    if (sig === pbrHealPersistSigRef.current) return;
    pbrHealPersistSigRef.current = sig;
    // Sync write-back so the first paint after reload does not briefly show PBR cards
    // and so autosave does not push an un-healed snapshot to companion/cloud.
    setAssets(gridAssets);
  }, [assets, gridAssets, setAssets]);

  const workshopCanvasLayerAssets = useMemo(() => {
    if (workshopDiskOpen) return workshopFileAssets;
    const hideOpts = pbrGridHideContext;
    const base = gridAssets.filter(
      (a) => !a.archived && !a.inRepository && !isWorkflowAssetHiddenFromAssetGrid(a, hideOpts)
    );
    // 组筛选模式：显示该组成员
    if (groupFilterId) {
      const group = assets.find(
        (a) => a.id === groupFilterId && !a.archived && !a.inRepository
      );
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
    // hiddenInGrid（如侧栏文生文载体）不入格
    return sortRootWorkflowAssetsNewestFirst(
      base.filter((a) => !a.groupId)
    );
  }, [workshopDiskOpen, workshopFileAssets, gridAssets, groupFilterId, pbrGridHideContext, assets]);
  const visibleAssets = useMemo(
    () => filterWorkshopCanvasByKind(workshopCanvasLayerAssets, workshopCanvasKindFilter),
    [workshopCanvasLayerAssets, workshopCanvasKindFilter],
  );
  const workshopCanvasKindCounts = useMemo(
    () => countWorkshopCanvasKinds(workshopCanvasLayerAssets),
    [workshopCanvasLayerAssets],
  );
  const rootCanvasAssets = useMemo(() => {
    if (workshopDiskOpen || !showAllInGroup) return visibleAssets;
    return sortRootWorkflowAssetsNewestFirst(
      gridAssets.filter((a) => {
        if (a.archived || a.inRepository) return false;
        if (isWorkflowAssetHiddenFromAssetGrid(a, pbrGridHideContext)) return false;
        // 显示全部：隐藏“组容器”本体，仅展示可见叶子资产（含组内子资产）
        if (isGroupAsset(a)) return false;
        if (isGroupChildAsset(a)) return true;
        return true;
      })
    );
  }, [workshopDiskOpen, gridAssets, showAllInGroup, visibleAssets, pbrGridHideContext]);

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

  const pendingAssetIds = useMemo(() => new Set(pending.map((t) => t.assetId)), [pending]);

  const assetsById = useMemo(() => {
    const map = new Map<string, WorkflowAsset>();
    for (const a of assets) map.set(a.id, a);
    return map;
  }, [assets]);

  /** 根画布专用：与 justified boxes 对齐，避免重复 id / 缺 box 造成隐形空位 */
  const rootCanvasAssetsById = useMemo(() => {
    const map = new Map<string, WorkflowAsset>();
    for (const a of rootCanvasAssets) map.set(a.id, a);
    return map;
  }, [rootCanvasAssets]);

  const rootExecutingTaskByAssetId = useMemo(() => {
    const map = new Map<string, WorkflowPendingTask>();
    if (!executingQueue) return map;
    for (const t of executingQueue.tasks) {
      if (!completedTaskIds.has(t.id)) map.set(t.assetId, t);
    }
    return map;
  }, [executingQueue, completedTaskIds]);

  const busyInputDisplayKeysByAssetId = useMemo(() => {
    const map = new Map<string, string[]>();
    const push = (task: WorkflowPendingTask) => {
      const assetId = String(task.assetId || '').trim();
      if (!assetId) return;
      const key = String(task.inputSourceDisplayKey || '').trim() || 'original';
      const list = map.get(assetId) || [];
      if (!list.includes(key)) {
        list.push(key);
        map.set(assetId, list);
      }
    };
    if (executingQueue) {
      for (const task of executingQueue.tasks) {
        if (activeTaskIds.has(task.id) && !completedTaskIds.has(task.id)) push(task);
      }
      for (const task of executingQueue.tasks) {
        if (!activeTaskIds.has(task.id) && !completedTaskIds.has(task.id)) push(task);
      }
    }
    for (const task of pending) push(task);
    return map;
  }, [activeTaskIds, completedTaskIds, executingQueue, pending]);

  const executingQueueDoneCount = useMemo(() => {
    if (!executingQueue) return 0;
    return executingQueue.tasks.reduce((n, t) => n + (completedTaskIds.has(t.id) ? 1 : 0), 0);
  }, [executingQueue, completedTaskIds]);

  const executionStartedAtByAssetId = useWorkflowExecutionStartedAt(executingQueue, activeTaskIds);

  const resolveActiveExecutionForAsset = useCallback(
    (assetId: string) => {
      if (!executingQueue) return null;
      const task = executingQueue.tasks.find((t) => t.assetId === assetId && activeTaskIds.has(t.id));
      if (!task) return null;
      const mod = getModule(task.actionType);
      return {
        startedAt: executionStartedAtByAssetId.get(assetId) ?? null,
        stepLabel: (mod?.label || task.actionType).trim(),
      };
    },
    [executingQueue, activeTaskIds, executionStartedAtByAssetId, getModule]
  );

  const lightboxActiveExecution = useMemo(() => {
    if (!lightboxAssetId) return null;
    return resolveActiveExecutionForAsset(lightboxAssetId);
  }, [lightboxAssetId, resolveActiveExecutionForAsset]);

  const lightboxAsset = lightboxAssetId ? findLiveAsset(lightboxAssetId) : null;
  const storyboardPanelAsset = storyboardPanelAssetId
    ? assets.find((a) => a.id === storyboardPanelAssetId && isWorkflowStoryboardTableAsset(a))
    : null;
  const assetSetPanelAsset = assetSetPanelAssetId
    ? assets.find((a) => a.id === assetSetPanelAssetId && isWorkflowAssetSetAsset(a))
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
  useEffect(() => {
    if (assetSetPanelAssetId && !assetSetPanelAsset) {
      setAssetSetPanelAssetId(null);
    }
  }, [assetSetPanelAsset, assetSetPanelAssetId]);
  const lightboxActiveVariant = useMemo(
    () => (lightboxAsset ? resolveWorkflowAssetActiveVariant(lightboxAsset) : null),
    [lightboxAsset]
  );
  const lightboxTexturePreviewSrc =
    lightboxTexturePreview && lightboxAsset && lightboxTexturePreview.assetId === lightboxAsset.id
      ? lightboxTexturePreview.src
      : '';
  const lightboxCenterRoute = useMemo(() => {
    if (!lightboxAsset) return null;
    const workshopCard = Boolean(fileSourceApi && parseWorkshopCardId(lightboxAsset.id));
    return resolveLightboxCenterRoute({
      asset: lightboxAsset,
      activeVariant: lightboxActiveVariant,
      texturePreviewSrc: lightboxTexturePreviewSrc,
      displayImage: getAssetDisplayImage(lightboxAsset),
      workshopGridThumb: workshopCard ? getAssetGridDisplayImage(lightboxAsset) : '',
      isWorkshopCard: workshopCard,
    });
  }, [
    fileSourceApi,
    getAssetDisplayImage,
    getAssetGridDisplayImage,
    lightboxActiveVariant,
    lightboxAsset,
    lightboxTexturePreviewSrc,
  ]);
  const lightboxMediaCenterVariant = lightboxCenterRoute?.mediaVariant ?? null;
  const lightboxTextAssetOnTextChannel = Boolean(lightboxCenterRoute?.useTextCenter);
  const lightboxShowsImage = lightboxCenterRoute?.mode === 'image';
  const lightboxChromeSlots = useMemo(
    () =>
      resolveLightboxChromeSlots({
        mode: lightboxCenterRoute?.mode || 'image',
        previewLayout: lightboxPreviewLayout,
        rasterEligible: Boolean(lightboxAsset && assetLightboxRasterEligible(lightboxAsset)),
        workshopNeedsApply: Boolean(
          lightboxAsset && fileSourceApi && workshopCardNeedsApply(lightboxAsset.id, lightboxAsset.displayKey)
        ),
        mediaKind: lightboxMediaCenterVariant?.kind,
      }),
    [
      assetLightboxRasterEligible,
      fileSourceApi,
      lightboxAsset,
      lightboxCenterRoute?.mode,
      lightboxMediaCenterVariant?.kind,
      lightboxPreviewLayout,
      workshopCardNeedsApply,
    ]
  );

  useLayoutEffect(() => {
    if (lightboxOverlayMounted) unmountLightboxLoadingCover();
  }, [lightboxOverlayMounted]);

  useEffect(() => {
    if (lightboxBootPhase !== 't1') return;
    if (lightboxTextAssetOnTextChannel && !lightboxShowsImage) {
      notifyLightboxPrimaryReady();
    }
  }, [
    lightboxBootPhase,
    lightboxTextAssetOnTextChannel,
    lightboxShowsImage,
    notifyLightboxPrimaryReady,
  ]);

  useEffect(() => {
    if (!fileSourceApi || !lightboxAssetId || !lightboxAsset) return;
    if (!parseWorkshopCardId(lightboxAsset.id)) return;
    if (lightboxBootPhase === 't3') return;
    const preview = getLightboxPreviewImageSrc(lightboxAsset).trim();
    if (!preview) return;
    notifyLightboxPrimaryReady();
  }, [
    fileSourceApi,
    lightboxAssetId,
    lightboxAsset,
    lightboxBootPhase,
    workshopSourceById,
    workshopThumbById,
    getLightboxPreviewImageSrc,
    notifyLightboxPrimaryReady,
  ]);

  useEffect(() => {
    setLightboxTexturePreview((prev) => {
      if (!prev) return prev;
      if (!lightboxAsset || prev.assetId !== lightboxAsset.id) return null;
      return prev;
    });
  }, [lightboxAsset]);

  /** 大图按位图预览：工具条、标注、快捷输入、SAM 等完整图片 chrome */
  const lightboxRasterChrome = Boolean(lightboxAsset && assetLightboxRasterEligible(lightboxAsset));
  /** 右侧步骤时间线 / 左侧 VGP 缩略图树（含文字源资产） */
  const lightboxStepSideChrome = Boolean(lightboxAsset && !isGroupAsset(lightboxAsset));
  const lightboxModelPreviewActive = Boolean(
    (!lightboxTexturePreviewSrc && lightboxMediaCenterVariant?.kind === 'model3d') ||
      (!lightboxTexturePreviewSrc && !lightboxMediaCenterVariant && lightboxPreviewLayout === 'model3d')
  );
  const lightboxModelPreviewActiveRef = useRef(false);
  lightboxModelPreviewActiveRef.current = lightboxModelPreviewActive;

  /** 打开/切换大图资产时，恢复该资产上次的 3D 显示模式等 chrome */
  useEffect(() => {
    if (!lightboxAssetId) return;
    const asset = assetsRef.current.find((x) => x.id === lightboxAssetId);
    const vs = normalizeWorkflowModel3dViewState(asset?.model3dViewState);
    if (!vs) {
      setLightboxModel3dDisplayMode('material');
      setLightboxModel3dShowGrid(true);
      setLightboxModel3dBackfaceCulling(true);
      return;
    }
    if (vs.displayMode) setLightboxModel3dDisplayMode(vs.displayMode);
    else setLightboxModel3dDisplayMode('material');
    if (typeof vs.showGrid === 'boolean') setLightboxModel3dShowGrid(vs.showGrid);
    else setLightboxModel3dShowGrid(true);
    if (typeof vs.backfaceCulling === 'boolean') setLightboxModel3dBackfaceCulling(vs.backfaceCulling);
    else setLightboxModel3dBackfaceCulling(true);
  }, [lightboxAssetId]);
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
    if (first === 'gltf') return `${stub}.gltf`;
    if (first === 'fbx') return `${stub}.fbx`;
    if (first === 'obj') return `${stub}.obj`;
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
    const apiKey = AI_GATEWAY_TRIPO_PLATFORM_KEY;
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
      onLog?.(
        'error',
        '混元拉取模型',
        '用户主路请从 AI Gateway 任务产物 / 本地伴侣恢复；VITE_TENCENT_PROXY 仅本地诊断，不可用于预发验收（D4）'
      );
      return;
    }
    onLog?.(
      'warn',
      '混元拉取模型',
      '正在使用 VITE_TENCENT_PROXY 诊断拉取 — 勿当作预发通过证据（D4）'
    );
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

  useEffect(() => {
    const variant = lightboxMediaCenterVariant;
    if (!lightboxAsset || variant?.kind !== 'model3d') return;
    if (workflowAssetVariantHasDirectModelUrl(variant)) return;
    if (!workflowAssetVariantHasModelCompanionKey(variant)) return;
    const base = String(getCompanionLocalBaseUrl() || '').trim();
    const projectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
    const resultKey = String(variant.id || lightboxAsset.displayKey || '').trim();
    if (!base || !projectId || !resultKey) return;
    let cancelled = false;
    void (async () => {
      const current = assetsRef.current.find((x) => x.id === lightboxAsset.id);
      if (!current) return;
      const hydrated = await hydrateWorkflowAssetSingle3dResultKeyFromCompanion({
        asset: current,
        resultKey,
        baseUrl: base,
        projectId,
        onLog: (level, message, detail) => onLogRef.current?.(level, message, detail),
      });
      if (cancelled || hydrated.nextAsset === current) return;
      setAssets((prev) => prev.map((x) => (x.id === current.id ? hydrated.nextAsset : x)));
      queueMicrotask(() => {
        for (const u of hydrated.revokeBlobUrls) {
          revokeWorkflowModelBlobUrlsIfOrphaned(u, assetsRef.current);
        }
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    lightboxAsset,
    lightboxMediaCenterVariant,
    setAssets,
    workspaceProjectChrome?.activeProjectId,
  ]);


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
          tripoApiKey: AI_GATEWAY_TRIPO_PLATFORM_KEY,
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
        (workshopDiskOpen ? workshopFileAssets : gridAssets).filter(
          (a) =>
            !a.archived &&
            !isWorkflowAssetHiddenFromAssetGrid(a, pbrGridHideContext) &&
            !a.parentAssetId &&
            !isWorkflowStoryboardTableAsset(a) &&
            !isGroupAsset(a)
        )
      ),
    [workshopDiskOpen, workshopFileAssets, gridAssets, pbrGridHideContext]
  );
  const lightboxListRef = useRef(lightboxList);
  lightboxListRef.current = lightboxList;
  const lightboxIndex = lightboxAssetId ? lightboxList.findIndex((a) => a.id === lightboxAssetId) : -1;
  useEffect(() => {
    if (!workshopDiskOpen || !workshopActiveRoot) return;
    const api = workshopFileSourceApi();
    if (!api?.getWorkshopThumb) return;
    let cancelled = false;
    const lightboxWant =
      lightboxAssetId
        ? new Set(
            lightboxList
              .filter((a) => a.assetKind === 'image' && parseWorkshopCardId(a.id))
              .map((a) => a.id),
          )
        : null;
    const missing: Array<{ id: string; displayKey: string }> = [];
    const seen = new Set<string>();
    const pushThumb = (id: string, displayKey = 'original') => {
      const key = String(id || '').trim();
      if (!key || seen.has(key)) return;
      if (workshopThumbByIdRef.current[key]) return;
      if (workshopThumbRequestedRef.current.has(key)) return;
      if (!parseWorkshopCardId(key)) return;
      seen.add(key);
      missing.push({ id: key, displayKey });
    };
    for (const a of workshopFileAssets) {
      const unlocked = thumbUnlockKeys.has(a.id) || Boolean(lightboxWant?.has(a.id));
      if (!unlocked) continue;
      if (a.assetKind === 'image' && !isWorkshopSpecialRasterName(a.textTitle || '')) {
        pushThumb(a.id, a.displayKey || 'original');
      }
      if (isGroupAsset(a)) {
        for (const id of a.assetIds || []) pushThumb(id);
      }
    }
    let cursor = 0;
    const workerCount = Math.min(WORKSHOP_THUMB_IPC_PARALLEL, missing.length);
    const runOne = async (a: (typeof missing)[number]) => {
      workshopThumbRequestedRef.current.add(a.id);
      const parsed = parseWorkshopCardId(a.id);
      if (!parsed) return;
      const payload = workshopHostFilePayload(parsed, {
        items: workshopMergedCanvasItems,
        fileId: workshopFaceFileId(a.id, a.displayKey),
      });
      try {
        const out = await api.getWorkshopThumb(payload);
        if (out.ok && out.status === 'ready' && out.dataUrl) {
          workshopThumbPendingRef.current.set(a.id, out.dataUrl as string);
          if (!workshopThumbRafRef.current) {
            workshopThumbRafRef.current = window.requestAnimationFrame(flushWorkshopThumbs);
          }
          return;
        }
      } catch {
        workshopThumbRequestedRef.current.delete(a.id);
        return;
      }
      if (cancelled) workshopThumbRequestedRef.current.delete(a.id);
    };
    const pump = async () => {
      while (cursor < missing.length && !cancelled) {
        const item = missing[cursor];
        cursor += 1;
        await runOne(item);
      }
    };
    void Promise.all(Array.from({ length: workerCount }, () => pump()));
    return () => {
      cancelled = true;
      if (workshopThumbRafRef.current) {
        window.cancelAnimationFrame(workshopThumbRafRef.current);
        workshopThumbRafRef.current = 0;
      }
      if (workshopThumbPendingRef.current.size) flushWorkshopThumbs();
    };
  }, [
    workshopDiskOpen,
    workshopActiveRoot,
    workshopMergedCanvasItems,
    workshopFileAssets,
    thumbUnlockKeys,
    lightboxAssetId,
    lightboxList,
    workshopFaceFileId,
    flushWorkshopThumbs,
  ]);
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

  const handleLightboxStripSelect = useCallback((assetId: string) => {
    setLightboxSourceSlot(null);
    const scrollEl = centerScrollRef.current;
    setLightboxPlaceholderImageSrc(
      scrollEl ? pickWorkflowCardPlaceholderSrc(scrollEl, assetId) : null
    );
    setLightboxAssetId(assetId);
  }, []);

  const getWorkflowAssetOriginalCopySrc = useCallback(
    (asset: WorkflowAsset): string => {
      // Same-card TTI: copy the current display raster (results slot), not birth-shell original.
      const display = asWorkflowImageString(getAssetDisplayImage(asset)).trim();
      if (display) return workflowSafeImgSrc(display);
      const orig = asWorkflowImageString(asset.original).trim();
      return orig ? workflowSafeImgSrc(orig) : '';
    },
    [getAssetDisplayImage]
  );

  const canWorkflowAssetCopyImage = useCallback(
    (asset: WorkflowAsset) => Boolean(getWorkflowAssetOriginalCopySrc(asset)),
    [getWorkflowAssetOriginalCopySrc]
  );

  const canWorkflowAssetAddToComposeInput = useCallback(
    (asset: WorkflowAsset) => {
      if (isWorkflowTextAsset(asset) && workflowAssetCurrentDisplayIsTextChannel(asset)) {
        return Boolean(workflowAssetToInputText(asset).trim());
      }
      if (isGroupAsset(asset) || !assetLightboxRasterEligible(asset)) return false;
      return Boolean(getAssetDisplayImage(asset).trim());
    },
    [getAssetDisplayImage]
  );

  const resolveWorkflowAssetOpenFolderHandle = useCallback(
    (asset: WorkflowAsset) =>
      resolveWorkflowAssetLocalHandle({
        asset,
        projectId: workspaceProjectChrome?.activeProjectId,
        companionBaseUrl: getCompanionLocalBaseUrl(),
      }),
    [workspaceProjectChrome?.activeProjectId]
  );

  const canWorkflowAssetOpenFolder = useCallback(
    (asset: WorkflowAsset) => {
      const handle = resolveWorkflowAssetOpenFolderHandle(asset);
      return canAttemptOpenWorkflowAssetFolder({
        projectId: handle.projectId,
        companionBaseUrl: getCompanionLocalBaseUrl(),
        hasCompanionKey: canOpenWorkflowAssetFolder(handle),
        asset,
      });
    },
    [resolveWorkflowAssetOpenFolderHandle]
  );

  const workflowAssetOpenFolderDisabledReason = useCallback(
    (asset: WorkflowAsset) => {
      const handle = resolveWorkflowAssetOpenFolderHandle(asset);
      if (canOpenWorkflowAssetFolder(handle)) {
        return handle.availability === 'asset_dir_fallback' ? handle.reasonZh : '';
      }
      if (
        canAttemptOpenWorkflowAssetFolder({
          projectId: handle.projectId,
          companionBaseUrl: getCompanionLocalBaseUrl(),
          hasCompanionKey: false,
          asset,
        })
      ) {
        return '当前步骤尚未落到本地，将先写入本机再打开';
      }
      return handle.reasonZh;
    },
    [resolveWorkflowAssetOpenFolderHandle]
  );

  const openWorkflowAssetContextMenu = useCallback((asset: WorkflowAsset, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setWorkflowAssetContextMenu({ assetId: asset.id, x: e.clientX, y: e.clientY });
  }, []);

  const handleWorkflowAssetCopyImage = useCallback(
    async (asset: WorkflowAsset) => {
      const imageSrc = getWorkflowAssetOriginalCopySrc(asset);
      if (!imageSrc) {
        onLog?.('warn', '该资产无可用原图，无法复制');
        return;
      }
      const outcome = await copyWorkflowAssetOriginalImageToClipboard({ imageSrc });
      if (outcome === 'ok') {
        onLog?.('info', '已复制原图，可粘贴到任意位置');
        return;
      }
      onLog?.('warn', '复制失败（请检查浏览器剪贴板权限）');
    },
    [getWorkflowAssetOriginalCopySrc, onLog]
  );

  const handleWorkflowAssetCopyId = useCallback(
    async (asset: WorkflowAsset) => {
      const outcome = await copyWorkflowAssetIdToClipboard({ assetId: asset.id });
      if (outcome === 'ok') {
        onLog?.('info', '已复制资产 ID；粘贴到输入栏即可引用（不会新建卡片）');
        return;
      }
      onLog?.('warn', '复制 ID 失败（请检查浏览器剪贴板权限）');
    },
    [onLog]
  );

  /** 大图预览：普通滚轮在本资产内切换 displayKey */
  const handleWorkflowAssetOpenFolder = useCallback(
    async (asset: WorkflowAsset) => {
      const base = String(getCompanionLocalBaseUrl() || '').trim();
      const projectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
      let working = asset;
      let handle = await resolveWorkflowAssetLocalHandleOnDisk({
        asset: working,
        projectId,
        companionBaseUrl: base,
      });
      // 无键，或键在但磁盘无文件 → 用当前预览图补写本地
      const needsPersist =
        !canOpenWorkflowAssetFolder(handle) || handle.onDiskConfirmed === false;
      if (needsPersist) {
        const ensured = await ensureWorkflowAssetCompanionKeyForReveal({
          asset: working,
          projectId,
          companionBaseUrl: base,
          rewriteIfMissingOnDisk: true,
        });
        if (ensured.ok === false) {
          onLog?.(
            'warn',
            ensured.error && ensured.error !== 'no_persistable_raster'
              ? `无法落到本地：${ensured.error}`
              : handle.reasonZh || '无法打开资产文件夹'
          );
          return;
        }
        working = ensured.asset;
        if (ensured.wrote) {
          setAssets((prev) => prev.map((x) => (x.id === working.id ? working : x)));
          onLog?.('info', '已将当前显示图写入本机，正在打开资产文件夹…');
        }
        handle = await resolveWorkflowAssetLocalHandleOnDisk({
          asset: working,
          projectId,
          companionBaseUrl: base,
        });
      }
      if (!canOpenWorkflowAssetFolder(handle) || handle.onDiskConfirmed === false) {
        onLog?.('warn', handle.reasonZh || '无法打开资产文件夹');
        return;
      }
      if (handle.availability === 'asset_dir_fallback' && handle.reasonZh) {
        onLog?.('info', handle.reasonZh);
      }
      onLog?.('info', '正在打开资产文件夹...', handle.companionKey);
      const out = await revealCompanionAssetFolderWithProjectFallback(
        base,
        handle.projectId,
        handle.companionKey
      );
      if (out.ok) {
        onLog?.('info', `已打开资产文件夹：${out.data.filename}`);
        return;
      }
      onLog?.('warn', `打开资产文件夹失败：${'error' in out ? out.error : 'unknown_error'}`);
    },
    [onLog, setAssets, workspaceProjectChrome?.activeProjectId]
  );

  const deleteWorkflowAssetCompanionObjects = useCallback(
    (removed: WorkflowAsset, remainingAssets: WorkflowAsset[]) => {
      const projectId = String(workspaceProjectChrome?.activeProjectId || '').trim();
      const base = String(getCompanionLocalBaseUrl() || '').trim();
      if (!projectId || !base) return;
      const removedKeys = collectReferencedCompanionKeys([removed]);
      const stillReferenced = collectReferencedCompanionKeys(remainingAssets);
      const keys = [...removedKeys].filter((key) => !stillReferenced.has(key));
      const removedDirId = sanitizeCompanionPathSegment(String(removed.id || '').trim());
      const stillReferencedDirs = new Set(
        [...stillReferenced].map(companionAssetDirectoryIdFromKey).filter(Boolean)
      );
      const shouldDeleteWholeDirectory = Boolean(removedDirId && !stillReferencedDirs.has(removedDirId));
      if (keys.length === 0 && !shouldDeleteWholeDirectory) return;
      void (async () => {
        let deleted = 0;
        let missing = 0;
        const failed: string[] = [];
        for (const key of keys) {
          const out = await deleteCompanionAsset(base, projectId, key);
          if (out.ok === true) {
            deleted += 1;
            continue;
          }
          if (out.status === 404 || out.code === 'STORAGE_NOT_FOUND') {
            missing += 1;
            continue;
          }
          failed.push(`${key}: ${out.error}`);
        }
        if (shouldDeleteWholeDirectory) {
          const out = await deleteCompanionAssetDirectory(base, projectId, removedDirId);
          if (out.ok === true) {
            deleted += Math.max(0, out.data.deletedKeys?.length || 0);
          } else if (out.status === 404 || out.code === 'STORAGE_NOT_FOUND') {
            missing += 1;
          } else {
            failed.push(`${removedDirId}/: ${out.error}`);
          }
        }
        if (deleted > 0) {
          onLog?.('info', `已同步删除本地资产文件：${deleted} 项`);
        }
        if (missing > 0) {
          onLog?.('warn', `本地资产文件已不存在，已清理画布引用：${missing} 项`);
        }
        if (failed.length > 0) {
          onLog?.(
            'warn',
            `本地资产文件删除失败：${failed.length} 项，刷新后可能被 manifest 补回`,
            failed.slice(0, 3).join('\n')
          );
        }
      })();
    },
    [onLog, workspaceProjectChrome?.activeProjectId]
  );

  const handleLightboxWheelCycleDisplay = useCallback((deltaSteps: number) => {
    if (workshopDiskOpen && lightboxAssetId) {
      const a = workshopFileAssets.find((x) => x.id === lightboxAssetId);
      if (!a) return;
      const keys = getDisplayKeysForAsset(a);
      if (keys.length <= 1) return;
      const current = a.displayKey;
      const idx = Math.max(0, keys.indexOf(current));
      const nextIdx = ((idx + deltaSteps) % keys.length + keys.length) % keys.length;
      setWorkshopDisplayKey(lightboxAssetId, keys[nextIdx]);
      return;
    }
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
  }, [workshopDiskOpen, lightboxAssetId, setAssets, setWorkshopDisplayKey, workshopFileAssets]);

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

  /** 快捷栏 / pending 仍占用的贴图资产（删孤儿时不得释放） */
  const collectExternalPbrTextureAssetRefs = useCallback((): string[] => {
    const ids: string[] = [];
    const pushSlot = (slot: { assetId?: string; modelPbrTextureRewriteTarget?: WorkflowModelPbrTextureRewriteTarget }) => {
      const aid = String(slot.assetId || '').trim();
      if (aid) ids.push(aid);
      const srcAid = String(slot.modelPbrTextureRewriteTarget?.sourceTextureAssetId || '').trim();
      if (srcAid) ids.push(srcAid);
    };
    for (const slot of quickComposeMainDropSlotsRef.current) pushSlot(slot);
    for (const slot of quickComposeReferenceDropSlotsRef.current) pushSlot(slot);
    for (const task of pendingRef.current) {
      const srcAid = String(task.modelPbrTextureRewriteTarget?.sourceTextureAssetId || '').trim();
      if (srcAid) ids.push(srcAid);
    }
    return ids;
  }, []);

  /** 关闭大图前写入资产，使再次打开仍为上次的标注/裁切/局部重绘状态 */
  useEffect(() => {
    const onPersistModelPbrEdit = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowModelPbrEditPersistEventDetail>).detail;
      const assetId = String(detail?.assetId || '').trim();
      const doc = normalizeWorkflowModelPbrEditDoc(detail?.doc);
      if (!assetId || !doc) return;
      if (assetId === lightboxAssetIdRef.current) {
        lightboxModel3dViewDirtyRef.current = true;
      }
      const stepKey = resolveStepModelPbrSlotKey({
        variantId: detail?.variantId || doc.variantId,
        modelKey: detail?.modelKey || doc.modelKey,
      });
      setAssets((prev) => {
        const host = prev.find((asset) => asset.id === assetId);
        if (!host) return prev;
        const beforeIds = collectAssetAllPbrTextureAssetIds(host);
        const patchedHost = writeWorkflowAssetStepPbrEdit(host, stepKey || doc.modelKey, doc);
        const afterIds = collectAssetAllPbrTextureAssetIds(patchedHost);
        const removedFromHost = [...beforeIds].filter((id) => !afterIds.has(id));
        let next = prev.map((asset) => (asset.id === assetId ? { ...asset, ...patchedHost } : asset));
        const orphanSet = new Set(
          filterUnreferencedPbrTextureAssetIds(removedFromHost, next, {
            excludeAssetId: assetId,
            extraReferencedIds: collectExternalPbrTextureAssetRefs(),
          })
        );
        if (orphanSet.size > 0) {
          const removedList = next.filter((a) => orphanSet.has(a.id));
          next = next.filter((a) => !orphanSet.has(a.id));
          for (const removed of removedList) {
            revokeWorkflowModelBlobUrlsAfterAssetRemoved(removed, next);
            deleteWorkflowAssetCompanionObjects(removed, next);
          }
        }
        return next;
      });
    };
    window.addEventListener(WORKFLOW_MODEL_PBR_EDIT_PERSIST_EVENT, onPersistModelPbrEdit);
    return () => {
      window.removeEventListener(WORKFLOW_MODEL_PBR_EDIT_PERSIST_EVENT, onPersistModelPbrEdit);
    };
  }, [collectExternalPbrTextureAssetRefs, deleteWorkflowAssetCompanionObjects, setAssets]);

  /**
   * 3D 贴图槽生成：Viewer 经事件桥接，由本组件执行 executeCapability，
   * 避免 ImageModel3DViewer 动态 import capabilityExecutor 触发模块环栈溢出。
   * 用 ref 取最新 presets/onLog，避免 effect 频繁重绑。
   */
  const pbrGenerateActionModulesRef = useRef(actionModules);
  const pbrGenerateCapabilityPresetsRef = useRef(capabilityPresets);
  const pbrGenerateOnLogRef = useRef(onLog);
  const pbrGenerateProjectIdRef = useRef(String(workspaceProjectChrome?.activeProjectId || '').trim());
  pbrGenerateActionModulesRef.current = actionModules;
  pbrGenerateCapabilityPresetsRef.current = capabilityPresets;
  pbrGenerateOnLogRef.current = onLog;
  pbrGenerateProjectIdRef.current = String(workspaceProjectChrome?.activeProjectId || '').trim();

  useEffect(() => {
    const isAbortMessage = (msg: string) =>
      /^(Aborted|请求已取消|已取消)$/i.test(msg.trim()) ||
      (/AbortError/i.test(msg) && !/timeout/i.test(msg));

    const onGenerateRequest = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowModelPbrSlotGenerateRequestDetail>).detail;
      const requestId = String(detail?.requestId || '').trim();
      if (!requestId) return;
      acknowledgeWorkflowModelPbrSlotGenerate(requestId);
      void (async () => {
        const presetId = String(detail?.presetId || '').trim();
        const sourceRaw = String(detail?.sourceDataUrl || '').trim();
        const count = Math.max(1, Math.min(16, Math.floor(Number(detail?.count) || 1)));
        const inputText = String(detail?.inputText || '').trim() || undefined;
        const abortSignal = takeWorkflowModelPbrSlotGenerateAbortSignal(requestId);
        if (!presetId || !sourceRaw) {
          completeWorkflowModelPbrSlotGenerate(requestId, { ok: false, error: '缺少预设或原始贴图' });
          return;
        }
        const modules = pbrGenerateActionModulesRef.current;
        const presetsList = pbrGenerateCapabilityPresetsRef.current;
        const log = pbrGenerateOnLogRef.current;
        const presetBase = modules.find((m) => m.id === presetId) ?? presetsList.find((p) => p.id === presetId);
        if (!presetBase) {
          completeWorkflowModelPbrSlotGenerate(requestId, { ok: false, error: '未找到能力预设' });
          return;
        }
        // 覆盖参数：明确比例/尺寸才覆盖预设；自适应/- 沿用预设（避免默认清掉 imageSize 致 handoff 失败）
        const preset = applyPbrSlotGenerateOverrides(presetBase, detail?.overrides);
        // 与快捷栏/能力库同一物化入口：blob/http → data URL，失败再按 companion 键兜底
        const companionProjectId = pbrGenerateProjectIdRef.current;
        const companionBaseUrl = String(getCompanionLocalBaseUrl() || '').trim();
        const textureAssetId = String(detail?.sourceTextureAssetId || '').trim();
        const textureAsset = textureAssetId
          ? assetsRef.current.find((a) => a.id === textureAssetId) ?? null
          : null;
        const resolvedImg = await resolveCapabilityInputImageForExecute({
          inputImage: sourceRaw,
          asset: textureAsset,
          sourceDisplayKey: 'original',
          companionBaseUrl,
          companionProjectId,
        });
        if (resolvedImg.ok === false) {
          completeWorkflowModelPbrSlotGenerate(requestId, {
            ok: false,
            error: resolvedImg.error || '贴图无法解析',
          });
          return;
        }
        const sourceDataUrl = await normalizeDataUrlForVisionApi(resolvedImg.dataUrl);
        if (abortSignal?.aborted) {
          completeWorkflowModelPbrSlotGenerate(requestId, { ok: false, error: '已取消' });
          return;
        }
        const images: WorkflowModelPbrSlotGenerateImage[] = [];
        reportWorkflowModelPbrSlotGenerateProgress(requestId, count);
        for (let i = 0; i < count; i += 1) {
          if (abortSignal?.aborted) break;
          try {
            const out = await executeCapability(
              preset,
              sourceDataUrl,
              { onLog: log, abortSignal },
              { inputText }
            );
            if (abortSignal?.aborted) break;
            if (!out.ok) {
              if (images.length > 0) break;
              const errMsg =
                'error' in out && typeof out.error === 'string' && out.error.trim()
                  ? out.error
                  : '生成失败';
              completeWorkflowModelPbrSlotGenerate(requestId, {
                ok: false,
                error: isAbortMessage(errMsg) ? '已取消' : errMsg,
              });
              return;
            }
            if (out.kind !== 'image' || !out.image) {
              if (images.length > 0) break;
              completeWorkflowModelPbrSlotGenerate(requestId, {
                ok: false,
                error: '该预设未返回图片结果',
              });
              return;
            }
            const mime =
              out.image.startsWith('data:image/')
                ? out.image.slice(5, out.image.indexOf(';')) || 'image/png'
                : 'image/png';
            const image: WorkflowModelPbrSlotGenerateImage = {
              dataUrl: out.image,
              fileName: `${preset.label || preset.id}-${i + 1}.png`,
              mimeType: mime,
              presetId: preset.id,
            };
            images.push(image);
            reportWorkflowModelPbrSlotGenerateImage(requestId, image, i);
            reportWorkflowModelPbrSlotGenerateProgress(requestId, count - images.length);
          } catch (err) {
            if (abortSignal?.aborted) break;
            if (images.length > 0) break;
            const msg = err instanceof Error ? err.message : '生成失败';
            completeWorkflowModelPbrSlotGenerate(requestId, {
              ok: false,
              error: isAbortMessage(msg) ? '已取消' : msg,
            });
            return;
          }
        }
        if (images.length === 0) {
          completeWorkflowModelPbrSlotGenerate(requestId, {
            ok: false,
            error: abortSignal?.aborted ? '已取消' : '未生成任何结果',
          });
          return;
        }
        completeWorkflowModelPbrSlotGenerate(requestId, { ok: true, images });
      })();
    };
    window.addEventListener(WORKFLOW_MODEL_PBR_SLOT_GENERATE_REQUEST_EVENT, onGenerateRequest);
    return () => {
      window.removeEventListener(WORKFLOW_MODEL_PBR_SLOT_GENERATE_REQUEST_EVENT, onGenerateRequest);
    };
  }, []);

  /** PBR 贴图升格为正式隐藏资产并伴侣落盘 */
  useEffect(() => {
    const onPromote = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowModelPbrTexturePromoteRequestDetail>).detail;
      const requestId = String(detail?.requestId || '').trim();
      if (!requestId) return;
      acknowledgePromotePbrTextureAsset(requestId);
      void (async () => {
        let dataUrl = String(detail?.dataUrl || '').trim();
        const hostAssetId = String(detail?.hostAssetId || '').trim();
        if (!dataUrl || !hostAssetId) {
          completePromotePbrTextureAsset(requestId, { ok: false, error: '缺少贴图或宿主资产' });
          return;
        }
        // Gemini 等常返回跨域 https：优先浏览器物化为 data URL；失败则保留远程 URL，
        // 交给下方 putWorkflowOriginalImageFromAnyUrl（伴侣 import-url → auth 代拉），
        // 避免在此抢先 auth 代拉失败时刷出误导性 WARN（伴侣往往仍能落盘）。
        if (!parseDataUrlToBlob(dataUrl)) {
          const materialized = await imageSrcToDataUrlForCompanion(dataUrl);
          if (materialized) {
            dataUrl = materialized;
          }
        }
        const id = uuid();
        const fileName = String(detail?.fileName || '').trim() || 'texture.png';
        const mimeType = String(detail?.mimeType || '').trim() || undefined;
        const slot = detail?.slot;
        const materialId = String(detail?.materialId || '').trim();
        const source =
          detail?.source === 'generate'
            ? 'generate'
            : detail?.source === 'embedded'
              ? 'embedded'
              : 'upload';
        const newAsset = attachInitialVgpToNewAsset({
          id,
          original: dataUrl,
          displayKey: 'original',
          results: {},
          resultOrder: [],
          archived: false,
          // 落盘隐藏资产：列表靠 hiddenInGrid + capability=pbr_texture 双保险过滤
          hiddenInGrid: true,
          pbrHostAssetId: hostAssetId,
          createdAt: Date.now(),
          resultMeta: {
            original: {
              executedAt: Date.now(),
              displayStepLabel: 'PBR Texture',
              source: {
                source: 'local',
                capability: 'pbr_texture',
                paramsSnapshot: {
                  pbrHostAssetId: hostAssetId,
                  ...(materialId ? { materialId } : {}),
                  ...(slot ? { slot } : {}),
                  pbrSource: source,
                  ...(detail?.presetId ? { presetId: detail.presetId } : {}),
                  fileName,
                  ...(mimeType ? { mimeType } : {}),
                },
              },
            },
          },
        });
        setAssets((prev) => [...prev, newAsset]);
        const base = String(getCompanionLocalBaseUrl() || '').trim();
        const pid = String(workspaceProjectChrome?.activeProjectId || '').trim();
        if (!base || !pid) {
          onLog?.(
            'warn',
            '本地伴侣未连接或无项目，贴图仅在内存；连接伴侣后右键「打开资产文件夹」可补写'
          );
          completePromotePbrTextureAsset(requestId, { ok: true, assetId: id, previewSrc: dataUrl });
          return;
        }
        const put = parseDataUrlToBlob(dataUrl)
          ? await putWorkflowOriginalImageToCompanion(base, pid, id, dataUrl)
          : await putWorkflowOriginalImageFromAnyUrl(base, pid, id, dataUrl);
        if (put.ok === false) {
          onLog?.('warn', '本地伴侣原图落盘失败（画布仍在内存）', put.error);
          completePromotePbrTextureAsset(requestId, { ok: true, assetId: id, previewSrc: dataUrl });
          return;
        }
        setAssets((prev) =>
          prev.some((x) => x.id === id)
            ? prev.map((x) => (x.id === id ? mergeWorkflowOriginalCompanionPersist(x, put) : x))
            : prev
        );
        completePromotePbrTextureAsset(requestId, { ok: true, assetId: id, previewSrc: dataUrl });
      })();
    };
    const onRelease = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowModelPbrTextureReleaseRequestDetail>).detail;
      const requestId = String(detail?.requestId || '').trim();
      if (!requestId) return;
      acknowledgeReleasePbrTextureAssets(requestId);
      const ids = [...new Set((detail?.assetIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
      if (ids.length === 0) {
        completeReleasePbrTextureAssets(requestId, { ok: true });
        return;
      }
      setAssets((prev) => {
        const toRemove = filterUnreferencedPbrTextureAssetIds(ids, prev, {
          extraReferencedIds: collectExternalPbrTextureAssetRefs(),
        });
        if (toRemove.length === 0) return prev;
        const removeSet = new Set(toRemove);
        const removedList = prev.filter((a) => removeSet.has(a.id));
        const next = prev.filter((a) => !removeSet.has(a.id));
        for (const removed of removedList) {
          revokeWorkflowModelBlobUrlsAfterAssetRemoved(removed, next);
          deleteWorkflowAssetCompanionObjects(removed, next);
        }
        return next;
      });
      completeReleasePbrTextureAssets(requestId, { ok: true });
    };
    window.addEventListener(WORKFLOW_MODEL_PBR_TEXTURE_PROMOTE_REQUEST_EVENT, onPromote);
    window.addEventListener(WORKFLOW_MODEL_PBR_TEXTURE_RELEASE_REQUEST_EVENT, onRelease);
    return () => {
      window.removeEventListener(WORKFLOW_MODEL_PBR_TEXTURE_PROMOTE_REQUEST_EVENT, onPromote);
      window.removeEventListener(WORKFLOW_MODEL_PBR_TEXTURE_RELEASE_REQUEST_EVENT, onRelease);
    };
  }, [
    collectExternalPbrTextureAssetRefs,
    deleteWorkflowAssetCompanionObjects,
    onLog,
    setAssets,
    workspaceProjectChrome?.activeProjectId,
  ]);

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

      const finishUnmount = () => {
        lightboxModel3dViewDirtyRef.current = false;
        lightboxOverlayClosingHiddenRef.current = false;
        setLightboxOverlayClosingHidden(false);
        if (opts.flush) flushLightboxOverlayToAsset();
        lightboxOpenGenRef.current += 1;
        setQuickComposeSegmentsTracked((prev) => stripCurrentViewFromQuickComposeSegments(prev));
        unmountLightboxLoadingCover();
        setLightboxOverlayMounted(false);
        setLightboxAssetId(null);
        setLightboxListBackdropUrl(null);
        setLightboxPlaceholderImageSrc(null);
        resetLightboxBoot();
        setLightboxSourceSlot(null);
        setLightboxRembgPreview(null);
        setLightboxRembgInstallModalOpen(false);
        setLightboxOverlayDirtyCloseDialogOpen(false);
        lightboxOverlayDirtyCloseDialogOpenRef.current = false;
        lightboxDirtyClosePersistedRef.current = null;
      };

      // 纯 model3d centerSlot：关窗时总是尝试截当前帧（不依赖 dirty，避免漏标）
      const shouldCaptureModelThumb = lightboxModelPreviewActiveRef.current;

      if (shouldCaptureModelThumb) {
        const assetIdAtClose = String(lightboxAssetIdRef.current || '').trim();
        const closeGen = ++lightboxModelThumbCloseGenRef.current;

        // 1) 趁壳层仍可见、WebGL 尺寸正常，同步截帧（强制 render 已在 capture API 内）
        let dataUrl: string | null = null;
        try {
          dataUrl = lightboxWebPreviewCaptureApiRef.current?.captureCurrentViewAsDataUrl() ?? null;
        } catch {
          dataUrl = null;
        }
        if (!dataUrl?.startsWith('data:image/') && import.meta.env.DEV) {
          // eslint-disable-next-line no-console -- diagnose silent thumb miss
          console.warn('[workflow-model3d-thumb] capture failed on close', {
            assetId: assetIdAtClose,
            hasApi: Boolean(lightboxWebPreviewCaptureApiRef.current),
          });
        }

        // 2) 立刻藏壳，露出资产列表；3D 仍挂载
        lightboxOverlayClosingHiddenRef.current = true;
        setLightboxOverlayClosingHidden(true);

        // 3) 写回预览（同步 setAssets），再下一帧卸载 3D
        const asset = assetIdAtClose ? assetsRef.current.find((x) => x.id === assetIdAtClose) : null;
        if (asset && dataUrl?.startsWith('data:image/')) {
          const activeVariant = resolveWorkflowAssetActiveVariant(asset);
          const displayKey = String(asset.displayKey || 'original').trim() || 'original';
          // 卡片读 displayKey 槽；model3d poster 也在 results[variantId]
          const variantId =
            activeVariant?.kind === 'model3d' && activeVariant.id
              ? activeVariant.id
              : displayKey;
          persistCapturedWorkflowModelThumbnail(asset.id, variantId, dataUrl, { force: true });
        }

        lightboxModel3dViewDirtyRef.current = false;
        window.requestAnimationFrame(() => {
          if (lightboxModelThumbCloseGenRef.current !== closeGen) return;
          finishUnmount();
        });
        return;
      }

      finishUnmount();
    },
    [flushLightboxOverlayToAsset, persistCapturedWorkflowModelThumbnail, resetLightboxBoot, setQuickComposeSegmentsTracked]
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

  useEffect(() => {
    const api = window.assetCutterWorkbench;
    if (!api || typeof api.onWorkspaceDocumentEvent !== 'function') return undefined;
    return api.onWorkspaceDocumentEvent((events) => {
      const list = Array.isArray(events) ? events : [];
      for (const event of list) {
        const item = event as { type?: string; finger?: Partial<WorkspaceFinger> } | null;
        if (!item || item.type !== 'finger.changed' || !item.finger || typeof item.finger !== 'object') continue;
        const patch = omitConnectedHostsFromFinger(item.finger);
        if (Object.prototype.hasOwnProperty.call(patch, 'selectedAssetId')) {
          setSelectedAssetIds((prev) => {
            const computed = nextSelectedAssetIdsFromFinger(prev, patch.selectedAssetId ?? null);
            const prevList = [...prev];
            if (computed.length === prevList.length && computed.every((id, i) => id === prevList[i])) return prev;
            return new Set(computed);
          });
        }
        if (
          Object.prototype.hasOwnProperty.call(patch, 'previewOpen') ||
          Object.prototype.hasOwnProperty.call(patch, 'previewAssetId')
        ) {
          const open = patch.previewOpen !== undefined ? Boolean(patch.previewOpen) : Boolean(lightboxAssetIdRef.current);
          const pid =
            patch.previewAssetId !== undefined
              ? String(patch.previewAssetId || '').trim()
              : String(lightboxAssetIdRef.current || '').trim();
          if (!open || !pid) {
            if (lightboxAssetIdRef.current) completeLightboxClose({ flush: true, auditDiscard: false });
          } else if (lightboxAssetIdRef.current !== pid) {
            openWorkflowLightbox(pid);
          }
        }
        if (patch.surface === 'presets') snapWorkspacePaneToNode(1);
        else if (patch.surface === 'canvas') snapWorkspacePaneToNode(0);
      }
    });
  }, [completeLightboxClose, openWorkflowLightbox, snapWorkspacePaneToNode]);

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
    if (workshopDiskOpen || parseWorkshopCardId(assetId)) {
      setWorkshopDisplayKey(assetId, key);
      return;
    }
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

  const cycleDisplayKey = useCallback(
    (assetId: string, delta: number) => {
      if (workshopDiskOpen) {
        const a = workshopFileAssets.find((x) => x.id === assetId);
        if (!a) return;
        const keys = getDisplayKeysForAsset(a);
        const nextKey = stepDisplayKeyInOrder(keys, a.displayKey, delta);
        if (!nextKey) return;
        setWorkshopDisplayKey(assetId, nextKey);
        return;
      }
      setAssets((prev) => {
        const a = prev.find((x) => x.id === assetId);
        if (!a) return prev;
        const keys = getDisplayKeysForAsset(a);
        const nextKey = stepDisplayKeyInOrder(keys, a.displayKey, delta);
        if (!nextKey) return prev;
        return prev.map((x) => (x.id === assetId ? { ...x, displayKey: nextKey } : x));
      });
    },
    [workshopDiskOpen, setWorkshopDisplayKey, setAssets, workshopFileAssets]
  );

  const triggerCardPreviewBounce = useCallback((assetId: string, direction: 'up' | 'down') => {
    setGroupBounceStateById((prev) => ({ ...prev, [assetId]: direction }));
    window.setTimeout(() => {
      setGroupBounceStateById((prev) => ({ ...prev, [assetId]: 'idle' }));
    }, 180);
  }, []);

  const stepAssetCardPreview = useCallback(
    (control: WorkflowCardHoverControl, delta: -1 | 1) => {
      const assetId = control.previewAssetId;
      if (!assetId) return;
      if (control.previewKind === 'groupIndex') {
        const groupLen = control.groupLen ?? 0;
        if (groupLen <= 1) return;
        setGroupPreviewIndexById((prev) => {
          const current = prev[assetId] ?? 0;
          const next = ((current + delta) % groupLen + groupLen) % groupLen;
          if (next === current) return prev;
          return { ...prev, [assetId]: next };
        });
        triggerCardPreviewBounce(assetId, delta > 0 ? 'down' : 'up');
        return;
      }
      if (control.previewKind === 'displayKey') {
        cycleDisplayKey(assetId, delta);
        triggerCardPreviewBounce(assetId, delta > 0 ? 'down' : 'up');
      }
    },
    [cycleDisplayKey, triggerCardPreviewBounce]
  );

  const buildAssetCardHoverControl = useCallback(
    (params: {
      controlId: string;
      asset: WorkflowAsset;
      isGroupCard?: boolean;
      groupLen?: number;
      hasDisplayImage?: boolean;
      busy?: boolean;
    }): WorkflowCardHoverControl | null => {
      if (params.busy || showArchived || lightboxAssetId) return null;
      const { controlId, asset, isGroupCard, groupLen = 0, hasDisplayImage = false } = params;
      if (isWorkflowStoryboardTableAsset(asset) || isWorkflowAssetSetAsset(asset)) return null;

      let previewKind: WorkflowCardHoverControl['previewKind'];
      let previewAssetId: string | undefined;
      if (isGroupCard && groupLen > 1) {
        previewKind = 'groupIndex';
        previewAssetId = asset.id;
      } else if (getDisplayKeysForAsset(asset).length > 1) {
        previewKind = 'displayKey';
        previewAssetId = asset.id;
      }

      const zoomEligible =
        (fileSourceApi && parseWorkshopCardId(asset.id) && asset.assetKind === 'image') ||
        workflowAssetCardZoomEligible(asset, getAssetDisplayImage(asset));

      if (!previewKind && !zoomEligible) return null;
      return {
        controlId,
        previewKind,
        previewAssetId,
        groupLen: previewKind === 'groupIndex' ? groupLen : undefined,
        zoomEligible,
      };
    },
    [showArchived, lightboxAssetId, fileSourceApi, getAssetDisplayImage]
  );

  const { setHoveredCard, clearHoveredCard, registerCardZoomHost } = useWorkflowAssetCardHoverKeys({
    disabled: showArchived || !!lightboxAssetId,
    onPreviewStep: stepAssetCardPreview,
  });

  const duplicateAssetInPlace = useCallback(
    (sourceIds: string[], parentGroupId: string | null) => {
      if (workshopDiskOpen) {
        const rels = sourceIds
          .map((id) => workshopCardDiskRel(id, workshopCanvasItemsRef.current))
          .filter((rel): rel is string => Boolean(rel));
        if (!rels.length) return;
        const api = workshopFileSourceApi();
        void api?.copyWorkshopEntries?.({ root: workshopActiveRoot, rels }).then((out) => {
          if (!out?.ok) onLog?.('warn', '作坊：复制失败', out?.error || 'copy_failed');
          setWorkshopListEpoch((epoch) => epoch + 1);
        });
        return;
      }
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
    [assets, onLog, setAssets, workshopActiveRoot, workshopDiskOpen, workspaceProjectChrome?.activeProjectId]
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
        if (spaceMarqueeEnabledRef.current) return;
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
    const revokeUrls = collectWorkflow3dBlobUrlsToRevoke(cur, actionType);
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
        const nextStepModelUrls = { ...(a.stepModelUrls || {}) };
        delete nextStepModelUrls[actionType];
        const nextStepModelCompanionKeys = { ...(a.stepModelCompanionKeys || {}) };
        delete nextStepModelCompanionKeys[actionType];
        const nextStepModelFormats = { ...(a.stepModelFormats || {}) };
        delete nextStepModelFormats[actionType];
        const nextStepModelPbrEdits = { ...(a.stepModelPbrEdits || {}) };
        delete nextStepModelPbrEdits[actionType];
        const displayKey = a.displayKey === actionType ? 'original' : a.displayKey;
        let modelUrls = a.modelUrls;
        let modelCompanionKeys = a.modelCompanionKeys;
        if (displayKey === 'original') {
          modelUrls = undefined;
          modelCompanionKeys = undefined;
        } else if (nextStepModelUrls[displayKey] || nextStepModelCompanionKeys[displayKey]) {
          modelUrls = nextStepModelUrls[displayKey];
          modelCompanionKeys = nextStepModelCompanionKeys[displayKey];
        }
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
          stepModelUrls: Object.keys(nextStepModelUrls).length ? nextStepModelUrls : undefined,
          stepModelCompanionKeys: Object.keys(nextStepModelCompanionKeys).length
            ? nextStepModelCompanionKeys
            : undefined,
          stepModelFormats: Object.keys(nextStepModelFormats).length ? nextStepModelFormats : undefined,
          stepModelPbrEdits: Object.keys(nextStepModelPbrEdits).length ? nextStepModelPbrEdits : undefined,
          modelUrls,
          modelCompanionKeys,
        };
      })
    );
    for (const u of revokeUrls) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* ignore */
      }
    }
  };

  const markArchived = (assetId: string) => {
    const snapshot = assets.find((a) => a.id === assetId) || null;
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id === assetId) {
          return {
            ...a,
            archived: true,
            inRepository: true,
            // PBR 贴图即使进仓库也保持隐藏，列表靠 capability 双保险
            hiddenInGrid: isWorkflowPbrTextureAsset(a) ? true : false,
            groupId: undefined,
            groupLabel: undefined,
            groupOrder: undefined,
          };
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
    if (workshopDiskOpen) {
      const parsed = parseWorkshopFileAssetId(assetId);
      const rel = parsed?.rel || workshopCardDiskRel(assetId, workshopCanvasItemsRef.current);
      const root = parsed?.root || workshopActiveRoot;
      if (!rel || !root) {
        onLog?.('warn', '作坊：删除失败', 'no_rel');
      } else {
        const api = workshopFileSourceApi();
        void api
          ?.trashWorkshopEntries?.({ root, rels: [rel] })
          .then((out) => {
            if (!out?.ok) onLog?.('warn', '作坊：删除失败', out?.error || 'trash_failed');
            else if (!(out.rels && out.rels.length)) onLog?.('warn', '作坊：删除失败', 'not_moved');
            setWorkshopListEpoch((epoch) => epoch + 1);
          })
          .catch((err: unknown) => {
            onLog?.('warn', '作坊：删除失败', err instanceof Error ? err.message : String(err || 'trash_failed'));
          });
      }
    }
    setAssets((prev) => {
      const removed = prev.find((a) => a.id === assetId);
      if (!removed) return prev;
      const pbrTexIds = filterUnreferencedPbrTextureAssetIds(
        collectAssetAllPbrTextureAssetIds(removed),
        prev,
        {
          excludeAssetId: assetId,
          extraReferencedIds: collectExternalPbrTextureAssetRefs(),
        }
      );
      const removeSet = new Set<string>([assetId, ...pbrTexIds]);
      // Deleting a texture card (or host cascade): also scrub host PBR docs so reopen
      // does not keep dead assetId refs that confuse heal / re-promote.
      const removedList = prev.filter((a) => removeSet.has(a.id));
      let next = prev.filter((a) => !removeSet.has(a.id));
      next = detachPbrTextureAssetIdsFromAssets(next, removeSet);
      for (const item of removedList) {
        if (isWorkflowStoryboardTableAsset(item)) {
          onStoryboardTableAssetRemoved?.(item.id);
        }
        revokeWorkflowModelBlobUrlsAfterAssetRemoved(item, next);
        deleteWorkflowAssetCompanionObjects(item, next);
      }
      return next;
    });
    setPending((prev) => prev.filter((t) => t.assetId !== assetId));
    setSelectedAssetIds((prev) => {
      if (!prev.has(assetId)) return prev;
      const next = new Set(prev);
      next.delete(assetId);
      return next;
    });
    setSelectedGroupItemKeys((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const key of prev) {
        if (key === assetId || key.startsWith(`${assetId}::`)) {
          changed = true;
          continue;
        }
        next.add(key);
      }
      return changed ? next : prev;
    });
    setWorkflowAssetContextMenu((prev) => (prev?.assetId === assetId ? null : prev));
    if (lightboxAssetId === assetId) {
      lightboxModelThumbCloseGenRef.current += 1;
      unmountLightboxLoadingCover();
      setLightboxOverlayClosingHidden(false);
      setLightboxOverlayMounted(false);
      setLightboxAssetId(null);
      setLightboxListBackdropUrl(null);
      setLightboxPlaceholderImageSrc(null);
      resetLightboxBoot();
    }
    if (archivedDetailAssetId === assetId) setArchivedDetailAssetId(null);
    if (assetSetPanelAssetId === assetId) setAssetSetPanelAssetId(null);
    if (storyboardPanelAssetId === assetId) setStoryboardPanelAssetId(null);
    // 如果删除的是当前查看的组，清除组筛选
    if (groupFilterId === assetId) setGroupFilterId(null);
  }, [
    collectExternalPbrTextureAssetRefs,
    deleteWorkflowAssetCompanionObjects,
    lightboxAssetId,
    archivedDetailAssetId,
    groupFilterId,
    storyboardPanelAssetId,
    assetSetPanelAssetId,
    onStoryboardTableAssetRemoved,
    onLog,
    resetLightboxBoot,
    setAssets,
    setPending,
    workshopActiveRoot,
    workshopDiskOpen,
  ]);

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
            const img = getAssetGridDisplayImage(child);
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
            const img = getAssetGridDisplayImage(child);
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
    [assets, getAssetGridDisplayImage]
  );
  const showAllImages = useMemo(() => {
    if (!currentGroupAsset || !showAllInGroup) return null;
    return flattenGroupImages(currentGroupAsset);
  }, [currentGroupAsset, showAllInGroup, flattenGroupImages]);

  const rootCanvasLayoutItems = useMemo(
    () =>
      rootCanvasAssets.map((a) => {
        const textDisplay = getAssetDisplayText(a);
        const hasTextPayload =
          !!textDisplay ||
          !!(a.textTitle || '').trim() ||
          Object.values(a.textResults || {}).some((v) => String(v || '').trim() !== '');
        const displayImg = getAssetDisplayImage(a).trim();
        const folderCover =
          workshopDiskOpen && isGroupAsset(a)
            ? (a.assetIds || []).map((id) => workshopThumbById[id] || '').find((s) => String(s).trim()) || ''
            : '';
        const thumbCover = workshopDiskOpen ? String(workshopThumbById[a.id] || '').trim() : '';
        const hasDisplayImage =
          (displayImg !== '' && !isWorkflowModelSvgPlaceholderSrc(displayImg)) ||
          Boolean(folderCover.trim()) ||
          Boolean(thumbCover);
        return {
          id: a.id,
          aspectRatio: resolveWorkflowCanvasCardAspect(a, cardAspectByAssetId, {
            hasDisplayImage,
            hasTextPayload,
          }),
        };
      }),
    [rootCanvasAssets, cardAspectByAssetId, getAssetDisplayText, getAssetDisplayImage, workshopDiskOpen, workshopThumbById]
  );

  const rootJustifiedLayout = useWorkflowJustifiedLayout(rootCanvasLayoutItems, gridRef, {
    gap: WORKFLOW_ASSET_GRID_GAP_PX,
    targetRowHeight: justifiedTargetRowHeight,
    /** 小盒子切回资产页时须重绑 ResizeObserver（grid 曾被 hidden，宽度可能未更新） */
    remeasureKey: Math.round(workspacePane),
  });

  const groupCanvasLayoutItems = useMemo(() => {
    if (!groupFilterId || !currentGroupAsset) return [];
    if (showAllImages?.length) {
      return showAllImages.map((_flat, idx) => {
        const gallKey = `gall:${currentGroupAsset.id}:${idx}`;
        return {
          id: gallKey,
          aspectRatio: resolveWorkflowGridCardAspect(undefined, cardAspectByAssetId, gallKey, 1),
        };
      });
    }
    return currentGroupItems.flatMap((item, idx) => {
      const groupKey = `${currentGroupAsset.id}::${idx}`;
      const isAssetRef = typeof item === 'object' && item && 'assetId' in item;
      const childAsset = isAssetRef
        ? assets.find((x) => x.id === (item as { assetId: string }).assetId) ?? null
        : null;
      if (childAsset) {
        if (!workshopCanvasKindMatches(childAsset, workshopCanvasKindFilter)) return [];
        const childTextDisplay = getAssetDisplayText(childAsset);
        const hasChildTextPayload =
          !!childTextDisplay ||
          !!(childAsset.textTitle || '').trim() ||
          Object.values(childAsset.textResults || {}).some((v) => String(v || '').trim() !== '');
        const hasChildDisplayImage = getAssetDisplayImage(childAsset).trim() !== '';
        return [{
          id: groupKey,
          aspectRatio: resolveWorkflowCanvasCardAspect(childAsset, cardAspectByAssetId, {
            hasDisplayImage: hasChildDisplayImage,
            hasTextPayload: hasChildTextPayload,
            syntheticKey: groupKey,
          }),
        }];
      }
      if (workshopCanvasKindFilter !== 'all' && workshopCanvasKindFilter !== 'image') return [];
      return [{
        id: groupKey,
        aspectRatio: resolveWorkflowGridCardAspect(undefined, cardAspectByAssetId, groupKey, 1),
      }];
    });
  }, [
    groupFilterId,
    currentGroupAsset,
    showAllImages,
    currentGroupItems,
    assets,
    cardAspectByAssetId,
    getAssetDisplayText,
    getAssetDisplayImage,
    workshopCanvasKindFilter,
  ]);

  const groupJustifiedLayout = useWorkflowJustifiedLayout(groupCanvasLayoutItems, groupGridRef, {
    gap: WORKFLOW_ASSET_GRID_GAP_PX,
    targetRowHeight: justifiedTargetRowHeight,
    remeasureKey: Math.round(workspacePane),
  });

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
    if (!root || lightboxAssetId) return;
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
    lightboxAssetId,
  ]);

  useEffect(() => {
    const root = centerScrollRef.current;
    if (!root || lightboxAssetId) return;
    let cancelled = false;
    let hotRaf = 0;
    const pendingHotAdd = new Set<string>();
    const pendingHotRemove = new Set<string>();

    const flushHot = () => {
      hotRaf = 0;
      if (!pendingHotAdd.size && !pendingHotRemove.size) return;
      const add = [...pendingHotAdd];
      const remove = [...pendingHotRemove];
      pendingHotAdd.clear();
      pendingHotRemove.clear();
      setThumbHotKeys((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const k of add) {
          if (!next.has(k)) {
            next.add(k);
            changed = true;
          }
        }
        for (const k of remove) {
          if (next.has(k)) {
            next.delete(k);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (cancelled) return;
        for (const en of entries) {
          const k = (en.target as HTMLElement).getAttribute('data-workflow-thumb-key');
          if (!k) continue;
          if (en.isIntersecting) {
            pendingHotRemove.delete(k);
            pendingHotAdd.add(k);
          } else {
            pendingHotAdd.delete(k);
            pendingHotRemove.add(k);
          }
        }
        if (!hotRaf) {
          hotRaf = window.requestAnimationFrame(flushHot);
        }
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
      if (hotRaf) window.cancelAnimationFrame(hotRaf);
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
    lightboxAssetId,
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

  const workshopNavCrumbs = useMemo(
    () =>
      workshopBreadcrumbSegments({
        loc: {
          root: workshopActiveRoot,
          rel: workshopCurrentRel,
          groupId: groupFilterId,
        },
        rootLabel: workshopNavRootLabel(workshopActiveRoot, workshopRoots),
        groupPath: groupBreadcrumb.map((b) => ({ id: b.id, label: b.label })),
      }),
    [workshopActiveRoot, workshopCurrentRel, groupFilterId, workshopRoots, groupBreadcrumb],
  );

  const workshopNavLoc = useMemo(
    () =>
      normalizeWorkshopNavLoc({
        root: workshopActiveRoot,
        rel: workshopCurrentRel,
        groupId: groupFilterId,
      }),
    [workshopActiveRoot, workshopCurrentRel, groupFilterId],
  );

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
      const fromGroup = opts?.sourceGroupAssetId != null && opts.sourceItemIndex != null;
      const taskBase: Omit<WorkflowPendingTask, 'id' | 'assetId' | 'addedAt'> = {
        actionType,
        inputImage: imageBase64,
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
      };
      if (workshopDiskOpen) {
        void (async () => {
          const tempId = uuid();
          const newAsset: WorkflowAsset = attachInitialVgpToNewAsset({
            id: tempId,
            original: imageBase64,
            displayKey: 'original',
            results: {},
            resultOrder: [],
            archived: false,
            hiddenInGrid: true,
            createdAt: Date.now(),
            ...(opts?.parentAssetId ? { parentAssetId: opts.parentAssetId } : {}),
          });
          const task: WorkflowPendingTask = {
            id: uuid(),
            assetId: tempId,
            addedAt: Date.now(),
            ...taskBase,
          };
          const remapped = await enqueueWorkshopGenerationBatch([newAsset], [task]);
          if (!remapped.ok) return;
          setPending((prev) => [...prev, ...remapped.tasks]);
        })();
        return;
      }
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
          addedAt: Date.now(),
          ...taskBase,
        },
      ]);
      scheduleCompanionPersistOriginalAny(newAsset.id, imageBase64);
    },
    [setAssets, setPending, onLog, scheduleCompanionPersistOriginalAny, fileSourceApi, enqueueWorkshopGenerationBatch]
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
      opts?: { allowTextAssetsForExpansion?: boolean }
    ): { rootIds: string[]; cloneTaskSeeds: Array<{ sourceAsset: WorkflowAsset; targetAssetId: string }> } => {
      if (generateCount <= 1) return { rootIds: assetIds, cloneTaskSeeds: [] };
      type ClonePlan = { sourceId: string; cloneId: string; sourceAsset: WorkflowAsset };
      const clonePlans: ClonePlan[] = [];
      const rootIds: string[] = [];
      const cloneTaskSeeds: Array<{ sourceAsset: WorkflowAsset; targetAssetId: string }> = [];
      for (const id of assetIds) {
        const source = assets.find((a) => a.id === id);
        if (!source || isGroupChildAsset(source) || (!opts?.allowTextAssetsForExpansion && isWorkflowTextAsset(source))) {
          rootIds.push(id);
          continue;
        }
        rootIds.push(id);
        for (let i = 1; i < generateCount; i += 1) {
          const cloneId = uuid();
          clonePlans.push({ sourceId: id, cloneId, sourceAsset: source });
          cloneTaskSeeds.push({ sourceAsset: source, targetAssetId: cloneId });
        }
      }
      if (clonePlans.length === 0) return { rootIds, cloneTaskSeeds };
      if (!workshopDiskOpen) {
        setAssets((prev) => {
          const next = [...prev];
          for (const plan of clonePlans) {
            const src = next.find((a) => a.id === plan.sourceId);
            if (!src) continue;
            const clone: WorkflowAsset = {
              ...src,
              id: plan.cloneId,
              parentAssetId: undefined,
              groupId: undefined,
              groupLabel: undefined,
              groupOrder: undefined,
              archived: false,
              hiddenInGrid: false,
              createdAt: Date.now(),
            };
            next.push(clone);
            const o = String(clone.original || '').trim();
            if (o) queueMicrotask(() => scheduleCompanionPersistOriginalAny(plan.cloneId, o));
          }
          return next;
        });
      }
      return { rootIds, cloneTaskSeeds };
    },
    [assets, setAssets, scheduleCompanionPersistOriginalAny, workshopDiskOpen]
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
      if (workshopDiskOpen) {
        const rels = assetIds
          .map((id) => workshopCardDiskRel(id, workshopCanvasItemsRef.current))
          .filter((rel): rel is string => Boolean(rel));
        if (rels.length < 2) return;
        const api = workshopFileSourceApi();
        void api
          ?.groupWorkshopEntries?.({
            root: workshopActiveRoot,
            parentRel: workshopCurrentRel,
            rels,
          })
          .then((out) => {
            if (!out?.ok) onLog?.('warn', '作坊：成组失败', out?.error || 'group_failed');
            setWorkshopListEpoch((epoch) => epoch + 1);
          });
        setSelectedAssetIds(new Set());
        return;
      }
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
    [assets, insertManualGroupForAssetIds, onLog, scheduleCompanionPersistOriginalAny, setAssets, setSelectedAssetIds, workshopActiveRoot, workshopCurrentRel, workshopDiskOpen]
  );

  const handleWorkflowAssetDropHostDragOver = useCallback(
    (
      e: React.DragEvent<HTMLElement>,
      targetKey: string,
      opts: { allowGroup: boolean; isBusy: boolean }
    ) => {
      if (opts.isBusy) return;
      const hasInternalDrag =
        !!draggingAssetIdsRef.current?.length ||
        !!draggingGroupItemsRef.current?.itemIndexes?.length;
      let hasExport = false;
      try {
        hasExport = Array.from(e.dataTransfer.types).includes(DT_AC_WORKFLOW_EXPORT);
      } catch {
        hasExport = false;
      }
      if (!hasInternalDrag && !hasExport) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      updateWorkflowCardDragOver(e.currentTarget, targetKey, e.clientX, e.clientY, {
        allowGroup: opts.allowGroup,
      });
    },
    []
  );

  const handleRootCanvasAssetShellDrop = useCallback(
    (e: React.DragEvent<HTMLElement>, targetAsset: WorkflowAsset) => {
      e.preventDefault();
      const session = readWorkflowCardDragDropSession();
      workflowCardDragLeave(e.currentTarget, targetAsset.id);
      if (busyAssetIds.has(targetAsset.id)) {
        clearWorkflowDragSession();
        return;
      }
      const fromState = parseWorkflowDragSource(
        draggingAssetIdsRef.current,
        draggingGroupItemsRef.current
      );
      const sources = fromState ? [fromState] : parseAcWorkflowExportDragSources(e.dataTransfer);
      const finish = () => clearWorkflowDragSession();
      if (sources.length !== 1) {
        finish();
        return;
      }
      const src = sources[0]!;
      const targetId = targetAsset.id;

      if (
        session?.targetKey === targetId &&
        session.intent !== 'group' &&
        src.kind === 'root'
      ) {
        if (workshopDiskOpen) {
          finish();
          return;
        }
        const dragIds = Array.from(new Set(src.assetIds)).filter((id) => id !== targetId);
        if (dragIds.length > 0) {
          setAssets((prev) =>
            applyRootWorkflowAssetReorder(
              prev,
              dragIds,
              targetId,
              session.intent === 'insert-before' ? 'before' : 'after'
            )
          );
        }
        finish();
        return;
      }

      if (
        session?.targetKey === targetId &&
        session.intent === 'group' &&
        src.kind === 'root'
      ) {
        const dragIds = Array.from(new Set(src.assetIds.filter((id) => id !== targetId))).filter((id) => {
          if (workshopDiskOpen) return Boolean(findLiveAsset(id));
          const ast = assets.find((x) => x.id === id);
          return ast != null && !isWorkflowTextAsset(ast);
        });
        if (dragIds.length > 0) {
          if (workshopDiskOpen) {
            const destRel = workshopCardDiskRel(targetId, workshopCanvasItemsRef.current);
            const srcRels = dragIds
              .map((id) => workshopCardDiskRel(id, workshopCanvasItemsRef.current))
              .filter((rel): rel is string => Boolean(rel));
            const api = workshopFileSourceApi();
            if (isGroupAsset(targetAsset) && destRel && api?.moveWorkshopEntries) {
              void api.moveWorkshopEntries({ root: workshopActiveRoot, destRel, rels: srcRels }).then((out) => {
                if (!out?.ok) onLog?.('warn', '作坊：移入文件夹失败', out?.error || 'move_failed');
                setWorkshopListEpoch((epoch) => epoch + 1);
              });
            } else {
              const members = Array.from(new Set([...dragIds, targetId]));
              if (members.length > 1) createGroupFromAssets(members);
            }
          } else if (isGroupAsset(targetAsset)) {
            setAssets((prev) => mergeAssetIdsIntoGroupCardAssets(prev, targetId, dragIds));
          } else {
            const members = Array.from(new Set([...dragIds, targetId]));
            if (members.length > 1) createGroupFromAssets(members);
          }
        }
        finish();
        return;
      }

      if (workshopDiskOpen || isWorkflowTextAsset(targetAsset)) {
        finish();
        return;
      }

      if (src.kind !== 'group') {
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
    },
    [
      assets,
      busyAssetIds,
      clearWorkflowDragSession,
      createGroupFromAssets,
      findLiveAsset,
      insertManualGroupForAssetIds,
      mergeAssetIdsIntoGroupCardAssets,
      onLog,
      scheduleCompanionPersistOriginalAny,
      setAssets,
      setGroupFilterId,
      workshopActiveRoot,
      workshopDiskOpen,
    ]
  );

  const handleGroupItemShellDrop = useCallback(
    (
      e: React.DragEvent<HTMLElement>,
      groupKey: string,
      itemIndex: number,
      childAsset: WorkflowAsset
    ) => {
      e.preventDefault();
      const session = readWorkflowCardDragDropSession();
      workflowCardDragLeave(e.currentTarget, groupKey);
      if (!currentGroupAsset) {
        clearWorkflowDragSession();
        return;
      }
      if (!showArchived && ingestWorkflowFilesFromDataTransfer(e.dataTransfer)) {
        clearWorkflowDragSession();
        return;
      }
      const dragGroup = draggingGroupItemsRef.current;
      if (
        session?.targetKey === groupKey &&
        session.intent !== 'group' &&
        dragGroup?.itemIndexes?.length &&
        dragGroup.groupAssetId === currentGroupAsset.id
      ) {
        setAssets((prev) =>
          reorderManualGroupItemIndexes(
            prev,
            dragGroup.groupAssetId,
            dragGroup.itemIndexes,
            itemIndex,
            session.intent === 'insert-before' ? 'before' : 'after'
          )
        );
        setSelectedGroupItemKeys(new Set());
        clearWorkflowDragSession();
        return;
      }

      if (!dragGroup?.itemIndexes?.length) {
        clearWorkflowDragSession();
        return;
      }
      const targetIdx = itemIndex;
      const allIndexes = [...new Set([...dragGroup.itemIndexes, targetIdx])].sort((a, b) => a - b);
      if (allIndexes.length < 2) {
        clearWorkflowDragSession();
        return;
      }
      const groupAssetId = currentGroupAsset.id;
      const { nextAssets, assetIds } = ensureGroupItemsAsAssets(assets, groupAssetId, allIndexes);
      if (assetIds.length === 0) {
        clearWorkflowDragSession();
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
          updated = updated.map((a, i) => (i === groupIdx ? { ...a, assetIds: keep } : a));
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
        groupId: groupAssetId,
        groupKind: 'manual',
        groupLabel: getRandomGroupCodeName(usedLabels),
        archived: false,
        hiddenInGrid: false,
        createdAt: Date.now(),
      });
      setAssets([...updated, newGroup]);
      setSelectedGroupItemKeys(new Set());
      clearWorkflowDragSession();
    },
    [
      assets,
      clearWorkflowDragSession,
      currentGroupAsset,
      getAssetDisplayImage,
      setAssets,
      setSelectedGroupItemKeys,
      showArchived,
    ]
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
        const asset = findLiveAsset(id);
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
    [findLiveAsset]
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
    if (quickComposeMode !== 'image' && quickComposeMode !== 'auto') return null;
    const base = getQuickComposePlainModule(QUICK_COMPOSE_PLAIN_T2I_ACTION_ID);
    if (!base) return null;
    return {
      ...base,
      imageModelRegistryId: coerceImageModelRegistryId(quickComposeImageModel),
    };
  }, [quickComposeMode, quickComposeImageModel]);

  const quickComposeMaxReferenceImages = useMemo(() => {
    if (quickComposeMode === 'text') return 10;
    if (quickComposeMode === 'video') return 1;
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
      listDropSlotMentionCandidates([], quickComposeMentions, {
        includeCurrentView: Boolean(lightboxAssetId),
        currentViewPreviewSrc: lightboxCurrentViewPreviewSrc || undefined,
        mainDropSlots: quickComposeMainDropSlots,
        referenceDropSlots: quickComposeReferenceDropSlots,
        extraCandidates: listExpertMentionCandidates(
          quickComposeMentions,
          listExpertProfiles().map((p) => ({
            expertId: p.expertId,
            displayName: p.displayName,
          }))
        ),
      }),
    [
      quickComposeMainDropSlots,
      quickComposeReferenceDropSlots,
      quickComposeMentions,
      lightboxAssetId,
      lightboxCurrentViewPreviewSrc,
    ]
  );

  const appendQuickComposeDropSlotsForAssetIds = useCallback(
    (assetIds: string[], zone: QuickComposeDropZone = 'main') => {
      const setter = zone === 'reference' ? setQuickComposeReferenceDropSlots : setQuickComposeMainDropSlots;
      const otherSetter =
        zone === 'reference' ? setQuickComposeMainDropSlots : setQuickComposeReferenceDropSlots;
      const renumber =
        zone === 'reference' ? renumberQuickComposeReferenceDropSlotLabels : renumberQuickComposeMainDropSlotLabels;
      const renumberOther =
        zone === 'reference' ? renumberQuickComposeMainDropSlotLabels : renumberQuickComposeReferenceDropSlotLabels;

      const targetSlots =
        zone === 'reference' ? quickComposeReferenceDropSlotsRef.current : quickComposeMainDropSlotsRef.current;
      const otherSlots =
        zone === 'reference' ? quickComposeMainDropSlotsRef.current : quickComposeReferenceDropSlotsRef.current;

      const toAdd: QuickComposeDropSlot[] = [];
      const removeFromOther: string[] = [];

      for (const rawId of assetIds) {
        const id = rawId.trim();
        if (!id) continue;
        const a = findLiveAsset(id);
        if (!a || isGroupAsset(a) || !assetLightboxRasterEligible(a)) continue;
        const previewSrc = getAssetComposeInputImage(a).trim();
        if (!previewSrc) continue;
        if (targetSlots.some((s) => s.assetId === id)) continue;
        if (otherSlots.some((s) => s.assetId === id)) removeFromOther.push(id);
        toAdd.push({
          assetId: id,
          previewSrc,
          label: workflowAssetMentionLabel(a),
        });
      }

      if (toAdd.length === 0) {
        if (assetIds.length > 0) {
          onLog?.('warn', '底部快捷栏：拖入项无可用预览图');
        }
        return;
      }

      if (removeFromOther.length > 0) {
        const removeSet = new Set(removeFromOther);
        otherSetter((prev) => renumberOther(prev.filter((s) => !removeSet.has(s.assetId))));
      }
      setter((prev) => {
        const existing = new Set(prev.map((s) => s.assetId));
        const next = [...prev];
        for (const slot of toAdd) {
          if (existing.has(slot.assetId)) continue;
          next.push(slot);
        }
        return renumber(next);
      });

      const zoneLabel = zone === 'reference' ? '参考图' : '主图';
      const parts: string[] = [`已加入 ${toAdd.length} 张${zoneLabel}`];
      if (removeFromOther.length > 0) parts.push(`${removeFromOther.length} 张已从另一区移入`);
      onLog?.('info', `底部快捷栏：${parts.join('，')}（按拖入顺序送模，拖出虚线区可移除）`);
    },
    [findLiveAsset, getAssetComposeInputImage, onLog]
  );
  appendQuickComposeDropSlotsForAssetIdsRef.current = appendQuickComposeDropSlotsForAssetIds;

  const handleQuickComposePasteAssetRefs = useCallback(
    (assetIds: string[], zone: QuickComposeDropZone = 'main') => {
      appendQuickComposeDropSlotsForAssetIds(assetIds, zone);
    },
    [appendQuickComposeDropSlotsForAssetIds]
  );

  const appendQuickComposeTextInput = useCallback(
    (text: string, sourceLabel = '文本资产') => {
      const clean = text.trim();
      if (!clean) {
        onLog?.('warn', `${sourceLabel}：没有可加入输入框的正文`);
        return;
      }
      setQuickComposeSegmentsTracked((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.type === 'text') {
          const prefix = last.value.trim() ? `${last.value.trimEnd()}\n\n` : '';
          next[next.length - 1] = { ...last, value: `${prefix}${clean}` };
          return next;
        }
        return [...next, newQuickComposeTextSegment(clean)];
      });
      onLog?.('info', `${sourceLabel}：已加入底部输入框`);
    },
    [onLog, setQuickComposeSegmentsTracked]
  );

  const handleWorkflowAssetAddToComposeInput = useCallback(
    (asset: WorkflowAsset) => {
      if (isWorkflowTextAsset(asset) && workflowAssetCurrentDisplayIsTextChannel(asset)) {
        appendQuickComposeTextInput(workflowAssetToInputText(asset), '文本资产');
        return;
      }
      const zone: QuickComposeDropZone = lightboxAssetIdRef.current ? 'reference' : 'main';
      appendQuickComposeDropSlotsForAssetIds([asset.id], zone);
    },
    [appendQuickComposeDropSlotsForAssetIds, appendQuickComposeTextInput]
  );

  const handleWorkflowTextureAddToComposeInput = useCallback(
    (asset: WorkflowAsset, node: Extract<WorkflowStepNodeGraphNodeContext, { kind: 'texture' }>) => {
      const src = String(node.src || '').trim();
      if (!src) {
        onLog?.('warn', '底部快捷栏：贴图没有可用预览');
        return;
      }
      const inputAssetId = uuid();
      const label = node.label || 'Texture';
      const rewriteTarget: WorkflowModelPbrTextureRewriteTarget = {
        assetId: asset.id,
        sourceTextureSrc: src,
        slots: node.slots,
        ...(node.materialIds && node.materialIds.length > 0 ? { materialIds: node.materialIds } : {}),
        textureLabel: label,
      };
      const inputAsset = attachInitialVgpToNewAsset({
        id: inputAssetId,
        original: src,
        displayKey: 'original',
        results: {},
        resultOrder: [],
        archived: false,
        hiddenInGrid: true,
        createdAt: Date.now(),
      });
      setAssets((prev) => [...prev, inputAsset]);
      setQuickComposeMainDropSlots((prev) =>
        renumberQuickComposeMainDropSlotLabels([
          ...prev.filter((slot) => slot.assetId !== inputAssetId),
          {
            assetId: inputAssetId,
            previewSrc: src,
            label,
            modelPbrTextureRewriteTarget: rewriteTarget,
          },
        ])
      );
      setQuickComposeReferenceDropSlots((prev) => prev.filter((slot) => slot.assetId !== inputAssetId));
      onLog?.('info', '底部快捷栏：贴图已加入主图，生成结果将写回 3D 资产');
    },
    [onLog, setAssets]
  );

  /** 3D PBR 贴图右键：加入输入框 / 打开贴图（或宿主）资产文件夹 */
  useEffect(() => {
    const onTextureAction = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowModelPbrTextureAction>).detail;
      if (!detail?.action) return;
      const hostAssetId = String(detail.assetId || '').trim();
      if (!hostAssetId) return;
      const hostAsset = assetsRef.current.find((a) => a.id === hostAssetId);
      if (detail.action === 'open-folder') {
        void (async () => {
          const textureAssetId = String(detail.textureAssetId || '').trim();
          let target =
            (textureAssetId ? assetsRef.current.find((a) => a.id === textureAssetId) : null) || null;
          const dataUrl = String(detail.dataUrl || '').trim();
          // 改代码前的贴图：只有预览、没有正式资产 → 打开前升格并落盘
          if (!target && dataUrl && hostAsset) {
            const id = uuid();
            const fileName = String(detail.fileName || '').trim() || 'texture.png';
            const slot = detail.slot;
            const materialId = String(detail.materialId || '').trim();
            const newAsset = attachInitialVgpToNewAsset({
              id,
              original: dataUrl,
              displayKey: 'original',
              results: {},
              resultOrder: [],
              archived: false,
              hiddenInGrid: true,
              pbrHostAssetId: hostAssetId,
              createdAt: Date.now(),
              resultMeta: {
                original: {
                  executedAt: Date.now(),
                  displayStepLabel: 'PBR Texture',
                  source: {
                    source: 'local',
                    capability: 'pbr_texture',
                    paramsSnapshot: {
                      pbrHostAssetId: hostAssetId,
                      ...(materialId ? { materialId } : {}),
                      ...(slot ? { slot } : {}),
                      pbrSource: 'upload',
                      fileName,
                      promotedOnOpenFolder: true,
                    },
                  },
                },
              },
            });
            setAssets((prev) => {
              let next = [...prev, newAsset];
              if (materialId && slot) {
                next = next.map((asset) => {
                  if (asset.id !== hostAssetId) return asset;
                  const doc = resolveWorkflowAssetPbrEditDoc(asset, {
                    stepKey: asset.displayKey,
                  });
                  if (!doc) return asset;
                  // 同时挂槽位与同 dataUrl 候选
                  let patched = applyPbrTextureAssetIdToDoc(doc, {
                    materialId,
                    slot,
                    kind: 'slot',
                    assetId: id,
                  });
                  const list = patched.materials[materialId]?.slotCandidates?.[slot] || [];
                  const matchCand = list.find((c) => String(c.dataUrl || '').trim() === dataUrl);
                  if (matchCand) {
                    patched = applyPbrTextureAssetIdToDoc(patched, {
                      materialId,
                      slot,
                      kind: 'candidate',
                      candidateId: matchCand.id,
                      assetId: id,
                    });
                  }
                  return writeWorkflowAssetStepPbrEdit(asset, asset.displayKey || patched.modelKey, patched);
                });
              }
              return next;
            });
            scheduleCompanionPersistOriginalAny(id, dataUrl);
            target = newAsset;
            onLog?.('info', '旧贴图尚未落盘，已创建本地资产并写入…');
          }
          if (!target) target = hostAsset;
          if (!target) {
            onLog?.('warn', '打开资产文件夹失败：未找到贴图或宿主资产');
            return;
          }
          await handleWorkflowAssetOpenFolder(target);
        })();
        return;
      }
      if (detail.action === 'add-to-compose') {
        if (!hostAsset) {
          onLog?.('warn', '添加到输入框失败：未找到宿主 3D 资产');
          return;
        }
        const textureAssetId = String(detail.textureAssetId || '').trim();
        const textureAsset = textureAssetId
          ? assetsRef.current.find((a) => a.id === textureAssetId)
          : null;
        const src =
          (textureAsset ? getAssetDisplayImage(textureAsset).trim() : '') ||
          String(detail.dataUrl || '').trim();
        if (!src && !textureAsset) {
          onLog?.('warn', '底部快捷栏：贴图没有可用预览');
          return;
        }
        const slotKey = detail.slots?.[0] || 'baseColor';
        if (textureAsset) {
          const label = detail.textureLabel || detail.fileName || 'Texture';
          const rewriteTarget: WorkflowModelPbrTextureRewriteTarget = {
            assetId: hostAsset.id,
            sourceTextureSrc: src || getAssetDisplayImage(textureAsset),
            sourceTextureAssetId: textureAsset.id,
            slots: detail.slots?.length ? detail.slots : ['baseColor'],
            ...(detail.materialIds?.length ? { materialIds: detail.materialIds } : {}),
            textureLabel: label,
          };
          setQuickComposeMainDropSlots((prev) =>
            renumberQuickComposeMainDropSlotLabels([
              ...prev.filter((slot) => slot.assetId !== textureAsset.id),
              {
                assetId: textureAsset.id,
                previewSrc: src || getAssetDisplayImage(textureAsset),
                label,
                modelPbrTextureRewriteTarget: rewriteTarget,
              },
            ])
          );
          setQuickComposeReferenceDropSlots((prev) =>
            prev.filter((slot) => slot.assetId !== textureAsset.id)
          );
          onLog?.('info', '底部快捷栏：贴图资产已加入主图，生成结果将写回 3D 资产');
          return;
        }
        handleWorkflowTextureAddToComposeInput(hostAsset, {
          kind: 'texture',
          nodeId: `pbr-tex-node:${hostAssetId}:${slotKey}`,
          textureId: `pbr-tex:${hostAssetId}:${slotKey}`,
          label: detail.textureLabel || detail.fileName || 'Texture',
          src,
          slots: detail.slots?.length ? detail.slots : ['baseColor'],
          ...(detail.materialIds?.length ? { materialIds: detail.materialIds } : {}),
        });
      }
    };
    window.addEventListener(WORKFLOW_MODEL_PBR_TEXTURE_ACTION_EVENT, onTextureAction);
    return () => {
      window.removeEventListener(WORKFLOW_MODEL_PBR_TEXTURE_ACTION_EVENT, onTextureAction);
    };
  }, [
    getAssetDisplayImage,
    handleWorkflowAssetOpenFolder,
    handleWorkflowTextureAddToComposeInput,
    onLog,
    scheduleCompanionPersistOriginalAny,
    setAssets,
    setQuickComposeMainDropSlots,
    setQuickComposeReferenceDropSlots,
  ]);

  const handleLightboxNodeGraphMenuAction = useCallback(
    (action: WorkflowStepNodeGraphMenuAction, node: WorkflowStepNodeGraphNodeContext) => {
      const asset = lightboxAsset;
      if (!asset) return;
      if (action === 'add-to-input') {
        if (node.kind === 'texture') {
          handleWorkflowTextureAddToComposeInput(asset, node);
          return;
        }
        handleWorkflowAssetAddToComposeInput(asset);
        return;
      }
      if (action === 'copy-original') {
        void handleWorkflowAssetCopyImage(asset);
        return;
      }
      if (action === 'copy-id') {
        void handleWorkflowAssetCopyId(asset);
        return;
      }
      if (action === 'open-folder') {
        void handleWorkflowAssetOpenFolder(asset);
        return;
      }
      if (action === 'show-current') {
        if (node.kind === 'texture') {
          if (lightboxTexturePreviewSrc === node.src) return;
          setLightboxTexturePreview({ assetId: asset.id, src: node.src });
          setLightboxPreviewLayout('flat');
          return;
        }
        if (!lightboxTexturePreviewSrc && asset.displayKey === node.displayKey) return;
        setLightboxTexturePreview(null);
        setDisplayKey(asset.id, node.displayKey);
      }
    },
    [
      handleWorkflowAssetAddToComposeInput,
      handleWorkflowAssetCopyId,
      handleWorkflowAssetCopyImage,
      handleWorkflowAssetOpenFolder,
      handleWorkflowTextureAddToComposeInput,
      lightboxAsset,
      lightboxTexturePreviewSrc,
    ]
  );

  const removeQuickComposeMainDropSlot = useCallback((assetId: string) => {
    const id = assetId.trim();
    if (!id) return;
    setQuickComposeMainDropSlots((prev) => {
      if (!prev.some((s) => s.assetId === id)) return prev;
      return renumberQuickComposeMainDropSlotLabels(prev.filter((s) => s.assetId !== id));
    });
  }, []);

  const removeQuickComposeReferenceDropSlot = useCallback((assetId: string) => {
    const id = assetId.trim();
    if (!id) return;
    setQuickComposeReferenceDropSlots((prev) => {
      if (!prev.some((s) => s.assetId === id)) return prev;
      return renumberQuickComposeReferenceDropSlotLabels(prev.filter((s) => s.assetId !== id));
    });
  }, []);

  const moveQuickComposeDropSlot = useCallback((assetId: string, toZone: QuickComposeDropZone) => {
    const id = assetId.trim();
    if (!id) return;
    const fromMain = quickComposeMainDropSlotsRef.current.find((s) => s.assetId === id);
    const fromRef = quickComposeReferenceDropSlotsRef.current.find((s) => s.assetId === id);
    const slot = fromMain ?? fromRef;
    if (!slot) return;
    const fromZone: QuickComposeDropZone = fromMain ? 'main' : 'reference';
    if (fromZone === toZone) return;

    if (fromZone === 'main') {
      setQuickComposeMainDropSlots((prev) =>
        renumberQuickComposeMainDropSlotLabels(prev.filter((s) => s.assetId !== id))
      );
      setQuickComposeReferenceDropSlots((prev) =>
        renumberQuickComposeReferenceDropSlotLabels([
          ...prev.filter((s) => s.assetId !== id),
          slot,
        ])
      );
    } else {
      setQuickComposeReferenceDropSlots((prev) =>
        renumberQuickComposeReferenceDropSlotLabels(prev.filter((s) => s.assetId !== id))
      );
      setQuickComposeMainDropSlots((prev) =>
        renumberQuickComposeMainDropSlotLabels([...prev.filter((s) => s.assetId !== id), slot])
      );
    }
  }, []);

  const reorderQuickComposeDropSlot = useCallback(
    (assetId: string, zone: QuickComposeDropZone, toIndex: number) => {
      const id = assetId.trim();
      if (!id) return;
      const setter =
        zone === 'reference' ? setQuickComposeReferenceDropSlots : setQuickComposeMainDropSlots;
      const renumber =
        zone === 'reference'
          ? renumberQuickComposeReferenceDropSlotLabels
          : renumberQuickComposeMainDropSlotLabels;
      setter((prev) => {
        const from = prev.findIndex((s) => s.assetId === id);
        if (from < 0) return prev;
        const target = Math.max(0, Math.min(prev.length - 1, toIndex));
        if (from === target) return prev;
        const next = [...prev];
        const [item] = next.splice(from, 1);
        next.splice(target, 0, item!);
        return renumber(next);
      });
    },
    []
  );

  const quickComposeShowGenImageSettings =
    quickComposeMode === 'image' || quickComposeMode === 'auto';
  const quickComposeShowGenTextSettings =
    quickComposeMode === 'text' || quickComposeMode === 'auto';
  const quickComposeShowGenVideoSettings =
    quickComposeMode === 'video';
  const quickComposeShowGenModel3dSettings =
    quickComposeMode === '3d';

  const quickComposeAllowBatchCount =
    quickComposeMode === 'text' || quickComposeMode === 'image' || quickComposeMode === 'auto';

  useEffect(() => {
    if (!quickComposeAllowBatchCount) setQuickComposeCount(1);
  }, [quickComposeAllowBatchCount]);

  useEffect(() => {
    const saved = readLocalJson<WorkspaceQuickComposeComposeMode | ''>(
      quickComposeModeStorageKey,
      '',
      (parsed) =>
        parsed === 'text' || parsed === 'image' || parsed === 'video' || parsed === '3d' || parsed === 'auto'
          ? parsed
          : null
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
      const asset = assetsRef.current.find((x) => x.id === pending.assetId);
      const orderPreview = [...(asset?.resultOrder || []).filter((k) => k !== pending.resultKey), pending.resultKey];
      const slotIndex = resolveWorkflowImageSlotIndex(orderPreview, pending.resultKey);
      const put = await putWorkflowResultImageToCompanion(
        base,
        projectId,
        pending.assetId,
        pending.resultKey,
        composite,
        { slotIndex }
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
            ...(put.previewKey
              ? {
                  resultsPreviewCompanionKeys: {
                    ...(a.resultsPreviewCompanionKeys || {}),
                    [resultKey]: put.previewKey,
                  },
                }
              : {}),
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
      const asset = assetsRef.current.find((x) => x.id === pending.assetId);
      const orderPreview = [...(asset?.resultOrder || []).filter((k) => k !== pending.resultKey), pending.resultKey];
      const slotIndex = resolveWorkflowImageSlotIndex(orderPreview, pending.resultKey);
      const put = await putWorkflowResultImageToCompanion(
        base,
        projectId,
        pending.assetId,
        pending.resultKey,
        pending.dataUrl,
        { slotIndex }
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
            ...(put.previewKey
              ? {
                  resultsPreviewCompanionKeys: {
                    ...(a.resultsPreviewCompanionKeys || {}),
                    [resultKey]: put.previewKey,
                  },
                }
              : {}),
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

  const handleLightboxDownloadCurrent = useCallback(async () => {
    const asset = lightboxAsset;
    if (!asset) return;
    if (lightboxTexturePreviewSrc) {
      await triggerImageDownload(lightboxTexturePreviewSrc, `workflow-texture-${asset.id.slice(0, 6)}`);
      return;
    }
    const variant = resolveWorkflowAssetActiveVariant(asset);
    const mediaUrl =
      variant?.kind === 'model3d'
        ? variant.modelUrls?.find((url) => String(url || '').trim()) || variant.url || ''
        : variant?.kind && variant.kind !== 'image' && variant.kind !== 'text'
          ? variant.url || ''
          : '';
    if (mediaUrl.trim()) {
      const fileName =
        String(variant?.label || asset.modelSourceName || asset.textTitle || asset.id || 'asset')
          .trim()
          .replace(/[\\/:*?"<>|]+/g, '-') || 'asset';
      const a = document.createElement('a');
      a.href = mediaUrl;
      a.download = fileName;
      a.rel = 'noopener';
      a.click();
      appendWorkflowAuditEvent({
        level: 'info',
        code: WORKFLOW_AUDIT_CODES.EXPORT_IMAGE,
        assetId: asset.id,
        displayKey: asset.displayKey,
        message: '工作流大图：下载当前媒体预览文件',
        detail: { context: 'workflow_asset_preview_shell', kind: variant?.kind },
      });
      return;
    }
    if (!lightboxShowsImage) {
      const title = (asset.textTitle || '').trim();
      const body = getAssetDisplayText(asset);
      const text = title ? `${title}\n\n${body}` : body;
      if (!text.trim()) {
        onLog?.('warn', '当前预览没有可下载的直接文件链接');
        return;
      }
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = `workflow-text-${asset.id.slice(0, 6)}.txt`;
        a.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      appendWorkflowAuditEvent({
        level: 'info',
        code: WORKFLOW_AUDIT_CODES.EXPORT_TEXT_PREVIEW,
        assetId: asset.id,
        displayKey: asset.displayKey,
        message: '工作流大图：下载文字预览为 TXT',
        detail: { context: 'workflow_asset_preview_shell' },
      });
      return;
    }
    appendWorkflowAuditEvent({
      level: 'info',
      code: WORKFLOW_AUDIT_CODES.EXPORT_IMAGE,
      assetId: asset.id,
      displayKey: asset.displayKey,
      message: '工作流大图：下载当前预览图',
      detail: { context: 'workflow_asset_preview_shell' },
    });
    await triggerImageDownload(getAssetDisplayImage(asset), `workflow-preview-${asset.id.slice(0, 6)}`);
  }, [getAssetDisplayImage, getAssetDisplayText, lightboxAsset, lightboxShowsImage, lightboxTexturePreviewSrc, onLog]);

  const handleLightboxCopyCurrent = useCallback(async () => {
    if (!lightboxAsset) return;
    if (lightboxTexturePreviewSrc) {
      const outcome = await copyWorkflowAssetOriginalImageToClipboard({ imageSrc: lightboxTexturePreviewSrc });
      onLog?.(outcome === 'ok' ? 'info' : 'warn', outcome === 'ok' ? '已复制当前贴图预览' : '当前贴图预览复制失败');
      return;
    }
    const variant = resolveWorkflowAssetActiveVariant(lightboxAsset);
    if (lightboxShowsImage) {
      await handleWorkflowAssetCopyImage(lightboxAsset);
      return;
    }
    const mediaReference =
      variant?.kind && variant.kind !== 'text'
        ? variant.url ||
          variant.objectKey ||
          variant.companionKey ||
          variant.modelUrls?.find((url) => String(url || '').trim()) ||
          ''
        : '';
    if (mediaReference.trim() && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(mediaReference);
      onLog?.('info', '已复制当前媒体预览引用');
      return;
    }
    if (navigator.clipboard?.writeText) {
      const title = (lightboxAsset.textTitle || '').trim();
      const body = getAssetDisplayText(lightboxAsset);
      await navigator.clipboard.writeText(title ? `${title}\n\n${body}` : body);
      onLog?.('info', '已复制当前文本预览');
      return;
    }
    await handleWorkflowAssetCopyId(lightboxAsset);
  }, [
    getAssetDisplayText,
    handleWorkflowAssetCopyId,
    handleWorkflowAssetCopyImage,
    lightboxAsset,
    lightboxShowsImage,
    lightboxTexturePreviewSrc,
    onLog,
  ]);

  const handleLightboxStartCrop = useCallback(() => {
    applyLightboxToolChange(lightboxRememberedCrop);
  }, [applyLightboxToolChange, lightboxRememberedCrop]);

  const handleLightboxCapturePreview = useCallback(async () => {
    const asset = lightboxAsset;
    if (!asset) return;
    const dataUrl =
      lightboxPreviewLayoutRef.current === 'pano'
        ? lightboxPanoViewerRef.current?.captureViewDataUrl('image/png')
        : lightboxWebPreviewCaptureApiRef.current?.captureCurrentViewAsDataUrl();
    if (!dataUrl) {
      onLog?.('warn', '当前预览画面暂不可截图，请等待预览加载完成');
      return;
    }
    await triggerImageDownload(dataUrl, `workflow-preview-view-${asset.id.slice(0, 6)}`);
  }, [lightboxAsset, onLog]);

  const handleLightboxAddCurrentToInput = useCallback(() => {
    const asset = lightboxAsset;
    if (!asset) return;
    const variant = resolveWorkflowAssetActiveVariant(asset);
    if (variant?.kind === 'text') {
      const title = (asset.textTitle || '').trim();
      const body = variant.text || getAssetDisplayText(asset);
      appendQuickComposeTextInput(title ? `${title}\n\n${body}` : body, '文本预览');
      return;
    }
    const location =
      variant?.url ||
      variant?.objectKey ||
      variant?.companionKey ||
      variant?.modelUrls?.find(Boolean) ||
      getAssetDisplayImage(asset);
    const lines = [
      `[${(variant?.kind || asset.assetKind || 'image').toUpperCase()}资产] ${variant?.label || asset.id}`,
      `assetId: ${asset.id}`,
      `displayKey: ${asset.displayKey}`,
    ];
    if (location) lines.push(`location: ${location}`);
    appendQuickComposeTextInput(lines.join('\n'), '媒体资产引用');
  }, [appendQuickComposeTextInput, getAssetDisplayImage, getAssetDisplayText, lightboxAsset]);

  const handleLightboxUseCapabilityOutputAsInput = useCallback(
    (output: AssetCapabilityOutputAsset) => {
      const text =
        (output.kind === 'text' ? output.text : '') ||
        output.url ||
        output.objectKey ||
        output.companionKey ||
        output.label;
      if (!text.trim()) return;
      appendQuickComposeTextInput(text, '预览能力输出');
    },
    [appendQuickComposeTextInput]
  );

  const handleLightboxSaveCapabilityOutput = useCallback(
    (output: AssetCapabilityOutputAsset) => {
      const text =
        (output.kind === 'text' ? output.text : '') ||
        output.url ||
        output.objectKey ||
        output.companionKey;
      if (!text.trim()) {
        onLog?.('warn', '当前能力输出没有可保存内容');
        return;
      }
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
        textTitle: output.label || '预览能力输出',
        textBody: clampWorkflowTextBody(text),
      });
      setAssets((prev) => [...prev, asset]);
      onLog?.('info', '已将预览能力输出保存为文本资产');
    },
    [onLog, setAssets]
  );

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
    document.documentElement.setAttribute('data-ac-lightbox-raster-shortcuts', '');
    return () => document.documentElement.removeAttribute('data-ac-lightbox-raster-shortcuts');
  }, [lightboxAssetId, lightboxRasterChrome]);

  useEffect(() => {
    if (!lightboxAssetId) return;
    document.documentElement.setAttribute('data-ac-lightbox-open', '');
    return () => document.documentElement.removeAttribute('data-ac-lightbox-open');
  }, [lightboxAssetId]);

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

  /** 大纲 / 画布拖入底部快捷栏：加入主图区或参考图区 */
  const handleQuickComposeWorkflowDrop = useCallback(
    (e: React.DragEvent, zone: QuickComposeDropZone = 'main') => {
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
      appendQuickComposeDropSlotsForAssetIds(assetIds, zone);
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
    if (favoriteDragActiveRef.current) return;
    if (Date.now() < favoriteRemoveSuppressUntilRef.current) return;
    setFavoriteActionIds((prev) => prev.filter((id) => id !== actionId));
  }, []);

  const onFavoriteDragLifecycle = useCallback((phase: 'start' | 'end') => {
    if (phase === 'start') {
      favoriteDragActiveRef.current = true;
      return;
    }
    favoriteDragActiveRef.current = false;
    // dragEnd 后浏览器常补发 click；若落在「移出常用 ×」上会误删
    favoriteRemoveSuppressUntilRef.current = Date.now() + 700;
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
        tripoApiKey: AI_GATEWAY_TRIPO_PLATFORM_KEY,
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
            const x = findLiveAsset(id);
            return x != null && assetAllowedForCapabilityDrop(x, mod);
          });
          effectiveIds.forEach((id) => {
            const a = findLiveAsset(id);
            if (a) {
              targets.push({
                assetId: id,
                inputImage: getAssetComposeInputImage(a),
                inputSourceDisplayKey: a.displayKey,
                ...(isWorkflowTextAsset(a) &&
                (workflowAssetCurrentDisplayIsTextChannel(a) || workflowPresetAcceptsTextCardDrag(mod))
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
              const passChildText = workflowAssetAllowedForCapabilityDrop(child, mod);
              if (passChildText) {
                targets.push({
                  assetId: child.id,
                  inputImage: getAssetDisplayImage(child),
                  inputSourceDisplayKey: child.displayKey,
                  sourceGroupAssetId: groupId,
                  sourceItemIndex: itemIndex,
                  ...(isWorkflowTextAsset(child) &&
                  (workflowAssetCurrentDisplayIsTextChannel(child) ||
                    workflowPresetAcceptsTextCardDrag(mod))
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
              const passLegacyChildText = workflowAssetAllowedForCapabilityDrop(child, mod);
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
    [assets, findLiveAsset, getAssetComposeInputImage, assetAllowedForCapabilityDrop, getEffectiveAssetIdsForAction]
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
              draggingAssetIdsRef.current ?? draggingAssetIds,
              draggingGroupItemsRef.current ?? draggingGroupItems,
              dropEvent?.dataTransfer ?? null
            );
      if (sources.length === 0) {
        return;
      }

      const collectPromptTargets = (incoming: WorkflowDragSource[]): PromptTweakTarget[] => {
        const targets: PromptTweakTarget[] = [];
        for (const source of incoming) {
          if (source.kind === 'root') {
            const effectiveIds = getEffectiveAssetIdsForAction(source.assetIds).filter((id) => {
              const x = findLiveAsset(id);
              if (x == null || !assetAllowedForCapabilityDrop(x, mod)) return false;
              return true;
            });
            effectiveIds.forEach((id) => {
              const a = findLiveAsset(id);
              if (a) {
                targets.push({
                  assetId: id,
                  inputImage: getAssetComposeInputImage(a),
                  inputSourceDisplayKey: a.displayKey,
                  ...(isWorkflowTextAsset(a) &&
                  (workflowAssetCurrentDisplayIsTextChannel(a) ||
                    workflowPresetAcceptsTextCardDrag(mod))
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
                const passChildText = workflowAssetAllowedForCapabilityDrop(child, mod);
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
                const passLegacyChildText = workflowAssetAllowedForCapabilityDrop(child, mod);
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
          const rootCandidateIds = getEffectiveAssetIdsForAction(source.assetIds);
          const effectiveIds = rootCandidateIds.filter((id) => {
            const x = findLiveAsset(id);
            return x != null && assetAllowedForCapabilityDrop(x, mod);
          });
          if (rootCandidateIds.length > 0 && effectiveIds.length === 0) {
            onLog?.('warn', '当前显示内容与该能力不匹配（请切换到对应版本）');
          }
          const allowTextAssetsForGenerateCount =
            mod.category === 'text_to_text' || mod.category === 'text_to_image';
          const { rootIds, cloneTaskSeeds } =
            generateCount > 1
              ? expandRootAssetsForGenerateCount(effectiveIds, generateCount, {
                  allowTextAssetsForExpansion: allowTextAssetsForGenerateCount,
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
          if (rootTasks.length > 0) {
            if (workshopDiskOpen && cloneTaskSeeds.length > 0) {
              void (async () => {
                const newAssets = cloneTaskSeeds.map((seed) => ({
                  ...seed.sourceAsset,
                  id: seed.targetAssetId,
                }));
                const cloneAssetIds = new Set(newAssets.map((a) => a.id));
                const cloneTasks = rootTasks.filter((t) => cloneAssetIds.has(t.assetId));
                const keepTasks = rootTasks.filter((t) => !cloneAssetIds.has(t.assetId));
                const remapped = await enqueueWorkshopGenerationBatch(newAssets, cloneTasks);
                if (!remapped.ok) return;
                setPending((prev) => [...prev, ...keepTasks, ...remapped.tasks]);
              })();
            } else {
              setPending((prev) => [...prev, ...rootTasks]);
            }
          }
          else if (rootCandidateIds.length > 0) {
            onLog?.('warn', `拖入「${mod.label}」失败：选中的资产无法作为输入（请确认图片已加载预览）`);
          }
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
      findLiveAsset,
      assetAllowedForCapabilityDrop,
      getAssetComposeInputImage,
      fileSourceApi,
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
      onLog,
      enqueueWorkshopGenerationBatch,
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

  const activePaneNode = Math.max(0, Math.min(1, Math.round(workspacePane)));
  const topTitleColumns = useMemo(() => {
    if (activePaneNode === 0) {
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
                    aria-label="减少每行列数"
                  >
                    −
                  </button>
                  <span className={TITLE_ROW_STEPPER_VALUE}>{columnCount}</span>
                  <button
                    type="button"
                    onClick={() => setColumnCount((n) => Math.min(6, n + 1))}
                    disabled={columnCount >= 6}
                    className={TITLE_ROW_STEPPER_BTN}
                    aria-label="增加每行列数"
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
                  onClick={createWorkflowTextAssetAndOpen}
                  className={TITLE_ROW_BTN_NEUTRAL}
                  title="新建文本资产并打开编辑"
                >
                  新建文本
                </button>
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
              {!showArchived && (
                <button
                  type="button"
                  onClick={() => {
                    const id = addWorkflowAssetSetAsset();
                    openAssetSetPanel(id);
                  }}
                  className={TITLE_ROW_BTN_NEUTRAL}
                  title="新建资产集并打开拆解面板"
                >
                  新建资产集
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
        ...(showFunctionSidebar
          ? [
              {
          title: '功能区',
          desc: '基础能力与复合能力',
          actions: (
            <div className="flex flex-col items-end gap-1 whitespace-nowrap">
              <div className="flex items-center gap-1.5">
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
            </div>
          ),
              } as const,
            ]
          : []),
      ];
      if (!showFunctionSidebar) return [workspaceAndFunctionCols[0]!];
      return [workspaceAndFunctionCols[1]!, workspaceAndFunctionCols[0]!];
    }
    /** 小盒子预设页：顶栏显示能力预设工具；功能区仍在左侧大盒子中 */
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
    creditBalance,
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
    storyboardExportRunning,
    storyboardExportPct,
    storyboardExportTitle,
    addWorkflowStoryboardTableAsset,
    openStoryboardTablePanel,
    createWorkflowTextAssetAndOpen,
    showFunctionSidebar,
  ]);
  const sidebarOpsAllowed = workflowDragSourceAllowsSidebarOps(
    parseWorkflowDragSource(draggingAssetIds, draggingGroupItems),
    showArchived
  );
  const quickComposeInLightbox = Boolean(
    lightboxAsset && !showArchived && !lightboxUiHidden
  );
  const quickComposeInRasterLightbox = Boolean(quickComposeInLightbox && lightboxRasterChrome);
  const handleQuickComposeInputExpandedChange = useCallback(
    (expanded: boolean) => {
      onWorkspaceQuickComposeExpandedChange?.(expanded);
    },
    [onWorkspaceQuickComposeExpandedChange]
  );
  const quickComposeBarVisible =
    !promptTweakModal &&
    (quickComposeInLightbox || (quickComposeShellActive && !lightboxAsset));

  // Phase 2 / P5: single project thread; lightbox only changes surface context chips
  const activeQuickComposeThread = workspaceQuickComposeThread;

  /** 积分加载中仍允许输入；仅登录/余额已确认不足时禁用输入 */
  const quickComposeChatDockInputDisabled = quickComposeCreditsBypass
    ? false
    : !String(preferenceScope ?? '').trim()
      ? quickComposeChatCreditsHardBlocked
      : creditBalance != null && quickComposeChatCreditsHardBlocked;

  const quickComposeHasSendableContent = composerHasSendableContent({
    draft: quickComposeDraft,
    segments: quickComposeSegments,
    promptCardCount: quickComposeInLightbox ? 0 : quickComposePromptCards.length,
  });

  const quickComposeChatDockSubmitDisabled =
    quickComposeChatCreditsHardBlocked ||
    !quickComposeHasSendableContent ||
    quickComposeThreadHasInFlightAssistant(activeQuickComposeThread);

  const quickComposeChatDockSubmitDisabledReason = resolveComposerSubmitDisabledReason({
    threadBusy: quickComposeThreadHasInFlightAssistant(activeQuickComposeThread),
    creditsBlocked: quickComposeChatCreditsHardBlocked,
    creditsReason: quickComposeSubmitDisabledReason,
    draftEmpty: !quickComposeHasSendableContent,
  });

  useEffect(() => {
    if (!quickComposeBarVisible) return;
    let disposed = false;
    const refresh = async () => {
      const result = await readRuntimeExternalAppSnapshotFromCompanion();
      if (disposed) return;
      setRuntimeExternalApps(result.apps);
      setRuntimeExternalRisks(result.risks);
    };
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, 15_000);
    return () => {
      disposed = true;
      window.clearInterval(id);
    };
  }, [quickComposeBarVisible]);

  const quickComposeChatDockHandlers = useMemo((): QuickComposeChatDockHandlers | null => {
    if (!quickComposeBarVisible) return null;
    const selectedIds = [...selectedAssetIds].map((id) => id.trim()).filter(Boolean);
    const lightboxAsset = lightboxAssetId ? findLiveAsset(lightboxAssetId) : null;
    const selectedAssetList = selectedIds
      .map((id) => findLiveAsset(id))
      .filter((a): a is WorkflowAsset => Boolean(a));
    const selectionStatusTone: QuickComposeChatDockHandlers['selectionStatusTone'] =
      lightboxAsset ? 'preview' : selectedIds.length > 0 || selectedGroupItemKeys.size > 0 ? 'active' : 'idle';
    const selectionStatusLabel = lightboxAsset
      ? `\u5f53\u524d\u9884\u89c8\uff1a${workflowAssetMentionLabel(lightboxAsset)}`
      : selectedGroupItemKeys.size > 0
        ? `\u7ec4\u5185\u5df2\u9009 ${selectedGroupItemKeys.size} \u4e2a\u8d44\u4ea7`
        : selectedAssetList.length > 1
          ? `\u5f53\u524d\u9009\u4e2d ${selectedAssetList.length} \u4e2a\u8d44\u4ea7`
          : selectedAssetList[0]
            ? `\u5f53\u524d\u9009\u4e2d\uff1a${workflowAssetMentionLabel(selectedAssetList[0])}`
            : '\u5f53\u524d\u672a\u9009\u4e2d\u8d44\u4ea7';
    const threadTitle = quickComposeInLightbox
      ? (() => {
          const asset = lightboxAssetId ? findLiveAsset(lightboxAssetId) : null;
          return asset ? workflowAssetMentionLabel(asset) : '\u5927\u56fe\u9884\u89c8';
        })()
      : workspaceProjectChrome?.activeProjectName || '\u5de5\u4f5c\u533a';    const messages: QuickComposeChatMessageView[] = activeQuickComposeThread
      ? mapQuickComposeThreadMessagesToChatViews(activeQuickComposeThread.messages, {
          assets,
          pending,
          executingQueue,
          getAssetDisplayImage,
          getAssetLabel: workflowAssetMentionLabel,
          selectedAssetIds: [...selectedAssetIds],
        })
      : [];
    const perceptionContext = buildQuickComposePerceptionContext();
    return {
      messages,
      threadTitle,
      isInputDisabled: quickComposeChatDockInputDisabled,
      isSendDisabled: quickComposeChatDockSubmitDisabled,
      selectionStatusLabel,
      selectionStatusTone,
      perceptionContext,
      onResultPreview: handleQuickComposeResultPreview,
      onSend: handleQuickComposeChatSend,
      onRetry: handleQuickComposeChatRetry,
      onAction: handleQuickComposeChatAction,
      onCancel: handleQuickComposeChatCancel,
    };
  }, [
    activeQuickComposeThread,
    quickComposeBarVisible,
    quickComposeInLightbox,
    quickComposeChatDockInputDisabled,
    quickComposeChatDockSubmitDisabled,
    handleQuickComposeChatSend,
    handleQuickComposeChatRetry,
    handleQuickComposeChatAction,
    handleQuickComposeChatCancel,
    handleQuickComposeResultPreview,
    buildQuickComposePerceptionContext,
    quickComposeCreditsBypass,
    preferenceScope,
    creditBalance,
    lightboxAssetId,
    assets,
    findLiveAsset,
    pending,
    executingQueue,
    getAssetDisplayImage,
    selectedAssetIds,
    selectedGroupItemKeys,
    workspaceProjectChrome?.activeProjectName,
  ]);

  useEffect(() => {
    onQuickComposeChatDockHandlersChange?.(quickComposeChatDockHandlers);
    return () => {
      onQuickComposeChatDockHandlersChange?.(null);
    };
  }, [onQuickComposeChatDockHandlersChange, quickComposeChatDockHandlers]);

  const quickComposeBarCommonProps = useMemo(
    () => ({
      visible: quickComposeBarVisible,
      placement: (quickComposeInLightbox ? 'lightbox' : 'floating') as 'lightbox' | 'floating',
      composeMode: quickComposeMode,
      onComposeModeChange: setQuickComposeMode,
      inputPresetsActive: quickComposeInLightbox ? false : quickComposePromptCards.length > 0,
      segments: quickComposeSegments,
      onSegmentsChange: setQuickComposeSegmentsTracked,
      mentionCandidates: quickComposeMentionCandidates,
      mainDropSlots: quickComposeMainDropSlots,
      referenceDropSlots: quickComposeReferenceDropSlots,
      onRemoveMainDropSlot: removeQuickComposeMainDropSlot,
      onRemoveReferenceDropSlot: removeQuickComposeReferenceDropSlot,
      onMoveDropSlot: moveQuickComposeDropSlot,
      onReorderDropSlot: reorderQuickComposeDropSlot,
      hideMainDropZone: quickComposeInLightbox,
      pasteAssetRefZone: quickComposeInLightbox ? ('reference' as const) : undefined,
      maxMentions: quickComposeMaxReferenceImages,
      onSubmit: quickComposeChatDockHandlers
        ? quickComposeChatDockHandlers.onSend
        : quickComposeInRasterLightbox
          ? () => void submitLightboxQuickCompose()
          : (invoke?: QuickComposeSubmitInvokeOptions) => void submitQuickCompose(invoke),
      inputDisabled: quickComposeChatDockHandlers?.isInputDisabled ?? quickComposeSubmitDisabled,
      submitDisabled: quickComposeChatDockHandlers?.isSendDisabled ?? quickComposeSubmitDisabled,
      submitDisabledReason: quickComposeChatDockHandlers
        ? quickComposeChatDockSubmitDisabledReason
        : quickComposeSubmitDisabledReason,
      showGenImageSettings: quickComposeShowGenImageSettings,
      showGenTextSettings: quickComposeShowGenTextSettings,
      showGenVideoSettings: quickComposeShowGenVideoSettings,
      showGenModel3dSettings: quickComposeShowGenModel3dSettings,
      allowBatchCount: quickComposeAllowBatchCount,
      onComposeInputCapabilityDrop: quickComposeInLightbox ? undefined : onQuickComposeInputCapabilityDrop,
      onComposeInputWorkflowDrop: quickComposeInLightbox ? undefined : handleQuickComposeWorkflowDrop,
      onPasteAssetRefs: handleQuickComposePasteAssetRefs,
      promptCards: quickComposeInLightbox ? [] : quickComposePromptCards,
      onRemovePromptCard: (key: string) =>
        setQuickComposePromptCards((prev) => prev.filter((c) => c.key !== key)),
      genSettings: {
        imageModelRegistryId: quickComposeImageModel,
        onImageModelRegistryId: setQuickComposeImageModel,
        textModelRegistryId: quickComposeTextModel,
        onTextModelRegistryId: setQuickComposeTextModel,
        videoModelRegistryId: quickComposeVideoModel || quickComposeDefaultVideoModel,
        onVideoModelRegistryId: setQuickComposeVideoModel,
        videoDurationSeconds: quickComposeVideoDuration,
        onVideoDurationSeconds: setQuickComposeVideoDuration,
        videoAspectRatio: quickComposeVideoAspect,
        onVideoAspectRatio: setQuickComposeVideoAspect,
        videoResolution: quickComposeVideoResolution,
        onVideoResolution: setQuickComposeVideoResolution,
        videoMotionStrength: quickComposeVideoMotion,
        onVideoMotionStrength: setQuickComposeVideoMotion,
        model3dRegistryId: quickComposeModel3dModel || quickComposeDefaultModel3d,
        onModel3dRegistryId: setQuickComposeModel3dModel,
        model3dQuality: quickComposeModel3dQuality,
        onModel3dQuality: setQuickComposeModel3dQuality,
        model3dGeometryQuality: quickComposeModel3dGeometryQuality,
        onModel3dGeometryQuality: setQuickComposeModel3dGeometryQuality,
        model3dTextureQuality: quickComposeModel3dTextureQuality,
        onModel3dTextureQuality: setQuickComposeModel3dTextureQuality,
        model3dFormat: quickComposeModel3dFormat,
        onModel3dFormat: setQuickComposeModel3dFormat,
        model3dTexture: quickComposeModel3dTexture,
        onModel3dTexture: setQuickComposeModel3dTexture,
        model3dPbr: quickComposeModel3dPbr,
        onModel3dPbr: setQuickComposeModel3dPbr,
        aspectRatio: quickComposeAspect,
        onAspectRatio: setQuickComposeAspect,
        imageSize: quickComposeSize,
        onImageSize: setQuickComposeSize,
        count: quickComposeCount,
        onCount: setQuickComposeCount,
        understand: quickComposeUnderstand,
        onUnderstand: setQuickComposeUnderstand,
      },
      placeholderOverride: quickComposeInLightbox
        ? '\u63cf\u8ff0\u4fee\u6539\u610f\u56fe\uff1b\u9700\u8981\u65f6\u53ef @ \u5f53\u524d\u753b\u9762\u6216\u5176\u5b83\u8d44\u4ea7'
        : undefined,
      chatDockProps: quickComposeChatDockHandlers
        ? {
            messages: quickComposeChatDockHandlers.messages,
            selectionStatusLabel: quickComposeChatDockHandlers.selectionStatusLabel,
            selectionStatusTone: quickComposeChatDockHandlers.selectionStatusTone,
            perceptionContext: quickComposeChatDockHandlers.perceptionContext,
            onResultPreview: quickComposeChatDockHandlers.onResultPreview,
            onRetryMessage: quickComposeChatDockHandlers.onRetry,
            onMessageAction: quickComposeChatDockHandlers.onAction,
            onCancelMessage: quickComposeChatDockHandlers.onCancel,
            onOpenPanel: (panel) => {
              if (panel === 'memory') {
                refreshProjectAgentMemoryPanel();
                onLog?.('info', '项目 Agent：已打开记忆管理入口');
              } else if (panel === 'skills') {
                refreshProjectAgentSkillPanel();
                onLog?.('info', 'Project Agent：已打开 Skill 管理入口');
              }
            },
            memoryEntries: projectAgentMemoryEntries,
            onToggleMemory: handleProjectAgentToggleMemory,
            onDeleteMemory: handleProjectAgentDeleteMemory,
            skillEntries: projectAgentSkillEntries,
            onToggleSkill: handleProjectAgentToggleSkill,
            onDeleteSkill: handleProjectAgentDeleteSkill,
            onInstallSampleSkill: handleProjectAgentInstallSampleSkill,
            onImportSkillPreview: handleProjectAgentImportSkillPreview,
            onClearChat: handleQuickComposeClearChat,
            onLoadEarlier: handleQuickComposeLoadEarlier,
            canLoadEarlier: Boolean(
              activeWorkspaceProjectId &&
                preferenceScope != null &&
                activeQuickComposeThread &&
                hasEarlierMessagesLocal(
                  {
                    userId: preferenceScope,
                    workspaceProjectId: activeWorkspaceProjectId,
                  },
                  activeQuickComposeThread
                )
            ),
            onExportChat: handleQuickComposeExportChat,
            threadEmptyTitle: PROJECT_AGENT_EMPTY_TITLE,
            threadEmptyHint: PROJECT_AGENT_EMPTY_HINT,
            minimizeDisabled: false,
            expertStudio:
              preferenceScope && activeWorkspaceProjectId
                ? {
                    userId: preferenceScope,
                    workspaceProjectId: activeWorkspaceProjectId,
                  }
                : null,
            onTryRunPrompt: (text: string) => {
              setQuickComposeSegmentsTracked([newQuickComposeTextSegment(text)]);
            },
          }
        : undefined,
    }),
    [
      quickComposeBarVisible,
      quickComposeInLightbox,
      quickComposeInRasterLightbox,
      quickComposeMode,
      quickComposePromptCards,
      quickComposeSegments,
      quickComposeMentionCandidates,
      quickComposeMainDropSlots,
      quickComposeReferenceDropSlots,
      removeQuickComposeMainDropSlot,
      removeQuickComposeReferenceDropSlot,
      moveQuickComposeDropSlot,
      reorderQuickComposeDropSlot,
      quickComposeMaxReferenceImages,
      submitLightboxQuickCompose,
      submitQuickCompose,
      quickComposeSubmitDisabled,
      quickComposeSubmitDisabledReason,
      quickComposeChatDockSubmitDisabledReason,
      quickComposeShowGenImageSettings,
      quickComposeShowGenTextSettings,
      quickComposeShowGenVideoSettings,
      quickComposeShowGenModel3dSettings,
      quickComposeAllowBatchCount,
      projectAgentMemoryEntries,
      projectAgentSkillEntries,
      onQuickComposeInputCapabilityDrop,
      handleQuickComposeWorkflowDrop,
      handleQuickComposePasteAssetRefs,
      handleProjectAgentDeleteMemory,
      handleProjectAgentToggleMemory,
      handleProjectAgentDeleteSkill,
      handleProjectAgentImportSkillPreview,
      handleProjectAgentInstallSampleSkill,
      handleProjectAgentToggleSkill,
      quickComposeImageModel,
      quickComposeTextModel,
      quickComposeVideoModel,
      quickComposeDefaultVideoModel,
      quickComposeVideoDuration,
      quickComposeVideoAspect,
      quickComposeVideoResolution,
      quickComposeVideoMotion,
      quickComposeModel3dModel,
      quickComposeDefaultModel3d,
      quickComposeModel3dQuality,
      quickComposeModel3dGeometryQuality,
      quickComposeModel3dTextureQuality,
      quickComposeModel3dFormat,
      quickComposeModel3dTexture,
      quickComposeModel3dPbr,
      quickComposeAspect,
      quickComposeSize,
      quickComposeCount,
      quickComposeUnderstand,
      quickComposeChatDockHandlers,
      handleQuickComposeClearChat,
      handleQuickComposeLoadEarlier,
      handleQuickComposeExportChat,
      refreshProjectAgentMemoryPanel,
      refreshProjectAgentSkillPanel,
      onLog,
      preferenceScope,
      activeWorkspaceProjectId,
      setQuickComposeSegmentsTracked,
    ]
  );

  const renderWorkflowFunctionSidebar = () => (
        <div
          className="flex h-full min-h-0 max-h-full shrink-0 self-stretch min-w-0 flex-col overflow-hidden"
          style={{ width: `${functionSidebarWidth}px`, minWidth: `${functionSidebarWidth}px` }}
          data-workflow-function-sidebar
        >
          <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
          <WorkflowSidebarColumn
            actionModules={actionModules}
            capabilitySets={capabilitySets}
            draggingAssetIds={draggingAssetIds}
            draggingAssetIdsRef={draggingAssetIdsRef}
            syncDraggingAssetIds={syncDraggingAssetIds}
            draggingGroupItems={draggingGroupItems}
            draggingGroupItemsRef={draggingGroupItemsRef}
            syncDraggingGroupItems={syncDraggingGroupItems}
            workflowAssetDragActive={workflowAssetDragActive}
            clearWorkflowDragSession={clearWorkflowDragSession}
            createGroupFromAssets={createGroupFromAssets}
            createNestedGroupFromGroupItem={createNestedGroupFromGroupItem}
            ensureGroupItemsAsAssets={ensureGroupItemsAsAssets}
            assets={assets}
            getAssetDisplayImage={getAssetDisplayImage}
            setAssets={setAssets}
            selectedGroupItemKeys={selectedGroupItemKeys}
            setSelectedGroupItemKeys={setSelectedGroupItemKeys}
            moveGroupItemsToUpperLevel={moveGroupItemsToUpperLevel}
            moveRootAssetsToUpperLevel={moveRootAssetsToUpperLevel}
            canMoveRootToUpperLevel={
              workshopDiskOpen && workshopMoveToParentDestRel(workshopCurrentRel) != null
            }
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
            onFavoriteDragLifecycle={onFavoriteDragLifecycle}
            setHoverPreview={setHoverPreview}
            handleDropToModuleAction={handleDropToModuleAction}
            handleDropToSetAction={handleDropToSetAction}
            jumpToCapabilityPreset={jumpToCapabilityPreset}
            jumpToCapabilitySet={jumpToCapabilitySet}
            onDropPresetFromEditor={handleActivatePresetFromEditorDrop}
            onDropPresetAction={handlePresetActionDrop}
            topActionMode={activePaneNode === 1 ? 'capabilityPreset' : 'asset'}
            onComposeCapabilities={handleComposeCapabilities}
            linkedComposeSearchQuery={quickComposeDraft}
            onLinkHoverPresetIds={setSidebarLinkHoverPresetIds}
            cloudPresetIds={cloudPresetIds}
            onWorkflowFeatureClick={handleWorkflowFeatureClick}
          />
          </div>
        </div>
  );

  return (
    <>
    <WorkflowSpaceMarqueeChrome
      active={spaceMarqueeEnabled && assetListMarqueeActive}
      listPaneRef={listPaneRef}
      sidebarExcludeRef={quickComposeWorkspaceDockHostRef}
      workspacePane={workspacePane}
      onMarqueePointerDown={beginSpaceMarqueePointerDrag}
      onDimWheel={applyWheelToAssetListWhileSpaceMarquee}
    />
    {!showArchived && assetListMarqueeActive ? (
      <WorkflowMarqueeOverlay rectRef={marqueeOverlayElRef} />
    ) : null}
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className={`flex flex-col items-stretch gap-1.5 shrink-0 ${WORKFLOW_EDGE_GUTTER}`}>
        <div className="py-0.5" onWheelCapture={handlePaneWheel} data-workflow-topbar>
          <div className="flex min-h-7 items-center gap-1.5">
            {workspaceProjectChrome && !fileSourceApi ? (
              <div className="mr-1 flex shrink-0 items-center gap-1 pr-1">
                <button
                  type="button"
                  onClick={() => {
                    void workspaceProjectChrome.onBackToProjectList();
                  }}
                  className={WORKFLOW_TOPBAR_ICON_BTN}
                  title={
                    isWorkspaceCompanionDirectorySourceOfTruth()
                      ? '返回项目列表'
                      : '返回项目列表（将先同步到云端）'
                  }
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
            {fileSourceApi ? (
              <button
                type="button"
                title={
                  workshopWorkspaceDir
                    ? `库目录：${workshopWorkspaceDir}`
                    : '指定库目录：已挂文件夹、版本、预览和链接都放这里'
                }
                onClick={() => void pickWorkshopWorkspace()}
                className={`h-7 shrink-0 rounded-[0.2rem] px-1.5 text-[8px] font-black tracking-wide transition-colors ${
                  workshopWorkspaceDir
                    ? 'bg-white/[0.08] text-gray-200 ring-1 ring-inset ring-white/10 hover:bg-white/[0.12]'
                    : 'text-gray-400 hover:bg-white/[0.07] hover:text-gray-200'
                }`}
              >
                指定库目录
              </button>
            ) : null}
            <div
              className="flex shrink-0 items-center gap-0.5"
              role="group"
              aria-label="内容区分档：1 能力预设 2 资产列表"
            >
              {(
                [
                  { pane: 1 as const, k: '1', t: '能力预设' },
                  { pane: 0 as const, k: '2', t: '资产列表' },
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
                width: `${Math.max(0, Math.min(100, (1 - workspacePane) * 100))}%`,
              }}
            />
          </div>
        </div>
      </div>
      <WorkflowZeroBalanceBanner
        preferenceScope={preferenceScope}
        balance={creditBalance}
        loading={creditBalanceLoading}
      />

      <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
        <div
          ref={workspaceViewportRef}
          className="flex-1 min-h-0 overflow-hidden"
        >
          {/* 大盒子：文件夹树 / 功能区 + 小盒子 +（壳内）右侧预设功能区 */}
          <div className="flex h-full min-h-0 w-full items-stretch overflow-hidden">
        {fileSourceApi ? (
        <div
          className="flex h-full min-h-0 max-h-full shrink-0 self-stretch min-w-0 flex-col overflow-hidden"
          style={{ width: `${WORKSHOP_FOLDERS_PANE_WIDTH_PX}px`, minWidth: `${WORKSHOP_FOLDERS_PANE_WIDTH_PX}px` }}
        >
            <WorkshopFileTreeColumn
              roots={workshopRoots}
              activeRoot={workshopActiveRoot}
              currentRel={workshopCurrentRel}
              workspaceDir={workshopWorkspaceDir}
              onSelectFolder={(root, rel) => {
                applyWorkshopNavLoc({ root, rel, groupId: null });
              }}
              onAddFolder={() => void pickWorkshopRoot()}
              onRemoveRoot={(root) => void removeWorkshopRoot(root)}
            />
        </div>
        ) : showFunctionSidebar ? (
          renderWorkflowFunctionSidebar()
        ) : null}
        {/* 小盒子：资产列表 ↔ 能力预设 */}
        <div
          ref={listPaneRef}
          data-workflow-content-slot
          {...(activePaneNode === 0 ? { 'data-workflow-asset-list': true } : {})}
          className="relative min-w-0 min-h-0 h-full max-h-full flex-1 self-stretch flex flex-col overflow-hidden"
        >
        {/* 资产页保持占位测量（勿 display:none，否则 justified 宽度变 0 → opacity-0）；预设页叠在上方 */}
        <div
          className={`relative min-h-0 min-w-0 h-full max-h-full w-full flex-1 flex-col overflow-hidden ${
            activePaneNode === 0 ? 'flex' : 'pointer-events-none invisible flex'
          }`}
          aria-hidden={activePaneNode !== 0}
        >
        {lightboxAssetId && lightboxListBackdropUrl ? (
          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
            <img
              src={lightboxListBackdropUrl}
              alt=""
              draggable={false}
              className="h-full w-full object-cover object-top select-none"
            />
          </div>
        ) : null}
        {fileSourceApi ? (
          <div
            className={lightboxAssetId ? 'pointer-events-none opacity-0' : undefined}
            aria-hidden={Boolean(lightboxAssetId)}
          >
            <WorkshopCanvasNavBar
              kindFilter={workshopCanvasKindFilter}
              kindCounts={workshopCanvasKindCounts}
              onKindFilter={setWorkshopCanvasKindFilter}
              canBack={workshopNavCanBack(workshopNavHistory)}
              canForward={workshopNavCanForward(workshopNavHistory)}
              canUp={workshopNavCanUp(workshopNavLoc)}
              onBack={goWorkshopNavBack}
              onForward={goWorkshopNavForward}
              onUp={() => {
                const up = workshopNavUpLoc(
                  workshopNavLoc,
                  groupBreadcrumb[groupBreadcrumb.length - 1]?.parentId ?? null,
                );
                if (up) applyWorkshopNavLoc(up);
              }}
              crumbs={workshopNavCrumbs}
              onCrumb={(loc) => applyWorkshopNavLoc(loc)}
            />
          </div>
        ) : null}
        <div
          ref={centerScrollRef}
          data-workflow-scroll-port="asset"
          className="workflow-scroll-port flex h-0 flex-1 min-w-0 min-h-0 overflow-y-auto overscroll-y-contain no-scrollbar flex flex-col gap-3 rounded-xl transition-colors"
          onWheelCapture={handleCenterWheelDuringDrag}
          onDragOver={(e) => {
            autoScrollContainerOnDrag(e.currentTarget as HTMLElement, e.clientY);
            if (!hasWorkflowDropTransfer(e.dataTransfer)) return;
            e.preventDefault();
          }}
          tabIndex={0}
        >
          <div
            className={lightboxAssetId ? 'pointer-events-none opacity-0' : undefined}
            aria-hidden={Boolean(lightboxAssetId)}
          >
          {groupFilterId ? (
            <>
              {!fileSourceApi ? (
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
              ) : null}
              <WorkflowJustifiedVirtualGrid
                scrollRef={centerScrollRef}
                gridRef={groupGridRef}
                boxes={groupJustifiedLayout.boxes}
                ready={groupJustifiedLayout.ready}
                totalHeight={groupJustifiedLayout.totalHeight}
                className={`relative pt-4 w-full ${WORKFLOW_EDGE_GUTTER} ${
                  groupJustifiedLayout.ready ? '' : 'opacity-0'
                }`}
                style={{
                  ['--wf-card-gap' as string]: `${WORKFLOW_ASSET_GRID_GAP_PX}px`,
                }}
                marqueeHitIdsRef={layoutMarqueeHitIdsRef}
                renderBox={(layoutBox) => {
                  if (!currentGroupAsset) return null;
                  if (showAllImages) {
                    const gallPrefix = `gall:${currentGroupAsset.id}:`;
                    if (!layoutBox.id.startsWith(gallPrefix)) return null;
                    const idx = Number(layoutBox.id.slice(gallPrefix.length));
                    const flat = Number.isInteger(idx) && idx >= 0 ? showAllImages[idx] : undefined;
                    if (!flat) return null;
                    const img = flat.src;
                    const gallKey = layoutBox.id;
                    return (
                        <div
                          data-workflow-card
                          data-workflow-thumb-key={gallKey}
                          ref={(el) => registerCardZoomHost(gallKey, el)}
                          className={`absolute min-w-0 rounded-2xl overflow-hidden bg-[#141416] flex justify-center ${WORKFLOW_CARD_SURFACE_IDLE}`}
                          onMouseEnter={() =>
                            setHoveredCard({ controlId: gallKey, zoomEligible: true })
                          }
                          onMouseLeave={clearHoveredCard}
                          style={{
                            left: layoutBox.left,
                            top: layoutBox.top,
                            width: layoutBox.width,
                            height: layoutBox.height,
                          }}
                        >
                          <div className="relative w-full h-full bg-[#141416] flex justify-center">
                            <WorkflowGridImage
                              fullSrc={img}
                              cacheKey={gallKey}
                              mediaVariant={flat.mediaVariant}
                              deferThumbnail={!thumbUnlockKeys.has(gallKey)}
                              thumbDecodePriority={thumbHotKeys.has(gallKey) ? 'high' : 'low'}
                              imageFetchPriority={thumbHotKeys.has(gallKey) ? 'high' : 'auto'}
                              companionBaseUrl={String(getCompanionLocalBaseUrl() || '')}
                              companionProjectId={String(workspaceProjectChrome?.activeProjectId || '')}
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
                  }
                  const itemPrefix = `${currentGroupAsset.id}::`;
                  if (!layoutBox.id.startsWith(itemPrefix)) return null;
                  const idx = Number(layoutBox.id.slice(itemPrefix.length));
                  if (!Number.isInteger(idx) || idx < 0) return null;
                  const item = currentGroupItems[idx];
                  if (item == null) return null;
                      const groupKey = layoutBox.id;
                      const isAssetRef = typeof item === 'object' && item && 'assetId' in item;
                      const childAsset = isAssetRef ? assets.find((x) => x.id === (item as { assetId: string }).assetId) : null;
                      if (childAsset && !workshopCanvasKindMatches(childAsset, workshopCanvasKindFilter)) return null;
                      if (!childAsset && workshopCanvasKindFilter !== 'all' && workshopCanvasKindFilter !== 'image') return null;
                      const img =
                        isAssetRef && childAsset
                          ? getAssetGridDisplayImage(childAsset)
                          : typeof item === 'string'
                            ? item
                            : currentGroupAsset?.original ?? '';
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
                          <div
                            className="absolute min-w-0"
                            data-workflow-thumb-key={groupKey}
                            style={{
                              left: layoutBox.left,
                              top: layoutBox.top,
                              width: layoutBox.width,
                              height: layoutBox.height,
                            }}
                          >
                            <div className="relative h-full w-full min-h-0">
                            {childIsGroup && childGroupLen > 1 ? (
                              <WorkflowGroupCardStackPreviews
                                groupAsset={childAsset}
                                allAssets={assets}
                                getDisplayImage={getAssetGridDisplayImage}
                                deferThumbnail={!thumbUnlockKeys.has(groupKey)}
                                thumbDecodePriority={thumbHotKeys.has(groupKey) ? 'high' : 'low'}
                              />
                            ) : null}
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
                                    return nestedChild ? getAssetGridDisplayImage(nestedChild) : img;
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
                              const childStepBadge = resolveWorkflowAssetStepBadge(childAsset, assets, {
                                groupPreviewIndex: groupPreviewIndexById[childAsset.id],
                              });
                              return (
                                <div
                                  data-workflow-drop-host
                                  ref={(el) => registerCardZoomHost(childAsset.id, el)}
                                  className={`min-w-0 h-full ${WORKFLOW_CARD_SHELL_PAD} ${
                                    selectedGroupItemKeys.has(groupKey)
                                      ? WORKFLOW_CARD_SHELL_SELECTED
                                      : WORKFLOW_CARD_SHELL_IDLE
                                  }`}
                                  data-workflow-thumb-key={groupKey}
                                  onDragOver={(e) => {
                                    handleWorkflowAssetDropHostDragOver(e, groupKey, {
                                      allowGroup: !isWorkflowTextAsset(childAsset),
                                      isBusy: isBusyGroupItem,
                                    });
                                  }}
                                  onDragLeave={(e) => {
                                    const rel = e.relatedTarget as Node | null;
                                    if (rel && e.currentTarget.contains(rel)) return;
                                    workflowCardDragLeave(e.currentTarget, groupKey);
                                  }}
                                  onDrop={(e) => {
                                    handleGroupItemShellDrop(e, groupKey, idx, childAsset);
                                  }}
                                >
                                <div
                                  data-workflow-card
                                  ref={(el) => {
                                    if (!currentGroupAsset) return;
                                    if (el) cardRefs.current.set(groupKey, el);
                                    else cardRefs.current.delete(groupKey);
                                  }}
                                  className={`group relative z-[1] ${childIsGroup ? WORKFLOW_GROUP_CARD_FACE_CLASS : 'h-full w-full'} ${WORKFLOW_CARD_INNER_RADIUS} overflow-hidden bg-[#16161a] ${
                                    childIsGroup
                                      ? 'border-0 data-[drag-over=1]:ring-2 data-[drag-over=1]:ring-inset data-[drag-over=1]:ring-blue-400/65'
                                      : `${WORKFLOW_CARD_SURFACE_IDLE} data-[drag-over=1]:ring-blue-500/55`
                                  } ${childSetRunAccentClass} ${bounce !== 'idle' ? 'will-change-transform ' : ''}transition-transform duration-150 ease-out ${motionClass}`}
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
                                    draggingGroupItemsRef.current = { groupAssetId: currentGroupAsset.id, itemIndexes };
                                    syncDraggingGroupItems({ groupAssetId: currentGroupAsset.id, itemIndexes });
                                  }}
                                  onDragEnd={() => {
                                    clearWorkflowDragSession();
                                  }}
                                  onDragOver={(e) => {
                                    const dragGroup = draggingGroupItemsRef.current;
                                    if (!dragGroup?.itemIndexes?.length || currentGroupAsset?.id !== dragGroup.groupAssetId) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (!dragGroup.itemIndexes.includes(idx)) {
                                      e.currentTarget.setAttribute('data-drag-over', '1');
                                    }
                                  }}
                                  onDragLeave={(e) => {
                                    const rel = e.relatedTarget as Node | null;
                                    if (rel && e.currentTarget.contains(rel)) return;
                                    e.currentTarget.removeAttribute('data-drag-over');
                                  }}
                                  onDrop={(e) => {
                                    e.currentTarget.removeAttribute('data-drag-over');
                                  }}
                                >
                                  <div
                                    className="relative h-full w-full cursor-pointer"
                                    onMouseEnter={() => {
                                      if (childAsset) {
                                        const childIsGroup = isGroupAsset(childAsset);
                                        const childGroupLen = childIsGroup ? (childAsset.assetIds?.length ?? 0) : 0;
                                        setHoveredCard(
                                          buildAssetCardHoverControl({
                                            controlId: childAsset.id,
                                            asset: childAsset,
                                            isGroupCard: childIsGroup,
                                            groupLen: childGroupLen,
                                            hasDisplayImage: hasChildDisplayImage,
                                            busy: isBusyGroupItem,
                                          })
                                        );
                                      } else {
                                        setHoveredCard(null);
                                      }
                                    }}
                                    onMouseLeave={clearHoveredCard}
                                    onContextMenu={(e) => {
                                      if (showArchived) return;
                                      if (
                                        isGroupAsset(childAsset) ||
                                        isWorkflowStoryboardTableAsset(childAsset) ||
                                        isWorkflowAssetSetAsset(childAsset) ||
                                        (!hasChildDisplayImage && isWorkflowTextAsset(childAsset))
                                      ) {
                                        return;
                                      }
                                      openWorkflowAssetContextMenu(childAsset, e);
                                    }}
                                    onClick={() => {
                                      // 使用 isGroupAsset 兼容新旧结构
                                      if (isGroupAsset(childAsset)) {
                                        applyWorkshopNavLoc({
                                          root: workshopActiveRoot,
                                          rel: workshopDiskOpen ? workshopCurrentRel : '',
                                          groupId: childAsset.id,
                                        });
                                      } else if (currentGroupAsset) {
                                        openWorkflowLightbox(childAsset.id, {
                                          sourceGroupAssetId: currentGroupAsset.id,
                                          sourceItemIndex: idx,
                                        });
                                      } else {
                                        openWorkflowLightbox(childAsset.id);
                                      }
                                    }}
                                  >
                                    {hasChildDisplayImage && !hasChildDisplayImage && isWorkflowTextAsset(childAsset) ? (
                                      <div className="relative w-full h-full bg-[#141416] flex flex-col justify-start p-3 text-left">
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
                                      <AssetCardPreviewRenderer
                                        asset={childAsset}
                                        previewSrc={childGridPreviewSrcEffective}
                                        cacheKey={childGridCacheKeyEffective}
                                        textDisplay={childTextDisplay}
                                        autoPlayVideo={selectedGroupItemKeys.has(groupKey)}
                                        deferThumbnail={!thumbUnlockKeys.has(groupKey)}
                                        thumbDecodePriority={thumbHotKeys.has(groupKey) ? 'high' : 'low'}
                                        imageFetchPriority={thumbHotKeys.has(groupKey) ? 'high' : 'auto'}
                                        onModelThumbnailCaptured={persistCapturedWorkflowModelThumbnail}
                                        companionBaseUrl={String(getCompanionLocalBaseUrl() || '')}
                                        companionProjectId={String(workspaceProjectChrome?.activeProjectId || '')}
                                        onIntrinsicSize={(w, h) => {
                                          applyIntrinsicAspectToAsset(childAsset.id, w, h);
                                          setCardAspectByAssetId(
                                            (prev) => mergeCardAspectFromIntrinsic(prev, groupKey, w, h) ?? prev
                                          );
                                        }}
                                      />
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
                                          executionStartedAt={
                                            isExecutingCurrentItem
                                              ? executionStartedAtByAssetId.get(childAsset.id) ?? null
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
                                    {childStepBadge ? (
                                      <WorkflowAssetStepCountBadge
                                        current={childStepBadge.current}
                                        total={childStepBadge.total}
                                      />
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
                                        {fileSourceApi && workshopCardNeedsApply(childAsset.id, childAsset.displayKey) ? (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              void applyWorkshopDisplayToCheckout(childAsset.id, childAsset.displayKey);
                                            }}
                                            className="px-1.5 py-0.5 rounded text-[7px] text-blue-300 hover:bg-white/[0.08]"
                                            title="把当前显示覆盖到本地文件"
                                          >
                                            应用
                                          </button>
                                        ) : null}
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
                                </div>
                              );
                            })()}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          data-workflow-drop-host
                          ref={(el) =>
                            registerCardZoomHost(
                              isAssetRef && childAsset ? childAsset.id : groupKey,
                              el
                            )
                          }
                          className={`absolute min-w-0 ${WORKFLOW_CARD_SHELL_PAD} ${
                            selectedGroupItemKeys.has(groupKey)
                              ? WORKFLOW_CARD_SHELL_SELECTED
                              : WORKFLOW_CARD_SHELL_IDLE
                          }`}
                          data-workflow-thumb-key={groupKey}
                          style={{
                            left: layoutBox.left,
                            top: layoutBox.top,
                            width: layoutBox.width,
                            height: layoutBox.height,
                          }}
                          onDragOver={(e) => {
                            handleWorkflowAssetDropHostDragOver(e, groupKey, {
                              allowGroup: !!(isAssetRef && childAsset && !isWorkflowTextAsset(childAsset)),
                              isBusy: isBusyGroupItem,
                            });
                          }}
                          onDragLeave={(e) => {
                            const rel = e.relatedTarget as Node | null;
                            if (rel && e.currentTarget.contains(rel)) return;
                            workflowCardDragLeave(e.currentTarget, groupKey);
                          }}
                          onDrop={(e) => {
                            handleGroupItemShellDrop(
                              e,
                              groupKey,
                              idx,
                              childAsset ?? ({ id: groupKey } as WorkflowAsset)
                            );
                          }}
                        >
                        <div
                          data-workflow-card
                          ref={(el) => {
                            if (!currentGroupAsset) return;
                            if (el) cardRefs.current.set(groupKey, el);
                            else cardRefs.current.delete(groupKey);
                          }}
                          className={`group relative h-full w-full ${WORKFLOW_CARD_INNER_RADIUS} overflow-hidden bg-[#16161a] ${WORKFLOW_CARD_SURFACE_IDLE}`}
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
                            draggingGroupItemsRef.current = { groupAssetId: currentGroupAsset.id, itemIndexes };
                            syncDraggingGroupItems({ groupAssetId: currentGroupAsset.id, itemIndexes });
                          }}
                          onDragEnd={() => {
                            clearWorkflowDragSession();
                          }}
                        >
                          <div
                            className="relative h-full w-full cursor-pointer"
                            onMouseEnter={() => {
                              if (isAssetRef && childAsset) {
                                const childIsGroup = isGroupAsset(childAsset);
                                const childGroupLen = childIsGroup ? (childAsset.assetIds?.length ?? 0) : 0;
                                setHoveredCard(
                                  buildAssetCardHoverControl({
                                    controlId: childAsset.id,
                                    asset: childAsset,
                                    isGroupCard: childIsGroup,
                                    groupLen: childGroupLen,
                                    hasDisplayImage: Boolean(String(img || '').trim()),
                                    busy: isBusyGroupItem,
                                  })
                                );
                              } else if (String(img || '').trim()) {
                                setHoveredCard({ controlId: groupKey, zoomEligible: true });
                              } else {
                                setHoveredCard(null);
                              }
                            }}
                            onMouseLeave={clearHoveredCard}
                            onContextMenu={(e) => {
                              if (showArchived || !isAssetRef || !childAsset) return;
                              if (
                                isGroupAsset(childAsset) ||
                                isWorkflowStoryboardTableAsset(childAsset) ||
                                isWorkflowAssetSetAsset(childAsset)
                              ) {
                                return;
                              }
                              openWorkflowAssetContextMenu(childAsset, e);
                            }}
                            onClick={() => setGroupStringLightboxIndex(idx)}
                          >
                            <div className="relative w-full h-full bg-[#141416] flex justify-center">
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
                                companionBaseUrl={String(getCompanionLocalBaseUrl() || '')}
                                companionProjectId={String(workspaceProjectChrome?.activeProjectId || '')}
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
                        </div>
                      );
                }}
              >
                {!currentGroupAsset ? (
                  <div className="py-8 text-center text-[9px] text-gray-500">该组已被删除或不存在，请返回</div>
                ) : null}
              </WorkflowJustifiedVirtualGrid>
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
            <div className="mx-auto flex min-h-[min(70vh,560px)] max-w-md flex-col items-center justify-center px-6 py-12">
              <div className="flex w-full flex-col items-center rounded-2xl bg-white/[0.03] px-8 py-10 text-center ring-1 ring-white/[0.07]">
                <AppIcon name="camera" className="mb-3 h-11 w-11 text-gray-500" />
                {fileSourceApi && workshopDiskOpen ? (
                  <>
                    <p className="text-[11px] font-black uppercase tracking-wide text-gray-300">
                      此文件夹没有文件
                    </p>
                    <p className="mt-2 text-[9px] leading-relaxed text-gray-500">
                      拖入文件，或在此新建文本。
                    </p>
                    <button
                      type="button"
                      onClick={createWorkflowTextAssetAndOpen}
                      className="mt-4 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-2 text-[10px] font-bold text-emerald-200 hover:bg-emerald-500/20"
                    >
                      新建文本
                    </button>
                  </>
                ) : (
                  <>
                <p className="text-[11px] font-black uppercase tracking-wide text-gray-300">
                  {fileSourceApi ? '浏览器里还没有资产' : '画布为空'}
                </p>
                <p className="mt-2 text-[9px] leading-relaxed text-gray-500">
                  将图片或模型<strong className="text-gray-400">拖入画布</strong>，在左侧「仓库」拖入条目，或使用<strong className="text-gray-400">粘贴</strong>、功能区能力生成内容
                </p>
                <button
                  type="button"
                  onClick={createWorkflowTextAssetAndOpen}
                  className="mt-4 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-2 text-[10px] font-bold text-emerald-200 hover:bg-emerald-500/20"
                >
                  新建文本
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const id = addWorkflowStoryboardTableAsset();
                    openStoryboardTablePanel(id);
                  }}
                  className="mt-2 rounded-xl border border-violet-500/35 bg-violet-500/10 px-4 py-2 text-[10px] font-bold text-violet-200 hover:bg-violet-500/20"
                >
                  新建分镜表
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const id = addWorkflowAssetSetAsset();
                    openAssetSetPanel(id);
                  }}
                  className="mt-2 rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-2 text-[10px] font-bold text-cyan-200 hover:bg-cyan-500/20"
                >
                  新建资产集
                </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className={`min-h-0 min-w-0 py-6 ${WORKFLOW_EDGE_GUTTER}`}>
              <WorkflowJustifiedVirtualGrid
                scrollRef={centerScrollRef}
                gridRef={gridRef}
                boxes={rootJustifiedLayout.boxes}
                ready={rootJustifiedLayout.ready}
                totalHeight={rootJustifiedLayout.totalHeight}
                className={`relative w-full ${rootJustifiedLayout.ready ? '' : 'opacity-0'}`}
                style={{
                  ['--wf-card-gap' as string]: `${WORKFLOW_ASSET_GRID_GAP_PX}px`,
                }}
                marqueeHitIdsRef={layoutMarqueeHitIdsRef}
                renderBox={(layoutBox) => {
                  const a = rootCanvasAssetsById.get(layoutBox.id);
                  if (!a) return null;
                  const textDisplay = getAssetDisplayText(a);
                  const hasTextPayload =
                    !!textDisplay ||
                    !!(a.textTitle || '').trim() ||
                    Object.values(a.textResults || {}).some((v) => String(v || '').trim() !== '');
                  const baseDisplayImage = getAssetDisplayImage(a);
                  const hasDisplayImage =
                    (baseDisplayImage.trim() !== '' && !isWorkflowModelSvgPlaceholderSrc(baseDisplayImage)) ||
                    (workshopDiskOpen && Boolean(String(workshopThumbById[a.id] || '').trim()));
                  const isBusy = busyAssetIds.has(a.id);
                  const isPendingOnly = pendingAssetIds.has(a.id) && !executingQueue;
                  const taskForRootSlot = rootExecutingTaskByAssetId.get(a.id) ?? null;
                  const isExecutingCurrent =
                    !!taskForRootSlot && activeTaskIds.has(taskForRootSlot.id);
                  /** 批处理进行中时新拖入的任务只进 pending，不在本批 executingQueue.tasks，仍会 busy +「排队中」，须单独给 × */
                  const pendingTaskForRootAsset = pendingAssetIds.has(a.id)
                    ? pending.find((t) => t.assetId === a.id) ?? null
                    : null;
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
                  const gridPreviewSrc = isGroupCard
                    ? (() => {
                        const childId = a.assetIds?.[gSafe] ?? a.assetIds?.[0];
                        if (workshopDiskOpen && childId) {
                          const fromThumb = workshopThumbById[childId] || '';
                          if (fromThumb) return fromThumb;
                        }
                        const child = childId ? assetsById.get(childId) : null;
                        return child ? getAssetGridDisplayImage(child) : getAssetGridDisplayImage(a);
                      })()
                    : !hasDisplayImage
                      ? ''
                      : getAssetGridDisplayImage(a);
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
                  const stepBadge = resolveWorkflowAssetStepBadge(a, assets, {
                    groupPreviewIndex: groupPreviewIndexById[a.id],
                  });

                  return (
                    <div
                      key={a.id}
                      data-workflow-drop-host
                      ref={(el) => registerCardZoomHost(a.id, el)}
                      className={`absolute min-w-0 ${WORKFLOW_CARD_SHELL_PAD} ${
                        selectedAssetIds.has(a.id) ? WORKFLOW_CARD_SHELL_SELECTED : WORKFLOW_CARD_SHELL_IDLE
                      }`}
                      data-workflow-thumb-key={a.id}
                      style={{
                        left: layoutBox.left,
                        top: layoutBox.top,
                        width: layoutBox.width,
                        height: layoutBox.height,
                      }}
                      onDragOver={(e) => {
                        handleWorkflowAssetDropHostDragOver(e, a.id, {
                          allowGroup: workshopDiskOpen || !isWorkflowTextAsset(a),
                          isBusy,
                        });
                      }}
                      onDragLeave={(e) => {
                        const rel = e.relatedTarget as Node | null;
                        if (rel && e.currentTarget.contains(rel)) return;
                        workflowCardDragLeave(e.currentTarget, a.id);
                      }}
                      onDrop={(e) => {
                        handleRootCanvasAssetShellDrop(e, a);
                      }}
                    >
                      <div className="relative h-full w-full min-h-0">
                      {isGroupCard && (workshopDiskOpen || gLen > 1) ? (
                        <WorkflowGroupCardStackPreviews
                          groupAsset={a}
                          allAssets={workshopDiskOpen ? workshopFileAssets : assets}
                          memberSrcs={
                            workshopDiskOpen
                              ? (a.assetIds || []).map((id) => workshopThumbById[id] || '')
                              : undefined
                          }
                          forceStack={workshopDiskOpen}
                          getDisplayImage={getAssetGridDisplayImage}
                          deferThumbnail={!thumbUnlockKeys.has(a.id)}
                          thumbDecodePriority={thumbHotKeys.has(a.id) ? 'high' : 'low'}
                          companionBaseUrl={String(getCompanionLocalBaseUrl() || '')}
                          companionProjectId={String(workspaceProjectChrome?.activeProjectId || '')}
                        />
                      ) : null}
                      <div
                        data-workflow-card
                        ref={(el) => {
                          if (el) cardRefs.current.set(a.id, el);
                          else cardRefs.current.delete(a.id);
                        }}
                        className={`group relative z-[1] ${isGroupCard ? WORKFLOW_GROUP_CARD_FACE_CLASS : 'h-full w-full'} ${WORKFLOW_CARD_INNER_RADIUS} overflow-hidden bg-[#16161a] ${
                          isGroupCard
                            ? 'border-0 data-[drag-over=1]:ring-2 data-[drag-over=1]:ring-inset data-[drag-over=1]:ring-blue-400/65'
                            : `${WORKFLOW_CARD_SURFACE_IDLE} data-[drag-over=1]:ring-blue-500/55`
                        } ${setRunAccentClass} ${busyClass} ${bounce !== 'idle' ? 'will-change-transform ' : ''}transition-transform duration-150 ease-out ${motionClass}`}
                        draggable={!showArchived && !isBusy}
                        onDragStart={(e) => {
                          if (showArchived || isBusy) return;
                          const ids =
                            selectedAssetIds.has(a.id) && selectedAssetIds.size > 0
                              ? Array.from(selectedAssetIds)
                              : [a.id];
                          draggingAssetIdsRef.current = ids;
                          syncDraggingAssetIds(ids);
                          try {
                            const payload: AcWorkflowExportPayload = { mode: 'roots', assetIds: ids };
                            const raw = JSON.stringify(payload);
                            e.dataTransfer.setData(DT_AC_WORKFLOW_EXPORT, raw);
                            e.dataTransfer.setData('text/plain', raw);
                            e.dataTransfer.effectAllowed = 'copyMove';
                          } catch {
                            /* ignore */
                          }
                        }}
                        onDragEnd={() => {
                          clearWorkflowDragSession();
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
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = 'copy';
                            e.currentTarget.setAttribute('data-drag-over', '1');
                          }
                        }}
                        onDragLeave={(e) => {
                          const rel = e.relatedTarget as Node | null;
                          if (rel && e.currentTarget.contains(rel)) return;
                          e.currentTarget.removeAttribute('data-drag-over');
                        }}
                        onDrop={(e) => {
                          e.currentTarget.removeAttribute('data-drag-over');
                          if (isBusy) {
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
                            e.preventDefault();
                            e.stopPropagation();
                            const capId = readCapabilityDragActionId(e.dataTransfer);
                            const capSource = readCapabilityDragSource(e.dataTransfer);
                            clearWorkflowDragSession();
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
                            e.preventDefault();
                            e.stopPropagation();
                            clearWorkflowDragSession();
                          }
                        }}
                      >
                        <div
                          className="relative h-full w-full cursor-pointer"
                          onMouseEnter={() => {
                            if (showArchived) {
                              setHoveredCard(null);
                              return;
                            }
                            if (isWorkflowStoryboardTableAsset(a) || isWorkflowAssetSetAsset(a)) {
                              setHoveredCard(null);
                              return;
                            }
                            setHoveredCard(
                              buildAssetCardHoverControl({
                                controlId: a.id,
                                asset: a,
                                isGroupCard,
                                groupLen: gLen,
                                hasDisplayImage,
                                busy: isBusy,
                              })
                            );
                            if (!isGroupCard) scheduleWorkflowLightboxPrefetch(a);
                          }}
                          onMouseLeave={clearHoveredCard}
                          onContextMenu={(e) => {
                            if (showArchived) return;
                            let target: WorkflowAsset | null = a;
                            if (isGroupCard && !workshopDiskOpen) {
                              const childId = a.assetIds?.[gSafe] ?? a.assetIds?.[0];
                              target = childId ? assets.find((x) => x.id === childId) ?? null : null;
                            }
                            if (
                              !target ||
                              isWorkflowStoryboardTableAsset(target) ||
                              isWorkflowAssetSetAsset(target) ||
                              (!workshopDiskOpen && !hasDisplayImage && isWorkflowTextAsset(target))
                            ) {
                              return;
                            }
                            openWorkflowAssetContextMenu(target, e);
                          }}
                          onClick={() => {
                            if (showArchived) {
                              setArchivedDetailAssetId(a.id);
                            } else if (isGroupCard) {
                              const parsed = parseWorkshopFileAssetId(a.id);
                              if (workshopDiskOpen && parsed) {
                                openWorkshopDiskFolder(parsed.root, parsed.rel);
                              } else {
                                applyWorkshopNavLoc({
                                  root: workshopActiveRoot,
                                  rel: workshopDiskOpen ? workshopCurrentRel : '',
                                  groupId: a.id,
                                });
                              }
                            } else if (isWorkflowStoryboardTableAsset(a)) {
                              openStoryboardTablePanel(a.id);
                            } else if (isWorkflowAssetSetAsset(a)) {
                              openAssetSetPanel(a.id);
                            } else {
                              openWorkflowLightbox(a.id);
                            }
                          }}
                        >
                          {isWorkflowStoryboardTableAsset(a) ? (
                            <div className="h-full w-full">
                              <StoryboardTableGridCard asset={a} />
                            </div>
                          ) : isWorkflowAssetSetAsset(a) ? (
                            <div className="h-full w-full">
                              <AssetSetGridCard asset={a} />
                            </div>
                          ) : !hasDisplayImage && isWorkflowTextAsset(a) ? (
                            <div className="relative w-full h-full bg-[#141416] flex flex-col justify-start p-3 text-left">
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
                          ) : isGroupCard && !gridPreviewSrcEffective.trim() ? (
                            <div className="relative h-full w-full bg-[#16161a]" />
                          ) : (
                            <AssetCardPreviewRenderer
                              asset={a}
                              previewSrc={gridPreviewSrcEffective}
                              cacheKey={gridPreviewCacheKeyEffective}
                              textDisplay={textDisplay}
                              autoPlayVideo={selectedAssetIds.has(a.id)}
                              thumbMaxEdge={
                                resolveWorkflowStepModelUrls(a, a.displayKey).length > 0 ? 896 : undefined
                              }
                              deferThumbnail={!thumbUnlockKeys.has(a.id)}
                              thumbDecodePriority={thumbHotKeys.has(a.id) ? 'high' : 'low'}
                              imageFetchPriority={thumbHotKeys.has(a.id) ? 'high' : 'auto'}
                              onModelThumbnailCaptured={persistCapturedWorkflowModelThumbnail}
                              companionBaseUrl={String(getCompanionLocalBaseUrl() || '')}
                              companionProjectId={String(workspaceProjectChrome?.activeProjectId || '')}
                              onIntrinsicSize={(w, h) => {
                                applyIntrinsicAspectToAsset(a.id, w, h);
                              }}
                            />
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
                                executionStartedAt={
                                  isExecutingCurrent
                                    ? executionStartedAtByAssetId.get(a.id) ?? null
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
                          {stepBadge ? (
                            <WorkflowAssetStepCountBadge
                              current={stepBadge.current}
                              total={stepBadge.total}
                            />
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
                              {fileSourceApi && workshopCardNeedsApply(a.id, a.displayKey) ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void applyWorkshopDisplayToCheckout(a.id, a.displayKey);
                                  }}
                                  className="px-1.5 py-0.5 rounded text-[7px] text-blue-300 hover:bg-white/[0.08]"
                                  title="把当前显示覆盖到本地文件"
                                >
                                  应用
                                </button>
                              ) : null}
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
                    </div>
                  );
                }}
              />
            </div>
          )}
          </div>
        </div>
        </div>
        {activePaneNode === 1 ? (
          <div
            data-workflow-preset-column
            className="absolute inset-0 z-[1] flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#0a0a0c] pl-3 pr-0"
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
                  creditBalance,
                })}
              </div>
            ) : (
              <div className="flex-1 min-h-0 rounded-xl border border-dashed border-white/10 bg-white/[0.02] flex items-center justify-center text-[9px] text-gray-600">
                未挂载能力预设
              </div>
            )}
          </div>
        ) : null}
        </div>
        {fileSourceApi && showFunctionSidebar ? renderWorkflowFunctionSidebar() : null}
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

      {assetSetPanelAsset && !showArchived && (
        <AssetSetPanel
          asset={assetSetPanelAsset}
          capabilityPresets={capabilityPresets}
          onClose={closeAssetSetPanel}
          onNotify={(level, message) => onLog?.(level, message)}
          readOnly={Boolean(assetSetPanelAsset.archived)}
          onPatchAsset={(patch) => handleAssetSetAssetPatch(assetSetPanelAsset.id, patch)}
          companionBaseUrl={String(getCompanionLocalBaseUrl() || '')}
          companionProjectId={String(workspaceProjectChrome?.activeProjectId || '')}
        />
      )}

      {/* 进行中：大图弹窗；外壳统一为 ImagePreviewOverlay，当前版本为纯文本时仅中央为文字编辑区 */}
      {lightboxOverlayMounted && lightboxAssetId && lightboxBootPhase && lightboxAsset && !showArchived && (
        <AssetPreviewOverlay
          open
          resetKey={lightboxAsset.id}
          asset={lightboxAsset}
          variant={lightboxTexturePreviewSrc ? null : lightboxActiveVariant}
          previewKindOverride={lightboxTexturePreviewSrc ? 'image' : undefined}
          previewLayout={lightboxPreviewLayout}
          bootPhase={lightboxBootPhase}
          shellVisuallyHidden={lightboxOverlayClosingHidden}
          onPrimaryImageReady={notifyLightboxPrimaryReady}
          backdropImageSrc={lightboxListBackdropUrl}
          placeholderImageSrc={lightboxPlaceholderImageSrc}
          suppressFlatImageInteraction={
            Boolean(
              lightboxRasterChrome &&
                lightboxSamSegmentUiAllowed &&
                lightboxSamPickArmed &&
                !lightboxSamBusy
            )
          }
          imageSrc={
            lightboxCenterRoute?.mode === 'image'
              ? lightboxTexturePreviewSrc
                ? lightboxCenterRoute.imageSrc
                : lightboxPreviewUnderlaySrc || lightboxCenterRoute.imageSrc
              : undefined
          }
          centerSlot={
            lightboxCenterRoute?.useTextCenter ? (
              <WorkflowTextLightboxCenter
                ref={textLightboxCenterRef}
                resetKey={`${lightboxAsset.id}:${lightboxAsset.displayKey}`}
                title={lightboxAsset.textTitle ?? ''}
                body={getAssetDisplayText(lightboxAsset)}
                onAddToComposeInput={(text) => appendQuickComposeTextInput(text, '文本预览')}
                onPersist={(next) => {
                  const id = lightboxAsset.id;
                  const currentKey = lightboxAsset.displayKey;
                  if (workshopDiskOpen) {
                    const parsed = parseWorkshopFileAssetId(id);
                    if (parsed && currentKey === 'original') {
                      void workshopFileSourceApi()?.writeWorkshopCheckoutFile?.({
                        root: parsed.root,
                        rel: parsed.rel,
                        body: next.textBody,
                      });
                      setWorkshopTextById((prev) => ({ ...prev, [id]: next.textBody }));
                    }
                    return;
                  }
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
            ) : lightboxCenterRoute?.useMediaCenter && lightboxMediaCenterVariant ? (
                <AssetMediaPreviewCenter
                  variant={lightboxMediaCenterVariant}
                  assetId={lightboxAsset.id}
                  modelFileName={lightboxModelFileNameHint}
                  model3dPbrEditDoc={resolveWorkflowAssetPbrEditDoc(lightboxAsset, {
                    stepKey: lightboxAsset.displayKey,
                    variantId: lightboxMediaCenterVariant?.id,
                    modelKey:
                      lightboxMediaCenterVariant?.modelCompanionKeys?.[0] ||
                      lightboxMediaCenterVariant?.id,
                  })}
                  resolvePbrTextureAssetSrc={(textureAssetId) => {
                    const tex = assetsRef.current.find((a) => a.id === textureAssetId);
                    return tex ? getAssetDisplayImage(tex) : '';
                  }}
                  model3dDisplayMode={lightboxModel3dDisplayMode}
                model3dResetViewNonce={lightboxModel3dResetViewNonce}
                model3dShowGrid={lightboxModel3dShowGrid}
                model3dBackfaceCulling={lightboxModel3dBackfaceCulling}
                capturePreviewNonce={lightboxMediaCapturePreviewNonce}
                uiRightInset={
                  lightboxUiHidden ? '0px' : WORKFLOW_LIGHTBOX_ASSET_THUMB_STRIP_INSET
                }
                onWebPreviewCaptureApiChange={
                  lightboxMediaCenterVariant.kind === 'model3d'
                    ? onLightboxWebPreviewCaptureApiChange
                    : undefined
                }
                onModel3dViewDirty={
                  lightboxMediaCenterVariant.kind === 'model3d'
                    ? markLightboxModel3dViewDirty
                    : undefined
                }
                model3dViewState={
                  lightboxMediaCenterVariant.kind === 'model3d'
                    ? lightboxAsset.model3dViewState ?? null
                    : undefined
                }
                onModel3dViewStateChange={
                  lightboxMediaCenterVariant.kind === 'model3d'
                    ? persistLightboxModel3dViewState
                    : undefined
                }
              />
            ) : undefined
          }
          centerSlotFullBleed={Boolean(lightboxCenterRoute?.centerSlotFullBleed)}
          onClose={handleLightboxClose}
          wheelListLength={lightboxList.length}
          onWheelNavigate={handleLightboxWheelNavigate}
          innerWheelOptionCount={getDisplayKeysForAsset(lightboxAsset).length}
          onWheelInnerNavigate={handleLightboxWheelCycleDisplay}
          innerLayoutStableKey={lightboxShowsImage ? lightboxAsset.id : undefined}
          onFlatImagePixelSample={
            lightboxChromeReady &&
            lightboxRasterChrome &&
            lightboxModelUrls.length === 0
              ? handleLightboxPointerRgbSample
              : undefined
          }
          onPreviewLayoutChange={
            lightboxRasterChrome ? handleLightboxPreviewLayoutChange : undefined
          }
          onUiHiddenChange={handleLightboxUiHiddenChange}
          shellRightGutter={
            workspaceQuickComposeExpanded ? WORKFLOW_LIGHTBOX_COMPOSE_DOCKED_INSET : undefined
          }
          contentRightInset={
            lightboxUiHidden ? '0px' : WORKFLOW_LIGHTBOX_ASSET_THUMB_STRIP_INSET
          }
          rightRail={
            !lightboxUiHidden ? (
              <WorkflowLightboxAssetThumbStrip
                assets={lightboxList}
                activeAssetId={lightboxAsset.id}
                onSelectAsset={handleLightboxStripSelect}
                getPreviewSrc={getLightboxStripPreviewSrc}
                canCopyImage={canWorkflowAssetCopyImage}
                onCopyImage={handleWorkflowAssetCopyImage}
                onCopyId={handleWorkflowAssetCopyId}
                canOpenFolder={canWorkflowAssetOpenFolder}
                openFolderDisabledReason={workflowAssetOpenFolderDisabledReason}
                onOpenFolder={handleWorkflowAssetOpenFolder}
                onAddToComposeInput={handleWorkflowAssetAddToComposeInput}
                canAddToComposeInput={canWorkflowAssetAddToComposeInput}
                getMediaVariant={(asset) => (workflowResultUsesVideoPreview(asset) ? 'video' : 'image')}
                onModelThumbnailCaptured={persistCapturedWorkflowModelThumbnail}
                companionBaseUrl={String(getCompanionLocalBaseUrl() || '')}
                companionProjectId={String(workspaceProjectChrome?.activeProjectId || '')}
              />
            ) : undefined
          }
          contentLeftInset={
            !lightboxUiHidden && lightboxStepSideChrome
              ? WORKFLOW_LIGHTBOX_VGP_GRAPH_LEFT_INSET
              : '0px'
          }
          enablePanoramaMode={Boolean(lightboxTexturePreviewSrc || lightboxShowsImage)}
          modelUrls={lightboxTexturePreviewSrc ? [] : lightboxModelUrls}
          modelFileName={lightboxTexturePreviewSrc ? undefined : lightboxModelFileNameHint}
          model3dPbrEditDoc={
            lightboxTexturePreviewSrc
              ? null
              : resolveWorkflowAssetPbrEditDoc(lightboxAsset, {
                  stepKey: lightboxAsset.displayKey,
                  variantId: lightboxMediaCenterVariant?.id,
                  modelKey:
                    lightboxMediaCenterVariant?.modelCompanionKeys?.[0] ||
                    lightboxMediaCenterVariant?.id,
                })
          }
          resolvePbrTextureAssetSrc={(textureAssetId) => {
            const tex = assetsRef.current.find((a) => a.id === textureAssetId);
            return tex ? getAssetDisplayImage(tex) : '';
          }}
          model3dDisplayMode={lightboxModel3dDisplayMode}
          model3dResetViewNonce={lightboxModel3dResetViewNonce}
          model3dShowGrid={lightboxModel3dShowGrid}
          model3dBackfaceCulling={lightboxModel3dBackfaceCulling}
          onModel3dDisplayModeChange={
            lightboxTexturePreviewSrc
              ? undefined
              : (mode) => {
                  markLightboxModel3dViewDirty();
                  setLightboxModel3dDisplayMode(mode);
                }
          }
          onDownloadCurrent={handleLightboxDownloadCurrent}
          onCopyCurrent={handleLightboxCopyCurrent}
          onStartCrop={handleLightboxStartCrop}
          onRunRembg={runLightboxRembg}
          onCapturePreview={
            lightboxMediaCenterVariant
              ? () => setLightboxMediaCapturePreviewNonce((nonce) => nonce + 1)
              : handleLightboxCapturePreview
          }
          onAddCurrentToInput={handleLightboxAddCurrentToInput}
          onModel3dResetView={
            lightboxTexturePreviewSrc
              ? undefined
              : () => {
                  markLightboxModel3dViewDirty();
                  setLightboxModel3dResetViewNonce((nonce) => nonce + 1);
                }
          }
          onModel3dToggleGrid={
            lightboxTexturePreviewSrc
              ? undefined
              : () => {
                  markLightboxModel3dViewDirty();
                  setLightboxModel3dShowGrid((visible) => !visible);
                }
          }
          onModel3dToggleBackfaceCulling={
            lightboxTexturePreviewSrc
              ? undefined
              : () => {
                  markLightboxModel3dViewDirty();
                  setLightboxModel3dBackfaceCulling((enabled) => !enabled);
                }
          }
          onUseCapabilityOutputAsInput={handleLightboxUseCapabilityOutputAsInput}
          onSaveCapabilityOutput={handleLightboxSaveCapabilityOutput}
          layoutReferenceSrc={
            lightboxShowsImage && asWorkflowImageString(lightboxAsset.original).trim()
              ? workflowSafeImgSrc(lightboxAsset.original)
              : undefined
          }
          panoViewerRef={lightboxPanoViewerRef}
          onWebPreviewCaptureApiChange={
            lightboxChromeReady && lightboxRasterChrome && !lightboxModelPreviewActive
              ? onLightboxWebPreviewCaptureApiChange
              : undefined
          }
          onModel3dViewDirty={
            lightboxChromeReady && !lightboxTexturePreviewSrc
              ? markLightboxModel3dViewDirty
              : undefined
          }
          model3dViewState={
            lightboxChromeReady && !lightboxTexturePreviewSrc
              ? lightboxAsset.model3dViewState ?? null
              : undefined
          }
          onModel3dViewStateChange={
            lightboxChromeReady && !lightboxTexturePreviewSrc
              ? persistLightboxModel3dViewState
              : undefined
          }
          heightfieldToolbarHostRef={lightboxHeightfieldToolbarHostRef}
          canvasAdjustControl={lightboxChromeReady && !lightboxModelPreviewActive ? lightboxCanvasAdjustControl : null}
          imageResizeWriteBack={
            lightboxChromeReady && lightboxRasterChrome && !lightboxModelPreviewActive
              ? { onCommit: handleLightboxImageResizeWriteBack }
              : null
          }
          flatImageOverlay={
            lightboxChromeReady && lightboxRasterChrome
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
            lightboxChromeReady ? (
            <>
              {lightboxChromeSlots.showApply ? (
                <button
                  type="button"
                  onClick={() => {
                    void applyWorkshopDisplayToCheckout(lightboxAsset.id, lightboxAsset.displayKey);
                  }}
                  className="inline-flex h-7 shrink-0 items-center rounded-md bg-blue-600 px-1.5 text-[8px] font-black tracking-wide text-white ring-1 ring-blue-400/40 hover:bg-blue-500 outline-none"
                  title="把当前显示覆盖到本地文件"
                >
                  应用
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void handleLightboxDownloadCurrent();
                }}
                className={LIGHTBOX_ICON_BTN_PRIMARY}
                title={lightboxShowsImage ? '下载当前预览图' : lightboxCenterRoute?.mode === 'text' ? '下载为文本文件' : '下载当前预览'}
                aria-label={lightboxShowsImage ? '下载当前预览图' : lightboxCenterRoute?.mode === 'text' ? '下载为文本文件' : '下载当前预览'}
              >
                <Download {...LIGHTBOX_BAR_IC} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => handleLightboxAddCurrentToInput()}
                className={LIGHTBOX_ICON_BTN_NEUTRAL}
                title="加入输入"
                aria-label="加入输入"
              >
                <Plus {...LIGHTBOX_BAR_IC} aria-hidden />
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
              {lightboxChromeSlots.typeCluster === 'model3d' ? (
                <>
                  <div className={WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER} aria-hidden />
                  <WorkflowLightboxModel3dRail
                    displayMode={lightboxModel3dDisplayMode}
                    showGrid={lightboxModel3dShowGrid}
                    backfaceCulling={lightboxModel3dBackfaceCulling}
                    onDisplayModeChange={(mode) => {
                      markLightboxModel3dViewDirty();
                      setLightboxModel3dDisplayMode(mode);
                    }}
                    onResetView={() => {
                      markLightboxModel3dViewDirty();
                      setLightboxModel3dResetViewNonce((nonce) => nonce + 1);
                    }}
                    onToggleGrid={() => {
                      markLightboxModel3dViewDirty();
                      setLightboxModel3dShowGrid((visible) => !visible);
                    }}
                    onToggleBackfaceCulling={() => {
                      markLightboxModel3dViewDirty();
                      setLightboxModel3dBackfaceCulling((enabled) => !enabled);
                    }}
                    onCapturePreview={() => {
                      if (lightboxMediaCenterVariant?.kind === 'model3d') {
                        setLightboxMediaCapturePreviewNonce((nonce) => nonce + 1);
                      } else {
                        void handleLightboxCapturePreview();
                      }
                    }}
                  />
                </>
              ) : null}
            </>
            ) : undefined
          }
          detailToggle={{
            expanded: lightboxDetailPanelOpen,
            onToggle: () => setLightboxDetailPanelOpen((open) => !open),
            available: lightboxChromeReady && !lightboxUiHidden,
          }}
        >
          {lightboxChromeReady && lightboxDetailPanelOpen ? (
          <>
          <WorkflowLightboxDetailEdgePanel
            edgeRightClassName="right-0"
            heightfieldToolbarHostRef={lightboxHeightfieldToolbarHostRef}
            heightfieldToolbarHostClassName={
              lightboxRasterChrome && lightboxPreviewLayout === 'heightfield'
                ? `${WORKFLOW_IMAGE_PREVIEW_RAIL.replace('inline-flex', 'flex')} w-full min-w-0 shrink-0 flex-wrap pointer-events-auto`
                : 'hidden'
            }
            headerSlot={
              lightboxShowTripo3DToolbar && !lightboxMediaCenterVariant ? (
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
              ) : null
            }
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
                executionStartedAt={lightboxActiveExecution?.startedAt ?? null}
                executionStepLabel={lightboxActiveExecution?.stepLabel ?? null}
              />
          </WorkflowLightboxDetailEdgePanel>
          {!lightboxMediaCenterVariant && !lightboxModelDownloadsOnRight && lightboxModelDownloadSlots.length > 0 ? (
          <div
            className={`absolute bottom-4 left-1/2 z-10 max-h-[42vh] w-max max-w-[min(58rem,calc(100vw-3rem))] -translate-x-1/2 overflow-y-auto ${WORKFLOW_LIGHTBOX_BOTTOM_RAIL}`}
            data-image-preview-no-wheel
            data-image-preview-scroll
          >
            {lightboxModelDownloadSlots.map((slot) => (
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
                ))}
          </div>
          ) : null}
          </>
          ) : null}
        </AssetPreviewOverlay>
      )}

      {lightboxAsset &&
        !showArchived &&
        lightboxChromeReady &&
        lightboxStepSideChrome &&
        !lightboxUiHidden ? (
        <React.Fragment key={lightboxAsset.id}>
          <WorkflowStepNodeGraphOverlay
            asset={lightboxAsset}
            getStepLabel={(k) => getGenerationRecordStepLabel(k, lightboxAsset)}
            onSelectDisplayKey={(key) => {
              setLightboxTexturePreview(null);
              setDisplayKey(lightboxAsset.id, key);
            }}
            onPreviewTexture={(src) => {
              setLightboxTexturePreview({ assetId: lightboxAsset.id, src });
              setLightboxPreviewLayout('flat');
            }}
            activePreviewTextureSrc={lightboxTexturePreviewSrc}
            onNodeMenuAction={handleLightboxNodeGraphMenuAction}
            resolvePbrTextureAssetSrc={(textureAssetId) => {
              const tex = assetsRef.current.find((a) => a.id === textureAssetId);
              return tex ? getAssetDisplayImage(tex) : '';
            }}
            pixelBusy={busyAssetIds.has(lightboxAsset.id)}
            pixelBusyInputDisplayKeys={busyInputDisplayKeysByAssetId.get(lightboxAsset.id) || []}
          />
        </React.Fragment>
      ) : null}

      {lightboxAsset &&
        !showArchived &&
        lightboxChromeReady &&
        lightboxRasterChrome &&
        !lightboxModelPreviewActive &&
        lightboxPreviewLayout !== 'model3d' &&
        !lightboxUiHidden &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[2400]"
            style={{
              top: 0,
              left: 0,
              bottom: 0,
              right: workspaceQuickComposeExpanded
                ? WORKFLOW_LIGHTBOX_COMPOSE_DOCKED_INSET
                : lightboxChromeReady
                  ? WORKFLOW_LIGHTBOX_ASSET_THUMB_STRIP_INSET
                  : 0,
            }}
          >
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
              composeDockExpanded={workspaceQuickComposeExpanded}
              lightboxChromeReady={lightboxChromeReady}
            />
          </div>,
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
            creditBalance={creditBalance}
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
                            resolveCapabilityDropDragSources(
                              draggingAssetIdsRef.current,
                              draggingGroupItemsRef.current,
                              e.dataTransfer
                            ),
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
                    for (let i = 1; i < generateCount; i += 1) {
                      const cloneId = uuid();
                      clonePlans.push({ sourceId: t.assetId, cloneId });
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
            if (clonePlans.length > 0 && !workshopDiskOpen) {
              setAssets((prev) => {
                const next = [...prev];
                for (const plan of clonePlans) {
                  const src = next.find((a) => a.id === plan.sourceId);
                  if (!src) continue;
                  const clone: WorkflowAsset = {
                    ...src,
                    id: plan.cloneId,
                    parentAssetId: undefined,
                    groupId: undefined,
                    groupLabel: undefined,
                    groupOrder: undefined,
                    archived: false,
                    hiddenInGrid: false,
                    createdAt: Date.now(),
                  };
                  next.push(clone);
                  const o = String(clone.original || '').trim();
                  if (o) queueMicrotask(() => scheduleCompanionPersistOriginalAny(plan.cloneId, o));
                }
                return next;
              });
            }
            if (tasks.length > 0) {
              if (workshopDiskOpen && clonePlans.length > 0) {
                void (async () => {
                  const newAssets: WorkflowAsset[] = [];
                  for (const plan of clonePlans) {
                    const src = findLiveAsset(plan.sourceId) ?? assets.find((a) => a.id === plan.sourceId);
                    if (!src) continue;
                    newAssets.push({ ...src, id: plan.cloneId });
                  }
                  const cloneIds = new Set(newAssets.map((a) => a.id));
                  const cloneTasks = tasks.filter((t) => cloneIds.has(t.assetId));
                  const keepTasks = tasks.filter((t) => !cloneIds.has(t.assetId));
                  const remapped = await enqueueWorkshopGenerationBatch(newAssets, cloneTasks);
                  if (!remapped.ok) return;
                  addTasksToPending([...keepTasks, ...remapped.tasks]);
                })();
              } else {
                addTasksToPending(tasks);
              }
            }
            setPromptTweakModal(null);
            clearWorkflowDragSession();
          }}
          onCancel={() => {
            setPromptTweakModal(null);
            clearWorkflowDragSession();
          }}
        />
      )}
      </div>
    </div>
    {typeof document !== 'undefined'
      ? createPortal(
          <WorkspaceQuickComposeBar
            {...quickComposeBarCommonProps}
            lightboxAnchorClient={quickComposeInLightbox ? lightboxQuickComposeAnchor : null}
            lightboxLayoutResetNonce={quickComposeInLightbox ? lightboxQuickComposeLayoutNonce : 0}
            expandedDockHostRef={quickComposeWorkspaceDockHostRef}
            onInputExpandedChange={handleQuickComposeInputExpandedChange}
          />,
          document.body
        )
      : null}
    {lightboxLaunchAnimation && typeof document !== 'undefined'
      ? createPortal(
          <div className="pointer-events-none fixed inset-0 z-[12050]" aria-hidden>
            <img
              src={lightboxLaunchAnimation.src}
              alt=""
              className="absolute rounded-lg object-cover shadow-2xl ring-1 ring-white/20"
              style={{
                left: lightboxLaunchAnimation.active
                  ? lightboxLaunchAnimation.to.left
                  : lightboxLaunchAnimation.from.left,
                top: lightboxLaunchAnimation.active
                  ? lightboxLaunchAnimation.to.top
                  : lightboxLaunchAnimation.from.top,
                width: lightboxLaunchAnimation.active
                  ? lightboxLaunchAnimation.to.width
                  : lightboxLaunchAnimation.from.width,
                height: lightboxLaunchAnimation.active
                  ? lightboxLaunchAnimation.to.height
                  : lightboxLaunchAnimation.from.height,
                opacity: lightboxLaunchAnimation.active ? 0.18 : 0.98,
                transform: lightboxLaunchAnimation.active ? 'scale(1.01)' : 'scale(1)',
                transition:
                  'left 320ms cubic-bezier(0.2, 0.8, 0.2, 1), top 320ms cubic-bezier(0.2, 0.8, 0.2, 1), width 320ms cubic-bezier(0.2, 0.8, 0.2, 1), height 320ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 220ms ease-out, transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)',
              }}
            />
          </div>,
          document.body
        )
      : null}
    {workflowAssetContextMenu && typeof document !== 'undefined'
      ? (() => {
          const menuAsset = assets.find((x) => x.id === workflowAssetContextMenu.assetId);
          if (!menuAsset) return null;
          return createPortal(
            <WorkflowAssetContextMenu
              open
              x={workflowAssetContextMenu.x}
              y={workflowAssetContextMenu.y}
              canCopyImage={canWorkflowAssetCopyImage(menuAsset)}
              onCopyImage={() => {
                void handleWorkflowAssetCopyImage(menuAsset);
              }}
              onCopyId={() => {
                void handleWorkflowAssetCopyId(menuAsset);
              }}
              canOpenFolder={canWorkflowAssetOpenFolder(menuAsset)}
              openFolderDisabledReason={workflowAssetOpenFolderDisabledReason(menuAsset)}
              onOpenFolder={() => {
                void handleWorkflowAssetOpenFolder(menuAsset);
              }}
              canAddToComposeInput={canWorkflowAssetAddToComposeInput(menuAsset)}
              onAddToComposeInput={() => {
                handleWorkflowAssetAddToComposeInput(menuAsset);
              }}
              onClose={() => setWorkflowAssetContextMenu(null)}
            />,
            document.body
          );
        })()
      : null}
    </>
  );
};

export default WorkflowSection;
