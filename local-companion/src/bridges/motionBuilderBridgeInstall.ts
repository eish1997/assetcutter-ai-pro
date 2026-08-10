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

export const DEFAULT_MOTIONBUILDER_BRIDGE_PORT = 7181;
export const MOTIONBUILDER_BRIDGE_SCRIPT_NAME = 'assetcutter_motionbuilder_bridge.py';

export type MotionBuilderBridgeVersion = {
  id: string;
  label: string;
  startupDir: string;
  startupPath: string;
  hasStartupBridge: boolean;
};

export type MotionBuilderBridgeInstallRecord = {
  port: number;
  installedAt: string;
  startupDirs: string[];
  versionIds: string[];
};

export type MotionBuilderBridgeStatus = {
  id: 'motionbuilder';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  versions: MotionBuilderBridgeVersion[];
  install: MotionBuilderBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type MotionBuilderBridgeInstallBody = {
  versions?: string[];
  startupDirs?: string[];
  port?: number;
  home?: string;
};

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function installRecordPath(): string {
  return join(bridgesStateDir(), 'motionbuilder-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_MOTIONBUILDER_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverMotionBuilderRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.MOTIONBUILDER_USER_ROOT?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'Autodesk', 'MotionBuilder')));
  roots.push(resolve(join(home, 'AppData', 'Roaming', 'Autodesk', 'MotionBuilder')));
  roots.push(resolve(join(home, 'Documents', 'MB')));
  return roots.filter((root, idx, arr) => rootExists(root) && arr.indexOf(root) === idx);
}

function versionFromStartupDir(startupDir: string): MotionBuilderBridgeVersion {
  const resolvedDir = resolve(startupDir);
  const parent = basename(resolve(join(resolvedDir, '..', '..')));
  return {
    id: `${parent || 'motionbuilder'}::${resolvedDir}`,
    label: parent ? `MotionBuilder ${parent}` : `MotionBuilder (${resolvedDir})`,
    startupDir: resolvedDir,
    startupPath: join(resolvedDir, MOTIONBUILDER_BRIDGE_SCRIPT_NAME),
    hasStartupBridge: existsSync(join(resolvedDir, MOTIONBUILDER_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverMotionBuilderBridgeVersions(opts?: { home?: string; startupDirs?: string[] }): MotionBuilderBridgeVersion[] {
  const byDir = new Map<string, MotionBuilderBridgeVersion>();
  for (const root of discoverMotionBuilderRoots(opts?.home)) {
    const direct = basename(root).toLowerCase() === 'pythonstartup' ? root : '';
    if (direct) byDir.set(resolve(direct), versionFromStartupDir(direct));
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!/^\d{4}$/.test(name) && !/^MotionBuilder\s+\d{4}$/i.test(name)) continue;
      const versionRoot = join(root, name);
      if (!rootExists(versionRoot)) continue;
      for (const rel of [
        ['config', 'PythonStartup'],
        ['PythonStartup'],
        ['startup'],
      ]) {
        byDir.set(resolve(join(versionRoot, ...rel)), versionFromStartupDir(join(versionRoot, ...rel)));
      }
    }
  }
  for (const dirRaw of opts?.startupDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, versionFromStartupDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readMotionBuilderBridgeInstallRecord(): MotionBuilderBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as MotionBuilderBridgeInstallRecord;
    return {
      port: normalizePort(raw.port),
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      startupDirs: Array.isArray(raw.startupDirs) ? raw.startupDirs.map(String) : [],
      versionIds: Array.isArray(raw.versionIds) ? raw.versionIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function writeMotionBuilderBridgeInstallRecord(rec: MotionBuilderBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearMotionBuilderBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildMotionBuilderStartupScript(port: number): string {
  return `# AssetCutter MotionBuilder Bridge
import json
import threading
try:
    from http.server import BaseHTTPRequestHandler, HTTPServer
except Exception:
    from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer

PORT = ${port}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return
    def _send(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.path.split("?", 1)[0] == "/health":
            version = ""
            try:
                import pyfbsdk
                version = str(pyfbsdk.FBSystem().Version)
            except Exception:
                pass
            self._send(200, {"ok": True, "host": "motionbuilder", "version": version})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def _serve():
    try:
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        print("[AssetCutter MotionBuilder Bridge] ready on 127.0.0.1:%s" % PORT)
    except Exception as e:
        print("[AssetCutter MotionBuilder Bridge] failed: %s" % e)

threading.Thread(target=_serve).start()
`;
}

async function probeMotionBuilderBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `MotionBuilder bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean; version?: string } | null;
    return json && json.ok
      ? { ok: true, message: `MotionBuilder bridge connected${json.version ? ` (${json.version})` : ''}` }
      : { ok: false, message: 'MotionBuilder bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `MotionBuilder bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getMotionBuilderBridgeStatus(opts?: { home?: string; startupDirs?: string[] }): Promise<MotionBuilderBridgeStatus> {
  const versions = discoverMotionBuilderBridgeVersions(opts);
  const install = readMotionBuilderBridgeInstallRecord();
  const port = install?.port || DEFAULT_MOTIONBUILDER_BRIDGE_PORT;
  return {
    id: 'motionbuilder',
    name: 'MotionBuilder',
    description: 'One-click Python startup bridge using a local HTTP probe.',
    defaultPort: DEFAULT_MOTIONBUILDER_BRIDGE_PORT,
    port,
    roots: discoverMotionBuilderRoots(opts?.home),
    versions,
    install,
    installed: versions.some((v) => v.hasStartupBridge) || Boolean(install?.startupDirs.length),
    probe: await probeMotionBuilderBridge(port),
  };
}

function resolveInstallTargets(
  body: MotionBuilderBridgeInstallBody,
  discovered: MotionBuilderBridgeVersion[],
): { targets: MotionBuilderBridgeVersion[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: MotionBuilderBridgeVersion[] = [];
  for (const id of body.versions || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.startupDirs || []) {
    const startupDir = resolve(String(dirRaw || '').trim());
    if (startupDir) targets.push(versionFromStartupDir(startupDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.startupDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_motionbuilder_startup_dir' };
  return { targets: unique };
}

export function installMotionBuilderBridge(
  body: MotionBuilderBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ versionId: string; startupDir: string; startupPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverMotionBuilderBridgeVersions({ home: body.home, startupDirs: body.startupDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_motionbuilder_startup_dir',
      message: 'No MotionBuilder PythonStartup folder was found. Choose a PythonStartup folder manually.',
    };
  }
  const installed: Array<{ versionId: string; startupDir: string; startupPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.startupDir, { recursive: true });
    writeFileSync(target.startupPath, buildMotionBuilderStartupScript(port), 'utf8');
    installed.push({ versionId: target.id, startupDir: target.startupDir, startupPath: target.startupPath });
  }
  writeMotionBuilderBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    startupDirs: installed.map((x) => x.startupDir),
    versionIds: installed.map((x) => x.versionId),
  });
  return { ok: true, port, installed, message: 'MotionBuilder bridge installed. Restart MotionBuilder, then probe connection.' };
}

export function uninstallMotionBuilderBridge(
  body: { versions?: string[]; startupDirs?: string[] } = {},
): { ok: true; removed: Array<{ startupDir: string; startupPath: string }> } {
  const discovered = discoverMotionBuilderBridgeVersions({ startupDirs: body.startupDirs });
  const record = readMotionBuilderBridgeInstallRecord();
  const targets = new Map<string, MotionBuilderBridgeVersion>();
  for (const v of discovered) {
    if (!body.versions || body.versions.length === 0 || body.versions.includes(v.id)) targets.set(v.startupDir, v);
  }
  for (const dir of record?.startupDirs || []) targets.set(resolve(dir), versionFromStartupDir(dir));
  const removed: Array<{ startupDir: string; startupPath: string }> = [];
  for (const target of targets.values()) {
    if (!existsSync(target.startupPath)) continue;
    try {
      unlinkSync(target.startupPath);
      removed.push({ startupDir: target.startupDir, startupPath: target.startupPath });
    } catch {
      /* ignore */
    }
  }
  clearMotionBuilderBridgeInstallRecord();
  return { ok: true, removed };
}
