import {
  resolveExecutableAiGatewayModelRoute,
  resolvePendingAiGatewayModelRoute,
} from '../../shared/aiGatewayModelRoutes.js';
import { listProviderKeys } from './provider-key-store.js';
import { openAiCompatibleChannelForProvider, isOpenAiCompatibleAsyncProvider } from './openai-compatible-config.js';
import { listGatewayRouteConfigs } from './route-config-source.js';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function providerKeyUsable(row) {
  if (!row || row.enabled === false) return false;
  if (row.runtime?.coolingDown) return false;
  return Boolean(row.hasSecret || row.hasCredentials || row.secret || Object.keys(row.credentials || {}).length);
}

function normalizeRouteCandidate(row) {
  const raw = row && typeof row === 'object' ? row : {};
  const providerId = nonEmptyString(raw.providerId || raw.provider);
  const modality = nonEmptyString(raw.modality);
  if (!providerId && !modality) return null;
  return {
    routeId: nonEmptyString(raw.routeId),
    providerId,
    modality,
    executionStatus: nonEmptyString(raw.executionStatus),
    requiresEndpointMapping: raw.requiresEndpointMapping === true,
  };
}

function normalizeModelInput(row) {
  const raw = row && typeof row === 'object' ? row : {};
  const canonicalModelId = nonEmptyString(raw.canonicalModelId || raw.registryId || raw.model);
  if (!canonicalModelId) return null;
  const modality = nonEmptyString(raw.modality);
  const routes = Array.isArray(raw.routes)
    ? raw.routes.map(normalizeRouteCandidate).filter(Boolean)
    : [];
  return {
    canonicalModelId,
    modality,
    routes: routes.length ? routes : [{ providerId: nonEmptyString(raw.providerId || raw.provider), modality }],
  };
}

function routeCheckInputs(model) {
  const out = [];
  const seen = new Set();
  for (const route of model.routes) {
    const input = {
      routeId: route.routeId,
      canonicalModelId: model.canonicalModelId,
      modality: route.modality || model.modality,
      provider: route.providerId,
      executionStatus: route.executionStatus,
      requiresEndpointMapping: route.requiresEndpointMapping,
    };
    const key = `${input.canonicalModelId}:${input.modality}:${input.provider}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(input);
  }
  return out;
}

const REQUIRED_ENDPOINT_MAPPING_FIELDS = Object.freeze(['requestPath', 'pollPath', 'statusPath', 'artifactPath']);

function parseEndpointMappingRouteId(routeId) {
  const parts = nonEmptyString(routeId).split(':');
  if (parts.length < 3) return null;
  const modality = parts[parts.length - 1];
  const provider = nonEmptyString(parts[parts.length - 2]);
  const canonicalModelId = parts.slice(0, -2).join(':');
  if (!canonicalModelId || !provider || !modality) return null;
  return { canonicalModelId, provider, modality };
}

function endpointMappingPriority(row) {
  const priority = Number(row?.priority);
  return Number.isFinite(priority) ? Math.floor(priority) : 100;
}

function endpointMappingsForModel(model, modelOpsConfig) {
  const rows = Array.isArray(modelOpsConfig?.endpointMappings) ? modelOpsConfig.endpointMappings : [];
  return rows
    .map((row) => {
      const routeId = nonEmptyString(row?.routeId);
      const parsed = parseEndpointMappingRouteId(routeId);
      if (!parsed) return null;
      if (parsed.canonicalModelId !== model.canonicalModelId) return null;
      if (model.modality && parsed.modality !== model.modality) return null;
      if (!isOpenAiCompatibleAsyncProvider(parsed.provider)) return null;
      return { row, routeId, ...parsed };
    })
    .filter(Boolean);
}

function routeCheckInputsWithEndpointMappings(model, modelOpsConfig) {
  const out = routeCheckInputs(model);
  const seen = new Set(out.map((input) => `${input.canonicalModelId}:${input.modality}:${input.provider}`));
  for (const mapping of endpointMappingsForModel(model, modelOpsConfig)) {
    const input = {
      routeId: mapping.routeId,
      canonicalModelId: model.canonicalModelId,
      modality: mapping.modality,
      provider: mapping.provider,
      executionStatus: 'requires_endpoint_mapping',
      requiresEndpointMapping: true,
      endpointPriority: endpointMappingPriority(mapping.row),
    };
    const key = `${input.canonicalModelId}:${input.modality}:${input.provider}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(input);
  }
  return out;
}

function endpointMappingAmbiguity(model, modelOpsConfig) {
  const enabled = endpointMappingsForModel(model, modelOpsConfig).filter((mapping) => mapping.row?.enabled === true);
  if (enabled.length < 2) return null;
  const sorted = [...enabled].sort((a, b) => endpointMappingPriority(a.row) - endpointMappingPriority(b.row));
  const bestPriority = endpointMappingPriority(sorted[0].row);
  const best = sorted.filter((mapping) => endpointMappingPriority(mapping.row) === bestPriority);
  if (best.length < 2) return null;
  return {
    priority: bestPriority,
    routeIds: best.map((mapping) => mapping.routeId),
    providers: best.map((mapping) => mapping.provider),
  };
}

function endpointMappingForRoute(modelOpsConfig, routeId) {
  const id = nonEmptyString(routeId);
  if (!id) return null;
  const rows = Array.isArray(modelOpsConfig?.endpointMappings) ? modelOpsConfig.endpointMappings : [];
  return rows.find((row) => nonEmptyString(row?.routeId) === id && row?.enabled !== false) || null;
}

function missingEndpointMappingFields(input, modelOpsConfig) {
  if (!input.requiresEndpointMapping && input.executionStatus !== 'requires_endpoint_mapping') return [];
  const mapping = endpointMappingForRoute(modelOpsConfig, input.routeId);
  if (mapping?.enabled !== true) return REQUIRED_ENDPOINT_MAPPING_FIELDS;
  return REQUIRED_ENDPOINT_MAPPING_FIELDS.filter((field) => !nonEmptyString(mapping?.[field]));
}

function mappedEndpointRouteReady(input, modelOpsConfig) {
  if (!input.requiresEndpointMapping && input.executionStatus !== 'requires_endpoint_mapping') return false;
  const mapping = endpointMappingForRoute(modelOpsConfig, input.routeId);
  return mapping?.enabled === true && REQUIRED_ENDPOINT_MAPPING_FIELDS.every((field) => nonEmptyString(mapping?.[field]));
}

function routeRole(input) {
  const modality = nonEmptyString(input?.modality);
  if (modality === 'text') return 'text';
  if (modality === 'image') return 'image';
  return '';
}

function bindingIdsForRouteInput(input) {
  const model = nonEmptyString(input?.canonicalModelId);
  const provider = nonEmptyString(input?.provider);
  const role = routeRole(input);
  if (!model || !provider || !role) return [];
  if (provider === 'vertex-site') return [`${model}:vertex-proxy:${role}`];
  if (provider === 'gemini-aistudio') return [`${model}:gemini-aistudio:${role}`];
  if (provider === 'toapis') return [`${model}:toapis-gemini:${role}`, `${model}:toapis-openai:${role}`];
  const openAiChannel = openAiCompatibleChannelForProvider(provider);
  if (openAiChannel) return [`${model}:${openAiChannel}:${role}`];
  if (provider === 'vectorengine') return [`${model}:vectorengine:${role}`];
  if (provider === 'volcengine-ark') return [`${model}:volcengine-ark:${role}`];
  if (provider === 'volcengine-jimeng') return [`${model}:volcengine-jimeng:${role}`];
  return [];
}

function priorityOverridesByBindingId(modelOpsConfig) {
  const rows = Array.isArray(modelOpsConfig?.bindingOverrides) ? modelOpsConfig.bindingOverrides : [];
  const out = new Map();
  for (const row of rows) {
    const bindingId = nonEmptyString(row?.bindingId);
    const priority = Number(row?.priority);
    if (!bindingId || !Number.isFinite(priority)) continue;
    out.set(bindingId, Math.floor(priority));
  }
  return out;
}

function disabledBindingIds(modelOpsConfig) {
  const rows = Array.isArray(modelOpsConfig?.bindingOverrides) ? modelOpsConfig.bindingOverrides : [];
  const out = new Set();
  for (const row of rows) {
    const bindingId = nonEmptyString(row?.bindingId);
    if (bindingId && row?.enabled === false) out.add(bindingId);
  }
  return out;
}

const FALLBACK_POLICIES = new Set(['none', 'on_error', 'on_rate_limit', 'on_timeout', 'on_provider_degraded', 'cost_optimized', 'quality_first']);

function fallbackOverridesForRouteInput(input, modelOpsConfig) {
  const rows = Array.isArray(modelOpsConfig?.bindingOverrides) ? modelOpsConfig.bindingOverrides : [];
  const ids = bindingIdsForRouteInput(input);
  if (!ids.length || !rows.length) return {};
  for (const bindingId of ids) {
    const row = rows.find((item) => nonEmptyString(item?.bindingId) === bindingId);
    if (!row) continue;
    const fallbackPolicy = nonEmptyString(row.fallbackPolicy);
    const fallbackMaxAttempts = Number(row.fallbackMaxAttempts);
    return {
      ...(FALLBACK_POLICIES.has(fallbackPolicy) ? { fallbackPolicy } : {}),
      ...(Number.isFinite(fallbackMaxAttempts)
        ? { fallbackMaxAttempts: Math.max(1, Math.min(5, Math.floor(fallbackMaxAttempts))) }
        : {}),
    };
  }
  return {};
}

function routeInputDisabledByAdminOverride(input, modelOpsConfig) {
  const disabled = disabledBindingIds(modelOpsConfig);
  if (!disabled.size) return false;
  return bindingIdsForRouteInput(input).some((bindingId) => disabled.has(bindingId));
}

function sortRouteInputsByAdminPriority(inputs, modelOpsConfig) {
  const priorityByBindingId = priorityOverridesByBindingId(modelOpsConfig);
  const hasEndpointPriority = inputs.some((input) => Number.isFinite(Number(input.endpointPriority)));
  if (!priorityByBindingId.size && !hasEndpointPriority) return inputs;
  return [...inputs].sort((a, b) => {
    if (Number.isFinite(Number(a.endpointPriority)) || Number.isFinite(Number(b.endpointPriority))) {
      const ap = Number.isFinite(Number(a.endpointPriority)) ? Number(a.endpointPriority) : Number.POSITIVE_INFINITY;
      const bp = Number.isFinite(Number(b.endpointPriority)) ? Number(b.endpointPriority) : Number.POSITIVE_INFINITY;
      if (ap !== bp) return ap - bp;
    }
    const ap = bindingIdsForRouteInput(a).map((id) => priorityByBindingId.get(id)).find((v) => v != null) ?? Number.POSITIVE_INFINITY;
    const bp = bindingIdsForRouteInput(b).map((id) => priorityByBindingId.get(id)).find((v) => v != null) ?? Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
    return 0;
  });
}

function routeSummary(input, keys, modelOpsConfig) {
  const fallbackOverrides = fallbackOverridesForRouteInput(input, modelOpsConfig);
  if (routeInputDisabledByAdminOverride(input, modelOpsConfig)) {
    return {
      routeId: nonEmptyString(input.routeId) || null,
      providerId: nonEmptyString(input.provider) || null,
      modality: nonEmptyString(input.modality) || null,
      gatewayExecutionStatus: 'not_published',
      executionStatus: 'disabled_by_ops',
      platformKeyRequired: false,
      keyReady: false,
      selectable: false,
      reasonCode: 'route_not_executable',
      ...fallbackOverrides,
    };
  }

  const missingEndpointFields = missingEndpointMappingFields(input, modelOpsConfig);
  if (missingEndpointFields.length) {
    return {
      routeId: nonEmptyString(input.routeId) || null,
      providerId: nonEmptyString(input.provider) || null,
      modality: nonEmptyString(input.modality) || null,
      gatewayExecutionStatus: 'not_published',
      executionStatus: 'requires_endpoint_mapping',
      platformKeyRequired: false,
      keyReady: false,
      selectable: false,
      reasonCode: 'parameter_pending',
      missingEndpointFields,
      priority: Number.isFinite(Number(input.endpointPriority)) ? Number(input.endpointPriority) : undefined,
      ...fallbackOverrides,
    };
  }

  if (mappedEndpointRouteReady(input, modelOpsConfig)) {
    const providerId = nonEmptyString(input.provider) || null;
    const keyReady = keys.some((row) => row.provider === providerId && providerKeyUsable(row));
    return {
      routeId: nonEmptyString(input.routeId) || null,
      providerId,
      modality: nonEmptyString(input.modality) || null,
      gatewayExecutionStatus: 'ready',
      executionStatus: 'platform_ready',
      platformKeyRequired: true,
      keyReady,
      selectable: keyReady,
      reasonCode: keyReady ? 'ready' : 'key_missing',
      missingEndpointFields: [],
      priority: Number.isFinite(Number(input.endpointPriority)) ? Number(input.endpointPriority) : undefined,
      ...fallbackOverrides,
    };
  }

  const executableRoutes = listGatewayRouteConfigs(input, modelOpsConfig).filter(
    (route) =>
      route.enabled !== false &&
      !routeInputDisabledByAdminOverride(
        {
          canonicalModelId: input.canonicalModelId,
          modality: input.modality,
          provider: route.providerId,
        },
        modelOpsConfig
      )
  );
  const executable =
    executableRoutes.find((route) => {
      if (!route.platformKeyRequired) return true;
      return keys.some((row) => row.provider === route.providerId && providerKeyUsable(row));
    }) ||
    executableRoutes[0] ||
    resolveExecutableAiGatewayModelRoute(input);
  if (executable) {
    const keyReady =
      !executable.platformKeyRequired ||
      keys.some((row) => row.provider === executable.providerId && providerKeyUsable(row));
    return {
      routeId: nonEmptyString(input.routeId) || null,
      providerId: executable.providerId,
      modality: nonEmptyString(input.modality) || null,
      gatewayExecutionStatus: executable.gatewayExecutionStatus,
      executionStatus: executable.executionStatus,
      platformKeyRequired: executable.platformKeyRequired,
      keyReady,
      selectable: keyReady,
      reasonCode: keyReady ? 'ready' : 'key_missing',
      ...fallbackOverrides,
    };
  }

  const pending = resolvePendingAiGatewayModelRoute(input);
  if (pending) {
    return {
      routeId: nonEmptyString(input.routeId) || null,
      providerId: pending.providerId,
      modality: nonEmptyString(input.modality) || null,
      gatewayExecutionStatus: pending.gatewayExecutionStatus,
      executionStatus: pending.executionStatus,
      platformKeyRequired: false,
      keyReady: false,
      selectable: false,
      reasonCode: pending.executionStatus === 'adapter_pending' ? 'adapter_pending' : 'route_not_executable',
      ...fallbackOverrides,
    };
  }

  return {
    routeId: nonEmptyString(input.routeId) || null,
    providerId: nonEmptyString(input.provider) || null,
    modality: nonEmptyString(input.modality) || null,
    gatewayExecutionStatus: 'not_published',
    executionStatus: 'route_not_found',
    platformKeyRequired: false,
    keyReady: false,
    selectable: false,
    reasonCode: 'route_not_found',
    ...fallbackOverrides,
  };
}

function summarizeModel(model, keys, modelOpsConfig) {
  const ambiguity = endpointMappingAmbiguity(model, modelOpsConfig);
  const routeSummaries = sortRouteInputsByAdminPriority(routeCheckInputsWithEndpointMappings(model, modelOpsConfig), modelOpsConfig).map((input) =>
    routeSummary(input, keys, modelOpsConfig)
  );
  if (ambiguity) {
    return {
      canonicalModelId: model.canonicalModelId,
      modality: model.modality || routeSummaries[0]?.modality || null,
      status: 'route_ambiguous',
      workspaceSelectable: false,
      reasonCode: 'route_ambiguous',
      reason: `多条 endpoint 映射优先级冲突：${ambiguity.providers.join(' / ')}`,
      routeIds: ambiguity.routeIds,
      providers: ambiguity.providers,
      priority: ambiguity.priority,
      routes: routeSummaries,
    };
  }
  const ready = routeSummaries.find((route) => route.selectable);
  if (ready) {
    return {
      canonicalModelId: model.canonicalModelId,
      modality: model.modality || ready.modality,
      status: 'ready',
      workspaceSelectable: true,
      reasonCode: 'ready',
      reason: '可发布到工作台',
      routes: routeSummaries,
    };
  }

  const keyMissing = routeSummaries.find((route) => route.reasonCode === 'key_missing');
  if (keyMissing) {
    return {
      canonicalModelId: model.canonicalModelId,
      modality: model.modality || keyMissing.modality,
      status: 'key_missing',
      workspaceSelectable: false,
      reasonCode: 'key_missing',
      reason: `缺少可用平台 Key：${keyMissing.providerId}`,
      routes: routeSummaries,
    };
  }

  const pending = routeSummaries.find((route) => route.reasonCode === 'adapter_pending');
  if (pending) {
    return {
      canonicalModelId: model.canonicalModelId,
      modality: model.modality || pending.modality,
      status: 'adapter_pending',
      workspaceSelectable: false,
      reasonCode: 'adapter_pending',
      reason: 'Gateway 后端通道待接',
      routes: routeSummaries,
    };
  }

  const parameterPending = routeSummaries.find((route) => route.reasonCode === 'parameter_pending');
  if (parameterPending) {
    return {
      canonicalModelId: model.canonicalModelId,
      modality: model.modality || parameterPending.modality,
      status: 'parameter_pending',
      workspaceSelectable: false,
      reasonCode: 'parameter_pending',
      reason: '参数或 endpoint 映射待补齐',
      routes: routeSummaries,
    };
  }

  const routeNotExecutable = routeSummaries.find((route) => route.reasonCode === 'route_not_executable');
  if (routeNotExecutable) {
    return {
      canonicalModelId: model.canonicalModelId,
      modality: model.modality || routeNotExecutable.modality,
      status: 'route_not_executable',
      workspaceSelectable: false,
      reasonCode: 'route_not_executable',
      reason: '路线已暂停或不可执行',
      routes: routeSummaries,
    };
  }

  return {
    canonicalModelId: model.canonicalModelId,
    modality: model.modality || routeSummaries[0]?.modality || null,
    status: 'route_not_found',
    workspaceSelectable: false,
    reasonCode: 'route_not_found',
    reason: '没有可执行 Gateway 路由',
    routes: routeSummaries,
  };
}

export async function buildModelAvailabilitySummary(input = {}, options = {}) {
  const models = (Array.isArray(input?.models) ? input.models : [])
    .map(normalizeModelInput)
    .filter(Boolean)
    .slice(0, 500);
  const keys = await (options.listProviderKeys || listProviderKeys)();
  const summaries = models.map((model) => summarizeModel(model, Array.isArray(keys) ? keys : [], options.modelOpsConfig));
  const totals = summaries.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row.workspaceSelectable) acc.ready += 1;
      else if (row.reasonCode === 'key_missing') acc.keyMissing += 1;
      else if (row.reasonCode === 'adapter_pending') acc.adapterPending += 1;
      else if (row.reasonCode === 'parameter_pending') acc.parameterPending += 1;
      else if (row.reasonCode === 'route_ambiguous') acc.routeAmbiguous += 1;
      else acc.routeMissing += 1;
      return acc;
    },
    { total: 0, ready: 0, keyMissing: 0, adapterPending: 0, parameterPending: 0, routeAmbiguous: 0, routeMissing: 0 }
  );
  return {
    generatedAt: new Date().toISOString(),
    totals,
    models: summaries,
  };
}
