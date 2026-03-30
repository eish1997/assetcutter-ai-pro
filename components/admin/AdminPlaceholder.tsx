import React from 'react';

/** 原「批量出图任务」管理已移除；保留 /admin 入口与密码门控。 */
const AdminPlaceholder: React.FC = () => {
  return (
    <div className="max-w-lg space-y-4 rounded-2xl border border-[#2e2e32] bg-[#121214] p-8">
      <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">管理后台</h2>
      <p className="text-[11px] text-gray-500 leading-relaxed">
        对话「批量出图」任务与相关 Job API 已从本站移除。若需公司级 Gemini 代理（异步 /proxy/gemini/async），请使用{' '}
        <code className="bg-[#26262c] px-1 rounded text-[10px]">server/gemini-proxy-api.js</code>。
      </p>
    </div>
  );
};

export default AdminPlaceholder;
