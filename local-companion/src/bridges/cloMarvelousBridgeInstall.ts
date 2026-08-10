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

export type CloMarvelousBridgeId = 'marvelous-designer' | 'clo';

type HostDef = {
  id: CloMarvelousBridgeId;
  name: string;
  defaultPort: number;
  envVar: string;
  folderNames: string[];
  recordName: string;
  heartbeatName: string;
  scriptName: string;
};

const HOSTS: Record<CloMarvelousBridgeId, HostDef> = {
  'marvelous-designer': {
    id: 'marvelous-designer',
    name: 'Marvelous Designer',
    defaultPort: 7441,
    envVar: 'MARVELOUS_DESIGNER_SCRIPTS_DIR',
    folderNames: ['Marvelous Designer', 'MarvelousDesigner'],
    recordName: 'marvelous-designer-install.json',
    heartbeatName: 'marvelous-designer-heartbeat.json',
    scriptName: 'assetcutter_marvelous_designer_bridge.py',
  },
  clo: {
    id: 'clo',
    name: 'CLO',
    defaultPort: 7451,
    envVar: 'CLO_SCRIPTS_DIR',
    folderNames: ['CLO', 'CLO3D'],
    recordName: 'clo-install.json',
    heartbeatName: 'clo-heartbeat.json',
    scriptName: 'assetcutter_clo_bridge.py',
  },
};

export const MARVELOUS_DESIGNER_BRIDGE_SCRIPT_NAME = HOSTS['marvelous-designer'].scriptName;
export const CLO_BRIDGE_SCRIPT_NAME = HOSTS.clo.scriptName;
export const DEFAULT_MARVELOUS_DESIGNER_BRIDGE_PORT = HOSTS['marvelous-designer'].defaultPort;
export const DEFAULT_CLO_BRIDGE_PORT = HOSTS.clo.defaultPort;

export type CloMarvelousBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type CloMarvelousBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type CloMarvelousBridgeStatus = {
  id: CloMarvelousBridgeId;
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: CloMarvelousBridgeTarget[];
  install: CloMarvelousBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type CloMarvelousBridgeInstallBody = {
  targets?: string[];
  scriptsDirs?: string[];
  port?: number;
  home?: string;
};

function defFor(id: CloMarvelousBridgeId): HostDef {
  return HOSTS[id];
}

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function installRecordPath(id: CloMarvelousBridgeId): string {
  return join(bridgesStateDir(), defFor(id).recordName);
}

function heartbeatPath(id: CloMarvelousBridgeId): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', defFor(id).heartbeatName));
}

function normalizePort(id: CloMarvelousBridgeId, raw: unknown): number {
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

export function discoverCloMarvelousRoots(id: CloMarvelousBridgeId, home = homedir()): string[] {
  const host = defFor(id);
  const roots: string[] = [];
  const fromEnv = process.env[host.envVar]?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  for (const folder of host.folderNames) {
    roots.push(resolve(join(home, 'Documents', folder, 'Scripts')));
    roots.push(resolve(join(home, 'OneDrive', 'Documents', folder, 'Scripts')));
    if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, folder, 'Scripts')));
  }
  return roots.filter((root, idx, arr) => (rootExists(root) || /[\\/]Scripts$/i.test(root)) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(id: CloMarvelousBridgeId, scriptsDir: string): CloMarvelousBridgeTarget {
  const host = defFor(id);
  const resolvedDir = resolve(scriptsDir);
  const parent = basename(resolve(join(resolvedDir, '..')));
  return {
    id: `${id}::${resolvedDir}`,
    label: parent ? `${host.name} ${parent}` : `${host.name} scripts`,
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, host.scriptName),
    hasScriptBridge: existsSync(join(resolvedDir, host.scriptName)),
  };
}

export function discoverCloMarvelousBridgeTargets(
  id: CloMarvelousBridgeId,
  opts?: { home?: string; scriptsDirs?: string[] },
): CloMarvelousBridgeTarget[] {
  const byDir = new Map<string, CloMarvelousBridgeTarget>();
  for (const root of discoverCloMarvelousRoots(id, opts?.home)) byDir.set(resolve(root), targetFromScriptsDir(id, root));
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(id, dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readCloMarvelousBridgeInstallRecord(id: CloMarvelousBridgeId): CloMarvelousBridgeInstallRecord | null {
  const p = installRecordPath(id);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as CloMarvelousBridgeInstallRecord;
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

function writeCloMarvelousBridgeInstallRecord(id: CloMarvelousBridgeId, rec: CloMarvelousBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath(id);
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearCloMarvelousBridgeInstallRecord(id: CloMarvelousBridgeId): void {
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

function buildCloMarvelousBridgeScript(id: CloMarvelousBridgeId, port: number): string {
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

def assetcutter_write_heartbeat():
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

assetcutter_write_heartbeat()
`;
}

async function probeCloMarvelousBridge(id: CloMarvelousBridgeId): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const host = defFor(id);
  const p = heartbeatPath(id);
  if (!existsSync(p)) return { ok: false, message: `${host.name} bridge heartbeat has not been seen yet. Run the AssetCutter Python script inside ${host.name}.`, heartbeatPath: p };
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

export async function getCloMarvelousBridgeStatus(
  id: CloMarvelousBridgeId,
  opts?: { home?: string; scriptsDirs?: string[] },
): Promise<CloMarvelousBridgeStatus> {
  const host = defFor(id);
  const targets = discoverCloMarvelousBridgeTargets(id, opts);
  const install = readCloMarvelousBridgeInstallRecord(id);
  const port = install?.port || host.defaultPort;
  return {
    id,
    name: host.name,
    description: `One-click Python Script bridge using a local heartbeat probe.`,
    defaultPort: host.defaultPort,
    port,
    roots: discoverCloMarvelousRoots(id, opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeCloMarvelousBridge(id),
  };
}

function resolveInstallTargets(
  id: CloMarvelousBridgeId,
  body: CloMarvelousBridgeInstallBody,
  discovered: CloMarvelousBridgeTarget[],
): { targets: CloMarvelousBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: CloMarvelousBridgeTarget[] = [];
  for (const targetId of body.targets || []) {
    const v = byId.get(String(targetId));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(id, scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: `no_${id.replace(/-/g, '_')}_scripts_dir` };
  return { targets: unique };
}

export function installCloMarvelousBridge(
  id: CloMarvelousBridgeId,
  body: CloMarvelousBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const host = defFor(id);
  const port = normalizePort(id, body.port);
  const discovered = discoverCloMarvelousBridgeTargets(id, { home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(id, body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || `no_${id.replace(/-/g, '_')}_scripts_dir`,
      message: `No ${host.name} Scripts folder was found. Choose the Scripts folder manually.`,
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildCloMarvelousBridgeScript(id, port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeCloMarvelousBridgeInstallRecord(id, {
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: `${host.name} bridge installed. Run the AssetCutter Python script inside ${host.name}, then probe connection.` };
}

export function uninstallCloMarvelousBridge(
  id: CloMarvelousBridgeId,
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverCloMarvelousBridgeTargets(id, { scriptsDirs: body.scriptsDirs });
  const record = readCloMarvelousBridgeInstallRecord(id);
  const targets = new Map<string, CloMarvelousBridgeTarget>();
  for (const v of discovered) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.scriptsDir, v);
  }
  for (const dir of record?.scriptsDirs || []) targets.set(resolve(dir), targetFromScriptsDir(id, dir));
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
  clearCloMarvelousBridgeInstallRecord(id);
  return { ok: true, removed };
}
