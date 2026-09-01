'use strict';

const { pickHostForSend, sendHostErrorSuggestSurface } = require('./workspace-finger-hosts.cjs');
const { shellViewForSurface, DSH_MODULE_ENTRIES } = require('./dsh-module-entries.cjs');
const {
  readDocumentSnapshotForFolderSource,
  shouldSkipWorkshopAssetCommand,
} = require('./workshop-folder-source.cjs');
const { inferKnownHostHint } = require('./connectionPackageBridge.cjs');

const ALLOWED_COMMANDS = new Set([
  'noop',
  'set_finger',
  'upsert_asset',
  'remove_asset',
  'append_text_result',
  'ingest_image',
  'generate_on_current',
  'send_to_current_host',
  'open_surface',
]);

const { createReplayTraceRing } = require('./replay-trace-ring.cjs');

const DOCUMENT_TOOLS = [
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
];

function createDshWorkspaceTools(deps = {}) {
  const store = deps.store;
  const writeMode = deps.writeMode || 'document';
  const connectionBridge = deps.connectionBridge || null;
  const hostPrimitiveBridge = deps.hostPrimitiveBridge || null;
  const traceRing = deps.traceRing || createReplayTraceRing();

  function recordOk(tool, args, out) {
    if (out && out.ok !== false) {
      traceRing.append({ tool, args });
    }
    return out;
  }
  function resolveConnectionBridge() {
    if (connectionBridge) return connectionBridge;
    if (typeof deps.getConnectionBridge === 'function') return deps.getConnectionBridge();
    return null;
  }
  function resolveHostPrimitiveBridge() {
    if (hostPrimitiveBridge) return hostPrimitiveBridge;
    if (typeof deps.getHostPrimitiveBridge === 'function') return deps.getHostPrimitiveBridge();
    return null;
  }

  function getFinger() {
    if (typeof deps.getFinger === 'function') return deps.getFinger();
    const snap = store && typeof store.getSnapshot === 'function' ? store.getSnapshot() : null;
    return (snap && snap.finger) || { connectedHosts: [] };
  }

  function getSnapshot() {
    if (typeof deps.getSnapshot === 'function') return deps.getSnapshot();
    return store && typeof store.getSnapshot === 'function'
      ? store.getSnapshot()
      : { projectId: '', finger: getFinger(), assetIds: [], assets: {} };
  }

  function workspace_read_finger() {
    return { ok: true, finger: getFinger() };
  }

  function workspace_read_document() {
    const snap = getSnapshot() || {};
    const folderSource =
      typeof deps.isWorkshopFolderSourceOfTruth === 'function' ? deps.isWorkshopFolderSourceOfTruth() : false;
    if (folderSource) {
      return readDocumentSnapshotForFolderSource(snap);
    }
    const assets = snap.assets && typeof snap.assets === 'object' ? snap.assets : {};
    const assetIds = Array.isArray(snap.assetIds) ? snap.assetIds : Object.keys(assets);
    const compartments =
      snap.compartments && typeof snap.compartments === 'object'
        ? snap.compartments
        : {
            workshop: { assetIds },
            workflow: { assetIds: [] },
            tools: { assetIds: [] },
            rooms: {},
          };
    return {
      ok: true,
      projectId: String(snap.projectId || ''),
      finger: snap.finger || getFinger(),
      assetIds: Array.isArray(compartments.workshop && compartments.workshop.assetIds)
        ? compartments.workshop.assetIds
        : assetIds,
      assets,
      compartments,
    };
  }

  async function workspace_dispatch(command) {
    if (!command || typeof command !== 'object' || !ALLOWED_COMMANDS.has(String(command.type || ''))) {
      return { ok: false, error: 'unknown_command' };
    }
    if (command.type === 'open_surface') {
      return workspace_open_surface(command.surface);
    }
    if (
      typeof deps.isWorkshopFolderSourceOfTruth === 'function' &&
      deps.isWorkshopFolderSourceOfTruth() &&
      shouldSkipWorkshopAssetCommand(command, true)
    ) {
      return { ok: true, skipped: 'workshop_folder_source' };
    }
    if (command.type === 'generate_on_current' && typeof deps.runGenerate === 'function') {
      const ran = await deps.runGenerate(command);
      if (!ran || !ran.ok) {
        const error = String((ran && ran.error) || 'generate_failed');
        if (store && typeof store.dispatch === 'function') {
          store.dispatch({ type: 'generate_on_current', ok: false, error });
        }
        return { ok: false, error };
      }
      command = {
        ...command,
        ok: true,
        resultKey: ran.resultKey,
        companionKey: ran.companionKey,
      };
    }
    if (command.type === 'send_to_current_host') {
      const picked = pickHostForSend(getFinger(), command.hostId);
      if (!picked.ok) {
        const out = { ok: false, error: picked.error };
        const suggestSurface = sendHostErrorSuggestSurface(picked.error);
        if (suggestSurface) out.suggestSurface = suggestSurface;
        return out;
      }
      if (typeof deps.sendToHost !== 'function') {
        return { ok: false, error: 'host_export_unwired' };
      }
      const sent = await deps.sendToHost(picked.host, command);
      const out = sent && typeof sent === 'object' ? sent : { ok: true, hostId: picked.host.id };
      if (out && out.ok !== false) {
        await rememberKnownHostPlace({ hostId: picked.host.id, name: picked.host.title || picked.host.id });
      }
      return recordOk('workspace_dispatch', command, out);
    }
    if (!store || typeof store.dispatch !== 'function') {
      return { ok: false, error: 'store_unwired' };
    }
    const before = typeof store.getEvents === 'function' ? store.getEvents().length : 0;
    const snapshot = store.dispatch(command);
    const produced = typeof store.getEvents === 'function' ? store.getEvents().slice(before) : [];
    const failed = produced.find((e) => e && e.type === 'command.failed');
    if (failed) {
      return { ok: false, error: failed.error, snapshot };
    }
    if (writeMode === 'dual' && typeof deps.bridgeAppend === 'function' && command.type === 'append_text_result') {
      await deps.bridgeAppend(command);
    }
    return recordOk('workspace_dispatch', command, { ok: true, snapshot });
  }

  async function workspace_open_surface(surface) {
    const view = shellViewForSurface(surface);
    if (!view) return { ok: false, error: 'unknown_surface' };
    if (typeof deps.openSurface !== 'function') return { ok: false, error: 'navigate_unwired' };
    const opened = await deps.openSurface(view);
    return opened && typeof opened === 'object' ? opened : { ok: true, shellView: view };
  }

  function currentShellView() {
    if (typeof deps.getShellView === 'function') return String(deps.getShellView() || '');
    return '';
  }

  async function rememberKnownHostPlace(hintInput) {
    const hint = inferKnownHostHint(hintInput);
    if (!hint) return { skipped: 'unknown_host' };
    const bridge = resolveConnectionBridge();
    if (!bridge || typeof bridge.createDraft !== 'function') {
      return { skipped: 'connection_bridge_unwired' };
    }
    const created = await bridge.createDraft({ name: hint.name, hostId: hint.hostId });
    if (created && created.ok && created.draft && created.draft.id && typeof bridge.probeDraft === 'function') {
      try {
        await bridge.probeDraft(created.draft.id);
      } catch {
        /* best-effort */
      }
    }
    if (typeof deps.syncConnectedHosts === 'function') {
      try {
        await deps.syncConnectedHosts();
      } catch {
        /* best-effort */
      }
    }
    if (created && created.ok && currentShellView() === 'connections') {
      await workspace_open_surface('connections');
    }
    return created && typeof created === 'object' ? created : { ok: false };
  }

  async function connection_list() {
    const bridge = resolveConnectionBridge();
    if (!bridge || typeof bridge.listDrafts !== 'function') {
      return { ok: false, error: 'connection_bridge_unwired' };
    }
    return bridge.listDrafts();
  }

  async function connection_create(args) {
    const bridge = resolveConnectionBridge();
    if (!bridge || typeof bridge.createDraft !== 'function') {
      return { ok: false, error: 'connection_bridge_unwired' };
    }
    const out = await bridge.createDraft(args && typeof args === 'object' ? args : {});
    if (out && out.ok) {
      await workspace_open_surface('connections');
    }
    return recordOk('connection_create', args, out);
  }

  async function connection_probe(args) {
    const bridge = resolveConnectionBridge();
    if (!bridge || typeof bridge.probeDraft !== 'function') {
      return { ok: false, error: 'connection_bridge_unwired' };
    }
    const draftId = args && typeof args === 'object' ? args.draftId : args;
    const out = await bridge.probeDraft(draftId);
    if (out && out.ok) {
      await workspace_open_surface('connections');
    }
    return recordOk('connection_probe', { draftId }, out);
  }

  async function connection_discover() {
    const bridge = resolveConnectionBridge();
    if (!bridge || typeof bridge.discoverRunning !== 'function') {
      return { ok: false, error: 'connection_bridge_unwired' };
    }
    return recordOk('connection_discover', {}, await bridge.discoverRunning());
  }

  async function host_list_primitives(args) {
    const bridge = resolveHostPrimitiveBridge();
    if (!bridge || typeof bridge.listHostPrimitives !== 'function') {
      return { ok: false, error: 'host_primitive_bridge_unwired' };
    }
    const draftId = args && typeof args === 'object' ? args.draftId : args;
    return bridge.listHostPrimitives(draftId);
  }

  async function host_invoke_primitive(args) {
    const bridge = resolveHostPrimitiveBridge();
    if (!bridge || typeof bridge.invokeHostPrimitive !== 'function') {
      return { ok: false, error: 'host_primitive_bridge_unwired' };
    }
    const body = args && typeof args === 'object' ? args : {};
    const out = await bridge.invokeHostPrimitive(body.draftId, body.primitiveId, body.params, {
      localVersionId: body.localVersionId,
    });
    if (out && out.ok) {
      await rememberKnownHostPlace({
        hostId: body.hostId || body.draftId,
        name: body.name || body.draftId,
      });
    }
    return recordOk('host_invoke_primitive', body, out);
  }

  function replay_trace_list() {
    return { ok: true, traces: traceRing.list() };
  }

  async function replay_compile() {
    const traces = traceRing.list();
    if (typeof deps.companionApiRequest !== 'function') {
      return { ok: false, error: 'companion_unwired', traces };
    }
    const r = await deps.companionApiRequest('POST', '/v1/workflows/replay/compile', { traces }, { timeoutMs: 60000 });
    const body = r && r.json && typeof r.json === 'object' ? r.json : r;
    const out = body && typeof body === 'object' ? body : { ok: false, error: 'compile_failed' };
    if (out && out.ok) {
      await workspace_open_surface('workflow');
    }
    return out;
  }

  async function replay_run(args) {
    const body = args && typeof args === 'object' ? args : {};
    const replayId = String(body.replayId || body.workflowId || '').trim();
    if (!replayId) return { ok: false, error: 'replay_id_required' };
    if (typeof deps.companionApiRequest !== 'function') {
      return { ok: false, error: 'companion_unwired' };
    }
    const r = await deps.companionApiRequest(
      'POST',
      '/v1/workflows/' + encodeURIComponent(replayId) + '/run',
      { params: body.params },
      { timeoutMs: 120000 },
    );
    const json = r && r.json && typeof r.json === 'object' ? r.json : {};
    if (r && r.ok && json.ok) {
      await rememberKnownHostPlace({ replayId, name: replayId });
      await workspace_open_surface('workflow');
      return {
        ok: true,
        result: json.result,
        artifact: json.result && Array.isArray(json.result.artifacts) ? json.result.artifacts[0] : undefined,
      };
    }
    const run = json.result && typeof json.result === 'object' ? json.result : {};
    const repair = Array.isArray(run.repair_actions) ? run.repair_actions[0] : null;
    return {
      ok: false,
      error: json.error || run.status || 'replay_run_failed',
      code: json.error || run.status || 'replay_run_failed',
      message: json.message || (run.error && run.error.message) || '',
      repair: repair ? { id: repair.id, title: repair.title } : undefined,
    };
  }

  async function replay_list() {
    if (typeof deps.companionApiRequest !== 'function') {
      return { ok: false, error: 'companion_unwired' };
    }
    const r = await deps.companionApiRequest('GET', '/v1/workflows/skills', null, { timeoutMs: 15000 });
    const json = r && r.json && typeof r.json === 'object' ? r.json : {};
    return {
      ok: Boolean(r && r.ok),
      workflows: Array.isArray(json.workflows) ? json.workflows : [],
    };
  }

  async function shell_tool_list() {
    if (typeof deps.companionApiRequest !== 'function') {
      return { ok: false, error: 'companion_unwired' };
    }
    const r = await deps.companionApiRequest('GET', '/v1/shell-tools', null, { timeoutMs: 15000 });
    const json = r && r.json && typeof r.json === 'object' ? r.json : {};
    const listed = Array.isArray(json.tools) ? json.tools : [];
    return { ok: Boolean(r && r.ok), tools: listed };
  }

  async function shell_tool_install(args) {
    if (typeof deps.companionApiRequest !== 'function') {
      return { ok: false, error: 'companion_unwired' };
    }
    const body = args && typeof args === 'object' ? args : {};
    const url = String(body.url || '').trim();
    const exampleId = String(body.exampleId || body.toolId || '').trim();
    const r = url
      ? await deps.companionApiRequest(
          'POST',
          '/v1/shell-tools/install-from-url',
          { url },
          { timeoutMs: 600000 },
        )
      : await deps.companionApiRequest(
          'POST',
          '/v1/shell-tools/install-example',
          exampleId ? { exampleId } : {},
          { timeoutMs: 600000 },
        );
    const json = r && r.json && typeof r.json === 'object' ? r.json : {};
    if (!r || !r.ok || json.ok === false) {
      return { ok: false, error: String(json.error || json.message || (r && r.text) || 'install_failed') };
    }
    await workspace_open_surface('tools');
    return { ok: true, tool: json.tool || json, exampleId: exampleId || undefined };
  }

  async function workspace_pick_directory() {
    if (typeof deps.pickDirectory !== 'function') {
      return { ok: false, error: 'picker_unwired' };
    }
    const r = await deps.pickDirectory();
    if (!r || r.canceled) return { ok: true, cancelled: true };
    const dir = Array.isArray(r.filePaths) ? r.filePaths[0] : r.path;
    if (!dir) return { ok: true, cancelled: true };
    return { ok: true, path: String(dir) };
  }

  return {
    DOCUMENT_TOOLS,
    ALLOWED_COMMANDS,
    workspace_read_document,
    workspace_read_finger,
    workspace_dispatch,
    workspace_open_surface,
    workspace_pick_directory,
    connection_list,
    connection_create,
    connection_probe,
    connection_discover,
    host_list_primitives,
    host_invoke_primitive,
    replay_trace_list,
    replay_compile,
    replay_run,
    replay_list,
    shell_tool_list,
    shell_tool_install,
  };
}

function readHttpJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function createDshWorkspaceHttp(tools, opts = {}) {
  const http = require('http');
  const port = Number(opts.port || 3081);
  const server = http.createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj || {}));
    };
    try {
      const url = String(req.url || '').split('?')[0];
      if (req.method === 'OPTIONS') return send(204, {});
      if (req.method === 'GET' && url === '/workspace/finger') {
        return send(200, tools.workspace_read_finger());
      }
      if (req.method === 'GET' && url === '/workspace/document') {
        return send(200, tools.workspace_read_document());
      }
      if (req.method === 'POST' && url === '/workspace/dispatch') {
        const body = await readHttpJson(req);
        const out = await tools.workspace_dispatch(body);
        return send(out && out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && url === '/workspace/open-surface') {
        const body = await readHttpJson(req);
        const out = await tools.workspace_open_surface(body && body.surface);
        return send(out && out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && url === '/workspace/pick-directory') {
        const out = await tools.workspace_pick_directory();
        return send(out && out.ok ? 200 : 400, out);
      }
      if (req.method === 'GET' && url === '/connection/drafts') {
        const out = await tools.connection_list();
        return send(out && out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && url === '/connection/create') {
        const body = await readHttpJson(req);
        const out = await tools.connection_create(body);
        return send(out && out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && url === '/connection/probe') {
        const body = await readHttpJson(req);
        const out = await tools.connection_probe(body);
        return send(out && out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && url === '/connection/discover') {
        const out = await tools.connection_discover();
        return send(out && out.ok ? 200 : 400, out);
      }
      if (req.method === 'GET' && url.startsWith('/host/primitives/')) {
        const draftId = decodeURIComponent(url.slice('/host/primitives/'.length));
        const out = await tools.host_list_primitives({ draftId });
        return send(out && out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && url === '/host/invoke') {
        const body = await readHttpJson(req);
        const out = await tools.host_invoke_primitive(body);
        return send(out && out.ok ? 200 : 400, out);
      }
      if (req.method === 'GET' && url === '/replay/trace') {
        return send(200, tools.replay_trace_list());
      }
      if (req.method === 'POST' && url === '/replay/compile') {
        const out = await tools.replay_compile();
        return send(out && out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && url === '/replay/run') {
        const body = await readHttpJson(req);
        const out = await tools.replay_run(body);
        return send(out && out.ok ? 200 : 400, out);
      }
      if (req.method === 'GET' && url === '/replay/list') {
        const out = await tools.replay_list();
        return send(out && out.ok ? 200 : 400, out);
      }
      if (req.method === 'GET' && url === '/shell-tools') {
        const out = await tools.shell_tool_list();
        return send(out && out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && url === '/shell-tools/install') {
        const body = await readHttpJson(req);
        const out = await tools.shell_tool_install(body);
        return send(out && out.ok ? 200 : 400, out);
      }
      return send(404, { ok: false, error: 'not_found' });
    } catch (e) {
      return send(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = {
  createDshWorkspaceTools,
  createDshWorkspaceHttp,
  DOCUMENT_TOOLS,
  ALLOWED_COMMANDS,
  DSH_MODULE_ENTRIES,
};
