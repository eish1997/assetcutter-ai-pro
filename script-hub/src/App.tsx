import { BrowserRouter, Navigate, Route, Routes, Link, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { LoginPage } from './pages/LoginPage';
import { LibraryPage } from './pages/LibraryPage';
import { NewScriptPage } from './pages/NewScriptPage';
import { ScriptDetailPage } from './pages/ScriptDetailPage';
import { ScriptRunsPage } from './pages/ScriptRunsPage';
import { ScriptHubPrefsProvider } from './context/ScriptHubPrefsContext';
import { CompanionStatusBar } from './components/CompanionStatusBar';

function ShellLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="sh-app sh-mesh-bg">
      <header className="sh-header">
        <Link to="/library" className="sh-brand">
          Script Hub
        </Link>
        {user ? (
          <>
            <nav className="sh-nav" aria-label="主导航">
              <Link to="/library" className="sh-btn sh-btn-ghost" style={{ textDecoration: 'none' }}>
                我的脚本
              </Link>
              <Link to="/scripts/new" className="sh-btn sh-btn-primary" style={{ textDecoration: 'none' }}>
                新建
              </Link>
            </nav>
            <span className="sh-muted" style={{ fontSize: '0.875rem' }}>
              {user.username}
            </span>
            <button type="button" className="sh-btn sh-btn-ghost" onClick={() => void logout()}>
              退出
            </button>
          </>
        ) : null}
      </header>
      <main className="sh-main">
        <CompanionStatusBar />
        <Outlet />
      </main>
      <footer className="sh-footer">
        生产入口 <span className="sh-code">scripts.adrazzo.com</span> · 本地：auth 9100 · script-hub-api 9101 · 伴侣 18765 · 本页 5174
      </footer>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route
          element={
            <ScriptHubPrefsProvider>
              <ShellLayout />
            </ScriptHubPrefsProvider>
          }
        >
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/scripts/new" element={<NewScriptPage />} />
          <Route path="/scripts/:id/runs" element={<ScriptRunsPage />} />
          <Route path="/scripts/:id" element={<ScriptDetailPage />} />
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="*" element={<Navigate to="/library" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
