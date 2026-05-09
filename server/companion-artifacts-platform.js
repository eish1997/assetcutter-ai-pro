/**
 * 本地伴侣发行条目的 platform 匹配（供 catalog / latest / 桌面壳扩展列表共用）。
 * - universal / all：对任意请求平台可见；在 pickLatest 中排序次于「精确匹配当前平台」。
 */
export const ALLOWED_COMPANION_PLATFORMS = ['win32', 'darwin', 'linux', 'universal', 'all'];

export function normalizeCompanionPlatformInput(p) {
  return String(p ?? '')
    .trim()
    .toLowerCase();
}

export function platformMatchesQuery(requestPlatform, artifactPlatform) {
  const ap = normalizeCompanionPlatformInput(artifactPlatform);
  const rp = normalizeCompanionPlatformInput(requestPlatform) || 'win32';
  if (ap === 'universal' || ap === 'all') return true;
  return ap === rp;
}

/** 数值越小越优先（与 pickLatest 排序一致）：0=当前平台精确匹配，1=全平台，2=不应参与（调用方应已过滤） */
export function platformRankForLatest(requestPlatform, artifactPlatform) {
  const ap = normalizeCompanionPlatformInput(artifactPlatform);
  const rp = normalizeCompanionPlatformInput(requestPlatform) || 'win32';
  if (ap === 'universal' || ap === 'all') return 1;
  if (ap === rp) return 0;
  return 2;
}
