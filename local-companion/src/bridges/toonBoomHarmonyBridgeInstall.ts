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

export const DEFAULT_TOON_BOOM_HARMONY_BRIDGE_PORT = 7411;
export const TOON_BOOM_HARMONY_BRIDGE_SCRIPT_NAME = 'assetcutter_harmony_bridge.js';

export type ToonBoomHarmonyBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type ToonBoomHarmonyBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type ToonBoomHarmonyBridgeStatus = {
  id: 'toon-boom-harmony';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: ToonBoomHarmonyBridgeTarget[];
  install: ToonBoomHarmonyBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type ToonBoomHarmonyBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'toon-boom-harmony-install.json');
}

function heartbeatPath(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', 'toon-boom-harmony-heartbeat.json'));
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_TOON_BOOM_HARMONY_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverToonBoomHarmonyRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.TOON_BOOM_HARMONY_SCRIPTS_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.APPDATA) {
    roots.push(resolve(join(process.env.APPDATA, 'Toon Boom Animation', 'Toon Boom Harmony', 'scripts')));
    roots.push(resolve(join(process.env.APPDATA, 'Toon Boom Animation')));
  }
  roots.push(resolve(join(home, 'Documents', 'Toon Boom Animation', 'Harmony', 'scripts')));
  roots.push(resolve(join(home, 'OneDrive', 'Documents', 'Toon Boom Animation', 'Harmony', 'scripts')));
  return roots.filter((root, idx, arr) => (rootExists(root) || /Harmony[\\/]scripts$/i.test(root)) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(scriptsDir: string): ToonBoomHarmonyBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  const parent = basename(resolve(join(resolvedDir, '..')));
  return {
    id: `toon-boom-harmony::${resolvedDir}`,
    label: parent ? `Harmony ${parent}` : 'Harmony scripts',
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, TOON_BOOM_HARMONY_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, TOON_BOOM_HARMONY_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverToonBoomHarmonyBridgeTargets(opts?: {
  home?: string;
  scriptsDirs?: string[];
}): ToonBoomHarmonyBridgeTarget[] {
  const byDir = new Map<string, ToonBoomHarmonyBridgeTarget>();
  for (const root of discoverToonBoomHarmonyRoots(opts?.home)) {
    const direct = /scripts$/i.test(root) ? root : join(root, 'scripts');
    byDir.set(resolve(direct), targetFromScriptsDir(direct));
  }
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readToonBoomHarmonyBridgeInstallRecord(): ToonBoomHarmonyBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as ToonBoomHarmonyBridgeInstallRecord;
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

function writeToonBoomHarmonyBridgeInstallRecord(rec: ToonBoomHarmonyBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearToonBoomHarmonyBridgeInstallRecord(): void {
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

function buildToonBoomHarmonyBridgeScript(port: number): string {
  const hb = heartbeatPath();
  return `// AssetCutter Toon Boom Harmony Bridge
// Auto-generated by AssetCutter local companion.
function assetCutterWriteHeartbeat() {
  var heartbeatPath = "${jsString(hb)}";
  var payload = '{"ok":true,"host":"toon-boom-harmony","name":"Toon Boom Harmony","port":${port},"at":"' + new Date().toUTCString() + '"}';
  try {
    if (typeof QFile !== "undefined") {
      var f = new QFile(heartbeatPath);
      var dirPath = heartbeatPath.replace(/[\\\\/][^\\\\/]+$/, "");
      if (typeof QDir !== "undefined") {
        var d = new QDir();
        d.mkpath(dirPath);
      }
      if (f.open(QIODevice.WriteOnly | QIODevice.Text)) {
        var stream = new QTextStream(f);
        stream.writeString(payload);
        f.close();
      }
    } else if (typeof File !== "undefined") {
      var file = new File(heartbeatPath);
      file.open("w");
      file.write(payload);
      file.close();
    }
    if (typeof MessageLog !== "undefined") MessageLog.trace("[AssetCutter Harmony Bridge] heartbeat: " + heartbeatPath);
  } catch (e) {
    if (typeof MessageLog !== "undefined") MessageLog.trace("[AssetCutter Harmony Bridge] failed: " + e);
  }
}

assetCutterWriteHeartbeat();
`;
}

async function probeToonBoomHarmonyBridge(): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath();
  if (!existsSync(p)) {
    return { ok: false, message: 'Harmony bridge heartbeat has not been seen yet. Add and run the AssetCutter script from Harmony Scripts.', heartbeatPath: p };
  }
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string };
    if (json.host !== 'toon-boom-harmony') return { ok: false, message: 'Harmony bridge heartbeat is invalid.', heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `Harmony bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Harmony bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getToonBoomHarmonyBridgeStatus(opts?: {
  home?: string;
  scriptsDirs?: string[];
}): Promise<ToonBoomHarmonyBridgeStatus> {
  const targets = discoverToonBoomHarmonyBridgeTargets(opts);
  const install = readToonBoomHarmonyBridgeInstallRecord();
  const port = install?.port || DEFAULT_TOON_BOOM_HARMONY_BRIDGE_PORT;
  return {
    id: 'toon-boom-harmony',
    name: 'Toon Boom Harmony',
    description: 'One-click JavaScript bridge using a local heartbeat probe.',
    defaultPort: DEFAULT_TOON_BOOM_HARMONY_BRIDGE_PORT,
    port,
    roots: discoverToonBoomHarmonyRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeToonBoomHarmonyBridge(),
  };
}

function resolveInstallTargets(
  body: ToonBoomHarmonyBridgeInstallBody,
  discovered: ToonBoomHarmonyBridgeTarget[],
): { targets: ToonBoomHarmonyBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: ToonBoomHarmonyBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_toon_boom_harmony_scripts_dir' };
  return { targets: unique };
}

export function installToonBoomHarmonyBridge(
  body: ToonBoomHarmonyBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverToonBoomHarmonyBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_toon_boom_harmony_scripts_dir',
      message: 'No Toon Boom Harmony scripts folder was found. Choose a Harmony user scripts folder manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildToonBoomHarmonyBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeToonBoomHarmonyBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Harmony bridge installed. Add/run the AssetCutter script from Harmony Scripts, then probe connection.' };
}

export function uninstallToonBoomHarmonyBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverToonBoomHarmonyBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readToonBoomHarmonyBridgeInstallRecord();
  const targets = new Map<string, ToonBoomHarmonyBridgeTarget>();
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
  clearToonBoomHarmonyBridgeInstallRecord();
  return { ok: true, removed };
}
