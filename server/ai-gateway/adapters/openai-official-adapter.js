// FormData 必须用 undici 的：Node 全局 FormData 会被 undici fetch 当成字符串 → Content-Type: text/plain
import { fetch as undiciFetch, FormData, ProxyAgent } from 'undici';
import path from 'path';
import { AiGatewayValidationError } from '../job.js';
import { finalizeAiGatewayTerminalPlan } from '../execution-finalize.js';
import { applyAiGatewayAdapterResult, throwIfAdapterPlanTerminalFailed } from '../adapter-result.js';
import {
  buildProviderTaskUsage,
  collectByteSize,
  extractOpenAiStyleTokenUsage,
  extractProviderCostUsd,
} from '../execution-usage.js';
import { resolveAiGatewayBillingSku } from '../route-billing.js';
import { normalizeInlineBase64Data } from '../inline-data-normalize.js';
import {
  defaultOpenAiCompatibleBaseUrl,
  isOpenAiCompatibleAdapterId,
  normalizeOpenAiCompatibleBaseUrl,
  openAiCompatibleConfigForProvider,
  openAiCompatibleProviderLabel,
} from '../openai-compatible-config.js';
import { acquireProviderKey, recordProviderKeyError, recordProviderKeySuccess } from '../provider-key-store.js';
import { decorateErrorWithFailureReason } from '../failure-reason.js';

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

/** 302 / AIHubMix 等聚合商：保留站内 canonical model id，勿静默改成 GPT。 */
function shouldPassthroughCompatibleModel(providerId) {
  const id = nonEmptyString(providerId);
  if (!id || id === OPENAI_PROVIDER_ID) return false;
  return Boolean(openAiCompatibleConfigForProvider(id));
}

function resolveCompatibleModelMapping(model, providerId) {
  const config = openAiCompatibleConfigForProvider(providerId);
  return nonEmptyString(config?.modelMapping?.[model]);
}

function isGptImageFamilyModel(value) {
  const lower = nonEmptyString(value).toLowerCase();
  return lower.includes('gpt-image') || lower.startsWith('dall-e');
}

/** Gemini 原生生图族（含 flash/pro/preview）；聚合商应走 chat 多模态，而非 /images/* */
function isGeminiImageFamilyModel(value) {
  const lower = nonEmptyString(value).toLowerCase();
  return lower.includes('gemini') && lower.includes('image');
}

function isGeminiImageSizeTier(value) {
  return /^[124]K$/i.test(nonEmptyString(value));
}

/** 送上游前的图片必须已物化为 data URL；禁止 blob: 或「data:;base64,blob:…」假 payload */
function assertMaterializedImageDataUrl(dataUrl, code = 'AI_GATEWAY_OPENAI_EDIT_IMAGE_INVALID') {
  const raw = nonEmptyString(dataUrl);
  if (!raw) {
    throw new AiGatewayValidationError('Image payload is empty', code);
  }
  if (/^blob:/i.test(raw)) {
    throw new AiGatewayValidationError('Image payload must be materialized data URL (got blob URL)', code);
  }
  const match = raw.match(/^data:([^;,]+);base64,(.+)$/is);
  if (match) {
    const payload = normalizeInlineBase64Data(match[2] || '');
    if (!payload) {
      throw new AiGatewayValidationError('Image payload is empty', 'AI_GATEWAY_OPENAI_EDIT_IMAGE_EMPTY');
    }
    if (/^blob:/i.test(payload) || payload.includes('blob:http')) {
      throw new AiGatewayValidationError('Image payload contains unresolved blob URL inside data URL', code);
    }
    return raw;
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  throw new AiGatewayValidationError('Image payload must be a data URL', code);
}

function mapOpenAiChatModel(value, providerId = OPENAI_PROVIDER_ID) {
  const model = nonEmptyString(value);
  if (providerId === 'volcengine-ark') {
    if (!model) return VOLCENGINE_ARK_TEXT_MODEL_MAP['doubao-seed-2-0-pro'];
    return VOLCENGINE_ARK_TEXT_MODEL_MAP[model] || model;
  }
  if (!model) return 'gpt-4o-mini';
  const mapped = resolveCompatibleModelMapping(model, providerId);
  if (mapped) return mapped;
  if (shouldPassthroughCompatibleModel(providerId)) return model;
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
  const mapped = resolveCompatibleModelMapping(model, providerId);
  if (mapped) return mapped;
  if (shouldPassthroughCompatibleModel(providerId)) return model;
  const lower = model.toLowerCase();
  if (lower === 'gpt-image-1' || lower.startsWith('dall-e')) return 'gpt-image-1.5';
  if (lower.includes('gpt-image')) return model;
  return 'gpt-image-1.5';
}

function isImageModel(value) {
  return isGptImageFamilyModel(value);
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
  const requestModel =
    plan?.workerRequest?.body?.model || plan?.adapterRequest?.body?.model || plan?.job?.model;
  const modality = String(plan?.job?.modality || '').trim().toLowerCase();
  // 生图（含 302 Gemini native / gpt-image-2 / 其它 image modality）对齐客户端 600s；
  // 避免运营短 requestTimeoutMs（45–60s）或默认 120s 把慢图生图误杀成 network unavailable。
  const longImageJob =
    isGptImage2Model(requestModel) ||
    isGeminiImageFamilyModel(requestModel) ||
    modality === 'image';
  const floorMs = longImageJob ? GPT_IMAGE2_DEFAULT_TIMEOUT_MS : 120_000;
  const explicit = Number(
    options.timeoutMs ||
      providerKey?.credentials?.requestTimeoutMs ||
      process.env.AI_GATEWAY_OPENAI_TIMEOUT_MS ||
      0
  );
  if (Number.isFinite(explicit) && explicit > 0) {
    return longImageJob ? Math.max(explicit, floorMs) : explicit;
  }
  return floorMs;
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
        const dataUrl = assertMaterializedImageDataUrl(`data:${mime};base64,${data}`);
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

/** 302.AI 文档用 preview id；站内 canonical 需映射，否则会 503「当前无可用模型」 */
const GEMINI_IMAGE_UPSTREAM_MODEL_BY_PROVIDER = Object.freeze({
  '302ai': Object.freeze({
    'gemini-3-pro-image': 'gemini-3-pro-image-preview',
    'gemini-3-pro-image-preview': 'gemini-3-pro-image-preview',
    'gemini-2.5-flash-image': 'gemini-2.5-flash-image',
    'gemini-3.1-flash-image': 'gemini-3.1-flash-image-preview',
    'gemini-3.1-flash-image-preview': 'gemini-3.1-flash-image-preview',
    'gemini-3.1-flash-lite-image': 'gemini-3.1-flash-lite-image-preview',
    'gemini-3.1-flash-lite-image-preview': 'gemini-3.1-flash-lite-image-preview',
  }),
});

function resolveGeminiImageUpstreamModel(value, providerId) {
  const model = mapOpenAiImageModel(value, providerId);
  const mapped = GEMINI_IMAGE_UPSTREAM_MODEL_BY_PROVIDER[providerId]?.[model];
  return mapped || model;
}

function stripOpenAiV1Suffix(baseUrl) {
  return nonEmptyString(baseUrl).replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function usesGeminiNativeImageApi(providerId) {
  // 302 实测：Gemini 生图走 /google/v1/models/{model}；误走 /v1/chat/completions 会 503「无可用模型」
  return providerId === '302ai';
}

function buildGeminiNativeImagePartsFromContents(contents) {
  const turns = Array.isArray(contents) ? contents : [];
  const out = [];
  for (const turn of turns) {
    const parts = [];
    for (const part of Array.isArray(turn?.parts) ? turn.parts : []) {
      if (part?.text != null && String(part.text).length) {
        parts.push({ text: String(part.text) });
      }
      if (part?.inlineData?.data) {
        const rawData = nonEmptyString(part.inlineData.data);
        const dataUrlMatch = rawData.match(/^data:([^;,]+);base64,/i);
        const mime = nonEmptyString(dataUrlMatch?.[1]) || nonEmptyString(part.inlineData.mimeType) || 'image/png';
        const data = normalizeInlineBase64Data(rawData);
        const dataUrl = assertMaterializedImageDataUrl(`data:${mime};base64,${data}`);
        const matched = dataUrl.match(/^data:([^;,]+);base64,(.+)$/is);
        parts.push({
          inline_data: {
            mime_type: nonEmptyString(matched?.[1]) || mime,
            data: normalizeInlineBase64Data(matched?.[2] || ''),
          },
        });
      }
    }
    if (parts.length) {
      out.push({
        role: turn?.role === 'model' || turn?.role === 'assistant' ? 'model' : 'user',
        parts,
      });
    }
  }
  return out;
}

/**
 * 302.AI Gemini 生图：Google 原生格式 POST /google/v1/models/{model}
 * （contents + generationConfig.responseModalities）；勿走 /images/* 或 /chat/completions。
 */
function buildGeminiNativeImageBody(job, route) {
  const input = job?.input && typeof job.input === 'object' ? job.input : {};
  const config = input.config && typeof input.config === 'object' ? input.config : {};
  const imageConfig = config.imageConfig && typeof config.imageConfig === 'object' ? config.imageConfig : {};
  const upstreamModel = resolveGeminiImageUpstreamModel(
    input.upstreamModelId || input.model || job?.model,
    route?.providerId
  );
  let contents = buildGeminiNativeImagePartsFromContents(input.contents);
  if (!contents.length) {
    const parsed = textFromContents(input.contents ?? input.prompt ?? input.text ?? '');
    const prompt =
      nonEmptyString(input.prompt) ||
      [nonEmptyString(config.systemInstruction), parsed.text].filter(Boolean).join('\n\n').trim();
    if (!prompt) {
      throw new AiGatewayValidationError('Gemini image generation requires a prompt', 'AI_GATEWAY_OPENAI_PROMPT_REQUIRED');
    }
    const parts = [{ text: prompt.slice(0, 32000) }];
    for (const imageUrl of parsed.inlineImages.slice(0, GPT_IMAGE_MAX_REFERENCE_IMAGES)) {
      const dataUrl = assertMaterializedImageDataUrl(imageUrl);
      const matched = dataUrl.match(/^data:([^;,]+);base64,(.+)$/is);
      parts.push({
        inline_data: {
          mime_type: nonEmptyString(matched?.[1]) || 'image/png',
          data: normalizeInlineBase64Data(matched?.[2] || ''),
        },
      });
    }
    contents = [{ role: 'user', parts }];
  }
  const aspectRatio = nonEmptyString(imageConfig.aspectRatio);
  const imageSizeTier = isGeminiImageSizeTier(imageConfig.imageSize)
    ? nonEmptyString(imageConfig.imageSize).toUpperCase()
    : isGeminiImageSizeTier(imageConfig.size)
      ? nonEmptyString(imageConfig.size).toUpperCase()
      : '';
  return {
    // 供网关日志/计费；真正上游 path 带 model，body 里不依赖该字段
    model: upstreamModel,
    apiFlavor: 'gemini-native',
    contents,
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      // 302 对 snake_case imageConfig 偶发返回 HTTP 200 + candidates:[]（无图）；用 Google 官方 camelCase
      ...(aspectRatio || imageSizeTier
        ? {
            imageConfig: {
              ...(aspectRatio ? { aspectRatio } : {}),
              ...(imageSizeTier ? { imageSize: imageSizeTier } : {}),
            },
          }
        : {}),
    },
  };
}

/**
 * 其它 OpenAI 兼容聚合商上的 Gemini 生图：chat/completions + modalities。
 */
function buildGeminiChatImageBody(job, route) {
  const input = job?.input && typeof job.input === 'object' ? job.input : {};
  const config = input.config && typeof input.config === 'object' ? input.config : {};
  const imageConfig = config.imageConfig && typeof config.imageConfig === 'object' ? config.imageConfig : {};
  const parsed = textFromContents(input.contents ?? input.prompt ?? input.text ?? '');
  const prompt = nonEmptyString(input.prompt) || [nonEmptyString(config.systemInstruction), parsed.text].filter(Boolean).join('\n\n').trim();
  if (!prompt && !parsed.messages.length) {
    throw new AiGatewayValidationError('Gemini image generation requires a prompt', 'AI_GATEWAY_OPENAI_PROMPT_REQUIRED');
  }
  const model = mapOpenAiImageModel(input.upstreamModelId || input.model || job?.model, route?.providerId);
  const messages = [];
  if (nonEmptyString(config.systemInstruction)) {
    messages.push({ role: 'system', content: nonEmptyString(config.systemInstruction) });
  }
  if (parsed.messages.length) {
    messages.push(...parsed.messages);
  } else {
    messages.push({ role: 'user', content: prompt.slice(0, 32000) });
  }
  const aspectRatio = nonEmptyString(imageConfig.aspectRatio);
  const imageSizeTier = isGeminiImageSizeTier(imageConfig.imageSize)
    ? nonEmptyString(imageConfig.imageSize).toUpperCase()
    : isGeminiImageSizeTier(imageConfig.size)
      ? nonEmptyString(imageConfig.size).toUpperCase()
      : '';
  return {
    model,
    messages,
    stream: false,
    modalities: ['text', 'image'],
    ...(aspectRatio || imageSizeTier
      ? {
          image_config: {
            ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
            ...(imageSizeTier ? { image_size: imageSizeTier } : {}),
          },
        }
      : {}),
  };
}

function buildOpenAiImageBody(job, route) {
  if (route?.providerId === 'volcengine-ark') return buildArkImageBody(job);
  const input = job?.input && typeof job.input === 'object' ? job.input : {};
  const model = mapOpenAiImageModel(input.upstreamModelId || input.model || job?.model, route?.providerId);
  // 模型家族决定 API 形状；provider 只决定 baseUrl/auth（官方 OpenAI 仍 remap 到 gpt-image）
  if (isGeminiImageFamilyModel(model) && shouldPassthroughCompatibleModel(route?.providerId)) {
    if (usesGeminiNativeImageApi(route?.providerId)) return buildGeminiNativeImageBody(job, route);
    return buildGeminiChatImageBody(job, route);
  }
  const config = input.config && typeof input.config === 'object' ? input.config : {};
  const imageConfig = config.imageConfig && typeof config.imageConfig === 'object' ? config.imageConfig : {};
  const parsed = textFromContents(input.contents ?? input.prompt ?? input.text ?? '');
  const prompt = nonEmptyString(input.prompt) || [nonEmptyString(config.systemInstruction), parsed.text].filter(Boolean).join('\n\n').trim();
  if (!prompt) {
    throw new AiGatewayValidationError('OpenAI image generation requires a prompt', 'AI_GATEWAY_OPENAI_PROMPT_REQUIRED');
  }
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
  const raw = assertMaterializedImageDataUrl(dataUrl);
  const match = raw.match(/^data:([^;,]+);base64,(.+)$/is);
  if (!match) {
    throw new AiGatewayValidationError('OpenAI image edit requires data URL images', 'AI_GATEWAY_OPENAI_EDIT_IMAGE_INVALID');
  }
  const mimeType = nonEmptyString(match[1]) || 'image/png';
  const data = normalizeInlineBase64Data(match[2] || '');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length) {
    throw new AiGatewayValidationError('OpenAI image edit received invalid image bytes', 'AI_GATEWAY_OPENAI_EDIT_IMAGE_INVALID');
  }
  return {
    blob: new Blob([bytes], { type: mimeType }),
    filename: `image-${index + 1}.${extFromMime(mimeType)}`,
  };
}

/** OpenAI 官方用 image[]；302.AI / AIHubMix 文档字段为 image（可多文件重复同名） */
function openAiImageEditFormFieldName(providerId) {
  return providerId === OPENAI_PROVIDER_ID ? 'image[]' : 'image';
}

function buildOpenAiImageEditFormData(body, providerId = OPENAI_PROVIDER_ID) {
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
  const fieldName = openAiImageEditFormFieldName(providerId);
  imageUrls.forEach((imageUrl, index) => {
    const { blob, filename } = dataUrlToImageBlob(imageUrl, index);
    form.append(fieldName, blob, filename);
  });
  return form;
}

/**
 * `/images/edits` 必须 multipart：官方 OpenAI、302.AI、AIHubMix。
 * TinySnow 等仍走 JSON images[]（见测试）。
 */
function shouldUseMultipartImageEdit(providerId, requestPath) {
  if (requestPath !== '/images/edits') return false;
  return (
    providerId === OPENAI_PROVIDER_ID ||
    providerId === '302ai' ||
    providerId === 'aihubmix'
  );
}

export { mapOpenAiChatModel, mapOpenAiImageModel };

export function buildOpenAiOfficialRequest(job, route) {
  if (!isOpenAiCompatibleAdapterId(route?.adapterId)) {
    throw new AiGatewayValidationError(`Unsupported adapter for OpenAI: ${route?.adapterId || ''}`);
  }
  const image = job?.modality === 'image' || isImageModel(job?.model || job?.input?.model);
  const body = image ? buildOpenAiImageBody(job, route) : buildOpenAiTextBody(job, route);
  const arkImage = route?.providerId === 'volcengine-ark' && image;
  const geminiNativeImage = image && body?.apiFlavor === 'gemini-native' && nonEmptyString(body?.model);
  const geminiChatImage =
    image &&
    !geminiNativeImage &&
    Array.isArray(body?.modalities) &&
    body.modalities.includes('image') &&
    isGeminiImageFamilyModel(body?.model);
  const defaultBase = defaultBaseUrlForProvider(route?.providerId);
  const requestPath = arkImage
    ? '/images/generations'
    : geminiNativeImage
      ? `/google/v1/models/${encodeURIComponent(body.model)}`
      : geminiChatImage
        ? '/chat/completions'
        : image && body.images
          ? '/images/edits'
          : image
            ? '/images/generations'
            : '/chat/completions';
  const multipartImageEdit =
    !geminiNativeImage && !geminiChatImage && shouldUseMultipartImageEdit(route?.providerId, requestPath);
  const outboundBody = geminiNativeImage
    ? {
        contents: body.contents,
        generationConfig: body.generationConfig,
      }
    : body;
  return {
    method: 'POST',
    path: requestPath,
    // Google 原生路径挂在 api.302.ai 根上，不能带 /v1 前缀
    providerBaseUrl: geminiNativeImage ? stripOpenAiV1Suffix(defaultBase) : defaultBase,
    body: outboundBody,
    resolvedModel: nonEmptyString(body?.model) || undefined,
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

function normalizeImageArtifactUrl(raw) {
  const value = nonEmptyString(raw);
  if (!value) return '';
  if (value.startsWith('data:')) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (/^file\.302\.ai\//i.test(value) || /file\.302\.ai\//i.test(value)) {
    return `https://${value.replace(/^\/+/, '')}`;
  }
  return value;
}

function pushImageArtifact(out, url, providerId) {
  const value = normalizeImageArtifactUrl(url);
  if (!value) return;
  out.push({ kind: 'image', url: value, source: providerId });
}

function extractImageArtifactsFromChatMessage(message, providerId) {
  const out = [];
  if (!message || typeof message !== 'object') return out;
  const images = Array.isArray(message.images) ? message.images : [];
  for (const row of images) {
    pushImageArtifact(out, row?.url || row?.image_url?.url, providerId);
    const b64 = nonEmptyString(row?.b64_json);
    if (b64) {
      pushImageArtifact(out, b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`, providerId);
    }
  }
  const content = message.content;
  if (typeof content === 'string') {
    const dataUrls = content.match(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi) || [];
    for (const dataUrl of dataUrls) pushImageArtifact(out, dataUrl.replace(/\s+/g, ''), providerId);
    const mdUrls = content.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/gi) || [];
    for (const md of mdUrls) {
      const m = md.match(/\((https?:\/\/[^)\s]+)\)/i);
      pushImageArtifact(out, m?.[1], providerId);
    }
  } else if (Array.isArray(content)) {
    for (const part of content) {
      pushImageArtifact(out, part?.image_url?.url || part?.url, providerId);
      const inline = part?.inline_data || part?.inlineData;
      const b64 = nonEmptyString(inline?.data);
      if (b64) {
        const mime = nonEmptyString(inline?.mime_type || inline?.mimeType) || 'image/png';
        pushImageArtifact(out, b64.startsWith('data:') ? b64 : `data:${mime};base64,${b64}`, providerId);
      }
    }
  }
  return out;
}

function extractImageArtifactsFromGeminiCandidates(data, providerId) {
  const candidates = Array.isArray(data?.candidates)
    ? data.candidates
    : Array.isArray(data?.response?.candidates)
      ? data.response.candidates
      : [];
  const httpsOut = [];
  const inlineOut = [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const httpsUrl = normalizeImageArtifactUrl(
        part?.url || part?.fileData?.fileUri || part?.file_data?.file_uri
      );
      if (/^https?:\/\//i.test(httpsUrl)) pushImageArtifact(httpsOut, httpsUrl, providerId);
      const inline = part?.inlineData || part?.inline_data;
      const b64 = nonEmptyString(inline?.data);
      if (b64) {
        const mime = nonEmptyString(inline?.mimeType || inline?.mime_type) || 'image/png';
        pushImageArtifact(
          inlineOut,
          b64.startsWith('data:') ? b64 : `data:${mime};base64,${b64}`,
          providerId
        );
      }
      const text = typeof part?.text === 'string' ? part.text : '';
      if (text) {
        const mdUrls = text.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/gi) || [];
        for (const md of mdUrls) {
          const m = md.match(/\((https?:\/\/[^)\s]+)\)/i);
          pushImageArtifact(httpsOut, m?.[1], providerId);
        }
        const bare = text.match(/https?:\/\/file\.302\.ai\/[^\s)"']+/gi) || [];
        for (const u of bare) pushImageArtifact(httpsOut, u, providerId);
      }
    }
  }
  // 优先 https（落盘/下载友好），避免把数 MB inline base64 写入 job artifacts
  return httpsOut.length ? httpsOut : inlineOut;
}

function extractImageArtifacts(data, providerId = OPENAI_PROVIDER_ID) {
  const rows = Array.isArray(data?.data) ? data.data : [];
  const fromImagesApi = rows
    .map((row) => {
      const url = nonEmptyString(row?.url);
      if (url) return { kind: 'image', url, source: providerId };
      const b64 = nonEmptyString(row?.b64_json);
      if (b64) return { kind: 'image', url: `data:image/png;base64,${b64}`, source: providerId };
      return null;
    })
    .filter(Boolean);
  if (fromImagesApi.length) return fromImagesApi;

  const fromChat = extractImageArtifactsFromChatMessage(data?.choices?.[0]?.message, providerId);
  if (fromChat.length) return fromChat;

  return extractImageArtifactsFromGeminiCandidates(data, providerId);
}

function buildUpstreamEmptyImageError(data, artifacts, providerLabel, requestPath = '') {
  const candidatesLen = Array.isArray(data?.candidates)
    ? data.candidates.length
    : Array.isArray(data?.response?.candidates)
      ? data.response.candidates.length
      : 0;
  const finish = nonEmptyString(data?.candidates?.[0]?.finishReason);
  const pathHint = nonEmptyString(requestPath) ? ` path=${requestPath}` : '';
  const err = new Error(
    `${providerLabel} returned HTTP 200 but no image artifacts` +
      ` (candidates=${candidatesLen}${finish ? `, finishReason=${finish}` : ''}${pathHint}). Often a transient empty Gemini response; retry.`
  );
  err.status = 502;
  err.code = 'AI_GATEWAY_UPSTREAM_EMPTY_IMAGE';
  return err;
}

function assertGeminiNativeImageArtifacts(data, artifacts, providerLabel) {
  if (Array.isArray(artifacts) && artifacts.length > 0) return;
  throw buildUpstreamEmptyImageError(data, artifacts, providerLabel, '/google/');
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
  // 密钥配置的 OpenAI /v1 根；Gemini 原生 path 挂在去 /v1 后的站点根上
  const configuredBaseUrl = normalizeBaseUrl(key.credentials?.baseUrl, providerId);
  const baseUrl = String(request?.path || '').startsWith('/google/')
    ? stripOpenAiV1Suffix(configuredBaseUrl)
    : configuredBaseUrl;
  const multipartImageEdit = shouldUseMultipartImageEdit(providerId, request.path);
  // 校验/拼 body 必须在网络 try 之外，避免 AiGatewayValidationError 被误包成 network unavailable
  let requestBody;
  try {
    requestBody = multipartImageEdit
      ? buildOpenAiImageEditFormData(request.body || {}, providerId)
      : JSON.stringify(request.body || {});
  } catch (error) {
    if (error instanceof AiGatewayValidationError) {
      throw decorateErrorWithFailureReason(error, {
        adapterId: plan?.route?.adapterId,
        providerId,
      });
    }
    throw error;
  }
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
      body: requestBody,
      signal: AbortSignal.timeout(resolveOpenAiRequestTimeoutMs(plan, options, key)),
    }, baseUrl));
  } catch (error) {
    if (error instanceof AiGatewayValidationError) {
      throw decorateErrorWithFailureReason(error, {
        adapterId: plan?.route?.adapterId,
        providerId,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    const err = new Error(`${providerLabel} network unavailable: ${message || 'fetch failed'}`);
    err.status = 0;
    recordProviderKeyError(key.id, err, {
      status: 0,
      reason: `${providerLabel} network unavailable`,
    });
    throw decorateErrorWithFailureReason(err, {
      defaultCode: 'AI_GATEWAY_UPSTREAM_UNAVAILABLE',
      stage: 'upstream',
      adapterId: plan?.route?.adapterId,
      providerId,
    });
  }
  let data = await readJsonSafe(response);
  if (!response.ok) {
    const err = new Error(`${providerLabel} rejected AI job handoff: HTTP ${response.status} ${openAiErrorMessage(data)}`);
    err.status = response.status;
    recordProviderKeyError(key.id, err, {
      status: response.status,
      cooldownMs: response.status === 429 || response.status >= 500 ? 60_000 : 0,
      reason: `${providerLabel} HTTP ${response.status}`,
    });
    throw decorateErrorWithFailureReason(err, {
      adapterId: plan?.route?.adapterId,
      providerId,
      status: response.status,
    });
  }
  recordProviderKeySuccess(key.id);
  const completedAtMs = Date.now();
  const image = plan.job?.modality === 'image';
  let artifacts = image ? extractImageArtifacts(data, providerId) : [];
  // 302 Gemini 原生偶发 200 + candidates:[]；勿标 succeeded 以免掉进契约校验黑盒
  if (image && String(request?.path || '').startsWith('/google/')) {
    try {
      assertGeminiNativeImageArtifacts(data, artifacts, providerLabel);
    } catch (emptyErr) {
      // 单次瞬时空响应：立刻再打一枪（同 body）
      try {
        const retryResp = await fetchImpl(
          `${baseUrl}${request.path}`,
          buildFetchOptionsWithProxy(
            {
              method: request.method || 'POST',
              headers: {
                Authorization: `Bearer ${key.secret}`,
                ...(multipartImageEdit ? {} : { 'Content-Type': 'application/json' }),
              },
              body: requestBody,
              signal: AbortSignal.timeout(resolveOpenAiRequestTimeoutMs(plan, options, key)),
            },
            baseUrl
          )
        );
        const retryData = await readJsonSafe(retryResp);
        if (!retryResp.ok) {
          throw emptyErr;
        }
        artifacts = extractImageArtifacts(retryData, providerId);
        assertGeminiNativeImageArtifacts(retryData, artifacts, providerLabel);
        data = retryData;
      } catch (retryError) {
        const err = retryError?.code === 'AI_GATEWAY_UPSTREAM_EMPTY_IMAGE' ? retryError : emptyErr;
        recordProviderKeyError(key.id, err, {
          status: 502,
          cooldownMs: 5_000,
          reason: `${providerLabel} empty image artifacts`,
        });
        throw decorateErrorWithFailureReason(err, {
          defaultCode: 'AI_GATEWAY_UPSTREAM_EMPTY_IMAGE',
          stage: 'upstream',
          adapterId: plan?.route?.adapterId,
          providerId,
          status: 502,
        });
      }
    }
  }
  if (image && (!Array.isArray(artifacts) || artifacts.length === 0)) {
    const err = buildUpstreamEmptyImageError(data, artifacts, providerLabel, request?.path || '');
    recordProviderKeyError(key.id, err, {
      status: 502,
      cooldownMs: 5_000,
      reason: `${providerLabel} empty image artifacts`,
    });
    throw decorateErrorWithFailureReason(err, {
      defaultCode: 'AI_GATEWAY_UPSTREAM_EMPTY_IMAGE',
      stage: 'upstream',
      adapterId: plan?.route?.adapterId,
      providerId,
      status: 502,
    });
  }
  const text = image ? '' : extractText(data);
  const tokenUsage = extractOpenAiStyleTokenUsage(data);
  const providerCostUsd = extractProviderCostUsd(data);
  const usage = buildProviderTaskUsage(running || plan, {
    provider: providerId,
    billingSku: resolveAiGatewayBillingSku(running || plan),
    meterKind: image ? 'image' : 'token',
    unit: image ? 'image' : 'token',
    quantity: image
      ? Math.max(1, artifacts.length || 1)
      : tokenUsage?.totalTokens || Number(data?.usage?.total_tokens || 0),
    outputBytes: collectByteSize(data),
    artifactCount: artifacts.length,
    startedAtMs,
    completedAtMs,
    ...(providerCostUsd ? { costUsd: providerCostUsd } : {}),
    ...(tokenUsage
      ? {
          promptTokens: tokenUsage.promptTokens,
          completionTokens: tokenUsage.completionTokens,
          totalTokens: tokenUsage.totalTokens,
          usageMetadata: tokenUsage.usageMetadata,
        }
      : {}),
  });
  const { plan: terminal } = await applyAiGatewayAdapterResult(
    running || plan,
    {
      status: 'succeeded',
      upstreamTaskId: nonEmptyString(data?.id) || undefined,
      artifacts: image
        ? artifacts
        : text
          ? [{ kind: 'text', text, metadata: { source: providerId } }]
          : [],
      usage,
      output: {
        provider: providerId,
        model: request.resolvedModel || request.body?.model || plan.job.model,
        ...(image ? {} : { text }),
        raw: data,
      },
    },
    options.store,
    {
      modality: plan.job?.modality,
      metadata: {
        gatewayExecution: {
          completedAt: new Date(completedAtMs).toISOString(),
          durationMs: usage.durationMs,
          outputBytes: usage.outputBytes,
          artifactCount: artifacts.length,
        },
      },
    }
  );
  const finalized = await finalizeAiGatewayTerminalPlan(terminal, options.store);
  throwIfAdapterPlanTerminalFailed(finalized, {
    providerId,
    adapterId: plan?.route?.adapterId,
    workerId: plan?.route?.workerId,
  });
  return { started: true, upstreamJobId: data?.id || null, plan: finalized || running || plan };
}
