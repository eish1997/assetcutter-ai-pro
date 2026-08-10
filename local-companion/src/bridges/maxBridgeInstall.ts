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

export const DEFAULT_MAX_BRIDGE_PORT = 7021;
export const MAX_BRIDGE_STARTUP_MS_NAME = 'assetcutter_3dsmax_bridge_startup.ms';
export const MAX_BRIDGE_PY_NAME = 'assetcutter_3dsmax_bridge.py';

export type MaxBridgeVersion = {
  id: string;
  label: string;
  startupDir: string;
  startupScriptPath: string;
  pythonScriptPath: string;
  hasStartupBridge: boolean;
};

export type MaxBridgeInstallRecord = {
  port: number;
  installedAt: string;
  startupDirs: string[];
  versionIds: string[];
};

export type MaxBridgeStatus = {
  id: '3ds-max';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  versions: MaxBridgeVersion[];
  install: MaxBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type MaxBridgeInstallBody = {
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
  return join(bridgesStateDir(), '3ds-max-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_MAX_BRIDGE_PORT;
}

export function discoverMaxRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.MAX_USER_ROOT?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.LOCALAPPDATA) roots.push(resolve(join(process.env.LOCALAPPDATA, 'Autodesk', '3dsMax')));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'Autodesk', '3dsMax')));
  roots.push(resolve(join(home, 'AppData', 'Local', 'Autodesk', '3dsMax')));
  roots.push(resolve(join(home, 'AppData', 'Roaming', 'Autodesk', '3dsMax')));
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

function versionFromStartupDir(startupDir: string): MaxBridgeVersion {
  const resolvedDir = resolve(startupDir);
  const parts = resolvedDir.split(/[\\/]+/);
  const scriptsIdx = parts.map((p) => p.toLowerCase()).lastIndexOf('scripts');
  const labelParts = scriptsIdx >= 2 ? parts.slice(Math.max(0, scriptsIdx - 3), scriptsIdx).filter(Boolean) : [];
  const labelBase = labelParts.length ? labelParts.join(' / ') : basename(resolve(join(resolvedDir, '..', '..'))) || 'custom';
  return {
    id: `${labelBase}::${resolvedDir}`,
    label: `3ds Max ${labelBase}`,
    startupDir: resolvedDir,
    startupScriptPath: join(resolvedDir, MAX_BRIDGE_STARTUP_MS_NAME),
    pythonScriptPath: join(resolvedDir, MAX_BRIDGE_PY_NAME),
    hasStartupBridge:
      existsSync(join(resolvedDir, MAX_BRIDGE_STARTUP_MS_NAME)) || existsSync(join(resolvedDir, MAX_BRIDGE_PY_NAME)),
  };
}

export function discoverMaxBridgeVersions(opts?: { home?: string; startupDirs?: string[] }): MaxBridgeVersion[] {
  const byDir = new Map<string, MaxBridgeVersion>();
  for (const root of discoverMaxRoots(opts?.home)) {
    let yearDirs: string[] = [];
    try {
      yearDirs = readdirSync(root);
    } catch {
      yearDirs = [];
    }
    for (const yearDir of yearDirs) {
      const yearPath = join(root, yearDir);
      try {
        if (!statSync(yearPath).isDirectory()) continue;
      } catch {
        continue;
      }
      let localeDirs: string[] = [];
      try {
        localeDirs = readdirSync(yearPath);
      } catch {
        localeDirs = [];
      }
      for (const locale of localeDirs) {
        const localePath = join(yearPath, locale);
        try {
          if (!statSync(localePath).isDirectory()) continue;
        } catch {
          continue;
        }
        const startup = join(localePath, 'scripts', 'startup');
        byDir.set(resolve(startup), versionFromStartupDir(startup));
      }
    }
  }
  for (const dirRaw of opts?.startupDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, versionFromStartupDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readMaxBridgeInstallRecord(): MaxBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as MaxBridgeInstallRecord;
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

function writeMaxBridgeInstallRecord(rec: MaxBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearMaxBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function escapeMaxString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildMaxStartupScript(pyPath: string): string {
  return `-- AssetCutter 3ds Max Bridge startup
-- Auto-generated by AssetCutter local companion.
try (
  python.ExecuteFile "${escapeMaxString(pyPath)}"
) catch (
  format "[AssetCutter 3ds Max Bridge] startup failed: %\\n" (getCurrentException())
)
`;
}

function buildMaxPythonBridge(port: number): string {
  return `# AssetCutter 3ds Max Bridge
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
            self._send(200, {"ok": True, "host": "3ds-max"})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def _serve():
    try:
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        print("[AssetCutter 3ds Max Bridge] ready on 127.0.0.1:%s" % PORT)
    except OSError as e:
        print("[AssetCutter 3ds Max Bridge] failed: %s" % e)

threading.Thread(target=_serve, daemon=True).start()
`;
}

async function probeMaxBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `3ds Max bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean; host?: string } | null;
    return json && json.ok
      ? { ok: true, message: '3ds Max bridge connected' }
      : { ok: false, message: '3ds Max bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `3ds Max bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getMaxBridgeStatus(opts?: { home?: string; startupDirs?: string[] }): Promise<MaxBridgeStatus> {
  const versions = discoverMaxBridgeVersions(opts);
  const install = readMaxBridgeInstallRecord();
  const port = install?.port || DEFAULT_MAX_BRIDGE_PORT;
  return {
    id: '3ds-max',
    name: '3ds Max',
    description: 'One-click startup bridge using MaxScript plus a Python HTTP probe.',
    defaultPort: DEFAULT_MAX_BRIDGE_PORT,
    port,
    roots: discoverMaxRoots(opts?.home),
    versions,
    install,
    installed: versions.some((v) => v.hasStartupBridge) || Boolean(install?.startupDirs.length),
    probe: await probeMaxBridge(port),
  };
}

function resolveInstallTargets(body: MaxBridgeInstallBody, discovered: MaxBridgeVersion[]): { targets: MaxBridgeVersion[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: MaxBridgeVersion[] = [];
  for (const id of body.versions || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dir of body.startupDirs || []) {
    const startupDir = resolve(String(dir || '').trim());
    if (startupDir) targets.push(versionFromStartupDir(startupDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.startupDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_3ds_max_startup_dir' };
  return { targets: unique };
}

export function installMaxBridge(body: MaxBridgeInstallBody = {}): { ok: true; port: number; installed: Array<{ versionId: string; startupDir: string; startupScriptPath: string; pythonScriptPath: string }>; message: string } | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverMaxBridgeVersions({ home: body.home, startupDirs: body.startupDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return { ok: false, error: resolved.error || 'no_3ds_max_startup_dir', message: 'No 3ds Max scripts/startup folder was found. Choose one manually.' };
  }
  const installed: Array<{ versionId: string; startupDir: string; startupScriptPath: string; pythonScriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.startupDir, { recursive: true });
    writeFileSync(target.pythonScriptPath, buildMaxPythonBridge(port), 'utf8');
    writeFileSync(target.startupScriptPath, buildMaxStartupScript(target.pythonScriptPath), 'utf8');
    installed.push({
      versionId: target.id,
      startupDir: target.startupDir,
      startupScriptPath: target.startupScriptPath,
      pythonScriptPath: target.pythonScriptPath,
    });
  }
  writeMaxBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    startupDirs: installed.map((x) => x.startupDir),
    versionIds: installed.map((x) => x.versionId),
  });
  return { ok: true, port, installed, message: '3ds Max bridge installed. Restart 3ds Max, then probe connection.' };
}

export function uninstallMaxBridge(body: { versions?: string[]; startupDirs?: string[] } = {}): { ok: true; removed: Array<{ startupDir: string; startupScriptPath: string; pythonScriptPath: string }> } {
  const discovered = discoverMaxBridgeVersions({ startupDirs: body.startupDirs });
  const record = readMaxBridgeInstallRecord();
  const targets = new Map<string, MaxBridgeVersion>();
  for (const v of discovered) {
    if (!body.versions || body.versions.length === 0 || body.versions.includes(v.id)) targets.set(v.startupDir, v);
  }
  for (const dir of record?.startupDirs || []) targets.set(resolve(dir), versionFromStartupDir(dir));
  const removed: Array<{ startupDir: string; startupScriptPath: string; pythonScriptPath: string }> = [];
  for (const target of targets.values()) {
    let didRemove = false;
    for (const p of [target.startupScriptPath, target.pythonScriptPath]) {
      if (!existsSync(p)) continue;
      try {
        unlinkSync(p);
        didRemove = true;
      } catch {
        /* ignore */
      }
    }
    if (didRemove) {
      removed.push({
        startupDir: target.startupDir,
        startupScriptPath: target.startupScriptPath,
        pythonScriptPath: target.pythonScriptPath,
      });
    }
  }
  clearMaxBridgeInstallRecord();
  return { ok: true, removed };
}
