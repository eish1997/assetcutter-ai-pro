import React, { Suspense } from 'react';
import type { WorkspaceProject } from '../services/workspaceProjectStore';
import WorkspaceProjectShell from './WorkspaceProjectShell';
import WorkflowErrorBoundary from './workflow/WorkflowErrorBoundary';
import LazySectionFallback from './ui/LazySectionFallback';

function formatWorkspaceCloudMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type WorkflowModeShellProps = {
  showWorkspaceIdbHydrateOverlay: boolean;
  activeWorkspaceProjectId: string | null;
  user: { id?: string | null; role?: string | null } | null | undefined;
  workspaceCloudEnabled: boolean;
  workspaceCloudUsedBytes: number;
  workspaceCloudQuotaBytes: number;
  workspaceCloudUsageRatio: number;
  workspaceCloudUsagePercent: number;
  workspaceProjects: WorkspaceProject[];
  onWorkspaceCreate: (name: string) => void;
  onWorkspaceOpen: (id: string) => void;
  onWorkspaceRename: (id: string, name: string) => void;
  onWorkspaceDelete: (id: string) => void;
  onWorkspaceBind?: (id: string) => void;
  onWorkspaceUnbind?: (id: string) => void;
  onWorkspaceManualUpload?: (id: string) => void;
  onWorkspaceRetryFailedUpload?: (id: string) => void;
  onOpenWorkspaceUploadFailureDetail?: (id: string) => void;
  workspaceUploadingProjectId?: string | null;
  onOpenWorkspaceTrash?: () => void;
  workspaceCloudQuotaSuspended: boolean;
  /** 仅在已选项目时调用，避免未进入画布就实例化懒加载的 WorkflowSection */
  renderWorkflowSection: () => React.ReactNode;
};

const WorkflowModeShell: React.FC<WorkflowModeShellProps> = ({
  showWorkspaceIdbHydrateOverlay,
  activeWorkspaceProjectId,
  user,
  workspaceCloudEnabled,
  workspaceCloudUsedBytes,
  workspaceCloudQuotaBytes,
  workspaceCloudUsageRatio,
  workspaceCloudUsagePercent,
  workspaceProjects,
  onWorkspaceCreate,
  onWorkspaceOpen,
  onWorkspaceRename,
  onWorkspaceDelete,
  onWorkspaceBind,
  onWorkspaceUnbind,
  onWorkspaceManualUpload,
  onWorkspaceRetryFailedUpload,
  onOpenWorkspaceUploadFailureDetail,
  workspaceUploadingProjectId,
  onOpenWorkspaceTrash,
  workspaceCloudQuotaSuspended,
  renderWorkflowSection,
}) => (
  <div className={activeWorkspaceProjectId ? 'relative flex h-full min-h-0 w-full flex-col' : 'relative w-full'}>
    {showWorkspaceIdbHydrateOverlay && (
      <div
        className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 rounded-xl bg-[#050505]/90 backdrop-blur-[2px] border border-white/[0.06]"
        role="status"
        aria-busy="true"
        aria-live="polite"
      >
        <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-blue-500/90 animate-spin" />
        <p className="text-[10px] text-gray-400">正在准备工作区…</p>
      </div>
    )}
    <div
      className={[
        activeWorkspaceProjectId ? 'flex min-h-0 flex-1 flex-col' : '',
        showWorkspaceIdbHydrateOverlay ? 'pointer-events-none select-none opacity-[0.72]' : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined}
    >
      {!activeWorkspaceProjectId && (
        <>
          {user?.id && workspaceCloudEnabled ? (
            <div
              className="max-w-6xl mx-auto w-full mb-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
              title="仅统计已同步到云端的流程图片；默认同步仅更新索引，资产需手动上传"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 gap-y-1">
                <span className="text-[9px] text-gray-500">云空间</span>
                <span className="text-[10px] text-gray-400 font-mono tabular-nums">
                  {formatWorkspaceCloudMb(workspaceCloudUsedBytes)} / {formatWorkspaceCloudMb(workspaceCloudQuotaBytes)}{' '}
                  <span className="text-gray-600">·</span> {workspaceCloudUsagePercent}%
                </span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    workspaceCloudUsageRatio >= 0.95
                      ? 'bg-red-500/70'
                      : workspaceCloudUsageRatio >= 0.8
                        ? 'bg-amber-500/60'
                        : 'bg-gray-500/45'
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, workspaceCloudUsagePercent))}%` }}
                />
              </div>
              <p className="mt-2 text-[9px] text-gray-600 leading-snug">
                以上为<strong className="text-gray-500">云端工作区图片</strong>用量（多来自「手动上传」等显式动作），与「画布是否自动出现在另一台浏览器」<strong className="text-gray-500">不是一回事</strong>
                ；本机另有<strong className="text-gray-500">整站存储上限</strong>（与浏览器有关）。详见设置 → 数据与存储。
              </p>
            </div>
          ) : user?.id && !workspaceCloudEnabled ? (
            <div className="max-w-6xl mx-auto w-full mb-5 rounded-xl bg-white/[0.02] px-4 py-2.5 text-[10px] text-gray-500 ring-1 ring-white/[0.06]">
              工作区云同步已关闭（VITE_WORKSPACE_CLOUD=false），数据仅保存在本机。
            </div>
          ) : null}
          <div className="max-w-6xl mx-auto w-full mb-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[9px] text-gray-500 leading-relaxed">
            <span className="font-semibold text-gray-400">跨设备说明：</span>
            项目目录与画布主存在<strong className="text-gray-400">本机</strong>（浏览器 IndexedDB + 本地伴侣工作区）。登录后云端会同步
            <strong className="text-gray-400">能力预设等账号级数据</strong>以及工作区的<strong className="text-gray-400">轻量索引</strong>；默认
            <strong className="text-gray-400">不会</strong>把整张画布自动出现在另一台电脑的浏览器里。换机继续编辑请使用同一伴侣工作区根目录，或通过导出 / 项目卡片「手动上传」等显式动作。
          </div>
          {onOpenWorkspaceTrash && (
            <div className="mx-auto mb-2 w-full max-w-6xl flex items-center justify-end">
              <button
                type="button"
                onClick={onOpenWorkspaceTrash}
                className="px-3 py-1.5 rounded-lg bg-[#1c1c22] border border-[#2e2e32] text-[10px] font-black uppercase text-gray-300 hover:bg-[#26262c]"
              >
                回收站
              </button>
            </div>
          )}
          <WorkspaceProjectShell
            projects={workspaceProjects}
            onCreate={onWorkspaceCreate}
            onOpen={onWorkspaceOpen}
            onRename={onWorkspaceRename}
            onDelete={onWorkspaceDelete}
            onBind={onWorkspaceBind}
            onUnbind={onWorkspaceUnbind}
            onManualUpload={onWorkspaceManualUpload}
            onRetryFailedUpload={onWorkspaceRetryFailedUpload}
            onOpenUploadFailureDetail={onOpenWorkspaceUploadFailureDetail}
            uploadingProjectId={workspaceUploadingProjectId}
            currentUserId={user?.id ?? null}
          />
        </>
      )}
      {activeWorkspaceProjectId && (
        <WorkflowErrorBoundary>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            {workspaceCloudQuotaSuspended ? (
              <div className="mx-auto mb-1 w-full max-w-6xl shrink-0 rounded-xl border border-amber-500/35 bg-[#2c2412] px-4 py-3 text-[11px] text-amber-100/95 leading-relaxed">
                工作区<strong className="font-semibold">云空间已满</strong>
                ：新图片无法上传，画布仍保存在本机。删除云端项目中的图或请管理员调高配额后可恢复。返回列表或切换项目时若无法上传，请留意本地数据。
              </div>
            ) : null}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Suspense fallback={<LazySectionFallback label="工作区" />}>{renderWorkflowSection()}</Suspense>
            </div>
          </div>
        </WorkflowErrorBoundary>
      )}
    </div>
  </div>
);

export default WorkflowModeShell;
