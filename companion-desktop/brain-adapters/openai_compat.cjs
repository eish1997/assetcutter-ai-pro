'use strict';

const { randomUUID } = require('node:crypto');

/**
 * OpenAI Chat Completions 兼容大脑（P0/P1 联调）。
 * 环境变量：COMPANION_AGENT_OPENAI_BASE_URL / API_KEY / MODEL
 */
function createOpenaiCompatBrainAdapter(deps) {
  const id = 'openai_compat';
  const displayName = 'OpenAI Compatible';

  function config() {
    if (deps && typeof deps.getOpenAiConfig === 'function') {
      const c = deps.getOpenAiConfig();
      return {
        baseUrl: String(c.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, ''),
        apiKey: String(c.apiKey || '').trim(),
        model: String(c.model || 'gpt-4o-mini').trim(),
      };
    }
    return {
      baseUrl: String(process.env.COMPANION_AGENT_OPENAI_BASE_URL || 'https://api.openai.com/v1')
        .trim()
        .replace(/\/$/, ''),
      apiKey: String(process.env.COMPANION_AGENT_OPENAI_API_KEY || '').trim(),
      model: String(process.env.COMPANION_AGENT_OPENAI_MODEL || 'gpt-4o-mini').trim(),
    };
  }

  function systemPrompt() {
    if (deps && deps.store && typeof deps.store.readProfileSystemPrompt === 'function') {
      return deps.store.readProfileSystemPrompt();
    }
    return '你是 AssetCutter 本地伴侣助手。';
  }

  async function probe() {
    const { baseUrl, apiKey, model } = config();
    if (!apiKey) return { ok: false, detail: 'missing COMPANION_AGENT_OPENAI_API_KEY' };
    try {
      const r = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      return { ok: r.ok, detail: r.ok ? `model endpoint ok (${model})` : `http ${r.status}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  function toOpenAiMessages(messages) {
    const out = [{ role: 'system', content: systemPrompt() }];
    for (const m of messages || []) {
      if (m.role === 'user') {
        out.push({ role: 'user', content: String(m.content || '') });
      } else if (m.role === 'assistant') {
        const entry = { role: 'assistant', content: String(m.content || '') };
        const tcs = m.meta && Array.isArray(m.meta.toolCalls) ? m.meta.toolCalls : null;
        if (tcs && tcs.length) {
          entry.tool_calls = tcs.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments || {}),
            },
          }));
        }
        out.push(entry);
      } else if (m.role === 'tool') {
        out.push({
          role: 'tool',
          tool_call_id: m.toolCallId || m.meta?.toolCallId || 'unknown',
          content: String(m.content || ''),
        });
      }
    }
    return out;
  }

  function toOpenAiTools(tools) {
    return (tools || []).map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || t.name,
        parameters: t.inputSchema || { type: 'object', properties: {} },
      },
    }));
  }

  async function* readSseJson(body) {
    if (!body) return;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    function parseLine(line) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return null;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') return null;
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    }

    function* flushCompleteLines() {
      const parts = buf.split('\n');
      buf = parts.pop() || '';
      for (const line of parts) {
        const parsed = parseLine(line);
        if (parsed) yield parsed;
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      yield* flushCompleteLines();
    }
    buf += decoder.decode();
    const tail = parseLine(buf);
    if (tail) yield tail;
  }

  async function* streamTurn(input) {
    if (input.signal && input.signal.aborted) {
      yield { type: 'done', stopReason: 'aborted' };
      return;
    }
    const { baseUrl, apiKey, model } = config();
    if (!apiKey) {
      yield { type: 'error', code: 'BRAIN_CONFIG', message: '缺少 COMPANION_AGENT_OPENAI_API_KEY' };
      return;
    }

    const body = {
      model,
      stream: true,
      messages: toOpenAiMessages(input.messages),
      tools: toOpenAiTools(input.tools),
    };

    let res;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: input.signal,
      });
    } catch (e) {
      yield { type: 'error', code: 'BRAIN_NETWORK', message: e instanceof Error ? e.message : String(e) };
      return;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      yield { type: 'error', code: 'BRAIN_HTTP', message: errText || `http ${res.status}` };
      return;
    }

    const toolAcc = new Map();
    let finishReason = 'stop';

    for await (const chunk of readSseJson(res.body)) {
      if (input.signal && input.signal.aborted) {
        yield { type: 'done', stopReason: 'aborted' };
        return;
      }
      const choice = chunk.choices && chunk.choices[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta || {};
      if (delta.content) {
        yield { type: 'text_delta', text: delta.content };
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index != null ? tc.index : 0;
          const acc = toolAcc.get(idx) || { id: '', name: '', arguments: '' };
          if (tc.id) acc.id = tc.id;
          if (tc.function && tc.function.name) acc.name = tc.function.name;
          if (tc.function && tc.function.arguments) acc.arguments += tc.function.arguments;
          toolAcc.set(idx, acc);
        }
      }
    }

    if (finishReason === 'tool_calls' || toolAcc.size > 0) {
      for (const acc of toolAcc.values()) {
        yield {
          type: 'tool_call',
          id: acc.id || `call_${randomUUID()}`,
          name: acc.name,
          arguments: acc.arguments || '{}',
        };
      }
      yield { type: 'done', stopReason: 'tool_calls' };
      return;
    }

    yield { type: 'done', stopReason: finishReason || 'stop' };
  }

  return { id, displayName, probe, streamTurn };
}

module.exports = { createOpenaiCompatBrainAdapter };
