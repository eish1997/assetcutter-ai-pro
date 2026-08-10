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

export const DEFAULT_DAVINCI_RESOLVE_BRIDGE_PORT = 7071;
export const DAVINCI_RESOLVE_BRIDGE_SCRIPT_NAME = 'assetcutter_resolve_bridge.py';

export type DavinciResolveBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type DavinciResolveBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type DavinciResolveBridgeStatus = {
  id: 'davinci-resolve';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: DavinciResolveBridgeTarget[];
  install: DavinciResolveBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type DavinciResolveBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'davinci-resolve-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_DAVINCI_RESOLVE_BRIDGE_PORT;
}

export function discoverDavinciResolveRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.RESOLVE_SCRIPT_API?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.PROGRAMDATA) roots.push(resolve(join(process.env.PROGRAMDATA, 'Blackmagic Design', 'DaVinci Resolve', 'Fusion', 'Scripts')));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Fusion', 'Scripts')));
  roots.push(resolve(join(home, 'AppData', 'Roaming', 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Fusion', 'Scripts')));
  roots.push(resolve(join(home, 'Library', 'Application Support', 'Blackmagic Design', 'DaVinci Resolve', 'Fusion', 'Scripts')));
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

function targetFromScriptsDir(scriptsDir: string): DavinciResolveBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  const labelBase = basename(resolvedDir) || 'Scripts';
  return {
    id: `${labelBase}::${resolvedDir}`,
    label: `DaVinci Resolve ${labelBase}`,
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, DAVINCI_RESOLVE_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, DAVINCI_RESOLVE_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverDavinciResolveBridgeTargets(opts?: {
  home?: string;
  scriptsDirs?: string[];
}): DavinciResolveBridgeTarget[] {
  const byDir = new Map<string, DavinciResolveBridgeTarget>();
  for (const root of discoverDavinciResolveRoots(opts?.home)) {
    byDir.set(resolve(root), targetFromScriptsDir(root));
    for (const sub of ['Comp', 'Edit', 'Utility']) {
      const p = join(root, sub);
      try {
        if (existsSync(p) && statSync(p).isDirectory()) byDir.set(resolve(p), targetFromScriptsDir(p));
      } catch {
        /* ignore */
      }
    }
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      names = [];
    }
    for (const name of names) {
      const p = join(root, name);
      try {
        if (statSync(p).isDirectory()) byDir.set(resolve(p), targetFromScriptsDir(p));
      } catch {
        /* ignore */
      }
    }
  }
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readDavinciResolveBridgeInstallRecord(): DavinciResolveBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as DavinciResolveBridgeInstallRecord;
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

function writeDavinciResolveBridgeInstallRecord(rec: DavinciResolveBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearDavinciResolveBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildDavinciResolveBridgeScript(port: number): string {
  return `# AssetCutter DaVinci Resolve Bridge
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
            self._send(200, {"ok": True, "host": "davinci-resolve"})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def _serve():
    try:
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        print("[AssetCutter Resolve Bridge] ready on 127.0.0.1:%s" % PORT)
    except OSError as e:
        print("[AssetCutter Resolve Bridge] failed: %s" % e)

threading.Thread(target=_serve, daemon=True).start()
`;
}

async function probeDavinciResolveBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `DaVinci Resolve bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return json && json.ok
      ? { ok: true, message: 'DaVinci Resolve bridge connected' }
      : { ok: false, message: 'DaVinci Resolve bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `DaVinci Resolve bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getDavinciResolveBridgeStatus(opts?: {
  home?: string;
  scriptsDirs?: string[];
}): Promise<DavinciResolveBridgeStatus> {
  const targets = discoverDavinciResolveBridgeTargets(opts);
  const install = readDavinciResolveBridgeInstallRecord();
  const port = install?.port || DEFAULT_DAVINCI_RESOLVE_BRIDGE_PORT;
  return {
    id: 'davinci-resolve',
    name: 'DaVinci Resolve',
    description: 'One-click Resolve/Fusion Python script bridge using a local HTTP probe.',
    defaultPort: DEFAULT_DAVINCI_RESOLVE_BRIDGE_PORT,
    port,
    roots: discoverDavinciResolveRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeDavinciResolveBridge(port),
  };
}

function resolveInstallTargets(
  body: DavinciResolveBridgeInstallBody,
  discovered: DavinciResolveBridgeTarget[],
): { targets: DavinciResolveBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: DavinciResolveBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_davinci_resolve_scripts_dir' };
  return { targets: unique };
}

export function installDavinciResolveBridge(
  body: DavinciResolveBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverDavinciResolveBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_davinci_resolve_scripts_dir',
      message: 'No DaVinci Resolve scripts folder was found. Choose a Resolve/Fusion Scripts folder manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildDavinciResolveBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeDavinciResolveBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'DaVinci Resolve bridge installed. Run the AssetCutter script in Resolve, then probe connection.' };
}

export function uninstallDavinciResolveBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverDavinciResolveBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readDavinciResolveBridgeInstallRecord();
  const targets = new Map<string, DavinciResolveBridgeTarget>();
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
  clearDavinciResolveBridgeInstallRecord();
  return { ok: true, removed };
}
