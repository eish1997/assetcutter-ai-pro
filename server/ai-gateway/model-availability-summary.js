import {
  listExecutableAiGatewayModelRoutes,
  resolveExecutableAiGatewayModelRoute,
  resolvePendingAiGatewayModelRoute,
} from '../../shared/aiGatewayModelRoutes.js';
import { listProviderKeys } from './provider-key-store.js';

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
  if (provider === 'openai-official') return [`${model}:openai-official:${role}`];
  if (provider === 'tinysnow') return [`${model}:tinysnow-openai:${role}`];
  if (provider === 'vectorengine') return [`${model}:vectorengine:${role}`];
  if (provider === 'volcengine-ark') return [`${model}:volcengine-ark:${role}`];
  if (provider === 'volcengine-jimeng') return [`${model}:volcengine-jimeng:${role}`];
  if (provider === 'toapis') return [`${model}:toapis-gemini:${role}`, `${model}:toapis-openai:${role}`];
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

function sortRouteInputsByAdminPriority(inputs, modelOpsConfig) {
  const priorityByBindingId = priorityOverridesByBindingId(modelOpsConfig);
  if (!priorityByBindingId.size) return inputs;
  return [...inputs].sort((a, b) => {
    const ap = bindingIdsForRouteInput(a).map((id) => priorityByBindingId.get(id)).find((v) => v != null) ?? Number.POSITIVE_INFINITY;
    const bp = bindingIdsForRouteInput(b).map((id) => priorityByBindingId.get(id)).find((v) => v != null) ?? Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
    return 0;
  });
}

function routeSummary(input, keys) {
  if (input.requiresEndpointMapping || input.executionStatus === 'requires_endpoint_mapping') {
    return {
      providerId: nonEmptyString(input.provider) || null,
      modality: nonEmptyString(input.modality) || null,
      gatewayExecutionStatus: 'not_gateway_routed',
      executionStatus: 'requires_endpoint_mapping',
      platformKeyRequired: false,
      keyReady: false,
      selectable: false,
      reasonCode: 'parameter_pending',
    };
  }

  const executableRoutes = listExecutableAiGatewayModelRoutes(input);
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
      providerId: executable.providerId,
      modality: nonEmptyString(input.modality) || null,
      gatewayExecutionStatus: executable.gatewayExecutionStatus,
      executionStatus: executable.executionStatus,
      platformKeyRequired: executable.platformKeyRequired,
      keyReady,
      selectable: keyReady,
      reasonCode: keyReady ? 'ready' : 'key_missing',
    };
  }

  const pending = resolvePendingAiGatewayModelRoute(input);
  if (pending) {
    return {
      providerId: pending.providerId,
      modality: nonEmptyString(input.modality) || null,
      gatewayExecutionStatus: pending.gatewayExecutionStatus,
      executionStatus: pending.executionStatus,
      platformKeyRequired: false,
      keyReady: false,
      selectable: false,
      reasonCode: pending.executionStatus === 'adapter_pending' ? 'adapter_pending' : 'route_not_executable',
    };
  }

  return {
    providerId: nonEmptyString(input.provider) || null,
    modality: nonEmptyString(input.modality) || null,
    gatewayExecutionStatus: 'not_gateway_routed',
    executionStatus: 'route_not_found',
    platformKeyRequired: false,
    keyReady: false,
    selectable: false,
    reasonCode: 'route_not_found',
  };
}

function summarizeModel(model, keys, modelOpsConfig) {
  const routeSummaries = sortRouteInputsByAdminPriority(routeCheckInputs(model), modelOpsConfig).map((input) =>
    routeSummary(input, keys)
  );
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
      else acc.routeMissing += 1;
      return acc;
    },
    { total: 0, ready: 0, keyMissing: 0, adapterPending: 0, parameterPending: 0, routeMissing: 0 }
  );
  return {
    generatedAt: new Date().toISOString(),
    totals,
    models: summaries,
  };
}
