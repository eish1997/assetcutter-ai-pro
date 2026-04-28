const CURSOR_STORE_KEY = 'ac_companion_job_cursor_store_v1';

type CursorMap = Record<string, number>;

function readMap(): CursorMap {
  try {
    const raw = globalThis.localStorage?.getItem(CURSOR_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: CursorMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && Number.isFinite(v)) {
        out[k] = Math.max(0, Math.floor(v as number));
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: CursorMap): void {
  try {
    globalThis.localStorage?.setItem(CURSOR_STORE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function getCompanionJobCursor(jobId: string): number {
  const id = jobId.trim();
  if (!id) return 0;
  const map = readMap();
  return Number.isFinite(map[id]) ? map[id] : 0;
}

export function setCompanionJobCursor(jobId: string, afterSeq: number): void {
  const id = jobId.trim();
  if (!id) return;
  const seq = Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0;
  const map = readMap();
  map[id] = Math.max(map[id] ?? 0, seq);
  writeMap(map);
}

export function clearCompanionJobCursor(jobId: string): void {
  const id = jobId.trim();
  if (!id) return;
  const map = readMap();
  if (!(id in map)) return;
  delete map[id];
  writeMap(map);
}
