export const OPENAI_COMPATIBLE_PROVIDER_CONFIG = Object.freeze({
  'openai-official': Object.freeze({
    providerId: 'openai-official',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    appendV1: true,
    channel: 'openai-official',
    upstreamBackend: 'openai-official',
    priority: 30,
    textAdapterId: 'openai-official',
    imageAdapterId: 'openai-official',
    adapterIds: Object.freeze(['openai-official']),
  }),
  toapis: Object.freeze({
    providerId: 'toapis',
    label: 'ToAPIs',
    defaultBaseUrl: 'https://toapis.com/v1',
    appendV1: true,
    channel: 'toapis-openai',
    upstreamBackend: 'toapis-openai',
    priority: 40,
    textAdapterId: 'toapis-openai',
    imageAdapterId: 'toapis-openai',
    adapterIds: Object.freeze(['toapis-openai']),
  }),
  '302ai': Object.freeze({
    providerId: '302ai',
    label: '302.AI',
    defaultBaseUrl: 'https://api.302.ai/v1',
    appendV1: true,
    channel: '302ai-openai',
    upstreamBackend: '302ai-openai',
    priority: 42,
    textAdapterId: '302ai-openai',
    imageAdapterId: '302ai-openai',
    adapterIds: Object.freeze(['302ai-openai']),
  }),
  aihubmix: Object.freeze({
    providerId: 'aihubmix',
    label: 'AIHubMix',
    defaultBaseUrl: 'https://aihubmix.com/v1',
    appendV1: true,
    channel: 'aihubmix-openai',
    upstreamBackend: 'aihubmix-openai',
    priority: 43,
    textAdapterId: 'aihubmix-openai',
    imageAdapterId: 'aihubmix-openai',
    adapterIds: Object.freeze(['aihubmix-openai']),
  }),
  tinysnow: Object.freeze({
    providerId: 'tinysnow',
    label: 'TinySnow',
    defaultBaseUrl: 'https://tinysnow.one/v1',
    appendV1: true,
    channel: 'tinysnow-openai',
    upstreamBackend: 'tinysnow-openai',
    priority: 45,
    textAdapterId: 'tinysnow-openai',
    imageAdapterId: 'tinysnow-openai',
    adapterIds: Object.freeze(['tinysnow-openai']),
  }),
  'volcengine-ark': Object.freeze({
    providerId: 'volcengine-ark',
    label: 'Volcengine Ark',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    appendV1: false,
    channel: 'volcengine-ark',
    upstreamBackend: 'volcengine-ark',
    priority: 35,
    textAdapterId: 'volcengine-ark-openai',
    imageAdapterId: 'volcengine-ark-image',
    adapterIds: Object.freeze(['volcengine-ark-openai', 'volcengine-ark-image']),
  }),
});

const CONFIG_BY_ADAPTER_ID = new Map(
  Object.values(OPENAI_COMPATIBLE_PROVIDER_CONFIG).flatMap((config) =>
    config.adapterIds.map((adapterId) => [adapterId, config])
  )
);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function openAiCompatibleConfigForProvider(providerId) {
  return OPENAI_COMPATIBLE_PROVIDER_CONFIG[nonEmptyString(providerId)] || null;
}

export function openAiCompatibleConfigForAdapter(adapterId) {
  return CONFIG_BY_ADAPTER_ID.get(nonEmptyString(adapterId)) || null;
}

export function isOpenAiCompatibleAdapterId(adapterId) {
  return Boolean(openAiCompatibleConfigForAdapter(adapterId));
}

export function openAiCompatibleProviderConfigs() {
  return Object.values(OPENAI_COMPATIBLE_PROVIDER_CONFIG);
}

export function openAiCompatibleAdapterIdsForModality(modality) {
  const field = modality === 'image' ? 'imageAdapterId' : modality === 'text' ? 'textAdapterId' : '';
  if (!field) return [];
  const out = [];
  const seen = new Set();
  for (const config of openAiCompatibleProviderConfigs()) {
    const adapterId = nonEmptyString(config[field]);
    if (!adapterId || seen.has(adapterId)) continue;
    seen.add(adapterId);
    out.push(adapterId);
  }
  return out;
}

export function openAiCompatibleChannelForProvider(providerId) {
  return openAiCompatibleConfigForProvider(providerId)?.channel || '';
}

export function buildOpenAiCompatibleRuntimeRoutes() {
  const textCapabilities = Object.freeze(['text.generate']);
  const imageCapabilities = Object.freeze(['image.generate', 'image.edit', 'workflow_text_to_image', 'workflow_image_edit']);
  return openAiCompatibleProviderConfigs().flatMap((config) => {
    const providerId = config.providerId;
    const channel = config.channel;
    const priority = config.priority;
    return [
      {
        providerId,
        workerId: 'text-worker',
        adapterId: config.textAdapterId,
        channel,
        upstreamBackend: config.upstreamBackend,
        modalities: ['text'],
        capabilities: textCapabilities,
        priority,
      },
      {
        providerId,
        workerId: 'image-worker',
        adapterId: config.imageAdapterId,
        channel,
        upstreamBackend: config.upstreamBackend,
        modalities: ['image'],
        capabilities: imageCapabilities,
        priority,
      },
    ];
  });
}

export function defaultOpenAiCompatibleBaseUrl(providerId) {
  return openAiCompatibleConfigForProvider(providerId)?.defaultBaseUrl || OPENAI_COMPATIBLE_PROVIDER_CONFIG['openai-official'].defaultBaseUrl;
}

export function openAiCompatibleProviderLabel(providerId) {
  return openAiCompatibleConfigForProvider(providerId)?.label || OPENAI_COMPATIBLE_PROVIDER_CONFIG['openai-official'].label;
}

export function normalizeOpenAiCompatibleBaseUrl(value, providerId) {
  const config = openAiCompatibleConfigForProvider(providerId) || OPENAI_COMPATIBLE_PROVIDER_CONFIG['openai-official'];
  const raw = nonEmptyString(value) || config.defaultBaseUrl;
  const trimmed = raw.replace(/\/+$/, '');
  if (!config.appendV1) return trimmed;
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}
