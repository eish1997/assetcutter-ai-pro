import type {
  StoryboardFrameImageVersion,
  StoryboardFrameVersionSource,
  StoryboardGeneratedImageRecord,
  StoryboardTableRow,
} from '../types';
import { storyboardRowOutlineTitle } from '../components/storyboard/storyboardRowDisplay';
import {
  resolveStoryboardFrameVersionDisplaySrc,
  storyboardFrameRefsEqual,
} from './storyboardFrameHistory';

const GENERATED_SOURCES = new Set<StoryboardFrameVersionSource>(['redraw', 'sheet_split']);
export const STORYBOARD_GENERATED_IMAGE_HISTORY_LIMIT = 240;

export type StoryboardGeneratedAssetItem = {
  id: string;
  rowId: string;
  shotLabel: string;
  rowIndex: number;
  createdAt: number;
  source: StoryboardFrameVersionSource;
  displaySrc: string;
  versionId?: string;
  isCurrent: boolean;
};

function frameAssetRefKey(
  ref: Pick<
    StoryboardTableRow | StoryboardFrameImageVersion | StoryboardGeneratedImageRecord,
    'frameImage' | 'frameImageObjectKey' | 'frameImageCompanionKey'
  >
): string {
  const companion = String(ref.frameImageCompanionKey || '').trim();
  const objectKey = String(ref.frameImageObjectKey || '').trim();
  const inline = String(ref.frameImage || '').trim();
  if (companion) return `c:${companion}`;
  if (objectKey) return `o:${objectKey}`;
  if (inline) return `i:${inline.slice(0, 96)}`;
  return '';
}

function recordHasImageRef(record: StoryboardGeneratedImageRecord): boolean {
  return Boolean(frameAssetRefKey(record));
}

export function normalizeStoryboardGeneratedImageHistory(raw: unknown): StoryboardGeneratedImageRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryboardGeneratedImageRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Partial<StoryboardGeneratedImageRecord>;
    const id = String(row.id || '').trim();
    const rowId = String(row.rowId || '').trim();
    if (!id || !rowId) continue;
    const source = row.source;
    if (source !== 'redraw' && source !== 'sheet_split') continue;
    const record: StoryboardGeneratedImageRecord = {
      id,
      rowId,
      shotNo: String(row.shotNo || '').trim() || undefined,
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
      source,
      frameImage: String(row.frameImage || '').trim() || undefined,
      frameImageObjectKey: String(row.frameImageObjectKey || '').trim() || undefined,
      frameImageCompanionKey: String(row.frameImageCompanionKey || '').trim() || undefined,
    };
    if (!recordHasImageRef(record)) continue;
    out.push(record);
  }
  return out.slice(0, STORYBOARD_GENERATED_IMAGE_HISTORY_LIMIT);
}

function recordFromVersion(
  row: StoryboardTableRow,
  version: StoryboardFrameImageVersion,
  patch?: Partial<StoryboardTableRow>
): StoryboardGeneratedImageRecord | null {
  if (!GENERATED_SOURCES.has(version.source)) return null;
  const record: StoryboardGeneratedImageRecord = {
    id: version.id,
    rowId: row.id,
    shotNo: row.shotNo?.trim() || undefined,
    createdAt: version.createdAt,
    source: version.source,
    frameImage: String(patch?.frameImage ?? version.frameImage ?? '').trim() || undefined,
    frameImageObjectKey:
      String(patch?.frameImageObjectKey ?? version.frameImageObjectKey ?? '').trim() || undefined,
    frameImageCompanionKey:
      String(patch?.frameImageCompanionKey ?? version.frameImageCompanionKey ?? '').trim() ||
      undefined,
  };
  return recordHasImageRef(record) ? record : null;
}

/** 从镜头行 history 回填尚未入库的生图记录 */
export function backfillStoryboardGeneratedImageHistory(
  persisted: StoryboardGeneratedImageRecord[] | undefined,
  rows: StoryboardTableRow[]
): StoryboardGeneratedImageRecord[] {
  const seen = new Set((persisted ?? []).map((item) => frameAssetRefKey(item)).filter(Boolean));
  let next = [...(persisted ?? [])];
  rows.forEach((row) => {
    for (const version of row.frameImageHistory ?? []) {
      if (!GENERATED_SOURCES.has(version.source)) continue;
      const record = recordFromVersion(row, version);
      if (!record) continue;
      const key = frameAssetRefKey(record);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      next.push(record);
    }
  });
  next.sort((a, b) => b.createdAt - a.createdAt);
  return next.slice(0, STORYBOARD_GENERATED_IMAGE_HISTORY_LIMIT);
}

export function appendStoryboardGeneratedImageHistory(
  history: StoryboardGeneratedImageRecord[] | undefined,
  record: StoryboardGeneratedImageRecord
): StoryboardGeneratedImageRecord[] {
  const key = frameAssetRefKey(record);
  const filtered = (history ?? []).filter((item) => frameAssetRefKey(item) !== key);
  return [record, ...filtered].slice(0, STORYBOARD_GENERATED_IMAGE_HISTORY_LIMIT);
}

export function appendStoryboardGeneratedImageHistoryBatch(
  history: StoryboardGeneratedImageRecord[] | undefined,
  records: StoryboardGeneratedImageRecord[]
): StoryboardGeneratedImageRecord[] {
  let next = history ?? [];
  for (const record of records) {
    next = appendStoryboardGeneratedImageHistory(next, record);
  }
  return next;
}

export function extractStoryboardGeneratedImageRecord(
  row: StoryboardTableRow,
  patch: Partial<StoryboardTableRow>
): StoryboardGeneratedImageRecord | null {
  const version = patch.frameImageHistory?.[0];
  if (version) return recordFromVersion(row, version, patch);
  if (!patch.frameImage && !patch.frameImageObjectKey && !patch.frameImageCompanionKey) return null;
  return null;
}

export function collectStoryboardGeneratedImageRecordsFromPatches(
  rows: StoryboardTableRow[],
  patches: Map<string, Partial<StoryboardTableRow>>
): StoryboardGeneratedImageRecord[] {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const out: StoryboardGeneratedImageRecord[] = [];
  for (const [rowId, patch] of patches) {
    const row = rowById.get(rowId);
    if (!row) continue;
    const record = extractStoryboardGeneratedImageRecord(row, patch);
    if (record) out.push(record);
  }
  return out;
}

function resolveGeneratedAssetDisplaySrc(
  record: StoryboardGeneratedImageRecord,
  row?: StoryboardTableRow
): string {
  const fromRecord =
    resolveStoryboardFrameVersionDisplaySrc(record) ||
    String(record.frameImage || '').trim();
  if (fromRecord) return fromRecord;
  if (!row?.frameImageHistory?.length) return '';
  const version = row.frameImageHistory.find((item) => item.id === record.id);
  if (!version) return '';
  return resolveStoryboardFrameVersionDisplaySrc(version);
}

/** UI 列表：持久化历史 + 当前镜头行，按 createdAt 新→旧 */
export function listStoryboardGeneratedImageAssets(
  rows: StoryboardTableRow[],
  persistedHistory?: StoryboardGeneratedImageRecord[]
): StoryboardGeneratedAssetItem[] {
  const history = backfillStoryboardGeneratedImageHistory(persistedHistory, rows);
  const rowById = new Map(rows.map((row, index) => [row.id, { row, index }]));
  const items: StoryboardGeneratedAssetItem[] = [];

  for (const record of history) {
    const rowMeta = rowById.get(record.rowId);
    const row = rowMeta?.row;
    const rowIndex = rowMeta?.index ?? -1;
    const shotLabel =
      record.shotNo?.trim() ||
      (row != null ? storyboardRowOutlineTitle(row, Math.max(rowIndex, 0)) : record.rowId);
    const displaySrc = resolveGeneratedAssetDisplaySrc(record, row);
    const pendingCompanionHydrate =
      !displaySrc && Boolean(String(record.frameImageCompanionKey || '').trim());
    if (!displaySrc && !pendingCompanionHydrate) continue;
    items.push({
      id: record.id,
      rowId: record.rowId,
      shotLabel,
      rowIndex: Math.max(rowIndex, 0),
      createdAt: record.createdAt,
      source: record.source,
      displaySrc,
      versionId: record.id,
      isCurrent: row ? storyboardFrameRefsEqual(row, record) : false,
    });
  }

  return items.sort((a, b) => b.createdAt - a.createdAt || b.rowIndex - a.rowIndex);
}

/** @deprecated use listStoryboardGeneratedImageAssets */
export function collectStoryboardGeneratedAssets(
  rows: StoryboardTableRow[]
): StoryboardGeneratedAssetItem[] {
  return listStoryboardGeneratedImageAssets(rows);
}
