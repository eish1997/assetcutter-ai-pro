function readAiWorkerProxyEnvTrim(key: string): string {
  try {
    const viteValue = String(
      ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key] || "").trim()
    );
    if (viteValue) return viteValue;
  } catch {
    /* ignore */
  }
  try {
    return String((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key] || "").trim();
  } catch {
    return "";
  }
}

export function hasGeminiImageProxyConfigured(): boolean {
  return Boolean(
    readAiWorkerProxyEnvTrim("VITE_AI_WORKER_PROXY_API") ||
      readAiWorkerProxyEnvTrim("VITE_AI_WORKER_PROXY_API_VERTEX") ||
      readAiWorkerProxyEnvTrim("VITE_VERTEX_FALLBACK_AI_WORKER_PROXY_API")
  );
}
