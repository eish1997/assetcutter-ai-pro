'use strict';

const os = require('os');
const path = require('path');
const { fetchWithPartition, classifyAgentHttpStatus } = require('./agent-partition-fetch.cjs');

const SCRIPT_HUB_PARTITION = 'persist:assetcutter-script-hub';
const INTEGRATION_VERSION = 2;
const CALLER_AGENT = {
  id: 'companion-copilot',
  name: 'AssetCutter Companion Copilot',
  version: '1.0.0',
  transport: 'http',
};

/**
 * @param {{
 *   getScriptHubApiUrl: () => string;
 *   getScriptHubApiToken?: () => string;
 *   normalizeScriptHubApiUrl: (raw: string) => string;
 *   navigateShell: (view: string) => Promise<{ ok: boolean; error?: string }>;
 *   fetchImpl?: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: unknown; text: string }>;
 * }} deps
 */
function createAgentScriptHubClient(deps) {
  async function defaultFetch(url, init) {
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

  const fetchImpl = deps.fetchImpl || defaultFetch;

  function apiOrigin() {
    const href = deps.normalizeScriptHubApiUrl(deps.getScriptHubApiUrl());
    if (!href) return '';
    try {
      return new URL(href).origin;
    } catch {
      return '';
    }
  }

  async function toolBridgeFetch(pathname, init) {
    const origin = apiOrigin();
    if (!origin) {
      return { ok: false, status: 0, json: null, text: '', error: 'invalid_script_hub_api_url' };
    }
    const path = String(pathname || '').startsWith('/') ? pathname : `/${pathname}`;
    const url = `${origin}${path}`;
    const token =
      typeof deps.getScriptHubApiToken === 'function' ? String(deps.getScriptHubApiToken() || '').trim() : '';
    const headers = {
      ...(init && init.headers ? init.headers : {}),
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    try {
      return await fetchImpl(url, { ...init, headers });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, status: 0, json: null, text: msg, error: msg };
    }
  }

  function unwrapEnvelope(r) {
    if (!r.ok || !r.json || typeof r.json !== 'object') {
      return { ok: false, envelope: null, data: null, error: r };
    }
    const env = /** @type {{ ok?: boolean; data?: unknown; error?: { message?: string; code?: string } }} */ (r.json);
    if (env.ok === false) {
      const msg = env.error?.message || r.text || 'tool bridge error';
      return { ok: false, envelope: env, data: null, error: { ...r, detail: msg, code: env.error?.code } };
    }
    return { ok: true, envelope: env, data: env.data, error: null };
  }

  function authErrorResult(r) {
    if (r.authRequired) {
      const token =
        typeof deps.getScriptHubApiToken === 'function' ? String(deps.getScriptHubApiToken() || '').trim() : '';
      const message = token
        ? 'ScriptHub Tool Bridge 鉴权失败，请检查设置中的 scriptHubApiToken 是否与 SCRIPTHUB_TOOL_BRIDGE_TOKEN 一致'
        : 'ScriptHub 需要登录或 Tool Bridge Token：请在脚本页登录，或在伴侣设置中填写 scriptHubApiToken';
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_AUTH_REQUIRED', message },
        structured: { authRequired: true, view: 'scripts', tokenConfigured: Boolean(token) },
      };
    }
    if (r.forbidden) {
      return {
        ok: false,
        content: r.text || '',
        error: { code: 'AGENT_FORBIDDEN', message: r.detail || r.text || 'forbidden' },
      };
    }
    return null;
  }

  function resolveRunPayload(args) {
    const toolName = String(args.toolName || args.tool_name || '').trim();
    if (toolName) {
      const input = args.input && typeof args.input === 'object' ? args.input : {};
      return { toolName, input };
    }

    const scriptId = String(args.scriptId || '').trim();
    const revisionId = String(args.revisionId || '').trim();
    const targetType = String(args.targetType || '').trim();
    if (!scriptId || !revisionId || !targetType) {
      return null;
    }
    const params = args.params && typeof args.params === 'object' ? args.params : {};
    const outputPath =
      String(params.output_path || params.outputPath || '').trim() ||
      path.join(os.tmpdir(), 'scripthub-export.fbx');
    return {
      toolName: 'scriptHub.task.create',
      input: {
        capability_id: scriptId,
        output_path: outputPath,
        overwrite: Boolean(params.overwrite),
        revision_id: revisionId,
        target_type: targetType,
      },
    };
  }

  async function listScripts(args) {
    await deps.navigateShell('scripts');
    const r = await toolBridgeFetch('/tool-bridge/tools', { method: 'GET' });
    const authErr = authErrorResult(r);
    if (authErr) return authErr;
    const parsed = unwrapEnvelope(r);
    if (!parsed.ok) {
      return {
        ok: false,
        content: r.text || '',
        error: {
          code: 'AGENT_SCRIPT_HUB_HTTP',
          message: parsed.error?.detail || r.text || 'list tools failed',
        },
      };
    }

    let tools = Array.isArray(parsed.data) ? parsed.data : [];
    const limit = Number(args && args.limit);
    if (Number.isFinite(limit) && limit > 0) {
      tools = tools.slice(0, Math.min(100, Math.floor(limit)));
    }

    const structured = {
      integrationVersion: INTEGRATION_VERSION,
      tools,
      count: tools.length,
    };
    return { ok: true, content: JSON.stringify(structured, null, 2), structured };
  }

  async function runScript(args) {
    const resolved = resolveRunPayload(args || {});
    if (!resolved) {
      return {
        ok: false,
        content: '',
        error: {
          code: 'AGENT_TOOL_INVALID_ARGS',
          message: 'toolName+input or scriptId/revisionId/targetType required',
        },
      };
    }

    await deps.navigateShell('scripts');
    const conversationId =
      String(args.conversationId || args.conversation_id || '').trim() ||
      `conv_companion_${Date.now()}`;
    const body = {
      tool_name: resolved.toolName,
      tool_version: '1.0.0',
      conversation_id: conversationId,
      trace_id: String(args.traceId || args.trace_id || '').trim() || undefined,
      caller_agent: CALLER_AGENT,
      input: resolved.input,
      requested_at: new Date().toISOString(),
    };
    if (args.idempotencyKey || args.idempotency_key) {
      body.idempotency_key = String(args.idempotencyKey || args.idempotency_key);
    }

    const r = await toolBridgeFetch('/tool-bridge/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const authErr = authErrorResult(r);
    if (authErr) return authErr;
    const parsed = unwrapEnvelope(r);
    if (!parsed.ok) {
      return {
        ok: false,
        content: r.text || '',
        error: {
          code: 'AGENT_SCRIPT_HUB_HTTP',
          message: parsed.error?.detail || r.text || 'run tool failed',
        },
      };
    }

    const structured = {
      integrationVersion: INTEGRATION_VERSION,
      ...(parsed.data && typeof parsed.data === 'object' ? parsed.data : { raw: parsed.data }),
    };
    return { ok: true, content: JSON.stringify(structured, null, 2), structured };
  }

  async function getRun(args) {
    const toolCallId = String(args.toolCallId || args.tool_call_id || args.runId || args.run_id || '').trim();
    if (!toolCallId) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_INVALID_ARGS', message: 'toolCallId or runId required' },
      };
    }

    const r = await toolBridgeFetch(`/tool-bridge/calls/${encodeURIComponent(toolCallId)}`, {
      method: 'GET',
    });
    const authErr = authErrorResult(r);
    if (authErr) return authErr;
    const parsed = unwrapEnvelope(r);
    if (!parsed.ok) {
      return {
        ok: false,
        content: r.text || '',
        error: {
          code: 'AGENT_SCRIPT_HUB_HTTP',
          message: parsed.error?.detail || r.text || 'get tool call failed',
        },
      };
    }

    const structured = {
      integrationVersion: INTEGRATION_VERSION,
      ...(parsed.data && typeof parsed.data === 'object' ? parsed.data : { raw: parsed.data }),
    };
    return { ok: true, content: JSON.stringify(structured, null, 2), structured };
  }

  async function exportMayaSelection(args) {
    const outputPath = String(args.outputPath || args.output_path || '').trim();
    if (!outputPath) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_INVALID_ARGS', message: 'outputPath required' },
      };
    }
    return runScript({
      toolName: 'scriptHub.maya.export_selection_fbx',
      input: {
        output_path: outputPath,
        overwrite: Boolean(args.overwrite),
      },
      conversationId: args.conversationId || args.conversation_id,
      traceId: args.traceId || args.trace_id,
      idempotencyKey: args.idempotencyKey || args.idempotency_key,
    });
  }

  return { listScripts, runScript, getRun, exportMayaSelection, INTEGRATION_VERSION };
}

module.exports = { createAgentScriptHubClient, SCRIPT_HUB_PARTITION, INTEGRATION_VERSION };
