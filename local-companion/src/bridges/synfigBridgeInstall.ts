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
import { basename, join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';

export const DEFAULT_SYNFIG_BRIDGE_PORT = 7491;
export const SYNFIG_BRIDGE_PLUGIN_DIR_NAME = 'assetcutter_synfig_bridge';
export const SYNFIG_BRIDGE_PLUGIN_XML_NAME = 'plugin.xml';
export const SYNFIG_BRIDGE_SCRIPT_NAME = 'assetcutter_synfig_bridge.py';

export type SynfigBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type SynfigBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type SynfigBridgeStatus = {
  id: 'synfig';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: SynfigBridgeTarget[];
  install: SynfigBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type SynfigBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'synfig-install.json');
}

function heartbeatPath(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', 'synfig-heartbeat.json'));
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_SYNFIG_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverSynfigRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.SYNFIG_PLUGINS_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  roots.push(resolve(join(home, 'Documents', 'Synfig', 'plugins')));
  roots.push(resolve(join(home, 'OneDrive', 'Documents', 'Synfig', 'plugins')));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'synfig', 'plugins')));
  if (process.env.LOCALAPPDATA) roots.push(resolve(join(process.env.LOCALAPPDATA, 'synfig', 'plugins')));
  return roots.filter((root, idx, arr) => (rootExists(root) || /Synfig[\\/]plugins$|synfig[\\/]plugins$/i.test(root)) && arr.indexOf(root) === idx);
}

function targetFromPluginsDir(pluginsDir: string): SynfigBridgeTarget {
  const resolvedDir = resolve(pluginsDir);
  const pluginDir = join(resolvedDir, SYNFIG_BRIDGE_PLUGIN_DIR_NAME);
  const parent = basename(resolve(join(resolvedDir, '..')));
  return {
    id: `synfig::${resolvedDir}`,
    label: parent ? `Synfig ${parent}` : 'Synfig plugins',
    scriptsDir: resolvedDir,
    scriptPath: join(pluginDir, SYNFIG_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(pluginDir, SYNFIG_BRIDGE_SCRIPT_NAME)) && existsSync(join(pluginDir, SYNFIG_BRIDGE_PLUGIN_XML_NAME)),
  };
}

export function discoverSynfigBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): SynfigBridgeTarget[] {
  const byDir = new Map<string, SynfigBridgeTarget>();
  for (const root of discoverSynfigRoots(opts?.home)) byDir.set(resolve(root), targetFromPluginsDir(root));
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromPluginsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readSynfigBridgeInstallRecord(): SynfigBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as SynfigBridgeInstallRecord;
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

function writeSynfigBridgeInstallRecord(rec: SynfigBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearSynfigBridgeInstallRecord(): void {
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

function buildSynfigPluginXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<plugin name="AssetCutter Bridge" type="python" script="${SYNFIG_BRIDGE_SCRIPT_NAME}" />
`;
}

function buildSynfigBridgeScript(port: number): string {
  const hb = heartbeatPath();
  return `# AssetCutter Synfig Studio Bridge
# Auto-generated by AssetCutter local companion.
import datetime
import json
import os

HEARTBEAT_PATH = ${pyString(hb)}
PORT = ${port}

def run(*args, **kwargs):
    folder = os.path.dirname(HEARTBEAT_PATH)
    if folder and not os.path.isdir(folder):
        os.makedirs(folder, exist_ok=True)
    payload = {
        "ok": True,
        "host": "synfig",
        "name": "Synfig Studio",
        "port": PORT,
        "at": datetime.datetime.utcnow().isoformat() + "Z",
    }
    with open(HEARTBEAT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f)

run()
`;
}

async function probeSynfigBridge(): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath();
  if (!existsSync(p)) return { ok: false, message: 'Synfig bridge heartbeat has not been seen yet. Run AssetCutter Bridge from Synfig Plug-ins.', heartbeatPath: p };
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string };
    if (json.host !== 'synfig') return { ok: false, message: 'Synfig bridge heartbeat is invalid.', heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `Synfig bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Synfig bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getSynfigBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<SynfigBridgeStatus> {
  const targets = discoverSynfigBridgeTargets(opts);
  const install = readSynfigBridgeInstallRecord();
  const port = install?.port || DEFAULT_SYNFIG_BRIDGE_PORT;
  return {
    id: 'synfig',
    name: 'Synfig Studio',
    description: 'One-click Python plug-in bridge using a local heartbeat probe.',
    defaultPort: DEFAULT_SYNFIG_BRIDGE_PORT,
    port,
    roots: discoverSynfigRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeSynfigBridge(),
  };
}

function resolveInstallTargets(
  body: SynfigBridgeInstallBody,
  discovered: SynfigBridgeTarget[],
): { targets: SynfigBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: SynfigBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const pluginsDir = resolve(String(dirRaw || '').trim());
    if (pluginsDir) targets.push(targetFromPluginsDir(pluginsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_synfig_plugins_dir' };
  return { targets: unique };
}

export function installSynfigBridge(
  body: SynfigBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverSynfigBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_synfig_plugins_dir',
      message: 'No Synfig plugins folder was found. Choose the plugins folder manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    const pluginDir = join(target.scriptsDir, SYNFIG_BRIDGE_PLUGIN_DIR_NAME);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, SYNFIG_BRIDGE_PLUGIN_XML_NAME), buildSynfigPluginXml(), 'utf8');
    writeFileSync(target.scriptPath, buildSynfigBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeSynfigBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Synfig bridge installed. Restart Synfig if needed, run AssetCutter Bridge from Plug-ins, then probe connection.' };
}

export function uninstallSynfigBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverSynfigBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readSynfigBridgeInstallRecord();
  const targets = new Map<string, SynfigBridgeTarget>();
  for (const v of discovered) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.scriptsDir, v);
  }
  for (const dir of record?.scriptsDirs || []) targets.set(resolve(dir), targetFromPluginsDir(dir));
  const removed: Array<{ scriptsDir: string; scriptPath: string }> = [];
  for (const target of targets.values()) {
    const pluginDir = join(target.scriptsDir, SYNFIG_BRIDGE_PLUGIN_DIR_NAME);
    if (!existsSync(pluginDir)) continue;
    try {
      rmSync(pluginDir, { recursive: true, force: true });
      removed.push({ scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
    } catch {
      /* ignore */
    }
  }
  clearSynfigBridgeInstallRecord();
  return { ok: true, removed };
}
