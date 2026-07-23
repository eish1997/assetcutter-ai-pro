import { AiGatewayValidationError } from '../job.js';
import { normalizeInlineDataPayload } from '../inline-data-normalize.js';

export const AI_WORKER_PROXY_ASYNC_PATH = '/proxy/gemini/async';

function requireValue(value, field) {
  if (value == null || value === '') {
    throw new AiGatewayValidationError(`AI Worker Proxy adapter requires ${field}`, 'AI_GATEWAY_ADAPTER_INPUT_INVALID');
  }
  return value;
}

function positiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function estimatedCreditsForJob(job, input) {
  const metadata = job?.metadata && typeof job.metadata === 'object' ? job.metadata : {};
  const gate = metadata.creditsGate && typeof metadata.creditsGate === 'object' ? metadata.creditsGate : {};
  return (
    positiveInt(input?.estimatedCredits) ||
    positiveInt(input?.costWeight) ||
    positiveInt(gate.estimatedCredits) ||
    positiveInt(gate.reserveAmount)
  );
}

export function buildAiWorkerProxyAsyncRequest(job, route) {
  if (route?.adapterId !== 'ai-worker-proxy') {
    throw new AiGatewayValidationError(`Unsupported adapter for AI Worker Proxy: ${route?.adapterId || ''}`);
  }

  const input = job.input || {};
  const model = requireValue(input.upstreamModelId || input.model || job.model, 'model');
  const contents = normalizeInlineDataPayload(requireValue(input.contents, 'input.contents'));
  const body = {
    model,
    contents,
    config: input.config && typeof input.config === 'object' ? input.config : {},
    fairnessMeta: {
      ...(input.fairnessMeta && typeof input.fairnessMeta === 'object' ? input.fairnessMeta : {}),
      aiGatewayTraceJobId: job.id,
    },
  };

  if (route.upstreamBackend === 'vertex') {
    body.aiBackend = 'vertex';
  }
  if (input.costWeight != null) {
    body.costWeight = input.costWeight;
    body.fairnessMeta.costWeight = input.costWeight;
  }
  const estimatedCredits = estimatedCreditsForJob(job, input);
  if (estimatedCredits > 0) {
    body.estimatedCredits = estimatedCredits;
    if (body.fairnessMeta.costWeight == null) body.fairnessMeta.costWeight = estimatedCredits;
  }

  return {
    method: 'POST',
    path: AI_WORKER_PROXY_ASYNC_PATH,
    body,
    headers: {
      'content-type': 'application/json',
      'x-ac-task-envelope': job.id,
      'x-ac-correlation-id': job.correlationId,
    },
  };
}
