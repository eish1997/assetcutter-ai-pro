import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';
import { assertSafeAssetKey, assertSafeId, assertSafeWorkspaceFolderName, isSafeWorkspaceFolderName } from './safeIds.js';

const MANIFEST_NAME = 'manifest.json';

export function getVolumeProjectsDir(): string {
  return join(getRepositoryRoot(), 'projects');
}

export function getProjectRoot(projectId: string): string {
  const id = assertSafeWorkspaceFolderName(projectId, 'projectId');
  return join(getVolumeProjectsDir(), id);
}

export function getProjectManifestPath(projectId: string): string {
  return join(getProjectRoot(projectId), MANIFEST_NAME);
}

export function getAssetObjectPath(projectId: string, key: string): { dir: string; objectFile: string; relPath: string } {
  const k = assertSafeAssetKey(key, 'key');
  const parts = k.split('/');
  if (parts.length === 2) {
    const dir = join(getProjectRoot(projectId), 'assets', parts[0]!);
    const objectFile = join(dir, parts[1]!);
    const relPath = `assets/${parts[0]}/${parts[1]}`.replace(/\\/g, '/');
    return { dir, objectFile, relPath };
  }
  const dir = join(getProjectRoot(projectId), 'assets', k);
  const objectFile = join(dir, 'object');
  const relPath = `assets/${k}/object`.replace(/\\/g, '/');
  return { dir, objectFile, relPath };
}

export function getAssetVisibleObjectPath(
  projectId: string,
  key: string,
  filename: string,
): { dir: string; visibleFile: string; visibleRelPath: string } {
  const k = assertSafeAssetKey(key, 'key');
  const safeFilename = assertSafeId(filename, 'filename');
  const parts = k.split('/');
  if (parts.length === 2) {
    const dir = join(getProjectRoot(projectId), 'assets', parts[0]!);
    const visibleFile = join(dir, parts[1]!);
    const visibleRelPath = `assets/${parts[0]}/${parts[1]}`.replace(/\\/g, '/');
    return { dir, visibleFile, visibleRelPath };
  }
  const dir = join(getProjectRoot(projectId), 'assets', k);
  const visibleFile = join(dir, safeFilename);
  const visibleRelPath = `assets/${k}/${safeFilename}`.replace(/\\/g, '/');
  return { dir, visibleFile, visibleRelPath };
}

export function ensureProjectLayout(projectId: string): void {
  const root = getProjectRoot(projectId);
  if (!existsSync(root)) {
    mkdirSync(join(root, 'assets'), { recursive: true });
    mkdirSync(join(root, 'scratch'), { recursive: true });
  }
}

/** 列出已有 projectId（目录名经工作区安全校验的才计入） */
export function listProjectIds(): string[] {
  const base = getVolumeProjectsDir();
  if (!existsSync(base)) return [];
  const out: string[] = [];
  for (const name of readdirSync(base, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    if (isSafeWorkspaceFolderName(name.name)) out.push(name.name);
  }
  return out.sort();
}
