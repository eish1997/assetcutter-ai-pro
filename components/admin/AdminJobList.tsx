import React, { useEffect, useMemo, useState } from 'react';
import type { BulkImageJob, BulkImageJobStatus } from '../../types-admin';
import { fetchJobs } from '../../services/adminBulkImageApi';

type AdminJobListProps = {
  onOpenJob: (id: string) => void;
};

const STATUS_LABELS: Record<BulkImageJobStatus, string> = {
  pending: '排队中',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  partial: '部分完成',
  cancelled: '已取消',
};

const AdminJobList: React.FC<AdminJobListProps> = ({ onOpenJob }) => {
  const [jobs, setJobs] = useState<BulkImageJob[]>([]);
  const [statusFilter, setStatusFilter] = useState<BulkImageJobStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const js = await fetchJobs();
        if (cancelled) return;
        setJobs(js);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || '加载任务失败');
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

  const filtered = useMemo(
    () =>
      jobs.filter((job) => {
        if (statusFilter !== 'all' && job.status !== statusFilter) return false;
        if (search) {
          const kw = search.toLowerCase();
          if (!job.id.toLowerCase().includes(kw) && !job.instruction.toLowerCase().includes(kw)) {
            return false;
          }
        }
        return true;
      }),
    [jobs, statusFilter, search]
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-[11px] text-red-200">
          {error}
        </div>
      )}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-gray-400">状态：</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as BulkImageJobStatus | 'all')}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-1 text-[11px] outline-none focus:border-blue-500"
          >
            <option value="all">全部</option>
            <option value="pending">排队中</option>
            <option value="running">进行中</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
            <option value="partial">部分完成</option>
            <option value="cancelled">已取消</option>
          </select>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-gray-400">搜索：</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="按任务 ID 或指令关键字"
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-1 text-[11px] outline-none focus:border-blue-500 min-w-[220px]"
          />
        </div>
        {loading && <span className="text-[10px] text-gray-500">刷新中…</span>}
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
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
                <th className="py-2 pr-4 font-normal">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((job) => (
                <tr
                  key={job.id}
                  className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                  onClick={() => onOpenJob(job.id)}
                >
                  <td className="py-2 pr-4 font-mono text-[10px] text-blue-200">{job.id}</td>
                  <td className="py-2 pr-4">
                    <span className="px-2 py-0.5 rounded-full text-[10px] border border-white/10 bg-white/5">
                      {STATUS_LABELS[job.status]}
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
                  <td className="py-2 pr-4 text-gray-400">
                    {new Date(job.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td className="py-4 text-center text-gray-500" colSpan={7}>
                    暂无符合条件的任务
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

export default AdminJobList;

