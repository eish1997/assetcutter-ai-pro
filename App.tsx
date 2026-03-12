
import React, { Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { processTexture, DEFAULT_PROMPTS, normalizeApiErrorMessage, getTexturePrompt, parsePromptStructured, understandImageEditIntent } from './services/geminiService';
import {
  createImageJob,
  createImageJobContinue,
  cancelImageJob,
  getAllImageJobs,
  subscribeImageJobs,
  getBulkImageTodayRPD,
  getBulkImageRPDLimit,
  getBulkImageMaxImagesPerJob,
  getBulkImageMode,
} from './services/bulkImageJobFacade';
import { loadRecords, addRecord as addGenerationRecord, updateScore as updateGenerationScore } from './services/recordStore';
import { loadSnippets } from './services/snippetStore';
import { PRO_VIEW_IDS, type Submit3DProInput, type Submit3DRapidInput } from './services/tencentService';
import { AppStep, AppMode, LibraryItem, SystemConfig, AppTask, AssetCategory, DialogMessage, DialogSession, DialogImageSizeMode, DialogTempItem, DialogImageGear, SUPPORTED_ASPECT_RATIOS, SUPPORTED_IMAGE_SIZES, DIALOG_IMAGE_MODELS, DIALOG_IMAGE_GEARS, type GenerationRecord, type CustomAppModule, type CapabilitySet, type WorkflowAsset, type WorkflowPendingTask, type ArenaCurrentStep, type ArenaStepEntry, type ArenaTimelineBlock, type ImageJob } from './types';
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

const UnifiedModelViewer3D = React.lazy(() => import('./components/UnifiedModelViewer3D'));
const WorkflowSection = React.lazy(() => import('./components/WorkflowSection'));
const CapabilityPresetSection = React.lazy(() => import('./components/CapabilityPresetSection'));
const PromptArenaSection = React.lazy(() => import('./components/PromptArenaSection'));
const SeamRepairSection = React.lazy(() => import('./components/SeamRepairSection'));
const GenerateTextureSection = React.lazy(() => import('./components/GenerateTextureSection'));
const HomeSection = React.lazy(() => import('./components/HomeSection'));
const SiteAssistant = React.lazy(() => import('./components/SiteAssistant'));
const SettingsSection = React.lazy(() => import('./components/SettingsSection'));
type SourceAggregate = {
  count: number;
  rated: number;
  sumScore: number;
  samples: { fullPrompt: string; instruction?: string; userScore: number }[];
};

class WorkflowErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  declare props: Readonly<{ children: React.ReactNode }>;
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    console.error('[工作流]', error);
  }
  render() {
    if (this.state.error) {
      const err = this.state.error;
      const fullText = `工作流报错\n\n${err.message}\n\n${err.stack ?? ''}`;
      return (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/40 p-6 text-red-200 min-h-[200px]">
          <div className="flex items-center justify-between gap-4 mb-3">
            <h3 className="text-[10px] font-black uppercase text-red-400">工作流内报错</h3>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(fullText);
              }}
              className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-[9px] font-black uppercase text-red-300 hover:bg-red-500/30"
            >
              复制报错
            </button>
          </div>
          <pre className="text-[9px] overflow-auto max-h-[40vh] whitespace-pre-wrap break-words bg-black/30 p-3 rounded-lg border border-red-500/20">{err.message}</pre>
          {err.stack && (
            <details className="mt-3">
              <summary className="text-[8px] font-black uppercase text-gray-500 cursor-pointer hover:text-gray-400">堆栈</summary>
              <pre className="text-[8px] text-gray-500 mt-1 overflow-auto max-h-[30vh] whitespace-pre-wrap break-words bg-black/30 p-3 rounded-lg">{err.stack}</pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

const LazySectionFallback: React.FC<{ label?: string }> = ({ label = '模块' }) => (
  <div className="min-h-[240px] w-full rounded-2xl border border-white/10 bg-black/20 flex items-center justify-center text-[11px] text-gray-500">
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

const AssetViewer: React.FC<{ item: LibraryItem | null; onClose: () => void }> = ({ item, onClose }) => {
  if (!item) return null;
  const categoryLabel = ASSET_VIEWER_CATEGORY_LABELS[item.category] ?? item.category;
  const is3D = item.category === 'MESH_MODEL' && (item.modelUrls?.length ?? 0) > 0;
  const isPlaceholderPreview = item.data?.includes('data:image/svg+xml') && is3D;
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/95 backdrop-blur-xl animate-in fade-in duration-300 p-4 lg:p-20" onClick={onClose}>
      <div className="relative max-w-7xl w-full h-full flex flex-col items-center justify-center" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-0 right-0 w-12 h-12 flex items-center justify-center text-white/40 hover:text-white transition-colors">✕</button>
        <div className="w-full flex-1 flex items-center justify-center overflow-hidden rounded-[3rem] border border-white/5 bg-black/40">
          {isPlaceholderPreview ? (
            <div className="flex flex-col items-center justify-center gap-4 text-gray-500">
              <span className="text-4xl">🧊</span>
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
              {is3D && <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-indigo-600/30 text-indigo-300 border border-indigo-500/40">3D</span>}
            </div>
            <p className="text-[10px] mono text-blue-400 mt-1 uppercase tracking-widest">
              {categoryLabel}
              {item.style ? ` · ${item.style}` : ''} · {new Date(item.timestamp).toLocaleString()}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {item.data && !isPlaceholderPreview && <a href={item.data} download={`${item.label}.png`} className="px-6 py-3 bg-blue-600 rounded-full font-black text-[10px] uppercase tracking-widest electric-glow">下载预览图</a>}
            {item.modelUrls?.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="px-6 py-3 bg-indigo-600/80 rounded-full font-black text-[10px] uppercase tracking-widest hover:bg-indigo-500/80 transition-colors">下载模型{item.modelUrls!.length > 1 ? ` ${i + 1}` : ''}</a>
            ))}
          </div>
        </div>
      </div>
    </div>
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
        className="relative aspect-square glass rounded-[2rem] lg:rounded-[2.5rem] overflow-hidden bg-black/40 cursor-crosshair border border-white/5 touch-none"
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
            className="absolute border-2 border-blue-500 bg-blue-500/10 pointer-events-none"
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
        <button onClick={onCancel} className="flex-1 py-4 bg-white/5 border border-white/10 rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-white/10 transition-all">取消</button>
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
    <div className="fixed inset-0 z-[2005] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4 lg:p-20" onClick={onClose}>
      <div className="glass max-w-6xl w-full h-full rounded-[3rem] flex flex-col p-8 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-sm font-black uppercase tracking-widest text-blue-400">从资产库导入{multiSelect ? '（可多选）' : ''}</h2>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white transition-colors">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {filtered.length === 0 ? (
             <div className="h-full flex flex-col items-center justify-center text-gray-600">
               <span className="text-4xl mb-4">📦</span>
               <span className="text-[10px] font-black uppercase tracking-widest">暂无可用资产</span>
             </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
              {filtered.map(item => (
                <div
                  key={item.id}
                  onClick={() => toggle(item.id)}
                  className={`glass aspect-square rounded-2xl p-2 cursor-pointer border-white/5 hover:border-blue-500 transition-all group overflow-hidden relative ${multiSelect && selectedIds.has(item.id) ? 'ring-2 ring-blue-500' : ''}`}
                >
                  <img src={item.data} className="w-full h-full object-contain" alt="" />
                  {multiSelect && (
                    <div className="absolute top-1 right-1 w-5 h-5 rounded border flex items-center justify-center bg-black/50">
                      {selectedIds.has(item.id) ? <span className="text-blue-400 text-xs">✓</span> : null}
                    </div>
                  )}
                  {!multiSelect && (
                    <div className="absolute inset-0 bg-blue-600/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
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
const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.HOME);
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
  const [workflowAssets, setWorkflowAssets] = useState<WorkflowAsset[]>([]);
  const [workflowPending, setWorkflowPending] = useState<WorkflowPendingTask[]>([]);
  const [step, setStep] = useState<AppStep>(AppStep.T_PATTERN);
  const [tasks, setTasks] = useState<AppTask[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dialogOptionsExpanded, setDialogOptionsExpanded] = useState(false);
  const [dialogModelDropdownOpen, setDialogModelDropdownOpen] = useState(false);
  const [activeAssetId, setActiveAssetId] = useState<LibraryItem | null>(null);
  const [libFilter, setLibFilter] = useState<AssetCategory | 'ALL'>('ALL');
  const [libSelectedGroupIds, setLibSelectedGroupIds] = useState<Set<string>>(new Set());
  const [isLibraryPickerOpen, setIsLibraryPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState<AssetCategory | undefined>();
  const [pickerMultiSelect, setPickerMultiSelect] = useState(false);
  const [pickerCallback, setPickerCallback] = useState<(items: LibraryItem[]) => void>(() => {});
  const [globalLogs, setGlobalLogs] = useState<Array<{ id: string; time: number; module: string; level: 'info' | 'warn' | 'error'; message: string; detail?: string }>>([]);
  const addGlobalLog = useCallback((module: string, level: 'info' | 'warn' | 'error', message: string, detail?: string) => {
    setGlobalLogs(prev => [...prev.slice(-199), { id: Math.random().toString(36).slice(2, 11), time: Date.now(), module, level, message, detail }]);
  }, []);

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
  const [arenaImageModel, setArenaImageModel] = useState<string>(() => DIALOG_IMAGE_GEARS[0].modelId);
  const [arenaCurrentStep, setArenaCurrentStep] = useState<ArenaCurrentStep>('idle');
  const [arenaStepLog, setArenaStepLog] = useState<ArenaStepEntry[]>([]);
  const [arenaTimeline, setArenaTimeline] = useState<ArenaTimelineBlock[]>([]);
  const [arenaSnippets, setArenaSnippets] = useState<Array<{ id: string; text: string; timestamp: number; source?: string }>>(() => loadSnippets());
  const [arenaFirstVisit, setArenaFirstVisit] = useState(() => !localStorage.getItem('ac_arena_visited'));

  const { mainScrollRef, showBackToTop, scrollToTop } = useMainScrollBackToTop();

  useEffect(() => {
    if (mode === AppMode.ARENA) setArenaSnippets(loadSnippets());
  }, [mode]);

  // 对话式生图状态
  const [dialogInputText, setDialogInputText] = useState('');
  const DIALOG_INPUT_IMAGES_MAX = 9;
  const [dialogInputImages, setDialogInputImages] = useState<Array<{ id: string; data: string }>>([]);
  const [dialogImageGear, setDialogImageGear] = useState<DialogImageGear>('fast');
  const [dialogModel, setDialogModel] = useState<string>(() => DIALOG_IMAGE_GEARS[0].modelId);
  const [dialogAutoGenerateImage, setDialogAutoGenerateImage] = useState(true);
  const [dialogSizeMode, setDialogSizeMode] = useState<DialogImageSizeMode>('adaptive');
  const [dialogAspectRatio, setDialogAspectRatio] = useState<string>(SUPPORTED_ASPECT_RATIOS[0].value);
  const [dialogImageSize, setDialogImageSize] = useState<string>(SUPPORTED_IMAGE_SIZES[1].value);
  const [dialogEditingMessageId, setDialogEditingMessageId] = useState<string | null>(null);
  const [dialogEditingText, setDialogEditingText] = useState('');
  const [bulkImageCount, setBulkImageCount] = useState(8);
  const [imageJobsSnapshot, setImageJobsSnapshot] = useState<ImageJob[]>([]);
  useEffect(() => {
    getAllImageJobs().then(setImageJobsSnapshot).catch(() => setImageJobsSnapshot([]));
    const unsub = subscribeImageJobs(() => getAllImageJobs().then(setImageJobsSnapshot).catch(() => {}));
    return unsub;
  }, []);
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
  } = useDialogWorkspace();
  const DIALOG_BOX_LABELS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
  const dialogEndRef = useRef<HTMLDivElement>(null);
  const [dialogValidationError, setDialogValidationError] = useState<string | null>(null);
  const [atSuggestionsOpen, setAtSuggestionsOpen] = useState(false);
  const [atSuggestionsCursor, setAtSuggestionsCursor] = useState(0);
  const dialogInputRef = useRef<HTMLInputElement>(null);
  const dialogInputWrapperRef = useRef<HTMLDivElement>(null);

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
    setDialogInputImages(prev => (prev.length >= DIALOG_INPUT_IMAGES_MAX ? prev : [...prev, { id: item.id, data: item.data }]));
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
      modelImage: 'gemini-2.5-flash-image', 
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
    dialogModel,
    dialogSizeMode,
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
  });

  const handleRemoveDialogSession = useCallback((sessionId: string) => {
    handleDialogCancelGen(sessionId);
    removeDialogSession(sessionId);
  }, [handleDialogCancelGen, removeDialogSession]);

  const [bulkImageSubmitting, setBulkImageSubmitting] = useState(false);
  const handleStartBulkImageJob = useCallback(async () => {
    const text = dialogInputText.trim();
    setDialogValidationError(null);
    if (!text) {
      setDialogValidationError('请先输入生图描述');
      return;
    }
    setBulkImageSubmitting(true);
    try {
      const sourceImages = dialogInputImages.map((i) => i.data).filter(Boolean);
      const { instruction, shouldGenerateImage } = await understandImageEditIntent(
        getDialogUnderstandImageInput(sourceImages),
        text,
        config.modelText,
        config.prompts.dialog_understand
      );
      if (!shouldGenerateImage) {
        setDialogValidationError('当前输入似乎不是生图需求，请描述要生成的画面或对图片的修改');
        return;
      }
      const total = Math.min(Math.max(1, bulkImageCount), getBulkImageMaxImagesPerJob());
      await createImageJob(instruction, total, {
        imageBase64: sourceImages[0] ?? null,
        model: dialogModel,
        aspectRatio: dialogSizeMode === 'manual' ? dialogAspectRatio : undefined,
        imageSize: dialogSizeMode === 'manual' ? dialogImageSize : undefined,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setDialogValidationError(msg.length > 120 ? msg.slice(0, 120) + '…' : msg);
    } finally {
      setBulkImageSubmitting(false);
    }
  }, [dialogInputText, dialogInputImages, bulkImageCount, config.modelText, config.prompts.dialog_understand, dialogModel, dialogSizeMode, dialogAspectRatio, dialogImageSize, setDialogValidationError]);

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
    if (!v?.resultImageBase64) return;
    const a = document.createElement('a');
    a.href = v.resultImageBase64;
    a.download = `对话_${msg.id.slice(0, 6)}.png`;
    a.click();
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
          reader.onload = () => setDialogInputImages(prev => prev.length >= DIALOG_INPUT_IMAGES_MAX ? prev : [...prev, { id: Math.random().toString(36).slice(2, 11), data: reader.result as string }]);
          reader.readAsDataURL(file);
        }
        return;
      }
    }
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
      const a = document.createElement('a');
      a.href = item.data;
      a.download = `${item.label || '资产'}_${i + 1}.png`;
      a.click();
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
    setDialogInputImages([{ id: item.id, data: item.data }]);
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
      <div className={`glass p-5 rounded-[2.5rem] border-white/5 group hover:border-blue-500/40 transition-all flex flex-col h-full relative ${isSelected ? 'ring-2 ring-blue-500/60' : ''}`}>
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
          <button type="button" onClick={e => { e.stopPropagation(); onToggleSelect(); }} className={`w-5 h-5 rounded border flex items-center justify-center text-[10px] ${isSelected ? 'bg-blue-600 border-blue-500 text-white' : 'bg-white/5 border-white/20 text-gray-500 hover:bg-white/10'}`}>{isSelected ? '✓' : ''}</button>
          {is3D && <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-indigo-600/30 text-indigo-300 border border-indigo-500/40">3D</span>}
        </div>
        <div className="aspect-square mb-6 bg-black/40 rounded-[2rem] overflow-hidden flex items-center justify-center p-4 cursor-pointer relative" onClick={() => setActiveAssetId(activeItem)}>
           <img src={activeItem.data} className="max-w-full max-h-full object-contain" alt={activeItem.label} />
        </div>
        <div className="flex-1 px-1">
          <div className="text-[10px] font-bold truncate mb-4 uppercase tracking-widest">{activeItem.label}</div>
          {items.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-5 min-h-[24px]">
              {items.map((it, idx) => (
                <button key={it.id} onClick={() => setActiveIdx(idx)} className={`w-8 h-8 rounded-lg flex items-center justify-center text-[7px] font-black border ${activeIdx === idx ? 'bg-blue-600 border-blue-500' : 'bg-white/5 border-white/10'}`}>{it.style?.slice(0,3).toUpperCase() || 'DEF'}</button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {(hasImage || has3DModelUrl) && (
            <div className="mb-2 px-1">
              <div className="text-[8px] font-black uppercase text-gray-500 mb-1.5">发送到</div>
              <div className="flex flex-wrap gap-1.5">
                {hasImage && onSendToDialog && <button onClick={() => onSendToDialog(activeItem)} className="py-1.5 px-2.5 rounded-lg bg-blue-600/20 border border-blue-500/40 text-[8px] font-black uppercase hover:bg-blue-600/40 text-blue-300">继续编辑</button>}
                {hasImage && onSendToTexture && <button onClick={() => onSendToTexture(activeItem)} className="py-1.5 px-2.5 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-[8px] font-black uppercase hover:bg-indigo-600/40 text-indigo-300">贴图</button>}
                {hasImage && onSendToGenerate3DImage && <button onClick={() => onSendToGenerate3DImage(activeItem)} className="py-1.5 px-2.5 rounded-lg bg-amber-600/20 border border-amber-500/40 text-[8px] font-black uppercase hover:bg-amber-600/40 text-amber-300">生成3D</button>}
                {has3DModelUrl && onSendToGenerate3DModel && <button onClick={() => onSendToGenerate3DModel(activeItem)} className="py-1.5 px-2.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-[8px] font-black uppercase hover:bg-emerald-600/40 text-emerald-300">生成3D 中使用</button>}
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
        <section className="glass p-6 rounded-[2.5rem] border-white/5 bg-black/40">
          <div className="flex justify-between items-center mb-6"><h3 className="text-[10px] font-black text-blue-400 uppercase">源贴图输入</h3></div>
          {!textureSource ? (
            <div className="space-y-4">
              <label className="w-full h-64 cursor-pointer group flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-3xl hover:bg-blue-600/5 transition-all">
                <span className="text-3xl mb-4">🖼️</span>
                <span className="text-[9px] font-black uppercase text-gray-500">上传源图像</span>
                <input type="file" className="hidden" accept="image/*" onChange={e => handleFileUpload(e, setTextureSource)} />
              </label>
              <button onClick={() => openPicker(undefined, (items) => setTextureSource(items[0]?.data ?? ''))} className="w-full py-4 bg-white/5 border border-white/10 rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-white/10 transition-all flex items-center justify-center gap-2">
                <span>📦</span> 从资产库导入
              </button>
            </div>
          ) : (
            <div className="relative aspect-square rounded-2xl overflow-hidden border border-white/10 group">
              <img src={textureSource} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
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
                <div className="relative aspect-square glass rounded-[2rem] bg-black/40 flex items-center justify-center overflow-hidden">
                  {textureResult ? <img src={textureResult} className="max-w-full max-h-full object-contain p-8" /> : <span className="text-[10px] font-black uppercase text-gray-700">提取结果待生成</span>}
                  {isTextureProcessing && <div className="absolute inset-0 bg-black/60 flex items-center justify-center"><div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}
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
                          className={`w-7 h-7 rounded border flex items-center justify-center text-[11px] transition-all ${(currentScore ?? 0) >= score ? 'border-amber-500/50 bg-amber-500/20 text-amber-400' : 'border-white/20 bg-white/5 hover:bg-amber-500/20 hover:border-amber-500/40 text-gray-500'}`}
                          title={`${score} 星`}
                        >★</button>
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
                <div className="flex-1 bg-white/5 p-4 rounded-2xl flex items-center gap-4">
                   <span className="text-[8px] font-black uppercase text-gray-500 whitespace-nowrap">预览密度: {tilingScale}x</span>
                   <input type="range" min="1" max="8" value={tilingScale} onChange={e => setTilingScale(parseInt(e.target.value))} className="flex-1" />
                </div>
                <button onClick={() => runTextureProcessing(textureSource, 'tileable')} disabled={!textureSource} className="px-10 py-4 bg-indigo-600 rounded-full text-[9px] font-black uppercase electric-glow disabled:opacity-20 transition-all">生成循环贴图</button>
             </div>
             <div className="flex-1 glass rounded-[2rem] relative overflow-hidden bg-[#0a0a0a] min-h-[500px]" style={{ backgroundImage: `url(${textureResult || textureSource})`, backgroundRepeat: 'repeat', backgroundSize: `${100 / tilingScale}%` }}>
                {isTextureProcessing && <div className="absolute inset-0 bg-black/60 flex items-center justify-center"><div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}
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
        <section className="glass p-6 rounded-[2.5rem] border-white/5">
          <h3 className="text-[10px] font-black text-blue-400 uppercase mb-4">筛选与导出</h3>
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <button type="button" onClick={() => setMode(AppMode.ARENA)} className="px-4 py-2 rounded-xl bg-amber-600/20 border border-amber-500/30 text-[9px] font-black uppercase text-amber-400 hover:bg-amber-600/30 transition-all">去对比测试</button>
            <span className="text-[9px] font-black text-gray-500 uppercase">来源</span>
            <select value={filterSource} onChange={e => setFilterSource(e.target.value as any)} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 transition-colors">
              <option value="all">全部</option>
              <option value="dialog">对话</option>
              <option value="texture">提取花纹</option>
            </select>
            <span className="text-[9px] font-black text-gray-500 uppercase ml-4">评分</span>
            <select value={filterRated} onChange={e => setFilterRated(e.target.value as any)} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 transition-colors">
              <option value="all">全部</option>
              <option value="yes">已评分</option>
              <option value="no">未评分</option>
            </select>
            <button onClick={exportJson} className="px-4 py-2 bg-blue-600/20 border border-blue-500/30 rounded-xl text-[9px] font-black uppercase text-blue-400 hover:bg-blue-600/30 transition-all">导出 JSON</button>
            <button onClick={exportStructuredJson} className="px-4 py-2 bg-amber-600/20 border border-amber-500/30 rounded-xl text-[9px] font-black uppercase text-amber-400 hover:bg-amber-600/30 transition-all" title="主体/场景/风格/修饰/参数化模板，便于代码转自然语言">导出结构化 JSON</button>
            <button onClick={exportCsv} className="px-4 py-2 bg-blue-600/20 border border-blue-500/30 rounded-xl text-[9px] font-black uppercase text-blue-400 hover:bg-blue-600/30 transition-all">导出 CSV</button>
            <span className="text-[9px] font-black text-gray-500 uppercase ml-4">显示</span>
            <button onClick={() => setViewMode('list')} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border transition-all ${viewMode === 'list' ? 'bg-blue-600/20 text-blue-400 border-blue-500/30' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>列表</button>
            <button onClick={() => setViewMode('repro')} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border transition-all ${viewMode === 'repro' ? 'bg-blue-600/20 text-blue-400 border-blue-500/30' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>复现模板</button>
          </div>
          <p className="text-[9px] text-gray-500">共 {filtered.length} 条（最近 500 条），仅读分析用，不改动提示词或配置。</p>
        </section>
        <section className="glass p-6 rounded-[2.5rem] border-white/5">
          <h3 className="text-[10px] font-black text-blue-400 uppercase mb-4">按来源聚合</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(Object.entries(bySource) as [string, SourceAggregate][]).map(([key, agg]) => (
              <div key={key} className="bg-black/40 rounded-xl p-4 border border-white/10">
                <div className="text-[10px] font-black uppercase text-blue-400 mb-2">{key}</div>
                <div className="text-[9px] text-gray-400 space-y-1">条数 {agg.count} · 已评 {agg.rated} · 平均分 {agg.rated ? (agg.sumScore / agg.rated).toFixed(1) : '-'}</div>
                {agg.samples.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <div className="text-[8px] font-black text-gray-500 uppercase">高分样本（≥4 星）</div>
                    {agg.samples.slice(0, 3).map((s, i) => (
                      <div key={i} className="text-[9px] text-gray-300 bg-white/5 rounded-lg p-2 border border-white/5">
                        <span className="text-amber-400">{s.userScore} 星</span> {s.instruction ?? s.fullPrompt}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="glass p-6 rounded-[2.5rem] border-white/5">
          <h3 className="text-[10px] font-black text-blue-400 uppercase mb-4">{viewMode === 'repro' ? '结构化复现模板' : '记录列表'}</h3>
          {viewMode === 'list' ? (
            <>
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <table className="w-full text-left text-[9px]">
                  <thead className="sticky top-0 bg-black/80 border-b border-white/10">
                    <tr>
                      <th className="py-2 px-2">时间</th>
                      <th className="py-2 px-2">来源</th>
                      <th className="py-2 px-2">评分</th>
                      <th className="py-2 px-2 max-w-[200px]">instruction / fullPrompt 片段</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 100).map(r => (
                      <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
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
                  <div key={r.id} className="bg-black/40 rounded-xl border border-white/10 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-white/5 flex-wrap gap-2">
                      <span className="text-[9px] font-black text-blue-400 uppercase">
                        {r.source === 'dialog' ? '对话' : `贴图 · ${r.textureType ?? '-'}`}
                        {r.userScore != null && <span className="text-amber-400 ml-2">{r.userScore} 星</span>}
                        {hasLlm && <span className="text-emerald-400 ml-2">LLM</span>}
                      </span>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={runLlmParse} disabled={loading} className="px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-[9px] font-black uppercase text-emerald-400 hover:bg-emerald-600/30 transition-all disabled:opacity-50" title="用大模型解析主体/场景/风格/修饰">{loading ? '解析中…' : '用 LLM 解析'}</button>
                        <button type="button" onClick={() => navigator.clipboard.writeText(template)} className="px-3 py-1.5 rounded-lg bg-amber-600/20 border border-amber-500/30 text-[9px] font-black uppercase text-amber-400 hover:bg-amber-600/30 transition-all" title="复制参数化模板">复制模板</button>
                        <button type="button" onClick={() => navigator.clipboard.writeText(jsonStr)} className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-[9px] font-black uppercase hover:bg-white/20 transition-all" title="复制结构化 JSON">复制 JSON</button>
                        <button type="button" onClick={() => navigator.clipboard.writeText(fullText)} className="px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/30 text-[9px] font-black uppercase text-blue-400 hover:bg-blue-600/30 transition-all">复制本条</button>
                      </div>
                    </div>
                    {err && <div className="px-4 py-1.5 bg-red-900/20 border-b border-red-500/20 text-[10px] text-red-300">{err}</div>}
                    <div className="p-4 space-y-4">
                      <div>
                        <div className="text-[8px] font-black text-gray-500 uppercase mb-2">结构化提示词（Imagen 建议写法）</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                          <div className="bg-white/5 rounded-lg p-2 border border-white/5"><span className="text-gray-500">主体：</span><span className="text-gray-300">{structured.subject || '—'}</span></div>
                          <div className="bg-white/5 rounded-lg p-2 border border-white/5"><span className="text-gray-500">场景/背景：</span><span className="text-gray-300">{structured.scene || '—'}</span></div>
                          <div className="bg-white/5 rounded-lg p-2 border border-white/5"><span className="text-gray-500">风格：</span><span className="text-gray-300">{structured.style || '—'}</span></div>
                          <div className="bg-white/5 rounded-lg p-2 border border-white/5"><span className="text-gray-500">可选修饰：</span><span className="text-gray-300">{structured.modifiers || '—'}</span></div>
                        </div>
                      </div>
                      <div>
                        <div className="text-[8px] font-black text-gray-500 uppercase mb-2">参数化模板（占位符组句，便于复现）</div>
                        <pre className="p-3 rounded-lg bg-black/40 border border-white/10 text-[10px] text-amber-200/90 font-mono whitespace-pre-wrap break-all">{template}</pre>
                        <p className="text-[8px] text-gray-500 mt-1">在代码中用占位符替换后生成自然语言，再发给模型。</p>
                      </div>
                      <details className="group">
                        <summary className="text-[9px] font-black text-gray-500 uppercase cursor-pointer hover:text-gray-400">原始完整句</summary>
                        <pre className="mt-2 p-3 rounded-lg bg-black/40 border border-white/5 text-[9px] text-gray-400 whitespace-pre-wrap overflow-x-auto max-h-32">{r.fullPrompt}</pre>
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
    <div className="min-h-[100dvh] bg-[#050505] text-white flex flex-col lg:flex-row relative font-sans overflow-hidden">
      <AssetViewer item={activeAssetId} onClose={() => setActiveAssetId(null)} />
      {isLibraryPickerOpen && <LibraryPickerModal library={library} filter={pickerFilter} multiSelect={pickerMultiSelect} onSelect={(items) => { pickerCallback(items); setIsLibraryPickerOpen(false); }} onClose={() => setIsLibraryPickerOpen(false)} />}

      <aside className={`fixed lg:static inset-y-0 left-0 glass border-r border-white/5 flex flex-col items-center py-6 shrink-0 z-[1001] transition-all duration-300 ${sidebarCollapsed ? 'w-16' : 'w-64'} ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <button onClick={() => setSidebarCollapsed(p => !p)} className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-black text-lg mb-8 shadow-lg hover:bg-blue-500 transition-colors" title={sidebarCollapsed ? '展开' : '收起'}>{sidebarCollapsed ? '›' : '‹'}</button>
        <nav className="flex-1 w-full space-y-2 px-2 min-h-0 flex flex-col">
          <div className="space-y-2">
            <button onClick={() => { setMode(AppMode.HOME); setIsSidebarOpen(false); }} className={`w-full py-3 rounded-xl text-[10px] font-black uppercase border flex items-center justify-center gap-2 ${mode === AppMode.HOME ? 'bg-blue-600/10 text-blue-400 border-blue-500/30' : 'text-gray-500 border-transparent hover:bg-white/5'}`} title="主页">{sidebarCollapsed ? '🏠' : '主页'}</button>
            <button onClick={() => { setMode(AppMode.DIALOG); setIsSidebarOpen(false); }} className={`w-full py-3 rounded-xl text-[10px] font-black uppercase border flex items-center justify-center gap-2 ${mode === AppMode.DIALOG ? 'bg-blue-600/10 text-blue-400 border-blue-500/30' : 'text-gray-500 border-transparent hover:bg-white/5'}`} title="对话">{sidebarCollapsed ? '💬' : '对话'}</button>
            <button onClick={() => { setMode(AppMode.WORKFLOW); setIsSidebarOpen(false); }} className={`w-full py-3 rounded-xl text-[10px] font-black uppercase border flex items-center justify-center gap-2 ${mode === AppMode.WORKFLOW ? 'bg-blue-600/10 text-blue-400 border-blue-500/30' : 'text-gray-500 border-transparent hover:bg-white/5'}`} title="工作流">{sidebarCollapsed ? '⚡' : '工作流'}</button>
            <button onClick={() => { setMode(AppMode.CAPABILITY); setIsSidebarOpen(false); }} className={`w-full py-3 rounded-xl text-[10px] font-black uppercase border flex items-center justify-center gap-2 ${mode === AppMode.CAPABILITY ? 'bg-blue-600/10 text-blue-400 border-blue-500/30' : 'text-gray-500 border-transparent hover:bg-white/5'}`} title="能力（功能预设）">{sidebarCollapsed ? '◇' : '能力'}</button>
            <button onClick={() => { setMode(AppMode.GENERATE_3D); setIsSidebarOpen(false); }} className={`w-full py-3 rounded-xl text-[10px] font-black uppercase border flex items-center justify-center gap-2 ${mode === AppMode.GENERATE_3D ? 'bg-blue-600/10 text-blue-400 border-blue-500/30' : 'text-gray-500 border-transparent hover:bg-white/5'}`} title="生成3D资产（未上线）">{sidebarCollapsed ? '🧊' : <><span>生成3D</span><span className="text-[8px] font-normal normal-case text-amber-400/90">未上线</span></>}</button>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2 space-y-1.5">
              <div className="px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-gray-500">贴图</div>
              <button onClick={() => { setMode(AppMode.TEXTURE); setStep(AppStep.T_PATTERN); setIsSidebarOpen(false); }} className={`w-full py-2.5 rounded-lg text-[10px] font-black uppercase border flex items-center justify-center gap-2 ${mode === AppMode.TEXTURE ? 'bg-blue-600/10 text-blue-400 border-blue-500/30' : 'text-gray-500 border-transparent hover:bg-white/5'}`} title="提取花纹">{sidebarCollapsed ? '🖼' : '提取花纹'}</button>
              <button onClick={() => { setMode(AppMode.SEAM_REPAIR); setIsSidebarOpen(false); }} className={`w-full py-2.5 rounded-lg text-[10px] font-black uppercase border flex items-center justify-center gap-2 ${mode === AppMode.SEAM_REPAIR ? 'bg-blue-600/10 text-blue-400 border-blue-500/30' : 'text-gray-500 border-transparent hover:bg-white/5'}`} title="贴图修缝">{sidebarCollapsed ? '🔧' : '贴图修缝'}</button>
              <button onClick={() => { setMode(AppMode.PBR_TEXTURE); setIsSidebarOpen(false); }} className={`w-full py-2.5 rounded-lg text-[10px] font-black uppercase border flex items-center justify-center gap-2 ${mode === AppMode.PBR_TEXTURE ? 'bg-blue-600/10 text-blue-400 border-blue-500/30' : 'text-gray-500 border-transparent hover:bg-white/5'}`} title="生成贴图">{sidebarCollapsed ? '🎨' : '生成贴图'}</button>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2 space-y-1.5">
              <div className="px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-gray-500">提示词</div>
              <button onClick={() => { setMode(AppMode.ADMIN); setIsSidebarOpen(false); }} className={`w-full py-2.5 rounded-lg text-[10px] font-black uppercase border flex items-center justify-center gap-2 ${mode === AppMode.ADMIN ? 'bg-blue-600/10 text-blue-400 border-blue-500/30' : 'text-gray-500 border-transparent hover:bg-white/5'}`} title="提示词效果">{sidebarCollapsed ? '📊' : '提示词效果'}</button>
              <button onClick={() => { setMode(AppMode.ARENA); setIsSidebarOpen(false); }} className={`w-full py-2.5 rounded-lg text-[10px] font-black uppercase border flex items-center justify-center gap-2 ${mode === AppMode.ARENA ? 'bg-blue-600/10 text-blue-400 border-blue-500/30' : 'text-gray-500 border-transparent hover:bg-white/5'}`} title="提示词擂台">{sidebarCollapsed ? '⚔' : '提示词擂台'}</button>
            </div>
            <button onClick={() => { setMode(AppMode.LIBRARY); setIsSidebarOpen(false); }} className={`w-full py-3 rounded-xl text-[10px] font-black uppercase border flex items-center justify-center gap-2 ${mode === AppMode.LIBRARY ? 'bg-blue-600/10 text-blue-400 border-blue-500/30' : 'text-gray-500 border-transparent hover:bg-white/5'}`} title="仓库">{sidebarCollapsed ? '📁' : '仓库'}</button>
            <button onClick={() => { setMode(AppMode.SETTINGS); setIsSidebarOpen(false); }} className={`w-full py-3 rounded-xl text-[10px] font-black uppercase border flex items-center justify-center gap-2 ${mode === AppMode.SETTINGS ? 'bg-blue-600/10 text-blue-400 border-blue-500/30' : 'text-gray-500 border-transparent hover:bg-white/5'}`} title="设置">{sidebarCollapsed ? '⚙' : '设置'}</button>
          </div>
        </nav>
        {!sidebarCollapsed && (
          <div className="w-full shrink-0 border-t border-white/10 mt-2 pt-2 px-2">
            <div className="rounded-xl bg-black/40 border border-white/5 overflow-hidden">
              <div className="px-2 py-1.5 border-b border-white/5 text-[9px] font-black uppercase text-gray-500">日志</div>
              <div className="min-h-[min(28vh,240px)] max-h-[min(42vh,360px)] overflow-y-auto no-scrollbar space-y-1 p-2">
                {(() => {
                  const moduleForMode = mode === AppMode.HOME ? null : mode === AppMode.DIALOG ? '对话' : mode === AppMode.TEXTURE ? '提取花纹' : mode === AppMode.GENERATE_3D ? '生成3D' : mode === AppMode.WORKFLOW ? '工作流' : mode === AppMode.CAPABILITY ? '能力' : mode === AppMode.ADMIN ? '提示词效果' : mode === AppMode.ARENA ? '提示词擂台' : mode === AppMode.SEAM_REPAIR ? '贴图修缝' : mode === AppMode.PBR_TEXTURE ? '生成贴图' : mode === AppMode.LIBRARY ? '仓库' : mode === AppMode.SETTINGS ? '设置' : null;
                  const filtered = moduleForMode ? globalLogs.filter(l => l.module === moduleForMode) : [];
                  if (filtered.length === 0) return <div className="text-[9px] text-gray-600 py-2 text-center">暂无日志</div>;
                  return [...filtered].reverse().slice(0, 60).map(log => (
                    <div key={log.id} className={`text-[9px] leading-snug py-1.5 px-2 rounded border-l-2 ${log.level === 'error' ? 'border-red-500/60 text-red-300/90 bg-red-500/10' : log.level === 'warn' ? 'border-amber-500/60 text-amber-300/90 bg-amber-500/10' : 'border-white/20 text-gray-400'}`}>
                      <span className="text-gray-300">{log.message}</span>
                      {log.detail && <span className="block text-gray-500 mt-0.5 text-[8px] break-all">{log.detail}</span>}
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        )}
      </aside>

      <Suspense fallback={null}>
        <SiteAssistant tasks={tasks} onRemoveTask={id => setTasks(p => p.filter(t => t.id !== id))} />
      </Suspense>

      <main className="flex-1 flex flex-col h-[100dvh] overflow-hidden">
        {!isSidebarOpen && (
          <button type="button" onClick={() => setIsSidebarOpen(true)} className="lg:hidden fixed top-4 left-4 z-[1000] w-10 h-10 flex items-center justify-center bg-white/10 border border-white/20 rounded-xl hover:bg-white/20 transition-colors" title="打开菜单" aria-label="打开菜单">☰</button>
        )}
        <div ref={mainScrollRef} className="flex-1 overflow-y-auto p-4 lg:p-10 no-scrollbar touch-pan-y">
          {mode === AppMode.HOME ? (
            <div className="relative min-h-full -mx-4 -my-4 lg:-mx-10 lg:-my-10">
              <div className="absolute inset-0 home-bg-mesh pointer-events-none" aria-hidden />
              <div className="relative max-w-6xl mx-auto w-full px-4 py-4 lg:px-10 lg:py-10 min-h-[80vh]">
                <Suspense fallback={<LazySectionFallback label="主页" />}>
                  <HomeSection onNavigate={(m) => { setMode(m); if (m === AppMode.TEXTURE) setStep(AppStep.T_PATTERN); setIsSidebarOpen(false); }} library={library} onOpenAsset={(item) => setActiveAssetId(item)} />
                </Suspense>
              </div>
            </div>
          ) : (
          <div className="max-w-6xl mx-auto w-full">
            {mode === AppMode.SETTINGS && (
              <Suspense fallback={<LazySectionFallback label="设置" />}>
                <SettingsSection />
              </Suspense>
            )}
            {mode === AppMode.TEXTURE && <TextureEngineSection />}

            {mode === AppMode.WORKFLOW && (
              <WorkflowErrorBoundary>
                <Suspense fallback={<LazySectionFallback label="工作流" />}>
                  <WorkflowSection capabilityPresets={capabilityPresets} capabilitySets={capabilitySets} assets={workflowAssets} onAssetsChange={setWorkflowAssets} pending={workflowPending} onPendingChange={setWorkflowPending} onOpenLibraryPicker={(cb) => openPicker(undefined, cb, true)} onLog={(level, message, detail) => addGlobalLog('工作流', level, message, detail)} onAddGenerate3DJob={handleAddGenerate3DJobFromWorkflow} />
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
                <div className="px-2 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-[9px] font-black uppercase text-amber-400">生成3D · 未上线</div>
                <div className="glass rounded-2xl p-4 lg:p-6 border border-white/10 bg-black/40">
                  {!creds3D ? (
                    <div className="space-y-4 py-8">
                      <h3 className="text-[10px] font-black text-amber-400 uppercase">配置腾讯云凭证</h3>
                      <p className="text-[11px] text-gray-400">混元生3D 默认仅支持通过本地代理调用。请在项目根目录 <code className="bg-white/10 px-1 rounded">.env.local</code> 中配置 <code className="bg-white/10 px-1 rounded">TENCENT_SECRET_ID</code>、<code className="bg-white/10 px-1 rounded">TENCENT_SECRET_KEY</code>，启动 <code className="bg-white/10 px-1 rounded">npm run proxy</code>，并设置 <code className="bg-white/10 px-1 rounded">VITE_TENCENT_PROXY</code>。</p>
                      {unsafeTencentBrowserCredsEnabled ? (
                        <>
                          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[9px] text-amber-300">当前已显式开启不安全模式：浏览器可临时直持腾讯云密钥。仅建议本地排障使用，勿用于生产环境。</div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <input value={generate3DCredsOverride?.secretId ?? ''} onChange={e => setGenerate3DCredsOverride(p => ({ secretId: e.target.value.trim(), secretKey: p?.secretKey ?? '' }))} placeholder="SecretId" className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[11px] outline-none focus:border-blue-500" />
                            <input type="password" value={generate3DCredsOverride?.secretKey ?? ''} onChange={e => setGenerate3DCredsOverride(p => ({ secretId: p?.secretId ?? '', secretKey: e.target.value }))} placeholder="SecretKey" className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[11px] outline-none focus:border-blue-500" />
                          </div>
                        </>
                      ) : (
                        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[9px] text-gray-400">
                          如确需在浏览器直接调试，可在本地临时设置 <code className="bg-white/10 px-1 rounded">VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS=true</code> 后刷新页面，再手动输入凭证。
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
                              className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors ${generate3DModule === m.id ? 'bg-blue-600/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'}`}
                            >
                              <div className="text-[10px] font-black">{m.name}</div>
                              <div className="text-[9px] text-gray-500 mt-0.5">{m.desc}</div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 当前模块表单 */}
                      <div className="glass rounded-2xl p-4 border border-white/10 bg-black/30">
                        {generate3DModule === 'pro' && (
                          <>
                            <p className="text-[9px] text-gray-500 mb-3">可选用 3.0/3.1，支持文生3D、图生3D（单图/多视图）、白模、草图、智能拓扑；3.1 支持八视图多角度输入。</p>
                            <div className="flex gap-2 mb-3">
                              <button onClick={() => setGenerate3DMode('text')} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${generate3DMode === 'text' ? 'bg-blue-600 border-blue-500' : 'bg-white/5 border-white/10 text-gray-500'}`}>文生3D</button>
                              <button onClick={() => setGenerate3DMode('image')} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${generate3DMode === 'image' ? 'bg-blue-600 border-blue-500' : 'bg-white/5 border-white/10 text-gray-500'}`}>图生3D</button>
                            </div>
                            {generate3DMode === 'text' ? (
                              <textarea value={generate3DPrompt} onChange={e => setGenerate3DPrompt(e.target.value)} placeholder="文本描述…" rows={2} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none mb-3" />
                            ) : (
                              <>
                                <div className="flex gap-2 mb-3">
                                  <button onClick={() => { setGenerate3DImageMode('single'); setGenerate3DMultiViewImages({}); }} className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase border ${generate3DImageMode === 'single' ? 'bg-blue-600/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/10 text-gray-500'}`}>单图生成</button>
                                  <button onClick={() => { setGenerate3DImageMode('multi'); setGenerate3DImage(null); }} className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase border ${generate3DImageMode === 'multi' ? 'bg-blue-600/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/10 text-gray-500'}`}>多图生成</button>
                                </div>
                                {generate3DImageMode === 'single' ? (
                                  <div className="mb-3">
                                    {!generate3DImage ? (
                                      <label className="block h-20 border-2 border-dashed border-white/10 rounded-xl flex items-center justify-center cursor-pointer hover:bg-white/5 text-[9px] text-gray-500">点击上传参考图<input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setGenerate3DImage(r.result as string); r.readAsDataURL(f); } }} /></label>
                                    ) : (
                                      <div className="relative inline-block"><img src={generate3DImage} alt="参考" className="max-h-20 rounded-xl border border-white/10" /><button onClick={() => setGenerate3DImage(null)} className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded text-white text-xs">×</button></div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="mb-3 py-2 rounded-xl border border-white/10 bg-black/40">
                                    <MultiViewUpload images={generate3DMultiViewImages} onChange={setGenerate3DMultiViewImages} minCount={2} maxViews={generate3DModel === '3.1' ? 8 : 6} />
                                  </div>
                                )}
                              </>
                            )}
                            <div className="grid grid-cols-2 gap-2 mb-3">
                              <div><label className="block text-[8px] text-gray-500 uppercase mb-1">版本</label><DropdownSelect compact options={[{ value: '3.0', label: '3.0' }, { value: '3.1', label: '3.1' }]} value={generate3DModel} onChange={v => setGenerate3DModel(v as '3.0' | '3.1')} /></div>
                              <div><label className="block text-[8px] text-gray-500 uppercase mb-1">类型</label><DropdownSelect compact options={[{ value: 'Normal', label: '带纹理' }, { value: 'LowPoly', label: '智能拓扑' }, { value: 'Geometry', label: '白模' }, { value: 'Sketch', label: '草图' }]} value={generate3DType} onChange={v => setGenerate3DType(v as typeof generate3DType)} /></div>
                              <div><label className="block text-[8px] text-gray-500 uppercase mb-1">面数</label><input type="number" min={3000} max={1500000} step={10000} value={generate3DFaceCount} onChange={e => setGenerate3DFaceCount(Number(e.target.value) || 100000)} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] outline-none focus:border-blue-500" /></div>
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
                            <textarea value={rapidPrompt} onChange={e => setRapidPrompt(e.target.value)} placeholder="文本描述（与下图二选一）" rows={2} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none mb-3" />
                            <div className="flex gap-2 mb-3">
                              {!rapidImage ? <label className="flex-1 h-14 border border-dashed border-white/10 rounded-xl flex items-center justify-center cursor-pointer text-[9px] text-gray-500">上传图片<input type="file" className="hidden" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setRapidImage(r.result as string); r.readAsDataURL(f); } }} /></label> : <div className="relative flex-1"><img src={rapidImage} alt="" className="h-14 w-full object-cover rounded-xl border border-white/10" /><button type="button" onClick={() => setRapidImage(null)} className="absolute top-0 right-0 w-5 h-5 bg-red-500 rounded text-white text-xs">×</button></div>}
                              <div className="w-24 shrink-0"><DropdownSelect compact options={[{ value: 'FBX', label: 'FBX' }, { value: 'OBJ', label: 'OBJ' }, { value: 'GLB', label: 'GLB' }, { value: 'STL', label: 'STL' }, { value: 'USDZ', label: 'USDZ' }, { value: 'MP4', label: 'MP4' }]} value={rapidResultFormat} onChange={setRapidResultFormat} /></div>
                            </div>
                            <label className="flex items-center gap-2 text-[10px] mb-3"><input type="checkbox" checked={rapidEnablePBR} onChange={e => setRapidEnablePBR(e.target.checked)} className="rounded" />PBR</label>
                            <button onClick={handleRapid3D} disabled={!rapidPrompt.trim() && !rapidImage} className="w-full py-2.5 bg-indigo-600 rounded-xl text-[10px] font-black uppercase disabled:opacity-40">提交（入队）</button>
                          </>
                        )}
                        {generate3DModule === 'topology' && (
                          <>
                            <p className="text-[9px] text-gray-500 mb-3">Polygon 1.5：输入 3D 高模 URL，生成布线规整、较低面数模型。</p>
                            <input value={topologyFileUrl} onChange={e => setTopologyFileUrl(e.target.value)} placeholder="3D 高模文件 URL（如 GLB/FBX）" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 mb-3" />
                            <button onClick={handleTopology3D} disabled={!topologyFileUrl.trim()} className="w-full py-2.5 bg-indigo-600 rounded-xl text-[10px] font-black uppercase disabled:opacity-40">提交（入队）</button>
                          </>
                        )}
                        {generate3DModule === 'texture' && (
                          <>
                            <p className="text-[9px] text-gray-500 mb-3">输入单几何模型 URL（必填）+ 参考图或文字描述二选一，生成纹理贴图。</p>
                            <input value={textureModelUrl} onChange={e => setTextureModelUrl(e.target.value)} placeholder="单几何模型 URL（必填）" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 mb-2" />
                            <textarea value={texturePrompt} onChange={e => setTexturePrompt(e.target.value)} placeholder="文字描述（与参考图二选一）" rows={1} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none mb-2" />
                            <div className="mb-3">{!textureRefImage ? <label className="block h-14 border border-dashed border-white/10 rounded-xl flex items-center justify-center cursor-pointer text-[9px] text-gray-500">上传参考图（与描述二选一）<input type="file" className="hidden" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setTextureRefImage(r.result as string); r.readAsDataURL(f); } }} /></label> : <div className="relative inline-block"><img src={textureRefImage} alt="" className="max-h-14 rounded-xl border border-white/10" /><button onClick={() => setTextureRefImage(null)} className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded text-white text-xs">×</button></div>}</div>
                            <button onClick={handleTexture3D} disabled={!textureModelUrl.trim() || (!texturePrompt.trim() && !textureRefImage)} className="w-full py-2.5 bg-indigo-600 rounded-xl text-[10px] font-black uppercase disabled:opacity-40">提交（入队）</button>
                          </>
                        )}
                        {generate3DModule === 'component' && (
                          <>
                            <p className="text-[9px] text-gray-500 mb-3">输入 3D 模型，自动识别结构并生成对应 3D 组件。</p>
                            <input value={componentFileUrl} onChange={e => setComponentFileUrl(e.target.value)} placeholder="3D 模型 URL（建议 FBX，≤100MB）" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 mb-3" />
                            <button onClick={handleComponent3D} disabled={!componentFileUrl.trim()} className="w-full py-2.5 bg-indigo-600 rounded-xl text-[10px] font-black uppercase disabled:opacity-40">提交（入队）</button>
                          </>
                        )}
                        {generate3DModule === 'uv' && (
                          <>
                            <p className="text-[9px] text-gray-500 mb-3">输入 3D 模型，自动生成高质量 UV 切线。</p>
                            <input value={uvFileUrl} onChange={e => setUvFileUrl(e.target.value)} placeholder="3D 模型 URL" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 mb-3" />
                            <button onClick={handleUV3D} disabled={!uvFileUrl.trim()} className="w-full py-2.5 bg-indigo-600 rounded-xl text-[10px] font-black uppercase disabled:opacity-40">提交（入队）</button>
                          </>
                        )}
                        {generate3DModule === 'profile' && (
                          <>
                            <p className="text-[9px] text-gray-500 mb-3">输入人物头像，按模板生成对应 3D 形象。</p>
                            {!profileImage ? (
                              <label className="block h-24 border-2 border-dashed border-white/10 rounded-xl flex items-center justify-center cursor-pointer hover:bg-white/5 text-[9px] text-gray-500 mb-3">点击上传人物头像<input type="file" className="hidden" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setProfileImage(r.result as string); r.readAsDataURL(f); } }} /></label>
                            ) : (
                              <div className="relative inline-block mb-3"><img src={profileImage} alt="头像" className="max-h-24 rounded-xl border border-white/10" /><button onClick={() => setProfileImage(null)} className="absolute top-1 right-1 w-6 h-6 bg-red-500 rounded text-white text-xs">×</button></div>
                            )}
                            <button onClick={handleProfile3D} disabled={!profileImage} className="w-full py-2.5 bg-indigo-600 rounded-xl text-[10px] font-black uppercase disabled:opacity-40">提交（入队）</button>
                          </>
                        )}
                        {generate3DModule === 'convert' && (
                          <>
                            <p className="text-[9px] text-gray-500 mb-3">输入 3D 模型 URL，转换为目标格式。</p>
                            <input value={convertFileUrl} onChange={e => setConvertFileUrl(e.target.value)} placeholder="3D 文件 URL（fbx/obj/glb 等）" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 mb-2" />
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
                <div className="flex-1 min-w-0 flex flex-col rounded-2xl border border-white/10 bg-black/60 overflow-hidden">
                  <div className="px-3 py-2 text-[9px] font-black uppercase text-gray-500 border-b border-white/10">3D 预览 · 支持 OBJ/GLB，生成后自动显示，可点击右侧临时库切换</div>
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
                <div className="w-64 lg:w-72 shrink-0 flex flex-col rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
                  <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase text-blue-400">临时库</span>
                    <span className="text-[9px] text-gray-500">队列 {generate3DQueue.length}（{generate3DQueue.filter(q => q.status === 'running').length} 运行中）</span>
                  </div>
                  <div className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-2">
                    {generate3DQueue.length > 0 && (
                      <div className="rounded-xl border border-white/10 bg-white/5 p-2 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[8px] font-black uppercase text-gray-400">任务队列</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[8px] text-gray-500">{generate3DQueue.filter(q => q.status === 'pending' || q.status === 'running').length} 活跃</span>
                            {generate3DQueue.some(q => q.status !== 'pending' && q.status !== 'running') && (
                              <button
                                onClick={clearInactiveQueueItems}
                                className="px-1.5 py-1 rounded-md border border-white/10 text-[8px] font-black uppercase text-gray-400 hover:bg-white/10"
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
                              ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                              : item.status === 'pending'
                                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                : item.status === 'done'
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                  : item.status === 'cancelled'
                                    ? 'bg-gray-500/15 text-gray-300 border-gray-500/30'
                                    : 'bg-red-500/15 text-red-300 border-red-500/30';
                            return (
                              <div key={item.id} className="rounded-xl border border-white/10 bg-black/30 p-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-[10px] font-black truncate">{item.label || item.type}</div>
                                    <div className="text-[8px] text-gray-500 uppercase mt-1">{item.type}</div>
                                  </div>
                                  <span className={`shrink-0 px-1.5 py-0.5 rounded-md border text-[8px] font-black uppercase ${statusClass}`}>{statusText}</span>
                                </div>
                                {typeof item.progress === 'number' && item.status === 'running' && (
                                  <div className="mt-2">
                                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
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
                                      className="flex-1 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-[9px] font-black uppercase text-red-300 hover:bg-red-500/15"
                                    >
                                      取消任务
                                    </button>
                                  )}
                                  {(item.status === 'fail' || item.status === 'cancelled') && (
                                    <button
                                      onClick={() => retryQueueItem(item.id)}
                                      className="flex-1 py-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 text-[9px] font-black uppercase text-blue-300 hover:bg-blue-500/15"
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
                          className={`rounded-xl border overflow-hidden cursor-pointer transition-colors ${selectedTemp3DId === item.id ? 'border-blue-500 bg-blue-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                        >
                          <div className="aspect-square relative">
                            {item.previewImageUrl ? <img src={item.previewImageUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-600 text-[10px]">无预览图</div>}
                            <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-black/70 text-gray-300">{item.source}</span>
                          </div>
                          <div className="p-2">
                            <div className="text-[10px] font-black truncate">{item.label}</div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.files.map((f, i) => f.Url && <a key={i} href={f.Url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[8px] text-blue-400 hover:underline">{f.Type || '下载'}</a>)}
                            </div>
                            <button onClick={e => { e.stopPropagation(); handleSave3DToLibrary(item); }} className="mt-2 w-full py-1.5 rounded-lg bg-blue-600/80 text-[9px] font-black uppercase hover:bg-blue-600">保存到资产库</button>
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
                      className="w-9 h-9 shrink-0 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center text-lg font-bold text-white/80 hover:bg-white/20 transition-colors"
                      title="新对话"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto no-scrollbar space-y-2 pr-1">
                    {(() => {
                      const RECENT_MS = 24 * 60 * 60 * 1000;
                      const now = Date.now();
                      const recent = dialogSessions.filter(s => !s.archived && (now - s.updatedAt) < RECENT_MS);
                      const older = dialogSessions.filter(s => !s.archived && (now - s.updatedAt) >= RECENT_MS);
                      const archived = dialogSessions.filter(s => s.archived);
                      const renderSession = (s: DialogSession, showArchive: boolean) => {
                        const lastImg = [...s.messages].reverse().find(m => m.role === 'assistant' && (m.versions?.length ? m.versions[m.versions.length - 1]?.resultImageBase64 : m.resultImageBase64));
                        const thumb = lastImg?.versions?.length ? lastImg.versions[lastImg.versions.length - 1]?.resultImageBase64 : lastImg?.resultImageBase64;
                        const isActive = s.id === dialogActiveSessionIdResolved;
                        const label = s.title || (s.messages.length === 0 ? '新对话' : `对话${s.messages.length}`);
                        return (
                          <div key={s.id} className="relative group">
                            <button
                              onClick={() => setDialogActiveSessionId(s.id)}
                              className={`w-full flex items-center gap-3 px-3 py-2 rounded-2xl border transition-all pr-16 ${isActive ? 'bg-blue-600/15 border-blue-500/40' : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'}`}
                              title={label}
                            >
                              <div className="w-11 h-11 shrink-0 rounded-xl overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center">
                                {thumb ? <img src={thumb} className="w-full h-full object-cover" alt="" /> : <span className="text-[10px] text-gray-500">新</span>}
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
                                  className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] text-gray-500 hover:text-amber-400 hover:bg-white/10 transition-colors"
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
                                className="w-7 h-7 rounded-xl flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
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
                      <span className="text-4xl mb-4">💬</span>
                      <span className="text-[10px] font-black uppercase tracking-widest">描述画面生成图片，或上传图片后描述修改</span>
                      <span className="text-[9px] mt-2 text-gray-600">仅输入文字即可生图；有图时可改图，无图时可与 AI 文字对话</span>
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
                    return (
                      <div key={msg.id} id={`msg-${msg.id}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] lg:max-w-[75%] rounded-2xl overflow-hidden ${msg.role === 'user' ? 'bg-blue-600/20 border border-blue-500/30' : 'bg-white/5 border border-white/10'}`}>
                          {msg.role === 'user' && (msg.inputImages?.length || msg.imageBase64) && (
                            <div className="p-2 border-b border-white/10">
                              <div className={`grid gap-2 ${msg.inputImages && msg.inputImages.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                {(msg.inputImages && msg.inputImages.length > 0 ? msg.inputImages : msg.imageBase64 ? [msg.imageBase64] : []).map((image, imageIndex) => (
                                  <img key={`${msg.id}-${imageIndex}`} src={image} className="max-h-48 rounded-xl object-contain mx-auto" alt="上传" />
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="px-4 py-3 text-[11px] leading-relaxed">{msg.text}</div>
                          {msg.role === 'assistant' && msg.understoodPrompt && !displayVersion && !msg.versions?.length && !msg.resultImageBase64 && !isEditingThis && (
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
                                <div className="px-4 pb-2 text-[9px] text-blue-400/80 border-b border-white/5">理解指令: {displayVersion.understoodPrompt}</div>
                              )}
                              {versions.length > 1 && (
                                <div className="px-4 py-2 flex items-center gap-2 border-b border-white/5">
                                  <span className="text-[9px] font-black text-gray-500 uppercase">历史版本</span>
                                  <button onClick={() => showPreviousDialogVersion(msg)} disabled={versionIndex <= 0} className="px-2 py-1 rounded-lg bg-white/5 text-[9px] font-black disabled:opacity-30">上一版</button>
                                  <span className="text-[9px] text-gray-400">{(versionIndex + 1)} / {versions.length}</span>
                                  <button onClick={() => showNextDialogVersion(msg)} disabled={versionIndex >= versions.length - 1} className="px-2 py-1 rounded-lg bg-white/5 text-[9px] font-black disabled:opacity-30">下一版</button>
                                </div>
                              )}
                              {(displayVersion.width != null || displayVersion.height != null) && (
                                <div className="px-4 py-1.5 text-[9px] text-gray-500 border-b border-white/5 flex flex-wrap gap-3">
                                  {displayVersion.width != null && displayVersion.height != null && <span>分辨率 {displayVersion.width} × {displayVersion.height}</span>}
                                  {aspectRatioLabel && <span>宽高比 {aspectRatioLabel}</span>}
                                  <span>{new Date(displayVersion.timestamp).toLocaleString()}</span>
                                </div>
                              )}
                              <div className="p-4 relative">
                                {isRegeneratingThis && (
                                  <div className="absolute inset-0 bg-black/60 rounded-xl flex flex-col items-center justify-center gap-3 z-10">
                                    <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                                    <button onClick={handleDialogCancelGen} className="px-3 py-2 rounded-xl bg-red-600/50 border border-red-500/50 text-[9px] font-black text-red-300 hover:bg-red-600/70 transition-colors">停止</button>
                                  </div>
                                )}
                                {dialogDetectMessageId === msg.id && (displayVersion.detectedBoxes?.length ?? 0) > 0 ? (
                                  <div className="relative inline-block max-w-full">
                                    <img src={displayVersion.resultImageBase64} className="max-w-full rounded-xl border border-white/10" alt="生成" />
                                    <div className="absolute inset-0 pointer-events-none">
                                      {(displayVersion.detectedBoxes ?? []).map((box, i) => (
                                        <div key={box.id} className="absolute border-2 border-blue-500 bg-blue-500/20" style={{ left: `${box.xmin / 10}%`, top: `${box.ymin / 10}%`, width: `${(box.xmax - box.xmin) / 10}%`, height: `${(box.ymax - box.ymin) / 10}%` }}>
                                          <span className="absolute -top-7 left-0 min-w-[24px] h-6 px-1.5 rounded flex items-center justify-center text-xs font-black bg-blue-600 text-white shadow-lg">{DIALOG_BOX_LABELS[i] ?? i + 1}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <img src={displayVersion.resultImageBase64} className="max-w-full rounded-xl border border-white/10" alt="生成" />
                                )}
                              </div>
                              {dialogDetectMessageId === msg.id && (displayVersion.detectedBoxes?.length ?? 0) > 0 && (
                                <div className="px-4 pb-3 space-y-2 border-b border-white/10">
                                  <div className="text-[9px] font-black text-blue-400 uppercase">点击数字下载该物体（带边距）· 可添加到右侧临时库</div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {(displayVersion.detectedBoxes ?? []).map((_, i) => (
                                      <button key={i} onClick={() => handleDialogDownloadCropByIndex(msg, i)} className="w-9 h-9 rounded-xl bg-blue-600/30 border border-blue-500/50 text-sm font-black hover:bg-blue-600/50 transition-all flex items-center justify-center" title={`下载 ${DIALOG_BOX_LABELS[i] ?? i + 1}`}>{DIALOG_BOX_LABELS[i] ?? i + 1}</button>
                                    ))}
                                    <button onClick={() => handleDialogDownloadAllCrops(msg)} className="px-3 py-2 bg-blue-600 rounded-xl text-[9px] font-black uppercase text-white hover:bg-blue-500 transition-all">下载全部</button>
                                    <button onClick={() => handleDialogTempAddAllCrops(msg)} className="px-3 py-2 bg-white/10 border border-white/10 rounded-xl text-[9px] font-black uppercase hover:bg-white/20 transition-all">全部加临时库</button>
                                    <button onClick={() => handleDialogDetectObjects(msg, true)} disabled={dialogDetectingId === msg.id} className="px-3 py-2 bg-white/10 border border-white/10 rounded-xl text-[9px] font-black uppercase hover:bg-white/20 transition-all disabled:opacity-50">重新识别</button>
                                    <button onClick={handleDialogDetectClose} className="px-3 py-2 text-gray-500 text-[9px] font-black uppercase hover:text-white transition-colors">收起</button>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {(displayVersion.detectedBoxes ?? []).map((_, i) => (
                                      <button key={i} onClick={() => handleDialogTempAddCropByIndex(msg, i)} className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-[9px] font-black hover:bg-white/10 transition-all" title={`${DIALOG_BOX_LABELS[i] ?? i + 1} 加到临时库`}>+{DIALOG_BOX_LABELS[i] ?? i + 1}</button>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div className="px-4 pb-4 flex flex-wrap gap-2">
                                <button onClick={() => handleDialogDownload(msg)} className="px-3 py-2 bg-blue-600/20 border border-blue-500/30 rounded-xl text-[9px] font-black uppercase text-blue-400 hover:bg-blue-600/30 transition-all">下载图片</button>
                                <button onClick={() => displayVersion?.resultImageBase64 && handleCopyDialogImage(displayVersion.resultImageBase64)} className="px-3 py-2 bg-white/10 border border-white/10 rounded-xl text-[9px] font-black uppercase hover:bg-white/20 transition-all">复制图片</button>
                                <button onClick={() => displayVersion?.resultImageBase64 && openDialogCrop(msg.id, displayVersion.resultImageBase64)} className="px-3 py-2 bg-white/10 border border-white/10 rounded-xl text-[9px] font-black uppercase hover:bg-white/20 transition-all">裁切</button>
                                <button onClick={() => handleDialogUseAsInput(msg)} className="px-3 py-2 bg-green-600/20 border border-green-500/30 rounded-xl text-[9px] font-black uppercase text-green-400 hover:bg-green-600/30 transition-all">以此图继续</button>
                                <button onClick={() => handleDialogDetectObjects(msg)} disabled={dialogDetectingId === msg.id} className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-[9px] font-black uppercase hover:bg-white/10 transition-all disabled:opacity-50">{dialogDetectingId === msg.id ? '识别中...' : '识别图中物体'}</button>
                                <button onClick={() => handleDialogSaveToLibrary(msg)} className="px-3 py-2 bg-blue-600/20 border border-blue-500/30 rounded-xl text-[9px] font-black uppercase text-blue-400 hover:bg-blue-600/30 transition-all">保存到库</button>
                                <button onClick={() => handleDialogRegenerate(msg.id)} disabled={isRegeneratingThis || !userMsg} className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-[9px] font-black uppercase hover:bg-white/10 transition-all disabled:opacity-50">直接重新生成</button>
                                <button onClick={() => { setDialogEditingMessageId(msg.id); setDialogEditingText(userMsg?.role === 'user' ? userMsg.text : ''); }} disabled={isRegeneratingThis} className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-[9px] font-black uppercase hover:bg-white/10 transition-all disabled:opacity-50">编辑后重新生成</button>
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
                                        className={`w-7 h-7 rounded border flex items-center justify-center text-[11px] transition-all ${(currentScore ?? 0) >= score ? 'border-amber-500/50 bg-amber-500/20 text-amber-400' : 'border-white/20 bg-white/5 hover:bg-amber-500/20 hover:border-amber-500/40 text-gray-500'}`}
                                        title={`${score} 星`}
                                      >★</button>
                                    ))}
                                    {currentScore != null && <span className="text-[9px] text-gray-500">{currentScore} 星</span>}
                                  </div>
                                );
                              })()}
                            </>
                          )}
                          {msg.role === 'assistant' && isEditingThis && (
                            <div className="p-4 border-t border-white/10 space-y-3">
                              <input value={dialogEditingText} onChange={e => setDialogEditingText(e.target.value)} placeholder="修改你的需求描述..." className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[11px] outline-none focus:border-blue-500" />
                              <div className="flex gap-2">
                                <button onClick={() => handleDialogEditThenRegenerate(msg.id, dialogEditingText)} disabled={!dialogEditingText.trim()} className="px-4 py-2 bg-blue-600 rounded-xl text-[9px] font-black uppercase disabled:opacity-50">确认重新生成</button>
                                <button onClick={() => setDialogEditingMessageId(null)} className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[9px] font-black uppercase">取消</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {dialogSendingSessionIds.includes(dialogActiveSessionIdResolved) && (
                    <div className="flex justify-start items-center gap-2">
                      <div className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-[10px] text-gray-400 flex items-center gap-2">
                        <div className="w-3 h-3 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                        理解需求 → 生图中...
                      </div>
                      <button onClick={handleDialogCancelGen} className="px-3 py-2 rounded-xl bg-red-600/30 border border-red-500/40 text-[9px] font-black text-red-400 hover:bg-red-600/50 transition-colors">停止</button>
                    </div>
                  )}
                  <div ref={dialogEndRef} />
                  </div>
                  {/* 输入区：支持粘贴图片；模式切换 + 可收起的详细设置 + 文案 + 发送 */}
                  <div className="glass rounded-[2rem] p-4 lg:p-6 border border-white/5 shrink-0 space-y-4" onPaste={handleDialogPaste}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[9px] font-black text-gray-500 uppercase">开启生图</span>
                    <button type="button" role="switch" aria-checked={dialogAutoGenerateImage} onClick={() => setDialogAutoGenerateImage(p => !p)} className={`relative w-11 h-6 rounded-full transition-colors ${dialogAutoGenerateImage ? 'bg-blue-600' : 'bg-white/10'}`}>
                      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${dialogAutoGenerateImage ? 'left-6' : 'left-1'}`} />
                    </button>
                    <span className="text-[9px] font-black text-gray-500 uppercase">挡位</span>
                    <div className="flex rounded-lg overflow-hidden border border-white/10">
                      {DIALOG_IMAGE_GEARS.map(g => (
                        <button key={g.id} type="button" onClick={() => { setDialogImageGear(g.id); setDialogModel(g.modelId); }} className={`px-3 py-2 text-[9px] font-black uppercase transition-colors ${dialogImageGear === g.id ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-500 hover:bg-white/10'}`} title={g.modelId}>{g.label}</button>
                      ))}
                    </div>
                    <button onClick={() => setDialogOptionsExpanded(p => !p)} className="px-3 py-2 rounded-xl text-[9px] font-black uppercase border border-white/10 bg-white/5 hover:bg-white/10 transition-all">
                      {dialogOptionsExpanded ? '详细设置 ▲' : '详细设置 ▼'}
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[9px] font-black uppercase hover:bg-white/10 transition-all">
                        <span>🖼️</span> 上传图片
                          <input type="file" className="hidden" accept="image/*" onChange={e => { handleFileUpload(e, (b) => { setDialogInputImages(prev => prev.length >= DIALOG_INPUT_IMAGES_MAX ? prev : [...prev, { id: Math.random().toString(36).slice(2, 11), data: b }]); setDialogValidationError(null); }); }} />
                        </label>
                        {dialogInputImages.map((img, i) => (
                          <div key={img.id} className="relative inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 overflow-hidden">
                            <span className="pl-2 text-[8px] font-black text-gray-500">图{i + 1}</span>
                            <img src={img.data} className="h-12 w-12 object-cover" alt={`图${i + 1}`} />
                            <button type="button" onClick={() => setDialogInputImages(prev => prev.filter(x => x.id !== img.id))} className="p-1 text-red-400 hover:bg-red-500/20 rounded text-[10px] leading-none">×</button>
                          </div>
                        ))}
                      </div>
                    <span className="text-[9px] text-gray-500">可添加多张图片（最多 {DIALOG_INPUT_IMAGES_MAX} 张），输入 @ 弹出选择图片；点击临时库图片直接加入输入框 · Ctrl+V 粘贴 · 无图时直接输入即文字对话</span>
                  </div>
                  {dialogOptionsExpanded && (
                    <>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="space-y-2 relative">
                          <div className="text-[9px] font-black text-gray-500 uppercase">生图模型</div>
                          <div className="relative">
                            <button type="button" onClick={() => setDialogModelDropdownOpen(p => !p)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[11px] text-left flex items-center justify-between outline-none focus:border-blue-500 hover:bg-white/10 transition-colors">
                              <span>{DIALOG_IMAGE_MODELS.find(m => m.id === dialogModel)?.label ?? dialogModel}</span>
                              <span className="text-gray-500">{dialogModelDropdownOpen ? '▲' : '▼'}</span>
                            </button>
                            {dialogModelDropdownOpen && (
                              <>
                                <div className="fixed inset-0 z-[1002]" aria-hidden onClick={() => setDialogModelDropdownOpen(false)} />
                                <ul className="absolute top-full left-0 right-0 mt-1 z-[1003] max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-[#0f0f0f] shadow-xl py-1 text-white" style={{ color: '#fff' }}>
                                  {DIALOG_IMAGE_MODELS.map(m => (
                                    <li key={m.id}>
                                      <button type="button" onClick={() => { setDialogModel(m.id); setDialogModelDropdownOpen(false); const gear = DIALOG_IMAGE_GEARS.find(g => g.modelId === m.id); if (gear) setDialogImageGear(gear.id); }} className={`w-full px-4 py-3 text-left text-[11px] transition-colors ${dialogModel === m.id ? 'bg-blue-600/30 text-blue-300' : 'text-white hover:bg-white/10'}`}>
                                        {m.label}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="text-[9px] font-black text-gray-500 uppercase">输出尺寸</div>
                          <div className="flex gap-2">
                            <button onClick={() => setDialogSizeMode('adaptive')} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase border transition-all ${dialogSizeMode === 'adaptive' ? 'bg-blue-600 border-blue-500' : 'bg-white/5 border-white/10 text-gray-500'}`}>比例自适应</button>
                            <button onClick={() => setDialogSizeMode('manual')} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase border transition-all ${dialogSizeMode === 'manual' ? 'bg-blue-600 border-blue-500' : 'bg-white/5 border-white/10 text-gray-500'}`}>手动选择</button>
                          </div>
                          {dialogSizeMode === 'manual' && (
                            <div className="flex gap-2 mt-2">
                              <select value={dialogAspectRatio} onChange={e => setDialogAspectRatio(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 transition-colors">
                                {SUPPORTED_ASPECT_RATIOS.map(r => (<option key={r.value} value={r.value}>{r.label}</option>))}
                              </select>
                              <select value={dialogImageSize} onChange={e => setDialogImageSize(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 transition-colors">
                                {SUPPORTED_IMAGE_SIZES.map(s => (<option key={s.value} value={s.value}>{s.label}</option>))}
                              </select>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                  {dialogValidationError && (
                    <div className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2 flex items-center gap-2">
                      <span className="shrink-0">⚠</span>
                      <span>{dialogValidationError}</span>
                      <button type="button" onClick={() => setDialogValidationError(null)} className="ml-auto shrink-0 text-amber-400/80 hover:text-amber-300">×</button>
                    </div>
                  )}
                  <div ref={dialogInputWrapperRef} className="flex gap-3 relative">
                    <div className="flex-1 relative">
                      <input
                        ref={dialogInputRef}
                        value={dialogInputText}
                        onChange={e => {
                          const target = e.target as HTMLInputElement;
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
                          if (e.key === 'Enter' && !e.shiftKey) handleDialogSend();
                        }}
                        placeholder="输入 @ 选择图片或直接输入文字；有图时描述修改需求，无图时可描述画面生成图片或与 AI 文字对话"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-3 text-[11px] outline-none focus:border-blue-500 transition-colors placeholder:text-gray-600"
                      />
                      {atSuggestionsOpen && (dialogInputImages.length > 0 || dialogTempFiltered.length > 0) && (
                        <div className="absolute left-0 right-0 top-full mt-1 z-[1003] rounded-xl border border-white/10 bg-[#0f0f0f] shadow-xl py-1 max-h-48 overflow-y-auto">
                          {dialogInputImages.length > 0 && (
                            <div className="px-2 py-1 text-[8px] font-black text-gray-500 uppercase">输入框图片</div>
                          )}
                          {dialogInputImages.map((img, i) => {
                            const imageNumber = i + 1;
                            return (
                            <button key={img.id} type="button" onClick={() => { const newText = dialogInputText.slice(0, atSuggestionsCursor) + `@图${imageNumber} ` + dialogInputText.slice(atSuggestionsCursor + 1); setDialogInputText(newText); setAtSuggestionsOpen(false); dialogInputRef.current?.focus(); }} className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-white/10 rounded-lg">
                              <img src={img.data} className="w-8 h-8 rounded object-cover shrink-0" alt="" />
                              <span>图{imageNumber}</span>
                            </button>
                            );
                          })}
                          {dialogTempFiltered.length > 0 && (
                            <div className="px-2 py-1 text-[8px] font-black text-gray-500 uppercase mt-1 border-t border-white/5">临时库（点击加入输入框并插入 @）</div>
                          )}
                          {dialogTempFiltered.map((item, i) => (
                            <button key={item.id} type="button" onClick={() => { handleDialogTempAddToInput(item); const newIdx = dialogInputImages.length + 1; const newText = dialogInputText.slice(0, atSuggestionsCursor) + `@图${newIdx} ` + dialogInputText.slice(atSuggestionsCursor + 1); setDialogInputText(newText); setAtSuggestionsOpen(false); dialogInputRef.current?.focus(); }} className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-white/10 rounded-lg">
                              <img src={item.data} className="w-8 h-8 rounded object-cover shrink-0" alt="" />
                              <span className="truncate">{item.label || `临时库 ${i + 1}`}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={handleDialogSend} disabled={dialogSendingSessionIds.includes(dialogActiveSessionIdResolved) || !dialogInputText.trim()} className="px-8 py-3 bg-blue-600 rounded-xl text-[10px] font-black uppercase electric-glow disabled:opacity-20 transition-all shrink-0">发送</button>
                  </div>
                  {/* 批量出图：同一描述/图+描述，生成多张 */}
                  <div className="mt-3 pt-3 border-t border-white/10 space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[9px] font-black text-gray-500 uppercase">批量出图</span>
                      <span className="text-[9px] text-gray-600">今日 {getBulkImageTodayRPD()} / {getBulkImageRPDLimit()} 次</span>
                      <span className="text-[9px] text-gray-600">
                        {getBulkImageMode() === 'backend' ? '模式：公司后端（统一配额）' : '模式：本机（每台设备各自配额）'}
                      </span>
                      <input type="number" min={1} max={getBulkImageMaxImagesPerJob()} value={bulkImageCount} onChange={e => setBulkImageCount(Math.min(getBulkImageMaxImagesPerJob(), Math.max(1, parseInt(e.target.value, 10) || 1)))} className="w-14 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-center outline-none focus:border-blue-500" />
                      <span className="text-[9px] text-gray-500">张</span>
                      <button onClick={handleStartBulkImageJob} disabled={bulkImageSubmitting || !dialogInputText.trim()} className="px-3 py-1.5 rounded-lg bg-blue-600/60 text-[9px] font-black text-white hover:bg-blue-600 disabled:opacity-40 transition-colors">批量生成</button>
                    </div>
                    {imageJobsSnapshot.length > 0 && (
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {imageJobsSnapshot.map((job) => (
                          <div key={job.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px]">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-gray-400 truncate flex-1">{job.results.length}/{job.totalImages}</span>
                              <span className={`shrink-0 ${job.status === 'pending' ? 'text-gray-400' : job.status === 'running' ? 'text-blue-400' : job.status === 'completed' ? 'text-green-400' : job.status === 'partial' ? 'text-amber-400' : job.status === 'cancelled' ? 'text-gray-500' : 'text-red-400'}`}>{job.status === 'pending' ? '排队中' : job.status === 'running' ? '运行中' : job.status === 'completed' ? '完成' : job.status === 'partial' ? '部分完成' : job.status === 'cancelled' ? '已取消' : '失败'}</span>
                              {(job.status === 'running' || job.status === 'pending') && (
                                <button type="button" onClick={() => cancelImageJob(job.id)} className="shrink-0 px-2 py-0.5 rounded bg-red-500/20 text-red-300 text-[9px] font-black hover:bg-red-500/30">取消</button>
                              )}
                              {job.status === 'partial' && job.totalImages - job.results.length > 0 && (
                                <button type="button" onClick={async () => { try { await createImageJobContinue(job); } catch (e) { setDialogValidationError(e instanceof Error ? e.message : String(e)); } }} className="shrink-0 px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[9px] font-black hover:bg-amber-500/30">继续生成剩余 {job.totalImages - job.results.length} 张</button>
                              )}
                            </div>
                            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                              <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${(job.results.length / job.totalImages) * 100}%` }} />
                            </div>
                            {job.errorSummary && <p className="mt-1 text-amber-400/90 truncate" title={job.errorSummary}>{job.errorSummary}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                </div>

                {/* 右侧：临时库（生图与识别物体自动加入，可筛全部/当前对话，删会话会同步清理） */}
                <div className="w-52 lg:w-64 shrink-0 flex flex-col border border-white/10 rounded-2xl overflow-hidden bg-black/20 h-[calc(100dvh-6rem)]">
                  <div className="flex-shrink-0 px-3 py-2 border-b border-white/10 flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">临时库</span>
                    <div className="flex rounded-lg overflow-hidden border border-white/10">
                      <button onClick={() => setDialogTempLibraryFilter('all')} className={`px-2 py-1.5 text-[9px] font-black ${dialogTempLibraryFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-500 hover:bg-white/10'}`}>全部</button>
                      <button onClick={() => setDialogTempLibraryFilter('current')} className={`px-2 py-1.5 text-[9px] font-black ${dialogTempLibraryFilter === 'current' ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-500 hover:bg-white/10'}`}>当前</button>
                    </div>
                  </div>
                  {dialogTempFiltered.length > 0 && (
                    <div className="flex-shrink-0 px-2 py-1.5 border-b border-white/5 flex flex-wrap items-center gap-1.5">
                      <button onClick={handleDialogTempSelectAll} className="shrink-0 px-2 py-1 rounded bg-white/5 text-[8px] font-black text-gray-400 hover:bg-white/10 whitespace-nowrap">全选</button>
                      <button onClick={handleDialogTempInvertSelect} className="shrink-0 px-2 py-1 rounded bg-white/5 text-[8px] font-black text-gray-400 hover:bg-white/10 whitespace-nowrap">反选</button>
                      <button onClick={handleDialogTempBatchDownload} disabled={dialogTempSelectedIds.size === 0} className="shrink-0 px-2 py-1 rounded bg-blue-600/50 text-[8px] font-black text-white hover:bg-blue-600 disabled:opacity-40 whitespace-nowrap">批量下载{dialogTempSelectedIds.size > 0 ? `(${dialogTempSelectedIds.size})` : ''}</button>
                    </div>
                  )}
                  <div className="flex-1 overflow-y-auto no-scrollbar p-2 min-h-0">
                    {dialogTempFiltered.length === 0 ? (
                      <div className="flex items-center justify-center py-12 text-[9px] text-gray-500 px-4 text-center">生图、用户上传与识别物体会自动加入此处</div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {dialogTempFiltered.map(item => (
                          <div key={item.id} className="relative group rounded-xl overflow-hidden border border-white/10 bg-white/5 aspect-square">
                            <input type="checkbox" checked={dialogTempSelectedIds.has(item.id)} onChange={() => handleDialogTempToggleSelect(item.id)} onClick={e => e.stopPropagation()} className="absolute top-1 left-1 z-10 w-4 h-4 rounded border-white/30 bg-black/50 accent-blue-500" title="选择" />
                            <img src={item.data} className="w-full h-full object-cover cursor-pointer" alt="" onClick={() => handleDialogTempAddToInput(item)} title="点击加入输入框" />
                            {item.label && <span className="absolute bottom-0 left-0 right-0 py-0.5 text-center text-[9px] font-black bg-black/60 text-white truncate">{item.label}</span>}
                            <div className="absolute inset-0 bg-black/50 group-hover:opacity-100 opacity-0 transition-opacity flex flex-col items-stretch justify-start gap-0.5 p-1 overflow-y-auto overflow-x-hidden min-h-0">
                              <button onClick={(e) => { e.stopPropagation(); setDialogTempPreviewId(item.id); }} className="shrink-0 w-full px-2 py-1 rounded-lg bg-black/70 text-[9px] font-black text-white hover:bg-white/20 transition-colors text-left" title="查看大图及详情">查看大图</button>
                              {item.sourceMessageId && (
                                <button onClick={(e) => { e.stopPropagation(); handleDialogTempLocateMessage(item); setDialogTempPreviewId(null); }} className="shrink-0 w-full px-2 py-1 rounded-lg bg-black/70 text-[9px] font-black text-white hover:bg-blue-600/80 transition-colors text-left">定位消息</button>
                              )}
                              <button onClick={(e) => { e.stopPropagation(); handleDialogTempAddToInput(item); setDialogTempPreviewId(null); }} className="shrink-0 w-full px-2 py-1 rounded-lg bg-black/70 text-[9px] font-black text-white hover:bg-green-600/80 transition-colors text-left">加入输入框</button>
                              <button onClick={(e) => { e.stopPropagation(); addDialogTempToLibrary(item); }} className="shrink-0 w-full px-2 py-1 rounded-lg bg-black/70 text-[9px] font-black text-white hover:bg-blue-600/80 transition-colors text-left">加入资产库</button>
                              <a href={item.data} download={`临时库_${item.label || item.id}.png`} onClick={e => e.stopPropagation()} className="shrink-0 w-full px-2 py-1 rounded-lg bg-black/70 text-[9px] font-black text-white hover:bg-white/20 text-center transition-colors block">下载</a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {dialogTempPreviewId && (() => {
                const item = dialogTempLibrary.find(x => x.id === dialogTempPreviewId);
                if (!item) return null;
                return (
                  <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/90 backdrop-blur-sm animate-in fade-in p-4" onClick={() => setDialogTempPreviewId(null)}>
                    <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3 overflow-y-auto" onClick={e => e.stopPropagation()}>
                      <img src={item.data} className="max-w-full max-h-[60vh] object-contain rounded-xl shadow-2xl" alt="" />
                      <div className="w-full max-w-2xl rounded-xl bg-white/5 border border-white/10 p-4 space-y-2 text-left">
                        <div className="text-[9px] font-black text-gray-500 uppercase">类型</div>
                        <div className="text-[11px] text-white">{dialogTempSourceTypeLabel(item.sourceType)}{item.label ? ` · ${item.label}` : ''}</div>
                        {(item.userPrompt || item.understoodPrompt) && (
                          <>
                            {item.userPrompt && (
                              <>
                                <div className="text-[9px] font-black text-gray-500 uppercase mt-2">用户描述</div>
                                <div className="text-[11px] text-gray-300 break-words">{item.userPrompt}</div>
                              </>
                            )}
                            {item.understoodPrompt && (
                              <>
                                <div className="text-[9px] font-black text-gray-500 uppercase mt-2">理解指令</div>
                                <div className="text-[11px] text-blue-300/90 break-words">{item.understoodPrompt}</div>
                              </>
                            )}
                          </>
                        )}
                        <div className="text-[9px] text-gray-500 mt-2">{new Date(item.timestamp).toLocaleString()}</div>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {item.sourceMessageId && (
                          <button onClick={() => { handleDialogTempLocateMessage(item); setDialogTempPreviewId(null); }} className="px-4 py-2 rounded-xl bg-blue-600/80 text-[10px] font-black text-white hover:bg-blue-500 transition-colors">定位消息</button>
                        )}
                        <button onClick={() => { handleDialogTempAddToInput(item); setDialogTempPreviewId(null); }} className="px-4 py-2 rounded-xl bg-green-600/80 text-[10px] font-black text-white hover:bg-green-500 transition-colors">加入输入框</button>
                        <button onClick={() => addDialogTempToLibrary(item)} className="px-4 py-2 rounded-xl bg-blue-600/80 text-[10px] font-black text-white hover:bg-blue-500 transition-colors">加入资产库</button>
                        <a href={item.data} download={`临时库_${item.label || item.id}.png`} className="px-4 py-2 rounded-xl bg-white/10 text-[10px] font-black text-white hover:bg-white/20 transition-colors">下载</a>
                        <button onClick={() => setDialogTempPreviewId(null)} className="px-4 py-2 rounded-xl bg-black/60 text-[10px] font-black text-white hover:bg-black/80">关闭</button>
                      </div>
                    </div>
                  </div>
                );
              })()}
              </div>
            )}

            {/* 对话生图裁切编辑器：全屏选区，确认后作为新版本显示在对话中 */}
            {dialogCropState && (
              <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center bg-black/90 p-4">
                <div className="text-[10px] text-gray-400 mb-3">拖拽选择裁切区域，然后点击「确认裁切」</div>
                <div
                  className="inline-block max-w-full max-h-[70vh] relative cursor-crosshair select-none rounded-xl overflow-hidden border border-white/10"
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
                      className="absolute pointer-events-none border-2 border-blue-500 bg-blue-500/20"
                      style={{ position: 'fixed', left, top, width: w, height: h, zIndex: 2001 }}
                    />
                  );
                })()}
                <div className="flex items-center gap-3 mt-4">
                  <button onClick={handleDialogCropExecute} className="px-5 py-2.5 rounded-xl bg-blue-600 text-[10px] font-black text-white hover:bg-blue-500 transition-colors">确认裁切</button>
                  <button onClick={handleDialogCropCancel} className="px-5 py-2.5 rounded-xl bg-white/10 border border-white/20 text-[10px] font-black text-white hover:bg-white/20 transition-colors">取消</button>
                </div>
              </div>
            )}

            {mode === AppMode.LIBRARY && (
              <div className="flex flex-col lg:flex-row gap-10 animate-in fade-in">
                 <div className="w-full lg:w-48 shrink-0 flex flex-col gap-4">
                   <div className="flex flex-row lg:flex-col gap-2 overflow-x-auto no-scrollbar pb-2 lg:pb-0">
                     {(['ALL', 'SCENE_OBJECT', 'PREVIEW_STRIP', 'PRODUCTION_ASSET', 'MESH_MODEL', 'TEXTURE_MAP'] as const).map(cat => (
                       <button key={cat} onClick={() => setLibFilter(cat)} className={`px-6 py-3 rounded-xl text-[9px] font-black uppercase border transition-all whitespace-nowrap ${libFilter === cat ? 'bg-blue-600 border-blue-500 text-white' : 'bg-white/5 border-transparent text-gray-500 hover:bg-white/10'}`}>{LIBRARY_CATEGORY_LABELS[cat]}</button>
                     ))}
                   </div>
                   <p className="text-[9px] text-gray-500 uppercase tracking-widest">共 {groupedLibrary.length} 组</p>
                   <label className="px-4 py-2.5 rounded-xl bg-blue-600/20 border border-blue-500/40 text-[9px] font-black uppercase text-blue-300 cursor-pointer hover:bg-blue-600/30 text-center">
                     上传图片
                    <input type="file" className="hidden" accept="image/*" multiple onChange={(e: React.ChangeEvent<HTMLInputElement>) => { const input = e.currentTarget; const files: File[] = input.files ? Array.from(input.files) : []; files.filter((f) => f.type.startsWith('image/')).slice(0, 50).forEach((f) => { const r = new FileReader(); r.onload = () => addToLibrary([{ data: r.result as string, type: 'SLICE', category: 'SCENE_OBJECT', label: f.name.replace(/\.[^.]+$/, '') || '上传图片' }]); r.readAsDataURL(f); }); input.value = ''; }} />
                   </label>
                 </div>
                 <div className="flex-1 flex flex-col gap-4">
                   <div className="flex flex-wrap items-center gap-2">
                     <span className="text-[9px] font-black text-gray-500 uppercase">批量操作</span>
                     <button onClick={handleLibSelectAll} className="px-3 py-2 rounded-xl text-[9px] font-black uppercase border border-white/10 bg-white/5 hover:bg-white/10">全选</button>
                     <button onClick={handleLibInvertSelect} className="px-3 py-2 rounded-xl text-[9px] font-black uppercase border border-white/10 bg-white/5 hover:bg-white/10">反选</button>
                     <button onClick={handleLibBatchDownload} disabled={libSelectedGroupIds.size === 0} className="px-3 py-2 rounded-xl text-[9px] font-black uppercase border border-blue-500/50 bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 disabled:opacity-40 disabled:cursor-not-allowed">批量下载（{libSelectedGroupIds.size}）</button>
                   </div>
                   {groupedLibrary.length === 0 ? (
                     <div className="flex flex-col items-center justify-center py-20 text-center">
                       <span className="text-5xl mb-4 opacity-60">📦</span>
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
          )}
        </div>
      </main>

      {showBackToTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-[1000] w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-[14px] hover:bg-white/20 transition-all shadow-lg"
          title="回到顶部"
          aria-label="回到顶部"
        >
          ↑
        </button>
      )}
    </div>
  );
};

export default App;
