import { AiGatewayValidationError } from './job.js';
import { resolveAiGatewayRouteDecision, validateAiGatewayModelRouteExecutable } from './model-route-guard.js';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeRouteTestInput(input) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    routeId: nonEmptyString(raw.routeId),
    canonicalModelId: nonEmptyString(raw.canonicalModelId || raw.registryId || raw.model),
    modality: nonEmptyString(raw.modality),
    provider: nonEmptyString(raw.providerId || raw.provider),
    executionStatus: nonEmptyString(raw.executionStatus),
    requiresEndpointMapping: raw.requiresEndpointMapping === true,
  };
}

const REQUIRED_ENDPOINT_MAPPING_FIELDS = Object.freeze(['requestPath', 'pollPath', 'statusPath', 'artifactPath']);

function endpointMappingForRoute(modelOpsConfig, routeId) {
  const id = nonEmptyString(routeId);
  if (!id) return null;
  const rows = Array.isArray(modelOpsConfig?.endpointMappings) ? modelOpsConfig.endpointMappings : [];
  return rows.find((row) => nonEmptyString(row?.routeId) === id && row?.enabled !== false) || null;
}

function endpointMappingPriority(row) {
  const priority = Number(row?.priority);
  return Number.isFinite(priority) ? Math.floor(priority) : 100;
}

function parseEndpointMappingRouteId(routeId) {
  const parts = nonEmptyString(routeId).split(':');
  if (parts.length < 3) return null;
  return {
    modality: parts[parts.length - 1],
    provider: parts[parts.length - 2],
    canonicalModelId: parts.slice(0, -2).join(':'),
  };
}

function endpointMappingMatches(modelOpsConfig, input) {
  const rows = Array.isArray(modelOpsConfig?.endpointMappings) ? modelOpsConfig.endpointMappings : [];
  return rows.filter((row) => {
    if (row?.enabled !== true) return false;
    const parsed = parseEndpointMappingRouteId(row?.routeId);
    return parsed?.canonicalModelId === input.canonicalModelId && parsed?.modality === input.modality;
  });
}

function endpointMappingForRouteTestInput(modelOpsConfig, input) {
  if (input.routeId) return endpointMappingForRoute(modelOpsConfig, input.routeId);
  if (input.provider) return endpointMappingForRoute(modelOpsConfig, `${input.canonicalModelId}:${input.provider}:${input.modality}`);
  const matches = endpointMappingMatches(modelOpsConfig, input);
  if (matches.length <= 1) return matches[0] || null;
  const sorted = [...matches].sort((a, b) => endpointMappingPriority(a) - endpointMappingPriority(b));
  const bestPriority = endpointMappingPriority(sorted[0]);
  const best = sorted.filter((row) => endpointMappingPriority(row) === bestPriority);
  return best.length === 1 ? best[0] : null;
}

function missingEndpointMappingFields(input, modelOpsConfig) {
  if (!input.requiresEndpointMapping && input.executionStatus !== 'requires_endpoint_mapping') return [];
  const mapping = endpointMappingForRouteTestInput(modelOpsConfig, input);
  if (!mapping && !input.routeId && !input.provider && endpointMappingMatches(modelOpsConfig, input).length > 1) return [];
  if (mapping?.enabled !== true) return REQUIRED_ENDPOINT_MAPPING_FIELDS;
  return REQUIRED_ENDPOINT_MAPPING_FIELDS.filter((field) => !nonEmptyString(mapping?.[field]));
}

function failedResult(input, code, message, extra = {}) {
  return {
    ok: false,
    status: 'failed',
    checkKind: 'route',
    mode: 'route_guard',
    testLayer: 'route_test',
    createsGenerationTask: false,
    canonicalModelId: input.canonicalModelId || null,
    providerId: input.provider || null,
    modality: input.modality || null,
    code,
    message,
    route: null,
    nextAction: extra.nextAction || null,
    testedAt: new Date().toISOString(),
    ...extra,
  };
}

export async function testAiGatewayModelRoute(input = {}, options = {}) {
  const normalized = normalizeRouteTestInput(input);
  if (!normalized.canonicalModelId) {
    return failedResult(normalized, 'AI_GATEWAY_MODEL_ID_REQUIRED', 'Missing canonical model id');
  }
  const missingEndpointFields = missingEndpointMappingFields(normalized, options.modelOpsConfig);
  if (missingEndpointFields.length) {
    return failedResult(
      normalized,
      'AI_GATEWAY_MODEL_PARAMETER_PENDING',
      'Model route still needs parameter or endpoint mapping before it can be tested',
      {
        missingEndpointFields,
        nextAction: `Fill endpoint mapping fields: ${missingEndpointFields.join(', ')}`,
      }
    );
  }

  const decision = await resolveAiGatewayRouteDecision(normalized, {
    listProviderKeys: options.listProviderKeys,
    checkProviderKeys: options.checkProviderKeys,
    modelOpsConfig: options.modelOpsConfig,
    disabledProviders: options.disabledProviders,
  });
  try {
    const result = await validateAiGatewayModelRouteExecutable(normalized, {
      listProviderKeys: options.listProviderKeys,
      checkProviderKeys: options.checkProviderKeys,
      modelOpsConfig: options.modelOpsConfig,
      disabledProviders: options.disabledProviders,
    });
    return {
      ok: true,
      status: 'passed',
      checkKind: 'route',
      mode: 'route_guard',
      canonicalModelId: result.canonicalModelId || normalized.canonicalModelId,
      providerId: result.route?.providerId || normalized.provider || null,
      modality: normalized.modality || null,
      code: 'AI_GATEWAY_MODEL_ROUTE_READY',
      message: 'Route Check passed: route and platform key look ready. This does not mean generation works and does not create a job.',
      testLayer: 'route_test',
      createsGenerationTask: false,
      nextAction: 'Run a minimal Generation Test only when you need to verify upstream output and billing behavior.',
      route: result.route || null,
      routeDecision: result.routeDecision || decision,
      testedAt: new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof AiGatewayValidationError || err?.name === 'AiGatewayValidationError') {
      return failedResult(normalized, err.code || 'AI_GATEWAY_MODEL_ROUTE_TEST_FAILED', err.message, {
        ...(err.details || {}),
        routeDecision: decision,
      });
    }
    throw err;
  }
}
