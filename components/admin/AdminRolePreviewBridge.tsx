import React from 'react';
import type { AdminRolePreviewSession } from '../../services/adminRolePreview';
import {
  clearAdminRolePreviewSession,
  readAdminRolePreviewSession,
} from '../../services/adminRolePreview';

export type AdminRolePreviewOverride = AdminRolePreviewSession & {
  exitPreview: () => void;
};

const AdminRolePreviewOverrideContext = React.createContext<AdminRolePreviewOverride | null>(null);

export const AdminRolePreviewBridge: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preview, setPreview] = React.useState<AdminRolePreviewSession | null>(() =>
    readAdminRolePreviewSession()
  );

  React.useEffect(() => {
    const sync = () => setPreview(readAdminRolePreviewSession());
    window.addEventListener('popstate', sync);
    window.addEventListener('storage', sync);
    window.addEventListener('ac-admin-role-preview-changed', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener('ac-admin-role-preview-changed', sync);
    };
  }, []);

  const exitPreview = React.useCallback(() => {
    clearAdminRolePreviewSession();
    setPreview(null);
    window.history.pushState({}, '', '/admin/roles');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  const value = React.useMemo<AdminRolePreviewOverride | null>(() => {
    if (!preview) return null;
    return { ...preview, exitPreview };
  }, [preview, exitPreview]);

  return (
    <AdminRolePreviewOverrideContext.Provider value={value}>
      {children}
    </AdminRolePreviewOverrideContext.Provider>
  );
};

export function useAdminRolePreviewOverride(): AdminRolePreviewOverride | null {
  return React.useContext(AdminRolePreviewOverrideContext);
}

export default AdminRolePreviewBridge;
