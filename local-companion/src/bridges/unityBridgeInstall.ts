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

export const DEFAULT_UNITY_BRIDGE_PORT = 7111;
export const UNITY_BRIDGE_SCRIPT_NAME = 'AssetCutterUnityBridge.cs';

export type UnityBridgeTarget = {
  id: string;
  label: string;
  projectDir: string;
  editorDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type UnityBridgeInstallRecord = {
  port: number;
  installedAt: string;
  projectDirs: string[];
  targetIds: string[];
};

export type UnityBridgeStatus = {
  id: 'unity';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: UnityBridgeTarget[];
  install: UnityBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type UnityBridgeInstallBody = {
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
  return join(bridgesStateDir(), 'unity-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_UNITY_BRIDGE_PORT;
}

function isUnityProjectDir(dir: string): boolean {
  try {
    return existsSync(join(dir, 'Assets')) && statSync(join(dir, 'Assets')).isDirectory();
  } catch {
    return false;
  }
}

function findUnityProjectDir(input: string): string | null {
  let current = resolve(String(input || '').trim());
  for (let i = 0; i < 6; i += 1) {
    if (isUnityProjectDir(current)) return current;
    const parent = dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return null;
}

function normalizeUnityManualTarget(input: string): ManualTargetResolveResult & { ok: boolean; resolvedPath?: string } {
  const selected = resolve(String(input || '').trim());
  const projectDir = findUnityProjectDir(selected);
  if (projectDir) {
    const warnings = projectDir === selected ? [] : ['已自动从所选子目录定位到 Unity 项目根目录。'];
    return { ok: true, inputPath: selected, resolvedPath: projectDir, targetKind: 'project_dir', warnings };
  }
  return {
    ok: false,
    inputPath: selected,
    error: 'invalid_unity_project_dir',
    message: '请选择 Unity 项目根目录，或项目内的 Assets / Assets/Editor 子目录；不要选择 Unity Hub 或 Unity Editor 安装目录。',
  };
}

export function discoverUnityRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.UNITY_PROJECTS_ROOT?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  roots.push(resolve(join(home, 'Documents')));
  roots.push(resolve(join(home, 'Unity')));
  roots.push(resolve(join(home, 'Unity Projects')));
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

function targetFromProjectDir(projectDir: string): UnityBridgeTarget {
  const resolvedDir = resolve(projectDir);
  const editorDir = join(resolvedDir, 'Assets', 'Editor');
  return {
    id: `unity::${resolvedDir}`,
    label: `Unity ${basename(resolvedDir) || 'project'}`,
    projectDir: resolvedDir,
    editorDir,
    scriptPath: join(editorDir, UNITY_BRIDGE_SCRIPT_NAME),
    hasScriptBridge: existsSync(join(editorDir, UNITY_BRIDGE_SCRIPT_NAME)),
  };
}

export function discoverUnityBridgeTargets(opts?: { home?: string; projectDirs?: string[] }): UnityBridgeTarget[] {
  const byDir = new Map<string, UnityBridgeTarget>();
  for (const root of discoverUnityRoots(opts?.home)) {
    if (isUnityProjectDir(root)) byDir.set(resolve(root), targetFromProjectDir(root));
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      names = [];
    }
    for (const name of names) {
      const p = join(root, name);
      if (isUnityProjectDir(p)) byDir.set(resolve(p), targetFromProjectDir(p));
    }
  }
  for (const dirRaw of opts?.projectDirs || []) {
    const manual = normalizeUnityManualTarget(String(dirRaw || '').trim());
    if (manual.ok && manual.resolvedPath) byDir.set(manual.resolvedPath, targetFromProjectDir(manual.resolvedPath));
  }
  for (const custom of readCustomHostTargetsForHost('unity')) {
    const manual = normalizeUnityManualTarget(custom.resolvedPath);
    if (manual.ok && manual.resolvedPath) byDir.set(manual.resolvedPath, targetFromProjectDir(manual.resolvedPath));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readUnityBridgeInstallRecord(): UnityBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as UnityBridgeInstallRecord;
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

function writeUnityBridgeInstallRecord(rec: UnityBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearUnityBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildUnityBridgeScript(port: number): string {
  return `// AssetCutter Unity Bridge
#if UNITY_EDITOR
using System;
using System.Net;
using System.Text;
using System.Threading;
using UnityEditor;

[InitializeOnLoad]
public static class AssetCutterUnityBridge
{
    const int Port = ${port};
    static HttpListener listener;
    static Thread thread;

    static AssetCutterUnityBridge()
    {
        Start();
    }

    static void Start()
    {
        if (listener != null) return;
        try
        {
            listener = new HttpListener();
            listener.Prefixes.Add("http://127.0.0.1:" + Port + "/");
            listener.Start();
            thread = new Thread(Serve);
            thread.IsBackground = true;
            thread.Start();
            UnityEngine.Debug.Log("[AssetCutter Unity Bridge] ready on 127.0.0.1:" + Port);
        }
        catch (Exception e)
        {
            UnityEngine.Debug.LogWarning("[AssetCutter Unity Bridge] failed: " + e.Message);
        }
    }

    static void Serve()
    {
        while (listener != null && listener.IsListening)
        {
            try
            {
                var ctx = listener.GetContext();
                var path = ctx.Request.Url != null ? ctx.Request.Url.AbsolutePath : "/";
                var ok = path == "/health";
                var body = ok ? "{\\"ok\\":true,\\"host\\":\\"unity\\"}" : "{\\"ok\\":false,\\"error\\":\\"not_found\\"}";
                var bytes = Encoding.UTF8.GetBytes(body);
                ctx.Response.StatusCode = ok ? 200 : 404;
                ctx.Response.ContentType = "application/json; charset=utf-8";
                ctx.Response.ContentLength64 = bytes.Length;
                ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                ctx.Response.OutputStream.Close();
            }
            catch
            {
            }
        }
    }
}
#endif
`;
}

async function probeUnityBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `Unity bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return json && json.ok ? { ok: true, message: 'Unity bridge connected' } : { ok: false, message: 'Unity bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Unity bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getUnityBridgeStatus(opts?: { home?: string; projectDirs?: string[] }): Promise<UnityBridgeStatus> {
  const targets = discoverUnityBridgeTargets(opts);
  const install = readUnityBridgeInstallRecord();
  const port = install?.port || DEFAULT_UNITY_BRIDGE_PORT;
  return {
    id: 'unity',
    name: 'Unity',
    description: 'One-click project Editor script bridge using a local HTTP probe.',
    defaultPort: DEFAULT_UNITY_BRIDGE_PORT,
    port,
    roots: discoverUnityRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.projectDirs.length),
    probe: await probeUnityBridge(port),
  };
}

function resolveInstallTargets(
  body: UnityBridgeInstallBody,
  discovered: UnityBridgeTarget[],
): { targets: UnityBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: UnityBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.projectDirs || []) {
    const manual = normalizeUnityManualTarget(String(dirRaw || '').trim());
    if (!manual.ok) return { targets: [], error: manual.error || 'invalid_unity_project_dir' };
    if (manual.resolvedPath) targets.push(targetFromProjectDir(manual.resolvedPath));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.projectDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_unity_project_dir' };
  return { targets: unique };
}

export function installUnityBridge(
  body: UnityBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; projectDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverUnityBridgeTargets({ home: body.home, projectDirs: body.projectDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    const invalid = resolved.error === 'invalid_unity_project_dir';
    return {
      ok: false,
      error: resolved.error || 'no_unity_project_dir',
      message: invalid
        ? '请选择 Unity 项目根目录，需要包含 Assets 文件夹。不要选择 Unity Hub 或 Unity Editor 安装目录。'
        : 'No Unity project folder was found. Choose a Unity project root manually.',
    };
  }
  const installed: Array<{ targetId: string; projectDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    try {
      mkdirSync(target.editorDir, { recursive: true });
      writeFileSync(target.scriptPath, buildUnityBridgeScript(port), 'utf8');
      installed.push({ targetId: target.id, projectDir: target.projectDir, scriptPath: target.scriptPath });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const locked = /eperm|eacces|permission|operation not permitted/i.test(msg);
      return {
        ok: false,
        error: locked ? 'permission_denied' : 'install_failed',
        message: locked ? `无法写入 Unity 项目桥接脚本：${target.editorDir}。请确认项目目录可写。` : `Unity 桥接安装失败：${msg}`,
      };
    }
  }
  for (const dirRaw of body.projectDirs || []) {
    const manual = normalizeUnityManualTarget(String(dirRaw || '').trim());
    if (!manual.ok || !manual.resolvedPath) continue;
    const found = installed.find((item) => resolve(item.projectDir) === resolve(manual.resolvedPath as string));
    if (!found) continue;
    upsertCustomHostTarget('unity', {
      label: `Unity ${basename(manual.resolvedPath) || '项目'}（手动添加）`,
      inputPath: String(dirRaw || '').trim(),
      resolvedPath: manual.resolvedPath,
      targetKind: 'project_dir',
    });
  }
  writeUnityBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    projectDirs: installed.map((x) => x.projectDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'Unity bridge installed. Open or recompile the Unity project, then probe connection.' };
}

export function uninstallUnityBridge(
  body: { targets?: string[]; projectDirs?: string[] } = {},
): { ok: true; removed: Array<{ projectDir: string; scriptPath: string }> } {
  const hasExplicitDirs = Array.isArray(body.projectDirs) && body.projectDirs.length > 0;
  const discovered = hasExplicitDirs ? [] : discoverUnityBridgeTargets();
  const explicit = hasExplicitDirs
    ? (body.projectDirs || [])
        .map((dir) => normalizeUnityManualTarget(dir))
        .filter((item): item is ManualTargetResolveResult & { ok: true; resolvedPath: string } => Boolean(item.ok && item.resolvedPath))
        .map((item) => targetFromProjectDir(item.resolvedPath))
    : [];
  const record = readUnityBridgeInstallRecord();
  const targets = new Map<string, UnityBridgeTarget>();
  for (const v of explicit.concat(discovered)) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.projectDir, v);
  }
  for (const dir of record?.projectDirs || []) targets.set(resolve(dir), targetFromProjectDir(dir));
  const removed: Array<{ projectDir: string; scriptPath: string }> = [];
  for (const target of targets.values()) {
    if (!existsSync(target.scriptPath)) continue;
    try {
      unlinkSync(target.scriptPath);
      removed.push({ projectDir: target.projectDir, scriptPath: target.scriptPath });
    } catch {
      /* ignore */
    }
  }
  clearUnityBridgeInstallRecord();
  return { ok: true, removed };
}
