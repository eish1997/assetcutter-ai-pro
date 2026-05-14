/**
 * 本地 `npm run dev`：浏览器直连公网 gemini-proxy 常因 CORS（PROXY_ALLOWED_ORIGINS 未含 localhost）报 Failed to fetch。
 * 与 `vite.config.ts` 共用：Vite 将 `/__ac-bulk-forward/{i}/...` 转发到 `origins[i]`。
 */
const DEFAULT_VERTEX_FALLBACK_ORIGIN = "https://assetcutter-gemini-proxy.onrender.com";

function pushOrigin(out: string[], raw: string | undefined): void {
  if (typeof raw !== "string") return;
  const t = raw.trim();
  if (!t) return;
  const low = t.toLowerCase();
  if (low === "1" || low === "true" || low === "same-origin") return;
  let u: URL;
  try {
    u = /^https?:\/\//i.test(t) ? new URL(t) : new URL(`https://${t}`);
  } catch {
    return;
  }
  if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return;
  const o = u.origin;
  if (!out.includes(o)) out.push(o);
}

/** 从构建/运行环境变量收集「可经 dev 转发」的公网 bulk 根（origin 列表，顺序稳定）。 */
export function collectRemoteBulkOriginsFromEnv(env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  pushOrigin(out, env.VITE_BULK_IMAGE_API);
  pushOrigin(out, env.VITE_BULK_IMAGE_API_VERTEX);
  pushOrigin(out, env.VITE_VERTEX_FALLBACK_BULK_API);
  pushOrigin(out, DEFAULT_VERTEX_FALLBACK_ORIGIN);
  return out;
}

/** `baseResolved` 为完整 http(s) bulk 根时，返回其在 `origins` 中的下标；-1 表示不走 dev 转发。 */
export function bulkForwardOriginIndex(baseResolved: string, origins: readonly string[]): number {
  try {
    const t = baseResolved.trim();
    const u = /^https?:\/\//i.test(t) ? new URL(t) : new URL(`https://${t}`);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return -1;
    return origins.indexOf(u.origin);
  } catch {
    return -1;
  }
}
