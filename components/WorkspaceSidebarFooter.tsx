import React, { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import {
  fetchCompanionArtifactLatest,
  resolveCompanionArtifactDownload,
  type CompanionArtifactSummary,
} from '../services/companionArtifactsClient';
import { HttpRequestError } from '../services/httpClient';
import {
  CREDITS_LOW_BALANCE_THRESHOLD,
  fmtCredits,
  fmtCreditsSidebar,
} from '../shared/credits';
import { useCreditBalance } from '../hooks/useCreditBalance';

/** 侧栏底栏：与「已接」等同宽同间距（见 App 左侧 fixed w-14 栏最底部） */
const SIDEBAR_STATUS_ROW_CLASS =
  'flex w-full min-w-0 items-center justify-center gap-1.5 rounded-lg bg-white/[0.05] px-2 py-2 ring-1 ring-white/[0.07]';

const SIDEBAR_STATUS_BTN_CLASS = `${SIDEBAR_STATUS_ROW_CLASS} hover:bg-white/[0.08] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]`;

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

export type WorkspaceSidebarFooterProps = {
  user: { id?: string | null; role?: string | null } | null | undefined;
  activeWorkspaceProjectId?: string | null;
  onOpenApiKeyModal: () => void;
  aiInvocationReady: boolean;
  aiPlatformLabel: string;
};

/** 窄侧栏底部：积分 + AI 平台 + 本机安装包下载 */
const WorkspaceSidebarFooter: React.FC<WorkspaceSidebarFooterProps> = ({
  user,
  activeWorkspaceProjectId,
  onOpenApiKeyModal,
  aiInvocationReady,
  aiPlatformLabel,
}) => {
  const [latestWinShell, setLatestWinShell] = useState<CompanionArtifactSummary | null>(null);
  const [shellLatestFetchError, setShellLatestFetchError] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const { balance, loading: creditsLoading } = useCreditBalance(user?.id);

  useEffect(() => {
    if (!user?.id) {
      setLatestWinShell(null);
      setShellLatestFetchError(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const r = await fetchCompanionArtifactLatest({
          kind: 'desktop_shell',
          platform: 'win32',
          channel: 'stable',
        });
        if (!alive) return;
        setLatestWinShell(r.latest);
        setShellLatestFetchError(null);
      } catch (e) {
        if (!alive) return;
        setLatestWinShell(null);
        const msg =
          e instanceof HttpRequestError
            ? `${e.message}（HTTP ${e.status}）`
            : e instanceof Error
              ? e.message
              : '拉取发行信息失败';
        setShellLatestFetchError(msg);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.id]);

  const runWinShellDownload = useCallback(async () => {
    if (!user?.id || downloadBusy) return;
    let artifact = latestWinShell;
    if (!artifact?.id) {
      try {
        const r = await fetchCompanionArtifactLatest({
          kind: 'desktop_shell',
          platform: 'win32',
          channel: 'stable',
        });
        artifact = r.latest;
        setLatestWinShell(r.latest);
        setShellLatestFetchError(null);
      } catch (e) {
        const msg =
          e instanceof HttpRequestError
            ? `${e.message}（HTTP ${e.status}）`
            : e instanceof Error
              ? e.message
              : '拉取发行信息失败';
        setShellLatestFetchError(msg);
        window.alert(msg);
        return;
      }
    }
    if (!artifact?.id) {
      window.alert(
        shellLatestFetchError ||
          '暂无已发布的安装包（请管理员在「本地伴侣发行」登记 Windows stable 壳）',
      );
      return;
    }
    setDownloadBusy(true);
    try {
      const r = await resolveCompanionArtifactDownload(artifact.id);
      window.open(r.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : '下载链接获取失败，请稍后重试';
      window.alert(msg);
    } finally {
      setDownloadBusy(false);
    }
  }, [user?.id, downloadBusy, latestWinShell, shellLatestFetchError]);

  const creditsLabel = creditsLoading ? '…' : fmtCreditsSidebar(balance);
  const creditsTitle =
    creditsLoading
      ? '加载积分余额…'
      : balance == null
        ? '积分余额暂不可用'
        : balance <= 0
          ? `积分已用完（${fmtCredits(balance)}）`
          : balance < CREDITS_LOW_BALANCE_THRESHOLD
            ? `积分偏低：${fmtCredits(balance)}`
            : `剩余 AI 积分 ${fmtCredits(balance)}`;

  const downloadTitle = latestWinShell
    ? `下载本地伴侣安装包 · v${latestWinShell.semver}`
    : shellLatestFetchError
      ? `下载本地伴侣安装包 · ${shellLatestFetchError}`
      : '下载最新本地伴侣安装包';

  return (
    <div className="flex w-full min-w-0 shrink-0 flex-col gap-2.5 px-1 py-2">
      {user?.id ? (
        <div
          data-ac-sidebar-credits
          className={SIDEBAR_STATUS_ROW_CLASS}
          title={creditsTitle}
          role="status"
          aria-label={creditsTitle}
        >
          <span className="text-[8px] font-bold leading-[1.25] tabular-nums text-gray-300">{creditsLabel}</span>
        </div>
      ) : null}

      {user?.id ? (
        <button
          type="button"
          onClick={onOpenApiKeyModal}
          className={SIDEBAR_STATUS_BTN_CLASS}
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
            className={`inline-block h-2 w-2 shrink-0 rounded-full align-middle ${
              aiInvocationReady ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
          <span className="text-[8px] font-bold leading-[1.25] text-gray-300">{platformAbbrev(aiPlatformLabel)}</span>
        </button>
      ) : null}

      {user?.id && activeWorkspaceProjectId ? (
        <button
          type="button"
          onClick={() => void runWinShellDownload()}
          disabled={downloadBusy}
          className={SIDEBAR_STATUS_BTN_CLASS}
          title={downloadTitle}
          aria-label={downloadTitle}
        >
          <Download
            className={`h-3.5 w-3.5 shrink-0 text-gray-300 ${downloadBusy ? 'opacity-45' : ''}`}
            strokeWidth={2.25}
            aria-hidden
          />
        </button>
      ) : null}
    </div>
  );
};

export default WorkspaceSidebarFooter;

export { SIDEBAR_STATUS_BTN_CLASS, SIDEBAR_STATUS_ROW_CLASS };
