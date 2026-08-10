import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  activateHostBridgeVersion,
  addHostBridgeVersion,
  listHostBridgeDefinitions,
  listHostBridgeVersions,
} from '../server/host-bridges-store.js';

const dataPath = join(process.cwd(), 'server', 'data', 'host-bridges.json');

const definition = {
  id: 'spine',
  name: 'Spine',
  category: 'paint',
  defaultPort: 7788,
  connectorLabel: 'Lua script / heartbeat',
  installMode: 'one_click',
  status: 'ready',
  detection: [{ kind: 'manual_target' }],
  manualTarget: { accepts: ['script_dir'], resolver: 'manualScriptDir', pickerTitle: '选择 Spine 脚本目录' },
  bridgeTemplate: { id: 'lua_heartbeat', entryFile: 'assetcutter_spine_bridge.lua' },
  probe: { kind: 'heartbeat', port: 7788, heartbeatFile: 'spine-heartbeat.json' },
  uninstall: { mode: 'recorded_targets_and_markers', generatedFiles: ['assetcutter_spine_bridge.lua'] },
  ui: {
    tags: ['Animation'],
    description: 'Spine team host bridge',
    actions: ['One-click install', 'Probe connection'],
    restartHint: '重启 Spine 后再探测连接。',
    priority: 10000,
  },
};

afterEach(() => {
  if (existsSync(dataPath)) rmSync(dataPath, { force: true });
});

describe('host bridge server store', () => {
  it('publishes, lists, and activates cloud host bridge versions', async () => {
    const v1 = await addHostBridgeVersion({ definition, semver: '1.0.0', note: 'First version', publishedBy: 'admin' });
    const v2 = await addHostBridgeVersion({ definition, semver: '1.1.0', note: 'Second version', publishedBy: 'admin' });

    expect((await listHostBridgeDefinitions())[0]?.semver).toBe('1.1.0');
    expect((await listHostBridgeVersions('spine')).map((item) => item.semver)).toEqual(['1.1.0', '1.0.0']);

    await activateHostBridgeVersion('spine', v1.id);
    const active = await listHostBridgeDefinitions();
    expect(active[0]?.semver).toBe('1.0.0');
    expect(active[0]?.versions.map((item) => item.semver)).toEqual(['1.1.0', '1.0.0']);

    await expect(activateHostBridgeVersion('spine', 'missing')).rejects.toThrow('cloud_version_not_found');
    expect(v2.hostId).toBe('spine');
  });

  it('rejects unsafe cloud host bridge definitions before they become team versions', async () => {
    await expect(
      addHostBridgeVersion({
        definition: { ...definition, bridgeTemplate: { ...definition.bridgeTemplate, id: 'unknown_template' } },
        semver: '1.0.0',
        note: 'Bad template',
        publishedBy: 'admin',
      }),
    ).rejects.toThrow('definition_template_invalid');

    await expect(
      addHostBridgeVersion({
        definition: { ...definition, bridgeTemplate: { ...definition.bridgeTemplate, entryFile: 'C:/Windows/bad.lua' } },
        semver: '1.0.0',
        note: 'Bad entry path',
        publishedBy: 'admin',
      }),
    ).rejects.toThrow('definition_entry_file_invalid');

    await expect(
      addHostBridgeVersion({
        definition: { ...definition, uninstall: { ...definition.uninstall, generatedFiles: ['../bad.lua'] } },
        semver: '1.0.0',
        note: 'Bad uninstall path',
        publishedBy: 'admin',
      }),
    ).rejects.toThrow('definition_uninstall_generated_file_invalid');

    await expect(
      addHostBridgeVersion({
        definition: { ...definition, probe: { ...definition.probe, port: 70000 } },
        semver: '1.0.0',
        note: 'Bad probe port',
        publishedBy: 'admin',
      }),
    ).rejects.toThrow('definition_probe_port_invalid');

    await expect(
      addHostBridgeVersion({
        definition: { ...definition, probe: { kind: 'http', port: 7788, path: '/status' } },
        semver: '1.0.0',
        note: 'Bad HTTP probe',
        publishedBy: 'admin',
      }),
    ).rejects.toThrow('definition_probe_http_path_invalid');

    await expect(
      addHostBridgeVersion({
        definition: { ...definition, probe: { ...definition.probe, heartbeatFile: '../spine-heartbeat.json' } },
        semver: '1.0.0',
        note: 'Bad heartbeat path',
        publishedBy: 'admin',
      }),
    ).rejects.toThrow('definition_probe_heartbeat_file_invalid');

    expect(await listHostBridgeVersions('spine')).toEqual([]);
  });
});
