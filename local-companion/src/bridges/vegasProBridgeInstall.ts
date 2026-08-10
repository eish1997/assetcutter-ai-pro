import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';

export const DEFAULT_VEGAS_PRO_BRIDGE_PORT = 7471;
export const VEGAS_PRO_BRIDGE_SCRIPT_NAME = 'AssetCutterVegasBridge.cs';

export type VegasProBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type VegasProBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type VegasProBridgeStatus = {
  id: 'vegas-pro';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: VegasProBridgeTarget[];
  install: VegasProBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type VegasProBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'vegas-pro-install.json');
}

function heartbeatPath(): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', 'vegas-pro-heartbeat.json'));
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_VEGAS_PRO_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function addVegasAppDataRoots(roots: string[], base: string | undefined): void {
  if (!base) return;
  for (const folder of ['VEGAS Pro', 'Vegas Pro', 'Sony', 'MAGIX']) {
    const root = resolve(join(base, folder));
    if (!rootExists(root)) continue;
    try {
      for (const child of readdirSync(root, { withFileTypes: true })) {
        if (child.isDirectory()) roots.push(resolve(join(root, child.name, 'Script Menu')));
      }
    } catch {
      /* ignore */
    }
  }
}

export function discoverVegasProRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.VEGAS_PRO_SCRIPTS_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  roots.push(resolve(join(home, 'Documents', 'VEGAS Script Menu')));
  roots.push(resolve(join(home, 'OneDrive', 'Documents', 'VEGAS Script Menu')));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'VEGAS Pro', 'Script Menu')));
  if (process.env.LOCALAPPDATA) roots.push(resolve(join(process.env.LOCALAPPDATA, 'VEGAS Pro', 'Script Menu')));
  addVegasAppDataRoots(roots, process.env.APPDATA);
  addVegasAppDataRoots(roots, process.env.LOCALAPPDATA);
  return roots.filter((root, idx, arr) => (rootExists(root) || /VEGAS Script Menu$|Script Menu$/i.test(root)) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(scriptsDir: string): VegasProBridgeTarget {
  const resolvedDir = resolve(scriptsDir);
  const parent = basename(resolve(join(resolvedDir, '..')));
  return {
    id: `vegas-pro::${resolvedDir}`,
    label: parent ? `VEGAS Pro ${parent}` : 'VEGAS Pro scripts',
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, VEGAS_PRO_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(resolvedDir, VEGAS_PRO_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverVegasProBridgeTargets(opts?: { home?: string; scriptsDirs?: string[] }): VegasProBridgeTarget[] {
  const byDir = new Map<string, VegasProBridgeTarget>();
  for (const root of discoverVegasProRoots(opts?.home)) byDir.set(resolve(root), targetFromScriptsDir(root));
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromScriptsDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.scriptsDir.localeCompare(b.scriptsDir));
}

export function readVegasProBridgeInstallRecord(): VegasProBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as VegasProBridgeInstallRecord;
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

function writeVegasProBridgeInstallRecord(rec: VegasProBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearVegasProBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function csString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildVegasProBridgeScript(port: number): string {
  const hb = heartbeatPath();
  return `// AssetCutter VEGAS Pro Bridge
// Auto-generated by AssetCutter local companion.
using System;
using System.IO;
using ScriptPortal.Vegas;

public class EntryPoint
{
    public void FromVegas(Vegas vegas)
    {
        string heartbeatPath = "${csString(hb)}";
        int port = ${port};
        string dir = Path.GetDirectoryName(heartbeatPath);
        if (!String.IsNullOrEmpty(dir) && !Directory.Exists(dir))
        {
            Directory.CreateDirectory(dir);
        }
        string payload = "{\\"ok\\":true,\\"host\\":\\"vegas-pro\\",\\"name\\":\\"VEGAS Pro\\",\\"port\\":" + port.ToString() + ",\\"at\\":\\"" + DateTime.UtcNow.ToString("o") + "\\"}";
        File.WriteAllText(heartbeatPath, payload);
    }
}
`;
}

async function probeVegasProBridge(): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath();
  if (!existsSync(p)) return { ok: false, message: 'VEGAS Pro bridge heartbeat has not been seen yet. Run AssetCutterVegasBridge from VEGAS Tools > Scripting.', heartbeatPath: p };
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string };
    if (json.host !== 'vegas-pro') return { ok: false, message: 'VEGAS Pro bridge heartbeat is invalid.', heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `VEGAS Pro bridge heartbeat detected ${mins} min ago.`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `VEGAS Pro bridge heartbeat cannot be read: ${msg}`, heartbeatPath: p };
  }
}

export async function getVegasProBridgeStatus(opts?: { home?: string; scriptsDirs?: string[] }): Promise<VegasProBridgeStatus> {
  const targets = discoverVegasProBridgeTargets(opts);
  const install = readVegasProBridgeInstallRecord();
  const port = install?.port || DEFAULT_VEGAS_PRO_BRIDGE_PORT;
  return {
    id: 'vegas-pro',
    name: 'VEGAS Pro',
    description: 'One-click C# Script Menu bridge using a local heartbeat probe.',
    defaultPort: DEFAULT_VEGAS_PRO_BRIDGE_PORT,
    port,
    roots: discoverVegasProRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeVegasProBridge(),
  };
}

function resolveInstallTargets(
  body: VegasProBridgeInstallBody,
  discovered: VegasProBridgeTarget[],
): { targets: VegasProBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: VegasProBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = resolve(String(dirRaw || '').trim());
    if (scriptsDir) targets.push(targetFromScriptsDir(scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_vegas_pro_scripts_dir' };
  return { targets: unique };
}

export function installVegasProBridge(
  body: VegasProBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverVegasProBridgeTargets({ home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_vegas_pro_scripts_dir',
      message: 'No VEGAS Pro Script Menu folder was found. Choose the Script Menu folder manually.',
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.scriptsDir, { recursive: true });
    writeFileSync(target.scriptPath, buildVegasProBridgeScript(port), 'utf8');
    installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
  }
  writeVegasProBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'VEGAS Pro bridge installed. Run AssetCutterVegasBridge from VEGAS Tools > Scripting, then probe connection.' };
}

export function uninstallVegasProBridge(
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const discovered = discoverVegasProBridgeTargets({ scriptsDirs: body.scriptsDirs });
  const record = readVegasProBridgeInstallRecord();
  const targets = new Map<string, VegasProBridgeTarget>();
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
  clearVegasProBridgeInstallRecord();
  return { ok: true, removed };
}
