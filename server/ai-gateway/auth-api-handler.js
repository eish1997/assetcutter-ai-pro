import { evaluateAiGatewayCreditsGate } from './credits-gate.js';
import { AiGatewayValidationError, cancelAiGatewayWorkerExecution, createAiGatewayJobPlan } from './index.js';
import { applyAiJobStatusPatch } from './job.js';
import { persistentAiGatewayJobStore } from './persistent-job-store.js';
import { AiGatewayRouteError } from './provider-router.js';
import { settleAiGatewayJobCredits, settlementMetadataPatch } from './settlement.js';
import { startAiGatewayJobExecution } from './executor.js';
import { buildAiGatewayOpsSummary } from './observability.js';
import { readAiGatewayOpsControlConfig } from './ops-control.js';
import { readModelOpsConfig } from './model-ops-config-store.js';
import { validateAiGatewayModelPublication } from './model-publication-guard.js';
import { validateAiGatewayModelRouteExecutable } from './model-route-guard.js';
import { aiGatewayTransientPostgresBody, isTransientPostgresError } from './postgres-transient-retry.js';
import { isAiGatewayExecutionEnabled } from './health.js';
import { buildJobObservabilityCard, errorSummary, publicAiJobSummary, routeSummary } from './job-public-summary.js';
import { getAuthBuildSha, getCachedProxyBuildSha } from './runtime-build-sha.js';
import { attachFailureReasonToErrorBody } from './failure-reason.js';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const CANCELLABLE_STATUSES = new Set(['created', 'queued', 'running']);
const RETRYABLE_STATUSES = new Set(['failed', 'cancelled']);

function clampListLimit(value) {
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(Number(value) || DEFAULT_LIST_LIMIT)));
}

function shouldAwaitAuthAiGatewayExecution(options = {}) {
  if (typeof options.awaitExecution === 'boolean') return options.awaitExecution;
  const raw = String(process.env.AI_GATEWAY_CREATE_AWAIT_EXECUTION || '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  return String(process.env.NODE_ENV || '').toLowerCase() === 'test';
}

function startAuthAiGatewayExecutionInBackground(plan, executionOptions) {
  void startAiGatewayJobExecution(plan, executionOptions).catch((error) => {
    console.error('[ai-gateway] background execution failed:', error instanceof Error ? error.message : String(error));
  });
}

function runtimeBuildShaForResponse() {
  return {
    authBuildSha: getAuthBuildSha(),
    proxyBuildSha: getCachedProxyBuildSha(),
  };
}

export function publicAuthAiJobSummary(plan) {
  return publicAiJobSummary(plan, runtimeBuildShaForResponse());
}

export function publicAuthAiJobDetail(plan) {
  const runtime = runtimeBuildShaForResponse();
  const summary = publicAuthAiJobSummary(plan);
  return {
    job: {
      ...summary,
      metadata: plan.job.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {},
      output: plan.job.output ?? null,
      artifacts: Array.isArray(plan.job.artifacts) ? plan.job.artifacts : [],
    },
    observability: buildJobObservabilityCard(summary, runtime),
    route: routeSummary(plan.route),
    adapterRequest: plan.adapterRequest
      ? {
          method: plan.adapterRequest.method,
          path: plan.adapterRequest.path,
          headers: plan.adapterRequest.headers,
        }
      : null,
  };
}

export function mapAuthAiGatewayError(err) {
  if (isTransientPostgresError(err)) {
    return { status: 503, body: attachFailureReasonToErrorBody(aiGatewayTransientPostgresBody(), err, { stage: 'writeback' }) };
  }
  if (err instanceof AiGatewayValidationError) {
    const body = attachFailureReasonToErrorBody(
      {
        error: err.code,
        message: err.message,
        ...(err.details && typeof err.details === 'object' ? { details: err.details } : {}),
      },
      err
    );
    if (
      err.code === 'AI_GATEWAY_MODEL_ROUTE_NOT_FOUND' ||
      err.code === 'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE' ||
      err.code === 'AI_GATEWAY_MODEL_ADAPTER_PENDING' ||
      err.code === 'AI_GATEWAY_MODEL_ROUTE_AMBIGUOUS' ||
      err.code === 'AI_GATEWAY_PROVIDER_PAUSED' ||
      err.code === 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE'
    ) {
      return { status: 422, body };
    }
    return { status: 400, body };
  }
  if (err instanceof AiGatewayRouteError) {
    return {
      status: 422,
      body: attachFailureReasonToErrorBody({ error: err.code, message: err.message }, err, { stage: 'routing' }),
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    status: 500,
    body: attachFailureReasonToErrorBody(
      { error: 'AI_GATEWAY_INTERNAL_ERROR', message },
      err,
      { defaultCode: 'AI_GATEWAY_INTERNAL_ERROR' }
    ),
  };
}

export async function createAuthAiGatewayJob(req, body, user, options = {}) {
  const store = options.store || persistentAiGatewayJobStore;
  const evaluateCreditsGate = options.evaluateCreditsGate || evaluateAiGatewayCreditsGate;
  const raw = body && typeof body === 'object' ? body : {};
  const gate = await evaluateCreditsGate(req, raw, { userId: user.id });
  if (!gate.ok) {
    return {
      status: gate.status || 403,
      body: attachFailureReasonToErrorBody(
        gate.body || { error: 'AI_GATEWAY_CREDITS_GATE_FAILED' },
        gate.body || 'AI_GATEWAY_CREDITS_GATE_FAILED',
        { stage: 'billing' }
      ),
    };
  }

  const planInput = {
    ...raw,
    userId: user.id,
    metadata: {
      ...(raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {}),
      ...(gate.metadata || {}),
      authApiFacade: true,
    },
  };
  const opsControl = options.opsControl || (await readAiGatewayOpsControlConfig());
  const modelOpsConfig = options.modelOpsConfig || (await readModelOpsConfig());
  const publication = validateAiGatewayModelPublication(planInput, modelOpsConfig);
  if (publication.canonicalModelId) {
    planInput.metadata.modelPublication = {
      canonicalModelId: publication.canonicalModelId,
      restricted: publication.restricted,
    };
  }
  const executableRoute = await validateAiGatewayModelRouteExecutable(planInput, {
    listProviderKeys: options.listProviderKeys,
    checkProviderKeys: options.checkProviderKeys,
    disabledProviders: opsControl.disabledProviders,
    modelOpsConfig,
  });
  if (executableRoute.checked) {
    const selectionStrategy =
      executableRoute.routeDecision?.selectedRoute?.selectionReason?.strategy ||
      executableRoute.routeDecision?.selectionReason?.strategy ||
      '';
    if (Boolean(raw.provider) || selectionStrategy === 'admin_pin') {
      planInput.metadata.providerPinned = true;
    }
    const shouldPinProvider =
      Boolean(raw.provider) ||
      Boolean(executableRoute.route?.platformKeyRequired);
    if (shouldPinProvider && !planInput.provider && executableRoute.route?.providerId) {
      planInput.metadata.aiGatewayFallback = {
        ...(planInput.metadata.aiGatewayFallback && typeof planInput.metadata.aiGatewayFallback === 'object'
          ? planInput.metadata.aiGatewayFallback
          : {}),
        // System-inferred pin (platform key required) may still fall back; caller pin is blocked above.
        autoSelectedProvider: !raw.provider,
      };
      planInput.provider = executableRoute.route.providerId;
    }
    if (executableRoute.route?.fallbackPolicy) {
      planInput.metadata.aiGatewayFallback = {
        ...(planInput.metadata.aiGatewayFallback && typeof planInput.metadata.aiGatewayFallback === 'object'
          ? planInput.metadata.aiGatewayFallback
          : {}),
        policy: executableRoute.route.fallbackPolicy,
      };
    }
    if (executableRoute.route?.fallbackMaxAttempts) {
      planInput.metadata.aiGatewayFallback = {
        ...(planInput.metadata.aiGatewayFallback && typeof planInput.metadata.aiGatewayFallback === 'object'
          ? planInput.metadata.aiGatewayFallback
          : {}),
        maxAttempts: executableRoute.route.fallbackMaxAttempts,
      };
    }
    planInput.metadata.modelRouteGuard = {
        canonicalModelId: executableRoute.canonicalModelId,
        providerId: executableRoute.route.providerId,
        executionStatus: executableRoute.route.executionStatus,
        gatewayExecutionStatus: executableRoute.route.gatewayExecutionStatus,
      platformKeyRequired: executableRoute.route.platformKeyRequired,
      fallbackPolicy: executableRoute.route.fallbackPolicy,
      fallbackMaxAttempts: executableRoute.route.fallbackMaxAttempts,
      routeId: executableRoute.route.routeId,
        upstreamModelId: executableRoute.route.upstreamModelId,
      };
    if (executableRoute.routeDecision) {
      planInput.metadata.routeDecision = executableRoute.routeDecision;
    }
      if (executableRoute.route.upstreamModelId) {
        planInput.input = {
          ...(planInput.input && typeof planInput.input === 'object' ? planInput.input : {}),
          upstreamModelId: executableRoute.route.upstreamModelId,
        };
      }
    }
  const planRoutes = executableRoute.runtimeRoute ? [executableRoute.runtimeRoute] : options.routes;
  let plan = await store.put(
    createAiGatewayJobPlan(planInput, {
      opsControl,
      routes: planRoutes,
      routeDecision: executableRoute.routeDecision || planInput.metadata?.routeDecision || null,
      selectedRoute: executableRoute.routeDecision?.selectedRoute || null,
    })
  );
  const executionOptions = {
    store,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.executionStartTimeoutMs,
    cookieHeader: req?.headers?.cookie,
    pollIntervalMs: options.pollIntervalMs,
    pollTimeoutMs: options.pollTimeoutMs,
    pollRequestTimeoutMs: options.pollRequestTimeoutMs,
    handoffRetries: options.handoffRetries,
    handoffRetryDelayMs: options.handoffRetryDelayMs,
    handoffRetryJitterMs: options.handoffRetryJitterMs,
    handoffHealthProbe: options.handoffHealthProbe,
    handoffHealthProbeTimeoutMs: options.handoffHealthProbeTimeoutMs,
    handoffHealthProbeIntervalMs: options.handoffHealthProbeIntervalMs,
    handoffHealthProbeRequestTimeoutMs: options.handoffHealthProbeRequestTimeoutMs,
    healthFetchImpl: options.healthFetchImpl,
    deferRetryableHandoff: options.deferRetryableHandoff,
    deferredHandoffDelayMs: options.deferredHandoffDelayMs,
    deferredHandoffJitterMs: options.deferredHandoffJitterMs,
    deferredHandoffMaxAttempts: options.deferredHandoffMaxAttempts,
    deferredHandoffAttempt: options.deferredHandoffAttempt,
    awaitBackgroundPoll: options.awaitBackgroundPoll,
    disableBackgroundPoll: options.disableBackgroundPoll,
    opsControl,
  };
  if (isAiGatewayExecutionEnabled()) {
    if (shouldAwaitAuthAiGatewayExecution(options)) {
      const execution = await startAiGatewayJobExecution(plan, executionOptions);
      plan = execution.plan || plan;
    } else {
      const queuedPatch = {
        status: 'queued',
        error: null,
        metadata: {
          gatewayExecution: {
            queuedAt: new Date().toISOString(),
            targetPath: plan.adapterRequest?.path || null,
            workerId: plan.route?.workerId || null,
            adapterId: plan.route?.adapterId || null,
            background: true,
          },
        },
      };
      const executionPlan = applyAiJobStatusPatch(plan, queuedPatch);
      plan = await store.update(plan.job.id, queuedPatch);
      startAuthAiGatewayExecutionInBackground(executionPlan, executionOptions);
    }
  }
  return { status: 202, body: publicAuthAiJobDetail(plan) };
}

export async function listAuthAiGatewayJobs(user, query = {}, options = {}) {
  const store = options.store || persistentAiGatewayJobStore;
  const limit = clampListLimit(query.limit);
  const plans = await store.list({
    limit,
    userId: options.admin ? query.userId : user.id,
    status: query.status,
    provider: query.provider,
    model: query.model,
    modality: query.modality,
    capability: query.capability,
    q: query.q,
    failureStage: query.failureStage,
    failureOwner: query.failureOwner,
  });
  return { status: 200, body: { items: plans.map(publicAuthAiJobSummary), limit } };
}

export async function summarizeAuthAiGatewayJobs(_user, query = {}, options = {}) {
  const store = options.store || persistentAiGatewayJobStore;
  const limit = clampListLimit(query.limit || 100);
  const plans = await store.list({
    limit,
    userId: options.admin ? query.userId : _user?.id,
    status: query.status,
    provider: query.provider,
    model: query.model,
    modality: query.modality,
    capability: query.capability,
    q: query.q,
    failureStage: query.failureStage,
    failureOwner: query.failureOwner,
  });
  return { status: 200, body: buildAiGatewayOpsSummary(plans, { limit }) };
}

export async function getAuthAiGatewayJob(id, user, options = {}) {
  const store = options.store || persistentAiGatewayJobStore;
  const plan = await store.get(id);
  if (!plan) return { status: 404, body: { error: 'AI_GATEWAY_JOB_NOT_FOUND', message: 'Job not found or expired' } };
  if (!options.admin && String(plan.job.userId || '') !== String(user.id || '')) {
    return { status: 404, body: { error: 'AI_GATEWAY_JOB_NOT_FOUND', message: 'Job not found or expired' } };
  }
  return { status: 200, body: publicAuthAiJobDetail(plan) };
}

export async function cancelAuthAiGatewayJob(id, user, options = {}) {
  const store = options.store || persistentAiGatewayJobStore;
  const plan = await store.get(id);
  if (!plan) return { status: 404, body: { error: 'AI_GATEWAY_JOB_NOT_FOUND', message: 'Job not found or expired' } };
  if (!options.admin && String(plan.job.userId || '') !== String(user.id || '')) {
    return { status: 404, body: { error: 'AI_GATEWAY_JOB_NOT_FOUND', message: 'Job not found or expired' } };
  }
  if (plan.job.status === 'cancelled') return { status: 200, body: publicAuthAiJobDetail(plan) };
  if (!CANCELLABLE_STATUSES.has(plan.job.status)) {
    return {
      status: 409,
      body: { error: 'AI_GATEWAY_JOB_NOT_CANCELLABLE', message: `Job status ${plan.job.status} cannot be cancelled` },
    };
  }

  const cancelledAt = new Date().toISOString();
  let workerCancel = null;
  try {
    workerCancel = await cancelAiGatewayWorkerExecution(plan, options);
  } catch (err) {
    workerCancel = {
      cancelled: false,
      mode: 'error',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  const next = await store.update(id, {
    status: 'cancelled',
    metadata: { cancelledByUserId: user.id, cancelledAt, workerCancel },
    error: { code: 'AI_GATEWAY_JOB_CANCELLED', message: 'Job cancelled' },
  });
  const settlement = await settleAiGatewayJobCredits(next);
  const metadata = settlementMetadataPatch(next, settlement);
  const settled = Object.keys(metadata).length ? await store.update(id, { metadata }) : next;
  return { status: 200, body: publicAuthAiJobDetail(settled) };
}

export async function retryAuthAiGatewayJob(id, user, body = {}, options = {}) {
  const store = options.store || persistentAiGatewayJobStore;
  const original = await store.get(id);
  if (!original) return { status: 404, body: { error: 'AI_GATEWAY_JOB_NOT_FOUND', message: 'Job not found or expired' } };
  if (!options.admin && String(original.job.userId || '') !== String(user.id || '')) {
    return { status: 404, body: { error: 'AI_GATEWAY_JOB_NOT_FOUND', message: 'Job not found or expired' } };
  }
  if (!RETRYABLE_STATUSES.has(original.job.status)) {
    return {
      status: 409,
      body: { error: 'AI_GATEWAY_JOB_NOT_RETRYABLE', message: `Job status ${original.job.status} cannot be retried` },
    };
  }

  const raw = body && typeof body === 'object' ? body : {};
  const metadata = original.job.metadata && typeof original.job.metadata === 'object' ? original.job.metadata : {};
  const opsControl = options.opsControl || await readAiGatewayOpsControlConfig();
  const retryInput = {
    id: raw.id,
    modality: original.job.modality,
    capability: original.job.capability,
    ...(typeof raw.provider === 'string' && raw.provider.trim() ? { provider: raw.provider.trim() } : {}),
    model: original.job.model,
    userId: original.job.userId || user.id,
    correlationId: raw.correlationId,
    input: original.job.input || {},
    metadata: {
      ...metadata,
      ...(raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {}),
      retryOfJobId: original.job.id,
      retryOfCorrelationId: original.job.correlationId,
      retryOfStatus: original.job.status,
      retryCreatedByUserId: user.id,
      authApiFacade: true,
    },
  };
  const modelOpsConfig = options.modelOpsConfig || (await readModelOpsConfig());
  const publication = validateAiGatewayModelPublication(retryInput, modelOpsConfig);
  if (publication.canonicalModelId) {
    retryInput.metadata.modelPublication = {
      canonicalModelId: publication.canonicalModelId,
      restricted: publication.restricted,
    };
  }
  const executableRoute = await validateAiGatewayModelRouteExecutable(retryInput, {
    listProviderKeys: options.listProviderKeys,
    checkProviderKeys: options.checkProviderKeys,
    disabledProviders: opsControl.disabledProviders,
    modelOpsConfig,
  });
  if (executableRoute.checked) {
    const shouldPinProvider =
      Boolean(raw.provider) ||
      Boolean(executableRoute.route?.platformKeyRequired);
    if (shouldPinProvider && !retryInput.provider && executableRoute.route?.providerId) {
      retryInput.provider = executableRoute.route.providerId;
    }
    if (!shouldPinProvider && retryInput.provider && !raw.provider) {
      delete retryInput.provider;
    }
    retryInput.metadata.modelRouteGuard = {
      canonicalModelId: executableRoute.canonicalModelId,
      providerId: executableRoute.route.providerId,
      executionStatus: executableRoute.route.executionStatus,
      gatewayExecutionStatus: executableRoute.route.gatewayExecutionStatus,
      platformKeyRequired: executableRoute.route.platformKeyRequired,
    };
    if (executableRoute.routeDecision) {
      retryInput.metadata.routeDecision = executableRoute.routeDecision;
    }
  }
  const retryPlan = await store.put(
    createAiGatewayJobPlan(retryInput, {
      opsControl,
      routeDecision: executableRoute.routeDecision || retryInput.metadata?.routeDecision || null,
      selectedRoute: executableRoute.routeDecision?.selectedRoute || null,
    })
  );
  return { status: 202, body: publicAuthAiJobDetail(retryPlan) };
}
