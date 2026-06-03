import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BoundingBox } from '../../types';
import {
  clampStoryboardSheetSplitBox,
  newStoryboardSheetSplitBoxId,
} from '../../services/storyboardSheetVisionSplit';
import {
  STORYBOARD_FIELD_INPUT,
  STORYBOARD_TOOL_BTN_NEUTRAL,
  STORYBOARD_TOOL_BTN_PRIMARY,
} from './storyboardTableUi';
import AppIcon from '../ui/AppIcon';

type ImageMetrics = {
  offsetX: number;
  offsetY: number;
  displayW: number;
  displayH: number;
};

type Props = {
  open: boolean;
  busy?: boolean;
  detecting?: boolean;
  imageSrc: string;
  boxes: BoundingBox[];
  expectedShotNos?: string[];
  sheetLabel?: string;
  /** 打开时默认选中的框（如当前镜头 rowId） */
  initialSelectedId?: string | null;
  onClose: () => void;
  onConfirm: (boxes: BoundingBox[]) => void;
};

function clamp01k(value: number): number {
  return Math.max(0, Math.min(1000, Math.round(value)));
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

function boxToStyle(box: BoundingBox, metrics: ImageMetrics): React.CSSProperties {
  const left = metrics.offsetX + (box.xmin / 1000) * metrics.displayW;
  const top = metrics.offsetY + (box.ymin / 1000) * metrics.displayH;
  const width = ((box.xmax - box.xmin) / 1000) * metrics.displayW;
  const height = ((box.ymax - box.ymin) / 1000) * metrics.displayH;
  return { left, top, width, height };
}

function clientToBoxNorm(
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

export default function StoryboardSheetSplitAdjustModal({
  open,
  busy = false,
  detecting = false,
  imageSrc,
  boxes: initialBoxes,
  expectedShotNos = [],
  sheetLabel,
  initialSelectedId = null,
  onClose,
  onConfirm,
}: Props) {
  const [boxes, setBoxes] = useState<BoundingBox[]>(initialBoxes);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId ?? initialBoxes[0]?.id ?? null
  );
  const [drawMode, setDrawMode] = useState(false);
  const [draftRect, setDraftRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null
  );
  const [metrics, setMetrics] = useState<ImageMetrics | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<
    | { kind: 'move'; id: string; startX: number; startY: number; origin: BoundingBox }
    | { kind: 'resize'; id: string; origin: BoundingBox }
    | { kind: 'draw'; x1: number; y1: number }
    | null
  >(null);

  const prevOpenRef = useRef(false);
  const prevDetectingRef = useRef(false);

  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    const detectJustFinished = open && prevDetectingRef.current && !detecting;
    prevOpenRef.current = open;
    prevDetectingRef.current = detecting;

    if (!open) return;

    if (justOpened) {
      setBoxes(initialBoxes.map((box) => clampStoryboardSheetSplitBox(box)));
      setSelectedId(
        initialSelectedId && initialBoxes.some((box) => box.id === initialSelectedId)
          ? initialSelectedId
          : initialBoxes[0]?.id ?? null
      );
      setDrawMode(false);
      setDraftRect(null);
      return;
    }

    if (detectJustFinished && initialBoxes.length > 0) {
      setBoxes(initialBoxes.map((box) => clampStoryboardSheetSplitBox(box)));
      setSelectedId((prev) =>
        prev && initialBoxes.some((box) => box.id === prev) ? prev : initialBoxes[0]?.id ?? null
      );
    }
  }, [initialBoxes, open, detecting]);

  const refreshMetrics = useCallback(() => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img?.naturalWidth || !img?.naturalHeight) return;
    setMetrics(
      computeObjectContainMetrics(
        container.clientWidth,
        container.clientHeight,
        img.naturalWidth,
        img.naturalHeight
      )
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    const onResize = () => refreshMetrics();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, refreshMetrics]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (busy) return;
        event.preventDefault();
        onClose();
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        setBoxes((prev) => prev.filter((box) => box.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, open, selectedId]);

  const selectedBox = useMemo(
    () => boxes.find((box) => box.id === selectedId) ?? null,
    [boxes, selectedId]
  );

  const updateBox = useCallback((id: string, patch: Partial<BoundingBox>) => {
    setBoxes((prev) =>
      prev.map((box) => (box.id === id ? clampStoryboardSheetSplitBox({ ...box, ...patch }) : box))
    );
  }, []);

  const pointerToNorm = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container || !metrics) return null;
      return clientToBoxNorm(clientX, clientY, container.getBoundingClientRect(), metrics);
    },
    [metrics]
  );

  const onPointerDownCanvas = useCallback(
    (event: React.PointerEvent) => {
      if (busy || detecting || !metrics) return;
      const norm = pointerToNorm(event.clientX, event.clientY);
      if (!norm) return;
      event.preventDefault();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

      if (drawMode) {
        dragRef.current = { kind: 'draw', x1: norm.x, y1: norm.y };
        setDraftRect({ x1: norm.x, y1: norm.y, x2: norm.x, y2: norm.y });
        return;
      }

      setSelectedId(null);
    },
    [busy, detecting, drawMode, metrics, pointerToNorm]
  );

  const onPointerDownBox = useCallback(
    (event: React.PointerEvent, box: BoundingBox) => {
      if (busy || detecting || drawMode) return;
      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      setSelectedId(box.id);
      const norm = pointerToNorm(event.clientX, event.clientY);
      if (!norm) return;
      dragRef.current = {
        kind: 'move',
        id: box.id,
        startX: norm.x,
        startY: norm.y,
        origin: box,
      };
    },
    [busy, detecting, drawMode, pointerToNorm]
  );

  const onPointerDownResize = useCallback(
    (event: React.PointerEvent, box: BoundingBox) => {
      if (busy || detecting) return;
      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      setSelectedId(box.id);
      dragRef.current = { kind: 'resize', id: box.id, origin: box };
    },
    [busy, detecting]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const norm = pointerToNorm(event.clientX, event.clientY);
      if (!norm) return;

      if (drag.kind === 'draw') {
        setDraftRect({ x1: drag.x1, y1: drag.y1, x2: norm.x, y2: norm.y });
        return;
      }

      if (drag.kind === 'move') {
        const dx = norm.x - drag.startX;
        const dy = norm.y - drag.startY;
        const w = drag.origin.xmax - drag.origin.xmin;
        const h = drag.origin.ymax - drag.origin.ymin;
        let xmin = drag.origin.xmin + dx;
        let ymin = drag.origin.ymin + dy;
        xmin = Math.max(0, Math.min(1000 - w, xmin));
        ymin = Math.max(0, Math.min(1000 - h, ymin));
        updateBox(drag.id, {
          xmin: clamp01k(xmin),
          ymin: clamp01k(ymin),
          xmax: clamp01k(xmin + w),
          ymax: clamp01k(ymin + h),
        });
        return;
      }

      if (drag.kind === 'resize') {
        updateBox(drag.id, {
          xmax: Math.max(drag.origin.xmin + 24, norm.x),
          ymax: Math.max(drag.origin.ymin + 24, norm.y),
        });
      }
    },
    [pointerToNorm, updateBox]
  );

  const onPointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;

    if (drag?.kind === 'draw' && draftRect) {
      const xmin = Math.min(draftRect.x1, draftRect.x2);
      const xmax = Math.max(draftRect.x1, draftRect.x2);
      const ymin = Math.min(draftRect.y1, draftRect.y2);
      const ymax = Math.max(draftRect.y1, draftRect.y2);
      if (xmax - xmin >= 24 && ymax - ymin >= 24) {
        const nextLabel =
          expectedShotNos[boxes.length]?.trim() || String(boxes.length + 1).padStart(3, '0');
        const created = clampStoryboardSheetSplitBox({
          id: newStoryboardSheetSplitBoxId(),
          label: nextLabel,
          xmin,
          ymin,
          xmax,
          ymax,
        });
        setBoxes((prev) => [...prev, created]);
        setSelectedId(created.id);
      }
    }
    setDraftRect(null);
    if (drawMode) setDrawMode(false);
  }, [boxes.length, draftRect, drawMode, expectedShotNos]);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return;
    setBoxes((prev) => prev.filter((box) => box.id !== selectedId));
    setSelectedId(null);
  }, [selectedId]);

  if (!open) return null;

  const draftStyle =
    draftRect && metrics
      ? {
          left:
            metrics.offsetX +
            (Math.min(draftRect.x1, draftRect.x2) / 1000) * metrics.displayW,
          top:
            metrics.offsetY +
            (Math.min(draftRect.y1, draftRect.y2) / 1000) * metrics.displayH,
          width: (Math.abs(draftRect.x2 - draftRect.x1) / 1000) * metrics.displayW,
          height: (Math.abs(draftRect.y2 - draftRect.y1) / 1000) * metrics.displayH,
        }
      : null;

  return createPortal(
    <div className="fixed inset-0 z-[2400] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
      <div className="flex h-[min(92vh,920px)] w-[min(96vw,1180px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101010] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">调整切分框</div>
            <div className="truncate text-[10px] text-gray-500">
              {sheetLabel ? `${sheetLabel} · ` : ''}
              拖动框移动，右下角缩放；可增删框并修改镜号 label，确认后再切割
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

        <div className="flex min-h-0 flex-1">
          <div
            ref={containerRef}
            className={`relative min-w-0 flex-1 bg-[#080808] ${drawMode ? 'cursor-crosshair' : 'cursor-default'}`}
            onPointerDown={onPointerDownCanvas}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img
              ref={imgRef}
              src={imageSrc}
              alt="拼图切分"
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              onLoad={refreshMetrics}
            />

            {detecting ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-gray-200">
                识别分镜格中…
              </div>
            ) : null}

            {metrics &&
              boxes.map((box) => {
                const style = boxToStyle(box, metrics);
                const selected = box.id === selectedId;
                return (
                  <div
                    key={box.id}
                    className={`absolute border-2 ${
                      selected
                        ? 'border-emerald-400 bg-emerald-400/10 shadow-[0_0_0_1px_rgba(52,211,153,0.35)]'
                        : 'border-sky-400/80 bg-sky-400/10'
                    }`}
                    style={style}
                    onPointerDown={(event) => onPointerDownBox(event, box)}
                  >
                    <span className="absolute left-0 top-0 max-w-full truncate bg-black/60 px-1 text-[10px] font-semibold text-white">
                      {box.label || '未标镜号'}
                    </span>
                    {selected ? (
                      <div
                        className="absolute bottom-0 right-0 h-3 w-3 translate-x-1/2 translate-y-1/2 cursor-se-resize rounded-sm border border-white bg-emerald-400"
                        onPointerDown={(event) => onPointerDownResize(event, box)}
                      />
                    ) : null}
                  </div>
                );
              })}

            {draftStyle ? (
              <div
                className="pointer-events-none absolute border border-dashed border-amber-300 bg-amber-300/10"
                style={draftStyle}
              />
            ) : null}
          </div>

          <div className="flex w-56 shrink-0 flex-col border-l border-white/[0.06] bg-[#0c0c0c]">
            <div className="border-b border-white/[0.06] p-3">
              <div className="mb-2 text-[10px] font-semibold text-gray-300">
                切分框 ({boxes.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={busy || detecting}
                  onClick={() => setDrawMode(true)}
                  className={`${STORYBOARD_TOOL_BTN_NEUTRAL} h-7 px-2 text-[10px] ${drawMode ? 'ring-emerald-400/50' : ''}`}
                >
                  添加框
                </button>
                <button
                  type="button"
                  disabled={busy || detecting || !selectedId}
                  onClick={handleDeleteSelected}
                  className={`${STORYBOARD_TOOL_BTN_NEUTRAL} h-7 px-2 text-[10px]`}
                >
                  删除
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {selectedBox ? (
                <div className="space-y-2">
                  <label className="block text-[10px] text-gray-500">镜号 label</label>
                  <input
                    value={selectedBox.label}
                    disabled={busy}
                    onChange={(event) =>
                      updateBox(selectedBox.id, { label: event.target.value })
                    }
                    className={`${STORYBOARD_FIELD_INPUT} text-[11px]`}
                    placeholder="如 131 或 SC01_SH001"
                  />
                  <p className="text-[9px] leading-relaxed text-gray-600">
                    label 用于匹配表内镜号；框顺序不影响切割，以 label 为准。
                  </p>
                </div>
              ) : (
                <p className="text-[10px] text-gray-600">点击框选中后可改镜号，或拖动画布添加新框。</p>
              )}

              <div className="mt-4 space-y-1">
                {boxes.map((box, index) => (
                  <button
                    key={box.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setSelectedId(box.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[10px] ${
                      box.id === selectedId
                        ? 'bg-white/10 text-white'
                        : 'text-gray-400 hover:bg-white/[0.04]'
                    }`}
                  >
                    <span>{index + 1}. {box.label || '未标镜号'}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={`${STORYBOARD_TOOL_BTN_NEUTRAL} h-8 px-4 text-[11px]`}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || detecting || boxes.length === 0}
            onClick={() => onConfirm(boxes.map((box) => clampStoryboardSheetSplitBox(box)))}
            className={`${STORYBOARD_TOOL_BTN_PRIMARY} h-8 px-4 text-[11px]`}
          >
            {busy ? '切割中…' : `确认切割 (${boxes.length})`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
