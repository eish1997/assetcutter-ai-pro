'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { workbenchStandardFlowText } = require('../agent-workbench-flow.cjs');
const {
  DEFAULT_CODEX_MCP_TOKEN_ENV,
  buildCodexSpawnEnv,
  upsertCodexMcpServerConfig,
} = require('../codex-mcp-config.cjs');

function defaultCodexCommand() {
  return process.platform === 'win32' ? 'codex.cmd' : 'codex';
}

function spawnCodex(command, args, options) {
  return spawn(command, args, {
    ...(options || {}),
    shell: process.platform === 'win32',
    windowsHide: true,
  });
}

function spawnCodexForDeps(deps, command, args, options) {
  if (deps && typeof deps.spawnCodex === 'function') {
    return deps.spawnCodex(command, args, options || {});
  }
  return spawnCodex(command, args, options);
}

function upsertCodexMcpServerConfigForDeps(deps, options) {
  if (deps && typeof deps.upsertCodexMcpServerConfig === 'function') {
    return deps.upsertCodexMcpServerConfig(options || {});
  }
  return upsertCodexMcpServerConfig(options);
}

function defaultCodexCwd(deps) {
  const envCwd = String(process.env.COMPANION_AGENT_CODEX_CWD || '').trim();
  if (envCwd) return envCwd;
  if (deps && deps.store && typeof deps.store.codexWorkspaceDir === 'function') {
    try {
      return deps.store.codexWorkspaceDir();
    } catch {
      /* fall through */
    }
  }
  try {
    return path.resolve(__dirname, '..', '..');
  } catch {
    return process.cwd();
  }
}

function normalizeSandbox(value) {
  const v = String(value || '').trim();
  if (v === 'read-only' || v === 'workspace-write' || v === 'danger-full-access') return v;
  return 'workspace-write';
}

function settingsFromStore(deps) {
  const s = deps && deps.store && typeof deps.store.readSettings === 'function' ? deps.store.readSettings() : {};
  return {
    command: String(process.env.COMPANION_AGENT_CODEX_COMMAND || s.codexCommand || defaultCodexCommand()).trim(),
    cwd: String(process.env.COMPANION_AGENT_CODEX_CWD || s.codexCwd || defaultCodexCwd(deps)).trim(),
    model: String(process.env.COMPANION_AGENT_CODEX_MODEL || s.codexModel || '').trim(),
    sandbox: normalizeSandbox(process.env.COMPANION_AGENT_CODEX_SANDBOX || s.codexSandbox),
  };
}

function agentSettingsFromStore(deps) {
  return deps && deps.store && typeof deps.store.readSettings === 'function' ? deps.store.readSettings() : {};
}

function sessionsFile(deps) {
  if (!deps || !deps.store || typeof deps.store.brainsDir !== 'function') return null;
  try {
    return path.join(deps.store.brainsDir(), 'codex-sessions.json');
  } catch {
    return null;
  }
}

function readSessionMap(deps) {
  const file = sessionsFile(deps);
  if (!file || !fs.existsSync(file)) return {};
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function writeSessionMap(deps, map) {
  const file = sessionsFile(deps);
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(map || {}, null, 2)}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}

function buildInitialPrompt(input) {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const lastUser = [...messages].reverse().find((m) => m && m.role === 'user');
  return String(lastUser && lastUser.content ? lastUser.content : '').trim();
}

function buildToolContext(input) {
  const tools = Array.isArray(input && input.tools) ? input.tools : [];
  const names = tools.map((t) => t && t.name).filter(Boolean);
  const workbenchTools = names.filter((name) => String(name).startsWith('ac.workbench.'));
  const shellTools = names.filter((name) => String(name).startsWith('ac.shell.'));
  if (!names.length) return '';
  const lines = [
    'AssetCutter Copilot context:',
    '- You are running as the Copilot brain inside AssetCutter local companion.',
    '- Workbench actions MUST use the AssetCutter MCP server `assetcutter-body` (ac.* body tools). Do not invent PowerShell/curl/JSON-RPC scripts, and do not edit agent-store settings.',
    '- Codex may expose these tools with an MCP prefix such as `mcp__assetcutter-body__ac.workbench.create_text_asset`. Prefer that MCP tool over shell.',
    '- For a new text note in the open workbench project, call ac.workbench.create_text_asset (or the mcp__assetcutter-body__ prefixed equivalent) with { text }. Never use Agent CLI aga_* / npm run agent:cli for workbench assets.',
    '- To import a local/Downloads image into the open workbench project, call ac.workbench.create_image_asset with { localPath } (absolute file path only). NEVER pass image base64 / imageDataUrl for real imports — that blows up tool args even for ~100KB files. Companion reads the file from disk.',
    `- Workbench standard flow: ${workbenchStandardFlowText()}.`,
    '- If a tool reports AGENT_AUTH_REQUIRED or authRequired, ask the user to open the workbench and log in, then retry the same flow.',
    '- If a tool reports requiresFrontendAuthorization, keep Copilot open and wait for the user to approve in the frontend.',
    '- If MCP tools are missing, say Body MCP is not connected (need ASSETCUTTER_MCP_TOKEN + 127.0.0.1:19120). Do not fall back to shell hacks.',
  ];
  if (shellTools.length) lines.push(`- Shell tools available: ${shellTools.join(', ')}`);
  if (workbenchTools.length) lines.push(`- Workbench tools available: ${workbenchTools.join(', ')}`);
  const other = names.filter((name) => !String(name).startsWith('ac.workbench.') && !String(name).startsWith('ac.shell.'));
  if (other.length) lines.push(`- Other body tools available: ${other.slice(0, 20).join(', ')}${other.length > 20 ? ', ...' : ''}`);
  return lines.join('\n');
}

function buildCodexPrompt(input) {
  const userPrompt = buildInitialPrompt(input);
  const toolContext = buildToolContext(input);
  if (!toolContext) return userPrompt;
  return `${toolContext}\n\nUser request:\n${userPrompt}`;
}

function parseJsonLine(line) {
  const s = String(line || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function createLinePump(stream, onLine) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() || '';
    for (const line of parts) onLine(line);
  });
  stream.on('end', () => {
    if (buf.trim()) onLine(buf);
    buf = '';
  });
}

function createQueue() {
  const values = [];
  const waiters = [];
  let closed = false;

  return {
    push(value) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ value, done: false });
      else values.push(value);
    },
    close() {
      closed = true;
      while (waiters.length) waiters.shift()({ value: undefined, done: true });
    },
    next() {
      if (values.length) return Promise.resolve({ value: values.shift(), done: false });
      if (closed) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

function compactDetail(value, limit) {
  const s = String(value || '').trim();
  if (!s) return '';
  const max = Number.isFinite(Number(limit)) ? Number(limit) : 800;
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function compactJson(value, limit) {
  if (value == null) return '';
  if (typeof value === 'string') return compactDetail(value, limit);
  try {
    return compactDetail(JSON.stringify(value, null, 2), limit);
  } catch {
    return compactDetail(String(value), limit);
  }
}

function codexItemType(item) {
  return String(item && item.type ? item.type : '').trim();
}

function isCodexToolLikeItem(item) {
  const type = codexItemType(item).toLowerCase();
  if (!type || type === 'agent_message' || type === 'command_execution') return false;
  return type.includes('tool') || type.includes('mcp');
}

function codexToolActivityName(item) {
  const raw =
    (item && (item.name || item.tool_name || item.toolName || item.server_name || item.serverName || item.type)) ||
    'tool';
  const name = String(raw || '').trim();
  if (!name) return 'codex.tool';
  return name.startsWith('codex.') ? name : `codex.${name}`;
}

function codexToolActivityDetail(item) {
  const parts = [];
  const server = item && (item.server_name || item.serverName || item.mcp_server || item.mcpServer);
  const tool = item && (item.tool_name || item.toolName || item.name);
  const status = item && item.status;
  if (server) parts.push(`server: ${server}`);
  if (tool) parts.push(`tool: ${tool}`);
  if (status) parts.push(`status: ${status}`);
  const args = item && (item.arguments || item.args || item.input || item.params);
  const output = item && (item.output || item.result || item.aggregated_output || item.error);
  if (args != null) parts.push(`input:\n${compactJson(args, 420)}`);
  if (output != null) parts.push(`output:\n${compactJson(output, 620)}`);
  return parts.join('\n\n');
}

function codexItemCompletedOk(item) {
  const status = String(item && item.status ? item.status : '').toLowerCase();
  if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') return false;
  if (item && item.error) return false;
  return true;
}

function codexTransportActivity(message) {
  const text = String(message || '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.includes('reconnecting') || lower.includes('falling back') || lower.includes('request timed out')) {
    return {
      type: 'activity',
      phase: 'start',
      name: 'codex.network',
      detail: text,
    };
  }
  return null;
}

/**
 * Codex CLI brain adapter.
 * It intentionally shells out to the installed CLI instead of calling OpenAI
 * directly, so auth, model routing, MCP config, and future token governance can
 * stay centralized in the team's Codex setup.
 */
function createCodexBrainAdapter(deps) {
  const id = 'codex';
  const displayName = 'Codex CLI';

  async function probe() {
    const cfg = settingsFromStore(deps);
    if (!cfg.command) return { ok: false, detail: 'missing Codex command' };
    return new Promise((resolve) => {
      const child = spawnCodexForDeps(deps, cfg.command, ['--version'], {
        cwd: fs.existsSync(cfg.cwd) ? cfg.cwd : process.cwd(),
      });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        resolve({ ok: false, detail: 'codex probe timeout' });
      }, 8000);
      child.stdout.on('data', (chunk) => {
        out += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk) => {
        err += chunk.toString('utf8');
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ ok: false, detail: e instanceof Error ? e.message : String(e) });
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        const detail = (out || err || '').trim();
        resolve({ ok: code === 0, detail: detail || `codex exited ${code}` });
      });
    });
  }

  async function* streamTurn(input) {
    if (input.signal && input.signal.aborted) {
      yield { type: 'done', stopReason: 'aborted' };
      return;
    }

    const cfg = settingsFromStore(deps);
    const agentSettings = agentSettingsFromStore(deps);
    const cwd = fs.existsSync(cfg.cwd) ? cfg.cwd : process.cwd();
    const sessionId = String(input.sessionId || 'default');
    const sessionMap = readSessionMap(deps);
    const codexThreadId = sessionMap[sessionId] && sessionMap[sessionId].threadId;
    const prompt = buildCodexPrompt(input);
    if (!prompt) {
      yield { type: 'error', code: 'CODEX_EMPTY_PROMPT', message: 'empty prompt' };
      return;
    }

    const escalated = Boolean(input.codexEscalated);
    const args = codexThreadId
      ? escalated
        ? ['exec', 'resume', '--dangerously-bypass-approvals-and-sandbox', '--json', codexThreadId, '-']
        : ['exec', 'resume', '--json', codexThreadId, '-']
      : escalated
        ? ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json', '--color', 'never', '-C', cwd, '-']
        : ['exec', '--json', '--color', 'never', '--sandbox', cfg.sandbox, '-C', cwd, '-'];
    if (cfg.model) {
      const insertAt = codexThreadId ? (escalated ? 3 : 2) : 1;
      args.splice(insertAt, 0, '--model', cfg.model);
    }

    const queue = createQueue();
    let exitCode = null;
    let stderrText = '';
    const completedItemText = new Map();

    const mcpToken = String(agentSettings.mcpToken || '').trim();
    const mcpPort = Number(agentSettings.mcpPort) || 19120;
    const mcpEnabled = Boolean(agentSettings.mcpEnabled);
    if (!mcpEnabled || !mcpToken) {
      yield {
        type: 'activity',
        phase: 'error',
        name: 'codex.mcp_config',
        detail:
          'Body MCP is disabled or missing token. Enable Copilot Body MCP (mcpEnabled) so Codex can call ac.workbench.* tools.',
      };
    } else {
      try {
        upsertCodexMcpServerConfigForDeps(deps, {
          url: `http://127.0.0.1:${mcpPort}/mcp`,
          tokenEnvVar: DEFAULT_CODEX_MCP_TOKEN_ENV,
          startupTimeoutSec: 30,
        });
      } catch (e) {
        yield {
          type: 'activity',
          phase: 'error',
          name: 'codex.mcp_config',
          detail: e instanceof Error ? e.message : String(e),
        };
      }
    }

    const child = spawnCodexForDeps(deps, cfg.command, args, {
      cwd,
      env: buildCodexSpawnEnv(process.env, {
        mcpToken,
        tokenEnvVar: DEFAULT_CODEX_MCP_TOKEN_ENV,
      }),
    });
    queue.push({
      type: 'activity',
      phase: 'start',
      name: 'codex.turn',
      detail: codexThreadId ? 'Resuming Codex conversation.' : 'Starting Codex conversation.',
    });
    const abortHandler = () => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      queue.push({ type: 'done', stopReason: 'aborted' });
      queue.close();
    };
    if (input.signal) input.signal.addEventListener('abort', abortHandler, { once: true });

    child.on('error', (e) => {
      queue.push({
        type: 'error',
        code: 'CODEX_SPAWN',
        message: e instanceof Error ? e.message : String(e),
      });
      queue.close();
    });

    createLinePump(child.stdout, (line) => {
      const ev = parseJsonLine(line);
      if (!ev) {
        if (line.trim()) queue.push({ type: 'text_delta', text: `${line}\n` });
        return;
      }
      if (ev.type === 'thread.started' && ev.thread_id) {
        const next = readSessionMap(deps);
        next[sessionId] = {
          threadId: String(ev.thread_id),
          cwd,
          updatedAt: new Date().toISOString(),
        };
        writeSessionMap(deps, next);
        return;
      }
      if (ev.type === 'item.completed' && ev.item && ev.item.type === 'agent_message') {
        const itemId = String(ev.item.id || `item_${completedItemText.size}`);
        const text = String(ev.item.text || '');
        const prev = completedItemText.get(itemId) || '';
        if (text && text !== prev) {
          queue.push({ type: 'text_delta', text: text.startsWith(prev) ? text.slice(prev.length) : text });
          completedItemText.set(itemId, text);
        }
        return;
      }
      if (ev.type === 'error' && ev.message) {
        const activity = codexTransportActivity(ev.message);
        if (activity) queue.push(activity);
        return;
      }
      if (ev.type === 'turn.failed') {
        const message = (ev.error && ev.error.message) || ev.message || 'Codex turn failed';
        queue.push({
          type: 'error',
          code: 'CODEX_TURN_FAILED',
          message: compactDetail(message, 1200),
        });
        return;
      }
      if (ev.type === 'item.completed' && ev.item && ev.item.type === 'error') {
        const message = ev.item.message || ev.item.text || ev.item.error || '';
        const activity = codexTransportActivity(message);
        if (activity) queue.push(activity);
        return;
      }
      if (ev.type === 'item.started' && ev.item && ev.item.type === 'command_execution') {
        queue.push({
          type: 'activity',
          phase: 'start',
          name: 'codex.command',
          detail: compactDetail(ev.item.command, 500),
        });
        return;
      }
      if (ev.type === 'item.completed' && ev.item && ev.item.type === 'command_execution') {
        const ok = ev.item.status !== 'failed' && Number(ev.item.exit_code || 0) === 0;
        const parts = [];
        if (ev.item.command) parts.push(compactDetail(ev.item.command, 360));
        if (ev.item.aggregated_output) parts.push(compactDetail(ev.item.aggregated_output, 700));
        queue.push({
          type: 'activity',
          phase: ok ? 'done' : 'error',
          name: 'codex.command',
          detail: parts.join('\n\n'),
        });
        return;
      }
      if (ev.type === 'item.started' && isCodexToolLikeItem(ev.item)) {
        queue.push({
          type: 'activity',
          phase: 'start',
          name: codexToolActivityName(ev.item),
          detail: codexToolActivityDetail(ev.item),
        });
        return;
      }
      if (ev.type === 'item.completed' && isCodexToolLikeItem(ev.item)) {
        const ok = codexItemCompletedOk(ev.item);
        queue.push({
          type: 'activity',
          phase: ok ? 'done' : 'error',
          name: codexToolActivityName(ev.item),
          detail: codexToolActivityDetail(ev.item),
        });
        return;
      }
      if (ev.type === 'turn.completed') {
        if (ev.usage && typeof ev.usage === 'object') {
          queue.push({ type: 'usage', usage: ev.usage });
        }
        queue.push({
          type: 'activity',
          phase: 'done',
          name: 'codex.turn',
          detail: 'Codex response completed.',
        });
        queue.push({ type: 'done', stopReason: 'stop' });
      }
    });

    createLinePump(child.stderr, (line) => {
      const s = String(line || '').trim();
      if (!s) return;
      stderrText += `${s}\n`;
    });

    child.on('exit', (code) => {
      exitCode = code;
      if (input.signal) input.signal.removeEventListener('abort', abortHandler);
      if (code && code !== 0) {
        queue.push({
          type: 'error',
          code: 'CODEX_EXIT',
          message: (stderrText || `Codex CLI exited ${code}`).trim(),
        });
      }
      queue.close();
    });

    try {
      child.stdin.end(prompt);
    } catch {
      /* ignore */
    }

    while (true) {
      const next = await queue.next();
      if (next.done) break;
      yield next.value;
    }
    if (exitCode && exitCode !== 0) return;
  }

  function clearSession(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) return { ok: false, error: 'session_id_required' };
    const map = readSessionMap(deps);
    if (!Object.prototype.hasOwnProperty.call(map, id)) return { ok: true, cleared: false, sessionId: id };
    delete map[id];
    writeSessionMap(deps, map);
    return { ok: true, cleared: true, sessionId: id };
  }

  return { id, displayName, probe, streamTurn, clearSession };
}

module.exports = { createCodexBrainAdapter, buildCodexPrompt };
