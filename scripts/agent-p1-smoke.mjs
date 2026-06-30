#!/usr/bin/env node
/**
 * P1 全局 Agent 冒烟（可重复执行，不依赖 Electron 渲染进程）。
 * 用法：node scripts/agent-p1-smoke.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createAgentStore } = require('../companion-desktop/agent-store.cjs');
const { createAgentSessionService } = require('../companion-desktop/agent-session/index.cjs');
const { createAgentBodyHost, ALL_TOOL_SCHEMAS } = require('../companion-desktop/agent-body-host.cjs');
const { createAgentPolicy } = require('../companion-desktop/agent-policy.cjs');

const results = [];

function pass(id, detail) {
  results.push({ id, status: 'PASS', detail });
  console.log(`  ✓ ${id}${detail ? ` — ${detail}` : ''}`);
}

function fail(id, detail) {
  results.push({ id, status: 'FAIL', detail });
  console.log(`  ✗ ${id}${detail ? ` — ${detail}` : ''}`);
}

function skip(id, detail) {
  results.push({ id, status: 'SKIP', detail });
  console.log(`  ○ ${id}${detail ? ` — ${detail}` : ''}`);
}

function probePort(port) {
  return new Promise((resolve) => {
    const req = http.request({ hostname: '127.0.0.1', port, method: 'GET', path: '/', timeout: 3000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function httpGet(url, headers = {}) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', timeout: 8000, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode, text, json });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, text: 'timeout', json: null });
    });
    req.on('error', (e) => resolve({ status: 0, text: e.message, json: null }));
    req.end();
  });
}

async function mcpRpc(port, token, method, params = {}) {
  const r = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return r.json();
}

function readLiveAgentSettings() {
  const la = process.env.LOCALAPPDATA || '';
  const p = path.join(la, 'AssetCutterCompanion', 'sandbox', 'agent-store', 'settings.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function createSmokeBrain() {
  return {
    id: 'smoke',
    displayName: 'Smoke',
    probe: async () => ({ ok: true, detail: 'smoke' }),
    async *streamTurn(input) {
      const messages = input.messages || [];
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const text = String(lastUser?.content || '');
      const last = messages[messages.length - 1];

      if (last && last.role === 'tool') {
        yield { type: 'text_delta', text: '完成。\n' };
        yield { type: 'done', stopReason: 'stop' };
        return;
      }

      if (/脚本|script/.test(text)) {
        yield { type: 'text_delta', text: '好的。\n' };
        yield {
          type: 'tool_call',
          id: 'tc_nav',
          name: 'ac.shell.navigate',
          arguments: JSON.stringify({ view: 'scripts' }),
        };
        yield { type: 'done', stopReason: 'tool_calls' };
        return;
      }

      if (/伴侣|状态/.test(text)) {
        yield { type: 'text_delta', text: '查询中。\n' };
        yield {
          type: 'tool_call',
          id: 'tc_state',
          name: 'ac.shell.get_state',
          arguments: '{}',
        };
        yield { type: 'done', stopReason: 'tool_calls' };
        return;
      }

      if (/memory-confirm-test/.test(text)) {
        yield { type: 'text_delta', text: '写入记忆。\n' };
        yield {
          type: 'tool_call',
          id: 'tc_mem',
          name: 'ac.memory.append',
          arguments: JSON.stringify({ text: 'smoke memory note' }),
        };
        yield { type: 'done', stopReason: 'tool_calls' };
        return;
      }

      if (/abort-test/.test(text)) {
        yield { type: 'text_delta', text: '准备导航。\n' };
        yield {
          type: 'tool_call',
          id: 'tc_wb',
          name: 'ac.shell.navigate',
          arguments: JSON.stringify({ view: 'workbench' }),
        };
        yield { type: 'done', stopReason: 'tool_calls' };
        return;
      }

      yield { type: 'text_delta', text: 'ok\n' };
      yield { type: 'done', stopReason: 'stop' };
    },
  };
}

async function runSessionSmoke() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-smoke-'));
  const store = createAgentStore({ getRoot: () => tmp });
  store.ensureLayout();
  const policy = createAgentPolicy({ getPolicyPath: () => path.join(tmp, 'policy.json') });

  let shellView = 'home';
  const bodyHost = createAgentBodyHost({
    getShellView: () => shellView,
    navigateShell: async (view) => {
      shellView = view;
      return { ok: true };
    },
    companionApiRequest: async () => ({ ok: true, json: { smoke: true } }),
    getStateSummary: async () => ({ shellView, companion: { connected: true } }),
    getSkillsRoot: () => store.skillsDir(),
    getMemoryRoot: () => store.memoryDir(),
  });

  const events = [];
  const pendingConfirms = new Map();

  const session = createAgentSessionService({
    store,
    bodyHost,
    getBrain: () => createSmokeBrain(),
    getShellView: () => shellView,
    gateTool: (tool) => policy.gateTool(tool),
    waitForConfirm: (confirmId) =>
      new Promise((resolve) => {
        pendingConfirms.set(confirmId, resolve);
      }),
    cancelPendingConfirms: () => {
      for (const [, resolve] of pendingConfirms) {
        resolve({ approved: false, reason: 'cancelled' });
      }
      pendingConfirms.clear();
    },
    onEvent: (ev) => events.push(ev),
  });

  const sid = store.getOrCreateDefaultSessionId();

  const nav = await session.sendUserMessage('请打开脚本页');
  if (!nav.ok) {
    fail('session.navigate-scripts', nav.error || 'send failed');
  } else {
    const msgs = session.listMessages(sid);
    const hasTool = msgs.some((m) => m.role === 'tool' && m.name === 'ac.shell.navigate');
    if (shellView === 'scripts' && hasTool) pass('session.navigate-scripts', `view=${shellView}`);
    else fail('session.navigate-scripts', `view=${shellView} tool=${hasTool}`);
  }

  const state = await session.sendUserMessage('伴侣状态');
  if (!state.ok) {
    fail('session.companion-state', state.error || 'send failed');
  } else {
    const lastTool = [...session.listMessages(sid)].reverse().find((m) => m.role === 'tool');
    if (lastTool && (lastTool.name === 'ac.shell.get_state' || lastTool.name === 'ac.companion.runtime_status')) {
      pass('session.companion-state', lastTool.name);
    } else {
      fail('session.companion-state', lastTool?.name || 'no tool msg');
    }
  }

  const memPromise = session.sendUserMessage('memory-confirm-test');
  let confirmEv = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 25));
    confirmEv = events.find((e) => e.type === 'confirm_required' && e.name === 'ac.memory.append');
    if (confirmEv) break;
  }
  if (!confirmEv) {
    fail('session.confirm-required', 'no confirm_required for memory.append');
  } else {
    pass('session.confirm-required', confirmEv.confirmId);
    const resolver = pendingConfirms.get(confirmEv.confirmId);
    if (resolver) resolver({ approved: true, reason: 'approved' });
    else fail('session.confirm-approve', 'resolver missing');
  }
  const mem = await memPromise;
  if (mem.ok) pass('session.confirm-approve', 'memory appended');
  else fail('session.confirm-approve', mem.error || 'turn failed');

  const beforeCount = session.listMessages(sid).length;
  const abortPromise = session.sendUserMessage('abort-test');
  session.abortTurn();
  const abortRes = await abortPromise;
  if (abortRes.error === 'aborted' || abortRes.ok === false) {
    pass('session.abort', abortRes.error || 'stopped');
  } else {
    fail('session.abort', JSON.stringify(abortRes));
  }

  const afterAbort = session.listMessages(sid);
  if (afterAbort.length >= beforeCount) pass('session.messages-persist', `${afterAbort.length} lines`);
  else fail('session.messages-persist', 'messages lost');

  const snapFile = path.join(tmp, 'sessions', sid, 'context-snapshot.json');
  if (fs.existsSync(snapFile)) pass('session.context-snapshot', snapFile);
  else fail('session.context-snapshot', 'missing');
}

async function main() {
  console.log('\n=== P1 Agent 冒烟 ===\n');

  console.log('[1] 服务端口');
  const ports = [
    ['local-companion', 18765],
    ['auth-api', 9100],
    ['vite', 3000],
    ['script-hub-api', 9101],
    ['agent-mcp', 19120],
  ];
  for (const [name, port] of ports) {
    const open = await probePort(port);
    if (open) pass(`port.${name}`, String(port));
    else if (name === 'script-hub-api') skip(`port.${name}`, '9101 未起（Docker/Postgres）');
    else fail(`port.${name}`, `${port} 不可达`);
  }

  console.log('\n[2] 工具注册');
  if (ALL_TOOL_SCHEMAS.length === 16) pass('tools.count', '16 ac.*');
  else fail('tools.count', String(ALL_TOOL_SCHEMAS.length));

  console.log('\n[3] 主站 Agent API（未登录）');
  const ctx = await httpGet('http://127.0.0.1:9100/api/agent/workbench/context');
  if (ctx.status === 401) pass('workbench.context-unauth', '401');
  else fail('workbench.context-unauth', `status=${ctx.status}`);

  console.log('\n[4] 伴侣 runtime-status');
  const health = await httpGet('http://127.0.0.1:18765/v1/health');
  if (health.status === 200) pass('companion.health', '200');
  else fail('companion.health', `status=${health.status}`);

  console.log('\n[5] Body MCP（实机）');
  const settings = readLiveAgentSettings();
  if (!settings?.mcpEnabled || !settings?.mcpToken) {
    skip('mcp.live', 'MCP 未开启或无 token');
  } else {
    const port = settings.mcpPort || 19120;
    const list = await mcpRpc(port, settings.mcpToken, 'tools/list');
    const toolCount = list?.result?.tools?.length;
    if (toolCount === 16) pass('mcp.tools-list', '16 tools');
    else fail('mcp.tools-list', String(toolCount));

    const state = await mcpRpc(port, settings.mcpToken, 'tools/call', {
      name: 'ac.shell.get_state',
      arguments: {},
    });
    const text = state?.result?.content?.[0]?.text || '';
    if (text.includes('shellView') || text.includes('companion')) pass('mcp.get-state', 'ok');
    else fail('mcp.get-state', text.slice(0, 120));

    const rt = await mcpRpc(port, settings.mcpToken, 'tools/call', {
      name: 'ac.companion.runtime_status',
      arguments: {},
    });
    const rtText = rt?.result?.content?.[0]?.text || '';
    if (!rt?.result?.isError && rtText.length > 10) pass('mcp.runtime-status', 'ok');
    else fail('mcp.runtime-status', rtText.slice(0, 120));
  }

  console.log('\n[6] Stub Session 集成（内存 store）');
  await runSessionSmoke();

  console.log('\n[7] 持久化 messages.jsonl（实机 store）');
  const liveStore = path.join(
    process.env.LOCALAPPDATA || '',
    'AssetCutterCompanion',
    'sandbox',
    'agent-store',
    'sessions',
    'default',
    'messages.jsonl',
  );
  if (fs.existsSync(liveStore)) {
    const lines = fs.readFileSync(liveStore, 'utf8').split(/\r?\n/).filter(Boolean);
    pass('live.messages-jsonl', `${lines.length} lines`);
  } else {
    skip('live.messages-jsonl', '尚无 Copilot 对话记录');
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  const skipped = results.filter((r) => r.status === 'SKIP');
  const passed = results.filter((r) => r.status === 'PASS');

  console.log('\n=== 汇总 ===');
  console.log(`PASS ${passed.length} | FAIL ${failed.length} | SKIP ${skipped.length}`);
  if (failed.length) {
    console.log('\n失败项：');
    for (const f of failed) console.log(`  - ${f.id}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
