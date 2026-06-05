import React from 'react';
import { ADMIN_NAV_ITEMS, PERMISSIONS, type AdminPermission } from '../../services/adminPermissions';
import { useAdminStaff } from './AdminStaffContext';

const ROUTE_PERMISSIONS: Record<string, AdminPermission> = {
  '/admin': PERMISSIONS.DASHBOARD_READ,
  ...Object.fromEntries(ADMIN_NAV_ITEMS.map((item) => [item.path, item.permission])),
};

export const AdminRouteGuard: React.FC<{ pathname: string; children: React.ReactNode }> = ({
  pathname,
  children,
}) => {
  const { can } = useAdminStaff();
  const permission =
    ROUTE_PERMISSIONS[pathname] ??
    (pathname.startsWith('/admin/users/') ? PERMISSIONS.USERS_READ : PERMISSIONS.DASHBOARD_READ);
  if (!can(permission)) {
    return (
      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-8 max-w-lg">
        <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">无权限</h2>
        <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">当前角色无权访问此页面。</p>
      </div>
    );
  }
  return <>{children}</>;
};

export default AdminRouteGuard;
