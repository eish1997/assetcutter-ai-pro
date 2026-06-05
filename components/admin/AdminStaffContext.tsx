import React from 'react';
import { useAuth } from '../auth/AuthContext';
import { fetchAdminMe, type AdminMeResponse, type AdminStaffRole } from '../../services/adminMeClient';
import { hasAdminPermission, type AdminPermission } from '../../services/adminPermissions';
import { previewSessionToStaffRole } from '../../services/adminRolePreview';
import { useAdminRolePreviewOverride } from './AdminRolePreviewBridge';

type AdminStaffContextValue = {
  loading: boolean;
  error: string;
  me: AdminMeResponse | null;
  permissions: string[];
  staffRole: AdminStaffRole | null;
  can: (key: AdminPermission) => boolean;
  reload: () => Promise<void>;
  /** 正在模拟其它角色的后台界面 */
  isRolePreview: boolean;
  exitRolePreview: (() => void) | null;
};

const AdminStaffContext = React.createContext<AdminStaffContextValue | null>(null);

function buildStaffContextValue(
  authLoading: boolean,
  loading: boolean,
  error: string,
  me: AdminMeResponse | null,
  reload: () => Promise<void>
): AdminStaffContextValue {
  const permissions = me?.permissions ?? [];
  const can = (key: AdminPermission) => hasAdminPermission(permissions, key);
  return {
    loading: authLoading || loading,
    error,
    me,
    permissions,
    staffRole: me?.staffRole ?? null,
    can,
    reload,
    isRolePreview: false,
    exitRolePreview: null,
  };
}

export const AdminStaffProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const [me, setMe] = React.useState<AdminMeResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  const reload = React.useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetchAdminMe();
      setMe(res);
    } catch (err) {
      setMe(null);
      setError(err instanceof Error ? err.message : '加载管理权限失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setMe(null);
      setLoading(false);
      setError('');
      return;
    }
    void reload();
  }, [authLoading, user, reload]);

  const value = React.useMemo<AdminStaffContextValue>(
    () => buildStaffContextValue(authLoading, loading, error, me, reload),
    [authLoading, loading, error, me, reload]
  );

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center text-[11px] text-gray-400">
        加载管理权限…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-[#2e2e32] bg-[#16161a] p-6 text-center">
          <p className="text-[12px] text-gray-200 font-bold">请先登录</p>
          <p className="text-[11px] text-gray-500 mt-4">
            <a href="/" className="text-gray-300 hover:text-white">
              返回主站
            </a>
          </p>
        </div>
      </div>
    );
  }

  if (error || !me) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-[#2e2e32] bg-[#16161a] p-6 text-center">
          <p className="text-[12px] text-gray-200 font-bold">无管理后台权限</p>
          <p className="text-[11px] text-gray-500 mt-2">{error || '当前账号未分配后台角色'}</p>
          <p className="text-[11px] text-gray-500 mt-1">{user.email}</p>
          <p className="text-[11px] text-gray-500 mt-4">
            <a href="/" className="text-gray-300 hover:text-white">
              返回主站
            </a>
          </p>
        </div>
      </div>
    );
  }

  return <AdminStaffContext.Provider value={value}>{children}</AdminStaffContext.Provider>;
};

export function useAdminStaff() {
  const ctx = React.useContext(AdminStaffContext);
  const preview = useAdminRolePreviewOverride();
  if (!ctx) throw new Error('useAdminStaff 必须在 AdminStaffProvider 内使用');

  if (!preview) return ctx;

  const permissions = preview.permissions;
  const can = (key: AdminPermission) => hasAdminPermission(permissions, key);

  return {
    ...ctx,
    permissions,
    staffRole: previewSessionToStaffRole(preview),
    can,
    isRolePreview: true,
    exitRolePreview: preview.exitPreview,
  };
}

export default AdminStaffProvider;
