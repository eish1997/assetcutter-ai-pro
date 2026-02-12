import React, { useState, useRef } from 'react';
import type { CustomAppModule, CapabilityCategory, CapabilityEngine, DialogImageGear, Generate3DPreset } from '../types';
import { CAPABILITY_CATEGORIES, DIALOG_IMAGE_GEARS } from '../types';
import type { CapabilityTestResult } from '../services/capabilityTestRunner';

const DEFAULT_GENERATE_3D: Generate3DPreset = { module: 'pro', model: '3.0', enablePBR: false };

const CapabilityPresetSection: React.FC<{
  presets: CustomAppModule[];
  onUpdate: (next: CustomAppModule[]) => void;
  onRunTest?: (preset: CustomAppModule, imageBase64: string) => Promise<CapabilityTestResult>;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
}> = ({ presets, onUpdate, onRunTest, onLog }) => {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = typeof crypto !== 'undefined' ? crypto : null;
      if (c && typeof c.randomUUID === 'function') return String(c.randomUUID()).replace(/-/g, '').slice(0, 10);
    } catch {}
    return Math.random().toString(36).slice(2, 11);
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editCategory, setEditCategory] = useState<CapabilityCategory>('image_gen');
  const [editEngine, setEditEngine] = useState<CapabilityEngine>('gen_image');
  const [editEnabled, setEditEnabled] = useState(true);
  const [editImageGear, setEditImageGear] = useState<DialogImageGear>('fast');
  const [editInstruction, setEditInstruction] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newCategory, setNewCategory] = useState<CapabilityCategory>('image_gen');
  const [newEngine, setNewEngine] = useState<CapabilityEngine>('gen_image');
  const [newEnabled, setNewEnabled] = useState(true);
  const [newImageGear, setNewImageGear] = useState<DialogImageGear>('fast');
  const [newInstruction, setNewInstruction] = useState('');
  const [testImage, setTestImage] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<Record<string, CapabilityTestResult | null>>({});
  const [testRunning, setTestRunning] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<Record<string, HTMLInputElement | null>>({});
  const [newGenerate3D, setNewGenerate3D] = useState<Generate3DPreset>({ ...DEFAULT_GENERATE_3D });
  const [editGenerate3D, setEditGenerate3D] = useState<Generate3DPreset>({ ...DEFAULT_GENERATE_3D });
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [showImportExport, setShowImportExport] = useState(false);
  const [importText, setImportText] = useState('');

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
    setNewInstruction('');
    setNewGenerate3D({ ...DEFAULT_GENERATE_3D });
    setIsAdding(false);
  };

  const removePreset = (id: string) => {
    update(presets.filter((p) => p.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const exportJson = () => {
    try {
      const text = JSON.stringify(presets, null, 2);
      setImportText(text);
      setShowImportExport(true);
      void navigator.clipboard?.writeText(text).catch(() => {});
      onLog?.('info', '已生成预设 JSON（并尝试复制到剪贴板）', undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onLog?.('error', '导出失败', msg);
    }
  };

  const importJson = () => {
    try {
      const raw = (importText || '').trim();
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('JSON 必须为数组（CustomAppModule[]）');
      // 轻量校验 + 直接交给 App 层 normalize/迁移
      const list = parsed.filter((x) => x && typeof x === 'object') as CustomAppModule[];
      update(list);
      onLog?.('info', `已导入 ${list.length} 条能力预设`, undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onLog?.('error', '导入失败', msg);
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

  return (
    <div className="flex flex-col gap-6 animate-in fade-in max-w-3xl">
      <div className="flex items-center justify-between">
        <p className="text-[9px] text-gray-500">
          在此管理功能预设，工作流中的「功能区」将调用此处配置的项，拖拽图片到对应框即可执行。
        </p>
        <div className="flex gap-2">
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
        </div>
      </div>

      {showImportExport && (
        <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[9px] font-black text-gray-300 uppercase">导入 / 导出（JSON）</div>
            <div className="flex gap-2">
              <button onClick={exportJson} className="px-3 py-1.5 rounded-lg bg-white/10 text-[9px] font-black uppercase hover:bg-white/20">
                导出到文本框
              </button>
              <button onClick={importJson} className="px-3 py-1.5 rounded-lg bg-blue-600/80 text-[9px] font-black uppercase hover:bg-blue-500">
                从文本框导入
              </button>
              <button onClick={() => setShowImportExport(false)} className="px-3 py-1.5 rounded-lg bg-white/10 text-[9px] font-black uppercase hover:bg-white/20">
                关闭
              </button>
            </div>
          </div>
          <p className="text-[8px] text-gray-500">
            提示：导出会尝试复制到剪贴板；导入需要 JSON 为数组格式。导入后会覆盖当前预设列表。
          </p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={8}
            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-[10px] outline-none focus:border-blue-500 resize-none font-mono"
            placeholder="在此粘贴或查看 JSON（CustomAppModule[]）"
          />
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
              <label className="flex items-center gap-2 text-[9px] text-gray-400">
                <span className="font-black uppercase">生图档位</span>
                <select
                  value={newImageGear}
                  onChange={(e) => setNewImageGear(e.target.value as DialogImageGear)}
                  className="bg-white/10 border border-white/10 rounded px-2 py-1 text-[9px]"
                >
                  {DIALOG_IMAGE_GEARS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {newCategory === 'image_process' && (
              <label className="flex items-center gap-2 text-[9px] text-gray-400">
                <span className="font-black uppercase">执行方式</span>
                <select
                  value={newEngine}
                  onChange={(e) => setNewEngine(e.target.value as CapabilityEngine)}
                  className="bg-white/10 border border-white/10 rounded px-2 py-1 text-[9px]"
                >
                  <option value="builtin">图像处理（内置）</option>
                  <option value="gen_image">生图（提示词）</option>
                </select>
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
              <span className="text-[8px] font-black text-blue-400/90 uppercase">预设提示词（必填，传给生图模型）</span>
              <textarea
                value={newInstruction}
                onChange={(e) => setNewInstruction(e.target.value)}
                placeholder="描述希望的效果，如：将图片转为赛博朋克风格，霓虹灯与机械细节；或：生成该物体的多视角线稿图"
                rows={4}
                className="mt-1 w-full bg-white/5 border border-blue-500/30 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none"
              />
            </div>
          )}
          {newCategory === 'image_process' && (
            <div>
              <span className="text-[8px] font-black text-gray-500 uppercase">可选：补充说明或约束</span>
              <p className="text-[8px] text-gray-600 mt-0.5">多数能力有内置逻辑（如切割按版面分块），可留空；需要时可填写额外说明。</p>
              <textarea
                value={newInstruction}
                onChange={(e) => setNewInstruction(e.target.value)}
                placeholder="留空即使用内置逻辑；或填写如：只保留上半部分、排除背景"
                rows={2}
                className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none"
              />
            </div>
          )}
          {newCategory === 'generate_3d' && (
            <>
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                <div className="text-[8px] font-black text-amber-400 uppercase">生成3D 预设（工作流拖图即按此配置提交）</div>
                <div className="flex gap-2 flex-wrap">
                  <label className="flex items-center gap-1.5 text-[9px]">
                    <span>模块</span>
                    <select value={newGenerate3D.module} onChange={(e) => setNewGenerate3D((g) => ({ ...g, module: e.target.value as 'pro' | 'rapid' }))} className="bg-white/10 border border-white/10 rounded px-2 py-1 text-[9px]">
                      <option value="pro">专业版</option>
                      <option value="rapid">极速版</option>
                    </select>
                  </label>
                  {newGenerate3D.module === 'pro' && (
                    <label className="flex items-center gap-1.5 text-[9px]">
                      <span>模型</span>
                      <select value={newGenerate3D.model ?? '3.0'} onChange={(e) => setNewGenerate3D((g) => ({ ...g, model: e.target.value as '3.0' | '3.1' }))} className="bg-white/10 border border-white/10 rounded px-2 py-1 text-[9px]">
                        <option value="3.0">3.0</option>
                        <option value="3.1">3.1</option>
                      </select>
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
                        <select value={newGenerate3D.generateType ?? 'Normal'} onChange={(e) => setNewGenerate3D((g) => ({ ...g, generateType: e.target.value as Generate3DPreset['generateType'] }))} className="bg-white/10 border border-white/10 rounded px-2 py-1 text-[9px]">
                          <option value="Normal">Normal</option>
                          <option value="LowPoly">LowPoly</option>
                          <option value="Geometry">Geometry</option>
                          <option value="Sketch">Sketch</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-1.5 text-[9px]">
                        <span>格式</span>
                        <select value={newGenerate3D.resultFormat ?? ''} onChange={(e) => setNewGenerate3D((g) => ({ ...g, resultFormat: e.target.value || undefined }))} className="bg-white/10 border border-white/10 rounded px-2 py-1 text-[9px]">
                          <option value="">默认</option>
                          <option value="STL">STL</option>
                          <option value="USDZ">USDZ</option>
                          <option value="FBX">FBX</option>
                        </select>
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
        {presets.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black/40 p-8 text-center text-gray-500 text-[10px]">
            暂无功能预设，点击「新增功能预设」添加。添加后会在工作流的功能区显示对应框。
          </div>
        ) : (
          presets.map((p) => (
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
                      <label className="flex items-center gap-2 text-[9px] text-gray-400">
                        <span className="font-black uppercase">生图档位</span>
                        <select
                          value={editImageGear}
                          onChange={(e) => setEditImageGear(e.target.value as DialogImageGear)}
                          className="bg-white/10 border border-white/10 rounded px-2 py-1 text-[9px]"
                        >
                          {DIALOG_IMAGE_GEARS.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {editCategory === 'image_process' && (
                      <label className="flex items-center gap-2 text-[9px] text-gray-400">
                        <span className="font-black uppercase">执行方式</span>
                        <select
                          value={editEngine}
                          onChange={(e) => setEditEngine(e.target.value as CapabilityEngine)}
                          className="bg-white/10 border border-white/10 rounded px-2 py-1 text-[9px]"
                        >
                          <option value="builtin">图像处理（内置）</option>
                          <option value="gen_image">生图（提示词）</option>
                        </select>
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
                      <span className="text-[8px] font-black text-blue-400/90 uppercase">预设提示词（传给生图模型）</span>
                      <textarea
                        value={editInstruction}
                        onChange={(e) => setEditInstruction(e.target.value)}
                        rows={4}
                        className="mt-1 w-full bg-white/5 border border-blue-500/30 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-blue-500 resize-none"
                        placeholder="描述希望的效果"
                      />
                    </div>
                  )}
                  {editCategory === 'image_process' && (
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
                            <select value={editGenerate3D.module} onChange={(e) => setEditGenerate3D((g) => ({ ...g, module: e.target.value as 'pro' | 'rapid' }))} className="bg-white/10 border border-white/10 rounded px-2 py-1 text-[9px]">
                              <option value="pro">专业版</option>
                              <option value="rapid">极速版</option>
                            </select>
                          </label>
                          {editGenerate3D.module === 'pro' && (
                            <>
                              <label className="flex items-center gap-1.5 text-[9px]">
                                <span>模型</span>
                                <select value={editGenerate3D.model ?? '3.0'} onChange={(e) => setEditGenerate3D((g) => ({ ...g, model: e.target.value as '3.0' | '3.1' }))} className="bg-white/10 border border-white/10 rounded px-2 py-1 text-[9px]">
                                  <option value="3.0">3.0</option>
                                  <option value="3.1">3.1</option>
                                </select>
                              </label>
                              <label className="flex items-center gap-1.5 text-[9px]">
                                <span>面数</span>
                                <input type="number" min={10000} max={1500000} value={editGenerate3D.faceCount ?? 500000} onChange={(e) => setEditGenerate3D((g) => ({ ...g, faceCount: e.target.value ? parseInt(e.target.value, 10) : undefined }))} className="w-20 bg-white/10 border border-white/10 rounded px-2 py-1 text-[9px]" />
                              </label>
                              <label className="flex items-center gap-1.5 text-[9px]">
                                <span>类型</span>
                                <select value={editGenerate3D.generateType ?? 'Normal'} onChange={(e) => setEditGenerate3D((g) => ({ ...g, generateType: e.target.value as Generate3DPreset['generateType'] }))} className="bg-white/10 border border-white/10 rounded px-2 py-1 text-[9px]">
                                  <option value="Normal">Normal</option>
                                  <option value="LowPoly">LowPoly</option>
                                  <option value="Geometry">Geometry</option>
                                  <option value="Sketch">Sketch</option>
                                </select>
                              </label>
                              <label className="flex items-center gap-1.5 text-[9px]">
                                <span>格式</span>
                                <select value={editGenerate3D.resultFormat ?? ''} onChange={(e) => setEditGenerate3D((g) => ({ ...g, resultFormat: e.target.value || undefined }))} className="bg-white/10 border border-white/10 rounded px-2 py-1 text-[9px]">
                                  <option value="">默认</option>
                                  <option value="STL">STL</option>
                                  <option value="USDZ">USDZ</option>
                                  <option value="FBX">FBX</option>
                                </select>
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
                      {p.enabled === false && (
                        <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-red-500/20 text-red-400">
                          已禁用
                        </span>
                      )}
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
                          setEditInstruction(p.instruction);
                          setEditGenerate3D(p.category === 'generate_3d' && p.generate3D ? { ...p.generate3D } : { ...DEFAULT_GENERATE_3D });
                        }}
                        className="px-2 py-1 rounded-lg bg-white/10 text-[8px] font-black uppercase hover:bg-white/20"
                      >
                        编辑
                      </button>
                      <button onClick={() => removePreset(p.id)} className="px-2 py-1 rounded-lg bg-red-500/20 text-red-400 text-[8px] font-black uppercase hover:bg-red-500/30">删除</button>
                    </div>
                  </div>
                  <div className="mt-2 text-[8px] text-gray-500 space-x-3">
                    <span>id: {p.id}</span>
                    <span>分类: {p.category}</span>
                    <span>指令: {p.instruction?.length ?? 0} 字</span>
                    {p.instruction ? <span className="text-gray-600 truncate max-w-[200px] inline-block align-bottom" title={p.instruction}>{p.instruction.slice(0, 30)}…</span> : null}
                  </div>
                  {p.instruction ? (
                    <p className="mt-1 text-[9px] text-gray-500 break-words line-clamp-2">{p.instruction}</p>
                  ) : (
                    <p className="mt-1 text-[9px] text-gray-600">（使用内置逻辑或未设置指令）</p>
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
          ))
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
    </div>
  );
};

export default CapabilityPresetSection;
