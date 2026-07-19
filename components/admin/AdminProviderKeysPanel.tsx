import React from 'react';
import {
  clearAdminAiGatewayOpsControl,
  fetchAdminAiGatewayOpsControl,
} from '../../services/adminClient';
import type { AiGatewayOpsControlConfig } from '../../services/aiJobsClient';
import {
  applyAdminProviderKeyHealthAutomation,
  cooldownAdminProviderKey,
  fetchAdminModelAvailabilitySummary,
  fetchAdminModelOpsConfig,
  fetchAdminProviderKeyEvents,
  fetchAdminProviderKeyHealthSummary,
  fetchAdminProviderKeys,
  restoreAdminProviderKey,
  runAdminModelDiagnostics,
  saveAdminModelOpsConfig,
  saveAdminProviderKeys,
  smokeTestAdminProviderKey,
  testAdminModelGeneration,
  testAdminModelRoute,
  type AdminModelAvailabilitySummaryItem,
  type AdminModelGenerationTestResult,
  type AdminModelOpsConfig,
  type AdminModelRouteTestResult,
  type AdminProviderKeyEvent,
  type AdminProviderKeyHealthSummaryItem,
  type AdminProviderKeyRow,
} from '../../services/adminProviderKeysClient';
import { PERMISSIONS } from '../../services/adminPermissions';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import {
  getCanonicalModel,
  getProviderCatalogEntry,
  isProviderCatalogId,
  listCanonicalModels,
  listModelRoutes,
  listProviderModels,
  listProviderRoutes,
  providerDisplayName,
  providersForAdminConsole,
  providersForAdminKeyPool,
  refreshModelOpsConfig,
  type ModelRouteCatalogEntry,
  type ModelRouteExecutionStatus,
  type ModelRouteGatewayExecutionStatus,
  type ProviderAuthField,
  type ProviderCapabilityStatus,
  type ProviderCatalogEntry,
  type ProviderCatalogId,
  type ProviderModelCatalogEntry,
  type ProviderModelLifecycle,
  type ProviderModelStatus,
  type ProviderModality,
} from '../../services/modelRegistry';
import { useAdminStaff } from './AdminStaffContext';

const PROVIDERS = providersForAdminConsole();
const KEY_POOL_PROVIDERS = providersForAdminKeyPool();
const WORKSPACE_PUBLISH_MODALITIES: readonly ProviderModality[] = ['text', 'image', 'video', 'model3d', 'music'];
const WORKSPACE_CANONICAL_MODELS = listCanonicalModels().filter(
  (model) =>
    WORKSPACE_PUBLISH_MODALITIES.includes(model.modality) &&
    model.visibleInWorkspace &&
    model.status !== 'disabled'
);

type ModelDiagnosticLayer = 'route' | 'generation';
type ModelDiagnosticEntry = {
  layer: ModelDiagnosticLayer;
  status: 'passed' | 'failed';
  message: string;
  code?: string | null;
  providerId?: string | null;
  jobId?: string | null;
  jobStatus?: string | null;
  nextAction?: string | null;
  testedAt?: string | null;
};
type ModelDiagnosticState = Record<string, Partial<Record<ModelDiagnosticLayer, ModelDiagnosticEntry>>>;

const MODALITY_LABELS: Record<ProviderModality, string> = {
  text: '文本',
  image: '图像',
  video: '视频',
  model3d: '3D',
  music: '音乐',
  digital_human: '数字人',
};

const CAPABILITY_STATUS_ITEMS: readonly { key: keyof ProviderCapabilityStatus; label: string }[] = [
  { key: 'catalogVisible', label: '目录' },
  { key: 'keyPoolSupported', label: '密钥池' },
  { key: 'backendAdapterReady', label: '后端' },
  { key: 'platformKeyReady', label: '平台密钥' },
  { key: 'byokSupported', label: '自带密钥' },
  { key: 'modelCatalogReady', label: '模型' },
  { key: 'smokeTestReady', label: '探活' },
];

const PROVIDER_CN_NAME: Partial<Record<ProviderCatalogId, { name: string; shortName: string }>> = {
  'openai-official': { name: 'OpenAI 官方', shortName: 'OpenAI' },
  'gemini-aistudio': { name: 'Google AI Studio', shortName: 'AI Studio' },
  'vertex-site': { name: 'Google Agent Platform', shortName: 'Agent Platform' },
  toapis: { name: 'ToAPIs', shortName: 'ToAPIs' },
  vectorengine: { name: 'VectorEngine', shortName: 'VectorEngine' },
  'volcengine-ark': { name: '火山方舟', shortName: '方舟' },
  'volcengine-jimeng': { name: '火山引擎即梦', shortName: '即梦' },
  tripo: { name: 'Tripo 3D', shortName: 'Tripo' },
  'tencent-hunyuan': { name: '腾讯混元', shortName: '混元' },
};

function providerName(provider: string) {
  const id = isProviderCatalogId(provider) ? provider : null;
  return (id && PROVIDER_CN_NAME[id]?.name) || providerDisplayName(provider) || provider || '供应商';
}

function providerShortName(provider: string) {
  const id = isProviderCatalogId(provider) ? provider : null;
  return (id && PROVIDER_CN_NAME[id]?.shortName) || getProviderCatalogEntry(provider)?.shortName || providerName(provider);
}

function authFieldLabel(field: ProviderAuthField) {
  if (field.key === 'apiKey') return '接口密钥';
  if (field.key === 'baseUrl') return '接口地址';
  if (field.key === 'accessKeyId') return '访问密钥 ID';
  if (field.key === 'secretAccessKey') return '访问密钥密文';
  if (field.key === 'region') return '区域';
  if (field.key === 'secretId') return '腾讯密钥 ID';
  if (field.key === 'secretKey') return '腾讯密钥密文';
  return field.label;
}

function looksMojibake(value: string) {
  return /[�鐏鑵娣鍗鏂闊浼鍙寰鏆鏄犳]/.test(value);
}

function displayModelLabel(label: string, fallback: string) {
  const clean = String(label || '').trim();
  if (!clean || looksMojibake(clean)) return fallback;
  return clean;
}

function defaultPublishedCanonicalIds() {
  return WORKSPACE_CANONICAL_MODELS.filter((model) => model.status === 'published').map((model) => model.canonicalModelId);
}

function providerLabel(provider: string) {
  return providerName(provider);
}

function createDraft(provider: string = KEY_POOL_PROVIDERS[0]?.id || 'tripo'): AdminProviderKeyRow {
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
    (row) =>
      row.provider === provider &&
      (row.hasSecret || row.secret || row.hasCredentials || Object.keys(row.credentials || {}).length)
  ).length;
}

function rowHasCredential(row: AdminProviderKeyRow) {
  return Boolean(
    row.hasSecret ||
      row.secret ||
      row.hasCredentials ||
      Object.keys(row.credentials || {}).length ||
      Object.keys(row.credentialsPreview || {}).length
  );
}

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '-';
}

function percent(value?: number | null) {
  return `${Math.round(Math.max(0, Number(value || 0)) * 100)}%`;
}

function healthLabel(status?: string | null) {
  if (status === 'cooling_down') return '冷却中';
  if (status === 'degraded') return '异常';
  if (status === 'warning') return '观察';
  if (status === 'rate_limited') return '限流';
  if (status === 'healthy') return '健康';
  return '空闲';
}

function healthClass(status?: string | null) {
  if (status === 'cooling_down' || status === 'rate_limited') return 'border-amber-500/35 bg-amber-500/10 text-amber-100';
  if (status === 'degraded') return 'border-red-500/35 bg-red-500/10 text-red-100';
  if (status === 'warning') return 'border-yellow-500/35 bg-yellow-500/10 text-yellow-100';
  if (status === 'healthy') return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100';
  return 'border-white/10 bg-white/[0.03] text-gray-300';
}

function suggestionLabel(action?: string | null) {
  if (action === 'wait_or_restore') return '等待或恢复';
  if (action === 'cooldown_or_check_key') return '冷却或检查密钥';
  if (action === 'watch') return '继续观察';
  return '暂无';
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

function providerKeyTestModeLabel(mode?: string | null) {
  if (mode === 'real_upstream') return '上游探活';
  return '凭证检查';
}

function routeTestModeLabel(mode?: string | null) {
  if (mode === 'route_guard') return '路由检查';
  return '路由测试';
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
  if (status === 'byok_ready') return '自带密钥';
  if (status === 'requires_endpoint_mapping') return '需映射';
  if (status === 'adapter_pending') return '后端待接';
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
  if (status === 'gateway_ready') return '网关可执行';
  if (status === 'adapter_pending') return '网关待接';
  if (status === 'not_gateway_routed') return '非网关';
  return '-';
}

function gatewayExecutionClass(status?: ModelRouteGatewayExecutionStatus) {
  if (status === 'gateway_ready') return 'border-emerald-500/30 bg-emerald-950/25 text-emerald-100';
  if (status === 'adapter_pending') return 'border-purple-500/25 bg-purple-950/20 text-purple-100';
  return 'border-white/10 bg-white/[0.03] text-gray-400';
}

function canonicalStatusLabel(status?: string) {
  if (status === 'published') return '目录默认发布';
  if (status === 'draft') return '草稿';
  if (status === 'deprecated') return '已过时';
  if (status === 'disabled') return '停用';
  return '-';
}

function modelAvailabilityLabel(status?: string) {
  if (status === 'ready') return '可发布';
  if (status === 'key_missing') return '缺密钥';
  if (status === 'parameter_pending') return '参数待映射';
  if (status === 'adapter_pending') return '网关待接';
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

function diagnosticStatusClass(status?: string) {
  if (status === 'passed') return 'border-emerald-500/25 bg-emerald-950/20 text-emerald-100';
  if (status === 'failed') return 'border-red-500/25 bg-red-950/20 text-red-100';
  return 'border-white/[0.06] bg-black/20 text-gray-500';
}

function diagnosticStatusLabel(status?: string) {
  if (status === 'passed') return '通过';
  if (status === 'failed') return '失败';
  return '未测';
}

function routeDiagnosticEntry(result: AdminModelRouteTestResult): ModelDiagnosticEntry {
  return {
    layer: 'route',
    status: result.status,
    message: result.message,
    code: result.code,
    providerId: result.providerId,
    nextAction: result.nextAction || null,
    testedAt: result.testedAt,
  };
}

function generationDiagnosticEntry(result: AdminModelGenerationTestResult): ModelDiagnosticEntry {
  return {
    layer: 'generation',
    status: result.status,
    message: result.message,
    code: result.code,
    providerId: result.providerId,
    jobId: result.jobId,
    jobStatus: result.jobStatus,
    nextAction: result.nextAction || null,
    testedAt: result.testedAt,
  };
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

function Pill({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] ${className}`}>{children}</span>;
}

function StatusPill({ active, label }: { active: boolean; label: string; key?: React.Key }) {
  return (
    <Pill className={active ? 'border-emerald-500/30 bg-emerald-950/25 text-emerald-100' : 'border-white/[0.08] bg-white/[0.03] text-gray-500'}>
      {label}
    </Pill>
  );
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
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <a
          key={`${provider.id}:${link.label}`}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-white/[0.08] bg-black/20 px-2 py-1 text-[10px] text-gray-300 hover:border-blue-400/40 hover:text-blue-100"
        >
          {link.label}
        </a>
      ))}
    </div>
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

function ProviderModelRow({ model }: { model: ProviderModelCatalogEntry; key?: React.Key }) {
  const label = displayModelLabel(model.label, model.registryId || model.providerModelId);
  return (
    <div className="grid gap-2 rounded-md border border-white/[0.06] bg-black/20 px-3 py-2 text-[10px] text-gray-500 md:grid-cols-[1fr_86px_86px]">
      <div className="min-w-0">
        <div className="truncate text-[11px] font-semibold text-gray-200" title={label}>{label}</div>
        <div className="mt-0.5 truncate" title={model.providerModelId}>{model.providerModelId}</div>
      </div>
      <div>
        <div>{MODALITY_LABELS[model.modality]}</div>
        <div className="mt-0.5 text-gray-300">{model.registryId || '-'}</div>
      </div>
      <div>
        <div>{lifecycleLabel(model.lifecycle)}</div>
        <div className="mt-1">
          <Pill className={modelStatusClass(model.status)}>{modelStatusLabel(model.status)}</Pill>
        </div>
      </div>
    </div>
  );
}

function ProviderRouteRow({ route }: { route: ModelRouteCatalogEntry; key?: React.Key }) {
  const canonical = getCanonicalModel(route.canonicalModelId);
  const label = displayModelLabel(canonical?.label || '', route.canonicalModelId);
  return (
    <div className="grid gap-2 rounded-md border border-white/[0.06] bg-black/20 px-3 py-2 text-[10px] text-gray-500 md:grid-cols-[1fr_90px_76px_108px]">
      <div className="min-w-0">
        <div className="truncate text-[11px] font-semibold text-gray-200" title={label}>
          {label}
        </div>
        <div className="mt-0.5 truncate" title={route.providerModelId}>{route.providerModelId}</div>
      </div>
      <div>
        <div>{MODALITY_LABELS[route.modality]}</div>
        <div className="mt-0.5 text-gray-300">{route.channel || route.source}</div>
      </div>
      <div>
        <div>优先级</div>
        <div className="mt-0.5 text-gray-300">{route.priority}</div>
      </div>
      <div className="flex flex-wrap gap-1">
        <Pill className={routeExecutionClass(route.executionStatus)}>{routeExecutionLabel(route.executionStatus)}</Pill>
        <Pill className={gatewayExecutionClass(route.gatewayExecutionStatus)}>{gatewayExecutionLabel(route.gatewayExecutionStatus)}</Pill>
      </div>
    </div>
  );
}

const AdminProviderKeysPanel: React.FC = () => {
  const { can, isRolePreview } = useAdminStaff();
  const canReadOps = can(PERMISSIONS.AI_GATEWAY_OPS_READ);
  const canWrite = can(PERMISSIONS.AI_GATEWAY_KEYS_WRITE);
  const canWriteOps = can(PERMISSIONS.AI_GATEWAY_OPS_WRITE);
  const [rows, setRows] = React.useState<AdminProviderKeyRow[]>([]);
  const [opsControl, setOpsControl] = React.useState<AiGatewayOpsControlConfig | null>(null);
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
  const [runningPublishedDiagnostics, setRunningPublishedDiagnostics] = React.useState(false);
  const [applyingHealth, setApplyingHealth] = React.useState(false);
  const [actingId, setActingId] = React.useState('');
  const [routeTestingId, setRouteTestingId] = React.useState('');
  const [generationTestingId, setGenerationTestingId] = React.useState('');
  const [modelDiagnostics, setModelDiagnostics] = React.useState<ModelDiagnosticState>({});
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [selectedProviderId, setSelectedProviderId] = React.useState(PROVIDERS[0]?.id || 'tripo');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [res, eventRes, summaryRes, modelOpsRes, availabilityRes, opsControlRes] = await Promise.all([
        fetchAdminProviderKeys(),
        fetchAdminProviderKeyEvents({ limit: 30 }),
        fetchAdminProviderKeyHealthSummary({ windowHours: 24 }),
        fetchAdminModelOpsConfig().catch(() => null),
        fetchAdminModelAvailabilitySummary(workspaceModelAvailabilityPayload()).catch(() => null),
        canReadOps ? fetchAdminAiGatewayOpsControl().catch(() => null) : Promise.resolve(null),
      ]);
      setRows(res.keys.length ? res.keys : [createDraft()]);
      setEvents(eventRes.events || []);
      setSummary(summaryRes.summaries || []);
      setSummaryTotals(summaryRes.totals || null);
      setModelAvailability(availabilityRes?.models || []);
      setOpsControl(opsControlRes?.config || null);
      if (modelOpsRes?.config) {
        setModelOpsConfig(modelOpsRes.config);
        const allow = modelOpsRes.config.publishedCanonicalModelAllowlist;
        setSelectedCanonicalModelIds(Array.isArray(allow) ? allow : defaultPublishedCanonicalIds());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载供应商中心失败');
    } finally {
      setLoading(false);
    }
  }, [canReadOps]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const selectedCanonicalSet = React.useMemo(() => new Set(selectedCanonicalModelIds), [selectedCanonicalModelIds]);
  const modelAvailabilityById = React.useMemo(
    () => new Map(modelAvailability.map((row) => [row.canonicalModelId, row])),
    [modelAvailability]
  );
  const pausedGatewayProviders = React.useMemo(
    () => Array.from(new Set((opsControl?.disabledProviders || []).map((item) => String(item || '').trim()).filter(Boolean))),
    [opsControl]
  );
  const selectedProvider = getProviderCatalogEntry(selectedProviderId) || PROVIDERS[0];
  const selectedKeyRows = rows.filter((row) => row.provider === selectedProvider?.id);
  const totalConfiguredKeys = rows.filter(rowHasCredential).length;
  const healthySummaryCount = summary.filter((item) => item.healthStatus === 'healthy').length;
  const unhealthySummaryCount = summary.filter((item) => ['warning', 'degraded', 'rate_limited', 'cooling_down'].includes(item.healthStatus)).length;
  const publishedReadyCount = selectedCanonicalModelIds.filter((id) => modelAvailabilityById.get(id)?.workspaceSelectable).length;

  const updateRow = (id: string, patch: Partial<AdminProviderKeyRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const updateCredential = (id: string, key: string, value: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              credentials: { ...(row.credentials || {}), [key]: value },
            }
          : row
      )
    );
  };

  const refreshModelAvailability = async () => {
    const availabilityRes = await fetchAdminModelAvailabilitySummary(workspaceModelAvailabilityPayload());
    setModelAvailability(availabilityRes.models || []);
    return availabilityRes.models || [];
  };

  const addProviderKeyDraft = (provider = selectedProviderId) => {
    const nextProvider: ProviderCatalogId = KEY_POOL_PROVIDERS.some((item) => item.id === provider) && isProviderCatalogId(provider)
      ? provider
      : KEY_POOL_PROVIDERS[0]?.id || 'tripo';
    setSelectedProviderId(nextProvider);
    setRows((prev) => [...prev, createDraft(nextProvider)]);
      setMessage(`已新增 ${providerLabel(nextProvider)} 密钥卡片，请填写后保存`);
  };

  const switchProvider = (id: string, provider: string) => {
    const current = rows.find((row) => row.id === id);
    if (current && current.provider !== provider && rowHasCredential(current)) {
      setRows((prev) => [...prev, createDraft(provider)]);
      setMessage(`已为 ${providerLabel(provider)} 新增凭证卡片，原 ${providerLabel(current.provider)} 凭证已保留`);
      return;
    }
    updateRow(id, { provider, label: providerLabel(provider), secret: '', credentials: {} });
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
            Object.entries(row.credentials || {})
              .map(([key, value]) => [key, String(value || '').trim()])
              .filter(([, value]) => value)
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
      setMessage('供应商凭证已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存供应商凭证失败');
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
      const modeLabel = providerKeyTestModeLabel(res.result.mode);
      const routeLabel = res.result.route ? `，${res.result.route}` : '';
      const latencyLabel = res.result.latencyMs != null ? `，${res.result.latencyMs}ms` : '';
      setMessage(
        res.result.ok
          ? `测试通过：${res.result.label || row.label}，${modeLabel}${routeLabel}${latencyLabel}`
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

  const clearGatewayPausedProviders = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    if (!window.confirm('确认清空 AI 网关的供应商/模型暂停规则和模型替换规则？')) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const cleared = await clearAdminAiGatewayOpsControl();
      setOpsControl(cleared.config);
      setMessage('AI 网关运营暂停已清空');
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '清空 AI 网关暂停失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleCanonicalModel = (canonicalModelId: string) => {
    setSelectedCanonicalModelIds((prev) =>
      prev.includes(canonicalModelId) ? prev.filter((id) => id !== canonicalModelId) : [...prev, canonicalModelId]
    );
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
      setMessage(`已选择 ${readyIds.length} 个可发布模型`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '选择可发布模型失败');
    }
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
          `有 ${blocked.length} 个模型暂时不能发布：${blocked
            .slice(0, 4)
            .map((row) => `${row.canonicalModelId}（${row.reason}）`)
            .join('；')}${blocked.length > 4 ? '；...' : ''}`
        );
        return;
      }
      const saved = await saveAdminModelOpsConfig({ ...base, publishedCanonicalModelAllowlist: selected });
      setModelOpsConfig(saved.config);
      setSelectedCanonicalModelIds(saved.config.publishedCanonicalModelAllowlist || selected);
      await refreshModelOpsConfig();
      setMessage('工作区模型发布范围已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存工作区模型发布范围失败');
    } finally {
      setSavingModelOps(false);
    }
  };

  const runPublishedModelDiagnostics = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    setRunningPublishedDiagnostics(true);
    setError('');
    setMessage('');
    try {
      const availabilityRows: AdminModelAvailabilitySummaryItem[] = modelAvailability.length ? modelAvailability : await refreshModelAvailability();
      const availabilityById = new Map<string, AdminModelAvailabilitySummaryItem>(availabilityRows.map((row) => [row.canonicalModelId, row]));
      const targets = [];
      for (const model of WORKSPACE_CANONICAL_MODELS) {
        if (!selectedCanonicalSet.has(model.canonicalModelId)) continue;
        if (model.modality !== 'text' && model.modality !== 'image') continue;
        const availability = availabilityById.get(model.canonicalModelId);
        if (!availability?.workspaceSelectable) continue;
        const availabilityRoute = availability.routes.find((route) => route.selectable) || availability.routes[0];
        const catalogRoute = listModelRoutes(model.canonicalModelId)[0];
        targets.push({
          canonicalModelId: model.canonicalModelId,
          modality: availabilityRoute?.modality || catalogRoute?.modality || model.modality,
          providerId: availabilityRoute?.providerId || catalogRoute?.providerId,
          executionStatus: availabilityRoute?.executionStatus || catalogRoute?.executionStatus,
          requiresEndpointMapping: catalogRoute?.requiresEndpointMapping === true,
        });
      }
      if (!targets.length) {
        setError('没有可诊断的已发布文本/图像模型');
        return;
      }
      const res = await runAdminModelDiagnostics({ layers: ['route', 'generation'], models: targets });
      setModelDiagnostics((prev) => {
        const next: ModelDiagnosticState = { ...prev };
        for (const item of res.results || []) {
          next[item.canonicalModelId] = {
            ...(next[item.canonicalModelId] || {}),
            ...(item.route ? { route: routeDiagnosticEntry(item.route) } : {}),
            ...(item.generation ? { generation: generationDiagnosticEntry(item.generation) } : {}),
          };
        }
        return next;
      });
      setMessage(
        `批量诊断完成：路由 ${res.summary.route.passed}/${res.summary.route.tested} 通过，真实生成 ${res.summary.generation.passed}/${res.summary.generation.tested} 通过，创建任务 ${res.summary.generation.createdJobs} 个`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量诊断失败');
    } finally {
      setRunningPublishedDiagnostics(false);
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
      setModelDiagnostics((prev) => ({ ...prev, [canonicalModelId]: { ...(prev[canonicalModelId] || {}), route: routeDiagnosticEntry(res.result) } }));
      await refreshModelAvailability();
      if (res.result.status === 'passed') {
        setMessage(`${canonicalModelId} ${routeTestModeLabel(res.result.mode)}通过，不创建生成任务`);
      } else {
      setError(`${canonicalModelId} 路由检查失败：${res.result.message}${res.result.nextAction ? `；${res.result.nextAction}` : ''}`);
      }
    } catch (err) {
      const fallbackMessage = err instanceof Error ? err.message : '路由检查失败';
      setModelDiagnostics((prev) => ({
        ...prev,
        [canonicalModelId]: {
          ...(prev[canonicalModelId] || {}),
          route: {
            layer: 'route',
            status: 'failed',
            message: fallbackMessage,
            code: 'ADMIN_ROUTE_TEST_REQUEST_FAILED',
            providerId: availabilityRoute?.providerId || catalogRoute?.providerId || null,
            testedAt: new Date().toISOString(),
          },
        },
      }));
      setError(fallbackMessage);
    } finally {
      setRouteTestingId('');
    }
  };

  const runModelGenerationTest = async (canonicalModelId: string) => {
    const model = WORKSPACE_CANONICAL_MODELS.find((row) => row.canonicalModelId === canonicalModelId);
    if (!model) return;
    const availability = modelAvailabilityById.get(canonicalModelId);
    const availabilityRoute = availability?.routes.find((route) => route.selectable) || availability?.routes[0];
    const catalogRoute = listModelRoutes(canonicalModelId)[0];
    setGenerationTestingId(canonicalModelId);
    setError('');
    setMessage('');
    try {
      const res = await testAdminModelGeneration({
        canonicalModelId,
        modality: availabilityRoute?.modality || catalogRoute?.modality || model.modality,
        providerId: availabilityRoute?.providerId || catalogRoute?.providerId,
        executionStatus: availabilityRoute?.executionStatus || catalogRoute?.executionStatus,
        requiresEndpointMapping: catalogRoute?.requiresEndpointMapping === true,
      });
      setModelDiagnostics((prev) => ({ ...prev, [canonicalModelId]: { ...(prev[canonicalModelId] || {}), generation: generationDiagnosticEntry(res.result) } }));
      await refreshModelAvailability();
      const jobLabel = res.result.jobId ? `，任务 ${res.result.jobId}` : '';
      if (res.result.status === 'passed') {
        setMessage(`${canonicalModelId} 真实生成测试通过${jobLabel}`);
      } else {
        setError(`${canonicalModelId} 真实生成失败：${res.result.message}${jobLabel}${res.result.nextAction ? `；${res.result.nextAction}` : ''}`);
      }
    } catch (err) {
      const fallbackMessage = err instanceof Error ? err.message : '真实生成测试失败';
      setModelDiagnostics((prev) => ({
        ...prev,
        [canonicalModelId]: {
          ...(prev[canonicalModelId] || {}),
          generation: {
            layer: 'generation',
            status: 'failed',
            message: fallbackMessage,
            code: 'ADMIN_GENERATION_TEST_REQUEST_FAILED',
            providerId: availabilityRoute?.providerId || catalogRoute?.providerId || null,
            testedAt: new Date().toISOString(),
          },
        },
      }));
      setError(fallbackMessage);
    } finally {
      setGenerationTestingId('');
    }
  };

  if (loading) return <div className="text-[12px] text-gray-400">正在加载供应商中心...</div>;

  return (
    <div className="max-w-7xl space-y-4 text-gray-200">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">供应商中心</h2>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-gray-400">
            管理平台密钥、模型发布、路由检查和真实生成诊断。管理员进来后先看总览，再处理异常、添加密钥、发布可用模型。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={saving} onClick={() => void load()} className="rounded-md border border-white/10 bg-[#1b1b20] px-3 py-2 text-[11px] text-gray-200 disabled:opacity-40">
            刷新
          </button>
          <button type="button" disabled={!canWrite || saving} onClick={() => void save()} className="rounded-md bg-blue-600 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40">
            {saving ? '保存中...' : '保存密钥配置'}
          </button>
        </div>
      </div>

      {error ? <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-[12px] text-red-100">{error}</div> : null}
      {message ? <div className="rounded-md border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-[12px] text-emerald-100">{message}</div> : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-white/[0.08] bg-[#121216] p-4">
          <div className="text-[11px] text-gray-500">已接入供应商</div>
          <div className="mt-2 text-2xl font-semibold text-white">{PROVIDERS.length}</div>
          <div className="mt-1 text-[11px] text-gray-500">目录中可见的供应商</div>
        </div>
        <div className="rounded-lg border border-white/[0.08] bg-[#121216] p-4">
          <div className="text-[11px] text-gray-500">平台密钥</div>
          <div className="mt-2 text-2xl font-semibold text-white">{totalConfiguredKeys}</div>
          <div className="mt-1 text-[11px] text-gray-500">已保存或来自环境变量</div>
        </div>
        <div className="rounded-lg border border-white/[0.08] bg-[#121216] p-4">
          <div className="text-[11px] text-gray-500">工作区模型</div>
          <div className="mt-2 text-2xl font-semibold text-white">{publishedReadyCount}/{selectedCanonicalModelIds.length}</div>
          <div className="mt-1 text-[11px] text-gray-500">已选择且可发布</div>
        </div>
        <div className="rounded-lg border border-white/[0.08] bg-[#121216] p-4">
          <div className="text-[11px] text-gray-500">健康状态</div>
          <div className="mt-2 text-2xl font-semibold text-white">{healthySummaryCount}/{summary.length || 0}</div>
          <div className={`mt-1 text-[11px] ${unhealthySummaryCount ? 'text-amber-200' : 'text-gray-500'}`}>
            {unhealthySummaryCount ? `${unhealthySummaryCount} 个需要关注` : '暂无异常'}
          </div>
        </div>
      </div>

      {canReadOps && pausedGatewayProviders.length ? (
        <div className="rounded-lg border border-amber-500/35 bg-amber-950/20 p-4 text-[12px] text-amber-100">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-semibold">AI 网关当前有暂停通道</div>
              <div className="mt-1 text-amber-100/80">暂停供应商：{pausedGatewayProviders.map(providerLabel).join('、')}</div>
            </div>
            <button type="button" disabled={!canWriteOps || saving} onClick={() => void clearGatewayPausedProviders()} className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-[11px] font-semibold text-amber-50 disabled:opacity-40">
              清空暂停规则
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-3">
          <div className="rounded-lg border border-white/[0.08] bg-[#121216] p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[12px] font-semibold text-white">供应商</div>
              <button type="button" disabled={!canWrite} onClick={() => addProviderKeyDraft(selectedProvider?.id)} className="rounded-md border border-emerald-500/30 bg-emerald-950/25 px-2 py-1 text-[10px] text-emerald-100 disabled:opacity-40">
                添加密钥
              </button>
            </div>
            <div className="space-y-1.5">
              {PROVIDERS.map((provider) => {
                const selected = selectedProviderId === provider.id;
                const keyCount = providerKeyCount(rows, provider.id);
                const routeCount = listProviderRoutes(provider.id).length;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => setSelectedProviderId(provider.id)}
                    className={`block w-full rounded-md border px-3 py-2 text-left transition ${
                      selected ? 'border-blue-500/60 bg-blue-500/15' : 'border-white/[0.06] bg-black/20 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12px] font-semibold text-gray-100">{providerName(provider.id)}</span>
                      <span className="text-[10px] text-gray-500">{keyCount} 密钥</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {provider.supportedModalities.map((modality) => (
                        <span key={`${provider.id}:${modality}`} className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[9px] text-gray-400">
                          {MODALITY_LABELS[modality]}
                        </span>
                      ))}
                      <span className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[9px] text-gray-400">{routeCount} 路由</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-white/[0.08] bg-[#121216] p-3">
            <div className="text-[12px] font-semibold text-white">测试层级</div>
            <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-gray-400">
              <div><span className="text-gray-200">凭证检查：</span>只检查字段，不产生生成任务。</div>
              <div><span className="text-gray-200">上游探活：</span>调用低成本接口，例如模型列表或余额。</div>
              <div><span className="text-gray-200">路由检查：</span>确认模型、密钥、网关和后端是否能接上。</div>
              <div><span className="text-gray-200">真实生成：</span>创建最小任务，验证真实输出。</div>
            </div>
          </div>
        </aside>

        <main className="space-y-4">
          {selectedProvider ? (
            <section className="rounded-lg border border-white/[0.08] bg-[#121216] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">{providerName(selectedProvider.id)}</h3>
                  <div className="mt-1 text-[11px] text-gray-500">
                    {listProviderModels(selectedProvider.id).length} 个模型，{listProviderRoutes(selectedProvider.id).length} 条路由，{selectedKeyRows.length} 张密钥卡片
                  </div>
                  <div className="mt-2"><ProviderCapabilityMatrix provider={selectedProvider} /></div>
                </div>
                <ProviderLinks provider={selectedProvider} />
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[12px] font-semibold text-gray-200">密钥配置</div>
                    <button type="button" disabled={!canWrite} onClick={() => addProviderKeyDraft(selectedProvider.id)} className="rounded-md border border-emerald-500/30 bg-emerald-950/25 px-2 py-1 text-[10px] text-emerald-100 disabled:opacity-40">
                      添加 {providerShortName(selectedProvider.id)} 密钥
                    </button>
                  </div>
                  <div className="space-y-3">
                    {(selectedKeyRows.length ? selectedKeyRows : []).map((row) => {
                      const authFields = providerAuthFields(row.provider);
                      const rowProvider = getProviderCatalogEntry(row.provider);
                      const isEnvKey = String(row.id || '').startsWith('env_');
                      const isActing = actingId === row.id;
                      return (
                        <div key={row.id} className="rounded-md border border-white/[0.06] bg-black/20 p-3">
                          <div className="grid gap-3 md:grid-cols-[1fr_90px_90px_72px]">
                            <label className="block">
                              <span className="text-[10px] text-gray-500">名称</span>
                              <input value={row.label} onChange={(ev) => updateRow(row.id, { label: ev.target.value })} disabled={!canWrite || saving || isEnvKey} className="mt-1 w-full rounded-md border border-white/[0.08] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40" />
                            </label>
                            <label className="block">
                              <span className="text-[10px] text-gray-500">优先级</span>
                              <input inputMode="numeric" value={String(row.priority)} onChange={(ev) => updateRow(row.id, { priority: Number(ev.target.value) || 100 })} disabled={!canWrite || saving || isEnvKey} className="mt-1 w-full rounded-md border border-white/[0.08] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40" />
                            </label>
                            <label className="block">
                              <span className="text-[10px] text-gray-500">每分钟上限</span>
                              <input inputMode="numeric" value={String(row.rpm || 0)} onChange={(ev) => updateRow(row.id, { rpm: Number(ev.target.value) || 0 })} disabled={!canWrite || saving || isEnvKey} className="mt-1 w-full rounded-md border border-white/[0.08] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40" />
                            </label>
                            <label className="flex items-end gap-2 pb-2 text-[11px] text-gray-300">
                              <input type="checkbox" checked={row.enabled !== false} onChange={(ev) => updateRow(row.id, { enabled: ev.target.checked })} disabled={!canWrite || saving || isEnvKey} />
                              启用
                            </label>
                          </div>

                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            {authFields.length ? authFields.map((field) => {
                              const preview = fieldCurrentPreview(row, field);
                              const preserveExisting = field.storage === 'secret' ? row.hasSecret : row.hasCredentials;
                              return (
                                <label key={`${row.id}:${field.key}`} className="block">
                                  <span className="text-[10px] text-gray-500">{authFieldLabel(field)}{preview ? `（当前 ${preview}）` : ''}</span>
                                  <input
                                    type={field.secret ? 'password' : 'text'}
                                    value={fieldValue(row, field)}
                                    onChange={(ev) =>
                                      field.storage === 'secret'
                                        ? updateRow(row.id, { secret: ev.target.value })
                                        : updateCredential(row.id, field.key, ev.target.value)
                                    }
                                    disabled={!canWrite || saving || isEnvKey}
                                    placeholder={preserveExisting ? `留空则保留现有 ${authFieldLabel(field)}` : field.placeholder || `填写 ${authFieldLabel(field)}`}
                                    className="mt-1 w-full rounded-md border border-white/[0.08] bg-[#0a0a0c] px-3 py-2 text-[11px] text-gray-100 disabled:opacity-40"
                                  />
                                </label>
                              );
                            }) : (
                              <div className="rounded-md border border-white/[0.06] bg-black/20 px-3 py-3 text-[11px] text-gray-500">
                                {rowProvider?.displayName || row.provider} 当前使用站点代理凭证。
                              </div>
                            )}
                          </div>

                          {row.runtime ? (
                            <div className="mt-3 grid gap-2 border-t border-white/[0.06] pt-3 text-[10px] text-gray-500 md:grid-cols-3">
                              <div>状态：<span className="text-gray-300">{healthLabel(row.runtime.healthStatus)}</span></div>
                              <div>本分钟：<span className="text-gray-300">{row.runtime.currentMinuteCount ?? 0}{row.rpm ? ` / ${row.rpm}` : ''}</span></div>
                              <div>连续错误：<span className="text-gray-300">{row.runtime.consecutiveErrorCount ?? 0}</span></div>
                              <div>最近成功：<span className="text-gray-300">{fmtDate(row.runtime.lastSuccessAt)}</span></div>
                              <div>最近失败：<span className="text-gray-300">{fmtDate(row.runtime.lastErrorAt)}</span></div>
                              <div>建议：<span className="text-gray-300">{suggestionLabel(row.runtime.suggestedAction)}</span></div>
                            </div>
                          ) : null}

                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <button type="button" disabled={!canWrite || saving || isActing || isEnvKey} onClick={() => void runSmokeTest(row)} className="rounded-md border border-blue-900/50 bg-blue-950/25 px-3 py-1.5 text-[11px] text-blue-100 disabled:opacity-40">
                              测试密钥
                            </button>
                            <button type="button" disabled={!canWrite || saving || isActing || isEnvKey} onClick={() => void runKeyAction(row, 'cooldown')} className="rounded-md border border-amber-900/50 bg-amber-950/25 px-3 py-1.5 text-[11px] text-amber-100 disabled:opacity-40">
                              冷却 10 分钟
                            </button>
                            <button type="button" disabled={!canWrite || saving || isActing || isEnvKey} onClick={() => void runKeyAction(row, 'restore')} className="rounded-md border border-emerald-900/50 bg-emerald-950/25 px-3 py-1.5 text-[11px] text-emerald-100 disabled:opacity-40">
                              恢复
                            </button>
                            <button type="button" disabled={!canWrite || saving || isEnvKey} onClick={() => setRows((prev) => prev.filter((item) => item.id !== row.id))} className="rounded-md border border-red-900/50 bg-red-950/25 px-3 py-1.5 text-[11px] text-red-200 disabled:opacity-40">
                              删除
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {!selectedKeyRows.length ? (
                      <div className="rounded-md border border-dashed border-white/[0.12] bg-black/20 p-5 text-center text-[12px] text-gray-400">
                        这个供应商还没有密钥。点击“添加密钥”后保存即可接入。
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-4">
                  <div>
                    <div className="mb-2 text-[12px] font-semibold text-gray-200">模型目录</div>
                    <div className="max-h-[280px] space-y-2 overflow-auto pr-1">
                      {listProviderModels(selectedProvider.id).length ? listProviderModels(selectedProvider.id).map((model) => (
                        <ProviderModelRow key={`${model.providerId}:${model.providerModelId}:${model.registryId || ''}`} model={model} />
                      )) : <div className="rounded-md border border-white/[0.06] bg-black/20 px-3 py-4 text-[11px] text-gray-500">暂无模型目录</div>}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-[12px] font-semibold text-gray-200">执行路由</div>
                    <div className="max-h-[280px] space-y-2 overflow-auto pr-1">
                      {listProviderRoutes(selectedProvider.id).length ? listProviderRoutes(selectedProvider.id).map((route) => (
                        <ProviderRouteRow key={route.routeId} route={route} />
                      )) : <div className="rounded-md border border-white/[0.06] bg-black/20 px-3 py-4 text-[11px] text-gray-500">暂无供应商路由</div>}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border border-white/[0.08] bg-[#121216] p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">工作区模型发布</h3>
                <div className="mt-1 text-[11px] text-gray-500">
                  {selectedCanonicalModelIds.length} / {WORKSPACE_CANONICAL_MODELS.length} 个模型已选择
                  {modelOpsConfig?.updatedAt ? `，上次保存 ${fmtDate(modelOpsConfig.updatedAt)}` : ''}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!canWriteOps || savingModelOps} onClick={() => setSelectedCanonicalModelIds(WORKSPACE_CANONICAL_MODELS.map((model) => model.canonicalModelId))} className="rounded-md border border-white/10 bg-[#1b1b20] px-3 py-1.5 text-[10px] text-gray-300 disabled:opacity-40">
                  全选
                </button>
                <button type="button" disabled={!canWriteOps || savingModelOps} onClick={() => void selectPublishableModels()} className="rounded-md border border-emerald-500/25 bg-emerald-950/20 px-3 py-1.5 text-[10px] text-emerald-100 disabled:opacity-40">
                  只选可发布
                </button>
                <button type="button" disabled={!canWriteOps || savingModelOps} onClick={() => setSelectedCanonicalModelIds(defaultPublishedCanonicalIds())} className="rounded-md border border-white/10 bg-[#1b1b20] px-3 py-1.5 text-[10px] text-gray-300 disabled:opacity-40">
                  恢复目录默认
                </button>
                <button type="button" disabled={!canWriteOps || savingModelOps || runningPublishedDiagnostics || selectedCanonicalModelIds.length === 0} onClick={() => void runPublishedModelDiagnostics()} className="rounded-md border border-cyan-500/25 bg-cyan-950/20 px-3 py-1.5 text-[10px] font-semibold text-cyan-100 disabled:opacity-40">
                  {runningPublishedDiagnostics ? '诊断中...' : '批量诊断'}
                </button>
                <button type="button" disabled={!canWriteOps || savingModelOps || selectedCanonicalModelIds.length === 0} onClick={() => void savePublishedModels()} className="rounded-md bg-blue-600 px-3 py-1.5 text-[10px] font-semibold text-white disabled:opacity-40">
                  {savingModelOps ? '保存中...' : '保存发布范围'}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {WORKSPACE_PUBLISH_MODALITIES.map((modality) => {
                const models = WORKSPACE_CANONICAL_MODELS.filter((model) => model.modality === modality);
                if (!models.length) return null;
                return (
                  <div key={modality}>
                    <div className="mb-2 text-[12px] font-semibold text-gray-300">{MODALITY_LABELS[modality]}</div>
                    <div className="grid gap-2 xl:grid-cols-2">
                      {models.map((model) => {
                        const checked = selectedCanonicalSet.has(model.canonicalModelId);
                        const availability = modelAvailabilityById.get(model.canonicalModelId);
                        const canRunGenerationTest = canWriteOps && availability?.workspaceSelectable && (model.modality === 'text' || model.modality === 'image');
                        const diagnostics = modelDiagnostics[model.canonicalModelId] || {};
                        return (
                          <label key={model.canonicalModelId} className={`block rounded-md border p-3 text-[10px] ${checked ? 'border-blue-500/45 bg-blue-950/20 text-blue-50' : 'border-white/[0.06] bg-black/20 text-gray-500'}`}>
                            <div className="flex items-start gap-3">
                              <input type="checkbox" checked={checked} disabled={!canWriteOps || savingModelOps} onChange={() => toggleCanonicalModel(model.canonicalModelId)} className="mt-1" />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[12px] font-semibold text-gray-200" title={displayModelLabel(model.label, model.canonicalModelId)}>
                                  {displayModelLabel(model.label, model.canonicalModelId)}
                                </div>
                                <div className="mt-0.5 truncate text-gray-500" title={model.canonicalModelId}>{model.canonicalModelId}</div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  <Pill className="border-white/[0.08] bg-white/[0.03] text-gray-300">{canonicalStatusLabel(model.status)}</Pill>
                                  {model.defaultForModality ? <Pill className="border-emerald-500/25 bg-emerald-950/20 text-emerald-100">默认</Pill> : null}
                                  <Pill className={modelAvailabilityClass(availability?.status)}>{modelAvailabilityLabel(availability?.status)}</Pill>
                                </div>
                                {availability && !availability.workspaceSelectable ? (
                                  <div className="mt-1 truncate text-[10px] text-amber-200" title={availability.reason}>{availability.reason}</div>
                                ) : null}
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  <button type="button" disabled={routeTestingId === model.canonicalModelId} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void runModelRouteTest(model.canonicalModelId); }} className="rounded-md border border-white/[0.08] bg-black/20 px-2 py-1 text-[10px] text-gray-300 disabled:opacity-40">
                                    {routeTestingId === model.canonicalModelId ? '检查中...' : '路由检查'}
                                  </button>
                                  <button type="button" disabled={!canRunGenerationTest || generationTestingId === model.canonicalModelId} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void runModelGenerationTest(model.canonicalModelId); }} className="rounded-md border border-emerald-500/25 bg-emerald-950/20 px-2 py-1 text-[10px] text-emerald-100 disabled:opacity-40">
                                    {generationTestingId === model.canonicalModelId ? '生成中...' : '真实生成'}
                                  </button>
                                </div>
                                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                                  {[
                                    { key: 'route' as const, label: '路由', entry: diagnostics.route },
                                    { key: 'generation' as const, label: '生成', entry: diagnostics.generation },
                                  ].map((item) => (
                                    <div key={`${model.canonicalModelId}:${item.key}`} className={`min-w-0 rounded-md border px-2 py-1 ${diagnosticStatusClass(item.entry?.status)}`} title={item.entry ? [item.entry.message, item.entry.code, item.entry.providerId, item.entry.jobId, item.entry.nextAction].filter(Boolean).join('\n') : `${item.label}未测试`}>
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-semibold">{item.label}</span>
                                        <span>{diagnosticStatusLabel(item.entry?.status)}</span>
                                      </div>
                                      <div className="mt-0.5 truncate text-[9px] opacity-80">{item.entry ? item.entry.jobId || item.entry.code || item.entry.providerId || item.entry.message : '暂无结果'}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-white/[0.08] bg-[#121216] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">健康报表</h3>
                <p className="mt-1 text-[11px] text-gray-500">最近 24 小时的成功、失败、限流、冷却和恢复事件。</p>
              </div>
              <button type="button" disabled={!canWrite || saving || applyingHealth} onClick={() => void runHealthAutomation()} className="rounded-md border border-amber-900/50 bg-amber-950/25 px-3 py-1.5 text-[10px] text-amber-100 disabled:opacity-40">
                {applyingHealth ? '应用中...' : '应用健康建议'}
              </button>
            </div>
            {summaryTotals ? (
              <div className="mb-3 flex flex-wrap gap-2 text-[10px] text-gray-400">
                <Pill className="border-white/[0.06] bg-black/20">事件 {summaryTotals.totalEvents}</Pill>
                <Pill className="border-white/[0.06] bg-black/20">成功 {summaryTotals.successCount}</Pill>
                <Pill className="border-white/[0.06] bg-black/20">失败 {summaryTotals.errorCount}</Pill>
                <Pill className="border-white/[0.06] bg-black/20">限流 {summaryTotals.status429Count}</Pill>
                <Pill className="border-white/[0.06] bg-black/20">服务错误 {summaryTotals.status5xxCount}</Pill>
                <Pill className="border-white/[0.06] bg-black/20">失败率 {percent(summaryTotals.failureRate)}</Pill>
              </div>
            ) : null}
            {summary.length ? (
              <div className="grid gap-2 xl:grid-cols-2">
                {summary.map((item) => (
                  <div key={item.providerKeyId || `${item.provider}-${item.label}`} className="rounded-md border border-white/[0.06] bg-black/20 p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-semibold text-gray-200" title={item.label || item.providerKeyId || ''}>{item.label || item.providerKeyId || '-'}</div>
                        <div className="mt-0.5 text-[10px] text-gray-500">{providerLabel(item.provider || '')}</div>
                      </div>
                      <Pill className={healthClass(item.healthStatus)}>{healthLabel(item.healthStatus)}</Pill>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-[10px] text-gray-500">
                      <div>成功 <span className="text-gray-300">{item.successCount}</span></div>
                      <div>失败 <span className="text-gray-300">{item.errorCount}</span></div>
                      <div>限流 <span className="text-gray-300">{item.status429Count}</span></div>
                      <div>冷却 <span className="text-gray-300">{item.cooldownCount}</span></div>
                    </div>
                    {item.lastErrorMessage ? (
                      <div className="mt-2 truncate rounded-md bg-red-950/20 px-2 py-1 text-[10px] text-red-100" title={item.lastErrorMessage}>
                        {item.lastErrorStatus ? `状态 ${item.lastErrorStatus} ` : ''}{item.lastErrorMessage}
                      </div>
                    ) : null}
                    {item.automation?.recommended ? (
                      <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-950/20 px-2 py-1 text-[10px] text-amber-100">
                        建议：冷却 {item.automation.ttlMinutes} 分钟，避免异常密钥继续接任务。
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-white/[0.06] bg-black/20 px-3 py-4 text-[11px] text-gray-500">暂无健康报表数据</div>
            )}
          </section>

          <section className="rounded-lg border border-white/[0.08] bg-[#121216] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-white">最近事件</h3>
              <button type="button" disabled={saving} onClick={() => void load()} className="rounded-md border border-white/10 bg-[#1b1b20] px-3 py-1.5 text-[10px] text-gray-300 disabled:opacity-40">
                刷新事件
              </button>
            </div>
            {events.length ? (
              <div className="space-y-2">
                {events.map((event) => (
                  <div key={event.id} className="grid gap-2 rounded-md border border-white/[0.06] bg-black/20 px-3 py-2 text-[10px] text-gray-500 md:grid-cols-[90px_130px_1fr_140px]">
                    <div>
                      <div className="text-gray-300">{eventTypeLabel(event.type)}</div>
                      <div>{event.status ? `状态 ${event.status}` : event.retryable ? '可重试' : '-'}</div>
                    </div>
                    <div>
                      <div className="truncate text-gray-300" title={event.label || event.providerKeyId || ''}>{event.label || event.providerKeyId || '-'}</div>
                      <div>{providerLabel(event.provider || '')}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-gray-300" title={event.reason || event.message || ''}>{event.reason || event.message || '-'}</div>
                      <div>连续错误 {event.consecutiveErrorCount ?? 0}，自动冷却 {event.autoCooldownCount ?? 0}</div>
                    </div>
                    <div className="text-gray-400">{fmtDate(event.createdAt)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-white/[0.06] bg-black/20 px-3 py-4 text-[11px] text-gray-500">暂无健康事件</div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
};

export default AdminProviderKeysPanel;
