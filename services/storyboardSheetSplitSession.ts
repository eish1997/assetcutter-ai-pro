export type StoryboardSheetSplitSessionState = {
  busy: boolean;
  batchBusy: boolean;
  progress: { done: number; total: number } | null;
  busyPreviewId: string | null;
};

type SessionListener = (state: StoryboardSheetSplitSessionState) => void;

const sessions = new Map<string, StoryboardSheetSplitSessionState>();
const listeners = new Map<string, Set<SessionListener>>();

function emptySession(): StoryboardSheetSplitSessionState {
  return {
    busy: false,
    batchBusy: false,
    progress: null,
    busyPreviewId: null,
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

export function getStoryboardSheetSplitSession(
  assetId: string
): StoryboardSheetSplitSessionState | null {
  const id = String(assetId || '').trim();
  if (!id) return null;
  return sessions.get(id) ?? null;
}

export function ensureStoryboardSheetSplitSession(
  assetId: string
): StoryboardSheetSplitSessionState {
  const id = String(assetId || '').trim();
  let state = sessions.get(id);
  if (!state) {
    state = emptySession();
    sessions.set(id, state);
  }
  return state;
}

export function patchStoryboardSheetSplitSession(
  assetId: string,
  patch: Partial<StoryboardSheetSplitSessionState>
): StoryboardSheetSplitSessionState {
  const id = String(assetId || '').trim();
  const prev = ensureStoryboardSheetSplitSession(id);
  const next: StoryboardSheetSplitSessionState = { ...prev, ...patch };
  sessions.set(id, next);
  notify(id);
  return next;
}

export function clearStoryboardSheetSplitSessionBusy(assetId: string): void {
  patchStoryboardSheetSplitSession(assetId, emptySession());
}

export function isStoryboardSheetSplitSessionBusy(assetId: string): boolean {
  return Boolean(getStoryboardSheetSplitSession(assetId)?.busy);
}

export function subscribeStoryboardSheetSplitSession(
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
