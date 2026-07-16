import { createAiJobDraft } from './job.js';
import { resolveAiProviderRoute } from './provider-router.js';
import { buildAiGatewayWorkerRequest } from './workers/registry.js';
import {
  applyAiGatewayModelOverride,
  readAiGatewayOpsControlConfigSync,
} from './ops-control.js';
import {
  normalizeAiGatewayProviderId,
  resolveExecutableAiGatewayModelRoute,
} from '../../shared/aiGatewayModelRoutes.js';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function resolveRequestedModelId(job) {
  const input = job?.input && typeof job.input === 'object' ? job.input : {};
  const metadata = job?.metadata && typeof job.metadata === 'object' ? job.metadata : {};
  return (
    nonEmptyString(job?.model) ||
    nonEmptyString(input.canonicalModelId) ||
    nonEmptyString(input.registryId) ||
    nonEmptyString(input.model) ||
    nonEmptyString(metadata.canonicalModelId) ||
    nonEmptyString(metadata.modelPublication?.canonicalModelId)
  );
}

function applyModelRouteProviderInference(job, opsControl = {}) {
  const explicitProvider = normalizeAiGatewayProviderId(job?.provider);
  if (explicitProvider) {
    if (explicitProvider === job.provider) return { job, inferred: null };
    return { job: { ...job, provider: explicitProvider }, inferred: null };
  }
  const canonicalModelId = resolveRequestedModelId(job);
  if (!canonicalModelId) return { job, inferred: null };
  const route = resolveExecutableAiGatewayModelRoute({
    canonicalModelId,
    modality: job.modality,
    disabledProviders: opsControl.disabledProviders,
  });
  if (!route?.providerId) return { job, inferred: null };
  return {
    job: {
      ...job,
      provider: route.providerId,
      metadata: {
        ...(job.metadata && typeof job.metadata === 'object' ? job.metadata : {}),
        modelRouteInference: {
          canonicalModelId,
          providerId: route.providerId,
          ruleId: route.ruleId,
        },
      },
    },
    inferred: route,
  };
}

export function createAiGatewayJobPlan(input, options = {}) {
  const draft = createAiJobDraft(input, options);
  const opsControl = options.opsControl || readAiGatewayOpsControlConfigSync();
  const overridden = applyAiGatewayModelOverride(draft, opsControl);
  const { job } = applyModelRouteProviderInference(overridden.job, opsControl);
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
