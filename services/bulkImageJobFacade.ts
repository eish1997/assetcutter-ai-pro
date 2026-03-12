/**
 * 批量出图门面：根据 VITE_BULK_IMAGE_API 切换后端 API 或本地执行器。
 * 有后端时：全公司 RPD 900 + 并发 2、Job 持久化；优先使用前端传入的 Gemini Key。
 */
import { getApiKey, getBulkUserId } from './settingsStore';
import type { ImageJob } from '../types';

const BASE = typeof import.meta !== 'undefined' && import.meta.env && String(import.meta.env.VITE_BULK_IMAGE_API || '').trim();

function apiUrl(path: string): string {
  const base = BASE.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : '/' + path}`;
}

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = (data && typeof data.error === 'string' ? data.error : res.statusText) || 'Request failed';
    throw new Error(msg);
  }
  return data as T;
}

// ---------- 后端模式实现 ----------
async function createImageJobRemote(
  instruction: string,
  totalImages: number,
  options: { imageBase64?: string | null; model?: string; aspectRatio?: string; imageSize?: string; userId?: string } = {}
): Promise<ImageJob> {
  const apiKey = getApiKey() || undefined;
  const userId = options.userId || getBulkUserId();
  const body: Record<string, unknown> = {
    instruction,
    totalImages,
    imageBase64: options.imageBase64 ?? undefined,
    model: options.model,
    aspectRatio: options.aspectRatio,
    imageSize: options.imageSize,
  };
  if (userId) body.userId = userId;
  if (options.userId) body.userId = options.userId;
  if (apiKey) body.apiKey = apiKey;
  return fetchJson<ImageJob>('/jobs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function createImageJobContinueRemote(originalJob: ImageJob): Promise<ImageJob> {
  return fetchJson<ImageJob>(`/jobs/${originalJob.id}`).then((latest) => {
    const resultCount = Array.isArray(latest.results) ? latest.results.length : 0;
    const total = Number(latest.totalImages) || 0;
    const remaining = total - resultCount;
    if (remaining <= 0) throw new Error('该任务已无剩余张数可继续生成');
    const instr = typeof latest.instruction === 'string' ? latest.instruction.trim() : '';
    if (!instr) throw new Error('原任务指令无效，无法继续');
    return createImageJobRemote(instr, remaining, {
      imageBase64: latest.imageBase64 ?? undefined,
      model: latest.model,
      aspectRatio: latest.aspectRatio,
      imageSize: latest.imageSize,
    });
  });
}

async function cancelImageJobRemote(id: string): Promise<void> {
  await fetchJson(`/jobs/${id}/cancel`, { method: 'POST' });
}

async function getImageJobRemote(id: string): Promise<ImageJob | undefined> {
  try {
    return await fetchJson<ImageJob>(`/jobs/${id}`);
  } catch {
    return undefined;
  }
}

async function getAllImageJobsRemote(): Promise<ImageJob[]> {
  return fetchJson<ImageJob[]>('/jobs');
}

const POLL_INTERVAL_MS = 2000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const remoteListeners = new Set<() => void>();

function subscribeImageJobsRemote(listener: () => void): () => void {
  remoteListeners.add(listener);
  if (!pollTimer) {
    const tick = () => {
      refreshRemoteRpd();
      remoteListeners.forEach((cb) => cb());
    };
    tick();
    pollTimer = setInterval(tick, POLL_INTERVAL_MS);
  }
  return () => {
    remoteListeners.delete(listener);
    if (remoteListeners.size === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

async function getBulkImageTodayRPDRemote(): Promise<number> {
  const r = await fetchJson<{ today: number }>('/rpd');
  return r.today;
}

async function getBulkImageRPDLimitRemote(): Promise<number> {
  const r = await fetchJson<{ limit: number }>('/rpd');
  return r.limit;
}

const REMOTE_MAX_IMAGES_PER_JOB = 30;

// ---------- 门面导出：有 BASE 时用远程，否则用本地；异步接口统一为 Promise ----------
import * as local from './imageJobExecutor';

export function getBulkImageMode(): 'backend' | 'local' {
  return BASE ? 'backend' : 'local';
}

export function getBulkImageMaxImagesPerJob(): number {
  return REMOTE_MAX_IMAGES_PER_JOB;
}

export function createImageJob(
  instruction: string,
  totalImages: number,
  options?: Parameters<typeof local.createImageJob>[2]
): Promise<ImageJob> {
  if (BASE) return createImageJobRemote(instruction, totalImages, options || {});
  return Promise.resolve(local.createImageJob(instruction, totalImages, options));
}

export function createImageJobContinue(originalJob: ImageJob): Promise<ImageJob> {
  if (BASE) return createImageJobContinueRemote(originalJob);
  return Promise.resolve(local.createImageJobContinue(originalJob));
}

export function cancelImageJob(id: string): void | Promise<void> {
  if (BASE) return cancelImageJobRemote(id);
  local.cancelImageJob(id);
}

export function getImageJob(id: string): ImageJob | undefined | Promise<ImageJob | undefined> {
  if (BASE) return getImageJobRemote(id);
  return local.getImageJob(id);
}

export function getAllImageJobs(): Promise<ImageJob[]> {
  if (BASE) return getAllImageJobsRemote();
  return Promise.resolve(local.getAllImageJobs());
}

export function subscribeImageJobs(listener: () => void): () => void {
  if (BASE) return subscribeImageJobsRemote(listener);
  return local.subscribeImageJobs(listener);
}

// RPD：后端为异步，前端展示需兼容；门面提供同步版本（仅本地有值）与异步能力
let remoteRpdCache = { today: 0, limit: 900 };
let remoteRpdPromise: Promise<void> | null = null;

function refreshRemoteRpd(): Promise<void> {
  if (!BASE) return Promise.resolve();
  if (!remoteRpdPromise) {
    remoteRpdPromise = Promise.all([getBulkImageTodayRPDRemote(), getBulkImageRPDLimitRemote()]).then(
      ([today, limit]) => {
        remoteRpdCache = { today, limit };
        remoteRpdPromise = null;
      }
    );
  }
  return remoteRpdPromise;
}

export function getBulkImageTodayRPD(): number {
  if (BASE) {
    refreshRemoteRpd();
    return remoteRpdCache.today;
  }
  return local.getBulkImageTodayRPD();
}

export function getBulkImageRPDLimit(): number {
  if (BASE) {
    refreshRemoteRpd();
    return remoteRpdCache.limit;
  }
  return local.getBulkImageRPDLimit();
}

// 供需要异步 RPD 的调用方（可选）：拉取最新后更新缓存，再返回
export async function refreshBulkImageRpd(): Promise<{ today: number; limit: number }> {
  if (BASE) {
    const [today, limit] = await Promise.all([getBulkImageTodayRPDRemote(), getBulkImageRPDLimitRemote()]);
    remoteRpdCache = { today, limit };
    return { today, limit };
  }
  return { today: local.getBulkImageTodayRPD(), limit: local.getBulkImageRPDLimit() };
}
