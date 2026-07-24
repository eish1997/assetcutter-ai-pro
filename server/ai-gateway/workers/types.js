import { AiGatewayValidationError } from '../job.js';

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

export function createPlannedWorker({ id, modalities, capabilities = [] }) {
  return Object.freeze({
    id,
    modalities: Object.freeze([...modalities]),
    capabilities: Object.freeze([...capabilities]),
    adapters: Object.freeze([]),
    status: 'planned',
    buildRequest() {
      throw new AiGatewayValidationError(`AI gateway worker ${id} is planned but not implemented`, 'AI_GATEWAY_WORKER_PLANNED');
    },
    async start() {
      throw new AiGatewayValidationError(`AI gateway worker ${id} is planned but not implemented`, 'AI_GATEWAY_WORKER_PLANNED');
    },
    async cancel() {
      return { cancelled: false, mode: 'not_supported', reason: 'worker_planned' };
    },
    estimateCost() {
      return null;
    },
    settleUsage() {
      return null;
    },
  });
}

export function publicWorkerDescriptor(worker) {
  return {
    id: worker.id,
    modalities: [...(worker.modalities || [])],
    capabilities: [...(worker.capabilities || [])],
    adapters: [...(worker.adapters || [])],
    status: worker.status,
  };
}

export function assertWorkerSupportsAdapter(worker, adapterId) {
  const key = String(adapterId || '').trim();
  if (!worker?.adapters?.includes(key)) {
    throw new AiGatewayValidationError(
      `Worker ${worker?.id || 'unknown'} does not support adapter ${key || 'missing'}`,
      'AI_GATEWAY_WORKER_ADAPTER_UNSUPPORTED'
    );
  }
  return key;
}
