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

export const DEFAULT_SUBSTANCE_DESIGNER_BRIDGE_PORT = 7341;
export const SUBSTANCE_DESIGNER_BRIDGE_SCRIPT_NAME = 'assetcutter_substance_designer_bridge.py';

export type SubstanceDesignerBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type SubstanceDesignerBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type SubstanceDesignerBridgeStatus = {
  id: 'substance-designer';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: SubstanceDesignerBridgeTarget[];
  install: SubstanceDesignerBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type SubstanceDesignerBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'substance-designer-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_SUBSTANCE_DESIGNER_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverSubstanceDesignerRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.SUBSTANCE_DESIGNER_USER_ROOT?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  roots.push(resolve(join(home, 'Documents', 'Adobe', 'Adobe Substance 3D Designer')));
  roots.push(resolve(join(home, 'Documents', 'Allegorithmic', 'Substance Designer')));
  roots.push(resolve(join(home, 'Adobe', 'Adobe Substance 3D Designer')));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'Adobe', 'Adobe Substance 3D Designer')));
  return roots.filter((root, idx, arr) => rootExists(root) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(scriptsDir: string): SubstanceDesignerBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  const parent = basename(resolve(join(resolvedDir, '..')));
  return {
    id: `substance-designer::${resolvedDir}`,
    label: parent ? `Substance Designer ${parent}` : 'Substance Designer scripts',
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, SUBSTANCE_DESIGNER_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, SUBSTANCE_DESIGNER_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverSubstanceDesignerBridgeTargets(opts?: {
  home?: string;
  scriptsDirs?: string[];
}): SubstanceDesignerBridgeTarget[] {
  const byDir = new Map<string, SubstanceDesignerBridgeTarget>();
  for (const root of discoverSubstanceDesignerRoots(opts?.home)) {
    for (const rel of [['python', 'plugins'], ['Python', 'Plugins'], ['scripts'], ['Scripts']]) {
      byDir.set(resolve(join(root, ...rel)), targetFromScriptsDir(join(root, ...rel)));
    }
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!/^\d+(\.\d+)?$|^Substance/i.test(name)) continue;
      const base = join(root, name);
      if (!rootExists(base)) continue;
      for (const rel of [['python', 'plugins'], ['Python', 'Plugins'], ['scripts'], ['Scripts']]) {
        byDir.set(resolve(join(base, ...rel)), targetFromScriptsDir(join(base, ...rel)));
      }
    }
  }
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readSubstanceDesignerBridgeInstallRecord(): SubstanceDesignerBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as SubstanceDesignerBridgeInstallRecord;
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

function writeSubstanceDesignerBridgeInstallRecord(rec: SubstanceDesignerBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearSubstanceDesignerBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildSubstanceDesignerBridgeScript(port: number): string {
  return `# AssetCutter Substance Designer Bridge
# Auto-generated by AssetCutter local companion.
import json
import threading
try:
    from http.server import BaseHTTPRequestHandler, HTTPServer
except Exception:
    from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer

PORT = ${port}
_server = None

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
            self._send(200, {"ok": True, "host": "substance-designer"})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def ensure_server():
    global _server
    if _server:
        return
    try:
        _server = HTTPServer(("127.0.0.1", PORT), Handler)
        threading.Thread(target=_server.serve_forever, daemon=True).start()
        print("[AssetCutter Substance Designer Bridge] ready on 127.0.0.1:%s" % PORT)
    except Exception as e:
        print("[AssetCutter Substance Designer Bridge] failed: %s" % e)

def start_plugin():
    ensure_server()

def close_plugin():
    global _server
    if _server:
        _server.shutdown()
        _server.server_close()
        _server = None

ensure_server()
`;
}

async function probeSubstanceDesignerBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `Substance Designer bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return json && json.ok
      ? { ok: true, message: 'Substance Designer bridge connected' }
      : { ok: false, message: 'Substance Designer bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Substance Designer bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getSubstanceDesignerBridgeStatus(opts?: {
  home?: string;
  scriptsDirs?: string[];
}): Promise<SubstanceDesignerBridgeStatus> {
  const targets = discoverSubstanceDesignerBridgeTargets(opts);
  const install = readSubstanceDesignerBridgeInstallRecord();
  const port = install?.port || DEFAULT_SUBSTANCE_DESIGNER_BRIDGE_PORT;
  return {
    id: 'substance-designer',
    name: 'Substance Designer',
    description: 'One-click Python plugin bridge using a local HTTP probe.',
    defaultPort: DEFAULT_SUBSTANCE_DESIGNER_BRIDGE_PORT,
    port,
    roots: discoverSubstanceDesignerRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeSubstanceDesignerBridge(port),
  };
}

function resolveInstallTargets(
  body: SubstanceDesignerBridgeInstallBody,
  discovered: SubstanceDesignerBridgeTarget[],
): { targets: SubstanceDesignerBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: SubstanceDesignerBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_substance_designer_scripts_dir' };
  return { targets: unique };
}

export function installSubstanceDesignerBridge(
  body: SubstanceDesignerBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverSubstanceDesignerBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_substance_designer_scripts_dir',
      message: 'No Substance Designer scripts/plugins folder was found. Choose one manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildSubstanceDesignerBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeSubstanceDesignerBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return {
    ok: true,
    port,
    installed,
    message: 'Substance Designer bridge installed. Restart Designer or run the installed script, then probe connection.',
  };
}

export function uninstallSubstanceDesignerBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverSubstanceDesignerBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readSubstanceDesignerBridgeInstallRecord();
  const targets = new Map<string, SubstanceDesignerBridgeTarget>();
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
  clearSubstanceDesignerBridgeInstallRecord();
  return { ok: true, removed };
}
