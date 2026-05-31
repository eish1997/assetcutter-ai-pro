import type { StoryboardParseFieldDef, StoryboardTableDoc, StoryboardTableRow, WorkflowAsset } from '../types';
import { storyboardRowHasFrameRef, resolveStoryboardRowFrameDisplaySrc } from './storyboardFrameImageUrl';
import {
  applyShotFieldsPatch,
  compileShotText,
  normalizeFieldCatalog,
  normalizeShotFieldsRecord,
  STORYBOARD_PARSE_DEFAULT_PRESET_ID,
  STORYBOARD_OPTIMIZE_DEFAULT_PRESET_ID,
} from './storyboardTableParse';
import { normalizeStoryboardFrameHistory } from './storyboardFrameHistory';
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
  const shotFields = normalizeShotFieldsRecord(partial?.shotFields);
  return {
    id: partial?.id || rowId(),
    index,
    shotNo: partial?.shotNo ?? '',
    durationSec: partial?.durationSec ?? null,
    shotRaw: partial?.shotRaw,
    shotFields,
    shotText: partial?.shotText ?? '',
    frameImage: partial?.frameImage,
    frameImageObjectKey: partial?.frameImageObjectKey,
    frameImageCompanionKey: partial?.frameImageCompanionKey,
    frameImageHistory: partial?.frameImageHistory,
    locked: Boolean(partial?.locked),
    timelineLayer: normalizeTimelineLayer(partial?.timelineLayer ?? 0),
    editFeedback:
      typeof partial?.editFeedback === 'string' ? partial.editFeedback : undefined,
  };
}

export function reindexStoryboardRows(rows: StoryboardTableRow[]): StoryboardTableRow[] {
  return rows.map((r, i) => ({ ...r, index: i }));
}

function finalizeStoryboardRows(
  rows: StoryboardTableRow[],
  catalog: StoryboardParseFieldDef[]
): StoryboardTableRow[] {
  return rows.map((row) => applyShotFieldsPatch(row, catalog, row.shotFields));
}

/** 编辑态标题：保留用户输入的空字符串，不回落默认名 */
export function readStoryboardTableTitleRaw(
  asset: Pick<WorkflowAsset, 'textTitle' | 'storyboardTable'>
): string {
  if (typeof asset.textTitle === 'string') return asset.textTitle;
  if (typeof asset.storyboardTable?.title === 'string') return asset.storyboardTable.title;
  return '';
}

/** 展示/导出用标题：空白时回退「分镜表」 */
export function resolveStoryboardTableTitle(
  asset: Pick<WorkflowAsset, 'textTitle' | 'storyboardTable'>
): string {
  const raw = readStoryboardTableTitleRaw(asset).trim();
  return raw || '分镜表';
}

export function normalizeStoryboardTableDoc(raw: unknown): StoryboardTableDoc {
  if (!raw || typeof raw !== 'object') {
    const catalog: StoryboardParseFieldDef[] = [];
    return {
      fieldCatalog: catalog,
      rows: finalizeStoryboardRows([createStoryboardTableRow({}, 0)], catalog),
    };
  }
  const doc = raw as StoryboardTableDoc;
  const fieldCatalog = normalizeFieldCatalog(doc.fieldCatalog);
  const parsePresetId =
    typeof doc.parsePresetId === 'string' && doc.parsePresetId.trim()
      ? doc.parsePresetId.trim()
      : undefined;
  const optimizePresetId =
    typeof doc.optimizePresetId === 'string' && doc.optimizePresetId.trim()
      ? doc.optimizePresetId.trim()
      : undefined;
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
          let shotFields = normalizeShotFieldsRecord(row.shotFields);
          let shotRaw = typeof row.shotRaw === 'string' ? row.shotRaw : undefined;
          const legacyShotText = String(row.shotText ?? '').trim();
          if (!shotRaw && legacyShotText && Object.keys(shotFields).length === 0) {
            shotRaw = legacyShotText;
          }
          return createStoryboardTableRow(
            {
              id: String(row.id || '').trim() || rowId(),
              index: i,
              shotNo: String(row.shotNo ?? '').trim(),
              durationSec,
              shotRaw,
              shotFields,
              shotText: legacyShotText,
              frameImage: String(row.frameImage || '').trim() || undefined,
              frameImageObjectKey: String(row.frameImageObjectKey || '').trim() || undefined,
              frameImageCompanionKey: String(row.frameImageCompanionKey || '').trim() || undefined,
              frameImageHistory: normalizeStoryboardFrameHistory(row.frameImageHistory),
              locked: Boolean(row.locked),
              timelineLayer: normalizeTimelineLayer(row.timelineLayer ?? 0),
              editFeedback: typeof row.editFeedback === 'string' ? row.editFeedback : undefined,
            },
            i
          );
        })
      : [createStoryboardTableRow({}, 0)];
  const layerCount = resolveStoryboardTimelineLayerCount(parsed, doc.timelineLayerCount ?? 1);
  const rows = finalizeStoryboardRows(
    reindexStoryboardRows(
      parsed.map((r) => ({
        ...r,
        timelineLayer: clampStoryboardRowTimelineLayer(r.timelineLayer ?? 0, layerCount),
      }))
    ),
    fieldCatalog
  );
  const title =
    doc.title !== undefined && doc.title !== null ? String(doc.title) : undefined;
  return {
    ...(title !== undefined ? { title } : {}),
    timelineLayerCount: layerCount,
    fieldCatalog,
    ...(parsePresetId ? { parsePresetId } : {}),
    ...(optimizePresetId ? { optimizePresetId } : {}),
    rows,
  };
}

export function normalizeStoryboardTableOnAsset(asset: WorkflowAsset): WorkflowAsset {
  if (!isWorkflowStoryboardTableAsset(asset)) return asset;
  const table = normalizeStoryboardTableDoc(asset.storyboardTable);
  const titleRaw = readStoryboardTableTitleRaw(asset);
  const { isGroup: _ig, assetIds: _ai, cutImageGroup: _cig, parentAssetId: _pid, ...rest } = asset;
  return {
    ...rest,
    assetKind: 'storyboard_table',
    textTitle: titleRaw,
    original: '',
    displayKey: 'original',
    results: rest.results ?? {},
    storyboardTable: {
      ...table,
      title: titleRaw,
      parsePresetId: table.parsePresetId || STORYBOARD_PARSE_DEFAULT_PRESET_ID,
      optimizePresetId: table.optimizePresetId || STORYBOARD_OPTIMIZE_DEFAULT_PRESET_ID,
    },
  };
}

export function createEmptyStoryboardTableAsset(
  id: string,
  title?: string,
  parsePresetId: string = STORYBOARD_PARSE_DEFAULT_PRESET_ID
): WorkflowAsset {
  const label = title !== undefined ? title.trim() || '分镜表' : '分镜表';
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
      fieldCatalog: [],
      parsePresetId,
      optimizePresetId: STORYBOARD_OPTIMIZE_DEFAULT_PRESET_ID,
      rows: [createStoryboardTableRow({}, 0), createStoryboardTableRow({}, 1), createStoryboardTableRow({}, 2)],
    },
  });
}

export function storyboardTableOutlineLabel(a: WorkflowAsset): string {
  const t = resolveStoryboardTableTitle(a);
  const n = a.storyboardTable?.rows?.length ?? 0;
  return `${t} · ${n} 镜`;
}

export function storyboardTableCoverImage(a: WorkflowAsset): string {
  const rows = a.storyboardTable?.rows ?? [];
  for (const r of rows) {
    const img = resolveStoryboardRowFrameDisplaySrc(r);
    if (img) return img;
  }
  return '';
}

/** 前 n 个有图镜头的缩略图（表卡胶片条） */
export function storyboardTablePreviewImages(a: WorkflowAsset, limit = 4): string[] {
  const rows = a.storyboardTable?.rows ?? [];
  const out: string[] = [];
  for (const r of rows) {
    const img = resolveStoryboardRowFrameDisplaySrc(r);
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
    if (storyboardRowHasFrameRef(r)) withImageCount += 1;
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
      shotRaw: source.shotRaw,
      shotFields: { ...source.shotFields },
      shotText: source.shotText,
      frameImage: source.frameImage,
      frameImageObjectKey: source.frameImageObjectKey,
      frameImageCompanionKey: source.frameImageCompanionKey,
      locked: false,
      timelineLayer: source.timelineLayer ?? 0,
    },
    index
  );
}

/** 复制分镜表资产：新资产 id + 各行新 row id，避免与源表冲突 */
export function duplicateStoryboardTableOnAsset(asset: WorkflowAsset, newAssetId: string): WorkflowAsset {
  if (!isWorkflowStoryboardTableAsset(asset)) return asset;
  const table = asset.storyboardTable;
  const rows = (table?.rows ?? []).map((r, i) => duplicateStoryboardRow(r, i));
  const {
    isGroup: _ig,
    assetIds: _ai,
    cutImageGroup: _cig,
    parentAssetId: _pid,
    modelCompanionKeys: _mck,
    ...rest
  } = asset;
  return normalizeStoryboardTableOnAsset({
    ...rest,
    id: newAssetId,
    modelCompanionKeys: undefined,
    archived: false,
    hiddenInGrid: false,
    createdAt: Date.now(),
    storyboardTable: {
      ...table,
      fieldCatalog: table?.fieldCatalog ? [...table.fieldCatalog] : [],
      rows,
    },
  });
}

/** 仅为空镜头号填 01、02… */
export function applyAutoShotNumbers(rows: StoryboardTableRow[]): StoryboardTableRow[] {
  return rows.map((r, i) => ({
    ...r,
    shotNo: (r.shotNo || '').trim() || formatStoryboardShotNo(i),
  }));
}
