import { AiGatewayValidationError } from './job.js';
import { listProviderKeys } from './provider-key-store.js';
import { resolveRequestedCanonicalModelId } from './model-publication-guard.js';
import {
  listExecutableAiGatewayModelRoutes,
  normalizeAiGatewayProviderId,
  resolveExecutableAiGatewayModelRoute,
  resolvePendingAiGatewayModelRoute,
} from '../../shared/aiGatewayModelRoutes.js';
import { openAiCompatibleChannelForProvider } from './openai-compatible-config.js';

const REQUIRED_ENDPOINT_MAPPING_FIELDS = Object.freeze(['requestPath', 'pollPath', 'statusPath', 'artifactPath']);
const OPENAI_COMPATIBLE_ASYNC_PROVIDERS = new Set(['302ai', 'aihubmix', 'toapis', 'tinysnow']);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function resolveExecutableModelRoute(input, options = {}) {
  const canonicalModelId = resolveRequestedCanonicalModelId(input);
  if (!canonicalModelId) return null;
  return resolveExecutableAiGatewayModelRoute({
    canonicalModelId,
    modality: input?.modality,
    provider: normalizeAiGatewayProviderId(input?.provider),
    disabledProviders: options.disabledProviders,
  });
}

export function resolveKnownPendingModelRoute(input, options = {}) {
  const canonicalModelId = resolveRequestedCanonicalModelId(input);
  if (!canonicalModelId) return null;
  const executable = resolveExecutableAiGatewayModelRoute({
    canonicalModelId,
    modality: input?.modality,
    provider: normalizeAiGatewayProviderId(input?.provider),
    disabledProviders: options.disabledProviders,
  });
  if (executable) return null;
  return resolvePendingAiGatewayModelRoute({
    canonicalModelId,
    modality: input?.modality,
    provider: normalizeAiGatewayProviderId(input?.provider),
    disabledProviders: options.disabledProviders,
  });
}

function providerKeyUsable(row) {
  if (!row || row.enabled === false) return false;
  if (row.runtime?.coolingDown) return false;
  return Boolean(row.hasSecret || row.hasCredentials || row.secret || Object.keys(row.credentials || {}).length);
}

function routeHasUsableKey(route, keys) {
  if (!route.platformKeyRequired) return true;
  return (Array.isArray(keys) ? keys : []).some(
    (row) => normalizeAiGatewayProviderId(row?.provider) === route.providerId && providerKeyUsable(row)
  );
}

function endpointMappingRouteId(input, canonicalModelId, providerId, modality) {
  return (
    nonEmptyString(input?.routeId) ||
    nonEmptyString(input?.metadata?.modelRouteGuard?.routeId) ||
    `${canonicalModelId}:${providerId}:${modality}`
  );
}

function endpointMappingForRoute(modelOpsConfig, routeId) {
  const id = nonEmptyString(routeId);
  const rows = Array.isArray(modelOpsConfig?.endpointMappings) ? modelOpsConfig.endpointMappings : [];
  return rows.find((row) => nonEmptyString(row?.routeId) === id) || null;
}

function endpointMappingPriority(row) {
  const priority = Number(row?.priority);
  return Number.isFinite(priority) ? Math.floor(priority) : 100;
}

function parseEndpointMappingRouteId(routeId) {
  const parts = nonEmptyString(routeId).split(':');
  if (parts.length < 3) return null;
  const modality = parts[parts.length - 1];
  const providerId = normalizeAiGatewayProviderId(parts[parts.length - 2]);
  const canonicalModelId = parts.slice(0, -2).join(':');
  if (!canonicalModelId || !providerId || !modality) return null;
  return { canonicalModelId, providerId, modality };
}

function endpointMappingCandidate(input, canonicalModelId, modelOpsConfig) {
  const explicitProviderId = normalizeAiGatewayProviderId(input?.provider);
  const modality = String(input?.modality || '').trim();
  const explicitRouteId = nonEmptyString(input?.routeId) || nonEmptyString(input?.metadata?.modelRouteGuard?.routeId);
  const rows = Array.isArray(modelOpsConfig?.endpointMappings) ? modelOpsConfig.endpointMappings : [];
  if (explicitRouteId) {
    const parsed = parseEndpointMappingRouteId(explicitRouteId);
    if (!parsed) return null;
    if (canonicalModelId && parsed.canonicalModelId !== canonicalModelId) return null;
    if (explicitProviderId && parsed.providerId !== explicitProviderId) return null;
    if (modality && parsed.modality !== modality) return null;
    const mapping = endpointMappingForRoute(modelOpsConfig, explicitRouteId);
    return mapping ? { ...parsed, routeId: explicitRouteId, mapping } : null;
  }
  if (!modality) return null;
  if (explicitProviderId) {
    const routeId = endpointMappingRouteId(input, canonicalModelId, explicitProviderId, modality);
    const mapping = endpointMappingForRoute(modelOpsConfig, routeId);
    return mapping ? { canonicalModelId, providerId: explicitProviderId, modality, routeId, mapping } : null;
  }
  const matches = rows
    .map((row) => {
      const routeId = nonEmptyString(row?.routeId);
      const parsed = parseEndpointMappingRouteId(routeId);
      if (!parsed) return null;
      if (parsed.canonicalModelId !== canonicalModelId || parsed.modality !== modality) return null;
      if (!OPENAI_COMPATIBLE_ASYNC_PROVIDERS.has(parsed.providerId)) return null;
      if (row?.enabled !== true) return null;
      return { ...parsed, routeId, mapping: row };
    })
    .filter(Boolean);
  if (matches.length <= 1) return matches[0] || null;
  const sorted = [...matches].sort((a, b) => endpointMappingPriority(a.mapping) - endpointMappingPriority(b.mapping));
  const bestPriority = endpointMappingPriority(sorted[0].mapping);
  const best = sorted.filter((row) => endpointMappingPriority(row.mapping) === bestPriority);
  if (best.length === 1) return best[0];
  throw new AiGatewayValidationError(
    `Multiple enabled endpoint mappings match ${canonicalModelId}/${modality}; set a unique priority or explicit provider`,
    'AI_GATEWAY_MODEL_ROUTE_AMBIGUOUS',
    {
      canonicalModelId,
      modality,
      routeIds: best.map((row) => row.routeId),
      providers: best.map((row) => row.providerId),
      priority: bestPriority,
    }
  );
}

function missingEndpointMappingFields(mapping) {
  return REQUIRED_ENDPOINT_MAPPING_FIELDS.filter((field) => !nonEmptyString(mapping?.[field]));
}

function mappedAsyncRouteFromOps(input, canonicalModelId, modelOpsConfig, options = {}) {
  const candidate = endpointMappingCandidate(input, canonicalModelId, modelOpsConfig);
  const providerId = candidate?.providerId;
  const modality = candidate?.modality;
  if (!canonicalModelId || !providerId || !modality) return null;
  if (!OPENAI_COMPATIBLE_ASYNC_PROVIDERS.has(providerId)) return null;
  if (modality !== 'video' && modality !== 'model3d') return null;
  const routeId = candidate.routeId;
  const mapping = candidate.mapping;
  if (!mapping || mapping.enabled !== true) return null;
  const missing = missingEndpointMappingFields(mapping);
  if (missing.length) {
    throw new AiGatewayValidationError(
      `AI model route endpoint mapping is incomplete: ${missing.join(', ')}`,
      'AI_GATEWAY_MODEL_PARAMETER_PENDING',
      { routeId, missingEndpointFields: missing }
    );
  }
  const disabledProviders = Array.isArray(options.disabledProviders)
    ? options.disabledProviders.map(normalizeAiGatewayProviderId)
    : [];
  if (disabledProviders.includes(providerId)) {
    throw new AiGatewayValidationError(
      `AI provider route is paused by ops control: ${providerId}`,
      'AI_GATEWAY_PROVIDER_PAUSED',
      { providerIds: [providerId], canonicalModelId, modality }
    );
  }
  return {
    ruleId: 'ops-endpoint-mapping',
    routeId,
    canonicalModelId,
    providerId,
    gatewayExecutionStatus: 'gateway_ready',
    executionStatus: 'platform_ready',
    platformKeyRequired: true,
    workerId: modality === 'model3d' ? 'model3d-worker' : 'video-worker',
    adapterId: 'openai-compatible-async',
    channel: `${providerId}-async`,
    upstreamBackend: providerId,
    modalities: [modality],
    capabilities: [
      modality === 'model3d' ? 'model3d.generate' : 'video.generate',
      ...(modality === 'video' ? ['workflow_generate_video'] : []),
    ],
    priority: Number(mapping.priority) || 80,
    endpointMapping: {
      method: nonEmptyString(mapping.method).toUpperCase() || 'POST',
      requestPath: nonEmptyString(mapping.requestPath),
      pollPath: nonEmptyString(mapping.pollPath),
      statusPath: nonEmptyString(mapping.statusPath),
      artifactPath: nonEmptyString(mapping.artifactPath),
      taskIdPath: nonEmptyString(mapping.taskIdPath) || undefined,
      errorPath: nonEmptyString(mapping.errorPath) || undefined,
    },
    upstreamModelId: nonEmptyString(mapping.upstreamOverride) || undefined,
  };
}

function routeRole(route, fallbackModality) {
  const modality = String(route?.modality || fallbackModality || '').trim();
  if (modality === 'text') return 'text';
  if (modality === 'image') return 'image';
  return '';
}

function channelCandidatesForRoute(route, fallbackModality) {
  const providerId = normalizeAiGatewayProviderId(route?.providerId);
  const model = String(route?.canonicalModelId || '').trim();
  const role = routeRole(route, fallbackModality);
  if (!providerId || !model || !role) return [];
  if (providerId === 'vertex-site') return [`${model}:vertex-proxy:${role}`];
  if (providerId === 'gemini-aistudio') return [`${model}:gemini-aistudio:${role}`];
  if (providerId === 'toapis') return [`${model}:toapis-gemini:${role}`, `${model}:toapis-openai:${role}`];
  const openAiChannel = openAiCompatibleChannelForProvider(providerId);
  if (openAiChannel) return [`${model}:${openAiChannel}:${role}`];
  if (providerId === 'vectorengine') return [`${model}:vectorengine:${role}`];
  if (providerId === 'volcengine-ark') return [`${model}:volcengine-ark:${role}`];
  if (providerId === 'volcengine-jimeng') return [`${model}:volcengine-jimeng:${role}`];
  return [];
}

function priorityOverridesByBindingId(modelOpsConfig) {
  const rows = Array.isArray(modelOpsConfig?.bindingOverrides) ? modelOpsConfig.bindingOverrides : [];
  const out = new Map();
  for (const row of rows) {
    const bindingId = String(row?.bindingId || '').trim();
    const priority = Number(row?.priority);
    if (!bindingId || !Number.isFinite(priority)) continue;
    out.set(bindingId, Math.floor(priority));
  }
  return out;
}

function fallbackPolicyOverridesByBindingId(modelOpsConfig) {
  const rows = Array.isArray(modelOpsConfig?.bindingOverrides) ? modelOpsConfig.bindingOverrides : [];
  const out = new Map();
  const allowed = new Set(['none', 'on_error', 'on_rate_limit', 'on_timeout', 'on_provider_degraded', 'cost_optimized', 'quality_first']);
  for (const row of rows) {
    const bindingId = String(row?.bindingId || '').trim();
    const fallbackPolicy = String(row?.fallbackPolicy || '').trim();
    if (!bindingId || !allowed.has(fallbackPolicy)) continue;
    out.set(bindingId, fallbackPolicy);
  }
  return out;
}

function fallbackMaxAttemptsByBindingId(modelOpsConfig) {
  const rows = Array.isArray(modelOpsConfig?.bindingOverrides) ? modelOpsConfig.bindingOverrides : [];
  const out = new Map();
  for (const row of rows) {
    const bindingId = String(row?.bindingId || '').trim();
    const fallbackMaxAttempts = Number(row?.fallbackMaxAttempts);
    if (!bindingId || !Number.isFinite(fallbackMaxAttempts)) continue;
    out.set(bindingId, Math.max(1, Math.min(5, Math.floor(fallbackMaxAttempts))));
  }
  return out;
}

function disabledBindingIds(modelOpsConfig) {
  const rows = Array.isArray(modelOpsConfig?.bindingOverrides) ? modelOpsConfig.bindingOverrides : [];
  const out = new Set();
  for (const row of rows) {
    const bindingId = String(row?.bindingId || '').trim();
    if (bindingId && row?.enabled === false) out.add(bindingId);
  }
  return out;
}

function upstreamOverridesByBindingId(modelOpsConfig) {
  const rows = Array.isArray(modelOpsConfig?.bindingOverrides) ? modelOpsConfig.bindingOverrides : [];
  const out = new Map();
  for (const row of rows) {
    const bindingId = String(row?.bindingId || '').trim();
    const upstreamOverride = nonEmptyString(row?.upstreamOverride);
    if (!bindingId || !upstreamOverride) continue;
    out.set(bindingId, upstreamOverride);
  }
  return out;
}

function routeDisabledByAdminOverride(route, modelOpsConfig, fallbackModality) {
  if (!route) return false;
  const disabled = disabledBindingIds(modelOpsConfig);
  if (!disabled.size) return false;
  return channelCandidatesForRoute(route, fallbackModality).some((bindingId) => disabled.has(bindingId));
}

function routePriority(route, priorityByBindingId, fallbackModality) {
  for (const bindingId of channelCandidatesForRoute(route, fallbackModality)) {
    if (priorityByBindingId.has(bindingId)) return priorityByBindingId.get(bindingId);
  }
  return Number.POSITIVE_INFINITY;
}

function sortRoutesByAdminPriority(routes, modelOpsConfig, fallbackModality) {
  if (!Array.isArray(routes) || routes.length < 2) return routes;
  const priorityByBindingId = priorityOverridesByBindingId(modelOpsConfig);
  if (!priorityByBindingId.size) return routes;
  return [...routes].sort((a, b) => {
    const ap = routePriority(a, priorityByBindingId, fallbackModality);
    const bp = routePriority(b, priorityByBindingId, fallbackModality);
    if (ap !== bp) return ap - bp;
    return 0;
  });
}

function routeWithAdminOverrides(route, modelOpsConfig, fallbackModality) {
  if (!route) return route;
  const policyByBindingId = fallbackPolicyOverridesByBindingId(modelOpsConfig);
  const maxAttemptsByBindingId = fallbackMaxAttemptsByBindingId(modelOpsConfig);
  const upstreamByBindingId = upstreamOverridesByBindingId(modelOpsConfig);
  if (!policyByBindingId.size && !maxAttemptsByBindingId.size && !upstreamByBindingId.size) return route;
  let out = route;
  for (const bindingId of channelCandidatesForRoute(route, fallbackModality)) {
    const fallbackPolicy = policyByBindingId.get(bindingId);
    const fallbackMaxAttempts = maxAttemptsByBindingId.get(bindingId);
    const upstreamModelId = upstreamByBindingId.get(bindingId);
    if (fallbackPolicy || fallbackMaxAttempts || upstreamModelId) {
      out = {
        ...out,
        ...(fallbackPolicy ? { fallbackPolicy } : {}),
        ...(fallbackMaxAttempts ? { fallbackMaxAttempts } : {}),
        ...(upstreamModelId ? { upstreamModelId } : {}),
      };
    }
  }
  return out;
}

export async function validateAiGatewayModelRouteExecutable(input, options = {}) {
  const canonicalModelId = resolveRequestedCanonicalModelId(input);
  if (!canonicalModelId) return { ok: true, canonicalModelId: null, route: null, checked: false };

  const mappedAsyncRoute = mappedAsyncRouteFromOps(input, canonicalModelId, options.modelOpsConfig, options);
  if (mappedAsyncRoute) {
    if (options.checkProviderKeys !== false) {
      const keys = await (options.listProviderKeys || listProviderKeys)();
      if (!routeHasUsableKey(mappedAsyncRoute, keys)) {
        throw new AiGatewayValidationError(
          `No usable platform key for AI provider: ${mappedAsyncRoute.providerId}`,
          'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE'
        );
      }
    }
    return {
      ok: true,
      canonicalModelId,
      route: mappedAsyncRoute,
      runtimeRoute: mappedAsyncRoute,
      checked: true,
    };
  }

  const routeInput = {
    canonicalModelId,
    modality: input?.modality,
    provider: normalizeAiGatewayProviderId(input?.provider),
    disabledProviders: options.disabledProviders,
  };
  const routes = listExecutableAiGatewayModelRoutes(routeInput);
  const activeRoutes = routes.filter((candidate) => !routeDisabledByAdminOverride(candidate, options.modelOpsConfig, input?.modality));
  const route = activeRoutes[0] || null;
  if (!route) {
    if (routes.length > 0 && activeRoutes.length === 0) {
      const providerIds = [...new Set(routes.map((candidate) => candidate.providerId).filter(Boolean))];
      throw new AiGatewayValidationError(
        `AI model route is paused by model ops config: ${canonicalModelId}`,
        'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE',
        {
          canonicalModelId,
          modality: input?.modality || null,
          providerIds,
          routeIds: routes.map((candidate) => channelCandidatesForRoute(candidate, input?.modality)[0]).filter(Boolean),
          nextAction: 'Enable the route binding in model ops config before publishing or testing this route',
        }
      );
    }
    const routesIgnoringPausedProviders = listExecutableAiGatewayModelRoutes({
      ...routeInput,
      disabledProviders: [],
    }).filter((candidate) => !routeDisabledByAdminOverride(candidate, options.modelOpsConfig, input?.modality));
    if (routesIgnoringPausedProviders.length > 0) {
      const providerIds = [...new Set(routesIgnoringPausedProviders.map((candidate) => candidate.providerId).filter(Boolean))];
      throw new AiGatewayValidationError(
        `AI provider route is paused by ops control: ${providerIds.join(', ')}`,
        'AI_GATEWAY_PROVIDER_PAUSED',
        {
          providerIds,
          canonicalModelId,
          modality: input?.modality || null,
        }
      );
    }
    const pending = resolveKnownPendingModelRoute(input, {
      disabledProviders: options.disabledProviders,
    });
    if (pending) {
      throw new AiGatewayValidationError(
        `AI model route is not executable yet: ${canonicalModelId} via ${pending.providerId}`,
        pending.executionStatus === 'adapter_pending'
          ? 'AI_GATEWAY_MODEL_ADAPTER_PENDING'
          : 'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE'
      );
    }
    throw new AiGatewayValidationError(
      `No executable AI Gateway route for model: ${canonicalModelId}`,
      'AI_GATEWAY_MODEL_ROUTE_NOT_FOUND'
    );
  }

  if (options.checkProviderKeys !== false) {
    const keys = await (options.listProviderKeys || listProviderKeys)();
    const readyRoute = sortRoutesByAdminPriority(activeRoutes, options.modelOpsConfig, input?.modality).find((candidate) =>
      routeHasUsableKey(candidate, keys)
    );
    if (readyRoute) {
      return {
        ok: true,
        canonicalModelId,
        route: routeWithAdminOverrides(readyRoute, options.modelOpsConfig, input?.modality),
        checked: true,
      };
    }
    if (activeRoutes.some((candidate) => candidate.platformKeyRequired)) {
      throw new AiGatewayValidationError(
        `No usable platform key for AI provider: ${route.providerId}`,
        'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE'
      );
    }
  }

  return {
    ok: true,
    canonicalModelId,
    route: routeWithAdminOverrides(route, options.modelOpsConfig, input?.modality),
    checked: true,
  };
}
