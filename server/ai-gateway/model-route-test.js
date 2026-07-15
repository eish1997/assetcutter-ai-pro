import { AiGatewayValidationError } from './job.js';
import { validateAiGatewayModelRouteExecutable } from './model-route-guard.js';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeRouteTestInput(input) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    canonicalModelId: nonEmptyString(raw.canonicalModelId || raw.registryId || raw.model),
    modality: nonEmptyString(raw.modality),
    provider: nonEmptyString(raw.providerId || raw.provider),
    executionStatus: nonEmptyString(raw.executionStatus),
    requiresEndpointMapping: raw.requiresEndpointMapping === true,
  };
}

function failedResult(input, code, message, extra = {}) {
  return {
    ok: false,
    status: 'failed',
    mode: 'route_guard',
    canonicalModelId: input.canonicalModelId || null,
    providerId: input.provider || null,
    modality: input.modality || null,
    code,
    message,
    route: null,
    testedAt: new Date().toISOString(),
    ...extra,
  };
}

export async function testAiGatewayModelRoute(input = {}, options = {}) {
  const normalized = normalizeRouteTestInput(input);
  if (!normalized.canonicalModelId) {
    return failedResult(normalized, 'AI_GATEWAY_MODEL_ID_REQUIRED', 'Missing canonical model id');
  }
  if (normalized.requiresEndpointMapping || normalized.executionStatus === 'requires_endpoint_mapping') {
    return failedResult(
      normalized,
      'AI_GATEWAY_MODEL_PARAMETER_PENDING',
      'Model route still needs parameter or endpoint mapping before it can be tested'
    );
  }

  try {
    const result = await validateAiGatewayModelRouteExecutable(normalized, {
      listProviderKeys: options.listProviderKeys,
      checkProviderKeys: options.checkProviderKeys,
    });
    return {
      ok: true,
      status: 'passed',
      mode: 'route_guard',
      canonicalModelId: result.canonicalModelId || normalized.canonicalModelId,
      providerId: result.route?.providerId || normalized.provider || null,
      modality: normalized.modality || null,
      code: 'AI_GATEWAY_MODEL_ROUTE_READY',
      message: 'Route and platform key are ready. This test does not create a generation task.',
      route: result.route || null,
      testedAt: new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof AiGatewayValidationError || err?.name === 'AiGatewayValidationError') {
      return failedResult(normalized, err.code || 'AI_GATEWAY_MODEL_ROUTE_TEST_FAILED', err.message);
    }
    throw err;
  }
}
