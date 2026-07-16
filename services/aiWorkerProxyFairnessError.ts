/**
 * ai-worker-proxy 在 `GEMINI_FAIRNESS_ENABLED` 下对准入拒绝返回的结构化错误（429 / 503 + JSON body）。
 * 供 `geminiService` 抛出、`unifiedAiGateway` 调试分类、以及 **`throwFairnessRejected`** → 全局浮层（`GeminiFairnessFloatingNotice`）使用。
 */
export class AiWorkerProxyFairnessRejectedError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec?: number;

  constructor(opts: { status: number; code: string; message: string; retryAfterSec?: number | undefined }) {
    super(opts.message);
    this.name = "AiWorkerProxyFairnessRejectedError";
    this.status = opts.status;
    this.code = opts.code;
    if (opts.retryAfterSec != null && Number.isFinite(Number(opts.retryAfterSec))) {
      this.retryAfterSec = Math.ceil(Number(opts.retryAfterSec));
    }
  }
}

export function isAiWorkerProxyFairnessRejectedError(e: unknown): e is AiWorkerProxyFairnessRejectedError {
  return e instanceof AiWorkerProxyFairnessRejectedError;
}

/** 与 `GeminiFairnessFloatingNotice` 约定一致；业务侧一般不需直接监听。 */
export const AC_AI_WORKER_FAIRNESS_REJECTED_EVENT = "ac:ai-worker-proxy-fairness-rejected" as const;

export type AcGeminiFairnessRejectedDetail = {
  message: string;
  code: string;
  status: number;
  retryAfterSec?: number;
};

/** 派发全局 UI 事件后抛出同一错误（供 `geminiService` 在代理拒绝路径使用）。 */
export function throwFairnessRejected(err: AiWorkerProxyFairnessRejectedError): never {
  if (typeof window !== "undefined") {
    try {
      const detail: AcGeminiFairnessRejectedDetail = {
        message: err.message,
        code: err.code,
        status: err.status,
        ...(err.retryAfterSec != null ? { retryAfterSec: err.retryAfterSec } : {}),
      };
      window.dispatchEvent(new CustomEvent(AC_AI_WORKER_FAIRNESS_REJECTED_EVENT, { detail }));
    } catch {
      /* ignore */
    }
  }
  throw err;
}

/** 仅当 body 含本站公平队列约定字段时返回实例，否则 null（避免把 Google 429 误判为应用层公平拒绝）。 */
export function tryParseAiWorkerProxyFairnessRejected(status: number, text: string): AiWorkerProxyFairnessRejectedError | null {
  const raw = (text || "").trim();
  let j: { error?: string; message?: string; retryAfterSec?: number };
  try {
    j = JSON.parse(raw) as typeof j;
  } catch {
    return null;
  }
  const code = typeof j.error === "string" ? j.error.trim() : "";
  if (code !== "rate_limited" && code !== "queue_overflow") return null;
  const msg =
    (typeof j.message === "string" && j.message.trim()) ||
    (code === "queue_overflow" ? "队列已满，请稍后重试" : "请求过于频繁，请稍后重试");
  const ra = j.retryAfterSec;
  const retryAfterSec = ra != null && Number.isFinite(Number(ra)) ? Math.ceil(Number(ra)) : undefined;
  const withHint =
    retryAfterSec != null && retryAfterSec > 0 ? `${msg}（约 ${retryAfterSec} 秒后可重试）` : msg;
  return new AiWorkerProxyFairnessRejectedError({ status, code, message: withHint, retryAfterSec });
}
