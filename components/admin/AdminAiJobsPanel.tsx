import React from 'react';
import {
  applyAdminAiGatewayOpsAction,
  clearAdminAiGatewayOpsControl,
  fetchAdminAiGatewayOpsControl,
  fetchAdminAiJob,
  fetchAdminAiJobs,
  fetchAdminAiJobsSummary,
  saveAdminAiGatewayOpsControl,
} from '../../services/adminClient';
import type {
  AiGatewayOpsControlConfig,
  AiGatewayOpsGroup,
  AiGatewayOpsPauseRule,
  AiGatewayOpsSummary,
  AiJobDetail,
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
const TTL_OPTIONS = [15, 30, 60, 240];

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

export function formatAiGatewayStorageLabel(storage: string | null | undefined): string {
  const s = String(storage || '').toLowerCase();
  if (s === 'postgres') return 'Postgres';
  return '本地 JSON';
}

export function formatAiGatewayExpiry(value: string | null | undefined, now = Date.now()): string {
  if (!value) return '手动';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '手动';
  const minutes = Math.max(0, Math.round((time - now) / 60_000));
  if (minutes <= 0) return '已过期';
  if (minutes < 60) return `剩余 ${minutes} 分钟`;
  return `剩余 ${Math.round(minutes / 60)} 小时`;
}

export type AiGatewayOpsSuggestion = {
  kind: 'global' | 'provider' | 'model';
  key: string;
  reason: string;
  severity: 'warn' | 'danger';
  actionable: boolean;
};

export type AiGatewayOpsRuleRow = {
  kind: 'provider' | 'model' | 'modelOverride';
  key: string;
  reason: string | null;
  expiresAt: string | null;
  createdByUserId?: string | null;
};

export function buildAiGatewayOpsSuggestions(
  summary: AiGatewayOpsSummary | null,
  config: AiGatewayOpsControlConfig | null
): AiGatewayOpsSuggestion[] {
  if (!summary) return [];
  const disabledProviders = new Set(config?.disabledProviders || []);
  const disabledModels = new Set(config?.disabledModels || []);
  const out: AiGatewayOpsSuggestion[] = [];
  if (summary.totals.rateLimitRate >= 0.5 && summary.totals.errorCounts.rate_limited > 0) {
    out.push({
      kind: 'global',
      key: 'rate-limit',
      reason: `429 占比 ${formatAiGatewayRate(summary.totals.rateLimitRate)}`,
      severity: 'danger',
      actionable: false,
    });
  }
  for (const group of summary.byProvider || []) {
    if (disabledProviders.has(group.key)) continue;
    if (group.errorCounts.rate_limited > 0 || group.failureRate >= 0.3) {
      out.push({
        kind: 'provider',
        key: group.key,
        reason: `失败率 ${formatAiGatewayRate(group.failureRate)} / 429 ${group.errorCounts.rate_limited}`,
        severity: group.errorCounts.rate_limited > 0 ? 'danger' : 'warn',
        actionable: true,
      });
    }
  }
  for (const group of summary.byModel || []) {
    if (disabledModels.has(group.key)) continue;
    if (group.errorCounts.rate_limited > 0 || group.failureRate >= 0.3) {
      out.push({
        kind: 'model',
        key: group.key,
        reason: `失败率 ${formatAiGatewayRate(group.failureRate)} / 429 ${group.errorCounts.rate_limited}`,
        severity: group.errorCounts.rate_limited > 0 ? 'danger' : 'warn',
        actionable: true,
      });
    }
  }
  return out.slice(0, 6);
}

export function buildAiGatewayOpsRuleRows(config: AiGatewayOpsControlConfig | null): AiGatewayOpsRuleRow[] {
  if (!config) return [];
  const providerRows = (config.disabledProviderRules || []).map((rule: AiGatewayOpsPauseRule) => ({
    kind: 'provider' as const,
    key: String(rule.provider || ''),
    reason: rule.reason || null,
    expiresAt: rule.expiresAt || null,
    createdByUserId: rule.createdByUserId || null,
  }));
  const modelRows = (config.disabledModelRules || []).map((rule: AiGatewayOpsPauseRule) => ({
    kind: 'model' as const,
    key: String(rule.model || ''),
    reason: rule.reason || null,
    expiresAt: rule.expiresAt || null,
    createdByUserId: rule.createdByUserId || null,
  }));
  const overrideRows = (config.modelOverrides || [])
    .filter((item) => item.expiresAt)
    .map((item) => ({
      kind: 'modelOverride' as const,
      key: `${item.from} => ${item.to}`,
      reason: item.reason || null,
      expiresAt: item.expiresAt || null,
      createdByUserId: null,
    }));
  return [...providerRows, ...modelRows, ...overrideRows].filter((row) => row.key);
}

const StatusBadge: React.FC<{ status: AiJobStatus }> = ({ status }) => (
  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${aiJobStatusTone(status)}`}>
    {aiJobStatusLabel(status)}
  </span>
);

function compactJson(value: unknown, max = 1200): string {
  if (value == null) return '-';
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > max ? `${text.slice(0, max)}\n...` : text;
  } catch {
    return String(value);
  }
}

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
    <div className="overflow-hidden rounded-2xl border border-[#2e2e32] bg-[#121214]">
      <div className="border-b border-[#252528] px-4 py-3 text-[11px] font-bold text-gray-300">{title}</div>
      <div className="divide-y divide-[#252528]">
        {groups.slice(0, 5).map((group) => (
          <div key={group.key} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2 text-[10px]">
            <div className="min-w-0">
              <div className="truncate text-gray-200" title={group.key}>{group.key}</div>
              <div className="mt-0.5 text-gray-600">活跃 {group.active} / 总数 {group.total}</div>
            </div>
            <div className="text-right text-gray-400">
              <div>{formatAiGatewayRate(group.failureRate)}</div>
              <div className="mt-0.5 text-gray-600">失败</div>
            </div>
            <div className="text-right text-amber-200">
              <div>{group.errorCounts.rate_limited}</div>
              <div className="mt-0.5 text-gray-600">429</div>
            </div>
            <div className="text-right text-gray-400">
              <div>{formatAiGatewayDuration(group.avgDurationMs)}</div>
              <div className="mt-0.5 text-gray-600">平均</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const AdminAiJobsPanel: React.FC = () => {
  const { can, isRolePreview } = useAdminStaff();
  const canReadOps = can(PERMISSIONS.AI_GATEWAY_OPS_READ);
  const canWriteOps = can(PERMISSIONS.AI_GATEWAY_OPS_WRITE);
  const [jobs, setJobs] = React.useState<AiJobSummary[]>([]);
  const [summary, setSummary] = React.useState<AiGatewayOpsSummary | null>(null);
  const [opsControl, setOpsControl] = React.useState<AiGatewayOpsControlConfig | null>(null);
  const [disabledProvidersText, setDisabledProvidersText] = React.useState('');
  const [disabledModelsText, setDisabledModelsText] = React.useState('');
  const [modelOverridesText, setModelOverridesText] = React.useState('');
  const [suggestionTtlMinutes, setSuggestionTtlMinutes] = React.useState(60);
  const [savingOps, setSavingOps] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [selectedDetail, setSelectedDetail] = React.useState<AiJobDetail | null>(null);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const requests: [
        ReturnType<typeof fetchAdminAiJobs>,
        ReturnType<typeof fetchAdminAiJobsSummary>,
        Promise<{ config: AiGatewayOpsControlConfig }> | Promise<null>,
      ] = [
        fetchAdminAiJobs({ limit: PAGE_SIZE }),
        fetchAdminAiJobsSummary({ limit: 100 }),
        canReadOps ? fetchAdminAiGatewayOpsControl() : Promise.resolve(null),
      ];
      const [res, ops, control] = await Promise.all(requests);
      setJobs(res.items);
      setSummary(ops);
      setSelectedDetail((prev) => (prev && !res.items.some((job) => job.id === prev.job.id) ? null : prev));
      if (control) {
        setOpsControl(control.config);
        setDisabledProvidersText(listToText(control.config.disabledProviders));
        setDisabledModelsText(listToText(control.config.disabledModels));
        setModelOverridesText(overridesToText(control.config));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 AI 任务失败');
    } finally {
      setLoading(false);
    }
  }, [canReadOps]);

  const openJobDetail = React.useCallback(async (jobId: string) => {
    setDetailLoading(true);
    setError('');
    try {
      const detail = await fetchAdminAiJob(jobId);
      setSelectedDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 AI 任务详情失败');
    } finally {
      setDetailLoading(false);
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
        disabledProviderRules: opsControl?.disabledProviderRules || [],
        disabledModelRules: opsControl?.disabledModelRules || [],
        modelOverrides: textToOverrides(modelOverridesText),
      });
      setOpsControl(saved.config);
      setMessage('AI Gateway 运营控制已保存');
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存运营控制失败');
    } finally {
      setSavingOps(false);
    }
  }, [disabledModelsText, disabledProvidersText, isRolePreview, load, modelOverridesText, opsControl]);

  const clearOpsControl = React.useCallback(async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    if (!window.confirm('清空 AI Gateway 的供应商/模型暂停规则和模型替换规则？')) return;
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
      setError(err instanceof Error ? err.message : '清空运营控制失败');
    } finally {
      setSavingOps(false);
    }
  }, [isRolePreview, load]);

  const applySuggestion = React.useCallback(async (item: AiGatewayOpsSuggestion) => {
    if (!item.actionable || (item.kind !== 'provider' && item.kind !== 'model')) return;
    if (blockIfRolePreview(isRolePreview)) return;
    setSavingOps(true);
    setError('');
    setMessage('');
    try {
      const saved = await applyAdminAiGatewayOpsAction({
        kind: item.kind,
        key: item.key,
        reason: item.reason,
        ttlMinutes: suggestionTtlMinutes,
      });
      setOpsControl(saved.config);
      setDisabledProvidersText(listToText(saved.config.disabledProviders));
      setDisabledModelsText(listToText(saved.config.disabledModels));
      setModelOverridesText(overridesToText(saved.config));
      setMessage(`${item.kind === 'provider' ? '供应商' : '模型'}已暂停 ${suggestionTtlMinutes} 分钟`);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '应用运营动作失败');
    } finally {
      setSavingOps(false);
    }
  }, [isRolePreview, load, suggestionTtlMinutes]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const empty = !loading && jobs.length === 0;
  const opsSuggestions = React.useMemo(
    () => buildAiGatewayOpsSuggestions(summary, opsControl),
    [opsControl, summary]
  );
  const opsRuleRows = React.useMemo(() => buildAiGatewayOpsRuleRows(opsControl), [opsControl]);

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
          className="rounded-xl border border-[#2e2e32] bg-[#1c1c22] px-3 py-2 text-[10px] text-gray-200 hover:bg-[#2e2e36]"
        >
          刷新
        </button>
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {message ? <p className="text-[11px] text-emerald-300">{message}</p> : null}

      {selectedDetail ? (
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[11px] font-bold text-gray-100">任务详情</h3>
                <StatusBadge status={selectedDetail.job.status} />
              </div>
              <p className="mt-1 break-all font-mono text-[10px] text-gray-600">{selectedDetail.job.id}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedDetail(null)}
              className="rounded-xl border border-[#2e2e32] bg-[#1c1c22] px-3 py-2 text-[10px] text-gray-300 hover:bg-[#2e2e36]"
            >
              关闭
            </button>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <div className="rounded-xl border border-[#252528] bg-[#0d0d10] p-3">
              <div className="text-[10px] text-gray-600">路由</div>
              <div className="mt-1 text-[11px] text-gray-200">{aiJobRouteLabel(selectedDetail.job)}</div>
              <div className="mt-2 break-all font-mono text-[10px] text-gray-500">{aiJobTraceLabel(selectedDetail.job)}</div>
            </div>
            <div className="rounded-xl border border-[#252528] bg-[#0d0d10] p-3">
              <div className="text-[10px] text-gray-600">能力</div>
              <div className="mt-1 text-[11px] text-gray-200">{selectedDetail.job.capability}</div>
              <div className="mt-2 text-[10px] text-gray-500">{aiJobCreditsLabel(selectedDetail.job)}</div>
            </div>
            <div className="rounded-xl border border-[#252528] bg-[#0d0d10] p-3">
              <div className="text-[10px] text-gray-600">时间</div>
              <div className="mt-1 text-[11px] text-gray-300">创建 {formatDate(selectedDetail.job.createdAt)}</div>
              <div className="mt-1 text-[10px] text-gray-500">更新 {formatDate(selectedDetail.job.updatedAt)}</div>
            </div>
          </div>
          {selectedDetail.job.error?.message ? (
            <p className="mt-3 break-words rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] text-red-200">
              {selectedDetail.job.error.message}
            </p>
          ) : null}
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <div className="rounded-xl border border-[#252528] bg-[#0d0d10] p-3">
              <div className="text-[10px] text-gray-600">适配器请求</div>
              <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-gray-400">
                {compactJson(selectedDetail.adapterRequest)}
              </pre>
            </div>
            <div className="rounded-xl border border-[#252528] bg-[#0d0d10] p-3">
              <div className="text-[10px] text-gray-600">产物</div>
              <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-gray-400">
                {compactJson(selectedDetail.job.artifacts)}
              </pre>
            </div>
            <div className="rounded-xl border border-[#252528] bg-[#0d0d10] p-3">
              <div className="text-[10px] text-gray-600">输出预览</div>
              <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-gray-400">
                {compactJson(selectedDetail.job.output)}
              </pre>
            </div>
          </div>
        </div>
      ) : detailLoading ? (
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 text-[11px] text-gray-400">
          正在加载任务详情...
        </div>
      ) : null}

      {summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryCard label="样本数" value={summary.sampleSize} hint={`上限 ${summary.limit}`} />
            <SummaryCard label="活跃任务" value={summary.totals.active} hint="创建 / 排队 / 运行中" />
            <SummaryCard
              label="失败率"
              value={formatAiGatewayRate(summary.totals.failureRate)}
              hint={`${summary.totals.statusCounts.failed} 个失败`}
              danger={summary.totals.failureRate >= 0.2}
            />
            <SummaryCard
              label="429 占比"
              value={formatAiGatewayRate(summary.totals.rateLimitRate)}
              hint={`${summary.totals.errorCounts.rate_limited} 次限流`}
              danger={summary.totals.errorCounts.rate_limited > 0}
            />
            <SummaryCard label="成功" value={summary.totals.statusCounts.succeeded} hint="最终成功" />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <OpsGroupTable title="供应商健康度" groups={summary.byProvider} />
            <OpsGroupTable title="模型健康度" groups={summary.byModel} />
          </div>
        </>
      ) : null}

      {canReadOps && opsSuggestions.length ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] font-bold text-amber-100">运营建议</div>
            <div className="flex flex-wrap gap-1">
              {TTL_OPTIONS.map((minutes) => (
                <button
                  type="button"
                  key={minutes}
                  onClick={() => setSuggestionTtlMinutes(minutes)}
                  className={`rounded-lg border px-2 py-1 text-[10px] ${
                    suggestionTtlMinutes === minutes
                      ? 'border-amber-300/50 bg-amber-300/15 text-amber-100'
                      : 'border-white/[0.08] bg-black/10 text-gray-400'
                  }`}
                >
                  {minutes}m
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            {opsSuggestions.map((item) => (
              <div key={`${item.kind}:${item.key}`} className="rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2">
                <div className={item.severity === 'danger' ? 'text-[11px] text-red-100' : 'text-[11px] text-amber-100'}>
                  {item.kind} / {item.key}
                </div>
                <div className="mt-1 text-[10px] text-gray-500">{item.reason}</div>
                {item.actionable ? (
                  <button
                    type="button"
                    disabled={!canWriteOps || savingOps}
                    onClick={() => {
                      void applySuggestion(item);
                    }}
                    className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100 disabled:opacity-40"
                  >
                  暂停 {suggestionTtlMinutes} 分钟
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {canReadOps && opsControl ? (
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[11px] font-bold text-gray-200">Gateway 运营控制</h3>
              <p className="mt-1 text-[10px] text-gray-600">
                {formatAiGatewayStorageLabel(opsControl.storage)}
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
                保存
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

          {opsRuleRows.length ? (
            <div className="mt-4 rounded-xl border border-[#252528] bg-[#0d0d10]">
              <div className="border-b border-[#252528] px-3 py-2 text-[10px] font-bold text-gray-400">生效规则</div>
              <div className="divide-y divide-[#252528]">
                {opsRuleRows.map((row) => (
                  <div key={`${row.kind}:${row.key}`} className="grid gap-2 px-3 py-2 text-[10px] sm:grid-cols-[120px_1fr_120px]">
                    <div className="text-gray-500">{row.kind}</div>
                    <div className="min-w-0">
                      <div className="truncate text-gray-200" title={row.key}>{row.key}</div>
                      {row.reason ? <div className="mt-0.5 text-gray-600">{row.reason}</div> : null}
                    </div>
                    <div className="text-right text-amber-100">{formatAiGatewayExpiry(row.expiresAt)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <label className="block">
              <span className="text-[10px] text-gray-500">暂停供应商</span>
              <textarea
                value={disabledProvidersText}
                onChange={(ev) => setDisabledProvidersText(ev.target.value)}
                disabled={!canWriteOps || savingOps}
                className="mt-1 h-24 w-full resize-none rounded-xl border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 font-mono text-[11px] text-gray-100 outline-none disabled:opacity-40"
                placeholder="vertex-gemini"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500">暂停模型</span>
              <textarea
                value={disabledModelsText}
                onChange={(ev) => setDisabledModelsText(ev.target.value)}
                disabled={!canWriteOps || savingOps}
                className="mt-1 h-24 w-full resize-none rounded-xl border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 font-mono text-[11px] text-gray-100 outline-none disabled:opacity-40"
                placeholder="gemini-3-pro-image"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500">模型替换</span>
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

      <div className="overflow-hidden rounded-2xl border border-[#2e2e32] bg-[#121214]">
        {loading ? (
          <div className="p-6 text-[11px] text-gray-400">正在加载 AI 任务...</div>
        ) : empty ? (
          <div className="p-6 text-[11px] text-gray-600">暂无 AI 任务</div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[980px] text-[11px]">
                <thead className="bg-[#17171a] text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">时间</th>
                    <th className="px-3 py-2 text-left font-medium">状态</th>
                    <th className="px-3 py-2 text-left font-medium">模型 / 能力</th>
                    <th className="px-3 py-2 text-left font-medium">用户</th>
                    <th className="px-3 py-2 text-left font-medium">路由</th>
                    <th className="px-3 py-2 text-left font-medium">Trace / 代理</th>
                    <th className="px-3 py-2 text-left font-medium">积分</th>
                    <th className="px-3 py-2 text-left font-medium">错误</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      onClick={() => {
                        void openJobDetail(job.id);
                      }}
                      className={`cursor-pointer border-t border-[#252528] hover:bg-[#151518]/60 ${
                        selectedDetail?.job.id === job.id ? 'bg-[#151518]' : ''
                      }`}
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-gray-400">{formatDate(job.createdAt)}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={job.status} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-gray-200">{aiJobModelLabel(job)}</div>
                        <div className="mt-0.5 text-[10px] text-gray-600">{job.modality}</div>
                      </td>
                      <td className="break-all px-3 py-2 font-mono text-[10px] text-gray-400">{job.userId || '-'}</td>
                      <td className="px-3 py-2 text-gray-300">{aiJobRouteLabel(job)}</td>
                      <td className="break-all px-3 py-2 font-mono text-[10px] text-gray-500">{aiJobTraceLabel(job)}</td>
                      <td className="px-3 py-2 text-gray-400">{aiJobCreditsLabel(job)}</td>
                      <td className="max-w-[240px] truncate px-3 py-2 text-red-300/80" title={job.error?.message || ''}>
                        {job.error?.message || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-[#252528] md:hidden">
              {jobs.map((job) => (
                <article
                  key={job.id}
                  onClick={() => {
                    void openJobDetail(job.id);
                  }}
                  className={`space-y-3 p-4 ${selectedDetail?.job.id === job.id ? 'bg-[#151518]' : ''}`}
                >
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
                      <dd className="mt-0.5 break-all font-mono text-gray-400">{job.userId || '-'}</dd>
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
                      <dd className="mt-0.5 break-all font-mono text-gray-500">{aiJobTraceLabel(job)}</dd>
                    </div>
                  </dl>
                  {job.error?.message ? <p className="break-words text-[10px] text-red-300/80">{job.error.message}</p> : null}
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
