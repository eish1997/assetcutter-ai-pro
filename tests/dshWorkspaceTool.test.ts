import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createDshWorkspaceTools, DOCUMENT_TOOLS } = require('../companion-desktop/dsh-workspace-tool.cjs') as {
  createDshWorkspaceTools: (deps: Record<string, unknown>) => {
    workspace_dispatch: (command: unknown) => Promise<{ ok: boolean; error?: string; hostId?: string }>;
    workspace_open_surface: (surface: string) => Promise<{ ok: boolean; error?: string; shellView?: string }>;
    workspace_pick_directory: () => Promise<{ ok: boolean; cancelled?: boolean; path?: string; error?: string }>;
    workspace_read_document: () => { ok: boolean; projectId: string; assetIds: string[]; assets: Record<string, unknown> };
    DOCUMENT_TOOLS: string[];
  };
  DOCUMENT_TOOLS: string[];
};
const { createWorkspaceDocumentStore } = require('../companion-desktop/workspace-document-store.cjs') as {
  createWorkspaceDocumentStore: () => {
    dispatch: (command: Record<string, unknown>) => unknown;
    getSnapshot: () => { finger: { connectedHosts: unknown[]; selectedAssetId?: string | null }; assetIds: string[] };
    applyEvents: (events: unknown[]) => unknown;
  };
};
const { DSH_MODULE_ENTRIES } = require('../companion-desktop/dsh-module-entries.cjs') as {
  DSH_MODULE_ENTRIES: Record<string, { surface: string; shellView: string }>;
};
const { viewsForShellView } = require('../companion-desktop/dsh-workbench-views.cjs') as {
  viewsForShellView: (view: string, attached: { workbench?: object; dsh?: object; room?: object }) => object[];
};

describe('dsh workspace tools', () => {
  it('rejects unknown commands and only exposes document-level tools', () => {
    const tools = createDshWorkspaceTools({ store: createWorkspaceDocumentStore() });
    return tools.workspace_dispatch({ type: 'ac.workbench.create_text_asset' }).then((r) => {
      expect(r.ok).toBe(false);
      expect(r.error).toBe('unknown_command');
      expect(DOCUMENT_TOOLS).toEqual([
        'workspace_read_document',
        'workspace_read_finger',
        'workspace_dispatch',
        'workspace_open_surface',
        'connection_list',
        'connection_create',
        'connection_probe',
        'connection_discover',
        'host_list_primitives',
        'host_invoke_primitive',
        'replay_trace_list',
        'replay_compile',
        'replay_run',
        'replay_list',
        'shell_tool_list',
        'shell_tool_install',
      ]);
      const src = fs.readFileSync(
        path.resolve(process.cwd(), 'companion-desktop/dsh-plugins/workspace-tools-plugin.mjs'),
        'utf8',
      );
      expect(src).toContain('workspace_read_document');
      expect(src).toContain('workspace_read_finger');
      expect(src).toContain('workspace_dispatch');
      expect(src).toContain('workspace_open_surface');
      expect(src).toContain('connection_list');
      expect(src).toContain('connection_create');
      expect(src).toContain('connection_probe');
      expect(src).toContain('connection_discover');
      expect(src).toContain('host_list_primitives');
      expect(src).toContain('host_invoke_primitive');
      expect(src).toContain('replay_trace_list');
      expect(src).toContain('replay_compile');
      expect(src).toContain('replay_run');
      expect(src).toContain('replay_list');
      expect(src).toContain('shell_tool_list');
      expect(src).toContain('shell_tool_install');
      expect(src).not.toContain('required: false');
      expect(src).not.toContain('ac.workbench.');
    });
  });

  it('picks a workspace directory through the shell dialog callback', async () => {
    const tools = createDshWorkspaceTools({
      store: createWorkspaceDocumentStore(),
      pickDirectory: async () => ({ canceled: false, filePaths: ['D:\\work\\proj'] }),
    });
    await expect(tools.workspace_pick_directory()).resolves.toEqual({
      ok: true,
      path: 'D:\\work\\proj',
    });
    const cancelled = createDshWorkspaceTools({
      store: createWorkspaceDocumentStore(),
      pickDirectory: async () => ({ canceled: true, filePaths: [] }),
    });
    await expect(cancelled.workspace_pick_directory()).resolves.toEqual({
      ok: true,
      cancelled: true,
    });
  });

  it('open_surface maps resident rooms onto existing shell views', async () => {
    const opened: string[] = [];
    const tools = createDshWorkspaceTools({
      store: createWorkspaceDocumentStore(),
      openSurface: async (view: string) => {
        opened.push(view);
        return { ok: true, shellView: view };
      },
    });
    expect((await tools.workspace_open_surface('canvas')).shellView).toBe('workbench');
    expect((await tools.workspace_open_surface('workflow')).shellView).toBe('workflow');
    expect((await tools.workspace_open_surface('connections')).shellView).toBe('connections');
    expect((await tools.workspace_open_surface('tools')).shellView).toBe('tools');
    expect((await tools.workspace_open_surface('settings')).shellView).toBe('settings');
    expect(opened).toEqual(['workbench', 'workflow', 'connections', 'tools', 'settings']);
    expect((await tools.workspace_open_surface('room-abc123-def456')).shellView).toBe('room-abc123-def456');
    expect(opened).toContain('room-abc123-def456');
    expect(DSH_MODULE_ENTRIES.canvas.shellView).toBe('workbench');
    expect(DSH_MODULE_ENTRIES.workflow.shellView).toBe('workflow');
    expect(viewsForShellView('workbench', { workbench: { id: 1 }, dsh: { id: 2 } })).toHaveLength(2);
    expect(viewsForShellView('connections', { workbench: { id: 1 }, dsh: { id: 2 } })).toHaveLength(1);
    expect(viewsForShellView('workflow', { workbench: { id: 1 }, dsh: { id: 2 } })).toHaveLength(1);
    expect(
      viewsForShellView('room-abc123-def456', { workbench: { id: 1 }, dsh: { id: 2 }, room: { id: 3 } }),
    ).toHaveLength(2);
  });

  it('workspace_read_document returns the shared card list', async () => {
    const store = createWorkspaceDocumentStore();
    const tools = createDshWorkspaceTools({ store });
    await tools.workspace_dispatch({ type: 'upsert_asset', payload: { id: 'card-2', textBody: 'hello' } });
    const doc = tools.workspace_read_document();
    expect(doc.ok).toBe(true);
    expect(doc.assetIds).toContain('card-2');
    expect((doc.assets as Record<string, { textBody?: string }>)['card-2']?.textBody).toBe('hello');
    expect((doc as { compartments?: { workshop?: { assetIds: string[] } } }).compartments?.workshop?.assetIds).toContain('card-2');
  });

  it('accepts upsert_asset and remove_asset as document commands', async () => {
    const store = createWorkspaceDocumentStore();
    const tools = createDshWorkspaceTools({ store });
    const up = await tools.workspace_dispatch({
      type: 'upsert_asset',
      payload: { id: 'card-2', textBody: 'hello' },
    });
    expect(up.ok).toBe(true);
    expect(store.getSnapshot().assetIds).toContain('card-2');
    const rm = await tools.workspace_dispatch({ type: 'remove_asset', assetId: 'card-2' });
    expect(rm.ok).toBe(true);
    expect(store.getSnapshot().assetIds).not.toContain('card-2');
  });

  it('accepts set_finger as a document command', async () => {
    const store = createWorkspaceDocumentStore();
    const tools = createDshWorkspaceTools({ store });
    const r = await tools.workspace_dispatch({
      type: 'set_finger',
      finger: { selectedAssetId: 'card-2' },
    });
    expect(r.ok).toBe(true);
    expect(store.getSnapshot().finger.selectedAssetId).toBe('card-2');
  });

  it('send_to_current_host fails without a ready host and calls export once when connected', async () => {
    const store = createWorkspaceDocumentStore();
    const calls: unknown[] = [];
    const tools = createDshWorkspaceTools({
      store,
      getFinger: () => ({ connectedHosts: [] }),
      sendToHost: async (host: unknown) => {
        calls.push(host);
        return { ok: true, hostId: (host as { id: string }).id };
      },
    });
    const none = await tools.workspace_dispatch({ type: 'send_to_current_host' });
    expect(none.ok).toBe(false);
    expect(none.error).toBe('no_ready_host');
    expect(none.suggestSurface).toBe('connections');
    const connected = createDshWorkspaceTools({
      store,
      getFinger: () => ({
        connectedHosts: [{ id: 'maya', title: 'Maya', ready: true, canAcceptCurrentCard: true }],
      }),
      sendToHost: async (host: unknown) => {
        calls.push(host);
        return { ok: true, hostId: (host as { id: string }).id };
      },
    });
    const sent = await connected.workspace_dispatch({ type: 'send_to_current_host' });
    expect(sent.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('generate_on_current uses runGenerate then upserts the current card', async () => {
    const store = createWorkspaceDocumentStore();
    store.applyEvents([{ type: 'finger.changed', finger: { selectedAssetId: 'card-1' } }]);
    const tools = createDshWorkspaceTools({
      store,
      runGenerate: async () => ({ ok: true, resultKey: 'img_1', companionKey: 'ck-1' }),
    });
    const r = await tools.workspace_dispatch({ type: 'generate_on_current' });
    expect(r.ok).toBe(true);
    const snap = store.getSnapshot();
    expect(snap.finger.selectedDisplayKey).toBe('img_1');
    expect(snap.assetIds).toContain('card-1');
  });

  it('generate_on_current does not blank-succeed when the runner fails', async () => {
    const store = createWorkspaceDocumentStore();
    store.applyEvents([{ type: 'finger.changed', finger: { selectedAssetId: 'card-1' } }]);
    const tools = createDshWorkspaceTools({
      store,
      runGenerate: async () => ({ ok: false, error: 'missing_api_key' }),
    });
    const r = await tools.workspace_dispatch({ type: 'generate_on_current' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('missing_api_key');
  });

  it('connection tools proxy through the connection bridge', async () => {
    const opened: string[] = [];
    const tools = createDshWorkspaceTools({
      store: createWorkspaceDocumentStore(),
      openSurface: async (view: string) => {
        opened.push(view);
        return { ok: true, shellView: view };
      },
      getConnectionBridge: () => ({
        listDrafts: async () => ({ ok: true, drafts: [{ id: 'maya', name: 'Maya' }] }),
        probeDraft: async (id: string) => ({ ok: true, draftId: id }),
        discoverRunning: async () => ({ ok: true, discovered: 1, failed: 0, results: [] }),
      }),
    });
    const list = await tools.connection_list();
    expect(list.ok).toBe(true);
    expect((list as { drafts: unknown[] }).drafts).toHaveLength(1);
    const probe = await tools.connection_probe({ draftId: 'maya' });
    expect(probe.ok).toBe(true);
    expect(opened).toEqual(['connections']);
    const discover = await tools.connection_discover();
    expect(discover.ok).toBe(true);
  });

  it('connection_probe does not open the map when probe fails', async () => {
    const opened: string[] = [];
    const tools = createDshWorkspaceTools({
      store: createWorkspaceDocumentStore(),
      openSurface: async (view: string) => {
        opened.push(view);
        return { ok: true, shellView: view };
      },
      getConnectionBridge: () => ({
        probeDraft: async () => ({ ok: false, error: 'probe_failed' }),
      }),
    });
    const probe = await tools.connection_probe({ draftId: 'maya' });
    expect(probe.ok).toBe(false);
    expect(opened).toEqual([]);
  });

  it('host primitive tools proxy through the host primitive bridge', async () => {
    const tools = createDshWorkspaceTools({
      store: createWorkspaceDocumentStore(),
      getHostPrimitiveBridge: () => ({
        listHostPrimitives: async (draftId: string) => ({
          ok: true,
          draftId,
          primitives: [{ id: 'host.import_file', label: '导入文件', tier: 'primitive' }],
        }),
        invokeHostPrimitive: async (draftId: string, primitiveId: string) => ({
          ok: true,
          draftId,
          primitiveId,
          result: { ok: true, message: 'imported' },
        }),
      }),
    });
    const list = await tools.host_list_primitives({ draftId: 'blender' });
    expect(list.ok).toBe(true);
    expect((list as { primitives: unknown[] }).primitives).toHaveLength(1);
    const invoke = await tools.host_invoke_primitive({ draftId: 'blender', primitiveId: 'host.import_file' });
    expect(invoke.ok).toBe(true);
  });

  it('records successful dispatch traces and drops the oldest past max', async () => {
    const tools = createDshWorkspaceTools({
      store: createWorkspaceDocumentStore(),
      traceRing: require('../companion-desktop/replay-trace-ring.cjs').createReplayTraceRing({ max: 2 }),
    }) as Record<string, any>;
    await tools.workspace_dispatch({ type: 'set_finger', finger: { surface: 'workflow' } });
    await tools.workspace_dispatch({ type: 'set_finger', finger: { surface: 'tools' } });
    await tools.workspace_dispatch({ type: 'set_finger', finger: { surface: 'canvas' } });
    const listed = tools.replay_trace_list();
    expect(listed.ok).toBe(true);
    expect(listed.traces).toHaveLength(2);
    expect(listed.traces[0].args.finger.surface).toBe('tools');
    expect(listed.traces[1].args.finger.surface).toBe('canvas');
  });

  it('connection_create opens the map after a new place is added', async () => {
    const opened: string[] = [];
    const tools = createDshWorkspaceTools({
      store: createWorkspaceDocumentStore(),
      openSurface: async (view: string) => {
        opened.push(view);
        return { ok: true, shellView: view };
      },
      connectionBridge: {
        createDraft: async ({ name }: { name: string }) => ({
          ok: true,
          already: false,
          draft: { id: 'maya', name },
        }),
      },
    }) as Record<string, any>;
    const out = await tools.connection_create({ name: 'Maya' });
    expect(out.ok).toBe(true);
    expect(out.draft.id).toBe('maya');
    expect(opened).toEqual(['connections']);
  });

  it('replay_run returns artifact on success and a code on preflight failure', async () => {
    const opened: string[] = [];
    const okTools = createDshWorkspaceTools({
      store: createWorkspaceDocumentStore(),
      openSurface: async (view: string) => {
        opened.push(view);
        return { ok: true, shellView: view };
      },
      companionApiRequest: async () => ({
        ok: true,
        json: { ok: true, result: { artifacts: [{ id: 'art_1', local_path: 'C:/out.fbx' }] } },
      }),
    }) as Record<string, any>;
    const ok = await okTools.replay_run({ replayId: 'workflow.maya.export_selection_fbx', params: {} });
    expect(ok.ok).toBe(true);
    expect(ok.artifact.id).toBe('art_1');
    expect(opened).toEqual(['workflow']);

    const failOpened: string[] = [];
    const failTools = createDshWorkspaceTools({
      store: createWorkspaceDocumentStore(),
      openSurface: async (view: string) => {
        failOpened.push(view);
        return { ok: true, shellView: view };
      },
      companionApiRequest: async () => ({
        ok: false,
        json: {
          ok: false,
          error: 'preflight_failed',
          message: 'Maya 未选择对象',
          result: { status: 'preflight_failed', repair_actions: [{ id: 'select', title: '选择对象' }] },
        },
      }),
    }) as Record<string, any>;
    const fail = await failTools.replay_run({ replayId: 'workflow.maya.export_selection_fbx' });
    expect(fail.ok).toBe(false);
    expect(fail.code).toBe('preflight_failed');
    expect(JSON.stringify(fail)).not.toContain('workflow-preflight');
    expect(failOpened).toEqual([]);
  });

  it('replay_run upserts a Maya map place without leaving the replay room', async () => {
    const opened: string[] = [];
    const created: unknown[] = [];
    const synced: number[] = [];
    const probed: string[] = [];
    const tools = createDshWorkspaceTools({
      store: createWorkspaceDocumentStore(),
      getShellView: () => 'workflow',
      openSurface: async (view: string) => {
        opened.push(view);
        return { ok: true, shellView: view };
      },
      syncConnectedHosts: async () => {
        synced.push(1);
      },
      connectionBridge: {
        createDraft: async (input: { name: string; hostId?: string }) => {
          created.push(input);
          return { ok: true, already: false, draft: { id: 'maya', name: input.name } };
        },
        probeDraft: async (id: string) => {
          probed.push(id);
          return { ok: true, draftId: id };
        },
      },
      companionApiRequest: async () => ({
        ok: true,
        json: { ok: true, result: { artifacts: [{ id: 'art_1' }] } },
      }),
    }) as Record<string, any>;
    const ok = await tools.replay_run({ replayId: 'workflow.maya.export_selection_fbx' });
    expect(ok.ok).toBe(true);
    expect(created).toEqual([{ name: 'Maya', hostId: 'maya' }]);
    expect(probed).toEqual(['maya']);
    expect(opened).toEqual(['workflow']);
    expect(synced).toHaveLength(1);
  });

  it('replay_run does not create a place for unknown executors', async () => {
    const created: unknown[] = [];
    const tools = createDshWorkspaceTools({
      store: createWorkspaceDocumentStore(),
      connectionBridge: {
        createDraft: async (input: unknown) => {
          created.push(input);
          return { ok: true, draft: { id: 'x' } };
        },
      },
      companionApiRequest: async () => ({
        ok: true,
        json: { ok: true, result: { artifacts: [] } },
      }),
    }) as Record<string, any>;
    await tools.replay_run({ replayId: 'workflow.unknown.thing' });
    expect(created).toEqual([]);
  });

  it('opens the map after upsert only when already on the map', async () => {
    const opened: string[] = [];
    const tools = createDshWorkspaceTools({
      store: createWorkspaceDocumentStore(),
      getShellView: () => 'connections',
      openSurface: async (view: string) => {
        opened.push(view);
        return { ok: true, shellView: view };
      },
      connectionBridge: {
        createDraft: async () => ({ ok: true, already: true, draft: { id: 'maya', name: 'Maya' } }),
        probeDraft: async () => ({ ok: true, draftId: 'maya' }),
      },
      companionApiRequest: async () => ({
        ok: true,
        json: { ok: true, result: { artifacts: [{ id: 'art_1' }] } },
      }),
    }) as Record<string, any>;
    await tools.replay_run({ replayId: 'workflow.maya.export_selection_fbx' });
    expect(opened).toEqual(['connections', 'workflow']);
  });

  it('lists and installs shelf tools then opens the tools room', async () => {
    const opened: string[] = [];
    const posted: unknown[] = [];
    const tools = createDshWorkspaceTools({
      store: createWorkspaceDocumentStore(),
      openSurface: async (view: string) => {
        opened.push(view);
        return { ok: true, shellView: view };
      },
      companionApiRequest: async (method: string, path: string, body: unknown) => {
        if (method === 'GET' && path === '/v1/shell-tools') {
          return { ok: true, json: { tools: [{ id: 'image-format-converter', name: '转图' }] } };
        }
        posted.push({ method, path, body });
        return { ok: true, json: { ok: true, tool: { id: 'image-format-converter' } } };
      },
    }) as Record<string, any>;
    const listed = await tools.shell_tool_list();
    expect(listed.ok).toBe(true);
    expect(listed.tools).toHaveLength(1);
    const installed = await tools.shell_tool_install({ exampleId: 'image-format-converter' });
    expect(installed.ok).toBe(true);
    expect(posted).toEqual([
      { method: 'POST', path: '/v1/shell-tools/install-example', body: { exampleId: 'image-format-converter' } },
    ]);
    expect(opened).toEqual(['tools']);
  });
});

describe('dsh module entries vs shell html', () => {
  it('matches sidebar data-view literals', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/shell/index.html'), 'utf8');
    expect(html).toContain('data-view="workbench"');
    expect(html).toContain('data-view="workflow"');
    expect(html).toContain('data-view="connections"');
    expect(html).toContain('data-view="tools"');
    expect(html).toContain('id="btnLeaseRoom"');
    expect(html).toContain('id="view-blank-room"');
    expect(html).toContain('id="btnBlankRoomAskButler"');
    expect(html).toContain('id="btnBlankRoomReload"');
    expect(html).toContain('找管家');
    expect(html).toContain('openDshHandoff');
    expect(html).toContain('openBlankRoomButler');
    expect(html).toContain('/plan ');
    expect(html).toContain('/plan off');
    expect(html).toContain('leaseNewRoom');
    expect(DSH_MODULE_ENTRIES.canvas.shellView).toBe('workbench');
    expect(DSH_MODULE_ENTRIES.workflow.shellView).toBe('workflow');
    expect(DSH_MODULE_ENTRIES.connections.shellView).toBe('connections');
    expect(DSH_MODULE_ENTRIES.tools.shellView).toBe('tools');
    expect(DSH_MODULE_ENTRIES.settings.shellView).toBe('settings');
  });
});
