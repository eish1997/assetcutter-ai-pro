'use strict';

const http = require('http');
const { listSkillEntries, readSkillById, listSkillRevisions, readSkillRevision } = require('./agent-skills.cjs');
const { buildToolCatalog } = require('./agent-tool-schemas.cjs');
const {
  WORKBENCH_E2E_REQUIRED_TOOLS,
  WORKBENCH_FLOW_RESOURCE_URI,
  buildWorkbenchFlowDocument,
} = require('./agent-workbench-flow.cjs');
const { createHash, randomBytes, randomUUID } = require('node:crypto');

const DEFAULT_MCP_PORT = 19120;
const MCP_BIND = '127.0.0.1';
const MCP_PROTOCOL_VERSION = '2024-11-05';
const MCP_SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2024-11-05'];
const MCP_SERVER_NAME = 'assetcutter-agent-body';
const MCP_SERVER_TITLE = 'AssetCutter Agent Body';
const MCP_SERVER_VERSION = '0.4.0';
const MCP_LIST_PAGE_SIZE = 100;
const MCP_LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];

/**
 * @param {{
 *   readSettings: () => object;
 *   writeSettings: (patch: object) => object;
 *   bodyHost: { listTools: () => Promise<object[]>; executeTool: (name: string, args: object, ctx: object) => Promise<object> };
 *   gateTool: (tool: { name: string; risk: string }) => 'allow' | 'confirm' | 'deny';
 *   readPolicy: () => object;
 *   waitForConfirm?: (confirmId: string, meta: object) => Promise<boolean | { approved: boolean; reason?: string }>;
 *   appendAudit: (entry: object) => void;
 *   listToolExecutions?: (options?: object) => object[];
 *   getShellView: () => string;
 *   getSkillsRoot?: () => string;
 *   log?: (...args: unknown[]) => void;
 * }} deps
 */
function createAgentBodyMcpServer(deps) {
  /** @type {http.Server | null} */
  let server = null;
  let runningPort = null;
  let loggingLevel = 'info';
  const activeRequests = new Map();
  const subscribedResources = new Map();

  function log(...args) {
    if (typeof deps.log === 'function') deps.log('[agent-mcp]', ...args);
  }

  function argsDigest(args) {
    try {
      return createHash('sha256').update(JSON.stringify(args || {})).digest('hex').slice(0, 16);
    } catch {
      return null;
    }
  }

  function ensureMcpToken(settings) {
    const cur = settings && typeof settings === 'object' ? settings : deps.readSettings();
    if (cur.mcpToken && String(cur.mcpToken).length >= 16) return cur;
    const token = randomBytes(24).toString('hex');
    return deps.writeSettings({ mcpToken: token });
  }

  function authOk(req, settings) {
    if (!settings.mcpEnabled) return false;
    const auth = String(req.headers.authorization || '');
    const token = settings.mcpToken ? String(settings.mcpToken) : '';
    if (!token) return false;
    if (auth === `Bearer ${token}`) return true;
    const headerToken = String(req.headers['x-agent-mcp-token'] || '');
    return headerToken === token;
  }

  function negotiateProtocolVersion(requested) {
    const version = String(requested || '').trim();
    if (version && MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(version)) return version;
    return MCP_PROTOCOL_VERSION;
  }

  function responseProtocolVersion(req, body) {
    if (isObject(body) && body.method === 'initialize') {
      return negotiateProtocolVersion(body.params && body.params.protocolVersion);
    }
    const headerVersion = String(req.headers['mcp-protocol-version'] || '').trim();
    if (MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(headerVersion)) return headerVersion;
    return MCP_PROTOCOL_VERSION;
  }

  function serverInstructions() {
    return [
      'AssetCutter MCP is the local body for the AssetCutter workbench.',
      'Start with ac.shell.get_state, then ac.workbench.ensure_ready before operating projects or capabilities; create a project with ac.workbench.create_project when no project is active, use ac.workbench.list_assets to inspect outputs, and ac.workbench.get_asset for details.',
      'Use tools/list for schemas and assetcutter://mcp/tool-catalog for grouped guidance, example arguments, and success signals.',
      'Confirm-risk tools may require Copilot frontend authorization; keep Copilot open when calling workbench or Script Hub actions.',
      'For long-running calls, send notifications/cancelled with the original JSON-RPC request id if the task should stop.',
    ].join('\n');
  }

  function makeToolCallId() {
    return `mcp_tool_${randomUUID()}`;
  }

  function makeConfirmId() {
    return `cfm_${randomUUID()}`;
  }

  function normalizeConfirmResult(raw) {
    if (raw && typeof raw === 'object' && 'approved' in raw) {
      return {
        approved: Boolean(raw.approved),
        reason: String(raw.reason || (raw.approved ? 'approved' : 'rejected')),
      };
    }
    if (raw === true) return { approved: true, reason: 'approved' };
    return { approved: false, reason: 'rejected' };
  }

  function traceIdFromArgs(args) {
    if (!args || typeof args !== 'object') return null;
    const traceId = args.traceId || args.trace_id || args.conversationId || args.idempotencyKey;
    return traceId ? String(traceId).slice(0, 160) : null;
  }

  function requestIdKey(id) {
    if (id === undefined || id === null) return '';
    return `${typeof id}:${String(id)}`;
  }

  function isAbortSignalAborted(signal) {
    return Boolean(signal && signal.aborted);
  }

  function cancelledToolResult(message) {
    return {
      ok: false,
      content: '',
      error: { code: 'AGENT_CANCELLED', message: message || 'request cancelled' },
    };
  }

  async function waitForConfirmWithSignal(confirmId, meta, signal) {
    if (isAbortSignalAborted(signal)) return { approved: false, reason: 'cancelled' };
    const confirmPromise = deps.waitForConfirm(confirmId, { ...(meta || {}), signal });
    if (!signal) return normalizeConfirmResult(await confirmPromise);
    const cancelPromise = new Promise((resolve) => {
      const onAbort = () => resolve({ approved: false, reason: 'cancelled' });
      signal.addEventListener('abort', onAbort, { once: true });
      confirmPromise.finally(() => signal.removeEventListener('abort', onAbort));
    });
    return normalizeConfirmResult(await Promise.race([confirmPromise, cancelPromise]));
  }

  function toolErrorGuidance(code) {
    if (code === 'AGENT_AUTH_REQUIRED') {
      return '工作台未登录或登录态不可用；请先在工作台完成登录，然后重新调用。';
    }
    if (code === 'AGENT_FORBIDDEN') {
      return '当前账号或策略没有权限执行此操作；请切换账号、项目或让管理员调整权限。';
    }
    if (code === 'AGENT_WORKBENCH_BRIDGE') {
      return '工作台 BrowserView 桥接不可用；请确认工作台已打开并完成加载。';
    }
    if (code === 'AGENT_INPUT_REQUIRED') {
      return '工具缺少必要输入；请查看 structuredContent.requiredInput 或 details，并补齐后重试。';
    }
    if (code === 'AGENT_PROJECT_REQUIRED') {
      return '当前没有可承载结果的工作区项目；请先调用 ac.workbench.create_project，或打开已有项目后重试。';
    }
    if (code === 'AGENT_PROJECT_NOT_FOUND') {
      return '指定工作区项目不存在；请调用 ac.workbench.get_context 获取可用项目 id，或创建新项目。';
    }
    if (code === 'AGENT_PRESET_NOT_FOUND') {
      return '指定能力预设不存在；请调用 ac.workbench.get_context 查看 capabilityPresets 后重试。';
    }
    if (code === 'AGENT_PRESET_NOT_DIRECT_RUNNABLE') {
      return '该能力需要工作台交互，不能直接由 Agent 执行；请换用 directRunSupported=true 的预设。';
    }
    if (code === 'AGENT_ASSET_NOT_FOUND') {
      return '指定资产不存在；请调用 ac.workbench.list_assets 查看可用 assetId 后重试。';
    }
    if (code === 'AGENT_WORKBENCH_HTTP' || code === 'AGENT_COMPANION_HTTP' || code === 'AGENT_SCRIPT_HUB_HTTP') {
      return '下游服务请求失败；请检查工作台/伴侣/Script Hub 状态后重试。';
    }
    if (code === 'AGENT_CONFIRM_REQUIRED') {
      return '需要在 Copilot 或管理员策略里允许这个高风险工具后再执行。';
    }
    if (code === 'AGENT_CONFIRM_REJECTED') {
      return '用户已拒绝本次授权；如果仍要执行，请重新发起并在 Copilot 中允许。';
    }
    if (code === 'AGENT_CONFIRM_TIMEOUT') {
      return '前端授权超时；请保持 Copilot 打开后重新发起调用。';
    }
    if (code === 'AGENT_CONFIRM_CANCELLED') {
      return '授权请求已取消；请重新发起调用。';
    }
    if (code === 'AGENT_CANCELLED') {
      return '请求已被外部 agent 取消；如仍需执行，请重新发起调用。';
    }
    if (code === 'AGENT_TOOL_DENIED') {
      return '当前策略禁止此工具，请切换工具或让管理员调整权限。';
    }
    if (code === 'AGENT_TOOL_UNKNOWN') {
      return '先调用 tools/list 或读取 assetcutter://mcp/tool-catalog，确认工具名是否存在。';
    }
    if (code === 'AGENT_TOOL_INVALID_ARGS') {
      return '根据 tools/list 返回的 inputSchema 修正参数后重试。';
    }
    return '查看 content/error，并结合 assetcutter://mcp/tool-catalog 的 successSignals 决定下一步。';
  }

  function toolErrorAttributes(code) {
    const c = String(code || '');
    const out = {
      authRequired: c === 'AGENT_AUTH_REQUIRED',
      forbidden: c === 'AGENT_FORBIDDEN' || c === 'AGENT_TOOL_DENIED',
      requiresFrontendAuthorization:
        c === 'AGENT_CONFIRM_REQUIRED' || c === 'AGENT_CONFIRM_TIMEOUT' || c === 'AGENT_CONFIRM_CANCELLED',
      requiresInput: c === 'AGENT_INPUT_REQUIRED',
      projectRequired: c === 'AGENT_PROJECT_REQUIRED',
      projectNotFound: c === 'AGENT_PROJECT_NOT_FOUND',
      presetNotFound: c === 'AGENT_PRESET_NOT_FOUND',
      presetNotRunnable: c === 'AGENT_PRESET_NOT_DIRECT_RUNNABLE',
      assetNotFound: c === 'AGENT_ASSET_NOT_FOUND',
      retryable:
        c === 'AGENT_CONFIRM_REQUIRED' ||
        c === 'AGENT_CONFIRM_TIMEOUT' ||
        c === 'AGENT_CONFIRM_CANCELLED' ||
        c === 'AGENT_INPUT_REQUIRED' ||
        c === 'AGENT_PROJECT_REQUIRED' ||
        c === 'AGENT_PROJECT_NOT_FOUND' ||
        c === 'AGENT_PRESET_NOT_FOUND' ||
        c === 'AGENT_ASSET_NOT_FOUND' ||
        c === 'AGENT_AUTH_REQUIRED' ||
        c === 'AGENT_WORKBENCH_BRIDGE' ||
        c === 'AGENT_WORKBENCH_HTTP' ||
        c === 'AGENT_COMPANION_HTTP' ||
        c === 'AGENT_SCRIPT_HUB_HTTP',
    };
    if (c === 'AGENT_AUTH_REQUIRED') {
      out.view = 'workbench';
      out.action = 'open_workbench_login';
      out.recoveryTool = {
        name: 'ac.shell.navigate',
        arguments: { view: 'workbench' },
        after: 'Wait for the user to finish login in the workbench view, then retry the failed workbench tool.',
      };
    } else if (out.requiresFrontendAuthorization) {
      out.action = 'approve_in_copilot';
    } else if (out.projectRequired) {
      out.action = 'create_or_open_project';
    } else if (out.retryable) {
      out.action = 'retry_after_recovery';
    }
    return out;
  }

  function structuredRecoveryAttributes(structured) {
    const root = structured && typeof structured === 'object' ? structured : {};
    const bridge = root.bridge && typeof root.bridge === 'object' ? root.bridge : {};
    const requiredInput = root.requiredInput || bridge.requiredInput || null;
    const requiresInput = Boolean(root.requiresInput || bridge.requiresInput || requiredInput);
    const bridgeError = String(bridge.error || root.error || '');
    const projectRequired = Boolean(root.projectRequired || bridge.projectRequired || bridgeError === 'project_required');
    const projectNotFound = Boolean(root.projectNotFound || bridge.projectNotFound || bridgeError === 'project_not_found');
    const presetNotFound = Boolean(root.presetNotFound || bridge.presetNotFound || bridgeError === 'preset_not_found');
    const presetNotRunnable = Boolean(
      root.presetNotRunnable || bridge.presetNotRunnable || bridgeError === 'preset_not_direct_runnable',
    );
    const assetNotFound = Boolean(root.assetNotFound || bridge.assetNotFound || bridgeError === 'asset_not_found');
    return {
      ...(requiresInput ? { requiresInput: true } : {}),
      ...(requiredInput ? { requiredInput: String(requiredInput) } : {}),
      ...(projectRequired ? { projectRequired: true } : {}),
      ...(projectNotFound ? { projectNotFound: true } : {}),
      ...(presetNotFound ? { presetNotFound: true } : {}),
      ...(presetNotRunnable ? { presetNotRunnable: true } : {}),
      ...(assetNotFound ? { assetNotFound: true } : {}),
    };
  }

  async function executeMcpTool(name, args, requestMeta) {
    const startedAt = Date.now();
    const toolCallId = makeToolCallId();
    const jsonRpcId =
      requestMeta && Object.prototype.hasOwnProperty.call(requestMeta, 'jsonRpcId') ? requestMeta.jsonRpcId : null;
    const signal = requestMeta && requestMeta.signal ? requestMeta.signal : null;
    const traceId = traceIdFromArgs(args);
    const append = (result, policyDecision) => {
      const durationMs = Date.now() - startedAt;
      deps.appendAudit({
        ts: new Date().toISOString(),
        clientId: 'mcp',
        sessionId: 'mcp',
        brainId: 'external',
        toolCallId,
        jsonRpcId,
        traceId,
        tool: name,
        ok: result.ok,
        errorCode: result.error?.code || null,
        argsDigest: argsDigest(args),
        durationMs,
        policyDecision: policyDecision || null,
      });
      result.mcp = {
        toolCallId,
        jsonRpcId,
        traceId,
        durationMs,
        policyDecision: policyDecision || null,
        nextStep: result.ok ? '继续根据 structuredContent 或 content 判断是否需要下一步工具。' : toolErrorGuidance(result.error?.code),
      };
    };
    if (isAbortSignalAborted(signal)) {
      const result = cancelledToolResult();
      append(result, 'cancelled');
      return result;
    }
    const tools = await deps.bodyHost.listTools();
    const schema = tools.find((t) => t.name === name);
    if (!schema) {
      const result = {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_UNKNOWN', message: name },
      };
      append(result, 'unknown');
      return result;
    }
    const gate = deps.gateTool(schema);
    if (gate === 'deny') {
      const result = {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_DENIED', message: 'policy denied' },
      };
      append(result, 'deny');
      return result;
    }
    if (gate === 'confirm') {
      const policy = deps.readPolicy();
      const auto = Array.isArray(policy.autoConfirmTools) ? policy.autoConfirmTools : [];
      if (!auto.includes(name)) {
        if (typeof deps.waitForConfirm !== 'function') {
          const result = {
            ok: false,
            content: '',
            error: {
              code: 'AGENT_CONFIRM_REQUIRED',
              message: 'confirm tool requires policy autoConfirmTools or Copilot UI',
            },
            structured: {
              clientId: 'mcp',
              requiresFrontendAuthorization: true,
              confirmId: null,
              confirmReason: 'copilot_ui_unavailable',
              nextStep: '请打开 Copilot 前端，或由管理员将该工具加入 autoConfirmTools 后重试。',
            },
          };
          append(result, 'confirm_required');
          return result;
        }
        const confirmId = makeConfirmId();
        const confirmResult = await waitForConfirmWithSignal(
          confirmId,
          {
            name,
            arguments: args && typeof args === 'object' ? args : {},
            clientId: 'mcp',
            sessionId: 'mcp',
            toolCallId,
            traceId,
            timeoutMs: 120000,
          },
          signal,
        );
        if (!confirmResult.approved) {
          const code =
            confirmResult.reason === 'timeout'
              ? 'AGENT_CONFIRM_TIMEOUT'
              : confirmResult.reason === 'cancelled'
                ? 'AGENT_CONFIRM_CANCELLED'
                : 'AGENT_CONFIRM_REJECTED';
          const result = {
            ok: false,
            content: '',
            error: {
              code,
              message:
                code === 'AGENT_CONFIRM_TIMEOUT'
                  ? 'confirm timeout'
                  : code === 'AGENT_CONFIRM_CANCELLED'
                    ? 'confirm cancelled'
                    : 'user rejected',
            },
            structured: {
              clientId: 'mcp',
              requiresFrontendAuthorization: code !== 'AGENT_CONFIRM_REJECTED',
              confirmId,
              confirmReason: confirmResult.reason || 'rejected',
              nextStep:
                code === 'AGENT_CONFIRM_TIMEOUT'
                  ? 'Copilot 前端授权超时。请保持 Copilot 打开并重新发起调用。'
                  : code === 'AGENT_CONFIRM_CANCELLED'
                    ? '请求已取消。如仍需执行，请重新发起调用。'
                    : '用户已拒绝本次工具授权。如仍需执行，请解释目的后重新发起调用。',
            },
          };
          append(result, confirmResult.reason === 'timeout' ? 'confirm_timeout' : 'confirm_rejected');
          return result;
        }
      }
    }
    if (isAbortSignalAborted(signal)) {
      const result = cancelledToolResult();
      append(result, 'cancelled');
      return result;
    }
    const ctx = {
      sessionId: 'mcp',
      brainId: 'external',
      shellView: deps.getShellView(),
      clientId: 'mcp',
      toolCallId,
      traceId,
      signal,
    };
    const result = await deps.bodyHost.executeTool(name, args && typeof args === 'object' ? args : {}, ctx);
    append(result, gate === 'confirm' ? 'auto_confirm' : 'allow');
    return result;
  }

  function isObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function isNotification(body) {
    return isObject(body) && !Object.prototype.hasOwnProperty.call(body, 'id');
  }

  function jsonRpcError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    return { jsonrpc: '2.0', id: id ?? null, error };
  }

  function textFromToolResult(result) {
    if (result && typeof result.content === 'string' && result.content) return result.content;
    if (result && result.structured !== undefined) {
      try {
        return JSON.stringify(result.structured, null, 2);
      } catch {
        return String(result.structured);
      }
    }
    return '';
  }

  function mcpToolCallResult(result) {
    const ok = Boolean(result && result.ok);
    const error = ok ? null : (result && result.error) || { code: 'AGENT_TOOL_EXEC_FAILED', message: 'tool failed' };
    const text = ok ? textFromToolResult(result) : JSON.stringify(error);
    const mcp = result && result.mcp && typeof result.mcp === 'object' ? result.mcp : {};
    const attrs = toolErrorAttributes(error && error.code);
    const recoveryAttrs = !ok ? structuredRecoveryAttributes(result && result.structured) : {};
    const out = {
      content: [{ type: 'text', text }],
      isError: !ok,
      _meta: {
        assetcutter: {
          ok,
          error,
          toolCallId: mcp.toolCallId || null,
          jsonRpcId: mcp.jsonRpcId ?? null,
          traceId: mcp.traceId || null,
          durationMs: Number.isFinite(Number(mcp.durationMs)) ? Number(mcp.durationMs) : null,
          policyDecision: mcp.policyDecision || null,
          nextStep: mcp.nextStep || null,
          ...(!ok ? { ...attrs, ...recoveryAttrs } : {}),
        },
      },
    };
    if (ok && result && result.structured !== undefined) out.structuredContent = result.structured;
    if (!ok) {
      out.structuredContent = {
        ok: false,
        error,
        details: result && result.structured !== undefined ? result.structured : null,
        toolCallId: mcp.toolCallId || null,
        jsonRpcId: mcp.jsonRpcId ?? null,
        traceId: mcp.traceId || null,
        durationMs: Number.isFinite(Number(mcp.durationMs)) ? Number(mcp.durationMs) : null,
        policyDecision: mcp.policyDecision || null,
        nextStep: mcp.nextStep || null,
        ...attrs,
        ...recoveryAttrs,
      };
    }
    return out;
  }

  function encodeCursor(offset) {
    return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
  }

  function decodeCursor(cursor) {
    if (!cursor) return 0;
    try {
      const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
      const offset = Number(parsed && parsed.offset);
      return Number.isInteger(offset) && offset >= 0 ? offset : 0;
    } catch {
      return 0;
    }
  }

  function paginateList(items, params, pageSize = MCP_LIST_PAGE_SIZE) {
    const list = Array.isArray(items) ? items : [];
    const start = Math.min(list.length, decodeCursor(params && params.cursor));
    const size = Math.max(1, Number(pageSize) || MCP_LIST_PAGE_SIZE);
    const end = Math.min(list.length, start + size);
    const result = list.slice(start, end);
    const out = { items: result };
    if (end < list.length) out.nextCursor = encodeCursor(end);
    return out;
  }

  function completionResult(values, rawValue) {
    const needle = String(rawValue || '').toLowerCase();
    const unique = [];
    const seen = new Set();
    for (const raw of Array.isArray(values) ? values : []) {
      const value = String(raw || '').trim();
      if (!value || seen.has(value)) continue;
      if (needle && !value.toLowerCase().includes(needle)) continue;
      seen.add(value);
      unique.push(value);
    }
    const page = unique.slice(0, 100);
    return {
      completion: {
        values: page,
        total: unique.length,
        hasMore: unique.length > page.length,
      },
    };
  }

  function completeArgument(params) {
    const ref = params && typeof params.ref === 'object' ? params.ref : {};
    const argument = params && typeof params.argument === 'object' ? params.argument : {};
    const contextArgs =
      params && params.context && typeof params.context.arguments === 'object' ? params.context.arguments : {};
    const argName = String(argument.name || '').trim();
    const value = argument.value || '';
    const refType = String(ref.type || '');
    const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
    const skills = listSkillEntries(root);

    if (argName === 'document' || String(ref.uri || ref.uriTemplate || '').startsWith('assetcutter://mcp/')) {
      return completionResult(
        ['manifest', 'tool-catalog', 'quickstart', 'workbench-flow', 'policy', 'server-status', 'tool-executions'],
        value,
      );
    }
    if (argName === 'skillId' || refType === 'ref/prompt' || refType === 'prompt') {
      return completionResult(skills.map((s) => s.id), value);
    }
    if (argName === 'revision') {
      const skillId = String(contextArgs.skillId || contextArgs.id || '').trim();
      const revisionValues = [];
      if (skillId) {
        const revisions = listSkillRevisions(root, skillId);
        if (revisions.ok) {
          for (const revision of revisions.revisions || []) revisionValues.push(String(revision.revision));
        }
      } else {
        for (const skill of skills) {
          const revisions = listSkillRevisions(root, skill.id);
          if (!revisions.ok) continue;
          for (const revision of revisions.revisions || []) revisionValues.push(String(revision.revision));
        }
      }
      return completionResult(revisionValues, value);
    }
    return completionResult([], value);
  }

  function builtInResources() {
    return [
      {
        uri: 'assetcutter://mcp/manifest',
        name: 'AssetCutter MCP Manifest',
        description: 'Versioned machine-readable contract for AssetCutter MCP capabilities and extension points.',
        mimeType: 'application/json',
      },
      {
        uri: 'assetcutter://mcp/tool-catalog',
        name: 'AssetCutter MCP Tool Catalog',
        description: 'Grouped ac.* tool catalog with risk levels, surfaces, and input schemas.',
        mimeType: 'application/json',
      },
      {
        uri: 'assetcutter://mcp/quickstart',
        name: 'AssetCutter MCP Quickstart',
        description: 'Concise integration guide for external agents calling AssetCutter tools.',
        mimeType: 'text/markdown',
      },
      {
        uri: WORKBENCH_FLOW_RESOURCE_URI,
        name: 'AssetCutter Workbench Flow',
        description: 'Machine-readable workbench task contract, required tool chain, recovery codes, and E2E gates.',
        mimeType: 'application/json',
      },
      {
        uri: 'assetcutter://mcp/policy',
        name: 'AssetCutter MCP Policy',
        description: 'Sanitized permission policy and per-tool gate decisions for external agents.',
        mimeType: 'application/json',
      },
      {
        uri: 'assetcutter://mcp/server-status',
        name: 'AssetCutter MCP Server Status',
        description: 'Local MCP server status without exposing the bearer token.',
        mimeType: 'application/json',
      },
      {
        uri: 'assetcutter://mcp/tool-executions',
        name: 'AssetCutter MCP Tool Executions',
        description: 'Recent sanitized tool execution records for external agent traceability.',
        mimeType: 'application/json',
      },
    ];
  }

  function resourceTemplates() {
    return [
      {
        uriTemplate: 'assetcutter://mcp/{document}',
        name: 'AssetCutter MCP Documents',
        title: 'AssetCutter MCP Documents',
        description: 'Read built-in MCP documents such as manifest, tool-catalog, workbench-flow, server-status, and tool-executions.',
        mimeType: 'application/json',
      },
      {
        uriTemplate: 'skill://{skillId}',
        name: 'AssetCutter Skill',
        title: 'AssetCutter Skill',
        description: 'Read a reusable skill/workflow by skill id.',
        mimeType: 'application/json',
      },
      {
        uriTemplate: 'skill://{skillId}/revisions',
        name: 'AssetCutter Skill Revisions',
        title: 'AssetCutter Skill Revisions',
        description: 'Read revision summaries for a reusable skill/workflow.',
        mimeType: 'application/json',
      },
      {
        uriTemplate: 'skill://{skillId}/revisions/{revision}',
        name: 'AssetCutter Skill Revision',
        title: 'AssetCutter Skill Revision',
        description: 'Read a specific revision of a reusable skill/workflow.',
        mimeType: 'application/json',
      },
    ];
  }

  function skillRevisionResources(skillsRoot, skills) {
    const out = [];
    for (const skill of Array.isArray(skills) ? skills : []) {
      const revisions = listSkillRevisions(skillsRoot, skill.id);
      if (!revisions.ok) continue;
      for (const revision of revisions.revisions || []) {
        out.push({
          uri: `skill://${skill.id}/revisions/${revision.revision}`,
          name: `${skill.name || skill.id} Revision ${revision.revision}`,
          description: `${revision.kind || 'revision'} version of ${skill.name || skill.id}`,
          mimeType: 'application/json',
        });
      }
    }
    return out;
  }

  function resourceUriExists(uri) {
    const wanted = String(uri || '').trim();
    if (!wanted) return false;
    if (builtInResources().some((r) => r.uri === wanted)) return true;
    const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
    const skills = listSkillEntries(root);
    if (skills.some((s) => `skill://${s.id}` === wanted || `skill://${s.id}/revisions` === wanted)) return true;
    return skillRevisionResources(root, skills).some((r) => r.uri === wanted);
  }

  async function readBuiltInResource(uri) {
    if (uri === 'assetcutter://mcp/manifest') {
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            schemaVersion: 1,
            protocolVersion: MCP_PROTOCOL_VERSION,
            supportedProtocolVersions: MCP_SUPPORTED_PROTOCOL_VERSIONS,
            serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
            capabilities: {
              tools: true,
              resources: true,
              resourceSubscriptions: true,
              prompts: true,
              completions: true,
              logging: true,
              cancellation: true,
            },
            logging: {
              level: loggingLevel,
              levels: MCP_LOG_LEVELS,
              note: 'AssetCutter currently stores request/audit traceability through resources instead of streaming log notifications.',
            },
            instructions: serverInstructions(),
            namespaces: {
              tools: ['ac.shell.*', 'ac.workbench.*', 'ac.script_hub.*', 'ac.companion.*', 'ac.skills.*', 'ac.memory.*'],
              resources: ['assetcutter://mcp/*', 'skill://*'],
              prompts: ['skill:*'],
            },
            recovery: {
              structuredFields: [
                'authRequired',
                'forbidden',
                'requiresFrontendAuthorization',
                'retryable',
                'requiresInput',
                'nextStep',
                'recoveryTool',
              ],
              loginRecoveryTool: {
                name: 'ac.shell.navigate',
                arguments: { view: 'workbench' },
                after: 'Wait for the user to finish login in the workbench view, then retry the failed workbench tool.',
              },
              workbenchFlowResource: WORKBENCH_FLOW_RESOURCE_URI,
              serverStatusResource: 'assetcutter://mcp/server-status',
            },
            resources: builtInResources().map((r) => ({
              uri: r.uri,
              name: r.name,
              mimeType: r.mimeType,
            })),
            extensionGuidance: {
              addTool: 'Register the tool schema in agent-tool-schemas.cjs and dispatch it in agent-body-host.cjs.',
              addPrompt: 'Add a skill under agent-store/skills with skill.json or SKILL.md.',
              policy: 'High-risk tools should use risk=confirm and can be managed through policy.json.',
            },
          },
          null,
          2,
        ),
      };
    }
    if (uri === 'assetcutter://mcp/tool-catalog') {
      const tools = await deps.bodyHost.listTools();
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(buildToolCatalog(tools), null, 2),
      };
    }
    if (uri === 'assetcutter://mcp/quickstart') {
      return {
        uri,
        mimeType: 'text/markdown',
        text: [
          '# AssetCutter MCP Quickstart',
          '',
          'Use this server as the local body for AssetCutter. It exposes workbench, script hub, companion runtime, skills, and memory tools under the `ac.*` namespace.',
          '',
          'Recommended flow:',
          '',
          '1. Call `initialize`, then `tools/list`.',
          '2. Call `ac.shell.get_state` to inspect the current shell, pairing, brain, and workbench state.',
          '3. Call `ac.workbench.ensure_ready` before opening projects or running workbench capabilities; it navigates to the workbench, checks login/project/capability readiness, and can create a project when `requireProject=true` and `createIfMissing=true`.',
          '4. If you need an explicit project creation step, call `ac.workbench.create_project`; after generation, call `ac.workbench.list_assets` and `ac.workbench.get_asset` to verify outputs.',
          '5. Read `assetcutter://mcp/policy` before confirm-risk tools to know whether they will run, prompt, or be denied.',
          '6. Use safe tools freely for inspection. Use confirm-risk tools only when user intent is clear and policy allows it.',
          '7. Read `assetcutter://mcp/tool-catalog` for grouped tool guidance and example arguments.',
          '8. Read `resources/templates/list` and `prompts/list` to discover reusable team workflows.',
          '9. Use `completion/complete` for resource template arguments such as `document`, `skillId`, and `revision`.',
          '10. For `ac.workbench.run_capability`, first ensure there is an active project, then inspect `capabilityPresets` from `ac.workbench.ensure_ready`/`ac.workbench.get_context`: only call presets with `directRunSupported=true`; pass `inputText` for text/prompt input, `imageDataUrl` for direct image input, or `inputAssetId`/`inputAssetDisplayKey` to use an existing workbench asset as input.',
          '11. Treat `authRequired`, `forbidden`, `requiresFrontendAuthorization`, `retryable`, `requiresInput`, `nextStep`, and `recoveryTool` in `structuredContent` as the recovery contract; if `authRequired` is true, call `ac.shell.navigate` with `{ "view": "workbench" }`, wait for the user to log in, then retry the failed workbench tool.',
          '12. Read `assetcutter://mcp/server-status` before workbench E2E validation. After the workbench is logged in, run `npm run smoke:agent-mcp:e2e -- --config <hermes-mcp-import.json>` to verify create project -> run capability -> list assets -> get asset.',
          '',
          'Important resources:',
          '',
          '- `assetcutter://mcp/manifest`: versioned machine-readable server contract.',
          '- `assetcutter://mcp/tool-catalog`: grouped tools with risk, surfaces, examples, and success signals.',
          '- `assetcutter://mcp/workbench-flow`: machine-readable workbench task flow, recovery contract, and E2E gates.',
          '- `assetcutter://mcp/policy`: sanitized permission policy and per-tool gate decisions.',
          '- `assetcutter://mcp/server-status`: local server status without exposing the bearer token.',
          '- `assetcutter://mcp/tool-executions`: recent sanitized tool execution records for traceability.',
          '- `skill://{skillId}`: reusable skill/workflow definition.',
        ].join('\n'),
      };
    }
    if (uri === WORKBENCH_FLOW_RESOURCE_URI) {
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(buildWorkbenchFlowDocument(), null, 2),
      };
    }
    if (uri === 'assetcutter://mcp/policy') {
      const policy = deps.readPolicy();
      const tools = await deps.bodyHost.listTools();
      const decisions = tools
        .map((tool) => {
          const name = String(tool.name || '');
          const risk = String(tool.risk || 'safe');
          const decision = deps.gateTool(tool);
          return {
            name,
            risk,
            decision,
            requiresFrontendAuthorization: decision === 'confirm',
            autoConfirmed: decision === 'allow' && risk === 'confirm',
            forbidden: decision === 'deny',
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            confirmTools: Boolean(policy.confirmTools),
            autoConfirmTools: Array.isArray(policy.autoConfirmTools) ? policy.autoConfirmTools.map(String).sort() : [],
            forbiddenTools: Array.isArray(policy.forbiddenTools) ? policy.forbiddenTools.map(String).sort() : [],
            toolDecisions: decisions,
            guidance: {
              allow: 'Tool can run without a frontend prompt under the current policy.',
              confirm: 'Tool requires Copilot frontend authorization unless the admin adds it to autoConfirmTools.',
              deny: 'Tool is blocked by policy and should not be retried until an admin changes the policy.',
            },
          },
          null,
          2,
        ),
      };
    }
    if (uri === 'assetcutter://mcp/server-status') {
      const s = status();
      const settings = deps.readSettings();
      const policy = deps.readPolicy();
      const tools = await deps.bodyHost.listTools();
      const executions =
        typeof deps.listToolExecutions === 'function' ? deps.listToolExecutions({ days: 1, limit: 12 }) : [];
      const riskCounts = tools.reduce(
        (acc, tool) => {
          const risk = String(tool && tool.risk ? tool.risk : 'safe');
          acc[risk] = (acc[risk] || 0) + 1;
          return acc;
        },
        {},
      );
      let shellView = 'unknown';
      try {
        shellView = String(deps.getShellView() || 'unknown');
      } catch {
        shellView = 'unknown';
      }
      const workbenchVisible = shellView === 'workbench';
      const workbenchNextStep = workbenchVisible
        ? 'Call ac.workbench.get_context. If it returns authRequired, use recoveryTool ac.shell.navigate({ view: "workbench" }), complete login, then retry.'
        : 'Call ac.shell.navigate with view=workbench, wait for the page to load, then call ac.workbench.get_context.';
      const workbenchLoginRecoveryTool = {
        name: 'ac.shell.navigate',
        arguments: { view: 'workbench' },
        after: 'Wait for the user to finish login in the workbench view, then retry the failed workbench tool.',
      };
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            ...s,
            tokenHint: s.hasToken ? 'configured' : 'missing',
            hasToken: Boolean(s.hasToken),
            shellView,
            toolCount: tools.length,
            riskCounts,
            policy: {
              confirmTools: Boolean(policy.confirmTools),
              autoConfirmToolCount: Array.isArray(policy.autoConfirmTools) ? policy.autoConfirmTools.length : 0,
              forbiddenToolCount: Array.isArray(policy.forbiddenTools) ? policy.forbiddenTools.length : 0,
            },
            recentToolExecutionCount: Array.isArray(executions) ? executions.length : 0,
            readiness: {
              mcp: Boolean(s.enabled && s.running && s.hasToken),
              frontendAuthorizationAvailable: shellView !== 'unknown',
              workbenchLikelyVisible: workbenchVisible,
              workbenchOperation: workbenchVisible ? 'probe_context' : 'navigate_first',
              workbenchNextStep,
              inAppE2e: 'Open Companion Settings -> External Agent (MCP) -> 工作台验收 to run the same MCP workbench chain inside the product.',
              e2eCommand: 'npm run smoke:agent-mcp:e2e -- --config <hermes-mcp-import.json>',
              recoveryTools: {
                authRequired: workbenchLoginRecoveryTool,
              },
              recoveryContract: [
                'authRequired means the workbench browser session is not logged in; call recoveryTools.authRequired, complete login, then retry.',
                'requiresFrontendAuthorization means Copilot must stay open so the user can approve or deny the action.',
                'projectRequired means create/open a project before running capabilities.',
                'requiresInput means provide imageDataUrl, inputAssetId, or other required arguments from structuredContent.',
              ],
              note: workbenchNextStep,
            },
          },
          null,
          2,
        ),
      };
    }
    if (uri === 'assetcutter://mcp/tool-executions') {
      const executions =
        typeof deps.listToolExecutions === 'function' ? deps.listToolExecutions({ days: 7, limit: 80 }) : [];
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            windowDays: 7,
            limit: 80,
            executions: Array.isArray(executions) ? executions : [],
            guidance: {
              correlate: 'Use toolCallId, traceId, and jsonRpcId to connect MCP responses with execution records.',
              privacy: 'Arguments are not stored here; argsDigest is a short hash for correlation only.',
            },
          },
          null,
          2,
        ),
      };
    }
    return null;
  }

  function skillToPrompt(skill) {
    return {
      name: `skill:${skill.id}`,
      description: skill.description || skill.name || skill.id,
      arguments: [],
      _meta: {
        assetcutter: {
          skillId: skill.id,
          title: skill.name || skill.id,
          toolHints: Array.isArray(skill.toolHints) ? skill.toolHints : [],
        },
      },
    };
  }

  function skillPromptId(promptName) {
    const raw = String(promptName || '').trim();
    return raw.startsWith('skill:') ? raw.slice('skill:'.length) : raw;
  }

  function toolToMcpTool(t) {
    const surfaces = Array.isArray(t.surfaces) ? t.surfaces.map(String) : [];
    const risk = String(t.risk || 'safe');
    const catalogTool = buildToolCatalog([t]).surfaces?.[0]?.tools?.[0] || {};
    return {
      name: t.name,
      title: catalogTool.title || t.title || t.name,
      description: t.description || t.name,
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
      annotations: {
        destructiveHint: risk === 'confirm' || risk === 'forbidden',
        readOnlyHint: risk === 'safe',
        openWorldHint: surfaces.some((s) => s !== 'shell'),
      },
      _meta: {
        assetcutter: {
          risk,
          surfaces,
          deprecated: Boolean(t.deprecated),
          whenToUse: catalogTool.whenToUse || '',
          exampleArguments: catalogTool.exampleArguments || {},
          successSignals: Array.isArray(catalogTool.successSignals) ? catalogTool.successSignals : [],
        },
      },
    };
  }

  async function handleJsonRpc(body) {
    if (!isObject(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return jsonRpcError(body && body.id, -32600, 'Invalid Request');
    }

    const method = body.method;
    const id = Object.prototype.hasOwnProperty.call(body, 'id') ? body.id : undefined;
    const params = body?.params && typeof body.params === 'object' ? body.params : {};

    if (isNotification(body)) {
      if (method === 'notifications/cancelled') {
        const key = requestIdKey(params.requestId);
        const active = key ? activeRequests.get(key) : null;
        if (active && active.controller) {
          active.controller.abort(String(params.reason || 'cancelled'));
          deps.appendAudit({
            ts: new Date().toISOString(),
            clientId: 'mcp',
            sessionId: 'mcp',
            brainId: 'external',
            action: 'mcp_cancel_requested',
            jsonRpcId: params.requestId ?? null,
            reason: params.reason ? String(params.reason).slice(0, 240) : null,
          });
        }
        return undefined;
      }
      if (method === 'notifications/initialized' || method === 'initialized' || method.startsWith('notifications/')) {
        return undefined;
      }
    }

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          protocolVersion: negotiateProtocolVersion(params.protocolVersion),
            capabilities: {
              tools: { listChanged: true },
              resources: { listChanged: true, subscribe: true },
              prompts: { listChanged: true },
              completions: {},
              logging: {},
            },
          serverInfo: {
            name: MCP_SERVER_NAME,
            title: MCP_SERVER_TITLE,
            version: MCP_SERVER_VERSION,
            description: 'Local MCP body for AssetCutter workbench, Script Hub, companion runtime, skills, and memory.',
          },
          instructions: serverInstructions(),
        },
      };
    }

    if (method === 'tools/list') {
      const tools = await deps.bodyHost.listTools();
      const page = paginateList(tools.map(toolToMcpTool), params);
      const result = { tools: page.items };
      if (page.nextCursor) result.nextCursor = page.nextCursor;
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result,
      };
    }

    if (method === 'tools/call') {
      const name = String(params.name || '');
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const key = requestIdKey(id);
      const controller = new AbortController();
      if (key) activeRequests.set(key, { controller, method, startedAt: Date.now() });
      let result;
      try {
        result = await executeMcpTool(name, args, { jsonRpcId: id ?? null, signal: controller.signal });
      } finally {
        if (key) activeRequests.delete(key);
      }
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: mcpToolCallResult(result),
      };
    }

    if (method === 'skills/list' || method === 'ac/skills/list') {
      const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
      const skills = listSkillEntries(root);
      const page = paginateList(skills, params);
      const result = { skills: page.items };
      if (page.nextCursor) result.nextCursor = page.nextCursor;
      return { jsonrpc: '2.0', id: id ?? null, result };
    }

    if (method === 'prompts/list') {
      const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
      const skills = listSkillEntries(root);
      const page = paginateList(skills.map(skillToPrompt), params);
      const result = { prompts: page.items };
      if (page.nextCursor) result.nextCursor = page.nextCursor;
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result,
      };
    }

    if (method === 'prompts/get') {
      const promptName = String(params.name || '');
      const skillId = skillPromptId(promptName);
      const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
      const skill = readSkillById(root, skillId);
      if (!skill) {
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          error: { code: -32002, message: `prompt not found: ${promptName}` },
        };
      }
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          description: skill.description || skill.name || skill.id,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: skill.prompt || skill.description || skill.name || skill.id,
              },
            },
          ],
          _meta: {
            assetcutter: {
              skillId: skill.id,
              title: skill.name || skill.id,
              toolHints: Array.isArray(skill.toolHints) ? skill.toolHints : [],
            },
          },
        },
      };
    }

    if (method === 'resources/list') {
      const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
      const skills = listSkillEntries(root);
      const resources = [
        ...builtInResources(),
        ...skills.map((s) => ({
          uri: `skill://${s.id}`,
          name: s.name,
          description: s.description || s.name,
          mimeType: 'application/json',
        })),
        ...skills.map((s) => ({
          uri: `skill://${s.id}/revisions`,
          name: `${s.name} Revisions`,
          description: `Revision history for ${s.name || s.id}`,
          mimeType: 'application/json',
        })),
        ...skillRevisionResources(root, skills),
      ];
      const page = paginateList(resources, params);
      const result = { resources: page.items };
      if (page.nextCursor) result.nextCursor = page.nextCursor;
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result,
      };
    }

    if (method === 'resources/templates/list') {
      const page = paginateList(resourceTemplates(), params);
      const result = { resourceTemplates: page.items };
      if (page.nextCursor) result.nextCursor = page.nextCursor;
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result,
      };
    }

    if (method === 'resources/subscribe') {
      const uri = String(params.uri || '').trim();
      if (!uri) return jsonRpcError(id ?? null, -32602, 'Invalid params', { reason: 'uri required' });
      if (!resourceUriExists(uri)) return jsonRpcError(id ?? null, -32002, `resource not found: ${uri}`);
      subscribedResources.set(uri, {
        uri,
        subscribedAt: new Date().toISOString(),
        jsonRpcId: id ?? null,
      });
      deps.appendAudit({
        ts: new Date().toISOString(),
        clientId: 'mcp',
        sessionId: 'mcp',
        brainId: 'external',
        action: 'mcp_resource_subscribed',
        uri,
        jsonRpcId: id ?? null,
      });
      return { jsonrpc: '2.0', id: id ?? null, result: {} };
    }

    if (method === 'resources/unsubscribe') {
      const uri = String(params.uri || '').trim();
      if (!uri) return jsonRpcError(id ?? null, -32602, 'Invalid params', { reason: 'uri required' });
      subscribedResources.delete(uri);
      deps.appendAudit({
        ts: new Date().toISOString(),
        clientId: 'mcp',
        sessionId: 'mcp',
        brainId: 'external',
        action: 'mcp_resource_unsubscribed',
        uri,
        jsonRpcId: id ?? null,
      });
      return { jsonrpc: '2.0', id: id ?? null, result: {} };
    }

    if (method === 'completion/complete') {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: completeArgument(params),
      };
    }

    if (method === 'logging/setLevel') {
      const level = String(params.level || '').trim();
      if (!MCP_LOG_LEVELS.includes(level)) {
        return jsonRpcError(id ?? null, -32602, 'Invalid params', {
          reason: 'unsupported logging level',
          supportedLevels: MCP_LOG_LEVELS,
        });
      }
      loggingLevel = level;
      deps.appendAudit({
        ts: new Date().toISOString(),
        clientId: 'mcp',
        sessionId: 'mcp',
        brainId: 'external',
        action: 'mcp_logging_level_set',
        level,
      });
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {},
      };
    }

    if (method === 'resources/read') {
      const uri = String(params.uri || '');
      const builtIn = await readBuiltInResource(uri);
      if (builtIn) {
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: { contents: [builtIn] },
        };
      }
      const revisionMatch = uri.match(/^skill:\/\/(.+)\/revisions\/(\d+)$/);
      if (revisionMatch) {
        const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
        const revisionRead = readSkillRevision(root, revisionMatch[1], revisionMatch[2]);
        if (!revisionRead.ok) {
          return {
            jsonrpc: '2.0',
            id: id ?? null,
            error: { code: -32002, message: `skill revision not found: ${revisionMatch[1]}#${revisionMatch[2]}` },
          };
        }
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            contents: [
              {
                uri: revisionRead.resourceUri,
                mimeType: 'application/json',
                text: JSON.stringify(revisionRead, null, 2),
              },
            ],
          },
        };
      }
      if (uri.startsWith('skill://') && uri.endsWith('/revisions')) {
        const revisionSkillId = uri.slice('skill://'.length, -'/revisions'.length);
        const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
        const revisions = listSkillRevisions(root, revisionSkillId);
        if (!revisions.ok) {
          return {
            jsonrpc: '2.0',
            id: id ?? null,
            error: { code: -32002, message: `skill revisions not found: ${revisionSkillId}` },
          };
        }
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            contents: [
              {
                uri: `skill://${revisions.skillId}/revisions`,
                mimeType: 'application/json',
                text: JSON.stringify(revisions, null, 2),
              },
            ],
          },
        };
      }
      const skillId = uri.startsWith('skill://') ? uri.slice('skill://'.length) : uri;
      const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
      const skill = readSkillById(root, skillId);
      if (!skill) {
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          error: { code: -32002, message: `skill not found: ${skillId}` },
        };
      }
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          contents: [
            {
              uri: `skill://${skill.id}`,
              mimeType: 'application/json',
              text: JSON.stringify(skill, null, 2),
            },
          ],
        },
      };
    }

    if (method === 'ping') {
      return { jsonrpc: '2.0', id: id ?? null, result: {} };
    }

    if (isNotification(body)) return undefined;
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }

  async function handleJsonRpcEnvelope(body) {
    if (!Array.isArray(body)) return handleJsonRpc(body);
    if (body.length === 0) return jsonRpcError(null, -32600, 'Invalid Request');
    const responses = [];
    for (const item of body) {
      const out = await handleJsonRpc(item);
      if (out !== undefined) responses.push(out);
    }
    return responses.length ? responses : undefined;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  async function handleHttp(req, res) {
    const settings = deps.readSettings();
    res.setHeader('Access-Control-Allow-Origin', 'null');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Agent-Mcp-Token');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && (req.url === '/health' || req.url === '/mcp/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, enabled: Boolean(settings.mcpEnabled), port: runningPort }));
      return;
    }

    if (!settings.mcpEnabled) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'mcp_disabled' }));
      return;
    }

    if (!authOk(req, settings)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized', code: 'AGENT_MCP_AUTH_REQUIRED' }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    const pathOnly = String(req.url || '/').split('?')[0];
    if (pathOnly !== '/' && pathOnly !== '/mcp' && !pathOnly.endsWith('/mcp')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : null;
      const protocolVersion = responseProtocolVersion(req, body);
      const out = await handleJsonRpcEnvelope(body);
      if (out === undefined) {
        res.writeHead(202, { 'MCP-Protocol-Version': protocolVersion });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'MCP-Protocol-Version': protocolVersion });
      res.end(JSON.stringify(out));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: msg } }));
    }
  }

  async function stop() {
    if (!server) return { ok: true, running: false };
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    server = null;
    runningPort = null;
    log('stopped');
    return { ok: true, running: false };
  }

  async function start() {
    await stop();
    let settings = deps.readSettings();
    if (!settings.mcpEnabled) {
      return { ok: true, running: false, enabled: false };
    }
    settings = ensureMcpToken(settings);
    const port = Number.isFinite(Number(settings.mcpPort))
      ? Math.min(65535, Math.max(1024, Number(settings.mcpPort)))
      : DEFAULT_MCP_PORT;

    server = http.createServer((req, res) => {
      void handleHttp(req, res);
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, MCP_BIND, () => resolve());
    });
    runningPort = port;
    log(`listening http://${MCP_BIND}:${port}/ (POST JSON-RPC)`);
    return {
      ok: true,
      running: true,
      enabled: true,
      port,
      bind: MCP_BIND,
      tokenHint: settings.mcpToken ? `${String(settings.mcpToken).slice(0, 8)}…` : null,
    };
  }

  async function syncFromSettings() {
    const settings = deps.readSettings();
    if (settings.mcpEnabled) return start();
    return stop();
  }

  function status() {
    const settings = deps.readSettings();
    return {
      enabled: Boolean(settings.mcpEnabled),
      running: Boolean(server && server.listening),
      port: runningPort || settings.mcpPort || DEFAULT_MCP_PORT,
      bind: MCP_BIND,
      hasToken: Boolean(settings.mcpToken),
      activeRequestCount: activeRequests.size,
      subscribedResourceCount: subscribedResources.size,
      subscribedResources: Array.from(subscribedResources.keys()).sort(),
      loggingLevel,
    };
  }

  function regenerateToken() {
    const token = randomBytes(24).toString('hex');
    deps.writeSettings({ mcpToken: token });
    return { ok: true, tokenPreview: `${token.slice(0, 8)}…` };
  }

  function requestJsonRpc(payload, timeoutMs) {
    const settings = deps.readSettings();
    const port = runningPort || settings.mcpPort || DEFAULT_MCP_PORT;
    const token = settings.mcpToken ? String(settings.mcpToken) : '';
    const raw = JSON.stringify(payload);
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: MCP_BIND,
          port,
          path: '/mcp',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(raw),
            Authorization: `Bearer ${token}`,
          },
          timeout: Number(timeoutMs) || 5000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              /* keep text */
            }
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, json, text });
          });
        },
      );
      req.on('timeout', () => {
        req.destroy(new Error('mcp probe timeout'));
      });
      req.on('error', (e) => {
        resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      });
      req.end(raw);
    });
  }

  function toolStructured(call) {
    return (call && call.json && call.json.result && call.json.result.structuredContent) || {};
  }

  function toolErrorCode(call) {
    const result = (call && call.json && call.json.result) || {};
    const meta = (result._meta && result._meta.assetcutter) || {};
    const structured = result.structuredContent || {};
    return (
      (meta.error && meta.error.code) ||
      (structured.error && structured.error.code) ||
      meta.errorCode ||
      structured.errorCode ||
      ''
    );
  }

  function toolNextStep(call) {
    const result = (call && call.json && call.json.result) || {};
    const meta = (result._meta && result._meta.assetcutter) || {};
    const structured = result.structuredContent || {};
    return meta.nextStep || structured.nextStep || (result.content && result.content[0] && result.content[0].text) || '';
  }

  function toolRecoveryTool(call) {
    const result = (call && call.json && call.json.result) || {};
    const meta = (result._meta && result._meta.assetcutter) || {};
    const structured = result.structuredContent || {};
    return meta.recoveryTool || structured.recoveryTool || null;
  }

  function isWorkbenchLoginRecoveryTool(recoveryTool) {
    return Boolean(
      recoveryTool &&
        recoveryTool.name === 'ac.shell.navigate' &&
        recoveryTool.arguments &&
        recoveryTool.arguments.view === 'workbench',
    );
  }

  function delay(ms) {
    const n = Math.max(0, Number(ms) || 0);
    if (!n) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, n));
  }

  function isToolSuccess(call) {
    return Boolean(call && call.ok && call.json && call.json.result && call.json.result.isError === false);
  }

  async function callMcpTool(name, args, id, timeoutMs) {
    return requestJsonRpc(
      { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args || {} } },
      timeoutMs || 60000,
    );
  }

  function chooseWorkbenchPreset(context) {
    const presets = Array.isArray(context && context.capabilityPresets) ? context.capabilityPresets : [];
    return (
      presets.find((p) => p && p.directRunSupported === true && p.acceptsText === true && p.requiresImage !== true) ||
      presets.find((p) => p && p.directRunSupported === true && p.requiresImage !== true) ||
      null
    );
  }

  function e2eFail(step, call, fallback) {
    const errorCode = toolErrorCode(call) || (call && call.statusCode) || 'AGENT_MCP_E2E_FAILED';
    const structured = toolStructured(call);
    const recoveryAttrs = {
      ...toolErrorAttributes(errorCode),
      ...structuredRecoveryAttributes(structured),
    };
    const action =
      errorCode === 'AGENT_AUTH_REQUIRED'
        ? 'open_workbench_login'
        : recoveryAttrs.requiresFrontendAuthorization
          ? 'approve_in_copilot'
          : recoveryAttrs.projectRequired
            ? 'create_or_open_project'
            : recoveryAttrs.retryable
              ? 'retry_after_recovery'
              : 'inspect_failure';
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      failedStep: step,
      errorCode,
      nextStep: toolNextStep(call) || fallback || '请检查 MCP、工作台登录状态和当前项目后重试。',
      ...recoveryAttrs,
      ...(errorCode === 'AGENT_AUTH_REQUIRED' ? { view: 'workbench' } : {}),
      action,
      response: call
        ? {
            ok: Boolean(call.ok),
            statusCode: call.statusCode || null,
            json: call.json || null,
            error: call.error || null,
          }
        : null,
    };
  }

  async function runWorkbenchE2eSelf(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const recoveryWaitMs = Math.max(0, Number(opts.recoveryWaitMs) || 0);
    const checkedAt = new Date().toISOString();
    const state = status();
    const settings = deps.readSettings();
    const endpoint = `http://${MCP_BIND}:${runningPort || settings.mcpPort || DEFAULT_MCP_PORT}/mcp`;
    if (!state.enabled) return { ok: false, endpoint, checkedAt, failedStep: 'mcp.enabled', errorCode: 'MCP_DISABLED', nextStep: '请先开启 MCP 控制本平台。' };
    if (!state.running) return { ok: false, endpoint, checkedAt, failedStep: 'mcp.running', errorCode: 'MCP_NOT_RUNNING', nextStep: '请保存设置或重启本地伴侣，让 MCP 服务启动。' };
    if (!settings.mcpToken) return { ok: false, endpoint, checkedAt, failedStep: 'mcp.token', errorCode: 'MCP_TOKEN_MISSING', nextStep: '请重新生成 MCP Token 后重试。' };

    const steps = [];
    const toolsCall = await requestJsonRpc({ jsonrpc: '2.0', id: 'workbench-e2e-tools', method: 'tools/list', params: {} }, 10000);
    if (!toolsCall.ok || !toolsCall.json || toolsCall.json.error) {
      return e2eFail('tools/list', toolsCall, 'MCP 握手失败，请先运行协议自检。');
    }
    const tools = Array.isArray(toolsCall.json.result && toolsCall.json.result.tools) ? toolsCall.json.result.tools : [];
    const advertised = new Set(tools.map((t) => t && t.name).filter(Boolean));
    const requiredTools = WORKBENCH_E2E_REQUIRED_TOOLS;
    const missing = requiredTools.filter((name) => !advertised.has(name));
    if (missing.length) {
      return {
        ok: false,
        endpoint,
        checkedAt,
        failedStep: 'tools.required',
        errorCode: 'MCP_WORKBENCH_TOOLS_MISSING',
        nextStep: `缺少工作台工具：${missing.join(', ')}。请检查工具注册。`,
        missingTools: missing,
      };
    }
    steps.push({ id: 'tools', ok: true, detail: `${tools.length} tools` });

    let readyCall = await callMcpTool(
      'ac.workbench.ensure_ready',
      { requireProject: false },
      'workbench-e2e-ensure-ready',
      30000,
    );
    if (!isToolSuccess(readyCall)) {
      const recoveryTool = toolRecoveryTool(readyCall);
      if (isWorkbenchLoginRecoveryTool(recoveryTool)) {
        const recoveryCall = await callMcpTool(
          recoveryTool.name,
          recoveryTool.arguments,
          'workbench-e2e-recovery-login',
          30000,
        );
        if (!isToolSuccess(recoveryCall)) {
          return e2eFail('ac.shell.navigate', recoveryCall, '请手动打开工作台登录后重试。');
        }
        steps.push({
          id: 'recovery_tool',
          ok: true,
          tool: recoveryTool.name,
          arguments: recoveryTool.arguments,
          waitMs: recoveryWaitMs,
        });
        if (recoveryWaitMs > 0) await delay(recoveryWaitMs);
        readyCall = await callMcpTool(
          'ac.workbench.ensure_ready',
          { requireProject: false },
          'workbench-e2e-ensure-ready-retry',
          30000,
        );
      }
      if (!isToolSuccess(readyCall)) {
        const failed = e2eFail('ac.workbench.ensure_ready', readyCall, '请打开工作台并完成登录后重试。');
        failed.steps = steps;
        return failed;
      }
    }
    steps.push({ id: 'ensure_ready', ok: true });

    const contextCall = await callMcpTool('ac.workbench.get_context', {}, 'workbench-e2e-context', 30000);
    if (!isToolSuccess(contextCall)) {
      return e2eFail('ac.workbench.get_context', contextCall, '请确认工作台页面已加载完成。');
    }
    const context = toolStructured(contextCall);
    steps.push({
      id: 'get_context',
      ok: true,
      detail: `${(context.projects || []).length} projects / ${(context.capabilityPresets || []).length} presets`,
    });

    let projectId = String(context.activeProjectId || '').trim();
    if (!projectId) {
      const createCall = await callMcpTool(
        'ac.workbench.create_project',
        { name: `MCP 验收 ${new Date().toISOString().replace(/[:.]/g, '-')}` },
        'workbench-e2e-create-project',
        30000,
      );
      if (!isToolSuccess(createCall)) {
        return e2eFail('ac.workbench.create_project', createCall, '请确认当前账号有创建项目权限。');
      }
      const created = toolStructured(createCall);
      projectId = String(created.projectId || (created.project && created.project.id) || '').trim();
      if (!projectId) {
        return {
          ok: false,
          endpoint,
          checkedAt,
          failedStep: 'ac.workbench.create_project',
          errorCode: 'PROJECT_ID_MISSING',
          nextStep: '创建项目成功但没有返回 projectId，请检查桥接返回结构。',
        };
      }
      steps.push({ id: 'create_project', ok: true, detail: projectId });
    } else {
      steps.push({ id: 'project', ok: true, detail: projectId });
    }

    const preset = chooseWorkbenchPreset(context);
    if (!preset) {
      return {
        ok: false,
        endpoint,
        checkedAt,
        failedStep: 'capability.preset',
        errorCode: 'DIRECT_RUN_PRESET_MISSING',
        nextStep: '当前工作台没有可直接运行的文本能力预设，请先添加或开放 directRunSupported 能力。',
      };
    }
    steps.push({ id: 'preset', ok: true, detail: preset.id });

    const runCall = await callMcpTool(
      'ac.workbench.run_capability',
      {
        projectId,
        presetId: preset.id,
        inputText: 'MCP 验收：请生成一句 AssetCutter 工作台链路已打通的简短说明。',
      },
      'workbench-e2e-run-capability',
      120000,
    );
    if (!isToolSuccess(runCall)) {
      return e2eFail('ac.workbench.run_capability', runCall, '请确认该能力支持直接运行，并检查模型/额度/输入要求。');
    }
    const run = toolStructured(runCall);
    const assetId = String(run.assetId || (run.output && run.output.assetId) || '').trim();
    if (!assetId || !run.resultKey) {
      return {
        ok: false,
        endpoint,
        checkedAt,
        failedStep: 'ac.workbench.run_capability',
        errorCode: 'RUN_OUTPUT_MISSING',
        nextStep: '能力运行成功但没有返回 assetId/resultKey，请检查桥接输出结构。',
        run,
      };
    }
    steps.push({ id: 'run_capability', ok: true, detail: `${assetId} / ${run.resultKey}` });

    const listCall = await callMcpTool(
      'ac.workbench.list_assets',
      { projectId, limit: 20 },
      'workbench-e2e-list-assets',
      30000,
    );
    if (!isToolSuccess(listCall)) {
      return e2eFail('ac.workbench.list_assets', listCall, '请确认项目资产列表可读取。');
    }
    const list = toolStructured(listCall);
    const assets = Array.isArray(list.assets) ? list.assets : [];
    if (!assets.some((asset) => asset && asset.id === assetId)) {
      return {
        ok: false,
        endpoint,
        checkedAt,
        failedStep: 'ac.workbench.list_assets',
        errorCode: 'CREATED_ASSET_NOT_LISTED',
        nextStep: '能力产物没有出现在资产列表，请检查持久化和列表过滤条件。',
        assetId,
      };
    }
    steps.push({ id: 'list_assets', ok: true, detail: `${assets.length} returned` });

    const getCall = await callMcpTool(
      'ac.workbench.get_asset',
      { projectId, assetId },
      'workbench-e2e-get-asset',
      30000,
    );
    if (!isToolSuccess(getCall)) {
      return e2eFail('ac.workbench.get_asset', getCall, '请确认新资产详情可读取。');
    }
    const detail = toolStructured(getCall);
    if (!detail || (!detail.text && !detail.resultMeta && !detail.media)) {
      return {
        ok: false,
        endpoint,
        checkedAt,
        failedStep: 'ac.workbench.get_asset',
        errorCode: 'ASSET_DETAIL_EMPTY',
        nextStep: '资产详情缺少文本或结果元数据，请检查 get_asset 返回结构。',
        assetId,
      };
    }
    steps.push({ id: 'get_asset', ok: true, detail: detail.displayKey || assetId });

    return {
      ok: true,
      endpoint,
      checkedAt,
      projectId,
      presetId: preset.id,
      assetId,
      resultKey: run.resultKey,
      steps,
      nextStep: 'MCP 工作台链路已通过验收，外部 agent 可以按 ensure_ready → run_capability → list_assets → get_asset 调用。',
    };
  }

  async function probeSelf() {
    const settings = deps.readSettings();
    const port = runningPort || settings.mcpPort || DEFAULT_MCP_PORT;
    const endpoint = `http://${MCP_BIND}:${port}/mcp`;
    const checkedAt = new Date().toISOString();
    const state = status();
    if (!state.enabled) {
      return { ok: false, endpoint, checkedAt, state, error: 'mcp_disabled' };
    }
    if (!state.running) {
      return { ok: false, endpoint, checkedAt, state, error: 'mcp_not_running' };
    }
    if (!settings.mcpToken) {
      return { ok: false, endpoint, checkedAt, state, error: 'mcp_token_missing' };
    }

    const init = await requestJsonRpc(
      { jsonrpc: '2.0', id: 'probe-init', method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      5000,
    );
    if (!init.ok || !init.json || init.json.error) {
      return { ok: false, endpoint, checkedAt, state, step: 'initialize', probe: init };
    }

    const tools = await requestJsonRpc({ jsonrpc: '2.0', id: 'probe-tools', method: 'tools/list', params: {} }, 5000);
    if (!tools.ok || !tools.json || tools.json.error) {
      return { ok: false, endpoint, checkedAt, state, step: 'tools/list', probe: tools };
    }

    const listedTools = Array.isArray(tools.json.result?.tools) ? tools.json.result.tools : [];
    return {
      ok: true,
      endpoint,
      checkedAt,
      state,
      protocolVersion: init.json.result?.protocolVersion || null,
      serverInfo: init.json.result?.serverInfo || null,
      toolCount: listedTools.length,
      toolsSample: listedTools.slice(0, 8).map((t) => t.name).filter(Boolean),
    };
  }

  function buildMcpClientConfig() {
    const settings = deps.readSettings();
    const port = runningPort || settings.mcpPort || DEFAULT_MCP_PORT;
    const token = settings.mcpToken ? String(settings.mcpToken) : '<token>';
    return {
      mcpServers: {
        'assetcutter-body': {
          url: `http://${MCP_BIND}:${port}/mcp`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    };
  }

  return {
    start,
    stop,
    syncFromSettings,
    status,
    regenerateToken,
    probeSelf,
    runWorkbenchE2eSelf,
    ensureMcpToken,
    buildMcpClientConfig,
    DEFAULT_MCP_PORT,
  };
}

module.exports = { createAgentBodyMcpServer, DEFAULT_MCP_PORT };
