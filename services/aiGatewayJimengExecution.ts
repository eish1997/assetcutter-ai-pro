/**
 * Jimeng workflow entry: create/poll AI Gateway jobs (jimeng-visual adapter).
 * User-reachable path is Gateway-only; `/api/jimeng/tasks*` remains for adapter internals.
 */
import { getCachedCreditsProxyHeaders } from './creditsProxyBridge';
import { createAiJob, getMyAiJob, type AiJobDetail } from './aiJobsClient';
import type { JimengSubmitInput } from './jimeng/types';
import type { WorkflowVideoJobResult } from './workflowVideoBridge';

export type AiGatewayJimengExecutionInput = JimengSubmitInput & {
  estimatedCredits?: number;
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

/** Always on — Jimeng user path is Gateway-only. */
export function isAiGatewayJimengExecutionEnabled(): boolean {
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

function terminalError(detail: AiJobDetail): Error {
  const err = detail.job?.error;
  const failureReason =
    err && typeof err === 'object' && err.failureReason && typeof err.failureReason === 'object'
      ? (err.failureReason as { code?: string; message?: string })
      : null;
  const msg =
    (typeof failureReason?.message === 'string' && failureReason.message.trim()) ||
    (typeof err?.message === 'string' && err.message.trim()) ||
    'AI Gateway Jimeng job failed';
  const code =
    (typeof failureReason?.code === 'string' && failureReason.code.trim()) ||
    (typeof err?.code === 'string' && err.code.trim()) ||
    '';
  return new Error(code ? `${code}: ${msg}` : msg);
}

function extractImages(detail: AiJobDetail): string[] {
  const artifacts = Array.isArray(detail.job?.artifacts) ? detail.job.artifacts : [];
  const fromArtifacts = artifacts
    .filter((row) => String(row?.kind || '').toLowerCase() === 'image')
    .map((row) => String(row?.url || '').trim())
    .filter(Boolean);
  if (fromArtifacts.length) return fromArtifacts;
  const output = detail.job?.output && typeof detail.job.output === 'object'
    ? (detail.job.output as Record<string, unknown>)
    : {};
  const images = Array.isArray(output.images) ? output.images : [];
  return images.map((url) => String(url || '').trim()).filter(Boolean);
}

function extractVideoUrl(detail: AiJobDetail): string | null {
  const artifacts = Array.isArray(detail.job?.artifacts) ? detail.job.artifacts : [];
  for (const row of artifacts) {
    if (String(row?.kind || '').toLowerCase() !== 'video') continue;
    const url = String(row?.url || '').trim();
    if (url) return url;
  }
  const output = detail.job?.output && typeof detail.job.output === 'object'
    ? (detail.job.output as Record<string, unknown>)
    : {};
  const url = String(output.videoUrl || output.video_url || '').trim();
  return url || null;
}

async function pollUntilTerminal(
  jobId: string,
  modality: 'image' | 'video',
  abortSignal?: AbortSignal
): Promise<AiJobDetail> {
  const timeoutMs = Math.max(
    30_000,
    Number(
      readEnv(
        modality === 'image'
          ? 'VITE_AI_GATEWAY_JIMENG_IMAGE_POLL_TIMEOUT_MS'
          : 'VITE_AI_GATEWAY_JIMENG_VIDEO_POLL_TIMEOUT_MS'
      ) || (modality === 'image' ? 180_000 : 600_000)
    )
  );
  let intervalMs = Math.max(1, Number(readEnv('VITE_AI_GATEWAY_JIMENG_POLL_INTERVAL_MS') || 2000));
  const startedAt = Date.now();
  let last: AiJobDetail | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs, abortSignal);
    last = await getMyAiJob(jobId);
    if (last.job.status === 'succeeded' || last.job.status === 'failed' || last.job.status === 'cancelled') {
      return last;
    }
    intervalMs = Math.min(Math.round(intervalMs * 1.5), 10_000);
  }
  if (last) return last;
  throw new Error(`AI Gateway Jimeng ${modality} job polling timed out`);
}

export async function createAndPollAiGatewayJimengImageJob(
  input: AiGatewayJimengExecutionInput
): Promise<{ images: string[]; aiGatewayJobId: string }> {
  const registryId = String(input.registryId || '').trim();
  if (!registryId) throw new Error('缺少即梦 registryId');
  const estimatedCredits = Math.max(1, Math.floor(Number(input.estimatedCredits || 50)));
  const cachedHeaders = getCachedCreditsProxyHeaders(estimatedCredits) || {};
  const created = await createAiJob(
    {
      modality: 'image',
      capability: 'workflow_text_to_image',
      provider: 'volcengine-jimeng',
      model: registryId,
      canonicalModelId: registryId,
      registryId,
      estimatedCredits,
      input: {
        canonicalModelId: registryId,
        registryId,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        width: input.width,
        height: input.height,
        aspectRatio: input.aspectRatio,
        referenceImages: input.referenceImages,
        extra: input.extra,
        estimatedCredits,
      },
      metadata: {
        source: 'unifiedAiGateway.workflowGenerateImageJimeng',
        canonicalModelId: registryId,
        registryId,
        providerId: 'volcengine-jimeng',
      },
    },
    {
      signal: input.abortSignal,
      cache: 'no-store',
      headers: cachedHeaders,
    }
  );

  let detail = created;
  if (detail.job.status !== 'succeeded' && detail.job.status !== 'failed' && detail.job.status !== 'cancelled') {
    detail = await pollUntilTerminal(created.job.id, 'image', input.abortSignal);
  }
  if (detail.job.status === 'failed' || detail.job.status === 'cancelled') throw terminalError(detail);
  const images = extractImages(detail);
  if (!images.length) throw new Error('AI Gateway Jimeng image job succeeded without images');
  return { images, aiGatewayJobId: detail.job.id };
}

export async function createAndPollAiGatewayJimengVideoJob(
  input: AiGatewayJimengExecutionInput
): Promise<WorkflowVideoJobResult & { aiGatewayJobId: string }> {
  const registryId = String(input.registryId || '').trim();
  if (!registryId) throw new Error('缺少即梦 registryId');
  const estimatedCredits = Math.max(1, Math.floor(Number(input.estimatedCredits || 88)));
  const cachedHeaders = getCachedCreditsProxyHeaders(estimatedCredits) || {};
  const created = await createAiJob(
    {
      modality: 'video',
      capability: 'workflow_jimeng_video',
      provider: 'volcengine-jimeng',
      model: registryId,
      canonicalModelId: registryId,
      registryId,
      estimatedCredits,
      input: {
        canonicalModelId: registryId,
        registryId,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        width: input.width,
        height: input.height,
        aspectRatio: input.aspectRatio,
        referenceImages: input.referenceImages,
        extra: input.extra,
        estimatedCredits,
      },
      metadata: {
        source: 'unifiedAiGateway.workflowGenerateVideoJimeng',
        canonicalModelId: registryId,
        registryId,
        providerId: 'volcengine-jimeng',
      },
    },
    {
      signal: input.abortSignal,
      cache: 'no-store',
      headers: cachedHeaders,
    }
  );

  let detail = created;
  if (detail.job.status !== 'succeeded' && detail.job.status !== 'failed' && detail.job.status !== 'cancelled') {
    detail = await pollUntilTerminal(created.job.id, 'video', input.abortSignal);
  }
  if (detail.job.status === 'failed' || detail.job.status === 'cancelled') throw terminalError(detail);
  const videoUrl = extractVideoUrl(detail);
  if (!videoUrl) throw new Error('AI Gateway Jimeng video job succeeded without videoUrl');
  return { videoUrl, providerId: 'volcengine-jimeng', aiGatewayJobId: detail.job.id };
}
