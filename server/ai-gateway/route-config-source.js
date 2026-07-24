/**
 * A1: single source for Gateway executable route candidates.
 * Persisted `modelOpsConfig.gatewayRouteConfigs` wins when present for a model;
 * otherwise seeds from `shared/aiGatewayModelRoutes.js` (read-only default table).
 */
import {
  listExecutableAiGatewayModelRoutes,
  normalizeAiGatewayProviderId,
} from '../../shared/aiGatewayModelRoutes.js';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeModality(value) {
  return nonEmptyString(value);
}

export function gatewayRouteConfigKey(canonicalModelId, providerId, modality) {
  const model = nonEmptyString(canonicalModelId);
  const provider = normalizeAiGatewayProviderId(providerId);
  const mod = normalizeModality(modality);
  if (!model || !provider) return '';
  return mod ? `${model}:${provider}:${mod}` : `${model}:${provider}`;
}

/**
 * Normalize a persisted gatewayRouteConfigs row into the executable route shape
 * consumed by resolveAiGatewayRouteDecision.
 */
export function materializeGatewayRouteConfigRow(row) {
  const canonicalModelId = nonEmptyString(row?.canonicalModelId);
  const providerId = normalizeAiGatewayProviderId(row?.providerId);
  if (!canonicalModelId || !providerId) return null;
  const modality = normalizeModality(row?.modality) || undefined;
  const priority = Number(row?.priority);
  const upstreamModelId =
    nonEmptyString(row?.upstreamModelId) || nonEmptyString(row?.providerModelId) || undefined;
  return {
    ruleId: nonEmptyString(row?.ruleId) || 'gateway-route-config',
    canonicalModelId,
    providerId,
    modality,
    gatewayExecutionStatus: nonEmptyString(row?.gatewayExecutionStatus) || 'ready',
    executionStatus: nonEmptyString(row?.executionStatus) || 'platform_ready',
    platformKeyRequired: row?.platformKeyRequired === undefined ? true : row.platformKeyRequired !== false,
    enabled: row?.enabled === false ? false : true,
    priority: Number.isFinite(priority) ? Math.floor(priority) : undefined,
    upstreamModelId,
    adapterId: nonEmptyString(row?.adapterId) || undefined,
    workerId: nonEmptyString(row?.workerId) || undefined,
    source: 'gateway_route_config',
  };
}

function seedRoutes(input) {
  return listExecutableAiGatewayModelRoutes(input).map((route) => ({
    ...route,
    source: 'seed_executable_rules',
    enabled: true,
  }));
}

function overlayMatchesInput(row, input) {
  const canonicalModelId = nonEmptyString(input?.canonicalModelId || input?.registryId || input?.model);
  if (!canonicalModelId) return false;
  if (nonEmptyString(row?.canonicalModelId) !== canonicalModelId) return false;
  const modality = normalizeModality(input?.modality);
  const rowModality = normalizeModality(row?.modality);
  if (modality && rowModality && modality !== rowModality) return false;
  const explicitProvider = normalizeAiGatewayProviderId(input?.providerId || input?.provider);
  if (explicitProvider && normalizeAiGatewayProviderId(row?.providerId) !== explicitProvider) return false;
  const disabled = new Set(
    (Array.isArray(input?.disabledProviders) ? input.disabledProviders : []).map(normalizeAiGatewayProviderId)
  );
  if (disabled.has(normalizeAiGatewayProviderId(row?.providerId))) return false;
  return true;
}

/**
 * Authority chain for candidates:
 * 1. Seed from AI_GATEWAY_MODEL_ROUTE_EXECUTABLE_RULES (read-only default).
 * 2. Overlay / append matching `gatewayRouteConfigs` by route key
 *    (enabled / priority / upstreamModelId / new fixture routes).
 */
export function listGatewayRouteConfigs(input = {}, modelOpsConfig = {}) {
  const overlays = (Array.isArray(modelOpsConfig?.gatewayRouteConfigs) ? modelOpsConfig.gatewayRouteConfigs : [])
    .map(materializeGatewayRouteConfigRow)
    .filter(Boolean);
  const matchingOverlays = overlays.filter((row) => overlayMatchesInput(row, input));
  const seed = seedRoutes(input);

  if (!matchingOverlays.length) return seed;

  const byKey = new Map();
  for (const route of seed) {
    const key = gatewayRouteConfigKey(route.canonicalModelId, route.providerId, input?.modality || route.modality);
    if (key) byKey.set(key, route);
  }
  for (const overlay of matchingOverlays) {
    const key = gatewayRouteConfigKey(
      overlay.canonicalModelId,
      overlay.providerId,
      overlay.modality || input?.modality
    );
    if (!key) continue;
    const base = byKey.get(key) || {};
    byKey.set(key, {
      ...base,
      ...overlay,
      ruleId: overlay.ruleId && overlay.ruleId !== 'gateway-route-config' ? overlay.ruleId : base.ruleId || overlay.ruleId,
      canonicalModelId: overlay.canonicalModelId,
      providerId: overlay.providerId,
      gatewayExecutionStatus: overlay.gatewayExecutionStatus || base.gatewayExecutionStatus || 'ready',
      executionStatus: overlay.executionStatus || base.executionStatus || 'platform_ready',
      platformKeyRequired:
        overlay.platformKeyRequired === undefined
          ? base.platformKeyRequired !== false
          : overlay.platformKeyRequired !== false,
      source: base.source ? 'seed_with_gateway_route_overlay' : 'gateway_route_config',
    });
  }
  return [...byKey.values()];
}

export function resolveGatewayRouteConfig(input = {}, modelOpsConfig = {}) {
  return listGatewayRouteConfigs(input, modelOpsConfig)[0] || null;
}

export function isGatewayRouteConfigDisabled(route) {
  return Boolean(route && route.enabled === false);
}
