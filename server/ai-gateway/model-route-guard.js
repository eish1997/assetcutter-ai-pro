import { AiGatewayValidationError } from './job.js';
import { listProviderKeys } from './provider-key-store.js';
import { resolveRequestedCanonicalModelId } from './model-publication-guard.js';
import {
  listExecutableAiGatewayModelRoutes,
  normalizeAiGatewayProviderId,
  resolveExecutableAiGatewayModelRoute,
  resolvePendingAiGatewayModelRoute,
} from '../../shared/aiGatewayModelRoutes.js';

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
  if (providerId === 'openai-official') return [`${model}:openai-official:${role}`];
  if (providerId === 'tinysnow') return [`${model}:tinysnow-openai:${role}`];
  if (providerId === 'vectorengine') return [`${model}:vectorengine:${role}`];
  if (providerId === 'volcengine-ark') return [`${model}:volcengine-ark:${role}`];
  if (providerId === 'volcengine-jimeng') return [`${model}:volcengine-jimeng:${role}`];
  if (providerId === 'toapis') return [`${model}:toapis-gemini:${role}`, `${model}:toapis-openai:${role}`];
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

export async function validateAiGatewayModelRouteExecutable(input, options = {}) {
  const canonicalModelId = resolveRequestedCanonicalModelId(input);
  if (!canonicalModelId) return { ok: true, canonicalModelId: null, route: null, checked: false };

  const routeInput = {
    canonicalModelId,
    modality: input?.modality,
    provider: normalizeAiGatewayProviderId(input?.provider),
    disabledProviders: options.disabledProviders,
  };
  const routes = listExecutableAiGatewayModelRoutes(routeInput);
  const route = routes[0] || null;
  if (!route) {
    const routesIgnoringPausedProviders = listExecutableAiGatewayModelRoutes({
      ...routeInput,
      disabledProviders: [],
    });
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
    const readyRoute = sortRoutesByAdminPriority(routes, options.modelOpsConfig, input?.modality).find((candidate) =>
      routeHasUsableKey(candidate, keys)
    );
    if (readyRoute) {
      return { ok: true, canonicalModelId, route: readyRoute, checked: true };
    }
    if (routes.some((candidate) => candidate.platformKeyRequired)) {
      throw new AiGatewayValidationError(
        `No usable platform key for AI provider: ${route.providerId}`,
        'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE'
      );
    }
  }

  return { ok: true, canonicalModelId, route, checked: true };
}
