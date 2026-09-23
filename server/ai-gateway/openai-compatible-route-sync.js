/**
 * R4.1 / R5.1: When ops saves openAiCompatibleProviders, upsert:
 * - text/image gatewayRouteConfigs (sync OpenAI-compatible adapters)
 * - video endpointMappings + gatewayRouteConfigs (asyncCapable aggregators)
 */
import { listExecutableAiGatewayModelRoutes } from '../../shared/aiGatewayModelRoutes.js';
import { gatewayRouteConfigKey } from './route-config-source.js';

export const OPENAI_COMPATIBLE_AUTO_SYNC_RULE_ID = 'openai-compatible-auto-sync';
export const OPENAI_COMPATIBLE_ASYNC_AUTO_SYNC_RULE_ID = 'openai-compatible-async-auto-sync';

export const DEFAULT_OPENAI_COMPATIBLE_VIDEO_ENDPOINT = Object.freeze({
  method: 'POST',
  requestPath: '/v1/video/generations',
  pollPath: '/v1/video/generations/{id}',
  statusPath: 'status',
  artifactPath: 'output.url',
  taskIdPath: 'id',
});

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function inferTextOrImageModalities(canonicalModelId) {
  const id = nonEmptyString(canonicalModelId);
  if (!id) return [];
  const fromSeed = [
    ...new Set(
      listExecutableAiGatewayModelRoutes({ canonicalModelId: id })
        .map((row) => nonEmptyString(row?.modality))
        .filter((mod) => mod === 'text' || mod === 'image')
    ),
  ];
  if (fromSeed.length) return fromSeed;

  const lower = id.toLowerCase();
  if (/(video|model3d|tripo|hunyuan|suno|music|jimeng-video)/i.test(lower)) return [];
  if (/image|dall-e|gpt-image|seedream|flux|imagen/i.test(lower)) return ['image'];
  return ['text'];
}

function isVideoCanonicalModel(canonicalModelId) {
  const id = nonEmptyString(canonicalModelId);
  if (!id) return false;
  const seedVideo = listExecutableAiGatewayModelRoutes({ canonicalModelId: id }).some(
    (row) => nonEmptyString(row?.modality) === 'video'
  );
  if (seedVideo) return true;
  const lower = id.toLowerCase();
  // Dedicated Jimeng / Tripo / music stay on specialty adapters — skip OpenAI-async templates.
  if (/jimeng-video|tripo|hunyuan|suno|music/i.test(lower)) return false;
  return /video/i.test(lower);
}

function resolveCanonicalModelIds(modelOpsConfig, options = {}) {
  if (Array.isArray(options.canonicalModelIds) && options.canonicalModelIds.length) {
    return [...new Set(options.canonicalModelIds.map(nonEmptyString).filter(Boolean))];
  }
  const published = modelOpsConfig?.publishedCanonicalModelAllowlist;
  if (Array.isArray(published)) {
    return [...new Set(published.map(nonEmptyString).filter(Boolean))];
  }
  return [];
}

function endpointMappingRouteId(canonicalModelId, providerId, modality) {
  return `${canonicalModelId}:${providerId}:${modality}`;
}

/**
 * @param {Record<string, unknown>} modelOpsConfig
 * @param {{ force?: boolean, canonicalModelIds?: string[] }} [options]
 * @returns {Record<string, unknown>}
 */
export function upsertOpenAiCompatibleGatewayRoutes(modelOpsConfig, options = {}) {
  const raw = modelOpsConfig && typeof modelOpsConfig === 'object' ? modelOpsConfig : {};
  const providers = Array.isArray(raw.openAiCompatibleProviders) ? raw.openAiCompatibleProviders : [];
  const canonicalModelIds = resolveCanonicalModelIds(raw, options);
  if (!providers.length || !canonicalModelIds.length) {
    return raw;
  }

  const force = options.force === true;
  const byKey = new Map();
  const existing = Array.isArray(raw.gatewayRouteConfigs) ? raw.gatewayRouteConfigs : [];
  for (const row of existing) {
    const key = gatewayRouteConfigKey(row?.canonicalModelId, row?.providerId, row?.modality);
    if (key) byKey.set(key, { ...row });
  }

  let changed = false;
  for (const provider of providers) {
    const providerId = nonEmptyString(provider?.providerId);
    if (!providerId) continue;
    const priorityRaw = Number(provider?.priority);
    const priority = Number.isFinite(priorityRaw) ? Math.floor(priorityRaw) : 50;
    const mapping =
      provider?.modelMapping && typeof provider.modelMapping === 'object' && !Array.isArray(provider.modelMapping)
        ? provider.modelMapping
        : {};

    for (const canonicalModelId of canonicalModelIds) {
      for (const modality of inferTextOrImageModalities(canonicalModelId)) {
        const key = gatewayRouteConfigKey(canonicalModelId, providerId, modality);
        if (!key) continue;
        const upstream =
          nonEmptyString(mapping[canonicalModelId]) ||
          nonEmptyString(mapping[`${canonicalModelId}:${modality}`]) ||
          '';
        const next = {
          canonicalModelId,
          providerId,
          modality,
          enabled: true,
          priority,
          gatewayExecutionStatus: 'ready',
          executionStatus: 'platform_ready',
          platformKeyRequired: true,
          ruleId: OPENAI_COMPATIBLE_AUTO_SYNC_RULE_ID,
          ...(upstream ? { upstreamModelId: upstream, providerModelId: upstream } : {}),
        };
        const prev = byKey.get(key);
        if (prev) {
          const prevRule = nonEmptyString(prev.ruleId);
          const isAuto = prevRule === OPENAI_COMPATIBLE_AUTO_SYNC_RULE_ID;
          if (!force && !isAuto) {
            // Keep manual / Admin / seed-overlay rows unless force sync.
            continue;
          }
          byKey.set(key, { ...prev, ...next });
          changed = true;
        } else {
          byKey.set(key, next);
          changed = true;
        }
      }
    }
  }

  if (!changed && existing.length === byKey.size) return raw;
  const gatewayRouteConfigs = [...byKey.values()].sort((a, b) =>
    gatewayRouteConfigKey(a.canonicalModelId, a.providerId, a.modality).localeCompare(
      gatewayRouteConfigKey(b.canonicalModelId, b.providerId, b.modality)
    )
  );
  return {
    ...raw,
    gatewayRouteConfigs,
  };
}

/**
 * R5.1: asyncCapable providers → video endpointMappings + gatewayRouteConfigs.
 * @param {Record<string, unknown>} modelOpsConfig
 * @param {{ force?: boolean, canonicalModelIds?: string[] }} [options]
 */
export function upsertOpenAiCompatibleAsyncVideoRoutes(modelOpsConfig, options = {}) {
  const raw = modelOpsConfig && typeof modelOpsConfig === 'object' ? modelOpsConfig : {};
  const providers = (Array.isArray(raw.openAiCompatibleProviders) ? raw.openAiCompatibleProviders : []).filter(
    (row) => row?.asyncCapable === true && nonEmptyString(row?.providerId)
  );
  const videoModels = resolveCanonicalModelIds(raw, options).filter(isVideoCanonicalModel);
  if (!providers.length || !videoModels.length) {
    return raw;
  }

  const force = options.force === true;
  const routeByKey = new Map();
  const existingRoutes = Array.isArray(raw.gatewayRouteConfigs) ? raw.gatewayRouteConfigs : [];
  for (const row of existingRoutes) {
    const key = gatewayRouteConfigKey(row?.canonicalModelId, row?.providerId, row?.modality);
    if (key) routeByKey.set(key, { ...row });
  }

  const mappingById = new Map();
  const existingMappings = Array.isArray(raw.endpointMappings) ? raw.endpointMappings : [];
  for (const row of existingMappings) {
    const routeId = nonEmptyString(row?.routeId);
    if (routeId) mappingById.set(routeId, { ...row });
  }

  let changed = false;
  for (const provider of providers) {
    const providerId = nonEmptyString(provider.providerId);
    const priorityRaw = Number(provider?.priority);
    const priority = Number.isFinite(priorityRaw) ? Math.floor(priorityRaw) : 50;
    const mapping =
      provider?.modelMapping && typeof provider.modelMapping === 'object' && !Array.isArray(provider.modelMapping)
        ? provider.modelMapping
        : {};
    const asyncEndpoints =
      provider?.asyncEndpoints && typeof provider.asyncEndpoints === 'object' ? provider.asyncEndpoints : {};

    for (const canonicalModelId of videoModels) {
      const modality = 'video';
      const routeId = endpointMappingRouteId(canonicalModelId, providerId, modality);
      const routeKey = gatewayRouteConfigKey(canonicalModelId, providerId, modality);
      const upstream =
        nonEmptyString(mapping[canonicalModelId]) ||
        nonEmptyString(mapping[`${canonicalModelId}:${modality}`]) ||
        '';

      const nextMapping = {
        routeId,
        method: nonEmptyString(asyncEndpoints.method).toUpperCase() === 'GET' ? 'GET' : 'POST',
        requestPath: nonEmptyString(asyncEndpoints.requestPath) || DEFAULT_OPENAI_COMPATIBLE_VIDEO_ENDPOINT.requestPath,
        pollPath: nonEmptyString(asyncEndpoints.pollPath) || DEFAULT_OPENAI_COMPATIBLE_VIDEO_ENDPOINT.pollPath,
        statusPath: nonEmptyString(asyncEndpoints.statusPath) || DEFAULT_OPENAI_COMPATIBLE_VIDEO_ENDPOINT.statusPath,
        artifactPath: nonEmptyString(asyncEndpoints.artifactPath) || DEFAULT_OPENAI_COMPATIBLE_VIDEO_ENDPOINT.artifactPath,
        taskIdPath: nonEmptyString(asyncEndpoints.taskIdPath) || DEFAULT_OPENAI_COMPATIBLE_VIDEO_ENDPOINT.taskIdPath,
        enabled: true,
        priority,
        ...(upstream ? { upstreamOverride: upstream } : {}),
        ruleId: OPENAI_COMPATIBLE_ASYNC_AUTO_SYNC_RULE_ID,
      };

      const prevMapping = mappingById.get(routeId);
      if (prevMapping) {
        const prevRule = nonEmptyString(prevMapping.ruleId);
        const isAuto = prevRule === OPENAI_COMPATIBLE_ASYNC_AUTO_SYNC_RULE_ID;
        if (force || isAuto) {
          mappingById.set(routeId, { ...prevMapping, ...nextMapping });
          changed = true;
        }
      } else {
        mappingById.set(routeId, nextMapping);
        changed = true;
      }

      const nextRoute = {
        canonicalModelId,
        providerId,
        modality,
        enabled: true,
        priority,
        gatewayExecutionStatus: 'ready',
        executionStatus: 'platform_ready',
        platformKeyRequired: true,
        adapterId: 'openai-compatible-async',
        workerId: 'video-worker',
        ruleId: OPENAI_COMPATIBLE_ASYNC_AUTO_SYNC_RULE_ID,
        ...(upstream ? { upstreamModelId: upstream, providerModelId: upstream } : {}),
      };
      const prevRoute = routeByKey.get(routeKey);
      if (prevRoute) {
        const prevRule = nonEmptyString(prevRoute.ruleId);
        const isAuto = prevRule === OPENAI_COMPATIBLE_ASYNC_AUTO_SYNC_RULE_ID;
        if (force || isAuto) {
          routeByKey.set(routeKey, { ...prevRoute, ...nextRoute });
          changed = true;
        }
      } else {
        routeByKey.set(routeKey, nextRoute);
        changed = true;
      }
    }
  }

  if (!changed) return raw;

  const gatewayRouteConfigs = [...routeByKey.values()].sort((a, b) =>
    gatewayRouteConfigKey(a.canonicalModelId, a.providerId, a.modality).localeCompare(
      gatewayRouteConfigKey(b.canonicalModelId, b.providerId, b.modality)
    )
  );
  const endpointMappings = [...mappingById.values()].sort((a, b) =>
    String(a.routeId || '').localeCompare(String(b.routeId || ''))
  );

  return {
    ...raw,
    gatewayRouteConfigs,
    endpointMappings,
  };
}

/** Run text/image then async video sync. */
export function upsertAllOpenAiCompatibleOpsRoutes(modelOpsConfig, options = {}) {
  const afterSync = upsertOpenAiCompatibleGatewayRoutes(modelOpsConfig, options);
  return upsertOpenAiCompatibleAsyncVideoRoutes(afterSync, options);
}
