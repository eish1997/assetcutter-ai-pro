import React from 'react';

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
  const active = currentPath === path;
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
  return (
    <div className="min-h-screen bg-[#050505] text-white flex">
      <aside className="w-60 border-r border-[#2e2e32] bg-[#16161a] flex flex-col">
        <div className="px-4 py-4 border-b border-[#2e2e32]">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">AssetCutter</p>
          <p className="text-[11px] text-gray-300 mt-1">管理后台</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-2">
          <NavButton label="首页" path="/admin" currentPath={currentPath} onNavigate={onNavigate} />
          <NavButton label="用户管理" path="/admin/users" currentPath={currentPath} onNavigate={onNavigate} />
          <NavButton label="审计日志" path="/admin/audit-logs" currentPath={currentPath} onNavigate={onNavigate} />
          <NavButton label="本地伴侣发行" path="/admin/companion-artifacts" currentPath={currentPath} onNavigate={onNavigate} />
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
              window.location.href = '/';
            }}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[9px] font-black uppercase tracking-widest text-gray-400 hover:bg-[#3d3018] hover:border-[#b45309] hover:text-amber-200 transition-all"
          >
            退出管理员
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
  );
};

export default AdminLayout;

