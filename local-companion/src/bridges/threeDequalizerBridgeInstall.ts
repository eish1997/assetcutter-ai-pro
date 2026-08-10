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
import { join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';

export const DEFAULT_THREEDEQUALIZER_BRIDGE_PORT = 7551;
export const THREEDEQUALIZER_BRIDGE_SCRIPT_NAME = 'assetcutter_3dequalizer_bridge.py';

export type ThreeDequalizerBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type ThreeDequalizerBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type ThreeDequalizerBridgeStatus = {
  id: '3dequalizer';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: ThreeDequalizerBridgeTarget[];
  install: ThreeDequalizerBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type ThreeDequalizerBridgeInstallBody = {
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
  return join(bridgesStateDir(), '3dequalizer-install.json');
}

function heartbeatPath(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', '3dequalizer-heartbeat.json'));
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_THREEDEQUALIZER_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverThreeDequalizerRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.THREEDEQUALIZER_PY_SCRIPTS_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, '3DEqualizer4', 'py_scripts')));
  roots.push(resolve(join(home, '.3dequalizer', 'py_scripts')));
  roots.push(resolve(join(home, 'Documents', '3DEqualizer4', 'py_scripts')));
  return roots.filter((root, idx, arr) => (rootExists(root) || /[\\/](?:3DEqualizer4|\.3dequalizer)[\\/]py_scripts$/i.test(root)) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(scriptsDir: string): ThreeDequalizerBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  return {
    id: `3dequalizer::${resolvedDir}`,
    label: '3DEqualizer py_scripts',
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, THREEDEQUALIZER_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, THREEDEQUALIZER_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverThreeDequalizerBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): ThreeDequalizerBridgeTarget[] {
  const byDir = new Map<string, ThreeDequalizerBridgeTarget>();
  for (const root of discoverThreeDequalizerRoots(opts?.home)) byDir.set(resolve(root), targetFromScriptsDir(root));
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readThreeDequalizerBridgeInstallRecord(): ThreeDequalizerBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as ThreeDequalizerBridgeInstallRecord;
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

function writeThreeDequalizerBridgeInstallRecord(rec: ThreeDequalizerBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearThreeDequalizerBridgeInstallRecord(): void {
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

function buildThreeDequalizerBridgeScript(port: number): string {
  const hb = heartbeatPath();
  return `# 3DE4.script.name: AssetCutter Bridge
# 3DE4.script.version: v1.0
# 3DE4.script.gui: Main Window::AssetCutter
# 3DE4.script.comment: Writes an AssetCutter heartbeat for local companion probing.
# AssetCutter 3DEqualizer Bridge
# Auto-generated by AssetCutter local companion.
import datetime
import json
import os

HEARTBEAT_PATH = ${pyString(hb)}
PORT = ${port}

def assetcutter_write_heartbeat():
    folder = os.path.dirname(HEARTBEAT_PATH)
    if folder and not os.path.isdir(folder):
        os.makedirs(folder, exist_ok=True)
    payload = {
        "ok": True,
        "host": "3dequalizer",
        "name": "3DEqualizer",
        "port": PORT,
        "at": datetime.datetime.utcnow().isoformat() + "Z",
    }
    with open(HEARTBEAT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f)

assetcutter_write_heartbeat()
`;
}

async function probeThreeDequalizerBridge(): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath();
  if (!existsSync(p)) return { ok: false, message: '3DEqualizer bridge heartbeat has not been seen yet. Run AssetCutter Bridge from the 3DEqualizer script menu.', heartbeatPath: p };
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string };
    if (json.host !== '3dequalizer') return { ok: false, message: '3DEqualizer bridge heartbeat is invalid.', heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `3DEqualizer bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `3DEqualizer bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getThreeDequalizerBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<ThreeDequalizerBridgeStatus> {
  const targets = discoverThreeDequalizerBridgeTargets(opts);
  const install = readThreeDequalizerBridgeInstallRecord();
  const port = install?.port || DEFAULT_THREEDEQUALIZER_BRIDGE_PORT;
  return {
    id: '3dequalizer',
    name: '3DEqualizer',
    description: 'One-click py_scripts Python bridge using a local heartbeat probe.',
    defaultPort: DEFAULT_THREEDEQUALIZER_BRIDGE_PORT,
    port,
    roots: discoverThreeDequalizerRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeThreeDequalizerBridge(),
  };
}

function resolveInstallTargets(
  body: ThreeDequalizerBridgeInstallBody,
  discovered: ThreeDequalizerBridgeTarget[],
): { targets: ThreeDequalizerBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: ThreeDequalizerBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_3dequalizer_py_scripts_dir' };
  return { targets: unique };
}

export function installThreeDequalizerBridge(
  body: ThreeDequalizerBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverThreeDequalizerBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_3dequalizer_py_scripts_dir',
      message: 'No 3DEqualizer py_scripts folder was found. Choose the py_scripts folder manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildThreeDequalizerBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeThreeDequalizerBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: '3DEqualizer bridge installed. Run AssetCutter Bridge from the script menu, then probe connection.' };
}

export function uninstallThreeDequalizerBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverThreeDequalizerBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readThreeDequalizerBridgeInstallRecord();
  const targets = new Map<string, ThreeDequalizerBridgeTarget>();
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
  clearThreeDequalizerBridgeInstallRecord();
  return { ok: true, removed };
}
