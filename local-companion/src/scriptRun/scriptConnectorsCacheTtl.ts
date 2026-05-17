/**
 * `GET /v1/script-connectors` 成功探测的短缓存（毫秒）；失败结果不缓存。
 * `COMPANION_SCRIPT_CONNECTORS_CACHE_MS`：未设置默认 4000；`0` 或负数关闭；合法范围 0～120000。
 */
export function parseScriptConnectorsCacheTtlMs(): number {
  const raw = process.env.COMPANION_SCRIPT_CONNECTORS_CACHE_MS?.trim();
  if (raw === '' || raw === undefined) return 4000;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 4000;
  if (n <= 0) return 0;
  return Math.min(120_000, n);
}
