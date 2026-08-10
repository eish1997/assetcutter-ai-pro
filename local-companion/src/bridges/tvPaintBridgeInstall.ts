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

export const DEFAULT_TVPAINT_BRIDGE_PORT = 7481;
export const TVPAINT_BRIDGE_SCRIPT_NAME = 'assetcutter_tvpaint_bridge.grg';

export type TvPaintBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type TvPaintBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type TvPaintBridgeStatus = {
  id: 'tvpaint';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: TvPaintBridgeTarget[];
  install: TvPaintBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type TvPaintBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'tvpaint-install.json');
}

function heartbeatPath(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', 'tvpaint-heartbeat.json'));
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_TVPAINT_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverTvPaintRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.TVPAINT_SCRIPTS_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  roots.push(resolve(join(home, 'Documents', 'TVPaint Animation', 'George Scripts')));
  roots.push(resolve(join(home, 'OneDrive', 'Documents', 'TVPaint Animation', 'George Scripts')));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'TVPaint Animation', 'George Scripts')));
  return roots.filter((root, idx, arr) => (rootExists(root) || /TVPaint Animation[\\/]George Scripts$/i.test(root)) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(scriptsDir: string): TvPaintBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  const parent = basename(resolve(join(resolvedDir, '..')));
  return {
    id: `tvpaint::${resolvedDir}`,
    label: parent ? `TVPaint ${parent}` : 'TVPaint George scripts',
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, TVPAINT_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, TVPAINT_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverTvPaintBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): TvPaintBridgeTarget[] {
  const byDir = new Map<string, TvPaintBridgeTarget>();
  for (const root of discoverTvPaintRoots(opts?.home)) byDir.set(resolve(root), targetFromScriptsDir(root));
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readTvPaintBridgeInstallRecord(): TvPaintBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as TvPaintBridgeInstallRecord;
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

function writeTvPaintBridgeInstallRecord(rec: TvPaintBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearTvPaintBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function georgeString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildTvPaintBridgeScript(port: number): string {
  const hb = heartbeatPath();
  const payload = `{"ok":true,"host":"tvpaint","name":"TVPaint Animation","port":${port}}`;
  return `// AssetCutter TVPaint Animation Bridge
// Auto-generated by AssetCutter local companion.
tv_WriteTextFile "${georgeString(hb)}" "${georgeString(payload)}"
`;
}

async function probeTvPaintBridge(): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath();
  if (!existsSync(p)) return { ok: false, message: 'TVPaint bridge heartbeat has not been seen yet. Run the AssetCutter George script inside TVPaint.', heartbeatPath: p };
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string };
    if (json.host !== 'tvpaint') return { ok: false, message: 'TVPaint bridge heartbeat is invalid.', heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `TVPaint bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `TVPaint bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getTvPaintBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<TvPaintBridgeStatus> {
  const targets = discoverTvPaintBridgeTargets(opts);
  const install = readTvPaintBridgeInstallRecord();
  const port = install?.port || DEFAULT_TVPAINT_BRIDGE_PORT;
  return {
    id: 'tvpaint',
    name: 'TVPaint Animation',
    description: 'One-click George script bridge using a local heartbeat probe.',
    defaultPort: DEFAULT_TVPAINT_BRIDGE_PORT,
    port,
    roots: discoverTvPaintRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeTvPaintBridge(),
  };
}

function resolveInstallTargets(
  body: TvPaintBridgeInstallBody,
  discovered: TvPaintBridgeTarget[],
): { targets: TvPaintBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: TvPaintBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_tvpaint_scripts_dir' };
  return { targets: unique };
}

export function installTvPaintBridge(
  body: TvPaintBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverTvPaintBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_tvpaint_scripts_dir',
      message: 'No TVPaint George Scripts folder was found. Choose the scripts folder manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildTvPaintBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeTvPaintBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'TVPaint bridge installed. Run the AssetCutter George script inside TVPaint, then probe connection.' };
}

export function uninstallTvPaintBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverTvPaintBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readTvPaintBridgeInstallRecord();
  const targets = new Map<string, TvPaintBridgeTarget>();
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
  clearTvPaintBridgeInstallRecord();
  return { ok: true, removed };
}
