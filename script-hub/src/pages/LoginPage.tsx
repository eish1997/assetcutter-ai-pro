import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { user, login, error: ctxErr } = useAuth();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from || '/library';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(identifier.trim(), password);
      setPassword('');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sh-app sh-mesh-bg sh-login-wrap">
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div className="sh-login-brand">
          <h1 className="sh-h1">Script Hub</h1>
          <p className="sh-muted" style={{ margin: '0.25rem 0 0' }}>
            与工作台共用账号 · <span className="sh-code">scripts.adrazzo.com</span>
          </p>
        </div>
        <div className="sh-panel">
          <h2 className="sh-h2" style={{ marginTop: 0 }}>
            登录
          </h2>
          <form className="sh-grid-form" onSubmit={onSubmit}>
            <label className="sh-label">
              邮箱或用户名
              <input
                className="sh-input"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="sh-label">
              密码
              <input
                className="sh-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button className="sh-btn sh-btn-primary" type="submit" disabled={busy}>
              {busy ? '登录中…' : '登录'}
            </button>
          </form>
          {err || ctxErr ? (
            <p className="sh-alert" role="alert">
              {err || ctxErr}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
