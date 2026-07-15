import { getCachedCreditsProxyHeaders } from '../creditsProxyBridge';
import { createAiJob, getMyAiJob, type AiJobDetail, type AiJobModality } from '../aiJobsClient';
import { resolveCanonicalModelId } from '../modelRegistry/canonicalModelCatalog';

export type UnifiedGenerationModality = AiJobModality;

export type UnifiedGenerationRequest = {
  modality: UnifiedGenerationModality;
  capability: string;
  canonicalModelId: string;
  registryId?: string;
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
  model: string;
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
  const artifacts = Array.isArray(detail.job?.artifacts) ? detail.job.artifacts : [];
  for (const artifact of artifacts) {
    const obj = artifact && typeof artifact === 'object' ? artifact : {};
    if (String(obj.kind || '').toLowerCase() !== 'image') continue;
    if (typeof obj.url === 'string' && obj.url.trim()) return obj.url.trim();
    if (typeof obj.imageUrl === 'string' && obj.imageUrl.trim()) return obj.imageUrl.trim();
    if (typeof obj.dataUrl === 'string' && obj.dataUrl.trim()) return obj.dataUrl.trim();
  }
  const output = detailOutput(detail);
  const outputArtifacts = Array.isArray(output.artifacts) ? output.artifacts : [];
  for (const artifact of outputArtifacts) {
    const obj = artifact && typeof artifact === 'object' ? artifact as Record<string, unknown> : {};
    if (String(obj.kind || '').toLowerCase() !== 'image') continue;
    if (typeof obj.url === 'string' && obj.url.trim()) return obj.url.trim();
  }
  for (const key of ['imageUrl', 'image_url', 'url', 'dataUrl', 'data_url']) {
    const value = output[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
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

export async function runUnifiedGeneration(request: UnifiedGenerationRequest): Promise<AiJobDetail> {
  const rawModel = String(request.canonicalModelId || request.registryId || '').trim();
  if (!rawModel) throw new Error('缺少生成模型');
  const canonicalModelId = resolveCanonicalModelId(rawModel) || rawModel;
  const registryId = String(request.registryId || rawModel).trim() || canonicalModelId;
  const estimatedCredits = Math.max(1, Math.floor(Number(request.estimatedCredits || 1)));
  const cachedHeaders = getCachedCreditsProxyHeaders(estimatedCredits) || {};
  return createAiJob(
    {
      modality: request.modality,
      capability: request.capability,
      ...(request.providerId ? { provider: request.providerId } : {}),
      model: canonicalModelId,
      canonicalModelId,
      registryId,
      estimatedCredits,
      input: {
        ...request.input,
        canonicalModelId,
        registryId,
        ...(request.assetContext ? { assetContext: request.assetContext } : {}),
      },
      metadata: {
        ...(request.metadata || {}),
        source: 'runUnifiedGeneration',
        uiSource: request.uiSource,
        canonicalModelId,
        registryId,
        ...(request.assetContext ? { assetContext: request.assetContext } : {}),
      },
    },
    {
      signal: request.abortSignal,
      cache: 'no-store',
      headers: cachedHeaders,
    }
  );
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
  const images = (request.images || []).map((s) => String(s || '').trim()).filter(Boolean);
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
  const refs = (request.referenceImages || []).map((s) => String(s || '').trim()).filter(Boolean);
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
    canonicalModelId: model,
    registryId: model,
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
  if (created.job.status === 'succeeded' && immediate != null) return immediate;
  if (created.job.status === 'failed' || created.job.status === 'cancelled') throw terminalError(created);

  const timeoutMs = Math.max(30_000, Number(readEnv('VITE_AI_GATEWAY_IMAGE_POLL_TIMEOUT_MS') || 660_000));
  let intervalMs = Math.max(1, Number(readEnv('VITE_AI_GATEWAY_IMAGE_POLL_INTERVAL_MS') || 2000));
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs, request.abortSignal);
    const detail = await getMyAiJob(created.job.id);
    if (detail.job.status === 'succeeded') {
      const imageUrl = extractImageUrl(detail);
      if (imageUrl != null) return imageUrl;
      throw new Error('AI Gateway image job succeeded without image output');
    }
    if (detail.job.status === 'failed' || detail.job.status === 'cancelled') throw terminalError(detail);
    intervalMs = Math.min(Math.round(intervalMs * 1.5), 10_000);
  }
  throw new Error('AI Gateway image job polling timed out');
}
