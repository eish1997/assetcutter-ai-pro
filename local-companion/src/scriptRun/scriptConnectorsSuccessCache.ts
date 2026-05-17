/**
 * script-connectors 成功探测短缓存（与 jobsStore 解耦，避免循环依赖）。
 * 在 script.maya 任务结束后须失效，否则易返回「执行前」的 OK 快照。
 */
let cache: { key: string; at: number; body: unknown } | null = null;

export function invalidateScriptConnectorsCache(): void {
  cache = null;
}

export function readScriptConnectorsSuccessCache(
  key: string,
  ttlMs: number,
  now: number,
  bust: boolean,
): unknown | null {
  if (bust) return null;
  if (ttlMs <= 0 || !cache || cache.key !== key || now - cache.at >= ttlMs) return null;
  return cache.body;
}

export function writeScriptConnectorsSuccessCache(key: string, at: number, body: unknown): void {
  cache = { key, at, body };
}
