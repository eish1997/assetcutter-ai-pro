
import React, { Suspense, useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { processTexture, DEFAULT_PROMPTS, normalizeApiErrorMessage, getTexturePrompt, parsePromptStructured, understandImageEditIntent } from './services/geminiService';
import { loadRecords, addRecord as addGenerationRecord, updateScore as updateGenerationScore } from './services/recordStore';
import { loadSnippets } from './services/snippetStore';
import { PRO_VIEW_IDS, type Submit3DProInput, type Submit3DRapidInput } from './services/tencentService';
import { AppStep, AppMode, LibraryItem, SystemConfig, AppTask, AssetCategory, DialogMessage, DialogSession, DialogTempItem, DialogImageGear, DIALOG_ASPECT_RATIO_OPTIONS, SUPPORTED_IMAGE_SIZES, DIALOG_IMAGE_GEARS, type GenerationRecord, type CustomAppModule, type CapabilitySet, type WorkflowAsset, type WorkflowPendingTask, type ArenaCurrentStep, type ArenaStepEntry, type ArenaTimelineBlock } from './types';
import DropdownSelect from './components/DropdownSelect';
import MultiViewUpload from './components/MultiViewUpload';
import type { ViewId } from './components/MultiViewUpload';
import { runCapabilityTest } from './services/capabilityTestRunner';
import { loadCapabilityPresets, saveCapabilityPresets, CAPABILITY_PRESETS_KEY } from './services/capabilityPresetStore';
import { loadCapabilitySets, saveCapabilitySets, CAPABILITY_SETS_KEY } from './services/capabilitySetStore';
import { useGenerate3DManager, type Temp3DItem } from './hooks/useGenerate3DManager';
import { useDialogWorkspace } from './hooks/useDialogWorkspace';
import { useDialogGeneration, getDialogUnderstandImageInput } from './hooks/useDialogGeneration';
import { useDialogPostProcessing } from './hooks/useDialogPostProcessing';
import { useAuth } from './components/auth/AuthContext';
import { CustomDropdown, DROPDOWN_TRIGGER_COMPACT } from './components/ui/CustomDropdown';
import Waves from './components/ui/Waves';
import AppIcon from './components/ui/AppIcon';
import WorkspaceProjectShell from './components/WorkspaceProjectShell';
import {
  loadWorkspaceProjects,
  saveWorkspaceProjects,
  createWorkspaceProject,
  getLastOpenedWorkspaceProjectId,
  loadWorkflowBundle,
  trySaveWorkflowBundle,
  removeWorkflowBundle,
  setLastOpenedWorkspaceProjectId,
} from './services/workspaceProjectStore';
import {
  deleteWorkspaceProjectObjects,
  fetchWorkflowPackedFromCloud,
  fetchWorkspaceCloudIndex,
  isWorkspaceCloudEnabled,
  migrateLocalWorkspaceToCloud,
  pushWorkflowBundleToCloud,
  pushWorkspaceIndex,
  WORKSPACE_CLOUD_DEFAULT_QUOTA_BYTES,
} from './services/workspaceCloudSync';
import { hydrateWorkflowBundleFromCloud } from './services/workspaceR2ImageBundle';
import { dialogVersionHasRenderableImage, dialogVersionsForMessage, getDialogVersionImageDataUrl } from './services/dialogImageHelpers';
import { HttpRequestError } from './services/httpClient';
import { triggerImageDownload } from './services/imageDataUrl';
import {
  getAiProvider,
  getDialogSkipUnderstand,
  getToapisApiKey,
  getToapisBaseUrl,
  getUserApiKey,
  getVectorengineApiKey,
  getVectorengineBaseUrl,
  getWorkspaceAutoSyncEnabled,
  isAiInvocationReady,
  setAiProvider,
  setDialogSkipUnderstand,
  setToapisApiKey,
  setToapisBaseUrl,
  setUserApiKey,
  setVectorengineApiKey,
  setVectorengineBaseUrl,
  setWorkspaceAutoSyncEnabled,
} from './services/settingsStore';
import { fetchWorkspaceUserCloudConfig, pushWorkspaceUserCloudConfig } from './services/workspaceUserCloudConfig';
import { WorkflowApiKeyModal } from './components/WorkflowApiKeyModal';
import { WorkspaceCloudSyncCountdown } from './components/WorkspaceCloudSyncCountdown';

function isImagePreviewEscapeKey(e: KeyboardEvent): boolean {
  return e.key === 'Escape' || e.code === 'Escape' || e.keyCode === 27;
}

function formatWorkspaceCloudMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function formatTimestampText(ts: number | null): string {
  if (!ts) return '未同步';
  return new Date(ts).toLocaleString();
}

const UnifiedModelViewer3D = React.lazy(() => import('./components/UnifiedModelViewer3D'));
const WorkflowSection = React.lazy(() => import('./components/WorkflowSection'));
const CapabilityPresetSection = React.lazy(() => import('./components/CapabilityPresetSection'));
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
type SourceAggregate = {
  count: number;
  rated: number;
  sumScore: number;
  samples: { fullPrompt: string; instruction?: string; userScore: number }[];
};

function workflowBoundaryNormalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  try {
    return new Error(typeof error === 'string' ? error : String(error));
  } catch {
    return new Error('未知错误（无法序列化）');
  }
}

class WorkflowErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  declare props: Readonly<{ children: React.ReactNode }>;
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: workflowBoundaryNormalizeError(error) };
  }
  componentDidCatch(error: unknown) {
    try {
      console.error('[工作流]', error);
    } catch {
      console.error('[工作流] 子树抛错（控制台无法序列化该错误对象）');
    }
  }
  render() {
    if (this.state.error) {
      const err = this.state.error;
      const fullText = `工作流报错\n\n${err.message}\n\n${err.stack ?? ''}`;
      return (
        <div className="rounded-2xl border border-[#f87171] bg-[#3f1518] p-6 text-red-200 min-h-[200px]">
          <div className="flex items-center justify-between gap-4 mb-3">
            <h3 className="text-[10px] font-black uppercase text-red-400">工作流内报错</h3>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(fullText);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#4a1c1c] border border-[#f87171] text-[9px] font-black uppercase text-red-300 hover:bg-[#5a2222] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 transition-colors duration-200"
            >
              复制报错
            </button>
          </div>
          <pre className="text-[9px] overflow-auto max-h-[40vh] whitespace-pre-wrap break-words bg-[#141416] p-3 rounded-lg border border-[#b85a5a]">{err.message}</pre>
          {err.stack && (
            <details className="mt-3">
              <summary className="text-[8px] font-black uppercase text-gray-500 cursor-pointer hover:text-gray-400">堆栈</summary>
              <pre className="text-[8px] text-gray-500 mt-1 overflow-auto max-h-[30vh] whitespace-pre-wrap break-words bg-[#141416] p-3 rounded-lg">{err.stack}</pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

const LazySectionFallback: React.FC<{ label?: string }> = ({ label = '模块' }) => (
  <div className="min-h-[240px] w-full rounded-2xl border border-[#2e2e32] bg-[#121214] flex items-center justify-center text-[11px] text-gray-500">
    加载{label}中…
  </div>
);

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

/** 生成3D 左侧可选模块（与已上线 API 对应） */
export type Generate3DModule =
  | 'pro'      // 混元生3D（专业版）
  | 'rapid'    // 混元生3D（极速版）
  | 'topology' // 智能拓扑
  | 'texture'  // 纹理生成
  | 'component'// 组件生成
  | 'uv'       // UV展开
  | 'profile'  // 3D人物生成
  | 'convert'; // 模型格式转换

/** 8 个模块的展示名称与简介（按已上线 API 分模块） */
export const GENERATE_3D_MODULES: { id: Generate3DModule; name: string; desc: string }[] = [
  { id: 'pro', name: '混元生3D（专业版）', desc: '3.0/3.1 模型，文生/图生/多视图/白模/草图/智能拓扑；3.1 支持八视图' },
  { id: 'rapid', name: '混元生3D（极速版）', desc: '生成时间缩短至 1 分 30 秒内' },
  { id: 'topology', name: '智能拓扑', desc: 'Polygon 1.5，高模入→低面数规整布线' },
  { id: 'texture', name: '纹理生成', desc: '单几何模型 + 参考图/文字 → 纹理贴图' },
  { id: 'component', name: '组件生成', desc: '3D 模型入→自动识别结构生成组件' },
  { id: 'uv', name: 'UV展开', desc: '3D 模型入→高质量 UV 切线' },
  { id: 'profile', name: '3D人物生成', desc: '人物头像→按模板生成 3D 形象' },
  { id: 'convert', name: '模型格式转换', desc: '3D 模型→不同格式转换' },
];

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
    className={`group relative w-full h-10 rounded-xl border transition-colors duration-200 flex items-center justify-center cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505] ${active ? 'bg-[#1a2d4d] text-blue-300 border-[#3b6fb8]' : 'text-gray-400 border-[#2e2e32] hover:bg-[#2e2e36]'}`}
  >
    {children}
    <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 rounded-lg border border-[#2e2e32] bg-[#050505] px-2 py-1 text-[10px] text-gray-200 whitespace-nowrap opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150">
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
            <img src={item.data} className="max-w-full max-h-full object-contain shadow-2xl" alt={item.label} />
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
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="px-6 py-3 bg-[#3730a3] rounded-full font-black text-[10px] uppercase tracking-widest hover:bg-[#4f46e5] transition-colors">下载模型{item.modelUrls!.length > 1 ? ` ${i + 1}` : ''}</a>
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
        {pathname === '/admin/users' ? <AdminUsersPanel /> : pathname === '/admin/audit-logs' ? <AdminAuditLogsPanel /> : <AdminPlaceholder />}
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
        <img src={src} className="w-full h-full object-contain pointer-events-none select-none" />
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
        <button onClick={onCancel} className="flex-1 py-4 bg-[#1c1c22] border border-[#2e2e32] rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-[#2e2e36] transition-all">取消</button>
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
                  <img src={item.data} className="w-full h-full object-contain" alt="" />
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
/** 主站： hooks 必须始终在同一调用顺序下执行，不可与 /admin 分支混在同一个组件里 */
const MainApp: React.FC = () => {
  const { user, logout, loading: authLoading, refresh: refreshAuthUser } = useAuth();

  const [mode, setMode] = useState<AppMode>(AppMode.WORKFLOW);
  const [capabilityPresets, setCapabilityPresets] = useState<CustomAppModule[]>(loadCapabilityPresets);
  const [capabilitySets, setCapabilitySets] = useState<CapabilitySet[]>(loadCapabilitySets);
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
    getLastOpenedWorkspaceProjectId(null)
  );
  const [workflowAssets, setWorkflowAssets] = useState<WorkflowAsset[]>(() => {
    const id = getLastOpenedWorkspaceProjectId(null);
    return id ? loadWorkflowBundle(id, null).assets : [];
  });
  const [workflowPending, setWorkflowPending] = useState<WorkflowPendingTask[]>(() => {
    const id = getLastOpenedWorkspaceProjectId(null);
    return id ? loadWorkflowBundle(id, null).pending : [];
  });

  const activeWorkspaceProjectIdRef = useRef<string | null>(activeWorkspaceProjectId);
  const workspaceProjectsRef = useRef(workspaceProjects);
  const userIdRef = useRef<string | undefined>(user?.id);
  const usernameRef = useRef<string | undefined>(user?.username);
  /** 仅在该用户完成云 hydrate / 迁移后允许 push，避免切换账号时用上一账号内存态覆盖云端 */
  const workspaceCloudPushAllowedUserIdRef = useRef<string | null>(null);
  const cloudWorkflowSyncGenRef = useRef(0);
  const [workspaceCloudHydratingProjectId, setWorkspaceCloudHydratingProjectId] = useState<string | null>(null);
  const workspaceCloudHydratingProjectIdRef = useRef<string | null>(null);
  const [workspaceCloudQuotaSuspended, setWorkspaceCloudQuotaSuspended] = useState(false);
  const workspaceCloudQuotaSuspendedRef = useRef(false);
  const editedWhileQuotaSuspendedRef = useRef(false);
  /** 离开工作区/切换项目时的整包上传中（阻塞 UI） */
  const [workspaceCloudLeaveSyncing, setWorkspaceCloudLeaveSyncing] = useState(false);
  const [workspaceCloudLastSyncAt, setWorkspaceCloudLastSyncAt] = useState<number | null>(null);
  const [workspaceCloudNextAutoSyncAt, setWorkspaceCloudNextAutoSyncAt] = useState<number | null>(null);
  const workspaceCloudNextAutoSyncAtRef = useRef<number | null>(null);
  workspaceCloudNextAutoSyncAtRef.current = workspaceCloudNextAutoSyncAt;
  const [workspaceCloudAutoSyncing, setWorkspaceCloudAutoSyncing] = useState(false);
  const [workspaceAutoSyncEnabled, setWorkspaceAutoSyncEnabledState] = useState<boolean>(() => getWorkspaceAutoSyncEnabled());
  const workspaceCloudAutoSyncingRef = useRef(false);
  const workspaceCloudConfigHydratedUserIdRef = useRef<string | null>(null);
  const workspaceCloudConfigHydratingUserIdRef = useRef<string | null>(null);
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
  /** 画布有未成功推送到云端的本地修改（用于关闭页面前提示） */
  const workspaceCloudDirtyRef = useRef(false);
  /** 刚从云端拉取合并完成，跳过一次「标脏」避免误判 */
  const workspaceCloudPullJustCompletedRef = useRef(false);
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
    if (workspaceCloudPullJustCompletedRef.current) {
      workspaceCloudPullJustCompletedRef.current = false;
      return;
    }
    if (workspaceCloudHydratingProjectId === activeWorkspaceProjectId) return;
    workspaceCloudDirtyRef.current = true;
  }, [authLoading, user?.id, workflowAssets, workflowPending, activeWorkspaceProjectId, workspaceCloudHydratingProjectId]);

  useEffect(() => {
    if (!workspaceCloudQuotaSuspended) return;
    if (!user?.id || !user?.username || !isWorkspaceCloudEnabled() || !activeWorkspaceProjectId) return;
    editedWhileQuotaSuspendedRef.current = true;
  }, [workflowAssets, workflowPending, workspaceCloudQuotaSuspended, user?.id, activeWorkspaceProjectId]);

  useEffect(() => {
    if (authLoading || !user?.id || !user?.username || !isWorkspaceCloudEnabled()) return;
    const uid = user.id;
    if (workspaceCloudConfigHydratedUserIdRef.current === uid) return;
    if (workspaceCloudConfigHydratingUserIdRef.current === uid) return;
    workspaceCloudConfigHydratingUserIdRef.current = uid;
    void (async () => {
      try {
        const cfg = await fetchWorkspaceUserCloudConfig(uid, user.username);
        if (userIdRef.current !== uid) return;
        if (cfg) {
          setCapabilityPresets(cfg.capabilityPresets);
          saveCapabilityPresets(cfg.capabilityPresets);
          setCapabilitySets(cfg.capabilitySets);
          saveCapabilitySets(cfg.capabilitySets);
          setDialogSkipUnderstand(cfg.settings.dialogSkipUnderstand);
          setDialogSkipUnderstandState(cfg.settings.dialogSkipUnderstand);
          setWorkspaceAutoSyncEnabled(cfg.settings.workspaceAutoSyncEnabled);
          setWorkspaceAutoSyncEnabledState(cfg.settings.workspaceAutoSyncEnabled);
          setAiProvider(cfg.settings.aiProvider);
          setUserApiKey(cfg.settings.geminiApiKey || null);
          setToapisApiKey(cfg.settings.toapisApiKey || null);
          setToapisBaseUrl(cfg.settings.toapisBaseUrl || null);
          setVectorengineApiKey(cfg.settings.vectorengineApiKey || null);
          setVectorengineBaseUrl(cfg.settings.vectorengineBaseUrl || null);
          setAiInvocationStatusRev((n) => n + 1);
        }
      } catch (e) {
        console.warn('[workspace cloud] user config pull', e);
      } finally {
        if (workspaceCloudConfigHydratingUserIdRef.current === uid) {
          workspaceCloudConfigHydratingUserIdRef.current = null;
        }
        workspaceCloudConfigHydratedUserIdRef.current = uid;
      }
    })();
  }, [authLoading, user?.id, user?.username]);

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
      void pushWorkspaceUserCloudConfig(uid, user.username, {
        capabilityPresets,
        capabilitySets,
        settings: {
          dialogSkipUnderstand: getDialogSkipUnderstand(),
          workspaceAutoSyncEnabled,
          aiProvider: getAiProvider(),
          geminiApiKey: getUserApiKey() || '',
          toapisApiKey: getToapisApiKey() || '',
          toapisBaseUrl: getToapisBaseUrl() || '',
          vectorengineApiKey: getVectorengineApiKey() || '',
          vectorengineBaseUrl: getVectorengineBaseUrl() || '',
        },
      }).catch((e) => console.warn('[workspace cloud] user config push', e));
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
  ]);

  /** `force`：手动点「立即同步」时必跑；`false` 时仅在有本地未推送改动时自动同步，避免每分钟全量打包上传。 */
  const triggerWorkspaceCloudSyncNow = useCallback(async (opts?: { force?: boolean }): Promise<boolean> => {
    if (workspaceCloudAutoSyncingRef.current) return false;
    if (mode !== AppMode.WORKFLOW) return false;
    const uid = userIdRef.current;
    const projectId = activeWorkspaceProjectIdRef.current;
    if (
      !uid ||
      !projectId ||
      !usernameRef.current ||
      !isWorkspaceCloudEnabled() ||
      workspaceCloudQuotaSuspendedRef.current ||
      workspaceCloudPushAllowedUserIdRef.current !== uid ||
      workspaceCloudHydratingProjectIdRef.current === projectId
    ) {
      return false;
    }
    if (!opts?.force && !workspaceCloudDirtyRef.current) {
      setWorkspaceCloudNextAutoSyncAt(Date.now() + WORKSPACE_AUTO_SYNC_INTERVAL_MS);
      return true;
    }
    workspaceCloudAutoSyncingRef.current = true;
    setWorkspaceCloudAutoSyncing(true);
    const bundle = { assets: workflowAssetsRef.current, pending: workflowPendingRef.current };
    try {
      await pushWorkflowBundleToCloud(uid, projectId, bundle, usernameRef.current);
      await pushWorkspaceIndex(uid, workspaceProjectsRef.current, activeWorkspaceProjectIdRef.current, usernameRef.current);
      workspaceCloudDirtyRef.current = false;
      setWorkspaceCloudLastSyncAt(Date.now());
      return true;
    } catch (e) {
      console.warn('[workspace cloud] auto sync', e);
      if (e instanceof HttpRequestError && e.code === 'STORAGE_QUOTA_EXCEEDED') {
        setWorkspaceCloudQuotaSuspended(true);
        editedWhileQuotaSuspendedRef.current = true;
        void refreshAuthUser();
      }
      return false;
    } finally {
      workspaceCloudAutoSyncingRef.current = false;
      setWorkspaceCloudAutoSyncing(false);
      setWorkspaceCloudNextAutoSyncAt(Date.now() + WORKSPACE_AUTO_SYNC_INTERVAL_MS);
    }
  }, [mode, refreshAuthUser]);

  useEffect(() => {
    if (
      !workspaceAutoSyncEnabled ||
      mode !== AppMode.WORKFLOW ||
      !activeWorkspaceProjectId ||
      !user?.id ||
      !user?.username ||
      !isWorkspaceCloudEnabled()
    ) {
      setWorkspaceCloudNextAutoSyncAt(null);
      return;
    }
    setWorkspaceCloudNextAutoSyncAt(Date.now() + WORKSPACE_AUTO_SYNC_INTERVAL_MS);
  }, [workspaceAutoSyncEnabled, mode, activeWorkspaceProjectId, user?.id, user?.username]);

  /** 到点触发自动同步：读 ref 避免闭包拿到过期的 nextAutoSyncAt；不通过 App 根每秒 setState 刷倒计时 */
  useEffect(() => {
    if (!workspaceAutoSyncEnabled) return;
    const id = window.setInterval(() => {
      const next = workspaceCloudNextAutoSyncAtRef.current;
      if (next == null || Date.now() < next) return;
      void triggerWorkspaceCloudSyncNow();
    }, 1000);
    return () => window.clearInterval(id);
  }, [triggerWorkspaceCloudSyncNow, workspaceAutoSyncEnabled]);

  const runCloudWorkflowPull = useCallback((userId: string, projectId: string) => {
    cloudWorkflowSyncGenRef.current += 1;
    const gen = cloudWorkflowSyncGenRef.current;
    setWorkspaceCloudHydratingProjectId(projectId);
    void (async () => {
      try {
        const packed = await fetchWorkflowPackedFromCloud(userId, projectId, usernameRef.current);
        if (gen !== cloudWorkflowSyncGenRef.current) return;
        if (activeWorkspaceProjectIdRef.current !== projectId) return;
        if (!packed) {
          setWorkspaceCloudHydratingProjectId((cur) => (cur === projectId ? null : cur));
          workspaceCloudPullJustCompletedRef.current = true;
          workspaceCloudDirtyRef.current = false;
          return;
        }
        setWorkflowAssets(JSON.parse(JSON.stringify(packed.assets)) as WorkflowAsset[]);
        setWorkflowPending(JSON.parse(JSON.stringify(packed.pending)) as WorkflowPendingTask[]);
        if (packed.version === 2) {
          const final = await hydrateWorkflowBundleFromCloud(
            { assets: packed.assets, pending: packed.pending },
            {
              onPartial: (d) => {
                if (gen !== cloudWorkflowSyncGenRef.current) return;
                if (activeWorkspaceProjectIdRef.current !== projectId) return;
                setWorkflowAssets(d.assets);
                setWorkflowPending(d.pending);
                trySaveWorkflowBundle(projectId, d, userId);
              },
            }
          );
          if (gen !== cloudWorkflowSyncGenRef.current) return;
          if (activeWorkspaceProjectIdRef.current !== projectId) return;
          setWorkflowAssets(final.assets);
          setWorkflowPending(final.pending);
          trySaveWorkflowBundle(projectId, final, userId);
        } else {
          const bundle = { assets: packed.assets, pending: packed.pending };
          trySaveWorkflowBundle(projectId, bundle, userId);
        }
        workspaceCloudPullJustCompletedRef.current = true;
        workspaceCloudDirtyRef.current = false;
      } catch (e) {
        console.warn('[workspace cloud] pull', e);
      } finally {
        setWorkspaceCloudHydratingProjectId((cur) =>
          cur === projectId && gen === cloudWorkflowSyncGenRef.current ? null : cur
        );
      }
    })();
  }, []);

  const [step, setStep] = useState<AppStep>(AppStep.T_PATTERN);
  const [tasks, setTasks] = useState<AppTask[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const sidebarCollapsed = false;
  /** 侧栏「实验性功能」分组：展开侧栏时默认折叠；进入实验性模块时自动展开 */
  const [experimentalNavExpanded, setExperimentalNavExpanded] = useState(false);

  const isExperimentalMode = useCallback((m: AppMode) =>
    m === AppMode.GENERATE_3D ||
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
  const addGlobalLog = useCallback((module: string, level: 'info' | 'warn' | 'error', message: string, detail?: string) => {
    setGlobalLogs(prev => [...prev.slice(-199), { id: Math.random().toString(36).slice(2, 11), time: Date.now(), module, level, message, detail }]);
  }, []);

  const workflowAssetsRef = useRef(workflowAssets);
  const workflowPendingRef = useRef(workflowPending);
  useEffect(() => {
    workflowAssetsRef.current = workflowAssets;
    workflowPendingRef.current = workflowPending;
  }, [workflowAssets, workflowPending]);

  const flushProjectPersistence = useCallback(() => {
    const pid = activeWorkspaceProjectIdRef.current;
    const scope = userIdRef.current ?? null;
    if (pid) {
      trySaveWorkflowBundle(pid, {
        assets: workflowAssetsRef.current,
        pending: workflowPendingRef.current,
      }, scope);
    }
    try {
      saveWorkspaceProjects(workspaceProjectsRef.current, scope);
    } catch {
      /* ignore */
    }
    /** 云同步改为仅在离开工作区/切换项目时整包上传，避免与渐进拉取竞态导致云端被不完整状态覆盖 */
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

  /** 未登录：工作区读回访客级 localStorage（与已登录账号隔离键） */
  useEffect(() => {
    if (authLoading) return;
    if (user?.id) return;
    setWorkspaceProjects(loadWorkspaceProjects(null));
    const last = getLastOpenedWorkspaceProjectId(null);
    setActiveWorkspaceProjectId(last);
    if (last) {
      const b = loadWorkflowBundle(last, null);
      setWorkflowAssets(b.assets);
      setWorkflowPending(b.pending);
    } else {
      setWorkflowAssets([]);
      setWorkflowPending([]);
    }
  }, [authLoading, user?.id]);

  /** 已登录且关闭云同步：仅使用当前用户隔离的 localStorage */
  useEffect(() => {
    if (authLoading || !user?.id || isWorkspaceCloudEnabled()) return;
    const uid = user.id;
    setWorkspaceProjects(loadWorkspaceProjects(uid));
    const last = getLastOpenedWorkspaceProjectId(uid);
    setActiveWorkspaceProjectId(last);
    if (last) {
      const b = loadWorkflowBundle(last, uid);
      setWorkflowAssets(b.assets);
      setWorkflowPending(b.pending);
    } else {
      setWorkflowAssets([]);
      setWorkflowPending([]);
    }
  }, [authLoading, user?.id]);

  /** 已登录且开启云同步：切换账号时先清空内存态，再从 R2 hydrate；访客数据仅在「云端无索引」时迁入 */
  useEffect(() => {
    if (authLoading || !user?.id || !user?.username || !isWorkspaceCloudEnabled()) return;
    const uid = user.id;
    workspaceCloudPushAllowedUserIdRef.current = null;
    cloudWorkflowSyncGenRef.current += 1;
    setWorkspaceCloudHydratingProjectId(null);
    setWorkspaceProjects([]);
    setActiveWorkspaceProjectId(null);
    setWorkflowAssets([]);
    setWorkflowPending([]);
    let cancelled = false;

    const applyIndex = (index: NonNullable<Awaited<ReturnType<typeof fetchWorkspaceCloudIndex>>>) => {
      const validLast =
        index.lastOpenProjectId && index.projects.some((p) => p.id === index.lastOpenProjectId)
          ? index.lastOpenProjectId
          : null;
      saveWorkspaceProjects(index.projects, uid);
      setWorkspaceProjects(index.projects);
      setLastOpenedWorkspaceProjectId(validLast, uid);
      setActiveWorkspaceProjectId(validLast);
      if (validLast) {
        const local = loadWorkflowBundle(validLast, uid);
        setWorkflowAssets(local.assets);
        setWorkflowPending(local.pending);
        runCloudWorkflowPull(uid, validLast);
      } else {
        setWorkflowAssets([]);
        setWorkflowPending([]);
      }
      workspaceCloudPushAllowedUserIdRef.current = uid;
    };

    void (async () => {
      try {
        const index = await fetchWorkspaceCloudIndex(uid, user.username);
        if (cancelled) return;
        if (index) {
          applyIndex(index);
          return;
        }
        const migrated = await migrateLocalWorkspaceToCloud(uid, user.username);
        if (cancelled) return;
        if (migrated) {
          const { projects, lastOpenProjectId } = migrated;
          const validLast =
            lastOpenProjectId && projects.some((p) => p.id === lastOpenProjectId) ? lastOpenProjectId : null;
          setWorkspaceProjects(projects);
          setLastOpenedWorkspaceProjectId(validLast, uid);
          setActiveWorkspaceProjectId(validLast);
          if (validLast) {
            const local = loadWorkflowBundle(validLast, uid);
            setWorkflowAssets(local.assets);
            setWorkflowPending(local.pending);
        runCloudWorkflowPull(uid, validLast);
          } else {
            setWorkflowAssets([]);
            setWorkflowPending([]);
          }
          workspaceCloudPushAllowedUserIdRef.current = uid;
          return;
        }
        const again = await fetchWorkspaceCloudIndex(uid, user.username);
        if (cancelled) return;
        if (again) {
          applyIndex(again);
          return;
        }
        const localOnly = loadWorkspaceProjects(uid);
        const last = getLastOpenedWorkspaceProjectId(uid);
        setWorkspaceProjects(localOnly);
        setActiveWorkspaceProjectId(last);
        if (last) {
          const b = loadWorkflowBundle(last, uid);
          setWorkflowAssets(b.assets);
          setWorkflowPending(b.pending);
        } else {
          setWorkflowAssets([]);
          setWorkflowPending([]);
        }
        workspaceCloudPushAllowedUserIdRef.current = uid;
      } catch (e) {
        console.warn('[workspace cloud] hydrate', e);
        if (cancelled) return;
        const localOnly = loadWorkspaceProjects(uid);
        const last = getLastOpenedWorkspaceProjectId(uid);
        setWorkspaceProjects(localOnly);
        setActiveWorkspaceProjectId(last);
        if (last) {
          const b = loadWorkflowBundle(last, uid);
          setWorkflowAssets(b.assets);
          setWorkflowPending(b.pending);
        } else {
          setWorkflowAssets([]);
          setWorkflowPending([]);
        }
        workspaceCloudPushAllowedUserIdRef.current = uid;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id, runCloudWorkflowPull]);

  useEffect(() => {
    if (!activeWorkspaceProjectId) return;
    const scope = user?.id ?? null;
    const t = window.setTimeout(() => {
      trySaveWorkflowBundle(activeWorkspaceProjectId, { assets: workflowAssets, pending: workflowPending }, scope);
    }, 650);
    return () => window.clearTimeout(t);
  }, [activeWorkspaceProjectId, workflowAssets, workflowPending, user?.id]);

  const proceedBackToWorkspaceShell = useCallback(() => {
    cloudWorkflowSyncGenRef.current += 1;
    setWorkspaceCloudHydratingProjectId(null);
    const scope = userIdRef.current ?? null;
    const pid = activeWorkspaceProjectIdRef.current;
    if (pid) {
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
      const local = loadWorkflowBundle(id, scope);
      setActiveWorkspaceProjectId(id);
      setLastOpenedWorkspaceProjectId(id, scope);
      setWorkflowAssets(local.assets);
      setWorkflowPending(local.pending);
      const uid = userIdRef.current;
      if (uid && usernameRef.current && isWorkspaceCloudEnabled()) {
        runCloudWorkflowPull(uid, id);
      }
    },
    [runCloudWorkflowPull]
  );

  const openWorkspaceProject = useCallback(
    async (id: string) => {
      const scope = userIdRef.current ?? null;
      const curId = activeWorkspaceProjectIdRef.current;
      if (curId && curId !== id) {
        const prevBundle = {
          assets: workflowAssetsRef.current,
          pending: workflowPendingRef.current,
        };
        trySaveWorkflowBundle(curId, prevBundle, scope);
        const uid = userIdRef.current;
        if (
          uid &&
          usernameRef.current &&
          isWorkspaceCloudEnabled() &&
          !workspaceCloudQuotaSuspendedRef.current &&
          workspaceCloudPushAllowedUserIdRef.current === uid
        ) {
          setWorkspaceCloudLeaveSyncing(true);
          try {
            await pushWorkflowBundleToCloud(uid, curId, prevBundle, usernameRef.current);
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
    [loadWorkspaceProjectInternal, refreshAuthUser]
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
        trySaveWorkflowBundle(pid, bundle, scope);
        const uid = userIdRef.current;
        if (
          uid &&
          usernameRef.current &&
          isWorkspaceCloudEnabled() &&
          !workspaceCloudQuotaSuspendedRef.current &&
          workspaceCloudPushAllowedUserIdRef.current === uid
        ) {
          setWorkspaceCloudLeaveSyncing(true);
          try {
            await pushWorkflowBundleToCloud(uid, pid, bundle, usernameRef.current);
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
    (name: string) => {
      const p = createWorkspaceProject(name);
      const next = [...workspaceProjects, p];
      setWorkspaceProjects(next);
      saveWorkspaceProjects(next, user?.id ?? null);
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
    [workspaceProjects, user?.id]
  );

  const renameWorkspaceProjectEntry = useCallback(
    (id: string, name: string) => {
      const trimmed = String(name || '').trim();
      if (!trimmed) return;
      const scope = user?.id ?? null;
      const next = workspaceProjects.map((p) => (p.id === id ? { ...p, name: trimmed } : p));
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
    [workspaceProjects, user?.id]
  );

  const requestDeleteWorkspaceProject = useCallback((id: string) => {
    const p = workspaceProjectsRef.current.find((q) => q.id === id);
    setWorkspaceProjectDeletePending({ id, name: p?.name ?? '该项目' });
  }, []);

  const performDeleteWorkspaceProject = useCallback((id: string) => {
    const scope = userIdRef.current ?? null;
    const uid = userIdRef.current;
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
  }, []);

  const activeWorkspaceProjectName = useMemo(
    () => workspaceProjects.find((p) => p.id === activeWorkspaceProjectId)?.name ?? '',
    [workspaceProjects, activeWorkspaceProjectId]
  );
  const workspaceCloudQuotaBytes = Number(user?.workspaceQuotaBytes ?? WORKSPACE_CLOUD_DEFAULT_QUOTA_BYTES);
  const workspaceCloudUsedBytes = Number(user?.workspaceUsedBytes ?? 0);
  const workspaceCloudUsageRatio = Math.max(
    0,
    Math.min(1, workspaceCloudQuotaBytes > 0 ? workspaceCloudUsedBytes / workspaceCloudQuotaBytes : 0)
  );
  const workspaceCloudUsagePercent = Math.round(workspaceCloudUsageRatio * 100);
  const aiInvocationReady = useMemo(() => isAiInvocationReady(), [aiInvocationStatusRev]);
  const workspaceProjectOptions = workspaceProjects.map((p) => ({ value: p.id, label: p.name }));
  const workspaceLastSyncText = formatTimestampText(workspaceCloudLastSyncAt);

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
  const workflowMainContentRef = useRef<HTMLDivElement | null>(null);
  const workflowMarqueeStartRef = useRef<((e: React.MouseEvent) => void) | null>(null);
  const workflowPaneWheelRef = useRef<((e: React.WheelEvent) => void) | null>(null);
  const registerWorkflowMarqueeStart = useCallback((handler: ((e: React.MouseEvent) => void) | null) => {
    workflowMarqueeStartRef.current = handler;
  }, []);
  const registerWorkflowPaneWheel = useCallback((handler: ((e: React.WheelEvent) => void) | null) => {
    workflowPaneWheelRef.current = handler;
  }, []);

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
  const [dialogInputImages, setDialogInputImages] = useState<Array<{ id: string; data: string; fromTemp?: boolean }>>([]);
  const [dialogImageGear, setDialogImageGear] = useState<DialogImageGear>('standard');
  const [dialogModel, setDialogModel] = useState<string>(
    () => DIALOG_IMAGE_GEARS.find((g) => g.id === 'standard')?.modelId || DIALOG_IMAGE_GEARS[0].modelId
  );
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
    handleDialogTempToggleSelect,
    handleDialogTempSelectAll,
    handleDialogTempInvertSelect,
    handleDialogTempBatchDownload,
  } = useDialogWorkspace(user?.id ?? null);
  const dialogTempFilteredRef = useRef(dialogTempFiltered);
  dialogTempFilteredRef.current = dialogTempFiltered;
  const DIALOG_BOX_LABELS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
  const dialogEndRef = useRef<HTMLDivElement>(null);
  const [dialogValidationError, setDialogValidationError] = useState<string | null>(null);
  const [atSuggestionsOpen, setAtSuggestionsOpen] = useState(false);
  const [atSuggestionsCursor, setAtSuggestionsCursor] = useState(0);
  const dialogInputRef = useRef<HTMLTextAreaElement>(null);
  const dialogInputWrapperRef = useRef<HTMLDivElement>(null);
  const adjustDialogTextareaHeight = useCallback(() => {
    const el = dialogInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = Math.min(typeof window !== 'undefined' ? window.innerHeight * 0.4 : 240, 280);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, []);
  useLayoutEffect(() => {
    adjustDialogTextareaHeight();
  }, [dialogInputText, adjustDialogTextareaHeight]);
  const dialogTempItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dialogTempMarqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const dialogTempMarqueeActiveRef = useRef(false);
  const [dialogTempMarqueeRect, setDialogTempMarqueeRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [dialogTempPreviewScale, setDialogTempPreviewScale] = useState(1);
  const dialogTempPreviewDragRef = useRef<{ startX: number; startY: number; startScale: number } | null>(null);
  const [dialogTempPreviewOffset, setDialogTempPreviewOffset] = useState({ x: 0, y: 0 });
  const dialogTempPreviewPanRef = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null);
  const dialogTempPreviewSpacePressedRef = useRef(false);
  const dialogTempPreviewImgRef = useRef<HTMLImageElement | null>(null);
  const dialogTempPreviewOverlayRef = useRef<HTMLDivElement | null>(null);
  const dialogTempPreviewZoomPivotRef = useRef<{ x: number; y: number } | null>(null);
  const dialogTempPreviewZoomLastScaleRef = useRef(1);
  const dialogTempPreviewWheelAccumRef = useRef(0);

  // 生成3D资产（腾讯混元生3D）
  const [generate3DMode, setGenerate3DMode] = useState<'text' | 'image'>('text');
  const [generate3DPrompt, setGenerate3DPrompt] = useState('');
  const [generate3DImage, setGenerate3DImage] = useState<string | null>(null);
  const [generate3DImageMode, setGenerate3DImageMode] = useState<'single' | 'multi'>('single');
  const [generate3DMultiViewImages, setGenerate3DMultiViewImages] = useState<Partial<Record<ViewId, string>>>({});
  const [generate3DModel, setGenerate3DModel] = useState<'3.0' | '3.1'>('3.0');
  const [generate3DType, setGenerate3DType] = useState<'Normal' | 'LowPoly' | 'Geometry' | 'Sketch'>('Normal');
  const [generate3DPolygonType, setGenerate3DPolygonType] = useState<'triangle' | 'quadrilateral'>('triangle');
  const [generate3DResultFormat, setGenerate3DResultFormat] = useState<'' | 'FBX' | 'STL' | 'USDZ'>('FBX');
  const [generate3DFaceCount, setGenerate3DFaceCount] = useState(100000);
  const [generate3DEnablePBR, setGenerate3DEnablePBR] = useState(false);
  const [generate3DCredsOverride, setGenerate3DCredsOverride] = useState<{ secretId: string; secretKey: string } | null>(null);
  const [rapidPrompt, setRapidPrompt] = useState('');
  const [rapidImage, setRapidImage] = useState<string | null>(null);
  const [rapidResultFormat, setRapidResultFormat] = useState<string>('FBX');
  const [rapidEnablePBR, setRapidEnablePBR] = useState(false);
  const [convertFileUrl, setConvertFileUrl] = useState('');
  const [convertFormat, setConvertFormat] = useState<string>('FBX');
  const [topologyFileUrl, setTopologyFileUrl] = useState('');
  const [textureModelUrl, setTextureModelUrl] = useState('');
  const [texturePrompt, setTexturePrompt] = useState('');
  const [textureRefImage, setTextureRefImage] = useState<string | null>(null);
  const [componentFileUrl, setComponentFileUrl] = useState('');
  const [uvFileUrl, setUvFileUrl] = useState('');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [generate3DModule, setGenerate3DModule] = useState<Generate3DModule>('pro');

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

  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [config] = useState<SystemConfig>(() => {
    const saved = localStorage.getItem('ac_config');
    if (saved) return JSON.parse(saved);
    return { 
      modelText: 'gemini-3-flash-preview', 
      modelImage: 'gemini-3.1-flash-image-preview', 
      modelPro: 'gemini-3-pro-image-preview', 
      customPromptSuffix: '',
      prompts: { ...DEFAULT_PROMPTS }
    };
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

  const {
    creds3D,
    unsafeTencentBrowserCredsEnabled,
    temp3DLibrary,
    selectedTemp3DId,
    setSelectedTemp3DId,
    generate3DQueue,
    generate3DPreview,
    appendQueueItem,
    cancelQueueItem,
    retryQueueItem,
    clearInactiveQueueItems,
  } = useGenerate3DManager({
    credsOverride: generate3DCredsOverride,
    onLog: addGenerate3DLog,
    updateTask,
  });

  const handleGenerate3D = () => {
    if (!creds3D) return;
    const hasText = generate3DMode === 'text' && !!generate3DPrompt.trim();
    const multiList = PRO_VIEW_IDS.map((id) => generate3DMultiViewImages[id]).filter(Boolean) as string[];
    const hasMulti = generate3DMode === 'image' && generate3DImageMode === 'multi' && multiList.length >= 2;
    const hasSingle = generate3DMode === 'image' && generate3DImageMode === 'single' && !!generate3DImage;
    if (!hasText && !hasSingle && !hasMulti) {
      addGenerate3DLog('warn', '请填写文本、上传单图或至少 2 张多视角图');
      alert('请填写文本描述、上传一张图片，或多视图下至少上传 2 张不同视角图片。');
      return;
    }
    const baseOpts = {
      model: generate3DModel,
      enablePBR: generate3DEnablePBR,
      faceCount: generate3DFaceCount,
      generateType: generate3DType,
      polygonType: generate3DType === 'LowPoly' ? generate3DPolygonType : undefined,
      resultFormat: generate3DResultFormat || undefined,
    };
    const input: Submit3DProInput = hasText
      ? { prompt: generate3DPrompt.trim(), ...baseOpts }
      : hasMulti
        ? { multiViewImageBase64: multiList, ...baseOpts }
        : {
            imageBase64: generate3DImage!.replace(/^data:image\/\w+;base64,/, ''),
            ...baseOpts,
          };
    const id = Math.random().toString(36).slice(2, 11);
    const taskId = addTask('GENERATE_3D', '混元生3D');
    appendQueueItem({ id, type: 'pro', input, taskId, label: (input.prompt || '').trim().slice(0, 20) || '图生3D' });
    addGenerate3DLog('info', '[本地] 已加入生成队列', { id });
  };

  const handleSave3DToLibrary = async (item?: Temp3DItem | null) => {
    const target = item ?? (selectedTemp3DId ? temp3DLibrary.find(i => i.id === selectedTemp3DId) : null) ?? (temp3DLibrary[0] ?? null);
    if (!target || !target.files.length) return;
    const previewImageUrl = target.previewImageUrl;
    const dataUrl = previewImageUrl
      ? await fetch(previewImageUrl).then(r => r.blob()).then(b => new Promise<string>((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result as string);
          reader.onerror = rej;
          reader.readAsDataURL(b);
        })).catch(() => '')
      : '';
    addToLibrary([{
      data: dataUrl || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="#1a1a2e" width="200" height="200"/><text x="100" y="100" fill="#666" text-anchor="middle" font-size="12">3D</text></svg>'),
      type: 'MODEL',
      category: 'MESH_MODEL',
      label: target.label,
      modelUrls: target.files.map(f => f.Url).filter(Boolean) as string[],
    }]);
  };

  const handleRapid3D = () => {
    if (!creds3D) return;
    const hasText = !!rapidPrompt.trim();
    const hasImage = !!rapidImage;
    if (!hasText && !hasImage) {
      addGenerate3DLog('warn', '极速版：请填写文本或上传图片');
      return;
    }
    const input: Submit3DRapidInput = hasText
      ? { prompt: rapidPrompt.trim(), resultFormat: rapidResultFormat, enablePBR: rapidEnablePBR }
      : { imageBase64: rapidImage!.replace(/^data:image\/\w+;base64,/, ''), resultFormat: rapidResultFormat, enablePBR: rapidEnablePBR };
    const id = Math.random().toString(36).slice(2, 11);
    const taskId = addTask('GENERATE_3D', '极速版3D');
    appendQueueItem({ id, type: 'rapid', input, taskId, label: (input.prompt || '').trim().slice(0, 20) || '极速3D' });
    addGenerate3DLog('info', '[极速版3D] 已加入队列', { id });
  };

  /** 工作流中拖图到「生成3D」能力时：用能力预设参数提交 3D 任务 */
  const handleAddGenerate3DJobFromWorkflow = (preset: CustomAppModule, imageBase64: string) => {
    if (preset.category !== 'generate_3d' || !preset.generate3D || !creds3D) return;
    const raw = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const normalize3D = (input: NonNullable<CustomAppModule['generate3D']>) => {
      const g = { ...input };
      // module
      if (g.module !== 'pro' && g.module !== 'rapid') g.module = 'pro';
      // resultFormat whitelist（避免无效参数）
      const allowed = new Set(['STL', 'USDZ', 'FBX']);
      if (g.resultFormat && !allowed.has(g.resultFormat)) g.resultFormat = undefined;
      // pro-only fields
      if (g.module === 'pro') {
        if (g.model !== '3.0' && g.model !== '3.1') g.model = '3.0';
        if (typeof g.faceCount === 'number' && !Number.isNaN(g.faceCount)) {
          const n = Math.floor(g.faceCount);
          g.faceCount = Math.max(10000, Math.min(1500000, n));
        } else {
          g.faceCount = undefined;
        }
      } else {
        g.model = undefined;
        g.faceCount = undefined;
        g.generateType = undefined;
      }
      return g;
    };
    const g = normalize3D(preset.generate3D);
    const id = Math.random().toString(36).slice(2, 11);
    const taskId = addTask('GENERATE_3D', preset.label);
    if (g.module === 'pro') {
      const input: Submit3DProInput = {
        imageBase64: raw,
        prompt: (preset.instruction?.trim() || g.prompt?.trim()) || undefined,
        model: g.model ?? '3.0',
        enablePBR: g.enablePBR,
        faceCount: g.faceCount,
        generateType: g.generateType,
        resultFormat: g.resultFormat,
      };
      appendQueueItem({ id, type: 'pro', input, taskId, label: preset.label });
    } else {
      const input: Submit3DRapidInput = {
        imageBase64: raw,
        resultFormat: g.resultFormat,
        enablePBR: g.enablePBR,
      };
      appendQueueItem({ id, type: 'rapid', input, taskId, label: preset.label });
    }
    addGenerate3DLog('info', `[工作流] 已加入 3D 队列：${preset.label}`, { id });
  };

  const handleConvert3D = () => {
    if (!creds3D || !convertFileUrl.trim()) return;
    const input = { fileUrl: convertFileUrl.trim(), format: convertFormat };
    const id = Math.random().toString(36).slice(2, 11);
    const taskId = addTask('GENERATE_3D', '格式转换');
    appendQueueItem({ id, type: 'convert', input, taskId, label: `转换 ${convertFormat}` });
    addGenerate3DLog('info', '[格式转换] 已加入队列', { id });
  };

  const handleTopology3D = () => {
    if (!creds3D || !topologyFileUrl.trim()) return;
    const input = { fileUrl: topologyFileUrl.trim() };
    const id = Math.random().toString(36).slice(2, 11);
    const taskId = addTask('GENERATE_3D', '智能拓扑');
    appendQueueItem({ id, type: 'topology', input, taskId, label: '智能拓扑' });
    addGenerate3DLog('info', '[智能拓扑] 已加入队列', { id });
  };

  const handleTexture3D = () => {
    if (!creds3D || !textureModelUrl.trim()) return;
    if (!texturePrompt.trim() && !textureRefImage) return;
    const input = { modelUrl: textureModelUrl.trim(), prompt: texturePrompt.trim(), imageBase64: textureRefImage?.replace(/^data:image\/\w+;base64,/, '') };
    const id = Math.random().toString(36).slice(2, 11);
    const taskId = addTask('GENERATE_3D', '纹理生成');
    appendQueueItem({ id, type: 'texture', input, taskId, label: '纹理生成' });
    addGenerate3DLog('info', '[纹理生成] 已加入队列', { id });
  };

  const handleComponent3D = () => {
    if (!creds3D || !componentFileUrl.trim()) return;
    const input = { fileUrl: componentFileUrl.trim() };
    const id = Math.random().toString(36).slice(2, 11);
    const taskId = addTask('GENERATE_3D', '组件生成');
    appendQueueItem({ id, type: 'component', input, taskId, label: '组件生成' });
    addGenerate3DLog('info', '[组件生成] 已加入队列', { id });
  };

  const handleUV3D = () => {
    if (!creds3D || !uvFileUrl.trim()) return;
    const input = { fileUrl: uvFileUrl.trim() };
    const id = Math.random().toString(36).slice(2, 11);
    const taskId = addTask('GENERATE_3D', 'UV展开');
    appendQueueItem({ id, type: 'uv', input, taskId, label: 'UV展开' });
    addGenerate3DLog('info', '[UV展开] 已加入队列', { id });
  };

  const handleProfile3D = () => {
    if (!creds3D || !profileImage) return;
    const input = { imageBase64: profileImage.replace(/^data:image\/\w+;base64,/, '') };
    const id = Math.random().toString(36).slice(2, 11);
    const taskId = addTask('GENERATE_3D', '3D人物生成');
    appendQueueItem({ id, type: 'profile', input, taskId, label: '3D人物' });
    addGenerate3DLog('info', '[3D人物生成] 已加入队列', { id });
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
    if (!dialogTempPreviewId) {
      setDialogTempPreviewScale(1);
      setDialogTempPreviewOffset({ x: 0, y: 0 });
      dialogTempPreviewDragRef.current = null;
      dialogTempPreviewPanRef.current = null;
      dialogTempPreviewZoomPivotRef.current = null;
      dialogTempPreviewZoomLastScaleRef.current = 1;
      dialogTempPreviewWheelAccumRef.current = 0;
    }
  }, [dialogTempPreviewId]);

  useEffect(() => {
    if (!dialogTempPreviewId) return;
    const blockContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    // 捕获阶段全局拦截，尽量避免浏览器插件抢右键菜单。
    window.addEventListener('contextmenu', blockContextMenu, true);
    return () => {
      window.removeEventListener('contextmenu', blockContextMenu, true);
    };
  }, [dialogTempPreviewId]);

  /** Esc：document 捕获 + 遮罩 focus，避免焦点在输入框或 CustomDropdown 冒泡拦截时关不掉。 */
  useLayoutEffect(() => {
    if (!dialogTempPreviewId) return;
    const onEscCapture = (e: KeyboardEvent) => {
      if (!isImagePreviewEscapeKey(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setDialogTempPreviewId(null);
    };
    document.addEventListener('keydown', onEscCapture, true);
    return () => document.removeEventListener('keydown', onEscCapture, true);
  }, [dialogTempPreviewId, setDialogTempPreviewId]);

  useLayoutEffect(() => {
    if (!dialogTempPreviewId) return;
    dialogTempPreviewOverlayRef.current?.focus({ preventScroll: true });
  }, [dialogTempPreviewId]);

  useEffect(() => {
    if (!dialogTempPreviewId) return;
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
  }, [dialogTempPreviewId]);

  useEffect(() => {
    if (!dialogTempPreviewId) return;
    const onWheel = (e: WheelEvent) => {
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
  }, [dialogTempPreviewId, setDialogTempPreviewId]);

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

  /** 根据格式将资产发送到各模块：图片可继续编辑/生成3D/贴图，3D 模型可进入生成3D 各子模块 */
  const sendLibraryItemToDialog = (item: LibraryItem) => {
    if (!item.data || item.data.includes('data:image/svg+xml')) return;
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
  const sendLibraryItemToGenerate3DImage = (item: LibraryItem) => {
    if (!item.data || item.data.includes('data:image/svg+xml')) return;
    setGenerate3DMode('image');
    setGenerate3DImageMode('single');
    setGenerate3DImage(item.data);
    setGenerate3DMultiViewImages({});
    setMode(AppMode.GENERATE_3D);
    setGenerate3DModule('pro');
    setIsSidebarOpen(false);
  };
  const sendLibraryItemToGenerate3DModel = (item: LibraryItem) => {
    const url = item.modelUrls?.[0];
    if (!url) return;
    setMode(AppMode.GENERATE_3D);
    setIsSidebarOpen(false);
    setTopologyFileUrl(url);
    setTextureModelUrl(url);
    setComponentFileUrl(url);
    setUvFileUrl(url);
    setConvertFileUrl(url);
    setGenerate3DModule('topology');
  };

  const LibraryCard: React.FC<{
    items: LibraryItem[];
    isSelected: boolean;
    onToggleSelect: () => void;
    onDelete: (groupId: string) => void;
    onSendToDialog?: (item: LibraryItem) => void;
    onSendToTexture?: (item: LibraryItem) => void;
    onSendToGenerate3DImage?: (item: LibraryItem) => void;
    onSendToGenerate3DModel?: (item: LibraryItem) => void;
  }> = ({ items, isSelected, onToggleSelect, onDelete, onSendToDialog, onSendToTexture, onSendToGenerate3DImage, onSendToGenerate3DModel }) => {
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
           <img src={activeItem.data} className="max-w-full max-h-full object-contain" alt={activeItem.label} />
        </div>
        <div className="flex-1 px-1">
          <div className="text-[10px] font-bold truncate mb-4 uppercase tracking-widest">{activeItem.label}</div>
          {items.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-5 min-h-[24px]">
              {items.map((it, idx) => (
                <button key={it.id} onClick={() => setActiveIdx(idx)} className={`w-8 h-8 rounded-lg flex items-center justify-center text-[7px] font-black border ${activeIdx === idx ? 'bg-blue-600 border-blue-500' : 'bg-[#1c1c22] border-[#2e2e32]'}`}>{it.style?.slice(0,3).toUpperCase() || 'DEF'}</button>
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
                {hasImage && onSendToGenerate3DImage && <button onClick={() => onSendToGenerate3DImage(activeItem)} className="py-1.5 px-2.5 rounded-lg bg-[#3d2a10] border border-[#d97706] text-[8px] font-black uppercase hover:bg-[#b45309] text-amber-300">生成3D</button>}
                {has3DModelUrl && onSendToGenerate3DModel && <button onClick={() => onSendToGenerate3DModel(activeItem)} className="py-1.5 px-2.5 rounded-lg bg-[#14532d] border border-[#34d399] text-[8px] font-black uppercase hover:bg-[#166534] text-emerald-300">生成3D 中使用</button>}
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
              <label className="w-full h-64 cursor-pointer group flex flex-col items-center justify-center border-2 border-dashed border-[#2e2e32] rounded-3xl hover:bg-[#1a2332] transition-all">
                <AppIcon name="image" className="w-8 h-8 mb-4" />
                <span className="text-[9px] font-black uppercase text-gray-500">上传源图像</span>
                <input type="file" className="hidden" accept="image/*" onChange={e => handleFileUpload(e, setTextureSource)} />
              </label>
              <button onClick={() => openPicker(undefined, (items) => setTextureSource(items[0]?.data ?? ''))} className="w-full py-4 bg-[#1c1c22] border border-[#2e2e32] rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-[#2e2e36] transition-all flex items-center justify-center gap-2">
                <AppIcon name="package" className="w-4 h-4" /> 从资产库导入
              </button>
            </div>
          ) : (
            <div className="relative aspect-square rounded-2xl overflow-hidden border border-[#2e2e32] group">
              <img src={textureSource} className="w-full h-full object-cover" />
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
                  {textureResult ? <img src={textureResult} className="max-w-full max-h-full object-contain p-8" /> : <span className="text-[10px] font-black uppercase text-gray-700">提取结果待生成</span>}
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
            <select value={filterSource} onChange={e => setFilterSource(e.target.value as any)} className="bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 transition-colors">
              <option value="all">全部</option>
              <option value="dialog">对话</option>
              <option value="texture">提取花纹</option>
            </select>
            <span className="text-[9px] font-black text-gray-500 uppercase ml-4">评分</span>
            <select value={filterRated} onChange={e => setFilterRated(e.target.value as any)} className="bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 transition-colors">
              <option value="all">全部</option>
              <option value="yes">已评分</option>
              <option value="no">未评分</option>
            </select>
            <button onClick={exportJson} className="px-4 py-2 bg-[#1e3558] border border-[#4b6a9e] rounded-xl text-[9px] font-black uppercase text-blue-400 hover:bg-[#305a90] transition-all">导出 JSON</button>
            <button onClick={exportStructuredJson} className="px-4 py-2 bg-[#3d2a10] border border-[#b45309] rounded-xl text-[9px] font-black uppercase text-amber-400 hover:bg-[#92400e] transition-all" title="主体/场景/风格/修饰/参数化模板，便于代码转自然语言">导出结构化 JSON</button>
            <button onClick={exportCsv} className="px-4 py-2 bg-[#1e3558] border border-[#4b6a9e] rounded-xl text-[9px] font-black uppercase text-blue-400 hover:bg-[#305a90] transition-all">导出 CSV</button>
            <span className="text-[9px] font-black text-gray-500 uppercase ml-4">显示</span>
            <button onClick={() => setViewMode('list')} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border transition-all ${viewMode === 'list' ? 'bg-[#1e3558] text-blue-400 border-[#4b6a9e]' : 'bg-[#1c1c22] border-[#2e2e32] hover:bg-[#2e2e36]'}`}>列表</button>
            <button onClick={() => setViewMode('repro')} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border transition-all ${viewMode === 'repro' ? 'bg-[#1e3558] text-blue-400 border-[#4b6a9e]' : 'bg-[#1c1c22] border-[#2e2e32] hover:bg-[#2e2e36]'}`}>复现模板</button>
          </div>
          <p className="text-[9px] text-gray-500">共 {filtered.length} 条（最近 500 条），仅读分析用，不改动提示词或配置。</p>
        </section>
        <section className="glass p-6 rounded-[2.5rem] border-[#252528]">
          <h3 className="text-[10px] font-black text-blue-400 uppercase mb-4">按来源聚合</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(Object.entries(bySource) as [string, SourceAggregate][]).map(([key, agg]) => (
              <div key={key} className="bg-[#16161a] rounded-xl p-4 border border-[#2e2e32]">
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
                  <thead className="sticky top-0 bg-[#1e1e22] border-b border-[#2e2e32]">
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
                  <div key={r.id} className="bg-[#16161a] rounded-xl border border-[#2e2e32] overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-[#2e2e32] bg-[#1c1c22] flex-wrap gap-2">
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
                        <pre className="p-3 rounded-lg bg-[#16161a] border border-[#2e2e32] text-[10px] text-amber-200/90 font-mono whitespace-pre-wrap break-all">{template}</pre>
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

      <div className={`fixed top-1/2 left-4 -translate-y-1/2 z-[1001] w-14 max-h-[calc(100dvh-2rem)] transition-all ${isSidebarOpen ? 'opacity-100' : 'opacity-100'}`}>
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] shadow-2xl p-2 overflow-y-auto no-scrollbar">
          <div className="flex flex-col items-center gap-2">
            {user ? (
              <div className="w-full">
                <CustomDropdown
                  options={[
                    { value: 'manage', label: '管理账户' },
                    { value: 'switch', label: '切换用户' },
                    { value: 'logout', label: '退出登录' },
                  ]}
                  value=""
                  placeholder="◎"
                  onChange={(value) => { void handleUserMenuAction(value); }}
                  triggerClassName="w-full h-10 bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-0 py-0 text-[14px] text-center flex items-center justify-center outline-none focus:border-blue-500 hover:bg-[#2e2e36] transition-colors"
                />
              </div>
            ) : null}

            <SidebarIconButton active={mode === AppMode.WORKFLOW} label="工作区" onClick={() => { setMode(AppMode.WORKFLOW); setIsSidebarOpen(false); }}>
              <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><path d="M3.5 8.5L10 3.5l6.5 5v8H3.5v-8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M8 16.5v-4h4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </SidebarIconButton>
            <SidebarIconButton active={mode === AppMode.DIALOG} label="对话" onClick={() => { setMode(AppMode.DIALOG); setIsSidebarOpen(false); }}>
              <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><path d="M4 5.5h12v8H9l-3.5 3v-3H4v-8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
            </SidebarIconButton>
            <SidebarIconButton active={mode === AppMode.SETTINGS} label="设置" onClick={() => { setMode(AppMode.SETTINGS); setIsSidebarOpen(false); }}>
              <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6"/><path d="M10 3v2.1M10 14.9V17M17 10h-2.1M5.1 10H3M14.9 5.1l-1.5 1.5M6.6 13.4l-1.5 1.5M14.9 14.9l-1.5-1.5M6.6 6.6 5.1 5.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </SidebarIconButton>

            <div className={`rounded-xl border overflow-hidden ${isExperimentalMode(mode) && !experimentalNavExpanded ? 'border-blue-500/25' : 'border-[#2e2e32]'}`}>
              <button
                type="button"
                onClick={() => setExperimentalNavExpanded((e) => !e)}
                className={`group relative w-full h-10 flex items-center justify-center text-[15px] transition-colors duration-200 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50 ${isExperimentalMode(mode) && !experimentalNavExpanded ? 'text-blue-400/90 bg-[#152642] hover:bg-[#1a2d4d]' : 'text-gray-400 hover:bg-[#2e2e36]'}`}
                aria-label="实验性功能"
                aria-expanded={experimentalNavExpanded}
              >
                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><path d="M8 3.5h4M9 3.5v4.2l-4.1 6.6a2 2 0 0 0 1.7 3h6.8a2 2 0 0 0 1.7-3L11 7.7V3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M6.8 12.5h6.4" stroke="currentColor" strokeWidth="1.4"/></svg>
                <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 rounded-lg border border-[#2e2e32] bg-[#050505] px-2 py-1 text-[10px] text-gray-200 whitespace-nowrap opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150">
                  实验性功能
                </span>
              </button>
            </div>
          </div>

          {experimentalNavExpanded && (
            <div className="mt-2 pt-2 border-t border-[#2e2e32] flex flex-col gap-2">
              <SidebarIconButton active={mode === AppMode.GENERATE_3D} label="生成3D" onClick={() => { setMode(AppMode.GENERATE_3D); setIsSidebarOpen(false); }}>
                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden><path d="M10 2.8 16 6v8l-6 3.2L4 14V6l6-3.2Z" stroke="currentColor" strokeWidth="1.6"/><path d="M4 6l6 3.1L16 6M10 9.1V17" stroke="currentColor" strokeWidth="1.4"/></svg>
              </SidebarIconButton>
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
      </div>

      <Suspense fallback={null}>
        <SiteAssistant tasks={tasks} onRemoveTask={id => setTasks(p => p.filter(t => t.id !== id))} />
      </Suspense>

      {/* 全局日志：悬浮图标（位于网页助手上方）+ 可开关面板 */}
      <div className="fixed bottom-24 right-6 z-[2001] flex items-center justify-center">
        <button
          type="button"
          onClick={() => setGlobalLogOpen(v => !v)}
          className={`relative w-12 h-12 rounded-full border shadow-lg flex items-center justify-center transition-all outline-none focus:ring-2 focus:ring-blue-500/50 ${
            globalLogOpen
              ? 'bg-[#1a3354] border-[#3b6fb8] text-blue-200'
              : 'bg-[#16161a] border-[#343438] text-gray-200 hover:bg-[#1f1f24] hover:border-[#3b6fb8]'
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
          className="fixed bottom-40 right-6 z-[2000] w-[min(420px,calc(100vw-3rem))] max-h-[min(56vh,420px)] rounded-2xl border border-[#343438] bg-[#0f0f0f] shadow-2xl overflow-hidden"
          role="dialog"
          aria-label="全局日志"
        >
          <div className="px-4 py-3 border-b border-[#2e2e32] bg-[#141416] flex items-center justify-between gap-3">
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
                    className="w-full text-left rounded-xl border border-[#2e2e32] bg-[#141416] px-3 py-2.5 hover:bg-[#1a1a20] transition-colors"
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

      <main className="flex-1 flex flex-col h-[100dvh] overflow-hidden">
        <div
          ref={mainScrollRef}
          className={`flex-1 no-scrollbar touch-pan-y ${
            mode === AppMode.WORKFLOW && activeWorkspaceProjectId
              ? 'overflow-hidden p-3 pt-3 pl-24 lg:px-6 lg:pt-4 lg:pb-6 lg:pl-28'
              : 'overflow-y-auto p-4 pt-6 pl-24 lg:p-10 lg:pl-28'
          }`}
          onMouseDownCapture={(e) => {
            if (mode !== AppMode.WORKFLOW || !activeWorkspaceProjectId) return;
            const t = e.target as Element | null;
            if (t?.closest('[data-ac-block-workflow-marquee]')) return;
            workflowMarqueeStartRef.current?.(e);
          }}
          onWheelCapture={(e) => {
            if (mode !== AppMode.WORKFLOW || !activeWorkspaceProjectId) return;
            const target = e.target as Element | null;
            if (target?.closest('[data-ac-block-workflow-marquee]')) return;
            // 工作区内部（仓库/大纲/工作区/功能区/能力）始终放行原生纵向滚动与拖放
            if (
              target?.closest(
                '[data-workflow-sidebar], [data-workflow-preset], [data-workflow-outline], [data-workflow-card], [data-workflow-library-card]'
              )
            ) {
              return;
            }
            // 仅主内容两侧留白触发：用坐标判定，避免 closest 在复杂目标下误判
            const content = workflowMainContentRef.current;
            if (content) {
              const r = content.getBoundingClientRect();
              if (e.clientX >= r.left && e.clientX <= r.right) return;
            } else if (target?.closest('.max-w-6xl')) {
              return;
            }
            // 空白区滚轮明确用于横向切页：先阻止主容器默认纵向滚动，避免出现“微微上下抖动”
            e.preventDefault();
            workflowPaneWheelRef.current?.(e);
          }}
        >
          <div ref={workflowMainContentRef} className="max-w-6xl mx-auto w-full">
            {mode === AppMode.SETTINGS && (
              <Suspense fallback={<LazySectionFallback label="设置" />}>
                <SettingsSection
                  currentUser={user}
                  authLoading={authLoading}
                  onRefreshUser={refreshAuthUser}
                  onLogout={logout}
                />
              </Suspense>
            )}
            {mode === AppMode.TEXTURE && <TextureEngineSection />}

            {mode === AppMode.WORKFLOW && !activeWorkspaceProjectId && (
              <>
                {user?.id && isWorkspaceCloudEnabled() ? (
                  <div
                    className="max-w-6xl mx-auto w-full mb-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                    title="仅统计已同步到云端的流程图片；返回列表或切换项目时整包上传"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 gap-y-1">
                      <span className="text-[9px] text-gray-500">云空间</span>
                      <span className="text-[10px] text-gray-400 font-mono tabular-nums">
                        {formatWorkspaceCloudMb(workspaceCloudUsedBytes)} / {formatWorkspaceCloudMb(workspaceCloudQuotaBytes)}{' '}
                        <span className="text-gray-600">·</span> {workspaceCloudUsagePercent}%
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          workspaceCloudUsageRatio >= 0.95
                            ? 'bg-red-500/70'
                            : workspaceCloudUsageRatio >= 0.8
                            ? 'bg-amber-500/60'
                            : 'bg-gray-500/45'
                        }`}
                        style={{ width: `${Math.max(0, Math.min(100, workspaceCloudUsagePercent))}%` }}
                      />
                    </div>
                    <p className="mt-2 text-[9px] text-gray-600 leading-snug">
                      以上为<strong className="text-gray-500">云端工作区图片</strong>用量；本机浏览器另有<strong className="text-gray-500">整站 localStorage 上限</strong>（与浏览器有关）。详见设置 → 数据与存储。
                    </p>
                  </div>
                ) : user?.id && !isWorkspaceCloudEnabled() ? (
                  <div className="max-w-6xl mx-auto w-full mb-5 rounded-xl border border-[#2e2e32] bg-[#121214] px-4 py-2.5 text-[10px] text-gray-500">
                    工作区云同步已关闭（VITE_WORKSPACE_CLOUD=false），数据仅保存在本机。
                  </div>
                ) : null}
                <WorkspaceProjectShell
                  projects={workspaceProjects}
                  onCreate={createWorkspaceProjectEntry}
                  onOpen={openWorkspaceProject}
                  onRename={renameWorkspaceProjectEntry}
                  onDelete={requestDeleteWorkspaceProject}
                />
              </>
            )}
            {mode === AppMode.WORKFLOW && activeWorkspaceProjectId && (
              <WorkflowErrorBoundary>
                <div className="w-full max-w-6xl mx-auto mb-2 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      void backToWorkspaceProjectShell();
                    }}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[#1c1c22] border border-[#2e2e32] text-gray-300 hover:bg-[#2e2e36] hover:text-white transition-colors duration-200 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                    title="返回项目列表（将先同步到云端）"
                    aria-label="返回项目列表"
                  >
                    <svg aria-hidden viewBox="0 0 20 20" className="w-3 h-3" fill="none">
                      <path
                        d="M12.5 4.5L7 10l5.5 5.5"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <div className="min-w-[8rem] max-w-[min(100%,18rem)]">
                    <CustomDropdown
                      options={workspaceProjectOptions}
                      value={activeWorkspaceProjectId ?? ''}
                      onChange={(id) => {
                        if (!id || id === activeWorkspaceProjectId) return;
                        void openWorkspaceProject(id);
                      }}
                      placeholder={activeWorkspaceProjectName || '选择项目'}
                      triggerClassName="w-full h-7 bg-[#1c1c22] border border-[#2e2e32] rounded-lg px-2.5 text-[8px] text-left flex items-center justify-between outline-none focus:border-blue-500 hover:bg-[#2e2e36] transition-colors"
                    />
                  </div>
                  {workspaceCloudHydratingProjectId === activeWorkspaceProjectId ? (
                    <span className="text-[8px] text-amber-400/90 font-medium animate-pulse" title="正按资源分批从云端还原图像">
                      正在从云端渐进载入图像…
                    </span>
                  ) : null}
                  {user?.id && isWorkspaceCloudEnabled() ? (
                    <div className="flex items-center gap-2">
                      <div className={`text-[8px] whitespace-nowrap ${workspaceCloudAutoSyncing ? 'text-blue-300 animate-pulse' : 'text-gray-400'}`}>
                        云同步: {workspaceLastSyncText} · 自动同步倒计时{' '}
                        <WorkspaceCloudSyncCountdown
                          enabled={workspaceAutoSyncEnabled}
                          nextAt={workspaceCloudNextAutoSyncAt}
                          syncing={workspaceCloudAutoSyncing}
                        />
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={workspaceAutoSyncEnabled}
                        onClick={() => {
                          setWorkspaceAutoSyncEnabledState((prev) => {
                            const next = !prev;
                            setWorkspaceAutoSyncEnabled(next);
                            return next;
                          });
                        }}
                        className={`relative inline-flex shrink-0 w-8 h-4 rounded-full transition-colors ${
                          workspaceAutoSyncEnabled ? 'bg-blue-600' : 'bg-[#26262c]'
                        }`}
                        title={
                          workspaceAutoSyncEnabled
                            ? '关闭后不再定时上传，编辑更流畅；需要时点「立即同步」'
                            : '开启后按间隔将改动备份到云端（有改动才上传）'
                        }
                        aria-label={workspaceAutoSyncEnabled ? '自动同步已开启，点击关闭' : '自动同步已关闭，点击开启'}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                            workspaceAutoSyncEnabled ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void triggerWorkspaceCloudSyncNow({ force: true });
                        }}
                        disabled={workspaceCloudAutoSyncing}
                        className="h-6 px-2 rounded-md border border-[#2e2e32] bg-[#1c1c22] text-[8px] text-gray-300 hover:bg-[#2e2e36] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="手动全量同步到云端（关闭自动同步时靠此项备份）"
                        aria-label="立即同步当前工作区到云端"
                      >
                        立即同步
                      </button>
                    </div>
                  ) : null}
                  {user?.id && isWorkspaceCloudEnabled() ? (
                    <div className="ml-auto flex items-center gap-1.5">
                      <div
                        className="min-w-[8rem] max-w-[12rem] shrink rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1"
                        title="仅统计已同步到云端的流程图片"
                      >
                        <div className="flex items-center justify-between gap-1.5 text-[8px] text-gray-500">
                          <span>云空间</span>
                          <span className="font-mono tabular-nums text-gray-400">
                            {formatWorkspaceCloudMb(workspaceCloudUsedBytes)} / {formatWorkspaceCloudMb(workspaceCloudQuotaBytes)}
                          </span>
                        </div>
                        <div className="mt-0.5 h-0.5 rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              workspaceCloudUsageRatio >= 0.95
                                ? 'bg-red-500/70'
                                : workspaceCloudUsageRatio >= 0.8
                                ? 'bg-amber-500/60'
                                : 'bg-gray-500/45'
                            }`}
                            style={{ width: `${Math.max(0, Math.min(100, workspaceCloudUsagePercent))}%` }}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setApiKeyModalOpen(true)}
                        className="inline-flex items-center gap-1.5 px-2 h-7 rounded-lg bg-[#1c1c22] border border-[#2e2e32] text-[8px] font-black uppercase hover:bg-[#2e2e36] hover:border-[#3b6fb8] whitespace-nowrap"
                        title={
                          aiInvocationReady
                            ? '当前调用源已就绪 · 点击配置 API 密钥'
                            : '当前供应商未配置 API Key（Gemini 也未配置批量代理）· 点击配置'
                        }
                        aria-label={
                          aiInvocationReady
                            ? 'API 密钥，当前调用源已就绪'
                            : 'API 密钥，当前调用源未就绪，请配置'
                        }
                      >
                        <span
                          role="status"
                          aria-hidden={true}
                          className={`h-2 w-2 shrink-0 rounded-full border border-[#3a3a40] ${
                            aiInvocationReady
                              ? 'bg-emerald-500 shadow-[0_0_10px_rgba(34,197,94,0.45)]'
                              : 'bg-[#b45309] shadow-[0_0_8px_rgba(217,119,6,0.35)]'
                          }`}
                        />
                        <span>API 密钥</span>
                      </button>
                    </div>
                  ) : null}
                </div>
                {workspaceCloudQuotaSuspended ? (
                  <div className="w-full max-w-6xl mx-auto mb-3 rounded-xl border border-amber-500/35 bg-[#2c2412] px-4 py-3 text-[11px] text-amber-100/95 leading-relaxed">
                    工作区<strong className="font-semibold">云空间已满</strong>：新图片无法上传，画布仍保存在本机。删除云端项目中的图或请管理员调高配额后可恢复。返回列表或切换项目时若无法上传，请留意本地数据。
                  </div>
                ) : null}
                <Suspense fallback={<LazySectionFallback label="工作区" />}>
                  <WorkflowSection
                    capabilityPresets={capabilityPresets}
                    capabilitySets={capabilitySets}
                    assets={workflowAssets}
                    onAssetsChange={setWorkflowAssets}
                    pending={workflowPending}
                    onPendingChange={setWorkflowPending}
                    onOpenLibraryPicker={(cb) => openPicker(undefined, cb, true)}
                    onLog={(level, message, detail) => addGlobalLog('工作区', level, message, detail)}
                    onAddGenerate3DJob={handleAddGenerate3DJobFromWorkflow}
                    preferenceScope={user?.id ?? null}
                    onboardingKey={`${user?.id ?? 'guest'}:${activeWorkspaceProjectId}`}
                    registerMarqueeStartHandler={registerWorkflowMarqueeStart}
                    registerPaneWheelHandler={registerWorkflowPaneWheel}
                    libraryItems={library}
                    onAddToLibrary={addToLibrary}
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
                          onRunTest={runCapabilityTest}
                          onLog={(level, message, detail) => addGlobalLog('能力', level, message, detail)}
                          embeddedInWorkflow={true}
                          canUploadToR2={user?.role === 'admin'}
                        />
                      </Suspense>
                    }
                  />
                </Suspense>
              </WorkflowErrorBoundary>
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
                  onRunTest={runCapabilityTest}
                  onLog={(level, message, detail) => addGlobalLog('能力', level, message, detail)}
                  canUploadToR2={user?.role === 'admin'}
                />
              </Suspense>
            )}

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

            {mode === AppMode.GENERATE_3D && (
              <div className="flex h-[calc(100dvh-6rem)] gap-4 lg:gap-6 animate-in fade-in overflow-hidden">
                <div className="w-80 lg:w-96 shrink-0 flex flex-col gap-4 overflow-y-auto no-scrollbar pr-2">
                <div className="px-2 py-1.5 rounded-xl bg-[#3a3018] border border-[#b45309] text-[9px] font-black uppercase text-amber-400">生成3D · 未上线</div>
                <div className="glass rounded-2xl p-4 lg:p-6 border border-[#2e2e32] bg-[#16161a]">
                  {!creds3D ? (
                    <div className="space-y-4 py-8">
                      <h3 className="text-[10px] font-black text-amber-400 uppercase">配置腾讯云凭证</h3>
                      <p className="text-[11px] text-gray-400">混元生3D 默认仅支持通过本地代理调用。请在项目根目录 <code className="bg-[#26262c] px-1 rounded">.env.local</code> 中配置 <code className="bg-[#26262c] px-1 rounded">TENCENT_SECRET_ID</code>、<code className="bg-[#26262c] px-1 rounded">TENCENT_SECRET_KEY</code>，启动 <code className="bg-[#26262c] px-1 rounded">npm run proxy</code>，并设置 <code className="bg-[#26262c] px-1 rounded">VITE_TENCENT_PROXY</code>。</p>
                      {unsafeTencentBrowserCredsEnabled ? (
                        <>
                          <div className="rounded-xl border border-[#b45309] bg-[#2c2412] px-3 py-2 text-[9px] text-amber-300">当前已显式开启不安全模式：浏览器可临时直持腾讯云密钥。仅建议本地排障使用，勿用于生产环境。</div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <input value={generate3DCredsOverride?.secretId ?? ''} onChange={e => setGenerate3DCredsOverride(p => ({ secretId: e.target.value.trim(), secretKey: p?.secretKey ?? '' }))} placeholder="SecretId" className="bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-4 py-3 text-[11px] outline-none focus:border-blue-500" />
                            <input type="password" value={generate3DCredsOverride?.secretKey ?? ''} onChange={e => setGenerate3DCredsOverride(p => ({ secretId: p?.secretId ?? '', secretKey: e.target.value }))} placeholder="SecretKey" className="bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-4 py-3 text-[11px] outline-none focus:border-blue-500" />
                          </div>
                        </>
                      ) : (
                        <div className="rounded-xl border border-[#2e2e32] bg-[#1c1c22] px-3 py-2 text-[9px] text-gray-400">
                          如确需在浏览器直接调试，可在本地临时设置 <code className="bg-[#26262c] px-1 rounded">VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS=true</code> 后刷新页面，再手动输入凭证。
                        </div>
                      )}
                      <p className="text-[9px] text-gray-500">密钥在 <a href="https://console.cloud.tencent.com/cam/capi" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">腾讯云 API 密钥</a> 创建；混元生3D 需开通 <a href="https://cloud.tencent.com/document/product/1804" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">产品页</a>。</p>
                    </div>
                  ) : (
                    <>
                      {/* 按已上线 API 分模块：8 个模块选择 */}
                      <div className="mb-4">
                        <div className="text-[9px] font-black text-gray-500 uppercase mb-2">选择能力</div>
                        <div className="space-y-1.5 max-h-48 overflow-y-auto no-scrollbar">
                          {GENERATE_3D_MODULES.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => setGenerate3DModule(m.id)}
                              className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors ${generate3DModule === m.id ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300' : 'bg-[#1c1c22] border-[#2e2e32] text-gray-400 hover:bg-[#2e2e36] hover:text-white'}`}
                            >
                              <div className="text-[10px] font-black">{m.name}</div>
                              <div className="text-[9px] text-gray-500 mt-0.5">{m.desc}</div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 当前模块表单 */}
                      <div className="glass rounded-2xl p-4 border border-[#2e2e32] bg-[#141416]">
                        {generate3DModule === 'pro' && (
                          <>
                            <p className="text-[9px] text-gray-500 mb-3">可选用 3.0/3.1，支持文生3D、图生3D（单图/多视图）、白模、草图、智能拓扑；3.1 支持八视图多角度输入。</p>
                            <div className="flex gap-2 mb-3">
                              <button onClick={() => setGenerate3DMode('text')} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${generate3DMode === 'text' ? 'bg-blue-600 border-blue-500' : 'bg-[#1c1c22] border-[#2e2e32] text-gray-500'}`}>文生3D</button>
                              <button onClick={() => setGenerate3DMode('image')} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${generate3DMode === 'image' ? 'bg-blue-600 border-blue-500' : 'bg-[#1c1c22] border-[#2e2e32] text-gray-500'}`}>图生3D</button>
                            </div>
                            {generate3DMode === 'text' ? (
                              <textarea value={generate3DPrompt} onChange={e => setGenerate3DPrompt(e.target.value)} placeholder="文本描述…" rows={2} className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none mb-3" />
                            ) : (
                              <>
                                <div className="flex gap-2 mb-3">
                                  <button onClick={() => { setGenerate3DImageMode('single'); setGenerate3DMultiViewImages({}); }} className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase border ${generate3DImageMode === 'single' ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300' : 'bg-[#1c1c22] border-[#2e2e32] text-gray-500'}`}>单图生成</button>
                                  <button onClick={() => { setGenerate3DImageMode('multi'); setGenerate3DImage(null); }} className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase border ${generate3DImageMode === 'multi' ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300' : 'bg-[#1c1c22] border-[#2e2e32] text-gray-500'}`}>多图生成</button>
                                </div>
                                {generate3DImageMode === 'single' ? (
                                  <div className="mb-3">
                                    {!generate3DImage ? (
                                      <label className="block h-20 border-2 border-dashed border-[#2e2e32] rounded-xl flex items-center justify-center cursor-pointer hover:bg-[#222228] text-[9px] text-gray-500">点击上传参考图<input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setGenerate3DImage(r.result as string); r.readAsDataURL(f); } }} /></label>
                                    ) : (
                                      <div className="relative inline-block"><img src={generate3DImage} alt="参考" className="max-h-20 rounded-xl border border-[#2e2e32]" /><button onClick={() => setGenerate3DImage(null)} className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded text-white text-xs">×</button></div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="mb-3 py-2 rounded-xl border border-[#2e2e32] bg-[#16161a]">
                                    <MultiViewUpload images={generate3DMultiViewImages} onChange={setGenerate3DMultiViewImages} minCount={2} maxViews={generate3DModel === '3.1' ? 8 : 6} />
                                  </div>
                                )}
                              </>
                            )}
                            <div className="grid grid-cols-2 gap-2 mb-3">
                              <div><label className="block text-[8px] text-gray-500 uppercase mb-1">版本</label><DropdownSelect compact options={[{ value: '3.0', label: '3.0' }, { value: '3.1', label: '3.1' }]} value={generate3DModel} onChange={v => setGenerate3DModel(v as '3.0' | '3.1')} /></div>
                              <div><label className="block text-[8px] text-gray-500 uppercase mb-1">类型</label><DropdownSelect compact options={[{ value: 'Normal', label: '带纹理' }, { value: 'LowPoly', label: '智能拓扑' }, { value: 'Geometry', label: '白模' }, { value: 'Sketch', label: '草图' }]} value={generate3DType} onChange={v => setGenerate3DType(v as typeof generate3DType)} /></div>
                              <div><label className="block text-[8px] text-gray-500 uppercase mb-1">面数</label><input type="number" min={3000} max={1500000} step={10000} value={generate3DFaceCount} onChange={e => setGenerate3DFaceCount(Number(e.target.value) || 100000)} className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-lg px-2 py-1.5 text-[10px] outline-none focus:border-blue-500" /></div>
                              {generate3DType === 'LowPoly' && <div><label className="block text-[8px] text-gray-500 uppercase mb-1">多边形</label><DropdownSelect compact options={[{ value: 'triangle', label: '三角' }, { value: 'quadrilateral', label: '四边' }]} value={generate3DPolygonType} onChange={v => setGenerate3DPolygonType(v as 'triangle' | 'quadrilateral')} /></div>}
                              <div><label className="block text-[8px] text-gray-500 uppercase mb-1">格式</label><DropdownSelect compact options={[{ value: '', label: 'OBJ+GLB' }, { value: 'FBX', label: 'FBX' }, { value: 'STL', label: 'STL' }, { value: 'USDZ', label: 'USDZ' }]} value={generate3DResultFormat} onChange={v => setGenerate3DResultFormat(v as '' | 'FBX' | 'STL' | 'USDZ')} /></div>
                              <div className="flex items-end"><label className="flex items-center gap-1.5 cursor-pointer text-[10px]"><input type="checkbox" checked={generate3DEnablePBR} onChange={e => setGenerate3DEnablePBR(e.target.checked)} className="rounded" />PBR</label></div>
                            </div>
                            <button
                              onClick={handleGenerate3D}
                              disabled={!creds3D || (generate3DMode === 'text' ? !generate3DPrompt.trim() : generate3DImageMode === 'single' ? !generate3DImage : PRO_VIEW_IDS.filter(id => generate3DMultiViewImages[id]).length < 2)}
                              className="w-full py-2.5 bg-blue-600 rounded-xl text-[10px] font-black uppercase electric-glow disabled:opacity-40"
                            >
                              提交生成（入队）
                            </button>
                          </>
                        )}
                        {generate3DModule === 'rapid' && (
                          <>
                            <p className="text-[9px] text-gray-500 mb-3">极速版模型，约 1 分 30 秒内生成 3D 文件。</p>
                            <textarea value={rapidPrompt} onChange={e => setRapidPrompt(e.target.value)} placeholder="文本描述（与下图二选一）" rows={2} className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none mb-3" />
                            <div className="flex gap-2 mb-3">
                              {!rapidImage ? <label className="flex-1 h-14 border border-dashed border-[#2e2e32] rounded-xl flex items-center justify-center cursor-pointer text-[9px] text-gray-500">上传图片<input type="file" className="hidden" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setRapidImage(r.result as string); r.readAsDataURL(f); } }} /></label> : <div className="relative flex-1"><img src={rapidImage} alt="" className="h-14 w-full object-cover rounded-xl border border-[#2e2e32]" /><button type="button" onClick={() => setRapidImage(null)} className="absolute top-0 right-0 w-5 h-5 bg-red-500 rounded text-white text-xs">×</button></div>}
                              <div className="w-24 shrink-0"><DropdownSelect compact options={[{ value: 'FBX', label: 'FBX' }, { value: 'OBJ', label: 'OBJ' }, { value: 'GLB', label: 'GLB' }, { value: 'STL', label: 'STL' }, { value: 'USDZ', label: 'USDZ' }, { value: 'MP4', label: 'MP4' }]} value={rapidResultFormat} onChange={setRapidResultFormat} /></div>
                            </div>
                            <label className="flex items-center gap-2 text-[10px] mb-3"><input type="checkbox" checked={rapidEnablePBR} onChange={e => setRapidEnablePBR(e.target.checked)} className="rounded" />PBR</label>
                            <button onClick={handleRapid3D} disabled={!rapidPrompt.trim() && !rapidImage} className="w-full py-2.5 bg-indigo-600 rounded-xl text-[10px] font-black uppercase disabled:opacity-40">提交（入队）</button>
                          </>
                        )}
                        {generate3DModule === 'topology' && (
                          <>
                            <p className="text-[9px] text-gray-500 mb-3">Polygon 1.5：输入 3D 高模 URL，生成布线规整、较低面数模型。</p>
                            <input value={topologyFileUrl} onChange={e => setTopologyFileUrl(e.target.value)} placeholder="3D 高模文件 URL（如 GLB/FBX）" className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 mb-3" />
                            <button onClick={handleTopology3D} disabled={!topologyFileUrl.trim()} className="w-full py-2.5 bg-indigo-600 rounded-xl text-[10px] font-black uppercase disabled:opacity-40">提交（入队）</button>
                          </>
                        )}
                        {generate3DModule === 'texture' && (
                          <>
                            <p className="text-[9px] text-gray-500 mb-3">输入单几何模型 URL（必填）+ 参考图或文字描述二选一，生成纹理贴图。</p>
                            <input value={textureModelUrl} onChange={e => setTextureModelUrl(e.target.value)} placeholder="单几何模型 URL（必填）" className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 mb-2" />
                            <textarea value={texturePrompt} onChange={e => setTexturePrompt(e.target.value)} placeholder="文字描述（与参考图二选一）" rows={1} className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none mb-2" />
                            <div className="mb-3">{!textureRefImage ? <label className="block h-14 border border-dashed border-[#2e2e32] rounded-xl flex items-center justify-center cursor-pointer text-[9px] text-gray-500">上传参考图（与描述二选一）<input type="file" className="hidden" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setTextureRefImage(r.result as string); r.readAsDataURL(f); } }} /></label> : <div className="relative inline-block"><img src={textureRefImage} alt="" className="max-h-14 rounded-xl border border-[#2e2e32]" /><button onClick={() => setTextureRefImage(null)} className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded text-white text-xs">×</button></div>}</div>
                            <button onClick={handleTexture3D} disabled={!textureModelUrl.trim() || (!texturePrompt.trim() && !textureRefImage)} className="w-full py-2.5 bg-indigo-600 rounded-xl text-[10px] font-black uppercase disabled:opacity-40">提交（入队）</button>
                          </>
                        )}
                        {generate3DModule === 'component' && (
                          <>
                            <p className="text-[9px] text-gray-500 mb-3">输入 3D 模型，自动识别结构并生成对应 3D 组件。</p>
                            <input value={componentFileUrl} onChange={e => setComponentFileUrl(e.target.value)} placeholder="3D 模型 URL（建议 FBX，≤100MB）" className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 mb-3" />
                            <button onClick={handleComponent3D} disabled={!componentFileUrl.trim()} className="w-full py-2.5 bg-indigo-600 rounded-xl text-[10px] font-black uppercase disabled:opacity-40">提交（入队）</button>
                          </>
                        )}
                        {generate3DModule === 'uv' && (
                          <>
                            <p className="text-[9px] text-gray-500 mb-3">输入 3D 模型，自动生成高质量 UV 切线。</p>
                            <input value={uvFileUrl} onChange={e => setUvFileUrl(e.target.value)} placeholder="3D 模型 URL" className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 mb-3" />
                            <button onClick={handleUV3D} disabled={!uvFileUrl.trim()} className="w-full py-2.5 bg-indigo-600 rounded-xl text-[10px] font-black uppercase disabled:opacity-40">提交（入队）</button>
                          </>
                        )}
                        {generate3DModule === 'profile' && (
                          <>
                            <p className="text-[9px] text-gray-500 mb-3">输入人物头像，按模板生成对应 3D 形象。</p>
                            {!profileImage ? (
                              <label className="block h-24 border-2 border-dashed border-[#2e2e32] rounded-xl flex items-center justify-center cursor-pointer hover:bg-[#222228] text-[9px] text-gray-500 mb-3">点击上传人物头像<input type="file" className="hidden" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setProfileImage(r.result as string); r.readAsDataURL(f); } }} /></label>
                            ) : (
                              <div className="relative inline-block mb-3"><img src={profileImage} alt="头像" className="max-h-24 rounded-xl border border-[#2e2e32]" /><button onClick={() => setProfileImage(null)} className="absolute top-1 right-1 w-6 h-6 bg-red-500 rounded text-white text-xs">×</button></div>
                            )}
                            <button onClick={handleProfile3D} disabled={!profileImage} className="w-full py-2.5 bg-indigo-600 rounded-xl text-[10px] font-black uppercase disabled:opacity-40">提交（入队）</button>
                          </>
                        )}
                        {generate3DModule === 'convert' && (
                          <>
                            <p className="text-[9px] text-gray-500 mb-3">输入 3D 模型 URL，转换为目标格式。</p>
                            <input value={convertFileUrl} onChange={e => setConvertFileUrl(e.target.value)} placeholder="3D 文件 URL（fbx/obj/glb 等）" className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 mb-2" />
                            <div className="mb-3"><DropdownSelect compact options={[{ value: 'STL', label: 'STL' }, { value: 'USDZ', label: 'USDZ' }, { value: 'FBX', label: 'FBX' }, { value: 'MP4', label: 'MP4' }, { value: 'GIF', label: 'GIF' }]} value={convertFormat} onChange={setConvertFormat} /></div>
                            <button onClick={handleConvert3D} disabled={!convertFileUrl.trim()} className="w-full py-2.5 bg-indigo-600 rounded-xl text-[10px] font-black uppercase disabled:opacity-40">转换（入队）</button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>

                </div>

                {/* 中间：3D 预览常驻 */}
                <div className="flex-1 min-w-0 flex flex-col rounded-2xl border border-[#2e2e32] bg-[#1a1a1e] overflow-hidden">
                  <div className="px-3 py-2 text-[9px] font-black uppercase text-gray-500 border-b border-[#2e2e32]">3D 预览 · 支持 OBJ/GLB，生成后自动显示，可点击右侧临时库切换</div>
                  <div className="flex-1 min-h-[280px] relative">
                    {generate3DPreview ? (
                    <Suspense fallback={<LazySectionFallback label="3D预览" />}>
                      <UnifiedModelViewer3D url={generate3DPreview.url} format={generate3DPreview.format} />
                    </Suspense>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-[11px]">暂无预览，生成后将自动显示；或从右侧临时库选择</div>
                    )}
                  </div>
                </div>

                {/* 右侧：临时库 */}
                <div className="w-64 lg:w-72 shrink-0 flex flex-col rounded-2xl border border-[#2e2e32] bg-[#16161a] overflow-hidden">
                  <div className="px-3 py-2 border-b border-[#2e2e32] flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase text-blue-400">临时库</span>
                    <span className="text-[9px] text-gray-500">队列 {generate3DQueue.length}（{generate3DQueue.filter(q => q.status === 'running').length} 运行中）</span>
                  </div>
                  <div className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-2">
                    {generate3DQueue.length > 0 && (
                      <div className="rounded-xl border border-[#2e2e32] bg-[#1c1c22] p-2 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[8px] font-black uppercase text-gray-400">任务队列</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[8px] text-gray-500">{generate3DQueue.filter(q => q.status === 'pending' || q.status === 'running').length} 活跃</span>
                            {generate3DQueue.some(q => q.status !== 'pending' && q.status !== 'running') && (
                              <button
                                onClick={clearInactiveQueueItems}
                                className="px-1.5 py-1 rounded-md border border-[#2e2e32] text-[8px] font-black uppercase text-gray-400 hover:bg-[#2e2e36]"
                              >
                                清理
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          {[...generate3DQueue].reverse().slice(0, 8).map((item) => {
                            const statusText = item.status === 'pending'
                              ? '等待中'
                              : item.status === 'running'
                                ? '运行中'
                                : item.status === 'done'
                                  ? '已完成'
                                  : item.status === 'cancelled'
                                    ? '已取消'
                                    : '失败';
                            const statusClass = item.status === 'running'
                              ? 'bg-[#1e3a5f] text-blue-300 border-[#4b6a9e]'
                              : item.status === 'pending'
                                ? 'bg-[#3a3018] text-amber-300 border-[#b45309]'
                                : item.status === 'done'
                                  ? 'bg-[#0f3320] text-emerald-300 border-[#34d399]'
                                  : item.status === 'cancelled'
                                    ? 'bg-[#3a3a40] text-gray-300 border-gray-500/30'
                                    : 'bg-[#4a2228] text-red-300 border-[#dc6b6b]';
                            return (
                              <div key={item.id} className="rounded-xl border border-[#2e2e32] bg-[#141416] p-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-[10px] font-black truncate">{item.label || item.type}</div>
                                    <div className="text-[8px] text-gray-500 uppercase mt-1">{item.type}</div>
                                  </div>
                                  <span className={`shrink-0 px-1.5 py-0.5 rounded-md border text-[8px] font-black uppercase ${statusClass}`}>{statusText}</span>
                                </div>
                                {typeof item.progress === 'number' && item.status === 'running' && (
                                  <div className="mt-2">
                                    <div className="h-1.5 rounded-full bg-[#26262c] overflow-hidden">
                                      <div className="h-full bg-blue-500" style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} />
                                    </div>
                                  </div>
                                )}
                                {item.error && (
                                  <div className="mt-2 text-[8px] text-gray-400 line-clamp-2">{item.error}</div>
                                )}
                                <div className="mt-2 flex gap-2">
                                  {(item.status === 'pending' || item.status === 'running') && (
                                    <button
                                      onClick={() => cancelQueueItem(item.id)}
                                      className="flex-1 py-1.5 rounded-lg border border-[#dc6b6b] bg-[#3a1818] text-[9px] font-black uppercase text-red-300 hover:bg-[#4a2228]"
                                    >
                                      取消任务
                                    </button>
                                  )}
                                  {(item.status === 'fail' || item.status === 'cancelled') && (
                                    <button
                                      onClick={() => retryQueueItem(item.id)}
                                      className="flex-1 py-1.5 rounded-lg border border-[#4b6a9e] bg-[#1a3354] text-[9px] font-black uppercase text-blue-300 hover:bg-[#1e3a5f]"
                                    >
                                      重试
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {temp3DLibrary.length === 0 ? (
                      <div className="text-[10px] text-gray-500 py-6 text-center">生成的 3D 资产会出现在这里<br />点击项切换预览，可保存到资产库</div>
                    ) : (
                      temp3DLibrary.map((item) => (
                        <div
                          key={item.id}
                          onClick={() => setSelectedTemp3DId(item.id)}
                          className={`rounded-xl border overflow-hidden cursor-pointer transition-colors ${selectedTemp3DId === item.id ? 'border-blue-500 bg-[#1a3354]' : 'border-[#2e2e32] bg-[#1c1c22] hover:bg-[#2e2e36]'}`}
                        >
                          <div className="aspect-square relative">
                            {item.previewImageUrl ? <img src={item.previewImageUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-600 text-[10px]">无预览图</div>}
                            <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-[#0d0d10] text-gray-300">{item.source}</span>
                          </div>
                          <div className="p-2">
                            <div className="text-[10px] font-black truncate">{item.label}</div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.files.map((f, i) => f.Url && <a key={i} href={f.Url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[8px] text-blue-400 hover:underline">{f.Type || '下载'}</a>)}
                            </div>
                            <button onClick={e => { e.stopPropagation(); handleSave3DToLibrary(item); }} className="mt-2 w-full py-1.5 rounded-lg bg-[#1e40af] text-[9px] font-black uppercase hover:bg-blue-600">保存到资产库</button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {mode === AppMode.DIALOG && (
              <div className="contents">
              <div className="flex h-[calc(100dvh-6rem)] animate-in fade-in gap-4 lg:gap-6">
                {/* 左侧：竖向会话列表（可滚动） */}
                <div className="w-56 lg:w-64 shrink-0 flex flex-col gap-3">
                  <div className="flex items-center justify-between px-2">
                    <div className="text-[9px] font-black text-gray-500 uppercase tracking-widest">会话</div>
                    <button
                      onClick={createNewDialogSession}
                      className="w-9 h-9 shrink-0 rounded-xl bg-[#26262c] border border-[#2e2e32] flex items-center justify-center text-lg font-bold text-white/80 hover:bg-[#383842] transition-colors"
                      title="新对话"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto no-scrollbar space-y-2 pr-1">
                    {(() => {
                      const RECENT_MS = 24 * 60 * 60 * 1000;
                      const now = Date.now();
                      const byLatestUpdated = (a: DialogSession, b: DialogSession) => b.updatedAt - a.updatedAt;
                      const recent = dialogSessions
                        .filter(s => !s.archived && (now - s.updatedAt) < RECENT_MS)
                        .sort(byLatestUpdated);
                      const older = dialogSessions
                        .filter(s => !s.archived && (now - s.updatedAt) >= RECENT_MS)
                        .sort(byLatestUpdated);
                      const archived = dialogSessions
                        .filter(s => s.archived)
                        .sort(byLatestUpdated);
                      const renderSession = (s: DialogSession, showArchive: boolean) => {
                        const lastImg = [...s.messages].reverse().find((m) => {
                          if (m.role !== 'assistant') return false;
                          const last = dialogVersionsForMessage(m).at(-1);
                          return !!(last && dialogVersionHasRenderableImage(last));
                        });
                        const lastVer = lastImg ? dialogVersionsForMessage(lastImg).at(-1) : undefined;
                        const thumb = lastVer ? getDialogVersionImageDataUrl(lastVer) : undefined;
                        const thumbPending = !!(lastVer && dialogVersionHasRenderableImage(lastVer) && !thumb);
                        const isActive = s.id === dialogActiveSessionIdResolved;
                        const label = s.title || (s.messages.length === 0 ? '新对话' : `对话${s.messages.length}`);
                        return (
                          <div key={s.id} className="relative group">
                            <button
                              onClick={() => setDialogActiveSessionId(s.id)}
                              className={`w-full flex items-center gap-3 px-3 py-2 rounded-2xl border transition-all pr-16 ${isActive ? 'bg-[#1a2d4d] border-[#3b6fb8]' : 'bg-[#1c1c22] border-[#2e2e32] hover:bg-[#2e2e36] hover:border-[#3a3a40]'}`}
                              title={label}
                            >
                              <div className="w-11 h-11 shrink-0 rounded-xl overflow-hidden border border-[#2e2e32] bg-[#1c1c22] flex items-center justify-center">
                                {thumb ? <img src={thumb} className="w-full h-full object-cover" alt="" /> : thumbPending ? <span className="text-[8px] text-gray-500">加载</span> : <span className="text-[10px] text-gray-500">新</span>}
                              </div>
                              <div className="min-w-0 flex-1 text-left">
                                <div className="text-[10px] font-black text-white/85 truncate">{label}</div>
                                <div className="text-[9px] text-gray-500 truncate">
                                  {s.messages.length} 条 · {new Date(s.updatedAt).toLocaleString()}
                                </div>
                              </div>
                            </button>
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
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

                {/* 右侧：对话内容 */}
                <div className="flex-1 flex flex-col min-w-0">
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
                        <div className={`max-w-[85%] lg:max-w-[75%] rounded-2xl overflow-hidden ${msg.role === 'user' ? 'bg-[#1e3558] border border-[#4b6a9e]' : 'bg-[#1c1c22] border border-[#2e2e32]'}`}>
                          {msg.role === 'user' && (msg.inputImages?.length || msg.imageBase64) && (
                            <div className="p-2 border-b border-[#2e2e32]">
                              <div className={`grid gap-2 ${msg.inputImages && msg.inputImages.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                {(msg.inputImages && msg.inputImages.length > 0 ? msg.inputImages : msg.imageBase64 ? [msg.imageBase64] : []).map((image, imageIndex) => (
                                  <img key={`${msg.id}-${imageIndex}`} src={image} className="max-h-48 rounded-xl object-contain mx-auto" alt="上传" />
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="px-4 py-3 text-[11px] leading-relaxed">{msg.text}</div>
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
                                  <div className="flex items-center justify-center min-h-[140px] rounded-xl border border-[#2e2e32] bg-[#141416] text-[9px] text-gray-500">图片加载中…</div>
                                ) : dialogDetectMessageId === msg.id && (displayVersion.detectedBoxes?.length ?? 0) > 0 && displaySrc ? (
                                  <div className="relative inline-block max-w-full">
                                    <img src={displaySrc} className="max-w-full rounded-xl border border-[#2e2e32]" alt="生成" />
                                    <div className="absolute inset-0 pointer-events-none">
                                      {(displayVersion.detectedBoxes ?? []).map((box, i) => (
                                        <div key={box.id} className="absolute border-2 border-blue-500 bg-[#1e40af]" style={{ left: `${box.xmin / 10}%`, top: `${box.ymin / 10}%`, width: `${(box.xmax - box.xmin) / 10}%`, height: `${(box.ymax - box.ymin) / 10}%` }}>
                                          <span className="absolute -top-7 left-0 min-w-[24px] h-6 px-1.5 rounded flex items-center justify-center text-xs font-black bg-blue-600 text-white shadow-lg">{DIALOG_BOX_LABELS[i] ?? i + 1}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : displaySrc ? (
                                  <img src={displaySrc} className="max-w-full rounded-xl border border-[#2e2e32]" alt="生成" />
                                ) : null}
                              </div>
                              {dialogDetectMessageId === msg.id && (displayVersion.detectedBoxes?.length ?? 0) > 0 && (
                                <div className="px-4 pb-3 space-y-2 border-b border-[#2e2e32]">
                                  <div className="text-[9px] font-black text-blue-400 uppercase">点击数字下载该物体（带边距）· 可添加到右侧临时库</div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {(displayVersion.detectedBoxes ?? []).map((_, i) => (
                                      <button key={i} onClick={() => handleDialogDownloadCropByIndex(msg, i)} className="w-9 h-9 rounded-xl bg-[#264670] border border-[#3b82f6] text-sm font-black hover:bg-[#365e92] transition-all flex items-center justify-center" title={`下载 ${DIALOG_BOX_LABELS[i] ?? i + 1}`}>{DIALOG_BOX_LABELS[i] ?? i + 1}</button>
                                    ))}
                                    <button onClick={() => handleDialogDownloadAllCrops(msg)} className="px-3 py-2 bg-blue-600 rounded-xl text-[9px] font-black uppercase text-white hover:bg-blue-500 transition-all">下载全部</button>
                                    <button onClick={() => handleDialogTempAddAllCrops(msg)} className="px-3 py-2 bg-[#26262c] border border-[#2e2e32] rounded-xl text-[9px] font-black uppercase hover:bg-[#383842] transition-all">全部加临时库</button>
                                    <button onClick={() => handleDialogDetectObjects(msg, true)} disabled={dialogDetectingId === msg.id} className="px-3 py-2 bg-[#26262c] border border-[#2e2e32] rounded-xl text-[9px] font-black uppercase hover:bg-[#383842] transition-all disabled:opacity-50">重新识别</button>
                                    <button onClick={handleDialogDetectClose} className="px-3 py-2 text-gray-500 text-[9px] font-black uppercase hover:text-white transition-colors">收起</button>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {(displayVersion.detectedBoxes ?? []).map((_, i) => (
                                      <button key={i} onClick={() => handleDialogTempAddCropByIndex(msg, i)} className="px-2 py-1 rounded-lg bg-[#1c1c22] border border-[#2e2e32] text-[9px] font-black hover:bg-[#2e2e36] transition-all" title={`${DIALOG_BOX_LABELS[i] ?? i + 1} 加到临时库`}>+{DIALOG_BOX_LABELS[i] ?? i + 1}</button>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div className="px-4 pb-4 flex flex-wrap gap-2">
                                <button onClick={() => handleDialogDownload(msg)} className="px-3 py-2 bg-[#1e3558] border border-[#4b6a9e] rounded-xl text-[9px] font-black uppercase text-blue-400 hover:bg-[#305a90] transition-all">下载图片</button>
                                <button onClick={() => displaySrc && handleCopyDialogImage(displaySrc)} disabled={!displaySrc} className="px-3 py-2 bg-[#26262c] border border-[#2e2e32] rounded-xl text-[9px] font-black uppercase hover:bg-[#383842] transition-all disabled:opacity-40">复制图片</button>
                                <button onClick={() => displaySrc && openDialogCrop(msg.id, displaySrc)} disabled={!displaySrc} className="px-3 py-2 bg-[#26262c] border border-[#2e2e32] rounded-xl text-[9px] font-black uppercase hover:bg-[#383842] transition-all disabled:opacity-40">裁切</button>
                                <button onClick={() => handleDialogUseAsInput(msg)} className="px-3 py-2 bg-[#14532d] border border-green-500/30 rounded-xl text-[9px] font-black uppercase text-green-400 hover:bg-[#166534] transition-all">以此图继续</button>
                                <button onClick={() => handleDialogDetectObjects(msg)} disabled={dialogDetectingId === msg.id} className="px-3 py-2 bg-[#1c1c22] border border-[#2e2e32] rounded-xl text-[9px] font-black uppercase hover:bg-[#2e2e36] transition-all disabled:opacity-50">{dialogDetectingId === msg.id ? '识别中...' : '识别图中物体'}</button>
                                <button onClick={() => handleDialogSaveToLibrary(msg)} className="px-3 py-2 bg-[#1e3558] border border-[#4b6a9e] rounded-xl text-[9px] font-black uppercase text-blue-400 hover:bg-[#305a90] transition-all">保存到库</button>
                                <button onClick={() => handleDialogRegenerate(msg.id)} disabled={isRegeneratingThis || !userMsg} className="px-3 py-2 bg-[#1c1c22] border border-[#2e2e32] rounded-xl text-[9px] font-black uppercase hover:bg-[#2e2e36] transition-all disabled:opacity-50">直接重新生成</button>
                                <button onClick={() => { setDialogEditingMessageId(msg.id); setDialogEditingText(userMsg?.role === 'user' ? userMsg.text : ''); }} disabled={isRegeneratingThis} className="px-3 py-2 bg-[#1c1c22] border border-[#2e2e32] rounded-xl text-[9px] font-black uppercase hover:bg-[#2e2e36] transition-all disabled:opacity-50">编辑后重新生成</button>
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
                            <div className="p-4 border-t border-[#2e2e32] space-y-3">
                              <input value={dialogEditingText} onChange={e => setDialogEditingText(e.target.value)} placeholder="修改你的需求描述..." className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-4 py-3 text-[11px] outline-none focus:border-blue-500" />
                              <div className="flex gap-2">
                                <button onClick={() => handleDialogEditThenRegenerate(msg.id, dialogEditingText)} disabled={!dialogEditingText.trim()} className="px-4 py-2 bg-blue-600 rounded-xl text-[9px] font-black uppercase disabled:opacity-50">确认重新生成</button>
                                <button onClick={() => setDialogEditingMessageId(null)} className="px-4 py-2 bg-[#1c1c22] border border-[#2e2e32] rounded-xl text-[9px] font-black uppercase">取消</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {dialogSendingSessionIds.includes(dialogActiveSessionIdResolved) && (
                    <div className="flex justify-start items-center gap-2">
                      <div className="px-4 py-3 rounded-2xl bg-[#1c1c22] border border-[#2e2e32] text-[10px] text-gray-400 flex items-center gap-2">
                        <div className="w-3 h-3 border-2 border-[#4b6a9e] border-t-blue-500 rounded-full animate-spin" />
                        {dialogAutoGenerateImage
                          ? dialogSkipUnderstand
                            ? '跳过理解 → 生图中...'
                            : '理解需求 → 生图中...'
                          : dialogSkipUnderstand
                            ? '处理中...'
                            : '理解需求中...'}
                      </div>
                      <button onClick={handleDialogCancelGen} className="px-3 py-2 rounded-xl bg-[#5c1a1a] border border-[#f87171] text-[9px] font-black text-red-400 hover:bg-[#991b1b] transition-colors">停止</button>
                    </div>
                  )}
                  <div ref={dialogEndRef} />
                  </div>
                  {/* 输入区：支持粘贴图片；档位 + 比例/尺寸 + 文案 + 发送（模型由档位决定） */}
                  <div className="glass rounded-[2rem] p-4 lg:p-6 border border-[#252528] shrink-0 space-y-4" onPaste={handleDialogPaste}>
                  <div className="flex flex-wrap items-center gap-2 lg:gap-3">
                    <span className="text-[9px] font-black text-gray-500 uppercase">开启生图</span>
                    <button type="button" role="switch" aria-checked={dialogAutoGenerateImage} onClick={() => setDialogAutoGenerateImage(p => !p)} className={`relative w-11 h-6 rounded-full transition-colors ${dialogAutoGenerateImage ? 'bg-blue-600' : 'bg-[#26262c]'}`}>
                      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${dialogAutoGenerateImage ? 'left-6' : 'left-1'}`} />
                    </button>
                    {dialogAutoGenerateImage ? (
                      <>
                        <span className="text-[9px] font-black text-gray-500 uppercase">关闭理解</span>
                        <button type="button" role="switch" aria-checked={dialogSkipUnderstand} onClick={() => setDialogSkipUnderstandState(p => !p)} className={`relative w-11 h-6 rounded-full transition-colors ${dialogSkipUnderstand ? 'bg-blue-600' : 'bg-[#26262c]'}`}>
                          <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${dialogSkipUnderstand ? 'left-6' : 'left-1'}`} />
                        </button>
                        <span className="text-[9px] font-black text-gray-500 uppercase">挡位</span>
                        <div className="flex rounded-lg overflow-hidden border border-[#2e2e32]">
                          {DIALOG_IMAGE_GEARS.map(g => (
                            <button key={g.id} type="button" onClick={() => { setDialogImageGear(g.id); setDialogModel(g.modelId); }} className={`px-3 py-2 text-[9px] font-black uppercase transition-colors ${dialogImageGear === g.id ? 'bg-blue-600 text-white' : 'bg-[#1c1c22] text-gray-500 hover:bg-[#2e2e36]'}`} title={g.modelId}>{g.label}</button>
                          ))}
                        </div>
                        <span className="text-[9px] font-black text-gray-500 uppercase">比例</span>
                        <CustomDropdown
                          options={DIALOG_ASPECT_RATIO_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
                          value={dialogAspectRatio}
                          onChange={setDialogAspectRatio}
                          triggerClassName={`${DROPDOWN_TRIGGER_COMPACT} min-w-[5.5rem]`}
                        />
                        <span className="text-[9px] font-black text-gray-500 uppercase">尺寸</span>
                        <CustomDropdown
                          options={SUPPORTED_IMAGE_SIZES.map((s) => ({ value: s.value, label: s.label }))}
                          value={dialogImageSize}
                          onChange={setDialogImageSize}
                          triggerClassName={`${DROPDOWN_TRIGGER_COMPACT} min-w-[4rem]`}
                        />
                      </>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2">
                    {dialogInputImages.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        {dialogInputImages.map((img, i) => (
                          <div key={img.id} className="relative inline-flex items-center gap-1 rounded-lg border border-[#2e2e32] bg-[#1c1c22] overflow-hidden">
                            <span className="pl-2 text-[8px] font-black text-gray-500">图{i + 1}</span>
                            <img src={img.data} className="h-12 w-12 object-cover" alt={`图${i + 1}`} />
                            <button type="button" onClick={() => setDialogInputImages(prev => prev.filter(x => x.id !== img.id))} className="p-1 text-red-400 hover:bg-[#4a1c1c] rounded text-[10px] leading-none">×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <span className="text-[9px] text-gray-500">
                      {dialogAutoGenerateImage
                        ? `可添加多张图片（最多 ${DIALOG_INPUT_IMAGES_MAX} 张），输入 @ 弹出选择图片；点击临时库图片直接加入输入框 · Ctrl+V 粘贴 · 无图时直接输入即文字对话 · Enter 发送，Shift+Enter 换行`
                        : `可添加多张图片（最多 ${DIALOG_INPUT_IMAGES_MAX} 张）做图文问答，输入 @ 选择图片；点击临时库图片加入输入框 · Ctrl+V 粘贴 · 当前已关闭生图，仅文字/图文回复 · Enter 发送，Shift+Enter 换行`}
                    </span>
                  </div>
                  {dialogValidationError && (
                    <div className="text-[11px] text-amber-400 bg-[#2c2412] border border-[#b45309] rounded-xl px-4 py-2 flex items-center gap-2">
                      <AppIcon name="warning" className="shrink-0 w-3.5 h-3.5" />
                      <span>{dialogValidationError}</span>
                      <button type="button" onClick={() => setDialogValidationError(null)} className="ml-auto shrink-0 text-amber-400/80 hover:text-amber-300">×</button>
                    </div>
                  )}
                  <div ref={dialogInputWrapperRef} className="flex gap-3 relative items-end">
                    <div className="flex-1 relative">
                      <label
                        className="absolute left-2 top-3 z-[1] flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[#2e2e32] bg-[#1c1c22] text-gray-400 hover:bg-[#2e2e36] hover:text-gray-200 transition-colors"
                        title="上传图片"
                        aria-label="上传图片"
                      >
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
                            ? '输入 @ 选择图片或直接输入文字；有图时描述修改需求，无图时可描述画面生成图片或与 AI 文字对话'
                            : '输入 @ 选择图片或直接输入文字；可与 AI 对话或上传图片做图文问答（不生图）'
                        }
                        className="w-full min-h-[44px] max-h-[min(40vh,280px)] resize-none overflow-y-auto bg-[#1c1c22] border border-[#2e2e32] rounded-xl pl-12 pr-5 py-3 text-[11px] leading-relaxed outline-none focus:border-blue-500 transition-colors placeholder:text-gray-600"
                      />
                      {atSuggestionsOpen && (dialogInputImages.length > 0 || dialogTempFiltered.length > 0) && (
                        <div className="absolute left-0 right-0 top-full mt-1 z-[1003] rounded-xl border border-[#2e2e32] bg-[#0f0f0f] shadow-xl py-1 max-h-48 overflow-y-auto">
                          {dialogInputImages.length > 0 && (
                            <div className="px-2 py-1 text-[8px] font-black text-gray-500 uppercase">输入框图片</div>
                          )}
                          {dialogInputImages.map((img, i) => {
                            const imageNumber = i + 1;
                            return (
                            <button key={img.id} type="button" onClick={() => { const newText = dialogInputText.slice(0, atSuggestionsCursor) + `@图${imageNumber} ` + dialogInputText.slice(atSuggestionsCursor + 1); setDialogInputText(newText); setAtSuggestionsOpen(false); dialogInputRef.current?.focus(); }} className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-[#2e2e36] rounded-lg">
                              <img src={img.data} className="w-8 h-8 rounded object-cover shrink-0" alt="" />
                              <span>图{imageNumber}</span>
                            </button>
                            );
                          })}
                          {dialogTempFiltered.length > 0 && (
                            <div className="px-2 py-1 text-[8px] font-black text-gray-500 uppercase mt-1 border-t border-[#252528]">临时库（点击加入输入框并插入 @）</div>
                          )}
                          {dialogTempFiltered.map((item, i) => (
                            <button key={item.id} type="button" onClick={() => { handleDialogTempAddToInput(item); const newIdx = dialogInputImages.length + 1; const newText = dialogInputText.slice(0, atSuggestionsCursor) + `@图${newIdx} ` + dialogInputText.slice(atSuggestionsCursor + 1); setDialogInputText(newText); setAtSuggestionsOpen(false); dialogInputRef.current?.focus(); }} className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-[#2e2e36] rounded-lg">
                              <img src={item.data} className="w-8 h-8 rounded object-cover shrink-0" alt="" />
                              <span className="truncate">{item.label || `临时库 ${i + 1}`}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={handleDialogSend} disabled={dialogSendingSessionIds.includes(dialogActiveSessionIdResolved) || !dialogInputText.trim()} className="px-8 py-3 bg-blue-600 rounded-xl text-[10px] font-black uppercase electric-glow disabled:opacity-20 transition-all shrink-0">发送</button>
                  </div>
                </div>
                </div>

                {/* 右侧：临时库（生图与识别物体自动加入，可筛全部/当前对话，删会话会同步清理） */}
                <div
                  className="w-52 lg:w-64 shrink-0 flex flex-col border border-[#2e2e32] rounded-2xl overflow-hidden bg-[#121214] h-[calc(100dvh-6rem)]"
                  onPaste={handleDialogTempLibraryPaste}
                  onDragOver={handleDialogTempLibraryDragOver}
                  onDrop={handleDialogTempLibraryDrop}
                >
                  <div className="flex-shrink-0 px-3 py-2 border-b border-[#2e2e32] flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">临时库</span>
                    <div className="flex rounded-lg overflow-hidden border border-[#2e2e32]">
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
                            onClick={() => setDialogTempPreviewId(item.id)}
                            className={`relative group rounded-xl overflow-hidden border bg-[#1c1c22] aspect-square cursor-pointer ${
                              dialogTempSelectedIds.has(item.id)
                                ? 'border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.45)]'
                                : 'border-[#2e2e32]'
                            }`}
                          >
                            <img
                              src={item.data}
                              className="w-full h-full object-cover cursor-pointer"
                              alt=""
                              onClick={(e) => {
                                e.stopPropagation();
                                setDialogTempPreviewId(item.id);
                              }}
                              title="点击查看大图"
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
              {dialogTempPreviewId && (() => {
                const item = dialogTempLibrary.find(x => x.id === dialogTempPreviewId);
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
                      setDialogTempPreviewId(null);
                    }}
                    onClick={() => setDialogTempPreviewId(null)}
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

                      <div className="absolute top-4 left-4 z-10 max-w-[min(280px,calc(100vw-6rem))] rounded-xl bg-[#101018]/90 border border-[#2e2e32] px-3 py-2 text-[9px] text-gray-300 pointer-events-none text-left leading-relaxed space-y-1">
                        <div>滚轮：上一张 / 下一张</div>
                        <div>Esc：关闭预览</div>
                        <div>双击：复原缩放与位置</div>
                        <div>左键：缩放</div>
                        <div>空格+左键 / Shift+左键 / 右键：平移画布</div>
                        <div className="text-gray-500 pt-0.5 border-t border-white/10">当前缩放 {Math.round(dialogTempPreviewScale * 100)}%</div>
                      </div>

                      <div className="absolute right-4 top-4 z-10">
                        <button type="button" onClick={() => setDialogTempPreviewId(null)} className="px-3 py-2 rounded-xl bg-[#1a1a1e]/95 border border-[#2e2e32] text-[10px] font-black text-white hover:bg-[#2a2a32]">关闭</button>
                      </div>

                      <div
                        className="absolute left-4 bottom-4 max-w-[min(680px,92vw)] rounded-xl bg-[#1c1c22]/95 border border-[#2e2e32] p-4 space-y-2 text-left"
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
                          <button onClick={() => { handleDialogTempLocateMessage(item); setDialogTempPreviewId(null); }} className="px-4 py-2 rounded-xl bg-[#1e40af] text-[10px] font-black text-white hover:bg-blue-500 transition-colors">定位消息</button>
                        )}
                        <button onClick={() => { handleDialogTempAddToInput(item); setDialogTempPreviewId(null); }} className="px-4 py-2 rounded-xl bg-[#15803d] text-[10px] font-black text-white hover:bg-[#22c55e] transition-colors">加入输入框</button>
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
            {dialogCropState && (
              <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                <div className="text-[10px] text-gray-400 mb-3">拖拽选择裁切区域，然后点击「确认裁切」</div>
                <div
                  className="inline-block max-w-full max-h-[70vh] relative cursor-crosshair select-none rounded-xl overflow-hidden border border-[#2e2e32]"
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
                     <button onClick={handleLibSelectAll} className="px-3 py-2 rounded-xl text-[9px] font-black uppercase border border-[#2e2e32] bg-[#1c1c22] hover:bg-[#2e2e36]">全选</button>
                     <button onClick={handleLibInvertSelect} className="px-3 py-2 rounded-xl text-[9px] font-black uppercase border border-[#2e2e32] bg-[#1c1c22] hover:bg-[#2e2e36]">反选</button>
                     <button onClick={handleLibBatchDownload} disabled={libSelectedGroupIds.size === 0} className="px-3 py-2 rounded-xl text-[9px] font-black uppercase border border-[#3b82f6] bg-[#1e3558] text-blue-300 hover:bg-[#305a90] disabled:opacity-40 disabled:cursor-not-allowed">批量下载（{libSelectedGroupIds.size}）</button>
                   </div>
                   {groupedLibrary.length === 0 ? (
                     <div className="flex flex-col items-center justify-center py-20 text-center">
                       <AppIcon name="package" className="w-12 h-12 mb-4 opacity-60" />
                       <p className="text-[11px] font-black uppercase tracking-widest text-gray-500 mb-2">暂无资产</p>
                       <p className="text-[10px] text-gray-600 max-w-sm">可点击左侧「上传图片」、或从「对话」「生成3D」保存到资产库。</p>
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
                           onSendToDialog={sendLibraryItemToDialog}
                           onSendToTexture={sendLibraryItemToTexture}
                           onSendToGenerate3DImage={sendLibraryItemToGenerate3DImage}
                           onSendToGenerate3DModel={sendLibraryItemToGenerate3DModel}
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
              正在将当前工作区画布与图片同步到云端，请稍候…
            </p>
            <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
              完成前请勿关闭或刷新页面，以免未上传的数据丢失。
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
              确定删除「
              <span className="text-white font-medium">{workspaceProjectDeletePending.name}</span>
              」吗？工作流画布数据将一并删除，且无法恢复。
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
                className="rounded-xl border border-red-500/40 bg-red-950/50 px-4 py-2.5 text-[11px] font-medium text-red-100 hover:bg-red-900/50 outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
              >
                删除
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
      <Suspense fallback={<div className="min-h-screen bg-[#050505] flex items-center justify-center text-[11px] text-gray-500">加载中…</div>}>
        <RequireRole role="admin">
          <AdminAppShell />
        </RequireRole>
      </Suspense>
    );
  }
  return <MainApp />;
};

export default App;
