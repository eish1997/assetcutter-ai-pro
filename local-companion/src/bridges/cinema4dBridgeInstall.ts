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

export const DEFAULT_CINEMA4D_BRIDGE_PORT = 7061;
export const CINEMA4D_BRIDGE_SCRIPT_NAME = 'assetcutter_cinema4d_bridge.py';

export type Cinema4DBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type Cinema4DBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type Cinema4DBridgeStatus = {
  id: 'cinema-4d';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: Cinema4DBridgeTarget[];
  install: Cinema4DBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type Cinema4DBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'cinema-4d-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_CINEMA4D_BRIDGE_PORT;
}

export function discoverCinema4DRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.CINEMA4D_USER_ROOT?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'MAXON')));
  roots.push(resolve(join(home, 'AppData', 'Roaming', 'MAXON')));
  roots.push(resolve(join(home, 'Library', 'Preferences', 'MAXON')));
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

function targetFromScriptsDir(scriptsDir: string): Cinema4DBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  const parent = basename(resolve(join(resolvedDir, '..', '..')));
  return {
    id: `${parent || 'cinema-4d'}::${resolvedDir}`,
    label: parent ? `Cinema 4D ${parent}` : `Cinema 4D (${resolvedDir})`,
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, CINEMA4D_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, CINEMA4D_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverCinema4DBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): Cinema4DBridgeTarget[] {
  const byDir = new Map<string, Cinema4DBridgeTarget>();
  for (const root of discoverCinema4DRoots(opts?.home)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(root);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      const pref = join(root, name);
      try {
        if (!statSync(pref).isDirectory()) continue;
      } catch {
        continue;
      }
      if (!/Maxon Cinema 4D|Cinema 4D|C4D/i.test(name)) continue;
      byDir.set(resolve(join(pref, 'library', 'scripts')), targetFromScriptsDir(join(pref, 'library', 'scripts')));
    }
  }
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readCinema4DBridgeInstallRecord(): Cinema4DBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Cinema4DBridgeInstallRecord;
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

function writeCinema4DBridgeInstallRecord(rec: Cinema4DBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearCinema4DBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildCinema4DBridgeScript(port: number): string {
  return `# AssetCutter Cinema 4D Bridge
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

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
                import c4d
                version = str(c4d.GetC4DVersion())
            except Exception:
                pass
            self._send(200, {"ok": True, "host": "cinema-4d", "version": version})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def _serve():
    try:
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        print("[AssetCutter Cinema 4D Bridge] ready on 127.0.0.1:%s" % PORT)
    except OSError as e:
        print("[AssetCutter Cinema 4D Bridge] failed: %s" % e)

threading.Thread(target=_serve, daemon=True).start()
`;
}

async function probeCinema4DBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `Cinema 4D bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean; version?: string } | null;
    return json && json.ok
      ? { ok: true, message: `Cinema 4D bridge connected${json.version ? ` (${json.version})` : ''}` }
      : { ok: false, message: 'Cinema 4D bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Cinema 4D bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getCinema4DBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<Cinema4DBridgeStatus> {
  const targets = discoverCinema4DBridgeTargets(opts);
  const install = readCinema4DBridgeInstallRecord();
  const port = install?.port || DEFAULT_CINEMA4D_BRIDGE_PORT;
  return {
    id: 'cinema-4d',
    name: 'Cinema 4D',
    description: 'One-click Python script bridge using a local HTTP probe.',
    defaultPort: DEFAULT_CINEMA4D_BRIDGE_PORT,
    port,
    roots: discoverCinema4DRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeCinema4DBridge(port),
  };
}

function resolveInstallTargets(
  body: Cinema4DBridgeInstallBody,
  discovered: Cinema4DBridgeTarget[],
): { targets: Cinema4DBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: Cinema4DBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_cinema4d_scripts_dir' };
  return { targets: unique };
}

export function installCinema4DBridge(
  body: Cinema4DBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverCinema4DBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_cinema4d_scripts_dir',
      message: 'No Cinema 4D scripts folder was found. Choose a library/scripts folder manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildCinema4DBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeCinema4DBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Cinema 4D bridge installed. Run the AssetCutter script in Cinema 4D, then probe connection.' };
}

export function uninstallCinema4DBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverCinema4DBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readCinema4DBridgeInstallRecord();
  const targets = new Map<string, Cinema4DBridgeTarget>();
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
  clearCinema4DBridgeInstallRecord();
  return { ok: true, removed };
}
