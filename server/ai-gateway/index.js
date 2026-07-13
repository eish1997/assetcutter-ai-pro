import { createAiJobDraft } from './job.js';
import { resolveAiProviderRoute } from './provider-router.js';
import { buildAiGatewayWorkerRequest } from './workers/registry.js';
import {
  applyAiGatewayModelOverride,
  readAiGatewayOpsControlConfigSync,
} from './ops-control.js';

export function createAiGatewayJobPlan(input, options = {}) {
  const draft = createAiJobDraft(input, options);
  const opsControl = options.opsControl || readAiGatewayOpsControlConfigSync();
  const { job } = applyAiGatewayModelOverride(draft, opsControl);
  const route = resolveAiProviderRoute(job, options.routes, opsControl);

  const workerRequest = buildAiGatewayWorkerRequest(job, route);
  return {
    job,
    route,
    workerRequest,
    adapterRequest: workerRequest,
  };
}

export { createAiJobDraft, normalizeAiJobModality, AiGatewayValidationError } from './job.js';
export { resolveAiProviderRoute, AiGatewayRouteError, DEFAULT_AI_PROVIDER_ROUTES } from './provider-router.js';
export { buildGeminiProxyAsyncRequest, GEMINI_PROXY_ASYNC_PATH } from './adapters/gemini-proxy-adapter.js';
export {
  buildAiGatewayWorkerRequest,
  cancelAiGatewayWorkerExecution,
  estimateAiGatewayWorkerCost,
  listAiGatewayWorkers,
  resolveAiGatewayWorker,
  settleAiGatewayWorkerUsage,
  startAiGatewayWorkerExecution,
} from './workers/registry.js';
