/**
 * Project Agent thread cloud backup — Phase 3B (P24 P0).
 * Spec §18.3 / A22: async backup; failure must not block send.
 *
 * R2 keys:
 *   users/{user}/workspace/projects/{projectId}/agent/thread-hot.json
 *   users/{user}/workspace/projects/{projectId}/agent/thread-archive/{threadId}.json
 *
 * Contract frozen for parallel agents — implement body in 3B; do not change signatures.
 */

import { r2ApiUrl } from '../apiBase';
import { readLocalJson, writeLocalJson } from '../clientPersist';
import { requestJson } from '../httpClient';
import { isWorkspaceCloudEnabled, workspaceRootPrefix } from '../workspaceCloudSync';
import type { ProjectAgentThread, ProjectAgentThreadStoreKey } from './threadStore';
import { saveProjectAgentThread } from './threadStore';

export type ProjectAgentCloudSyncKey = ProjectAgentThreadStoreKey & {
  /** Prefer non-null logged-in user; null/guest → no-op */
  userId: string | null;
};

const HOT_BACKUP_DEBOUNCE_MS = 800;
const RETRY_QUEUE_STORAGE_KEY = 'ac_project_agent_cloud_backup_retry_v1';
const MAX_RETRY_QUEUE = 32;

type UploadUrlResponse = { uploadUrl: string; objectKey: string };

type BackupRetryItem = {
  objectKey: string;
  body: string;
  enqueuedAt: number;
};

type PendingHotBackup = {
  key: ProjectAgentCloudSyncKey;
  thread: ProjectAgentThread;
  timer: ReturnType<typeof setTimeout> | null;
};

const pendingHotByDedupe = new Map<string, PendingHotBackup>();
let memoryRetryQueue: BackupRetryItem[] = [];
let flushInFlight: Promise<void> | null = null;

function isEligibleUserId(userId: string | null | undefined): boolean {
  const id = String(userId ?? '').trim();
  if (!id) return false;
  const lower = id.toLowerCase();
  if (lower === 'guest' || lower === '__guest') return false;
  return true;
}

function canScheduleBackup(key: ProjectAgentCloudSyncKey): boolean {
  if (!isEligibleUserId(key.userId)) return false;
  try {
    if (!isWorkspaceCloudEnabled()) return false;
  } catch {
    return false;
  }
  return Boolean(String(key.workspaceProjectId ?? '').trim());
}

function dedupeKey(key: ProjectAgentCloudSyncKey): string {
  return `${String(key.userId ?? '').trim()}::${String(key.workspaceProjectId ?? '').trim()}`;
}

function hotObjectKey(userId: string, projectId: string): string {
  return `${workspaceRootPrefix(userId)}/projects/${projectId}/agent/thread-hot.json`;
}

function archiveObjectKey(userId: string, projectId: string, threadId: string): string {
  return `${workspaceRootPrefix(userId)}/projects/${projectId}/agent/thread-archive/${threadId}.json`;
}

/** Lean JSON only — no media bytes / base64 (A22). Strip data URLs & long base64 blobs. */
function stripBase64FromUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/^data:[^;]+;base64,/i.test(value)) return '[omitted-data-url]';
    if (value.length > 256 && /^(?:[A-Za-z0-9+/]{64,}={0,2})$/.test(value.replace(/\s/g, ''))) {
      return '[omitted-base64]';
    }
    if (/data:[^;]+;base64,/i.test(value)) {
      return value.replace(/data:[^;]+;base64,[A-Za-z0-9+/=\s]+/gi, '[omitted-data-url]');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(stripBase64FromUnknown);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripBase64FromUnknown(v);
    }
    return out;
  }
  return value;
}

function serializeThread(thread: ProjectAgentThread): string {
  const lean = stripBase64FromUnknown({
    id: thread.id,
    workspaceProjectId: thread.workspaceProjectId,
    messages: thread.messages,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  });
  return JSON.stringify(lean);
}

async function putObjectBytes(objectKey: string, contentType: string, body: string): Promise<void> {
  const contentLength = new TextEncoder().encode(body).byteLength;
  const { uploadUrl } = await requestJson<UploadUrlResponse>(r2ApiUrl('/upload-url'), {
    method: 'POST',
    body: JSON.stringify({ objectKey, contentType, expiresIn: 900, contentLength }),
  });
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
  if (!put.ok) throw new Error(`R2 upload failed (${put.status})`);
  await requestJson<{ ok?: boolean }>(r2ApiUrl('/register-upload'), {
    method: 'POST',
    body: JSON.stringify({ objectKey }),
  });
}

function loadPersistedRetryQueue(): BackupRetryItem[] {
  return readLocalJson<BackupRetryItem[]>(RETRY_QUEUE_STORAGE_KEY, [], (parsed) => {
    if (!Array.isArray(parsed)) return [];
    const out: BackupRetryItem[] = [];
    for (const raw of parsed) {
      if (raw == null || typeof raw !== 'object') continue;
      const item = raw as Partial<BackupRetryItem>;
      if (typeof item.objectKey !== 'string' || typeof item.body !== 'string') continue;
      out.push({
        objectKey: item.objectKey,
        body: item.body,
        enqueuedAt: Number(item.enqueuedAt) || Date.now(),
      });
    }
    return out.slice(-MAX_RETRY_QUEUE);
  });
}

function persistRetryQueue(items: BackupRetryItem[]): void {
  writeLocalJson(RETRY_QUEUE_STORAGE_KEY, items.slice(-MAX_RETRY_QUEUE));
}

function enqueueRetry(item: BackupRetryItem): void {
  memoryRetryQueue = [...memoryRetryQueue.filter((x) => x.objectKey !== item.objectKey), item].slice(
    -MAX_RETRY_QUEUE
  );
  try {
    const persisted = loadPersistedRetryQueue().filter((x) => x.objectKey !== item.objectKey);
    persistRetryQueue([...persisted, item].slice(-MAX_RETRY_QUEUE));
  } catch {
    /* ignore persist errors */
  }
}

async function putThreadJson(objectKey: string, body: string): Promise<void> {
  await putObjectBytes(objectKey, 'application/json', body);
}

async function backupOnce(objectKey: string, body: string): Promise<void> {
  try {
    await putThreadJson(objectKey, body);
  } catch {
    enqueueRetry({ objectKey, body, enqueuedAt: Date.now() });
  }
}

function runHotBackup(key: ProjectAgentCloudSyncKey, thread: ProjectAgentThread): void {
  const userId = String(key.userId ?? '').trim();
  const projectId = String(key.workspaceProjectId ?? '').trim();
  if (!userId || !projectId) return;
  const objectKey = hotObjectKey(userId, projectId);
  const body = serializeThread(thread);
  void backupOnce(objectKey, body);
}

/**
 * Cancel a pending debounced hot backup for this project (e.g. before clear/new chat).
 * Prevents stale thread from overwriting thread-hot.json after archive.
 */
export function cancelPendingProjectAgentHotBackup(key: ProjectAgentCloudSyncKey): void {
  try {
    const dk = dedupeKey(key);
    const pending = pendingHotByDedupe.get(dk);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pendingHotByDedupe.delete(dk);
  } catch {
    /* never throw */
  }
}

/**
 * Debounced async backup of the hot thread after local save.
 * Never throws to callers; failures go to the retry queue.
 */
export function scheduleProjectAgentThreadBackup(
  key: ProjectAgentCloudSyncKey,
  thread: ProjectAgentThread
): void {
  try {
    if (!canScheduleBackup(key)) return;
    const dk = dedupeKey(key);
    const existing = pendingHotByDedupe.get(dk);
    if (existing?.timer) clearTimeout(existing.timer);
    const entry: PendingHotBackup = {
      key: { userId: key.userId, workspaceProjectId: key.workspaceProjectId },
      thread,
      timer: null,
    };
    entry.timer = setTimeout(() => {
      pendingHotByDedupe.delete(dk);
      try {
        runHotBackup(entry.key, entry.thread);
      } catch {
        /* never throw */
      }
    }, HOT_BACKUP_DEBOUNCE_MS);
    pendingHotByDedupe.set(dk, entry);
  } catch {
    /* never throw */
  }
}

/**
 * Best-effort backup of an archived thread snapshot (P25 clear/new chat).
 * Never throws to callers.
 */
export function scheduleProjectAgentThreadArchiveBackup(
  key: ProjectAgentCloudSyncKey,
  archived: ProjectAgentThread
): void {
  try {
    if (!canScheduleBackup(key)) return;
    const userId = String(key.userId ?? '').trim();
    const projectId = String(key.workspaceProjectId ?? '').trim();
    const threadId = String(archived?.id ?? '').trim();
    if (!userId || !projectId || !threadId) return;
    const objectKey = archiveObjectKey(userId, projectId, threadId);
    const body = serializeThread(archived);
    void backupOnce(objectKey, body);
  } catch {
    /* never throw */
  }
}

/**
 * Drain in-memory / persisted backup retry queue (for tests + idle flush).
 * Resolves even if some items fail again (re-queue).
 */
export async function flushProjectAgentBackupRetryQueue(): Promise<void> {
  if (flushInFlight) {
    try {
      await flushInFlight;
    } catch {
      /* ignore */
    }
    return;
  }

  flushInFlight = (async () => {
    const fromDisk = loadPersistedRetryQueue();
    const merged = new Map<string, BackupRetryItem>();
    for (const item of [...fromDisk, ...memoryRetryQueue]) {
      merged.set(item.objectKey, item);
    }
    memoryRetryQueue = [];
    persistRetryQueue([]);

    const failed: BackupRetryItem[] = [];
    for (const item of merged.values()) {
      try {
        await putThreadJson(item.objectKey, item.body);
      } catch {
        failed.push(item);
      }
    }
    for (const item of failed) {
      enqueueRetry(item);
    }
  })();

  try {
    await flushInFlight;
  } catch {
    /* never throw */
  } finally {
    flushInFlight = null;
  }
}

/** @internal — reset debounce + retry state between unit tests. */
export function __resetProjectAgentThreadCloudSyncForTests(): void {
  for (const pending of pendingHotByDedupe.values()) {
    if (pending.timer) clearTimeout(pending.timer);
  }
  pendingHotByDedupe.clear();
  memoryRetryQueue = [];
  flushInFlight = null;
  try {
    writeLocalJson(RETRY_QUEUE_STORAGE_KEY, []);
  } catch {
    /* ignore */
  }
}

// ─── Phase 4F: cloud as source of truth (P1e / §18.3) ───────────────────────

type DownloadUrlResponse = { downloadUrl: string; objectKey: string };

async function downloadR2ObjectText(objectKey: string): Promise<string | null> {
  const { downloadUrl } = await requestJson<DownloadUrlResponse>(r2ApiUrl('/download-url'), {
    method: 'POST',
    body: JSON.stringify({ objectKey, expiresIn: 300 }),
  });
  const r = await fetch(downloadUrl);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`R2 download failed (${r.status})`);
  return await r.text();
}

function parseHotThreadPayload(
  raw: string,
  fallbackProjectId: string
): ProjectAgentThread | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectAgentThread>;
    if (!parsed || typeof parsed !== 'object') return null;
    const id = typeof parsed.id === 'string' ? parsed.id.trim() : '';
    const pid =
      typeof parsed.workspaceProjectId === 'string' && parsed.workspaceProjectId.trim()
        ? parsed.workspaceProjectId.trim()
        : fallbackProjectId.trim();
    if (!id || !pid) return null;
    const rawMessages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const messages = rawMessages.filter((m): m is ProjectAgentThread['messages'][number] => {
      if (!m || typeof m !== 'object') return false;
      const msg = m as { id?: unknown; role?: unknown };
      return (
        typeof msg.id === 'string' &&
        msg.id.trim().length > 0 &&
        (msg.role === 'user' || msg.role === 'assistant')
      );
    });
    const createdAt =
      typeof parsed.createdAt === 'number' && Number.isFinite(parsed.createdAt)
        ? parsed.createdAt
        : Date.now();
    const updatedAt =
      typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
        ? parsed.updatedAt
        : createdAt;
    return {
      id,
      workspaceProjectId: pid,
      messages,
      createdAt,
      updatedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Pull hot thread JSON from R2. Returns null if missing / guest / cloud off.
 * Contract frozen for 4F — implement body; do not change signature.
 */
export async function pullProjectAgentThreadHot(
  key: ProjectAgentCloudSyncKey
): Promise<ProjectAgentThread | null> {
  if (!canScheduleBackup(key)) return null;
  const userId = String(key.userId ?? '').trim();
  const projectId = String(key.workspaceProjectId ?? '').trim();
  if (!userId || !projectId) return null;
  const objectKey = hotObjectKey(userId, projectId);
  const raw = await downloadR2ObjectText(objectKey);
  if (raw == null || !String(raw).trim()) return null;
  return parseHotThreadPayload(raw, projectId);
}

/**
 * Point-get one archived thread by id (5C cold load).
 * No prefix listing — caller must already know threadId (local archive index).
 */
export async function pullProjectAgentThreadArchive(
  key: ProjectAgentCloudSyncKey,
  threadId: string
): Promise<ProjectAgentThread | null> {
  if (!canScheduleBackup(key)) return null;
  const userId = String(key.userId ?? '').trim();
  const projectId = String(key.workspaceProjectId ?? '').trim();
  const tid = String(threadId ?? '').trim();
  if (!userId || !projectId || !tid) return null;
  const objectKey = archiveObjectKey(userId, projectId, tid);
  const raw = await downloadR2ObjectText(objectKey);
  if (raw == null || !String(raw).trim()) return null;
  return parseHotThreadPayload(raw, projectId);
}

/**
 * LWW merge by updatedAt (§18.3). Prefer newer; on tie prefer remote.
 * Pure — no I/O.
 */
export function mergeProjectAgentThreadLww(
  local: ProjectAgentThread | null,
  remote: ProjectAgentThread | null
): ProjectAgentThread | null {
  if (!local && !remote) return null;
  if (!local) return remote;
  if (!remote) return local;
  const localTs = Number(local.updatedAt) || 0;
  const remoteTs = Number(remote.updatedAt) || 0;
  if (remoteTs > localTs) return remote;
  if (localTs > remoteTs) return local;
  // Tie → prefer remote (cloud as source of truth)
  return remote;
}

/**
 * Open-project hydrate: pull remote → LWW with **fresh** local → save local cache.
 * Failure must not throw to UI (return local fallback).
 *
 * @param opts.getFreshLocal — after await pull, re-read current local (React ref / disk).
 *   If fresh local is newer than the snapshot `local`, LWW uses fresh to avoid clobbering
 *   in-flight sends / clear-chat (review P0).
 */
export async function hydrateProjectAgentThreadFromCloud(
  key: ProjectAgentCloudSyncKey,
  local: ProjectAgentThread | null,
  opts?: { getFreshLocal?: () => ProjectAgentThread | null }
): Promise<ProjectAgentThread | null> {
  try {
    if (!canScheduleBackup(key)) return local;
    const remote = await pullProjectAgentThreadHot(key);
    const fresh =
      typeof opts?.getFreshLocal === 'function' ? opts.getFreshLocal() ?? local : local;
    const merged = mergeProjectAgentThreadLww(fresh, remote);
    if (!merged) return fresh ?? local;
    // If fresh local already advanced past merge input and equals fresh, prefer not to regress UI
    if (fresh && merged === remote) {
      const freshTs = Number(fresh.updatedAt) || 0;
      const remoteTs = Number(remote?.updatedAt) || 0;
      const snapTs = Number(local?.updatedAt) || 0;
      // Caller should still compare before setState; we return merged for LWW truth
      void freshTs;
      void remoteTs;
      void snapTs;
    }
    if (merged !== fresh) {
      try {
        const result = saveProjectAgentThread(
          { userId: key.userId, workspaceProjectId: key.workspaceProjectId },
          merged
        );
        if (result.ok) return result.thread;
      } catch {
        /* cache write best-effort */
      }
    }
    return merged;
  } catch {
    return typeof opts?.getFreshLocal === 'function' ? opts.getFreshLocal() ?? local : local;
  }
}
