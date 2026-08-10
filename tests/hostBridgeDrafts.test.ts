import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listBridgesCatalog } from '../local-companion/src/bridges/mayaBridgeInstall.ts';
import {
  createHostBridgeDraft,
  deleteHostBridgeDraft,
  installHostBridgeDraft,
  probeHostBridgeDraft,
  readHostBridgeDrafts,
  uninstallHostBridgeDraft,
} from '../local-companion/src/bridges/hostBridgeDrafts.ts';
import {
  installHostBridgeCloud,
  listHostBridgeCloudVersions,
  probeHostBridgeCloud,
  publishHostBridgeDraftToCloud,
  switchHostBridgeCloudVersion,
  syncHostBridgeCloudVersionsFromRemote,
  uninstallHostBridgeCloud,
} from '../local-companion/src/bridges/hostBridgeCloud.ts';

const temps: string[] = [];

function useSandbox(): string {
  const sandbox = mkdtempSync(join(tmpdir(), 'host-bridge-drafts-'));
  temps.push(sandbox);
  process.env.COMPANION_SANDBOX_ROOT = sandbox;
  return sandbox;
}

afterEach(() => {
  delete process.env.COMPANION_SANDBOX_ROOT;
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('host bridge drafts', () => {
  function remoteSpineVersion(overrides: Record<string, unknown> = {}) {
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
        description: 'Remote Spine bridge',
        actions: ['One-click install', 'Probe connection'],
        restartHint: '重启 Spine 后再探测连接。',
        priority: 10000,
      },
      ...(overrides.definition && typeof overrides.definition === 'object' ? overrides.definition : {}),
    };
    return {
      id: 'spine@2.0.0@remote',
      hostId: 'spine',
      semver: '2.0.0',
      note: 'Remote active version',
      publishedAt: '2026-08-07T00:00:00.000Z',
      publishedBy: 'admin',
      active: true,
      ...overrides,
      definition,
    };
  }

  it('creates a Copilot local draft and exposes it through the bridge catalog', () => {
    const sandbox = useSandbox();
    const existingIds = listBridgesCatalog().map((entry) => entry.id);
    const result = createHostBridgeDraft({ name: 'Spine', category: 'paint', tags: ['Animation'] }, existingIds);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.id).toBe('spine');
    expect(result.draft.source).toBe('copilot');
    expect(result.draft.draftStatus).toBe('validated');
    expect(result.draft.bridgeTemplate.id).toBe('python_http_startup');
    expect(existsSync(join(sandbox, 'bridges', 'host-drafts', 'spine.json'))).toBe(true);
    expect(readHostBridgeDrafts().map((draft) => draft.id)).toEqual(['spine']);
    const catalogItem = listBridgesCatalog().find((entry) => entry.id === 'spine');
    expect(catalogItem?.source).toBe('draft');
    expect(catalogItem?.draftStatus).toBe('validated');
  });

  it('rejects duplicate built-in ids and unknown templates', () => {
    useSandbox();
    const existingIds = listBridgesCatalog().map((entry) => entry.id);
    const duplicate = createHostBridgeDraft({ id: 'blender', name: 'Blender Custom' }, existingIds);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.messages.join('\n')).toContain('宿主 id 已存在');

    const badTemplate = createHostBridgeDraft(
      { id: 'bad-template-host', name: 'Bad Template Host', templateId: 'unknown_template' as never },
      existingIds,
    );
    expect(badTemplate.ok).toBe(false);
    if (!badTemplate.ok) expect(badTemplate.error).toBe('template_not_found');
  });

  it('infers project plugin and manual script templates without asking the user to choose', () => {
    useSandbox();
    const existingIds = listBridgesCatalog().map((entry) => entry.id);
    const project = createHostBridgeDraft({ id: 'flax-custom', name: 'Flax Engine custom plugin host' }, existingIds);
    expect(project.ok).toBe(true);
    if (project.ok) {
      expect(project.draft.bridgeTemplate.id).toBe('project_plugin');
      expect(project.draft.manualTarget.accepts).toEqual(['project_dir']);
      expect(project.draft.probe.kind).toBe('http');
    }

    const manual = createHostBridgeDraft({ id: 'zbrush-custom', name: 'ZBrush custom script folder host' }, existingIds);
    expect(manual.ok).toBe(true);
    if (manual.ok) {
      expect(manual.draft.bridgeTemplate.id).toBe('manual_script_dir');
      expect(manual.draft.manualTarget.accepts).toEqual(['script_dir', 'plugin_dir']);
      expect(manual.draft.probe.kind).toBe('heartbeat');
    }
  });

  it('deletes a local draft without touching built-in hosts', () => {
    useSandbox();
    const result = createHostBridgeDraft({ name: 'Spine' }, listBridgesCatalog().map((entry) => entry.id));
    expect(result.ok).toBe(true);
    expect(listBridgesCatalog().some((entry) => entry.id === 'spine')).toBe(true);
    expect(deleteHostBridgeDraft('spine')).toBe(true);
    expect(listBridgesCatalog().some((entry) => entry.id === 'spine')).toBe(false);
    expect(listBridgesCatalog().some((entry) => entry.id === 'blender')).toBe(true);
  });

  it('installs, probes, and uninstalls a draft through its bridge template', async () => {
    const sandbox = useSandbox();
    const targetDir = join(sandbox, 'spine-scripts');
    const result = createHostBridgeDraft(
      { name: 'Spine', templateId: 'lua_heartbeat', defaultPort: 7788 },
      listBridgesCatalog().map((entry) => entry.id),
    );
    expect(result.ok).toBe(true);

    const installed = installHostBridgeDraft('spine', { targetDir });
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    const scriptPath = join(targetDir, 'assetcutter_spine_bridge.lua');
    expect(existsSync(scriptPath)).toBe(true);

    const missingHeartbeat = await probeHostBridgeDraft('spine');
    expect(missingHeartbeat.ok).toBe(true);
    if (missingHeartbeat.ok) {
      expect(missingHeartbeat.connected).toBe(false);
      expect(missingHeartbeat.message).toContain('尚未产生心跳文件');
    }

    expect(installed.heartbeatPath).toBeTruthy();
    mkdirSync(join(targetDir, '.assetcutter'), { recursive: true });
    writeFileSync(installed.heartbeatPath!, JSON.stringify({ ok: true, host: 'spine' }), 'utf8');
    const connected = await probeHostBridgeDraft('spine');
    expect(connected.ok).toBe(true);
    if (connected.ok) {
      expect(connected.connected).toBe(true);
      expect(connected.message).toContain('心跳已连接');
    }

    const uninstalled = uninstallHostBridgeDraft('spine');
    expect(uninstalled.ok).toBe(true);
    expect(existsSync(scriptPath)).toBe(false);
  });

  it('returns a Chinese correction when a draft install targets a protected system directory', () => {
    useSandbox();
    const result = createHostBridgeDraft(
      { name: 'Spine', templateId: 'lua_heartbeat', defaultPort: 7788 },
      listBridgesCatalog().map((entry) => entry.id),
    );
    expect(result.ok).toBe(true);

    const installed = installHostBridgeDraft('spine', { targetDir: 'C:\\Program Files\\Spine' });
    expect(installed.ok).toBe(false);
    if (!installed.ok) {
      expect(installed.error).toBe('draft_install_failed');
      expect(installed.message).toContain('不能直接安装到系统或软件安装目录');
      expect(installed.message).toContain('用户脚本目录');
    }
  });

  it('publishes validated drafts as cloud versions without overriding local drafts', async () => {
    const sandbox = useSandbox();
    const targetDir = join(sandbox, 'spine-scripts');
    const created = createHostBridgeDraft(
      { name: 'Spine', templateId: 'lua_heartbeat', defaultPort: 7788 },
      listBridgesCatalog().map((entry) => entry.id),
    );
    expect(created.ok).toBe(true);
    const installed = installHostBridgeDraft('spine', { targetDir });
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    mkdirSync(join(targetDir, '.assetcutter'), { recursive: true });
    writeFileSync(installed.heartbeatPath!, JSON.stringify({ ok: true, host: 'spine' }), 'utf8');
    const probe = await probeHostBridgeDraft('spine');
    expect(probe.ok).toBe(true);
    if (probe.ok) expect(probe.connected).toBe(true);

    const missingNote = publishHostBridgeDraftToCloud('spine', {});
    expect(missingNote.ok).toBe(false);
    if (!missingNote.ok) expect(missingNote.error).toBe('version_note_required');

    const v1 = publishHostBridgeDraftToCloud('spine', { semver: '1.0.0', note: 'First team version' });
    expect(v1.ok).toBe(true);
    const v2 = publishHostBridgeDraftToCloud('spine', { semver: '1.1.0', note: 'Second team version' });
    expect(v2.ok).toBe(true);

    expect(listHostBridgeCloudVersions('spine').map((item) => item.semver)).toEqual(['1.1.0', '1.0.0']);
    expect(listBridgesCatalog().find((entry) => entry.id === 'spine')?.source).toBe('draft');

    expect(deleteHostBridgeDraft('spine')).toBe(true);
    const cloudEntry = listBridgesCatalog().find((entry) => entry.id === 'spine');
    expect(cloudEntry?.source).toBe('cloud');
    expect(cloudEntry?.cloudVersion).toBe('1.1.0');
    expect(cloudEntry?.cloudVersions?.map((item) => item.semver)).toEqual(['1.1.0', '1.0.0']);

    const badSwitch = switchHostBridgeCloudVersion('spine', 'missing-version');
    expect(badSwitch.ok).toBe(false);
    if (!badSwitch.ok) expect(badSwitch.error).toBe('cloud_version_not_found');

    if (!v1.ok) return;
    const switched = switchHostBridgeCloudVersion('spine', v1.version.id);
    expect(switched.ok).toBe(true);
    expect(listBridgesCatalog().find((entry) => entry.id === 'spine')?.cloudVersion).toBe('1.0.0');
  });

  it('requires a fresh successful probe after the latest draft install before publishing', async () => {
    const sandbox = useSandbox();
    const targetDir = join(sandbox, 'spine-scripts');
    const created = createHostBridgeDraft(
      { name: 'Spine', templateId: 'lua_heartbeat', defaultPort: 7788 },
      listBridgesCatalog().map((entry) => entry.id),
    );
    expect(created.ok).toBe(true);
    const installed = installHostBridgeDraft('spine', { targetDir });
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    mkdirSync(join(targetDir, '.assetcutter'), { recursive: true });
    writeFileSync(installed.heartbeatPath!, JSON.stringify({ ok: true, host: 'spine' }), 'utf8');
    const probe = await probeHostBridgeDraft('spine');
    expect(probe.ok).toBe(true);
    if (probe.ok) expect(probe.connected).toBe(true);

    const draftPath = join(sandbox, 'bridges', 'host-drafts', 'spine.json');
    const staleDraft = JSON.parse(readFileSync(draftPath, 'utf8'));
    staleDraft.lastProbe.checkedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    writeFileSync(draftPath, `${JSON.stringify(staleDraft, null, 2)}\n`, 'utf8');
    const stalePublish = publishHostBridgeDraftToCloud('spine', { semver: '1.0.0', note: 'Stale probe' });
    expect(stalePublish.ok).toBe(false);
    if (!stalePublish.ok) expect(stalePublish.error).toBe('probe_stale');

    const freshProbe = await probeHostBridgeDraft('spine');
    expect(freshProbe.ok).toBe(true);
    const reinstall = installHostBridgeDraft('spine', { targetDir });
    expect(reinstall.ok).toBe(true);
    const beforeLatestInstall = publishHostBridgeDraftToCloud('spine', { semver: '1.0.0', note: 'Old probe after reinstall' });
    expect(beforeLatestInstall.ok).toBe(false);
    if (!beforeLatestInstall.ok) expect(beforeLatestInstall.error).toBe('probe_before_latest_install');

    const finalProbe = await probeHostBridgeDraft('spine');
    expect(finalProbe.ok).toBe(true);
    const published = publishHostBridgeDraftToCloud('spine', { semver: '1.0.0', note: 'Fresh verified version' });
    expect(published.ok).toBe(true);
  });

  it('installs, probes, and uninstalls a cloud-only host version', async () => {
    const sandbox = useSandbox();
    const draftTargetDir = join(sandbox, 'draft-spine-scripts');
    const cloudTargetDir = join(sandbox, 'cloud-spine-scripts');
    const created = createHostBridgeDraft(
      { name: 'Spine', templateId: 'lua_heartbeat', defaultPort: 7788 },
      listBridgesCatalog().map((entry) => entry.id),
    );
    expect(created.ok).toBe(true);
    const draftInstalled = installHostBridgeDraft('spine', { targetDir: draftTargetDir });
    expect(draftInstalled.ok).toBe(true);
    if (!draftInstalled.ok) return;
    mkdirSync(join(draftTargetDir, '.assetcutter'), { recursive: true });
    writeFileSync(draftInstalled.heartbeatPath!, JSON.stringify({ ok: true, host: 'spine' }), 'utf8');
    const draftProbe = await probeHostBridgeDraft('spine');
    expect(draftProbe.ok).toBe(true);
    if (draftProbe.ok) expect(draftProbe.connected).toBe(true);
    const published = publishHostBridgeDraftToCloud('spine', { semver: '1.0.0', note: 'Team version' });
    expect(published.ok).toBe(true);
    expect(deleteHostBridgeDraft('spine')).toBe(true);

    const installed = installHostBridgeCloud('spine', { targetDir: cloudTargetDir });
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    const scriptPath = join(cloudTargetDir, 'assetcutter_spine_bridge.lua');
    expect(existsSync(scriptPath)).toBe(true);

    const missingHeartbeat = await probeHostBridgeCloud('spine');
    expect(missingHeartbeat.ok).toBe(true);
    if (missingHeartbeat.ok) {
      expect(missingHeartbeat.connected).toBe(false);
      expect(missingHeartbeat.message).toContain('尚未产生心跳文件');
    }

    mkdirSync(join(cloudTargetDir, '.assetcutter'), { recursive: true });
    writeFileSync(installed.heartbeatPath!, JSON.stringify({ ok: true, host: 'spine' }), 'utf8');
    const connected = await probeHostBridgeCloud('spine');
    expect(connected.ok).toBe(true);
    if (connected.ok) {
      expect(connected.connected).toBe(true);
      expect(connected.message).toContain('心跳已连接');
    }

    const uninstalled = uninstallHostBridgeCloud('spine');
    expect(uninstalled.ok).toBe(true);
    expect(existsSync(scriptPath)).toBe(false);
  });

  it('syncs remote cloud host versions into the local bridge catalog', () => {
    useSandbox();
    const synced = syncHostBridgeCloudVersionsFromRemote([remoteSpineVersion()]);
    expect(synced.ok).toBe(true);
    if (!synced.ok) return;
    expect(synced.synced).toBe(1);
    expect(synced.skipped).toBe(0);
    const entry = listBridgesCatalog().find((item) => item.id === 'spine');
    expect(entry?.source).toBe('cloud');
    expect(entry?.cloudVersion).toBe('2.0.0');
    expect(entry?.cloudVersions?.[0]?.active).toBe(true);
  });

  it('skips unsafe remote cloud host versions before they enter the local catalog', () => {
    useSandbox();
    const synced = syncHostBridgeCloudVersionsFromRemote([
      remoteSpineVersion({
        id: 'spine@bad-template@remote',
        definition: { bridgeTemplate: { id: 'unknown_template', entryFile: 'assetcutter_spine_bridge.lua' } },
      }),
      remoteSpineVersion({
        id: 'spine@bad-entry@remote',
        definition: { bridgeTemplate: { id: 'lua_heartbeat', entryFile: '../bad.lua' } },
      }),
      remoteSpineVersion({
        id: 'spine@wrong-id@remote',
        hostId: 'spine',
        definition: { id: 'other-spine' },
      }),
    ] as never);
    expect(synced.ok).toBe(true);
    if (!synced.ok) return;
    expect(synced.synced).toBe(0);
    expect(synced.skipped).toBe(3);
    expect(listBridgesCatalog().some((item) => item.id === 'spine')).toBe(false);
  });
});
