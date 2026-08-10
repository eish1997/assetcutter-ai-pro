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
import { join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';

export const DEFAULT_INKSCAPE_BRIDGE_PORT = 7241;
export const INKSCAPE_BRIDGE_ID = 'assetcutter_inkscape_bridge';
export const INKSCAPE_BRIDGE_INX_NAME = `${INKSCAPE_BRIDGE_ID}.inx`;
export const INKSCAPE_BRIDGE_SCRIPT_NAME = `${INKSCAPE_BRIDGE_ID}.py`;

export type InkscapeBridgeTarget = {
  id: string;
  label: string;
  extensionsDir: string;
  scriptsDir: string;
  inxPath: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type InkscapeBridgeInstallRecord = {
  port: number;
  installedAt: string;
  extensionsDirs: string[];
  targetIds: string[];
};

export type InkscapeBridgeStatus = {
  id: 'inkscape';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: InkscapeBridgeTarget[];
  install: InkscapeBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type InkscapeBridgeInstallBody = {
  targets?: string[];
  extensionsDirs?: string[];
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
  return join(bridgesStateDir(), 'inkscape-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_INKSCAPE_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverInkscapeRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.INKSCAPE_EXTENSIONS_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'inkscape', 'extensions')));
  roots.push(resolve(join(home, 'AppData', 'Roaming', 'inkscape', 'extensions')));
  roots.push(resolve(join(home, '.config', 'inkscape', 'extensions')));
  return roots.filter((root, idx, arr) => rootExists(root) && arr.indexOf(root) === idx);
}

function targetFromExtensionsDir(extensionsDir: string): InkscapeBridgeTarget {
  const resolvedDir = resolve(extensionsDir);
  return {
    id: `inkscape::${resolvedDir}`,
    label: 'Inkscape extensions',
    extensionsDir: resolvedDir,
    scriptsDir: resolvedDir,
    inxPath: join(resolvedDir, INKSCAPE_BRIDGE_INX_NAME),
    scriptPath: join(resolvedDir, INKSCAPE_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, INKSCAPE_BRIDGE_INX_NAME)) && existsSync(join(resolvedDir, INKSCAPE_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverInkscapeBridgeTargets(opts?: { home?: string; extensionsDirs?: string[]; scriptsDirs?: string[] }): InkscapeBridgeTarget[] {
  const byDir = new Map<string, InkscapeBridgeTarget>();
  for (const root of discoverInkscapeRoots(opts?.home)) byDir.set(resolve(root), targetFromExtensionsDir(root));
  for (const dirRaw of [...(opts?.extensionsDirs || []), ...(opts?.scriptsDirs || [])]) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromExtensionsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.extensionsDir.localeCompare(b.extensionsDir));
}

export function readInkscapeBridgeInstallRecord(): InkscapeBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as InkscapeBridgeInstallRecord;
    return {
      port: normalizePort(raw.port),
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      extensionsDirs: Array.isArray(raw.extensionsDirs) ? raw.extensionsDirs.map(String) : [],
      targetIds: Array.isArray(raw.targetIds) ? raw.targetIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function writeInkscapeBridgeInstallRecord(rec: InkscapeBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearInkscapeBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildInkscapeInx(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<inkscape-extension xmlns="http://www.inkscape.org/namespace/inkscape/extension">
  <name>AssetCutter Bridge</name>
  <id>com.assetcutter.inkscape.bridge</id>
  <effect>
    <object-type>all</object-type>
    <effects-menu>
      <submenu name="AssetCutter"/>
    </effects-menu>
  </effect>
  <script>
    <command location="inx" interpreter="python">${INKSCAPE_BRIDGE_SCRIPT_NAME}</command>
  </script>
</inkscape-extension>
`;
}

function buildInkscapeBridgeScript(port: number): string {
  return `# AssetCutter Inkscape Bridge
# Auto-generated by AssetCutter local companion.
import json
import threading
try:
    from http.server import BaseHTTPRequestHandler, HTTPServer
except Exception:
    from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer

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
            self._send(200, {"ok": True, "host": "inkscape"})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def _serve():
    try:
        HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        print("[AssetCutter Inkscape Bridge] ready on 127.0.0.1:%s" % PORT)
    except Exception as e:
        print("[AssetCutter Inkscape Bridge] failed: %s" % e)

threading.Thread(target=_serve, daemon=True).start()
`;
}

async function probeInkscapeBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `Inkscape bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return json && json.ok ? { ok: true, message: 'Inkscape bridge connected' } : { ok: false, message: 'Inkscape bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Inkscape bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getInkscapeBridgeStatus(opts?: { home?: string; extensionsDirs?: string[]; scriptsDirs?: string[] }): Promise<InkscapeBridgeStatus> {
  const targets = discoverInkscapeBridgeTargets(opts);
  const install = readInkscapeBridgeInstallRecord();
  const port = install?.port || DEFAULT_INKSCAPE_BRIDGE_PORT;
  return {
    id: 'inkscape',
    name: 'Inkscape',
    description: 'One-click Python extension bridge using a local HTTP probe.',
    defaultPort: DEFAULT_INKSCAPE_BRIDGE_PORT,
    port,
    roots: discoverInkscapeRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.extensionsDirs.length),
    probe: await probeInkscapeBridge(port),
  };
}

function resolveInstallTargets(
  body: InkscapeBridgeInstallBody,
  discovered: InkscapeBridgeTarget[],
): { targets: InkscapeBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: InkscapeBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of [...(body.extensionsDirs || []), ...(body.scriptsDirs || [])]) {
    const extensionsDir = resolve(String(dirRaw || '').trim());
    if (extensionsDir) targets.push(targetFromExtensionsDir(extensionsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.extensionsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_inkscape_extensions_dir' };
  return { targets: unique };
}

export function installInkscapeBridge(
  body: InkscapeBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; extensionsDir: string; inxPath: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverInkscapeBridgeTargets({ home: body.home, extensionsDirs: body.extensionsDirs, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return { ok: false, error: resolved.error || 'no_inkscape_extensions_dir', message: 'No Inkscape extensions folder was found. Choose the extensions folder manually.' };
  }
  const installed: Array<{ targetId: string; extensionsDir: string; inxPath: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.extensionsDir, { recursive: true });
    writeFileSync(target.inxPath, buildInkscapeInx(), 'utf8');
    writeFileSync(target.scriptPath, buildInkscapeBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, extensionsDir: target.extensionsDir, inxPath: target.inxPath, scriptPath: target.scriptPath });
  }
  writeInkscapeBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    extensionsDirs: installed.map((x) => x.extensionsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Inkscape bridge installed. Restart Inkscape and run Extensions > AssetCutter > AssetCutter Bridge, then probe connection.' };
}

export function uninstallInkscapeBridge(
  body: { targets?: string[]; extensionsDirs?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ extensionsDir: string; inxPath: string; scriptPath: string }> } {
  const discovered = discoverInkscapeBridgeTargets({ extensionsDirs: body.extensionsDirs, scriptsDirs: body.scriptsDirs });
  const record = readInkscapeBridgeInstallRecord();
  const targets = new Map<string, InkscapeBridgeTarget>();
  for (const v of discovered) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.extensionsDir, v);
  }
  for (const dir of record?.extensionsDirs || []) targets.set(resolve(dir), targetFromExtensionsDir(dir));
  const removed: Array<{ extensionsDir: string; inxPath: string; scriptPath: string }> = [];
  for (const target of targets.values()) {
    try {
      if (existsSync(target.inxPath)) unlinkSync(target.inxPath);
      if (existsSync(target.scriptPath)) unlinkSync(target.scriptPath);
      removed.push({ extensionsDir: target.extensionsDir, inxPath: target.inxPath, scriptPath: target.scriptPath });
    } catch {
      /* ignore */
    }
  }
  clearInkscapeBridgeInstallRecord();
  return { ok: true, removed };
}
