import { AiGatewayValidationError } from './job.js';
import { listProviderKeys } from './provider-key-store.js';
import { resolveRequestedCanonicalModelId } from './model-publication-guard.js';
import {
  listExecutableAiGatewayModelRoutes,
  normalizeAiGatewayProviderId,
  resolveExecutableAiGatewayModelRoute,
  resolvePendingAiGatewayModelRoute,
} from '../../shared/aiGatewayModelRoutes.js';
import { openAiCompatibleChannelForProvider, isOpenAiCompatibleAsyncProvider } from './openai-compatible-config.js';
import { enrichSelectedRouteWithRuntimeDefaults } from './provider-router.js';
import { resolveDispatchPolicyFromOptions, selectRouteWithDispatchPolicy } from './route-dispatch.js';

const REQUIRED_ENDPOINT_MAPPING_FIELDS = Object.freeze(['requestPath', 'pollPath', 'statusPath', 'artifactPath']);

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
      if (!isOpenAiCompatibleAsyncProvider(parsed.providerId)) return null;
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
  if (!isOpenAiCompatibleAsyncProvider(providerId)) return null;
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
    gatewayExecutionStatus: 'ready',
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

function candidateRouteId(route, modality) {
  return (
    nonEmptyString(route?.routeId) ||
    channelCandidatesForRoute(route, modality)[0] ||
    `${nonEmptyString(route?.canonicalModelId)}:${normalizeAiGatewayProviderId(route?.providerId)}:${String(modality || '').trim()}`
  );
}

function candidatePriority(route, modelOpsConfig, modality) {
  const priorityByBindingId = priorityOverridesByBindingId(modelOpsConfig);
  const override = routePriority(route, priorityByBindingId, modality);
  if (Number.isFinite(override) && override !== Number.POSITIVE_INFINITY) return override;
  const raw = Number(route?.priority);
  return Number.isFinite(raw) ? Math.floor(raw) : 100;
}

function selectedRouteSummary(route, modality, modelOpsConfig, selectionReason = null) {
  if (!route) return undefined;
  const summary = {
    routeId: candidateRouteId(route, modality),
    providerId: normalizeAiGatewayProviderId(route.providerId),
    adapterId: nonEmptyString(route.adapterId) || undefined,
    workerId: nonEmptyString(route.workerId) || undefined,
    upstreamModelId: nonEmptyString(route.upstreamModelId) || undefined,
    priority: candidatePriority(route, modelOpsConfig, modality),
    fallbackPolicy: nonEmptyString(route.fallbackPolicy) || 'on_error',
    ...(selectionReason ? { selectionReason } : {}),
  };
  // Decision is the single source of truth: carry runtime adapter/worker so plan never re-selects.
  return enrichSelectedRouteWithRuntimeDefaults(summary, {
    modality,
    capability: modality ? `${modality}.generate` : undefined,
    provider: summary.providerId,
    model: route.canonicalModelId || undefined,
  });
}

function decisionCandidate(route, modality, modelOpsConfig, status, reasonCode) {
  return {
    routeId: candidateRouteId(route, modality),
    providerId: normalizeAiGatewayProviderId(route?.providerId),
    status,
    reasonCode,
    priority: candidatePriority(route, modelOpsConfig, modality),
  };
}

function blockingOwnerForCode(code) {
  if (code === 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE') return 'admin';
  if (code === 'AI_GATEWAY_PROVIDER_PAUSED' || code === 'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE') return 'admin';
  if (code === 'AI_GATEWAY_MODEL_ADAPTER_PENDING' || code === 'AI_GATEWAY_MODEL_PARAMETER_PENDING') return 'developer';
  if (code === 'AI_GATEWAY_MODEL_ROUTE_AMBIGUOUS') return 'admin';
  return 'system';
}

function blockingNextActionForCode(code, details = {}) {
  if (code === 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE') return 'Add or re-enable a usable platform key for the selected provider';
  if (code === 'AI_GATEWAY_PROVIDER_PAUSED') return 'Resume the paused provider in ops control, then retry route check';
  if (code === 'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE') {
    return details.nextAction || 'Enable the route binding in model ops config before publishing or testing this route';
  }
  if (code === 'AI_GATEWAY_MODEL_ADAPTER_PENDING') return 'Finish adapter wiring for this model/provider before publishing';
  if (code === 'AI_GATEWAY_MODEL_PARAMETER_PENDING') {
    const missing = Array.isArray(details.missingEndpointFields) ? details.missingEndpointFields.join(', ') : '';
    return missing ? `Fill endpoint mapping fields: ${missing}` : 'Complete endpoint mapping before testing this route';
  }
  if (code === 'AI_GATEWAY_MODEL_ROUTE_AMBIGUOUS') return 'Set a unique endpoint-mapping priority or pin an explicit provider';
  if (code === 'AI_GATEWAY_MODEL_ROUTE_NOT_FOUND') return 'Publish an executable model route or choose a supported model/provider';
  return 'Inspect route candidates and fix the first blocking reason';
}

export function publicAiGatewayRouteDecision(decision) {
  if (!decision || typeof decision !== 'object') return null;
  const blocking = decision.blockingReason && typeof decision.blockingReason === 'object' ? decision.blockingReason : null;
  return {
    ok: decision.ok === true,
    canonicalModelId: nonEmptyString(decision.canonicalModelId) || '',
    modality: nonEmptyString(decision.modality) || null,
    selectedRoute: decision.selectedRoute || undefined,
    candidates: Array.isArray(decision.candidates) ? decision.candidates : [],
    blockingReason: blocking
      ? {
          code: nonEmptyString(blocking.code) || 'AI_GATEWAY_ROUTE_BLOCKED',
          message: nonEmptyString(blocking.message) || 'AI Gateway route blocked',
          owner: nonEmptyString(blocking.owner) || 'system',
          nextAction: nonEmptyString(blocking.nextAction) || blockingNextActionForCode(blocking.code, blocking.details),
        }
      : undefined,
  };
}

function blockedDecision({ canonicalModelId, modality, code, message, details = {}, candidates = [] }) {
  return {
    ok: false,
    canonicalModelId,
    modality: modality || null,
    selectedRoute: undefined,
    candidates,
    checked: true,
    blockingReason: {
      code,
      message,
      owner: blockingOwnerForCode(code),
      nextAction: blockingNextActionForCode(code, details),
      details,
    },
  };
}

function readyDecision({ canonicalModelId, modality, route, modelOpsConfig, candidates, runtimeRoute = null, selectionReason = null }) {
  const executable = routeWithAdminOverrides(route, modelOpsConfig, modality);
  const reason =
    selectionReason ||
    {
      strategy: 'single_ready',
      code: 'AI_GATEWAY_DISPATCH_SINGLE',
      message: `Only one ready route: ${normalizeAiGatewayProviderId(executable?.providerId)}`,
      auditedAt: new Date().toISOString(),
    };
  return {
    ok: true,
    canonicalModelId,
    modality: modality || null,
    selectedRoute: selectedRouteSummary(executable, modality, modelOpsConfig, reason),
    candidates,
    checked: true,
    executableRoute: executable,
    // Only ops-mapped async routes may override createJob plan routes.
    ...(runtimeRoute ? { runtimeRoute } : {}),
  };
}

export async function resolveAiGatewayRouteDecision(input, options = {}) {
  const modality = String(input?.modality || '').trim() || null;
  const canonicalModelId = resolveRequestedCanonicalModelId(input);
  if (!canonicalModelId) {
    return {
      ok: true,
      canonicalModelId: '',
      modality,
      selectedRoute: undefined,
      candidates: [],
      checked: false,
    };
  }

  let mappedAsyncRoute = null;
  try {
    mappedAsyncRoute = mappedAsyncRouteFromOps(input, canonicalModelId, options.modelOpsConfig, options);
  } catch (err) {
    if (err instanceof AiGatewayValidationError || err?.name === 'AiGatewayValidationError') {
      const details = err.details && typeof err.details === 'object' ? err.details : {};
      const status =
        err.code === 'AI_GATEWAY_MODEL_PARAMETER_PENDING'
          ? 'mapping_incomplete'
          : err.code === 'AI_GATEWAY_PROVIDER_PAUSED'
            ? 'paused'
            : err.code === 'AI_GATEWAY_MODEL_ROUTE_AMBIGUOUS'
              ? 'paused'
              : 'not_published';
      const candidates = Array.isArray(details.routeIds)
        ? details.routeIds.map((routeId, index) => ({
            routeId,
            providerId: Array.isArray(details.providers) ? normalizeAiGatewayProviderId(details.providers[index]) : null,
            status,
            reasonCode: err.code,
            priority: Number.isFinite(Number(details.priority)) ? Number(details.priority) : 100,
          }))
        : details.routeId
          ? [
              {
                routeId: details.routeId,
                providerId: normalizeAiGatewayProviderId(input?.provider) || null,
                status,
                reasonCode: err.code,
                priority: 100,
              },
            ]
          : [];
      return blockedDecision({
        canonicalModelId,
        modality,
        code: err.code || 'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE',
        message: err.message,
        details,
        candidates,
      });
    }
    throw err;
  }

  if (mappedAsyncRoute) {
    const keys =
      options.checkProviderKeys === false ? null : await (options.listProviderKeys || listProviderKeys)();
    const ready = options.checkProviderKeys === false || routeHasUsableKey(mappedAsyncRoute, keys);
    const candidate = decisionCandidate(
      mappedAsyncRoute,
      modality,
      options.modelOpsConfig,
      ready ? 'ready' : 'key_unavailable',
      ready ? 'AI_GATEWAY_MODEL_ROUTE_READY' : 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE'
    );
    if (!ready) {
      return blockedDecision({
        canonicalModelId,
        modality,
        code: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE',
        message: `No usable platform key for AI provider: ${mappedAsyncRoute.providerId}`,
        candidates: [candidate],
      });
    }
    return readyDecision({
      canonicalModelId,
      modality,
      route: mappedAsyncRoute,
      modelOpsConfig: options.modelOpsConfig,
      candidates: [candidate],
      runtimeRoute: mappedAsyncRoute,
    });
  }

  const routeInput = {
    canonicalModelId,
    modality: input?.modality,
    provider: normalizeAiGatewayProviderId(input?.provider),
    disabledProviders: options.disabledProviders,
  };
  const disabledProviderSet = new Set(
    (Array.isArray(options.disabledProviders) ? options.disabledProviders : []).map(normalizeAiGatewayProviderId)
  );
  const routes = listExecutableAiGatewayModelRoutes(routeInput);
  const routesIgnoringPausedProviders = listExecutableAiGatewayModelRoutes({
    ...routeInput,
    disabledProviders: [],
  });
  const activeRoutes = routes.filter(
    (candidate) => !routeDisabledByAdminOverride(candidate, options.modelOpsConfig, modality)
  );
  const keys = options.checkProviderKeys === false ? null : await (options.listProviderKeys || listProviderKeys)();
  const candidates = [];

  for (const candidate of routesIgnoringPausedProviders) {
    const providerId = normalizeAiGatewayProviderId(candidate.providerId);
    if (disabledProviderSet.has(providerId)) {
      candidates.push(
        decisionCandidate(candidate, modality, options.modelOpsConfig, 'paused', 'AI_GATEWAY_PROVIDER_PAUSED')
      );
      continue;
    }
    if (routeDisabledByAdminOverride(candidate, options.modelOpsConfig, modality)) {
      candidates.push(
        decisionCandidate(
          candidate,
          modality,
          options.modelOpsConfig,
          'paused',
          'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE'
        )
      );
      continue;
    }
    if (options.checkProviderKeys !== false && candidate.platformKeyRequired && !routeHasUsableKey(candidate, keys)) {
      candidates.push(
        decisionCandidate(
          candidate,
          modality,
          options.modelOpsConfig,
          'key_unavailable',
          'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE'
        )
      );
      continue;
    }
    candidates.push(
      decisionCandidate(candidate, modality, options.modelOpsConfig, 'ready', 'AI_GATEWAY_MODEL_ROUTE_READY')
    );
  }

  const pending = resolveKnownPendingModelRoute(input, {
    disabledProviders: options.disabledProviders,
  });
  if (pending) {
    candidates.push(
      decisionCandidate(
        pending,
        modality,
        options.modelOpsConfig,
        pending.executionStatus === 'adapter_pending' ? 'adapter_pending' : 'not_published',
        pending.executionStatus === 'adapter_pending'
          ? 'AI_GATEWAY_MODEL_ADAPTER_PENDING'
          : 'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE'
      )
    );
  }

  candidates.sort((a, b) => a.priority - b.priority || String(a.routeId).localeCompare(String(b.routeId)));

  if (!activeRoutes.length) {
    if (routes.length > 0) {
      const providerIds = [...new Set(routes.map((candidate) => candidate.providerId).filter(Boolean))];
      return blockedDecision({
        canonicalModelId,
        modality,
        code: 'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE',
        message: `AI model route is paused by model ops config: ${canonicalModelId}`,
        details: {
          canonicalModelId,
          modality,
          providerIds,
          routeIds: routes.map((candidate) => channelCandidatesForRoute(candidate, modality)[0]).filter(Boolean),
          nextAction: 'Enable the route binding in model ops config before publishing or testing this route',
        },
        candidates,
      });
    }
    const unpausedIgnoringProviders = routesIgnoringPausedProviders.filter(
      (candidate) => !routeDisabledByAdminOverride(candidate, options.modelOpsConfig, modality)
    );
    if (unpausedIgnoringProviders.length > 0) {
      const providerIds = [...new Set(unpausedIgnoringProviders.map((candidate) => candidate.providerId).filter(Boolean))];
      return blockedDecision({
        canonicalModelId,
        modality,
        code: 'AI_GATEWAY_PROVIDER_PAUSED',
        message: `AI provider route is paused by ops control: ${providerIds.join(', ')}`,
        details: { providerIds, canonicalModelId, modality },
        candidates,
      });
    }
    if (pending) {
      const code =
        pending.executionStatus === 'adapter_pending'
          ? 'AI_GATEWAY_MODEL_ADAPTER_PENDING'
          : 'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE';
      return blockedDecision({
        canonicalModelId,
        modality,
        code,
        message: `AI model route is not executable yet: ${canonicalModelId} via ${pending.providerId}`,
        candidates,
      });
    }
    return blockedDecision({
      canonicalModelId,
      modality,
      code: 'AI_GATEWAY_MODEL_ROUTE_NOT_FOUND',
      message: `No executable AI Gateway route for model: ${canonicalModelId}`,
      candidates,
    });
  }

  if (options.checkProviderKeys !== false) {
    const readyRoutes = sortRoutesByAdminPriority(activeRoutes, options.modelOpsConfig, modality).filter((candidate) =>
      routeHasUsableKey(candidate, keys)
    );
    if (readyRoutes.length) {
      const policy = resolveDispatchPolicyFromOptions(options);
      const dispatch = selectRouteWithDispatchPolicy(readyRoutes, {
        canonicalModelId,
        modality,
        keys,
        correlationId: nonEmptyString(input?.correlationId) || nonEmptyString(input?.id),
      }, policy);
      return readyDecision({
        canonicalModelId,
        modality,
        route: dispatch.selected || readyRoutes[0],
        modelOpsConfig: options.modelOpsConfig,
        candidates,
        selectionReason: dispatch.selectionReason,
      });
    }
    if (activeRoutes.some((candidate) => candidate.platformKeyRequired)) {
      return blockedDecision({
        canonicalModelId,
        modality,
        code: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE',
        message: `No usable platform key for AI provider: ${activeRoutes[0].providerId}`,
        candidates,
      });
    }
  }

  {
    const ordered = sortRoutesByAdminPriority(activeRoutes, options.modelOpsConfig, modality);
    const policy = resolveDispatchPolicyFromOptions(options);
    const dispatch = selectRouteWithDispatchPolicy(ordered, {
      canonicalModelId,
      modality,
      keys,
      correlationId: nonEmptyString(input?.correlationId) || nonEmptyString(input?.id),
    }, policy);
    return readyDecision({
      canonicalModelId,
      modality,
      route: dispatch.selected || ordered[0] || activeRoutes[0],
      modelOpsConfig: options.modelOpsConfig,
      candidates,
      selectionReason: dispatch.selectionReason,
    });
  }
}

export async function validateAiGatewayModelRouteExecutable(input, options = {}) {
  const decision = await resolveAiGatewayRouteDecision(input, options);
  if (!decision.checked) {
    return {
      ok: true,
      canonicalModelId: decision.canonicalModelId || null,
      route: null,
      checked: false,
      routeDecision: publicAiGatewayRouteDecision(decision),
    };
  }
  if (!decision.ok) {
    const details =
      decision.blockingReason?.details && typeof decision.blockingReason.details === 'object'
        ? decision.blockingReason.details
        : {};
    throw new AiGatewayValidationError(
      decision.blockingReason?.message || 'AI Gateway route blocked',
      decision.blockingReason?.code || 'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE',
      details
    );
  }
  return {
    ok: true,
    canonicalModelId: decision.canonicalModelId,
    route: decision.executableRoute,
    ...(decision.runtimeRoute ? { runtimeRoute: decision.runtimeRoute } : {}),
    checked: true,
    routeDecision: publicAiGatewayRouteDecision(decision),
  };
}
