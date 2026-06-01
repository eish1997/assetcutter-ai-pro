import type { StoryboardSheetGenBatchController } from './storyboardTableSheetGen';
import {
  mergeStoryboardSheetPreviews,
  type StoryboardSheetPreviewItem,
} from './storyboardSheetPreview';

export type StoryboardSheetGenSessionState = {
  previews: StoryboardSheetPreviewItem[];
  busy: boolean;
  progress: { done: number; total: number } | null;
  controller: StoryboardSheetGenBatchController | null;
  placeholderIdByChunk: Map<number, string>;
};

type SessionListener = (state: StoryboardSheetGenSessionState) => void;

const sessions = new Map<string, StoryboardSheetGenSessionState>();
const listeners = new Map<string, Set<SessionListener>>();

function emptySession(): StoryboardSheetGenSessionState {
  return {
    previews: [],
    busy: false,
    progress: null,
    controller: null,
    placeholderIdByChunk: new Map(),
  };
}

function notify(assetId: string) {
  const state = sessions.get(assetId);
  if (!state) return;
  const subs = listeners.get(assetId);
  if (!subs?.size) return;
  for (const fn of subs) {
    fn(state);
  }
}

export function getStoryboardSheetGenSession(assetId: string): StoryboardSheetGenSessionState | null {
  const id = String(assetId || '').trim();
  if (!id) return null;
  return sessions.get(id) ?? null;
}

export function ensureStoryboardSheetGenSession(assetId: string): StoryboardSheetGenSessionState {
  const id = String(assetId || '').trim();
  let state = sessions.get(id);
  if (!state) {
    state = emptySession();
    sessions.set(id, state);
  }
  return state;
}

export function patchStoryboardSheetGenSession(
  assetId: string,
  patch: Partial<Omit<StoryboardSheetGenSessionState, 'placeholderIdByChunk'>> & {
    placeholderIdByChunk?: Map<number, string>;
  }
): StoryboardSheetGenSessionState {
  const id = String(assetId || '').trim();
  const prev = ensureStoryboardSheetGenSession(id);
  const next: StoryboardSheetGenSessionState = {
    ...prev,
    ...patch,
    placeholderIdByChunk: patch.placeholderIdByChunk
      ? new Map(patch.placeholderIdByChunk)
      : prev.placeholderIdByChunk,
    previews: patch.previews ? [...patch.previews] : prev.previews,
  };
  sessions.set(id, next);
  notify(id);
  return next;
}

export function isStoryboardSheetPreviewSessionTransient(
  item: StoryboardSheetPreviewItem
): boolean {
  const status = item.genStatus;
  if (status === 'pending' || status === 'generating') return true;
  if (status === 'failed') {
    const img = String(item.imageDataUrl || '').trim();
    const hasCompanion = String(item.imageCompanionKey || '').trim();
    const hasIdb = String(item.imageIdbKey || '').trim();
    return !(img || hasCompanion || hasIdb);
  }
  return false;
}

function filterStoryboardSheetPreviewSessionItems(
  previews: StoryboardSheetPreviewItem[],
  busy: boolean
): StoryboardSheetPreviewItem[] {
  if (busy) return previews;
  return previews.filter(isStoryboardSheetPreviewSessionTransient);
}

export function setStoryboardSheetGenSessionPreviews(
  assetId: string,
  previews: StoryboardSheetPreviewItem[]
): StoryboardSheetGenSessionState {
  return patchStoryboardSheetGenSession(assetId, { previews });
}

/** Panel 写入：生图 busy 时保留全量；空闲时仅保留进行中/未落盘失败项，避免内存膨胀与删除后复活 */
export function syncStoryboardSheetGenSessionPreviews(
  assetId: string,
  previews: StoryboardSheetPreviewItem[]
): StoryboardSheetGenSessionState {
  const id = String(assetId || '').trim();
  const session = ensureStoryboardSheetGenSession(id);
  const nextPreviews = filterStoryboardSheetPreviewSessionItems(previews, session.busy);
  return patchStoryboardSheetGenSession(id, { previews: nextPreviews });
}

export function mergeStoryboardSheetGenSessionPreviews(
  assetId: string,
  ...lists: StoryboardSheetPreviewItem[][]
): StoryboardSheetGenSessionState {
  const id = String(assetId || '').trim();
  const prev = ensureStoryboardSheetGenSession(id);
  const merged = mergeStoryboardSheetPreviews(...lists, prev.previews);
  return patchStoryboardSheetGenSession(id, { previews: merged });
}

export function patchStoryboardSheetGenSessionPreview(
  assetId: string,
  previewId: string,
  patch: Partial<StoryboardSheetPreviewItem>
): StoryboardSheetGenSessionState {
  const id = String(assetId || '').trim();
  const prev = ensureStoryboardSheetGenSession(id);
  const previews = prev.previews.map((item) =>
    item.id === previewId ? { ...item, ...patch } : item
  );
  return patchStoryboardSheetGenSession(id, { previews });
}

export function findStoryboardSheetGenSessionPreview(
  assetId: string,
  previewId: string
): StoryboardSheetPreviewItem | undefined {
  return getStoryboardSheetGenSession(assetId)?.previews.find((item) => item.id === previewId);
}

export function clearStoryboardSheetGenSessionBusy(assetId: string): void {
  const id = String(assetId || '').trim();
  const prev = ensureStoryboardSheetGenSession(id);
  const transient = prev.previews.filter(isStoryboardSheetPreviewSessionTransient);
  patchStoryboardSheetGenSession(id, {
    busy: false,
    progress: null,
    controller: null,
    placeholderIdByChunk: new Map(),
    previews: transient,
  });
}

export function subscribeStoryboardSheetGenSession(
  assetId: string,
  listener: SessionListener
): () => void {
  const id = String(assetId || '').trim();
  if (!id) return () => undefined;
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  const current = sessions.get(id);
  if (current) listener(current);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(id);
  };
}

export function isStoryboardSheetGenSessionBusy(assetId: string): boolean {
  return Boolean(getStoryboardSheetGenSession(assetId)?.busy);
}
