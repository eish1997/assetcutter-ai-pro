import React from 'react';

/** 懒加载 Viewer 时的轻量占位，避免白屏 */
export const PreviewViewerFallback: React.FC<{ label?: string }> = ({ label = '预览加载中…' }) => (
  <div className="absolute inset-0 z-[6] flex items-center justify-center rounded-xl bg-[#0a0a0c]/90 border border-[#2e2e32]">
    <span className="text-[10px] text-gray-500">{label}</span>
  </div>
);
