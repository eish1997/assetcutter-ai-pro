import { getCachedCreditsProxyHeaders } from './creditsProxyBridge';
import { createAiJob, getMyAiJob, type AiJobDetail } from './aiJobsClient';
import type { WorkflowVideoJobInput, WorkflowVideoJobResult } from './workflowVideoBridge';

export type AiGatewayVideoExecutionInput = WorkflowVideoJobInput & {
  registryId?: string;
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

export function isAiGatewayVideoExecutionEnabled(): boolean {
  const raw = readEnv('VITE_AI_GATEWAY_VIDEO_EXECUTION');
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

function extractVideoUrl(detail: AiJobDetail): WorkflowVideoJobResult | null {
  const output = detail.job?.output && typeof detail.job.output === 'object'
    ? (detail.job.output as Record<string, unknown>)
    : {};
  const outputUrl = pickString(output, ['videoUrl', 'video_url', 'url']);
  if (outputUrl) return { videoUrl: outputUrl };
  const artifacts = Array.isArray(detail.job?.artifacts) ? detail.job.artifacts : [];
  for (const artifact of artifacts) {
    const obj = artifact && typeof artifact === 'object' ? artifact : {};
    if (String(obj.kind || '').toLowerCase() !== 'video') continue;
    const artifactUrl = pickString(obj, ['url', 'videoUrl', 'video_url']);
    if (artifactUrl) return { videoUrl: artifactUrl };
  }
  return null;
}

function terminalError(detail: AiJobDetail): Error {
  const msg = detail.job?.error?.message || 'AI Gateway video job failed';
  return new Error(msg);
}

export async function createAndPollAiGatewayVideoJob(
  input: AiGatewayVideoExecutionInput
): Promise<WorkflowVideoJobResult> {
  if (!isAiGatewayVideoExecutionEnabled()) {
    throw new Error('AI Gateway video execution is disabled');
  }
  const estimatedCredits = Math.max(1, Math.floor(Number(input.estimatedCredits || 50)));
  const cachedHeaders = getCachedCreditsProxyHeaders(estimatedCredits) || {};
  const registryId = input.registryId || 'jimeng-video-ti2v-v30-pro';
  const created = await createAiJob(
    {
      modality: 'video',
      capability: 'workflow_generate_video',
      model: registryId,
      canonicalModelId: registryId,
      registryId,
      estimatedCredits,
      input: {
        canonicalModelId: registryId,
        registryId,
        prompt: input.prompt,
        referenceImages: input.referenceImages,
        durationSeconds: input.durationSeconds,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        motionStrength: input.motionStrength,
        estimatedCredits,
      },
      metadata: {
        source: 'unifiedAiGateway.workflowGenerateVideo',
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

  const immediate = extractVideoUrl(created);
  if (created.job.status === 'succeeded' && immediate) return immediate;
  if (created.job.status === 'failed' || created.job.status === 'cancelled') throw terminalError(created);

  const startedAt = Date.now();
  const timeoutMs = Math.max(30_000, Number(readEnv('VITE_AI_GATEWAY_VIDEO_POLL_TIMEOUT_MS') || 900_000));
  let intervalMs = Math.max(1, Number(readEnv('VITE_AI_GATEWAY_VIDEO_POLL_INTERVAL_MS') || 2000));
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs, input.abortSignal);
    const detail = await getMyAiJob(created.job.id);
    if (detail.job.status === 'succeeded') {
      const result = extractVideoUrl(detail);
      if (result) return result;
      throw new Error('AI Gateway video job succeeded without videoUrl');
    }
    if (detail.job.status === 'failed' || detail.job.status === 'cancelled') throw terminalError(detail);
    intervalMs = Math.min(Math.round(intervalMs * 1.5), 10_000);
  }
  throw new Error('AI Gateway video job polling timed out');
}
