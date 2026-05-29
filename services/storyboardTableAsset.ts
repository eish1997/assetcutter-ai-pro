import type { StoryboardTableDoc, StoryboardTableRow, WorkflowAsset } from '../types';
import { clampStoryboardRowTimelineLayer, resolveStoryboardTimelineLayerCount } from './storyboardVideoTimeline';

const rowId = () => Math.random().toString(36).slice(2, 11);

function normalizeTimelineLayer(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export function isWorkflowStoryboardTableAsset(a: WorkflowAsset): boolean {
  return a.assetKind === 'storyboard_table';
}

export function createStoryboardTableRow(partial?: Partial<StoryboardTableRow>, index = 0): StoryboardTableRow {
  return {
    id: partial?.id || rowId(),
    index,
    shotNo: partial?.shotNo ?? '',
    durationSec: partial?.durationSec ?? null,
    shotText: partial?.shotText ?? '',
    frameImage: partial?.frameImage,
    frameImageObjectKey: partial?.frameImageObjectKey,
    locked: Boolean(partial?.locked),
    timelineLayer: normalizeTimelineLayer(partial?.timelineLayer ?? 0),
  };
}

export function reindexStoryboardRows(rows: StoryboardTableRow[]): StoryboardTableRow[] {
  return rows.map((r, i) => ({ ...r, index: i }));
}

export function normalizeStoryboardTableDoc(raw: unknown): StoryboardTableDoc {
  if (!raw || typeof raw !== 'object') {
    return { rows: [createStoryboardTableRow({}, 0)] };
  }
  const doc = raw as StoryboardTableDoc;
  const rowsIn = Array.isArray(doc.rows) ? doc.rows : [];
  const parsed =
    rowsIn.length > 0
      ? rowsIn.map((r, i) => {
          const row = r && typeof r === 'object' ? (r as StoryboardTableRow) : ({} as StoryboardTableRow);
          const durationRaw = row.durationSec;
          let durationSec: number | null = null;
          if (durationRaw != null && String(durationRaw).trim() !== '') {
            const n = Number(durationRaw);
            durationSec = Number.isFinite(n) && n >= 0 ? n : null;
          }
          return createStoryboardTableRow(
            {
              id: String(row.id || '').trim() || rowId(),
              index: i,
              shotNo: String(row.shotNo ?? '').trim(),
              durationSec,
              shotText: String(row.shotText ?? ''),
              frameImage: String(row.frameImage || '').trim() || undefined,
              frameImageObjectKey: String(row.frameImageObjectKey || '').trim() || undefined,
              locked: Boolean(row.locked),
              timelineLayer: normalizeTimelineLayer(row.timelineLayer ?? 0),
            },
            i
          );
        })
      : [createStoryboardTableRow({}, 0)];
  const layerCount = resolveStoryboardTimelineLayerCount(parsed, doc.timelineLayerCount ?? 1);
  const rows = reindexStoryboardRows(
    parsed.map((r) => ({
      ...r,
      timelineLayer: clampStoryboardRowTimelineLayer(r.timelineLayer ?? 0, layerCount),
    }))
  );
  const title = String(doc.title ?? '').trim();
  return { ...(title ? { title } : {}), timelineLayerCount: layerCount, rows };
}

export function normalizeStoryboardTableOnAsset(asset: WorkflowAsset): WorkflowAsset {
  if (!isWorkflowStoryboardTableAsset(asset)) return asset;
  const table = normalizeStoryboardTableDoc(asset.storyboardTable);
  const title = (asset.textTitle || table.title || '分镜表').trim() || '分镜表';
  const { isGroup: _ig, assetIds: _ai, cutImageGroup: _cig, parentAssetId: _pid, ...rest } = asset;
  return {
    ...rest,
    assetKind: 'storyboard_table',
    textTitle: title,
    original: '',
    displayKey: 'original',
    results: rest.results ?? {},
    storyboardTable: { ...table, title },
  };
}

export function createEmptyStoryboardTableAsset(id: string, title?: string): WorkflowAsset {
  const label = (title || '分镜表').trim() || '分镜表';
  return normalizeStoryboardTableOnAsset({
    id,
    assetKind: 'storyboard_table',
    textTitle: label,
    original: '',
    displayKey: 'original',
    results: {},
    resultOrder: [],
    archived: false,
    hiddenInGrid: false,
    createdAt: Date.now(),
    storyboardTable: {
      title: label,
      rows: [createStoryboardTableRow({}, 0), createStoryboardTableRow({}, 1), createStoryboardTableRow({}, 2)],
    },
  });
}

export function storyboardTableOutlineLabel(a: WorkflowAsset): string {
  const t = (a.textTitle || a.storyboardTable?.title || '分镜表').trim() || '分镜表';
  const n = a.storyboardTable?.rows?.length ?? 0;
  return `${t} · ${n} 镜`;
}

export function storyboardTableCoverImage(a: WorkflowAsset): string {
  const rows = a.storyboardTable?.rows ?? [];
  for (const r of rows) {
    const img = String(r.frameImage || '').trim();
    if (img) return img;
  }
  return '';
}

/** 前 n 个有图镜头的缩略图（表卡胶片条） */
export function storyboardTablePreviewImages(a: WorkflowAsset, limit = 4): string[] {
  const rows = a.storyboardTable?.rows ?? [];
  const out: string[] = [];
  for (const r of rows) {
    const img = String(r.frameImage || '').trim();
    if (!img) continue;
    out.push(img);
    if (out.length >= limit) break;
  }
  return out;
}

export type StoryboardTableStats = {
  rowCount: number;
  lockedCount: number;
  withImageCount: number;
  /** 各行秒数之和；存在未填秒数时 `hasGaps` 为 true */
  totalDurationSec: number;
  hasGaps: boolean;
};

export function computeStoryboardTableStats(doc: StoryboardTableDoc): StoryboardTableStats {
  const rows = doc.rows ?? [];
  let totalDurationSec = 0;
  let hasGaps = false;
  let withImageCount = 0;
  let lockedCount = 0;
  for (const r of rows) {
    if (r.locked) lockedCount += 1;
    if (String(r.frameImage || '').trim()) withImageCount += 1;
    if (r.durationSec == null || !Number.isFinite(r.durationSec)) {
      hasGaps = true;
    } else {
      totalDurationSec += r.durationSec;
    }
  }
  return {
    rowCount: rows.length,
    lockedCount,
    withImageCount,
    totalDurationSec,
    hasGaps,
  };
}

export function formatStoryboardShotNo(index: number): string {
  return String(Math.max(0, index) + 1).padStart(2, '0');
}

export function duplicateStoryboardRow(source: StoryboardTableRow, index: number): StoryboardTableRow {
  return createStoryboardTableRow(
    {
      shotNo: source.shotNo ? `${source.shotNo}'` : formatStoryboardShotNo(index),
      durationSec: source.durationSec ?? null,
      shotText: source.shotText,
      frameImage: source.frameImage,
      frameImageObjectKey: source.frameImageObjectKey,
      locked: false,
      timelineLayer: source.timelineLayer ?? 0,
    },
    index
  );
}

/** 仅为空镜头号填 01、02… */
export function applyAutoShotNumbers(rows: StoryboardTableRow[]): StoryboardTableRow[] {
  return rows.map((r, i) => ({
    ...r,
    shotNo: (r.shotNo || '').trim() || formatStoryboardShotNo(i),
  }));
}
