import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getCompanionLocalBaseUrl } from '../services/companionLocalPrefs';
import { probeCompanionHealth } from '../services/companionClient';
import {
  fetchCompanionArtifactLatest,
  resolveCompanionArtifactDownload,
  type CompanionArtifactSummary,
} from '../services/companionArtifactsClient';

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
  activeWorkspaceProjectId: string;
  onOpenApiKeyModal: () => void;
  aiInvocationReady: boolean;
  aiPlatformLabel: string;
};

/** 窄侧栏底部：少套层、少 padding，避免固定宽度下文字竖排错乱 */
const WorkspaceSidebarFooter: React.FC<WorkspaceSidebarFooterProps> = ({
  user,
  activeWorkspaceProjectId,
  onOpenApiKeyModal,
  aiInvocationReady,
  aiPlatformLabel,
}) => {
  const [companionLinked, setCompanionLinked] = useState<boolean | null>(null);
  /** 当前仅发行 Windows 桌面壳；侧栏与弹窗均拉取 win32 latest */
  const [latestWinShell, setLatestWinShell] = useState<CompanionArtifactSummary | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [companionDownloadModalOpen, setCompanionDownloadModalOpen] = useState(false);

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
      setLatestWinShell(null);
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
      } catch {
        if (!alive) return;
        setLatestWinShell(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.id, activeWorkspaceProjectId]);

  const runWinShellDownload = useCallback(async (artifactId: string) => {
    if (!user?.id || !artifactId) return;
    setDownloadBusy(true);
    try {
      const r = await resolveCompanionArtifactDownload(artifactId);
      window.open(r.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch {
      /* 静默 */
    } finally {
      setDownloadBusy(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!companionDownloadModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCompanionDownloadModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [companionDownloadModalOpen]);

  const companionStatusLong =
    companionLinked === true ? '已连接' : companionLinked === false ? '未连接' : '检测中…';
  const companionCardTitle = `本地伴侣 · ${companionStatusLong}${latestWinShell ? ` · ${latestWinShell.fileName}` : ''}`;

  return (
    <div className="flex w-full min-w-0 shrink-0 flex-col gap-2.5 px-1 py-2">
      {user?.id ? (
        <button
          type="button"
          onClick={onOpenApiKeyModal}
          className="flex w-full min-w-0 items-center justify-center gap-1.5 rounded-lg bg-white/[0.05] px-2 py-2 ring-1 ring-white/[0.07] hover:bg-white/[0.08]"
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
            className={`h-2 w-2 shrink-0 rounded-full ${
              aiInvocationReady ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
          <span className="text-[8px] font-bold leading-snug text-gray-300">{platformAbbrev(aiPlatformLabel)}</span>
        </button>
      ) : null}

      {user?.id && activeWorkspaceProjectId ? (
        <div
          className="w-full min-w-0 rounded-lg bg-white/[0.04] px-2 py-2 ring-1 ring-white/[0.07]"
          title={companionCardTitle}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                companionLinked === true ? 'bg-emerald-400' : companionLinked === false ? 'bg-rose-400' : 'bg-amber-300'
              }`}
              role="status"
              aria-label={companionStatusLong}
            />
            <span className="min-w-0 truncate text-[8px] font-bold leading-snug text-gray-200">本地</span>
          </div>
          <button
            type="button"
            onClick={() => setCompanionDownloadModalOpen(true)}
            className="mt-2 flex h-8 w-full min-w-0 items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-500"
            title="查看桌面伴侣说明与下载"
            aria-label="打开桌面伴侣下载说明"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 4v11" />
            </svg>
          </button>
        </div>
      ) : null}

      {companionDownloadModalOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[2500] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
              role="presentation"
              onClick={() => setCompanionDownloadModalOpen(false)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="companion-download-modal-title"
                className="max-h-[min(90vh,640px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#121214] p-5 shadow-2xl ring-1 ring-white/[0.06]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 id="companion-download-modal-title" className="text-sm font-black uppercase tracking-wide text-blue-300/95">
                    Asset Cutter 桌面伴侣
                  </h2>
                  <button
                    type="button"
                    onClick={() => setCompanionDownloadModalOpen(false)}
                    className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-gray-400 hover:bg-white/[0.06] hover:text-gray-200"
                    aria-label="关闭"
                  >
                    ✕
                  </button>
                </div>

                <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
                  桌面伴侣是在<strong className="text-gray-300">本机运行</strong>的轻量程序，与网站配对后，为工作区提供<strong className="text-gray-300">可信赖的本机通道</strong>
                  ：项目与素材可落在磁盘、对接宿主插件与本地计算，减轻浏览器存储压力，适合大图、模型与批量任务。
                </p>

                <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">主要能力</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[10px] leading-relaxed text-gray-400">
                  <li>工作区根目录挂载，与网站共用同一套项目与资源路径</li>
                  <li>配对鉴权后安全访问本机 HTTP 服务（能力探测、存储与任务）</li>
                  <li>支持宿主插件包与伴侣侧计算任务（如本地命令/探测流水线）</li>
                  <li>大文件优先走本机，降低浏览器 IndexedDB 配额与反复上传</li>
                </ul>

                <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-gray-500">有 / 无本地伴侣</p>
                <div className="mt-2 overflow-x-auto rounded-lg border border-white/[0.08]">
                  <table className="w-full min-w-[280px] border-collapse text-left text-[10px]">
                    <thead>
                      <tr className="border-b border-white/[0.08] bg-white/[0.04]">
                        <th className="px-2 py-2 font-black text-gray-300">场景</th>
                        <th className="px-2 py-2 font-bold text-gray-500">无本地伴侣</th>
                        <th className="px-2 py-2 font-bold text-blue-200/95">有本地伴侣</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-400">
                      <tr className="border-b border-white/[0.06]">
                        <td className="px-2 py-2 text-gray-300">工作区与素材</td>
                        <td className="px-2 py-2">依赖浏览器与手动导出，大项目易顶配额</td>
                        <td className="px-2 py-2 text-gray-300">本机目录统一落盘，路径清晰、可备份</td>
                      </tr>
                      <tr className="border-b border-white/[0.06]">
                        <td className="px-2 py-2 text-gray-300">插件 / 本地算力</td>
                        <td className="px-2 py-2">无法使用本机插件包与伴侣计算任务</td>
                        <td className="px-2 py-2 text-gray-300">宿主插件、exec/probe 等可在本机执行</td>
                      </tr>
                      <tr className="border-b border-white/[0.06]">
                        <td className="px-2 py-2 text-gray-300">协作与接续</td>
                        <td className="px-2 py-2">换机主要依赖云索引与导出，画布仍以本机为准</td>
                        <td className="px-2 py-2 text-gray-300">同一工作区根目录可多台接续编辑</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-2 text-gray-300">隐私与流量</td>
                        <td className="px-2 py-2">敏感素材多经浏览器与网络往返</td>
                        <td className="px-2 py-2 text-gray-300">大资源可留本机，减少不必要上传</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-gray-500">选择平台</p>
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
                    <div>
                      <p className="text-[11px] font-bold text-gray-200">Windows</p>
                      <p className="text-[9px] text-gray-500">
                        {latestWinShell
                          ? `当前版本 v${latestWinShell.semver} · ${latestWinShell.fileName}`
                          : '暂无已发布的安装包'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={!user?.id || !latestWinShell?.id || downloadBusy}
                      onClick={() => latestWinShell?.id && void runWinShellDownload(latestWinShell.id)}
                      className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-[10px] font-black uppercase text-white hover:bg-blue-500 disabled:opacity-45"
                    >
                      {downloadBusy ? '…' : '下载'}
                    </button>
                  </div>
                  <div className="rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] px-3 py-2.5 opacity-70">
                    <p className="text-[11px] font-bold text-gray-400">macOS</p>
                    <p className="text-[9px] text-gray-600">敬请期待（占位，待开发）</p>
                  </div>
                  <div className="rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] px-3 py-2.5 opacity-70">
                    <p className="text-[11px] font-bold text-gray-400">Linux</p>
                    <p className="text-[9px] text-gray-600">敬请期待（占位，待开发）</p>
                  </div>
                </div>

                <p className="mt-4 text-[9px] leading-relaxed text-gray-600">
                  安装后请在桌面伴侣与网站设置中完成<strong className="text-gray-500">配对</strong>（通信密码与允许的站点地址一致）。下载链接短时有效，若失败请重试。
                </p>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
};

export default WorkspaceSidebarFooter;
