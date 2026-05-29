import { readLocalJson, scopedStorageKey, writeLocalStringOrThrow } from './clientPersist';
import type { StoryboardTableRow } from '../types';

export const STORYBOARD_SHEET_PREVIEW_KEY = 'ac_storyboard_sheet_preview_v1';
export const STORYBOARD_SHEET_PREVIEW_LIMIT = 8;

export type StoryboardSheetPreviewItem = {
  id: string;
  imageDataUrl: string;
  createdAt: number;
  label: string;
  source: 'generated' | 'uploaded';
  rowIds: string[];
  shotNos: string[];
  matchedCount: number;
};

function previewStorageKey(assetId: string): string {
  return scopedStorageKey(`${STORYBOARD_SHEET_PREVIEW_KEY}__${assetId}`, null);
}

function normalizePreviewItem(raw: unknown): StoryboardSheetPreviewItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<StoryboardSheetPreviewItem>;
  if (typeof item.imageDataUrl !== 'string' || !item.imageDataUrl.trim()) return null;
  if (typeof item.id !== 'string' || !item.id.trim()) return null;
  return {
    id: item.id,
    imageDataUrl: item.imageDataUrl,
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
    label: typeof item.label === 'string' ? item.label : '拼图',
    source: item.source === 'uploaded' ? 'uploaded' : 'generated',
    rowIds: Array.isArray(item.rowIds) ? item.rowIds.filter((id): id is string => typeof id === 'string') : [],
    shotNos: Array.isArray(item.shotNos) ? item.shotNos.filter((shot): shot is string => typeof shot === 'string') : [],
    matchedCount: typeof item.matchedCount === 'number' ? item.matchedCount : 0,
  };
}

export function readStoryboardSheetPreviews(assetId: string): StoryboardSheetPreviewItem[] {
  const items = readLocalJson(previewStorageKey(assetId), [] as StoryboardSheetPreviewItem[], (parsed) => {
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((item) => normalizePreviewItem(item))
      .filter((item): item is StoryboardSheetPreviewItem => item != null);
  });
  return items.slice(0, STORYBOARD_SHEET_PREVIEW_LIMIT);
}

export function writeStoryboardSheetPreviews(assetId: string, items: StoryboardSheetPreviewItem[]): boolean {
  const next = items.slice(0, STORYBOARD_SHEET_PREVIEW_LIMIT);
  try {
    writeLocalStringOrThrow(previewStorageKey(assetId), JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function prependStoryboardSheetPreview(
  assetId: string,
  item: StoryboardSheetPreviewItem
): { items: StoryboardSheetPreviewItem[]; persisted: boolean } {
  const next = [item, ...readStoryboardSheetPreviews(assetId)].slice(0, STORYBOARD_SHEET_PREVIEW_LIMIT);
  const persisted = writeStoryboardSheetPreviews(assetId, next);
  return { items: next, persisted };
}

export function updateStoryboardSheetPreview(
  assetId: string,
  previewId: string,
  patch: Partial<StoryboardSheetPreviewItem>
): { items: StoryboardSheetPreviewItem[]; persisted: boolean } {
  const next = readStoryboardSheetPreviews(assetId).map((item) =>
    item.id === previewId ? { ...item, ...patch } : item
  );
  const persisted = writeStoryboardSheetPreviews(assetId, next);
  return { items: next, persisted };
}

export function resolveSheetTaskRows(
  tableRows: StoryboardTableRow[],
  rowIds: string[],
  shotNos: string[]
): StoryboardTableRow[] {
  const byId = tableRows.filter((row) => rowIds.includes(row.id));
  if (byId.length > 0) return byId;

  const shotSet = new Set(shotNos.map((shot) => shot.trim()).filter(Boolean));
  if (!shotSet.size) return [];

  return tableRows.filter((row) => {
    const shotNo = row.shotNo?.trim();
    return shotNo ? shotSet.has(shotNo) : false;
  });
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
