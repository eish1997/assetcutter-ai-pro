import React from 'react';
import {
  applyAdminProviderKeyHealthAutomation,
  cooldownAdminProviderKey,
  fetchAdminProviderKeyEvents,
  fetchAdminProviderKeyHealthSummary,
  fetchAdminProviderKeys,
  restoreAdminProviderKey,
  saveAdminProviderKeys,
  type AdminProviderKeyEvent,
  type AdminProviderKeyHealthSummaryItem,
  type AdminProviderKeyRow,
} from '../../services/adminProviderKeysClient';
import { PERMISSIONS } from '../../services/adminPermissions';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { useAdminStaff } from './AdminStaffContext';

const PROVIDERS = [
  { id: 'tripo', label: 'Tripo 3D', hint: 'Bearer API Key' },
  { id: 'volcengine-jimeng', label: '即梦视频', hint: '火山 AK/SK' },
];

function providerLabel(provider: string) {
  return PROVIDERS.find((item) => item.id === provider)?.label || provider || '供应商';
}

function createDraft(provider = 'tripo'): AdminProviderKeyRow {
  return {
    id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider,
    label: providerLabel(provider),
    enabled: true,
    priority: 100,
    rpm: 0,
    secret: '',
    credentials: {},
  };
}

function credentialValue(row: AdminProviderKeyRow, key: string) {
  return row.credentials?.[key] || '';
}

function healthLabel(status?: string | null) {
  if (status === 'cooling_down') return '冷却中';
  if (status === 'degraded') return '降级';
  if (status === 'warning') return '观察';
  return '健康';
}

function healthClass(status?: string | null) {
  if (status === 'cooling_down') return 'text-amber-200';
  if (status === 'degraded') return 'text-red-200';
  if (status === 'warning') return 'text-yellow-200';
  return 'text-emerald-200';
}

function suggestionLabel(action?: string | null) {
  if (action === 'wait_or_restore') return '等待或恢复';
  if (action === 'cooldown_or_check_key') return '建议冷却或检查 Key';
  if (action === 'watch') return '继续观察';
  return '-';
}

function eventTypeLabel(type: string) {
  if (type === 'success') return '成功';
  if (type === 'error') return '错误';
  if (type === 'auto_cooldown') return '自动冷却';
  if (type === 'manual_cooldown') return '手动冷却';
  if (type === 'cooldown') return '冷却';
  if (type === 'restore') return '恢复';
  return type || '-';
}

function summaryStatusLabel(status?: string | null) {
  if (status === 'cooling_down') return '冷却中';
  if (status === 'rate_limited') return '触顶';
  if (status === 'degraded') return '异常';
  if (status === 'warning') return '观察';
  if (status === 'healthy') return '健康';
  return '空闲';
}

function summaryStatusClass(status?: string | null) {
  if (status === 'cooling_down' || status === 'rate_limited') return 'border-amber-500/40 bg-amber-500/10 text-amber-100';
  if (status === 'degraded') return 'border-red-500/40 bg-red-500/10 text-red-100';
  if (status === 'warning') return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-100';
  if (status === 'healthy') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100';
  return 'border-white/10 bg-white/[0.03] text-gray-300';
}

function percent(value?: number | null) {
  return `${Math.round(Math.max(0, Number(value || 0)) * 100)}%`;
}

const AdminProviderKeysPanel: React.FC = () => {
  const { can, isRolePreview } = useAdminStaff();
  const canWrite = can(PERMISSIONS.AI_GATEWAY_KEYS_WRITE);
  const [rows, setRows] = React.useState<AdminProviderKeyRow[]>([]);
  const [events, setEvents] = React.useState<AdminProviderKeyEvent[]>([]);
  const [summary, setSummary] = React.useState<AdminProviderKeyHealthSummaryItem[]>([]);
  const [summaryTotals, setSummaryTotals] = React.useState<{
    totalEvents: number;
    successCount: number;
    errorCount: number;
    status429Count: number;
    status5xxCount: number;
    cooldownCount: number;
    failureRate: number;
    retryableFailureRate: number;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [applyingHealth, setApplyingHealth] = React.useState(false);
  const [actingId, setActingId] = React.useState('');
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [res, eventRes, summaryRes] = await Promise.all([
        fetchAdminProviderKeys(),
        fetchAdminProviderKeyEvents({ limit: 30 }),
        fetchAdminProviderKeyHealthSummary({ windowHours: 24 }),
      ]);
      setRows(res.keys.length ? res.keys : [createDraft()]);
      setEvents(eventRes.events || []);
      setSummary(summaryRes.summaries || []);
      setSummaryTotals(summaryRes.totals || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载凭据池失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const updateRow = (id: string, patch: Partial<AdminProviderKeyRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const updateCredential = (id: string, key: string, value: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              credentials: {
                ...(row.credentials || {}),
                [key]: value,
              },
            }
          : row
      )
    );
  };

  const switchProvider = (id: string, provider: string) => {
    updateRow(id, {
      provider,
      label: providerLabel(provider),
      secret: '',
      credentials: {},
    });
  };

  const save = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const cleaned = rows
        .map((row) => {
          const provider = String(row.provider || 'tripo').trim();
          const credentials = Object.fromEntries(
            Object.entries(row.credentials || {}).map(([key, value]) => [key, String(value || '').trim()]).filter(([, value]) => value)
          );
          return {
            ...row,
            provider,
            label: String(row.label || providerLabel(provider)).trim(),
            priority: Math.max(1, Math.floor(Number(row.priority) || 100)),
            rpm: Math.max(0, Math.floor(Number(row.rpm) || 0)),
            secret: String(row.secret || '').trim(),
            credentials,
          };
        })
        .filter((row) => row.provider && (row.secret || row.hasSecret || Object.keys(row.credentials || {}).length || row.hasCredentials));
      const saved = await saveAdminProviderKeys(cleaned);
      setRows(saved.keys.length ? saved.keys : [createDraft()]);
      setMessage('凭据池已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存凭据池失败');
    } finally {
      setSaving(false);
    }
  };

  const runKeyAction = async (row: AdminProviderKeyRow, action: 'cooldown' | 'restore') => {
    if (blockIfRolePreview(isRolePreview)) return;
    setActingId(row.id);
    setError('');
    setMessage('');
    try {
      const res =
        action === 'cooldown'
          ? await cooldownAdminProviderKey(row.id, { minutes: 10, reason: '管理员手动冷却' })
          : await restoreAdminProviderKey(row.id);
      setRows(res.keys.length ? res.keys : [createDraft()]);
      const [eventRes, summaryRes] = await Promise.all([
        fetchAdminProviderKeyEvents({ limit: 30 }),
        fetchAdminProviderKeyHealthSummary({ windowHours: 24 }),
      ]);
      setEvents(eventRes.events || []);
      setSummary(summaryRes.summaries || []);
      setSummaryTotals(summaryRes.totals || null);
      setMessage(action === 'cooldown' ? '已冷却 10 分钟' : '已恢复可用');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setActingId('');
    }
  };

  const runHealthAutomation = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    setApplyingHealth(true);
    setError('');
    setMessage('');
    try {
      const res = await applyAdminProviderKeyHealthAutomation({ windowHours: 24 });
      setRows(res.keys?.length ? res.keys : [createDraft()]);
      setSummary(res.summary?.summaries || []);
      setSummaryTotals(res.summary?.totals || null);
      const eventRes = await fetchAdminProviderKeyEvents({ limit: 30 });
      setEvents(eventRes.events || []);
      setMessage(res.actions.length ? `已应用 ${res.actions.length} 条健康建议` : '暂无需要应用的健康建议');
    } catch (err) {
      setError(err instanceof Error ? err.message : '应用健康建议失败');
    } finally {
      setApplyingHealth(false);
    }
  };

  if (loading) return <div className="text-[11px] text-gray-400">正在加载凭据池...</div>;

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">AI 供应商凭据池</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          给 AI Gateway worker 使用的服务端凭据。普通用户不会看到密钥；同一供应商可配置多组凭据做轮换、限速和冷却。
        </p>
      </div>

      {error ? <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-[11px] text-red-200">{error}</div> : null}
      {message ? <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-100">{message}</div> : null}

      <div className="space-y-3">
        {rows.map((row) => {
          const isJimeng = row.provider === 'volcengine-jimeng';
          const isEnvKey = String(row.id || '').startsWith('env_');
          const isActing = actingId === row.id;
          return (
            <div key={row.id} className="rounded-xl border border-[#2e2e32] bg-[#121216] p-4">
              <div className="mb-3 flex flex-wrap gap-2">
                {PROVIDERS.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    disabled={!canWrite || saving}
                    onClick={() => switchProvider(row.id, provider.id)}
                    className={`rounded-lg border px-3 py-2 text-[11px] disabled:opacity-40 ${
                      row.provider === provider.id
                        ? 'border-blue-500/70 bg-blue-500/20 text-blue-100'
                        : 'border-[#2e2e32] bg-[#1c1c22] text-gray-300'
                    }`}
                  >
                    <span className="font-semibold">{provider.label}</span>
                    <span className="ml-2 text-gray-500">{provider.hint}</span>
                  </button>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_120px_120px_100px]">
                <label className="block">
                  <span className="text-[10px] text-gray-500">名称</span>
                  <input
                    value={row.label}
                    onChange={(ev) => updateRow(row.id, { label: ev.target.value })}
                    disabled={!canWrite || saving}
                    className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-gray-500">优先级</span>
                  <input
                    inputMode="numeric"
                    value={String(row.priority)}
                    onChange={(ev) => updateRow(row.id, { priority: Number(ev.target.value) || 100 })}
                    disabled={!canWrite || saving}
                    className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-gray-500">每分钟上限</span>
                  <input
                    inputMode="numeric"
                    value={String(row.rpm || 0)}
                    onChange={(ev) => updateRow(row.id, { rpm: Number(ev.target.value) || 0 })}
                    disabled={!canWrite || saving}
                    className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40"
                  />
                </label>
                <label className="flex items-end gap-2 pb-2 text-[11px] text-gray-300">
                  <input
                    type="checkbox"
                    checked={row.enabled !== false}
                    onChange={(ev) => updateRow(row.id, { enabled: ev.target.checked })}
                    disabled={!canWrite || saving}
                  />
                  启用
                </label>
              </div>

              {isJimeng ? (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="text-[10px] text-gray-500">
                      Access Key {row.credentialsPreview?.accessKeyId ? `（当前 ${row.credentialsPreview.accessKeyId}）` : ''}
                    </span>
                    <input
                      type="password"
                      value={credentialValue(row, 'accessKeyId')}
                      onChange={(ev) => updateCredential(row.id, 'accessKeyId', ev.target.value)}
                      disabled={!canWrite || saving}
                      placeholder={row.hasCredentials ? '留空则保留现有 Access Key' : '粘贴 VOLCENGINE_ACCESS_KEY'}
                      className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-gray-500">
                      Secret Key {row.credentialsPreview?.secretAccessKey ? `（当前 ${row.credentialsPreview.secretAccessKey}）` : ''}
                    </span>
                    <input
                      type="password"
                      value={credentialValue(row, 'secretAccessKey')}
                      onChange={(ev) => updateCredential(row.id, 'secretAccessKey', ev.target.value)}
                      disabled={!canWrite || saving}
                      placeholder={row.hasCredentials ? '留空则保留现有 Secret Key' : '粘贴 VOLCENGINE_SECRET_KEY'}
                      className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40"
                    />
                  </label>
                </div>
              ) : (
                <label className="mt-3 block">
                  <span className="text-[10px] text-gray-500">
                    API Key {row.secretPreview ? `（当前 ${row.secretPreview}）` : ''}
                  </span>
                  <input
                    type="password"
                    value={row.secret || ''}
                    onChange={(ev) => updateRow(row.id, { secret: ev.target.value })}
                    disabled={!canWrite || saving}
                    placeholder={row.hasSecret ? '留空则保留现有 API Key' : '粘贴 Tripo API Key'}
                    className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40"
                  />
                </label>
              )}

              {row.runtime ? (
                <div className="mt-3 grid gap-2 border-t border-white/[0.06] pt-3 text-[10px] text-gray-500 md:grid-cols-6">
                  <div>
                    <div>上次使用</div>
                    <div className="mt-0.5 text-gray-300">{row.runtime.lastUsedAt ? new Date(row.runtime.lastUsedAt).toLocaleString() : '-'}</div>
                  </div>
                  <div>
                    <div>本分钟次数</div>
                    <div className="mt-0.5 text-gray-300">{row.runtime.currentMinuteCount ?? 0}{row.rpm ? ` / ${row.rpm}` : ''}</div>
                  </div>
                  <div>
                    <div>状态</div>
                    <div className={`mt-0.5 ${healthClass(row.runtime.healthStatus)}`}>
                      {healthLabel(row.runtime.healthStatus)}
                    </div>
                  </div>
                  <div>
                    <div>连续错误</div>
                    <div className="mt-0.5 text-gray-300">{row.runtime.consecutiveErrorCount ?? 0}</div>
                  </div>
                  <div>
                    <div>建议</div>
                    <div className="mt-0.5 text-gray-300">{suggestionLabel(row.runtime.suggestedAction)}</div>
                  </div>
                  <div>
                    <div>最近错误</div>
                    <div className="mt-0.5 truncate text-gray-300" title={row.runtime.lastCooldownReason || row.runtime.lastError || ''}>
                      {row.runtime.lastCooldownReason || row.runtime.lastError || '-'}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={!canWrite || saving || isActing || isEnvKey}
                  onClick={() => void runKeyAction(row, 'cooldown')}
                  className="rounded-lg border border-amber-900/50 bg-amber-950/25 px-3 py-2 text-[11px] text-amber-100 disabled:opacity-40"
                >
                  冷却 10 分钟
                </button>
                <button
                  type="button"
                  disabled={!canWrite || saving || isActing || isEnvKey}
                  onClick={() => void runKeyAction(row, 'restore')}
                  className="rounded-lg border border-emerald-900/50 bg-emerald-950/25 px-3 py-2 text-[11px] text-emerald-100 disabled:opacity-40"
                >
                  恢复
                </button>
                <button
                  type="button"
                  disabled={!canWrite || saving || isEnvKey}
                  onClick={() => setRows((prev) => prev.filter((item) => item.id !== row.id))}
                  className="rounded-lg border border-red-900/50 bg-red-950/25 px-3 py-2 text-[11px] text-red-200 disabled:opacity-40"
                >
                  删除
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-[#2e2e32] bg-[#121216] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[12px] font-semibold text-gray-200">供应商健康报表（最近 24 小时）</h3>
            <p className="mt-1 text-[10px] text-gray-500">基于已持久化的成功、失败、冷却和恢复事件统计。</p>
          </div>
          {summaryTotals ? (
            <div className="flex flex-wrap gap-2 text-[10px] text-gray-400">
              <span className="rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1">事件 {summaryTotals.totalEvents}</span>
              <span className="rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1">成功 {summaryTotals.successCount}</span>
              <span className="rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1">失败 {summaryTotals.errorCount}</span>
              <span className="rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1">429 {summaryTotals.status429Count}</span>
              <span className="rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1">5xx {summaryTotals.status5xxCount}</span>
              <span className="rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1">失败率 {percent(summaryTotals.failureRate)}</span>
            </div>
          ) : null}
          <button
            type="button"
            disabled={!canWrite || saving || applyingHealth}
            onClick={() => void runHealthAutomation()}
            className="rounded-lg border border-amber-900/50 bg-amber-950/25 px-3 py-1.5 text-[10px] text-amber-100 disabled:opacity-40"
          >
            {applyingHealth ? '应用中...' : '应用健康建议'}
          </button>
        </div>
        {summary.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {summary.map((item) => (
              <div key={item.providerKeyId || `${item.provider}-${item.label}`} className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-semibold text-gray-200" title={item.label || item.providerKeyId || ''}>
                      {item.label || item.providerKeyId || '-'}
                    </div>
                    <div className="mt-0.5 text-[10px] text-gray-500">{item.provider || '-'}</div>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${summaryStatusClass(item.healthStatus)}`}>
                    {summaryStatusLabel(item.healthStatus)}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-[10px] text-gray-500">
                  <div>
                    <div>成功</div>
                    <div className="mt-0.5 text-gray-300">{item.successCount}</div>
                  </div>
                  <div>
                    <div>失败</div>
                    <div className="mt-0.5 text-gray-300">{item.errorCount}</div>
                  </div>
                  <div>
                    <div>429</div>
                    <div className="mt-0.5 text-gray-300">{item.status429Count}</div>
                  </div>
                  <div>
                    <div>冷却</div>
                    <div className="mt-0.5 text-gray-300">{item.cooldownCount}</div>
                  </div>
                </div>
                <div className="mt-2 grid gap-2 text-[10px] text-gray-500 md:grid-cols-2">
                  <div>失败率 <span className="text-gray-300">{percent(item.failureRate)}</span></div>
                  <div>可重试失败 <span className="text-gray-300">{percent(item.retryableFailureRate)}</span></div>
                  <div>最近成功 <span className="text-gray-300">{item.lastSuccessAt ? new Date(item.lastSuccessAt).toLocaleString() : '-'}</span></div>
                  <div>最近失败 <span className="text-gray-300">{item.lastErrorAt ? new Date(item.lastErrorAt).toLocaleString() : '-'}</span></div>
                </div>
                {item.lastErrorMessage ? (
                  <div className="mt-2 truncate rounded-md bg-red-950/20 px-2 py-1 text-[10px] text-red-100" title={item.lastErrorMessage}>
                    {item.lastErrorStatus ? `HTTP ${item.lastErrorStatus} ` : ''}{item.lastErrorMessage}
                  </div>
                ) : null}
                {item.automation?.recommended ? (
                  <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-950/20 px-2 py-1 text-[10px] text-amber-100">
                    建议：冷却 {item.automation.ttlMinutes} 分钟，避免异常 key 继续接任务
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-4 text-[11px] text-gray-500">暂无健康报表数据</div>
        )}
      </div>

      <div className="rounded-xl border border-[#2e2e32] bg-[#121216] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-[12px] font-semibold text-gray-200">最近健康事件</h3>
          <button
            type="button"
            disabled={saving}
            onClick={() => void load()}
            className="rounded-lg border border-[#2e2e32] bg-[#1c1c22] px-3 py-1.5 text-[10px] text-gray-300 disabled:opacity-40"
          >
            刷新
          </button>
        </div>
        {events.length ? (
          <div className="space-y-2">
            {events.map((event) => (
              <div key={event.id} className="grid gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-[10px] text-gray-500 md:grid-cols-[120px_130px_1fr_150px]">
                <div>
                  <div className="text-gray-300">{eventTypeLabel(event.type)}</div>
                  <div>{event.status ? `HTTP ${event.status}` : event.retryable ? '可重试' : '-'}</div>
                </div>
                <div>
                  <div className="truncate text-gray-300" title={event.label || event.providerKeyId || ''}>{event.label || event.providerKeyId || '-'}</div>
                  <div>{event.provider || '-'}</div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-gray-300" title={event.reason || event.message || ''}>{event.reason || event.message || '-'}</div>
                  <div>连续错误 {event.consecutiveErrorCount ?? 0}，自动冷却 {event.autoCooldownCount ?? 0}</div>
                </div>
                <div className="text-gray-400">{event.createdAt ? new Date(event.createdAt).toLocaleString() : '-'}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-4 text-[11px] text-gray-500">暂无健康事件</div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canWrite || saving}
          onClick={() => setRows((prev) => [...prev, createDraft()])}
          className="rounded-lg border border-[#2e2e32] bg-[#1c1c22] px-4 py-2 text-[11px] text-gray-300 disabled:opacity-40"
        >
          添加凭据
        </button>
        <button
          type="button"
          disabled={!canWrite || saving}
          onClick={() => void save()}
          className="rounded-lg bg-[#2563eb] px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-40"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void load()}
          className="rounded-lg border border-[#2e2e32] bg-[#1c1c22] px-4 py-2 text-[11px] text-gray-300 disabled:opacity-40"
        >
          重新加载
        </button>
      </div>
    </div>
  );
};

export default AdminProviderKeysPanel;
