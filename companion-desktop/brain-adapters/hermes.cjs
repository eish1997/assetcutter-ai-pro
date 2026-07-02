'use strict';

const { createOpenaiCompatBrainAdapter } = require('./openai_compat.cjs');

const DEFAULT_HERMES_BASE = 'http://127.0.0.1:19119/v1';

/**
 * P1 默认大脑：Hermes Gateway（OpenAI 兼容协议）。
 */
function createHermesBrainAdapter(deps) {
  const id = 'hermes';
  const displayName = 'Hermes Gateway';

  function hermesConfig() {
    const fromStore = deps && deps.store && typeof deps.store.readSettings === 'function' ? deps.store.readSettings() : null;
    const baseFromStore =
      fromStore && fromStore.hermesGatewayUrl ? String(fromStore.hermesGatewayUrl).trim().replace(/\/$/, '') : '';
    const keyFromStore = fromStore && fromStore.hermesApiKey != null ? String(fromStore.hermesApiKey).trim() : '';
    const modelFromStore = fromStore && fromStore.hermesModel != null ? String(fromStore.hermesModel).trim() : '';
    return {
      baseUrl: String(process.env.COMPANION_AGENT_HERMES_BASE_URL || baseFromStore || DEFAULT_HERMES_BASE)
        .trim()
        .replace(/\/$/, ''),
      apiKey: String(process.env.COMPANION_AGENT_HERMES_API_KEY || keyFromStore || 'hermes-local').trim(),
      model: String(process.env.COMPANION_AGENT_HERMES_MODEL || modelFromStore || 'default').trim(),
    };
  }

  const inner = createOpenaiCompatBrainAdapter({
    ...(deps || {}),
    getOpenAiConfig: hermesConfig,
  });

  async function probe() {
    const { baseUrl, apiKey } = hermesConfig();
    try {
      const r = await fetch(`${baseUrl}/models`, {
        signal: AbortSignal.timeout(4000),
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (r.ok) return { ok: true, detail: `hermes gateway ${baseUrl}` };
      return { ok: false, detail: `hermes http ${r.status}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    id,
    displayName,
    probe,
    streamTurn: inner.streamTurn.bind(inner),
  };
}

module.exports = { createHermesBrainAdapter, DEFAULT_HERMES_BASE };
