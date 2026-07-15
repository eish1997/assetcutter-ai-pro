export const AI_GATEWAY_MODEL_ROUTE_EXECUTABLE_RULES = Object.freeze([
  {
    id: 'gemini-gateway',
    modelPattern: /^gemini-/i,
    modalities: Object.freeze(['text', 'image']),
    catalogProviderIds: Object.freeze(['vertex-site', 'gemini-aistudio']),
    gatewayProviderIds: Object.freeze(['vertex-gemini', 'gemini-aistudio']),
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
    id: 'tripo-p1-gateway',
    modelPattern: /^tripo-p1$/i,
    modalities: Object.freeze(['model3d']),
    catalogProviderIds: Object.freeze(['tripo']),
    gatewayProviderIds: Object.freeze(['tripo']),
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
  {
    id: 'tencent-hunyuan-pending',
    modelPattern: /^tencent-hunyuan-/i,
    catalogProviderIds: Object.freeze(['tencent-hunyuan']),
    gatewayProviderIds: Object.freeze(['tencent-hunyuan']),
    gatewayExecutionStatus: 'adapter_pending',
    executionStatus: 'adapter_pending',
  },
]);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function normalizeAiGatewayModelRouteModality(value) {
  const raw = nonEmptyString(value).toLowerCase();
  if (raw === '3d' || raw === 'model_3d' || raw === 'model-3d') return 'model3d';
  if (raw === 'audio') return 'music';
  return raw;
}

function providerMatches(rule, providerId, field) {
  const id = nonEmptyString(providerId);
  if (!id) return true;
  return Array.isArray(rule[field]) && rule[field].includes(id);
}

function modalityMatches(rule, modality) {
  const id = normalizeAiGatewayModelRouteModality(modality);
  if (!id || !Array.isArray(rule.modalities)) return true;
  return rule.modalities.includes(id);
}

function resolveRuntimeRule(rules, input, providerField) {
  const raw = input && typeof input === 'object' ? input : {};
  const canonicalModelId = nonEmptyString(raw.canonicalModelId || raw.registryId || raw.model);
  if (!canonicalModelId) return null;
  for (const rule of rules) {
    if (!rule.modelPattern.test(canonicalModelId)) continue;
    if (!modalityMatches(rule, raw.modality)) continue;
    if (!providerMatches(rule, raw.providerId || raw.provider, providerField)) continue;
    return {
      ruleId: rule.id,
      canonicalModelId,
      providerId: nonEmptyString(raw.providerId || raw.provider) || rule[providerField][0],
      gatewayExecutionStatus: rule.gatewayExecutionStatus,
      executionStatus: rule.executionStatus,
      platformKeyRequired: Boolean(rule.platformKeyRequired),
    };
  }
  return null;
}

export function resolveExecutableAiGatewayModelRoute(input, options = {}) {
  const providerField = options.providerField || 'gatewayProviderIds';
  return resolveRuntimeRule(AI_GATEWAY_MODEL_ROUTE_EXECUTABLE_RULES, input, providerField);
}

export function resolvePendingAiGatewayModelRoute(input, options = {}) {
  const providerField = options.providerField || 'gatewayProviderIds';
  return resolveRuntimeRule(AI_GATEWAY_MODEL_ROUTE_PENDING_RULES, input, providerField);
}

export function resolveCatalogGatewayExecutionStatus(input) {
  const executable = resolveExecutableAiGatewayModelRoute(input, { providerField: 'catalogProviderIds' });
  if (executable) return executable.gatewayExecutionStatus;
  const pending = resolvePendingAiGatewayModelRoute(input, { providerField: 'catalogProviderIds' });
  if (pending) return pending.gatewayExecutionStatus;
  return 'not_gateway_routed';
}
