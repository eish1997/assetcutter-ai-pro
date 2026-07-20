/**
 * Tripo 图生 3D：提交前压缩参考图，避免 `/api/tripo/upload` JSON（含 base64）超过 auth-api 体积极限。
 */

/** 与 auth-api `API_JSON_BODY_MAX_BYTES`（默认 4MB）对齐，为 JSON 字段与 apiKey 留余量 */
export const TRIPO_UPLOAD_DATA_URL_SAFE_CHARS = 3_400_000;

export const TRIPO_UPLOAD_MAX_EDGE_DEFAULT = 2048;
export const TRIPO_UPLOAD_MIN_EDGE_DEFAULT = 512;

const EDGE_STEPS = [2048, 1536, 1280, 1024, 768] as const;
const QUALITY_STEPS = [0.88, 0.8, 0.72, 0.65] as const;

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('参考图解码失败，请换一张图片或先导出为 JPG/PNG 后重试'));
    img.src = src;
  });
}

async function fetchAsDataUrl(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`读取参考图失败 (${r.status})`);
  const blob = await r.blob();
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error ?? new Error('参考图转 data URL 失败'));
    fr.readAsDataURL(blob);
  });
}

async function resizeDataUrlToJpeg(dataUrl: string, maxEdge: number, quality: number): Promise<string> {
  const img = await loadImageElement(dataUrl);
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  if (!sw || !sh) throw new Error('参考图尺寸无效');
  const maxDim = Math.max(sw, sh);
  const targetMaxDim = Math.min(maxEdge, Math.max(TRIPO_UPLOAD_MIN_EDGE_DEFAULT, maxDim));
  const scale = targetMaxDim / maxDim;
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布以压缩参考图');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * 将工作区/能力链路的参考图压到可安全提交的 data URL（JPEG）。
 * 非浏览器环境原样返回（由服务端限额兜底）。
 */
export async function prepareImageDataUrlForTripoUpload(imageInput: string): Promise<string> {
  let dataUrl = String(imageInput || '').trim();
  if (!dataUrl) return dataUrl;
  if (typeof document === 'undefined') return dataUrl;

  if (!dataUrl.startsWith('data:')) {
    if (!/^blob:|^https?:/i.test(dataUrl)) return dataUrl;
    dataUrl = await fetchAsDataUrl(dataUrl);
  }

  if (dataUrl.length <= TRIPO_UPLOAD_DATA_URL_SAFE_CHARS) {
    try {
      const img = await loadImageElement(dataUrl);
      const sw = img.naturalWidth || img.width;
      const sh = img.naturalHeight || img.height;
      if (
        Math.max(sw, sh) <= TRIPO_UPLOAD_MAX_EDGE_DEFAULT &&
        Math.max(sw, sh) >= TRIPO_UPLOAD_MIN_EDGE_DEFAULT &&
        /^data:image\/jpe?g;/i.test(dataUrl)
      ) {
        return dataUrl;
      }
    } catch {
      /* 解码失败则走下方压缩 */
    }
  }

  let last = dataUrl;
  for (const maxEdge of EDGE_STEPS) {
    for (const quality of QUALITY_STEPS) {
      last = await resizeDataUrlToJpeg(dataUrl, maxEdge, quality);
      if (last.length <= TRIPO_UPLOAD_DATA_URL_SAFE_CHARS) return last;
    }
  }

  throw new Error(
    '参考图过大：已自动压缩仍超过提交上限。请先在平面预览中缩小/裁切原图，或换用更小分辨率的输入后重试生成 3D。'
  );
}
