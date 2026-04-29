import React, { Suspense } from 'react';
import type { WorkspaceProject } from '../services/workspaceProjectStore';
import WorkspaceProjectShell from './WorkspaceProjectShell';
import WorkflowErrorBoundary from './workflow/WorkflowErrorBoundary';
import LazySectionFallback from './ui/LazySectionFallback';

export type WorkflowModeShellProps = {
  showWorkspaceIdbHydrateOverlay: boolean;
  activeWorkspaceProjectId: string | null;
  user: { id?: string | null; role?: string | null } | null | undefined;
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
  /** 仅在已选项目时调用，避免未进入画布就实例化懒加载的 WorkflowSection */
  renderWorkflowSection: () => React.ReactNode;
};

const WorkflowModeShell: React.FC<WorkflowModeShellProps> = ({
  showWorkspaceIdbHydrateOverlay,
  activeWorkspaceProjectId,
  user,
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
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Suspense fallback={<LazySectionFallback label="工作区" />}>{renderWorkflowSection()}</Suspense>
          </div>
        </WorkflowErrorBoundary>
      )}
    </div>
  </div>
);

export default WorkflowModeShell;
