#!/usr/bin/env node
/**
 * 本地 Hermes 联调网关（OpenAI 兼容，P1 spike）。
 * 默认 127.0.0.1:19119/v1；Bearer hermes-local
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.COMPANION_HERMES_GATEWAY_PORT || 19119);
const HOST = String(process.env.COMPANION_HERMES_GATEWAY_HOST || '127.0.0.1');
const API_KEY = String(process.env.COMPANION_AGENT_HERMES_API_KEY || 'hermes-local');
const MODEL = String(process.env.COMPANION_AGENT_HERMES_MODEL || 'default');

function authOk(req) {
  const h = String(req.headers.authorization || '');
  return h === `Bearer ${API_KEY}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function lastMessage(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.length ? list[list.length - 1] : null;
}

function lastUserText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === 'user') return String(list[i].content || '');
  }
  return '';
}

function formatToolFollowUp(toolMsg) {
  if (!toolMsg || toolMsg.role !== 'tool') return '已完成。\n';
  const name = toolMsg.name || '';
  const raw = String(toolMsg.content || '').trim();
  if (name === 'ac.shell.get_state' || name === 'ac.companion.runtime_status') {
    return raw ? `${raw}\n` : '已完成。\n';
  }
  if (name === 'ac.shell.navigate') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.navigated) {
        return `已切换到 ${parsed.navigated} 页。\n`;
      }
    } catch {
      /* fall through */
    }
  }
  try {
    const err = JSON.parse(raw);
    if (err && err.message) {
      return `工具 ${name} 失败：${err.message}\n`;
    }
  } catch {
    /* ignore */
  }
  if (raw && raw.length < 500) return `${raw}\n`;
  return '已完成。\n';
}

function shouldPickToolCalls(messages) {
  const last = lastMessage(messages);
  if (!last) return true;
  // 工具已执行完毕：只回文本收尾，避免 Session 循环再次触发同一 navigate（MAX_TOOL_STEPS=8）
  if (last.role === 'tool') return false;
  return true;
}

function pickToolCalls(text) {
  const t = String(text || '').toLowerCase();
  if (/脚本|script/.test(t) && /(打开|切|去|navigate)/.test(t)) {
    return [{ name: 'ac.shell.navigate', arguments: { view: 'scripts' } }];
  }
  if (/工作台|workbench|主站/.test(t) && /(打开|切|去)/.test(t)) {
    return [{ name: 'ac.shell.navigate', arguments: { view: 'workbench' } }];
  }
  if (/伴侣|runtime|状态|健康/.test(t)) {
    return [{ name: 'ac.shell.get_state', arguments: {} }];
  }
  return [];
}

function sseWrite(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

async function handleChatCompletions(req, res, body) {
  const stream = Boolean(body.stream);
  const messages = body.messages || [];
  const last = lastMessage(messages);

  if (last && last.role === 'tool') {
    const followUp = formatToolFollowUp(last);
    if (!stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: `chatcmpl_${randomUUID()}`,
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: followUp }, finish_reason: 'stop' }],
        }),
      );
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const chunkId = `chatcmpl_${randomUUID()}`;
    sseWrite(res, {
      id: chunkId,
      choices: [{ index: 0, delta: { content: followUp }, finish_reason: null }],
    });
    sseWrite(res, {
      id: chunkId,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  const userText = lastUserText(messages);
  const toolCalls = shouldPickToolCalls(messages) ? pickToolCalls(userText) : [];

  if (!stream) {
    if (toolCalls.length) {
      const id = `call_${randomUUID()}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: `chatcmpl_${randomUUID()}`,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: '好的，我来执行。',
                tool_calls: toolCalls.map((tc, i) => ({
                  id: `${id}_${i}`,
                  type: 'function',
                  function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
                })),
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: `chatcmpl_${randomUUID()}`,
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: `[Hermes dev] 收到：${userText.slice(0, 120)}`,
            },
            finish_reason: 'stop',
          },
        ],
      }),
    );
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const chunkId = `chatcmpl_${randomUUID()}`;

  if (toolCalls.length) {
    sseWrite(res, {
      id: chunkId,
      choices: [{ index: 0, delta: { content: '好的，我来执行。\n' }, finish_reason: null }],
    });
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      sseWrite(res, {
        id: chunkId,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: i,
                  id: `call_${randomUUID()}`,
                  type: 'function',
                  function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
    }
    sseWrite(res, {
      id: chunkId,
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  const reply = `[Hermes dev] 收到：${userText.slice(0, 120)}`;
  sseWrite(res, {
    id: chunkId,
    choices: [{ index: 0, delta: { content: reply }, finish_reason: null }],
  });
  sseWrite(res, {
    id: chunkId,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (!authOk(req) && path !== '/health') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_api_key' }));
    return;
  }

  if (path === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'hermes-dev-gateway', model: MODEL }));
    return;
  }

  if (path === '/v1/models' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: [{ id: MODEL, object: 'model', owned_by: 'hermes-dev' }],
      }),
    );
    return;
  }

  if (path === '/v1/chat/completions' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      await handleChatCompletions(req, res, body);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found', path }));
});

server.listen(PORT, HOST, () => {
  console.log(`[hermes-dev] OpenAI-compatible gateway http://${HOST}:${PORT}/v1`);
  console.log(`[hermes-dev] model=${MODEL} auth=Bearer ${API_KEY}`);
});
