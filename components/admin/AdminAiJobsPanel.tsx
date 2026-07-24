import React from 'react';
import {
  applyAdminAiGatewayOpsAction,
  clearAdminAiGatewayOpsControl,
  fetchAiGatewayTrends,
  fetchAdminAiGatewayOpsControl,
  fetchAdminAiJob,
  fetchAdminAiJobs,
  fetchAdminAiJobsSummary,
  saveAdminAiGatewayOpsControl,
  type AiGatewayTrendReport,
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
import CustomDropdown from '../ui/CustomDropdown';
export {
  aiJobCreditsLabel,
  aiJobRouteLabel,
  aiJobStatusLabel,
  aiJobStatusTone,
} from '../../services/aiJobDisplay';

const TIMEOUT_FALLBACK_OPTIONS = [
  { value: 'switch_provider', label: '超时切下一候选' },
  { value: 'same_route_retry', label: '超时先同路重试' },
  { value: 'fail', label: '超时直接失败' },
] as const;

export function runtimeFallbackFromOpsControl(config: AiGatewayOpsControlConfig | null) {
  const runtime = config?.dispatchPolicy?.runtimeFallback || {};
  return {
    respectProviderPin: runtime.respectProviderPin !== false,
    allowCrossProvider: runtime.allowCrossProvider !== false,
    onTimeout:
      runtime.onTimeout === 'same_route_retry' || runtime.onTimeout === 'fail'
        ? runtime.onTimeout
        : ('switch_provider' as const),
    sameRouteRetryMax: Math.max(0, Math.min(3, Number(runtime.sameRouteRetryMax ?? 1) || 0)),
  };
}

const PAGE_SIZE = 50;
const TTL_OPTIONS = [15, 30, 60, 240];
const STATUS_FILTERS: Array<{ value: '' | AiJobStatus; label: string }> = [
  { value: '', label: '全部' },
  { value: 'queued', label: '排队' },
  { value: 'running', label: '运行' },
  { value: 'succeeded', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '取消' },
];
const MODALITY_FILTERS = [
  { value: '', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'model3d', label: '3D' },
  { value: 'text', label: '文本' },
];

type AdminAiJobFilters = {
  status: '' | AiJobStatus;
  modality: string;
  userId: string;
  provider: string;
  model: string;
  capability: string;
  q: string;
  failureStage: string;
  failureOwner: string;
};

const EMPTY_FILTERS: AdminAiJobFilters = {
  status: '',
  modality: '',
  userId: '',
  provider: '',
  model: '',
  capability: '',
  q: '',
  failureStage: '',
  failureOwner: '',
};

const FAILURE_STAGE_FILTERS = [
  { value: '', label: '失败阶段·全部' },
  { value: 'admission', label: '准入' },
  { value: 'billing', label: '计费' },
  { value: 'publication', label: '发布' },
  { value: 'routing', label: '路由' },
  { value: 'provider_key', label: '密钥' },
  { value: 'worker', label: 'Worker' },
  { value: 'adapter', label: 'Adapter' },
  { value: 'upstream', label: '上游' },
  { value: 'artifact', label: '产物' },
  { value: 'writeback', label: '回写' },
  { value: '__missing__', label: '缺failureReason' },
];

const FAILURE_OWNER_FILTERS = [
  { value: '', label: '责任方·全部' },
  { value: 'user', label: '用户' },
  { value: 'admin', label: '运营' },
  { value: 'developer', label: '研发' },
  { value: 'upstream', label: '上游' },
  { value: 'system', label: '系统' },
  { value: '__missing__', label: '缺owner' },
];

/** Server query params only (failure stage/owner are client-side). */
export function cleanAdminAiJobFilters(filters: AdminAiJobFilters) {
  return {
    status: filters.status || '',
    modality: String(filters.modality || '').trim(),
    userId: String(filters.userId || '').trim(),
    provider: String(filters.provider || '').trim(),
    model: String(filters.model || '').trim(),
    capability: String(filters.capability || '').trim(),
    q: String(filters.q || '').trim(),
  };
}

/** Filter failed jobs by gatewayFailure.stage / owner (slice 2). */
export function filterAdminAiJobsByFailureReason(
  jobs: AiJobSummary[],
  filters: Pick<AdminAiJobFilters, 'failureStage' | 'failureOwner'>
): AiJobSummary[] {
  const stage = String(filters.failureStage || '').trim();
  const owner = String(filters.failureOwner || '').trim();
  if (!stage && !owner) return jobs;
  return jobs.filter((job) => {
    const failure = job.gatewayFailure;
    if (stage === '__missing__') {
      if (!(job.status === 'failed' && !failure?.stage)) return false;
    } else if (stage && failure?.stage !== stage) {
      return false;
    }
    if (owner === '__missing__') {
      if (!(job.status === 'failed' && !failure?.owner)) return false;
    } else if (owner && failure?.owner !== owner) {
      return false;
    }
    return true;
  });
}

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

function fallbackPolicyLabel(value: string | null | undefined): string {
  if (value === 'none') return '不切换';
  if (value === 'on_error') return '错误切换';
  if (value === 'on_rate_limit') return '限流切换';
  if (value === 'on_timeout') return '超时切换';
  if (value === 'on_provider_degraded') return '降级切换';
  if (value === 'cost_optimized') return '成本优先';
  if (value === 'quality_first') return '质量优先';
  return value || '未配置';
}

function fallbackReasonLabel(value: string | null | undefined): string {
  if (value === 'rate_limit') return '限流';
  if (value === 'timeout') return '超时';
  if (value === 'upstream_5xx') return '供应商异常';
  if (value === 'network_error') return '网络错误';
  if (value === 'provider_key_missing') return '缺密钥';
  return value || '暂无';
}

export function aiJobFallbackHint(job: AiJobSummary): string {
  const fallback = job.fallback;
  if (!fallback) return '无 fallback';
  const max = fallback.maxAttempts ? `/${fallback.maxAttempts}` : '';
  const parts = [
    `策略 ${fallbackPolicyLabel(fallback.policy)}`,
    `尝试 ${fallback.attemptCount}${max}`,
    fallback.nextProviderId ? `下一家 ${fallback.nextProviderId}` : '',
    fallback.lastReason ? `原因 ${fallbackReasonLabel(fallback.lastReason)}` : '',
    fallback.exhausted ? '已耗尽' : '',
  ].filter(Boolean);
  return parts.join(' / ');
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

export function formatAiGatewayCostUsd(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

type AiGatewayProviderPerformanceRow = NonNullable<AiGatewayTrendReport['providerPerformance']>[number];

export function buildAiGatewayProviderPerformanceRows(
  report: AiGatewayTrendReport | null | undefined
): AiGatewayProviderPerformanceRow[] {
  return [...(report?.providerPerformance || [])]
    .filter((row) => row.providerId && (row.totalJobs > 0 || row.usageEvents > 0))
    .sort((a, b) => {
      const riskA = a.failedJobs + a.rateLimitedJobs + a.fallbackAttempts;
      const riskB = b.failedJobs + b.rateLimitedJobs + b.fallbackAttempts;
      return (
        b.failureRate - a.failureRate ||
        riskB - riskA ||
        b.totalJobs - a.totalJobs ||
        a.providerId.localeCompare(b.providerId)
      );
    });
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

const ProviderPerformanceTable: React.FC<{ rows: AiGatewayProviderPerformanceRow[]; days: number }> = ({ rows, days }) => {
  if (!rows.length) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-[#2e2e32] bg-[#121214]">
      <div className="flex items-center justify-between gap-3 border-b border-[#252528] px-4 py-3">
        <div>
          <div className="text-[11px] font-bold text-gray-300">供应商表现</div>
          <div className="mt-0.5 text-[10px] text-gray-600">最近 {days} 天</div>
        </div>
        <div className="text-[10px] text-gray-600">失败 / 429 / fallback / 耗时 / 成本</div>
      </div>
      <div className="divide-y divide-[#252528]">
        {rows.slice(0, 8).map((row) => (
          <div key={row.providerId} className="grid grid-cols-[1.2fr_repeat(5,auto)] items-center gap-3 px-4 py-2 text-[10px]">
            <div className="min-w-0">
              <div className="truncate text-gray-200" title={row.providerId}>{row.providerId}</div>
              <div className="mt-0.5 text-gray-600">
                任务 {row.totalJobs} / 成功 {row.succeededJobs} / 用量 {row.usageEvents}
              </div>
            </div>
            <div className={row.failureRate >= 0.3 ? 'text-right text-red-200' : 'text-right text-gray-400'}>
              <div>{formatAiGatewayRate(row.failureRate)}</div>
              <div className="mt-0.5 text-gray-600">失败</div>
            </div>
            <div className={row.rateLimitedJobs > 0 ? 'text-right text-amber-200' : 'text-right text-gray-400'}>
              <div>{row.rateLimitedJobs}</div>
              <div className="mt-0.5 text-gray-600">429</div>
            </div>
            <div className={row.fallbackAttempts > 0 ? 'text-right text-blue-200' : 'text-right text-gray-400'}>
              <div>{row.fallbackAttempts}</div>
              <div className="mt-0.5 text-gray-600">fallback</div>
            </div>
            <div className="text-right text-gray-400">
              <div>{formatAiGatewayDuration(row.avgDurationMs)}</div>
              <div className="mt-0.5 text-gray-600">平均</div>
            </div>
            <div className="text-right text-gray-400">
              <div>{formatAiGatewayCostUsd(row.totalCostUsdEst)}</div>
              <div className="mt-0.5 text-gray-600">{row.totalCreditsCharged || 0} 分</div>
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
  const [trendReport, setTrendReport] = React.useState<AiGatewayTrendReport | null>(null);
  const [opsControl, setOpsControl] = React.useState<AiGatewayOpsControlConfig | null>(null);
  const [disabledProvidersText, setDisabledProvidersText] = React.useState('');
  const [disabledModelsText, setDisabledModelsText] = React.useState('');
  const [modelOverridesText, setModelOverridesText] = React.useState('');
  const [runtimeFallbackDraft, setRuntimeFallbackDraft] = React.useState(() => runtimeFallbackFromOpsControl(null));
  const [canaryDraft, setCanaryDraft] = React.useState({
    canonicalModelId: '',
    providerId: '',
    percent: 10,
    enabled: true,
  });
  const [suggestionTtlMinutes, setSuggestionTtlMinutes] = React.useState(60);
  const [filters, setFilters] = React.useState<AdminAiJobFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = React.useState<AdminAiJobFilters>(EMPTY_FILTERS);
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
        ReturnType<typeof fetchAiGatewayTrends> | Promise<null>,
      ] = [
        fetchAdminAiJobs({ limit: PAGE_SIZE, ...cleanAdminAiJobFilters(appliedFilters) }),
        fetchAdminAiJobsSummary({ limit: 100, ...cleanAdminAiJobFilters(appliedFilters) }),
        canReadOps ? fetchAdminAiGatewayOpsControl() : Promise.resolve(null),
        canReadOps ? fetchAiGatewayTrends({ days: 7 }).catch(() => null) : Promise.resolve(null),
      ];
      const [res, ops, control, trends] = await Promise.all(requests);
      setJobs(res.items);
      setSummary(ops);
      setTrendReport(trends);
      setSelectedDetail((prev) => (prev && !res.items.some((job) => job.id === prev.job.id) ? null : prev));
      if (control) {
        setOpsControl(control.config);
        setDisabledProvidersText(listToText(control.config.disabledProviders));
        setDisabledModelsText(listToText(control.config.disabledModels));
        setModelOverridesText(overridesToText(control.config));
        setRuntimeFallbackDraft(runtimeFallbackFromOpsControl(control.config));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 AI 任务失败');
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, canReadOps]);

  const displayedJobs = React.useMemo(
    () => filterAdminAiJobsByFailureReason(jobs, appliedFilters),
    [jobs, appliedFilters]
  );

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
      const nextDispatchPolicy = {
        ...(opsControl?.dispatchPolicy || {}),
        runtimeFallback: {
          ...(opsControl?.dispatchPolicy?.runtimeFallback || {}),
          ...runtimeFallbackDraft,
        },
        canary: Array.isArray(opsControl?.dispatchPolicy?.canary)
          ? opsControl?.dispatchPolicy?.canary
          : [],
      };
      const saved = await saveAdminAiGatewayOpsControl({
        disabledProviders: textToList(disabledProvidersText),
        disabledModels: textToList(disabledModelsText),
        disabledProviderRules: opsControl?.disabledProviderRules || [],
        disabledModelRules: opsControl?.disabledModelRules || [],
        modelOverrides: textToOverrides(modelOverridesText),
        dispatchPolicy: nextDispatchPolicy,
        rollout: {
          ...(opsControl?.rollout || {}),
          previousDispatchPolicy: opsControl?.dispatchPolicy || null,
        },
      });
      setOpsControl(saved.config);
      setRuntimeFallbackDraft(runtimeFallbackFromOpsControl(saved.config));
      setMessage('AI Gateway 运营控制已保存');
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存运营控制失败');
    } finally {
      setSavingOps(false);
    }
  }, [
    disabledModelsText,
    disabledProvidersText,
    isRolePreview,
    load,
    modelOverridesText,
    opsControl,
    runtimeFallbackDraft,
  ]);

  const saveCanaryRule = React.useCallback(async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    const canonicalModelId = canaryDraft.canonicalModelId.trim();
    const providerId = canaryDraft.providerId.trim();
    const percent = Math.max(0, Math.min(100, Number(canaryDraft.percent) || 0));
    if (!canonicalModelId || !providerId) {
      setError('灰度需要填写模型 ID 与供应商 ID');
      return;
    }
    setSavingOps(true);
    setError('');
    setMessage('');
    try {
      const existingCanary = Array.isArray(opsControl?.dispatchPolicy?.canary)
        ? [...opsControl.dispatchPolicy.canary]
        : [];
      const nextRow = {
        canonicalModelId,
        providerId,
        percent,
        enabled: canaryDraft.enabled !== false,
      };
      const idx = existingCanary.findIndex(
        (row) =>
          String((row as { canonicalModelId?: string })?.canonicalModelId || '') === canonicalModelId &&
          String((row as { providerId?: string })?.providerId || '') === providerId
      );
      if (idx >= 0) existingCanary[idx] = nextRow;
      else existingCanary.push(nextRow);
      const saved = await saveAdminAiGatewayOpsControl({
        disabledProviders: textToList(disabledProvidersText),
        disabledModels: textToList(disabledModelsText),
        disabledProviderRules: opsControl?.disabledProviderRules || [],
        disabledModelRules: opsControl?.disabledModelRules || [],
        modelOverrides: textToOverrides(modelOverridesText),
        dispatchPolicy: {
          ...(opsControl?.dispatchPolicy || {}),
          runtimeFallback: {
            ...(opsControl?.dispatchPolicy?.runtimeFallback || {}),
            ...runtimeFallbackDraft,
          },
          canary: existingCanary,
        },
        rollout: {
          ...(opsControl?.rollout || {}),
          previousDispatchPolicy: opsControl?.dispatchPolicy || null,
        },
      });
      setOpsControl(saved.config);
      setMessage(`灰度规则已保存：${canonicalModelId} → ${providerId} @ ${percent}%`);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存灰度规则失败');
    } finally {
      setSavingOps(false);
    }
  }, [
    canaryDraft,
    disabledModelsText,
    disabledProvidersText,
    isRolePreview,
    load,
    modelOverridesText,
    opsControl,
    runtimeFallbackDraft,
  ]);

  const rollbackDispatchPolicy = React.useCallback(async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    const previous = opsControl?.rollout?.previousDispatchPolicy;
    if (!previous) {
      setError('没有可回滚的上一版 dispatchPolicy');
      return;
    }
    if (!window.confirm('恢复上一版 dispatchPolicy（灰度/pin/runtimeFallback）？')) return;
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
        dispatchPolicy: previous,
        rollout: {
          ...(opsControl?.rollout || {}),
          previousDispatchPolicy: opsControl?.dispatchPolicy || null,
        },
      });
      setOpsControl(saved.config);
      setRuntimeFallbackDraft(runtimeFallbackFromOpsControl(saved.config));
      setMessage('已回滚到上一版 dispatchPolicy');
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '回滚 dispatchPolicy 失败');
    } finally {
      setSavingOps(false);
    }
  }, [
    disabledModelsText,
    disabledProvidersText,
    isRolePreview,
    load,
    modelOverridesText,
    opsControl,
  ]);

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
      setRuntimeFallbackDraft(runtimeFallbackFromOpsControl(cleared.config));
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

  const applyFilters = React.useCallback(() => {
    setAppliedFilters(cleanAdminAiJobFilters(filters));
  }, [filters]);

  const clearFilters = React.useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  }, []);

  const empty = !loading && jobs.length === 0;
  const opsSuggestions = React.useMemo(
    () => buildAiGatewayOpsSuggestions(summary, opsControl),
    [opsControl, summary]
  );
  const opsRuleRows = React.useMemo(() => buildAiGatewayOpsRuleRows(opsControl), [opsControl]);
  const providerPerformanceRows = React.useMemo(
    () => buildAiGatewayProviderPerformanceRows(trendReport),
    [trendReport]
  );

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

      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[11px] font-bold text-gray-200">任务筛选</h3>
            <p className="mt-1 text-[10px] text-gray-600">按状态、用户、供应商、模型或关键词缩小排查范围</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={applyFilters}
              className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[10px] text-blue-100"
            >
              应用筛选
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-xl border border-[#2e2e32] bg-[#1c1c22] px-3 py-2 text-[10px] text-gray-300"
            >
              清空
            </button>
          </div>
        </div>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.value || 'all'}
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, status: item.value }))}
                className={`rounded-lg border px-2 py-1 text-[10px] ${
                  filters.status === item.value
                    ? 'border-blue-400/50 bg-blue-400/15 text-blue-100'
                    : 'border-white/[0.08] bg-black/10 text-gray-400'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {MODALITY_FILTERS.map((item) => (
              <button
                key={item.value || 'all'}
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, modality: item.value }))}
                className={`rounded-lg border px-2 py-1 text-[10px] ${
                  filters.modality === item.value
                    ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-100'
                    : 'border-white/[0.08] bg-black/10 text-gray-400'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {FAILURE_STAGE_FILTERS.map((item) => (
              <button
                key={`stage-${item.value || 'all'}`}
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, failureStage: item.value }))}
                className={`rounded-lg border px-2 py-1 text-[10px] ${
                  filters.failureStage === item.value
                    ? 'border-rose-400/50 bg-rose-400/15 text-rose-100'
                    : 'border-white/[0.08] bg-black/10 text-gray-400'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {FAILURE_OWNER_FILTERS.map((item) => (
              <button
                key={`owner-${item.value || 'all'}`}
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, failureOwner: item.value }))}
                className={`rounded-lg border px-2 py-1 text-[10px] ${
                  filters.failureOwner === item.value
                    ? 'border-amber-400/50 bg-amber-400/15 text-amber-100'
                    : 'border-white/[0.08] bg-black/10 text-gray-400'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
            {([
              ['userId', '用户 ID'],
              ['provider', '供应商'],
              ['model', '模型'],
              ['capability', '能力'],
              ['q', '关键词'],
            ] as Array<[keyof AdminAiJobFilters, string]>).map(([key, label]) => (
              <label key={key} className={key === 'q' ? 'block xl:col-span-2' : 'block'}>
                <span className="text-[10px] text-gray-500">{label}</span>
                <input
                  value={String(filters[key] || '')}
                  onChange={(ev) => setFilters((prev) => ({ ...prev, [key]: ev.target.value }))}
                  className="mt-1 w-full rounded-xl border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 outline-none"
                />
              </label>
            ))}
          </div>
        </div>
      </div>

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
          <div className="mt-4 grid gap-3 lg:grid-cols-4">
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
            <div className={`rounded-xl border p-3 ${selectedDetail.job.fallback?.active || selectedDetail.job.fallback?.attemptCount ? 'border-blue-500/20 bg-blue-500/10' : 'border-[#252528] bg-[#0d0d10]'}`}>
              <div className="text-[10px] text-gray-600">Fallback</div>
              <div className={selectedDetail.job.fallback?.active || selectedDetail.job.fallback?.attemptCount ? 'mt-1 text-[11px] text-blue-100' : 'mt-1 text-[11px] text-gray-400'}>
                {aiJobFallbackHint(selectedDetail.job)}
              </div>
              {selectedDetail.job.fallback?.lastFallbackAt ? (
                <div className="mt-2 text-[10px] text-gray-500">{formatDate(selectedDetail.job.fallback.lastFallbackAt)}</div>
              ) : null}
            </div>
          </div>
          {selectedDetail.job.error?.message ? (
            <p className="mt-3 break-words rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] text-red-200">
              {selectedDetail.job.error.message}
            </p>
          ) : null}
          <div className="mt-3 grid gap-3 lg:grid-cols-4">
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
            <div className="rounded-xl border border-[#252528] bg-[#0d0d10] p-3">
              <div className="text-[10px] text-gray-600">链路元数据</div>
              <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-gray-400">
                {compactJson(selectedDetail.job.metadata)}
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
          {canReadOps ? <ProviderPerformanceTable rows={providerPerformanceRows} days={trendReport?.days || 7} /> : null}
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
                placeholder="vertex-site"
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

          <div className="mt-4 rounded-xl border border-[#252528] bg-[#0d0d10] p-3">
            <div className="text-[10px] font-bold text-gray-400">运行时 Fallback（A4）</div>
            <p className="mt-1 text-[10px] text-gray-600">
              保存时会保留既有 dispatchPolicy（pin/canary），并写入 runtimeFallback；连续失败自动 pause 仍由 auto-circuit 负责。
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="flex items-center gap-2 text-[10px] text-gray-300">
                <input
                  type="checkbox"
                  checked={runtimeFallbackDraft.respectProviderPin}
                  disabled={!canWriteOps || savingOps}
                  onChange={(ev) =>
                    setRuntimeFallbackDraft((prev) => ({ ...prev, respectProviderPin: ev.target.checked }))
                  }
                />
                尊重 provider pin（禁跨供应商）
              </label>
              <label className="flex items-center gap-2 text-[10px] text-gray-300">
                <input
                  type="checkbox"
                  checked={runtimeFallbackDraft.allowCrossProvider}
                  disabled={!canWriteOps || savingOps}
                  onChange={(ev) =>
                    setRuntimeFallbackDraft((prev) => ({ ...prev, allowCrossProvider: ev.target.checked }))
                  }
                />
                允许跨供应商 Fallback
              </label>
              <div>
                <div className="mb-1 text-[10px] text-gray-500">超时策略</div>
                <CustomDropdown
                  value={runtimeFallbackDraft.onTimeout}
                  options={[...TIMEOUT_FALLBACK_OPTIONS]}
                  onChange={(value) =>
                    setRuntimeFallbackDraft((prev) => ({
                      ...prev,
                      onTimeout: value as typeof prev.onTimeout,
                    }))
                  }
                  disabled={!canWriteOps || savingOps}
                />
              </div>
              <label className="block">
                <span className="text-[10px] text-gray-500">同路重试次数</span>
                <input
                  type="number"
                  min={0}
                  max={3}
                  value={runtimeFallbackDraft.sameRouteRetryMax}
                  disabled={!canWriteOps || savingOps || runtimeFallbackDraft.onTimeout !== 'same_route_retry'}
                  onChange={(ev) =>
                    setRuntimeFallbackDraft((prev) => ({
                      ...prev,
                      sameRouteRetryMax: Math.max(0, Math.min(3, Number(ev.target.value) || 0)),
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 outline-none disabled:opacity-40"
                />
              </label>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-[#252528] bg-[#0d0d10] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-[10px] font-bold text-gray-400">灰度放量 / 回滚（A5）</div>
                <p className="mt-1 text-[10px] text-gray-600">
                  canary 命中后 job.routeDecision.selectedRoute.selectionReason.strategy=canary；回滚恢复上一版 dispatchPolicy。
                </p>
              </div>
              <button
                type="button"
                disabled={!canWriteOps || savingOps || !opsControl?.rollout?.previousDispatchPolicy}
                onClick={() => {
                  void rollbackDispatchPolicy();
                }}
                className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-100 disabled:opacity-40"
              >
                回滚上一策略
              </button>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-4">
              <label className="block">
                <span className="text-[10px] text-gray-500">模型 ID</span>
                <input
                  value={canaryDraft.canonicalModelId}
                  disabled={!canWriteOps || savingOps}
                  onChange={(ev) => setCanaryDraft((prev) => ({ ...prev, canonicalModelId: ev.target.value }))}
                  className="mt-1 w-full rounded-xl border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 outline-none disabled:opacity-40"
                  placeholder="gpt-image-2"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-gray-500">供应商</span>
                <input
                  value={canaryDraft.providerId}
                  disabled={!canWriteOps || savingOps}
                  onChange={(ev) => setCanaryDraft((prev) => ({ ...prev, providerId: ev.target.value }))}
                  className="mt-1 w-full rounded-xl border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 outline-none disabled:opacity-40"
                  placeholder="302ai"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-gray-500">流量 %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={canaryDraft.percent}
                  disabled={!canWriteOps || savingOps}
                  onChange={(ev) =>
                    setCanaryDraft((prev) => ({
                      ...prev,
                      percent: Math.max(0, Math.min(100, Number(ev.target.value) || 0)),
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 outline-none disabled:opacity-40"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={!canWriteOps || savingOps}
                  onClick={() => {
                    void saveCanaryRule();
                  }}
                  className="w-full rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[10px] text-sky-100 disabled:opacity-40"
                >
                  保存灰度规则
                </button>
              </div>
            </div>
            {Array.isArray(opsControl?.dispatchPolicy?.canary) && opsControl.dispatchPolicy.canary.length ? (
              <div className="mt-3 divide-y divide-[#252528] rounded-lg border border-[#252528]">
                {opsControl.dispatchPolicy.canary.map((row, index) => {
                  const item = row as {
                    canonicalModelId?: string;
                    providerId?: string;
                    percent?: number;
                    enabled?: boolean;
                  };
                  return (
                    <div key={`${item.canonicalModelId}:${item.providerId}:${index}`} className="px-3 py-2 text-[10px] text-gray-300">
                      {item.canonicalModelId || '—'} → {item.providerId || '—'} @ {Number(item.percent) || 0}%
                      {item.enabled === false ? '（已禁用）' : ''}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 text-[10px] text-gray-600">暂无灰度规则</div>
            )}
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
                  {displayedJobs.map((job) => (
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
              {displayedJobs.map((job) => (
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
