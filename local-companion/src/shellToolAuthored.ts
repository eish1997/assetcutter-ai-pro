/**
 * User-authored shell tools: drafts under shell-tools-authored/,
 * install-from-dir (no ZIP), pack for export/submit, fs.watch hot-reload.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { ensureRepositoryRoot } from './repositoryVolume.js';
import {
  assertSafeToolId,
  commitShellToolStagingPackage,
  installShellToolFromLocalDir,
  type ShellToolBundleManifest,
  uninstallShellTool,
} from './shellToolBundles.js';
import {
  TOOL_ID_PATTERN,
  validateShellToolPackageDir,
  type ShellToolPanelSpecV1,
  type ShellToolSpecV1,
} from './shellToolSpec.js';
import { collectDirFiles, writeStoreZipFile } from './shellToolZip.js';
import {
  createCapabilityPackageDraft,
  readCapabilityPackageDraft,
  updateCapabilityPackageDraft,
} from './capabilities/capabilityPackageStore.js';

export type ShellToolOrigin = 'authored' | 'catalog' | 'example' | 'import';
export type ShellToolReviewStatus = 'local' | 'pending' | 'approved' | 'rejected';

export type ShellToolAuthoredManifestExtras = {
  origin?: ShellToolOrigin;
  reviewStatus?: ShellToolReviewStatus;
  submissionId?: string;
  contentRev?: number;
  draftError?: string | null;
};

export type AuthoredToolSummary = {
  id: string;
  name: string;
  description: string;
  semver: string;
  tags?: string[];
  valid: boolean;
  error?: string;
  path: string;
};

export type AuthoredHotState = {
  toolId: string;
  contentRev: number;
  draftError: string | null;
  installed: boolean;
  watching: boolean;
};

type WatchEntry = {
  watcher: FSWatcher;
  timer: ReturnType<typeof setTimeout> | null;
  rev: number;
  draftError: string | null;
};

const HOT_RELOAD_DEBOUNCE_MS = 400;
const watchers = new Map<string, WatchEntry>();
const hotListeners = new Set<(state: AuthoredHotState) => void>();

export function getAuthoredRoot(): string {
  return join(ensureRepositoryRoot(), 'shell-tools-authored');
}

export function authoredToolDir(toolId: string): string {
  return join(getAuthoredRoot(), toolId);
}

function installedToolDir(toolId: string): string {
  return join(ensureRepositoryRoot(), 'shell-tools', toolId);
}

function installedExtractedDir(toolId: string): string {
  return join(installedToolDir(toolId), 'extracted');
}

function installedManifestPath(toolId: string): string {
  return join(installedToolDir(toolId), 'manifest.json');
}

function isPathInside(root: string, candidate: string): boolean {
  const r = resolve(root);
  const c = resolve(candidate);
  return c === r || c.startsWith(r + sep);
}

function assertSafeRelativePath(rel: string): string | null {
  const n = String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();
  if (!n || n.includes('..') || n.startsWith('/') || n.includes('\0')) return null;
  if (!/^[a-zA-Z0-9._\-/\u4e00-\u9fff]+$/.test(n) && !/^[a-zA-Z0-9._\-/]+$/.test(n)) {
    // Allow common package paths; reject obvious traversal
    if (n.includes('..')) return null;
  }
  if (n.includes('..')) return null;
  return n;
}

export function onAuthoredHotReload(listener: (state: AuthoredHotState) => void): () => void {
  hotListeners.add(listener);
  return () => hotListeners.delete(listener);
}

function emitHot(state: AuthoredHotState): void {
  for (const fn of hotListeners) {
    try {
      fn(state);
    } catch {
      /* ignore listener errors */
    }
  }
}

export function getAuthoredHotState(toolIdRaw: string): AuthoredHotState | null {
  const toolId = assertSafeToolId(toolIdRaw);
  if (!toolId) return null;
  const w = watchers.get(toolId);
  return {
    toolId,
    contentRev: w?.rev ?? readInstalledContentRev(toolId),
    draftError: w?.draftError ?? null,
    installed: existsSync(installedManifestPath(toolId)),
    watching: Boolean(w),
  };
}

function readInstalledContentRev(toolId: string): number {
  try {
    const raw = JSON.parse(readFileSync(installedManifestPath(toolId), 'utf8')) as ShellToolAuthoredManifestExtras;
    return typeof raw.contentRev === 'number' ? raw.contentRev : 0;
  } catch {
    return 0;
  }
}

async function patchInstalledManifest(
  toolId: string,
  patch: ShellToolAuthoredManifestExtras,
): Promise<void> {
  const p = installedManifestPath(toolId);
  if (!existsSync(p)) return;
  try {
    const cur = JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>;
    const next = { ...cur, ...patch };
    await writeFile(p, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}

export async function readInstalledOriginMeta(toolId: string): Promise<ShellToolAuthoredManifestExtras> {
  try {
    const raw = JSON.parse(await readFile(installedManifestPath(toolId), 'utf8')) as ShellToolAuthoredManifestExtras;
    return {
      origin: raw.origin,
      reviewStatus: raw.reviewStatus,
      submissionId: raw.submissionId,
      contentRev: raw.contentRev,
      draftError: raw.draftError ?? null,
    };
  } catch {
    return {};
  }
}

function scaffoldFiles(input: {
  id: string;
  name: string;
  description: string;
  tags?: string[];
}): { tool: ShellToolSpecV1; panel: ShellToolPanelSpecV1; script: string } {
  const tool: ShellToolSpecV1 = {
    schemaVersion: 1,
    id: input.id,
    name: input.name,
    description: input.description,
    semver: '0.1.0',
    launch: { kind: 'shell_module', module: 'module/panel.json' },
    run: {
      command: ['node', 'scripts/main.mjs'],
      cwd: '.',
      paramsMode: 'env',
      timeoutMs: 600000,
    },
    permissions: ['path.pick', 'tool.run'],
    tags: input.tags?.length ? input.tags : ['我的工具'],
    minCompanionSemver: '0.1.0',
  };
  const panel: ShellToolPanelSpecV1 = {
    schemaVersion: 1,
    title: input.name,
    sections: [
      {
        id: 'main',
        fields: [
          {
            type: 'text',
            id: 'note',
            label: '备注',
            default: '在 Copilot 里继续描述需求，保存后会自动刷新本窗口',
          },
        ],
      },
    ],
    actions: [{ id: 'run', label: '运行', kind: 'run', style: 'primary' }],
    outputs: [{ type: 'log', id: 'runLog', label: '运行日志' }],
  };
  const script = `#!/usr/bin/env node
/** Scaffold stub — replace via Copilot authored_upsert */
console.log('[${input.id}] ok');
if (process.env.SHELL_TOOL_PARAM_NOTE) {
  console.log('note=', process.env.SHELL_TOOL_PARAM_NOTE);
}
`;
  return { tool, panel, script };
}

function syncToolCapabilityDraft(input: {
  id: string;
  name: string;
  description: string;
  semver: string;
  tags?: string[];
  origin?: ShellToolOrigin;
}): void {
  const toolId = assertSafeToolId(input.id);
  if (!toolId) return;
  const manifest = {
    authoredToolId: toolId,
    authoredPath: authoredToolDir(toolId),
    origin: input.origin || 'authored',
  };
  const existing = readCapabilityPackageDraft(toolId);
  if (!existing) {
    createCapabilityPackageDraft({
      id: toolId,
      type: 'tool',
      name: input.name || toolId,
      description: input.description || '',
      tags: Array.isArray(input.tags) ? input.tags : undefined,
      semver: input.semver || '0.1.0',
      manifest,
      createdBy: 'local-shell',
    });
    return;
  }
  if (existing.type !== 'tool') return;
  updateCapabilityPackageDraft(toolId, (current) => ({
    ...current,
    name: input.name || current.name || toolId,
    description: input.description || current.description || '',
    tags: Array.isArray(input.tags) ? input.tags : current.tags,
    version: input.semver || current.version,
    manifest: {
      ...(current.manifest && typeof current.manifest === 'object' ? current.manifest : {}),
      ...manifest,
    },
  }));
}

export async function scaffoldAuthoredTool(input: {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
  overwrite?: boolean;
}): Promise<{ toolId: string; path: string }> {
  const toolId = assertSafeToolId(input.id);
  if (!toolId) throw new Error('invalid_tool_id');
  const dir = authoredToolDir(toolId);
  if (existsSync(join(dir, 'tool.json')) && !input.overwrite) {
    throw new Error('authored_exists');
  }
  const name = String(input.name || toolId).trim() || toolId;
  const description = String(input.description || '用户自建小工具').trim();
  const { tool, panel, script } = scaffoldFiles({
    id: toolId,
    name,
    description,
    tags: input.tags,
  });
  await mkdir(join(dir, 'module'), { recursive: true });
  await mkdir(join(dir, 'scripts'), { recursive: true });
  await writeFile(join(dir, 'tool.json'), `${JSON.stringify(tool, null, 2)}\n`, 'utf8');
  await writeFile(join(dir, 'module', 'panel.json'), `${JSON.stringify(panel, null, 2)}\n`, 'utf8');
  await writeFile(join(dir, 'scripts', 'main.mjs'), script, 'utf8');
  syncToolCapabilityDraft({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    semver: tool.semver,
    tags: tool.tags,
    origin: 'authored',
  });
  return { toolId, path: dir };
}

export async function upsertAuthoredFiles(input: {
  toolId: string;
  files: Array<{ path: string; content: string }>;
}): Promise<{ toolId: string; written: string[] }> {
  const toolId = assertSafeToolId(input.toolId);
  if (!toolId) throw new Error('invalid_tool_id');
  const root = authoredToolDir(toolId);
  await mkdir(root, { recursive: true });
  const written: string[] = [];
  for (const f of input.files || []) {
    const rel = assertSafeRelativePath(f.path);
    if (!rel) throw new Error(`invalid_path:${f.path}`);
    const abs = join(root, rel);
    if (!isPathInside(root, abs)) throw new Error(`invalid_path:${f.path}`);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, String(f.content ?? ''), 'utf8');
    written.push(rel);
  }
  ensureWatchingAuthored(toolId);
  // Immediate sync so Copilot upsert / tests don't wait on fs.watch debounce
  await syncAuthoredToInstalled(toolId);
  scheduleHotReload(toolId, HOT_RELOAD_DEBOUNCE_MS);
  return { toolId, written };
}

export async function listAuthoredTools(): Promise<AuthoredToolSummary[]> {
  const root = getAuthoredRoot();
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const out: AuthoredToolSummary[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const id = assertSafeToolId(name);
    if (!id) continue;
    const dir = authoredToolDir(id);
    if (!existsSync(join(dir, 'tool.json'))) continue;
    const v = validateShellToolPackageDir(dir);
    if (v.ok) {
      syncToolCapabilityDraft({
        id: v.tool.id,
        name: v.tool.name,
        description: v.tool.description,
        semver: v.tool.semver,
        tags: v.tool.tags,
        origin: 'authored',
      });
      out.push({
        id: v.tool.id,
        name: v.tool.name,
        description: v.tool.description,
        semver: v.tool.semver,
        tags: v.tool.tags,
        valid: true,
        path: dir,
      });
    } else {
      out.push({
        id,
        name: id,
        description: '',
        semver: '0.0.0',
        valid: false,
        error: v.error,
        path: dir,
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return out;
}

export async function deleteAuthoredTool(toolIdRaw: string): Promise<boolean> {
  const toolId = assertSafeToolId(toolIdRaw);
  if (!toolId) return false;
  stopWatchingAuthored(toolId);
  const dir = authoredToolDir(toolId);
  if (!existsSync(dir)) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}

export async function installAuthoredTool(
  toolIdRaw: string,
): Promise<{ toolId: string; manifest: ShellToolBundleManifest }> {
  const toolId = assertSafeToolId(toolIdRaw);
  if (!toolId) throw new Error('invalid_tool_id');
  const dir = authoredToolDir(toolId);
  if (!existsSync(join(dir, 'tool.json'))) throw new Error('authored_not_found');
  const validation = validateShellToolPackageDir(dir);
  if (!validation.ok) throw new Error(validation.error);
  const result = await installShellToolFromLocalDir(dir);
  syncToolCapabilityDraft({
    id: validation.tool.id,
    name: validation.tool.name,
    description: validation.tool.description,
    semver: validation.tool.semver,
    tags: validation.tool.tags,
    origin: 'authored',
  });
  const rev = (watchers.get(toolId)?.rev ?? 0) + 1;
  await patchInstalledManifest(toolId, {
    origin: 'authored',
    reviewStatus: 'local',
    contentRev: rev,
    draftError: null,
    sourceUrlHost: 'authored',
  } as ShellToolAuthoredManifestExtras & { sourceUrlHost?: string });
  // Also patch via read-modify for sourceUrlHost on full manifest
  try {
    const p = installedManifestPath(toolId);
    const cur = JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>;
    cur.origin = 'authored';
    cur.reviewStatus = 'local';
    cur.contentRev = rev;
    cur.draftError = null;
    cur.sourceUrlHost = 'authored';
    await writeFile(p, `${JSON.stringify(cur, null, 2)}\n`, 'utf8');
  } catch {
    /* ignore */
  }
  ensureWatchingAuthored(toolId);
  const w = watchers.get(toolId);
  if (w) {
    w.rev = rev;
    w.draftError = null;
  }
  emitHot(getAuthoredHotState(toolId)!);
  return result;
}

export async function packAuthoredTool(
  toolIdRaw: string,
  destZipPath?: string,
): Promise<{ toolId: string; zipPath: string; sha256: string; bytes: number; semver: string; fileName: string }> {
  const toolId = assertSafeToolId(toolIdRaw);
  if (!toolId) throw new Error('invalid_tool_id');
  const dir = authoredToolDir(toolId);
  if (!existsSync(join(dir, 'tool.json'))) throw new Error('authored_not_found');
  const v = validateShellToolPackageDir(dir);
  if (!v.ok) throw new Error(v.error);

  const outDir = destZipPath
    ? dirname(resolve(destZipPath))
    : join(ensureRepositoryRoot(), 'shell-tools-exports');
  await mkdir(outDir, { recursive: true });
  const fileName = `${v.tool.id}-${v.tool.semver}.zip`;
  const zipPath = destZipPath ? resolve(destZipPath) : join(outDir, fileName);
  if (destZipPath && !isPathInside(outDir, zipPath) && destZipPath) {
    // allow absolute dest provided by caller (export dialog) — still write there
  }

  const files = collectDirFiles(dir);
  const written = await writeStoreZipFile(zipPath, files);
  return {
    toolId,
    zipPath,
    sha256: written.sha256,
    bytes: written.bytes,
    semver: v.tool.semver,
    fileName,
  };
}

export async function importAuthoredFromZip(zipPathRaw: string): Promise<{
  toolId: string;
  manifest: ShellToolBundleManifest;
}> {
  const zipPath = resolve(String(zipPathRaw || '').trim());
  if (!zipPath || !existsSync(zipPath)) {
    throw new Error('zip_not_found');
  }
  const st = await import('node:fs').then((m) => m.statSync(zipPath));
  if (!st.isFile()) throw new Error('zip_not_found');
  const { extractZipToDirectory } = await import('./bundleInstallCore.js');
  const staging = join(getAuthoredRoot(), '.import-staging', randomUUID());
  await mkdir(staging, { recursive: true });
  try {
    await extractZipToDirectory(zipPath, staging);
    const v = validateShellToolPackageDir(staging);
    if (!v.ok) throw new Error(v.error);
    const toolId = v.tool.id;
    const dest = authoredToolDir(toolId);
    await rm(dest, { recursive: true, force: true }).catch(() => {});
    await mkdir(getAuthoredRoot(), { recursive: true });
    await cp(staging, dest, { recursive: true });
    const result = await installAuthoredTool(toolId);
    try {
      const p = installedManifestPath(toolId);
      const cur = JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>;
      cur.origin = 'import';
      cur.reviewStatus = 'local';
      await writeFile(p, `${JSON.stringify(cur, null, 2)}\n`, 'utf8');
    } catch {
      /* ignore */
    }
    syncToolCapabilityDraft({
      id: v.tool.id,
      name: v.tool.name,
      description: v.tool.description,
      semver: v.tool.semver,
      tags: v.tool.tags,
      origin: 'import',
    });
    return result;
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

async function syncAuthoredToInstalled(toolId: string): Promise<{ ok: boolean; error?: string; rev: number }> {
  const dir = authoredToolDir(toolId);
  const v = validateShellToolPackageDir(dir);
  const entry = watchers.get(toolId);
  const nextRev = (entry?.rev ?? readInstalledContentRev(toolId)) + 1;

  if (!v.ok) {
    if (entry) entry.draftError = v.error;
    await patchInstalledManifest(toolId, { draftError: v.error, contentRev: readInstalledContentRev(toolId) });
    emitHot({
      toolId,
      contentRev: entry?.rev ?? readInstalledContentRev(toolId),
      draftError: v.error,
      installed: existsSync(installedManifestPath(toolId)),
      watching: Boolean(entry),
    });
    return { ok: false, error: v.error, rev: entry?.rev ?? 0 };
  }

  if (!existsSync(installedManifestPath(toolId))) {
    syncToolCapabilityDraft({
      id: v.tool.id,
      name: v.tool.name,
      description: v.tool.description,
      semver: v.tool.semver,
      tags: v.tool.tags,
      origin: 'authored',
    });
    // Not installed yet — just update watch state
    if (entry) {
      entry.rev = nextRev;
      entry.draftError = null;
    }
    emitHot(getAuthoredHotState(toolId)!);
    return { ok: true, rev: nextRev };
  }

  const installRoot = join(ensureRepositoryRoot(), 'shell-tools', '.install-staging', randomUUID());
  const extractedRoot = join(installRoot, 'extracted');
  await mkdir(extractedRoot, { recursive: true });
  await cp(dir, extractedRoot, { recursive: true });
  await writeFile(join(installRoot, 'bundle.bin'), '', 'utf8');
  try {
    await commitShellToolStagingPackage({
      toolId,
      stagingDir: installRoot,
      manifest: {
        kind: 'shell_tool_bundle',
        semver: v.tool.semver,
        label: v.tool.name,
        sha256: '0'.repeat(64),
        bytes: 0,
        sourceUrlHost: 'authored',
        bundleFormat: 'zip',
        extractedRelativeDir: 'extracted',
      },
    });
    try {
      const p = installedManifestPath(toolId);
      const cur = JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>;
      cur.origin = cur.origin || 'authored';
      cur.reviewStatus = 'local';
      cur.contentRev = nextRev;
      cur.draftError = null;
      cur.sourceUrlHost = 'authored';
      await writeFile(p, `${JSON.stringify(cur, null, 2)}\n`, 'utf8');
    } catch {
      /* ignore */
    }
    if (entry) {
      entry.rev = nextRev;
      entry.draftError = null;
    }
    syncToolCapabilityDraft({
      id: v.tool.id,
      name: v.tool.name,
      description: v.tool.description,
      semver: v.tool.semver,
      tags: v.tool.tags,
      origin: 'authored',
    });
    emitHot(getAuthoredHotState(toolId)!);
    return { ok: true, rev: nextRev };
  } finally {
    await rm(installRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function scheduleHotReload(toolId: string, delayMs = HOT_RELOAD_DEBOUNCE_MS): void {
  const entry = watchers.get(toolId);
  if (!entry) {
    // Ensure watch exists for installed authored tools
    if (existsSync(authoredToolDir(toolId))) ensureWatchingAuthored(toolId);
  }
  const w = watchers.get(toolId);
  if (!w) return;
  if (w.timer) clearTimeout(w.timer);
  w.timer = setTimeout(() => {
    w.timer = null;
    void syncAuthoredToInstalled(toolId);
  }, delayMs);
}

export function ensureWatchingAuthored(toolIdRaw: string): boolean {
  const toolId = assertSafeToolId(toolIdRaw);
  if (!toolId) return false;
  const dir = authoredToolDir(toolId);
  if (!existsSync(dir)) return false;
  if (watchers.has(toolId)) return true;
  try {
    const watcher = watch(dir, { recursive: true }, () => {
      scheduleHotReload(toolId);
    });
    watcher.on('error', () => {
      /* Windows may emit errors; keep entry for manual schedule */
    });
    watchers.set(toolId, {
      watcher,
      timer: null,
      rev: readInstalledContentRev(toolId),
      draftError: null,
    });
    return true;
  } catch {
    return false;
  }
}

export function stopWatchingAuthored(toolIdRaw: string): void {
  const toolId = assertSafeToolId(toolIdRaw);
  if (!toolId) return;
  const w = watchers.get(toolId);
  if (!w) return;
  if (w.timer) clearTimeout(w.timer);
  try {
    w.watcher.close();
  } catch {
    /* ignore */
  }
  watchers.delete(toolId);
}

/** Start watches for all installed tools with origin=authored|import that still have drafts. */
export async function bootstrapAuthoredWatchers(): Promise<void> {
  const root = join(ensureRepositoryRoot(), 'shell-tools');
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    if (name.startsWith('.')) continue;
    const id = assertSafeToolId(name);
    if (!id) continue;
    try {
      const meta = JSON.parse(readFileSync(join(root, name, 'manifest.json'), 'utf8')) as {
        origin?: string;
      };
      if (meta.origin === 'authored' || meta.origin === 'import') {
        if (existsSync(authoredToolDir(id))) ensureWatchingAuthored(id);
      }
    } catch {
      /* ignore */
    }
  }
}

export async function uninstallAuthoredInstalled(toolIdRaw: string): Promise<boolean> {
  const toolId = assertSafeToolId(toolIdRaw);
  if (!toolId) return false;
  stopWatchingAuthored(toolId);
  return uninstallShellTool(toolId);
}

export { TOOL_ID_PATTERN };
