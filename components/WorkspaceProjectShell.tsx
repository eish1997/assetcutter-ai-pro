import React, { useMemo, useState } from 'react';
import type { WorkspaceProject } from '../services/workspaceProjectStore';

type Props = {
  projects: WorkspaceProject[];
  onCreate: (name: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
};

const WorkspaceProjectShell: React.FC<Props> = ({ projects, onCreate, onOpen, onDelete }) => {
  const [draftName, setDraftName] = useState('');
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, filter]);

  const handleCreate = () => {
    onCreate(draftName);
    setDraftName('');
  };

  return (
    <div className="w-full max-w-6xl mx-auto animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-black tracking-tight text-white">工作区</h1>
          <p className="mt-2 text-[11px] text-gray-500 max-w-xl leading-relaxed">
            捕捉创意激发灵感；打开项目进入全能工作流
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleCreate())}
            placeholder="项目名称"
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-[11px] outline-none focus:border-blue-500 min-w-[12rem] placeholder:text-gray-600"
          />
          <button
            type="button"
            onClick={handleCreate}
            className="px-5 py-2.5 rounded-xl bg-blue-600 text-[10px] font-black uppercase tracking-widest text-white hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/30"
          >
            新建项目
          </button>
        </div>
      </div>

      <div className="mb-6">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="搜索项目…"
          className="w-full max-w-sm bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-[11px] outline-none focus:border-blue-500 placeholder:text-gray-600"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] py-20 text-center text-[11px] text-gray-500">
          {projects.length === 0 ? '暂无项目，请新建' : '没有匹配的项目'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(p.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(p.id))}
              className="group rounded-2xl border border-white/10 bg-black/30 overflow-hidden cursor-pointer hover:border-blue-500/40 hover:bg-white/[0.04] transition-all text-left"
            >
              <div className="aspect-[16/10] relative bg-gradient-to-br from-violet-950/80 via-[#0f0f18] to-blue-950/60 flex items-center justify-center">
                <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 text-xl rotate-45 group-hover:scale-105 transition-transform">
                  ◆
                </div>
              </div>
              <div className="p-4 flex items-start justify-between gap-2 border-t border-white/5">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-bold text-white truncate">{p.name}</div>
                  <div className="text-[9px] text-gray-500 mt-1 font-mono">
                    创建于 {new Date(p.createdAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(p.id);
                  }}
                  className="shrink-0 p-2 rounded-lg text-red-400/80 hover:text-red-300 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition-colors"
                  title="删除项目"
                  aria-label={`删除 ${p.name}`}
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WorkspaceProjectShell;
