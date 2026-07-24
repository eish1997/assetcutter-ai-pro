import { listProviderKeys } from './provider-key-store.js';
import { resolveAiGatewayRouteDecision, publicAiGatewayRouteDecision } from './model-route-guard.js';
import { resolveAiGatewayFailureReason, publicAiGatewayFailureReason } from './failure-reason.js';
import { persistentAiGatewayJobStore } from './persistent-job-store.js';
import { normalizeAiGatewayProviderId } from '../../shared/aiGatewayModelRoutes.js';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function providerKeyUsable(row) {
  if (!row || row.enabled === false) return false;
  if (row.runtime?.coolingDown) return false;
  return Boolean(row.hasSecret || row.hasCredentials || row.secret || Object.keys(row.credentials || {}).length);
}

function publishedStatus(canonicalModelId, modelOpsConfig) {
  const allow = Array.isArray(modelOpsConfig?.publishedCanonicalModelAllowlist)
    ? modelOpsConfig.publishedCanonicalModelAllowlist.map((item) => nonEmptyString(item)).filter(Boolean)
    : null;
  if (!allow) {
    return { published: true, restricted: false, source: 'open_allowlist' };
  }
  const published = allow.includes(canonicalModelId);
  return { published, restricted: true, source: 'allowlist' };
}

function keyStatusForProvider(providerId, keys) {
  const id = normalizeAiGatewayProviderId(providerId);
  const rows = (Array.isArray(keys) ? keys : []).filter(
    (row) => normalizeAiGatewayProviderId(row?.provider) === id
  );
  if (!rows.length) {
    return {
      providerId: id,
      status: 'missing',
      ready: false,
      coolingDown: false,
      disabled: false,
      lastError: null,
      nextAction: 'Add an enabled platform key for this provider',
    };
  }
  const enabled = rows.filter((row) => row.enabled !== false);
  const cooling = enabled.filter((row) => row.runtime?.coolingDown);
  const usable = enabled.filter((row) => providerKeyUsable(row));
  if (usable.length) {
    return {
      providerId: id,
      status: 'ready',
      ready: true,
      coolingDown: false,
      disabled: false,
      lastError: null,
      keyCount: rows.length,
      usableCount: usable.length,
      nextAction: null,
    };
  }
  if (cooling.length) {
    return {
      providerId: id,
      status: 'cooling_down',
      ready: false,
      coolingDown: true,
      disabled: false,
      lastError: cooling[0]?.runtime?.lastErrorMessage || cooling[0]?.lastErrorMessage || null,
      nextAction: 'Wait for cooldown or clear the provider key cooldown',
    };
  }
  if (!enabled.length) {
    return {
      providerId: id,
      status: 'disabled',
      ready: false,
      coolingDown: false,
      disabled: true,
      lastError: rows[0]?.lastErrorMessage || null,
      nextAction: 'Re-enable a provider key for this provider',
    };
  }
  return {
    providerId: id,
    status: 'unavailable',
    ready: false,
    coolingDown: false,
    disabled: false,
    lastError: enabled[0]?.lastErrorMessage || null,
    nextAction: 'Fix or replace the provider key secret/credentials',
  };
}

function failureFromPlan(plan) {
  const metadata = plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  if (metadata.gatewayFailure && typeof metadata.gatewayFailure === 'object') {
    return publicAiGatewayFailureReason(metadata.gatewayFailure);
  }
  return publicAiGatewayFailureReason(
    resolveAiGatewayFailureReason(plan?.job?.error || { message: 'job failed' }, {
      defaultCode: 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED',
    })
  );
}

export function aggregateRecentGatewayFailures(plans, { canonicalModelId, limit = 20 } = {}) {
  const modelId = nonEmptyString(canonicalModelId);
  const rows = (Array.isArray(plans) ? plans : [])
    .filter((plan) => plan?.job?.status === 'failed')
    .filter((plan) => !modelId || nonEmptyString(plan?.job?.model) === modelId)
    .slice(0, Math.max(1, Number(limit) || 20));

  const byStage = new Map();
  const byOwner = new Map();
  const byProvider = new Map();
  const byModel = new Map();
  const recent = [];

  for (const plan of rows) {
    const reason = failureFromPlan(plan) || {
      code: 'AI_GATEWAY_INTERNAL_ERROR',
      stage: 'system',
      owner: 'system',
      retryable: true,
      userMessage: '任务失败',
      adminMessage: 'Unknown failure',
      nextAction: 'Inspect job detail',
    };
    const providerId =
      normalizeAiGatewayProviderId(plan?.route?.providerId || plan?.job?.provider) || 'unknown';
    const model = nonEmptyString(plan?.job?.model) || 'unknown';
    byStage.set(reason.stage, (byStage.get(reason.stage) || 0) + 1);
    byOwner.set(reason.owner, (byOwner.get(reason.owner) || 0) + 1);
    byProvider.set(providerId, (byProvider.get(providerId) || 0) + 1);
    byModel.set(model, (byModel.get(model) || 0) + 1);
    recent.push({
      jobId: plan?.job?.id || null,
      model,
      providerId,
      code: reason.code,
      stage: reason.stage,
      owner: reason.owner,
      message: reason.adminMessage || reason.userMessage,
      nextAction: reason.nextAction,
      at: plan?.job?.finishedAt || plan?.job?.updatedAt || null,
    });
  }

  const toRows = (map) =>
    [...map.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));

  return {
    total: rows.length,
    byStage: toRows(byStage),
    byOwner: toRows(byOwner),
    byProvider: toRows(byProvider),
    byModel: toRows(byModel),
    recent: recent.slice(0, 10),
  };
}

function nextActionsFromDiagnosis({ publication, routeDecision, keyStatuses, recentFailures }) {
  const actions = [];
  if (publication && publication.published === false) {
    actions.push({
      owner: 'admin',
      action: 'publish_model',
      label: 'Publish this model to the workspace allowlist',
    });
  }
  if (routeDecision?.blockingReason) {
    actions.push({
      owner: routeDecision.blockingReason.owner || 'admin',
      action: 'fix_route_block',
      label: routeDecision.blockingReason.nextAction || routeDecision.blockingReason.message,
      code: routeDecision.blockingReason.code,
    });
  }
  for (const key of Array.isArray(keyStatuses) ? keyStatuses : []) {
    if (key.ready) continue;
    actions.push({
      owner: 'admin',
      action: 'fix_provider_key',
      label: key.nextAction || `Fix provider key for ${key.providerId}`,
      providerId: key.providerId,
      status: key.status,
    });
  }
  const topFailure = recentFailures?.byOwner?.[0];
  if (topFailure && actions.length < 3) {
    actions.push({
      owner: topFailure.key,
      action: 'inspect_recent_failures',
      label: `Inspect recent failures owned by ${topFailure.key} (${topFailure.count})`,
    });
  }
  if (!actions.length) {
    actions.push({
      owner: 'admin',
      action: 'run_generation_test',
      label: 'Route looks ready. Run a real Generation Test only if you need upstream/billing proof.',
    });
  }
  return actions.slice(0, 5);
}

/**
 * One-screen diagnosis snapshot for a single model.
 * Does not create generation tasks. Route Check / Generation Test remain separate actions.
 */
export async function buildAiGatewayModelScreenDiagnosis(input = {}, options = {}) {
  const canonicalModelId = nonEmptyString(input.canonicalModelId || input.registryId || input.model);
  const modality = nonEmptyString(input.modality) || null;
  const provider = nonEmptyString(input.providerId || input.provider) || undefined;
  if (!canonicalModelId) {
    return {
      ok: false,
      code: 'AI_GATEWAY_MODEL_ID_REQUIRED',
      message: 'Missing canonical model id',
      generatedAt: new Date().toISOString(),
    };
  }

  const modelOpsConfig = options.modelOpsConfig || {};
  const publication = publishedStatus(canonicalModelId, modelOpsConfig);
  const decision = await resolveAiGatewayRouteDecision(
    {
      canonicalModelId,
      modality,
      provider,
      routeId: nonEmptyString(input.routeId) || undefined,
    },
    {
      listProviderKeys: options.listProviderKeys || listProviderKeys,
      checkProviderKeys: options.checkProviderKeys !== false,
      disabledProviders: options.disabledProviders,
      modelOpsConfig,
    }
  );
  const routeDecision = publicAiGatewayRouteDecision(decision);
  const keys = await (options.listProviderKeys || listProviderKeys)();
  const providerIds = [
    ...new Set(
      [
        routeDecision?.selectedRoute?.providerId,
        ...(Array.isArray(routeDecision?.candidates) ? routeDecision.candidates.map((row) => row.providerId) : []),
        provider,
      ]
        .map((id) => normalizeAiGatewayProviderId(id))
        .filter(Boolean)
    ),
  ];
  const keyStatuses = providerIds.map((providerId) => keyStatusForProvider(providerId, keys));

  let recentPlans = [];
  const store = options.store || persistentAiGatewayJobStore;
  if (store?.list) {
    try {
      recentPlans = await Promise.resolve(
        store.list({
          model: canonicalModelId,
          status: 'failed',
          limit: options.recentFailureLimit || 40,
        })
      );
    } catch {
      recentPlans = [];
    }
  }
  const recentFailures = aggregateRecentGatewayFailures(recentPlans, {
    canonicalModelId,
    limit: options.recentFailureLimit || 40,
  });

  const nextActions = nextActionsFromDiagnosis({
    publication,
    routeDecision,
    keyStatuses,
    recentFailures,
  });

  const ready =
    publication.published !== false &&
    routeDecision?.ok === true &&
    keyStatuses.some((row) => row.ready) &&
    !(routeDecision?.selectedRoute && keyStatuses.find((row) => row.providerId === routeDecision.selectedRoute.providerId)?.ready === false);

  return {
    ok: ready,
    status: ready ? 'ready' : 'blocked',
    checkKind: 'diagnosis',
    mode: 'screen_diagnosis',
    createsGenerationTask: false,
    testLayer: 'screen_diagnosis',
    message: ready
      ? 'Screen diagnosis: Key/Route look ready. This is read-only and does not mean Generation Test passed.'
      : 'Screen diagnosis: blocked. Fix Key/Route/publication before running Generation Test.',
    canonicalModelId,
    modality,
    providerId: routeDecision?.selectedRoute?.providerId || provider || null,
    model: {
      canonicalModelId,
      modality,
      published: publication.published !== false,
      publication,
      gatewayStatus: routeDecision?.selectedRoute
        ? 'route_selected'
        : routeDecision?.blockingReason?.code || 'route_blocked',
      executionStatus: decision?.executableRoute?.executionStatus || decision?.runtimeRoute?.executionStatus || null,
    },
    routeDecision,
    keyStatuses: keyStatuses.map((row) => ({ ...row, checkKind: 'key' })),
    recentFailures,
    nextActions,
    layers: {
      keyCheck: {
        checkKind: 'key',
        label: 'Key Check',
        createsGenerationTask: false,
        status: keyStatuses.every((row) => row.ready) ? 'passed' : keyStatuses.some((row) => row.ready) ? 'partial' : 'failed',
      },
      routeCheck: {
        checkKind: 'route',
        label: 'Route Check',
        createsGenerationTask: false,
        status: routeDecision?.ok ? 'passed' : 'failed',
        note: 'Does not create a generation task or charge credits',
      },
      generationTest: {
        checkKind: 'generation',
        label: 'Generation Test',
        createsGenerationTask: true,
        status: 'not_run',
        note: 'Creates a real AI job and may charge credits. Run only after Key/Route look ready.',
      },
    },
    generatedAt: new Date().toISOString(),
  };
}
