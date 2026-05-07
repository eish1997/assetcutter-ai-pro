import type {
  ImageOverlayAnnotationDoc,
  ImageOverlayBrushItem,
  ImageOverlayCropPolygon,
  ImageOverlayCropRect,
  ImageOverlayNormPoint,
  ImageOverlayRectItem,
  ImageOverlayTextItem,
} from '../types';

export type OverlayHitTarget = { kind: 'item' | 'crop'; id: string };

function pointInPolygon(px: number, py: number, pts: ImageOverlayNormPoint[]): boolean {
  if (pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i]!.x;
    const yi = pts[i]!.y;
    const xj = pts[j]!.x;
    const yj = pts[j]!.y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby + 1e-12;
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + abx * t;
  const qy = ay + aby * t;
  return Math.hypot(px - qx, py - qy);
}

/** 以「图像较短边」为基准的命中容差（归一化空间） */
function normHitSlop(nw: number, nh: number, pxSlop = 10): number {
  return pxSlop / Math.max(1, Math.min(nw, nh));
}

function hitRectItem(p: ImageOverlayNormPoint, it: ImageOverlayRectItem, nw: number, nh: number): boolean {
  const slop = normHitSlop(nw, nh, 12) + (it.sw / Math.max(1, Math.min(nw, nh))) * 0.5;
  const x0 = it.x;
  const y0 = it.y;
  const x1 = it.x + it.w;
  const y1 = it.y + it.h;
  const l = Math.min(x0, x1);
  const r = Math.max(x0, x1);
  const t = Math.min(y0, y1);
  const b = Math.max(y0, y1);
  if (p.x >= l && p.x <= r && p.y >= t && p.y <= b) return true;
  // 边框附近
  const nearL = Math.abs(p.x - l) <= slop && p.y >= t - slop && p.y <= b + slop;
  const nearR = Math.abs(p.x - r) <= slop && p.y >= t - slop && p.y <= b + slop;
  const nearT = Math.abs(p.y - t) <= slop && p.x >= l - slop && p.x <= r + slop;
  const nearB = Math.abs(p.y - b) <= slop && p.x >= l - slop && p.x <= r + slop;
  return nearL || nearR || nearT || nearB;
}

function hitBrushItem(p: ImageOverlayNormPoint, it: ImageOverlayBrushItem, nw: number, nh: number): boolean {
  if (it.points.length < 2) return false;
  const slop = normHitSlop(nw, nh, 10) + (it.sw / Math.max(1, Math.min(nw, nh))) * 0.5;
  for (let i = 1; i < it.points.length; i++) {
    const a = it.points[i - 1]!;
    const b = it.points[i]!;
    const d = distToSeg(p.x, p.y, a.x, a.y, b.x, b.y);
    if (d <= slop) return true;
  }
  return false;
}

function hitTextItem(p: ImageOverlayNormPoint, it: ImageOverlayTextItem, nw: number, nh: number): boolean {
  const fs = it.size / Math.max(1, nh);
  const wEst = (it.text.length || 1) * fs * 0.62;
  const hEst = fs * 1.15;
  const slop = normHitSlop(nw, nh, 6);
  return p.x >= it.x - slop && p.x <= it.x + wEst + slop && p.y >= it.y - hEst - slop && p.y <= it.y + slop;
}

function hitCropRect(p: ImageOverlayNormPoint, c: ImageOverlayCropRect): boolean {
  const x0 = Math.min(c.x, c.x + c.w);
  const x1 = Math.max(c.x, c.x + c.w);
  const y0 = Math.min(c.y, c.y + c.h);
  const y1 = Math.max(c.y, c.y + c.h);
  return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
}

function hitCropPoly(p: ImageOverlayNormPoint, c: ImageOverlayCropPolygon): boolean {
  return pointInPolygon(p.x, p.y, c.points);
}

/**
 * 自顶向下（后绘制的优先）：裁切区 → 标注项。
 */
export function hitTestOverlayAnnotation(
  p: ImageOverlayNormPoint,
  doc: ImageOverlayAnnotationDoc,
  nw: number,
  nh: number
): OverlayHitTarget | null {
  for (let i = doc.crops.length - 1; i >= 0; i--) {
    const c = doc.crops[i]!;
    if (c.kind === 'crop_rect') {
      if (hitCropRect(p, c)) return { kind: 'crop', id: c.id };
    } else if (hitCropPoly(p, c)) {
      return { kind: 'crop', id: c.id };
    }
  }
  for (let i = doc.items.length - 1; i >= 0; i--) {
    const it = doc.items[i]!;
    if (it.kind === 'rect' && hitRectItem(p, it, nw, nh)) return { kind: 'item', id: it.id };
    if (it.kind === 'brush' && hitBrushItem(p, it, nw, nh)) return { kind: 'item', id: it.id };
    if (it.kind === 'text' && hitTextItem(p, it, nw, nh)) return { kind: 'item', id: it.id };
  }
  return null;
}

export function translateItemByNormDelta(
  it: ImageOverlayRectItem | ImageOverlayBrushItem | ImageOverlayTextItem,
  dx: number,
  dy: number
): ImageOverlayRectItem | ImageOverlayBrushItem | ImageOverlayTextItem {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  if (it.kind === 'rect') {
    let nx = it.x + dx;
    let ny = it.y + dy;
    nx = Math.min(nx, 1 - it.w);
    ny = Math.min(ny, 1 - it.h);
    nx = Math.max(0, nx);
    ny = Math.max(0, ny);
    return { ...it, x: nx, y: ny };
  }
  if (it.kind === 'brush') {
    return {
      ...it,
      points: it.points.map((q) => ({ x: clamp(q.x + dx), y: clamp(q.y + dy) })),
    };
  }
  return { ...it, x: clamp(it.x + dx), y: clamp(it.y + dy) };
}

export function translateCropByNormDelta(
  c: ImageOverlayCropRect | ImageOverlayCropPolygon,
  dx: number,
  dy: number
): ImageOverlayCropRect | ImageOverlayCropPolygon {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  if (c.kind === 'crop_rect') {
    let nx = c.x + dx;
    let ny = c.y + dy;
    const w = Math.abs(c.w);
    const h = Math.abs(c.h);
    const sx = c.w >= 0 ? 1 : -1;
    const sy = c.h >= 0 ? 1 : -1;
    nx = Math.min(nx, 1 - w);
    ny = Math.min(ny, 1 - h);
    nx = Math.max(0, nx);
    ny = Math.max(0, ny);
    return { ...c, x: nx, y: ny, w: sx * w, h: sy * h };
  }
  return {
    ...c,
    points: c.points.map((q) => ({ x: clamp(q.x + dx), y: clamp(q.y + dy) })),
  };
}
