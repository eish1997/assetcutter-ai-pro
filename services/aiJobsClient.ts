import { apiUrl } from './apiBase';
import { HttpRequestError, requestJson } from './httpClient';
import { clearLastCreditsReserveKey } from './creditsProxyBridge';
import { resolveCanonicalModelId } from './modelRegistry/canonicalModelCatalog';

export type AiJobStatus = 'created' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type AiJobModality = 'text' | 'image' | 'music' | 'video' | 'model3d';

export type AiJobRouteSummary = {
  providerId: string | null;
  workerId?: string | null;
  adapterId: string | null;
  legacyAdapterId?: string | null;
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

export type AiJobFallbackAttemptSummary = {
  at?: string | null;
  providerId?: string | null;
  adapterId?: string | null;
  workerId?: string | null;
  reason?: string | null;
  skipReason?: string | null;
  retryable?: boolean;
  policyKind?: string | null;
  policies?: string[];
  policyAllowed?: boolean;
  status?: number;
  message?: string;
};

export type AiJobFallbackSummary = {
  active: boolean;
  policy: string | null;
  policies: string[];
  autoSelectedProvider: boolean;
  maxAttempts: number | null;
  nextProviderId: string | null;
  nextAdapterId: string | null;
  lastFallbackAt: string | null;
  attempts: AiJobFallbackAttemptSummary[];
  skipped: AiJobFallbackAttemptSummary[];
  attemptCount: number;
  skippedCount: number;
  lastReason: string | null;
  lastSkipReason: string | null;
  exhausted: boolean;
  exhaustedAt: string | null;
};

export type AiJobGatewayFailureSummary = {
  code?: string | null;
  stage?: string | null;
  owner?: string | null;
  retryable?: boolean;
  userMessage?: string | null;
  adminMessage?: string | null;
  nextAction?: string | null;
  at?: string | null;
  providerId?: string | null;
  adapterId?: string | null;
  workerId?: string | null;
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
  proxyPath: string | null;
  proxyJobId: string | null;
  creditsGate: AiJobCreditsGateSummary | null;
  fallback?: AiJobFallbackSummary | null;
  gatewayFailure?: AiJobGatewayFailureSummary | null;
  /** B12: hard vs soft cancel distinguishable copy */
  workerCancel?: {
    mode: string;
    cancelled?: boolean;
    reason?: string | null;
    cancelReason?: string | null;
    userMessage?: string | null;
    adminMessage?: string | null;
    upstreamTaskId?: string | null;
    provider?: string | null;
  } | null;
  error: AiJobErrorSummary | null;
};

export type AiJobDetail = {
  job: AiJobSummary & {
    metadata?: Record<string, unknown>;
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

export type AiGatewayOpsGroup = {
  key: string;
  total: number;
  statusCounts: Record<AiJobStatus, number>;
  errorCounts: {
    rate_limited: number;
    auth: number;
    credits: number;
    timeout: number;
    upstream: number;
  };
  active: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
  failureRate: number;
  rateLimitRate: number;
};

export type AiGatewayOpsSummary = {
  generatedAt: string;
  sampleSize: number;
  limit: number;
  window: {
    firstCreatedAt: string | null;
    lastCreatedAt: string | null;
  };
  totals: {
    total: number;
    active: number;
    terminal: number;
    statusCounts: Record<AiJobStatus, number>;
    errorCounts: AiGatewayOpsGroup['errorCounts'];
    failureRate: number;
    rateLimitRate: number;
  };
  byProvider: AiGatewayOpsGroup[];
  byModel: AiGatewayOpsGroup[];
};

export type AiGatewayOpsModelOverride = {
  from: string;
  to: string;
  enabled: boolean;
  reason: string | null;
  expiresAt?: string | null;
};

export type AiGatewayOpsPauseRule = {
  provider?: string;
  model?: string;
  reason: string | null;
  expiresAt: string | null;
  createdAt?: string | null;
  createdByUserId?: string | null;
};

export type AiGatewayRuntimeFallbackConfig = {
  respectProviderPin?: boolean;
  allowCrossProvider?: boolean;
  /** switch_provider | same_route_retry | fail */
  onTimeout?: 'switch_provider' | 'same_route_retry' | 'fail' | string;
  sameRouteRetryMax?: number;
};

export type AiGatewayDispatchPolicy = {
  strategy?: string;
  healthWeight?: number;
  costWeight?: number;
  priorityWeight?: number;
  preferLowerPriority?: boolean;
  costHints?: Record<string, number>;
  providerPins?: Array<Record<string, unknown>>;
  canary?: Array<Record<string, unknown>>;
  runtimeFallback?: AiGatewayRuntimeFallbackConfig;
};

export type AiGatewayRolloutControl = {
  previousDispatchPolicy?: AiGatewayDispatchPolicy | null;
  diagnosisMaxAgeMs?: number;
};

export type AiGatewayOpsControlConfig = {
  disabledProviders: string[];
  disabledModels: string[];
  disabledProviderRules?: AiGatewayOpsPauseRule[];
  disabledModelRules?: AiGatewayOpsPauseRule[];
  modelOverrides: AiGatewayOpsModelOverride[];
  dispatchPolicy?: AiGatewayDispatchPolicy;
  rollout?: AiGatewayRolloutControl;
  updatedAt?: string | null;
  updatedByUserId?: string | null;
  source?: string | null;
  path?: string | null;
  storage?: string | null;
};

export type AiGatewayOpsControlResponse = {
  ok?: boolean;
  config: AiGatewayOpsControlConfig;
};

export type AiGatewayOpsControlActionInput = {
  kind: 'provider' | 'model';
  key: string;
  reason?: string | null;
  ttlMinutes?: number;
};

export type CreateAiJobInput = {
  id?: string;
  modality: AiJobModality | '3d' | 'audio';
  capability?: string;
  provider?: string;
  model?: string;
  canonicalModelId?: string;
  registryId?: string;
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

function pickModelId(input: CreateAiJobInput): string | undefined {
  const nested = input.input || {};
  const candidates = [
    input.canonicalModelId,
    input.registryId,
    input.model,
    nested.canonicalModelId,
    nested.registryId,
    nested.model,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function withCanonicalModel(input: CreateAiJobInput): CreateAiJobInput {
  const rawModelId = pickModelId(input);
  if (!rawModelId) return input;
  const canonicalModelId = resolveCanonicalModelId(rawModelId) || rawModelId;
  const registryId = input.registryId || (typeof input.input.registryId === 'string' ? input.input.registryId : rawModelId);
  return {
    ...input,
    canonicalModelId,
    registryId,
    metadata: {
      ...input.metadata,
      canonicalModelId,
      registryId,
    },
  };
}

function createClientAiJobId(): string {
  try {
    const id = globalThis.crypto?.randomUUID?.();
    if (id) return `aijob_client_${id}`;
  } catch {
    /* ignore */
  }
  return `aijob_client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function withClientJobId(input: CreateAiJobInput): CreateAiJobInput {
  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : createClientAiJobId();
  return { ...input, id };
}

function hasCreditsReserveHeader(headers: HeadersInit | undefined): boolean {
  if (!headers) return false;
  if (headers instanceof Headers) return Boolean(headers.get('X-AC-Credits-Reserve'));
  if (Array.isArray(headers)) {
    return headers.some(([key, value]) => key.toLowerCase() === 'x-ac-credits-reserve' && String(value || '').trim());
  }
  return Boolean((headers as Record<string, string>)['X-AC-Credits-Reserve']?.trim());
}

function stripCreditsReserveHeaders(headers: HeadersInit | undefined): HeadersInit | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  const push = (key: string, value: string) => {
    const k = String(key || '').trim();
    if (!k.toLowerCase().startsWith('x-ac-credits-')) out[k] = String(value ?? '');
  };
  if (headers instanceof Headers) {
    headers.forEach((value, key) => push(key, value));
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) push(key, String(value ?? ''));
    return out;
  }
  for (const [key, value] of Object.entries(headers as Record<string, string>)) push(key, value);
  return out;
}

function isCreditsReserveInvalidError(err: unknown): boolean {
  return err instanceof HttpRequestError && err.code === 'CREDITS_RESERVE_INVALID';
}

function isNetworkRequestError(err: unknown): boolean {
  return err instanceof HttpRequestError && err.code === 'NETWORK_REQUEST_FAILED';
}

function aiJobCreateRetryDelayMs(attempt: number): number {
  const delays = [1500, 5000, 10000];
  return delays[Math.min(Math.max(0, attempt), delays.length - 1)] ?? 10000;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function createAiJob(input: CreateAiJobInput, init?: RequestInit) {
  const normalizedInput = withCanonicalModel(withClientJobId(input));
  const body = JSON.stringify(normalizedInput);
  const requestInit = {
    ...init,
    method: 'POST',
    body,
  };
  try {
    const maxNetworkRetries = 3;
    for (let attempt = 0; attempt <= maxNetworkRetries; attempt += 1) {
      try {
        return await requestJson<AiJobDetail>(apiUrl('/api/ai/jobs'), requestInit);
      } catch (err) {
        if (!isNetworkRequestError(err) || attempt >= maxNetworkRetries) throw err;
        await sleep(aiJobCreateRetryDelayMs(attempt), init?.signal ?? undefined);
      }
    }
    throw new Error('AI job creation retry exhausted');
  } catch (err) {
    if (!isCreditsReserveInvalidError(err) || !hasCreditsReserveHeader(init?.headers)) throw err;
    clearLastCreditsReserveKey();
    return requestJson<AiJobDetail>(apiUrl('/api/ai/jobs'), {
      ...requestInit,
      headers: stripCreditsReserveHeaders(init?.headers),
    });
  }
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
