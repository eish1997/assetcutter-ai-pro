import React from 'react';
import {
  applyAdminProviderKeyHealthAutomation,
  cooldownAdminProviderKey,
  fetchAdminProviderKeyEvents,
  fetchAdminProviderKeyHealthSummary,
  fetchAdminModelAvailabilitySummary,
  fetchAdminProviderKeys,
  fetchAdminModelOpsConfig,
  restoreAdminProviderKey,
  saveAdminModelOpsConfig,
  saveAdminProviderKeys,
  smokeTestAdminProviderKey,
  testAdminModelRoute,
  type AdminModelOpsConfig,
  type AdminModelAvailabilitySummaryItem,
  type AdminProviderKeyEvent,
  type AdminProviderKeyHealthSummaryItem,
  type AdminProviderKeyRow,
} from '../../services/adminProviderKeysClient';
import { PERMISSIONS } from '../../services/adminPermissions';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import {
  getProviderCatalogEntry,
  getCanonicalModel,
  listCanonicalModels,
  listModelRoutes,
  listProviderModels,
  listProviderRoutes,
  providerDisplayName,
  providerModelCount,
  providerRouteCount,
  providersForAdminKeyPool,
  type ModelRouteCatalogEntry,
  type ModelRouteExecutionStatus,
  type ModelRouteGatewayExecutionStatus,
  type ProviderAuthField,
  type ProviderCapabilityStatus,
  type ProviderCatalogEntry,
  type ProviderModelCatalogEntry,
  type ProviderModelLifecycle,
  type ProviderModelStatus,
  type ProviderModality,
} from '../../services/modelRegistry';
import { useAdminStaff } from './AdminStaffContext';

const PROVIDERS = providersForAdminKeyPool();

const WORKSPACE_PUBLISH_MODALITIES: readonly ProviderModality[] = ['text', 'image', 'video', 'model3d', 'music'];

const WORKSPACE_CANONICAL_MODELS = listCanonicalModels().filter(
  (model) =>
    WORKSPACE_PUBLISH_MODALITIES.includes(model.modality) &&
    model.visibleInWorkspace &&
    model.status !== 'disabled'
);

function defaultPublishedCanonicalIds() {
  return WORKSPACE_CANONICAL_MODELS.filter((model) => model.status === 'published').map((model) => model.canonicalModelId);
}

const MODALITY_LABELS: Record<ProviderModality, string> = {
  text: '文',
  image: '图',
  video: '视频',
  model3d: '3D',
  music: '音乐',
  digital_human: '数字人',
};

function providerLabel(provider: string) {
  return providerDisplayName(provider) || provider || '供应商';
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

function providerAuthFields(provider: string): readonly ProviderAuthField[] {
  return getProviderCatalogEntry(provider)?.authSchemes[0]?.fields || [];
}

function fieldCurrentPreview(row: AdminProviderKeyRow, field: ProviderAuthField) {
  if (field.storage === 'secret') return row.secretPreview || '';
  return row.credentialsPreview?.[field.key] || '';
}

function fieldValue(row: AdminProviderKeyRow, field: ProviderAuthField) {
  if (field.storage === 'secret') return row.secret || '';
  return credentialValue(row, field.key);
}

function providerKeyCount(rows: readonly AdminProviderKeyRow[], provider: string) {
  return rows.filter(
    (row) => row.provider === provider && (row.hasSecret || row.secret || row.hasCredentials || Object.keys(row.credentials || {}).length)
  ).length;
}

function ProviderLinks({ provider }: { provider: ProviderCatalogEntry }) {
  const links = [
    { label: '官网', href: provider.homepageUrl },
    { label: '控制台', href: provider.consoleUrl },
    { label: '文档', href: provider.docsUrl },
    { label: '价格', href: provider.pricingUrl },
  ].filter((item): item is { label: string; href: string } => Boolean(item.href));

  if (!links.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {links.map((link) => (
        <a
          key={`${provider.id}:${link.label}`}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-white/[0.08] bg-black/20 px-2 py-1 text-[10px] text-gray-300 hover:border-blue-400/40 hover:text-blue-100"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
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

const CAPABILITY_STATUS_ITEMS: readonly {
  key: keyof ProviderCapabilityStatus;
  label: string;
}[] = [
  { key: 'catalogVisible', label: '展示' },
  { key: 'keyPoolSupported', label: 'Key池' },
  { key: 'backendAdapterReady', label: '后端' },
  { key: 'platformKeyReady', label: '平台Key' },
  { key: 'byokSupported', label: 'BYOK' },
  { key: 'modelCatalogReady', label: '模型' },
  { key: 'smokeTestReady', label: '测试' },
];

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={`rounded-md border px-1.5 py-0.5 text-[10px] ${
        active
          ? 'border-emerald-500/30 bg-emerald-950/25 text-emerald-100'
          : 'border-white/[0.08] bg-white/[0.03] text-gray-500'
      }`}
    >
      {label}
    </span>
  );
}

function ProviderCapabilityMatrix({ provider }: { provider: ProviderCatalogEntry }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CAPABILITY_STATUS_ITEMS.map((item) => (
        <StatusPill key={`${provider.id}:${item.key}`} active={provider.capabilityStatus[item.key]} label={item.label} />
      ))}
    </div>
  );
}

function lifecycleLabel(lifecycle?: ProviderModelLifecycle) {
  if (lifecycle === 'active') return '可用';
  if (lifecycle === 'preview') return '预览';
  if (lifecycle === 'manual') return '待验证';
  if (lifecycle === 'planned') return '计划中';
  return '-';
}

function modelStatusLabel(status?: ProviderModelStatus) {
  if (status === 'verified') return '已验证';
  if (status === 'testing') return '待测试';
  if (status === 'discovered') return '已发现';
  if (status === 'requires_mapping') return '需映射';
  if (status === 'disabled') return '停用';
  return '-';
}

function modelStatusClass(status?: ProviderModelStatus) {
  if (status === 'verified') return 'border-emerald-500/30 bg-emerald-950/25 text-emerald-100';
  if (status === 'requires_mapping') return 'border-amber-500/30 bg-amber-950/25 text-amber-100';
  if (status === 'testing' || status === 'discovered') return 'border-blue-500/25 bg-blue-950/20 text-blue-100';
  return 'border-white/10 bg-white/[0.03] text-gray-400';
}

function routeExecutionLabel(status?: ModelRouteExecutionStatus) {
  if (status === 'platform_ready') return '平台可用';
  if (status === 'byok_ready') return 'BYOK';
  if (status === 'requires_endpoint_mapping') return '需映射';
  if (status === 'adapter_pending') return '待后端';
  if (status === 'disabled') return '停用';
  return '-';
}

function routeExecutionClass(status?: ModelRouteExecutionStatus) {
  if (status === 'platform_ready') return 'border-emerald-500/30 bg-emerald-950/25 text-emerald-100';
  if (status === 'byok_ready') return 'border-blue-500/25 bg-blue-950/20 text-blue-100';
  if (status === 'requires_endpoint_mapping') return 'border-amber-500/30 bg-amber-950/25 text-amber-100';
  if (status === 'adapter_pending') return 'border-purple-500/25 bg-purple-950/20 text-purple-100';
  return 'border-white/10 bg-white/[0.03] text-gray-400';
}

function gatewayExecutionLabel(status?: ModelRouteGatewayExecutionStatus) {
  if (status === 'gateway_ready') return 'Gateway 可执行';
  if (status === 'adapter_pending') return 'Gateway 待接';
  if (status === 'not_gateway_routed') return '非 Gateway';
  return '-';
}

function gatewayExecutionClass(status?: ModelRouteGatewayExecutionStatus) {
  if (status === 'gateway_ready') return 'border-emerald-500/30 bg-emerald-950/25 text-emerald-100';
  if (status === 'adapter_pending') return 'border-purple-500/25 bg-purple-950/20 text-purple-100';
  return 'border-white/10 bg-white/[0.03] text-gray-400';
}

function routeStatusLabel(route: ModelRouteCatalogEntry) {
  return routeExecutionLabel(route.executionStatus);
}

function routeStatusClass(route: ModelRouteCatalogEntry) {
  return routeExecutionClass(route.executionStatus);
}

function ProviderModelRow({ model }: { model: ProviderModelCatalogEntry }) {
  return (
    <div className="grid gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-[10px] text-gray-500 md:grid-cols-[1fr_90px_90px]">
      <div className="min-w-0">
        <div className="truncate text-[11px] font-semibold text-gray-200" title={model.label}>
          {model.label}
        </div>
        <div className="mt-0.5 truncate" title={model.providerModelId}>
          {model.providerModelId}
        </div>
      </div>
      <div>
        <div>{MODALITY_LABELS[model.modality]}</div>
        <div className="mt-0.5 text-gray-300">{model.registryId || '-'}</div>
      </div>
      <div>
        <div>{lifecycleLabel(model.lifecycle)}</div>
        <div className="mt-1">
          <span className={`inline-flex rounded-full border px-2 py-0.5 ${modelStatusClass(model.status)}`}>{modelStatusLabel(model.status)}</span>
        </div>
      </div>
    </div>
  );
}

function ProviderRouteRow({ route }: { route: ModelRouteCatalogEntry }) {
  const canonical = getCanonicalModel(route.canonicalModelId);
  return (
    <div className="grid gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-[10px] text-gray-500 md:grid-cols-[1fr_100px_80px_80px]">
      <div className="min-w-0">
        <div className="truncate text-[11px] font-semibold text-gray-200" title={canonical?.label || route.canonicalModelId}>
          {canonical?.label || route.canonicalModelId}
        </div>
        <div className="mt-0.5 truncate" title={route.providerModelId}>
          {route.providerModelId}
        </div>
      </div>
      <div>
        <div>{MODALITY_LABELS[route.modality]}</div>
        <div className="mt-0.5 text-gray-300">{route.channel || route.source}</div>
      </div>
      <div>
        <div>优先级</div>
        <div className="mt-0.5 text-gray-300">{route.priority}</div>
      </div>
      <div>
        <div>
          <span className={`inline-flex rounded-full border px-2 py-0.5 ${routeStatusClass(route)}`}>{routeStatusLabel(route)}</span>
        </div>
        <div className="mt-1">
          <span className={`inline-flex rounded-full border px-2 py-0.5 ${gatewayExecutionClass(route.gatewayExecutionStatus)}`}>
            {gatewayExecutionLabel(route.gatewayExecutionStatus)}
          </span>
        </div>
      </div>
    </div>
  );
}

function canonicalStatusLabel(status?: string) {
  if (status === 'published') return 'Published';
  if (status === 'draft') return 'Draft';
  if (status === 'deprecated') return 'Deprecated';
  if (status === 'disabled') return 'Disabled';
  return '-';
}

function modelAvailabilityLabel(status?: string) {
  if (status === 'ready') return '可发布';
  if (status === 'key_missing') return '缺 Key';
  if (status === 'parameter_pending') return '参数待映射';
  if (status === 'adapter_pending') return 'Gateway 待接';
  if (status === 'route_not_found') return '无路由';
  return '检测中';
}

function modelAvailabilityClass(status?: string) {
  if (status === 'ready') return 'border-emerald-500/30 bg-emerald-950/25 text-emerald-100';
  if (status === 'key_missing') return 'border-amber-500/30 bg-amber-950/25 text-amber-100';
  if (status === 'parameter_pending') return 'border-orange-500/30 bg-orange-950/25 text-orange-100';
  if (status === 'adapter_pending') return 'border-purple-500/25 bg-purple-950/20 text-purple-100';
  if (status === 'route_not_found') return 'border-red-500/25 bg-red-950/20 text-red-100';
  return 'border-white/10 bg-white/[0.03] text-gray-400';
}

function workspaceModelAvailabilityPayload() {
  return {
    models: WORKSPACE_CANONICAL_MODELS.map((model) => ({
      canonicalModelId: model.canonicalModelId,
      modality: model.modality,
      routes: listModelRoutes(model.canonicalModelId).map((route) => ({
        providerId: route.providerId,
        modality: route.modality,
        executionStatus: route.executionStatus,
        requiresEndpointMapping: route.requiresEndpointMapping === true,
      })),
    })),
  };
}

const AdminProviderKeysPanel: React.FC = () => {
  const { can, isRolePreview } = useAdminStaff();
  const canWrite = can(PERMISSIONS.AI_GATEWAY_KEYS_WRITE);
  const canWriteOps = can(PERMISSIONS.AI_GATEWAY_OPS_WRITE);
  const [rows, setRows] = React.useState<AdminProviderKeyRow[]>([]);
  const [modelOpsConfig, setModelOpsConfig] = React.useState<AdminModelOpsConfig | null>(null);
  const [selectedCanonicalModelIds, setSelectedCanonicalModelIds] = React.useState<string[]>(() => defaultPublishedCanonicalIds());
  const [modelAvailability, setModelAvailability] = React.useState<AdminModelAvailabilitySummaryItem[]>([]);
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
  const [savingModelOps, setSavingModelOps] = React.useState(false);
  const [applyingHealth, setApplyingHealth] = React.useState(false);
  const [actingId, setActingId] = React.useState('');
  const [routeTestingId, setRouteTestingId] = React.useState('');
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [selectedProviderId, setSelectedProviderId] = React.useState(PROVIDERS[0]?.id || 'tripo');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [res, eventRes, summaryRes, modelOpsRes, availabilityRes] = await Promise.all([
        fetchAdminProviderKeys(),
        fetchAdminProviderKeyEvents({ limit: 30 }),
        fetchAdminProviderKeyHealthSummary({ windowHours: 24 }),
        fetchAdminModelOpsConfig().catch(() => null),
        fetchAdminModelAvailabilitySummary(workspaceModelAvailabilityPayload()).catch(() => null),
      ]);
      setRows(res.keys.length ? res.keys : [createDraft()]);
      setEvents(eventRes.events || []);
      setSummary(summaryRes.summaries || []);
      setSummaryTotals(summaryRes.totals || null);
      setModelAvailability(availabilityRes?.models || []);
      if (modelOpsRes?.config) {
        setModelOpsConfig(modelOpsRes.config);
        const allow = modelOpsRes.config.publishedCanonicalModelAllowlist;
        setSelectedCanonicalModelIds(Array.isArray(allow) ? allow : defaultPublishedCanonicalIds());
      }
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

  const toggleCanonicalModel = (canonicalModelId: string) => {
    setSelectedCanonicalModelIds((prev) =>
      prev.includes(canonicalModelId)
        ? prev.filter((id) => id !== canonicalModelId)
        : [...prev, canonicalModelId]
    );
  };

  const refreshModelAvailability = async () => {
    const availabilityRes = await fetchAdminModelAvailabilitySummary(workspaceModelAvailabilityPayload());
    setModelAvailability(availabilityRes.models || []);
    return availabilityRes.models || [];
  };

  const savePublishedModels = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    setSavingModelOps(true);
    setError('');
    setMessage('');
    try {
      const known = new Set(WORKSPACE_CANONICAL_MODELS.map((model) => model.canonicalModelId));
      const selected = selectedCanonicalModelIds.filter((id, index, arr) => known.has(id) && arr.indexOf(id) === index);
      const base: AdminModelOpsConfig = modelOpsConfig || {
        version: 1,
        imageRegistryAllowlist: null,
        publishedCanonicalModelAllowlist: null,
        imageModelPreference: null,
        bindingOverrides: null,
        wiringEdges: null,
      };
      const availabilityRows = modelAvailability.length ? modelAvailability : await refreshModelAvailability();
      const availabilityById = new Map(availabilityRows.map((row) => [row.canonicalModelId, row]));
      const blocked = selected
        .map((id) => availabilityById.get(id))
        .filter((row): row is AdminModelAvailabilitySummaryItem => Boolean(row && !row.workspaceSelectable));
      if (blocked.length) {
        setError(
          `有 ${blocked.length} 个模型暂不能发布：${blocked
            .slice(0, 4)
            .map((row) => `${row.canonicalModelId}（${row.reason}）`)
            .join('；')}${blocked.length > 4 ? '；...' : ''}`
        );
        return;
      }
      const saved = await saveAdminModelOpsConfig({
        ...base,
        publishedCanonicalModelAllowlist: selected,
      });
      setModelOpsConfig(saved.config);
      setSelectedCanonicalModelIds(saved.config.publishedCanonicalModelAllowlist || selected);
      setMessage('Workspace model publish scope saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workspace model publish scope');
    } finally {
      setSavingModelOps(false);
    }
  };

  const selectPublishableModels = async () => {
    setError('');
    setMessage('');
    try {
      const availabilityRows = modelAvailability.length ? modelAvailability : await refreshModelAvailability();
      const readyIds = availabilityRows
        .filter((row) => row.workspaceSelectable)
        .map((row) => row.canonicalModelId)
        .filter((id, index, arr) => arr.indexOf(id) === index);
      setSelectedCanonicalModelIds(readyIds);
      setMessage(`Selected ${readyIds.length} publishable models`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select publishable models');
    }
  };

  const runModelRouteTest = async (canonicalModelId: string) => {
    const model = WORKSPACE_CANONICAL_MODELS.find((row) => row.canonicalModelId === canonicalModelId);
    if (!model) return;
    const availability = modelAvailabilityById.get(canonicalModelId);
    const availabilityRoute = availability?.routes.find((route) => route.selectable) || availability?.routes[0];
    const catalogRoute = listModelRoutes(canonicalModelId)[0];
    setRouteTestingId(canonicalModelId);
    setError('');
    setMessage('');
    try {
      const res = await testAdminModelRoute({
        canonicalModelId,
        modality: availabilityRoute?.modality || catalogRoute?.modality || model.modality,
        providerId: availabilityRoute?.providerId || catalogRoute?.providerId,
        executionStatus: availabilityRoute?.executionStatus || catalogRoute?.executionStatus,
        requiresEndpointMapping: catalogRoute?.requiresEndpointMapping === true,
      });
      await refreshModelAvailability();
      if (res.result.status === 'passed') {
        setMessage(`${canonicalModelId} route test passed`);
      } else {
        setError(`${canonicalModelId} route test failed: ${res.result.message}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Route test failed');
    } finally {
      setRouteTestingId('');
    }
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
      await refreshModelAvailability();
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
        refreshModelAvailability(),
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

  const runSmokeTest = async (row: AdminProviderKeyRow) => {
    if (blockIfRolePreview(isRolePreview)) return;
    setActingId(row.id);
    setError('');
    setMessage('');
    try {
      const res = await smokeTestAdminProviderKey(row.id);
      setRows(res.keys.length ? res.keys : [createDraft()]);
      const [eventRes, summaryRes] = await Promise.all([
        fetchAdminProviderKeyEvents({ limit: 30 }),
        fetchAdminProviderKeyHealthSummary({ windowHours: 24 }),
        refreshModelAvailability(),
      ]);
      setEvents(eventRes.events || []);
      setSummary(summaryRes.summaries || []);
      setSummaryTotals(summaryRes.totals || null);
      const modeLabel = res.result.mode === 'real_upstream' ? '真实探活' : '凭证检查';
      const routeLabel = res.result.route ? `（${res.result.route}）` : '';
      const latencyLabel = res.result.latencyMs != null ? `，${res.result.latencyMs}ms` : '';
      setMessage(
        res.result.ok
          ? `测试通过：${res.result.label || row.label} · ${modeLabel}${routeLabel}${latencyLabel}`
          : `测试失败：${res.result.message}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '测试失败');
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
      await refreshModelAvailability();
      setMessage(res.actions.length ? `已应用 ${res.actions.length} 条健康建议` : '暂无需要应用的健康建议');
    } catch (err) {
      setError(err instanceof Error ? err.message : '应用健康建议失败');
    } finally {
      setApplyingHealth(false);
    }
  };

  const selectedCanonicalSet = React.useMemo(
    () => new Set(selectedCanonicalModelIds),
    [selectedCanonicalModelIds]
  );
  const modelAvailabilityById = React.useMemo(
    () => new Map(modelAvailability.map((row) => [row.canonicalModelId, row])),
    [modelAvailability]
  );

  if (loading) return <div className="text-[11px] text-gray-400">正在加载凭据池...</div>;

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">供应商中心</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          按供应商维护平台凭据、模型清单和入口网址；同一供应商可配置多组凭据做轮换、限速和冷却。
        </p>
      </div>

      {error ? <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-[11px] text-red-200">{error}</div> : null}
      {message ? <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-100">{message}</div> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {PROVIDERS.map((provider) => {
          const keyCount = providerKeyCount(rows, provider.id);
          const modelCount = providerModelCount(provider.id);
          const routeCount = providerRouteCount(provider.id);
          const sampleModels = listProviderModels(provider.id).slice(0, 3);
          const selected = selectedProviderId === provider.id;
          return (
            <div
              key={provider.id}
              className={`rounded-xl border bg-[#121216] p-4 transition ${
                selected ? 'border-blue-500/60 ring-1 ring-blue-500/20' : 'border-[#2e2e32] hover:border-white/20'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-semibold text-gray-100">{provider.displayName}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {provider.supportedModalities.map((modality) => (
                      <span key={`${provider.id}:${modality}`} className="rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-gray-300">
                        {MODALITY_LABELS[modality]}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2">
                    <ProviderCapabilityMatrix provider={provider} />
                  </div>
                </div>
                <div className="shrink-0 text-right text-[10px] text-gray-500">
                  <div>{keyCount} 组 Key</div>
                  <div className="mt-1">{modelCount} 个模型</div>
                  <div className="mt-1">{routeCount} 条路径</div>
                  <button
                    type="button"
                    onClick={() => setSelectedProviderId(provider.id)}
                    className={`mt-2 rounded-lg border px-2 py-1 text-[10px] ${
                      selected ? 'border-blue-400/50 bg-blue-500/15 text-blue-100' : 'border-white/[0.08] bg-black/20 text-gray-300'
                    }`}
                  >
                    查看
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-[10px] text-gray-500">
                {sampleModels.length ? (
                  sampleModels.map((model) => (
                    <div key={`${provider.id}:${model.providerModelId}`} className="truncate" title={model.label}>
                      {model.label}
                    </div>
                  ))
                ) : (
                  <div>模型清单待维护</div>
                )}
              </div>
              <ProviderLinks provider={provider} />
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-[#2e2e32] bg-[#121216] p-4">
        {(() => {
          const selectedProvider = getProviderCatalogEntry(selectedProviderId) || PROVIDERS[0];
          if (!selectedProvider) return null;
          const models = listProviderModels(selectedProvider.id);
          const routes = listProviderRoutes(selectedProvider.id);
          return (
            <>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-[12px] font-semibold text-gray-200">{selectedProvider.displayName} · 模型与路径</h3>
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-500">
                    <span>{models.length} 个模型</span>
                    <span>{routes.length} 条路径</span>
                    <span>{selectedProvider.modelDiscovery === 'api-planned' ? '计划扫描' : selectedProvider.modelDiscovery === 'static' ? '静态维护' : '手工维护'}</span>
                  </div>
                  <div className="mt-2">
                    <ProviderCapabilityMatrix provider={selectedProvider} />
                  </div>
                </div>
                <ProviderLinks provider={selectedProvider} />
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-[11px] font-semibold text-gray-300">Models</div>
                  <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
                    {models.length ? (
                      models.map((model) => <ProviderModelRow key={`${model.providerId}:${model.providerModelId}:${model.registryId || ''}`} model={model} />)
                    ) : (
                      <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-4 text-[11px] text-gray-500">暂无模型清单</div>
                    )}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-[11px] font-semibold text-gray-300">Routes</div>
                  <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
                    {routes.length ? (
                      routes.map((route) => <ProviderRouteRow key={route.routeId} route={route} />)
                    ) : (
                      <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-4 text-[11px] text-gray-500">暂无供应路径</div>
                    )}
                  </div>
                </div>
              </div>
            </>
          );
        })()}
      </div>

      <div className="rounded-xl border border-[#2e2e32] bg-[#121216] p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[12px] font-semibold text-gray-200">Workspace model publishing</h3>
            <div className="mt-1 text-[10px] text-gray-500">
              {selectedCanonicalModelIds.length} / {WORKSPACE_CANONICAL_MODELS.length} models enabled
              {modelOpsConfig?.updatedAt ? ` · ${new Date(modelOpsConfig.updatedAt).toLocaleString()}` : ''}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canWriteOps || savingModelOps}
              onClick={() => setSelectedCanonicalModelIds(WORKSPACE_CANONICAL_MODELS.map((model) => model.canonicalModelId))}
              className="rounded-lg border border-[#2e2e32] bg-[#1c1c22] px-3 py-1.5 text-[10px] text-gray-300 disabled:opacity-40"
            >
              All
            </button>
            <button
              type="button"
              disabled={!canWriteOps || savingModelOps}
              onClick={() => void selectPublishableModels()}
              className="rounded-lg border border-emerald-500/25 bg-emerald-950/20 px-3 py-1.5 text-[10px] text-emerald-100 disabled:opacity-40"
            >
              Ready only
            </button>
            <button
              type="button"
              disabled={!canWriteOps || savingModelOps}
              onClick={() => setSelectedCanonicalModelIds(defaultPublishedCanonicalIds())}
              className="rounded-lg border border-[#2e2e32] bg-[#1c1c22] px-3 py-1.5 text-[10px] text-gray-300 disabled:opacity-40"
            >
              Catalog default
            </button>
            <button
              type="button"
              disabled={!canWriteOps || savingModelOps || selectedCanonicalModelIds.length === 0}
              onClick={() => void savePublishedModels()}
              className="rounded-lg bg-[#2563eb] px-3 py-1.5 text-[10px] font-semibold text-white disabled:opacity-40"
            >
              {savingModelOps ? 'Saving...' : 'Save publish scope'}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {WORKSPACE_PUBLISH_MODALITIES.map((modality) => {
            const models = WORKSPACE_CANONICAL_MODELS.filter((model) => model.modality === modality);
            if (!models.length) return null;
            return (
              <div key={modality}>
                <div className="mb-2 text-[11px] font-semibold text-gray-300">{MODALITY_LABELS[modality]}</div>
                <div className="grid gap-2 md:grid-cols-2">
                  {models.map((model) => {
                    const checked = selectedCanonicalSet.has(model.canonicalModelId);
                    const availability = modelAvailabilityById.get(model.canonicalModelId);
                    return (
                      <label
                        key={model.canonicalModelId}
                        className={`flex min-h-[64px] items-start gap-3 rounded-lg border px-3 py-2 text-[10px] ${
                          checked
                            ? 'border-blue-500/45 bg-blue-950/20 text-blue-50'
                            : 'border-white/[0.06] bg-black/20 text-gray-500'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canWriteOps || savingModelOps}
                          onChange={() => toggleCanonicalModel(model.canonicalModelId)}
                          className="mt-1"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-[11px] font-semibold text-gray-200" title={model.label}>
                            {model.label}
                          </span>
                          <span className="mt-0.5 block truncate" title={model.canonicalModelId}>
                            {model.canonicalModelId}
                          </span>
                          <span className="mt-1 flex flex-wrap gap-1">
                            <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5">
                              {canonicalStatusLabel(model.status)}
                            </span>
                            {model.defaultForModality ? (
                              <span className="rounded-md border border-emerald-500/25 bg-emerald-950/20 px-1.5 py-0.5 text-emerald-100">
                                Default
                              </span>
                            ) : null}
                            <span
                              className={`rounded-md border px-1.5 py-0.5 ${modelAvailabilityClass(availability?.status)}`}
                              title={availability?.reason || '正在检测模型可用性'}
                            >
                              {modelAvailabilityLabel(availability?.status)}
                            </span>
                          </span>
                          {availability && !availability.workspaceSelectable ? (
                            <span className="mt-1 block truncate text-[10px] text-amber-200" title={availability.reason}>
                              {availability.reason}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            disabled={routeTestingId === model.canonicalModelId}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void runModelRouteTest(model.canonicalModelId);
                            }}
                            className="mt-2 rounded-md border border-white/[0.08] bg-black/20 px-2 py-1 text-[10px] text-gray-300 disabled:opacity-40"
                          >
                            {routeTestingId === model.canonicalModelId ? 'Testing...' : 'Test Route'}
                          </button>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((row) => {
          const authFields = providerAuthFields(row.provider);
          const rowProvider = getProviderCatalogEntry(row.provider);
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
                    <span className="font-semibold">{provider.shortName}</span>
                    <span className="ml-2 text-gray-500">{provider.authSchemes[0]?.label || '凭据'}</span>
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

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {authFields.length ? (
                  authFields.map((field) => {
                    const preview = fieldCurrentPreview(row, field);
                    const preserveExisting = field.storage === 'secret' ? row.hasSecret : row.hasCredentials;
                    return (
                      <label key={`${row.id}:${field.key}`} className="block">
                        <span className="text-[10px] text-gray-500">
                          {field.label} {preview ? `（当前 ${preview}）` : ''}
                        </span>
                        <input
                          type={field.secret ? 'password' : 'text'}
                          value={fieldValue(row, field)}
                          onChange={(ev) =>
                            field.storage === 'secret'
                              ? updateRow(row.id, { secret: ev.target.value })
                              : updateCredential(row.id, field.key, ev.target.value)
                          }
                          disabled={!canWrite || saving}
                          placeholder={preserveExisting ? `留空则保留现有 ${field.label}` : field.placeholder || `填写 ${field.label}`}
                          className="mt-1 w-full rounded-lg border border-[#2e2e32] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40"
                        />
                      </label>
                    );
                  })
                ) : (
                  <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-3 text-[11px] text-gray-500">
                    {rowProvider?.displayName || row.provider} 当前使用站点代理凭据。
                  </div>
                )}
              </div>

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
                  onClick={() => void runSmokeTest(row)}
                  className="rounded-lg border border-blue-900/50 bg-blue-950/25 px-3 py-2 text-[11px] text-blue-100 disabled:opacity-40"
                >
                  测试
                </button>
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
