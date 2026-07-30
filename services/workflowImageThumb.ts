import { WORKFLOW_IMG_EMPTY_PLACEHOLDER, workflowSafeImgSrc } from './workflowImageDisplay';

/** 缩略解码并发上限：避免首屏大量 `drawImage` 与大图 decode 抢主线程，拖慢当前视口内卡片 */
const PREVIEW_THUMB_DECODE_MAX_PARALLEL = 1;

let previewThumbDecodeRunning = 0;
const previewThumbDecodeHighQueue: Array<() => void> = [];
const previewThumbDecodeLowQueue: Array<() => void> = [];

function pumpPreviewThumbDecodeQueue() {
  while (previewThumbDecodeRunning < PREVIEW_THUMB_DECODE_MAX_PARALLEL) {
    const next = previewThumbDecodeHighQueue.shift() ?? previewThumbDecodeLowQueue.shift();
    if (!next) break;
    previewThumbDecodeRunning++;
    next();
  }
}

export type PreviewThumbDecodePriority = 'high' | 'low';

/**
 * 将 data URL 解码并缩放到画布的工作纳入全局队列：**high 优先于 low**，同优先 FIFO。
 * 用于工作区网格「先完成视口内小图，再处理屏外」。
 */
export function runPreviewThumbDecode<T>(priority: PreviewThumbDecodePriority, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      void fn().then(
        (v) => {
          previewThumbDecodeRunning--;
          resolve(v);
          pumpPreviewThumbDecodeQueue();
        },
        (e) => {
          previewThumbDecodeRunning--;
          reject(e);
          pumpPreviewThumbDecodeQueue();
        }
      );
    };
    if (priority === 'high') previewThumbDecodeHighQueue.push(run);
    else previewThumbDecodeLowQueue.push(run);
    pumpPreviewThumbDecodeQueue();
  });
}

/**
 * 超过该长度的 data URL 走「微图 → 小图」渐进预览，**DOM 的 img 不直接绑原图**；原图仅在独立预览/灯箱使用。
 * 画布侧会解码一次原 data 用于生成缩略（客户端无法不读像素就缩放）。
 */
/** 短于该长度的 data URL 视为极简内联图，可直接作 img src；其余一律渐进缩略、不在列表里挂原图 */
export const PREVIEW_THUMB_MIN_DATA_URL_CHARS = 80;

/** @deprecated 使用 PREVIEW_THUMB_MIN_DATA_URL_CHARS */
export const WORKFLOW_GRID_THUMB_DATA_URL_MIN_CHARS = PREVIEW_THUMB_MIN_DATA_URL_CHARS;

export function shouldUsePreviewThumbnail(src: string): boolean {
  const s = workflowSafeImgSrc(src);
  if (!s || s === WORKFLOW_IMG_EMPTY_PLACEHOLDER) return false;
  // data: short placeholders can bind directly; large data URLs need progressive thumbs.
  if (s.startsWith('data:')) return s.length >= PREVIEW_THUMB_MIN_DATA_URL_CHARS;
  // http(s)/blob: never bind full-res into grid cards (UV atlases black-screen GPUs).
  if (/^(https?:|blob:)/i.test(s)) return true;
  return false;
}

/**
 * 用于 ProgressivePreview 的 `cacheKey` 后缀：同一资产 `displayKey` 下若 `original`/结果图替换（如 3D SVG→JPEG），
 * 键必须变化以丢弃旧缩略 LRU，否则会一直显示占位阶段生成的微图/小图。
 */
export function previewSrcCacheFingerprint(src: string): string {
  const s = src || '';
  if (!s) return 'e0';
  const n = s.length;
  const head = s.slice(0, Math.min(24, n));
  const mid = s.slice(Math.max(0, Math.floor(n / 2) - 6), Math.min(n, Math.floor(n / 2) + 6));
  const tail = n > 48 ? s.slice(-24) : '';
  let h = 2166136261 >>> 0;
  for (const part of [head, mid, tail]) {
    for (let i = 0; i < part.length; i++) {
      h ^= part.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return `${n.toString(36)}-${h.toString(36)}`;
}

/** @deprecated 使用 shouldUsePreviewThumbnail */
export function shouldUseWorkflowGridThumb(src: string): boolean {
  return shouldUsePreviewThumbnail(src);
}

/** Skip grid decode for oversized sources (UV atlases) — prevents GPU black screens. */
export const PREVIEW_THUMB_MAX_DATA_URL_CHARS = 1_800_000; // ~1.3MB binary
export const PREVIEW_THUMB_MAX_BLOB_BYTES = 3_500_000; // ~3.5MB

function drawSrcToCanvas(safeSrc: string, maxEdge: number): Promise<HTMLCanvasElement | null> {
  // Giant inline data URLs: never decode full atlas for a grid thumb.
  if (safeSrc.startsWith('data:') && safeSrc.length > PREVIEW_THUMB_MAX_DATA_URL_CHARS) {
    return Promise.resolve(null);
  }

  const paintBitmap = (bitmap: ImageBitmap): HTMLCanvasElement | null => {
    try {
      const w = bitmap.width;
      const h = bitmap.height;
      if (!w || !h) return null;
      const scale = Math.min(1, maxEdge / Math.max(w, h));
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, tw, th);
      return canvas;
    } catch {
      return null;
    } finally {
      try {
        bitmap.close();
      } catch {
        /* ignore */
      }
    }
  };

  // Prefer createImageBitmap(+resize) so the browser can decode at reduced size when supported.
  if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
    return (async () => {
      try {
        let blob: Blob;
        if (safeSrc.startsWith('blob:') || /^https?:/i.test(safeSrc) || safeSrc.startsWith('data:')) {
          const res = await fetch(safeSrc);
          if (!res.ok) return null;
          blob = await res.blob();
        } else {
          return null;
        }
        if (blob.size > PREVIEW_THUMB_MAX_BLOB_BYTES) return null;
        const opts: ImageBitmapOptions = { resizeQuality: 'low' };
        // Hint downscale before full decode when the engine supports it.
        (opts as ImageBitmapOptions & { resizeWidth?: number }).resizeWidth = Math.max(1, Math.floor(maxEdge));
        let bitmap: ImageBitmap;
        try {
          bitmap = await createImageBitmap(blob, opts);
        } catch {
          bitmap = await createImageBitmap(blob);
        }
        // Still too huge after decode — refuse to upload to GPU canvas at full size.
        if (bitmap.width * bitmap.height > 4096 * 4096) {
          try {
            bitmap.close();
          } catch {
            /* ignore */
          }
          return null;
        }
        return paintBitmap(bitmap);
      } catch {
        return null;
      }
    })();
  }

  return new Promise((resolve) => {
    const img = new Image();
    if (/^https?:/i.test(safeSrc)) {
      try {
        img.crossOrigin = 'anonymous';
      } catch {
        /* ignore */
      }
    }
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) {
          resolve(null);
          return;
        }
        if (w * h > 4096 * 4096) {
          resolve(null);
          return;
        }
        const scale = Math.min(1, maxEdge / Math.max(w, h));
        const tw = Math.max(1, Math.round(w * scale));
        const th = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, tw, th);
        resolve(canvas);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = safeSrc;
  });
}

/**
 * 极小微预览：最长边更小，优先输出 **WebP**（体积极小、解码快），不支持时回退 JPEG。
 * 用于 ProgressivePreviewImage 第一层，再异步换成 `createPreviewThumbnail` 的小图。
 */
export function createPreviewMicroThumbnail(
  dataUrl: string,
  maxEdge: number,
  webpQuality: number,
  jpegFallbackQuality: number,
  decodePriority: PreviewThumbDecodePriority = 'low'
): Promise<string> {
  const safe = workflowSafeImgSrc(dataUrl);
  if (typeof document === 'undefined') return Promise.resolve(safe);
  if (!safe.startsWith('data:') && !/^(https?:|blob:)/i.test(safe)) return Promise.resolve(safe);
  return runPreviewThumbDecode(decodePriority, () =>
    new Promise<string>((resolve) => {
      void drawSrcToCanvas(safe, maxEdge).then((canvas) => {
        if (!canvas) {
          // CORS/taint or decode failure: never fall back to full-res in grid.
          resolve(WORKFLOW_IMG_EMPTY_PLACEHOLDER);
          return;
        }
        try {
          const webp = canvas.toDataURL('image/webp', webpQuality);
          if (webp.startsWith('data:image/webp')) {
            resolve(webp);
            return;
          }
          resolve(canvas.toDataURL('image/jpeg', jpegFallbackQuality));
        } catch {
          try {
            resolve(canvas.toDataURL('image/jpeg', jpegFallbackQuality));
          } catch {
            resolve(safe);
          }
        }
      });
    })
  );
}

/**
 * 将 data URL 缩放到最长边 maxEdge，输出 JPEG（质量 quality），用于列表/卡片/悬浮等小图预览。
 * 失败时回退为原串。
 */
export function createPreviewThumbnail(
  dataUrl: string,
  maxEdge: number,
  quality: number,
  decodePriority: PreviewThumbDecodePriority = 'low'
): Promise<string> {
  const safe = workflowSafeImgSrc(dataUrl);
  if (typeof document === 'undefined') return Promise.resolve(safe);
  if (!safe.startsWith('data:') && !/^(https?:|blob:)/i.test(safe)) return Promise.resolve(safe);
  return runPreviewThumbDecode(decodePriority, () =>
    new Promise<string>((resolve) => {
      void drawSrcToCanvas(safe, maxEdge).then((canvas) => {
        if (!canvas) {
          resolve(WORKFLOW_IMG_EMPTY_PLACEHOLDER);
          return;
        }
        try {
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          resolve(WORKFLOW_IMG_EMPTY_PLACEHOLDER);
        }
      });
    })
  );
}

/** @deprecated 使用 createPreviewThumbnail */
export function createWorkflowGridThumbnail(
  dataUrl: string,
  maxEdge: number,
  quality: number,
  decodePriority: PreviewThumbDecodePriority = 'low'
): Promise<string> {
  return createPreviewThumbnail(dataUrl, maxEdge, quality, decodePriority);
}
