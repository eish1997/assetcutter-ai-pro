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

export const DEFAULT_FUSION360_BRIDGE_PORT = 7191;
export const FUSION360_ADDIN_NAME = 'AssetCutterBridge';
export const FUSION360_ADDIN_SCRIPT_NAME = 'AssetCutterBridge.py';
export const FUSION360_ADDIN_MANIFEST_NAME = 'AssetCutterBridge.manifest';

export type Fusion360BridgeTarget = {
  id: string;
  label: string;
  addinsDir: string;
  addinDir: string;
  scriptPath: string;
  manifestPath: string;
  hasAddinBridge: boolean;
};

export type Fusion360BridgeInstallRecord = {
  port: number;
  installedAt: string;
  addinsDirs: string[];
  targetIds: string[];
};

export type Fusion360BridgeStatus = {
  id: 'fusion-360';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: Fusion360BridgeTarget[];
  install: Fusion360BridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type Fusion360BridgeInstallBody = {
  targets?: string[];
  addinsDirs?: string[];
  port?: number;
  home?: string;
};

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function installRecordPath(): string {
  return join(bridgesStateDir(), 'fusion-360-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_FUSION360_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverFusion360Roots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.FUSION360_ADDINS_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'Autodesk', 'Autodesk Fusion 360', 'API', 'AddIns')));
  roots.push(resolve(join(home, 'AppData', 'Roaming', 'Autodesk', 'Autodesk Fusion 360', 'API', 'AddIns')));
  roots.push(resolve(join(home, 'Library', 'Application Support', 'Autodesk', 'Autodesk Fusion 360', 'API', 'AddIns')));
  return roots.filter((root, idx, arr) => rootExists(root) && arr.indexOf(root) === idx);
}

function targetFromAddinsDir(addinsDir: string): Fusion360BridgeTarget {
  const resolvedDir = resolve(addinsDir);
  const addinDir = join(resolvedDir, FUSION360_ADDIN_NAME);
  return {
    id: `fusion-360::${resolvedDir}`,
    label: `Fusion 360 AddIns (${resolvedDir})`,
    addinsDir: resolvedDir,
    addinDir,
    scriptPath: join(addinDir, FUSION360_ADDIN_SCRIPT_NAME),
    manifestPath: join(addinDir, FUSION360_ADDIN_MANIFEST_NAME),
    hasAddinBridge: existsSync(join(addinDir, FUSION360_ADDIN_SCRIPT_NAME)) && existsSync(join(addinDir, FUSION360_ADDIN_MANIFEST_NAME)),
  };
}

export function discoverFusion360BridgeTargets(opts?: { home?: string; addinsDirs?: string[] }): Fusion360BridgeTarget[] {
  const byDir = new Map<string, Fusion360BridgeTarget>();
  for (const root of discoverFusion360Roots(opts?.home)) {
    byDir.set(resolve(root), targetFromAddinsDir(root));
  }
  for (const dirRaw of opts?.addinsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromAddinsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readFusion360BridgeInstallRecord(): Fusion360BridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Fusion360BridgeInstallRecord;
    return {
      port: normalizePort(raw.port),
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      addinsDirs: Array.isArray(raw.addinsDirs) ? raw.addinsDirs.map(String) : [],
      targetIds: Array.isArray(raw.targetIds) ? raw.targetIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function writeFusion360BridgeInstallRecord(rec: Fusion360BridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearFusion360BridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildFusion360Manifest(): string {
  return JSON.stringify(
    {
      autodeskProduct: 'Fusion360',
      type: 'addin',
      id: FUSION360_ADDIN_NAME,
      author: 'AssetCutter',
      description: {
        '': 'AssetCutter local bridge for Fusion 360.',
      },
      version: '1.0.0',
      runOnStartup: true,
      supportedOS: 'windows|mac',
    },
    null,
    2,
  );
}

function buildFusion360AddinScript(port: number): string {
  return `# AssetCutter Fusion 360 Bridge
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

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
            version = ""
            try:
                import adsk.core
                app = adsk.core.Application.get()
                version = str(app.version) if app else ""
            except Exception:
                pass
            self._send(200, {"ok": True, "host": "fusion-360", "version": version})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def _serve():
    global _server
    try:
        _server = HTTPServer(("127.0.0.1", PORT), Handler)
        _server.serve_forever()
    except OSError as e:
        print("[AssetCutter Fusion 360 Bridge] failed: %s" % e)

def run(context):
    threading.Thread(target=_serve, daemon=True).start()
    print("[AssetCutter Fusion 360 Bridge] ready on 127.0.0.1:%s" % PORT)

def stop(context):
    global _server
    if _server:
        _server.shutdown()
        _server = None
`;
}

async function probeFusion360Bridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `Fusion 360 bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean; version?: string } | null;
    return json && json.ok
      ? { ok: true, message: `Fusion 360 bridge connected${json.version ? ` (${json.version})` : ''}` }
      : { ok: false, message: 'Fusion 360 bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Fusion 360 bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getFusion360BridgeStatus(opts?: { home?: string; addinsDirs?: string[] }): Promise<Fusion360BridgeStatus> {
  const targets = discoverFusion360BridgeTargets(opts);
  const install = readFusion360BridgeInstallRecord();
  const port = install?.port || DEFAULT_FUSION360_BRIDGE_PORT;
  return {
    id: 'fusion-360',
    name: 'Fusion 360',
    description: 'One-click API AddIn bridge using a local HTTP probe.',
    defaultPort: DEFAULT_FUSION360_BRIDGE_PORT,
    port,
    roots: discoverFusion360Roots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasAddinBridge) || Boolean(install?.addinsDirs.length),
    probe: await probeFusion360Bridge(port),
  };
}

function resolveInstallTargets(
  body: Fusion360BridgeInstallBody,
  discovered: Fusion360BridgeTarget[],
): { targets: Fusion360BridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: Fusion360BridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.addinsDirs || []) {
    const addinsDir = resolve(String(dirRaw || '').trim());
    if (addinsDir) targets.push(targetFromAddinsDir(addinsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.addinsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_fusion360_addins_dir' };
  return { targets: unique };
}

export function installFusion360Bridge(
  body: Fusion360BridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; addinsDir: string; addinDir: string; scriptPath: string; manifestPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverFusion360BridgeTargets({ home: body.home, addinsDirs: body.addinsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_fusion360_addins_dir',
      message: 'No Fusion 360 AddIns folder was found. Choose the Fusion 360 API/AddIns folder manually.',
    };
  }
  const installed: Array<{ targetId: string; addinsDir: string; addinDir: string; scriptPath: string; manifestPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.addinDir, { recursive: true });
    writeFileSync(target.manifestPath, buildFusion360Manifest(), 'utf8');
    writeFileSync(target.scriptPath, buildFusion360AddinScript(port), 'utf8');
    installed.push({
      targetId: target.id,
      addinsDir: target.addinsDir,
      addinDir: target.addinDir,
      scriptPath: target.scriptPath,
      manifestPath: target.manifestPath,
    });
  }
  writeFusion360BridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    addinsDirs: installed.map((x) => x.addinsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Fusion 360 bridge installed. Restart Fusion 360 or enable the AddIn, then probe connection.' };
}

export function uninstallFusion360Bridge(
  body: { targets?: string[]; addinsDirs?: string[] } = {},
): { ok: true; removed: Array<{ addinsDir: string; addinDir: string }> } {
  const discovered = discoverFusion360BridgeTargets({ addinsDirs: body.addinsDirs });
  const record = readFusion360BridgeInstallRecord();
  const targets = new Map<string, Fusion360BridgeTarget>();
  for (const v of discovered) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.addinsDir, v);
  }
  for (const dir of record?.addinsDirs || []) targets.set(resolve(dir), targetFromAddinsDir(dir));
  const removed: Array<{ addinsDir: string; addinDir: string }> = [];
  for (const target of targets.values()) {
    if (!existsSync(target.addinDir)) continue;
    try {
      rmSync(target.addinDir, { recursive: true, force: true });
      removed.push({ addinsDir: target.addinsDir, addinDir: target.addinDir });
    } catch {
      /* ignore */
    }
  }
  clearFusion360BridgeInstallRecord();
  return { ok: true, removed };
}
