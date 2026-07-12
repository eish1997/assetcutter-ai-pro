import { evaluateAiGatewayCreditsGate } from './credits-gate.js';
import { AiGatewayValidationError, createAiGatewayJobPlan } from './index.js';
import { persistentAiGatewayJobStore } from './persistent-job-store.js';
import { AiGatewayRouteError } from './provider-router.js';
import { settleAiGatewayJobCredits, settlementMetadataPatch } from './settlement.js';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const CANCELLABLE_STATUSES = new Set(['created', 'queued', 'running']);
const RETRYABLE_STATUSES = new Set(['failed', 'cancelled']);

function clampListLimit(value) {
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(Number(value) || DEFAULT_LIST_LIMIT)));
}

function routeSummary(route) {
  if (!route || typeof route !== 'object') return null;
  return {
    providerId: route.providerId || null,
    adapterId: route.adapterId || null,
    channel: route.channel || null,
    upstreamBackend: route.upstreamBackend || null,
  };
}

function errorSummary(error) {
  if (!error) return null;
  if (typeof error === 'object') {
    return {
      code: error.code || null,
      message: error.message || String(error),
    };
  }
  return { code: null, message: String(error) };
}

export function publicAuthAiJobSummary(plan) {
  const metadata = plan.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  return {
    id: plan.job.id,
    status: plan.job.status,
    modality: plan.job.modality,
    capability: plan.job.capability,
    provider: plan.job.provider || null,
    model: plan.job.model || null,
    userId: plan.job.userId || null,
    correlationId: plan.job.correlationId,
    createdAt: plan.job.createdAt,
    updatedAt: plan.job.updatedAt,
    startedAt: plan.job.startedAt || null,
    finishedAt: plan.job.finishedAt || null,
    route: routeSummary(plan.route),
    traceOnly: Boolean(metadata.traceOnly),
    legacyPath: metadata.legacyPath || null,
    proxyJobId: metadata.proxyJobId || null,
    creditsGate: metadata.creditsGate || null,
    error: errorSummary(plan.job.error),
  };
}

export function publicAuthAiJobDetail(plan) {
  return {
    job: {
      ...publicAuthAiJobSummary(plan),
      output: plan.job.output ?? null,
      artifacts: Array.isArray(plan.job.artifacts) ? plan.job.artifacts : [],
    },
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
  if (err instanceof AiGatewayValidationError) {
    return { status: 400, body: { error: err.code, message: err.message } };
  }
  if (err instanceof AiGatewayRouteError) {
    return { status: 422, body: { error: err.code, message: err.message } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { error: 'AI_GATEWAY_INTERNAL_ERROR', message } };
}

export async function createAuthAiGatewayJob(req, body, user, options = {}) {
  const store = options.store || persistentAiGatewayJobStore;
  const evaluateCreditsGate = options.evaluateCreditsGate || evaluateAiGatewayCreditsGate;
  const raw = body && typeof body === 'object' ? body : {};
  const gate = await evaluateCreditsGate(req, raw, { userId: user.id });
  if (!gate.ok) {
    return { status: gate.status || 403, body: gate.body || { error: 'AI_GATEWAY_CREDITS_GATE_FAILED' } };
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
  const plan = await store.put(createAiGatewayJobPlan(planInput));
  return { status: 202, body: publicAuthAiJobDetail(plan) };
}

export async function listAuthAiGatewayJobs(user, query = {}, options = {}) {
  const store = options.store || persistentAiGatewayJobStore;
  const limit = clampListLimit(query.limit);
  const plans = await store.list({ limit, userId: options.admin ? undefined : user.id });
  return { status: 200, body: { items: plans.map(publicAuthAiJobSummary), limit } };
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
  const next = await store.update(id, {
    status: 'cancelled',
    metadata: { cancelledByUserId: user.id, cancelledAt },
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
  const retryPlan = await store.put(
    createAiGatewayJobPlan({
      id: raw.id,
      modality: original.job.modality,
      capability: original.job.capability,
      provider: original.job.provider,
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
    })
  );
  return { status: 202, body: publicAuthAiJobDetail(retryPlan) };
}
