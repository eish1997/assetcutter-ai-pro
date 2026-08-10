import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listBridgesCatalog } from '../local-companion/src/bridges/mayaBridgeInstall.ts';
import {
  HOST_BRIDGE_DEFINITIONS,
  hostBridgeDefinitionToCatalogEntry,
} from '../local-companion/src/bridges/definitions/hostBridgeDefinitions.ts';
import { getHostBridgeTemplate } from '../local-companion/src/bridges/templates/hostBridgeTemplates.ts';

const HOST_IDS = [
  'maya',
  'blender',
  '3ds-max',
  'cinema-4d',
  'houdini',
  'zbrush',
  'substance-painter',
  'substance-designer',
  'mari',
  'krita',
  'gimp',
  'aseprite',
  'moho',
  'toon-boom-harmony',
  'opentoonz',
  'cavalry',
  'tvpaint',
  'rhino',
  'sketchup',
  'marvelous-designer',
  'clo',
  'rizomuv',
  'daz-studio',
  'poser',
  'iclone',
  'character-creator',
  'metashape',
  '3dequalizer',
  'katana',
  'unreal',
  'motionbuilder',
  'godot',
  'fusion-360',
  'keyshot',
  'marmoset-toolbag',
  'unity',
  'modo',
  'lightwave',
  'freecad',
  'autocad',
  'photoshop',
  'illustrator',
  'inkscape',
  'after-effects',
  'premiere',
  'indesign',
  'audition',
  'media-encoder',
  'animate',
  'adobe-bridge',
  'lightroom-classic',
  'darktable',
  'davinci-resolve',
  'fusion-studio',
  'nuke',
  'nuke-studio',
  'hiero',
  'natron',
  'obs-studio',
  'reaper',
  'vegas-pro',
  'synfig',
] as const;

const DIRECT_ENDPOINT_HOSTS = [
  'maya',
  'blender',
  '3ds-max',
  'cinema-4d',
  'houdini',
  'zbrush',
  'substance-painter',
  'substance-designer',
  'mari',
  'krita',
  'gimp',
  'aseprite',
  'moho',
  'toon-boom-harmony',
  'opentoonz',
  'cavalry',
  'tvpaint',
  'rhino',
  'sketchup',
  'rizomuv',
  'daz-studio',
  'poser',
  'metashape',
  '3dequalizer',
  'katana',
  'unreal',
  'motionbuilder',
  'godot',
  'fusion-360',
  'keyshot',
  'marmoset-toolbag',
  'unity',
  'modo',
  'lightwave',
  'freecad',
  'autocad',
  'inkscape',
  'lightroom-classic',
  'darktable',
  'davinci-resolve',
  'fusion-studio',
  'nuke',
  'natron',
  'obs-studio',
  'reaper',
  'vegas-pro',
  'synfig',
] as const;

describe('host bridge catalog consistency', () => {
  it('keeps sample host bridge definitions complete and catalog-compatible', () => {
    const legalCategories = new Set(['3d', 'engine', 'paint', 'post', 'compositing']);
    const ids = new Set<string>();
    expect(HOST_BRIDGE_DEFINITIONS.map((def) => def.id)).toEqual([
      'blender',
      'photoshop',
      'illustrator',
      'after-effects',
      'premiere',
      'indesign',
      'audition',
      'media-encoder',
      'animate',
      'adobe-bridge',
      'darktable',
      'unity',
      'godot',
      'unreal',
      'zbrush',
      'cinema-4d',
      'houdini',
      'nuke',
      'motionbuilder',
      'fusion-360',
      'keyshot',
      'modo',
      'lightwave',
      'freecad',
      '3dequalizer',
      'katana',
      'autocad',
      'lightroom-classic',
      'obs-studio',
      'reaper',
      '3ds-max',
      'substance-painter',
      'substance-designer',
      'mari',
      'krita',
      'gimp',
      'rhino',
      'sketchup',
      'marmoset-toolbag',
      'natron',
      'aseprite',
      'moho',
      'toon-boom-harmony',
      'opentoonz',
      'cavalry',
      'tvpaint',
      'inkscape',
      'vegas-pro',
      'synfig',
      'maya',
      'marvelous-designer',
      'clo',
      'rizomuv',
      'daz-studio',
      'poser',
      'iclone',
      'character-creator',
      'metashape',
      'davinci-resolve',
      'fusion-studio',
      'nuke-studio',
      'hiero',
    ]);
    for (const def of HOST_BRIDGE_DEFINITIONS) {
      expect(ids.has(def.id)).toBe(false);
      ids.add(def.id);
      expect(legalCategories.has(def.category)).toBe(true);
      expect(def.defaultPort).toBeGreaterThan(0);
      expect(def.defaultPort).toBeLessThanOrEqual(65535);
      expect(def.detection.length).toBeGreaterThan(0);
      expect(def.manualTarget.accepts.length).toBeGreaterThan(0);
      expect(def.manualTarget.resolver).toBeTruthy();
      expect(getHostBridgeTemplate(def.bridgeTemplate.id)?.id).toBe(def.bridgeTemplate.id);
      expect(def.bridgeTemplate.entryFile).toBeTruthy();
      expect(def.probe.kind === 'http' || def.probe.kind === 'heartbeat' || def.probe.kind === 'command_port').toBe(true);
      expect(def.uninstall.generatedFiles.length).toBeGreaterThan(0);
      expect(def.ui.description).toBeTruthy();
      expect(def.ui.tags.length).toBeGreaterThan(0);
      expect(def.ui.actions).toContain('One-click install');
      expect(def.ui.actions).toContain('Probe connection');
      const entry = hostBridgeDefinitionToCatalogEntry(def);
      expect(entry.id).toBe(def.id);
      expect(entry.connector).toBe(def.connectorLabel);
      expect(entry.installMode).toBe('one_click');
      expect(entry.status).toBe('ready');
    }
    const byId = new Map(HOST_BRIDGE_DEFINITIONS.map((def) => [def.id, def]));
    for (const id of ['unity', 'godot', 'unreal', 'fusion-360', 'freecad']) {
      expect(byId.get(id)?.bridgeTemplate.id).toBe('project_plugin');
      expect(byId.get(id)?.probe.kind).toBe('http');
    }
    for (const id of ['unity', 'godot', 'unreal']) {
      expect(byId.get(id)?.manualTarget.accepts).toEqual(['project_dir']);
    }
    expect(byId.get('zbrush')?.bridgeTemplate.id).toBe('manual_script_dir');
    expect(byId.get('zbrush')?.manualTarget.accepts).toEqual(['script_dir', 'plugin_dir']);
    expect(byId.get('zbrush')?.probe.kind).toBe('heartbeat');
    for (const id of ['3dequalizer', 'katana', 'autocad']) {
      expect(byId.get(id)?.bridgeTemplate.id).toBe('manual_script_dir');
      expect(byId.get(id)?.probe.kind).toBe('heartbeat');
    }
    expect(byId.get('maya')?.bridgeTemplate.id).toBe('maya_command_port');
    expect(byId.get('maya')?.probe.kind).toBe('command_port');
    for (const id of ['darktable', 'lightroom-classic', 'obs-studio', 'reaper', 'aseprite', 'moho', 'rizomuv']) {
      expect(byId.get(id)?.bridgeTemplate.id).toBe('lua_heartbeat');
      expect(byId.get(id)?.probe.kind).toBe('heartbeat');
    }
    for (const id of [
      'toon-boom-harmony',
      'opentoonz',
      'cavalry',
      'tvpaint',
      'vegas-pro',
      'synfig',
      'marvelous-designer',
      'clo',
      'daz-studio',
      'poser',
      'iclone',
      'character-creator',
      'metashape',
    ]) {
      expect(byId.get(id)?.bridgeTemplate.id).toBe('manual_script_dir');
      expect(byId.get(id)?.probe.kind).toBe('heartbeat');
    }
    for (const id of ['photoshop', 'illustrator', 'after-effects', 'premiere', 'indesign', 'audition', 'media-encoder', 'animate', 'adobe-bridge']) {
      expect(byId.get(id)?.bridgeTemplate.id).toBe('extendscript_heartbeat');
      expect(byId.get(id)?.probe.kind).toBe('heartbeat');
    }
    for (const id of [
      'blender',
      'cinema-4d',
      'houdini',
      'nuke',
      'motionbuilder',
      'keyshot',
      'modo',
      'lightwave',
      '3ds-max',
      'substance-painter',
      'substance-designer',
      'mari',
      'krita',
      'gimp',
      'rhino',
      'sketchup',
      'marmoset-toolbag',
      'natron',
      'inkscape',
      'davinci-resolve',
      'fusion-studio',
      'nuke-studio',
      'hiero',
    ]) {
      expect(byId.get(id)?.bridgeTemplate.id).toBe('python_http_startup');
      expect(byId.get(id)?.probe.kind).toBe('http');
      expect(byId.get(id)?.probe).toMatchObject({ path: '/health' });
    }
  });

  it('keeps every productized host ready and one-click installable', () => {
    const catalog = listBridgesCatalog();
    expect(catalog.map((x) => x.id)).toEqual([...HOST_IDS]);
    expect(catalog).toHaveLength(62);
    expect(catalog.every((x) => x.status === 'ready')).toBe(true);
    expect(catalog.every((x) => x.installMode === 'one_click')).toBe(true);
    expect(catalog.every((x) => x.actions.includes('One-click install'))).toBe(true);
    expect(catalog.every((x) => x.actions.includes('Probe connection'))).toBe(true);
    expect(catalog.every((x) => !/planned/i.test(x.description + ' ' + x.connector))).toBe(true);
  });

  it('keeps status, install, uninstall routes for every real host', () => {
    const http = readFileSync(join(process.cwd(), 'local-companion/src/httpHandler.ts'), 'utf8');
    for (const id of DIRECT_ENDPOINT_HOSTS) {
      expect(http).toContain(`path === '/v1/bridges/${id}'`);
      expect(http).toContain(`path === '/v1/bridges/${id}/install'`);
      expect(http).toContain(`path === '/v1/bridges/${id}/uninstall'`);
    }
    expect(http).toContain('const acceptance = readHostBridgeAcceptance()');
    expect(http).toContain('acceptanceSummary: buildHostBridgeAcceptanceSummary(acceptance)');
    expect(http).toContain("/^\\/v1\\/bridges\\/([^/]+)\\/acceptance$/");
    expect(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).toContain('host-bridges:acceptance:record');
    expect(readFileSync(join(process.cwd(), 'scripts/check-host-bridge-acceptance.mjs'), 'utf8')).toContain('acceptanceSummary');
    expect(readFileSync(join(process.cwd(), 'scripts/record-host-bridge-acceptance.mjs'), 'utf8')).toContain('/acceptance');
    expect(http).toContain("photoshop|illustrator|after-effects|premiere|indesign|audition|media-encoder|animate|adobe-bridge");
    expect(http).toContain("path === '/v1/bridges/marvelous-designer' || path === '/v1/bridges/clo'");
    expect(http).toContain("/^\\/v1\\/bridges\\/(marvelous-designer|clo)\\/install$/");
    expect(http).toContain("/^\\/v1\\/bridges\\/(marvelous-designer|clo)\\/uninstall$/");
    expect(http).toContain("path === '/v1/bridges/iclone' || path === '/v1/bridges/character-creator'");
    expect(http).toContain("/^\\/v1\\/bridges\\/(iclone|character-creator)\\/install$/");
    expect(http).toContain("/^\\/v1\\/bridges\\/(iclone|character-creator)\\/uninstall$/");
    expect(http).toContain("path === '/v1/bridges/nuke-studio' || path === '/v1/bridges/hiero'");
    expect(http).toContain("/^\\/v1\\/bridges\\/(nuke-studio|hiero)\\/install$/");
    expect(http).toContain("/^\\/v1\\/bridges\\/(nuke-studio|hiero)\\/uninstall$/");
    for (const id of ['photoshop', 'illustrator', 'after-effects', 'premiere', 'indesign', 'audition', 'media-encoder', 'animate', 'adobe-bridge']) {
      expect(http).toContain(`path === '/v1/bridges/${id}'`);
    }
  });

  it('renders real cards for all hosts without the legacy Unreal placeholder', () => {
    const bridges = readFileSync(join(process.cwd(), 'companion-desktop/shell/tools-bridges.js'), 'utf8');
    expect(bridges).not.toContain('data-bridge-id="unreal-legacy"');
    expect(bridges).not.toContain('bridge-card is-disabled" data-bridge-id="unreal"');
    expect(bridges).not.toContain("installMode: 'planned'");
    expect(bridges).not.toContain("status: 'planned'");
    for (const id of ['maya', 'blender', '3ds-max', 'cinema-4d', 'houdini', 'zbrush', 'substance-painter', 'rhino', 'sketchup', 'unreal', 'motionbuilder', 'godot', 'fusion-360', 'unity', 'davinci-resolve', 'nuke']) {
      expect(bridges).toContain(`data-bridge-id="${id}"`);
    }
    expect(bridges).toContain('renderSubstanceDesignerCard');
    expect(bridges).toContain("id: 'substance-designer'");
    expect(bridges).toContain('renderMariCard');
    expect(bridges).toContain("id: 'mari'");
    expect(bridges).toContain('renderKritaCard');
    expect(bridges).toContain("id: 'krita'");
    expect(bridges).toContain('renderGimpCard');
    expect(bridges).toContain("id: 'gimp'");
    expect(bridges).toContain('renderAsepriteCard');
    expect(bridges).toContain("id: 'aseprite'");
    expect(bridges).toContain('renderMohoCard');
    expect(bridges).toContain("id: 'moho'");
    expect(bridges).toContain('renderToonBoomHarmonyCard');
    expect(bridges).toContain("id: 'toon-boom-harmony'");
    expect(bridges).toContain('renderOpenToonzCard');
    expect(bridges).toContain("id: 'opentoonz'");
    expect(bridges).toContain('renderCavalryCard');
    expect(bridges).toContain("id: 'cavalry'");
    expect(bridges).toContain('renderTvPaintCard');
    expect(bridges).toContain("id: 'tvpaint'");
    expect(bridges).toContain("this.renderCloMarvelousCard('marvelous-designer')");
    expect(bridges).toContain("this.renderCloMarvelousCard('clo')");
    expect(bridges).toContain('renderRizomUvCard');
    expect(bridges).toContain("id: 'rizomuv'");
    expect(bridges).toContain('renderDazStudioCard');
    expect(bridges).toContain("id: 'daz-studio'");
    expect(bridges).toContain('renderPoserCard');
    expect(bridges).toContain("id: 'poser'");
    expect(bridges).toContain("this.renderReallusionCard('iclone')");
    expect(bridges).toContain("this.renderReallusionCard('character-creator')");
    expect(bridges).toContain('renderMetashapeCard');
    expect(bridges).toContain("id: 'metashape'");
    expect(bridges).toContain('renderThreeDequalizerCard');
    expect(bridges).toContain("id: '3dequalizer'");
    expect(bridges).toContain('renderKatanaCard');
    expect(bridges).toContain("id: 'katana'");
    expect(bridges).toContain("this.renderFoundryTimelineCard('nuke-studio')");
    expect(bridges).toContain("this.renderFoundryTimelineCard('hiero')");
    expect(bridges).toContain('renderLightroomCard');
    expect(bridges).toContain("id: 'lightroom-classic'");
    expect(bridges).toContain('renderDarktableCard');
    expect(bridges).toContain("id: 'darktable'");
    expect(bridges).toContain('renderKeyShotCard');
    expect(bridges).toContain("id: 'keyshot'");
    expect(bridges).toContain('renderMarmosetToolbagCard');
    expect(bridges).toContain("id: 'marmoset-toolbag'");
    expect(bridges).toContain('renderModoCard');
    expect(bridges).toContain("id: 'modo'");
    expect(bridges).toContain('renderLightWaveCard');
    expect(bridges).toContain("id: 'lightwave'");
    expect(bridges).toContain('renderFreeCADCard');
    expect(bridges).toContain("id: 'freecad'");
    expect(bridges).toContain('renderAutoCADCard');
    expect(bridges).toContain("id: 'autocad'");
    expect(bridges).toContain('renderInkscapeCard');
    expect(bridges).toContain("id: 'inkscape'");
    expect(bridges).toContain('renderNatronCard');
    expect(bridges).toContain("id: 'natron'");
    expect(bridges).toContain('renderFusionStudioCard');
    expect(bridges).toContain("id: 'fusion-studio'");
    expect(bridges).toContain('renderObsStudioCard');
    expect(bridges).toContain("id: 'obs-studio'");
    expect(bridges).toContain('renderReaperCard');
    expect(bridges).toContain("id: 'reaper'");
    expect(bridges).toContain('renderVegasProCard');
    expect(bridges).toContain("id: 'vegas-pro'");
    expect(bridges).toContain('renderSynfigCard');
    expect(bridges).toContain("id: 'synfig'");
    expect(bridges).toContain("this.renderAdobeCard('photoshop')");
    expect(bridges).toContain("this.renderAdobeCard('illustrator')");
    expect(bridges).toContain("this.renderAdobeCard('after-effects')");
    expect(bridges).toContain("this.renderAdobeCard('premiere')");
    expect(bridges).toContain("this.renderAdobeCard('indesign')");
    expect(bridges).toContain("this.renderAdobeCard('audition')");
    expect(bridges).toContain("this.renderAdobeCard('media-encoder')");
    expect(bridges).toContain("this.renderAdobeCard('animate')");
    expect(bridges).toContain("this.renderAdobeCard('adobe-bridge')");
  });
});
