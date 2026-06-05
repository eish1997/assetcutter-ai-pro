import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  STORYBOARD_TOOL_BTN_NEUTRAL,
  STORYBOARD_TOOL_BTN_PRIMARY,
} from './storyboardTableUi';
import AppIcon from '../ui/AppIcon';

export type StoryboardFrameCropNorm = { x: number; y: number; w: number; h: number };

export type StoryboardFrameCropRect = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

type ImageMetrics = {
  offsetX: number;
  offsetY: number;
  displayW: number;
  displayH: number;
};

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type DragState =
  | { kind: 'draw'; anchorX: number; anchorY: number }
  | { kind: 'move'; origin: StoryboardFrameCropRect; startX: number; startY: number }
  | { kind: 'resize'; handle: ResizeHandle; origin: StoryboardFrameCropRect };

type Props = {
  open: boolean;
  busy?: boolean;
  imageSrc: string;
  shotLabel?: string;
  queueHint?: string;
  headerTitle?: string;
  headerHint?: string;
  initialCropNorm?: StoryboardFrameCropNorm | null;
  onClose: () => void;
  onConfirm: (crop: StoryboardFrameCropNorm) => void;
  onUseFullImage: () => void;
};

const MIN_CROP_UNITS = 8;

const HANDLES: Array<{ id: ResizeHandle; className: string; cursor: string }> = [
  { id: 'nw', className: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'nwse-resize' },
  { id: 'n', className: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'ns-resize' },
  { id: 'ne', className: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', cursor: 'nesw-resize' },
  { id: 'e', className: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { id: 'se', className: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2', cursor: 'nwse-resize' },
  { id: 's', className: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2', cursor: 'ns-resize' },
  { id: 'sw', className: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2', cursor: 'nesw-resize' },
  { id: 'w', className: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
];

function clamp01k(value: number): number {
  return Math.max(0, Math.min(1000, Math.round(value)));
}

export function clampStoryboardFrameCropRect(rect: StoryboardFrameCropRect): StoryboardFrameCropRect {
  let xmin = clamp01k(Math.min(rect.xmin, rect.xmax));
  let xmax = clamp01k(Math.max(rect.xmin, rect.xmax));
  let ymin = clamp01k(Math.min(rect.ymin, rect.ymax));
  let ymax = clamp01k(Math.max(rect.ymin, rect.ymax));

  if (xmax - xmin < MIN_CROP_UNITS) {
    if (xmin + MIN_CROP_UNITS <= 1000) xmax = xmin + MIN_CROP_UNITS;
    else xmin = Math.max(0, xmax - MIN_CROP_UNITS);
  }
  if (ymax - ymin < MIN_CROP_UNITS) {
    if (ymin + MIN_CROP_UNITS <= 1000) ymax = ymin + MIN_CROP_UNITS;
    else ymin = Math.max(0, ymax - MIN_CROP_UNITS);
  }

  xmin = clamp01k(xmin);
  xmax = clamp01k(xmax);
  ymin = clamp01k(ymin);
  ymax = clamp01k(ymax);
  return { xmin, ymin, xmax, ymax };
}

export function storyboardFrameCropRectFromNorm(norm: StoryboardFrameCropNorm): StoryboardFrameCropRect {
  return clampStoryboardFrameCropRect({
    xmin: norm.x * 1000,
    ymin: norm.y * 1000,
    xmax: (norm.x + norm.w) * 1000,
    ymax: (norm.y + norm.h) * 1000,
  });
}

export function storyboardFrameCropNormFromRect(
  rect: StoryboardFrameCropRect
): StoryboardFrameCropNorm | null {
  const c = clampStoryboardFrameCropRect(rect);
  const w = c.xmax - c.xmin;
  const h = c.ymax - c.ymin;
  if (w < MIN_CROP_UNITS || h < MIN_CROP_UNITS) return null;
  return { x: c.xmin / 1000, y: c.ymin / 1000, w: w / 1000, h: h / 1000 };
}

export function storyboardFrameCropNormFromDraft(draft: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}): StoryboardFrameCropNorm | null {
  return storyboardFrameCropNormFromRect({
    xmin: draft.x1,
    ymin: draft.y1,
    xmax: draft.x2,
    ymax: draft.y2,
  });
}

function computeObjectContainMetrics(
  containerW: number,
  containerH: number,
  imgW: number,
  imgH: number
): ImageMetrics | null {
  if (!containerW || !containerH || !imgW || !imgH) return null;
  const scale = Math.min(containerW / imgW, containerH / imgH);
  const displayW = imgW * scale;
  const displayH = imgH * scale;
  return {
    offsetX: (containerW - displayW) / 2,
    offsetY: (containerH - displayH) / 2,
    displayW,
    displayH,
  };
}

function clientToNorm(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  metrics: ImageMetrics
): { x: number; y: number } | null {
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  if (
    localX < metrics.offsetX ||
    localY < metrics.offsetY ||
    localX > metrics.offsetX + metrics.displayW ||
    localY > metrics.offsetY + metrics.displayH
  ) {
    return null;
  }
  return {
    x: clamp01k(((localX - metrics.offsetX) / metrics.displayW) * 1000),
    y: clamp01k(((localY - metrics.offsetY) / metrics.displayH) * 1000),
  };
}

function resizeCropRect(
  origin: StoryboardFrameCropRect,
  handle: ResizeHandle,
  point: { x: number; y: number }
): StoryboardFrameCropRect {
  let { xmin, ymin, xmax, ymax } = origin;
  const x = point.x;
  const y = point.y;
  switch (handle) {
    case 'nw':
      xmin = x;
      ymin = y;
      break;
    case 'n':
      ymin = y;
      break;
    case 'ne':
      xmax = x;
      ymin = y;
      break;
    case 'e':
      xmax = x;
      break;
    case 'se':
      xmax = x;
      ymax = y;
      break;
    case 's':
      ymax = y;
      break;
    case 'sw':
      xmin = x;
      ymax = y;
      break;
    case 'w':
      xmin = x;
      break;
  }
  return clampStoryboardFrameCropRect({ xmin, ymin, xmax, ymax });
}

function moveCropRect(
  origin: StoryboardFrameCropRect,
  dx: number,
  dy: number
): StoryboardFrameCropRect {
  const w = origin.xmax - origin.xmin;
  const h = origin.ymax - origin.ymin;
  let xmin = origin.xmin + dx;
  let ymin = origin.ymin + dy;
  xmin = Math.max(0, Math.min(1000 - w, xmin));
  ymin = Math.max(0, Math.min(1000 - h, ymin));
  return clampStoryboardFrameCropRect({
    xmin,
    ymin,
    xmax: xmin + w,
    ymax: ymin + h,
  });
}

export function isNearlyFullCropNorm(norm: StoryboardFrameCropNorm): boolean {
  return norm.x <= 0.002 && norm.y <= 0.002 && norm.w >= 0.996 && norm.h >= 0.996;
}

function capturePointerOnContainer(
  container: HTMLDivElement | null,
  event: React.PointerEvent
): void {
  if (!container) return;
  try {
    container.setPointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }
}

function releasePointerFromContainer(
  container: HTMLDivElement | null,
  event: React.PointerEvent
): void {
  if (!container) return;
  try {
    if (container.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId);
    }
  } catch {
    /* ignore */
  }
}
function rectToStyle(rect: StoryboardFrameCropRect, metrics: ImageMetrics) {
  return {
    left: metrics.offsetX + (rect.xmin / 1000) * metrics.displayW,
    top: metrics.offsetY + (rect.ymin / 1000) * metrics.displayH,
    width: ((rect.xmax - rect.xmin) / 1000) * metrics.displayW,
    height: ((rect.ymax - rect.ymin) / 1000) * metrics.displayH,
  };
}

export default function StoryboardFrameCropModal({
  open,
  busy = false,
  imageSrc,
  shotLabel,
  queueHint,
  headerTitle,
  headerHint,
  initialCropNorm = null,
  onClose,
  onConfirm,
  onUseFullImage,
}: Props) {
  const [cropRect, setCropRect] = useState<StoryboardFrameCropRect | null>(null);
  const [drawRect, setDrawRect] = useState<StoryboardFrameCropRect | null>(null);
  const [metrics, setMetrics] = useState<ImageMetrics | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const drawRectRef = useRef<StoryboardFrameCropRect | null>(null);
  const prevOpenRef = useRef(false);
  const prevImageSrcRef = useRef<string | null>(null);

  const refreshMetrics = useCallback(() => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (!iw || !ih) return;
    const rect = container.getBoundingClientRect();
    setMetrics(computeObjectContainMetrics(rect.width, rect.height, iw, ih));
  }, []);

  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open) {
      prevImageSrcRef.current = null;
      return;
    }
    const imageChanged =
      prevImageSrcRef.current != null && prevImageSrcRef.current !== imageSrc;
    prevImageSrcRef.current = imageSrc;

    if (justOpened || imageChanged) {
      dragRef.current = null;
      drawRectRef.current = null;
      setDrawRect(null);
      setCropRect(initialCropNorm ? storyboardFrameCropRectFromNorm(initialCropNorm) : null);
    }
    refreshMetrics();
  }, [imageSrc, initialCropNorm, open, refreshMetrics]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onClose, open]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => refreshMetrics();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, refreshMetrics]);

  const pointerToNorm = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container || !metrics) return null;
      return clientToNorm(clientX, clientY, container.getBoundingClientRect(), metrics);
    },
    [metrics]
  );

  const onPointerDownCanvas = useCallback(
    (event: React.PointerEvent) => {
      if (busy || !metrics) return;
      const pt = pointerToNorm(event.clientX, event.clientY);
      if (!pt) return;
      event.preventDefault();
      capturePointerOnContainer(containerRef.current, event);
      dragRef.current = { kind: 'draw', anchorX: pt.x, anchorY: pt.y };
      const seed = { xmin: pt.x, ymin: pt.y, xmax: pt.x, ymax: pt.y };
      drawRectRef.current = seed;
      setDrawRect(seed);
    },
    [busy, metrics, pointerToNorm]
  );

  const onPointerDownCropMove = useCallback(
    (event: React.PointerEvent) => {
      if (busy || !cropRect) return;
      event.preventDefault();
      event.stopPropagation();
      capturePointerOnContainer(containerRef.current, event);
      const pt = pointerToNorm(event.clientX, event.clientY);
      if (!pt) return;
      dragRef.current = {
        kind: 'move',
        origin: cropRect,
        startX: pt.x,
        startY: pt.y,
      };
    },
    [busy, cropRect, pointerToNorm]
  );

  const onPointerDownHandle = useCallback(
    (event: React.PointerEvent, handle: ResizeHandle) => {
      if (busy || !cropRect) return;
      event.preventDefault();
      event.stopPropagation();
      capturePointerOnContainer(containerRef.current, event);
      dragRef.current = { kind: 'resize', handle, origin: cropRect };
    },
    [busy, cropRect]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const pt = pointerToNorm(event.clientX, event.clientY);
      if (!pt) return;

      if (drag.kind === 'draw') {
        const next = {
          xmin: drag.anchorX,
          ymin: drag.anchorY,
          xmax: pt.x,
          ymax: pt.y,
        };
        drawRectRef.current = next;
        setDrawRect(next);
        return;
      }

      if (drag.kind === 'move') {
        setCropRect(
          moveCropRect(drag.origin, pt.x - drag.startX, pt.y - drag.startY)
        );
        return;
      }

      if (drag.kind === 'resize') {
        setCropRect(resizeCropRect(drag.origin, drag.handle, pt));
      }
    },
    [pointerToNorm]
  );

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    releasePointerFromContainer(containerRef.current, event);

    if (drag?.kind === 'draw') {
      const pending = drawRectRef.current;
      drawRectRef.current = null;
      if (pending) {
        const next = clampStoryboardFrameCropRect(pending);
        if (next.xmax - next.xmin >= MIN_CROP_UNITS && next.ymax - next.ymin >= MIN_CROP_UNITS) {
          setCropRect(next);
        }
      }
    }
    setDrawRect(null);
  }, []);

  const activeRect = drawRect ?? cropRect;
  const cropNorm = cropRect ? storyboardFrameCropNormFromRect(cropRect) : null;
  const activeStyle = activeRect && metrics ? rectToStyle(activeRect, metrics) : null;

  const title = headerTitle || '裁切分镜图';
  const hint =
    headerHint ||
    (initialCropNorm
      ? '拖动边框或角点调整裁切；框内拖动可平移；在空白处拖拽可重新框选'
      : '在画面上拖拽框选区域；选中后可拖动边框调整；也可直接使用全图');

  if (!open) return null;
  if (typeof document === 'undefined' || !document.body) return null;

  return createPortal(
    <div className="fixed inset-0 z-[2400] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
      <div className="flex h-[min(88vh,820px)] w-[min(94vw,960px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101010] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">{title}</div>
            <div className="truncate text-[10px] text-gray-500">
              {shotLabel ? `${shotLabel} · ` : ''}
              {hint}
              {queueHint ? ` · ${queueHint}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-white/5 hover:text-white"
            aria-label="关闭"
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </div>

        <div
          ref={containerRef}
          className="relative min-h-0 flex-1 cursor-crosshair bg-[#080808]"
          onPointerDown={onPointerDownCanvas}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            ref={imgRef}
            src={imageSrc}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            draggable={false}
            onLoad={refreshMetrics}
          />
          {activeStyle ? (
            <div
              className="absolute touch-none"
              style={activeStyle}
              onPointerDown={drawRect ? undefined : onPointerDownCropMove}
            >
              <div
                className={`absolute inset-0 ${
                  drawRect
                    ? 'border border-dashed border-white/55'
                    : 'border border-white/70'
                }`}
                style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.28)' }}
              />
              {!drawRect && cropRect
                ? HANDLES.map((handle) => (
                    <div
                      key={handle.id}
                      role="presentation"
                      className={`absolute z-10 h-2 w-2 rounded-[1px] border border-white/90 bg-white/80 ${handle.className}`}
                      style={{ cursor: handle.cursor }}
                      onPointerDown={(event) => onPointerDownHandle(event, handle.id)}
                    />
                  ))
                : null}
            </div>
          ) : (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="rounded-lg bg-black/50 px-3 py-1.5 text-[11px] text-gray-300">
                拖拽框选裁切区域
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={`${STORYBOARD_TOOL_BTN_NEUTRAL} h-9 px-4 text-[11px]`}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onUseFullImage}
            className={`${STORYBOARD_TOOL_BTN_NEUTRAL} h-9 px-4 text-[11px]`}
          >
            使用全图
          </button>
          <button
            type="button"
            disabled={busy || !cropNorm}
            onClick={() => {
              if (cropNorm) onConfirm(cropNorm);
            }}
            className={`${STORYBOARD_TOOL_BTN_PRIMARY} h-9 px-4 text-[11px]`}
          >
            {busy ? '处理中…' : '确认裁切'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
