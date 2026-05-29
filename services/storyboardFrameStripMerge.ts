import type { StoryboardTableRow } from '../types';
import { resolveStoryboardRowFrameDisplaySrc } from './storyboardFrameImageUrl';
import type { StoryboardDurationGroup } from './storyboardGridDurationGroups';
import { storyboardDurationGroupMergeSignature } from './storyboardGridDurationGroups';
import { resolveStoryboardShotDurationSec, storyboardRowShotLabel } from './storyboardVideoTimeline';

const STRIP_WIDTH = 960;
const STRIP_HEIGHT = 720;
const MERGE_CACHE_MAX = 48;

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
const mergeCache = new Map<string, Promise<string | null>>();

function shouldUseCrossOrigin(src: string): boolean {
  if (!/^https?:\/\//i.test(src) || typeof window === 'undefined') return false;
  try {
    return new URL(src).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function loadFrameImage(rawSrc: string): Promise<HTMLImageElement | null> {
  const src = resolveStoryboardRowFrameDisplaySrc(rawSrc) || rawSrc;
  const cached = imageCache.get(src);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    if (shouldUseCrossOrigin(src)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

export function clearStoryboardStripMergeCaches(): void {
  imageCache.clear();
  mergeCache.clear();
}

function trimMergeCache(): void {
  if (mergeCache.size <= MERGE_CACHE_MAX) return;
  const drop = mergeCache.size - MERGE_CACHE_MAX;
  const keys = mergeCache.keys();
  for (let i = 0; i < drop; i += 1) {
    const k = keys.next().value;
    if (k) mergeCache.delete(k);
  }
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string
): void {
  ctx.fillStyle = '#141418';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.font = `600 ${Math.max(11, Math.round(h * 0.1))}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(120,120,130,0.95)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

async function drawContainedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<void> {
  const ir = img.width / img.height;
  const cr = w / h;
  let dw = w;
  let dh = h;
  let dx = x;
  let dy = y;
  if (ir > cr) {
    dh = w / ir;
    dy = y + (h - dh) / 2;
  } else {
    dw = h * ir;
    dx = x + (w - dw) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawClippedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number
): void {
  if (maxWidth <= 8) return;
  let out = text;
  while (out.length > 1 && ctx.measureText(out).width > maxWidth) {
    out = out.slice(0, -1);
  }
  if (out.length < text.length) out = `${out}…`;
  ctx.fillText(out, x, y);
}

async function drawShotCell(
  ctx: CanvasRenderingContext2D,
  row: StoryboardTableRow,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<void> {
  const label = storyboardRowShotLabel(row, row.index);
  const src = resolveStoryboardRowFrameDisplaySrc(row);
  if (src) {
    const img = await loadFrameImage(src);
    if (img) {
      await drawContainedImage(ctx, img, x, y, w, h);
    } else {
      drawPlaceholder(ctx, x, y, w, h, label);
    }
  } else {
    drawPlaceholder(ctx, x, y, w, h, label);
  }

  const { sec, estimated } = resolveStoryboardShotDurationSec(row);
  const meta = `${label} · ${sec}s${estimated ? '*' : ''}`;
  const bandH = Math.max(18, Math.round(h * 0.12));
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y + h - bandH, w, bandH);
  ctx.font = `500 ${Math.max(9, Math.round(bandH * 0.42))}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  drawClippedText(ctx, meta, x + 6, y + h - Math.round(bandH * 0.35), w - 12);
}

async function renderGroupStrip(group: StoryboardDurationGroup): Promise<string | null> {
  if (typeof document === 'undefined' || group.rows.length === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = STRIP_WIDTH;
  canvas.height = STRIP_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, STRIP_WIDTH, STRIP_HEIGHT);

  const pad = 6;
  const innerW = STRIP_WIDTH - pad * 2;
  const innerH = STRIP_HEIGHT - pad * 2;
  const totalDur =
    group.totalDurationSec > 0
      ? group.totalDurationSec
      : group.rows.reduce((s, r) => s + resolveStoryboardShotDurationSec(r).sec, 0);

  let x = pad;
  for (let i = 0; i < group.rows.length; i += 1) {
    const row = group.rows[i]!;
    const { sec } = resolveStoryboardShotDurationSec(row);
    const ratio = totalDur > 0 ? sec / totalDur : 1 / group.rows.length;
    const cellW = i === group.rows.length - 1 ? pad + innerW - x : Math.max(24, innerW * ratio);
    await drawShotCell(ctx, row, x, pad, cellW, innerH);
    if (i < group.rows.length - 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(x + cellW - 1, pad, 2, innerH);
    }
    x += cellW;
  }

  try {
    return canvas.toDataURL('image/jpeg', 0.88);
  } catch {
    return null;
  }
}

/** 将一组镜头按秒数比例横向拼成 4:3 条带预览图（带内存缓存） */
export function mergeStoryboardGroupPreviewDataUrl(
  group: StoryboardDurationGroup
): Promise<string | null> {
  const key = storyboardDurationGroupMergeSignature(group);
  const cached = mergeCache.get(key);
  if (cached) return cached;

  const promise = renderGroupStrip(group).finally(() => {
    trimMergeCache();
  });
  mergeCache.set(key, promise);
  return promise;
}
