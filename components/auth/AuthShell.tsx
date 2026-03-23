import React from 'react';
import { useAuth } from './AuthContext';

const AuthShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  return (
    <>
      {children}
      {user ? (
        <div className="fixed top-3 right-3 z-[120] flex items-center gap-2 rounded-xl border border-white/10 bg-black/60 px-3 py-2 backdrop-blur">
          <span className="text-[10px] text-gray-300">{user.username}</span>
          <button
            type="button"
            onClick={() => { void logout(); }}
            className="rounded-lg border border-white/15 px-2 py-1 text-[10px] text-gray-200 hover:bg-white/10"
          >
            退出
          </button>
        </div>
      ) : null}
    </>
  );
};

export default AuthShell;

