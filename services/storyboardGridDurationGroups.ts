import type { StoryboardTableRow } from '../types';
import { resolveStoryboardShotDurationSec, storyboardRowShotLabel } from './storyboardVideoTimeline';

export const STORYBOARD_GRID_SECONDS_PER_TILE_KEY = 'ac_storyboard_grid_seconds_per_tile_v1';

export const STORYBOARD_GRID_SECONDS_PRESETS = [3, 5, 8, 15] as const;

export type StoryboardDurationGroup = {
  id: string;
  rowIds: string[];
  rows: StoryboardTableRow[];
  startIndex: number;
  endIndex: number;
  totalDurationSec: number;
  hasEstimatedDuration: boolean;
  shotRangeLabel: string;
};

export function normalizeStoryboardGridSecondsPerTile(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.min(60, Math.max(1, Math.round(n * 10) / 10));
}

/** 按时间预算将镜头顺序分组（贪心装箱，与视频时间轴默认时长一致） */
export function groupStoryboardRowsByDurationBudget(
  rows: StoryboardTableRow[],
  secondsPerTile: number
): StoryboardDurationGroup[] {
  const budget = Math.max(0.5, secondsPerTile);
  const sorted = [...rows].sort((a, b) => a.index - b.index);
  const groups: StoryboardDurationGroup[] = [];

  let bucket: StoryboardTableRow[] = [];
  let bucketDur = 0;
  let bucketEstimated = false;

  const flush = () => {
    if (!bucket.length) return;
    const first = bucket[0]!;
    const last = bucket[bucket.length - 1]!;
    const firstLabel = storyboardRowShotLabel(first, first.index);
    const lastLabel = storyboardRowShotLabel(last, last.index);
    groups.push({
      id: `grp-${first.id}-${last.id}`,
      rowIds: bucket.map((r) => r.id),
      rows: [...bucket],
      startIndex: first.index,
      endIndex: last.index,
      totalDurationSec: bucketDur,
      hasEstimatedDuration: bucketEstimated,
      shotRangeLabel: bucket.length === 1 ? firstLabel : `${firstLabel}–${lastLabel}`,
    });
    bucket = [];
    bucketDur = 0;
    bucketEstimated = false;
  };

  for (const row of sorted) {
    const { sec, estimated } = resolveStoryboardShotDurationSec(row);
    if (bucket.length > 0 && bucketDur + sec > budget + 1e-6) {
      flush();
    }
    bucket.push(row);
    bucketDur += sec;
    bucketEstimated = bucketEstimated || estimated;
  }
  flush();

  return groups;
}

/** 多轨道时按层分别分组，再按镜头顺序合并列表 */
export function groupStoryboardRowsForGridPreview(
  rows: StoryboardTableRow[],
  secondsPerTile: number,
  timelineLayerCount = 1
): StoryboardDurationGroup[] {
  const layers = Math.max(1, Math.floor(timelineLayerCount));
  if (layers <= 1) {
    return groupStoryboardRowsByDurationBudget(rows, secondsPerTile);
  }

  const merged: StoryboardDurationGroup[] = [];
  for (let layer = 0; layer < layers; layer += 1) {
    const layerRows = rows.filter((r) => (r.timelineLayer ?? 0) === layer);
    if (!layerRows.length) continue;
    const groups = groupStoryboardRowsByDurationBudget(layerRows, secondsPerTile);
    for (const g of groups) {
      merged.push({
        ...g,
        id: `grp-L${layer}-${g.id}`,
        shotRangeLabel:
          layers > 1 ? `L${layer} · ${g.shotRangeLabel}` : g.shotRangeLabel,
      });
    }
  }
  return merged.sort((a, b) => a.startIndex - b.startIndex);
}

export function storyboardFieldCatalogSignature(catalog: StoryboardParseFieldDef[]): string {
  return [...catalog]
    .sort((a, b) => a.order - b.order)
    .map((f) => `${f.id}:${f.label}:${f.order}`)
    .join('|');
}

export function storyboardDurationGroupMergeSignature(
  group: StoryboardDurationGroup,
  fieldCatalog: StoryboardParseFieldDef[] = []
): string {
  const cat = storyboardFieldCatalogSignature(fieldCatalog);
  const rows = group.rows
    .map((row) => {
      const img = String(row.frameImage || row.frameImageObjectKey || '').trim();
      const companion = String(row.frameImageCompanionKey || '').trim();
      const { sec } = resolveStoryboardShotDurationSec(row);
      const fields = Object.keys(row.shotFields)
        .sort()
        .map((k) => `${k}=${String(row.shotFields[k] || '').trim()}`)
        .join(';');
      const raw = String(row.shotRaw || row.shotText || '').trim();
      return `${row.id}:${sec}:${img}:${companion}:${fields}:${raw}`;
    })
    .join('|');
  return `${cat}::${rows}`;
}

export function findStoryboardGroupIndexForRow(
  groups: StoryboardDurationGroup[],
  rowId: string
): number {
  return groups.findIndex((g) => g.rowIds.includes(rowId));
}
