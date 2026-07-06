import React from 'react';
import { useAuth } from './AuthContext';
import {
  fetchRegistrationPolicy,
  validateRegistrationInvite,
  type RegistrationPolicy,
} from '../../services/authClient';

function readAuthParamsFromUrl(): { staffInvite: string; registrationInvite: string } {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      staffInvite: String(params.get('staffInvite') || '').trim(),
      registrationInvite: String(params.get('invite') || '').trim(),
    };
  } catch {
    return { staffInvite: '', registrationInvite: '' };
  }
}

function stripAuthQueryFromUrl() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('staffInvite') && !params.has('invite')) return;
  params.delete('staffInvite');
  params.delete('invite');
  const qs = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname || '/'}${qs ? `?${qs}` : ''}`);
}

const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading, login, register } = useAuth();
  const urlParams = React.useMemo(() => readAuthParamsFromUrl(), []);
  const initialStaffInvite = urlParams.staffInvite;
  const initialRegistrationInvite = urlParams.registrationInvite;

  const [policy, setPolicy] = React.useState<RegistrationPolicy | null>(null);
  const [mode, setMode] = React.useState<'login' | 'register'>(() =>
    initialStaffInvite || initialRegistrationInvite ? 'register' : 'login'
  );
  const [username, setUsername] = React.useState('');
  const [identifier, setIdentifier] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [inviteCode, setInviteCode] = React.useState(initialRegistrationInvite);
  const [inviteValid, setInviteValid] = React.useState<boolean | null>(
    initialRegistrationInvite ? null : null
  );
  const [inviteChecking, setInviteChecking] = React.useState(false);
  const [error, setError] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const inviteRequired = policy?.inviteRequired === true;
  const showRegistrationInviteField =
    mode === 'register' && !initialStaffInvite && (inviteRequired || Boolean(inviteCode.trim()));

  React.useEffect(() => {
    let cancelled = false;
    void fetchRegistrationPolicy()
      .then((p) => {
        if (!cancelled) setPolicy(p);
      })
      .catch(() => {
        if (!cancelled) setPolicy({ mode: 'open', inviteRequired: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runInviteValidation = React.useCallback(async (code: string) => {
    const trimmed = String(code || '').trim();
    if (!trimmed) {
      setInviteValid(null);
      return;
    }
    setInviteChecking(true);
    try {
      const res = await validateRegistrationInvite(trimmed);
      setInviteValid(res.valid);
      if (res.valid && res.code) setInviteCode(res.code);
    } catch {
      setInviteValid(false);
    } finally {
      setInviteChecking(false);
    }
  }, []);

  React.useEffect(() => {
    if (!initialRegistrationInvite || initialStaffInvite) return;
    void runInviteValidation(initialRegistrationInvite);
  }, [initialRegistrationInvite, initialStaffInvite, runInviteValidation]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'register' && showRegistrationInviteField) {
      const code = inviteCode.trim();
      if (inviteRequired && !code) {
        setError('需要有效邀请码才能注册');
        return;
      }
      if (code && inviteValid === false) {
        setError('邀请码无效或已失效');
        return;
      }
      if (code && inviteValid === null && !inviteChecking) {
        setInviteChecking(true);
        try {
          const res = await validateRegistrationInvite(code);
          if (!res.valid) {
            setInviteValid(false);
            setError('邀请码无效或已失效');
            return;
          }
          setInviteValid(true);
          if (res.code) setInviteCode(res.code);
        } catch {
          setError('邀请码校验失败，请稍后再试');
          return;
        } finally {
          setInviteChecking(false);
        }
      }
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(identifier, password);
      } else {
        const code = inviteCode.trim();
        await register(username, email, password, {
          staffInvite: initialStaffInvite || undefined,
          inviteCode: initialStaffInvite ? undefined : code || undefined,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center text-[11px] text-gray-400">
        鉴权初始化中…
      </div>
    );
  }
  if (user) {
    if (initialStaffInvite || initialRegistrationInvite) stripAuthQueryFromUrl();
    return <>{children}</>;
  }

  const registerSubtitle = () => {
    if (initialStaffInvite) return '后台成员邀请注册';
    if (inviteRequired) return '邀请码注册';
    return '用户名+邮箱注册';
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050505] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-[#2e2e32] bg-[#16161a] p-6 shadow-xl">
        <h1 className="text-center text-[14px] font-black uppercase text-gray-300 mb-1">用户系统</h1>
        <p className="text-center text-[11px] text-gray-500 mb-4">
          {mode === 'login' ? '用户名/邮箱登录' : registerSubtitle()}
        </p>
        {initialStaffInvite && mode === 'register' ? (
          <p className="mb-3 text-[10px] text-center text-blue-300/90">
            已识别成员邀请链接，注册后将自动分配后台角色
          </p>
        ) : null}
        {!initialStaffInvite && initialRegistrationInvite && mode === 'register' && inviteValid === true ? (
          <p className="mb-3 text-[10px] text-center text-emerald-300/90">邀请码有效，请完成注册</p>
        ) : null}
        <form onSubmit={submit} className="space-y-3">
          {mode === 'login' ? (
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="用户名或邮箱"
              className="w-full rounded-xl border border-[#343438] bg-[#1c1c22] px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-blue-500/30"
              autoFocus
              required
            />
          ) : (
            <>
              {showRegistrationInviteField ? (
                <div>
                  <input
                    type="text"
                    value={inviteCode}
                    onChange={(e) => {
                      setInviteCode(e.target.value);
                      setInviteValid(null);
                    }}
                    onBlur={() => void runInviteValidation(inviteCode)}
                    placeholder="邀请码（如 AC-XXXX-XXXX）"
                    className="w-full rounded-xl border border-[#343438] bg-[#1c1c22] px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-blue-500/30"
                    autoFocus={!initialRegistrationInvite}
                    required={inviteRequired}
                  />
                  {inviteChecking ? (
                    <p className="mt-1 text-[10px] text-gray-500 text-center">校验邀请码…</p>
                  ) : inviteValid === true ? (
                    <p className="mt-1 text-[10px] text-emerald-400/90 text-center">邀请码有效</p>
                  ) : inviteValid === false ? (
                    <p className="mt-1 text-[10px] text-red-400 text-center">邀请码无效或已失效</p>
                  ) : inviteRequired ? (
                    <p className="mt-1 text-[10px] text-gray-600 text-center">平台已开启邀请制，需有效邀请码</p>
                  ) : null}
                </div>
              ) : null}
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="用户名（3-32位，字母/数字/下划线）"
                className="w-full rounded-xl border border-[#343438] bg-[#1c1c22] px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-blue-500/30"
                pattern="[A-Za-z0-9_]{3,32}"
                autoFocus={!showRegistrationInviteField}
                required
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="邮箱"
                className="w-full rounded-xl border border-[#343438] bg-[#1c1c22] px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-blue-500/30"
                required
              />
            </>
          )}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码（至少 8 位）"
            className="w-full rounded-xl border border-[#343438] bg-[#1c1c22] px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-blue-500/30"
            minLength={8}
            required
          />
          {error ? <p className="text-[11px] text-red-400 text-center">{error}</p> : null}
          <button
            type="submit"
            disabled={submitting || inviteChecking}
            className="w-full py-3 rounded-xl bg-blue-600 text-[12px] font-black uppercase text-white hover:bg-blue-500 transition-colors duration-200 disabled:opacity-50 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]"
          >
            {submitting ? '提交中…' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>
        {initialStaffInvite ? (
          mode === 'register' ? (
            <button
              type="button"
              onClick={() => setMode('login')}
              className="mt-3 w-full text-[11px] text-gray-400 hover:text-gray-200 cursor-pointer rounded-lg py-2"
            >
              已有账号？去登录
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMode('register')}
              className="mt-3 w-full text-[11px] text-gray-400 hover:text-gray-200 cursor-pointer rounded-lg py-2"
            >
              使用成员邀请注册
            </button>
          )
        ) : inviteRequired ? (
          mode === 'login' ? (
            <button
              type="button"
              onClick={() => setMode('register')}
              className="mt-3 w-full text-[11px] text-gray-400 hover:text-gray-200 cursor-pointer rounded-lg py-2 outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505] transition-colors duration-200"
            >
              有邀请码？去注册
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMode('login')}
              className="mt-3 w-full text-[11px] text-gray-400 hover:text-gray-200 cursor-pointer rounded-lg py-2 outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505] transition-colors duration-200"
            >
              已有账号？去登录
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={() => setMode((m) => (m === 'login' ? 'register' : 'login'))}
            className="mt-3 w-full text-[11px] text-gray-400 hover:text-gray-200 cursor-pointer rounded-lg py-2 outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505] transition-colors duration-200"
          >
            {mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
          </button>
        )}
      </div>
    </div>
  );
};

export default AuthGate;
