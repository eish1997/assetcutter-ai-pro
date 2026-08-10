import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';

export const DEFAULT_ZBRUSH_BRIDGE_PORT = 7121;
export const ZBRUSH_BRIDGE_SCRIPT_NAME = 'AssetCutter_ZBrush_Bridge.txt';

export type ZBrushBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type ZBrushBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type ZBrushBridgeStatus = {
  id: 'zbrush';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: ZBrushBridgeTarget[];
  install: ZBrushBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type ZBrushBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'zbrush-install.json');
}

function heartbeatPath(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', 'zbrush-heartbeat.json'));
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_ZBRUSH_BRIDGE_PORT;
}

function isDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverZBrushRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.ZBRUSH_ROOT?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.PROGRAMFILES) roots.push(resolve(process.env.PROGRAMFILES, 'Maxon ZBrush'));
  roots.push(resolve(join(home, 'Documents', 'ZBrushData')));
  roots.push(resolve(join(home, 'Public', 'Documents', 'ZBrushData')));
  return roots.filter((root, idx, arr) => isDir(root) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(scriptsDir: string): ZBrushBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  return {
    id: `zbrush::${resolvedDir}`,
    label: `ZBrush ${basename(resolvedDir) || 'scripts'}`,
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, ZBRUSH_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, ZBRUSH_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverZBrushBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): ZBrushBridgeTarget[] {
  const byDir = new Map<string, ZBrushBridgeTarget>();
  for (const root of discoverZBrushRoots(opts?.home)) {
    for (const candidate of [
      join(root, 'ZStartup', 'ZScripts'),
      join(root, 'ZStartup', 'ZPlugs64'),
      join(root, 'ZScripts'),
      root,
    ]) {
      if (isDir(candidate)) byDir.set(resolve(candidate), targetFromScriptsDir(candidate));
    }
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!/ZBrush/i.test(name)) continue;
      for (const candidate of [
        join(root, name, 'ZStartup', 'ZScripts'),
        join(root, name, 'ZStartup', 'ZPlugs64'),
      ]) {
        if (isDir(candidate)) byDir.set(resolve(candidate), targetFromScriptsDir(candidate));
      }
    }
  }
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readZBrushBridgeInstallRecord(): ZBrushBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as ZBrushBridgeInstallRecord;
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

function writeZBrushBridgeInstallRecord(rec: ZBrushBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearZBrushBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function zscriptPath(path: string): string {
  return path.replace(/\\/g, '/');
}

function buildZBrushScript(port: number): string {
  const hb = zscriptPath(heartbeatPath());
  return `// AssetCutter ZBrush Bridge
[VarDef,acHeartbeat,"${hb}"]
[VarDef,acPayload,"{\\"ok\\":true,\\"host\\":\\"zbrush\\",\\"port\\":${port}}"]
[FileNameSetNext,acHeartbeat]
[MemSaveToFile,acPayload,acHeartbeat]
[Note,"AssetCutter ZBrush Bridge heartbeat written. Return to AssetCutter and probe connection.",,2]
`;
}

async function probeZBrushBridge(): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath();
  if (!existsSync(p)) return { ok: false, message: 'ZBrush bridge heartbeat has not been seen yet. Run the installed ZScript, then probe connection.', heartbeatPath: p };
  try {
    const stat = statSync(p);
    const mins = Math.max(0, Math.round((Date.now() - stat.mtimeMs) / 60000));
    return { ok: true, message: `ZBrush bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `ZBrush bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getZBrushBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<ZBrushBridgeStatus> {
  const targets = discoverZBrushBridgeTargets(opts);
  const install = readZBrushBridgeInstallRecord();
  const port = install?.port || DEFAULT_ZBRUSH_BRIDGE_PORT;
  return {
    id: 'zbrush',
    name: 'ZBrush',
    description: 'One-click ZScript bridge using a local heartbeat probe.',
    defaultPort: DEFAULT_ZBRUSH_BRIDGE_PORT,
    port,
    roots: discoverZBrushRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeZBrushBridge(),
  };
}

function resolveInstallTargets(
  body: ZBrushBridgeInstallBody,
  discovered: ZBrushBridgeTarget[],
): { targets: ZBrushBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: ZBrushBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_zbrush_scripts_dir' };
  return { targets: unique };
}

export function installZBrushBridge(
  body: ZBrushBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverZBrushBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return { ok: false, error: resolved.error || 'no_zbrush_scripts_dir', message: 'No ZBrush scripts folder was found. Choose a ZStartup/ZScripts or ZPlugs64 folder manually.' };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildZBrushScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeZBrushBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'ZBrush bridge installed. Run the installed ZScript in ZBrush, then probe connection.' };
}

export function uninstallZBrushBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverZBrushBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readZBrushBridgeInstallRecord();
  const targets = new Map<string, ZBrushBridgeTarget>();
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
  clearZBrushBridgeInstallRecord();
  return { ok: true, removed };
}
