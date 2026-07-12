import React from 'react';
import { fetchAdminAiJobs } from '../../services/adminClient';
import type { AiJobStatus, AiJobSummary } from '../../services/aiJobsClient';

const PAGE_SIZE = 50;

const STATUS_LABELS: Record<AiJobStatus, string> = {
  created: '已创建',
  queued: '排队中',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
};

const STATUS_TONES: Record<AiJobStatus, string> = {
  created: 'border-gray-600/70 bg-gray-700/20 text-gray-300',
  queued: 'border-blue-500/40 bg-blue-500/10 text-blue-200',
  running: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  succeeded: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  failed: 'border-red-500/40 bg-red-500/10 text-red-200',
  cancelled: 'border-zinc-500/60 bg-zinc-600/20 text-zinc-300',
};

export function aiJobStatusLabel(status: AiJobStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function aiJobStatusTone(status: AiJobStatus): string {
  return STATUS_TONES[status] ?? STATUS_TONES.created;
}

export function aiJobRouteLabel(job: AiJobSummary): string {
  const route = job.route;
  return route?.providerId || route?.adapterId || job.provider || route?.upstreamBackend || '未定';
}

export function aiJobCreditsLabel(job: AiJobSummary): string {
  const gate = job.creditsGate;
  if (!gate) return '未记录';
  const amount = Number.isFinite(gate.estimatedCredits) ? gate.estimatedCredits : null;
  const mode = gate.mode || (gate.enabled ? 'enabled' : 'disabled');
  return amount == null ? mode : `${amount} / ${mode}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function jobModelLabel(job: AiJobSummary): string {
  const parts = [job.capability, job.model].filter(Boolean);
  return parts.length ? parts.join(' · ') : job.modality;
}

function jobTraceLabel(job: AiJobSummary): string {
  return job.proxyJobId || job.correlationId || job.id;
}

const StatusBadge: React.FC<{ status: AiJobStatus }> = ({ status }) => (
  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${aiJobStatusTone(status)}`}>
    {aiJobStatusLabel(status)}
  </span>
);

const AdminAiJobsPanel: React.FC = () => {
  const [jobs, setJobs] = React.useState<AiJobSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAdminAiJobs({ limit: PAGE_SIZE });
      setJobs(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const empty = !loading && jobs.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">AI 任务</h2>
          <p className="mt-1 text-[10px] text-gray-600">最近 {PAGE_SIZE} 条</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void load();
          }}
          className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-200 hover:bg-[#2e2e36]"
        >
          刷新
        </button>
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] overflow-hidden">
        {loading ? (
          <div className="p-6 text-[11px] text-gray-400">加载 AI 任务...</div>
        ) : empty ? (
          <div className="p-6 text-[11px] text-gray-600">暂无 AI 任务</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[980px] text-[11px]">
                <thead className="bg-[#17171a] text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">时间</th>
                    <th className="px-3 py-2 text-left font-medium">状态</th>
                    <th className="px-3 py-2 text-left font-medium">模型 / 能力</th>
                    <th className="px-3 py-2 text-left font-medium">用户</th>
                    <th className="px-3 py-2 text-left font-medium">路由</th>
                    <th className="px-3 py-2 text-left font-medium">Trace / Proxy</th>
                    <th className="px-3 py-2 text-left font-medium">积分</th>
                    <th className="px-3 py-2 text-left font-medium">错误</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-t border-[#252528] hover:bg-[#151518]/60">
                      <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{formatDate(job.createdAt)}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={job.status} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-gray-200">{jobModelLabel(job)}</div>
                        <div className="mt-0.5 text-[10px] text-gray-600">{job.modality}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-400 font-mono text-[10px] break-all">{job.userId || '-'}</td>
                      <td className="px-3 py-2 text-gray-300">{aiJobRouteLabel(job)}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-[10px] break-all">{jobTraceLabel(job)}</td>
                      <td className="px-3 py-2 text-gray-400">{aiJobCreditsLabel(job)}</td>
                      <td className="px-3 py-2 text-red-300/80 max-w-[240px] truncate" title={job.error?.message || ''}>
                        {job.error?.message || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-[#252528]">
              {jobs.map((job) => (
                <article key={job.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] text-gray-200">{jobModelLabel(job)}</p>
                      <p className="mt-1 text-[10px] text-gray-600">{formatDate(job.createdAt)}</p>
                    </div>
                    <StatusBadge status={job.status} />
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-[10px]">
                    <div>
                      <dt className="text-gray-600">用户</dt>
                      <dd className="mt-0.5 text-gray-400 font-mono break-all">{job.userId || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-600">路由</dt>
                      <dd className="mt-0.5 text-gray-300">{aiJobRouteLabel(job)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-600">积分</dt>
                      <dd className="mt-0.5 text-gray-400">{aiJobCreditsLabel(job)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-600">Trace</dt>
                      <dd className="mt-0.5 text-gray-500 font-mono break-all">{jobTraceLabel(job)}</dd>
                    </div>
                  </dl>
                  {job.error?.message ? <p className="text-[10px] text-red-300/80 break-words">{job.error.message}</p> : null}
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdminAiJobsPanel;
