'use strict';

const { createOpenaiCompatBrainAdapter } = require('./openai_compat.cjs');

/**
 * P2：Codex / OpenAI 兼容（可与 openai_compat 共用网关，独立 brainId 便于 L2 切换）。
 */
function createCodexBrainAdapter(deps) {
  const id = 'codex';
  const displayName = 'Codex';

  function codexConfig() {
    return {
      baseUrl: String(process.env.COMPANION_AGENT_CODEX_BASE_URL || 'https://api.openai.com/v1')
        .trim()
        .replace(/\/$/, ''),
      apiKey: String(process.env.COMPANION_AGENT_CODEX_API_KEY || process.env.COMPANION_AGENT_OPENAI_API_KEY || '').trim(),
      model: String(process.env.COMPANION_AGENT_CODEX_MODEL || 'gpt-4.1').trim(),
    };
  }

  const inner = createOpenaiCompatBrainAdapter({
    ...(deps || {}),
    getOpenAiConfig: codexConfig,
  });

  async function probe() {
    const { baseUrl, apiKey, model } = codexConfig();
    if (!apiKey) return { ok: false, detail: 'missing COMPANION_AGENT_CODEX_API_KEY' };
    try {
      const r = await fetch(`${baseUrl}/models`, {
        signal: AbortSignal.timeout(4000),
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return { ok: r.ok, detail: r.ok ? `codex ${model} @ ${baseUrl}` : `http ${r.status}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  return { id, displayName, probe, streamTurn: inner.streamTurn.bind(inner) };
}

module.exports = { createCodexBrainAdapter };
