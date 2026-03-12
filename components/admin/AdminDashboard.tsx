import React, { useEffect, useState } from 'react';
import type { BulkImageHealth, BulkImageJob } from '../../types-admin';
import { fetchHealth, fetchJobs } from '../../services/adminBulkImageApi';

type AdminDashboardProps = {
  onOpenJob: (id: string) => void;
};

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onOpenJob }) => {
  const [health, setHealth] = useState<BulkImageHealth | null>(null);
  const [jobs, setJobs] = useState<BulkImageJob[]>([]);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [h, js] = await Promise.all([fetchHealth(), fetchJobs()]);
        if (cancelled) return;
        setHealth(h);
        setJobs(js);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || '加载数据失败');
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
  }, []);

  const latestJobs = jobs.slice(0, 20);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-[11px] text-red-200">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-[0.18em]">今日 RPD</p>
          <p className="mt-2 text-lg font-semibold">
            {health ? `${health.rpdToday} / ${health.rpdLimit}` : '—'}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-[0.18em]">任务总数</p>
          <p className="mt-2 text-lg font-semibold">{health ? health.jobsTotal : '—'}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-[0.18em]">进行中任务</p>
          <p className="mt-2 text-lg font-semibold text-blue-300">
            {health ? health.jobsPendingOrRunning : '—'}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-[0.18em]">队列 / 并发</p>
          <p className="mt-2 text-lg font-semibold">
            {health ? `${health.queueLength} / ${health.inFlight}` : '—'}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-300">最近任务</h2>
          {loading && <span className="text-[10px] text-gray-500">刷新中…</span>}
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-[11px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-white/10">
                <th className="py-2 pr-4 font-normal">任务 ID</th>
                <th className="py-2 pr-4 font-normal">状态</th>
                <th className="py-2 pr-4 font-normal">张数</th>
                <th className="py-2 pr-4 font-normal">完成</th>
                <th className="py-2 pr-4 font-normal">错误</th>
                <th className="py-2 pr-4 font-normal">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {latestJobs.map((job) => (
                <tr
                  key={job.id}
                  className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                  onClick={() => onOpenJob(job.id)}
                >
                  <td className="py-2 pr-4 font-mono text-[10px] text-blue-200">{job.id}</td>
                  <td className="py-2 pr-4">
                    <span className="px-2 py-0.5 rounded-full text-[10px] border border-white/10 bg-white/5">
                      {job.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{job.totalImages}</td>
                  <td className="py-2 pr-4">{job.results?.length ?? 0}</td>
                  <td className="py-2 pr-4 text-red-300 truncate max-w-xs">
                    {job.errorSummary ? job.errorSummary : ''}
                  </td>
                  <td className="py-2 pr-4 text-gray-400">
                    {new Date(job.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {latestJobs.length === 0 && (
                <tr>
                  <td className="py-4 text-center text-gray-500" colSpan={6}>
                    暂无任务
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;

