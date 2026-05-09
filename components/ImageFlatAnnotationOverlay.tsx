/* eslint-disable react-hooks/refs -- 标注层在 render 中与 layoutTick / 全景 subscribeAnimation 同步读取 imgRef、panoProjectionRef，以对齐 object-contain 与球面重投影 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  ImageLocalEditPolygon,
  ImageLocalEditSelection,
  ImageOverlayAnnotationDoc,
  ImageOverlayBrushItem,
  ImageOverlayCropPolygon,
  ImageOverlayCropRect,
  ImageOverlayNormPoint,
  ImageOverlayRectItem,
  ImageOverlayTextItem,
  PanoViewportCropNorm,
} from '../types';
import {
  clientPointToElementLocal,
  getImgObjectContainMetrics,
  imageNaturalIndicesFromClientPoint,
  localEditSelectionBottomCenterClient,
  localToNaturalPoint,
  naturalToNorm,
} from '../services/imagePreviewPointerGeometry';
import type { PanoramaViewportProjection, PanoLocalReprojectSnapshot } from '../services/panoViewportProjection';
import {
  equirectLoopFromPanoOverlayEllipse,
  equirectLoopFromPanoOverlayPolyline,
  equirectLoopFromPanoOverlayRect,
} from '../services/panoLocalEditFootprint';
import {
  hitTestOverlayAnnotation,
  translateCropByNormDelta,
  translateItemByNormDelta,
} from '../services/imageOverlayHitTest';
import { tightPixelBBoxForLocalEdit } from '../services/localInpaintGemini';
import { isWorkflowEditableTarget } from './workflow/workflowDomUtils';
import { uuid } from './workflow/workflowIds';

/** 归一化坐标下视为「开始拖动」的最小位移，小于此不入撤销栈 */
const DRAG_HISTORY_NORM_EPS = 0.002;

/** 标注/裁切/局部重绘「框选或套索」时全屏十字定位线（pointer-events-none，高于大图内层 UI） */
const IMAGE_LAYOUT_CROSSHAIR_Z = 3500;

export type ImageFlatAnnotationTool =
  | 'off'
  | 'select'
  | 'annotate_rect'
  | 'brush'
  | 'text'
  | 'crop_rect'
  | 'crop_lasso'
  | 'local_edit_rect'
  | 'local_edit_ellipse'
  | 'local_edit_lasso';

/** 选中即显示十字（跟指针），无需点击或开始拖拽 */
const LAYOUT_CROSSHAIR_TOOLS = new Set<ImageFlatAnnotationTool>([
  'annotate_rect',
  'crop_rect',
  'crop_lasso',
  'local_edit_rect',
  'local_edit_ellipse',
  'local_edit_lasso',
]);

const EMPTY_DOC: ImageOverlayAnnotationDoc = {
  v: 1,
  items: [],
  crops: [],
  localEdit: null,
  panoViewportCrop: undefined,
  panoLocalEditViewport: undefined,
  panoLocalEditEquirect: undefined,
  panoLocalEditReproject: undefined,
};

function numNorm(x: unknown, fallback = 0): number {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function clamp01n(v: number) {
  return Math.min(1, Math.max(0, v));
}

function normalizeNormPointsRaw(raw: unknown): ImageOverlayNormPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) =>
      p && typeof p === 'object'
        ? {
            x: clamp01n(numNorm((p as { x?: unknown }).x)),
            y: clamp01n(numNorm((p as { y?: unknown }).y)),
          }
        : null
    )
    .filter((x): x is ImageOverlayNormPoint => x != null);
}

function normalizeLocalEditRaw(raw: unknown): ImageLocalEditSelection | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' && o.id ? o.id : null;
  if (!id) return null;
  const k = o.kind;
  if (k === 'local_rect' || k === 'local_ellipse') {
    const x = clamp01n(numNorm(o.x));
    const y = clamp01n(numNorm(o.y));
    const w = clamp01n(numNorm(o.w));
    const h = clamp01n(numNorm(o.h));
    if (w < 0.0005 || h < 0.0005) return null;
    return k === 'local_rect'
      ? { id, kind: 'local_rect', x, y, w, h }
      : { id, kind: 'local_ellipse', x, y, w, h };
  }
  if (k === 'local_polygon') {
    const pts = normalizeNormPointsRaw(o.points);
    if (pts.length < 3) return null;
    return { id, kind: 'local_polygon', points: pts };
  }
  return null;
}

function normalizePanoViewportCrop(raw: unknown): PanoViewportCropNorm | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const x = clamp01n(numNorm(o.x));
  const y = clamp01n(numNorm(o.y));
  const w = clamp01n(numNorm(o.w));
  const h = clamp01n(numNorm(o.h));
  if (w < 0.001 || h < 0.001) return null;
  return { x, y, w, h };
}

function wrap01u(u: number): number {
  let x = u % 1;
  if (x < 0) x += 1;
  return x;
}

function normalizePanoLocalEditEquirect(raw: unknown): ImageOverlayAnnotationDoc['panoLocalEditEquirect'] {
  if (!Array.isArray(raw) || raw.length < 3) return undefined;
  const out: NonNullable<ImageOverlayAnnotationDoc['panoLocalEditEquirect']> = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const u = wrap01u(numNorm(o.u));
    const v = clamp01n(numNorm(o.v));
    out.push({ u, v });
  }
  return out.length >= 3 ? out : undefined;
}

function normalizePanoLocalEditReproject(raw: unknown): PanoLocalReprojectSnapshot | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const bufferW = Math.floor(numNorm(o.bufferW));
  const bufferH = Math.floor(numNorm(o.bufferH));
  const fovDeg = numNorm(o.fovDeg);
  const aspect = numNorm(o.aspect);
  const cp = o.cameraPosition;
  const cq = o.cameraQuaternion;
  if (!Array.isArray(cp) || cp.length !== 3 || !Array.isArray(cq) || cq.length !== 4) return undefined;
  if (!Number.isFinite(fovDeg) || !Number.isFinite(aspect) || bufferW < 1 || bufferH < 1) return undefined;
  return {
    bufferW,
    bufferH,
    fovDeg,
    aspect,
    cameraPosition: [numNorm(cp[0]), numNorm(cp[1]), numNorm(cp[2])],
    cameraQuaternion: [numNorm(cq[0]), numNorm(cq[1]), numNorm(cq[2]), numNorm(cq[3])],
  };
}

export function normalizeImageOverlayDoc(raw: unknown): ImageOverlayAnnotationDoc {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_DOC };
  const o = raw as Partial<ImageOverlayAnnotationDoc>;
  if (o.v !== 1) return { ...EMPTY_DOC };
  const le = normalizeLocalEditRaw(o.localEdit);
  const panoViewportCrop = normalizePanoViewportCrop(o.panoViewportCrop);
  const panoLocalEditViewport = normalizePanoViewportCrop(o.panoLocalEditViewport);
  const panoLocalEditEquirect = normalizePanoLocalEditEquirect(o.panoLocalEditEquirect);
  const panoLocalEditReproject = normalizePanoLocalEditReproject(o.panoLocalEditReproject);
  return {
    v: 1,
    items: Array.isArray(o.items) ? (o.items as ImageOverlayAnnotationDoc['items']) : [],
    crops: Array.isArray(o.crops) ? (o.crops as ImageOverlayAnnotationDoc['crops']) : [],
    localEdit: le,
    panoViewportCrop: panoViewportCrop ?? undefined,
    panoLocalEditViewport: panoLocalEditViewport ?? undefined,
    panoLocalEditEquirect,
    panoLocalEditReproject,
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

/** SAM 框选：归一化矩形 → 与点提示同源的像素索引包围盒 */
function samNormRectToPixelBox(
  r: { x: number; y: number; w: number; h: number },
  nw: number,
  nh: number
): { x1: number; y1: number; x2: number; y2: number } {
  const xA = Math.min(nw - 1, Math.max(0, Math.floor(r.x * nw)));
  const yA = Math.min(nh - 1, Math.max(0, Math.floor(r.y * nh)));
  const xB = Math.min(nw - 1, Math.max(0, Math.floor((r.x + r.w) * nw - Number.EPSILON)));
  const yB = Math.min(nh - 1, Math.max(0, Math.floor((r.y + r.h) * nh - Number.EPSILON)));
  const x1 = Math.min(xA, xB);
  const y1 = Math.min(yA, yB);
  const x2 = Math.max(xA, xB);
  const y2 = Math.max(yA, yB);
  return { x1, y1, x2, y2 };
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
  /** 局部重绘选区变化时：底边中点视口坐标（用于大图快捷栏锚定）；无选区传 `null` */
  onLocalEditAnchorClientChange?: (pt: { x: number; y: number } | null) => void;
  /**
   * 全景 WebGL 与叠层同尺寸的容器（`absolute inset-0`），用于屏幕坐标 SVG 与 `getBoundingClientRect`。
   * 与 `panoProjectionRef` 同时传入时启用全景映射（射线 ↔ 纹理归一化、每帧重投影）。
   */
  panoOverlayContainerRef?: React.RefObject<HTMLDivElement | null>;
  panoProjectionRef?: React.RefObject<PanoramaViewportProjection | null>;
  /** 全景 Viewer 挂载后由父级递增，用于在 `ref.current` 就绪时重跑订阅与 `ready` */
  panoViewerBindEpoch?: number;
  /** 本机 SAM：平面模式下等待用户点击原图像素 */
  samPickAwaiting?: boolean;
  /** 点 / 框 提示子模式 */
  samPickSubmode?: 'point' | 'box';
  /** 增加前景点（左键）或背景点（右键 / Alt+左键） */
  onSamPointAdd?: (pt: { ix: number; iy: number; nw: number; nh: number; label: 0 | 1 }) => void;
  /** 框选提示（像素坐标，与 nw/nh 同源） */
  onSamBoxCommit?: (box: { x1: number; y1: number; x2: number; y2: number; nw: number; nh: number } | null) => void;
  /** 点选落在留白或无法映射像素时提示（避免「点了没反应」） */
  onSamPickHint?: (message: string) => void;
  /** 本机 SAM：已提交的提示点（归一化 0~1，与标注 doc 同源），用于官方示例式绿/红点 */
  samPickMarkers?: Array<{ nx: number; ny: number; label: 1 | 0 }>;
  /** 本机 SAM：框选提示（像素矩形，与 viewBox 对齐绘制） */
  samBoxPixels?: { x1: number; y1: number; x2: number; y2: number; nw: number; nh: number } | null;
  /** 本机 SAM：分割请求进行中（显示角标） */
  samPickProcessing?: boolean;
  /** 本机 SAM：叠在底图上的 mask PNG（与 viewBox 同源）；已保存版本与未保存预览共用，绘制成描边 + 半透明填充 */
  samMaskOverlayHref?: string;
  /** 全图自动拆分：悬停高亮、点击切换选中（mask 与图像同像素尺寸） */
  samAutoPick?: {
    maskDataUrls: string[];
    pickedIndices: readonly number[];
    hoverIndex: number | null;
    onHoverIndex: (i: number | null) => void;
    onTogglePick: (i: number) => void;
  } | null;
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
  onLocalEditAnchorClientChange,
  panoOverlayContainerRef,
  panoProjectionRef,
  panoViewerBindEpoch = 0,
  samPickAwaiting = false,
  samPickSubmode = 'point',
  onSamPointAdd,
  onSamBoxCommit,
  onSamPickHint,
  samPickMarkers,
  samBoxPixels = null,
  samPickProcessing = false,
  samMaskOverlayHref,
  samAutoPick = null,
}: ImageFlatAnnotationOverlayProps) {
  const [layoutTick, setLayoutTick] = useState(0);
  const [overlayPx, setOverlayPx] = useState({ w: 320, h: 240 });
  const [brushDraft, setBrushDraft] = useState<ImageOverlayNormPoint[] | null>(null);
  const [lassoDraft, setLassoDraft] = useState<ImageOverlayNormPoint[] | null>(null);
  const [localLassoDraft, setLocalLassoDraft] = useState<ImageOverlayNormPoint[] | null>(null);
  const [dragRect, setDragRect] = useState<DraftRect | null>(null);
  /** 全景 + 矩形裁切：相对叠层 0~1 的拖框（所见即所得导出） */
  const [panoCropDraft, setPanoCropDraft] = useState<DraftRect | null>(null);
  /** 全景 + 局部重绘：视口轴对齐框（与裁切同一套 0~1 坐标） */
  const [panoLocalEditDraft, setPanoLocalEditDraft] = useState<DraftRect | null>(null);
  /** 全景 + 局部套索：点在叠层 0~1 坐标 */
  const [panoLocalLassoDraft, setPanoLocalLassoDraft] = useState<ImageOverlayNormPoint[] | null>(null);
  /** 本机 SAM 框选拖拽（归一化 0~1，与 crop 矩形同源） */
  const [samBoxDraft, setSamBoxDraft] = useState<DraftRect | null>(null);
  /** 框选拖出 SVG 时仍跟手：`window` 级 pointer 监听 */
  const samBoxDragLiveRef = useRef<DraftRect | null>(null);
  const samBoxWindowCleanupRef = useRef<(() => void) | null>(null);
  const metricsSamRef = useRef<ReturnType<typeof getImgObjectContainMetrics>>(null);
  const eventToNormRef = useRef<(cx: number, cy: number) => { x: number; y: number } | null>(() => null);
  const onSamBoxCommitRef = useRef<typeof onSamBoxCommit>(onSamBoxCommit);
  const onSamPickHintRef = useRef<typeof onSamPickHint>(onSamPickHint);
  /** 自动拆分：像素 → mask 序号（小区域优先命中） */
  const samAutoIdMapRef = useRef<{ w: number; h: number; data: Uint8Array } | null>(null);
  onSamBoxCommitRef.current = onSamBoxCommit;
  onSamPickHintRef.current = onSamPickHint;
  /** 视口 client 坐标；框选/套索类工具激活时由 window pointermove 更新 */
  const [layoutCrosshairClient, setLayoutCrosshairClient] = useState<{ x: number; y: number } | null>(null);
  const crosshairMoveRafRef = useRef<number | null>(null);
  const crosshairMovePendingRef = useRef<{ x: number; y: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textEditId, setTextEditId] = useState<string | null>(null);
  const dragSelectRef = useRef<DragSelectRef | null>(null);
  const dragHistoryPrimedRef = useRef(false);
  const textEditIdRef = useRef<string | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    if (!onLocalEditAnchorClientChange) return;
    const host = panoOverlayContainerRef?.current;
    if (doc.panoLocalEditViewport && host) {
      const r = doc.panoLocalEditViewport;
      const br = host.getBoundingClientRect();
      const cx = br.left + (r.x + r.w / 2) * br.width;
      const cy = br.top + (r.y + r.h) * br.height;
      onLocalEditAnchorClientChange({ x: cx, y: cy });
      return;
    }
    const img = imgRef.current;
    if (!doc.localEdit || !img) {
      onLocalEditAnchorClientChange(null);
      return;
    }
    const proj = panoProjectionRef?.current;
    if (proj && host && panoOverlayContainerRef) {
      const m = getImgObjectContainMetrics(img);
      if (m) {
        const tight = tightPixelBBoxForLocalEdit(doc.localEdit, m.nw, m.nh);
        const nx = (tight.x + tight.w / 2) / m.nw;
        const ny = (tight.y + tight.h) / m.nh;
        const c = proj.equirectNormToClient(nx, ny);
        if (c) {
          onLocalEditAnchorClientChange(c);
          return;
        }
      }
    }
    const p = localEditSelectionBottomCenterClient(img, doc.localEdit);
    if (p) onLocalEditAnchorClientChange(p);
  }, [
    doc.localEdit,
    doc.panoLocalEditViewport,
    layoutKey,
    layoutTick,
    imgRef,
    onLocalEditAnchorClientChange,
    panoProjectionRef,
    panoOverlayContainerRef,
    panoViewerBindEpoch,
  ]);

  /** 父级提交后清空 localEdit 时，同步清掉套索/框选草稿，避免选区仍挂在图上 */
  useEffect(() => {
    if (doc.localEdit) return;
    setLocalLassoDraft(null);
  }, [doc.localEdit]);

  useEffect(() => {
    if (
      doc.panoLocalEditViewport ||
      (doc.panoLocalEditEquirect && doc.panoLocalEditEquirect.length >= 3) ||
      doc.panoLocalEditReproject
    ) {
      return;
    }
    setPanoLocalLassoDraft(null);
    setPanoLocalEditDraft(null);
  }, [doc.panoLocalEditViewport, doc.panoLocalEditEquirect, doc.panoLocalEditReproject]);

  useEffect(() => {
    if (doc.localEdit) return;
    if (tool === 'local_edit_rect' || tool === 'local_edit_ellipse') {
      setDragRect(null);
    }
  }, [doc.localEdit, tool]);

  useEffect(() => {
    return () => {
      samBoxWindowCleanupRef.current?.();
      samBoxWindowCleanupRef.current = null;
      samBoxDragLiveRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (tool !== 'crop_rect') setPanoCropDraft(null);
  }, [tool]);

  useEffect(() => {
    if (tool !== 'local_edit_rect' && tool !== 'local_edit_ellipse') setPanoLocalEditDraft(null);
  }, [tool]);

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

  useLayoutEffect(() => {
    const host = panoOverlayContainerRef?.current;
    const proj = panoProjectionRef?.current;
    if (!host || !proj) return;
    const measure = () => {
      setOverlayPx({ w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) });
      setLayoutTick((n) => n + 1);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(host);
    const unsub = proj.subscribeAnimation(measure);
    return () => {
      ro?.disconnect();
      unsub();
    };
  }, [panoOverlayContainerRef, panoProjectionRef, layoutKey, panoViewerBindEpoch]);

  const metrics = useMemo(() => {
    const img = imgRef.current;
    if (!img) return null;
    return getImgObjectContainMetrics(img);
  }, [imgRef, layoutKey, layoutTick]);
  metricsSamRef.current = metrics;

  const img = imgRef.current;
  const nw = metrics?.nw ?? 0;
  const nh = metrics?.nh ?? 0;
  const panoProj = panoProjectionRef?.current ?? null;
  const panoMode = Boolean(panoProj && panoOverlayContainerRef);
  const ready = Boolean(metrics && img && nw && nh && (!panoOverlayContainerRef || panoProj));

  useEffect(() => {
    if (!samAutoPick?.maskDataUrls?.length || panoMode) {
      samAutoIdMapRef.current = null;
      return;
    }
    const urls = samAutoPick.maskDataUrls;
    let cancelled = false;
    const loadImg = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('sam auto mask load'));
        const s = String(src || '').trim();
        if (!/^data:/i.test(s) && !/^blob:/i.test(s)) {
          im.crossOrigin = 'anonymous';
        }
        im.src = s;
      });
    void (async () => {
      try {
        const metas: { idx: number; area: number; data: Uint8ClampedArray; w: number; h: number }[] = [];
        let w0 = 0;
        let h0 = 0;
        for (let i = 0; i < urls.length; i++) {
          const im = await loadImg(urls[i]!);
          const w = im.naturalWidth || im.width;
          const h = im.naturalHeight || im.height;
          if (!w0) {
            w0 = w;
            h0 = h;
          }
          if (w !== w0 || h !== h0) continue;
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          if (!ctx) continue;
          ctx.drawImage(im, 0, 0);
          const idd = ctx.getImageData(0, 0, w, h);
          const d = idd.data;
          let a = 0;
          for (let p = 3; p < d.length; p += 4) {
            if (d[p]! > 127) a += 1;
          }
          metas.push({ idx: i, area: a, data: d, w, h });
        }
        if (cancelled || w0 < 1 || h0 < 1 || metas.length === 0) return;
        metas.sort((x, y) => x.area - y.area);
        const idmap = new Uint8Array(w0 * h0);
        for (const m of metas) {
          const idB = m.idx + 1;
          if (idB > 255) continue;
          const d = m.data;
          for (let p = 0, j = 0; p < d.length; p += 4, j++) {
            if (d[p + 3]! > 127) idmap[j] = idB;
          }
        }
        if (!cancelled) samAutoIdMapRef.current = { w: w0, h: h0, data: idmap };
      } catch {
        if (!cancelled) samAutoIdMapRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [samAutoPick?.maskDataUrls, panoMode]);

  const samAutoHitIndex = useCallback(
    (clientX: number, clientY: number): number | null => {
      const map = samAutoIdMapRef.current;
      if (!map || !img || !metrics) return null;
      const idx = imageNaturalIndicesFromClientPoint(img, clientX, clientY);
      if (!idx) return null;
      if (idx.ix < 0 || idx.iy < 0 || idx.ix >= map.w || idx.iy >= map.h) return null;
      const v = map.data[idx.iy * map.w + idx.ix]!;
      if (!v) return null;
      return v - 1;
    },
    [img, metrics]
  );

  const normToOverlayLocal = useCallback(
    (nx: number, ny: number) => {
      if (!panoMode || !panoProj || !panoOverlayContainerRef?.current) return null;
      const c = panoProj.equirectNormToClient(nx, ny);
      if (!c) return null;
      const r = panoOverlayContainerRef.current.getBoundingClientRect();
      return { x: c.x - r.left, y: c.y - r.top };
    },
    [panoMode, panoProj, panoOverlayContainerRef, layoutTick]
  );

  const pointerInPanoOverlay = useCallback(
    (clientX: number, clientY: number) => {
      const proj = panoProjectionRef?.current;
      const snapR = proj?.getSnapshotClientRect?.();
      if (snapR && snapR.width >= 1 && snapR.height >= 1) {
        return clientX >= snapR.left && clientX < snapR.right && clientY >= snapR.top && clientY < snapR.bottom;
      }
      const host = panoOverlayContainerRef?.current;
      if (!host) return false;
      const r = host.getBoundingClientRect();
      return clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom;
    },
    [panoOverlayContainerRef, panoProjectionRef]
  );

  const clientToPanoOverlayNorm = useCallback(
    (clientX: number, clientY: number) => {
      const proj = panoProjectionRef?.current;
      const viaCanvas = proj?.clientToSnapshotNorm?.(clientX, clientY);
      if (viaCanvas) return viaCanvas;
      const host = panoOverlayContainerRef?.current;
      if (!host) return null;
      const r = host.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return {
        x: (clientX - r.left) / r.width,
        y: (clientY - r.top) / r.height,
      };
    },
    [panoOverlayContainerRef, panoProjectionRef]
  );

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
    if (tool !== 'local_edit_lasso') setLocalLassoDraft(null);
  }, [tool]);

  useEffect(() => {
    if (!LAYOUT_CROSSHAIR_TOOLS.has(tool)) {
      if (crosshairMoveRafRef.current != null) {
        cancelAnimationFrame(crosshairMoveRafRef.current);
        crosshairMoveRafRef.current = null;
      }
      crosshairMovePendingRef.current = null;
      setLayoutCrosshairClient(null);
      return;
    }
    const flush = () => {
      crosshairMoveRafRef.current = null;
      const p = crosshairMovePendingRef.current;
      if (p) setLayoutCrosshairClient(p);
    };
    const onMove = (e: PointerEvent) => {
      crosshairMovePendingRef.current = { x: e.clientX, y: e.clientY };
      if (crosshairMoveRafRef.current == null) {
        crosshairMoveRafRef.current = requestAnimationFrame(flush);
      }
    };
    setLayoutCrosshairClient({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (crosshairMoveRafRef.current != null) cancelAnimationFrame(crosshairMoveRafRef.current);
      crosshairMoveRafRef.current = null;
      crosshairMovePendingRef.current = null;
      setLayoutCrosshairClient(null);
    };
  }, [tool]);

  useEffect(() => {
    if (
      tool !== 'local_edit_rect' &&
      tool !== 'local_edit_ellipse' &&
      tool !== 'local_edit_lasso'
    ) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isWorkflowEditableTarget(e.target)) return;
      e.preventDefault();
      setDragRect(null);
      setLocalLassoDraft(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
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
      if (panoMode && panoProj) {
        const p = panoProj.clientToEquirectNorm(clientX, clientY);
        return p ? { x: p.x, y: p.y } : null;
      }
      if (!img || !metrics) return null;
      const { x: lx, y: ly } = clientPointToElementLocal(clientX, clientY, img);
      const { nx, ny } = localToNaturalPoint(lx, ly, metrics);
      return naturalToNorm(nx, ny, metrics);
    },
    [panoMode, panoProj, img, metrics]
  );
  eventToNormRef.current = eventToNorm;

  const isInsideContent = useCallback(
    (clientX: number, clientY: number) => {
      if (panoMode && panoProj) return panoProj.clientToEquirectNorm(clientX, clientY) != null;
      if (!img || !metrics) return false;
      const { x: lx, y: ly } = clientPointToElementLocal(clientX, clientY, img);
      return localToNaturalPoint(lx, ly, metrics).inside;
    },
    [panoMode, panoProj, img, metrics]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (samPickAwaiting && !panoMode) {
        if (!img || !metrics) {
          onSamPickHint?.('分割：画布未就绪（请等待图片完全显示后再点）');
          return;
        }
        if (!isInsideContent(e.clientX, e.clientY)) {
          onSamPickHint?.('分割：请点击图内的有效区域（不要点在图片外的灰边上）');
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (samAutoPick?.maskDataUrls.length) {
          if (e.button !== 0) return;
          const hit = samAutoHitIndex(e.clientX, e.clientY);
          if (hit != null) samAutoPick.onTogglePick(hit);
          return;
        }
        if (samPickSubmode === 'box') {
          if (e.button !== 0) return;
          const p = eventToNorm(e.clientX, e.clientY);
          if (!p) {
            onSamPickHint?.('分割：无法读取点击位置（请稍等图片加载满后再点，或重开大图）');
            return;
          }
          samBoxWindowCleanupRef.current?.();
          const pid = e.pointerId;
          const el = e.currentTarget as HTMLElement;
          try {
            el.setPointerCapture?.(pid);
          } catch {
            /* noop */
          }
          const move = (ev: PointerEvent) => {
            if (ev.pointerId !== pid) return;
            ev.preventDefault();
            const norm = eventToNormRef.current(ev.clientX, ev.clientY);
            if (!norm) return;
            const prev = samBoxDragLiveRef.current;
            if (!prev) return;
            const next = { ...prev, x1: clamp01(norm.x), y1: clamp01(norm.y) };
            samBoxDragLiveRef.current = next;
            setSamBoxDraft(next);
          };
          const finish = (ev: PointerEvent) => {
            if (ev.pointerId !== pid) return;
            ev.preventDefault();
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', finish);
            samBoxWindowCleanupRef.current = null;
            try {
              el.releasePointerCapture?.(pid);
            } catch {
              /* noop */
            }
            const d = samBoxDragLiveRef.current;
            samBoxDragLiveRef.current = null;
            setSamBoxDraft(null);
            const m = metricsSamRef.current;
            if (!d || !m) {
              onSamBoxCommitRef.current?.(null);
              return;
            }
            const r = rectFromDrag({ x: d.x0, y: d.y0 }, { x: d.x1, y: d.y1 });
            if (r.w < 0.002 || r.h < 0.002) {
              onSamBoxCommitRef.current?.(null);
              return;
            }
            const { x1, y1, x2, y2 } = samNormRectToPixelBox(r, m.nw, m.nh);
            if (x2 - x1 < 1 || y2 - y1 < 1) {
              onSamBoxCommitRef.current?.(null);
              onSamPickHintRef.current?.('分割：框选太小，请拖大一点');
              return;
            }
            onSamBoxCommitRef.current?.({ x1, y1, x2, y2, nw: m.nw, nh: m.nh });
          };
          const cleanup = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', finish);
          };
          samBoxWindowCleanupRef.current = cleanup;
          window.addEventListener('pointermove', move, { passive: false });
          window.addEventListener('pointerup', finish);
          window.addEventListener('pointercancel', finish);
          const d0 = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
          samBoxDragLiveRef.current = d0;
          setSamBoxDraft(d0);
          return;
        }
        if (e.button !== 0 && e.button !== 2) return;
        const idx = imageNaturalIndicesFromClientPoint(img, e.clientX, e.clientY);
        if (!idx) {
          onSamPickHint?.('分割：无法读取点击位置（请稍等图片加载满后再点，或重开大图）');
          return;
        }
        if (e.button === 2) {
          e.preventDefault();
        }
        const label: 0 | 1 = e.button === 2 ? 0 : 1;
        onSamPointAdd?.({ ix: idx.ix, iy: idx.iy, nw: metrics.nw, nh: metrics.nh, label });
        return;
      }

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

      if (tool === 'crop_rect' && panoMode) {
        if (!pointerInPanoOverlay(e.clientX, e.clientY)) return;
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        const po = clientToPanoOverlayNorm(e.clientX, e.clientY);
        if (!po) return;
        setPanoCropDraft({ x0: po.x, y0: po.y, x1: po.x, y1: po.y });
        return;
      }

      if (panoMode && (tool === 'local_edit_rect' || tool === 'local_edit_ellipse')) {
        if (!pointerInPanoOverlay(e.clientX, e.clientY)) return;
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        const po = clientToPanoOverlayNorm(e.clientX, e.clientY);
        if (!po) return;
        setPanoLocalEditDraft({ x0: po.x, y0: po.y, x1: po.x, y1: po.y });
        return;
      }

      if (panoMode && tool === 'local_edit_lasso') {
        if (!pointerInPanoOverlay(e.clientX, e.clientY)) return;
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        const po = clientToPanoOverlayNorm(e.clientX, e.clientY);
        if (!po) return;
        setPanoLocalLassoDraft([po]);
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
      if (tool === 'local_edit_lasso') {
        setLocalLassoDraft([p]);
        return;
      }
      if (tool === 'annotate_rect' || tool === 'crop_rect' || tool === 'local_edit_rect' || tool === 'local_edit_ellipse') {
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
    [
      tool,
      ready,
      eventToNorm,
      isInsideContent,
      doc,
      nw,
      nh,
      color,
      onDocPatch,
      finalizeTextEdit,
      panoMode,
      pointerInPanoOverlay,
      clientToPanoOverlayNorm,
      samPickAwaiting,
      samPickSubmode,
      onSamPointAdd,
      onSamPickHint,
      img,
      metrics,
      panoMode,
      eventToNorm,
      samAutoPick,
      samAutoHitIndex,
    ]
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
      if (samPickAwaiting && samAutoPick?.maskDataUrls.length && !panoMode) {
        const hit = samAutoHitIndex(e.clientX, e.clientY);
        samAutoPick.onHoverIndex(hit);
        return;
      }

      if (tool === 'crop_rect' && panoCropDraft) {
        const po = clientToPanoOverlayNorm(e.clientX, e.clientY);
        if (!po) return;
        e.preventDefault();
        e.stopPropagation();
        setPanoCropDraft((d) => (d ? { ...d, x1: po.x, y1: po.y } : d));
        return;
      }

      if (panoMode && (tool === 'local_edit_rect' || tool === 'local_edit_ellipse') && panoLocalEditDraft) {
        const po = clientToPanoOverlayNorm(e.clientX, e.clientY);
        if (!po) return;
        e.preventDefault();
        e.stopPropagation();
        setPanoLocalEditDraft((d) => (d ? { ...d, x1: po.x, y1: po.y } : d));
        return;
      }

      if (panoMode && tool === 'local_edit_lasso' && panoLocalLassoDraft) {
        const po = clientToPanoOverlayNorm(e.clientX, e.clientY);
        if (!po) return;
        e.preventDefault();
        e.stopPropagation();
        const prev = panoLocalLassoDraft[panoLocalLassoDraft.length - 1];
        if (!prev || Math.hypot(prev.x - po.x, prev.y - po.y) > 0.002) {
          setPanoLocalLassoDraft((d) => (d ? [...d, po] : d));
        }
        return;
      }

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
      if (tool === 'local_edit_lasso' && localLassoDraft) {
        e.preventDefault();
        e.stopPropagation();
        const prev = localLassoDraft[localLassoDraft.length - 1];
        if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > 0.002) {
          setLocalLassoDraft((d) => (d ? [...d, p] : d));
        }
        return;
      }
      if (
        (tool === 'annotate_rect' ||
          tool === 'crop_rect' ||
          tool === 'local_edit_rect' ||
          tool === 'local_edit_ellipse') &&
        dragRect
      ) {
        e.preventDefault();
        e.stopPropagation();
        setDragRect((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
      }
    },
    [
      tool,
      eventToNorm,
      brushDraft,
      lassoDraft,
      localLassoDraft,
      dragRect,
      panoCropDraft,
      panoLocalEditDraft,
      panoLocalLassoDraft,
      panoMode,
      clientToPanoOverlayNorm,
      onDocPatch,
      onBeginDragGesture,
      samPickAwaiting,
      samAutoPick,
      samAutoHitIndex,
    ]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (tool === 'select') {
        dragSelectRef.current = null;
        dragHistoryPrimedRef.current = false;
        return;
      }
      if (tool === 'crop_rect' && panoCropDraft) {
        e.preventDefault();
        e.stopPropagation();
        const r = rectFromDrag(
          { x: panoCropDraft.x0, y: panoCropDraft.y0 },
          { x: panoCropDraft.x1, y: panoCropDraft.y1 }
        );
        setPanoCropDraft(null);
        if (r.w < 0.002 || r.h < 0.002) return;
        onDocPatch((prev) => ({
          ...prev,
          crops: [],
          panoViewportCrop: { x: r.x, y: r.y, w: r.w, h: r.h },
        }));
        return;
      }
      if (panoMode && (tool === 'local_edit_rect' || tool === 'local_edit_ellipse') && panoLocalEditDraft) {
        e.preventDefault();
        e.stopPropagation();
        const r = rectFromDrag(
          { x: panoLocalEditDraft.x0, y: panoLocalEditDraft.y0 },
          { x: panoLocalEditDraft.x1, y: panoLocalEditDraft.y1 }
        );
        setPanoLocalEditDraft(null);
        if (r.w < 0.002 || r.h < 0.002) return;
        const host = panoOverlayContainerRef?.current?.getBoundingClientRect();
        const proj = panoProjectionRef?.current;
        let equirect: ReturnType<typeof equirectLoopFromPanoOverlayRect> | undefined;
        if (host && proj) {
          const toUv = (cx: number, cy: number) => proj.clientToEquirectNorm(cx, cy);
          equirect =
            tool === 'local_edit_ellipse'
              ? equirectLoopFromPanoOverlayEllipse(r, host, toUv)
              : equirectLoopFromPanoOverlayRect(r, host, toUv);
        }
        const reproject = proj?.getReprojectSnapshot() ?? null;
        onDocPatch((prev) => ({
          ...prev,
          localEdit: null,
          panoLocalEditViewport: { x: r.x, y: r.y, w: r.w, h: r.h },
          panoLocalEditEquirect: equirect && equirect.length >= 3 ? equirect : undefined,
          panoLocalEditReproject: reproject ?? undefined,
        }));
        return;
      }
      if (panoMode && tool === 'local_edit_lasso' && panoLocalLassoDraft) {
        e.preventDefault();
        e.stopPropagation();
        const pts = panoLocalLassoDraft;
        setPanoLocalLassoDraft(null);
        if (pts.length < 3) return;
        let minX = 1;
        let minY = 1;
        let maxX = 0;
        let maxY = 0;
        for (const p of pts) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        const r = rectFromDrag({ x: minX, y: minY }, { x: maxX, y: maxY });
        if (r.w < 0.002 || r.h < 0.002) return;
        const host = panoOverlayContainerRef?.current?.getBoundingClientRect();
        const proj = panoProjectionRef?.current;
        const equirect =
          host && proj
            ? equirectLoopFromPanoOverlayPolyline(pts, true, host, (cx, cy) => proj.clientToEquirectNorm(cx, cy))
            : undefined;
        const reproject = proj?.getReprojectSnapshot() ?? null;
        onDocPatch((prev) => ({
          ...prev,
          localEdit: null,
          panoLocalEditViewport: { x: r.x, y: r.y, w: r.w, h: r.h },
          panoLocalEditEquirect: equirect && equirect.length >= 3 ? equirect : undefined,
          panoLocalEditReproject: reproject ?? undefined,
        }));
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
      if (tool === 'local_edit_lasso' && localLassoDraft) {
        e.preventDefault();
        e.stopPropagation();
        const pts = localLassoDraft;
        setLocalLassoDraft(null);
        if (pts.length < 3) return;
        const first = pts[0]!;
        const last = pts[pts.length - 1]!;
        const closed =
          Math.hypot(first.x - last.x, first.y - last.y) < 0.004 ? pts : [...pts, { ...first }];
        const poly: ImageLocalEditPolygon = { id: uuid(), kind: 'local_polygon', points: closed };
        onDocPatch((prev) => ({ ...prev, localEdit: poly }));
        return;
      }
      if ((tool === 'local_edit_rect' || tool === 'local_edit_ellipse') && dragRect) {
        e.preventDefault();
        e.stopPropagation();
        const r = rectFromDrag({ x: dragRect.x0, y: dragRect.y0 }, { x: dragRect.x1, y: dragRect.y1 });
        setDragRect(null);
        if (r.w < 0.002 || r.h < 0.002) return;
        const id = uuid();
        if (tool === 'local_edit_rect') {
          onDocPatch((prev) => ({ ...prev, localEdit: { id, kind: 'local_rect', ...r } }));
        } else {
          onDocPatch((prev) => ({ ...prev, localEdit: { id, kind: 'local_ellipse', ...r } }));
        }
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
          onDocPatch((prev) => ({
            ...prev,
            crops: [...prev.crops, crop],
            panoViewportCrop: undefined,
          }));
        }
      }
    },
    [
      tool,
      brushDraft,
      lassoDraft,
      localLassoDraft,
      dragRect,
      panoCropDraft,
      panoLocalEditDraft,
      panoLocalLassoDraft,
      panoMode,
      brushWidth,
      color,
      onDocPatch,
      panoOverlayContainerRef,
      panoProjectionRef,
    ]
  );

  if (!ready && !samPickAwaiting) return null;

  const pe = tool === 'off' && !samPickAwaiting ? 'none' : 'auto';
  const selStroke = 'rgba(34,211,238,0.95)';
  const vx = panoMode ? overlayPx.w : nw;
  const vy = panoMode ? overlayPx.h : nh;

  /** 武装点选但几何未就绪：占位层避免静默穿透到下层 img 触发缩放 */
  if (!ready && samPickAwaiting && !panoMode) {
    return (
      <>
        <div
          className="absolute inset-0 z-[1] flex cursor-crosshair items-center justify-center bg-black/20 pointer-events-auto"
          data-image-preview-no-wheel
          onPointerDown={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onSamPickHint?.('本机分割：正在同步画布尺寸，请待大图加载完成后再点击');
          }}
        >
          <span className="rounded-md bg-black/75 px-3 py-2 text-xs text-white/90 shadow-lg">
            准备画布…
          </span>
        </div>
      </>
    );
  }

  if (!ready) return null;

  const samMr = Math.max(4, Math.min(vx, vy) * 0.018);
  const samMarkersFlat =
    !panoMode && samPickMarkers && samPickMarkers.length > 0
      ? samPickMarkers.map((m, i) => {
          const cx = m.nx * vx;
          const cy = m.ny * vy;
          const fill = m.label === 1 ? '#22c55e' : '#ef4444';
          return (
            <g key={`sam-m-${i}`} pointerEvents="none">
              <circle cx={cx} cy={cy} r={samMr + 2} fill="rgba(0,0,0,0.35)" />
              <circle
                cx={cx}
                cy={cy}
                r={samMr}
                fill={fill}
                stroke="rgba(255,255,255,0.95)"
                strokeWidth={Math.max(1.2, samMr * 0.12)}
              />
            </g>
          );
        })
      : null;

  const samMaskLayoutSafe = layoutKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  const samMaskFillMaskId = `samMaskFill_${samMaskLayoutSafe}`;
  const samOutlineFilterId = `samOutline_${samMaskLayoutSafe}`;
  const samOutlineDilateR = Math.max(1.2, Math.min(vx, vy) * 0.0035);
  const samOutlinePad = Math.ceil(samOutlineDilateR * 4);

  const samBoxFlatOverlay =
    !panoMode && samBoxPixels && samBoxPixels.nw > 0 && samBoxPixels.nh > 0
      ? (() => {
          const { x1, y1, x2, y2, nw: bw, nh: bh } = samBoxPixels;
          const sx = vx / Math.max(1, bw);
          const sy = vy / Math.max(1, bh);
          const xa = Math.min(x1, x2) * sx;
          const ya = Math.min(y1, y2) * sy;
          const wb = Math.abs(x2 - x1) * sx;
          const hb = Math.abs(y2 - y1) * sy;
          const swd = Math.max(1, Math.min(vx, vy) * 0.004);
          return (
            <rect
              x={xa}
              y={ya}
              width={wb}
              height={hb}
              fill="rgba(34,211,238,0.12)"
              stroke="rgba(34,211,238,0.95)"
              strokeWidth={swd}
              strokeDasharray="5 4"
              pointerEvents="none"
            />
          );
        })()
      : null;

  const samBoxDraftOverlay =
    !panoMode && samPickAwaiting && samBoxDraft
      ? (() => {
          const r = rectFromDrag(
            { x: samBoxDraft.x0, y: samBoxDraft.y0 },
            { x: samBoxDraft.x1, y: samBoxDraft.y1 }
          );
          const swd = Math.max(1, Math.min(vx, vy) * 0.004);
          return (
            <rect
              x={r.x * vx}
              y={r.y * vy}
              width={r.w * vx}
              height={r.h * vy}
              fill="rgba(34,211,238,0.08)"
              stroke="rgba(34,211,238,0.85)"
              strokeWidth={swd}
              strokeDasharray="4 3"
              pointerEvents="none"
            />
          );
        })()
      : null;

  const selSw = Math.max(2, Math.min(nw, nh) * 0.005);
  const selSwPano = Math.max(2, Math.min(vx, vy) * 0.005);

  const brushPathFromNormPoints = (pts: ImageOverlayNormPoint[], strokeW: number, stroke: string, isSel: boolean) => {
    const parts: string[] = [];
    let penUp = true;
    for (const q of pts) {
      const l = panoMode ? normToOverlayLocal(q.x, q.y) : { x: q.x * nw, y: q.y * nh };
      if (!l) {
        penUp = true;
        continue;
      }
      parts.push(`${penUp ? 'M' : 'L'} ${l.x} ${l.y}`);
      penUp = false;
    }
    const d = parts.join(' ');
    if (!d || parts.length < 2) return null;
    return (
      <g>
        {isSel ? (
          <path
            d={d}
            fill="none"
            stroke={selStroke}
            strokeWidth={strokeW + selSwPano * 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.45}
            pointerEvents="none"
          />
        ) : null}
        <path
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeW}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    );
  };

  const renderItem = (it: ImageOverlayAnnotationDoc['items'][number], isSel: boolean) => {
    if (it.kind === 'rect') {
      if (panoMode) {
        const c00 = normToOverlayLocal(it.x, it.y);
        const c10 = normToOverlayLocal(it.x + it.w, it.y);
        const c11 = normToOverlayLocal(it.x + it.w, it.y + it.h);
        const c01 = normToOverlayLocal(it.x, it.y + it.h);
        if (!c00 || !c10 || !c11 || !c01) return null;
        const ptsStr = `${c00.x},${c00.y} ${c10.x},${c10.y} ${c11.x},${c11.y} ${c01.x},${c01.y}`;
        return (
          <g key={it.id}>
            {isSel ? (
              <polygon
                points={ptsStr}
                fill="none"
                stroke={selStroke}
                strokeWidth={selSwPano}
                strokeDasharray="6 4"
                pointerEvents="none"
              />
            ) : null}
            <polygon points={ptsStr} fill="none" stroke={it.stroke} strokeWidth={it.sw} />
          </g>
        );
      }
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
      if (panoMode) {
        const g = brushPathFromNormPoints(it.points, it.sw, it.stroke, isSel);
        return g ? <g key={it.id}>{g}</g> : null;
      }
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
    const tPos = panoMode ? normToOverlayLocal(it.x, it.y) : { x: it.x * nw, y: it.y * nh };
    if (!tPos) return <g key={it.id} />;
    const fs = panoMode ? Math.max(10, it.size * (overlayPx.w / nw)) : it.size;
    const swT = panoMode ? selSwPano : selSw;
    return (
      <g key={it.id}>
        {isSel ? (
          <text
            x={tPos.x}
            y={tPos.y}
            fill="none"
            stroke={selStroke}
            strokeWidth={swT}
            fontSize={fs}
            style={{ paintOrder: 'stroke fill', userSelect: 'none' }}
            pointerEvents="none"
          >
            {it.text}
          </text>
        ) : null}
        <text
          x={tPos.x}
          y={tPos.y}
          fill={it.fill}
          fontSize={fs}
          style={{ userSelect: 'none', paintOrder: 'stroke fill' }}
          stroke="rgba(0,0,0,0.35)"
          strokeWidth={Math.max(1, fs * 0.06)}
        >
          {it.text}
        </text>
      </g>
    );
  };

  const renderCrop = (c: ImageOverlayAnnotationDoc['crops'][number], isSel: boolean) => {
    if (c.kind === 'crop_rect') {
      if (panoMode) {
        const c00 = normToOverlayLocal(c.x, c.y);
        const c10 = normToOverlayLocal(c.x + c.w, c.y);
        const c11 = normToOverlayLocal(c.x + c.w, c.y + c.h);
        const c01 = normToOverlayLocal(c.x, c.y + c.h);
        if (!c00 || !c10 || !c11 || !c01) return null;
        const ptsStr = `${c00.x},${c00.y} ${c10.x},${c10.y} ${c11.x},${c11.y} ${c01.x},${c01.y}`;
        const swO = Math.max(1, Math.min(vx, vy) * 0.004);
        return (
          <g key={c.id}>
            {isSel ? (
              <polygon
                points={ptsStr}
                fill="rgba(34,211,238,0.06)"
                stroke={selStroke}
                strokeWidth={selSwPano}
                strokeDasharray="4 3"
                pointerEvents="none"
              />
            ) : null}
            <polygon
              points={ptsStr}
              fill="rgba(251,146,60,0.12)"
              stroke="rgba(251,146,60,0.95)"
              strokeWidth={swO}
              strokeDasharray="6 4"
            />
          </g>
        );
      }
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
    const pts = panoMode
      ? c.points
          .map((p) => normToOverlayLocal(p.x, p.y))
          .filter((x): x is { x: number; y: number } => x != null)
          .map((p) => `${p.x},${p.y}`)
          .join(' ')
      : c.points.map((p) => `${p.x * nw},${p.y * nh}`).join(' ');
    if (panoMode && !pts.trim()) return null;
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

  const renderLocalEdit = (sel: ImageLocalEditSelection) => {
    const sw = panoMode ? Math.max(1, Math.min(vx, vy) * 0.004) : Math.max(1, Math.min(nw, nh) * 0.004);
    const stroke = 'rgba(16,185,129,0.95)';
    const fill = 'rgba(16,185,129,0.14)';
    if (sel.kind === 'local_rect') {
      if (panoMode) {
        const c00 = normToOverlayLocal(sel.x, sel.y);
        const c10 = normToOverlayLocal(sel.x + sel.w, sel.y);
        const c11 = normToOverlayLocal(sel.x + sel.w, sel.y + sel.h);
        const c01 = normToOverlayLocal(sel.x, sel.y + sel.h);
        if (!c00 || !c10 || !c11 || !c01) return null;
        const ptsStr = `${c00.x},${c00.y} ${c10.x},${c10.y} ${c11.x},${c11.y} ${c01.x},${c01.y}`;
        return (
          <g key="local-edit">
            <polygon points={ptsStr} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray="5 4" />
          </g>
        );
      }
      return (
        <g key="local-edit">
          <rect
            x={sel.x * nw}
            y={sel.y * nh}
            width={sel.w * nw}
            height={sel.h * nh}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
            strokeDasharray="5 4"
          />
        </g>
      );
    }
    if (sel.kind === 'local_ellipse') {
      if (panoMode) {
        const cxN = sel.x + sel.w / 2;
        const cyN = sel.y + sel.h / 2;
        const rxN = Math.abs(sel.w) / 2;
        const ryN = Math.abs(sel.h) / 2;
        const steps = 28;
        const poly: string[] = [];
        for (let i = 0; i <= steps; i += 1) {
          const t = (i / steps) * Math.PI * 2;
          const l = normToOverlayLocal(cxN + rxN * Math.cos(t), cyN + ryN * Math.sin(t));
          if (l) poly.push(`${l.x},${l.y}`);
        }
        if (poly.length < 3) return null;
        return (
          <g key="local-edit">
            <polygon points={poly.join(' ')} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray="5 4" />
          </g>
        );
      }
      const cx = (sel.x + sel.w / 2) * nw;
      const cy = (sel.y + sel.h / 2) * nh;
      const rx = (Math.abs(sel.w) * nw) / 2;
      const ry = (Math.abs(sel.h) * nh) / 2;
      return (
        <g key="local-edit">
          <ellipse
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
            strokeDasharray="5 4"
          />
        </g>
      );
    }
    if (sel.points.length < 3) return null;
    const pts = panoMode
      ? sel.points
          .map((p) => normToOverlayLocal(p.x, p.y))
          .filter((x): x is { x: number; y: number } => x != null)
          .map((p) => `${p.x},${p.y}`)
          .join(' ')
      : sel.points.map((p) => `${p.x * nw},${p.y * nh}`).join(' ');
    if (panoMode && !pts.trim()) return null;
    return (
      <g key="local-edit">
        <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray="5 4" />
      </g>
    );
  };

  const editTextItem =
    textEditId && metrics
      ? (doc.items.find((x) => x.id === textEditId && x.kind === 'text') as ImageOverlayTextItem | undefined)
      : undefined;
  const editFontPx =
    editTextItem && metrics
      ? Math.max(
          10,
          panoMode ? editTextItem.size * (overlayPx.w / metrics.nw) : editTextItem.size * (metrics.drawW / metrics.nw)
        )
      : 12;

  const layoutCrosshairPortal =
    LAYOUT_CROSSHAIR_TOOLS.has(tool) && layoutCrosshairClient && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="pointer-events-none fixed inset-0"
            style={{ zIndex: IMAGE_LAYOUT_CROSSHAIR_Z }}
            aria-hidden
          >
            <div
              className="absolute bg-white/[0.45]"
              style={{
                left: layoutCrosshairClient.x,
                top: 0,
                width: 1,
                height: '100%',
                transform: 'translateX(-0.5px)',
              }}
            />
            <div
              className="absolute bg-white/[0.45]"
              style={{
                left: 0,
                top: layoutCrosshairClient.y,
                width: '100%',
                height: 1,
                transform: 'translateY(-0.5px)',
              }}
            />
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {layoutCrosshairPortal}
      <div
        className={`absolute inset-0 z-[1] ${pe === 'none' ? 'pointer-events-none' : 'pointer-events-auto'}`}
        data-image-preview-no-wheel
      >
      <svg
        className={`h-full w-full select-none ${samPickAwaiting ? 'cursor-crosshair' : ''} ${tool === 'select' ? 'cursor-grab active:cursor-grabbing' : ''} ${pe === 'none' ? 'pointer-events-none' : 'pointer-events-auto'}`}
        style={{ touchAction: tool === 'off' && !samPickAwaiting ? 'auto' : 'none' }}
        viewBox={`0 0 ${vx} ${vy}`}
        preserveAspectRatio={panoMode ? 'none' : 'xMidYMid meet'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onSvgDoubleClick}
        onPointerLeave={() => {
          samAutoPick?.onHoverIndex(null);
        }}
        onContextMenu={(ev) => {
          if (samPickAwaiting && !panoMode) {
            ev.preventDefault();
          }
        }}
      >
        {!panoMode && samMaskOverlayHref ? (
          <defs>
            <mask
              id={samMaskFillMaskId}
              maskUnits="userSpaceOnUse"
              maskContentUnits="userSpaceOnUse"
              x={0}
              y={0}
              width={vx}
              height={vy}
            >
              <image
                href={samMaskOverlayHref}
                x={0}
                y={0}
                width={vx}
                height={vy}
                preserveAspectRatio="xMidYMid meet"
              />
            </mask>
            <filter
              id={samOutlineFilterId}
              filterUnits="userSpaceOnUse"
              x={-samOutlinePad}
              y={-samOutlinePad}
              width={vx + samOutlinePad * 2}
              height={vy + samOutlinePad * 2}
              colorInterpolationFilters="sRGB"
            >
              <feMorphology
                in="SourceAlpha"
                operator="dilate"
                radius={samOutlineDilateR}
                result="samDilated"
              />
              <feComposite in="samDilated" in2="SourceAlpha" operator="out" result="samRing" />
              <feFlood floodColor="#ffffff" floodOpacity="0.92" result="samFlood" />
              <feComposite in="samFlood" in2="samRing" operator="in" result="samStroke" />
              <feMerge>
                <feMergeNode in="samStroke" />
              </feMerge>
            </filter>
          </defs>
        ) : null}
        {!panoMode && samMaskOverlayHref ? (
          <g pointerEvents="none">
            <rect
              x={0}
              y={0}
              width={vx}
              height={vy}
              fill="rgba(34, 211, 238, 0.34)"
              mask={`url(#${samMaskFillMaskId})`}
            />
            <image
              href={samMaskOverlayHref}
              x={0}
              y={0}
              width={vx}
              height={vy}
              preserveAspectRatio="xMidYMid meet"
              filter={`url(#${samOutlineFilterId})`}
            />
          </g>
        ) : null}
        {doc.items.map((it) => renderItem(it, selectedId === it.id))}
        {doc.crops.map((c) => renderCrop(c, selectedId === c.id))}
        {doc.localEdit ? renderLocalEdit(doc.localEdit) : null}
        {doc.panoViewportCrop && panoMode ? (
          <rect
            x={doc.panoViewportCrop.x * vx}
            y={doc.panoViewportCrop.y * vy}
            width={doc.panoViewportCrop.w * vx}
            height={doc.panoViewportCrop.h * vy}
            fill="rgba(251,146,60,0.15)"
            stroke="rgba(251,146,60,0.95)"
            strokeWidth={Math.max(1, Math.min(vx, vy) * 0.004)}
            strokeDasharray="6 4"
          />
        ) : null}
        {doc.panoLocalEditViewport && panoMode ? (
          <rect
            x={doc.panoLocalEditViewport.x * vx}
            y={doc.panoLocalEditViewport.y * vy}
            width={doc.panoLocalEditViewport.w * vx}
            height={doc.panoLocalEditViewport.h * vy}
            fill="rgba(16,185,129,0.12)"
            stroke="rgba(16,185,129,0.95)"
            strokeWidth={Math.max(1, Math.min(vx, vy) * 0.004)}
            strokeDasharray="5 4"
          />
        ) : null}
        {panoCropDraft ? (
          (() => {
            const r = rectFromDrag(
              { x: panoCropDraft.x0, y: panoCropDraft.y0 },
              { x: panoCropDraft.x1, y: panoCropDraft.y1 }
            );
            const swd = Math.max(1, Math.min(vx, vy) * 0.004);
            return (
              <rect
                x={r.x * vx}
                y={r.y * vy}
                width={r.w * vx}
                height={r.h * vy}
                fill="rgba(251,146,60,0.1)"
                stroke="rgba(251,146,60,0.9)"
                strokeWidth={swd}
                strokeDasharray="4 3"
              />
            );
          })()
        ) : null}
        {panoLocalEditDraft ? (
          (() => {
            const r = rectFromDrag(
              { x: panoLocalEditDraft.x0, y: panoLocalEditDraft.y0 },
              { x: panoLocalEditDraft.x1, y: panoLocalEditDraft.y1 }
            );
            const swd = Math.max(1, Math.min(vx, vy) * 0.004);
            return (
              <rect
                x={r.x * vx}
                y={r.y * vy}
                width={r.w * vx}
                height={r.h * vy}
                fill="rgba(16,185,129,0.08)"
                stroke="rgba(16,185,129,0.9)"
                strokeWidth={swd}
                strokeDasharray="4 3"
              />
            );
          })()
        ) : null}
        {dragRect ? (
          (() => {
            const r = rectFromDrag({ x: dragRect.x0, y: dragRect.y0 }, { x: dragRect.x1, y: dragRect.y1 });
            const swd = panoMode ? Math.max(1, Math.min(vx, vy) * 0.004) : Math.max(1, Math.min(nw, nh) * 0.004);
            if (panoMode) {
              if (tool === 'local_edit_ellipse') {
                const cxN = r.x + r.w / 2;
                const cyN = r.y + r.h / 2;
                const rxN = r.w / 2;
                const ryN = r.h / 2;
                const steps = 24;
                const poly: string[] = [];
                for (let i = 0; i <= steps; i += 1) {
                  const t = (i / steps) * Math.PI * 2;
                  const l = normToOverlayLocal(cxN + rxN * Math.cos(t), cyN + ryN * Math.sin(t));
                  if (l) poly.push(`${l.x},${l.y}`);
                }
                if (poly.length < 3) return null;
                return (
                  <polygon
                    points={poly.join(' ')}
                    fill="rgba(16,185,129,0.1)"
                    stroke="rgba(16,185,129,0.92)"
                    strokeWidth={swd}
                    strokeDasharray="4 3"
                  />
                );
              }
              if (tool === 'local_edit_rect' || tool === 'annotate_rect' || tool === 'crop_rect') {
                const c00 = normToOverlayLocal(r.x, r.y);
                const c10 = normToOverlayLocal(r.x + r.w, r.y);
                const c11 = normToOverlayLocal(r.x + r.w, r.y + r.h);
                const c01 = normToOverlayLocal(r.x, r.y + r.h);
                if (!c00 || !c10 || !c11 || !c01) return null;
                const ptsStr = `${c00.x},${c00.y} ${c10.x},${c10.y} ${c11.x},${c11.y} ${c01.x},${c01.y}`;
                const fillC =
                  tool === 'crop_rect'
                    ? 'rgba(251,146,60,0.1)'
                    : tool === 'local_edit_rect'
                      ? 'rgba(16,185,129,0.1)'
                      : 'rgba(59,130,246,0.08)';
                const strokeC =
                  tool === 'crop_rect' ? 'rgba(251,146,60,0.9)' : tool === 'annotate_rect' ? color : 'rgba(16,185,129,0.92)';
                return <polygon points={ptsStr} fill={fillC} stroke={strokeC} strokeWidth={swd} strokeDasharray="4 3" />;
              }
            }
            if (tool === 'local_edit_ellipse') {
              const cx = (r.x + r.w / 2) * nw;
              const cy = (r.y + r.h / 2) * nh;
              const rx = (r.w * nw) / 2;
              const ry = (r.h * nh) / 2;
              return (
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={rx}
                  ry={ry}
                  fill="rgba(16,185,129,0.1)"
                  stroke="rgba(16,185,129,0.92)"
                  strokeWidth={swd}
                  strokeDasharray="4 3"
                />
              );
            }
            if (tool === 'local_edit_rect') {
              return (
                <rect
                  x={r.x * nw}
                  y={r.y * nh}
                  width={r.w * nw}
                  height={r.h * nh}
                  fill="rgba(16,185,129,0.1)"
                  stroke="rgba(16,185,129,0.92)"
                  strokeWidth={swd}
                  strokeDasharray="4 3"
                />
              );
            }
            return (
              <rect
                x={r.x * nw}
                y={r.y * nh}
                width={r.w * nw}
                height={r.h * nh}
                fill={tool === 'crop_rect' ? 'rgba(251,146,60,0.1)' : 'rgba(59,130,246,0.08)'}
                stroke={tool === 'crop_rect' ? 'rgba(251,146,60,0.9)' : color}
                strokeWidth={swd}
                strokeDasharray="4 3"
              />
            );
          })()
        ) : null}
        {tool === 'brush' && brushDraft && brushDraft.length > 1 ? (
          (() => {
            const g = brushPathFromNormPoints(brushDraft, brushWidth, color, false);
            return g ? <g>{g}</g> : null;
          })()
        ) : null}
        {tool === 'crop_lasso' && lassoDraft && lassoDraft.length > 1 ? (
          (() => {
            const g = brushPathFromNormPoints(
              lassoDraft,
              Math.max(1, Math.min(vx, vy) * 0.004),
              'rgba(251,146,60,0.95)',
              false
            );
            return g ? <g>{g}</g> : null;
          })()
        ) : null}
        {tool === 'local_edit_lasso' && localLassoDraft && localLassoDraft.length > 1 ? (
          (() => {
            const g = brushPathFromNormPoints(
              localLassoDraft,
              Math.max(1, Math.min(vx, vy) * 0.004),
              'rgba(16,185,129,0.95)',
              false
            );
            return g ? <g>{g}</g> : null;
          })()
        ) : null}
        {panoMode && tool === 'local_edit_lasso' && panoLocalLassoDraft && panoLocalLassoDraft.length > 1 ? (
          <polyline
            points={panoLocalLassoDraft.map((p) => `${p.x * vx},${p.y * vy}`).join(' ')}
            fill="none"
            stroke="rgba(16,185,129,0.95)"
            strokeWidth={Math.max(1, Math.min(vx, vy) * 0.004)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {samBoxFlatOverlay}
        {samBoxDraftOverlay}
        {samMarkersFlat}
      </svg>
      {samPickProcessing ? (
        <div className="pointer-events-none absolute left-2 top-2 z-[20] rounded-md border border-white/20 bg-black/75 px-2.5 py-1 text-[11px] font-medium text-emerald-200/95 shadow-lg backdrop-blur-[2px]">
          本机分割中…
        </div>
      ) : null}
      {editTextItem && metrics ? (
        <input
          key={textEditId}
          ref={textInputRef}
          type="text"
          defaultValue={editTextItem.text}
          placeholder="输入文字"
          className="pointer-events-auto absolute z-[30] box-border min-w-[7rem] max-w-[min(22rem,calc(55vw))] rounded-md border border-white/25 bg-black/70 px-1.5 py-0.5 text-left shadow-lg outline-none ring-0 backdrop-blur-[2px] placeholder:text-white/40"
          style={
            panoMode
              ? (() => {
                  const lp = normToOverlayLocal(editTextItem.x, editTextItem.y);
                  if (!lp) return { display: 'none' };
                  return {
                    left: lp.x,
                    top: lp.y - editFontPx * 0.78,
                    fontSize: editFontPx,
                    lineHeight: 1.25,
                    color: editTextItem.fill,
                    textShadow: '0 0 2px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,0.85)',
                  };
                })()
              : {
                  left: metrics.offsetX + editTextItem.x * metrics.drawW,
                  top: metrics.offsetY + editTextItem.y * metrics.drawH - editFontPx * 0.78,
                  fontSize: editFontPx,
                  lineHeight: 1.25,
                  color: editTextItem.fill,
                  textShadow: '0 0 2px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,0.85)',
                }
          }
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
    </>
  );
}
