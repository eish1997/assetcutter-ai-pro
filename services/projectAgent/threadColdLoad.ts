/**
 * Project Agent cold / earlier-message load — Phase 5 / U4 5C.
 *
 * ## Limitations (v0)
 * - R2 prefix **list** is not used (no cheap archive directory listing in client).
 * - Sources of 「更早」:
 *   1. **本机归档快照**（清空/新开时 `saveLocalThreadArchive`）
 *   2. **本机冷袋**（热窗口裁剪掉的消息 `stashColdOverflowMessages`）
 *   3. 可选：按本机索引里的 threadId **点名拉取**云 `thread-archive/{id}.json`
 *      （复用 threadCloudSync pull 模式；无 list）
 * - Compaction `coveredMessageIds` 仅用于优先挑选仍留在本地/冷袋中的消息，
 *   **不能**从 summary 还原全文。
 * - `mergeEarlierMessages` 后仍走热窗口 80 + quotas trim：若热线程已满且更早消息更旧，
 *   合并后可能再次被裁掉（适合「清空后恢复归档」或热窗口未满时补冷段）。
 */

import type { QuickComposeThreadMessage } from '../../types/quickComposeThread';
import { readLocalJson, removeLocalKey, scopedStorageKey, writeLocalJson } from '../clientPersist';
import { loadProjectAgentCompaction } from './compaction';
import { trimProjectAgentThreadForQuota } from './persist/quotas';
import {
  pullProjectAgentThreadArchive,
  type ProjectAgentCloudSyncKey,
} from './threadCloudSync';
import {
  PROJECT_AGENT_THREAD_MAX_MESSAGES,
  trimProjectAgentThreadMessages,
  type ProjectAgentThread,
  type ProjectAgentThreadStoreKey,
} from './threadStore';

const LOCAL_ARCHIVE_INDEX_BASE = 'ac_project_agent_archive_index_v1';
const LOCAL_ARCHIVE_BODY_BASE = 'ac_project_agent_archive_body_v1';
const COLD_BAG_BASE = 'ac_project_agent_cold_bag_v1';

/** Keep a small ring of local archives per project (quota-friendly). */
export const PROJECT_AGENT_LOCAL_ARCHIVE_MAX = 8;
/** Cap cold-bag messages retained locally. */
export const PROJECT_AGENT_COLD_BAG_MAX = 200;

export type LocalThreadArchiveMeta = {
  threadId: string;
  archivedAt: number;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
};

type LocalArchiveIndex = {
  workspaceProjectId: string;
  items: LocalThreadArchiveMeta[];
};

type ColdBag = {
  workspaceProjectId: string;
  messages: QuickComposeThreadMessage[];
  updatedAt: number;
};

function archiveIndexKey(key: ProjectAgentThreadStoreKey): string {
  const pid = String(key.workspaceProjectId ?? '').trim();
  if (!pid) throw new Error('workspaceProjectId is required');
  return `${scopedStorageKey(LOCAL_ARCHIVE_INDEX_BASE, key.userId)}__p_${pid}`;
}

function archiveBodyKey(key: ProjectAgentThreadStoreKey, threadId: string): string {
  const pid = String(key.workspaceProjectId ?? '').trim();
  const tid = String(threadId ?? '').trim();
  if (!pid || !tid) throw new Error('workspaceProjectId and threadId are required');
  return `${scopedStorageKey(LOCAL_ARCHIVE_BODY_BASE, key.userId)}__p_${pid}__t_${tid}`;
}

function coldBagKey(key: ProjectAgentThreadStoreKey): string {
  const pid = String(key.workspaceProjectId ?? '').trim();
  if (!pid) throw new Error('workspaceProjectId is required');
  return `${scopedStorageKey(COLD_BAG_BASE, key.userId)}__p_${pid}`;
}

function isMessage(raw: unknown): raw is QuickComposeThreadMessage {
  if (!raw || typeof raw !== 'object') return false;
  const m = raw as Partial<QuickComposeThreadMessage>;
  return (
    typeof m.id === 'string' &&
    m.id.trim().length > 0 &&
    (m.role === 'user' || m.role === 'assistant') &&
    typeof m.timestamp === 'number'
  );
}

function normalizeArchiveThread(
  parsed: unknown,
  workspaceProjectId: string
): ProjectAgentThread | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const data = parsed as Partial<ProjectAgentThread>;
  const id = typeof data.id === 'string' ? data.id.trim() : '';
  const pid =
    typeof data.workspaceProjectId === 'string' && data.workspaceProjectId.trim()
      ? data.workspaceProjectId.trim()
      : workspaceProjectId.trim();
  if (!id || !pid) return null;
  const messages = (Array.isArray(data.messages) ? data.messages : []).filter(isMessage);
  const createdAt =
    typeof data.createdAt === 'number' && Number.isFinite(data.createdAt) ? data.createdAt : Date.now();
  const updatedAt =
    typeof data.updatedAt === 'number' && Number.isFinite(data.updatedAt) ? data.updatedAt : createdAt;
  return { id, workspaceProjectId: pid, messages, createdAt, updatedAt };
}

/** Persist a cleared/archived hot snapshot for later 「加载更早」. */
export function saveLocalThreadArchive(
  key: ProjectAgentThreadStoreKey,
  archived: ProjectAgentThread
): void {
  const pid = String(key.workspaceProjectId ?? '').trim();
  const threadId = String(archived?.id ?? '').trim();
  if (!pid || !threadId) return;
  if (!Array.isArray(archived.messages) || archived.messages.length === 0) return;

  try {
    writeLocalJson(archiveBodyKey(key, threadId), {
      id: archived.id,
      workspaceProjectId: pid,
      messages: archived.messages,
      createdAt: archived.createdAt,
      updatedAt: archived.updatedAt,
    });

    const prev = listLocalThreadArchives(key);
    const nextItems: LocalThreadArchiveMeta[] = [
      {
        threadId,
        archivedAt: Date.now(),
        messageCount: archived.messages.length,
        createdAt: archived.createdAt,
        updatedAt: archived.updatedAt,
      },
      ...prev.filter((x) => x.threadId !== threadId),
    ].slice(0, PROJECT_AGENT_LOCAL_ARCHIVE_MAX);

    // Drop bodies that fell out of the ring
    const keep = new Set(nextItems.map((x) => x.threadId));
    for (const old of prev) {
      if (keep.has(old.threadId)) continue;
      try {
        removeLocalKey(archiveBodyKey(key, old.threadId));
      } catch {
        /* ignore */
      }
    }

    const index: LocalArchiveIndex = { workspaceProjectId: pid, items: nextItems };
    writeLocalJson(archiveIndexKey(key), index);
  } catch {
    /* best-effort */
  }
}

export function listLocalThreadArchives(key: ProjectAgentThreadStoreKey): LocalThreadArchiveMeta[] {
  try {
    const pid = String(key.workspaceProjectId ?? '').trim();
    if (!pid) return [];
    return readLocalJson<LocalThreadArchiveMeta[]>(archiveIndexKey(key), [], (parsed) => {
      if (!parsed || typeof parsed !== 'object') return [];
      const data = parsed as Partial<LocalArchiveIndex>;
      if (!Array.isArray(data.items)) return [];
      return data.items
        .filter(
          (x): x is LocalThreadArchiveMeta =>
            !!x &&
            typeof x === 'object' &&
            typeof (x as LocalThreadArchiveMeta).threadId === 'string' &&
            Boolean(String((x as LocalThreadArchiveMeta).threadId).trim())
        )
        .map((x) => ({
          threadId: String(x.threadId).trim(),
          archivedAt: Number(x.archivedAt) || 0,
          messageCount: Number(x.messageCount) || 0,
          createdAt: Number(x.createdAt) || 0,
          updatedAt: Number(x.updatedAt) || 0,
        }));
    });
  } catch {
    return [];
  }
}

export function loadLocalThreadArchive(
  key: ProjectAgentThreadStoreKey,
  threadId: string
): ProjectAgentThread | null {
  try {
    const tid = String(threadId ?? '').trim();
    const pid = String(key.workspaceProjectId ?? '').trim();
    if (!tid || !pid) return null;
    return readLocalJson<ProjectAgentThread | null>(archiveBodyKey(key, tid), null, (parsed) =>
      normalizeArchiveThread(parsed, pid)
    );
  } catch {
    return null;
  }
}

/** Stash messages dropped by hot-window / quota trim. */
export function stashColdOverflowMessages(
  key: ProjectAgentThreadStoreKey,
  dropped: QuickComposeThreadMessage[]
): void {
  if (!dropped.length) return;
  try {
    const pid = String(key.workspaceProjectId ?? '').trim();
    if (!pid) return;
    const existing = loadColdBagMessages(key);
    const byId = new Map<string, QuickComposeThreadMessage>();
    for (const m of existing) byId.set(m.id, m);
    for (const m of dropped) {
      if (!isMessage(m)) continue;
      byId.set(m.id, m);
    }
    const messages = [...byId.values()]
      .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
      .slice(-PROJECT_AGENT_COLD_BAG_MAX);
    const bag: ColdBag = { workspaceProjectId: pid, messages, updatedAt: Date.now() };
    writeLocalJson(coldBagKey(key), bag);
  } catch {
    /* best-effort */
  }
}

export function loadColdBagMessages(key: ProjectAgentThreadStoreKey): QuickComposeThreadMessage[] {
  try {
    const pid = String(key.workspaceProjectId ?? '').trim();
    if (!pid) return [];
    return readLocalJson<QuickComposeThreadMessage[]>(coldBagKey(key), [], (parsed) => {
      if (!parsed || typeof parsed !== 'object') return [];
      const data = parsed as Partial<ColdBag>;
      if (!Array.isArray(data.messages)) return [];
      return data.messages.filter(isMessage);
    });
  } catch {
    return [];
  }
}

/**
 * Diff before/after persist and stash messages that disappeared from hot.
 * Call from UI after save when lengths/ids diverge.
 */
export function stashMessagesDroppedFromHot(
  key: ProjectAgentThreadStoreKey,
  before: QuickComposeThreadMessage[],
  after: QuickComposeThreadMessage[]
): void {
  const kept = new Set(after.map((m) => m.id));
  const dropped = before.filter((m) => m?.id && !kept.has(m.id));
  stashColdOverflowMessages(key, dropped);
}

function collectFromLocalArchives(
  key: ProjectAgentThreadStoreKey,
  excludeIds: Set<string>
): QuickComposeThreadMessage[] {
  const out: QuickComposeThreadMessage[] = [];
  for (const meta of listLocalThreadArchives(key)) {
    const snap = loadLocalThreadArchive(key, meta.threadId);
    if (!snap) continue;
    for (const m of snap.messages) {
      if (!m?.id || excludeIds.has(m.id)) continue;
      out.push(m);
      excludeIds.add(m.id);
    }
  }
  return out;
}

/**
 * List earlier messages available locally (archives + cold bag), not already in hot.
 * Prefer compaction-covered ids when present (ordering hint only).
 */
export function listEarlierMessagesLocal(
  key: ProjectAgentThreadStoreKey,
  hot: ProjectAgentThread
): QuickComposeThreadMessage[] {
  const hotIds = new Set((hot.messages ?? []).map((m) => m.id).filter(Boolean));
  const seen = new Set(hotIds);
  const fromArchives = collectFromLocalArchives(key, seen);
  const fromCold = loadColdBagMessages(key).filter((m) => m?.id && !seen.has(m.id));
  for (const m of fromCold) seen.add(m.id);

  let candidates = [...fromArchives, ...fromCold];
  let coveredSet: Set<string> | null = null;

  try {
    const compaction = loadProjectAgentCompaction(key);
    const covered = compaction?.coveredMessageIds ?? [];
    if (covered.length) {
      coveredSet = new Set(covered);
    }
  } catch {
    /* ignore */
  }

  return candidates.sort((a, b) => {
    if (coveredSet) {
      const ac = coveredSet.has(a.id) ? 0 : 1;
      const bc = coveredSet.has(b.id) ? 0 : 1;
      if (ac !== bc) return ac - bc;
    }
    return a.timestamp - b.timestamp || a.id.localeCompare(b.id);
  });
}

export function hasEarlierMessagesLocal(
  key: ProjectAgentThreadStoreKey,
  hot: ProjectAgentThread
): boolean {
  return listEarlierMessagesLocal(key, hot).length > 0;
}

/**
 * Optionally enrich local earlier set by pulling known archive threadIds from cloud.
 * Does not list R2 prefixes — only threadIds already in the local archive index.
 */
export async function fetchEarlierMessagesFromKnownArchives(
  key: ProjectAgentCloudSyncKey,
  hot: ProjectAgentThread
): Promise<QuickComposeThreadMessage[]> {
  const storeKey: ProjectAgentThreadStoreKey = {
    userId: key.userId,
    workspaceProjectId: key.workspaceProjectId,
  };
  const local = listEarlierMessagesLocal(storeKey, hot);
  const byId = new Map(local.map((m) => [m.id, m]));

  for (const meta of listLocalThreadArchives(storeKey)) {
    // If local body missing/empty, try cloud point-get
    const localBody = loadLocalThreadArchive(storeKey, meta.threadId);
    if (localBody && localBody.messages.length > 0) continue;
    try {
      const remote = await pullProjectAgentThreadArchive(key, meta.threadId);
      if (!remote?.messages?.length) continue;
      // Cache locally for next time
      saveLocalThreadArchive(storeKey, remote);
      for (const m of remote.messages) {
        if (!m?.id || byId.has(m.id)) continue;
        if ((hot.messages ?? []).some((h) => h.id === m.id)) continue;
        byId.set(m.id, m);
      }
    } catch {
      /* ignore per-archive failures */
    }
  }

  return [...byId.values()].sort(
    (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)
  );
}

/**
 * Merge earlier messages into hot: dedupe by id, sort by timestamp, apply hot-window + quota trim.
 */
export function mergeEarlierMessages(
  hot: ProjectAgentThread,
  earlier: QuickComposeThreadMessage[]
): ProjectAgentThread {
  const byId = new Map<string, QuickComposeThreadMessage>();
  for (const m of earlier) {
    if (!isMessage(m)) continue;
    byId.set(m.id, m);
  }
  for (const m of hot.messages ?? []) {
    if (!isMessage(m)) continue;
    byId.set(m.id, m); // hot wins on id collision
  }
  const messages = [...byId.values()].sort(
    (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)
  );
  const merged: ProjectAgentThread = {
    ...hot,
    messages: trimProjectAgentThreadMessages(messages),
    updatedAt: Date.now(),
  };
  return trimProjectAgentThreadForQuota(merged);
}

/**
 * Load earlier (local first) and merge into hot. Returns how many new ids were candidates
 * before trim (may be higher than what remains after hot window).
 */
export function loadEarlierMessagesIntoHot(
  key: ProjectAgentThreadStoreKey,
  hot: ProjectAgentThread
): { thread: ProjectAgentThread; candidateCount: number } {
  const earlier = listEarlierMessagesLocal(key, hot);
  const thread = mergeEarlierMessages(hot, earlier);
  return { thread, candidateCount: earlier.length };
}

/** @internal test helper */
export function __resetProjectAgentColdLoadForTests(key: ProjectAgentThreadStoreKey): void {
  try {
    const metas = listLocalThreadArchives(key);
    for (const m of metas) {
      removeLocalKey(archiveBodyKey(key, m.threadId));
    }
    removeLocalKey(archiveIndexKey(key));
    removeLocalKey(coldBagKey(key));
  } catch {
    /* ignore */
  }
}

export { PROJECT_AGENT_THREAD_MAX_MESSAGES };
