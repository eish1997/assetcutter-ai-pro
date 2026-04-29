import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { getAssetObjectPath, ensureProjectLayout, getProjectRoot } from './projectPaths.js';
import { readManifestOrEmpty, writeManifestSync } from './manifestIO.js';
import { assertSafeId, assertSafeWorkspaceFolderName, isSafeWorkspaceFolderName } from './safeIds.js';
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
  const pid = assertSafeWorkspaceFolderName(projectId, 'projectId');
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
    const pid = assertSafeWorkspaceFolderName(projectId, 'projectId');
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
    const pid = assertSafeWorkspaceFolderName(projectId, 'projectId');
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

function sniffMimeFromHead(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (buf.length >= 4 && buf[0] === 0x67 && buf[1] === 0x6c && buf[2] === 0x54 && buf[3] === 0x46) return 'model/gltf-binary';
  return 'application/octet-stream';
}

/**
 * 扫描 `assets/<key>/object`：若磁盘有对象文件但 manifest 无对应条目，则按文件大小与魔数补写 manifest。
 * 用于修复 manifest 与磁盘不一致（例如异常中断未写 manifest）。
 */
export function reconcileManifestOrphansFromDisk(
  projectId: string,
): { ok: true; added: number; keys: string[] } | { error: string; code: string } {
  try {
    const pid = assertSafeWorkspaceFolderName(projectId, 'projectId');
    if (!existsSync(getProjectRoot(pid))) {
      return { error: 'project_not_found', code: 'STORAGE_NOT_FOUND' };
    }
    const m = readManifestOrEmpty(pid);
    const existing = new Set(m.entries.map((e) => e.key));
    const assetsDir = join(getProjectRoot(pid), 'assets');
    if (!existsSync(assetsDir)) {
      return { ok: true, added: 0, keys: [] };
    }
    const addedKeys: string[] = [];
    for (const ent of readdirSync(assetsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      let key: string;
      try {
        key = assertSafeId(ent.name, 'key');
      } catch {
        continue;
      }
      if (existing.has(key)) continue;
      const { objectFile, relPath } = getAssetObjectPath(pid, key);
      if (!existsSync(objectFile)) continue;
      let size: number;
      try {
        size = statSync(objectFile).size;
      } catch {
        continue;
      }
      let mime = 'application/octet-stream';
      try {
        const fd = openSync(objectFile, 'r');
        try {
          const buf = Buffer.alloc(Math.min(512, Math.max(0, size)));
          const n = readSync(fd, buf, 0, buf.length, 0);
          if (n > 0) mime = sniffMimeFromHead(buf.subarray(0, n));
        } finally {
          closeSync(fd);
        }
      } catch {
        /* keep default mime */
      }
      upsertEntry(m, key, relPath, size, mime);
      existing.add(key);
      addedKeys.push(key);
    }
    if (addedKeys.length > 0) {
      writeManifestSync(m);
    }
    return { ok: true, added: addedKeys.length, keys: addedKeys };
  } catch {
    return { error: 'invalid_id', code: 'STORAGE_INVALID_ID' };
  }
}

export function getManifestJson(
  projectId: string,
): { ok: true; body: ProjectManifestV1 } | { error: string; code: string } {
  if (!isSafeWorkspaceFolderName(projectId)) {
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
