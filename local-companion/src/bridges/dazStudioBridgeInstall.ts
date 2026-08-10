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

export const DEFAULT_DAZ_STUDIO_BRIDGE_PORT = 7501;
export const DAZ_STUDIO_BRIDGE_SCRIPT_NAME = 'assetcutter_daz_studio_bridge.dsa';

export type DazStudioBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type DazStudioBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type DazStudioBridgeStatus = {
  id: 'daz-studio';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: DazStudioBridgeTarget[];
  install: DazStudioBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type DazStudioBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'daz-studio-install.json');
}

function heartbeatPath(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', 'daz-studio-heartbeat.json'));
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_DAZ_STUDIO_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverDazStudioRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.DAZ_STUDIO_SCRIPTS_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  roots.push(resolve(join(home, 'Documents', 'DAZ 3D', 'Studio', 'My Library', 'Scripts', 'AssetCutter')));
  roots.push(resolve(join(home, 'OneDrive', 'Documents', 'DAZ 3D', 'Studio', 'My Library', 'Scripts', 'AssetCutter')));
  if (process.env.PUBLIC) roots.push(resolve(join(process.env.PUBLIC, 'Documents', 'My DAZ 3D Library', 'Scripts', 'AssetCutter')));
  return roots.filter((root, idx, arr) => (rootExists(root) || /DAZ 3D[\\/]Studio[\\/]My Library[\\/]Scripts[\\/]AssetCutter$|My DAZ 3D Library[\\/]Scripts[\\/]AssetCutter$/i.test(root)) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(scriptsDir: string): DazStudioBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  const parent = basename(resolve(join(resolvedDir, '..')));
  return {
    id: `daz-studio::${resolvedDir}`,
    label: parent ? `Daz Studio ${parent}` : 'Daz Studio scripts',
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, DAZ_STUDIO_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, DAZ_STUDIO_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverDazStudioBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): DazStudioBridgeTarget[] {
  const byDir = new Map<string, DazStudioBridgeTarget>();
  for (const root of discoverDazStudioRoots(opts?.home)) byDir.set(resolve(root), targetFromScriptsDir(root));
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readDazStudioBridgeInstallRecord(): DazStudioBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as DazStudioBridgeInstallRecord;
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

function writeDazStudioBridgeInstallRecord(rec: DazStudioBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearDazStudioBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function jsString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildDazStudioBridgeScript(port: number): string {
  const hb = heartbeatPath();
  return `// AssetCutter Daz Studio Bridge
// Auto-generated by AssetCutter local companion.
var heartbeatPath = "${jsString(hb)}";
var payload = '{"ok":true,"host":"daz-studio","name":"Daz Studio","port":${port},"at":"' + new Date().toUTCString() + '"}';

try {
  var f = new DzFile(heartbeatPath);
  var dirPath = heartbeatPath.replace(/[\\\\/][^\\\\/]+$/, "");
  var d = new DzDir();
  d.mkpath(dirPath);
  if (f.open(DzFile.WriteOnly | DzFile.Text)) {
    f.write(payload);
    f.close();
  }
} catch (e) {
  print(e);
}
`;
}

async function probeDazStudioBridge(): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath();
  if (!existsSync(p)) return { ok: false, message: 'Daz Studio bridge heartbeat has not been seen yet. Run the AssetCutter script inside Daz Studio.', heartbeatPath: p };
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string };
    if (json.host !== 'daz-studio') return { ok: false, message: 'Daz Studio bridge heartbeat is invalid.', heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `Daz Studio bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Daz Studio bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getDazStudioBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<DazStudioBridgeStatus> {
  const targets = discoverDazStudioBridgeTargets(opts);
  const install = readDazStudioBridgeInstallRecord();
  const port = install?.port || DEFAULT_DAZ_STUDIO_BRIDGE_PORT;
  return {
    id: 'daz-studio',
    name: 'Daz Studio',
    description: 'One-click DzScript bridge using a local heartbeat probe.',
    defaultPort: DEFAULT_DAZ_STUDIO_BRIDGE_PORT,
    port,
    roots: discoverDazStudioRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeDazStudioBridge(),
  };
}

function resolveInstallTargets(
  body: DazStudioBridgeInstallBody,
  discovered: DazStudioBridgeTarget[],
): { targets: DazStudioBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: DazStudioBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_daz_studio_scripts_dir' };
  return { targets: unique };
}

export function installDazStudioBridge(
  body: DazStudioBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverDazStudioBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_daz_studio_scripts_dir',
      message: 'No Daz Studio Scripts folder was found. Choose the Scripts folder manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildDazStudioBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeDazStudioBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Daz Studio bridge installed. Run the AssetCutter script inside Daz Studio, then probe connection.' };
}

export function uninstallDazStudioBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverDazStudioBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readDazStudioBridgeInstallRecord();
  const targets = new Map<string, DazStudioBridgeTarget>();
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
  clearDazStudioBridgeInstallRecord();
  return { ok: true, removed };
}
