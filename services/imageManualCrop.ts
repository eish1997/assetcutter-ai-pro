import type {
  ImageOverlayBrushItem,
  ImageOverlayCropPolygon,
  ImageOverlayCropRect,
  ImageOverlayRectItem,
  ImageOverlayTextItem,
} from '../types';
import { drawImageOverlayItemsOnCanvas } from './imageOverlayCanvasDraw';

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('image load failed'));
    im.src = src;
  });
}

function bboxPolygonNorm(p: ImageOverlayCropPolygon, nw: number, nh: number) {
  if (!p.points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of p.points) {
    const x = pt.x * nw;
    const y = pt.y * nh;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    minX: Math.max(0, Math.floor(minX)),
    minY: Math.max(0, Math.floor(minY)),
    maxX: Math.min(nw, Math.ceil(maxX)),
    maxY: Math.min(nh, Math.ceil(maxY)),
  };
}

export type RasterizeCropOptions = {
  /** 与裁切结果合成：方框 / 画笔 / 文字（不含橙色裁切辅助框） */
  bakeItems?: Array<ImageOverlayRectItem | ImageOverlayBrushItem | ImageOverlayTextItem>;
};

export async function rasterizeCropRegion(
  imageSrc: string,
  crop: ImageOverlayCropRect | ImageOverlayCropPolygon,
  opts?: RasterizeCropOptions
): Promise<string | null> {
  let im: HTMLImageElement;
  try {
    im = await loadHtmlImage(imageSrc);
  } catch {
    return null;
  }
  const nw = im.naturalWidth;
  const nh = im.naturalHeight;
  if (!nw || !nh) return null;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const bake = opts?.bakeItems?.filter(Boolean) ?? [];

  if (crop.kind === 'crop_rect') {
    const x0 = crop.x * nw;
    const y0 = crop.y * nh;
    const rw = crop.w * nw;
    const rh = crop.h * nh;
    const left = rw >= 0 ? x0 : x0 + rw;
    const top = rh >= 0 ? y0 : y0 + rh;
    const aw = Math.max(1, Math.abs(rw));
    const ah = Math.max(1, Math.abs(rh));
    canvas.width = Math.ceil(aw);
    canvas.height = Math.ceil(ah);
    ctx.drawImage(im, left, top, aw, ah, 0, 0, aw, ah);
    if (bake.length > 0) {
      drawImageOverlayItemsOnCanvas(ctx, bake, nw, nh, -left, -top);
    }
  } else {
    const pts = crop.points;
    if (pts.length < 3) return null;
    const box = bboxPolygonNorm(crop, nw, nh);
    const w = Math.max(1, box.maxX - box.minX);
    const h = Math.max(1, box.maxY - box.minY);
    canvas.width = w;
    canvas.height = h;
    ctx.setTransform(1, 0, 0, 1, -box.minX, -box.minY);
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x * nw, pts[0]!.y * nh);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i]!.x * nw, pts[i]!.y * nh);
    }
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(im, 0, 0);
    if (bake.length > 0) {
      drawImageOverlayItemsOnCanvas(ctx, bake, nw, nh, 0, 0);
    }
  }

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * 整图 + 标注（方框/画笔/文字）栅格化为 PNG data URL，用于「当前所见含标注」送入模型。
 * 无标注项时仍返回与 `rasterizeCropRegion` 一致的整图 PNG（重编码）。
 */
export async function rasterizeImageWithAnnotationBakes(
  imageSrc: string,
  bakeItems: RasterizeCropOptions['bakeItems']
): Promise<string | null> {
  let im: HTMLImageElement;
  try {
    im = await loadHtmlImage(imageSrc);
  } catch {
    return null;
  }
  const nw = im.naturalWidth;
  const nh = im.naturalHeight;
  if (!nw || !nh) return null;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  canvas.width = nw;
  canvas.height = nh;
  ctx.drawImage(im, 0, 0);
  const bake = bakeItems?.filter(Boolean) ?? [];
  if (bake.length > 0) {
    drawImageOverlayItemsOnCanvas(ctx, bake, nw, nh, 0, 0);
  }
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
