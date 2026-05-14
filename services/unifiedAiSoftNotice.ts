/**
 * `workflow*` 经 `unifiedAiGateway.traceUnifiedAiCall` 捕获的非「公平拒绝」类限流/繁忙错误，
 * 通过 CustomEvent 交给根组件浮层（与 `geminiProxyFairnessError` 的公平拒绝事件分离）。
 */

export const AC_UNIFIED_AI_SOFT_NOTICE_EVENT = "ac:unified-ai-soft-notice" as const;

export type AcUnifiedAiSoftNoticeKind = "rate_limit" | "upstream_busy";

export type AcUnifiedAiSoftNoticeDetail = {
  kind: AcUnifiedAiSoftNoticeKind;
  message: string;
  /** 可选：对应 `UnifiedAiJobKind`，便于排障 */
  jobKind?: string;
};

const SOFT_MIN_GAP_MS = 14_000;
const lastFiredAt: Partial<Record<AcUnifiedAiSoftNoticeKind, number>> = {};

export function clipUnifiedAiNoticeMessage(message: string, maxLen = 220): string {
  const t = message.replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

/** 同 kind 节流，避免重试风暴刷屏；仅浏览器环境生效。 */
export function dispatchUnifiedAiSoftNotice(detail: AcUnifiedAiSoftNoticeDetail): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const last = lastFiredAt[detail.kind] ?? 0;
  if (now - last < SOFT_MIN_GAP_MS) return;
  lastFiredAt[detail.kind] = now;
  const message = clipUnifiedAiNoticeMessage(detail.message);
  if (!message) return;
  try {
    window.dispatchEvent(new CustomEvent(AC_UNIFIED_AI_SOFT_NOTICE_EVENT, { detail: { ...detail, message } }));
  } catch {
    /* ignore */
  }
}
