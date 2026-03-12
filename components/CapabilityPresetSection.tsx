import React, { useState, useRef, useLayoutEffect, useMemo } from 'react';
import type { CustomAppModule, CapabilityCategory, CapabilityEngine, DialogImageGear, Generate3DPreset, CapabilitySet } from '../types';
import { CAPABILITY_CATEGORIES, DIALOG_IMAGE_GEARS, SUPPORTED_ASPECT_RATIOS, SUPPORTED_IMAGE_SIZES } from '../types';
import type { CapabilityTestResult } from '../services/capabilityTestRunner';
import { CAPABILITY_PRESETS_VERSION } from '../services/capabilityPresetStore';
import { loadInstalledPacks, loadPackHistory } from '../services/storePackHistory';
import { useStoreCatalog } from '../services/storeCatalogHook';
import CapabilitySetCanvas from './CapabilitySetCanvas';
import { CustomDropdown, DROPDOWN_TRIGGER_COMPACT } from './ui/CustomDropdown';

const CAPABILITY_SETS_VERSION = 1;

const DEFAULT_GENERATE_3D: Generate3DPreset = { module: 'pro', model: '3.0', enablePBR: false };

type ViewMode = 'presets' | 'sets' | 'canvas';

const CapabilityPresetSection: React.FC<{
  presets: CustomAppModule[];
  onUpdate: (next: CustomAppModule[]) => void;
  sets?: CapabilitySet[];
  onUpdateSets?: (next: CapabilitySet[]) => void;
  onRunTest?: (preset: CustomAppModule, imageBase64: string) => Promise<CapabilityTestResult>;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
}> = ({ presets, onUpdate, sets = [], onUpdateSets, onRunTest, onLog }) => {
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
    const g = (p.imageGear as DialogImageGear) || 'fast';
    return g === 'pro' ? 'pro' : 'fast';
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
  const [editImageGear, setEditImageGear] = useState<DialogImageGear>('fast');
  const [editImageAspectRatio, setEditImageAspectRatio] = useState('');
  const [editImageSize, setEditImageSize] = useState('');
  const [editInstruction, setEditInstruction] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newCategory, setNewCategory] = useState<CapabilityCategory>('image_gen');
  const [newEngine, setNewEngine] = useState<CapabilityEngine>('gen_image');
  const [newEnabled, setNewEnabled] = useState(true);
  const [newImageGear, setNewImageGear] = useState<DialogImageGear>('fast');
  const [newImageAspectRatio, setNewImageAspectRatio] = useState('');
  const [newImageSize, setNewImageSize] = useState('');
  const [newInstruction, setNewInstruction] = useState('');
  const [testImage, setTestImage] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<Record<string, CapabilityTestResult | null>>({});
  const [testRunning, setTestRunning] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<Record<string, HTMLInputElement | null>>({});
  const [newGenerate3D, setNewGenerate3D] = useState<Generate3DPreset>({ ...DEFAULT_GENERATE_3D });
  const [editGenerate3D, setEditGenerate3D] = useState<Generate3DPreset>({ ...DEFAULT_GENERATE_3D });
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [showImportExport, setShowImportExport] = useState(false);
  const [seedDropActive, setSeedDropActive] = useState(false);

  const {
    loading: catalogLoading,
    error: catalogError,
    refresh: refreshCatalog,
    installSinglePreset,
    installPresets,
    installingAll,
    packContentsLoading,
    remotePresetItems,
  } = useStoreCatalog({ onPresetsApplied: (next) => onUpdate(next), onLog });

  /** 远程能力中尚未出现在当前列表的（按能力展示为卡片，每张卡片可点安装） */
  const effectiveUninstalledPresetItems = useMemo(
    () => remotePresetItems.filter((rp) => !presets.some((p) => p.id === rp.preset.id)),
    [remotePresetItems, presets]
  );

  const movePreset = (id: string, delta: -1 | 1) => {
    const idx = presets.findIndex((p) => p.id === id);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= presets.length) return;
    const next = [...presets];
    const tmp = next[idx];
    next[idx] = next[to];
    next[to] = tmp;
    update(next);
  };

  const toggleEnabled = (id: string) => {
    update(
      presets.map((p) => {
        if (p.id !== id) return p;
        const cur = p.enabled !== false;
        return { ...p, enabled: !cur };
      })
    );
  };

  const saveEdit = () => {
    if (!editingId) return;
    update(
      presets.map((p) => {
        if (p.id !== editingId) return p;
        const next: CustomAppModule = {
          ...p,
          label: editLabel,
          category: editCategory,
          instruction: editInstruction,
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
    setNewImageGear('fast');
    setNewImageAspectRatio('');
    setNewImageSize('');
    setNewInstruction('');
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

  const loadSeedFromRepo = () => {
    Promise.all([
      fetch('/capability-seed/capability-presets.json').then((r) => (r.ok ? r.json() : null)),
      fetch('/capability-seed/capability-sets.json').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([presetsData, setsData]) => {
        if (presetsData?.presets?.length) {
          update(presetsData.presets as CustomAppModule[]);
          onLog?.('info', `已从仓库加载 ${presetsData.presets.length} 条能力预设`, undefined);
        }
        if (setsData?.sets && setsData.version === 1) {
          onUpdateSets?.(setsData.sets as CapabilitySet[]);
          onLog?.('info', `已从仓库加载 ${(setsData.sets as CapabilitySet[]).length} 个能力集合`, undefined);
        }
        if (!presetsData?.presets?.length && !setsData?.sets?.length) {
          onLog?.('warn', '仓库种子为空或请求失败', undefined);
        }
      })
      .catch((e) => onLog?.('error', '从仓库加载失败', e instanceof Error ? e.message : String(e)));
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

  /** 下载当前能力预设/集合为仓库种子文件，可放入 public/capability-seed/ 后提交到 GitHub */
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
      onLog?.('info', '已下载仓库种子文件，请放入 public/capability-seed/ 后提交', undefined);
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

  const handleFile = (presetId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setTestImage((prev) => ({ ...prev, [presetId]: reader.result as string }));
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

  // 顶部：仅展示已有能力（基础能力 + 复合能力）分两行，不拖动
  const presetStrip = (
    <div className="shrink-0 flex flex-col gap-2 p-3 rounded-xl border border-white/10 bg-black/30">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[9px] font-black text-blue-400/90 uppercase mr-1">基础能力</span>
        {presets.filter((p) => p.enabled !== false).map((p) => (
          <span
            key={p.id}
            className="px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/40 text-[10px] font-semibold text-blue-200/90"
          >
            {p.label}
          </span>
        ))}
        {presets.filter((p) => p.enabled !== false).length === 0 && (
          <span className="text-[9px] text-gray-500">暂无</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[9px] font-black text-amber-400/90 uppercase mr-1">复合能力</span>
        {sets.map((s) => (
          <span
            key={s.id}
            className="px-3 py-1.5 rounded-lg bg-amber-600/20 border border-amber-500/40 text-[10px] font-semibold text-amber-200/90"
          >
            {s.label}
          </span>
        ))}
        {sets.length === 0 && (
          <span className="text-[9px] text-gray-500">暂无</span>
        )}
      </div>
    </div>
  );

  if (viewMode === 'canvas') {
    return (
      <div className="flex flex-col h-[calc(100dvh-8rem)] min-h-[400px] animate-in fade-in">
        <div className="flex-1 min-h-0 rounded-2xl border border-white/10 overflow-hidden bg-white">
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
    <div className="flex flex-col gap-6 animate-in fade-in max-w-4xl">
      {presetStrip}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setViewMode('presets')}
          className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase border ${viewMode === 'presets' ? 'bg-blue-600/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/10 text-gray-500 hover:bg-white/10'}`}
        >
          基础能力预设
        </button>
        <button
          type="button"
          onClick={() => setViewMode('sets')}
          className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase border ${viewMode === 'sets' ? 'bg-blue-600/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/10 text-gray-500 hover:bg-white/10'}`}
        >
          能力集合
        </button>
      </div>

      {viewMode === 'sets' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[9px] text-gray-500">在画布中组合多个能力并连线，工作流中可整体使用。</p>
            <button
              type="button"
              onClick={openNewSet}
              className="px-4 py-2 rounded-xl bg-amber-600 text-[10px] font-black uppercase hover:bg-amber-500"
            >
              添加能力集合
            </button>
          </div>
          {sets.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/40 p-8 text-center text-gray-500 text-[10px]">
              暂无能力集合，点击「添加能力集合」进入画布拖拽连线。
            </div>
          ) : (
            <div className="grid gap-3">
              {sets.map((s) => (
                <div key={s.id} className="rounded-2xl border border-white/10 bg-black/40 p-4 flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase">{s.label}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => openEditSet(s)} className="px-3 py-1.5 rounded-lg bg-white/10 text-[9px] font-black uppercase hover:bg-white/20">
                      编辑
                    </button>
                    <button type="button" onClick={() => removeSet(s.id)} className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-[9px] font-black uppercase hover:bg-red-500/30">
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {viewMode === 'presets' && (
        <>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[9px] text-gray-500">
          在此管理功能预设，工作流中的「功能区」将调用此处配置的项，拖拽图片到对应框即可执行。
        </p>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowImportExport((v) => !v)}
            className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-[10px] font-black uppercase hover:bg-white/20"
          >
            导入/导出
          </button>
          <button
            onClick={() => setIsAdding(true)}
            className="px-4 py-2 rounded-xl bg-blue-600 text-[10px] font-black uppercase hover:bg-blue-500"
          >
            新增功能预设
          </button>
          <button
            type="button"
            onClick={() => void refreshCatalog()}
            disabled={catalogLoading}
            className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-[10px] font-black uppercase hover:bg-white/20 disabled:opacity-50"
          >
            {catalogLoading ? '加载中…' : '刷新远程'}
          </button>
          {effectiveUninstalledPresetItems.length > 0 && (
            <button
              type="button"
              onClick={() => installPresets(effectiveUninstalledPresetItems.map((rp) => rp.preset))}
              disabled={catalogLoading || packContentsLoading || installingAll}
              className="px-4 py-2 rounded-xl bg-amber-600 text-[10px] font-black uppercase hover:bg-amber-500 disabled:opacity-50"
            >
              {installingAll ? '安装中…' : `一键安装全部（${effectiveUninstalledPresetItems.length}）`}
            </button>
          )}
        </div>
      </div>
      {catalogError && <div className="text-[10px] text-red-400 break-all">{catalogError}</div>}
      {packContentsLoading && <div className="text-[10px] text-gray-500">正在加载远程能力列表…</div>}

      {showImportExport && (
        <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[9px] font-black text-gray-300 uppercase">导入仓库种子</div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={loadSeedFromRepo} className="px-3 py-1.5 rounded-lg bg-blue-600/80 text-[9px] font-black uppercase hover:bg-blue-500">
                从仓库加载
              </button>
              <button onClick={() => exportSeedForRepo('both')} className="px-3 py-1.5 rounded-lg bg-amber-600/60 text-[9px] font-black uppercase hover:bg-amber-500/70" title="下载后放入 public/capability-seed/ 再提交到 GitHub">
                导出为仓库种子
              </button>
              <button onClick={() => setShowImportExport(false)} className="px-3 py-1.5 rounded-lg bg-white/10 text-[9px] font-black uppercase hover:bg-white/20">
                关闭
              </button>
            </div>
          </div>
          <p className="text-[8px] text-gray-500">
            从仓库加载：使用当前站点 public/capability-seed/ 中的种子。或将 capability-presets.json / capability-sets.json 拖入下方区域导入。
          </p>
          <div
            className={`min-h-[120px] rounded-xl border-2 border-dashed flex items-center justify-center transition-colors ${seedDropActive ? 'border-blue-500 bg-blue-500/10' : 'border-white/20 bg-black/40'}`}
            onDragOver={(e) => { e.preventDefault(); setSeedDropActive(true); }}
            onDragLeave={() => setSeedDropActive(false)}
            onDrop={handleSeedDrop}
          >
            <span className="text-[10px] text-gray-400">将 JSON 文件拖入此处（capability-presets.json 或 capability-sets.json）</span>
          </div>
        </div>
      )}

      {isAdding && (
        <div className="rounded-2xl border border-blue-500/40 bg-black/40 p-4 space-y-3">
          <div className="text-[9px] font-black text-blue-400 uppercase">新增</div>
          <div>
            <span className="text-[8px] font-black text-gray-500 uppercase">分类</span>
            <div className="flex gap-2 mt-1">
              {CAPABILITY_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setNewCategory(c.id);
                    if (c.id === 'image_gen') setNewEngine('gen_image');
                    if (c.id === 'image_process') setNewEngine('builtin');
                  }}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${newCategory === c.id ? 'bg-blue-600/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/10 text-gray-500 hover:bg-white/10'}`}
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
              className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500"
            />
          </div>
          {newCategory === 'image_gen' && (
            <div>
              <span className="text-[8px] font-black text-blue-400/90 uppercase">预设提示词（必填）</span>
              <p className="text-[8px] text-gray-500 mt-0.5">工作流执行时：先将此处内容交给文字模型理解，再根据理解结果生成生图用提示词发给生图模型（与对话模式一致）。</p>
              <textarea
                value={newInstruction}
                onChange={(e) => setNewInstruction(e.target.value)}
                placeholder="如：将图片转为赛博朋克风格，霓虹灯与机械细节；或：生成该物体的多视角线稿"
                rows={4}
                className="mt-1 w-full bg-white/5 border border-blue-500/30 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none"
              />
            </div>
          )}
          {newCategory === 'image_process' && newEngine === 'gen_image' && (
            <div>
              <span className="text-[8px] font-black text-blue-400/90 uppercase">预设提示词（必填）</span>
              <p className="text-[8px] text-gray-500 mt-0.5">工作流执行时先由文字模型理解，再生成生图用提示词。</p>
              <textarea value={newInstruction} onChange={(e) => setNewInstruction(e.target.value)} placeholder="如：将图片转为赛博朋克风格" rows={3} className="mt-1 w-full bg-white/5 border border-blue-500/30 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none" />
            </div>
          )}
          {newCategory === 'image_process' && newEngine === 'builtin' && (
            <div>
              <span className="text-[8px] font-black text-gray-500 uppercase">可选：补充说明或约束</span>
              <p className="text-[8px] text-gray-600 mt-0.5">多数能力有内置逻辑（如切割按版面分块），可留空；需要时可填写额外说明。</p>
              <textarea value={newInstruction} onChange={(e) => setNewInstruction(e.target.value)} placeholder="留空即使用内置逻辑；或填写如：只保留上半部分、排除背景" rows={2} className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none" />
            </div>
          )}
          {newCategory === 'generate_3d' && (
            <>
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
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
                        <input type="number" min={10000} max={1500000} value={newGenerate3D.faceCount ?? 500000} onChange={(e) => setNewGenerate3D((g) => ({ ...g, faceCount: e.target.value ? parseInt(e.target.value, 10) : undefined }))} className="w-20 bg-white/10 border border-white/10 rounded px-2 py-1 text-[9px]" />
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
                  className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none"
                />
              </div>
            </>
          )}
          <div className="flex gap-2">
            <button onClick={addPreset} className="px-4 py-2 rounded-xl bg-blue-600 text-[10px] font-black uppercase">
              添加
            </button>
            <button onClick={() => { setIsAdding(false); setNewLabel(''); setNewInstruction(''); }} className="px-4 py-2 rounded-xl bg-white/10 text-[10px] font-black uppercase">
              取消
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {presets.length === 0 && effectiveUninstalledPresetItems.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black/40 p-8 text-center text-gray-500 text-[10px]">
            暂无功能预设，点击「新增功能预设」添加；远程能力加载后将显示在下方。
          </div>
        ) : (
          <>
          {presets.map((p) => (
            <div key={p.id} className="rounded-2xl border border-white/10 bg-black/40 p-4">
              {editingId === p.id ? (
                <>
                  <div className="mb-2">
                    <span className="text-[8px] font-black text-gray-500 uppercase">分类</span>
                    <div className="flex gap-2 mt-1">
                      {CAPABILITY_CATEGORIES.map((c) => (
                        <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setEditCategory(c.id);
                          if (c.id === 'image_gen') setEditEngine('gen_image');
                          if (c.id === 'image_process') setEditEngine('builtin');
                          if (c.id === 'generate_3d') setEditGenerate3D(p.category === 'generate_3d' && p.generate3D ? { ...p.generate3D } : { ...DEFAULT_GENERATE_3D });
                        }}
                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${editCategory === c.id ? 'bg-blue-600/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/10 text-gray-500'}`}
                      >
                        {c.label}
                      </button>
                      ))}
                    </div>
                  </div>
                  <div className="mb-2 flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-[9px] text-gray-400">
                      <input type="checkbox" checked={editEnabled} onChange={(e) => setEditEnabled(e.target.checked)} />
                      <span className="font-black uppercase">启用</span>
                    </label>
                    {(editCategory === 'image_gen' || editEngine === 'gen_image') && (
                      <>
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
                      </>
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
                    {editCategory === 'image_gen' && (
                      <span className="text-[8px] text-gray-500">执行方式：生图（提示词）</span>
                    )}
                  </div>
                  <div className="mb-2">
                    <span className="text-[8px] font-black text-gray-500 uppercase">功能名称</span>
                    <input
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder={
                        editCategory === 'image_gen'
                          ? '如：转赛博朋克风格、生成多视角'
                          : editCategory === 'image_process'
                            ? '如：拆分组件、切割图片'
                            : '如：手办白模、低面数模型'
                      }
                      className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500"
                    />
                  </div>
                  {editCategory === 'image_gen' && (
                    <div className="mb-2">
                      <span className="text-[8px] font-black text-blue-400/90 uppercase">预设提示词（必填）</span>
                      <p className="text-[8px] text-gray-500 mt-0.5">工作流执行时先由文字模型理解，再生成生图用提示词（与对话模式一致）。</p>
                      <textarea
                        value={editInstruction}
                        onChange={(e) => setEditInstruction(e.target.value)}
                        rows={4}
                        className="mt-1 w-full bg-white/5 border border-blue-500/30 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none"
                        placeholder="如：将图片转为赛博朋克风格"
                      />
                    </div>
                  )}
                  {editCategory === 'image_process' && editEngine === 'gen_image' && (
                    <div className="mb-2">
                      <span className="text-[8px] font-black text-blue-400/90 uppercase">预设提示词（必填）</span>
                      <p className="text-[8px] text-gray-500 mt-0.5">工作流执行时先由文字模型理解，再生成生图用提示词。</p>
                      <textarea
                        value={editInstruction}
                        onChange={(e) => setEditInstruction(e.target.value)}
                        rows={3}
                        className="mt-1 w-full bg-white/5 border border-blue-500/30 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none"
                        placeholder="如：将图片转为赛博朋克风格"
                      />
                    </div>
                  )}
                  {editCategory === 'image_process' && editEngine === 'builtin' && (
                    <div className="mb-2">
                      <span className="text-[8px] font-black text-gray-500 uppercase">可选：补充说明或约束</span>
                      <textarea
                        value={editInstruction}
                        onChange={(e) => setEditInstruction(e.target.value)}
                        rows={2}
                        className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none"
                        placeholder="可留空使用内置逻辑"
                      />
                    </div>
                  )}
                  {editCategory === 'generate_3d' && (
                    <>
                      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 space-y-2 mb-2">
                        <div className="text-[8px] font-black text-amber-400 uppercase">生成3D 预设</div>
                        <div className="flex gap-2 flex-wrap">
                          <label className="flex items-center gap-1.5 text-[9px]">
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
                              <label className="flex items-center gap-1.5 text-[9px]">
                                <span>模型</span>
                                <CustomDropdown
                                  options={[{ value: '3.0', label: '3.0' }, { value: '3.1', label: '3.1' }]}
                                  value={editGenerate3D.model ?? '3.0'}
                                  onChange={(v) => setEditGenerate3D((g) => ({ ...g, model: v as '3.0' | '3.1' }))}
                                  triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                />
                              </label>
                              <label className="flex items-center gap-1.5 text-[9px]">
                                <span>面数</span>
                                <input type="number" min={10000} max={1500000} value={editGenerate3D.faceCount ?? 500000} onChange={(e) => setEditGenerate3D((g) => ({ ...g, faceCount: e.target.value ? parseInt(e.target.value, 10) : undefined }))} className="w-20 bg-white/10 border border-white/10 rounded px-2 py-1 text-[9px]" />
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
                                  value={editGenerate3D.generateType ?? 'Normal'}
                                  onChange={(v) => setEditGenerate3D((g) => ({ ...g, generateType: v as Generate3DPreset['generateType'] }))}
                                  triggerClassName={DROPDOWN_TRIGGER_COMPACT}
                                />
                              </label>
                              <label className="flex items-center gap-1.5 text-[9px]">
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
                      </div>
                      <div className="mb-2">
                        <span className="text-[8px] font-black text-gray-500 uppercase">可选：图生3D 补充描述</span>
                        <textarea
                          value={editInstruction}
                          onChange={(e) => setEditInstruction(e.target.value)}
                          rows={1}
                          className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none"
                          placeholder="留空即可"
                        />
                      </div>
                    </>
                  )}
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="px-3 py-1.5 rounded-lg bg-blue-600 text-[9px] font-black uppercase">保存</button>
                    <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg bg-white/10 text-[9px] font-black uppercase">取消</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-black uppercase">{p.label}</span>
                      <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${p.enabled === false ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                        {p.enabled === false ? '禁用' : '启用'}
                      </span>
                      {p.category === 'image_process' && getEngine(p) === 'gen_image' && (
                        <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-amber-500/20 text-amber-300">
                          生图执行
                        </span>
                      )}
                    </div>
                    <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-white/10 text-gray-400">
                      {CAPABILITY_CATEGORIES.find((c) => c.id === p.category)?.label ?? p.category}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => movePreset(p.id, -1)}
                        className="px-2 py-1 rounded-lg bg-white/10 text-[8px] font-black uppercase hover:bg-white/20"
                        title="上移"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => movePreset(p.id, 1)}
                        className="px-2 py-1 rounded-lg bg-white/10 text-[8px] font-black uppercase hover:bg-white/20"
                        title="下移"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => toggleEnabled(p.id)}
                        className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase hover:bg-white/20 ${p.enabled === false ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-gray-200'}`}
                        title={p.enabled === false ? '启用' : '禁用'}
                      >
                        {p.enabled === false ? '启用' : '禁用'}
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(p.id);
                          setEditLabel(p.label);
                          setEditCategory(p.category);
                          setEditEngine(getEngine(p));
                          setEditEnabled(p.enabled !== false);
                          setEditImageGear(getGear(p));
                          setEditImageAspectRatio(p.imageAspectRatio ?? '');
                          setEditImageSize(p.imageSize ?? '');
                          setEditInstruction(((p as { instructionFixed?: string }).instructionFixed ?? p.instruction) || '');
                          setEditGenerate3D(p.category === 'generate_3d' && p.generate3D ? { ...p.generate3D } : { ...DEFAULT_GENERATE_3D });
                        }}
                        className="px-2 py-1 rounded-lg bg-white/10 text-[8px] font-black uppercase hover:bg-white/20"
                      >
                        编辑
                      </button>
                      <button onClick={() => removePreset(p.id)} className="px-2 py-1 rounded-lg bg-red-500/20 text-red-400 text-[8px] font-black uppercase hover:bg-red-500/30">删除</button>
                    </div>
                  </div>
                  <div className="mt-2 text-[8px] text-gray-500 space-x-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>id: {p.id}</span>
                    <span>分类: {p.category}</span>
                    <span>预设: {p.instruction?.length ?? 0} 字</span>
                    {(p.category === 'image_gen' || getEngine(p) === 'gen_image') && (p.imageAspectRatio || p.imageSize) && (
                      <span>比例/尺寸: {p.imageAspectRatio || '—'} / {p.imageSize || '—'}</span>
                    )}
                    {presetSourceMap.get(p.id) ? (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300/90" title="来自远程能力包">来自「{presetSourceMap.get(p.id)}」</span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-white/10 text-gray-400" title="本地添加">本地</span>
                    )}
                    {p.instruction ? <span className="text-gray-600 truncate max-w-[200px] inline-block align-bottom" title={p.instruction}>{p.instruction.slice(0, 30)}…</span> : null}
                  </div>
                  {p.instruction ? (
                    <p className="mt-1 text-[9px] text-gray-500 break-words line-clamp-2">{p.instruction}</p>
                  ) : (
                    <p className="mt-1 text-[9px] text-gray-600">（使用内置逻辑或未设置预设提示词）</p>
                  )}
                  {p.category === 'generate_3d' && p.generate3D && (
                    <p className="mt-1 text-[8px] text-amber-500/90">
                      {p.generate3D.module === 'pro' ? '专业版' : '极速版'}
                      {p.generate3D.model ? ` ${p.generate3D.model}` : ''}
                      {p.generate3D.enablePBR ? ' · PBR' : ''}
                      {p.generate3D.generateType ? ` · ${p.generate3D.generateType}` : ''}
                      {p.generate3D.faceCount ? ` · ${p.generate3D.faceCount} 面` : ''}
                      — 工作流中拖图到本能力即按此预设提交3D
                    </p>
                  )}
                  {onRunTest && p.category !== 'generate_3d' && (
                    <div className="mt-3 pt-3 border-t border-white/10">
                      <div className="text-[8px] font-black text-gray-500 uppercase mb-2">测试区域</div>
                      <div className="flex flex-wrap gap-2 items-center">
                        <input
                          ref={(el) => { fileInputRef.current[p.id] = el; }}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleFile(p.id, e)}
                        />
                        <button type="button" onClick={() => fileInputRef.current[p.id]?.click()} className="px-2 py-1.5 rounded-lg bg-white/10 text-[8px] font-black uppercase hover:bg-white/20">
                          上传测试图
                        </button>
                        <button
                          type="button"
                          disabled={!testImage[p.id] || testRunning[p.id]}
                          onClick={() => runTest(p)}
                          className="px-2 py-1.5 rounded-lg bg-amber-600/80 text-[8px] font-black uppercase hover:bg-amber-500 disabled:opacity-50 disabled:pointer-events-none"
                        >
                          {testRunning[p.id] ? '运行中…' : '运行测试'}
                        </button>
                        {testImage[p.id] && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[8px] text-gray-500">预览：</span>
                            <img src={testImage[p.id]} alt="测试图" className="h-12 w-12 object-cover rounded border border-white/20 shrink-0" />
                          </div>
                        )}
                      </div>
                      {testResult[p.id] != null && (
                        <div className="mt-2 p-2 rounded-lg bg-black/30 border border-white/10">
                          <div className="text-[9px] flex items-center gap-2 flex-wrap">
                            {testResult[p.id]!.ok ? (
                              <>
                                <span className="text-green-500 font-medium">完成</span>
                                {testResult[p.id]!.cutCount != null && <span className="text-gray-500">裁剪 {testResult[p.id]!.cutCount} 张</span>}
                                <span className="text-gray-500">{testResult[p.id]!.durationMs}ms</span>
                              </>
                            ) : (
                              <span className="text-red-400">{testResult[p.id]!.error ?? '失败'}</span>
                            )}
                          </div>
                          {testResult[p.id]!.ok && testResult[p.id]!.resultImage && (
                            <div className="mt-2">
                              <span className="text-[8px] text-gray-500 uppercase">结果预览（点击放大）</span>
                              <button type="button" onClick={() => setLightboxImage(testResult[p.id]!.resultImage!)} className="mt-1 block w-full text-left">
                                <img src={testResult[p.id]!.resultImage} alt="结果" className="max-h-32 w-auto max-w-full rounded border border-white/10 object-contain cursor-pointer hover:border-blue-500/50 transition-colors" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}

          {effectiveUninstalledPresetItems.map((rp) => (
            <div key={`remote-${rp.pack.id}-${rp.preset.id}`} className="rounded-2xl border border-white/10 bg-black/40 p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-black uppercase">{rp.preset.label}</span>
                  <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-gray-500/20 text-gray-400">
                    未安装
                  </span>
                  {rp.preset.category === 'image_process' && getEngine(rp.preset) === 'gen_image' && (
                    <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-amber-500/20 text-amber-300">
                      生图执行
                    </span>
                  )}
                </div>
                <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-white/10 text-gray-400">
                  {CAPABILITY_CATEGORIES.find((c) => c.id === rp.preset.category)?.label ?? rp.preset.category}
                </span>
                <button
                  type="button"
                  onClick={() => installSinglePreset(rp.preset)}
                  disabled={catalogLoading || packContentsLoading}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[9px] font-black uppercase"
                >
                  安装
                </button>
              </div>
              <div className="mt-2 text-[8px] text-gray-500 space-x-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>id: {rp.preset.id}</span>
                <span>分类: {rp.preset.category}</span>
                {rp.preset.instruction && (
                  <span className="text-gray-600 truncate max-w-[200px] inline-block" title={rp.preset.instruction}>
                    {rp.preset.instruction.slice(0, 30)}…
                  </span>
                )}
              </div>
              {rp.preset.instruction ? (
                <p className="mt-1 text-[9px] text-gray-500 break-words line-clamp-2">{rp.preset.instruction}</p>
              ) : (
                <p className="mt-1 text-[9px] text-gray-600">（使用内置逻辑或未设置预设提示词）</p>
              )}
            </div>
          ))}
          </>
        )}
      </div>

      {lightboxImage && (
        <div
          className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
          onClick={() => setLightboxImage(null)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Escape' && setLightboxImage(null)}
          aria-label="关闭"
        >
          <button type="button" onClick={() => setLightboxImage(null)} className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center text-white/70 hover:text-white rounded-full bg-white/10">✕</button>
          <img src={lightboxImage} alt="结果大图" className="max-h-[90vh] max-w-full object-contain rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default CapabilityPresetSection;
