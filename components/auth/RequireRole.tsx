import React from 'react';
import { useAuth } from './AuthContext';

const RequireRole: React.FC<{ role: 'admin' | 'user'; children: React.ReactNode }> = ({ role, children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="min-h-screen bg-[#050505] flex items-center justify-center text-[11px] text-gray-400">鉴权初始化中…</div>;
  }
  if (!user) {
    return <div className="min-h-screen bg-[#050505] flex items-center justify-center text-[11px] text-gray-400">请先登录</div>;
  }
  if (role === 'admin' && user.role !== 'admin') {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/40 p-6 text-center">
          <p className="text-[12px] text-gray-200 font-bold">无管理员权限</p>
          <p className="text-[11px] text-gray-500 mt-2">当前账号：{user.email}</p>
          <p className="text-[11px] text-gray-500 mt-4">
            <a href="/" className="text-gray-300 hover:text-white">返回主站</a>
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
};

export default RequireRole;

