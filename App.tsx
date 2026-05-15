
import React, { Suspense, useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import {
  processTexture,
  DEFAULT_PROMPTS,
  normalizeApiErrorMessage,
  getTexturePrompt,
  parsePromptStructured,
  getTencentCredsFromEnv,
} from './services/unifiedAiGateway';
import {
  buildTripoCreateTaskInputFromPreset,
  extractTripoModelAndPreviewUrls,
  extractTencentModelAndPreviewUrls,
  normalizeGenerate3DPresetForRun,
  resolveGenerate3dProviderId,
  tencentWorkflowRunImageTo3D,
  tripoWorkflowCreateOrResumeTaskId,
  tripoWorkflowPollUntilDone,
} from './services/generate3d';
import { DEFAULT_MODEL_IMAGE, DEFAULT_MODEL_PRO, DEFAULT_MODEL_TEXT } from './services/modelRegistry/constants';
import { migrateSystemModelSlots } from './services/modelRegistry/systemConfigMigrate';
import { useEffectiveImageGearRows } from './hooks/useEffectiveImageGearRows';
import { loadRecords, addRecord as addGenerationRecord, updateScore as updateGenerationScore } from './services/recordStore';
import { loadSnippets } from './services/snippetStore';
import { AppStep, AppMode, LibraryItem, SystemConfig, AppTask, AssetCategory, DialogMessage, DialogSession, DialogTempItem, DialogImageGear, DIALOG_ASPECT_RATIO_OPTIONS, SUPPORTED_IMAGE_SIZES, DIALOG_IMAGE_GEARS, type GenerationRecord, type CustomAppModule, type CapabilitySet, type WorkflowAsset, type WorkflowPendingTask, type ArenaCurrentStep, type ArenaStepEntry, type ArenaTimelineBlock } from './types';
import { runCapabilityTest } from './services/capabilityTestRunner';
import { loadCapabilityPresets, saveCapabilityPresets, CAPABILITY_PRESETS_KEY } from './services/capabilityPresetStore';
import { loadCapabilitySets, saveCapabilitySets, CAPABILITY_SETS_KEY } from './services/capabilitySetStore';
import { useWorkflowMainScrollCapture, type WorkflowCapabilityGutterDropConfig } from './hooks/useWorkflowMainScrollCapture';
import { useDialogWorkspace } from './hooks/useDialogWorkspace';
import { useDialogGeneration } from './hooks/useDialogGeneration';
import { useDialogPostProcessing } from './hooks/useDialogPostProcessing';
import { useAuth } from './components/auth/AuthContext';
import { CustomDropdown, DROPDOWN_TRIGGER_COMPACT } from './components/ui/CustomDropdown';
import { SidebarAccountAvatar } from './components/SidebarAccountAvatar';
import LazySectionFallback from './components/ui/LazySectionFallback';
import WorkflowModeShell from './components/WorkflowModeShell';
import WorkspaceSidebarFooter from './components/WorkspaceSidebarFooter';
import { useUserUiPrefs } from './hooks/useUserUiPrefs';
import Waves from './components/ui/Waves';
import AppIcon from './components/ui/AppIcon';
import GeminiFairnessFloatingNotice from './components/GeminiFairnessFloatingNotice';
import { RIGHT_DOCK_LOG_BOTTOM, RIGHT_DOCK_LOG_PANEL_BOTTOM, RIGHT_DOCK_RIGHT } from './components/floatingDockConstants';
import { ProgressivePreviewImage } from './components/ProgressivePreviewImage';
import { DialogSessionRowBackdrop } from './components/DialogSessionRowBackdrop';
import { SiteImage } from './components/SiteImage';
import {
  getLazyImagePreviewViewer,
  PreviewViewerFallback,
  previewPolicyForMode,
} from './components/preview';
import {
  loadWorkspaceProjects,
  saveWorkspaceProjects,
  createWorkspaceProject,
  getLastOpenedWorkspaceProjectId,
  loadWorkflowBundle,
  saveWorkflowBundle,
  consumeWorkspaceMigrationNotices,
  trySaveWorkflowBundle,
  removeWorkflowBundle,
  setLastOpenedWorkspaceProjectId,
  ensureWorkspaceBundlesHydratedFromIdb,
  flushWorkspaceBundleIdbWrites,
  migrateWorkflowBundleProjectId,
  type WorkspaceProject,
} from './services/workspaceProjectStore';
import {
  deleteWorkspaceProjectObjects,
  fetchWorkflowPackedFromCloud,
  fetchWorkspaceCloudIndex,
  isWorkspaceCloudEnabled,
  isWorkspaceCloudLiteStructureSyncEnabled,
  migrateLocalWorkspaceToCloud,
  pushWorkflowBundleToCloud,
  pushWorkflowLiteStructureToCloud,
  pushWorkspaceIndex,
  WORKSPACE_CLOUD_DEFAULT_QUOTA_BYTES,
} from './services/workspaceCloudSync';
import { isWorkspaceCloudBundleMergeEnabled, reconcileWorkflowBundleWithCloud } from './services/workspaceBundleCloudReconcile';
import { computeLiteStructureLocalFingerprint } from './services/workflowBundleLiteStructure';
import { dialogVersionHasRenderableImage, dialogVersionsForMessage, getDialogVersionImageDataUrl } from './services/dialogImageHelpers';
import { HttpRequestError } from './services/httpClient';
import { triggerImageDownload } from './services/imageDataUrl';
import { downloadModelFromSource } from './services/downloadModelFile';
import { persistTripoModelsForWorkflowAsset } from './services/tripoModelPersist';
import { persistTencentModelsForWorkflowAsset } from './services/tencentModelPersist';
import { patchWorkflowAssetsWith3dResult } from './services/workflowGenerate3dAssetPatch';
import {
  getAiProvider,
  getAiProviderToolbarLabel,
  getAntigravityApiKey,
  getAntigravityBaseUrl,
  getOpenaiApiKey,
  getOpenaiBaseUrl,
  getDialogSkipUnderstand,
  getToapisApiKey,
  getToapisBaseUrl,
  getTripoApiKey,
  getUserApiKey,
  getVectorengineApiKey,
  getVectorengineBaseUrl,
  getWorkspaceAutoSyncEnabled,
  isAiInvocationReady,
  setAiProvider,
  setAntigravityApiKey,
  setAntigravityBaseUrl,
  setOpenaiApiKey,
  setOpenaiBaseUrl,
  setDialogSkipUnderstand,
  setToapisApiKey,
  setToapisBaseUrl,
  setUserApiKey,
  setVectorengineApiKey,
  setVectorengineBaseUrl,
  setWorkspaceAutoSyncEnabled,
} from './services/settingsStore';
import {
  buildCapabilityCloudRecords,
  fetchWorkspaceUserCloudConfig,
  mergeCapabilityCloudRecords,
  pushWorkspaceUserCloudConfig,
  type CapabilityCloudRecord,
} from './services/workspaceUserCloudConfig';
import { getUserUiPrefs, setUserUiPrefs } from './services/userUiPrefs';
import { getDialogBridgePrefs, setDialogBridgePrefs, subscribeDialogBridgePrefs } from './services/dialogBridgePrefs';
import { fetchBridgeUserDevices } from './services/dialogBridgeClient';
import { WorkflowApiKeyModal } from './components/WorkflowApiKeyModal';
import { reportClientDebugLog } from './services/clientDebugLog';
import { getCompanionLocalBaseUrl } from './services/companionLocalPrefs';
import {
  createCompanionWorkspaceProject,
  deleteCompanionWorkspaceProject,
  fetchCompanionAssetBlob,
  listCompanionWorkspaceProjects,
  listCompanionWorkspaceTrashProjects,
  putCompanionAsset,
  renameCompanionWorkspaceProject,
  restoreCompanionWorkspaceTrashProject,
  getCompanionManifest,
  reconcileCompanionManifestFromDisk,
  type CompanionWorkspaceTrashProjectV1,
} from './services/companionClient';
import {
  attemptRepairCompanionManifestKeyGaps,
  findCompanionKeysMissingFromManifest,
  mergeUnlinkedManifestEntriesIntoWorkflowAssets,
} from './services/workflowManifestCrossCheck';
import { fetchCompanionAssetAsDataUrl } from './services/workflowCompanionAssets';
import { collectReferencedObjectKeysFromPackedV2, hydrateWorkflowBundleFromCloud } from './services/workspaceR2ImageBundle';
function isImagePreviewEscapeKey(e: KeyboardEvent): boolean {
  return e.key === 'Escape' || e.code === 'Escape' || e.keyCode === 27;
}

type ClipboardCopyOutcome = 'clipboard' | 'exec' | 'manual';

function tryCopyTextViaExecCommand(text: string): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return Boolean(ok);
  } catch {
    return false;
  }
}

async function copyTextToClipboardWithFallback(text: string): Promise<ClipboardCopyOutcome> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return 'clipboard';
    } catch {
      // fall through
    }
  }
  if (typeof document !== 'undefined' && tryCopyTextViaExecCommand(text)) {
    return 'exec';
  }
  return 'manual';
}

/** 自动同步间隔：默认 3 分钟，减少后台上传频率；可在 .env 设 `VITE_WORKSPACE_AUTO_SYNC_INTERVAL_MS`（30000～3600000）覆盖 */
function readWorkspaceAutoSyncIntervalMs(): number {
  const raw = import.meta.env.VITE_WORKSPACE_AUTO_SYNC_INTERVAL_MS;
  if (raw === undefined || raw === '') return 3 * 60 * 1000;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 3 * 60 * 1000;
  return Math.min(3600_000, Math.max(30_000, Math.floor(n)));
}
const WORKSPACE_AUTO_SYNC_INTERVAL_MS = readWorkspaceAutoSyncIntervalMs();

/** 轻量结构同步防抖（毫秒）：默认 25000；`VITE_WORKSPACE_CLOUD_LITE_SYNC_MS`，合法 5000～300000 */
function readWorkspaceLiteStructureDebounceMs(): number {
  const raw = import.meta.env.VITE_WORKSPACE_CLOUD_LITE_SYNC_MS;
  if (raw === undefined || raw === '') return 25_000;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 25_000;
  return Math.min(300_000, Math.max(5_000, Math.floor(n)));
}
const WORKSPACE_LITE_STRUCTURE_DEBOUNCE_MS = readWorkspaceLiteStructureDebounceMs();

/** 打开项目时：是否把伴侣 manifest 里非 wf-orig/wf-res/wf-mdl 的遗留文件扫成多张新卡（默认关，避免打乱组与生成关系） */
const WORKSPACE_IMPORT_LEGACY_COMPANION_ORPHANS =
  String(import.meta.env.VITE_WORKSPACE_IMPORT_LEGACY_COMPANION_ORPHANS || '').trim().toLowerCase() === 'true';

function estimateStringBytes(value: string): number {
  if (!value) return 0;
  const v = String(value);
  if (v.startsWith('data:')) {
    const comma = v.indexOf(',');
    if (comma >= 0 && comma < v.length - 1) {
      const payload = v.slice(comma + 1);
      return Math.floor((payload.length * 3) / 4);
    }
  }
  return v.length;
}

function formatApproxBytes(bytes: number): string {
  const n = Math.max(0, Number(bytes) || 0);
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${Math.round(n)} B`;
}

type ManualUploadMode = 'full' | 'incremental';
type ManualUploadEstimate = {
  assetCount: number;
  previewCount: number;
  modelCount: number;
  bytesApprox: number;
};

function buildManualUploadEstimate(assets: WorkflowAsset[]): ManualUploadEstimate {
  let previewCount = 0;
  let modelCount = 0;
  let bytesApprox = 0;
  for (const asset of assets) {
    const original = String(asset?.original || '');
    if (original) {
      previewCount += 1;
      bytesApprox += estimateStringBytes(original);
    }
    const models = Array.isArray(asset?.modelUrls) ? asset.modelUrls : [];
    modelCount += models.length;
    for (const url of models) {
      bytesApprox += estimateStringBytes(String(url || ''));
    }
  }
  return {
    assetCount: assets.length,
    previewCount,
    modelCount,
    bytesApprox,
  };
}

function normalizeModelUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((it) => String(it || ''));
}

function buildAssetDiffSignature(asset: Partial<WorkflowAsset> | null | undefined): string {
  if (!asset) return '';
  const original = String(asset.original || '');
  const originalObjectKey = String(asset.originalObjectKey || '');
  const modelUrls = normalizeModelUrls(asset.modelUrls).join('|');
  const title = String((asset as Partial<WorkflowAsset> & { title?: string }).title || '');
  return [original, originalObjectKey, modelUrls, title].join('::');
}

function pickIncrementalAssets(localAssets: WorkflowAsset[], cloudAssets: WorkflowAsset[] | null): WorkflowAsset[] {
  if (!Array.isArray(cloudAssets)) return [...localAssets];
  const cloudSig = new Map<string, string>();
  for (const asset of cloudAssets) {
    cloudSig.set(String(asset?.id || ''), buildAssetDiffSignature(asset));
  }
  return localAssets.filter((asset) => {
    const id = String(asset?.id || '');
    if (!id) return true;
    const prev = cloudSig.get(id);
    const next = buildAssetDiffSignature(asset);
    return !prev || prev !== next;
  });
}

function pickAssetsById(localAssets: WorkflowAsset[], ids: string[]): WorkflowAsset[] {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const idSet = new Set(ids.map((id) => String(id || '').trim()).filter(Boolean));
  return localAssets.filter((asset) => idSet.has(String(asset?.id || '').trim()));
}

/** 对话大图预览全景模式：与工作区 ImagePreviewOverlay 同 registry chunk */
const LazyDialogTempEquirectViewer = getLazyImagePreviewViewer('image.equirect');

const WorkflowSection = React.lazy(() => import('./components/WorkflowSection'));
const CapabilityPresetSection = React.lazy(() => import('./components/CapabilityPresetSection'));
const WorkflowComposerOverlay = React.lazy(() => import('./components/WorkflowComposerOverlay'));
const PromptArenaSection = React.lazy(() => import('./components/PromptArenaSection'));
const SeamRepairSection = React.lazy(() => import('./components/SeamRepairSection'));
const GenerateTextureSection = React.lazy(() => import('./components/GenerateTextureSection'));
const SiteAssistant = React.lazy(() => import('./components/SiteAssistant'));
const SettingsSection = React.lazy(() => import('./components/SettingsSection'));
const RequireRole = React.lazy(() => import('./components/auth/RequireRole'));
const AdminLayout = React.lazy(() => import('./components/admin/AdminLayout.js'));
const AdminPlaceholder = React.lazy(() => import('./components/admin/AdminPlaceholder.tsx'));
const AdminUsersPanel = React.lazy(() => import('./components/admin/AdminUsersPanel'));
const AdminAuditLogsPanel = React.lazy(() => import('./components/admin/AdminAuditLogsPanel'));
const AdminCompanionArtifactsPanel = React.lazy(() => import('./components/admin/AdminCompanionArtifactsPanel'));
const AdminGeminiFairnessPanel = React.lazy(() => import('./components/admin/AdminGeminiFairnessPanel'));
type SourceAggregate = {
  count: number;
  rated: number;
  sumScore: number;
  samples: { fullPrompt: string; instruction?: string; userScore: number }[];
};

/** 主内容区滚动容器 ref，用于全局回到顶部 */
function useMainScrollBackToTop() {
  const [mainScrollEl, setMainScrollEl] = useState<HTMLDivElement | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  useEffect(() => {
    if (!mainScrollEl) return;
    const onScroll = () => setShowBackToTop(mainScrollEl.scrollTop > 300);
    mainScrollEl.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => mainScrollEl.removeEventListener('scroll', onScroll);
  }, [mainScrollEl]);
  return { mainScrollRef: setMainScrollEl, showBackToTop, scrollToTop: () => mainScrollEl?.scrollTo({ top: 0, behavior: 'smooth' }) };
}

/** 资产仓库筛选中文标签（与 AssetViewer 一致） */
const LIBRARY_CATEGORY_LABELS: Record<AssetCategory | 'ALL', string> = {
  ALL: '全部',
  SCENE_OBJECT: '场景物体',
  PREVIEW_STRIP: '预览图集',
  PRODUCTION_ASSET: '生产成品',
  MESH_MODEL: '3D模型',
  TEXTURE_MAP: '贴图资产',
};

// ==========================================
// 1. 核心组件 - 资产查看器
// ==========================================
const ASSET_VIEWER_CATEGORY_LABELS: Record<string, string> = {
  SCENE_OBJECT: '场景物体',
  PREVIEW_STRIP: '预览图集',
  PRODUCTION_ASSET: '生产成品',
  MESH_MODEL: '3D模型',
  TEXTURE_MAP: '贴图资产',
};

const SidebarIconButton: React.FC<{ active: boolean; label: string; onClick: () => void; children: React.ReactNode }> = ({ active, label, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className={`group relative flex h-10 w-full cursor-pointer items-center justify-center rounded-xl outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-blue-500/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505] ${
      active
        ? 'bg-[#152a4a] text-blue-200 ring-1 ring-blue-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
        : 'text-gray-400 ring-1 ring-transparent hover:bg-white/[0.06] hover:ring-white/[0.06]'
    }`}
  >
    {children}
    <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 rounded-lg bg-[#0c0c0f] px-2 py-1 text-[10px] text-gray-200 ring-1 ring-white/[0.12] shadow-md whitespace-nowrap opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 motion-reduce:transition-none">
      {label}
    </span>
  </button>
);

const AssetViewer: React.FC<{ item: LibraryItem | null; onClose: () => void }> = ({ item, onClose }) => {
  if (!item) return null;
  const categoryLabel = ASSET_VIEWER_CATEGORY_LABELS[item.category] ?? item.category;
  const is3D = item.category === 'MESH_MODEL' && (item.modelUrls?.length ?? 0) > 0;
  const isPlaceholderPreview = item.data?.includes('data:image/svg+xml') && is3D;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/75 backdrop-blur-sm animate-in fade-in duration-300 p-4 lg:p-20" onClick={onClose}>
      <div className="relative max-w-7xl w-full h-full flex flex-col items-center justify-center" onClick={e => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute top-0 right-0 w-12 h-12 flex items-center justify-center text-white/40 hover:text-white transition-colors duration-200 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 rounded-xl"><AppIcon name="close" className="w-5 h-5" /></button>
        <div className="w-full flex-1 flex items-center justify-center overflow-hidden rounded-[3rem] border border-[#252528] bg-[#16161a]">
          {isPlaceholderPreview ? (
            <div className="flex flex-col items-center justify-center gap-4 text-gray-500">
              <AppIcon name="cube" className="w-10 h-10" />
              <p className="text-[11px] font-black uppercase tracking-widest">3D 模型 · 请从下方下载模型文件</p>
            </div>
          ) : (
            <SiteImage src={item.data} className="max-w-full max-h-full object-contain shadow-2xl" alt={item.label} loading="eager" />
          )}
        </div>
        <div className="w-full mt-8 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black uppercase tracking-widest">{item.label}</h2>
              {is3D && <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-[#3730a3] text-indigo-300 border border-[#6366f1]">3D</span>}
            </div>
            <p className="text-[10px] mono text-blue-400 mt-1 uppercase tracking-widest">
              {categoryLabel}
              {item.style ? ` · ${item.style}` : ''} · {new Date(item.timestamp).toLocaleString()}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {item.data && !isPlaceholderPreview && (
              <button
                type="button"
                onClick={() => {
                  void triggerImageDownload(item.data!, item.label);
                }}
                className="px-6 py-3 bg-blue-600 rounded-full font-black text-[10px] uppercase tracking-widest electric-glow"
              >
                下载预览图
              </button>
            )}
            {item.modelUrls?.map((url, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  void downloadModelFromSource({
                    url,
                    fileNameHint: item.label,
                    tripoApiKey: getTripoApiKey(),
                    slotIndex: i,
                  }).catch((e) => {
                    console.warn('[library] download model', e);
                  });
                }}
                className="px-6 py-3 bg-[#3730a3] rounded-full font-black text-[10px] uppercase tracking-widest hover:bg-[#4f46e5] transition-colors"
              >
                下载模型{item.modelUrls!.length > 1 ? ` ${i + 1}` : ''}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// Admin 路由分流
// ==========================================

function usePathname() {
  const [path, setPath] = useState(() => window.location.pathname + window.location.search + window.location.hash);
  useEffect(() => {
    const onPop = () =>
      setPath(window.location.pathname + window.location.search + window.location.hash);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

function navigateTo(path: string) {
  if (window.location.pathname === path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const AdminAppShell: React.FC = () => {
  const fullPath = usePathname();
  const pathname = fullPath.split('?')[0];

  const handleNavigate = useCallback((path: string) => {
    navigateTo(path);
  }, []);

  return (
    <Suspense fallback={<div className="min-h-screen bg-black text-white flex items-center justify-center text-[11px]">加载管理后台…</div>}>
      <AdminLayout currentPath={pathname} onNavigate={handleNavigate}>
        {pathname === '/admin/users' ? (
          <AdminUsersPanel />
        ) : pathname === '/admin/audit-logs' ? (
          <AdminAuditLogsPanel />
        ) : pathname === '/admin/companion-artifacts' ? (
          <AdminCompanionArtifactsPanel />
        ) : pathname === '/admin/gemini-fairness' ? (
          <AdminGeminiFairnessPanel />
        ) : (
          <AdminPlaceholder />
        )}
      </AdminLayout>
    </Suspense>
  );
};

// ==========================================
// 2. 交互式区域选择器 (支持手机端)
// ==========================================
const RegionSelector: React.FC<{ 
  src: string; 
  onConfirm: (croppedBase64: string) => void;
  onCancel: () => void;
}> = ({ src, onConfirm, onCancel }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [startPos, setStartPos] = useState<{x: number, y: number} | null>(null);
  const [currentPos, setCurrentPos] = useState<{x: number, y: number} | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    if ('touches' in e && e.cancelable) e.preventDefault();
    const pos = getPos(e);
    setStartPos(pos);
    setCurrentPos(pos);
    setIsSelecting(true);
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isSelecting) return;
    if ('touches' in e && e.cancelable) e.preventDefault();
    const pos = getPos(e);
    setCurrentPos(pos);
  };

  const handleEnd = () => {
    setIsSelecting(false);
  };

  const executeCrop = () => {
    if (!startPos || !currentPos) return;
    const img = new Image();
    img.src = src;
    img.onload = () => {
      const container = containerRef.current;
      if (!container) return;
      
      const scaleX = img.width / container.offsetWidth;
      const scaleY = img.height / container.offsetHeight;

      const x = Math.min(startPos.x, currentPos.x) * scaleX;
      const y = Math.min(startPos.y, currentPos.y) * scaleY;
      const width = Math.abs(startPos.x - currentPos.x) * scaleX;
      const height = Math.abs(startPos.y - currentPos.y) * scaleY;

      if (width < 5 || height < 5) {
        alert("请选择一个稍大的有效区域。");
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
        onConfirm(canvas.toDataURL('image/jpeg', 0.9));
      }
    };
  };

  const selectionRect = useMemo(() => {
    if (!startPos || !currentPos) return null;
    const width = Math.abs(startPos.x - currentPos.x);
    const height = Math.abs(startPos.y - currentPos.y);
    if (width < 2 && height < 2) return null;
    return {
      left: Math.min(startPos.x, currentPos.x),
      top: Math.min(startPos.y, currentPos.y),
      width,
      height
    };
  }, [startPos, currentPos]);

  return (
    <div className="flex flex-col gap-6 w-full">
      <div 
        ref={containerRef}
        className="relative aspect-square glass rounded-[2rem] lg:rounded-[2.5rem] overflow-hidden bg-[#16161a] cursor-crosshair border border-[#252528] touch-none"
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
      >
        <SiteImage src={src} className="w-full h-full object-contain pointer-events-none select-none" loading="eager" />
        {selectionRect && (
          <div 
            className="absolute border border-dashed border-blue-400/70 bg-blue-500/12 pointer-events-none shadow-[inset_0_0_0_1px_rgba(59,130,246,0.25)]"
            style={{
              left: selectionRect.left,
              top: selectionRect.top,
              width: selectionRect.width,
              height: selectionRect.height
            }}
          >
            <div className="absolute top-0 left-0 bg-blue-500 text-[8px] px-1 font-black text-white uppercase whitespace-nowrap">图案选取区</div>
          </div>
        )}
      </div>
      <div className="flex gap-4">
        <button onClick={onCancel} className="flex-1 py-4 bg-white/[0.05] ring-1 ring-white/[0.06] rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-[#2e2e36] transition-all">取消</button>
        <button onClick={executeCrop} disabled={!selectionRect} className="flex-1 py-4 bg-blue-600 rounded-2xl text-[9px] font-black uppercase tracking-widest electric-glow disabled:opacity-20 transition-all">确认提取</button>
      </div>
    </div>
  );
};

// ==========================================
// 3. 资产库导入弹窗（支持多选）
// ==========================================
const LibraryPickerModal: React.FC<{
  library: LibraryItem[];
  onSelect: (items: LibraryItem[]) => void;
  onClose: () => void;
  filter?: AssetCategory;
  multiSelect?: boolean;
}> = ({ library, onSelect, onClose, filter, multiSelect }) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const filtered = filter ? library.filter(i => i.category === filter) : library;
  const selectedItems = filtered.filter(i => selectedIds.has(i.id));

  const toggle = (id: string) => {
    if (!multiSelect) {
      const item = filtered.find(i => i.id === id);
      if (item) onSelect([item]);
      return;
    }
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const confirmMulti = () => {
    if (selectedItems.length) { onSelect(selectedItems); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-[2005] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4 lg:p-20" onClick={onClose}>
      <div className="glass max-w-6xl w-full h-full rounded-[3rem] flex flex-col p-8 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-sm font-black uppercase tracking-widest text-blue-400">从资产库导入{multiSelect ? '（可多选）' : ''}</h2>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white transition-colors"><AppIcon name="close" className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {filtered.length === 0 ? (
             <div className="h-full flex flex-col items-center justify-center text-gray-600">
              <AppIcon name="package" className="w-10 h-10 mb-4" />
               <span className="text-[10px] font-black uppercase tracking-widest">暂无可用资产</span>
             </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
              {filtered.map(item => (
                <div
                  key={item.id}
                  onClick={() => toggle(item.id)}
                  className={`glass aspect-square rounded-2xl p-2 cursor-pointer border-[#252528] hover:border-blue-500 transition-all group overflow-hidden relative ${multiSelect && selectedIds.has(item.id) ? 'ring-2 ring-blue-500' : ''}`}
                >
                  <SiteImage src={item.data} className="w-full h-full object-contain" alt="" />
                  {multiSelect && (
                    <div className="absolute top-1 right-1 w-5 h-5 rounded border flex items-center justify-center bg-[#18181c]">
                      {selectedIds.has(item.id) ? <AppIcon name="check" className="w-3.5 h-3.5 text-blue-400" /> : null}
                    </div>
                  )}
                  {!multiSelect && (
                    <div className="absolute inset-0 bg-[#1e3558] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-[8px] font-black uppercase tracking-widest bg-blue-600 px-3 py-1 rounded-full shadow-lg">选中</span>
                    </div>
                  )}
                  <div className="absolute bottom-1 left-2 right-2 truncate text-[6px] font-black uppercase text-white/40">{item.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {multiSelect && filtered.length > 0 && (
          <div className="shrink-0 pt-4 flex justify-end">
            <button onClick={confirmMulti} disabled={selectedItems.length === 0} className="px-6 py-2.5 rounded-xl bg-blue-600 text-[10px] font-black uppercase disabled:opacity-40">
              确认导入（{selectedItems.length}）
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ==========================================
// 5. 主应用程序
// ==========================================

/** 暂时关闭「对话模式」整页（侧栏入口与主区 UI）。恢复时改为 `true`。 */
const DIALOG_PAGE_ENABLED = false;

/** 主站： hooks 必须始终在同一调用顺序下执行，不可与 /admin 分支混在同一个组件里 */
const MainApp: React.FC = () => {
  const { user, logout, loading: authLoading, refresh: refreshAuthUser } = useAuth();
  const userUiPrefs = useUserUiPrefs();

  const [mode, setMode] = useState<AppMode>(AppMode.WORKFLOW);
  useEffect(() => {
    if (!DIALOG_PAGE_ENABLED && mode === AppMode.DIALOG) {
      setMode(AppMode.WORKFLOW);
    }
    if (mode === AppMode.GENERATE_3D) {
      setMode(AppMode.WORKFLOW);
    }
  }, [mode]);
  const [capabilityPresets, setCapabilityPresets] = useState<CustomAppModule[]>(loadCapabilityPresets);
  const [capabilitySets, setCapabilitySets] = useState<CapabilitySet[]>(loadCapabilitySets);
  type GlobalComposerSession = { id: string; initialSet: CapabilitySet | null; sessionKey: number };
  const [globalComposerSessions, setGlobalComposerSessions] = useState<GlobalComposerSession[]>([]);
  const [globalComposerActiveId, setGlobalComposerActiveId] = useState<string | null>(null);
  const [globalComposerMinimized, setGlobalComposerMinimized] = useState<Record<string, boolean>>({});
  const globalComposerActiveIdRef = useRef<string | null>(null);
  useEffect(() => {
    globalComposerActiveIdRef.current = globalComposerActiveId;
  }, [globalComposerActiveId]);
  const openGlobalWorkflowComposer = useCallback((initialSet: CapabilitySet | null) => {
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `wf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setGlobalComposerSessions((prev) => [...prev, { id, initialSet, sessionKey: Date.now() }]);
    setGlobalComposerActiveId(id);
  }, []);
  const closeGlobalComposerSession = useCallback((id: string) => {
    setGlobalComposerSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      const wasActive = globalComposerActiveIdRef.current === id;
      if (wasActive) {
        const nextActive = next[0]?.id ?? null;
        globalComposerActiveIdRef.current = nextActive;
        setGlobalComposerActiveId(nextActive);
      }
      return next;
    });
    setGlobalComposerMinimized((m) => {
      if (!(id in m)) return m;
      const { [id]: _, ...rest } = m;
      return rest;
    });
  }, []);
  const getGlobalComposerDockStackIndex = useCallback(
    (sessionId: string) => {
      const minimizedOrdered = globalComposerSessions.filter((s) => globalComposerMinimized[s.id]);
      const idx = minimizedOrdered.findIndex((s) => s.id === sessionId);
      if (idx >= 0) return idx;
      return minimizedOrdered.length;
    },
    [globalComposerSessions, globalComposerMinimized]
  );
  const getGlobalComposerDockStackCount = useCallback(
    (sessionId: string) => {
      const minimizedOrdered = globalComposerSessions.filter((s) => globalComposerMinimized[s.id]);
      if (globalComposerMinimized[sessionId]) {
        return Math.max(1, minimizedOrdered.length);
      }
      return Math.max(1, minimizedOrdered.length + 1);
    },
    [globalComposerSessions, globalComposerMinimized]
  );
  useEffect(() => {
    if (mode === AppMode.WORKFLOW) {
      setCapabilityPresets(loadCapabilityPresets());
      setCapabilitySets(loadCapabilitySets());
    }
  }, [mode]);

  // 当本地无数据时，从仓库种子 public/capability-seed 加载并写入 localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!localStorage.getItem(CAPABILITY_PRESETS_KEY)) {
      fetch('/capability-seed/capability-presets.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { version?: number; presets?: CustomAppModule[] } | null) => {
          if (data?.presets?.length) {
            saveCapabilityPresets(data.presets);
            setCapabilityPresets(loadCapabilityPresets());
          }
        })
        .catch(() => {});
    }
    if (!localStorage.getItem(CAPABILITY_SETS_KEY)) {
      fetch('/capability-seed/capability-sets.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { version?: number; sets?: CapabilitySet[] } | null) => {
          if (data?.sets && data.version === 1) {
            saveCapabilitySets(data.sets);
            setCapabilitySets(data.sets);
          }
        })
        .catch(() => {});
    }
  }, []);
  const [workspaceProjects, setWorkspaceProjects] = useState(() => loadWorkspaceProjects(null));
  const [activeWorkspaceProjectId, setActiveWorkspaceProjectId] = useState<string | null>(() =>
    typeof indexedDB !== 'undefined' ? null : getLastOpenedWorkspaceProjectId(null)
  );
  const [workflowAssets, setWorkflowAssets] = useState<WorkflowAsset[]>(() => {
    if (typeof indexedDB !== 'undefined') return [];
    const id = getLastOpenedWorkspaceProjectId(null);
    return id ? loadWorkflowBundle(id, null).assets : [];
  });
  const [workflowPending, setWorkflowPending] = useState<WorkflowPendingTask[]>(() => {
    if (typeof indexedDB !== 'undefined') return [];
    const id = getLastOpenedWorkspaceProjectId(null);
    return id ? loadWorkflowBundle(id, null).pending : [];
  });
  /** 有 IndexedDB 时：首屏先 hydrate 本地 bundle 再展示工作区，避免 LS 快照与 IDB 不一致闪烁；无 IDB 时为 true */
  const [workspaceLocalIdbHydrateReady, setWorkspaceLocalIdbHydrateReady] = useState(
    () => typeof indexedDB === 'undefined'
  );
  const workspaceLocalIdbHydrateReadyRef = useRef(workspaceLocalIdbHydrateReady);
  useEffect(() => {
    workspaceLocalIdbHydrateReadyRef.current = workspaceLocalIdbHydrateReady;
  }, [workspaceLocalIdbHydrateReady]);
  /** 供首屏 hydrate 等早于 `loadWorkspaceProjectInternal` 声明位置的 effect 调用，避免重复实现伴侣 manifest 合并 */
  const loadWorkspaceProjectInternalRef = useRef<(id: string) => void>((_id: string) => {});
  const markWorkspaceLocalIdbHydrateReady = useCallback(() => {
    /** 须与 state 同步：紧随其后的 `loadWorkspaceProjectInternalRef` 依赖 ref，若只等 useEffect 写回会晚一帧导致首屏不加载甚至空包落盘 */
    workspaceLocalIdbHydrateReadyRef.current = true;
    setWorkspaceLocalIdbHydrateReady(true);
  }, []);

  const activeWorkspaceProjectIdRef = useRef<string | null>(activeWorkspaceProjectId);
  const workspaceProjectsRef = useRef(workspaceProjects);
  const userIdRef = useRef<string | undefined>(user?.id);
  const usernameRef = useRef<string | undefined>(user?.username);
  /** 仅在该用户完成云 hydrate / 迁移后允许 push，避免切换账号时用上一账号内存态覆盖云端 */
  const workspaceCloudPushAllowedUserIdRef = useRef<string | null>(null);
  const cloudWorkflowSyncGenRef = useRef(0);
  /** 轻量结构上云：上次成功 PUT 时的剥离后本地指纹；同项目且指纹未变则跳过 PUT */
  const lastLiteStructureSyncRef = useRef<{ projectId: string | null; fingerprint: string | null }>({
    projectId: null,
    fingerprint: null,
  });
  /** `workflowAssets` / `workflowPending` 变化时递增，仅用于触发轻量上云防抖（空闲时不挂长定时器、不算指纹） */
  const [liteStructureSyncScheduleSeq, setLiteStructureSyncScheduleSeq] = useState(0);
  const [workspaceCloudHydratingProjectId, setWorkspaceCloudHydratingProjectId] = useState<string | null>(null);
  const workspaceCloudHydratingProjectIdRef = useRef<string | null>(null);
  const [workspaceCloudQuotaSuspended, setWorkspaceCloudQuotaSuspended] = useState(false);
  const workspaceCloudQuotaSuspendedRef = useRef(false);
  const editedWhileQuotaSuspendedRef = useRef(false);
  /** 离开工作区/切换项目时的索引同步中（阻塞 UI） */
  const [workspaceCloudLeaveSyncing, setWorkspaceCloudLeaveSyncing] = useState(false);
  const [_workspaceCloudLastSyncAt, setWorkspaceCloudLastSyncAt] = useState<number | null>(null);
  const [_workspaceCloudNextAutoSyncAt, setWorkspaceCloudNextAutoSyncAt] = useState<number | null>(null);
  const [workspaceAutoSyncEnabled, setWorkspaceAutoSyncEnabledState] = useState<boolean>(() => getWorkspaceAutoSyncEnabled());
  const workspaceCloudConfigHydratedUserIdRef = useRef<string | null>(null);
  const workspaceCloudConfigHydratingUserIdRef = useRef<string | null>(null);
  const workspaceCloudCapabilityRecordsRef = useRef<{
    presets: CapabilityCloudRecord<CustomAppModule>[];
    sets: CapabilityCloudRecord<CapabilitySet>[];
  }>({ presets: [], sets: [] });
  const workspaceCloudConfigPushTimerRef = useRef<number | null>(null);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [aiInvocationStatusRev, setAiInvocationStatusRev] = useState(0);
  /** 同步失败或配额场景下的应用内确认（替代浏览器原生 confirm） */
  const [workspaceCloudChoicePrompt, setWorkspaceCloudChoicePrompt] = useState<
    null | { kind: 'back' } | { kind: 'switch'; targetId: string } | { kind: 'quotaBack' }
  >(null);
  /** 工作区项目删除确认（替代浏览器 confirm） */
  const [workspaceProjectDeletePending, setWorkspaceProjectDeletePending] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [workspaceProjectBindPending, setWorkspaceProjectBindPending] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [workspaceProjectUnbindPending, setWorkspaceProjectUnbindPending] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [workspaceProjectManualUploadPending, setWorkspaceProjectManualUploadPending] = useState<{
    id: string;
    name: string;
    fullEstimate: ManualUploadEstimate;
    incrementalEstimate: ManualUploadEstimate | null;
    incrementalReady: boolean;
  } | null>(null);
  const [workspaceManualUploadMode, setWorkspaceManualUploadMode] = useState<ManualUploadMode>('full');
  const [workspaceUploadingProjectId, setWorkspaceUploadingProjectId] = useState<string | null>(null);
  const [workspaceUploadFailureDetailDialog, setWorkspaceUploadFailureDetailDialog] = useState<{
    projectId: string;
    projectName: string;
    mode: ManualUploadMode;
    attempted: number;
    succeeded: number;
    uploadedAt: number | null;
    error: string;
    failedAssetIds: string[];
    selectedAssetIds: string[];
  } | null>(null);
  /** 失败详情弹层：按 assetId 关键字过滤列表（仅 UI，不入库） */
  const [workspaceUploadFailureFilter, setWorkspaceUploadFailureFilter] = useState('');
  /** 剪贴板 API 与 execCommand 均失败时，展示全文供用户手动复制 */
  const [workspaceUploadFailureCopyFallback, setWorkspaceUploadFailureCopyFallback] = useState<{
    text: string;
    kind: 'visible' | 'selected';
  } | null>(null);
  const workspaceUploadFailureCopyFallbackTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [workspaceTrashDialog, setWorkspaceTrashDialog] = useState<{
    open: boolean;
    loading: boolean;
    restoringTrashId: string | null;
    items: CompanionWorkspaceTrashProjectV1[];
  } | null>(null);
  /** 画布有未成功推送到云端的本地修改（用于关闭页面前提示） */
  const workspaceCloudDirtyRef = useRef(false);
  /**
   * 云端拉取完成后，跳过若干次「画布变更 → 标脏」effect（覆盖 Strict Mode 双跑、多轮 setState）。
   * 避免「无本地编辑」却仍显示未同步 / 触发无意义上传。
   */
  const workspaceCloudPostPullDirtySuppressRef = useRef(0);
  useEffect(() => {
    workspaceCloudQuotaSuspendedRef.current = workspaceCloudQuotaSuspended;
  }, [workspaceCloudQuotaSuspended]);
  useEffect(() => {
    workspaceCloudHydratingProjectIdRef.current = workspaceCloudHydratingProjectId;
  }, [workspaceCloudHydratingProjectId]);
  useEffect(() => {
    activeWorkspaceProjectIdRef.current = activeWorkspaceProjectId;
  }, [activeWorkspaceProjectId]);
  useEffect(() => {
    workspaceProjectsRef.current = workspaceProjects;
  }, [workspaceProjects]);
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);
  useEffect(() => {
    usernameRef.current = user?.username;
  }, [user?.username]);

  useLayoutEffect(() => {
    if (!workspaceUploadFailureCopyFallback) return;
    const el = workspaceUploadFailureCopyFallbackTextareaRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [workspaceUploadFailureCopyFallback]);

  useEffect(() => {
    if (!workspaceUploadFailureDetailDialog && !workspaceUploadFailureCopyFallback) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isImagePreviewEscapeKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (workspaceUploadFailureCopyFallback) {
        setWorkspaceUploadFailureCopyFallback(null);
        return;
      }
      setWorkspaceUploadFailureFilter('');
      setWorkspaceUploadFailureDetailDialog(null);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [workspaceUploadFailureDetailDialog, workspaceUploadFailureCopyFallback]);

  useEffect(() => {
    if (!user?.id) workspaceCloudPushAllowedUserIdRef.current = null;
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      workspaceCloudConfigHydratedUserIdRef.current = null;
      workspaceCloudConfigHydratingUserIdRef.current = null;
      workspaceCloudCapabilityRecordsRef.current = { presets: [], sets: [] };
      if (workspaceCloudConfigPushTimerRef.current != null && typeof window !== 'undefined') {
        window.clearTimeout(workspaceCloudConfigPushTimerRef.current);
        workspaceCloudConfigPushTimerRef.current = null;
      }
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setWorkspaceCloudQuotaSuspended(false);
      editedWhileQuotaSuspendedRef.current = false;
    }
  }, [user?.id]);

  function isProjectBoundToCurrentUser(projectId: string | null | undefined): boolean {
    if (!projectId) return false;
    const uid = userIdRef.current;
    if (!uid) return false;
    const p = workspaceProjectsRef.current.find((x) => x.id === projectId);
    return Boolean(p?.boundUserId && p.boundUserId === uid);
  }

  useEffect(() => {
    if (!user?.id) return;
    const used = Number(user.workspaceUsedBytes ?? 0);
    const quota = Number(user.workspaceQuotaBytes ?? WORKSPACE_CLOUD_DEFAULT_QUOTA_BYTES);
    if (used < quota) setWorkspaceCloudQuotaSuspended(false);
  }, [user?.id, user?.workspaceUsedBytes, user?.workspaceQuotaBytes]);

  useEffect(() => {
    if (!user?.id) return;
    const onFocus = () => {
      void refreshAuthUser();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user?.id, refreshAuthUser]);

  /** 画布变更后标记未同步（云端拉取过程中不标脏） */
  useEffect(() => {
    if (authLoading || !user?.id || !user?.username || !isWorkspaceCloudEnabled() || !activeWorkspaceProjectId) return;
    if (!isProjectBoundToCurrentUser(activeWorkspaceProjectId)) return;
    if (workspaceCloudPostPullDirtySuppressRef.current > 0) {
      workspaceCloudPostPullDirtySuppressRef.current -= 1;
      return;
    }
    if (workspaceCloudHydratingProjectId === activeWorkspaceProjectId) return;
    workspaceCloudDirtyRef.current = true;
  }, [authLoading, user?.id, user?.username, workflowAssets, workflowPending, activeWorkspaceProjectId, workspaceCloudHydratingProjectId]);

  useEffect(() => {
    if (!workspaceCloudQuotaSuspended) return;
    if (!user?.id || !user?.username || !isWorkspaceCloudEnabled() || !activeWorkspaceProjectId) return;
    if (!isProjectBoundToCurrentUser(activeWorkspaceProjectId)) return;
    editedWhileQuotaSuspendedRef.current = true;
  }, [workflowAssets, workflowPending, workspaceCloudQuotaSuspended, user?.id, user?.username, activeWorkspaceProjectId]);

  useEffect(() => {
    if (authLoading || !user?.id || !user?.username || !isWorkspaceCloudEnabled()) return;
    const uid = user.id;
    if (workspaceCloudConfigHydratedUserIdRef.current === uid) return;
    if (workspaceCloudConfigHydratingUserIdRef.current === uid) return;
    workspaceCloudConfigHydratingUserIdRef.current = uid;
    void (async () => {
      let sidebarMerge: { displayName: string; avatarUrl: string } | undefined;
      try {
        const cfg = await fetchWorkspaceUserCloudConfig(uid, user.username);
        if (userIdRef.current !== uid) return;
        if (cfg) {
          const mergedPresets = mergeCapabilityCloudRecords<CustomAppModule>(
            capabilityPresets,
            workspaceCloudCapabilityRecordsRef.current.presets,
            cfg.capabilityPresetRecords || []
          );
          const mergedSets = mergeCapabilityCloudRecords<CapabilitySet>(
            capabilitySets,
            workspaceCloudCapabilityRecordsRef.current.sets,
            cfg.capabilitySetRecords || []
          );
          workspaceCloudCapabilityRecordsRef.current = {
            presets: mergedPresets.records,
            sets: mergedSets.records,
          };
          setCapabilityPresets(mergedPresets.list);
          saveCapabilityPresets(mergedPresets.list);
          setCapabilitySets(mergedSets.list);
          saveCapabilitySets(mergedSets.list);
          setDialogSkipUnderstand(cfg.settings.dialogSkipUnderstand);
          setDialogSkipUnderstandState(cfg.settings.dialogSkipUnderstand);
          setWorkspaceAutoSyncEnabled(cfg.settings.workspaceAutoSyncEnabled);
          setWorkspaceAutoSyncEnabledState(cfg.settings.workspaceAutoSyncEnabled);
          setAiProvider(cfg.settings.aiProvider);
          setUserApiKey(cfg.settings.geminiApiKey || null);
          setToapisApiKey(cfg.settings.toapisApiKey || null);
          setToapisBaseUrl(cfg.settings.toapisBaseUrl || null);
          setAntigravityApiKey(cfg.settings.antigravityApiKey || null);
          setAntigravityBaseUrl(cfg.settings.antigravityBaseUrl || null);
          setOpenaiApiKey(cfg.settings.openaiApiKey || null);
          setOpenaiBaseUrl(cfg.settings.openaiBaseUrl || null);
          setVectorengineApiKey(cfg.settings.vectorengineApiKey || null);
          setVectorengineBaseUrl(cfg.settings.vectorengineBaseUrl || null);
          setAiInvocationStatusRev((n) => n + 1);
          if (cfg.sidebarProfile) sidebarMerge = cfg.sidebarProfile;
        }
      } catch (e) {
        console.warn('[workspace cloud] user config pull', e);
      } finally {
        if (workspaceCloudConfigHydratingUserIdRef.current === uid) {
          workspaceCloudConfigHydratingUserIdRef.current = null;
        }
        workspaceCloudConfigHydratedUserIdRef.current = uid;
      }
      if (sidebarMerge && userIdRef.current === uid) {
        const local = getUserUiPrefs();
        const rd = sidebarMerge.displayName.trim();
        const ra = sidebarMerge.avatarUrl;
        const nextAvatar = local.avatarUrl.startsWith('data:') ? local.avatarUrl : ra || local.avatarUrl;
        setUserUiPrefs({ displayName: rd, avatarUrl: nextAvatar });
      }
    })();
  }, [authLoading, user?.id, user?.username, capabilityPresets, capabilitySets]);

  useEffect(() => {
    if (authLoading || !user?.id || !user?.username || !isWorkspaceCloudEnabled()) return;
    const uid = user.id;
    if (workspaceCloudConfigHydratedUserIdRef.current !== uid) return;
    if (workspaceCloudConfigHydratingUserIdRef.current === uid) return;
    if (workspaceCloudPushAllowedUserIdRef.current !== uid) return;
    if (workspaceCloudConfigPushTimerRef.current != null && typeof window !== 'undefined') {
      window.clearTimeout(workspaceCloudConfigPushTimerRef.current);
    }
    if (typeof window === 'undefined') return;
    workspaceCloudConfigPushTimerRef.current = window.setTimeout(() => {
      workspaceCloudConfigPushTimerRef.current = null;
      const prefsNow = getUserUiPrefs();
      const nextPresetRecords = buildCapabilityCloudRecords<CustomAppModule>(
        capabilityPresets,
        workspaceCloudCapabilityRecordsRef.current.presets
      );
      const nextSetRecords = buildCapabilityCloudRecords<CapabilitySet>(
        capabilitySets,
        workspaceCloudCapabilityRecordsRef.current.sets
      );
      void pushWorkspaceUserCloudConfig(uid, user.username, {
        capabilityPresets,
        capabilitySets,
        capabilityPresetRecords: nextPresetRecords,
        capabilitySetRecords: nextSetRecords,
        settings: {
          dialogSkipUnderstand: getDialogSkipUnderstand(),
          workspaceAutoSyncEnabled,
          aiProvider: getAiProvider(),
          geminiApiKey: getUserApiKey() || '',
          toapisApiKey: getToapisApiKey() || '',
          toapisBaseUrl: getToapisBaseUrl() || '',
          antigravityApiKey: getAntigravityApiKey() || '',
          antigravityBaseUrl: getAntigravityBaseUrl() || '',
          openaiApiKey: getOpenaiApiKey() || '',
          openaiBaseUrl: getOpenaiBaseUrl() || '',
          vectorengineApiKey: getVectorengineApiKey() || '',
          vectorengineBaseUrl: getVectorengineBaseUrl() || '',
        },
        sidebarProfile: {
          displayName: prefsNow.displayName,
          avatarUrl: prefsNow.avatarUrl.startsWith('data:') ? '' : prefsNow.avatarUrl,
        },
      })
        .then(() => {
          workspaceCloudCapabilityRecordsRef.current = {
            presets: nextPresetRecords,
            sets: nextSetRecords,
          };
        })
        .catch((e) => console.warn('[workspace cloud] user config push', e));
    }, 1200);
    return () => {
      if (workspaceCloudConfigPushTimerRef.current != null) {
        window.clearTimeout(workspaceCloudConfigPushTimerRef.current);
        workspaceCloudConfigPushTimerRef.current = null;
      }
    };
  }, [
    authLoading,
    user?.id,
    user?.username,
    capabilityPresets,
    capabilitySets,
    workspaceAutoSyncEnabled,
    aiInvocationStatusRev,
    userUiPrefs,
  ]);

  const [step, setStep] = useState<AppStep>(AppStep.T_PATTERN);
  const [tasks, setTasks] = useState<AppTask[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  /** 侧栏「实验性功能」分组：展开侧栏时默认折叠；进入实验性模块时自动展开 */
  const [experimentalNavExpanded, setExperimentalNavExpanded] = useState(false);

  const isExperimentalMode = useCallback((m: AppMode) =>
    m === AppMode.TEXTURE ||
    m === AppMode.SEAM_REPAIR ||
    m === AppMode.PBR_TEXTURE ||
    m === AppMode.ADMIN ||
    m === AppMode.ARENA, []);

  useEffect(() => {
    if (isExperimentalMode(mode)) setExperimentalNavExpanded(true);
  }, [mode, isExperimentalMode]);
  const [activeAssetId, setActiveAssetId] = useState<LibraryItem | null>(null);
  const [libFilter, setLibFilter] = useState<AssetCategory | 'ALL'>('ALL');
  const [libSelectedGroupIds, setLibSelectedGroupIds] = useState<Set<string>>(new Set());
  const [isLibraryPickerOpen, setIsLibraryPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState<AssetCategory | undefined>();
  const [pickerMultiSelect, setPickerMultiSelect] = useState(false);
  const [pickerCallback, setPickerCallback] = useState<(items: LibraryItem[]) => void>(() => {});
  const [globalLogs, setGlobalLogs] = useState<Array<{ id: string; time: number; module: string; level: 'info' | 'warn' | 'error'; message: string; detail?: string }>>([]);
  const [globalLogOpen, setGlobalLogOpen] = useState(false);
  const [globalLogCopiedId, setGlobalLogCopiedId] = useState<string | null>(null);
  const [tripoRecoveryContext, setTripoRecoveryContext] = useState<{
    presetId: string;
    imageBase64: string;
    task?: WorkflowPendingTask;
    canResumeOldTask: boolean;
    lastError: string;
  } | null>(null);
  const [tripoRecoveryActionRunning, setTripoRecoveryActionRunning] = useState<'resume' | 'new' | null>(null);
  const addGlobalLog = useCallback((module: string, level: 'info' | 'warn' | 'error', message: string, detail?: string) => {
    const now = Date.now();
    setGlobalLogs(prev => [...prev.slice(-199), { id: Math.random().toString(36).slice(2, 11), time: now, module, level, message, detail }]);
    void reportClientDebugLog({ time: now, module, level, message, ...(detail ? { detail } : {}) });
  }, []);

  useEffect(() => {
    const notices = consumeWorkspaceMigrationNotices();
    if (!notices.length) return;
    for (const msg of notices) {
      addGlobalLog('工作区', 'info', msg);
    }
  }, [addGlobalLog, activeWorkspaceProjectId, user?.id, workflowAssets.length, workflowPending.length]);

  const pullWorkspaceProjectsFromCompanion = useCallback(async (): Promise<null | { id: string; name: string; createdAt: number; boundUserId?: string; boundAt?: number }[]> => {
    const base = getCompanionLocalBaseUrl();
    const res = await listCompanionWorkspaceProjects(base);
    if (!res.ok) return null;
    const list = Array.isArray(res.data.projects) ? res.data.projects : [];
    const localById = new Map<string, WorkspaceProject>(
      (workspaceProjectsRef.current || []).map((p) => [p.id, p] as const)
    );
    const fromCompanion = list
      .map((p) => {
        const idKey = String(p.id || '').trim();
        const local = localById.get(idKey);
        return {
          id: idKey,
          name: String(p.name || '').trim(),
          createdAt: Number(p.createdAt || Date.now()),
          ...(typeof local?.boundUserId === 'string' && local.boundUserId.trim()
            ? { boundUserId: local.boundUserId.trim() }
            : {}),
          ...(typeof local?.boundAt === 'number' ? { boundAt: local.boundAt } : {}),
        };
      })
      .filter((p) => p.id && p.name);
    const companionIds = new Set(fromCompanion.map((p) => p.id));
    const locals = workspaceProjectsRef.current || [];
    const extras = locals.filter((p) => String(p.id || '').trim() && !companionIds.has(String(p.id || '').trim()));
    return [...fromCompanion, ...extras];
  }, []);

  const workflowAssetsRef = useRef(workflowAssets);
  const workflowPendingRef = useRef(workflowPending);
  useEffect(() => {
    workflowAssetsRef.current = workflowAssets;
    workflowPendingRef.current = workflowPending;
  }, [workflowAssets, workflowPending]);

  const flushProjectPersistence = useCallback(() => {
    void (async () => {
      const pid = activeWorkspaceProjectIdRef.current;
      const scope = userIdRef.current ?? null;
      if (pid && workspaceLocalIdbHydrateReadyRef.current) {
        trySaveWorkflowBundle(pid, {
          assets: workflowAssetsRef.current,
          pending: workflowPendingRef.current,
        }, scope);
      }
      await flushWorkspaceBundleIdbWrites();
      try {
        saveWorkspaceProjects(workspaceProjectsRef.current, scope);
      } catch {
        /* ignore */
      }
      /** 云同步改为仅在离开工作区/切换项目时整包上传，避免与渐进拉取竞态导致云端被不完整状态覆盖 */
    })();
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') flushProjectPersistence();
    };
    const onHide = () => flushProjectPersistence();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
    };
  }, [flushProjectPersistence]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      flushProjectPersistence();
      const shouldWarn =
        !!userIdRef.current &&
        !!usernameRef.current &&
        isWorkspaceCloudEnabled() &&
        (workspaceCloudDirtyRef.current || workspaceCloudLeaveSyncing);
      if (!shouldWarn) return;
      e.preventDefault();
      // 现代浏览器会忽略自定义文案，但必须赋值 returnValue 才会触发确认弹窗
      e.returnValue = '存在未同步到云端的工作区修改，关闭后可能丢失。请先完成同步。';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flushProjectPersistence, workspaceCloudLeaveSyncing]);

  /** 未登录：工作区读回访客级 localStorage（与已登录账号隔离键）；IndexedDB 优先 hydrate 后再读 bundle */
  useEffect(() => {
    if (authLoading) return;
    if (user?.id) return;
    if (typeof indexedDB !== 'undefined') {
      workspaceLocalIdbHydrateReadyRef.current = false;
      setWorkspaceLocalIdbHydrateReady(false);
    }
    let cancelled = false;
    void (async () => {
      await ensureWorkspaceBundlesHydratedFromIdb(null);
      if (cancelled) return;
      const localProjects = loadWorkspaceProjects(null);
      const remoteProjects = await pullWorkspaceProjectsFromCompanion();
      if (cancelled) return;
      const effectiveProjects = remoteProjects && remoteProjects.length > 0 ? remoteProjects : localProjects;
      setWorkspaceProjects(effectiveProjects);
      saveWorkspaceProjects(effectiveProjects, null);
      const last = getLastOpenedWorkspaceProjectId(null);
      if (cancelled) return;
      markWorkspaceLocalIdbHydrateReady();
      if (last) {
        loadWorkspaceProjectInternalRef.current(last);
      } else {
        setActiveWorkspaceProjectId(null);
        setWorkflowAssets([]);
        setWorkflowPending([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id, markWorkspaceLocalIdbHydrateReady, pullWorkspaceProjectsFromCompanion]);

  /** 已登录且关闭云同步：仅使用当前用户隔离的 localStorage；IndexedDB 优先 hydrate */
  useEffect(() => {
    if (authLoading || !user?.id || isWorkspaceCloudEnabled()) return;
    const uid = user.id;
    if (typeof indexedDB !== 'undefined') {
      workspaceLocalIdbHydrateReadyRef.current = false;
      setWorkspaceLocalIdbHydrateReady(false);
    }
    let cancelled = false;
    void (async () => {
      await ensureWorkspaceBundlesHydratedFromIdb(uid);
      if (cancelled) return;
      const localProjects = loadWorkspaceProjects(uid);
      const remoteProjects = await pullWorkspaceProjectsFromCompanion();
      if (cancelled) return;
      const effectiveProjects = remoteProjects && remoteProjects.length > 0 ? remoteProjects : localProjects;
      setWorkspaceProjects(effectiveProjects);
      saveWorkspaceProjects(effectiveProjects, uid);
      const last = getLastOpenedWorkspaceProjectId(uid);
      if (cancelled) return;
      markWorkspaceLocalIdbHydrateReady();
      if (last) {
        loadWorkspaceProjectInternalRef.current(last);
      } else {
        setActiveWorkspaceProjectId(null);
        setWorkflowAssets([]);
        setWorkflowPending([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id, markWorkspaceLocalIdbHydrateReady, pullWorkspaceProjectsFromCompanion]);

  /** 已登录且开启云同步：切换账号时先清空内存态，再从 R2 hydrate；访客数据仅在「云端无索引」时迁入 */
  useEffect(() => {
    if (authLoading || !user?.id || !user?.username || !isWorkspaceCloudEnabled()) return;
    const uid = user.id;
    if (typeof indexedDB !== 'undefined') {
      workspaceLocalIdbHydrateReadyRef.current = false;
      setWorkspaceLocalIdbHydrateReady(false);
    }
    workspaceCloudPushAllowedUserIdRef.current = null;
    cloudWorkflowSyncGenRef.current += 1;
    setWorkspaceCloudHydratingProjectId(null);
    setWorkspaceProjects([]);
    setActiveWorkspaceProjectId(null);
    setWorkflowAssets([]);
    setWorkflowPending([]);
    let cancelled = false;

    const applyIndex = async (index: NonNullable<Awaited<ReturnType<typeof fetchWorkspaceCloudIndex>>>) => {
      if (cancelled) return;
      const remoteProjects = await pullWorkspaceProjectsFromCompanion();
      if (cancelled) return;
      const effectiveProjects = remoteProjects && remoteProjects.length > 0 ? remoteProjects : index.projects;
      const validLast =
        index.lastOpenProjectId && effectiveProjects.some((p) => p.id === index.lastOpenProjectId)
          ? index.lastOpenProjectId
          : null;
      saveWorkspaceProjects(effectiveProjects, uid);
      setWorkspaceProjects(effectiveProjects);
      setLastOpenedWorkspaceProjectId(validLast, uid);
      workspaceCloudPushAllowedUserIdRef.current = uid;
      markWorkspaceLocalIdbHydrateReady();
      if (validLast) {
        loadWorkspaceProjectInternalRef.current(validLast);
      } else {
        setActiveWorkspaceProjectId(null);
        setWorkflowAssets([]);
        setWorkflowPending([]);
      }
    };

    void (async () => {
      try {
        await ensureWorkspaceBundlesHydratedFromIdb(uid);
        if (cancelled) return;
        const index = await fetchWorkspaceCloudIndex(uid, user.username);
        if (cancelled) return;
        if (index) {
          await applyIndex(index);
          return;
        }
        const migrated = await migrateLocalWorkspaceToCloud(uid, user.username);
        if (cancelled) return;
        if (migrated) {
          const { projects, lastOpenProjectId } = migrated;
          const remoteProjects = await pullWorkspaceProjectsFromCompanion();
          if (cancelled) return;
          const effectiveProjects = remoteProjects && remoteProjects.length > 0 ? remoteProjects : projects;
          const validLast =
            lastOpenProjectId && effectiveProjects.some((p) => p.id === lastOpenProjectId) ? lastOpenProjectId : null;
          setWorkspaceProjects(effectiveProjects);
          saveWorkspaceProjects(effectiveProjects, uid);
          setLastOpenedWorkspaceProjectId(validLast, uid);
          workspaceCloudPushAllowedUserIdRef.current = uid;
          markWorkspaceLocalIdbHydrateReady();
          if (validLast) {
            loadWorkspaceProjectInternalRef.current(validLast);
          } else {
            setActiveWorkspaceProjectId(null);
            setWorkflowAssets([]);
            setWorkflowPending([]);
          }
          return;
        }
        const again = await fetchWorkspaceCloudIndex(uid, user.username);
        if (cancelled) return;
        if (again) {
          await applyIndex(again);
          return;
        }
        const localOnly = loadWorkspaceProjects(uid);
        const remoteProjects = await pullWorkspaceProjectsFromCompanion();
        if (cancelled) return;
        const effectiveProjects = remoteProjects && remoteProjects.length > 0 ? remoteProjects : localOnly;
        const last = getLastOpenedWorkspaceProjectId(uid);
        const validLast = last && effectiveProjects.some((p) => p.id === last) ? last : null;
        setWorkspaceProjects(effectiveProjects);
        saveWorkspaceProjects(effectiveProjects, uid);
        workspaceCloudPushAllowedUserIdRef.current = uid;
        markWorkspaceLocalIdbHydrateReady();
        if (validLast) {
          loadWorkspaceProjectInternalRef.current(validLast);
        } else {
          setActiveWorkspaceProjectId(null);
          setWorkflowAssets([]);
          setWorkflowPending([]);
        }
      } catch (e) {
        console.warn('[workspace cloud] hydrate', e);
        if (cancelled) return;
        const localOnly = loadWorkspaceProjects(uid);
        const remoteProjects = await pullWorkspaceProjectsFromCompanion();
        if (cancelled) return;
        const effectiveProjects = remoteProjects && remoteProjects.length > 0 ? remoteProjects : localOnly;
        const last = getLastOpenedWorkspaceProjectId(uid);
        const validLast = last && effectiveProjects.some((p) => p.id === last) ? last : null;
        setWorkspaceProjects(effectiveProjects);
        saveWorkspaceProjects(effectiveProjects, uid);
        workspaceCloudPushAllowedUserIdRef.current = uid;
        markWorkspaceLocalIdbHydrateReady();
        if (validLast) {
          loadWorkspaceProjectInternalRef.current(validLast);
        } else {
          setActiveWorkspaceProjectId(null);
          setWorkflowAssets([]);
          setWorkflowPending([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id, user?.username, markWorkspaceLocalIdbHydrateReady, pullWorkspaceProjectsFromCompanion]);

  useEffect(() => {
    if (!activeWorkspaceProjectId || !workspaceLocalIdbHydrateReady) return;
    const scope = user?.id ?? null;
    const t = window.setTimeout(() => {
      trySaveWorkflowBundle(activeWorkspaceProjectId, { assets: workflowAssets, pending: workflowPending }, scope);
    }, 650);
    return () => window.clearTimeout(t);
  }, [activeWorkspaceProjectId, workflowAssets, workflowPending, user?.id, workspaceLocalIdbHydrateReady]);

  /** 画布变更（且具备轻量上云前置条件）时递增序号，由下游 effect 单独防抖 PUT */
  useEffect(() => {
    if (!activeWorkspaceProjectId || !workspaceLocalIdbHydrateReady) return;
    if (authLoading) return;
    if (!isWorkspaceCloudEnabled() || !isWorkspaceCloudLiteStructureSyncEnabled()) return;
    if (!user?.id || !user?.username) return;
    if (workspaceCloudQuotaSuspended) return;
    if (!isProjectBoundToCurrentUser(activeWorkspaceProjectId)) return;
    setLiteStructureSyncScheduleSeq((n) => n + 1);
  }, [
    workflowAssets,
    workflowPending,
    activeWorkspaceProjectId,
    workspaceLocalIdbHydrateReady,
    authLoading,
    user?.id,
    user?.username,
    workspaceCloudQuotaSuspended,
  ]);

  /** 已绑定 + 云可用：仅在画布调度序号变化时启动防抖；指纹未变则不调 PUT */
  useEffect(() => {
    if (liteStructureSyncScheduleSeq === 0) return;
    if (!activeWorkspaceProjectId || !workspaceLocalIdbHydrateReady) return;
    if (authLoading) return;
    if (!isWorkspaceCloudEnabled() || !isWorkspaceCloudLiteStructureSyncEnabled()) return;
    const uid = userIdRef.current;
    const uname = usernameRef.current;
    if (!uid || !uname) return;
    if (workspaceCloudPushAllowedUserIdRef.current !== uid) return;
    if (workspaceCloudQuotaSuspendedRef.current) return;
    if (!isProjectBoundToCurrentUser(activeWorkspaceProjectId)) return;
    if (workspaceCloudHydratingProjectIdRef.current === activeWorkspaceProjectId) return;

    const pid = activeWorkspaceProjectId;
    const gen = cloudWorkflowSyncGenRef.current;
    const t = window.setTimeout(() => {
      if (cloudWorkflowSyncGenRef.current !== gen) return;
      if (activeWorkspaceProjectIdRef.current !== pid) return;
      const bundle = { assets: workflowAssetsRef.current, pending: workflowPendingRef.current };
      const fp = computeLiteStructureLocalFingerprint(bundle);
      if (lastLiteStructureSyncRef.current.projectId !== pid) {
        lastLiteStructureSyncRef.current = { projectId: pid, fingerprint: null };
      }
      if (fp === lastLiteStructureSyncRef.current.fingerprint) return;
      void pushWorkflowLiteStructureToCloud(uid, pid, bundle, uname)
        .then(() => {
          if (activeWorkspaceProjectIdRef.current !== pid || userIdRef.current !== uid) return;
          lastLiteStructureSyncRef.current = { projectId: pid, fingerprint: fp };
        })
        .catch((e) => console.warn('[workspace cloud] lite structure sync', e));
    }, WORKSPACE_LITE_STRUCTURE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [
    liteStructureSyncScheduleSeq,
    authLoading,
    activeWorkspaceProjectId,
    workspaceLocalIdbHydrateReady,
  ]);

  const proceedBackToWorkspaceShell = useCallback(() => {
    cloudWorkflowSyncGenRef.current += 1;
    setWorkspaceCloudHydratingProjectId(null);
    const scope = userIdRef.current ?? null;
    const pid = activeWorkspaceProjectIdRef.current;
    if (pid && workspaceLocalIdbHydrateReadyRef.current) {
      trySaveWorkflowBundle(
        pid,
        { assets: workflowAssetsRef.current, pending: workflowPendingRef.current },
        scope
      );
    }
    setActiveWorkspaceProjectId(null);
    setWorkflowAssets([]);
    setWorkflowPending([]);
  }, []);

  const loadWorkspaceProjectInternal = useCallback(
    (id: string) => {
      const scope = userIdRef.current ?? null;
      const doLoad = () => {
        const local = loadWorkflowBundle(id, scope);
        setActiveWorkspaceProjectId(id);
        setLastOpenedWorkspaceProjectId(id, scope);
        setWorkflowAssets(local.assets);
        setWorkflowPending(local.pending);

        const uidMerge = userIdRef.current;
        const unameMerge = usernameRef.current;
        if (
          uidMerge &&
          unameMerge &&
          scope === uidMerge &&
          isWorkspaceCloudEnabled() &&
          isWorkspaceCloudBundleMergeEnabled() &&
          workspaceCloudPushAllowedUserIdRef.current === uidMerge &&
          !workspaceCloudQuotaSuspendedRef.current &&
          isProjectBoundToCurrentUser(id)
        ) {
          setWorkspaceCloudHydratingProjectId(id);
          void reconcileWorkflowBundleWithCloud({ projectId: id, userId: uidMerge, username: unameMerge })
            .then((r) => {
              if (activeWorkspaceProjectIdRef.current !== id || userIdRef.current !== uidMerge) return;
              if (!r.didMerge) return;
              const unchanged =
                JSON.stringify({ a: local.assets, p: local.pending }) ===
                JSON.stringify({ a: r.bundle.assets, p: r.bundle.pending });
              if (unchanged) return;
              if (r.conflicts.length > 0) {
                addGlobalLog(
                  '工作区',
                  'warn',
                  `与云端工作流合并：${r.conflicts.length} 处需人工确认（已暂留本地版本，详见控制台）`
                );
                console.warn('[workspace cloud] bundle merge conflicts', r.conflicts);
              }
              setWorkflowAssets(r.bundle.assets);
              setWorkflowPending(r.bundle.pending);
              trySaveWorkflowBundle(id, { assets: r.bundle.assets, pending: r.bundle.pending }, uidMerge);
              workspaceCloudPostPullDirtySuppressRef.current += 1;
            })
            .catch((e) => console.warn('[workspace cloud] bundle reconcile', e))
            .finally(() => {
              setWorkspaceCloudHydratingProjectId((cur) => (cur === id ? null : cur));
            });
        }

        const companionBase = String(getCompanionLocalBaseUrl() || '').trim();
        if (!companionBase) return;
        void (async () => {
          const m = await getCompanionManifest(companionBase, id);
          if (m.ok === false) {
            addGlobalLog('工作区', 'warn', '本地伴侣项目 manifest 读取失败（资产从伴侣恢复可能受影响）', `${id}: ${m.error}`);
            return;
          }
          let manifestData = m.data;
          const mid = String(manifestData.projectId || '').trim();
          if (mid && mid !== id) {
            addGlobalLog(
              '工作区',
              'warn',
              '本地伴侣 manifest.projectId 与当前项目 id 不一致',
              `manifest=${mid} selected=${id}`
            );
          }
          const recon = await reconcileCompanionManifestFromDisk(companionBase, id);
          if (recon.ok && recon.data.added > 0) {
            const kp = recon.data.keys.slice(0, 5).join(', ') + (recon.data.keys.length > 5 ? '…' : '');
            addGlobalLog('工作区', 'info', '本地伴侣已从磁盘补全 manifest', `${recon.data.added} 项 ${kp}`);
            const m2 = await getCompanionManifest(companionBase, id);
            if (m2.ok) manifestData = m2.data;
          } else if (recon.ok === false) {
            addGlobalLog('工作区', 'warn', '本地伴侣 manifest 磁盘补全请求失败', String(recon.error));
          }
          const assetsSnap = workflowAssetsRef.current;
          const gaps = findCompanionKeysMissingFromManifest(assetsSnap, manifestData);
          if (gaps.length > 0) {
            const nOrig = gaps.filter((g) => g.kind === 'original').length;
            const nRes = gaps.filter((g) => g.kind === 'result').length;
            const nMdl = gaps.filter((g) => g.kind === 'model').length;
            const head = gaps
              .slice(0, 5)
              .map((g) =>
                g.kind === 'original'
                  ? `${g.assetId}:orig`
                  : g.kind === 'model'
                    ? `${g.assetId}:mdl:${g.slotIndex}`
                    : `${g.assetId}:res:${g.stepId}`
              )
              .join('; ');
            addGlobalLog(
              '工作区',
              'warn',
              '部分伴侣对象键未出现在 manifest（可能未完成写入或 manifest 未更新）',
              `${gaps.length} 项（原图键 ${nOrig} / 步骤结果键 ${nRes} / 3D 模型键 ${nMdl}） ${head}${gaps.length > 5 ? '…' : ''}`
            );
            void attemptRepairCompanionManifestKeyGaps(companionBase, id, assetsSnap, gaps, (level, title, detail) =>
              addGlobalLog('工作区', level, title, detail)
            );
          }
          const newAssetId = () =>
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          setWorkflowAssets((prev) => {
            const { nextAssets, importedKeys } = mergeUnlinkedManifestEntriesIntoWorkflowAssets(
              prev,
              manifestData,
              newAssetId,
              { importLegacyOrphans: WORKSPACE_IMPORT_LEGACY_COMPANION_ORPHANS }
            );
            if (importedKeys.length === 0) return prev;
            const scopeInner = userIdRef.current ?? null;
            trySaveWorkflowBundle(id, { assets: nextAssets, pending: workflowPendingRef.current }, scopeInner);
            const head = importedKeys.slice(0, 6).join(', ') + (importedKeys.length > 6 ? '…' : '');
            addGlobalLog(
              '工作区',
              'info',
              '已根据本地伴侣 manifest 自动挂载磁盘资产到画布',
              `${importedKeys.length} 项 ${head}`
            );
            return nextAssets;
          });
        })();
      };
      if (typeof indexedDB !== 'undefined' && !workspaceLocalIdbHydrateReadyRef.current) {
        void ensureWorkspaceBundlesHydratedFromIdb(scope)
          .catch((e) => console.warn('[workspace] hydrate before loadProject', e))
          .finally(() => {
            markWorkspaceLocalIdbHydrateReady();
            doLoad();
          });
        return;
      }
      doLoad();
    },
    [addGlobalLog, markWorkspaceLocalIdbHydrateReady]
  );
  loadWorkspaceProjectInternalRef.current = loadWorkspaceProjectInternal;

  const openWorkspaceTrashDialog = useCallback(async () => {
    setWorkspaceTrashDialog({
      open: true,
      loading: true,
      restoringTrashId: null,
      items: [],
    });
    const base = getCompanionLocalBaseUrl();
    const listed = await listCompanionWorkspaceTrashProjects(base);
    if (listed.ok === false) {
      addGlobalLog('工作区', 'error', '加载回收站失败', listed.error);
      setWorkspaceTrashDialog((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
            }
          : prev
      );
      return;
    }
    setWorkspaceTrashDialog((prev) =>
      prev
        ? {
            ...prev,
            loading: false,
            items: Array.isArray(listed.data.items) ? listed.data.items : [],
          }
        : prev
    );
  }, [addGlobalLog]);

  const restoreWorkspaceTrashProject = useCallback(
    async (trashId: string) => {
      if (!workspaceTrashDialog || workspaceTrashDialog.restoringTrashId) return;
      const scope = user?.id ?? null;
      if (typeof indexedDB !== 'undefined' && !workspaceLocalIdbHydrateReadyRef.current) {
        try {
          await ensureWorkspaceBundlesHydratedFromIdb(scope);
        } catch (e) {
          console.warn('[workspace] hydrate before trash restore', e);
        }
        markWorkspaceLocalIdbHydrateReady();
      }
      setWorkspaceTrashDialog((prev) => (prev ? { ...prev, restoringTrashId: trashId } : prev));
      const base = getCompanionLocalBaseUrl();
      const restored = await restoreCompanionWorkspaceTrashProject(base, trashId);
      if (restored.ok === false) {
        addGlobalLog('工作区', 'error', '恢复项目失败', restored.error);
        setWorkspaceTrashDialog((prev) => (prev ? { ...prev, restoringTrashId: null } : prev));
        return;
      }
      const restoredProjectId = restored.data.project.id;
      const trashLegacyIdSep = trashId.lastIndexOf('__');
      const legacyProjectId =
        trashLegacyIdSep > 0 ? String(trashId.slice(0, trashLegacyIdSep) || '').trim() : '';
      if (legacyProjectId && restoredProjectId !== legacyProjectId) {
        const orphan = loadWorkflowBundle(legacyProjectId, scope);
        const hasOrphanBundle =
          (orphan.assets?.length ?? 0) > 0 ||
          (orphan.pending?.length ?? 0) > 0 ||
          (orphan.capabilityRefs?.length ?? 0) > 0;
        if (hasOrphanBundle) {
          await migrateWorkflowBundleProjectId(legacyProjectId, restoredProjectId, scope);
          addGlobalLog(
            '工作区',
            'info',
            '已把本地画布存储从旧项目 id 迁移到恢复后的目录名',
            `${legacyProjectId} → ${restoredProjectId}`
          );
        }
      }
      const refreshed = await pullWorkspaceProjectsFromCompanion();
      if (refreshed) {
        setWorkspaceProjects(refreshed);
        saveWorkspaceProjects(refreshed, scope);
      }
      setLastOpenedWorkspaceProjectId(restoredProjectId, scope);
      setActiveWorkspaceProjectId(restoredProjectId);
      const b = loadWorkflowBundle(restoredProjectId, scope);
      setWorkflowAssets(b.assets);
      setWorkflowPending(b.pending);
      addGlobalLog(
        '工作区',
        'info',
        restored.data.nameResolved ? '项目已恢复（存在同名，已自动改名）' : '项目已恢复',
        restoredProjectId
      );
      setWorkspaceTrashDialog((prev) =>
        prev
          ? {
              ...prev,
              restoringTrashId: null,
              items: prev.items.filter((it) => it.trashId !== trashId),
            }
          : prev
      );
    },
    [addGlobalLog, pullWorkspaceProjectsFromCompanion, user?.id, workspaceTrashDialog, markWorkspaceLocalIdbHydrateReady]
  );

  const openWorkspaceProject = useCallback(
    async (id: string) => {
      const scope = userIdRef.current ?? null;
      if (typeof indexedDB !== 'undefined' && !workspaceLocalIdbHydrateReadyRef.current) {
        try {
          await ensureWorkspaceBundlesHydratedFromIdb(scope);
        } catch (e) {
          console.warn('[workspace] hydrate before openProject', e);
        }
        markWorkspaceLocalIdbHydrateReady();
      }
      const curId = activeWorkspaceProjectIdRef.current;
      if (curId && curId !== id) {
        const prevBundle = {
          assets: workflowAssetsRef.current,
          pending: workflowPendingRef.current,
        };
        if (workspaceLocalIdbHydrateReadyRef.current) {
          trySaveWorkflowBundle(curId, prevBundle, scope);
        }
        const uid = userIdRef.current;
        if (
          uid &&
          usernameRef.current &&
          isWorkspaceCloudEnabled() &&
          !workspaceCloudQuotaSuspendedRef.current &&
          workspaceCloudPushAllowedUserIdRef.current === uid &&
          isProjectBoundToCurrentUser(curId)
        ) {
          setWorkspaceCloudLeaveSyncing(true);
          try {
            await pushWorkspaceIndex(uid, workspaceProjectsRef.current, id, usernameRef.current);
            workspaceCloudDirtyRef.current = false;
            setWorkspaceCloudLastSyncAt(Date.now());
            setWorkspaceCloudNextAutoSyncAt(Date.now() + WORKSPACE_AUTO_SYNC_INTERVAL_MS);
            await refreshAuthUser();
          } catch (e) {
            console.warn('[workspace cloud] switch project sync', e);
            if (e instanceof HttpRequestError && e.code === 'STORAGE_QUOTA_EXCEEDED') {
              setWorkspaceCloudQuotaSuspended(true);
              editedWhileQuotaSuspendedRef.current = true;
              void refreshAuthUser();
            }
            setWorkspaceCloudChoicePrompt({ kind: 'switch', targetId: id });
            return;
          } finally {
            setWorkspaceCloudLeaveSyncing(false);
          }
        }
      }
      loadWorkspaceProjectInternal(id);
    },
    [loadWorkspaceProjectInternal, markWorkspaceLocalIdbHydrateReady, refreshAuthUser]
  );

  const backToWorkspaceProjectShell = useCallback(
    async (opts?: { skipQuotaBackConfirm?: boolean }) => {
      if (
        !opts?.skipQuotaBackConfirm &&
        workspaceCloudQuotaSuspendedRef.current &&
        editedWhileQuotaSuspendedRef.current
      ) {
        setWorkspaceCloudChoicePrompt({ kind: 'quotaBack' });
        return;
      }
      const scope = userIdRef.current ?? null;
      const pid = activeWorkspaceProjectIdRef.current;
      if (pid) {
        const bundle = {
          assets: workflowAssetsRef.current,
          pending: workflowPendingRef.current,
        };
        if (workspaceLocalIdbHydrateReadyRef.current) {
          trySaveWorkflowBundle(pid, bundle, scope);
        }
        const uid = userIdRef.current;
        if (
          uid &&
          usernameRef.current &&
          isWorkspaceCloudEnabled() &&
          !workspaceCloudQuotaSuspendedRef.current &&
          workspaceCloudPushAllowedUserIdRef.current === uid &&
          isProjectBoundToCurrentUser(pid)
        ) {
          setWorkspaceCloudLeaveSyncing(true);
          try {
            const lastOpen = getLastOpenedWorkspaceProjectId(scope);
            await pushWorkspaceIndex(uid, workspaceProjectsRef.current, lastOpen, usernameRef.current);
            workspaceCloudDirtyRef.current = false;
            setWorkspaceCloudLastSyncAt(Date.now());
            setWorkspaceCloudNextAutoSyncAt(Date.now() + WORKSPACE_AUTO_SYNC_INTERVAL_MS);
            await refreshAuthUser();
          } catch (e) {
            console.warn('[workspace cloud] back sync', e);
            if (e instanceof HttpRequestError && e.code === 'STORAGE_QUOTA_EXCEEDED') {
              setWorkspaceCloudQuotaSuspended(true);
              editedWhileQuotaSuspendedRef.current = true;
              void refreshAuthUser();
            }
            setWorkspaceCloudChoicePrompt({ kind: 'back' });
            return;
          } finally {
            setWorkspaceCloudLeaveSyncing(false);
          }
        }
      }
      proceedBackToWorkspaceShell();
    },
    [proceedBackToWorkspaceShell, refreshAuthUser]
  );

  const createWorkspaceProjectEntry = useCallback(
    async (name: string) => {
      const scope = user?.id ?? null;
      const base = getCompanionLocalBaseUrl();
      let next = [...workspaceProjects];
      const trimmed = String(name || '').trim();
      /** 未填名称时伴侣会返回 workspace_project_name_required；给默认目录名避免回退成 UUID 导致 manifest project_not_found */
      const nameForCompanion = trimmed || `proj-${Date.now().toString(36)}`;
      const createdRemote = await createCompanionWorkspaceProject(base, nameForCompanion);
      if (createdRemote.ok === false) {
        const p = createWorkspaceProject(trimmed || nameForCompanion);
        next = [...workspaceProjects, p];
        addGlobalLog('工作区', 'warn', '本地伴侣新建项目失败，已回退浏览器侧创建', createdRemote.error);
      } else {
        next = [...workspaceProjects, createdRemote.data.project];
      }
      setWorkspaceProjects(next);
      saveWorkspaceProjects(next, scope);
      if (
        user?.id &&
        user?.username &&
        isWorkspaceCloudEnabled() &&
        workspaceCloudPushAllowedUserIdRef.current === user.id &&
        !workspaceCloudQuotaSuspendedRef.current
      ) {
        void pushWorkspaceIndex(user.id, next, getLastOpenedWorkspaceProjectId(user.id), user.username).catch((e) =>
          console.warn('[workspace cloud] index', e)
        );
      }
    },
    [addGlobalLog, workspaceProjects, user?.id, user?.username]
  );

  const exportWorkspaceProjectEntry = useCallback(async (id: string) => {
    const scope = user?.id ?? null;
    const project = workspaceProjectsRef.current.find((p) => p.id === id);
    if (!project) {
      addGlobalLog('工作区', 'warn', '导出失败：项目不存在');
      return;
    }
    const base = String(getCompanionLocalBaseUrl() || '').trim();
    const projectId = String(id || '').trim();
    const bundle = loadWorkflowBundle(projectId, scope);
    const cloudKeyCount = collectReferencedObjectKeysFromPackedV2({
      assets: Array.isArray(bundle.assets) ? bundle.assets : [],
      pending: Array.isArray(bundle.pending) ? bundle.pending : [],
    }).size;
    const cloudHydrateAttempted = cloudKeyCount;
    let cloudHydrateSucceeded = 0;
    let cloudHydrateError = '';
    let hydratedBundle = {
      assets: Array.isArray(bundle.assets) ? bundle.assets : [],
      pending: Array.isArray(bundle.pending) ? bundle.pending : [],
      ...(Array.isArray(bundle.capabilityRefs) ? { capabilityRefs: bundle.capabilityRefs } : {}),
    } as {
      assets: WorkflowAsset[];
      pending: WorkflowPendingTask[];
      capabilityRefs?: Array<{ kind: 'preset' | 'set'; id: string; snapshot?: unknown }>;
    };
    if (cloudKeyCount > 0) {
      try {
        hydratedBundle = await hydrateWorkflowBundleFromCloud(hydratedBundle);
        cloudHydrateSucceeded = cloudKeyCount;
      } catch (e) {
        cloudHydrateSucceeded = 0;
        cloudHydrateError = e instanceof Error ? e.message : String(e);
      }
    }
    const exportAssets = JSON.parse(JSON.stringify(Array.isArray(hydratedBundle.assets) ? hydratedBundle.assets : [])) as WorkflowAsset[];
    const exportPending = JSON.parse(JSON.stringify(Array.isArray(hydratedBundle.pending) ? hydratedBundle.pending : [])) as WorkflowPendingTask[];
    let hydratedCount = 0;
    let hydrateAttempted = 0;
    const hydrateFailures: Array<{ assetId: string; kind: 'original' | 'result'; stepId?: string; reason: string }> = [];
    if (base && projectId) {
      for (const asset of exportAssets) {
        if (!String(asset.original || '').trim()) {
          const key = String(asset.originalCompanionKey || '').trim();
          if (key) {
            hydrateAttempted += 1;
            const dataUrl = await fetchCompanionAssetAsDataUrl(base, projectId, key);
            if (dataUrl) {
              asset.original = dataUrl;
              hydratedCount += 1;
            } else {
              hydrateFailures.push({
                assetId: String(asset.id || ''),
                kind: 'original',
                reason: 'not_found_in_companion_or_unauthorized',
              });
            }
          }
        }
        const resultKeys = asset.resultsCompanionKeys || {};
        const resultMap = { ...(asset.results || {}) };
        for (const stepId of Object.keys(resultKeys)) {
          if (String(resultMap[stepId] || '').trim()) continue;
          const key = String(resultKeys[stepId] || '').trim();
          if (!key) continue;
          hydrateAttempted += 1;
          const dataUrl = await fetchCompanionAssetAsDataUrl(base, projectId, key);
          if (dataUrl) {
            resultMap[stepId] = dataUrl;
            hydratedCount += 1;
          } else {
            hydrateFailures.push({
              assetId: String(asset.id || ''),
              kind: 'result',
              stepId,
              reason: 'not_found_in_companion_or_unauthorized',
            });
          }
        }
        asset.results = resultMap;
      }
    }
    const payload = {
      version: 1,
      exportedAt: Date.now(),
      source: 'assetcutter-workspace-project',
      project: { name: project.name, id: project.id },
      exportReport: {
        cloudHydrateAttempted,
        cloudHydrateSucceeded,
        cloudHydrateFailed: Math.max(0, cloudHydrateAttempted - cloudHydrateSucceeded),
        ...(cloudHydrateError ? { cloudHydrateError } : {}),
        companionHydrateAttempted: hydrateAttempted,
        companionHydrateSucceeded: hydratedCount,
        companionHydrateFailed: hydrateFailures.length,
        companionHydrateFailures: hydrateFailures.slice(0, 50),
      },
      bundle: {
        assets: exportAssets,
        pending: exportPending,
        ...(Array.isArray(hydratedBundle.capabilityRefs) ? { capabilityRefs: hydratedBundle.capabilityRefs } : {}),
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const fileNameSafe = String(project.name || 'project')
      .trim()
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 64) || 'project';
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileNameSafe}.assetcutter-project.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      addGlobalLog(
        '工作区',
        'info',
        `项目已导出：${project.name}`,
        hydrateAttempted > 0
          ? `云端补齐：成功 ${cloudHydrateSucceeded}/${cloudHydrateAttempted}${cloudHydrateAttempted > cloudHydrateSucceeded ? `，失败 ${cloudHydrateAttempted - cloudHydrateSucceeded}` : ''}；伴侣补齐：成功 ${hydratedCount}/${hydrateAttempted}${hydrateFailures.length ? `，失败 ${hydrateFailures.length}` : ''}`
          : cloudHydrateAttempted > 0
            ? `云端补齐：成功 ${cloudHydrateSucceeded}/${cloudHydrateAttempted}${cloudHydrateAttempted > cloudHydrateSucceeded ? `，失败 ${cloudHydrateAttempted - cloudHydrateSucceeded}` : ''}`
            : undefined
      );
      if (cloudHydrateAttempted > cloudHydrateSucceeded) {
        addGlobalLog(
          '工作区',
          'warn',
          '导出前云端补齐未完全成功',
          cloudHydrateError || `失败 ${cloudHydrateAttempted - cloudHydrateSucceeded} 项`
        );
      }
      if (hydrateFailures.length > 0) {
        const sample = hydrateFailures
          .slice(0, 5)
          .map((x) => `${x.assetId}${x.stepId ? `:${x.stepId}` : ''}`)
          .join(', ');
        addGlobalLog('工作区', 'warn', '导出完成，但有部分伴侣资产未打包进分享文件', `失败 ${hydrateFailures.length} 项；示例：${sample}`);
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }, [addGlobalLog, user?.id]);

  const importWorkspaceProjectEntry = useCallback(async (payload: { file: File; mode: 'new' | 'overwrite'; targetProjectId?: string }) => {
    const scope = user?.id ?? null;
    const file = payload.file;
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      addGlobalLog('工作区', 'warn', '导入失败：文件不是有效 JSON');
      return;
    }
    const obj = (parsed || {}) as {
      project?: { name?: string };
      bundle?: { assets?: unknown; pending?: unknown; capabilityRefs?: unknown };
    };
    const assets = Array.isArray(obj.bundle?.assets) ? obj.bundle!.assets : null;
    const pending = Array.isArray(obj.bundle?.pending) ? obj.bundle!.pending : null;
    if (!assets || !pending) {
      addGlobalLog('工作区', 'warn', '导入失败：缺少 bundle.assets 或 bundle.pending');
      return;
    }

    const importBundle = {
      assets: assets as WorkflowAsset[],
      pending: pending as WorkflowPendingTask[],
      ...(Array.isArray(obj.bundle?.capabilityRefs)
        ? { capabilityRefs: obj.bundle?.capabilityRefs as Array<{ kind: 'preset' | 'set'; id: string; snapshot?: unknown }> }
        : {}),
    };
    if (payload.mode === 'overwrite') {
      const targetId = String(payload.targetProjectId || '').trim();
      if (!targetId) {
        addGlobalLog('工作区', 'warn', '导入失败：未选择覆盖目标项目');
        return;
      }
      const target = workspaceProjectsRef.current.find((p) => p.id === targetId);
      if (!target) {
        addGlobalLog('工作区', 'warn', '导入失败：覆盖目标项目不存在');
        return;
      }
      saveWorkflowBundle(targetId, importBundle, scope);
      if (activeWorkspaceProjectIdRef.current === targetId) {
        const b = loadWorkflowBundle(targetId, scope);
        setWorkflowAssets(b.assets);
        setWorkflowPending(b.pending);
      }
      addGlobalLog('工作区', 'info', `导入已覆盖项目：${target.name}`);
      return;
    }

    const importNameBase = String(obj.project?.name || file.name.replace(/\.json$/i, '') || '导入项目').trim() || '导入项目';
    const importName = `${importNameBase}（导入）`;
    const base = getCompanionLocalBaseUrl();
    const createdRemote = await createCompanionWorkspaceProject(base, importName);
    const createdProject =
      createdRemote.ok === false
        ? createWorkspaceProject(importName)
        : createdRemote.data.project;
    const next = [...workspaceProjectsRef.current, createdProject];
    setWorkspaceProjects(next);
    saveWorkspaceProjects(next, scope);
    saveWorkflowBundle(createdProject.id, importBundle, scope);
    addGlobalLog('工作区', 'info', `项目导入成功：${createdProject.name}`);
  }, [addGlobalLog, user?.id]);

  const renameWorkspaceProjectEntry = useCallback(
    async (id: string, name: string) => {
      const trimmed = String(name || '').trim();
      if (!trimmed) return;
      const scope = user?.id ?? null;
      const prevList = workspaceProjectsRef.current;
      let next = prevList.map((p) => (p.id === id ? { ...p, name: trimmed } : p));
      const base = getCompanionLocalBaseUrl();
      const renamed = await renameCompanionWorkspaceProject(base, id, trimmed);
      if (renamed.ok === false) {
        addGlobalLog('工作区', 'warn', '本地伴侣重命名失败，已回退浏览器侧重命名', renamed.error);
      } else {
        next = prevList.map((p) => (p.id === id ? renamed.data.project : p));
        const newId = String(renamed.data.project?.id || '').trim();
        if (newId && newId !== id) {
          await migrateWorkflowBundleProjectId(id, newId, scope);
          if (activeWorkspaceProjectIdRef.current === id) {
            const b = loadWorkflowBundle(newId, scope);
            setActiveWorkspaceProjectId(newId);
            setWorkflowAssets(b.assets);
            setWorkflowPending(b.pending);
          }
          const lastOpen = getLastOpenedWorkspaceProjectId(scope);
          if (lastOpen === id) setLastOpenedWorkspaceProjectId(newId, scope);
        }
      }
      setWorkspaceProjects(next);
      saveWorkspaceProjects(next, scope);
      if (
        user?.id &&
        user?.username &&
        isWorkspaceCloudEnabled() &&
        workspaceCloudPushAllowedUserIdRef.current === user.id &&
        !workspaceCloudQuotaSuspendedRef.current
      ) {
        void pushWorkspaceIndex(user.id, next, getLastOpenedWorkspaceProjectId(scope), user.username).catch((e) =>
          console.warn('[workspace cloud] index', e)
        );
      }
    },
    [addGlobalLog, user?.id, user?.username]
  );

  const requestDeleteWorkspaceProject = useCallback((id: string) => {
    const p = workspaceProjectsRef.current.find((q) => q.id === id);
    setWorkspaceProjectDeletePending({ id, name: p?.name ?? '该项目' });
  }, []);

  const requestBindWorkspaceProject = useCallback((id: string) => {
    const p = workspaceProjectsRef.current.find((q) => q.id === id);
    if (!p) return;
    setWorkspaceProjectBindPending({ id, name: p.name || '该项目' });
  }, []);

  const requestUnbindWorkspaceProject = useCallback((id: string) => {
    const p = workspaceProjectsRef.current.find((q) => q.id === id);
    if (!p) return;
    setWorkspaceProjectUnbindPending({ id, name: p.name || '该项目' });
  }, []);

  const requestManualUploadWorkspaceProject = useCallback(async (id: string) => {
    const p = workspaceProjectsRef.current.find((q) => q.id === id);
    if (!p) return;
    const scope = userIdRef.current ?? null;
    const bundle = loadWorkflowBundle(id, scope);
    const fullEstimate = buildManualUploadEstimate(bundle.assets);
    setWorkspaceManualUploadMode('full');
    setWorkspaceProjectManualUploadPending({
      id,
      name: p.name || '该项目',
      fullEstimate,
      incrementalEstimate: null,
      incrementalReady: false,
    });
    const uid = userIdRef.current;
    const uname = usernameRef.current;
    if (!uid || !uname) {
      setWorkspaceProjectManualUploadPending((prev) =>
        prev && prev.id === id ? { ...prev, incrementalReady: true } : prev
      );
      return;
    }
    try {
      const packed = await fetchWorkflowPackedFromCloud(uid, id, uname);
      const picked = pickIncrementalAssets(bundle.assets, packed?.assets ?? null);
      const incrementalEstimate = buildManualUploadEstimate(picked);
      setWorkspaceProjectManualUploadPending((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              incrementalEstimate,
              incrementalReady: true,
            }
          : prev
      );
    } catch {
      setWorkspaceProjectManualUploadPending((prev) =>
        prev && prev.id === id ? { ...prev, incrementalReady: true } : prev
      );
    }
  }, []);

  const requestOpenWorkspaceUploadFailureDetail = useCallback((id: string) => {
    const p = workspaceProjectsRef.current.find((q) => q.id === id);
    if (!p) return;
    const failedAssetIds = Array.isArray(p.lastManualUploadFailedAssetIds) ? p.lastManualUploadFailedAssetIds : [];
    if (failedAssetIds.length === 0) {
      addGlobalLog('工作区', 'info', '该项目暂无失败项');
      return;
    }
    setWorkspaceUploadFailureFilter('');
    setWorkspaceUploadFailureDetailDialog({
      projectId: id,
      projectName: p.name || '该项目',
      mode: p.lastManualUploadMode === 'incremental' ? 'incremental' : 'full',
      attempted: Math.max(0, Number(p.lastManualUploadAttemptedCount || 0)),
      succeeded: Math.max(0, Number(p.lastManualUploadSucceededCount || 0)),
      uploadedAt: typeof p.lastManualUploadAt === 'number' ? p.lastManualUploadAt : null,
      error: String(p.lastManualUploadError || ''),
      failedAssetIds,
      selectedAssetIds: [...failedAssetIds],
    });
  }, [addGlobalLog]);

  const executeManualWorkflowUpload = useCallback(
    async (id: string, opts?: { onlyAssetIds?: string[]; mode?: ManualUploadMode; reason?: 'manual' | 'retry-failed' }) => {
      const uid = userIdRef.current;
      const uname = usernameRef.current;
      if (!uid || !uname) {
        addGlobalLog('工作区', 'warn', '请先登录账号，再执行手动上传');
        return;
      }
      if (!isWorkspaceCloudEnabled()) {
        addGlobalLog('工作区', 'warn', '当前环境未开启云同步，无法上传项目资产');
        return;
      }
      if (workspaceCloudPushAllowedUserIdRef.current !== uid) {
        addGlobalLog('工作区', 'warn', '云端配置尚未就绪，请稍后再试');
        return;
      }
      if (workspaceCloudQuotaSuspendedRef.current) {
        addGlobalLog('工作区', 'warn', '云空间已满，无法上传项目资产');
        return;
      }
      const project = workspaceProjectsRef.current.find((p) => p.id === id);
      if (!project) {
        addGlobalLog('工作区', 'warn', '未找到待上传的项目');
        return;
      }
      if (project.boundUserId !== uid) {
        addGlobalLog('工作区', 'warn', '请先将项目绑定到当前账号，再执行手动上传');
        return;
      }
      if (workspaceUploadingProjectId === id) {
        return;
      }
      setWorkspaceUploadingProjectId(id);
      const mode = opts?.mode ?? workspaceManualUploadMode;
      const onlyAssetIds = opts?.onlyAssetIds;
      try {
        const bundle = loadWorkflowBundle(id, uid);
        const requestedCount = Array.isArray(onlyAssetIds) ? onlyAssetIds.length : bundle.assets.length;
        const scopedAssets = Array.isArray(onlyAssetIds) ? pickAssetsById(bundle.assets, onlyAssetIds) : bundle.assets;
        const skippedCount = Math.max(0, requestedCount - scopedAssets.length);
        if (Array.isArray(onlyAssetIds) && scopedAssets.length === 0) {
          addGlobalLog('工作区', 'warn', '重试失败项时未找到仍存在的资产，已跳过上传');
          return;
        }
        let uploadBundle = { ...bundle, assets: scopedAssets };
        if (mode === 'incremental') {
          try {
            const packed = await fetchWorkflowPackedFromCloud(uid, id, uname);
            const pickedAssets = pickIncrementalAssets(scopedAssets, packed?.assets ?? null);
            uploadBundle = {
              ...bundle,
              assets: pickedAssets,
            };
          } catch (e) {
            addGlobalLog('工作区', 'warn', '增量基线读取失败，已回退全量上传', e instanceof Error ? e.message : String(e));
          }
        }
        const attemptedCount = uploadBundle.assets.length;
        if (attemptedCount === 0) {
          const nextProjects = workspaceProjectsRef.current.map((p) =>
            p.id === id
              ? {
                  ...p,
                  lastManualUploadAt: Date.now(),
                  lastManualUploadMode: mode,
                  lastManualUploadAssetCount: 0,
                  lastManualUploadBytesApprox: 0,
                  lastManualUploadAttemptedCount: 0,
                  lastManualUploadSucceededCount: 0,
                  lastManualUploadFailedAssetIds: [],
                  lastManualUploadError: '',
                }
              : p
          );
          setWorkspaceProjects(nextProjects);
          saveWorkspaceProjects(nextProjects, uid);
          addGlobalLog('工作区', 'info', '无需上传：当前选择范围内没有待上传资产');
          return;
        }
        // 若 IDB 仅存 originalCompanionKey，打包时从本地伴侣读回再打 data URL 上传 R2（需设置并启动伴侣）
        const companionBase = String(getCompanionLocalBaseUrl() || '').trim();
        const needsCompanionHydrate = uploadBundle.assets.some((a) => {
          const origOnlyCompanion =
            !String(a?.original || '').trim() && String(a.originalCompanionKey || '').trim();
          const rck = a.resultsCompanionKeys || {};
          const resultsOnlyCompanion = Object.keys(rck).some((sid) => {
            if (!String(rck[sid] || '').trim()) return false;
            return !String((a.results || {})[sid] || '').trim();
          });
          return origOnlyCompanion || resultsOnlyCompanion;
        });
        if (needsCompanionHydrate && !companionBase) {
          addGlobalLog(
            '工作区',
            'warn',
            '部分原图或步骤结果仅保存在本地伴侣。请在设置中填写本地伴侣地址并启动伴侣后再上传。'
          );
          return;
        }
        // MANUAL_WORKFLOW_UPLOAD_ALLOWED
        await pushWorkflowBundleToCloud(uid, id, uploadBundle, uname, {
          companionHydrate: companionBase ? { baseUrl: companionBase, projectId: id } : undefined,
        });
        const uploadedAt = Date.now();
        const uploadedBytesApprox = uploadBundle.assets.reduce((sum, asset) => {
          const base = estimateStringBytes(String(asset?.original || ''));
          const modelBytes = Array.isArray(asset?.modelUrls)
            ? asset.modelUrls.reduce((acc, u) => acc + estimateStringBytes(String(u || '')), 0)
            : 0;
          return sum + base + modelBytes;
        }, 0);
        const nextProjects = workspaceProjectsRef.current.map((p) =>
          p.id === id
            ? {
                ...p,
                lastManualUploadAt: uploadedAt,
                lastManualUploadMode: mode,
                lastManualUploadAssetCount: uploadBundle.assets.length,
                lastManualUploadBytesApprox: uploadedBytesApprox,
                lastManualUploadAttemptedCount: attemptedCount,
                lastManualUploadSucceededCount: attemptedCount,
                lastManualUploadFailedAssetIds: [],
                lastManualUploadError: '',
              }
            : p
        );
        setWorkspaceProjects(nextProjects);
        saveWorkspaceProjects(nextProjects, uid);
        workspaceCloudDirtyRef.current = false;
        setWorkspaceCloudLastSyncAt(uploadedAt);
        setWorkspaceCloudNextAutoSyncAt(uploadedAt + WORKSPACE_AUTO_SYNC_INTERVAL_MS);
        await refreshAuthUser();
        addGlobalLog(
          '工作区',
          'info',
          `${opts?.reason === 'retry-failed' ? '重试失败项完成' : '手动上传完成'}：${project.name}`,
          `mode=${mode}, attempted=${attemptedCount}, success=${attemptedCount}, failed=0, skipped=${skippedCount}, approx=${formatApproxBytes(uploadedBytesApprox)}`
        );
      } catch (e) {
        if (e instanceof HttpRequestError && e.code === 'STORAGE_QUOTA_EXCEEDED') {
          setWorkspaceCloudQuotaSuspended(true);
          editedWhileQuotaSuspendedRef.current = true;
        }
        const bundle = loadWorkflowBundle(id, uid);
        const scopedAssets = Array.isArray(onlyAssetIds) ? pickAssetsById(bundle.assets, onlyAssetIds) : bundle.assets;
        const attemptedAssetIds = scopedAssets.map((asset) => String(asset?.id || '')).filter(Boolean);
        const nextProjects = workspaceProjectsRef.current.map((p) =>
          p.id === id
            ? {
                ...p,
                lastManualUploadAt: Date.now(),
                lastManualUploadMode: mode,
                lastManualUploadAssetCount: scopedAssets.length,
                lastManualUploadBytesApprox: buildManualUploadEstimate(scopedAssets).bytesApprox,
                lastManualUploadAttemptedCount: attemptedAssetIds.length,
                lastManualUploadSucceededCount: 0,
                lastManualUploadFailedAssetIds: attemptedAssetIds,
                lastManualUploadError: e instanceof Error ? e.message : String(e),
              }
            : p
        );
        setWorkspaceProjects(nextProjects);
        saveWorkspaceProjects(nextProjects, uid);
        addGlobalLog(
          '工作区',
          'error',
          opts?.reason === 'retry-failed' ? '重试失败项上传失败' : '手动上传失败',
          e instanceof Error ? e.message : String(e)
        );
      } finally {
        setWorkspaceUploadingProjectId((prev) => (prev === id ? null : prev));
        setWorkspaceManualUploadMode('full');
      }
    },
    [addGlobalLog, refreshAuthUser, workspaceManualUploadMode, workspaceUploadingProjectId]
  );

  const performBindWorkspaceProject = useCallback(async (id: string) => {
    const uid = userIdRef.current;
    const uname = usernameRef.current;
    if (!uid || !uname) {
      addGlobalLog('工作区', 'warn', '请先登录账号，再绑定项目');
      return;
    }
    const scope = uid;
    const next = workspaceProjectsRef.current.map((p) =>
      p.id === id ? { ...p, boundUserId: uid, boundAt: Date.now() } : p
    );
    setWorkspaceProjects(next);
    saveWorkspaceProjects(next, scope);
    if (isWorkspaceCloudEnabled() && workspaceCloudPushAllowedUserIdRef.current === uid && !workspaceCloudQuotaSuspendedRef.current) {
      try {
        await pushWorkspaceIndex(uid, next, getLastOpenedWorkspaceProjectId(scope), uname);
        addGlobalLog('工作区', 'info', '项目已绑定到当前账号（仅同步索引，不上传大文件）');
      } catch (e) {
        addGlobalLog('工作区', 'warn', '绑定索引写入云端失败，项目已保留本地绑定状态', e instanceof Error ? e.message : String(e));
      }
    } else {
      addGlobalLog('工作区', 'info', '项目已标记绑定；云同步关闭或不可用时仅保留本地状态');
    }
  }, [addGlobalLog]);

  const performUnbindWorkspaceProject = useCallback(async (id: string) => {
    const uid = userIdRef.current;
    const uname = usernameRef.current;
    if (!uid || !uname) {
      addGlobalLog('工作区', 'warn', '请先登录账号，再解绑项目');
      return;
    }
    const scope = uid;
    const next = workspaceProjectsRef.current.map((p) => {
      if (p.id !== id) return p;
      const { boundUserId: _dropUserId, boundAt: _dropBoundAt, ...rest } = p;
      return rest;
    });
    setWorkspaceProjects(next);
    saveWorkspaceProjects(next, scope);
    if (isWorkspaceCloudEnabled() && workspaceCloudPushAllowedUserIdRef.current === uid && !workspaceCloudQuotaSuspendedRef.current) {
      try {
        await pushWorkspaceIndex(uid, next, getLastOpenedWorkspaceProjectId(scope), uname);
        addGlobalLog('工作区', 'info', '项目已解绑当前账号（仅更新索引）');
      } catch (e) {
        addGlobalLog('工作区', 'warn', '解绑索引写入云端失败，项目已保留本地解绑状态', e instanceof Error ? e.message : String(e));
      }
    } else {
      addGlobalLog('工作区', 'info', '项目已解绑；云同步关闭或不可用时仅保留本地状态');
    }
  }, [addGlobalLog]);

  const performManualUploadWorkspaceProject = useCallback(async (id: string) => {
    await executeManualWorkflowUpload(id, { mode: workspaceManualUploadMode, reason: 'manual' });
  }, [executeManualWorkflowUpload, workspaceManualUploadMode]);

  const retryFailedManualUploadWorkspaceProject = useCallback(async (id: string) => {
    const project = workspaceProjectsRef.current.find((p) => p.id === id);
    const failedIds = Array.isArray(project?.lastManualUploadFailedAssetIds) ? project.lastManualUploadFailedAssetIds : [];
    if (!project || failedIds.length === 0) {
      addGlobalLog('工作区', 'warn', '该项目暂无可重试的失败项');
      return;
    }
    await executeManualWorkflowUpload(id, { onlyAssetIds: failedIds, mode: 'incremental', reason: 'retry-failed' });
  }, [addGlobalLog, executeManualWorkflowUpload]);

  const retrySelectedFailedManualUploadWorkspaceProject = useCallback(async () => {
    if (!workspaceUploadFailureDetailDialog) return;
    const selectedIds = workspaceUploadFailureDetailDialog.selectedAssetIds.filter(Boolean);
    if (selectedIds.length === 0) {
      addGlobalLog('工作区', 'warn', '请至少选择一个失败项再重试');
      return;
    }
    const uid = userIdRef.current ?? null;
    const bundle = loadWorkflowBundle(workspaceUploadFailureDetailDialog.projectId, uid);
    const existing = new Set(bundle.assets.map((a) => String(a?.id || '')).filter(Boolean));
    const existingSelectedIds = selectedIds.filter((id) => existing.has(id));
    const missingCount = Math.max(0, selectedIds.length - existingSelectedIds.length);
    addGlobalLog(
      '工作区',
      'info',
      '重试选择统计',
      `selection_total=${selectedIds.length}, selection_existing=${existingSelectedIds.length}, selection_missing=${missingCount}`
    );
    if (existingSelectedIds.length === 0) {
      addGlobalLog('工作区', 'warn', '所选失败项在本地均不存在，已跳过重试');
      return;
    }
    const projectId = workspaceUploadFailureDetailDialog.projectId;
    setWorkspaceUploadFailureFilter('');
    setWorkspaceUploadFailureDetailDialog(null);
    await executeManualWorkflowUpload(projectId, {
      onlyAssetIds: existingSelectedIds,
      mode: 'incremental',
      reason: 'retry-failed',
    });
  }, [addGlobalLog, executeManualWorkflowUpload, workspaceUploadFailureDetailDialog]);

  const copyWorkspaceFailureIdsToClipboard = useCallback(
    async (kind: 'visible' | 'selected') => {
      const d = workspaceUploadFailureDetailDialog;
      if (!d) return;
      const filterQ = workspaceUploadFailureFilter.trim().toLowerCase();
      const visible = filterQ
        ? d.failedAssetIds.filter((id) => String(id).toLowerCase().includes(filterQ))
        : [...d.failedAssetIds];
      const ids =
        kind === 'visible'
          ? visible
          : d.selectedAssetIds.map((id) => String(id || '').trim()).filter(Boolean);
      if (ids.length === 0) {
        addGlobalLog('工作区', 'warn', kind === 'visible' ? '当前列表无 ID 可复制' : '请先勾选至少一项再复制');
        return;
      }
      const uploadedIso = d.uploadedAt ? new Date(d.uploadedAt).toISOString() : '';
      const header = [
        `# project=${d.projectName}`,
        `# projectId=${d.projectId}`,
        `# mode=${d.mode}`,
        uploadedIso ? `# uploadedAt=${uploadedIso}` : '',
        '---',
        '',
      ]
        .filter((line) => line.length > 0)
        .join('\n');
      const text = `${header}${ids.join('\n')}`;
      const outcome = await copyTextToClipboardWithFallback(text);
      if (outcome === 'clipboard') {
        addGlobalLog(
          '工作区',
          'info',
          kind === 'visible' ? `已复制 ${ids.length} 条失败项 ID（当前列表）` : `已复制 ${ids.length} 条失败项 ID（已勾选）`
        );
      } else if (outcome === 'exec') {
        addGlobalLog(
          '工作区',
          'info',
          kind === 'visible'
            ? `已复制 ${ids.length} 条失败项 ID（当前列表，兼容模式）`
            : `已复制 ${ids.length} 条失败项 ID（已勾选，兼容模式）`
        );
      } else {
        setWorkspaceUploadFailureCopyFallback({ text, kind });
        addGlobalLog(
          '工作区',
          'warn',
          '系统剪贴板不可用',
          '已在弹窗中展示全文，请手动全选复制（Ctrl+C / Cmd+C）'
        );
      }
    },
    [addGlobalLog, workspaceUploadFailureDetailDialog, workspaceUploadFailureFilter]
  );

  const performDeleteWorkspaceProject = useCallback(async (id: string) => {
    const scope = userIdRef.current ?? null;
    const uid = userIdRef.current;
    const base = getCompanionLocalBaseUrl();
    const delRemote = await deleteCompanionWorkspaceProject(base, id);
    if (delRemote.ok === false) {
      addGlobalLog('工作区', 'warn', '本地伴侣删除项目失败，继续执行浏览器侧删除', delRemote.error);
    } else {
      addGlobalLog('工作区', 'info', '项目已移入回收站', delRemote.data.id);
    }
    removeWorkflowBundle(id, scope);
    if (uid && usernameRef.current && isWorkspaceCloudEnabled()) {
      void deleteWorkspaceProjectObjects(uid, id, usernameRef.current).catch((e) => console.warn('[workspace cloud]', e));
    }
    const next = workspaceProjectsRef.current.filter((q) => q.id !== id);
    setWorkspaceProjects(next);
    saveWorkspaceProjects(next, scope);
    if (activeWorkspaceProjectIdRef.current === id) {
      cloudWorkflowSyncGenRef.current += 1;
      setWorkspaceCloudHydratingProjectId(null);
      setLastOpenedWorkspaceProjectId(null, scope);
      setActiveWorkspaceProjectId(null);
      setWorkflowAssets([]);
      setWorkflowPending([]);
    }
    if (
      uid &&
      usernameRef.current &&
      isWorkspaceCloudEnabled() &&
      workspaceCloudPushAllowedUserIdRef.current === uid &&
      !workspaceCloudQuotaSuspendedRef.current
    ) {
      void pushWorkspaceIndex(uid, next, getLastOpenedWorkspaceProjectId(scope), usernameRef.current).catch((e) =>
        console.warn('[workspace cloud] index', e)
      );
    }
  }, [addGlobalLog]);

  const activeWorkspaceProjectName = useMemo(
    () => workspaceProjects.find((p) => p.id === activeWorkspaceProjectId)?.name ?? '',
    [workspaceProjects, activeWorkspaceProjectId]
  );
  const aiInvocationReady = isAiInvocationReady();
  const aiProviderToolbarLabel = getAiProviderToolbarLabel();
  const workspaceProjectOptions = workspaceProjects.map((p) => ({ value: p.id, label: p.name }));

  const handleUserMenuAction = useCallback(async (action: string) => {
    if (!action) return;
    if (action === 'manage') {
      setMode(AppMode.SETTINGS);
      setIsSidebarOpen(false);
      return;
    }
    if (action === 'switch' || action === 'logout') {
      await logout();
    }
  }, [logout]);

  // 提取花纹状态
  const [textureSource, setTextureSource] = useState<string>('');
  const [textureResult, setTextureResult] = useState<string>('');
  const [tilingScale, setTilingScale] = useState(2);
  const [, setPbrMaps] = useState<{ normal?: string; roughness?: string }>({});
  const [isTextureProcessing, setIsTextureProcessing] = useState(false);
  /** 最近一次贴图生成的记录 id，用于结果区评分 */
  const [lastTextureRecordId, setLastTextureRecordId] = useState<string | null>(null);
  /** 评分缓存：recordId -> userScore，点击星星后立即更新 UI，与 recordStore 同步 */
  const [ratingCache, setRatingCache] = useState<Record<string, number>>({});
  /** 生成记录（仅用于读取已持久化的评分，避免每条消息都调 loadRecords） */
  const recordsForRating = React.useMemo(() => loadRecords(), []);

  // 提示词擂台 V2：自然语言 → 模型生成 A/B(/C/D) → 败者优化循环 → 满意保存；过程可见、可选参赛人数、可增加挑战者。
  const [arenaUserDescription, setArenaUserDescription] = useState('');
  const [arenaImage, setArenaImage] = useState<string>('');
  const [arenaRound, setArenaRound] = useState(0);
  const [arenaInitialCount, setArenaInitialCount] = useState<2 | 3 | 4>(2);
  const [arenaReasoning, setArenaReasoning] = useState('');
  const [arenaOptimizeReasoning, setArenaOptimizeReasoning] = useState('');
  const [arenaPromptA, setArenaPromptA] = useState('');
  const [arenaImageA, setArenaImageA] = useState<string | null>(null);
  const [arenaPromptB, setArenaPromptB] = useState('');
  const [arenaImageB, setArenaImageB] = useState<string | null>(null);
  const [arenaPromptC, setArenaPromptC] = useState('');
  const [arenaImageC, setArenaImageC] = useState<string | null>(null);
  const [arenaPromptD, setArenaPromptD] = useState('');
  const [arenaImageD, setArenaImageD] = useState<string | null>(null);
  const [arenaChampionPrompt, setArenaChampionPrompt] = useState<string | null>(null);
  const [arenaChampionImage, setArenaChampionImage] = useState<string | null>(null);
  const [arenaChallengerPrompt, setArenaChallengerPrompt] = useState<string | null>(null);
  const [arenaChallengerImage, setArenaChallengerImage] = useState<string | null>(null);
  const [arenaChallenger2Prompt, setArenaChallenger2Prompt] = useState<string | null>(null);
  const [arenaChallenger2Image, setArenaChallenger2Image] = useState<string | null>(null);
  const [arenaIsGenerating, setArenaIsGenerating] = useState(false);
  const [arenaIsOptimizing, setArenaIsOptimizing] = useState(false);
  const [arenaCompareModalOpen, setArenaCompareModalOpen] = useState(false);
  const [arenaSaveSnippetConfirm, setArenaSaveSnippetConfirm] = useState(false);
  /** 用户选完胜者后可选填：败者差在哪（多选）、胜者为何被选，用于优化败者时传入模型 */
  const [arenaReportedGaps, setArenaReportedGaps] = useState<string[]>([]);
  const [arenaWinnerStrength, setArenaWinnerStrength] = useState('');
  const [arenaLoserRemark, setArenaLoserRemark] = useState('');
  const [arenaImageModel, setArenaImageModel] = useState<string>(
    () => DIALOG_IMAGE_GEARS.find((g) => g.id === 'standard')?.modelId || DIALOG_IMAGE_GEARS[0].modelId
  );
  const [arenaCurrentStep, setArenaCurrentStep] = useState<ArenaCurrentStep>('idle');
  const [arenaStepLog, setArenaStepLog] = useState<ArenaStepEntry[]>([]);
  const [arenaTimeline, setArenaTimeline] = useState<ArenaTimelineBlock[]>([]);
  const [arenaSnippets, setArenaSnippets] = useState<Array<{ id: string; text: string; timestamp: number; source?: string }>>(() => loadSnippets());
  const [arenaFirstVisit, setArenaFirstVisit] = useState(() => !localStorage.getItem('ac_arena_visited'));

  const { mainScrollRef, showBackToTop, scrollToTop } = useMainScrollBackToTop();
  const isWorkflowMarqueeWheelActive = mode === AppMode.WORKFLOW && !!activeWorkspaceProjectId;
  const tryDisableCapabilityPresetById = useCallback((id: string): boolean => {
    if (!id || id.startsWith('set:')) return false;
    let changed = false;
    setCapabilityPresets((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx < 0 || prev[idx]!.enabled === false) return prev;
      changed = true;
      const next = [...prev];
      next[idx] = { ...next[idx]!, enabled: false };
      saveCapabilityPresets(next);
      return next;
    });
    return changed;
  }, []);
  const capabilityGutterDrop = useMemo((): WorkflowCapabilityGutterDropConfig | null => {
    if (!isWorkflowMarqueeWheelActive) return null;
    return { enabled: true, onTryDisablePreset: tryDisableCapabilityPresetById };
  }, [isWorkflowMarqueeWheelActive, tryDisableCapabilityPresetById]);
  const {
    workflowMainContentRef,
    onMainMouseDownCapture,
    onMainWheelCapture,
    onMainDragOverCapture,
    onMainDropCapture,
    registerMarqueeStart: registerWorkflowMarqueeStart,
    registerPaneWheel: registerWorkflowPaneWheel,
    registerWorkflowAssetListWheel,
  } = useWorkflowMainScrollCapture(isWorkflowMarqueeWheelActive, capabilityGutterDrop);

  useEffect(() => {
    if (mode === AppMode.ARENA) setArenaSnippets(loadSnippets());
  }, [mode]);
  useEffect(() => {
    // 仓库/能力已并入工作区画卷，旧模式入口删除后统一回到工作区
    if (mode === AppMode.LIBRARY || mode === AppMode.CAPABILITY) {
      setMode(AppMode.WORKFLOW);
    }
  }, [mode]);

  // 对话式生图状态
  const [dialogInputText, setDialogInputText] = useState('');
  const DIALOG_INPUT_IMAGES_MAX = 9;
  /** 对话输入条与「发送」按钮统一的单行高度（px） */
  const DIALOG_INPUT_BAR_H = 48;
  const [dialogInputImages, setDialogInputImages] = useState<Array<{ id: string; data: string; fromTemp?: boolean }>>([]);
  const [dialogImageGear, setDialogImageGear] = useState<DialogImageGear>('standard');
  const [dialogModel, setDialogModel] = useState<string>(
    () => DIALOG_IMAGE_GEARS.find((g) => g.id === 'standard')?.modelId || DIALOG_IMAGE_GEARS[0].modelId
  );
  const { rows: effectiveImageGearRows, coerceGearId: coerceImageGearId } = useEffectiveImageGearRows();
  useLayoutEffect(() => {
    const ok = effectiveImageGearRows.find((r) => r.modelId === arenaImageModel && !r.disabled);
    if (!ok) {
      const gid = DIALOG_IMAGE_GEARS.find((x) => x.modelId === arenaImageModel)?.id ?? 'standard';
      const ng = coerceImageGearId(gid);
      const fb = effectiveImageGearRows.find((r) => r.id === ng && !r.disabled);
      if (fb && fb.modelId !== arenaImageModel) setArenaImageModel(fb.modelId);
    }
  }, [effectiveImageGearRows, coerceImageGearId, arenaImageModel]);
  useLayoutEffect(() => {
    const ng = coerceImageGearId(dialogImageGear);
    const row = effectiveImageGearRows.find((r) => r.id === ng && !r.disabled);
    if (!row) return;
    if (ng !== dialogImageGear) setDialogImageGear(ng as DialogImageGear);
    if (row.modelId !== dialogModel) setDialogModel(row.modelId);
  }, [effectiveImageGearRows, coerceImageGearId, dialogImageGear, dialogModel]);
  const [dialogAutoGenerateImage, setDialogAutoGenerateImage] = useState(true);
  const [dialogSkipUnderstand, setDialogSkipUnderstandState] = useState<boolean>(() => getDialogSkipUnderstand());
  const [dialogAspectRatio, setDialogAspectRatio] = useState<string>('adaptive');
  const [dialogImageSize, setDialogImageSize] = useState<string>(SUPPORTED_IMAGE_SIZES[1].value);
  const [dialogEditingMessageId, setDialogEditingMessageId] = useState<string | null>(null);
  const [dialogEditingText, setDialogEditingText] = useState('');
  const {
    dialogSessions,
    setDialogActiveSessionId,
    dialogActiveSessionIdResolved,
    activeSession,
    dialogMessages,
    setDialogMessages,
    dialogTempLibrary,
    dialogTempLibraryFilter,
    setDialogTempLibraryFilter,
    dialogOlderCollapsed,
    setDialogOlderCollapsed,
    dialogArchivedCollapsed,
    setDialogArchivedCollapsed,
    dialogTempPreviewId,
    setDialogTempPreviewId,
    dialogTempSelectedIds,
    setDialogTempSelectedIds,
    dialogTempFiltered,
    addToDialogTempLibrary,
    createNewDialogSession,
    updateDialogSession,
    archiveDialogSession,
    removeDialogSession,
    handleDialogTempSelectAll,
    handleDialogTempInvertSelect,
    handleDialogTempBatchDownload,
  } = useDialogWorkspace(user?.id ?? null);
  const dialogTempFilteredRef = useRef(dialogTempFiltered);
  dialogTempFilteredRef.current = dialogTempFiltered;
  /** 对话气泡内点开大图：临时库无对应项时用内存数据走与临时库相同的预览层 */
  const [dialogChatImagePreview, setDialogChatImagePreview] = useState<{
    data: string;
    messageId: string;
    sourceType: DialogTempItem['sourceType'];
    userPrompt?: string;
    understoodPrompt?: string;
    timestamp: number;
  } | null>(null);
  const DIALOG_BOX_LABELS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
  const dialogEndRef = useRef<HTMLDivElement>(null);
  const [dialogValidationError, setDialogValidationError] = useState<string | null>(null);
  const [dialogBridgePrefs, setDialogBridgePrefsState] = useState(getDialogBridgePrefs);
  useEffect(() => subscribeDialogBridgePrefs(() => setDialogBridgePrefsState(getDialogBridgePrefs())), []);
  const [atSuggestionsOpen, setAtSuggestionsOpen] = useState(false);
  const [atSuggestionsCursor, setAtSuggestionsCursor] = useState(0);
  const dialogInputRef = useRef<HTMLTextAreaElement>(null);
  const dialogInputWrapperRef = useRef<HTMLDivElement>(null);
  const [dialogInputScrollOverflow, setDialogInputScrollOverflow] = useState(false);
  const adjustDialogTextareaHeight = useCallback(() => {
    const el = dialogInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = Math.min(typeof window !== 'undefined' ? window.innerHeight * 0.4 : 240, 280);
    const natural = el.scrollHeight;
    const next = Math.min(Math.max(natural, DIALOG_INPUT_BAR_H), max);
    el.style.height = `${next}px`;
    setDialogInputScrollOverflow(natural > max);
  }, [DIALOG_INPUT_BAR_H]);
  useLayoutEffect(() => {
    adjustDialogTextareaHeight();
  }, [dialogInputText, adjustDialogTextareaHeight]);
  const dialogTempItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dialogTempMarqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const dialogTempMarqueeActiveRef = useRef(false);
  const [dialogTempMarqueeRect, setDialogTempMarqueeRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [dialogTempPreviewScale, setDialogTempPreviewScale] = useState(1);
  const [dialogTempPreviewLayout, setDialogTempPreviewLayout] = useState<'flat' | 'pano'>('flat');
  const dialogTempPreviewDragRef = useRef<{ startX: number; startY: number; startScale: number } | null>(null);
  const [dialogTempPreviewOffset, setDialogTempPreviewOffset] = useState({ x: 0, y: 0 });
  const dialogTempPreviewPanRef = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null);
  const dialogTempPreviewSpacePressedRef = useRef(false);
  const dialogTempPreviewImgRef = useRef<HTMLImageElement | null>(null);
  const dialogTempPreviewOverlayRef = useRef<HTMLDivElement | null>(null);
  const dialogTempPreviewZoomPivotRef = useRef<{ x: number; y: number } | null>(null);
  const dialogTempPreviewZoomLastScaleRef = useRef(1);
  const dialogTempPreviewWheelAccumRef = useRef(0);

  const handleDialogTempLocateMessage = (item: DialogTempItem) => {
    if (item.sourceSessionId) setDialogActiveSessionId(item.sourceSessionId);
    if (item.sourceMessageId) setTimeout(() => document.getElementById(`msg-${item.sourceMessageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
  };
  const handleDialogTempAddToInput = (item: DialogTempItem) => {
    setDialogInputImages(prev => (prev.length >= DIALOG_INPUT_IMAGES_MAX ? prev : [...prev, { id: item.id, data: item.data, fromTemp: true }]));
    if (item.userPrompt || item.understoodPrompt) setDialogInputText(item.userPrompt || item.understoodPrompt || '');
    dialogEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  /** 将临时库单项加入资产仓库（预览图集） */
  const addDialogTempToLibrary = (item: DialogTempItem) => {
    addToLibrary([{ data: item.data, category: 'PREVIEW_STRIP', label: item.label || '临时库', type: 'STRIP' }]);
  };
  const dialogTempSourceTypeLabel = (t: DialogTempItem['sourceType']) => t === 'user_input' ? '用户上传' : t === 'object_crop' ? '识别物体' : '生图';

  const closeDialogImagePreview = useCallback(() => {
    setDialogTempPreviewId(null);
    setDialogChatImagePreview(null);
  }, [setDialogTempPreviewId]);

  const openDialogImagePreviewFromChat = useCallback(
    (p: {
      dataUrl: string;
      sourceMessageId: string;
      sourceType: DialogTempItem['sourceType'];
      userPrompt?: string;
      understoodPrompt?: string;
      timestamp: number;
    }) => {
      const match = dialogTempLibrary.find(
        (t) => t.sourceMessageId === p.sourceMessageId && t.sourceType === p.sourceType
      );
      if (match) {
        setDialogChatImagePreview(null);
        setDialogTempPreviewId(match.id);
        return;
      }
      setDialogTempPreviewId(null);
      setDialogChatImagePreview({
        data: p.dataUrl,
        messageId: p.sourceMessageId,
        sourceType: p.sourceType,
        userPrompt: p.userPrompt,
        understoodPrompt: p.understoodPrompt,
        timestamp: p.timestamp,
      });
    },
    [dialogTempLibrary, setDialogTempPreviewId]
  );

  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [config] = useState<SystemConfig>(() => {
    const defaults: SystemConfig = {
      modelText: DEFAULT_MODEL_TEXT,
      modelImage: DEFAULT_MODEL_IMAGE,
      modelPro: DEFAULT_MODEL_PRO,
      customPromptSuffix: "",
      prompts: { ...DEFAULT_PROMPTS },
    };
    const raw = localStorage.getItem("ac_config");
    if (!raw) return defaults;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaults;
    }
    const p = parsed && typeof parsed === "object" ? (parsed as Partial<SystemConfig>) : {};
    const merged: SystemConfig = {
      ...defaults,
      ...p,
      prompts: {
        ...defaults.prompts,
        ...(p.prompts && typeof p.prompts === "object" ? p.prompts : {}),
      },
    };
    return { ...merged, ...migrateSystemModelSlots(merged) };
  });

  useEffect(() => {
    const savedLib = localStorage.getItem('ac_library'); if (savedLib) setLibrary(JSON.parse(savedLib));
  }, []);

  useEffect(() => {
    dialogEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [dialogMessages]);

  useEffect(() => {
    if (!atSuggestionsOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (dialogInputWrapperRef.current && !dialogInputWrapperRef.current.contains(e.target as Node)) setAtSuggestionsOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [atSuggestionsOpen]);

  useEffect(() => {
    const completed = tasks.filter(t => t.status === 'SUCCESS' || t.status === 'FAILED');
    if (completed.length === 0) return;
    const timers = completed.map(t => window.setTimeout(() => setTasks(prev => prev.filter(x => x.id !== t.id)), 2500));
    return () => { timers.forEach(clearTimeout); };
  }, [tasks]);

  const addTask = (type: AppTask['type'], label: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    setTasks(prev => [{ id, type, label, status: 'PENDING', progress: 0, message: '排队中...', startTime: Date.now() }, ...prev]);
    return id;
  };
  const updateTask = (id: string, patch: Partial<AppTask>) => setTasks(p => p.map(t => t.id === id ? { ...t, ...patch } : t));

  const addToLibrary = (items: Partial<LibraryItem>[]): LibraryItem[] => {
    const newItems: LibraryItem[] = items.map(item => ({ 
      id: Math.random().toString(36).substr(2, 9), 
      timestamp: Date.now(), 
      category: item.category || 'SCENE_OBJECT', 
      data: item.data!, 
      label: item.label || '资产', 
      sourceId: 'app', 
      type: item.type || 'SLICE',
      style: item.style,
      groupId: item.groupId || Math.random().toString(36).substr(2, 9),
      modelUrls: item.modelUrls
    }));
    const nextLib = [...newItems, ...library]; setLibrary(nextLib); localStorage.setItem('ac_library', JSON.stringify(nextLib.slice(0, 500)));
    return newItems;
  };

  const {
    setDialogVersionIndex,
    dialogDetectMessageId,
    dialogDetectingId,
    dialogCropState,
    dialogCropStart,
    dialogCropCurrent,
    dialogCropImgRef,
    getDisplayVersion,
    getDialogVersions,
    getDialogVersionPosition,
    showPreviousDialogVersion,
    showNextDialogVersion,
    openDialogCrop,
    handleDialogCropMouseDown,
    handleDialogCropExecute,
    handleDialogCropCancel,
    handleDialogSaveToLibrary,
    handleDialogUseAsInput,
    handleDialogDetectObjects,
    handleDialogDetectClose,
    handleDialogDownloadCropByIndex,
    handleDialogDownloadAllCrops,
    handleDialogTempAddCropByIndex,
    handleDialogTempAddAllCrops,
  } = useDialogPostProcessing({
    dialogMessages,
    setDialogMessages,
    dialogActiveSessionIdResolved,
    activeSessionTitle: activeSession?.title,
    modelText: config.modelText,
    addTask,
    updateTask,
    addToDialogTempLibrary,
    addToLibrary,
    setDialogInputImages,
    dialogEndRef,
    dialogBoxLabels: DIALOG_BOX_LABELS,
  });

  const {
    dialogSendingSessionIds,
    dialogRegeneratingId,
    dialogGeneratingFromUnderstoodId,
    handleDialogSend,
    handleDialogCancelGen,
    handleDialogGenerateFromUnderstood,
    handleDialogRegenerate,
    handleDialogEditThenRegenerate,
  } = useDialogGeneration({
    dialogSessionIds: dialogSessions.map((session) => session.id),
    dialogInputText,
    setDialogInputText,
    dialogInputImages,
    setDialogInputImages,
    dialogMessages,
    setDialogMessages,
    dialogAutoGenerateImage,
    dialogSkipUnderstand,
    dialogModel,
    dialogAspectRatio,
    dialogImageSize,
    dialogActiveSessionIdResolved,
    activeSessionTitle: activeSession?.title,
    config,
    updateDialogSession,
    addToDialogTempLibrary,
    setDialogValidationError,
    setDialogVersionIndex,
    setDialogEditingMessageId,
    addTask,
    updateTask,
    addGlobalLog,
    addGenerationRecord,
    dialogPersistUserId: user?.id ?? null,
    dialogUsername: user?.username,
    dialogCloudPersistEnabled: Boolean(user?.id && isWorkspaceCloudEnabled()),
    dialogBridgeEnabled: dialogBridgePrefs.enabled,
    dialogBridgeDeviceId: dialogBridgePrefs.deviceId,
    dialogBridgeBbRoute: dialogBridgePrefs.bbSiteRoute,
    dialogBridgeConnectorId: dialogBridgePrefs.connectorId,
  });

  useEffect(() => {
    setDialogSkipUnderstand(dialogSkipUnderstand);
  }, [dialogSkipUnderstand]);

  const handleRemoveDialogSession = useCallback((sessionId: string) => {
    handleDialogCancelGen(sessionId);
    removeDialogSession(sessionId);
  }, [handleDialogCancelGen, removeDialogSession]);

  const runTextureProcessing = async (sourceImage: string, type: 'pattern' | 'tileable' | 'pbr', mapType = '') => {
    if (isTextureProcessing) return;
    setIsTextureProcessing(true);
    const taskId = addTask('TEXTURE_GEN', type === 'pattern' ? '图案提取' : '贴图合成');
    const typeLabel = type === 'pattern' ? '图案提取' : type === 'tileable' ? '贴图合成' : `PBR ${mapType}`;
    addGlobalLog('提取花纹', 'info', typeLabel + ' 开始', undefined);
    try {
      const result = await processTexture(sourceImage, type, mapType, config.modelImage);
      if (type === 'pbr') setPbrMaps(prev => ({ ...prev, [mapType.toLowerCase()]: result }));
      else setTextureResult(result);
      updateTask(taskId, { status: 'SUCCESS', progress: 100 });
      const newItems = addToLibrary([{ data: result, type: 'TEXTURE', category: 'TEXTURE_MAP', label: `贴图成品` }]);
      const libraryItemId = newItems[0]?.id ?? '';
      const fullPrompt = getTexturePrompt(type, mapType, { pattern: config.prompts.texture_pattern, tileable: config.prompts.texture_tileable, pbr: config.prompts.texture_pbr });
      const record = addGenerationRecord({
        source: 'texture',
        timestamp: Date.now(),
        fullPrompt,
        textureType: type,
        textureMapType: mapType || undefined,
        outputImageRef: { type: 'libraryId', value: libraryItemId },
        libraryItemId,
        model: config.modelImage,
        sessionId: '',
        messageId: '',
        versionIndex: 0
      });
      setLastTextureRecordId(record.id);
      addGlobalLog('提取花纹', 'info', typeLabel + ' 完成', undefined);
    } catch (err: any) {
      addGlobalLog('提取花纹', 'error', typeLabel + ' 失败', (err as Error).message);
      updateTask(taskId, { status: 'FAILED', error: err.message });
    }
    finally { setIsTextureProcessing(false); }
  };

  const addGenerate3DLog = useCallback((level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => {
    const detailStr = detail !== undefined ? (typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)) : undefined;
    addGlobalLog('生成3D', level, message, detailStr);
  }, [addGlobalLog]);

  const creds3D = useMemo(() => getTencentCredsFromEnv(), []);

  /** 工作流中拖图到「生成3D」能力时：用能力预设参数提交 3D 任务 */
  const handleAddGenerate3DJobFromWorkflow = async (
    preset: CustomAppModule,
    imageBase64: string,
    task?: WorkflowPendingTask,
    options?: { forceNewTask?: boolean }
  ) => {
    if (preset.category !== 'generate_3d' || !preset.generate3D) return;
    const g = normalizeGenerate3DPresetForRun(preset.generate3D);
    const provider = resolveGenerate3dProviderId(g);
    if (provider === 'tencent') {
      if (!creds3D) {
        const msg = '缺少腾讯云混元配置：请在 .env.local 配置 VITE_TENCENT_PROXY 并启动 npm run proxy';
        addGenerate3DLog('warn', `[工作流] ${msg}`);
        alert(msg);
        throw new Error(msg);
      }
      const taskId = addTask('GENERATE_3D', `${preset.label}（混元）`);
      const gNorm = normalizeGenerate3DPresetForRun(preset.generate3D);
      try {
        addGenerate3DLog('info', `[工作流] 混元提交：${preset.label}`, {
          module: gNorm.module,
          model: gNorm.model,
          generateType: gNorm.generateType,
          resultFormat: gNorm.resultFormat,
          enablePBR: gNorm.enablePBR,
        });
        updateTask(taskId, { status: 'RUNNING', progress: 10 });
        const { jobId, files } = await tencentWorkflowRunImageTo3D({
          creds: creds3D,
          preset,
          imageDataUrl: imageBase64,
          onProgress: (p) =>
            updateTask(taskId, { status: 'RUNNING', progress: Math.max(15, Math.min(95, Math.round(p))) }),
          onLog: (message, detail) => addGenerate3DLog('info', message, detail),
        });
        const { modelUrls } = extractTencentModelAndPreviewUrls(files);
        if (!modelUrls.length) {
          throw new Error('混元任务完成但未返回可下载模型链接');
        }
        if (task?.assetId && task?.actionType && jobId) {
          setWorkflowAssets((prev) =>
            prev.map((a) => {
              if (a.id !== task.assetId) return a;
              const old = a.resultMeta?.[task.actionType] || { executedAt: Date.now() };
              return {
                ...a,
                resultMeta: {
                  ...(a.resultMeta || {}),
                  [task.actionType]: {
                    ...old,
                    tencentJobId: jobId,
                    tencentLastError: undefined,
                    presetActionIdSnapshot: preset.id,
                    displayStepLabel: preset.label,
                  },
                },
              };
            })
          );
        }
        const companionBase = getCompanionLocalBaseUrl();
        const companionProjectId = String(activeWorkspaceProjectId || '').trim() || 'default';
        const workflowAssetId = task?.assetId || `wf_tencent_${Math.random().toString(36).slice(2, 11)}`;
        const resultKey = task?.actionType || preset.id;
        const persisted = await persistTencentModelsForWorkflowAsset({
          creds: creds3D,
          tencentJobId: jobId,
          assetId: workflowAssetId,
          resultKey,
          files,
          companionBaseUrl: companionBase,
          companionProjectId,
          onLog: (level, message, detail) => addGenerate3DLog(level, message, detail),
        });
        const localModelUrls = persisted.modelUrls;
        const modelCompanionKeys = persisted.modelCompanionKeys;
        const stepModelFormats = persisted.stepModelFormats;
        const modelSourceName = persisted.modelSourceName;
        const localPreviewUrl = persisted.preview?.objectUrl || '';
        const previewCompanionKey = persisted.preview?.companionKey || '';
        if (!companionBase || !companionProjectId || companionProjectId === 'default') {
          addGenerate3DLog(
            'warn',
            '[工作流] 混元模型已落内存',
            '未连接本地伴侣时仅浏览器内预览，刷新可能失效；连接伴侣后可写入卷目录。'
          );
        }
        setWorkflowAssets((prev) =>
          patchWorkflowAssetsWith3dResult({
            prev,
            task,
            preset,
            imageBase64,
            workflowAssetId,
            resultKey,
            localModelUrls,
            modelCompanionKeys,
            stepModelFormats,
            modelSourceName,
            localPreviewUrl,
            previewCompanionKey,
            jobMeta: { tencentJobId: jobId, tencentLastError: undefined },
          })
        );
        updateTask(taskId, { status: 'SUCCESS', progress: 100 });
        addGenerate3DLog('info', `[工作流] 混元生成完成，模型已回填资产卡`, {
          jobId,
          modelCount: localModelUrls.length,
          hasPreview: Boolean(localPreviewUrl),
          companionProjectId,
        });
      } catch (e) {
        const msg = normalizeApiErrorMessage(e);
        updateTask(taskId, { status: 'FAILED', error: msg });
        if (task?.assetId && task?.actionType) {
          setWorkflowAssets((prev) =>
            prev.map((a) => {
              if (a.id !== task.assetId) return a;
              const old = a.resultMeta?.[task.actionType] || { executedAt: Date.now() };
              return {
                ...a,
                resultMeta: {
                  ...(a.resultMeta || {}),
                  [task.actionType]: {
                    ...old,
                    tencentLastError: msg,
                  },
                },
              };
            })
          );
        }
        addGenerate3DLog('error', `[工作流] 混元生成失败：${preset.label}`, msg);
        throw new Error(msg);
      }
      return;
    }
    const tripoApiKey = getTripoApiKey();
    if (!tripoApiKey) {
      addGenerate3DLog('warn', '缺少 Tripo API Key，请在 API 密钥弹窗中先保存');
      alert('缺少 Tripo API Key，请先在 API 密钥弹窗保存。');
      return;
    }
    const taskId = addTask('GENERATE_3D', `${preset.label}（Tripo）`);
    let tripoCatchTaskId = '';
    let tripoCatchResumedFromExisting = false;
    try {
      const previewInput = buildTripoCreateTaskInputFromPreset({
        apiKey: tripoApiKey,
        preset,
        imageDataUrl: imageBase64,
      });
      const tripoPayloadPreview = {
        type: previewInput.type,
        prompt: previewInput.prompt,
        negativePrompt: previewInput.negativePrompt,
        modelVersion: previewInput.modelVersion,
        texture: previewInput.texture,
        pbr: previewInput.pbr,
        textureQuality: previewInput.textureQuality,
        geometryQuality: previewInput.geometryQuality,
        faceLimit: previewInput.faceLimit,
        quad: previewInput.quad,
        smartLowPoly: previewInput.smartLowPoly,
        generateParts: previewInput.generateParts,
        autoSize: previewInput.autoSize,
        compress: previewInput.compress,
        exportUv: previewInput.exportUv,
        enableImageAutofix: previewInput.enableImageAutofix,
        textureAlignment: previewInput.textureAlignment,
        orientation: previewInput.orientation,
        hasImageInput: previewInput.type === 'image_to_model',
      };
      addGenerate3DLog('info', `[工作流] Tripo 提交任务：${preset.label}`, tripoPayloadPreview);
      updateTask(taskId, { status: 'RUNNING', progress: 10 });
      const forceNewTask = Boolean(options?.forceNewTask);
      if (forceNewTask) {
        addGenerate3DLog('warn', '[工作流] 用户选择重新提交新任务（可能计费）');
      }
      const recoverTaskId =
        !forceNewTask && task?.assetId && task?.actionType
          ? String(
              workflowAssetsRef.current.find((a) => a.id === task.assetId)?.resultMeta?.[task.actionType]?.tripoTaskId || ''
            ).trim()
          : '';
      const { taskId: createdTripoId, resumed: resumedFromExistingTask } = await tripoWorkflowCreateOrResumeTaskId({
        apiKey: tripoApiKey,
        preset,
        imageDataUrl: imageBase64,
        existingTaskId: recoverTaskId || undefined,
        forceNewTask,
      });
      const createdTaskId = createdTripoId;
      tripoCatchTaskId = createdTaskId;
      tripoCatchResumedFromExisting = resumedFromExistingTask;
      if (resumedFromExistingTask) {
        addGenerate3DLog('info', '[工作流] 继续查询既有 Tripo 任务（不新建，避免重复计费）', { taskId: createdTaskId });
      } else {
        addGenerate3DLog('info', '[工作流] 已创建新 Tripo 任务（可能计费）', { taskId: createdTaskId });
      }
      if (task?.assetId && task?.actionType) {
        setWorkflowAssets((prev) =>
          prev.map((a) => {
            if (a.id !== task.assetId) return a;
            const old = a.resultMeta?.[task.actionType] || { executedAt: Date.now() };
            return {
              ...a,
              resultMeta: {
                ...(a.resultMeta || {}),
                [task.actionType]: {
                  ...old,
                  tripoTaskId: createdTaskId,
                  tripoLastError: undefined,
                  presetActionIdSnapshot: preset.id,
                  displayStepLabel: preset.label,
                },
              },
            };
          })
        );
      }
      updateTask(taskId, { status: 'RUNNING', progress: 35 });
      const done = await tripoWorkflowPollUntilDone({
        apiKey: tripoApiKey,
        taskId: createdTaskId,
        normalizeApiErrorMessage,
        onTripoStatus: (phase) => {
          if (phase === 'queued') updateTask(taskId, { status: 'RUNNING', progress: 40 });
          if (phase === 'running') updateTask(taskId, { status: 'RUNNING', progress: 65 });
        },
        onPollRecover: (errMsg) =>
          addGenerate3DLog('warn', '[工作流] Tripo 状态查询异常，尝试做一次兜底查询（不重建任务）', {
            taskId: createdTaskId,
            error: errMsg,
          }),
      });
      if (done.status !== 'success' || done.modelUrls.length === 0) {
        throw new Error('Tripo 任务未产出可下载模型');
      }
      const { modelUrls, previewUrl } = extractTripoModelAndPreviewUrls(done);
      if (modelUrls.length === 0) {
        throw new Error('Tripo 任务完成但未识别到模型文件链接');
      }
      const companionBase = getCompanionLocalBaseUrl();
      const companionProjectId = String(activeWorkspaceProjectId || '').trim() || 'default';
      const workflowAssetId = task?.assetId || `wf_tripo_${Math.random().toString(36).slice(2, 11)}`;
      const resultKey = task?.actionType || preset.id;
      const persisted = await persistTripoModelsForWorkflowAsset({
        apiKey: tripoApiKey,
        tripoTaskId: createdTaskId,
        assetId: workflowAssetId,
        resultKey,
        glbSourceUrls: modelUrls,
        previewUrl,
        companionBaseUrl: companionBase,
        companionProjectId,
        onLog: (level, message, detail) => addGenerate3DLog(level, message, detail),
      });
      const localModelUrls = persisted.modelUrls;
      const modelCompanionKeys = persisted.modelCompanionKeys;
      const stepModelFormats = persisted.stepModelFormats;
      const modelSourceName = persisted.modelSourceName;
      const localPreviewUrl = persisted.preview?.objectUrl || '';
      const previewCompanionKey = persisted.preview?.companionKey || '';
      if (!companionBase || !companionProjectId || companionProjectId === 'default') {
        addGenerate3DLog(
          'warn',
          '[工作流] Tripo 模型已落内存',
          '未连接本地伴侣时仅浏览器内预览，刷新可能失效；连接伴侣后可用「从 Tripo 拉取」写入卷目录。'
        );
      }
      setWorkflowAssets((prev) =>
        patchWorkflowAssetsWith3dResult({
          prev,
          task,
          preset,
          imageBase64,
          workflowAssetId,
          resultKey,
          localModelUrls,
          modelCompanionKeys,
          stepModelFormats,
          modelSourceName,
          localPreviewUrl,
          previewCompanionKey,
          jobMeta: { tripoTaskId: createdTaskId, tripoLastError: undefined },
        })
      );
      updateTask(taskId, { status: 'SUCCESS', progress: 100 });
      addGenerate3DLog('info', `[工作流] Tripo 生成完成，模型已落本地伴侣并回填资产卡`, {
        modelCount: localModelUrls.length,
        hasPreview: Boolean(localPreviewUrl),
        companionProjectId,
      });
      setTripoRecoveryContext(null);
      setTripoRecoveryActionRunning(null);
    } catch (e) {
      const msg = normalizeApiErrorMessage(e);
      updateTask(taskId, { status: 'FAILED', error: msg });
      if (task?.assetId && task?.actionType) {
        setWorkflowAssets((prev) =>
          prev.map((a) => {
            if (a.id !== task.assetId) return a;
            const old = a.resultMeta?.[task.actionType] || { executedAt: Date.now() };
            return {
              ...a,
              resultMeta: {
                ...(a.resultMeta || {}),
                [task.actionType]: {
                  ...old,
                  tripoLastError: msg,
                },
              },
            };
          })
        );
      }
      const extraHint = /401|authentication failed|1002/i.test(msg)
        ? '（请在 API 密钥中填写 Tripo Key，格式通常为 tsk_ 开头）'
        : '';
      const nextActionHint =
        tripoCatchResumedFromExisting || tripoCatchTaskId
          ? '；可选下一步：继续查询旧任务（不计费）/ 重新提交新任务（可能计费）'
          : '';
      addGenerate3DLog('error', `[工作流] Tripo 生成失败：${preset.label}`, `${msg}${extraHint}${nextActionHint}`);
      setTripoRecoveryContext({
        presetId: preset.id,
        imageBase64,
        task,
        canResumeOldTask: Boolean(tripoCatchTaskId),
        lastError: `${msg}${extraHint}`,
      });
      setTripoRecoveryActionRunning(null);
      throw new Error(`${msg}${extraHint}${nextActionHint}`);
    }
  };

  const openPicker = (filter?: AssetCategory, callback?: (items: LibraryItem[]) => void, multiSelect?: boolean) => {
    setPickerFilter(filter);
    setPickerMultiSelect(!!multiSelect);
    if (callback) setPickerCallback(() => callback);
    setIsLibraryPickerOpen(true);
  };

  const handleDialogDownload = (msg: DialogMessage) => {
    const v = getDisplayVersion(msg);
    const url = getDialogVersionImageDataUrl(v);
    if (!url) return;
    void triggerImageDownload(url, `对话_${msg.id.slice(0, 6)}`);
  };

  const handleCopyDialogImage = async (base64: string) => {
    try {
      const res = await fetch(base64);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    } catch { /* ignore clipboard failure */ }
  };

  const handleDialogPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => setDialogInputImages(prev => prev.length >= DIALOG_INPUT_IMAGES_MAX ? prev : [...prev, { id: Math.random().toString(36).slice(2, 11), data: reader.result as string, fromTemp: false }]);
          reader.readAsDataURL(file);
        }
        return;
      }
    }
  };

  const addDialogTempFromFiles = useCallback((files: File[], fallbackLabel: string) => {
    files
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, 50)
      .forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          const data = reader.result as string;
          addToDialogTempLibrary({
            data,
            sourceSessionId: dialogActiveSessionIdResolved,
            sourceType: 'user_input',
            label: file.name?.replace(/\.[^.]+$/, '') || fallbackLabel,
          });
        };
        reader.readAsDataURL(file);
      });
  }, [addToDialogTempLibrary, dialogActiveSessionIdResolved]);

  const collectDialogTempImageFilesFromClipboardItems = useCallback((items?: DataTransferItemList | null) => {
    if (!items?.length) return [] as File[];
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (!items[i].type.startsWith('image/')) continue;
      const f = items[i].getAsFile();
      if (f) files.push(f);
    }
    return files;
  }, []);

  const isDialogTempEditableTarget = useCallback((target: EventTarget | null) => {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    if (el.closest('input, textarea, select, [contenteditable="true"]')) return true;
    if ((el as HTMLElement).isContentEditable) return true;
    return false;
  }, []);

  const isDialogTempUploadBlockedTarget = useCallback((target: EventTarget | null) => {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    if (isDialogTempEditableTarget(el)) return true;
    if (el.closest('button, a, label, [role="button"], [role="menuitem"], [data-no-dialog-temp-drop]')) return true;
    return false;
  }, [isDialogTempEditableTarget]);

  const hasDialogTempImageFileTransfer = useCallback((dt: DataTransfer | null | undefined) => {
    if (!dt) return false;
    const hasImageFile = Array.from(dt.files || []).some((f) => f.type?.startsWith('image/'));
    if (hasImageFile) return true;
    return Array.from(dt.items || []).some((item) => item.kind === 'file' && item.type.startsWith('image/'));
  }, []);

  const handleDialogTempLibraryPaste = useCallback((e: React.ClipboardEvent) => {
    const files = collectDialogTempImageFilesFromClipboardItems(e.clipboardData?.items);
    if (!files.length) return;
    e.preventDefault();
    addDialogTempFromFiles(files, '粘贴图片');
  }, [addDialogTempFromFiles, collectDialogTempImageFilesFromClipboardItems]);

  const handleDialogTempLibraryDragOver = useCallback((e: React.DragEvent) => {
    if (!hasDialogTempImageFileTransfer(e.dataTransfer)) return;
    e.preventDefault();
  }, [hasDialogTempImageFileTransfer]);

  const handleDialogTempLibraryDrop = useCallback((e: React.DragEvent) => {
    if (!hasDialogTempImageFileTransfer(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer?.files ?? []).filter(
      (f): f is File => f instanceof File && f.type.startsWith('image/')
    );
    if (!files.length) return;
    addDialogTempFromFiles(files, '拖拽图片');
  }, [addDialogTempFromFiles, hasDialogTempImageFileTransfer]);

  useEffect(() => {
    const onWindowPaste = (e: ClipboardEvent) => {
      if (mode !== AppMode.DIALOG) return;
      if (e.defaultPrevented) return;
      const active = document.activeElement;
      if (active && isDialogTempEditableTarget(active)) return;
      const files = collectDialogTempImageFilesFromClipboardItems(e.clipboardData?.items);
      if (!files.length) return;
      e.preventDefault();
      addDialogTempFromFiles(files, '粘贴图片');
    };

    const onWindowDragOver = (e: DragEvent) => {
      if (mode !== AppMode.DIALOG) return;
      if (isDialogTempUploadBlockedTarget(e.target)) return;
      if (!hasDialogTempImageFileTransfer(e.dataTransfer)) return;
      e.preventDefault();
    };

    const onWindowDrop = (e: DragEvent) => {
      if (mode !== AppMode.DIALOG) return;
      if (e.defaultPrevented) return;
      if (isDialogTempUploadBlockedTarget(e.target)) return;
      if (!hasDialogTempImageFileTransfer(e.dataTransfer)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []).filter(
      (f): f is File => f instanceof File && f.type.startsWith('image/')
    );
      if (!files.length) return;
      addDialogTempFromFiles(files, '拖拽图片');
    };

    window.addEventListener('paste', onWindowPaste);
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('paste', onWindowPaste);
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, [
    addDialogTempFromFiles,
    collectDialogTempImageFilesFromClipboardItems,
    hasDialogTempImageFileTransfer,
    isDialogTempEditableTarget,
    isDialogTempUploadBlockedTarget,
    mode,
  ]);

  const handleDialogTempMarqueeMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('button, input, a, label, img, [role="button"], [data-no-dialog-temp-marquee]')) return;
    dialogTempMarqueeStartRef.current = { x: e.clientX, y: e.clientY };
    dialogTempMarqueeActiveRef.current = true;
    setDialogTempMarqueeRect({ left: e.clientX, top: e.clientY, width: 0, height: 0 });
    e.preventDefault();
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dialogTempMarqueeActiveRef.current || !dialogTempMarqueeStartRef.current) return;
      const start = dialogTempMarqueeStartRef.current;
      const left = Math.min(start.x, e.clientX);
      const top = Math.min(start.y, e.clientY);
      const width = Math.abs(e.clientX - start.x);
      const height = Math.abs(e.clientY - start.y);
      setDialogTempMarqueeRect({ left, top, width, height });
      if (width < 4 && height < 4) return;
      const right = left + width;
      const bottom = top + height;
      const selectedIds: string[] = [];
      for (const item of dialogTempFiltered) {
        const el = dialogTempItemRefs.current[item.id];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const intersects = rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
        if (intersects) selectedIds.push(item.id);
      }
      setDialogTempSelectedIds(new Set(selectedIds));
    };

    const onMouseUp = () => {
      if (!dialogTempMarqueeActiveRef.current) return;
      dialogTempMarqueeActiveRef.current = false;
      dialogTempMarqueeStartRef.current = null;
      setDialogTempMarqueeRect(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dialogTempFiltered, setDialogTempSelectedIds]);

  useEffect(() => {
    setDialogTempPreviewLayout('flat');
    if (!dialogTempPreviewId && !dialogChatImagePreview) {
      setDialogTempPreviewScale(1);
      setDialogTempPreviewOffset({ x: 0, y: 0 });
      dialogTempPreviewDragRef.current = null;
      dialogTempPreviewPanRef.current = null;
      dialogTempPreviewZoomPivotRef.current = null;
      dialogTempPreviewZoomLastScaleRef.current = 1;
      dialogTempPreviewWheelAccumRef.current = 0;
    }
  }, [dialogTempPreviewId, dialogChatImagePreview]);

  useEffect(() => {
    if (!dialogTempPreviewId && !dialogChatImagePreview) return;
    const blockContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    // 捕获阶段全局拦截，尽量避免浏览器插件抢右键菜单。
    window.addEventListener('contextmenu', blockContextMenu, true);
    return () => {
      window.removeEventListener('contextmenu', blockContextMenu, true);
    };
  }, [dialogTempPreviewId, dialogChatImagePreview]);

  /** Esc：document 捕获 + 遮罩 focus，避免焦点在输入框或 CustomDropdown 冒泡拦截时关不掉。 */
  useLayoutEffect(() => {
    if (!dialogTempPreviewId && !dialogChatImagePreview) return;
    const onEscCapture = (e: KeyboardEvent) => {
      if (!isImagePreviewEscapeKey(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeDialogImagePreview();
    };
    document.addEventListener('keydown', onEscCapture, true);
    return () => document.removeEventListener('keydown', onEscCapture, true);
  }, [dialogTempPreviewId, dialogChatImagePreview, closeDialogImagePreview]);

  useLayoutEffect(() => {
    if (!dialogTempPreviewId && !dialogChatImagePreview) return;
    dialogTempPreviewOverlayRef.current?.focus({ preventScroll: true });
  }, [dialogTempPreviewId, dialogChatImagePreview]);

  useEffect(() => {
    if (!dialogTempPreviewId && !dialogChatImagePreview) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        dialogTempPreviewSpacePressedRef.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') dialogTempPreviewSpacePressedRef.current = false;
    };
    const onBlur = () => {
      dialogTempPreviewSpacePressedRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [dialogTempPreviewId, dialogChatImagePreview]);

  useEffect(() => {
    if (!dialogTempPreviewId && !dialogChatImagePreview) return;
    const onWheel = (e: WheelEvent) => {
      const viewerCapturesWheel =
        dialogTempPreviewLayout === 'pano' && previewPolicyForMode('image.equirect').captureGlobalWheel;
      if (viewerCapturesWheel) return;
      const t = e.target;
      if (t instanceof Element && t.closest('[data-no-temp-preview-wheel]')) {
        const scrollEl = t.closest('[data-dialog-temp-preview-scroll]') as HTMLElement | null;
        if (scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight + 1) {
          const st = scrollEl.scrollTop;
          const sh = scrollEl.scrollHeight;
          const ch = scrollEl.clientHeight;
          if ((e.deltaY < 0 && st > 0) || (e.deltaY > 0 && st + ch < sh - 1)) return;
        }
        e.preventDefault();
        return;
      }
      if (!dialogTempPreviewId) return;
      const list = dialogTempFilteredRef.current;
      if (list.length <= 1) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      let dy = e.deltaY;
      const dx = e.deltaX;
      if (Math.abs(dx) > Math.abs(dy)) dy = dx;
      if (e.deltaMode === 1) dy *= 16;
      if (e.deltaMode === 2) dy *= 120;
      if (!dy && typeof (e as unknown as { wheelDelta?: number }).wheelDelta === 'number') {
        dy = -(e as unknown as { wheelDelta: number }).wheelDelta / 3;
      }
      if (Math.abs(dy) < 0.25) return;
      const THRESH = 18;
      const MAX_STEPS_PER_EVENT = 12;
      dialogTempPreviewWheelAccumRef.current += dy;
      let steps = 0;
      while (dialogTempPreviewWheelAccumRef.current >= THRESH && steps < MAX_STEPS_PER_EVENT) {
        dialogTempPreviewWheelAccumRef.current -= THRESH;
        steps += 1;
      }
      while (dialogTempPreviewWheelAccumRef.current <= -THRESH && steps > -MAX_STEPS_PER_EVENT) {
        dialogTempPreviewWheelAccumRef.current += THRESH;
        steps -= 1;
      }
      if (steps === 0) return;
      setDialogTempPreviewId((prev) => {
        if (!prev) return null;
        const cur = dialogTempFilteredRef.current;
        const i = cur.findIndex((x) => x.id === prev);
        if (i < 0) return prev;
        let ni = i;
        const dir = steps > 0 ? 1 : -1;
        for (let k = 0; k < Math.abs(steps); k++) {
          ni = (ni + dir + cur.length) % cur.length;
        }
        return cur[ni].id;
      });
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [dialogTempPreviewId, dialogChatImagePreview, dialogTempPreviewLayout, setDialogTempPreviewId]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dialogTempPreviewDragRef.current;
      if (drag) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        // 右拖/上拖放大，左拖/下拖缩小；支持上下左右四向手势
        const nextScale = Math.max(0.2, Math.min(6, drag.startScale + (dx - dy) * 0.005));
        const prevS = dialogTempPreviewZoomLastScaleRef.current;
        const pivot = dialogTempPreviewZoomPivotRef.current;
        const img = dialogTempPreviewImgRef.current;
        if (img && pivot && Math.abs(nextScale - prevS) > 1e-9) {
          const rect = img.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const f = 1 - nextScale / prevS;
          setDialogTempPreviewOffset((prev) => ({
            x: prev.x + f * (pivot.x - cx),
            y: prev.y + f * (pivot.y - cy),
          }));
          dialogTempPreviewZoomLastScaleRef.current = nextScale;
        } else if (Math.abs(nextScale - prevS) > 1e-9) {
          dialogTempPreviewZoomLastScaleRef.current = nextScale;
        }
        setDialogTempPreviewScale(nextScale);
      }
      const pan = dialogTempPreviewPanRef.current;
      if (pan) {
        const dx = e.clientX - pan.startX;
        const dy = e.clientY - pan.startY;
        setDialogTempPreviewOffset({ x: pan.startOffsetX + dx, y: pan.startOffsetY + dy });
      }
    };
    const onMouseUp = () => {
      dialogTempPreviewDragRef.current = null;
      dialogTempPreviewPanRef.current = null;
      dialogTempPreviewZoomPivotRef.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, callback: (base64: string) => void) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => callback(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleDialogImagesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    const files: File[] = fileList ? Array.from(fileList) : [];
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      e.target.value = '';
      return;
    }
    const room = Math.max(0, DIALOG_INPUT_IMAGES_MAX - dialogInputImages.length);
    const selected = imageFiles.slice(0, room);
    if (selected.length === 0) {
      e.target.value = '';
      return;
    }
    const encoded = await Promise.all(
      selected.map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(ev.target?.result as string);
            reader.onerror = () => reject(new Error(`读取图片失败: ${file.name}`));
            reader.readAsDataURL(file);
          })
      )
    );
    setDialogInputImages((prev) => [
      ...prev,
      ...encoded.map((data) => ({ id: Math.random().toString(36).slice(2, 11), data, fromTemp: false })),
    ]);
    setDialogValidationError(null);
    e.target.value = '';
  };

  const groupedLibrary = useMemo(() => {
    const groups: Record<string, LibraryItem[]> = {};
    library.forEach(item => {
      if (!groups[item.groupId]) groups[item.groupId] = [];
      groups[item.groupId].push(item);
    });
    return Object.values(groups).filter(group => libFilter === 'ALL' || group.some(item => item.category === libFilter));
  }, [library, libFilter]);

  const handleLibSelectAll = () => setLibSelectedGroupIds(new Set(groupedLibrary.map(g => g[0].groupId)));
  const handleLibInvertSelect = () => setLibSelectedGroupIds(new Set(groupedLibrary.filter(g => !libSelectedGroupIds.has(g[0].groupId)).map(g => g[0].groupId)));
  const handleLibBatchDownload = async () => {
    const toDownload = groupedLibrary.filter(g => libSelectedGroupIds.has(g[0].groupId));
    for (let i = 0; i < toDownload.length; i++) {
      const item = toDownload[i][0];
      if (!item.data) continue;
      await triggerImageDownload(item.data, `${item.label || '资产'}_${i + 1}`);
      if (i < toDownload.length - 1) await new Promise(r => setTimeout(r, 300));
    }
  };
  const handleLibDeleteGroup = (groupId: string) => {
    if (!window.confirm('确定删除该组资产？删除后不可恢复。')) return;
    const newLib = library.filter(i => i.groupId !== groupId);
    setLibrary(newLib);
    localStorage.setItem('ac_library', JSON.stringify(newLib.slice(0, 500)));
    setLibSelectedGroupIds(prev => { const n = new Set(prev); n.delete(groupId); return n; });
  };

  /** 根据格式将资产发送到各模块：图片可继续编辑/贴图 */
  const sendLibraryItemToDialog = (item: LibraryItem) => {
    if (!item.data || item.data.includes('data:image/svg+xml')) return;
    if (!DIALOG_PAGE_ENABLED) {
      setIsSidebarOpen(false);
      return;
    }
    setDialogInputImages([{ id: item.id, data: item.data, fromTemp: true }]);
    setMode(AppMode.DIALOG);
    setDialogValidationError(null);
    setIsSidebarOpen(false);
  };
  const sendLibraryItemToTexture = (item: LibraryItem) => {
    if (!item.data || item.data.includes('data:image/svg+xml')) return;
    setTextureSource(item.data);
    setMode(AppMode.TEXTURE);
    setStep(AppStep.T_PATTERN);
    setIsSidebarOpen(false);
  };

  const LibraryCard: React.FC<{
    items: LibraryItem[];
    isSelected: boolean;
    onToggleSelect: () => void;
    onDelete: (groupId: string) => void;
    onSendToDialog?: (item: LibraryItem) => void;
    onSendToTexture?: (item: LibraryItem) => void;
  }> = ({ items, isSelected, onToggleSelect, onDelete, onSendToDialog, onSendToTexture }) => {
    const [activeIdx, setActiveIdx] = useState(0);
    const activeItem = items[activeIdx];
    const groupId = items[0].groupId;
    const is3D = activeItem.category === 'MESH_MODEL' && (activeItem.modelUrls?.length ?? 0) > 0;
    const hasImage = activeItem.data && !activeItem.data.includes('data:image/svg+xml');
    const has3DModelUrl = (activeItem.modelUrls?.length ?? 0) > 0;
    return (
      <div className={`glass p-5 rounded-[2.5rem] border-[#252528] group hover:border-[#3b6fb8] transition-all flex flex-col h-full relative ${isSelected ? 'ring-2 ring-[#3b82f6]' : ''}`}>
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
          <button type="button" onClick={e => { e.stopPropagation(); onToggleSelect(); }} className={`w-5 h-5 rounded border flex items-center justify-center text-[10px] ${isSelected ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#1c1c22] border-[#3a3a40] text-gray-500 hover:bg-[#2e2e36]'}`}>{isSelected ? <AppIcon name="check" className="w-3 h-3" /> : null}</button>
          {is3D && <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-[#3730a3] text-indigo-300 border border-[#6366f1]">3D</span>}
        </div>
        <div className="aspect-square mb-6 bg-[#16161a] rounded-[2rem] overflow-hidden flex items-center justify-center p-4 cursor-pointer relative" onClick={() => setActiveAssetId(activeItem)}>
           <SiteImage src={activeItem.data} className="max-w-full max-h-full object-contain" alt={activeItem.label} />
        </div>
        <div className="flex-1 px-1">
          <div className="text-[10px] font-bold truncate mb-4 uppercase tracking-widest">{activeItem.label}</div>
          {items.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-5 min-h-[24px]">
              {items.map((it, idx) => (
                <button key={it.id} onClick={() => setActiveIdx(idx)} className={`w-8 h-8 rounded-lg flex items-center justify-center text-[7px] font-black border ${activeIdx === idx ? 'bg-blue-600 border-blue-500' : 'bg-white/[0.05] ring-1 ring-white/[0.06] border-transparent'}`}>{it.style?.slice(0,3).toUpperCase() || 'DEF'}</button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {(hasImage || has3DModelUrl) && (
            <div className="mb-2 px-1">
              <div className="text-[8px] font-black uppercase text-gray-500 mb-1.5">发送到</div>
              <div className="flex flex-wrap gap-1.5">
                {hasImage && onSendToDialog && <button onClick={() => onSendToDialog(activeItem)} className="py-1.5 px-2.5 rounded-lg bg-[#1e3558] border border-[#3b6fb8] text-[8px] font-black uppercase hover:bg-[#3868a8] text-blue-300">继续编辑</button>}
                {hasImage && onSendToTexture && <button onClick={() => onSendToTexture(activeItem)} className="py-1.5 px-2.5 rounded-lg bg-[#312e5c] border border-[#6366f1] text-[8px] font-black uppercase hover:bg-[#3d3a70] text-indigo-300">贴图</button>}
              </div>
            </div>
          )}
           <button onClick={() => onDelete(groupId)} className="w-full py-2 text-red-500/20 rounded-xl text-[8px] font-black uppercase hover:text-red-500 mt-2">删除</button>
        </div>
      </div>
    );
  };

  const TextureEngineSection = () => (
    <div className="flex flex-col lg:flex-row gap-8">
      <div className="w-full lg:w-1/3 space-y-6">
        <section className="glass p-6 rounded-[2.5rem] border-[#252528] bg-[#16161a]">
          <div className="flex justify-between items-center mb-6"><h3 className="text-[10px] font-black text-blue-400 uppercase">源贴图输入</h3></div>
          {!textureSource ? (
            <div className="space-y-4">
              <label className="w-full h-64 cursor-pointer group flex flex-col items-center justify-center border-2 border-dashed border-white/[0.12] rounded-3xl hover:bg-[#1a2332] transition-all">
                <AppIcon name="image" className="w-8 h-8 mb-4" />
                <span className="text-[9px] font-black uppercase text-gray-500">上传源图像</span>
                <input type="file" className="hidden" accept="image/*" onChange={e => handleFileUpload(e, setTextureSource)} />
              </label>
              <button onClick={() => openPicker(undefined, (items) => setTextureSource(items[0]?.data ?? ''))} className="w-full py-4 bg-white/[0.05] ring-1 ring-white/[0.06] rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-[#2e2e36] transition-all flex items-center justify-center gap-2">
                <AppIcon name="package" className="w-4 h-4" /> 从资产库导入
              </button>
            </div>
          ) : (
            <div className="relative aspect-square rounded-2xl overflow-hidden ring-1 ring-white/[0.06] group">
              <SiteImage src={textureSource} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-[#16161a] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button onClick={() => setTextureSource('')} className="bg-red-500 px-4 py-2 rounded-full text-[8px] font-black uppercase">移除</button>
              </div>
            </div>
          )}
        </section>
      </div>
      <div className="flex-1 space-y-8 overflow-x-hidden">
        {step === AppStep.T_PATTERN && (
          <div className="flex flex-col gap-8 animate-in fade-in">
            {textureSource ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <RegionSelector src={textureSource} onConfirm={(cropped) => runTextureProcessing(cropped, 'pattern')} onCancel={() => setTextureSource('')} />
                <div className="relative aspect-square glass rounded-[2rem] bg-[#16161a] flex items-center justify-center overflow-hidden">
                  {textureResult ? <SiteImage src={textureResult} className="max-w-full max-h-full object-contain p-8" /> : <span className="text-[10px] font-black uppercase text-gray-700">提取结果待生成</span>}
                  {isTextureProcessing && <div className="absolute inset-0 bg-[#1a1a1e] flex items-center justify-center"><div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}
                </div>
                {lastTextureRecordId && textureResult && (() => {
                  const recordId = lastTextureRecordId;
                  const currentScore = ratingCache[recordId] ?? recordsForRating.find(r => r.id === recordId)?.userScore;
                  return (
                    <div className="flex items-center gap-2 mt-3">
                      <span className="text-[9px] font-black text-gray-500 uppercase">评分</span>
                      {[1, 2, 3, 4, 5].map(score => (
                        <button
                          key={score}
                          type="button"
                          onClick={() => { updateGenerationScore(recordId, score); setRatingCache(prev => ({ ...prev, [recordId]: score })); }}
                          className={`w-7 h-7 rounded border flex items-center justify-center text-[11px] transition-all ${(currentScore ?? 0) >= score ? 'border-[#f59e0b] bg-[#3d3018] text-amber-400' : 'border-[#3a3a40] bg-[#1c1c22] hover:bg-[#3d3018] hover:border-[#d97706] text-gray-500'}`}
                          title={`${score} 星`}
                        ><AppIcon name="star" className="w-3.5 h-3.5" /></button>
                      ))}
                      {currentScore != null && <span className="text-[9px] text-gray-500">{currentScore} 星</span>}
                    </div>
                  );
                })()}
              </div>
            ) : <div className="text-center py-20 text-gray-500 uppercase text-[10px]">请提供源图像输入</div>}
          </div>
        )}
        {step === AppStep.T_TILE && (
          <div className="flex flex-col gap-8 animate-in fade-in">
             <div className="flex gap-4">
                <div className="flex-1 bg-[#1c1c22] p-4 rounded-2xl flex items-center gap-4">
                   <span className="text-[8px] font-black uppercase text-gray-500 whitespace-nowrap">预览密度: {tilingScale}x</span>
                   <input type="range" min="1" max="8" value={tilingScale} onChange={e => setTilingScale(parseInt(e.target.value))} className="flex-1" />
                </div>
                <button onClick={() => runTextureProcessing(textureSource, 'tileable')} disabled={!textureSource} className="px-10 py-4 bg-indigo-600 rounded-full text-[9px] font-black uppercase electric-glow disabled:opacity-20 transition-all">生成循环贴图</button>
             </div>
             <div className="flex-1 glass rounded-[2rem] relative overflow-hidden bg-[#0a0a0a] min-h-[500px]" style={{ backgroundImage: `url(${textureResult || textureSource})`, backgroundRepeat: 'repeat', backgroundSize: `${100 / tilingScale}%` }}>
                {isTextureProcessing && <div className="absolute inset-0 bg-[#1a1a1e] flex items-center justify-center"><div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}
             </div>
          </div>
        )}
      </div>
    </div>
  );

  /** Imagen 风格结构化：从原始句尝试提取 主体/场景/风格/修饰（启发式：逗号分段 + 关键词） */
  const parseStructuredPrompt = (text: string): { subject: string; scene: string; style: string; modifiers: string } => {
    const raw = (text || '').trim();
    const segments = raw.split(',').map(s => s.trim()).filter(Boolean);
    const sceneParts: string[] = [];
    const styleParts: string[] = [];
    const modParts: string[] = [];
    const subjectParts: string[] = [];

    const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
    const isScene = (s: string) =>
      /\b(studio|outdoors?|indoor)\b/i.test(s) ||
      /\s+background\s*$/i.test(s) ||
      /\bon a\s+[\w\s]+\s*background/i.test(s) ||
      /\bin a\s+\w+\s*(?:room|space)\b/i.test(s) ||
      /\bagainst\s+.+/i.test(s);
    // 风格：短段或明显以风格短语为主；长段含 three-view/orthographic 仍归主体
    const isStyle = (s: string) => {
      if (wordCount(s) > 10) return false;
      return /\b(?:in the style of|A photo of|A painting of|a \w+ (?:photo|painting|image) of)\s/i.test(s) ||
        /\b(concept art|cinematic\s+concept art|game asset\s+model sheet)\b/i.test(s) ||
        (wordCount(s) <= 6 && /\b(professional\s+3D\s+game\s+asset\s+model\s+sheet|model\s+sheet)\b/i.test(s)) ||
        (wordCount(s) <= 5 && /\b(PBR|photorealistic)\s+(materials?|texture|look)\b/i.test(s)) ||
        (wordCount(s) <= 4 && /\b(orthographic|three-view|PBR|photorealistic)\b/i.test(s)) ||
        /\b(impressionist|minimalist|stencil)\b/i.test(s);
    };
    const isModifier = (s: string) =>
      wordCount(s) <= 5 && /\b(close-up|aerial|natural lighting|golden hour|soft light|4k|HDR|high-definition|sharp|detailed|high quality|photorealistic|PBR\s*materials?)\b/i.test(s);

    for (const seg of segments) {
      if (isScene(seg)) sceneParts.push(seg);
      else if (isStyle(seg)) styleParts.push(seg);
      else if (isModifier(seg)) modParts.push(seg);
      else subjectParts.push(seg);
    }

    // 若无分段或整句才匹配到的模式：退回到整句正则（兼容旧提示词）
    if (segments.length <= 1) {
      const styleMatch = raw.match(/\b(?:in the style of|A photo of|A painting of)\s*([^.;]+?)(?:\.|;|,|$)/i)
        || raw.match(/([^.;]+?(?:concept art|cinematic|PBR|photorealistic|game asset|model sheet)[^.;]*)/i);
      if (styleMatch && !styleParts.length) {
        styleParts.push(styleMatch[1].trim());
        const rest = raw.replace(styleMatch[0], '').trim();
        if (rest && !subjectParts.length) subjectParts.push(rest);
      }
      const sceneMatch = raw.match(/\b(studio|outdoors?|indoor|[\w\s]+\s+background)\b/gi);
      if (sceneMatch && !sceneParts.length) sceneParts.push(...[...new Set(sceneMatch)].map(s => s.trim()));
    }

    const subject = subjectParts.length ? subjectParts.join(', ') : raw;
    return {
      subject: subject || '—',
      scene: sceneParts.length ? sceneParts.join(', ') : '—',
      style: styleParts.length ? styleParts.join(', ') : '—',
      modifiers: modParts.length ? modParts.join(', ') : '—',
    };
  };

  /** 从结构化字段生成参数化模板（占位符便于复现） */
  const toParameterizedTemplate = (instruction: string, structured: { subject: string; scene: string; style: string; modifiers: string }): string => {
    if (!instruction?.trim()) return 'A {subject} on a solid color background. {modifiers}';
    let t = instruction.trim();
    if (structured.style !== '—') t = t.replace(structured.style, '{style}');
    if (structured.scene !== '—') t = t.replace(structured.scene, '{scene}');
    if (structured.modifiers !== '—') t = t.replace(structured.modifiers, '{modifiers}');
    if (structured.subject !== '—' && structured.subject !== instruction.trim()) t = t.replace(structured.subject, '{subject}');
    if (!t.includes('{')) t = `${t.replace(/(.+)/, 'A {subject}: $1')}`;
    return t || 'A {subject} in {style}. {modifiers}';
  };

  /** 将单条记录格式化为结构化复现文本（Imagen 建议写法 + 参数化模板）；可选传入已解析的 structured（如 LLM 结果） */
  const formatRecordForRepro = (r: GenerationRecord, structuredOverride?: { subject: string; scene: string; style: string; modifiers: string }): string => {
    const mainText = r.instruction ?? r.fullPrompt ?? '';
    const structured = structuredOverride ?? parseStructuredPrompt(mainText);
    const template = toParameterizedTemplate(mainText, structured);
    const lines: string[] = [];
    const dateStr = new Date(r.timestamp).toLocaleString();
    lines.push(`## ${r.source === 'dialog' ? '对话' : '提取花纹'} · ${dateStr}`);
    lines.push('');
    lines.push('### 结构化提示词（Imagen 建议写法）');
    lines.push('- **主体**（要画的对象/人/场景）：' + structured.subject);
    lines.push('- **场景/背景**（studio、outdoors、in the style of...）：' + structured.scene);
    lines.push('- **风格**（A photo of... / in the style of...）：' + structured.style);
    lines.push('- **可选修饰**（镜头感、光线、画质词）：' + structured.modifiers);
    lines.push('');
    lines.push('### 参数化模板（占位符组句，便于复现）');
    lines.push('```');
    lines.push(template);
    lines.push('```');
    lines.push('');
    if (r.source === 'dialog') {
      if (r.model) lines.push('- **模型**: ' + r.model);
      if (r.options?.aspectRatio || r.options?.imageSize) lines.push('- **比例/尺寸**: ' + (r.options.aspectRatio ?? '-') + ' / ' + (r.options.imageSize ?? '-'));
      if (r.userPrompt) lines.push('- **用户输入**: ' + r.userPrompt);
    } else {
      if (r.model) lines.push('- **模型**: ' + r.model);
      if (r.textureType) lines.push('- **类型**: ' + r.textureType + (r.textureMapType ? ' / ' + r.textureMapType : ''));
    }
    lines.push('');
    lines.push('### 原始完整句');
    lines.push('```');
    lines.push(r.fullPrompt.replace(/\n/g, '\n  '));
    lines.push('```');
    if (r.userScore != null) lines.push('- **评分**: ' + r.userScore + ' 星');
    lines.push('');
    lines.push('---');
    return lines.join('\n');
  };

  /** 单条记录的结构化 JSON（便于代码中转成自然语言）；可选传入已解析的 structured（如 LLM 结果） */
  const recordToStructuredJson = (r: GenerationRecord, structuredOverride?: { subject: string; scene: string; style: string; modifiers: string }): { subject: string; scene: string; style: string; modifiers: string; template: string; raw: string; meta?: Record<string, unknown> } => {
    const mainText = r.instruction ?? r.fullPrompt ?? '';
    const structured = structuredOverride ?? parseStructuredPrompt(mainText);
    const template = toParameterizedTemplate(mainText, structured);
    return {
      subject: structured.subject,
      scene: structured.scene,
      style: structured.style,
      modifiers: structured.modifiers,
      template,
      raw: r.fullPrompt,
      meta: r.source === 'dialog' ? { model: r.model, aspectRatio: r.options?.aspectRatio, imageSize: r.options?.imageSize, userPrompt: r.userPrompt } : { model: r.model, textureType: r.textureType, textureMapType: r.textureMapType }
    };
  };

  /** 只读分析页：生成记录列表、筛选、聚合统计、导出 JSON/CSV、结构化复现 */
  const GenerationRecordsAnalysis = () => {
    const records = loadRecords();
    const [filterSource, setFilterSource] = useState<'all' | 'dialog' | 'texture'>('all');
    const [filterRated, setFilterRated] = useState<'all' | 'yes' | 'no'>('all');
    const [viewMode, setViewMode] = useState<'list' | 'repro'>('list');
    const [llmStructuredCache, setLlmStructuredCache] = useState<Record<string, { subject: string; scene: string; style: string; modifiers: string }>>({});
    const [llmStructuredLoading, setLlmStructuredLoading] = useState<Record<string, boolean>>({});
    const [llmStructuredError, setLlmStructuredError] = useState<Record<string, string>>({});
    let filtered = records;
    if (filterSource !== 'all') filtered = filtered.filter(r => r.source === filterSource);
    if (filterRated === 'yes') filtered = filtered.filter(r => r.userScore != null);
    if (filterRated === 'no') filtered = filtered.filter(r => r.userScore == null);

    const bySource = React.useMemo<Record<string, SourceAggregate>>(() => {
      const map: Record<string, SourceAggregate> = {};
      for (const r of records) {
        const key = r.source === 'texture' && r.textureType ? `${r.source}:${r.textureType}` : r.source;
        if (!map[key]) map[key] = { count: 0, rated: 0, sumScore: 0, samples: [] };
        map[key].count++;
        if (r.userScore != null) {
          map[key].rated++;
          map[key].sumScore += r.userScore;
          if (r.userScore >= 4) map[key].samples.push({ fullPrompt: r.fullPrompt.slice(0, 120) + (r.fullPrompt.length > 120 ? '…' : ''), instruction: r.instruction?.slice(0, 80), userScore: r.userScore });
        }
      }
      return map;
    }, [records]);

    const exportJson = () => {
      const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ac_generation_records_${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href);
    };
    const exportStructuredJson = () => {
      const structured = filtered.map(r => recordToStructuredJson(r, llmStructuredCache[r.id]));
      const blob = new Blob([JSON.stringify(structured, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ac_prompts_structured_${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href);
    };
    const exportCsv = () => {
      const headers = ['id', 'source', 'timestamp', 'userScore', 'textureType', 'instruction', 'fullPrompt'];
      const rows = filtered.map(r => [r.id, r.source, r.timestamp, r.userScore ?? '', r.textureType ?? '', (r.instruction ?? '').replace(/"/g, '""'), (r.fullPrompt ?? '').slice(0, 200).replace(/"/g, '""')].map(c => `"${c}"`).join(','));
      const blob = new Blob(['\uFEFF' + [headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ac_generation_records_${Date.now()}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };

    return (
      <div className="space-y-8">
        <section className="glass p-6 rounded-[2.5rem] border-[#252528]">
          <h3 className="text-[10px] font-black text-blue-400 uppercase mb-4">筛选与导出</h3>
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <button type="button" onClick={() => setMode(AppMode.ARENA)} className="px-4 py-2 rounded-xl bg-[#3d2a10] border border-[#b45309] text-[9px] font-black uppercase text-amber-400 hover:bg-[#92400e] transition-all">去对比测试</button>
            <span className="text-[9px] font-black text-gray-500 uppercase">来源</span>
            <select value={filterSource} onChange={e => setFilterSource(e.target.value as any)} className="bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl px-3 py-2 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 transition-colors">
              <option value="all">全部</option>
              <option value="dialog">对话</option>
              <option value="texture">提取花纹</option>
            </select>
            <span className="text-[9px] font-black text-gray-500 uppercase ml-4">评分</span>
            <select value={filterRated} onChange={e => setFilterRated(e.target.value as any)} className="bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl px-3 py-2 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 transition-colors">
              <option value="all">全部</option>
              <option value="yes">已评分</option>
              <option value="no">未评分</option>
            </select>
            <button onClick={exportJson} className="px-4 py-2 bg-[#1e3558] border border-[#4b6a9e] rounded-xl text-[9px] font-black uppercase text-blue-400 hover:bg-[#305a90] transition-all">导出 JSON</button>
            <button onClick={exportStructuredJson} className="px-4 py-2 bg-[#3d2a10] border border-[#b45309] rounded-xl text-[9px] font-black uppercase text-amber-400 hover:bg-[#92400e] transition-all" title="主体/场景/风格/修饰/参数化模板，便于代码转自然语言">导出结构化 JSON</button>
            <button onClick={exportCsv} className="px-4 py-2 bg-[#1e3558] border border-[#4b6a9e] rounded-xl text-[9px] font-black uppercase text-blue-400 hover:bg-[#305a90] transition-all">导出 CSV</button>
            <span className="text-[9px] font-black text-gray-500 uppercase ml-4">显示</span>
            <button onClick={() => setViewMode('list')} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border transition-all ${viewMode === 'list' ? 'bg-[#1e3558] text-blue-400 border-[#4b6a9e]' : 'bg-white/[0.05] ring-1 ring-white/[0.06] hover:bg-white/[0.09] border-transparent'}`}>列表</button>
            <button onClick={() => setViewMode('repro')} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border transition-all ${viewMode === 'repro' ? 'bg-[#1e3558] text-blue-400 border-[#4b6a9e]' : 'bg-white/[0.05] ring-1 ring-white/[0.06] hover:bg-white/[0.09] border-transparent'}`}>复现模板</button>
          </div>
          <p className="text-[9px] text-gray-500">共 {filtered.length} 条（最近 500 条），仅读分析用，不改动提示词或配置。</p>
        </section>
        <section className="glass p-6 rounded-[2.5rem] border-[#252528]">
          <h3 className="text-[10px] font-black text-blue-400 uppercase mb-4">按来源聚合</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(Object.entries(bySource) as [string, SourceAggregate][]).map(([key, agg]) => (
              <div key={key} className="bg-[#16161a] rounded-xl p-4 ring-1 ring-white/[0.06]">
                <div className="text-[10px] font-black uppercase text-blue-400 mb-2">{key}</div>
                <div className="text-[9px] text-gray-400 space-y-1">条数 {agg.count} · 已评 {agg.rated} · 平均分 {agg.rated ? (agg.sumScore / agg.rated).toFixed(1) : '-'}</div>
                {agg.samples.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <div className="text-[8px] font-black text-gray-500 uppercase">高分样本（≥4 星）</div>
                    {agg.samples.slice(0, 3).map((s, i) => (
                      <div key={i} className="text-[9px] text-gray-300 bg-[#1c1c22] rounded-lg p-2 border border-[#252528]">
                        <span className="text-amber-400">{s.userScore} 星</span> {s.instruction ?? s.fullPrompt}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="glass p-6 rounded-[2.5rem] border-[#252528]">
          <h3 className="text-[10px] font-black text-blue-400 uppercase mb-4">{viewMode === 'repro' ? '结构化复现模板' : '记录列表'}</h3>
          {viewMode === 'list' ? (
            <>
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <table className="w-full text-left text-[9px]">
                  <thead className="sticky top-0 bg-[#1e1e22] border-b border-white/[0.06]">
                    <tr>
                      <th className="py-2 px-2">时间</th>
                      <th className="py-2 px-2">来源</th>
                      <th className="py-2 px-2">评分</th>
                      <th className="py-2 px-2 max-w-[200px]">instruction / fullPrompt 片段</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 100).map(r => (
                      <tr key={r.id} className="border-b border-[#252528] hover:bg-[#222228]">
                        <td className="py-2 px-2 text-gray-400">{new Date(r.timestamp).toLocaleString()}</td>
                        <td className="py-2 px-2">{r.source}{r.textureType ? `:${r.textureType}` : ''}</td>
                        <td className="py-2 px-2">{r.userScore != null ? `${r.userScore} 星` : '-'}</td>
                        <td className="py-2 px-2 max-w-[200px] truncate" title={r.fullPrompt}>{r.instruction ?? r.fullPrompt?.slice(0, 80)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length > 100 && <p className="text-[9px] text-gray-500 mt-2">仅展示前 100 条，导出可获完整数据。</p>}
            </>
          ) : (
            <div className="space-y-6 max-h-[70vh] overflow-y-auto">
              <p className="text-[9px] text-gray-500">按 Imagen 建议写法展示：主体、场景/背景、风格、可选修饰；默认用本地启发式解析，可点「用 LLM 解析」获得更准的结构化结果。</p>
              {filtered.slice(0, 50).map(r => {
                const mainText = r.instruction ?? r.fullPrompt ?? '';
                const structured = llmStructuredCache[r.id] ?? parseStructuredPrompt(mainText);
                const template = toParameterizedTemplate(mainText, structured);
                const fullText = formatRecordForRepro(r, structured);
                const jsonStr = JSON.stringify(recordToStructuredJson(r, structured), null, 2);
                const loading = llmStructuredLoading[r.id];
                const err = llmStructuredError[r.id];
                const hasLlm = !!llmStructuredCache[r.id];
                const runLlmParse = async () => {
                  if (!mainText.trim()) return;
                  setLlmStructuredLoading(prev => ({ ...prev, [r.id]: true }));
                  setLlmStructuredError(prev => ({ ...prev, [r.id]: '' }));
                  try {
                    const result = await parsePromptStructured(mainText);
                    const normalized = { subject: result.subject || '—', scene: result.scene || '—', style: result.style || '—', modifiers: result.modifiers || '—' };
                    setLlmStructuredCache(prev => ({ ...prev, [r.id]: normalized }));
                  } catch (e) {
                    setLlmStructuredError(prev => ({ ...prev, [r.id]: normalizeApiErrorMessage(e) }));
                  } finally {
                    setLlmStructuredLoading(prev => ({ ...prev, [r.id]: false }));
                  }
                };
                return (
                  <div key={r.id} className="bg-[#16161a] rounded-xl ring-1 ring-white/[0.06] overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-[#1c1c22] flex-wrap gap-2">
                      <span className="text-[9px] font-black text-blue-400 uppercase">
                        {r.source === 'dialog' ? '对话' : `贴图 · ${r.textureType ?? '-'}`}
                        {r.userScore != null && <span className="text-amber-400 ml-2">{r.userScore} 星</span>}
                        {hasLlm && <span className="text-emerald-400 ml-2">LLM</span>}
                      </span>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={runLlmParse} disabled={loading} className="px-3 py-1.5 rounded-lg bg-[#14532d] border border-[#34d399] text-[9px] font-black uppercase text-emerald-400 hover:bg-[#166534] transition-all disabled:opacity-50" title="用大模型解析主体/场景/风格/修饰">{loading ? '解析中…' : '用 LLM 解析'}</button>
                        <button type="button" onClick={() => navigator.clipboard.writeText(template)} className="px-3 py-1.5 rounded-lg bg-[#3d2a10] border border-[#b45309] text-[9px] font-black uppercase text-amber-400 hover:bg-[#92400e] transition-all" title="复制参数化模板">复制模板</button>
                        <button type="button" onClick={() => navigator.clipboard.writeText(jsonStr)} className="px-3 py-1.5 rounded-lg bg-[#26262c] border border-[#3a3a40] text-[9px] font-black uppercase hover:bg-[#383842] transition-all" title="复制结构化 JSON">复制 JSON</button>
                        <button type="button" onClick={() => navigator.clipboard.writeText(fullText)} className="px-3 py-1.5 rounded-lg bg-[#1e3558] border border-[#4b6a9e] text-[9px] font-black uppercase text-blue-400 hover:bg-[#305a90] transition-all">复制本条</button>
                      </div>
                    </div>
                    {err && <div className="px-4 py-1.5 bg-[#5c2020] border-b border-[#b85a5a] text-[10px] text-red-300">{err}</div>}
                    <div className="p-4 space-y-4">
                      <div>
                        <div className="text-[8px] font-black text-gray-500 uppercase mb-2">结构化提示词（Imagen 建议写法）</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                          <div className="bg-[#1c1c22] rounded-lg p-2 border border-[#252528]"><span className="text-gray-500">主体：</span><span className="text-gray-300">{structured.subject || '—'}</span></div>
                          <div className="bg-[#1c1c22] rounded-lg p-2 border border-[#252528]"><span className="text-gray-500">场景/背景：</span><span className="text-gray-300">{structured.scene || '—'}</span></div>
                          <div className="bg-[#1c1c22] rounded-lg p-2 border border-[#252528]"><span className="text-gray-500">风格：</span><span className="text-gray-300">{structured.style || '—'}</span></div>
                          <div className="bg-[#1c1c22] rounded-lg p-2 border border-[#252528]"><span className="text-gray-500">可选修饰：</span><span className="text-gray-300">{structured.modifiers || '—'}</span></div>
                        </div>
                      </div>
                      <div>
                        <div className="text-[8px] font-black text-gray-500 uppercase mb-2">参数化模板（占位符组句，便于复现）</div>
                        <pre className="p-3 rounded-lg bg-[#16161a] ring-1 ring-white/[0.06] text-[10px] text-amber-200/90 font-mono whitespace-pre-wrap break-all">{template}</pre>
                        <p className="text-[8px] text-gray-500 mt-1">在代码中用占位符替换后生成自然语言，再发给模型。</p>
                      </div>
                      <details className="group">
                        <summary className="text-[9px] font-black text-gray-500 uppercase cursor-pointer hover:text-gray-400">原始完整句</summary>
                        <pre className="mt-2 p-3 rounded-lg bg-[#16161a] border border-[#252528] text-[9px] text-gray-400 whitespace-pre-wrap overflow-x-auto max-h-32">{r.fullPrompt}</pre>
                      </details>
                    </div>
                  </div>
                );
              })}
              {filtered.length > 50 && <p className="text-[9px] text-gray-500">仅展示前 50 条，导出 JSON/CSV 可获完整数据。</p>}
            </div>
          )}
        </section>
      </div>
    );
  };

  const showWorkspaceIdbHydrateOverlay =
    mode === AppMode.WORKFLOW && typeof indexedDB !== 'undefined' && !workspaceLocalIdbHydrateReady;

  return (
    <div className="min-h-[100dvh] bg-[#050505] text-white flex flex-col lg:flex-row relative isolate font-sans overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 min-h-[100dvh] overflow-hidden" aria-hidden>
        <Waves
          backgroundColor="#050505"
          lineColor="rgba(148, 163, 184, 0.11)"
          lineWidth={1.2}
          softBlurPx={1.4}
          xGap={14}
          yGap={38}
          waveAmpX={26}
          waveAmpY={13}
        />
      </div>
      <AssetViewer item={activeAssetId} onClose={() => setActiveAssetId(null)} />
      {isLibraryPickerOpen && <LibraryPickerModal library={library} filter={pickerFilter} multiSelect={pickerMultiSelect} onSelect={(items) => { pickerCallback(items); setIsLibraryPickerOpen(false); }} onClose={() => setIsLibraryPickerOpen(false)} />}
      {apiKeyModalOpen && (
        <WorkflowApiKeyModal
          open={apiKeyModalOpen}
          onClose={() => setApiKeyModalOpen(false)}
          onSaved={() => setAiInvocationStatusRev((n) => n + 1)}
        />
      )}

      <div
        className={`fixed left-3 top-4 bottom-4 z-[1001] w-14 flex flex-col transition-all ${isSidebarOpen ? 'opacity-100' : 'opacity-100'}`}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar p-2">
          <div className="flex flex-col items-center gap-2">
            {user ? (
              <div className="w-full">
                <CustomDropdown
                  triggerAriaLabel="账户菜单"
                  options={[
                    { value: 'manage', label: '管理账户' },
                    { value: 'switch', label: '切换用户' },
                    { value: 'logout', label: '退出登录' },
                  ]}
                  value=""
                  placeholder=""
                  onChange={(value) => {
                    void handleUserMenuAction(value);
                  }}
                  renderTrigger={({ open }) => (
                    <span className="relative inline-flex">
                      <SidebarAccountAvatar user={user} prefs={userUiPrefs} />
                      <span className="pointer-events-none absolute -right-0.5 -bottom-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full border border-[#3a3a40] bg-[#16161a] px-[2px] text-[6px] font-black leading-none text-gray-500">
                        {open ? '▲' : '▼'}
                      </span>
                    </span>
                  )}
                  triggerClassName="w-full h-10 rounded-xl bg-white/[0.05] ring-1 ring-white/[0.06] p-0 flex items-center justify-center outline-none focus-visible:ring-blue-500/50 hover:bg-white/[0.09] transition-colors"
                  portalZIndex={{ backdrop: 1100, list: 1101 }}
                />
              </div>
            ) : null}

            <SidebarIconButton active={mode === AppMode.WORKFLOW} label="工作区" onClick={() => { setMode(AppMode.WORKFLOW); setIsSidebarOpen(false); }}>
              <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><path d="M3.5 8.5L10 3.5l6.5 5v8H3.5v-8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M8 16.5v-4h4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </SidebarIconButton>
            {DIALOG_PAGE_ENABLED ? (
              <SidebarIconButton active={mode === AppMode.DIALOG} label="对话" onClick={() => { setMode(AppMode.DIALOG); setIsSidebarOpen(false); }}>
                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><path d="M4 5.5h12v8H9l-3.5 3v-3H4v-8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
              </SidebarIconButton>
            ) : null}
            <SidebarIconButton active={mode === AppMode.SETTINGS} label="设置" onClick={() => { setMode(AppMode.SETTINGS); setIsSidebarOpen(false); }}>
              <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6"/><path d="M10 3v2.1M10 14.9V17M17 10h-2.1M5.1 10H3M14.9 5.1l-1.5 1.5M6.6 13.4l-1.5 1.5M14.9 14.9l-1.5-1.5M6.6 6.6 5.1 5.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </SidebarIconButton>

            <button
              type="button"
              onClick={() => setExperimentalNavExpanded((e) => !e)}
              className={`group relative flex h-10 w-full cursor-pointer items-center justify-center rounded-xl outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-blue-500/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505] ${
                isExperimentalMode(mode) && !experimentalNavExpanded
                  ? 'bg-[#152a4a] text-blue-200 ring-1 ring-blue-500/40'
                  : 'text-gray-400 ring-1 ring-transparent hover:bg-white/[0.06] hover:ring-white/[0.06]'
              }`}
              aria-label="实验性功能"
              aria-expanded={experimentalNavExpanded}
            >
              <svg viewBox="0 0 20 20" className="w-4 h-4 shrink-0" fill="none" aria-hidden>
                <path
                  d="M8 3.5h4M9 3.5v4.2l-4.1 6.6a2 2 0 0 0 1.7 3h6.8a2 2 0 0 0 1.7-3L11 7.7V3.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M6.8 12.5h6.4" stroke="currentColor" strokeWidth="1.4" />
              </svg>
              <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 rounded-lg bg-[#0c0c0f] px-2 py-1 text-[10px] text-gray-200 ring-1 ring-white/[0.12] shadow-md whitespace-nowrap opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 motion-reduce:transition-none">
                实验性功能
              </span>
            </button>
          </div>

          {experimentalNavExpanded && (
            <div className="mt-2 flex flex-col gap-2 pt-2">
              <SidebarIconButton active={mode === AppMode.TEXTURE} label="提取花纹" onClick={() => { setMode(AppMode.TEXTURE); setStep(AppStep.T_PATTERN); setIsSidebarOpen(false); }}>
                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><rect x="3.5" y="4" width="13" height="12" rx="1.8" stroke="currentColor" strokeWidth="1.6"/><path d="M6 12l2.2-2.2 2.2 2.2 1.8-1.8L14 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </SidebarIconButton>
              <SidebarIconButton active={mode === AppMode.SEAM_REPAIR} label="贴图修缝" onClick={() => { setMode(AppMode.SEAM_REPAIR); setIsSidebarOpen(false); }}>
                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><path d="M4 6h5l2 2h5v6H4V6Z" stroke="currentColor" strokeWidth="1.6"/><path d="M8.2 8.2l3.6 3.6M11.8 8.2l-3.6 3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              </SidebarIconButton>
              <SidebarIconButton active={mode === AppMode.PBR_TEXTURE} label="生成贴图" onClick={() => { setMode(AppMode.PBR_TEXTURE); setIsSidebarOpen(false); }}>
                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><circle cx="10" cy="10" r="6.2" stroke="currentColor" strokeWidth="1.6"/><path d="M10 3.8v12.4M3.8 10h12.4" stroke="currentColor" strokeWidth="1.2"/></svg>
              </SidebarIconButton>
              <SidebarIconButton active={mode === AppMode.ADMIN} label="提示词效果" onClick={() => { setMode(AppMode.ADMIN); setIsSidebarOpen(false); }}>
                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><path d="M4 14.5V11m4 3.5V8.5M12 14.5V6m4 8.5V9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              </SidebarIconButton>
              <SidebarIconButton active={mode === AppMode.ARENA} label="提示词擂台" onClick={() => { setMode(AppMode.ARENA); setIsSidebarOpen(false); }}>
                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><path d="M6 5.5h8l-1.2 2.6L15 10l-5 6-5-6 2.2-1.9L6 5.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
              </SidebarIconButton>
            </div>
          )}
          </div>
          {mode === AppMode.WORKFLOW && activeWorkspaceProjectId ? (
            <WorkspaceSidebarFooter
              user={user}
              activeWorkspaceProjectId={activeWorkspaceProjectId}
              onOpenApiKeyModal={() => setApiKeyModalOpen(true)}
              aiInvocationReady={aiInvocationReady}
              aiPlatformLabel={aiProviderToolbarLabel}
            />
          ) : null}
        </div>
      </div>

      <Suspense fallback={null}>
        <SiteAssistant tasks={tasks} onRemoveTask={id => setTasks(p => p.filter(t => t.id !== id))} />
      </Suspense>

      {/* 全局日志：悬浮图标（位于网页助手上方）+ 可开关面板 */}
      <div className={`fixed ${RIGHT_DOCK_LOG_BOTTOM} ${RIGHT_DOCK_RIGHT} z-[2001] flex items-center justify-center`}>
        <button
          type="button"
          onClick={() => setGlobalLogOpen(v => !v)}
          className={`relative w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 motion-reduce:transition-none ${
            globalLogOpen
              ? 'bg-[#1a3354] ring-2 ring-blue-500/45 text-blue-200'
              : 'bg-[#16161a] ring-1 ring-white/[0.1] text-gray-200 hover:bg-[#1f1f24] hover:ring-blue-500/35'
          }`}
          title={globalLogOpen ? '关闭日志' : '打开日志'}
          aria-label={globalLogOpen ? '关闭日志' : '打开日志'}
        >
          <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none" aria-hidden>
            <rect x="4" y="3.5" width="12" height="13" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {globalLogs.length > 0 ? (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[9px] leading-[18px] text-center border border-[#0f0f10]">
              {Math.min(globalLogs.length, 99)}
            </span>
          ) : null}
        </button>
      </div>

      {globalLogOpen && (
        <div
          className={`fixed ${RIGHT_DOCK_LOG_PANEL_BOTTOM} ${RIGHT_DOCK_RIGHT} z-[2000] w-[min(420px,calc(100vw-3rem))] max-h-[min(56vh,420px)] rounded-2xl bg-[#0f0f0f] ring-1 ring-white/[0.1] shadow-2xl overflow-hidden motion-reduce:shadow-none`}
          role="dialog"
          aria-label="全局日志"
        >
          <div className="px-4 py-3 border-b border-white/[0.06] bg-[#141416] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-white">运行日志</span>
              <span className="text-[10px] text-gray-500">最近 {globalLogs.length} 条</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setGlobalLogs([])}
                className="px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 text-[10px] text-gray-300 hover:bg-white/10 transition-colors"
              >
                清空
              </button>
              <button
                type="button"
                onClick={() => setGlobalLogOpen(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-[#2e2e36] transition-colors"
                aria-label="关闭日志"
              >
                <AppIcon name="close" className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="p-3 overflow-y-auto max-h-[min(48vh,340px)] no-scrollbar">
            {tripoRecoveryContext ? (
              <div className="mb-2 rounded-xl border border-amber-500/30 bg-amber-900/15 px-3 py-2">
                <div className="text-[10px] font-black uppercase text-amber-200">Tripo 失败恢复</div>
                <div className="mt-1 text-[10px] text-amber-100/90 leading-relaxed break-all">
                  {tripoRecoveryContext.lastError}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!tripoRecoveryContext.canResumeOldTask || tripoRecoveryActionRunning != null}
                    onClick={async () => {
                      const preset = capabilityPresets.find((p) => p.id === tripoRecoveryContext.presetId);
                      if (!preset) {
                        addGenerate3DLog('warn', '[工作流] 恢复失败：未找到对应 Tripo 预设');
                        return;
                      }
                      setTripoRecoveryActionRunning('resume');
                      try {
                        await handleAddGenerate3DJobFromWorkflow(
                          preset,
                          tripoRecoveryContext.imageBase64,
                          tripoRecoveryContext.task,
                          { forceNewTask: false }
                        );
                      } finally {
                        setTripoRecoveryActionRunning(null);
                      }
                    }}
                    className="py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-900/20 text-[9px] font-black uppercase text-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-900/35"
                  >
                    继续查旧任务（不计费）
                  </button>
                  <button
                    type="button"
                    disabled={tripoRecoveryActionRunning != null}
                    onClick={async () => {
                      const preset = capabilityPresets.find((p) => p.id === tripoRecoveryContext.presetId);
                      if (!preset) {
                        addGenerate3DLog('warn', '[工作流] 重提失败：未找到对应 Tripo 预设');
                        return;
                      }
                      setTripoRecoveryActionRunning('new');
                      try {
                        await handleAddGenerate3DJobFromWorkflow(
                          preset,
                          tripoRecoveryContext.imageBase64,
                          tripoRecoveryContext.task,
                          { forceNewTask: true }
                        );
                      } finally {
                        setTripoRecoveryActionRunning(null);
                      }
                    }}
                    className="py-1.5 rounded-lg border border-red-500/40 bg-red-900/20 text-[9px] font-black uppercase text-red-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-900/35"
                  >
                    重新提交新任务（可能计费）
                  </button>
                </div>
              </div>
            ) : null}
            {globalLogs.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-6 text-center text-[11px] text-gray-500">
                暂无日志
              </div>
            ) : (
              <div className="space-y-2">
                {[...globalLogs].reverse().map((log) => (
                  <button
                    key={log.id}
                    type="button"
                    onClick={async () => {
                      const line = `[${new Date(log.time).toLocaleString()}] [${log.level.toUpperCase()}] [${log.module}] ${log.message}${log.detail ? `\n${log.detail}` : ''}`;
                      try {
                        await navigator.clipboard.writeText(line);
                        setGlobalLogCopiedId(log.id);
                        window.setTimeout(() => {
                          setGlobalLogCopiedId((prev) => (prev === log.id ? null : prev));
                        }, 1200);
                      } catch {
                        /* ignore clipboard permission issues */
                      }
                    }}
                    className="w-full text-left rounded-xl ring-1 ring-white/[0.06] bg-[#141416] px-3 py-2.5 hover:bg-[#1a1a20] transition-colors"
                    title="点击复制日志"
                    aria-label="点击复制日志"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-gray-400">{new Date(log.time).toLocaleTimeString()}</span>
                      <div className="flex items-center gap-1.5">
                        {globalLogCopiedId === log.id ? (
                          <span className="text-[9px] text-emerald-300">已复制</span>
                        ) : null}
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border ${
                            log.level === 'error'
                              ? 'text-red-300 border-red-500/40 bg-red-900/20'
                              : log.level === 'warn'
                              ? 'text-amber-300 border-amber-500/40 bg-amber-900/20'
                              : 'text-blue-300 border-blue-500/40 bg-blue-900/20'
                          }`}
                        >
                          {log.level.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] text-white/90 leading-relaxed">[{log.module}] {log.message}</div>
                    {log.detail ? (
                      <div className="mt-1 text-[10px] text-gray-400 leading-relaxed break-all">{log.detail}</div>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {workspaceTrashDialog?.open && (
        <div
          className="fixed inset-0 z-[2200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => workspaceTrashDialog.restoringTrashId == null && setWorkspaceTrashDialog(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0e0e14]/95 backdrop-blur-md shadow-2xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[12px] font-black uppercase tracking-wide text-blue-300">项目回收站</h3>
              <button
                type="button"
                disabled={workspaceTrashDialog.restoringTrashId != null}
                onClick={() => setWorkspaceTrashDialog(null)}
                className="w-8 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-[#2e2e36] disabled:opacity-50"
                aria-label="关闭"
              >
                <AppIcon name="close" className="w-4 h-4" />
              </button>
            </div>
            {workspaceTrashDialog.loading ? (
              <div className="text-[11px] text-gray-400">正在加载回收站…</div>
            ) : workspaceTrashDialog.items.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[11px] text-gray-400">
                回收站为空。
              </div>
            ) : (
              <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-white/10">
                {workspaceTrashDialog.items.map((item) => {
                  const restoring = workspaceTrashDialog.restoringTrashId === item.trashId;
                  return (
                    <div
                      key={item.trashId}
                      className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="text-[12px] text-white truncate">{item.originalId}</div>
                        <div className="text-[10px] text-gray-500 mt-1">
                          删除时间：{new Date(item.deletedAt).toLocaleString()}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={workspaceTrashDialog.restoringTrashId != null}
                        onClick={() => void restoreWorkspaceTrashProject(item.trashId)}
                        className="shrink-0 rounded-lg border border-blue-500/40 bg-blue-950/30 px-3 py-1.5 text-[10px] font-medium text-blue-100 hover:bg-blue-900/50 disabled:opacity-50"
                      >
                        {restoring ? '恢复中…' : '恢复'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col h-[100dvh] overflow-hidden">
        <div
          ref={mainScrollRef}
          className={`flex-1 min-h-0 no-scrollbar touch-pan-y ${
            mode === AppMode.WORKFLOW && activeWorkspaceProjectId
              ? 'flex flex-col overflow-hidden pt-3 pb-3 pl-[calc(0.75rem+3.5rem+0.5rem)] pr-4 lg:pt-4 lg:pb-6 lg:pl-[calc(1rem+3.5rem+0.75rem)] lg:pr-6'
              : 'overflow-y-auto pt-6 pb-4 pl-[calc(0.75rem+3.5rem+0.5rem)] pr-4 lg:py-10 lg:pl-[calc(1rem+3.5rem+0.75rem)] lg:pr-10'
          }`}
          onMouseDownCapture={onMainMouseDownCapture}
          onWheelCapture={onMainWheelCapture}
          onDragOverCapture={onMainDragOverCapture}
          onDropCapture={onMainDropCapture}
        >
          <div
            ref={workflowMainContentRef}
            className={
              mode === AppMode.WORKFLOW && activeWorkspaceProjectId
                ? 'flex h-full min-h-0 min-w-0 w-full flex-1 flex-col'
                : 'h-full w-full'
            }
          >
            {mode === AppMode.SETTINGS && (
              <Suspense fallback={<LazySectionFallback label="设置" />}>
                <SettingsSection
                  currentUser={user}
                  authLoading={authLoading}
                  onRefreshUser={refreshAuthUser}
                  onLogout={logout}
                  onAiInvocationSurfaceChange={() => setAiInvocationStatusRev((n) => n + 1)}
                  aiSettingsSyncRev={aiInvocationStatusRev}
                  activeWorkspaceProjectId={activeWorkspaceProjectId}
                  preferenceScope={user?.id ?? null}
                />
              </Suspense>
            )}
            {mode === AppMode.TEXTURE && <TextureEngineSection />}

            {(activeWorkspaceProjectId || mode === AppMode.WORKFLOW) && (
              <div
                className={
                  mode !== AppMode.WORKFLOW
                    ? 'hidden'
                    : activeWorkspaceProjectId
                      ? 'flex min-h-0 min-w-0 w-full flex-1 flex-col'
                      : undefined
                }
              >
                <WorkflowModeShell
                  showWorkspaceIdbHydrateOverlay={showWorkspaceIdbHydrateOverlay}
                  activeWorkspaceProjectId={activeWorkspaceProjectId}
                  user={user}
                  workspaceProjects={workspaceProjects}
                  onWorkspaceCreate={createWorkspaceProjectEntry}
                  onWorkspaceOpen={openWorkspaceProject}
                  onWorkspaceRename={renameWorkspaceProjectEntry}
                  onWorkspaceDelete={requestDeleteWorkspaceProject}
                  onWorkspaceBind={requestBindWorkspaceProject}
                  onWorkspaceUnbind={requestUnbindWorkspaceProject}
                  onWorkspaceManualUpload={requestManualUploadWorkspaceProject}
                  onWorkspaceExport={exportWorkspaceProjectEntry}
                  onWorkspaceImport={(file) => void importWorkspaceProjectEntry(file)}
                  onWorkspaceRetryFailedUpload={retryFailedManualUploadWorkspaceProject}
                  onOpenWorkspaceUploadFailureDetail={requestOpenWorkspaceUploadFailureDetail}
                  workspaceUploadingProjectId={workspaceUploadingProjectId}
                  onOpenWorkspaceTrash={() => void openWorkspaceTrashDialog()}
                  renderWorkflowSection={() => (
                    <WorkflowSection
                      quickComposeShellActive={mode === AppMode.WORKFLOW}
                      textModelRegistryId={config.modelText}
                      capabilityPresets={capabilityPresets}
                      capabilitySets={capabilitySets}
                      assets={workflowAssets}
                      onAssetsChange={setWorkflowAssets}
                      pending={workflowPending}
                      onPendingChange={setWorkflowPending}
                      onLog={(level, message, detail) => addGlobalLog('工作区', level, message, detail)}
                      onAddGenerate3DJob={handleAddGenerate3DJobFromWorkflow}
                      preferenceScope={user?.id ?? null}
                      onboardingKey={`${user?.id ?? 'guest'}:${activeWorkspaceProjectId}`}
                      workspaceProjectChrome={{
                        projectOptions: workspaceProjectOptions,
                        activeProjectId: activeWorkspaceProjectId,
                        activeProjectName: activeWorkspaceProjectName,
                        onBackToProjectList: () => void backToWorkspaceProjectShell(),
                        onSelectProject: (id) => void openWorkspaceProject(id),
                      }}
                      registerMarqueeStartHandler={registerWorkflowMarqueeStart}
                      registerPaneWheelHandler={registerWorkflowPaneWheel}
                      registerWorkflowAssetListWheelHandler={registerWorkflowAssetListWheel}
                      onUpdateCapabilityPresets={(next) => {
                        setCapabilityPresets(next);
                        saveCapabilityPresets(next);
                      }}
                      onUpdateCapabilitySets={(next) => {
                        setCapabilitySets(next);
                        saveCapabilitySets(next);
                      }}
                      capabilityPresetPanel={
                        <Suspense fallback={<LazySectionFallback label="能力预设" />}>
                          <CapabilityPresetSection
                            presets={capabilityPresets}
                            onUpdate={(next) => {
                              setCapabilityPresets(next);
                              saveCapabilityPresets(next);
                            }}
                            sets={capabilitySets}
                            onUpdateSets={(next) => {
                              setCapabilitySets(next);
                              saveCapabilitySets(next);
                            }}
                            onRunTest={(preset, imageBase64) =>
                              runCapabilityTest(preset, imageBase64, { textModelRegistryId: config.modelText })
                            }
                            onLog={(level, message, detail) => addGlobalLog('能力', level, message, detail)}
                            embeddedInWorkflow={true}
                            canUploadToR2={user?.role === 'admin'}
                          />
                        </Suspense>
                      }
                    />
                  )}
                />
              </div>
            )}

            {mode === AppMode.SEAM_REPAIR && (
              <Suspense fallback={<LazySectionFallback label="贴图修缝" />}>
                <SeamRepairSection onLog={(level, message, detail) => addGlobalLog('贴图修缝', level, message, detail)} />
              </Suspense>
            )}

            {mode === AppMode.PBR_TEXTURE && (
              <Suspense fallback={<LazySectionFallback label="生成贴图" />}>
                <GenerateTextureSection onLog={(level, message, detail) => addGlobalLog('生成贴图', level, message, detail)} />
              </Suspense>
            )}

            {mode === AppMode.CAPABILITY && (
              <Suspense fallback={<LazySectionFallback label="能力" />}>
                <CapabilityPresetSection
                  presets={capabilityPresets}
                  onUpdate={(next) => { setCapabilityPresets(next); saveCapabilityPresets(next); }}
                  sets={capabilitySets}
                  onUpdateSets={(next) => { setCapabilitySets(next); saveCapabilitySets(next); }}
                  onOpenWorkflowComposer={openGlobalWorkflowComposer}
                  onRunTest={(preset, imageBase64) =>
                    runCapabilityTest(preset, imageBase64, { textModelRegistryId: config.modelText })
                  }
                  onLog={(level, message, detail) => addGlobalLog('能力', level, message, detail)}
                  canUploadToR2={user?.role === 'admin'}
                />
              </Suspense>
            )}

            {globalComposerSessions.map((sess) => (
              <Suspense key={sess.id} fallback={null}>
                <WorkflowComposerOverlay
                  open
                  onClose={() => closeGlobalComposerSession(sess.id)}
                  sessionKey={sess.sessionKey}
                  presets={capabilityPresets}
                  initialSet={sess.initialSet}
                  isForeground={sess.id === globalComposerActiveId}
                  dockStackIndex={getGlobalComposerDockStackIndex(sess.id)}
                  dockStackCount={getGlobalComposerDockStackCount(sess.id)}
                  onRequestForeground={() => setGlobalComposerActiveId(sess.id)}
                  onMinimizedChange={(minimized) =>
                    setGlobalComposerMinimized((prev) => {
                      if (prev[sess.id] === minimized) return prev;
                      return { ...prev, [sess.id]: minimized };
                    })
                  }
                  companionProjectId={activeWorkspaceProjectId}
                  textModelRegistryId={config.modelText}
                  onSave={(set) => {
                    const next = capabilitySets.some((s) => s.id === set.id)
                      ? capabilitySets.map((s) => (s.id === set.id ? set : s))
                      : [...capabilitySets, set];
                    setCapabilitySets(next);
                    saveCapabilitySets(next);
                    addGlobalLog('能力', 'info', `已保存工作流：${set.label}`);
                  }}
                  onLog={(level, message, detail) => addGlobalLog('能力', level, message, detail)}
                />
              </Suspense>
            ))}

            {mode === AppMode.ADMIN && <GenerationRecordsAnalysis />}

            {mode === AppMode.ARENA && (
              <Suspense fallback={<LazySectionFallback label="提示词擂台" />}>
                <PromptArenaSection
                  arenaUserDescription={arenaUserDescription}
                  setArenaUserDescription={setArenaUserDescription}
                  arenaImage={arenaImage}
                  setArenaImage={setArenaImage}
                  arenaRound={arenaRound}
                  setArenaRound={setArenaRound}
                  arenaInitialCount={arenaInitialCount}
                  setArenaInitialCount={setArenaInitialCount}
                  arenaReasoning={arenaReasoning}
                  setArenaReasoning={setArenaReasoning}
                  arenaOptimizeReasoning={arenaOptimizeReasoning}
                  setArenaOptimizeReasoning={setArenaOptimizeReasoning}
                  arenaPromptA={arenaPromptA}
                  setArenaPromptA={setArenaPromptA}
                  arenaImageA={arenaImageA}
                  setArenaImageA={setArenaImageA}
                  arenaPromptB={arenaPromptB}
                  setArenaPromptB={setArenaPromptB}
                  arenaImageB={arenaImageB}
                  setArenaImageB={setArenaImageB}
                  arenaPromptC={arenaPromptC}
                  setArenaPromptC={setArenaPromptC}
                  arenaImageC={arenaImageC}
                  setArenaImageC={setArenaImageC}
                  arenaPromptD={arenaPromptD}
                  setArenaPromptD={setArenaPromptD}
                  arenaImageD={arenaImageD}
                  setArenaImageD={setArenaImageD}
                  arenaChampionPrompt={arenaChampionPrompt}
                  setArenaChampionPrompt={setArenaChampionPrompt}
                  arenaChampionImage={arenaChampionImage}
                  setArenaChampionImage={setArenaChampionImage}
                  arenaChallengerPrompt={arenaChallengerPrompt}
                  setArenaChallengerPrompt={setArenaChallengerPrompt}
                  arenaChallengerImage={arenaChallengerImage}
                  setArenaChallengerImage={setArenaChallengerImage}
                  arenaChallenger2Prompt={arenaChallenger2Prompt}
                  setArenaChallenger2Prompt={setArenaChallenger2Prompt}
                  arenaChallenger2Image={arenaChallenger2Image}
                  setArenaChallenger2Image={setArenaChallenger2Image}
                  arenaIsGenerating={arenaIsGenerating}
                  setArenaIsGenerating={setArenaIsGenerating}
                  arenaIsOptimizing={arenaIsOptimizing}
                  setArenaIsOptimizing={setArenaIsOptimizing}
                  arenaCompareModalOpen={arenaCompareModalOpen}
                  setArenaCompareModalOpen={setArenaCompareModalOpen}
                  arenaReportedGaps={arenaReportedGaps}
                  setArenaReportedGaps={setArenaReportedGaps}
                  arenaWinnerStrength={arenaWinnerStrength}
                  setArenaWinnerStrength={setArenaWinnerStrength}
                  arenaLoserRemark={arenaLoserRemark}
                  setArenaLoserRemark={setArenaLoserRemark}
                  arenaImageModel={arenaImageModel}
                  setArenaImageModel={setArenaImageModel}
                  arenaCurrentStep={arenaCurrentStep}
                  setArenaCurrentStep={setArenaCurrentStep}
                  arenaStepLog={arenaStepLog}
                  setArenaStepLog={setArenaStepLog}
                  arenaTimeline={arenaTimeline}
                  setArenaTimeline={setArenaTimeline}
                  arenaSaveSnippetConfirm={arenaSaveSnippetConfirm}
                  setArenaSaveSnippetConfirm={setArenaSaveSnippetConfirm}
                  arenaSnippets={arenaSnippets}
                  setArenaSnippets={setArenaSnippets}
                  arenaFirstVisit={arenaFirstVisit}
                  setArenaFirstVisit={setArenaFirstVisit}
                  setMode={setMode}
                  addTask={addTask}
                  updateTask={updateTask}
                  addGlobalLog={addGlobalLog}
                  onFileUpload={handleFileUpload}
                  modelText={config.modelText}
                  promptEdit={config.prompts.edit}
                  dialogModel={dialogModel}
                />
              </Suspense>
            )}

            {DIALOG_PAGE_ENABLED && mode === AppMode.DIALOG && (
              <div className="contents">
              <div className="flex h-[calc(100dvh-6rem)] animate-in fade-in gap-4 lg:gap-6">
                {/* 左侧：竖向会话列表（可滚动） */}
                <div className="w-56 lg:w-64 shrink-0 flex flex-col gap-3">
                  <div className="flex items-center justify-between px-2">
                    <div className="text-[9px] font-black text-gray-500 uppercase tracking-widest">会话</div>
                    <button
                      onClick={createNewDialogSession}
                      className="w-9 h-9 shrink-0 rounded-xl bg-[#26262c] ring-1 ring-white/[0.06] flex items-center justify-center text-lg font-bold text-white/80 hover:bg-[#383842] transition-colors"
                      title="新对话"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto no-scrollbar space-y-2 pr-1">
                    {(() => {
                      const RECENT_MS = 24 * 60 * 60 * 1000;
                      const now = Date.now();
                      const activityAt = (s: DialogSession) => {
                        const u = Number(s.updatedAt);
                        if (Number.isFinite(u)) return u;
                        const c = Number(s.createdAt);
                        return Number.isFinite(c) ? c : now;
                      };
                      const byLatestUpdated = (a: DialogSession, b: DialogSession) => activityAt(b) - activityAt(a);
                      const recent = dialogSessions
                        .filter((s) => !s.archived && now - activityAt(s) < RECENT_MS)
                        .sort(byLatestUpdated);
                      const older = dialogSessions
                        .filter((s) => !s.archived && now - activityAt(s) >= RECENT_MS)
                        .sort(byLatestUpdated);
                      const archived = dialogSessions
                        .filter((s) => s.archived)
                        .sort(byLatestUpdated);
                      const renderSession = (s: DialogSession, showArchive: boolean) => {
                        const lastImg = [...s.messages].reverse().find((m) => {
                          if (m.role !== 'assistant') return false;
                          const last = dialogVersionsForMessage(m).at(-1);
                          return !!(last && dialogVersionHasRenderableImage(last));
                        });
                        const lastVer = lastImg ? dialogVersionsForMessage(lastImg).at(-1) : undefined;
                        const hasLastGenBackdrop = !!(lastVer && dialogVersionHasRenderableImage(lastVer));
                        const isActive = s.id === dialogActiveSessionIdResolved;
                        const label = s.title || (s.messages.length === 0 ? '新对话' : `对话${s.messages.length}`);
                        return (
                          <div key={s.id} className="relative group isolate">
                            <div
                              className={`relative w-full overflow-hidden rounded-2xl border transition-colors ${
                                hasLastGenBackdrop
                                  ? isActive
                                    ? 'border-[#3b6fb8]'
                                    : 'ring-1 ring-white/[0.06] hover:ring-white/[0.12] border-transparent'
                                  : isActive
                                    ? 'bg-[#1a2d4d] border-[#3b6fb8]'
                                    : 'bg-white/[0.05] ring-1 ring-white/[0.06] hover:bg-white/[0.09] hover:ring-white/[0.1] border-transparent'
                              }`}
                            >
                              {hasLastGenBackdrop && lastVer ? (
                                <DialogSessionRowBackdrop version={lastVer} isActive={isActive} />
                              ) : null}
                              <button
                                type="button"
                                onClick={() => setDialogActiveSessionId(s.id)}
                                className={`relative z-[1] w-full text-left px-3 py-2.5 pr-14 rounded-2xl transition-colors ${
                                  hasLastGenBackdrop ? 'bg-transparent hover:bg-white/[0.06]' : ''
                                }`}
                                title={label}
                              >
                                <span className="flex items-start gap-2 min-w-0">
                                  {!hasLastGenBackdrop ? (
                                    <span className="mt-0.5 shrink-0 w-5 h-5 rounded-lg ring-1 ring-white/[0.06] bg-[#141416] flex items-center justify-center text-[9px] text-gray-500">新</span>
                                  ) : null}
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-[10px] font-black text-white truncate [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">{label}</span>
                                    <span className="block text-[9px] text-gray-200/90 truncate mt-0.5 [text-shadow:0_1px_1px_rgba(0,0,0,0.85)]">
                                      {s.messages.length} 条 · {new Date(activityAt(s)).toLocaleString()}
                                    </span>
                                  </span>
                                </span>
                              </button>
                            </div>
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 z-[3] flex items-center gap-0.5">
                              {showArchive && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); archiveDialogSession(s.id); }}
                                  className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] text-gray-500 hover:text-amber-400 hover:bg-[#2e2e36] transition-colors"
                                  title="归档"
                                >
                                  档
                                </button>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveDialogSession(s.id);
                                }}
                                className="w-7 h-7 rounded-xl flex items-center justify-center text-gray-500 hover:text-white hover:bg-[#2e2e36] transition-colors"
                                title="关闭会话"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        );
                      };
                      return (
                        <>
                          {recent.length > 0 && (
                            <div className="space-y-2">
                              <div className="px-2 text-[8px] font-black text-gray-500 uppercase">最近</div>
                              {recent.map(s => renderSession(s, true))}
                            </div>
                          )}
                          {older.length > 0 && (
                            <div className="space-y-2">
                              <button type="button" onClick={() => setDialogOlderCollapsed(c => !c)} className="w-full px-2 py-1 flex items-center justify-between text-[8px] font-black text-gray-500 uppercase hover:text-gray-400">
                                <span>更早的对话</span>
                                <span>{dialogOlderCollapsed ? '▼' : '▲'}</span>
                              </button>
                              {!dialogOlderCollapsed && older.map(s => renderSession(s, true))}
                            </div>
                          )}
                          {archived.length > 0 && (
                            <div className="space-y-2">
                              <button type="button" onClick={() => setDialogArchivedCollapsed(c => !c)} className="w-full px-2 py-1 flex items-center justify-between text-[8px] font-black text-gray-500 uppercase hover:text-gray-400">
                                <span>已归档</span>
                                <span>{dialogArchivedCollapsed ? '▼' : '▲'}</span>
                              </button>
                              {!dialogArchivedCollapsed && archived.map(s => renderSession(s, false))}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* 中间：对话内容 + 底部输入（min-w-0 避免工具条/下拉在 flex 内被横向裁切） */}
                <div className="flex-1 flex flex-col min-w-0 overflow-x-visible">
                  {/* 对话列表 */}
                  <div className="flex-1 overflow-y-auto no-scrollbar space-y-6 pb-4">
                  {dialogMessages.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                      <AppIcon name="chat" className="w-10 h-10 mb-4" />
                      {dialogAutoGenerateImage ? (
                        <>
                          <span className="text-[10px] font-black uppercase tracking-widest">描述画面生成图片，或上传图片后描述修改</span>
                          <span className="text-[9px] mt-2 text-gray-600">仅输入文字即可生图；有图时可改图，无图时可与 AI 文字对话</span>
                        </>
                      ) : (
                        <>
                          <span className="text-[10px] font-black uppercase tracking-widest">与 AI 文字对话，或上传图片做图文问答</span>
                          <span className="text-[9px] mt-2 text-gray-600">关闭生图后仅文字/图文回复，不输出新图片</span>
                        </>
                      )}
                    </div>
                  )}
                  {dialogMessages.map((msg, idx) => {
                    const userMsg = msg.role === 'assistant' && idx > 0 ? dialogMessages[idx - 1] : null;
                    const isEditingThis = dialogEditingMessageId === msg.id;
                    const isRegeneratingThis = dialogRegeneratingId === msg.id;
                    const displayVersion = getDisplayVersion(msg);
                    const versions = getDialogVersions(msg);
                    const versionIndex = displayVersion && versions.length > 0 ? getDialogVersionPosition(msg) : 0;
                    const gcd = (a: number, b: number) => (b ? gcd(b, a % b) : a);
                    const aspectRatioLabel = displayVersion?.width != null && displayVersion?.height != null ? (() => { const g = gcd(displayVersion.width, displayVersion.height); return `${displayVersion.width / g}:${displayVersion.height / g}`; })() : null;
                    const displaySrc = displayVersion ? getDialogVersionImageDataUrl(displayVersion) : undefined;
                    const displayPending = !!(displayVersion && dialogVersionHasRenderableImage(displayVersion) && !displaySrc);
                    return (
                      <div key={msg.id} id={`msg-${msg.id}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[85%] lg:max-w-[75%] rounded-2xl overflow-visible ${
                            msg.role === 'user' ? 'bg-[#1e3558] border border-[#4b6a9e]' : 'bg-white/[0.05] ring-1 ring-white/[0.06]'
                          }`}
                        >
                          {msg.role === 'user' && (msg.inputImages?.length || msg.imageBase64) && (
                            <div className="p-2 border-b border-white/[0.06] overflow-hidden rounded-t-2xl">
                              <div className={`grid gap-2 ${msg.inputImages && msg.inputImages.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                {(msg.inputImages && msg.inputImages.length > 0 ? msg.inputImages : msg.imageBase64 ? [msg.imageBase64] : []).map((image, imageIndex) => (
                                  <div
                                    key={`${msg.id}-${imageIndex}`}
                                    className="mx-auto w-full max-w-full rounded-xl ring-1 ring-white/[0.06] bg-[#141416] p-1 flex justify-center"
                                  >
                                    <SiteImage
                                      src={image}
                                      className="block h-auto max-h-[min(78dvh,920px)] w-auto max-w-full cursor-zoom-in object-contain rounded-lg"
                                      alt="上传"
                                      title="点击查看大图"
                                      loading="eager"
                                      fetchPriority="high"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openDialogImagePreviewFromChat({
                                          dataUrl: image,
                                          sourceMessageId: msg.id,
                                          sourceType: 'user_input',
                                          userPrompt: msg.text,
                                          timestamp: msg.timestamp,
                                        });
                                      }}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div
                            className={`px-4 py-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words ${
                              msg.role === 'user' ? 'text-white' : 'text-gray-100'
                            }`}
                          >
                            {msg.text?.trim()
                              ? msg.text
                              : msg.role === 'user' && (msg.inputImages?.length || msg.imageBase64)
                                ? '（已发送附图，可在上方查看）'
                                : msg.text}
                          </div>
                          {dialogAutoGenerateImage &&
                            msg.role === 'assistant' &&
                            msg.understoodPrompt &&
                            !displayVersion &&
                            !msg.versions?.length &&
                            !msg.resultImageBase64 &&
                            !isEditingThis && (
                            <div className="px-4 pb-4 space-y-3">
                              <div className="text-[9px] text-blue-400/80">理解指令: {msg.understoodPrompt}</div>
                              <button onClick={() => handleDialogGenerateFromUnderstood(msg.id)} disabled={dialogGeneratingFromUnderstoodId === msg.id || !(idx > 0 && dialogMessages[idx - 1].role === 'user')} className="px-4 py-2 rounded-xl bg-blue-600 text-[10px] font-black uppercase text-white hover:bg-blue-500 disabled:opacity-50 transition-colors">
                                {dialogGeneratingFromUnderstoodId === msg.id ? '生成中...' : '生成图片'}
                              </button>
                            </div>
                          )}
                          {msg.role === 'assistant' && displayVersion && !isEditingThis && (
                            <>
                              {displayVersion.understoodPrompt && (
                                <div className="px-4 pb-2 text-[9px] text-blue-400/80 border-b border-[#252528]">理解指令: {displayVersion.understoodPrompt}</div>
                              )}
                              {versions.length > 1 && (
                                <div className="px-4 py-2 flex items-center gap-2 border-b border-[#252528]">
                                  <span className="text-[9px] font-black text-gray-500 uppercase">历史版本</span>
                                  <button onClick={() => showPreviousDialogVersion(msg)} disabled={versionIndex <= 0} className="px-2 py-1 rounded-lg bg-[#1c1c22] text-[9px] font-black disabled:opacity-30">上一版</button>
                                  <span className="text-[9px] text-gray-400">{(versionIndex + 1)} / {versions.length}</span>
                                  <button onClick={() => showNextDialogVersion(msg)} disabled={versionIndex >= versions.length - 1} className="px-2 py-1 rounded-lg bg-[#1c1c22] text-[9px] font-black disabled:opacity-30">下一版</button>
                                </div>
                              )}
                              {(displayVersion.width != null || displayVersion.height != null) && (
                                <div className="px-4 py-1.5 text-[9px] text-gray-500 border-b border-[#252528] flex flex-wrap gap-3">
                                  {displayVersion.width != null && displayVersion.height != null && <span>分辨率 {displayVersion.width} × {displayVersion.height}</span>}
                                  {aspectRatioLabel && <span>宽高比 {aspectRatioLabel}</span>}
                                  <span>{new Date(displayVersion.timestamp).toLocaleString()}</span>
                                </div>
                              )}
                              <div className="p-4 relative">
                                {isRegeneratingThis && (
                                  <div className="absolute inset-0 bg-[#1a1a1e] rounded-xl flex flex-col items-center justify-center gap-3 z-10">
                                    <div className="w-8 h-8 border-2 border-[#4b6a9e] border-t-blue-500 rounded-full animate-spin" />
                                    <button onClick={handleDialogCancelGen} className="px-3 py-2 rounded-xl bg-[#991b1b] border border-[#ef4444]/50 text-[9px] font-black text-red-300 hover:bg-[#b91c1c] transition-colors">停止</button>
                                  </div>
                                )}
                                {displayPending ? (
                                  <div className="flex items-center justify-center min-h-[140px] rounded-xl ring-1 ring-white/[0.06] bg-[#141416] text-[9px] text-gray-500">图片加载中…</div>
                                ) : dialogDetectMessageId === msg.id && (displayVersion.detectedBoxes?.length ?? 0) > 0 && displaySrc ? (
                                  <div className="relative inline-block max-w-full">
                                    <SiteImage
                                      src={displaySrc}
                                      className="block h-auto max-h-[min(90dvh,960px)] w-auto max-w-full cursor-zoom-in object-contain rounded-xl ring-1 ring-white/[0.06]"
                                      alt="生成"
                                      title="点击查看大图"
                                      loading="eager"
                                      fetchPriority="high"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const prevU = idx > 0 && dialogMessages[idx - 1]?.role === 'user' ? dialogMessages[idx - 1] : undefined;
                                        openDialogImagePreviewFromChat({
                                          dataUrl: displaySrc,
                                          sourceMessageId: msg.id,
                                          sourceType: 'generated',
                                          userPrompt: prevU?.text,
                                          understoodPrompt: displayVersion?.understoodPrompt,
                                          timestamp: displayVersion?.timestamp ?? msg.timestamp,
                                        });
                                      }}
                                    />
                                    <div className="absolute inset-0 pointer-events-none">
                                      {(displayVersion.detectedBoxes ?? []).map((box, i) => (
                                        <div key={box.id} className="absolute border-2 border-blue-500 bg-[#1e40af]" style={{ left: `${box.xmin / 10}%`, top: `${box.ymin / 10}%`, width: `${(box.xmax - box.xmin) / 10}%`, height: `${(box.ymax - box.ymin) / 10}%` }}>
                                          <span className="absolute -top-7 left-0 min-w-[24px] h-6 px-1.5 rounded flex items-center justify-center text-xs font-black bg-blue-600 text-white shadow-lg">{DIALOG_BOX_LABELS[i] ?? i + 1}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : displaySrc ? (
                                  <div className="w-full max-w-full rounded-xl ring-1 ring-white/[0.06] bg-[#141416] p-1 flex justify-center">
                                    <SiteImage
                                      src={displaySrc}
                                      className="block h-auto max-h-[min(90dvh,960px)] w-auto max-w-full cursor-zoom-in object-contain rounded-lg"
                                      alt="生成"
                                      title="点击查看大图"
                                      loading="eager"
                                      fetchPriority="high"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const prevU = idx > 0 && dialogMessages[idx - 1]?.role === 'user' ? dialogMessages[idx - 1] : undefined;
                                        openDialogImagePreviewFromChat({
                                          dataUrl: displaySrc,
                                          sourceMessageId: msg.id,
                                          sourceType: 'generated',
                                          userPrompt: prevU?.text,
                                          understoodPrompt: displayVersion?.understoodPrompt,
                                          timestamp: displayVersion?.timestamp ?? msg.timestamp,
                                        });
                                      }}
                                    />
                                  </div>
                                ) : null}
                              </div>
                              {dialogDetectMessageId === msg.id && (displayVersion.detectedBoxes?.length ?? 0) > 0 && (
                                <div className="px-4 pb-3 space-y-2 border-b border-white/[0.06]">
                                  <div className="text-[9px] font-black text-blue-400 uppercase">点击数字下载该物体（带边距）· 可添加到右侧临时库</div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {(displayVersion.detectedBoxes ?? []).map((_, i) => (
                                      <button key={i} onClick={() => handleDialogDownloadCropByIndex(msg, i)} className="w-9 h-9 rounded-xl bg-[#264670] border border-[#3b82f6] text-sm font-black hover:bg-[#365e92] transition-all flex items-center justify-center" title={`下载 ${DIALOG_BOX_LABELS[i] ?? i + 1}`}>{DIALOG_BOX_LABELS[i] ?? i + 1}</button>
                                    ))}
                                    <button onClick={() => handleDialogDownloadAllCrops(msg)} className="px-3 py-2 bg-blue-600 rounded-xl text-[9px] font-black uppercase text-white hover:bg-blue-500 transition-all">下载全部</button>
                                    <button onClick={() => handleDialogTempAddAllCrops(msg)} className="px-3 py-2 bg-[#26262c] ring-1 ring-white/[0.06] rounded-xl text-[9px] font-black uppercase hover:bg-[#383842] transition-all">全部加临时库</button>
                                    <button onClick={() => handleDialogDetectObjects(msg, true)} disabled={dialogDetectingId === msg.id} className="px-3 py-2 bg-[#26262c] ring-1 ring-white/[0.06] rounded-xl text-[9px] font-black uppercase hover:bg-[#383842] transition-all disabled:opacity-50">重新识别</button>
                                    <button onClick={handleDialogDetectClose} className="px-3 py-2 text-gray-500 text-[9px] font-black uppercase hover:text-white transition-colors">收起</button>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {(displayVersion.detectedBoxes ?? []).map((_, i) => (
                                      <button key={i} onClick={() => handleDialogTempAddCropByIndex(msg, i)} className="px-2 py-1 rounded-lg bg-white/[0.05] ring-1 ring-white/[0.06] text-[9px] font-black hover:bg-[#2e2e36] transition-all" title={`${DIALOG_BOX_LABELS[i] ?? i + 1} 加到临时库`}>+{DIALOG_BOX_LABELS[i] ?? i + 1}</button>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div className="px-4 pb-4 flex flex-wrap gap-2">
                                <button onClick={() => handleDialogDownload(msg)} className="px-3 py-2 bg-[#1e3558] border border-[#4b6a9e] rounded-xl text-[9px] font-black uppercase text-blue-400 hover:bg-[#305a90] transition-all">下载图片</button>
                                <button onClick={() => displaySrc && handleCopyDialogImage(displaySrc)} disabled={!displaySrc} className="px-3 py-2 bg-[#26262c] ring-1 ring-white/[0.06] rounded-xl text-[9px] font-black uppercase hover:bg-[#383842] transition-all disabled:opacity-40">复制图片</button>
                                <button onClick={() => displaySrc && openDialogCrop(msg.id, displaySrc)} disabled={!displaySrc} className="px-3 py-2 bg-[#26262c] ring-1 ring-white/[0.06] rounded-xl text-[9px] font-black uppercase hover:bg-[#383842] transition-all disabled:opacity-40">裁切</button>
                                <button onClick={() => handleDialogUseAsInput(msg)} className="px-3 py-2 bg-[#14532d] border border-green-500/30 rounded-xl text-[9px] font-black uppercase text-green-400 hover:bg-[#166534] transition-all">以此图继续</button>
                                <button onClick={() => handleDialogDetectObjects(msg)} disabled={dialogDetectingId === msg.id} className="px-3 py-2 bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl text-[9px] font-black uppercase hover:bg-[#2e2e36] transition-all disabled:opacity-50">{dialogDetectingId === msg.id ? '识别中...' : '识别图中物体'}</button>
                                <button onClick={() => handleDialogSaveToLibrary(msg)} className="px-3 py-2 bg-[#1e3558] border border-[#4b6a9e] rounded-xl text-[9px] font-black uppercase text-blue-400 hover:bg-[#305a90] transition-all">保存到库</button>
                                <button onClick={() => handleDialogRegenerate(msg.id)} disabled={isRegeneratingThis || !userMsg} className="px-3 py-2 bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl text-[9px] font-black uppercase hover:bg-[#2e2e36] transition-all disabled:opacity-50">直接重新生成</button>
                                <button onClick={() => { setDialogEditingMessageId(msg.id); setDialogEditingText(userMsg?.role === 'user' ? userMsg.text : ''); }} disabled={isRegeneratingThis} className="px-3 py-2 bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl text-[9px] font-black uppercase hover:bg-[#2e2e36] transition-all disabled:opacity-50">编辑后重新生成</button>
                              </div>
                              {displayVersion?.generationRecordId && (() => {
                                const recordId = displayVersion.generationRecordId!;
                                const currentScore = ratingCache[recordId] ?? recordsForRating.find(r => r.id === recordId)?.userScore;
                                return (
                                  <div className="px-4 pb-3 flex items-center gap-2">
                                    <span className="text-[9px] font-black text-gray-500 uppercase">评分</span>
                                    {[1, 2, 3, 4, 5].map(score => (
                                      <button
                                        key={score}
                                        type="button"
                                        onClick={() => { updateGenerationScore(recordId, score); setRatingCache(prev => ({ ...prev, [recordId]: score })); }}
                                        className={`w-7 h-7 rounded border flex items-center justify-center text-[11px] transition-all ${(currentScore ?? 0) >= score ? 'border-[#f59e0b] bg-[#3d3018] text-amber-400' : 'border-[#3a3a40] bg-[#1c1c22] hover:bg-[#3d3018] hover:border-[#d97706] text-gray-500'}`}
                                        title={`${score} 星`}
                                      ><AppIcon name="star" className="w-3.5 h-3.5" /></button>
                                    ))}
                                    {currentScore != null && <span className="text-[9px] text-gray-500">{currentScore} 星</span>}
                                  </div>
                                );
                              })()}
                            </>
                          )}
                          {msg.role === 'assistant' && isEditingThis && (
                            <div className="p-4 border-t border-white/[0.06] space-y-3">
                              <input value={dialogEditingText} onChange={e => setDialogEditingText(e.target.value)} placeholder="修改你的需求描述..." className="w-full bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl px-4 py-3 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50" />
                              <div className="flex gap-2">
                                <button onClick={() => handleDialogEditThenRegenerate(msg.id, dialogEditingText)} disabled={!dialogEditingText.trim()} className="px-4 py-2 bg-blue-600 rounded-xl text-[9px] font-black uppercase disabled:opacity-50">确认重新生成</button>
                                <button onClick={() => setDialogEditingMessageId(null)} className="px-4 py-2 bg-white/[0.05] ring-1 ring-white/[0.06] rounded-xl text-[9px] font-black uppercase">取消</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {dialogSendingSessionIds.includes(dialogActiveSessionIdResolved) && (
                    <div className="flex justify-start items-center gap-2">
                      <div className="px-4 py-3 rounded-2xl bg-white/[0.05] ring-1 ring-white/[0.06] text-[10px] text-gray-400 flex items-center gap-2">
                        <div className="w-3 h-3 border-2 border-[#4b6a9e] border-t-blue-500 rounded-full animate-spin" />
                        {dialogBridgePrefs.enabled
                          ? '本地桥接处理中…'
                          : dialogAutoGenerateImage
                            ? dialogSkipUnderstand
                              ? '直发提示词，生图中…'
                              : '理解需求 → 生图中…'
                            : dialogSkipUnderstand
                              ? '处理中…'
                              : '理解需求中…'}
                      </div>
                      <button onClick={handleDialogCancelGen} className="px-3 py-2 rounded-xl bg-[#5c1a1a] border border-[#f87171] text-[9px] font-black text-red-400 hover:bg-[#991b1b] transition-colors">停止</button>
                    </div>
                  )}
                  <div ref={dialogEndRef} />
                  </div>
                  {/* 输入区：支持粘贴图片；档位 + 比例/尺寸 + 文案 + 发送（模型由档位决定） */}
                  <div className="glass rounded-[2rem] p-4 lg:p-6 border border-[#252528] shrink-0 min-w-0 space-y-3 overflow-visible" onPaste={handleDialogPaste}>
                  <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[9px] font-black text-amber-200/90 uppercase shrink-0">本地桥接</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={dialogBridgePrefs.enabled}
                        title="开启后对话走本机 A-Driver + bb-browser，不再直连接口生图链路"
                        onClick={() => setDialogBridgePrefs({ enabled: !dialogBridgePrefs.enabled })}
                        className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${dialogBridgePrefs.enabled ? 'bg-amber-600' : 'bg-[#26262c]'}`}
                      >
                        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${dialogBridgePrefs.enabled ? 'left-6' : 'left-1'}`} />
                      </button>
                      <span className="text-[9px] text-gray-500 leading-snug">
                        需登录；本机 A-Driver + bb-browser 能连上你已登录的 Chrome。Gemini 网页模式会打开 gemini.google.com/app。
                      </span>
                    </div>
                    {dialogBridgePrefs.enabled ? (
                      <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[9px] text-gray-500 shrink-0">目标</span>
                      <button
                        type="button"
                        onClick={() => setDialogBridgePrefs({ connectorId: 'gemini-web' })}
                        className={`px-2.5 py-1 rounded-lg text-[9px] font-bold border transition-colors ${
                          dialogBridgePrefs.connectorId === 'gemini-web'
                            ? 'border-amber-500/60 bg-amber-500/15 text-amber-100'
                            : 'border-white/10 bg-[#1c1c22] text-gray-400 hover:bg-white/5'
                        }`}
                      >
                        Gemini 网页
                      </button>
                      <button
                        type="button"
                        onClick={() => setDialogBridgePrefs({ connectorId: 'bb-site' })}
                        className={`px-2.5 py-1 rounded-lg text-[9px] font-bold border transition-colors ${
                          dialogBridgePrefs.connectorId === 'bb-site'
                            ? 'border-amber-500/60 bg-amber-500/15 text-amber-100'
                            : 'border-white/10 bg-[#1c1c22] text-gray-400 hover:bg-white/5'
                        }`}
                      >
                        bb 站点搜索
                      </button>
                    </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          className="min-w-[10rem] flex-1 bg-white/[0.05] ring-1 ring-white/[0.06] rounded-lg px-2 py-1.5 text-[10px] outline-none focus:border-amber-500/60"
                          placeholder="设备 ID（与 BRIDGE_DEVICE_ID 一致）"
                          value={dialogBridgePrefs.deviceId}
                          onChange={(e) => setDialogBridgePrefs({ deviceId: e.target.value })}
                        />
                        <input
                          className="min-w-[10rem] flex-1 bg-white/[0.05] ring-1 ring-white/[0.06] rounded-lg px-2 py-1.5 text-[10px] outline-none focus:border-amber-500/60"
                          placeholder={
                            dialogBridgePrefs.connectorId === 'gemini-web'
                              ? '可选：完整 Gemini URL（留空用默认 https://gemini.google.com/app）'
                              : 'bb 路由（可选，如 duckduckgo/search）'
                          }
                          value={dialogBridgePrefs.bbSiteRoute}
                          onChange={(e) => setDialogBridgePrefs({ bbSiteRoute: e.target.value })}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const r = await fetchBridgeUserDevices();
                              addGlobalLog(
                                '对话',
                                'info',
                                `在线桥接设备 ${r.devices.length} 个`,
                                r.devices.map((d) => `${d.deviceId}×${d.connections}`).join(', ') || '无'
                              );
                            } catch (e) {
                              addGlobalLog(
                                '对话',
                                'error',
                                '拉取桥接设备失败',
                                e instanceof Error ? e.message : String(e)
                              );
                            }
                          }}
                          className="shrink-0 px-2.5 py-1.5 rounded-lg border border-amber-500/40 bg-[#1c1c22] text-[9px] font-black uppercase text-amber-100/90 hover:bg-amber-500/10"
                        >
                          列设备
                        </button>
                      </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex w-full min-w-0 items-center gap-2 min-h-9">
                    <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-x-2 gap-y-2 overflow-x-auto overflow-y-visible no-scrollbar pr-1">
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[9px] font-black text-gray-500 uppercase whitespace-nowrap">开启生图</span>
                        <button type="button" role="switch" aria-checked={dialogAutoGenerateImage} onClick={() => setDialogAutoGenerateImage(p => !p)} className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${dialogAutoGenerateImage ? 'bg-blue-600' : 'bg-[#26262c]'}`}>
                          <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${dialogAutoGenerateImage ? 'left-6' : 'left-1'}`} />
                        </button>
                      </div>
                      {dialogAutoGenerateImage ? (
                        <>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[9px] font-black text-gray-500 uppercase whitespace-nowrap">理解</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={!dialogSkipUnderstand}
                              title={dialogSkipUnderstand ? '已关闭：将直接使用输入框内容生图/回复' : '已开启：先由模型理解需求再执行'}
                              onClick={() => setDialogSkipUnderstandState((p) => !p)}
                              className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${!dialogSkipUnderstand ? 'bg-blue-600' : 'bg-[#26262c]'}`}
                            >
                              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${!dialogSkipUnderstand ? 'left-6' : 'left-1'}`} />
                            </button>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[9px] font-black text-gray-500 uppercase whitespace-nowrap">挡位</span>
                            <div className="flex rounded-lg overflow-hidden ring-1 ring-white/[0.06] shrink-0">
                              {effectiveImageGearRows.map((g) => (
                                <button
                                  key={g.id}
                                  type="button"
                                  disabled={g.disabled}
                                  title={g.disabled ? g.disabledReason : g.modelId}
                                  onClick={() => {
                                    if (!g.disabled) {
                                      setDialogImageGear(g.id);
                                      setDialogModel(g.modelId);
                                    }
                                  }}
                                  className={`px-2.5 py-1.5 text-[9px] font-black uppercase transition-colors ${
                                    dialogImageGear === g.id && !g.disabled
                                      ? 'bg-blue-600 text-white'
                                      : g.disabled
                                        ? 'bg-[#1c1c22] text-gray-600 cursor-not-allowed opacity-60'
                                        : 'bg-[#1c1c22] text-gray-500 hover:bg-[#2e2e36]'
                                  }`}
                                >
                                  {g.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      ) : null}
                    </div>
                    {dialogAutoGenerateImage ? (
                      <div className="flex shrink-0 items-center gap-2 border-l border-white/10 pl-2 sm:pl-3">
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[9px] font-black text-gray-500 uppercase whitespace-nowrap">比例</span>
                          <CustomDropdown
                            options={DIALOG_ASPECT_RATIO_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
                            value={dialogAspectRatio}
                            onChange={setDialogAspectRatio}
                            triggerClassName={`${DROPDOWN_TRIGGER_COMPACT} min-w-[5.5rem]`}
                          />
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[9px] font-black text-gray-500 uppercase whitespace-nowrap">尺寸</span>
                          <CustomDropdown
                            options={SUPPORTED_IMAGE_SIZES.map((s) => ({ value: s.value, label: s.label }))}
                            value={dialogImageSize}
                            onChange={setDialogImageSize}
                            triggerClassName={`${DROPDOWN_TRIGGER_COMPACT} min-w-[4.75rem]`}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2">
                    {dialogInputImages.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        {dialogInputImages.map((img, i) => (
                          <div key={img.id} className="relative inline-flex items-center gap-1 rounded-lg ring-1 ring-white/[0.06] bg-[#1c1c22] overflow-hidden">
                            <span className="pl-2 text-[8px] font-black text-gray-500">图{i + 1}</span>
                            <ProgressivePreviewImage
                              fullSrc={img.data}
                              cacheKey={`dialog-inp-thumb:${img.id}`}
                              thumbMaxEdge={96}
                              className="relative h-12 w-12 shrink-0"
                              imgClassName="h-12 w-12 object-cover"
                              alt={`图${i + 1}`}
                            />
                            <button type="button" onClick={() => setDialogInputImages(prev => prev.filter(x => x.id !== img.id))} className="p-1 text-red-400 hover:bg-[#4a1c1c] rounded text-[10px] leading-none">×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <p
                      className="text-[9px] text-gray-500 leading-snug"
                      title={
                        dialogAutoGenerateImage
                          ? `可添加多张图片（最多 ${DIALOG_INPUT_IMAGES_MAX} 张），输入 @ 弹出选择；临时库图片可加入输入框。Ctrl+V 粘贴。无图时可文字对话或描述生图。Enter 发送，Shift+Enter 换行。`
                          : `可添加多张图片（最多 ${DIALOG_INPUT_IMAGES_MAX} 张）做图文问答。@ 选择图片，Ctrl+V 粘贴。已关闭生图，仅文字/图文回复。Enter 发送，Shift+Enter 换行。`
                      }
                    >
                      {dialogAutoGenerateImage
                        ? `最多 ${DIALOG_INPUT_IMAGES_MAX} 张 · @ 选图 · Ctrl+V · Enter 发送 · Shift+Enter 换行`
                        : `最多 ${DIALOG_INPUT_IMAGES_MAX} 张 · @ 选图 · 不生图 · Enter 发送 · Shift+Enter 换行`}
                    </p>
                  </div>
                  {dialogValidationError && (
                    <div className="text-[11px] text-amber-400 bg-[#2c2412] border border-[#b45309] rounded-xl px-4 py-2 flex items-center gap-2">
                      <AppIcon name="warning" className="shrink-0 w-3.5 h-3.5" />
                      <span>{dialogValidationError}</span>
                      <button type="button" onClick={() => setDialogValidationError(null)} className="ml-auto shrink-0 text-amber-400/80 hover:text-amber-300">×</button>
                    </div>
                  )}
                  <div ref={dialogInputWrapperRef} className="flex gap-3 relative items-end">
                    <div className="flex-1 relative flex min-h-12 min-w-0 gap-3 rounded-xl bg-white/[0.05] ring-1 ring-white/[0.06] transition-colors focus-within:ring-2 focus-within:ring-blue-500/45 overflow-visible">
                      <label
                        className="shrink-0 flex min-h-12 w-11 items-center justify-center pl-2.5 self-stretch cursor-pointer text-gray-400 hover:text-gray-200"
                        title="上传图片"
                        aria-label="上传图片"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-white/[0.06] bg-[#16161a] hover:bg-[#2e2e36] transition-colors">
                          <input
                            type="file"
                            className="sr-only"
                            accept="image/*"
                            multiple
                            onChange={(e) => {
                              void handleDialogImagesUpload(e);
                            }}
                          />
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <path d="M21 15l-5-5L5 21" />
                          </svg>
                        </span>
                      </label>
                      <textarea
                        ref={dialogInputRef}
                        value={dialogInputText}
                        rows={1}
                        onChange={e => {
                          const target = e.target as HTMLTextAreaElement;
                          setDialogInputText(target.value);
                          setDialogValidationError(null);
                          const pos = target.selectionStart ?? 0;
                          if (pos > 0 && target.value[pos - 1] === '@') {
                            setAtSuggestionsCursor(pos - 1);
                            setAtSuggestionsOpen(true);
                          } else setAtSuggestionsOpen(false);
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Escape') setAtSuggestionsOpen(false);
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleDialogSend();
                          }
                        }}
                        placeholder={
                          dialogAutoGenerateImage
                            ? '@ 选图或输入文字；有图写改法，无图可生图或闲聊'
                            : '@ 选图或输入文字；图文问答（不生图）'
                        }
                        className={`flex-1 min-w-0 min-h-12 max-h-[min(40vh,280px)] resize-none border-0 bg-transparent py-[14px] pr-4 text-[11px] leading-5 outline-none ring-0 focus:ring-0 transition-colors placeholder:text-gray-600 rounded-r-xl ${dialogInputScrollOverflow ? 'overflow-y-auto' : 'overflow-y-hidden'}`}
                      />
                      {atSuggestionsOpen && (dialogInputImages.length > 0 || dialogTempFiltered.length > 0) && (
                        <div className="absolute left-0 right-0 bottom-full mb-1 z-[5000] rounded-xl ring-1 ring-white/[0.06] bg-[#0f0f0f] shadow-xl py-1 max-h-[min(50vh,240px)] overflow-y-auto">
                          {dialogInputImages.length > 0 && (
                            <div className="px-2 py-1 text-[8px] font-black text-gray-500 uppercase">输入框图片</div>
                          )}
                          {dialogInputImages.map((img, i) => {
                            const imageNumber = i + 1;
                            return (
                            <button key={img.id} type="button" onClick={() => { const newText = dialogInputText.slice(0, atSuggestionsCursor) + `@图${imageNumber} ` + dialogInputText.slice(atSuggestionsCursor + 1); setDialogInputText(newText); setAtSuggestionsOpen(false); dialogInputRef.current?.focus(); }} className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-[#2e2e36] rounded-lg">
                              <ProgressivePreviewImage
                                fullSrc={img.data}
                                cacheKey={`dialog-at-inp:${img.id}`}
                                thumbMaxEdge={64}
                                className="w-8 h-8 shrink-0 rounded overflow-hidden"
                                imgClassName="w-8 h-8 rounded object-cover shrink-0"
                                alt=""
                              />
                              <span>图{imageNumber}</span>
                            </button>
                            );
                          })}
                          {dialogTempFiltered.length > 0 && (
                            <div className="px-2 py-1 text-[8px] font-black text-gray-500 uppercase mt-1 border-t border-[#252528]">临时库（点击加入输入框并插入 @）</div>
                          )}
                          {dialogTempFiltered.map((item, i) => (
                            <button key={item.id} type="button" onClick={() => { handleDialogTempAddToInput(item); const newIdx = dialogInputImages.length + 1; const newText = dialogInputText.slice(0, atSuggestionsCursor) + `@图${newIdx} ` + dialogInputText.slice(atSuggestionsCursor + 1); setDialogInputText(newText); setAtSuggestionsOpen(false); dialogInputRef.current?.focus(); }} className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-[#2e2e36] rounded-lg">
                              <ProgressivePreviewImage
                                fullSrc={item.data}
                                cacheKey={`dialog-at-temp:${item.id}`}
                                thumbMaxEdge={64}
                                className="w-8 h-8 shrink-0 rounded overflow-hidden"
                                imgClassName="w-8 h-8 rounded object-cover shrink-0"
                                alt=""
                              />
                              <span className="truncate">{item.label || `临时库 ${i + 1}`}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={handleDialogSend} disabled={dialogSendingSessionIds.includes(dialogActiveSessionIdResolved) || !dialogInputText.trim()} className="inline-flex h-12 items-center justify-center px-8 rounded-xl text-[10px] font-black uppercase shrink-0 transition-all bg-blue-600 text-white hover:bg-blue-500 shadow-md shadow-blue-600/25 border border-blue-500/30 self-end disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:border-transparent disabled:hover:bg-blue-600">发送</button>
                  </div>
                </div>
                </div>

                {/* 右侧：临时库（生图与识别物体自动加入，可筛全部/当前对话，删会话会同步清理） */}
                <div
                  className="w-52 lg:w-64 shrink-0 flex flex-col ring-1 ring-white/[0.06] rounded-2xl overflow-hidden bg-[#121214] h-[calc(100dvh-6rem)]"
                  onPaste={handleDialogTempLibraryPaste}
                  onDragOver={handleDialogTempLibraryDragOver}
                  onDrop={handleDialogTempLibraryDrop}
                >
                  <div className="flex-shrink-0 px-3 py-2 border-b border-white/[0.06] flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">临时库</span>
                    <div className="flex rounded-lg overflow-hidden ring-1 ring-white/[0.06]">
                      <button onClick={() => setDialogTempLibraryFilter('all')} className={`px-2 py-1.5 text-[9px] font-black ${dialogTempLibraryFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-[#1c1c22] text-gray-500 hover:bg-[#2e2e36]'}`}>全部</button>
                      <button onClick={() => setDialogTempLibraryFilter('current')} className={`px-2 py-1.5 text-[9px] font-black ${dialogTempLibraryFilter === 'current' ? 'bg-blue-600 text-white' : 'bg-[#1c1c22] text-gray-500 hover:bg-[#2e2e36]'}`}>当前</button>
                    </div>
                  </div>
                  {dialogTempFiltered.length > 0 && (
                    <div className="flex-shrink-0 px-2 py-1.5 border-b border-[#252528] flex flex-wrap items-center gap-1.5">
                      <button onClick={handleDialogTempSelectAll} className="shrink-0 px-2 py-1 rounded bg-[#1c1c22] text-[8px] font-black text-gray-400 hover:bg-[#2e2e36] whitespace-nowrap">全选</button>
                      <button onClick={handleDialogTempInvertSelect} className="shrink-0 px-2 py-1 rounded bg-[#1c1c22] text-[8px] font-black text-gray-400 hover:bg-[#2e2e36] whitespace-nowrap">反选</button>
                      <button onClick={handleDialogTempBatchDownload} disabled={dialogTempSelectedIds.size === 0} className="shrink-0 px-2 py-1 rounded bg-[#365e92] text-[8px] font-black text-white hover:bg-blue-600 disabled:opacity-40 whitespace-nowrap">批量下载{dialogTempSelectedIds.size > 0 ? `(${dialogTempSelectedIds.size})` : ''}</button>
                    </div>
                  )}
                  <div className="flex-1 overflow-y-auto no-scrollbar p-2 min-h-0" onMouseDown={handleDialogTempMarqueeMouseDown}>
                    {dialogTempFiltered.length === 0 ? (
                      <div className="flex items-center justify-center py-12 text-[9px] text-gray-500 px-4 text-center">生图、用户上传与识别物体会自动加入此处</div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {dialogTempFiltered.map(item => (
                          <div
                            key={item.id}
                            ref={(el) => { dialogTempItemRefs.current[item.id] = el; }}
                            onClick={() => {
                              setDialogChatImagePreview(null);
                              setDialogTempPreviewId(item.id);
                            }}
                            className={`relative group rounded-xl overflow-hidden border bg-[#1c1c22] aspect-square cursor-pointer ${
                              dialogTempSelectedIds.has(item.id)
                                ? 'border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.45)]'
                                : 'ring-1 ring-white/[0.06] border-transparent'
                            }`}
                          >
                            <ProgressivePreviewImage
                              fullSrc={item.data}
                              cacheKey={`dialog-temp-grid:${item.id}`}
                              thumbMaxEdge={512}
                              className="w-full h-full cursor-pointer"
                              imgClassName="w-full h-full object-cover cursor-pointer"
                              alt=""
                              title="点击查看大图"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDialogChatImagePreview(null);
                                setDialogTempPreviewId(item.id);
                              }}
                            />
                            {item.label && <span className="absolute bottom-0 left-0 right-0 py-0.5 text-center text-[9px] font-black bg-[#1a1a1e] text-white truncate">{item.label}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {dialogTempMarqueeRect && (
                  <div
                    className="fixed z-[1900] pointer-events-none border border-blue-400/70 bg-blue-500/20"
                    style={{
                      left: dialogTempMarqueeRect.left,
                      top: dialogTempMarqueeRect.top,
                      width: dialogTempMarqueeRect.width,
                      height: dialogTempMarqueeRect.height,
                    }}
                  />
                )}
              </div>
              {(dialogTempPreviewId || dialogChatImagePreview) && (() => {
                const tempItem = dialogTempPreviewId ? dialogTempLibrary.find((x) => x.id === dialogTempPreviewId) : null;
                const item: DialogTempItem | null =
                  tempItem ??
                  (dialogChatImagePreview
                    ? {
                        id: `__chat_inline__${dialogChatImagePreview.messageId}`,
                        data: dialogChatImagePreview.data,
                        sourceSessionId: dialogActiveSessionIdResolved,
                        sourceMessageId: dialogChatImagePreview.messageId,
                        sourceType: dialogChatImagePreview.sourceType,
                        userPrompt: dialogChatImagePreview.userPrompt,
                        understoodPrompt: dialogChatImagePreview.understoodPrompt,
                        timestamp: dialogChatImagePreview.timestamp,
                      }
                    : null);
                if (!item) return null;
                return (
                  <div
                    ref={dialogTempPreviewOverlayRef}
                    tabIndex={-1}
                    role="dialog"
                    aria-modal
                    className="fixed inset-0 z-[2000] bg-black/72 backdrop-blur-sm animate-in fade-in outline-none"
                    data-ac-block-workflow-marquee
                    onKeyDownCapture={(e) => {
                      if (!isImagePreviewEscapeKey(e)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      closeDialogImagePreview();
                    }}
                    onClick={() => closeDialogImagePreview()}
                    onContextMenuCapture={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <div
                      className="relative w-full h-full overflow-hidden"
                      onClick={e => e.stopPropagation()}
                      onContextMenuCapture={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      {dialogTempPreviewLayout === 'pano' && LazyDialogTempEquirectViewer ? (
                        <div
                          className="absolute inset-0 z-[5] min-h-[200px]"
                          onWheel={(e) => e.stopPropagation()}
                        >
                          <Suspense fallback={<PreviewViewerFallback label="全景模块加载中…" />}>
                            <LazyDialogTempEquirectViewer
                              imageSrc={item.data}
                              className="h-full w-full rounded-none border-0"
                            />
                          </Suspense>
                        </div>
                      ) : null}

                      {dialogTempPreviewLayout === 'flat' ? (
                        <img
                          src={item.data}
                          className="absolute left-1/2 top-1/2 max-w-[92vw] max-h-[88vh] object-contain rounded-xl shadow-2xl select-none cursor-zoom-in"
                          alt=""
                          draggable={false}
                          onContextMenu={(e) => e.preventDefault()}
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDialogTempPreviewScale(1);
                            setDialogTempPreviewOffset({ x: 0, y: 0 });
                            dialogTempPreviewDragRef.current = null;
                            dialogTempPreviewPanRef.current = null;
                            dialogTempPreviewZoomPivotRef.current = null;
                            dialogTempPreviewZoomLastScaleRef.current = 1;
                          }}
                          ref={dialogTempPreviewImgRef}
                          onMouseDown={(e) => {
                            if (e.button !== 0 && e.button !== 2) return;
                            e.preventDefault();
                            e.stopPropagation();
                            if (e.button === 0) {
                              const useLeftPan = e.shiftKey || dialogTempPreviewSpacePressedRef.current;
                              if (useLeftPan) {
                                dialogTempPreviewPanRef.current = {
                                  startX: e.clientX,
                                  startY: e.clientY,
                                  startOffsetX: dialogTempPreviewOffset.x,
                                  startOffsetY: dialogTempPreviewOffset.y,
                                };
                                return;
                              }
                              dialogTempPreviewZoomPivotRef.current = { x: e.clientX, y: e.clientY };
                              dialogTempPreviewZoomLastScaleRef.current = dialogTempPreviewScale;
                              dialogTempPreviewDragRef.current = {
                                startX: e.clientX,
                                startY: e.clientY,
                                startScale: dialogTempPreviewScale,
                              };
                              return;
                            }
                            dialogTempPreviewPanRef.current = {
                              startX: e.clientX,
                              startY: e.clientY,
                              startOffsetX: dialogTempPreviewOffset.x,
                              startOffsetY: dialogTempPreviewOffset.y,
                            };
                          }}
                          style={{
                            transform: `translate(-50%, -50%) translate(${dialogTempPreviewOffset.x}px, ${dialogTempPreviewOffset.y}px) scale(${dialogTempPreviewScale})`,
                            transformOrigin: 'center center',
                          }}
                        />
                      ) : null}

                      <div className="absolute top-4 left-3 z-10 max-w-[min(300px,calc(100vw-6rem))] rounded-xl bg-[#101018]/90 ring-1 ring-white/[0.06] px-3 py-2 text-[9px] text-gray-300 pointer-events-none text-left leading-relaxed space-y-1">
                        {dialogTempPreviewLayout === 'pano' ? (
                          <>
                            <div>拖拽：旋转视角（360° 全景）</div>
                            <div>滚轮：调整视野宽窄</div>
                            <div>切回「平面」后可滚轮切图 / 缩放平移</div>
                            <div>Esc：关闭预览</div>
                          </>
                        ) : (
                          <>
                            <div>对话中点击生成图 / 附图也可打开此预览</div>
                            <div>滚轮：上一张 / 下一张（与临时库一致；仅从临时库打开时切换）</div>
                            <div>Esc：关闭预览</div>
                            <div>双击：复原缩放与位置</div>
                            <div>左键：缩放</div>
                            <div>空格+左键 / Shift+左键 / 右键：平移画布</div>
                            <div className="text-gray-500 pt-0.5 border-t border-white/10">当前缩放 {Math.round(dialogTempPreviewScale * 100)}%</div>
                          </>
                        )}
                      </div>

                      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
                        <div
                          className="flex rounded-xl ring-1 ring-white/[0.06] overflow-hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => setDialogTempPreviewLayout('flat')}
                            className={`px-3 py-2 text-[10px] font-black uppercase transition-colors ${
                              dialogTempPreviewLayout === 'flat'
                                ? 'bg-blue-600 text-white'
                                : 'bg-[#1a1a1e]/95 text-gray-300 hover:bg-[#2a2a32]'
                            }`}
                          >
                            平面
                          </button>
                          <button
                            type="button"
                            onClick={() => setDialogTempPreviewLayout('pano')}
                            className={`px-3 py-2 text-[10px] font-black uppercase transition-colors border-l border-white/[0.08] ${
                              dialogTempPreviewLayout === 'pano'
                                ? 'bg-blue-600 text-white'
                                : 'bg-[#1a1a1e]/95 text-gray-300 hover:bg-[#2a2a32]'
                            }`}
                          >
                            全景
                          </button>
                        </div>
                        <button type="button" onClick={() => closeDialogImagePreview()} className="px-3 py-2 rounded-xl bg-[#1a1a1e]/95 ring-1 ring-white/[0.06] text-[10px] font-black text-white hover:bg-[#2a2a32]">关闭</button>
                      </div>

                      <div
                        className="absolute left-3 bottom-4 max-w-[min(680px,92vw)] rounded-xl bg-[#1c1c22]/95 ring-1 ring-white/[0.06] p-4 space-y-2 text-left"
                        data-no-temp-preview-wheel
                      >
                        <div className="text-[9px] font-black text-gray-500 uppercase">类型</div>
                        <div className="text-[11px] text-white">{dialogTempSourceTypeLabel(item.sourceType)}{item.label ? ` · ${item.label}` : ''}</div>
                        {(item.userPrompt || item.understoodPrompt) && (
                          <>
                            {item.userPrompt && (
                              <>
                                <div className="text-[9px] font-black text-gray-500 uppercase mt-2">用户描述</div>
                                <div className="text-[11px] text-gray-300 break-words max-h-20 overflow-y-auto" data-dialog-temp-preview-scroll>{item.userPrompt}</div>
                              </>
                            )}
                            {item.understoodPrompt && (
                              <>
                                <div className="text-[9px] font-black text-gray-500 uppercase mt-2">理解指令</div>
                                <div className="text-[11px] text-blue-300/90 break-words max-h-20 overflow-y-auto" data-dialog-temp-preview-scroll>{item.understoodPrompt}</div>
                              </>
                            )}
                          </>
                        )}
                        <div className="text-[9px] text-gray-500 mt-2">{new Date(item.timestamp).toLocaleString()}</div>
                      </div>

                      <div className="absolute right-4 bottom-4 flex flex-wrap items-center justify-end gap-2 max-w-[min(680px,92vw)]" data-no-temp-preview-wheel>
                        {item.sourceMessageId && (
                          <button onClick={() => { handleDialogTempLocateMessage(item); closeDialogImagePreview(); }} className="px-4 py-2 rounded-xl bg-[#1e40af] text-[10px] font-black text-white hover:bg-blue-500 transition-colors">定位消息</button>
                        )}
                        <button onClick={() => { handleDialogTempAddToInput(item); closeDialogImagePreview(); }} className="px-4 py-2 rounded-xl bg-[#15803d] text-[10px] font-black text-white hover:bg-[#22c55e] transition-colors">加入输入框</button>
                        <button onClick={() => addDialogTempToLibrary(item)} className="px-4 py-2 rounded-xl bg-[#1e40af] text-[10px] font-black text-white hover:bg-blue-500 transition-colors">加入资产库</button>
                        <button
                          type="button"
                          onClick={() => {
                            void triggerImageDownload(item.data, `临时库_${item.label || item.id}`);
                          }}
                          className="px-4 py-2 rounded-xl bg-[#26262c] text-[10px] font-black text-white hover:bg-[#383842] transition-colors"
                        >
                          下载
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
              </div>
            )}

            {/* 对话生图裁切编辑器：全屏选区，确认后作为新版本显示在对话中 */}
            {DIALOG_PAGE_ENABLED && dialogCropState && (
              <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                <div className="text-[10px] text-gray-400 mb-3">拖拽选择裁切区域，然后点击「确认裁切」</div>
                <div
                  className="inline-block max-w-full max-h-[70vh] relative cursor-crosshair select-none rounded-xl overflow-hidden ring-1 ring-white/[0.06]"
                  onMouseDown={handleDialogCropMouseDown}
                >
                  <img
                    ref={dialogCropImgRef}
                    src={dialogCropState.imageBase64}
                    alt="裁切"
                    className="max-w-full max-h-full object-contain block pointer-events-none"
                    draggable={false}
                  />
                </div>
                {dialogCropStart && dialogCropCurrent && (() => {
                  const left = Math.min(dialogCropStart.x, dialogCropCurrent.x);
                  const top = Math.min(dialogCropStart.y, dialogCropCurrent.y);
                  const w = Math.abs(dialogCropCurrent.x - dialogCropStart.x);
                  const h = Math.abs(dialogCropCurrent.y - dialogCropStart.y);
                  if (w < 2 && h < 2) return null;
                  return (
                    <div
                      className="absolute pointer-events-none border border-dashed border-blue-400/75 bg-blue-500/15 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.25)]"
                      style={{ position: 'fixed', left, top, width: w, height: h, zIndex: 2001 }}
                    />
                  );
                })()}
                <div className="flex items-center gap-3 mt-4">
                  <button onClick={handleDialogCropExecute} className="px-5 py-2.5 rounded-xl bg-blue-600 text-[10px] font-black text-white hover:bg-blue-500 transition-colors">确认裁切</button>
                  <button onClick={handleDialogCropCancel} className="px-5 py-2.5 rounded-xl bg-[#26262c] border border-[#3a3a40] text-[10px] font-black text-white hover:bg-[#383842] transition-colors">取消</button>
                </div>
              </div>
            )}

            {mode === AppMode.LIBRARY && (
              <div className="flex flex-col lg:flex-row gap-10 animate-in fade-in">
                 <div className="w-full lg:w-48 shrink-0 flex flex-col gap-4">
                   <div className="flex flex-row lg:flex-col gap-2 overflow-x-auto no-scrollbar pb-2 lg:pb-0">
                     {(['ALL', 'SCENE_OBJECT', 'PREVIEW_STRIP', 'PRODUCTION_ASSET', 'MESH_MODEL', 'TEXTURE_MAP'] as const).map(cat => (
                       <button key={cat} onClick={() => setLibFilter(cat)} className={`px-6 py-3 rounded-xl text-[9px] font-black uppercase border transition-all whitespace-nowrap ${libFilter === cat ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#1c1c22] border-transparent text-gray-500 hover:bg-[#2e2e36]'}`}>{LIBRARY_CATEGORY_LABELS[cat]}</button>
                     ))}
                   </div>
                   <p className="text-[9px] text-gray-500 uppercase tracking-widest">共 {groupedLibrary.length} 组</p>
                   <label className="px-4 py-2.5 rounded-xl bg-[#1e3558] border border-[#3b6fb8] text-[9px] font-black uppercase text-blue-300 cursor-pointer hover:bg-[#305a90] text-center">
                     上传图片
                    <input type="file" className="hidden" accept="image/*" multiple onChange={(e: React.ChangeEvent<HTMLInputElement>) => { const input = e.currentTarget; const files: File[] = input.files ? Array.from(input.files) : []; files.filter((f) => f.type.startsWith('image/')).slice(0, 50).forEach((f) => { const r = new FileReader(); r.onload = () => addToLibrary([{ data: r.result as string, type: 'SLICE', category: 'SCENE_OBJECT', label: f.name.replace(/\.[^.]+$/, '') || '上传图片' }]); r.readAsDataURL(f); }); input.value = ''; }} />
                   </label>
                 </div>
                 <div className="flex-1 flex flex-col gap-4">
                   <div className="flex flex-wrap items-center gap-2">
                     <span className="text-[9px] font-black text-gray-500 uppercase">批量操作</span>
                     <button onClick={handleLibSelectAll} className="px-3 py-2 rounded-xl text-[9px] font-black uppercase ring-1 ring-white/[0.06] bg-[#1c1c22] hover:bg-[#2e2e36]">全选</button>
                     <button onClick={handleLibInvertSelect} className="px-3 py-2 rounded-xl text-[9px] font-black uppercase ring-1 ring-white/[0.06] bg-[#1c1c22] hover:bg-[#2e2e36]">反选</button>
                     <button onClick={handleLibBatchDownload} disabled={libSelectedGroupIds.size === 0} className="px-3 py-2 rounded-xl text-[9px] font-black uppercase border border-[#3b82f6] bg-[#1e3558] text-blue-300 hover:bg-[#305a90] disabled:opacity-40 disabled:cursor-not-allowed">批量下载（{libSelectedGroupIds.size}）</button>
                   </div>
                   {groupedLibrary.length === 0 ? (
                     <div className="flex flex-col items-center justify-center py-20 text-center">
                       <AppIcon name="package" className="w-12 h-12 mb-4 opacity-60" />
                       <p className="text-[11px] font-black uppercase tracking-widest text-gray-500 mb-2">暂无资产</p>
                       <p className="text-[10px] text-gray-600 max-w-sm">
                         {DIALOG_PAGE_ENABLED
                           ? '可点击左侧「上传图片」、或从「对话」、工作流生成结果保存到资产库。'
                           : '可点击左侧「上传图片」、或从工作流生成结果保存到资产库。'}
                       </p>
                     </div>
                   ) : (
                     <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                       {groupedLibrary.map((group) => (
                         <LibraryCard
                           key={group[0].groupId}
                           items={group}
                           isSelected={libSelectedGroupIds.has(group[0].groupId)}
                           onToggleSelect={() => {
                             const gid = group[0].groupId;
                             setLibSelectedGroupIds(prev => { const n = new Set(prev); if (n.has(gid)) n.delete(gid); else n.add(gid); return n; });
                           }}
                           onDelete={handleLibDeleteGroup}
                           onSendToDialog={DIALOG_PAGE_ENABLED ? sendLibraryItemToDialog : undefined}
                           onSendToTexture={sendLibraryItemToTexture}
                         />
                       ))}
                     </div>
                   )}
                 </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {showBackToTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-[1000] w-10 h-10 rounded-full bg-[#26262c] border border-[#3a3a40] flex items-center justify-center text-white/90 hover:bg-[#383842] hover:border-[#484850] transition-colors duration-200 shadow-lg cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]"
          title="回到顶部"
          aria-label="回到顶部"
        >
          <AppIcon name="chevron-up" className="w-5 h-5" />
        </button>
      )}

      {workspaceCloudLeaveSyncing ? (
        <div
          className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/75 backdrop-blur-sm px-6"
          role="alertdialog"
          aria-live="assertive"
          aria-busy="true"
        >
          <div className="max-w-md rounded-2xl border border-amber-500/45 bg-[#101018] px-6 py-5 shadow-2xl text-center">
            <p className="text-[13px] font-semibold text-amber-100/95 leading-relaxed">
              正在同步当前工作区索引信息到云端，请稍候…
            </p>
            <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
              完成前请勿关闭或刷新页面，以免索引状态未及时更新。
            </p>
            <div className="mt-4 flex justify-center" aria-hidden>
              <span className="inline-block h-8 w-8 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
            </div>
          </div>
        </div>
      ) : null}

      {workspaceCloudChoicePrompt ? (
        <div
          className="fixed inset-0 z-[5500] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workspace-cloud-choice-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f0f0f] shadow-2xl px-6 py-5">
            <h2 id="workspace-cloud-choice-title" className="text-[14px] font-semibold text-white">
              {workspaceCloudChoicePrompt.kind === 'quotaBack'
                ? '云空间已满'
                : workspaceCloudChoicePrompt.kind === 'switch'
                ? '同步失败'
                : '同步失败'}
            </h2>
            <p className="mt-3 text-[12px] text-gray-300 leading-relaxed">
              {workspaceCloudChoicePrompt.kind === 'quotaBack'
                ? '近期修改可能未同步到云端，仅保存在本机。确定返回项目列表？'
                : workspaceCloudChoicePrompt.kind === 'switch'
                ? '无法将当前项目上传到云端。仍要切换到其他项目吗？未上传的修改可能丢失。'
                : '无法将当前画布与图片上传到云端。仍要返回项目列表吗？未上传的修改可能仅保存在本机。'}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setWorkspaceCloudChoicePrompt(null)}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-[11px] font-medium text-gray-200 hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                {workspaceCloudChoicePrompt.kind === 'switch' ? '留在当前项目' : '留在画布'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const p = workspaceCloudChoicePrompt;
                  setWorkspaceCloudChoicePrompt(null);
                  if (p.kind === 'quotaBack') {
                    void backToWorkspaceProjectShell({ skipQuotaBackConfirm: true });
                  } else if (p.kind === 'back') {
                    proceedBackToWorkspaceShell();
                  } else {
                    loadWorkspaceProjectInternal(p.targetId);
                  }
                }}
                className="rounded-xl border border-amber-600/50 bg-amber-900/30 px-4 py-2.5 text-[11px] font-medium text-amber-100 hover:bg-amber-900/45 outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
              >
                {workspaceCloudChoicePrompt.kind === 'switch' ? '仍要切换' : '仍要返回列表'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {workspaceProjectDeletePending ? (
        <div
          className="fixed inset-0 z-[5600] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workspace-delete-title"
          onClick={() => setWorkspaceProjectDeletePending(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f0f0f] shadow-2xl px-6 py-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="workspace-delete-title" className="text-[14px] font-semibold text-white">
              删除项目
            </h2>
            <p className="mt-3 text-[12px] text-gray-300 leading-relaxed">
              确定将「
              <span className="text-white font-medium">{workspaceProjectDeletePending.name}</span>
              」移入回收站吗？你可以在回收站中恢复该项目。
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setWorkspaceProjectDeletePending(null)}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-[11px] font-medium text-gray-200 hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = workspaceProjectDeletePending.id;
                  setWorkspaceProjectDeletePending(null);
                  performDeleteWorkspaceProject(id);
                }}
                className="rounded-xl border border-amber-500/40 bg-amber-950/40 px-4 py-2.5 text-[11px] font-medium text-amber-100 hover:bg-amber-900/50 outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
              >
                移入回收站
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {workspaceProjectBindPending ? (
        <div
          className="fixed inset-0 z-[5600] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workspace-bind-title"
          onClick={() => setWorkspaceProjectBindPending(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f0f0f] shadow-2xl px-6 py-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="workspace-bind-title" className="text-[14px] font-semibold text-white">
              绑定到当前账号
            </h2>
            <p className="mt-3 text-[12px] text-gray-300 leading-relaxed">
              确定将「
              <span className="text-white font-medium">{workspaceProjectBindPending.name}</span>
              」绑定到当前账号吗？该操作只同步项目索引，不上传本地大文件。
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setWorkspaceProjectBindPending(null)}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-[11px] font-medium text-gray-200 hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = workspaceProjectBindPending.id;
                  setWorkspaceProjectBindPending(null);
                  void performBindWorkspaceProject(id);
                }}
                className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-4 py-2.5 text-[11px] font-medium text-emerald-100 hover:bg-emerald-900/50 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
              >
                绑定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {workspaceProjectUnbindPending ? (
        <div
          className="fixed inset-0 z-[5600] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workspace-unbind-title"
          onClick={() => setWorkspaceProjectUnbindPending(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f0f0f] shadow-2xl px-6 py-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="workspace-unbind-title" className="text-[14px] font-semibold text-white">
              解绑当前账号
            </h2>
            <p className="mt-3 text-[12px] text-gray-300 leading-relaxed">
              确定解除「
              <span className="text-white font-medium">{workspaceProjectUnbindPending.name}</span>
              」与当前账号的索引绑定吗？该操作不删除本地项目目录与内容。
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setWorkspaceProjectUnbindPending(null)}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-[11px] font-medium text-gray-200 hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = workspaceProjectUnbindPending.id;
                  setWorkspaceProjectUnbindPending(null);
                  void performUnbindWorkspaceProject(id);
                }}
                className="rounded-xl border border-amber-500/40 bg-amber-950/40 px-4 py-2.5 text-[11px] font-medium text-amber-100 hover:bg-amber-900/50 outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
              >
                解绑
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {workspaceProjectManualUploadPending ? (
        <div
          className="fixed inset-0 z-[5600] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workspace-manual-upload-title"
          onClick={() => {
            setWorkspaceProjectManualUploadPending(null);
            setWorkspaceManualUploadMode('full');
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f0f0f] shadow-2xl px-6 py-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="workspace-manual-upload-title" className="text-[14px] font-semibold text-white">
              手动上传项目资产
            </h2>
            <p className="mt-3 text-[12px] text-gray-300 leading-relaxed">
              确定将「
              <span className="text-white font-medium">{workspaceProjectManualUploadPending.name}</span>
              」的工作流资产手动上传到云端吗？该操作可能耗时，并会占用账号云空间。
            </p>
            <div className="mt-3">
              <div className="text-[10px] text-gray-400 mb-1">上传模式</div>
              <CustomDropdown
                value={workspaceManualUploadMode}
                options={[
                  { value: 'full', label: '全量上传' },
                  { value: 'incremental', label: '仅上传新增/变更' },
                ]}
                onChange={(v) => setWorkspaceManualUploadMode(v === 'incremental' ? 'incremental' : 'full')}
                triggerClassName={DROPDOWN_TRIGGER_COMPACT}
              />
            </div>
            {(() => {
              const estimate =
                workspaceManualUploadMode === 'incremental'
                  ? workspaceProjectManualUploadPending.incrementalEstimate
                  : workspaceProjectManualUploadPending.fullEstimate;
              const unresolvedIncremental =
                workspaceManualUploadMode === 'incremental' && !workspaceProjectManualUploadPending.incrementalReady;
              return (
                <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-gray-300 space-y-1">
                  {unresolvedIncremental ? (
                    <div className="text-amber-200/90">正在读取云端基线，稍后可见增量预估；若失败将按全量上传执行。</div>
                  ) : (
                    <>
                      <div>资产数：{estimate?.assetCount ?? 0}</div>
                      <div>预览图：{estimate?.previewCount ?? 0}</div>
                      <div>模型引用：{estimate?.modelCount ?? 0}</div>
                      <div>
                        预估上传体积：
                        <span className="text-cyan-200 ml-1">{formatApproxBytes(estimate?.bytesApprox ?? 0)}</span>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setWorkspaceProjectManualUploadPending(null);
                  setWorkspaceManualUploadMode('full');
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-[11px] font-medium text-gray-200 hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = workspaceProjectManualUploadPending.id;
                  setWorkspaceProjectManualUploadPending(null);
                  void performManualUploadWorkspaceProject(id);
                }}
                className="rounded-xl border border-cyan-500/40 bg-cyan-950/40 px-4 py-2.5 text-[11px] font-medium text-cyan-100 hover:bg-cyan-900/50 outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
              >
                确认上传
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {workspaceUploadFailureDetailDialog ? (
        (() => {
          const uid = userIdRef.current ?? null;
          const bundle = loadWorkflowBundle(workspaceUploadFailureDetailDialog.projectId, uid);
          const existingSet = new Set(bundle.assets.map((a) => String(a?.id || '')).filter(Boolean));
          const filterQ = workspaceUploadFailureFilter.trim().toLowerCase();
          const allFailedIds = workspaceUploadFailureDetailDialog.failedAssetIds;
          const visibleFailedIds = filterQ
            ? allFailedIds.filter((id) => String(id).toLowerCase().includes(filterQ))
            : allFailedIds;
          const selectedExistingCount = workspaceUploadFailureDetailDialog.selectedAssetIds.filter((id) => existingSet.has(id)).length;
          const selectedMissingCount = Math.max(0, workspaceUploadFailureDetailDialog.selectedAssetIds.length - selectedExistingCount);
          return (
        <div
          className="fixed inset-0 z-[5600] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workspace-upload-failure-detail-title"
          onClick={() => {
            setWorkspaceUploadFailureFilter('');
            setWorkspaceUploadFailureDetailDialog(null);
          }}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0f0f0f] shadow-2xl px-6 py-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="workspace-upload-failure-detail-title" className="text-[14px] font-semibold text-white">
              上传失败项详情
            </h2>
            <p className="mt-2 text-[12px] text-gray-300 leading-relaxed">
              项目：<span className="text-white font-medium">{workspaceUploadFailureDetailDialog.projectName}</span>
            </p>
            <p className="mt-1 text-[11px] text-gray-400">
              模式：{workspaceUploadFailureDetailDialog.mode === 'incremental' ? '仅上传新增/变更' : '全量上传'}
              {' · '}
              尝试 {workspaceUploadFailureDetailDialog.attempted}
              {' · '}
              成功 {workspaceUploadFailureDetailDialog.succeeded}
              {' · '}
              失败 {Math.max(0, workspaceUploadFailureDetailDialog.attempted - workspaceUploadFailureDetailDialog.succeeded)}
            </p>
            {workspaceUploadFailureDetailDialog.uploadedAt ? (
              <p className="mt-1 text-[11px] text-gray-500">
                时间：{new Date(workspaceUploadFailureDetailDialog.uploadedAt).toLocaleString()}
              </p>
            ) : null}
            {workspaceUploadFailureDetailDialog.error ? (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-900/20 px-3 py-2 text-[11px] text-amber-100">
                错误摘要：{workspaceUploadFailureDetailDialog.error}
              </p>
            ) : null}
            <div className="mt-3">
              <label htmlFor="workspace-upload-failure-filter" className="text-[10px] text-gray-500">
                过滤 assetId
              </label>
              <input
                id="workspace-upload-failure-filter"
                type="text"
                value={workspaceUploadFailureFilter}
                onChange={(e) => setWorkspaceUploadFailureFilter(e.target.value)}
                placeholder="输入片段匹配…"
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#1c1c22] px-3 py-2 text-[11px] text-white outline-none focus:border-blue-500 placeholder:text-gray-600"
              />
              <p className="mt-1 text-[10px] text-gray-500">
                列表显示 {visibleFailedIds.length} / {allFailedIds.length} 项
                {filterQ ? '（已启用过滤）' : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyWorkspaceFailureIdsToClipboard('visible')}
                  className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-gray-200 hover:bg-white/10"
                  title="含首行注释（项目名、projectId、模式、时间）"
                >
                  复制当前列表
                </button>
                <button
                  type="button"
                  onClick={() => void copyWorkspaceFailureIdsToClipboard('selected')}
                  className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-gray-200 hover:bg-white/10"
                  title="仅复制当前勾选的 assetId，含首行注释"
                >
                  复制已勾选
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setWorkspaceUploadFailureDetailDialog((prev) =>
                    prev ? { ...prev, selectedAssetIds: [...prev.failedAssetIds] } : prev
                  )
                }
                className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-gray-200 hover:bg-white/10"
              >
                全选
              </button>
              <button
                type="button"
                onClick={() =>
                  setWorkspaceUploadFailureDetailDialog((prev) =>
                    prev ? { ...prev, selectedAssetIds: [] } : prev
                  )
                }
                className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-gray-200 hover:bg-white/10"
              >
                全不选
              </button>
              <button
                type="button"
                onClick={() =>
                  setWorkspaceUploadFailureDetailDialog((prev) =>
                    prev
                      ? {
                          ...prev,
                          selectedAssetIds: prev.failedAssetIds.filter((id) => existingSet.has(id)),
                        }
                      : prev
                  )
                }
                className="rounded-lg border border-cyan-500/35 bg-cyan-900/20 px-2.5 py-1 text-[10px] text-cyan-200 hover:bg-cyan-900/35"
              >
                仅选本地仍存在
              </button>
              <button
                type="button"
                onClick={() =>
                  setWorkspaceUploadFailureDetailDialog((prev) =>
                    prev ? { ...prev, selectedAssetIds: [...visibleFailedIds] } : prev
                  )
                }
                className="rounded-lg border border-blue-500/35 bg-blue-900/20 px-2.5 py-1 text-[10px] text-blue-200 hover:bg-blue-900/35"
                title="将勾选范围设为当前列表中的全部项"
              >
                仅选当前列表
              </button>
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-2 max-h-64 overflow-y-auto space-y-1">
              {visibleFailedIds.length === 0 ? (
                <p className="px-2 py-3 text-[11px] text-gray-500">无匹配项，请调整过滤关键字。</p>
              ) : null}
              {visibleFailedIds.map((assetId) => {
                const selected = workspaceUploadFailureDetailDialog.selectedAssetIds.includes(assetId);
                const exists = existingSet.has(assetId);
                return (
                  <label key={assetId} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/[0.04] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        setWorkspaceUploadFailureDetailDialog((prev) => {
                          if (!prev) return prev;
                          const has = prev.selectedAssetIds.includes(assetId);
                          return {
                            ...prev,
                            selectedAssetIds: has
                              ? prev.selectedAssetIds.filter((id) => id !== assetId)
                              : [...prev.selectedAssetIds, assetId],
                          };
                        })
                      }
                    />
                    <span className="text-[11px] text-gray-200 font-mono break-all">{assetId}</span>
                    {!exists ? <span className="text-[10px] text-amber-300/90">（本地不存在）</span> : null}
                  </label>
                );
              })}
            </div>
            <div className="mt-2 text-[10px] text-gray-500">
              已选择 {workspaceUploadFailureDetailDialog.selectedAssetIds.length} / {workspaceUploadFailureDetailDialog.failedAssetIds.length}
            </div>
            <div className="mt-1 text-[10px] text-gray-500">
              将重试 {selectedExistingCount} 项（不可用 {selectedMissingCount} 项）
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setWorkspaceUploadFailureFilter('');
                  setWorkspaceUploadFailureDetailDialog(null);
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-[11px] font-medium text-gray-200 hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={() => void retrySelectedFailedManualUploadWorkspaceProject()}
                disabled={selectedExistingCount <= 0}
                className="rounded-xl border border-amber-500/40 bg-amber-950/40 px-4 py-2.5 text-[11px] font-medium text-amber-100 hover:bg-amber-900/50 outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                重试所选失败项
              </button>
            </div>
          </div>
        </div>
          );
        })()
      ) : null}
      {workspaceUploadFailureCopyFallback ? (
        <div
          className="fixed inset-0 z-[5700] flex items-center justify-center bg-black/75 backdrop-blur-sm px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workspace-upload-copy-fallback-title"
          onClick={() => setWorkspaceUploadFailureCopyFallback(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0f0f0f] shadow-2xl px-6 py-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="workspace-upload-copy-fallback-title" className="text-[14px] font-semibold text-white">
              手动复制文本
            </h2>
            <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
              来源：
              <span className="text-gray-300">
                {workspaceUploadFailureCopyFallback.kind === 'visible' ? '当前列表' : '已勾选'}
              </span>
              。系统无法自动写入剪贴板（可能受浏览器权限或非安全上下文限制）；请全选下方文本后使用 Ctrl+C / Cmd+C 复制。
            </p>
            <textarea
              ref={workspaceUploadFailureCopyFallbackTextareaRef}
              readOnly
              value={workspaceUploadFailureCopyFallback.text}
              rows={14}
              spellCheck={false}
              className="mt-3 w-full resize-y rounded-xl border border-white/10 bg-[#1c1c22] px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-200 outline-none focus:border-blue-500"
            />
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setWorkspaceUploadFailureCopyFallback(null)}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-[11px] font-medium text-gray-200 hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const App: React.FC = () => {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  if (pathname.startsWith('/admin')) {
    return (
      <>
        <GeminiFairnessFloatingNotice />
        <Suspense fallback={<div className="min-h-screen bg-[#050505] flex items-center justify-center text-[11px] text-gray-500">加载中…</div>}>
          <RequireRole role="admin">
            <AdminAppShell />
          </RequireRole>
        </Suspense>
      </>
    );
  }
  return (
    <>
      <GeminiFairnessFloatingNotice />
      <MainApp />
    </>
  );
};

export default App;
