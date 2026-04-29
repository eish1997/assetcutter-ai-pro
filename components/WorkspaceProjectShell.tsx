import React, { useMemo, useState } from 'react';
import type { WorkspaceProject } from '../services/workspaceProjectStore';
import AppIcon from './ui/AppIcon';

type Props = {
  projects: WorkspaceProject[];
  onCreate: (name: string) => void;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onBind?: (id: string) => void;
  onUnbind?: (id: string) => void;
  onManualUpload?: (id: string) => void;
  onRetryFailedUpload?: (id: string) => void;
  onOpenUploadFailureDetail?: (id: string) => void;
  uploadingProjectId?: string | null;
  currentUserId?: string | null;
};

const WorkspaceProjectShell: React.FC<Props> = ({
  projects,
  onCreate,
  onOpen,
  onRename,
  onDelete,
  onBind,
  onUnbind,
  onManualUpload,
  onRetryFailedUpload,
  onOpenUploadFailureDetail,
  uploadingProjectId,
  currentUserId,
}) => {
  const [draftName, setDraftName] = useState('');
  const [filter, setFilter] = useState('');
  const [renameTarget, setRenameTarget] = useState<WorkspaceProject | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, filter]);

  const handleCreate = () => {
    onCreate(draftName);
    setDraftName('');
  };
  const openRenameModal = (project: WorkspaceProject) => {
    setRenameTarget(project);
    setRenameDraft(project.name);
  };
  const closeRenameModal = () => {
    setRenameTarget(null);
    setRenameDraft('');
  };
  const confirmRename = () => {
    if (!renameTarget) return;
    onRename(renameTarget.id, renameDraft);
    closeRenameModal();
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
            className="bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-4 py-2.5 text-[11px] outline-none focus:border-blue-500 min-w-[12rem] placeholder:text-gray-600"
          />
          <button
            type="button"
            onClick={handleCreate}
            className="px-5 py-2.5 rounded-xl bg-blue-600 text-[10px] font-black uppercase tracking-widest text-white hover:bg-blue-500 transition-colors duration-200 shadow-lg shadow-[#172554] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]"
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
          className="w-full max-w-sm bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-4 py-2.5 text-[11px] outline-none focus:border-blue-500 placeholder:text-gray-600"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#343438] bg-[#0e0e10] py-20 text-center text-[11px] text-gray-500">
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
              className="group rounded-2xl border border-[#2e2e32] bg-[#141416] overflow-hidden cursor-pointer hover:border-[#3b6fb8] hover:bg-[#151518] transition-[border-color,box-shadow,background-color] duration-200 text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]"
            >
              <div className="aspect-[16/10] relative bg-[#16101f] flex items-center justify-center">
                <div className="w-12 h-12 rounded-xl bg-[#1c1c22] border border-[#2e2e32] flex items-center justify-center text-white/45 group-hover:text-white/70 group-hover:border-[#3a3a40] transition-colors duration-200">
                  <AppIcon name="package" className="w-6 h-6" />
                </div>
              </div>
              <div className="p-4 flex items-start justify-between gap-2 border-t border-[#252528]">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-bold text-white truncate">{p.name}</div>
                  <div className="text-[9px] text-gray-500 mt-1 font-mono">
                    创建于 {new Date(p.createdAt).toLocaleString()}
                  </div>
                  {p.lastManualUploadAt ? (
                    <div className="text-[9px] text-cyan-300/90 mt-1 font-mono">
                      最近手动上传 {new Date(p.lastManualUploadAt).toLocaleString()}
                      {typeof p.lastManualUploadAssetCount === 'number' ? ` · ${p.lastManualUploadAssetCount} 项` : ''}
                    </div>
                  ) : null}
                  {typeof p.lastManualUploadAttemptedCount === 'number' ? (
                    <div className="text-[9px] mt-1">
                      {(() => {
                        const attempted = Math.max(0, Number(p.lastManualUploadAttemptedCount || 0));
                        const succeeded = Math.max(0, Number(p.lastManualUploadSucceededCount || 0));
                        const failed = Math.max(0, attempted - succeeded);
                        return failed > 0 ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenUploadFailureDetail?.(p.id);
                            }}
                            className="text-amber-300/95 hover:text-amber-200 underline decoration-dotted underline-offset-2"
                            title="查看失败项详情"
                          >
                            上次上传：成功 {succeeded} / 失败 {failed}
                          </button>
                        ) : (
                          <span className="text-emerald-300/95">上次上传：成功 {succeeded}</span>
                        );
                      })()}
                    </div>
                  ) : null}
                  <div className="mt-1">
                    {p.boundUserId && currentUserId && p.boundUserId === currentUserId ? (
                      <span className="inline-flex items-center rounded-md border border-emerald-500/35 bg-emerald-900/25 px-1.5 py-0.5 text-[9px] text-emerald-200">
                        已绑定当前账号
                      </span>
                    ) : p.boundUserId ? (
                      <span className="inline-flex items-center rounded-md border border-amber-500/35 bg-amber-900/20 px-1.5 py-0.5 text-[9px] text-amber-200">
                        已绑定其他账号
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-md border border-white/15 bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-gray-400">
                        未绑定
                      </span>
                    )}
                    {p.boundUserId && currentUserId && p.boundUserId !== currentUserId ? (
                      <div className="mt-1 text-[9px] text-amber-300/90">可继续本地使用；绑定当前账号请先导入为副本</div>
                    ) : null}
                  </div>
                </div>
                {onBind && currentUserId && !p.boundUserId && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onBind(p.id);
                    }}
                    className="shrink-0 px-2 py-1 rounded-lg text-[10px] text-emerald-200 hover:text-emerald-100 bg-emerald-900/20 hover:bg-emerald-900/35 border border-emerald-500/30 transition-colors duration-200 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                    title="绑定到当前账号"
                    aria-label={`绑定 ${p.name} 到当前账号`}
                  >
                    绑定
                  </button>
                )}
                {onUnbind && currentUserId && p.boundUserId === currentUserId && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUnbind(p.id);
                    }}
                    className="shrink-0 px-2 py-1 rounded-lg text-[10px] text-amber-200 hover:text-amber-100 bg-amber-900/20 hover:bg-amber-900/35 border border-amber-500/30 transition-colors duration-200 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
                    title="解绑当前账号"
                    aria-label={`解绑 ${p.name} 与当前账号`}
                  >
                    解绑
                  </button>
                )}
                {onManualUpload && currentUserId && p.boundUserId === currentUserId && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onManualUpload(p.id);
                    }}
                    disabled={uploadingProjectId === p.id}
                    className="shrink-0 px-2 py-1 rounded-lg text-[10px] text-cyan-200 hover:text-cyan-100 bg-cyan-900/20 hover:bg-cyan-900/35 border border-cyan-500/30 transition-colors duration-200 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                    title="手动上传当前项目资产到云端"
                    aria-label={`手动上传 ${p.name} 到云端`}
                  >
                    {uploadingProjectId === p.id ? '上传中…' : '上传'}
                  </button>
                )}
                {onRetryFailedUpload &&
                  currentUserId &&
                  p.boundUserId === currentUserId &&
                  Array.isArray(p.lastManualUploadFailedAssetIds) &&
                  p.lastManualUploadFailedAssetIds.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRetryFailedUpload(p.id);
                      }}
                      disabled={uploadingProjectId === p.id}
                      className="shrink-0 px-2 py-1 rounded-lg text-[10px] text-amber-200 hover:text-amber-100 bg-amber-900/20 hover:bg-amber-900/35 border border-amber-500/30 transition-colors duration-200 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                      title="仅重试上次失败项"
                      aria-label={`重试 ${p.name} 上次失败上传项`}
                    >
                      重试失败项
                    </button>
                  )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openRenameModal(p);
                  }}
                  className="shrink-0 p-2 rounded-lg text-blue-300/80 hover:text-blue-200 hover:bg-[#1a3354] border border-transparent hover:border-[#4b6a9e] transition-colors duration-200 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
                  title="重命名项目"
                  aria-label={`重命名 ${p.name}`}
                >
                  <AppIcon name="edit" className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(p.id);
                  }}
                  className="shrink-0 p-2 rounded-lg text-red-400/80 hover:text-red-300 hover:bg-[#3a1818] border border-transparent hover:border-[#dc6b6b] transition-colors duration-200 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                  title="删除项目"
                  aria-label={`删除 ${p.name}`}
                >
                  <AppIcon name="trash" className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {renameTarget && (
        <div
          className="fixed inset-0 z-[2200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeRenameModal}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0e0e14]/90 backdrop-blur-md shadow-2xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[12px] font-black uppercase tracking-wide text-blue-300">重命名项目</h3>
              <button
                type="button"
                onClick={closeRenameModal}
                className="w-8 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-[#2e2e36] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                aria-label="关闭"
              >
                <AppIcon name="close" className="w-4 h-4" />
              </button>
            </div>
            <input
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirmRename();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  closeRenameModal();
                }
              }}
              placeholder="输入新的项目名称"
              autoFocus
              className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-4 py-2.5 text-[11px] text-white outline-none focus:border-blue-500 placeholder:text-gray-600"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeRenameModal}
                className="px-4 py-2 rounded-xl bg-[#1c1c22] border border-[#2e2e32] text-[10px] font-black uppercase text-gray-300 hover:bg-[#2e2e36] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/30 transition-colors duration-200"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmRename}
                className="px-4 py-2 rounded-xl bg-blue-600 text-[10px] font-black uppercase text-white hover:bg-blue-500 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 transition-colors duration-200"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkspaceProjectShell;
