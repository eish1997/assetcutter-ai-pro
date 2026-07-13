/** Shared retry classification for gemini-proxy (429/503/504 etc.). */

export function isUpstreamRateLimitError(e) {
  const msg = String((e && e.message) || e);
  if (/too many requests/i.test(msg)) return true;
  if (/\bRESOURCE_EXHAUSTED\b/i.test(msg)) return true;
  const code = e && e.code;
  const status = e && e.status;
  if (code === 429 || status === 'RESOURCE_EXHAUSTED') return true;
  try {
    const j = typeof msg === 'string' && msg.startsWith('{') ? JSON.parse(msg) : null;
    if (j?.error?.code === 429 || j?.error?.status === 'RESOURCE_EXHAUSTED') return true;
  } catch {
    /* ignore */
  }
  return /\b429\b/.test(msg) && !/rate_limited/i.test(msg);
}

export function isRetryable(e) {
  // 上游 429 可重试，但次数由 geminiProxyMaxAttempts 严格限制（默认仅 2 次、长退避）
  if (isUpstreamRateLimitError(e)) return true;
  const msg = String((e && e.message) || e);
  if (/503|504|overloaded|UNAVAILABLE|DEADLINE_EXCEEDED|Deadline expired|500|INTERNAL|Internal error|high demand|try again later|The operation was cancelled|operation was canceled|CANCELLED/i.test(msg)) return true;
  const code = e && e.code;
  const status = e && e.status;
  if (code === 504 || code === 503 || status === 'DEADLINE_EXCEEDED' || status === 'UNAVAILABLE') return true;
  try {
    const j = typeof msg === 'string' && msg.startsWith('{') ? JSON.parse(msg) : null;
    if (j?.error?.code === 504 || j?.error?.code === 503 || j?.error?.status === 'DEADLINE_EXCEEDED' || j?.error?.status === 'UNAVAILABLE') return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** 429 用更长退避、更少次数；503 等仍用指数退避。 */
export function geminiProxyRetryDelayMs(err, attempt) {
  if (isUpstreamRateLimitError(err)) {
    // ~35s → 60s → 85s（上限 90s），避免连点打穿共享配额
    return Math.min(180_000, 65_000 + Math.max(0, attempt) * 30_000);
  }
  return Math.min(30_000, 5000 * Math.pow(2, Math.max(0, attempt)));
}

export function geminiProxyMaxAttempts(err, overloadMaxAttempts) {
  if (isUpstreamRateLimitError(err)) {
    const n = Number(process.env.GEMINI_PROXY_RATE_LIMIT_RETRIES);
    // 默认 2 次重试（共 3 次尝试）；设 0 可关闭上游 429 重试
    const retries = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
    return retries + 1;
  }
  return overloadMaxAttempts;
}
