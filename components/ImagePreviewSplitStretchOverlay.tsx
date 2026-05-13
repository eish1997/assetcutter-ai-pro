import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  clientPointToElementLocal,
  getImgObjectContainMetrics,
} from '../services/imagePreviewPointerGeometry';
import { drawSplitPreview, type SplitStretchRasterState } from '../services/imagePreviewSplitStretchDraw';

const LINE_FRAC_MIN = 0.03;
const LINE_FRAC_MAX = 0.97;
const UNDO_EPS = 0.004;

export type ImagePreviewSplitStretchExportState = SplitStretchRasterState;

export type ImagePreviewSplitStretchOverlayProps = {
  imgRef: React.RefObject<HTMLImageElement | null>;
  /** 为真时绘制预览与手柄；为假时不渲染 */
  active: boolean;
  /** 与 `ImagePreviewOverlay` 的 resetKey 同步：换图时重置分界与拖动 */
  resetKey: string;
  /** 供写回/导出读取当前线分割参数（与 `active` 同步） */
  exportStateRef?: React.MutableRefObject<ImagePreviewSplitStretchExportState | null>;
};

function clampLineFrac(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(LINE_FRAC_MAX, Math.max(LINE_FRAC_MIN, v));
}

/**
 * 叠在平面大图 `<img>` 之上：水平分割线上下拖动，压缩/拉伸上下两段的纵向像素（总高度不变）。
 * 源图分界 `splitNaturalY` 固定为进入模式或换图时的中线，仅 `lineFrac` 随拖动变化；支持撤销/重做/重置/导出 PNG。
 */
export function ImagePreviewSplitStretchOverlay({
  imgRef,
  active,
  resetKey,
  exportStateRef,
}: ImagePreviewSplitStretchOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const [lineFrac, setLineFrac] = useState(0.5);
  const lineFracRef = useRef(0.5);
  lineFracRef.current = lineFrac;

  const splitNaturalYRef = useRef<number | null>(null);
  const [splitReady, setSplitReady] = useState(false);

  const undoStack = useRef<number[]>([0.5]);
  const redoStack = useRef<number[]>([]);
  const dragStartFrac = useRef<number | null>(null);
  const [histTick, setHistTick] = useState(0);

  const bumpLayout = useCallback(() => setLayoutTick((n) => n + 1), []);

  useEffect(() => {
    if (!active) return;
    const img = imgRef.current;
    if (!img) return;
    const ro = new ResizeObserver(() => bumpLayout());
    ro.observe(img);
    return () => ro.disconnect();
  }, [active, imgRef, bumpLayout]);

  const reinitSplit = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;
    const mid = nh / 2;
    splitNaturalYRef.current = mid;
    setLineFrac(0.5);
    lineFracRef.current = 0.5;
    undoStack.current = [0.5];
    redoStack.current = [];
    setSplitReady(true);
    setHistTick((x) => x + 1);
  }, [imgRef]);

  useLayoutEffect(() => {
    if (!active) {
      splitNaturalYRef.current = null;
      setSplitReady(false);
      return;
    }
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      reinitSplit();
    }
    const onLoad = () => reinitSplit();
    img.addEventListener('load', onLoad);
    return () => img.removeEventListener('load', onLoad);
  }, [active, resetKey, imgRef, reinitSplit]);

  const redraw = useCallback(() => {
    if (!active) return;
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const sy0 = splitNaturalYRef.current;
    if (!img || !canvas || sy0 == null) return;
    const m = getImgObjectContainMetrics(img);
    if (!m) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const dw = m.drawW;
    const dh = m.drawH;
    const cw = Math.max(1, Math.floor(dw * dpr));
    const ch = Math.max(1, Math.floor(dh * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    canvas.style.width = `${dw}px`;
    canvas.style.height = `${dh}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    try {
      ctx.clearRect(0, 0, dw, dh);
      drawSplitPreview(ctx, img, nw, nh, sy0, lineFrac, dw, dh);
    } catch {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [active, imgRef, lineFrac, layoutTick]);

  useLayoutEffect(() => {
    redraw();
  }, [redraw]);

  useLayoutEffect(() => {
    if (!exportStateRef) return;
    const sy = splitNaturalYRef.current;
    if (!active || sy == null) {
      exportStateRef.current = { active: false, lineFrac: 0.5, splitNaturalY: 0 };
      return;
    }
    exportStateRef.current = { active: true, lineFrac, splitNaturalY: sy };
  }, [active, lineFrac, exportStateRef, layoutTick]);

  const pushUndoIfNeeded = useCallback((prevFrac: number, nextFrac: number) => {
    if (Math.abs(nextFrac - prevFrac) < UNDO_EPS) return;
    undoStack.current.push(nextFrac);
    if (undoStack.current.length > 32) undoStack.current.shift();
    redoStack.current = [];
    setHistTick((x) => x + 1);
  }, []);

  const onLinePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!active) return;
      e.preventDefault();
      e.stopPropagation();
      dragStartFrac.current = lineFracRef.current;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [active]
  );

  const onLinePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!active || dragStartFrac.current == null) return;
      const img = imgRef.current;
      if (!img) return;
      const m = getImgObjectContainMetrics(img);
      if (!m) return;
      const local = clientPointToElementLocal(e.clientX, e.clientY, img);
      const ly = local.y - m.offsetY;
      const next = clampLineFrac(ly / m.drawH);
      setLineFrac(next);
    },
    [active, imgRef]
  );

  const onLinePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragStartFrac.current == null) return;
      const start = dragStartFrac.current;
      dragStartFrac.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      pushUndoIfNeeded(start, lineFracRef.current);
    },
    [pushUndoIfNeeded]
  );

  const onUndo = useCallback(() => {
    const u = undoStack.current;
    if (u.length <= 1) return;
    const cur = u.pop()!;
    redoStack.current.push(cur);
    const prev = u[u.length - 1]!;
    setLineFrac(prev);
    lineFracRef.current = prev;
    setHistTick((x) => x + 1);
  }, []);

  const onRedo = useCallback(() => {
    const r = redoStack.current;
    if (r.length === 0) return;
    const next = r.pop()!;
    undoStack.current.push(next);
    setLineFrac(next);
    lineFracRef.current = next;
    setHistTick((x) => x + 1);
  }, []);

  const onReset = useCallback(() => {
    reinitSplit();
  }, [reinitSplit]);

  const onDownloadPng = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const sy0 = splitNaturalYRef.current;
    if (!nw || !nh || sy0 == null) return;
    const c = document.createElement('canvas');
    c.width = nw;
    c.height = nh;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    try {
      ctx.clearRect(0, 0, nw, nh);
      drawSplitPreview(ctx, img, nw, nh, sy0, lineFracRef.current, nw, nh);
    } catch {
      return;
    }
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `split-stretch-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, [imgRef]);

  if (!active) return null;

  const img = imgRef.current;
  const m = img ? getImgObjectContainMetrics(img) : null;
  if (!img || !m) return null;

  const topPct = Math.round(lineFrac * 100);
  const botPct = 100 - topPct;
  const lineTopPx = m.offsetY + lineFrac * m.drawH;
  const canUndo = undoStack.current.length > 1;
  const canRedo = redoStack.current.length > 0;
  void histTick;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute z-0 select-none"
        style={{ left: m.offsetX, top: m.offsetY }}
        aria-hidden
      />
      {/* 水平中线参考线（固定于内容区垂直 50%，与可拖动分割条区分） */}
      <svg
        className="pointer-events-none absolute z-[3] select-none"
        style={{ left: m.offsetX, top: m.offsetY, width: m.drawW, height: m.drawH }}
        aria-hidden
      >
        <line
          x1={0}
          y1={m.drawH / 2}
          x2={m.drawW}
          y2={m.drawH / 2}
          stroke="rgba(251, 191, 36, 0.72)"
          strokeWidth={1}
          strokeDasharray="8 5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <button
        type="button"
        className="absolute z-[4] flex cursor-ns-resize items-center justify-center border-0 bg-blue-500/35 p-0 outline-none ring-1 ring-inset ring-blue-400/50 backdrop-blur-[2px] hover:bg-blue-500/50 focus-visible:ring-2 focus-visible:ring-blue-400"
        style={{
          left: m.offsetX,
          width: m.drawW,
          top: lineTopPx - 6,
          height: 12,
        }}
        aria-label="拖动调整上下区域纵向比例"
        onPointerDown={onLinePointerDown}
        onPointerMove={onLinePointerMove}
        onPointerUp={onLinePointerUp}
        onPointerCancel={onLinePointerUp}
      >
        <span className="h-0.5 w-[min(40%,120px)] rounded-full bg-white/90 shadow-sm" />
      </button>

      <div
        className="pointer-events-auto absolute bottom-2 left-1/2 z-[4] flex -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#0c0c10]/80 px-2 py-1.5 text-[11px] text-gray-200 shadow-lg backdrop-blur-md"
        data-image-preview-no-wheel=""
      >
        <span className="shrink-0 text-gray-400" title="琥珀虚线为图像垂直方向中线（参考），不写入导出 PNG">
          上 {topPct}% · 下 {botPct}%
          <span className="text-amber-200/80"> · 中线</span>
        </span>
        <span className="text-white/15" aria-hidden>
          |
        </span>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-gray-300 hover:bg-white/10 disabled:opacity-40"
          onClick={(e) => {
            e.stopPropagation();
            onUndo();
          }}
          disabled={!canUndo}
        >
          撤销
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-gray-300 hover:bg-white/10 disabled:opacity-40"
          onClick={(e) => {
            e.stopPropagation();
            onRedo();
          }}
          disabled={!canRedo}
        >
          重做
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-gray-300 hover:bg-white/10"
          onClick={(e) => {
            e.stopPropagation();
            onReset();
          }}
        >
          重置
        </button>
        <button
          type="button"
          className="rounded bg-blue-600/90 px-2 py-0.5 text-white hover:bg-blue-500 disabled:opacity-40"
          onClick={(e) => {
            e.stopPropagation();
            onDownloadPng();
          }}
          disabled={!splitReady}
          title="导出当前变形结果为 PNG"
        >
          下载 PNG
        </button>
      </div>
    </>
  );
}
