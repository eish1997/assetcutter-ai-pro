import React, { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect, startTransition } from 'react';
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
import { WorkflowGenerationRecordPanel } from './WorkflowGenerationRecordPanel';
import { WorkflowPlannerBar } from './WorkflowPlannerBar';
import { triggerImageDownload } from '../services/imageDataUrl';
import AppIcon from './ui/AppIcon';
import { ImagePreviewOverlay } from './ImagePreviewOverlay';
import { resolveCapabilityPreviewSrc } from '../services/capabilityPreviewUrl';
import { CapabilityPreviewImg } from './CapabilityPreviewImg';
import { WorkflowCapabilityHoverPreview } from './WorkflowCapabilityHoverPreview';
import { ProgressivePreviewImage, WorkflowGridImage } from './ProgressivePreviewImage';
import { workflowSafeImgSrc, WORKFLOW_IMG_EMPTY_PLACEHOLDER } from '../services/workflowImageDisplay';

/** 持久化数据异常时可能混入 non string，避免把对象传给 img src 触发 React 抛错 */
const asWorkflowImageString = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 大纲底部拖放：仓库条目 / 工作区导出（与 onDragStart setData 一致） */
const DT_AC_LIBRARY_ITEM_ID = 'application/x-ac-library-item-id';
const DT_AC_WORKFLOW_EXPORT = 'application/x-ac-workflow-export';
const WORKFLOW_FIRST_SWEEP_DONE_KEY = 'ac_workflow_first_sweep_done_v1';

type AcWorkflowExportPayload =
  | { mode: 'roots'; assetIds: string[] }
  | { mode: 'groupItems'; items: Array<{ parentId: string; index: number }> };

function buildLibraryItemsFromWorkflowExport(
  assets: WorkflowAsset[],
  showArchived: boolean,
  getDisplay: (a: WorkflowAsset) => string,
  payload: AcWorkflowExportPayload
): Partial<LibraryItem>[] {
  const items: Partial<LibraryItem>[] = [];
  if (payload.mode === 'roots') {
    const seen = new Set<string>();
    for (const id of payload.assetIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const a = assets.find((x) => x.id === id);
      if (!a || a.archived !== showArchived || a.parentAssetId) continue;
      const data = getDisplay(a);
      if (!data || data === WORKFLOW_IMG_EMPTY_PLACEHOLDER) continue;
      items.push({
        data,
        label: (a.groupLabel && a.groupLabel.trim()) || `工作区-${id.slice(0, 8)}`,
        type: 'SLICE',
        category: 'PREVIEW_STRIP',
      });
    }
  } else {
    for (const { parentId, index: idx } of payload.items) {
      const parent = assets.find((x) => x.id === parentId);
      const raw = parent?.cutImageGroup?.[idx];
      if (raw == null) continue;
      let data: string | null = null;
      if (typeof raw === 'string') data = raw;
      else if (raw && typeof raw === 'object' && 'assetId' in raw) {
        const ch = assets.find((x) => x.id === (raw as { assetId: string }).assetId);
        data = ch ? getDisplay(ch) : null;
      } else if (raw && typeof raw === 'object' && 'r2Key' in raw) {
        data = asWorkflowImageString(parent?.original);
      }
      if (!data || data === WORKFLOW_IMG_EMPTY_PLACEHOLDER) continue;
      items.push({
        data,
        label: `${parent?.groupLabel || '组'} · 子项 ${idx + 1}`,
        type: 'SLICE',
        category: 'PREVIEW_STRIP',
      });
    }
  }
  return items;
}

function safeUnknownToString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.message;
  try {
    return String(v);
  } catch {
    return '[无法序列化的错误]';
  }
}

function sanitizeDroppedUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const u = new URL(text);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function collectImageLikeUrlsFromText(raw: string): string[] {
  if (!raw) return [];
  const urls = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map(sanitizeDroppedUrl)
    .filter((v): v is string => !!v);
  return Array.from(new Set(urls));
}

function collectImageLikeUrlsFromHtml(rawHtml: string): string[] {
  if (!rawHtml) return [];
  try {
    const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
    const urls = new Set<string>();
    doc.querySelectorAll('img[src]').forEach((img) => {
      const src = sanitizeDroppedUrl(img.getAttribute('src') || '');
      if (src) urls.add(src);
    });
    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = sanitizeDroppedUrl(a.getAttribute('href') || '');
      if (href && /\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i.test(href)) urls.add(href);
    });
    return Array.from(urls);
  } catch {
    return [];
  }
}

function dataTransferItemToString(item: DataTransferItem): Promise<string> {
  return new Promise((resolve) => {
    try {
      item.getAsString((s) => resolve(s || ''));
    } catch {
      resolve('');
    }
  });
}

/** 常用功能区 dragOver 兜底：首轮 dragover 可能早于 ref 同步，但 setData 后 types 已有 text/plain */
function dragTransferHasPlainText(e: React.DragEvent): boolean {
  try {
    const t = e.dataTransfer?.types;
    if (!t) return false;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === 'text/plain') return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** App 传入的 capabilityPresetPanel 常包在 Suspense 外；cloneElement 需把 scrollContainerRef 传到内层 CapabilityPresetSection */
function cloneCapabilityPresetPanelWithScrollRef(
  panel: React.ReactNode,
  scrollRef: React.RefObject<HTMLDivElement | null>
): React.ReactNode {
  if (!React.isValidElement(panel)) return panel;
  if (panel.type === React.Suspense) {
    const inner = panel.props.children;
    if (React.isValidElement(inner)) {
      return React.cloneElement(panel, {
        children: React.cloneElement(inner as React.ReactElement<{ scrollContainerRef?: React.Ref<HTMLDivElement> }>, {
          scrollContainerRef: scrollRef,
        }),
      });
    }
  }
  return React.cloneElement(panel as React.ReactElement<{ scrollContainerRef?: React.Ref<HTMLDivElement> }>, {
    scrollContainerRef: scrollRef,
  });
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
          {/* 选区与 SVG 叠加依赖原图像素比例，此处必须全分辨率，不能用缩略图 */}
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
                  <ProgressivePreviewImage
                    fullSrc={img}
                    cacheKey={`arch-cut:${asset.id}:${idx}`}
                    thumbMaxEdge={240}
                    className="relative w-full h-20"
                    imgClassName="w-full h-20 object-cover block"
                  />
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
              <ProgressivePreviewImage
                fullSrc={s.image}
                cacheKey={`arch-step:${asset.id}:${i}:${s.label}`}
                thumbMaxEdge={480}
                className="relative w-full min-h-[120px] max-h-[320px]"
                imgClassName="w-full max-h-[320px] object-contain bg-[#16161a]"
                alt={s.label}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span className="text-[9px] text-gray-500">拼合后的流程图（按生成顺序）</span>
          {compositeUrl && (
            <>
              <ProgressivePreviewImage
                fullSrc={compositeUrl}
                cacheKey={`arch-composite:${asset.id}`}
                thumbMaxEdge={360}
                className="relative inline-block max-h-48 max-w-full"
                imgClassName="max-h-48 rounded-lg border border-[#2e2e32] object-contain"
                alt="流程图"
              />
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
const SECTION_HEADER_CLASS = 'rounded-lg px-3 py-2';
const SECTION_TITLE_CLASS = 'text-[9px] font-black text-blue-400 uppercase tracking-wide';
const SECTION_DESC_CLASS = 'text-[8px] text-gray-500 mt-0.5';
const SECTION_HEADER_BOTTOM_GAP_CLASS = 'mb-3';
const TITLE_ROW_BTN_BASE =
  'h-8 px-3 inline-flex items-center justify-center rounded-lg text-[9px] font-black uppercase border transition-colors';
const TITLE_ROW_BTN_NEUTRAL = `${TITLE_ROW_BTN_BASE} bg-[#1c1c22] border-[#2e2e32] text-gray-300 hover:bg-[#2e2e36]`;
const TITLE_ROW_BTN_ACTIVE = `${TITLE_ROW_BTN_BASE} bg-blue-600 border-blue-500 text-white`;
const WORKSPACE_SNAP_DURATION_MS = 260;
// y2 > 1 形成轻微回弹，避免左右切页“硬切”。
const WORKSPACE_SNAP_EASING = 'cubic-bezier(0.22, 1.12, 0.36, 1)';

/** 根级网格 / 大图列表：新到旧（createdAt 降序） */
function sortRootWorkflowAssetsNewestFirst(list: WorkflowAsset[]): WorkflowAsset[] {
  return [...list].sort((a, b) => {
    const ca = a.createdAt ?? 0;
    const cb = b.createdAt ?? 0;
    if (cb !== ca) return cb - ca;
    return a.id.localeCompare(b.id);
  });
}

/** 大纲：子资产沿 parentAssetId 得到 viewStack（不含子资产自身），用于组内子卡片定位 */
function workflowOutlineAncestorStack(childAssetId: string, assets: WorkflowAsset[]): { assetId: string }[] {
  const target = assets.find((a) => a.id === childAssetId);
  if (!target?.parentAssetId) return [];
  const chain: string[] = [];
  let pid: string | undefined = target.parentAssetId;
  while (pid) {
    chain.push(pid);
    const p = assets.find((x) => x.id === pid);
    pid = p?.parentAssetId;
  }
  chain.reverse();
  return chain.map((id) => ({ assetId: id }));
}

/** 进入某组内部：栈为从根到该组（含该组） */
function workflowOutlineDrillStackToEnterGroup(groupId: string, assets: WorkflowAsset[]): { assetId: string }[] {
  const chain: string[] = [];
  let id: string | undefined = groupId;
  while (id) {
    chain.push(id);
    const n = assets.find((a) => a.id === id);
    id = n?.parentAssetId;
  }
  chain.reverse();
  return chain.map((i) => ({ assetId: i }));
}

function workflowFindGroupItemIndex(parent: WorkflowAsset, childAssetId: string): number | null {
  const items = parent.cutImageGroup ?? [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it && typeof it === 'object' && 'assetId' in it && (it as { assetId: string }).assetId === childAssetId) {
      return i;
    }
  }
  return null;
}

/** 大纲树中所有「有子项」的组节点 id（与 outlineTreeRows 遍历一致，含嵌套引用子资产） */
function workflowOutlineExpandableGroupIds(assets: WorkflowAsset[], visibleRoots: WorkflowAsset[]): Set<string> {
  const ids = new Set<string>();
  const visit = (a: WorkflowAsset, visited: Set<string>) => {
    if (visited.has(a.id)) return;
    visited.add(a.id);
    const items = a.cutImageGroup ?? [];
    if (items.length > 0) ids.add(a.id);
    items.forEach((item) => {
      const isRef = item && typeof item === 'object' && 'assetId' in item;
      const childId = isRef ? (item as { assetId: string }).assetId : '';
      if (typeof item === 'string' || (item && typeof item === 'object' && 'r2Key' in item && !isRef)) return;
      if (isRef && childId) {
        const child = assets.find((x) => x.id === childId);
        if (child) visit(child, visited);
      }
    });
  };
  const seen = new Set<string>();
  visibleRoots.forEach((root) => visit(root, seen));
  return ids;
}

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
  /** 由 App 主滚动层注册，使列表两侧留白等网页空白处也能开始框选 */
  registerMarqueeStartHandler?: (handler: ((e: React.MouseEvent) => void) | null) => void;
  /** 由 App 主滚动层注册：左右留白区域滚轮可横向切页 */
  registerPaneWheelHandler?: (handler: ((e: React.WheelEvent) => void) | null) => void;
  /** 左侧「仓库」页：资产库条目（与弹窗导入同源） */
  libraryItems?: LibraryItem[];
  /** 大纲底部「放到仓库」：将选中工作区资产写入资产库（与 App 内 addToLibrary 同源） */
  onAddToLibrary?: (items: Partial<LibraryItem>[]) => void;
  /** 右侧「能力」页底部：能力预设编辑区（由 App 传入 Suspense 包裹的 CapabilityPresetSection） */
  capabilityPresetPanel?: React.ReactNode;
  /** 首次进入项目时的导览键（同一键仅执行一次横扫导览） */
  onboardingKey?: string | null;
}> = ({
  capabilityPresets,
  capabilitySets: capabilitySetsProp = [],
  assets: assetsProp,
  onAssetsChange: setAssets,
  pending: pendingProp,
  onPendingChange: setPending,
  onOpenLibraryPicker,
  onLog,
  onAddGenerate3DJob,
  preferenceScope = null,
  registerMarqueeStartHandler,
  registerPaneWheelHandler,
  libraryItems: libraryItemsProp,
  onAddToLibrary,
  capabilityPresetPanel,
  onboardingKey = null,
}) => {
  const libraryItems = Array.isArray(libraryItemsProp) ? libraryItemsProp : [];
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
  /** 功能块拖拽 id（仅 ref，不用 state：dragover 首帧时 setState 尚未提交会导致未 preventDefault、drop 失败） */
  const draggingActionIdRef = useRef<string | null>(null);
  const updateDraggingActionId = useCallback((id: string | null) => {
    draggingActionIdRef.current = id;
  }, []);
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
  const [viewStack, setViewStack] = useState<{ assetId: string }[]>([]);
  const viewStackRef = useRef(viewStack);
  viewStackRef.current = viewStack;
  const [showAllInGroup, setShowAllInGroup] = useState(false);
  const [groupStringLightboxIndex, setGroupStringLightboxIndex] = useState<number | null>(null);
  const [draggingGroupItems, setDraggingGroupItems] = useState<{ groupAssetId: string; itemIndexes: number[] } | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [selectedGroupItemKeys, setSelectedGroupItemKeys] = useState<Set<string>>(new Set());
  const [capabilityPresetViewMode, setCapabilityPresetViewMode] = useState<'presets' | 'image_process' | 'sets'>('presets');
  const [cardAspectByAssetId, setCardAspectByAssetId] = useState<Record<string, number>>({});
  /** 框选进行中：仅用布尔触发挂载选框层；拖动中用 ref + 直接改 DOM，避免每帧整表重绘 */
  const [marqueeActive, setMarqueeActive] = useState(false);
  const marqueeDataRef = useRef({ startX: 0, startY: 0, endX: 0, endY: 0 });
  const marqueeOverlayElRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const workspaceViewportRef = useRef<HTMLDivElement>(null);
  const workspaceTrackRef = useRef<HTMLDivElement>(null);
  const libraryScrollRef = useRef<HTMLDivElement>(null);
  const outlineScrollRef = useRef<HTMLDivElement>(null);
  /** 大纲：有 id 表示该组折叠子项；默认全展开 */
  const [outlineCollapsedIds, setOutlineCollapsedIds] = useState<Set<string>>(() => new Set());
  const centerScrollRef = useRef<HTMLDivElement>(null);
  const presetScrollRef = useRef<HTMLDivElement>(null);
  const [workspaceViewportWidth, setWorkspaceViewportWidth] = useState(0);
  /** 0=仓库|大纲 1=大纲|工作区 2=工作区|功能区 3=功能区|能力；支持连续位置 */
  const [workspacePane, setWorkspacePane] = useState<number>(2);
  const workspacePaneRef = useRef<number>(2);
  const [workspaceSnapping, setWorkspaceSnapping] = useState(false);
  const workspaceSnapTimerRef = useRef<number | null>(null);
  const workspaceSwipeTouchX = useRef(0);
  const workspaceSwipeStartOffsetPx = useRef(0);
  // 拖动时连续更新会触发大量 setState，使用 rAF 节流避免抖动
  const workspaceRafRef = useRef<number | null>(null);
  const workspaceNextPaneRef = useRef<number>(2);
  const setWorkspacePaneRaf = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(3, next));
      workspaceNextPaneRef.current = clamped;
      if (typeof window === 'undefined') {
        setWorkspacePane(clamped);
        return;
      }
      if (workspaceRafRef.current != null) return;
      workspaceRafRef.current = window.requestAnimationFrame(() => {
        workspaceRafRef.current = null;
        setWorkspacePane(workspaceNextPaneRef.current);
      });
    },
    []
  );
  const snapWorkspacePaneToNode = useCallback((rawPane?: number) => {
    const base = typeof rawPane === 'number' ? rawPane : workspacePaneRef.current;
    const snapped = Math.max(0, Math.min(3, Math.round(base)));
    if (workspaceSnapTimerRef.current != null && typeof window !== 'undefined') {
      window.clearTimeout(workspaceSnapTimerRef.current);
      workspaceSnapTimerRef.current = null;
    }
    const track = workspaceTrackRef.current;
    if (track) {
      // 先写入过渡，避免状态批处理时偶发“无动画硬切”。
      track.style.transition = `transform ${WORKSPACE_SNAP_DURATION_MS}ms ${WORKSPACE_SNAP_EASING}`;
    }
    setWorkspaceSnapping(true);
    setWorkspacePane(snapped);
    if (typeof window !== 'undefined') {
      workspaceSnapTimerRef.current = window.setTimeout(() => {
        setWorkspaceSnapping(false);
        workspaceSnapTimerRef.current = null;
      }, WORKSPACE_SNAP_DURATION_MS);
    } else {
      setWorkspaceSnapping(false);
    }
  }, []);
  useEffect(() => {
    const key = String(onboardingKey || '').trim();
    if (!key) return;
    let done = false;
    try {
      done = localStorage.getItem(`${WORKFLOW_FIRST_SWEEP_DONE_KEY}:${key}`) === '1';
    } catch {
      done = false;
    }
    if (done) return;
    let cancelled = false;
    const timers: number[] = [];
    const markDone = () => {
      try {
        localStorage.setItem(`${WORKFLOW_FIRST_SWEEP_DONE_KEY}:${key}`, '1');
      } catch {
        /* ignore */
      }
    };
    timers.push(window.setTimeout(() => {
      if (cancelled) return;
      snapWorkspacePaneToNode(0);
    }, 260));
    timers.push(window.setTimeout(() => {
      if (cancelled) return;
      snapWorkspacePaneToNode(3);
    }, 980));
    timers.push(window.setTimeout(() => {
      if (cancelled) return;
      snapWorkspacePaneToNode(2);
      markDone();
    }, 1700));
    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [onboardingKey, snapWorkspacePaneToNode]);
  useEffect(() => {
    return () => {
      if (workspaceRafRef.current != null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(workspaceRafRef.current);
      }
      if (workspaceSnapTimerRef.current != null && typeof window !== 'undefined') {
        window.clearTimeout(workspaceSnapTimerRef.current);
      }
    };
  }, []);
  /** 从功能区「词」进入能力页：横向滑到能力列并滚动到对应预设卡片 */
  const jumpToCapabilityPreset = useCallback((preset: CustomAppModule) => {
    const mode: 'presets' | 'image_process' =
      preset.category === 'image_process' ? 'image_process' : 'presets';
    setCapabilityPresetViewMode(mode);
    if (typeof window !== 'undefined') {
      const emitJump = () => {
        window.dispatchEvent(new CustomEvent('ac:capability-preset-view-mode', { detail: { mode } }));
        window.dispatchEvent(new CustomEvent('ac:capability-jump-to-preset', { detail: { presetId: preset.id } }));
      };
      // 首次点击时能力区可能正处于懒加载/重排，补发两次可显著降低“点两次才跳转”
      emitJump();
      window.requestAnimationFrame(emitJump);
      window.setTimeout(emitJump, 220);
    }
    snapWorkspacePaneToNode(3);
  }, [snapWorkspacePaneToNode]);
  const [spacePanEnabled, setSpacePanEnabled] = useState(false);
  const [spacePanDragging, setSpacePanDragging] = useState(false);
  const marqueeStartRef = useRef(false);
  const suppressClickAfterPanRef = useRef(false);
  const wheelLockUntilRef = useRef(0);
  const [libraryImportIds, setLibraryImportIds] = useState<Set<string>>(new Set());
  /** 大纲底部拖入区高亮 */
  const [outlineFooterDropOver, setOutlineFooterDropOver] = useState<'toWorkspace' | 'toLibrary' | null>(null);
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'library' | 'archived'>('all');
  /** 框选起始时的横向页：0=仓库 1|2=工作区画布（与 workspacePane 对齐） */
  const marqueePaneRef = useRef(0);
  const handleMarqueeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const pn = Math.round(workspacePane);
      if (pn !== 0 && pn !== 1 && pn !== 2) return;
      if (pn !== 0 && showArchived) return;
      if ((e.target as Element).closest('[data-workflow-toolbar]')) return;
      if (pn === 0) {
        if ((e.target as Element).closest('[data-workflow-library-card]')) return;
        if ((e.target as Element).closest('[data-workflow-outline]')) return;
        if ((e.target as Element).closest('[data-workflow-outline-footer]')) return;
        if ((e.target as Element).closest('button, [role="button"], a, input, select, textarea, label')) return;
        if ((e.target as Element).closest('[data-workflow-sidebar], [data-workflow-preset]')) return;
      } else {
        if ((e.target as Element).closest('[data-workflow-card]')) return;
        if ((e.target as Element).closest('button, [role="button"], a, input, select, textarea, label')) return;
        if ((e.target as Element).closest('[data-workflow-sidebar], [data-workflow-preset], [data-workflow-outline]')) return;
      }
      marqueePaneRef.current = pn;
      // 本次鼠标按下将启动框选；如果同时按了 Space，我们让“平移抓手”不要抢占该事件
      marqueeStartRef.current = true;
      e.preventDefault();
      e.stopPropagation();
      marqueeDataRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        endX: e.clientX,
        endY: e.clientY,
      };
      setMarqueeActive(true);
    },
    [showArchived, workspacePane]
  );
  useEffect(() => {
    if (!registerMarqueeStartHandler) return;
    registerMarqueeStartHandler(handleMarqueeMouseDown);
    return () => registerMarqueeStartHandler(null);
  }, [registerMarqueeStartHandler, handleMarqueeMouseDown]);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const libraryCardRefs = useRef<Map<string, HTMLElement>>(new Map());

  const toggleOutlineGroupCollapsed = useCallback((groupId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOutlineCollapsedIds((prev) => {
      const n = new Set(prev);
      if (n.has(groupId)) n.delete(groupId);
      else n.add(groupId);
      return n;
    });
  }, []);

  const navigateOutlineToAsset = useCallback(
    (asset: WorkflowAsset) => {
      if (!asset.parentAssetId) {
        setViewStack([]);
        setSelectedGroupItemKeys(new Set());
        setSelectedAssetIds(new Set([asset.id]));
        requestAnimationFrame(() => {
          cardRefs.current.get(asset.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
        return;
      }
      const parent = assets.find((p) => p.id === asset.parentAssetId);
      if (!parent) return;
      const idx = workflowFindGroupItemIndex(parent, asset.id);
      if (idx == null) return;
      setViewStack(workflowOutlineAncestorStack(asset.id, assets));
      setSelectedAssetIds(new Set());
      setSelectedGroupItemKeys(new Set([`${parent.id}::${idx}`]));
      requestAnimationFrame(() => {
        cardRefs.current.get(`${parent.id}::${idx}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    },
    [assets]
  );

  const navigateOutlineToGroupItem = useCallback(
    (group: WorkflowAsset, itemIndex: number) => {
      setViewStack(workflowOutlineDrillStackToEnterGroup(group.id, assets));
      setSelectedAssetIds(new Set());
      setSelectedGroupItemKeys(new Set([`${group.id}::${itemIndex}`]));
      requestAnimationFrame(() => {
        cardRefs.current.get(`${group.id}::${itemIndex}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    },
    [assets]
  );

  const [dragOverAssetId, setDragOverAssetId] = useState<string | null>(null);
  const [dragOverGroupItemKey, setDragOverGroupItemKey] = useState<string | null>(null);
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

  const getModule = (id: string) => actionModules.find((m) => m.id === id);
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
  const archivedLibraryItems = useMemo<LibraryItem[]>(() => {
    return assets
      .filter((a) => a.archived && !a.parentAssetId)
      .map((a) => {
        const data = getAssetDisplayImage(a);
        if (!data) return null;
        return {
          id: `archived:${a.id}`,
          type: 'SLICE' as const,
          category: 'PREVIEW_STRIP' as const,
          label: a.groupLabel || `归档-${new Date(a.createdAt).toLocaleDateString('zh-CN')}`,
          data,
          sourceId: a.id,
          timestamp: a.createdAt,
          groupId: 'workflow-archived',
        };
      })
      .filter(Boolean) as LibraryItem[];
  }, [assets, getAssetDisplayImage]);
  const repositoryItems = useMemo<LibraryItem[]>(() => {
    if (libraryFilter === 'library') return libraryItems;
    if (libraryFilter === 'archived') return archivedLibraryItems;
    return [...libraryItems, ...archivedLibraryItems];
  }, [libraryFilter, libraryItems, archivedLibraryItems]);
  useEffect(() => {
    const validIds = new Set(repositoryItems.map((item) => item.id));
    setLibraryImportIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
      });
      // 仅在实际变化时更新，避免无意义的状态回写造成交互卡顿/失效
      if (next.size === prev.size) {
        let same = true;
        prev.forEach((id) => {
          if (!next.has(id)) same = false;
        });
        if (same) return prev;
      }
      return next;
    });
  }, [repositoryItems]);

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
    if (module.skipUnderstand === true) return base;
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
        const dedupIndexes = Array.from(new Set(itemIndexes)).filter((i) => i >= 0 && i < items.length);
        if (dedupIndexes.length === 0) return prev;
        const indexSet = new Set(dedupIndexes);
        const nextItems = items.filter((_, i) => !indexSet.has(i));
        const parentId = group.parentAssetId;

        const childIds: string[] = [];
        const childIdSeen = new Set<string>();
        items.forEach((item, i) => {
          if (!indexSet.has(i)) return;
          const childId =
            typeof item === 'object' && item && 'assetId' in item ? (item as { assetId: string }).assetId : null;
          if (childId && !childIdSeen.has(childId)) {
            childIdSeen.add(childId);
            childIds.push(childId);
          }
        });

        if (nextItems.length === 0) {
          list.splice(groupIdx, 1);
          if (parentId) {
            const parentIdx = list.findIndex((a) => a.id === parentId);
            if (parentIdx !== -1) {
              const parent = list[parentIdx];
              const parentItems = (parent.cutImageGroup ?? []).filter(
                (it) => !(typeof it === 'object' && it && 'assetId' in it && (it as { assetId: string }).assetId === groupAssetId)
              );
              list[parentIdx] = { ...parent, cutImageGroup: parentItems.length ? parentItems : undefined };
            }
          }
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
              const existsInParent = (parent.cutImageGroup ?? []).some(
                (it) => typeof it === 'object' && it && 'assetId' in it && (it as { assetId: string }).assetId === childId
              );
              const parentItems = existsInParent
                ? [...(parent.cutImageGroup ?? [])]
                : [...(parent.cutImageGroup ?? []), { assetId: childId }];
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
    const batchBase = Date.now();
    const n = imageFiles.length;
    imageFiles.forEach((file, fileIdx) => {
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
            createdAt: batchBase + (n - 1 - fileIdx),
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
    const types = dt.types ? Array.from(dt.types) : [];
    if (types.includes('text/uri-list') || types.includes('text/html')) return true;
    return false;
  }, []);
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

  useEffect(() => {
    const onWindowPaste = (e: ClipboardEvent) => {
      if (showArchived) return;
      /** 仅让出真正的可编辑区；不要用 isGlobalUploadBlockedTarget(e.target)，否则焦点在顶部 Tab 等按钮上时，在列表里粘贴会被误拦截 */
      const active = document.activeElement;
      if (active && isEditableTarget(active)) return;
      const files = collectImageFilesFromClipboardItems(e.clipboardData?.items);
      if (!files.length) return;
      e.preventDefault();
      addImagesFromFiles(files);
    };
    window.addEventListener('paste', onWindowPaste);
    return () => {
      window.removeEventListener('paste', onWindowPaste);
    };
  }, [addImagesFromFiles, collectImageFilesFromClipboardItems, isEditableTarget, showArchived]);

  useEffect(() => {
    const onWindowDragOver = (e: DragEvent) => {
      if (showArchived) return;
      if (isGlobalUploadBlockedTarget(e.target)) return;
      if (!hasImageFileTransfer(e.dataTransfer)) return;
      e.preventDefault();
    };

    const onWindowDrop = (e: DragEvent) => {
      if (showArchived) return;
      if (isGlobalUploadBlockedTarget(e.target)) return;
      const dt = e.dataTransfer;
      if (!hasImageFileTransfer(dt)) return;
      e.preventDefault();
      const files = Array.from(dt?.files || []).filter((f) => f.type?.startsWith('image/'));
      if (files.length) {
        addImagesFromFiles(files);
        return;
      }
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
  }, [addImagesFromFiles, collectImageLikeUrlsFromDataTransfer, fetchImageFilesFromUrls, hasImageFileTransfer, isGlobalUploadBlockedTarget, showArchived]);

  const visibleAssets = useMemo(() => {
    // 仅展示“根资产”：归档状态匹配，且不是子资产（没有 parentAssetId）；新导入在前（createdAt 降序）
    const list = assets.filter(
      (a) => a.archived === showArchived && (!a.hiddenInGrid || a.archived) && !a.parentAssetId
    );
    return sortRootWorkflowAssetsNewestFirst(list);
  }, [assets, showArchived]);

  const outlineExpandableGroupIds = useMemo(
    () => workflowOutlineExpandableGroupIds(assets, visibleAssets),
    [assets, visibleAssets]
  );

  const expandOutlineAll = useCallback(() => {
    setOutlineCollapsedIds(new Set());
  }, []);

  const collapseOutlineAll = useCallback(() => {
    setOutlineCollapsedIds(new Set(outlineExpandableGroupIds));
  }, [outlineExpandableGroupIds]);

  const outlineTreeRows = useMemo(() => {
    const rows: React.ReactElement[] = [];
    const visit = (
      a: WorkflowAsset,
      depth: number,
      parent: WorkflowAsset | null,
      indexInParent: number | null,
      visited: Set<string>
    ) => {
      if (visited.has(a.id)) return;
      visited.add(a.id);
      const label =
        a.groupLabel ||
        (a.cutImageGroup?.length ? (a.groupKind === 'manual' ? '组' : '切割') : null) ||
        `图片 ${a.id.slice(0, 8)}`;
      const items = a.cutImageGroup ?? [];
      const hasChildren = items.length > 0;
      const expanded = !hasChildren || !outlineCollapsedIds.has(a.id);
      const isSel =
        parent != null && indexInParent != null
          ? selectedGroupItemKeys.has(`${parent.id}::${indexInParent}`)
          : selectedAssetIds.has(a.id) && viewStack.length === 0;

      rows.push(
        <div
          key={`ol-${a.id}-d${depth}-p${parent?.id ?? 'root'}i${indexInParent ?? -1}`}
          className="flex items-stretch gap-0.5 min-w-0"
          style={{ paddingLeft: depth * 10 }}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? '折叠子项' : '展开子项'}
              onClick={(e) => toggleOutlineGroupCollapsed(a.id, e)}
              className="shrink-0 w-5 h-7 flex items-center justify-center rounded-md text-gray-400 hover:bg-white/10 hover:text-white outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50"
            >
              <span className="text-[9px] font-bold leading-none" aria-hidden>
                {expanded ? '▼' : '▶'}
              </span>
            </button>
          ) : (
            <span className="shrink-0 w-5 h-7" aria-hidden />
          )}
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              try {
                const payload: AcWorkflowExportPayload = { mode: 'roots', assetIds: [a.id] };
                e.dataTransfer.setData(DT_AC_WORKFLOW_EXPORT, JSON.stringify(payload));
                e.dataTransfer.effectAllowed = 'copy';
              } catch {
                /* ignore */
              }
            }}
            onClick={() => {
              setShowArchived(!!a.archived);
              navigateOutlineToAsset(a);
            }}
            className={`flex-1 min-w-0 text-left rounded-lg px-2 py-1.5 text-[9px] border transition-colors truncate ${
              isSel ? 'border-blue-500 bg-[#152642] text-blue-200' : 'border-white/[0.06] bg-[#141416] text-gray-300 hover:bg-[#1c1c22]'
            }`}
          >
            {a.archived ? <span className="text-gray-500 mr-1">已归</span> : null}
            {label}
            {hasChildren ? (
              <span className="text-gray-500 ml-1 tabular-nums font-mono text-[8px]">({items.length})</span>
            ) : null}
          </button>
        </div>
      );

      if (!hasChildren || !expanded) return;

      items.forEach((item, idx) => {
        const isRef = item && typeof item === 'object' && 'assetId' in item;
        const childId = isRef ? (item as { assetId: string }).assetId : '';
        if (typeof item === 'string' || (item && typeof item === 'object' && 'r2Key' in item && !isRef)) {
          const gk = `${a.id}::${idx}`;
          const sel = selectedGroupItemKeys.has(gk);
          rows.push(
            <div
              key={`ol-${a.id}-slot-${idx}`}
              className="flex items-stretch gap-0.5 min-w-0"
              style={{ paddingLeft: (depth + 1) * 10 }}
            >
              <span className="shrink-0 w-5 h-7" aria-hidden />
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  try {
                    const payload: AcWorkflowExportPayload = {
                      mode: 'groupItems',
                      items: [{ parentId: a.id, index: idx }],
                    };
                    e.dataTransfer.setData(DT_AC_WORKFLOW_EXPORT, JSON.stringify(payload));
                    e.dataTransfer.effectAllowed = 'copy';
                  } catch {
                    /* ignore */
                  }
                }}
                onClick={() => {
                  setShowArchived(!!a.archived);
                  navigateOutlineToGroupItem(a, idx);
                }}
                className={`flex-1 min-w-0 text-left rounded-lg px-2 py-1.5 text-[9px] border transition-colors truncate ${
                  sel ? 'border-blue-500 bg-[#152642] text-blue-200' : 'border-white/[0.06] bg-[#141416] text-gray-300 hover:bg-[#1c1c22]'
                }`}
              >
                <span className="text-gray-500 mr-1">图</span>子项 {idx + 1}
              </button>
            </div>
          );
          return;
        }
        if (isRef && childId) {
          const child = assets.find((x) => x.id === childId);
          if (child) {
            visit(child, depth + 1, a, idx, visited);
          } else {
            rows.push(
              <div
                key={`ol-miss-${a.id}-${idx}`}
                className="text-[8px] text-amber-600/90 pl-2 py-0.5"
                style={{ paddingLeft: (depth + 1) * 10 + 20 }}
              >
                引用缺失 #{idx + 1}
              </div>
            );
          }
        }
      });
    };

    const seen = new Set<string>();
    visibleAssets.forEach((root) => visit(root, 0, null, null, seen));
    return rows;
  }, [
    assets,
    visibleAssets,
    outlineCollapsedIds,
    selectedAssetIds,
    selectedGroupItemKeys,
    viewStack.length,
    navigateOutlineToAsset,
    navigateOutlineToGroupItem,
    toggleOutlineGroupCollapsed,
  ]);

  /** 第 0 页大纲列：仓库条目（与左侧网格多选同步），非工作区资产树 */
  const repositoryOutlineRows = useMemo(
    () =>
      repositoryItems.map((item) => {
        const selected = libraryImportIds.has(item.id);
        return (
          <div key={`repo-ol-${item.id}`} className="flex items-stretch gap-0.5 min-w-0">
            <span className="shrink-0 w-5 h-7" aria-hidden />
            <button
              type="button"
              draggable
              onDragStart={(e) => {
                try {
                  e.dataTransfer.setData(DT_AC_LIBRARY_ITEM_ID, item.id);
                  e.dataTransfer.effectAllowed = 'copy';
                } catch {
                  /* ignore */
                }
              }}
              onClick={() => {
                setLibraryImportIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                });
              }}
              className={`flex-1 min-w-0 text-left rounded-lg px-2 py-1.5 text-[9px] border transition-colors truncate ${
                selected
                  ? 'border-blue-500 bg-[#152642] text-blue-200'
                  : 'border-white/[0.06] bg-[#141416] text-gray-300 hover:bg-[#1c1c22]'
              }`}
            >
              {item.label?.trim() || '未命名'}
            </button>
          </div>
        );
      }),
    [repositoryItems, libraryImportIds]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onModeChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: string }>).detail;
      if (detail?.mode === 'presets' || detail?.mode === 'image_process' || detail?.mode === 'sets') {
        setCapabilityPresetViewMode(detail.mode);
      }
    };
    window.addEventListener('ac:capability-preset-view-mode-changed', onModeChanged as EventListener);
    return () => {
      window.removeEventListener('ac:capability-preset-view-mode-changed', onModeChanged as EventListener);
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

  const lightboxAsset = lightboxAssetId ? assets.find((a) => a.id === lightboxAssetId) : null;
  const lightboxList = useMemo(
    () =>
      sortRootWorkflowAssetsNewestFirst(
        assets.filter((a) => !a.archived && !a.hiddenInGrid && !a.parentAssetId)
      ),
    [assets]
  );
  const lightboxListRef = useRef(lightboxList);
  lightboxListRef.current = lightboxList;
  const lightboxIndex = lightboxAssetId ? lightboxList.findIndex((a) => a.id === lightboxAssetId) : -1;
  const goLightbox = (delta: number) => {
    if (lightboxList.length === 0) return;
    const next = (lightboxIndex + delta + lightboxList.length) % lightboxList.length;
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
  }, []);

  /** 大图预览：普通滚轮在本资产内切换 displayKey */
  const handleLightboxWheelCycleDisplay = useCallback((deltaSteps: number) => {
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
  }, [lightboxAssetId]);

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

  const updateMarqueeOverlayDom = useCallback(() => {
    const d = marqueeDataRef.current;
    const el = marqueeOverlayElRef.current;
    if (!el) return;
    const left = Math.min(d.startX, d.endX);
    const top = Math.min(d.startY, d.endY);
    const width = Math.max(0, Math.abs(d.endX - d.startX));
    const height = Math.max(0, Math.abs(d.endY - d.startY));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
  }, []);

  useLayoutEffect(() => {
    if (!marqueeActive) return;
    updateMarqueeOverlayDom();
  }, [marqueeActive, updateMarqueeOverlayDom]);

  useEffect(() => {
    if (!marqueeActive) return;
    const onMove = (e: MouseEvent) => {
      marqueeDataRef.current.endX = e.clientX;
      marqueeDataRef.current.endY = e.clientY;
      updateMarqueeOverlayDom();
    };
    const onUp = (e: MouseEvent) => {
      const d = marqueeDataRef.current;
      const left = Math.min(d.startX, d.endX);
      const top = Math.min(d.startY, d.endY);
      const width = Math.abs(d.endX - d.startX);
      const height = Math.abs(d.endY - d.startY);
      const isClick = width < 5 && height < 5;
      const pane = marqueePaneRef.current;
      const vs = viewStackRef.current;
      const altKey = e.altKey;

      // 先收起选框再算相交：大量 getBoundingClientRect 会长时间占用主线程，否则松手后仍像「卡一下」才消失
      marqueeOverlayElRef.current?.style.setProperty('visibility', 'hidden');
      setMarqueeActive(false);

      if (isClick) {
        if (pane === 0) {
          setLibraryImportIds(new Set());
        } else if (vs.length === 0) {
          setSelectedAssetIds(new Set());
        } else {
          setSelectedGroupItemKeys(new Set());
        }
        return;
      }

      const sel = { left, top, width, height };

      const applySelection = () => {
        if (pane === 0) {
          const ids: string[] = [];
          libraryCardRefs.current.forEach((el, id) => {
            const r = el.getBoundingClientRect();
            const overlap =
              !(sel.left + sel.width < r.left || r.left + r.width < sel.left || sel.top + sel.height < r.top || r.top + r.height < sel.top);
            if (overlap) ids.push(id);
          });
          if (ids.length) {
            const toAdd = altKey ? [] : ids;
            const toRemove = altKey ? ids : [];
            setLibraryImportIds((s) => {
              const next = new Set(s);
              toRemove.forEach((id) => next.delete(id));
              toAdd.forEach((id) => next.add(id));
              return next;
            });
          }
          return;
        }
        const ids: string[] = [];
        cardRefs.current.forEach((el, id) => {
          const r = el.getBoundingClientRect();
          const overlap =
            !(sel.left + sel.width < r.left || r.left + r.width < sel.left || sel.top + sel.height < r.top || r.top + r.height < sel.top);
          if (overlap) ids.push(id);
        });
        if (!ids.length) return;
        const vsNow = viewStackRef.current;
        const pendNow = pendingRef.current;
        if (vsNow.length === 0) {
          const toAdd = altKey ? [] : ids.filter((id) => !pendNow.some((t) => t.assetId === id));
          const toRemove = altKey ? ids : [];
          setSelectedAssetIds((s) => {
            const next = new Set(s);
            toRemove.forEach((id) => next.delete(id));
            toAdd.forEach((id) => next.add(id));
            return next;
          });
        } else {
          const currentGroupId = vsNow[vsNow.length - 1]?.assetId;
          const toAdd = altKey
            ? []
            : ids.filter((key) => {
                const parts = String(key).split('::');
                if (parts.length !== 2) return true;
                const idx = parseInt(parts[1], 10);
                if (Number.isNaN(idx)) return true;
                return !pendNow.some((t) => t.sourceGroupAssetId === currentGroupId && t.sourceItemIndex === idx);
              });
          const toRemove = altKey ? ids : [];
          setSelectedGroupItemKeys((s) => {
            const next = new Set(s);
            toRemove.forEach((key) => next.delete(key));
            toAdd.forEach((key) => next.add(key));
            return next;
          });
        }
      };

      window.requestAnimationFrame(applySelection);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [marqueeActive, updateMarqueeOverlayDom]);

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
  // 常用功能只做“置顶快捷入口”，不从原列表移除，避免用户误以为模块丢失
  const visibleByCategory = useMemo(() => byCategory, [byCategory]);
  const visiblePresets = useMemo(() => presets, [presets]);
  const visibleCapabilitySets = useMemo(() => capabilitySets, [capabilitySets]);
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

  const importLibraryItemsIntoWorkflow = useCallback(
    (items: LibraryItem[]) => {
      const valid = items.filter((item) => item?.data);
      if (!valid.length) return;
      setAssets((prev) => {
        const groupCtx =
          viewStack.length > 0
            ? prev.find((a) => a.id === viewStack[viewStack.length - 1].assetId)
            : null;
        const baseT = Date.now();
        const n = valid.length;
        const created: WorkflowAsset[] = valid.map((item, idx) => ({
          id: uuid(),
          original: item.data,
          displayKey: 'original' as const,
          results: {} as Record<string, string>,
          resultOrder: [] as string[],
          archived: false,
          hiddenInGrid: false,
          createdAt: baseT + (n - 1 - idx),
          ...(groupCtx ? { parentAssetId: groupCtx.id } : {}),
        }));
        if (!groupCtx) {
          return [...prev, ...created];
        }
        const next = prev.map((a) => {
          if (a.id === groupCtx.id) {
            const gItems = [...(a.cutImageGroup ?? [])];
            created.forEach((c) => gItems.push({ assetId: c.id }));
            return { ...a, cutImageGroup: gItems };
          }
          return a;
        });
        return next.concat(created);
      });
      setLibraryImportIds(new Set());
      setWorkspacePane(2);
    },
    [viewStack, setAssets]
  );

  const handleOutlineDropToWorkspace = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.dataTransfer.getData(DT_AC_LIBRARY_ITEM_ID);
      if (!id) return;
      const item = repositoryItems.find((i) => i.id === id);
      if (!item?.data) return;
      importLibraryItemsIntoWorkflow([item]);
    },
    [repositoryItems, importLibraryItemsIntoWorkflow]
  );

  const handleOutlineDropToLibrary = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!onAddToLibrary) {
        onLog?.('warn', '无法写入仓库', '未配置 onAddToLibrary');
        return;
      }
      const raw = e.dataTransfer.getData(DT_AC_WORKFLOW_EXPORT);
      if (!raw) return;
      let payload: AcWorkflowExportPayload;
      try {
        payload = JSON.parse(raw) as AcWorkflowExportPayload;
      } catch {
        return;
      }
      const items = buildLibraryItemsFromWorkflowExport(assets, showArchived, getAssetDisplayImage, payload);
      if (items.length === 0) {
        onLog?.('warn', '未写入仓库', '拖入项无可导出的图');
        return;
      }
      onAddToLibrary(items);
      onLog?.('info', `已写入仓库 ${items.length} 条`, undefined);
    },
    [onAddToLibrary, onLog, assets, showArchived, getAssetDisplayImage]
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
  const paneWidth = Math.max(320, workspaceViewportWidth || 0);
  const sidebarWidth = 320;
  const listPaneWidth = Math.max(320, paneWidth - sidebarWidth);
  /** 轨道顺序：仓(L)|纲(320)|工(L)|功(320)|能(L)；大纲宽=功能区宽 */
  const presetPaneWidth = listPaneWidth;
  const trackTotalWidth = listPaneWidth + sidebarWidth + listPaneWidth + sidebarWidth + presetPaneWidth;
  const activePaneNode = Math.max(0, Math.min(3, Math.round(workspacePane)));
  const topTitleColumns = useMemo(() => {
    const outlineExpandDisabled =
      outlineExpandableGroupIds.size === 0 || outlineCollapsedIds.size === 0;
    const outlineCollapseDisabled =
      outlineExpandableGroupIds.size === 0 ||
      [...outlineExpandableGroupIds].every((id) => outlineCollapsedIds.has(id));

    /** 第 0 页：大纲列对应仓库条目列表 */
    const outlineRepoTopBarColumn = {
      title: '大纲',
      desc: '当前筛选下的仓库条目；点击行与左侧画布多选同步',
      actions: null as React.ReactNode,
    };

    /** 第 1 页起：工作区资产树大纲 */
    const outlineWorkflowTopBarColumn = {
      title: '大纲',
      desc: '窄栏与功能区同宽；右侧为完整工作区',
      actions: (
        <div className="flex items-center gap-2 whitespace-nowrap flex-wrap">
          <button
            type="button"
            onClick={expandOutlineAll}
            disabled={outlineExpandDisabled}
            className={TITLE_ROW_BTN_NEUTRAL}
          >
            展开
          </button>
          <button
            type="button"
            onClick={collapseOutlineAll}
            disabled={outlineCollapseDisabled}
            className={TITLE_ROW_BTN_NEUTRAL}
          >
            折叠
          </button>
        </div>
      ),
    };

    if (activePaneNode === 0) {
      return [
        {
          title: '资产仓库',
          desc: '筛选后点击或框选多选；列数与工作区画布共用设置；右侧大纲与操作区可同步',
          actions: (
            <div className="flex flex-wrap items-center gap-2 justify-end min-w-0">
              <span className="text-[9px] font-black text-gray-500 uppercase shrink-0">筛选</span>
              <button
                type="button"
                onClick={() => setLibraryFilter('all')}
                className={libraryFilter === 'all' ? TITLE_ROW_BTN_ACTIVE : TITLE_ROW_BTN_NEUTRAL}
              >
                全部
              </button>
              <button
                type="button"
                onClick={() => setLibraryFilter('library')}
                className={libraryFilter === 'library' ? TITLE_ROW_BTN_ACTIVE : TITLE_ROW_BTN_NEUTRAL}
              >
                仓库
              </button>
              <button
                type="button"
                onClick={() => setLibraryFilter('archived')}
                className={libraryFilter === 'archived' ? TITLE_ROW_BTN_ACTIVE : TITLE_ROW_BTN_NEUTRAL}
              >
                归档
              </button>
              <div className="h-8 inline-flex items-center rounded-lg border border-[#2e2e32] bg-[#1c1c22] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setColumnCount((n) => Math.max(2, n - 1))}
                  disabled={columnCount <= 2}
                  className="w-8 h-8 text-[11px] font-black text-gray-300 hover:bg-[#2e2e36] disabled:opacity-35 disabled:hover:bg-transparent"
                  aria-label="减少列数"
                >
                  −
                </button>
                <span className="w-9 h-8 inline-flex items-center justify-center text-[9px] font-black text-blue-300 border-x border-[#2e2e32]">
                  {columnCount}
                </span>
                <button
                  type="button"
                  onClick={() => setColumnCount((n) => Math.min(6, n + 1))}
                  disabled={columnCount >= 6}
                  className="w-8 h-8 text-[11px] font-black text-gray-300 hover:bg-[#2e2e36] disabled:opacity-35 disabled:hover:bg-transparent"
                  aria-label="增加列数"
                >
                  +
                </button>
              </div>
              {repositoryItems.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setLibraryImportIds(new Set())}
                    className={TITLE_ROW_BTN_NEUTRAL}
                  >
                    清空选择
                  </button>
                  <button
                    type="button"
                    disabled={libraryImportIds.size === 0}
                    onClick={() => {
                      const picked = repositoryItems.filter((i) => libraryImportIds.has(i.id));
                      importLibraryItemsIntoWorkflow(picked);
                    }}
                    className={`${TITLE_ROW_BTN_BASE} bg-blue-600 border-blue-500 text-white hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600`}
                  >
                    导入工作区（{libraryImportIds.size}）
                  </button>
                </>
              )}
            </div>
          ),
        },
        outlineRepoTopBarColumn,
      ];
    }
    if (activePaneNode === 1 || activePaneNode === 2) {
      const selectableCount = visibleAssets.filter(
        (a) => !pending.some((t) => t.assetId === a.id)
      ).length;
      const allSelectableIds = new Set(
        visibleAssets
          .filter((a) => !pending.some((t) => t.assetId === a.id))
          .map((a) => a.id)
      );
      const allSelected = selectedAssetIds.size === selectableCount && selectableCount > 0;

      const workspaceAndFunctionCols = [
        {
          title: '工作区',
          desc: '进行中与已完成内容管理',
          actions: (
            <>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-[9px] font-black text-gray-500 uppercase">显示</span>
                <button
                  type="button"
                  onClick={() => {
                    setShowArchived(false);
                  }}
                  className={!showArchived ? TITLE_ROW_BTN_ACTIVE : TITLE_ROW_BTN_NEUTRAL}
                >
                  进行中
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowArchived(true);
                    setViewStack([]);
                    setSelectedGroupItemKeys(new Set());
                  }}
                  className={showArchived ? TITLE_ROW_BTN_ACTIVE : TITLE_ROW_BTN_NEUTRAL}
                >
                  已完成
                </button>
                <label className={`${TITLE_ROW_BTN_NEUTRAL} cursor-pointer`}>
                  多选上传
                  <input type="file" className="hidden" accept="image/*" multiple onChange={handleBatchUploadCorrect} />
                </label>
                {onOpenLibraryPicker && (
                  <button
                    type="button"
                    onClick={() => onOpenLibraryPicker((items) => importLibraryItemsIntoWorkflow(items))}
                    className={TITLE_ROW_BTN_NEUTRAL}
                  >
                    从仓库导入
                  </button>
                )}
                <div className="h-8 inline-flex items-center rounded-lg border border-[#2e2e32] bg-[#1c1c22] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setColumnCount((n) => Math.max(2, n - 1))}
                    disabled={columnCount <= 2}
                    className="w-8 h-8 text-[11px] font-black text-gray-300 hover:bg-[#2e2e36] disabled:opacity-35 disabled:hover:bg-transparent"
                    aria-label="减少列数"
                  >
                    −
                  </button>
                  <span className="w-9 h-8 inline-flex items-center justify-center text-[9px] font-black text-blue-300 border-x border-[#2e2e32]">
                    {columnCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setColumnCount((n) => Math.min(6, n + 1))}
                    disabled={columnCount >= 6}
                    className="w-8 h-8 text-[11px] font-black text-gray-300 hover:bg-[#2e2e36] disabled:opacity-35 disabled:hover:bg-transparent"
                    aria-label="增加列数"
                  >
                    +
                  </button>
                </div>
              </div>
              {archiveHint && !showArchived && (
                <div className="h-8 flex items-center gap-2 px-3 rounded-lg bg-[#152642] border border-[#3b6fb8] text-[9px] text-blue-200">
                  <span className="font-black uppercase">已归档</span>
                  <span className="text-gray-300">在「已完成」里查看</span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowArchived(true);
                      setArchivedDetailAssetId(archiveHint.assetId);
                      setArchiveHint(null);
                    }}
                    className="h-6 px-2 rounded-md bg-[#1e3558] hover:bg-[#264670] text-[8px] font-black uppercase text-blue-100 inline-flex items-center"
                  >
                    去查看
                  </button>
                </div>
              )}
              {!showArchived && visibleAssets.length > 0 && (
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setSelectedAssetIds((prev) => (prev.size === allSelectableIds.size ? new Set() : allSelectableIds))}
                    className={TITLE_ROW_BTN_NEUTRAL}
                  >
                    {allSelected ? '取消全选' : '全选'}
                  </button>
                  {selectedAssetIds.size > 0 && (
                    <>
                      <span className="text-[9px] text-gray-500">已选 {selectedAssetIds.size}</span>
                      <span className="text-[8px] text-gray-600">空白处点击清空 · Alt+框选减选</span>
                    </>
                  )}
                </div>
              )}
            </>
          ),
        },
        {
          title: '功能区',
          desc: '基础能力与复合能力',
          actions: (
            <div className="flex items-center gap-2 whitespace-nowrap">
              <button
                type="button"
                onClick={() => executePending()}
                disabled={pending.length === 0 || executing}
                className={`${TITLE_ROW_BTN_BASE} bg-blue-600 hover:bg-blue-500 border-[#60a5fa] text-white disabled:opacity-40 disabled:hover:bg-blue-600`}
              >
                {executing
                  ? `执行中 ${executingQueue?.current ?? 0}/${executingQueue?.total ?? 0}`
                  : `一键执行（${pending.length}）`}
              </button>
              {(pending.length > 0 || executingQueue) && (
                <div className="h-8 flex items-center gap-2 px-3 rounded-lg bg-[#1c1c22] border border-[#2e2e32]">
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
                        className="text-[8px] text-blue-400 hover:text-blue-300 font-medium ml-1 leading-none"
                      >
                        清空
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ),
        },
      ];
      if (activePaneNode === 1) return [outlineWorkflowTopBarColumn, workspaceAndFunctionCols[0]!];
      return workspaceAndFunctionCols;
    }
    return [
      {
        title: '功能区',
        desc: '基础能力与复合能力',
        actions: (
          <div className="flex items-center gap-2 whitespace-nowrap">
            <button
              type="button"
              onClick={() => executePending()}
              disabled={pending.length === 0 || executing}
              className={`${TITLE_ROW_BTN_BASE} bg-blue-600 hover:bg-blue-500 border-[#60a5fa] text-white disabled:opacity-40 disabled:hover:bg-blue-600`}
            >
              {executing
                ? `执行中 ${executingQueue?.current ?? 0}/${executingQueue?.total ?? 0}`
                : `一键执行（${pending.length}）`}
            </button>
            {(pending.length > 0 || executingQueue) && (
              <div className="h-8 flex items-center gap-2 px-3 rounded-lg bg-[#1c1c22] border border-[#2e2e32]">
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
                      className="text-[8px] text-blue-400 hover:text-blue-300 font-medium ml-1 leading-none"
                    >
                      清空
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ),
      },
      {
        title: capabilityPresetViewMode === 'sets' ? '能力集合' : capabilityPresetViewMode === 'image_process' ? '图像处理' : '基础能力',
        desc: '当前能力配置与预设编辑',
        actions: (
          <div className="flex items-center gap-2 whitespace-nowrap">
            <div className="h-8 inline-flex items-center rounded-lg border border-[#2e2e32] bg-[#1c1c22] overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setCapabilityPresetViewMode('presets');
                  if (typeof window === 'undefined') return;
                  window.dispatchEvent(new CustomEvent('ac:capability-preset-view-mode', { detail: { mode: 'presets' } }));
                }}
                className={`h-8 px-3 text-[9px] font-black uppercase ${
                  capabilityPresetViewMode === 'presets'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-[#2e2e36]'
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
                className={`h-8 px-3 text-[9px] font-black uppercase border-l border-[#2e2e32] ${
                  capabilityPresetViewMode === 'image_process'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-[#2e2e36]'
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
                className={`h-8 px-3 text-[9px] font-black uppercase border-l border-[#2e2e32] ${
                  capabilityPresetViewMode === 'sets'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-[#2e2e36]'
                }`}
              >
                能力集合
              </button>
            </div>
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
    executePending,
    handleBatchUploadCorrect,
    importLibraryItemsIntoWorkflow,
    onOpenLibraryPicker,
    pending,
    selectedAssetIds,
    setArchiveHint,
    setArchivedDetailAssetId,
    setColumnCount,
    setPending,
    setSelectedAssetIds,
    setSelectedGroupItemKeys,
    setShowArchived,
    setViewStack,
    showArchived,
    visibleAssets,
    capabilityPresetViewMode,
    libraryFilter,
    snapWorkspacePaneToNode,
    outlineCollapsedIds,
    outlineExpandableGroupIds,
    expandOutlineAll,
    collapseOutlineAll,
    repositoryItems,
    libraryImportIds,
  ]);
  const topTitleGridStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (activePaneNode === 0) {
      return { gridTemplateColumns: `minmax(0, ${listPaneWidth}px) minmax(0, ${sidebarWidth}px)` };
    }
    if (activePaneNode === 1) {
      return { gridTemplateColumns: `minmax(0, ${sidebarWidth}px) minmax(0, ${listPaneWidth}px)` };
    }
    if (activePaneNode === 2) {
      return { gridTemplateColumns: `minmax(0, ${listPaneWidth}px) minmax(0, ${sidebarWidth}px)` };
    }
    if (activePaneNode === 3) {
      return { gridTemplateColumns: `minmax(0, ${sidebarWidth}px) minmax(0, ${presetPaneWidth}px)` };
    }
    return undefined;
  }, [activePaneNode, listPaneWidth, sidebarWidth, presetPaneWidth]);
  /** 四页 snap：0 仓(L)|纲(320) 1 纲(320)|工(L) 2 工|功 3 功|能 */
  const paneToOffsetPx = useCallback(
    (pane: number) => {
      const wh = sidebarWidth;
      const L = listPaneWidth;
      const p = Math.max(0, Math.min(3, pane));
      if (p <= 1) return p * L;
      if (p <= 2) return L + (p - 1) * wh;
      return L + wh + (p - 2) * L;
    },
    [listPaneWidth, sidebarWidth]
  );
  const offsetPxToPane = useCallback(
    (offset: number) => {
      const wh = sidebarWidth;
      const L = listPaneWidth;
      const maxOff = Math.max(0, wh + 2 * L);
      const x = Math.max(0, Math.min(maxOff, offset));
      if (x <= L) return L > 0 ? x / L : 0;
      if (x <= L + wh) return 1 + (x - L) / Math.max(1, wh);
      return 2 + (x - L - wh) / Math.max(1, L);
    },
    [listPaneWidth, sidebarWidth]
  );
  const applyWorkspacePaneImmediate = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(3, next));
      workspacePaneRef.current = clamped;
      const track = workspaceTrackRef.current;
      if (track) {
        track.style.transition = 'none';
        const offset = paneToOffsetPx(clamped);
        track.style.transform = `translate3d(${-offset}px, 0, 0)`;
      }
    },
    [paneToOffsetPx]
  );
  const handlePaneWheel = useCallback(
    (e: React.WheelEvent) => {
      const deltaPrimary = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      e.preventDefault();
      e.stopPropagation();
      if (Math.abs(deltaPrimary) < 2) return;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now < wheelLockUntilRef.current) return;
      wheelLockUntilRef.current = now + 180;
      // 离散切页：一次滚轮手势切一页
      const currentNode = Math.max(0, Math.min(3, Math.round(workspacePaneRef.current)));
      const dir = deltaPrimary > 0 ? 1 : -1;
      const targetNode = Math.max(0, Math.min(3, currentNode + dir));
      if (targetNode === currentNode) return;
      snapWorkspacePaneToNode(targetNode);
    },
    [snapWorkspacePaneToNode]
  );
  useEffect(() => {
    if (!registerPaneWheelHandler) return;
    registerPaneWheelHandler(handlePaneWheel);
    return () => registerPaneWheelHandler(null);
  }, [registerPaneWheelHandler, handlePaneWheel]);
  const workspaceOffsetPx = paneToOffsetPx(workspacePane);
  useEffect(() => {
    workspacePaneRef.current = workspacePane;
    const track = workspaceTrackRef.current;
    if (track) {
      track.style.transition = workspaceSnapping ? `transform ${WORKSPACE_SNAP_DURATION_MS}ms ${WORKSPACE_SNAP_EASING}` : 'none';
      track.style.transform = `translate3d(${-workspaceOffsetPx}px, 0, 0)`;
    }
  }, [workspacePane, workspaceOffsetPx, workspaceSnapping]);
  const getActiveWorkspaceScrollEl = useCallback((): HTMLDivElement | null => {
    const n = Math.round(workspacePane);
    if (n <= 0) return libraryScrollRef.current;
    if (n === 1) return outlineScrollRef.current;
    if (n === 2) return centerScrollRef.current;
    return presetScrollRef.current ?? centerScrollRef.current;
  }, [workspacePane]);
  useEffect(() => {
    if (!spacePanEnabled) return;
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target as Element | null;
      if (t?.closest('[data-ac-block-workflow-marquee]')) return;
      // 空格抓手为全局优先级：即便在按钮上也接管（输入框仍放行）
      if (isEditableTarget(e.target)) return;
      marqueeStartRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startOffset = paneToOffsetPx(workspacePane);
      let panStarted = false;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        if (!panStarted) {
            if (Math.abs(dx) < 2) return;
          panStarted = true;
          suppressClickAfterPanRef.current = true;
          setSpacePanDragging(true);
        }
        ev.preventDefault();
        const nextOffset = startOffset - dx;
        const next = offsetPxToPane(nextOffset);
          applyWorkspacePaneImmediate(next);
      };
      const onUp = () => {
          snapWorkspacePaneToNode();
        if (panStarted) setSpacePanDragging(false);
        window.removeEventListener('mousemove', onMove, true);
      };
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, { once: true, capture: true });
    };
    window.addEventListener('mousedown', onMouseDown, true);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      setSpacePanDragging(false);
    };
  }, [spacePanEnabled, workspacePane, isEditableTarget, paneToOffsetPx, offsetPxToPane, applyWorkspacePaneImmediate, snapWorkspacePaneToNode]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (spacePanEnabled) {
      document.body.style.cursor = spacePanDragging ? 'grabbing' : 'grab';
    } else {
      document.body.style.cursor = '';
    }
    return () => {
      document.body.style.cursor = '';
    };
  }, [spacePanEnabled, spacePanDragging]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (isEditableTarget(e.target)) return;
      if (typeof document !== 'undefined' && document.querySelector('[data-ac-block-workflow-marquee]')) return;
      e.preventDefault();
      setSpacePanEnabled(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      setSpacePanEnabled(false);
      setSpacePanDragging(false);
    };
    const onBlur = () => {
      setSpacePanEnabled(false);
      setSpacePanDragging(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [isEditableTarget]);

  /** 数字行 1–4、0：快速对齐到四档页面（与滑条圆点一致）；0 为最右档 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (isEditableTarget(e.target)) return;
      if (typeof document !== 'undefined' && document.querySelector('[data-ac-block-workflow-marquee]')) return;

      const paneByCode: Record<string, number> = {
        Digit1: 0,
        Digit2: 1,
        Digit3: 2,
        Digit4: 3,
        Digit0: 3,
        Numpad1: 0,
        Numpad2: 1,
        Numpad3: 2,
        Numpad4: 3,
        Numpad0: 3,
      };
      const pane = paneByCode[e.code];
      if (pane === undefined) return;
      e.preventDefault();
      snapWorkspacePaneToNode(pane);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isEditableTarget, snapWorkspacePaneToNode]);

  const renderWorkflowSidebarColumn = ({
    wide,
    variant = 'dock',
  }: {
    wide?: boolean;
    /** dock=工作区右侧栏；splitLeft=能力页左栏（与预设并排，占满列高） */
    variant?: 'dock' | 'splitLeft';
  }) => (
    <div
      data-workflow-sidebar
      className={
        variant === 'splitLeft'
          ? 'w-full min-h-0 flex-1 flex flex-col gap-3 overflow-y-auto no-scrollbar'
          : wide
            ? 'w-full min-h-0 flex flex-col gap-3 overflow-y-auto no-scrollbar shrink-0 max-h-[min(52vh,520px)]'
            : 'w-80 shrink-0 min-h-0 flex-1 flex flex-col gap-3 overflow-y-auto no-scrollbar'
      }
    >
          <WorkflowPlannerBar
            actionModules={actionModules}
            selectedAssetId={selectedAssetIds.size > 0 ? [...selectedAssetIds][0]! : null}
            onAddToQueue={(presetId) => {
              const aid = selectedAssetIds.size > 0 ? [...selectedAssetIds][0]! : null;
              if (aid) addToPending(aid, presetId);
            }}
            onLog={onLog}
          />

          <div className="grid grid-cols-5 gap-2">
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
            title="将选中图片拖入建组（组内同效）"
            className={`rounded-xl border-2 border-dashed h-[52px] px-1 flex flex-col items-center justify-center text-center transition-colors ${
              dragOverAction === '__group__'
                ? 'border-blue-500 bg-[#152642]'
                : 'border-[#3d4754] bg-[#0e0f12] hover:border-[#4b6a9e] hover:bg-[#1a1d26]'
            }`}
          >
            <svg viewBox="0 0 20 20" className="w-3 h-3 text-gray-400 mb-0.5" aria-hidden>
              <path d="M3 4h6v5H3zM11 4h6v5h-6zM3 11h6v5H3zM11 11h6v5h-6z" fill="currentColor" />
            </svg>
            <span className="text-[8px] font-black uppercase text-gray-200">组</span>
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
            title="将组内子卡片拖到此处，移到上一级"
            className={`rounded-xl border-2 border-dashed h-[52px] px-1 flex flex-col items-center justify-center text-center transition-colors ${
              dragOverAction === '__ungroup__'
                ? 'border-blue-500 bg-[#152642]'
                : 'border-[#3d4754] bg-[#0e0f12] hover:border-[#4b6a9e] hover:bg-[#1a1d26]'
            }`}
          >
            <svg viewBox="0 0 20 20" className="w-3 h-3 text-gray-400 mb-0.5" aria-hidden>
              <path d="M7 5h10v10H7zM3 9l4-4v3h5v2H7v3z" fill="currentColor" />
            </svg>
            <span className="text-[8px] font-black uppercase text-gray-200">移出组</span>
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
            title="拖入后在当前位置复制一份"
            className={`rounded-xl border-2 border-dashed h-[52px] px-1 flex flex-col items-center justify-center text-center transition-colors ${
              dragOverAction === '__copy__'
                ? 'border-blue-500 bg-[#152642]'
                : 'border-[#3d4754] bg-[#0e0f12] hover:border-[#4b6a9e] hover:bg-[#1a1d26]'
            }`}
          >
            <svg viewBox="0 0 20 20" className="w-3 h-3 text-gray-400 mb-0.5" aria-hidden>
              <path d="M6 6h9v10H6zM4 4h9v1H5v9H4z" fill="currentColor" />
            </svg>
            <span className="text-[8px] font-black uppercase text-gray-200">复制</span>
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
            title="将图片拖到此处从工作流中删除（组内同效）"
            className={`rounded-xl border-2 border-dashed h-[52px] px-1 flex flex-col items-center justify-center text-center transition-colors ${
              dragOverAction === '__delete__'
                ? 'border-red-500 bg-[#3a1818]'
                : 'border-[#3d4754] bg-[#0e0f12] hover:border-[#b85454] hover:bg-[#1f1416]'
            }`}
          >
            <svg viewBox="0 0 20 20" className="w-3 h-3 text-red-300 mb-0.5" aria-hidden>
              <path d="M6 6h8l-.6 10H6.6L6 6zm2-2h4l1 1h3v2H4V5h3l1-1z" fill="currentColor" />
            </svg>
            <span className="text-[8px] font-black uppercase text-red-400">删除</span>
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
            title="将图片拖到此处标记为已完成（组内同效）"
            className={`rounded-xl border-2 border-dashed h-[52px] px-1 flex flex-col items-center justify-center text-center transition-colors ${
              dragOverAction === '__archive__'
                ? 'border-blue-500 bg-[#152642]'
                : 'border-[#3d4754] bg-[#0e0f12] hover:border-[#4b6a9e] hover:bg-[#1a1d26]'
            }`}
          >
            <svg viewBox="0 0 20 20" className="w-3 h-3 text-gray-400 mb-0.5" aria-hidden>
              <path d="M4 4h12v3H4zM5 8h10v8H5zM8 10h4v2H8z" fill="currentColor" />
            </svg>
            <span className="text-[8px] font-black uppercase text-gray-200">归档</span>
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
                    if (draggingActionIdRef.current) setActionDroppedInFavorite(true);
                  }}
                  onDragOver={(e) => {
                    if (!draggingActionIdRef.current && !dragTransferHasPlainText(e)) return;
                    e.preventDefault();
                    try {
                      e.dataTransfer.dropEffect = 'copy';
                    } catch {
                      /* ignore */
                    }
                    setFavoriteDropActive(true);
                  }}
                  onDragLeave={(ev) => {
                    const next = ev.relatedTarget as Node | null;
                    if (next && ev.currentTarget.contains(next)) return;
                    setFavoriteDropActive(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setFavoriteDropActive(false);
                    let id = draggingActionIdRef.current;
                    if (!id) {
                      try {
                        id = e.dataTransfer.getData('text/plain') || null;
                      } catch {
                        /* ignore */
                      }
                    }
                    if (!id?.trim()) return;
                    const validFavoriteId =
                      actionModules.some((m) => m.id === id) ||
                      (id.startsWith(SET_ACTION_PREFIX) &&
                        capabilitySets.some((s) => s.id === id.slice(SET_ACTION_PREFIX.length)));
                    if (!validFavoriteId) return;
                    setFavoriteActionIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
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
                          data-capability-hover-id={entry.kind === 'module' ? entry.mod?.id : undefined}
                          className={`rounded-xl border-2 border-dashed min-h-[60px] flex transition-colors ${
                            dragOverAction === entry.id
                              ? 'border-blue-500 bg-[#1a3354]'
                              : dragOverAction === entry.id + '__tweak'
                                ? 'border-[#4b6a9e] bg-[#1e3558] ring-1 ring-[#3b82f6]'
                                : 'border-[#3a3a40] bg-[#1c1c22] hover:border-[#484850]'
                          }`}
                          draggable
                          onMouseEnter={(e) => {
                            if (entry.kind !== 'module' || !entry.mod) return;
                            setHoverPreview({ mod: entry.mod, x: e.clientX, y: e.clientY });
                          }}
                          onMouseMove={(e) => {
                            if (entry.kind !== 'module' || !entry.mod) return;
                            setHoverPreview((prev) =>
                              prev && prev.mod.id === entry.mod!.id
                                ? { ...prev, x: e.clientX, y: e.clientY }
                                : { mod: entry.mod, x: e.clientX, y: e.clientY }
                            );
                          }}
                          onMouseLeave={() => setHoverPreview((prev) => (prev?.mod.id === entry.id ? null : prev))}
                          onDragStart={(e) => {
                            try {
                              e.dataTransfer.setData('text/plain', entry.id);
                              e.dataTransfer.effectAllowed = 'copyMove';
                            } catch {
                              /* ignore */
                            }
                            updateDraggingActionId(entry.id);
                            setDraggingActionFromFavorite(true);
                            setActionDroppedInFavorite(false);
                          }}
                          onDragEnd={() => {
                            if (draggingActionFromFavorite && !actionDroppedInFavorite) {
                              removeActionFromFavorite(entry.id);
                            }
                            updateDraggingActionId(null);
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
                            onMouseEnter={(e) => {
                              if (entry.kind !== 'module' || !entry.mod) return;
                              setHoverPreview({ mod: entry.mod, x: e.clientX, y: e.clientY });
                            }}
                            onMouseMove={(e) => {
                              if (entry.kind !== 'module' || !entry.mod) return;
                              setHoverPreview((prev) =>
                                prev && prev.mod.id === entry.mod!.id
                                  ? { ...prev, x: e.clientX, y: e.clientY }
                                  : { mod: entry.mod, x: e.clientX, y: e.clientY }
                              );
                            }}
                            onMouseLeave={() => setHoverPreview((prev) => (prev?.mod.id === entry.id ? null : prev))}
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
                              className={`w-11 shrink-0 flex flex-col items-center justify-center rounded-r-lg transition-colors cursor-pointer ${
                                dragOverAction === entry.id + '__tweak'
                                  ? 'bg-[#223d5c] border-l border-[#5080c0]'
                                  : 'bg-[#1c1c22] border-l border-[#2e2e32] hover:bg-[#2e2e36]'
                              }`}
                              title="拖到此处可微调提示词后加入队列；点击前往能力页调整预设"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (entry.kind === 'module' && entry.mod) jumpToCapabilityPreset(entry.mod);
                              }}
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
                              <span className="text-[10px] text-blue-400 font-bold" title="微调提示词">词</span>
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
                        data-capability-hover-id={mod.id}
                        className={`rounded-xl border-2 border-dashed min-h-[60px] flex transition-colors ${
                          dragOverAction === mod.id
                            ? 'border-blue-500 bg-[#1a3354]'
                            : dragOverAction === mod.id + '__tweak'
                              ? 'border-[#4b6a9e] bg-[#1e3558] ring-1 ring-[#3b82f6]'
                              : 'border-[#3a3a40] bg-[#1c1c22] hover:border-[#484850]'
                        }`}
                        draggable
                        onMouseEnter={(e) => setHoverPreview({ mod, x: e.clientX, y: e.clientY })}
                        onMouseMove={(e) =>
                          setHoverPreview((prev) =>
                            prev && prev.mod.id === mod.id
                              ? { ...prev, x: e.clientX, y: e.clientY }
                              : { mod, x: e.clientX, y: e.clientY }
                          )
                        }
                        onMouseLeave={() => setHoverPreview((prev) => (prev?.mod.id === mod.id ? null : prev))}
                        onDragStart={(e) => {
                          try {
                            e.dataTransfer.setData('text/plain', mod.id);
                            e.dataTransfer.effectAllowed = 'copyMove';
                          } catch {
                            /* ignore */
                          }
                          updateDraggingActionId(mod.id);
                          setDraggingActionFromFavorite(false);
                          setActionDroppedInFavorite(false);
                        }}
                        onDragEnd={() => {
                          updateDraggingActionId(null);
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
                          onMouseEnter={(e) => setHoverPreview({ mod, x: e.clientX, y: e.clientY })}
                          onMouseMove={(e) =>
                            setHoverPreview((prev) =>
                              prev && prev.mod.id === mod.id
                                ? { ...prev, x: e.clientX, y: e.clientY }
                                : { mod, x: e.clientX, y: e.clientY }
                            )
                          }
                          onMouseLeave={() => setHoverPreview((prev) => (prev?.mod.id === mod.id ? null : prev))}
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
                            className={`w-11 shrink-0 flex flex-col items-center justify-center rounded-r-lg transition-colors cursor-pointer ${
                              dragOverAction === mod.id + '__tweak'
                                ? 'bg-[#223d5c] border-l border-[#5080c0]'
                                : 'bg-[#1c1c22] border-l border-[#2e2e32] hover:bg-[#2e2e36]'
                            }`}
                            title="拖到此处可微调提示词后加入队列；点击前往能力页调整预设"
                            onClick={(e) => {
                              e.stopPropagation();
                              jumpToCapabilityPreset(mod);
                            }}
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
                            <span className="text-[10px] text-blue-400 font-bold" title="微调提示词">词</span>
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
                  onDragStart={(e) => {
                    try {
                      e.dataTransfer.setData('text/plain', mod.id);
                      e.dataTransfer.effectAllowed = 'copyMove';
                    } catch {
                      /* ignore */
                    }
                    updateDraggingActionId(mod.id);
                    setDraggingActionFromFavorite(false);
                    setActionDroppedInFavorite(false);
                  }}
                  onDragEnd={() => {
                    updateDraggingActionId(null);
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
                      className={`w-11 shrink-0 flex flex-col items-center justify-center rounded-r-lg transition-colors cursor-pointer ${
                        dragOverAction === mod.id + '__tweak'
                          ? 'bg-[#223d5c] border-l border-[#5080c0]'
                          : 'bg-[#1c1c22] border-l border-[#2e2e32] hover:bg-[#2e2e36]'
                      }`}
                      title="拖到此处可微调提示词后加入队列；点击前往能力页调整预设"
                      onClick={(e) => {
                        e.stopPropagation();
                        jumpToCapabilityPreset(mod);
                      }}
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
                      <span className="text-[10px] text-blue-400 font-bold" title="微调提示词">词</span>
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
                      onDragStart={(e) => {
                        try {
                          e.dataTransfer.setData('text/plain', setActionId);
                          e.dataTransfer.effectAllowed = 'copyMove';
                        } catch {
                          /* ignore */
                        }
                        updateDraggingActionId(setActionId);
                        setDraggingActionFromFavorite(false);
                        setActionDroppedInFavorite(false);
                      }}
                      onDragEnd={() => {
                        updateDraggingActionId(null);
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
  );
  return (
    <div className="flex flex-col min-h-[400px] h-[calc(100dvh-6rem)] gap-4">
      <div className="flex flex-col flex-1 min-h-0 gap-4 min-w-0">
      <div className="flex flex-col items-stretch gap-2 shrink-0 px-0.5">
        <div
          className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-2 shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
          onWheelCapture={handlePaneWheel}
        >
          <div className="flex items-center gap-2 min-h-5 rounded-lg px-2 py-0.5">
            <span className="text-[8px] font-black uppercase text-gray-600/80 w-7 shrink-0 text-right">仓库</span>
            <div className="relative flex-1 min-h-5 flex items-center">
              {/* 圆点必须在滑条之上：原生 range 整块可点区域会盖住下层；pointer-events-none 让操作仍落在 input 上 */}
              <input
                type="range"
                min={0}
                max={3}
                step={0.01}
                value={workspacePane}
                onChange={(e) => setWorkspacePaneRaf(Number(e.target.value))}
                onMouseUp={() => snapWorkspacePaneToNode(workspacePaneRef.current)}
                onTouchEnd={() => snapWorkspacePaneToNode(workspacePaneRef.current)}
                onKeyUp={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
                    snapWorkspacePaneToNode(workspacePaneRef.current);
                  }
                }}
                className="relative z-10 w-full h-1 rounded-full appearance-none cursor-pointer bg-white/[0.05] accent-blue-400/65 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/35
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-1.5 [&::-webkit-slider-thumb]:w-1.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-400/80 [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-white/10 [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(59,130,246,0.08)]
                [&::-moz-range-thumb]:h-1.5 [&::-moz-range-thumb]:w-1.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-400/80 [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-white/10"
                aria-valuemin={0}
                aria-valuemax={3}
                aria-valuenow={workspacePane}
                aria-label="页面：仓库与大纲、大纲与工作区、工作区与功能区、功能区与能力。快捷键 1–4、0 切换"
              />
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center" aria-hidden>
                {(() => {
                  /** 与 [&::-webkit-slider-thumb]:w-1.5 / h-1.5（6px）一致；拇指中心在轨道内为线性内缩，非 0%~100% 贴边 */
                  const thumbPx = 6;
                  const thumbR = thumbPx / 2;
                  /** 当前值与该档距离小于此阈值时隐藏白点，避免叠在蓝拇指上露边 */
                  const hideDotNearThumb = 0.13;
                  return [0, 1, 2, 3].map((i) => {
                    const hiddenByThumb = Math.abs(workspacePane - i) < hideDotNearThumb;
                    return (
                      <span
                        key={i}
                        className={`absolute top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.18] shadow-[0_0_0_1px_rgba(0,0,0,0.35)] transition-opacity duration-150 ${
                          hiddenByThumb ? 'opacity-0' : 'opacity-100'
                        }`}
                        style={{
                          left: `calc(${thumbR}px + (100% - ${thumbPx}px) * ${i / 3})`,
                        }}
                      />
                    );
                  });
                })()}
              </div>
            </div>
            <span className="text-[8px] font-black uppercase text-gray-600/80 w-7 shrink-0">能力</span>
          </div>
          <div
            className={`mt-1 grid gap-2 border-t border-white/[0.06] pt-1.5 ${topTitleColumns.length > 1 ? 'grid-cols-2 divide-x divide-white/[0.05]' : 'grid-cols-1'}`}
            style={topTitleColumns.length > 1 ? topTitleGridStyle : undefined}
          >
            {topTitleColumns.map((item) => (
              <div key={item.title} className={SECTION_HEADER_CLASS}>
                <div className="flex items-center gap-2">
                  <div className={`${SECTION_TITLE_CLASS} shrink-0`}>{item.title}</div>
                  {item.actions ? (
                    <div className="min-w-0 flex-1 flex flex-wrap items-center gap-2 justify-end overflow-x-auto no-scrollbar">
                      {item.actions}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden min-w-0">
        <div
          ref={workspaceViewportRef}
          className={`flex-1 min-h-0 overflow-hidden ${spacePanEnabled ? (spacePanDragging ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
          onClickCapture={(e) => {
            if (!suppressClickAfterPanRef.current) return;
            suppressClickAfterPanRef.current = false;
            e.preventDefault();
            e.stopPropagation();
          }}
          onTouchStart={(e) => {
            workspaceSwipeTouchX.current = e.touches[0]?.clientX ?? 0;
            workspaceSwipeStartOffsetPx.current = paneToOffsetPx(workspacePane);
          }}
          onTouchMove={(e) => {
            const x = e.touches[0]?.clientX ?? workspaceSwipeTouchX.current;
            const dx = x - workspaceSwipeTouchX.current;
            const nextOffset = workspaceSwipeStartOffsetPx.current - dx;
            const next = offsetPxToPane(nextOffset);
            applyWorkspacePaneImmediate(next);
          }}
          onTouchEnd={() => {
            snapWorkspacePaneToNode();
          }}
        >
          <div
            ref={workspaceTrackRef}
            className="flex h-full will-change-transform motion-reduce:transition-none"
            style={{ width: `${trackTotalWidth}px`, transform: `translate3d(${-workspaceOffsetPx}px, 0, 0)` }}
          >
        <div className="h-full min-h-0 shrink-0 flex flex-col pr-3 border-r border-white/[0.06]" style={{ width: `${listPaneWidth}px` }}>
          <div ref={libraryScrollRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
            {repositoryItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-gray-600 gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider">暂无资产</span>
                <span className="text-[8px] text-gray-600">对话与其它入口生成的图会进入资产库</span>
              </div>
            ) : (
              <div className="p-6 min-w-0">
                <div className="gap-4 relative" style={{ columnCount, columnFill: 'balance' as const }}>
                  {repositoryItems.map((item) => (
                    <div key={item.id} className="break-inside-avoid mb-6 relative">
                      <div
                        data-workflow-library-card
                        ref={(el) => {
                          if (el) libraryCardRefs.current.set(item.id, el);
                          else libraryCardRefs.current.delete(item.id);
                        }}
                        draggable
                        onDragStart={(e) => {
                          try {
                            e.dataTransfer.setData(DT_AC_LIBRARY_ITEM_ID, item.id);
                            e.dataTransfer.effectAllowed = 'copy';
                          } catch {
                            /* ignore */
                          }
                        }}
                        className={`group relative rounded-2xl border overflow-hidden bg-[#16161a] transition-colors ${
                          libraryImportIds.has(item.id)
                            ? 'border-blue-500 ring-2 ring-blue-500/50'
                            : 'border-[#2e2e32]'
                        }`}
                      >
                        <div
                          className="relative cursor-pointer"
                          role="presentation"
                          onClick={() => {
                            setLibraryImportIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            });
                          }}
                        >
                          <div className="relative w-full bg-[#141416] flex justify-center" style={{ aspectRatio: 1 }}>
                            <WorkflowGridImage
                              fullSrc={item.data}
                              cacheKey={`lib:${item.id}`}
                              className="relative w-full h-full flex justify-center bg-[#141416]"
                              imgClassName="w-full h-full object-contain"
                              draggable={false}
                              onDragStart={(ev) => ev.preventDefault()}
                            />
                            {libraryImportIds.has(item.id) && (
                              <div className="absolute top-2 right-2 w-6 h-6 rounded-lg border border-blue-400/80 bg-[#18181c] flex items-center justify-center text-[11px] text-blue-300 shadow-lg">
                                ✓
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="p-2 flex flex-col gap-1 border-t border-[#252528]">
                          <span className="text-[9px] font-black text-gray-300 truncate">{item.label?.trim() || '未命名'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          data-workflow-outline
          className="h-full min-h-0 shrink-0 flex flex-col border-r border-white/[0.06] pr-2 min-w-0"
          style={{ width: `${sidebarWidth}px` }}
        >
          <div ref={outlineScrollRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-0.5 px-1 pt-2 pb-2">
            {activePaneNode === 0 ? (
              repositoryItems.length === 0 ? (
                <div className="text-[9px] text-gray-600 py-6 text-center leading-relaxed">
                  暂无资产 · 与左侧筛选一致
                </div>
              ) : (
                repositoryOutlineRows
              )
            ) : visibleAssets.length === 0 ? (
              <div className="text-[9px] text-gray-600 py-6 text-center leading-relaxed">暂无资产 · 导入或生成后将显示在此</div>
            ) : (
              outlineTreeRows
            )}
          </div>
          {(activePaneNode === 0 || activePaneNode === 1) && (
            <div
              data-workflow-outline-footer
              className="shrink-0 border-t border-white/[0.06] pt-2 pb-2 px-1 bg-[#0a0a0c]/95"
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOutlineFooterDropOver(null);
              }}
            >
              {activePaneNode === 0 ? (
                <div
                  className={`min-h-[5.75rem] rounded-xl border border-dashed px-3 py-3 flex flex-col items-center justify-center gap-1.5 transition-colors ${
                    outlineFooterDropOver === 'toWorkspace'
                      ? 'border-blue-400 bg-blue-950/45'
                      : 'border-white/15 bg-[#0f0f12]'
                  }`}
                  onDragEnter={(e) => {
                    if (Array.from(e.dataTransfer.types).includes(DT_AC_LIBRARY_ITEM_ID)) {
                      setOutlineFooterDropOver('toWorkspace');
                    }
                  }}
                  onDragOver={(e) => {
                    if (!Array.from(e.dataTransfer.types).includes(DT_AC_LIBRARY_ITEM_ID)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(e) => {
                    setOutlineFooterDropOver(null);
                    handleOutlineDropToWorkspace(e);
                  }}
                >
                  <p className="text-[8px] text-gray-500 text-center leading-snug">
                    从左侧仓库或上方列表拖入条目
                  </p>
                  <span className="text-[9px] font-black uppercase text-blue-200/90">放到工作区</span>
                </div>
              ) : (
                <div
                  className={`min-h-[5.75rem] rounded-xl border border-dashed px-3 py-3 flex flex-col items-center justify-center gap-1.5 transition-colors ${
                    outlineFooterDropOver === 'toLibrary'
                      ? 'border-blue-400 bg-blue-950/45'
                      : 'border-white/15 bg-[#0f0f12]'
                  }`}
                  onDragEnter={(e) => {
                    if (Array.from(e.dataTransfer.types).includes(DT_AC_WORKFLOW_EXPORT)) {
                      setOutlineFooterDropOver('toLibrary');
                    }
                  }}
                  onDragOver={(e) => {
                    if (!Array.from(e.dataTransfer.types).includes(DT_AC_WORKFLOW_EXPORT)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(e) => {
                    setOutlineFooterDropOver(null);
                    handleOutlineDropToLibrary(e);
                  }}
                >
                  <p className="text-[8px] text-gray-500 text-center leading-snug">
                    从画布卡片或上方大纲拖入资产
                  </p>
                  <span className="text-[9px] font-black uppercase text-blue-200/90">放到仓库</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 min-h-0 h-full flex flex-col shrink-0" style={{ width: `${listPaneWidth}px` }}>
        <div
          ref={centerScrollRef}
          className="flex-1 min-w-0 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-3 rounded-xl transition-colors"
          onDragOver={(e) => {
            if (!hasImageFileTransfer(e.dataTransfer)) return;
            e.preventDefault();
          }}
          tabIndex={0}
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
                  ? showAllImages.map((img, idx) => {
                      const gallKey = `gall:${currentGroupAsset?.id ?? 'x'}:${idx}`;
                      return (
                        <div
                          key={idx}
                          data-workflow-card
                          className="break-inside-avoid mb-4 rounded-2xl border border-[#2e2e32] bg-[#141416] overflow-hidden flex justify-center"
                        >
                          <div
                            className="relative w-full bg-[#141416] flex justify-center"
                            style={{ aspectRatio: `${cardAspectByAssetId[gallKey] ?? 1}` }}
                          >
                            <WorkflowGridImage
                              fullSrc={img}
                              cacheKey={gallKey}
                              className="relative z-0 block w-full h-full min-h-[5rem]"
                              imgClassName="relative z-0 block w-full h-full object-contain"
                              draggable={false}
                              onDragStart={(e) => e.preventDefault()}
                              onIntrinsicSize={(w, h) => {
                                setCardAspectByAssetId((prev) => {
                                  if (prev[gallKey] != null) return prev;
                                  const ratio = Math.max(0.5, Math.min(2, w / h));
                                  return { ...prev, [gallKey]: ratio };
                                });
                              }}
                            />
                          </div>
                        </div>
                      );
                    })
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
                              const cRaw = groupPreviewIndexById[childAsset.id] ?? 0;
                              const cGLen = childAsset.cutImageGroup?.length ?? 0;
                              const cSafe = cGLen ? ((cRaw % cGLen) + cGLen) % cGLen : 0;
                              const childGridPreviewSrc = !childAsset.cutImageGroup?.length
                                ? img
                                : (() => {
                                    const groupItems = childAsset.cutImageGroup!;
                                    const itemInGroup = groupItems[cSafe] ?? groupItems[0];
                                    if (typeof itemInGroup === 'string') return itemInGroup;
                                    if (itemInGroup && typeof itemInGroup === 'object' && 'r2Key' in itemInGroup)
                                      return childAsset.original;
                                    const nestedId =
                                      itemInGroup && typeof itemInGroup === 'object' && 'assetId' in itemInGroup
                                        ? (itemInGroup as { assetId: string }).assetId
                                        : '';
                                    const nestedChild = nestedId ? assets.find((x) => x.id === nestedId) : undefined;
                                    return nestedChild ? getAssetDisplayImage(nestedChild) : img;
                                  })();
                              const childGridCacheKey = childAsset.cutImageGroup?.length
                                ? `${childAsset.id}:${childAsset.displayKey}:g${cSafe}`
                                : `${childAsset.id}:${childAsset.displayKey}`;
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
                                    <div
                                      className="relative w-full bg-[#141416] flex justify-center"
                                      style={{ aspectRatio: `${cardAspectByAssetId[childAsset.id] ?? 1}` }}
                                    >
                                      <WorkflowGridImage
                                        fullSrc={childGridPreviewSrc}
                                        cacheKey={childGridCacheKey}
                                        className="relative z-0 block w-full h-full min-h-[5rem]"
                                        imgClassName="relative z-0 block w-full h-full object-contain"
                                        draggable={false}
                                        onDragStart={(e) => e.preventDefault()}
                                        onIntrinsicSize={(w, h) => {
                                          setCardAspectByAssetId((prev) => {
                                            if (prev[childAsset.id] != null) return prev;
                                            const ratio = Math.max(0.5, Math.min(2, w / h));
                                            return { ...prev, [childAsset.id]: ratio };
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
                            <div
                              className="relative w-full bg-[#141416] flex justify-center"
                              style={{ aspectRatio: `${cardAspectByAssetId[groupKey] ?? 1}` }}
                            >
                              <WorkflowGridImage
                                fullSrc={img}
                                cacheKey={`gstr:${currentGroupAsset?.id ?? 'x'}:${idx}`}
                                className="relative z-0 block w-full h-full min-h-[5rem]"
                                imgClassName="relative z-0 block w-full h-full object-contain"
                                draggable={false}
                                onDragStart={(e) => e.preventDefault()}
                                onIntrinsicSize={(w, h) => {
                                  setCardAspectByAssetId((prev) => {
                                    if (prev[groupKey] != null) return prev;
                                    const ratio = Math.max(0.5, Math.min(2, w / h));
                                    return { ...prev, [groupKey]: ratio };
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
                  const cardAspect = cardAspectByAssetId[a.id] ?? 1;
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
                  const rawG = groupPreviewIndexById[a.id] ?? 0;
                  const gLen = a.cutImageGroup?.length ?? 0;
                  const gSafe = gLen ? ((rawG % gLen) + gLen) % gLen : 0;
                  const gridPreviewSrc = !a.cutImageGroup?.length
                    ? getAssetDisplayImage(a)
                    : (() => {
                        const groupItems = a.cutImageGroup!;
                        const item = groupItems[gSafe] ?? groupItems[0];
                        if (typeof item === 'string') return item;
                        const child = assets.find((x) => x.id === item.assetId);
                        return child ? getAssetDisplayImage(child) : getAssetDisplayImage(a);
                      })();
                  const gridPreviewCacheKey = a.cutImageGroup?.length
                    ? `${a.id}:${a.displayKey}:g${gSafe}`
                    : `${a.id}:${a.displayKey}`;

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
                        onDragStart={(e) => {
                          if (showArchived || isBusy) return;
                          const ids =
                            selectedAssetIds.has(a.id) && selectedAssetIds.size > 0
                              ? Array.from(selectedAssetIds)
                              : [a.id];
                          setDraggingAssetIds(ids);
                          try {
                            const payload: AcWorkflowExportPayload = { mode: 'roots', assetIds: ids };
                            e.dataTransfer.setData(DT_AC_WORKFLOW_EXPORT, JSON.stringify(payload));
                            e.dataTransfer.effectAllowed = 'copyMove';
                          } catch {
                            /* ignore */
                          }
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
                          <div className="relative w-full bg-[#141416] flex justify-center" style={{ aspectRatio: `${cardAspect}` }}>
                            <WorkflowGridImage
                              fullSrc={gridPreviewSrc}
                              cacheKey={gridPreviewCacheKey}
                              className="relative z-0 block w-full h-full min-h-[5rem]"
                              imgClassName="relative z-0 block w-full h-full object-contain"
                              draggable={false}
                              onDragStart={(e) => e.preventDefault()}
                              onIntrinsicSize={(w, h) => {
                                setCardAspectByAssetId((prev) => {
                                  if (prev[a.id] != null) return prev;
                                  const ratio = Math.max(0.5, Math.min(2, w / h));
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
        {marqueeActive && (marqueePaneRef.current === 0 || !showArchived) && typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={marqueeOverlayElRef}
              className="fixed pointer-events-none z-[150] rounded-[3px] border-2 border-solid border-[#4570b0] bg-[#121a28]/50 shadow-[inset_0_0_0_1px_rgba(69,112,176,0.2)]"
              style={{ left: 0, top: 0, width: 0, height: 0 }}
            />,
            document.body
          )}
        </div>
        <div className="h-full min-h-0 shrink-0 flex flex-col min-w-0" style={{ width: `${sidebarWidth}px` }}>
          {renderWorkflowSidebarColumn({})}
        </div>

        {/* 右侧：能力预设列 */}
        <div className={`h-full min-h-0 shrink-0 flex flex-col overflow-hidden border-l border-white/[0.06] pl-4`} style={{ width: `${presetPaneWidth}px` }}>
          {capabilityPresetPanel ? (
            <div
              data-workflow-preset
              className="flex flex-col flex-1 min-h-0 overflow-hidden rounded-xl border border-white/[0.06] bg-[#0a0a0c] p-2"
            >
              {cloneCapabilityPresetPanelWithScrollRef(capabilityPresetPanel, presetScrollRef)}
            </div>
          ) : (
            <div className="flex-1 min-h-0 rounded-xl border border-dashed border-white/10 bg-white/[0.02] flex items-center justify-center text-[9px] text-gray-600">
              未挂载能力预设
            </div>
          )}
        </div>
          </div>
        </div>
      </div>
      </div>

      {/* 进行中：大图弹窗（与对话临时库预览一致：全屏画布、滚轮切资产、缩放平移） */}
      {lightboxAsset && !showArchived && (
        <ImagePreviewOverlay
          open
          resetKey={lightboxAsset.id}
          imageSrc={workflowSafeImgSrc(getAssetDisplayImage(lightboxAsset))}
          onClose={() => setLightboxAssetId(null)}
          wheelListLength={lightboxList.length}
          onWheelNavigate={handleLightboxWheelNavigate}
          innerWheelOptionCount={getDisplayKeysForAsset(lightboxAsset).length}
          onWheelInnerNavigate={handleLightboxWheelCycleDisplay}
          innerLayoutStableKey={lightboxAsset.id}
          layoutReferenceSrc={
            asWorkflowImageString(lightboxAsset.original).trim()
              ? workflowSafeImgSrc(lightboxAsset.original)
              : undefined
          }
        >
          <div
            className="absolute left-4 right-4 bottom-4 z-10 max-h-[42vh] overflow-y-auto rounded-xl bg-[#121214]/95 border border-[#2e2e32] p-3 sm:p-4 space-y-3"
            data-image-preview-no-wheel
            data-image-preview-scroll
          >
            <div className="flex flex-wrap gap-1.5 justify-center items-center">
              <span className="text-[8px] font-black text-gray-500 uppercase mr-1">显示</span>
              <button
                type="button"
                onClick={() => setDisplayKey(lightboxAsset.id, 'original')}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${lightboxAsset.displayKey === 'original' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#26262c] border-[#3a3a40] hover:bg-[#383842]'}`}
              >
                原始
              </button>
              {lightboxAsset.cutImageGroup?.length ? (
                <button
                  type="button"
                  onClick={() => setDisplayKey(lightboxAsset.id, 'cut_image')}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${lightboxAsset.displayKey === 'cut_image' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#26262c] border-[#3a3a40] hover:bg-[#383842]'}`}
                >
                  切割
                </button>
              ) : null}
              {(lightboxAsset.resultOrder || []).map((k) => {
                if (baseActionId(k) === 'cut_image') return null;
                const mod = getModule(baseActionId(k));
                const label = mod?.label ?? baseActionId(k);
                if (!lightboxAsset.results?.[k]) return null;
                return (
                  <button
                    type="button"
                    key={k}
                    onClick={() => setDisplayKey(lightboxAsset.id, k)}
                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${lightboxAsset.displayKey === k ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#26262c] border-[#3a3a40] hover:bg-[#383842]'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
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
                  type="button"
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
              <div className="flex justify-center gap-2 items-center flex-wrap">
                <button type="button" onClick={() => goLightbox(-1)} className="px-3 py-1 rounded-lg bg-[#26262c] text-[9px] font-black">
                  上一张
                </button>
                <span className="text-[9px] text-gray-500">
                  {lightboxIndex + 1} / {lightboxList.length}
                </span>
                <button type="button" onClick={() => goLightbox(1)} className="px-3 py-1 rounded-lg bg-[#26262c] text-[9px] font-black">
                  下一张
                </button>
              </div>
            )}
          </div>
        </ImagePreviewOverlay>
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
