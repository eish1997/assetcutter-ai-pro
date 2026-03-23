import React from 'react';
import { useAuth } from './AuthContext';
import { forgotPassword, resetPassword } from '../../services/authClient';

const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading, login, register } = useAuth();
  const [mode, setMode] = React.useState<'login' | 'register' | 'forgot' | 'reset'>('login');
  const [username, setUsername] = React.useState('');
  const [identifier, setIdentifier] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [resetToken, setResetToken] = React.useState('');
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = new URLSearchParams(window.location.search).get('resetToken') || '';
    if (token) {
      setResetToken(token);
      setMode('reset');
      setSuccess('已读取重置码，请输入新密码后提交');
      setError('');
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      if (mode === 'login') await login(identifier, password);
      else if (mode === 'register') await register(username, email, password);
      else if (mode === 'forgot') {
        const res = await forgotPassword(identifier || email);
        setSuccess(res.resetToken ? `重置码（调试）：${res.resetToken}` : '若账号存在，重置链接已发送');
      } else if (mode === 'reset') {
        await resetPassword(resetToken, password);
        setSuccess('密码已重置，请返回登录');
        setMode('login');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-[#050505] flex items-center justify-center text-[11px] text-gray-400">鉴权初始化中…</div>;
  }
  if (user) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050505] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/40 p-6 shadow-xl">
        <h1 className="text-center text-[14px] font-black uppercase text-gray-300 mb-1">用户系统</h1>
        <p className="text-center text-[11px] text-gray-500 mb-4">
          {mode === 'login' ? '用户名/邮箱登录' : mode === 'register' ? '用户名+邮箱注册' : mode === 'forgot' ? '找回密码' : '重置密码'}
        </p>
        <form onSubmit={submit} className="space-y-3">
          {mode === 'login' || mode === 'forgot' ? (
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={mode === 'forgot' ? '输入用户名或邮箱' : '用户名或邮箱'}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"
              autoFocus
              required
            />
          ) : mode === 'register' ? (
            <>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="用户名（3-32位，字母/数字/下划线）"
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"
                pattern="[A-Za-z0-9_]{3,32}"
                autoFocus
                required
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="邮箱"
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"
                required
              />
            </>
          ) : (
            <input
              type="text"
              value={resetToken}
              onChange={(e) => setResetToken(e.target.value)}
              placeholder="重置码"
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"
              autoFocus
              required
            />
          )}
          {mode !== 'forgot' && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码（至少 8 位）"
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"
              minLength={8}
              required
            />
          )}
          {error ? <p className="text-[11px] text-red-400 text-center">{error}</p> : null}
          {success ? <p className="text-[11px] text-emerald-300 text-center break-all">{success}</p> : null}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-blue-600 text-[12px] font-black uppercase text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            {submitting ? '提交中…' : mode === 'login' ? '登录' : mode === 'register' ? '注册' : mode === 'forgot' ? '发送重置' : '确认重置'}
          </button>
        </form>
        <div className="mt-3 space-y-1">
          <button type="button" onClick={() => setMode((m) => (m === 'login' ? 'register' : 'login'))} className="w-full text-[11px] text-gray-400 hover:text-gray-200">
            {mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
          </button>
          {mode === 'login' ? (
            <button type="button" onClick={() => setMode('forgot')} className="w-full text-[11px] text-gray-500 hover:text-gray-300">
              忘记密码？
            </button>
          ) : null}
          {(mode === 'forgot' || mode === 'reset') ? (
            <button type="button" onClick={() => setMode(mode === 'forgot' ? 'reset' : 'forgot')} className="w-full text-[11px] text-gray-500 hover:text-gray-300">
              {mode === 'forgot' ? '我有重置码，去重置' : '没有重置码，去找回'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default AuthGate;

