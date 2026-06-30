'use strict';

const http = require('http');
const { listSkillEntries, readSkillById } = require('./agent-skills.cjs');
const { createHash, randomBytes } = require('node:crypto');

const DEFAULT_MCP_PORT = 19120;
const MCP_BIND = '127.0.0.1';

/**
 * @param {{
 *   readSettings: () => object;
 *   writeSettings: (patch: object) => object;
 *   bodyHost: { listTools: () => Promise<object[]>; executeTool: (name: string, args: object, ctx: object) => Promise<object> };
 *   gateTool: (tool: { name: string; risk: string }) => 'allow' | 'confirm' | 'deny';
 *   readPolicy: () => object;
 *   appendAudit: (entry: object) => void;
 *   getShellView: () => string;
 *   getSkillsRoot?: () => string;
 *   log?: (...args: unknown[]) => void;
 * }} deps
 */
function createAgentBodyMcpServer(deps) {
  /** @type {http.Server | null} */
  let server = null;
  let runningPort = null;

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

  async function executeMcpTool(name, args) {
    const tools = await deps.bodyHost.listTools();
    const schema = tools.find((t) => t.name === name);
    if (!schema) {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_UNKNOWN', message: name },
      };
    }
    const gate = deps.gateTool(schema);
    if (gate === 'deny') {
      return {
        ok: false,
        content: '',
        error: { code: 'AGENT_TOOL_DENIED', message: 'policy denied' },
      };
    }
    if (gate === 'confirm') {
      const policy = deps.readPolicy();
      const auto = Array.isArray(policy.autoConfirmTools) ? policy.autoConfirmTools : [];
      if (!auto.includes(name)) {
        return {
          ok: false,
          content: '',
          error: {
            code: 'AGENT_CONFIRM_REQUIRED',
            message: 'confirm tool requires policy autoConfirmTools or Copilot UI',
          },
        };
      }
    }
    const ctx = {
      sessionId: 'mcp',
      brainId: 'external',
      shellView: deps.getShellView(),
      clientId: 'mcp',
    };
    const result = await deps.bodyHost.executeTool(name, args && typeof args === 'object' ? args : {}, ctx);
    deps.appendAudit({
      ts: new Date().toISOString(),
      clientId: 'mcp',
      sessionId: 'mcp',
      brainId: 'external',
      tool: name,
      ok: result.ok,
      errorCode: result.error?.code || null,
      argsDigest: argsDigest(args),
    });
    return result;
  }

  async function handleJsonRpc(body) {
    const method = String(body?.method || '');
    const id = body?.id ?? null;
    const params = body?.params && typeof body.params === 'object' ? body.params : {};

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'assetcutter-agent-body', version: '0.2.0' },
        },
      };
    }

    if (method === 'tools/list') {
      const tools = await deps.bodyHost.listTools();
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description || t.name,
            inputSchema: t.inputSchema || { type: 'object', properties: {} },
          })),
        },
      };
    }

    if (method === 'tools/call') {
      const name = String(params.name || '');
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const result = await executeMcpTool(name, args);
      const text = result.ok ? result.content : JSON.stringify(result.error || {});
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text }],
          isError: !result.ok,
        },
      };
    }

    if (method === 'skills/list' || method === 'ac/skills/list') {
      const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
      const skills = listSkillEntries(root);
      return { jsonrpc: '2.0', id, result: { skills } };
    }

    if (method === 'resources/list') {
      const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
      const skills = listSkillEntries(root);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: skills.map((s) => ({
            uri: `skill://${s.id}`,
            name: s.name,
            description: s.description || s.name,
            mimeType: 'application/json',
          })),
        },
      };
    }

    if (method === 'resources/read') {
      const uri = String(params.uri || '');
      const skillId = uri.startsWith('skill://') ? uri.slice('skill://'.length) : uri;
      const root = typeof deps.getSkillsRoot === 'function' ? deps.getSkillsRoot() : '';
      const skill = readSkillById(root, skillId);
      if (!skill) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32002, message: `skill not found: ${skillId}` },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
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
      return { jsonrpc: '2.0', id, result: {} };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
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
      const body = raw ? JSON.parse(raw) : {};
      const out = await handleJsonRpc(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: msg } }));
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
    };
  }

  function regenerateToken() {
    const token = randomBytes(24).toString('hex');
    deps.writeSettings({ mcpToken: token });
    return { ok: true, tokenPreview: `${token.slice(0, 8)}…` };
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
    ensureMcpToken,
    buildMcpClientConfig,
    DEFAULT_MCP_PORT,
  };
}

module.exports = { createAgentBodyMcpServer, DEFAULT_MCP_PORT };
