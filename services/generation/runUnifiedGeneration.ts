import { clearLastCreditsReserveKey, getCachedCreditsProxyHeaders } from '../creditsProxyBridge';
import { createAiJob, getMyAiJob, type AiJobDetail, type AiJobModality } from '../aiJobsClient';
import { resolveCanonicalModelId } from '../modelRegistry/canonicalModelCatalog';
import { pickBinding } from '../modelRegistry/pickBinding';
import { proxyGateMinCreditsForJob } from '../../shared/credits';
import { isAiTaskEnvelopeActive } from '../aiTaskEnvelope';
import type { ChannelId } from '../modelRegistry/types';
import { rememberAiGatewayImageResult } from '../aiGatewayImageResultRegistry';
import {
  dataUrlPayloadBytes,
  normalizeDataUrlForVisionApi,
} from '../workflowImageDataUrlCompress';

export type UnifiedGenerationModality = AiJobModality;

export type UnifiedGenerationRequest = {
  modality: UnifiedGenerationModality;
  capability: string;
  canonicalModelId: string;
  registryId?: string;
  upstreamModelId?: string;
  providerId?: string;
  input: Record<string, unknown>;
  assetContext?: {
    projectId?: string;
    sourceAssetId?: string;
    sourceAssetIds?: string[];
    currentPreviewAssetId?: string;
    referenceAssetIds?: string[];
  };
  uiSource: string;
  estimatedCredits?: number;
  metadata?: Record<string, unknown>;
  abortSignal?: AbortSignal;
};

export type UnifiedTextGenerationRequest = {
  prompt: string;
  model: string;
  systemInstruction?: string;
  uiSource: string;
  assetContext?: UnifiedGenerationRequest['assetContext'];
  estimatedCredits?: number;
  metadata?: Record<string, unknown>;
  abortSignal?: AbortSignal;
};

export type UnifiedVisionTextGenerationRequest = {
  prompt: string;
  model: string;
  images: string[];
  systemInstruction?: string;
  uiSource: string;
  assetContext?: UnifiedGenerationRequest['assetContext'];
  estimatedCredits?: number;
  metadata?: Record<string, unknown>;
  abortSignal?: AbortSignal;
};

export type UnifiedImageGenerationRequest = {
  prompt: string;
  canonicalModelId?: string;
  registryId?: string;
  model: string;
  upstreamModelId?: string;
  referenceImages?: string[];
  imageOptions?: {
    aspectRatio?: string;
    imageSize?: string;
    size?: string;
  };
  systemInstruction?: string;
  uiSource: string;
  assetContext?: UnifiedGenerationRequest['assetContext'];
  estimatedCredits?: number;
  metadata?: Record<string, unknown>;
  abortSignal?: AbortSignal;
};

function readEnv(name: string): string {
  try {
    const nodeEnv = typeof process !== 'undefined' ? process.env?.[name] : undefined;
    if (nodeEnv !== undefined) return String(nodeEnv).trim();
  } catch {
    /* ignore */
  }
  try {
    return String((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name] || '').trim();
  } catch {
    return '';
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function detailOutput(detail: AiJobDetail): Record<string, unknown> {
  return detail.job?.output && typeof detail.job.output === 'object'
    ? (detail.job.output as Record<string, unknown>)
    : {};
}

function extractText(detail: AiJobDetail): string | null {
  const output = detailOutput(detail);
  if (typeof output.text === 'string') return output.text;
  if (typeof output.content === 'string') return output.content;
  if (typeof output.resultText === 'string') return output.resultText;
  const artifacts = Array.isArray(detail.job?.artifacts) ? detail.job.artifacts : [];
  for (const artifact of artifacts) {
    const obj = artifact && typeof artifact === 'object' ? artifact : {};
    if (String(obj.kind || '').toLowerCase() !== 'text') continue;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.content === 'string') return obj.content;
  }
  return null;
}

function extractImageUrl(detail: AiJobDetail): string | null {
  const usable = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const s = value.trim();
    if (!s || /^\[REDACTED_/i.test(s)) return null;
    return s;
  };
  const isImageLikeArtifact = (obj: Record<string, unknown>): boolean => {
    const kind = String(obj.kind || obj.type || obj.mediaType || '').toLowerCase();
    if (kind === 'image' || kind === 'image_asset') return true;
    const mime = String(obj.mimeType || obj.mime || obj.contentType || '').toLowerCase();
    return mime.startsWith('image/');
  };
  const imageUrlFromObject = (obj: Record<string, unknown>): string | null => {
    for (const key of [
      'url',
      'imageUrl',
      'image_url',
      'dataUrl',
      'data_url',
      'publicUrl',
      'public_url',
      'previewUrl',
      'preview_url',
      'displayUrl',
      'display_url',
      'objectUrl',
      'downloadUrl',
      'fileUrl',
      'uri',
      'src',
      'href',
    ]) {
      const value = usable(obj[key]);
      if (value) return value;
    }
    const nestedImageUrl = obj.image_url && typeof obj.image_url === 'object'
      ? usable((obj.image_url as Record<string, unknown>).url)
      : null;
    if (nestedImageUrl) return nestedImageUrl;
    const fileDataUrl = obj.fileData && typeof obj.fileData === 'object'
      ? usable((obj.fileData as Record<string, unknown>).fileUri || (obj.fileData as Record<string, unknown>).url)
      : null;
    if (fileDataUrl) return fileDataUrl;
    return null;
  };
  const artifacts = Array.isArray(detail.job?.artifacts) ? detail.job.artifacts : [];
  for (const artifact of artifacts) {
    const obj = artifact && typeof artifact === 'object' ? artifact : {};
    if (!isImageLikeArtifact(obj as Record<string, unknown>)) continue;
    const url = imageUrlFromObject(obj as Record<string, unknown>);
    if (url) return url;
  }
  const output = detailOutput(detail);
  const outputArtifacts = Array.isArray(output.artifacts) ? output.artifacts : [];
  for (const artifact of outputArtifacts) {
    const obj = artifact && typeof artifact === 'object' ? artifact as Record<string, unknown> : {};
    if (!isImageLikeArtifact(obj)) continue;
    const url = imageUrlFromObject(obj);
    if (url) return url;
  }
  for (const key of ['imageUrl', 'image_url', 'url', 'dataUrl', 'data_url', 'publicUrl', 'previewUrl', 'displayUrl']) {
    const value = usable(output[key]);
    if (value) return value;
  }
  const outputImages = Array.isArray(output.images) ? output.images : [];
  for (const item of outputImages) {
    if (typeof item === 'string') {
      const value = usable(item);
      if (value) return value;
      continue;
    }
    const obj = item && typeof item === 'object' ? item as Record<string, unknown> : null;
    if (!obj) continue;
    const value = imageUrlFromObject(obj);
    if (value) return value;
  }
  return null;
}

function inlineDataFromDataUrl(input: string): { mimeType: string; data: string } | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const matched = raw.match(/^data:([^;,]+);base64,(.+)$/i);
  if (matched) return { mimeType: matched[1] || 'image/png', data: matched[2] || '' };
  const stripped = raw.replace(/\s/g, '');
  if (stripped.length >= 64 && /^[A-Za-z0-9+/]+=*$/.test(stripped)) {
    return { mimeType: 'image/png', data: stripped };
  }
  return null;
}

function terminalError(detail: AiJobDetail): Error {
  const msg = detail.job?.error?.message || 'AI Gateway generation job failed';
  return new Error(msg);
}

const AI_GATEWAY_IMAGE_REFERENCE_MAX_BYTES = 900 * 1024;

async function normalizeImageReferenceForGateway(input: string): Promise<string> {
  const raw = String(input || '').trim();
  if (!raw) return raw;
  const inline = inlineDataFromDataUrl(raw);
  if (!inline?.data) return raw;
  const normalized = await normalizeDataUrlForVisionApi(raw, AI_GATEWAY_IMAGE_REFERENCE_MAX_BYTES);
  if (dataUrlPayloadBytes(normalized) > AI_GATEWAY_IMAGE_REFERENCE_MAX_BYTES) {
    throw new Error('输入图片过大，已尝试压缩但仍超过网关请求上限；请缩小图片后重试');
  }
  return normalized;
}

function imageOutputDebug(detail: AiJobDetail): string {
  const artifacts = Array.isArray(detail.job?.artifacts) ? detail.job.artifacts : [];
  const output = detailOutput(detail);
  return `status=${detail.job?.status || 'unknown'} artifacts=${artifacts.length} outputKeys=${Object.keys(output).join(',') || '-'}`;
}

function gatewayJobKindForCapability(modality: UnifiedGenerationModality, capability: string): string {
  const cap = String(capability || '').trim();
  if (cap === 'workflow_text_to_image' || cap === 'image.generate') return 'workflow_text_to_image';
  if (cap === 'workflow_image_edit' || cap === 'image.edit') return 'workflow_image_edit';
  if (cap === 'workflow_generate_video' || cap === 'video.generate') return 'workflow_generate_video';
  if (cap === 'model3d.generate') return 'workflow_generate_3d';
  if (modality === 'text') return 'workflow_chat';
  if (modality === 'image') return 'workflow_text_to_image';
  if (modality === 'video') return 'workflow_generate_video';
  if (modality === 'model3d') return 'workflow_generate_3d';
  return cap || 'workflow_chat';
}

function defaultEstimatedCreditsForGateway(modality: UnifiedGenerationModality, capability: string): number {
  return Math.max(1, proxyGateMinCreditsForJob(gatewayJobKindForCapability(modality, capability)));
}

const GATEWAY_CHANNEL_PROVIDER: Partial<Record<ChannelId, string>> = {
  'vertex-proxy': 'vertex-site',
  'gemini-aistudio': 'gemini-aistudio',
  'toapis-gemini': 'toapis',
  vectorengine: 'vectorengine',
  'openai-official': 'openai-official',
  'tinysnow-openai': 'tinysnow',
  'toapis-openai': 'toapis',
  'volcengine-ark': 'volcengine-ark',
  'volcengine-jimeng': 'volcengine-jimeng',
};

function gatewayRoleForModality(modality: UnifiedGenerationModality): 'text' | 'image' | null {
  if (modality === 'text') return 'text';
  if (modality === 'image') return 'image';
  return null;
}

function inferGatewayProviderId(
  registryId: string,
  canonicalModelId: string,
  modality: UnifiedGenerationModality,
  explicitProviderId?: string
): string | undefined {
  const explicit = String(explicitProviderId || '').trim();
  if (explicit) return explicit;
  const role = gatewayRoleForModality(modality);
  if (!role) return undefined;
  const picked = pickBinding(registryId || canonicalModelId, role);
  const providerId = picked ? GATEWAY_CHANNEL_PROVIDER[picked.channel] : undefined;
  return providerId || undefined;
}

export async function runUnifiedGeneration(request: UnifiedGenerationRequest): Promise<AiJobDetail> {
  const rawModel = String(request.canonicalModelId || request.registryId || '').trim();
  if (!rawModel) throw new Error('缺少生成模型');
  const canonicalModelId = resolveCanonicalModelId(rawModel) || rawModel;
  const registryId = String(request.registryId || rawModel).trim() || canonicalModelId;
  const upstreamModelId = String(request.upstreamModelId || '').trim();
  const providerId = inferGatewayProviderId(registryId, canonicalModelId, request.modality, request.providerId);
  const estimatedCredits = Math.max(
    1,
    Math.floor(Number(request.estimatedCredits || defaultEstimatedCreditsForGateway(request.modality, request.capability)))
  );
  const cachedHeaders = getCachedCreditsProxyHeaders(estimatedCredits) || {};
  try {
    return await createAiJob(
      {
        modality: request.modality,
        capability: request.capability,
        ...(providerId ? { provider: providerId } : {}),
        model: canonicalModelId,
        canonicalModelId,
        registryId,
        estimatedCredits,
        input: {
          ...request.input,
          canonicalModelId,
          registryId,
          estimatedCredits,
          ...(upstreamModelId ? { upstreamModelId, model: upstreamModelId } : {}),
          ...(request.assetContext ? { assetContext: request.assetContext } : {}),
        },
        metadata: {
          ...(request.metadata || {}),
          source: 'runUnifiedGeneration',
          uiSource: request.uiSource,
          canonicalModelId,
          registryId,
          ...(providerId ? { providerId } : {}),
          ...(upstreamModelId ? { upstreamModelId } : {}),
          ...(request.assetContext ? { assetContext: request.assetContext } : {}),
        },
      },
      {
        signal: request.abortSignal,
        cache: 'no-store',
        headers: cachedHeaders,
      }
    );
  } finally {
    if (!isAiTaskEnvelopeActive()) {
      clearLastCreditsReserveKey();
    }
  }
}

export async function runUnifiedTextGeneration(request: UnifiedTextGenerationRequest): Promise<string> {
  const prompt = String(request.prompt || '').trim();
  if (!prompt) throw new Error('请输入文字');
  const model = String(request.model || '').trim();
  if (!model) throw new Error('缺少文字模型');
  const created = await runUnifiedGeneration({
    modality: 'text',
    capability: 'text.generate',
    canonicalModelId: model,
    registryId: model,
    input: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      prompt,
      config: request.systemInstruction
        ? { systemInstruction: String(request.systemInstruction || '').trim() }
        : {},
    },
    uiSource: request.uiSource,
    assetContext: request.assetContext,
    estimatedCredits: request.estimatedCredits,
    metadata: request.metadata,
    abortSignal: request.abortSignal,
  });
  const immediate = extractText(created);
  if (created.job.status === 'succeeded' && immediate != null) return immediate;
  if (created.job.status === 'failed' || created.job.status === 'cancelled') throw terminalError(created);

  const timeoutMs = Math.max(5_000, Number(readEnv('VITE_AI_GATEWAY_TEXT_POLL_TIMEOUT_MS') || 180_000));
  let intervalMs = Math.max(1, Number(readEnv('VITE_AI_GATEWAY_TEXT_POLL_INTERVAL_MS') || 1000));
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs, request.abortSignal);
    const detail = await getMyAiJob(created.job.id);
    if (detail.job.status === 'succeeded') {
      const text = extractText(detail);
      if (text != null) return text;
      throw new Error('AI Gateway text job succeeded without text output');
    }
    if (detail.job.status === 'failed' || detail.job.status === 'cancelled') throw terminalError(detail);
    intervalMs = Math.min(Math.round(intervalMs * 1.5), 5_000);
  }
  throw new Error('AI Gateway text job polling timed out');
}

export async function runUnifiedVisionTextGeneration(request: UnifiedVisionTextGenerationRequest): Promise<string> {
  const prompt = String(request.prompt || '').trim();
  if (!prompt) throw new Error('请输入要询问图片的问题');
  const model = String(request.model || '').trim();
  if (!model) throw new Error('缺少文字模型');
  const imagesRaw = (request.images || []).map((s) => String(s || '').trim()).filter(Boolean);
  const images: string[] = [];
  for (const image of imagesRaw) {
    images.push(await normalizeImageReferenceForGateway(image));
  }
  if (images.length === 0) throw new Error('图生文需要图片');
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  for (const image of images) {
    const inline = inlineDataFromDataUrl(image);
    if (inline?.data) parts.push({ inlineData: inline });
  }
  if (!parts.some((part) => 'inlineData' in part)) throw new Error('图生文需要有效图片');
  parts.push({ text: prompt });
  const created = await runUnifiedGeneration({
    modality: 'text',
    capability: 'text.generate',
    canonicalModelId: model,
    registryId: model,
    input: {
      contents: [{ role: 'user', parts }],
      prompt,
      config: request.systemInstruction
        ? { systemInstruction: String(request.systemInstruction || '').trim() }
        : {},
    },
    uiSource: request.uiSource,
    assetContext: request.assetContext,
    estimatedCredits: request.estimatedCredits,
    metadata: {
      ...(request.metadata || {}),
      visionText: true,
      imageCount: images.length,
    },
    abortSignal: request.abortSignal,
  });
  const immediate = extractText(created);
  if (created.job.status === 'succeeded' && immediate != null) return immediate;
  if (created.job.status === 'failed' || created.job.status === 'cancelled') throw terminalError(created);

  const timeoutMs = Math.max(5_000, Number(readEnv('VITE_AI_GATEWAY_TEXT_POLL_TIMEOUT_MS') || 180_000));
  let intervalMs = Math.max(1, Number(readEnv('VITE_AI_GATEWAY_TEXT_POLL_INTERVAL_MS') || 1000));
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs, request.abortSignal);
    const detail = await getMyAiJob(created.job.id);
    if (detail.job.status === 'succeeded') {
      const text = extractText(detail);
      if (text != null) return text;
      throw new Error('AI Gateway vision text job succeeded without text output');
    }
    if (detail.job.status === 'failed' || detail.job.status === 'cancelled') throw terminalError(detail);
    intervalMs = Math.min(Math.round(intervalMs * 1.5), 5_000);
  }
  throw new Error('AI Gateway vision text job polling timed out');
}

export async function runUnifiedImageGeneration(request: UnifiedImageGenerationRequest): Promise<string> {
  const prompt = String(request.prompt || '').trim();
  if (!prompt) throw new Error('请输入画面描述');
  const model = String(request.model || '').trim();
  if (!model) throw new Error('缺少图片模型');
  const registryId = String(request.registryId || request.canonicalModelId || model).trim();
  const canonicalModelId = String(request.canonicalModelId || registryId).trim();
  const upstreamModelId = String(request.upstreamModelId || model).trim();
  const refsRaw = (request.referenceImages || []).map((s) => String(s || '').trim()).filter(Boolean);
  const refs: string[] = [];
  for (const ref of refsRaw) {
    refs.push(await normalizeImageReferenceForGateway(ref));
  }
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: prompt }];
  for (const ref of refs) {
    const inline = inlineDataFromDataUrl(ref);
    if (inline?.data) parts.push({ inlineData: inline });
  }
  const imageConfig: Record<string, string> = {};
  if (request.imageOptions?.aspectRatio) imageConfig.aspectRatio = request.imageOptions.aspectRatio;
  if (request.imageOptions?.imageSize) imageConfig.imageSize = request.imageOptions.imageSize;
  if (request.imageOptions?.size) imageConfig.size = request.imageOptions.size;
  const capability = refs.length > 0 ? 'workflow_image_edit' : 'workflow_text_to_image';
  const created = await runUnifiedGeneration({
    modality: 'image',
    capability,
    canonicalModelId,
    registryId,
    upstreamModelId: upstreamModelId && upstreamModelId !== canonicalModelId ? upstreamModelId : undefined,
    input: {
      contents: [{ role: 'user', parts }],
      prompt,
      referenceImages: refs,
      config: {
        ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {}),
        ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
      },
    },
    uiSource: request.uiSource,
    assetContext: request.assetContext,
    estimatedCredits: request.estimatedCredits ?? 134,
    metadata: {
      ...(request.metadata || {}),
      referenceImageCount: refs.length,
    },
    abortSignal: request.abortSignal,
  });
  const immediate = extractImageUrl(created);
  if (created.job.status === 'succeeded' && immediate != null) {
    rememberAiGatewayImageResult(immediate, created.job.id);
    return immediate;
  }
  if (created.job.status === 'failed' || created.job.status === 'cancelled') throw terminalError(created);

  const timeoutMs = Math.max(30_000, Number(readEnv('VITE_AI_GATEWAY_IMAGE_POLL_TIMEOUT_MS') || 660_000));
  let intervalMs = Math.max(1, Number(readEnv('VITE_AI_GATEWAY_IMAGE_POLL_INTERVAL_MS') || 2000));
  const startedAt = Date.now();
  let missingImageOutputDetail: AiJobDetail | null = null;
  let missingImageOutputRetries = 0;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs, request.abortSignal);
    const detail = await getMyAiJob(created.job.id);
    if (detail.job.status === 'succeeded') {
      const imageUrl = extractImageUrl(detail);
      if (imageUrl != null) {
        rememberAiGatewayImageResult(imageUrl, detail.job.id);
        return imageUrl;
      }
      missingImageOutputDetail = detail;
      if (missingImageOutputRetries < 3) {
        missingImageOutputRetries += 1;
        intervalMs = 1000;
        continue;
      }
      throw new Error(`AI Gateway image job succeeded without image output (${imageOutputDebug(detail)})`);
    }
    if (detail.job.status === 'failed' || detail.job.status === 'cancelled') throw terminalError(detail);
    intervalMs = Math.min(Math.round(intervalMs * 1.5), 10_000);
  }
  if (missingImageOutputDetail) {
    throw new Error(`AI Gateway image job succeeded without image output (${imageOutputDebug(missingImageOutputDetail)})`);
  }
  throw new Error('AI Gateway image job polling timed out');
}
