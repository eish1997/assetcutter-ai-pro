import React, { useEffect, useState } from 'react';
import type { BulkImageJob } from '../../types-admin';
import { BULK_STATUS_BADGE_CLASSNAMES, BULK_STATUS_LABELS } from '../../types-admin';
import { cancelJobById, fetchJob } from '../../services/adminBulkImageApi';

type AdminJobDetailProps = {
  jobId: string;
  onBack: () => void;
};

const AdminJobDetail: React.FC<AdminJobDetailProps> = ({ jobId, onBack }) => {
  const [job, setJob] = useState<BulkImageJob | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const j = await fetchJob(jobId);
        if (cancelled) return;
        setJob(j);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || '加载任务详情失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const timer = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [jobId]);

  const handleCancel = async () => {
    if (!job) return;
    if (!['pending', 'running'].includes(job.status)) return;
    if (!window.confirm('确认要取消该任务吗？')) return;
    setCancelLoading(true);
    setError('');
    try {
      const updated = await cancelJobById(job.id);
      setJob(updated);
    } catch (e) {
      setError((e as Error).message || '取消任务失败');
    } finally {
      setCancelLoading(false);
    }
  };

  const completed = job?.results?.length ?? 0;
  const total = job?.totalImages ?? 0;
  const durationSec =
    job && job.updatedAt && job.createdAt
      ? Math.max(0, Math.round((job.updatedAt - job.createdAt) / 1000))
      : null;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="text-[11px] text-gray-400 hover:text-gray-100 transition-colors"
      >
        ← 返回任务列表
      </button>
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-[11px] text-red-200">
          {error}
        </div>
      )}
      {loading && !job && <div className="text-[11px] text-gray-500">加载中…</div>}
      {job && (
        <>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-[0.18em]">任务 ID</p>
                <p className="mt-1 font-mono text-[10px] text-blue-200 break-all">{job.id}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`px-3 py-1 rounded-full text-[10px] border ${BULK_STATUS_BADGE_CLASSNAMES[job.status]}`}
                >
                  <span className="text-[10px]">
                    {BULK_STATUS_LABELS[job.status]}
                  </span>
                </span>
                {['pending', 'running'].includes(job.status) && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={cancelLoading}
                    className="px-3 py-1 rounded-xl border border-red-500/60 bg-red-600/30 text-[10px] text-red-100 hover:bg-red-600/50 disabled:opacity-60"
                  >
                    {cancelLoading ? '取消中…' : '取消任务'}
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px] text-gray-300">
              <div>
                <p className="text-[10px] text-gray-400">总张数</p>
                <p className="mt-1">{job.totalImages}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">已完成</p>
                <p className="mt-1">
                  {completed} / {total}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">耗时</p>
                <p className="mt-1 text-gray-300">{durationSec != null ? `${durationSec}s` : '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">创建时间</p>
                <p className="mt-1 text-gray-300">{new Date(job.createdAt).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">最近更新</p>
                <p className="mt-1 text-gray-300">{new Date(job.updatedAt).toLocaleString()}</p>
              </div>
            </div>
            {job.errorSummary && (
              <div className="text-[11px] text-red-200 space-y-2">
                <div>
                  <p className="text-[10px] text-red-300 mb-1">错误摘要</p>
                  <p>{job.errorSummary}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[10px] text-gray-400">日志搜索建议：</p>
                  <button
                    type="button"
                    onClick={() =>
                      navigator.clipboard.writeText(`[job] failed id=${job.id}`)
                    }
                    className="px-2 py-1 rounded-lg border border-white/20 bg-black/40 text-[9px] text-gray-200 hover:bg-white/10"
                  >
                    复制「[job] failed id=...」
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      navigator.clipboard.writeText(`[job] created id=${job.id}`)
                    }
                    className="px-2 py-1 rounded-lg border border-white/20 bg-black/40 text-[9px] text-gray-200 hover:bg-white/10"
                  >
                    复制「[job] created id=...」
                  </button>
                </div>
              </div>
            )}
            <details className="text-[11px] text-gray-300">
              <summary className="cursor-pointer text-gray-400 text-[10px]">查看指令与参数</summary>
              <div className="mt-2 space-y-1">
                <p className="text-[10px] text-gray-400">指令</p>
                <p className="whitespace-pre-wrap break-words">{job.instruction}</p>
                {job.model && (
                  <p className="text-[10px] text-gray-400 mt-2">
                    模型：<span className="text-gray-200">{job.model}</span>
                  </p>
                )}
                {(job.aspectRatio || job.imageSize) && (
                  <p className="text-[10px] text-gray-400 mt-1">
                    {job.aspectRatio && (
                      <span className="mr-3">
                        比例：<span className="text-gray-200">{job.aspectRatio}</span>
                      </span>
                    )}
                    {job.imageSize && (
                      <span>
                        尺寸：<span className="text-gray-200">{job.imageSize}</span>
                      </span>
                    )}
                  </p>
                )}
              </div>
            </details>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
            <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-300 mb-3">
              已生成图片（{completed} / {total}）
            </h2>
            {completed === 0 ? (
              <p className="text-[11px] text-gray-500">暂无已生成图片。</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {job.results.map((src, index) => (
                  <div
                    key={`${index}-${src.slice(0, 16)}`}
                    className="aspect-square rounded-xl overflow-hidden border border-white/10 bg-white/5"
                  >
                    <img src={src} alt={`result-${index + 1}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AdminJobDetail;

