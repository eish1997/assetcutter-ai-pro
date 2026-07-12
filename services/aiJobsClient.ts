import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';

export type AiJobStatus = 'created' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type AiJobModality = 'text' | 'image' | 'music' | 'video' | 'model3d';

export type AiJobRouteSummary = {
  providerId: string | null;
  adapterId: string | null;
  channel: string | null;
  upstreamBackend: string | null;
};

export type AiJobCreditsGateSummary = {
  mode?: string;
  enabled?: boolean;
  estimatedCredits?: number;
  reserveKey?: string | null;
  fairnessKey?: string | null;
  checked?: boolean;
};

export type AiJobErrorSummary = {
  code: string | null;
  message: string;
};

export type AiJobSummary = {
  id: string;
  status: AiJobStatus;
  modality: AiJobModality;
  capability: string;
  provider: string | null;
  model: string | null;
  userId: string | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  route: AiJobRouteSummary | null;
  traceOnly: boolean;
  legacyPath: string | null;
  proxyJobId: string | null;
  creditsGate: AiJobCreditsGateSummary | null;
  error: AiJobErrorSummary | null;
};

export type AiJobDetail = {
  job: AiJobSummary & {
    output: unknown | null;
    artifacts: Array<Record<string, unknown>>;
  };
  route: AiJobRouteSummary | null;
  adapterRequest: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
  } | null;
};

export type AiJobsListResponse = {
  items: AiJobSummary[];
  limit: number;
};

export type CreateAiJobInput = {
  id?: string;
  modality: AiJobModality | '3d' | 'audio';
  capability?: string;
  provider?: string;
  model?: string;
  correlationId?: string;
  estimatedCredits?: number;
  metadata?: Record<string, unknown>;
  input: Record<string, unknown>;
};

export type RetryAiJobInput = {
  id?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
};

function clampLimit(limit?: number) {
  const n = Math.floor(Number(limit) || 20);
  return Math.min(100, Math.max(1, n));
}

export function createAiJob(input: CreateAiJobInput) {
  return requestJson<AiJobDetail>(apiUrl('/api/ai/jobs'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listMyAiJobs(options: { limit?: number } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(clampLimit(options.limit)));
  return requestJson<AiJobsListResponse>(apiUrl(`/api/ai/jobs?${params.toString()}`), {
    cache: 'no-store',
  });
}

export function getMyAiJob(jobId: string) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('Invalid AI job id');
  return requestJson<AiJobDetail>(apiUrl(`/api/ai/jobs/${encodeURIComponent(id)}`), {
    cache: 'no-store',
  });
}

export function cancelMyAiJob(jobId: string) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('Invalid AI job id');
  return requestJson<AiJobDetail>(apiUrl(`/api/ai/jobs/${encodeURIComponent(id)}/cancel`), {
    method: 'POST',
  });
}

export function retryMyAiJob(jobId: string, input: RetryAiJobInput = {}) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('Invalid AI job id');
  return requestJson<AiJobDetail>(apiUrl(`/api/ai/jobs/${encodeURIComponent(id)}/retry`), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listAdminAiJobs(options: { limit?: number } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(clampLimit(options.limit)));
  return requestJson<AiJobsListResponse>(apiUrl(`/api/admin/ai/jobs?${params.toString()}`), {
    cache: 'no-store',
  });
}
