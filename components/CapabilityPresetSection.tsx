import React, { useState, useRef, useLayoutEffect, useMemo, useEffect, useCallback } from 'react';
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
import { loadInstalledPacks, loadPackHistory } from '../services/storePackHistory';
import { useStoreCatalog } from '../services/storeCatalogHook';
import { publishPresetToUserR2Catalog } from '../services/capabilityPresetR2Publish';
import { resolveCapabilityPreviewSrc } from '../services/capabilityPreviewUrl';
import { mergeCardAspectFromIntrinsic } from './workflow/workflowCardAspect';
import CapabilitySetCanvas from './CapabilitySetCanvas';
import { CapabilityPreviewImg } from './CapabilityPreviewImg';
import { CustomDropdown, DROPDOWN_TRIGGER_COMPACT } from './ui/CustomDropdown';
import AppIcon from './ui/AppIcon';

const CAPABILITY_SETS_VERSION = 1;

const DEFAULT_GENERATE_3D: Generate3DPreset = { module: 'pro', model: '3.0', enablePBR: false };

type ViewMode = 'presets' | 'image_process' | 'sets' | 'canvas';

const CapabilityPresetSection: React.FC<{
  presets: CustomAppModule[];
  onUpdate: (next: CustomAppModule[]) => void;
  sets?: CapabilitySet[];
  onUpdateSets?: (next: CapabilitySet[]) => void;
  onRunTest?: (preset: CustomAppModule, imageBase64: string) => Promise<CapabilityTestResult>;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
  embeddedInWorkflow?: boolean;
  canUploadToR2?: boolean;
  /** 工作区侧栏：挂到「仅卡片区域」的滚动容器，供外层接管滚动行为 */
  scrollContainerRef?: React.Ref<HTMLDivElement>;
}> = ({ presets, onUpdate, sets = [], onUpdateSets, onRunTest, onLog, embeddedInWorkflow = false, canUploadToR2 = false, scrollContainerRef }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('presets');
  const [canvasSet, setCanvasSet] = useState<CapabilitySet | null>(null);
  const [setLabel, setSetLabel] = useState('');
  const reindex = (list: CustomAppModule[]) => list.map((p, i) => ({ ...p, order: i }));
  const update = (list: CustomAppModule[]) => onUpdate(reindex(list));
  const getEngine = (p: CustomAppModule): CapabilityEngine => {
    if (p.engine) return p.engine;
    if (p.category === 'image_gen') return 'gen_image';
    return 'builtin';
  };
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
  const [editCategory, setEditCategory] = useState<CapabilityCategory>('image_gen');
  const [editEngine, setEditEngine] = useState<CapabilityEngine>('gen_image');
  const [editEnabled, setEditEnabled] = useState(true);
  const [editImageGear, setEditImageGear] = useState<DialogImageGear>('standard');
  const [editImageAspectRatio, setEditImageAspectRatio] = useState('');
  const [editImageSize, setEditImageSize] = useState('');
  const [editInstruction, setEditInstruction] = useState('');
  /** 仅编辑「切割图片」内置预设时使用 */
  const [editCutOverflowPx, setEditCutOverflowPx] = useState(0);
  const [editSkipUnderstand, setEditSkipUnderstand] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newCategory, setNewCategory] = useState<CapabilityCategory>('image_gen');
  const [newEngine, setNewEngine] = useState<CapabilityEngine>('gen_image');
  const [newEnabled, setNewEnabled] = useState(true);
  const [newImageGear, setNewImageGear] = useState<DialogImageGear>('standard');
  const [newImageAspectRatio, setNewImageAspectRatio] = useState('');
  const [newImageSize, setNewImageSize] = useState('');
  const [newInstruction, setNewInstruction] = useState('');
  const [newSkipUnderstand, setNewSkipUnderstand] = useState(false);
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
  const presetCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const setCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  /** 仅预设「内容区」滚动容器；定位时用 scrollTo 只滚此处，避免 scrollIntoView 连带滚主布局 */
  const presetContentScrollRef = useRef<HTMLDivElement | null>(null);
  const isBuiltinImageProcess = (p: CustomAppModule) =>
    p.category === 'image_process' &&
    BUILTIN_IMAGE_PROCESS_IDS.includes(p.id as (typeof BUILTIN_IMAGE_PROCESS_IDS)[number]);
  const isBuiltinLockedPreset = (p: CustomAppModule) =>
    isBuiltinImageProcess(p) && !BUILTIN_CAPABILITY_EDITABLE_IDS.includes(p.id);

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
  }, [effectiveUninstalledPresetItems, installPresets, triggerRemoteRefreshSync]);

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
    const onJumpToPreset = (event: Event) => {
      const detail = (event as CustomEvent<{ presetId?: string }>).detail;
      const id = detail?.presetId;
      if (!id) return;
      const preset = presets.find((p) => p.id === id);
      if (!preset) return;
      if (preset.category === 'image_process') {
        setViewMode('image_process');
      } else {
        setViewMode('presets');
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
          category: 'image_process',
          engine: 'builtin',
          instruction: editInstruction,
          enabled: editEnabled,
          cutOverflowPx: Math.max(0, Math.min(512, Math.round(Number(editCutOverflowPx) || 0))),
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
        const next: CustomAppModule = {
          ...p,
          label: editLabel,
          category: editCategory,
          instruction: editInstruction,
          skipUnderstand:
            editCategory === 'image_gen' || editEngine === 'gen_image'
              ? editSkipUnderstand
              : undefined,
          enabled: editEnabled,
          imageGear: editEngine === 'gen_image' || editCategory === 'image_gen' ? editImageGear : undefined,
          imageAspectRatio: editEngine === 'gen_image' || editCategory === 'image_gen' ? (editImageAspectRatio || undefined) : undefined,
          imageSize: editEngine === 'gen_image' || editCategory === 'image_gen' ? (editImageSize || undefined) : undefined,
          engine:
            editCategory === 'generate_3d'
              ? undefined
              : editCategory === 'image_gen'
                ? 'gen_image'
                : editEngine,
        };
        if (editCategory === 'generate_3d') {
          next.generate3D = { ...editGenerate3D };
          delete (next as CustomAppModule & { engine?: CapabilityEngine }).engine;
        } else {
          delete (next as CustomAppModule & { generate3D?: Generate3DPreset }).generate3D;
        }
        return next;
      })
    );
    setEditingId(null);
  };

  const addPreset = () => {
    const label = newLabel.trim() || '新功能';
    const id = genId();
    const preset: CustomAppModule = {
      id,
      label,
      category: newCategory,
      instruction: newInstruction,
      skipUnderstand:
        newCategory === 'image_gen' || newEngine === 'gen_image'
          ? newSkipUnderstand
          : undefined,
      enabled: newEnabled,
      order: presets.length,
      imageGear: (newCategory === 'image_gen' || newEngine === 'gen_image') ? newImageGear : undefined,
      imageAspectRatio: (newCategory === 'image_gen' || newEngine === 'gen_image') ? (newImageAspectRatio || undefined) : undefined,
      imageSize: (newCategory === 'image_gen' || newEngine === 'gen_image') ? (newImageSize || undefined) : undefined,
      engine:
        newCategory === 'generate_3d'
          ? undefined
          : newCategory === 'image_gen'
            ? 'gen_image'
            : newEngine,
    };
    if (newCategory === 'generate_3d') preset.generate3D = { ...newGenerate3D };
    update([...presets, preset]);
    setNewLabel('');
    setNewCategory('image_gen');
    setNewEngine('gen_image');
    setNewEnabled(true);
    setNewImageGear('standard');
    setNewImageAspectRatio('');
    setNewImageSize('');
    setNewInstruction('');
    setNewSkipUnderstand(false);
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
    const img = testImage[p.id];
    if (!img || !onRunTest) return;
    setTestRunning((prev) => ({ ...prev, [p.id]: true }));
    setTestResult((prev) => ({ ...prev, [p.id]: null }));
    onLog?.('info', `[${p.label}] 测试开始`, undefined);
    try {
      const result = await onRunTest(p, img);
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
  const getCardPreviewSrc = (p: CustomAppModule): string | null => {
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
  };
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
  const onPresetCardIntrinsicSize = useCallback((presetId: string, w: number, h: number) => {
    setCardAspectByPresetId((prev) => mergeCardAspectFromIntrinsic(prev, presetId, w, h) ?? prev);
  }, []);
  const openLightboxPreview = (p: CustomAppModule) => {
    const original = getOriginalPreviewSrc(p) || getOriginalPreviewThumbSrc(p);
    const generated = getGeneratedPreviewSrc(p) || getGeneratedPreviewThumbSrc(p);
    if (original && generated) {
      setLightboxImage(null);
      setLightboxSplitRatio(0.5);
      setLightboxCompare({ original, generated });
      return;
    }
    const src =
      getGeneratedPreviewSrc(p) ||
      getOriginalPreviewSrc(p) ||
      getGeneratedPreviewThumbSrc(p) ||
      getOriginalPreviewThumbSrc(p);
    if (!src) return;
    setLightboxCompare(null);
    setLightboxImage(src);
  };
  const openPresetDetail = (p: CustomAppModule) => {
    setDetailPresetId(p.id);
    setDetailEditMode(false);
    setEditingId(null);
  };
  const detailPreset = detailPresetId ? presets.find((x) => x.id === detailPresetId) ?? null : null;
  const beginDetailEdit = (p: CustomAppModule) => {
    if (isBuiltinLockedPreset(p)) return;
    if (p.id === 'cut_image') {
      setEditingId('cut_image');
      setEditLabel(p.label);
      setEditCategory('image_process');
      setEditEngine('builtin');
      setEditEnabled(p.enabled !== false);
      setEditInstruction(((p as { instructionFixed?: string }).instructionFixed ?? p.instruction) || '');
      setEditCutOverflowPx(
        typeof p.cutOverflowPx === 'number' && Number.isFinite(p.cutOverflowPx)
          ? Math.max(0, Math.min(512, Math.round(p.cutOverflowPx)))
          : 0
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
    setEditGenerate3D(p.category === 'generate_3d' && p.generate3D ? { ...p.generate3D } : { ...DEFAULT_GENERATE_3D });
    setDetailEditMode(true);
  };
  const saveDetailEdit = () => {
    if (!editingId) return;
    saveEdit();
    setDetailEditMode(false);
  };

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

  const openNewSet = () => {
    setCanvasSet(null);
    setSetLabel('新能力集合');
    setViewMode('canvas');
  };

  const openEditSet = (set: CapabilitySet) => {
    setCanvasSet(set);
    setSetLabel(set.label);
    setViewMode('canvas');
  };

  const closeCanvas = () => {
    setViewMode(viewMode === 'canvas' ? 'sets' : viewMode);
    setCanvasSet(null);
  };

  const handleSaveSet = (set: CapabilitySet) => {
    const next = sets.some((s) => s.id === set.id)
      ? sets.map((s) => (s.id === set.id ? set : s))
      : [...sets, set];
    onUpdateSets?.(next);
    onLog?.('info', `已保存能力集合：${set.label}`, undefined);
    closeCanvas();
  };

  const removeSet = (id: string) => {
    onUpdateSets?.(sets.filter((s) => s.id !== id));
  };

  /** 预设来源：presetId -> 包名（来自已安装包的为包名，否则为本地） */
  const presetSourceMap = useMemo(() => {
    const map = new Map<string, string>();
    const installed = loadInstalledPacks();
    for (const pack of installed) {
      const history = loadPackHistory(pack.id);
      const latest = history[0];
      if (latest?.presets) {
        for (const p of latest.presets) {
          map.set(p.id, pack.name);
        }
      }
    }
    return map;
  }, [presets]);
  const visiblePresets = useMemo(() => {
    if (viewMode === 'image_process') return presets.filter((p) => p.category === 'image_process');
    return presets.filter((p) => p.category !== 'image_process');
  }, [presets, viewMode]);

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

  if (viewMode === 'canvas') {
    return (
      <div className="flex flex-col h-[calc(100dvh-8rem)] min-h-[400px] animate-in fade-in">
        <div className="flex-1 min-h-0 rounded-2xl border border-[#2e2e32] overflow-hidden bg-white">
          <CapabilitySetCanvas
            presets={presets}
            initialSet={canvasSet}
            setLabel={setLabel}
            onSetLabelChange={setSetLabel}
            onSave={handleSaveSet}
            onClose={closeCanvas}
          />
        </div>
      </div>
    );
  }

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
        className={`flex flex-col gap-6 min-h-0 w-full max-w-4xl mx-auto overflow-y-auto no-scrollbar ${embeddedInWorkflow ? 'flex-1' : 'max-h-[calc(100dvh-12rem)]'}`}
      >
      {!embeddedInWorkflow && (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between w-full min-w-0">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
        <button
          type="button"
          onClick={() => setViewMode('presets')}
          className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase border ${viewMode === 'presets' ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300' : 'bg-[#1c1c22] border-[#2e2e32] text-gray-500 hover:bg-[#2e2e36]'}`}
        >
          基础能力预设
        </button>
        <button
          type="button"
          onClick={() => setViewMode('image_process')}
          className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase border ${viewMode === 'image_process' ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300' : 'bg-[#1c1c22] border-[#2e2e32] text-gray-500 hover:bg-[#2e2e36]'}`}
        >
          图像处理
        </button>
        <button
          type="button"
          onClick={() => setViewMode('sets')}
          className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase border ${viewMode === 'sets' ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300' : 'bg-[#1c1c22] border-[#2e2e32] text-gray-500 hover:bg-[#2e2e36]'}`}
        >
          能力集合
        </button>
        </div>
        <div className="flex items-center justify-end gap-2 flex-wrap w-full sm:w-auto sm:shrink-0 sm:ml-auto">
          <button
            type="button"
            onClick={() => {
              void triggerRemoteRefreshSync();
            }}
            disabled={catalogLoading || packContentsLoading || installingAll}
            className="px-4 py-2 rounded-xl bg-[#26262c] border border-[#2e2e32] text-[10px] font-black uppercase hover:bg-[#383842] disabled:opacity-50"
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
          <div className="flex items-center justify-between">
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
            <div className="rounded-2xl border border-[#2e2e32] bg-[#16161a] p-8 text-center text-gray-500 text-[10px]">
              暂无能力集合，点击「添加能力集合」进入画布拖拽连线。
            </div>
          ) : (
            <div className="grid gap-3">
              {sets.map((s) => (
                <div
                  key={s.id}
                  ref={(el) => {
                    setCardRefs.current[s.id] = el;
                  }}
                  className="rounded-2xl border border-[#2e2e32] bg-[#16161a] p-4 flex items-center justify-between"
                >
                  <span className="text-[11px] font-black uppercase">{s.label}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => openEditSet(s)} className="px-3 py-1.5 rounded-lg bg-[#26262c] text-[9px] font-black uppercase hover:bg-[#383842]">
                      编辑
                    </button>
                    <button type="button" onClick={() => removeSet(s.id)} className="px-3 py-1.5 rounded-lg bg-[#4a1c1c] text-red-400 text-[9px] font-black uppercase hover:bg-[#5a2222]">
                      删除
                    </button>
                  </div>
                </div>
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
            className="px-4 py-2 rounded-xl bg-[#26262c] border border-[#2e2e32] text-[10px] font-black uppercase hover:bg-[#383842]"
          >
            导入/导出
          </button>
        </div>
      </div>
      )}
      {catalogError && <div className="text-[10px] text-red-400 break-all">{catalogError}</div>}
      {packContentsLoading && <div className="text-[10px] text-gray-500">正在加载远程能力列表…</div>}

      {showImportExport && (
        <div className="rounded-2xl border border-[#2e2e32] bg-[#16161a] p-4 space-y-3">
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
            <div className="flex gap-2 mt-1">
              {CAPABILITY_CATEGORIES.filter((c) => c.id !== 'image_process').map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setNewCategory(c.id);
                    if (c.id === 'image_gen') setNewEngine('gen_image');
                  }}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${newCategory === c.id ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300' : 'bg-[#1c1c22] border-[#2e2e32] text-gray-500 hover:bg-[#2e2e36]'}`}
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
            {(newCategory === 'image_gen' || newEngine === 'gen_image') && (
              <>
                <label className="flex items-center gap-2 text-[9px] text-gray-400">
                  <span className="font-black uppercase">生图档位</span>
                  <CustomDropdown
                    options={DIALOG_IMAGE_GEARS.map((g) => ({ value: g.id, label: g.label }))}
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
            {newCategory === 'image_process' && (
              <label className="flex items-center gap-2 text-[9px] text-gray-400">
                <span className="font-black uppercase">执行方式</span>
                <CustomDropdown
                  options={[
                    { value: 'builtin', label: '图像处理（内置）' },
                    { value: 'gen_image', label: '生图（提示词）' },
                  ]}
                  value={newEngine}
                  onChange={(v) => setNewEngine(v as CapabilityEngine)}
                  triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                />
              </label>
            )}
            {newCategory === 'image_gen' && (
              <span className="text-[8px] text-gray-500">执行方式：生图（提示词）</span>
            )}
          </div>
          <div>
            <span className="text-[8px] font-black text-gray-500 uppercase">功能名称</span>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={
                newCategory === 'image_gen'
                  ? '如：转赛博朋克风格、生成多视角、写实化'
                  : newCategory === 'image_process'
                    ? '如：拆分组件、切割图片、提取主体'
                    : '如：手办白模、低面数模型'
              }
              className="mt-1 w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500"
            />
          </div>
          {newCategory === 'image_gen' && (
            <div>
              <span className="text-[8px] font-black text-blue-400/90 uppercase">预设提示词（必填）</span>
              <p className="text-[8px] text-gray-500 mt-0.5">
                {newSkipUnderstand
                  ? '工作流执行时：直接将此处提示词发送给生图模型（提示词+图片直发）。'
                  : '工作流执行时：先将此处内容交给文字模型理解，再根据理解结果生成生图用提示词发给生图模型（与对话模式一致）。'}
              </p>
              <textarea
                value={newInstruction}
                onChange={(e) => setNewInstruction(e.target.value)}
                placeholder="如：将图片转为赛博朋克风格，霓虹灯与机械细节；或：生成该物体的多视角线稿"
                rows={4}
                className="mt-1 w-full bg-[#1c1c22] border border-[#4b6a9e] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none"
              />
            </div>
          )}
          {newCategory === 'image_process' && newEngine === 'gen_image' && (
            <div>
              <span className="text-[8px] font-black text-blue-400/90 uppercase">预设提示词（必填）</span>
              <p className="text-[8px] text-gray-500 mt-0.5">
                {newSkipUnderstand
                  ? '工作流执行时直接将此处提示词发送给生图模型。'
                  : '工作流执行时先由文字模型理解，再生成生图用提示词。'}
              </p>
              <textarea value={newInstruction} onChange={(e) => setNewInstruction(e.target.value)} placeholder="如：将图片转为赛博朋克风格" rows={3} className="mt-1 w-full bg-[#1c1c22] border border-[#4b6a9e] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none" />
            </div>
          )}
          {newCategory === 'image_process' && newEngine === 'builtin' && (
            <div>
              <span className="text-[8px] font-black text-gray-500 uppercase">可选：补充说明或约束</span>
              <p className="text-[8px] text-gray-600 mt-0.5">多数能力有内置逻辑（如切割按版面分块），可留空；需要时可填写额外说明。</p>
              <textarea value={newInstruction} onChange={(e) => setNewInstruction(e.target.value)} placeholder="留空即使用内置逻辑；或填写如：只保留上半部分、排除背景" rows={2} className="mt-1 w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none" />
            </div>
          )}
          {newCategory === 'generate_3d' && (
            <>
              <div className="rounded-xl border border-[#d97706] bg-[#221c10] p-3 space-y-2">
                <div className="text-[8px] font-black text-amber-400 uppercase">生成3D 预设（工作流拖图即按此配置提交）</div>
                <div className="flex gap-2 flex-wrap">
                          <label className="flex items-center gap-1.5 text-[9px]">
                            <span>模块</span>
                            <CustomDropdown
                              options={[{ value: 'pro', label: '专业版' }, { value: 'rapid', label: '极速版' }]}
                              value={newGenerate3D.module}
                              onChange={(v) => setNewGenerate3D((g) => ({ ...g, module: v as 'pro' | 'rapid' }))}
                              triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                            />
                          </label>
                          {newGenerate3D.module === 'pro' && (
                            <label className="flex items-center gap-1.5 text-[9px]">
                              <span>模型</span>
                              <CustomDropdown
                                options={[{ value: '3.0', label: '3.0' }, { value: '3.1', label: '3.1' }]}
                                value={newGenerate3D.model ?? '3.0'}
                                onChange={(v) => setNewGenerate3D((g) => ({ ...g, model: v as '3.0' | '3.1' }))}
                                triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                              />
                            </label>
                          )}
                  <label className="flex items-center gap-1.5 text-[9px]">
                    <input type="checkbox" checked={newGenerate3D.enablePBR ?? false} onChange={(e) => setNewGenerate3D((g) => ({ ...g, enablePBR: e.target.checked }))} />
                    <span>PBR</span>
                  </label>
                  {newGenerate3D.module === 'pro' && (
                    <>
                      <label className="flex items-center gap-1.5 text-[9px]">
                        <span>面数</span>
                        <input type="number" min={10000} max={1500000} value={newGenerate3D.faceCount ?? 500000} onChange={(e) => setNewGenerate3D((g) => ({ ...g, faceCount: e.target.value ? parseInt(e.target.value, 10) : undefined }))} className="w-20 bg-[#26262c] border border-[#2e2e32] rounded px-2 py-1 text-[9px]" />
                      </label>
                      <label className="flex items-center gap-1.5 text-[9px]">
                        <span>类型</span>
                        <CustomDropdown
                          options={[
                            { value: 'Normal', label: 'Normal' },
                            { value: 'LowPoly', label: 'LowPoly' },
                            { value: 'Geometry', label: 'Geometry' },
                            { value: 'Sketch', label: 'Sketch' },
                          ]}
                          value={newGenerate3D.generateType ?? 'Normal'}
                          onChange={(v) => setNewGenerate3D((g) => ({ ...g, generateType: v as Generate3DPreset['generateType'] }))}
                          triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                        />
                      </label>
                      <label className="flex items-center gap-1.5 text-[9px]">
                        <span>格式</span>
                        <CustomDropdown
                          options={[{ value: '', label: '默认' }, { value: 'STL', label: 'STL' }, { value: 'USDZ', label: 'USDZ' }, { value: 'FBX', label: 'FBX' }]}
                          value={newGenerate3D.resultFormat ?? ''}
                          onChange={(v) => setNewGenerate3D((g) => ({ ...g, resultFormat: v || undefined }))}
                          placeholder="默认"
                          triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                        />
                      </label>
                    </>
                  )}
                </div>
              </div>
              <div>
                <span className="text-[8px] font-black text-gray-500 uppercase">可选：图生3D 补充描述</span>
                <textarea
                  value={newInstruction}
                  onChange={(e) => setNewInstruction(e.target.value)}
                  placeholder="留空即可；需要时可对生成效果做文字补充"
                  rows={1}
                  className="mt-1 w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none"
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
        {visiblePresets.length === 0 && effectiveUninstalledPresetItems.length === 0 ? (
          <div className="rounded-2xl border border-[#2e2e32] bg-[#16161a] p-8 text-center text-gray-500 text-[10px]">
            {viewMode === 'image_process'
              ? '暂无图像处理能力。'
              : '暂无基础能力预设，点击「新增能力」添加；远程能力加载后将显示在下方。'}
          </div>
        ) : (
          <>
            <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 [column-gap:0.75rem] [column-fill:_balance]">
              {visiblePresets.map((p) => {
                const src = getCardPreviewSrc(p);
                const categoryLabel = CAPABILITY_CATEGORIES.find((c) => c.id === p.category)?.label ?? p.category;
                const iconName = p.category === 'generate_3d' ? 'cube' : p.category === 'image_process' ? 'camera' : 'image';
                return (
                  <button
                    key={p.id}
                    type="button"
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
                    className="inline-block align-top mb-3 w-full break-inside-avoid rounded-2xl border border-[#2e2e32] bg-[#16161a] overflow-hidden text-left hover:border-blue-400/50 transition-colors group"
                  >
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
                        <div className="text-[10px] font-black text-white truncate">{p.label}</div>
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-[#26262c]/95 text-gray-300">{categoryLabel}</span>
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${p.enabled === false ? 'bg-[#4a1c1c]/95 text-red-300' : 'bg-[#166534]/95 text-green-300'}`}>
                            {p.enabled === false ? '禁用' : '启用'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {effectiveUninstalledPresetItems.length > 0 && (
              <div className="rounded-2xl border border-[#2e2e32] bg-[#16161a] p-4 text-[9px] text-gray-400">
                检测到 {effectiveUninstalledPresetItems.length} 条远程预设，点击上方「刷新同步」即可自动同步。
              </div>
            )}
          </>
        )}
      </div>

      {typeof document !== 'undefined' &&
        detailPreset &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/78 backdrop-blur-sm p-3 md:p-5"
            onClick={() => setDetailPresetId(null)}
            role="presentation"
          >
            <div
              className="w-full max-w-[min(1500px,98vw)] h-[min(94vh,980px)] rounded-2xl border border-[#2e2e32] bg-[#101014] overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="h-full grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="min-h-0 bg-[#0b0b0d] border-b lg:border-b-0 lg:border-r border-[#2e2e32]">
                  <div className="h-full flex flex-col">
                    <div className="shrink-0 px-4 py-3 border-b border-[#2e2e32] flex items-center justify-between bg-[#0f1014]">
                      <div className="min-w-0">
                        <div className="text-[9px] text-gray-500 uppercase tracking-wide">能力预览</div>
                        <div className="text-[14px] font-black text-white truncate mt-0.5">{detailPreset.label}</div>
                        <div className="text-[9px] text-gray-500 mt-0.5">左侧预览对比，右侧参数与操作</div>
                      </div>
                      <button type="button" onClick={() => setDetailPresetId(null)} className="px-3 py-2 rounded-xl bg-[#1a1a1e]/95 border border-[#2e2e32] text-[10px] font-black text-white hover:bg-[#2a2a32]">关闭</button>
                    </div>
                    <div
                      className="flex-1 min-h-0 w-full bg-[#0f0f10] relative"
                      onMouseMove={(e) => {
                        const original = getOriginalPreviewSrc(detailPreset) || getOriginalPreviewThumbSrc(detailPreset);
                        const generated = getGeneratedPreviewSrc(detailPreset) || getGeneratedPreviewThumbSrc(detailPreset);
                        if (!original || !generated) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        if (!rect.width) return;
                        const ratio = (e.clientX - rect.left) / rect.width;
                        setLightboxSplitRatio(Math.max(0.05, Math.min(0.95, ratio)));
                      }}
                      onMouseLeave={() => setLightboxSplitRatio(0.5)}
                    >
                      {(() => {
                        const original = getOriginalPreviewSrc(detailPreset) || getOriginalPreviewThumbSrc(detailPreset);
                        const generated = getGeneratedPreviewSrc(detailPreset) || getGeneratedPreviewThumbSrc(detailPreset);
                        if (original && generated) {
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
                              <CapabilityPreviewImg src={original} alt="原图" className="absolute inset-0 h-full w-full object-contain" />
                              <CapabilityPreviewImg
                                src={generated}
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
                        }
                        const src = getCardPreviewSrc(detailPreset);
                        if (!src) {
                          return <div className="h-full min-h-[18rem] flex items-center justify-center text-gray-500 text-[10px]">暂无预览图</div>;
                        }
                        return <CapabilityPreviewImg src={src} alt="" className="h-full max-h-full w-full object-contain" />;
                      })()}
                    </div>
                  </div>
                </div>
                <div className="min-h-0 overflow-y-auto p-3 md:p-4 space-y-3 bg-[#121216]">
                  <div className="rounded-2xl border border-[#2e2e32] bg-[#16161a] p-3 space-y-2">
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
                            <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500" />
                          </label>
                          <label className="block">
                          <div className="text-[9px] text-gray-400 uppercase mb-1">切割溢出（每边像素）</div>
                            <input
                              type="number"
                              min={0}
                              max={512}
                              step={1}
                              value={editCutOverflowPx}
                              onChange={(e) => setEditCutOverflowPx(Math.max(0, Math.min(512, Math.round(Number(e.target.value) || 0))))}
                              className="w-28 bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500"
                            />
                          </label>
                          <label className="block">
                            <div className="text-[9px] text-gray-500 uppercase mb-1">补充说明</div>
                            <textarea value={editInstruction} onChange={(e) => setEditInstruction(e.target.value)} rows={4} className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-y" />
                          </label>
                          <div className="flex gap-2">
                            <button type="button" onClick={saveDetailEdit} className="px-3 py-1.5 rounded-lg border border-[#36578f] bg-[#1d3154] text-blue-200 text-[9px] font-black uppercase hover:bg-[#264171]">保存</button>
                            <button type="button" onClick={() => { setDetailEditMode(false); setEditingId(null); }} className="px-3 py-1.5 rounded-lg border border-[#2e2e32] bg-[#1a1a1f] text-[9px] font-black uppercase text-gray-200 hover:bg-[#262630]">取消</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-[9px] text-gray-500 uppercase">完整设置</div>
                          <div className="flex gap-2 flex-wrap">
                            {CAPABILITY_CATEGORIES.filter((c) => c.id !== 'image_process').map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setEditCategory(c.id);
                                  if (c.id === 'image_gen') setEditEngine('gen_image');
                                  if (c.id === 'generate_3d') setEditGenerate3D(editCategory === 'generate_3d' ? { ...editGenerate3D } : { ...DEFAULT_GENERATE_3D });
                                }}
                                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${editCategory === c.id ? 'bg-[#1e3558] border-[#3b82f6] text-blue-300' : 'bg-[#1c1c22] border-[#2e2e32] text-gray-500'}`}
                              >
                                {c.label}
                              </button>
                            ))}
                          </div>
                          <label className="flex items-center gap-2 text-[10px] text-gray-300">
                            <input type="checkbox" checked={editEnabled} onChange={(e) => setEditEnabled(e.target.checked)} />
                            启用
                          </label>
                          {(editCategory === 'image_gen' || editEngine === 'gen_image') && (
                            <div className="grid grid-cols-1 gap-2">
                              <label className="flex items-center gap-2 text-[9px] text-gray-400">
                                <span className="font-black uppercase">生图档位</span>
                                <CustomDropdown
                                  options={DIALOG_IMAGE_GEARS.map((g) => ({ value: g.id, label: g.label }))}
                                  value={editImageGear}
                                  onChange={(v) => setEditImageGear(v as DialogImageGear)}
                                  triggerClassName={DROPDOWN_TRIGGER_COMPACT}
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
                                />
                              </label>
                              <label className="flex items-center gap-2 text-[9px] text-gray-400 cursor-pointer" title="勾选：先理解再生成生图提示词；不勾选：预设提示词直发">
                                <input type="checkbox" checked={!editSkipUnderstand} onChange={(e) => setEditSkipUnderstand(!e.target.checked)} />
                                <span className="font-black uppercase">理解</span>
                              </label>
                            </div>
                          )}
                          {editCategory === 'image_process' && (
                            <label className="flex items-center gap-2 text-[9px] text-gray-400">
                              <span className="font-black uppercase">执行方式</span>
                              <CustomDropdown
                                options={[
                                  { value: 'builtin', label: '图像处理（内置）' },
                                  { value: 'gen_image', label: '生图（提示词）' },
                                ]}
                                value={editEngine}
                                onChange={(v) => setEditEngine(v as CapabilityEngine)}
                                triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                              />
                            </label>
                          )}
                          {editCategory === 'generate_3d' && (
                            <div className="rounded-xl border border-[#2e3f5d] bg-[#141b26] p-3 space-y-2">
                              <div className="text-[8px] font-black text-blue-300 uppercase">生成3D 预设</div>
                              <label className="flex items-center gap-2 text-[9px]">
                                <span>模块</span>
                                <CustomDropdown
                                  options={[{ value: 'pro', label: '专业版' }, { value: 'rapid', label: '极速版' }]}
                                  value={editGenerate3D.module}
                                  onChange={(v) => setEditGenerate3D((g) => ({ ...g, module: v as 'pro' | 'rapid' }))}
                                  triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                />
                              </label>
                              {editGenerate3D.module === 'pro' && (
                                <>
                                  <label className="flex items-center gap-2 text-[9px]">
                                    <span>模型</span>
                                    <CustomDropdown
                                      options={[{ value: '3.0', label: '3.0' }, { value: '3.1', label: '3.1' }]}
                                      value={editGenerate3D.model ?? '3.0'}
                                      onChange={(v) => setEditGenerate3D((g) => ({ ...g, model: v as '3.0' | '3.1' }))}
                                      triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                    />
                                  </label>
                                  <label className="flex items-center gap-2 text-[9px]">
                                    <span>面数</span>
                                    <input type="number" min={10000} max={1500000} value={editGenerate3D.faceCount ?? 500000} onChange={(e) => setEditGenerate3D((g) => ({ ...g, faceCount: e.target.value ? parseInt(e.target.value, 10) : undefined }))} className="w-24 bg-[#26262c] border border-[#2e2e32] rounded px-2 py-1 text-[9px]" />
                                  </label>
                                  <label className="flex items-center gap-2 text-[9px]">
                                    <span>类型</span>
                                    <CustomDropdown
                                      options={[
                                        { value: 'Normal', label: 'Normal' },
                                        { value: 'LowPoly', label: 'LowPoly' },
                                        { value: 'Geometry', label: 'Geometry' },
                                        { value: 'Sketch', label: 'Sketch' },
                                      ]}
                                      value={editGenerate3D.generateType ?? 'Normal'}
                                      onChange={(v) => setEditGenerate3D((g) => ({ ...g, generateType: v as Generate3DPreset['generateType'] }))}
                                      triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                    />
                                  </label>
                                  <label className="flex items-center gap-2 text-[9px]">
                                    <span>格式</span>
                                    <CustomDropdown
                                      options={[{ value: '', label: '默认' }, { value: 'STL', label: 'STL' }, { value: 'USDZ', label: 'USDZ' }, { value: 'FBX', label: 'FBX' }]}
                                      value={editGenerate3D.resultFormat ?? ''}
                                      onChange={(v) => setEditGenerate3D((g) => ({ ...g, resultFormat: v || undefined }))}
                                      placeholder="默认"
                                      triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                    />
                                  </label>
                                </>
                              )}
                              <label className="flex items-center gap-1.5 text-[9px]">
                                <input type="checkbox" checked={editGenerate3D.enablePBR ?? false} onChange={(e) => setEditGenerate3D((g) => ({ ...g, enablePBR: e.target.checked }))} />
                                <span>PBR</span>
                              </label>
                            </div>
                          )}
                          <label className="block">
                            <div className="text-[9px] text-gray-500 uppercase mb-1">功能名称</div>
                            <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500" />
                          </label>
                          <label className="block">
                            <div className="text-[9px] text-gray-500 uppercase mb-1">提示词 / 说明</div>
                            <textarea value={editInstruction} onChange={(e) => setEditInstruction(e.target.value)} rows={8} className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-y" />
                          </label>
                          <div className="flex gap-2">
                            <button type="button" onClick={saveDetailEdit} className="px-3 py-1.5 rounded-lg border border-[#36578f] bg-[#1d3154] text-blue-200 text-[9px] font-black uppercase hover:bg-[#264171]">保存</button>
                            <button type="button" onClick={() => { setDetailEditMode(false); setEditingId(null); }} className="px-3 py-1.5 rounded-lg border border-[#2e2e32] bg-[#1a1a1f] text-[9px] font-black uppercase text-gray-200 hover:bg-[#262630]">取消</button>
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
                                : detailPreset.category === 'image_gen'
                                  ? '生图（提示词）'
                                  : getEngine(detailPreset) === 'gen_image'
                                    ? '生图（提示词）'
                                    : '图像处理（内置）'}
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
                        </div>
                        {detailPreset.category === 'generate_3d' && detailPreset.generate3D && (
                          <div className="rounded-lg bg-[#1b1b21] border border-[#2a2a32] px-2 py-2 text-[9px] text-gray-300">
                            3D：{detailPreset.generate3D.module === 'pro' ? '专业版' : '极速版'}
                            {detailPreset.generate3D.model ? ` · ${detailPreset.generate3D.model}` : ''}
                            {detailPreset.generate3D.generateType ? ` · ${detailPreset.generate3D.generateType}` : ''}
                            {detailPreset.generate3D.resultFormat ? ` · ${detailPreset.generate3D.resultFormat}` : ''}
                            {detailPreset.generate3D.faceCount ? ` · ${detailPreset.generate3D.faceCount} 面` : ''}
                            {detailPreset.generate3D.enablePBR ? ' · PBR' : ''}
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
                  <div className="rounded-2xl border border-[#2e2e32] bg-[#16161a] p-3 space-y-2">
                    <div className="text-[9px] text-gray-500 uppercase">功能按钮</div>
                    <input
                      ref={(el) => { fileInputRef.current[detailPreset.id] = el; }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleFile(detailPreset.id, e)}
                    />
                    <button type="button" onClick={() => fileInputRef.current[detailPreset.id]?.click()} className="w-full px-3 py-2 rounded-lg border border-[#36578f] bg-[#1d3154] text-blue-200 text-[9px] font-black uppercase hover:bg-[#264171]">上传预览图</button>
                    {onRunTest && detailPreset.category !== 'generate_3d' && (
                      <button
                        type="button"
                        disabled={!testImage[detailPreset.id] || testRunning[detailPreset.id]}
                        onClick={() => runTest(detailPreset)}
                        className="w-full px-3 py-2 rounded-lg border border-[#36578f] bg-[#1d3154] text-blue-200 text-[9px] font-black uppercase hover:bg-[#264171] disabled:opacity-50 disabled:pointer-events-none"
                      >
                        {testRunning[detailPreset.id] ? '运行中…' : '运行测试'}
                      </button>
                    )}
                    {canUploadToR2 && (
                      <>
                        <button type="button" onClick={() => void uploadPresetToR2(detailPreset, 'preview')} disabled={!!uploadingPresetActions[detailPreset.id]} className="w-full px-3 py-2 rounded-lg border border-[#36578f] bg-[#1d3154] text-blue-200 text-[9px] font-black uppercase hover:bg-[#264171] disabled:opacity-50">
                          {uploadingPresetActions[detailPreset.id] === 'preview' ? '上传中…' : '上传预览图到R2'}
                        </button>
                        <button type="button" onClick={() => void uploadPresetToR2(detailPreset, 'preset')} disabled={!!uploadingPresetActions[detailPreset.id]} className="w-full px-3 py-2 rounded-lg border border-[#36578f] bg-[#1d3154] text-blue-200 text-[9px] font-black uppercase hover:bg-[#264171] disabled:opacity-50">
                          {uploadingPresetActions[detailPreset.id] === 'preset' ? '上传中…' : '上传预设到R2'}
                        </button>
                      </>
                    )}
                    <button type="button" onClick={() => { removePreset(detailPreset.id); setDetailPresetId(null); }} disabled={isBuiltinImageProcess(detailPreset)} className="w-full px-3 py-2 rounded-lg border border-[#2e2e32] bg-[#1a1a1f] text-gray-200 text-[9px] font-black uppercase hover:bg-[#262630] disabled:opacity-50">
                      删除预设
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {typeof document !== 'undefined' &&
        (lightboxImage || lightboxCompare) &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/78 backdrop-blur-sm p-4"
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
      </div>
    </div>
  );
};

export default CapabilityPresetSection;
