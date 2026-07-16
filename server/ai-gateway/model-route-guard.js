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
  return (Array.isArray(keys) ? keys : []).some((row) => row.provider === route.providerId && providerKeyUsable(row));
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
    const readyRoute = routes.find((candidate) => routeHasUsableKey(candidate, keys));
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
