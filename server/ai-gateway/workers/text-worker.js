import { buildGeminiProxyAsyncRequest } from '../adapters/gemini-proxy-adapter.js';
import { startLegacyGeminiProxyExecution } from '../adapters/legacy-gemini-proxy-execution.js';
import { buildOpenAiOfficialRequest, startOpenAiOfficialExecution } from '../adapters/openai-official-adapter.js';
import { assertWorkerSupportsAdapter } from './types.js';

export const textWorker = Object.freeze({
  id: 'text-worker',
  modalities: Object.freeze(['text']),
  capabilities: Object.freeze(['text.generate']),
  adapters: Object.freeze(['legacy-gemini-proxy', 'openai-official', 'toapis-openai', 'volcengine-ark-openai']),
  status: 'active',
  buildRequest(job, route) {
    assertWorkerSupportsAdapter(textWorker, route?.adapterId);
    if (
      route?.adapterId === 'openai-official' ||
      route?.adapterId === 'toapis-openai' ||
      route?.adapterId === 'volcengine-ark-openai'
    ) return buildOpenAiOfficialRequest(job, route);
    return buildGeminiProxyAsyncRequest(job, route);
  },
  start(plan, options = {}) {
    assertWorkerSupportsAdapter(textWorker, plan?.route?.adapterId);
    if (
      plan?.route?.adapterId === 'openai-official' ||
      plan?.route?.adapterId === 'toapis-openai' ||
      plan?.route?.adapterId === 'volcengine-ark-openai'
    ) {
      return startOpenAiOfficialExecution(plan, options);
    }
    return startLegacyGeminiProxyExecution(plan, options);
  },
  async cancel() {
    return { cancelled: false, mode: 'soft', reason: 'legacy_adapter_cancel_not_supported' };
  },
  estimateCost() {
    return null;
  },
  settleUsage() {
    return null;
  },
});
