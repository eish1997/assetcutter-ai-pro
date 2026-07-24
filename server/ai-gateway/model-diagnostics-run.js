import { testAiGatewayModelGeneration } from './model-generation-test.js';
import { testAiGatewayModelRoute } from './model-route-test.js';

const SUPPORTED_LAYERS = new Set(['route', 'generation']);
const DEFAULT_LAYERS = ['route'];
const DEFAULT_MAX_MODELS = 20;
const DEFAULT_MAX_GENERATION_MODELS = 5;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeLayers(input) {
  const raw = Array.isArray(input) ? input : DEFAULT_LAYERS;
  const layers = raw
    .map((item) => nonEmptyString(item).toLowerCase())
    .filter((item, index, arr) => SUPPORTED_LAYERS.has(item) && arr.indexOf(item) === index);
  return layers.length ? layers : DEFAULT_LAYERS;
}

function normalizeModelInput(item) {
  if (typeof item === 'string') {
    const canonicalModelId = nonEmptyString(item);
    return canonicalModelId ? { canonicalModelId } : null;
  }
  if (!item || typeof item !== 'object') return null;
  const canonicalModelId = nonEmptyString(item.canonicalModelId || item.registryId || item.model);
  if (!canonicalModelId) return null;
  return {
    canonicalModelId,
    routeId: nonEmptyString(item.routeId) || undefined,
    registryId: nonEmptyString(item.registryId) || undefined,
    modality: nonEmptyString(item.modality) || undefined,
    providerId: nonEmptyString(item.providerId || item.provider) || undefined,
    executionStatus: nonEmptyString(item.executionStatus) || undefined,
    requiresEndpointMapping: item.requiresEndpointMapping === true,
  };
}

function normalizeDiagnosticsInput(input = {}, options = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const maxModels = Math.max(1, Number(options.maxModels || process.env.AI_GATEWAY_ADMIN_DIAGNOSTICS_MAX_MODELS || DEFAULT_MAX_MODELS));
  const maxGenerationModels = Math.max(
    1,
    Number(options.maxGenerationModels || process.env.AI_GATEWAY_ADMIN_DIAGNOSTICS_MAX_GENERATION_MODELS || DEFAULT_MAX_GENERATION_MODELS)
  );
  const models = (Array.isArray(raw.models) ? raw.models : [])
    .map(normalizeModelInput)
    .filter(Boolean)
    .slice(0, maxModels);
  return {
    layers: normalizeLayers(raw.layers),
    models,
    maxModels,
    maxGenerationModels,
  };
}

function failedLayerResult(model, layer, code, message) {
  return {
    ok: false,
    status: 'failed',
    testLayer: layer === 'generation' ? 'generation_test' : 'route_test',
    createsGenerationTask: false,
    canonicalModelId: model.canonicalModelId,
    providerId: model.providerId || null,
    modality: model.modality || null,
    code,
    message,
    testedAt: new Date().toISOString(),
  };
}

function failedLayerResultFromError(model, layer, code, err, fallbackMessage) {
  const result = failedLayerResult(
    model,
    layer,
    code,
    err instanceof Error ? err.message : String(err || fallbackMessage)
  );
  const details = err?.details && typeof err.details === 'object' ? err.details : {};
  if (Array.isArray(details.missingEndpointFields)) {
    result.missingEndpointFields = details.missingEndpointFields;
  }
  if (Array.isArray(details.routeIds)) {
    result.routeIds = details.routeIds;
  }
  if (Array.isArray(details.providers)) {
    result.providers = details.providers;
  }
  if (Number.isFinite(Number(details.priority))) {
    result.priority = Number(details.priority);
  }
  return result;
}

async function runRouteLayer(model, options) {
  const routeTest = options.routeTest || testAiGatewayModelRoute;
  try {
    return await routeTest(model, options.routeTestOptions || {});
  } catch (err) {
    return failedLayerResultFromError(model, 'route', 'AI_GATEWAY_BATCH_ROUTE_TEST_FAILED', err, 'Route test failed');
  }
}

async function runGenerationLayer(req, model, user, options) {
  const generationTest = options.generationTest || testAiGatewayModelGeneration;
  try {
    return await generationTest(req, model, user, options.generationTestOptions || {});
  } catch (err) {
    return failedLayerResultFromError(model, 'generation', 'AI_GATEWAY_BATCH_GENERATION_TEST_FAILED', err, 'Generation test failed');
  }
}

function summarizeResults(results) {
  const summary = {
    total: results.length,
    route: { tested: 0, passed: 0, failed: 0 },
    generation: { tested: 0, passed: 0, failed: 0, createdJobs: 0 },
  };
  for (const item of results) {
    if (item.route) {
      summary.route.tested += 1;
      if (item.route.status === 'passed') summary.route.passed += 1;
      else summary.route.failed += 1;
    }
    if (item.generation) {
      summary.generation.tested += 1;
      if (item.generation.status === 'passed') summary.generation.passed += 1;
      else summary.generation.failed += 1;
      if (item.generation.createsGenerationTask) summary.generation.createdJobs += 1;
    }
  }
  return summary;
}

export async function runAiGatewayModelDiagnostics(req, input = {}, user = {}, options = {}) {
  const normalized = normalizeDiagnosticsInput(input, options);
  if (!normalized.models.length) {
    return {
      ok: false,
      code: 'AI_GATEWAY_DIAGNOSTICS_MODELS_REQUIRED',
      message: 'At least one canonical model id is required',
      layers: normalized.layers,
      results: [],
      summary: summarizeResults([]),
      generatedAt: new Date().toISOString(),
    };
  }

  let generationCount = 0;
  const results = [];
  for (const model of normalized.models) {
    const item = {
      canonicalModelId: model.canonicalModelId,
      providerId: model.providerId || null,
      modality: model.modality || null,
    };
    if (normalized.layers.includes('route')) {
      item.route = await runRouteLayer(model, options);
    }
    if (normalized.layers.includes('generation')) {
      generationCount += 1;
      if (generationCount > normalized.maxGenerationModels) {
        item.generation = failedLayerResult(
          model,
          'generation',
          'AI_GATEWAY_DIAGNOSTICS_GENERATION_LIMIT_EXCEEDED',
          `Generation diagnostics are limited to ${normalized.maxGenerationModels} models per request`
        );
      } else {
        item.generation = await runGenerationLayer(req, model, user, options);
      }
    }
    results.push(item);
  }

  const summary = summarizeResults(results);
  return {
    ok: summary.route.failed === 0 && summary.generation.failed === 0,
    layers: normalized.layers,
    results,
    summary,
    generatedAt: new Date().toISOString(),
  };
}
