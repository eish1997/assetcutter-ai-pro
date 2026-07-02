#!/usr/bin/env node
/**
 * P2/P3 ScriptHub 集成冒烟：Maya 导出全链路 + MCP 同路径 + 可选 Token 鉴权。
 * 用法：node scripts/agent-p2-p3-smoke.mjs
 *
 * 前置（P2）：
 *   cd F:/AI/ScriptHub && npm run tool-bridge:server
 *   cd F:/AI/ScriptHub && npm run maya-connector:server
 */
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { createAgentScriptHubClient } = require('../companion-desktop/agent-script-hub-client.cjs');
const { ALL_TOOL_SCHEMAS } = require('../companion-desktop/agent-body-host.cjs');

const results = [];
const TOOL_BRIDGE = process.env.SCRIPTHUB_TOOL_BRIDGE_URL ?? 'http://127.0.0.1:8787';
const MAYA_CONNECTOR = process.env.SCRIPTHUB_MAYA_CONNECTOR_URL ?? 'http://127.0.0.1:8795';
const BRIDGE_TOKEN = String(process.env.SCRIPTHUB_TOOL_BRIDGE_TOKEN ?? '').trim();

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
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', timeout: 10000, headers },
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

function httpPost(url, body, headers = {}) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'POST',
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
      },
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
    req.write(payload);
    req.end();
  });
}

async function nodeFetchImpl(url, init = {}) {
  const headers = init.headers || {};
  if (init.method === 'POST') {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const r = await httpPost(url, body, headers);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: r.json, text: r.text };
  }
  const r = await httpGet(url, headers);
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: r.json, text: r.text };
}

function makeClient(token = '') {
  return createAgentScriptHubClient({
    getScriptHubApiUrl: () => TOOL_BRIDGE,
    getScriptHubApiToken: () => token,
    normalizeScriptHubApiUrl: (raw) => {
      try {
        return new URL(String(raw).trim()).href;
      } catch {
        return '';
      }
    },
    navigateShell: async () => ({ ok: true }),
    fetchImpl: nodeFetchImpl,
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

async function main() {
  console.log('\n=== P2/P3 ScriptHub 集成冒烟 ===\n');

  console.log('[1] 工具注册（含 export_maya_selection）');
  if (ALL_TOOL_SCHEMAS.length === 17) pass('tools.count', '17 ac.*');
  else fail('tools.count', String(ALL_TOOL_SCHEMAS.length));

  const hasExportTool = ALL_TOOL_SCHEMAS.some((t) => t.name === 'ac.script_hub.export_maya_selection');
  if (hasExportTool) pass('tools.export-maya', 'registered');
  else fail('tools.export-maya', 'missing');

  console.log('\n[2] 服务端口');
  const tbOpen = await probePort(8787);
  const mayaOpen = await probePort(8795);
  if (tbOpen) pass('port.tool-bridge', '8787');
  else skip('port.tool-bridge', 'npm run tool-bridge:server');
  if (mayaOpen) pass('port.maya-connector', '8795');
  else skip('port.maya-connector', 'npm run maya-connector:server');

  console.log('\n[3] P2 Maya 导出全链路（fixture）');
  if (!tbOpen || !mayaOpen) {
    skip('p2.export-pipeline', '需要 8787 + 8795');
  } else {
    const client = makeClient(BRIDGE_TOKEN);
    const exportUri = `project://exports/companion_smoke_${Date.now()}.fbx`;
    const res = await client.exportMayaSelection({ outputPath: exportUri, overwrite: true });
    if (res.ok && res.structured?.output?.local_path) {
      pass('p2.export-pipeline', res.structured.output.local_path);
    } else if (res.ok && res.structured?.output?.storage_uri) {
      pass('p2.export-pipeline', res.structured.output.storage_uri);
    } else {
      fail('p2.export-pipeline', res.error?.message || JSON.stringify(res.structured || {}).slice(0, 120));
    }
  }

  console.log('\n[4] P3 Tool Bridge Token 鉴权');
  if (!tbOpen) {
    skip('p3.bridge-auth', 'Tool Bridge 未运行');
  } else if (!BRIDGE_TOKEN) {
    skip('p3.bridge-auth', '未设置 SCRIPTHUB_TOOL_BRIDGE_TOKEN');
  } else {
    const noToken = await httpGet(`${TOOL_BRIDGE}/tool-bridge/tools`);
    if (noToken.status === 401) pass('p3.bridge-auth.reject', '401 without token');
    else fail('p3.bridge-auth.reject', `status=${noToken.status}`);

    const withToken = await httpGet(`${TOOL_BRIDGE}/tool-bridge/tools`, {
      Authorization: `Bearer ${BRIDGE_TOKEN}`,
    });
    if (withToken.status === 200 && Array.isArray(withToken.json?.data)) {
      pass('p3.bridge-auth.accept', `${withToken.json.data.length} tools`);
    } else {
      fail('p3.bridge-auth.accept', `status=${withToken.status}`);
    }
  }

  console.log('\n[5] P3 MCP 与 Copilot 同路径（list_scripts）');
  const mcpPort = 19120;
  const mcpOpen = await probePort(mcpPort);
  if (!mcpOpen || !tbOpen) {
    skip('p3.mcp.list-scripts', '需要 agent-mcp + tool-bridge');
  } else {
    const settingsPath = `${process.env.LOCALAPPDATA || ''}/AssetCutterCompanion/sandbox/agent-store/settings.json`;
    let mcpToken = '';
    try {
      const fs = await import('node:fs');
      if (fs.existsSync(settingsPath)) {
        const j = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        mcpToken = j.mcpToken || '';
      }
    } catch {
      /* ignore */
    }
    if (!mcpToken) {
      skip('p3.mcp.list-scripts', 'MCP 未配置 token');
    } else {
      const list = await mcpRpc(mcpPort, mcpToken, 'tools/list');
      const names = (list?.result?.tools || []).map((t) => t.name);
      if (names.includes('ac.script_hub.list_scripts')) pass('p3.mcp.tool-present', 'ac.script_hub.list_scripts');
      else fail('p3.mcp.tool-present', names.filter((n) => n.startsWith('ac.script_hub.')).join(','));

      const call = await mcpRpc(mcpPort, mcpToken, 'tools/call', {
        name: 'ac.script_hub.list_scripts',
        arguments: { limit: 5 },
      });
      const text = call?.result?.content?.[0]?.text || '';
      if (!call?.result?.isError && text.includes('integrationVersion')) pass('p3.mcp.list-scripts', 'ok');
      else fail('p3.mcp.list-scripts', text.slice(0, 120) || JSON.stringify(call?.error));
    }
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
