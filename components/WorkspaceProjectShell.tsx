import React, { useMemo, useState } from 'react';
import type { WorkspacePersistUserId, WorkspaceProject } from '../services/workspaceProjectStore';
import WorkspaceProjectGalleryRow from './workspace/WorkspaceProjectGalleryRow';
import AppIcon from './ui/AppIcon';
import {
  TITLE_ROW_BTN_NEUTRAL,
  TITLE_ROW_BTN_PRIMARY,
  TITLE_ROW_TAG_FILTER_INPUT,
} from './workflow/workflowSectionUiConstants';

type Props = {
  projects: WorkspaceProject[];
  persistUserId?: WorkspacePersistUserId;
  onCreate: (name: string) => void;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onExport?: (id: string) => void;
  onImport?: (payload: { file: File; mode: 'new' | 'overwrite'; targetProjectId?: string }) => void;
  onOpenTrash?: () => void;
};

const WorkspaceProjectShell: React.FC<Props> = ({
  projects,
  persistUserId = null,
  onCreate,
  onOpen,
  onRename,
  onDelete,
  onExport,
  onImport,
  onOpenTrash,
}) => {
  const [draftName, setDraftName] = useState('');
  const [filter, setFilter] = useState('');
  const [renameTarget, setRenameTarget] = useState<WorkspaceProject | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<'new' | 'overwrite'>('new');
  const [importTargetProjectId, setImportTargetProjectId] = useState('');
  const [importSummary, setImportSummary] = useState<{ projectName: string; assets: number; pending: number } | null>(null);
  const [importError, setImportError] = useState('');
  const importFileRef = React.useRef<HTMLInputElement>(null);

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

  const closeImportModal = () => {
    setImportModalOpen(false);
    setImportFile(null);
    setImportSummary(null);
    setImportError('');
    setImportMode('new');
    setImportTargetProjectId('');
  };

  return (
    <div className="w-full max-w-[88rem] mx-auto animate-in fade-in duration-300 px-1">
      <header className="mb-4 space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <h1 className="shrink-0 text-[15px] font-semibold tracking-tight text-white">工作区</h1>
            <span className="text-[10px] tabular-nums text-gray-600">
              {filtered.length === projects.length
                ? `${projects.length} 项`
                : `${filtered.length} / ${projects.length}`}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {onOpenTrash ? (
              <button type="button" onClick={onOpenTrash} className={TITLE_ROW_BTN_NEUTRAL}>
                回收站
              </button>
            ) : null}
            <input
              ref={importFileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setImportFile(f);
                  setImportError('');
                  setImportSummary(null);
                  setImportMode('new');
                  setImportTargetProjectId(projects[0]?.id || '');
                  try {
                    const text = await f.text();
                    const parsed = JSON.parse(text) as {
                      project?: { name?: string };
                      bundle?: { assets?: unknown[]; pending?: unknown[] };
                    };
                    const assets = Array.isArray(parsed.bundle?.assets) ? parsed.bundle!.assets!.length : 0;
                    const pending = Array.isArray(parsed.bundle?.pending) ? parsed.bundle!.pending!.length : 0;
                    setImportSummary({
                      projectName: String(parsed.project?.name || f.name.replace(/\.json$/i, '') || '未命名项目'),
                      assets,
                      pending,
                    });
                  } catch {
                    setImportError('文件解析失败：不是有效的项目 JSON');
                  }
                  setImportModalOpen(true);
                }
                if (importFileRef.current) importFileRef.current.value = '';
              }}
            />
            <div className="inline-flex h-7 items-stretch overflow-hidden rounded-md bg-white/[0.05] ring-1 ring-white/[0.06]">
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleCreate())}
                placeholder="项目名称"
                className="h-full w-[9.5rem] max-w-[40vw] border-0 bg-transparent px-2.5 text-[10px] text-gray-200 outline-none placeholder:text-gray-600 sm:w-[11rem]"
              />
              <button
                type="button"
                onClick={handleCreate}
                className={`${TITLE_ROW_BTN_PRIMARY} shrink-0 rounded-none border-0 px-3`}
              >
                新建
              </button>
            </div>
            <button
              type="button"
              onClick={() => importFileRef.current?.click()}
              className={TITLE_ROW_BTN_NEUTRAL}
            >
              导入
            </button>
          </div>
        </div>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="搜索项目…"
          className={`${TITLE_ROW_TAG_FILTER_INPUT} w-full max-w-none text-[10px] placeholder:text-gray-600`}
        />
      </header>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#343438] bg-[#0e0e10] py-20 text-center text-[11px] text-gray-500">
          {projects.length === 0 ? '暂无项目，请新建' : '没有匹配的项目'}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((p) => (
            <WorkspaceProjectGalleryRow
              key={p.id}
              project={p}
              persistUserId={persistUserId}
              onOpen={onOpen}
              onRename={openRenameModal}
              onDelete={onDelete}
              onExport={onExport}
            />
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
      {importModalOpen && (
        <div
          className="fixed inset-0 z-[2200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeImportModal}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0e0e14]/90 backdrop-blur-md shadow-2xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[12px] font-black uppercase tracking-wide text-blue-300">导入项目</h3>
              <button
                type="button"
                onClick={closeImportModal}
                className="w-8 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-[#2e2e36] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                aria-label="关闭"
              >
                <AppIcon name="close" className="w-4 h-4" />
              </button>
            </div>
            {importError ? (
              <p className="text-[11px] text-red-300">{importError}</p>
            ) : importSummary ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-[#2e2e32] bg-[#17171d] p-3 text-[11px] text-gray-300">
                  <p>项目名：<span className="text-white font-semibold">{importSummary.projectName}</span></p>
                  <p className="mt-1">资产：{importSummary.assets} 项 ｜ 待处理任务：{importSummary.pending} 项</p>
                </div>
                <div className="space-y-2 text-[11px] text-gray-300">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={importMode === 'new'}
                      onChange={() => setImportMode('new')}
                    />
                    <span>创建新项目导入（推荐）</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={importMode === 'overwrite'}
                      onChange={() => setImportMode('overwrite')}
                    />
                    <span>覆盖现有项目</span>
                  </label>
                </div>
                {importMode === 'overwrite' ? (
                  <select
                    value={importTargetProjectId}
                    onChange={(e) => setImportTargetProjectId(e.target.value)}
                    className="w-full bg-[#1c1c22] border border-[#2e2e32] rounded-xl px-4 py-2.5 text-[11px] text-white outline-none focus:border-blue-500"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ) : (
              <p className="text-[11px] text-gray-400">正在读取导入文件…</p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeImportModal}
                className="px-4 py-2 rounded-xl bg-[#1c1c22] border border-[#2e2e32] text-[10px] font-black uppercase text-gray-300 hover:bg-[#2e2e36] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/30 transition-colors duration-200"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!importFile || !!importError || (importMode === 'overwrite' && !importTargetProjectId)}
                onClick={() => {
                  if (!importFile || !onImport) return;
                  onImport({
                    file: importFile,
                    mode: importMode,
                    ...(importMode === 'overwrite' ? { targetProjectId: importTargetProjectId } : {}),
                  });
                  closeImportModal();
                }}
                className="px-4 py-2 rounded-xl bg-blue-600 text-[10px] font-black uppercase text-white hover:bg-blue-500 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                开始导入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkspaceProjectShell;
