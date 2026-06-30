'use strict';

const { fetchWithPartition, classifyAgentHttpStatus } = require('./agent-partition-fetch.cjs');

const WORKBENCH_PARTITION = 'persist:assetcutter-workbench';

/**
 * @param {{
 *   getSiteUrl: () => string;
 *   normalizeSiteUrl: (raw: string) => string;
 *   invokeBridge: (method: string, args?: object) => Promise<unknown>;
 *   navigateShell: (view: string) => Promise<{ ok: boolean; error?: string }>;
 * }} deps
 */
function createAgentWorkbenchClient(deps) {
  function apiBase() {
    const href = deps.normalizeSiteUrl(deps.getSiteUrl());
    if (!href) return '';
    try {
      return new URL('/api/', new URL(href).origin).href.replace(/\/$/, '');
    } catch {
      return '';
    }
  }

  async function agentFetch(pathname, init) {
    const base = apiBase();
    if (!base) {
      return { ok: false, status: 0, json: null, text: '', error: 'invalid_site_url' };
    }
    const path = String(pathname || '').startsWith('/') ? pathname : `/${pathname}`;
    const url = `${base}${path}`;
    try {
      const r = await fetchWithPartition(WORKBENCH_PARTITION, url, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init && init.headers ? init.headers : {}),
        },
      });
      if (r.status === 401 || r.status === 403) {
        return { ...r, ...classifyAgentHttpStatus(r.status, r.json) };
      }
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, status: 0, json: null, text: msg, error: msg };
    }
  }

  async function getContext() {
    const server = await agentFetch('/agent/workbench/context', { method: 'GET' });
    if (server.authRequired) {
      return {
        ok: false,
        content: JSON.stringify(server.json || { code: 'AGENT_AUTH_REQUIRED' }),
        error: {
          code: 'AGENT_AUTH_REQUIRED',
          message: '请在工作台 BrowserView 登录主站后重试',
        },
        structured: { authRequired: true, view: 'workbench' },
      };
    }
    if (server.forbidden) {
      return {
        ok: false,
        content: server.text || '',
        error: {
          code: 'AGENT_FORBIDDEN',
          message: server.detail || server.text || '请求被拒绝（非登录问题）',
        },
        structured: { forbidden: true, view: 'workbench' },
      };
    }
    if (!server.ok) {
      return {
        ok: false,
        content: server.text || '',
        error: { code: 'AGENT_WORKBENCH_HTTP', message: server.text || 'context failed' },
      };
    }
    let client = null;
    try {
      client = await deps.invokeBridge('getContext', {});
    } catch {
      client = { ok: false, error: 'bridge_unavailable' };
    }
    const merged = { server: server.json, client };
    return { ok: true, content: JSON.stringify(merged, null, 2), structured: merged };
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
        structured: { authRequired: true, view: 'workbench' },
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
    const out = { server: server.json, bridge };
    const ok = Boolean(bridge && bridge.ok);
    return {
      ok,
      content: JSON.stringify(out, null, 2),
      structured: out,
      error: ok ? undefined : { code: 'AGENT_WORKBENCH_BRIDGE', message: bridge.error || 'open failed' },
    };
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
    const out = { server: server.json, bridge };
    const ok = Boolean(bridge && bridge.ok);
    return {
      ok,
      content: JSON.stringify(out, null, 2),
      structured: out,
      error: ok ? undefined : { code: 'AGENT_WORKBENCH_BRIDGE', message: bridge.error || 'run failed' },
    };
  }

  return { getContext, openProject, runCapability, agentFetch };
}

module.exports = { createAgentWorkbenchClient, WORKBENCH_PARTITION };
