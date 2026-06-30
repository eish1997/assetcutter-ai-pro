'use strict';

const { fetchWithPartition, classifyAgentHttpStatus } = require('./agent-partition-fetch.cjs');

const SCRIPT_HUB_PARTITION = 'persist:assetcutter-script-hub';

/**
 * @param {{
 *   getScriptHubUrl: () => string;
 *   normalizeScriptHubUrl: (raw: string) => string;
 *   navigateShell: (view: string) => Promise<{ ok: boolean; error?: string }>;
 * }} deps
 */
function createAgentScriptHubClient(deps) {
  function apiBase() {
    const href = deps.normalizeScriptHubUrl(deps.getScriptHubUrl());
    if (!href) return '';
    try {
      return new URL('/api/', new URL(href).origin).href.replace(/\/$/, '');
    } catch {
      return '';
    }
  }

  async function scriptHubFetch(pathname, init) {
    const base = apiBase();
    if (!base) {
      return { ok: false, status: 0, json: null, text: '', error: 'invalid_script_hub_url' };
    }
    const path = String(pathname || '').startsWith('/') ? pathname : `/${pathname}`;
    const url = `${base}${path}`;
    try {
      const r = await fetchWithPartition(SCRIPT_HUB_PARTITION, url, {
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

  async function listScripts(args) {
    await deps.navigateShell('scripts');
    const limit = Number(args && args.limit);
    const qs = Number.isFinite(limit) && limit > 0 ? `?limit=${Math.min(100, Math.floor(limit))}` : '';
    const r = await scriptHubFetch(`/scripts${qs}`, { method: 'GET' });
    if (r.authRequired) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_AUTH_REQUIRED', message: '请在脚本页登录 Script Hub' },
        structured: { authRequired: true, view: 'scripts' },
      };
    }
    if (r.forbidden) {
      return {
        ok: false,
        content: r.text || '',
        error: { code: 'AGENT_FORBIDDEN', message: r.detail || r.text || 'list forbidden' },
      };
    }
    if (!r.ok) {
      return {
        ok: false,
        content: r.text || '',
        error: { code: 'AGENT_SCRIPT_HUB_HTTP', message: r.text || 'list failed' },
      };
    }
    return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
  }

  async function runScript(args) {
    const scriptId = String(args.scriptId || '').trim();
    const revisionId = String(args.revisionId || '').trim();
    const targetType = String(args.targetType || '').trim();
    if (!scriptId || !revisionId || !targetType) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_INVALID_ARGS', message: 'scriptId/revisionId/targetType required' },
      };
    }
    await deps.navigateShell('scripts');
    const body = {
      scriptId,
      revisionId,
      targetType,
      params: args.params && typeof args.params === 'object' ? args.params : {},
      client: 'companion-agent',
    };
    const r = await scriptHubFetch('/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.authRequired) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_AUTH_REQUIRED', message: '请在脚本页登录 Script Hub' },
      };
    }
    if (r.forbidden) {
      return {
        ok: false,
        content: r.text || '',
        error: { code: 'AGENT_FORBIDDEN', message: r.detail || r.text || 'run forbidden' },
      };
    }
    if (!r.ok) {
      return {
        ok: false,
        content: r.text || '',
        error: { code: 'AGENT_SCRIPT_HUB_HTTP', message: r.text || 'run failed' },
      };
    }
    return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
  }

  async function getRun(args) {
    const runId = String(args.runId || '').trim();
    if (!runId) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_INVALID_ARGS', message: 'missing runId' },
      };
    }
    const r = await scriptHubFetch(`/runs/${encodeURIComponent(runId)}`, { method: 'GET' });
    if (r.authRequired) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_AUTH_REQUIRED', message: '请在脚本页登录 Script Hub' },
      };
    }
    if (r.forbidden) {
      return {
        ok: false,
        content: r.text || '',
        error: { code: 'AGENT_FORBIDDEN', message: r.detail || r.text || 'get run forbidden' },
      };
    }
    if (!r.ok) {
      return {
        ok: false,
        content: r.text || '',
        error: { code: 'AGENT_SCRIPT_HUB_HTTP', message: r.text || 'get run failed' },
      };
    }
    return { ok: true, content: JSON.stringify(r.json, null, 2), structured: r.json };
  }

  return { listScripts, runScript, getRun };
}

module.exports = { createAgentScriptHubClient, SCRIPT_HUB_PARTITION };
