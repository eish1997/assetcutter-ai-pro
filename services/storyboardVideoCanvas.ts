import { resolveStoryboardFrameDisplaySrc } from './storyboardFrameImageUrl';
import type { StoryboardVideoSegment } from './storyboardVideoTimeline';

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function shouldUseCrossOrigin(src: string): boolean {
  if (!/^https?:\/\//i.test(src) || typeof window === 'undefined') return false;
  try {
    return new URL(src).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function loadStoryboardFrameImage(rawSrc: string): Promise<HTMLImageElement | null> {
  const src = resolveStoryboardFrameDisplaySrc(rawSrc) || rawSrc;
  const cached = imageCache.get(src);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    if (shouldUseCrossOrigin(src)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

export function clearStoryboardVideoImageCache(): void {
  imageCache.clear();
}

export type StoryboardCanvasDrawOpts = {
  segment: StoryboardVideoSegment;
  progressInSegment: number;
  globalTime: number;
  totalDuration: number;
};

type FrameLayout = {
  pad: number;
  footerBand: number;
  innerW: number;
  innerH: number;
  footerY: number;
};

function computeFrameLayout(width: number, height: number): FrameLayout {
  const pad = Math.round(width * 0.035);
  const footerBand = Math.min(Math.round(height * 0.14), Math.round(height * 0.22));
  const innerW = width - pad * 2;
  const innerH = Math.max(1, height - pad * 2 - footerBand);
  const footerY = pad + innerH + Math.round(height * 0.015);
  return { pad, footerBand, innerW, innerH, footerY };
}

async function drawSegmentImage(
  ctx: CanvasRenderingContext2D,
  layout: FrameLayout,
  segment: StoryboardVideoSegment,
  progressInSegment: number
): Promise<void> {
  const { pad, innerW, innerH } = layout;
  if (segment.frameImage) {
    const img = await loadStoryboardFrameImage(segment.frameImage);
    if (img) {
      const ir = img.width / img.height;
      const cr = innerW / innerH;
      let dw = innerW;
      let dh = innerH;
      let dx = pad;
      let dy = pad;
      if (ir > cr) {
        dh = innerW / ir;
        dy = pad + (innerH - dh) / 2;
      } else {
        dw = innerH * ir;
        dx = pad + (innerW - dw) / 2;
      }
      ctx.drawImage(img, dx, dy, dw, dh);
      return;
    }
  }
  drawPlaceholder(ctx, pad, pad, innerW, innerH, segment.shotNo);
}

function drawSegmentChrome(
  ctx: CanvasRenderingContext2D,
  layout: FrameLayout,
  segment: StoryboardVideoSegment,
  progressInSegment: number,
  globalTime: number,
  totalDuration: number
): void {
  const { pad, footerBand, innerW, footerY } = layout;

  const barH = Math.max(3, Math.round(layout.innerH * 0.006 + layout.pad * 0.02));
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(pad, footerY, innerW, barH);
  const segRatio =
    segment.durationSec > 0 ? Math.min(1, progressInSegment / segment.durationSec) : 0;
  ctx.fillStyle = 'rgba(167,139,250,0.85)';
  ctx.fillRect(pad, footerY, innerW * segRatio, barH);

  const durLabel = `${segment.durationSec.toFixed(1)}s${segment.durationIsEstimated ? '*' : ''}`;
  const timeLabel = `${formatClock(globalTime)} / ${formatClock(totalDuration)}`;

  const titleSize = Math.max(10, Math.round((layout.innerH + layout.pad) * 0.026));
  const metaSize = Math.max(9, Math.round((layout.innerH + layout.pad) * 0.02));
  const bodySize = Math.max(8, Math.round((layout.innerH + layout.pad) * 0.018));

  ctx.font = `600 ${titleSize}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillText(segment.shotNo, pad, footerY + Math.round(footerBand * 0.38));

  ctx.font = `500 ${metaSize}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(180,180,190,0.9)';
  ctx.fillText(`${durLabel}  ·  ${timeLabel}`, pad, footerY + Math.round(footerBand * 0.68));

  if (segment.shotText && footerBand >= 36) {
    ctx.font = `400 ${bodySize}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(140,140,150,0.95)';
    const line = segment.shotText.replace(/\s+/g, ' ').slice(0, 64);
    ctx.fillText(line, pad, footerY + Math.round(footerBand * 0.92));
  }
}

export type StoryboardLayerFrameState = {
  layer: number;
  segment: StoryboardVideoSegment;
  progressInSegment: number;
};

export async function drawStoryboardVideoCompositeFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: {
    layerStates: StoryboardLayerFrameState[];
    globalTime: number;
    totalDuration: number;
  }
): Promise<void> {
  const { layerStates, globalTime, totalDuration } = opts;
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, width, height);

  if (layerStates.length === 0) return;

  const layout = computeFrameLayout(width, height);
  const sorted = [...layerStates].sort((a, b) => a.layer - b.layer);

  for (const state of sorted) {
    await drawSegmentImage(ctx, layout, state.segment, state.progressInSegment);
  }

  const chrome = sorted[sorted.length - 1]!;
  drawSegmentChrome(
    ctx,
    layout,
    chrome.segment,
    chrome.progressInSegment,
    globalTime,
    totalDuration
  );
}

export async function drawStoryboardVideoFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: StoryboardCanvasDrawOpts
): Promise<void> {
  const { segment, progressInSegment, globalTime, totalDuration } = opts;
  await drawStoryboardVideoCompositeFrame(ctx, width, height, {
    layerStates: [{ layer: segment.timelineLayer ?? 0, segment, progressInSegment }],
    globalTime,
    totalDuration,
  });
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
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.font = `600 ${Math.max(14, Math.round(h * 0.12))}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(100,100,110,0.9)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function formatClock(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  if (m > 0) return `${m}:${r.toFixed(1).padStart(4, '0')}`;
  return `${r.toFixed(1)}s`;
}
