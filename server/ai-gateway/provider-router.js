export class AiGatewayRouteError extends Error {
  constructor(message, code = 'AI_GATEWAY_NO_PROVIDER_ROUTE') {
    super(message);
    this.name = 'AiGatewayRouteError';
    this.code = code;
  }
}

export const DEFAULT_AI_PROVIDER_ROUTES = Object.freeze([
  {
    providerId: 'vertex-gemini',
    adapterId: 'gemini-proxy',
    channel: 'vertex-proxy',
    upstreamBackend: 'vertex',
    modalities: ['text', 'image'],
    capabilities: ['text.generate', 'image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit'],
    priority: 10,
  },
  {
    providerId: 'gemini-aistudio',
    adapterId: 'gemini-proxy',
    channel: 'gemini-aistudio',
    upstreamBackend: 'gemini-api-key',
    modalities: ['text', 'image'],
    capabilities: ['text.generate', 'image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit'],
    priority: 20,
  },
]);

function matches(value, accepted) {
  return Array.isArray(accepted) && accepted.includes(value);
}

function routeMatchesJob(route, job) {
  if (job.provider && route.providerId !== job.provider) return false;
  if (!matches(job.modality, route.modalities)) return false;
  if (matches(job.capability, route.capabilities)) return true;
  return route.capabilities.some((cap) => cap.endsWith('.generate') && job.capability === `${job.modality}.generate`);
}

export function resolveAiProviderRoute(job, routes = DEFAULT_AI_PROVIDER_ROUTES) {
  const candidates = routes
    .filter((route) => routeMatchesJob(route, job))
    .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));

  const route = candidates[0];
  if (!route) {
    const wanted = job.provider ? ` provider=${job.provider}` : '';
    throw new AiGatewayRouteError(
      `No AI provider route for modality=${job.modality} capability=${job.capability}${wanted}`
    );
  }

  return {
    providerId: route.providerId,
    adapterId: route.adapterId,
    channel: route.channel,
    upstreamBackend: route.upstreamBackend,
  };
}
