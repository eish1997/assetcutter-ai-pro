import type { StoryboardParseFieldDef, StoryboardTableRow } from '../types';
import { formatStoryboardShotNo } from './storyboardShotNoFormat';
import { pickPrimaryVisualField } from './storyboardTableParse';
import { resolveStoryboardFrameDisplaySrc } from './storyboardFrameImageUrl';

/** 未填写秒数时的预览默认时长 */
export const STORYBOARD_DEFAULT_SHOT_DURATION_SEC = 2;

/** 时间轴最多轨道层数（含第 0 层） */
export const STORYBOARD_TIMELINE_LAYER_MAX = 4;

export function clampStoryboardTimelineLayerCount(count: number): number {
  if (!Number.isFinite(count)) return 1;
  return Math.min(STORYBOARD_TIMELINE_LAYER_MAX, Math.max(1, Math.floor(count)));
}

export type StoryboardVideoSegment = {
  rowId: string;
  index: number;
  shotNo: string;
  durationSec: number;
  durationIsEstimated: boolean;
  frameImage?: string;
  shotText: string;
  shotFields: Record<string, string>;
  timelineLayer: number;
};

export type StoryboardVideoLayer = {
  layer: number;
  segments: StoryboardVideoSegment[];
  totalDuration: number;
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

export function rowsInTimelineLayer(rows: StoryboardTableRow[], layer: number): StoryboardTableRow[] {
  return rows
    .filter((r) => (r.timelineLayer ?? 0) === layer)
    .sort((a, b) => a.index - b.index);
}

export function clampStoryboardRowTimelineLayer(
  layer: number,
  layerCount: number
): number {
  const max = Math.max(0, clampStoryboardTimelineLayerCount(layerCount) - 1);
  if (!Number.isFinite(layer)) return 0;
  return Math.min(max, Math.max(0, Math.floor(layer)));
}

export function resolveStoryboardTimelineLayerCount(
  rows: StoryboardTableRow[],
  docLayerCount?: number | null
): number {
  let maxFromRows = 1;
  for (const r of rows) {
    maxFromRows = Math.max(maxFromRows, (r.timelineLayer ?? 0) + 1);
  }
  return clampStoryboardTimelineLayerCount(Math.max(docLayerCount ?? 1, maxFromRows));
}

export function buildStoryboardVideoSegments(
  rows: StoryboardTableRow[],
  layer?: number,
  fieldCatalog: StoryboardParseFieldDef[] = []
): StoryboardVideoSegment[] {
  const filtered =
    layer == null
      ? [...rows].sort((a, b) => a.index - b.index)
      : rowsInTimelineLayer(rows, layer);
  return filtered.map((row, index) => {
    const { sec, estimated } = resolveStoryboardShotDurationSec(row);
    const displaySrc = resolveStoryboardFrameDisplaySrc(row.frameImage, row.frameImageObjectKey);
    const visual = pickPrimaryVisualField(fieldCatalog, row.shotFields)?.value;
    return {
      rowId: row.id,
      index,
      shotNo: storyboardRowShotLabel(row, row.index),
      durationSec: sec,
      durationIsEstimated: estimated,
      frameImage: displaySrc,
      shotText: visual || String(row.shotText || '').trim(),
      shotFields: { ...row.shotFields },
      timelineLayer: row.timelineLayer ?? 0,
    };
  });
}

export function buildStoryboardVideoLayers(
  rows: StoryboardTableRow[],
  layerCount: number,
  fieldCatalog: StoryboardParseFieldDef[] = []
): StoryboardVideoLayer[] {
  const count = clampStoryboardTimelineLayerCount(layerCount);
  return Array.from({ length: count }, (_, layer) => {
    const segments = buildStoryboardVideoSegments(rows, layer, fieldCatalog);
    return {
      layer,
      segments,
      totalDuration: computeStoryboardVideoTotalDuration(segments),
    };
  });
}

export function computeStoryboardVideoLayersTotalDuration(layers: StoryboardVideoLayer[]): number {
  if (layers.length === 0) return 0;
  return Math.max(0, ...layers.map((l) => l.totalDuration));
}

export function findStoryboardTopSegmentAtTime(
  layers: StoryboardVideoLayer[],
  timeSec: number
): StoryboardPlaybackPosition | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]!;
    if (layer.segments.length === 0) continue;
    if (timeSec > layer.totalDuration + 1e-6) continue;
    const pos = findStoryboardSegmentAtTime(layer.segments, timeSec);
    if (pos) return pos;
  }
  const base = layers[0];
  if (base?.segments.length) {
    return findStoryboardSegmentAtTime(base.segments, timeSec);
  }
  return null;
}

/** 合成用：已结束的轨道保持最后一帧 */
export function findStoryboardLayerSegmentForComposite(
  layer: StoryboardVideoLayer,
  timeSec: number
): StoryboardPlaybackPosition | null {
  if (layer.segments.length === 0) return null;
  return findStoryboardSegmentAtTime(layer.segments, timeSec);
}

export function findStoryboardRowStartTime(
  layers: StoryboardVideoLayer[],
  rowId: string
): number | null {
  for (const layer of layers) {
    let t = 0;
    for (const seg of layer.segments) {
      if (seg.rowId === rowId) return t;
      t += seg.durationSec;
    }
  }
  return null;
}

function layerRowIdsInOrder(rows: StoryboardTableRow[], layer: number): string[] {
  return rowsInTimelineLayer(rows, layer).map((r) => r.id);
}

/** 将某轨道层内 fromIndex 拖到 toIndex（层内序号） */
export function reorderStoryboardRowsInLayer(
  rows: StoryboardTableRow[],
  layer: number,
  fromLayerIndex: number,
  toLayerIndex: number
): StoryboardTableRow[] {
  const layerIds = layerRowIdsInOrder(rows, layer);
  if (fromLayerIndex === toLayerIndex) return rows;
  if (fromLayerIndex < 0 || fromLayerIndex >= layerIds.length) return rows;
  if (toLayerIndex < 0 || toLayerIndex >= layerIds.length) return rows;

  const fromId = layerIds[fromLayerIndex]!;
  const toId = layerIds[toLayerIndex]!;
  const fromGlobal = rows.findIndex((r) => r.id === fromId);
  const toGlobal = rows.findIndex((r) => r.id === toId);
  return reorderStoryboardRows(rows, fromGlobal, toGlobal);
}

export function collapseStoryboardTimelineTopLayer(
  rows: StoryboardTableRow[],
  layerCount: number
): { rows: StoryboardTableRow[]; layerCount: number } {
  if (layerCount <= 1) return { rows, layerCount: 1 };
  const top = layerCount - 1;
  const nextRows = rows.map((r) => {
    const l = r.timelineLayer ?? 0;
    if (l === top) return { ...r, timelineLayer: top - 1 };
    return r;
  });
  return { rows: nextRows, layerCount: layerCount - 1 };
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
  const total = computeStoryboardVideoTotalDuration(segments);
  const t = Math.max(0, Math.min(timeSec, total));
  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const end = cursor + seg.durationSec;
    const isLast = i === segments.length - 1;
    // 切点 inclusive：t === end 时仍归属当前镜，避免跳到下一镜
    if (t <= end || isLast) {
      return {
        segment: seg,
        segmentIndex: i,
        offsetInSegment: Math.min(seg.durationSec, Math.max(0, t - cursor)),
        globalTime: t,
      };
    }
    cursor = end;
  }
  const last = segments[segments.length - 1]!;
  return {
    segment: last,
    segmentIndex: segments.length - 1,
    offsetInSegment: last.durationSec,
    globalTime: total,
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

/** 将指针在轨道轴上的 X 坐标映射为全局时间（秒） */
export function storyboardTimelineTimeFromClientX(
  clientX: number,
  axisRect: DOMRect,
  totalDuration: number
): number {
  if (totalDuration <= 0 || axisRect.width <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, (clientX - axisRect.left) / axisRect.width));
  return ratio * totalDuration;
}

/** 根据时间轴上的落点索引计算拖拽插入位置（按全局时间轴比例映射） */
export function storyboardTimelineDropIndex(
  clientX: number,
  axisRect: DOMRect,
  segmentCount: number,
  segmentDurations: number[],
  draggingIndex: number,
  globalDuration: number
): number {
  if (segmentCount <= 1) return 0;
  const layerTotal = segmentDurations.reduce((a, b) => a + b, 0) || 1;
  const targetTime = Math.min(layerTotal, storyboardTimelineTimeFromClientX(clientX, axisRect, globalDuration));

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
