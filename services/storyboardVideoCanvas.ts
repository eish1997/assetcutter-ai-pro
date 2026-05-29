import type { StoryboardVideoSegment } from './storyboardVideoTimeline';

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadStoryboardFrameImage(src: string): Promise<HTMLImageElement | null> {
  const key = src.slice(0, 256);
  const cached = imageCache.get(key);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    if (/^https?:\/\//i.test(src)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  imageCache.set(key, promise);
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

export async function drawStoryboardVideoFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: StoryboardCanvasDrawOpts
): Promise<void> {
  const { segment, progressInSegment, globalTime, totalDuration } = opts;
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, width, height);

  const pad = Math.round(width * 0.035);
  const footerBand = Math.min(Math.round(height * 0.14), Math.round(height * 0.22));
  const innerW = width - pad * 2;
  const innerH = Math.max(1, height - pad * 2 - footerBand);
  const footerY = pad + innerH + Math.round(height * 0.015);

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
    } else {
      drawPlaceholder(ctx, pad, pad, innerW, innerH, segment.shotNo);
    }
  } else {
    drawPlaceholder(ctx, pad, pad, innerW, innerH, segment.shotNo);
  }

  const barH = Math.max(3, Math.round(height * 0.006));
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(pad, footerY, innerW, barH);
  const segRatio =
    segment.durationSec > 0 ? Math.min(1, progressInSegment / segment.durationSec) : 0;
  ctx.fillStyle = 'rgba(167,139,250,0.85)';
  ctx.fillRect(pad, footerY, innerW * segRatio, barH);

  const title = segment.shotNo;
  const durLabel = `${segment.durationSec.toFixed(1)}s${segment.durationIsEstimated ? '*' : ''}`;
  const timeLabel = `${formatClock(globalTime)} / ${formatClock(totalDuration)}`;

  const titleSize = Math.max(10, Math.round(height * 0.026));
  const metaSize = Math.max(9, Math.round(height * 0.02));
  const bodySize = Math.max(8, Math.round(height * 0.018));

  ctx.font = `600 ${titleSize}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillText(title, pad, footerY + Math.round(footerBand * 0.38));

  ctx.font = `500 ${metaSize}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(180,180,190,0.9)';
  const meta = `${durLabel}  ·  ${timeLabel}`;
  ctx.fillText(meta, pad, footerY + Math.round(footerBand * 0.68));

  if (segment.shotText && footerBand >= 36) {
    ctx.font = `400 ${bodySize}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(140,140,150,0.95)';
    const line = segment.shotText.replace(/\s+/g, ' ').slice(0, 64);
    ctx.fillText(line, pad, footerY + Math.round(footerBand * 0.92));
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
