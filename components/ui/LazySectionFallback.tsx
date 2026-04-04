import React from 'react';

const LazySectionFallback: React.FC<{ label?: string }> = ({ label = '模块' }) => (
  <div className="min-h-[240px] w-full rounded-2xl border border-[#2e2e32] bg-[#121214] flex items-center justify-center text-[11px] text-gray-500">
    加载{label}中…
  </div>
);

export default LazySectionFallback;
