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
