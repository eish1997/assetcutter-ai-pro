import type { ImageLocalEditSelection, ImageOverlayNormPoint } from '../types';
import type { FlatLocalInpaintCompositeStrategy } from './lightboxFlatLocalInpaintPrefs';
import type { LocalInpaintExpandMode } from './lightboxLocalInpaintExpandPrefs';

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
  minPadPx = 16,
  overridePadPx?: number
): { x: number; y: number; w: number; h: number } {
  const pad =
    overridePadPx !== undefined
      ? Math.max(0, Math.round(overridePadPx))
      : Math.max(minPadPx, Math.round(ratio * Math.max(b.w, b.h)));
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

/** 解析局部重绘四边外扩像素：`auto` 为比例 + 最小垫；数字为固定像素。 */
export function resolveLocalInpaintExpandPadPx(
  bboxMaxSide: number,
  mode: LocalInpaintExpandMode = 'auto',
  minPadPx = 16
): number {
  if (mode !== 'auto') return Math.max(0, Math.round(mode));
  const side = Math.max(1, bboxMaxSide);
  return Math.max(minPadPx, Math.round(LOCAL_INPAINT_EXPAND_RATIO * side));
}

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
  expandMode: LocalInpaintExpandMode = 'auto'
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
  const padPx = resolveLocalInpaintExpandPadPx(Math.max(tight.w, tight.h), expandMode);
  const exp = expandPixelBBox(tight, nw, nh, LOCAL_INPAINT_EXPAND_RATIO, 16, padPx);

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

/** 贴回画布单边上限（避免超大图 OOM） */
export const LOCAL_INPAINT_COMPOSITE_MAX_LONG_EDGE = 16384;

function applyFeatherAlphaToPatchCanvas(
  pctx: CanvasRenderingContext2D,
  pw: number,
  ph: number,
  featherPx: number
): void {
  const fMax = Math.min(featherPx, Math.floor(Math.min(pw, ph) / 4));
  if (fMax <= 0) return;
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

function clampCompositeCanvasScale(nw: number, nh: number, scale: number, maxEdge = LOCAL_INPAINT_COMPOSITE_MAX_LONG_EDGE): number {
  if (!Number.isFinite(scale) || scale <= 1) return 1;
  const edge = Math.max(nw * scale, nh * scale);
  if (edge <= maxEdge) return scale;
  return maxEdge / Math.max(nw, nh);
}

/** 生成图相对选区外扩矩形的分辨率倍率 */
export function localInpaintPatchToDestRatio(
  patchW: number,
  patchH: number,
  destW: number,
  destH: number
): number {
  if (destW < 1 || destH < 1 || patchW < 1 || patchH < 1) return 1;
  return Math.max(patchW / destW, patchH / destH);
}

export type LocalInpaintCompositePlan = {
  canvasScale: number;
  pasteLeft: number;
  pasteTop: number;
  pasteW: number;
  pasteH: number;
};

/** 按策略计算贴回画布缩放与 patch 绘制尺寸（像素，相对原图自然尺寸坐标系） */
export function planLocalInpaintComposite(
  nw: number,
  nh: number,
  dest: { left: number; top: number; width: number; height: number },
  patchW: number,
  patchH: number,
  strategy: FlatLocalInpaintCompositeStrategy
): LocalInpaintCompositePlan {
  const ratio = Math.max(1, localInpaintPatchToDestRatio(patchW, patchH, dest.width, dest.height));
  if (strategy === 'upscale_canvas') {
    const canvasScale = clampCompositeCanvasScale(nw, nh, ratio);
    return {
      canvasScale,
      pasteLeft: dest.left * canvasScale,
      pasteTop: dest.top * canvasScale,
      pasteW: patchW,
      pasteH: patchH,
    };
  }
  if (strategy === 'detail_enhance') {
    const canvasScale = clampCompositeCanvasScale(nw, nh, Math.sqrt(ratio));
    const destW = dest.width * canvasScale;
    const destH = dest.height * canvasScale;
    const shrink = 0.92;
    const pasteW = destW * shrink;
    const pasteH = destH * shrink;
    return {
      canvasScale,
      pasteLeft: dest.left * canvasScale + (destW - pasteW) / 2,
      pasteTop: dest.top * canvasScale + (destH - pasteH) / 2,
      pasteW,
      pasteH,
    };
  }
  return {
    canvasScale: 1,
    pasteLeft: dest.left,
    pasteTop: dest.top,
    pasteW: dest.width,
    pasteH: dest.height,
  };
}

/** 将 patch 按策略羽化贴回；`fit_dest` 时输出与原图同尺寸 */
export async function compositeLocalInpaintPatch(
  baseImageSrc: string,
  patchDataUrl: string,
  dest: { left: number; top: number; width: number; height: number },
  featherPx: number,
  strategy: FlatLocalInpaintCompositeStrategy = 'fit_dest'
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

  const plan = planLocalInpaintComposite(nw, nh, dest, patch.naturalWidth, patch.naturalHeight, strategy);
  const outW = Math.max(1, Math.round(nw * plan.canvasScale));
  const outH = Math.max(1, Math.round(nh * plan.canvasScale));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(base, 0, 0, nw, nh, 0, 0, outW, outH);

  const pw = Math.max(1, Math.round(plan.pasteW));
  const ph = Math.max(1, Math.round(plan.pasteH));
  const pc = document.createElement('canvas');
  pc.width = pw;
  pc.height = ph;
  const pctx = pc.getContext('2d');
  if (!pctx) return null;
  pctx.imageSmoothingEnabled = true;
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(patch, 0, 0, patch.naturalWidth, patch.naturalHeight, 0, 0, pw, ph);
  applyFeatherAlphaToPatchCanvas(pctx, pw, ph, featherPx);

  octx.drawImage(pc, Math.round(plan.pasteLeft), Math.round(plan.pasteTop));

  try {
    return out.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** @deprecated 使用 {@link compositeLocalInpaintPatch} */
export async function compositeFeatheredLocalPatch(
  baseImageSrc: string,
  patchDataUrl: string,
  dest: { left: number; top: number; width: number; height: number },
  featherPx: number
): Promise<string | null> {
  return compositeLocalInpaintPatch(baseImageSrc, patchDataUrl, dest, featherPx, 'fit_dest');
}

/** 大图快捷栏 → 局部重绘专用生图参数（尺寸/比例仅作用于裁切图，不作用于整图二次生图） */
export function buildLocalInpaintGenImageOptions(
  aspect: string | undefined,
  size: string | undefined
): { aspectRatio?: string; imageSize?: string } | undefined {
  const o: { aspectRatio?: string; imageSize?: string } = {};
  if (aspect && aspect !== 'adaptive') o.aspectRatio = aspect;
  if (size === '1K' || size === '2K' || size === '4K') o.imageSize = size;
  return Object.keys(o).length > 0 ? o : undefined;
}

/** 面向 Gemini 2.x/3.x 图+文的局部重绘说明（无 mask API 时的 B 方案） */
export function buildLocalInpaintInstruction(userInstruction: string, outputSizeLabel?: string): string {
  const t = userInstruction.trim();
  const sizeHint = outputSizeLabel
    ? `请按请求的输出分辨率（约 ${outputSizeLabel}）生成，可与输入裁切图宽高比一致；不必与输入裁切像素同尺寸。`
    : '请按接口请求的输出分辨率生成，可与输入裁切图宽高比一致；不必与输入裁切像素同尺寸。';
  return [
    '【局部重绘】输入图是从完整画面裁切的矩形区域（含少量周边上下文），仅修改选区内容。',
    '请使与周边自然衔接（光影、透视、颗粒感）；不要添加画框、白边或水印。',
    sizeHint,
    t ? `修改意图：${t}` : '修改意图：在保持整体一致的前提下优化画面中心区域的细节与质感。',
  ].join('\n');
}
