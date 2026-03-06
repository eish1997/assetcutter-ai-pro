import React, { useState, useEffect } from 'react';

const STORAGE_KEY = 'ac_site_unlocked';

/** 从环境或 window 读取配置的密码（未配置则不启用门控） */
function getExpectedPassword(): string {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SITE_PASSWORD != null) {
      return String(import.meta.env.VITE_SITE_PASSWORD);
    }
    if (typeof window !== 'undefined' && (window as unknown as { __SITE_PASSWORD?: string }).__SITE_PASSWORD != null) {
      return String((window as unknown as { __SITE_PASSWORD: string }).__SITE_PASSWORD);
    }
  } catch {}
  return '';
}

const PasswordGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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
    } catch {}
  }, [expected]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password === expected) {
      try {
        sessionStorage.setItem(STORAGE_KEY, '1');
      } catch {}
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
        <h1 className="text-center text-[14px] font-black uppercase text-gray-300 mb-1">进入网站</h1>
        <p className="text-center text-[11px] text-gray-500 mb-4">请输入密码以继续</p>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
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
      </div>
    </div>
  );
};

export default PasswordGate;
