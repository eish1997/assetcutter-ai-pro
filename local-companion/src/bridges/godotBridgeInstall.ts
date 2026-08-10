import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';
import { readCustomHostTargetsForHost, upsertCustomHostTarget, type ManualTargetResolveResult } from './customHostTargets.js';

export const DEFAULT_GODOT_BRIDGE_PORT = 7171;
export const GODOT_PLUGIN_DIR_NAME = 'assetcutter_bridge';
export const GODOT_PLUGIN_CFG_NAME = 'plugin.cfg';
export const GODOT_PLUGIN_SCRIPT_NAME = 'assetcutter_bridge.gd';

export type GodotBridgeTarget = {
  id: string;
  label: string;
  projectDir: string;
  pluginDir: string;
  pluginCfgPath: string;
  pluginScriptPath: string;
  hasPluginBridge: boolean;
};

export type GodotBridgeInstallRecord = {
  port: number;
  installedAt: string;
  projectDirs: string[];
  targetIds: string[];
};

export type GodotBridgeStatus = {
  id: 'godot';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: GodotBridgeTarget[];
  install: GodotBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type GodotBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'godot-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_GODOT_BRIDGE_PORT;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverGodotRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.GODOT_PROJECT_DIRS?.trim();
  if (fromEnv) {
    for (const p of fromEnv.split(/[;|]/g)) {
      const s = p.trim();
      if (s) roots.push(resolve(s));
    }
  }
  roots.push(resolve(join(home, 'Documents')));
  roots.push(resolve(join(home, 'OneDrive', 'Documents')));
  roots.push(resolve(join(home, 'Projects')));
  roots.push(resolve(join(home, 'Godot')));
  return roots.filter((root, idx, arr) => rootExists(root) && arr.indexOf(root) === idx);
}

function targetFromProjectDir(projectDir: string): GodotBridgeTarget {
  const resolvedDir = resolve(projectDir);
  const pluginDir = join(resolvedDir, 'addons', GODOT_PLUGIN_DIR_NAME);
  return {
    id: `godot::${resolvedDir}`,
    label: `Godot ${basename(resolvedDir) || 'project'}`,
    projectDir: resolvedDir,
    pluginDir,
    pluginCfgPath: join(pluginDir, GODOT_PLUGIN_CFG_NAME),
    pluginScriptPath: join(pluginDir, GODOT_PLUGIN_SCRIPT_NAME),
    hasPluginBridge: existsSync(join(pluginDir, GODOT_PLUGIN_CFG_NAME)) && existsSync(join(pluginDir, GODOT_PLUGIN_SCRIPT_NAME)),
  };
}

function looksLikeGodotProject(dir: string): boolean {
  return existsSync(join(dir, 'project.godot'));
}

function normalizeGodotManualTarget(input: string): ManualTargetResolveResult & { ok: boolean; resolvedPath?: string } {
  const selected = resolve(String(input || '').trim());
  if (looksLikeGodotProject(selected)) return { ok: true, inputPath: selected, resolvedPath: selected, targetKind: 'project_dir' };
  return {
    ok: false,
    inputPath: selected,
    error: 'invalid_godot_project_dir',
    message: '请选择 Godot 项目根目录，需要包含 project.godot 文件。不要选择 Godot 编辑器安装目录。',
  };
}

export function discoverGodotBridgeTargets(opts?: { home?: string; projectDirs?: string[] }): GodotBridgeTarget[] {
  const byDir = new Map<string, GodotBridgeTarget>();
  for (const root of discoverGodotRoots(opts?.home)) {
    if (looksLikeGodotProject(root)) byDir.set(resolve(root), targetFromProjectDir(root));
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      names = [];
    }
    for (const name of names) {
      const dir = join(root, name);
      if (!rootExists(dir) || !looksLikeGodotProject(dir)) continue;
      byDir.set(resolve(dir), targetFromProjectDir(dir));
    }
  }
  for (const dirRaw of opts?.projectDirs || []) {
    const manual = normalizeGodotManualTarget(String(dirRaw || '').trim());
    if (manual.ok && manual.resolvedPath) byDir.set(manual.resolvedPath, targetFromProjectDir(manual.resolvedPath));
  }
  for (const custom of readCustomHostTargetsForHost('godot')) {
    const manual = normalizeGodotManualTarget(custom.resolvedPath);
    if (manual.ok && manual.resolvedPath) byDir.set(manual.resolvedPath, targetFromProjectDir(manual.resolvedPath));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readGodotBridgeInstallRecord(): GodotBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as GodotBridgeInstallRecord;
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

function writeGodotBridgeInstallRecord(rec: GodotBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearGodotBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildGodotPluginCfg(): string {
  return `[plugin]
name="AssetCutter Bridge"
description="Local AssetCutter bridge for project automation and health checks."
author="AssetCutter"
version="1.0.0"
script="${GODOT_PLUGIN_SCRIPT_NAME}"
`;
}

function buildGodotPluginScript(port: number): string {
  return `@tool
extends EditorPlugin

const PORT := ${port}
var _server := TCPServer.new()
var _clients := []

func _enter_tree():
    var err := _server.listen(PORT, "127.0.0.1")
    if err == OK:
        print("[AssetCutter Godot Bridge] ready on 127.0.0.1:%s" % PORT)
        set_process(true)
    else:
        push_warning("[AssetCutter Godot Bridge] failed to listen on 127.0.0.1:%s error=%s" % [PORT, err])

func _exit_tree():
    set_process(false)
    for c in _clients:
        if c:
            c.disconnect_from_host()
    _clients.clear()
    _server.stop()

func _process(_delta):
    if _server.is_connection_available():
        var peer := _server.take_connection()
        if peer:
            _clients.append(peer)
    for i in range(_clients.size() - 1, -1, -1):
        var peer := _clients[i]
        if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
            _clients.remove_at(i)
            continue
        var available := peer.get_available_bytes()
        if available <= 0:
            continue
        var req := peer.get_utf8_string(available)
        var first := req.get_slice("\\r\\n", 0)
        var body := JSON.stringify({
            "ok": true,
            "host": "godot",
            "version": Engine.get_version_info().get("string", ""),
            "project": ProjectSettings.globalize_path("res://")
        })
        var status := "200 OK"
        if not first.begins_with("GET /health "):
            status = "404 Not Found"
            body = JSON.stringify({ "ok": false, "error": "not_found" })
        var res := "HTTP/1.1 %s\\r\\nContent-Type: application/json; charset=utf-8\\r\\nContent-Length: %d\\r\\nConnection: close\\r\\n\\r\\n%s" % [status, body.to_utf8_buffer().size(), body]
        peer.put_data(res.to_utf8_buffer())
        peer.disconnect_from_host()
        _clients.remove_at(i)
`;
}

async function probeGodotBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `Godot bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean; version?: string; project?: string } | null;
    return json && json.ok
      ? { ok: true, message: `Godot bridge connected${json.version ? ` (${json.version})` : ''}${json.project ? ` - ${json.project}` : ''}` }
      : { ok: false, message: 'Godot bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Godot bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getGodotBridgeStatus(opts?: { home?: string; projectDirs?: string[] }): Promise<GodotBridgeStatus> {
  const targets = discoverGodotBridgeTargets(opts);
  const install = readGodotBridgeInstallRecord();
  const port = install?.port || DEFAULT_GODOT_BRIDGE_PORT;
  return {
    id: 'godot',
    name: 'Godot',
    description: 'One-click project EditorPlugin bridge using a local HTTP probe.',
    defaultPort: DEFAULT_GODOT_BRIDGE_PORT,
    port,
    roots: discoverGodotRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasPluginBridge) || Boolean(install?.projectDirs.length),
    probe: await probeGodotBridge(port),
  };
}

function resolveInstallTargets(
  body: GodotBridgeInstallBody,
  discovered: GodotBridgeTarget[],
): { targets: GodotBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: GodotBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.projectDirs || []) {
    const manual = normalizeGodotManualTarget(String(dirRaw || '').trim());
    if (!manual.ok) return { targets: [], error: manual.error || 'invalid_godot_project_dir' };
    if (manual.resolvedPath) targets.push(targetFromProjectDir(manual.resolvedPath));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.projectDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_godot_project_dir' };
  return { targets: unique };
}

export function installGodotBridge(
  body: GodotBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; projectDir: string; pluginDir: string; pluginCfgPath: string; pluginScriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverGodotBridgeTargets({ home: body.home, projectDirs: body.projectDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    const invalid = resolved.error === 'invalid_godot_project_dir';
    return {
      ok: false,
      error: resolved.error || 'no_godot_project_dir',
      message: invalid
        ? '请选择 Godot 项目根目录，需要包含 project.godot 文件。不要选择 Godot 编辑器安装目录。'
        : 'No Godot project folder was found. Choose a folder containing project.godot manually.',
    };
  }
  const installed: Array<{ targetId: string; projectDir: string; pluginDir: string; pluginCfgPath: string; pluginScriptPath: string }> = [];
  for (const target of resolved.targets) {
    if (!existsSync(join(target.projectDir, 'project.godot'))) {
      return {
        ok: false,
        error: 'invalid_godot_project_dir',
        message: 'The selected Godot folder does not contain project.godot.',
      };
    }
    try {
      mkdirSync(target.pluginDir, { recursive: true });
      writeFileSync(target.pluginCfgPath, buildGodotPluginCfg(), 'utf8');
      writeFileSync(target.pluginScriptPath, buildGodotPluginScript(port), 'utf8');
      installed.push({
        targetId: target.id,
        projectDir: target.projectDir,
        pluginDir: target.pluginDir,
        pluginCfgPath: target.pluginCfgPath,
        pluginScriptPath: target.pluginScriptPath,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const locked = /eperm|eacces|permission|operation not permitted/i.test(msg);
      return {
        ok: false,
        error: locked ? 'permission_denied' : 'install_failed',
        message: locked ? `无法写入 Godot 项目桥接插件：${target.pluginDir}。请确认项目目录可写。` : `Godot 桥接安装失败：${msg}`,
      };
    }
  }
  for (const dirRaw of body.projectDirs || []) {
    const manual = normalizeGodotManualTarget(String(dirRaw || '').trim());
    if (!manual.ok || !manual.resolvedPath) continue;
    const found = installed.find((item) => resolve(item.projectDir) === resolve(manual.resolvedPath as string));
    if (!found) continue;
    upsertCustomHostTarget('godot', {
      label: `Godot ${basename(manual.resolvedPath) || '项目'}（手动添加）`,
      inputPath: String(dirRaw || '').trim(),
      resolvedPath: manual.resolvedPath,
      targetKind: 'project_dir',
    });
  }
  writeGodotBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    projectDirs: installed.map((x) => x.projectDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Godot bridge installed. Enable the AssetCutter Bridge plugin in Project Settings, then probe connection.' };
}

export function uninstallGodotBridge(
  body: { targets?: string[]; projectDirs?: string[] } = {},
): { ok: true; removed: Array<{ projectDir: string; pluginDir: string }> } {
  const hasExplicitDirs = Array.isArray(body.projectDirs) && body.projectDirs.length > 0;
  const discovered = hasExplicitDirs ? [] : discoverGodotBridgeTargets();
  const explicit = hasExplicitDirs
    ? (body.projectDirs || [])
        .map((dir) => normalizeGodotManualTarget(dir))
        .filter((item): item is ManualTargetResolveResult & { ok: true; resolvedPath: string } => Boolean(item.ok && item.resolvedPath))
        .map((item) => targetFromProjectDir(item.resolvedPath))
    : [];
  const record = readGodotBridgeInstallRecord();
  const targets = new Map<string, GodotBridgeTarget>();
  for (const v of explicit.concat(discovered)) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.projectDir, v);
  }
  for (const dir of record?.projectDirs || []) targets.set(resolve(dir), targetFromProjectDir(dir));
  const removed: Array<{ projectDir: string; pluginDir: string }> = [];
  for (const target of targets.values()) {
    if (!existsSync(target.pluginDir)) continue;
    try {
      rmSync(target.pluginDir, { recursive: true, force: true });
      removed.push({ projectDir: target.projectDir, pluginDir: target.pluginDir });
    } catch {
      /* ignore */
    }
  }
  clearGodotBridgeInstallRecord();
  return { ok: true, removed };
}
