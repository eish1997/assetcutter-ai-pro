import { buildGeminiProxyAsyncRequest } from '../adapters/gemini-proxy-adapter.js';
import { startLegacyGeminiProxyExecution } from '../adapters/legacy-gemini-proxy-execution.js';
import { buildOpenAiOfficialRequest, startOpenAiOfficialExecution } from '../adapters/openai-official-adapter.js';
import { assertWorkerSupportsAdapter } from './types.js';

export const imageWorker = Object.freeze({
  id: 'image-worker',
  modalities: Object.freeze(['image']),
  capabilities: Object.freeze(['image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit']),
  adapters: Object.freeze(['legacy-gemini-proxy', 'openai-official', 'toapis-openai']),
  status: 'active',
  buildRequest(job, route) {
    assertWorkerSupportsAdapter(imageWorker, route?.adapterId);
    if (route?.adapterId === 'openai-official' || route?.adapterId === 'toapis-openai') return buildOpenAiOfficialRequest(job, route);
    return buildGeminiProxyAsyncRequest(job, route);
  },
  start(plan, options = {}) {
    assertWorkerSupportsAdapter(imageWorker, plan?.route?.adapterId);
    if (plan?.route?.adapterId === 'openai-official' || plan?.route?.adapterId === 'toapis-openai') {
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
