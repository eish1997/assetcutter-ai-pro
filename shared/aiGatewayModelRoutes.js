export const AI_GATEWAY_MODEL_ROUTE_EXECUTABLE_RULES = Object.freeze([
  {
    id: 'gemini-gateway',
    modelPattern: /^gemini-/i,
    modalities: Object.freeze(['text', 'image']),
    catalogProviderIds: Object.freeze(['vertex-site', 'gemini-aistudio']),
    gatewayProviderIds: Object.freeze(['vertex-site', 'gemini-aistudio']),
    gatewayExecutionStatus: 'gateway_ready',
    executionStatus: 'platform_ready',
    platformKeyRequired: false,
  },
  {
    id: 'openai-official-gateway',
    modelPattern: /^(gpt-|dall-e|o1|o3|o4)/i,
    modalities: Object.freeze(['text', 'image']),
    catalogProviderIds: Object.freeze(['openai-official']),
    gatewayProviderIds: Object.freeze(['openai-official']),
    gatewayExecutionStatus: 'gateway_ready',
    executionStatus: 'platform_ready',
    platformKeyRequired: true,
  },
  {
    id: 'toapis-openai-gateway',
    modelPattern: /^(gpt-|dall-e|o1|o3|o4)/i,
    modalities: Object.freeze(['text', 'image']),
    catalogProviderIds: Object.freeze(['toapis']),
    gatewayProviderIds: Object.freeze(['toapis']),
    gatewayExecutionStatus: 'gateway_ready',
    executionStatus: 'platform_ready',
    platformKeyRequired: true,
  },
  {
    id: 'volcengine-ark-text-gateway',
    modelPattern: /^doubao-seed-2-0/i,
    modalities: Object.freeze(['text']),
    catalogProviderIds: Object.freeze(['volcengine-ark']),
    gatewayProviderIds: Object.freeze(['volcengine-ark']),
    gatewayExecutionStatus: 'gateway_ready',
    executionStatus: 'platform_ready',
    platformKeyRequired: true,
  },
  {
    id: 'volcengine-ark-seedream-gateway',
    modelPattern: /^doubao-seedream-5-0/i,
    modalities: Object.freeze(['image']),
    catalogProviderIds: Object.freeze(['volcengine-ark']),
    gatewayProviderIds: Object.freeze(['volcengine-ark']),
    gatewayExecutionStatus: 'gateway_ready',
    executionStatus: 'platform_ready',
    platformKeyRequired: true,
  },
  {
    id: 'volcengine-ark-seedance-gateway',
    modelPattern: /^doubao-seedance-2-0/i,
    modalities: Object.freeze(['video']),
    catalogProviderIds: Object.freeze(['volcengine-ark']),
    gatewayProviderIds: Object.freeze(['volcengine-ark']),
    gatewayExecutionStatus: 'gateway_ready',
    executionStatus: 'platform_ready',
    platformKeyRequired: true,
  },
  {
    id: 'volcengine-ark-seed3d-gateway',
    modelPattern: /^doubao-seed3d-2-0/i,
    modalities: Object.freeze(['model3d']),
    catalogProviderIds: Object.freeze(['volcengine-ark']),
    gatewayProviderIds: Object.freeze(['volcengine-ark']),
    gatewayExecutionStatus: 'gateway_ready',
    executionStatus: 'platform_ready',
    platformKeyRequired: true,
  },
  {
    id: 'jimeng-image-gateway',
    modelPattern: /^jimeng-image-/i,
    modalities: Object.freeze(['image']),
    catalogProviderIds: Object.freeze(['volcengine-jimeng']),
    gatewayProviderIds: Object.freeze(['volcengine-jimeng']),
    gatewayExecutionStatus: 'gateway_ready',
    executionStatus: 'platform_ready',
    platformKeyRequired: true,
  },
  {
    id: 'jimeng-video-gateway',
    modelPattern: /^jimeng-video-/i,
    modalities: Object.freeze(['video']),
    catalogProviderIds: Object.freeze(['volcengine-jimeng']),
    gatewayProviderIds: Object.freeze(['volcengine-jimeng']),
    gatewayExecutionStatus: 'gateway_ready',
    executionStatus: 'platform_ready',
    platformKeyRequired: true,
  },
  {
    id: 'tripo-gateway',
    modelPattern: /^tripo-/i,
    modalities: Object.freeze(['model3d']),
    catalogProviderIds: Object.freeze(['tripo']),
    gatewayProviderIds: Object.freeze(['tripo']),
    gatewayExecutionStatus: 'gateway_ready',
    executionStatus: 'platform_ready',
    platformKeyRequired: true,
  },
  {
    id: 'tencent-hunyuan-3d-gateway',
    modelPattern: /^tencent-hunyuan-3d-/i,
    modalities: Object.freeze(['model3d']),
    catalogProviderIds: Object.freeze(['tencent-hunyuan']),
    gatewayProviderIds: Object.freeze(['tencent-hunyuan']),
    gatewayExecutionStatus: 'gateway_ready',
    executionStatus: 'platform_ready',
    platformKeyRequired: true,
  },
]);

export const AI_GATEWAY_MODEL_ROUTE_PENDING_RULES = Object.freeze([
  {
    id: 'volcengine-ark-pending',
    modelPattern: /^(doubao-|seedream-|seedance-|seed3d-)/i,
    catalogProviderIds: Object.freeze(['volcengine-ark']),
    gatewayProviderIds: Object.freeze(['volcengine-ark']),
    gatewayExecutionStatus: 'adapter_pending',
    executionStatus: 'adapter_pending',
  },
]);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function normalizeAiGatewayProviderId(value) {
  const id = nonEmptyString(value);
  if (id === 'volcengine-ark-openai' || id === 'volcengine-ark-image' || id === 'volcengine-ark-async') {
    return 'volcengine-ark';
  }
  if (id === 'jimeng-visual' || id === 'volcengine-jimeng-visual' || id === 'volcengine-visual') {
    return 'volcengine-jimeng';
  }
  if (id === 'tripo-openapi') return 'tripo';
  if (id === 'tencent-hunyuan-3d' || id === 'hunyuan-3d') return 'tencent-hunyuan';
  if (id === 'ai-worker-proxy' || id === 'vertex-proxy') return 'vertex-site';
  if (id === 'toapis-openai' || id === 'toapis-gemini') return 'toapis';
  if (id === 'vertex-gemini') return 'vertex-site';
  return id;
}

export function normalizeAiGatewayModelRouteModality(value) {
  const raw = nonEmptyString(value).toLowerCase();
  if (raw === '3d' || raw === 'model_3d' || raw === 'model-3d') return 'model3d';
  if (raw === 'audio') return 'music';
  return raw;
}

function disabledProviderSet(options) {
  return new Set(
    Array.isArray(options?.disabledProviders)
      ? options.disabledProviders.map(normalizeAiGatewayProviderId).filter(Boolean)
      : []
  );
}

function firstEnabledProvider(rule, field, disabledProviders) {
  const providers = Array.isArray(rule[field]) ? rule[field] : [];
  return providers.find((provider) => !disabledProviders.has(provider));
}

function providerMatches(rule, providerId, field, disabledProviders) {
  const id = normalizeAiGatewayProviderId(providerId);
  if (!id) return true;
  if (disabledProviders.has(id)) return false;
  return Array.isArray(rule[field]) && rule[field].includes(id);
}

function modalityMatches(rule, modality) {
  const id = normalizeAiGatewayModelRouteModality(modality);
  if (!id || !Array.isArray(rule.modalities)) return true;
  return rule.modalities.includes(id);
}

function resolveRuntimeRule(rules, input, providerField) {
  return listRuntimeRules(rules, input, providerField)[0] || null;
}

function routeFromRule(rule, canonicalModelId, providerId) {
  return {
    ruleId: rule.id,
    canonicalModelId,
    providerId,
    gatewayExecutionStatus: rule.gatewayExecutionStatus,
    executionStatus: rule.executionStatus,
    platformKeyRequired: Boolean(rule.platformKeyRequired),
  };
}

function listRuntimeRules(rules, input, providerField) {
  const raw = input && typeof input === 'object' ? input : {};
  const canonicalModelId = nonEmptyString(raw.canonicalModelId || raw.registryId || raw.model);
  if (!canonicalModelId) return [];
  const disabledProviders = disabledProviderSet(raw);
  const explicitProviderId = normalizeAiGatewayProviderId(raw.providerId || raw.provider);
  const out = [];
  for (const rule of rules) {
    if (!rule.modelPattern.test(canonicalModelId)) continue;
    if (!modalityMatches(rule, raw.modality)) continue;
    if (!providerMatches(rule, explicitProviderId, providerField, disabledProviders)) continue;
    if (explicitProviderId) {
      out.push(routeFromRule(rule, canonicalModelId, explicitProviderId));
      continue;
    }
    const providers = Array.isArray(rule[providerField]) ? rule[providerField] : [];
    for (const provider of providers) {
      const providerId = normalizeAiGatewayProviderId(provider);
      if (!providerId || disabledProviders.has(providerId)) continue;
      out.push(routeFromRule(rule, canonicalModelId, providerId));
    }
  }
  return out;
}

export function resolveExecutableAiGatewayModelRoute(input, options = {}) {
  const providerField = options.providerField || 'gatewayProviderIds';
  return resolveRuntimeRule(AI_GATEWAY_MODEL_ROUTE_EXECUTABLE_RULES, input, providerField);
}

export function listExecutableAiGatewayModelRoutes(input, options = {}) {
  const providerField = options.providerField || 'gatewayProviderIds';
  return listRuntimeRules(AI_GATEWAY_MODEL_ROUTE_EXECUTABLE_RULES, input, providerField);
}

export function resolvePendingAiGatewayModelRoute(input, options = {}) {
  const providerField = options.providerField || 'gatewayProviderIds';
  return resolveRuntimeRule(AI_GATEWAY_MODEL_ROUTE_PENDING_RULES, input, providerField);
}

export function listPendingAiGatewayModelRoutes(input, options = {}) {
  const providerField = options.providerField || 'gatewayProviderIds';
  return listRuntimeRules(AI_GATEWAY_MODEL_ROUTE_PENDING_RULES, input, providerField);
}

export function resolveCatalogGatewayExecutionStatus(input) {
  const executable = resolveExecutableAiGatewayModelRoute(input, { providerField: 'catalogProviderIds' });
  if (executable) return executable.gatewayExecutionStatus;
  const pending = resolvePendingAiGatewayModelRoute(input, { providerField: 'catalogProviderIds' });
  if (pending) return pending.gatewayExecutionStatus;
  return 'not_gateway_routed';
}
