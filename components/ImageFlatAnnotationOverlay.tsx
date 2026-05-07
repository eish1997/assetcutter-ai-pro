import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ImageOverlayAnnotationDoc,
  ImageOverlayBrushItem,
  ImageOverlayCropPolygon,
  ImageOverlayCropRect,
  ImageOverlayNormPoint,
  ImageOverlayRectItem,
  ImageOverlayTextItem,
} from '../types';
import {
  clientPointToElementLocal,
  getImgObjectContainMetrics,
  localToNaturalPoint,
  naturalToNorm,
} from '../services/imagePreviewPointerGeometry';
import {
  hitTestOverlayAnnotation,
  translateCropByNormDelta,
  translateItemByNormDelta,
} from '../services/imageOverlayHitTest';
import { isWorkflowEditableTarget } from './workflow/workflowDomUtils';
import { uuid } from './workflow/workflowIds';

/** 归一化坐标下视为「开始拖动」的最小位移，小于此不入撤销栈 */
const DRAG_HISTORY_NORM_EPS = 0.002;

export type ImageFlatAnnotationTool =
  | 'off'
  | 'select'
  | 'annotate_rect'
  | 'brush'
  | 'text'
  | 'crop_rect'
  | 'crop_lasso';

const EMPTY_DOC: ImageOverlayAnnotationDoc = { v: 1, items: [], crops: [] };

export function normalizeImageOverlayDoc(raw: unknown): ImageOverlayAnnotationDoc {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_DOC };
  const o = raw as Partial<ImageOverlayAnnotationDoc>;
  if (o.v !== 1) return { ...EMPTY_DOC };
  return {
    v: 1,
    items: Array.isArray(o.items) ? (o.items as ImageOverlayAnnotationDoc['items']) : [],
    crops: Array.isArray(o.crops) ? (o.crops as ImageOverlayAnnotationDoc['crops']) : [],
  };
}

type DraftRect = { x0: number; y0: number; x1: number; y1: number };

type DragSelectRef = {
  kind: 'item' | 'crop';
  id: string;
  start: ImageOverlayNormPoint;
  base:
    | ImageOverlayRectItem
    | ImageOverlayBrushItem
    | ImageOverlayTextItem
    | ImageOverlayCropRect
    | ImageOverlayCropPolygon;
};

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function rectFromDrag(a: ImageOverlayNormPoint, b: ImageOverlayNormPoint): { x: number; y: number; w: number; h: number } {
  const x = clamp01(Math.min(a.x, b.x));
  const y = clamp01(Math.min(a.y, b.y));
  const w = clamp01(Math.max(a.x, b.x)) - x;
  const h = clamp01(Math.max(a.y, b.y)) - y;
  return { x, y, w, h };
}

function deepCloneEntity<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

export type ImageFlatAnnotationOverlayProps = {
  imgRef: React.RefObject<HTMLImageElement | null>;
  layoutKey: string;
  doc: ImageOverlayAnnotationDoc;
  tool: ImageFlatAnnotationTool;
  color: string;
  brushWidth: number;
  onDocPatch: (
    patch: (prev: ImageOverlayAnnotationDoc) => ImageOverlayAnnotationDoc,
    opts?: { skipHistory?: boolean }
  ) => void;
  /** 选择拖动产生有效位移后、首次改 doc 前由父组件入撤销栈（避免点选占撤销步） */
  onBeginDragGesture?: () => void;
};

/**
 * 叠在 `ImagePreviewOverlay` 的 `<img>` 上：与 `object-contain` + 父级 scale 对齐的 SVG 坐标系。
 * `tool==='off'` 时不拦截指针，便于原缩放/平移。
 */
export function ImageFlatAnnotationOverlay({
  imgRef,
  layoutKey,
  doc,
  tool,
  color,
  brushWidth,
  onDocPatch,
  onBeginDragGesture,
}: ImageFlatAnnotationOverlayProps) {
  const [layoutTick, setLayoutTick] = useState(0);
  const [brushDraft, setBrushDraft] = useState<ImageOverlayNormPoint[] | null>(null);
  const [lassoDraft, setLassoDraft] = useState<ImageOverlayNormPoint[] | null>(null);
  const [dragRect, setDragRect] = useState<DraftRect | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textEditId, setTextEditId] = useState<string | null>(null);
  const dragSelectRef = useRef<DragSelectRef | null>(null);
  const dragHistoryPrimedRef = useRef(false);
  const textEditIdRef = useRef<string | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const bump = () => setLayoutTick((n) => n + 1);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(bump) : null;
    ro?.observe(img);
    img.addEventListener('load', bump);
    window.addEventListener('resize', bump);
    bump();
    return () => {
      ro?.disconnect();
      img.removeEventListener('load', bump);
      window.removeEventListener('resize', bump);
    };
  }, [imgRef, layoutKey]);

  const metrics = useMemo(() => {
    const img = imgRef.current;
    if (!img) return null;
    return getImgObjectContainMetrics(img);
  }, [imgRef, layoutKey, layoutTick]);

  const img = imgRef.current;
  const nw = metrics?.nw ?? 0;
  const nh = metrics?.nh ?? 0;
  const ready = Boolean(metrics && img && nw && nh);

  useEffect(() => {
    if (!selectedId) return;
    const ok =
      doc.items.some((x) => x.id === selectedId) || doc.crops.some((x) => x.id === selectedId);
    if (!ok) setSelectedId(null);
  }, [doc, selectedId]);

  useEffect(() => {
    if (tool !== 'select') setSelectedId(null);
  }, [tool]);

  useEffect(() => {
    textEditIdRef.current = textEditId;
  }, [textEditId]);

  const finalizeTextEdit = useCallback(() => {
    const id = textEditIdRef.current;
    if (!id) return;
    const el = textInputRef.current;
    const raw = el?.value ?? '';
    const trimmed = raw.trim();
    onDocPatch((prev) => ({
      ...prev,
      items: trimmed
        ? prev.items.map((x) => (x.id === id && x.kind === 'text' ? { ...x, text: trimmed } : x))
        : prev.items.filter((x) => !(x.id === id && x.kind === 'text')),
    }));
    textEditIdRef.current = null;
    setTextEditId(null);
  }, [onDocPatch]);

  useLayoutEffect(() => {
    if (!textEditId) return;
    const inp = textInputRef.current;
    if (!inp) return;
    inp.focus();
    inp.select();
  }, [textEditId]);

  useEffect(() => {
    if (tool === 'off' && textEditId) finalizeTextEdit();
  }, [tool, textEditId, finalizeTextEdit]);

  useEffect(() => {
    if (!textEditId) return;
    const ok = doc.items.some((x) => x.id === textEditId && x.kind === 'text');
    if (!ok) {
      textEditIdRef.current = null;
      setTextEditId(null);
    }
  }, [doc.items, textEditId]);

  useEffect(() => {
    if (tool !== 'select' || !selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (isWorkflowEditableTarget(e.target)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedId(null);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const sid = selectedId;
        onDocPatch((prev) => ({
          ...prev,
          items: prev.items.filter((x) => x.id !== sid),
          crops: prev.crops.filter((x) => x.id !== sid),
        }));
        setSelectedId(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        const sid = selectedId;
        const it = doc.items.find((x) => x.id === sid);
        if (it) {
          const newId = uuid();
          const copy = { ...deepCloneEntity(it), id: newId } as typeof it;
          const moved = translateItemByNormDelta(
            copy as ImageOverlayRectItem | ImageOverlayBrushItem | ImageOverlayTextItem,
            0.02,
            0.02
          ) as typeof it;
          onDocPatch((prev) => ({ ...prev, items: [...prev.items, moved] }));
          setSelectedId(newId);
          return;
        }
        const c = doc.crops.find((x) => x.id === sid);
        if (c) {
          const newId = uuid();
          const copy = { ...deepCloneEntity(c), id: newId } as typeof c;
          const moved = translateCropByNormDelta(
            copy as ImageOverlayCropRect | ImageOverlayCropPolygon,
            0.02,
            0.02
          ) as typeof c;
          onDocPatch((prev) => ({ ...prev, crops: [...prev.crops, moved] }));
          setSelectedId(newId);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tool, selectedId, doc, onDocPatch]);

  const eventToNorm = useCallback(
    (clientX: number, clientY: number) => {
      if (!img || !metrics) return null;
      const { x: lx, y: ly } = clientPointToElementLocal(clientX, clientY, img);
      const { nx, ny } = localToNaturalPoint(lx, ly, metrics);
      return naturalToNorm(nx, ny, metrics);
    },
    [img, metrics]
  );

  const isInsideContent = useCallback(
    (clientX: number, clientY: number) => {
      if (!img || !metrics) return false;
      const { x: lx, y: ly } = clientPointToElementLocal(clientX, clientY, img);
      return localToNaturalPoint(lx, ly, metrics).inside;
    },
    [img, metrics]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (tool === 'off' || !ready) return;

      if (textEditIdRef.current) finalizeTextEdit();

      if (tool === 'select') {
        if (!isInsideContent(e.clientX, e.clientY)) return;
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        const p = eventToNorm(e.clientX, e.clientY);
        if (!p) return;
        const hit = hitTestOverlayAnnotation(p, doc, nw, nh);
        if (!hit) {
          setSelectedId(null);
          dragSelectRef.current = null;
          dragHistoryPrimedRef.current = false;
          return;
        }
        setSelectedId(hit.id);
        const entity =
          hit.kind === 'item'
            ? doc.items.find((x) => x.id === hit.id)
            : doc.crops.find((x) => x.id === hit.id);
        if (!entity) return;
        dragHistoryPrimedRef.current = false;
        dragSelectRef.current = {
          kind: hit.kind,
          id: hit.id,
          start: { ...p },
          base: deepCloneEntity(entity),
        };
        return;
      }

      if (!isInsideContent(e.clientX, e.clientY)) return;

      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

      const p = eventToNorm(e.clientX, e.clientY);
      if (!p) return;

      if (tool === 'brush') {
        setBrushDraft([p]);
        return;
      }
      if (tool === 'crop_lasso') {
        setLassoDraft([p]);
        return;
      }
      if (tool === 'annotate_rect' || tool === 'crop_rect') {
        setDragRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        return;
      }
      if (tool === 'text') {
        const id = uuid();
        const item: ImageOverlayTextItem = {
          id,
          kind: 'text',
          x: clamp01(p.x),
          y: clamp01(p.y),
          text: '',
          size: Math.max(10, Math.round(Math.min(nw, nh) * 0.028)),
          fill: color,
        };
        onDocPatch((prev) => ({ ...prev, items: [...prev.items, item] }));
        setTextEditId(id);
      }
    },
    [tool, ready, eventToNorm, isInsideContent, doc, nw, nh, color, onDocPatch, finalizeTextEdit]
  );

  const onSvgDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (tool !== 'select' || !ready) return;
      if (!isInsideContent(e.clientX, e.clientY)) return;
      e.preventDefault();
      e.stopPropagation();
      const p = eventToNorm(e.clientX, e.clientY);
      if (!p) return;
      const hit = hitTestOverlayAnnotation(p, doc, nw, nh);
      if (!hit || hit.kind !== 'item') return;
      const it = doc.items.find((x) => x.id === hit.id);
      if (it && it.kind === 'text') {
        setSelectedId(it.id);
        setTextEditId(it.id);
      }
    },
    [tool, ready, isInsideContent, eventToNorm, doc, nw, nh]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = eventToNorm(e.clientX, e.clientY);
      if (!p) return;

      if (tool === 'select' && dragSelectRef.current) {
        e.preventDefault();
        e.stopPropagation();
        const d = dragSelectRef.current;
        const dx = p.x - d.start.x;
        const dy = p.y - d.start.y;
        if (
          !dragHistoryPrimedRef.current &&
          (Math.abs(dx) > DRAG_HISTORY_NORM_EPS || Math.abs(dy) > DRAG_HISTORY_NORM_EPS)
        ) {
          dragHistoryPrimedRef.current = true;
          onBeginDragGesture?.();
        }
        const nextEnt =
          d.kind === 'item'
            ? translateItemByNormDelta(d.base as ImageOverlayRectItem | ImageOverlayBrushItem | ImageOverlayTextItem, dx, dy)
            : translateCropByNormDelta(d.base as ImageOverlayCropRect | ImageOverlayCropPolygon, dx, dy);
        onDocPatch(
          (prev) => {
            if (d.kind === 'item') {
              return { ...prev, items: prev.items.map((x) => (x.id === d.id ? (nextEnt as typeof x) : x)) };
            }
            return { ...prev, crops: prev.crops.map((x) => (x.id === d.id ? (nextEnt as typeof x) : x)) };
          },
          { skipHistory: true }
        );
        return;
      }

      if (tool === 'brush' && brushDraft) {
        e.preventDefault();
        e.stopPropagation();
        const prev = brushDraft[brushDraft.length - 1];
        if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > 0.0015) {
          setBrushDraft((d) => (d ? [...d, p] : d));
        }
        return;
      }
      if (tool === 'crop_lasso' && lassoDraft) {
        e.preventDefault();
        e.stopPropagation();
        const prev = lassoDraft[lassoDraft.length - 1];
        if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > 0.002) {
          setLassoDraft((d) => (d ? [...d, p] : d));
        }
        return;
      }
      if ((tool === 'annotate_rect' || tool === 'crop_rect') && dragRect) {
        e.preventDefault();
        e.stopPropagation();
        setDragRect((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
      }
    },
    [tool, eventToNorm, brushDraft, lassoDraft, dragRect, onDocPatch, onBeginDragGesture]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (tool === 'select') {
        dragSelectRef.current = null;
        dragHistoryPrimedRef.current = false;
        return;
      }
      if (tool === 'brush' && brushDraft) {
        e.preventDefault();
        e.stopPropagation();
        const pts = brushDraft;
        setBrushDraft(null);
        if (pts.length < 2) return;
        const sw = Math.max(1, brushWidth);
        const item: ImageOverlayBrushItem = {
          id: uuid(),
          kind: 'brush',
          points: pts,
          stroke: color,
          sw,
        };
        onDocPatch((prev) => ({ ...prev, items: [...prev.items, item] }));
        return;
      }
      if (tool === 'crop_lasso' && lassoDraft) {
        e.preventDefault();
        e.stopPropagation();
        const pts = lassoDraft;
        setLassoDraft(null);
        if (pts.length < 3) return;
        const first = pts[0]!;
        const last = pts[pts.length - 1]!;
        const closed =
          Math.hypot(first.x - last.x, first.y - last.y) < 0.004 ? pts : [...pts, { ...first }];
        const crop: ImageOverlayCropPolygon = { id: uuid(), kind: 'crop_polygon', points: closed };
        onDocPatch((prev) => ({ ...prev, crops: [...prev.crops, crop] }));
        return;
      }
      if ((tool === 'annotate_rect' || tool === 'crop_rect') && dragRect) {
        e.preventDefault();
        e.stopPropagation();
        const r = rectFromDrag({ x: dragRect.x0, y: dragRect.y0 }, { x: dragRect.x1, y: dragRect.y1 });
        setDragRect(null);
        if (r.w < 0.002 || r.h < 0.002) return;
        if (tool === 'annotate_rect') {
          const item: ImageOverlayRectItem = {
            id: uuid(),
            kind: 'rect',
            ...r,
            stroke: color,
            sw: Math.max(1, brushWidth),
          };
          onDocPatch((prev) => ({ ...prev, items: [...prev.items, item] }));
        } else {
          const crop: ImageOverlayCropRect = { id: uuid(), kind: 'crop_rect', ...r };
          onDocPatch((prev) => ({ ...prev, crops: [...prev.crops, crop] }));
        }
      }
    },
    [tool, brushDraft, lassoDraft, dragRect, brushWidth, color, onDocPatch]
  );

  if (!ready) return null;

  const pe = tool === 'off' ? 'none' : 'auto';
  const selStroke = 'rgba(34,211,238,0.95)';
  const selSw = Math.max(2, Math.min(nw, nh) * 0.005);

  const renderItem = (it: ImageOverlayAnnotationDoc['items'][number], isSel: boolean) => {
    if (it.kind === 'rect') {
      return (
        <g key={it.id}>
          {isSel ? (
            <rect
              x={it.x * nw - selSw}
              y={it.y * nh - selSw}
              width={it.w * nw + 2 * selSw}
              height={it.h * nh + 2 * selSw}
              fill="none"
              stroke={selStroke}
              strokeWidth={selSw}
              strokeDasharray="6 4"
              pointerEvents="none"
            />
          ) : null}
          <rect
            x={it.x * nw}
            y={it.y * nh}
            width={it.w * nw}
            height={it.h * nh}
            fill="none"
            stroke={it.stroke}
            strokeWidth={it.sw}
          />
        </g>
      );
    }
    if (it.kind === 'brush') {
      if (it.points.length < 2) return null;
      const d = it.points.map((q, i) => `${i === 0 ? 'M' : 'L'} ${q.x * nw} ${q.y * nh}`).join(' ');
      return (
        <g key={it.id}>
          {isSel ? (
            <path
              d={d}
              fill="none"
              stroke={selStroke}
              strokeWidth={it.sw + selSw * 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.45}
              pointerEvents="none"
            />
          ) : null}
          <path
            d={d}
            fill="none"
            stroke={it.stroke}
            strokeWidth={it.sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    }
    const hideSvgText = it.id === textEditId;
    const hasBody = it.text.trim().length > 0;
    if (hideSvgText || !hasBody) return <g key={it.id} />;
    return (
      <g key={it.id}>
        {isSel ? (
          <text
            x={it.x * nw}
            y={it.y * nh}
            fill="none"
            stroke={selStroke}
            strokeWidth={selSw}
            fontSize={it.size}
            style={{ paintOrder: 'stroke fill', userSelect: 'none' }}
            pointerEvents="none"
          >
            {it.text}
          </text>
        ) : null}
        <text
          x={it.x * nw}
          y={it.y * nh}
          fill={it.fill}
          fontSize={it.size}
          style={{ userSelect: 'none', paintOrder: 'stroke fill' }}
          stroke="rgba(0,0,0,0.35)"
          strokeWidth={Math.max(1, it.size * 0.06)}
        >
          {it.text}
        </text>
      </g>
    );
  };

  const renderCrop = (c: ImageOverlayAnnotationDoc['crops'][number], isSel: boolean) => {
    if (c.kind === 'crop_rect') {
      return (
        <g key={c.id}>
          {isSel ? (
            <rect
              x={c.x * nw - selSw}
              y={c.y * nh - selSw}
              width={c.w * nw + 2 * selSw}
              height={c.h * nh + 2 * selSw}
              fill="rgba(34,211,238,0.06)"
              stroke={selStroke}
              strokeWidth={selSw}
              strokeDasharray="4 3"
              pointerEvents="none"
            />
          ) : null}
          <rect
            x={c.x * nw}
            y={c.y * nh}
            width={c.w * nw}
            height={c.h * nh}
            fill="rgba(251,146,60,0.12)"
            stroke="rgba(251,146,60,0.95)"
            strokeWidth={Math.max(1, Math.min(nw, nh) * 0.004)}
            strokeDasharray="6 4"
          />
        </g>
      );
    }
    if (c.points.length < 3) return null;
    const pts = c.points.map((p) => `${p.x * nw},${p.y * nh}`).join(' ');
    return (
      <g key={c.id}>
        {isSel ? (
          <polygon
            points={pts}
            fill="rgba(34,211,238,0.08)"
            stroke={selStroke}
            strokeWidth={selSw}
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        ) : null}
        <polygon
          points={pts}
          fill="rgba(251,146,60,0.12)"
          stroke="rgba(251,146,60,0.95)"
          strokeWidth={Math.max(1, Math.min(nw, nh) * 0.004)}
          strokeDasharray="6 4"
        />
      </g>
    );
  };

  const editTextItem =
    textEditId && metrics
      ? (doc.items.find((x) => x.id === textEditId && x.kind === 'text') as ImageOverlayTextItem | undefined)
      : undefined;
  const editFontPx =
    editTextItem && metrics ? Math.max(10, editTextItem.size * (metrics.drawW / metrics.nw)) : 12;

  return (
    <div className="pointer-events-none absolute inset-0" data-image-preview-no-wheel>
      <svg
        className={`h-full w-full select-none ${tool === 'select' ? 'cursor-grab active:cursor-grabbing' : ''} ${pe === 'none' ? 'pointer-events-none' : 'pointer-events-auto'}`}
        style={{ touchAction: tool === 'off' ? 'auto' : 'none' }}
        viewBox={`0 0 ${nw} ${nh}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onSvgDoubleClick}
      >
        {doc.items.map((it) => renderItem(it, selectedId === it.id))}
        {doc.crops.map((c) => renderCrop(c, selectedId === c.id))}
        {dragRect ? (
          (() => {
            const r = rectFromDrag({ x: dragRect.x0, y: dragRect.y0 }, { x: dragRect.x1, y: dragRect.y1 });
            return (
              <rect
                x={r.x * nw}
                y={r.y * nh}
                width={r.w * nw}
                height={r.h * nh}
                fill={tool === 'crop_rect' ? 'rgba(251,146,60,0.1)' : 'rgba(59,130,246,0.08)'}
                stroke={tool === 'crop_rect' ? 'rgba(251,146,60,0.9)' : color}
                strokeWidth={Math.max(1, Math.min(nw, nh) * 0.004)}
                strokeDasharray="4 3"
              />
            );
          })()
        ) : null}
        {tool === 'brush' && brushDraft && brushDraft.length > 1 ? (
          <path
            d={brushDraft.map((q, i) => `${i === 0 ? 'M' : 'L'} ${q.x * nw} ${q.y * nh}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={brushWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {tool === 'crop_lasso' && lassoDraft && lassoDraft.length > 1 ? (
          <path
            d={lassoDraft.map((q, i) => `${i === 0 ? 'M' : 'L'} ${q.x * nw} ${q.y * nh}`).join(' ')}
            fill="none"
            stroke="rgba(251,146,60,0.95)"
            strokeWidth={Math.max(1, Math.min(nw, nh) * 0.004)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
      {editTextItem && metrics ? (
        <input
          key={textEditId}
          ref={textInputRef}
          type="text"
          defaultValue={editTextItem.text}
          placeholder="输入文字"
          className="pointer-events-auto absolute z-[30] box-border min-w-[7rem] max-w-[min(22rem,calc(55vw))] rounded-md border border-white/25 bg-black/70 px-1.5 py-0.5 text-left shadow-lg outline-none ring-0 backdrop-blur-[2px] placeholder:text-white/40"
          style={{
            left: metrics.offsetX + editTextItem.x * metrics.drawW,
            top: metrics.offsetY + editTextItem.y * metrics.drawH - editFontPx * 0.78,
            fontSize: editFontPx,
            lineHeight: 1.25,
            color: editTextItem.fill,
            textShadow: '0 0 2px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,0.85)',
          }}
          autoComplete="off"
          onPointerDown={(ev) => ev.stopPropagation()}
          onClick={(ev) => ev.stopPropagation()}
          onChange={(e) => {
            const v = e.target.value;
            onDocPatch(
              (prev) => ({
                ...prev,
                items: prev.items.map((x) =>
                  x.id === editTextItem.id && x.kind === 'text' ? { ...x, text: v } : x
                ),
              }),
              { skipHistory: true }
            );
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          onBlur={finalizeTextEdit}
        />
      ) : null}
    </div>
  );
}
