import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';
import { readCustomHostTargetsForHost, upsertCustomHostTarget, type ManualTargetResolveResult } from './customHostTargets.js';
import { PYTHON_HTTP_STARTUP_TEMPLATE } from './templates/hostBridgeTemplates.js';

export const DEFAULT_BLENDER_BRIDGE_PORT = 7011;
export const BLENDER_BRIDGE_STARTUP_NAME = 'assetcutter_blender_bridge_startup.py';

export type BlenderBridgeVersion = {
  id: string;
  label: string;
  startupDir: string;
  startupPath: string;
  hasStartupBridge: boolean;
};

export type BlenderBridgeInstallRecord = {
  port: number;
  installedAt: string;
  startupDirs: string[];
  versionIds: string[];
};

export type BlenderBridgeStatus = {
  id: 'blender';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  versions: BlenderBridgeVersion[];
  install: BlenderBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type BlenderBridgeInstallBody = {
  versions?: string[];
  startupDirs?: string[];
  port?: number;
  home?: string;
};

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function installRecordPath(): string {
  return join(bridgesStateDir(), 'blender-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_BLENDER_BRIDGE_PORT;
}

export function discoverBlenderRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.BLENDER_USER_SCRIPTS?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  roots.push(resolve(join(home, 'AppData', 'Roaming', 'Blender Foundation', 'Blender')));
  roots.push(resolve(join(home, '.config', 'blender')));
  roots.push(resolve(join(home, 'Library', 'Application Support', 'Blender')));
  const out: string[] = [];
  for (const root of roots) {
    try {
      if (existsSync(root) && statSync(root).isDirectory() && !out.includes(root)) out.push(root);
    } catch {
      /* ignore */
    }
  }
  return out;
}

function versionFromStartupDir(startupDir: string, root: string): BlenderBridgeVersion {
  const resolvedDir = resolve(startupDir);
  const rel = resolvedDir.replace(/\\/g, '/');
  const m = rel.match(/\/blender\/([^/]+)\/scripts\/startup\/?$/i);
  const version = m ? m[1]! : resolvedDir === resolve(join(root, 'scripts', 'startup')) ? 'shared' : 'custom';
  return {
    id: `${version}::${resolvedDir}`,
    label: version === 'shared' ? 'Blender shared startup' : version === 'custom' ? `Blender (${resolvedDir})` : `Blender ${version}`,
    startupDir: resolvedDir,
    startupPath: join(resolvedDir, BLENDER_BRIDGE_STARTUP_NAME),
    hasStartupBridge: existsSync(join(resolvedDir, BLENDER_BRIDGE_STARTUP_NAME)),
  };
}

function blenderUserStartupDir(version: string, home = homedir()): string {
  return resolve(join(home, 'AppData', 'Roaming', 'Blender Foundation', 'Blender', version, 'scripts', 'startup'));
}

function normalizeManualStartupTarget(input: string, home = homedir()): ManualTargetResolveResult & { ok: true; resolvedPath: string } {
  const selected = resolve(String(input || '').trim());
  const normalized = selected.replace(/\\/g, '/');
  if (/\/scripts\/startup\/?$/i.test(normalized)) {
    const versionMatch = normalized.match(/\/Blender\/([^/]+)\/scripts\/startup\/?$/i);
    return { ok: true, inputPath: selected, resolvedPath: selected, targetKind: 'script_dir', versionHint: versionMatch?.[1] };
  }

  const installMatch = normalized.match(/\/Blender Foundation\/Blender\s+(\d+\.\d+)\/?$/i);
  if (installMatch && installMatch[1]) {
    return { ok: true, inputPath: selected, resolvedPath: blenderUserStartupDir(installMatch[1], home), targetKind: 'install_dir', versionHint: installMatch[1] };
  }

  const versionRootMatch = normalized.match(/\/Blender\/(\d+\.\d+)\/?$/i);
  if (versionRootMatch && versionRootMatch[1]) {
    return { ok: true, inputPath: selected, resolvedPath: resolve(join(selected, 'scripts', 'startup')), targetKind: 'user_config_dir', versionHint: versionRootMatch[1] };
  }

  return { ok: true, inputPath: selected, resolvedPath: selected, targetKind: 'unknown' };
}

function normalizeManualStartupDir(input: string, home = homedir()): string {
  return normalizeManualStartupTarget(input, home).resolvedPath;
}

export function discoverBlenderBridgeVersions(opts?: { home?: string; startupDirs?: string[] }): BlenderBridgeVersion[] {
  const roots = discoverBlenderRoots(opts?.home);
  const byDir = new Map<string, BlenderBridgeVersion>();
  for (const root of roots) {
    const shared = join(root, 'scripts', 'startup');
    if (existsSync(shared)) byDir.set(resolve(shared), versionFromStartupDir(shared, root));
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!/^\d+\.\d+$/.test(name)) continue;
      const versionRoot = join(root, name);
      try {
        if (!statSync(versionRoot).isDirectory()) continue;
      } catch {
        continue;
      }
      const startup = join(versionRoot, 'scripts', 'startup');
      byDir.set(resolve(startup), versionFromStartupDir(startup, root));
    }
  }
  for (const dirRaw of opts?.startupDirs || []) {
    const dir = normalizeManualStartupDir(String(dirRaw || '').trim(), opts?.home);
    if (!dir) continue;
    byDir.set(dir, versionFromStartupDir(dir, dir));
  }
  for (const custom of readCustomHostTargetsForHost('blender')) {
    const dir = normalizeManualStartupDir(custom.resolvedPath, opts?.home);
    if (!dir) continue;
    byDir.set(dir, versionFromStartupDir(dir, dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readBlenderBridgeInstallRecord(): BlenderBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as BlenderBridgeInstallRecord;
    return {
      port: normalizePort(raw.port),
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      startupDirs: Array.isArray(raw.startupDirs) ? raw.startupDirs.map(String) : [],
      versionIds: Array.isArray(raw.versionIds) ? raw.versionIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function writeBlenderBridgeInstallRecord(rec: BlenderBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearBlenderBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildBlenderStartupScript(port: number): string {
  return PYTHON_HTTP_STARTUP_TEMPLATE.generateInstallFiles({
    hostId: 'blender',
    hostName: 'Blender',
    port,
    entryFile: BLENDER_BRIDGE_STARTUP_NAME,
    pythonHealthVersionCode: 'import bpy\nversion = ".".join(str(x) for x in bpy.app.version)',
  })[0]!.contents;
}

async function probeBlenderBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `Blender bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean; version?: string } | null;
    return json && json.ok
      ? { ok: true, message: `Blender bridge connected${json.version ? ` (${json.version})` : ''}` }
      : { ok: false, message: 'Blender bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Blender bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getBlenderBridgeStatus(opts?: { home?: string; startupDirs?: string[] }): Promise<BlenderBridgeStatus> {
  const versions = discoverBlenderBridgeVersions(opts);
  const install = readBlenderBridgeInstallRecord();
  const port = install?.port || DEFAULT_BLENDER_BRIDGE_PORT;
  return {
    id: 'blender',
    name: 'Blender',
    description: 'One-click startup bridge using a local Blender Python HTTP probe.',
    defaultPort: DEFAULT_BLENDER_BRIDGE_PORT,
    port,
    roots: discoverBlenderRoots(opts?.home),
    versions,
    install,
    installed: versions.some((v) => v.hasStartupBridge) || Boolean(install?.startupDirs.length),
    probe: await probeBlenderBridge(port),
  };
}

function resolveInstallTargets(body: BlenderBridgeInstallBody, discovered: BlenderBridgeVersion[]): { targets: BlenderBridgeVersion[]; error?: string } {
  const targets: BlenderBridgeVersion[] = [];
  const byId = new Map(discovered.map((v) => [v.id, v]));
  if (Array.isArray(body.versions) && body.versions.length) {
    for (const id of body.versions) {
      const v = byId.get(String(id));
      if (v) targets.push(v);
    }
  }
  if (Array.isArray(body.startupDirs)) {
    for (const dir of body.startupDirs) {
      const startupDir = normalizeManualStartupDir(String(dir || '').trim(), body.home);
      if (!startupDir) continue;
      targets.push(versionFromStartupDir(startupDir, startupDir));
    }
  }
  const unique = Array.from(new Map(targets.map((v) => [v.startupDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_blender_startup_dir' };
  return { targets: unique };
}

export function installBlenderBridge(body: BlenderBridgeInstallBody = {}): { ok: true; port: number; installed: Array<{ versionId: string; startupDir: string; startupPath: string }>; message: string } | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverBlenderBridgeVersions({ home: body.home, startupDirs: body.startupDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return { ok: false, error: resolved.error || 'no_blender_startup_dir', message: 'No Blender startup folder was found. Choose a Blender scripts/startup folder manually.' };
  }
  const installed: Array<{ versionId: string; startupDir: string; startupPath: string }> = [];
  for (const target of resolved.targets) {
    try {
      mkdirSync(target.startupDir, { recursive: true });
      writeFileSync(target.startupPath, buildBlenderStartupScript(port), 'utf8');
      installed.push({ versionId: target.id, startupDir: target.startupDir, startupPath: target.startupPath });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const locked = /eperm|eacces|permission|operation not permitted/i.test(msg);
      return {
        ok: false,
        error: locked ? 'permission_denied' : 'install_failed',
        message: locked
          ? `无法写入 Blender 桥接文件：${target.startupDir}。请选择 Blender 用户脚本目录，或选择 Blender 安装目录让系统自动定位到用户目录。`
          : `Blender 桥接安装失败：${msg}`,
      };
    }
  }
  for (const dirRaw of body.startupDirs || []) {
    const manual = normalizeManualStartupTarget(String(dirRaw || '').trim(), body.home);
    const found = installed.find((item) => resolve(item.startupDir) === resolve(manual.resolvedPath));
    if (!found) continue;
    const version = versionFromStartupDir(manual.resolvedPath, manual.resolvedPath);
    upsertCustomHostTarget('blender', {
      label: version.label.replace(/^Blender \((.*)\)$/, 'Blender（手动添加）'),
      inputPath: String(dirRaw || '').trim(),
      resolvedPath: manual.resolvedPath,
      targetKind: manual.targetKind || 'unknown',
      versionHint: manual.versionHint,
    });
  }
  writeBlenderBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    startupDirs: installed.map((x) => x.startupDir),
    versionIds: installed.map((x) => x.versionId),
  });
  return {
    ok: true,
    port,
    installed,
    message: 'Blender bridge installed. Restart Blender, then probe connection.',
  };
}

export function uninstallBlenderBridge(body: { versions?: string[]; startupDirs?: string[] } = {}): { ok: true; removed: Array<{ startupDir: string; startupPath: string }> } {
  const hasExplicitDirs = Array.isArray(body.startupDirs) && body.startupDirs.length > 0;
  const discovered = hasExplicitDirs ? [] : discoverBlenderBridgeVersions();
  const explicit = hasExplicitDirs
    ? (body.startupDirs || []).map((dir) => versionFromStartupDir(normalizeManualStartupDir(dir), dir))
    : [];
  const record = readBlenderBridgeInstallRecord();
  const targets = new Map<string, BlenderBridgeVersion>();
  for (const v of explicit.concat(discovered)) {
    if (!body.versions || body.versions.length === 0 || body.versions.includes(v.id)) targets.set(v.startupDir, v);
  }
  for (const dir of record?.startupDirs || []) targets.set(resolve(dir), versionFromStartupDir(dir, dir));
  const removed: Array<{ startupDir: string; startupPath: string }> = [];
  for (const target of targets.values()) {
    if (!existsSync(target.startupPath)) continue;
    try {
      unlinkSync(target.startupPath);
      removed.push({ startupDir: target.startupDir, startupPath: target.startupPath });
    } catch {
      /* ignore */
    }
  }
  clearBlenderBridgeInstallRecord();
  return { ok: true, removed };
}
