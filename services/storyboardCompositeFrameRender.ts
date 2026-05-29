import type { StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import { resolveStoryboardRowFrameDisplaySrc } from './storyboardFrameImageUrl';
import { storyboardShotCompositeFieldItems } from './storyboardCompositeFields';
import {
  resolveStoryboardShotDurationSec,
  storyboardRowShotLabel,
} from './storyboardVideoTimeline';

const SHOT_CARD_WIDTH = 480;

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

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

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const paragraphs = normalized.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    let chunk = '';
    for (const ch of para) {
      const next = chunk + ch;
      if (ctx.measureText(next).width > maxWidth && chunk) {
        lines.push(chunk);
        chunk = ch.trimStart();
        if (lines.length >= maxLines) return lines;
      } else {
        chunk = next;
      }
    }
    if (chunk) lines.push(chunk);
    if (lines.length >= maxLines) break;
  }

  if (lines.length > maxLines) return lines.slice(0, maxLines);
  if (lines.length === maxLines && lines[maxLines - 1]) {
    const last = lines[maxLines - 1]!;
    let out = last;
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
      out = out.slice(0, -1);
    }
    lines[maxLines - 1] = out.endsWith('…') ? out : `${out}…`;
  }
  return lines;
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
  ctx.font = `600 ${Math.max(12, Math.round(h * 0.12))}px system-ui, sans-serif`;
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

function estimateFieldsHeight(
  itemCount: number,
  width: number,
  hasFallback: boolean
): number {
  if (itemCount <= 0 && !hasFallback) return 0;
  const pad = Math.round(width * 0.05);
  const labelSize = Math.max(8, Math.round(width * 0.017));
  const valueSize = Math.max(9, Math.round(width * 0.021));
  const lineGap = Math.round(valueSize * 0.35);
  const perItem = labelSize + valueSize + lineGap + Math.round(valueSize * 1.1);
  const count = Math.max(itemCount, hasFallback ? 1 : 0);
  return pad * 2 + count * perItem;
}

function drawFieldsSection(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  row: StoryboardTableRow,
  catalog: StoryboardParseFieldDef[]
): number {
  const items = storyboardShotCompositeFieldItems(row, catalog);
  const pad = Math.round(width * 0.05);
  const innerW = width - pad * 2;
  const labelSize = Math.max(8, Math.round(width * 0.017));
  const valueSize = Math.max(9, Math.round(width * 0.021));
  const lineGap = Math.round(valueSize * 0.35);
  let cy = y + pad;

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x, y, width, estimateFieldsHeight(items.length, width, false));

  if (!items.length) {
    const fallback = (row.shotText || row.shotRaw || '').trim() || '（暂无镜头描述）';
    ctx.font = `400 ${valueSize}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(160,160,170,0.95)';
    const lines = wrapTextLines(ctx, fallback, innerW, 3);
    for (const line of lines) {
      ctx.fillText(line, x + pad, cy + valueSize);
      cy += valueSize + lineGap;
    }
    return cy + pad - y;
  }

  for (const item of items) {
    ctx.font = `500 ${labelSize}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(130,130,140,0.95)';
    ctx.fillText(item.label, x + pad, cy + labelSize);

    ctx.font = `400 ${valueSize}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(210,210,220,0.96)';
    const lines = wrapTextLines(ctx, item.value, innerW, 3);
    let vy = cy + labelSize + Math.round(valueSize * 0.25);
    for (const line of lines) {
      ctx.fillText(line, x + pad, vy + valueSize);
      vy += valueSize + Math.round(valueSize * 0.2);
    }
    cy = vy + lineGap;
  }

  return cy + pad - y;
}

/** 将单镜分镜合成卡（4:3 图 + 字段文案）渲染为位图 */
export async function renderStoryboardShotCompositeCanvas(
  row: StoryboardTableRow,
  fieldCatalog: StoryboardParseFieldDef[],
  width = SHOT_CARD_WIDTH
): Promise<HTMLCanvasElement | null> {
  if (typeof document === 'undefined') return null;

  const items = storyboardShotCompositeFieldItems(row, fieldCatalog);
  const imgH = Math.round((width * 3) / 4);
  const fieldsH =
    items.length > 0
      ? estimateFieldsHeight(items.length, width, false)
      : estimateFieldsHeight(0, width, true);
  const height = imgH + fieldsH;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.max(height, imgH);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, width, canvas.height);

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, imgH);

  const label = storyboardRowShotLabel(row, row.index);
  const src = resolveStoryboardRowFrameDisplaySrc(row);
  if (src) {
    const img = await loadFrameImage(src);
    if (img) {
      await drawContainedImage(ctx, img, 0, 0, width, imgH);
    } else {
      drawPlaceholder(ctx, 0, 0, width, imgH, label);
    }
  } else {
    drawPlaceholder(ctx, 0, 0, width, imgH, label);
  }

  const title = storyboardRowShotLabel(row, row.index);
  const duration =
    row.durationSec != null && Number.isFinite(row.durationSec) ? `${row.durationSec}s` : null;
  const { sec, estimated } = resolveStoryboardShotDurationSec(row);
  const durText = duration ?? `${sec}s${estimated ? '*' : ''}`;

  const grad = ctx.createLinearGradient(0, 0, 0, Math.round(imgH * 0.28));
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, Math.round(imgH * 0.28));

  const titleSize = Math.max(11, Math.round(width * 0.025));
  ctx.font = `700 ${titleSize}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillText(title, Math.round(width * 0.05), Math.round(imgH * 0.1));

  const metaSize = Math.max(8, Math.round(width * 0.017));
  ctx.font = `500 ${metaSize}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(200,200,210,0.9)';
  const metaW = ctx.measureText(durText).width;
  ctx.fillText(durText, width - Math.round(width * 0.05) - metaW, Math.round(imgH * 0.1));

  if (fieldsH > 0) {
    drawFieldsSection(ctx, 0, imgH, width, row, fieldCatalog);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, canvas.height - 1);

  return canvas;
}

export async function renderStoryboardShotCompositeDataUrl(
  row: StoryboardTableRow,
  fieldCatalog: StoryboardParseFieldDef[],
  width = SHOT_CARD_WIDTH
): Promise<string | null> {
  const canvas = await renderStoryboardShotCompositeCanvas(row, fieldCatalog, width);
  if (!canvas) return null;
  try {
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return null;
  }
}

export function clearStoryboardCompositeFrameImageCache(): void {
  imageCache.clear();
}
