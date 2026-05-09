/**
 * 将多张 RGBA mask data URL 按 alpha 取最大值合成（多区域叠加预览 / 保存）
 */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('mask image load failed'));
    const s = String(src || '').trim();
    if (!/^data:/i.test(s) && !/^blob:/i.test(s)) {
      im.crossOrigin = 'anonymous';
    }
    im.src = s;
  });
}

export async function unionMaskDataUrlsToDataUrl(dataUrls: string[]): Promise<string | null> {
  const urls = dataUrls.map((s) => String(s || '').trim()).filter(Boolean);
  if (urls.length === 0) return null;
  const images = await Promise.all(urls.map((u) => loadImage(u)));
  const w = images[0]!.naturalWidth || images[0]!.width;
  const h = images[0]!.naturalHeight || images[0]!.height;
  if (w < 1 || h < 1) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const acc = ctx.createImageData(w, h);
  const d = acc.data;
  const tmp = ctx.createImageData(w, h);
  for (const im of images) {
    if ((im.naturalWidth || im.width) !== w || (im.naturalHeight || im.height) !== h) continue;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(im, 0, 0);
    const id = ctx.getImageData(0, 0, w, h);
    const p = id.data;
    for (let i = 0; i < p.length; i += 4) {
      const a = p[i + 3] ?? 0;
      if (a <= d[i + 3]!) continue;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = a;
    }
  }
  ctx.putImageData(acc, 0, 0);
  return c.toDataURL('image/png');
}
