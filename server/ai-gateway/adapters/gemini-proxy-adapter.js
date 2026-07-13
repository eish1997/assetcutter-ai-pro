import { AiGatewayValidationError } from '../job.js';

export const GEMINI_PROXY_ASYNC_PATH = '/proxy/gemini/async';

function requireValue(value, field) {
  if (value == null || value === '') {
    throw new AiGatewayValidationError(`Gemini proxy adapter requires ${field}`, 'AI_GATEWAY_ADAPTER_INPUT_INVALID');
  }
  return value;
}

export function buildGeminiProxyAsyncRequest(job, route) {
  if (route?.adapterId !== 'legacy-gemini-proxy' && route?.legacyAdapterId !== 'gemini-proxy') {
    throw new AiGatewayValidationError(`Unsupported adapter for Gemini proxy: ${route?.adapterId || ''}`);
  }

  const input = job.input || {};
  const model = requireValue(job.model || input.model, 'model');
  const contents = requireValue(input.contents, 'input.contents');
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

  return {
    method: 'POST',
    path: GEMINI_PROXY_ASYNC_PATH,
    body,
    headers: {
      'content-type': 'application/json',
      'x-ac-task-envelope': job.id,
      'x-ac-correlation-id': job.correlationId,
    },
  };
}
