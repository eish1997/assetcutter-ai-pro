import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export type LocalProjectBundle = {
  assets: unknown[];
  pending: unknown[];
  capabilityRefs?: Array<{ kind: 'preset' | 'set'; id: string; snapshot?: unknown }>;
};

export type LocalProjectFileV1 = {
  format: 'assetcutter.local-project';
  version: 1;
  savedAt: number;
  projectId?: string;
  projectName?: string;
  bundle: LocalProjectBundle;
};

function assertAbsolutePath(pathRaw: string): string {
  const p = String(pathRaw || '').trim();
  if (!p) throw new Error('PROJECT_FILE_PATH_REQUIRED');
  if (!isAbsolute(p)) throw new Error('PROJECT_FILE_PATH_MUST_BE_ABSOLUTE');
  return resolve(p);
}

function sanitizeBundle(input: unknown): LocalProjectBundle {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const assets = Array.isArray(obj.assets) ? obj.assets : [];
  const pending = Array.isArray(obj.pending) ? obj.pending : [];
  const refsRaw = Array.isArray(obj.capabilityRefs) ? obj.capabilityRefs : [];
  const capabilityRefs = refsRaw
    .map((r) => {
      const kind = r && typeof r === 'object' && (r as { kind?: unknown }).kind === 'set' ? 'set' : 'preset';
      const id = String((r && typeof r === 'object' ? (r as { id?: unknown }).id : '') || '').trim();
      if (!id) return null;
      const snapshot = r && typeof r === 'object' && 'snapshot' in (r as Record<string, unknown>)
        ? (r as { snapshot?: unknown }).snapshot
        : undefined;
      return { kind, id, ...(snapshot !== undefined ? { snapshot } : {}) };
    })
    .filter((v): v is { kind: 'preset' | 'set'; id: string; snapshot?: unknown } => Boolean(v));
  return { assets, pending, ...(capabilityRefs.length ? { capabilityRefs } : {}) };
}

function parseProjectFile(raw: string): LocalProjectFileV1 {
  const parsed = JSON.parse(raw) as Partial<LocalProjectFileV1>;
  if (parsed.format !== 'assetcutter.local-project' || parsed.version !== 1) {
    throw new Error('PROJECT_FILE_FORMAT_UNSUPPORTED');
  }
  return {
    format: 'assetcutter.local-project',
    version: 1,
    savedAt: Number(parsed.savedAt || Date.now()),
    ...(parsed.projectId ? { projectId: String(parsed.projectId) } : {}),
    ...(parsed.projectName ? { projectName: String(parsed.projectName) } : {}),
    bundle: sanitizeBundle(parsed.bundle),
  };
}

export function saveProjectFile(input: {
  filePath: string;
  projectId?: string;
  projectName?: string;
  bundle: unknown;
}): { filePath: string; bytes: number; savedAt: number } {
  const filePath = assertAbsolutePath(input.filePath);
  const payload: LocalProjectFileV1 = {
    format: 'assetcutter.local-project',
    version: 1,
    savedAt: Date.now(),
    ...(input.projectId ? { projectId: String(input.projectId).trim() } : {}),
    ...(input.projectName ? { projectName: String(input.projectName).trim() } : {}),
    bundle: sanitizeBundle(input.bundle),
  };
  const text = JSON.stringify(payload, null, 2);
  const dir = dirname(filePath);
  if (!existsSync(dir)) throw new Error('PROJECT_FILE_DIR_NOT_FOUND');
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, filePath);
  return { filePath, bytes: Buffer.byteLength(text, 'utf8'), savedAt: payload.savedAt };
}

export function openProjectFile(input: { filePath: string }): { filePath: string; project: LocalProjectFileV1 } {
  const filePath = assertAbsolutePath(input.filePath);
  if (!existsSync(filePath)) throw new Error('PROJECT_FILE_NOT_FOUND');
  const raw = readFileSync(filePath, 'utf8');
  const project = parseProjectFile(raw);
  return { filePath, project };
}

