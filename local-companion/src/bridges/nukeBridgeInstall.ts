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
import { readCustomHostTargetsForHost, upsertCustomHostTarget, type ManualTargetResolveResult } from './customHostTargets.js';

export const DEFAULT_NUKE_BRIDGE_PORT = 7051;
export const NUKE_BRIDGE_PY_NAME = 'assetcutter_nuke_bridge.py';
export const NUKE_INIT_PY_NAME = 'init.py';
export const NUKE_BRIDGE_MARKER_START = '# ========== AssetCutter Nuke Bridge ==========';
export const NUKE_BRIDGE_MARKER_END = '# ========== AssetCutter Nuke Bridge end ==========';

export type NukeBridgeTarget = {
  id: string;
  label: string;
  userDir: string;
  initPath: string;
  bridgePath: string;
  hasInitMarker: boolean;
  hasBridgePy: boolean;
};

export type NukeBridgeInstallRecord = {
  port: number;
  installedAt: string;
  userDirs: string[];
  targetIds: string[];
};

export type NukeBridgeStatus = {
  id: 'nuke';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: NukeBridgeTarget[];
  install: NukeBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type NukeBridgeInstallBody = {
  targets?: string[];
  userDirs?: string[];
  port?: number;
  home?: string;
};

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function installRecordPath(): string {
  return join(bridgesStateDir(), 'nuke-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_NUKE_BRIDGE_PORT;
}

export function discoverNukeRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.NUKE_PATH?.trim();
  if (fromEnv) {
    for (const part of fromEnv.split(/[;:]/).map((x) => x.trim()).filter(Boolean)) roots.push(resolve(part));
  }
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

function stripMarkedBlock(content: string): string {
  const start = content.indexOf(NUKE_BRIDGE_MARKER_START);
  if (start < 0) return content;
  const end = content.indexOf(NUKE_BRIDGE_MARKER_END, start);
  if (end < 0) return (content.slice(0, start) + content.slice(start + NUKE_BRIDGE_MARKER_START.length)).replace(/\n{3,}/g, '\n\n');
  const after = end + NUKE_BRIDGE_MARKER_END.length;
  const next = (content.slice(0, start) + content.slice(after)).replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  return next ? next + '\n' : '';
}

function targetFromUserDir(userDir: string): NukeBridgeTarget {
  const resolvedDir = resolve(userDir);
  const content = readText(join(resolvedDir, NUKE_INIT_PY_NAME));
  return {
    id: `nuke::${resolvedDir}`,
    label: basename(resolvedDir) === '.nuke' ? 'Nuke user scripts' : `Nuke (${resolvedDir})`,
    userDir: resolvedDir,
    initPath: join(resolvedDir, NUKE_INIT_PY_NAME),
    bridgePath: join(resolvedDir, NUKE_BRIDGE_PY_NAME),
    hasInitMarker: content.includes(NUKE_BRIDGE_MARKER_START),
    hasBridgePy: existsSync(join(resolvedDir, NUKE_BRIDGE_PY_NAME)),
  };
}

function nukeUserDir(home = homedir()): string {
  return resolve(join(home, '.nuke'));
}

function normalizeManualUserDirTarget(input: string, home = homedir()): ManualTargetResolveResult & { ok: true; resolvedPath: string } {
  const selected = resolve(String(input || '').trim());
  const normalized = selected.replace(/\\/g, '/');
  const base = basename(selected);
  if (base === '.nuke' || /\/\.nuke\/?$/i.test(normalized)) {
    return { ok: true, inputPath: selected, resolvedPath: selected, targetKind: 'user_config_dir' };
  }
  const installMatch = normalized.match(/\/(?:Nuke|NukeStudio|Hiero)\s*(\d+(?:\.\d+)?(?:v\d+)?)?\/?$/i);
  if (installMatch) {
    return { ok: true, inputPath: selected, resolvedPath: nukeUserDir(home), targetKind: 'install_dir', versionHint: installMatch[1] };
  }
  return { ok: true, inputPath: selected, resolvedPath: selected, targetKind: 'user_config_dir' };
}

function normalizeManualUserDir(input: string, home = homedir()): string {
  return normalizeManualUserDirTarget(input, home).resolvedPath;
}

export function discoverNukeBridgeTargets(opts?: { home?: string; userDirs?: string[] }): NukeBridgeTarget[] {
  const byDir = new Map<string, NukeBridgeTarget>();
  for (const root of discoverNukeRoots(opts?.home)) {
    byDir.set(resolve(root), targetFromUserDir(root));
  }
  for (const dirRaw of opts?.userDirs || []) {
    const dir = normalizeManualUserDir(String(dirRaw || '').trim(), opts?.home);
    if (dir) byDir.set(dir, targetFromUserDir(dir));
  }
  for (const custom of readCustomHostTargetsForHost('nuke')) {
    const dir = normalizeManualUserDir(custom.resolvedPath, opts?.home);
    if (dir) byDir.set(dir, targetFromUserDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readNukeBridgeInstallRecord(): NukeBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as NukeBridgeInstallRecord;
    return {
      port: normalizePort(raw.port),
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      userDirs: Array.isArray(raw.userDirs) ? raw.userDirs.map(String) : [],
      targetIds: Array.isArray(raw.targetIds) ? raw.targetIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function writeNukeBridgeInstallRecord(rec: NukeBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearNukeBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildNukeBridgeScript(port: number): string {
  return `# AssetCutter Nuke Bridge
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
                import nuke
                version = nuke.NUKE_VERSION_STRING
            except Exception:
                pass
            self._send(200, {"ok": True, "host": "nuke", "version": version})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def _serve():
    try:
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        print("[AssetCutter Nuke Bridge] ready on 127.0.0.1:%s" % PORT)
    except OSError as e:
        print("[AssetCutter Nuke Bridge] failed: %s" % e)

threading.Thread(target=_serve, daemon=True).start()
`;
}

function escapePythonPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildInitBlock(bridgePath: string): string {
  return `${NUKE_BRIDGE_MARKER_START}
try:
    _ac_bridge_path = '${escapePythonPath(bridgePath)}'
    with open(_ac_bridge_path, 'r', encoding='utf-8') as _ac_bridge_file:
        exec(compile(_ac_bridge_file.read(), _ac_bridge_path, 'exec'), globals(), globals())
except Exception as e:
    print("[AssetCutter Nuke Bridge] init error: %s" % e)
${NUKE_BRIDGE_MARKER_END}
`;
}

async function probeNukeBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `Nuke bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean; version?: string } | null;
    return json && json.ok
      ? { ok: true, message: `Nuke bridge connected${json.version ? ` (${json.version})` : ''}` }
      : { ok: false, message: 'Nuke bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Nuke bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getNukeBridgeStatus(opts?: { home?: string; userDirs?: string[] }): Promise<NukeBridgeStatus> {
  const targets = discoverNukeBridgeTargets(opts);
  const install = readNukeBridgeInstallRecord();
  const port = install?.port || DEFAULT_NUKE_BRIDGE_PORT;
  return {
    id: 'nuke',
    name: 'Nuke',
    description: 'One-click init.py bridge using a local HTTP probe.',
    defaultPort: DEFAULT_NUKE_BRIDGE_PORT,
    port,
    roots: discoverNukeRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasInitMarker || v.hasBridgePy) || Boolean(install?.userDirs.length),
    probe: await probeNukeBridge(port),
  };
}

function resolveInstallTargets(
  body: NukeBridgeInstallBody,
  discovered: NukeBridgeTarget[],
): { targets: NukeBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: NukeBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.userDirs || []) {
    const userDir = normalizeManualUserDir(String(dirRaw || '').trim(), body.home);
    if (userDir) targets.push(targetFromUserDir(userDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.userDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_nuke_user_dir' };
  return { targets: unique };
}

export function installNukeBridge(
  body: NukeBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; userDir: string; initPath: string; bridgePath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverNukeBridgeTargets({ home: body.home, userDirs: body.userDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_nuke_user_dir',
      message: 'No Nuke user script folder was found. Choose the .nuke folder manually.',
    };
  }
  const installed: Array<{ targetId: string; userDir: string; initPath: string; bridgePath: string }> = [];
  for (const target of resolved.targets) {
    try {
      mkdirSync(target.userDir, { recursive: true });
      writeFileSync(target.bridgePath, buildNukeBridgeScript(port), 'utf8');
      const existing = readText(target.initPath);
      const next = (stripMarkedBlock(existing).replace(/\s+$/, '') + '\n\n' + buildInitBlock(target.bridgePath)).replace(/^\s+/, '');
      const tmp = target.initPath + '.tmp';
      writeFileSync(tmp, next, 'utf8');
      renameSync(tmp, target.initPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const locked = /eperm|eacces|permission|operation not permitted/i.test(msg);
      return {
        ok: false,
        error: locked ? 'permission_denied' : 'install_failed',
        message: locked
          ? `无法写入 Nuke 桥接文件：${target.userDir}。请选择 Nuke 用户脚本目录 .nuke，或选择 Nuke 安装目录让系统自动定位到用户目录。`
          : `Nuke 桥接安装失败：${msg}`,
      };
    }
    installed.push({ targetId: target.id, userDir: target.userDir, initPath: target.initPath, bridgePath: target.bridgePath });
  }
  writeNukeBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    userDirs: installed.map((x) => x.userDir),
    targetIds: installed.map((x) => x.targetId),
  });
  for (const dirRaw of body.userDirs || []) {
    const manual = normalizeManualUserDirTarget(String(dirRaw || '').trim(), body.home);
    const found = installed.find((item) => resolve(item.userDir) === resolve(manual.resolvedPath));
    if (!found) continue;
    upsertCustomHostTarget('nuke', {
      label: 'Nuke（手动添加）',
      inputPath: String(dirRaw || '').trim(),
      resolvedPath: manual.resolvedPath,
      targetKind: manual.targetKind || 'unknown',
      versionHint: manual.versionHint,
    });
  }
  return { ok: true, port, installed, message: 'Nuke bridge installed. Restart Nuke, then probe connection.' };
}

export function uninstallNukeBridge(
  body: { targets?: string[]; userDirs?: string[] } = {},
): { ok: true; removed: Array<{ userDir: string; initPath: string; bridgePath: string; removed: boolean }> } {
  const hasExplicitDirs = Array.isArray(body.userDirs) && body.userDirs.length > 0;
  const discovered = hasExplicitDirs ? [] : discoverNukeBridgeTargets();
  const explicit = hasExplicitDirs ? (body.userDirs || []).map((dir) => targetFromUserDir(normalizeManualUserDir(dir))) : [];
  const record = readNukeBridgeInstallRecord();
  const targets = new Map<string, NukeBridgeTarget>();
  for (const v of explicit.concat(discovered)) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.userDir, v);
  }
  for (const dir of record?.userDirs || []) targets.set(resolve(dir), targetFromUserDir(dir));
  const removed: Array<{ userDir: string; initPath: string; bridgePath: string; removed: boolean }> = [];
  for (const target of targets.values()) {
    let didRemove = false;
    if (existsSync(target.initPath)) {
      const existing = readText(target.initPath);
      if (existing.includes(NUKE_BRIDGE_MARKER_START)) {
        const tmp = target.initPath + '.tmp';
        writeFileSync(tmp, stripMarkedBlock(existing), 'utf8');
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
  clearNukeBridgeInstallRecord();
  return { ok: true, removed };
}
