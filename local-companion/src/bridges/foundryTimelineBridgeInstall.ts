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

export type FoundryTimelineBridgeId = 'nuke-studio' | 'hiero';

type HostDef = {
  id: FoundryTimelineBridgeId;
  name: string;
  defaultPort: number;
  envVar: string;
  recordName: string;
  bridgeName: string;
  markerStart: string;
  markerEnd: string;
};

const HOSTS: Record<FoundryTimelineBridgeId, HostDef> = {
  'nuke-studio': {
    id: 'nuke-studio',
    name: 'Nuke Studio',
    defaultPort: 7581,
    envVar: 'NUKE_STUDIO_PATH',
    recordName: 'nuke-studio-install.json',
    bridgeName: 'assetcutter_nuke_studio_bridge.py',
    markerStart: '# ========== AssetCutter Nuke Studio Bridge ==========',
    markerEnd: '# ========== AssetCutter Nuke Studio Bridge end ==========',
  },
  hiero: {
    id: 'hiero',
    name: 'Hiero',
    defaultPort: 7591,
    envVar: 'HIERO_PATH',
    recordName: 'hiero-install.json',
    bridgeName: 'assetcutter_hiero_bridge.py',
    markerStart: '# ========== AssetCutter Hiero Bridge ==========',
    markerEnd: '# ========== AssetCutter Hiero Bridge end ==========',
  },
};

export const DEFAULT_NUKE_STUDIO_BRIDGE_PORT = HOSTS['nuke-studio'].defaultPort;
export const DEFAULT_HIERO_BRIDGE_PORT = HOSTS.hiero.defaultPort;
export const NUKE_STUDIO_BRIDGE_PY_NAME = HOSTS['nuke-studio'].bridgeName;
export const HIERO_BRIDGE_PY_NAME = HOSTS.hiero.bridgeName;
export const FOUNDRY_TIMELINE_INIT_PY_NAME = 'init.py';

export type FoundryTimelineBridgeTarget = {
  id: string;
  label: string;
  userDir: string;
  initPath: string;
  bridgePath: string;
  hasInitMarker: boolean;
  hasBridgePy: boolean;
};

export type FoundryTimelineBridgeInstallRecord = {
  port: number;
  installedAt: string;
  userDirs: string[];
  targetIds: string[];
};

export type FoundryTimelineBridgeStatus = {
  id: FoundryTimelineBridgeId;
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: FoundryTimelineBridgeTarget[];
  install: FoundryTimelineBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type FoundryTimelineBridgeInstallBody = {
  targets?: string[];
  userDirs?: string[];
  scriptsDirs?: string[];
  port?: number;
  home?: string;
};

function defFor(id: FoundryTimelineBridgeId): HostDef {
  return HOSTS[id];
}

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function installRecordPath(id: FoundryTimelineBridgeId): string {
  return join(bridgesStateDir(), defFor(id).recordName);
}

function normalizePort(id: FoundryTimelineBridgeId, raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : defFor(id).defaultPort;
}

function splitPathList(raw: string): string[] {
  return raw
    .split(process.platform === 'win32' ? ';' : /[;:]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function discoverFoundryTimelineRoots(id: FoundryTimelineBridgeId, home = homedir()): string[] {
  const roots: string[] = [];
  const host = defFor(id);
  const raw = process.env[host.envVar]?.trim() || process.env.NUKE_PATH?.trim() || '';
  for (const part of splitPathList(raw)) roots.push(resolve(part));
  roots.push(resolve(join(home, '.nuke')));
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

function readText(path: string): string {
  if (!existsSync(path)) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function stripMarkedBlock(id: FoundryTimelineBridgeId, content: string): string {
  const host = defFor(id);
  const start = content.indexOf(host.markerStart);
  if (start < 0) return content;
  const end = content.indexOf(host.markerEnd, start);
  if (end < 0) return (content.slice(0, start) + content.slice(start + host.markerStart.length)).replace(/\n{3,}/g, '\n\n');
  const after = end + host.markerEnd.length;
  const next = (content.slice(0, start) + content.slice(after)).replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  return next ? next + '\n' : '';
}

function targetFromUserDir(id: FoundryTimelineBridgeId, userDir: string): FoundryTimelineBridgeTarget {
  const host = defFor(id);
  const resolvedDir = resolve(userDir);
  const content = readText(join(resolvedDir, FOUNDRY_TIMELINE_INIT_PY_NAME));
  return {
    id: `${id}::${resolvedDir}`,
    label: basename(resolvedDir) === '.nuke' ? `${host.name} user scripts` : `${host.name} (${resolvedDir})`,
    userDir: resolvedDir,
    initPath: join(resolvedDir, FOUNDRY_TIMELINE_INIT_PY_NAME),
    bridgePath: join(resolvedDir, host.bridgeName),
    hasInitMarker: content.includes(host.markerStart),
    hasBridgePy: existsSync(join(resolvedDir, host.bridgeName)),
  };
}

export function discoverFoundryTimelineBridgeTargets(
  id: FoundryTimelineBridgeId,
  opts?: { home?: string; userDirs?: string[]; scriptsDirs?: string[] },
): FoundryTimelineBridgeTarget[] {
  const byDir = new Map<string, FoundryTimelineBridgeTarget>();
  for (const root of discoverFoundryTimelineRoots(id, opts?.home)) byDir.set(resolve(root), targetFromUserDir(id, root));
  for (const dirRaw of [...(opts?.userDirs || []), ...(opts?.scriptsDirs || [])]) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromUserDir(id, dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readFoundryTimelineBridgeInstallRecord(id: FoundryTimelineBridgeId): FoundryTimelineBridgeInstallRecord | null {
  const p = installRecordPath(id);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as FoundryTimelineBridgeInstallRecord;
    return {
      port: normalizePort(id, raw.port),
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      userDirs: Array.isArray(raw.userDirs) ? raw.userDirs.map(String) : [],
      targetIds: Array.isArray(raw.targetIds) ? raw.targetIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function writeFoundryTimelineBridgeInstallRecord(id: FoundryTimelineBridgeId, rec: FoundryTimelineBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath(id);
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearFoundryTimelineBridgeInstallRecord(id: FoundryTimelineBridgeId): void {
  const p = installRecordPath(id);
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function pyString(s: string): string {
  return JSON.stringify(s);
}

function buildFoundryTimelineBridgeScript(id: FoundryTimelineBridgeId, port: number): string {
  const host = defFor(id);
  return `# AssetCutter ${host.name} Bridge
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = ${port}
HOST_ID = ${pyString(host.id)}
HOST_NAME = ${pyString(host.name)}

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
                import hiero.core
                version = getattr(hiero.core, "env", {}).get("Version", "") if hasattr(hiero.core, "env") else ""
            except Exception:
                pass
            self._send(200, {"ok": True, "host": HOST_ID, "name": HOST_NAME, "version": version})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def _serve():
    try:
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        print("[AssetCutter %s Bridge] ready on 127.0.0.1:%s" % (HOST_NAME, PORT))
    except OSError as e:
        print("[AssetCutter %s Bridge] failed: %s" % (HOST_NAME, e))

threading.Thread(target=_serve, daemon=True).start()
`;
}

function buildInitBlock(id: FoundryTimelineBridgeId, bridgePath: string): string {
  const host = defFor(id);
  return `${host.markerStart}
try:
    _ac_bridge_path = ${pyString(bridgePath)}
    with open(_ac_bridge_path, 'r', encoding='utf-8') as _ac_bridge_file:
        exec(compile(_ac_bridge_file.read(), _ac_bridge_path, 'exec'), globals(), globals())
except Exception as e:
    print("[AssetCutter ${host.name} Bridge] init error: %s" % e)
${host.markerEnd}
`;
}

async function probeFoundryTimelineBridge(id: FoundryTimelineBridgeId, port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const host = defFor(id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `${host.name} bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean; host?: string; version?: string } | null;
    if (!json || !json.ok || json.host !== id) return { ok: false, message: `${host.name} bridge response is invalid` };
    return { ok: true, message: `${host.name} bridge connected${json.version ? ` (${json.version})` : ''}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `${host.name} bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getFoundryTimelineBridgeStatus(
  id: FoundryTimelineBridgeId,
  opts?: { home?: string; userDirs?: string[]; scriptsDirs?: string[] },
): Promise<FoundryTimelineBridgeStatus> {
  const host = defFor(id);
  const targets = discoverFoundryTimelineBridgeTargets(id, opts);
  const install = readFoundryTimelineBridgeInstallRecord(id);
  const port = install?.port || host.defaultPort;
  return {
    id,
    name: host.name,
    description: 'One-click Foundry init.py bridge using a local HTTP probe.',
    defaultPort: host.defaultPort,
    port,
    roots: discoverFoundryTimelineRoots(id, opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasInitMarker || v.hasBridgePy) || Boolean(install?.userDirs.length),
    probe: await probeFoundryTimelineBridge(id, port),
  };
}

function resolveInstallTargets(
  id: FoundryTimelineBridgeId,
  body: FoundryTimelineBridgeInstallBody,
  discovered: FoundryTimelineBridgeTarget[],
): { targets: FoundryTimelineBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: FoundryTimelineBridgeTarget[] = [];
  for (const targetId of body.targets || []) {
    const v = byId.get(String(targetId));
    if (v) targets.push(v);
  }
  for (const dirRaw of [...(body.userDirs || []), ...(body.scriptsDirs || [])]) {
    const userDir = resolve(String(dirRaw || '').trim());
    if (userDir) targets.push(targetFromUserDir(id, userDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.userDir, v])).values());
  if (!unique.length) return { targets: [], error: `no_${id.replace(/-/g, '_')}_user_dir` };
  return { targets: unique };
}

export function installFoundryTimelineBridge(
  id: FoundryTimelineBridgeId,
  body: FoundryTimelineBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; userDir: string; initPath: string; bridgePath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const host = defFor(id);
  const port = normalizePort(id, body.port);
  const discovered = discoverFoundryTimelineBridgeTargets(id, { home: body.home, userDirs: body.userDirs, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(id, body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || `no_${id.replace(/-/g, '_')}_user_dir`,
      message: `No ${host.name} user script folder was found. Choose the .nuke folder manually.`,
    };
  }
  const installed: Array<{ targetId: string; userDir: string; initPath: string; bridgePath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.userDir, { recursive: true });
    writeFileSync(target.bridgePath, buildFoundryTimelineBridgeScript(id, port), 'utf8');
    const existing = readText(target.initPath);
    const next = (stripMarkedBlock(id, existing).replace(/\s+$/, '') + '\n\n' + buildInitBlock(id, target.bridgePath)).replace(/^\s+/, '');
    const tmp = target.initPath + '.tmp';
    writeFileSync(tmp, next, 'utf8');
    renameSync(tmp, target.initPath);
    installed.push({ targetId: target.id, userDir: target.userDir, initPath: target.initPath, bridgePath: target.bridgePath });
  }
  writeFoundryTimelineBridgeInstallRecord(id, {
    port,
    installedAt: new Date().toISOString(),
    userDirs: installed.map((x) => x.userDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: `${host.name} bridge installed. Restart ${host.name}, then probe connection.` };
}

export function uninstallFoundryTimelineBridge(
  id: FoundryTimelineBridgeId,
  body: { targets?: string[]; userDirs?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ userDir: string; initPath: string; bridgePath: string; removed: boolean }> } {
  const discovered = discoverFoundryTimelineBridgeTargets(id, { userDirs: body.userDirs, scriptsDirs: body.scriptsDirs });
  const record = readFoundryTimelineBridgeInstallRecord(id);
  const targets = new Map<string, FoundryTimelineBridgeTarget>();
  for (const v of discovered) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.userDir, v);
  }
  for (const dir of record?.userDirs || []) targets.set(resolve(dir), targetFromUserDir(id, dir));
  const removed: Array<{ userDir: string; initPath: string; bridgePath: string; removed: boolean }> = [];
  for (const target of targets.values()) {
    let didRemove = false;
    if (existsSync(target.initPath)) {
      const existing = readText(target.initPath);
      if (existing.includes(defFor(id).markerStart)) {
        const tmp = target.initPath + '.tmp';
        writeFileSync(tmp, stripMarkedBlock(id, existing), 'utf8');
        renameSync(tmp, target.initPath);
        didRemove = true;
      }
    }
    if (existsSync(target.bridgePath)) {
      try {
        unlinkSync(target.bridgePath);
        didRemove = true;
      } catch {
        /* ignore */
      }
    }
    removed.push({ userDir: target.userDir, initPath: target.initPath, bridgePath: target.bridgePath, removed: didRemove });
  }
  clearFoundryTimelineBridgeInstallRecord(id);
  return { ok: true, removed };
}
