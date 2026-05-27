function readBulkEnvTrim(key: string): string {
  try {
    return String(
      ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key] || "").trim()
    );
  } catch {
    return "";
  }
}

/** Gemini 生图是否可走构建时配置的 bulk 代理 */
export function hasGeminiImageProxyConfigured(): boolean {
  const bulk = readBulkEnvTrim("VITE_BULK_IMAGE_API");
  const bulkVertex = readBulkEnvTrim("VITE_BULK_IMAGE_API_VERTEX");
  return Boolean(bulk || bulkVertex);
}
