/**
 * 用户侧用量 **读** API：仅员工 `usage.read` 可访问；客户端记账 POST 不在此列。
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
