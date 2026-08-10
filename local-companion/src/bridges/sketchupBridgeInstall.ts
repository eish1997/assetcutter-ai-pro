import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';

export const DEFAULT_SKETCHUP_BRIDGE_PORT = 7151;
export const SKETCHUP_BRIDGE_PLUGIN_NAME = 'assetcutter_sketchup_bridge.rb';

export type SketchUpBridgeTarget = {
  id: string;
  label: string;
  pluginDir: string;
  pluginPath: string;
  hasPluginBridge: boolean;
};

export type SketchUpBridgeInstallRecord = {
  port: number;
  installedAt: string;
  pluginDirs: string[];
  targetIds: string[];
};

export type SketchUpBridgeStatus = {
  id: 'sketchup';
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: SketchUpBridgeTarget[];
  install: SketchUpBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string };
};

export type SketchUpBridgeInstallBody = {
  targets?: string[];
  pluginDirs?: string[];
  port?: number;
  home?: string;
};

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function installRecordPath(): string {
  return join(bridgesStateDir(), 'sketchup-install.json');
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : DEFAULT_SKETCHUP_BRIDGE_PORT;
}

export function discoverSketchUpRoots(home = homedir()): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.SKETCHUP_PLUGINS_DIR?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  if (process.env.APPDATA) roots.push(resolve(join(process.env.APPDATA, 'SketchUp')));
  roots.push(resolve(join(home, 'AppData', 'Roaming', 'SketchUp')));
  roots.push(resolve(join(home, 'Library', 'Application Support', 'SketchUp')));
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

function targetFromPluginDir(pluginDir: string): SketchUpBridgeTarget {
  const resolvedDir = resolve(pluginDir);
  const parent = basename(resolve(join(resolvedDir, '..', '..')));
  return {
    id: `${parent || 'sketchup'}::${resolvedDir}`,
    label: parent ? `SketchUp ${parent}` : `SketchUp (${resolvedDir})`,
    pluginDir: resolvedDir,
    pluginPath: join(resolvedDir, SKETCHUP_BRIDGE_PLUGIN_NAME),
    hasPluginBridge: existsSync(join(resolvedDir, SKETCHUP_BRIDGE_PLUGIN_NAME)),
  };
}

export function discoverSketchUpBridgeTargets(opts?: { home?: string; pluginDirs?: string[] }): SketchUpBridgeTarget[] {
  const byDir = new Map<string, SketchUpBridgeTarget>();
  for (const root of discoverSketchUpRoots(opts?.home)) {
    const direct = basename(root).toLowerCase() === 'plugins' ? root : '';
    if (direct) byDir.set(resolve(direct), targetFromPluginDir(direct));
    let entries: string[] = [];
    try {
      entries = readdirSync(root);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      if (!/^SketchUp\s+\d{4}$/i.test(name)) continue;
      const pluginDir = join(root, name, 'SketchUp', 'Plugins');
      byDir.set(resolve(pluginDir), targetFromPluginDir(pluginDir));
    }
  }
  for (const dirRaw of opts?.pluginDirs || []) {
    const dir = resolve(String(dirRaw || '').trim());
    if (dir) byDir.set(dir, targetFromPluginDir(dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readSketchUpBridgeInstallRecord(): SketchUpBridgeInstallRecord | null {
  const p = installRecordPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as SketchUpBridgeInstallRecord;
    return {
      port: normalizePort(raw.port),
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      pluginDirs: Array.isArray(raw.pluginDirs) ? raw.pluginDirs.map(String) : [],
      targetIds: Array.isArray(raw.targetIds) ? raw.targetIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function writeSketchUpBridgeInstallRecord(rec: SketchUpBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearSketchUpBridgeInstallRecord(): void {
  const p = installRecordPath();
  if (!existsSync(p)) return;
  try {
    rmSync(p, { force: true });
  } catch {
    /* ignore */
  }
}

function buildSketchUpBridgePlugin(port: number): string {
  return `# AssetCutter SketchUp Bridge
require 'json'
require 'webrick'

module AssetCutterSketchUpBridge
  PORT = ${port}

  def self.start
    return if defined?(@server) && @server
    Thread.new do
      begin
        @server = WEBrick::HTTPServer.new(
          :BindAddress => '127.0.0.1',
          :Port => PORT,
          :AccessLog => [],
          :Logger => WEBrick::Log.new(File::NULL, WEBrick::Log::FATAL)
        )
        @server.mount_proc('/health') do |_req, res|
          version = ''
          begin
            version = Sketchup.version.to_s
          rescue
          end
          res.status = 200
          res['Content-Type'] = 'application/json; charset=utf-8'
          res.body = { :ok => true, :host => 'sketchup', :version => version }.to_json
        end
        @server.start
      rescue => e
        puts "[AssetCutter SketchUp Bridge] failed: #{e}"
      end
    end
    puts "[AssetCutter SketchUp Bridge] ready on 127.0.0.1:#{PORT}"
  end
end

AssetCutterSketchUpBridge.start
`;
}

async function probeSketchUpBridge(port: number, timeoutMs = 1800): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `SketchUp bridge returned HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean; version?: string } | null;
    return json && json.ok
      ? { ok: true, message: `SketchUp bridge connected${json.version ? ` (${json.version})` : ''}` }
      : { ok: false, message: 'SketchUp bridge response is invalid' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `SketchUp bridge is not reachable on 127.0.0.1:${port}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getSketchUpBridgeStatus(opts?: { home?: string; pluginDirs?: string[] }): Promise<SketchUpBridgeStatus> {
  const targets = discoverSketchUpBridgeTargets(opts);
  const install = readSketchUpBridgeInstallRecord();
  const port = install?.port || DEFAULT_SKETCHUP_BRIDGE_PORT;
  return {
    id: 'sketchup',
    name: 'SketchUp',
    description: 'One-click Ruby plugin bridge using a local HTTP probe.',
    defaultPort: DEFAULT_SKETCHUP_BRIDGE_PORT,
    port,
    roots: discoverSketchUpRoots(opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasPluginBridge) || Boolean(install?.pluginDirs.length),
    probe: await probeSketchUpBridge(port),
  };
}

function resolveInstallTargets(
  body: SketchUpBridgeInstallBody,
  discovered: SketchUpBridgeTarget[],
): { targets: SketchUpBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: SketchUpBridgeTarget[] = [];
  for (const id of body.targets || []) {
    const v = byId.get(String(id));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.pluginDirs || []) {
    const pluginDir = resolve(String(dirRaw || '').trim());
    if (pluginDir) targets.push(targetFromPluginDir(pluginDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.pluginDir, v])).values());
  if (!unique.length) return { targets: [], error: 'no_sketchup_plugin_dir' };
  return { targets: unique };
}

export function installSketchUpBridge(
  body: SketchUpBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; pluginDir: string; pluginPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const port = normalizePort(body.port);
  const discovered = discoverSketchUpBridgeTargets({ home: body.home, pluginDirs: body.pluginDirs });
  const resolved = resolveInstallTargets(body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || 'no_sketchup_plugin_dir',
      message: 'No SketchUp Plugins folder was found. Choose a SketchUp Plugins folder manually.',
    };
  }
  const installed: Array<{ targetId: string; pluginDir: string; pluginPath: string }> = [];
  for (const target of resolved.targets) {
    mkdirSync(target.pluginDir, { recursive: true });
    writeFileSync(target.pluginPath, buildSketchUpBridgePlugin(port), 'utf8');
    installed.push({ targetId: target.id, pluginDir: target.pluginDir, pluginPath: target.pluginPath });
  }
  writeSketchUpBridgeInstallRecord({
    port,
    installedAt: new Date().toISOString(),
    pluginDirs: installed.map((x) => x.pluginDir),
    targetIds: installed.map((x) => x.targetId),
  });
  return { ok: true, port, installed, message: 'SketchUp bridge installed. Restart SketchUp, then probe connection.' };
}

export function uninstallSketchUpBridge(
  body: { targets?: string[]; pluginDirs?: string[] } = {},
): { ok: true; removed: Array<{ pluginDir: string; pluginPath: string }> } {
  const discovered = discoverSketchUpBridgeTargets({ pluginDirs: body.pluginDirs });
  const record = readSketchUpBridgeInstallRecord();
  const targets = new Map<string, SketchUpBridgeTarget>();
  for (const v of discovered) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.pluginDir, v);
  }
  for (const dir of record?.pluginDirs || []) targets.set(resolve(dir), targetFromPluginDir(dir));
  const removed: Array<{ pluginDir: string; pluginPath: string }> = [];
  for (const target of targets.values()) {
    if (!existsSync(target.pluginPath)) continue;
    try {
      rmSync(target.pluginPath, { force: true });
      removed.push({ pluginDir: target.pluginDir, pluginPath: target.pluginPath });
    } catch {
      /* ignore */
    }
  }
  clearSketchUpBridgeInstallRecord();
  return { ok: true, removed };
}
