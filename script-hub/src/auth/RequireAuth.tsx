import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function RequireAuth() {
  const { user } = useAuth();
  const loc = useLocation();

  if (user === undefined) {
    return (
      <div className="sh-panel sh-panel-tight" style={{ maxWidth: 360 }}>
        <p className="sh-muted" style={{ margin: 0 }}>
          正在检查登录状态…
        </p>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }
  return <Outlet />;
}
