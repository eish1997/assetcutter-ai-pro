import { buildAiWorkerProxyAsyncRequest } from '../adapters/ai-worker-proxy-adapter.js';
import { buildJimengImageWorkerRequest, cancelJimengImageExecution, startJimengImageExecution } from '../adapters/jimeng-visual-adapter.js';
import { startAiWorkerProxyExecution } from '../adapters/ai-worker-proxy-execution.js';
import { buildOpenAiOfficialRequest, startOpenAiOfficialExecution } from '../adapters/openai-official-adapter.js';
import { isOpenAiCompatibleAdapterId, openAiCompatibleAdapterIdsForModality } from '../openai-compatible-config.js';
import { assertWorkerSupportsAdapter } from './types.js';

const IMAGE_OPENAI_COMPATIBLE_ADAPTERS = Object.freeze(openAiCompatibleAdapterIdsForModality('image'));

export const imageWorker = Object.freeze({
  id: 'image-worker',
  modalities: Object.freeze(['image']),
  capabilities: Object.freeze(['image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit']),
  adapters: Object.freeze(['ai-worker-proxy', ...IMAGE_OPENAI_COMPATIBLE_ADAPTERS, 'jimeng-visual']),
  status: 'active',
  buildRequest(job, route) {
    assertWorkerSupportsAdapter(imageWorker, route?.adapterId);
    if (
      isOpenAiCompatibleAdapterId(route?.adapterId)
    ) return buildOpenAiOfficialRequest(job, route);
    if (route?.adapterId === 'jimeng-visual') return buildJimengImageWorkerRequest(job, route);
    return buildAiWorkerProxyAsyncRequest(job, route);
  },
  start(plan, options = {}) {
    assertWorkerSupportsAdapter(imageWorker, plan?.route?.adapterId);
    if (
      isOpenAiCompatibleAdapterId(plan?.route?.adapterId)
    ) {
      return startOpenAiOfficialExecution(plan, options);
    }
    if (plan?.route?.adapterId === 'jimeng-visual') return startJimengImageExecution(plan, options);
    return startAiWorkerProxyExecution(plan, options);
  },
  async cancel(plan, options = {}) {
    if (plan?.route?.adapterId === 'jimeng-visual') return cancelJimengImageExecution(plan, options);
    return { cancelled: false, mode: 'soft', reason: 'legacy_adapter_cancel_not_supported' };
  },
  estimateCost() {
    return null;
  },
  settleUsage() {
    return null;
  },
});
