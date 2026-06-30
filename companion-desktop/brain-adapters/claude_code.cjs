'use strict';

const { createOpenaiCompatBrainAdapter } = require('./openai_compat.cjs');

/**
 * P2：Claude Code / Anthropic 兼容 OpenAI 协议网关。
 */
function createClaudeCodeBrainAdapter(deps) {
  const id = 'claude_code';
  const displayName = 'Claude Code';

  function claudeConfig() {
    return {
      baseUrl: String(
        process.env.COMPANION_AGENT_CLAUDE_BASE_URL ||
          process.env.COMPANION_AGENT_OPENAI_BASE_URL ||
          'https://api.anthropic.com/v1',
      )
        .trim()
        .replace(/\/$/, ''),
      apiKey: String(process.env.COMPANION_AGENT_CLAUDE_API_KEY || process.env.COMPANION_AGENT_OPENAI_API_KEY || '').trim(),
      model: String(process.env.COMPANION_AGENT_CLAUDE_MODEL || 'claude-sonnet-4-20250514').trim(),
    };
  }

  const inner = createOpenaiCompatBrainAdapter({
    ...(deps || {}),
    getOpenAiConfig: claudeConfig,
  });

  async function probe() {
    const { baseUrl, apiKey } = claudeConfig();
    if (!apiKey) return { ok: false, detail: 'missing COMPANION_AGENT_CLAUDE_API_KEY' };
    try {
      const r = await fetch(`${baseUrl}/models`, {
        signal: AbortSignal.timeout(4000),
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return { ok: r.ok, detail: r.ok ? `claude gateway ${baseUrl}` : `http ${r.status}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  return { id, displayName, probe, streamTurn: inner.streamTurn.bind(inner) };
}

module.exports = { createClaudeCodeBrainAdapter };
