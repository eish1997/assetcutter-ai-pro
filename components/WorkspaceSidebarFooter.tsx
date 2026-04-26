import React from 'react';
import { CustomDropdown } from './ui/CustomDropdown';
import { WorkspaceCloudSyncCountdown } from './WorkspaceCloudSyncCountdown';

function formatWorkspaceCloudMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type WorkspaceSidebarFooterProps = {
  user: { id?: string | null; role?: string | null } | null | undefined;
  activeWorkspaceProjectId: string;
  workspaceCloudEnabled: boolean;
  workspaceCloudUsedBytes: number;
  workspaceCloudQuotaBytes: number;
  workspaceCloudUsageRatio: number;
  workspaceCloudUsagePercent: number;
  workspaceProjectOptions: Array<{ value: string; label: string }>;
  activeWorkspaceProjectName: string;
  workspaceCloudHydratingProjectId: string | null;
  workspaceLastSyncText: string;
  workspaceCloudAutoSyncing: boolean;
  workspaceAutoSyncEnabled: boolean;
  workspaceCloudNextAutoSyncAt: number | null;
  onToggleWorkspaceAutoSync: () => void;
  onTriggerWorkspaceSyncNow: () => void;
  onOpenApiKeyModal: () => void;
  aiInvocationReady: boolean;
  aiPlatformLabel: string;
  onBackToWorkspaceList: () => void | Promise<void>;
  onWorkspaceOpen: (id: string) => void | Promise<void>;
};

/**
 * 工作区已进入项目时：主导航底部 Footer（窄栏竖排，与方案 4 一致）。
 * 长文案进 title，列表仍走 CustomDropdown Portal。
 */
const WorkspaceSidebarFooter: React.FC<WorkspaceSidebarFooterProps> = ({
  user,
  activeWorkspaceProjectId,
  workspaceCloudEnabled,
  workspaceCloudUsedBytes,
  workspaceCloudQuotaBytes,
  workspaceCloudUsageRatio,
  workspaceCloudUsagePercent,
  workspaceProjectOptions,
  activeWorkspaceProjectName,
  workspaceCloudHydratingProjectId,
  workspaceLastSyncText,
  workspaceCloudAutoSyncing,
  workspaceAutoSyncEnabled,
  workspaceCloudNextAutoSyncAt,
  onToggleWorkspaceAutoSync,
  onTriggerWorkspaceSyncNow,
  onOpenApiKeyModal,
  aiInvocationReady,
  aiPlatformLabel,
  onBackToWorkspaceList,
  onWorkspaceOpen,
}) => (
  <div className="shrink-0 border-t border-white/[0.06] bg-[#0a0a0d]/95 px-1.5 py-2 flex flex-col gap-2">
    <button
      type="button"
      onClick={() => {
        void onBackToWorkspaceList();
      }}
      className="inline-flex w-full h-9 items-center justify-center rounded-xl bg-white/[0.05] text-gray-300 ring-1 ring-white/[0.06] hover:bg-white/[0.09] hover:text-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
      title="返回项目列表（将先同步到云端）"
      aria-label="返回项目列表"
    >
      <svg aria-hidden viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none">
        <path
          d="M12.5 4.5L7 10l5.5 5.5"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>

    <div className="w-full">
      <CustomDropdown
        options={workspaceProjectOptions}
        value={activeWorkspaceProjectId}
        onChange={(id) => {
          if (!id || id === activeWorkspaceProjectId) return;
          void onWorkspaceOpen(id);
        }}
        placeholder={activeWorkspaceProjectName || '项目'}
        triggerAriaLabel={`当前项目：${activeWorkspaceProjectName || '选择项目'}`}
        renderTrigger={({ open }) => (
          <span
            className={`flex w-full h-9 flex-col items-center justify-center rounded-xl bg-white/[0.05] outline-none transition-colors ring-1 ${
              open ? 'ring-blue-500/50 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.35)]' : 'ring-white/[0.06] hover:bg-white/[0.09]'
            }`}
            title={activeWorkspaceProjectName || '切换项目'}
          >
            <svg viewBox="0 0 20 20" className="w-3.5 h-3.5 text-blue-300/90" fill="none" aria-hidden>
              <path
                d="M4 6.5h12v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="M4 8.5h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="mt-0.5 max-w-full truncate px-0.5 text-[6px] font-black uppercase leading-none text-gray-400">
              {activeWorkspaceProjectName || '项目'}
            </span>
          </span>
        )}
        triggerClassName="w-full p-0 border-0 bg-transparent"
        portalZIndex={{ backdrop: 1100, list: 1101 }}
      />
    </div>

    {workspaceCloudHydratingProjectId === activeWorkspaceProjectId ? (
      <p
        className="text-[6px] text-amber-400/90 text-center leading-tight font-medium animate-pulse px-0.5"
        title="正按资源分批从云端还原图像"
      >
        载入中…
      </p>
    ) : null}

    {user?.id && workspaceCloudEnabled ? (
      <>
        <div
          className={`rounded-lg bg-white/[0.03] px-1 py-1 text-[6px] leading-tight ring-1 ring-white/[0.06] ${
            workspaceCloudAutoSyncing ? 'text-blue-300/90' : 'text-gray-500'
          }`}
          title={`云同步: ${workspaceLastSyncText} · 自动同步倒计时（悬停查看详情）`}
        >
          <div className="text-center text-gray-600 uppercase tracking-wide mb-0.5">同步</div>
          <div className="text-center text-gray-400 tabular-nums">
            <WorkspaceCloudSyncCountdown
              enabled={workspaceAutoSyncEnabled}
              nextAt={workspaceCloudNextAutoSyncAt}
              syncing={workspaceCloudAutoSyncing}
            />
          </div>
        </div>

        <div className="flex items-center justify-center gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={workspaceAutoSyncEnabled}
            onClick={onToggleWorkspaceAutoSync}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
              workspaceAutoSyncEnabled ? 'bg-blue-600' : 'bg-[#26262c]'
            }`}
            title={
              workspaceAutoSyncEnabled
                ? '关闭自动同步；需要时点「立即同步」'
                : '开启自动同步，按间隔备份到云端'
            }
            aria-label={workspaceAutoSyncEnabled ? '自动同步已开启' : '自动同步已关闭'}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                workspaceAutoSyncEnabled ? 'translate-x-[18px]' : 'translate-x-0'
              }`}
            />
          </button>
          <button
            type="button"
            onClick={onTriggerWorkspaceSyncNow}
            disabled={workspaceCloudAutoSyncing}
            className="flex h-9 flex-1 min-w-0 items-center justify-center rounded-lg bg-white/[0.05] text-gray-300 ring-1 ring-white/[0.06] hover:bg-white/[0.09] disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
            title="立即同步当前工作区到云端"
            aria-label="立即同步到云端"
          >
            <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" aria-hidden>
              <path
                d="M10 3v10m0 0l3-3m-3 3L7 10M5 16h10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div
          className="rounded-md bg-white/[0.03] px-1 py-1 ring-1 ring-white/[0.06]"
          title={`云空间 ${formatWorkspaceCloudMb(workspaceCloudUsedBytes)} / ${formatWorkspaceCloudMb(workspaceCloudQuotaBytes)}`}
        >
          <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
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
          <div className="mt-0.5 text-[6px] font-mono tabular-nums text-center text-gray-500 leading-none">
            {formatWorkspaceCloudMb(workspaceCloudUsedBytes)}/{formatWorkspaceCloudMb(workspaceCloudQuotaBytes)}
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenApiKeyModal}
          className="flex w-full flex-col items-center justify-center gap-0.5 rounded-xl bg-white/[0.05] px-1 py-1.5 ring-1 ring-white/[0.06] hover:bg-white/[0.09] hover:ring-blue-500/35 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/45"
          title={
            aiInvocationReady
              ? `${aiPlatformLabel} · 已就绪，点击配置`
              : `${aiPlatformLabel} · 未就绪，点击配置`
          }
          aria-label={aiInvocationReady ? `${aiPlatformLabel} 已就绪` : `${aiPlatformLabel} 未就绪`}
        >
          <span
            role="status"
            aria-hidden
            className={`h-2 w-2 rounded-full border border-[#3a3a40] ${
              aiInvocationReady
                ? 'bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]'
                : 'bg-[#b45309] shadow-[0_0_6px_rgba(217,119,6,0.35)]'
            }`}
          />
          <span className="max-w-full line-clamp-2 text-center text-[6px] font-semibold leading-tight text-gray-300 normal-case">
            {aiPlatformLabel}
          </span>
        </button>
      </>
    ) : null}
  </div>
);

export default WorkspaceSidebarFooter;
