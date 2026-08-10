import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { readCustomHostTargetsForHost, upsertCustomHostTarget } from './customHostTargets.js';
import { HOST_BRIDGE_DEFINITIONS } from './definitions/hostBridgeDefinitions.js';

type HostProcessSpec = {
  names: string[];
  exeNames: string[];
  searchDirs?: string[];
};

type ProcessRow = {
  Name?: string;
  ExecutablePath?: string;
  name?: string;
  executablePath?: string;
};

export type HostAppProcessResult = {
  ok: boolean;
  hostId: string;
  message: string;
  executablePath?: string;
  processNames?: string[];
  pid?: number;
  error?: string;
};

export type HostRunningTargetResult = HostAppProcessResult & {
  installUsable?: boolean;
  nextStep?: string;
  target?: {
    id: string;
    label: string;
    inputPath: string;
    resolvedPath: string;
    targetKind: string;
    versionHint?: string;
  };
};

export type HostAppLaunchOptions = {
  executablePath?: string;
  versionId?: string;
  targetId?: string;
};

const PROGRAM_FILES = [
  process.env.ProgramFiles,
  process.env['ProgramFiles(x86)'],
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs') : '',
].filter(Boolean) as string[];

const HOST_PROCESS_SPECS: Record<string, HostProcessSpec> = {
  maya: { names: ['Maya'], exeNames: ['maya.exe'], searchDirs: ['Autodesk/Maya*', 'Autodesk'] },
  blender: { names: ['Blender'], exeNames: ['blender.exe'], searchDirs: ['Blender Foundation/Blender*'] },
  '3ds-max': { names: ['3ds Max'], exeNames: ['3dsmax.exe'], searchDirs: ['Autodesk/3ds Max*', 'Autodesk'] },
  'substance-painter': {
    names: ['Substance Painter'],
    exeNames: ['Adobe Substance 3D Painter.exe', 'Substance 3D Painter.exe', 'Substance Painter.exe'],
    searchDirs: ['Adobe/Adobe Substance 3D Painter*', 'Allegorithmic/Substance Painter*'],
  },
  'substance-designer': {
    names: ['Substance Designer'],
    exeNames: ['Adobe Substance 3D Designer.exe', 'Substance 3D Designer.exe', 'Substance Designer.exe'],
    searchDirs: ['Adobe/Adobe Substance 3D Designer*', 'Allegorithmic/Substance Designer*'],
  },
  photoshop: { names: ['Photoshop'], exeNames: ['Photoshop.exe'], searchDirs: ['Adobe/Adobe Photoshop*'] },
  illustrator: { names: ['Illustrator'], exeNames: ['Illustrator.exe'], searchDirs: ['Adobe/Adobe Illustrator*'] },
  'after-effects': { names: ['After Effects'], exeNames: ['AfterFX.exe'], searchDirs: ['Adobe/Adobe After Effects*'] },
  premiere: { names: ['Premiere Pro'], exeNames: ['Adobe Premiere Pro.exe'], searchDirs: ['Adobe/Adobe Premiere Pro*'] },
  indesign: { names: ['InDesign'], exeNames: ['InDesign.exe'], searchDirs: ['Adobe/Adobe InDesign*'] },
  audition: { names: ['Audition'], exeNames: ['Adobe Audition.exe'], searchDirs: ['Adobe/Adobe Audition*'] },
  'media-encoder': { names: ['Media Encoder'], exeNames: ['Adobe Media Encoder.exe'], searchDirs: ['Adobe/Adobe Media Encoder*'] },
  animate: { names: ['Animate'], exeNames: ['Animate.exe'], searchDirs: ['Adobe/Adobe Animate*'] },
  'adobe-bridge': { names: ['Adobe Bridge'], exeNames: ['Bridge.exe'], searchDirs: ['Adobe/Adobe Bridge*'] },
  'lightroom-classic': { names: ['Lightroom Classic'], exeNames: ['Lightroom.exe'], searchDirs: ['Adobe/Adobe Lightroom Classic*', 'Adobe/Lightroom Classic*'] },
  darktable: { names: ['darktable'], exeNames: ['darktable.exe'], searchDirs: ['darktable*'] },
  houdini: { names: ['Houdini'], exeNames: ['houdini.exe'], searchDirs: ['Side Effects Software/Houdini*'] },
  nuke: { names: ['Nuke'], exeNames: ['Nuke*.exe'], searchDirs: ['Nuke*'] },
  'nuke-studio': { names: ['Nuke Studio'], exeNames: ['Nuke*.exe'], searchDirs: ['Nuke*'] },
  hiero: { names: ['Hiero'], exeNames: ['Nuke*.exe', 'Hiero*.exe'], searchDirs: ['Nuke*', 'Hiero*'] },
  mari: { names: ['Mari'], exeNames: ['Mari*.exe'], searchDirs: ['Mari*', 'Foundry/Mari*'] },
  natron: { names: ['Natron'], exeNames: ['Natron.exe'], searchDirs: ['Natron*'] },
  katana: { names: ['Katana'], exeNames: ['katana*.exe', 'Katana*.exe'], searchDirs: ['Katana*', 'Foundry/Katana*'] },
  'cinema-4d': { names: ['Cinema 4D'], exeNames: ['Cinema 4D.exe'], searchDirs: ['Maxon Cinema 4D*', 'Maxon/*'] },
  'davinci-resolve': { names: ['DaVinci Resolve'], exeNames: ['Resolve.exe'], searchDirs: ['Blackmagic Design/DaVinci Resolve'] },
  'fusion-studio': { names: ['Fusion Studio'], exeNames: ['Fusion.exe'], searchDirs: ['Blackmagic Design/Fusion*'] },
  unity: { names: ['Unity'], exeNames: ['Unity.exe'], searchDirs: ['Unity/Hub/Editor/*/Editor'] },
  godot: { names: ['Godot'], exeNames: ['Godot*.exe'], searchDirs: ['Godot'] },
  unreal: { names: ['Unreal Editor'], exeNames: ['UnrealEditor.exe', 'UE4Editor.exe'], searchDirs: ['Epic Games/UE_*'] },
  zbrush: { names: ['ZBrush'], exeNames: ['ZBrush.exe'], searchDirs: ['Maxon ZBrush*', 'Pixologic/ZBrush*'] },
  rhino: { names: ['Rhino'], exeNames: ['Rhino.exe'], searchDirs: ['Rhino*'] },
  sketchup: { names: ['SketchUp'], exeNames: ['SketchUp.exe'], searchDirs: ['SketchUp/SketchUp*'] },
  'marvelous-designer': { names: ['Marvelous Designer'], exeNames: ['MarvelousDesigner*.exe', 'Marvelous Designer*.exe'], searchDirs: ['Marvelous Designer*', 'CLO Virtual Fashion/Marvelous Designer*'] },
  clo: { names: ['CLO'], exeNames: ['CLO*.exe'], searchDirs: ['CLO*', 'CLO Virtual Fashion/CLO*'] },
  rizomuv: { names: ['RizomUV'], exeNames: ['RizomUV*.exe'], searchDirs: ['RizomUV*'] },
  'daz-studio': { names: ['Daz Studio'], exeNames: ['DAZStudio.exe', 'DAZStudio*.exe'], searchDirs: ['DAZ 3D/DAZStudio*', 'DAZ 3D/DAZStudio4'] },
  poser: { names: ['Poser'], exeNames: ['Poser.exe', 'Poser*.exe'], searchDirs: ['Poser*'] },
  iclone: { names: ['iClone'], exeNames: ['iClone.exe', 'iClone*.exe'], searchDirs: ['Reallusion/iClone*'] },
  'character-creator': { names: ['Character Creator'], exeNames: ['CharacterCreator.exe', 'Character Creator*.exe'], searchDirs: ['Reallusion/Character Creator*'] },
  metashape: { names: ['Metashape'], exeNames: ['metashape.exe', 'Metashape.exe'], searchDirs: ['Agisoft/Metashape*'] },
  '3dequalizer': { names: ['3DEqualizer'], exeNames: ['3DE4.exe', '3DEqualizer*.exe'], searchDirs: ['3DEqualizer*', 'Science-D-Visions/3DEqualizer*'] },
  'fusion-360': { names: ['Fusion 360'], exeNames: ['Fusion360.exe'], searchDirs: ['Autodesk/webdeploy/production'] },
  keyshot: { names: ['KeyShot'], exeNames: ['keyshot.exe'], searchDirs: ['KeyShot*'] },
  'marmoset-toolbag': { names: ['Marmoset Toolbag'], exeNames: ['Toolbag.exe'], searchDirs: ['Marmoset/Toolbag*'] },
  modo: { names: ['Modo'], exeNames: ['modo.exe'], searchDirs: ['Foundry/Modo*'] },
  lightwave: { names: ['LightWave 3D'], exeNames: ['Layout.exe', 'LightWave.exe'], searchDirs: ['NewTek/LightWave*'] },
  freecad: { names: ['FreeCAD'], exeNames: ['FreeCAD.exe'], searchDirs: ['FreeCAD*'] },
  autocad: { names: ['AutoCAD'], exeNames: ['acad.exe'], searchDirs: ['Autodesk/AutoCAD*'] },
  krita: { names: ['Krita'], exeNames: ['krita.exe'], searchDirs: ['Krita*'] },
  gimp: { names: ['GIMP'], exeNames: ['gimp-*.exe', 'gimp.exe'], searchDirs: ['GIMP*'] },
  inkscape: { names: ['Inkscape'], exeNames: ['inkscape.exe'], searchDirs: ['Inkscape*'] },
  aseprite: { names: ['Aseprite'], exeNames: ['Aseprite.exe'], searchDirs: ['Aseprite'] },
  moho: { names: ['Moho'], exeNames: ['Moho.exe', 'Moho*.exe'], searchDirs: ['Moho*', 'Lost Marble/Moho*'] },
  'toon-boom-harmony': { names: ['Toon Boom Harmony'], exeNames: ['Harmony.exe', 'Toon Boom Harmony.exe'], searchDirs: ['Toon Boom Animation/Harmony*', 'Toon Boom Harmony*'] },
  opentoonz: { names: ['OpenToonz'], exeNames: ['OpenToonz.exe'], searchDirs: ['OpenToonz*'] },
  cavalry: { names: ['Cavalry'], exeNames: ['Cavalry.exe'], searchDirs: ['Cavalry*'] },
  tvpaint: { names: ['TVPaint Animation'], exeNames: ['TVPaint*.exe'], searchDirs: ['TVPaint*'] },
  reaper: { names: ['REAPER'], exeNames: ['reaper.exe'], searchDirs: ['REAPER*'] },
  'obs-studio': { names: ['OBS Studio'], exeNames: ['obs64.exe', 'obs32.exe'], searchDirs: ['obs-studio/bin/64bit'] },
  'vegas-pro': { names: ['VEGAS Pro'], exeNames: ['vegas*.exe', 'VEGAS*.exe'], searchDirs: ['VEGAS/VEGAS Pro*', 'Sony/VEGAS Pro*'] },
  synfig: { names: ['Synfig Studio'], exeNames: ['synfigstudio.exe'], searchDirs: ['Synfig*'] },
  motionbuilder: { names: ['MotionBuilder'], exeNames: ['motionbuilder.exe', 'MotionBuilder.exe'], searchDirs: ['Autodesk/MotionBuilder*', 'Autodesk'] },
};

function hostDisplayName(hostId: string): string {
  return HOST_BRIDGE_DEFINITIONS.find((item) => item.id === hostId)?.name || hostId;
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function fileMatches(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => wildcardToRegExp(pattern).test(name));
}

function isExecutablePathForHost(hostId: string, p: string): boolean {
  const spec = HOST_PROCESS_SPECS[hostId];
  if (!spec) return false;
  const full = resolve(p);
  if (!existsSync(full)) return false;
  try {
    if (!statSync(full).isFile()) return false;
  } catch {
    return false;
  }
  return extname(full).toLowerCase() === '.exe' && fileMatches(basename(full), spec.exeNames);
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .map((name) => join(dir, name))
      .filter((item) => {
        try {
          return statSync(item).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function expandSearchPattern(base: string, pattern: string): string[] {
  const parts = pattern.split(/[\\/]+/).filter(Boolean);
  let dirs = [resolve(base)];
  for (const part of parts) {
    const hasWildcard = part.includes('*');
    const rx = hasWildcard ? wildcardToRegExp(part) : null;
    const next: string[] = [];
    for (const dir of dirs) {
      if (hasWildcard) {
        for (const child of listDirs(dir)) {
          if (rx!.test(basename(child))) next.push(child);
        }
      } else {
        const child = join(dir, part);
        if (existsSync(child)) next.push(child);
      }
    }
    dirs = next;
  }
  return dirs;
}

function findExecutableUnder(dir: string, exeNames: string[], depth = 3): string | null {
  const root = resolve(dir);
  if (!existsSync(root)) return null;
  try {
    const st = statSync(root);
    if (st.isFile()) return fileMatches(basename(root), exeNames) ? root : null;
    if (!st.isDirectory()) return null;
  } catch {
    return null;
  }
  const direct = exeNames
    .filter((name) => !name.includes('*'))
    .map((name) => join(root, name))
    .find((candidate) => existsSync(candidate));
  if (direct) return direct;
  if (depth <= 0) return null;
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const child = join(root, entry);
    try {
      const st = statSync(child);
      if (st.isFile() && extname(child).toLowerCase() === '.exe' && fileMatches(entry, exeNames)) return child;
      if (st.isDirectory()) {
        const found = findExecutableUnder(child, exeNames, depth - 1);
        if (found) return found;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function executablePathsFromProcessRows(hostIdRaw: string, rows: ProcessRow[]): string[] {
  const hostId = String(hostIdRaw || '').trim();
  const spec = HOST_PROCESS_SPECS[hostId];
  if (!spec) return [];
  const paths: string[] = [];
  for (const row of rows) {
    const name = String(row.Name || row.name || '').trim();
    const executablePath = String(row.ExecutablePath || row.executablePath || '').trim();
    if (!executablePath) continue;
    if (name && !fileMatches(name, spec.exeNames)) continue;
    if (isExecutablePathForHost(hostId, executablePath)) paths.push(resolve(executablePath));
  }
  return Array.from(new Set(paths));
}

function runningExecutablePathsForHost(hostId: string): string[] {
  if (process.platform !== 'win32') return [];
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object Name,ExecutablePath | ConvertTo-Json -Compress',
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 8000 },
  );
  if (result.status !== 0 || !result.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(result.stdout.trim()) as ProcessRow | ProcessRow[];
    return executablePathsFromProcessRows(hostId, Array.isArray(parsed) ? parsed : [parsed]);
  } catch {
    return [];
  }
}

function versionHintFromExecutablePath(executablePath: string): string | undefined {
  const parent = basename(dirname(executablePath));
  const match = parent.match(/\b(\d+(?:\.\d+){0,3}[a-z0-9-]*)\b/i);
  return match?.[1] || parent || undefined;
}

function runningTargetInstallGuidance(hostId: string): { installUsable: boolean; nextStep: string } {
  const def = HOST_BRIDGE_DEFINITIONS.find((item) => item.id === hostId);
  const acceptsInstallDir = Boolean(def?.manualTarget?.accepts?.includes('install_dir'));
  if (acceptsInstallDir) {
    return {
      installUsable: true,
      nextStep:
        '\u8fd9\u6761\u8bb0\u5f55\u53ef\u7528\u4e8e\u540e\u7eed\u542f\u52a8\uff1b\u8be5\u5bbf\u4e3b\u89c4\u5219\u63a5\u53d7\u5b89\u88c5\u76ee\u5f55\uff0c\u4e5f\u53ef\u4ee5\u7ee7\u7eed\u5c1d\u8bd5\u4e00\u952e\u5b89\u88c5\u3002',
    };
  }
  return {
    installUsable: false,
    nextStep:
      '\u8fd9\u6761\u8bb0\u5f55\u53ef\u7528\u4e8e\u540e\u7eed\u542f\u52a8\uff1b\u4e00\u952e\u5b89\u88c5\u8fd8\u9700\u8981\u9009\u62e9\u8be5\u5bbf\u4e3b\u8981\u6c42\u7684\u9879\u76ee\u76ee\u5f55\u3001\u811a\u672c\u76ee\u5f55\u6216\u63d2\u4ef6\u76ee\u5f55\u3002',
  };
}

export function saveRunningHostTarget(hostIdRaw: string): HostRunningTargetResult {
  const hostId = String(hostIdRaw || '').trim();
  const spec = HOST_PROCESS_SPECS[hostId];
  if (!spec) {
    return { ok: false, hostId, error: 'host_discovery_not_supported', message: `${hostDisplayName(hostId)} 暂不支持识别已打开软件。` };
  }
  const executablePath = runningExecutablePathsForHost(hostId)[0];
  if (!executablePath) {
    return {
      ok: false,
      hostId,
      error: 'host_running_executable_not_found',
      message: `未发现正在运行的 ${hostDisplayName(hostId)}。请先打开软件，或手动添加安装目录 / exe 路径。`,
    };
  }
  const installDir = dirname(executablePath);
  const versionHint = versionHintFromExecutablePath(executablePath);
  const guidance = runningTargetInstallGuidance(hostId);
  const target = upsertCustomHostTarget(hostId, {
    label: `${hostDisplayName(hostId)}${versionHint ? ` ${versionHint}` : ''} (running detected)`,
    inputPath: executablePath,
    resolvedPath: installDir,
    targetKind: 'install_dir',
    versionHint,
  });
  return {
    ok: true,
    hostId,
    executablePath,
    target,
    installUsable: guidance.installUsable,
    nextStep: guidance.nextStep,
    message: `已识别正在运行的 ${hostDisplayName(hostId)}，并保存为可复用版本。`,
  };
}

function normalizeLaunchOptions(options?: string | HostAppLaunchOptions): HostAppLaunchOptions {
  if (typeof options === 'string') return { executablePath: options };
  return options || {};
}

function selectedTargetId(options: HostAppLaunchOptions): string {
  return String(options.targetId || options.versionId || '').trim();
}

function candidateRootsForHost(hostId: string, options: HostAppLaunchOptions): string[] {
  const spec = HOST_PROCESS_SPECS[hostId];
  const roots: string[] = [];
  const explicitPath = options.executablePath ? String(options.executablePath).trim() : '';
  if (explicitPath) roots.push(resolve(explicitPath));
  const targetId = selectedTargetId(options);
  const targets = readCustomHostTargetsForHost(hostId);
  const matchedTargets = targetId ? targets.filter((target) => target.id === targetId) : [];
  const launchTargets = targetId && matchedTargets.length ? matchedTargets : targets;
  for (const target of launchTargets) {
    roots.push(target.inputPath, target.resolvedPath);
  }
  if (!targetId) roots.push(...runningExecutablePathsForHost(hostId));
  if (spec?.searchDirs) {
    for (const base of PROGRAM_FILES) {
      for (const pattern of spec.searchDirs) roots.push(...expandSearchPattern(base, pattern));
    }
  }
  return Array.from(new Set(roots.filter(Boolean).map((item) => resolve(item))));
}

export function resolveHostExecutable(hostIdRaw: string, options?: string | HostAppLaunchOptions): HostAppProcessResult {
  const hostId = String(hostIdRaw || '').trim();
  const launchOptions = normalizeLaunchOptions(options);
  const explicitPath = launchOptions.executablePath ? String(launchOptions.executablePath).trim() : '';
  const spec = HOST_PROCESS_SPECS[hostId];
  if (!spec) {
    return { ok: false, hostId, error: 'host_launch_not_supported', message: `${hostDisplayName(hostId)} 暂不支持直接启动。` };
  }
  const targetId = selectedTargetId(launchOptions);
  const targetExists = targetId ? readCustomHostTargetsForHost(hostId).some((target) => target.id === targetId) : false;
  if (explicitPath && isExecutablePathForHost(hostId, explicitPath)) {
    return { ok: true, hostId, executablePath: resolve(explicitPath), message: `已找到 ${hostDisplayName(hostId)} 可执行程序。` };
  }
  for (const root of candidateRootsForHost(hostId, launchOptions)) {
    const found = findExecutableUnder(root, spec.exeNames);
    if (found) return { ok: true, hostId, executablePath: found, message: `已找到 ${hostDisplayName(hostId)} 可执行程序。` };
  }
  if (targetId) {
    return {
      ok: false,
      hostId,
      error: targetExists ? 'host_version_executable_not_found' : 'host_version_not_found',
      message:
        targetExists
          ? '\u5df2\u627e\u5230\u7248\u672c\u8bb0\u5f55\uff0c\u4f46\u672a\u627e\u5230\u53ef\u6267\u884c\u7a0b\u5e8f\uff0c\u8bf7\u4e3a\u8be5\u7248\u672c\u8865\u5145\u8f6f\u4ef6\u5b89\u88c5\u76ee\u5f55\u6216 exe \u8def\u5f84\u3002'
          : '\u672a\u627e\u5230\u8fd9\u4e2a\u5bbf\u4e3b\u542f\u52a8\u7248\u672c\u8bb0\u5f55\uff0c\u5df2\u5c1d\u8bd5\u4f7f\u7528\u5df2\u8bc6\u522b\u7684\u8fd0\u884c\u4e2d\u8def\u5f84\u548c\u5e38\u89c1\u5b89\u88c5\u76ee\u5f55\u3002\u8bf7\u5148\u70b9\u201c\u8bc6\u522b\u5df2\u6253\u5f00\u8f6f\u4ef6\u201d\uff0c\u6216\u624b\u52a8\u6dfb\u52a0\u8be5\u7248\u672c\u5b89\u88c5\u76ee\u5f55 / exe\u3002',
    };
  }
  return {
    ok: false,
    hostId,
    error: 'host_executable_not_found',
    message: `未找到 ${hostDisplayName(hostId)} 的可执行程序。请先手动添加该软件的安装目录或 exe 路径。`,
  };
}

export function launchHostApp(hostId: string, options?: HostAppLaunchOptions): HostAppProcessResult {
  const resolved = resolveHostExecutable(hostId, options);
  if (!resolved.ok || !resolved.executablePath) return resolved;
  try {
    const child = spawn(resolved.executablePath, [], {
      cwd: dirname(resolved.executablePath),
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return {
      ok: true,
      hostId,
      executablePath: resolved.executablePath,
      pid: child.pid,
      message: `已启动 ${hostDisplayName(hostId)}。`,
    };
  } catch (e) {
    return {
      ok: false,
      hostId,
      executablePath: resolved.executablePath,
      error: 'host_launch_failed',
      message: `启动 ${hostDisplayName(hostId)} 失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export function closeHostApp(hostIdRaw: string): HostAppProcessResult {
  const hostId = String(hostIdRaw || '').trim();
  const spec = HOST_PROCESS_SPECS[hostId];
  if (!spec) {
    return { ok: false, hostId, error: 'host_close_not_supported', message: `${hostDisplayName(hostId)} 暂不支持直接关闭。` };
  }
  if (process.platform !== 'win32') {
    return { ok: false, hostId, error: 'host_close_unsupported_platform', message: '当前系统暂不支持一键关闭宿主。' };
  }
  const processNames = spec.exeNames.filter((name) => name.toLowerCase().endsWith('.exe'));
  let closed = 0;
  for (const name of processNames) {
    const r = spawnSync('taskkill.exe', ['/IM', name, '/T'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) closed += 1;
  }
  if (!closed) {
    return {
      ok: false,
      hostId,
      processNames,
      error: 'host_process_not_running',
      message: `${hostDisplayName(hostId)} 当前未运行，或需要手动关闭。`,
    };
  }
  return { ok: true, hostId, processNames, message: `已请求关闭 ${hostDisplayName(hostId)}。` };
}
