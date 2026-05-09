import type { PanoramaViewportProjection } from './panoViewportProjection';
import type { PanoLocalEditEquirectSample, PanoViewportCropNorm } from '../types';

function wrap01(u: number): number {
  let x = u % 1;
  if (x < 0) x += 1;
  return x;
}

function clamp01n(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** u∈[0,1] 上按最短弧插值（跨 360° 接缝） */
export function unwrapLerpU(u0: number, u1: number, t: number): number {
  let d = u1 - u0;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return u0 + t * d;
}

/** 屏幕叠层轴对齐框 → 沿边密采样后投到等距柱 UV（闭合环） */
export function equirectLoopFromPanoOverlayRect(
  r: { x: number; y: number; w: number; h: number },
  host: DOMRect,
  clientToEquirect: (clientX: number, clientY: number) => { x: number; y: number } | null,
  segmentsPerEdge = 20
): PanoLocalEditEquirectSample[] {
  const out: PanoLocalEditEquirectSample[] = [];
  const pushEdge = (nx0: number, ny0: number, nx1: number, ny1: number) => {
    for (let i = 0; i < segmentsPerEdge; i += 1) {
      const t = i / segmentsPerEdge;
      const nx = nx0 + t * (nx1 - nx0);
      const ny = ny0 + t * (ny1 - ny0);
      const cx = host.left + nx * host.width;
      const cy = host.top + ny * host.height;
      const uv = clientToEquirect(cx, cy);
      if (uv) out.push({ u: wrap01(uv.x), v: clamp01n(uv.y) });
    }
  };
  const { x, y, w, h } = r;
  pushEdge(x, y, x + w, y);
  pushEdge(x + w, y, x + w, y + h);
  pushEdge(x + w, y + h, x, y + h);
  pushEdge(x, y + h, x, y);
  return out;
}

export function equirectLoopFromPanoOverlayEllipse(
  r: { x: number; y: number; w: number; h: number },
  host: DOMRect,
  clientToEquirect: (clientX: number, clientY: number) => { x: number; y: number } | null,
  segments = 48
): PanoLocalEditEquirectSample[] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rx = r.w / 2;
  const ry = r.h / 2;
  const out: PanoLocalEditEquirectSample[] = [];
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    const nx = cx + rx * Math.cos(t);
    const ny = cy + ry * Math.sin(t);
    const clientX = host.left + nx * host.width;
    const clientY = host.top + ny * host.height;
    const uv = clientToEquirect(clientX, clientY);
    if (uv) out.push({ u: wrap01(uv.x), v: clamp01n(uv.y) });
  }
  return out;
}

export function equirectLoopFromPanoOverlayPolyline(
  pts: Array<{ x: number; y: number }>,
  closed: boolean,
  host: DOMRect,
  clientToEquirect: (clientX: number, clientY: number) => { x: number; y: number } | null,
  segmentsPerEdge = 8
): PanoLocalEditEquirectSample[] {
  const out: PanoLocalEditEquirectSample[] = [];
  const n = pts.length;
  if (n < 2) return out;
  const edgeCount = closed ? n : n - 1;
  for (let i = 0; i < edgeCount; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    for (let s = 0; s < segmentsPerEdge; s += 1) {
      const t = s / segmentsPerEdge;
      const nx = a.x + t * (b.x - a.x);
      const ny = a.y + t * (b.y - a.y);
      const cx = host.left + nx * host.width;
      const cy = host.top + ny * host.height;
      const uv = clientToEquirect(cx, cy);
      if (uv) out.push({ u: wrap01(uv.x), v: clamp01n(uv.y) });
    }
  }
  return out;
}

/**
 * 将闭合 UV 环密化后，用**当前**全景相机投到快照画布 0~1，取轴对齐包围盒（用于 `rasterizePanoLocalEditCropFromSnapshot`）。
 */
export function snapshotViewportNormFromEquirectLoop(
  proj: PanoramaViewportProjection,
  loop: PanoLocalEditEquirectSample[]
): PanoViewportCropNorm | null {
  if (loop.length < 3) return null;
  const dense: PanoLocalEditEquirectSample[] = [];
  const m = loop.length;
  const segs = 12;
  for (let i = 0; i < m; i += 1) {
    const a = loop[i]!;
    const b = loop[(i + 1) % m]!;
    for (let s = 0; s < segs; s += 1) {
      const t = s / segs;
      const u = unwrapLerpU(a.u, b.u, t);
      const v = a.v + t * (b.v - a.v);
      dense.push({ u: wrap01(u), v: clamp01n(v) });
    }
  }
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  let any = false;
  for (const p of dense) {
    const c = proj.equirectNormToClient(p.u, p.v);
    if (!c) continue;
    const n = proj.clientToSnapshotNorm(c.x, c.y);
    if (!n) continue;
    any = true;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  if (!any) return null;
  const x = clamp01n(Math.min(minX, maxX));
  const y = clamp01n(Math.min(minY, maxY));
  const w = clamp01n(Math.max(minX, maxX)) - x;
  const h = clamp01n(Math.max(minY, maxY)) - y;
  if (w < 0.001 || h < 0.001) return null;
  return { x, y, w, h };
}
