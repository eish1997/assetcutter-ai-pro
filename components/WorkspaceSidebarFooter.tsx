import React, { useEffect, useState } from 'react';
import { formatWorkspaceSyncCountdownRemaining } from './WorkspaceCloudSyncCountdown';
import { getCompanionLocalBaseUrl } from '../services/companionLocalPrefs';
import { probeCompanionHealth } from '../services/companionClient';
import {
  fetchCompanionArtifactLatest,
  resolveCompanionArtifactDownload,
  type CompanionArtifactSummary,
} from '../services/companionArtifactsClient';

function formatWorkspaceCloudMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function guessArtifactPlatform(): string {
  if (typeof navigator === 'undefined') return 'win32';
  const fromUA = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  const p = String(fromUA || navigator.platform || '').toLowerCase();
  if (p.includes('win')) return 'win32';
  if (p.includes('mac')) return 'darwin';
  return 'linux';
}

function platformAbbrev(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return '?';
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.every((w) => /^[ -~]+$/.test(w))) {
    return words
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 3);
  }
  return trimmed.slice(0, 2);
}

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
    </svg>
  );
}

function SyncToolbarTooltipHost({
  workspaceLastSyncText,
  workspaceCloudAutoSyncing,
  workspaceAutoSyncEnabled,
  workspaceCloudNextAutoSyncAt,
  children,
}: {
  workspaceLastSyncText: string;
  workspaceCloudAutoSyncing: boolean;
  workspaceAutoSyncEnabled: boolean;
  workspaceCloudNextAutoSyncAt: number | null;
  children: React.ReactNode;
}) {
  const [tip, setTip] = useState('');
  useEffect(() => {
    const run = () => {
      let line2 = '';
      if (workspaceCloudAutoSyncing) line2 = '状态：正在同步到云端…';
      else if (!workspaceAutoSyncEnabled) line2 = '自动同步：已关闭（打开开关后按间隔备份）';
      else if (workspaceCloudNextAutoSyncAt == null) line2 = '自动同步：已开启 · 下次时间计算中';
      else
        line2 = `自动同步：已开启 · 下次约 ${formatWorkspaceSyncCountdownRemaining(workspaceCloudNextAutoSyncAt - Date.now())}`;
      setTip(
        `云同步 · 最近：${workspaceLastSyncText}\n${line2}\n默认同步：项目索引等轻量数据；画布与大图以本机为主，换浏览器不会自动出现同一张图。\n开关：切换自动同步；下方按钮：立即同步一次`,
      );
    };
    run();
    if (!workspaceAutoSyncEnabled || workspaceCloudNextAutoSyncAt == null || workspaceCloudAutoSyncing) {
      return;
    }
    const t = window.setInterval(run, 1000);
    return () => window.clearInterval(t);
  }, [
    workspaceLastSyncText,
    workspaceCloudAutoSyncing,
    workspaceAutoSyncEnabled,
    workspaceCloudNextAutoSyncAt,
  ]);

  return (
    <div className="w-full min-w-0" title={tip}>
      {children}
    </div>
  );
}

export type WorkspaceSidebarFooterProps = {
  user: { id?: string | null; role?: string | null } | null | undefined;
  activeWorkspaceProjectId: string;
  workspaceCloudEnabled: boolean;
  workspaceCloudUsedBytes: number;
  workspaceCloudQuotaBytes: number;
  workspaceCloudUsageRatio: number;
  workspaceCloudUsagePercent: number;
  workspaceLastSyncText: string;
  workspaceCloudAutoSyncing: boolean;
  workspaceAutoSyncEnabled: boolean;
  workspaceCloudNextAutoSyncAt: number | null;
  onToggleWorkspaceAutoSync: () => void;
  onTriggerWorkspaceSyncNow: () => void;
  onOpenApiKeyModal: () => void;
  aiInvocationReady: boolean;
  aiPlatformLabel: string;
};

/**
 * 工作区已进入项目时：主导航底部 Footer（云同步、API 等）。
 * 方案三：图标为主、文案缩写，详情见原生 title（悬停）。
 */
const WorkspaceSidebarFooter: React.FC<WorkspaceSidebarFooterProps> = ({
  user,
  activeWorkspaceProjectId,
  workspaceCloudEnabled,
  workspaceCloudUsedBytes,
  workspaceCloudQuotaBytes,
  workspaceCloudUsageRatio,
  workspaceCloudUsagePercent,
  workspaceLastSyncText,
  workspaceCloudAutoSyncing,
  workspaceAutoSyncEnabled,
  workspaceCloudNextAutoSyncAt,
  onToggleWorkspaceAutoSync,
  onTriggerWorkspaceSyncNow,
  onOpenApiKeyModal,
  aiInvocationReady,
  aiPlatformLabel,
}) => {
  const [companionLinked, setCompanionLinked] = useState<boolean | null>(null);
  const [latestShell, setLatestShell] = useState<CompanionArtifactSummary | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    let timer: number | null = null;
    const check = async () => {
      try {
        const base = getCompanionLocalBaseUrl();
        const r = await probeCompanionHealth(base);
        if (!alive) return;
        setCompanionLinked(r.ok);
      } catch {
        if (!alive) return;
        setCompanionLinked(false);
      }
      if (!alive) return;
      timer = window.setTimeout(check, 15000);
    };
    void check();
    return () => {
      alive = false;
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!user?.id || !activeWorkspaceProjectId) {
      setLatestShell(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const r = await fetchCompanionArtifactLatest({
          kind: 'desktop_shell',
          platform: guessArtifactPlatform(),
          channel: 'stable',
        });
        if (!alive) return;
        setLatestShell(r.latest);
      } catch {
        if (!alive) return;
        setLatestShell(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.id, activeWorkspaceProjectId]);

  const onDownloadCompanionShell = async () => {
    if (!user?.id || !latestShell?.id) return;
    setDownloadBusy(true);
    try {
      const r = await resolveCompanionArtifactDownload(latestShell.id);
      window.open(r.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch {
      /* 静默；可后续接 toast */
    } finally {
      setDownloadBusy(false);
    }
  };

  return (
  <div className="flex w-full min-w-0 shrink-0 flex-col gap-2 px-1.5 py-2">
    {user?.id && workspaceCloudEnabled ? (
      <>
        <SyncToolbarTooltipHost
          workspaceLastSyncText={workspaceLastSyncText}
          workspaceCloudAutoSyncing={workspaceCloudAutoSyncing}
          workspaceAutoSyncEnabled={workspaceAutoSyncEnabled}
          workspaceCloudNextAutoSyncAt={workspaceCloudNextAutoSyncAt}
        >
          <div className="flex w-full min-w-0 flex-col items-center gap-1.5 rounded-lg bg-white/[0.03] px-2 py-2 ring-1 ring-white/[0.06]">
            <div className="flex w-full min-w-0 items-center justify-center">
              <CloudIcon className="h-4 w-4 shrink-0 text-gray-400" />
            </div>
            <div className="flex w-full min-w-0 items-center justify-center">
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
                    ? '关闭自动同步（完整说明请悬停本卡片区域）'
                    : '开启自动同步（完整说明请悬停本卡片区域）'
                }
                aria-label={workspaceAutoSyncEnabled ? '自动同步已开启' : '自动同步已关闭'}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    workspaceAutoSyncEnabled ? 'translate-x-[18px]' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </SyncToolbarTooltipHost>

        <button
          type="button"
          onClick={onTriggerWorkspaceSyncNow}
          disabled={workspaceCloudAutoSyncing}
          className="flex h-9 w-full min-w-0 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-gray-300 ring-1 ring-white/[0.06] hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-45 transition-colors"
          title="立即同步：默认推送项目索引等轻量数据；画布大图需在项目列表使用「手动上传」"
          aria-label="立即同步到云端"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" aria-hidden>
            <path
              d="M10 3v10m0 0l3-3m-3 3L7 10M5 16h10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div
          className="w-full min-w-0 rounded-lg bg-white/[0.03] px-2 py-2 ring-1 ring-white/[0.06]"
          title={`云空间用量 ${formatWorkspaceCloudMb(workspaceCloudUsedBytes)} / ${formatWorkspaceCloudMb(workspaceCloudQuotaBytes)}`}
        >
          <div className="h-1.5 w-full min-w-0 rounded-full bg-white/[0.06] overflow-hidden">
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
          className="flex w-full min-w-0 items-center justify-center gap-2 rounded-lg bg-white/[0.05] px-2 py-2 ring-1 ring-white/[0.06] hover:bg-white/[0.09] hover:ring-blue-500/35 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/45"
          title={
            aiInvocationReady
              ? `${aiPlatformLabel} · 已就绪，点击配置 API`
              : `${aiPlatformLabel} · 未就绪，点击配置 API`
          }
          aria-label={aiInvocationReady ? `${aiPlatformLabel} 已就绪` : `${aiPlatformLabel} 未就绪`}
        >
          <span
            role="status"
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full border border-[#3a3a40] ${
              aiInvocationReady
                ? 'bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]'
                : 'bg-[#b45309] shadow-[0_0_6px_rgba(217,119,6,0.35)]'
            }`}
          />
          <span className="text-[10px] font-bold leading-none tracking-tight text-gray-300">
            {platformAbbrev(aiPlatformLabel)}
          </span>
        </button>
      </>
    ) : null}
    {user?.id && activeWorkspaceProjectId ? (
      <div
        className="flex w-full min-w-0 flex-col gap-1 rounded-lg bg-white/[0.03] px-2 py-1.5 ring-1 ring-white/[0.06]"
        title={
          (latestShell ? `发行版 v${latestShell.semver} · ` : '') +
          (companionLinked === true ? '本地伴侣已连接' : companionLinked === false ? '本地伴侣未连接' : '本地伴侣检测中')
        }
      >
        <div className="flex w-full min-w-0 items-center justify-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              companionLinked === true
                ? 'bg-emerald-400'
                : companionLinked === false
                  ? 'bg-rose-400'
                  : 'bg-amber-300'
            }`}
            aria-hidden
          />
          <span className="text-[9px] font-bold leading-none text-gray-300">
            {companionLinked === true ? '伴侣已连' : companionLinked === false ? '伴侣未连' : '伴侣检测中'}
          </span>
        </div>
        {latestShell ? (
          <button
            type="button"
            disabled={downloadBusy}
            onClick={() => void onDownloadCompanionShell()}
            className="w-full rounded-md bg-blue-600/90 py-1 text-[9px] font-bold text-white hover:bg-blue-500 disabled:opacity-50"
            title={`下载桌面壳 ${latestShell.semver}（${latestShell.fileName}）`}
          >
            {downloadBusy ? '…' : `下载壳 v${latestShell.semver}`}
          </button>
        ) : (
          <span className="text-[8px] text-center text-gray-600 leading-tight">暂无发行包</span>
        )}
      </div>
    ) : null}
  </div>
  );
};

export default WorkspaceSidebarFooter;
