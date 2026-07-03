import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getVolumeProjectsDir } from './projectPaths.js';
import { isSafeWorkspaceFolderName, isWorkspaceTrashDirName } from './safeIds.js';

const WORKSPACE_META_FILE = 'workspace-meta.json';

type WorkspaceProjectMeta = {
  displayName: string;
  updatedAt: number;
};

function workspaceMetaPath(projectId: string): string {
  return join(projectDir(projectId), WORKSPACE_META_FILE);
}

function readWorkspaceProjectMeta(projectId: string): WorkspaceProjectMeta | null {
  const p = workspaceMetaPath(projectId);
  if (!existsSync(p)) return null;
  try {
    const o = JSON.parse(readFileSync(p, 'utf8')) as Partial<WorkspaceProjectMeta>;
    const displayName = normalizeProjectName(String(o.displayName || ''));
    if (!displayName) return null;
    return {
      displayName,
      updatedAt: Number(o.updatedAt || Date.now()),
    };
  } catch {
    return null;
  }
}

function writeWorkspaceProjectMeta(projectId: string, displayNameRaw: string): void {
  const displayName = normalizeProjectName(displayNameRaw);
  if (!displayName) throw new Error('WORKSPACE_PROJECT_NAME_REQUIRED');
  const payload: WorkspaceProjectMeta = {
    displayName,
    updatedAt: Date.now(),
  };
  const p = workspaceMetaPath(projectId);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  renameSync(tmp, p);
}

function resolveWorkspaceProjectDisplayName(projectId: string): string {
  return readWorkspaceProjectMeta(projectId)?.displayName || projectId;
}

export type WorkspaceProjectItem = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceTrashProjectItem = {
  trashId: string;
  originalId: string;
  deletedAt: number;
  byteSize: number;
};

function normalizeProjectName(input: string): string {
  const base = String(input || '').trim();
  if (!base) return '';
  return base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

function ensureWorkspaceRoot(): string {
  const root = getVolumeProjectsDir();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

function ensureTrashRoot(): string {
  const p = join(ensureWorkspaceRoot(), '.trash');
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
  return p;
}

function projectDir(name: string): string {
  return join(ensureWorkspaceRoot(), name);
}

function ensureProjectLayoutByName(name: string): void {
  const root = projectDir(name);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'assets'), { recursive: true });
  mkdirSync(join(root, 'scratch'), { recursive: true });
  mkdirSync(join(root, 'exports'), { recursive: true });
}

function writeProjectManifest(name: string): void {
  const root = projectDir(name);
  const p = join(root, 'manifest.json');
  const now = Date.now();
  const payload = {
    layoutVersion: 1,
    projectId: name,
    projectName: name,
    updatedAt: now,
    createdAt: existsSync(p) ? undefined : now,
    entries: [],
  };
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  renameSync(tmp, p);
}

export function listWorkspaceProjectsFromRepo(): WorkspaceProjectItem[] {
  const root = ensureWorkspaceRoot();
  const out: WorkspaceProjectItem[] = [];
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const name = dirent.name;
    if (name === '.trash') continue;
    if (!isSafeWorkspaceFolderName(name)) continue;
    try {
      const st = statSync(join(root, name));
      out.push({
        id: name,
        name: resolveWorkspaceProjectDisplayName(name),
        createdAt: Number(st.birthtimeMs || st.ctimeMs || Date.now()),
        updatedAt: Number(st.mtimeMs || Date.now()),
      });
    } catch {
      /* ignore one bad entry */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createWorkspaceProjectInRepo(nameRaw: string): WorkspaceProjectItem {
  const name = normalizeProjectName(nameRaw);
  if (!name) throw new Error('WORKSPACE_PROJECT_NAME_REQUIRED');
  if (!isSafeWorkspaceFolderName(name)) throw new Error('WORKSPACE_PROJECT_NAME_INVALID');
  const root = projectDir(name);
  if (existsSync(root)) throw new Error('WORKSPACE_PROJECT_ALREADY_EXISTS');
  ensureProjectLayoutByName(name);
  writeProjectManifest(name);
  writeWorkspaceProjectMeta(name, name);
  const st = statSync(root);
  return {
    id: name,
    name,
    createdAt: Number(st.birthtimeMs || st.ctimeMs || Date.now()),
    updatedAt: Number(st.mtimeMs || Date.now()),
  };
}

export function renameWorkspaceProjectInRepo(idRaw: string, nextNameRaw: string): WorkspaceProjectItem {
  const id = String(idRaw || '').trim();
  if (!id || !isSafeWorkspaceFolderName(id)) throw new Error('WORKSPACE_PROJECT_ID_INVALID');
  const nextName = normalizeProjectName(nextNameRaw);
  if (!nextName) throw new Error('WORKSPACE_PROJECT_NAME_REQUIRED');
  if (!isSafeWorkspaceFolderName(nextName)) throw new Error('WORKSPACE_PROJECT_NAME_INVALID');
  const dir = projectDir(id);
  if (!existsSync(dir)) throw new Error('WORKSPACE_PROJECT_NOT_FOUND');
  writeWorkspaceProjectMeta(id, nextName);
  const st = statSync(dir);
  const createdAt = Number(st.birthtimeMs || st.ctimeMs || Date.now());
  const meta = readWorkspaceProjectMeta(id);
  return {
    id,
    name: meta?.displayName || nextName,
    createdAt,
    updatedAt: Number(meta?.updatedAt || Date.now()),
  };
}

export function deleteWorkspaceProjectFromRepo(idRaw: string): { ok: true; id: string; recycledTo: string } {
  const id = String(idRaw || '').trim();
  if (!id || !isSafeWorkspaceFolderName(id)) throw new Error('WORKSPACE_PROJECT_ID_INVALID');
  const dir = projectDir(id);
  if (!existsSync(dir)) throw new Error('WORKSPACE_PROJECT_NOT_FOUND');
  const trashRoot = ensureTrashRoot();
  const recycledName = `${id}__${Date.now()}`;
  const recycledTo = join(trashRoot, recycledName);
  renameSync(dir, recycledTo);
  return { ok: true, id, recycledTo };
}

export function listWorkspaceTrashProjectsFromRepo(): WorkspaceTrashProjectItem[] {
  const trashRoot = ensureTrashRoot();
  const out: WorkspaceTrashProjectItem[] = [];
  for (const dirent of readdirSync(trashRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const trashId = dirent.name;
    if (!isWorkspaceTrashDirName(trashId)) continue;
    const i = trashId.lastIndexOf('__');
    if (i <= 0) continue;
    const originalId = trashId.slice(0, i);
    const tsRaw = trashId.slice(i + 2);
    const ts = Number(tsRaw);
    if (!originalId || !Number.isFinite(ts) || ts <= 0) continue;
    try {
      const st = statSync(join(trashRoot, trashId));
      out.push({
        trashId,
        originalId,
        deletedAt: ts,
        byteSize: Number(st.size || 0),
      });
    } catch {
      /* ignore bad entry */
    }
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

function pickRestoreName(originalId: string): string {
  let name = originalId;
  if (!existsSync(projectDir(name))) return name;
  let n = 1;
  while (n < 1000) {
    const next = `${originalId}__restored_${Date.now()}_${n}`;
    if (!existsSync(projectDir(next))) return next;
    n += 1;
  }
  throw new Error('WORKSPACE_TRASH_RESTORE_FAILED');
}

export function restoreWorkspaceProjectFromTrash(
  trashIdRaw: string,
): { ok: true; trashId: string; project: WorkspaceProjectItem; nameResolved: boolean } {
  const trashId = String(trashIdRaw || '').trim();
  if (!trashId || !isWorkspaceTrashDirName(trashId)) throw new Error('WORKSPACE_TRASH_ID_INVALID');
  const trashRoot = ensureTrashRoot();
  const from = join(trashRoot, trashId);
  if (!existsSync(from)) throw new Error('WORKSPACE_TRASH_NOT_FOUND');
  const i = trashId.lastIndexOf('__');
  if (i <= 0) throw new Error('WORKSPACE_TRASH_ID_INVALID');
  const originalId = trashId.slice(0, i);
  if (!originalId || !isSafeWorkspaceFolderName(originalId)) throw new Error('WORKSPACE_TRASH_ID_INVALID');
  const restoreName = pickRestoreName(originalId);
  const to = projectDir(restoreName);
  renameSync(from, to);
  ensureProjectLayoutByName(restoreName);
  writeProjectManifest(restoreName);
  const st = statSync(to);
  return {
    ok: true,
    trashId,
    nameResolved: restoreName !== originalId,
    project: {
      id: restoreName,
      name: resolveWorkspaceProjectDisplayName(restoreName),
      createdAt: Number(st.birthtimeMs || st.ctimeMs || Date.now()),
      updatedAt: Number(st.mtimeMs || Date.now()),
    },
  };
}

