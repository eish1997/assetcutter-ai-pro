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

export const DEFAULT_FUSION_STUDIO_BRIDGE_PORT = 7391;
export const FUSION_STUDIO_BRIDGE_SCRIPT_NAME = 'assetcutter_fusion_studio_bridge.py';

export type FusionStudioBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type FusionStudioBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type FusionStudioBridgeStatus = {
  id: 'fusion-studio';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: FusionStudioBridgeTarget[];
  install: FusionStudioBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type FusionStudioBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'fusion-studio-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_FUSION_STUDIO_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverFusionStudioRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.FUSION_STUDIO_SCRIPTS_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.PROGRAMDATA) roots.push(resolve(join(process.env.PROGRAMDATA, 'Blackmagic Design', 'Fusion', 'Scripts')));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'Blackmagic Design', 'Fusion', 'Scripts')));
  roots.push(resolve(join(home, 'AppData', 'Roaming', 'Blackmagic Design', 'Fusion', 'Scripts')));
  roots.push(resolve(join(home, 'Library', 'Application Support', 'Blackmagic Design', 'Fusion', 'Scripts')));
  return roots.filter((root, idx, arr) => rootExists(root) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(scriptsDir: string): FusionStudioBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  const labelBase = basename(resolvedDir) || 'Scripts';
  return {
    id: `${labelBase}::${resolvedDir}`,
    label: `Fusion Studio ${labelBase}`,
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, FUSION_STUDIO_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, FUSION_STUDIO_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverFusionStudioBridgeTargets(opts?: {
  home?: string;
  scriptsDirs?: string[];
}): FusionStudioBridgeTarget[] {
  const byDir = new Map<string, FusionStudioBridgeTarget>();
  for (const root of discoverFusionStudioRoots(opts?.home)) {
    byDir.set(resolve(root), targetFromScriptsDir(root));
    for (const sub of ['Comp', 'Edit', 'Utility']) {
      const p = join(root, sub);
      if (rootExists(p)) byDir.set(resolve(p), targetFromScriptsDir(p));
    }
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      names = [];
    }
    for (const name of names) {
      const p = join(root, name);
      if (rootExists(p)) byDir.set(resolve(p), targetFromScriptsDir(p));
    }
  }
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readFusionStudioBridgeInstallRecord(): FusionStudioBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as FusionStudioBridgeInstallRecord;
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

function writeFusionStudioBridgeInstallRecord(rec: FusionStudioBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearFusionStudioBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildFusionStudioBridgeScript(port: number): string {
  return `# AssetCutter Fusion Studio Bridge
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
            self._send(200, {"ok": True, "host": "fusion-studio"})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def _serve():
    try:
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        print("[AssetCutter Fusion Studio Bridge] ready on 127.0.0.1:%s" % PORT)
    except OSError as e:
        print("[AssetCutter Fusion Studio Bridge] failed: %s" % e)

threading.Thread(target=_serve, daemon=True).start()
`;
}

async function probeFusionStudioBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `Fusion Studio bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return json && json.ok
      ? { ok: true, message: 'Fusion Studio bridge connected' }
      : { ok: false, message: 'Fusion Studio bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Fusion Studio bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getFusionStudioBridgeStatus(opts?: {
  home?: string;
  scriptsDirs?: string[];
}): Promise<FusionStudioBridgeStatus> {
  const targets = discoverFusionStudioBridgeTargets(opts);
  const install = readFusionStudioBridgeInstallRecord();
  const port = install?.port || DEFAULT_FUSION_STUDIO_BRIDGE_PORT;
  return {
    id: 'fusion-studio',
    name: 'Fusion Studio',
    description: 'One-click Fusion Python script bridge using a local HTTP probe.',
    defaultPort: DEFAULT_FUSION_STUDIO_BRIDGE_PORT,
    port,
    roots: discoverFusionStudioRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeFusionStudioBridge(port),
  };
}

function resolveInstallTargets(
  body: FusionStudioBridgeInstallBody,
  discovered: FusionStudioBridgeTarget[],
): { targets: FusionStudioBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: FusionStudioBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_fusion_studio_scripts_dir' };
  return { targets: unique };
}

export function installFusionStudioBridge(
  body: FusionStudioBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverFusionStudioBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_fusion_studio_scripts_dir',
      message: 'No Fusion Studio scripts folder was found. Choose a Fusion Scripts folder manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildFusionStudioBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeFusionStudioBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Fusion Studio bridge installed. Run the AssetCutter script in Fusion Studio, then probe connection.' };
}

export function uninstallFusionStudioBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverFusionStudioBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readFusionStudioBridgeInstallRecord();
  const targets = new Map<string, FusionStudioBridgeTarget>();
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
  clearFusionStudioBridgeInstallRecord();
  return { ok: true, removed };
}
