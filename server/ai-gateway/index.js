import { createAiJobDraft } from './job.js';
import {
  AiGatewayRouteError,
  materializeAiProviderRouteFromSelectedRoute,
} from './provider-router.js';
import { buildAiGatewayWorkerRequest } from './workers/registry.js';
import {
  applyAiGatewayModelOverride,
  readAiGatewayOpsControlConfigSync,
} from './ops-control.js';
import { normalizeAiGatewayProviderId } from '../../shared/aiGatewayModelRoutes.js';
import { listGatewayRouteConfigs, resolveGatewayRouteConfig } from './route-config-source.js';

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

function readRouteDecision(job, options = {}) {
  if (options.routeDecision && typeof options.routeDecision === 'object') return options.routeDecision;
  const metadata = job?.metadata && typeof job.metadata === 'object' ? job.metadata : {};
  if (metadata.routeDecision && typeof metadata.routeDecision === 'object') return metadata.routeDecision;
  return null;
}

function readSelectedRoute(job, options = {}) {
  if (options.selectedRoute && typeof options.selectedRoute === 'object') return options.selectedRoute;
  const decision = readRouteDecision(job, options);
  if (decision?.selectedRoute && typeof decision.selectedRoute === 'object') return decision.selectedRoute;
  return null;
}

/**
 * When callers did not run resolveAiGatewayRouteDecision first (unit tests / modality-only plans),
 * derive a selectedRoute from the same route-config-source decision uses — never a second ranking.
 */
function selectedRouteFromExecutableModelTable(job, opsControl = {}, modelOpsConfig = null) {
  const canonicalModelId = resolveRequestedModelId(job);
  const explicitProvider = normalizeAiGatewayProviderId(job?.provider);
  if (!canonicalModelId && !explicitProvider) {
    return { selectedRoute: null, modelRouteInference: null };
  }
  if (!canonicalModelId) {
    return {
      selectedRoute: explicitProvider ? { providerId: explicitProvider } : null,
      modelRouteInference: null,
    };
  }
  const routeInput = {
    canonicalModelId,
    modality: job.modality,
    provider: explicitProvider || undefined,
    disabledProviders: opsControl.disabledProviders,
  };
  // Multi-provider families (Gemini/GPT) must not silent-pick seed[0] (often vertex-site)
  // without Key-aware route decision. Only infer when exactly one seed route remains.
  if (!explicitProvider) {
    const candidates = listGatewayRouteConfigs(routeInput, modelOpsConfig || {}).filter(
      (row) => row?.providerId && row.enabled !== false
    );
    if (candidates.length !== 1) {
      return { selectedRoute: null, modelRouteInference: null };
    }
  }
  const modelRoute = resolveGatewayRouteConfig(routeInput, modelOpsConfig || {});
  if (!modelRoute?.providerId || modelRoute.enabled === false) {
    return {
      selectedRoute: explicitProvider ? { providerId: explicitProvider } : null,
      modelRouteInference: null,
    };
  }
  const priority = Number(modelRoute.priority);
  return {
    selectedRoute: {
      routeId: `${modelRoute.canonicalModelId}:${modelRoute.providerId}:${String(job.modality || '').trim()}`,
      providerId: modelRoute.providerId,
      upstreamModelId: nonEmptyString(modelRoute.upstreamModelId) || undefined,
      priority: Number.isFinite(priority) ? Math.floor(priority) : 100,
      fallbackPolicy: 'on_error',
    },
    // Only when provider was inferred (not caller-pinned) — keeps fallbackEnabledForPlan behavior.
    modelRouteInference: explicitProvider
      ? null
      : {
          canonicalModelId,
          providerId: modelRoute.providerId,
          ruleId: modelRoute.ruleId,
        },
  };
}

export function createAiGatewayJobPlan(input, options = {}) {
  const draft = createAiJobDraft(input, options);
  const opsControl = options.opsControl || readAiGatewayOpsControlConfigSync();
  const overridden = applyAiGatewayModelOverride(draft, opsControl);
  let job = overridden.job;

  const routeDecision = readRouteDecision(job, options);
  let selectedRoute = readSelectedRoute(job, options);
  let planRouteSource = selectedRoute ? 'route_decision_selected_route' : null;
  let modelRouteInference = null;

  if (!selectedRoute) {
    const derived = selectedRouteFromExecutableModelTable(job, opsControl, options.modelOpsConfig);
    selectedRoute = derived.selectedRoute;
    modelRouteInference = derived.modelRouteInference;
    if (selectedRoute) {
      planRouteSource = modelRouteInference || resolveRequestedModelId(job)
        ? 'gateway_route_config_source'
        : 'explicit_provider_pin';
    }
  }

  if (!selectedRoute?.providerId) {
    // B2: never rank providers from DEFAULT_AI_PROVIDER_ROUTES. Only materialize when provider is known.
    throw new AiGatewayRouteError(
      'No selectedRoute/provider for job plan (run resolveAiGatewayRouteDecision or set model/provider)',
      'AI_GATEWAY_NO_PROVIDER_ROUTE'
    );
  }

  const providerId = normalizeAiGatewayProviderId(selectedRoute.providerId) || selectedRoute.providerId;
  job = {
    ...job,
    provider: providerId,
    metadata: {
      ...(job.metadata && typeof job.metadata === 'object' ? job.metadata : {}),
      ...(routeDecision ? { routeDecision } : {}),
      ...(modelRouteInference ? { modelRouteInference } : {}),
      planRouteSource,
      ...(modelRouteInference
        ? {
            aiGatewayFallback: {
              ...(job.metadata?.aiGatewayFallback && typeof job.metadata.aiGatewayFallback === 'object'
                ? job.metadata.aiGatewayFallback
                : {}),
              autoSelectedProvider: true,
            },
          }
        : {}),
    },
  };
  const route = materializeAiProviderRouteFromSelectedRoute(selectedRoute, job, options.routes, opsControl);
  const workerRequest = buildAiGatewayWorkerRequest(job, route);
  return {
    job,
    route,
    workerRequest,
    adapterRequest: workerRequest,
  };
}

export { createAiJobDraft, normalizeAiJobModality, AiGatewayValidationError } from './job.js';
export {
  resolveAiProviderRoute,
  lookupRuntimeAdapterDefaults,
  materializeAiProviderRouteFromSelectedRoute,
  pickDefaultSelectedRouteForJob,
  enrichSelectedRouteWithRuntimeDefaults,
  AiGatewayRouteError,
  DEFAULT_AI_PROVIDER_ROUTES,
} from './provider-router.js';
export { buildAiWorkerProxyAsyncRequest, AI_WORKER_PROXY_ASYNC_PATH } from './adapters/ai-worker-proxy-adapter.js';
export {
  buildAiGatewayWorkerRequest,
  cancelAiGatewayWorkerExecution,
  estimateAiGatewayWorkerCost,
  listAiGatewayWorkers,
  resolveAiGatewayWorker,
  settleAiGatewayWorkerUsage,
  startAiGatewayWorkerExecution,
} from './workers/registry.js';
