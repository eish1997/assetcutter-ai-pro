import type { StoryboardTableRow } from '../types';
import { resolveStoryboardRowFrameDataUrl } from './storyboardTableRedraw';

const ASPECT_CANDIDATES: Array<{ label: string; ratio: number }> = [
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '1:1', ratio: 1 },
];

/** 由像素尺寸推断最接近的标准画幅（供生图 aspectRatio） */
export function aspectRatioLabelFromPixelSize(width: number, height: number): string | undefined {
  const w = Math.round(width);
  const h = Math.round(height);
  if (w <= 0 || h <= 0) return undefined;
  const r = w / h;
  let best = ASPECT_CANDIDATES[0]!;
  let bestDiff = Math.abs(r - best.ratio);
  for (const item of ASPECT_CANDIDATES) {
    const diff = Math.abs(r - item.ratio);
    if (diff < bestDiff) {
      best = item;
      bestDiff = diff;
    }
  }
  return best.label;
}

function loadImageSize(dataUrl: string): Promise<{ w: number; h: number } | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      resolve(w > 0 && h > 0 ? { w, h } : null);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** 读取镜头分镜图宽高并映射为标准 aspectRatio 字符串 */
export async function resolveStoryboardRowFrameAspectRatio(
  row: StoryboardTableRow,
  companion?: { companionBaseUrl?: string; companionProjectId?: string; frameDataUrl?: string }
): Promise<string | undefined> {
  const preset = String(companion?.frameDataUrl || '').trim();
  if (preset) {
    const size = await loadImageSize(preset);
    if (size) return aspectRatioLabelFromPixelSize(size.w, size.h);
  }
  const frame = await resolveStoryboardRowFrameDataUrl(
    row,
    companion?.companionBaseUrl ?? '',
    companion?.companionProjectId ?? ''
  );
  if (!frame.ok) return undefined;
  const size = await loadImageSize(frame.dataUrl);
  if (!size) return undefined;
  return aspectRatioLabelFromPixelSize(size.w, size.h);
}
