import { getCachedCreditsProxyHeaders } from './creditsProxyBridge';
import { createAiJob, getMyAiJob, type AiJobDetail } from './aiJobsClient';
import { prepareImageDataUrlForTripoUpload } from './tripoUploadImagePrep';

export type AiGatewayModel3dExecutionInput = {
  prompt: string;
  referenceImages?: string[];
  registryId?: string;
  quality?: string;
  format?: string;
  texture?: boolean;
  geometryQuality?: string;
  textureQuality?: string;
  /** Tencent Hunyuan Pro/Rapid passthrough (adapter reads these). */
  enablePBR?: boolean;
  faceCount?: number;
  generateType?: string;
  polygonType?: string;
  model?: string;
  estimatedCredits?: number;
  abortSignal?: AbortSignal;
};

export type AiGatewayModel3dExecutionResult = {
  aiGatewayJobId: string;
  modelUrls: string[];
  previewUrl?: string;
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

export function isAiGatewayModel3dExecutionEnabled(): boolean {
  const raw = readEnv('VITE_AI_GATEWAY_MODEL3D_EXECUTION');
  if (/^(0|false|off|no)$/i.test(raw)) return false;
  return true;
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

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function collectModelUrls(detail: AiJobDetail): string[] {
  const output = detail.job?.output && typeof detail.job.output === 'object'
    ? (detail.job.output as Record<string, unknown>)
    : {};
  const out: string[] = [];
  const push = (value: unknown) => {
    const url = typeof value === 'string' ? value.trim() : '';
    if (!url || out.includes(url)) return;
    out.push(url);
  };
  // A3: contract artifacts first; output fields are legacy fallback.
  const artifacts = Array.isArray(detail.job?.artifacts) ? detail.job.artifacts : [];
  for (const artifact of artifacts) {
    const obj = artifact && typeof artifact === 'object' ? artifact : {};
    if (String(obj.kind || '').toLowerCase() !== 'model3d') continue;
    push(obj.url);
    push(obj.modelUrl);
  }
  if (Array.isArray(output.modelUrls)) output.modelUrls.forEach(push);
  if (Array.isArray(output.urls)) output.urls.forEach(push);
  return out;
}

function extractPreviewUrl(detail: AiJobDetail): string | undefined {
  const output = detail.job?.output && typeof detail.job.output === 'object'
    ? (detail.job.output as Record<string, unknown>)
    : {};
  const direct = pickString(output, ['previewUrl', 'preview_url', 'thumbnailUrl', 'thumbnail_url', 'posterUrl']);
  if (direct) return direct;
  const artifacts = Array.isArray(detail.job?.artifacts) ? detail.job.artifacts : [];
  for (const artifact of artifacts) {
    const obj = artifact && typeof artifact === 'object' ? artifact : {};
    if (String(obj.kind || '').toLowerCase() !== 'image') continue;
    const url = pickString(obj, ['url', 'imageUrl', 'previewUrl']);
    if (url) return url;
  }
  return undefined;
}

function terminalError(detail: AiJobDetail): Error {
  const msg = detail.job?.error?.message || 'AI Gateway 3D job failed';
  return new Error(msg);
}

export async function createAndPollAiGatewayModel3dJob(
  input: AiGatewayModel3dExecutionInput
): Promise<AiGatewayModel3dExecutionResult> {
  if (!isAiGatewayModel3dExecutionEnabled()) {
    throw new Error('AI Gateway 3D execution is disabled');
  }
  const registryId = String(input.registryId || 'tripo-p1').trim();
  const prompt = String(input.prompt || '').trim();
  if (!registryId) throw new Error('Missing 3D model registry id');
  if (!prompt) throw new Error('Missing 3D prompt');
  const estimatedCredits = Math.max(1, Math.floor(Number(input.estimatedCredits || 800)));
  const cachedHeaders = getCachedCreditsProxyHeaders(estimatedCredits) || {};
  const referenceImages = registryId.startsWith('tripo-') && input.referenceImages?.length
    ? await Promise.all(input.referenceImages.map((src) => prepareImageDataUrlForTripoUpload(src)))
    : input.referenceImages;
  const created = await createAiJob(
    {
      modality: 'model3d',
      capability: 'model3d.generate',
      model: registryId,
      canonicalModelId: registryId,
      registryId,
      estimatedCredits,
      input: {
        canonicalModelId: registryId,
        registryId,
        prompt,
        referenceImages,
        quality: input.quality,
        format: input.format,
        texture: input.texture,
        geometryQuality: input.geometryQuality,
        textureQuality: input.textureQuality,
        ...(typeof input.enablePBR === 'boolean' ? { enablePBR: input.enablePBR } : {}),
        ...(input.faceCount != null ? { faceCount: input.faceCount } : {}),
        ...(input.generateType ? { generateType: input.generateType } : {}),
        ...(input.polygonType ? { polygonType: input.polygonType } : {}),
        ...(input.model ? { model: input.model } : {}),
        estimatedCredits,
      },
      metadata: {
        source: 'aiGatewayModel3dExecution',
        canonicalModelId: registryId,
        registryId,
      },
    },
    {
      signal: input.abortSignal,
      cache: 'no-store',
      headers: cachedHeaders,
    }
  );

  const immediate = collectModelUrls(created);
  if (created.job.status === 'succeeded' && immediate.length) {
    return { aiGatewayJobId: created.job.id, modelUrls: immediate, previewUrl: extractPreviewUrl(created) };
  }
  if (created.job.status === 'failed' || created.job.status === 'cancelled') throw terminalError(created);

  const startedAt = Date.now();
  const timeoutMs = Math.max(30_000, Number(readEnv('VITE_AI_GATEWAY_MODEL3D_POLL_TIMEOUT_MS') || 900_000));
  let intervalMs = Math.max(1, Number(readEnv('VITE_AI_GATEWAY_MODEL3D_POLL_INTERVAL_MS') || 3000));
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs, input.abortSignal);
    const detail = await getMyAiJob(created.job.id);
    if (detail.job.status === 'succeeded') {
      const modelUrls = collectModelUrls(detail);
      if (modelUrls.length) {
        return { aiGatewayJobId: detail.job.id, modelUrls, previewUrl: extractPreviewUrl(detail) };
      }
      throw new Error('AI Gateway 3D job succeeded without model URLs');
    }
    if (detail.job.status === 'failed' || detail.job.status === 'cancelled') throw terminalError(detail);
    intervalMs = Math.min(Math.round(intervalMs * 1.5), 10_000);
  }
  throw new Error('AI Gateway 3D job polling timed out');
}
