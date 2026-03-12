/**
 * 批量出图任务执行器：分片请求、并发控制、RPD 限制。
 * 设计见 docs/BULK_IMAGE_JOB_DESIGN.md
 */
import { dialogGenerateImages } from './geminiService';
import type { ImageJob, ImageJobStatus } from '../types';

const BULK_IMAGE_RPD_DAILY_LIMIT = 900;
const BULK_IMAGE_MAX_CONCURRENT = 2;
const BULK_IMAGE_MAX_IMAGES_PER_JOB = 30;
/** 单次请求期望张数（≤10），实际以 API 返回为准 */
const IMAGES_PER_REQUEST = 4;
/** 429/503 等可重试错误最多重试次数 */
const JOB_STEP_RETRIES = 2;
const JOB_STEP_RETRY_DELAY_MS = 2000;
/** 是否限制：同时只允许 1 个批量任务在运行/排队（近似「每用户 1 个」） */
const ONE_BULK_JOB_AT_A_TIME = true;
const RPD_STORAGE_KEY_PREFIX = 'ac_bulk_image_rpd_';

function isRetryableApiError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return (
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('overloaded') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('500') ||
    msg.includes('INTERNAL') ||
    msg.includes('Internal error')
  );
}

/** 可被 AbortSignal 提前中断的 sleep，用于重试退避时响应取消 */
function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('请求已取消'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(Object.assign(new Error('请求已取消'), { name: 'AbortError' }));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function getTodayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${RPD_STORAGE_KEY_PREFIX}${y}-${m}-${d}`;
}

function getTodayRPD(): number {
  if (typeof localStorage === 'undefined') return 0;
  const raw = localStorage.getItem(getTodayKey());
  const n = parseInt(raw ?? '0', 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function incrementTodayRPD(): void {
  if (typeof localStorage === 'undefined') return;
  const key = getTodayKey();
  const next = getTodayRPD() + 1;
  localStorage.setItem(key, String(next));
}

export function getBulkImageRPDLimit(): number {
  return BULK_IMAGE_RPD_DAILY_LIMIT;
}

export function getBulkImageTodayRPD(): number {
  return getTodayRPD();
}

export function getBulkImageMaxImagesPerJob(): number {
  return BULK_IMAGE_MAX_IMAGES_PER_JOB;
}

type Step = {
  jobId: string;
  instruction: string;
  imageBase64: string | null;
  model: string;
  batchSize: number;
  aspectRatio?: string;
  imageSize?: string;
};

const jobs = new Map<string, ImageJob>();
const pendingSteps: Step[] = [];
const jobAbortControllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let inFlight = 0;

function notifyListeners(): void {
  listeners.forEach((cb) => cb());
}

type JobUpdater = (prev: ImageJob) => Partial<ImageJob>;

/** 返回是否实际写入了更新（用于调用方决定是否计 RPD 等） */
function updateJob(id: string, patchOrUpdater: Partial<ImageJob> | JobUpdater): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(job) : patchOrUpdater;
  if (!patch || Object.keys(patch).length === 0) return false;
  const next: ImageJob = {
    ...job,
    ...patch,
    updatedAt: Date.now(),
  };
  jobs.set(id, next);
  notifyListeners();
  return true;
}

function deriveStatus(job: ImageJob, hasError: boolean): ImageJobStatus {
  if (job.status === 'cancelled') return 'cancelled';
  const done = Array.isArray(job.results) ? job.results.length : 0;
  const total = Number(job.totalImages) || 0;
  if (total <= 0) return hasError ? 'failed' : 'running';
  if (done === 0 && hasError) return 'failed';
  if (done >= total) return 'completed';
  if (done > 0 && hasError) return 'partial';
  return 'running';
}

async function runStepWithRetry(step: Step, signal: AbortSignal): Promise<string[]> {
  const opts = step.aspectRatio || step.imageSize
    ? { aspectRatio: step.aspectRatio, imageSize: step.imageSize }
    : undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= JOB_STEP_RETRIES; attempt++) {
    if (signal.aborted) throw Object.assign(new Error('请求已取消'), { name: 'AbortError' });
    try {
      return await dialogGenerateImages(
        step.imageBase64,
        step.instruction,
        step.batchSize,
        step.model,
        opts,
        undefined,
        signal
      );
    } catch (e) {
      lastErr = e;
      if (attempt < JOB_STEP_RETRIES && isRetryableApiError(e)) {
        const delay = JOB_STEP_RETRY_DELAY_MS * Math.pow(2, attempt);
        try {
          await sleepWithAbort(delay, signal);
        } catch (abortErr) {
          throw abortErr;
        }
      } else {
        throw e;
      }
    }
  }
  throw lastErr;
}

function processQueue(): void {
  while (inFlight < BULK_IMAGE_MAX_CONCURRENT && pendingSteps.length > 0) {
    const step = pendingSteps.shift()!;
    const job = jobs.get(step.jobId);
    if (!job || job.status === 'cancelled') {
      processQueue();
      continue;
    }
    let controller = jobAbortControllers.get(step.jobId);
    if (!controller) {
      controller = new AbortController();
      jobAbortControllers.set(step.jobId, controller);
    }
    inFlight++;
    if (job.status === 'pending') {
      updateJob(step.jobId, { status: 'running' });
    }
    runStepWithRetry(step, controller.signal)
      .then((images) => {
        const applied = updateJob(step.jobId, (prev) => {
          if (prev.status === 'cancelled') return {};
          const nextResults = [...(prev.results ?? []), ...images].slice(0, prev.totalImages);
          return {
            results: nextResults,
            status: deriveStatus({ ...prev, results: nextResults }, false),
            errorSummary: undefined,
          };
        });
        if (applied) incrementTodayRPD();
      })
      .catch((err) => {
        const j = jobs.get(step.jobId);
        if (!j || j.status === 'cancelled') return;
        const message = err?.message ?? String(err);
        const isAbort = message.includes('取消') || err?.name === 'AbortError';
        if (isAbort) return;
        updateJob(step.jobId, (prev) => {
          if (prev.status === 'cancelled') return {};
          const nextStatus = deriveStatus(prev, true);
          return {
            status: nextStatus,
            errorSummary: message.length > 80 ? message.slice(0, 80) + '…' : message,
          };
        });
      })
      .finally(() => {
        inFlight--;
        processQueue();
      });
  }
}

export type CreateImageJobOptions = {
  imageBase64?: string | null;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
};

function hasAnyJobPendingOrRunning(): boolean {
  for (const j of jobs.values()) {
    if (j.status === 'pending' || j.status === 'running') return true;
  }
  return false;
}

/**
 * 创建批量出图任务。若今日 RPD 已达上限或 totalImages 超限则抛错。
 * 当 ONE_BULK_JOB_AT_A_TIME 时，若已有任务在运行/排队则抛错。
 */
export function createImageJob(
  instruction: string,
  totalImages: number,
  options: CreateImageJobOptions = {}
): ImageJob {
  const trimmedInstruction = typeof instruction === 'string' ? instruction.trim() : '';
  if (!trimmedInstruction) {
    throw new Error('生图指令不能为空');
  }
  if (totalImages < 1 || totalImages > BULK_IMAGE_MAX_IMAGES_PER_JOB) {
    throw new Error(
      `单任务张数需在 1～${BULK_IMAGE_MAX_IMAGES_PER_JOB} 之间，当前为 ${totalImages}`
    );
  }
  if (ONE_BULK_JOB_AT_A_TIME && hasAnyJobPendingOrRunning()) {
    throw new Error('请等待当前批量任务完成后再新建');
  }
  const requestCount = Math.ceil(totalImages / IMAGES_PER_REQUEST);
  const today = getTodayRPD();
  if (today >= BULK_IMAGE_RPD_DAILY_LIMIT) {
    throw new Error('今日生图额度已用尽，请明日再试');
  }
  const remaining = BULK_IMAGE_RPD_DAILY_LIMIT - today;
  if (requestCount > remaining) {
    throw new Error(`今日剩余额度 ${remaining} 次请求，无法完成约 ${requestCount} 次请求`);
  }
  const id = `imgjob-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();
  const job: ImageJob = {
    id,
    instruction: trimmedInstruction,
    totalImages,
    status: 'pending',
    results: [],
    createdAt: now,
    updatedAt: now,
    imageBase64: options.imageBase64 ?? null,
    model: options.model,
    aspectRatio: options.aspectRatio,
    imageSize: options.imageSize,
  };
  jobs.set(id, job);
  const model = options.model ?? 'gemini-2.5-flash-image';
  for (let i = 0; i < requestCount; i++) {
    const batchSize = Math.min(IMAGES_PER_REQUEST, totalImages - i * IMAGES_PER_REQUEST);
    pendingSteps.push({
      jobId: id,
      instruction: trimmedInstruction,
      imageBase64: options.imageBase64 ?? null,
      model,
      batchSize,
      aspectRatio: options.aspectRatio,
      imageSize: options.imageSize,
    });
  }
  notifyListeners();
  processQueue();
  return job;
}

/**
 * 基于已完成/部分完成的任务，继续生成剩余张数（新建一个 Job，沿用原 instruction 与选项）。
 * 使用当前内存中的最新任务状态，避免快照滞后。
 */
export function createImageJobContinue(originalJob: ImageJob): ImageJob {
  if (!originalJob?.id) throw new Error('无效的任务引用');
  const latest = jobs.get(originalJob.id) ?? originalJob;
  const resultCount = Array.isArray(latest.results) ? latest.results.length : 0;
  const total = Number(latest.totalImages) || 0;
  const remaining = total - resultCount;
  if (remaining <= 0) {
    throw new Error('该任务已无剩余张数可继续生成');
  }
  const instr = typeof latest.instruction === 'string' ? latest.instruction.trim() : '';
  if (!instr) throw new Error('原任务指令无效，无法继续');
  return createImageJob(instr, remaining, {
    imageBase64: latest.imageBase64 ?? undefined,
    model: latest.model,
    aspectRatio: latest.aspectRatio,
    imageSize: latest.imageSize,
  });
}

/**
 * 取消任务：停止后续请求，已发出的请求可能仍会返回但不写入该任务。
 */
export function cancelImageJob(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return;
  jobAbortControllers.get(id)?.abort();
  jobAbortControllers.delete(id);
  for (let i = pendingSteps.length - 1; i >= 0; i--) {
    if (pendingSteps[i].jobId === id) pendingSteps.splice(i, 1);
  }
  updateJob(id, { status: 'cancelled' });
}

export function getImageJob(id: string): ImageJob | undefined {
  return jobs.get(id);
}

export function getAllImageJobs(): ImageJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function subscribeImageJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
