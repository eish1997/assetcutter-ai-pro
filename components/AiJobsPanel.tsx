import React from 'react';
import { createPortal } from 'react-dom';
import { useAiJobs } from '../hooks/useAiJobs';
import type { AiJobStatus } from '../services/aiJobsClient';
import type { RestorableAiJobArtifact } from '../services/aiJobArtifacts';
import { extractRestorableAiJobArtifacts } from '../services/aiJobArtifacts';
import {
  aiJobCreditsLabel,
  aiJobModelLabel,
  aiJobRouteLabel,
  aiJobStatusLabel,
  aiJobStatusTone,
  aiJobTraceLabel,
  canCancelAiJobStatus,
  canRetryAiJobStatus,
} from '../services/aiJobDisplay';
import { cancelAiJob, refreshMyAiJob, refreshMyAiJobs, retryAiJob } from '../services/aiJobsStore';
import AppIcon from './ui/AppIcon';

type AiJobsPanelProps = {
  open: boolean;
  signedIn: boolean;
  onClose: () => void;
  onRestoreArtifacts?: (jobId: string, artifacts: RestorableAiJobArtifact[]) => Promise<void> | void;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function isRefreshing(statusById: Record<string, boolean>, jobId: string): boolean {
  return Boolean(statusById[jobId]);
}

const StatusBadge: React.FC<{ status: AiJobStatus }> = ({ status }) => (
  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${aiJobStatusTone(status)}`}>
    {aiJobStatusLabel(status)}
  </span>
);

const AiJobsPanel: React.FC<AiJobsPanelProps> = ({ open, signedIn, onClose, onRestoreArtifacts }) => {
  const state = useAiJobs();
  const [actionError, setActionError] = React.useState('');
  const [restoredJobIds, setRestoredJobIds] = React.useState<Record<string, boolean>>({});

  const load = React.useCallback(async () => {
    if (!signedIn) return;
    setActionError('');
    try {
      await refreshMyAiJobs({ limit: 20 });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '加载失败');
    }
  }, [signedIn]);

  React.useEffect(() => {
    if (!open || !signedIn) return;
    if (state.lastLoadedAt == null && !state.loading && !state.error) void load();
  }, [load, open, signedIn, state.error, state.lastLoadedAt, state.loading]);

  const runAction = React.useCallback(async (action: () => Promise<unknown>) => {
    setActionError('');
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '操作失败');
    }
  }, []);

  const restoreArtifacts = React.useCallback(
    async (jobId: string) => {
      if (!onRestoreArtifacts) return;
      setActionError('');
      try {
        const detail = await refreshMyAiJob(jobId);
        const artifacts = extractRestorableAiJobArtifacts(detail);
        if (!artifacts.length) {
          throw new Error('未找到可回填产物');
        }
        await onRestoreArtifacts(jobId, artifacts);
        setRestoredJobIds((prev) => ({ ...prev, [jobId]: true }));
      } catch (error) {
        setActionError(error instanceof Error ? error.message : '回填失败');
      }
    },
    [onRestoreArtifacts]
  );

  if (!open || typeof document === 'undefined') return null;

  const panel = (
    <div
      className="fixed inset-0 z-[2100] bg-black/35 backdrop-blur-sm flex items-end justify-end p-3 sm:p-4"
      role="dialog"
      aria-label="AI 任务"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[min(760px,calc(100dvh-2rem))] w-[min(480px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f0f0f] shadow-2xl">
        <div className="shrink-0 border-b border-white/[0.06] bg-[#141416] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[12px] font-black uppercase tracking-[0.18em] text-white">AI 任务</h2>
              <p className="mt-1 text-[10px] text-gray-500">最近 20 条</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!signedIn || state.loading}
                onClick={() => {
                  void load();
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-[10px] text-gray-200 transition-colors hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="refresh" className="h-3.5 w-3.5" />
                刷新
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-[#2e2e36] hover:text-white"
                aria-label="关闭 AI 任务"
              >
                <AppIcon name="close" className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 no-scrollbar">
          {!signedIn ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-6 text-center text-[11px] text-gray-500">
              请先登录
            </div>
          ) : state.loading && state.items.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-6 text-center text-[11px] text-gray-500">
              正在加载
            </div>
          ) : state.items.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-6 text-center text-[11px] text-gray-500">
              暂无 AI 任务
            </div>
          ) : (
            <div className="space-y-2">
              {state.items.map((job) => {
                const busy = isRefreshing(state.refreshingJobIds, job.id);
                return (
                  <article key={job.id} className="rounded-xl border border-white/[0.07] bg-[#141416] px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-semibold text-gray-100">{aiJobModelLabel(job)}</div>
                        <div className="mt-1 text-[10px] text-gray-500">{formatDate(job.updatedAt || job.createdAt)}</div>
                      </div>
                      <StatusBadge status={job.status} />
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <dt className="text-gray-600">路由</dt>
                        <dd className="mt-0.5 truncate text-gray-300">{aiJobRouteLabel(job)}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-600">积分</dt>
                        <dd className="mt-0.5 truncate text-gray-400">{aiJobCreditsLabel(job)}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-gray-600">Trace</dt>
                        <dd className="mt-0.5 break-all font-mono text-[9px] text-gray-500">{aiJobTraceLabel(job)}</dd>
                      </div>
                    </dl>

                    {job.error?.message ? (
                      <p className="mt-2 break-words text-[10px] leading-relaxed text-red-300/85">{job.error.message}</p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          void runAction(() => refreshMyAiJob(job.id));
                        }}
                        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[10px] text-gray-300 transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <AppIcon name="refresh" className="h-3 w-3" />
                        {busy ? '处理中' : '刷新'}
                      </button>
                      {canCancelAiJobStatus(job.status) ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void runAction(() => cancelAiJob(job.id));
                          }}
                          className="h-7 rounded-lg border border-amber-500/35 bg-amber-900/15 px-2 text-[10px] text-amber-200 transition-colors hover:bg-amber-900/30 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          取消
                        </button>
                      ) : null}
                      {canRetryAiJobStatus(job.status) ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void runAction(() => retryAiJob(job.id));
                          }}
                          className="h-7 rounded-lg border border-emerald-500/35 bg-emerald-900/15 px-2 text-[10px] text-emerald-200 transition-colors hover:bg-emerald-900/30 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          重试
                        </button>
                      ) : null}
                      {job.status === 'succeeded' && onRestoreArtifacts ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void restoreArtifacts(job.id);
                          }}
                          className="h-7 rounded-lg border border-blue-500/35 bg-blue-900/15 px-2 text-[10px] text-blue-200 transition-colors hover:bg-blue-900/30 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {restoredJobIds[job.id] ? '已回填' : '回填'}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {state.error || actionError ? (
          <div className="shrink-0 border-t border-red-500/20 bg-red-950/20 px-4 py-2 text-[10px] text-red-200">
            {actionError || state.error}
          </div>
        ) : null}
      </div>
    </div>
  );

  return createPortal(panel, document.body);
};

export default AiJobsPanel;
