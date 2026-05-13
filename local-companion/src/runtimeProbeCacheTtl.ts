/**
 * `GET /v1/runtime-status` 内 Sam/rembg 探测的短缓存 TTL（毫秒）。
 * 环境变量 `COMPANION_RUNTIME_PROBE_CACHE_MS`：`0` 或负数表示关闭缓存；未设置默认 8000；合法范围 500～120000。
 */
export function parseRuntimeProbeCacheTtlMs(): number {
  const raw = process.env.COMPANION_RUNTIME_PROBE_CACHE_MS?.trim();
  if (raw === '' || raw === undefined) return 8000;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 8000;
  if (n <= 0) return 0;
  return Math.min(120_000, Math.max(500, n));
}
