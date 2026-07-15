import { AiGatewayValidationError } from './job.js';
import { listProviderKeys } from './provider-key-store.js';
import { resolveRequestedCanonicalModelId } from './model-publication-guard.js';
import {
  resolveExecutableAiGatewayModelRoute,
  resolvePendingAiGatewayModelRoute,
} from '../../shared/aiGatewayModelRoutes.js';

export function resolveExecutableModelRoute(input) {
  const canonicalModelId = resolveRequestedCanonicalModelId(input);
  if (!canonicalModelId) return null;
  return resolveExecutableAiGatewayModelRoute({
    canonicalModelId,
    modality: input?.modality,
    provider: input?.provider,
  });
}

export function resolveKnownPendingModelRoute(input) {
  const canonicalModelId = resolveRequestedCanonicalModelId(input);
  if (!canonicalModelId) return null;
  return resolvePendingAiGatewayModelRoute({
    canonicalModelId,
    modality: input?.modality,
    provider: input?.provider,
  });
}

function providerKeyUsable(row) {
  if (!row || row.enabled === false) return false;
  if (row.runtime?.coolingDown) return false;
  return Boolean(row.hasSecret || row.hasCredentials || row.secret || Object.keys(row.credentials || {}).length);
}

export async function validateAiGatewayModelRouteExecutable(input, options = {}) {
  const canonicalModelId = resolveRequestedCanonicalModelId(input);
  if (!canonicalModelId) return { ok: true, canonicalModelId: null, route: null, checked: false };

  const route = resolveExecutableModelRoute(input);
  if (!route) {
    const pending = resolveKnownPendingModelRoute(input);
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

  if (route.platformKeyRequired && options.checkProviderKeys !== false) {
    const keys = await (options.listProviderKeys || listProviderKeys)();
    const hasUsableKey = (Array.isArray(keys) ? keys : []).some((row) => row.provider === route.providerId && providerKeyUsable(row));
    if (!hasUsableKey) {
      throw new AiGatewayValidationError(
        `No usable platform key for AI provider: ${route.providerId}`,
        'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE'
      );
    }
  }

  return { ok: true, canonicalModelId, route, checked: true };
}
