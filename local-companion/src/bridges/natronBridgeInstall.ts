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

export const DEFAULT_NATRON_BRIDGE_PORT = 7261;
export const NATRON_BRIDGE_PY_NAME = 'assetcutter_natron_bridge.py';
export const NATRON_INIT_GUI_PY_NAME = 'initGui.py';
export const NATRON_BRIDGE_MARKER_START = '# ========== AssetCutter Natron Bridge ==========';
export const NATRON_BRIDGE_MARKER_END = '# ========== AssetCutter Natron Bridge end ==========';

export type NatronBridgeTarget = {
  id: string;
  label: string;
  userDir: string;
  initGuiPath: string;
  bridgePath: string;
  hasInitGuiMarker: boolean;
  hasBridgePy: boolean;
};

export type NatronBridgeInstallRecord = {
  port: number;
  installedAt: string;
  userDirs: string[];
  targetIds: string[];
};

export type NatronBridgeStatus = {
  id: 'natron';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: NatronBridgeTarget[];
  install: NatronBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type NatronBridgeInstallBody = {
  targets?: string[];
  userDirs?: string[];
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
  return join(bridgesStateDir(), 'natron-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_NATRON_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverNatronRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.NATRON_PLUGIN_PATH?.trim();
  if (fromEnv) {
    for (const part of fromEnv.split(/[;:]/).map((x) => x.trim()).filter(Boolean)) roots.push(resolve(part));
  }
  const fromUserDirEnv = process.env.NATRON_USER_DIR?.trim();
  if (fromUserDirEnv) roots.push(resolve(fromUserDirEnv));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'Natron')));
  roots.push(resolve(join(home, '.Natron')));
  roots.push(resolve(join(home, 'AppData', 'Roaming', 'Natron')));
  return roots.filter((root, idx, arr) => rootExists(root) && arr.indexOf(root) === idx);
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
  const start = content.indexOf(NATRON_BRIDGE_MARKER_START);
  if (start < 0) return content;
  const end = content.indexOf(NATRON_BRIDGE_MARKER_END, start);
  if (end < 0) return (content.slice(0, start) + content.slice(start + NATRON_BRIDGE_MARKER_START.length)).replace(/\n{3,}/g, '\n\n');
  const after = end + NATRON_BRIDGE_MARKER_END.length;
  const next = (content.slice(0, start) + content.slice(after)).replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  return next ? next + '\n' : '';
}

function targetFromUserDir(userDir: string): NatronBridgeTarget {
  const resolvedDir = resolve(userDir);
  const content = readText(join(resolvedDir, NATRON_INIT_GUI_PY_NAME));
  return {
    id: `natron::${resolvedDir}`,
    label: basename(resolvedDir) === '.Natron' ? 'Natron user scripts' : `Natron (${resolvedDir})`,
    userDir: resolvedDir,
    initGuiPath: join(resolvedDir, NATRON_INIT_GUI_PY_NAME),
    bridgePath: join(resolvedDir, NATRON_BRIDGE_PY_NAME),
    hasInitGuiMarker: content.includes(NATRON_BRIDGE_MARKER_START),
    hasBridgePy: existsSync(join(resolvedDir, NATRON_BRIDGE_PY_NAME)),
  };
}

function natronUserDir(home = homedir()): string {
  const appdata = process.env.APPDATA?.trim();
  if (appdata) return resolve(join(appdata, 'Natron'));
  return resolve(join(home, 'AppData', 'Roaming', 'Natron'));
}

function normalizeManualUserDirTarget(input: string, home = homedir()): ManualTargetResolveResult & { ok: true; resolvedPath: string } {
  const selected = resolve(String(input || '').trim());
  const normalized = selected.replace(/\\/g, '/');
  const base = basename(selected);
  const isUserDir = base === '.Natron' || /\/AppData\/Roaming\/Natron\/?$/i.test(normalized);
  if (isUserDir) return { ok: true, inputPath: selected, resolvedPath: selected, targetKind: 'user_config_dir' };
  const looksLikeInstallDir = /\/Program Files(?: \(x86\))?\//i.test(normalized) || /^Natron(?:\s+\d+(?:\.\d+)*)?$/i.test(base);
  if (looksLikeInstallDir) {
    const versionHint = base.match(/Natron\s+(\d+(?:\.\d+)*)/i)?.[1];
    return { ok: true, inputPath: selected, resolvedPath: natronUserDir(home), targetKind: 'install_dir', versionHint };
  }
  return { ok: true, inputPath: selected, resolvedPath: selected, targetKind: 'user_config_dir' };
}

function normalizeManualUserDir(input: string, home = homedir()): string {
  return normalizeManualUserDirTarget(input, home).resolvedPath;
}

export function discoverNatronBridgeTargets(opts?: { home?: string; userDirs?: string[]; scriptsDirs?: string[] }): NatronBridgeTarget[] {
  const byDir = new Map<string, NatronBridgeTarget>();
  for (const root of discoverNatronRoots(opts?.home)) byDir.set(resolve(root), targetFromUserDir(root));
  for (const dirRaw of [...(opts?.userDirs || []), ...(opts?.scriptsDirs || [])]) {
    const dir = normalizeManualUserDir(String(dirRaw || '').trim(), opts?.home);
    if (dir) byDir.set(dir, targetFromUserDir(dir));
  }
  for (const custom of readCustomHostTargetsForHost('natron')) {
    const dir = normalizeManualUserDir(custom.resolvedPath, opts?.home);
    if (dir) byDir.set(dir, targetFromUserDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readNatronBridgeInstallRecord(): NatronBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as NatronBridgeInstallRecord;
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

function writeNatronBridgeInstallRecord(rec: NatronBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearNatronBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildNatronBridgeScript(port: number): string {
  return `# AssetCutter Natron Bridge
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
            self._send(200, {"ok": True, "host": "natron"})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def ensure_server():
    global _server
    if _server:
        return
    try:
        _server = HTTPServer(("127.0.0.1", PORT), Handler)
        threading.Thread(target=_server.serve_forever, daemon=True).start()
        print("[AssetCutter Natron Bridge] ready on 127.0.0.1:%s" % PORT)
    except Exception as e:
        print("[AssetCutter Natron Bridge] failed: %s" % e)

ensure_server()
`;
}

function escapePythonPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildInitGuiBlock(bridgePath: string): string {
  return `${NATRON_BRIDGE_MARKER_START}
try:
    _ac_bridge_path = '${escapePythonPath(bridgePath)}'
    with open(_ac_bridge_path, 'r') as _ac_bridge_file:
        exec(compile(_ac_bridge_file.read(), _ac_bridge_path, 'exec'), globals(), globals())
except Exception as e:
    print("[AssetCutter Natron Bridge] initGui error: %s" % e)
${NATRON_BRIDGE_MARKER_END}
`;
}

async function probeNatronBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `Natron bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return json && json.ok ? { ok: true, message: 'Natron bridge connected' } : { ok: false, message: 'Natron bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Natron bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getNatronBridgeStatus(opts?: { home?: string; userDirs?: string[]; scriptsDirs?: string[] }): Promise<NatronBridgeStatus> {
  const targets = discoverNatronBridgeTargets(opts);
  const install = readNatronBridgeInstallRecord();
  const port = install?.port || DEFAULT_NATRON_BRIDGE_PORT;
  return {
    id: 'natron',
    name: 'Natron',
    description: 'One-click initGui.py bridge using a local HTTP probe.',
    defaultPort: DEFAULT_NATRON_BRIDGE_PORT,
    port,
    roots: discoverNatronRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasInitGuiMarker || v.hasBridgePy) || Boolean(install?.userDirs.length),
    probe: await probeNatronBridge(port),
  };
}

function resolveInstallTargets(
  body: NatronBridgeInstallBody,
  discovered: NatronBridgeTarget[],
): { targets: NatronBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: NatronBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of [...(body.userDirs || []), ...(body.scriptsDirs || [])]) {
    const userDir = normalizeManualUserDir(String(dirRaw || '').trim(), body.home);
    if (userDir) targets.push(targetFromUserDir(userDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.userDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_natron_user_dir' };
  return { targets: unique };
}

export function installNatronBridge(
  body: NatronBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; userDir: string; initGuiPath: string; bridgePath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverNatronBridgeTargets({ home: body.home, userDirs: body.userDirs, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return { ok: false, error: resolved.error || 'no_natron_user_dir', message: 'No Natron user scripts folder was found. Choose the Natron user folder manually.' };
  }
  const installed: Array<{ targetId: string; userDir: string; initGuiPath: string; bridgePath: string }> = [];
  for (const target of resolved.targets) {
    try {
      mkdirSync(target.userDir, { recursive: true });
      writeFileSync(target.bridgePath, buildNatronBridgeScript(port), 'utf8');
      const existing = readText(target.initGuiPath);
      const next = (stripMarkedBlock(existing).replace(/\s+$/, '') + '\n\n' + buildInitGuiBlock(target.bridgePath)).replace(/^\s+/, '');
      const tmp = target.initGuiPath + '.tmp';
      writeFileSync(tmp, next, 'utf8');
      renameSync(tmp, target.initGuiPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const locked = /eperm|eacces|permission|operation not permitted/i.test(msg);
      return {
        ok: false,
        error: locked ? 'permission_denied' : 'install_failed',
        message: locked
          ? `无法写入 Natron 桥接文件：${target.userDir}。请选择 Natron 用户目录，或选择 Natron 安装目录让系统自动定位到用户目录。`
          : `Natron 桥接安装失败：${msg}`,
      };
    }
    installed.push({ targetId: target.id, userDir: target.userDir, initGuiPath: target.initGuiPath, bridgePath: target.bridgePath });
  }
  writeNatronBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    userDirs: installed.map((x) => x.userDir),
    targetIds: installed.map((x) => x.targetId),
  });
  for (const dirRaw of [...(body.userDirs || []), ...(body.scriptsDirs || [])]) {
    const manual = normalizeManualUserDirTarget(String(dirRaw || '').trim(), body.home);
    const found = installed.find((item) => resolve(item.userDir) === resolve(manual.resolvedPath));
    if (!found) continue;
    upsertCustomHostTarget('natron', {
      label: 'Natron（手动添加）',
      inputPath: String(dirRaw || '').trim(),
      resolvedPath: manual.resolvedPath,
      targetKind: manual.targetKind || 'unknown',
      versionHint: manual.versionHint,
    });
  }
  return { ok: true, port, installed, message: 'Natron bridge installed. Restart Natron, then probe connection.' };
}

export function uninstallNatronBridge(
  body: { targets?: string[]; userDirs?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ userDir: string; initGuiPath: string; bridgePath: string; removed: boolean }> } {
  const explicitDirs = [...(body.userDirs || []), ...(body.scriptsDirs || [])];
  const hasExplicitDirs = explicitDirs.length > 0;
  const discovered = hasExplicitDirs ? [] : discoverNatronBridgeTargets();
  const explicit = hasExplicitDirs ? explicitDirs.map((dir) => targetFromUserDir(normalizeManualUserDir(dir))) : [];
  const record = readNatronBridgeInstallRecord();
  const targets = new Map<string, NatronBridgeTarget>();
  for (const v of explicit.concat(discovered)) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.userDir, v);
  }
  for (const dir of record?.userDirs || []) targets.set(resolve(dir), targetFromUserDir(dir));
  const removed: Array<{ userDir: string; initGuiPath: string; bridgePath: string; removed: boolean }> = [];
  for (const target of targets.values()) {
    try {
      if (existsSync(target.bridgePath)) unlinkSync(target.bridgePath);
      const existing = readText(target.initGuiPath);
      if (existing) {
        const next = stripMarkedBlock(existing);
        writeFileSync(target.initGuiPath, next, 'utf8');
      }
      removed.push({ userDir: target.userDir, initGuiPath: target.initGuiPath, bridgePath: target.bridgePath, removed: true });
    } catch {
      removed.push({ userDir: target.userDir, initGuiPath: target.initGuiPath, bridgePath: target.bridgePath, removed: false });
    }
  }
  clearNatronBridgeInstallRecord();
  return { ok: true, removed };
}
