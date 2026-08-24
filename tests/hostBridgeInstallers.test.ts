import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BLENDER_BRIDGE_STARTUP_NAME,
  discoverBlenderBridgeVersions,
  installBlenderBridge,
  uninstallBlenderBridge,
} from '../local-companion/src/bridges/blenderBridgeInstall.ts';
import {
  installMaxBridge,
  MAX_BRIDGE_PY_NAME,
  MAX_BRIDGE_STARTUP_MS_NAME,
  uninstallMaxBridge,
} from '../local-companion/src/bridges/maxBridgeInstall.ts';
import {
  installCinema4DBridge,
  CINEMA4D_BRIDGE_SCRIPT_NAME,
  uninstallCinema4DBridge,
} from '../local-companion/src/bridges/cinema4dBridgeInstall.ts';
import {
  discoverHoudiniBridgeTargets,
  HOUDINI_BRIDGE_MARKER_START,
  HOUDINI_BRIDGE_PY_NAME,
  installHoudiniBridge,
  uninstallHoudiniBridge,
} from '../local-companion/src/bridges/houdiniBridgeInstall.ts';
import {
  installZBrushBridge,
  uninstallZBrushBridge,
  ZBRUSH_BRIDGE_SCRIPT_NAME,
} from '../local-companion/src/bridges/zbrushBridgeInstall.ts';
import {
  installSubstancePainterBridge,
  SUBSTANCE_PAINTER_BRIDGE_PLUGIN_NAME,
  uninstallSubstancePainterBridge,
} from '../local-companion/src/bridges/substancePainterBridgeInstall.ts';
import {
  installSubstanceDesignerBridge,
  SUBSTANCE_DESIGNER_BRIDGE_SCRIPT_NAME,
  uninstallSubstanceDesignerBridge,
} from '../local-companion/src/bridges/substanceDesignerBridgeInstall.ts';
import {
  installMariBridge,
  MARI_BRIDGE_SCRIPT_NAME,
  uninstallMariBridge,
} from '../local-companion/src/bridges/mariBridgeInstall.ts';
import {
  installKritaBridge,
  KRITA_BRIDGE_DESKTOP_NAME,
  KRITA_BRIDGE_PLUGIN_NAME,
  KRITA_BRIDGE_SCRIPT_NAME,
  uninstallKritaBridge,
} from '../local-companion/src/bridges/kritaBridgeInstall.ts';
import {
  GIMP_BRIDGE_PLUGIN_NAME,
  installGimpBridge,
  uninstallGimpBridge,
} from '../local-companion/src/bridges/gimpBridgeInstall.ts';
import {
  ASEPRITE_BRIDGE_SCRIPT_NAME,
  installAsepriteBridge,
  uninstallAsepriteBridge,
} from '../local-companion/src/bridges/asepriteBridgeInstall.ts';
import {
  installMohoBridge,
  MOHO_BRIDGE_SCRIPT_NAME,
  uninstallMohoBridge,
} from '../local-companion/src/bridges/mohoBridgeInstall.ts';
import {
  installToonBoomHarmonyBridge,
  TOON_BOOM_HARMONY_BRIDGE_SCRIPT_NAME,
  uninstallToonBoomHarmonyBridge,
} from '../local-companion/src/bridges/toonBoomHarmonyBridgeInstall.ts';
import {
  installOpenToonzBridge,
  OPENTOONZ_BRIDGE_SCRIPT_NAME,
  uninstallOpenToonzBridge,
} from '../local-companion/src/bridges/openToonzBridgeInstall.ts';
import {
  CAVALRY_BRIDGE_SCRIPT_NAME,
  installCavalryBridge,
  uninstallCavalryBridge,
} from '../local-companion/src/bridges/cavalryBridgeInstall.ts';
import {
  CLO_BRIDGE_SCRIPT_NAME,
  installCloMarvelousBridge,
  MARVELOUS_DESIGNER_BRIDGE_SCRIPT_NAME,
  uninstallCloMarvelousBridge,
} from '../local-companion/src/bridges/cloMarvelousBridgeInstall.ts';
import {
  installRizomUvBridge,
  RIZOMUV_BRIDGE_SCRIPT_NAME,
  uninstallRizomUvBridge,
} from '../local-companion/src/bridges/rizomUvBridgeInstall.ts';
import {
  DAZ_STUDIO_BRIDGE_SCRIPT_NAME,
  installDazStudioBridge,
  uninstallDazStudioBridge,
} from '../local-companion/src/bridges/dazStudioBridgeInstall.ts';
import {
  installPoserBridge,
  POSER_BRIDGE_SCRIPT_NAME,
  uninstallPoserBridge,
} from '../local-companion/src/bridges/poserBridgeInstall.ts';
import {
  installReallusionBridge,
  REALLUSION_BRIDGE_PLUGIN_DIR_NAME,
  REALLUSION_BRIDGE_SCRIPT_NAME,
  uninstallReallusionBridge,
} from '../local-companion/src/bridges/reallusionBridgeInstall.ts';
import {
  installMetashapeBridge,
  METASHAPE_BRIDGE_SCRIPT_NAME,
  uninstallMetashapeBridge,
} from '../local-companion/src/bridges/metashapeBridgeInstall.ts';
import {
  installThreeDequalizerBridge,
  THREEDEQUALIZER_BRIDGE_SCRIPT_NAME,
  uninstallThreeDequalizerBridge,
} from '../local-companion/src/bridges/threeDequalizerBridgeInstall.ts';
import {
  installKatanaBridge,
  KATANA_BRIDGE_MARKER_START,
  KATANA_BRIDGE_SCRIPT_NAME,
  uninstallKatanaBridge,
} from '../local-companion/src/bridges/katanaBridgeInstall.ts';
import {
  installLightroomBridge,
  LIGHTROOM_BRIDGE_INFO_NAME,
  LIGHTROOM_BRIDGE_INIT_NAME,
  LIGHTROOM_BRIDGE_PLUGIN_DIR_NAME,
  uninstallLightroomBridge,
} from '../local-companion/src/bridges/lightroomBridgeInstall.ts';
import {
  DARKTABLE_BRIDGE_MARKER_START,
  DARKTABLE_BRIDGE_SCRIPT_NAME,
  DARKTABLE_LUARC_NAME,
  installDarktableBridge,
  uninstallDarktableBridge,
} from '../local-companion/src/bridges/darktableBridgeInstall.ts';
import {
  installVegasProBridge,
  uninstallVegasProBridge,
  VEGAS_PRO_BRIDGE_SCRIPT_NAME,
} from '../local-companion/src/bridges/vegasProBridgeInstall.ts';
import {
  installTvPaintBridge,
  TVPAINT_BRIDGE_SCRIPT_NAME,
  uninstallTvPaintBridge,
} from '../local-companion/src/bridges/tvPaintBridgeInstall.ts';
import {
  installSynfigBridge,
  SYNFIG_BRIDGE_PLUGIN_DIR_NAME,
  SYNFIG_BRIDGE_PLUGIN_XML_NAME,
  SYNFIG_BRIDGE_SCRIPT_NAME,
  uninstallSynfigBridge,
} from '../local-companion/src/bridges/synfigBridgeInstall.ts';
import {
  installDavinciResolveBridge,
  DAVINCI_RESOLVE_BRIDGE_SCRIPT_NAME,
  uninstallDavinciResolveBridge,
} from '../local-companion/src/bridges/davinciResolveBridgeInstall.ts';
import {
  FUSION_STUDIO_BRIDGE_SCRIPT_NAME,
  installFusionStudioBridge,
  uninstallFusionStudioBridge,
} from '../local-companion/src/bridges/fusionStudioBridgeInstall.ts';
import {
  discoverNukeBridgeTargets,
  installNukeBridge,
  NUKE_BRIDGE_MARKER_START,
  NUKE_BRIDGE_PY_NAME,
  uninstallNukeBridge,
} from '../local-companion/src/bridges/nukeBridgeInstall.ts';
import {
  FOUNDRY_TIMELINE_INIT_PY_NAME,
  HIERO_BRIDGE_PY_NAME,
  installFoundryTimelineBridge,
  NUKE_STUDIO_BRIDGE_PY_NAME,
  uninstallFoundryTimelineBridge,
} from '../local-companion/src/bridges/foundryTimelineBridgeInstall.ts';
import {
  discoverNatronBridgeTargets,
  installNatronBridge,
  NATRON_BRIDGE_MARKER_START,
  NATRON_BRIDGE_PY_NAME,
  uninstallNatronBridge,
} from '../local-companion/src/bridges/natronBridgeInstall.ts';
import {
  installObsStudioBridge,
  OBS_STUDIO_BRIDGE_SCRIPT_NAME,
  uninstallObsStudioBridge,
} from '../local-companion/src/bridges/obsStudioBridgeInstall.ts';
import {
  installReaperBridge,
  REAPER_BRIDGE_SCRIPT_NAME,
  uninstallReaperBridge,
} from '../local-companion/src/bridges/reaperBridgeInstall.ts';
import {
  discoverAdobeBridgeTargets,
  installAdobeBridge,
  uninstallAdobeBridge,
  type AdobeBridgeId,
} from '../local-companion/src/bridges/adobeExtendScriptBridgeInstall.ts';
import {
  INKSCAPE_BRIDGE_INX_NAME,
  INKSCAPE_BRIDGE_SCRIPT_NAME,
  installInkscapeBridge,
  uninstallInkscapeBridge,
} from '../local-companion/src/bridges/inkscapeBridgeInstall.ts';
import {
  discoverGodotBridgeTargets,
  GODOT_PLUGIN_CFG_NAME,
  GODOT_PLUGIN_SCRIPT_NAME,
  installGodotBridge,
  uninstallGodotBridge,
} from '../local-companion/src/bridges/godotBridgeInstall.ts';
import {
  installMotionBuilderBridge,
  MOTIONBUILDER_BRIDGE_SCRIPT_NAME,
  uninstallMotionBuilderBridge,
} from '../local-companion/src/bridges/motionBuilderBridgeInstall.ts';
import {
  FUSION360_ADDIN_MANIFEST_NAME,
  FUSION360_ADDIN_NAME,
  FUSION360_ADDIN_SCRIPT_NAME,
  installFusion360Bridge,
  uninstallFusion360Bridge,
} from '../local-companion/src/bridges/fusion360BridgeInstall.ts';
import {
  installKeyShotBridge,
  KEYSHOT_BRIDGE_SCRIPT_NAME,
  uninstallKeyShotBridge,
} from '../local-companion/src/bridges/keyshotBridgeInstall.ts';
import {
  installMarmosetToolbagBridge,
  MARMOSET_TOOLBAG_BRIDGE_SCRIPT_NAME,
  uninstallMarmosetToolbagBridge,
} from '../local-companion/src/bridges/marmosetToolbagBridgeInstall.ts';
import {
  installModoBridge,
  MODO_BRIDGE_SCRIPT_NAME,
  uninstallModoBridge,
} from '../local-companion/src/bridges/modoBridgeInstall.ts';
import {
  installLightWaveBridge,
  LIGHTWAVE_BRIDGE_SCRIPT_NAME,
  uninstallLightWaveBridge,
} from '../local-companion/src/bridges/lightwaveBridgeInstall.ts';
import {
  FREECAD_INIT_GUI_NAME,
  FREECAD_WORKBENCH_NAME,
  installFreeCADBridge,
  uninstallFreeCADBridge,
} from '../local-companion/src/bridges/freecadBridgeInstall.ts';
import {
  AUTOCAD_ACADDOC_NAME,
  AUTOCAD_BRIDGE_MARKER_START,
  AUTOCAD_BRIDGE_SCRIPT_NAME,
  installAutoCADBridge,
  uninstallAutoCADBridge,
} from '../local-companion/src/bridges/autocadBridgeInstall.ts';
import {
  discoverUnityBridgeTargets,
  installUnityBridge,
  UNITY_BRIDGE_SCRIPT_NAME,
  uninstallUnityBridge,
} from '../local-companion/src/bridges/unityBridgeInstall.ts';
import {
  discoverUnrealBridgeTargets,
  installUnrealBridge,
  UNREAL_PLUGIN_NAME,
  uninstallUnrealBridge,
} from '../local-companion/src/bridges/unrealBridgeInstall.ts';
import {
  installRhinoBridge,
  RHINO_BRIDGE_SCRIPT_NAME,
  uninstallRhinoBridge,
} from '../local-companion/src/bridges/rhinoBridgeInstall.ts';
import {
  installSketchUpBridge,
  SKETCHUP_BRIDGE_PLUGIN_NAME,
  uninstallSketchUpBridge,
} from '../local-companion/src/bridges/sketchupBridgeInstall.ts';
import {
  buildHostBridgeAcceptanceSummary,
  readHostBridgeAcceptance,
  REQUIRED_HOST_BRIDGE_ACCEPTANCE_GROUPS,
  writeHostBridgeAcceptanceRecord,
} from '../local-companion/src/bridges/hostBridgeAcceptance.ts';
import { readCustomHostTargetsForHost } from '../local-companion/src/bridges/customHostTargets.ts';

const temps: string[] = [];

function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}

function useSandbox(): string {
  const sandbox = tempDir('host-bridge-sandbox-');
  process.env.COMPANION_SANDBOX_ROOT = sandbox;
  return sandbox;
}

afterEach(() => {
  delete process.env.COMPANION_SANDBOX_ROOT;
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('host bridge installers', () => {
  it('persists host bridge acceptance checks separately from install records', () => {
    const sandbox = useSandbox();
    expect(() => writeHostBridgeAcceptanceRecord('blender', { ok: true, message: '' })).toThrow('acceptance_evidence_required');
    expect(() => writeHostBridgeAcceptanceRecord('unknown-host', { ok: true, message: 'Unknown host connected somehow' })).toThrow(
      'acceptance_host_not_in_required_groups',
    );
    const failedUnknown = writeHostBridgeAcceptanceRecord('unknown-host', { ok: false, message: 'Unknown host still failed' });
    expect(failedUnknown.ok).toBe(false);
    expect(failedUnknown.groups).toEqual([]);
    const rec = writeHostBridgeAcceptanceRecord('blender', { ok: true, message: 'Blender bridge connected' });
    expect(rec.ok).toBe(true);
    expect(rec.groups).toContain('python_dcc');
    expect(existsSync(join(sandbox, 'bridges', 'host-bridge-acceptance.json'))).toBe(true);
    const all = readHostBridgeAcceptance();
    expect(all.blender?.ok).toBe(true);
    expect(all.blender?.message).toBe('Blender bridge connected');
    expect(all.blender?.groups).toContain('python_dcc');
  });

  it('summarizes the required real-software acceptance groups', () => {
    useSandbox();
    expect(REQUIRED_HOST_BRIDGE_ACCEPTANCE_GROUPS.map((group) => group.id)).toEqual([
      'maya',
      'adobe',
      'python_dcc',
      'lua_heartbeat',
      'project_plugin',
      'manual_script_dir',
      'paired_software',
    ]);
    expect(buildHostBridgeAcceptanceSummary().ok).toBe(false);
    writeHostBridgeAcceptanceRecord('maya', { ok: true, message: 'Maya command port connected' });
    writeHostBridgeAcceptanceRecord('photoshop', { ok: true, message: 'Photoshop heartbeat connected' });
    writeHostBridgeAcceptanceRecord('blender', { ok: true, message: 'Blender HTTP connected' });
    writeHostBridgeAcceptanceRecord('aseprite', { ok: true, message: 'Aseprite heartbeat connected' });
    writeHostBridgeAcceptanceRecord('unity', { ok: true, message: 'Unity project plugin connected' });
    writeHostBridgeAcceptanceRecord('zbrush', { ok: true, message: 'ZBrush script heartbeat connected' });
    writeHostBridgeAcceptanceRecord('marvelous-designer', { ok: true, message: 'Marvelous Designer heartbeat connected' });
    const summary = buildHostBridgeAcceptanceSummary();
    expect(summary.ok).toBe(true);
    expect(summary.acceptedGroups).toBe(7);
    expect(summary.requiredGroups).toBe(7);
  });

  it('installs and uninstalls Blender startup bridge', () => {
    useSandbox();
    const startupDir = tempDir('blender-startup-');
    const inst = installBlenderBridge({ startupDirs: [startupDir], port: 7012 });
    expect(inst.ok).toBe(true);
    expect(existsSync(join(startupDir, BLENDER_BRIDGE_STARTUP_NAME))).toBe(true);
    expect(readFileSync(join(startupDir, BLENDER_BRIDGE_STARTUP_NAME), 'utf8')).toContain('PORT = 7012');
    expect(readFileSync(join(startupDir, BLENDER_BRIDGE_STARTUP_NAME), 'utf8')).toContain('bpy.app.version');
    expect(readFileSync(join(startupDir, BLENDER_BRIDGE_STARTUP_NAME), 'utf8')).toContain('def register():');
    const un = uninstallBlenderBridge({ startupDirs: [startupDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(startupDir, BLENDER_BRIDGE_STARTUP_NAME))).toBe(false);
  });

  it('maps a manually selected Blender install folder to the writable user startup folder', () => {
    useSandbox();
    const home = tempDir('blender-home-');
    const installRoot = join(tempDir('program-files-'), 'Blender Foundation', 'Blender 5.1');
    mkdirSync(installRoot, { recursive: true });
    const expectedStartup = join(home, 'AppData', 'Roaming', 'Blender Foundation', 'Blender', '5.1', 'scripts', 'startup');
    const inst = installBlenderBridge({ startupDirs: [installRoot], home, port: 7013 });
    expect(inst.ok).toBe(true);
    expect(existsSync(join(expectedStartup, BLENDER_BRIDGE_STARTUP_NAME))).toBe(true);
    expect(existsSync(join(installRoot, BLENDER_BRIDGE_STARTUP_NAME))).toBe(false);
    const custom = readCustomHostTargetsForHost('blender');
    expect(custom.length).toBe(1);
    expect(custom[0].inputPath).toBe(installRoot);
    expect(custom[0].resolvedPath).toBe(expectedStartup);
    expect(custom[0].targetKind).toBe('install_dir');
    expect(custom[0].versionHint).toBe('5.1');
    const rediscovered = discoverBlenderBridgeVersions({ home });
    expect(rediscovered.some((item) => item.startupDir === expectedStartup)).toBe(true);
  });

  it('installs and uninstalls 3ds Max startup bridge', () => {
    useSandbox();
    const startupDir = tempDir('max-startup-');
    const inst = installMaxBridge({ startupDirs: [startupDir], port: 7022 });
    expect(inst.ok).toBe(true);
    expect(existsSync(join(startupDir, MAX_BRIDGE_STARTUP_MS_NAME))).toBe(true);
    expect(existsSync(join(startupDir, MAX_BRIDGE_PY_NAME))).toBe(true);
    expect(readFileSync(join(startupDir, MAX_BRIDGE_PY_NAME), 'utf8')).toContain('PORT = 7022');
    const un = uninstallMaxBridge({ startupDirs: [startupDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(startupDir, MAX_BRIDGE_PY_NAME))).toBe(false);
  });

  it('installs and uninstalls Cinema 4D script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('c4d-scripts-');
    const inst = installCinema4DBridge({ scriptsDirs: [scriptsDir], port: 7062 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, CINEMA4D_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7062');
    const un = uninstallCinema4DBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, CINEMA4D_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Houdini pythonrc bridge without deleting existing content', () => {
    useSandbox();
    const prefsDir = tempDir('houdini-prefs-');
    writeFileSync(join(prefsDir, 'pythonrc.py'), '# existing\n', 'utf8');
    const inst = installHoudiniBridge({ prefsDirs: [prefsDir], port: 7042 });
    expect(inst.ok).toBe(true);
    expect(existsSync(join(prefsDir, HOUDINI_BRIDGE_PY_NAME))).toBe(true);
    const pyrc = readFileSync(join(prefsDir, 'pythonrc.py'), 'utf8');
    expect(pyrc).toContain('# existing');
    expect(pyrc).toContain(HOUDINI_BRIDGE_MARKER_START);
    const un = uninstallHoudiniBridge({ prefsDirs: [prefsDir] });
    expect(un.removed[0]?.removed).toBe(true);
    expect(readFileSync(join(prefsDir, 'pythonrc.py'), 'utf8')).toContain('# existing');
    expect(readFileSync(join(prefsDir, 'pythonrc.py'), 'utf8')).not.toContain(HOUDINI_BRIDGE_MARKER_START);
  });

  it('maps a manually selected Houdini install folder to the writable prefs folder', () => {
    useSandbox();
    const home = tempDir('houdini-home-');
    const installRoot = join(tempDir('sidefx-program-files-'), 'Side Effects Software', 'Houdini 20.5.410');
    mkdirSync(installRoot, { recursive: true });
    const expectedPrefs = join(home, 'Documents', 'houdini20.5');
    const inst = installHoudiniBridge({ prefsDirs: [installRoot], home, port: 7043 });
    expect(inst.ok).toBe(true);
    expect(existsSync(join(expectedPrefs, HOUDINI_BRIDGE_PY_NAME))).toBe(true);
    expect(existsSync(join(installRoot, HOUDINI_BRIDGE_PY_NAME))).toBe(false);
    const custom = readCustomHostTargetsForHost('houdini');
    expect(custom.length).toBe(1);
    expect(custom[0].inputPath).toBe(installRoot);
    expect(custom[0].resolvedPath).toBe(expectedPrefs);
    expect(custom[0].targetKind).toBe('install_dir');
    expect(custom[0].versionHint).toBe('20.5');
    expect(discoverHoudiniBridgeTargets({ home }).some((item) => item.prefsDir === expectedPrefs)).toBe(true);
  });

  it('installs and uninstalls ZBrush ZScript bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('zbrush-scripts-');
    const inst = installZBrushBridge({ scriptsDirs: [scriptsDir], port: 7122 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, ZBRUSH_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('ZBrush Bridge');
    const un = uninstallZBrushBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, ZBRUSH_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Substance Painter plugin bridge', () => {
    useSandbox();
    const pluginDir = tempDir('substance-plugins-');
    const inst = installSubstancePainterBridge({ pluginDirs: [pluginDir], port: 7032 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(pluginDir, SUBSTANCE_PAINTER_BRIDGE_PLUGIN_NAME), 'utf8')).toContain('PORT = 7032');
    const un = uninstallSubstancePainterBridge({ pluginDirs: [pluginDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(pluginDir, SUBSTANCE_PAINTER_BRIDGE_PLUGIN_NAME))).toBe(false);
  });

  it('installs and uninstalls Substance Designer Python bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('substance-designer-scripts-');
    const inst = installSubstanceDesignerBridge({ scriptsDirs: [scriptsDir], port: 7342 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, SUBSTANCE_DESIGNER_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7342');
    expect(readFileSync(join(scriptsDir, SUBSTANCE_DESIGNER_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('substance-designer');
    const un = uninstallSubstanceDesignerBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, SUBSTANCE_DESIGNER_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Mari script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('mari-scripts-');
    const inst = installMariBridge({ scriptsDirs: [scriptsDir], port: 7232 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, MARI_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7232');
    const un = uninstallMariBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, MARI_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Krita Python plugin bridge', () => {
    useSandbox();
    const pluginDir = tempDir('krita-pykrita-');
    const inst = installKritaBridge({ pluginDirs: [pluginDir], port: 7222 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(pluginDir, KRITA_BRIDGE_DESKTOP_NAME), 'utf8')).toContain('Krita/PythonPlugin');
    expect(readFileSync(join(pluginDir, KRITA_BRIDGE_PLUGIN_NAME, KRITA_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7222');
    const un = uninstallKritaBridge({ pluginDirs: [pluginDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(pluginDir, KRITA_BRIDGE_DESKTOP_NAME))).toBe(false);
    expect(existsSync(join(pluginDir, KRITA_BRIDGE_PLUGIN_NAME))).toBe(false);
  });

  it('installs and uninstalls GIMP Python-Fu plugin bridge', () => {
    useSandbox();
    const pluginDir = tempDir('gimp-plug-ins-');
    const inst = installGimpBridge({ pluginDirs: [pluginDir], port: 7252 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(pluginDir, GIMP_BRIDGE_PLUGIN_NAME), 'utf8')).toContain('PORT = 7252');
    expect(readFileSync(join(pluginDir, GIMP_BRIDGE_PLUGIN_NAME), 'utf8')).toContain('python_fu_assetcutter_bridge');
    const un = uninstallGimpBridge({ pluginDirs: [pluginDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(pluginDir, GIMP_BRIDGE_PLUGIN_NAME))).toBe(false);
  });

  it('installs and uninstalls Aseprite Lua script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('aseprite-scripts-');
    const inst = installAsepriteBridge({ scriptsDirs: [scriptsDir], port: 7382 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, ASEPRITE_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('port = 7382');
    expect(readFileSync(join(scriptsDir, ASEPRITE_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('host":"aseprite');
    const un = uninstallAsepriteBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, ASEPRITE_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Moho Lua menu script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('moho-scripts-menu-');
    const inst = installMohoBridge({ scriptsDirs: [scriptsDir], port: 7402 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, MOHO_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('port = 7402');
    expect(readFileSync(join(scriptsDir, MOHO_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('host":"moho');
    const un = uninstallMohoBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, MOHO_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Toon Boom Harmony JavaScript bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('harmony-scripts-');
    const inst = installToonBoomHarmonyBridge({ scriptsDirs: [scriptsDir], port: 7412 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, TOON_BOOM_HARMONY_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('"port":7412');
    expect(readFileSync(join(scriptsDir, TOON_BOOM_HARMONY_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('toon-boom-harmony');
    const un = uninstallToonBoomHarmonyBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, TOON_BOOM_HARMONY_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls OpenToonz ToonzScript bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('opentoonz-script-');
    const inst = installOpenToonzBridge({ scriptsDirs: [scriptsDir], port: 7422 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, OPENTOONZ_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('"port":7422');
    expect(readFileSync(join(scriptsDir, OPENTOONZ_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('opentoonz');
    const un = uninstallOpenToonzBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, OPENTOONZ_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Cavalry JavaScript UI Script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('cavalry-scripts-');
    const inst = installCavalryBridge({ scriptsDirs: [scriptsDir], port: 7432 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, CAVALRY_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('assetCutterPort = 7432');
    expect(readFileSync(join(scriptsDir, CAVALRY_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('host":"cavalry');
    const un = uninstallCavalryBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, CAVALRY_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls TVPaint George script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('tvpaint-george-scripts-');
    const inst = installTvPaintBridge({ scriptsDirs: [scriptsDir], port: 7482 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, TVPAINT_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('tv_WriteTextFile');
    expect(readFileSync(join(scriptsDir, TVPAINT_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('host\\":\\"tvpaint');
    const un = uninstallTvPaintBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, TVPAINT_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Marvelous Designer Python script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('marvelous-designer-scripts-');
    const inst = installCloMarvelousBridge('marvelous-designer', { scriptsDirs: [scriptsDir], port: 7442 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, MARVELOUS_DESIGNER_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7442');
    expect(readFileSync(join(scriptsDir, MARVELOUS_DESIGNER_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('HOST_ID = "marvelous-designer"');
    const un = uninstallCloMarvelousBridge('marvelous-designer', { scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, MARVELOUS_DESIGNER_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls CLO Python script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('clo-scripts-');
    const inst = installCloMarvelousBridge('clo', { scriptsDirs: [scriptsDir], port: 7452 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, CLO_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7452');
    expect(readFileSync(join(scriptsDir, CLO_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('HOST_ID = "clo"');
    const un = uninstallCloMarvelousBridge('clo', { scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, CLO_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls RizomUV Lua script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('rizomuv-scripts-');
    const inst = installRizomUvBridge({ scriptsDirs: [scriptsDir], port: 7462 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, RIZOMUV_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('port = 7462');
    expect(readFileSync(join(scriptsDir, RIZOMUV_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('host":"rizomuv');
    const un = uninstallRizomUvBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, RIZOMUV_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Daz Studio DzScript bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('daz-studio-scripts-');
    const inst = installDazStudioBridge({ scriptsDirs: [scriptsDir], port: 7502 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, DAZ_STUDIO_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('"port":7502');
    expect(readFileSync(join(scriptsDir, DAZ_STUDIO_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('daz-studio');
    const un = uninstallDazStudioBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, DAZ_STUDIO_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Poser Python ScriptsMenu bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('poser-scripts-menu-');
    const inst = installPoserBridge({ scriptsDirs: [scriptsDir], port: 7512 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, POSER_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7512');
    expect(readFileSync(join(scriptsDir, POSER_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('"host": "poser"');
    const un = uninstallPoserBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, POSER_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls iClone OpenPlugin Python bridge', () => {
    useSandbox();
    const openPluginDir = tempDir('iclone-openplugin-');
    const inst = installReallusionBridge('iclone', { scriptsDirs: [openPluginDir], port: 7522 });
    expect(inst.ok).toBe(true);
    const pluginDir = join(openPluginDir, REALLUSION_BRIDGE_PLUGIN_DIR_NAME);
    const scriptPath = join(pluginDir, REALLUSION_BRIDGE_SCRIPT_NAME);
    expect(readFileSync(scriptPath, 'utf8')).toContain('PORT = 7522');
    expect(readFileSync(scriptPath, 'utf8')).toContain('HOST_ID = "iclone"');
    const un = uninstallReallusionBridge('iclone', { scriptsDirs: [openPluginDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(pluginDir)).toBe(false);
  });

  it('installs and uninstalls Character Creator OpenPlugin Python bridge', () => {
    useSandbox();
    const openPluginDir = tempDir('character-creator-openplugin-');
    const inst = installReallusionBridge('character-creator', { scriptsDirs: [openPluginDir], port: 7532 });
    expect(inst.ok).toBe(true);
    const pluginDir = join(openPluginDir, REALLUSION_BRIDGE_PLUGIN_DIR_NAME);
    const scriptPath = join(pluginDir, REALLUSION_BRIDGE_SCRIPT_NAME);
    expect(readFileSync(scriptPath, 'utf8')).toContain('PORT = 7532');
    expect(readFileSync(scriptPath, 'utf8')).toContain('HOST_ID = "character-creator"');
    const un = uninstallReallusionBridge('character-creator', { scriptsDirs: [openPluginDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(pluginDir)).toBe(false);
  });

  it('installs and uninstalls Metashape autorun Python bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('metashape-scripts-');
    const inst = installMetashapeBridge({ scriptsDirs: [scriptsDir], port: 7542 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, METASHAPE_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7542');
    expect(readFileSync(join(scriptsDir, METASHAPE_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('"host": "metashape"');
    const un = uninstallMetashapeBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, METASHAPE_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls 3DEqualizer py_scripts Python bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('3dequalizer-py-scripts-');
    const inst = installThreeDequalizerBridge({ scriptsDirs: [scriptsDir], port: 7552 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, THREEDEQUALIZER_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7552');
    expect(readFileSync(join(scriptsDir, THREEDEQUALIZER_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('3DE4.script.name: AssetCutter Bridge');
    expect(readFileSync(join(scriptsDir, THREEDEQUALIZER_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('"host": "3dequalizer"');
    const un = uninstallThreeDequalizerBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, THREEDEQUALIZER_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Katana Startup bridge without deleting existing init content', () => {
    useSandbox();
    const resourceDir = tempDir('katana-resource-');
    mkdirSync(join(resourceDir, 'Startup'), { recursive: true });
    writeFileSync(join(resourceDir, 'Startup', 'init.py'), '# existing\n', 'utf8');
    const inst = installKatanaBridge({ scriptsDirs: [resourceDir], port: 7572 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(resourceDir, KATANA_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7572');
    const init = readFileSync(join(resourceDir, 'Startup', 'init.py'), 'utf8');
    expect(init).toContain('# existing');
    expect(init).toContain(KATANA_BRIDGE_MARKER_START);
    const un = uninstallKatanaBridge({ scriptsDirs: [resourceDir] });
    expect(un.removed[0]?.removed).toBe(true);
    expect(readFileSync(join(resourceDir, 'Startup', 'init.py'), 'utf8')).toContain('# existing');
    expect(readFileSync(join(resourceDir, 'Startup', 'init.py'), 'utf8')).not.toContain(KATANA_BRIDGE_MARKER_START);
    expect(existsSync(join(resourceDir, KATANA_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Lightroom Classic .lrplugin bridge', () => {
    useSandbox();
    const modulesDir = tempDir('lightroom-modules-');
    const inst = installLightroomBridge({ scriptsDirs: [modulesDir], port: 7562 });
    expect(inst.ok).toBe(true);
    const pluginDir = join(modulesDir, LIGHTROOM_BRIDGE_PLUGIN_DIR_NAME);
    expect(readFileSync(join(pluginDir, LIGHTROOM_BRIDGE_INFO_NAME), 'utf8')).toContain('LrPluginName');
    expect(readFileSync(join(pluginDir, LIGHTROOM_BRIDGE_INIT_NAME), 'utf8')).toContain('port = 7562');
    expect(readFileSync(join(pluginDir, LIGHTROOM_BRIDGE_INIT_NAME), 'utf8')).toContain('lightroom-classic');
    const un = uninstallLightroomBridge({ scriptsDirs: [modulesDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(pluginDir)).toBe(false);
  });

  it('installs and uninstalls darktable luarc bridge without deleting existing content', () => {
    useSandbox();
    const configDir = tempDir('darktable-config-');
    writeFileSync(join(configDir, DARKTABLE_LUARC_NAME), '-- existing\n', 'utf8');
    const inst = installDarktableBridge({ configDirs: [configDir], port: 7612 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(configDir, 'lua', DARKTABLE_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('7612');
    expect(readFileSync(join(configDir, 'lua', DARKTABLE_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('"host":"darktable"');
    const luarc = readFileSync(join(configDir, DARKTABLE_LUARC_NAME), 'utf8');
    expect(luarc).toContain('-- existing');
    expect(luarc).toContain(DARKTABLE_BRIDGE_MARKER_START);
    const un = uninstallDarktableBridge({ configDirs: [configDir] });
    expect(un.removed[0]?.removed).toBe(true);
    expect(readFileSync(join(configDir, DARKTABLE_LUARC_NAME), 'utf8')).toContain('-- existing');
    expect(readFileSync(join(configDir, DARKTABLE_LUARC_NAME), 'utf8')).not.toContain(DARKTABLE_BRIDGE_MARKER_START);
    expect(existsSync(join(configDir, 'lua', DARKTABLE_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls DaVinci Resolve script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('resolve-scripts-');
    const inst = installDavinciResolveBridge({ scriptsDirs: [scriptsDir], port: 7072 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, DAVINCI_RESOLVE_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7072');
    const un = uninstallDavinciResolveBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, DAVINCI_RESOLVE_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Fusion Studio script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('fusion-studio-scripts-');
    const inst = installFusionStudioBridge({ scriptsDirs: [scriptsDir], port: 7392 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, FUSION_STUDIO_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7392');
    expect(readFileSync(join(scriptsDir, FUSION_STUDIO_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('fusion-studio');
    const un = uninstallFusionStudioBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, FUSION_STUDIO_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Nuke init bridge without deleting existing content', () => {
    useSandbox();
    const userDir = tempDir('nuke-user-');
    writeFileSync(join(userDir, 'init.py'), '# existing\n', 'utf8');
    const inst = installNukeBridge({ userDirs: [userDir], port: 7052 });
    expect(inst.ok).toBe(true);
    expect(existsSync(join(userDir, NUKE_BRIDGE_PY_NAME))).toBe(true);
    const init = readFileSync(join(userDir, 'init.py'), 'utf8');
    expect(init).toContain('# existing');
    expect(init).toContain(NUKE_BRIDGE_MARKER_START);
    const un = uninstallNukeBridge({ userDirs: [userDir] });
    expect(un.removed[0]?.removed).toBe(true);
    expect(readFileSync(join(userDir, 'init.py'), 'utf8')).toContain('# existing');
    expect(readFileSync(join(userDir, 'init.py'), 'utf8')).not.toContain(NUKE_BRIDGE_MARKER_START);
  });

  it('maps a manually selected Nuke install folder to the writable .nuke folder', () => {
    useSandbox();
    const home = tempDir('nuke-home-');
    const installRoot = join(tempDir('foundry-program-files-'), 'Nuke15.1v2');
    mkdirSync(installRoot, { recursive: true });
    const expectedUserDir = join(home, '.nuke');
    const inst = installNukeBridge({ userDirs: [installRoot], home, port: 7053 });
    expect(inst.ok).toBe(true);
    expect(existsSync(join(expectedUserDir, NUKE_BRIDGE_PY_NAME))).toBe(true);
    expect(existsSync(join(installRoot, NUKE_BRIDGE_PY_NAME))).toBe(false);
    const custom = readCustomHostTargetsForHost('nuke');
    expect(custom.length).toBe(1);
    expect(custom[0].inputPath).toBe(installRoot);
    expect(custom[0].resolvedPath).toBe(expectedUserDir);
    expect(custom[0].targetKind).toBe('install_dir');
    expect(custom[0].versionHint).toBe('15.1v2');
    expect(discoverNukeBridgeTargets({ home }).some((item) => item.userDir === expectedUserDir)).toBe(true);
  });

  it('installs and uninstalls Nuke Studio Foundry init bridge without deleting existing content', () => {
    useSandbox();
    const userDir = tempDir('nuke-studio-user-');
    writeFileSync(join(userDir, FOUNDRY_TIMELINE_INIT_PY_NAME), '# existing\n', 'utf8');
    const inst = installFoundryTimelineBridge('nuke-studio', { userDirs: [userDir], port: 7582 });
    expect(inst.ok).toBe(true);
    expect(existsSync(join(userDir, NUKE_STUDIO_BRIDGE_PY_NAME))).toBe(true);
    expect(readFileSync(join(userDir, NUKE_STUDIO_BRIDGE_PY_NAME), 'utf8')).toContain('PORT = 7582');
    expect(readFileSync(join(userDir, NUKE_STUDIO_BRIDGE_PY_NAME), 'utf8')).toContain('nuke-studio');
    const init = readFileSync(join(userDir, FOUNDRY_TIMELINE_INIT_PY_NAME), 'utf8');
    expect(init).toContain('# existing');
    expect(init).toContain('AssetCutter Nuke Studio Bridge');
    const un = uninstallFoundryTimelineBridge('nuke-studio', { userDirs: [userDir] });
    expect(un.removed[0]?.removed).toBe(true);
    expect(readFileSync(join(userDir, FOUNDRY_TIMELINE_INIT_PY_NAME), 'utf8')).toContain('# existing');
    expect(readFileSync(join(userDir, FOUNDRY_TIMELINE_INIT_PY_NAME), 'utf8')).not.toContain('AssetCutter Nuke Studio Bridge');
    expect(existsSync(join(userDir, NUKE_STUDIO_BRIDGE_PY_NAME))).toBe(false);
  });

  it('installs and uninstalls Hiero Foundry init bridge without deleting existing content', () => {
    useSandbox();
    const userDir = tempDir('hiero-user-');
    writeFileSync(join(userDir, FOUNDRY_TIMELINE_INIT_PY_NAME), '# existing\n', 'utf8');
    const inst = installFoundryTimelineBridge('hiero', { userDirs: [userDir], port: 7592 });
    expect(inst.ok).toBe(true);
    expect(existsSync(join(userDir, HIERO_BRIDGE_PY_NAME))).toBe(true);
    expect(readFileSync(join(userDir, HIERO_BRIDGE_PY_NAME), 'utf8')).toContain('PORT = 7592');
    expect(readFileSync(join(userDir, HIERO_BRIDGE_PY_NAME), 'utf8')).toContain('hiero');
    const init = readFileSync(join(userDir, FOUNDRY_TIMELINE_INIT_PY_NAME), 'utf8');
    expect(init).toContain('# existing');
    expect(init).toContain('AssetCutter Hiero Bridge');
    const un = uninstallFoundryTimelineBridge('hiero', { userDirs: [userDir] });
    expect(un.removed[0]?.removed).toBe(true);
    expect(readFileSync(join(userDir, FOUNDRY_TIMELINE_INIT_PY_NAME), 'utf8')).toContain('# existing');
    expect(readFileSync(join(userDir, FOUNDRY_TIMELINE_INIT_PY_NAME), 'utf8')).not.toContain('AssetCutter Hiero Bridge');
    expect(existsSync(join(userDir, HIERO_BRIDGE_PY_NAME))).toBe(false);
  });

  it('installs and uninstalls Natron initGui bridge without deleting existing content', () => {
    useSandbox();
    const userDir = tempDir('natron-user-');
    writeFileSync(join(userDir, 'initGui.py'), '# existing\n', 'utf8');
    const inst = installNatronBridge({ userDirs: [userDir], port: 7262 });
    expect(inst.ok).toBe(true);
    expect(existsSync(join(userDir, NATRON_BRIDGE_PY_NAME))).toBe(true);
    expect(readFileSync(join(userDir, NATRON_BRIDGE_PY_NAME), 'utf8')).toContain('PORT = 7262');
    const initGui = readFileSync(join(userDir, 'initGui.py'), 'utf8');
    expect(initGui).toContain('# existing');
    expect(initGui).toContain(NATRON_BRIDGE_MARKER_START);
    const un = uninstallNatronBridge({ userDirs: [userDir] });
    expect(un.removed[0]?.removed).toBe(true);
    expect(readFileSync(join(userDir, 'initGui.py'), 'utf8')).toContain('# existing');
    expect(readFileSync(join(userDir, 'initGui.py'), 'utf8')).not.toContain(NATRON_BRIDGE_MARKER_START);
    expect(existsSync(join(userDir, NATRON_BRIDGE_PY_NAME))).toBe(false);
  });

  it('maps a manually selected Natron install folder to the writable user folder', () => {
    useSandbox();
    const home = tempDir('natron-home-');
    const installRoot = join(tempDir('natron-program-files-'), 'Program Files', 'Natron 2.5');
    mkdirSync(installRoot, { recursive: true });
    const expectedUserDir = join(home, 'AppData', 'Roaming', 'Natron');
    const previousAppData = process.env.APPDATA;
    delete process.env.APPDATA;
    try {
      const inst = installNatronBridge({ userDirs: [installRoot], home, port: 7263 });
      expect(inst.ok).toBe(true);
      expect(existsSync(join(expectedUserDir, NATRON_BRIDGE_PY_NAME))).toBe(true);
      expect(existsSync(join(installRoot, NATRON_BRIDGE_PY_NAME))).toBe(false);
      const custom = readCustomHostTargetsForHost('natron');
      expect(custom.length).toBe(1);
      expect(custom[0].inputPath).toBe(installRoot);
      expect(custom[0].resolvedPath).toBe(expectedUserDir);
      expect(custom[0].targetKind).toBe('install_dir');
      expect(custom[0].versionHint).toBe('2.5');
      expect(discoverNatronBridgeTargets({ home }).some((item) => item.userDir === expectedUserDir)).toBe(true);
    } finally {
      if (previousAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = previousAppData;
    }
  });

  it('installs and uninstalls OBS Studio Lua script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('obs-scripts-');
    const inst = installObsStudioBridge({ scriptsDirs: [scriptsDir], port: 7352 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, OBS_STUDIO_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('port = 7352');
    expect(readFileSync(join(scriptsDir, OBS_STUDIO_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('obs-studio');
    const un = uninstallObsStudioBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, OBS_STUDIO_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls REAPER ReaScript Lua bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('reaper-scripts-');
    const inst = installReaperBridge({ scriptsDirs: [scriptsDir], port: 7362 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, REAPER_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('port = 7362');
    expect(readFileSync(join(scriptsDir, REAPER_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('host":"reaper');
    const un = uninstallReaperBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, REAPER_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls VEGAS Pro C# Script Menu bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('vegas-pro-script-menu-');
    const inst = installVegasProBridge({ scriptsDirs: [scriptsDir], port: 7472 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, VEGAS_PRO_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('int port = 7472');
    expect(readFileSync(join(scriptsDir, VEGAS_PRO_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('host\\":\\"vegas-pro');
    const un = uninstallVegasProBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, VEGAS_PRO_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Synfig Python plug-in bridge', () => {
    useSandbox();
    const pluginsDir = tempDir('synfig-plugins-');
    const inst = installSynfigBridge({ scriptsDirs: [pluginsDir], port: 7492 });
    expect(inst.ok).toBe(true);
    const pluginDir = join(pluginsDir, SYNFIG_BRIDGE_PLUGIN_DIR_NAME);
    expect(readFileSync(join(pluginDir, SYNFIG_BRIDGE_PLUGIN_XML_NAME), 'utf8')).toContain('AssetCutter Bridge');
    expect(readFileSync(join(pluginDir, SYNFIG_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7492');
    expect(readFileSync(join(pluginDir, SYNFIG_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('"host": "synfig"');
    const un = uninstallSynfigBridge({ scriptsDirs: [pluginsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(pluginDir)).toBe(false);
  });

  it.each([
    ['photoshop', 'AssetCutter Photoshop Bridge.jsx'],
    ['illustrator', 'AssetCutter Illustrator Bridge.jsx'],
    ['after-effects', 'assetcutter_after_effects_bridge.jsx'],
    ['premiere', 'assetcutter_premiere_bridge.jsx'],
    ['indesign', 'assetcutter_indesign_bridge.jsx'],
    ['audition', 'assetcutter_audition_bridge.jsx'],
    ['media-encoder', 'assetcutter_media_encoder_bridge.jsx'],
    ['animate', 'assetcutter_animate_bridge.jsx'],
    ['adobe-bridge', 'assetcutter_adobe_bridge_bridge.jsx'],
  ] as Array<[AdobeBridgeId, string]>)('installs and uninstalls Adobe bridge for %s', (id, scriptName) => {
    useSandbox();
    const scriptsDir = tempDir(`adobe-${id}-scripts-`);
    const inst = installAdobeBridge(id, { scriptsDirs: [scriptsDir], port: 7088 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, scriptName), 'utf8')).toContain('heartbeat');
    const un = uninstallAdobeBridge(id, { scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, scriptName))).toBe(false);
  });

  it('maps a manually selected Photoshop install folder to the writable user scripts folder', () => {
    useSandbox();
    const home = tempDir('adobe-home-');
    const installRoot = join(tempDir('program-files-adobe-'), 'Adobe', 'Adobe Photoshop 2026');
    mkdirSync(installRoot, { recursive: true });
    const expectedScripts = join(home, 'AppData', 'Roaming', 'Adobe', 'Adobe Photoshop 2026', 'Presets', 'Scripts');
    const inst = installAdobeBridge('photoshop', { scriptsDirs: [installRoot], home, port: 7089 });
    expect(inst.ok).toBe(true);
    expect(existsSync(join(expectedScripts, 'AssetCutter Photoshop Bridge.jsx'))).toBe(true);
    expect(existsSync(join(installRoot, 'AssetCutter Photoshop Bridge.jsx'))).toBe(false);
    const custom = readCustomHostTargetsForHost('photoshop');
    expect(custom.length).toBe(1);
    expect(custom[0].inputPath).toBe(installRoot);
    expect(custom[0].resolvedPath).toBe(expectedScripts);
    expect(custom[0].targetKind).toBe('install_dir');
    expect(custom[0].versionHint).toBe('2026');
    const rediscovered = discoverAdobeBridgeTargets('photoshop', { home });
    expect(rediscovered.some((item) => item.scriptsDir === expectedScripts)).toBe(true);
  });

  it('maps a manually selected Adobe roaming root to the newest Photoshop Presets Scripts folder', () => {
    useSandbox();
    const home = tempDir('adobe-root-home-');
    const adobeRoot = join(home, 'AppData', 'Roaming', 'Adobe');
    const oldPresetRoot = join(adobeRoot, 'Adobe Photoshop 2025', 'Presets');
    const newestPresetRoot = join(adobeRoot, 'Adobe Photoshop 2026', 'Presets');
    mkdirSync(oldPresetRoot, { recursive: true });
    mkdirSync(newestPresetRoot, { recursive: true });
    const inst = installAdobeBridge('photoshop', { scriptsDirs: [adobeRoot], home, port: 7090 });
    const expectedScripts = join(newestPresetRoot, 'Scripts');
    expect(inst.ok).toBe(true);
    expect(existsSync(join(expectedScripts, 'AssetCutter Photoshop Bridge.jsx'))).toBe(true);
    expect(existsSync(join(adobeRoot, 'AssetCutter Photoshop Bridge.jsx'))).toBe(false);
    const rediscovered = discoverAdobeBridgeTargets('photoshop', { home });
    expect(rediscovered.some((item) => item.scriptsDir === expectedScripts)).toBe(true);
    expect(rediscovered.some((item) => item.scriptsDir === adobeRoot)).toBe(false);
  });

  it('ignores stale Photoshop jsx files in the Adobe roaming root during discovery', () => {
    useSandbox();
    const home = tempDir('adobe-stale-home-');
    const adobeRoot = join(home, 'AppData', 'Roaming', 'Adobe');
    const expectedScripts = join(adobeRoot, 'Adobe Photoshop 2025', 'Presets', 'Scripts');
    mkdirSync(expectedScripts, { recursive: true });
    writeFileSync(join(adobeRoot, 'assetcutter_photoshop_bridge.jsx'), '// stale wrong install\n', 'utf8');
    const targets = discoverAdobeBridgeTargets('photoshop', { home });
    expect(targets.some((item) => item.scriptsDir === expectedScripts)).toBe(true);
    expect(targets.some((item) => /assetcutter_photoshop_bridge\.jsx/i.test(item.scriptsDir))).toBe(false);
  });

  it('installs and uninstalls Inkscape extension bridge', () => {
    useSandbox();
    const extensionsDir = tempDir('inkscape-extensions-');
    const inst = installInkscapeBridge({ extensionsDirs: [extensionsDir], port: 7242 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(extensionsDir, INKSCAPE_BRIDGE_INX_NAME), 'utf8')).toContain('AssetCutter Bridge');
    expect(readFileSync(join(extensionsDir, INKSCAPE_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7242');
    const un = uninstallInkscapeBridge({ extensionsDirs: [extensionsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(extensionsDir, INKSCAPE_BRIDGE_INX_NAME))).toBe(false);
    expect(existsSync(join(extensionsDir, INKSCAPE_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Unity Editor bridge', () => {
    useSandbox();
    const projectDir = tempDir('unity-project-');
    mkdirSync(join(projectDir, 'Assets'), { recursive: true });
    const inst = installUnityBridge({ projectDirs: [projectDir], port: 7112 });
    expect(inst.ok).toBe(true);
    const scriptPath = join(projectDir, 'Assets', 'Editor', UNITY_BRIDGE_SCRIPT_NAME);
    expect(readFileSync(scriptPath, 'utf8')).toContain('const int Port = 7112');
    const un = uninstallUnityBridge({ projectDirs: [projectDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(scriptPath)).toBe(false);
  });

  it('persists a manually selected Unity project and rejects non-project folders', () => {
    useSandbox();
    const projectDir = tempDir('unity-manual-project-');
    mkdirSync(join(projectDir, 'Assets'), { recursive: true });
    const inst = installUnityBridge({ projectDirs: [projectDir], port: 7113 });
    expect(inst.ok).toBe(true);
    const custom = readCustomHostTargetsForHost('unity');
    expect(custom.length).toBe(1);
    expect(custom[0].resolvedPath).toBe(projectDir);
    expect(custom[0].targetKind).toBe('project_dir');
    expect(discoverUnityBridgeTargets().some((item) => item.projectDir === projectDir)).toBe(true);

    const installDir = tempDir('unity-editor-install-');
    const bad = installUnityBridge({ projectDirs: [installDir], port: 7114 });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('invalid_unity_project_dir');
    expect(existsSync(join(installDir, 'Assets', 'Editor', UNITY_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('corrects Unity manual selections from project subfolders to the project root', () => {
    useSandbox();
    const projectDir = tempDir('unity-subfolder-project-');
    const editorDir = join(projectDir, 'Assets', 'Editor');
    mkdirSync(editorDir, { recursive: true });
    const inst = installUnityBridge({ projectDirs: [editorDir], port: 7115 });
    expect(inst.ok).toBe(true);
    const custom = readCustomHostTargetsForHost('unity');
    expect(custom[0].inputPath).toBe(editorDir);
    expect(custom[0].resolvedPath).toBe(projectDir);
    expect(existsSync(join(projectDir, 'Assets', 'Editor', UNITY_BRIDGE_SCRIPT_NAME))).toBe(true);
  });

  it('installs and uninstalls Unreal project plugin bridge', () => {
    useSandbox();
    const projectDir = tempDir('unreal-project-');
    writeFileSync(join(projectDir, 'Demo.uproject'), '{}', 'utf8');
    const inst = installUnrealBridge({ projectDirs: [projectDir], port: 7132 });
    expect(inst.ok).toBe(true);
    const upluginPath = join(projectDir, 'Plugins', UNREAL_PLUGIN_NAME, `${UNREAL_PLUGIN_NAME}.uplugin`);
    const pythonPath = join(projectDir, 'Plugins', UNREAL_PLUGIN_NAME, 'Content', 'Python', 'init_unreal.py');
    expect(readFileSync(upluginPath, 'utf8')).toContain('PythonScriptPlugin');
    expect(readFileSync(pythonPath, 'utf8')).toContain('PORT = 7132');
    const un = uninstallUnrealBridge({ projectDirs: [projectDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(upluginPath)).toBe(false);
    expect(existsSync(pythonPath)).toBe(false);
  });

  it('persists manually selected Unreal projects and engine folders', () => {
    useSandbox();
    const projectDir = tempDir('unreal-manual-project-');
    writeFileSync(join(projectDir, 'Demo.uproject'), '{}', 'utf8');
    const inst = installUnrealBridge({ projectDirs: [projectDir], port: 7133 });
    expect(inst.ok).toBe(true);
    const custom = readCustomHostTargetsForHost('unreal');
    expect(custom.length).toBe(1);
    expect(custom[0].resolvedPath).toBe(projectDir);
    expect(custom[0].targetKind).toBe('project_dir');
    expect(discoverUnrealBridgeTargets().some((item) => item.projectDir === projectDir)).toBe(true);

    const engineDir = tempDir('unreal-engine-install-');
    mkdirSync(join(engineDir, 'Engine', 'Binaries', 'Win64'), { recursive: true });
    writeFileSync(join(engineDir, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe'), '', 'utf8');
    const engineInst = installUnrealBridge({ projectDirs: [engineDir], port: 7134 });
    expect(engineInst.ok).toBe(true);
    if (!engineInst.ok) throw new Error(engineInst.error);
    expect(engineInst.installed[0]).toMatchObject({ targetKind: 'engine_dir', engineDir });
    const enginePluginDir = join(engineDir, 'Engine', 'Plugins', 'Marketplace', UNREAL_PLUGIN_NAME);
    expect(readFileSync(join(enginePluginDir, `${UNREAL_PLUGIN_NAME}.uplugin`), 'utf8')).toContain('PythonScriptPlugin');
    expect(readFileSync(join(enginePluginDir, 'Content', 'Python', 'init_unreal.py'), 'utf8')).toContain('PORT = 7134');
    const customAfterEngine = readCustomHostTargetsForHost('unreal');
    expect(customAfterEngine.some((item) => item.resolvedPath === engineDir && item.targetKind === 'engine_dir')).toBe(true);
    expect(discoverUnrealBridgeTargets().some((item) => item.engineDir === engineDir)).toBe(true);

    const un = uninstallUnrealBridge({ projectDirs: [engineDir] });
    expect(un.removed[0]).toMatchObject({ targetKind: 'engine_dir', engineDir });
    expect(existsSync(join(enginePluginDir, `${UNREAL_PLUGIN_NAME}.uplugin`))).toBe(false);
    expect(existsSync(join(enginePluginDir, 'Content', 'Python', 'init_unreal.py'))).toBe(false);
  });

  it('rejects invalid Unreal folders that are neither projects nor engine installs', () => {
    useSandbox();
    const badDir = tempDir('unreal-invalid-install-');
    const bad = installUnrealBridge({ projectDirs: [badDir], port: 7134 });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('invalid_unreal_install_target');
    expect(existsSync(join(badDir, 'Plugins', UNREAL_PLUGIN_NAME))).toBe(false);
  });

  it('corrects Unreal manual selections from project files and subfolders to the project root', () => {
    useSandbox();
    const projectDir = tempDir('unreal-subfolder-project-');
    const contentDir = join(projectDir, 'Content', 'Maps');
    mkdirSync(contentDir, { recursive: true });
    const uprojectPath = join(projectDir, 'Demo.uproject');
    writeFileSync(uprojectPath, '{}', 'utf8');
    const fromFile = installUnrealBridge({ projectDirs: [uprojectPath], port: 7135 });
    expect(fromFile.ok).toBe(true);
    const fromSubdir = installUnrealBridge({ projectDirs: [contentDir], port: 7136 });
    expect(fromSubdir.ok).toBe(true);
    const custom = readCustomHostTargetsForHost('unreal');
    expect(custom.length).toBe(1);
    expect(custom[0].resolvedPath).toBe(projectDir);
    expect(existsSync(join(projectDir, 'Plugins', UNREAL_PLUGIN_NAME, `${UNREAL_PLUGIN_NAME}.uplugin`))).toBe(true);
  });

  it('installs and uninstalls Rhino script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('rhino-scripts-');
    const inst = installRhinoBridge({ scriptsDirs: [scriptsDir], port: 7142 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, RHINO_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7142');
    const un = uninstallRhinoBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, RHINO_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls SketchUp Ruby plugin bridge', () => {
    useSandbox();
    const pluginDir = tempDir('sketchup-plugins-');
    const inst = installSketchUpBridge({ pluginDirs: [pluginDir], port: 7152 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(pluginDir, SKETCHUP_BRIDGE_PLUGIN_NAME), 'utf8')).toContain('PORT = 7152');
    const un = uninstallSketchUpBridge({ pluginDirs: [pluginDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(pluginDir, SKETCHUP_BRIDGE_PLUGIN_NAME))).toBe(false);
  });

  it('installs and uninstalls Godot EditorPlugin bridge', () => {
    useSandbox();
    const projectDir = tempDir('godot-project-');
    writeFileSync(join(projectDir, 'project.godot'), '; Engine configuration file.\n', 'utf8');
    const inst = installGodotBridge({ projectDirs: [projectDir], port: 7172 });
    expect(inst.ok).toBe(true);
    const pluginDir = join(projectDir, 'addons', 'assetcutter_bridge');
    expect(readFileSync(join(pluginDir, GODOT_PLUGIN_CFG_NAME), 'utf8')).toContain('AssetCutter Bridge');
    expect(readFileSync(join(pluginDir, GODOT_PLUGIN_SCRIPT_NAME), 'utf8')).toContain('const PORT := 7172');
    const un = uninstallGodotBridge({ projectDirs: [projectDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(pluginDir)).toBe(false);
  });

  it('persists a manually selected Godot project and rejects editor folders', () => {
    useSandbox();
    const projectDir = tempDir('godot-manual-project-');
    writeFileSync(join(projectDir, 'project.godot'), '[application]\n', 'utf8');
    const inst = installGodotBridge({ projectDirs: [projectDir], port: 7173 });
    expect(inst.ok).toBe(true);
    const custom = readCustomHostTargetsForHost('godot');
    expect(custom.length).toBe(1);
    expect(custom[0].resolvedPath).toBe(projectDir);
    expect(custom[0].targetKind).toBe('project_dir');
    expect(discoverGodotBridgeTargets().some((item) => item.projectDir === projectDir)).toBe(true);

    const editorDir = tempDir('godot-editor-install-');
    const bad = installGodotBridge({ projectDirs: [editorDir], port: 7174 });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('invalid_godot_project_dir');
    expect(existsSync(join(editorDir, 'addons', 'assetcutter_bridge'))).toBe(false);
  });

  it('installs and uninstalls MotionBuilder PythonStartup bridge', () => {
    useSandbox();
    const startupDir = tempDir('motionbuilder-startup-');
    const inst = installMotionBuilderBridge({ startupDirs: [startupDir], port: 7182 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(startupDir, MOTIONBUILDER_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7182');
    const un = uninstallMotionBuilderBridge({ startupDirs: [startupDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(startupDir, MOTIONBUILDER_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Fusion 360 API AddIn bridge', () => {
    useSandbox();
    const addinsDir = tempDir('fusion-addins-');
    const inst = installFusion360Bridge({ addinsDirs: [addinsDir], port: 7192 });
    expect(inst.ok).toBe(true);
    const addinDir = join(addinsDir, FUSION360_ADDIN_NAME);
    expect(readFileSync(join(addinDir, FUSION360_ADDIN_SCRIPT_NAME), 'utf8')).toContain('PORT = 7192');
    expect(readFileSync(join(addinDir, FUSION360_ADDIN_MANIFEST_NAME), 'utf8')).toContain('Fusion360');
    const un = uninstallFusion360Bridge({ addinsDirs: [addinsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(addinDir)).toBe(false);
  });

  it('installs and uninstalls KeyShot script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('keyshot-scripts-');
    const inst = installKeyShotBridge({ scriptsDirs: [scriptsDir], port: 7202 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, KEYSHOT_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7202');
    const un = uninstallKeyShotBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, KEYSHOT_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Marmoset Toolbag script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('marmoset-toolbag-scripts-');
    const inst = installMarmosetToolbagBridge({ scriptsDirs: [scriptsDir], port: 7212 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, MARMOSET_TOOLBAG_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7212');
    const un = uninstallMarmosetToolbagBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, MARMOSET_TOOLBAG_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls Modo script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('modo-scripts-');
    const inst = installModoBridge({ scriptsDirs: [scriptsDir], port: 7272 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, MODO_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7272');
    expect(readFileSync(join(scriptsDir, MODO_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('Modo Bridge');
    const un = uninstallModoBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, MODO_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls LightWave script bridge', () => {
    useSandbox();
    const scriptsDir = tempDir('lightwave-scripts-');
    const inst = installLightWaveBridge({ scriptsDirs: [scriptsDir], port: 7282 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(scriptsDir, LIGHTWAVE_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('PORT = 7282');
    expect(readFileSync(join(scriptsDir, LIGHTWAVE_BRIDGE_SCRIPT_NAME), 'utf8')).toContain('LightWave Bridge');
    const un = uninstallLightWaveBridge({ scriptsDirs: [scriptsDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(join(scriptsDir, LIGHTWAVE_BRIDGE_SCRIPT_NAME))).toBe(false);
  });

  it('installs and uninstalls FreeCAD Workbench bridge', () => {
    useSandbox();
    const modDir = tempDir('freecad-mod-');
    const inst = installFreeCADBridge({ modDirs: [modDir], port: 7292 });
    expect(inst.ok).toBe(true);
    const workbenchDir = join(modDir, FREECAD_WORKBENCH_NAME);
    expect(readFileSync(join(workbenchDir, FREECAD_INIT_GUI_NAME), 'utf8')).toContain('PORT = 7292');
    expect(readFileSync(join(workbenchDir, FREECAD_INIT_GUI_NAME), 'utf8')).toContain('FreeCAD Bridge');
    const un = uninstallFreeCADBridge({ modDirs: [modDir] });
    expect(un.removed.length).toBe(1);
    expect(existsSync(workbenchDir)).toBe(false);
  });

  it('installs and uninstalls AutoCAD AutoLISP bridge without deleting existing acaddoc content', () => {
    useSandbox();
    const supportDir = tempDir('autocad-support-');
    writeFileSync(join(supportDir, AUTOCAD_ACADDOC_NAME), '; existing\n', 'latin1');
    const inst = installAutoCADBridge({ scriptsDirs: [supportDir], port: 7372 });
    expect(inst.ok).toBe(true);
    expect(readFileSync(join(supportDir, AUTOCAD_BRIDGE_SCRIPT_NAME), 'latin1')).toContain('\\"host\\":\\"autocad\\"');
    expect(readFileSync(join(supportDir, AUTOCAD_BRIDGE_SCRIPT_NAME), 'latin1')).toContain('port\\":7372');
    const acaddoc = readFileSync(join(supportDir, AUTOCAD_ACADDOC_NAME), 'latin1');
    expect(acaddoc).toContain('; existing');
    expect(acaddoc).toContain(AUTOCAD_BRIDGE_MARKER_START);
    const un = uninstallAutoCADBridge({ scriptsDirs: [supportDir] });
    expect(un.removed[0]?.removed).toBe(true);
    expect(readFileSync(join(supportDir, AUTOCAD_ACADDOC_NAME), 'latin1')).toContain('; existing');
    expect(readFileSync(join(supportDir, AUTOCAD_ACADDOC_NAME), 'latin1')).not.toContain(AUTOCAD_BRIDGE_MARKER_START);
    expect(existsSync(join(supportDir, AUTOCAD_BRIDGE_SCRIPT_NAME))).toBe(false);
  });
});
