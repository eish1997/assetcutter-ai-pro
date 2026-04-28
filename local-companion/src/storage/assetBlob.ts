import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { getAssetObjectPath, ensureProjectLayout, getProjectRoot } from './projectPaths.js';
import { readManifestOrEmpty, writeManifestSync } from './manifestIO.js';
import { assertSafeId, isSafeIdPart } from './safeIds.js';
import type { ManifestEntryV1, ProjectManifestV1 } from './manifestTypes.js';

const DEFAULT_MIME = 'application/octet-stream';

function upsertEntry(
  m: ProjectManifestV1,
  key: string,
  relPath: string,
  byteSize: number,
  mime: string,
): void {
  const now = Date.now();
  const idx = m.entries.findIndex((e) => e.key === key);
  const row: ManifestEntryV1 = {
    key,
    relPath,
    byteSize,
    tags: [],
    lineage: null,
    mime,
    updatedAt: now,
  };
  if (idx >= 0) m.entries[idx] = row;
  else m.entries.push(row);
}

export function putAsset(
  projectId: string,
  key: string,
  body: Buffer,
  contentType: string | undefined,
): { relPath: string; byteSize: number } {
  const pid = assertSafeId(projectId, 'projectId');
  const k = assertSafeId(key, 'key');
  ensureProjectLayout(pid);
  const { dir, objectFile, relPath } = getAssetObjectPath(pid, k);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(objectFile, body);
  const st = statSync(objectFile);
  const mime = (contentType && contentType.split(';')[0].trim()) || DEFAULT_MIME;
  const m = readManifestOrEmpty(pid);
  upsertEntry(m, k, relPath, st.size, mime);
  writeManifestSync(m);
  return { relPath, byteSize: st.size };
}

/** 供 ComputeAdapter 读取已落盘的 `assets/<key>/object`。 */
export function readAssetObjectBytes(
  projectId: string,
  key: string,
): { ok: true; body: Buffer } | { error: string; code: string } {
  const meta = getAssetMeta(projectId, key);
  if ('error' in meta) return { error: meta.error, code: meta.code };
  if (!meta.exists) return { error: 'object_missing', code: 'STORAGE_NOT_FOUND' };
  const { objectFile } = getAssetObjectPath(projectId, key);
  try {
    return { ok: true, body: readFileSync(objectFile) };
  } catch {
    return { error: 'read_failed', code: 'STORAGE_IO' };
  }
}

export function getAssetMeta(
  projectId: string,
  key: string,
):
  | { entry: ManifestEntryV1; exists: boolean; projectId: string }
  | { error: string; code: string } {
  try {
    const pid = assertSafeId(projectId, 'projectId');
    const k = assertSafeId(key, 'key');
    if (!existsSync(getProjectRoot(pid))) {
      return { error: 'project_not_found', code: 'STORAGE_NOT_FOUND' };
    }
    const m = readManifestOrEmpty(pid);
    const entry = m.entries.find((e) => e.key === k);
    if (!entry) return { error: 'asset_not_in_manifest', code: 'STORAGE_NOT_FOUND' };
    const { objectFile } = getAssetObjectPath(pid, k);
    return { entry, exists: existsSync(objectFile), projectId: pid };
  } catch {
    return { error: 'invalid_id', code: 'STORAGE_INVALID_ID' };
  }
}

export function deleteAsset(projectId: string, key: string): { ok: true } | { error: string; code: string } {
  try {
    const pid = assertSafeId(projectId, 'projectId');
    const k = assertSafeId(key, 'key');
    if (!existsSync(getProjectRoot(pid))) {
      return { error: 'project_not_found', code: 'STORAGE_NOT_FOUND' };
    }
    const m = readManifestOrEmpty(pid);
    const i = m.entries.findIndex((e) => e.key === k);
    if (i < 0) return { error: 'asset_not_in_manifest', code: 'STORAGE_NOT_FOUND' };
    const { dir, objectFile } = getAssetObjectPath(pid, k);
    if (existsSync(objectFile)) {
      try {
        rmSync(objectFile, { force: true });
      } catch {
        return { error: 'remove_failed', code: 'STORAGE_IO' };
      }
    }
    m.entries.splice(i, 1);
    if (existsSync(dir)) {
      try {
        const left = readdirOrEmpty(dir);
        if (left.length === 0) rmSync(dir, { recursive: true, force: true });
      } catch {
        /* 忽略 */
      }
    }
    writeManifestSync(m);
    return { ok: true };
  } catch {
    return { error: 'invalid_id', code: 'STORAGE_INVALID_ID' };
  }
}

function readdirOrEmpty(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function getManifestJson(
  projectId: string,
): { ok: true; body: ProjectManifestV1 } | { error: string; code: string } {
  if (!isSafeIdPart(projectId)) {
    return { error: 'invalid_id', code: 'STORAGE_INVALID_ID' };
  }
  if (!existsSync(getProjectRoot(projectId))) {
    return { error: 'project_not_found', code: 'STORAGE_NOT_FOUND' };
  }
  try {
    return { ok: true, body: readManifestOrEmpty(projectId) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'manifest_read_failed', code: 'STORAGE_IO' };
  }
}
