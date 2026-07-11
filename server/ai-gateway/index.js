import { buildGeminiProxyAsyncRequest } from './adapters/gemini-proxy-adapter.js';
import { createAiJobDraft } from './job.js';
import { resolveAiProviderRoute } from './provider-router.js';

export function createAiGatewayJobPlan(input, options = {}) {
  const job = createAiJobDraft(input, options);
  const route = resolveAiProviderRoute(job, options.routes);

  if (route.adapterId !== 'gemini-proxy') {
    throw new Error(`Unsupported AI gateway adapter: ${route.adapterId}`);
  }

  return {
    job,
    route,
    adapterRequest: buildGeminiProxyAsyncRequest(job, route),
  };
}

export { createAiJobDraft, normalizeAiJobModality, AiGatewayValidationError } from './job.js';
export { resolveAiProviderRoute, AiGatewayRouteError, DEFAULT_AI_PROVIDER_ROUTES } from './provider-router.js';
export { buildGeminiProxyAsyncRequest, GEMINI_PROXY_ASYNC_PATH } from './adapters/gemini-proxy-adapter.js';
