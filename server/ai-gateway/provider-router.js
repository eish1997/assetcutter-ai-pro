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
    base = resolveAiProviderRoute(jobForMatch, routes, options);
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

export function resolveAiProviderRoute(job, routes = DEFAULT_AI_PROVIDER_ROUTES, options = {}) {
  const disabledProviders = new Set(
    Array.isArray(options.disabledProviders)
      ? options.disabledProviders.map(normalizeAiGatewayRuntimeProviderId).filter(Boolean)
      : []
  );
  const disabledModels = new Set(Array.isArray(options.disabledModels) ? options.disabledModels : []);
  if (job.model && disabledModels.has(job.model)) {
    throw new AiGatewayRouteError(
      `AI model is paused by ops control: ${job.model}`,
      'AI_GATEWAY_MODEL_PAUSED'
    );
  }
  const candidates = routes
    .filter((route) => routeMatchesJob(route, job))
    .filter((route) => !disabledProviders.has(route.providerId))
    .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));

  const route = candidates[0];
  if (!route) {
    const wanted = job.provider ? ` provider=${normalizeAiGatewayRuntimeProviderId(job.provider) || job.provider}` : '';
    throw new AiGatewayRouteError(
      `No AI provider route for modality=${job.modality} capability=${job.capability}${wanted}`
    );
  }

  return toPublicRoute(route);
}

/**
 * Modality/capability-only plans (no model decision): pick the top runtime catalog row
 * and return it as a selectedRoute so createAiGatewayJobPlan never re-ranks later.
 */
export function pickDefaultSelectedRouteForJob(job, routes = DEFAULT_AI_PROVIDER_ROUTES, options = {}) {
  const route = resolveAiProviderRoute(job, routes, options);
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
