import React, { useState, useCallback, useMemo } from 'react';
import type { WorkflowAsset, WorkflowPendingTask, WorkflowActionModule } from '../types';
import type { CustomAppModule, LibraryItem, WorkflowCutGroupItem } from '../types';
import type { BoundingBox } from '../types';
import { WORKFLOW_ACTION_TYPES, CAPABILITY_CATEGORIES } from '../types';
import { detectObjectsInImage, dialogGenerateImage, DEFAULT_PROMPTS } from '../services/geminiService';

const uuid = () => Math.random().toString(36).slice(2, 11);

/** 裁剪图片：根据框选裁剪出多张图 */
function cropBoxes(inputImage: string, boxes: BoundingBox[], selectedIndexes: number[]): string[] {
  const results: string[] = [];
  const img = new Image();
  img.src = inputImage;
  return new Promise<string[]>((resolve) => {
    img.onload = () => {
      const scaleX = img.naturalWidth / 1000;
      const scaleY = img.naturalHeight / 1000;
      for (const i of selectedIndexes) {
        if (i < 0 || i >= boxes.length) continue;
        const b = boxes[i];
        const x = Math.max(0, b.xmin * scaleX);
        const y = Math.max(0, b.ymin * scaleY);
        const w = Math.min(img.naturalWidth - x, (b.xmax - b.xmin) * scaleX);
        const h = Math.min(img.naturalHeight - y, (b.ymax - b.ymin) * scaleY);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        results.push(canvas.toDataURL('image/png'));
      }
      resolve(results);
    };
    img.onerror = () => resolve([]);
  }).then((r) => r);
}

// ---------- 切割图片：识别物体后选择要保存的区域 ----------
const CutSelectModal: React.FC<{
  inputImage: string;
  boxes: BoundingBox[];
  onConfirm: (selectedIndexes: number[]) => void;
  onCancel: () => void;
}> = ({ inputImage, boxes, onConfirm, onCancel }) => {
  const [selected, setSelected] = useState<Set<number>>(new Set(boxes.map((_, i) => i)));
  const toggle = (i: number) => setSelected((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const scale = 1000;
  return (
    <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4" onClick={onCancel}>
      <div className="relative max-w-4xl w-full max-h-[90vh] overflow-auto rounded-2xl border border-white/10 bg-black/80 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-[10px] font-black uppercase text-blue-400">识别到物体，勾选要切割保存的区域</h3>
          <button onClick={onCancel} className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white">✕</button>
        </div>
        <div className="relative inline-block max-w-full">
          <img src={inputImage} alt="" className="max-h-[60vh] w-auto block" />
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ left: 0, top: 0 }} viewBox={`0 0 ${scale} ${scale}`} preserveAspectRatio="none">
            {boxes.map((b, i) => (
              <rect
                key={i}
                x={b.xmin}
                y={b.ymin}
                width={b.xmax - b.xmin}
                height={b.ymax - b.ymin}
                fill="none"
                stroke={selected.has(i) ? 'rgba(34,197,94,0.8)' : 'rgba(239,68,68,0.5)'}
                strokeWidth={selected.has(i) ? 8 : 4}
              />
            ))}
          </svg>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {boxes.map((b, i) => (
            <label key={i} className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
              <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} className="rounded" />
              <span className="text-[9px] font-black uppercase">{b.label || `区域 ${i + 1}`}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={() => onConfirm([...selected])} disabled={selected.size === 0} className="px-4 py-2 rounded-xl bg-blue-600 text-[10px] font-black uppercase disabled:opacity-40">确认切割（{selected.size}）</button>
          <button onClick={onCancel} className="px-4 py-2 rounded-xl bg-white/10 text-[10px] font-black uppercase">取消</button>
        </div>
      </div>
    </div>
  );
};

// ---------- 归档详情弹窗：流程图 + 单张/整张下载 ----------
const ArchivedDetailModal: React.FC<{
  asset: WorkflowAsset;
  modules: WorkflowActionModule[];
  onClose: () => void;
}> = ({ asset, modules, onClose }) => {
  const steps = useMemo(() => {
    const list: { label: string; image: string; executedAt?: number }[] = [
      { label: '原始', image: asset.original },
    ];
    for (const id of asset.resultOrder) {
      const img = asset.results[id];
      if (!img) continue;
      const mod = modules.find((m) => m.id === id);
      list.push({
        label: mod?.label ?? id,
        image: img,
        executedAt: asset.resultMeta?.[id]?.executedAt,
      });
    }
    return list;
  }, [asset, modules]);

  const [compositeUrl, setCompositeUrl] = useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const buildComposite = useCallback(() => {
    if (steps.length === 0) return;
    const maxW = 800;
    const lineHeight = 24;
    const gap = 8;
    const loadAll = (): Promise<{ img: HTMLImageElement; drawH: number; scale: number }[]> => {
      return Promise.all(
        steps.map(
          (s) =>
            new Promise<{ img: HTMLImageElement; drawH: number; scale: number }>((resolve) => {
              const img = new Image();
              img.onload = () => {
                const scale = maxW / img.naturalWidth;
                const drawH = Math.min(400, img.naturalHeight * scale);
                resolve({ img, drawH, scale });
              };
              img.onerror = () => resolve({ img, drawH: 200, scale: 1 });
              img.src = s.image;
            })
        )
      );
    };

    loadAll().then((loaded) => {
      let height = 40;
      loaded.forEach((l) => {
        height += lineHeight + gap + l.drawH + gap;
      });
      const canvas = document.createElement('canvas');
      canvas.width = maxW + 40;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      let y = 20;
      steps.forEach((s, i) => {
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(s.label + (s.executedAt ? ` · ${new Date(s.executedAt).toLocaleString()}` : ''), 20, y + 16);
        y += lineHeight + gap;
        const { img, drawH, scale } = loaded[i];
        if (img && img.complete && img.naturalWidth) {
          const w = img.naturalWidth * scale;
          ctx.drawImage(img, 20, y, w, drawH);
          y += drawH + gap;
        } else {
          y += 200 + gap;
        }
      });
      setCompositeUrl(canvas.toDataURL('image/png'));
    });
  }, [steps]);

  React.useEffect(() => {
    buildComposite();
  }, [buildComposite]);

  const downloadOne = (image: string, label: string) => {
    const a = document.createElement('a');
    a.href = image;
    a.download = `workflow-${label}-${asset.id.slice(0, 6)}.png`;
    a.click();
  };

  const downloadComposite = () => {
    if (!compositeUrl) return;
    const a = document.createElement('a');
    a.href = compositeUrl;
    a.download = `workflow-flow-${asset.id.slice(0, 6)}.png`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4 overflow-y-auto" onClick={onClose}>
      <div ref={containerRef} className="relative max-w-4xl w-full bg-black/60 rounded-2xl border border-white/10 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[10px] font-black uppercase text-blue-400">归档详情 · 生成流程图</h3>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center text-white/60 hover:text-white">✕</button>
        </div>
        <div className="space-y-4">
          {steps.map((s, i) => (
            <div key={i} className="rounded-xl border border-white/10 overflow-hidden bg-black/40">
              <div className="px-3 py-2 flex items-center justify-between border-b border-white/5">
                <span className="text-[9px] font-black uppercase text-gray-300">{s.label}</span>
                {s.executedAt != null && (
                  <span className="text-[8px] text-gray-500">{new Date(s.executedAt).toLocaleString()}</span>
                )}
                <button
                  onClick={() => downloadOne(s.image, s.label)}
                  className="px-2 py-1 rounded-lg bg-white/10 text-[8px] font-black uppercase hover:bg-white/20"
                >
                  下载此张
                </button>
              </div>
              <img src={s.image} alt={s.label} className="w-full max-h-[320px] object-contain bg-black/40" />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span className="text-[9px] text-gray-500">拼合后的流程图（按生成顺序）</span>
          {compositeUrl && (
            <>
              <img src={compositeUrl} alt="流程图" className="max-h-48 rounded-lg border border-white/10" />
              <button
                onClick={downloadComposite}
                className="px-4 py-2 rounded-xl bg-blue-600 text-[10px] font-black uppercase hover:bg-blue-500"
              >
                下载整张流程图
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------- 主组件 ----------
const WorkflowSection: React.FC<{
  capabilityPresets: CustomAppModule[];
  assets: WorkflowAsset[];
  onAssetsChange: (value: React.SetStateAction<WorkflowAsset[]>) => void;
  pending: WorkflowPendingTask[];
  onPendingChange: (value: React.SetStateAction<WorkflowPendingTask[]>) => void;
  onOpenLibraryPicker?: (callback: (items: LibraryItem[]) => void) => void;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
  /** 拖图到「生成3D」能力时调用，不进入执行队列，直接提交 3D 任务 */
  onAddGenerate3DJob?: (preset: CustomAppModule, imageBase64: string) => void;
}> = ({ capabilityPresets, assets: assetsProp, onAssetsChange: setAssets, pending: pendingProp, onPendingChange: setPending, onOpenLibraryPicker, onLog, onAddGenerate3DJob }) => {
  const assets = Array.isArray(assetsProp) ? assetsProp : [];
  const pending = Array.isArray(pendingProp) ? pendingProp : [];
  const pendingRef = React.useRef(pending);
  pendingRef.current = pending;
  const assetsRef = React.useRef(assets);
  assetsRef.current = assets;
  const presets = Array.isArray(capabilityPresets) ? capabilityPresets : [];
  const actionModules: WorkflowActionModule[] = presets;
  const byCategory = useMemo(() => {
    const knownIds = new Set(CAPABILITY_CATEGORIES.map((c) => c.id));
    const map: Record<string, CustomAppModule[]> = {};
    CAPABILITY_CATEGORIES.forEach((c) => { map[c.id] = []; });
    const other: CustomAppModule[] = [];
    presets.forEach((p) => {
      const cat = p.category ?? 'image_process';
      if (knownIds.has(cat)) {
        map[cat].push(p);
      } else {
        other.push(p);
      }
    });
    const groups = CAPABILITY_CATEGORIES.map((c) => ({ category: c, list: map[c.id] ?? [] })).filter((g) => g.list.length > 0);
    if (other.length > 0) groups.push({ category: { id: 'other', label: '其他', desc: '' }, list: other });
    return groups;
  }, [presets]);
  const [columnCount, setColumnCount] = useState(4);
  const [showArchived, setShowArchived] = useState(false);
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const [archivedDetailAssetId, setArchivedDetailAssetId] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executingQueue, setExecutingQueue] = useState<{ total: number; current: number; tasks: WorkflowPendingTask[] } | null>(null);
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const [dragOverAction, setDragOverAction] = useState<string | null>(null);
  const [cutSelectState, setCutSelectState] = useState<{
    task: WorkflowPendingTask;
    inputImage: string;
    boxes: BoundingBox[];
    remaining: WorkflowPendingTask[];
  } | null>(null);
  const [viewStack, setViewStack] = useState<{ assetId: string }[]>([]);
  const [showAllInGroup, setShowAllInGroup] = useState(false);
  const [draggingGroupItem, setDraggingGroupItem] = useState<{ image: string; groupAssetId: string; itemIndex: number } | null>(null);

  const getModule = (id: string) => actionModules.find((m) => m.id === id);

  const getAssetDisplayImage = (a: WorkflowAsset, assetsList: WorkflowAsset[] = assets, visited: Set<string> = new Set()): string => {
    if (a.displayKey === 'original') return a.original;
    if (a.displayKey === 'cut_image' && a.cutImageGroup?.length) {
      const first = a.cutImageGroup[0];
      if (typeof first === 'string') return first;
      if (visited.has(a.id)) return a.original;
      visited.add(a.id);
      const child = assetsList.find((x) => x.id === first.assetId);
      return child ? getAssetDisplayImage(child, assetsList, visited) : a.original;
    }
    return a.results[a.displayKey] ?? a.original;
  };

  const addToPending = useCallback((assetId: string, actionType: string) => {
    const asset = assets.find((x) => x.id === assetId);
    if (!asset) return;
    const inputImage = getAssetDisplayImage(asset);
    setPending((prev) => [...prev, { id: uuid(), assetId, actionType, inputImage, addedAt: Date.now() }]);
    setAssets((prev) => prev.map((x) => (x.id === assetId ? { ...x, hiddenInGrid: true } : x)));
  }, [assets]);

  const removeFromPending = useCallback((taskId: string) => {
    const task = pending.find((t) => t.id === taskId);
    setPending((prev) => prev.filter((t) => t.id !== taskId));
    if (task) {
      setAssets((prev) => prev.map((x) => (x.id === task.assetId ? { ...x, hiddenInGrid: false } : x)));
    }
  }, [pending]);

  const runTask = async (task: WorkflowPendingTask): Promise<string | null> => {
    const { actionType, inputImage } = task;
    const module = getModule(actionType);
    if (module?.category === 'generate_3d') {
      onLog?.('warn', '生成3D 请拖图到能力框提交，不进入执行队列');
      return null;
    }
    const instruction = module?.instruction ?? '';
    const actionLabel = module?.label ?? actionType;
    try {
      if (actionType === 'split_component') {
        onLog?.('info', `[${actionLabel}] 识别物体中…`);
        const boxes = await detectObjectsInImage(inputImage);
        if (boxes.length === 0) {
          onLog?.('warn', `[${actionLabel}] 未识别到区域`);
          return null;
        }
        const b = boxes[0];
        const img = new Image();
        img.src = inputImage;
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = rej;
        });
        const scaleX = img.naturalWidth / 1000;
        const scaleY = img.naturalHeight / 1000;
        const x = Math.max(0, b.xmin * scaleX);
        const y = Math.max(0, b.ymin * scaleY);
        const w = Math.min(img.naturalWidth - x, (b.xmax - b.xmin) * scaleX);
        const h = Math.min(img.naturalHeight - y, (b.ymax - b.ymin) * scaleY);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        const cropped = canvas.toDataURL('image/png');
        if (instruction.trim()) {
          onLog?.('info', `[${actionLabel}] 按能力提示词生成中…`);
          const result = await dialogGenerateImage(cropped, instruction.trim(), 'gemini-2.5-flash-image');
          if (result) onLog?.('info', `[${actionLabel}] 完成`);
          return result ?? cropped;
        }
        onLog?.('info', `[${actionLabel}] 完成（裁剪首区）`);
        return cropped;
      }
      if (actionType === 'style_transfer' || actionType === 'multi_view' || (module && !WORKFLOW_ACTION_TYPES.find((t) => t.id === actionType))) {
        const prompt = instruction.trim() || 'Apply the requested transformation to this image. Keep the same composition.';
        onLog?.('info', `[${actionLabel}] 生图中…`);
        const result = await dialogGenerateImage(inputImage, prompt, 'gemini-2.5-flash-image');
        if (result) onLog?.('info', `[${actionLabel}] 完成`);
        return result ?? null;
      }
      if (actionType === 'cut_image') {
        return null;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog?.('error', `[${actionLabel}] 失败`, msg);
      return null;
    }
    return null;
  };

  const executePending = useCallback(
    async (overridePending?: WorkflowPendingTask[]) => {
      const toProcess = overridePending ?? [...pendingRef.current];
      if (toProcess.length === 0 || executing) return;
      if (!overridePending) setPending([]);
      setExecuting(true);
      setExecutingQueue({ total: toProcess.length, current: 0, tasks: toProcess });
      onLog?.('info', `开始执行队列（${toProcess.length} 项）`);
      const now = Date.now();
      for (let i = 0; i < toProcess.length; i++) {
        setExecutingQueue((prev) => (prev ? { ...prev, current: i + 1 } : null));
        const task = toProcess[i];
        const taskLabel = getModule(task.actionType)?.label ?? task.actionType;
        if (task.actionType === 'cut_image') {
          onLog?.('info', `[${i + 1}/${toProcess.length}] ${taskLabel} 识别并切割中…`);
          const inputImage = task.inputImage || assetsRef.current.find((a) => a.id === task.assetId)?.original;
          if (!inputImage) {
            setExecuting(false);
            setExecutingQueue(null);
            setPending(toProcess.slice(i));
            return;
          }
          let boxes: BoundingBox[] = [];
          try {
            boxes = await Promise.race([
              detectObjectsInImage(inputImage, 'gemini-3-flash-preview', DEFAULT_PROMPTS.detect_blocks),
              new Promise<BoundingBox[]>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
            ]);
          } catch (_) {}
          if (!boxes.length) {
            boxes = [{ id: 'full', label: '整图', xmin: 0, ymin: 0, xmax: 1000, ymax: 1000 }];
          }
          const allIndexes = boxes.map((_, j) => j);
          const cropped = await cropBoxes(inputImage, boxes, allIndexes);
          const group: WorkflowCutGroupItem[] = cropped;
          setAssets((prev) =>
            prev.map((a) => {
              if (a.id !== task.assetId) return a;
              const nextOrder = [...(a.resultOrder || []), task.actionType];
              const nextMeta = { ...(a.resultMeta || {}), [task.actionType]: { executedAt: Date.now() } };
              return {
                ...a,
                cutImageGroup: group,
                resultOrder: nextOrder,
                resultMeta: nextMeta,
                displayKey: 'cut_image',
                hiddenInGrid: false,
              };
            })
          );
          if (task.sourceGroupAssetId != null && task.sourceItemIndex != null) {
            replaceGroupItemWithSubAsset(task.sourceGroupAssetId, task.sourceItemIndex, task.assetId);
          }
          onLog?.('info', `[${i + 1}/${toProcess.length}] ${taskLabel} 完成（${cropped.length} 张入组）`);
          continue;
        }
        onLog?.('info', `[${i + 1}/${toProcess.length}] ${taskLabel} 执行中…`);
        const result = await runTask(task);
        setAssets((prev) =>
          prev.map((a) => {
            if (a.id !== task.assetId) return a;
            const nextResults = { ...a.results, [task.actionType]: result ?? a.original };
            const nextOrder = result ? [...(a.resultOrder || []), task.actionType] : (a.resultOrder || []);
            const nextMeta = { ...(a.resultMeta || {}), [task.actionType]: { executedAt: now } };
            return {
              ...a,
              results: nextResults,
              resultOrder: nextOrder,
              resultMeta: nextMeta,
              displayKey: result ? task.actionType : a.displayKey,
              hiddenInGrid: false,
            };
          })
        );
      }
      onLog?.('info', '队列执行完成');
      setExecuting(false);
      setExecutingQueue(null);
    },
    [executing, onLog]
  );

  const replaceGroupItemWithSubAsset = useCallback((groupAssetId: string, itemIndex: number, subAssetId: string) => {
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== groupAssetId || !a.cutImageGroup) return a;
        const next = [...a.cutImageGroup];
        if (itemIndex >= 0 && itemIndex < next.length) next[itemIndex] = { assetId: subAssetId };
        return { ...a, cutImageGroup: next };
      })
    );
  }, []);

  const onCutConfirm = useCallback(
    async (selectedIndexes: number[]) => {
      if (!cutSelectState) return;
      const { task, inputImage, boxes, remaining } = cutSelectState;
      const cropped = await cropBoxes(inputImage, boxes, selectedIndexes);
      if (cropped.length === 0) {
        setCutSelectState(null);
        setPending(remaining);
        setExecuting(false);
        return;
      }
      const group: WorkflowCutGroupItem[] = cropped;
      setAssets((prev) =>
        prev.map((a) => {
          if (a.id !== task.assetId) return a;
          const nextOrder = [...(a.resultOrder || []), task.actionType];
          const nextMeta = { ...(a.resultMeta || {}), [task.actionType]: { executedAt: Date.now() } };
          return {
            ...a,
            cutImageGroup: group,
            resultOrder: nextOrder,
            resultMeta: nextMeta,
            displayKey: 'cut_image',
            hiddenInGrid: false,
          };
        })
      );
      if (task.sourceGroupAssetId != null && task.sourceItemIndex != null) {
        replaceGroupItemWithSubAsset(task.sourceGroupAssetId, task.sourceItemIndex, task.assetId);
      }
      setCutSelectState(null);
      if (remaining.length > 0) executePending(remaining);
      else setExecuting(false);
    },
    [cutSelectState, setAssets, setPending, executePending, replaceGroupItemWithSubAsset]
  );

  const addImagesFromFiles = useCallback((files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/')).slice(0, 50);
    imageFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setAssets((prev) => [
          ...prev,
          {
            id: uuid(),
            original: reader.result as string,
            displayKey: 'original',
            results: {},
            resultOrder: [],
            archived: false,
            hiddenInGrid: false,
            createdAt: Date.now(),
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const handleBatchUploadCorrect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    addImagesFromFiles(Array.from(files));
    e.target.value = '';
  };

  const [dropZoneActive, setDropZoneActive] = useState(false);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDropZoneActive(false);
    const files = e.dataTransfer?.files;
    if (files?.length) addImagesFromFiles(Array.from(files));
  }, [addImagesFromFiles]);
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items?.length) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) files.push(items[i].getAsFile()!);
    }
    if (files.length) {
      e.preventDefault();
      addImagesFromFiles(files);
    }
  }, [addImagesFromFiles]);

  const visibleAssets = useMemo(() => {
    return assets.filter((a) => a.archived === showArchived && (!a.hiddenInGrid || a.archived));
  }, [assets, showArchived]);

  const lightboxAsset = lightboxAssetId ? assets.find((a) => a.id === lightboxAssetId) : null;
  const lightboxList = assets.filter((a) => !a.archived && !a.hiddenInGrid);
  const lightboxIndex = lightboxAssetId ? lightboxList.findIndex((a) => a.id === lightboxAssetId) : -1;
  const goLightbox = (delta: number) => {
    if (lightboxList.length === 0) return;
    const next = (lightboxIndex + delta + lightboxList.length) % lightboxList.length;
    setLightboxAssetId(lightboxList[next].id);
  };

  const setDisplayKey = (assetId: string, key: string) => {
    setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, displayKey: key } : a)));
  };

  const discardResult = (assetId: string, actionType: string) => {
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== assetId) return a;
        const nextResults = { ...a.results };
        delete nextResults[actionType];
        const nextOrder = (a.resultOrder || []).filter((k) => k !== actionType);
        const nextMeta = { ...a.resultMeta };
        delete nextMeta[actionType];
        const displayKey = a.displayKey === actionType ? 'original' : a.displayKey;
        const cutImageGroup = actionType === 'cut_image' ? undefined : a.cutImageGroup;
        return { ...a, results: nextResults, resultOrder: nextOrder, resultMeta: nextMeta, displayKey, cutImageGroup };
      })
    );
  };

  const markArchived = (assetId: string) => {
    setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, archived: true, hiddenInGrid: false } : a)));
  };

  const archivedDetailAsset = archivedDetailAssetId ? assets.find((a) => a.id === archivedDetailAssetId) : null;

  const currentGroupAsset = viewStack.length > 0 ? assets.find((a) => a.id === viewStack[viewStack.length - 1].assetId) : null;
  const currentGroupItems = currentGroupAsset?.cutImageGroup ?? [];

  const flattenGroupImages = useCallback(
    (asset: WorkflowAsset, visited: Set<string> = new Set()): string[] => {
      if (visited.has(asset.id)) return [];
      visited.add(asset.id);
      const out: string[] = [];
      for (const item of asset.cutImageGroup ?? []) {
        if (typeof item === 'string') out.push(item);
        else {
          const child = assets.find((x) => x.id === item.assetId);
          if (child?.cutImageGroup?.length) out.push(...flattenGroupImages(child, visited));
          else if (child) out.push(getAssetDisplayImage(child));
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

  const addImageToPending = useCallback(
    (
      imageBase64: string,
      actionType: string,
      opts?: { parentAssetId?: string; sourceGroupAssetId?: string; sourceItemIndex?: number }
    ) => {
      const newAsset: WorkflowAsset = {
        id: uuid(),
        original: imageBase64,
        displayKey: 'original',
        results: {},
        resultOrder: [],
        archived: false,
        hiddenInGrid: true,
        createdAt: Date.now(),
        ...(opts?.parentAssetId ? { parentAssetId: opts.parentAssetId } : {}),
      };
      setAssets((prev) => [...prev, newAsset]);
      setPending((prev) => [
        ...prev,
        {
          id: uuid(),
          assetId: newAsset.id,
          actionType,
          inputImage: imageBase64,
          addedAt: Date.now(),
          ...(opts?.sourceGroupAssetId != null && opts?.sourceItemIndex != null
            ? { sourceGroupAssetId: opts.sourceGroupAssetId, sourceItemIndex: opts.sourceItemIndex }
            : {}),
        },
      ]);
    },
    [setAssets, setPending]
  );

  return (
    <div className="flex flex-col min-h-[400px] h-[calc(100dvh-6rem)] gap-4">
      <div className="flex flex-wrap items-center gap-4 shrink-0">
        <span className="text-[10px] font-black text-blue-400 uppercase mr-2">工作流</span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-black text-gray-500 uppercase">显示</span>
          <button
            onClick={() => setShowArchived(false)}
            className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border ${!showArchived ? 'bg-blue-600 border-blue-500 text-white' : 'bg-white/5 border-white/10 text-gray-500 hover:bg-white/10'}`}
          >
            进行中
          </button>
          <button
            onClick={() => setShowArchived(true)}
            className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border ${showArchived ? 'bg-blue-600 border-blue-500 text-white' : 'bg-white/5 border-white/10 text-gray-500 hover:bg-white/10'}`}
          >
            已完成
          </button>
        </div>
        <label className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[9px] font-black uppercase cursor-pointer hover:bg-white/10">
          多选上传
          <input type="file" className="hidden" accept="image/*" multiple onChange={handleBatchUploadCorrect} />
        </label>
        {onOpenLibraryPicker && (
          <button
            type="button"
            onClick={() => onOpenLibraryPicker((items) => {
              const valid = items.filter((item) => item?.data);
              if (!valid.length) return;
              setAssets((prev) => [
                ...prev,
                ...valid.map((item) => ({
                  id: uuid(),
                  original: item.data,
                  displayKey: 'original' as const,
                  results: {} as Record<string, string>,
                  resultOrder: [] as string[],
                  archived: false,
                  hiddenInGrid: false,
                  createdAt: Date.now(),
                })),
              ]);
            })}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[9px] font-black uppercase hover:bg-white/10"
          >
            从仓库导入
          </button>
        )}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-black text-gray-500 uppercase">瀑布流列数</span>
          {[2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              onClick={() => setColumnCount(n)}
              className={`w-8 h-8 rounded-lg text-[10px] font-black border ${columnCount === n ? 'bg-blue-600 border-blue-500' : 'bg-white/5 border-white/10 text-gray-500 hover:bg-white/10'}`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`shrink-0 rounded-xl border-2 border-dashed p-4 text-center transition-colors ${dropZoneActive ? 'border-blue-500 bg-blue-500/10' : 'border-white/20 bg-white/5'}`}
        onDragOver={(e) => { e.preventDefault(); setDropZoneActive(true); }}
        onDragLeave={() => setDropZoneActive(false)}
        onDrop={handleDrop}
        onPaste={handlePaste}
        tabIndex={0}
      >
        <span className="text-[9px] font-black uppercase text-gray-500">拖拽图片到此处，或在此区域按 Ctrl+V 粘贴</span>
      </div>

      <div className="flex-1 min-h-0 flex gap-6">
        <div className="flex-1 min-w-0 overflow-y-auto no-scrollbar flex flex-col gap-3">
          {viewStack.length > 0 ? (
            <>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setViewStack((s) => s.slice(0, -1))}
                  className="px-3 py-1.5 rounded-lg bg-white/10 text-[9px] font-black uppercase hover:bg-white/20"
                >
                  ← 返回
                </button>
                {!currentGroupAsset ? (
                  <span className="text-[9px] text-amber-400">组不存在</span>
                ) : (
                  <>
                    <span className="text-[9px] text-gray-500">组内 ({currentGroupItems.length})</span>
                    <button
                      type="button"
                      onClick={() => setShowAllInGroup((v) => !v)}
                      className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${showAllInGroup ? 'bg-blue-600 border-blue-500' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                    >
                      {showAllInGroup ? '显示层级' : '显示全部'}
                    </button>
                  </>
                )}
              </div>
              <div className="gap-4 flex-1" style={{ columnCount: showAllInGroup ? Math.max(2, columnCount) : columnCount, columnFill: 'balance' as const }}>
                {!currentGroupAsset ? (
                  <div className="py-8 text-center text-[9px] text-gray-500">该组已被删除或不存在，请返回</div>
                ) : showAllImages
                  ? showAllImages.map((img, idx) => (
                      <div key={idx} className="break-inside-avoid mb-4 rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
                        <img src={img} alt="" className="w-full h-auto object-cover block" style={{ maxHeight: 280 }} />
                      </div>
                    ))
                  : currentGroupItems.map((item, idx) => {
                      const isRef = typeof item !== 'string';
                      const childAsset = isRef ? assets.find((x) => x.id === (item as { assetId: string }).assetId) : null;
                      const img = isRef && childAsset ? getAssetDisplayImage(childAsset) : (item as string);
                      return (
                        <div
                          key={idx}
                          className="break-inside-avoid mb-4 group relative rounded-2xl border border-white/10 bg-black/40 overflow-hidden"
                          draggable
                          onDragStart={() => currentGroupAsset && setDraggingGroupItem({ image: img, groupAssetId: currentGroupAsset.id, itemIndex: idx })}
                          onDragEnd={() => { setDraggingGroupItem(null); setDragOverAction(null); }}
                        >
                          <div
                            className="relative cursor-pointer"
                            onClick={() => {
                              if (isRef && childAsset?.cutImageGroup?.length) setViewStack((s) => [...s, { assetId: childAsset.id }]);
                            }}
                          >
                            <img src={img} alt="" className="w-full h-auto object-cover block" style={{ maxHeight: 280 }} />
                            {isRef && childAsset?.cutImageGroup?.length && (
                              <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-black bg-blue-600/90">组 {childAsset.cutImageGroup.length}</span>
                            )}
                          </div>
                          <div className="p-1.5 border-t border-white/5 text-[8px] text-gray-500">拖到功能区操作 · {isRef ? '点击进入子组' : '单图'}</div>
                        </div>
                      );
                    })}
              </div>
              {currentGroupAsset && currentGroupItems.length === 0 && !showAllImages && (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500 text-[9px]">此组暂无内容</div>
              )}
            </>
          ) : (
            <>
              <div className="gap-4" style={{ columnCount, columnFill: 'balance' as const }}>
                {visibleAssets.map((a) => (
                  <div
                    key={a.id}
                    className="break-inside-avoid mb-4 group relative rounded-2xl border border-white/10 bg-black/40 overflow-hidden"
                    draggable={!showArchived}
                    onDragStart={() => !showArchived && setDraggingAssetId(a.id)}
                    onDragEnd={() => { setDraggingAssetId(null); setDragOverAction(null); }}
                  >
                    <div
                      className="relative cursor-pointer"
                      onClick={() => {
                        if (showArchived) setArchivedDetailAssetId(a.id);
                        else if (a.cutImageGroup?.length) setViewStack([{ assetId: a.id }]);
                        else setLightboxAssetId(a.id);
                      }}
                    >
                      <img
                        src={getAssetDisplayImage(a)}
                        alt=""
                        className="w-full h-auto object-cover block"
                        style={{ maxHeight: 360 }}
                      />
                      {a.cutImageGroup?.length && (
                        <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-blue-600/90">组 {a.cutImageGroup.length}</span>
                      )}
                      {!showArchived && (
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center gap-1 p-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); setDisplayKey(a.id, 'original'); }}
                            className={`px-2 py-1 rounded text-[8px] font-black uppercase ${a.displayKey === 'original' ? 'bg-blue-600' : 'bg-white/20 hover:bg-white/30'}`}
                          >
                            原始
                          </button>
                          {a.cutImageGroup?.length && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDisplayKey(a.id, 'cut_image'); }}
                              className={`px-2 py-1 rounded text-[8px] font-black uppercase ${a.displayKey === 'cut_image' ? 'bg-blue-600' : 'bg-white/20 hover:bg-white/30'}`}
                            >
                              切割
                            </button>
                          )}
                          {(a.resultOrder || []).map((k) => {
                            if (k === 'cut_image') return null;
                            const mod = getModule(k);
                            const label = mod?.label ?? k;
                            if (!a.results[k]) return null;
                            return (
                              <button
                                key={k}
                                onClick={(e) => { e.stopPropagation(); setDisplayKey(a.id, k); }}
                                className={`px-2 py-1 rounded text-[8px] font-black uppercase ${a.displayKey === k ? 'bg-blue-600' : 'bg-white/20 hover:bg-white/30'}`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {!showArchived && (
                      <div className="p-2 flex items-center justify-between border-t border-white/5">
                        <span className="text-[8px] text-gray-500">拖到功能区 或 点击大图选操作 · 组可进入</span>
                        <div className="flex gap-1">
                          {(a.resultOrder || []).map((k) => (
                            <button
                              key={k}
                              onClick={() => discardResult(a.id, k)}
                              className="px-1.5 py-0.5 rounded text-[7px] text-red-400 hover:bg-red-500/20"
                              title="丢弃该版本"
                            >
                              丢弃
                            </button>
                          ))}
                          <button
                            onClick={() => markArchived(a.id)}
                            className="px-2 py-1 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-[8px] font-black uppercase text-emerald-400 hover:bg-emerald-600/40"
                          >
                            完成归档
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {visibleAssets.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                  <span className="text-4xl mb-2">📷</span>
                  <p className="text-[10px] font-black uppercase">暂无图片</p>
                  <p className="text-[9px] mt-1">使用「多选上传」添加原始图片，或切换到「已完成」查看归档（可点击打开）</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* 功能区：全部来自「能力」，随能力内增删自动更新 */}
        <div className="w-80 shrink-0 flex flex-col gap-4 overflow-y-auto no-scrollbar">
          <div className="text-[9px] font-black text-blue-400 uppercase">功能区</div>
          <p className="text-[8px] text-gray-500">全部调用能力内功能 · 能力中增删会同步到此</p>
          {presets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/20 p-4 text-center text-[9px] text-gray-500">
              暂无功能预设，请先在「能力」界面添加
            </div>
          ) : byCategory.length > 0 ? (
            <div className="space-y-4">
              {byCategory.map(({ category, list }) => (
                <div key={category.id}>
                  <div className="text-[8px] font-black text-gray-500 uppercase mb-1.5">{category.label}</div>
                  <div className="grid grid-cols-2 gap-2">
                    {list.map((mod) => (
                      <div
                        key={mod.id}
                        onDragOver={(e) => { e.preventDefault(); setDragOverAction(mod.id); }}
                        onDragLeave={() => setDragOverAction(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOverAction(null);
                          const image = draggingGroupItem ? draggingGroupItem.image : draggingAssetId ? (() => { const a = assets.find((x) => x.id === draggingAssetId); return a ? getAssetDisplayImage(a) : null; })() : null;
                          if (mod.category === 'generate_3d' && onAddGenerate3DJob && image) {
                            onAddGenerate3DJob(mod, image);
                            return;
                          }
                          if (draggingGroupItem) {
                            addImageToPending(draggingGroupItem.image, mod.id, mod.id === 'cut_image' ? { sourceGroupAssetId: draggingGroupItem.groupAssetId, sourceItemIndex: draggingGroupItem.itemIndex } : { parentAssetId: currentGroupAsset?.id });
                          } else if (draggingAssetId) addToPending(draggingAssetId, mod.id);
                        }}
                        className={`rounded-xl border-2 border-dashed p-3 min-h-[72px] flex flex-col items-center justify-center text-center transition-colors ${dragOverAction === mod.id ? 'border-blue-500 bg-blue-500/10' : 'border-white/20 bg-white/5 hover:border-white/30'}`}
                      >
                        <span className="text-[9px] font-black uppercase">{mod.label}</span>
                        <span className="text-[8px] text-gray-500 mt-0.5">拖拽图片到此处</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {presets.map((mod) => (
                <div
                  key={mod.id}
                  onDragOver={(e) => { e.preventDefault(); setDragOverAction(mod.id); }}
                  onDragLeave={() => setDragOverAction(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverAction(null);
                    const image = draggingGroupItem ? draggingGroupItem.image : draggingAssetId ? (() => { const a = assets.find((x) => x.id === draggingAssetId); return a ? getAssetDisplayImage(a) : null; })() : null;
                    if (mod.category === 'generate_3d' && onAddGenerate3DJob && image) {
                      onAddGenerate3DJob(mod, image);
                      return;
                    }
                    if (draggingGroupItem) {
                      addImageToPending(draggingGroupItem.image, mod.id, mod.id === 'cut_image' ? { sourceGroupAssetId: draggingGroupItem.groupAssetId, sourceItemIndex: draggingGroupItem.itemIndex } : { parentAssetId: currentGroupAsset?.id });
                    } else if (draggingAssetId) addToPending(draggingAssetId, mod.id);
                  }}
                  className={`rounded-xl border-2 border-dashed p-3 min-h-[72px] flex flex-col items-center justify-center text-center transition-colors ${dragOverAction === mod.id ? 'border-blue-500 bg-blue-500/10' : 'border-white/20 bg-white/5 hover:border-white/30'}`}
                >
                  <span className="text-[9px] font-black uppercase">{mod.label}</span>
                  <span className="text-[8px] text-gray-500 mt-0.5">拖拽图片到此处</span>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-white/10 pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-black text-gray-500 uppercase">执行队列</span>
              {executingQueue && (
                <span className="text-[8px] font-black text-blue-400 uppercase">执行中 {executingQueue.current}/{executingQueue.total}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 min-h-[60px] p-2 rounded-xl bg-black/40 border border-white/10">
              {(executingQueue?.tasks ?? pending).map((t, idx) => {
                const actionLabel = getModule(t.actionType)?.label ?? t.actionType;
                const isCurrent = executingQueue && idx + 1 === executingQueue.current;
                return (
                  <div
                    key={t.id}
                    className={`relative group/thumb rounded-lg border-2 transition-colors ${isCurrent ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-white/10'}`}
                  >
                    <img src={t.inputImage} alt="" className="w-14 h-14 object-cover rounded-md" />
                    <span className="absolute -top-1 left-0 px-1 rounded text-[7px] font-black bg-gray-800 text-gray-300">{idx + 1}</span>
                    <span className="absolute -top-1 -right-1 px-1 rounded text-[7px] font-black bg-blue-600 text-white">{actionLabel.slice(0, 2)}</span>
                    {!executing && (
                      <button
                        onClick={() => removeFromPending(t.id)}
                        className="absolute inset-0 rounded-lg bg-black/60 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center text-red-400 text-[10px] font-black"
                      >
                        移除
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => executePending()}
              disabled={pending.length === 0 || executing}
              className="mt-2 w-full py-2.5 rounded-xl bg-blue-600 text-[10px] font-black uppercase electric-glow disabled:opacity-40"
            >
              {executing ? `执行中 ${executingQueue?.current ?? 0}/${executingQueue?.total ?? 0}` : `一键执行（${pending.length}）`}
            </button>
          </div>
        </div>
      </div>

      {/* 进行中：大图弹窗 */}
      {lightboxAsset && !showArchived && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4" onClick={() => setLightboxAssetId(null)}>
          <div className="relative max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setLightboxAssetId(null)} className="absolute -top-12 right-0 w-10 h-10 flex items-center justify-center text-white/60 hover:text-white">✕</button>
            <img src={getAssetDisplayImage(lightboxAsset)} alt="" className="w-full max-h-[80vh] object-contain rounded-2xl border border-white/10" />
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {actionModules.map((mod) => (
                <button
                  key={mod.id}
                  onClick={() => {
                    const idx = lightboxList.findIndex((a) => a.id === lightboxAsset.id);
                    const nextAsset = idx >= 0 && idx < lightboxList.length - 1 ? lightboxList[idx + 1] : null;
                    if (mod.category === 'generate_3d' && onAddGenerate3DJob) {
                      onAddGenerate3DJob(mod, getAssetDisplayImage(lightboxAsset));
                    } else {
                      addToPending(lightboxAsset.id, mod.id);
                    }
                    setLightboxAssetId(nextAsset?.id ?? null);
                  }}
                  className="px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-[10px] font-black uppercase hover:bg-blue-600/30 hover:border-blue-500/50"
                >
                  {mod.label}
                </button>
              ))}
            </div>
            {lightboxList.length > 1 && (
              <div className="flex justify-center gap-2 mt-2">
                <button onClick={() => goLightbox(-1)} className="px-3 py-1 rounded-lg bg-white/10 text-[9px] font-black">上一张</button>
                <span className="text-[9px] text-gray-500 self-center">{lightboxIndex + 1} / {lightboxList.length}</span>
                <button onClick={() => goLightbox(1)} className="px-3 py-1 rounded-lg bg-white/10 text-[9px] font-black">下一张</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 已完成：归档详情弹窗（流程图 + 下载） */}
      {archivedDetailAsset && (
        <ArchivedDetailModal
          asset={archivedDetailAsset}
          modules={actionModules}
          onClose={() => setArchivedDetailAssetId(null)}
        />
      )}

      {/* 切割图片：识别物体后选择区域 */}
      {cutSelectState && (
        <CutSelectModal
          inputImage={cutSelectState.inputImage}
          boxes={cutSelectState.boxes}
          onConfirm={onCutConfirm}
          onCancel={() => {
            const task = cutSelectState.task;
            setCutSelectState(null);
            setPending(cutSelectState.remaining);
            setAssets((prev) => prev.map((a) => (a.id === task.assetId ? { ...a, hiddenInGrid: false } : a)));
            setExecuting(false);
          }}
        />
      )}
    </div>
  );
};

export default WorkflowSection;
