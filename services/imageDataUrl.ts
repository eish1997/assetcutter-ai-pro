/**
 * 根据图片 data URL 的 MIME 给出下载用的文件扩展名。
 * JPEG（image/jpeg）在部分环境下若未明确使用 .jpg，浏览器可能保存为 .jfif。
 */
export function fileExtensionForImageDataUrl(dataUrl: string): string {
  const m = /^data:image\/([^;,]+)/i.exec(dataUrl);
  if (!m) return 'jpg';
  const subtype = m[1].toLowerCase().split('+')[0].trim();
  if (subtype === 'jpeg' || subtype === 'jpg' || subtype === 'pjpeg') return 'jpg';
  if (subtype === 'png') return 'png';
  if (subtype === 'webp') return 'webp';
  if (subtype === 'gif') return 'gif';
  if (subtype === 'bmp' || subtype === 'x-ms-bmp') return 'bmp';
  if (subtype === 'svg+xml') return 'svg';
  return 'jpg';
}

export async function triggerImageDownload(dataUrl: string, filenameBase: string): Promise<void> {
  const res = await fetch(dataUrl);
  const srcBlob = await res.blob();
  const parsedExt = fileExtensionForImageDataUrl(dataUrl);
  const ext = parsedExt === 'jpeg' ? 'jpg' : parsedExt;
  const mime = ext === 'jpg' ? 'image/jpeg' : srcBlob.type || `image/${ext}`;
  const bytes = await srcBlob.arrayBuffer();
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenameBase}.${ext}`;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
