/**
 * Gemini 异步 proxy 任务持久化与恢复（P1）：超时不断预扣，后台续 poll。
 */
import { readLocalJson, scopedStorageKey, writeLocalJson } from './clientPersist';
import { getGeminiFairnessUserId } from './geminiFairnessBridge';
import { releaseCreditReserve } from './creditsApi';

export const GEMINI_PENDING_ASYNC_JOBS_KEY = 'ac_gemini_pending_async_jobs';
export const GEMINI_ASYNC_RECOVERED_EVENT = 'ac:gemini-async-recovered';

const MAX_PENDING_JOBS = 30;
/** 超过此时间仍无结果则释放预扣并移除记录 */
export const GEMINI_PENDING_JOB_TTL_MS = 24 * 60 * 60 * 1000;

export type PendingGeminiAsyncJobStatus = 'polling' | 'recoverable' | 'completed' | 'failed';

export type PendingGeminiAsyncJob = {
  jobId: string;
  kind: 'async';
  model: string;
  registryId: string;
  prechargeKey?: string | null;
  workflowTaskId?: string | null;
  assetId?: string | null;
  projectId?: string | null;
  actionType?: string | null;
  useVertex?: boolean;
  status: PendingGeminiAsyncJobStatus;
  createdAt: number;
  lastPollAt?: number;
};

export type GeminiAsyncRecoveredDetail = {
  jobId: string;
  workflowTaskId?: string | null;
  assetId?: string | null;
  projectId?: string | null;
  actionType?: string | null;
  result: { text?: string; candidates?: unknown[]; usageMetadata?: unknown };
};

export class GeminiAsyncPollTimeoutError extends Error {
  readonly code = 'GEMINI_ASYNC_POLL_TIMEOUT';
  readonly jobId: string;
  readonly recoverable = true;

  constructor(jobId: string, maxPollMs: number) {
    super(
      `Gemini 任务仍在云端处理中（已等待约 ${Math.round(maxPollMs / 1000)} 秒）。系统将自动继续等待结果；您也可刷新页面后恢复。任务 ID：${jobId}`
    );
    this.name = 'GeminiAsyncPollTimeoutError';
    this.jobId = jobId;
  }
}

export function isGeminiAsyncPollTimeoutError(err: unknown): err is GeminiAsyncPollTimeoutError {
  if (err instanceof GeminiAsyncPollTimeoutError) return true;
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: string }).code;
    return code === 'GEMINI_ASYNC_POLL_TIMEOUT';
  }
  return false;
}

/** create 后短时内 poll 404：覆盖 Render free 冷启动/瞬时重启；超时后才判失败 */
export const GEMINI_ASYNC_JOB_NOT_FOUND_GRACE_MS = 45_000;

export function isGeminiAsyncJobNotFoundPoll(status: number, bodyText: string): boolean {
  if (status !== 404) return false;
  const raw = String(bodyText || '').trim();
  if (/Job not found or expired/i.test(raw)) return true;
  try {
    const j = JSON.parse(raw) as { error?: unknown };
    return /Job not found or expired/i.test(String(j.error || ''));
  } catch {
    return false;
  }
}

export function geminiAsyncJobNotFoundUserMessage(): string {
  return (
    '生图任务在代理上已丢失（常见于 Render 冷启动/重启，或 create/poll 打到不同实例）。' +
    '请重新运行一次；本地稳定调试可在 .env.local 设 VITE_AI_WORKER_PROXY_API=same-origin 并 npm run dev:ai-worker-proxy。'
  );
}

/** create 后 ageMs 内对 job-not-found 继续轮询；未知创建时间则不宽限 */
export function shouldGraceRetryGeminiAsyncJobNotFound(createdAt: number | null | undefined): boolean {
  const t = Number(createdAt);
  if (!Number.isFinite(t) || t <= 0) return false;
  return Date.now() - t < GEMINI_ASYNC_JOB_NOT_FOUND_GRACE_MS;
}

type JobsPayload = { version: 1; jobs: PendingGeminiAsyncJob[] };

function jobsStorageKey(): string {
  return scopedStorageKey(GEMINI_PENDING_ASYNC_JOBS_KEY, getGeminiFairnessUserId());
}

function parseJobsPayload(parsed: unknown): JobsPayload | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as JobsPayload;
  if (p.version !== 1 || !Array.isArray(p.jobs)) return null;
  return p;
}

function readJobsPayload(): JobsPayload {
  return readLocalJson<JobsPayload>(
    jobsStorageKey(),
    { version: 1, jobs: [] },
    parseJobsPayload
  );
}

function writeJobsPayload(payload: JobsPayload): void {
  writeLocalJson(jobsStorageKey(), payload);
}

export function listPendingGeminiAsyncJobs(): PendingGeminiAsyncJob[] {
  return readJobsPayload().jobs.filter((j) => j.status === 'polling' || j.status === 'recoverable');
}

export function getPendingGeminiAsyncJob(jobId: string): PendingGeminiAsyncJob | null {
  const id = String(jobId || '').trim();
  if (!id) return null;
  return readJobsPayload().jobs.find((j) => j.jobId === id) ?? null;
}

export function upsertPendingGeminiAsyncJob(job: Omit<PendingGeminiAsyncJob, 'createdAt' | 'status'> & {
  status?: PendingGeminiAsyncJobStatus;
  createdAt?: number;
}): PendingGeminiAsyncJob {
  const payload = readJobsPayload();
  const now = Date.now();
  const row: PendingGeminiAsyncJob = {
    ...job,
    jobId: String(job.jobId).trim(),
    status: job.status ?? 'polling',
    createdAt: job.createdAt ?? now,
    lastPollAt: now,
  };
  const idx = payload.jobs.findIndex((j) => j.jobId === row.jobId);
  if (idx >= 0) payload.jobs[idx] = { ...payload.jobs[idx], ...row };
  else payload.jobs.unshift(row);
  payload.jobs = payload.jobs
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_PENDING_JOBS);
  writeJobsPayload(payload);
  return row;
}

export function markGeminiAsyncJobRecoverable(jobId: string): void {
  const payload = readJobsPayload();
  const row = payload.jobs.find((j) => j.jobId === jobId);
  if (!row) return;
  row.status = 'recoverable';
  row.lastPollAt = Date.now();
  writeJobsPayload(payload);
}

export function touchGeminiAsyncJobPoll(jobId: string): void {
  const payload = readJobsPayload();
  const row = payload.jobs.find((j) => j.jobId === jobId);
  if (!row) return;
  row.lastPollAt = Date.now();
  writeJobsPayload(payload);
}

export function removePendingGeminiAsyncJob(jobId: string): void {
  const id = String(jobId || '').trim();
  if (!id) return;
  const payload = readJobsPayload();
  payload.jobs = payload.jobs.filter((j) => j.jobId !== id);
  writeJobsPayload(payload);
}

export function dispatchGeminiAsyncRecovered(detail: GeminiAsyncRecoveredDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GEMINI_ASYNC_RECOVERED_EVENT, { detail }));
}

/** 过期任务：释放预扣并删除记录 */
export async function expireStaleGeminiAsyncJobs(): Promise<number> {
  const payload = readJobsPayload();
  const now = Date.now();
  let n = 0;
  const keep: PendingGeminiAsyncJob[] = [];
  for (const job of payload.jobs) {
    const age = now - job.createdAt;
    const stale =
      age > GEMINI_PENDING_JOB_TTL_MS &&
      (job.status === 'recoverable' || job.status === 'polling');
    if (stale) {
      if (job.prechargeKey) {
        await releaseCreditReserve(job.prechargeKey, { fullVoid: true });
      }
      n += 1;
      continue;
    }
    keep.push(job);
  }
  if (n > 0) {
    writeJobsPayload({ version: 1, jobs: keep });
  }
  return n;
}
