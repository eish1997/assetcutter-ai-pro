import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getCompanionLocalBaseUrl } from '../services/companionLocalPrefs';
import { probeCompanionHealth } from '../services/companionClient';
import {
  fetchCompanionArtifactLatest,
  resolveCompanionArtifactDownload,
  type CompanionArtifactSummary,
} from '../services/companionArtifactsClient';
import { HttpRequestError } from '../services/httpClient';

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
  /** 与「库中无记录」区分：网络 / CORS / 构建未指向 auth-api 等 */
  const [shellLatestFetchError, setShellLatestFetchError] = useState<string | null>(null);
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
          onClick={() => setCompanionDownloadModalOpen(true)}
          className="flex w-full min-w-0 items-center justify-center gap-1.5 rounded-lg bg-white/[0.05] px-2 py-2 ring-1 ring-white/[0.07] hover:bg-white/[0.08]"
          title={`${companionCardTitle} · 点击查看说明与下载`}
          aria-label={`本地伴侣 ${companionStatusLong}，打开说明与下载`}
        >
          <span
            role="status"
            aria-hidden
            className={`inline-block h-2 w-2 shrink-0 rounded-full align-middle ${
              companionLinked === true
                ? 'bg-emerald-500'
                : companionLinked === false
                  ? 'bg-rose-500'
                  : 'bg-amber-500'
            }`}
          />
          <span className="min-w-0 truncate text-[8px] font-bold leading-[1.25] text-gray-300">本地</span>
        </button>
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
                  ：项目与素材可落在磁盘；<strong className="text-gray-300">本机引擎</strong>（分割/抠图等）与可选的<strong className="text-gray-300">扩展包</strong>由伴侣承接，减轻浏览器存储压力，适合大图与批量任务。
                </p>

                <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">主要能力</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[10px] leading-relaxed text-gray-400">
                  <li>工作区根目录挂载，与网站共用同一套项目与资源路径</li>
                  <li>配对鉴权后安全访问本机 HTTP 服务（能力探测、存储与任务）</li>
                  <li>本机引擎（内置计算任务）与可选扩展包（主站 ZIP / probe·exec）</li>
                  <li>大文件优先走本机，降低浏览器 IndexedDB 配额与反复上传</li>
                </ul>

                <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-gray-500">有 / 无本地伴侣</p>
                <p className="mt-1 text-[9px] leading-relaxed text-gray-500">
                  无本地伴侣也可在网站内正常使用 AI 生图与工作流；下表「×」仅表示缺少对应本机目录或伴侣能力，而非不能生图。
                </p>
                <div className="mt-2 overflow-x-auto rounded-lg border border-white/[0.08]">
                  <table className="w-full min-w-[280px] border-collapse text-left text-[10px]">
                    <thead>
                      <tr className="border-b border-white/[0.08] bg-white/[0.04]">
                        <th className="px-2 py-2 font-black text-gray-300">功能</th>
                        <th className="px-2 py-2 font-bold text-gray-500">无本地伴侣</th>
                        <th className="px-2 py-2 font-bold text-blue-200/95">有本地伴侣</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-400">
                      <tr className="border-b border-white/[0.06]">
                        <td className="px-2 py-2 text-gray-300">本机目录落盘与路径备份</td>
                        <td className="px-2 py-2 text-center text-[13px] font-semibold text-rose-400/90">×</td>
                        <td className="px-2 py-2 text-center text-[13px] font-semibold text-emerald-400/90">√</td>
                      </tr>
                      <tr className="border-b border-white/[0.06]">
                        <td className="px-2 py-2 text-gray-300">本机引擎与扩展包算力</td>
                        <td className="px-2 py-2 text-center text-[13px] font-semibold text-rose-400/90">×</td>
                        <td className="px-2 py-2 text-center text-[13px] font-semibold text-emerald-400/90">√</td>
                      </tr>
                      <tr className="border-b border-white/[0.06]">
                        <td className="px-2 py-2 text-gray-300">同一本机根目录跨设备接续</td>
                        <td className="px-2 py-2 text-center text-[13px] font-semibold text-rose-400/90">×</td>
                        <td className="px-2 py-2 text-center text-[13px] font-semibold text-emerald-400/90">√</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-2 text-gray-300">大文件本机驻留、减少上传往返</td>
                        <td className="px-2 py-2 text-center text-[13px] font-semibold text-rose-400/90">×</td>
                        <td className="px-2 py-2 text-center text-[13px] font-semibold text-emerald-400/90">√</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-gray-500">选择平台</p>
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
                    <div>
                      <p className="text-[11px] font-bold text-gray-200">Windows</p>
                      <p
                        className={`text-[9px] ${shellLatestFetchError ? 'text-amber-400/95' : 'text-gray-500'}`}
                      >
                        {shellLatestFetchError
                          ? shellLatestFetchError
                          : latestWinShell
                            ? `当前版本 v${latestWinShell.semver} · ${latestWinShell.fileName}`
                            : '暂无已发布的安装包（请管理员在「本地伴侣发行」登记 Windows stable 壳）'}
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
