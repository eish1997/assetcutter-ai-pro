/** 工作流送视觉模型 / 能力执行前的 data URL 体积上限（与 geminiService 一致） */
export const MAX_WORKFLOW_VISION_IMAGE_BYTES = 2 * 1024 * 1024;

function parseDataUrlParts(input: string): { mimeType: string; data: string; isDataUrl: boolean } {
  const raw = String(input || '').trim();
  if (!raw.startsWith('data:')) {
    return { mimeType: 'image/jpeg', data: raw, isDataUrl: false };
  }
  const headEnd = raw.indexOf(',');
  if (headEnd < 0) return { mimeType: 'image/jpeg', data: '', isDataUrl: true };
  const head = raw.slice(0, headEnd);
  const mimeMatch = /^data:([^;]+)/i.exec(head);
  const mimeType = (mimeMatch?.[1] || 'image/jpeg').trim();
  const data = raw.slice(headEnd + 1);
  return { mimeType, data, isDataUrl: true };
}

function isRawBase64Payload(value: string): boolean {
  const stripped = String(value || '').replace(/\s/g, '');
  return stripped.length >= 64 && /^[A-Za-z0-9+/]+=*$/.test(stripped);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        if (!result.startsWith('data:')) {
          reject(new Error('图片读取失败'));
          return;
        }
        resolve(result);
      };
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.readAsDataURL(blob);
    });
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  const mime = blob.type || 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** blob: / http(s): / 站内路径 → 真实 data URL（禁止把 URL 字符串当 base64 拼接） */
export async function materializeImageSrcToDataUrl(input: string): Promise<string> {
  const trimmed = String(input || '').trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('data:')) return trimmed;
  if (/^blob:/i.test(trimmed) || /^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) {
    const res = await fetch(trimmed, {
      mode: 'cors',
      credentials: trimmed.startsWith('/') || /^https?:\/\//i.test(trimmed) ? 'include' : 'omit',
    });
    if (!res.ok) {
      throw new Error(`无法读取图片（HTTP ${res.status}）`);
    }
    return blobToDataUrl(await res.blob());
  }
  if (isRawBase64Payload(trimmed)) {
    return `data:image/jpeg;base64,${trimmed.replace(/\s/g, '')}`;
  }
  throw new Error('图片格式无效：需要 data URL、blob URL 或可访问的图片地址');
}

export function base64PayloadBytes(base64: string): number {
  const raw = String(base64 || '').trim().replace(/\s+/g, '');
  if (!raw) return 0;
  const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
  return Math.floor((raw.length * 3) / 4) - padding;
}

export function dataUrlPayloadBytes(dataUrl: string): number {
  return base64PayloadBytes(parseDataUrlParts(dataUrl).data);
}

function hasCanvasCompressSupport(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * 将 data URL 压到 maxBytes 以下：先降 JPEG quality，再逐步缩小最长边。
 * 用于伴侣 Volume 全尺寸原图，避免 SDK / JSON.stringify 栈溢出。
 */
export async function compressDataUrlForVisionApi(
  dataUrl: string,
  maxBytes = MAX_WORKFLOW_VISION_IMAGE_BYTES
): Promise<string> {
  const trimmed = String(dataUrl || '').trim();
  if (!trimmed) return trimmed;
  if (!hasCanvasCompressSupport()) return trimmed;
  if (dataUrlPayloadBytes(trimmed) <= maxBytes) return trimmed;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const natW = img.naturalWidth || img.width || 1;
        const natH = img.naturalHeight || img.height || 1;
        let maxSide = Math.max(natW, natH);
        let best = trimmed;

        const encode = (side: number, quality: number): string => {
          const scale = Math.min(1, side / Math.max(natW, natH));
          const w = Math.max(1, Math.round(natW * scale));
          const h = Math.max(1, Math.round(natH * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return best;
          ctx.drawImage(img, 0, 0, w, h);
          return canvas.toDataURL('image/jpeg', quality);
        };

        while (maxSide >= 512) {
          let quality = 0.9;
          let next = encode(maxSide, quality);
          while (quality > 0.4 && dataUrlPayloadBytes(next) > maxBytes) {
            quality = Number((quality - 0.1).toFixed(2));
            next = encode(maxSide, quality);
          }
          if (dataUrlPayloadBytes(next) <= maxBytes) {
            resolve(next);
            return;
          }
          if (dataUrlPayloadBytes(next) < dataUrlPayloadBytes(best)) {
            best = next;
          }
          maxSide = Math.floor(maxSide * 0.75);
        }
        resolve(dataUrlPayloadBytes(best) < dataUrlPayloadBytes(trimmed) ? best : trimmed);
      } catch {
        resolve(trimmed);
      }
    };
    img.onerror = () => resolve(trimmed);
    img.src = trimmed;
  });
}

/** 规范为 data URL 并压缩到视觉模型可接受体积 */
export async function normalizeDataUrlForVisionApi(
  input: string,
  maxBytes = MAX_WORKFLOW_VISION_IMAGE_BYTES
): Promise<string> {
  const trimmed = String(input || '').trim();
  if (!trimmed) return trimmed;
  const dataUrl = await materializeImageSrcToDataUrl(trimmed);
  return compressDataUrlForVisionApi(dataUrl, maxBytes);
}
