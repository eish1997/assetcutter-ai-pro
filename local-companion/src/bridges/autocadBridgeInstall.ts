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
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { getRepositoryRoot } from '../repositoryVolume.js';

export const DEFAULT_AUTOCAD_BRIDGE_PORT = 7371;
export const AUTOCAD_BRIDGE_SCRIPT_NAME = 'assetcutter_autocad_bridge.lsp';
export const AUTOCAD_ACADDOC_NAME = 'acaddoc.lsp';
export const AUTOCAD_BRIDGE_MARKER_START = '; ========== AssetCutter AutoCAD Bridge ==========' ;
export const AUTOCAD_BRIDGE_MARKER_END = '; ========== AssetCutter AutoCAD Bridge end ==========' ;

export type AutoCADBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  acaddocPath: string;
  hasScriptBridge: boolean;
  hasAcaddocMarker: boolean;
};

export type AutoCADBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type AutoCADBridgeStatus = {
  id: 'autocad';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: AutoCADBridgeTarget[];
  install: AutoCADBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type AutoCADBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'autocad-install.json');
}

function heartbeatPath(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', 'autocad-heartbeat.json'));
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_AUTOCAD_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverAutoCADRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.AUTOCAD_SUPPORT_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'Autodesk')));
  roots.push(resolve(join(home, 'AppData', 'Roaming', 'Autodesk')));
  return roots.filter((root, idx, arr) => rootExists(root) && arr.indexOf(root) === idx);
}

function collectSupportDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      if (!rootExists(full)) continue;
      if (/^Support$/i.test(name)) out.push(full);
      walk(full, depth + 1);
    }
  };
  if (/Support$/i.test(root)) out.push(root);
  walk(root, 0);
  return out;
}

function readText(path: string): string {
  if (!existsSync(path)) return '';
  try {
    return readFileSync(path, 'latin1');
  } catch {
    return '';
  }
}

function stripMarkedBlock(content: string): string {
  const start = content.indexOf(AUTOCAD_BRIDGE_MARKER_START);
  if (start < 0) return content;
  const end = content.indexOf(AUTOCAD_BRIDGE_MARKER_END, start);
  if (end < 0) return content.slice(0, start).replace(/\s+$/, '') + '\n';
  const after = end + AUTOCAD_BRIDGE_MARKER_END.length;
  const next = (content.slice(0, start) + content.slice(after)).replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  return next ? next + '\n' : '';
}

function targetFromScriptsDir(scriptsDir: string): AutoCADBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  const acaddocPath = join(resolvedDir, AUTOCAD_ACADDOC_NAME);
  const acaddoc = readText(acaddocPath);
  return {
    id: `autocad::${resolvedDir}`,
    label: 'AutoCAD Support',
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, AUTOCAD_BRIDGE_SCRIPT_NAME),
    acaddocPath,
    hasScriptBridge: existsSync(join(resolvedDir, AUTOCAD_BRIDGE_SCRIPT_NAME)),
    hasAcaddocMarker: acaddoc.includes(AUTOCAD_BRIDGE_MARKER_START),
  };
}

export function discoverAutoCADBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): AutoCADBridgeTarget[] {
  const byDir = new Map<string, AutoCADBridgeTarget>();
  for (const root of discoverAutoCADRoots(opts?.home)) {
    for (const dir of collectSupportDirs(root)) byDir.set(resolve(dir), targetFromScriptsDir(dir));
  }
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readAutoCADBridgeInstallRecord(): AutoCADBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as AutoCADBridgeInstallRecord;
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

function writeAutoCADBridgeInstallRecord(rec: AutoCADBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearAutoCADBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function lispString(s: string): string {
  return s.replace(/\\/g, '/').replace(/"/g, '\\"');
}

function buildAutoCADBridgeScript(port: number): string {
  const hb = heartbeatPath();
  return `; AssetCutter AutoCAD Bridge
; Auto-generated by AssetCutter local companion.
(defun assetcutter-write-heartbeat (/ f)
  (setq f (open "${lispString(hb)}" "w"))
  (if f
    (progn
      (write-line "{\\"ok\\":true,\\"host\\":\\"autocad\\",\\"name\\":\\"AutoCAD\\",\\"port\\":${port}}" f)
      (close f)
    )
  )
  (princ)
)

(defun c:ASSETCUTTERBRIDGE () (assetcutter-write-heartbeat))
(assetcutter-write-heartbeat)
(princ)
`;
}

function buildAcaddocBlock(scriptPath: string): string {
  return `${AUTOCAD_BRIDGE_MARKER_START}
(load "${lispString(scriptPath)}" nil)
${AUTOCAD_BRIDGE_MARKER_END}
`;
}

function writeAcaddocLoader(acaddocPath: string, scriptPath: string): void {
  const existing = readText(acaddocPath);
  const stripped = stripMarkedBlock(existing);
  const next = (stripped ? stripped.replace(/\s*$/, '\n\n') : '') + buildAcaddocBlock(scriptPath);
  const tmp = acaddocPath + '.tmp';
  writeFileSync(tmp, next, 'latin1');
  renameSync(tmp, acaddocPath);
}

function removeAcaddocLoader(acaddocPath: string): boolean {
  if (!existsSync(acaddocPath)) return false;
  const existing = readText(acaddocPath);
  if (!existing.includes(AUTOCAD_BRIDGE_MARKER_START)) return false;
  const tmp = acaddocPath + '.tmp';
  writeFileSync(tmp, stripMarkedBlock(existing), 'latin1');
  renameSync(tmp, acaddocPath);
  return true;
}

async function probeAutoCADBridge(): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath();
  if (!existsSync(p)) return { ok: false, message: 'AutoCAD bridge heartbeat has not been seen yet. Restart AutoCAD or run ASSETCUTTERBRIDGE after install.', heartbeatPath: p };
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string };
    if (json.host !== 'autocad') return { ok: false, message: 'AutoCAD bridge heartbeat is invalid.', heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `AutoCAD bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `AutoCAD bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getAutoCADBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<AutoCADBridgeStatus> {
  const targets = discoverAutoCADBridgeTargets(opts);
  const install = readAutoCADBridgeInstallRecord();
  const port = install?.port || DEFAULT_AUTOCAD_BRIDGE_PORT;
  return {
    id: 'autocad',
    name: 'AutoCAD',
    description: 'One-click AutoLISP acaddoc.lsp bridge using a local heartbeat probe.',
    defaultPort: DEFAULT_AUTOCAD_BRIDGE_PORT,
    port,
    roots: discoverAutoCADRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge || v.hasAcaddocMarker) || Boolean(install?.scriptsDirs.length),
    probe: await probeAutoCADBridge(),
  };
}

function resolveInstallTargets(
  body: AutoCADBridgeInstallBody,
  discovered: AutoCADBridgeTarget[],
): { targets: AutoCADBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: AutoCADBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_autocad_support_dir' };
  return { targets: unique };
}

export function installAutoCADBridge(
  body: AutoCADBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string; acaddocPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverAutoCADBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return { ok: false, error: resolved.error || 'no_autocad_support_dir', message: 'No AutoCAD Support folder was found. Choose a Support folder manually.' };
  }
  mkdirSync(dirname(heartbeatPath()), { recursive: true });
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string; acaddocPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildAutoCADBridgeScript(port), 'latin1');
    writeAcaddocLoader(target.acaddocPath, target.scriptPath);
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath, acaddocPath: target.acaddocPath });
  }
  writeAutoCADBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'AutoCAD bridge installed. Restart AutoCAD or run ASSETCUTTERBRIDGE, then probe connection.' };
}

export function uninstallAutoCADBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string; acaddocPath: string; removed: boolean }> } {
  const discovered = discoverAutoCADBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readAutoCADBridgeInstallRecord();
  const targets = new Map<string, AutoCADBridgeTarget>();
  for (const v of discovered) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.scriptsDir, v);
  }
  for (const dir of record?.scriptsDirs || []) targets.set(resolve(dir), targetFromScriptsDir(dir));
  const removed: Array<{ scriptsDir: string; scriptPath: string; acaddocPath: string; removed: boolean }> = [];
  for (const target of targets.values()) {
    let didRemove = removeAcaddocLoader(target.acaddocPath);
    if (existsSync(target.scriptPath)) {
      try {
        unlinkSync(target.scriptPath);
        didRemove = true;
      } catch {
        /* ignore */
      }
    }
    removed.push({ scriptsDir: target.scriptsDir, scriptPath: target.scriptPath, acaddocPath: target.acaddocPath, removed: didRemove });
  }
  clearAutoCADBridgeInstallRecord();
  return { ok: true, removed };
}
