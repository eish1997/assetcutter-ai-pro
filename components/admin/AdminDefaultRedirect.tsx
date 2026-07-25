import React from 'react';
import { resolveAdminLandingPath } from '../../services/adminPermissions';
import { navigateAdmin } from '../../services/adminNavigate';
import { useAdminStaff } from './AdminStaffContext';

/** 无 dashboard 权限时从 /admin 重定向到首个可访问页面（如 auditor → 审计） */
const AdminDefaultRedirect: React.FC<{ pathname: string }> = ({ pathname }) => {
  const { permissions } = useAdminStaff();

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (pathname === '/admin/audit-logs' && params.get('view') === 'tasks') {
      const userId = params.get('userId') || params.get('targetUserId') || '';
      const qs = userId ? `?userId=${encodeURIComponent(userId)}` : '';
      navigateAdmin(`/admin/task-events${qs}`);
      return;
    }
    if (pathname === '/admin/staff-invites') {
      navigateAdmin('/admin/invites?tab=staff');
      return;
    }
    if (pathname === '/admin/registration-invites') {
      navigateAdmin('/admin/invites?tab=registration');
      return;
    }
    if (pathname !== '/admin') return;
    const landing = resolveAdminLandingPath(permissions);
    if (landing !== '/admin') navigateAdmin(landing);
  }, [pathname, permissions]);

  return null;
};

export default AdminDefaultRedirect;
