import type { CompanionJobEventV1 } from './companionClient/compute';

const STORE_KEY = 'ac_companion_job_terminal_v1';
const MAX_PAYLOAD_JSON_CHARS = 3000;

const TERMINAL_TYPES = new Set<CompanionJobEventV1['type']>([
  'reply.completed',
  'task.failed',
  'task.cancelled',
]);

type TerminalMap = Record<string, CompanionJobEventV1>;

function readMap(): TerminalMap {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: TerminalMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k !== 'string' || !v || typeof v !== 'object') continue;
      const o = v as Record<string, unknown>;
      const seq = o.seq;
      const at = o.at;
      const jobId = o.jobId;
      const type = o.type;
      if (
        typeof seq !== 'number' ||
        typeof at !== 'number' ||
        typeof jobId !== 'string' ||
        typeof type !== 'string' ||
        !TERMINAL_TYPES.has(type as CompanionJobEventV1['type'])
      ) {
        continue;
      }
      const payload = o.payload;
      out[k] = {
        seq: Math.floor(seq),
        at: Math.floor(at),
        jobId,
        type: type as CompanionJobEventV1['type'],
        payload:
          payload && typeof payload === 'object' && !Array.isArray(payload)
            ? (payload as Record<string, unknown>)
            : undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: TerminalMap): void {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function sanitizePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  try {
    const s = JSON.stringify(payload);
    if (s.length <= MAX_PAYLOAD_JSON_CHARS) return JSON.parse(s) as Record<string, unknown>;
    return { _truncated: true, approxChars: s.length };
  } catch {
    return { _note: 'payload_unserializable' };
  }
}

function toStoredEvent(e: CompanionJobEventV1): CompanionJobEventV1 {
  return {
    seq: Math.floor(e.seq),
    at: Math.floor(e.at),
    jobId: e.jobId,
    type: e.type,
    payload: sanitizePayload(e.payload),
  };
}

/** 仅当 seq 更大或相等且为终态事件时写入，用于跨页/刷新恢复最新终态。 */
export function saveCompanionJobTerminalEvent(event: CompanionJobEventV1): void {
  if (!TERMINAL_TYPES.has(event.type)) return;
  const id = event.jobId.trim();
  if (!id) return;
  const map = readMap();
  const prev = map[id];
  if (prev && prev.seq > event.seq) return;
  if (prev && prev.seq === event.seq && prev.type === event.type) return;
  map[id] = toStoredEvent(event);
  writeMap(map);
}

export function getCompanionJobTerminalEvent(jobId: string): CompanionJobEventV1 | null {
  const id = jobId.trim();
  if (!id) return null;
  const e = readMap()[id];
  return e && TERMINAL_TYPES.has(e.type) ? e : null;
}

export function clearCompanionJobTerminalEvent(jobId: string): void {
  const id = jobId.trim();
  if (!id) return;
  const map = readMap();
  if (!(id in map)) return;
  delete map[id];
  writeMap(map);
}
