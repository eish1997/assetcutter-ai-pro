type AssetSetTaskKind = 'component_sheet' | 'batch_3d';

export type AssetSetTaskSession = {
  kind: AssetSetTaskKind | null;
  busy: boolean;
  progress: { done: number; total: number } | null;
  busyComponentIds: Set<string>;
  abortController: AbortController | null;
};

type Listener = (state: AssetSetTaskSession) => void;

const sessions = new Map<string, AssetSetTaskSession>();
const listeners = new Map<string, Set<Listener>>();

function emptySession(): AssetSetTaskSession {
  return {
    kind: null,
    busy: false,
    progress: null,
    busyComponentIds: new Set(),
    abortController: null,
  };
}

function emit(assetId: string) {
  const state = sessions.get(assetId) ?? emptySession();
  for (const fn of listeners.get(assetId) ?? []) {
    fn(state);
  }
}

export function getAssetSetTaskSession(assetId: string): AssetSetTaskSession | null {
  return sessions.get(assetId) ?? null;
}

export function subscribeAssetSetTaskSession(assetId: string, listener: Listener): () => void {
  const set = listeners.get(assetId) ?? new Set();
  set.add(listener);
  listeners.set(assetId, set);
  listener(sessions.get(assetId) ?? emptySession());
  return () => {
    const cur = listeners.get(assetId);
    if (!cur) return;
    cur.delete(listener);
    if (!cur.size) listeners.delete(assetId);
  };
}

export function patchAssetSetTaskSession(
  assetId: string,
  patch: Partial<AssetSetTaskSession> & { busyComponentIds?: Set<string> }
): AssetSetTaskSession {
  const prev = sessions.get(assetId) ?? emptySession();
  const next: AssetSetTaskSession = {
    ...prev,
    ...patch,
    busyComponentIds: patch.busyComponentIds ?? prev.busyComponentIds,
    abortController:
      patch.abortController !== undefined ? patch.abortController : prev.abortController,
  };
  sessions.set(assetId, next);
  emit(assetId);
  return next;
}

export function clearAssetSetTaskSession(assetId: string) {
  sessions.delete(assetId);
  emit(assetId);
}

export function abortAssetSetTaskSession(assetId: string): boolean {
  const prev = sessions.get(assetId);
  if (!prev?.busy || !prev.abortController) return false;
  prev.abortController.abort();
  sessions.delete(assetId);
  emit(assetId);
  return true;
}
