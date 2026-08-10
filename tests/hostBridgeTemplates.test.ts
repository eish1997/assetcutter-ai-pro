import { describe, expect, it } from 'vitest';
import { HOST_BRIDGE_DEFINITIONS } from '../local-companion/src/bridges/definitions/hostBridgeDefinitions.ts';
import {
  EXTENDSCRIPT_HEARTBEAT_TEMPLATE,
  getHostBridgeTemplate,
  HOST_BRIDGE_TEMPLATES,
  LUA_HEARTBEAT_TEMPLATE,
  MAYA_COMMAND_PORT_TEMPLATE,
  MANUAL_SCRIPT_DIR_TEMPLATE,
  PROJECT_PLUGIN_TEMPLATE,
  PYTHON_HTTP_STARTUP_TEMPLATE,
} from '../local-companion/src/bridges/templates/hostBridgeTemplates.ts';

describe('host bridge templates', () => {
  it('registers the first real template families used by definitions', () => {
    expect(HOST_BRIDGE_TEMPLATES.map((template) => template.id)).toEqual([
      'python_http_startup',
      'lua_heartbeat',
      'extendscript_heartbeat',
      'project_plugin',
      'manual_script_dir',
      'maya_command_port',
    ]);
    for (const def of HOST_BRIDGE_DEFINITIONS) {
      expect(getHostBridgeTemplate(def.bridgeTemplate.id)?.id).toBe(def.bridgeTemplate.id);
    }
  });

  it('generates project plugin files with a real HTTP probe entrypoint', () => {
    const files = PROJECT_PLUGIN_TEMPLATE.generateInstallFiles({
      hostId: 'flax',
      hostName: 'Flax Engine',
      port: 7191,
      entryFile: 'assetcutter_flax_bridge',
    });
    expect(files.map((file) => file.relativePath)).toEqual([
      'assetcutter_flax_bridge/assetcutter_bridge.py',
      'assetcutter_flax_bridge/assetcutter-bridge.json',
      'assetcutter_flax_bridge/README.md',
    ]);
    expect(files[0]?.contents).toContain('/health');
    expect(files[1]?.contents).toContain('"host": "flax"');
  });

  it('generates manual script directory files with a heartbeat probe entrypoint', () => {
    const files = MANUAL_SCRIPT_DIR_TEMPLATE.generateInstallFiles({
      hostId: 'zbrush-like',
      hostName: 'ZBrush Like',
      port: 7121,
      entryFile: 'assetcutter_zbrush_like_bridge.py',
      heartbeatFile: 'zbrush-like-heartbeat.json',
    });
    expect(files).toHaveLength(1);
    expect(files[0]?.relativePath).toBe('assetcutter_zbrush_like_bridge.py');
    expect(files[0]?.contents).toContain('write_heartbeat');
    expect(files[0]?.contents).toContain('zbrush-like-heartbeat.json');
  });

  it('generates Python HTTP startup files with host and port parameters', () => {
    const files = PYTHON_HTTP_STARTUP_TEMPLATE.generateInstallFiles({
      hostId: 'blender',
      hostName: 'Blender',
      port: 7011,
      entryFile: 'assetcutter_blender_bridge_startup.py',
    });
    expect(files).toHaveLength(1);
    expect(files[0]?.relativePath).toBe('assetcutter_blender_bridge_startup.py');
    expect(files[0]?.contents).toContain('PORT = 7011');
    expect(files[0]?.contents).toContain('HOST_ID = "blender"');
    expect(files[0]?.contents).toContain('/health');
  });

  it('generates Lua heartbeat files with host, port, and heartbeat target', () => {
    const files = LUA_HEARTBEAT_TEMPLATE.generateInstallFiles({
      hostId: 'darktable',
      hostName: 'darktable',
      port: 7611,
      entryFile: 'assetcutter_darktable_bridge.lua',
      heartbeatFile: 'darktable-heartbeat.json',
    });
    expect(files).toHaveLength(1);
    expect(files[0]?.relativePath).toBe('assetcutter_darktable_bridge.lua');
    expect(files[0]?.contents).toContain('local port = 7611');
    expect(files[0]?.contents).toContain('darktable-heartbeat.json');
    expect(files[0]?.contents).toContain('write_heartbeat');
  });

  it('generates ExtendScript heartbeat files with host, port, and heartbeat target', () => {
    const files = EXTENDSCRIPT_HEARTBEAT_TEMPLATE.generateInstallFiles({
      hostId: 'photoshop',
      hostName: 'Photoshop',
      port: 7081,
      entryFile: 'assetcutter_photoshop_bridge.jsx',
      heartbeatFile: 'photoshop-heartbeat.json',
    });
    expect(files).toHaveLength(1);
    expect(files[0]?.relativePath).toBe('assetcutter_photoshop_bridge.jsx');
    expect(files[0]?.contents).toContain('port: 7081');
    expect(files[0]?.contents).toContain('photoshop-heartbeat.json');
    expect(files[0]?.contents).toContain('JSON.stringify(payload)');
  });

  it('rejects generated file paths outside the selected target directory', () => {
    expect(() =>
      PYTHON_HTTP_STARTUP_TEMPLATE.generateInstallFiles({
        hostId: 'bad',
        hostName: 'Bad',
        port: 7001,
        entryFile: '../bad.py',
      }),
    ).toThrow('template_path_outside_target');
    expect(() =>
      LUA_HEARTBEAT_TEMPLATE.uninstall({
        generatedFiles: ['C:/Windows/bad.lua'],
      }),
    ).toThrow('template_path_must_be_relative');
  });

  it('generates Maya command port files with boot and userSetup hooks', () => {
    const files = MAYA_COMMAND_PORT_TEMPLATE.generateInstallFiles({
      hostId: 'maya',
      hostName: 'Maya',
      port: 7001,
      entryFile: 'userSetup.py',
    });
    expect(files.map((file) => file.relativePath)).toEqual(['assetcutter_maya_cmdport_boot.py', 'userSetup.py']);
    expect(files[0]?.contents).toContain('cmds.commandPort');
    expect(files[1]?.contents).toContain('ensure(7001)');
  });
});
