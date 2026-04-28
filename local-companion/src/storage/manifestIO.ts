import { readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { getProjectManifestPath } from './projectPaths.js';
import { assertSafeId } from './safeIds.js';
import { LAYOUT_VERSION, type ProjectManifestV1, emptyManifest } from './manifestTypes.js';

function parseManifest(json: string, projectId: string): ProjectManifestV1 {
  const o = JSON.parse(json) as Partial<ProjectManifestV1>;
  if (o.layoutVersion !== LAYOUT_VERSION) {
    throw new Error('manifest_layout_mismatch');
  }
  if (o.projectId && o.projectId !== projectId) {
    throw new Error('manifest_project_mismatch');
  }
  if (!Array.isArray(o.entries)) o.entries = [];
  return {
    layoutVersion: LAYOUT_VERSION,
    projectId,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now(),
    entries: o.entries,
  };
}

export function readManifestOrEmpty(projectId: string): ProjectManifestV1 {
  const id = assertSafeId(projectId, 'projectId');
  const p = getProjectManifestPath(id);
  if (!existsSync(p)) return emptyManifest(id);
  return parseManifest(readFileSync(p, 'utf8'), id);
}

export function writeManifestSync(m: ProjectManifestV1): void {
  m.updatedAt = Date.now();
  const p = getProjectManifestPath(m.projectId);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(m, null, 2), 'utf8');
  renameSync(tmp, p);
}
