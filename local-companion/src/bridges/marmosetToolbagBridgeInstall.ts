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

export const DEFAULT_MARMOSET_TOOLBAG_BRIDGE_PORT = 7211;
export const MARMOSET_TOOLBAG_BRIDGE_SCRIPT_NAME = 'assetcutter_marmoset_toolbag_bridge.py';

export type MarmosetToolbagBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type MarmosetToolbagBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type MarmosetToolbagBridgeStatus = {
  id: 'marmoset-toolbag';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: MarmosetToolbagBridgeTarget[];
  install: MarmosetToolbagBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type MarmosetToolbagBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'marmoset-toolbag-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_MARMOSET_TOOLBAG_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverMarmosetToolbagRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.MARMOSET_TOOLBAG_SCRIPTS_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  roots.push(resolve(join(home, 'Documents')));
  roots.push(resolve(join(home, 'OneDrive', 'Documents')));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'Marmoset Toolbag')));
  return roots.filter((root, idx, arr) => rootExists(root) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(scriptsDir: string): MarmosetToolbagBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  const parent = basename(resolve(join(resolvedDir, '..')));
  return {
    id: `${parent || 'marmoset-toolbag'}::${resolvedDir}`,
    label: parent ? `Marmoset Toolbag ${parent}` : `Marmoset Toolbag (${resolvedDir})`,
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, MARMOSET_TOOLBAG_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, MARMOSET_TOOLBAG_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverMarmosetToolbagBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): MarmosetToolbagBridgeTarget[] {
  const byDir = new Map<string, MarmosetToolbagBridgeTarget>();
  for (const root of discoverMarmosetToolbagRoots(opts?.home)) {
    const direct = basename(root).toLowerCase() === 'scripts' ? root : '';
    if (direct) byDir.set(resolve(direct), targetFromScriptsDir(direct));
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!/Marmoset|Toolbag/i.test(name)) continue;
      const base = join(root, name);
      if (!rootExists(base)) continue;
      for (const rel of [['scripts'], ['Scripts'], ['plugins'], ['Plugins']]) {
        byDir.set(resolve(join(base, ...rel)), targetFromScriptsDir(join(base, ...rel)));
      }
    }
  }
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readMarmosetToolbagBridgeInstallRecord(): MarmosetToolbagBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as MarmosetToolbagBridgeInstallRecord;
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

function writeMarmosetToolbagBridgeInstallRecord(rec: MarmosetToolbagBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearMarmosetToolbagBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildMarmosetToolbagBridgeScript(port: number): string {
  return `# AssetCutter Marmoset Toolbag Bridge
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
            self._send(200, {"ok": True, "host": "marmoset-toolbag"})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def _serve():
    try:
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        print("[AssetCutter Marmoset Toolbag Bridge] ready on 127.0.0.1:%s" % PORT)
    except Exception as e:
        print("[AssetCutter Marmoset Toolbag Bridge] failed: %s" % e)

threading.Thread(target=_serve, daemon=True).start()
`;
}

async function probeMarmosetToolbagBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `Marmoset Toolbag bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return json && json.ok
      ? { ok: true, message: 'Marmoset Toolbag bridge connected' }
      : { ok: false, message: 'Marmoset Toolbag bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Marmoset Toolbag bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getMarmosetToolbagBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<MarmosetToolbagBridgeStatus> {
  const targets = discoverMarmosetToolbagBridgeTargets(opts);
  const install = readMarmosetToolbagBridgeInstallRecord();
  const port = install?.port || DEFAULT_MARMOSET_TOOLBAG_BRIDGE_PORT;
  return {
    id: 'marmoset-toolbag',
    name: 'Marmoset Toolbag',
    description: 'One-click Python script bridge using a local HTTP probe.',
    defaultPort: DEFAULT_MARMOSET_TOOLBAG_BRIDGE_PORT,
    port,
    roots: discoverMarmosetToolbagRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeMarmosetToolbagBridge(port),
  };
}

function resolveInstallTargets(
  body: MarmosetToolbagBridgeInstallBody,
  discovered: MarmosetToolbagBridgeTarget[],
): { targets: MarmosetToolbagBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: MarmosetToolbagBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_marmoset_toolbag_scripts_dir' };
  return { targets: unique };
}

export function installMarmosetToolbagBridge(
  body: MarmosetToolbagBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverMarmosetToolbagBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return { ok: false, error: resolved.error || 'no_marmoset_toolbag_scripts_dir', message: 'No Marmoset Toolbag scripts folder was found. Choose a scripts/plugins folder manually.' };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildMarmosetToolbagBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeMarmosetToolbagBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Marmoset Toolbag bridge installed. Run the AssetCutter script in Toolbag, then probe connection.' };
}

export function uninstallMarmosetToolbagBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverMarmosetToolbagBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readMarmosetToolbagBridgeInstallRecord();
  const targets = new Map<string, MarmosetToolbagBridgeTarget>();
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
  clearMarmosetToolbagBridgeInstallRecord();
  return { ok: true, removed };
}
