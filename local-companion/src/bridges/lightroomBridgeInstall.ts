import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';

export const DEFAULT_LIGHTROOM_BRIDGE_PORT = 7561;
export const LIGHTROOM_BRIDGE_PLUGIN_DIR_NAME = 'AssetCutterBridge.lrplugin';
export const LIGHTROOM_BRIDGE_INFO_NAME = 'Info.lua';
export const LIGHTROOM_BRIDGE_INIT_NAME = 'Init.lua';

export type LightroomBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type LightroomBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type LightroomBridgeStatus = {
  id: 'lightroom-classic';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: LightroomBridgeTarget[];
  install: LightroomBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type LightroomBridgeInstallBody = {
  targets?: string[];
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
  return join(bridgesStateDir(), 'lightroom-classic-install.json');
}

function heartbeatPath(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', 'lightroom-classic-heartbeat.json'));
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_LIGHTROOM_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function normalizePluginDir(path: string): string {
  const p = resolve(path);
  return /[\\/]AssetCutterBridge\.lrplugin$/i.test(p) ? p : join(p, LIGHTROOM_BRIDGE_PLUGIN_DIR_NAME);
}

export function discoverLightroomRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.LIGHTROOM_MODULES_DIR?.trim();
  if (fromEnv) roots.push(normalizePluginDir(fromEnv));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'Adobe', 'Lightroom', 'Modules', LIGHTROOM_BRIDGE_PLUGIN_DIR_NAME)));
  roots.push(resolve(join(home, 'AppData', 'Roaming', 'Adobe', 'Lightroom', 'Modules', LIGHTROOM_BRIDGE_PLUGIN_DIR_NAME)));
  return roots.filter((root, idx, arr) => (rootExists(root) || /[\\/]Adobe[\\/]Lightroom[\\/]Modules[\\/]AssetCutterBridge\.lrplugin$/i.test(root)) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(scriptsDir: string): LightroomBridgeTarget {
  const pluginDir = normalizePluginDir(scriptsDir);
  return {
    id: `lightroom-classic::${pluginDir}`,
    label: 'Lightroom Classic Modules',
    scriptsDir: pluginDir,
    scriptPath: join(pluginDir, LIGHTROOM_BRIDGE_INFO_NAME),
    hasScriptBridge: existsSync(join(pluginDir, LIGHTROOM_BRIDGE_INFO_NAME)) && existsSync(join(pluginDir, LIGHTROOM_BRIDGE_INIT_NAME)),
  };
}

export function discoverLightroomBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): LightroomBridgeTarget[] {
  const byDir = new Map<string, LightroomBridgeTarget>();
  for (const root of discoverLightroomRoots(opts?.home)) byDir.set(resolve(root), targetFromScriptsDir(root));
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = String(dirRaw || '').trim();
    if (dir) {
      const pluginDir = normalizePluginDir(dir);
      byDir.set(pluginDir, targetFromScriptsDir(pluginDir));
    }
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readLightroomBridgeInstallRecord(): LightroomBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as LightroomBridgeInstallRecord;
    return {
      port: normalizePort(raw.port),
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      scriptsDirs: Array.isArray(raw.scriptsDirs) ? raw.scriptsDirs.map(String) : [],
      targetIds: Array.isArray(raw.targetIds) ? raw.targetIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function writeLightroomBridgeInstallRecord(rec: LightroomBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearLightroomBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function luaString(s: string): string {
  return JSON.stringify(s).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function buildLightroomInfoLua(): string {
  return `return {
  LrSdkVersion = 6.0,
  LrSdkMinimumVersion = 5.0,
  LrToolkitIdentifier = 'com.assetcutter.lightroom.bridge',
  LrPluginName = 'AssetCutter Bridge',
  LrInitPlugin = 'Init.lua',
  VERSION = { major = 1, minor = 0, revision = 0, build = 1 },
}
`;
}

function buildLightroomInitLua(port: number): string {
  const hb = heartbeatPath();
  return `-- AssetCutter Lightroom Classic Bridge
-- Auto-generated by AssetCutter local companion.
local LrPathUtils = import 'LrPathUtils'
local LrFileUtils = import 'LrFileUtils'
local LrTasks = import 'LrTasks'

local heartbeatPath = ${luaString(hb)}
local port = ${port}

local function ensureFolder(path)
  local folder = LrPathUtils.parent(path)
  if folder and not LrFileUtils.exists(folder) then
    LrFileUtils.createAllDirectories(folder)
  end
end

local function writeHeartbeat()
  ensureFolder(heartbeatPath)
  local f = io.open(heartbeatPath, 'w')
  if f then
    f:write('{"ok":true,"host":"lightroom-classic","name":"Lightroom Classic","port":' .. tostring(port) .. ',"at":"' .. os.date('!%Y-%m-%dT%H:%M:%SZ') .. '"}')
    f:close()
  end
end

LrTasks.startAsyncTask(writeHeartbeat)
`;
}

async function probeLightroomBridge(): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath();
  if (!existsSync(p)) return { ok: false, message: 'Lightroom Classic bridge heartbeat has not been seen yet. Restart Lightroom Classic after installing the plugin.', heartbeatPath: p };
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string };
    if (json.host !== 'lightroom-classic') return { ok: false, message: 'Lightroom Classic bridge heartbeat is invalid.', heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `Lightroom Classic bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Lightroom Classic bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getLightroomBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<LightroomBridgeStatus> {
  const targets = discoverLightroomBridgeTargets(opts);
  const install = readLightroomBridgeInstallRecord();
  const port = install?.port || DEFAULT_LIGHTROOM_BRIDGE_PORT;
  return {
    id: 'lightroom-classic',
    name: 'Lightroom Classic',
    description: 'One-click Lua .lrplugin bridge using a local heartbeat probe.',
    defaultPort: DEFAULT_LIGHTROOM_BRIDGE_PORT,
    port,
    roots: discoverLightroomRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeLightroomBridge(),
  };
}

function resolveInstallTargets(
  body: LightroomBridgeInstallBody,
  discovered: LightroomBridgeTarget[],
): { targets: LightroomBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: LightroomBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const dir = String(dirRaw || '').trim();
    if (dir) targets.push(targetFromScriptsDir(dir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_lightroom_modules_dir' };
  return { targets: unique };
}

export function installLightroomBridge(
  body: LightroomBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverLightroomBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_lightroom_modules_dir',
      message: 'No Lightroom Classic Modules folder was found. Choose the Modules folder manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(join(target.scriptsDir, LIGHTROOM_BRIDGE_INFO_NAME), buildLightroomInfoLua(), 'utf8');
    writeFileSync(join(target.scriptsDir, LIGHTROOM_BRIDGE_INIT_NAME), buildLightroomInitLua(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: join(target.scriptsDir, LIGHTROOM_BRIDGE_INFO_NAME) });
  }
  writeLightroomBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Lightroom Classic bridge installed. Restart Lightroom Classic, then probe connection.' };
}

export function uninstallLightroomBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverLightroomBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readLightroomBridgeInstallRecord();
  const targets = new Map<string, LightroomBridgeTarget>();
  for (const v of discovered) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.scriptsDir, v);
  }
  for (const dir of record?.scriptsDirs || []) targets.set(resolve(dir), targetFromScriptsDir(dir));
  const removed: Array<{ scriptsDir: string; scriptPath: string }> = [];
  for (const target of targets.values()) {
    if (!existsSync(target.scriptsDir)) continue;
    try {
      rmSync(target.scriptsDir, { recursive: true, force: true });
      removed.push({ scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
    } catch {
      /* ignore */
    }
  }
  clearLightroomBridgeInstallRecord();
  return { ok: true, removed };
}
