/**
 * Maya Command Port bridge: copy script_hub_bridge.py + idempotent userSetup block.
 * Does not launch Maya; caller probes via GET /v1/script-connectors after restart.
 */
import {
  copyFileSync,
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRepositoryRoot } from '../repositoryVolume.js';

export const MAYA_BRIDGE_MARKER_START = '# ========== AssetCutter Maya Bridge (commandPort) ==========';
export const MAYA_BRIDGE_MARKER_END = '# ========== AssetCutter Maya Bridge end ==========';
export const MAYA_BRIDGE_PY_NAME = 'script_hub_bridge.py';
export const DEFAULT_MAYA_BRIDGE_PORT = 7001;

export type MayaBridgeVersion = {
  id: string;
  label: string;
  scriptsDir: string;
  userSetupPath: string;
  hasUserSetupMarker: boolean;
  hasBridgePy: boolean;
};

export type MayaBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  versionIds: string[];
};

export type MayaBridgeStatus = {
  id: 'maya';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  mayaRootCandidates: string[];
  versions: MayaBridgeVersion[];
  install: MayaBridgeInstallRecord | null;
  bridgeSourcePath: string | null;
  installed: boolean;
};

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function installRecordPath(): string {
  return join(bridgesStateDir(), 'maya-install.json');
}

export function resolveMayaBridgeSourcePy(): string | null {
  const fromEnv = process.env.COMPANION_MAYA_BRIDGE_SOURCE?.trim();
  if (fromEnv && existsSync(fromEnv)) return resolve(fromEnv);

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Packaged: local-companion-bundle/maya-plugins/... (next to bundled main.cjs)
    join(here, 'maya-plugins', 'script-hub-bridge', MAYA_BRIDGE_PY_NAME),
    join(process.cwd(), 'maya-plugins', 'script-hub-bridge', MAYA_BRIDGE_PY_NAME),
    // Dev: local-companion/src/bridges → repo root
    join(here, '..', '..', '..', 'maya-plugins', 'script-hub-bridge', MAYA_BRIDGE_PY_NAME),
    join(here, '..', '..', 'maya-plugins', 'script-hub-bridge', MAYA_BRIDGE_PY_NAME),
    join(here, '..', 'maya-plugins', 'script-hub-bridge', MAYA_BRIDGE_PY_NAME),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return resolve(c);
  }
  return null;
}

export function discoverMayaAppRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.MAYA_APP_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  // 常见用户目录（含 OneDrive 已知文件夹重定向）— 任意用户机通用，不依赖本机布局
  const relCandidates = [
    ['Documents', 'maya'],
    ['文档', 'maya'],
    ['OneDrive', 'Documents', 'maya'],
    ['OneDrive', '文档', 'maya'],
    ['OneDrive - Personal', 'Documents', 'maya'],
    ['OneDrive - Personal', '文档', 'maya'],
  ];
  for (const parts of relCandidates) {
    roots.push(resolve(join(home, ...parts)));
  }
  const out: string[] = [];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    try {
      if (!statSync(r).isDirectory()) continue;
    } catch {
      continue;
    }
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

function userSetupHasMarker(content: string): boolean {
  return content.includes(MAYA_BRIDGE_MARKER_START);
}

export function readUserSetup(path: string): string {
  if (!existsSync(path)) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  }
}

/** Remove AssetCutter Maya Bridge marker block (idempotent). */
export function stripMayaBridgeBlock(content: string): string {
  const start = content.indexOf(MAYA_BRIDGE_MARKER_START);
  if (start < 0) return content;
  const end = content.indexOf(MAYA_BRIDGE_MARKER_END, start);
  if (end < 0) {
    return (content.slice(0, start) + content.slice(start + MAYA_BRIDGE_MARKER_START.length)).replace(
      /\n{3,}/g,
      '\n\n',
    );
  }
  const after = end + MAYA_BRIDGE_MARKER_END.length;
  let next = content.slice(0, start) + content.slice(after);
  next = next.replace(/\n{3,}/g, '\n\n').replace(/^\s+/, '').replace(/\s+$/, '');
  return next ? next + '\n' : '';
}

export function buildMayaBridgeUserSetupBlock(port: number): string {
  const p = Number.isFinite(port) && port > 0 && port <= 65535 ? Math.floor(port) : DEFAULT_MAYA_BRIDGE_PORT;
  return `${MAYA_BRIDGE_MARKER_START}
try:
    import maya.cmds as _ac_maya_bridge_cmds
    _ac_maya_bridge_port = ${p}

    def _ac_maya_bridge_ensure_port():
        name = "127.0.0.1:%d" % _ac_maya_bridge_port
        try:
            if _ac_maya_bridge_cmds.commandPort(name, q=True):
                return
            try:
                _ac_maya_bridge_cmds.commandPort(
                    name=name,
                    sourceType="python",
                    securityWarning=False,
                    bufferSize=262144,
                )
            except TypeError:
                _ac_maya_bridge_cmds.commandPort(name=name, sourceType="python")
            print("[AssetCutter Maya Bridge] commandPort ready: %s" % name)
        except Exception as e:
            print("[AssetCutter Maya Bridge] commandPort failed: %s" % e)

    try:
        import maya.utils as _ac_maya_bridge_utils
        _ac_maya_bridge_utils.executeDeferred(_ac_maya_bridge_ensure_port)
    except Exception:
        _ac_maya_bridge_ensure_port()
except Exception as e:
    print("[AssetCutter Maya Bridge] userSetup error: %s" % e)
${MAYA_BRIDGE_MARKER_END}
`;
}

export function upsertMayaBridgeUserSetup(userSetupPath: string, port: number): { wrote: boolean; path: string } {
  const dir = dirname(userSetupPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = readUserSetup(userSetupPath);
  const stripped = stripMayaBridgeBlock(existing);
  const next = (stripped ? stripped.replace(/\s*$/, '\n\n') : '') + buildMayaBridgeUserSetupBlock(port);
  const tmp = userSetupPath + '.tmp';
  writeFileSync(tmp, next, 'utf8');
  renameSync(tmp, userSetupPath);
  return { wrote: true, path: userSetupPath };
}

export function removeMayaBridgeUserSetup(userSetupPath: string): { removed: boolean; path: string } {
  if (!existsSync(userSetupPath)) return { removed: false, path: userSetupPath };
  const existing = readUserSetup(userSetupPath);
  if (!userSetupHasMarker(existing)) return { removed: false, path: userSetupPath };
  const next = stripMayaBridgeBlock(existing);
  const tmp = userSetupPath + '.tmp';
  writeFileSync(tmp, next, 'utf8');
  renameSync(tmp, userSetupPath);
  return { removed: true, path: userSetupPath };
}

function versionFromScriptsDir(scriptsDir: string, mayaRoot: string): MayaBridgeVersion {
  const rel = scriptsDir.replace(/\\/g, '/');
  const m = rel.match(/\/maya\/(\d{4})\/scripts\/?$/i);
  const id = m ? m[1]! : scriptsDir === join(mayaRoot, 'scripts') ? 'shared' : scriptsDir;
  const label = m ? `Maya ${m[1]}` : id === 'shared' ? 'Maya（共享 scripts）' : scriptsDir;
  const userSetupPath = join(scriptsDir, 'userSetup.py');
  const content = readUserSetup(userSetupPath);
  return {
    id,
    label,
    scriptsDir,
    userSetupPath,
    hasUserSetupMarker: userSetupHasMarker(content),
    hasBridgePy: existsSync(join(scriptsDir, MAYA_BRIDGE_PY_NAME)),
  };
}

export function discoverMayaBridgeVersions(opts?: { home?: string; extraScriptsDirs?: string[] }): MayaBridgeVersion[] {
  const roots = discoverMayaAppRoots(opts?.home);
  const byDir = new Map<string, MayaBridgeVersion>();

  for (const root of roots) {
    const sharedScripts = join(root, 'scripts');
    if (existsSync(sharedScripts) && statSync(sharedScripts).isDirectory()) {
      const v = versionFromScriptsDir(sharedScripts, root);
      byDir.set(resolve(sharedScripts), v);
    }
    let entries: string[] = [];
    try {
      entries = readdirSync(root);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      if (!/^\d{4}$/.test(name)) continue;
      const scriptsDir = join(root, name, 'scripts');
      if (!existsSync(scriptsDir)) {
        // Still offer as install target if year folder exists (or create on install).
        try {
          if (!statSync(join(root, name)).isDirectory()) continue;
        } catch {
          continue;
        }
      }
      const v = versionFromScriptsDir(scriptsDir, root);
      byDir.set(resolve(scriptsDir), v);
    }
  }

  for (const extra of opts?.extraScriptsDirs || []) {
    const dir = resolve(String(extra || '').trim());
    if (!dir) continue;
    const parentMaya = dirname(dirname(dir));
    const v = versionFromScriptsDir(dir, parentMaya);
    byDir.set(dir, v);
  }

  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readMayaBridgeInstallRecord(): MayaBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as MayaBridgeInstallRecord;
    if (!raw || typeof raw !== 'object') return null;
    const port = Number(raw.port);
    return {
      port: Number.isFinite(port) && port > 0 ? Math.floor(port) : DEFAULT_MAYA_BRIDGE_PORT,
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      scriptsDirs: Array.isArray(raw.scriptsDirs) ? raw.scriptsDirs.map(String) : [],
      versionIds: Array.isArray(raw.versionIds) ? raw.versionIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function writeMayaBridgeInstallRecord(rec: MayaBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearMayaBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

export function listBridgesCatalog(): Array<{
  id: string;
  name: string;
  description: string;
  status: 'ready' | 'placeholder';
}> {
  return [
    {
      id: 'maya',
      name: 'Maya',
      description: 'Command Port 桥：一键写入 userSetup，启动时自动监听 Python 端口',
      status: 'ready',
    },
    {
      id: 'unreal',
      name: 'Unreal',
      description: '后续接入（当前 script-connectors 为 skipped）',
      status: 'placeholder',
    },
  ];
}

export function getMayaBridgeStatus(opts?: { home?: string; extraScriptsDirs?: string[] }): MayaBridgeStatus {
  const versions = discoverMayaBridgeVersions(opts);
  const install = readMayaBridgeInstallRecord();
  const installed = versions.some((v) => v.hasUserSetupMarker) || Boolean(install?.scriptsDirs?.length);
  return {
    id: 'maya',
    name: 'Maya',
    description: 'Command Port 桥：一键安装后重启 Maya 即可被伴侣探测',
    defaultPort: DEFAULT_MAYA_BRIDGE_PORT,
    port: install?.port || DEFAULT_MAYA_BRIDGE_PORT,
    mayaRootCandidates: discoverMayaAppRoots(opts?.home),
    versions,
    install,
    bridgeSourcePath: resolveMayaBridgeSourcePy(),
    installed,
  };
}

export type MayaBridgeInstallBody = {
  versions?: string[];
  port?: number;
  scriptsDirs?: string[];
  home?: string;
};

export type MayaBridgeInstallResult =
  | {
      ok: true;
      port: number;
      installed: Array<{ versionId: string; scriptsDir: string; userSetupPath: string; bridgePyPath: string }>;
      message: string;
    }
  | { ok: false; error: string; message: string };

function resolveInstallTargets(
  body: MayaBridgeInstallBody,
  discovered: MayaBridgeVersion[],
): { targets: MayaBridgeVersion[]; error?: string } {
  const extraDirs = (body.scriptsDirs || []).map((s) => resolve(String(s).trim())).filter(Boolean);
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const byDir = new Map(discovered.map((v) => [resolve(v.scriptsDir), v]));

  for (const d of extraDirs) {
    if (!byDir.has(d)) {
      const v = versionFromScriptsDir(d, dirname(dirname(d)));
      byDir.set(d, v);
      byId.set(v.id, v);
    }
  }

  const wantVersions = Array.isArray(body.versions) ? body.versions.map(String).filter(Boolean) : [];
  if (extraDirs.length) {
    return { targets: extraDirs.map((d) => byDir.get(d)!).filter(Boolean) };
  }
  if (wantVersions.length) {
    const targets: MayaBridgeVersion[] = [];
    for (const id of wantVersions) {
      const v = byId.get(id);
      if (!v) return { targets: [], error: `unknown_version:${id}` };
      targets.push(v);
    }
    return { targets };
  }
  const all = Array.from(byDir.values());
  if (!all.length) return { targets: [], error: 'no_maya_scripts_dir' };
  return { targets: all };
}

export function installMayaBridge(body: MayaBridgeInstallBody = {}): MayaBridgeInstallResult {
  const source = resolveMayaBridgeSourcePy();
  if (!source) {
    return {
      ok: false,
      error: 'bridge_source_missing',
      message: '未找到 script_hub_bridge.py（请确认仓库 maya-plugins/script-hub-bridge 存在）',
    };
  }

  const portRaw = body.port != null ? Number(body.port) : DEFAULT_MAYA_BRIDGE_PORT;
  const port =
    Number.isFinite(portRaw) && portRaw > 0 && portRaw <= 65535
      ? Math.floor(portRaw)
      : DEFAULT_MAYA_BRIDGE_PORT;

  const discovered = discoverMayaBridgeVersions({
    home: body.home,
    extraScriptsDirs: body.scriptsDirs,
  });
  const { targets, error } = resolveInstallTargets(body, discovered);
  if (error === 'no_maya_scripts_dir') {
    return {
      ok: false,
      error,
      message: '未发现 Maya 用户 scripts 目录。请先安装/运行过 Maya，或手动选择 …/maya/<版本>/scripts',
    };
  }
  if (error) {
    return { ok: false, error: 'unknown_version', message: `未找到版本：${error.replace('unknown_version:', '')}` };
  }
  if (!targets.length) {
    return { ok: false, error: 'no_targets', message: '未选择安装目标' };
  }

  const installed: Array<{
    versionId: string;
    scriptsDir: string;
    userSetupPath: string;
    bridgePyPath: string;
  }> = [];

  for (const t of targets) {
    if (!existsSync(t.scriptsDir)) mkdirSync(t.scriptsDir, { recursive: true });
    const bridgePyPath = join(t.scriptsDir, MAYA_BRIDGE_PY_NAME);
    copyFileSync(source, bridgePyPath);
    const { path: userSetupPath } = upsertMayaBridgeUserSetup(t.userSetupPath, port);
    installed.push({
      versionId: t.id,
      scriptsDir: t.scriptsDir,
      userSetupPath,
      bridgePyPath,
    });
  }

  writeMayaBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    versionIds: installed.map((x) => x.versionId),
  });

  return {
    ok: true,
    port,
    installed,
    message: '已写入 userSetup 与 Script Hub Bridge。请重启或打开 Maya，再点「探测连接」。',
  };
}

export type MayaBridgeUninstallBody = {
  versions?: string[];
  scriptsDirs?: string[];
  home?: string;
  clearRecord?: boolean;
};

export function uninstallMayaBridge(body: MayaBridgeUninstallBody = {}): {
  ok: true;
  removed: Array<{ versionId: string; userSetupPath: string; removed: boolean }>;
  message: string;
} {
  const discovered = discoverMayaBridgeVersions({
    home: body.home,
    extraScriptsDirs: body.scriptsDirs,
  });
  const record = readMayaBridgeInstallRecord();
  const { targets, error } = resolveInstallTargets(
    { versions: body.versions, scriptsDirs: body.scriptsDirs || record?.scriptsDirs },
    discovered,
  );

  let list = targets;
  if (error === 'no_maya_scripts_dir' || !list.length) {
    // Fall back to record paths + any version that still has the marker.
    const fromRecord = (record?.scriptsDirs || []).map((d) =>
      versionFromScriptsDir(resolve(d), dirname(dirname(resolve(d)))),
    );
    const marked = discovered.filter((v) => v.hasUserSetupMarker);
    const map = new Map<string, MayaBridgeVersion>();
    for (const v of [...fromRecord, ...marked]) map.set(resolve(v.scriptsDir), v);
    list = Array.from(map.values());
  }

  const removed: Array<{ versionId: string; userSetupPath: string; removed: boolean }> = [];
  for (const t of list) {
    const r = removeMayaBridgeUserSetup(t.userSetupPath);
    removed.push({ versionId: t.id, userSetupPath: t.userSetupPath, removed: r.removed });
  }

  if (body.clearRecord !== false) {
    clearMayaBridgeInstallRecord();
  }

  return {
    ok: true,
    removed,
    message: '已移除 userSetup 中的桥接标记块（保留 script_hub_bridge.py）。重启 Maya 后端口不再自动开启。',
  };
}
