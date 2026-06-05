import React from 'react';
import { ADMIN_NAV_ITEMS, PERMISSIONS } from '../../services/adminPermissions';
import { navigateAdmin } from '../../services/adminNavigate';
import { useAdminStaff } from './AdminStaffContext';

/** 无 dashboard 权限时从 /admin 重定向到首个可访问页面（如 auditor → 审计） */
const AdminDefaultRedirect: React.FC<{ pathname: string }> = ({ pathname }) => {
  const { can } = useAdminStaff();

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (pathname === '/admin/audit-logs' && params.get('view') === 'tasks') {
      const userId = params.get('userId') || params.get('targetUserId') || '';
      const qs = userId ? `?userId=${encodeURIComponent(userId)}` : '';
      navigateAdmin(`/admin/task-events${qs}`);
      return;
    }
    if (pathname !== '/admin') return;
    if (can(PERMISSIONS.DASHBOARD_READ)) return;
    const first = ADMIN_NAV_ITEMS.find((item) => item.path !== '/admin' && can(item.permission));
    if (first) navigateAdmin(first.path);
  }, [pathname, can]);

  return null;
};

export default AdminDefaultRedirect;
