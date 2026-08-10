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
import { basename, dirname, join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';
import { readCustomHostTargetsForHost, upsertCustomHostTarget, type ManualTargetResolveResult } from './customHostTargets.js';

export const DEFAULT_UNREAL_BRIDGE_PORT = 7131;
export const UNREAL_PLUGIN_NAME = 'AssetCutterBridge';

export type UnrealBridgeTarget = {
  id: string;
  label: string;
  projectDir: string;
  pluginDir: string;
  upluginPath: string;
  pythonPath: string;
  hasPluginBridge: boolean;
};

export type UnrealBridgeInstallRecord = {
  port: number;
  installedAt: string;
  projectDirs: string[];
  targetIds: string[];
};

export type UnrealBridgeStatus = {
  id: 'unreal';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: UnrealBridgeTarget[];
  install: UnrealBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type UnrealBridgeInstallBody = {
  targets?: string[];
  projectDirs?: string[];
  port?: number;
  home?: string;
};

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function installRecordPath(): string {
  return join(bridgesStateDir(), 'unreal-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_UNREAL_BRIDGE_PORT;
}

function isDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function hasUproject(dir: string): boolean {
  try {
    return readdirSync(dir).some((name) => /\.uproject$/i.test(name));
  } catch {
    return false;
  }
}

function findUnrealProjectDir(input: string): string | null {
  let current = resolve(String(input || '').trim());
  if (/\.uproject$/i.test(current)) current = dirname(current);
  for (let i = 0; i < 6; i += 1) {
    if (hasUproject(current)) return current;
    const parent = dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return null;
}

function normalizeUnrealManualTarget(input: string): ManualTargetResolveResult & { ok: boolean; resolvedPath?: string } {
  const selected = resolve(String(input || '').trim());
  const projectDir = findUnrealProjectDir(selected);
  if (projectDir) {
    const warnings = projectDir === selected ? [] : ['已自动从所选文件或子目录定位到 Unreal 项目根目录。'];
    return { ok: true, inputPath: selected, resolvedPath: projectDir, targetKind: 'project_dir', warnings };
  }
  return {
    ok: false,
    inputPath: selected,
    error: 'invalid_unreal_project_dir',
    message: '请选择 Unreal 项目根目录、.uproject 文件或项目内 Content / Plugins 子目录；不要选择 Unreal Engine 安装目录。',
  };
}

export function discoverUnrealRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.UNREAL_PROJECTS_ROOT?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  roots.push(resolve(join(home, 'Documents', 'Unreal Projects')));
  roots.push(resolve(join(home, 'Unreal Projects')));
  roots.push(resolve(join(home, 'Documents')));
  return roots.filter((root, idx, arr) => isDir(root) && arr.indexOf(root) === idx);
}

function targetFromProjectDir(projectDir: string): UnrealBridgeTarget {
  const resolvedDir = resolve(projectDir);
  const pluginDir = join(resolvedDir, 'Plugins', UNREAL_PLUGIN_NAME);
  return {
    id: `unreal::${resolvedDir}`,
    label: `Unreal ${basename(resolvedDir) || 'project'}`,
    projectDir: resolvedDir,
    pluginDir,
    upluginPath: join(pluginDir, `${UNREAL_PLUGIN_NAME}.uplugin`),
    pythonPath: join(pluginDir, 'Content', 'Python', 'init_unreal.py'),
    hasPluginBridge: existsSync(join(pluginDir, `${UNREAL_PLUGIN_NAME}.uplugin`)) || existsSync(join(pluginDir, 'Content', 'Python', 'init_unreal.py')),
  };
}

export function discoverUnrealBridgeTargets(opts?: { home?: string; projectDirs?: string[] }): UnrealBridgeTarget[] {
  const byDir = new Map<string, UnrealBridgeTarget>();
  for (const root of discoverUnrealRoots(opts?.home)) {
    if (hasUproject(root)) byDir.set(resolve(root), targetFromProjectDir(root));
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      names = [];
    }
    for (const name of names) {
      const p = join(root, name);
      if (isDir(p) && hasUproject(p)) byDir.set(resolve(p), targetFromProjectDir(p));
    }
  }
  for (const dirRaw of opts?.projectDirs || []) {
    const manual = normalizeUnrealManualTarget(String(dirRaw || '').trim());
    if (manual.ok && manual.resolvedPath) byDir.set(manual.resolvedPath, targetFromProjectDir(manual.resolvedPath));
  }
  for (const custom of readCustomHostTargetsForHost('unreal')) {
    const manual = normalizeUnrealManualTarget(custom.resolvedPath);
    if (manual.ok && manual.resolvedPath) byDir.set(manual.resolvedPath, targetFromProjectDir(manual.resolvedPath));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readUnrealBridgeInstallRecord(): UnrealBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as UnrealBridgeInstallRecord;
    return {
      port: normalizePort(raw.port),
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      projectDirs: Array.isArray(raw.projectDirs) ? raw.projectDirs.map(String) : [],
      targetIds: Array.isArray(raw.targetIds) ? raw.targetIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function writeUnrealBridgeInstallRecord(rec: UnrealBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearUnrealBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildUplugin(): string {
  return JSON.stringify(
    {
      FileVersion: 3,
      Version: 1,
      VersionName: '1.0.0',
      FriendlyName: 'AssetCutter Bridge',
      Description: 'AssetCutter local editor bridge.',
      Category: 'Editor',
      EnabledByDefault: true,
      CanContainContent: true,
      Modules: [],
      Plugins: [{ Name: 'PythonScriptPlugin', Enabled: true }],
    },
    null,
    2,
  );
}

function buildUnrealPython(port: number): string {
  return `# AssetCutter Unreal Bridge
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
                import unreal
                version = str(unreal.SystemLibrary.get_engine_version())
            except Exception:
                pass
            self._send(200, {"ok": True, "host": "unreal", "version": version})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def _serve():
    try:
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        print("[AssetCutter Unreal Bridge] ready on 127.0.0.1:%s" % PORT)
    except OSError as e:
        print("[AssetCutter Unreal Bridge] failed: %s" % e)

threading.Thread(target=_serve, daemon=True).start()
`;
}

async function probeUnrealBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `Unreal bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean; version?: string } | null;
    return json && json.ok
      ? { ok: true, message: `Unreal bridge connected${json.version ? ` (${json.version})` : ''}` }
      : { ok: false, message: 'Unreal bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Unreal bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getUnrealBridgeStatus(opts?: { home?: string; projectDirs?: string[] }): Promise<UnrealBridgeStatus> {
  const targets = discoverUnrealBridgeTargets(opts);
  const install = readUnrealBridgeInstallRecord();
  const port = install?.port || DEFAULT_UNREAL_BRIDGE_PORT;
  return {
    id: 'unreal',
    name: 'Unreal',
    description: 'One-click project plugin bridge using Unreal Python and a local HTTP probe.',
    defaultPort: DEFAULT_UNREAL_BRIDGE_PORT,
    port,
    roots: discoverUnrealRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasPluginBridge) || Boolean(install?.projectDirs.length),
    probe: await probeUnrealBridge(port),
  };
}

function resolveInstallTargets(
  body: UnrealBridgeInstallBody,
  discovered: UnrealBridgeTarget[],
): { targets: UnrealBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: UnrealBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.projectDirs || []) {
    const manual = normalizeUnrealManualTarget(String(dirRaw || '').trim());
    if (!manual.ok) return { targets: [], error: manual.error || 'invalid_unreal_project_dir' };
    if (manual.resolvedPath) targets.push(targetFromProjectDir(manual.resolvedPath));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.projectDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_unreal_project_dir' };
  return { targets: unique };
}

export function installUnrealBridge(
  body: UnrealBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; projectDir: string; upluginPath: string; pythonPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverUnrealBridgeTargets({ home: body.home, projectDirs: body.projectDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    const invalid = resolved.error === 'invalid_unreal_project_dir';
    return {
      ok: false,
      error: resolved.error || 'no_unreal_project_dir',
      message: invalid
        ? '请选择 Unreal 项目根目录，需要包含 .uproject 文件。不要选择 Unreal Engine 安装目录。'
        : 'No Unreal project folder was found. Choose a folder containing a .uproject file manually.',
    };
  }
  const installed: Array<{ targetId: string; projectDir: string; upluginPath: string; pythonPath: string }> = [];
  for (const target of resolved.targets) {
    try {
      mkdirSync(join(target.pluginDir, 'Content', 'Python'), { recursive: true });
      writeFileSync(target.upluginPath, buildUplugin(), 'utf8');
      writeFileSync(target.pythonPath, buildUnrealPython(port), 'utf8');
      installed.push({ targetId: target.id, projectDir: target.projectDir, upluginPath: target.upluginPath, pythonPath: target.pythonPath });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const locked = /eperm|eacces|permission|operation not permitted/i.test(msg);
      return {
        ok: false,
        error: locked ? 'permission_denied' : 'install_failed',
        message: locked ? `无法写入 Unreal 项目桥接插件：${target.pluginDir}。请确认项目目录可写。` : `Unreal 桥接安装失败：${msg}`,
      };
    }
  }
  for (const dirRaw of body.projectDirs || []) {
    const manual = normalizeUnrealManualTarget(String(dirRaw || '').trim());
    if (!manual.ok || !manual.resolvedPath) continue;
    const found = installed.find((item) => resolve(item.projectDir) === resolve(manual.resolvedPath as string));
    if (!found) continue;
    upsertCustomHostTarget('unreal', {
      label: `Unreal ${basename(manual.resolvedPath) || '项目'}（手动添加）`,
      inputPath: String(dirRaw || '').trim(),
      resolvedPath: manual.resolvedPath,
      targetKind: 'project_dir',
    });
  }
  writeUnrealBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    projectDirs: installed.map((x) => x.projectDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Unreal bridge installed. Enable the AssetCutterBridge plugin/Python plugin and restart the Unreal project, then probe connection.' };
}

export function uninstallUnrealBridge(
  body: { targets?: string[]; projectDirs?: string[] } = {},
): { ok: true; removed: Array<{ projectDir: string; upluginPath: string; pythonPath: string }> } {
  const hasExplicitDirs = Array.isArray(body.projectDirs) && body.projectDirs.length > 0;
  const discovered = hasExplicitDirs ? [] : discoverUnrealBridgeTargets();
  const explicit = hasExplicitDirs
    ? (body.projectDirs || [])
        .map((dir) => normalizeUnrealManualTarget(dir))
        .filter((item): item is ManualTargetResolveResult & { ok: true; resolvedPath: string } => Boolean(item.ok && item.resolvedPath))
        .map((item) => targetFromProjectDir(item.resolvedPath))
    : [];
  const record = readUnrealBridgeInstallRecord();
  const targets = new Map<string, UnrealBridgeTarget>();
  for (const v of explicit.concat(discovered)) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.projectDir, v);
  }
  for (const dir of record?.projectDirs || []) targets.set(resolve(dir), targetFromProjectDir(dir));
  const removed: Array<{ projectDir: string; upluginPath: string; pythonPath: string }> = [];
  for (const target of targets.values()) {
    let didRemove = false;
    for (const p of [target.upluginPath, target.pythonPath]) {
      if (!existsSync(p)) continue;
      try {
        unlinkSync(p);
        didRemove = true;
      } catch {
        /* ignore */
      }
    }
    if (didRemove) removed.push({ projectDir: target.projectDir, upluginPath: target.upluginPath, pythonPath: target.pythonPath });
  }
  clearUnrealBridgeInstallRecord();
  return { ok: true, removed };
}
