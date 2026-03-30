import React, { useState, useCallback, useMemo, useRef, useEffect, startTransition } from 'react';
import { createPortal } from 'react-dom';
import type { WorkflowAsset, WorkflowPendingTask, CapabilitySet, VgpGenStepCapture } from '../types';
import type { CustomAppModule, LibraryItem, WorkflowCutGroupItem } from '../types';
import type { BoundingBox } from '../types';
import { CAPABILITY_CATEGORIES } from '../types';
import { getRandomGroupCodeName } from '../data/groupCodeNames';
import { detectObjectsInImage, DEFAULT_PROMPTS } from '../services/geminiService';
import {
  executeCapability,
  executeCapabilitySet,
  getCapabilityEngine,
  type CapabilityExecuteContext,
} from '../services/capabilityExecutor';
import { getPromptCompilerEnabled } from '../services/featureFlags';
import {
  applyVgpAfterSuccessfulGen,
  applyVgpAfterCutStep,
  attachInitialVgpToNewAsset,
} from '../services/vgp/vgpStore';
import { WorkflowApiKeyModal } from './WorkflowApiKeyModal';
import { WorkflowGenerationRecordPanel } from './WorkflowGenerationRecordPanel';
import { WorkflowPlannerBar } from './WorkflowPlannerBar';
import { isAiInvocationReady } from '../services/settingsStore';
import { triggerImageDownload } from '../services/imageDataUrl';
import AppIcon from './ui/AppIcon';

/** 云端 hydrate 前预览图为空时避免 img 的 src 为空字符串 */
const WORKFLOW_IMG_EMPTY_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** 持久化数据异常时可能混入非 string，避免把对象传给 img src 触发 React 抛错 */
const asWorkflowImageString = (v: unknown): string => (typeof v === 'string' ? v : '');

const workflowSafeImgSrc = (s: string | undefined | null) => {
  if (typeof s !== 'string' || s.trim() === '') return WORKFLOW_IMG_EMPTY_PLACEHOLDER;
  return s;
};

function safeUnknownToString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.message;
  try {
    return String(v);
  } catch {
    return '[无法序列化的错误]';
  }
}

const uuid = () => Math.random().toString(36).slice(2, 11);
const RESULT_VER_SEP = '__v__';
const baseActionId = (k: string) => (k.includes(RESULT_VER_SEP) ? k.split(RESULT_VER_SEP)[0] : k);
const makeVersionKey = (baseId: string) => `${baseId}${RESULT_VER_SEP}${Date.now().toString(36)}`;

/** 裁剪图片：根据框选裁剪出多张图 */
function cropBoxes(inputImage: string, boxes: BoundingBox[], selectedIndexes: number[]): Promise<string[]> {
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
  });
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
    <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="relative max-w-4xl w-full max-h-[90vh] overflow-auto rounded-2xl border border-white/10 bg-[#14141a]/92 backdrop-blur-md shadow-xl p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-[10px] font-black uppercase text-blue-400">识别到物体，勾选要切割保存的区域</h3>
          <button onClick={onCancel} className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white"><AppIcon name="close" className="w-4 h-4" /></button>
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
            <label key={i} className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg bg-[#1c1c22] border border-[#2e2e32] hover:bg-[#2e2e36]">
              <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} className="rounded" />
              <span className="text-[9px] font-black uppercase">{b.label || `区域 ${i + 1}`}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={() => onConfirm([...selected])} disabled={selected.size === 0} className="px-4 py-2 rounded-xl bg-blue-600 text-[10px] font-black uppercase disabled:opacity-40">确认切割（{selected.size}）</button>
          <button onClick={onCancel} className="px-4 py-2 rounded-xl bg-[#26262c] text-[10px] font-black uppercase">取消</button>
        </div>
      </div>
    </div>
  );
};

/** 微调提示词弹窗：预设 instruction 预填，可编辑，确定后以 promptOverride 加入执行队列 */
const PromptTweakModal: React.FC<{
  preset: CustomAppModule;
  targets: Array<
    | {
        assetId: string;
        inputImage: string;
        inputSourceDisplayKey?: string;
        sourceGroupAssetId?: string;
        sourceItemIndex?: number;
      }
    | { imageBase64: string; parentAssetId: string; sourceGroupAssetId: string; sourceItemIndex: number }
  >;
  onConfirm: (editedPrompt: string) => void;
  onCancel: () => void;
}> = ({ preset, targets, onConfirm, onCancel }) => {
  const [text, setText] = useState(preset.instruction || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setText(preset.instruction || '');
  }, [preset.id, preset.instruction]);
  return createPortal(
    <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onCancel}>
      <div
        className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#0e0e14]/90 backdrop-blur-md shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-black uppercase text-blue-400">微调提示词 · {preset.label}</span>
          <button type="button" onClick={onCancel} className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white rounded"><AppIcon name="close" className="w-4 h-4" /></button>
        </div>
        <p className="text-[9px] text-gray-500 mb-2">可修改下方提示词后加入执行队列（{targets.length} 项）</p>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full min-h-[120px] rounded-xl bg-[#1c1c22] border border-[#2e2e32] px-3 py-2 text-[11px] text-white placeholder-white/40 focus:border-blue-500 outline-none resize-y"
          placeholder="预设提示词"
        />
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={() => onConfirm(text)}
            className="px-4 py-2 rounded-xl bg-blue-600 text-[10px] font-black uppercase hover:bg-blue-500"
          >
            确定并加入队列
          </button>
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl bg-[#26262c] text-[10px] font-black uppercase hover:bg-[#383842]">
            取消
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

// ---------- 归档详情弹窗：流程图 + 单张/整张下载 ----------
const ArchivedDetailModal: React.FC<{
  asset: WorkflowAsset;
  assets: WorkflowAsset[];
  modules: CustomAppModule[];
  onClose: () => void;
}> = ({ asset, assets, modules, onClose }) => {
  const resolveGroupImages = useCallback(
    (a: WorkflowAsset, visited: Set<string> = new Set()): string[] => {
      if (visited.has(a.id)) return [];
      visited.add(a.id);
      const out: string[] = [];
      for (const item of a.cutImageGroup ?? []) {
        if (typeof item === 'string') out.push(item);
        else if (item && typeof item === 'object' && 'r2Key' in item) continue;
        else if (item && typeof item === 'object' && 'assetId' in item) {
          const child = assets.find((x) => x.id === item.assetId);
          if (!child) continue;
          if (child.cutImageGroup?.length) out.push(...resolveGroupImages(child, visited));
          else out.push(child.results[child.displayKey] ?? child.original);
        }
      }
      return out;
    },
    [assets]
  );

  const cutImages = useMemo(() => {
    if (!asset.cutImageGroup?.length) return [];
    return resolveGroupImages(asset);
  }, [asset, resolveGroupImages]);

  const [cutContactSheetUrl, setCutContactSheetUrl] = useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    const buildContactSheet = async () => {
      if (cutImages.length === 0) {
        setCutContactSheetUrl(null);
        return;
      }
      // 生成一张“切割组拼贴图”，供流程图展示（避免只取第一张）
      const maxW = 1200;
      const maxH = 700;
      const pad = 12;
      const gap = 8;
      const count = Math.min(cutImages.length, 12);
      const cols = Math.min(4, count);
      const rows = Math.ceil(count / cols);
      const sheetW = maxW;
      const sheetH = Math.min(maxH, Math.max(220, rows * 200 + pad * 2 + gap * (rows - 1)));

      const canvas = document.createElement('canvas');
      canvas.width = sheetW;
      canvas.height = sheetH;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, sheetW, sheetH);

      const cellW = Math.floor((sheetW - pad * 2 - gap * (cols - 1)) / cols);
      const cellH = Math.floor((sheetH - pad * 2 - gap * (rows - 1)) / rows);

      const loadOne = (src: string) =>
        new Promise<HTMLImageElement>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(img);
          img.src = src;
        });
      const imgs = await Promise.all(cutImages.slice(0, count).map(loadOne));

      imgs.forEach((img, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const x0 = pad + c * (cellW + gap);
        const y0 = pad + r * (cellH + gap);

        // cell background
        ctx.fillStyle = '#0b0b0b';
        ctx.fillRect(x0, y0, cellW, cellH);

        if (!img.naturalWidth || !img.naturalHeight) return;
        const scale = Math.min(cellW / img.naturalWidth, cellH / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        const dx = x0 + (cellW - dw) / 2;
        const dy = y0 + (cellH - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);

        // index badge
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x0 + 6, y0 + 6, 28, 18);
        ctx.fillStyle = '#cbd5e1';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(String(i + 1), x0 + 12, y0 + 19);
      });

      const url = canvas.toDataURL('image/png');
      if (!cancelled) setCutContactSheetUrl(url);
    };
    void buildContactSheet();
    return () => {
      cancelled = true;
    };
  }, [cutImages]);

  const [cutLightboxIndex, setCutLightboxIndex] = useState<number | null>(null);
  const cutLightboxImage = cutLightboxIndex != null ? cutImages[cutLightboxIndex] : null;

  const stepsForComposite = useMemo(() => {
    const list: { id: string; label: string; image: string; executedAt?: number }[] = [
      { id: 'original', label: '原始', image: asset.original },
    ];
    for (const id of asset.resultOrder) {
      const baseId = baseActionId(id);
      // cut_image 的结果存在 cutImageGroup，不在 results 里；用组内首张作代表
      const img =
        baseId === 'cut_image'
          ? (cutContactSheetUrl ?? cutImages[0] ?? null)
          : (asset.results[id] ?? null);
      if (!img) continue;
      const mod = modules.find((m) => m.id === baseId);
      list.push({
        id,
        label: mod?.label ?? baseId,
        image: img,
        executedAt: asset.resultMeta?.[id]?.executedAt,
      });
    }
    return list;
  }, [asset, modules, cutImages, cutContactSheetUrl]);

  // UI 上不再重复展示 cut_image 步骤卡片（已有“切割图片组”）
  const stepsForCards = useMemo(() => {
    return stepsForComposite.filter((s) => s.id !== 'cut_image');
  }, [stepsForComposite]);

  const [compositeUrl, setCompositeUrl] = useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const downloadOne = async (image: string, label: string) => {
    await triggerImageDownload(image, `workflow-${label}-${asset.id.slice(0, 6)}`);
  };

  const downloadMany = (images: string[], labelPrefix: string) => {
    // 浏览器可能会限制短时间内的多次下载触发：加一点间隔更稳定
    const intervalMs = 140;
    images.forEach((img, idx) => {
      const label = `${labelPrefix}-${String(idx + 1).padStart(2, '0')}`;
      window.setTimeout(() => {
        void downloadOne(img, label);
      }, idx * intervalMs);
    });
  };

  const buildComposite = useCallback(() => {
    if (stepsForComposite.length === 0) return;
    // 提升清晰度：更大的目标宽度 + DPR 缩放
    const maxW = 1200;
    const maxH = 700;
    const lineHeight = 24;
    const gap = 10;
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const loadAll = (): Promise<{ img: HTMLImageElement; drawH: number; drawW: number }[]> => {
      return Promise.all(
        stepsForComposite.map(
          (s) =>
            new Promise<{ img: HTMLImageElement; drawH: number; drawW: number }>((resolve) => {
              const img = new Image();
              img.onload = () => {
                // 等比缩放：同时约束最大宽/高，避免“压缩/拉伸”
                const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
                const drawW = img.naturalWidth * scale;
                const drawH = img.naturalHeight * scale;
                resolve({ img, drawH, drawW });
              };
              img.onerror = () => resolve({ img, drawH: 200, drawW: 300 });
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
      canvas.width = Math.ceil((maxW + 40) * dpr);
      canvas.height = Math.ceil(height * dpr);
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, maxW + 40, height);
      let y = 20;
      stepsForComposite.forEach((s, i) => {
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(s.label + (s.executedAt ? ` · ${new Date(s.executedAt).toLocaleString()}` : ''), 20, y + 16);
        y += lineHeight + gap;
        const { img, drawH, drawW } = loaded[i];
        if (img && img.complete && img.naturalWidth) {
          ctx.drawImage(img, 20, y, drawW, drawH);
          y += drawH + gap;
        } else {
          y += 200 + gap;
        }
      });
      setCompositeUrl(canvas.toDataURL('image/png'));
    });
  }, [stepsForComposite]);

  React.useEffect(() => {
    buildComposite();
  }, [buildComposite]);

  const downloadComposite = () => {
    if (!compositeUrl) return;
    void triggerImageDownload(compositeUrl, `workflow-flow-${asset.id.slice(0, 6)}`);
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center bg-black/55 backdrop-blur-sm p-4 py-10 overflow-y-auto"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        className="relative max-w-4xl w-full max-h-[90vh] overflow-y-auto no-scrollbar bg-[#14141a]/92 backdrop-blur-md rounded-2xl border border-white/10 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[10px] font-black uppercase text-blue-400">归档详情 · 生成流程图</h3>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center text-white/60 hover:text-white"><AppIcon name="close" className="w-4 h-4" /></button>
        </div>

        {/* 切割图片组（像资产库一样可逐张打开） */}
        {cutImages.length > 0 && (
          <div className="mb-4 rounded-xl border border-[#2e2e32] bg-[#16161a] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-black uppercase text-gray-300">切割图片组（{cutImages.length}）</span>
              <div className="flex items-center gap-2">
                <span className="text-[8px] text-gray-500">点击缩略图可单张查看</span>
                <button
                  type="button"
                  onClick={() => downloadMany(cutImages, 'cut')}
                  className="px-2 py-1 rounded-lg bg-[#26262c] text-[8px] font-black uppercase hover:bg-[#383842]"
                  title="逐张触发下载（浏览器可能会拦截过多下载）"
                >
                  批量下载
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {cutImages.map((img, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setCutLightboxIndex(idx)}
                  className="rounded-lg border border-[#2e2e32] bg-[#141416] overflow-hidden hover:border-[#3b6fb8] transition-colors"
                  title={`第 ${idx + 1} 张`}
                >
                  <img src={img} alt={`cut-${idx}`} className="w-full h-20 object-cover block" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {stepsForCards.map((s, i) => (
            <div key={i} className="rounded-xl border border-[#2e2e32] overflow-hidden bg-[#16161a]">
              <div className="px-3 py-2 flex items-center justify-between border-b border-[#252528]">
                <span className="text-[9px] font-black uppercase text-gray-300">{s.label}</span>
                {s.executedAt != null && (
                  <span className="text-[8px] text-gray-500">{new Date(s.executedAt).toLocaleString()}</span>
                )}
                <button
                  onClick={() => downloadOne(s.image, s.label)}
                  className="px-2 py-1 rounded-lg bg-[#26262c] text-[8px] font-black uppercase hover:bg-[#383842]"
                >
                  下载此张
                </button>
              </div>
              <img src={s.image} alt={s.label} className="w-full max-h-[320px] object-contain bg-[#16161a]" />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span className="text-[9px] text-gray-500">拼合后的流程图（按生成顺序）</span>
          {compositeUrl && (
            <>
              <img src={compositeUrl} alt="流程图" className="max-h-48 rounded-lg border border-[#2e2e32]" />
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

      {/* 切割组：单张查看（轻量 lightbox，类似资产库单图查看） */}
      {cutLightboxImage && cutLightboxIndex != null && (
        <div
          className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/78 backdrop-blur-sm p-4"
          onClick={() => setCutLightboxIndex(null)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setCutLightboxIndex(null);
            if (e.key === 'ArrowLeft') setCutLightboxIndex((i) => (i == null ? i : (i - 1 + cutImages.length) % cutImages.length));
            if (e.key === 'ArrowRight') setCutLightboxIndex((i) => (i == null ? i : (i + 1) % cutImages.length));
          }}
          aria-label="查看切割图片"
        >
          <div className="relative max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setCutLightboxIndex(null)}
              className="absolute -top-12 right-0 w-10 h-10 flex items-center justify-center text-white/60 hover:text-white"
              aria-label="关闭"
            >
              <AppIcon name="close" className="w-4 h-4" />
            </button>
            <img src={cutLightboxImage} alt="" className="w-full max-h-[80vh] object-contain rounded-2xl border border-[#2e2e32] bg-[#16161a]" />
            <div className="flex justify-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => {
                  void downloadOne(cutLightboxImage, `cut-${cutLightboxIndex + 1}`);
                }}
                className="px-3 py-1 rounded-lg bg-[#1d4ed8] hover:bg-blue-500 text-[9px] font-black"
              >
                下载此张
              </button>
              {cutImages.length > 1 && (
                <>
                <button
                  type="button"
                  onClick={() => setCutLightboxIndex((i) => (i == null ? i : (i - 1 + cutImages.length) % cutImages.length))}
                  className="px-3 py-1 rounded-lg bg-[#26262c] text-[9px] font-black"
                >
                  上一张
                </button>
                <span className="text-[9px] text-gray-500 self-center">
                  {cutLightboxIndex + 1} / {cutImages.length}
                </span>
                <button
                  type="button"
                  onClick={() => setCutLightboxIndex((i) => (i == null ? i : (i + 1) % cutImages.length))}
                  className="px-3 py-1 rounded-lg bg-[#26262c] text-[9px] font-black"
                >
                  下一张
                </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------- 主组件 ----------
const SET_ACTION_PREFIX = 'set:';

const WorkflowSection: React.FC<{
  capabilityPresets: CustomAppModule[];
  capabilitySets?: CapabilitySet[];
  assets: WorkflowAsset[];
  onAssetsChange: (value: React.SetStateAction<WorkflowAsset[]>) => void;
  pending: WorkflowPendingTask[];
  onPendingChange: (value: React.SetStateAction<WorkflowPendingTask[]>) => void;
  onOpenLibraryPicker?: (callback: (items: LibraryItem[]) => void) => void;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
  /** 拖图到「生成3D」能力时调用，不进入执行队列，直接提交 3D 任务 */
  onAddGenerate3DJob?: (preset: CustomAppModule, imageBase64: string) => void;
  /** 用于按账号隔离常用功能偏好；未传时走 guest */
  preferenceScope?: string | null;
}> = ({ capabilityPresets, capabilitySets: capabilitySetsProp = [], assets: assetsProp, onAssetsChange: setAssets, pending: pendingProp, onPendingChange: setPending, onOpenLibraryPicker, onLog, onAddGenerate3DJob, preferenceScope = null }) => {
  const assets = Array.isArray(assetsProp) ? assetsProp : [];
  const pending = Array.isArray(pendingProp) ? pendingProp : [];
  const capabilitySets = Array.isArray(capabilitySetsProp) ? capabilitySetsProp : [];
  const pendingRef = React.useRef(pending);
  pendingRef.current = pending;
  const assetsRef = React.useRef(assets);
  assetsRef.current = assets;
  const presets = useMemo(() => {
    const list = Array.isArray(capabilityPresets) ? capabilityPresets : [];
    return list
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => p.enabled !== false)
      .sort((a, b) => (a.p.order ?? a.idx) - (b.p.order ?? b.idx))
      .map(({ p }) => p);
  }, [capabilityPresets]);
  const actionModules: CustomAppModule[] = presets;
  const byCategory = useMemo<Array<{ category: { id: string; label: string; desc: string }; list: CustomAppModule[] }>>(() => {
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
    const groups: Array<{ category: { id: string; label: string; desc: string }; list: CustomAppModule[] }> =
      CAPABILITY_CATEGORIES.map((c) => ({ category: c, list: map[c.id] ?? [] })).filter((g) => g.list.length > 0);
    if (other.length > 0) groups.push({ category: { id: 'other', label: '其他', desc: '' }, list: other });
    return groups;
  }, [presets]);
  const [columnCount, setColumnCount] = useState(4);
  const [showArchived, setShowArchived] = useState(false);
  const [archiveHint, setArchiveHint] = useState<{ assetId: string; ts: number } | null>(null);
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const [showLightboxGenerationRecord, setShowLightboxGenerationRecord] = useState(false);
  const [archivedDetailAssetId, setArchivedDetailAssetId] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executingQueue, setExecutingQueue] = useState<{ total: number; current: number; tasks: WorkflowPendingTask[] } | null>(null);
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(new Set());
  const [draggingAssetIds, setDraggingAssetIds] = useState<string[] | null>(null);
  const [dragOverAction, setDragOverAction] = useState<string | null>(null);
  const [draggingActionId, setDraggingActionId] = useState<string | null>(null);
  const [draggingActionFromFavorite, setDraggingActionFromFavorite] = useState(false);
  const [actionDroppedInFavorite, setActionDroppedInFavorite] = useState(false);
  const [favoriteDropActive, setFavoriteDropActive] = useState(false);
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Record<string, boolean>>({});
  const draggingAssetId = draggingAssetIds?.[0] ?? null;
  const [cutSelectState, setCutSelectState] = useState<{
    task: WorkflowPendingTask;
    inputImage: string;
    boxes: BoundingBox[];
    remaining: WorkflowPendingTask[];
  } | null>(null);
  const [promptTweakModal, setPromptTweakModal] = useState<{
    preset: CustomAppModule;
    targets: Array<
      | {
          assetId: string;
          inputImage: string;
          inputSourceDisplayKey?: string;
          sourceGroupAssetId?: string;
          sourceItemIndex?: number;
        }
      | { imageBase64: string; parentAssetId: string; sourceGroupAssetId: string; sourceItemIndex: number }
    >;
  } | null>(null);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [aiInvocationStatusRev, setAiInvocationStatusRev] = useState(0);
  const aiInvocationReady = useMemo(() => isAiInvocationReady(), [aiInvocationStatusRev]);
  const [viewStack, setViewStack] = useState<{ assetId: string }[]>([]);
  const [showAllInGroup, setShowAllInGroup] = useState(false);
  const [groupStringLightboxIndex, setGroupStringLightboxIndex] = useState<number | null>(null);
  const [draggingGroupItems, setDraggingGroupItems] = useState<{ groupAssetId: string; itemIndexes: number[] } | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [selectedGroupItemKeys, setSelectedGroupItemKeys] = useState<Set<string>>(new Set());
  const [marqueeRect, setMarqueeRect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [dragOverAssetId, setDragOverAssetId] = useState<string | null>(null);
  const [dragOverGroupItemKey, setDragOverGroupItemKey] = useState<string | null>(null);
  const [assetErrors, setAssetErrors] = useState<Map<string, string>>(new Map());
  const [groupPreviewIndexById, setGroupPreviewIndexById] = useState<Record<string, number>>({});
  const [groupBounceStateById, setGroupBounceStateById] = useState<Record<string, 'idle' | 'up' | 'down'>>({});
  const [assetAspectById, setAssetAspectById] = useState<Record<string, number>>({});

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

  const getModule = (id: string) => actionModules.find((m) => m.id === id);
  const getSet = (id: string) => capabilitySets.find((s) => s.id === id);
  const getActionLabel = (actionType: string) => {
    if (actionType.startsWith(SET_ACTION_PREFIX)) {
      const set = getSet(actionType.slice(SET_ACTION_PREFIX.length));
      return set?.label ?? actionType;
    }
    return getModule(actionType)?.label ?? actionType;
  };
  const getGenerationRecordStepLabel = (stepKey: string) => {
    if (stepKey === 'original') return '原图';
    if (stepKey === 'cut_image') return '切割';
    if (stepKey.startsWith(SET_ACTION_PREFIX)) {
      const s = getSet(stepKey.slice(SET_ACTION_PREFIX.length));
      return s?.label ?? stepKey;
    }
    return getModule(baseActionId(stepKey))?.label ?? stepKey;
  };
  const getAssetDisplayImage = (a: WorkflowAsset, assetsList: WorkflowAsset[] = assets, visited: Set<string> = new Set()): string => {
    const orig = asWorkflowImageString(a.original);
    if (a.displayKey === 'original') return orig;
    if (a.displayKey === 'cut_image' && a.cutImageGroup?.length) {
      const first = a.cutImageGroup[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object' && 'r2Key' in first) return orig;
      if (visited.has(a.id)) return orig;
      visited.add(a.id);
      const ref = first && typeof first === 'object' && 'assetId' in first ? (first as { assetId: string }).assetId : '';
      const child = ref ? assetsList.find((x) => x.id === ref) : undefined;
      return child ? getAssetDisplayImage(child, assetsList, visited) : orig;
    }
    const fromResults = (a.results as Record<string, unknown>)[a.displayKey];
    return asWorkflowImageString(fromResults) || orig;
  };
  const getAssetDisplayTypeLabel = (a: WorkflowAsset): string => {
    if (a.displayKey === 'original') return '原始';
    if (a.displayKey === 'cut_image') return a.groupKind === 'manual' ? '组' : '切割';
    const baseId = baseActionId(a.displayKey);
    return getModule(baseId)?.label ?? baseId;
  };

  const addToPending = useCallback(
    (assetId: string, actionType: string, options?: { promptOverride?: string }) => {
      const asset = assets.find((x) => x.id === assetId);
      if (!asset) return;
      const inputImage = getAssetDisplayImage(asset);
      const task: WorkflowPendingTask = {
        id: uuid(),
        assetId,
        actionType,
        inputImage,
        addedAt: Date.now(),
        inputSourceDisplayKey: asset.displayKey,
        ...(options?.promptOverride != null ? { promptOverride: options.promptOverride } : {}),
      };
      setPending((prev) => [...prev, task]);
    },
    [assets, getAssetDisplayImage]
  );

  const addTasksToPending = useCallback((tasks: WorkflowPendingTask[]) => {
    if (tasks.length === 0) return;
    setPending((prev) => [...prev, ...tasks]);
  }, []);

  const removeFromPending = useCallback((taskId: string) => {
    const task = pending.find((t) => t.id === taskId);
    setPending((prev) => prev.filter((t) => t.id !== taskId));
    if (task) {
      setAssets((prev) => prev.map((x) => (x.id === task.assetId ? { ...x, hiddenInGrid: false } : x)));
    }
  }, [pending]);

  const buildCompilerExecuteContextForTask = (
    task: WorkflowPendingTask,
    module: CustomAppModule | undefined
  ): CapabilityExecuteContext => {
    const base: CapabilityExecuteContext = { onLog };
    if (!getPromptCompilerEnabled()) return base;
    if (task.actionType.startsWith(SET_ACTION_PREFIX)) {
      const targetSummary = task.promptOverride?.trim() || undefined;
      return { onLog, promptResolution: 'compiler', semanticForCompiler: { targetSummary } };
    }
    if (!module) return base;
    if (getCapabilityEngine(module) !== 'gen_image') return base;
    const targetSummary =
      (task.promptOverride?.trim() || module.instruction?.trim() || '').trim() || undefined;
    return { onLog, promptResolution: 'compiler', semanticForCompiler: { targetSummary } };
  };

  const runTask = async (
    task: WorkflowPendingTask
  ): Promise<{ image: string | null; vgpSteps?: VgpGenStepCapture[] }> => {
    const { actionType, inputImage } = task;
    if (actionType.startsWith(SET_ACTION_PREFIX)) {
      const set = getSet(actionType.slice(SET_ACTION_PREFIX.length));
      if (!set) {
        const msg = `[${getActionLabel(actionType)}] 能力集合不存在`;
        onLog?.('warn', msg);
        setAssetError(task.assetId, msg);
        return { image: null };
      }
      const result = await executeCapabilitySet(set, inputImage ?? '', {
        presets: actionModules,
        ...buildCompilerExecuteContextForTask(task, undefined),
      });
      if (result.ok === false) {
        const msg = `[${getActionLabel(actionType)}] ${result.error}`;
        onLog?.('warn', msg);
        setAssetError(task.assetId, msg);
        return { image: null };
      }
      setAssetError(task.assetId, null);
      return result.kind === 'image'
        ? { image: result.image, vgpSteps: result.vgpSteps }
        : { image: null };
    }
    const module = getModule(actionType);
    if (module?.category === 'generate_3d') {
      const msg = '生成3D 请拖图到能力框提交，不进入执行队列';
      onLog?.('warn', msg);
      setAssetError(task.assetId, msg);
      return { image: null };
    }
    const actionLabel = getActionLabel(actionType);
    try {
      if (module) {
        const preset =
          task.promptOverride != null && task.promptOverride.trim() !== ''
            ? { ...module, instruction: task.promptOverride.trim() }
            : module;
        const out = await executeCapability(preset, inputImage, buildCompilerExecuteContextForTask(task, preset));
        if (out.ok === false) {
          const msg = `[${actionLabel}] ${out.error}`;
          onLog?.('warn', msg);
          setAssetError(task.assetId, msg);
          return { image: null };
        }
        setAssetError(task.assetId, null);
        return { image: out.image, vgpSteps: out.vgpSteps };
      }
      if (actionType === 'cut_image') {
        return { image: null };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : safeUnknownToString(err);
      const full = `[${actionLabel}] 失败：${msg}`;
      onLog?.('error', full, msg);
      setAssetError(task.assetId, full);
      return { image: null };
    }
    const fallbackMsg = `[${actionLabel}] 未能获得结果（请重试或检查配置）`;
    setAssetError(task.assetId, fallbackMsg);
    return { image: null };
  };

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

  /** 一次性将组内多个槽位移出到上一级，避免多次 setAssets 导致下标错位 */
  const moveGroupItemsToUpperLevel = useCallback(
    (groupAssetId: string, itemIndexes: number[]) => {
      if (itemIndexes.length === 0) return;
      setAssets((prev) => {
        const list = [...prev];
        const groupIdx = list.findIndex((a) => a.id === groupAssetId);
        if (groupIdx === -1) return prev;
        const group = list[groupIdx];
        const items = group.cutImageGroup ?? [];
        const indexSet = new Set(itemIndexes);
        const nextItems = items.filter((_, i) => !indexSet.has(i));
        const parentId = group.parentAssetId;

        const childIds: string[] = [];
        items.forEach((item, i) => {
          if (!indexSet.has(i)) return;
          const childId =
            typeof item === 'object' && item && 'assetId' in item ? (item as { assetId: string }).assetId : null;
          if (childId) childIds.push(childId);
        });

        if (nextItems.length === 0) {
          list.splice(groupIdx, 1);
        } else {
          list[groupIdx] = { ...group, cutImageGroup: nextItems };
        }

        childIds.forEach((childId) => {
          const childIdx = list.findIndex((a) => a.id === childId);
          if (childIdx === -1) return;
          const child = list[childIdx];
          if (parentId) {
            const parentIdx = list.findIndex((a) => a.id === parentId);
            if (parentIdx !== -1) {
              const parent = list[parentIdx];
              const parentItems = [...(parent.cutImageGroup ?? []), { assetId: childId }];
              list[parentIdx] = { ...parent, cutImageGroup: parentItems };
              list[childIdx] = { ...child, parentAssetId: parent.id };
            } else {
              list[childIdx] = { ...child, parentAssetId: undefined };
            }
          } else {
            list[childIdx] = { ...child, parentAssetId: undefined };
          }
        });
        return list;
      });
      setViewStack((s) => s.filter((x) => x.assetId !== groupAssetId));
      setSelectedGroupItemKeys((prev) => {
        const next = new Set(prev);
        next.forEach((key) => {
          if (String(key).startsWith(`${groupAssetId}::`)) next.delete(key);
        });
        return next;
      });
    },
    [setAssets]
  );

  const moveGroupItemToUpperLevel = useCallback(
    (groupAssetId: string, itemIndex: number) => {
      moveGroupItemsToUpperLevel(groupAssetId, [itemIndex]);
    },
    [moveGroupItemsToUpperLevel]
  );

  const removeFromGroup = useCallback(
    (groupAssetId: string, itemIndex: number) => {
      moveGroupItemToUpperLevel(groupAssetId, itemIndex);
    },
    [moveGroupItemToUpperLevel]
  );

  const MAX_CONCURRENCY = 3;

  const executePending = useCallback(
    async (overridePending?: WorkflowPendingTask[]) => {
      const queue = overridePending ? [...overridePending] : [...pendingRef.current];
      // 允许在 cut_image 弹窗确认后用 overridePending 继续执行剩余任务
      if (queue.length === 0 || (executing && !overridePending)) return;
      // 新一轮批处理前清空已完成任务标记
      setCompletedTaskIds(new Set());
      if (!overridePending) setPending([]);
      setExecuting(true);
      setExecutingQueue({ total: queue.length, current: 0, tasks: [...queue] });
      onLog?.('info', `开始执行队列（${queue.length} 项，最大并发 ${MAX_CONCURRENCY}）`);

      let completed = 0;
      const total = queue.length;

      const processTask = async (task: WorkflowPendingTask) => {
        const index = ++completed;
        const taskLabel = getActionLabel(task.actionType);
        setExecutingQueue((prev) => (prev ? { ...prev, current: index } : null));

        if (task.actionType === 'cut_image') {
          onLog?.('info', `[${index}/${total}] ${taskLabel} 识别并切割中…`);
          let inputImage =
            task.inputImage || assetsRef.current.find((a) => a.id === task.assetId)?.original;
          if (!inputImage || typeof inputImage !== 'string') {
            const msg = `[${taskLabel}] 找不到输入图片，已跳过此任务`;
            onLog?.('warn', msg);
            setAssetError(task.assetId, msg);
            setCompletedTaskIds((prev) => { const next = new Set(prev); next.add(task.id); return next; });
            return;
          }
          if (!inputImage.startsWith('data:')) {
            const fromAsset = assetsRef.current.find((a) => a.id === task.assetId)?.original;
            if (fromAsset && fromAsset.startsWith('data:')) inputImage = fromAsset;
            else {
              const msg = `[${taskLabel}] 输入图不是 data URL，尝试使用原图`;
              onLog?.('warn', msg);
              setAssetError(task.assetId, msg);
            }
          }
          let boxes: BoundingBox[] = [];
          try {
            boxes = await Promise.race([
              detectObjectsInImage(
                inputImage,
                'gemini-3-flash-preview',
                DEFAULT_PROMPTS.detect_blocks,
                { timeoutMs: 30000 }
              ),
              new Promise<BoundingBox[]>((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 32000)
              ),
            ]);
          } catch (e) {
            const msg = e instanceof Error ? e.message : safeUnknownToString(e);
            const full = `[${taskLabel}] 区域识别超时或失败（${msg}），将整图作为一块裁剪`;
            onLog?.('warn', full);
            setAssetError(task.assetId, full);
          }
          if (!boxes.length) {
            boxes = [{ id: 'full', label: '整图', xmin: 0, ymin: 0, xmax: 1000, ymax: 1000 }];
          }
          const allIndexes = boxes.map((_, j) => j);
          let cropped = await cropBoxes(inputImage, boxes, allIndexes);
          if (cropped.length === 0 && boxes.length > 0) {
            const msg = `[${taskLabel}] 裁剪失败，尝试整图`;
            onLog?.('warn', msg);
            setAssetError(task.assetId, msg);
            cropped = await cropBoxes(inputImage, [{ id: 'full', label: '整图', xmin: 0, ymin: 0, xmax: 1000, ymax: 1000 }], [0]);
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
                parentAssetId: task.assetId,
              })
            );
            const cutImageGroup = newAssets.map((x) => ({ assetId: x.id }));
            const nextOrder = [...(taskAsset.resultOrder || []), task.actionType];
            const nextMeta = {
              ...(taskAsset.resultMeta || {}),
              [task.actionType]: { executedAt: Date.now() },
            };
            const next = [...prev, ...newAssets];
            const usedLabels = new Set<string>(prev.map((a) => a.groupLabel).filter((x): x is string => !!x));
            return next.map((a) => {
              if (a.id !== task.assetId) return a;
              const updated: WorkflowAsset = {
                ...a,
                cutImageGroup,
                groupKind: 'cut',
                groupLabel: getRandomGroupCodeName(usedLabels),
                resultOrder: nextOrder,
                resultMeta: nextMeta,
                displayKey: 'cut_image',
                hiddenInGrid: a.parentAssetId ? a.hiddenInGrid : false,
              };
              return cropped.length > 0
                ? applyVgpAfterCutStep(updated, {
                    stepKey: task.actionType,
                    inputSourceDisplayKey: task.inputSourceDisplayKey,
                  })
                : updated;
            });
          });
          if (task.sourceGroupAssetId != null && task.sourceItemIndex != null) {
            replaceGroupItemWithSubAsset(
              task.sourceGroupAssetId,
              task.sourceItemIndex,
              task.assetId
            );
          }
          onLog?.('info', `[${index}/${total}] ${taskLabel} 完成（${cropped.length} 张入组）`);
          setCompletedTaskIds((prev) => {
            const next = new Set(prev);
            next.add(task.id);
            return next;
          });
          return;
        }

        onLog?.('info', `[${index}/${total}] ${taskLabel} 执行中…`);
        const { image: result, vgpSteps } = await runTask(task);
        setAssets((prev) =>
          prev.map((a) => {
            if (a.id !== task.assetId) return a;
            const baseId = task.actionType;
            const hasAnyVersion =
              Object.keys(a.results || {}).some((k) => baseActionId(k) === baseId) ||
              (a.resultOrder || []).some((k) => baseActionId(k) === baseId);
            const key = result ? (hasAnyVersion ? makeVersionKey(baseId) : baseId) : baseId;
            const nextResults = result ? { ...a.results, [key]: result } : a.results;
            const nextOrder = result ? [...(a.resultOrder || []), key] : a.resultOrder || [];
            const nextMeta = { ...(a.resultMeta || {}), [key]: { executedAt: Date.now() } };
            let next: WorkflowAsset = {
              ...a,
              results: nextResults,
              resultOrder: nextOrder,
              resultMeta: nextMeta,
              displayKey: result ? key : a.displayKey,
              hiddenInGrid: a.parentAssetId ? a.hiddenInGrid : false,
            };
            if (result) {
              const hadOverride = task.promptOverride != null && task.promptOverride.trim() !== '';
              const summaryLabel = getActionLabel(task.actionType);
              next = applyVgpAfterSuccessfulGen(next, {
                resultKey: key,
                vgpSteps: vgpSteps ?? [],
                semanticSummary: hadOverride ? `${summaryLabel}（用户微调）` : summaryLabel,
                hadPromptOverride: hadOverride,
                inputSourceDisplayKey: task.inputSourceDisplayKey,
              });
            }
            return next;
          })
        );
        setCompletedTaskIds((prev) => {
          const next = new Set(prev);
          next.add(task.id);
          return next;
        });
      };

      const worker = async () => {
        while (true) {
          const task = queue.shift();
          if (!task) break;
          // 为安全起见，轻微错开启动时间，避免瞬间打爆 QPS
          await processTask(task);
        }
      };

      const concurrency = Math.min(MAX_CONCURRENCY, queue.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      onLog?.('info', '队列执行完成');
      setExecuting(false);
      setExecutingQueue(null);

      // 若在本批执行期间又新增了任务（pending），自动继续下一批
      if (!overridePending) {
        const next = [...pendingRef.current];
        if (next.length > 0) {
          onLog?.('info', `检测到新加入的任务 ${next.length} 项，继续执行下一批…`);
          // 传 overridePending，避免 executing 标志阻止递归调用
          void executePending(next);
        }
      }
    },
    [executing, onLog, setPending, setAssets, getActionLabel, replaceGroupItemWithSubAsset, runTask]
  );

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
            parentAssetId: task.assetId,
          })
        );
        const cutImageGroup = newAssets.map((x) => ({ assetId: x.id }));
        const nextOrder = [...(taskAsset.resultOrder || []), task.actionType];
        const nextMeta = { ...(taskAsset.resultMeta || {}), [task.actionType]: { executedAt: Date.now() } };
        const next = [...prev, ...newAssets];
        return next.map((a) => {
          if (a.id !== task.assetId) return a;
          const updated: WorkflowAsset = {
            ...a,
            cutImageGroup,
            resultOrder: nextOrder,
            resultMeta: nextMeta,
            displayKey: 'cut_image',
            hiddenInGrid: false,
          };
          return applyVgpAfterCutStep(updated, {
            stepKey: task.actionType,
            inputSourceDisplayKey: task.inputSourceDisplayKey,
          });
        });
      });
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
        const base64 = reader.result as string;
        setAssets((prev) => {
          const groupCtx =
            viewStack.length > 0
              ? prev.find((a) => a.id === viewStack[viewStack.length - 1].assetId)
              : null;
          const newId = uuid();
          const newAsset: WorkflowAsset = attachInitialVgpToNewAsset({
            id: newId,
            original: base64,
            displayKey: 'original',
            results: {},
            resultOrder: [],
            archived: false,
            hiddenInGrid: false,
            createdAt: Date.now(),
            ...(groupCtx ? { parentAssetId: groupCtx.id } : {}),
          });
          if (!groupCtx) {
            return [...prev, newAsset];
          }
          return prev.map((a) => {
            if (a.id === groupCtx.id) {
              const items = [...(a.cutImageGroup ?? [])];
              items.push({ assetId: newId });
              return { ...a, cutImageGroup: items };
            }
            return a;
          }).concat(newAsset);
        });
      };
      reader.readAsDataURL(file);
    });
  }, [viewStack, setAssets]);

  const handleBatchUploadCorrect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    addImagesFromFiles(Array.from(files));
    e.target.value = '';
  };

  const [dropZoneActive, setDropZoneActive] = useState(false);
  const hasImageFileTransfer = useCallback((dt?: DataTransfer | null) => {
    if (!dt) return false;
    if (dt.files?.length) {
      for (let i = 0; i < dt.files.length; i += 1) {
        if (dt.files[i].type?.startsWith('image/')) return true;
      }
    }
    if (dt.items?.length) {
      for (let i = 0; i < dt.items.length; i += 1) {
        if (dt.items[i].kind === 'file' && dt.items[i].type?.startsWith('image/')) return true;
      }
    }
    return false;
  }, []);
  const favoriteStorageKey = useMemo(
    () => (preferenceScope ? `ac_workflow_favorites_v1__u_${preferenceScope}` : 'ac_workflow_favorites_v1__guest'),
    [preferenceScope]
  );
  const [favoriteActionIds, setFavoriteActionIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(favoriteStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(favoriteStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setFavoriteActionIds(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []);
    } catch {
      setFavoriteActionIds([]);
    }
  }, [favoriteStorageKey]);
  useEffect(() => {
    if (!lightboxAssetId) setShowLightboxGenerationRecord(false);
  }, [lightboxAssetId]);
  useEffect(() => {
    try {
      localStorage.setItem(favoriteStorageKey, JSON.stringify(favoriteActionIds));
    } catch {
      // ignore persist failure
    }
  }, [favoriteActionIds, favoriteStorageKey]);
  const handleDrop = useCallback((e: React.DragEvent) => {
    setDropZoneActive(false);
    if (!hasImageFileTransfer(e.dataTransfer)) return;
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files?.length) addImagesFromFiles(Array.from(files));
  }, [addImagesFromFiles, hasImageFileTransfer]);
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

  const isEditableTarget = useCallback((target: EventTarget | null) => {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    if (el.closest('input, textarea, select, [contenteditable="true"]')) return true;
    if ((el as HTMLElement).isContentEditable) return true;
    return false;
  }, []);

  const isGlobalUploadBlockedTarget = useCallback((target: EventTarget | null) => {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    if (isEditableTarget(el)) return true;
    // Do not hijack drag/drop on explicit interactive controls or icon buttons.
    if (el.closest('button, a, label, [role="button"], [role="menuitem"], [data-no-global-image-drop]')) return true;
    return false;
  }, [isEditableTarget]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = collectImageFilesFromClipboardItems(e.clipboardData?.items);
    if (files.length) {
      e.preventDefault();
      addImagesFromFiles(files);
    }
  }, [addImagesFromFiles, collectImageFilesFromClipboardItems]);

  useEffect(() => {
    const onWindowPaste = (e: ClipboardEvent) => {
      if (showArchived) return;
      if (isGlobalUploadBlockedTarget(e.target)) return;
      const files = collectImageFilesFromClipboardItems(e.clipboardData?.items);
      if (!files.length) return;
      e.preventDefault();
      addImagesFromFiles(files);
    };
    window.addEventListener('paste', onWindowPaste);
    return () => {
      window.removeEventListener('paste', onWindowPaste);
    };
  }, [addImagesFromFiles, collectImageFilesFromClipboardItems, isGlobalUploadBlockedTarget, showArchived]);

  useEffect(() => {
    const onWindowDragOver = (e: DragEvent) => {
      if (showArchived) return;
      if (isGlobalUploadBlockedTarget(e.target)) return;
      if (!hasImageFileTransfer(e.dataTransfer)) return;
      e.preventDefault();
      setDropZoneActive(true);
    };

    const onWindowDrop = (e: DragEvent) => {
      if (showArchived) return;
      setDropZoneActive(false);
      if (isGlobalUploadBlockedTarget(e.target)) return;
      const dt = e.dataTransfer;
      if (!hasImageFileTransfer(dt)) return;
      e.preventDefault();
      const files = Array.from(dt?.files || []).filter((f) => f.type?.startsWith('image/'));
      if (files.length) addImagesFromFiles(files);
    };

    const onWindowDragEnd = () => setDropZoneActive(false);

    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('drop', onWindowDrop);
    window.addEventListener('dragleave', onWindowDragEnd);
    window.addEventListener('dragend', onWindowDragEnd);
    return () => {
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('drop', onWindowDrop);
      window.removeEventListener('dragleave', onWindowDragEnd);
      window.removeEventListener('dragend', onWindowDragEnd);
    };
  }, [addImagesFromFiles, hasImageFileTransfer, isGlobalUploadBlockedTarget, showArchived]);

  const visibleAssets = useMemo(() => {
    // 仅展示“根资产”：归档状态匹配，且不是子资产（没有 parentAssetId）
    return assets.filter(
      (a) => a.archived === showArchived && (!a.hiddenInGrid || a.archived) && !a.parentAssetId
    );
  }, [assets, showArchived]);

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

  const lightboxAsset = lightboxAssetId ? assets.find((a) => a.id === lightboxAssetId) : null;
  const lightboxList = assets.filter((a) => !a.archived && !a.hiddenInGrid && !a.parentAssetId);
  const lightboxIndex = lightboxAssetId ? lightboxList.findIndex((a) => a.id === lightboxAssetId) : -1;
  const goLightbox = (delta: number) => {
    if (lightboxList.length === 0) return;
    const next = (lightboxIndex + delta + lightboxList.length) % lightboxList.length;
    setLightboxAssetId(lightboxList[next].id);
  };

  const setDisplayKey = (assetId: string, key: string) => {
    setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, displayKey: key } : a)));
  };

  const getDisplayKeysForAsset = (a: WorkflowAsset): string[] => {
    const keys: string[] = ['original'];
    if (a.cutImageGroup?.length && a.groupKind !== 'manual') keys.push('cut_image');
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
      setAssets((prev) => {
        const copies: WorkflowAsset[] = [];
        const newIds: string[] = [];
        sourceIds.forEach((id) => {
          const src = prev.find((a) => a.id === id);
          if (!src) return;
          const newId = uuid();
          newIds.push(newId);
          copies.push({
            ...src,
            id: newId,
            parentAssetId: parentGroupId ?? undefined,
            archived: false,
            hiddenInGrid: false,
            createdAt: Date.now(),
          });
        });
        if (copies.length === 0) return prev;
        let next = [...prev, ...copies];
        if (parentGroupId) {
          const gi = next.findIndex((a) => a.id === parentGroupId);
          if (gi !== -1) {
            const g = next[gi];
            const items = [...(g.cutImageGroup ?? []), ...newIds.map((id) => ({ assetId: id }))];
            next = next.map((a, i) => (i === gi ? { ...a, cutImageGroup: items } : a));
          }
        }
        return next;
      });
    },
    [setAssets]
  );

  useEffect(() => {
    if (!marqueeRect) return;
    const onMove = (e: MouseEvent) => {
      setMarqueeRect((prev) => (prev ? { ...prev, endX: e.clientX, endY: e.clientY } : null));
    };
    const onUp = (e: MouseEvent) => {
      setMarqueeRect((prev) => {
        if (!prev) return null;
        const left = Math.min(prev.startX, prev.endX);
        const top = Math.min(prev.startY, prev.endY);
        const width = Math.abs(prev.endX - prev.startX);
        const height = Math.abs(prev.endY - prev.startY);
        const isClick = width < 5 && height < 5;
        if (isClick) {
          if (viewStack.length === 0) {
            setSelectedAssetIds(new Set());
          } else {
            setSelectedGroupItemKeys(new Set());
          }
          return null;
        }
        const sel = { left, top, width, height };
        const ids: string[] = [];
        cardRefs.current.forEach((el, id) => {
          const r = el.getBoundingClientRect();
          const overlap =
            !(sel.left + sel.width < r.left || r.left + r.width < sel.left || sel.top + sel.height < r.top || r.top + r.height < sel.top);
          if (overlap) ids.push(id);
        });
        if (ids.length) {
          if (viewStack.length === 0) {
            const toAdd = e.altKey ? [] : ids.filter((id) => !pending.some((t) => t.assetId === id));
            const toRemove = e.altKey ? ids : [];
            setSelectedAssetIds((s) => {
              const next = new Set(s);
              toRemove.forEach((id) => next.delete(id));
              toAdd.forEach((id) => next.add(id));
              return next;
            });
          } else {
            const currentGroupId = viewStack[viewStack.length - 1]?.assetId;
            const toAdd = e.altKey
              ? []
              : ids.filter((key) => {
                  const parts = String(key).split('::');
                  if (parts.length !== 2) return true;
                  const idx = parseInt(parts[1], 10);
                  if (Number.isNaN(idx)) return true;
                  return !pending.some(
                    (t) => t.sourceGroupAssetId === currentGroupId && t.sourceItemIndex === idx
                  );
                });
            const toRemove = e.altKey ? ids : [];
            setSelectedGroupItemKeys((s) => {
              const next = new Set(s);
              toRemove.forEach((key) => next.delete(key));
              toAdd.forEach((key) => next.add(key));
              return next;
            });
          }
        }
        return null;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [marqueeRect, viewStack, pending]);

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
        e.preventDefault();
      }
    };
    document.addEventListener('wheel', handler, { passive: false, capture: true });
    return () => document.removeEventListener('wheel', handler, { capture: true });
  }, []);

  const discardResult = (assetId: string, actionType: string) => {
    const baseId = baseActionId(actionType);
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== assetId) return a;
        const nextResults = { ...a.results };
        delete nextResults[actionType];
        const nextOrder = (a.resultOrder || []).filter((k) => k !== actionType);
        const nextMeta = { ...a.resultMeta };
        delete nextMeta[actionType];
        const displayKey = a.displayKey === actionType ? 'original' : a.displayKey;
        const cutImageGroup = baseId === 'cut_image' ? undefined : a.cutImageGroup;
        return { ...a, results: nextResults, resultOrder: nextOrder, resultMeta: nextMeta, displayKey, cutImageGroup };
      })
    );
  };

  const markArchived = (assetId: string) => {
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id === assetId) {
          return { ...a, archived: true, hiddenInGrid: false, parentAssetId: undefined };
        }
        if (a.cutImageGroup?.length) {
          const filtered = a.cutImageGroup.filter(
            (item) => !(typeof item === 'object' && item && 'assetId' in item && item.assetId === assetId)
          );
          if (filtered.length !== a.cutImageGroup.length) {
            return { ...a, cutImageGroup: filtered.length ? filtered : undefined };
          }
        }
        return a;
      })
    );
    setArchiveHint({ assetId, ts: Date.now() });
    setTimeout(() => setArchiveHint((h) => (h?.assetId === assetId ? null : h)), 4000);
  };

  const removeAsset = useCallback((assetId: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== assetId));
    setPending((prev) => prev.filter((t) => t.assetId !== assetId));
    if (lightboxAssetId === assetId) setLightboxAssetId(null);
    if (archivedDetailAssetId === assetId) setArchivedDetailAssetId(null);
    setViewStack((s) => s.filter((x) => x.assetId !== assetId));
  }, [lightboxAssetId, archivedDetailAssetId]);

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
        else if (item && typeof item === 'object' && 'r2Key' in item) continue;
        else if (item && typeof item === 'object' && 'assetId' in item) {
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

  const groupBreadcrumb = useMemo(() => {
    if (viewStack.length === 0) return [];
    return viewStack
      .map((item) => assets.find((a) => a.id === item.assetId))
      .filter((a): a is WorkflowAsset => !!a)
      .map((a, idx) => ({
        id: a.id,
        label: a.groupLabel ?? (a.groupKind === 'manual' ? `组 ${idx + 1}` : `切割 ${idx + 1}`),
      }));
  }, [viewStack, assets]);

  /** 将组内项解析为资产 id 列表：引用项直接取 assetId；base64 项先创建子资产并更新组，再返回新 id */
  const ensureGroupItemsAsAssets = useCallback(
    (prev: WorkflowAsset[], groupAssetId: string, itemIndexes: number[]): { nextAssets: WorkflowAsset[]; assetIds: string[] } => {
      const group = prev.find((a) => a.id === groupAssetId);
      if (!group?.cutImageGroup?.length) return { nextAssets: prev, assetIds: [] };
      const assetIds: string[] = [];
      const updates: { index: number; assetId: string }[] = [];
      const newAssets: WorkflowAsset[] = [];
      for (const idx of itemIndexes) {
        if (idx < 0 || idx >= group.cutImageGroup!.length) continue;
        const item = group.cutImageGroup![idx];
        if (typeof item === 'object' && item && 'assetId' in item) {
          assetIds.push((item as { assetId: string }).assetId);
        } else if (typeof item === 'string') {
          const newId = uuid();
          newAssets.push({
            id: newId,
            original: item,
            displayKey: 'original',
            results: {},
            resultOrder: [],
            archived: false,
            hiddenInGrid: false,
            createdAt: Date.now(),
            parentAssetId: groupAssetId,
          });
          assetIds.push(newId);
          updates.push({ index: idx, assetId: newId });
        }
      }
      if (assetIds.length === 0) return { nextAssets: prev, assetIds: [] };
      let nextAssets: WorkflowAsset[] = [...prev, ...newAssets];
      const groupIdx = nextAssets.findIndex((a) => a.id === groupAssetId);
      if (groupIdx === -1) return { nextAssets: prev, assetIds: [] };
      if (updates.length > 0) {
        const g = nextAssets[groupIdx];
        const newGroupItems = [...(g.cutImageGroup ?? [])];
        for (const { index, assetId } of updates) {
          newGroupItems[index] = { assetId };
        }
        nextAssets = nextAssets.map((a, i) => (i === groupIdx ? { ...a, cutImageGroup: newGroupItems } : a));
      }
      return { nextAssets, assetIds };
    },
    []
  );

  /** 从组中移除指定下标的格；若组变空则移除组并清理父组引用。返回新 assets。 */
  const removeGroupItems = useCallback(
    (prev: WorkflowAsset[], groupAssetId: string, itemIndexes: number[]): WorkflowAsset[] => {
      const groupIdx = prev.findIndex((a) => a.id === groupAssetId);
      if (groupIdx === -1 || !prev[groupIdx].cutImageGroup?.length) return prev;
      const group = prev[groupIdx];
      const sorted = [...itemIndexes].filter((i) => i >= 0 && i < group.cutImageGroup!.length).sort((a, b) => b - a);
      if (sorted.length === 0) return prev;
      const nextGroupItems = [...group.cutImageGroup!];
      for (const i of sorted) nextGroupItems.splice(i, 1);
      let next = prev.map((a, i) =>
        i === groupIdx ? { ...a, cutImageGroup: nextGroupItems.length ? nextGroupItems : undefined } : a
      );
      if (nextGroupItems.length === 0) {
        next = next.filter((a) => a.id !== groupAssetId);
        if (group.parentAssetId) {
          const parentIdx = next.findIndex((a) => a.id === group.parentAssetId);
          if (parentIdx !== -1) {
            const parent = next[parentIdx];
            const filtered = (parent.cutImageGroup ?? []).filter(
              (x) => typeof x !== 'object' || (x as { assetId: string }).assetId !== groupAssetId
            );
            next = next.map((a, i) =>
              i === parentIdx ? { ...a, cutImageGroup: filtered.length ? filtered : undefined } : a
            );
          }
        }
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
          if (groupIdx >= 0 && Array.isArray(next[groupIdx].cutImageGroup)) {
            const group = next[groupIdx];
            const cut = [...(group.cutImageGroup || [])];
            if (opts!.sourceItemIndex! >= 0 && opts!.sourceItemIndex! < cut.length) {
              cut[opts!.sourceItemIndex!] = { assetId: newAsset.id };
              next[groupIdx] = { ...group, cutImageGroup: cut };
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
          ...(fromGroup
            ? { sourceGroupAssetId: opts!.sourceGroupAssetId, sourceItemIndex: opts!.sourceItemIndex }
            : {}),
        },
      ]);
    },
    [setAssets, setPending, onLog]
  );

  const createGroupFromAssets = useCallback(
    (assetIds: string[]) => {
      if (!assetIds.length) return;
      const first = assets.find((a) => a.id === assetIds[0]);
      const coverImage = first ? getAssetDisplayImage(first) : '';
      const groupId = uuid();
      const usedLabels = new Set<string>(assets.map((a) => a.groupLabel).filter((x): x is string => !!x));
      const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
        id: groupId,
        original: coverImage,
        displayKey: 'original',
        results: {},
        resultOrder: [],
        cutImageGroup: assetIds.map((id) => ({ assetId: id })),
        groupKind: 'manual',
        groupLabel: getRandomGroupCodeName(usedLabels),
        archived: false,
        hiddenInGrid: false,
        createdAt: Date.now(),
      });
      setAssets((prev) => {
        const mapped = prev.map((a) => {
          if (a.id === groupId) return a;
          if (assetIds.includes(a.id)) return { ...a, parentAssetId: groupId };
          if (a.cutImageGroup?.length) {
            const filtered = a.cutImageGroup.filter(
              (x) => !(typeof x === 'object' && x && 'assetId' in x && assetIds.includes((x as { assetId: string }).assetId))
            );
            if (filtered.length !== a.cutImageGroup.length) return { ...a, cutImageGroup: filtered.length ? filtered : undefined };
          }
          return a;
        });
        const insertIndex = prev.findIndex((a) => !a.parentAssetId && assetIds.includes(a.id));
        const idx = insertIndex >= 0 ? insertIndex : prev.length;
        return [...mapped.slice(0, idx), newGroup, ...mapped.slice(idx)];
      });
      setSelectedAssetIds(new Set());
    },
    [assets, getAssetDisplayImage, setAssets, setSelectedAssetIds]
  );

  const createNestedGroupFromGroupItem = useCallback(
    (groupAssetId: string, itemIndex: number) => {
      setAssets((prev) => {
        const group = prev.find((a) => a.id === groupAssetId);
        if (!group?.cutImageGroup || itemIndex < 0 || itemIndex >= group.cutImageGroup.length) return prev;
        const item = group.cutImageGroup[itemIndex];
        if (!item || typeof item !== 'object' || !('assetId' in item)) return prev;
        const childId = (item as { assetId: string }).assetId;
        const child = prev.find((a) => a.id === childId);
        const coverImage = child ? getAssetDisplayImage(child) : '';
        const newGroupId = uuid();
        const usedLabels = new Set<string>(prev.map((a) => a.groupLabel).filter((x): x is string => !!x));
        const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
          id: newGroupId,
          original: coverImage,
          displayKey: 'original',
          results: {},
          resultOrder: [],
          cutImageGroup: [{ assetId: childId }],
          groupKind: 'manual',
          groupLabel: getRandomGroupCodeName(usedLabels),
          archived: false,
          hiddenInGrid: false,
          createdAt: Date.now(),
          parentAssetId: groupAssetId,
        });
        return prev
          .map((a) => {
            if (a.id === groupAssetId && a.cutImageGroup) {
              const nextGroupItems = [...a.cutImageGroup];
              nextGroupItems[itemIndex] = { assetId: newGroupId };
              return { ...a, cutImageGroup: nextGroupItems };
            }
            if (a.id === childId) {
              return { ...a, parentAssetId: newGroupId };
            }
            return a;
          })
          .concat(newGroup);
      });
    },
    [getAssetDisplayImage, setAssets]
  );

  const getEffectiveAssetIdsForAction = useCallback(
    (ids: string[]): string[] => {
      const out = new Set<string>();
      ids.forEach((id) => {
        const asset = assets.find((a) => a.id === id);
        if (!asset) return;
        if (
          asset.cutImageGroup &&
          asset.cutImageGroup.length > 0 &&
          asset.cutImageGroup.every((item) => typeof item === 'object' && item && 'assetId' in item)
        ) {
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
  const favoriteActionSet = useMemo(() => new Set(favoriteActionIds), [favoriteActionIds]);
  const visibleByCategory = useMemo(
    () =>
      byCategory
        .map((g) => ({ ...g, list: g.list.filter((m) => !favoriteActionSet.has(m.id)) }))
        .filter((g) => g.list.length > 0),
    [byCategory, favoriteActionSet]
  );
  const visiblePresets = useMemo(
    () => presets.filter((m) => !favoriteActionSet.has(m.id)),
    [presets, favoriteActionSet]
  );
  const visibleCapabilitySets = useMemo(
    () => capabilitySets.filter((s) => !favoriteActionSet.has(`${SET_ACTION_PREFIX}${s.id}`)),
    [capabilitySets, favoriteActionSet]
  );
  const favoriteEntries = useMemo(() => {
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
      .filter((x): x is { id: string; label: string; kind: 'module' | 'set'; mod?: CustomAppModule; set?: CapabilitySet } => !!x);
  }, [favoriteActionIds, capabilitySets, actionModules]);
  const removeActionFromFavorite = useCallback((actionId: string) => {
    setFavoriteActionIds((prev) => prev.filter((id) => id !== actionId));
  }, []);
  const toggleSectionCollapsed = useCallback((sectionId: string) => {
    setCollapsedSectionIds((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }, []);

  const handleDropToModuleAction = useCallback(
    (mod: CustomAppModule, tweakPrompt = false) => {
      if (tweakPrompt) {
        const targets: Array<
          | {
              assetId: string;
              inputImage: string;
              inputSourceDisplayKey?: string;
              sourceGroupAssetId?: string;
              sourceItemIndex?: number;
            }
          | { imageBase64: string; parentAssetId: string; sourceGroupAssetId: string; sourceItemIndex: number }
        > = [];
        if (draggingAssetIds?.length) {
          const effectiveIds = getEffectiveAssetIdsForAction(draggingAssetIds);
          effectiveIds.forEach((id) => {
            const a = assets.find((x) => x.id === id);
            if (a) targets.push({ assetId: id, inputImage: getAssetDisplayImage(a), inputSourceDisplayKey: a.displayKey });
          });
        } else if (draggingGroupItems && currentGroupAsset) {
          draggingGroupItems.itemIndexes.forEach((itemIndex) => {
            const item = currentGroupItems[itemIndex];
            if (!item) return;
            if (typeof item === 'string') {
              targets.push({
                imageBase64: item,
                parentAssetId: currentGroupAsset.id,
                sourceGroupAssetId: currentGroupAsset.id,
                sourceItemIndex: itemIndex,
              });
            } else {
              const child = assets.find((x) => x.id === (item as { assetId: string }).assetId);
              if (child)
                targets.push({
                  assetId: (item as { assetId: string }).assetId,
                  inputImage: getAssetDisplayImage(child),
                  inputSourceDisplayKey: child.displayKey,
                  sourceGroupAssetId: currentGroupAsset.id,
                  sourceItemIndex: itemIndex,
                });
            }
          });
        }
        if (targets.length > 0) setPromptTweakModal({ preset: mod, targets });
        return;
      }

      if (draggingAssetIds?.length) {
        const effectiveIds = getEffectiveAssetIdsForAction(draggingAssetIds);
        if (mod.category === 'generate_3d' && onAddGenerate3DJob && draggingAssetId) {
          const a = assets.find((x) => x.id === draggingAssetId);
          const img = a ? getAssetDisplayImage(a) : null;
          if (img) onAddGenerate3DJob(mod, img);
          return;
        }
        effectiveIds.forEach((id) => addToPending(id, mod.id));
        return;
      }
      if (draggingGroupItems && currentGroupAsset) {
        if (mod.category === 'generate_3d' && onAddGenerate3DJob) {
          const firstIndex = draggingGroupItems.itemIndexes[0];
          const item = currentGroupItems[firstIndex];
          let img: string | null = null;
          if (typeof item === 'string') img = item;
          else {
            const child = assets.find((x) => x.id === item.assetId);
            if (child) img = getAssetDisplayImage(child);
          }
          if (img) onAddGenerate3DJob(mod, img);
          return;
        }
        draggingGroupItems.itemIndexes.forEach((itemIndex) => {
          const item = currentGroupItems[itemIndex];
          if (!item) return;
          if (typeof item === 'string') {
            addImageToPending(item, mod.id, {
              parentAssetId: currentGroupAsset.id,
              sourceGroupAssetId: currentGroupAsset.id,
              sourceItemIndex: itemIndex,
            });
          } else {
            const child = assets.find((x) => x.id === (item as { assetId: string }).assetId);
            const inputImage = child ? getAssetDisplayImage(child) : '';
            setPending((prev) => [
              ...prev,
              {
                id: uuid(),
                assetId: (item as { assetId: string }).assetId,
                actionType: mod.id,
                inputImage,
                addedAt: Date.now(),
                inputSourceDisplayKey: child?.displayKey,
                sourceGroupAssetId: currentGroupAsset.id,
                sourceItemIndex: itemIndex,
              },
            ]);
          }
        });
      }
    },
    [
      draggingAssetIds,
      getEffectiveAssetIdsForAction,
      assets,
      getAssetDisplayImage,
      draggingGroupItems,
      currentGroupAsset,
      currentGroupItems,
      onAddGenerate3DJob,
      draggingAssetId,
      addToPending,
      addImageToPending,
      setPending,
    ]
  );

  const handleDropToSetAction = useCallback(
    (setActionId: string) => {
      if (draggingAssetIds?.length) {
        const effectiveIds = getEffectiveAssetIdsForAction(draggingAssetIds);
        effectiveIds.forEach((id) => addToPending(id, setActionId));
        return;
      }
      if (draggingGroupItems && currentGroupAsset) {
        draggingGroupItems.itemIndexes.forEach((itemIndex) => {
          const item = currentGroupItems[itemIndex];
          if (!item) return;
          if (typeof item === 'string') {
            addImageToPending(item, setActionId, {
              parentAssetId: currentGroupAsset.id,
              sourceGroupAssetId: currentGroupAsset.id,
              sourceItemIndex: itemIndex,
            });
          } else {
            const child = assets.find((x) => x.id === (item as { assetId: string }).assetId);
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
                sourceGroupAssetId: currentGroupAsset.id,
                sourceItemIndex: itemIndex,
              },
            ]);
          }
        });
      }
    },
    [
      draggingAssetIds,
      getEffectiveAssetIdsForAction,
      addToPending,
      draggingGroupItems,
      currentGroupAsset,
      currentGroupItems,
      addImageToPending,
      assets,
      getAssetDisplayImage,
      setPending,
    ]
  );

  return (
    <div className="flex flex-col min-h-[400px] h-[calc(100dvh-6rem)] gap-4">
      <div className="flex flex-col gap-2 shrink-0 w-full sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex flex-wrap items-center gap-4 min-w-0 flex-1">
        <span className="text-[10px] font-black text-blue-400 uppercase mr-2">工作区</span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-black text-gray-500 uppercase">显示</span>
          <button
            onClick={() => {
              setShowArchived(false);
            }}
            className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border ${!showArchived ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#1c1c22] border-[#2e2e32] text-gray-500 hover:bg-[#2e2e36]'}`}
          >
            进行中
          </button>
          <button
            onClick={() => {
              setShowArchived(true);
              setViewStack([]);
              setSelectedGroupItemKeys(new Set());
            }}
            className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border ${showArchived ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#1c1c22] border-[#2e2e32] text-gray-500 hover:bg-[#2e2e36]'}`}
          >
            已完成
          </button>
        </div>
        {archiveHint && !showArchived && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#152642] border border-[#3b6fb8] text-[9px] text-blue-200">
            <span className="font-black uppercase">已归档</span>
            <span className="text-gray-300">在「已完成」里查看</span>
            <button
              type="button"
              onClick={() => {
                setShowArchived(true);
                setArchivedDetailAssetId(archiveHint.assetId);
                setArchiveHint(null);
              }}
              className="px-2 py-1 rounded-lg bg-[#1e3558] hover:bg-[#264670] text-[8px] font-black uppercase text-blue-100"
            >
              去查看
            </button>
          </div>
        )}
        <label className="px-4 py-2 rounded-xl bg-[#1c1c22] border border-[#2e2e32] text-[9px] font-black uppercase cursor-pointer hover:bg-[#2e2e36]">
          多选上传
          <input type="file" className="hidden" accept="image/*" multiple onChange={handleBatchUploadCorrect} />
        </label>
        {onOpenLibraryPicker && (
          <button
            type="button"
            onClick={() =>
              onOpenLibraryPicker((items) => {
                const valid = items.filter((item) => item?.data);
                if (!valid.length) return;
                setAssets((prev) => {
                  const groupCtx =
                    viewStack.length > 0
                      ? prev.find((a) => a.id === viewStack[viewStack.length - 1].assetId)
                      : null;
                  const created: WorkflowAsset[] = valid.map((item) => ({
                    id: uuid(),
                    original: item.data,
                    displayKey: 'original' as const,
                    results: {} as Record<string, string>,
                    resultOrder: [] as string[],
                    archived: false,
                    hiddenInGrid: false,
                    createdAt: Date.now(),
                    ...(groupCtx ? { parentAssetId: groupCtx.id } : {}),
                  }));
                  if (!groupCtx) {
                    return [...prev, ...created];
                  }
                  const next = prev.map((a) => {
                    if (a.id === groupCtx.id) {
                      const items = [...(a.cutImageGroup ?? [])];
                      created.forEach((c) => items.push({ assetId: c.id }));
                      return { ...a, cutImageGroup: items };
                    }
                    return a;
                  });
                  return next.concat(created);
                });
              })
            }
            className="px-4 py-2 rounded-xl bg-[#1c1c22] border border-[#2e2e32] text-[9px] font-black uppercase hover:bg-[#2e2e36]"
          >
            从仓库导入
          </button>
        )}
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-[#2e2e32] bg-[#1c1c22] overflow-hidden">
            <button
              type="button"
              onClick={() => setColumnCount((n) => Math.max(2, n - 1))}
              disabled={columnCount <= 2}
              className="w-8 h-8 text-[12px] font-black text-gray-300 hover:bg-[#2e2e36] disabled:opacity-35 disabled:hover:bg-transparent"
              aria-label="减少列数"
            >
              −
            </button>
            <span className="w-9 h-8 inline-flex items-center justify-center text-[10px] font-black text-blue-300 border-x border-[#2e2e32]">
              {columnCount}
            </span>
            <button
              type="button"
              onClick={() => setColumnCount((n) => Math.min(6, n + 1))}
              disabled={columnCount >= 6}
              className="w-8 h-8 text-[12px] font-black text-gray-300 hover:bg-[#2e2e36] disabled:opacity-35 disabled:hover:bg-transparent"
              aria-label="增加列数"
            >
              +
            </button>
          </div>
        </div>
        {(pending.length > 0 || executingQueue) && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#1c1c22] border border-[#2e2e32]">
            {executingQueue ? (
              <>
                <span className="text-[8px] font-black uppercase text-blue-300">执行中</span>
                <span className="text-[8px] text-gray-300">
                  {executingQueue.current} / {executingQueue.total}
                </span>
              </>
            ) : (
              <>
                <span className="text-[8px] font-black uppercase text-blue-300">待处理</span>
                <span className="text-[8px] text-gray-300">{pending.length} 项等待执行</span>
                <button
                  type="button"
                  onClick={() => setPending([])}
                  className="text-[8px] text-blue-400 hover:text-blue-300 font-medium ml-1"
                >
                  清空
                </button>
              </>
            )}
          </div>
        )}
        {!showArchived && visibleAssets.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const selectableIds = visibleAssets
                  .filter((a) => !pending.some((t) => t.assetId === a.id))
                  .map((a) => a.id);
                const all = new Set(selectableIds);
                setSelectedAssetIds((prev) => (prev.size === all.size ? new Set() : all));
              }}
              className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border bg-[#1c1c22] border-[#2e2e32] hover:bg-[#2e2e36]"
            >
              {(() => {
                const selectableCount = visibleAssets.filter(
                  (a) => !pending.some((t) => t.assetId === a.id)
                ).length;
                return selectedAssetIds.size === selectableCount && selectableCount > 0
                  ? '取消全选'
                  : '全选';
              })()}
            </button>
            {selectedAssetIds.size > 0 && (
              <>
                <span className="text-[9px] text-gray-500">已选 {selectedAssetIds.size}</span>
                <span className="text-[8px] text-gray-600">空白处点击清空 · Alt+框选减选</span>
              </>
            )}
          </div>
        )}
        </div>
        <button
          type="button"
          onClick={() => setApiKeyModalOpen(true)}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1c1c22] border border-[#2e2e32] text-[9px] font-black uppercase hover:bg-[#2e2e36] hover:border-[#3b6fb8] self-end sm:self-center"
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
            className={`h-2.5 w-2.5 shrink-0 rounded-full border border-[#3a3a40] ${
              aiInvocationReady
                ? 'bg-emerald-500 shadow-[0_0_10px_rgba(34,197,94,0.45)]'
                : 'bg-[#b45309] shadow-[0_0_8px_rgba(217,119,6,0.35)]'
            }`}
          />
          <span>API 密钥</span>
        </button>
      </div>

      {apiKeyModalOpen && (
        <WorkflowApiKeyModal
          open={apiKeyModalOpen}
          onClose={() => setApiKeyModalOpen(false)}
          onSaved={() => setAiInvocationStatusRev((n) => n + 1)}
        />
      )}

      <div className="flex-1 min-h-0 flex gap-6">
        <div
          ref={scrollAreaRef}
          className={`flex-1 min-w-0 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-3 rounded-xl transition-colors ${
            dropZoneActive ? 'ring-1 ring-[#3b82f6] bg-[#152535]' : ''
          }`}
          onDragOver={(e) => {
            if (!hasImageFileTransfer(e.dataTransfer)) return;
            e.preventDefault();
            setDropZoneActive(true);
          }}
          onDragLeave={(e) => {
            const next = e.relatedTarget as Node | null;
            if (!next || !e.currentTarget.contains(next)) setDropZoneActive(false);
          }}
          onDrop={handleDrop}
          onPaste={handlePaste}
          tabIndex={0}
          onMouseDownCapture={(e) => {
            if (showArchived) return;
            if (!scrollAreaRef.current?.contains(e.target as Node)) return;
            if ((e.target as Element).closest('[data-workflow-card]')) return;
            if ((e.target as Element).closest('button, [role="button"], a, input, select, textarea')) return;
            e.preventDefault();
            e.stopPropagation();
            setMarqueeRect({ startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY });
          }}
        >
          {viewStack.length > 0 ? (
            <>
              <div className="flex items-center gap-2 shrink-0 px-2">
                <button
                  type="button"
                  onClick={() => startTransition(() => setViewStack((s) => s.slice(0, -1)))}
                  className="px-3 py-1.5 rounded-lg bg-[#26262c] text-[9px] font-black uppercase hover:bg-[#383842]"
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
                          onClick={() =>
                            setViewStack((s) => {
                              const pos = s.findIndex((x) => x.assetId === b.id);
                              return pos === -1 ? s : s.slice(0, pos + 1);
                            })
                          }
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
                      组内 ({currentGroupItems.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAllInGroup((v) => !v)}
                      className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${showAllInGroup ? 'bg-blue-600 border-blue-500' : 'bg-[#1c1c22] border-[#2e2e32] hover:bg-[#2e2e36]'}`}
                    >
                      {showAllInGroup ? '显示层级' : '显示全部'}
                    </button>
                    {!showAllInGroup && currentGroupItems.length > 0 && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const selectableKeys = currentGroupItems
                              .map((_, i) => `${currentGroupAsset.id}::${i}`)
                              .filter(
                                (_, i) =>
                                  !pending.some(
                                    (t) =>
                                      t.sourceGroupAssetId === currentGroupAsset.id &&
                                      t.sourceItemIndex === i
                                  )
                              );
                            const allKeys = new Set(selectableKeys);
                            setSelectedGroupItemKeys((prev) =>
                              prev.size === allKeys.size ? new Set() : allKeys
                            );
                          }}
                          className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border bg-[#1c1c22] border-[#2e2e32] hover:bg-[#2e2e36]"
                        >
                          {(() => {
                            const selectableCount = currentGroupItems.filter(
                              (_, i) =>
                                !pending.some(
                                  (t) =>
                                    t.sourceGroupAssetId === currentGroupAsset.id &&
                                    t.sourceItemIndex === i
                                )
                            ).length;
                            return selectedGroupItemKeys.size === selectableCount &&
                              selectableCount > 0
                              ? '取消全选'
                              : '全选';
                          })()}
                        </button>
                        {selectedGroupItemKeys.size > 0 && (
                          <>
                            <span className="text-[9px] text-gray-500">已选 {selectedGroupItemKeys.size}</span>
                            <span className="text-[8px] text-gray-600">空白处点击清空 · Alt+框选减选</span>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div
                className="gap-4 flex-1 px-6 pt-4"
                style={{
                  columnCount: showAllInGroup ? Math.max(2, columnCount) : columnCount,
                  columnFill: 'balance' as const,
                }}
              >
                {!currentGroupAsset ? (
                  <div className="py-8 text-center text-[9px] text-gray-500">该组已被删除或不存在，请返回</div>
                ) : showAllImages
                  ? showAllImages.map((img, idx) => (
                      <div
                        key={idx}
                        data-workflow-card
                        className="break-inside-avoid mb-4 rounded-2xl border border-[#2e2e32] bg-[#16161a] overflow-hidden"
                      >
                        <img
                          src={workflowSafeImgSrc(img)}
                          alt=""
                          draggable={false}
                          onDragStart={(e) => e.preventDefault()}
                          className="w-full h-auto object-cover block"
                          style={{ maxHeight: 280 }}
                        />
                      </div>
                    ))
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
                      const isPendingItem =
                        !!pending.find(
                          (t) => t.sourceGroupAssetId === currentGroupAsset.id && t.sourceItemIndex === idx
                        ) ||
                        !!executingQueue?.tasks.find(
                          (t) =>
                            t.sourceGroupAssetId === currentGroupAsset.id &&
                            t.sourceItemIndex === idx &&
                            !completedTaskIds.has(t.id)
                        );
                      const isPendingOnly =
                        !!pending.find(
                          (t) => t.sourceGroupAssetId === currentGroupAsset.id && t.sourceItemIndex === idx
                        ) && !executingQueue;
                      const currentTask =
                        executingQueue && executingQueue.current > 0
                          ? executingQueue.tasks[executingQueue.current - 1]
                          : null;
                      const isExecutingCurrentItem =
                        !!currentTask &&
                        !completedTaskIds.has(currentTask.id) &&
                        currentTask.sourceGroupAssetId === currentGroupAsset?.id &&
                        currentTask.sourceItemIndex === idx;

                      if (isAssetRef && childAsset) {
                        return (
                          <div key={idx} className="break-inside-avoid mb-6 relative">
                            {childAsset.cutImageGroup?.length && (
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
                              return (
                                <div
                                  data-workflow-card
                                  ref={(el) => {
                                    if (!currentGroupAsset) return;
                                    if (el) cardRefs.current.set(groupKey, el);
                                    else cardRefs.current.delete(groupKey);
                                  }}
                                  className={`group relative rounded-2xl border bg-[#16161a] overflow-hidden ${
                                    selectedGroupItemKeys.has(groupKey)
                                      ? 'border-blue-500 ring-2 ring-blue-500/50'
                                      : dragOverGroupItemKey === groupKey
                                      ? 'border-blue-500 ring-2 ring-blue-500/50'
                                      : childAsset.cutImageGroup?.length
                                      ? 'border-blue-400'
                                      : 'border-[#2e2e32]'
                                  } transition-transform duration-150 ease-out will-change-transform ${motionClass}`}
                                  draggable
                                  onDragStart={() => {
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
                                      assetIds.includes(a.id) ? { ...a, parentAssetId: newGroupId } : a
                                    );
                                    const groupIdx = updated.findIndex((a) => a.id === groupAssetId);
                                    if (groupIdx !== -1) {
                                      const g = updated[groupIdx];
                                      const items = [...(g.cutImageGroup ?? [])];
                                      const sorted = allIndexes.filter((i) => i >= 0 && i < items.length).sort((a, b) => a - b);
                                      const keep: typeof items = [];
                                      items.forEach((it, i) => {
                                        if (!sorted.includes(i)) keep.push(it);
                                      });
                                      const insertPos = sorted.length ? sorted[0] : keep.length;
                                      const withGroup = [...keep];
                                      withGroup.splice(insertPos, 0, { assetId: newGroupId });
                                      updated = updated.map((a, i) =>
                                        i === groupIdx ? { ...a, cutImageGroup: withGroup } : a
                                      );
                                    }
                                    const usedLabels = new Set<string>(
                                      updated.map((a) => a.groupLabel).filter((x): x is string => !!x)
                                    );
                                    const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
                                      id: newGroupId,
                                      original: coverImage,
                                      displayKey: 'original',
                                      results: {},
                                      resultOrder: [],
                                      cutImageGroup: assetIds.map((id) => ({ assetId: id })),
                                      groupKind: 'manual',
                                      groupLabel: getRandomGroupCodeName(usedLabels),
                                      archived: false,
                                      hiddenInGrid: false,
                                      createdAt: Date.now(),
                                      parentAssetId: groupAssetId,
                                    });
                                    setAssets([...updated, newGroup]);
                                    setSelectedGroupItemKeys(new Set());
                                    setDraggingGroupItems(null);
                                  }}
                                  {...((getDisplayKeysForAsset(childAsset).length > 1 || (childAsset.cutImageGroup?.length ?? 0) > 1)
                                    ? { 'data-prevent-wheel-scroll': '' }
                                    : {})}
                                  onWheel={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (childAsset.cutImageGroup?.length) {
                                      if (childAsset.cutImageGroup.length <= 1) return;
                                      const delta = e.deltaY > 0 ? 1 : -1;
                                      setGroupPreviewIndexById((prev) => {
                                        const current = prev[childAsset.id] ?? 0;
                                        const len = childAsset.cutImageGroup?.length ?? 1;
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
                                      if (childAsset.cutImageGroup?.length) {
                                        setViewStack((s) => [...s, { assetId: childAsset.id }]);
                                      } else {
                                        setLightboxAssetId(childAsset.id);
                                      }
                                    }}
                                  >
                                    <img
                                      src={(() => {
                                        if (!childAsset.cutImageGroup?.length) return img;
                                        const groupItems = childAsset.cutImageGroup;
                                        const len = groupItems.length;
                                        const rawIndex = groupPreviewIndexById[childAsset.id] ?? 0;
                                        const safeIndex = len ? ((rawIndex % len) + len) % len : 0;
                                        const itemInGroup = groupItems[safeIndex] ?? groupItems[0];
                                        if (typeof itemInGroup === 'string') return itemInGroup;
                                        if (itemInGroup && typeof itemInGroup === 'object' && 'r2Key' in itemInGroup)
                                          return childAsset.original;
                                        const nestedId =
                                          itemInGroup && typeof itemInGroup === 'object' && 'assetId' in itemInGroup
                                            ? (itemInGroup as { assetId: string }).assetId
                                            : '';
                                        const nestedChild = nestedId ? assets.find((x) => x.id === nestedId) : undefined;
                                        return nestedChild ? getAssetDisplayImage(nestedChild) : img;
                                      })()}
                                      alt=""
                                      draggable={false}
                                      onDragStart={(e) => e.preventDefault()}
                                      className="w-full h-auto object-cover block"
                                      style={{ maxHeight: 360 }}
                                    />
                                    <div
                                      aria-hidden
                                      className="absolute inset-0 z-[1]"
                                      draggable={false}
                                      onDragStart={(e) => e.preventDefault()}
                                    />
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
                                          className="w-8 h-8 rounded-full flex items-center justify-center bg-[#26262c] border border-[#3a3a40] text-gray-400 hover:bg-[#4a1c1c] hover:border-[#c87878] hover:text-red-300 text-base font-medium leading-none"
                                          title="从队列移除"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    )}
                                    {isPendingItem && !isPendingOnly && (
                                      <div className="absolute inset-0 z-10 bg-[#16161a] flex items-center justify-center pointer-events-none">
                                        <div
                                          className={`h-7 w-7 rounded-full border-[3px] ${
                                            isExecutingCurrentItem
                                              ? 'border-blue-400 border-t-transparent animate-spin'
                                              : 'border-[#484850] border-t-transparent'
                                          }`}
                                        />
                                      </div>
                                    )}
                                    {assetErrors.has(childAsset.id) && (
                                      <span className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-[#b91c1c] text-[8px] font-black text-white">
                                        执行出错
                                      </span>
                                    )}
                                    {childAsset.cutImageGroup?.length && (
                                      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-[#1d4ed8]">
                                        {(childAsset.groupLabel ?? (childAsset.groupKind === 'manual' ? '组' : '切割'))} {childAsset.cutImageGroup.length}
                                      </span>
                                    )}
                                  </div>
                                  {!childAsset.cutImageGroup?.length && (
                                    <div className="p-2 flex flex-col gap-1.5 border-t border-[#252528]">
                                      <div className="flex gap-1 flex-wrap items-center justify-between min-h-[18px]">
                                        <span className="inline-flex items-center gap-1 rounded-full border border-[#2e2e32] bg-[#151518] px-2 py-0.5 text-[7px] text-gray-300/95 select-none">
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
                          ref={(el) => {
                            if (!currentGroupAsset) return;
                            if (el) cardRefs.current.set(groupKey, el);
                            else cardRefs.current.delete(groupKey);
                          }}
                          className={`break-inside-avoid mb-4 group relative rounded-2xl border bg-[#16161a] overflow-hidden ${
                            selectedGroupItemKeys.has(groupKey)
                              ? 'border-blue-500 ring-2 ring-blue-500/50'
                              : 'border-[#2e2e32]'
                          }`}
                          draggable
                          onDragStart={() => {
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
                            <img
                              src={workflowSafeImgSrc(img)}
                              alt=""
                              draggable={false}
                              onDragStart={(e) => e.preventDefault()}
                              className="w-full h-auto object-cover block"
                              style={{ maxHeight: 280 }}
                            />
                            <div
                              aria-hidden
                              className="absolute inset-0 z-[1]"
                              draggable={false}
                              onDragStart={(e) => e.preventDefault()}
                            />
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
                                  className="w-8 h-8 rounded-full flex items-center justify-center bg-[#26262c] border border-[#3a3a40] text-gray-400 hover:bg-[#4a1c1c] hover:border-[#c87878] hover:text-red-300 text-base font-medium leading-none"
                                  title="从队列移除"
                                >
                                  ×
                                </button>
                              </div>
                            )}
                            {isPendingItem && !isPendingOnly && (
                              <div className="absolute inset-0 z-10 bg-[#16161a] flex items-center justify-center pointer-events-none">
                                <div
                                  className={`h-7 w-7 rounded-full border-[3px] ${
                                    isExecutingCurrentItem
                                      ? 'border-blue-400 border-t-transparent animate-spin'
                                      : 'border-[#484850] border-t-transparent'
                                  }`}
                                />
                              </div>
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
                <div className="flex flex-col items-center justify-center py-12 text-gray-500 text-[9px]">此组暂无内容</div>
              )}
            </>
          ) : visibleAssets.length === 0 ? (
            <div className="flex flex-1 min-h-0 flex-col items-center justify-center px-6 py-10 text-gray-500">
              <AppIcon name="camera" className="w-10 h-10 mb-2" />
              <p className="text-[10px] font-black uppercase">暂无图片</p>
              <p className="text-[9px] mt-1 text-center max-w-sm">
                使用「多选上传」添加原始图片，或切换到「已完成」查看归档（可点击打开）
              </p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 p-6 min-w-0">
              <div
                ref={gridRef}
                className="gap-4 relative"
                style={{ columnCount, columnFill: 'balance' as const }}
              >
                {visibleAssets.map((a) => {
                  const isBusy = busyAssetIds.has(a.id);
                  const isPendingOnly =
                    pending.some((t) => t.assetId === a.id) && !executingQueue;
                  const currentTask =
                    executingQueue && executingQueue.current > 0
                      ? executingQueue.tasks[executingQueue.current - 1]
                      : null;
                  const isExecutingCurrent =
                    !!currentTask &&
                    !completedTaskIds.has(currentTask.id) &&
                    currentTask.assetId === a.id;
                  const bounce = groupBounceStateById[a.id] ?? 'idle';
                  const motionClass =
                    bounce === 'up'
                      ? '-translate-y-0.5 -rotate-[0.6deg] scale-[0.985]'
                      : bounce === 'down'
                      ? 'translate-y-0.5 rotate-[0.6deg] scale-[0.985]'
                      : '';
                  const busyClass =
                    isBusy && !isPendingOnly ? 'pointer-events-none' : '';

                  return (
                    <div key={a.id} className="break-inside-avoid mb-6 relative">
                      {a.cutImageGroup?.length && (
                        <>
                          <div className="absolute inset-0 rounded-2xl bg-[#16161a] border border-[#3b6fb8] translate-x-[16px] translate-y-[16px] -rotate-3 opacity-70 shadow-xl shadow-[#000000] pointer-events-none" />
                          <div className="absolute inset-0 rounded-2xl bg-[#1a1a1e] border border-[#6090d0] translate-x-[8px] translate-y-[8px] rotate-1 opacity-90 shadow-xl shadow-[#000000] pointer-events-none" />
                        </>
                      )}
                      <div
                        data-workflow-card
                        ref={(el) => {
                          if (el) cardRefs.current.set(a.id, el);
                          else cardRefs.current.delete(a.id);
                        }}
                        className={`group relative rounded-2xl border overflow-hidden bg-[#16161a] ${
                          selectedAssetIds.has(a.id)
                            ? 'border-blue-500 ring-2 ring-blue-500/50'
                            : dragOverAssetId === a.id
                            ? a.cutImageGroup?.length
                              ? 'border-blue-400 ring-2 ring-blue-400/60'
                              : 'border-blue-500 ring-2 ring-blue-500/50'
                            : a.cutImageGroup?.length
                            ? 'border-blue-400'
                            : 'border-[#2e2e32]'
                        } ${busyClass} transition-transform duration-150 ease-out will-change-transform ${motionClass}`}
                        draggable={!showArchived && !isBusy}
                        onDragStart={() => {
                          if (showArchived || isBusy) return;
                          const ids =
                            selectedAssetIds.has(a.id) && selectedAssetIds.size > 0
                              ? Array.from(selectedAssetIds)
                              : [a.id];
                          setDraggingAssetIds(ids);
                        }}
                        onDragEnd={() => {
                          setDraggingAssetIds(null);
                          setDragOverAction(null);
                          setDragOverAssetId(null);
                        }}
                        onDragOver={(e) => {
                          if (!draggingAssetIds?.length || isBusy) return;
                          e.preventDefault();
                          setDragOverAssetId(a.id);
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          if (dragOverAssetId === a.id) setDragOverAssetId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (!draggingAssetIds?.length || isBusy) {
                            setDragOverAssetId(null);
                            return;
                          }
                          const dragIds = Array.from(
                            new Set(draggingAssetIds.filter((id) => id !== a.id))
                          );
                          if (dragIds.length > 0) {
                            if (a.cutImageGroup?.length) {
                              setAssets((prev) => {
                                const next = prev.map((asset) => {
                                  if (asset.id === a.id) {
                                    const groupItems = [...(asset.cutImageGroup ?? [])];
                                    dragIds.forEach((id) => {
                                      groupItems.push({ assetId: id });
                                    });
                                    return { ...asset, cutImageGroup: groupItems };
                                  }
                                  if (dragIds.includes(asset.id)) {
                                    return { ...asset, parentAssetId: a.id };
                                  }
                                  if (asset.cutImageGroup?.length) {
                                    const filtered = asset.cutImageGroup.filter(
                                      (x) =>
                                        !(
                                          typeof x === 'object' &&
                                          x &&
                                          'assetId' in x &&
                                          dragIds.includes((x as { assetId: string }).assetId)
                                        )
                                    );
                                    if (filtered.length !== asset.cutImageGroup.length) {
                                      return {
                                        ...asset,
                                        cutImageGroup: filtered.length ? filtered : undefined,
                                      };
                                    }
                                  }
                                  return asset;
                                });
                                return next;
                              });
                            } else {
                              const members = Array.from(new Set([...dragIds, a.id]));
                              if (members.length > 1) {
                                createGroupFromAssets(members);
                              }
                            }
                          }
                          setDragOverAssetId(null);
                          setDraggingAssetIds(null);
                        }}
                        {...((!isBusy && !showArchived && (getDisplayKeysForAsset(a).length > 1 || (a.cutImageGroup?.length ?? 0) > 1))
                          ? { 'data-prevent-wheel-scroll': '' }
                          : {})}
                        onWheel={(e) => {
                          if (isBusy) return;
                          e.preventDefault();
                          e.stopPropagation();
                          if (showArchived) return;
                          if (a.cutImageGroup?.length) {
                            if (!a.cutImageGroup.length) return;
                            const delta = e.deltaY > 0 ? 1 : -1;
                            setGroupPreviewIndexById((prev) => {
                              const current = prev[a.id] ?? 0;
                              const len = a.cutImageGroup ? a.cutImageGroup.length : 1;
                              const next = ((current + delta) % len + len) % len;
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
                            } else if (a.cutImageGroup?.length) {
                              setViewStack([{ assetId: a.id }]);
                            } else {
                              setLightboxAssetId(a.id);
                            }
                          }}
                        >
                          <div className="relative w-full max-h-[360px] overflow-hidden">
                            <div
                              className="w-full"
                              style={{ paddingBottom: `${(assetAspectById[a.id] ?? 1) * 100}%` }}
                            />
                            <img
                              src={workflowSafeImgSrc(
                                (() => {
                                  if (!a.cutImageGroup?.length) return getAssetDisplayImage(a);
                                  const groupItems = a.cutImageGroup;
                                  const len = groupItems.length;
                                  const rawIndex = groupPreviewIndexById[a.id] ?? 0;
                                  const safeIndex = len ? ((rawIndex % len) + len) % len : 0;
                                  const item = groupItems[safeIndex] ?? groupItems[0];
                                  if (typeof item === 'string') return item;
                                  const child = assets.find((x) => x.id === item.assetId);
                                  return child ? getAssetDisplayImage(child) : getAssetDisplayImage(a);
                                })()
                              )}
                              alt=""
                              draggable={false}
                              onDragStart={(e) => e.preventDefault()}
                              className="absolute inset-0 w-full h-full object-cover block"
                              onLoad={(e) => {
                                setAssetAspectById((prev) => {
                                  if (prev[a.id]) return prev;
                                  const img = e.currentTarget as HTMLImageElement | null;
                                  if (!img || !img.naturalWidth || !img.naturalHeight) return prev;
                                  const ratio = img.naturalHeight / img.naturalWidth;
                                  return { ...prev, [a.id]: ratio };
                                });
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
                                    prev.filter((t) => t.assetId !== a.id)
                                  )
                                }
                                className="w-8 h-8 rounded-full flex items-center justify-center bg-[#26262c] border border-[#3a3a40] text-gray-400 hover:bg-[#4a1c1c] hover:border-[#c87878] hover:text-red-300 text-base font-medium leading-none"
                                title="从队列移除"
                              >
                                ×
                              </button>
                            </div>
                          )}
                          {isBusy && !isPendingOnly && (
                            <div className="absolute inset-0 z-10 bg-[#16161a] flex items-center justify-center pointer-events-none">
                              <div
                                className={`h-7 w-7 rounded-full border-[3px] ${
                                  isExecutingCurrent
                                    ? 'border-blue-400 border-t-transparent animate-spin'
                                    : 'border-[#484850] border-t-transparent'
                                }`}
                              />
                            </div>
                          )}
                          {assetErrors.has(a.id) && (
                            <span className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-[#b91c1c] text-[8px] font-black text-white">
                              执行出错
                            </span>
                          )}
                          {a.cutImageGroup?.length && (
                            <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-[#1d4ed8]">
                              {(a.groupLabel ?? (a.groupKind === 'manual' ? '组' : '切割'))} {a.cutImageGroup.length}
                            </span>
                          )}
                        </div>
                        {!showArchived && !a.cutImageGroup?.length && (
                          <div className="p-2 flex flex-col gap-1.5 border-t border-[#252528] bg-[#050505]">
                            <div className="flex gap-1 flex-wrap items-center justify-between min-h-[18px]">
                              <span className="inline-flex items-center gap-1 rounded-full border border-[#2e2e32] bg-[#151518] px-2 py-0.5 text-[7px] text-gray-300/95 select-none">
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
        {marqueeRect && !showArchived && (
          <div
            className="fixed pointer-events-none z-[150] rounded-[3px] border-2 border-solid border-[#4570b0] bg-[#121a28]/50 shadow-[inset_0_0_0_1px_rgba(69,112,176,0.2)]"
            style={{
              left: Math.min(marqueeRect.startX, marqueeRect.endX),
              top: Math.min(marqueeRect.startY, marqueeRect.endY),
              width: Math.max(0, Math.abs(marqueeRect.endX - marqueeRect.startX)),
              height: Math.max(0, Math.abs(marqueeRect.endY - marqueeRect.startY)),
            }}
          />
        )}

        {/* 功能区：全部来自「能力」，随能力内增删自动更新 */}
        <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto no-scrollbar">
          <div>
            <div className="text-[9px] font-black text-blue-400 uppercase">功能区</div>
            <p className="text-[8px] text-gray-500">基础能力与复合能力 · 能力中增删会同步到此</p>
          </div>

          <WorkflowPlannerBar
            actionModules={actionModules}
            selectedAssetId={selectedAssetIds.size > 0 ? [...selectedAssetIds][0]! : null}
            onAddToQueue={(presetId) => {
              const aid = selectedAssetIds.size > 0 ? [...selectedAssetIds][0]! : null;
              if (aid) addToPending(aid, presetId);
            }}
            onLog={onLog}
          />

          <div className="flex flex-col gap-2 rounded-xl border border-[#4570b0] bg-[#121a28] p-3 shadow-[0_0_24px_rgba(37,99,235,0.12)]">
            {pending.length > 0 && !executing && (
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setPending([])}
                  className="px-2.5 py-1 rounded-lg border border-[#3b6fb8] bg-[#1e3558] text-[9px] font-black uppercase text-blue-200 hover:bg-[#264670]"
                >
                  清空队列
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => executePending()}
              disabled={pending.length === 0 || executing}
              className="w-full py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-[12px] font-black uppercase tracking-wide electric-glow disabled:opacity-40 disabled:hover:bg-blue-600 border border-[#60a5fa] shadow-md"
            >
              {executing
                ? `执行中 ${executingQueue?.current ?? 0}/${executingQueue?.total ?? 0}`
                : `一键执行（${pending.length}）`}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverAction('__group__');
            }}
            onDragLeave={() => {
              if (dragOverAction === '__group__') setDragOverAction(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (draggingAssetIds?.length) {
                createGroupFromAssets(draggingAssetIds);
              } else if (draggingGroupItems) {
                const { itemIndexes, groupAssetId } = draggingGroupItems;
                if (itemIndexes.length === 1) {
                  createNestedGroupFromGroupItem(groupAssetId, itemIndexes[0]);
                } else if (itemIndexes.length > 1) {
                  const { nextAssets, assetIds } = ensureGroupItemsAsAssets(assets, groupAssetId, itemIndexes);
                  if (assetIds.length > 0) {
                    const firstAsset = nextAssets.find((a) => a.id === assetIds[0]);
                    const coverImage = firstAsset ? getAssetDisplayImage(firstAsset, nextAssets) : '';
                    const newGroupId = uuid();
                    let updated = nextAssets.map((a) =>
                      assetIds.includes(a.id) ? { ...a, parentAssetId: newGroupId } : a
                    );
                    const groupIdx = updated.findIndex((a) => a.id === groupAssetId);
                    if (groupIdx !== -1) {
                      const g = updated[groupIdx];
                      const items = [...(g.cutImageGroup ?? [])];
                      const sorted = [...itemIndexes]
                        .filter((i) => i >= 0 && i < items.length)
                        .sort((a, b) => a - b);
                      const keep: typeof items = [];
                      items.forEach((it, idx) => {
                        if (!sorted.includes(idx)) keep.push(it);
                      });
                      const insertPos = sorted.length ? sorted[0] : keep.length;
                      const withGroup = [...keep];
                      withGroup.splice(insertPos, 0, { assetId: newGroupId });
                      updated = updated.map((a, idx) =>
                        idx === groupIdx ? { ...a, cutImageGroup: withGroup } : a
                      );
                    }
                    const usedLabels = new Set<string>(
                      updated.map((a) => a.groupLabel).filter((x): x is string => !!x)
                    );
                    const newGroup: WorkflowAsset = attachInitialVgpToNewAsset({
                      id: newGroupId,
                      original: coverImage,
                      displayKey: 'original',
                      results: {},
                      resultOrder: [],
                      cutImageGroup: assetIds.map((id) => ({ assetId: id })),
                      groupKind: 'manual',
                      groupLabel: getRandomGroupCodeName(usedLabels),
                      archived: false,
                      hiddenInGrid: false,
                      createdAt: Date.now(),
                      parentAssetId: groupAssetId,
                    });
                    setAssets([...updated, newGroup]);
                    setSelectedGroupItemKeys(new Set());
                  }
                }
              }
              setDragOverAction(null);
              setDraggingAssetIds(null);
              setDraggingGroupItems(null);
            }}
            className={`rounded-xl border-2 border-dashed p-2.5 min-h-[56px] flex flex-col items-center justify-center text-center transition-colors ${
              dragOverAction === '__group__'
                ? 'border-blue-500 bg-[#152642]'
                : 'border-[#3d4754] bg-[#0e0f12] hover:border-[#4b6a9e] hover:bg-[#1a1d26]'
            }`}
          >
            <span className="text-[9px] font-black uppercase text-gray-200">组</span>
            <span className="text-[8px] text-gray-500 mt-0.5">将选中图片拖入建组（组内同效）</span>
          </div>
          <div
            onDragOver={(e) => {
              if (!viewStack.length || !draggingGroupItems) return;
              e.preventDefault();
              setDragOverAction('__ungroup__');
            }}
            onDragLeave={() => {
              if (dragOverAction === '__ungroup__') setDragOverAction(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragOverAction === '__ungroup__' && draggingGroupItems) {
                const { groupAssetId, itemIndexes } = draggingGroupItems;
                moveGroupItemsToUpperLevel(groupAssetId, itemIndexes);
              }
              setDragOverAction(null);
              setDraggingGroupItems(null);
            }}
            className={`rounded-xl border-2 border-dashed p-2.5 min-h-[56px] flex flex-col items-center justify-center text-center transition-colors ${
              dragOverAction === '__ungroup__'
                ? 'border-blue-500 bg-[#152642]'
                : 'border-[#3d4754] bg-[#0e0f12] hover:border-[#4b6a9e] hover:bg-[#1a1d26]'
            }`}
          >
            <span className="text-[9px] font-black uppercase text-gray-200">移出组</span>
            <span className="text-[8px] text-gray-500 mt-0.5">将组内子卡片拖到此处，移到上一级</span>
          </div>
          <div
            onDragOver={(e) => {
              const fromRoot = draggingAssetIds?.length && !showArchived;
              const fromGroup = !!draggingGroupItems?.itemIndexes?.length && !showArchived;
              if (!fromRoot && !fromGroup) return;
              e.preventDefault();
              setDragOverAction('__copy__');
            }}
            onDragLeave={() => {
              if (dragOverAction === '__copy__') setDragOverAction(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragOverAction !== '__copy__') {
                setDragOverAction(null);
                setDraggingAssetIds(null);
                setDraggingGroupItems(null);
                return;
              }
              if (draggingAssetIds?.length) {
                duplicateAssetInPlace(draggingAssetIds, null);
              } else if (draggingGroupItems && currentGroupAsset) {
                const groupId = currentGroupAsset.id;
                setAssets((prev) => {
                  const { nextAssets, assetIds } = ensureGroupItemsAsAssets(
                    prev,
                    draggingGroupItems.groupAssetId,
                    draggingGroupItems.itemIndexes
                  );
                  if (assetIds.length === 0) return prev;
                  const copies: WorkflowAsset[] = [];
                  const newIds: string[] = [];
                  assetIds.forEach((id) => {
                    const src = nextAssets.find((a) => a.id === id);
                    if (!src) return;
                    const newId = uuid();
                    newIds.push(newId);
                    copies.push({
                      ...src,
                      id: newId,
                      parentAssetId: groupId,
                      archived: false,
                      hiddenInGrid: false,
                      createdAt: Date.now(),
                    });
                  });
                  if (copies.length === 0) return nextAssets;
                  let next = [...nextAssets, ...copies];
                  const gi = next.findIndex((a) => a.id === groupId);
                  if (gi !== -1) {
                    const g = next[gi];
                    const items = [...(g.cutImageGroup ?? []), ...newIds.map((id) => ({ assetId: id }))];
                    next = next.map((a, i) => (i === gi ? { ...a, cutImageGroup: items } : a));
                  }
                  return next;
                });
                setSelectedGroupItemKeys(new Set());
              }
              setDragOverAction(null);
              setDraggingAssetIds(null);
              setDraggingGroupItems(null);
            }}
            className={`rounded-xl border-2 border-dashed p-2.5 min-h-[56px] flex flex-col items-center justify-center text-center transition-colors ${
              dragOverAction === '__copy__'
                ? 'border-blue-500 bg-[#152642]'
                : 'border-[#3d4754] bg-[#0e0f12] hover:border-[#4b6a9e] hover:bg-[#1a1d26]'
            }`}
          >
            <span className="text-[9px] font-black uppercase text-gray-200">复制</span>
            <span className="text-[8px] text-gray-500 mt-0.5">拖入后在当前位置复制一份</span>
          </div>
          <div
            onDragOver={(e) => {
              const fromRoot = draggingAssetIds?.length && !showArchived;
              const fromGroup = !!draggingGroupItems?.itemIndexes?.length && !showArchived;
              if (!fromRoot && !fromGroup) return;
              e.preventDefault();
              setDragOverAction('__delete__');
            }}
            onDragLeave={() => {
              if (dragOverAction === '__delete__') setDragOverAction(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragOverAction !== '__delete__') {
                setDragOverAction(null);
                setDraggingAssetIds(null);
                setDraggingGroupItems(null);
                return;
              }
              if (draggingAssetIds?.length) {
                draggingAssetIds.forEach((id) => removeAsset(id));
              } else if (draggingGroupItems) {
                const { nextAssets, assetIds } = ensureGroupItemsAsAssets(
                  assets,
                  draggingGroupItems.groupAssetId,
                  draggingGroupItems.itemIndexes
                );
                if (assetIds.length > 0) {
                  const afterRemove = removeGroupItems(
                    nextAssets,
                    draggingGroupItems.groupAssetId,
                    draggingGroupItems.itemIndexes
                  );
                  const groupRemoved = !afterRemove.some((a) => a.id === draggingGroupItems.groupAssetId);
                  setAssets(afterRemove);
                  assetIds.forEach((id) => removeAsset(id));
                  setSelectedGroupItemKeys(new Set());
                  if (groupRemoved) {
                    setViewStack((s) => s.filter((x) => x.assetId !== draggingGroupItems.groupAssetId));
                  }
                }
              }
              setDragOverAction(null);
              setDraggingAssetIds(null);
              setDraggingGroupItems(null);
            }}
            className={`rounded-xl border-2 border-dashed p-2.5 min-h-[56px] flex flex-col items-center justify-center text-center transition-colors ${
              dragOverAction === '__delete__'
                ? 'border-red-500 bg-[#3a1818]'
                : 'border-[#3d4754] bg-[#0e0f12] hover:border-[#b85454] hover:bg-[#1f1416]'
            }`}
          >
            <span className="text-[9px] font-black uppercase text-red-400">删除</span>
            <span className="text-[8px] text-gray-500 mt-0.5">将图片拖到此处从工作流中删除（组内同效）</span>
          </div>
          <div
            onDragOver={(e) => {
              const fromRoot = draggingAssetIds?.length && !showArchived;
              const fromGroup = !!draggingGroupItems?.itemIndexes?.length && !showArchived;
              if (!fromRoot && !fromGroup) return;
              e.preventDefault();
              setDragOverAction('__archive__');
            }}
            onDragLeave={() => {
              if (dragOverAction === '__archive__') setDragOverAction(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragOverAction !== '__archive__') {
                setDragOverAction(null);
                setDraggingAssetIds(null);
                setDraggingGroupItems(null);
                return;
              }
              if (draggingAssetIds?.length) {
                draggingAssetIds.forEach((id) => markArchived(id));
              } else if (draggingGroupItems) {
                const { nextAssets, assetIds } = ensureGroupItemsAsAssets(
                  assets,
                  draggingGroupItems.groupAssetId,
                  draggingGroupItems.itemIndexes
                );
                if (assetIds.length > 0) {
                  const afterRemove = removeGroupItems(
                    nextAssets,
                    draggingGroupItems.groupAssetId,
                    draggingGroupItems.itemIndexes
                  );
                  const groupRemoved = !afterRemove.some((a) => a.id === draggingGroupItems.groupAssetId);
                  setAssets(afterRemove);
                  assetIds.forEach((id) => markArchived(id));
                  setSelectedGroupItemKeys(new Set());
                  if (groupRemoved) {
                    setViewStack((s) => s.filter((x) => x.assetId !== draggingGroupItems.groupAssetId));
                  }
                }
              }
              setDragOverAction(null);
              setDraggingAssetIds(null);
              setDraggingGroupItems(null);
            }}
            className={`rounded-xl border-2 border-dashed p-2.5 min-h-[56px] flex flex-col items-center justify-center text-center transition-colors col-span-2 ${
              dragOverAction === '__archive__'
                ? 'border-blue-500 bg-[#152642]'
                : 'border-[#3d4754] bg-[#0e0f12] hover:border-[#4b6a9e] hover:bg-[#1a1d26]'
            }`}
          >
            <span className="text-[9px] font-black uppercase text-gray-200">归档</span>
            <span className="text-[8px] text-gray-500 mt-0.5">将图片拖到此处标记为已完成（组内同效）</span>
          </div>
          </div>
          {visiblePresets.length === 0 && visibleCapabilitySets.length === 0 && favoriteEntries.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#3a3a40] p-4 text-center text-[9px] text-gray-500">
              暂无能力预设，请先在「能力」界面添加
            </div>
          )}
          {favoriteEntries.length > 0 || visiblePresets.length > 0 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-[#2e2e32] bg-[#16161a] px-2.5 py-1.5">
                  <span className="text-[8px] font-black text-blue-300 uppercase tracking-wide">常用功能</span>
                  <span className="text-[8px] text-gray-500">拖入收藏</span>
                </div>
                <div
                  onDropCapture={() => {
                    if (draggingActionId) setActionDroppedInFavorite(true);
                  }}
                  onDragOver={(e) => {
                    if (!draggingActionId) return;
                    e.preventDefault();
                    setFavoriteDropActive(true);
                  }}
                  onDragLeave={() => setFavoriteDropActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setFavoriteDropActive(false);
                    if (!draggingActionId) return;
                    setFavoriteActionIds((prev) => (prev.includes(draggingActionId) ? prev : [...prev, draggingActionId]));
                    setActionDroppedInFavorite(true);
                  }}
                  className="space-y-2"
                >
                  {favoriteEntries.length === 0 ? (
                    <div className={`text-[8px] text-center py-2 ${favoriteDropActive ? 'text-blue-300' : 'text-gray-500'}`}>
                      把功能块拖到这里，作为常用功能
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {favoriteEntries.map((entry) => (
                        <div
                          key={`fav-${entry.id}`}
                          className={`rounded-xl border-2 border-dashed min-h-[60px] flex transition-colors ${
                            dragOverAction === entry.id
                              ? 'border-blue-500 bg-[#1a3354]'
                              : dragOverAction === entry.id + '__tweak'
                                ? 'border-[#4b6a9e] bg-[#1e3558] ring-1 ring-[#3b82f6]'
                                : 'border-[#3a3a40] bg-[#1c1c22] hover:border-[#484850]'
                          }`}
                          draggable
                          onDragStart={() => {
                            setDraggingActionId(entry.id);
                            setDraggingActionFromFavorite(true);
                            setActionDroppedInFavorite(false);
                          }}
                          onDragEnd={() => {
                            if (draggingActionFromFavorite && !actionDroppedInFavorite) {
                              removeActionFromFavorite(entry.id);
                            }
                            setDraggingActionId(null);
                            setDraggingActionFromFavorite(false);
                            setActionDroppedInFavorite(false);
                            setFavoriteDropActive(false);
                          }}
                        >
                          <div
                            className={`flex-1 p-3 flex flex-col items-center justify-center text-center min-w-0 transition-colors ${
                              entry.kind === 'module' && entry.mod?.category === 'image_gen' ? 'border-r border-[#2e2e32]' : ''
                            } ${
                              dragOverAction === entry.id + '__tweak'
                                ? 'bg-[#121214]'
                                : dragOverAction === entry.id
                                  ? 'bg-[#1a3354]'
                                  : ''
                            }`}
                            onDragOver={(e) => {
                              e.preventDefault();
                              setDragOverAction(entry.id);
                            }}
                            onDragLeave={() => setDragOverAction(null)}
                            onDrop={(e) => {
                              e.preventDefault();
                              setDragOverAction(null);
                              if (entry.kind === 'set') {
                                handleDropToSetAction(entry.id);
                              } else if (entry.mod) {
                                handleDropToModuleAction(entry.mod, false);
                              }
                            }}
                          >
                            <span className="text-[9px] font-black uppercase">{entry.label}</span>
                          </div>
                          {entry.kind === 'module' && entry.mod?.category === 'image_gen' && (
                            <div
                              className={`w-11 shrink-0 flex flex-col items-center justify-center rounded-r-lg transition-colors cursor-default ${
                                dragOverAction === entry.id + '__tweak'
                                  ? 'bg-[#223d5c] border-l border-[#5080c0]'
                                  : 'bg-[#1c1c22] border-l border-[#2e2e32] hover:bg-[#2e2e36]'
                              }`}
                              title="拖到此处可微调提示词后加入队列"
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDragOverAction(entry.id + '__tweak');
                              }}
                              onDragLeave={() => setDragOverAction(null)}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDragOverAction(null);
                                if (entry.mod) handleDropToModuleAction(entry.mod, true);
                              }}
                            >
                              <span className="text-[10px] text-blue-400 font-bold" title="微调提示词">调</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
          {visiblePresets.length > 0 && (
            <div className="space-y-4">
              {visibleByCategory.length > 0 ? (
                <>
              {visibleByCategory.map(({ category, list }) => (
                <div key={category.id}>
                  <button
                    type="button"
                    onClick={() => toggleSectionCollapsed(`cat:${category.id}`)}
                    className="w-full text-left mb-1.5 flex items-center justify-between rounded-lg border border-[#2e2e32] bg-[#121214] px-2.5 py-1.5 text-[8px] font-black uppercase tracking-wide text-gray-400 hover:bg-[#18181c] hover:text-gray-200 transition-colors"
                  >
                    <span>{category.label}</span>
                    <span className="text-[10px] text-gray-500">{collapsedSectionIds[`cat:${category.id}`] ? '▼' : '▲'}</span>
                  </button>
                  {!collapsedSectionIds[`cat:${category.id}`] && (
                  <div className="grid grid-cols-2 gap-2">
                    {list.map((mod) => (
                      <div
                        key={mod.id}
                        className={`rounded-xl border-2 border-dashed min-h-[60px] flex transition-colors ${
                          dragOverAction === mod.id
                            ? 'border-blue-500 bg-[#1a3354]'
                            : dragOverAction === mod.id + '__tweak'
                              ? 'border-[#4b6a9e] bg-[#1e3558] ring-1 ring-[#3b82f6]'
                              : 'border-[#3a3a40] bg-[#1c1c22] hover:border-[#484850]'
                        }`}
                        draggable
                        onDragStart={() => {
                          setDraggingActionId(mod.id);
                          setDraggingActionFromFavorite(false);
                          setActionDroppedInFavorite(false);
                        }}
                        onDragEnd={() => {
                          setDraggingActionId(null);
                          setDraggingActionFromFavorite(false);
                          setActionDroppedInFavorite(false);
                          setFavoriteDropActive(false);
                        }}
                      >
                        <div
                          className={`flex-1 p-3 flex flex-col items-center justify-center text-center min-w-0 transition-colors ${
                            mod.category === 'image_gen' ? 'border-r border-[#2e2e32]' : ''
                          } ${
                            dragOverAction === mod.id + '__tweak'
                              ? 'bg-[#121214]'
                              : dragOverAction === mod.id
                                ? 'bg-[#1a3354]'
                                : ''
                          }`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setDragOverAction(mod.id);
                          }}
                          onDragLeave={() => setDragOverAction(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragOverAction(null);
                            if (draggingAssetIds?.length) {
                              const effectiveIds = getEffectiveAssetIdsForAction(draggingAssetIds);
                              if (mod.category === 'generate_3d' && onAddGenerate3DJob && draggingAssetId) {
                                const a = assets.find((x) => x.id === draggingAssetId);
                                const img = a ? getAssetDisplayImage(a) : null;
                                if (img) onAddGenerate3DJob(mod, img);
                                return;
                              }
                              effectiveIds.forEach((id) => addToPending(id, mod.id));
                              return;
                            }
                            if (draggingGroupItems && currentGroupAsset) {
                              if (mod.category === 'generate_3d' && onAddGenerate3DJob) {
                                const firstIndex = draggingGroupItems.itemIndexes[0];
                                const item = currentGroupItems[firstIndex];
                                let img: string | null = null;
                                if (typeof item === 'string') img = item;
                                else {
                                  const child = assets.find((x) => x.id === item.assetId);
                                  if (child) img = getAssetDisplayImage(child);
                                }
                                if (img) onAddGenerate3DJob(mod, img);
                                return;
                              }
                              draggingGroupItems.itemIndexes.forEach((itemIndex) => {
                                const item = currentGroupItems[itemIndex];
                                if (!item) return;
                                if (typeof item === 'string') {
                                  addImageToPending(item, mod.id, {
                                    parentAssetId: currentGroupAsset.id,
                                    sourceGroupAssetId: currentGroupAsset.id,
                                    sourceItemIndex: itemIndex,
                                  });
                                } else {
                                  const child = assets.find((x) => x.id === (item as { assetId: string }).assetId);
                                  const inputImage = child ? getAssetDisplayImage(child) : '';
                                  setPending((prev) => [
                                    ...prev,
                                    {
                                      id: uuid(),
                                      assetId: (item as { assetId: string }).assetId,
                                      actionType: mod.id,
                                      inputImage,
                                      addedAt: Date.now(),
                                      inputSourceDisplayKey: child?.displayKey,
                                      sourceGroupAssetId: currentGroupAsset.id,
                                      sourceItemIndex: itemIndex,
                                    },
                                  ]);
                                }
                              });
                            }
                          }}
                        >
                          <span className="text-[9px] font-black uppercase">{mod.label}</span>
                        </div>
                        {mod.category === 'image_gen' && (
                          <div
                            className={`w-11 shrink-0 flex flex-col items-center justify-center rounded-r-lg transition-colors cursor-default ${
                              dragOverAction === mod.id + '__tweak'
                                ? 'bg-[#223d5c] border-l border-[#5080c0]'
                                : 'bg-[#1c1c22] border-l border-[#2e2e32] hover:bg-[#2e2e36]'
                            }`}
                            title="拖到此处可微调提示词后加入队列"
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDragOverAction(mod.id + '__tweak');
                            }}
                            onDragLeave={() => setDragOverAction(null)}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDragOverAction(null);
                              const targets: Array<
                                | {
                                    assetId: string;
                                    inputImage: string;
                                    inputSourceDisplayKey?: string;
                                    sourceGroupAssetId?: string;
                                    sourceItemIndex?: number;
                                  }
                                | { imageBase64: string; parentAssetId: string; sourceGroupAssetId: string; sourceItemIndex: number }
                              > = [];
                              if (draggingAssetIds?.length) {
                                const effectiveIds = getEffectiveAssetIdsForAction(draggingAssetIds);
                                effectiveIds.forEach((id) => {
                                  const a = assets.find((x) => x.id === id);
                                  if (a)
                                    targets.push({
                                      assetId: id,
                                      inputImage: getAssetDisplayImage(a),
                                      inputSourceDisplayKey: a.displayKey,
                                    });
                                });
                              } else if (draggingGroupItems && currentGroupAsset) {
                                draggingGroupItems.itemIndexes.forEach((itemIndex) => {
                                  const item = currentGroupItems[itemIndex];
                                  if (!item) return;
                                  if (typeof item === 'string') {
                                    targets.push({
                                      imageBase64: item,
                                      parentAssetId: currentGroupAsset.id,
                                      sourceGroupAssetId: currentGroupAsset.id,
                                      sourceItemIndex: itemIndex,
                                    });
                                  } else {
                                    const child = assets.find((x) => x.id === (item as { assetId: string }).assetId);
                                    if (child)
                                      targets.push({
                                        assetId: (item as { assetId: string }).assetId,
                                        inputImage: getAssetDisplayImage(child),
                                        inputSourceDisplayKey: child.displayKey,
                                        sourceGroupAssetId: currentGroupAsset.id,
                                        sourceItemIndex: itemIndex,
                                      });
                                  }
                                });
                              }
                              if (targets.length > 0) setPromptTweakModal({ preset: mod, targets });
                            }}
                          >
                            <span className="text-[10px] text-blue-400 font-bold" title="微调提示词">调</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  )}
                </div>
              ))}
                </>
              ) : (
            <div>
              <button
                type="button"
                onClick={() => toggleSectionCollapsed('__all_presets__')}
                className="w-full text-left mb-1.5 flex items-center justify-between rounded-lg border border-[#2e2e32] bg-[#121214] px-2.5 py-1.5 text-[8px] font-black uppercase tracking-wide text-gray-400 hover:bg-[#18181c] hover:text-gray-200 transition-colors"
              >
                <span>功能</span>
                <span className="text-[10px] text-gray-500">{collapsedSectionIds.__all_presets__ ? '▼' : '▲'}</span>
              </button>
              {!collapsedSectionIds.__all_presets__ && (
            <div className="grid grid-cols-2 gap-2">
              {visiblePresets.map((mod) => (
                <div
                  key={mod.id}
                  className={`rounded-xl border-2 border-dashed min-h-[60px] flex transition-colors ${
                    dragOverAction === mod.id
                      ? 'border-blue-500 bg-[#1a3354]'
                      : dragOverAction === mod.id + '__tweak'
                        ? 'border-[#4b6a9e] bg-[#1e3558] ring-1 ring-[#3b82f6]'
                        : 'border-[#3a3a40] bg-[#1c1c22] hover:border-[#484850]'
                  }`}
                  draggable
                  onDragStart={() => {
                    setDraggingActionId(mod.id);
                    setDraggingActionFromFavorite(false);
                    setActionDroppedInFavorite(false);
                  }}
                  onDragEnd={() => {
                    setDraggingActionId(null);
                    setDraggingActionFromFavorite(false);
                    setActionDroppedInFavorite(false);
                    setFavoriteDropActive(false);
                  }}
                >
                  <div
                    className={`flex-1 p-3 flex flex-col items-center justify-center text-center min-w-0 transition-colors ${
                      mod.category === 'image_gen' ? 'border-r border-[#2e2e32]' : ''
                    } ${
                      dragOverAction === mod.id + '__tweak'
                        ? 'bg-[#121214]'
                        : dragOverAction === mod.id
                          ? 'bg-[#1a3354]'
                          : ''
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverAction(mod.id);
                    }}
                    onDragLeave={() => setDragOverAction(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverAction(null);
                      if (draggingAssetIds?.length) {
                        const effectiveIds = getEffectiveAssetIdsForAction(draggingAssetIds);
                        if (mod.category === 'generate_3d' && onAddGenerate3DJob && draggingAssetId) {
                          const a = assets.find((x) => x.id === draggingAssetId);
                          const img = a ? getAssetDisplayImage(a) : null;
                          if (img) onAddGenerate3DJob(mod, img);
                          return;
                        }
                        effectiveIds.forEach((id) => addToPending(id, mod.id));
                        return;
                      }
                      if (draggingGroupItems && currentGroupAsset) {
                        if (mod.category === 'generate_3d' && onAddGenerate3DJob) {
                          const firstIndex = draggingGroupItems.itemIndexes[0];
                          const item = currentGroupItems[firstIndex];
                          let img: string | null = null;
                          if (typeof item === 'string') img = item;
                          else {
                            const child = assets.find((x) => x.id === item.assetId);
                            if (child) img = getAssetDisplayImage(child);
                          }
                          if (img) onAddGenerate3DJob(mod, img);
                          return;
                        }
                        draggingGroupItems.itemIndexes.forEach((itemIndex) => {
                          const item = currentGroupItems[itemIndex];
                          if (!item) return;
                          if (typeof item === 'string') {
                            addImageToPending(item, mod.id, {
                              parentAssetId: currentGroupAsset.id,
                              sourceGroupAssetId: currentGroupAsset.id,
                              sourceItemIndex: itemIndex,
                            });
                          } else {
                            const child = assets.find((x) => x.id === (item as { assetId: string }).assetId);
                            const inputImage = child ? getAssetDisplayImage(child) : '';
                            setPending((prev) => [
                              ...prev,
                              {
                                id: uuid(),
                                assetId: (item as { assetId: string }).assetId,
                                actionType: mod.id,
                                inputImage,
                                addedAt: Date.now(),
                                inputSourceDisplayKey: child?.displayKey,
                                sourceGroupAssetId: currentGroupAsset.id,
                                sourceItemIndex: itemIndex,
                              },
                            ]);
                          }
                        });
                      }
                    }}
                  >
                    <span className="text-[9px] font-black uppercase">{mod.label}</span>
                  </div>
                  {mod.category === 'image_gen' && (
                    <div
                      className={`w-11 shrink-0 flex flex-col items-center justify-center rounded-r-lg transition-colors cursor-default ${
                        dragOverAction === mod.id + '__tweak'
                          ? 'bg-[#223d5c] border-l border-[#5080c0]'
                          : 'bg-[#1c1c22] border-l border-[#2e2e32] hover:bg-[#2e2e36]'
                      }`}
                      title="拖到此处可微调提示词后加入队列"
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOverAction(mod.id + '__tweak');
                      }}
                      onDragLeave={() => setDragOverAction(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOverAction(null);
                        const targets: Array<
                          | {
                              assetId: string;
                              inputImage: string;
                              inputSourceDisplayKey?: string;
                              sourceGroupAssetId?: string;
                              sourceItemIndex?: number;
                            }
                          | { imageBase64: string; parentAssetId: string; sourceGroupAssetId: string; sourceItemIndex: number }
                        > = [];
                        if (draggingAssetIds?.length) {
                          const effectiveIds = getEffectiveAssetIdsForAction(draggingAssetIds);
                          effectiveIds.forEach((id) => {
                            const a = assets.find((x) => x.id === id);
                            if (a)
                              targets.push({
                                assetId: id,
                                inputImage: getAssetDisplayImage(a),
                                inputSourceDisplayKey: a.displayKey,
                              });
                          });
                        } else if (draggingGroupItems && currentGroupAsset) {
                          draggingGroupItems.itemIndexes.forEach((itemIndex) => {
                            const item = currentGroupItems[itemIndex];
                            if (!item) return;
                            if (typeof item === 'string') {
                              targets.push({
                                imageBase64: item,
                                parentAssetId: currentGroupAsset.id,
                                sourceGroupAssetId: currentGroupAsset.id,
                                sourceItemIndex: itemIndex,
                              });
                            } else {
                              const child = assets.find((x) => x.id === (item as { assetId: string }).assetId);
                              if (child)
                                targets.push({
                                  assetId: (item as { assetId: string }).assetId,
                                  inputImage: getAssetDisplayImage(child),
                                  inputSourceDisplayKey: child.displayKey,
                                  sourceGroupAssetId: currentGroupAsset.id,
                                  sourceItemIndex: itemIndex,
                                });
                            }
                          });
                        }
                        if (targets.length > 0) setPromptTweakModal({ preset: mod, targets });
                      }}
                    >
                      <span className="text-[10px] text-blue-400 font-bold" title="微调提示词">调</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
              )}
            </div>
              )}
            </div>
          )}
            </div>
          ) : null}

          {visibleCapabilitySets.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => toggleSectionCollapsed('__capability_sets__')}
                className="w-full text-left mb-1.5 flex items-center justify-between rounded-lg border border-[#2e2e32] bg-[#121214] px-2.5 py-1.5 text-[8px] font-black uppercase tracking-wide text-gray-400 hover:bg-[#18181c] hover:text-gray-200 transition-colors"
              >
                <span>复合能力</span>
                <span className="text-[10px] text-gray-500">{collapsedSectionIds.__capability_sets__ ? '▼' : '▲'}</span>
              </button>
              {!collapsedSectionIds.__capability_sets__ && (
              <div className="grid grid-cols-2 gap-2">
                {visibleCapabilitySets.map((set) => {
                  const setActionId = SET_ACTION_PREFIX + set.id;
                  return (
                    <div
                      key={set.id}
                      draggable
                      onDragStart={() => {
                        setDraggingActionId(setActionId);
                        setDraggingActionFromFavorite(false);
                        setActionDroppedInFavorite(false);
                      }}
                      onDragEnd={() => {
                        setDraggingActionId(null);
                        setDraggingActionFromFavorite(false);
                        setActionDroppedInFavorite(false);
                        setFavoriteDropActive(false);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverAction(setActionId);
                      }}
                      onDragLeave={() => setDragOverAction(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverAction(null);

                        if (draggingAssetIds?.length) {
                          const effectiveIds = getEffectiveAssetIdsForAction(draggingAssetIds);
                          effectiveIds.forEach((id) => addToPending(id, setActionId));
                          return;
                        }

                        if (draggingGroupItems && currentGroupAsset) {
                          draggingGroupItems.itemIndexes.forEach((itemIndex) => {
                            const item = currentGroupItems[itemIndex];
                            if (!item) return;
                            if (typeof item === 'string') {
                              addImageToPending(item, setActionId, {
                                parentAssetId: currentGroupAsset.id,
                                sourceGroupAssetId: currentGroupAsset.id,
                                sourceItemIndex: itemIndex,
                              });
                            } else {
                              const child = assets.find((x) => x.id === (item as { assetId: string }).assetId);
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
                                  sourceGroupAssetId: currentGroupAsset.id,
                                  sourceItemIndex: itemIndex,
                                },
                              ]);
                            }
                          });
                        }
                      }}
                      className={`rounded-xl border-2 border-dashed p-2.5 min-h-[60px] flex flex-col items-center justify-center text-center transition-colors ${
                        dragOverAction === setActionId
                          ? 'border-blue-500 bg-[#1a3354]'
                          : 'border-[#3a3a40] bg-[#1c1c22] hover:border-[#484850]'
                      }`}
                    >
                      <span className="text-[9px] font-black uppercase text-gray-200">{set.label}</span>
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* 进行中：大图弹窗 */}
      {lightboxAsset && !showArchived && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/78 backdrop-blur-sm p-4" onClick={() => setLightboxAssetId(null)}>
          <div
            className="relative max-w-4xl w-full"
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (getDisplayKeysForAsset(lightboxAsset).length <= 1) return;
              cycleDisplayKey(lightboxAsset.id, e.deltaY);
            }}
          >
            <button onClick={() => setLightboxAssetId(null)} className="absolute -top-12 right-0 w-10 h-10 flex items-center justify-center text-white/60 hover:text-white"><AppIcon name="close" className="w-4 h-4" /></button>
            <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 sm:p-5">
              <img
                src={workflowSafeImgSrc(getAssetDisplayImage(lightboxAsset))}
                alt=""
                className="w-full max-h-[80vh] object-contain rounded-xl bg-[#16161a]"
              />
            <div className="mt-3 flex flex-wrap gap-1.5 justify-center items-center">
              <span className="text-[8px] font-black text-gray-500 uppercase mr-1">显示</span>
              <button
                onClick={() => setDisplayKey(lightboxAsset.id, 'original')}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${lightboxAsset.displayKey === 'original' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#26262c] border-[#3a3a40] hover:bg-[#383842]'}`}
              >
                原始
              </button>
              {lightboxAsset.cutImageGroup?.length && (
                <button
                  onClick={() => setDisplayKey(lightboxAsset.id, 'cut_image')}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${lightboxAsset.displayKey === 'cut_image' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#26262c] border-[#3a3a40] hover:bg-[#383842]'}`}
                >
                  切割
                </button>
              )}
              {(lightboxAsset.resultOrder || []).map((k) => {
                if (baseActionId(k) === 'cut_image') return null;
                const mod = getModule(baseActionId(k));
                const label = mod?.label ?? baseActionId(k);
                if (!lightboxAsset.results?.[k]) return null;
                return (
                  <button
                    key={k}
                    onClick={() => setDisplayKey(lightboxAsset.id, k)}
                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${lightboxAsset.displayKey === k ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#26262c] border-[#3a3a40] hover:bg-[#383842]'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 justify-center">
              <button
                type="button"
                onClick={() => {
                  void triggerImageDownload(
                    getAssetDisplayImage(lightboxAsset),
                    `workflow-preview-${lightboxAsset.id.slice(0, 6)}`
                  );
                }}
                className="px-4 py-2 rounded-xl bg-[#1e40af] border border-[#3b6fb8] text-[10px] font-black uppercase hover:bg-blue-500"
              >
                下载当前大图
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowLightboxGenerationRecord(true);
                }}
                className="px-4 py-2 rounded-xl bg-[#26262c] border border-emerald-500/40 text-[10px] font-black uppercase text-emerald-200/90 hover:bg-emerald-900/30"
              >
                生成记录
              </button>
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
                  className="px-4 py-2 rounded-xl bg-[#26262c] border border-[#3a3a40] text-[10px] font-black uppercase hover:bg-[#305a90] hover:border-[#3b82f6]"
                >
                  {mod.label}
                </button>
              ))}
            </div>
            {lightboxList.length > 1 && (
              <div className="flex justify-center gap-2 mt-2">
                <button onClick={() => goLightbox(-1)} className="px-3 py-1 rounded-lg bg-[#26262c] text-[9px] font-black">上一张</button>
                <span className="text-[9px] text-gray-500 self-center">{lightboxIndex + 1} / {lightboxList.length}</span>
                <button onClick={() => goLightbox(1)} className="px-3 py-1 rounded-lg bg-[#26262c] text-[9px] font-black">下一张</button>
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {showLightboxGenerationRecord && lightboxAsset ? (
        <WorkflowGenerationRecordPanel
          asset={lightboxAsset}
          getStepLabel={getGenerationRecordStepLabel}
          onClose={() => setShowLightboxGenerationRecord(false)}
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
      {promptTweakModal && (
        <PromptTweakModal
          preset={promptTweakModal.preset}
          targets={promptTweakModal.targets}
          onConfirm={(editedPrompt) => {
            const trimmed = editedPrompt.trim();
            const tasks: WorkflowPendingTask[] = [];
            for (const t of promptTweakModal.targets) {
              if ('assetId' in t) {
                tasks.push({
                  id: uuid(),
                  assetId: t.assetId,
                  actionType: promptTweakModal.preset.id,
                  inputImage: t.inputImage,
                  addedAt: Date.now(),
                  ...(t.inputSourceDisplayKey != null ? { inputSourceDisplayKey: t.inputSourceDisplayKey } : {}),
                  ...(trimmed ? { promptOverride: trimmed } : {}),
                  ...(t.sourceGroupAssetId != null ? { sourceGroupAssetId: t.sourceGroupAssetId, sourceItemIndex: t.sourceItemIndex } : {}),
                });
              } else {
                addImageToPending(t.imageBase64, promptTweakModal.preset.id, {
                  parentAssetId: t.parentAssetId,
                  sourceGroupAssetId: t.sourceGroupAssetId,
                  sourceItemIndex: t.sourceItemIndex,
                  ...(trimmed ? { promptOverride: trimmed } : {}),
                });
              }
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
  );
};

export default WorkflowSection;
