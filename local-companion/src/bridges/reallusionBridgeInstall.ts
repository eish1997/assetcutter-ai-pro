import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';

export type ReallusionBridgeId = 'iclone' | 'character-creator';

type HostDef = {
  id: ReallusionBridgeId;
  name: string;
  defaultPort: number;
  envVar: string;
  programFolderPrefix: string;
  recordName: string;
  heartbeatName: string;
};

const PLUGIN_DIR_NAME = 'AssetCutterBridge';
export const REALLUSION_BRIDGE_PLUGIN_DIR_NAME = PLUGIN_DIR_NAME;
export const REALLUSION_BRIDGE_SCRIPT_NAME = 'main.py';
export const DEFAULT_ICLONE_BRIDGE_PORT = 7521;
export const DEFAULT_CHARACTER_CREATOR_BRIDGE_PORT = 7531;

const HOSTS: Record<ReallusionBridgeId, HostDef> = {
  iclone: {
    id: 'iclone',
    name: 'iClone',
    defaultPort: DEFAULT_ICLONE_BRIDGE_PORT,
    envVar: 'ICLONE_OPENPLUGIN_DIR',
    programFolderPrefix: 'iClone',
    recordName: 'iclone-install.json',
    heartbeatName: 'iclone-heartbeat.json',
  },
  'character-creator': {
    id: 'character-creator',
    name: 'Character Creator',
    defaultPort: DEFAULT_CHARACTER_CREATOR_BRIDGE_PORT,
    envVar: 'CHARACTER_CREATOR_OPENPLUGIN_DIR',
    programFolderPrefix: 'Character Creator',
    recordName: 'character-creator-install.json',
    heartbeatName: 'character-creator-heartbeat.json',
  },
};

export type ReallusionBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type ReallusionBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type ReallusionBridgeStatus = {
  id: ReallusionBridgeId;
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: ReallusionBridgeTarget[];
  install: ReallusionBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type ReallusionBridgeInstallBody = {
  targets?: string[];
  scriptsDirs?: string[];
  port?: number;
};

function defFor(id: ReallusionBridgeId): HostDef {
  return HOSTS[id];
}

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function installRecordPath(id: ReallusionBridgeId): string {
  return join(bridgesStateDir(), defFor(id).recordName);
}

function heartbeatPath(id: ReallusionBridgeId): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', defFor(id).heartbeatName));
}

function normalizePort(id: ReallusionBridgeId, raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : defFor(id).defaultPort;
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
  return /[\\/]AssetCutterBridge$/i.test(p) ? p : join(p, PLUGIN_DIR_NAME);
}

function listProgramMatches(prefix: string): string[] {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean) as string[];
  const out: string[] = [];
  for (const root of roots) {
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.toLowerCase().startsWith(prefix.toLowerCase())) {
          out.push(join(root, entry.name, 'Bin64', 'OpenPlugin', PLUGIN_DIR_NAME));
        }
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function discoverReallusionRoots(id: ReallusionBridgeId): string[] {
  const host = defFor(id);
  const roots: string[] = [];
  const fromEnv = process.env[host.envVar]?.trim();
  if (fromEnv) roots.push(normalizePluginDir(fromEnv));
  roots.push(...listProgramMatches(host.programFolderPrefix));
  return roots
    .map((root) => resolve(root))
    .filter((root, idx, arr) => (rootExists(root) || /[\\/]Bin64[\\/]OpenPlugin[\\/]AssetCutterBridge$/i.test(root)) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(id: ReallusionBridgeId, scriptsDir: string): ReallusionBridgeTarget {
  const host = defFor(id);
  const pluginDir = normalizePluginDir(scriptsDir);
  return {
    id: `${id}::${pluginDir}`,
    label: `${host.name} OpenPlugin`,
    scriptsDir: pluginDir,
    scriptPath: join(pluginDir, REALLUSION_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(pluginDir, REALLUSION_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverReallusionBridgeTargets(
  id: ReallusionBridgeId,
  opts?: { scriptsDirs?: string[] },
): ReallusionBridgeTarget[] {
  const byDir = new Map<string, ReallusionBridgeTarget>();
  for (const root of discoverReallusionRoots(id)) byDir.set(resolve(root), targetFromScriptsDir(id, root));
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = String(dirRaw || '').trim();
    if (dir) {
      const pluginDir = normalizePluginDir(dir);
      byDir.set(pluginDir, targetFromScriptsDir(id, pluginDir));
    }
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readReallusionBridgeInstallRecord(id: ReallusionBridgeId): ReallusionBridgeInstallRecord | null {
  const p = installRecordPath(id);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as ReallusionBridgeInstallRecord;
    return {
      port: normalizePort(id, raw.port),
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      scriptsDirs: Array.isArray(raw.scriptsDirs) ? raw.scriptsDirs.map(String) : [],
      targetIds: Array.isArray(raw.targetIds) ? raw.targetIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function writeReallusionBridgeInstallRecord(id: ReallusionBridgeId, rec: ReallusionBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath(id);
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearReallusionBridgeInstallRecord(id: ReallusionBridgeId): void {
  const p = installRecordPath(id);
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function pyString(s: string): string {
  return JSON.stringify(s);
}

function buildReallusionBridgeScript(id: ReallusionBridgeId, port: number): string {
  const host = defFor(id);
  const hb = heartbeatPath(id);
  return `# AssetCutter ${host.name} Bridge
# Auto-generated by AssetCutter local companion.
import datetime
import json
import os

HEARTBEAT_PATH = ${pyString(hb)}
PORT = ${port}
HOST_ID = ${pyString(host.id)}
HOST_NAME = ${pyString(host.name)}

def run_script():
    folder = os.path.dirname(HEARTBEAT_PATH)
    if folder and not os.path.isdir(folder):
        os.makedirs(folder, exist_ok=True)
    payload = {
        "ok": True,
        "host": HOST_ID,
        "name": HOST_NAME,
        "port": PORT,
        "at": datetime.datetime.utcnow().isoformat() + "Z",
    }
    with open(HEARTBEAT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f)

run_script()
`;
}

async function probeReallusionBridge(id: ReallusionBridgeId): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const host = defFor(id);
  const p = heartbeatPath(id);
  if (!existsSync(p)) return { ok: false, message: `${host.name} bridge heartbeat has not been seen yet. Run AssetCutterBridge from the Reallusion Plug-in menu.`, heartbeatPath: p };
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string };
    if (json.host !== id) return { ok: false, message: `${host.name} bridge heartbeat is invalid.`, heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `${host.name} bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `${host.name} bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getReallusionBridgeStatus(
  id: ReallusionBridgeId,
  opts?: { scriptsDirs?: string[] },
): Promise<ReallusionBridgeStatus> {
  const host = defFor(id);
  const targets = discoverReallusionBridgeTargets(id, opts);
  const install = readReallusionBridgeInstallRecord(id);
  const port = install?.port || host.defaultPort;
  return {
    id,
    name: host.name,
    description: 'One-click OpenPlugin Python bridge using a local heartbeat probe.',
    defaultPort: host.defaultPort,
    port,
    roots: discoverReallusionRoots(id),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeReallusionBridge(id),
  };
}

function resolveInstallTargets(
  id: ReallusionBridgeId,
  body: ReallusionBridgeInstallBody,
  discovered: ReallusionBridgeTarget[],
): { targets: ReallusionBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: ReallusionBridgeTarget[] = [];
  for (const targetId of body.targets || []) {
    const v = byId.get(String(targetId));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const dir = String(dirRaw || '').trim();
    if (dir) targets.push(targetFromScriptsDir(id, dir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: `no_${id.replace(/-/g, '_')}_openplugin_dir` };
  return { targets: unique };
}

export function installReallusionBridge(
  id: ReallusionBridgeId,
  body: ReallusionBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const host = defFor(id);
  const port = normalizePort(id, body.port);
  const discovered = discoverReallusionBridgeTargets(id, { scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(id, body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || `no_${id.replace(/-/g, '_')}_openplugin_dir`,
      message: `No ${host.name} OpenPlugin folder was found. Choose the Bin64/OpenPlugin folder manually.`,
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildReallusionBridgeScript(id, port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeReallusionBridgeInstallRecord(id, {
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: `${host.name} bridge installed. Restart ${host.name} if needed, run AssetCutterBridge from the Plug-in menu, then probe connection.` };
}

export function uninstallReallusionBridge(
  id: ReallusionBridgeId,
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverReallusionBridgeTargets(id, { scriptsDirs: body.scriptsDirs });
  const record = readReallusionBridgeInstallRecord(id);
  const targets = new Map<string, ReallusionBridgeTarget>();
  for (const v of discovered) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.scriptsDir, v);
  }
  for (const dir of record?.scriptsDirs || []) targets.set(resolve(dir), targetFromScriptsDir(id, dir));
  const removed: Array<{ scriptsDir: string; scriptPath: string }> = [];
  for (const target of targets.values()) {
    if (!existsSync(target.scriptPath) && !existsSync(target.scriptsDir)) continue;
    try {
      if (existsSync(target.scriptsDir) && /[\\/]AssetCutterBridge$/i.test(target.scriptsDir)) {
        rmSync(target.scriptsDir, { recursive: true, force: true });
      } else if (existsSync(target.scriptPath)) {
        unlinkSync(target.scriptPath);
      }
      removed.push({ scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
    } catch {
      /* ignore */
    }
  }
  clearReallusionBridgeInstallRecord(id);
  return { ok: true, removed };
}
