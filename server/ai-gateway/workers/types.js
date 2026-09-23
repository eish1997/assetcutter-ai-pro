import { AiGatewayValidationError } from '../job.js';
import { isOpenAiCompatibleAdapterId, openAiCompatibleAdapterIdsForModality } from '../openai-compatible-config.js';

export {
  AI_GATEWAY_ADAPTER_RESULT_STATUSES,
  AI_GATEWAY_ARTIFACT_KINDS,
  normalizeAiGatewayAdapterResult,
  normalizeAiGatewayAdapterArtifact,
  validateAiGatewayAdapterResult,
  jobPatchFromAdapterResult,
  applyAiGatewayAdapterResult,
  validateJobAgainstAdapterContract,
} from '../adapter-result.js';

function liveAdaptersForWorker(worker) {
  const base = [...(worker?.adapters || [])];
  const modality = worker?.id === 'text-worker' ? 'text' : worker?.id === 'image-worker' ? 'image' : '';
  if (!modality) return base;
  const seen = new Set(base);
  for (const id of openAiCompatibleAdapterIdsForModality(modality)) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    base.push(id);
  }
  return base;
}

export function publicWorkerDescriptor(worker) {
  return {
    id: worker.id,
    modalities: [...(worker.modalities || [])],
    capabilities: [...(worker.capabilities || [])],
    adapters: liveAdaptersForWorker(worker),
    status: worker.status,
  };
}

/**
 * Builtin adapter list is a seed snapshot; OpenAI-compatible providers registered at
 * runtime (ops openAiCompatibleProviders) must be accepted on text/image without restart.
 */
export function assertWorkerSupportsAdapter(worker, adapterId) {
  const key = String(adapterId || '').trim();
  const listed = Boolean(worker?.adapters?.includes(key));
  const openAiRuntimeOk =
    (worker?.id === 'text-worker' || worker?.id === 'image-worker') && isOpenAiCompatibleAdapterId(key);
  if (!listed && !openAiRuntimeOk) {
    throw new AiGatewayValidationError(
      `Worker ${worker?.id || 'unknown'} does not support adapter ${key || 'missing'}`,
      'AI_GATEWAY_WORKER_ADAPTER_UNSUPPORTED'
    );
  }
  return key;
}
