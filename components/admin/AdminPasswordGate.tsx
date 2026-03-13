import React, { useState, useEffect } from 'react';

const STORAGE_KEY = 'ac_admin_unlocked';

function getExpectedPassword(): string {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ADMIN_PASSWORD != null) {
      return String(import.meta.env.VITE_ADMIN_PASSWORD);
    }
    if (typeof window !== 'undefined' && (window as unknown as { __ADMIN_PASSWORD?: string }).__ADMIN_PASSWORD != null) {
      return String((window as unknown as { __ADMIN_PASSWORD: string }).__ADMIN_PASSWORD);
    }
  } catch {
    /* ignore */
  }
  return '';
}

const AdminPasswordGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const expected = getExpectedPassword();
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!expected) {
      setUnlocked(true);
      return;
    }
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === '1') setUnlocked(true);
    } catch {
      /* ignore */
    }
  }, [expected]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password === expected) {
      try {
        sessionStorage.setItem(STORAGE_KEY, '1');
      } catch {
        /* ignore */
      }
      setUnlocked(true);
    } else {
      setError('密码错误');
    }
  };

  if (!expected) return <>{children}</>;
  if (unlocked) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050505] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/40 p-6 shadow-xl">
        <h1 className="text-center text-[14px] font-black uppercase text-gray-300 mb-1">管理后台</h1>
        <p className="text-center text-[11px] text-gray-500 mb-4">请输入管理员密码</p>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="管理员密码"
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"
            autoFocus
          />
          {error && <p className="text-[11px] text-red-400 text-center">{error}</p>}
          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-blue-600 text-[12px] font-black uppercase text-white hover:bg-blue-500 transition-colors"
          >
            确认
          </button>
        </form>
        <p className="text-center text-[10px] text-gray-500 mt-4">
          <a href="/" className="text-gray-400 hover:text-gray-200">← 返回主站</a>
        </p>
      </div>
    </div>
  );
};

export default AdminPasswordGate;
