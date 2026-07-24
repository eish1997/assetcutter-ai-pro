import { buildAiWorkerProxyAsyncRequest } from '../adapters/ai-worker-proxy-adapter.js';
import { startAiWorkerProxyExecution } from '../adapters/ai-worker-proxy-execution.js';
import { buildOpenAiOfficialRequest, startOpenAiOfficialExecution } from '../adapters/openai-official-adapter.js';
import { isOpenAiCompatibleAdapterId, openAiCompatibleAdapterIdsForModality } from '../openai-compatible-config.js';
import { assertWorkerSupportsAdapter } from './types.js';

const TEXT_OPENAI_COMPATIBLE_ADAPTERS = Object.freeze(openAiCompatibleAdapterIdsForModality('text'));

export const textWorker = Object.freeze({
  id: 'text-worker',
  modalities: Object.freeze(['text']),
  capabilities: Object.freeze(['text.generate']),
  adapters: Object.freeze(['ai-worker-proxy', ...TEXT_OPENAI_COMPATIBLE_ADAPTERS]),
  status: 'active',
  buildRequest(job, route) {
    assertWorkerSupportsAdapter(textWorker, route?.adapterId);
    if (
      isOpenAiCompatibleAdapterId(route?.adapterId)
    ) return buildOpenAiOfficialRequest(job, route);
    return buildAiWorkerProxyAsyncRequest(job, route);
  },
  start(plan, options = {}) {
    assertWorkerSupportsAdapter(textWorker, plan?.route?.adapterId);
    if (
      isOpenAiCompatibleAdapterId(plan?.route?.adapterId)
    ) {
      return startOpenAiOfficialExecution(plan, options);
    }
    return startAiWorkerProxyExecution(plan, options);
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
