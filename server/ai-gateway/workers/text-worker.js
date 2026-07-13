import { buildGeminiProxyAsyncRequest } from '../adapters/gemini-proxy-adapter.js';
import { startLegacyGeminiProxyExecution } from '../adapters/legacy-gemini-proxy-execution.js';
import { assertWorkerSupportsAdapter } from './types.js';

export const textWorker = Object.freeze({
  id: 'text-worker',
  modalities: Object.freeze(['text']),
  capabilities: Object.freeze(['text.generate']),
  adapters: Object.freeze(['legacy-gemini-proxy']),
  status: 'active',
  buildRequest(job, route) {
    assertWorkerSupportsAdapter(textWorker, route?.adapterId);
    return buildGeminiProxyAsyncRequest(job, route);
  },
  start(plan, options = {}) {
    assertWorkerSupportsAdapter(textWorker, plan?.route?.adapterId);
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
