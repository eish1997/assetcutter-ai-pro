/** 分镜行配图：读文件并压缩，避免巨型 data URL 撑爆工作区 JSON */

const STORYBOARD_FRAME_MAX_BYTES = 2 * 1024 * 1024;

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('无法解码图片'));
    img.src = dataUrl;
  });
}

async function compressDataUrlToJpegMaxBytes(dataUrl: string, maxBytes: number): Promise<string> {
  const img = await loadImageFromDataUrl(dataUrl);
  const canvas = document.createElement('canvas');
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return dataUrl;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  let quality = 0.92;
  let out = canvas.toDataURL('image/jpeg', quality);
  const byteLen = (s: string) => Math.ceil((s.length - 'data:image/jpeg;base64,'.length) * 0.75);
  while (byteLen(out) > maxBytes && quality > 0.45) {
    quality -= 0.08;
    out = canvas.toDataURL('image/jpeg', quality);
  }
  if (byteLen(out) > maxBytes) {
    const scale = Math.sqrt(maxBytes / byteLen(out));
    canvas.width = Math.max(1, Math.floor(w * scale));
    canvas.height = Math.max(1, Math.floor(h * scale));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    quality = 0.85;
    out = canvas.toDataURL('image/jpeg', quality);
  }
  return out;
}

/** 将已有 data URL 压到工作区可存大小（与读文件路径一致） */
export async function compressStoryboardFrameDataUrl(dataUrl: string): Promise<string> {
  const raw = String(dataUrl || '').trim();
  if (!raw || typeof document === 'undefined') return raw;
  try {
    return await compressDataUrlToJpegMaxBytes(raw, STORYBOARD_FRAME_MAX_BYTES);
  } catch {
    return raw;
  }
}

export async function readStoryboardFrameFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  const raw = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const v = typeof fr.result === 'string' ? fr.result : '';
      if (!v) reject(new Error('无法读取图片'));
      else resolve(v);
    };
    fr.onerror = () => reject(fr.error ?? new Error('读取失败'));
    fr.readAsDataURL(file);
  });
  if (typeof document === 'undefined') return raw;
  try {
    return await compressDataUrlToJpegMaxBytes(raw, STORYBOARD_FRAME_MAX_BYTES);
  } catch {
    return raw;
  }
}

export async function readStoryboardFrameFromClipboard(
  clipboard: DataTransfer | null | undefined
): Promise<string | null> {
  if (!clipboard) return null;
  const file = clipboard.files?.[0];
  if (file?.type.startsWith('image/')) {
    return readStoryboardFrameFromFile(file);
  }
  return null;
}
