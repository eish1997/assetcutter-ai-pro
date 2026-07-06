/**
 * 用户侧用量 **读** API：任意登录用户可读本人数据；不可通过 userId 查他人。
 * 管理端全站用量走 /api/admin/usage-*（须 usage.read）。
 */
export const USER_USAGE_READ_HTTP_PATHS = Object.freeze([
  '/api/usage/summary',
  '/api/usage/events/list',
  '/api/usage/events/export',
]);

export function isUserUsageReadHttpPath(pathname) {
  const p = String(pathname || '').split('?')[0];
  return USER_USAGE_READ_HTTP_PATHS.includes(p);
}

/** @returns {{ ok: true, userId: string } | { ok: false }} */
export function resolveSelfUsageTargetUserId(user, searchParams) {
  const uid = String(user?.id || '').trim();
  if (!uid) return { ok: false };
  const requested = String(searchParams?.get?.('userId') || '').trim();
  if (requested && requested !== uid) return { ok: false };
  return { ok: true, userId: uid };
}
