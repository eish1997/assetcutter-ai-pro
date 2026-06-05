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

export type GeminiQueueHintKind =
  | "proxy_session"
  | "job_submitted"
  | "job_waiting"
  | "job_direct"
  | "job_done_no_queue";

export const AC_GEMINI_QUEUE_HINT_EVENT = "ac:gemini-proxy-queue-hint" as const;

export type AcGeminiQueueHintDetail = {
  kind: GeminiQueueHintKind;
  jobId?: string;
  /** POST 创建响应里的 status（queued / pending 等） */
  createStatus?: string;
  fairnessEnabled?: boolean;
  globalQueuedApprox?: number;
  waitedMs?: number;
  batchSize?: number;
};

export function formatGeminiQueueProgressLog(d: AcGeminiQueueProgressDetail): string {
  const { queueMeta, status, waitedMs } = d;
  const waitedSec = Math.max(0, Math.floor(waitedMs / 1000));
  if (status === "running") {
    if (waitedSec <= 0) {
      return "代理已开始执行上游请求（当前无需排队）";
    }
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

export function formatGeminiQueueHintLog(d: AcGeminiQueueHintDetail): string {
  switch (d.kind) {
    case "proxy_session": {
      if (d.fairnessEnabled) {
        const g =
          d.globalQueuedApprox != null && Number.isFinite(d.globalQueuedApprox)
            ? `（全站当前约 ${Math.max(0, Math.floor(d.globalQueuedApprox))} 个在队/执行）`
            : "";
        return `AI 代理：公平排队已启用${g}。高峰可能排队，本栏会显示排队进度与限流重试。`;
      }
      return "AI 代理：公平排队未启用，仅全站并发槽保护上游；多人同时使用时仍可能变慢或触发上游限流。";
    }
    case "job_submitted": {
      const id = d.jobId ? ` · ${d.jobId.slice(0, 12)}…` : "";
      const batch =
        d.batchSize != null && d.batchSize > 1 ? ` · 批量 ${d.batchSize} 项` : "";
      if (d.createStatus === "queued") {
        return `任务已入公平队列${batch}${id}；若需等待，将在此显示排队进度。`;
      }
      return `任务已提交代理${batch}${id}；当前未进入公平队列，将尽快占用执行槽。`;
    }
    case "job_waiting":
      return "任务在代理侧排队调度中（暂无详细位次，稍后刷新）…";
    case "job_direct":
      return "已获得代理执行槽，正在请求上游（当前无需排队）。";
    case "job_done_no_queue": {
      const sec = Math.max(0, Math.floor((d.waitedMs ?? 0) / 1000));
      return sec > 0
        ? `代理任务已完成（全程未排队，耗时约 ${sec}s）。`
        : "代理任务已完成（全程未排队）。";
    }
    default:
      return "AI 代理任务状态更新";
  }
}

export function dispatchGeminiQueueHint(detail: AcGeminiQueueHintDetail): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(AC_GEMINI_QUEUE_HINT_EVENT, { detail }));
  } catch {
    /* ignore */
  }
}
