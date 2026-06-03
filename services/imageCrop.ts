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
