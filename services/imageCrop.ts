import type { BoundingBox } from '../types';

const TRIM_MAX_PIXELS = 2_500_000;

/** 避免 data URL 已缓存时 onload 在赋值前触发导致 Promise 永不 resolve */
function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('Image not available'));
      return;
    }
    const img = new Image();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(img);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      reject(new Error('image_load_failed'));
    };
    img.onload = done;
    img.onerror = fail;
    img.src = src;
    if (img.complete && img.naturalWidth > 0) {
      queueMicrotask(done);
    }
  });
}

/** 裁剪图片：根据框选裁剪出多张图；`overflowPx` 为每边向外扩展的像素（基于原图像素，不超出图幅） */
export async function cropBoxes(
  inputImage: string,
  boxes: BoundingBox[],
  selectedIndexes: number[],
  overflowPx = 0
): Promise<string[]> {
  const results: (string | null)[] = boxes.map(() => null);
  const pad = Math.max(0, Math.min(512, Math.round(overflowPx)));
  try {
    const img = await loadHtmlImage(inputImage);
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const scaleX = nw / 1000;
    const scaleY = nh / 1000;
    for (const i of selectedIndexes) {
      if (i < 0 || i >= boxes.length) continue;
      const b = boxes[i];
      let x = Math.round(b.xmin * scaleX - pad);
      let y = Math.round(b.ymin * scaleY - pad);
      let w = Math.round((b.xmax - b.xmin) * scaleX + 2 * pad);
      let h = Math.round((b.ymax - b.ymin) * scaleY + 2 * pad);
      x = Math.max(0, x);
      y = Math.max(0, y);
      w = Math.min(nw - x, w);
      h = Math.min(nh - y, h);
      if (w < 1 || h < 1) continue;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      results[i] = canvas.toDataURL('image/png');
    }
  } catch {
    /* fall through */
  }
  return results.map((item) => item ?? '');
}

function isBlankStoryboardPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 12) return true;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.94;
}

/** 分镜表常见的浅灰/浅蓝元数据条（镜号、景别、对白参数），非插画 */
export function isStoryboardMetaBandPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 12) return true;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const sat = pixelSaturation255(r, g, b);
  if (lum > 0.94) return true;
  if (lum >= 0.68 && lum <= 0.95 && sat < 0.24) return true;
  if (b >= g * 0.92 && b > r * 0.98 && lum >= 0.62 && sat < 0.32) return true;
  return false;
}

type StoryboardPanelPixelKind = 'blank' | 'meta' | 'text' | 'illustration';

function pixelSaturation255(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max <= 0) return 0;
  return max === min ? 0 : (max - min) / max;
}

/** 区分格内文字条（白底黑字）与中间分镜插画像素 */
export function classifyStoryboardPanelPixel(
  r: number,
  g: number,
  b: number,
  a: number
): StoryboardPanelPixelKind {
  if (isStoryboardMetaBandPixel(r, g, b, a)) return 'meta';
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const sat = pixelSaturation255(r, g, b);
  if (sat > 0.1 && lum < 0.94) return 'illustration';
  if (sat > 0.05 && lum >= 0.15 && lum <= 0.9) return 'illustration';
  if (lum < 0.4 && sat < 0.28) return 'text';
  if (lum < 0.65 && sat < 0.14) return 'text';
  return 'illustration';
}

export type IllustrationBoundsPx = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** 在已裁剪的 RGBA 条带内检测插画主体（排除上下/左右文字区，非固定比例） */
export function detectIllustrationBoundsInRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts?: { padding?: number; minSpanRatio?: number }
): IllustrationBoundsPx | null {
  if (width < 4 || height < 4) return null;
  const padding = opts?.padding ?? 2;
  const minSpanRatio = opts?.minSpanRatio ?? 0.1;

  const rowIllust = new Float32Array(height);
  const rowText = new Float32Array(height);
  const rowMeta = new Float32Array(height);
  const rowScore = new Float32Array(height);

  for (let y = 0; y < height; y += 1) {
    let iCount = 0;
    let tCount = 0;
    let mCount = 0;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const kind = classifyStoryboardPanelPixel(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!);
      if (kind === 'illustration') iCount += 1;
      else if (kind === 'text') tCount += 1;
      else if (kind === 'meta' || kind === 'blank') mCount += 1;
    }
    rowIllust[y] = iCount / width;
    rowText[y] = tCount / width;
    rowMeta[y] = mCount / width;
    rowScore[y] = rowIllust[y]! - rowText[y]! * 1.35 - rowMeta[y]! * 0.45;
  }

  const minRunScore = 0.016;
  let bestRun = { top: 0, bottom: -1, len: 0 };
  let runTop = -1;
  for (let y = 0; y < height; y += 1) {
    if (rowScore[y]! >= minRunScore) {
      if (runTop < 0) runTop = y;
    } else if (runTop >= 0) {
      const len = y - runTop;
      if (len > bestRun.len) bestRun = { top: runTop, bottom: y - 1, len };
      runTop = -1;
    }
  }
  if (runTop >= 0) {
    const len = height - runTop;
    if (len > bestRun.len) bestRun = { top: runTop, bottom: height - 1, len };
  }

  let top = bestRun.len > 0 ? bestRun.top : 0;
  let bottom = bestRun.len > 0 ? bestRun.bottom : height - 1;
  if (bottom <= top) {
    const rowIsIllustration = (y: number) =>
      rowIllust[y]! > 0.035 && rowIllust[y]! > rowText[y]! * 1.15;
    top = 0;
    while (top < height && !rowIsIllustration(top)) top += 1;
    bottom = height - 1;
    while (bottom > top && !rowIsIllustration(bottom)) bottom -= 1;
  }
  if (bottom <= top) return null;

  const colIsIllustration = (x: number) => {
    let iCount = 0;
    let tCount = 0;
    let mCount = 0;
    const samples = bottom - top + 1;
    for (let y = top; y <= bottom; y += 1) {
      const i = (y * width + x) * 4;
      const kind = classifyStoryboardPanelPixel(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!);
      if (kind === 'illustration') iCount += 1;
      else if (kind === 'text') tCount += 1;
      else if (kind === 'meta' || kind === 'blank') mCount += 1;
    }
    const ir = iCount / samples;
    const tr = tCount / samples;
    const mr = mCount / samples;
    return ir > 0.028 && ir > tr * 1.05 && ir > mr * 0.35;
  };

  let left = 0;
  while (left < width && !colIsIllustration(left)) left += 1;
  let right = width - 1;
  while (right > left && !colIsIllustration(right)) right -= 1;
  if (right <= left) {
    left = 0;
    right = width - 1;
  }

  const spanW = right - left + 1;
  const spanH = bottom - top + 1;
  if (spanW / width < minSpanRatio || spanH / height < minSpanRatio) return null;

  return {
    left: Math.max(0, left - padding),
    top: Math.max(0, top - padding),
    right: Math.min(width - 1, right + padding),
    bottom: Math.min(height - 1, bottom + padding),
  };
}

function normBoxToPixelRect(
  box: BoundingBox,
  imgW: number,
  imgH: number
): { x: number; y: number; w: number; h: number } {
  const scaleX = imgW / 1000;
  const scaleY = imgH / 1000;
  const x = Math.max(0, Math.round(box.xmin * scaleX));
  const y = Math.max(0, Math.round(box.ymin * scaleY));
  const x2 = Math.min(imgW, Math.round(box.xmax * scaleX));
  const y2 = Math.min(imgH, Math.round(box.ymax * scaleY));
  return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
}

function pixelBoundsToNormBox(
  inner: IllustrationBoundsPx,
  cell: { x: number; y: number; w: number; h: number },
  imgW: number,
  imgH: number,
  source: BoundingBox
): BoundingBox {
  const absLeft = cell.x + inner.left;
  const absTop = cell.y + inner.top;
  const absRight = cell.x + inner.right + 1;
  const absBottom = cell.y + inner.bottom + 1;
  const xmin = Math.max(0, Math.min(1000, Math.round((absLeft / imgW) * 1000)));
  const ymin = Math.max(0, Math.min(1000, Math.round((absTop / imgH) * 1000)));
  const xmax = Math.max(0, Math.min(1000, Math.round((absRight / imgW) * 1000)));
  const ymax = Math.max(0, Math.min(1000, Math.round((absBottom / imgH) * 1000)));
  return {
    ...source,
    xmin: Math.min(xmin, xmax),
    ymin: Math.min(ymin, ymax),
    xmax: Math.max(xmin, xmax),
    ymax: Math.max(ymin, ymax),
  };
}

async function detectIllustrationBoundsInCell(
  img: HTMLImageElement,
  cell: { x: number; y: number; w: number; h: number }
): Promise<IllustrationBoundsPx | null> {
  const maxDim = 360;
  const scale = Math.min(1, maxDim / Math.max(cell.w, cell.h));
  const sw = Math.max(1, Math.round(cell.w * scale));
  const sh = Math.max(1, Math.round(cell.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, cell.x, cell.y, cell.w, cell.h, 0, 0, sw, sh);
  const rgba = ctx.getImageData(0, 0, sw, sh).data;
  const bounds = detectIllustrationBoundsInRgba(rgba, sw, sh);
  if (!bounds) return null;
  if (scale >= 0.999) return bounds;
  return {
    left: Math.round(bounds.left / scale),
    top: Math.round(bounds.top / scale),
    right: Math.min(cell.w - 1, Math.round(bounds.right / scale)),
    bottom: Math.min(cell.h - 1, Math.round(bounds.bottom / scale)),
  };
}

/** 将整格切分框收窄为格内插画区域（按像素内容，非固定上下比例） */
export async function refineStoryboardNormBoxToIllustrationBounds(
  dataUrl: string,
  box: BoundingBox,
  cachedImg?: HTMLImageElement
): Promise<BoundingBox> {
  if (typeof document === 'undefined') return box;
  let img = cachedImg;
  if (!img) {
    try {
      img = await loadHtmlImage(dataUrl);
    } catch {
      return box;
    }
  }
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (nw < 8 || nh < 8) return box;

  const cell = normBoxToPixelRect(box, nw, nh);
  const inner = await detectIllustrationBoundsInCell(img, cell);
  if (!inner) return box;
  return pixelBoundsToNormBox(inner, cell, nw, nh, box);
}

export async function refineStoryboardNormBoxesToIllustrationBounds(
  dataUrl: string,
  boxes: BoundingBox[]
): Promise<BoundingBox[]> {
  if (!boxes.length || typeof document === 'undefined') return boxes;

  const heights = boxes.map((b) => b.ymax - b.ymin).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] ?? 0;

  let img: HTMLImageElement;
  try {
    img = await loadHtmlImage(dataUrl);
  } catch {
    return boxes;
  }

  const refined = await Promise.all(
    boxes.map((box) => {
      const h = box.ymax - box.ymin;
      if (medianH > 0 && h < medianH * 0.72) return box;
      return refineStoryboardNormBoxToIllustrationBounds(dataUrl, box, img);
    })
  );
  return refined;
}

/** 裁掉切分结果四周近白/近黑留白 */
export async function trimImageDataUrlContentBounds(
  dataUrl: string,
  padding = 2
): Promise<string> {
  if (typeof document === 'undefined') return dataUrl;

  let img: HTMLImageElement;
  try {
    img = await loadHtmlImage(dataUrl);
  } catch {
    return dataUrl;
  }

  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (nw < 2 || nh < 2) {
    return dataUrl;
  }
  if (nw * nh > TRIM_MAX_PIXELS) {
    return dataUrl;
  }

  return new Promise((resolve) => {
    const runTrim = () => {
      const canvas = document.createElement('canvas');
      canvas.width = nw;
      canvas.height = nh;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, nw, nh).data;

      const rowHasContent = (y: number): boolean => {
        for (let x = 0; x < nw; x += 1) {
          const i = (y * nw + x) * 4;
          if (!isBlankStoryboardPixel(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!)) {
            return true;
          }
        }
        return false;
      };

      const colHasContent = (x: number, y0: number, y1: number): boolean => {
        for (let y = y0; y <= y1; y += 1) {
          const i = (y * nw + x) * 4;
          if (!isBlankStoryboardPixel(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!)) {
            return true;
          }
        }
        return false;
      };

      let top = 0;
      let bottom = nh - 1;
      while (top < bottom && !rowHasContent(top)) top += 1;
      while (bottom > top && !rowHasContent(bottom)) bottom -= 1;

      if (bottom <= top) {
        resolve(dataUrl);
        return;
      }

      let left = 0;
      let right = nw - 1;
      while (left < right && !colHasContent(left, top, bottom)) left += 1;
      while (right > left && !colHasContent(right, top, bottom)) right -= 1;

      const x0 = Math.max(0, left - padding);
      const y0 = Math.max(0, top - padding);
      const x1 = Math.min(nw - 1, right + padding);
      const y1 = Math.min(nh - 1, bottom + padding);
      const w = Math.max(1, x1 - x0 + 1);
      const h = Math.max(1, y1 - y0 + 1);

      if (w >= nw * 0.98 && h >= nh * 0.98) {
        resolve(dataUrl);
        return;
      }

      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const outCtx = out.getContext('2d');
      if (!outCtx) {
        resolve(dataUrl);
        return;
      }
      outCtx.drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
      try {
        resolve(out.toDataURL('image/png'));
      } catch {
        resolve(dataUrl);
      }
    };
    queueMicrotask(runTrim);
  });
}
