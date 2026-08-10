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

export const DEFAULT_MOHO_BRIDGE_PORT = 7401;
export const MOHO_BRIDGE_SCRIPT_NAME = 'assetcutter_moho_bridge.lua';

export type MohoBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type MohoBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type MohoBridgeStatus = {
  id: 'moho';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: MohoBridgeTarget[];
  install: MohoBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type MohoBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'moho-install.json');
}

function heartbeatPath(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', 'moho-heartbeat.json'));
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_MOHO_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverMohoRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.MOHO_SCRIPTS_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  roots.push(resolve(join(home, 'Documents', 'Moho Pro', 'Custom Content', 'Scripts', 'Menu')));
  roots.push(resolve(join(home, 'Documents', 'Moho', 'Custom Content', 'Scripts', 'Menu')));
  roots.push(resolve(join(home, 'OneDrive', 'Documents', 'Moho Pro', 'Custom Content', 'Scripts', 'Menu')));
  roots.push(resolve(join(home, 'OneDrive', 'Documents', 'Moho', 'Custom Content', 'Scripts', 'Menu')));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'Moho', 'Scripts', 'Menu')));
  return roots.filter((root, idx, arr) => (rootExists(root) || /Scripts[\\/]Menu$/i.test(root)) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(scriptsDir: string): MohoBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  const parent = basename(resolve(join(resolvedDir, '..')));
  return {
    id: `moho::${resolvedDir}`,
    label: parent ? `Moho ${parent}` : 'Moho Scripts/Menu',
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, MOHO_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, MOHO_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverMohoBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): MohoBridgeTarget[] {
  const byDir = new Map<string, MohoBridgeTarget>();
  for (const root of discoverMohoRoots(opts?.home)) {
    byDir.set(resolve(root), targetFromScriptsDir(root));
  }
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readMohoBridgeInstallRecord(): MohoBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as MohoBridgeInstallRecord;
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

function writeMohoBridgeInstallRecord(rec: MohoBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearMohoBridgeInstallRecord(): void {
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

function buildMohoBridgeScript(port: number): string {
  const hb = heartbeatPath();
  return `-- AssetCutter Moho Bridge
-- Auto-generated by AssetCutter local companion.
ScriptName = "AssetCutter Bridge"

local heartbeat_path = "${luaString(hb)}"
local port = ${port}

function AssetCutterBridge:Name()
  return "AssetCutter Bridge"
end

function AssetCutterBridge:Version()
  return "1.0"
end

function AssetCutterBridge:Description()
  return "Writes an AssetCutter bridge heartbeat."
end

function AssetCutterBridge:Creator()
  return "AssetCutter"
end

function AssetCutterBridge:UILabel()
  return "AssetCutter Bridge"
end

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
    f:write('{"ok":true,"host":"moho","name":"Moho","port":' .. tostring(port) .. ',"at":"' .. os.date("!%Y-%m-%dT%H:%M:%SZ") .. '"}')
    f:close()
  end
end

function AssetCutterBridge:Run(moho)
  write_heartbeat()
  if LM and LM.GUI and LM.GUI.Alert then
    LM.GUI.Alert(LM.GUI.ALERT_INFO, "AssetCutter Bridge", "Moho heartbeat written.", "", "OK")
  end
end
`;
}

async function probeMohoBridge(): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath();
  if (!existsSync(p)) {
    return { ok: false, message: 'Moho bridge heartbeat has not been seen yet. Restart Moho and run Scripts > AssetCutter Bridge.', heartbeatPath: p };
  }
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string };
    if (json.host !== 'moho') return { ok: false, message: 'Moho bridge heartbeat is invalid.', heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `Moho bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Moho bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getMohoBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<MohoBridgeStatus> {
  const targets = discoverMohoBridgeTargets(opts);
  const install = readMohoBridgeInstallRecord();
  const port = install?.port || DEFAULT_MOHO_BRIDGE_PORT;
  return {
    id: 'moho',
    name: 'Moho',
    description: 'One-click Lua menu script bridge using a local heartbeat probe.',
    defaultPort: DEFAULT_MOHO_BRIDGE_PORT,
    port,
    roots: discoverMohoRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeMohoBridge(),
  };
}

function resolveInstallTargets(
  body: MohoBridgeInstallBody,
  discovered: MohoBridgeTarget[],
): { targets: MohoBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: MohoBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_moho_scripts_dir' };
  return { targets: unique };
}

export function installMohoBridge(
  body: MohoBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverMohoBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_moho_scripts_dir',
      message: 'No Moho Scripts/Menu folder was found. Choose the Moho Custom Content Scripts/Menu folder manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildMohoBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeMohoBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Moho bridge installed. Restart Moho and run Scripts > AssetCutter Bridge, then probe connection.' };
}

export function uninstallMohoBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverMohoBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readMohoBridgeInstallRecord();
  const targets = new Map<string, MohoBridgeTarget>();
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
  clearMohoBridgeInstallRecord();
  return { ok: true, removed };
}
