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
import { readCustomHostTargetsForHost, upsertCustomHostTarget, type ManualTargetResolveResult } from './customHostTargets.js';

export const DEFAULT_HOUDINI_BRIDGE_PORT = 7041;
export const HOUDINI_BRIDGE_PY_NAME = 'assetcutter_houdini_bridge.py';
export const HOUDINI_PYTHONRC_NAME = 'pythonrc.py';
export const HOUDINI_BRIDGE_MARKER_START = '# ========== AssetCutter Houdini Bridge ==========';
export const HOUDINI_BRIDGE_MARKER_END = '# ========== AssetCutter Houdini Bridge end ==========';

export type HoudiniBridgeTarget = {
  id: string;
  label: string;
  prefsDir: string;
  pythonrcPath: string;
  bridgePath: string;
  hasPythonrcMarker: boolean;
  hasBridgePy: boolean;
};

export type HoudiniBridgeInstallRecord = {
  port: number;
  installedAt: string;
  prefsDirs: string[];
  targetIds: string[];
};

export type HoudiniBridgeStatus = {
  id: 'houdini';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: HoudiniBridgeTarget[];
  install: HoudiniBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type HoudiniBridgeInstallBody = {
  targets?: string[];
  prefsDirs?: string[];
  port?: number;
  home?: string;
};

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function installRecordPath(): string {
  return join(bridgesStateDir(), 'houdini-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_HOUDINI_BRIDGE_PORT;
}

export function discoverHoudiniRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.HOUDINI_USER_PREF_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  roots.push(resolve(join(home, 'Documents')));
  roots.push(resolve(join(home, 'OneDrive', 'Documents')));
  roots.push(resolve(join(home)));
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

function stripMarkedBlock(content: string): string {
  const start = content.indexOf(HOUDINI_BRIDGE_MARKER_START);
  if (start < 0) return content;
  const end = content.indexOf(HOUDINI_BRIDGE_MARKER_END, start);
  if (end < 0) return (content.slice(0, start) + content.slice(start + HOUDINI_BRIDGE_MARKER_START.length)).replace(/\n{3,}/g, '\n\n');
  const after = end + HOUDINI_BRIDGE_MARKER_END.length;
  const next = (content.slice(0, start) + content.slice(after)).replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  return next ? next + '\n' : '';
}

function targetFromPrefsDir(prefsDir: string): HoudiniBridgeTarget {
  const resolvedDir = resolve(prefsDir);
  const content = readText(join(resolvedDir, HOUDINI_PYTHONRC_NAME));
  const base = basename(resolvedDir);
  return {
    id: `${base || 'houdini'}::${resolvedDir}`,
    label: /^houdini/i.test(base) ? `Houdini ${base.replace(/^houdini/i, '') || 'prefs'}` : `Houdini (${resolvedDir})`,
    prefsDir: resolvedDir,
    pythonrcPath: join(resolvedDir, HOUDINI_PYTHONRC_NAME),
    bridgePath: join(resolvedDir, HOUDINI_BRIDGE_PY_NAME),
    hasPythonrcMarker: content.includes(HOUDINI_BRIDGE_MARKER_START),
    hasBridgePy: existsSync(join(resolvedDir, HOUDINI_BRIDGE_PY_NAME)),
  };
}

function houdiniPrefsDir(version: string, home = homedir()): string {
  return resolve(join(home, 'Documents', `houdini${version}`));
}

function normalizeManualPrefsDirTarget(input: string, home = homedir()): ManualTargetResolveResult & { ok: true; resolvedPath: string } {
  const selected = resolve(String(input || '').trim());
  const normalized = selected.replace(/\\/g, '/');
  const base = basename(selected);
  const prefsMatch = base.match(/^houdini(\d+(?:\.\d+)?)$/i);
  if (prefsMatch && prefsMatch[1]) {
    return { ok: true, inputPath: selected, resolvedPath: selected, targetKind: 'user_config_dir', versionHint: prefsMatch[1] };
  }
  const installMatch = normalized.match(/\/Houdini\s+(\d+(?:\.\d+)?)(?:\.\d+)?\/?$/i);
  if (installMatch && installMatch[1]) {
    return { ok: true, inputPath: selected, resolvedPath: houdiniPrefsDir(installMatch[1], home), targetKind: 'install_dir', versionHint: installMatch[1] };
  }
  return { ok: true, inputPath: selected, resolvedPath: selected, targetKind: 'user_config_dir' };
}

function normalizeManualPrefsDir(input: string, home = homedir()): string {
  return normalizeManualPrefsDirTarget(input, home).resolvedPath;
}

export function discoverHoudiniBridgeTargets(opts?: { home?: string; prefsDirs?: string[] }): HoudiniBridgeTarget[] {
  const byDir = new Map<string, HoudiniBridgeTarget>();
  for (const root of discoverHoudiniRoots(opts?.home)) {
    const rootBase = basename(root);
    if (/^houdini\d/i.test(rootBase)) {
      byDir.set(resolve(root), targetFromPrefsDir(root));
      continue;
    }
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!/^houdini\d/i.test(name)) continue;
      const p = join(root, name);
      try {
        if (statSync(p).isDirectory()) byDir.set(resolve(p), targetFromPrefsDir(p));
      } catch {
        /* ignore */
      }
    }
  }
  for (const dirRaw of opts?.prefsDirs || []) {
    const dir = normalizeManualPrefsDir(String(dirRaw || '').trim(), opts?.home);
    if (dir) byDir.set(dir, targetFromPrefsDir(dir));
  }
  for (const custom of readCustomHostTargetsForHost('houdini')) {
    const dir = normalizeManualPrefsDir(custom.resolvedPath, opts?.home);
    if (dir) byDir.set(dir, targetFromPrefsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readHoudiniBridgeInstallRecord(): HoudiniBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as HoudiniBridgeInstallRecord;
    return {
      port: normalizePort(raw.port),
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      prefsDirs: Array.isArray(raw.prefsDirs) ? raw.prefsDirs.map(String) : [],
      targetIds: Array.isArray(raw.targetIds) ? raw.targetIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function writeHoudiniBridgeInstallRecord(rec: HoudiniBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearHoudiniBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildHoudiniBridgeScript(port: number): string {
  return `# AssetCutter Houdini Bridge
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
                import hou
                version = hou.applicationVersionString()
            except Exception:
                pass
            self._send(200, {"ok": True, "host": "houdini", "version": version})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def _serve():
    try:
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        print("[AssetCutter Houdini Bridge] ready on 127.0.0.1:%s" % PORT)
    except OSError as e:
        print("[AssetCutter Houdini Bridge] failed: %s" % e)

threading.Thread(target=_serve, daemon=True).start()
`;
}

function escapePythonPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildPythonrcBlock(bridgePath: string): string {
  return `${HOUDINI_BRIDGE_MARKER_START}
try:
    _ac_bridge_path = '${escapePythonPath(bridgePath)}'
    with open(_ac_bridge_path, 'r', encoding='utf-8') as _ac_bridge_file:
        exec(compile(_ac_bridge_file.read(), _ac_bridge_path, 'exec'), globals(), globals())
except Exception as e:
    print("[AssetCutter Houdini Bridge] pythonrc error: %s" % e)
${HOUDINI_BRIDGE_MARKER_END}
`;
}

async function probeHoudiniBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `Houdini bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean; version?: string } | null;
    return json && json.ok
      ? { ok: true, message: `Houdini bridge connected${json.version ? ` (${json.version})` : ''}` }
      : { ok: false, message: 'Houdini bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Houdini bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getHoudiniBridgeStatus(opts?: { home?: string; prefsDirs?: string[] }): Promise<HoudiniBridgeStatus> {
  const targets = discoverHoudiniBridgeTargets(opts);
  const install = readHoudiniBridgeInstallRecord();
  const port = install?.port || DEFAULT_HOUDINI_BRIDGE_PORT;
  return {
    id: 'houdini',
    name: 'Houdini',
    description: 'One-click pythonrc.py bridge using a local HTTP probe.',
    defaultPort: DEFAULT_HOUDINI_BRIDGE_PORT,
    port,
    roots: discoverHoudiniRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasPythonrcMarker || v.hasBridgePy) || Boolean(install?.prefsDirs.length),
    probe: await probeHoudiniBridge(port),
  };
}

function resolveInstallTargets(
  body: HoudiniBridgeInstallBody,
  discovered: HoudiniBridgeTarget[],
): { targets: HoudiniBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: HoudiniBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.prefsDirs || []) {
    const prefsDir = normalizeManualPrefsDir(String(dirRaw || '').trim(), body.home);
    if (prefsDir) targets.push(targetFromPrefsDir(prefsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.prefsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_houdini_prefs_dir' };
  return { targets: unique };
}

export function installHoudiniBridge(
  body: HoudiniBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; prefsDir: string; pythonrcPath: string; bridgePath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverHoudiniBridgeTargets({ home: body.home, prefsDirs: body.prefsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_houdini_prefs_dir',
      message: 'No Houdini preferences folder was found. Choose a houdiniXX.X folder manually.',
    };
  }
  const installed: Array<{ targetId: string; prefsDir: string; pythonrcPath: string; bridgePath: string }> = [];
  for (const target of resolved.targets) {
    try {
      mkdirSync(target.prefsDir, { recursive: true });
      writeFileSync(target.bridgePath, buildHoudiniBridgeScript(port), 'utf8');
      const existing = readText(target.pythonrcPath);
      const next = (stripMarkedBlock(existing).replace(/\s+$/, '') + '\n\n' + buildPythonrcBlock(target.bridgePath)).replace(/^\s+/, '');
      const tmp = target.pythonrcPath + '.tmp';
      writeFileSync(tmp, next, 'utf8');
      renameSync(tmp, target.pythonrcPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const locked = /eperm|eacces|permission|operation not permitted/i.test(msg);
      return {
        ok: false,
        error: locked ? 'permission_denied' : 'install_failed',
        message: locked
          ? `无法写入 Houdini 桥接文件：${target.prefsDir}。请选择 Houdini 用户偏好目录 houdiniXX.X，或选择 Houdini 安装目录让系统自动定位到用户目录。`
          : `Houdini 桥接安装失败：${msg}`,
      };
    }
    installed.push({ targetId: target.id, prefsDir: target.prefsDir, pythonrcPath: target.pythonrcPath, bridgePath: target.bridgePath });
  }
  writeHoudiniBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    prefsDirs: installed.map((x) => x.prefsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  for (const dirRaw of body.prefsDirs || []) {
    const manual = normalizeManualPrefsDirTarget(String(dirRaw || '').trim(), body.home);
    const found = installed.find((item) => resolve(item.prefsDir) === resolve(manual.resolvedPath));
    if (!found) continue;
    upsertCustomHostTarget('houdini', {
      label: manual.versionHint ? `Houdini ${manual.versionHint}（手动添加）` : 'Houdini（手动添加）',
      inputPath: String(dirRaw || '').trim(),
      resolvedPath: manual.resolvedPath,
      targetKind: manual.targetKind || 'unknown',
      versionHint: manual.versionHint,
    });
  }
  return { ok: true, port, installed, message: 'Houdini bridge installed. Restart Houdini, then probe connection.' };
}

export function uninstallHoudiniBridge(
  body: { targets?: string[]; prefsDirs?: string[] } = {},
): { ok: true; removed: Array<{ prefsDir: string; pythonrcPath: string; bridgePath: string; removed: boolean }> } {
  const hasExplicitDirs = Array.isArray(body.prefsDirs) && body.prefsDirs.length > 0;
  const discovered = hasExplicitDirs ? [] : discoverHoudiniBridgeTargets();
  const explicit = hasExplicitDirs ? (body.prefsDirs || []).map((dir) => targetFromPrefsDir(normalizeManualPrefsDir(dir))) : [];
  const record = readHoudiniBridgeInstallRecord();
  const targets = new Map<string, HoudiniBridgeTarget>();
  for (const v of explicit.concat(discovered)) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.prefsDir, v);
  }
  for (const dir of record?.prefsDirs || []) targets.set(resolve(dir), targetFromPrefsDir(dir));
  const removed: Array<{ prefsDir: string; pythonrcPath: string; bridgePath: string; removed: boolean }> = [];
  for (const target of targets.values()) {
    let didRemove = false;
    if (existsSync(target.pythonrcPath)) {
      const existing = readText(target.pythonrcPath);
      if (existing.includes(HOUDINI_BRIDGE_MARKER_START)) {
        const tmp = target.pythonrcPath + '.tmp';
        writeFileSync(tmp, stripMarkedBlock(existing), 'utf8');
        renameSync(tmp, target.pythonrcPath);
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
    removed.push({ prefsDir: target.prefsDir, pythonrcPath: target.pythonrcPath, bridgePath: target.bridgePath, removed: didRemove });
  }
  clearHoudiniBridgeInstallRecord();
  return { ok: true, removed };
}
