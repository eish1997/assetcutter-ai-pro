import { readLocalJson, scopedStorageKey, writeLocalStringOrThrow } from './clientPersist';
import { fetchCompanionAssetBlob, putCompanionAsset } from './companionClient/storage';
import {
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  putWorkflowResultImageToCompanion,
  imageSrcToDataUrlForCompanion,
  workflowResultCompanionStorageKey,
} from './workflowCompanionAssets';
import { deleteCompanionAsset } from './companionClient/storage';
import {
  deleteStoryboardSheetPreviewBlob,
  loadStoryboardSheetPreviewBlob,
  loadStoryboardSheetPreviewBlobAsObjectUrl,
  saveStoryboardSheetPreviewBlob,
  storyboardSheetPreviewBlobIdbKey,
} from './storyboardSheetPreviewBlobIdb';
import type { StoryboardTableRow } from '../types';
import { createStoryboardTableRow } from './storyboardTableAsset';
import type { StoryboardSheetPreviewImageVersion } from './storyboardSheetPreviewHistory';
import { cleanupSheetPreviewHistoryAssets, normalizeSheetPreviewImageHistory } from './storyboardSheetPreviewHistory';
import { storyboardShotNosMatch } from './storyboardSheetVisionSplit';
import {
  STORYBOARD_NUMERIC_SHOT_NO_WIDTH,
  formatStoryboardNumericShotNo,
  normalizeStoryboardShotNoInput,
} from './storyboardTableParse';

export const STORYBOARD_SHEET_PREVIEW_KEY = 'ac_storyboard_sheet_preview_v1';
export const STORYBOARD_SHEET_PREVIEW_LIST_COMPANION_RESULT_KEY = 'sheet-previews-index';
/** 仅存元数据；大图走伴侣盘或 IndexedDB */
export const STORYBOARD_SHEET_PREVIEW_LIMIT = 256;

export type StoryboardSheetPreviewGenStatus =
  | 'pending'
  | 'generating'
  | 'done'
  | 'failed'
  | 'cancelled';

export type StoryboardSheetPreviewItem = {
  id: string;
  imageDataUrl: string;
  imageCompanionKey?: string;
  imageIdbKey?: string;
  createdAt: number;
  label: string;
  source: 'generated' | 'uploaded';
  rowIds: string[];
  shotNos: string[];
  matchedCount: number;
  /** 批量生图任务序号（0-based），仅 generated 占位/任务项使用 */
  chunkIndex?: number;
  genStatus?: StoryboardSheetPreviewGenStatus;
  genError?: string;
  /** 历史版本（不含当前显示图）；当前显示始终为顶层 image* 字段 */
  imageHistory?: StoryboardSheetPreviewImageVersion[];
};

export type StoryboardSheetPreviewPersistImageKind = 'companion' | 'idb' | 'inline' | 'memory';

export type StoryboardSheetPreviewSaveResult = {
  preview: StoryboardSheetPreviewItem;
  persistedMetadata: boolean;
  persistedImage: StoryboardSheetPreviewPersistImageKind;
};

type StoryboardSheetPreviewStorageItem = Omit<StoryboardSheetPreviewItem, 'imageDataUrl'> & {
  imageDataUrl?: string;
};

function previewStorageKey(assetId: string): string {
  return scopedStorageKey(`${STORYBOARD_SHEET_PREVIEW_KEY}__${assetId}`, null);
}

export function storyboardSheetPreviewCompanionResultKey(previewId: string): string {
  return `storyboard-sheet-preview-${previewId}`;
}

function normalizePreviewItem(raw: unknown): StoryboardSheetPreviewItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<StoryboardSheetPreviewItem>;
  if (typeof item.id !== 'string' || !item.id.trim()) return null;
  const imageDataUrl = typeof item.imageDataUrl === 'string' ? item.imageDataUrl : '';
  const imageCompanionKey =
    typeof item.imageCompanionKey === 'string' ? item.imageCompanionKey.trim() : '';
  const imageIdbKey = typeof item.imageIdbKey === 'string' ? item.imageIdbKey.trim() : '';
  if (!imageDataUrl.trim() && !imageCompanionKey && !imageIdbKey) return null;
  return {
    id: item.id,
    imageDataUrl,
    imageCompanionKey: imageCompanionKey || undefined,
    imageIdbKey: imageIdbKey || undefined,
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
    label: typeof item.label === 'string' ? item.label : '拼图',
    source: item.source === 'uploaded' ? 'uploaded' : 'generated',
    rowIds: Array.isArray(item.rowIds) ? item.rowIds.filter((id): id is string => typeof id === 'string') : [],
    shotNos: Array.isArray(item.shotNos) ? item.shotNos.filter((shot): shot is string => typeof shot === 'string') : [],
    matchedCount: typeof item.matchedCount === 'number' ? item.matchedCount : 0,
    chunkIndex: typeof item.chunkIndex === 'number' ? item.chunkIndex : undefined,
    genStatus:
      item.genStatus === 'pending' ||
      item.genStatus === 'generating' ||
      item.genStatus === 'done' ||
      item.genStatus === 'failed' ||
      item.genStatus === 'cancelled'
        ? item.genStatus
        : undefined,
    genError: typeof item.genError === 'string' ? item.genError : undefined,
    imageHistory: normalizeSheetPreviewImageHistory(item.imageHistory),
  };
}

function hasSheetPreviewDisplayImage(item: StoryboardSheetPreviewItem): boolean {
  return Boolean(
    String(item.imageDataUrl || '').trim() || item.imageCompanionKey || item.imageIdbKey
  );
}

function sheetPreviewGenStatusRank(
  status: StoryboardSheetPreviewGenStatus | undefined,
  item?: StoryboardSheetPreviewItem
): number {
  switch (status) {
    case 'done':
      return 50;
    case 'failed':
      return 40;
    case 'generating':
      return 35;
    case 'pending':
      return 20;
    case 'cancelled':
      return 10;
    default:
      if (item && hasSheetPreviewDisplayImage(item)) {
        return String(item.imageDataUrl || '').trim() ? 45 : 25;
      }
      return 0;
  }
}

export function pickRicherStoryboardSheetPreviewItem(
  prev: StoryboardSheetPreviewItem,
  next: StoryboardSheetPreviewItem
): StoryboardSheetPreviewItem {
  const prevImg = String(prev.imageDataUrl || '').trim();
  const nextImg = String(next.imageDataUrl || '').trim();
  const prevRank = sheetPreviewGenStatusRank(prev.genStatus, prev);
  const nextRank = sheetPreviewGenStatusRank(next.genStatus, next);

  let base = next.createdAt >= prev.createdAt ? { ...prev, ...next } : { ...next, ...prev };
  if (prevImg && !nextImg) base = { ...base, imageDataUrl: prevImg };
  else if (nextImg) base = { ...base, imageDataUrl: nextImg };

  if (prevRank > nextRank) {
    base = { ...base, genStatus: prev.genStatus, genError: prev.genError ?? base.genError };
  }
  const prevHistory = prev.imageHistory || [];
  const nextHistory = next.imageHistory || [];
  if (prevHistory.length || nextHistory.length) {
    const byId = new Map<string, StoryboardSheetPreviewImageVersion>();
    for (const ver of [...prevHistory, ...nextHistory]) {
      byId.set(ver.id, ver);
    }
    base = {
      ...base,
      imageHistory: [...byId.values()].sort((a, b) => b.createdAt - a.createdAt),
    };
  }
  return base;
}

function shouldPersistStoryboardSheetPreviewItem(item: StoryboardSheetPreviewItem): boolean {
  const status = item.genStatus;
  if (status === 'pending' || status === 'generating' || status === 'cancelled') return false;
  return hasSheetPreviewDisplayImage(item);
}

export function persistStoryboardSheetPreviewList(
  assetId: string,
  items: StoryboardSheetPreviewItem[]
): boolean {
  return writeStoryboardSheetPreviews(assetId, items);
}

function toStorageItems(items: StoryboardSheetPreviewItem[]): StoryboardSheetPreviewStorageItem[] {
  return items.map((item) => {
    const companionKey = String(item.imageCompanionKey || '').trim();
    const idbKey = String(item.imageIdbKey || '').trim();
    if (companionKey || idbKey) {
      const { imageDataUrl: _drop, ...rest } = item;
      return {
        ...rest,
        imageCompanionKey: companionKey || undefined,
        imageIdbKey: idbKey || undefined,
      };
    }
    return { ...item };
  });
}

export function storyboardSheetPreviewListCompanionKey(assetId: string): string {
  return workflowResultCompanionStorageKey(
    assetId,
    STORYBOARD_SHEET_PREVIEW_LIST_COMPANION_RESULT_KEY
  );
}

function normalizeStoredSheetPreviewList(raw: unknown): StoryboardSheetPreviewItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizePreviewItem(item))
    .filter((item): item is StoryboardSheetPreviewItem => item != null)
    .slice(0, STORYBOARD_SHEET_PREVIEW_LIMIT);
}

export async function readStoryboardSheetPreviewsFromCompanion(
  assetId: string,
  companionBaseUrl: string,
  companionProjectId: string
): Promise<StoryboardSheetPreviewItem[] | null> {
  const base = String(companionBaseUrl || '').trim();
  const pid = String(companionProjectId || '').trim();
  if (!base || !pid) return null;

  const key = storyboardSheetPreviewListCompanionKey(assetId);
  const res = await fetchCompanionAssetBlob(base, pid, key);
  if (!res.ok) {
    if (res.status === 404) return [];
    return null;
  }

  try {
    const text = new TextDecoder().decode(res.data);
    const parsed = JSON.parse(text) as unknown;
    return normalizeStoredSheetPreviewList(parsed);
  } catch {
    return null;
  }
}

export async function writeStoryboardSheetPreviewsToCompanion(
  assetId: string,
  items: StoryboardSheetPreviewItem[],
  companionBaseUrl: string,
  companionProjectId: string
): Promise<boolean> {
  const base = String(companionBaseUrl || '').trim();
  const pid = String(companionProjectId || '').trim();
  if (!base || !pid) return false;

  const next = toStorageItems(
    items.filter((item) => shouldPersistStoryboardSheetPreviewItem(item)).slice(0, STORYBOARD_SHEET_PREVIEW_LIMIT)
  );
  const key = storyboardSheetPreviewListCompanionKey(assetId);
  const body = new Blob([JSON.stringify(next)], { type: 'application/json; charset=utf-8' });
  const res = await putCompanionAsset(base, pid, key, body, 'application/json; charset=utf-8');
  return res.ok !== false;
}

export function mergeStoryboardSheetPreviews(
  ...lists: StoryboardSheetPreviewItem[][]
): StoryboardSheetPreviewItem[] {
  const byId = new Map<string, StoryboardSheetPreviewItem>();
  for (const list of lists) {
    for (const item of list) {
      const prev = byId.get(item.id);
      byId.set(item.id, prev ? pickRicherStoryboardSheetPreviewItem(prev, item) : item);
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, STORYBOARD_SHEET_PREVIEW_LIMIT);
}

export function readStoryboardSheetPreviews(assetId: string): StoryboardSheetPreviewItem[] {
  const items = readLocalJson(previewStorageKey(assetId), [] as StoryboardSheetPreviewStorageItem[], (parsed) => {
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((item) => normalizePreviewItem(item))
      .filter((item): item is StoryboardSheetPreviewItem => item != null);
  });
  return items.slice(0, STORYBOARD_SHEET_PREVIEW_LIMIT);
}

export function writeStoryboardSheetPreviews(assetId: string, items: StoryboardSheetPreviewItem[]): boolean {
  const next = items
    .filter((item) => shouldPersistStoryboardSheetPreviewItem(item))
    .slice(0, STORYBOARD_SHEET_PREVIEW_LIMIT);
  try {
    writeLocalStringOrThrow(previewStorageKey(assetId), JSON.stringify(toStorageItems(next)));
    return true;
  } catch {
    return false;
  }
}

export function prependStoryboardSheetPreview(
  assetId: string,
  item: StoryboardSheetPreviewItem,
  currentItems?: StoryboardSheetPreviewItem[]
): { items: StoryboardSheetPreviewItem[]; persisted: boolean } {
  const base = currentItems ?? readStoryboardSheetPreviews(assetId);
  const next = mergeStoryboardSheetPreviews([item], base);
  const persisted = writeStoryboardSheetPreviews(assetId, next);
  return { items: next, persisted };
}

export function updateStoryboardSheetPreview(
  assetId: string,
  previewId: string,
  patch: Partial<StoryboardSheetPreviewItem>,
  currentItems?: StoryboardSheetPreviewItem[]
): { items: StoryboardSheetPreviewItem[]; persisted: boolean } {
  const base = currentItems ?? readStoryboardSheetPreviews(assetId);
  const next = base.map((item) => (item.id === previewId ? { ...item, ...patch } : item));
  const persisted = writeStoryboardSheetPreviews(assetId, next);
  return { items: next, persisted };
}

export function upsertStoryboardSheetPreview(
  assetId: string,
  item: StoryboardSheetPreviewItem,
  currentItems?: StoryboardSheetPreviewItem[]
): { items: StoryboardSheetPreviewItem[]; persisted: boolean } {
  const base = currentItems ?? readStoryboardSheetPreviews(assetId);
  const next = mergeStoryboardSheetPreviews([item], base);
  const persisted = writeStoryboardSheetPreviews(assetId, next);
  return { items: next, persisted };
}

export function removeStoryboardSheetPreview(
  assetId: string,
  previewId: string,
  currentItems?: StoryboardSheetPreviewItem[]
): { items: StoryboardSheetPreviewItem[]; persisted: boolean; removed: StoryboardSheetPreviewItem | null } {
  const base = currentItems ?? readStoryboardSheetPreviews(assetId);
  const removed = base.find((item) => item.id === previewId) ?? null;
  const next = base.filter((item) => item.id !== previewId);
  const persisted = writeStoryboardSheetPreviews(assetId, next);
  return { items: next, persisted, removed };
}

export async function cleanupStoryboardSheetPreviewAssets(opts: {
  assetId: string;
  preview: StoryboardSheetPreviewItem;
  companionBaseUrl: string;
  companionProjectId: string;
}): Promise<void> {
  const imageDataUrl = String(opts.preview.imageDataUrl || '').trim();
  if (imageDataUrl.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(imageDataUrl);
    } catch {
      /* ignore */
    }
  }

  await deleteStoryboardSheetPreviewBlob(opts.assetId, opts.preview.id);

  await cleanupSheetPreviewHistoryAssets(opts.preview.id, opts.preview.imageHistory, {
    assetId: opts.assetId,
    companionBaseUrl: opts.companionBaseUrl,
    companionProjectId: opts.companionProjectId,
  });

  const companionKey = String(opts.preview.imageCompanionKey || '').trim();
  const base = String(opts.companionBaseUrl || '').trim();
  const pid = String(opts.companionProjectId || '').trim();
  if (companionKey && base && pid) {
    try {
      await deleteCompanionAsset(base, pid, companionKey);
    } catch {
      /* best effort */
    }
  }
}

export async function persistStoryboardSheetPreviewImageToCompanion(opts: {
  assetId: string;
  previewId: string;
  imageDataUrl: string;
  companionBaseUrl: string;
  companionProjectId: string;
}): Promise<{ ok: true; companionKey: string } | { ok: false }> {
  const base = String(opts.companionBaseUrl || '').trim();
  const pid = String(opts.companionProjectId || '').trim();
  if (!base || !pid) return { ok: false };

  const put = await putWorkflowResultImageToCompanion(
    base,
    pid,
    opts.assetId,
    storyboardSheetPreviewCompanionResultKey(opts.previewId),
    opts.imageDataUrl
  );
  if (!put.ok) return { ok: false };
  return { ok: true, companionKey: put.key };
}

async function hydrateFromIdb(
  item: StoryboardSheetPreviewItem,
  assetId: string
): Promise<StoryboardSheetPreviewItem> {
  const idbKey = String(item.imageIdbKey || '').trim();
  if (!idbKey) {
    const fallbackKey = storyboardSheetPreviewBlobIdbKey(assetId, item.id);
    const objectUrl = await loadStoryboardSheetPreviewBlobAsObjectUrl(assetId, item.id);
    if (!objectUrl) return item;
    return { ...item, imageDataUrl: objectUrl, imageIdbKey: fallbackKey };
  }
  const previewId = idbKey.split('::').pop() || item.id;
  const objectUrl = await loadStoryboardSheetPreviewBlobAsObjectUrl(assetId, previewId);
  if (!objectUrl) return item;
  return { ...item, imageDataUrl: objectUrl };
}

export async function hydrateStoryboardSheetPreviewItem(
  item: StoryboardSheetPreviewItem,
  assetId: string,
  companionBaseUrl: string,
  companionProjectId: string
): Promise<StoryboardSheetPreviewItem> {
  if (String(item.imageDataUrl || '').trim()) return item;

  const companionKey = String(item.imageCompanionKey || '').trim();
  const base = String(companionBaseUrl || '').trim();
  const pid = String(companionProjectId || '').trim();
  if (companionKey && base && pid) {
    const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, companionKey);
    if (got.ok) {
      return { ...item, imageDataUrl: got.objectUrl };
    }
  }

  return hydrateFromIdb(item, assetId);
}

export async function hydrateStoryboardSheetPreviews(
  items: StoryboardSheetPreviewItem[],
  assetId: string,
  companionBaseUrl: string,
  companionProjectId: string
): Promise<StoryboardSheetPreviewItem[]> {
  return Promise.all(
    items.map((item) =>
      hydrateStoryboardSheetPreviewItem(item, assetId, companionBaseUrl, companionProjectId)
    )
  );
}

export async function resolveStoryboardSheetPreviewDataUrl(
  item: StoryboardSheetPreviewItem,
  assetId: string,
  companionBaseUrl: string,
  companionProjectId: string
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  const direct = String(item.imageDataUrl || '').trim();
  if (direct) {
    const normalized = await imageSrcToDataUrlForCompanion(direct);
    if (normalized) return { ok: true, dataUrl: normalized };
  }

  const companionKey = String(item.imageCompanionKey || '').trim();
  const base = String(companionBaseUrl || '').trim();
  const pid = String(companionProjectId || '').trim();
  if (companionKey && base && pid) {
    const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, companionKey);
    if (got.ok) {
      try {
        const normalized = await imageSrcToDataUrlForCompanion(got.objectUrl);
        URL.revokeObjectURL(got.objectUrl);
        if (normalized) return { ok: true, dataUrl: normalized };
      } catch {
        URL.revokeObjectURL(got.objectUrl);
      }
    }
  }

  const blob = await loadStoryboardSheetPreviewBlob(
    assetId,
    item.id
  ).catch(() => null);
  if (blob) {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const normalized = await imageSrcToDataUrlForCompanion(objectUrl);
      URL.revokeObjectURL(objectUrl);
      if (normalized) return { ok: true, dataUrl: normalized };
    } catch {
      URL.revokeObjectURL(objectUrl);
    }
  }

  return { ok: false, error: '拼图图片不可用，请重新生成或上传' };
}

export function resolveSheetTaskRows(
  tableRows: StoryboardTableRow[],
  rowIds: string[],
  shotNos: string[]
): StoryboardTableRow[] {
  const normalizedShots = shotNos.map((shot) => shot.trim()).filter(Boolean);

  const resolveOrderedByShots = (): StoryboardTableRow[] => {
    const ordered: StoryboardTableRow[] = [];
    const usedIds = new Set<string>();
    for (const shot of normalizedShots) {
      const row =
        tableRows.find((item) => {
          if (usedIds.has(item.id)) return false;
          const rowShot = item.shotNo?.trim() || '';
          if (!rowShot) return false;
          return storyboardShotNosMatch(shot, rowShot);
        }) ?? null;
      if (!row) continue;
      usedIds.add(row.id);
      ordered.push(row);
    }
    return ordered;
  };

  if (normalizedShots.length) {
    const byShots = resolveOrderedByShots();
    if (byShots.length) return byShots;
  }

  const byId = tableRows.filter((row) => rowIds.includes(row.id));
  if (byId.length > 0) return byId;

  if (!normalizedShots.length) return [];

  return tableRows.filter((row) => {
    const shotNo = row.shotNo?.trim();
    if (!shotNo) return false;
    return normalizedShots.some((shot) => storyboardShotNosMatch(shot, shotNo));
  });
}

const SHEET_PREVIEW_SHOT_RANGE_MAX = 200;

export function expandStoryboardShotNoRange(fromRaw: string, toRaw: string): string[] {
  const from = String(fromRaw || '').trim();
  const to = String(toRaw || '').trim();
  if (!from || !to) return [];
  if (from === to) return [normalizeStoryboardShotNoInput(from)];

  const fromMatch = from.match(/^(\D*)(\d+)$/);
  const toMatch = to.match(/^(\D*)(\d+)$/);
  if (!fromMatch || !toMatch || fromMatch[1] !== toMatch[1]) {
    return [...new Set([normalizeStoryboardShotNoInput(from), normalizeStoryboardShotNoInput(to)])];
  }

  const prefix = fromMatch[1] ?? '';
  const start = Number.parseInt(fromMatch[2] ?? '', 10);
  const end = Number.parseInt(toMatch[2] ?? '', 10);
  const pad = prefix
    ? (fromMatch[2] ?? '').length
    : Math.max(STORYBOARD_NUMERIC_SHOT_NO_WIDTH, (fromMatch[2] ?? '').length);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];

  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  if (hi - lo + 1 > SHEET_PREVIEW_SHOT_RANGE_MAX) return [];

  const result: string[] = [];
  for (let n = lo; n <= hi; n += 1) {
    const token = prefix ? `${prefix}${String(n).padStart(pad, '0')}` : formatStoryboardNumericShotNo(String(n));
    result.push(token);
  }
  return result;
}

export function parseSheetPreviewShotRange(
  fromRaw: string,
  toRaw: string
): { ok: true; shotNos: string[] } | { ok: false; error: string } {
  const shotNos = expandStoryboardShotNoRange(fromRaw, toRaw);
  if (!shotNos.length) {
    return { ok: false, error: '请填写有效的镜号范围（如 01 到 06）' };
  }
  if (shotNos.length > SHEET_PREVIEW_SHOT_RANGE_MAX) {
    return { ok: false, error: `镜号范围不能超过 ${SHEET_PREVIEW_SHOT_RANGE_MAX} 镜` };
  }
  return { ok: true, shotNos };
}

export function formatSheetPreviewShotLabel(shotNos: string[]): string {
  const shots = shotNos.map((shot) => shot.trim()).filter(Boolean);
  if (!shots.length) return '';
  if (shots.length === 1) return shots[0]!;

  const expanded = expandStoryboardShotNoRange(shots[0]!, shots[shots.length - 1]!);
  if (expanded.length === shots.length && expanded.every((shot, index) => shot === shots[index])) {
    return `${shots[0]}–${shots[shots.length - 1]}`;
  }
  if (shots.length <= 4) return shots.join('、');
  return `${shots[0]}–${shots[shots.length - 1]}（${shots.length}镜）`;
}

export function buildSheetPreviewLabel(base: string, shotNos: string[]): string {
  const shotLabel = formatSheetPreviewShotLabel(shotNos);
  return shotLabel ? `${base} · ${shotLabel}` : base;
}

export function ensureStoryboardRowsForShotNos(
  tableRows: StoryboardTableRow[],
  shotNos: string[]
): { rows: StoryboardTableRow[]; nextTableRows: StoryboardTableRow[]; createdIds: string[] } {
  const next = [...tableRows];
  const rows: StoryboardTableRow[] = [];
  const createdIds: string[] = [];
  const usedIds = new Set<string>();

  for (const shot of shotNos.map((item) => item.trim()).filter(Boolean)) {
    let row =
      next.find((item) => {
        const rowShot = item.shotNo?.trim() || '';
        if (!rowShot) return false;
        return storyboardShotNosMatch(shot, rowShot);
      }) ?? null;

    if (!row) {
      row = createStoryboardTableRow({ shotNo: shot }, next.length);
      next.push(row);
      createdIds.push(row.id);
    }

    if (!usedIds.has(row.id)) {
      usedIds.add(row.id);
      rows.push(row);
    }
  }

  return { rows, nextTableRows: next, createdIds };
}

export function createSheetPreviewItem(
  partial: Omit<StoryboardSheetPreviewItem, 'id' | 'createdAt' | 'matchedCount'> & {
    matchedCount?: number;
  }
): StoryboardSheetPreviewItem {
  const { matchedCount, ...rest } = partial;
  return {
    ...rest,
    id: `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    matchedCount: matchedCount ?? 0,
  };
}

export function isStoryboardSheetPreviewSplittable(item: StoryboardSheetPreviewItem): boolean {
  if (
    item.genStatus === 'pending' ||
    item.genStatus === 'generating' ||
    item.genStatus === 'cancelled' ||
    item.genStatus === 'failed'
  ) {
    return false;
  }
  if (!hasSheetPreviewDisplayImage(item)) return false;
  const shotTotal = item.shotNos.length || item.rowIds.length;
  if (!shotTotal) return false;
  return true;
}

export function listSplittableStoryboardSheetPreviews(
  items: StoryboardSheetPreviewItem[]
): StoryboardSheetPreviewItem[] {
  return items.filter(isStoryboardSheetPreviewSplittable);
}

export async function prepareStoryboardSheetPreviewForSave(opts: {
  assetId: string;
  preview: StoryboardSheetPreviewItem;
  companionBaseUrl: string;
  companionProjectId: string;
}): Promise<StoryboardSheetPreviewSaveResult> {
  const sourceDataUrl = opts.preview.imageDataUrl;
  let preview: StoryboardSheetPreviewItem = { ...opts.preview };

  const companion = await persistStoryboardSheetPreviewImageToCompanion({
    assetId: opts.assetId,
    previewId: preview.id,
    imageDataUrl: sourceDataUrl,
    companionBaseUrl: opts.companionBaseUrl,
    companionProjectId: opts.companionProjectId,
  });

  if (companion.ok) {
    preview = {
      ...preview,
      imageCompanionKey: companion.companionKey,
      imageIdbKey: undefined,
    };
    const hydrated = await hydrateStoryboardSheetPreviewItem(
      preview,
      opts.assetId,
      opts.companionBaseUrl,
      opts.companionProjectId
    );
    preview = {
      ...hydrated,
      imageDataUrl: String(hydrated.imageDataUrl || '').trim() || sourceDataUrl,
      genStatus:
        preview.genStatus === 'generating' || preview.genStatus === 'pending'
          ? 'done'
          : preview.genStatus,
    };
    return { preview, persistedMetadata: true, persistedImage: 'companion' };
  }

  const idbKey = storyboardSheetPreviewBlobIdbKey(opts.assetId, preview.id);
  const idbOk = await saveStoryboardSheetPreviewBlob(opts.assetId, preview.id, sourceDataUrl);
  if (idbOk) {
    const objectUrl = await loadStoryboardSheetPreviewBlobAsObjectUrl(opts.assetId, preview.id);
    preview = {
      ...preview,
      imageIdbKey: idbKey,
      imageCompanionKey: undefined,
      imageDataUrl: objectUrl || sourceDataUrl,
      genStatus:
        preview.genStatus === 'generating' || preview.genStatus === 'pending'
          ? 'done'
          : preview.genStatus,
    };
    return { preview, persistedMetadata: true, persistedImage: 'idb' };
  }

  preview = {
    ...preview,
    imageDataUrl: sourceDataUrl,
    imageCompanionKey: undefined,
    imageIdbKey: undefined,
    genStatus:
      preview.genStatus === 'generating' || preview.genStatus === 'pending'
        ? 'done'
        : preview.genStatus,
  };
  return { preview, persistedMetadata: false, persistedImage: 'inline' };
}

export function createSheetGenPlaceholderItems(
  tasks: Array<{ chunkIndex: number; rowIds: string[]; rows: StoryboardTableRow[] }>
): StoryboardSheetPreviewItem[] {
  return tasks.map((task) => {
    const shotNos = task.rows.map((row) => row.shotNo?.trim() || '').filter(Boolean);
    const item = createSheetPreviewItem({
      imageDataUrl: '',
      label: buildSheetPreviewLabel(`任务 ${task.chunkIndex + 1}`, shotNos),
      source: 'generated',
      rowIds: task.rowIds,
      shotNos,
      chunkIndex: task.chunkIndex,
      genStatus: 'pending',
    });
    return { ...item, createdAt: item.createdAt - task.chunkIndex };
  });
}

/** @deprecated use persistStoryboardSheetPreviewImageToCompanion */
export async function persistStoryboardSheetPreviewImage(opts: {
  assetId: string;
  previewId: string;
  imageDataUrl: string;
  companionBaseUrl: string;
  companionProjectId: string;
}): Promise<{ ok: true; companionKey: string } | { ok: false }> {
  return persistStoryboardSheetPreviewImageToCompanion(opts);
}

export async function loadStoryboardSheetPreviewsStored(
  assetId: string,
  companionBaseUrl: string,
  companionProjectId: string
): Promise<StoryboardSheetPreviewItem[]> {
  const fromCompanion = await readStoryboardSheetPreviewsFromCompanion(
    assetId,
    companionBaseUrl,
    companionProjectId
  );
  const fromLocal = readStoryboardSheetPreviews(assetId);
  if (fromCompanion == null) {
    return mergeStoryboardSheetPreviews(fromLocal);
  }
  return mergeStoryboardSheetPreviews(fromCompanion, fromLocal);
}

export function commitStoryboardSheetPreviewList(
  assetId: string,
  items: StoryboardSheetPreviewItem[]
): { items: StoryboardSheetPreviewItem[]; persisted: boolean } {
  const next = mergeStoryboardSheetPreviews(items);
  const persisted = writeStoryboardSheetPreviews(assetId, next);
  return { items: next, persisted };
}
