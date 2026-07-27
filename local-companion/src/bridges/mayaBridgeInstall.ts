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
export const MAYA_BRIDGE_MEL_MARKER_START = '// ========== AssetCutter Maya Bridge (commandPort) ==========';
export const MAYA_BRIDGE_MEL_MARKER_END = '// ========== AssetCutter Maya Bridge end ==========';
export const MAYA_BRIDGE_PY_NAME = 'script_hub_bridge.py';
/** Pure-ASCII boot module: Maya 2020 (Py2.7) can still import this if userSetup.py is encoding-broken. */
export const MAYA_BRIDGE_BOOT_PY_NAME = 'assetcutter_maya_cmdport_boot.py';
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

/**
 * latin1 按字节往返：中文 Windows 上 Maya 2020 的 userSetup 常为 GBK。
 * 若用 utf8 读改写会破坏原文 → 整个 userSetup 语法错误 → 桥接块永不执行。
 * 标记块为纯 ASCII，在 latin1 下 strip/append 安全。
 */
export function readUserSetup(path: string): string {
  if (!existsSync(path)) return '';
  try {
    return readFileSync(path, 'latin1');
  } catch {
    return '';
  }
}

function writeUserSetup(path: string, content: string): void {
  const tmp = path + '.tmp';
  writeFileSync(tmp, content, 'latin1');
  renameSync(tmp, path);
}

/**
 * Maya 2020 = Python 2.7：源文件默认按 ASCII 解析。
 * 若已有 GBK 中文注释且无 coding 声明 → 整文件 SyntaxError，桥接块永远不跑。
 * 2022 = Python 3，默认 UTF-8，故同文件在 2022 往往仍能加载。
 */
export function ensurePy2SourceCodingCookie(content: string): string {
  if (!content) return content;
  if (!/[\x80-\xff]/.test(content)) return content;
  const head = content.slice(0, 512);
  if (/coding[:=][ \t]*[-_.a-zA-Z0-9]+/.test(head)) return content;
  if (content.startsWith('#!')) {
    const nl = content.indexOf('\n');
    if (nl >= 0) {
      return `${content.slice(0, nl + 1)}# -*- coding: gb18030 -*-\n${content.slice(nl + 1)}`;
    }
  }
  return `# -*- coding: gb18030 -*-\n${content}`;
}

function stripMarkedBlock(content: string, startMark: string, endMark: string): string {
  const start = content.indexOf(startMark);
  if (start < 0) return content;
  const end = content.indexOf(endMark, start);
  if (end < 0) {
    return (content.slice(0, start) + content.slice(start + startMark.length)).replace(/\n{3,}/g, '\n\n');
  }
  const after = end + endMark.length;
  let next = content.slice(0, start) + content.slice(after);
  next = next.replace(/\n{3,}/g, '\n\n').replace(/^\s+/, '').replace(/\s+$/, '');
  return next ? next + '\n' : '';
}

/** Remove AssetCutter Maya Bridge marker block (idempotent). */
export function stripMayaBridgeBlock(content: string): string {
  return stripMarkedBlock(content, MAYA_BRIDGE_MARKER_START, MAYA_BRIDGE_MARKER_END);
}

export function stripMayaBridgeMelBlock(content: string): string {
  return stripMarkedBlock(content, MAYA_BRIDGE_MEL_MARKER_START, MAYA_BRIDGE_MEL_MARKER_END);
}

/** Pure ASCII boot module body (written to scripts/). */
export function buildMayaBridgeBootPy(port: number): string {
  const p = Number.isFinite(port) && port > 0 && port <= 65535 ? Math.floor(port) : DEFAULT_MAYA_BRIDGE_PORT;
  return `# AssetCutter Maya Command Port boot (ASCII only; Maya 2020 Py2 + 2022+ Py3)
def ensure(port=${p}):
    import maya.cmds as cmds
    names = (
        "127.0.0.1:%d" % port,
        "localhost:%d" % port,
        ":%d" % port,
    )
    def _open():
        for name in names:
            try:
                if cmds.commandPort(name, q=True):
                    print("[AssetCutter Maya Bridge] commandPort already open: %s" % name)
                    return
            except Exception:
                pass
        last_err = None
        for name in names:
            try:
                try:
                    cmds.commandPort(name=name, sourceType="python", echoOutput=False)
                except Exception:
                    cmds.commandPort(name=name, sourceType="python")
                print("[AssetCutter Maya Bridge] commandPort ready: %s" % name)
                return
            except Exception as e:
                last_err = e
                print("[AssetCutter Maya Bridge] commandPort try failed (%s): %s" % (name, e))
        print("[AssetCutter Maya Bridge] commandPort failed: %s" % last_err)
    try:
        import maya.utils as utils
        utils.executeDeferred(_open)
    except Exception:
        _open()
`;
}

export function buildMayaBridgeUserSetupBlock(port: number): string {
  const p = Number.isFinite(port) && port > 0 && port <= 65535 ? Math.floor(port) : DEFAULT_MAYA_BRIDGE_PORT;
  // Thin ASCII shim — real logic lives in assetcutter_maya_cmdport_boot.py
  return `${MAYA_BRIDGE_MARKER_START}
try:
    import assetcutter_maya_cmdport_boot as _ac_maya_cmdport_boot
    _ac_maya_cmdport_boot.ensure(${p})
except Exception as e:
    print("[AssetCutter Maya Bridge] userSetup error: %s" % e)
${MAYA_BRIDGE_MARKER_END}
`;
}

export function buildMayaBridgeUserSetupMelBlock(port: number): string {
  const p = Number.isFinite(port) && port > 0 && port <= 65535 ? Math.floor(port) : DEFAULT_MAYA_BRIDGE_PORT;
  // MEL still loads even when userSetup.py dies on Py2 encoding errors.
  return `${MAYA_BRIDGE_MEL_MARKER_START}
global proc assetCutterMayaBridgeBoot()
{
    python("import assetcutter_maya_cmdport_boot as _ac_b; _ac_b.ensure(${p})");
}
evalDeferred("assetCutterMayaBridgeBoot()");
${MAYA_BRIDGE_MEL_MARKER_END}
`;
}

export function writeMayaBridgeBootPy(scriptsDir: string, port: number): string {
  if (!existsSync(scriptsDir)) mkdirSync(scriptsDir, { recursive: true });
  const bootPath = join(scriptsDir, MAYA_BRIDGE_BOOT_PY_NAME);
  const tmp = bootPath + '.tmp';
  writeFileSync(tmp, buildMayaBridgeBootPy(port), 'utf8');
  renameSync(tmp, bootPath);
  return bootPath;
}

export function upsertMayaBridgeUserSetup(userSetupPath: string, port: number): { wrote: boolean; path: string } {
  const dir = dirname(userSetupPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = readUserSetup(userSetupPath);
  const stripped = stripMayaBridgeBlock(existing);
  const withCookie = ensurePy2SourceCodingCookie(stripped);
  const next = (withCookie ? withCookie.replace(/\s*$/, '\n\n') : '') + buildMayaBridgeUserSetupBlock(port);
  writeUserSetup(userSetupPath, next);
  return { wrote: true, path: userSetupPath };
}

export function upsertMayaBridgeUserSetupMel(userSetupMelPath: string, port: number): { wrote: boolean; path: string } {
  const dir = dirname(userSetupMelPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = existsSync(userSetupMelPath) ? readFileSync(userSetupMelPath, 'latin1') : '';
  const stripped = stripMayaBridgeMelBlock(existing);
  const next = (stripped ? stripped.replace(/\s*$/, '\n\n') : '') + buildMayaBridgeUserSetupMelBlock(port);
  const tmp = userSetupMelPath + '.tmp';
  writeFileSync(tmp, next, 'latin1');
  renameSync(tmp, userSetupMelPath);
  return { wrote: true, path: userSetupMelPath };
}

export function removeMayaBridgeUserSetup(userSetupPath: string): { removed: boolean; path: string } {
  if (!existsSync(userSetupPath)) return { removed: false, path: userSetupPath };
  const existing = readUserSetup(userSetupPath);
  if (!userSetupHasMarker(existing)) return { removed: false, path: userSetupPath };
  const next = stripMayaBridgeBlock(existing);
  writeUserSetup(userSetupPath, next);
  return { removed: true, path: userSetupPath };
}

export function removeMayaBridgeUserSetupMel(userSetupMelPath: string): { removed: boolean; path: string } {
  if (!existsSync(userSetupMelPath)) return { removed: false, path: userSetupMelPath };
  const existing = readFileSync(userSetupMelPath, 'latin1');
  if (!existing.includes(MAYA_BRIDGE_MEL_MARKER_START)) return { removed: false, path: userSetupMelPath };
  const next = stripMayaBridgeMelBlock(existing);
  const tmp = userSetupMelPath + '.tmp';
  writeFileSync(tmp, next, 'latin1');
  renameSync(tmp, userSetupMelPath);
  return { removed: true, path: userSetupMelPath };
}

function versionFromScriptsDir(scriptsDir: string, mayaRoot: string): MayaBridgeVersion {
  const resolvedDir = resolve(scriptsDir);
  const rel = resolvedDir.replace(/\\/g, '/');
  const m = rel.match(/\/maya\/(\d{4})\/scripts\/?$/i);
  const yearOrShared = m ? m[1]! : resolvedDir === resolve(join(mayaRoot, 'scripts')) ? 'shared' : 'custom';
  // id 必须能区分「Documents vs 文档 / OneDrive」等同年版本多路径，否则勾选 2020 只装到其中一个
  const id = `${yearOrShared}::${resolvedDir}`;
  const label = m
    ? `Maya ${m[1]}`
    : yearOrShared === 'shared'
      ? 'Maya（共享 scripts）'
      : `Maya（${resolvedDir}）`;
  const userSetupPath = join(resolvedDir, 'userSetup.py');
  const userSetupMelPath = join(resolvedDir, 'userSetup.mel');
  const content = readUserSetup(userSetupPath);
  let melHas = false;
  try {
    if (existsSync(userSetupMelPath)) {
      melHas = readFileSync(userSetupMelPath, 'latin1').includes(MAYA_BRIDGE_MEL_MARKER_START);
    }
  } catch {
    melHas = false;
  }
  const bootHas = existsSync(join(resolvedDir, MAYA_BRIDGE_BOOT_PY_NAME));
  return {
    id,
    label,
    scriptsDir: resolvedDir,
    userSetupPath,
    hasUserSetupMarker: userSetupHasMarker(content) || melHas || bootHas,
    hasBridgePy: existsSync(join(resolvedDir, MAYA_BRIDGE_PY_NAME)),
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
    const seen = new Set<string>();
    for (const id of wantVersions) {
      const exact = byId.get(id);
      if (exact) {
        const key = resolve(exact.scriptsDir);
        if (!seen.has(key)) {
          seen.add(key);
          targets.push(exact);
        }
        continue;
      }
      // 兼容旧 UI：仅传 "2020" 时安装所有匹配该年份的 scripts 路径
      const year = String(id).trim();
      const yearMatches = discovered.filter(
        (v) => v.id === year || v.id.startsWith(`${year}::`) || v.label === `Maya ${year}`,
      );
      if (!yearMatches.length) return { targets: [], error: `unknown_version:${id}` };
      for (const v of yearMatches) {
        const key = resolve(v.scriptsDir);
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push(v);
      }
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
    writeMayaBridgeBootPy(t.scriptsDir, port);
    const { path: userSetupPath } = upsertMayaBridgeUserSetup(t.userSetupPath, port);
    upsertMayaBridgeUserSetupMel(join(t.scriptsDir, 'userSetup.mel'), port);
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

  const pathHint = installed.map((x) => `${x.versionId.split('::')[0]} → ${x.userSetupPath}`).join('\n');
  return {
    ok: true,
    port,
    installed,
    message:
      '已写入 userSetup.py / userSetup.mel / boot 与 Script Hub Bridge（兼容 Maya 2020 Py2）。请重启对应版本的 Maya，再点「探测连接」。\n' +
      pathHint,
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
    const mel = removeMayaBridgeUserSetupMel(join(t.scriptsDir, 'userSetup.mel'));
    removed.push({
      versionId: t.id,
      userSetupPath: t.userSetupPath,
      removed: r.removed || mel.removed,
    });
  }

  if (body.clearRecord !== false) {
    clearMayaBridgeInstallRecord();
  }

  return {
    ok: true,
    removed,
    message:
      '已移除 userSetup.py / userSetup.mel 中的桥接标记块（保留 script_hub_bridge.py 与 boot）。重启 Maya 后端口不再自动开启。',
  };
}
