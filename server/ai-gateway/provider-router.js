export class AiGatewayRouteError extends Error {
  constructor(message, code = 'AI_GATEWAY_NO_PROVIDER_ROUTE') {
    super(message);
    this.name = 'AiGatewayRouteError';
    this.code = code;
  }
}

export function normalizeAiGatewayRuntimeProviderId(value) {
  const id = typeof value === 'string' && value.trim() ? value.trim() : '';
  if (id === 'vertex-gemini') return 'vertex-site';
  return id;
}

export const DEFAULT_AI_PROVIDER_ROUTES = Object.freeze([
  {
    providerId: 'vertex-site',
    workerId: 'text-worker',
    adapterId: 'ai-worker-proxy',
    channel: 'vertex-proxy',
    upstreamBackend: 'vertex',
    modalities: ['text'],
    capabilities: ['text.generate'],
    priority: 10,
  },
  {
    providerId: 'vertex-site',
    workerId: 'image-worker',
    adapterId: 'ai-worker-proxy',
    channel: 'vertex-proxy',
    upstreamBackend: 'vertex',
    modalities: ['image'],
    capabilities: ['image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit'],
    priority: 10,
  },
  {
    providerId: 'gemini-aistudio',
    workerId: 'text-worker',
    adapterId: 'ai-worker-proxy',
    channel: 'gemini-aistudio',
    upstreamBackend: 'gemini-api-key',
    modalities: ['text'],
    capabilities: ['text.generate'],
    priority: 20,
  },
  {
    providerId: 'gemini-aistudio',
    workerId: 'image-worker',
    adapterId: 'ai-worker-proxy',
    channel: 'gemini-aistudio',
    upstreamBackend: 'gemini-api-key',
    modalities: ['image'],
    capabilities: ['image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit'],
    priority: 20,
  },
  {
    providerId: 'openai-official',
    workerId: 'text-worker',
    adapterId: 'openai-official',
    channel: 'openai-official',
    upstreamBackend: 'openai-official',
    modalities: ['text'],
    capabilities: ['text.generate'],
    priority: 30,
  },
  {
    providerId: 'openai-official',
    workerId: 'image-worker',
    adapterId: 'openai-official',
    channel: 'openai-official',
    upstreamBackend: 'openai-official',
    modalities: ['image'],
    capabilities: ['image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit'],
    priority: 30,
  },
  {
    providerId: 'toapis',
    workerId: 'text-worker',
    adapterId: 'toapis-openai',
    channel: 'toapis-openai',
    upstreamBackend: 'toapis-openai',
    modalities: ['text'],
    capabilities: ['text.generate'],
    priority: 40,
  },
  {
    providerId: 'toapis',
    workerId: 'image-worker',
    adapterId: 'toapis-openai',
    channel: 'toapis-openai',
    upstreamBackend: 'toapis-openai',
    modalities: ['image'],
    capabilities: ['image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit'],
    priority: 40,
  },
  {
    providerId: 'volcengine-ark',
    workerId: 'text-worker',
    adapterId: 'volcengine-ark-openai',
    channel: 'volcengine-ark',
    upstreamBackend: 'volcengine-ark',
    modalities: ['text'],
    capabilities: ['text.generate'],
    priority: 35,
  },
  {
    providerId: 'volcengine-ark',
    workerId: 'image-worker',
    adapterId: 'volcengine-ark-image',
    channel: 'volcengine-ark',
    upstreamBackend: 'volcengine-ark',
    modalities: ['image'],
    capabilities: ['image.generate', 'workflow_text_to_image'],
    priority: 35,
  },
  {
    providerId: 'volcengine-ark',
    workerId: 'video-worker',
    adapterId: 'volcengine-ark-async',
    channel: 'volcengine-ark',
    upstreamBackend: 'volcengine-ark',
    modalities: ['video'],
    capabilities: ['video.generate', 'workflow_generate_video'],
    priority: 35,
  },
  {
    providerId: 'volcengine-ark',
    workerId: 'model3d-worker',
    adapterId: 'volcengine-ark-async',
    channel: 'volcengine-ark',
    upstreamBackend: 'volcengine-ark',
    modalities: ['model3d'],
    capabilities: ['model3d.generate'],
    priority: 35,
  },
  {
    providerId: 'volcengine-jimeng',
    workerId: 'image-worker',
    adapterId: 'jimeng-visual',
    channel: 'jimeng-visual',
    upstreamBackend: 'volcengine-jimeng',
    modalities: ['image'],
    capabilities: ['image.generate', 'workflow_text_to_image', 'workflow_image_edit'],
    priority: 15,
  },
  {
    providerId: 'volcengine-jimeng',
    workerId: 'video-worker',
    adapterId: 'jimeng-visual',
    channel: 'jimeng-visual',
    upstreamBackend: 'volcengine-jimeng',
    modalities: ['video'],
    capabilities: ['video.generate', 'workflow_generate_video', 'workflow_jimeng_video'],
    priority: 10,
  },
  {
    providerId: 'tripo',
    workerId: 'model3d-worker',
    adapterId: 'tripo-openapi',
    channel: 'tripo-openapi',
    upstreamBackend: 'tripo',
    modalities: ['model3d'],
    capabilities: ['model3d.generate'],
    priority: 10,
  },
  {
    providerId: 'tencent-hunyuan',
    workerId: 'model3d-worker',
    adapterId: 'tencent-hunyuan-3d',
    channel: 'tencent-hunyuan',
    upstreamBackend: 'tencent-hunyuan',
    modalities: ['model3d'],
    capabilities: ['model3d.generate'],
    priority: 20,
  },
]);

function matches(value, accepted) {
  return Array.isArray(accepted) && accepted.includes(value);
}

function routeMatchesJob(route, job) {
  const requestedProvider = normalizeAiGatewayRuntimeProviderId(job.provider);
  if (requestedProvider && route.providerId !== requestedProvider) return false;
  if (!matches(job.modality, route.modalities)) return false;
  if (matches(job.capability, route.capabilities)) return true;
  return route.capabilities.some((cap) => cap.endsWith('.generate') && job.capability === `${job.modality}.generate`);
}

export function resolveAiProviderRoute(job, routes = DEFAULT_AI_PROVIDER_ROUTES, options = {}) {
  const disabledProviders = new Set(
    Array.isArray(options.disabledProviders)
      ? options.disabledProviders.map(normalizeAiGatewayRuntimeProviderId).filter(Boolean)
      : []
  );
  const disabledModels = new Set(Array.isArray(options.disabledModels) ? options.disabledModels : []);
  if (job.model && disabledModels.has(job.model)) {
    throw new AiGatewayRouteError(
      `AI model is paused by ops control: ${job.model}`,
      'AI_GATEWAY_MODEL_PAUSED'
    );
  }
  const candidates = routes
    .filter((route) => routeMatchesJob(route, job))
    .filter((route) => !disabledProviders.has(route.providerId))
    .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));

  const route = candidates[0];
  if (!route) {
    const wanted = job.provider ? ` provider=${normalizeAiGatewayRuntimeProviderId(job.provider) || job.provider}` : '';
    throw new AiGatewayRouteError(
      `No AI provider route for modality=${job.modality} capability=${job.capability}${wanted}`
    );
  }

  return {
    providerId: route.providerId,
    workerId: route.workerId || null,
    adapterId: route.adapterId,
    legacyAdapterId: route.legacyAdapterId || null,
    channel: route.channel,
    upstreamBackend: route.upstreamBackend,
  };
}
