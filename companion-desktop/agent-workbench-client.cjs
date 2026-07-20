'use strict';

const {
  fetchWithPartition,
  inspectPartitionSession,
  classifyAgentHttpStatus,
} = require('./agent-partition-fetch.cjs');

const WORKBENCH_PARTITION = 'persist:assetcutter-workbench';

/**
 * @param {{
 *   getSiteUrl: () => string;
 *   getAgentApiOrigin?: () => string | null | undefined;
 *   normalizeSiteUrl: (raw: string) => string;
 *   fetchWithPartition?: (partition: string, url: string, init?: object) => Promise<object>;
 *   invokeBridge: (method: string, args?: object) => Promise<unknown>;
 *   navigateShell: (view: string) => Promise<{ ok: boolean; error?: string }>;
 * }} deps
 */
function createAgentWorkbenchClient(deps) {
  const partitionFetch = typeof deps.fetchWithPartition === 'function' ? deps.fetchWithPartition : fetchWithPartition;
  const inspectPartition =
    typeof deps.inspectPartitionSession === 'function' ? deps.inspectPartitionSession : inspectPartitionSession;

  function apiBaseFromOrigin(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    try {
      return new URL('/api/', new URL(value).origin).href.replace(/\/$/, '');
    } catch {
      return '';
    }
  }

  function siteApiBase() {
    const href = deps.normalizeSiteUrl(deps.getSiteUrl());
    return apiBaseFromOrigin(href);
  }

  function agentApiBase() {
    const agentOrigin =
      typeof deps.getAgentApiOrigin === 'function' ? String(deps.getAgentApiOrigin() || '').trim() : '';
    return apiBaseFromOrigin(agentOrigin);
  }

  function apiBases() {
    const bases = [];
    const site = siteApiBase();
    const agent = agentApiBase();
    if (site) bases.push({ base: site, source: 'workbench-site' });
    if (agent && !bases.some((item) => item.base === agent)) bases.push({ base: agent, source: 'agent-api' });
    return bases;
  }

  function apiBase() {
    const bases = apiBases();
    return bases.length ? bases[0].base : '';
  }

  async function agentFetch(pathname, init) {
    const bases = apiBases();
    if (!bases.length) {
      return { ok: false, status: 0, json: null, text: '', error: 'invalid_site_url' };
    }
    const path = String(pathname || '').startsWith('/') ? pathname : `/${pathname}`;
    let last = null;
    for (const candidate of bases) {
      const url = `${candidate.base}${path}`;
      try {
        const method = String((init && init.method) || 'GET').toUpperCase();
        const requestOrigin = new URL(candidate.base).origin;
        const headers = {
          Accept: 'application/json',
          ...(init && init.headers ? init.headers : {}),
        };
        if (
          method !== 'GET' &&
          method !== 'HEAD' &&
          method !== 'OPTIONS' &&
          !Object.keys(headers).some((key) => key.toLowerCase() === 'origin')
        ) {
          headers.Origin = requestOrigin;
        }
        const r = await partitionFetch(WORKBENCH_PARTITION, url, {
          ...init,
          headers,
        });
        const out = {
          ...r,
          requestUrl: url,
          requestOrigin,
          requestSource: candidate.source,
        };
        if ((r.status === 404 || r.status === 405) && candidate.source === 'workbench-site') {
          last = out;
          continue;
        }
        if (r.status === 401 || r.status === 403) {
          return { ...out, ...classifyAgentHttpStatus(r.status, r.json) };
        }
        return out;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        last = {
          ok: false,
          status: 0,
          json: null,
          text: msg,
          error: msg,
          requestUrl: url,
          requestOrigin,
          requestSource: candidate.source,
        };
      }
    }
    return last || { ok: false, status: 0, json: null, text: '', error: 'agent_api_unavailable' };
  }

  async function authDiagnostics() {
    const base = agentApiBase() || siteApiBase();
    const site = deps.normalizeSiteUrl(deps.getSiteUrl());
    const out = {
      partition: WORKBENCH_PARTITION,
      apiOrigin: null,
      siteOrigin: null,
      sameOrigin: false,
      session: null,
      nextStep: 'Log in inside the embedded Workbench view, then retry the same MCP tool.',
    };
    try {
      out.apiOrigin = base ? new URL(base).origin : null;
    } catch {
      out.apiOrigin = null;
    }
    try {
      out.siteOrigin = site ? new URL(site).origin : null;
    } catch {
      out.siteOrigin = null;
    }
    out.sameOrigin = Boolean(out.apiOrigin && out.siteOrigin && out.apiOrigin === out.siteOrigin);
    if (out.apiOrigin) {
      try {
        out.session = await inspectPartition(WORKBENCH_PARTITION, out.apiOrigin);
      } catch (e) {
        out.session = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    return out;
  }

  function bridgeOk(bridge) {
    return Boolean(bridge && typeof bridge === 'object' && bridge.ok);
  }

  function sanitizeServerFailure(server) {
    const s = server && typeof server === 'object' ? server : {};
    return {
      ok: Boolean(s.ok),
      status: Number.isFinite(Number(s.status)) ? Number(s.status) : 0,
      error: s.error ? String(s.error) : null,
      detail: s.detail ? String(s.detail) : null,
      text: s.text ? String(s.text).slice(0, 1000) : '',
      json: s.json && typeof s.json === 'object' ? s.json : null,
      requestOrigin: s.requestOrigin ? String(s.requestOrigin) : null,
      requestSource: s.requestSource ? String(s.requestSource) : null,
    };
  }

  function buildWorkbenchFailure(action, code, message, server, extra) {
    const out = {
      action,
      ok: false,
      view: 'workbench',
      server: sanitizeServerFailure(server),
      retryable:
        code === 'AGENT_AUTH_REQUIRED' ||
        code === 'AGENT_WORKBENCH_HTTP' ||
        code === 'AGENT_WORKBENCH_BRIDGE',
      nextStep:
        code === 'AGENT_AUTH_REQUIRED'
          ? '请先在工作台 BrowserView 登录主站，然后重试。'
          : code === 'AGENT_FORBIDDEN'
            ? '当前账号没有权限执行该工作台操作，请切换账号、项目或让管理员调整权限。'
            : '请确认主站服务可访问、工作台 BrowserView 已加载，然后重试。',
      ...(extra && typeof extra === 'object' ? extra : {}),
    };
    return {
      ok: false,
      content: JSON.stringify(out, null, 2),
      structured: out,
      error: { code, message },
    };
  }

  function classifyBridgeError(bridge) {
    const b = bridge && typeof bridge === 'object' ? bridge : {};
    const bridgeError = String(b.error || '');
    if (b.requiresInput || bridgeError === 'input_image_required') {
      return { code: 'AGENT_INPUT_REQUIRED', message: bridgeError || 'input required' };
    }
    if (bridgeError === 'project_required') {
      return { code: 'AGENT_PROJECT_REQUIRED', message: 'workbench project required' };
    }
    if (bridgeError === 'project_not_found') {
      return { code: 'AGENT_PROJECT_NOT_FOUND', message: 'workbench project not found' };
    }
    if (bridgeError === 'preset_not_found') {
      return { code: 'AGENT_PRESET_NOT_FOUND', message: 'capability preset not found' };
    }
    if (bridgeError === 'preset_not_direct_runnable') {
      return { code: 'AGENT_PRESET_NOT_DIRECT_RUNNABLE', message: 'capability preset is not directly runnable' };
    }
    if (bridgeError === 'asset_not_found') {
      return { code: 'AGENT_ASSET_NOT_FOUND', message: 'workbench asset not found' };
    }
    return { code: 'AGENT_WORKBENCH_BRIDGE', message: bridgeError || 'workbench bridge failed' };
  }

  function buildWorkbenchOutput(action, server, bridge, extra) {
    const ok = bridgeOk(bridge);
    const bridgeClass = ok ? null : classifyBridgeError(bridge);
    const promoted = {};
    if (bridge && typeof bridge === 'object') {
      for (const key of [
        'projectId',
        'projectName',
        'project',
        'assets',
        'asset',
        'assetId',
        'resultKey',
        'output',
        'returned',
        'count',
      ]) {
        if (bridge[key] !== undefined) promoted[key] = bridge[key];
      }
    }
    const out = {
      action,
      ok,
      server,
      bridge,
      ...promoted,
      ...(extra && typeof extra === 'object' ? extra : {}),
      nextStep: ok ? 'done' : bridge?.nextStep || '检查工作台 BrowserView 是否已加载并登录，然后重试。',
    };
    return {
      ok,
      content: JSON.stringify(out, null, 2),
      structured: out,
      error: ok
        ? undefined
        : bridgeClass,
    };
  }

  async function getContext() {
    const server = await agentFetch('/agent/workbench/context', { method: 'GET' });
    if (server.authRequired) {
      return buildWorkbenchFailure('getContext', 'AGENT_AUTH_REQUIRED', '请在工作台 BrowserView 登录主站后重试', server, {
        authRequired: true,
        authDiagnostics: await authDiagnostics(),
      });
    }
    if (server.forbidden) {
      return buildWorkbenchFailure('getContext', 'AGENT_FORBIDDEN', server.detail || server.text || '请求被拒绝（非登录问题）', server, {
        forbidden: true,
      });
    }
    if (!server.ok) {
      return buildWorkbenchFailure('getContext', 'AGENT_WORKBENCH_HTTP', server.text || 'context failed', server);
    }
    let client = null;
    try {
      client = await deps.invokeBridge('getContext', {});
    } catch {
      client = { ok: false, error: 'bridge_unavailable' };
    }
    const merged = {
      action: 'getContext',
      ok: true,
      server: server.json,
      serverRequest: {
        origin: server.requestOrigin || null,
        source: server.requestSource || null,
      },
      client,
      activeProjectId: client && typeof client === 'object' ? client.activeProjectId || null : null,
      activeProjectName: client && typeof client === 'object' ? client.activeProjectName || null : null,
      activeProject: client && typeof client === 'object' ? client.activeProject || null : null,
      projects: client && Array.isArray(client.projects) ? client.projects : [],
      capabilityPresets: client && Array.isArray(client.capabilityPresets) ? client.capabilityPresets : [],
      workbenchReady: Boolean(client && typeof client === 'object' && !client.error),
      nextStep:
        client && typeof client === 'object' && client.error
          ? '工作台页面桥接未就绪，请切到工作台页面等待加载完成。'
          : 'done',
    };
    return { ok: true, content: JSON.stringify(merged, null, 2), structured: merged };
  }

  async function ensureReady(args) {
    const opts = args && typeof args === 'object' ? args : {};
    const requireProject = Boolean(opts.requireProject);
    const createIfMissing = Boolean(opts.createIfMissing);
    await deps.navigateShell('workbench');
    const contextResult = await getContext();
    if (!contextResult.ok) {
      const structured = contextResult.structured && typeof contextResult.structured === 'object' ? contextResult.structured : {};
      return {
        ...contextResult,
        structured: {
          action: 'ensureReady',
          ready: false,
          view: 'workbench',
          ...structured,
          nextStep:
            structured.nextStep ||
            '请先在工作台 BrowserView 登录主站，页面加载完成后重试 ac.workbench.ensure_ready。',
        },
      };
    }
    const context = contextResult.structured || {};
    const client = context.client && typeof context.client === 'object' ? context.client : {};
    let activeProjectId = String(client.activeProjectId || context.activeProjectId || '').trim();
    let createdProject = null;
    if (requireProject && !activeProjectId && createIfMissing) {
      const created = await createProject({ name: opts.projectName || 'Agent 产物项目' });
      if (!created.ok) return created;
      const createdStructured = created.structured && typeof created.structured === 'object' ? created.structured : {};
      const bridge = createdStructured.bridge && typeof createdStructured.bridge === 'object' ? createdStructured.bridge : {};
      activeProjectId = String(bridge.projectId || createdStructured.projectId || '').trim();
      createdProject = bridge.project || null;
    }
    const directRunPresets = Array.isArray(client.capabilityPresets)
      ? client.capabilityPresets.filter((p) => p && p.directRunSupported === true)
      : [];
    const ready = Boolean(context.workbenchReady && (!requireProject || activeProjectId));
    const out = {
      action: 'ensureReady',
      ok: ready,
      ready,
      view: 'workbench',
      requireProject,
      createIfMissing,
      activeProjectId: activeProjectId || null,
      createdProject,
      directRunPresetCount: directRunPresets.length,
      context,
      nextStep: ready
        ? 'done'
        : requireProject
          ? '当前没有可承载结果的工作区项目；请调用 ac.workbench.create_project，或重试 ensure_ready 并传入 createIfMissing=true。'
          : 'done',
    };
    return {
      ok: ready,
      content: JSON.stringify(out, null, 2),
      structured: out,
      error: ready ? undefined : { code: 'AGENT_PROJECT_REQUIRED', message: 'workbench project required' },
    };
  }

  async function openProject(projectId) {
    const id = String(projectId || '').trim();
    if (!id) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_INVALID_ARGS', message: 'missing projectId' },
      };
    }
    await deps.navigateShell('workbench');
    const server = await agentFetch('/agent/workbench/open-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: id }),
    });
    if (server.authRequired) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_AUTH_REQUIRED', message: '请在工作台登录主站' },
        structured: { authRequired: true, view: 'workbench', authDiagnostics: await authDiagnostics() },
      };
    }
    if (server.forbidden) {
      return {
        ok: false,
        content: server.text || '',
        error: { code: 'AGENT_FORBIDDEN', message: server.detail || server.text || 'open-project forbidden' },
      };
    }
    if (!server.ok) {
      return {
        ok: false,
        content: server.text || '',
        error: { code: 'AGENT_WORKBENCH_HTTP', message: server.text || 'open-project failed' },
      };
    }
    let bridge = { ok: false, error: 'bridge_unavailable' };
    try {
      bridge = await deps.invokeBridge('openProject', { projectId: id });
    } catch (e) {
      bridge = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return buildWorkbenchOutput('openProject', server.json, bridge, { projectId: id });
  }

  async function createProject(args) {
    const rawName = args && typeof args === 'object' ? args.name : args;
    const name = String(rawName || '').trim();
    await deps.navigateShell('workbench');
    const server = await agentFetch('/agent/workbench/create-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (server.authRequired) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_AUTH_REQUIRED', message: '请在工作台登录主站' },
        structured: { authRequired: true, view: 'workbench', authDiagnostics: await authDiagnostics() },
      };
    }
    if (server.forbidden) {
      return {
        ok: false,
        content: server.text || '',
        error: { code: 'AGENT_FORBIDDEN', message: server.detail || server.text || 'create-project forbidden' },
      };
    }
    if (!server.ok) {
      return {
        ok: false,
        content: server.text || '',
        error: { code: 'AGENT_WORKBENCH_HTTP', message: server.text || 'create-project failed' },
      };
    }
    let bridge = { ok: false, error: 'bridge_unavailable' };
    try {
      bridge = await deps.invokeBridge('createProject', { name });
    } catch (e) {
      bridge = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return buildWorkbenchOutput('createProject', server.json, bridge, { name: name || null });
  }

  async function listAssets(args) {
    await deps.navigateShell('workbench');
    const body = {
      projectId: args && args.projectId ? String(args.projectId) : undefined,
      limit: args && args.limit != null ? Number(args.limit) : undefined,
    };
    const server = await agentFetch('/agent/workbench/list-assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (server.authRequired) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_AUTH_REQUIRED', message: '请在工作台登录主站' },
        structured: { authRequired: true, view: 'workbench', authDiagnostics: await authDiagnostics() },
      };
    }
    if (server.forbidden) {
      return {
        ok: false,
        content: server.text || '',
        error: { code: 'AGENT_FORBIDDEN', message: server.detail || server.text || 'list-assets forbidden' },
      };
    }
    if (!server.ok) {
      return {
        ok: false,
        content: server.text || '',
        error: { code: 'AGENT_WORKBENCH_HTTP', message: server.text || 'list-assets failed' },
      };
    }
    let bridge = { ok: false, error: 'bridge_unavailable' };
    try {
      bridge = await deps.invokeBridge('listAssets', body);
    } catch (e) {
      bridge = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return buildWorkbenchOutput('listAssets', server.json, bridge, {
      projectId: body.projectId || null,
      limit: body.limit || null,
    });
  }

  async function getAsset(args) {
    const assetId = String((args && args.assetId) || '').trim();
    if (!assetId) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_INVALID_ARGS', message: 'missing assetId' },
      };
    }
    await deps.navigateShell('workbench');
    const body = {
      projectId: args && args.projectId ? String(args.projectId) : undefined,
      assetId,
    };
    const server = await agentFetch('/agent/workbench/get-asset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (server.authRequired) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_AUTH_REQUIRED', message: '请在工作台登录主站' },
        structured: { authRequired: true, view: 'workbench', authDiagnostics: await authDiagnostics() },
      };
    }
    if (server.forbidden) {
      return {
        ok: false,
        content: server.text || '',
        error: { code: 'AGENT_FORBIDDEN', message: server.detail || server.text || 'get-asset forbidden' },
      };
    }
    if (!server.ok) {
      return {
        ok: false,
        content: server.text || '',
        error: { code: 'AGENT_WORKBENCH_HTTP', message: server.text || 'get-asset failed' },
      };
    }
    let bridge = { ok: false, error: 'bridge_unavailable' };
    try {
      bridge = await deps.invokeBridge('getAsset', body);
    } catch (e) {
      bridge = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return buildWorkbenchOutput('getAsset', server.json, bridge, {
      projectId: body.projectId || null,
      assetId,
    });
  }

  async function runCapability(args) {
    const presetId = String(args.presetId || '').trim();
    if (!presetId) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_INVALID_ARGS', message: 'missing presetId' },
      };
    }
    await deps.navigateShell('workbench');
    const body = {
      presetId,
      projectId: args.projectId ? String(args.projectId) : undefined,
      inputText: args.inputText != null ? String(args.inputText) : undefined,
      imageDataUrl: args.imageDataUrl != null ? String(args.imageDataUrl) : undefined,
      inputAssetId: args.inputAssetId != null ? String(args.inputAssetId) : undefined,
      inputAssetDisplayKey: args.inputAssetDisplayKey != null ? String(args.inputAssetDisplayKey) : undefined,
    };
    const server = await agentFetch('/agent/workbench/run-capability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (server.authRequired) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_AUTH_REQUIRED', message: '请在工作台登录主站' },
        structured: { authRequired: true, view: 'workbench', authDiagnostics: await authDiagnostics() },
      };
    }
    if (server.forbidden) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_FORBIDDEN', message: server.detail || server.text || 'run-capability forbidden' },
      };
    }
    if (!server.ok) {
      return {
        ok: false,
        content: server.text || '',
        error: { code: 'AGENT_WORKBENCH_HTTP', message: server.text || 'run-capability failed' },
      };
    }
    let bridge = { ok: false, error: 'bridge_unavailable' };
    try {
      bridge = await deps.invokeBridge('runCapability', body);
    } catch (e) {
      bridge = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return buildWorkbenchOutput('runCapability', server.json, bridge, {
      presetId,
      projectId: body.projectId || null,
      inputText: body.inputText || null,
      imageDataUrl: body.imageDataUrl ? '[data-url]' : null,
      inputAssetId: body.inputAssetId || null,
      inputAssetDisplayKey: body.inputAssetDisplayKey || null,
    });
  }

  return { ensureReady, getContext, createProject, openProject, listAssets, getAsset, runCapability, agentFetch };
}

module.exports = { createAgentWorkbenchClient, WORKBENCH_PARTITION };
