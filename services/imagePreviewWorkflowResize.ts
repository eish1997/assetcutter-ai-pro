import { drawSplitPreview, type SplitStretchRasterState } from './imagePreviewSplitStretchDraw';

/**
 * 将当前平面预览的位图栅格化到「自然像素」画布（可选线分割变形）。
 */
export function rasterizeFlatImageNatural(
  img: HTMLImageElement,
  split: SplitStretchRasterState | null
): HTMLCanvasElement | null {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return null;
  const c = document.createElement('canvas');
  c.width = nw;
  c.height = nh;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, nw, nh);
    const useSplit =
    split != null &&
    split.active &&
    Number.isFinite(split.lineFrac) &&
    Number.isFinite(split.splitNaturalY) &&
    split.splitNaturalY >= 1 &&
    split.splitNaturalY < nh;
  try {
    if (useSplit) {
      drawSplitPreview(ctx, img, nw, nh, split.splitNaturalY, split.lineFrac, nw, nh);
    } else {
      ctx.drawImage(img, 0, 0, nw, nh);
    }
  } catch {
    return null;
  }
  return c;
}

/** 大图改尺寸 / 线分割写回提交给工作流资产的载荷 */
export type WorkflowLightboxImageWriteBackPayload = {
  dataUrl: string;
  width: number;
  height: number;
  /** `resize`：改尺寸写回；`split_stretch`：仅线分割变形写回 */
  writeBackKind?: 'resize' | 'split_stretch';
};

export type WorkflowResizeMode = 'max_edge' | 'width' | 'height';

export function computeUniformOutputSize(
  sw: number,
  sh: number,
  mode: WorkflowResizeMode,
  value: number
): { w: number; h: number } | null {
  const v = Math.floor(value);
  if (!Number.isFinite(v) || v < 1) return null;
  const maxDim = 8192;
  if (sw < 1 || sh < 1) return null;
  let w: number;
  let h: number;
  if (mode === 'max_edge') {
    const cap = Math.min(maxDim, v);
    const m = Math.max(sw, sh);
    const s = Math.min(1, cap / m);
    w = Math.max(1, Math.round(sw * s));
    h = Math.max(1, Math.round(sh * s));
  } else if (mode === 'width') {
    const tw = Math.min(maxDim, v);
    const s = tw / sw;
    w = Math.max(1, Math.round(sw * s));
    h = Math.max(1, Math.round(sh * s));
  } else {
    const th = Math.min(maxDim, v);
    const s = th / sh;
    h = Math.max(1, Math.round(sh * s));
    w = Math.max(1, Math.round(sw * s));
  }
  const m2 = Math.max(w, h);
  if (m2 > maxDim) {
    const k = maxDim / m2;
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
  }
  return { w, h };
}

export function scaleCanvasToSize(src: HTMLCanvasElement, outW: number, outH: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, outW);
  c.height = Math.max(1, outH);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, outW, outH);
  return c;
}

export function canvasToPngDataUrl(canvas: HTMLCanvasElement): string | null {
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
