import { WORKFLOW_IMG_EMPTY_PLACEHOLDER, workflowSafeImgSrc } from './workflowImageDisplay';

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
  if (!s.startsWith('data:')) return false;
  if (s.length < PREVIEW_THUMB_MIN_DATA_URL_CHARS) return false;
  if (s === WORKFLOW_IMG_EMPTY_PLACEHOLDER) return false;
  return true;
}

/** @deprecated 使用 shouldUsePreviewThumbnail */
export function shouldUseWorkflowGridThumb(src: string): boolean {
  return shouldUsePreviewThumbnail(src);
}

function drawDataUrlToCanvas(safeDataUrl: string, maxEdge: number): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) {
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
    img.src = safeDataUrl;
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
  jpegFallbackQuality: number
): Promise<string> {
  const safe = workflowSafeImgSrc(dataUrl);
  if (typeof document === 'undefined' || !safe.startsWith('data:')) return Promise.resolve(safe);
  return new Promise((resolve) => {
    void drawDataUrlToCanvas(safe, maxEdge).then((canvas) => {
      if (!canvas) {
        resolve(safe);
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
  });
}

/**
 * 将 data URL 缩放到最长边 maxEdge，输出 JPEG（质量 quality），用于列表/卡片/悬浮等小图预览。
 * 失败时回退为原串。
 */
export function createPreviewThumbnail(dataUrl: string, maxEdge: number, quality: number): Promise<string> {
  const safe = workflowSafeImgSrc(dataUrl);
  if (typeof document === 'undefined' || !safe.startsWith('data:')) return Promise.resolve(safe);
  return new Promise((resolve) => {
    void drawDataUrlToCanvas(safe, maxEdge).then((canvas) => {
      if (!canvas) {
        resolve(safe);
        return;
      }
      try {
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(safe);
      }
    });
  });
}

/** @deprecated 使用 createPreviewThumbnail */
export function createWorkflowGridThumbnail(dataUrl: string, maxEdge: number, quality: number): Promise<string> {
  return createPreviewThumbnail(dataUrl, maxEdge, quality);
}
