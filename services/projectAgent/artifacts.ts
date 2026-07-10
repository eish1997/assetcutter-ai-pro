/**
 * Project Agent Artifacts (L2) — Phase 4D (§17 / P1c).
 * Contract frozen: do not change exported signatures without main-session merge.
 *
 * Local metadata only (clientPersist + scoped key). No media bytes / base64.
 */

import type { AgentArtifactDraft, ProjectAgentArtifact } from '../../types/projectAgent';
import { readLocalJson, removeLocalKey, scopedStorageKey, writeLocalJson } from '../clientPersist';

export type ArtifactStoreKey = {
  userId: string;
  workspaceProjectId: string;
};

const STORAGE_BASE = 'ac_project_agent_artifacts_v1';
const STORE_VERSION = 1 as const;

type ArtifactsPayload = {
  version: typeof STORE_VERSION;
  artifacts: ProjectAgentArtifact[];
};

/** Keys touched this session — for test reset. */
const knownStorageKeys = new Set<string>();

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

export function projectAgentArtifactStorageKey(key: ArtifactStoreKey): string {
  const pid = String(key.workspaceProjectId ?? '').trim();
  if (!pid) throw new Error('workspaceProjectId is required');
  const scoped = scopedStorageKey(STORAGE_BASE, key.userId);
  return `${scoped}__p_${pid}`;
}

/** Drop data-URL / base64-looking values from meta (P22 — no media bytes). */
function sanitizeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    const keyLower = k.toLowerCase();
    if (
      keyLower.includes('base64') ||
      keyLower === 'data' ||
      keyLower === 'bytes' ||
      keyLower === 'image' ||
      keyLower === 'previewimage' ||
      keyLower.endsWith('dataurl')
    ) {
      continue;
    }
    if (typeof v === 'string') {
      const t = v.trim();
      if (/^data:[^;]+;base64,/i.test(t)) continue;
      if (t.length > 8_000 && /^[A-Za-z0-9+/=\s]+$/.test(t)) continue;
      out[k] = v;
      continue;
    }
    if (v == null || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
      continue;
    }
    if (Array.isArray(v)) {
      out[k] = v.filter((item) => typeof item !== 'string' || !/^data:[^;]+;base64,/i.test(item));
      continue;
    }
    if (typeof v === 'object') {
      const nested = sanitizeMeta(v as Record<string, unknown>);
      if (nested && Object.keys(nested).length) out[k] = nested;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function loadPayload(key: ArtifactStoreKey): ProjectAgentArtifact[] {
  const sk = projectAgentArtifactStorageKey(key);
  knownStorageKeys.add(sk);
  const payload = readLocalJson<ArtifactsPayload | null>(sk, null, (parsed) => {
    if (!parsed || typeof parsed !== 'object') return null;
    const p = parsed as Partial<ArtifactsPayload>;
    if (!Array.isArray(p.artifacts)) return null;
    return { version: STORE_VERSION, artifacts: p.artifacts as ProjectAgentArtifact[] };
  });
  if (!payload?.artifacts?.length) return [];
  return payload.artifacts.filter((a) => a && typeof a.id === 'string' && a.id.trim());
}

function savePayload(key: ArtifactStoreKey, artifacts: ProjectAgentArtifact[]): void {
  const sk = projectAgentArtifactStorageKey(key);
  knownStorageKeys.add(sk);
  const payload: ArtifactsPayload = { version: STORE_VERSION, artifacts };
  writeLocalJson(sk, payload);
}

export function listProjectAgentArtifacts(key: ArtifactStoreKey): ProjectAgentArtifact[] {
  return loadPayload(key).slice().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function getProjectAgentArtifact(
  key: ArtifactStoreKey,
  artifactId: string
): ProjectAgentArtifact | null {
  const id = String(artifactId ?? '').trim();
  if (!id) return null;
  return loadPayload(key).find((a) => a.id === id) ?? null;
}

/** Persist draft → returns artifact id. No media bytes. */
export function emitProjectAgentArtifact(
  key: ArtifactStoreKey,
  draft: AgentArtifactDraft & { expertId?: string; sourceTurnId?: string }
): string {
  const kind = String(draft?.kind ?? '').trim() || 'text';
  const text = typeof draft.text === 'string' ? draft.text : undefined;
  const meta = sanitizeMeta(draft.meta);
  const id = genId();
  const artifact: ProjectAgentArtifact = {
    id,
    workspaceProjectId: String(key.workspaceProjectId ?? '').trim(),
    kind,
    createdAt: Date.now(),
    ...(text !== undefined ? { text } : {}),
    ...(meta ? { meta } : {}),
    ...(typeof draft.expertId === 'string' && draft.expertId.trim()
      ? { expertId: draft.expertId.trim() }
      : {}),
    ...(typeof draft.sourceTurnId === 'string' && draft.sourceTurnId.trim()
      ? { sourceTurnId: draft.sourceTurnId.trim() }
      : {}),
  };
  const list = loadPayload(key);
  list.push(artifact);
  savePayload(key, list);
  return id;
}

/**
 * Minimal try-run helper (P1c): return text suitable for quick compose.
 * Full canvas try-run is left to merge. Does not auto-inject into inference (P12).
 */
export function tryRunArtifactAsPrompt(
  key: ArtifactStoreKey,
  artifactId: string
): { ok: true; text: string; artifactId: string } | { ok: false; errorMessage: string } {
  const art = getProjectAgentArtifact(key, artifactId);
  if (!art) return { ok: false, errorMessage: 'artifact_not_found' };
  const text = artifactTextForQuickCompose(art);
  if (!text.trim()) return { ok: false, errorMessage: 'artifact_empty' };
  return { ok: true, text, artifactId: art.id };
}

/** Extract prompt text from an artifact (text preferred, then meta.instruction / meta.prompt). */
export function artifactTextForQuickCompose(artifact: ProjectAgentArtifact): string {
  if (typeof artifact.text === 'string' && artifact.text.trim()) return artifact.text.trim();
  const meta = artifact.meta;
  if (meta && typeof meta === 'object') {
    for (const k of ['instruction', 'prompt', 'text'] as const) {
      const v = meta[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return '';
}

export function __resetProjectAgentArtifactsForTests(): void {
  for (const sk of knownStorageKeys) {
    removeLocalKey(sk);
  }
  knownStorageKeys.clear();
}
