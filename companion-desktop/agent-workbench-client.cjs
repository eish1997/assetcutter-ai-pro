'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const {
  fetchWithPartition,
  inspectPartitionSession,
  classifyAgentHttpStatus,
} = require('./agent-partition-fetch.cjs');

const TEAM_WEB_PARTITION = 'persist:assetcutter-team';
const WORKBENCH_PARTITION = TEAM_WEB_PARTITION;

/** Match local-companion default upload cap (100MB). */
const MAX_CREATE_IMAGE_FILE_BYTES = 100 * 1024 * 1024;
/** Above this, avoid stuffing base64 through BrowserView executeJavaScript. */
const INLINE_BRIDGE_MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function mimeFromImageExt(ext) {
  const e = String(ext || '')
    .replace(/^\./, '')
    .toLowerCase();
  if (e === 'png') return 'image/png';
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'webp') return 'image/webp';
  if (e === 'gif') return 'image/gif';
  if (e === 'bmp') return 'image/bmp';
  if (e === 'avif') return 'image/avif';
  if (e === 'svg') return 'image/svg+xml';
  return '';
}

function extFromMime(mime) {
  const m = String(mime || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif') return 'gif';
  if (m === 'image/svg+xml') return 'svg';
  if (m === 'image/bmp') return 'bmp';
  if (m === 'image/avif') return 'avif';
  return 'jpg';
}

function sanitizeCompanionPathSegment(s) {
  return (
    String(s || '')
      .trim()
      .replace(/[^a-zA-Z0-9_.-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'x'
  );
}

function companionAssetId8(assetId) {
  const raw = String(assetId || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '')
    .replace(/[^a-z0-9]/g, '');
  return (raw.slice(0, 8) || '00000000').padEnd(8, '0').slice(0, 8);
}

function workflowOriginalCompanionStorageKey(assetId, ext) {
  const id = sanitizeCompanionPathSegment(String(assetId || '').trim() || 'unknown').slice(0, 96);
  const safeExt = sanitizeCompanionPathSegment(ext || 'jpg').slice(0, 12) || 'jpg';
  const file = sanitizeCompanionPathSegment(`image-full-0-${companionAssetId8(assetId)}.${safeExt}`).slice(0, 120);
  return `${id}/${file}`;
}

/**
 * @param {{
 *   getSiteUrl: () => string;
 *   getAgentApiOrigin?: () => string | null | undefined;
 *   normalizeSiteUrl: (raw: string) => string;
 *   fetchWithPartition?: (partition: string, url: string, init?: object) => Promise<object>;
 *   invokeBridge: (method: string, args?: object) => Promise<unknown>;
 *   navigateShell: (view: string) => Promise<{ ok: boolean; error?: string }>;
 *   getCompanionHttpPort?: () => number;
 *   getCompanionSharedToken?: () => string | null | undefined;
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
      const requestOrigin = new URL(candidate.base).origin;
      try {
        const method = String((init && init.method) || 'GET').toUpperCase();
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
    if (/积分不足|credits?\s*(insufficient|required)|insufficient\s*credits/i.test(bridgeError)) {
      return { code: 'AGENT_CREDITS_REQUIRED', message: bridgeError || 'credits required' };
    }
    if (/平台\s*Key|provider key|api key|供应商.*key|key.*不可用/i.test(bridgeError)) {
      return { code: 'AGENT_PROVIDER_KEY_REQUIRED', message: bridgeError || 'provider key required' };
    }
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

  async function createTextAsset(args) {
    const text = String((args && args.text) || '').trim();
    if (!text) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_INVALID_ARGS', message: 'missing text' },
      };
    }
    await deps.navigateShell('workbench');
    const body = {
      text,
      name: args && args.name != null ? String(args.name) : undefined,
      projectId: args && args.projectId ? String(args.projectId) : undefined,
    };
    const server = await agentFetch('/agent/workbench/create-text-asset', {
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
        error: { code: 'AGENT_FORBIDDEN', message: server.detail || server.text || 'create-text-asset forbidden' },
      };
    }
    if (!server.ok) {
      return {
        ok: false,
        content: server.text || '',
        error: { code: 'AGENT_WORKBENCH_HTTP', message: server.text || 'create-text-asset failed' },
      };
    }
    let bridge = { ok: false, error: 'bridge_unavailable' };
    try {
      bridge = await deps.invokeBridge('createTextAsset', body);
    } catch (e) {
      bridge = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return buildWorkbenchOutput('createTextAsset', server.json, bridge, {
      projectId: body.projectId || null,
      name: body.name || null,
      textLength: text.length,
    });
  }

  async function createImageAsset(args) {
    const localPathRaw = args && args.localPath != null ? String(args.localPath).trim() : '';
    const imageDataUrlRaw = args && args.imageDataUrl != null ? String(args.imageDataUrl).trim() : '';
    const name = args && args.name != null ? String(args.name) : undefined;
    let projectId = args && args.projectId ? String(args.projectId) : undefined;

    if (!localPathRaw && !imageDataUrlRaw) {
      return {
        ok: false,
        content: '',
        error: {
          code: 'AGENT_TOOL_INVALID_ARGS',
          message: 'missing localPath or imageDataUrl (prefer localPath for any real image file)',
        },
      };
    }

    let imageDataUrl = '';
    let byteLength = 0;
    let mime = 'image/png';
    let sourceLocalPath = '';

    if (localPathRaw) {
      const resolved = path.resolve(localPathRaw);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return {
          ok: false,
          content: '',
          error: { code: 'AGENT_TOOL_INVALID_ARGS', message: `localPath not found: ${resolved}` },
        };
      }
      const st = fs.statSync(resolved);
      if (st.size <= 0) {
        return {
          ok: false,
          content: '',
          error: { code: 'AGENT_TOOL_INVALID_ARGS', message: 'localPath file is empty' },
        };
      }
      if (st.size > MAX_CREATE_IMAGE_FILE_BYTES) {
        return {
          ok: false,
          content: '',
          error: {
            code: 'AGENT_TOOL_INVALID_ARGS',
            message: `image file too large (${st.size} bytes); max ${MAX_CREATE_IMAGE_FILE_BYTES}`,
          },
          structured: {
            error: 'image_too_large',
            byteLength: st.size,
            maxBytes: MAX_CREATE_IMAGE_FILE_BYTES,
            nextStep: '请换较小图片，或拆分后导入（上限约 100MB）。',
          },
        };
      }
      mime = mimeFromImageExt(path.extname(resolved));
      if (!mime) {
        return {
          ok: false,
          content: '',
          error: {
            code: 'AGENT_TOOL_INVALID_ARGS',
            message: 'localPath must be an image file (.png/.jpg/.jpeg/.webp/.gif/.bmp/.avif/.svg)',
          },
        };
      }
      const buf = fs.readFileSync(resolved);
      byteLength = buf.length;
      sourceLocalPath = resolved;
      // Only build data URL when we will inline through BrowserView bridge.
      if (byteLength <= INLINE_BRIDGE_MAX_IMAGE_BYTES) {
        imageDataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      } else {
        // Keep buffer on disk path; companion PUT reads the file again below.
        imageDataUrl = '';
      }
    } else {
      if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(imageDataUrlRaw)) {
        return {
          ok: false,
          content: '',
          error: { code: 'AGENT_TOOL_INVALID_ARGS', message: 'imageDataUrl must be data:image/...;base64,...' },
        };
      }
      imageDataUrl = imageDataUrlRaw;
      const comma = imageDataUrl.indexOf(',');
      const b64 = comma >= 0 ? imageDataUrl.slice(comma + 1) : '';
      byteLength = Math.floor((b64.length * 3) / 4);
      const mimeMatch = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(imageDataUrl);
      mime = mimeMatch ? mimeMatch[1].toLowerCase() : 'image/png';
      if (byteLength > MAX_CREATE_IMAGE_FILE_BYTES) {
        return {
          ok: false,
          content: '',
          error: {
            code: 'AGENT_TOOL_INVALID_ARGS',
            message: `imageDataUrl too large (~${byteLength} bytes); prefer localPath (max ${MAX_CREATE_IMAGE_FILE_BYTES})`,
          },
          structured: {
            error: 'image_too_large',
            byteLength,
            maxBytes: MAX_CREATE_IMAGE_FILE_BYTES,
            nextStep: '请改用 localPath 传入本机路径，不要把大图 base64 塞进工具参数。',
          },
        };
      }
    }

    await deps.navigateShell('workbench');

    if (!projectId) {
      try {
        const ctx = await deps.invokeBridge('getContext', {});
        if (ctx && ctx.ok !== false && ctx.activeProjectId) {
          projectId = String(ctx.activeProjectId);
        }
      } catch {
        /* bridge may still accept without projectId and fail with project_required */
      }
    }

    const useCompanionPut = Boolean(sourceLocalPath) && byteLength > INLINE_BRIDGE_MAX_IMAGE_BYTES;
    let bridgeArgs = {
      name,
      projectId,
      imageDataUrl,
    };
    let companionKey = null;
    let preassignedAssetId = null;

    if (useCompanionPut) {
      if (!projectId) {
        return {
          ok: false,
          content: '',
          error: { code: 'AGENT_TOOL_INVALID_ARGS', message: 'project_required for large localPath import' },
          structured: {
            error: 'project_required',
            nextStep: '请先打开或创建工作台项目，再导入大图。',
          },
        };
      }
      preassignedAssetId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const ext = extFromMime(mime);
      companionKey = workflowOriginalCompanionStorageKey(preassignedAssetId, ext);
      const put = await putCompanionAssetBinary({
        projectId,
        key: companionKey,
        bytes: fs.readFileSync(sourceLocalPath),
        contentType: mime,
      });
      if (!put.ok) {
        return {
          ok: false,
          content: '',
          error: { code: 'AGENT_COMPANION_PUT', message: put.error || 'companion put failed' },
          structured: {
            error: 'companion_put_failed',
            companionKey,
            nextStep: '确认本地伴侣 18765 可用后重试；或换较小图片走 inline 导入。',
          },
        };
      }
      bridgeArgs = {
        name,
        projectId,
        assetId: preassignedAssetId,
        originalCompanionKey: companionKey,
        mime,
        imageByteLength: byteLength,
        localPath: sourceLocalPath,
      };
    }

    const server = await agentFetch('/agent/workbench/create-image-asset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageDataUrlPresent: !useCompanionPut,
        imageDataUrlLength: useCompanionPut ? 0 : imageDataUrl.length,
        localPath: sourceLocalPath || null,
        originalCompanionKey: companionKey,
        imageByteLength: byteLength,
        name: name || null,
        projectId: projectId || null,
      }),
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
        error: { code: 'AGENT_FORBIDDEN', message: server.detail || server.text || 'create-image-asset forbidden' },
      };
    }
    if (!server.ok) {
      return {
        ok: false,
        content: server.text || '',
        error: { code: 'AGENT_WORKBENCH_HTTP', message: server.text || 'create-image-asset failed' },
      };
    }
    let bridge = { ok: false, error: 'bridge_unavailable' };
    try {
      bridge = await deps.invokeBridge('createImageAsset', bridgeArgs);
    } catch (e) {
      bridge = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return buildWorkbenchOutput('createImageAsset', server.json, bridge, {
      projectId: projectId || null,
      name: name || null,
      localPath: sourceLocalPath || null,
      imageByteLength: byteLength,
      originalCompanionKey: companionKey,
      transport: useCompanionPut ? 'companion_put' : 'inline_data_url',
    });
  }

  function putCompanionAssetBinary(input) {
    const projectId = String(input.projectId || '').trim();
    const key = String(input.key || '').trim();
    const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes || []);
    const contentType = String(input.contentType || 'application/octet-stream');
    if (!projectId || !key || !bytes.length) {
      return Promise.resolve({ ok: false, error: 'invalid_put_args' });
    }
    const port =
      typeof deps.getCompanionHttpPort === 'function' ? Number(deps.getCompanionHttpPort()) || 18765 : 18765;
    const token =
      typeof deps.getCompanionSharedToken === 'function' ? String(deps.getCompanionSharedToken() || '').trim() : '';
    const pathname = `/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(key)}`;
    return new Promise((resolve) => {
      const headers = {
        'Content-Type': contentType,
        'Content-Length': bytes.length,
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: pathname,
          method: 'PUT',
          headers,
          timeout: 120000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ ok: true, status: res.statusCode, text });
              return;
            }
            resolve({
              ok: false,
              error: `HTTP ${res.statusCode || 0}: ${text.slice(0, 200)}`,
              status: res.statusCode || 0,
            });
          });
        },
      );
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'companion_put_timeout' });
      });
      req.on('error', (e) => {
        resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      });
      req.write(bytes);
      req.end();
    });
  }

  return {
    ensureReady,
    getContext,
    createProject,
    openProject,
    listAssets,
    getAsset,
    runCapability,
    createTextAsset,
    createImageAsset,
    agentFetch,
  };
}

module.exports = {
  createAgentWorkbenchClient,
  WORKBENCH_PARTITION,
  TEAM_WEB_PARTITION,
  MAX_CREATE_IMAGE_FILE_BYTES,
  INLINE_BRIDGE_MAX_IMAGE_BYTES,
};
