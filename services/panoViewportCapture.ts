/**
 * 将「当前全景透视快照」data URL 按视口相对框（0~1）裁成 PNG。
 */
export async function cropDataUrlByViewportNorm(
  dataUrl: string,
  r: { x: number; y: number; w: number; h: number }
): Promise<string | null> {
  const im = new Image();
  im.crossOrigin = 'anonymous';
  const ok = await new Promise<boolean>((resolve) => {
    im.onload = () => resolve(true);
    im.onerror = () => resolve(false);
    im.src = dataUrl;
  });
  if (!ok) return null;
  const iw = im.naturalWidth;
  const ih = im.naturalHeight;
  if (!iw || !ih) return null;

  const x0 = Math.max(0, Math.min(1, r.x)) * iw;
  const y0 = Math.max(0, Math.min(1, r.y)) * ih;
  const x1 = Math.max(0, Math.min(1, r.x + r.w)) * iw;
  const y1 = Math.max(0, Math.min(1, r.y + r.h)) * ih;
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const cw = Math.max(1, Math.round(Math.abs(x1 - x0)));
  const ch = Math.max(1, Math.round(Math.abs(y1 - y0)));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(im, left, top, cw, ch, 0, 0, cw, ch);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
