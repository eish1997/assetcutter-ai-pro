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
import { basename, join, resolve } from 'node:path';
import { getRepositoryRoot } from '../repositoryVolume.js';
import { readCustomHostTargetsForHost, upsertCustomHostTarget, type ManualTargetResolveResult } from './customHostTargets.js';
import { EXTENDSCRIPT_HEARTBEAT_TEMPLATE } from './templates/hostBridgeTemplates.js';

export type AdobeBridgeId =
  | 'photoshop'
  | 'illustrator'
  | 'after-effects'
  | 'premiere'
  | 'indesign'
  | 'audition'
  | 'media-encoder'
  | 'animate'
  | 'adobe-bridge';

type AdobeHostSpec = {
  id: AdobeBridgeId;
  name: string;
  scriptName: string;
  legacyScriptNames?: string[];
  envVar: string;
  defaultPort: number;
  roots: (home: string) => string[];
  describeTarget: (dir: string) => string;
};

const ADOBE_SPECS: Record<AdobeBridgeId, AdobeHostSpec> = {
  photoshop: {
    id: 'photoshop',
    name: 'Photoshop',
    scriptName: 'AssetCutter Photoshop Bridge.jsx',
    legacyScriptNames: ['assetcutter_photoshop_bridge.jsx'],
    envVar: 'PHOTOSHOP_SCRIPTS_DIR',
    defaultPort: 7081,
    roots: (home) => [
      ...(process.env.APPDATA ? [join(process.env.APPDATA, 'Adobe')] : []),
      join(home, 'AppData', 'Roaming', 'Adobe'),
    ],
    describeTarget: (dir) => {
      const parts = dir.split(/[\\/]+/);
      const hit = parts.find((p) => /Photoshop/i.test(p));
      return hit ? `Photoshop ${hit.replace(/^Adobe\s*/i, '')}` : 'Photoshop Scripts';
    },
  },
  illustrator: {
    id: 'illustrator',
    name: 'Illustrator',
    scriptName: 'AssetCutter Illustrator Bridge.jsx',
    legacyScriptNames: ['assetcutter_illustrator_bridge.jsx'],
    envVar: 'ILLUSTRATOR_SCRIPTS_DIR',
    defaultPort: 7161,
    roots: (home) => [
      ...(process.env.APPDATA ? [join(process.env.APPDATA, 'Adobe')] : []),
      join(home, 'AppData', 'Roaming', 'Adobe'),
    ],
    describeTarget: (dir) => {
      const parts = dir.split(/[\\/]+/);
      const hit = parts.find((p) => /Illustrator/i.test(p));
      return hit ? `Illustrator ${hit.replace(/^Adobe\s*/i, '')}` : 'Illustrator Scripts';
    },
  },
  'after-effects': {
    id: 'after-effects',
    name: 'After Effects',
    scriptName: 'assetcutter_after_effects_bridge.jsx',
    envVar: 'AFTER_EFFECTS_SCRIPTS_DIR',
    defaultPort: 7091,
    roots: (home) => [
      ...(process.env.APPDATA ? [join(process.env.APPDATA, 'Adobe', 'After Effects')] : []),
      join(home, 'AppData', 'Roaming', 'Adobe', 'After Effects'),
    ],
    describeTarget: (dir) => {
      const parts = dir.split(/[\\/]+/);
      const idx = parts.findIndex((p) => /^Scripts$/i.test(p));
      return idx >= 1 ? `After Effects ${parts[idx - 1]}` : 'After Effects Scripts';
    },
  },
  premiere: {
    id: 'premiere',
    name: 'Premiere Pro',
    scriptName: 'assetcutter_premiere_bridge.jsx',
    envVar: 'PREMIERE_SCRIPTS_DIR',
    defaultPort: 7101,
    roots: (home) => [
      ...(process.env.APPDATA ? [join(process.env.APPDATA, 'Adobe', 'Premiere Pro')] : []),
      join(home, 'Documents', 'Adobe', 'Premiere Pro'),
      join(home, 'AppData', 'Roaming', 'Adobe', 'Premiere Pro'),
    ],
    describeTarget: (dir) => {
      const parts = dir.split(/[\\/]+/);
      const version = parts.find((p) => /^\d+(\.\d+)?$/.test(p));
      return version ? `Premiere Pro ${version}` : 'Premiere Pro Scripts';
    },
  },
  indesign: {
    id: 'indesign',
    name: 'InDesign',
    scriptName: 'assetcutter_indesign_bridge.jsx',
    envVar: 'INDESIGN_SCRIPTS_DIR',
    defaultPort: 7301,
    roots: (home) => [
      ...(process.env.APPDATA ? [join(process.env.APPDATA, 'Adobe', 'InDesign')] : []),
      join(home, 'AppData', 'Roaming', 'Adobe', 'InDesign'),
    ],
    describeTarget: (dir) => {
      const parts = dir.split(/[\\/]+/);
      const idx = parts.findIndex((p) => /^InDesign$/i.test(p));
      const version = idx >= 0 ? parts[idx + 1] : undefined;
      return version ? `InDesign ${version}` : 'InDesign Scripts';
    },
  },
  audition: {
    id: 'audition',
    name: 'Audition',
    scriptName: 'assetcutter_audition_bridge.jsx',
    envVar: 'AUDITION_SCRIPTS_DIR',
    defaultPort: 7311,
    roots: (home) => [
      ...(process.env.APPDATA ? [join(process.env.APPDATA, 'Adobe', 'Audition')] : []),
      join(home, 'Documents', 'Adobe', 'Audition'),
      join(home, 'AppData', 'Roaming', 'Adobe', 'Audition'),
    ],
    describeTarget: (dir) => {
      const parts = dir.split(/[\\/]+/);
      const version = parts.find((p) => /^\d+(\.\d+)?$/.test(p));
      return version ? `Audition ${version}` : 'Audition Scripts';
    },
  },
  'media-encoder': {
    id: 'media-encoder',
    name: 'Media Encoder',
    scriptName: 'assetcutter_media_encoder_bridge.jsx',
    envVar: 'MEDIA_ENCODER_SCRIPTS_DIR',
    defaultPort: 7321,
    roots: (home) => [
      ...(process.env.APPDATA ? [join(process.env.APPDATA, 'Adobe', 'Adobe Media Encoder')] : []),
      join(home, 'Documents', 'Adobe', 'Adobe Media Encoder'),
      join(home, 'AppData', 'Roaming', 'Adobe', 'Adobe Media Encoder'),
    ],
    describeTarget: (dir) => {
      const parts = dir.split(/[\\/]+/);
      const version = parts.find((p) => /^\d+(\.\d+)?$/.test(p));
      return version ? `Media Encoder ${version}` : 'Media Encoder Scripts';
    },
  },
  animate: {
    id: 'animate',
    name: 'Animate',
    scriptName: 'assetcutter_animate_bridge.jsx',
    envVar: 'ANIMATE_SCRIPTS_DIR',
    defaultPort: 7331,
    roots: (home) => [
      ...(process.env.APPDATA ? [join(process.env.APPDATA, 'Adobe', 'Animate')] : []),
      join(home, 'AppData', 'Roaming', 'Adobe', 'Animate'),
    ],
    describeTarget: (dir) => {
      const parts = dir.split(/[\\/]+/);
      const version = parts.find((p) => /^\d+(\.\d+)?$/.test(p));
      return version ? `Animate ${version}` : 'Animate Scripts';
    },
  },
  'adobe-bridge': {
    id: 'adobe-bridge',
    name: 'Adobe Bridge',
    scriptName: 'assetcutter_adobe_bridge_bridge.jsx',
    envVar: 'ADOBE_BRIDGE_SCRIPTS_DIR',
    defaultPort: 7601,
    roots: (home) => [
      ...(process.env.APPDATA ? [join(process.env.APPDATA, 'Adobe', 'Bridge')] : []),
      join(home, 'AppData', 'Roaming', 'Adobe', 'Bridge'),
    ],
    describeTarget: (dir) => {
      const parts = dir.split(/[\\/]+/);
      const version = parts.find((p) => /^\d+(\.\d+)?$/.test(p));
      return version ? `Adobe Bridge ${version}` : 'Adobe Bridge Startup Scripts';
    },
  },
};

export type AdobeBridgeTarget = {
  id: string;
  label: string;
  scriptsDir: string;
  scriptPath: string;
  hasScriptBridge: boolean;
};

export type AdobeBridgeInstallRecord = {
  port: number;
  installedAt: string;
  scriptsDirs: string[];
  targetIds: string[];
};

export type AdobeBridgeStatus = {
  id: AdobeBridgeId;
  name: string;
  description: string;
  defaultPort: number;
  port: number;
  roots: string[];
  targets: AdobeBridgeTarget[];
  install: AdobeBridgeInstallRecord | null;
  installed: boolean;
  probe: { ok: boolean; message: string; heartbeatPath: string };
};

export type AdobeBridgeInstallBody = {
  targets?: string[];
  scriptsDirs?: string[];
  port?: number;
  home?: string;
};

function specFor(id: AdobeBridgeId): AdobeHostSpec {
  return ADOBE_SPECS[id];
}

function bridgesStateDir(): string {
  const sb = process.env.COMPANION_SANDBOX_ROOT?.trim();
  if (sb) return resolve(join(sb, 'bridges'));
  return resolve(join(getRepositoryRoot(), '..', 'bridges'));
}

function installRecordPath(id: AdobeBridgeId): string {
  return join(bridgesStateDir(), `${id}-install.json`);
}

function heartbeatPath(id: AdobeBridgeId): string {
  const base =
    process.env.APPDATA ||
    process.env.LOCALAPPDATA ||
    process.env.TMP ||
    process.env.TEMP ||
    bridgesStateDir();
  return resolve(join(base, 'AssetCutterCompanion', 'bridges', `${id}-heartbeat.json`));
}

function normalizePort(id: AdobeBridgeId, raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : specFor(id).defaultPort;
}

function rootExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverAdobeBridgeRoots(id: AdobeBridgeId, home = homedir()): string[] {
  const spec = specFor(id);
  const roots: string[] = [];
  const fromEnv = process.env[spec.envVar]?.trim();
  if (fromEnv) roots.push(resolve(fromEnv));
  for (const root of spec.roots(home)) roots.push(resolve(root));
  return roots.filter((root, idx, arr) => rootExists(root) && arr.indexOf(root) === idx);
}

function targetFromScriptsDir(id: AdobeBridgeId, scriptsDir: string): AdobeBridgeTarget {
  const spec = specFor(id);
  const resolvedDir = resolve(scriptsDir);
  const labelBase = spec.describeTarget(resolvedDir) || basename(resolvedDir);
  const bridgeNames = [spec.scriptName, ...(spec.legacyScriptNames || [])];
  return {
    id: `${id}::${resolvedDir}`,
    label: labelBase,
    scriptsDir: resolvedDir,
    scriptPath: join(resolvedDir, spec.scriptName),
    hasScriptBridge: bridgeNames.some((name) => existsSync(join(resolvedDir, name))),
  };
}

function looksLikeScriptDir(path: string): boolean {
  return /(^|[\\/])(Scripts|Startup Scripts|Scripts Panel)([\\/]?$)/i.test(path);
}

function normalizeAdobeManualTarget(
  id: AdobeBridgeId,
  input: string,
  home = homedir(),
): ManualTargetResolveResult & { ok: true; resolvedPath: string } {
  const selected = resolve(String(input || '').trim());
  const normalized = selected.replace(/\\/g, '/');
  if (looksLikeScriptDir(normalized)) return { ok: true, inputPath: selected, resolvedPath: selected, targetKind: 'script_dir' };

  const name = basename(selected);
  const versionMatch = name.match(/(?:Adobe\s*)?(?:Photoshop|Illustrator|After Effects|Premiere Pro|Audition|Media Encoder|Animate|Bridge)\s*(\d+(?:\.\d+)?)/i);
  const versionHint = versionMatch?.[1];
  const appDataAdobe = join(home, 'AppData', 'Roaming', 'Adobe');
  const documentsAdobe = join(home, 'Documents', 'Adobe');

  const selectedLooksLikeAdobeRoot = /(^|[\\/])Adobe([\\/]?$)/i.test(normalized);
  if (selectedLooksLikeAdobeRoot && (id === 'photoshop' || id === 'illustrator')) {
    const found = findAdobeAppPresetScriptsDir(id, selected);
    if (found) {
      return {
        ok: true,
        inputPath: selected,
        resolvedPath: found.scriptsDir,
        targetKind: 'install_dir',
        versionHint: found.versionHint,
      };
    }
  }

  if (versionHint) {
    if (id === 'photoshop') {
      return {
        ok: true,
        inputPath: selected,
        resolvedPath: resolve(join(appDataAdobe, `Adobe Photoshop ${versionHint}`, 'Presets', 'Scripts')),
        targetKind: 'install_dir',
        versionHint,
      };
    }
    if (id === 'illustrator') {
      return {
        ok: true,
        inputPath: selected,
        resolvedPath: resolve(join(appDataAdobe, `Adobe Illustrator ${versionHint}`, 'Presets', 'Scripts')),
        targetKind: 'install_dir',
        versionHint,
      };
    }
    if (id === 'after-effects') {
      return {
        ok: true,
        inputPath: selected,
        resolvedPath: resolve(join(appDataAdobe, 'After Effects', versionHint, 'Scripts', 'Startup')),
        targetKind: 'install_dir',
        versionHint,
      };
    }
    if (id === 'premiere') {
      return {
        ok: true,
        inputPath: selected,
        resolvedPath: resolve(join(documentsAdobe, 'Premiere Pro', versionHint, 'Scripts')),
        targetKind: 'install_dir',
        versionHint,
      };
    }
    if (id === 'audition') {
      return {
        ok: true,
        inputPath: selected,
        resolvedPath: resolve(join(documentsAdobe, 'Audition', versionHint, 'Scripts')),
        targetKind: 'install_dir',
        versionHint,
      };
    }
    if (id === 'media-encoder') {
      return {
        ok: true,
        inputPath: selected,
        resolvedPath: resolve(join(documentsAdobe, 'Adobe Media Encoder', versionHint, 'Scripts')),
        targetKind: 'install_dir',
        versionHint,
      };
    }
    if (id === 'animate') {
      return {
        ok: true,
        inputPath: selected,
        resolvedPath: resolve(join(appDataAdobe, 'Animate', versionHint, 'Scripts')),
        targetKind: 'install_dir',
        versionHint,
      };
    }
    if (id === 'adobe-bridge') {
      return {
        ok: true,
        inputPath: selected,
        resolvedPath: resolve(join(appDataAdobe, 'Bridge', versionHint, 'Startup Scripts')),
        targetKind: 'install_dir',
        versionHint,
      };
    }
  }

  return { ok: true, inputPath: selected, resolvedPath: selected, targetKind: 'unknown' };
}

function addIfDir(map: Map<string, AdobeBridgeTarget>, id: AdobeBridgeId, dir: string): void {
  if (rootExists(dir)) map.set(resolve(dir), targetFromScriptsDir(id, dir));
}

function addCandidateDir(map: Map<string, AdobeBridgeTarget>, id: AdobeBridgeId, dir: string): void {
  map.set(resolve(dir), targetFromScriptsDir(id, dir));
}

function parseAdobeVersionHint(name: string): string {
  const match = String(name || '').match(/(\d+(?:\.\d+)?)/);
  return match?.[1] || '';
}

function findAdobeAppPresetScriptsDir(
  id: Extract<AdobeBridgeId, 'photoshop' | 'illustrator'>,
  root: string,
): { scriptsDir: string; versionHint?: string } | null {
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {
    return null;
  }
  const appPattern = id === 'photoshop' ? /Adobe\s+Photoshop\s+\d/i : /Adobe\s+Illustrator\s+\d/i;
  const candidates = names
    .filter((name) => appPattern.test(name) && rootExists(join(root, name)))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
  const picked = candidates[0];
  if (!picked) return null;
  return {
    scriptsDir: resolve(join(root, picked, 'Presets', 'Scripts')),
    versionHint: parseAdobeVersionHint(picked),
  };
}

function discoverNestedScriptDirs(root: string, maxDepth = 5): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      if (!rootExists(full)) continue;
      if (/^Scripts$/i.test(name) || /^Scripts Panel$/i.test(name)) out.push(full);
      walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

export function discoverAdobeBridgeTargets(
  id: AdobeBridgeId,
  opts?: { home?: string; scriptsDirs?: string[] },
): AdobeBridgeTarget[] {
  const byDir = new Map<string, AdobeBridgeTarget>();
  for (const root of discoverAdobeBridgeRoots(id, opts?.home)) {
    if (id === 'photoshop' || id === 'illustrator') {
      let names: string[] = [];
      try {
        names = readdirSync(root);
      } catch {
        names = [];
      }
      for (const name of names) {
        const full = join(root, name);
        const isVersionDir =
          rootExists(full) &&
          ((id === 'photoshop' && /^Adobe\s+Photoshop\s+\d/i.test(name)) ||
            (id === 'illustrator' && /^Adobe\s+Illustrator\s+\d/i.test(name)));
        if (isVersionDir) {
          addCandidateDir(byDir, id, join(root, name, 'Presets', 'Scripts'));
          addIfDir(byDir, id, join(root, name, 'Startup Scripts'));
        }
      }
    } else if (id === 'after-effects') {
      let names: string[] = [];
      try {
        names = readdirSync(root);
      } catch {
        names = [];
      }
      for (const name of names) {
        if (/^\d+(\.\d+)?$/.test(name)) {
          addIfDir(byDir, id, join(root, name, 'Scripts'));
          addIfDir(byDir, id, join(root, name, 'Scripts', 'Startup'));
        }
      }
      addIfDir(byDir, id, root);
    } else {
      let names: string[] = [];
      try {
        names = readdirSync(root);
      } catch {
        names = [];
      }
      for (const name of names) {
        if (/^\d+(\.\d+)?$/.test(name)) {
          addIfDir(byDir, id, join(root, name, 'Scripts'));
          addIfDir(byDir, id, join(root, name, 'Scripts', 'Startup'));
        }
      }
      addIfDir(byDir, id, root);
      for (const dir of discoverNestedScriptDirs(root)) addIfDir(byDir, id, dir);
    }
  }
  for (const dirRaw of opts?.scriptsDirs || []) {
    const dir = normalizeAdobeManualTarget(id, String(dirRaw || '').trim(), opts?.home).resolvedPath;
    if (dir) byDir.set(dir, targetFromScriptsDir(id, dir));
  }
  for (const custom of readCustomHostTargetsForHost(id)) {
    const dir = normalizeAdobeManualTarget(id, custom.resolvedPath, opts?.home).resolvedPath;
    if (dir) byDir.set(dir, targetFromScriptsDir(id, dir));
  }
  return Array.from(byDir.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function readAdobeBridgeInstallRecord(id: AdobeBridgeId): AdobeBridgeInstallRecord | null {
  const p = installRecordPath(id);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as AdobeBridgeInstallRecord;
    return {
      port: normalizePort(id, raw.port),
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
      scriptsDirs: Array.isArray(raw.scriptsDirs) ? raw.scriptsDirs.map(String) : [],
      targetIds: Array.isArray(raw.targetIds) ? raw.targetIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function writeAdobeBridgeInstallRecord(id: AdobeBridgeId, rec: AdobeBridgeInstallRecord): void {
  const dir = bridgesStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = installRecordPath(id);
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
  renameSync(tmp, p);
}

function clearAdobeBridgeInstallRecord(id: AdobeBridgeId): void {
  const p = installRecordPath(id);
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function buildAdobeHeartbeatScript(id: AdobeBridgeId, port: number): string {
  const spec = specFor(id);
  return EXTENDSCRIPT_HEARTBEAT_TEMPLATE.generateInstallFiles({
    hostId: id,
    hostName: spec.name,
    port,
    entryFile: spec.scriptName,
    heartbeatFile: heartbeatPath(id),
  })[0]!.contents;
}

async function probeAdobeBridge(id: AdobeBridgeId): Promise<{ ok: boolean; message: string; heartbeatPath: string }> {
  const p = heartbeatPath(id);
  if (!existsSync(p)) return { ok: false, message: `${specFor(id).name} 尚未产生桥接心跳。请重启软件，并在菜单中运行 AssetCutter Bridge 脚本后再探测。`, heartbeatPath: p };
  try {
    const stat = statSync(p);
    const ageMs = Date.now() - stat.mtimeMs;
    const json = JSON.parse(readFileSync(p, 'utf8')) as { host?: string; at?: string };
    if (json.host !== id) return { ok: false, message: `${specFor(id).name} 桥接心跳不属于当前宿主。`, heartbeatPath: p };
    const mins = Math.max(0, Math.round(ageMs / 60000));
    return { ok: true, message: `${specFor(id).name} 桥接心跳已连接，${mins} 分钟前更新。`, heartbeatPath: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `${specFor(id).name} 桥接心跳读取失败：${msg}`, heartbeatPath: p };
  }
}

export async function getAdobeBridgeStatus(
  id: AdobeBridgeId,
  opts?: { home?: string; scriptsDirs?: string[] },
): Promise<AdobeBridgeStatus> {
  const spec = specFor(id);
  const targets = discoverAdobeBridgeTargets(id, opts);
  const install = readAdobeBridgeInstallRecord(id);
  const port = install?.port || spec.defaultPort;
  return {
    id,
    name: spec.name,
    description: 'One-click ExtendScript bridge using a local heartbeat probe.',
    defaultPort: spec.defaultPort,
    port,
    roots: discoverAdobeBridgeRoots(id, opts?.home),
    targets,
    install,
    installed: targets.some((v) => v.hasScriptBridge) || Boolean(install?.scriptsDirs.length),
    probe: await probeAdobeBridge(id),
  };
}

function resolveInstallTargets(
  id: AdobeBridgeId,
  body: AdobeBridgeInstallBody,
  discovered: AdobeBridgeTarget[],
): { targets: AdobeBridgeTarget[]; error?: string } {
  const byId = new Map(discovered.map((v) => [v.id, v]));
  const targets: AdobeBridgeTarget[] = [];
  for (const targetId of body.targets || []) {
    const v = byId.get(String(targetId));
    if (v) targets.push(v);
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const scriptsDir = normalizeAdobeManualTarget(id, String(dirRaw || '').trim(), body.home).resolvedPath;
    if (scriptsDir) targets.push(targetFromScriptsDir(id, scriptsDir));
  }
  const unique = Array.from(new Map(targets.map((v) => [v.scriptsDir, v])).values());
  if (!unique.length) return { targets: [], error: `no_${id}_scripts_dir` };
  return { targets: unique };
}

export function installAdobeBridge(
  id: AdobeBridgeId,
  body: AdobeBridgeInstallBody = {},
):
  | { ok: true; port: number; installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }>; message: string }
  | { ok: false; error: string; message: string } {
  const spec = specFor(id);
  const port = normalizePort(id, body.port);
  const discovered = discoverAdobeBridgeTargets(id, { home: body.home, scriptsDirs: body.scriptsDirs });
  const resolved = resolveInstallTargets(id, body, discovered);
  if (resolved.error || !resolved.targets.length) {
    return {
      ok: false,
      error: resolved.error || `no_${id}_scripts_dir`,
      message: `No ${spec.name} scripts folder was found. Choose a scripts folder manually.`,
    };
  }
  const installed: Array<{ targetId: string; scriptsDir: string; scriptPath: string }> = [];
  for (const target of resolved.targets) {
    try {
      mkdirSync(target.scriptsDir, { recursive: true });
      writeFileSync(target.scriptPath, buildAdobeHeartbeatScript(id, port), 'utf8');
      for (const legacyName of spec.legacyScriptNames || []) {
        const legacyPath = join(target.scriptsDir, legacyName);
        if (legacyPath !== target.scriptPath && existsSync(legacyPath)) {
          try {
            unlinkSync(legacyPath);
          } catch {
            /* ignore stale legacy file */
          }
        }
      }
      installed.push({ targetId: target.id, scriptsDir: target.scriptsDir, scriptPath: target.scriptPath });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const locked = /eperm|eacces|permission|operation not permitted/i.test(msg);
      return {
        ok: false,
        error: locked ? 'permission_denied' : 'install_failed',
        message: locked
          ? `无法写入 ${spec.name} 桥接脚本：${target.scriptsDir}。请选择 ${spec.name} 用户脚本目录，或选择软件安装目录让系统自动定位到用户目录。`
          : `${spec.name} 桥接安装失败：${msg}`,
      };
    }
  }
  for (const dirRaw of body.scriptsDirs || []) {
    const manual = normalizeAdobeManualTarget(id, String(dirRaw || '').trim(), body.home);
    const found = installed.find((item) => resolve(item.scriptsDir) === resolve(manual.resolvedPath));
    if (!found) continue;
    upsertCustomHostTarget(id, {
      label: `${spec.name}${manual.versionHint ? ` ${manual.versionHint}` : ''}（手动添加）`,
      inputPath: String(dirRaw || '').trim(),
      resolvedPath: manual.resolvedPath,
      targetKind: manual.targetKind || 'unknown',
      versionHint: manual.versionHint,
    });
  }
  writeAdobeBridgeInstallRecord(id, {
    port,
    installedAt: new Date().toISOString(),
    scriptsDirs: installed.map((x) => x.scriptsDir),
    targetIds: installed.map((x) => x.targetId),
  });
  const runHint =
    id === 'photoshop'
      ? '安装完成。请重启 Photoshop，然后在「文件 > 脚本 > AssetCutter Photoshop Bridge」运行一次，再回到工作台探测连接。'
      : id === 'illustrator'
        ? '安装完成。请重启 Illustrator，然后在「文件 > 脚本 > AssetCutter Illustrator Bridge」运行一次，再回到工作台探测连接。'
        : `${spec.name} 桥接已安装。请重启软件或运行已安装脚本后，再探测连接。`;
  return { ok: true, port, installed, message: runHint };
}

export function uninstallAdobeBridge(
  id: AdobeBridgeId,
  body: { targets?: string[]; scriptsDirs?: string[] } = {},
): { ok: true; removed: Array<{ scriptsDir: string; scriptPath: string }> } {
  const hasExplicitDirs = Array.isArray(body.scriptsDirs) && body.scriptsDirs.length > 0;
  const discovered = hasExplicitDirs ? [] : discoverAdobeBridgeTargets(id);
  const explicit = hasExplicitDirs
    ? (body.scriptsDirs || []).map((dir) => targetFromScriptsDir(id, normalizeAdobeManualTarget(id, dir).resolvedPath))
    : [];
  const record = readAdobeBridgeInstallRecord(id);
  const targets = new Map<string, AdobeBridgeTarget>();
  for (const v of explicit.concat(discovered)) {
    if (!body.targets || body.targets.length === 0 || body.targets.includes(v.id)) targets.set(v.scriptsDir, v);
  }
  for (const dir of record?.scriptsDirs || []) targets.set(resolve(dir), targetFromScriptsDir(id, dir));
  const removed: Array<{ scriptsDir: string; scriptPath: string }> = [];
  for (const target of targets.values()) {
    const spec = specFor(id);
    for (const scriptName of [spec.scriptName, ...(spec.legacyScriptNames || [])]) {
      const scriptPath = join(target.scriptsDir, scriptName);
      if (!existsSync(scriptPath)) continue;
      try {
        unlinkSync(scriptPath);
        removed.push({ scriptsDir: target.scriptsDir, scriptPath });
      } catch {
        /* ignore */
      }
    }
  }
  clearAdobeBridgeInstallRecord(id);
  return { ok: true, removed };
}
