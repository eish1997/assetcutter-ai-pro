import React from 'react';
import {
  clearAdminAiGatewayOpsControl,
  fetchAdminAiGatewayOpsControl,
  fetchAdminAiJobs,
  fetchAdminAiJobsSummary,
  saveAdminAiGatewayOpsControl,
} from '../../services/adminClient';
import type {
  AiGatewayOpsControlConfig,
  AiGatewayOpsGroup,
  AiGatewayOpsSummary,
  AiJobStatus,
  AiJobSummary,
} from '../../services/aiJobsClient';
import { PERMISSIONS } from '../../services/adminPermissions';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { useAdminStaff } from './AdminStaffContext';
import {
  aiJobCreditsLabel,
  aiJobModelLabel,
  aiJobRouteLabel,
  aiJobStatusLabel,
  aiJobStatusTone,
  aiJobTraceLabel,
} from '../../services/aiJobDisplay';
export {
  aiJobCreditsLabel,
  aiJobRouteLabel,
  aiJobStatusLabel,
  aiJobStatusTone,
} from '../../services/aiJobDisplay';

const PAGE_SIZE = 50;

export function listToText(values: string[] | null | undefined): string {
  return Array.isArray(values) ? values.join('\n') : '';
}

export function textToList(value: string): string[] {
  return Array.from(
    new Set(
      String(value || '')
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function overridesToText(config: AiGatewayOpsControlConfig | null): string {
  return (config?.modelOverrides || [])
    .filter((item) => item?.from && item?.to)
    .map((item) => `${item.from} => ${item.to}${item.reason ? ` # ${item.reason}` : ''}`)
    .join('\n');
}

export function textToOverrides(value: string): AiGatewayOpsControlConfig['modelOverrides'] {
  return String(value || '')
    .split(/\n/)
    .map((line) => {
      const [pair, reasonRaw] = line.split('#');
      const [from, to] = String(pair || '').split('=>').map((part) => part.trim());
      if (!from || !to) return null;
      return { from, to, enabled: true, reason: reasonRaw?.trim() || null };
    })
    .filter(Boolean) as AiGatewayOpsControlConfig['modelOverrides'];
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

export function formatAiGatewayRate(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0%';
  return `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`;
}

export function formatAiGatewayDuration(ms: number | null | undefined): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '-';
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60_000) return `${Math.round(n / 1000)}s`;
  return `${Math.round(n / 60_000)}m`;
}

const StatusBadge: React.FC<{ status: AiJobStatus }> = ({ status }) => (
  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${aiJobStatusTone(status)}`}>
    {aiJobStatusLabel(status)}
  </span>
);

const SummaryCard: React.FC<{ label: string; value: string | number; hint?: string; danger?: boolean }> = ({
  label,
  value,
  hint,
  danger,
}) => (
  <div className="rounded-xl border border-[#2e2e32] bg-[#121214] px-4 py-3">
    <div className="text-[10px] text-gray-500">{label}</div>
    <div className={`mt-1 text-[18px] font-black ${danger ? 'text-red-200' : 'text-gray-100'}`}>{value}</div>
    {hint ? <div className="mt-1 text-[10px] text-gray-600">{hint}</div> : null}
  </div>
);

const OpsGroupTable: React.FC<{ title: string; groups: AiGatewayOpsGroup[] }> = ({ title, groups }) => {
  if (!groups.length) return null;
  return (
    <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] overflow-hidden">
      <div className="border-b border-[#252528] px-4 py-3 text-[11px] font-bold text-gray-300">{title}</div>
      <div className="divide-y divide-[#252528]">
        {groups.slice(0, 5).map((group) => (
          <div key={group.key} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2 text-[10px]">
            <div className="min-w-0">
              <div className="truncate text-gray-200" title={group.key}>{group.key}</div>
              <div className="mt-0.5 text-gray-600">active {group.active} / total {group.total}</div>
            </div>
            <div className="text-right text-gray-400">
              <div>{formatAiGatewayRate(group.failureRate)}</div>
              <div className="mt-0.5 text-gray-600">fail</div>
            </div>
            <div className="text-right text-amber-200">
              <div>{group.errorCounts.rate_limited}</div>
              <div className="mt-0.5 text-gray-600">429</div>
            </div>
            <div className="text-right text-gray-400">
              <div>{formatAiGatewayDuration(group.avgDurationMs)}</div>
              <div className="mt-0.5 text-gray-600">avg</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const AdminAiJobsPanel: React.FC = () => {
  const { can, isRolePreview } = useAdminStaff();
  const canWriteOps = can(PERMISSIONS.GEMINI_FAIRNESS_WRITE);
  const [jobs, setJobs] = React.useState<AiJobSummary[]>([]);
  const [summary, setSummary] = React.useState<AiGatewayOpsSummary | null>(null);
  const [opsControl, setOpsControl] = React.useState<AiGatewayOpsControlConfig | null>(null);
  const [disabledProvidersText, setDisabledProvidersText] = React.useState('');
  const [disabledModelsText, setDisabledModelsText] = React.useState('');
  const [modelOverridesText, setModelOverridesText] = React.useState('');
  const [savingOps, setSavingOps] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [res, ops, control] = await Promise.all([
        fetchAdminAiJobs({ limit: PAGE_SIZE }),
        fetchAdminAiJobsSummary({ limit: 100 }),
        fetchAdminAiGatewayOpsControl(),
      ]);
      setJobs(res.items);
      setSummary(ops);
      setOpsControl(control.config);
      setDisabledProvidersText(listToText(control.config.disabledProviders));
      setDisabledModelsText(listToText(control.config.disabledModels));
      setModelOverridesText(overridesToText(control.config));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const saveOpsControl = React.useCallback(async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    setSavingOps(true);
    setError('');
    setMessage('');
    try {
      const saved = await saveAdminAiGatewayOpsControl({
        disabledProviders: textToList(disabledProvidersText),
        disabledModels: textToList(disabledModelsText),
        modelOverrides: textToOverrides(modelOverridesText),
      });
      setOpsControl(saved.config);
      setMessage('AI Gateway 运营控制已保存');
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingOps(false);
    }
  }, [disabledModelsText, disabledProvidersText, isRolePreview, load, modelOverridesText]);

  const clearOpsControl = React.useCallback(async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    if (!window.confirm('清空 AI Gateway provider/model 暂停和模型替换规则？')) return;
    setSavingOps(true);
    setError('');
    setMessage('');
    try {
      const cleared = await clearAdminAiGatewayOpsControl();
      setOpsControl(cleared.config);
      setDisabledProvidersText('');
      setDisabledModelsText('');
      setModelOverridesText('');
      setMessage('AI Gateway 运营控制已清空');
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '清空失败');
    } finally {
      setSavingOps(false);
    }
  }, [isRolePreview, load]);

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
      {message ? <p className="text-[11px] text-emerald-300">{message}</p> : null}

      {summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryCard label="Recent sample" value={summary.sampleSize} hint={`limit ${summary.limit}`} />
            <SummaryCard label="Active" value={summary.totals.active} hint="created / queued / running" />
            <SummaryCard
              label="Failure rate"
              value={formatAiGatewayRate(summary.totals.failureRate)}
              hint={`${summary.totals.statusCounts.failed} failed`}
              danger={summary.totals.failureRate >= 0.2}
            />
            <SummaryCard
              label="429 share"
              value={formatAiGatewayRate(summary.totals.rateLimitRate)}
              hint={`${summary.totals.errorCounts.rate_limited} rate limited`}
              danger={summary.totals.errorCounts.rate_limited > 0}
            />
            <SummaryCard label="Succeeded" value={summary.totals.statusCounts.succeeded} hint="terminal success" />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <OpsGroupTable title="Provider health" groups={summary.byProvider} />
            <OpsGroupTable title="Model health" groups={summary.byModel} />
          </div>
        </>
      ) : null}

      {opsControl ? (
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[11px] font-bold text-gray-200">Gateway ops control</h3>
              <p className="mt-1 text-[10px] text-gray-600">
                {opsControl.storage || 'disk'}
                {opsControl.updatedAt ? ` / ${new Date(opsControl.updatedAt).toLocaleString()}` : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!canWriteOps || savingOps}
                onClick={() => {
                  void saveOpsControl();
                }}
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] text-emerald-100 disabled:opacity-40"
              >
                保存控制
              </button>
              <button
                type="button"
                disabled={!canWriteOps || savingOps}
                onClick={() => {
                  void clearOpsControl();
                }}
                className="rounded-xl border border-[#2e2e32] bg-[#1c1c22] px-3 py-2 text-[10px] text-gray-300 disabled:opacity-40"
              >
                清空
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <label className="block">
              <span className="text-[10px] text-gray-500">Paused providers</span>
              <textarea
                value={disabledProvidersText}
                onChange={(ev) => setDisabledProvidersText(ev.target.value)}
                disabled={!canWriteOps || savingOps}
                className="mt-1 h-24 w-full resize-none rounded-xl border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 font-mono text-[11px] text-gray-100 outline-none disabled:opacity-40"
                placeholder="vertex-gemini"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500">Paused models</span>
              <textarea
                value={disabledModelsText}
                onChange={(ev) => setDisabledModelsText(ev.target.value)}
                disabled={!canWriteOps || savingOps}
                className="mt-1 h-24 w-full resize-none rounded-xl border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 font-mono text-[11px] text-gray-100 outline-none disabled:opacity-40"
                placeholder="gemini-3-pro-image"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500">Model overrides</span>
              <textarea
                value={modelOverridesText}
                onChange={(ev) => setModelOverridesText(ev.target.value)}
                disabled={!canWriteOps || savingOps}
                className="mt-1 h-24 w-full resize-none rounded-xl border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 font-mono text-[11px] text-gray-100 outline-none disabled:opacity-40"
                placeholder="gemini-3-pro-image => gemini-3-flash-image # fallback"
              />
            </label>
          </div>
        </div>
      ) : null}

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
                        <div className="text-gray-200">{aiJobModelLabel(job)}</div>
                        <div className="mt-0.5 text-[10px] text-gray-600">{job.modality}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-400 font-mono text-[10px] break-all">{job.userId || '-'}</td>
                      <td className="px-3 py-2 text-gray-300">{aiJobRouteLabel(job)}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-[10px] break-all">{aiJobTraceLabel(job)}</td>
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
                      <p className="text-[11px] text-gray-200">{aiJobModelLabel(job)}</p>
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
                      <dd className="mt-0.5 text-gray-500 font-mono break-all">{aiJobTraceLabel(job)}</dd>
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
