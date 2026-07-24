#!/usr/bin/env node

import {
  PROVIDER_CATALOG,
  listCanonicalModels,
  listModelRoutes,
  listProviderModels,
} from '../services/modelRegistry/index.ts';
import { DEFAULT_AI_PROVIDER_ROUTES } from '../server/ai-gateway/provider-router.js';
import { AI_GATEWAY_WORKERS } from '../server/ai-gateway/workers/registry.js';
import {
  normalizeAiGatewayProviderId,
  normalizeCatalogRouteCandidateStatus,
} from '../shared/aiGatewayModelRoutes.js';
import { listGatewayRouteConfigs } from '../server/ai-gateway/route-config-source.js';

const DIAGNOSTIC_MODALITIES = new Set(['text', 'image']);

function fail(message, details = {}) {
  return { message, details };
}

function label(row) {
  return row?.id || row?.canonicalModelId || row?.routeId || row?.providerModelId || JSON.stringify(row);
}

function hasAuthFields(provider) {
  return (provider.authSchemes || []).some((scheme) => Array.isArray(scheme.fields) && scheme.fields.length > 0);
}

function routeKey(route) {
  return `${route.providerId}:${route.modality}`;
}

const violations = [];
const providerById = new Map();
const canonicalById = new Map(listCanonicalModels().map((row) => [row.canonicalModelId, row]));
const runtimeRouteByProviderModality = new Map();
for (const route of DEFAULT_AI_PROVIDER_ROUTES) {
  for (const modality of route.modalities || []) {
    runtimeRouteByProviderModality.set(routeKey({ providerId: route.providerId, modality }), route);
  }
}
const workerById = new Map(AI_GATEWAY_WORKERS.map((worker) => [worker.id, worker]));

for (const provider of PROVIDER_CATALOG) {
  if (providerById.has(provider.id)) {
    violations.push(fail(`Duplicate provider id: ${provider.id}`));
  }
  providerById.set(provider.id, provider);
  if (!provider.displayName || !provider.shortName) {
    violations.push(fail(`Provider ${provider.id} must define displayName and shortName`));
  }
  if (!Array.isArray(provider.supportedModalities) || provider.supportedModalities.length === 0) {
    violations.push(fail(`Provider ${provider.id} must declare supportedModalities`));
  }
  if (provider.keyPoolSupported && !hasAuthFields(provider)) {
    violations.push(fail(`Provider ${provider.id} supports key pool but has no auth fields`));
  }
  if (provider.capabilityStatus?.modelCatalogReady && listProviderModels(provider.id).length === 0) {
    violations.push(fail(`Provider ${provider.id} is modelCatalogReady but has no provider model catalog rows`));
  }
}

for (const model of listProviderModels()) {
  const provider = providerById.get(model.providerId);
  if (!provider) {
    violations.push(fail(`Provider model ${label(model)} references unknown provider ${model.providerId}`));
    continue;
  }
  if (!provider.supportedModalities.includes(model.modality)) {
    violations.push(
      fail(`Provider model ${label(model)} modality ${model.modality} is not supported by provider ${provider.id}`)
    );
  }
  if ((model.status === 'verified' || model.lifecycle === 'active') && !model.registryId) {
    violations.push(fail(`Active provider model ${label(model)} must map to a registryId`));
  }
}

for (const route of listModelRoutes()) {
  const provider = providerById.get(route.providerId);
  if (!provider) {
    violations.push(fail(`Route ${route.routeId} references unknown provider ${route.providerId}`));
    continue;
  }
  if (!provider.supportedModalities.includes(route.modality)) {
    violations.push(fail(`Route ${route.routeId} modality ${route.modality} is not supported by provider ${route.providerId}`));
  }
  if (!canonicalById.has(route.canonicalModelId)) {
    violations.push(fail(`Route ${route.routeId} references unknown canonical model ${route.canonicalModelId}`));
  }
  const providerModel = listProviderModels(route.providerId).find(
    (row) =>
      row.providerModelId === route.providerModelId ||
      row.registryId === route.canonicalModelId ||
      row.registryId === route.providerModelId
  );
  if (!providerModel) {
    violations.push(
      fail(`Route ${route.routeId} references provider model ${route.providerModelId}, but no provider model catalog row matches`)
    );
  }

  const catalogStatus = normalizeCatalogRouteCandidateStatus(route.gatewayExecutionStatus);
  const executableCatalogRoute =
    route.enabled &&
    catalogStatus === 'ready' &&
    (route.executionStatus === 'platform_ready' || route.executionStatus === 'byok_ready');
  if (!executableCatalogRoute) continue;

  // A1: catalog ready ⇒ decision source (gatewayRouteConfigs overlay + seed) can explain the route.
  const executableRoutes = listGatewayRouteConfigs({
    canonicalModelId: route.canonicalModelId,
    providerId: route.providerId,
    modality: route.modality,
  });
  const executable = executableRoutes.find(
    (item) =>
      normalizeAiGatewayProviderId(item.providerId) === normalizeAiGatewayProviderId(route.providerId) &&
      item.enabled !== false
  );
  if (!executable) {
    violations.push(
      fail(
        `Gateway-ready route ${route.routeId} is not explainable by listGatewayRouteConfigs (seed + gatewayRouteConfigs)`
      )
    );
    continue;
  }
  if (executable.platformKeyRequired && (!provider.keyPoolSupported || !hasAuthFields(provider))) {
    violations.push(fail(`Gateway-ready route ${route.routeId} requires platform key, but provider ${provider.id} has no key-pool auth fields`));
  }

  const runtimeRoute = runtimeRouteByProviderModality.get(routeKey(route));
  if (!runtimeRoute) {
    violations.push(fail(`Gateway-ready route ${route.routeId} has no runtime provider route for ${route.providerId}/${route.modality}`));
    continue;
  }
  const worker = workerById.get(runtimeRoute.workerId);
  if (!worker) {
    violations.push(fail(`Runtime route ${runtimeRoute.providerId}/${runtimeRoute.modality} references unknown worker ${runtimeRoute.workerId}`));
    continue;
  }
  if (worker.status !== 'active') {
    violations.push(fail(`Runtime route ${runtimeRoute.providerId}/${runtimeRoute.modality} worker ${worker.id} is not active`));
  }
  if (!worker.modalities.includes(route.modality)) {
    violations.push(fail(`Worker ${worker.id} does not support modality ${route.modality} for route ${route.routeId}`));
  }
  if (!worker.adapters.includes(runtimeRoute.adapterId)) {
    violations.push(fail(`Worker ${worker.id} does not support adapter ${runtimeRoute.adapterId} for route ${route.routeId}`));
  }
  if (DIAGNOSTIC_MODALITIES.has(route.modality) && !['text-worker', 'image-worker'].includes(runtimeRoute.workerId)) {
    violations.push(fail(`Text/image route ${route.routeId} is not backed by a diagnostics-supported worker`));
  }
}

if (violations.length) {
  console.error('Provider plug contract violations found:');
  for (const violation of violations) {
    console.error(`- ${violation.message}`);
  }
  console.error('');
  console.error('A supplier plug must connect Provider Catalog, Provider Model Catalog, Canonical Model, Route, runtime worker/adapter, and diagnostics.');
  process.exit(1);
}

console.log('Provider plug contract guard passed.');
