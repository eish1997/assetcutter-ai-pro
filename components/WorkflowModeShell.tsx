import React, { Suspense } from 'react';
import type { WorkspaceProject } from '../services/workspaceProjectStore';
import WorkspaceProjectShell from './WorkspaceProjectShell';
import { CustomDropdown } from './ui/CustomDropdown';
import { WorkspaceCloudSyncCountdown } from './WorkspaceCloudSyncCountdown';
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
  onBackToWorkspaceList: () => void | Promise<void>;
  workspaceProjectOptions: Array<{ value: string; label: string }>;
  activeWorkspaceProjectName: string;
  workspaceCloudHydratingProjectId: string | null;
  workspaceLastSyncText: string;
  workspaceCloudAutoSyncing: boolean;
  workspaceAutoSyncEnabled: boolean;
  workspaceCloudNextAutoSyncAt: number | null;
  onToggleWorkspaceAutoSync: () => void;
  onTriggerWorkspaceSyncNow: () => void;
  workspaceCloudQuotaSuspended: boolean;
  onOpenApiKeyModal: () => void;
  aiInvocationReady: boolean;
  /** 顶栏按钮文案：当前选用的 AI 平台（如 Vertex AI、Google Gemini） */
  aiPlatformLabel: string;
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
  onBackToWorkspaceList,
  workspaceProjectOptions,
  activeWorkspaceProjectName,
  workspaceCloudHydratingProjectId,
  workspaceLastSyncText,
  workspaceCloudAutoSyncing,
  workspaceAutoSyncEnabled,
  workspaceCloudNextAutoSyncAt,
  onToggleWorkspaceAutoSync,
  onTriggerWorkspaceSyncNow,
  workspaceCloudQuotaSuspended,
  onOpenApiKeyModal,
  aiInvocationReady,
  aiPlatformLabel,
  renderWorkflowSection,
}) => (
  <div className="relative w-full">
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
    <div className={showWorkspaceIdbHydrateOverlay ? 'pointer-events-none select-none opacity-[0.72]' : undefined}>
      {!activeWorkspaceProjectId && (
        <>
          {user?.id && workspaceCloudEnabled ? (
            <div
              className="max-w-6xl mx-auto w-full mb-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
              title="仅统计已同步到云端的流程图片；返回列表或切换项目时整包上传"
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
                以上为<strong className="text-gray-500">云端工作区图片</strong>用量；本机浏览器另有
                <strong className="text-gray-500">整站 localStorage 上限</strong>（与浏览器有关）。详见设置 → 数据与存储。
              </p>
            </div>
          ) : user?.id && !workspaceCloudEnabled ? (
            <div className="max-w-6xl mx-auto w-full mb-5 rounded-xl border border-[#2e2e32] bg-[#121214] px-4 py-2.5 text-[10px] text-gray-500">
              工作区云同步已关闭（VITE_WORKSPACE_CLOUD=false），数据仅保存在本机。
            </div>
          ) : null}
          <WorkspaceProjectShell
            projects={workspaceProjects}
            onCreate={onWorkspaceCreate}
            onOpen={onWorkspaceOpen}
            onRename={onWorkspaceRename}
            onDelete={onWorkspaceDelete}
          />
        </>
      )}
      {activeWorkspaceProjectId && (
        <WorkflowErrorBoundary>
          <div className="w-full max-w-6xl mx-auto mb-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                void onBackToWorkspaceList();
              }}
              className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[#1c1c22] border border-[#2e2e32] text-gray-300 hover:bg-[#2e2e36] hover:text-white transition-colors duration-200 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              title="返回项目列表（将先同步到云端）"
              aria-label="返回项目列表"
            >
              <svg aria-hidden viewBox="0 0 20 20" className="w-3 h-3" fill="none">
                <path
                  d="M12.5 4.5L7 10l5.5 5.5"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="min-w-[8rem] max-w-[min(100%,18rem)]">
              <CustomDropdown
                options={workspaceProjectOptions}
                value={activeWorkspaceProjectId ?? ''}
                onChange={(id) => {
                  if (!id || id === activeWorkspaceProjectId) return;
                  void onWorkspaceOpen(id);
                }}
                placeholder={activeWorkspaceProjectName || '选择项目'}
                triggerClassName="w-full h-7 bg-[#1c1c22] border border-[#2e2e32] rounded-lg px-2.5 text-[8px] text-left flex items-center justify-between outline-none focus:border-blue-500 hover:bg-[#2e2e36] transition-colors"
              />
            </div>
            {workspaceCloudHydratingProjectId === activeWorkspaceProjectId ? (
              <span className="text-[8px] text-amber-400/90 font-medium animate-pulse" title="正按资源分批从云端还原图像">
                正在从云端渐进载入图像…
              </span>
            ) : null}
            {user?.id && workspaceCloudEnabled ? (
              <div className="flex items-center gap-2">
                <div
                  className={`text-[8px] whitespace-nowrap ${workspaceCloudAutoSyncing ? 'text-blue-300 animate-pulse' : 'text-gray-400'}`}
                >
                  云同步: {workspaceLastSyncText} · 自动同步倒计时{' '}
                  <WorkspaceCloudSyncCountdown
                    enabled={workspaceAutoSyncEnabled}
                    nextAt={workspaceCloudNextAutoSyncAt}
                    syncing={workspaceCloudAutoSyncing}
                  />
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={workspaceAutoSyncEnabled}
                  onClick={onToggleWorkspaceAutoSync}
                  className={`relative inline-flex shrink-0 w-8 h-4 rounded-full transition-colors ${
                    workspaceAutoSyncEnabled ? 'bg-blue-600' : 'bg-[#26262c]'
                  }`}
                  title={
                    workspaceAutoSyncEnabled
                      ? '关闭后不再定时上传，编辑更流畅；需要时点「立即同步」'
                      : '开启后按间隔将改动备份到云端（有改动才上传）'
                  }
                  aria-label={workspaceAutoSyncEnabled ? '自动同步已开启，点击关闭' : '自动同步已关闭，点击开启'}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                      workspaceAutoSyncEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={onTriggerWorkspaceSyncNow}
                  disabled={workspaceCloudAutoSyncing}
                  className="h-6 px-2 rounded-md border border-[#2e2e32] bg-[#1c1c22] text-[8px] text-gray-300 hover:bg-[#2e2e36] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="手动全量同步到云端（关闭自动同步时靠此项备份）"
                  aria-label="立即同步当前工作区到云端"
                >
                  立即同步
                </button>
              </div>
            ) : null}
            {user?.id && workspaceCloudEnabled ? (
              <div className="ml-auto flex items-center gap-1.5">
                <div
                  className="min-w-[8rem] max-w-[12rem] shrink rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1"
                  title="仅统计已同步到云端的流程图片"
                >
                  <div className="flex items-center justify-between gap-1.5 text-[8px] text-gray-500">
                    <span>云空间</span>
                    <span className="font-mono tabular-nums text-gray-400">
                      {formatWorkspaceCloudMb(workspaceCloudUsedBytes)} / {formatWorkspaceCloudMb(workspaceCloudQuotaBytes)}
                    </span>
                  </div>
                  <div className="mt-0.5 h-0.5 rounded-full bg-white/[0.06] overflow-hidden">
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
                </div>
                <button
                  type="button"
                  onClick={onOpenApiKeyModal}
                  className="inline-flex items-center gap-1.5 px-2 h-7 rounded-lg bg-[#1c1c22] border border-[#2e2e32] text-[8px] font-black uppercase hover:bg-[#2e2e36] hover:border-[#3b6fb8] whitespace-nowrap"
                  title={
                    aiInvocationReady
                      ? `${aiPlatformLabel} · 调用源已就绪，点击配置`
                      : `${aiPlatformLabel} · 未就绪（缺 Key 或未配置批量代理），点击配置`
                  }
                  aria-label={
                    aiInvocationReady
                      ? `${aiPlatformLabel}，当前调用源已就绪，点击打开配置`
                      : `${aiPlatformLabel}，当前调用源未就绪，点击打开配置`
                  }
                >
                  <span
                    role="status"
                    aria-hidden={true}
                    className={`h-2 w-2 shrink-0 rounded-full border border-[#3a3a40] ${
                      aiInvocationReady
                        ? 'bg-emerald-500 shadow-[0_0_10px_rgba(34,197,94,0.45)]'
                        : 'bg-[#b45309] shadow-[0_0_8px_rgba(217,119,6,0.35)]'
                    }`}
                  />
                  <span className="max-w-[9rem] truncate normal-case tracking-normal font-semibold">
                    {aiPlatformLabel}
                  </span>
                </button>
              </div>
            ) : null}
          </div>
          {workspaceCloudQuotaSuspended ? (
            <div className="w-full max-w-6xl mx-auto mb-3 rounded-xl border border-amber-500/35 bg-[#2c2412] px-4 py-3 text-[11px] text-amber-100/95 leading-relaxed">
              工作区<strong className="font-semibold">云空间已满</strong>
              ：新图片无法上传，画布仍保存在本机。删除云端项目中的图或请管理员调高配额后可恢复。返回列表或切换项目时若无法上传，请留意本地数据。
            </div>
          ) : null}
          <Suspense fallback={<LazySectionFallback label="工作区" />}>{renderWorkflowSection()}</Suspense>
        </WorkflowErrorBoundary>
      )}
    </div>
  </div>
);

export default WorkflowModeShell;
