import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';

export type CustomHostTargetKind =
  | 'install_dir'
  | 'user_config_dir'
  | 'script_dir'
  | 'plugin_dir'
  | 'project_dir'
  | 'engine_dir'
  | 'unknown';

export type ManualTargetResolveResult = {
  ok: boolean;
  inputPath: string;
  resolvedPath?: string;
  targetKind?: CustomHostTargetKind;
  versionHint?: string;
  warnings?: string[];
  error?: string;
  message?: string;
};

export type CustomHostTarget = {
  id: string;
  label: string;
  inputPath: string;
  resolvedPath: string;
  targetKind: CustomHostTargetKind;
  versionHint?: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomHostTargetsStore = Record<string, CustomHostTarget[]>;

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function customTargetsPath(): string {
  return join(bridgesStateDir(), 'custom-host-targets.json');
}

function stableCustomTargetId(hostId: string, resolvedPath: string): string {
  return `custom::${hostId}::${resolve(resolvedPath)}`;
}

function parseJsonStringFragment(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

function recoverCustomHostTargetsFromCorruptJson(rawText: string): CustomHostTargetsStore {
  const out: CustomHostTargetsStore = {};
  const hostBlockRe = /"([^"]+)"\s*:\s*\[([\s\S]*?)(?=\n\s*\]\s*(?:,|\n\s*\}))/g;
  let hostMatch: RegExpExecArray | null;
  while ((hostMatch = hostBlockRe.exec(rawText))) {
    const hostId = hostMatch[1]!;
    const block = hostMatch[2] || '';
    const list: CustomHostTarget[] = [];
    const objectRe = /\{([\s\S]*?)\}/g;
    let objectMatch: RegExpExecArray | null;
    while ((objectMatch = objectRe.exec(block))) {
      const body = objectMatch[1] || '';
      const prop = (name: string): string => {
        const match = new RegExp(`"${name}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(body);
        return match ? parseJsonStringFragment(match[1] || '') : '';
      };
      const resolvedPath = prop('resolvedPath');
      if (!resolvedPath) continue;
      const inputPath = prop('inputPath') || resolvedPath;
      const versionHint = prop('versionHint') || undefined;
      const label = prop('label') || `${hostId} ${versionHint || basename(resolvedPath) || 'saved target'}`;
      const now = new Date(0).toISOString();
      list.push({
        id: prop('id') || stableCustomTargetId(hostId, resolvedPath),
        label,
        inputPath,
        resolvedPath: resolve(resolvedPath),
        targetKind: (prop('targetKind') as CustomHostTargetKind) || 'unknown',
        versionHint,
        createdAt: prop('createdAt') || now,
        updatedAt: prop('updatedAt') || prop('createdAt') || now,
      });
    }
    if (list.length) out[hostId] = list;
  }
  return out;
}

export function readCustomHostTargets(): CustomHostTargetsStore {
  const p = customTargetsPath();
  if (!existsSync(p)) return {};
  const text = readFileSync(p, 'utf8');
  try {
    const raw = JSON.parse(text) as CustomHostTargetsStore;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: CustomHostTargetsStore = {};
    for (const [hostId, list] of Object.entries(raw)) {
      if (!Array.isArray(list)) continue;
      out[hostId] = list
        .filter((item) => item && typeof item === 'object' && item.resolvedPath)
        .map((item) => ({
          id: String(item.id || stableCustomTargetId(hostId, item.resolvedPath)),
          label: String(item.label || item.resolvedPath),
          inputPath: String(item.inputPath || item.resolvedPath),
          resolvedPath: resolve(String(item.resolvedPath)),
          targetKind: item.targetKind || 'unknown',
          versionHint: item.versionHint ? String(item.versionHint) : undefined,
          createdAt: String(item.createdAt || item.updatedAt || new Date(0).toISOString()),
          updatedAt: String(item.updatedAt || item.createdAt || new Date(0).toISOString()),
        }));
    }
    return out;
  } catch {
    return recoverCustomHostTargetsFromCorruptJson(text);
  }
}

export function readCustomHostTargetsForHost(hostId: string): CustomHostTarget[] {
  return readCustomHostTargets()[hostId] || [];
}

export function upsertCustomHostTarget(
  hostId: string,
  target: Omit<CustomHostTarget, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; createdAt?: string; updatedAt?: string },
): CustomHostTarget {
  const store = readCustomHostTargets();
  const now = new Date().toISOString();
  const resolvedPath = resolve(target.resolvedPath);
  const id = target.id || stableCustomTargetId(hostId, resolvedPath);
  const list = store[hostId] || [];
  const existing = list.find((item) => item.id === id || resolve(item.resolvedPath) === resolvedPath);
  const next: CustomHostTarget = {
    id,
    label: target.label,
    inputPath: resolve(target.inputPath || resolvedPath),
    resolvedPath,
    targetKind: target.targetKind,
    versionHint: target.versionHint,
    createdAt: existing?.createdAt || target.createdAt || now,
    updatedAt: now,
  };
  const merged = existing ? list.map((item) => (item === existing ? next : item)) : list.concat(next);
  store[hostId] = merged.sort((a, b) => a.label.localeCompare(b.label));
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = customTargetsPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  renameSync(tmp, p);
  return next;
}
