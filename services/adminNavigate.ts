/** SPA admin route navigation (App.tsx listens to popstate). */
export function navigateAdmin(path: string) {
  if (typeof window === 'undefined') return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function adminAuditUrlForUser(userId: string): string {
  return `/admin/audit-logs?targetUserId=${encodeURIComponent(userId)}`;
}

export function adminTaskEventsUrlForUser(userId: string): string {
  return `/admin/task-events?userId=${encodeURIComponent(userId)}`;
}

export function adminUserDetailUrl(userId: string): string {
  return `/admin/users/${encodeURIComponent(userId)}`;
}

export function adminUsersUrlForHighlight(userId: string): string {
  return `/admin/users?userId=${encodeURIComponent(userId)}`;
}
