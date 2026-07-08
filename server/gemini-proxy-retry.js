/** Shared retry classification for gemini-proxy (429/503/504 etc.). */

export function isRetryable(e) {
  const msg = String((e && e.message) || e);
  if (/429|503|504|overloaded|UNAVAILABLE|DEADLINE_EXCEEDED|Deadline expired|500|INTERNAL|Internal error|high demand|try again later|The operation was cancelled|operation was canceled|CANCELLED/i.test(msg)) return true;
  const code = e && e.code;
  const status = e && e.status;
  if (code === 504 || code === 503 || code === 429 || status === 'DEADLINE_EXCEEDED' || status === 'UNAVAILABLE') return true;
  try {
    const j = typeof msg === 'string' && msg.startsWith('{') ? JSON.parse(msg) : null;
    if (j?.error?.code === 504 || j?.error?.code === 503 || j?.error?.status === 'DEADLINE_EXCEEDED' || j?.error?.status === 'UNAVAILABLE') return true;
  } catch {
    /* ignore */
  }
  return false;
}
