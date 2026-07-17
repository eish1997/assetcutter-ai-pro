import { API_JSON_BODY_MAX_BYTES, BODY_TOO_LARGE_MESSAGE, readBodyUtf8 } from '../http-limits.js';
import { evaluateAiGatewayCreditsGate } from './credits-gate.js';
import { AiGatewayValidationError, createAiGatewayJobPlan } from './index.js';
import { persistentAiGatewayJobStore } from './persistent-job-store.js';
import { AiGatewayRouteError } from './provider-router.js';
import { settleAiGatewayJobCredits, settlementMetadataPatch } from './settlement.js';
import { recordAiGatewayUsageEvent } from './usage-event.js';
import { readModelOpsConfig } from './model-ops-config-store.js';
import { readAiGatewayOpsControlConfig } from './ops-control.js';
import { validateAiGatewayModelPublication } from './model-publication-guard.js';
import { validateAiGatewayModelRouteExecutable } from './model-route-guard.js';

export const AI_GATEWAY_JOBS_PATH = '/ai-gateway/jobs';
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

function clampListLimit(value) {
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(Number(value) || DEFAULT_LIST_LIMIT)));
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
  });
  res.end(body);
}

function publicJobPlan(plan) {
  return {
    job: plan.job,
    route: plan.route,
    adapterRequest: {
      method: plan.adapterRequest.method,
      path: plan.adapterRequest.path,
      headers: plan.adapterRequest.headers,
      body: plan.adapterRequest.body,
    },
    workerRequest: plan.workerRequest
      ? {
          method: plan.workerRequest.method,
          path: plan.workerRequest.path,
          headers: plan.workerRequest.headers,
          body: plan.workerRequest.body,
        }
      : null,
  };
}

function publicJobSummary(plan) {
  const metadata = plan.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  const route = plan.route && typeof plan.route === 'object' ? plan.route : null;
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
    route: route
        ? {
            providerId: route.providerId || null,
            workerId: route.workerId || null,
            adapterId: route.adapterId || null,
            legacyAdapterId: route.legacyAdapterId || null,
            channel: route.channel || null,
            upstreamBackend: route.upstreamBackend || null,
          }
      : null,
    traceOnly: Boolean(metadata.traceOnly),
    proxyPath: metadata.proxyPath || null,
    proxyJobId: metadata.proxyJobId || null,
    creditsGate: metadata.creditsGate || null,
    error: plan.job.error
      ? {
          code: plan.job.error.code || null,
          message: plan.job.error.message || String(plan.job.error),
        }
      : null,
  };
}

function mapGatewayError(err) {
  if (err instanceof AiGatewayValidationError) {
    const body = { error: err.code, message: err.message };
    if (err.details && typeof err.details === 'object') body.details = err.details;
    if (
      err.code === 'AI_GATEWAY_MODEL_ROUTE_NOT_FOUND' ||
      err.code === 'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE' ||
      err.code === 'AI_GATEWAY_MODEL_ADAPTER_PENDING' ||
      err.code === 'AI_GATEWAY_PROVIDER_PAUSED' ||
      err.code === 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE'
    ) {
      return { status: 422, body };
    }
    return { status: 400, body };
  }
  if (err instanceof AiGatewayRouteError) {
    return { status: 422, body: { error: err.code, message: err.message } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { error: 'AI_GATEWAY_INTERNAL_ERROR', message } };
}

async function readJsonBody(req) {
  const raw = await readBodyUtf8(req, API_JSON_BODY_MAX_BYTES);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AiGatewayValidationError('Invalid JSON body', 'AI_GATEWAY_INVALID_JSON');
  }
}

export async function updateAiGatewayJobStatus(id, patch, options = {}) {
  const store = options.store || persistentAiGatewayJobStore;
  let plan;
  if (typeof store.update !== 'function') {
    const existing = await store.get(id);
    if (!existing) return null;
    plan = await store.put({ ...existing, job: { ...existing.job, ...patch } });
  } else {
    plan = await store.update(id, patch, options);
  }
  if (!plan) return null;
  if (plan.job?.status === 'succeeded') {
    const recordUsageEvent = options.recordUsageEvent || recordAiGatewayUsageEvent;
    await recordUsageEvent(plan);
  }
  const settlement = await settleAiGatewayJobCredits(plan);
  const metadata = settlementMetadataPatch(plan, settlement);
  if (Object.keys(metadata).length) {
    plan = await store.update(id, { metadata }, options);
  }
  return plan;
}

export async function handleAiGatewayRequest(req, res, options = {}) {
  const store = options.store || persistentAiGatewayJobStore;
  const evaluateCreditsGate = options.evaluateCreditsGate || evaluateAiGatewayCreditsGate;
  const path = (req.url || '/').split('?')[0];

  if (path === AI_GATEWAY_JOBS_PATH && req.method === 'POST') {
    try {
      const raw = await readBodyUtf8(req, API_JSON_BODY_MAX_BYTES);
      let parsed;
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        sendJson(res, 400, { error: 'AI_GATEWAY_INVALID_JSON', message: 'Invalid JSON body' });
        return true;
      }
      const gate = await evaluateCreditsGate(req, parsed);
      if (!gate.ok) {
        sendJson(res, gate.status || 403, gate.body || { error: 'AI_GATEWAY_CREDITS_GATE_FAILED' });
        return true;
      }
      const planInput = {
        ...parsed,
        metadata: {
          ...(parsed?.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {}),
          ...(gate.metadata || {}),
        },
      };
      const modelOpsConfig = options.modelOpsConfig || (await readModelOpsConfig());
      const publication = validateAiGatewayModelPublication(planInput, modelOpsConfig);
      if (publication.canonicalModelId) {
        planInput.metadata.modelPublication = {
          canonicalModelId: publication.canonicalModelId,
          restricted: publication.restricted,
        };
      }
      const opsControl = options.opsControl || (await readAiGatewayOpsControlConfig());
      const executableRoute = await validateAiGatewayModelRouteExecutable(planInput, {
        listProviderKeys: options.listProviderKeys,
        checkProviderKeys: options.checkProviderKeys,
        disabledProviders: opsControl.disabledProviders,
      });
      if (executableRoute.checked) {
        const shouldPinProvider =
          Boolean(parsed?.provider) ||
          Boolean(executableRoute.route?.platformKeyRequired);
        if (shouldPinProvider && !planInput.provider && executableRoute.route?.providerId) {
          planInput.provider = executableRoute.route.providerId;
        }
        planInput.metadata.modelRouteGuard = {
          canonicalModelId: executableRoute.canonicalModelId,
          providerId: executableRoute.route.providerId,
          executionStatus: executableRoute.route.executionStatus,
          gatewayExecutionStatus: executableRoute.route.gatewayExecutionStatus,
          platformKeyRequired: executableRoute.route.platformKeyRequired,
        };
      }
      const plan = await store.put(createAiGatewayJobPlan(planInput, { opsControl }));
      sendJson(res, 202, publicJobPlan(plan));
      return true;
    } catch (err) {
      if ((err && err.message) === BODY_TOO_LARGE_MESSAGE) {
        sendJson(res, 413, { error: 'AI_GATEWAY_BODY_TOO_LARGE', message: BODY_TOO_LARGE_MESSAGE });
        return true;
      }
      const mapped = mapGatewayError(err);
      sendJson(res, mapped.status, mapped.body);
      return true;
    }
  }

  if (path === AI_GATEWAY_JOBS_PATH && req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost');
    const limit = clampListLimit(url.searchParams.get('limit'));
    const plans = typeof store.list === 'function' ? await store.list({ limit }) : [];
    sendJson(res, 200, { items: plans.map(publicJobSummary), limit });
    return true;
  }

  if (path.startsWith(`${AI_GATEWAY_JOBS_PATH}/`) && req.method === 'GET') {
    const id = decodeURIComponent(path.slice(`${AI_GATEWAY_JOBS_PATH}/`.length));
    const plan = await store.get(id);
    if (!plan) {
      sendJson(res, 404, { error: 'AI_GATEWAY_JOB_NOT_FOUND', message: 'Job not found or expired' });
      return true;
    }
    sendJson(res, 200, publicJobPlan(plan));
    return true;
  }

  if (path.startsWith(`${AI_GATEWAY_JOBS_PATH}/`) && req.method === 'PATCH') {
    try {
      const id = decodeURIComponent(path.slice(`${AI_GATEWAY_JOBS_PATH}/`.length)).split('/')[0];
      const patch = await readJsonBody(req);
      const plan = await updateAiGatewayJobStatus(id, patch, { store });
      if (!plan) {
        sendJson(res, 404, { error: 'AI_GATEWAY_JOB_NOT_FOUND', message: 'Job not found or expired' });
        return true;
      }
      sendJson(res, 200, publicJobPlan(plan));
      return true;
    } catch (err) {
      if ((err && err.message) === BODY_TOO_LARGE_MESSAGE) {
        sendJson(res, 413, { error: 'AI_GATEWAY_BODY_TOO_LARGE', message: BODY_TOO_LARGE_MESSAGE });
        return true;
      }
      const mapped = mapGatewayError(err);
      sendJson(res, mapped.status, mapped.body);
      return true;
    }
  }

  return false;
}
