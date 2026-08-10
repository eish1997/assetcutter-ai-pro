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

export const DEFAULT_RHINO_BRIDGE_PORT = 7141;
export const RHINO_BRIDGE_SCRIPT_NAME = 'assetcutter_rhino_bridge.py';

export type RhinoBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type RhinoBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type RhinoBridgeStatus = {
  id: 'rhino';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: RhinoBridgeTarget[];
  install: RhinoBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type RhinoBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'rhino-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_RHINO_BRIDGE_PORT;
}

export function discoverRhinoRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.RHINO_USER_SCRIPTS?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'McNeel', 'Rhinoceros')));
  roots.push(resolve(join(home, 'AppData', 'Roaming', 'McNeel', 'Rhinoceros')));
  roots.push(resolve(join(home, 'Library', 'Application Support', 'McNeel', 'Rhinoceros')));
  const out: string[] = [];
  for (const root of roots) {
    try {
      if (existsSync(root) && statSync(root).isDirectory() && !out.includes(root)) out.push(root);
    } catch {
      /* ignore */
    }
  }
  return out;
}

function targetFromScriptsDir(scriptsDir: string): RhinoBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  const parent = basename(resolve(join(resolvedDir, '..')));
  return {
    id: `${parent || 'rhino'}::${resolvedDir}`,
    label: parent ? `Rhino ${parent}` : `Rhino (${resolvedDir})`,
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, RHINO_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, RHINO_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverRhinoBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): RhinoBridgeTarget[] {
  const byDir = new Map<string, RhinoBridgeTarget>();
  for (const root of discoverRhinoRoots(opts?.home)) {
    const direct = basename(root).toLowerCase() === 'scripts' ? root : '';
    if (direct) byDir.set(resolve(direct), targetFromScriptsDir(direct));
    let entries: string[] = [];
    try {
      entries = readdirSync(root);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      if (!/^\d+\.0$/.test(name)) continue;
      const versionRoot = join(root, name);
      try {
        if (!statSync(versionRoot).isDirectory()) continue;
      } catch {
        continue;
      }
      byDir.set(resolve(join(versionRoot, 'scripts')), targetFromScriptsDir(join(versionRoot, 'scripts')));
      byDir.set(resolve(join(versionRoot, 'Plug-ins', 'PythonPlugins')), targetFromScriptsDir(join(versionRoot, 'Plug-ins', 'PythonPlugins')));
    }
  }
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readRhinoBridgeInstallRecord(): RhinoBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as RhinoBridgeInstallRecord;
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

function writeRhinoBridgeInstallRecord(rec: RhinoBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearRhinoBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildRhinoBridgeScript(port: number): string {
  return `# AssetCutter Rhino Bridge
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
                import Rhino
                version = str(Rhino.RhinoApp.Version)
            except Exception:
                pass
            self._send(200, {"ok": True, "host": "rhino", "version": version})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def _serve():
    try:
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        print("[AssetCutter Rhino Bridge] ready on 127.0.0.1:%s" % PORT)
    except Exception as e:
        print("[AssetCutter Rhino Bridge] failed: %s" % e)

threading.Thread(target=_serve).start()
`;
}

async function probeRhinoBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `Rhino bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean; version?: string } | null;
    return json && json.ok
      ? { ok: true, message: `Rhino bridge connected${json.version ? ` (${json.version})` : ''}` }
      : { ok: false, message: 'Rhino bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Rhino bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getRhinoBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<RhinoBridgeStatus> {
  const targets = discoverRhinoBridgeTargets(opts);
  const install = readRhinoBridgeInstallRecord();
  const port = install?.port || DEFAULT_RHINO_BRIDGE_PORT;
  return {
    id: 'rhino',
    name: 'Rhino',
    description: 'One-click Rhino Python script bridge using a local HTTP probe.',
    defaultPort: DEFAULT_RHINO_BRIDGE_PORT,
    port,
    roots: discoverRhinoRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeRhinoBridge(port),
  };
}

function resolveInstallTargets(body: RhinoBridgeInstallBody, discovered: RhinoBridgeTarget[]): { targets: RhinoBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: RhinoBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_rhino_scripts_dir' };
  return { targets: unique };
}

export function installRhinoBridge(
  body: RhinoBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverRhinoBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_rhino_scripts_dir',
      message: 'No Rhino scripts folder was found. Choose a Rhino scripts folder manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildRhinoBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeRhinoBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Rhino bridge installed. Run the AssetCutter Rhino script in Rhino, then probe connection.' };
}

export function uninstallRhinoBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverRhinoBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readRhinoBridgeInstallRecord();
  const targets = new Map<string, RhinoBridgeTarget>();
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
  clearRhinoBridgeInstallRecord();
  return { ok: true, removed };
}
