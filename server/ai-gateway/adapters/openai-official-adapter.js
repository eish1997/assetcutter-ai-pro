import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { AiGatewayValidationError } from '../job.js';
import { finalizeAiGatewayTerminalPlan } from '../execution-finalize.js';
import { buildProviderTaskUsage, collectByteSize } from '../execution-usage.js';
import { resolveAiGatewayBillingSku } from '../route-billing.js';
import { normalizeInlineBase64Data } from '../inline-data-normalize.js';
import {
  defaultOpenAiCompatibleBaseUrl,
  isOpenAiCompatibleAdapterId,
  normalizeOpenAiCompatibleBaseUrl,
  openAiCompatibleProviderLabel,
} from '../openai-compatible-config.js';
import { acquireProviderKey, recordProviderKeyError, recordProviderKeySuccess } from '../provider-key-store.js';

const OPENAI_PROVIDER_ID = 'openai-official';
const GPT_IMAGE_MAX_REFERENCE_IMAGES = 16;
const GPT_IMAGE2_DEFAULT_TIMEOUT_MS = 600_000;
const GPT_IMAGE2_MAX_LONG_EDGE = 3840;
const GPT_IMAGE2_MIN_TOTAL_PIXELS = 655_360;
const GPT_IMAGE2_MAX_TOTAL_PIXELS = 8_294_400;
const GPT_IMAGE2_DEFAULT_LONG_EDGE = 1536;
const VOLCENGINE_ARK_TEXT_MODEL_MAP = Object.freeze({
  'doubao-seed-2-0-pro': 'doubao-seed-2-0-pro-260215',
  'doubao-seed-2-0-lite': 'doubao-seed-2-0-lite-260428',
  'doubao-seed-2-0-mini': 'doubao-seed-2-0-mini-260428',
  'doubao-seed-2-0-vision': 'doubao-seed-2-0-vision-260215',
});
const VOLCENGINE_ARK_IMAGE_MODEL_MAP = Object.freeze({
  'doubao-seedream-5-0-pro': 'doubao-seedream-5-0-pro-260628',
  'doubao-seedream-5-0': 'doubao-seedream-5-0-260128',
  'doubao-seedream-5-0-lite': 'doubao-seedream-5-0-lite-260128',
});
const VOLCENGINE_ARK_IMAGE_MIN_PIXELS = 3_686_400;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function defaultBaseUrlForProvider(providerId) {
  return defaultOpenAiCompatibleBaseUrl(providerId);
}

function normalizeBaseUrl(value, providerId = OPENAI_PROVIDER_ID) {
  return normalizeOpenAiCompatibleBaseUrl(value, providerId);
}

function mapOpenAiChatModel(value, providerId = OPENAI_PROVIDER_ID) {
  const model = nonEmptyString(value);
  if (providerId === 'volcengine-ark') {
    if (!model) return VOLCENGINE_ARK_TEXT_MODEL_MAP['doubao-seed-2-0-pro'];
    return VOLCENGINE_ARK_TEXT_MODEL_MAP[model] || model;
  }
  if (!model) return 'gpt-4o-mini';
  const lower = model.toLowerCase();
  if (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4')) return model;
  return 'gpt-4o-mini';
}

function mapOpenAiImageModel(value, providerId = OPENAI_PROVIDER_ID) {
  const model = nonEmptyString(value);
  if (providerId === 'volcengine-ark') {
    if (!model) return VOLCENGINE_ARK_IMAGE_MODEL_MAP['doubao-seedream-5-0'];
    return VOLCENGINE_ARK_IMAGE_MODEL_MAP[model] || model;
  }
  if (!model) return 'gpt-image-1.5';
  const lower = model.toLowerCase();
  if (lower === 'gpt-image-1' || lower.startsWith('dall-e')) return 'gpt-image-1.5';
  if (lower.includes('gpt-image')) return model;
  return 'gpt-image-1.5';
}

function isImageModel(value) {
  const lower = nonEmptyString(value).toLowerCase();
  return lower.includes('gpt-image') || lower.startsWith('dall-e');
}

function resolveOutboundProxyUrl() {
  return nonEmptyString(process.env.OPENAI_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.TRIPO_PROXY);
}

function buildFetchOptionsWithProxy(init, baseUrl) {
  const proxyUrl = resolveOutboundProxyUrl();
  if (!proxyUrl) return init;
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return init;
  } catch {
    return init;
  }
  return { ...init, dispatcher: new ProxyAgent(proxyUrl) };
}

function isGptImage2Model(value) {
  const lower = nonEmptyString(value).toLowerCase();
  return lower === 'gpt-image-2' || lower.startsWith('gpt-image-2-');
}

function parseAspectRatioParts(aspect) {
  const parts = nonEmptyString(aspect || '1:1').split(':');
  if (parts.length !== 2) return { rw: 1, rh: 1 };
  const rw = Number(parts[0]);
  const rh = Number(parts[1]);
  if (!Number.isFinite(rw) || !Number.isFinite(rh) || rw <= 0 || rh <= 0) return { rw: 1, rh: 1 };
  return { rw, rh };
}

function roundGptImage2Dimension(value) {
  return Math.max(16, Math.round(value / 16) * 16);
}

function gptImage2TargetPixelsFromImageSize(imageSize) {
  const s = nonEmptyString(imageSize).toUpperCase();
  if (s === '1K') return 1_048_576;
  if (s === '2K') return 3_686_400;
  if (s === '4K') return GPT_IMAGE2_MAX_TOTAL_PIXELS;
  return null;
}

function finalizeGptImage2Dimensions(width, height) {
  let w = width;
  let h = height;
  for (let i = 0; i < 4; i += 1) {
    const maxDim = Math.max(w, h);
    if (maxDim > GPT_IMAGE2_MAX_LONG_EDGE) {
      const scale = GPT_IMAGE2_MAX_LONG_EDGE / maxDim;
      w *= scale;
      h *= scale;
    }
    w = roundGptImage2Dimension(w);
    h = roundGptImage2Dimension(h);
    const pixels = w * h;
    if (pixels >= GPT_IMAGE2_MIN_TOTAL_PIXELS && pixels <= GPT_IMAGE2_MAX_TOTAL_PIXELS) break;
    const target = Math.max(GPT_IMAGE2_MIN_TOTAL_PIXELS, Math.min(GPT_IMAGE2_MAX_TOTAL_PIXELS, pixels));
    const scale = Math.sqrt(target / Math.max(1, pixels));
    w *= scale;
    h *= scale;
  }
  return { width: roundGptImage2Dimension(w), height: roundGptImage2Dimension(h) };
}

function aspectRatioToGptImage2Size(aspectRatio, imageSize) {
  const { rw, rh } = parseAspectRatioParts(aspectRatio);
  const targetPixels = gptImage2TargetPixelsFromImageSize(imageSize);
  const width =
    targetPixels != null
      ? Math.sqrt((targetPixels * rw) / rh)
      : rw >= rh
        ? GPT_IMAGE2_DEFAULT_LONG_EDGE
        : (GPT_IMAGE2_DEFAULT_LONG_EDGE * rw) / rh;
  const height =
    targetPixels != null
      ? Math.sqrt((targetPixels * rh) / rw)
      : rw >= rh
        ? (GPT_IMAGE2_DEFAULT_LONG_EDGE * rh) / rw
        : GPT_IMAGE2_DEFAULT_LONG_EDGE;
  const out = finalizeGptImage2Dimensions(width, height);
  return `${out.width}x${out.height}`;
}

function resolveOpenAiImageSize(model, imageConfig) {
  const explicit = nonEmptyString(imageConfig.size);
  if (explicit && !/^[124]K$/i.test(explicit)) return explicit;
  if (isGptImage2Model(model)) {
    return aspectRatioToGptImage2Size(imageConfig.aspectRatio, nonEmptyString(imageConfig.imageSize) || explicit);
  }
  return explicit || '1024x1024';
}

function resolveOpenAiRequestTimeoutMs(plan, options = {}, providerKey = null) {
  const explicit = Number(options.timeoutMs || providerKey?.credentials?.requestTimeoutMs || process.env.AI_GATEWAY_OPENAI_TIMEOUT_MS || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const requestModel = plan?.workerRequest?.body?.model || plan?.adapterRequest?.body?.model || plan?.job?.model;
  return isGptImage2Model(requestModel) ? GPT_IMAGE2_DEFAULT_TIMEOUT_MS : 120_000;
}

function textFromContents(contents) {
  const turns = Array.isArray(contents)
    ? contents
    : contents && typeof contents === 'object' && Array.isArray(contents.parts)
      ? [{ role: 'user', parts: contents.parts }]
      : [{ role: 'user', parts: [{ text: String(contents ?? '') }] }];
  const messages = [];
  const textPieces = [];
  const inlineImages = [];
  for (const turn of turns) {
    const role = turn?.role === 'model' || turn?.role === 'assistant' ? 'assistant' : 'user';
    const parts = Array.isArray(turn?.parts) ? turn.parts : [];
    const content = [];
    for (const part of parts) {
      if (part?.text != null) {
        const text = String(part.text);
        textPieces.push(text);
        content.push({ type: 'text', text });
      }
      if (part?.inlineData?.data) {
        const rawData = nonEmptyString(part.inlineData.data);
        const dataUrlMatch = rawData.match(/^data:([^;,]+);base64,/i);
        const mime = nonEmptyString(dataUrlMatch?.[1]) || nonEmptyString(part.inlineData.mimeType) || 'image/png';
        const data = normalizeInlineBase64Data(rawData);
        const dataUrl = `data:${mime};base64,${data}`;
        inlineImages.push(dataUrl);
        content.push({ type: 'image_url', image_url: { url: dataUrl } });
      }
    }
    if (content.length === 1 && content[0].type === 'text') messages.push({ role, content: content[0].text });
    else if (content.length) messages.push({ role, content });
  }
  return {
    messages: messages.length ? messages : [{ role: 'user', content: String(contents ?? '') }],
    text: textPieces.join('\n').trim(),
    inlineImages,
  };
}

function buildOpenAiTextBody(job, route) {
  const input = job?.input && typeof job.input === 'object' ? job.input : {};
  const config = input.config && typeof input.config === 'object' ? input.config : {};
  const parsed = textFromContents(input.contents ?? input.prompt ?? input.text ?? '');
  const messages = [];
  if (nonEmptyString(config.systemInstruction)) messages.push({ role: 'system', content: nonEmptyString(config.systemInstruction) });
  messages.push(...parsed.messages);
  return {
    model: mapOpenAiChatModel(input.upstreamModelId || input.model || job?.model, route?.providerId),
    messages,
    stream: false,
    ...(config.responseMimeType === 'application/json' ? { response_format: { type: 'json_object' } } : {}),
  };
}

function aspectRatioToArkSize(aspectRatio) {
  const raw = nonEmptyString(aspectRatio);
  if (raw === '16:9') return '2560x1440';
  if (raw === '9:16') return '1440x2560';
  if (raw === '4:3') return '2304x1728';
  if (raw === '3:4') return '1728x2304';
  if (raw === '3:2') return '2496x1664';
  if (raw === '2:3') return '1664x2496';
  return '1920x1920';
}

function normalizeArkImageSize(size, aspectRatio) {
  const explicit = nonEmptyString(size);
  const raw = explicit || aspectRatioToArkSize(aspectRatio);
  const m = /^(\d{2,5})x(\d{2,5})$/i.exec(raw);
  if (!m) return aspectRatioToArkSize(aspectRatio);
  const width = Math.max(1, Number(m[1]));
  const height = Math.max(1, Number(m[2]));
  if (width * height >= VOLCENGINE_ARK_IMAGE_MIN_PIXELS) return `${width}x${height}`;
  const scale = Math.sqrt(VOLCENGINE_ARK_IMAGE_MIN_PIXELS / (width * height));
  return `${Math.ceil(width * scale)}x${Math.ceil(height * scale)}`;
}

function buildArkImageBody(job) {
  const input = job?.input && typeof job.input === 'object' ? job.input : {};
  const config = input.config && typeof input.config === 'object' ? input.config : {};
  const imageConfig = config.imageConfig && typeof config.imageConfig === 'object' ? config.imageConfig : {};
  const parsed = textFromContents(input.contents ?? input.prompt ?? input.text ?? '');
  const prompt = nonEmptyString(input.prompt) || [nonEmptyString(config.systemInstruction), parsed.text].filter(Boolean).join('\n\n').trim();
  if (!prompt) {
    throw new AiGatewayValidationError('Volcengine Ark image generation requires a prompt', 'AI_GATEWAY_ARK_PROMPT_REQUIRED');
  }
  const size = normalizeArkImageSize(imageConfig.size, imageConfig.aspectRatio);
  return {
    model: mapOpenAiImageModel(input.upstreamModelId || input.model || job?.model, 'volcengine-ark'),
    prompt: prompt.slice(0, 32000),
    size,
    response_format: 'b64_json',
    ...(parsed.inlineImages.length
      ? { image: parsed.inlineImages[0], images: parsed.inlineImages.slice(0, GPT_IMAGE_MAX_REFERENCE_IMAGES) }
      : {}),
  };
}

function buildOpenAiImageBody(job, route) {
  if (route?.providerId === 'volcengine-ark') return buildArkImageBody(job);
  const input = job?.input && typeof job.input === 'object' ? job.input : {};
  const config = input.config && typeof input.config === 'object' ? input.config : {};
  const imageConfig = config.imageConfig && typeof config.imageConfig === 'object' ? config.imageConfig : {};
  const parsed = textFromContents(input.contents ?? input.prompt ?? input.text ?? '');
  const prompt = nonEmptyString(input.prompt) || [nonEmptyString(config.systemInstruction), parsed.text].filter(Boolean).join('\n\n').trim();
  if (!prompt) {
    throw new AiGatewayValidationError('OpenAI image generation requires a prompt', 'AI_GATEWAY_OPENAI_PROMPT_REQUIRED');
  }
  const model = mapOpenAiImageModel(input.upstreamModelId || input.model || job?.model, route?.providerId);
  return {
    model,
    prompt: prompt.slice(0, 32000),
    n: 1,
    size: resolveOpenAiImageSize(model, imageConfig),
    quality: nonEmptyString(imageConfig.quality) || 'auto',
    output_format: 'png',
    ...(parsed.inlineImages.length
      ? { images: parsed.inlineImages.slice(0, GPT_IMAGE_MAX_REFERENCE_IMAGES).map((imageUrl) => ({ image_url: imageUrl })) }
      : {}),
  };
}

function extFromMime(mimeType) {
  const mime = nonEmptyString(mimeType).toLowerCase();
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  return 'png';
}

function dataUrlToImageBlob(dataUrl, index) {
  const raw = nonEmptyString(dataUrl);
  const match = raw.match(/^data:([^;,]+);base64,(.+)$/is);
  if (!match) {
    throw new AiGatewayValidationError('OpenAI image edit requires data URL images', 'AI_GATEWAY_OPENAI_EDIT_IMAGE_INVALID');
  }
  const mimeType = nonEmptyString(match[1]) || 'image/png';
  const data = normalizeInlineBase64Data(match[2] || '');
  if (!data) {
    throw new AiGatewayValidationError('OpenAI image edit requires non-empty image bytes', 'AI_GATEWAY_OPENAI_EDIT_IMAGE_EMPTY');
  }
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length) {
    throw new AiGatewayValidationError('OpenAI image edit received invalid image bytes', 'AI_GATEWAY_OPENAI_EDIT_IMAGE_INVALID');
  }
  return {
    blob: new Blob([bytes], { type: mimeType }),
    filename: `image-${index + 1}.${extFromMime(mimeType)}`,
  };
}

function buildOpenAiImageEditFormData(body) {
  const form = new FormData();
  const images = Array.isArray(body?.images) ? body.images : [];
  const imageUrls = images
    .map((item) => nonEmptyString(item?.image_url || item?.url || item))
    .filter(Boolean)
    .slice(0, GPT_IMAGE_MAX_REFERENCE_IMAGES);
  if (!imageUrls.length) return null;
  for (const [key, value] of Object.entries(body || {})) {
    if (key === 'images' || value == null || value === '') continue;
    form.append(key, String(value));
  }
  imageUrls.forEach((imageUrl, index) => {
    const { blob, filename } = dataUrlToImageBlob(imageUrl, index);
    form.append('image[]', blob, filename);
  });
  return form;
}

function shouldUseMultipartImageEdit(providerId, requestPath) {
  return requestPath === '/images/edits' && providerId === OPENAI_PROVIDER_ID;
}

export function buildOpenAiOfficialRequest(job, route) {
  if (!isOpenAiCompatibleAdapterId(route?.adapterId)) {
    throw new AiGatewayValidationError(`Unsupported adapter for OpenAI: ${route?.adapterId || ''}`);
  }
  const image = job?.modality === 'image' || isImageModel(job?.model || job?.input?.model);
  const body = image ? buildOpenAiImageBody(job, route) : buildOpenAiTextBody(job, route);
  const arkImage = route?.providerId === 'volcengine-ark' && image;
  const requestPath = arkImage ? '/images/generations' : image && body.images ? '/images/edits' : image ? '/images/generations' : '/chat/completions';
  const multipartImageEdit = shouldUseMultipartImageEdit(route?.providerId, requestPath);
  return {
    method: 'POST',
    path: requestPath,
    providerBaseUrl: defaultBaseUrlForProvider(route?.providerId),
    body,
    headers: {
      ...(multipartImageEdit ? {} : { 'content-type': 'application/json' }),
      'x-ac-task-envelope': job.id,
      'x-ac-correlation-id': job.correlationId,
    },
  };
}

async function readJsonSafe(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function openAiErrorMessage(data, fallback = 'OpenAI request failed') {
  return (
    nonEmptyString(data?.error?.message) ||
    nonEmptyString(data?.message) ||
    nonEmptyString(data?.error) ||
    fallback
  );
}

function extractText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => nonEmptyString(part?.text) || nonEmptyString(part?.content)).filter(Boolean).join('\n');
  }
  return '';
}

function extractImageArtifacts(data, providerId = OPENAI_PROVIDER_ID) {
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows
    .map((row) => {
      const url = nonEmptyString(row?.url);
      if (url) return { kind: 'image', url, source: providerId };
      const b64 = nonEmptyString(row?.b64_json);
      if (b64) return { kind: 'image', url: `data:image/png;base64,${b64}`, source: providerId };
      return null;
    })
    .filter(Boolean);
}

export async function startOpenAiOfficialExecution(plan, options = {}) {
  const providerId = nonEmptyString(plan?.route?.providerId) || OPENAI_PROVIDER_ID;
  const providerLabel = openAiCompatibleProviderLabel(providerId);
  const key = await acquireProviderKey(providerId);
  if (!key?.secret) {
    throw new AiGatewayValidationError(`No enabled ${providerLabel} API key in AI Gateway provider key pool`, 'AI_GATEWAY_PROVIDER_KEY_MISSING');
  }
  const fetchImpl = options.fetchImpl || undiciFetch;
  const request = plan.workerRequest || plan.adapterRequest;
  const baseUrl = normalizeBaseUrl(key.credentials?.baseUrl, providerId);
  const multipartImageEdit = shouldUseMultipartImageEdit(providerId, request.path);
  const startedAtMs = Date.now();
  const running = options.store?.update
    ? await options.store.update(plan.job.id, {
        status: 'running',
        metadata: {
          gatewayExecution: {
            startedAt: new Date(startedAtMs).toISOString(),
            targetPath: request.path,
            providerKeyId: key.id,
          },
        },
      })
    : plan;
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${request.path}`, buildFetchOptionsWithProxy({
      method: request.method || 'POST',
      headers: {
        Authorization: `Bearer ${key.secret}`,
        ...(multipartImageEdit ? {} : { 'Content-Type': 'application/json' }),
      },
      body: multipartImageEdit ? buildOpenAiImageEditFormData(request.body || {}) : JSON.stringify(request.body || {}),
      signal: AbortSignal.timeout(resolveOpenAiRequestTimeoutMs(plan, options, key)),
    }, baseUrl));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const err = new Error(`${providerLabel} network unavailable: ${message || 'fetch failed'}`);
    recordProviderKeyError(key.id, err, {
      status: 0,
      reason: `${providerLabel} network unavailable`,
    });
    throw err;
  }
  const data = await readJsonSafe(response);
  if (!response.ok) {
    const err = new Error(`${providerLabel} rejected AI job handoff: HTTP ${response.status} ${openAiErrorMessage(data)}`);
    recordProviderKeyError(key.id, err, {
      status: response.status,
      cooldownMs: response.status === 429 || response.status >= 500 ? 60_000 : 0,
      reason: `${providerLabel} HTTP ${response.status}`,
    });
    throw err;
  }
  recordProviderKeySuccess(key.id);
  const completedAtMs = Date.now();
  const image = plan.job?.modality === 'image';
  const artifacts = image ? extractImageArtifacts(data, providerId) : [];
  const text = image ? '' : extractText(data);
  const usage = buildProviderTaskUsage(running || plan, {
    provider: providerId,
    billingSku: resolveAiGatewayBillingSku(running || plan),
    meterKind: image ? 'image' : 'token',
    unit: image ? 'image' : 'token',
    quantity: image ? Math.max(1, artifacts.length || 1) : Number(data?.usage?.total_tokens || 0),
    outputBytes: collectByteSize(data),
    artifactCount: artifacts.length,
    startedAtMs,
    completedAtMs,
  });
  const succeeded = options.store?.update
    ? await options.store.update(plan.job.id, {
        status: 'succeeded',
        output: {
          provider: providerId,
          model: request.body?.model || plan.job.model,
          ...(image ? { artifacts } : { text }),
          usage,
          raw: data,
        },
        artifacts,
        metadata: {
          usage,
          gatewayExecution: {
            completedAt: new Date(completedAtMs).toISOString(),
            durationMs: usage.durationMs,
            outputBytes: usage.outputBytes,
            artifactCount: artifacts.length,
          },
        },
      })
    : plan;
  await finalizeAiGatewayTerminalPlan(succeeded, options.store);
  return { started: true, upstreamJobId: data?.id || null, plan: succeeded || running || plan };
}
