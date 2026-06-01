import { readLocalJson, scopedStorageKey, writeLocalStringOrThrow } from './clientPersist';
import type { StoryboardFeedbackRedrawBatchRecord } from './storyboardFeedbackSheetRedraw';

export const STORYBOARD_FEEDBACK_REDRAW_HISTORY_KEY = 'ac_storyboard_feedback_redraw_history_v1';
export const STORYBOARD_FEEDBACK_REDRAW_HISTORY_SELECTED_KEY =
  'ac_storyboard_feedback_redraw_history_selected_v1';
export const STORYBOARD_FEEDBACK_REDRAW_HISTORY_LIMIT = 24;

function historyStorageKey(assetId: string): string {
  return scopedStorageKey(`${STORYBOARD_FEEDBACK_REDRAW_HISTORY_KEY}__${assetId}`, null);
}

function selectedStorageKey(assetId: string): string {
  return scopedStorageKey(`${STORYBOARD_FEEDBACK_REDRAW_HISTORY_SELECTED_KEY}__${assetId}`, null);
}

const VALID_STATUS = new Set<StoryboardFeedbackRedrawBatchRecord['status']>([
  'running',
  'done',
  'partial',
  'failed',
]);

function normalizeRowImages(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [rowId, image] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof rowId !== 'string' || !rowId.trim()) continue;
    if (typeof image !== 'string' || !image.trim()) continue;
    out[rowId] = image;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeRecord(raw: unknown): StoryboardFeedbackRedrawBatchRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<StoryboardFeedbackRedrawBatchRecord>;
  if (typeof item.id !== 'string' || !item.id.trim()) return null;
  if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)) return null;
  if (typeof item.label !== 'string' || !item.label.trim()) return null;
  if (!Array.isArray(item.rowIds)) return null;
  const rowIds = item.rowIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim()));
  if (!rowIds.length) return null;
  let status = VALID_STATUS.has(item.status as StoryboardFeedbackRedrawBatchRecord['status'])
    ? (item.status as StoryboardFeedbackRedrawBatchRecord['status'])
    : 'done';
  if (status === 'running') status = 'partial';
  return {
    id: item.id,
    createdAt: item.createdAt,
    label: item.label,
    rowIds,
    status,
    matchedCount: typeof item.matchedCount === 'number' ? item.matchedCount : undefined,
    totalTasks: typeof item.totalTasks === 'number' ? item.totalTasks : undefined,
    rowImages: normalizeRowImages(item.rowImages),
  };
}

export function readStoryboardFeedbackRedrawHistory(
  assetId: string
): StoryboardFeedbackRedrawBatchRecord[] {
  return readLocalJson(historyStorageKey(assetId), [] as StoryboardFeedbackRedrawBatchRecord[], (parsed) => {
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((item) => normalizeRecord(item))
      .filter((item): item is StoryboardFeedbackRedrawBatchRecord => item != null)
      .slice(0, STORYBOARD_FEEDBACK_REDRAW_HISTORY_LIMIT);
  });
}

export function writeStoryboardFeedbackRedrawHistory(
  assetId: string,
  items: StoryboardFeedbackRedrawBatchRecord[]
): boolean {
  const next = items.slice(0, STORYBOARD_FEEDBACK_REDRAW_HISTORY_LIMIT);
  try {
    writeLocalStringOrThrow(historyStorageKey(assetId), JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function readStoryboardFeedbackRedrawHistorySelection(assetId: string): string | null {
  const id = readLocalJson(selectedStorageKey(assetId), null as string | null, (parsed) =>
    typeof parsed === 'string' && parsed.trim() ? parsed : null
  );
  return id;
}

export function writeStoryboardFeedbackRedrawHistorySelection(
  assetId: string,
  selectedId: string | null
): boolean {
  try {
    writeLocalStringOrThrow(
      selectedStorageKey(assetId),
      JSON.stringify(selectedId && selectedId.trim() ? selectedId : null)
    );
    return true;
  } catch {
    return false;
  }
}
