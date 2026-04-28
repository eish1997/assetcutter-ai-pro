import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';
import { assertSafeId, isSafeIdPart } from './safeIds.js';

const MANIFEST_NAME = 'manifest.json';

export function getVolumeProjectsDir(): string {
  return join(getRepositoryRoot(), 'projects');
}

export function getProjectRoot(projectId: string): string {
  const id = assertSafeId(projectId, 'projectId');
  return join(getVolumeProjectsDir(), id);
}

export function getProjectManifestPath(projectId: string): string {
  return join(getProjectRoot(projectId), MANIFEST_NAME);
}

export function getAssetObjectPath(projectId: string, key: string): { dir: string; objectFile: string; relPath: string } {
  const k = assertSafeId(key, 'key');
  const dir = join(getProjectRoot(assertSafeId(projectId, 'projectId')), 'assets', k);
  const objectFile = join(dir, 'object');
  const relPath = `assets/${k}/object`.replace(/\\/g, '/');
  return { dir, objectFile, relPath };
}

export function ensureProjectLayout(projectId: string): void {
  const root = getProjectRoot(projectId);
  if (!existsSync(root)) {
    mkdirSync(join(root, 'assets'), { recursive: true });
    mkdirSync(join(root, 'scratch'), { recursive: true });
  }
}

/** 列出已有 projectId（目录名经 safe 校验的才计入） */
export function listProjectIds(): string[] {
  const base = getVolumeProjectsDir();
  if (!existsSync(base)) return [];
  const out: string[] = [];
  for (const name of readdirSync(base, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    if (isSafeIdPart(name.name)) out.push(name.name);
  }
  return out.sort();
}
