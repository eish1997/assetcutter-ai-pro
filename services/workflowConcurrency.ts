/** 工作流批处理本地并发上限（每浏览器 tab）；可通过 VITE_WORKFLOW_MAX_CONCURRENCY 覆盖。 */
const WORKFLOW_MAX_CONCURRENCY_DEFAULT = 3;

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
