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

export const DEFAULT_KATANA_BRIDGE_PORT = 7571;
export const KATANA_BRIDGE_MARKER_START = '# ========== AssetCutter Katana Bridge ==========';
export const KATANA_BRIDGE_MARKER_END = '# ========== AssetCutter Katana Bridge end ==========';
export const KATANA_BRIDGE_SCRIPT_NAME = 'assetcutter_katana_bridge.py';

export type KatanaBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  startupPath: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type KatanaBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type KatanaBridgeStatus = {
  id: 'katana';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: KatanaBridgeTarget[];
  install: KatanaBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type KatanaBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'katana-install.json');
}

function heartbeatPath(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', 'katana-heartbeat.json'));
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_KATANA_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function resourceRootsFromEnv(): string[] {
  const raw = process.env.KATANA_RESOURCES || process.env.KATANA_RESOURCES_DIR || '';
  return raw
    .split(process.platform === 'win32' ? ';' : /[;:]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => resolve(x));
}

export function discoverKatanaRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.KATANA_RESOURCE_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  roots.push(...resourceRootsFromEnv());
  roots.push(resolve(join(home, 'Documents', 'Katana', 'AssetCutterBridge')));
  return roots.filter((root, idx, arr) => (rootExists(root) || /[\\/]Katana[\\/]AssetCutterBridge$/i.test(root)) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(scriptsDir: string): KatanaBridgeTarget {
  const root = resolve(scriptsDir);
  const startupPath = join(root, 'Startup', 'init.py');
  return {
    id: `katana::${root}`,
    label: 'Katana resource root',
    scriptsDir: root,
    startupPath,
    scriptPath: join(root, KATANA_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(root, KATANA_BRIDGE_SCRIPT_NAME)) || (existsSync(startupPath) && readText(startupPath).includes(KATANA_BRIDGE_MARKER_START)),
  };
}

function readText(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  } catch {
    return '';
  }
}

export function discoverKatanaBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): KatanaBridgeTarget[] {
  const byDir = new Map<string, KatanaBridgeTarget>();
  for (const root of discoverKatanaRoots(opts?.home)) byDir.set(resolve(root), targetFromScriptsDir(root));
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readKatanaBridgeInstallRecord(): KatanaBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as KatanaBridgeInstallRecord;
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

function writeKatanaBridgeInstallRecord(rec: KatanaBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearKatanaBridgeInstallRecord(): void {
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

function stripMarkedBlock(content: string): string {
  const start = content.indexOf(KATANA_BRIDGE_MARKER_START);
  if (start < 0) return content;
  const end = content.indexOf(KATANA_BRIDGE_MARKER_END, start);
  if (end < 0) return content.slice(0, start).replace(/\s+$/, '') + '\n';
  const after = end + KATANA_BRIDGE_MARKER_END.length;
  const next = content.slice(0, start) + content.slice(after);
  return next.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

function buildKatanaBridgePy(port: number): string {
  const hb = heartbeatPath();
  return `# AssetCutter Katana Bridge
# Auto-generated by AssetCutter local companion.
import datetime
import json
import os

HEARTBEAT_PATH = ${pyString(hb)}
PORT = ${port}

def write_heartbeat():
    folder = os.path.dirname(HEARTBEAT_PATH)
    if folder and not os.path.isdir(folder):
        os.makedirs(folder, exist_ok=True)
    payload = {
        "ok": True,
        "host": "katana",
        "name": "Katana",
        "port": PORT,
        "at": datetime.datetime.utcnow().isoformat() + "Z",
    }
    with open(HEARTBEAT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f)

write_heartbeat()
`;
}

function buildStartupBlock(scriptPath: string): string {
  return `${KATANA_BRIDGE_MARKER_START}
try:
    exec(compile(open(${pyString(scriptPath)}, "rb").read(), ${pyString(scriptPath)}, "exec"))
except Exception as e:
    print("[AssetCutter Katana Bridge] startup error: %s" % e)
${KATANA_BRIDGE_MARKER_END}
`;
}

async function probeKatanaBridge(): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath();
  if (!existsSync(p)) return { ok: false, message: 'Katana bridge heartbeat has not been seen yet. Start Katana with the AssetCutter resource root enabled.', heartbeatPath: p };
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string };
    if (json.host !== 'katana') return { ok: false, message: 'Katana bridge heartbeat is invalid.', heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `Katana bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Katana bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getKatanaBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<KatanaBridgeStatus> {
  const targets = discoverKatanaBridgeTargets(opts);
  const install = readKatanaBridgeInstallRecord();
  const port = install?.port || DEFAULT_KATANA_BRIDGE_PORT;
  return {
    id: 'katana',
    name: 'Katana',
    description: 'One-click KATANA_RESOURCES Startup/init.py bridge using a local heartbeat probe.',
    defaultPort: DEFAULT_KATANA_BRIDGE_PORT,
    port,
    roots: discoverKatanaRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeKatanaBridge(),
  };
}

function resolveInstallTargets(
  body: KatanaBridgeInstallBody,
  discovered: KatanaBridgeTarget[],
): { targets: KatanaBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: KatanaBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_katana_resource_dir' };
  return { targets: unique };
}

export function installKatanaBridge(
  body: KatanaBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverKatanaBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_katana_resource_dir',
      message: 'No Katana resource root was found. Choose a KATANA_RESOURCES root manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    mkdirSync(join(target.scriptsDir, 'Startup'), { recursive: true });
    writeFileSync(target.scriptPath, buildKatanaBridgePy(port), 'utf8');
    const existing = readText(target.startupPath);
    const next = (stripMarkedBlock(existing).replace(/\s+$/, '') + '\n\n' + buildStartupBlock(target.scriptPath)).replace(/^\s+/, '');
    writeFileSync(target.startupPath, next, 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeKatanaBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Katana bridge installed. Restart Katana with this resource root enabled, then probe connection.' };
}

export function uninstallKatanaBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string; removed: boolean }> } {
  const discovered = discoverKatanaBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readKatanaBridgeInstallRecord();
  const targets = new Map<string, KatanaBridgeTarget>();
  for (const v of discovered) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.scriptsDir, v);
  }
  for (const dir of record?.scriptsDirs || []) targets.set(resolve(dir), targetFromScriptsDir(dir));
  const removed: Array<{ scriptsDir: string; scriptPath: string; removed: boolean }> = [];
  for (const target of targets.values()) {
    let did = false;
    try {
      if (existsSync(target.startupPath)) {
        const next = stripMarkedBlock(readText(target.startupPath));
        writeFileSync(target.startupPath, next, 'utf8');
        did = true;
      }
      if (existsSync(target.scriptPath)) {
        unlinkSync(target.scriptPath);
        did = true;
      }
    } catch {
      /* ignore */
    }
    removed.push({ scriptsDir: target.scriptsDir, scriptPath: target.scriptPath, removed: did });
  }
  clearKatanaBridgeInstallRecord();
  return { ok: true, removed };
}
