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

export const DEFAULT_POSER_BRIDGE_PORT = 7511;
export const POSER_BRIDGE_SCRIPT_NAME = 'assetcutter_poser_bridge.py';

export type PoserBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type PoserBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type PoserBridgeStatus = {
  id: 'poser';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: PoserBridgeTarget[];
  install: PoserBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type PoserBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'poser-install.json');
}

function heartbeatPath(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', 'poser-heartbeat.json'));
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_POSER_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverPoserRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.POSER_SCRIPTS_MENU_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  roots.push(resolve(join(home, 'Documents', 'Poser', 'Runtime', 'Python', 'poserScripts', 'ScriptsMenu', 'AssetCutter')));
  roots.push(resolve(join(home, 'OneDrive', 'Documents', 'Poser', 'Runtime', 'Python', 'poserScripts', 'ScriptsMenu', 'AssetCutter')));
  if (process.env.PROGRAMFILES) roots.push(resolve(join(process.env.PROGRAMFILES, 'Poser Software', 'Poser', 'Runtime', 'Python', 'poserScripts', 'ScriptsMenu', 'AssetCutter')));
  if (process.env['PROGRAMFILES(X86)']) roots.push(resolve(join(process.env['PROGRAMFILES(X86)'], 'Poser Software', 'Poser', 'Runtime', 'Python', 'poserScripts', 'ScriptsMenu', 'AssetCutter')));
  return roots.filter((root, idx, arr) => (rootExists(root) || /Poser[\\/]Runtime[\\/]Python[\\/]poserScripts[\\/]ScriptsMenu[\\/]AssetCutter$/i.test(root)) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(scriptsDir: string): PoserBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  const parent = basename(resolve(join(resolvedDir, '..')));
  return {
    id: `poser::${resolvedDir}`,
    label: parent ? `Poser ${parent}` : 'Poser ScriptsMenu',
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, POSER_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, POSER_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverPoserBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): PoserBridgeTarget[] {
  const byDir = new Map<string, PoserBridgeTarget>();
  for (const root of discoverPoserRoots(opts?.home)) byDir.set(resolve(root), targetFromScriptsDir(root));
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readPoserBridgeInstallRecord(): PoserBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as PoserBridgeInstallRecord;
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

function writePoserBridgeInstallRecord(rec: PoserBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearPoserBridgeInstallRecord(): void {
  const p = installRecordPath();
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

function buildPoserBridgeScript(port: number): string {
  const hb = heartbeatPath();
  return `# AssetCutter Poser Bridge
# Auto-generated by AssetCutter local companion.
import datetime
import json
import os

HEARTBEAT_PATH = ${pyString(hb)}
PORT = ${port}

folder = os.path.dirname(HEARTBEAT_PATH)
if folder and not os.path.isdir(folder):
    os.makedirs(folder, exist_ok=True)

payload = {
    "ok": True,
    "host": "poser",
    "name": "Poser",
    "port": PORT,
    "at": datetime.datetime.utcnow().isoformat() + "Z",
}

with open(HEARTBEAT_PATH, "w", encoding="utf-8") as f:
    json.dump(payload, f)
`;
}

async function probePoserBridge(): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath();
  if (!existsSync(p)) return { ok: false, message: 'Poser bridge heartbeat has not been seen yet. Run the AssetCutter Python script from Poser Scripts menu.', heartbeatPath: p };
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string };
    if (json.host !== 'poser') return { ok: false, message: 'Poser bridge heartbeat is invalid.', heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `Poser bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Poser bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getPoserBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<PoserBridgeStatus> {
  const targets = discoverPoserBridgeTargets(opts);
  const install = readPoserBridgeInstallRecord();
  const port = install?.port || DEFAULT_POSER_BRIDGE_PORT;
  return {
    id: 'poser',
    name: 'Poser',
    description: 'One-click Python ScriptsMenu bridge using a local heartbeat probe.',
    defaultPort: DEFAULT_POSER_BRIDGE_PORT,
    port,
    roots: discoverPoserRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probePoserBridge(),
  };
}

function resolveInstallTargets(
  body: PoserBridgeInstallBody,
  discovered: PoserBridgeTarget[],
): { targets: PoserBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: PoserBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_poser_scripts_menu_dir' };
  return { targets: unique };
}

export function installPoserBridge(
  body: PoserBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverPoserBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_poser_scripts_menu_dir',
      message: 'No Poser ScriptsMenu folder was found. Choose the ScriptsMenu folder manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildPoserBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writePoserBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Poser bridge installed. Run the AssetCutter Python script from Poser Scripts menu, then probe connection.' };
}

export function uninstallPoserBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverPoserBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readPoserBridgeInstallRecord();
  const targets = new Map<string, PoserBridgeTarget>();
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
  clearPoserBridgeInstallRecord();
  return { ok: true, removed };
}
