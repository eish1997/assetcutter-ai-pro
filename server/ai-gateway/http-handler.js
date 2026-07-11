import { API_JSON_BODY_MAX_BYTES, BODY_TOO_LARGE_MESSAGE, readBodyUtf8 } from '../http-limits.js';
import { evaluateAiGatewayCreditsGate } from './credits-gate.js';
import { AiGatewayValidationError, createAiGatewayJobPlan } from './index.js';
import { persistentAiGatewayJobStore } from './persistent-job-store.js';
import { AiGatewayRouteError } from './provider-router.js';

export const AI_GATEWAY_JOBS_PATH = '/ai-gateway/jobs';

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
  };
}

function mapGatewayError(err) {
  if (err instanceof AiGatewayValidationError) {
    return { status: 400, body: { error: err.code, message: err.message } };
  }
  if (err instanceof AiGatewayRouteError) {
    return { status: 422, body: { error: err.code, message: err.message } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { error: 'AI_GATEWAY_INTERNAL_ERROR', message } };
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
      const plan = await store.put(createAiGatewayJobPlan(planInput));
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

  return false;
}
