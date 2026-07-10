/**
 * Thread compaction v0 — Phase 4F (§18.5). Prefer no-LLM truncation summary.
 * Contract frozen: do not change exported signatures without main-session merge.
 */

import type { ProjectAgentCompaction } from '../../types/projectAgent';
import { readLocalJson, scopedStorageKey, writeLocalJson } from '../clientPersist';
import type { ProjectAgentThread, ProjectAgentThreadStoreKey } from './threadStore';

export type CompactionStoreKey = ProjectAgentThreadStoreKey;

/** Keep last K messages in hot assembly; older → summary. */
export const PROJECT_AGENT_COMPACTION_KEEP_RECENT = 16;

const COMPACTION_STORAGE_BASE = 'ac_project_agent_compaction_v1';
const SUMMARY_LINE_CHARS = 200;
const SUMMARY_TOTAL_CHARS = 4000;

function compactionStorageKey(key: CompactionStoreKey): string {
  const pid = String(key.workspaceProjectId ?? '').trim();
  if (!pid) throw new Error('workspaceProjectId is required');
  return `${scopedStorageKey(COMPACTION_STORAGE_BASE, key.userId)}__p_${pid}`;
}

function normalizeCompaction(
  parsed: unknown,
  workspaceProjectId: string
): ProjectAgentCompaction | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const data = parsed as Partial<ProjectAgentCompaction>;
  const pid =
    typeof data.workspaceProjectId === 'string' && data.workspaceProjectId.trim()
      ? data.workspaceProjectId.trim()
      : workspaceProjectId.trim();
  if (!pid) return null;
  const summaryText = typeof data.summaryText === 'string' ? data.summaryText : '';
  const coveredMessageIds = Array.isArray(data.coveredMessageIds)
    ? data.coveredMessageIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];
  const updatedAt =
    typeof data.updatedAt === 'number' && Number.isFinite(data.updatedAt) ? data.updatedAt : Date.now();
  return {
    workspaceProjectId: pid,
    summaryText,
    coveredMessageIds,
    updatedAt,
  };
}

function leanMessageLine(role: string, text: string, resultText?: string): string {
  const body = (typeof resultText === 'string' && resultText.trim() ? resultText : text)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SUMMARY_LINE_CHARS);
  return body ? `${role}: ${body}` : '';
}

function buildTruncationSummary(
  older: ProjectAgentThread['messages']
): { summaryText: string; coveredMessageIds: string[] } {
  const coveredMessageIds = older.map((m) => m.id).filter(Boolean);
  const lines: string[] = [];
  for (const m of older) {
    const line = leanMessageLine(m.role, m.text, m.resultText);
    if (line) lines.push(line);
  }
  let summaryText = lines.join('\n');
  if (summaryText.length > SUMMARY_TOTAL_CHARS) {
    summaryText = `${summaryText.slice(0, SUMMARY_TOTAL_CHARS)}…`;
  }
  if (!summaryText.trim() && coveredMessageIds.length > 0) {
    summaryText = `[compacted ${coveredMessageIds.length} earlier messages]`;
  }
  return { summaryText, coveredMessageIds };
}

export function loadProjectAgentCompaction(key: CompactionStoreKey): ProjectAgentCompaction | null {
  try {
    const pid = String(key.workspaceProjectId ?? '').trim();
    if (!pid) return null;
    const storageKey = compactionStorageKey(key);
    return readLocalJson<ProjectAgentCompaction | null>(storageKey, null, (parsed) =>
      normalizeCompaction(parsed, pid)
    );
  } catch {
    return null;
  }
}

export function saveProjectAgentCompaction(
  key: CompactionStoreKey,
  compaction: ProjectAgentCompaction
): void {
  const pid = String(key.workspaceProjectId ?? '').trim();
  if (!pid) throw new Error('workspaceProjectId is required');
  const normalized = normalizeCompaction(compaction, pid);
  if (!normalized) throw new Error('invalid compaction payload');
  writeLocalJson(compactionStorageKey(key), normalized);
}

/**
 * If thread exceeds keep-recent, build truncation summary of older messages.
 * No LLM in v0.
 */
export function maybeCompactProjectAgentThread(
  key: CompactionStoreKey,
  thread: ProjectAgentThread
): ProjectAgentCompaction | null {
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  if (messages.length <= PROJECT_AGENT_COMPACTION_KEEP_RECENT) {
    return loadProjectAgentCompaction(key);
  }
  const older = messages.slice(0, -PROJECT_AGENT_COMPACTION_KEEP_RECENT);
  const { summaryText, coveredMessageIds } = buildTruncationSummary(older);
  const compaction: ProjectAgentCompaction = {
    workspaceProjectId: String(thread.workspaceProjectId || key.workspaceProjectId).trim(),
    summaryText,
    coveredMessageIds,
    updatedAt: Date.now(),
  };
  try {
    saveProjectAgentCompaction(key, compaction);
  } catch {
    /* persist best-effort; still return in-memory compaction */
  }
  return compaction;
}
