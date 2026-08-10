import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';

export const DEFAULT_KRITA_BRIDGE_PORT = 7221;
export const KRITA_BRIDGE_PLUGIN_NAME = 'assetcutter_krita_bridge';
export const KRITA_BRIDGE_DESKTOP_NAME = 'assetcutter_krita_bridge.desktop';
export const KRITA_BRIDGE_SCRIPT_NAME = `${KRITA_BRIDGE_PLUGIN_NAME}.py`;

export type KritaBridgeTarget = {
  id: string;
  label: string;
  pluginDir: string;
  scriptsDir: string;
  desktopPath: string;
  packageDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type KritaBridgeInstallRecord = {
  port: number;
  installedAt: string;
  pluginDirs: string[];
  targetIds: string[];
};

export type KritaBridgeStatus = {
  id: 'krita';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: KritaBridgeTarget[];
  install: KritaBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type KritaBridgeInstallBody = {
  targets?: string[];
  pluginDirs?: string[];
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
  return join(bridgesStateDir(), 'krita-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_KRITA_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverKritaRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.KRITA_PYKRITA_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'krita', 'pykrita')));
  roots.push(resolve(join(home, 'AppData', 'Roaming', 'krita', 'pykrita')));
  roots.push(resolve(join(home, '.local', 'share', 'krita', 'pykrita')));
  return roots.filter((root, idx, arr) => rootExists(root) && arr.indexOf(root) === idx);
}

function targetFromPluginDir(pluginDir: string): KritaBridgeTarget {
  const resolvedDir = resolve(pluginDir);
  const packageDir = join(resolvedDir, KRITA_BRIDGE_PLUGIN_NAME);
  const desktopPath = join(resolvedDir, KRITA_BRIDGE_DESKTOP_NAME);
  const scriptPath = join(packageDir, KRITA_BRIDGE_SCRIPT_NAME);
  return {
    id: `krita::${resolvedDir}`,
    label: 'Krita Python plugins',
    pluginDir: resolvedDir,
    scriptsDir: resolvedDir,
    desktopPath,
    packageDir,
    scriptPath,
    hasScriptBridge: existsSync(desktopPath) && existsSync(scriptPath),
  };
}

export function discoverKritaBridgeTargets(opts?: { home?: string; pluginDirs?: string[]; scriptsDirs?: string[] }): KritaBridgeTarget[] {
  const byDir = new Map<string, KritaBridgeTarget>();
  for (const root of discoverKritaRoots(opts?.home)) byDir.set(resolve(root), targetFromPluginDir(root));
  for (const dirRaw of [...(opts?.pluginDirs || []), ...(opts?.scriptsDirs || [])]) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromPluginDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.pluginDir.localeCompare(b.pluginDir));
}

export function readKritaBridgeInstallRecord(): KritaBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as KritaBridgeInstallRecord;
    return {
      port: normalizePort(raw.port),
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      pluginDirs: Array.isArray(raw.pluginDirs) ? raw.pluginDirs.map(String) : [],
      targetIds: Array.isArray(raw.targetIds) ? raw.targetIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function writeKritaBridgeInstallRecord(rec: KritaBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearKritaBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildKritaDesktopFile(): string {
  return `[Desktop Entry]
Type=Service
ServiceTypes=Krita/PythonPlugin
X-KDE-Library=${KRITA_BRIDGE_PLUGIN_NAME}
X-Python-2-Compatible=false
Name=AssetCutter Bridge
Comment=AssetCutter local bridge for Krita
`;
}

function buildKritaInitPy(): string {
  return `from .${KRITA_BRIDGE_PLUGIN_NAME} import *
`;
}

function buildKritaBridgeScript(port: number): string {
  return `# AssetCutter Krita Bridge
# Auto-generated by AssetCutter local companion.
import json
import threading
try:
    from http.server import BaseHTTPRequestHandler, HTTPServer
except Exception:
    from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer

try:
    from krita import Extension, Krita
except Exception:
    Extension = object
    Krita = None

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
            self._send(200, {"ok": True, "host": "krita"})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def ensure_server():
    global _server
    if _server:
        return
    try:
        _server = HTTPServer(("127.0.0.1", PORT), Handler)
        threading.Thread(target=_server.serve_forever, daemon=True).start()
        print("[AssetCutter Krita Bridge] ready on 127.0.0.1:%s" % PORT)
    except Exception as e:
        print("[AssetCutter Krita Bridge] failed: %s" % e)

class AssetCutterKritaBridge(Extension):
    def __init__(self, parent):
        super().__init__(parent)
        ensure_server()
    def setup(self):
        ensure_server()
    def createActions(self, window):
        return

try:
    if Krita is not None:
        Krita.instance().addExtension(AssetCutterKritaBridge(Krita.instance()))
    ensure_server()
except Exception as e:
    print("[AssetCutter Krita Bridge] init failed: %s" % e)
`;
}

async function probeKritaBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `Krita bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return json && json.ok ? { ok: true, message: 'Krita bridge connected' } : { ok: false, message: 'Krita bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Krita bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getKritaBridgeStatus(opts?: { home?: string; pluginDirs?: string[]; scriptsDirs?: string[] }): Promise<KritaBridgeStatus> {
  const targets = discoverKritaBridgeTargets(opts);
  const install = readKritaBridgeInstallRecord();
  const port = install?.port || DEFAULT_KRITA_BRIDGE_PORT;
  return {
    id: 'krita',
    name: 'Krita',
    description: 'One-click Python plugin bridge using a local HTTP probe.',
    defaultPort: DEFAULT_KRITA_BRIDGE_PORT,
    port,
    roots: discoverKritaRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.pluginDirs.length),
    probe: await probeKritaBridge(port),
  };
}

function resolveInstallTargets(body: KritaBridgeInstallBody, discovered: KritaBridgeTarget[]): { targets: KritaBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: KritaBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of [...(body.pluginDirs || []), ...(body.scriptsDirs || [])]) {
    const pluginDir = resolve(String(dirRaw || '').trim());
    if (pluginDir) targets.push(targetFromPluginDir(pluginDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.pluginDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_krita_pykrita_dir' };
  return { targets: unique };
}

export function installKritaBridge(
  body: KritaBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; pluginDir: string; desktopPath: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverKritaBridgeTargets({ home: body.home, pluginDirs: body.pluginDirs, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return { ok: false, error: resolved.error || 'no_krita_pykrita_dir', message: 'No Krita pykrita folder was found. Choose the pykrita folder manually.' };
  }
  const installed: Array<{ targetId: string; pluginDir: string; desktopPath: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.packageDir, { recursive: true });
    writeFileSync(target.desktopPath, buildKritaDesktopFile(), 'utf8');
    writeFileSync(join(target.packageDir, '__init__.py'), buildKritaInitPy(), 'utf8');
    writeFileSync(target.scriptPath, buildKritaBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, pluginDir: target.pluginDir, desktopPath: target.desktopPath, scriptPath: target.scriptPath });
  }
  writeKritaBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    pluginDirs: installed.map((x) => x.pluginDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Krita bridge installed. Enable the AssetCutter Bridge plugin and restart Krita, then probe connection.' };
}

export function uninstallKritaBridge(
  body: { targets?: string[]; pluginDirs?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ pluginDir: string; desktopPath: string; packageDir: string }> } {
  const discovered = discoverKritaBridgeTargets({ pluginDirs: body.pluginDirs, scriptsDirs: body.scriptsDirs });
  const record = readKritaBridgeInstallRecord();
  const targets = new Map<string, KritaBridgeTarget>();
  for (const v of discovered) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.pluginDir, v);
  }
  for (const dir of record?.pluginDirs || []) targets.set(resolve(dir), targetFromPluginDir(dir));
  const removed: Array<{ pluginDir: string; desktopPath: string; packageDir: string }> = [];
  for (const target of targets.values()) {
    try {
      if (existsSync(target.desktopPath)) unlinkSync(target.desktopPath);
      if (existsSync(target.packageDir)) rmSync(target.packageDir, { recursive: true, force: true });
      removed.push({ pluginDir: target.pluginDir, desktopPath: target.desktopPath, packageDir: target.packageDir });
    } catch {
      /* ignore */
    }
  }
  clearKritaBridgeInstallRecord();
  return { ok: true, removed };
}
