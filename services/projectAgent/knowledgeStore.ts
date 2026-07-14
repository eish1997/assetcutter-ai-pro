/**
 * Project Agent project knowledge store — Phase 3.
 * Short, user-confirmed text only. No media bytes and no silent writes.
 */

import type {
  ProjectAgentKnowledgeEntry,
  ProjectAgentKnowledgeKind,
  ProjectAgentKnowledgeScope,
} from '../../types/projectAgent';
import {
  readLocalJson,
  scopedStorageKey,
  writeLocalJson,
} from '../clientPersist';

export type ProjectAgentKnowledgeStoreKey = ProjectAgentKnowledgeScope;

export type AddProjectAgentKnowledgeInput = {
  scope: ProjectAgentKnowledgeStoreKey;
  kind: ProjectAgentKnowledgeKind;
  text: string;
  label?: string;
  sourceTurnId?: string;
  id?: string;
};

export type RetrieveProjectAgentKnowledgeOptions = {
  scope: ProjectAgentKnowledgeStoreKey;
  limit?: number;
  query?: string;
  charBudget?: number;
};

export type RetrieveProjectAgentKnowledgeResult = {
  entries: ProjectAgentKnowledgeEntry[];
  truncated: boolean;
  knowledgeIdsInjected: string[];
};

const STORAGE_BASE = 'ac_project_agent_knowledge_v1';
const STORE_VERSION = 1 as const;
const MAX_ENTRIES_PER_PROJECT = 120;
const MAX_ENTRY_TEXT_CHARS = 4000;
export const PROJECT_AGENT_KNOWLEDGE_INJECT_CHAR_BUDGET = 2400;

type PersistedBlob = {
  version: typeof STORE_VERSION;
  entries: ProjectAgentKnowledgeEntry[];
};

const cache = new Map<string, ProjectAgentKnowledgeEntry[]>();

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `pk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function looksLikeMediaOrBase64(text: string): boolean {
  const t = text.trim();
  if (/^data:/i.test(t)) return true;
  if (/;base64,/i.test(t)) return true;
  return /(?:^|[\s"'])[A-Za-z0-9+/]{160,}={0,2}(?=$|[\s"'])/.test(t);
}

function isKnowledgeKind(value: unknown): value is ProjectAgentKnowledgeKind {
  return (
    value === 'preference' ||
    value === 'brand_rule' ||
    value === 'workflow' ||
    value === 'style' ||
    value === 'note'
  );
}

export function projectAgentKnowledgeStorageKey(scope: ProjectAgentKnowledgeStoreKey): string {
  const userId = cleanText(scope.userId);
  const workspaceProjectId = cleanText(scope.workspaceProjectId);
  if (!workspaceProjectId) throw new Error('projectAgent/knowledgeStore: workspaceProjectId is required');
  return `${scopedStorageKey(STORAGE_BASE, userId || null)}__p_${workspaceProjectId}`;
}

function normalizeEntry(raw: unknown): ProjectAgentKnowledgeEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Partial<ProjectAgentKnowledgeEntry>;
  const id = cleanText(e.id);
  const scope = e.scope;
  const userId = cleanText(scope?.userId);
  const workspaceProjectId = cleanText(scope?.workspaceProjectId);
  const text = cleanText(e.text);
  if (!id || !workspaceProjectId || !text || !isKnowledgeKind(e.kind)) return null;
  const createdAt =
    typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) ? e.createdAt : Date.now();
  const out: ProjectAgentKnowledgeEntry = {
    id,
    scope: { userId, workspaceProjectId },
    kind: e.kind,
    text,
    createdAt,
  };
  const label = cleanText(e.label);
  if (label) out.label = label;
  const sourceTurnId = cleanText(e.sourceTurnId);
  if (sourceTurnId) out.sourceTurnId = sourceTurnId;
  if (typeof e.updatedAt === 'number' && Number.isFinite(e.updatedAt)) out.updatedAt = e.updatedAt;
  if (typeof e.disabledAt === 'number' && Number.isFinite(e.disabledAt)) out.disabledAt = e.disabledAt;
  if (typeof e.deletedAt === 'number' && Number.isFinite(e.deletedAt)) out.deletedAt = e.deletedAt;
  return out;
}

function loadEntries(scope: ProjectAgentKnowledgeStoreKey): ProjectAgentKnowledgeEntry[] {
  const key = projectAgentKnowledgeStorageKey(scope);
  const cached = cache.get(key);
  if (cached) return cached;
  const blob = readLocalJson<PersistedBlob | null>(key, null, (parsed) => {
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as { entries?: unknown };
    if (!Array.isArray(o.entries)) return null;
    return {
      version: STORE_VERSION,
      entries: o.entries.map(normalizeEntry).filter((e): e is ProjectAgentKnowledgeEntry => e != null),
    };
  });
  const entries = blob?.entries ?? [];
  cache.set(key, entries);
  return entries;
}

function persistEntries(scope: ProjectAgentKnowledgeStoreKey, entries: ProjectAgentKnowledgeEntry[]): void {
  const key = projectAgentKnowledgeStorageKey(scope);
  cache.set(key, entries);
  writeLocalJson(key, { version: STORE_VERSION, entries } satisfies PersistedBlob);
}

function isActive(entry: ProjectAgentKnowledgeEntry): boolean {
  return entry.deletedAt == null;
}

function isInjectable(entry: ProjectAgentKnowledgeEntry): boolean {
  return isActive(entry) && entry.disabledAt == null;
}

function newestFirst(entries: ProjectAgentKnowledgeEntry[]): ProjectAgentKnowledgeEntry[] {
  return [...entries].sort((a, b) => {
    const at = b.updatedAt ?? b.createdAt;
    const bt = a.updatedAt ?? a.createdAt;
    return at - bt || b.id.localeCompare(a.id);
  });
}

export function listProjectAgentKnowledge(scope: ProjectAgentKnowledgeStoreKey): ProjectAgentKnowledgeEntry[] {
  return newestFirst(loadEntries(scope).filter(isActive));
}

export function addProjectAgentKnowledge(input: AddProjectAgentKnowledgeInput): ProjectAgentKnowledgeEntry {
  const text = cleanText(input.text);
  if (!text) throw new Error('projectAgent/knowledgeStore: text is required');
  if (text.length > MAX_ENTRY_TEXT_CHARS) {
    throw new Error('projectAgent/knowledgeStore: text exceeds max length');
  }
  if (looksLikeMediaOrBase64(text)) {
    throw new Error('projectAgent/knowledgeStore: media/base64 text is forbidden');
  }
  const scope = {
    userId: cleanText(input.scope.userId),
    workspaceProjectId: cleanText(input.scope.workspaceProjectId),
  };
  if (!scope.workspaceProjectId) {
    throw new Error('projectAgent/knowledgeStore: workspaceProjectId is required');
  }
  const now = Date.now();
  const created: ProjectAgentKnowledgeEntry = {
    id: cleanText(input.id) || genId(),
    scope,
    kind: input.kind,
    text,
    createdAt: now,
    updatedAt: now,
  };
  const label = cleanText(input.label);
  if (label) created.label = label.slice(0, 80);
  const sourceTurnId = cleanText(input.sourceTurnId);
  if (sourceTurnId) created.sourceTurnId = sourceTurnId;

  let entries = loadEntries(scope).filter((e) => e.id !== created.id);
  entries.push(created);

  const active = newestFirst(entries.filter(isActive));
  if (active.length > MAX_ENTRIES_PER_PROJECT) {
    const drop = new Set(active.slice(MAX_ENTRIES_PER_PROJECT).map((e) => e.id));
    entries = entries.map((e) => (drop.has(e.id) && isActive(e) ? { ...e, deletedAt: now } : e));
  }
  persistEntries(scope, entries);
  return created;
}

export function setProjectAgentKnowledgeEnabled(
  scope: ProjectAgentKnowledgeStoreKey,
  knowledgeId: string,
  enabled: boolean
): boolean {
  const id = cleanText(knowledgeId);
  if (!id) return false;
  const entries = loadEntries(scope);
  const idx = entries.findIndex((e) => e.id === id && isActive(e));
  if (idx < 0) return false;
  const cur = entries[idx]!;
  const next = [...entries];
  next[idx] = enabled ? { ...cur, disabledAt: undefined, updatedAt: Date.now() } : { ...cur, disabledAt: Date.now(), updatedAt: Date.now() };
  persistEntries(scope, next);
  return true;
}

export function deleteProjectAgentKnowledge(
  scope: ProjectAgentKnowledgeStoreKey,
  knowledgeId: string
): boolean {
  const id = cleanText(knowledgeId);
  if (!id) return false;
  const entries = loadEntries(scope);
  const idx = entries.findIndex((e) => e.id === id && isActive(e));
  if (idx < 0) return false;
  const next = [...entries];
  next[idx] = { ...entries[idx]!, deletedAt: Date.now(), updatedAt: Date.now() };
  persistEntries(scope, next);
  return true;
}

export function retrieveProjectAgentKnowledgeForInject(
  opts: RetrieveProjectAgentKnowledgeOptions
): RetrieveProjectAgentKnowledgeResult {
  const budget =
    typeof opts.charBudget === 'number' && Number.isFinite(opts.charBudget) && opts.charBudget >= 0
      ? opts.charBudget
      : PROJECT_AGENT_KNOWLEDGE_INJECT_CHAR_BUDGET;
  let candidates = newestFirst(loadEntries(opts.scope).filter(isInjectable));
  const q = cleanText(opts.query).toLowerCase();
  if (q) candidates = candidates.filter((e) => e.text.toLowerCase().includes(q) || e.label?.toLowerCase().includes(q));
  const limit =
    typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit >= 0
      ? Math.floor(opts.limit)
      : undefined;
  let truncated = false;
  if (limit != null && candidates.length > limit) {
    candidates = candidates.slice(0, limit);
    truncated = true;
  }
  const selected: ProjectAgentKnowledgeEntry[] = [];
  let used = 0;
  for (const entry of candidates) {
    const cost = entry.text.length;
    if (used + cost > budget) {
      truncated = true;
      continue;
    }
    selected.push(entry);
    used += cost;
  }
  return {
    entries: selected,
    truncated,
    knowledgeIdsInjected: selected.map((e) => e.id),
  };
}

export function formatProjectAgentKnowledgeForContext(entries: ProjectAgentKnowledgeEntry[]): string {
  return entries
    .map((entry) => {
      const label = entry.label ? `${entry.label}: ` : '';
      return `- [${entry.kind}] ${label}${entry.text}`;
    })
    .join('\n');
}

export function __resetProjectAgentKnowledgeForTests(scope?: ProjectAgentKnowledgeStoreKey): void {
  if (!scope) {
    cache.clear();
    return;
  }
  cache.delete(projectAgentKnowledgeStorageKey(scope));
}
