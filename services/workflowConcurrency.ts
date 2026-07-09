/** 工作流批处理本地并发上限（每浏览器 tab）；可通过 VITE_WORKFLOW_MAX_CONCURRENCY 覆盖。 */
const WORKFLOW_MAX_CONCURRENCY_DEFAULT = 3;
/** 开「理解」时生图批并发上限（理解+生图各打上游，易触 RPM） */
const WORKFLOW_UNDERSTAND_IMAGE_CONCURRENCY_DEFAULT = 1;

function readViteEnvInt(key: string): number | null {
  try {
    const raw = String(
      ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key] || "").trim()
    );
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.floor(n);
  } catch {
    return null;
  }
}

/** @returns 1～8，默认 3 */
export function getWorkflowMaxConcurrency(): number {
  const raw = readViteEnvInt("VITE_WORKFLOW_MAX_CONCURRENCY");
  const base = raw ?? WORKFLOW_MAX_CONCURRENCY_DEFAULT;
  return Math.max(1, Math.min(8, base));
}

/**
 * 生图批在「理解」开启时的并发上限（默认 1，偏串行）。
 * 直发仍用 getGeminiImageBatchBoxSizeForCurrentProvider。
 */
export function getWorkflowUnderstandImageConcurrency(): number {
  const raw = readViteEnvInt("VITE_WORKFLOW_UNDERSTAND_IMAGE_CONCURRENCY");
  const base = raw ?? WORKFLOW_UNDERSTAND_IMAGE_CONCURRENCY_DEFAULT;
  return Math.max(1, Math.min(4, base));
}
