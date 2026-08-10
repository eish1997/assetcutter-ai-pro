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

export const DEFAULT_OPENTOONZ_BRIDGE_PORT = 7421;
export const OPENTOONZ_BRIDGE_SCRIPT_NAME = 'assetcutter_opentoonz_bridge.js';

export type OpenToonzBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type OpenToonzBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type OpenToonzBridgeStatus = {
  id: 'opentoonz';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: OpenToonzBridgeTarget[];
  install: OpenToonzBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type OpenToonzBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'opentoonz-install.json');
}

function heartbeatPath(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', 'opentoonz-heartbeat.json'));
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_OPENTOONZ_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverOpenToonzRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.OPENTOONZ_SCRIPTS_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  roots.push(resolve(join(home, 'Documents', 'OpenToonz stuff', 'library', 'script')));
  roots.push(resolve(join(home, 'OneDrive', 'Documents', 'OpenToonz stuff', 'library', 'script')));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'OpenToonz stuff', 'library', 'script')));
  return roots.filter((root, idx, arr) => (rootExists(root) || /OpenToonz stuff[\\/]library[\\/]script$/i.test(root)) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(scriptsDir: string): OpenToonzBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  const parent = basename(resolve(join(resolvedDir, '..')));
  return {
    id: `opentoonz::${resolvedDir}`,
    label: parent ? `OpenToonz ${parent}` : 'OpenToonz scripts',
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, OPENTOONZ_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, OPENTOONZ_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverOpenToonzBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): OpenToonzBridgeTarget[] {
  const byDir = new Map<string, OpenToonzBridgeTarget>();
  for (const root of discoverOpenToonzRoots(opts?.home)) byDir.set(resolve(root), targetFromScriptsDir(root));
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readOpenToonzBridgeInstallRecord(): OpenToonzBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as OpenToonzBridgeInstallRecord;
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

function writeOpenToonzBridgeInstallRecord(rec: OpenToonzBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearOpenToonzBridgeInstallRecord(): void {
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

function buildOpenToonzBridgeScript(port: number): string {
  const hb = heartbeatPath();
  return `// AssetCutter OpenToonz Bridge
// Auto-generated by AssetCutter local companion.
var heartbeatPath = "${jsString(hb)}";
var payload = '{"ok":true,"host":"opentoonz","name":"OpenToonz","port":${port},"at":"' + new Date().toUTCString() + '"}';

function assetCutterWriteHeartbeat() {
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
  } catch (e) {
    if (typeof console !== "undefined" && console.log) console.log(e);
  }
}

assetCutterWriteHeartbeat();
`;
}

async function probeOpenToonzBridge(): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath();
  if (!existsSync(p)) return { ok: false, message: 'OpenToonz bridge heartbeat has not been seen yet. Run the AssetCutter script from OpenToonz Run Script.', heartbeatPath: p };
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string };
    if (json.host !== 'opentoonz') return { ok: false, message: 'OpenToonz bridge heartbeat is invalid.', heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `OpenToonz bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `OpenToonz bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getOpenToonzBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<OpenToonzBridgeStatus> {
  const targets = discoverOpenToonzBridgeTargets(opts);
  const install = readOpenToonzBridgeInstallRecord();
  const port = install?.port || DEFAULT_OPENTOONZ_BRIDGE_PORT;
  return {
    id: 'opentoonz',
    name: 'OpenToonz',
    description: 'One-click ToonzScript JavaScript bridge using a local heartbeat probe.',
    defaultPort: DEFAULT_OPENTOONZ_BRIDGE_PORT,
    port,
    roots: discoverOpenToonzRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeOpenToonzBridge(),
  };
}

function resolveInstallTargets(
  body: OpenToonzBridgeInstallBody,
  discovered: OpenToonzBridgeTarget[],
): { targets: OpenToonzBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: OpenToonzBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_opentoonz_scripts_dir' };
  return { targets: unique };
}

export function installOpenToonzBridge(
  body: OpenToonzBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverOpenToonzBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_opentoonz_scripts_dir',
      message: 'No OpenToonz script folder was found. Choose the OpenToonz stuff/library/script folder manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildOpenToonzBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeOpenToonzBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'OpenToonz bridge installed. Run the AssetCutter script in OpenToonz Run Script, then probe connection.' };
}

export function uninstallOpenToonzBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverOpenToonzBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readOpenToonzBridgeInstallRecord();
  const targets = new Map<string, OpenToonzBridgeTarget>();
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
  clearOpenToonzBridgeInstallRecord();
  return { ok: true, removed };
}
