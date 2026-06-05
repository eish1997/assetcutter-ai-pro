/**
 * Gemini 代理 async job 排队进度：轮询 `queueMeta` 时节流派发，供 App 全局日志等订阅。
 */
export type GeminiQueueMeta = {
  userAhead: number;
  globalQueuedApprox: number;
  globalRunning: number;
  userQueued: number;
  userRunning: number;
  waitSecEstimate?: number;
};

export const AC_GEMINI_QUEUE_PROGRESS_EVENT = "ac:gemini-proxy-queue-progress" as const;

export type AcGeminiQueueProgressDetail = {
  jobId: string;
  status: "queued" | "running";
  queueMeta: GeminiQueueMeta;
  waitedMs: number;
};

export const AC_GEMINI_QUEUE_RETRY_WAIT_EVENT = "ac:gemini-proxy-queue-retry-wait" as const;

export type AcGeminiQueueRetryWaitDetail = {
  retryAfterSec: number;
  attempt: number;
  maxAttempts: number;
};

export function formatGeminiQueueProgressLog(d: AcGeminiQueueProgressDetail): string {
  const { queueMeta, status, waitedMs } = d;
  const waitedSec = Math.max(0, Math.floor(waitedMs / 1000));
  if (status === "running") {
    return `代理已开始执行上游请求（排队已等 ${waitedSec}s）`;
  }
  const ahead = Math.max(0, Math.floor(queueMeta.userAhead));
  const global = Math.max(0, Math.floor(queueMeta.globalQueuedApprox));
  let msg = `代理排队中（全站约 ${global} 个等待`;
  if (ahead > 0) msg += `，你前面约 ${ahead} 个`;
  msg += `）· 已等 ${waitedSec}s`;
  const est = queueMeta.waitSecEstimate;
  if (est != null && Number.isFinite(est) && est > 0) {
    msg += ` · 预估还需约 ${Math.ceil(est)}s`;
  }
  return msg;
}

export function formatGeminiFairnessRetryWaitLog(d: AcGeminiQueueRetryWaitDetail): string {
  const sec = Math.max(1, Math.ceil(d.retryAfterSec));
  return `公平队列繁忙，约 ${sec}s 后自动重试（${d.attempt}/${d.maxAttempts}）`;
}

export function dispatchGeminiQueueProgress(detail: AcGeminiQueueProgressDetail): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(AC_GEMINI_QUEUE_PROGRESS_EVENT, { detail }));
  } catch {
    /* ignore */
  }
}

export function dispatchGeminiFairnessRetryWait(detail: AcGeminiQueueRetryWaitDetail): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(AC_GEMINI_QUEUE_RETRY_WAIT_EVENT, { detail }));
  } catch {
    /* ignore */
  }
}
