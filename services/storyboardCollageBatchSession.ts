export type StoryboardCollageBatchKind = 'feedback' | 'roleReplace' | 'sheetGen';

export type StoryboardCollageBatchSessionState = {
  busy: boolean;
  kind: StoryboardCollageBatchKind | null;
  /** 当前批次正在处理的镜头 */
  rowIds: string[];
  /** 后续排队批次中的镜头（显示「等待中」） */
  queuedRowIds: string[];
  progress: { done: number; total: number } | null;
};

type SessionListener = (state: StoryboardCollageBatchSessionState) => void;

const sessions = new Map<string, StoryboardCollageBatchSessionState>();
const listeners = new Map<string, Set<SessionListener>>();

function emptySession(): StoryboardCollageBatchSessionState {
  return {
    busy: false,
    kind: null,
    rowIds: [],
    queuedRowIds: [],
    progress: null,
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

export function getStoryboardCollageBatchSession(
  assetId: string
): StoryboardCollageBatchSessionState | null {
  const id = String(assetId || '').trim();
  if (!id) return null;
  return sessions.get(id) ?? null;
}

export function ensureStoryboardCollageBatchSession(
  assetId: string
): StoryboardCollageBatchSessionState {
  const id = String(assetId || '').trim();
  let state = sessions.get(id);
  if (!state) {
    state = emptySession();
    sessions.set(id, state);
  }
  return state;
}

export function patchStoryboardCollageBatchSession(
  assetId: string,
  patch: Partial<StoryboardCollageBatchSessionState>
): StoryboardCollageBatchSessionState {
  const id = String(assetId || '').trim();
  const prev = ensureStoryboardCollageBatchSession(id);
  const next: StoryboardCollageBatchSessionState = {
    ...prev,
    ...patch,
    rowIds: patch.rowIds ? [...patch.rowIds] : prev.rowIds,
    queuedRowIds: patch.queuedRowIds ? [...patch.queuedRowIds] : prev.queuedRowIds,
  };
  sessions.set(id, next);
  notify(id);
  return next;
}

export function clearStoryboardCollageBatchSession(assetId: string): void {
  patchStoryboardCollageBatchSession(assetId, emptySession());
}

export function isStoryboardCollageBatchSessionBusy(assetId: string): boolean {
  return Boolean(getStoryboardCollageBatchSession(assetId)?.busy);
}

/** 多批任务中，当前批之后的排队镜头 id（去重保序） */
export function queuedStoryboardCollageRowIdsFromTasks(
  tasks: Array<{ rowIds: string[] }>,
  afterTaskIndex: number
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const task of tasks.slice(afterTaskIndex + 1)) {
    for (const rowId of task.rowIds) {
      if (seen.has(rowId)) continue;
      seen.add(rowId);
      out.push(rowId);
    }
  }
  return out;
}

export function subscribeStoryboardCollageBatchSession(
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
