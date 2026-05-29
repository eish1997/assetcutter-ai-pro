import type { StoryboardTableRow } from '../types';
import { formatStoryboardShotNo } from './storyboardTableAsset';

/** 未填写秒数时的预览默认时长 */
export const STORYBOARD_DEFAULT_SHOT_DURATION_SEC = 2;

export type StoryboardVideoSegment = {
  rowId: string;
  index: number;
  shotNo: string;
  durationSec: number;
  durationIsEstimated: boolean;
  frameImage?: string;
  shotText: string;
};

export function resolveStoryboardShotDurationSec(row: StoryboardTableRow): {
  sec: number;
  estimated: boolean;
} {
  if (row.durationSec != null && Number.isFinite(row.durationSec) && row.durationSec >= 0) {
    return { sec: row.durationSec, estimated: false };
  }
  return { sec: STORYBOARD_DEFAULT_SHOT_DURATION_SEC, estimated: true };
}

export function storyboardRowShotLabel(row: StoryboardTableRow, index: number): string {
  const no = (row.shotNo || '').trim();
  return no || formatStoryboardShotNo(index);
}

export function buildStoryboardVideoSegments(rows: StoryboardTableRow[]): StoryboardVideoSegment[] {
  return rows.map((row, index) => {
    const { sec, estimated } = resolveStoryboardShotDurationSec(row);
    const img = String(row.frameImage || '').trim();
    return {
      rowId: row.id,
      index,
      shotNo: storyboardRowShotLabel(row, index),
      durationSec: sec,
      durationIsEstimated: estimated,
      frameImage: img || undefined,
      shotText: String(row.shotText || '').trim(),
    };
  });
}

export function computeStoryboardVideoTotalDuration(segments: StoryboardVideoSegment[]): number {
  return segments.reduce((sum, s) => sum + s.durationSec, 0);
}

export type StoryboardPlaybackPosition = {
  segment: StoryboardVideoSegment;
  segmentIndex: number;
  offsetInSegment: number;
  globalTime: number;
};

export function findStoryboardSegmentAtTime(
  segments: StoryboardVideoSegment[],
  timeSec: number
): StoryboardPlaybackPosition | null {
  if (segments.length === 0) return null;
  const t = Math.max(0, timeSec);
  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const end = cursor + seg.durationSec;
    if (t < end || i === segments.length - 1) {
      return {
        segment: seg,
        segmentIndex: i,
        offsetInSegment: Math.min(seg.durationSec, Math.max(0, t - cursor)),
        globalTime: Math.min(t, computeStoryboardVideoTotalDuration(segments)),
      };
    }
    cursor = end;
  }
  const last = segments[segments.length - 1]!;
  return {
    segment: last,
    segmentIndex: segments.length - 1,
    offsetInSegment: last.durationSec,
    globalTime: computeStoryboardVideoTotalDuration(segments),
  };
}

/** 将行数组 fromIndex 拖到 toIndex（松手位置） */
export function reorderStoryboardRows(
  rows: StoryboardTableRow[],
  fromIndex: number,
  toIndex: number
): StoryboardTableRow[] {
  if (fromIndex === toIndex) return rows;
  if (fromIndex < 0 || fromIndex >= rows.length) return rows;
  if (toIndex < 0 || toIndex >= rows.length) return rows;
  const next = [...rows];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

/** 根据时间轴上的落点索引计算拖拽插入位置 */
export function storyboardTimelineDropIndex(
  clientX: number,
  trackRect: DOMRect,
  segmentCount: number,
  segmentDurations: number[],
  draggingIndex: number
): number {
  if (segmentCount <= 1) return 0;
  const total = segmentDurations.reduce((a, b) => a + b, 0) || 1;
  const x = Math.max(0, Math.min(trackRect.width, clientX - trackRect.left));
  const ratio = x / trackRect.width;
  const targetTime = ratio * total;

  let cursor = 0;
  for (let i = 0; i < segmentCount; i++) {
    const dur = segmentDurations[i] ?? 0;
    const mid = cursor + dur / 2;
    if (targetTime < mid) {
      let insert = i;
      if (draggingIndex < insert) insert -= 1;
      return Math.max(0, Math.min(segmentCount - 1, insert));
    }
    cursor += dur;
  }
  let insert = segmentCount - 1;
  if (draggingIndex < insert) insert -= 1;
  return Math.max(0, insert);
}
