import { normalizeAiGatewayProviderId } from '../../shared/aiGatewayModelRoutes.js';
import { buildOpenAiCompatibleRuntimeRoutes } from './openai-compatible-config.js';

export class AiGatewayRouteError extends Error {
  constructor(message, code = 'AI_GATEWAY_NO_PROVIDER_ROUTE') {
    super(message);
    this.name = 'AiGatewayRouteError';
    this.code = code;
  }
}

export function normalizeAiGatewayRuntimeProviderId(value) {
  return normalizeAiGatewayProviderId(value);
}

/**
 * B2: runtime adapter/worker catalog only — fill defaults for an already-chosen provider.
 * Must not be used to rank/select providers (that authority is listGatewayRouteConfigs / decision).
 */
export const DEFAULT_AI_PROVIDER_ROUTES = Object.freeze([
  {
    providerId: 'vertex-site',
    workerId: 'text-worker',
    adapterId: 'ai-worker-proxy',
    channel: 'vertex-proxy',
    upstreamBackend: 'vertex',
    modalities: ['text'],
    capabilities: ['text.generate'],
    priority: 10,
  },
  {
    providerId: 'vertex-site',
    workerId: 'image-worker',
    adapterId: 'ai-worker-proxy',
    channel: 'vertex-proxy',
    upstreamBackend: 'vertex',
    modalities: ['image'],
    capabilities: ['image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit'],
    priority: 10,
  },
  {
    providerId: 'gemini-aistudio',
    workerId: 'text-worker',
    adapterId: 'ai-worker-proxy',
    channel: 'gemini-aistudio',
    upstreamBackend: 'gemini-api-key',
    modalities: ['text'],
    capabilities: ['text.generate'],
    priority: 20,
  },
  {
    providerId: 'gemini-aistudio',
    workerId: 'image-worker',
    adapterId: 'ai-worker-proxy',
    channel: 'gemini-aistudio',
    upstreamBackend: 'gemini-api-key',
    modalities: ['image'],
    capabilities: ['image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit'],
    priority: 20,
  },
  ...buildOpenAiCompatibleRuntimeRoutes(),
  {
    providerId: 'volcengine-ark',
    workerId: 'video-worker',
    adapterId: 'volcengine-ark-async',
    channel: 'volcengine-ark',
    upstreamBackend: 'volcengine-ark',
    modalities: ['video'],
    capabilities: ['video.generate', 'workflow_generate_video'],
    priority: 35,
  },
  {
    providerId: 'volcengine-ark',
    workerId: 'model3d-worker',
    adapterId: 'volcengine-ark-async',
    channel: 'volcengine-ark',
    upstreamBackend: 'volcengine-ark',
    modalities: ['model3d'],
    capabilities: ['model3d.generate'],
    priority: 35,
  },
  {
    providerId: 'volcengine-jimeng',
    workerId: 'image-worker',
    adapterId: 'jimeng-visual',
    channel: 'jimeng-visual',
    upstreamBackend: 'volcengine-jimeng',
    modalities: ['image'],
    capabilities: ['image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit'],
    priority: 15,
  },
  {
    providerId: 'volcengine-jimeng',
    workerId: 'video-worker',
    adapterId: 'jimeng-visual',
    channel: 'jimeng-visual',
    upstreamBackend: 'volcengine-jimeng',
    modalities: ['video'],
    capabilities: ['video.generate', 'workflow_generate_video', 'workflow_jimeng_video'],
    priority: 10,
  },
  {
    providerId: 'tripo',
    workerId: 'model3d-worker',
    adapterId: 'tripo-openapi',
    channel: 'tripo-openapi',
    upstreamBackend: 'tripo',
    modalities: ['model3d'],
    capabilities: ['model3d.generate'],
    priority: 10,
  },
  {
    providerId: 'tencent-hunyuan',
    workerId: 'model3d-worker',
    adapterId: 'tencent-hunyuan-3d',
    channel: 'tencent-hunyuan',
    upstreamBackend: 'tencent-hunyuan',
    modalities: ['model3d'],
    capabilities: ['model3d.generate'],
    priority: 20,
  },
]);

function matches(value, accepted) {
  return Array.isArray(accepted) && accepted.includes(value);
}

function routeMatchesJob(route, job) {
  const requestedProvider = normalizeAiGatewayRuntimeProviderId(job.provider);
  if (requestedProvider && route.providerId !== requestedProvider) return false;
  if (!matches(job.modality, route.modalities)) return false;
  if (matches(job.capability, route.capabilities)) return true;
  return route.capabilities.some((cap) => cap.endsWith('.generate') && job.capability === `${job.modality}.generate`);
}

function toPublicRoute(route) {
  return {
    providerId: route.providerId,
    workerId: route.workerId || null,
    adapterId: route.adapterId,
    legacyAdapterId: route.legacyAdapterId || null,
    channel: route.channel,
    upstreamBackend: route.upstreamBackend,
    routeId: route.routeId || null,
    endpointMapping: route.endpointMapping || null,
    upstreamModelId: route.upstreamModelId || null,
  };
}

/**
 * B2: look up adapter/worker defaults for a pinned provider + modality.
 * Never ranks across providers.
 */
export function lookupRuntimeAdapterDefaults(job, routes = DEFAULT_AI_PROVIDER_ROUTES, options = {}) {
  const providerId = normalizeAiGatewayRuntimeProviderId(job?.provider);
  if (!providerId) {
    throw new AiGatewayRouteError(
      'provider is required to look up runtime adapter defaults (use route decision / gatewayRouteConfigs)',
      'AI_GATEWAY_NO_PROVIDER_ROUTE'
    );
  }
  const disabledProviders = new Set(
    Array.isArray(options.disabledProviders)
      ? options.disabledProviders.map(normalizeAiGatewayRuntimeProviderId).filter(Boolean)
      : []
  );
  if (disabledProviders.has(providerId)) {
    throw new AiGatewayRouteError(
      `AI provider is paused by ops control: ${providerId}`,
      'AI_GATEWAY_PROVIDER_PAUSED'
    );
  }
  const disabledModels = new Set(Array.isArray(options.disabledModels) ? options.disabledModels : []);
  if (job.model && disabledModels.has(job.model)) {
    throw new AiGatewayRouteError(
      `AI model is paused by ops control: ${job.model}`,
      'AI_GATEWAY_MODEL_PAUSED'
    );
  }
  const jobForMatch = { ...(job && typeof job === 'object' ? job : {}), provider: providerId };
  const candidates = routes
    .filter((route) => route.providerId === providerId)
    .filter((route) => routeMatchesJob(route, jobForMatch))
    .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));
  const route = candidates[0];
  if (!route) {
    throw new AiGatewayRouteError(
      `No runtime adapter defaults for provider=${providerId} modality=${job.modality} capability=${job.capability}`
    );
  }
  return toPublicRoute(route);
}

/**
 * Materialize a runtime provider route from an already-chosen selectedRoute.
 * Does not re-rank providers — only fills worker/adapter/channel from the runtime catalog.
 */
export function materializeAiProviderRouteFromSelectedRoute(
  selectedRoute,
  job,
  routes = DEFAULT_AI_PROVIDER_ROUTES,
  options = {}
) {
  const providerId = normalizeAiGatewayRuntimeProviderId(selectedRoute?.providerId);
  if (!providerId) {
    throw new AiGatewayRouteError(
      'selectedRoute.providerId is required to materialize provider route',
      'AI_GATEWAY_NO_PROVIDER_ROUTE'
    );
  }
  const jobForMatch = { ...(job && typeof job === 'object' ? job : {}), provider: providerId };
  let base = null;
  try {
    base = lookupRuntimeAdapterDefaults(jobForMatch, routes, options);
  } catch (err) {
    if (selectedRoute?.adapterId && selectedRoute?.workerId) {
      base = {
        providerId,
        workerId: selectedRoute.workerId,
        adapterId: selectedRoute.adapterId,
        legacyAdapterId: selectedRoute.legacyAdapterId || null,
        channel: selectedRoute.channel || selectedRoute.adapterId,
        upstreamBackend: selectedRoute.upstreamBackend || providerId,
        routeId: selectedRoute.routeId || null,
        endpointMapping: selectedRoute.endpointMapping || null,
        upstreamModelId: selectedRoute.upstreamModelId || null,
      };
    } else {
      throw err;
    }
  }
  return {
    ...base,
    providerId,
    ...(selectedRoute.adapterId ? { adapterId: selectedRoute.adapterId } : {}),
    ...(selectedRoute.workerId ? { workerId: selectedRoute.workerId } : {}),
    ...(selectedRoute.routeId ? { routeId: selectedRoute.routeId } : {}),
    ...(selectedRoute.upstreamModelId ? { upstreamModelId: selectedRoute.upstreamModelId } : {}),
    ...(selectedRoute.channel ? { channel: selectedRoute.channel } : {}),
    ...(selectedRoute.upstreamBackend ? { upstreamBackend: selectedRoute.upstreamBackend } : {}),
    ...(selectedRoute.endpointMapping ? { endpointMapping: selectedRoute.endpointMapping } : {}),
    ...(selectedRoute.legacyAdapterId ? { legacyAdapterId: selectedRoute.legacyAdapterId } : {}),
  };
}

/** Fill adapterId/workerId on a decision selectedRoute from the runtime catalog (no re-selection). */
export function enrichSelectedRouteWithRuntimeDefaults(
  selectedRoute,
  job,
  routes = DEFAULT_AI_PROVIDER_ROUTES
) {
  if (!selectedRoute || typeof selectedRoute !== 'object') return selectedRoute;
  if (selectedRoute.adapterId && selectedRoute.workerId) return selectedRoute;
  try {
    const materialized = materializeAiProviderRouteFromSelectedRoute(selectedRoute, job, routes, {});
    return {
      ...selectedRoute,
      adapterId: selectedRoute.adapterId || materialized.adapterId || undefined,
      workerId: selectedRoute.workerId || materialized.workerId || undefined,
    };
  } catch {
    return selectedRoute;
  }
}

/**
 * @deprecated B2: do not use for provider selection. Prefer lookupRuntimeAdapterDefaults
 * after route decision / gatewayRouteConfigs. Kept for tests that pin job.provider.
 */
export function resolveAiProviderRoute(job, routes = DEFAULT_AI_PROVIDER_ROUTES, options = {}) {
  return lookupRuntimeAdapterDefaults(job, routes, options);
}

/**
 * Build a selectedRoute shell from an explicit provider pin + runtime adapter defaults.
 * Does not choose a provider when none is set.
 */
export function pickDefaultSelectedRouteForJob(job, routes = DEFAULT_AI_PROVIDER_ROUTES, options = {}) {
  const providerId = normalizeAiGatewayRuntimeProviderId(job?.provider);
  if (!providerId) {
    throw new AiGatewayRouteError(
      'Cannot pick selectedRoute without provider (run resolveAiGatewayRouteDecision or set model/provider)',
      'AI_GATEWAY_NO_PROVIDER_ROUTE'
    );
  }
  const route = lookupRuntimeAdapterDefaults({ ...job, provider: providerId }, routes, options);
  return {
    routeId: route.routeId || `${route.providerId}:${String(job?.modality || '').trim() || 'unknown'}`,
    providerId: route.providerId,
    adapterId: route.adapterId || undefined,
    workerId: route.workerId || undefined,
    upstreamModelId: route.upstreamModelId || undefined,
    priority: 100,
    fallbackPolicy: 'on_error',
  };
}
