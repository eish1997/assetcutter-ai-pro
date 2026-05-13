import type { ImageLocalEditSelection, ImageOverlayNormPoint } from '../types';

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('image load failed'));
    im.src = src;
  });
}

function bboxPolygonNorm(points: ImageOverlayNormPoint[], nw: number, nh: number) {
  if (!points.length) return { x: 0, y: 0, w: 1, h: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of points) {
    const x = pt.x * nw;
    const y = pt.y * nh;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  const w = Math.max(1, Math.ceil(maxX) - x);
  const h = Math.max(1, Math.ceil(maxY) - y);
  return { x, y, w, h };
}

/** 选区紧包围盒（像素，相对原图自然尺寸） */
export function tightPixelBBoxForLocalEdit(sel: ImageLocalEditSelection, nw: number, nh: number) {
  if (sel.kind === 'local_rect' || sel.kind === 'local_ellipse') {
    const x0 = sel.x * nw;
    const y0 = sel.y * nh;
    const rw = sel.w * nw;
    const rh = sel.h * nh;
    const left = rw >= 0 ? x0 : x0 + rw;
    const top = rh >= 0 ? y0 : y0 + rh;
    const w = Math.max(1, Math.abs(rw));
    const h = Math.max(1, Math.abs(rh));
    return {
      x: Math.max(0, Math.round(left)),
      y: Math.max(0, Math.round(top)),
      w: Math.round(w),
      h: Math.round(h),
    };
  }
  return bboxPolygonNorm(sel.points, nw, nh);
}

/**
 * 外扩选区包围盒（B 方案上下文带）。
 * @param ratio 相对 max(w,h) 的比例，会与 minPadPx 取大
 */
export function expandPixelBBox(
  b: { x: number; y: number; w: number; h: number },
  nw: number,
  nh: number,
  ratio: number,
  minPadPx = 16
): { x: number; y: number; w: number; h: number } {
  const pad = Math.max(minPadPx, Math.round(ratio * Math.max(b.w, b.h)));
  let x = b.x - pad;
  let y = b.y - pad;
  let w = b.w + 2 * pad;
  let h = b.h + 2 * pad;
  if (x < 0) {
    w += x;
    x = 0;
  }
  if (y < 0) {
    h += y;
    y = 0;
  }
  if (x + w > nw) w = nw - x;
  if (y + h > nh) h = nh - y;
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  return { x: Math.round(x), y: Math.round(y), w, h };
}

export const LOCAL_INPAINT_EXPAND_RATIO = 0.18;

/**
 * 若 `nw×nh` 已不小于 `minW×minH` 则返回 null（无需放大）。
 * 否则返回 cover 到至少 min 边所需的绘制参数（可能超出画布，由负偏移裁切）。
 */
export function computeCoverUpscaleDrawParams(
  nw: number,
  nh: number,
  minW: number,
  minH: number
): { dw: number; dh: number; ox: number; oy: number } | null {
  if (!Number.isFinite(nw) || !Number.isFinite(nh) || !Number.isFinite(minW) || !Number.isFinite(minH)) {
    return null;
  }
  if (nw < 1 || nh < 1 || minW < 1 || minH < 1) return null;
  if (nw >= minW && nh >= minH) return null;
  const scale = Math.max(minW / nw, minH / nh);
  const dw = nw * scale;
  const dh = nh * scale;
  const ox = (minW - dw) / 2;
  const oy = (minH - dh) / 2;
  return { dw, dh, ox, oy };
}

/**
 * 局部重绘贴回后兜底：输出不得小于参考底图的像素宽高（只升不降；宽高比不变，必要时 cover + 裁切）。
 * 失败时返回 null，调用方保留原图。
 */
export async function ensureDataUrlCoversMinPixelSize(
  dataUrl: string,
  minW: number,
  minH: number
): Promise<string | null> {
  const trimmed = String(dataUrl || '').trim();
  if (!trimmed) return null;
  let im: HTMLImageElement;
  try {
    im = await loadHtmlImage(trimmed);
  } catch {
    return null;
  }
  const nw = im.naturalWidth;
  const nh = im.naturalHeight;
  if (!nw || !nh) return null;
  const p = computeCoverUpscaleDrawParams(nw, nh, minW, minH);
  if (!p) return null;
  const { dw, dh, ox, oy } = p;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(minW));
  canvas.height = Math.max(1, Math.round(minH));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  try {
    ctx.drawImage(im, 0, 0, nw, nh, ox, oy, dw, dh);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** 以 `baseImageSrc` 的自然像素为下限抬升合成结果（只放大、不缩小参考底图）。 */
export async function ensureLocalInpaintOutputPixelFloor(
  mergedDataUrl: string,
  baseImageSrc: string
): Promise<string> {
  const out = String(mergedDataUrl || '').trim();
  const baseSrc = String(baseImageSrc || '').trim();
  if (!out || !baseSrc) return out;
  let base: HTMLImageElement;
  try {
    base = await loadHtmlImage(baseSrc);
  } catch {
    return out;
  }
  const minW = base.naturalWidth;
  const minH = base.naturalHeight;
  if (!minW || !minH) return out;
  const lifted = await ensureDataUrlCoversMinPixelSize(out, minW, minH);
  return lifted ?? out;
}

export type LocalInpaintCropPlan = {
  cropDataUrl: string;
  dest: { left: number; top: number; width: number; height: number };
  featherPx: number;
};

/** 裁切扩边矩形为 PNG（送 Gemini）；贴回目标矩形与 `dest` 一致 */
export async function rasterizeExpandedLocalEditCrop(
  imageSrc: string,
  sel: ImageLocalEditSelection,
  expandRatio = LOCAL_INPAINT_EXPAND_RATIO
): Promise<LocalInpaintCropPlan | null> {
  let im: HTMLImageElement;
  try {
    im = await loadHtmlImage(imageSrc);
  } catch {
    return null;
  }
  const nw = im.naturalWidth;
  const nh = im.naturalHeight;
  if (!nw || !nh) return null;

  const tight = tightPixelBBoxForLocalEdit(sel, nw, nh);
  const exp = expandPixelBBox(tight, nw, nh, expandRatio);

  const canvas = document.createElement('canvas');
  canvas.width = exp.w;
  canvas.height = exp.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(im, exp.x, exp.y, exp.w, exp.h, 0, 0, exp.w, exp.h);

  const featherPx = Math.max(8, Math.min(64, Math.round(0.06 * Math.min(exp.w, exp.h))));

  try {
    return {
      cropDataUrl: canvas.toDataURL('image/png'),
      dest: { left: exp.x, top: exp.y, width: exp.w, height: exp.h },
      featherPx,
    };
  } catch {
    return null;
  }
}

/** 将 patch 缩放到 dest 尺寸后，以羽化 alpha 贴到原图对应矩形 */
export async function compositeFeatheredLocalPatch(
  baseImageSrc: string,
  patchDataUrl: string,
  dest: { left: number; top: number; width: number; height: number },
  featherPx: number
): Promise<string | null> {
  let base: HTMLImageElement;
  let patch: HTMLImageElement;
  try {
    [base, patch] = await Promise.all([loadHtmlImage(baseImageSrc), loadHtmlImage(patchDataUrl)]);
  } catch {
    return null;
  }
  const nw = base.naturalWidth;
  const nh = base.naturalHeight;
  if (!nw || !nh) return null;

  const out = document.createElement('canvas');
  out.width = nw;
  out.height = nh;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.drawImage(base, 0, 0);

  const pw = dest.width;
  const ph = dest.height;
  const pc = document.createElement('canvas');
  pc.width = pw;
  pc.height = ph;
  const pctx = pc.getContext('2d');
  if (!pctx) return null;
  pctx.drawImage(patch, 0, 0, patch.naturalWidth, patch.naturalHeight, 0, 0, pw, ph);

  const fMax = Math.min(featherPx, Math.floor(Math.min(pw, ph) / 4));
  if (fMax > 0) {
    const img = pctx.getImageData(0, 0, pw, ph);
    const d = img.data;
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const dist = Math.min(x, y, pw - 1 - x, ph - 1 - y);
        const i = (y * pw + x) * 4 + 3;
        if (dist < fMax) {
          const t = dist / fMax;
          d[i] = Math.round(d[i] * t);
        }
      }
    }
    pctx.putImageData(img, 0, 0);
  }

  octx.drawImage(pc, dest.left, dest.top);

  try {
    return out.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** 面向 Gemini 2.x/3.x 图+文的局部重绘说明（无 mask API 时的 B 方案） */
export function buildLocalInpaintInstruction(userInstruction: string): string {
  const t = userInstruction.trim();
  return [
    '【局部重绘】输入图是从完整画面裁切的矩形区域，周围像素是上下文。',
    '请修改画面内容以符合描述，使与周边自然衔接（光影、透视、颗粒感）；不要添加画框、白边或水印。',
    '输出必须与输入同宽高像素，便于贴回原图。',
    t ? `修改意图：${t}` : '修改意图：在保持整体一致的前提下优化画面中心区域的细节与质感。',
  ].join('\n');
}
