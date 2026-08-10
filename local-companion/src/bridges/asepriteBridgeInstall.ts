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

export const DEFAULT_ASEPRITE_BRIDGE_PORT = 7381;
export const ASEPRITE_BRIDGE_SCRIPT_NAME = 'assetcutter_aseprite_bridge.lua';

export type AsepriteBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type AsepriteBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type AsepriteBridgeStatus = {
  id: 'aseprite';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: AsepriteBridgeTarget[];
  install: AsepriteBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type AsepriteBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'aseprite-install.json');
}

function heartbeatPath(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', 'aseprite-heartbeat.json'));
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_ASEPRITE_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverAsepriteRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.ASEPRITE_SCRIPTS_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'Aseprite', 'scripts')));
  roots.push(resolve(join(home, 'AppData', 'Roaming', 'Aseprite', 'scripts')));
  roots.push(resolve(join(home, 'Documents', 'Aseprite', 'scripts')));
  roots.push(resolve(join(home, 'OneDrive', 'Documents', 'Aseprite', 'scripts')));
  return roots.filter((root, idx, arr) => (rootExists(root) || /Aseprite[\\/]scripts$/i.test(root)) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(scriptsDir: string): AsepriteBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  const parent = basename(resolve(join(resolvedDir, '..')));
  return {
    id: `aseprite::${resolvedDir}`,
    label: parent ? `Aseprite ${parent}` : 'Aseprite scripts',
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, ASEPRITE_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, ASEPRITE_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverAsepriteBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): AsepriteBridgeTarget[] {
  const byDir = new Map<string, AsepriteBridgeTarget>();
  for (const root of discoverAsepriteRoots(opts?.home)) {
    byDir.set(resolve(root), targetFromScriptsDir(root));
  }
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readAsepriteBridgeInstallRecord(): AsepriteBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as AsepriteBridgeInstallRecord;
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

function writeAsepriteBridgeInstallRecord(rec: AsepriteBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearAsepriteBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function luaString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildAsepriteBridgeScript(port: number): string {
  const hb = heartbeatPath();
  return `-- AssetCutter Aseprite Bridge
-- Auto-generated by AssetCutter local companion.
local heartbeat_path = "${luaString(hb)}"
local port = ${port}

local function ensure_parent(path)
  local parent = path:match("^(.*)[/\\\\][^/\\\\]+$")
  if parent then
    os.execute('mkdir "' .. parent .. '" 2>nul')
  end
end

local function write_heartbeat()
  ensure_parent(heartbeat_path)
  local f = io.open(heartbeat_path, "w")
  if f then
    f:write('{"ok":true,"host":"aseprite","name":"Aseprite","port":' .. tostring(port) .. ',"at":"' .. os.date("!%Y-%m-%dT%H:%M:%SZ") .. '"}')
    f:close()
  end
end

write_heartbeat()
if app and app.alert then
  app.alert("AssetCutter Aseprite bridge heartbeat written.")
end
`;
}

async function probeAsepriteBridge(): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath();
  if (!existsSync(p)) {
    return { ok: false, message: 'Aseprite bridge heartbeat has not been seen yet. Rescan Scripts and run the installed script from File > Scripts.', heartbeatPath: p };
  }
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string };
    if (json.host !== 'aseprite') return { ok: false, message: 'Aseprite bridge heartbeat is invalid.', heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `Aseprite bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Aseprite bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getAsepriteBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<AsepriteBridgeStatus> {
  const targets = discoverAsepriteBridgeTargets(opts);
  const install = readAsepriteBridgeInstallRecord();
  const port = install?.port || DEFAULT_ASEPRITE_BRIDGE_PORT;
  return {
    id: 'aseprite',
    name: 'Aseprite',
    description: 'One-click Lua script bridge using a local heartbeat probe.',
    defaultPort: DEFAULT_ASEPRITE_BRIDGE_PORT,
    port,
    roots: discoverAsepriteRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeAsepriteBridge(),
  };
}

function resolveInstallTargets(
  body: AsepriteBridgeInstallBody,
  discovered: AsepriteBridgeTarget[],
): { targets: AsepriteBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: AsepriteBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_aseprite_scripts_dir' };
  return { targets: unique };
}

export function installAsepriteBridge(
  body: AsepriteBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverAsepriteBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_aseprite_scripts_dir',
      message: 'No Aseprite scripts folder was found. Choose the folder from File > Scripts > Open Scripts Folder manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildAsepriteBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeAsepriteBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Aseprite bridge installed. Rescan Scripts and run the AssetCutter script, then probe connection.' };
}

export function uninstallAsepriteBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverAsepriteBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readAsepriteBridgeInstallRecord();
  const targets = new Map<string, AsepriteBridgeTarget>();
  for (const v of discovered) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.scriptsDir, v);
  }
  for (const dir of record?.scriptsDirs || []) targets.set(resolve(dir), targetFromScriptsDir(dir));
  const removed: Array<{ scriptsDir: string; scriptPath: string }> = [];
  for (const target of targets.values()) {
    if (!existsSync(target.scriptPath)) continue;
    try {
      unlinkSync(target.scriptPath);
      removed.push({ scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
    } catch {
      /* ignore */
    }
  }
  clearAsepriteBridgeInstallRecord();
  return { ok: true, removed };
}
