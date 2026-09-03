import { isWorkshopSpecialRasterName, workshopPreviewExt } from './workshopPreviewKind';

export { isWorkshopSpecialRasterName };

const CARD_EDGE = 256;
const LIGHTBOX_EDGE = 1024;
const JPEG_MEMO_MAX = 80;
const jpegMemo = new Map<string, string>();

export const SPECIAL_RASTER_DECODE_PARALLEL = 2;

export function workshopSpecialRasterSourceRow(
  y: number,
  srcH: number,
  outH: number,
  flipY: boolean,
): number {
  const sy = Math.min(srcH - 1, Math.floor((y * srcH) / outH));
  return flipY ? srcH - 1 - sy : sy;
}

function jpegMemoKey(fileKey: string, lightbox: boolean): string {
  return `${String(fileKey || '').trim()}::${lightbox ? 'lb' : 'card'}`;
}

export function peekWorkshopSpecialRasterJpeg(fileKey: string, lightbox: boolean): string | null {
  const key = jpegMemoKey(fileKey, lightbox);
  const hit = jpegMemo.get(key);
  if (!hit) return null;
  jpegMemo.delete(key);
  jpegMemo.set(key, hit);
  return hit;
}

export function rememberWorkshopSpecialRasterJpeg(fileKey: string, lightbox: boolean, jpeg: string): void {
  const key = jpegMemoKey(fileKey, lightbox);
  if (!key.startsWith('::') && jpeg) {
    jpegMemo.delete(key);
    jpegMemo.set(key, jpeg);
    while (jpegMemo.size > JPEG_MEMO_MAX) {
      const oldest = jpegMemo.keys().next().value;
      if (!oldest) break;
      jpegMemo.delete(oldest);
    }
  }
}

function clampEdge(maxEdge: number, fallback: number): number {
  const n = Math.floor(Number(maxEdge) || 0);
  return n > 0 ? Math.min(4096, Math.max(64, n)) : fallback;
}

function scaleSize(width: number, height: number, maxEdge: number): { w: number; h: number } {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const edge = Math.max(w, h);
  if (edge <= maxEdge) return { w, h };
  const s = maxEdge / edge;
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

function autoExposeScale(data: ArrayLike<number>, channels: number): number {
  const pixels = Math.floor(data.length / Math.max(1, channels));
  if (pixels < 1) return 1;
  const step = Math.max(1, Math.floor(pixels / 4000));
  const samples: number[] = [];
  for (let i = 0; i < pixels; i += step) {
    const o = i * channels;
    const r = Number(data[o] || 0);
    const g = Number(data[o + 1] || 0);
    const b = Number(data[o + 2] || 0);
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (Number.isFinite(y) && y > 1e-6) samples.push(y);
  }
  if (!samples.length) return 1;
  samples.sort((a, b) => a - b);
  const p = samples[Math.floor(samples.length * 0.9)] || samples[samples.length - 1] || 1;
  return 0.72 / Math.max(p, 1e-4);
}

function floatBufferToJpeg(
  data: ArrayLike<number>,
  width: number,
  height: number,
  channels: number,
  maxEdge: number,
  quality: number,
  flipY: boolean,
): string | null {
  if (typeof document === 'undefined') return null;
  const srcW = Math.max(1, Math.floor(width));
  const srcH = Math.max(1, Math.floor(height));
  const ch = Math.max(1, Math.floor(channels));
  if (data.length < srcW * srcH * Math.min(3, ch)) return null;
  const { w, h } = scaleSize(srcW, srcH, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(w, h);
  const out = image.data;
  const scale = autoExposeScale(data, ch);
  for (let y = 0; y < h; y += 1) {
    const sy = workshopSpecialRasterSourceRow(y, srcH, h, flipY);
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / w));
      const si = (sy * srcW + sx) * ch;
      const di = (y * w + x) * 4;
      const tone = (v: number) => {
        const mapped = 1 - Math.exp(-Math.max(0, v) * scale);
        return Math.max(0, Math.min(255, Math.round(Math.pow(mapped, 1 / 2.2) * 255)));
      };
      out[di] = tone(Number(data[si] || 0));
      out[di + 1] = tone(Number(data[si + 1] || 0));
      out[di + 2] = tone(Number(data[si + 2] || 0));
      out[di + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const jpeg = canvas.toDataURL('image/jpeg', quality);
  return jpeg;
}

async function decodeHdrOrExr(url: string, ext: string, maxEdge: number, quality: number): Promise<string | null> {
  const { FloatType } = await import('three');
  const { EXRLoader } = await import('three/examples/jsm/loaders/EXRLoader.js');
  const { HDRLoader } = await import('three/examples/jsm/loaders/HDRLoader.js');
  const loader = ext === '.exr' ? new EXRLoader() : new HDRLoader();
  loader.type = FloatType;
  const tex = await loader.loadAsync(url);
  const image = tex?.image as { data?: ArrayLike<number>; width?: number; height?: number } | undefined;
  const data = image?.data;
  const width = Number(image?.width || 0);
  const height = Number(image?.height || 0);
  if (!data || width < 1 || height < 1) {
    tex?.dispose?.();
    return null;
  }
  const channels = Math.max(1, Math.round(data.length / (width * height)));
  const jpeg = floatBufferToJpeg(data, width, height, channels, maxEdge, quality, true);
  tex.dispose?.();
  return jpeg;
}

async function decodePsd(url: string, maxEdge: number, quality: number): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const { readPsd } = await import('ag-psd');
  const psd = readPsd(buf, { skipLayerImageData: true });
  const source = (psd.canvas || null) as HTMLCanvasElement | null;
  if (!source || typeof document === 'undefined') return null;
  const { w, h } = scaleSize(source.width, source.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function decodeWorkshopSpecialRasterToJpeg(opts: {
  url: string;
  fileName?: string;
  maxEdge?: number;
  quality?: number;
  lightbox?: boolean;
}): Promise<string | null> {
  const url = String(opts.url || '').trim();
  const name = String(opts.fileName || url).trim();
  if (!url || (!isWorkshopSpecialRasterName(name) && !isWorkshopSpecialRasterName(url))) return null;
  const ext = workshopPreviewExt(name) || workshopPreviewExt(url);
  const maxEdge = clampEdge(opts.maxEdge || 0, opts.lightbox ? LIGHTBOX_EDGE : CARD_EDGE);
  const quality = Math.min(0.92, Math.max(0.5, Number(opts.quality) || 0.82));
  try {
    if (ext === '.psd') return await decodePsd(url, maxEdge, quality);
    if (ext === '.exr' || ext === '.hdr') return await decodeHdrOrExr(url, ext, maxEdge, quality);
  } catch {
    return null;
  }
  return null;
}
