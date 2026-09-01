import React, { Suspense } from 'react';
import type { WorkspacePersistUserId, WorkspaceProject } from '../services/workspaceProjectStore';
import { hasWorkbenchFileSourceApi } from '../services/workshopFileTree';
import WorkspaceProjectShell from './WorkspaceProjectShell';
import WorkflowErrorBoundary from './workflow/WorkflowErrorBoundary';
import LazySectionFallback from './ui/LazySectionFallback';

export type WorkflowModeShellProps = {
  showWorkspaceIdbHydrateOverlay: boolean;
  activeWorkspaceProjectId: string | null;
  user: { id?: string | null; role?: string | null } | null | undefined;
  workspaceProjects: WorkspaceProject[];
  persistUserId?: WorkspacePersistUserId;
  onWorkspaceCreate: (name: string) => void;
  onWorkspaceOpen: (id: string) => void;
  onWorkspaceRename: (id: string, name: string) => void;
  onWorkspaceDelete: (id: string) => void;
  onWorkspaceExport?: (id: string) => void;
  onWorkspaceImport?: (payload: { file: File; mode: 'new' | 'overwrite'; targetProjectId?: string }) => void;
  onOpenWorkspaceTrash?: () => void;
  /** 工作流 chunk 懒加载失败后重建 React.lazy */
  onWorkflowSectionLoadRetry?: () => void;
  /** 与 lazy 重试计数同步，强制 Suspense 重置 */
  workflowSectionSuspenseKey?: number;
  /** 仅在已选项目时调用，避免未进入画布就实例化懒加载的 WorkflowSection */
  renderWorkflowSection: () => React.ReactNode;
};

const WorkflowModeShell: React.FC<WorkflowModeShellProps> = ({
  showWorkspaceIdbHydrateOverlay,
  activeWorkspaceProjectId,
  user,
  workspaceProjects,
  persistUserId = null,
  onWorkspaceCreate,
  onWorkspaceOpen,
  onWorkspaceRename,
  onWorkspaceDelete,
  onWorkspaceExport,
  onWorkspaceImport,
  onOpenWorkspaceTrash,
  onWorkflowSectionLoadRetry,
  workflowSectionSuspenseKey = 0,
  renderWorkflowSection,
}) => {
  const workbenchFolderMode = hasWorkbenchFileSourceApi();
  const showWorkflowCanvas = Boolean(activeWorkspaceProjectId) || workbenchFolderMode;
  return (
  <div className={showWorkflowCanvas ? 'relative flex h-full min-h-0 w-full flex-col' : 'relative w-full'}>
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
        showWorkflowCanvas ? 'flex min-h-0 flex-1 flex-col' : '',
        showWorkspaceIdbHydrateOverlay ? 'pointer-events-none select-none opacity-[0.72]' : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined}
    >
      {!showWorkflowCanvas && (
          <WorkspaceProjectShell
            projects={workspaceProjects}
            persistUserId={persistUserId}
            onCreate={onWorkspaceCreate}
            onOpen={onWorkspaceOpen}
            onRename={onWorkspaceRename}
            onDelete={onWorkspaceDelete}
            onExport={onWorkspaceExport}
            onImport={onWorkspaceImport}
            onOpenTrash={onOpenWorkspaceTrash}
          />
      )}
      {showWorkflowCanvas && (
        <WorkflowErrorBoundary onRetry={onWorkflowSectionLoadRetry}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Suspense
              key={workflowSectionSuspenseKey}
              fallback={<LazySectionFallback label="工作区" />}
            >
              {renderWorkflowSection()}
            </Suspense>
          </div>
        </WorkflowErrorBoundary>
      )}
    </div>
  </div>
  );
};

export default WorkflowModeShell;
