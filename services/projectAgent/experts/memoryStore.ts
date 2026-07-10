/**
 * Expert MemoryStore — Phase 4B (§17.2 / §17.9).
 * Contract frozen: do not change exported signatures without main-session merge.
 */

import type {
  ExpertId,
  ExpertMemoryEntry,
  ExpertMemoryScope,
} from '../../../types/projectAgent';
import {
  readLocalJson,
  removeLocalKey,
  scopedStorageKey,
  writeLocalJson,
} from '../../clientPersist';

export type ExpertMemoryStoreKey = ExpertMemoryScope;

/** Default inject budget ≈ 2k tokens equivalent chars (§17.3). */
export const EXPERT_MEMORY_INJECT_CHAR_BUDGET = 2000;

/** Soft cap per scope (§17.10). */
const MAX_ENTRIES_PER_SCOPE = 100;

/** Reject absurdly long single entries (§17.10). */
const MAX_ENTRY_TEXT_CHARS = 4000;

const STORAGE_BASE = 'ac_expert_memory_v1';
const STORE_VERSION = 1 as const;

export type RetrieveExpertMemoryOptions = {
  scope: ExpertMemoryStoreKey;
  /** Max entries before budget trim */
  limit?: number;
  /** Optional keyword filter */
  query?: string;
  charBudget?: number;
};

export type RetrieveExpertMemoryResult = {
  entries: ExpertMemoryEntry[];
  truncated: boolean;
  memoryIdsInjected: string[];
};

type PersistedBlob = {
  version: typeof STORE_VERSION;
  entries: ExpertMemoryEntry[];
};

/** In-memory mirror; cleared by `__resetExpertMemoryStoreForTests` (reload simulation). */
const memoryCache = new Map<string, ExpertMemoryEntry[]>();

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `em-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function looksLikeMediaOrBase64(text: string): boolean {
  const t = text.trim();
  if (/^data:/i.test(t)) return true;
  if (/;base64,/i.test(t)) return true;
  return false;
}

export function expertMemoryStorageKey(scope: ExpertMemoryStoreKey): string {
  const userId = String(scope.userId ?? '').trim();
  const expertId = String(scope.expertId ?? '').trim();
  if (!expertId) throw new Error('expertId is required');
  const scoped = scopedStorageKey(STORAGE_BASE, userId || null);
  const pid = String(scope.workspaceProjectId ?? '').trim();
  return pid ? `${scoped}__e_${expertId}__p_${pid}` : `${scoped}__e_${expertId}`;
}

function normalizeEntry(raw: unknown): ExpertMemoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Partial<ExpertMemoryEntry>;
  const id = typeof e.id === 'string' ? e.id.trim() : '';
  if (!id) return null;
  const scope = e.scope;
  if (!scope || typeof scope !== 'object') return null;
  const expertId = typeof scope.expertId === 'string' ? scope.expertId.trim() : '';
  const userId = typeof scope.userId === 'string' ? scope.userId.trim() : '';
  if (!expertId) return null;
  const kind =
    e.kind === 'preference' || e.kind === 'rejection' || e.kind === 'summary' || e.kind === 'pointer'
      ? e.kind
      : null;
  if (!kind) return null;
  const text = typeof e.text === 'string' ? e.text : '';
  const createdAt =
    typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) ? e.createdAt : Date.now();
  const workspaceProjectId =
    typeof scope.workspaceProjectId === 'string' && scope.workspaceProjectId.trim()
      ? scope.workspaceProjectId.trim()
      : undefined;
  const entry: ExpertMemoryEntry = {
    id,
    scope: { userId, expertId, ...(workspaceProjectId ? { workspaceProjectId } : {}) },
    kind,
    text,
    createdAt,
  };
  if (e.pointer && typeof e.pointer === 'object') {
    const p = e.pointer as { type?: string; id?: string };
    if (
      (p.type === 'artifact' || p.type === 'preset' || p.type === 'asset') &&
      typeof p.id === 'string' &&
      p.id.trim()
    ) {
      entry.pointer = { type: p.type, id: p.id.trim() };
    }
  }
  if (typeof e.sourceTurnId === 'string' && e.sourceTurnId.trim()) {
    entry.sourceTurnId = e.sourceTurnId.trim();
  }
  if (typeof e.deletedAt === 'number' && Number.isFinite(e.deletedAt)) {
    entry.deletedAt = e.deletedAt;
  }
  return entry;
}

function loadEntries(scope: ExpertMemoryStoreKey): ExpertMemoryEntry[] {
  const key = expertMemoryStorageKey(scope);
  const cached = memoryCache.get(key);
  if (cached) return cached;

  const blob = readLocalJson<PersistedBlob | null>(key, null, (parsed) => {
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as { version?: unknown; entries?: unknown };
    if (!Array.isArray(o.entries)) return null;
    const entries = o.entries.map(normalizeEntry).filter((e): e is ExpertMemoryEntry => e != null);
    return { version: STORE_VERSION, entries };
  });

  const entries = blob?.entries ?? [];
  memoryCache.set(key, entries);
  return entries;
}

function persistEntries(scope: ExpertMemoryStoreKey, entries: ExpertMemoryEntry[]): void {
  const key = expertMemoryStorageKey(scope);
  memoryCache.set(key, entries);
  writeLocalJson(key, { version: STORE_VERSION, entries } satisfies PersistedBlob);
}

function isActive(e: ExpertMemoryEntry): boolean {
  return e.deletedAt == null;
}

function sortNewestFirst(entries: ExpertMemoryEntry[]): ExpertMemoryEntry[] {
  return [...entries].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export function listExpertMemories(scope: ExpertMemoryStoreKey): ExpertMemoryEntry[] {
  return sortNewestFirst(loadEntries(scope).filter(isActive));
}

export function addExpertMemory(
  entry: Omit<ExpertMemoryEntry, 'id' | 'createdAt' | 'deletedAt'> & { id?: string }
): ExpertMemoryEntry {
  const text = typeof entry.text === 'string' ? entry.text.trim() : '';
  if (!text) throw new Error('experts/memoryStore: text is required');
  if (text.length > MAX_ENTRY_TEXT_CHARS) {
    throw new Error('experts/memoryStore: text exceeds max length');
  }
  if (looksLikeMediaOrBase64(text)) {
    throw new Error('experts/memoryStore: media/base64 text is forbidden');
  }

  const scope = entry.scope;
  const expertId = String(scope?.expertId ?? '').trim();
  const userId = String(scope?.userId ?? '').trim();
  if (!expertId) throw new Error('experts/memoryStore: expertId is required');

  const workspaceProjectId =
    typeof scope.workspaceProjectId === 'string' && scope.workspaceProjectId.trim()
      ? scope.workspaceProjectId.trim()
      : undefined;

  const now = Date.now();
  const created: ExpertMemoryEntry = {
    id: (typeof entry.id === 'string' && entry.id.trim()) || genId(),
    scope: { userId, expertId, ...(workspaceProjectId ? { workspaceProjectId } : {}) },
    kind: entry.kind,
    text,
    createdAt: now,
  };
  if (entry.pointer) created.pointer = entry.pointer;
  if (entry.sourceTurnId) created.sourceTurnId = entry.sourceTurnId;

  let entries = [...loadEntries(created.scope)];
  // Replace same id if re-adding
  entries = entries.filter((e) => e.id !== created.id);
  entries.push(created);

  // Soft-cap: soft-delete oldest active beyond MAX
  const active = sortNewestFirst(entries.filter(isActive));
  if (active.length > MAX_ENTRIES_PER_SCOPE) {
    const drop = new Set(active.slice(MAX_ENTRIES_PER_SCOPE).map((e) => e.id));
    entries = entries.map((e) => (drop.has(e.id) && isActive(e) ? { ...e, deletedAt: now } : e));
  }

  persistEntries(created.scope, entries);
  return created;
}

/** Soft-delete (sets deletedAt); no longer injected. */
export function deleteExpertMemory(scope: ExpertMemoryStoreKey, memoryId: string): boolean {
  const id = String(memoryId ?? '').trim();
  if (!id) return false;
  const entries = loadEntries(scope);
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) return false;
  const cur = entries[idx]!;
  if (cur.deletedAt != null) return false;
  const next = [...entries];
  next[idx] = { ...cur, deletedAt: Date.now() };
  persistEntries(scope, next);
  return true;
}

export function clearExpertMemories(scope: ExpertMemoryStoreKey): number {
  const entries = loadEntries(scope);
  const now = Date.now();
  let cleared = 0;
  const next = entries.map((e) => {
    if (e.deletedAt != null) return e;
    cleared += 1;
    return { ...e, deletedAt: now };
  });
  if (cleared > 0) persistEntries(scope, next);
  return cleared;
}

/** Retrieve for invoke — budget truncate + skip deleted. */
export function retrieveExpertMemoriesForInject(
  opts: RetrieveExpertMemoryOptions
): RetrieveExpertMemoryResult {
  const budget =
    typeof opts.charBudget === 'number' && Number.isFinite(opts.charBudget) && opts.charBudget >= 0
      ? opts.charBudget
      : EXPERT_MEMORY_INJECT_CHAR_BUDGET;

  let candidates = sortNewestFirst(loadEntries(opts.scope).filter(isActive));

  const q = typeof opts.query === 'string' ? opts.query.trim().toLowerCase() : '';
  if (q) {
    candidates = candidates.filter((e) => e.text.toLowerCase().includes(q));
  }

  const limit =
    typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit >= 0
      ? Math.floor(opts.limit)
      : undefined;

  let truncated = false;
  if (limit != null && candidates.length > limit) {
    candidates = candidates.slice(0, limit);
    truncated = true;
  }

  const selected: ExpertMemoryEntry[] = [];
  let used = 0;
  for (const entry of candidates) {
    const len = entry.text.length;
    if (used + len <= budget) {
      selected.push(entry);
      used += len;
      continue;
    }
    const remain = budget - used;
    if (remain > 0) {
      selected.push({ ...entry, text: entry.text.slice(0, remain) });
      used = budget;
    }
    truncated = true;
    break;
  }

  // More candidates existed beyond what we packed (when limit didn't already flag)
  if (!truncated && selected.length < candidates.length) {
    truncated = true;
  }

  return {
    entries: selected,
    truncated,
    memoryIdsInjected: selected.map((e) => e.id),
  };
}

/**
 * Test helper: wipe in-memory cache.
 * - no arg → clear all in-memory (localStorage kept — use for reload simulation)
 * - expertId → also removeLocalKey for cached keys of that expert
 */
export function __resetExpertMemoryStoreForTests(expertId?: ExpertId): void {
  const eid = expertId != null ? String(expertId).trim() : '';

  if (!eid) {
    memoryCache.clear();
    return;
  }

  const toRemove: string[] = [];
  for (const key of memoryCache.keys()) {
    if (key.includes(`__e_${eid}`)) toRemove.push(key);
  }
  for (const key of toRemove) {
    memoryCache.delete(key);
    removeLocalKey(key);
  }
}
