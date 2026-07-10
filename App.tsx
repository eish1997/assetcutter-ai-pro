
import React, { Suspense, useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_PROMPTS,
  normalizeApiErrorMessage,
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
import { coerceTextModelRegistryId } from './services/modelRegistry/textModels';
import { useEffectiveImageModelRows } from './hooks/useEffectiveImageGearRows';
import { DEFAULT_IMAGE_MODEL_REGISTRY_ID } from './services/modelRegistry/imageModels';
import { loadSnippets } from './services/snippetStore';
import { AppMode, LibraryItem, SystemConfig, AppTask, AssetCategory, type CustomAppModule, type CapabilitySet, type WorkflowAsset, type WorkflowPendingTask, type ArenaCurrentStep, type ArenaStepEntry, type ArenaTimelineBlock } from './types';
import { runCapabilityTest } from './services/capabilityTestRunner';
import { executeCapability } from './services/capabilityExecutor';
import { initAgentWorkbenchBridge } from './services/agentWorkbenchBridge';
import { loadCapabilityPresets, saveCapabilityPresets, CAPABILITY_PRESETS_KEY } from './services/capabilityPresetStore';
import { loadCapabilitySets, saveCapabilitySets, CAPABILITY_SETS_KEY } from './services/capabilitySetStore';
import { useWorkflowMainScrollCapture, type WorkflowCapabilityGutterDropConfig } from './hooks/useWorkflowMainScrollCapture';
import { useAuth } from './components/auth/AuthContext';
import { canAccessAdminPanel } from './services/authClient';
import { navigateAdmin } from './services/adminNavigate';
import { CustomDropdown } from './components/ui/CustomDropdown';
import { SidebarAccountAvatar } from './components/SidebarAccountAvatar';
import LazySectionFallback from './components/ui/LazySectionFallback';
import WorkflowModeShell from './components/WorkflowModeShell';
import WorkspaceSidebarFooter from './components/WorkspaceSidebarFooter';
import { useUserUiPrefs } from './hooks/useUserUiPrefs';
import { useCreditBalance } from './hooks/useCreditBalance';
import Waves from './components/ui/Waves';
import AppIcon from './components/ui/AppIcon';
import GeminiFairnessFloatingNotice from './components/GeminiFairnessFloatingNotice';
import DownloadSavedFloatingNotice from './components/DownloadSavedFloatingNotice';
import {
  AC_GEMINI_QUEUE_HINT_EVENT,
  AC_GEMINI_QUEUE_PROGRESS_EVENT,
  AC_GEMINI_QUEUE_RETRY_WAIT_EVENT,
  formatGeminiFairnessRetryWaitLog,
  formatGeminiQueueHintLog,
  formatGeminiQueueProgressLog,
  type AcGeminiQueueHintDetail,
  type AcGeminiQueueProgressDetail,
  type AcGeminiQueueRetryWaitDetail,
} from './services/geminiQueueProgress';
import { AC_WORKFLOW_RETRY_TASK_EVENT } from './services/workflowTaskRetry';
import { shouldShowTripoRecoveryBanner, type GlobalLogEntry } from './services/globalLogFilter';
import { GlobalLogFilterBar } from './components/globalLog/GlobalLogFilterBar';
import { useGlobalLogFilter } from './hooks/useGlobalLogFilter';
import {
  RIGHT_DOCK_LOG_BOTTOM,
  RIGHT_DOCK_LOG_PANEL_Z_INDEX,
  RIGHT_DOCK_LOG_Z_INDEX,
  RIGHT_DOCK_PANEL_BOTTOM,
  RIGHT_DOCK_RIGHT,
} from './components/floatingDockConstants';
import { isWorkflowEditableTarget } from './components/workflow/workflowDomUtils';
import {
  WORKFLOW_QUICK_COMPOSE_DOCKED_INSET,
  WORKFLOW_QUICK_COMPOSE_DOCKED_WIDTH_CLASS,
} from './components/workflow/workflowSectionUiConstants';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal';
import { AC_NAVIGATE_SETTINGS_EVENT } from './services/navigateSettings';
import { flushProjectAgentBackupRetryQueue } from './services/projectAgent';
import { SiteImage } from './components/SiteImage';
import { armChunkReloadRecovery, importWithChunkRetry } from './services/lazyImportWithRetry';
import {
  loadWorkspaceProjects,
  saveWorkspaceProjects,
  createWorkspaceProject,
  getLastOpenedWorkspaceProjectId,
  loadWorkflowBundle,
  saveWorkflowBundle,
  consumeWorkspaceMigrationNotices,
  consumeWorkflowBundleLoadDegraded,
  trySaveWorkflowBundle,
  removeWorkflowBundle,
  setLastOpenedWorkspaceProjectId,
  ensureWorkspaceBundlesHydratedFromIdb,
  flushWorkspaceBundleIdbWrites,
  migrateWorkflowBundleProjectId,
  mergeRestoredStoryboardAssetsIntoList,
  type SaveWorkflowBundleResult,
  type WorkspaceProject,
} from './services/workspaceProjectStore';
import {
  deleteWorkspaceProjectObjects,
  fetchWorkspaceCloudIndex,
  isWorkspaceCloudEnabled,
  isWorkspaceCloudLiteStructureSyncEnabled,
  isWorkspaceCloudProjectIndexAutoSyncEnabled,
  isWorkspaceCompanionDirectorySourceOfTruth,
  migrateLocalWorkspaceToCloud,
  pushWorkflowLiteStructureToCloud,
  pushWorkspaceIndex,
  WORKSPACE_CLOUD_DEFAULT_QUOTA_BYTES,
} from './services/workspaceCloudSync';
import { isWorkspaceCloudBundleMergeEnabled, reconcileWorkflowBundleWithCloud } from './services/workspaceBundleCloudReconcile';
import { computeLiteStructureLocalFingerprint } from './services/workflowBundleLiteStructure';
import { HttpRequestError } from './services/httpClient';
import { triggerImageDownload } from './services/imageDataUrl';
import { downloadModelFromSource } from './services/downloadModelFile';
import { persistWorkflow3dSlots } from './services/persistWorkflow3dSlots';
import { preflightGenerate3dEnvironment } from './services/generate3d/preflightGenerate3d';
import { patchWorkflowAssetsWith3dResultAndHydrate } from './services/workflow3dCompanionHydrate';
import {
  getAiProviderToolbarLabel,
  getOpenaiApiKey,
  getOpenaiBaseUrl,
  getToapisApiKey,
  getToapisBaseUrl,
  getTripoApiKey,
  getUserApiKey,
  getVectorengineApiKey,
  getVectorengineBaseUrl,
  getEnabledChannels,
  getWorkspaceAutoSyncEnabled,
  isAiInvocationReady,
  setEnabledChannelsFromCloud,
  setOpenaiApiKey,
  setOpenaiBaseUrl,
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
import { isWorkflowStoryboardTableAsset } from './services/storyboardTableAsset';
import { collectReferencedObjectKeysFromPackedV2, hydrateWorkflowBundleFromCloud } from './services/workspaceR2ImageBundle';
function isImagePreviewEscapeKey(e: KeyboardEvent): boolean {
  return e.key === 'Escape' || e.code === 'Escape' || e.keyCode === 27;
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

const lazyChunk = <T extends { default: React.ComponentType<any> }>(loader: () => Promise<T>) =>
  React.lazy(() => importWithChunkRetry(loader));

const CapabilityPresetSection = lazyChunk(() => import('./components/CapabilityPresetSection'));
const WorkflowComposerOverlay = lazyChunk(() => import('./components/WorkflowComposerOverlay'));
const PromptArenaSection = lazyChunk(() => import('./components/PromptArenaSection'));
const SeamRepairSection = lazyChunk(() => import('./components/SeamRepairSection'));
const GenerateTextureSection = lazyChunk(() => import('./components/GenerateTextureSection'));
const SettingsSection = lazyChunk(() => import('./components/SettingsSection'));
const DevLogSection = lazyChunk(() => import('./components/DevLogSection'));
const AdminStaffProvider = lazyChunk(() => import('./components/admin/AdminStaffContext'));
const AdminRolePreviewBridge = lazyChunk(() => import('./components/admin/AdminRolePreviewBridge'));
const AdminLayout = lazyChunk(() => import('./components/admin/AdminLayout'));
const AdminRouteGuard = lazyChunk(() => import('./components/admin/AdminRouteGuard'));
const AdminDefaultRedirect = lazyChunk(() => import('./components/admin/AdminDefaultRedirect'));
const AdminDashboardPanel = lazyChunk(() => import('./components/admin/AdminDashboardPanel'));
const AdminRolesMatrixPanel = lazyChunk(() => import('./components/admin/AdminRolesMatrixPanel'));
const AdminUsersPanel = lazyChunk(() => import('./components/admin/AdminUsersPanel'));
const AdminUserDetailPanel = lazyChunk(() => import('./components/admin/AdminUserDetailPanel'));
const AdminAuditLogsPanel = lazyChunk(() => import('./components/admin/AdminAuditLogsPanel'));
const AdminTaskEventsPanel = lazyChunk(() => import('./components/admin/AdminTaskEventsPanel'));
const AdminUsagePanel = lazyChunk(() => import('./components/admin/AdminUsagePanel'));
const AdminPriceCatalogPanel = lazyChunk(() => import('./components/admin/AdminPriceCatalogPanel'));
const AdminPromoCreditsPanel = lazyChunk(() => import('./components/admin/AdminPromoCreditsPanel'));
const AdminCapabilityPresetsPanel = lazyChunk(() => import('./components/admin/AdminCapabilityPresetsPanel'));
const AdminSystemStatusPanel = lazyChunk(() => import('./components/admin/AdminSystemStatusPanel'));
const AdminStaffInvitesPanel = lazyChunk(() => import('./components/admin/AdminStaffInvitesPanel'));
const AdminRegistrationInvitesPanel = lazyChunk(() => import('./components/admin/AdminRegistrationInvitesPanel'));
const AdminCompanionArtifactsPanel = lazyChunk(() => import('./components/admin/AdminCompanionArtifactsPanel'));
const AdminGeminiFairnessPanel = lazyChunk(() => import('./components/admin/AdminGeminiFairnessPanel'));
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

  const adminUserIdFromPath = React.useMemo(() => {
    if (!pathname.startsWith('/admin/users/')) return '';
    const segment = pathname.slice('/admin/users/'.length).split('/')[0] || '';
    try {
      return decodeURIComponent(segment).trim();
    } catch {
      return segment.trim();
    }
  }, [pathname]);

  const handleNavigate = useCallback((path: string) => {
    navigateTo(path);
  }, []);

  return (
    <Suspense fallback={<div className="min-h-screen bg-black text-white flex items-center justify-center text-[11px]">加载管理后台…</div>}>
      <AdminLayout currentPath={pathname} onNavigate={handleNavigate}>
        <AdminDefaultRedirect pathname={pathname} />
        <AdminRouteGuard pathname={pathname}>
          {adminUserIdFromPath ? (
            <AdminUserDetailPanel userId={adminUserIdFromPath} />
          ) : pathname === '/admin/users' ? (
            <AdminUsersPanel />
          ) : pathname === '/admin/roles' ? (
            <AdminRolesMatrixPanel />
          ) : pathname === '/admin/audit-logs' ? (
            <AdminAuditLogsPanel />
          ) : pathname === '/admin/task-events' ? (
            <AdminTaskEventsPanel />
          ) : pathname === '/admin/usage' ? (
            <AdminUsagePanel />
          ) : pathname === '/admin/promo-credits' ? (
            <AdminPromoCreditsPanel />
          ) : pathname === '/admin/price-catalog' ? (
            <AdminPriceCatalogPanel />
          ) : pathname === '/admin/capability-presets' ? (
            <AdminCapabilityPresetsPanel />
          ) : pathname === '/admin/system-status' ? (
            <AdminSystemStatusPanel />
          ) : pathname === '/admin/staff-invites' ? (
            <AdminStaffInvitesPanel />
          ) : pathname === '/admin/registration-invites' ? (
            <AdminRegistrationInvitesPanel />
          ) : pathname === '/admin/companion-artifacts' ? (
            <AdminCompanionArtifactsPanel />
          ) : pathname === '/admin/gemini-fairness' ? (
            <AdminGeminiFairnessPanel />
          ) : (
            <AdminDashboardPanel />
          )}
        </AdminRouteGuard>
      </AdminLayout>
    </Suspense>
  );
};

// ==========================================
// 5. 主应用程序
// ==========================================

/** 主站： hooks 必须始终在同一调用顺序下执行，不可与 /admin 分支混在同一个组件里 */
const MainApp: React.FC = () => {
  const { user, logout, loading: authLoading, refresh: refreshAuthUser } = useAuth();
  const userUiPrefs = useUserUiPrefs();
  const { balance: creditBalance } = useCreditBalance(user?.id ?? null);
  const [workflowSectionLoadAttempt, setWorkflowSectionLoadAttempt] = useState(0);
  const WorkflowSection = useMemo(
    () => React.lazy(() => importWithChunkRetry(() => import('./components/workflow/workflowSectionLazyBoot0710'))),
    [workflowSectionLoadAttempt],
  );

  useEffect(() => {
    armChunkReloadRecovery();
  }, []);

  const [mode, setMode] = useState<AppMode>(AppMode.WORKFLOW);
  const [settingsScrollTarget, setSettingsScrollTarget] = useState<string | null>(null);
  useEffect(() => {
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
  /** 加载降级且资产为空时，跳过一次空包 autosave，避免覆盖 IDB 内仍存在的旧数据 */
  const skipEmptyWorkflowAutosaveOnceRef = useRef(false);
  /** 本会话是否已成功加载/展示过非空画布（用于区分「用户删光」与「加载失败假空」） */
  const workflowSessionHadNonEmptyAssetsRef = useRef(false);
  /** 本会话用户显式删除的分镜表资产 id，保存时允许从 bundle 移除 */
  const explicitlyRemovedStoryboardIdsRef = useRef<Set<string>>(new Set());
  /** 当前项目 bundle 已从 IDB/本地读完并写入 React，避免首屏 autosave 用空/缺表状态覆盖 */
  const workflowProjectLoadCompleteRef = useRef(false);

  const workflowBundleSaveOpts = useCallback(
    () => ({
      allowEmptyOverwrite: workflowSessionHadNonEmptyAssetsRef.current,
      explicitlyRemovedStoryboardIds: explicitlyRemovedStoryboardIdsRef.current,
    }),
    []
  );

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

  function canSyncWorkspaceProjectToCloud(projectId: string | null | undefined): boolean {
    return Boolean(projectId && userIdRef.current);
  }

  function shouldAutoPushWorkspaceProjectIndex(): boolean {
    return isWorkspaceCloudEnabled() && isWorkspaceCloudProjectIndexAutoSyncEnabled();
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

  /** 画布变更后标记未同步（云端拉取过程中不标脏；伴侣目录为真源时不标索引脏） */
  useEffect(() => {
    if (isWorkspaceCompanionDirectorySourceOfTruth()) return;
    if (authLoading || !user?.id || !user?.username || !isWorkspaceCloudEnabled() || !activeWorkspaceProjectId) return;
    if (!canSyncWorkspaceProjectToCloud(activeWorkspaceProjectId)) return;
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
    if (!canSyncWorkspaceProjectToCloud(activeWorkspaceProjectId)) return;
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
            cfg.capabilityPresetRecords || [],
            Date.now(),
            { serverWins: true }
          );
          const mergedSets = mergeCapabilityCloudRecords<CapabilitySet>(
            capabilitySets,
            workspaceCloudCapabilityRecordsRef.current.sets,
            cfg.capabilitySetRecords || [],
            Date.now(),
            { serverWins: true }
          );
          workspaceCloudCapabilityRecordsRef.current = {
            presets: mergedPresets.records,
            sets: mergedSets.records,
          };
          setCapabilityPresets(mergedPresets.list);
          saveCapabilityPresets(mergedPresets.list);
          setCapabilitySets(mergedSets.list);
          saveCapabilitySets(mergedSets.list);
          setWorkspaceAutoSyncEnabled(cfg.settings.workspaceAutoSyncEnabled);
          setWorkspaceAutoSyncEnabledState(cfg.settings.workspaceAutoSyncEnabled);
          setEnabledChannelsFromCloud(cfg.settings.enabledChannels);
          setUserApiKey(cfg.settings.geminiApiKey || null);
          setToapisApiKey(cfg.settings.toapisApiKey || null);
          setToapisBaseUrl(cfg.settings.toapisBaseUrl || null);
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
          workspaceAutoSyncEnabled,
          enabledChannels: getEnabledChannels(),
          geminiApiKey: getUserApiKey() || '',
          toapisApiKey: getToapisApiKey() || '',
          toapisBaseUrl: getToapisBaseUrl() || '',
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

  const [tasks, setTasks] = useState<AppTask[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const clearSettingsScrollTarget = useCallback(() => {
    setSettingsScrollTarget(null);
  }, []);

  useEffect(() => {
    const onNavigateSettings = (ev: Event) => {
      const ce = ev as CustomEvent<{ sectionId?: string }>;
      const sectionId = ce.detail?.sectionId?.trim();
      setMode(AppMode.SETTINGS);
      setIsSidebarOpen(false);
      if (sectionId) setSettingsScrollTarget(sectionId);
    };
    window.addEventListener(AC_NAVIGATE_SETTINGS_EVENT, onNavigateSettings);
    return () => window.removeEventListener(AC_NAVIGATE_SETTINGS_EVENT, onNavigateSettings);
  }, []);
  /** 侧栏「实验性功能」分组：展开侧栏时默认折叠；进入实验性模块时自动展开 */
  const [experimentalNavExpanded, setExperimentalNavExpanded] = useState(false);

  const isExperimentalMode = useCallback((m: AppMode) =>
    m === AppMode.SEAM_REPAIR ||
    m === AppMode.PBR_TEXTURE ||
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
  const [globalLogs, setGlobalLogs] = useState<GlobalLogEntry[]>([]);
  const globalLogPreferenceScope = user?.id ?? null;
  const {
    filter: globalLogFilter,
    patchFilter: patchGlobalLogFilter,
    resetFilter: resetGlobalLogFilter,
    filteredLogs: filteredGlobalLogs,
    moduleCounts: globalLogModuleCounts,
    isFilterDefault: isGlobalLogFilterDefault,
  } = useGlobalLogFilter(globalLogs, globalLogPreferenceScope);
  const [globalLogOpen, setGlobalLogOpen] = useState(false);
  const globalLogOpenRef = useRef(globalLogOpen);
  useEffect(() => {
    globalLogOpenRef.current = globalLogOpen;
  }, [globalLogOpen]);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const shortcutsHelpOpenRef = useRef(shortcutsHelpOpen);
  useEffect(() => {
    shortcutsHelpOpenRef.current = shortcutsHelpOpen;
  }, [shortcutsHelpOpen]);
  const [globalLogUnreadImportant, setGlobalLogUnreadImportant] = useState(0);
  const [globalLogUnreadHasError, setGlobalLogUnreadHasError] = useState(false);
  const [globalLogCopiedId, setGlobalLogCopiedId] = useState<string | null>(null);
  const [tripoRecoveryContext, setTripoRecoveryContext] = useState<{
    presetId: string;
    imageBase64: string;
    task?: WorkflowPendingTask;
    multiviewImages?: WorkflowPendingTask['tripoMultiviewImages'];
    canResumeOldTask: boolean;
    lastError: string;
  } | null>(null);
  const [tripoRecoveryActionRunning, setTripoRecoveryActionRunning] = useState<'resume' | 'new' | null>(null);
  const addGlobalLog = useCallback(
    (
      module: string,
      level: 'info' | 'warn' | 'error',
      message: string,
      detail?: string,
      meta?: { auditEventId?: string; retryable?: boolean }
    ) => {
      const now = Date.now();
      setGlobalLogs((prev) => [
        ...prev.slice(-199),
        {
          id: Math.random().toString(36).slice(2, 11),
          time: now,
          module,
          level,
          message,
          ...(detail ? { detail } : {}),
          ...(meta?.auditEventId ? { auditEventId: meta.auditEventId } : {}),
          ...(meta?.retryable ? { retryable: true } : {}),
        },
      ]);
      void reportClientDebugLog({ time: now, module, level, message, ...(detail ? { detail } : {}) });
      if ((level === 'warn' || level === 'error') && !globalLogOpenRef.current) {
        setGlobalLogUnreadImportant((n) => Math.min(n + 1, 99));
        if (level === 'error') setGlobalLogUnreadHasError(true);
      }
    },
    []
  );

  useEffect(() => {
    if (!globalLogOpen) return;
    setGlobalLogUnreadImportant(0);
    setGlobalLogUnreadHasError(false);
  }, [globalLogOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'KeyB') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isWorkflowEditableTarget(e.target)) return;

      const rasterActive = document.documentElement.hasAttribute('data-ac-lightbox-raster-shortcuts');
      const shift = e.shiftKey;

      if (shortcutsHelpOpenRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setShortcutsHelpOpen(false);
        return;
      }

      if (rasterActive && !shift) return;

      e.preventDefault();
      e.stopPropagation();
      setShortcutsHelpOpen(true);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'c' && e.key !== 'C') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isWorkflowEditableTarget(e.target)) return;
      if (!globalLogOpenRef.current && document.documentElement.hasAttribute('data-ac-lightbox-raster-shortcuts')) {
        return;
      }
      e.preventDefault();
      setGlobalLogOpen((v) => !v);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const showTripoRecoveryInLogPanel = useMemo(
    () => shouldShowTripoRecoveryBanner(globalLogFilter, tripoRecoveryContext?.lastError),
    [globalLogFilter, tripoRecoveryContext?.lastError]
  );

  useEffect(() => {
    const onQueueProgress = (ev: Event) => {
      const d = (ev as CustomEvent<AcGeminiQueueProgressDetail>).detail;
      if (!d?.queueMeta) return;
      addGlobalLog('AI代理', 'info', formatGeminiQueueProgressLog(d));
    };
    const onRetryWait = (ev: Event) => {
      const d = (ev as CustomEvent<AcGeminiQueueRetryWaitDetail>).detail;
      if (!d || !Number.isFinite(d.retryAfterSec)) return;
      addGlobalLog('AI代理', 'info', formatGeminiFairnessRetryWaitLog(d));
    };
    const onQueueHint = (ev: Event) => {
      const d = (ev as CustomEvent<AcGeminiQueueHintDetail>).detail;
      if (!d?.kind) return;
      addGlobalLog('AI代理', 'info', formatGeminiQueueHintLog(d));
    };
    window.addEventListener(AC_GEMINI_QUEUE_PROGRESS_EVENT, onQueueProgress);
    window.addEventListener(AC_GEMINI_QUEUE_RETRY_WAIT_EVENT, onRetryWait);
    window.addEventListener(AC_GEMINI_QUEUE_HINT_EVENT, onQueueHint);
    return () => {
      window.removeEventListener(AC_GEMINI_QUEUE_PROGRESS_EVENT, onQueueProgress);
      window.removeEventListener(AC_GEMINI_QUEUE_RETRY_WAIT_EVENT, onRetryWait);
      window.removeEventListener(AC_GEMINI_QUEUE_HINT_EVENT, onQueueHint);
    };
  }, [addGlobalLog]);

  const applyStoryboardRestoresFromSave = useCallback(
    (assets: WorkflowAsset[], result: SaveWorkflowBundleResult): WorkflowAsset[] => {
      const next = mergeRestoredStoryboardAssetsIntoList(assets, result.restoredStoryboardAssets);
      if (next.length === assets.length) return assets;
      addGlobalLog(
        '工作区',
        'warn',
        `已自动恢复 ${next.length - assets.length} 个意外丢失的分镜表`,
        result.restoredStoryboardAssets.map((a) => a.id).join(', ')
      );
      return next;
    },
    [addGlobalLog]
  );

  useEffect(() => {
    const notices = consumeWorkspaceMigrationNotices();
    if (!notices.length) return;
    for (const msg of notices) {
      addGlobalLog('工作区', 'info', msg);
    }
  }, [addGlobalLog, activeWorkspaceProjectId, user?.id, workflowAssets.length, workflowPending.length]);

  const pullWorkspaceProjectsFromCompanion = useCallback(async (
    localSnapshot?: WorkspaceProject[]
  ): Promise<null | { id: string; name: string; createdAt: number; boundUserId?: string; boundAt?: number }[]> => {
    const base = getCompanionLocalBaseUrl();
    const res = await listCompanionWorkspaceProjects(base);
    if (!res.ok) return null;
    const list = Array.isArray(res.data.projects) ? res.data.projects : [];
    const localList = localSnapshot ?? workspaceProjectsRef.current ?? [];
    const localById = new Map<string, WorkspaceProject>(
      localList.map((p) => [p.id, p] as const)
    );
    const fromCompanion = list
      .map((p) => {
        const idKey = String(p.id || '').trim();
        const local = localById.get(idKey);
        const companionName = String(p.name || '').trim();
        const localName = String(local?.name || '').trim();
        let name = companionName || localName || idKey;
        // 浏览器索引有自定义显示名时优先（伴侣 meta 未同步或 PATCH 失败）
        if (localName && localName !== idKey && localName !== companionName) {
          name = localName;
        } else if (localName && localName !== idKey && companionName === idKey) {
          name = localName;
        }
        return {
          id: idKey,
          name,
          createdAt: Number(p.createdAt || local?.createdAt || Date.now()),
          ...(typeof local?.boundUserId === 'string' && local.boundUserId.trim()
            ? { boundUserId: local.boundUserId.trim() }
            : {}),
          ...(typeof local?.boundAt === 'number' ? { boundAt: local.boundAt } : {}),
        };
      })
      .filter((p) => p.id && p.name);
    const companionIds = new Set(fromCompanion.map((p) => p.id));
    const extras = localList.filter((p) => String(p.id || '').trim() && !companionIds.has(String(p.id || '').trim()));
    return [...fromCompanion, ...extras];
  }, []);

  const applyLocalWorkspaceIndex = useCallback(
    async (uid: string) => {
      await ensureWorkspaceBundlesHydratedFromIdb(uid);
      const localProjects = loadWorkspaceProjects(uid);
      const last = getLastOpenedWorkspaceProjectId(uid);
      const validLast = last && localProjects.some((p) => p.id === last) ? last : null;
      saveWorkspaceProjects(localProjects, uid);
      setWorkspaceProjects(localProjects);
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
    },
    [markWorkspaceLocalIdbHydrateReady]
  );

  const applyCompanionFirstWorkspaceIndex = useCallback(
    async (uid: string) => {
      await ensureWorkspaceBundlesHydratedFromIdb(uid);
      const localProjects = loadWorkspaceProjects(uid);
      const remoteProjects = await pullWorkspaceProjectsFromCompanion(localProjects);
      const effectiveProjects =
        remoteProjects && remoteProjects.length > 0 ? remoteProjects : localProjects;
      const last = getLastOpenedWorkspaceProjectId(uid);
      const validLast = last && effectiveProjects.some((p) => p.id === last) ? last : null;
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
    },
    [markWorkspaceLocalIdbHydrateReady, pullWorkspaceProjectsFromCompanion]
  );

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
      if (pid && workspaceLocalIdbHydrateReadyRef.current && workflowProjectLoadCompleteRef.current) {
        trySaveWorkflowBundle(
          pid,
          {
            assets: workflowAssetsRef.current,
            pending: workflowPendingRef.current,
          },
          scope,
          workflowBundleSaveOpts()
        );
      }
      await flushWorkspaceBundleIdbWrites();
      try {
        saveWorkspaceProjects(workspaceProjectsRef.current, scope);
      } catch {
        /* ignore */
      }
      /** 云同步改为仅在离开工作区/切换项目时整包上传，避免与渐进拉取竞态导致云端被不完整状态覆盖 */
    })();
  }, [workflowBundleSaveOpts]);

  useEffect(() => {
    let visFlushTimer: number | null = null;
    /** 项目 Agent 云备份失败重试队列：回前台 / 恢复联网时排空；失败吞掉不挡 UI */
    const flushAgentBackupRetry = () => {
      void flushProjectAgentBackupRetryQueue().catch(() => {
        /* ignore */
      });
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        /** 系统「另存为」、文件选择等会短暂 hidden：立即 flush 易与下载/序列化竞态并加重卡顿；关签前仍有 pagehide 兜底 */
        if (visFlushTimer != null) window.clearTimeout(visFlushTimer);
        visFlushTimer = window.setTimeout(() => {
          visFlushTimer = null;
          flushProjectPersistence();
        }, 600);
      } else {
        if (visFlushTimer != null) {
          window.clearTimeout(visFlushTimer);
          visFlushTimer = null;
        }
        if (document.visibilityState === 'visible') {
          flushAgentBackupRetry();
        }
      }
    };
    const onHide = () => flushProjectPersistence();
    const onOnline = () => flushAgentBackupRetry();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('online', onOnline);
    return () => {
      if (visFlushTimer != null) window.clearTimeout(visFlushTimer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('online', onOnline);
    };
  }, [flushProjectPersistence]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      flushProjectPersistence();
      const shouldWarn =
        !isWorkspaceCompanionDirectorySourceOfTruth() &&
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
      const remoteProjects = await pullWorkspaceProjectsFromCompanion(localProjects);
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
      const remoteProjects = await pullWorkspaceProjectsFromCompanion(localProjects);
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

  /** 已登录且开启云同步：伴侣目录为真源时只读本地/伴侣；否则从 R2 hydrate 项目索引 */
  useEffect(() => {
    if (authLoading || !user?.id || !user?.username || !isWorkspaceCloudEnabled()) return;
    const uid = user.id;
    if (isWorkspaceCompanionDirectorySourceOfTruth()) {
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
      void (async () => {
        try {
          await applyCompanionFirstWorkspaceIndex(uid);
        } catch (e) {
          console.warn('[workspace] companion-first hydrate', e);
          if (cancelled) return;
          try {
            await applyLocalWorkspaceIndex(uid);
          } catch (fallbackErr) {
            console.warn('[workspace] companion-first local fallback', fallbackErr);
            if (!cancelled) markWorkspaceLocalIdbHydrateReady();
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }
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
      const remoteProjects = await pullWorkspaceProjectsFromCompanion(index.projects);
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
          const remoteProjects = await pullWorkspaceProjectsFromCompanion(projects);
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
        const remoteProjects = await pullWorkspaceProjectsFromCompanion(localOnly);
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
        const remoteProjects = await pullWorkspaceProjectsFromCompanion(localOnly);
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
  }, [authLoading, user?.id, user?.username, markWorkspaceLocalIdbHydrateReady, pullWorkspaceProjectsFromCompanion, applyCompanionFirstWorkspaceIndex, applyLocalWorkspaceIndex]);

  useEffect(() => {
    workflowSessionHadNonEmptyAssetsRef.current = false;
    explicitlyRemovedStoryboardIdsRef.current.clear();
  }, [activeWorkspaceProjectId]);

  useEffect(() => {
    if (workflowAssets.length > 0) {
      workflowSessionHadNonEmptyAssetsRef.current = true;
    }
  }, [workflowAssets]);

  useEffect(() => {
    if (!activeWorkspaceProjectId || !workspaceLocalIdbHydrateReady || !workflowProjectLoadCompleteRef.current) {
      return;
    }
    if (skipEmptyWorkflowAutosaveOnceRef.current && workflowAssets.length === 0) {
      skipEmptyWorkflowAutosaveOnceRef.current = false;
      return;
    }
    const scope = user?.id ?? null;
    const t = window.setTimeout(() => {
      const result = trySaveWorkflowBundle(
        activeWorkspaceProjectId,
        { assets: workflowAssets, pending: workflowPending },
        scope,
        workflowBundleSaveOpts()
      );
      if (result.restoredStoryboardAssets.length > 0) {
        setWorkflowAssets((prev) => applyStoryboardRestoresFromSave(prev, result));
      }
    }, 650);
    return () => window.clearTimeout(t);
  }, [
    activeWorkspaceProjectId,
    workflowAssets,
    workflowPending,
    user?.id,
    workspaceLocalIdbHydrateReady,
    workflowBundleSaveOpts,
    applyStoryboardRestoresFromSave,
  ]);

  /** 画布变更（且具备轻量上云前置条件）时递增序号，由下游 effect 单独防抖 PUT */
  useEffect(() => {
    if (isWorkspaceCompanionDirectorySourceOfTruth()) return;
    if (!activeWorkspaceProjectId || !workspaceLocalIdbHydrateReady) return;
    if (authLoading) return;
    if (!isWorkspaceCloudEnabled() || !isWorkspaceCloudLiteStructureSyncEnabled()) return;
    if (!user?.id || !user?.username) return;
    if (workspaceCloudQuotaSuspended) return;
    if (!canSyncWorkspaceProjectToCloud(activeWorkspaceProjectId)) return;
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
    if (isWorkspaceCompanionDirectorySourceOfTruth()) return;
    if (liteStructureSyncScheduleSeq === 0) return;
    if (!activeWorkspaceProjectId || !workspaceLocalIdbHydrateReady) return;
    if (authLoading) return;
    if (!isWorkspaceCloudEnabled() || !isWorkspaceCloudLiteStructureSyncEnabled()) return;
    const uid = userIdRef.current;
    const uname = usernameRef.current;
    if (!uid || !uname) return;
    if (workspaceCloudPushAllowedUserIdRef.current !== uid) return;
    if (workspaceCloudQuotaSuspendedRef.current) return;
    if (!canSyncWorkspaceProjectToCloud(activeWorkspaceProjectId)) return;
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
        scope,
        workflowBundleSaveOpts()
      );
    }
    setActiveWorkspaceProjectId(null);
    setWorkflowAssets([]);
    setWorkflowPending([]);
  }, [workflowBundleSaveOpts]);

  const loadWorkspaceProjectInternal = useCallback(
    (id: string) => {
      workflowProjectLoadCompleteRef.current = false;
      const scope = userIdRef.current ?? null;
      const doLoad = () => {
        const local = loadWorkflowBundle(id, scope);
        if (consumeWorkflowBundleLoadDegraded() && local.assets.length === 0) {
          skipEmptyWorkflowAutosaveOnceRef.current = true;
          addGlobalLog(
            '工作区',
            'warn',
            '项目数据加载异常，已跳过空列表自动保存。请刷新或从 IndexedDB/云端恢复备份。'
          );
        } else if (local.assets.length > 0) {
          workflowSessionHadNonEmptyAssetsRef.current = true;
        }
        setActiveWorkspaceProjectId(id);
        setLastOpenedWorkspaceProjectId(id, scope);
        setWorkflowAssets(local.assets);
        setWorkflowPending(local.pending);
        workflowProjectLoadCompleteRef.current = true;

        const uidMerge = userIdRef.current;
        const unameMerge = usernameRef.current;
        if (
          uidMerge &&
          unameMerge &&
          scope === uidMerge &&
          isWorkspaceCloudEnabled() &&
          !isWorkspaceCompanionDirectorySourceOfTruth() &&
          isWorkspaceCloudBundleMergeEnabled() &&
          workspaceCloudPushAllowedUserIdRef.current === uidMerge &&
          !workspaceCloudQuotaSuspendedRef.current &&
          canSyncWorkspaceProjectToCloud(id)
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
              const bundlePayload = { assets: r.bundle.assets, pending: r.bundle.pending };
              const saveResult = trySaveWorkflowBundle(id, bundlePayload, uidMerge, workflowBundleSaveOpts());
              setWorkflowAssets(applyStoryboardRestoresFromSave(bundlePayload.assets, saveResult));
              setWorkflowPending(r.bundle.pending);
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
            const saveResult = trySaveWorkflowBundle(
              id,
              { assets: nextAssets, pending: workflowPendingRef.current },
              scopeInner,
              workflowBundleSaveOpts()
            );
            const mergedAssets = applyStoryboardRestoresFromSave(nextAssets, saveResult);
            const head = importedKeys.slice(0, 6).join(', ') + (importedKeys.length > 6 ? '…' : '');
            addGlobalLog(
              '工作区',
              'info',
              '已根据本地伴侣 manifest 自动挂载磁盘资产到画布',
              `${importedKeys.length} 项 ${head}`
            );
            return mergedAssets;
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
    [addGlobalLog, applyStoryboardRestoresFromSave, markWorkspaceLocalIdbHydrateReady, workflowBundleSaveOpts]
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
      const localBeforeRestore = loadWorkspaceProjects(scope);
      const refreshed = await pullWorkspaceProjectsFromCompanion(localBeforeRestore);
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
          shouldAutoPushWorkspaceProjectIndex() &&
          uid &&
          usernameRef.current &&
          !workspaceCloudQuotaSuspendedRef.current &&
          workspaceCloudPushAllowedUserIdRef.current === uid &&
          canSyncWorkspaceProjectToCloud(curId)
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

  useEffect(() => {
    initAgentWorkbenchBridge({
      getContext: async () => ({
        authenticated: Boolean(user?.id),
        userId: user?.id ?? null,
        activeProjectId: activeWorkspaceProjectId,
        activeProjectName:
          workspaceProjects.find((p) => p.id === activeWorkspaceProjectId)?.name ?? null,
        projects: workspaceProjects.map((p) => ({ id: p.id, name: p.name })),
        capabilityPresets: capabilityPresets.map((p) => ({
          id: p.id,
          name: p.label || p.id,
          category: p.category,
        })),
      }),
      openProject: async (projectId) => {
        const id = String(projectId || '').trim();
        if (!id) return { ok: false, error: 'missing projectId' };
        try {
          await openWorkspaceProject(id);
          return { ok: true, projectId: id };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      runCapability: async ({ presetId, projectId, inputText }) => {
        const pid = String(presetId || '').trim();
        if (!pid) return { ok: false, error: 'missing presetId' };
        const preset = capabilityPresets.find((p) => p.id === pid);
        if (!preset) return { ok: false, error: 'preset_not_found' };
        const targetProjectId = projectId ? String(projectId) : activeWorkspaceProjectId;
        if (targetProjectId && targetProjectId !== activeWorkspaceProjectId) {
          await openWorkspaceProject(targetProjectId);
        }
        const result = await executeCapability(
          preset,
          '',
          { companionProjectId: targetProjectId || 'default' },
          { inputText }
        );
        return {
          ok: result.ok,
          kind: result.kind,
          error: result.error,
          durationMs: result.durationMs,
        };
      },
    });
  }, [user?.id, activeWorkspaceProjectId, workspaceProjects, capabilityPresets, openWorkspaceProject]);

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
          shouldAutoPushWorkspaceProjectIndex() &&
          uid &&
          usernameRef.current &&
          !workspaceCloudQuotaSuspendedRef.current &&
          workspaceCloudPushAllowedUserIdRef.current === uid &&
          canSyncWorkspaceProjectToCloud(pid)
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
      const trimmed = String(name || '').trim();
      /** 未填名称时伴侣会返回 workspace_project_name_required；给默认目录名避免回退成 UUID 导致 manifest project_not_found */
      const nameForCompanion = trimmed || `proj-${Date.now().toString(36)}`;
      let next: WorkspaceProject[];
      if (base) {
        const createdRemote = await createCompanionWorkspaceProject(base, nameForCompanion);
        if (createdRemote.ok === false) {
          addGlobalLog('工作区', 'error', '本地伴侣新建项目失败', createdRemote.error);
          return;
        }
        next = [...workspaceProjects, createdRemote.data.project];
      } else {
        next = [...workspaceProjects, createWorkspaceProject(trimmed || nameForCompanion)];
      }
      setWorkspaceProjects(next);
      saveWorkspaceProjects(next, scope);
      if (
        shouldAutoPushWorkspaceProjectIndex() &&
        user?.id &&
        user?.username &&
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
        if (isWorkflowStoryboardTableAsset(asset) && asset.storyboardTable?.rows?.length) {
          asset.storyboardTable = {
            ...asset.storyboardTable,
            rows: await Promise.all(
              asset.storyboardTable.rows.map(async (row) => {
                let nextRow = { ...row };
                if (!String(row.frameImage || '').trim()) {
                  const frameKey = String(row.frameImageCompanionKey || '').trim();
                  if (frameKey) {
                    hydrateAttempted += 1;
                    const dataUrl = await fetchCompanionAssetAsDataUrl(base, projectId, frameKey);
                    if (dataUrl) {
                      nextRow = { ...nextRow, frameImage: dataUrl };
                      hydratedCount += 1;
                    } else {
                      hydrateFailures.push({
                        assetId: String(asset.id || ''),
                        kind: 'result',
                        stepId: `storyboard:${row.id}`,
                        reason: 'not_found_in_companion_or_unauthorized',
                      });
                    }
                  }
                }
                if (!row.frameImageHistory?.length) return nextRow;
                const nextHistory = await Promise.all(
                  row.frameImageHistory.map(async (ver) => {
                    if (String(ver.frameImage || '').trim() || String(ver.frameImageObjectKey || '').trim()) {
                      return ver;
                    }
                    const histKey = String(ver.frameImageCompanionKey || '').trim();
                    if (!histKey) return ver;
                    hydrateAttempted += 1;
                    const dataUrl = await fetchCompanionAssetAsDataUrl(base, projectId, histKey);
                    if (dataUrl) {
                      hydratedCount += 1;
                      return { ...ver, frameImage: dataUrl };
                    }
                    hydrateFailures.push({
                      assetId: String(asset.id || ''),
                      kind: 'result',
                      stepId: `storyboard:${row.id}:hist:${ver.id}`,
                      reason: 'not_found_in_companion_or_unauthorized',
                    });
                    return ver;
                  })
                );
                return { ...nextRow, frameImageHistory: nextHistory };
              })
            ),
          };
        }
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
      const next = workspaceProjectsRef.current.map((p) => (p.id === id ? { ...p, name: trimmed } : p));
      setWorkspaceProjects(next);
      saveWorkspaceProjects(next, scope);
      const base = getCompanionLocalBaseUrl();
      const renamed = await renameCompanionWorkspaceProject(base, id, trimmed);
      if (renamed.ok === false) {
        addGlobalLog('工作区', 'warn', '本地伴侣更新显示名失败，名称已保存在浏览器', renamed.error);
      }
      if (
        shouldAutoPushWorkspaceProjectIndex() &&
        user?.id &&
        user?.username &&
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
      shouldAutoPushWorkspaceProjectIndex() &&
      uid &&
      usernameRef.current &&
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

  const showAdminEntry = canAccessAdminPanel(user);

  const handleUserMenuAction = useCallback(async (action: string) => {
    if (!action) return;
    if (action === 'manage') {
      setMode(AppMode.SETTINGS);
      setIsSidebarOpen(false);
      return;
    }
    if (action === 'admin') {
      navigateAdmin('/admin');
      setIsSidebarOpen(false);
      return;
    }
    if (action === 'switch' || action === 'logout') {
      await logout();
    }
  }, [logout]);

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
  const [arenaImageModel, setArenaImageModel] = useState<string>(() => DEFAULT_IMAGE_MODEL_REGISTRY_ID);
  const { rows: effectiveImageModelRows, coerceModelId } = useEffectiveImageModelRows();
  useLayoutEffect(() => {
    const ok = effectiveImageModelRows.find((r) => r.registryId === arenaImageModel && !r.disabled);
    if (!ok) {
      const ng = coerceModelId(arenaImageModel);
      const fb = effectiveImageModelRows.find((r) => r.registryId === ng && !r.disabled);
      if (fb && fb.registryId !== arenaImageModel) setArenaImageModel(fb.registryId);
    }
  }, [effectiveImageModelRows, coerceModelId, arenaImageModel]);
  const [arenaCurrentStep, setArenaCurrentStep] = useState<ArenaCurrentStep>('idle');
  const [arenaStepLog, setArenaStepLog] = useState<ArenaStepEntry[]>([]);
  const [arenaTimeline, setArenaTimeline] = useState<ArenaTimelineBlock[]>([]);
  const [arenaSnippets, setArenaSnippets] = useState<Array<{ id: string; text: string; timestamp: number; source?: string }>>(() => loadSnippets());
  const [arenaFirstVisit, setArenaFirstVisit] = useState(() => !localStorage.getItem('ac_arena_visited'));

  const { mainScrollRef, showBackToTop, scrollToTop } = useMainScrollBackToTop();
  const quickComposeWorkspaceDockHostRef = useRef<HTMLDivElement | null>(null);
  const [workspaceQuickComposeExpanded, setWorkspaceQuickComposeExpanded] = useState(false);
  const handleWorkspaceQuickComposeExpandedChange = useCallback((expanded: boolean) => {
    setWorkspaceQuickComposeExpanded((prev) => (prev === expanded ? prev : expanded));
  }, []);
  useEffect(() => {
    if (mode !== AppMode.WORKFLOW || !activeWorkspaceProjectId) {
      setWorkspaceQuickComposeExpanded(false);
    }
  }, [mode, activeWorkspaceProjectId]);
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

  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [config, setConfig] = useState<SystemConfig>(() => {
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

  const persistSystemConfig = useCallback((patch: Partial<SystemConfig>) => {
    setConfig((prev) => {
      const merged: SystemConfig = {
        ...prev,
        ...patch,
        ...(patch.prompts ? { prompts: { ...prev.prompts, ...patch.prompts } } : {}),
      };
      const next: SystemConfig = { ...merged, ...migrateSystemModelSlots(merged) };
      try {
        localStorage.setItem("ac_config", JSON.stringify(next));
      } catch {
        /* quota / private mode */
      }
      return next;
    });
  }, []);

  const handleModelTextChange = useCallback(
    (modelText: string) => {
      persistSystemConfig({ modelText: coerceTextModelRegistryId(modelText) });
    },
    [persistSystemConfig]
  );

  useEffect(() => {
    const savedLib = localStorage.getItem('ac_library'); if (savedLib) setLibrary(JSON.parse(savedLib));
  }, []);

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
    multiviewImages?: WorkflowPendingTask['tripoMultiviewImages'],
    options?: { forceNewTask?: boolean }
  ) => {
    if (preset.category !== 'generate_3d' || !preset.generate3D) return;
    const g = normalizeGenerate3DPresetForRun(preset.generate3D);
    const provider = resolveGenerate3dProviderId(g);
    const companionProjectIdForPreflight = String(activeWorkspaceProjectId || '').trim() || 'default';
    const preflight = await preflightGenerate3dEnvironment({
      companionBaseUrl: getCompanionLocalBaseUrl(),
      companionProjectId: companionProjectIdForPreflight,
      provider: provider === 'tencent' ? 'tencent' : 'tripo',
    });
    for (const w of preflight.warnings) {
      addGenerate3DLog('warn', `[工作流] ${w}`);
    }
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
        const persisted = await persistWorkflow3dSlots({
          provider: 'tencent',
          creds: creds3D,
          taskId: jobId,
          files,
          assetId: workflowAssetId,
          resultKey,
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
        const { assets: hydratedAssets, revokeBlobUrls: hydrateRevokes } =
          await patchWorkflowAssetsWith3dResultAndHydrate({
            prev: workflowAssetsRef.current,
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
            companionBaseUrl: companionBase,
            companionProjectId,
            onLog: (level, message, detail) => addGenerate3DLog(level, message, detail),
          });
        for (const u of hydrateRevokes) {
          try {
            URL.revokeObjectURL(u);
          } catch {
            /* ignore */
          }
        }
        setWorkflowAssets(hydratedAssets);
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
        multiviewImageDataUrls: multiviewImages,
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
        multiviewSlots: previewInput.type === 'multiview_to_model'
          ? Object.keys(previewInput.multiviewImageBase64DataUrls || {}).filter(
              (k) => String(previewInput.multiviewImageBase64DataUrls?.[k as keyof NonNullable<typeof previewInput.multiviewImageBase64DataUrls>] || '').trim()
            )
          : undefined,
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
        multiviewImageDataUrls: multiviewImages,
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
      const persisted = await persistWorkflow3dSlots({
        provider: 'tripo',
        apiKey: tripoApiKey,
        taskId: createdTaskId,
        glbSourceUrls: modelUrls,
        previewUrl,
        assetId: workflowAssetId,
        resultKey,
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
      const { assets: hydratedAssets, revokeBlobUrls: hydrateRevokes } =
        await patchWorkflowAssetsWith3dResultAndHydrate({
          prev: workflowAssetsRef.current,
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
          companionBaseUrl: companionBase,
          companionProjectId,
          onLog: (level, message, detail) => addGenerate3DLog(level, message, detail),
        });
      for (const u of hydrateRevokes) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* ignore */
        }
      }
      setWorkflowAssets(hydratedAssets);
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
        multiviewImages,
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, callback: (base64: string) => void) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => callback(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
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

  const LibraryCard: React.FC<{
    items: LibraryItem[];
    isSelected: boolean;
    onToggleSelect: () => void;
    onDelete: (groupId: string) => void;
  }> = ({ items, isSelected, onToggleSelect, onDelete }) => {
    const [activeIdx, setActiveIdx] = useState(0);
    const activeItem = items[activeIdx];
    const groupId = items[0].groupId;
    const is3D = activeItem.category === 'MESH_MODEL' && (activeItem.modelUrls?.length ?? 0) > 0;
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
           <button onClick={() => onDelete(groupId)} className="w-full py-2 text-red-500/20 rounded-xl text-[8px] font-black uppercase hover:text-red-500 mt-2">删除</button>
        </div>
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
                      ...(showAdminEntry ? [{ value: 'admin', label: '管理后台' }] : []),
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
              <SidebarIconButton active={mode === AppMode.SETTINGS} label="设置" onClick={() => { setMode(AppMode.SETTINGS); setIsSidebarOpen(false); }}>
                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6"/><path d="M10 3v2.1M10 14.9V17M17 10h-2.1M5.1 10H3M14.9 5.1l-1.5 1.5M6.6 13.4l-1.5 1.5M14.9 14.9l-1.5-1.5M6.6 6.6 5.1 5.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              </SidebarIconButton>
              {showAdminEntry ? (
                <SidebarIconButton active={false} label="管理后台" onClick={() => { navigateAdmin('/admin'); setIsSidebarOpen(false); }}>
                  <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden>
                    <path d="M3.5 3.5h5v5h-5v-5Z M11.5 3.5h5v5h-5v-5Z M3.5 11.5h5v5h-5v-5Z M11.5 11.5h5v5h-5v-5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  </svg>
                </SidebarIconButton>
              ) : null}
              {showAdminEntry ? (
                <SidebarIconButton
                  active={mode === AppMode.DEV_LOG}
                  label="开发日志"
                  onClick={() => {
                    setMode(AppMode.DEV_LOG);
                    setIsSidebarOpen(false);
                  }}
                >
                  <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden>
                    <path
                      d="M5 3.5h10v13H5v-13Z M7.5 6.5h5 M7.5 9.5h5 M7.5 12.5h3"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </SidebarIconButton>
              ) : null}

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

            {experimentalNavExpanded ? (
              <div className="mt-2 flex flex-col gap-2 pt-2">
                <SidebarIconButton active={mode === AppMode.SEAM_REPAIR} label="贴图修缝" onClick={() => { setMode(AppMode.SEAM_REPAIR); setIsSidebarOpen(false); }}>
                  <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><path d="M4 6h5l2 2h5v6H4V6Z" stroke="currentColor" strokeWidth="1.6"/><path d="M8.2 8.2l3.6 3.6M11.8 8.2l-3.6 3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                </SidebarIconButton>
                <SidebarIconButton active={mode === AppMode.PBR_TEXTURE} label="生成贴图" onClick={() => { setMode(AppMode.PBR_TEXTURE); setIsSidebarOpen(false); }}>
                  <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><circle cx="10" cy="10" r="6.2" stroke="currentColor" strokeWidth="1.6"/><path d="M10 3.8v12.4M3.8 10h12.4" stroke="currentColor" strokeWidth="1.2"/></svg>
                </SidebarIconButton>
                <SidebarIconButton active={mode === AppMode.ARENA} label="提示词擂台" onClick={() => { setMode(AppMode.ARENA); setIsSidebarOpen(false); }}>
                  <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><path d="M6 5.5h8l-1.2 2.6L15 10l-5 6-5-6 2.2-1.9L6 5.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
                </SidebarIconButton>
              </div>
            ) : null}
          </div>

          {user ? (
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

      {/* 全局日志：Portal 到 body，避免被 #root isolate 层挡住全屏分镜/大图预览 */}
      {typeof document !== 'undefined'
        ? createPortal(
            <>
              <div
                className={`fixed ${RIGHT_DOCK_LOG_BOTTOM} ${RIGHT_DOCK_RIGHT} flex items-center justify-center`}
                style={{ zIndex: RIGHT_DOCK_LOG_Z_INDEX }}
              >
                <button
                  type="button"
                  onClick={() => setGlobalLogOpen((v) => !v)}
                  className={`relative w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 motion-reduce:transition-none ${
                    globalLogOpen
                      ? 'bg-[#1a3354] ring-2 ring-blue-500/45 text-blue-200'
                      : 'bg-[#16161a] ring-1 ring-white/[0.1] text-gray-200 hover:bg-[#1f1f24] hover:ring-blue-500/35'
                  }`}
                  title={
                    globalLogOpen
                      ? '关闭日志（C）'
                      : globalLogUnreadImportant > 0
                        ? `打开日志（${globalLogUnreadImportant} 条未读警告/错误，快捷键 C）`
                        : '打开日志（C）'
                  }
                  aria-label={
                    globalLogOpen
                      ? '关闭日志，快捷键 C'
                      : globalLogUnreadImportant > 0
                        ? `打开日志，${globalLogUnreadImportant} 条未读警告或错误，快捷键 C`
                        : '打开日志，快捷键 C'
                  }
                >
                  <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none" aria-hidden>
                    <rect x="4" y="3.5" width="12" height="13" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  {globalLogUnreadImportant > 0 ? (
                    <span
                      className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-white text-[9px] leading-[18px] text-center border border-[#0f0f10] ${
                        globalLogUnreadHasError ? 'bg-red-600' : 'bg-amber-600'
                      }`}
                    >
                      {globalLogUnreadImportant > 99 ? '99+' : globalLogUnreadImportant}
                    </span>
                  ) : null}
                </button>
              </div>

              {globalLogOpen ? (
                <div
                  className={`fixed ${RIGHT_DOCK_PANEL_BOTTOM} ${RIGHT_DOCK_RIGHT} flex flex-col w-[min(420px,calc(100vw-3rem))] max-h-[min(64vh,500px)] rounded-2xl bg-[#0f0f0f] ring-1 ring-white/[0.1] shadow-2xl overflow-hidden motion-reduce:shadow-none`}
                  style={{ zIndex: RIGHT_DOCK_LOG_PANEL_Z_INDEX }}
                  role="dialog"
                  aria-label="全局日志"
                >
          <div className="shrink-0 px-4 py-3 border-b border-white/[0.06] bg-[#141416] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-white">运行日志</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setGlobalLogs([]);
                  setGlobalLogUnreadImportant(0);
                  setGlobalLogUnreadHasError(false);
                }}
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

          <div className="flex-1 min-h-0 overflow-y-auto p-3 no-scrollbar">
            {showTripoRecoveryInLogPanel && tripoRecoveryContext ? (
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
                          tripoRecoveryContext.multiviewImages,
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
                          tripoRecoveryContext.multiviewImages,
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
            ) : filteredGlobalLogs.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-6 text-center text-[11px] text-gray-500">
                无匹配日志，试试放宽筛选或点「重置筛选」
              </div>
            ) : (
              <div className="space-y-2">
                {[...filteredGlobalLogs].reverse().map((log) => (
                  <div
                    key={log.id}
                    className="rounded-xl ring-1 ring-white/[0.06] bg-[#141416] px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-gray-400">{new Date(log.time).toLocaleTimeString()}</span>
                      <div className="flex items-center gap-1.5">
                        {log.retryable &&
                        log.auditEventId &&
                        (log.level === 'warn' || log.level === 'error') ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.dispatchEvent(
                                new CustomEvent(AC_WORKFLOW_RETRY_TASK_EVENT, {
                                  detail: { auditEventId: log.auditEventId },
                                })
                              );
                            }}
                            className="text-[9px] px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-900/20 text-emerald-200 hover:bg-emerald-900/35 transition-colors"
                          >
                            重试
                          </button>
                        ) : null}
                        <button
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
                          className="text-[9px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 transition-colors"
                        >
                          {globalLogCopiedId === log.id ? '已复制' : '复制'}
                        </button>
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
                  </div>
                ))}
              </div>
            )}
          </div>

          <GlobalLogFilterBar
            filter={globalLogFilter}
            moduleCounts={globalLogModuleCounts}
            filteredCount={filteredGlobalLogs.length}
            totalCount={globalLogs.length}
            showReset={!isGlobalLogFilterDefault}
            onChange={patchGlobalLogFilter}
            onReset={resetGlobalLogFilter}
          />
                </div>
              ) : null}
            </>,
            document.body
          )
        : null}

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

      <main
        className="flex min-w-0 flex-1 flex-row h-[100dvh] overflow-hidden"
        style={
          mode === AppMode.WORKFLOW && activeWorkspaceProjectId && workspaceQuickComposeExpanded
            ? ({ ['--ac-agent-dock-inset' as string]: WORKFLOW_QUICK_COMPOSE_DOCKED_INSET } as React.CSSProperties)
            : ({ ['--ac-agent-dock-inset' as string]: '0px' } as React.CSSProperties)
        }
        data-agent-dock-expanded={
          mode === AppMode.WORKFLOW && activeWorkspaceProjectId && workspaceQuickComposeExpanded
            ? 'true'
            : 'false'
        }
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
                  scrollToSectionId={settingsScrollTarget}
                  onScrollToSectionDone={clearSettingsScrollTarget}
                  preferenceScope={user?.id ?? null}
                  modelText={config.modelText}
                  onModelTextChange={handleModelTextChange}
                />
              </Suspense>
            )}
            {mode === AppMode.DEV_LOG && showAdminEntry && (
              <Suspense fallback={<LazySectionFallback label="开发日志" />}>
                <DevLogSection />
              </Suspense>
            )}
            {(activeWorkspaceProjectId || mode === AppMode.WORKFLOW) && mode === AppMode.WORKFLOW && (
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
                  persistUserId={user?.id ?? null}
                  onWorkspaceCreate={createWorkspaceProjectEntry}
                  onWorkspaceOpen={openWorkspaceProject}
                  onWorkspaceRename={renameWorkspaceProjectEntry}
                  onWorkspaceDelete={requestDeleteWorkspaceProject}
                  onWorkspaceExport={exportWorkspaceProjectEntry}
                  onWorkspaceImport={(file) => void importWorkspaceProjectEntry(file)}
                  onOpenWorkspaceTrash={() => void openWorkspaceTrashDialog()}
                  onWorkflowSectionLoadRetry={() => setWorkflowSectionLoadAttempt((n) => n + 1)}
                  workflowSectionSuspenseKey={workflowSectionLoadAttempt}
                  renderWorkflowSection={() => (
                    <WorkflowSection
                      key={workflowSectionLoadAttempt}
                      quickComposeShellActive={mode === AppMode.WORKFLOW}
                      quickComposeWorkspaceDockHostRef={quickComposeWorkspaceDockHostRef}
                      workspaceQuickComposeExpanded={workspaceQuickComposeExpanded}
                      onWorkspaceQuickComposeExpandedChange={handleWorkspaceQuickComposeExpandedChange}
                      textModelRegistryId={config.modelText}
                      capabilityPresets={capabilityPresets}
                      capabilitySets={capabilitySets}
                      assets={workflowAssets}
                      onAssetsChange={setWorkflowAssets}
                      onStoryboardTableAssetRemoved={(assetId) => {
                        const id = String(assetId || '').trim();
                        if (id) explicitlyRemovedStoryboardIdsRef.current.add(id);
                      }}
                      pending={workflowPending}
                      onPendingChange={setWorkflowPending}
                      onLog={(level, message, detail, meta) =>
                        addGlobalLog('工作区', level, message, detail, meta)
                      }
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
                  creditBalance={creditBalance}
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
                  addTask={addTask}
                  updateTask={updateTask}
                  addGlobalLog={addGlobalLog}
                  onFileUpload={handleFileUpload}
                  modelText={config.modelText}
                  promptEdit={config.prompts.edit}
                />
              </Suspense>
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
                         可点击左侧「上传图片」、或从工作流生成结果保存到资产库。
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
                         />
                       ))}
                     </div>
                   )}
                 </div>
              </div>
            )}
          </div>
        </div>
        </div>
        {mode === AppMode.WORKFLOW && activeWorkspaceProjectId ? (
          <div
            ref={quickComposeWorkspaceDockHostRef}
            className={`relative z-[2600] flex h-full min-h-0 shrink-0 self-stretch flex-col pointer-events-auto ${
              workspaceQuickComposeExpanded
                ? WORKFLOW_QUICK_COMPOSE_DOCKED_WIDTH_CLASS
                : 'w-0 min-w-0 overflow-hidden'
            }`}
            data-workflow-quick-compose-dock-host
            data-ac-block-workflow-marquee
          />
        ) : null}
      </main>

      {showBackToTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="fixed bottom-6 left-6 z-[1000] w-10 h-10 rounded-full bg-[#26262c] border border-[#3a3a40] flex items-center justify-center text-white/90 hover:bg-[#383842] hover:border-[#484850] transition-colors duration-200 shadow-lg cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]"
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

      <KeyboardShortcutsModal
        open={shortcutsHelpOpen}
        mode={mode}
        activeWorkspaceProjectId={activeWorkspaceProjectId}
        onClose={() => setShortcutsHelpOpen(false)}
      />

    </div>
  );
};

const App: React.FC = () => {
  const fullPath = usePathname();
  const pathname = fullPath.split('?')[0].split('#')[0];
  if (pathname.startsWith('/admin')) {
    return (
      <>
        <GeminiFairnessFloatingNotice />
        <DownloadSavedFloatingNotice />
        <Suspense fallback={<div className="min-h-screen bg-[#050505] flex items-center justify-center text-[11px] text-gray-500">加载中…</div>}>
          <AdminStaffProvider>
            <AdminRolePreviewBridge>
              <AdminAppShell />
            </AdminRolePreviewBridge>
          </AdminStaffProvider>
        </Suspense>
      </>
    );
  }
  return (
    <>
      <GeminiFairnessFloatingNotice />
      <DownloadSavedFloatingNotice />
      <MainApp />
    </>
  );
};

export default App;
