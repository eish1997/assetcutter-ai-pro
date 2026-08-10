import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';
import { LUA_HEARTBEAT_TEMPLATE } from './templates/hostBridgeTemplates.js';

export const DEFAULT_DARKTABLE_BRIDGE_PORT = 7611;
export const DARKTABLE_BRIDGE_SCRIPT_NAME = 'assetcutter_darktable_bridge.lua';
export const DARKTABLE_LUARC_NAME = 'luarc';
export const DARKTABLE_BRIDGE_MARKER_START = '-- ========== AssetCutter darktable Bridge ==========';
export const DARKTABLE_BRIDGE_MARKER_END = '-- ========== AssetCutter darktable Bridge end ==========';

export type DarktableBridgeTarget = {
  id: string;
  label: string;
  configDir: string;
  scriptsDir: string;
  luarcPath: string;
  scriptPath: string;
  hasLuarcMarker: boolean;
  hasScriptBridge: boolean;
};

export type DarktableBridgeInstallRecord = {
  port: number;
  installedAt: string;
  configDirs: string[];
  targetIds: string[];
};

export type DarktableBridgeStatus = {
  id: 'darktable';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: DarktableBridgeTarget[];
  install: DarktableBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type DarktableBridgeInstallBody = {
  targets?: string[];
  configDirs?: string[];
  scriptsDirs?: string[];
  port?: number;
  home?: string;
};

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function installRecordPath(): string {
  return join(bridgesStateDir(), 'darktable-install.json');
}

function heartbeatPath(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', 'darktable-heartbeat.json'));
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_DARKTABLE_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverDarktableRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.DARKTABLE_CONFIG_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.LOCALAPPDATA) roots.push(resolve(join(process.env.LOCALAPPDATA, 'darktable')));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'darktable')));
  roots.push(resolve(join(home, 'AppData', 'Local', 'darktable')));
  roots.push(resolve(join(home, '.config', 'darktable')));
  roots.push(resolve(join(home, 'Library', 'Preferences', 'darktable')));
  const out: string[] = [];
  for (const root of roots) {
    if (rootExists(root) && !out.includes(root)) out.push(root);
  }
  return out;
}

function readText(path: string): string {
  if (!existsSync(path)) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function stripMarkedBlock(content: string): string {
  const start = content.indexOf(DARKTABLE_BRIDGE_MARKER_START);
  if (start < 0) return content;
  const end = content.indexOf(DARKTABLE_BRIDGE_MARKER_END, start);
  if (end < 0) {
    return (content.slice(0, start) + content.slice(start + DARKTABLE_BRIDGE_MARKER_START.length)).replace(/\n{3,}/g, '\n\n');
  }
  const after = end + DARKTABLE_BRIDGE_MARKER_END.length;
  const next = (content.slice(0, start) + content.slice(after)).replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  return next ? next + '\n' : '';
}

function targetFromConfigDir(configDir: string): DarktableBridgeTarget {
  const resolvedDir = resolve(configDir);
  const scriptsDir = join(resolvedDir, 'lua');
  const luarcPath = join(resolvedDir, DARKTABLE_LUARC_NAME);
  const scriptPath = join(scriptsDir, DARKTABLE_BRIDGE_SCRIPT_NAME);
  const luarc = readText(luarcPath);
  return {
    id: `darktable::${resolvedDir}`,
    label: basename(resolvedDir) === 'darktable' ? 'darktable config' : `darktable (${resolvedDir})`,
    configDir: resolvedDir,
    scriptsDir,
    luarcPath,
    scriptPath,
    hasLuarcMarker: luarc.includes(DARKTABLE_BRIDGE_MARKER_START),
    hasScriptBridge: existsSync(scriptPath),
  };
}

export function discoverDarktableBridgeTargets(opts?: { home?: string; configDirs?: string[]; scriptsDirs?: string[] }): DarktableBridgeTarget[] {
  const byDir = new Map<string, DarktableBridgeTarget>();
  for (const root of discoverDarktableRoots(opts?.home)) byDir.set(resolve(root), targetFromConfigDir(root));
  for (const dirRaw of [...(opts?.configDirs || []), ...(opts?.scriptsDirs || [])]) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromConfigDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readDarktableBridgeInstallRecord(): DarktableBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as DarktableBridgeInstallRecord;
    return {
      port: normalizePort(raw.port),
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      configDirs: Array.isArray(raw.configDirs) ? raw.configDirs.map(String) : [],
      targetIds: Array.isArray(raw.targetIds) ? raw.targetIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function writeDarktableBridgeInstallRecord(rec: DarktableBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearDarktableBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function luaString(s: string): string {
  return JSON.stringify(s);
}

function buildDarktableBridgeScript(port: number): string {
  return LUA_HEARTBEAT_TEMPLATE.generateInstallFiles({
    hostId: 'darktable',
    hostName: 'darktable',
    port,
    entryFile: DARKTABLE_BRIDGE_SCRIPT_NAME,
    heartbeatFile: heartbeatPath(),
  })[0]!.contents;
}

function buildLuarcBlock(scriptPath: string): string {
  return `${DARKTABLE_BRIDGE_MARKER_START}
pcall(function()
  dofile(${luaString(scriptPath)})
end)
${DARKTABLE_BRIDGE_MARKER_END}
`;
}

async function probeDarktableBridge(): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath();
  if (!existsSync(p)) return { ok: false, message: 'darktable bridge heartbeat has not been seen yet. Start darktable with Lua enabled, then probe connection.', heartbeatPath: p };
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string };
    if (json.host !== 'darktable') return { ok: false, message: 'darktable bridge heartbeat is invalid.', heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `darktable bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `darktable bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getDarktableBridgeStatus(opts?: { home?: string; configDirs?: string[]; scriptsDirs?: string[] }): Promise<DarktableBridgeStatus> {
  const targets = discoverDarktableBridgeTargets(opts);
  const install = readDarktableBridgeInstallRecord();
  const port = install?.port || DEFAULT_DARKTABLE_BRIDGE_PORT;
  return {
    id: 'darktable',
    name: 'darktable',
    description: 'One-click luarc Lua bridge using a local heartbeat probe.',
    defaultPort: DEFAULT_DARKTABLE_BRIDGE_PORT,
    port,
    roots: discoverDarktableRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasLuarcMarker || v.hasScriptBridge) || Boolean(install?.configDirs.length),
    probe: await probeDarktableBridge(),
  };
}

function resolveInstallTargets(
  body: DarktableBridgeInstallBody,
  discovered: DarktableBridgeTarget[],
): { targets: DarktableBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: DarktableBridgeTarget[] = [];
  for (const targetId of body.targets || []) {
    const v = byId.get(String(targetId));
    if (v) targets.push(v);
  }
  for (const dirRaw of [...(body.configDirs || []), ...(body.scriptsDirs || [])]) {
    const configDir = resolve(String(dirRaw || '').trim());
    if (configDir) targets.push(targetFromConfigDir(configDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.configDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_darktable_config_dir' };
  return { targets: unique };
}

export function installDarktableBridge(
  body: DarktableBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; configDir: string; luarcPath: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverDarktableBridgeTargets({ home: body.home, configDirs: body.configDirs, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_darktable_config_dir',
      message: 'No darktable config folder was found. Choose the darktable config folder manually.',
    };
  }
  const installed: Array<{ targetId: string; configDir: string; luarcPath: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.configDir, { recursive: true });
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildDarktableBridgeScript(port), 'utf8');
    const existing = readText(target.luarcPath);
    const next = (stripMarkedBlock(existing).replace(/\s+$/, '') + '\n\n' + buildLuarcBlock(target.scriptPath)).replace(/^\s+/, '');
    const tmp = target.luarcPath + '.tmp';
    writeFileSync(tmp, next, 'utf8');
    renameSync(tmp, target.luarcPath);
    installed.push({ targetId: target.id, configDir: target.configDir, luarcPath: target.luarcPath, scriptPath: target.scriptPath });
  }
  writeDarktableBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    configDirs: installed.map((x) => x.configDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'darktable bridge installed. Start darktable with Lua enabled, then probe connection.' };
}

export function uninstallDarktableBridge(
  body: { targets?: string[]; configDirs?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ configDir: string; luarcPath: string; scriptPath: string; removed: boolean }> } {
  const discovered = discoverDarktableBridgeTargets({ configDirs: body.configDirs, scriptsDirs: body.scriptsDirs });
  const record = readDarktableBridgeInstallRecord();
  const targets = new Map<string, DarktableBridgeTarget>();
  for (const v of discovered) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.configDir, v);
  }
  for (const dir of record?.configDirs || []) targets.set(resolve(dir), targetFromConfigDir(dir));
  const removed: Array<{ configDir: string; luarcPath: string; scriptPath: string; removed: boolean }> = [];
  for (const target of targets.values()) {
    let didRemove = false;
    if (existsSync(target.luarcPath)) {
      const existing = readText(target.luarcPath);
      if (existing.includes(DARKTABLE_BRIDGE_MARKER_START)) {
        const tmp = target.luarcPath + '.tmp';
        writeFileSync(tmp, stripMarkedBlock(existing), 'utf8');
        renameSync(tmp, target.luarcPath);
        didRemove = true;
      }
    }
    if (existsSync(target.scriptPath)) {
      try {
        unlinkSync(target.scriptPath);
        didRemove = true;
      } catch {
        /* ignore */
      }
    }
    removed.push({ configDir: target.configDir, luarcPath: target.luarcPath, scriptPath: target.scriptPath, removed: didRemove });
  }
  clearDarktableBridgeInstallRecord();
  return { ok: true, removed };
}
