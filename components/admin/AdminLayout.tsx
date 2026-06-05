import React from 'react';
import { ADMIN_NAV_ITEMS } from '../../services/adminPermissions';
import { useAdminStaff } from './AdminStaffContext';
import { logoutSession } from '../../services/authClient';

type AdminLayoutProps = {
  children: React.ReactNode;
  currentPath: string;
  onNavigate: (path: string) => void;
};

function NavButton({
  label,
  path,
  currentPath,
  onNavigate,
}: {
  label: string;
  path: string;
  currentPath: string;
  onNavigate: (path: string) => void;
}) {
  const active = currentPath === path || (path === '/admin/users' && currentPath.startsWith('/admin/users/'));
  return (
    <button
      type="button"
      onClick={() => onNavigate(path)}
      className={`w-full flex items-center justify-between px-4 py-2 rounded-xl text-[11px] transition-colors ${
        active
          ? 'bg-[#264670] text-blue-100 border border-[#3b82f6]'
          : 'bg-[#1c1c22] text-gray-300 border border-[#2e2e32] hover:bg-[#2e2e36]'
      }`}
    >
      <span className="font-medium">{label}</span>
      {active && <span className="text-[9px] uppercase text-blue-200">当前</span>}
    </button>
  );
}

const AdminLayout: React.FC<AdminLayoutProps> = ({ children, currentPath, onNavigate }) => {
  const { staffRole, can, isRolePreview, exitRolePreview, me } = useAdminStaff();
  const navItems = ADMIN_NAV_ITEMS.filter((item) => can(item.permission));

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col">
      {isRolePreview ? (
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-amber-950/90 border-b border-amber-700/40 text-[11px]">
          <span className="text-amber-100">
            界面预览 · 模拟角色 <strong className="font-semibold">{staffRole?.displayName}</strong>
            <span className="text-amber-200/70 font-mono ml-1">({staffRole?.slug})</span>
            <span className="text-amber-200/60 ml-2">— 侧栏与按钮按该角色权限展示，写操作已禁用</span>
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-amber-200/50">实际登录：{me?.user.username}</span>
            <button
              type="button"
              onClick={() => exitRolePreview?.()}
              className="px-3 py-1 rounded-lg border border-amber-600/50 bg-amber-900/40 text-amber-100 hover:bg-amber-900/70"
            >
              退出预览
            </button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-1 min-h-0">
      <aside className="w-60 border-r border-[#2e2e32] bg-[#16161a] flex flex-col">
        <div className="px-4 py-4 border-b border-[#2e2e32]">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">AssetCutter</p>
          <p className="text-[11px] text-gray-300 mt-1">管理后台</p>
          {staffRole ? (
            <p className="text-[10px] text-blue-300/80 mt-2">{staffRole.displayName}</p>
          ) : null}
        </div>
        <nav className="flex-1 px-3 py-4 space-y-2">
          {navItems.map((item) => (
            <NavButton
              key={item.path}
              label={item.label}
              path={item.path}
              currentPath={currentPath}
              onNavigate={onNavigate}
            />
          ))}
        </nav>
        <div className="px-3 py-3 border-t border-[#2e2e32] space-y-2">
          <a
            href="/"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[9px] font-black uppercase tracking-widest text-gray-300 hover:bg-[#2e2e36] hover:border-[#3a3a40] transition-all"
          >
            返回主界面
          </a>
          <button
            type="button"
            onClick={() => {
              void logoutSession().finally(() => {
                window.location.href = '/';
              });
            }}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[9px] font-black uppercase tracking-widest text-gray-400 hover:bg-[#3d3018] hover:border-[#b45309] hover:text-amber-200 transition-all"
          >
            退出登录
          </button>
        </div>
      </aside>
      <main className="flex-1 flex flex-col">
        <header className="h-14 border-b border-[#2e2e32] flex items-center justify-between px-6 bg-[#16161a]">
          <h1 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">Admin Console</h1>
        </header>
        <div className="flex-1 overflow-auto p-6">{children}</div>
      </main>
      </div>
    </div>
  );
};

export default AdminLayout;

