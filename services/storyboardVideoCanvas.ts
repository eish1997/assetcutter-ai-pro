import { resolveStoryboardFrameDisplaySrc } from './storyboardFrameImageUrl';
import type { StoryboardVideoSegment } from './storyboardVideoTimeline';
import type { StoryboardParseFieldDef } from '../types';
import {
  buildStoryboardVideoOverlayLines,
  type StoryboardVideoOverlayLine,
} from './storyboardVideoOverlayFields';

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

/** @internal vitest — 画幅布局指标 */
export function storyboardVideoFrameLayoutMetrics(
  width: number,
  height: number,
  hasOverlayFields: boolean
): {
  imageShare: number;
  chromeBand: number;
  overlayBand: number;
  textZoneHeight: number;
  overlayBodySize: number;
} {
  const layout = computeFrameLayout(width, height, hasOverlayFields);
  const overlayBand = layout.footerBand - layout.chromeBand;
  return {
    imageShare: layout.innerH / height,
    chromeBand: layout.chromeBand,
    overlayBand,
    textZoneHeight: layout.textZoneBottom - layout.textZoneTop,
    overlayBodySize: layout.overlayBodySize,
  };
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
  chromeBand: number;
  innerW: number;
  innerH: number;
  footerY: number;
  textZoneTop: number;
  textZoneBottom: number;
  titleSize: number;
  metaSize: number;
  overlayLabelSize: number;
  overlayBodySize: number;
  titleMetaSameRow: boolean;
};

type VideoFrameLayoutProfile = {
  padRatio: number;
  chromeRatio: number;
  overlayRatio: number;
  imageGapRatio: number;
  textZoneStartInOverlay: number;
  titleSizeRatio: number;
  metaSizeRatio: number;
  overlayLabelRatio: number;
  overlayBodyRatio: number;
  titleSizeMin: number;
  metaSizeMin: number;
  overlayLabelMin: number;
  overlayBodyMin: number;
  titleMetaSameRow: boolean;
};

function resolveVideoFrameLayoutProfile(width: number, height: number): VideoFrameLayoutProfile {
  const ar = width / height;
  if (ar >= 1.55) {
    return {
      padRatio: 0.02,
      chromeRatio: 0.088,
      overlayRatio: 0.115,
      imageGapRatio: 0.006,
      textZoneStartInOverlay: 0.08,
      titleSizeRatio: 0.028,
      metaSizeRatio: 0.022,
      overlayLabelRatio: 0.02,
      overlayBodyRatio: 0.024,
      titleSizeMin: 13,
      metaSizeMin: 11,
      overlayLabelMin: 10,
      overlayBodyMin: 12,
      titleMetaSameRow: true,
    };
  }
  if (ar <= 0.72) {
    return {
      padRatio: 0.028,
      chromeRatio: 0.1,
      overlayRatio: 0.13,
      imageGapRatio: 0.008,
      textZoneStartInOverlay: 0.1,
      titleSizeRatio: 0.024,
      metaSizeRatio: 0.02,
      overlayLabelRatio: 0.019,
      overlayBodyRatio: 0.022,
      titleSizeMin: 12,
      metaSizeMin: 10,
      overlayLabelMin: 10,
      overlayBodyMin: 11,
      titleMetaSameRow: false,
    };
  }
  if (ar >= 1.12) {
    return {
      padRatio: 0.024,
      chromeRatio: 0.095,
      overlayRatio: 0.12,
      imageGapRatio: 0.007,
      textZoneStartInOverlay: 0.09,
      titleSizeRatio: 0.026,
      metaSizeRatio: 0.021,
      overlayLabelRatio: 0.0195,
      overlayBodyRatio: 0.023,
      titleSizeMin: 12,
      metaSizeMin: 10,
      overlayLabelMin: 10,
      overlayBodyMin: 11,
      titleMetaSameRow: true,
    };
  }
  return {
    padRatio: 0.026,
    chromeRatio: 0.1,
    overlayRatio: 0.125,
    imageGapRatio: 0.008,
    textZoneStartInOverlay: 0.1,
    titleSizeRatio: 0.025,
    metaSizeRatio: 0.02,
    overlayLabelRatio: 0.019,
    overlayBodyRatio: 0.022,
    titleSizeMin: 12,
    metaSizeMin: 10,
    overlayLabelMin: 10,
    overlayBodyMin: 11,
    titleMetaSameRow: false,
  };
}

function roundTextSize(height: number, ratio: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(height * ratio)));
}

/** 按画幅比例分配画面区与底栏；底栏高度仅随「有无叠加字段」变化 */
function computeFrameLayout(width: number, height: number, hasOverlayFields: boolean): FrameLayout {
  const profile = resolveVideoFrameLayoutProfile(width, height);
  const pad = Math.max(4, Math.round(width * profile.padRatio));
  const chromeBand = Math.max(28, Math.round(height * profile.chromeRatio));
  const overlayBand = hasOverlayFields
    ? Math.max(36, Math.round(height * profile.overlayRatio))
    : 0;
  const footerBand = chromeBand + overlayBand;
  const imageGap = Math.max(2, Math.round(height * profile.imageGapRatio));
  const innerW = width - pad * 2;
  const innerH = Math.max(1, height - pad * 2 - footerBand - imageGap);
  const footerY = pad + innerH + imageGap;
  const textZoneTop =
    footerY +
    chromeBand +
    (hasOverlayFields ? Math.round(overlayBand * profile.textZoneStartInOverlay) : 0);
  const textZoneBottom = footerY + footerBand - Math.max(3, Math.round(footerBand * 0.04));

  return {
    pad,
    footerBand,
    chromeBand,
    innerW,
    innerH,
    footerY,
    textZoneTop,
    textZoneBottom,
    titleSize: roundTextSize(height, profile.titleSizeRatio, profile.titleSizeMin, 28),
    metaSize: roundTextSize(height, profile.metaSizeRatio, profile.metaSizeMin, 22),
    overlayLabelSize: roundTextSize(
      height,
      profile.overlayLabelRatio,
      profile.overlayLabelMin,
      18
    ),
    overlayBodySize: roundTextSize(height, profile.overlayBodyRatio, profile.overlayBodyMin, 20),
    titleMetaSameRow: profile.titleMetaSameRow,
  };
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

function drawClippedLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number
): void {
  let out = text;
  while (out.length > 1 && ctx.measureText(out).width > maxWidth) {
    out = out.slice(0, -1);
  }
  if (out.length < text.length) out = `${out}…`;
  ctx.fillText(out, x, y);
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
  return lines.slice(0, maxLines);
}

function drawOverlayTextLines(
  ctx: CanvasRenderingContext2D,
  layout: FrameLayout,
  lines: StoryboardVideoOverlayLine[]
): void {
  if (!lines.length) return;
  const zoneH = Math.max(12, layout.textZoneBottom - layout.textZoneTop);
  const labelSize = layout.overlayLabelSize;
  const bodySize = layout.overlayBodySize;
  const lineH = Math.round(bodySize * 1.38);
  const sep = ' · ';
  const maxLines = Math.max(1, Math.floor(zoneH / lineH));
  const right = layout.pad + layout.innerW;

  let x = layout.pad;
  let y = layout.textZoneTop + bodySize;
  let row = 1;

  const measureSep = () => {
    ctx.font = `400 ${bodySize}px system-ui, sans-serif`;
    return ctx.measureText(sep).width;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const labelText = `${line.label}：`;
    const valueText = line.value.replace(/\s+/g, ' ');

    ctx.font = `600 ${labelSize}px system-ui, sans-serif`;
    const labelW = ctx.measureText(labelText).width;
    ctx.font = `400 ${bodySize}px system-ui, sans-serif`;

    const needSep = x > layout.pad;
    const sepW = needSep ? measureSep() : 0;

    if (x + sepW + labelW + ctx.measureText(valueText).width > right && x > layout.pad) {
      x = layout.pad;
      y += lineH;
      row += 1;
      if (row > maxLines) return;
    }

    if (needSep && x > layout.pad) {
      ctx.font = `400 ${bodySize}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(100,100,110,0.95)';
      ctx.fillText(sep.trim(), x, y);
      x += sepW;
    }

    ctx.font = `600 ${labelSize}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(165,165,175,0.98)';
    ctx.fillText(labelText, x, y);
    x += labelW;

    ctx.font = `400 ${bodySize}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(235,235,242,0.98)';
    const avail = right - x;
    if (ctx.measureText(valueText).width <= avail) {
      ctx.fillText(valueText, x, y);
      x += ctx.measureText(valueText).width + Math.round(bodySize * 0.55);
      continue;
    }

    const valueLines = wrapTextLines(ctx, valueText, avail, maxLines - row + 1);
    for (let vi = 0; vi < valueLines.length; vi += 1) {
      const vl = valueLines[vi]!;
      if (vi > 0) {
        x = layout.pad;
        y += lineH;
        row += 1;
        if (row > maxLines) return;
      }
      ctx.fillText(vl, x, y);
      x = layout.pad + ctx.measureText(vl).width + Math.round(bodySize * 0.55);
    }
  }
}

function drawSegmentChrome(
  ctx: CanvasRenderingContext2D,
  layout: FrameLayout,
  segment: StoryboardVideoSegment,
  progressInSegment: number,
  globalTime: number,
  totalDuration: number,
  overlayLines: StoryboardVideoOverlayLine[]
): void {
  const { pad, chromeBand, innerW, footerY, titleSize, metaSize } = layout;

  const barH = Math.max(3, Math.round(chromeBand * 0.1));
  const barY = footerY + Math.round(chromeBand * 0.12);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(pad, barY, innerW, barH);
  const segRatio =
    segment.durationSec > 0 ? Math.min(1, progressInSegment / segment.durationSec) : 0;
  ctx.fillStyle = 'rgba(167,139,250,0.85)';
  ctx.fillRect(pad, barY, innerW * segRatio, barH);

  const durLabel = `${segment.durationSec.toFixed(1)}s${segment.durationIsEstimated ? '*' : ''}`;
  const timeLabel = `${formatClock(globalTime)} / ${formatClock(totalDuration)}`;
  const metaText = `${durLabel}  ·  ${timeLabel}`;
  const textY = footerY + Math.round(chromeBand * 0.72);

  ctx.font = `600 ${titleSize}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fillText(segment.shotNo, pad, textY);

  ctx.font = `500 ${metaSize}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(185,185,195,0.95)';
  if (layout.titleMetaSameRow) {
    ctx.textAlign = 'right';
    ctx.fillText(metaText, pad + innerW, textY);
    ctx.textAlign = 'left';
  } else {
    ctx.fillText(metaText, pad, footerY + Math.round(chromeBand * 0.9));
  }

  if (overlayLines.length > 0) {
    drawOverlayTextLines(ctx, layout, overlayLines);
  } else if (segment.shotText) {
    const bodySize = Math.max(layout.metaSize, layout.overlayBodySize - 1);
    const bodyY = layout.titleMetaSameRow
      ? barY + barH + Math.round(bodySize * 1.05)
      : footerY + Math.round(chromeBand * 0.52);
    ctx.font = `400 ${bodySize}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(160,160,170,0.95)';
    drawClippedLine(
      ctx,
      segment.shotText.replace(/\s+/g, ' '),
      pad,
      bodyY,
      innerW
    );
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
    fieldCatalog?: StoryboardParseFieldDef[];
  }
): Promise<void> {
  const { layerStates, globalTime, totalDuration, fieldCatalog = [] } = opts;
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, width, height);

  if (layerStates.length === 0) return;

  const sorted = [...layerStates].sort((a, b) => a.layer - b.layer);
  const chrome = sorted[sorted.length - 1]!;
  const overlayLines = buildStoryboardVideoOverlayLines(chrome.segment.shotFields, fieldCatalog);
  const layout = computeFrameLayout(width, height, overlayLines.length > 0);

  for (const state of sorted) {
    await drawSegmentImage(ctx, layout, state.segment, state.progressInSegment);
  }

  drawSegmentChrome(
    ctx,
    layout,
    chrome.segment,
    chrome.progressInSegment,
    globalTime,
    totalDuration,
    overlayLines
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
