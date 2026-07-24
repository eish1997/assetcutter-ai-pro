const DEFAULT_AUTH = Object.freeze({
  scheme: 'bearer',
  header: 'Authorization',
  prefix: 'Bearer ',
  secretField: 'secret',
});

const DEFAULT_SYNC_ENDPOINTS = Object.freeze({
  text: '/chat/completions',
  imageGenerate: '/images/generations',
  imageEdit: '/images/edits',
});

const DEFAULT_TIMEOUTS = Object.freeze({
  requestMs: 60_000,
  pollIntervalMs: 5_000,
  pollTimeoutMs: 900_000,
  pollRequestMs: 30_000,
});

function freezeProviderConfig(raw) {
  const providerId = String(raw?.providerId || '').trim();
  if (!providerId) throw new Error('OpenAI-compatible provider config requires providerId');
  const channel = String(raw.channel || `${providerId}-openai`).trim();
  const textAdapterId = String(raw.textAdapterId || `${providerId}-openai`).trim();
  const imageAdapterId = String(raw.imageAdapterId || textAdapterId).trim();
  const adapterIds = Object.freeze(
    Array.isArray(raw.adapterIds) && raw.adapterIds.length
      ? [...new Set(raw.adapterIds.map((id) => String(id || '').trim()).filter(Boolean))]
      : [...new Set([textAdapterId, imageAdapterId].filter(Boolean))]
  );
  return Object.freeze({
    providerId,
    label: String(raw.label || providerId).trim() || providerId,
    defaultBaseUrl: String(raw.defaultBaseUrl || 'https://api.openai.com/v1').trim(),
    appendV1: raw.appendV1 !== false,
    channel,
    upstreamBackend: String(raw.upstreamBackend || channel).trim(),
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 50,
    textAdapterId,
    imageAdapterId,
    adapterIds,
    asyncCapable: raw.asyncCapable === true,
    auth: Object.freeze({ ...DEFAULT_AUTH, ...(raw.auth && typeof raw.auth === 'object' ? raw.auth : {}) }),
    syncEndpoints: Object.freeze({
      ...DEFAULT_SYNC_ENDPOINTS,
      ...(raw.syncEndpoints && typeof raw.syncEndpoints === 'object' ? raw.syncEndpoints : {}),
    }),
    timeouts: Object.freeze({
      ...DEFAULT_TIMEOUTS,
      ...(raw.timeouts && typeof raw.timeouts === 'object' ? raw.timeouts : {}),
    }),
    modelMapping: Object.freeze(
      raw.modelMapping && typeof raw.modelMapping === 'object' ? { ...raw.modelMapping } : {}
    ),
  });
}

const BUILTIN_PROVIDER_DEFS = [
  {
    providerId: 'openai-official',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    appendV1: true,
    channel: 'openai-official',
    upstreamBackend: 'openai-official',
    priority: 30,
    textAdapterId: 'openai-official',
    imageAdapterId: 'openai-official',
    adapterIds: ['openai-official'],
    asyncCapable: false,
  },
  {
    providerId: 'toapis',
    label: 'ToAPIs',
    defaultBaseUrl: 'https://toapis.com/v1',
    appendV1: true,
    channel: 'toapis-openai',
    upstreamBackend: 'toapis-openai',
    priority: 40,
    textAdapterId: 'toapis-openai',
    imageAdapterId: 'toapis-openai',
    adapterIds: ['toapis-openai'],
    asyncCapable: true,
  },
  {
    providerId: '302ai',
    label: '302.AI',
    defaultBaseUrl: 'https://api.302.ai/v1',
    appendV1: true,
    channel: '302ai-openai',
    upstreamBackend: '302ai-openai',
    priority: 42,
    textAdapterId: '302ai-openai',
    imageAdapterId: '302ai-openai',
    adapterIds: ['302ai-openai'],
    asyncCapable: true,
  },
  {
    providerId: 'aihubmix',
    label: 'AIHubMix',
    defaultBaseUrl: 'https://aihubmix.com/v1',
    appendV1: true,
    channel: 'aihubmix-openai',
    upstreamBackend: 'aihubmix-openai',
    priority: 43,
    textAdapterId: 'aihubmix-openai',
    imageAdapterId: 'aihubmix-openai',
    adapterIds: ['aihubmix-openai'],
    asyncCapable: true,
  },
  {
    providerId: 'tinysnow',
    label: 'TinySnow',
    defaultBaseUrl: 'https://tinysnow.one/v1',
    appendV1: true,
    channel: 'tinysnow-openai',
    upstreamBackend: 'tinysnow-openai',
    priority: 45,
    textAdapterId: 'tinysnow-openai',
    imageAdapterId: 'tinysnow-openai',
    adapterIds: ['tinysnow-openai'],
    asyncCapable: true,
  },
  {
    providerId: 'volcengine-ark',
    label: 'Volcengine Ark',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    appendV1: false,
    channel: 'volcengine-ark',
    upstreamBackend: 'volcengine-ark',
    priority: 35,
    textAdapterId: 'volcengine-ark-openai',
    imageAdapterId: 'volcengine-ark-image',
    adapterIds: ['volcengine-ark-openai', 'volcengine-ark-image'],
    asyncCapable: false,
    syncEndpoints: {
      text: '/chat/completions',
      imageGenerate: '/images/generations',
      imageEdit: '/images/generations',
    },
  },
];

export const OPENAI_COMPATIBLE_PROVIDER_CONFIG = Object.freeze(
  Object.fromEntries(BUILTIN_PROVIDER_DEFS.map((def) => [def.providerId, freezeProviderConfig(def)]))
);

/** Runtime overlays for ops/tests: add aggregator without a new adapter file. */
const runtimeProviderOverrides = new Map();

function rebuildAdapterIndex() {
  const map = new Map();
  for (const config of openAiCompatibleProviderConfigs()) {
    for (const adapterId of config.adapterIds) {
      map.set(adapterId, config);
    }
  }
  return map;
}

let CONFIG_BY_ADAPTER_ID = rebuildAdapterIndex();

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function registerOpenAiCompatibleProvider(raw) {
  const config = freezeProviderConfig(raw);
  runtimeProviderOverrides.set(config.providerId, config);
  CONFIG_BY_ADAPTER_ID = rebuildAdapterIndex();
  return config;
}

/**
 * A2: apply ops-persisted OpenAI-compatible aggregator configs (no new adapter file).
 * Resets runtime overlays then registers each row; optional providerOverrides patch baseUrl/timeout.
 */
export function applyOpenAiCompatibleProvidersFromOps(modelOpsConfig = {}) {
  resetOpenAiCompatibleProviderOverrides();
  const rows = Array.isArray(modelOpsConfig?.openAiCompatibleProviders)
    ? modelOpsConfig.openAiCompatibleProviders
    : [];
  const registered = [];
  for (const row of rows) {
    try {
      registered.push(registerOpenAiCompatibleProvider(row));
    } catch {
      // skip invalid rows; normalize layer should already filter most
    }
  }
  const overrides = Array.isArray(modelOpsConfig?.providerOverrides) ? modelOpsConfig.providerOverrides : [];
  for (const override of overrides) {
    const providerId = nonEmptyString(override?.providerId);
    if (!providerId) continue;
    const current = openAiCompatibleConfigForProvider(providerId);
    if (!current) continue;
    const baseUrl = nonEmptyString(override?.baseUrl);
    const requestTimeoutMs = Number(override?.requestTimeoutMs);
    if (!baseUrl && !(Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0)) continue;
    registered.push(
      registerOpenAiCompatibleProvider({
        ...current,
        ...(baseUrl ? { defaultBaseUrl: baseUrl } : {}),
        timeouts: {
          ...current.timeouts,
          ...(Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0
            ? { requestMs: Math.floor(requestTimeoutMs) }
            : {}),
        },
      })
    );
  }
  return registered;
}

export function unregisterOpenAiCompatibleProvider(providerId) {
  const removed = runtimeProviderOverrides.delete(nonEmptyString(providerId));
  if (removed) CONFIG_BY_ADAPTER_ID = rebuildAdapterIndex();
  return removed;
}

export function resetOpenAiCompatibleProviderOverrides() {
  runtimeProviderOverrides.clear();
  CONFIG_BY_ADAPTER_ID = rebuildAdapterIndex();
}

export function openAiCompatibleConfigForProvider(providerId) {
  const id = nonEmptyString(providerId);
  if (!id) return null;
  return runtimeProviderOverrides.get(id) || OPENAI_COMPATIBLE_PROVIDER_CONFIG[id] || null;
}

export function openAiCompatibleConfigForAdapter(adapterId) {
  return CONFIG_BY_ADAPTER_ID.get(nonEmptyString(adapterId)) || null;
}

export function isOpenAiCompatibleAdapterId(adapterId) {
  return Boolean(openAiCompatibleConfigForAdapter(adapterId));
}

export function isOpenAiCompatibleAsyncProvider(providerId) {
  return openAiCompatibleConfigForProvider(providerId)?.asyncCapable === true;
}

export function openAiCompatibleAsyncProviderIds() {
  return openAiCompatibleProviderConfigs()
    .filter((config) => config.asyncCapable)
    .map((config) => config.providerId);
}

export function openAiCompatibleProviderConfigs() {
  const byId = new Map(Object.entries(OPENAI_COMPATIBLE_PROVIDER_CONFIG));
  for (const [id, config] of runtimeProviderOverrides.entries()) {
    byId.set(id, config);
  }
  return [...byId.values()].sort((a, b) => a.priority - b.priority || a.providerId.localeCompare(b.providerId));
}

export function openAiCompatibleSyncProviderIds() {
  return openAiCompatibleProviderConfigs().map((config) => config.providerId);
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

export function resolveOpenAiCompatibleProviderId(value) {
  const raw = nonEmptyString(value);
  if (!raw) return '';
  if (openAiCompatibleConfigForProvider(raw)) return raw;
  const asAdapter = openAiCompatibleConfigForAdapter(raw);
  if (asAdapter) return asAdapter.providerId;
  const lower = raw.toLowerCase();
  for (const config of openAiCompatibleProviderConfigs()) {
    if (config.channel === raw || config.channel === lower) return config.providerId;
    if (config.upstreamBackend === raw || config.upstreamBackend === lower) return config.providerId;
    if (config.adapterIds.includes(raw) || config.adapterIds.includes(lower)) return config.providerId;
  }
  return '';
}

export function openAiCompatibleTimeoutsForProvider(providerId) {
  return openAiCompatibleConfigForProvider(providerId)?.timeouts || DEFAULT_TIMEOUTS;
}

export function openAiCompatibleSyncEndpointsForProvider(providerId) {
  return openAiCompatibleConfigForProvider(providerId)?.syncEndpoints || DEFAULT_SYNC_ENDPOINTS;
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
