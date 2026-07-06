/** SPA admin route navigation (App.tsx listens to popstate). */
export function navigateAdmin(path: string) {
  navigateAppPath(path);
}

/** 返回主站工作区（与 navigateAdmin 相同机制，App 监听 popstate 切换分支） */
export function navigateMainSite() {
  navigateAppPath('/');
}

function navigateAppPath(path: string) {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === path && !window.location.search && !window.location.hash) return;
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

export function adminUserDetailCreditsUrl(userId: string): string {
  return `${adminUserDetailUrl(userId)}#admin-user-credits`;
}

export function adminUsersUrlForHighlight(userId: string): string {
  return `/admin/users?userId=${encodeURIComponent(userId)}`;
}
