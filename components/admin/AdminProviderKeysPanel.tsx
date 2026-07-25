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
  fetchAdminModelScreenDiagnosis,
  saveAdminModelOpsConfig,
  saveAdminProviderKeys,
  smokeTestAdminProviderKey,
  testAdminModelGeneration,
  testAdminModelRoute,
  type AdminModelDiagnosticsRunInput,
  type AdminModelDiagnosticsRunResultItem,
  type AdminModelGenerationTestInput,
  type AdminModelAvailabilityRouteSummary,
  type AdminModelAvailabilitySummaryItem,
  type AdminModelGenerationTestResult,
  type AdminGatewayRouteConfig,
  type AdminModelOpsConfig,
  type AdminOpenAiCompatibleProviderConfig,
  type AdminModelRouteTestInput,
  type AdminModelRouteTestResult,
  type AdminModelScreenDiagnosisResult,
  type AdminProviderKeyEvent,
  type AdminProviderKeyHealthSummaryItem,
  type AdminProviderKeyRow,
} from '../../services/adminProviderKeysClient';
import { PERMISSIONS } from '../../services/adminPermissions';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import {
  evaluatePublishDiagnosisGate,
  formatPublishDiagnosisGateMessage,
} from '../../services/aiGatewayRolloutControl';
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
import { CustomDropdown } from '../ui/CustomDropdown';
import { useAdminStaff } from './AdminStaffContext';

const PROVIDERS = providersForAdminConsole();
const KEY_POOL_PROVIDERS = providersForAdminKeyPool();
const WORKSPACE_PUBLISH_MODALITIES: readonly ProviderModality[] = ['text', 'image', 'video', 'model3d'];
const GENERATION_TEST_MODALITIES = new Set<ProviderModality>(['text', 'image', 'video', 'model3d']);
const WORKSPACE_CANONICAL_MODELS = listCanonicalModels().filter(
  (model) =>
    WORKSPACE_PUBLISH_MODALITIES.includes(model.modality) &&
    model.visibleInWorkspace &&
    model.status !== 'disabled'
);

type ModelDiagnosticLayer = 'route' | 'generation' | 'screen';
type ModelDiagnosticEntry = {
  layer: ModelDiagnosticLayer;
  status: 'passed' | 'failed' | 'partial' | 'ready' | 'blocked';
  message: string;
  code?: string | null;
  providerId?: string | null;
  providerIds?: string[];
  routeIds?: string[];
  priority?: number | null;
  jobId?: string | null;
  jobStatus?: string | null;
  missingEndpointFields?: string[];
  nextAction?: string | null;
  testedAt?: string | null;
  screen?: AdminModelScreenDiagnosisResult;
};
type ModelDiagnosticState = Record<string, Partial<Record<ModelDiagnosticLayer, ModelDiagnosticEntry>>>;
type AdminBindingOverride = {
  bindingId: string;
  enabled?: boolean;
  priority?: number;
  fallbackPolicy?: RouteFallbackPolicy;
  fallbackMaxAttempts?: number;
  upstreamOverride?: string;
};
type RoutePriorityDraft = Record<string, number>;
type RouteFallbackPolicy = 'none' | 'on_error' | 'on_rate_limit' | 'on_timeout' | 'on_provider_degraded' | 'cost_optimized' | 'quality_first';
type RouteFallbackPolicyDraft = Record<string, RouteFallbackPolicy>;
type RouteFallbackMaxAttemptsDraft = Record<string, number>;
type EndpointMappingDraftRow = {
  routeId: string;
  requestPath?: string;
  pollPath?: string;
  statusPath?: string;
  artifactPath?: string;
  taskIdPath?: string;
  errorPath?: string;
  upstreamOverride?: string;
  priority?: number;
  enabled?: boolean;
};
type EndpointMappingDraft = Record<string, EndpointMappingDraftRow>;
type PublishedModelDiagnosticsTarget = AdminModelDiagnosticsRunInput['models'][number];
type ModelDiagnosticsTarget = AdminModelRouteTestInput & AdminModelGenerationTestInput;

const ROUTE_FALLBACK_POLICY_OPTIONS: readonly { value: RouteFallbackPolicy; label: string; title: string }[] = [
  { value: 'none', label: '不切换', title: '失败后不自动换下一家' },
  { value: 'on_error', label: '错误切换', title: '供应商报错时换下一家' },
  { value: 'on_rate_limit', label: '限流切换', title: '遇到 429 或额度限流时换下一家' },
  { value: 'on_timeout', label: '超时切换', title: '请求超时时换下一家' },
  { value: 'on_provider_degraded', label: '降级切换', title: '供应商 5xx 或网络异常时换下一家' },
  { value: 'cost_optimized', label: '成本优先', title: '可重试失败时切换，后续接入成本排序' },
  { value: 'quality_first', label: '质量优先', title: '可重试失败时切换，后续接入质量排序' },
];
const ROUTE_FALLBACK_POLICY_SET = new Set<RouteFallbackPolicy>(ROUTE_FALLBACK_POLICY_OPTIONS.map((item) => item.value));
const ENDPOINT_MAPPING_FIELDS: readonly { key: keyof EndpointMappingDraftRow; label: string; placeholder: string; required?: boolean }[] = [
  { key: 'requestPath', label: '提交路径', placeholder: '/v1/video/generations', required: true },
  { key: 'pollPath', label: '轮询路径', placeholder: '/v1/tasks/{id}', required: true },
  { key: 'statusPath', label: '状态字段', placeholder: 'data.status', required: true },
  { key: 'artifactPath', label: '产物字段', placeholder: 'data.output.video_url', required: true },
  { key: 'taskIdPath', label: '任务字段', placeholder: 'data.taskId' },
  { key: 'errorPath', label: '错误字段', placeholder: 'error.message' },
  { key: 'upstreamOverride', label: '上游模型', placeholder: 'provider-specific-model-id' },
];

const MODALITY_LABELS: Record<ProviderModality, string> = {
  text: '文本',
  image: '图像',
  video: '视频',
  model3d: '3D',
  music: '音乐',
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

function modelEndpointMappingLabel(model: ProviderModelCatalogEntry): string {
  const required = Array.isArray(model.endpointMapping?.required) ? model.endpointMapping.required.filter(Boolean) : [];
  if (!model.requiresEndpointMapping && !required.length) return '';
  return required.length ? `缺 ${required.join(' / ')}` : '缺 endpoint 映射';
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
  if (status === 'ready') return '网关可执行';
  if (status === 'adapter_pending') return '网关待接';
  if (status === 'not_published') return '未发布/无路由';
  return '-';
}

function gatewayExecutionClass(status?: ModelRouteGatewayExecutionStatus) {
  if (status === 'ready') return 'border-emerald-500/30 bg-emerald-950/25 text-emerald-100';
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
  if (status === 'route_ambiguous') return '路线冲突';
  if (status === 'route_not_executable') return '路线暂停';
  if (status === 'route_not_found') return '无路由';
  return '检测中';
}

function modelAvailabilityClass(status?: string) {
  if (status === 'ready') return 'border-emerald-500/30 bg-emerald-950/25 text-emerald-100';
  if (status === 'key_missing') return 'border-amber-500/30 bg-amber-950/25 text-amber-100';
  if (status === 'parameter_pending') return 'border-orange-500/30 bg-orange-950/25 text-orange-100';
  if (status === 'adapter_pending') return 'border-purple-500/25 bg-purple-950/20 text-purple-100';
  if (status === 'route_ambiguous') return 'border-red-500/30 bg-red-950/25 text-red-100';
  if (status === 'route_not_executable') return 'border-red-500/25 bg-red-950/20 text-red-100';
  if (status === 'route_not_found') return 'border-red-500/25 bg-red-950/20 text-red-100';
  return 'border-white/10 bg-white/[0.03] text-gray-400';
}

function selectedModelAvailabilityIssueText(selectedIds: string[], availabilityById: Map<string, AdminModelAvailabilitySummaryItem>) {
  const rows = selectedIds.map((id) => availabilityById.get(id)).filter((row): row is AdminModelAvailabilitySummaryItem => Boolean(row));
  const ambiguous = rows.filter((row) => row.reasonCode === 'route_ambiguous').length;
  if (ambiguous) return `${ambiguous} 个路线冲突`;
  const parameterPending = rows.filter((row) => row.reasonCode === 'parameter_pending').length;
  if (parameterPending) return `${parameterPending} 个待映射`;
  const keyMissing = rows.filter((row) => row.reasonCode === 'key_missing').length;
  if (keyMissing) return `${keyMissing} 个缺密钥`;
  const adapterPending = rows.filter((row) => row.reasonCode === 'adapter_pending').length;
  if (adapterPending) return `${adapterPending} 个待接入`;
  const routeNotExecutable = rows.filter((row) => row.reasonCode === 'route_not_executable').length;
  if (routeNotExecutable) return `${routeNotExecutable} 个路线暂停`;
  const routeMissing = rows.filter((row) => row.reasonCode === 'route_not_found').length;
  if (routeMissing) return `${routeMissing} 个缺路由`;
  return '已选择且可发布';
}

function modelAvailabilityIssueText(row?: AdminModelAvailabilitySummaryItem | null) {
  if (!row) return '';
  if (row.reasonCode === 'route_ambiguous') {
    const providers = Array.isArray(row.providers) && row.providers.length ? `：${row.providers.join(' / ')}` : '';
    return `路线冲突${providers}`;
  }
  return row.reason || modelAvailabilityLabel(row.status);
}

function modelAvailabilityIssueTitle(row?: AdminModelAvailabilitySummaryItem | null) {
  if (!row) return '';
  const lines = [row.reason];
  if (Array.isArray(row.providers) && row.providers.length) lines.push(`providers: ${row.providers.join(', ')}`);
  if (Array.isArray(row.routeIds) && row.routeIds.length) lines.push(`routes: ${row.routeIds.join(', ')}`);
  if (Number.isFinite(Number(row.priority))) lines.push(`priority: ${row.priority}`);
  return lines.filter(Boolean).join('\n');
}

function routeFallbackPolicyLabel(value?: string | null) {
  if (value === 'none') return '不切换';
  if (value === 'on_error') return '错误切换';
  if (value === 'on_rate_limit') return '限流切换';
  if (value === 'on_timeout') return '超时切换';
  if (value === 'on_provider_degraded') return '降级切换';
  if (value === 'cost_optimized') return '成本优先';
  if (value === 'quality_first') return '质量优先';
  return value || '';
}

function routeFallbackSummaryText(route: AdminModelAvailabilityRouteSummary | undefined) {
  if (!route?.fallbackPolicy && !route?.fallbackMaxAttempts) return '';
  const parts = [
    route.fallbackPolicy ? routeFallbackPolicyLabel(route.fallbackPolicy) : '',
    route.fallbackMaxAttempts ? `最多 ${route.fallbackMaxAttempts} 次` : '',
  ].filter(Boolean);
  return parts.join(' / ');
}

function diagnosticStatusClass(status?: string) {
  if (status === 'passed' || status === 'ready') return 'border-emerald-500/25 bg-emerald-950/20 text-emerald-100';
  if (status === 'failed' || status === 'blocked') return 'border-red-500/25 bg-red-950/20 text-red-100';
  if (status === 'partial') return 'border-amber-500/25 bg-amber-950/20 text-amber-100';
  return 'border-white/[0.06] bg-black/20 text-gray-500';
}

function diagnosticStatusLabel(status?: string, layer?: 'screen' | 'route' | 'generation' | 'key') {
  if (status === 'passed' || status === 'ready') {
    if (layer === 'route') return '可路由';
    if (layer === 'generation') return '可生成';
    if (layer === 'screen') return '总览就绪';
    if (layer === 'key') return '密钥可用';
    return '通过';
  }
  if (status === 'failed' || status === 'blocked') return '失败';
  if (status === 'partial') return '部分';
  return '未测';
}

function checkKindLabelsMutualExclusive(texts: string[]) {
  const joined = texts.join('\n');
  const hasRouteOnly = /可路由|路由检查通过|不创建生成/.test(joined);
  const hasGeneration = /可生成|真实生成测试通过|会计费/.test(joined);
  const hasKey = /密钥可用|Key Check|凭证检查通过/.test(joined);
  return { hasRouteOnly, hasGeneration, hasKey, mutualExclusive: !(hasRouteOnly && hasGeneration && /可生成/.test(joined) && /路由检查通过且可生成/.test(joined)) };
}

function diagnosticDetailText(entry?: ModelDiagnosticEntry) {
  if (!entry) return '';
  const missing = Array.isArray(entry.missingEndpointFields) && entry.missingEndpointFields.length
    ? `缺 ${entry.missingEndpointFields.join(' / ')}`
    : '';
  const conflict = Array.isArray(entry.providerIds) && entry.providerIds.length
    ? `冲突 ${entry.providerIds.join(' / ')}`
    : '';
  return missing || conflict || entry.jobId || entry.code || entry.providerId || entry.message || '';
}

function diagnosticTitle(entry: ModelDiagnosticEntry | undefined, fallback: string) {
  if (!entry) return fallback;
  return [
    entry.message,
    entry.code,
    entry.providerId,
    Array.isArray(entry.providerIds) && entry.providerIds.length ? `providers: ${entry.providerIds.join(', ')}` : '',
    Array.isArray(entry.routeIds) && entry.routeIds.length ? `routes: ${entry.routeIds.join(', ')}` : '',
    Number.isFinite(Number(entry.priority)) ? `priority: ${entry.priority}` : '',
    entry.jobId,
    Array.isArray(entry.missingEndpointFields) && entry.missingEndpointFields.length ? `missing: ${entry.missingEndpointFields.join(', ')}` : '',
    entry.nextAction,
  ].filter(Boolean).join('\n');
}

function routeTestFailureMessage(canonicalModelId: string, result: AdminModelRouteTestResult): string {
  const details: string[] = [];
  if (Array.isArray(result.missingEndpointFields) && result.missingEndpointFields.length) {
    details.push(`缺 ${result.missingEndpointFields.join(' / ')}`);
  }
  if (Array.isArray(result.providers) && result.providers.length) {
    details.push(`冲突供应商 ${result.providers.join(' / ')}`);
  }
  if (Array.isArray(result.routeIds) && result.routeIds.length) {
    details.push(`冲突路线 ${result.routeIds.join(' / ')}`);
  }
  if (Number.isFinite(Number(result.priority))) {
    details.push(`优先级 ${result.priority}`);
  }
  if (result.nextAction) details.push(result.nextAction);
  return `${canonicalModelId} 路由检查失败：${result.message}${details.length ? `；${details.join('；')}` : ''}`;
}

function screenDiagnosisSummaryText(result?: AdminModelScreenDiagnosisResult | null): string {
  if (!result) return '';
  const next = Array.isArray(result.nextActions) && result.nextActions[0]?.label ? result.nextActions[0].label : '';
  const failure = result.recentFailures?.byStage?.[0]
    ? `失败主因 ${result.recentFailures.byStage[0].key}×${result.recentFailures.byStage[0].count}`
    : '';
  const block = result.routeDecision?.blockingReason?.code || '';
  const scope = '只读总览（≠可生成）';
  return [result.status === 'ready' ? '一屏诊断：Key/Route 看起来就绪' : '一屏诊断：阻塞', scope, block, failure, next].filter(Boolean).join('；');
}

function modelDiagnosticsIssueSummaryText(results: AdminModelDiagnosticsRunResultItem[] | undefined) {
  const classify = (entry: AdminModelRouteTestResult | AdminModelGenerationTestResult) => {
    const code = String(entry.code || '');
    const message = String(entry.message || '');
    if (code === 'AI_GATEWAY_MODEL_ROUTE_AMBIGUOUS' || (Array.isArray(entry.routeIds) && entry.routeIds.length > 1)) {
      return 'ambiguous';
    }
    if (
      code === 'AI_GATEWAY_MODEL_PARAMETER_PENDING' ||
      (Array.isArray(entry.missingEndpointFields) && entry.missingEndpointFields.length) ||
      /endpoint mapping|parameter/i.test(message)
    ) {
      return 'missingEndpoint';
    }
    if (
      code === 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE' ||
      code === 'AI_GATEWAY_PROVIDER_KEY_MISSING' ||
      /no enabled .*key|no usable .*key|provider key/i.test(message)
    ) {
      return 'keyMissing';
    }
    if (code === 'AI_GATEWAY_MODEL_ADAPTER_PENDING' || code === 'AI_GATEWAY_MODEL_ROUTE_NOT_EXECUTABLE') {
      return 'adapterPending';
    }
    if (code === 'AI_GATEWAY_MODEL_ROUTE_NOT_FOUND' || code === 'AI_GATEWAY_NO_PROVIDER_ROUTE') {
      return 'routeMissing';
    }
    return '';
  };
  const counts = {
    ambiguous: 0,
    missingEndpoint: 0,
    keyMissing: 0,
    adapterPending: 0,
    routeMissing: 0,
  };
  for (const item of Array.isArray(results) ? results : []) {
    for (const entry of [item.route, item.generation]) {
      if (!entry || entry.status !== 'failed') continue;
      const kind = classify(entry);
      if (kind && kind in counts) counts[kind as keyof typeof counts] += 1;
    }
  }
  const parts = [
    counts.ambiguous ? `${counts.ambiguous} 个路线冲突` : '',
    counts.missingEndpoint ? `${counts.missingEndpoint} 个待映射` : '',
    counts.keyMissing ? `${counts.keyMissing} 个缺密钥` : '',
    counts.adapterPending ? `${counts.adapterPending} 个待接入` : '',
    counts.routeMissing ? `${counts.routeMissing} 个缺路由` : '',
  ].filter(Boolean);
  return parts.length ? `；需处理：${parts.join('，')}` : '';
}

function routeDiagnosticEntry(result: AdminModelRouteTestResult): ModelDiagnosticEntry {
  return {
    layer: 'route',
    status: result.status,
    message: result.message,
    code: result.code,
    providerId: result.providerId,
    providerIds: Array.isArray(result.providers) ? result.providers.filter(Boolean) : [],
    routeIds: Array.isArray(result.routeIds) ? result.routeIds.filter(Boolean) : [],
    priority: Number.isFinite(Number(result.priority)) ? Number(result.priority) : null,
    missingEndpointFields: Array.isArray(result.missingEndpointFields) ? result.missingEndpointFields : [],
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
    providerIds: Array.isArray(result.providers) ? result.providers.filter(Boolean) : [],
    routeIds: Array.isArray(result.routeIds) ? result.routeIds.filter(Boolean) : [],
    priority: Number.isFinite(Number(result.priority)) ? Number(result.priority) : null,
    jobId: result.jobId,
    jobStatus: result.jobStatus,
    missingEndpointFields: Array.isArray(result.missingEndpointFields) ? result.missingEndpointFields : [],
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
        routeId: route.routeId,
        providerId: route.providerId,
        modality: route.modality,
        executionStatus: route.executionStatus,
        requiresEndpointMapping: route.requiresEndpointMapping === true,
      })),
    })),
  };
}

function parseEndpointMappingDraftRouteId(routeId: string) {
  const parts = String(routeId || '').trim().split(':');
  if (parts.length < 3) return null;
  const modality = parts[parts.length - 1] as ProviderModality;
  const providerId = parts[parts.length - 2];
  const canonicalModelId = parts.slice(0, -2).join(':');
  if (!canonicalModelId || !providerId || !modality) return null;
  return { canonicalModelId, providerId, modality };
}

function enabledEndpointMappingDraftRoutes(
  canonicalModelId: string,
  modality: ProviderModality,
  endpointMappingDraft: EndpointMappingDraft
) {
  return Object.values(endpointMappingDraft)
    .filter((row) => row.enabled === true)
    .map((row) => parseEndpointMappingDraftRouteId(row.routeId))
    .filter((row): row is NonNullable<ReturnType<typeof parseEndpointMappingDraftRouteId>> =>
      Boolean(row && row.canonicalModelId === canonicalModelId && row.modality === modality)
    );
}

function buildModelDiagnosticsTarget(
  model: (typeof WORKSPACE_CANONICAL_MODELS)[number],
  availability: AdminModelAvailabilitySummaryItem | undefined,
  endpointMappingDraft: EndpointMappingDraft = {}
): ModelDiagnosticsTarget {
  const catalogRoutes = listModelRoutes(model.canonicalModelId);
  const endpointDraftRoutes = enabledEndpointMappingDraftRoutes(model.canonicalModelId, model.modality, endpointMappingDraft);
  const endpointCatalogRoutes = catalogRoutes.filter((route) => route.requiresEndpointMapping && route.modality === model.modality);
  if (endpointDraftRoutes.length > 1 || endpointCatalogRoutes.length > 1) {
    return {
      canonicalModelId: model.canonicalModelId,
      modality: model.modality,
      executionStatus: 'requires_endpoint_mapping',
      requiresEndpointMapping: true,
    };
  }
  const availabilityRoute = availability?.routes.find((route) => route.selectable) || availability?.routes[0];
  const catalogRoute =
    listModelRoutes(model.canonicalModelId).find((route) => route.routeId === availabilityRoute?.routeId) ||
    catalogRoutes[0];
  return {
    routeId: availabilityRoute?.routeId || catalogRoute?.routeId,
    canonicalModelId: model.canonicalModelId,
    modality: availabilityRoute?.modality || catalogRoute?.modality || model.modality,
    providerId: availabilityRoute?.providerId || catalogRoute?.providerId,
    executionStatus: availabilityRoute?.executionStatus || catalogRoute?.executionStatus,
    requiresEndpointMapping: catalogRoute?.requiresEndpointMapping === true,
  };
}

function buildPublishedModelDiagnosticsTargets(
  models: typeof WORKSPACE_CANONICAL_MODELS,
  selectedCanonicalSet: Set<string>,
  availabilityRows: AdminModelAvailabilitySummaryItem[],
  endpointMappingDraft: EndpointMappingDraft = {}
): PublishedModelDiagnosticsTarget[] {
  const availabilityById = new Map<string, AdminModelAvailabilitySummaryItem>(availabilityRows.map((row) => [row.canonicalModelId, row]));
  const targets: PublishedModelDiagnosticsTarget[] = [];
  for (const model of models) {
    if (!selectedCanonicalSet.has(model.canonicalModelId)) continue;
    if (!GENERATION_TEST_MODALITIES.has(model.modality)) continue;
    targets.push(buildModelDiagnosticsTarget(model, availabilityById.get(model.canonicalModelId), endpointMappingDraft));
  }
  return targets;
}

function routeRole(route: ModelRouteCatalogEntry): 'text' | 'image' | null {
  if (route.modality === 'text') return 'text';
  if (route.modality === 'image') return 'image';
  return null;
}

function routeBindingId(route: ModelRouteCatalogEntry): string | null {
  const role = routeRole(route);
  if (!role || !route.channel) return null;
  return `${route.canonicalModelId}:${route.channel}:${role}`;
}

function knownRouteBindingIds(): Set<string> {
  const out = new Set<string>();
  for (const route of listModelRoutes()) {
    const id = routeBindingId(route);
    if (id) out.add(id);
  }
  return out;
}

function normalizeBindingOverrideRows(value: unknown): AdminBindingOverride[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const bindingId = String(row.bindingId || '').trim();
      if (!bindingId) return null;
      const priority = Number(row.priority);
      const fallbackPolicy = typeof row.fallbackPolicy === 'string' && ROUTE_FALLBACK_POLICY_SET.has(row.fallbackPolicy as RouteFallbackPolicy)
        ? (row.fallbackPolicy as RouteFallbackPolicy)
        : null;
      const fallbackMaxAttempts = Number(row.fallbackMaxAttempts);
      return {
        bindingId,
        ...(row.enabled !== undefined ? { enabled: row.enabled === true } : {}),
        ...(Number.isFinite(priority) ? { priority: Math.floor(priority) } : {}),
        ...(fallbackPolicy ? { fallbackPolicy } : {}),
        ...(Number.isFinite(fallbackMaxAttempts) ? { fallbackMaxAttempts: Math.max(1, Math.min(5, Math.floor(fallbackMaxAttempts))) } : {}),
        ...(typeof row.upstreamOverride === 'string' && row.upstreamOverride.trim()
          ? { upstreamOverride: row.upstreamOverride.trim() }
          : {}),
      };
    })
    .filter((row): row is AdminBindingOverride => Boolean(row));
}

function routePriorityDraftFromConfig(config?: AdminModelOpsConfig | null): RoutePriorityDraft {
  const routeIds = knownRouteBindingIds();
  const out: RoutePriorityDraft = {};
  for (const row of normalizeBindingOverrideRows(config?.bindingOverrides)) {
    if (!routeIds.has(row.bindingId) || row.priority == null) continue;
    out[row.bindingId] = row.priority;
  }
  // A1: gatewayRouteConfigs priority wins when present for the same catalog binding.
  for (const route of listModelRoutes()) {
    const bindingId = routeBindingId(route);
    if (!bindingId || !routeIds.has(bindingId)) continue;
    const match = normalizeGatewayRouteConfigRows(config?.gatewayRouteConfigs).find(
      (row) =>
        row.canonicalModelId === route.canonicalModelId &&
        row.providerId === route.providerId &&
        (!row.modality || row.modality === route.modality) &&
        row.priority != null
    );
    if (match?.priority != null) out[bindingId] = match.priority;
  }
  return out;
}

function routeFallbackPolicyDraftFromConfig(config?: AdminModelOpsConfig | null): RouteFallbackPolicyDraft {
  const routeIds = knownRouteBindingIds();
  const out: RouteFallbackPolicyDraft = {};
  for (const row of normalizeBindingOverrideRows(config?.bindingOverrides)) {
    if (!routeIds.has(row.bindingId) || !row.fallbackPolicy) continue;
    out[row.bindingId] = row.fallbackPolicy;
  }
  return out;
}

function routeFallbackMaxAttemptsDraftFromConfig(config?: AdminModelOpsConfig | null): RouteFallbackMaxAttemptsDraft {
  const routeIds = knownRouteBindingIds();
  const out: RouteFallbackMaxAttemptsDraft = {};
  for (const row of normalizeBindingOverrideRows(config?.bindingOverrides)) {
    if (!routeIds.has(row.bindingId) || !row.fallbackMaxAttempts) continue;
    out[row.bindingId] = row.fallbackMaxAttempts;
  }
  return out;
}

function gatewayRouteConfigKey(row: Pick<AdminGatewayRouteConfig, 'canonicalModelId' | 'providerId' | 'modality'>) {
  const model = String(row.canonicalModelId || '').trim();
  const provider = String(row.providerId || '').trim();
  const modality = String(row.modality || '').trim();
  if (!model || !provider) return '';
  return modality ? `${model}:${provider}:${modality}` : `${model}:${provider}`;
}

function normalizeGatewayRouteConfigRows(value: unknown): AdminGatewayRouteConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const canonicalModelId = String(row.canonicalModelId || '').trim();
      const providerId = String(row.providerId || '').trim();
      if (!canonicalModelId || !providerId) return null;
      const priority = Number(row.priority);
      const upstreamModelId =
        (typeof row.upstreamModelId === 'string' && row.upstreamModelId.trim()) ||
        (typeof row.providerModelId === 'string' && row.providerModelId.trim()) ||
        '';
      const gatewayExecutionRaw = String(row.gatewayExecutionStatus || '').trim();
      const gatewayExecutionStatus =
        gatewayExecutionRaw === 'ready' ||
        gatewayExecutionRaw === 'adapter_pending' ||
        gatewayExecutionRaw === 'not_published'
          ? (gatewayExecutionRaw as AdminGatewayRouteConfig['gatewayExecutionStatus'])
          : undefined;
      return {
        canonicalModelId,
        providerId,
        ...(typeof row.modality === 'string' && row.modality.trim() ? { modality: row.modality.trim() } : {}),
        ...(row.enabled !== undefined ? { enabled: row.enabled === true } : {}),
        ...(Number.isFinite(priority) ? { priority: Math.floor(priority) } : {}),
        ...(upstreamModelId ? { upstreamModelId, providerModelId: upstreamModelId } : {}),
        ...(gatewayExecutionStatus ? { gatewayExecutionStatus } : {}),
      } satisfies AdminGatewayRouteConfig;
    })
    .filter((row): row is AdminGatewayRouteConfig => Boolean(row));
}

/**
 * A1: Admin priority/enabled/upstream edits also write gatewayRouteConfigs so decision
 * reads the same ops source instead of only bindingOverrides + hardcoded seed.
 */
function mergeGatewayRouteConfigs(
  existing: unknown,
  bindingOverrides: AdminBindingOverride[] | null,
  routePriorityDraft: RoutePriorityDraft
): AdminGatewayRouteConfig[] | null {
  const byKey = new Map<string, AdminGatewayRouteConfig>();
  for (const row of normalizeGatewayRouteConfigRows(existing)) {
    const key = gatewayRouteConfigKey(row);
    if (key) byKey.set(key, row);
  }
  const overrideByBindingId = new Map(
    (Array.isArray(bindingOverrides) ? bindingOverrides : []).map((row) => [row.bindingId, row])
  );
  for (const route of listModelRoutes()) {
    const bindingId = routeBindingId(route);
    if (!bindingId) continue;
    const override = overrideByBindingId.get(bindingId);
    const draftPriority = routePriorityDraft[bindingId];
    const hasPriority = Number.isFinite(Number(draftPriority)) || Number.isFinite(Number(override?.priority));
    const hasEnabled = override?.enabled !== undefined;
    const hasUpstream = Boolean(override?.upstreamOverride);
    if (!hasPriority && !hasEnabled && !hasUpstream) continue;
    const priority = Number.isFinite(Number(draftPriority))
      ? Math.max(1, Math.floor(Number(draftPriority)))
      : Number.isFinite(Number(override?.priority))
        ? Math.floor(Number(override?.priority))
        : undefined;
    const next: AdminGatewayRouteConfig = {
      canonicalModelId: route.canonicalModelId,
      providerId: route.providerId,
      modality: route.modality,
      ...(hasEnabled ? { enabled: override?.enabled === true } : {}),
      ...(priority != null ? { priority } : {}),
      ...(hasUpstream
        ? {
            upstreamModelId: String(override?.upstreamOverride || '').trim(),
            providerModelId: String(override?.upstreamOverride || '').trim(),
          }
        : { providerModelId: route.providerModelId }),
    };
    const key = gatewayRouteConfigKey(next);
    if (!key) continue;
    byKey.set(key, { ...(byKey.get(key) || {}), ...next });
  }
  const rows = [...byKey.values()].sort((a, b) => gatewayRouteConfigKey(a).localeCompare(gatewayRouteConfigKey(b)));
  return rows.length ? rows : null;
}

/** B5: parse `canonical=upstream` lines (or JSON object) into modelMapping. */
function parseOpenAiCompatibleModelMappingText(value: string): Record<string, string> | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
      const entries = Object.entries(parsed as Record<string, unknown>)
        .map(([k, v]) => [String(k || '').trim(), String(v || '').trim()] as const)
        .filter(([k, v]) => k && v);
      return entries.length ? Object.fromEntries(entries) : undefined;
    } catch {
      return undefined;
    }
  }
  const entries: Array<[string, string]> = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    const colon = trimmed.indexOf(':');
    const sep = eq >= 0 ? eq : colon;
    if (sep <= 0) continue;
    const canonical = trimmed.slice(0, sep).trim();
    const upstream = trimmed.slice(sep + 1).trim();
    if (canonical && upstream) entries.push([canonical, upstream]);
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function formatOpenAiCompatibleModelMappingText(mapping?: Record<string, string> | null): string {
  if (!mapping || typeof mapping !== 'object') return '';
  return Object.entries(mapping)
    .map(([k, v]) => [String(k || '').trim(), String(v || '').trim()] as const)
    .filter(([k, v]) => k && v)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function normalizeOpenAiCompatibleProviderRows(value: unknown): AdminOpenAiCompatibleProviderConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const providerId = String(row.providerId || '').trim();
      if (!providerId) return null;
      const priority = Number(row.priority);
      const timeoutsIn =
        row.timeouts && typeof row.timeouts === 'object' && !Array.isArray(row.timeouts)
          ? (row.timeouts as Record<string, unknown>)
          : {};
      const requestMs = Number(timeoutsIn.requestMs ?? row.requestTimeoutMs);
      const pollIntervalMs = Number(timeoutsIn.pollIntervalMs);
      const pollTimeoutMs = Number(timeoutsIn.pollTimeoutMs);
      const pollRequestMs = Number(timeoutsIn.pollRequestMs);
      const timeouts: NonNullable<AdminOpenAiCompatibleProviderConfig['timeouts']> = {};
      if (Number.isFinite(requestMs) && requestMs > 0) timeouts.requestMs = Math.floor(requestMs);
      if (Number.isFinite(pollIntervalMs) && pollIntervalMs > 0) timeouts.pollIntervalMs = Math.floor(pollIntervalMs);
      if (Number.isFinite(pollTimeoutMs) && pollTimeoutMs > 0) timeouts.pollTimeoutMs = Math.floor(pollTimeoutMs);
      if (Number.isFinite(pollRequestMs) && pollRequestMs > 0) timeouts.pollRequestMs = Math.floor(pollRequestMs);
      const modelMapping =
        row.modelMapping && typeof row.modelMapping === 'object' && !Array.isArray(row.modelMapping)
          ? Object.fromEntries(
              Object.entries(row.modelMapping as Record<string, unknown>)
                .map(([k, v]) => [String(k || '').trim(), String(v || '').trim()] as const)
                .filter(([k, v]) => k && v)
            )
          : undefined;
      return {
        providerId,
        label: String(row.label || providerId).trim() || providerId,
        defaultBaseUrl: String(row.defaultBaseUrl || row.baseUrl || '').trim() || undefined,
        appendV1: row.appendV1 === undefined ? undefined : row.appendV1 !== false,
        channel: String(row.channel || '').trim() || undefined,
        ...(Number.isFinite(priority) ? { priority: Math.floor(priority) } : {}),
        asyncCapable: row.asyncCapable === true,
        ...(Object.keys(timeouts).length
          ? {
              timeouts,
              ...(timeouts.requestMs ? { requestTimeoutMs: timeouts.requestMs } : {}),
            }
          : {}),
        ...(modelMapping && Object.keys(modelMapping).length ? { modelMapping } : {}),
      } satisfies AdminOpenAiCompatibleProviderConfig;
    })
    .filter((row): row is AdminOpenAiCompatibleProviderConfig => Boolean(row));
}

function openAiCompatibleProvidersDraftFromConfig(config?: AdminModelOpsConfig | null): AdminOpenAiCompatibleProviderConfig[] {
  return normalizeOpenAiCompatibleProviderRows(config?.openAiCompatibleProviders);
}

function mergeOpenAiCompatibleProviders(
  existing: unknown,
  draft: AdminOpenAiCompatibleProviderConfig[]
): AdminOpenAiCompatibleProviderConfig[] | null {
  const byId = new Map<string, AdminOpenAiCompatibleProviderConfig>();
  for (const row of normalizeOpenAiCompatibleProviderRows(existing)) byId.set(row.providerId, row);
  for (const row of normalizeOpenAiCompatibleProviderRows(draft)) byId.set(row.providerId, { ...(byId.get(row.providerId) || {}), ...row });
  const rows = [...byId.values()].sort((a, b) => a.providerId.localeCompare(b.providerId));
  return rows.length ? rows : null;
}

function mergeRouteBindingOverrides(
  existing: unknown,
  routePriorityDraft: RoutePriorityDraft,
  routeFallbackPolicyDraft: RouteFallbackPolicyDraft,
  routeFallbackMaxAttemptsDraft: RouteFallbackMaxAttemptsDraft = {}
): AdminBindingOverride[] | null {
  const routeIds = knownRouteBindingIds();
  const normalized = normalizeBindingOverrideRows(existing);
  const byBindingId = new Map<string, AdminBindingOverride>();
  const preserved = normalized.filter((row) => !routeIds.has(row.bindingId));
  for (const row of normalized) {
    if (routeIds.has(row.bindingId)) byBindingId.set(row.bindingId, { ...row });
  }
  for (const [bindingId, priority] of Object.entries(routePriorityDraft)) {
    if (!routeIds.has(bindingId) || !Number.isFinite(Number(priority))) continue;
    const existingRow = byBindingId.get(bindingId) || { bindingId };
    byBindingId.set(bindingId, { ...existingRow, priority: Math.max(1, Math.floor(Number(priority))) });
  }
  for (const [bindingId, fallbackPolicy] of Object.entries(routeFallbackPolicyDraft)) {
    if (!routeIds.has(bindingId) || !ROUTE_FALLBACK_POLICY_SET.has(fallbackPolicy)) continue;
    const existingRow = byBindingId.get(bindingId) || { bindingId };
    byBindingId.set(bindingId, { ...existingRow, fallbackPolicy });
  }
  for (const [bindingId, maxAttempts] of Object.entries(routeFallbackMaxAttemptsDraft)) {
    if (!routeIds.has(bindingId) || !Number.isFinite(Number(maxAttempts))) continue;
    const existingRow = byBindingId.get(bindingId) || { bindingId };
    byBindingId.set(bindingId, { ...existingRow, fallbackMaxAttempts: Math.max(1, Math.min(5, Math.floor(Number(maxAttempts)))) });
  }
  const rows = [...preserved, ...byBindingId.values()].sort((a, b) => a.bindingId.localeCompare(b.bindingId));
  return rows.length ? rows : null;
}

function normalizeEndpointMappingRows(value: unknown): EndpointMappingDraftRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const routeId = String(row.routeId || '').trim();
      if (!routeId) return null;
      const clean = (key: string) => {
        const value = String(row[key] || '').trim();
        return value ? value : undefined;
      };
      const priority = Number(row.priority);
      return {
        routeId,
        ...(clean('requestPath') ? { requestPath: clean('requestPath') } : {}),
        ...(clean('pollPath') ? { pollPath: clean('pollPath') } : {}),
        ...(clean('statusPath') ? { statusPath: clean('statusPath') } : {}),
        ...(clean('artifactPath') ? { artifactPath: clean('artifactPath') } : {}),
        ...(clean('taskIdPath') ? { taskIdPath: clean('taskIdPath') } : {}),
        ...(clean('errorPath') ? { errorPath: clean('errorPath') } : {}),
        ...(clean('upstreamOverride') ? { upstreamOverride: clean('upstreamOverride') } : {}),
        ...(Number.isFinite(priority) ? { priority: Math.max(1, Math.floor(priority)) } : {}),
        ...(row.enabled !== undefined ? { enabled: row.enabled === true } : {}),
      };
    })
    .filter((row): row is EndpointMappingDraftRow => Boolean(row));
}

function endpointMappingDraftFromConfig(config?: AdminModelOpsConfig | null): EndpointMappingDraft {
  const out: EndpointMappingDraft = {};
  for (const row of normalizeEndpointMappingRows(config?.endpointMappings)) {
    out[row.routeId] = row;
  }
  return out;
}

function mergeEndpointMappings(existing: unknown, draft: EndpointMappingDraft): EndpointMappingDraftRow[] | null {
  const normalized = normalizeEndpointMappingRows(existing);
  const byRouteId = new Map<string, EndpointMappingDraftRow>();
  for (const row of normalized) byRouteId.set(row.routeId, { ...row });
  for (const [routeId, row] of Object.entries(draft)) {
    if (!routeId) continue;
    const merged = { ...(byRouteId.get(routeId) || { routeId }), ...row, routeId };
    const hasAnyMappingField = ['requestPath', 'pollPath', 'statusPath', 'artifactPath', 'taskIdPath', 'errorPath', 'upstreamOverride'].some((key) =>
      Boolean(String((merged as Record<string, unknown>)[key] || '').trim())
    );
    const hasPriority = Number.isFinite(Number(merged.priority));
    if (hasAnyMappingField || hasPriority || merged.enabled === false) byRouteId.set(routeId, merged);
    else byRouteId.delete(routeId);
  }
  const rows = [...byRouteId.values()].sort((a, b) => a.routeId.localeCompare(b.routeId));
  return rows.length ? rows : null;
}

export const __adminProviderKeysPanelTestUtils = {
  normalizeBindingOverrideRows,
  routePriorityDraftFromConfig,
  routeFallbackPolicyDraftFromConfig,
  routeFallbackMaxAttemptsDraftFromConfig,
  mergeRouteBindingOverrides,
  normalizeGatewayRouteConfigRows,
  mergeGatewayRouteConfigs,
  normalizeOpenAiCompatibleProviderRows,
  parseOpenAiCompatibleModelMappingText,
  formatOpenAiCompatibleModelMappingText,
  openAiCompatibleProvidersDraftFromConfig,
  mergeOpenAiCompatibleProviders,
  normalizeEndpointMappingRows,
  endpointMappingDraftFromConfig,
  mergeEndpointMappings,
  buildModelDiagnosticsTarget,
  buildPublishedModelDiagnosticsTargets,
  routeTestFailureMessage,
  selectedModelAvailabilityIssueText,
  screenDiagnosisSummaryText,
  modelAvailabilityIssueText,
  modelAvailabilityIssueTitle,
  routeFallbackSummaryText,
  modelDiagnosticsIssueSummaryText,
  diagnosticDetailText,
  diagnosticTitle,
  diagnosticStatusLabel,
  checkKindLabelsMutualExclusive,
};

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
  const mappingLabel = modelEndpointMappingLabel(model);
  return (
    <div className="grid gap-2 rounded-md border border-white/[0.06] bg-black/20 px-3 py-2 text-[10px] text-gray-500 md:grid-cols-[1fr_86px_86px]">
      <div className="min-w-0">
        <div className="truncate text-[11px] font-semibold text-gray-200" title={label}>{label}</div>
        <div className="mt-0.5 truncate" title={model.providerModelId}>{model.providerModelId}</div>
        {mappingLabel ? (
          <div className="mt-1 truncate text-amber-200" title={model.endpointMapping?.notes || mappingLabel}>{mappingLabel}</div>
        ) : null}
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
  const [screenTestingId, setScreenTestingId] = React.useState('');
  const [modelDiagnostics, setModelDiagnostics] = React.useState<ModelDiagnosticState>({});
  const [routePriorityDraft, setRoutePriorityDraft] = React.useState<RoutePriorityDraft>({});
  const [routeFallbackPolicyDraft, setRouteFallbackPolicyDraft] = React.useState<RouteFallbackPolicyDraft>({});
  const [routeFallbackMaxAttemptsDraft, setRouteFallbackMaxAttemptsDraft] = React.useState<RouteFallbackMaxAttemptsDraft>({});
  const [endpointMappingDraft, setEndpointMappingDraft] = React.useState<EndpointMappingDraft>({});
  const [openAiCompatibleProvidersDraft, setOpenAiCompatibleProvidersDraft] = React.useState<
    AdminOpenAiCompatibleProviderConfig[]
  >([]);
  /** B5: free-text buffer so incomplete mapping lines are not wiped while typing. */
  const [oaiModelMappingTextByIndex, setOaiModelMappingTextByIndex] = React.useState<Record<number, string>>({});
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
        setRoutePriorityDraft(routePriorityDraftFromConfig(modelOpsRes.config));
        setRouteFallbackPolicyDraft(routeFallbackPolicyDraftFromConfig(modelOpsRes.config));
        setRouteFallbackMaxAttemptsDraft(routeFallbackMaxAttemptsDraftFromConfig(modelOpsRes.config));
        setEndpointMappingDraft(endpointMappingDraftFromConfig(modelOpsRes.config));
        setOpenAiCompatibleProvidersDraft(openAiCompatibleProvidersDraftFromConfig(modelOpsRes.config));
        setOaiModelMappingTextByIndex({});
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
  const publishedIssueText = selectedModelAvailabilityIssueText(selectedCanonicalModelIds, modelAvailabilityById);

  const updateRow = (id: string, patch: Partial<AdminProviderKeyRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const updateRoutePriority = (bindingId: string, priority: number) => {
    const next = Math.max(1, Math.floor(Number(priority) || 1));
    setRoutePriorityDraft((prev) => ({ ...prev, [bindingId]: next }));
  };

  const updateRouteFallbackPolicy = (bindingId: string, fallbackPolicy: RouteFallbackPolicy) => {
    setRouteFallbackPolicyDraft((prev) => ({ ...prev, [bindingId]: fallbackPolicy }));
  };

  const updateRouteFallbackMaxAttempts = (bindingId: string, maxAttempts: number) => {
    const next = Math.max(1, Math.min(5, Math.floor(Number(maxAttempts) || 1)));
    setRouteFallbackMaxAttemptsDraft((prev) => ({ ...prev, [bindingId]: next }));
  };

  const updateEndpointMappingDraft = (routeId: string, key: keyof EndpointMappingDraftRow, value: string | boolean | number) => {
    setEndpointMappingDraft((prev) => ({
      ...prev,
      [routeId]: {
        ...(prev[routeId] || { routeId }),
        routeId,
        [key]: value,
      },
    }));
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

  const saveRows = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
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
          id: String(row.id || '').startsWith('draft_') ? '' : row.id,
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
    return saved.keys;
  };

  const save = async () => {
    if (blockIfRolePreview(isRolePreview)) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await saveRows();
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
    if (String(row.id || '').startsWith('draft_')) {
      await saveAndSmokeTest(row);
      return;
    }
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
          ? `Key Check 通过（≠可路由/≠可生成）：${res.result.label || row.label}，${modeLabel}${routeLabel}${latencyLabel}`
          : `Key Check 失败：${res.result.message}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '测试失败');
    } finally {
      setActingId('');
    }
  };

  const findSavedKeyForDraft = (draft: AdminProviderKeyRow, savedRows: AdminProviderKeyRow[]) => {
    const label = String(draft.label || providerLabel(draft.provider)).trim();
    const provider = String(draft.provider || '').trim();
    return [...savedRows]
      .reverse()
      .find((item) => item.provider === provider && String(item.label || '').trim() === label && !String(item.id || '').startsWith('draft_'));
  };

  const saveAndSmokeTest = async (row: AdminProviderKeyRow) => {
    if (blockIfRolePreview(isRolePreview)) return;
    setSaving(true);
    setActingId(row.id);
    setError('');
    setMessage('');
    try {
      const savedRows = await saveRows();
      const savedRow = String(row.id || '').startsWith('draft_')
        ? findSavedKeyForDraft(row, savedRows)
        : savedRows.find((item) => item.id === row.id);
      if (!savedRow) {
        setError('密钥已保存，但没有找到可测试的密钥卡片。请刷新供应商中心后重试。');
        return;
      }
      setMessage('密钥已保存，正在测试...');
      await runSmokeTest(savedRow);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存并测试失败');
    } finally {
      setSaving(false);
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

  const savePublishedModels = async (options: { force?: boolean } = {}) => {
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
            .map((row) => `${row.canonicalModelId}（${modelAvailabilityIssueText(row)}）`)
            .join('；')}${blocked.length > 4 ? '；...' : ''}`
        );
        return;
      }
      const diagnosisGate = evaluatePublishDiagnosisGate({
        selectedIds: selected,
        previousAllowlist: base.publishedCanonicalModelAllowlist || [],
        snapshots: base.publishDiagnosisByModel || {},
        force: options.force === true,
        onlyNewlyAdded: true,
      });
      if (!diagnosisGate.ok) {
        const detail = formatPublishDiagnosisGateMessage(diagnosisGate.issues);
        const forceOk = window.confirm(`${detail}\n\n仍要强制发布新增模型吗？`);
        if (!forceOk) {
          setError(detail);
          return;
        }
      }
      const bindingOverrides = mergeRouteBindingOverrides(
        base.bindingOverrides,
        routePriorityDraft,
        routeFallbackPolicyDraft,
        routeFallbackMaxAttemptsDraft
      );
      const saved = await saveAdminModelOpsConfig({
        ...base,
        publishedCanonicalModelAllowlist: selected,
        bindingOverrides,
        endpointMappings: mergeEndpointMappings(base.endpointMappings, endpointMappingDraft),
        gatewayRouteConfigs: mergeGatewayRouteConfigs(base.gatewayRouteConfigs, bindingOverrides, routePriorityDraft),
        openAiCompatibleProviders: mergeOpenAiCompatibleProviders(
          base.openAiCompatibleProviders,
          openAiCompatibleProvidersDraft.map((row, index) => {
            const text = oaiModelMappingTextByIndex[index];
            if (text === undefined) return row;
            const modelMapping = parseOpenAiCompatibleModelMappingText(text);
            if (!modelMapping) {
              const next = { ...row };
              delete next.modelMapping;
              return next;
            }
            return { ...row, modelMapping };
          })
        ),
      });
      setModelOpsConfig(saved.config);
      setOaiModelMappingTextByIndex({});
      setRoutePriorityDraft(routePriorityDraftFromConfig(saved.config));
      setRouteFallbackPolicyDraft(routeFallbackPolicyDraftFromConfig(saved.config));
      setRouteFallbackMaxAttemptsDraft(routeFallbackMaxAttemptsDraftFromConfig(saved.config));
      setEndpointMappingDraft(endpointMappingDraftFromConfig(saved.config));
      setOpenAiCompatibleProvidersDraft(openAiCompatibleProvidersDraftFromConfig(saved.config));
      setSelectedCanonicalModelIds(saved.config.publishedCanonicalModelAllowlist || selected);
      await refreshModelOpsConfig();
      setMessage(
        diagnosisGate.forceRequired || options.force
          ? '工作区模型发布范围已保存（含强制发布）'
          : '工作区模型发布范围已保存'
      );
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
      const targets = buildPublishedModelDiagnosticsTargets(
        WORKSPACE_CANONICAL_MODELS,
        selectedCanonicalSet,
        availabilityRows,
        endpointMappingDraft
      );
      if (!targets.length) {
        setError('没有可诊断的已发布模型');
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
      const issueSummary = modelDiagnosticsIssueSummaryText(res.results);
      setMessage(
        `批量诊断完成：路由 ${res.summary.route.passed}/${res.summary.route.tested} 通过，真实生成 ${res.summary.generation.passed}/${res.summary.generation.tested} 通过，创建任务 ${res.summary.generation.createdJobs} 个${issueSummary}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量诊断失败');
    } finally {
      setRunningPublishedDiagnostics(false);
    }
  };

  const runModelScreenDiagnosis = async (canonicalModelId: string) => {
    const model = WORKSPACE_CANONICAL_MODELS.find((row) => row.canonicalModelId === canonicalModelId);
    if (!model) return;
    const availability = modelAvailabilityById.get(canonicalModelId);
    const target = buildModelDiagnosticsTarget(model, availability, endpointMappingDraft);
    setScreenTestingId(canonicalModelId);
    setError('');
    setMessage('');
    try {
      const res = await fetchAdminModelScreenDiagnosis(target);
      const result = res.result;
      const auditedAt = result.generatedAt || new Date().toISOString();
      const summary = screenDiagnosisSummaryText(result) || result.message || 'screen diagnosis';
      setModelDiagnostics((prev) => ({
        ...prev,
        [canonicalModelId]: {
          ...(prev[canonicalModelId] || {}),
          screen: {
            layer: 'screen',
            status: result.status === 'ready' ? 'ready' : 'blocked',
            message: summary,
            code: result.routeDecision?.blockingReason?.code || result.code || null,
            providerId: result.providerId || target.providerId || null,
            nextAction: result.nextActions?.[0]?.label || result.routeDecision?.blockingReason?.nextAction || null,
            testedAt: auditedAt,
            screen: result,
          },
        },
      }));
      // A5: persist snapshot for publish gate (best-effort; ignore save errors).
      try {
        const base = modelOpsConfig || {
          version: 1,
          imageRegistryAllowlist: null,
          publishedCanonicalModelAllowlist: null,
          imageModelPreference: null,
          bindingOverrides: null,
          wiringEdges: null,
        };
        const saved = await saveAdminModelOpsConfig({
          ...base,
          publishDiagnosisByModel: {
            ...(base.publishDiagnosisByModel || {}),
            [canonicalModelId]: {
              ok: result.status === 'ready',
              status: result.status === 'ready' ? 'ready' : 'blocked',
              auditedAt,
              message: summary,
              source: 'screen',
              code: result.routeDecision?.blockingReason?.code || result.code || null,
            },
          },
        });
        setModelOpsConfig(saved.config);
      } catch {
        // keep UI diagnosis even if snapshot persist fails
      }
      setMessage(summary || `${canonicalModelId} 一屏诊断完成`);
    } catch (err) {
      const fallbackMessage = err instanceof Error ? err.message : '一屏诊断失败';
      setModelDiagnostics((prev) => ({
        ...prev,
        [canonicalModelId]: {
          ...(prev[canonicalModelId] || {}),
          screen: {
            layer: 'screen',
            status: 'failed',
            message: fallbackMessage,
            code: 'ADMIN_SCREEN_DIAGNOSIS_REQUEST_FAILED',
            providerId: target.providerId || null,
            testedAt: new Date().toISOString(),
          },
        },
      }));
      setError(fallbackMessage);
    } finally {
      setScreenTestingId('');
    }
  };

  const runModelRouteTest = async (canonicalModelId: string) => {
    const model = WORKSPACE_CANONICAL_MODELS.find((row) => row.canonicalModelId === canonicalModelId);
    if (!model) return;
    const availability = modelAvailabilityById.get(canonicalModelId);
    const target = buildModelDiagnosticsTarget(model, availability, endpointMappingDraft);
    setRouteTestingId(canonicalModelId);
    setError('');
    setMessage('');
    try {
      const res = await testAdminModelRoute(target);
      setModelDiagnostics((prev) => ({ ...prev, [canonicalModelId]: { ...(prev[canonicalModelId] || {}), route: routeDiagnosticEntry(res.result) } }));
      await refreshModelAvailability();
      if (res.result.status === 'passed') {
        setMessage(`${canonicalModelId} 路由检查通过（可路由，≠可生成），不创建生成任务`);
      } else {
        setError(routeTestFailureMessage(canonicalModelId, res.result));
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
            providerId: target.providerId || null,
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
    const billingNote = '真实生成会创建 AI Gateway 任务，并可能预扣/扣费。仅用于验证上游输出，不等于路由检查。';
    if (!window.confirm(`${canonicalModelId}\n\n确认运行 Generation Test？\n\n${billingNote}`)) return;
    const availability = modelAvailabilityById.get(canonicalModelId);
    const target = buildModelDiagnosticsTarget(model, availability, endpointMappingDraft);
    setGenerationTestingId(canonicalModelId);
    setError('');
    setMessage('');
    try {
      const res = await testAdminModelGeneration(target);
      setModelDiagnostics((prev) => ({ ...prev, [canonicalModelId]: { ...(prev[canonicalModelId] || {}), generation: generationDiagnosticEntry(res.result) } }));
      await refreshModelAvailability();
      const jobLabel = res.result.jobId ? `，任务 ${res.result.jobId}` : '';
      const note = res.result.billingNote ? `；${res.result.billingNote}` : `；${billingNote}`;
      if (res.result.status === 'passed') {
        setMessage(`${canonicalModelId} 真实生成测试通过（可生成）${jobLabel}${note}`);
      } else {
        setError(`${canonicalModelId} 真实生成失败：${res.result.message}${jobLabel}${res.result.nextAction ? `；${res.result.nextAction}` : ''}${note}`);
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
            providerId: target.providerId || null,
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
          <div className={`mt-1 text-[11px] ${publishedIssueText === '已选择且可发布' ? 'text-gray-500' : 'text-amber-200'}`}>{publishedIssueText}</div>
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
            <div className="text-[12px] font-semibold text-white">测试层级（能连 Key ≠ 能路由 ≠ 能生成）</div>
            <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-gray-400">
              <div><span className="text-gray-200">Key Check：</span>只验证密钥/凭证，不创建任务、不计费。</div>
              <div><span className="text-gray-200">Route Check：</span>确认模型、密钥、网关能否接上；通过≠可生成。</div>
              <div><span className="text-gray-200">一屏诊断：</span>只读总览 Key/Route/近期失败；不替代真实生成。</div>
              <div><span className="text-gray-200">Generation Test：</span>创建最小真实任务并可能计费，用于验证上游输出。</div>
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
                      const isDraftKey = String(row.id || '').startsWith('draft_');
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
                            <button type="button" disabled={!canWrite || saving || isActing || isEnvKey} onClick={() => void (isDraftKey ? saveAndSmokeTest(row) : runSmokeTest(row))} className="rounded-md border border-blue-900/50 bg-blue-950/25 px-3 py-1.5 text-[11px] text-blue-100 disabled:opacity-40">
                              {isDraftKey ? '保存并测试' : '测试密钥'}
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
                <h3 className="text-sm font-semibold text-white">OpenAI 兼容聚合商</h3>
                <div className="mt-1 text-[11px] text-gray-500">
                  填 baseURL / 模型映射 / 轮询超时后随「保存发布范围」写入 ops，无需新 adapter。详见 docs/AI-Gateway运营接聚合商手册.md
                </div>
              </div>
              <button
                type="button"
                disabled={!canWriteOps || savingModelOps}
                onClick={() =>
                  setOpenAiCompatibleProvidersDraft((prev) => [
                    ...prev,
                    {
                      providerId: '',
                      label: '',
                      defaultBaseUrl: 'https://',
                      asyncCapable: true,
                      timeouts: { requestMs: 60_000, pollIntervalMs: 2_000, pollTimeoutMs: 600_000 },
                    },
                  ])
                }
                className="rounded-md border border-emerald-500/25 bg-emerald-950/20 px-3 py-1.5 text-[10px] text-emerald-100 disabled:opacity-40"
              >
                添加聚合商
              </button>
            </div>
            <div className="space-y-3">
              {openAiCompatibleProvidersDraft.length ? (
                openAiCompatibleProvidersDraft.map((row, index) => (
                  <div key={`oai-compat-${index}`} className="space-y-2 rounded-md border border-white/[0.06] bg-black/20 p-3">
                    <div className="grid gap-2 md:grid-cols-[1fr_1fr_1.4fr_90px_72px_56px]">
                      <label className="block">
                        <span className="text-[10px] text-gray-500">providerId</span>
                        <input
                          value={row.providerId}
                          disabled={!canWriteOps || savingModelOps}
                          onChange={(ev) =>
                            setOpenAiCompatibleProvidersDraft((prev) =>
                              prev.map((item, i) => (i === index ? { ...item, providerId: ev.target.value.trim() } : item))
                            )
                          }
                          className="mt-1 w-full rounded-md border border-white/[0.08] bg-[#0a0a0c] px-2 py-1.5 text-[11px] text-gray-100 disabled:opacity-40"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-gray-500">显示名</span>
                        <input
                          value={row.label || ''}
                          disabled={!canWriteOps || savingModelOps}
                          onChange={(ev) =>
                            setOpenAiCompatibleProvidersDraft((prev) =>
                              prev.map((item, i) => (i === index ? { ...item, label: ev.target.value } : item))
                            )
                          }
                          className="mt-1 w-full rounded-md border border-white/[0.08] bg-[#0a0a0c] px-2 py-1.5 text-[11px] text-gray-100 disabled:opacity-40"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-gray-500">baseURL</span>
                        <input
                          value={row.defaultBaseUrl || row.baseUrl || ''}
                          disabled={!canWriteOps || savingModelOps}
                          onChange={(ev) =>
                            setOpenAiCompatibleProvidersDraft((prev) =>
                              prev.map((item, i) => (i === index ? { ...item, defaultBaseUrl: ev.target.value.trim() } : item))
                            )
                          }
                          className="mt-1 w-full rounded-md border border-white/[0.08] bg-[#0a0a0c] px-2 py-1.5 text-[11px] text-gray-100 disabled:opacity-40"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-gray-500">请求超时 ms</span>
                        <input
                          inputMode="numeric"
                          value={String(row.timeouts?.requestMs || row.requestTimeoutMs || 60000)}
                          disabled={!canWriteOps || savingModelOps}
                          onChange={(ev) => {
                            const requestMs = Math.max(1000, Math.floor(Number(ev.target.value) || 60000));
                            setOpenAiCompatibleProvidersDraft((prev) =>
                              prev.map((item, i) =>
                                i === index ? { ...item, timeouts: { ...(item.timeouts || {}), requestMs }, requestTimeoutMs: requestMs } : item
                              )
                            );
                          }}
                          className="mt-1 w-full rounded-md border border-white/[0.08] bg-[#0a0a0c] px-2 py-1.5 text-[11px] text-gray-100 disabled:opacity-40"
                        />
                      </label>
                      <label className="flex items-end gap-2 pb-2 text-[11px] text-gray-300">
                        <input
                          type="checkbox"
                          checked={row.asyncCapable === true}
                          disabled={!canWriteOps || savingModelOps}
                          onChange={(ev) =>
                            setOpenAiCompatibleProvidersDraft((prev) =>
                              prev.map((item, i) => (i === index ? { ...item, asyncCapable: ev.target.checked } : item))
                            )
                          }
                        />
                        异步
                      </label>
                      <button
                        type="button"
                        disabled={!canWriteOps || savingModelOps}
                        onClick={() => {
                          setOpenAiCompatibleProvidersDraft((prev) => prev.filter((_, i) => i !== index));
                          setOaiModelMappingTextByIndex({});
                        }}
                        className="self-end rounded-md border border-red-500/25 bg-red-950/20 px-2 py-1.5 text-[10px] text-red-100 disabled:opacity-40"
                      >
                        删除
                      </button>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="block">
                        <span className="text-[10px] text-gray-500">轮询间隔 ms（异步）</span>
                        <input
                          inputMode="numeric"
                          value={String(row.timeouts?.pollIntervalMs || '')}
                          placeholder="2000"
                          disabled={!canWriteOps || savingModelOps || row.asyncCapable !== true}
                          onChange={(ev) => {
                            const raw = ev.target.value.trim();
                            const pollIntervalMs = raw ? Math.max(200, Math.floor(Number(raw) || 2000)) : undefined;
                            setOpenAiCompatibleProvidersDraft((prev) =>
                              prev.map((item, i) => {
                                if (i !== index) return item;
                                const timeouts = { ...(item.timeouts || {}) };
                                if (pollIntervalMs == null) delete timeouts.pollIntervalMs;
                                else timeouts.pollIntervalMs = pollIntervalMs;
                                return { ...item, timeouts };
                              })
                            );
                          }}
                          className="mt-1 w-full rounded-md border border-white/[0.08] bg-[#0a0a0c] px-2 py-1.5 text-[11px] text-gray-100 disabled:opacity-40"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-gray-500">轮询总超时 ms（异步）</span>
                        <input
                          inputMode="numeric"
                          value={String(row.timeouts?.pollTimeoutMs || '')}
                          placeholder="600000"
                          disabled={!canWriteOps || savingModelOps || row.asyncCapable !== true}
                          onChange={(ev) => {
                            const raw = ev.target.value.trim();
                            const pollTimeoutMs = raw ? Math.max(5000, Math.floor(Number(raw) || 600000)) : undefined;
                            setOpenAiCompatibleProvidersDraft((prev) =>
                              prev.map((item, i) => {
                                if (i !== index) return item;
                                const timeouts = { ...(item.timeouts || {}) };
                                if (pollTimeoutMs == null) delete timeouts.pollTimeoutMs;
                                else timeouts.pollTimeoutMs = pollTimeoutMs;
                                return { ...item, timeouts };
                              })
                            );
                          }}
                          className="mt-1 w-full rounded-md border border-white/[0.08] bg-[#0a0a0c] px-2 py-1.5 text-[11px] text-gray-100 disabled:opacity-40"
                        />
                      </label>
                    </div>
                    <label className="block">
                      <span className="text-[10px] text-gray-500">模型映射（每行 canonical=upstream，或 JSON）</span>
                      <textarea
                        value={
                          oaiModelMappingTextByIndex[index] ??
                          formatOpenAiCompatibleModelMappingText(row.modelMapping)
                        }
                        disabled={!canWriteOps || savingModelOps}
                        rows={3}
                        placeholder={'gpt-image-2=gpt-image-1\n# 或 {"gpt-image-2":"gpt-image-1"}'}
                        onChange={(ev) => {
                          const text = ev.target.value;
                          setOaiModelMappingTextByIndex((prev) => ({ ...prev, [index]: text }));
                          const modelMapping = parseOpenAiCompatibleModelMappingText(text);
                          if (!text.trim()) {
                            setOpenAiCompatibleProvidersDraft((prev) =>
                              prev.map((item, i) => {
                                if (i !== index) return item;
                                const next = { ...item };
                                delete next.modelMapping;
                                return next;
                              })
                            );
                            return;
                          }
                          if (!modelMapping) return;
                          setOpenAiCompatibleProvidersDraft((prev) =>
                            prev.map((item, i) => (i === index ? { ...item, modelMapping } : item))
                          );
                        }}
                        className="mt-1 w-full rounded-md border border-white/[0.08] bg-[#0a0a0c] px-2 py-1.5 font-mono text-[11px] text-gray-100 disabled:opacity-40"
                      />
                    </label>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-white/[0.06] bg-black/20 px-3 py-4 text-[11px] text-gray-500">
                  尚未配置运营侧聚合商。内置 302 / AIHubMix / ToAPIs 等仍可用；新聚合商点「添加聚合商」。
                </div>
              )}
            </div>
          </section>

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
                        const canRunGenerationTest = canWriteOps && availability?.workspaceSelectable && GENERATION_TEST_MODALITIES.has(model.modality);
                        const diagnostics = modelDiagnostics[model.canonicalModelId] || {};
                        const routePriorityRows = listModelRoutes(model.canonicalModelId)
                          .map((route) => ({ route, bindingId: routeBindingId(route) }))
                          .filter((item): item is { route: ModelRouteCatalogEntry; bindingId: string } => Boolean(item.bindingId))
                          .sort((a, b) => {
                            const ap = routePriorityDraft[a.bindingId] ?? a.route.priority;
                            const bp = routePriorityDraft[b.bindingId] ?? b.route.priority;
                            return ap - bp || a.route.providerId.localeCompare(b.route.providerId);
                          });
                        const endpointMappingRows = listModelRoutes(model.canonicalModelId).filter((route) => route.requiresEndpointMapping);
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
                                  <div className="mt-1 truncate text-[10px] text-amber-200" title={modelAvailabilityIssueTitle(availability)}>{modelAvailabilityIssueText(availability)}</div>
                                ) : null}
                                {routePriorityRows.length > 1 ? (
                                  <div className="mt-2 grid gap-1.5">
                                    {routePriorityRows.map(({ route, bindingId }) => {
                                      const availabilityRoute = availability?.routes.find((item) =>
                                        (item.routeId && item.routeId === route.routeId) ||
                                        (item.providerId === route.providerId && item.modality === route.modality)
                                      );
                                      const fallbackText = routeFallbackSummaryText(availabilityRoute);
                                      return (
                                      <div key={bindingId} className="grid grid-cols-[1fr_96px_64px_72px] items-center gap-2 rounded-md border border-white/[0.06] bg-black/20 px-2 py-1">
                                        <div className="min-w-0">
                                          <div className="truncate text-[10px] font-semibold text-gray-200">{providerShortName(route.providerId)}</div>
                                          <div className="truncate text-[9px] text-gray-500">{route.channel || route.providerModelId}</div>
                                          {fallbackText ? <div className="truncate text-[9px] text-blue-200/80">{fallbackText}</div> : null}
                                        </div>
                                        <div onClick={(event) => event.stopPropagation()}>
                                          <CustomDropdown
                                            options={[...ROUTE_FALLBACK_POLICY_OPTIONS]}
                                            value={routeFallbackPolicyDraft[bindingId] ?? route.fallbackPolicy ?? 'none'}
                                            disabled={!canWriteOps || savingModelOps}
                                            onChange={(value) => updateRouteFallbackPolicy(bindingId, value as RouteFallbackPolicy)}
                                            tone="settings"
                                            listDensity="compact"
                                            listMinWidth={112}
                                            triggerClassName="w-full rounded-md border border-white/[0.08] bg-[#0a0a0c] px-2 py-1 text-left text-[10px] text-gray-100 outline-none disabled:opacity-40"
                                            triggerAriaLabel="fallback policy"
                                          />
                                        </div>
                                        <input
                                          inputMode="numeric"
                                          min={1}
                                          max={5}
                                          title="最大切换尝试次数"
                                          value={String(routeFallbackMaxAttemptsDraft[bindingId] ?? 1)}
                                          disabled={!canWriteOps || savingModelOps}
                                          onClick={(event) => event.stopPropagation()}
                                          onChange={(event) => updateRouteFallbackMaxAttempts(bindingId, Number(event.target.value) || 1)}
                                          className="w-full rounded-md border border-white/[0.08] bg-[#0a0a0c] px-2 py-1 text-right text-[10px] text-gray-100 disabled:opacity-40"
                                        />
                                        <input
                                          inputMode="numeric"
                                          value={String(routePriorityDraft[bindingId] ?? route.priority)}
                                          disabled={!canWriteOps || savingModelOps}
                                          onClick={(event) => event.stopPropagation()}
                                          onChange={(event) => updateRoutePriority(bindingId, Number(event.target.value) || route.priority)}
                                          className="w-full rounded-md border border-white/[0.08] bg-[#0a0a0c] px-2 py-1 text-right text-[10px] text-gray-100 disabled:opacity-40"
                                        />
                                      </div>
                                      );
                                    })}
                                  </div>
                                ) : null}
                                {endpointMappingRows.length ? (
                                  <div className="mt-2 grid gap-2">
                                    {endpointMappingRows.map((route) => {
                                      const draft = endpointMappingDraft[route.routeId] || { routeId: route.routeId };
                                      return (
                                        <div key={`endpoint:${route.routeId}`} className="rounded-md border border-amber-500/15 bg-amber-950/10 p-2" onClick={(event) => event.stopPropagation()}>
                                          <div className="mb-2 flex items-center justify-between gap-2">
                                            <div className="min-w-0">
                                              <div className="truncate text-[10px] font-semibold text-amber-100">{providerShortName(route.providerId)} endpoint 映射</div>
                                              <div className="truncate text-[9px] text-amber-200/70">{route.providerModelId}</div>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-2">
                                              <label className="grid gap-0.5 text-[9px] text-amber-100/80">
                                                <span>优先级</span>
                                                <input
                                                  inputMode="numeric"
                                                  value={String(draft.priority ?? route.priority ?? 80)}
                                                  disabled={!canWriteOps || savingModelOps}
                                                  onChange={(event) => updateEndpointMappingDraft(route.routeId, 'priority', Math.max(1, Math.floor(Number(event.target.value) || route.priority || 80)))}
                                                  className="w-16 rounded-md border border-white/[0.08] bg-[#0a0a0c] px-2 py-1 text-right text-[10px] text-gray-100 outline-none disabled:opacity-40"
                                                />
                                              </label>
                                              <label className="inline-flex items-center gap-1 text-[9px] text-amber-100">
                                                <input
                                                  type="checkbox"
                                                  checked={draft.enabled === true}
                                                  disabled={!canWriteOps || savingModelOps}
                                                  onChange={(event) => updateEndpointMappingDraft(route.routeId, 'enabled', event.target.checked)}
                                                />
                                                启用测试
                                              </label>
                                            </div>
                                          </div>
                                          <div className="grid gap-1.5 sm:grid-cols-2">
                                            {ENDPOINT_MAPPING_FIELDS.map((field) => (
                                              <label key={`${route.routeId}:${field.key}`} className="grid gap-1 text-[9px] text-amber-100/80">
                                                <span>{field.label}{field.required ? ' *' : ''}</span>
                                                <input
                                                  value={String(draft[field.key] || '')}
                                                  disabled={!canWriteOps || savingModelOps}
                                                  placeholder={field.placeholder}
                                                  onChange={(event) => updateEndpointMappingDraft(route.routeId, field.key, event.target.value)}
                                                  className="w-full rounded-md border border-white/[0.08] bg-[#0a0a0c] px-2 py-1 text-[10px] text-gray-100 outline-none placeholder:text-gray-600 disabled:opacity-40"
                                                />
                                              </label>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : null}
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  <button type="button" disabled={screenTestingId === model.canonicalModelId} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void runModelScreenDiagnosis(model.canonicalModelId); }} className="rounded-md border border-sky-500/25 bg-sky-950/20 px-2 py-1 text-[10px] text-sky-100 disabled:opacity-40" title="Key + Route + 最近失败聚合，不创建生成任务">
                                    {screenTestingId === model.canonicalModelId ? '诊断中...' : '一屏诊断'}
                                  </button>
                                  <button type="button" disabled={routeTestingId === model.canonicalModelId} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void runModelRouteTest(model.canonicalModelId); }} className="rounded-md border border-white/[0.08] bg-black/20 px-2 py-1 text-[10px] text-gray-300 disabled:opacity-40" title="Route Check：不创建任务、不计费">
                                    {routeTestingId === model.canonicalModelId ? '检查中...' : '路由检查（不创建任务）'}
                                  </button>
                                  <button type="button" disabled={!canRunGenerationTest || generationTestingId === model.canonicalModelId} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void runModelGenerationTest(model.canonicalModelId); }} className="rounded-md border border-emerald-500/25 bg-emerald-950/20 px-2 py-1 text-[10px] text-emerald-100 disabled:opacity-40" title="Generation Test：会创建真实任务并可能计费">
                                    {generationTestingId === model.canonicalModelId ? '生成中...' : '真实生成（会计费）'}
                                  </button>
                                </div>
                                <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                                  {[
                                    { key: 'screen' as const, label: '一屏', entry: diagnostics.screen },
                                    { key: 'route' as const, label: '路由', entry: diagnostics.route },
                                    { key: 'generation' as const, label: '生成', entry: diagnostics.generation },
                                  ].map((item) => (
                                    <div key={`${model.canonicalModelId}:${item.key}`} className={`min-w-0 rounded-md border px-2 py-1 ${diagnosticStatusClass(item.entry?.status)}`} title={diagnosticTitle(item.entry, `${item.label}未测试`)}>
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-semibold">{item.label}</span>
                                        <span>{diagnosticStatusLabel(item.entry?.status, item.key)}</span>
                                      </div>
                                      <div className="mt-0.5 truncate text-[9px] opacity-80">{item.entry ? diagnosticDetailText(item.entry) : '暂无结果'}</div>
                                    </div>
                                  ))}
                                </div>
                                {diagnostics.screen?.screen ? (
                                  <div className="mt-2 rounded-md border border-sky-500/20 bg-sky-950/10 px-2 py-1.5 text-[9px] text-sky-50/90">
                                    <div className="font-semibold text-sky-100">一屏诊断摘要</div>
                                    <div className="mt-1 truncate">下一步：{diagnostics.screen.screen.nextActions?.[0]?.label || diagnostics.screen.nextAction || '—'}</div>
                                    <div className="mt-0.5 truncate">
                                      Key：{(diagnostics.screen.screen.keyStatuses || []).map((row) => `${row.providerId}:${row.status}`).join(' / ') || '—'}
                                    </div>
                                    <div className="mt-0.5 truncate">
                                      最近失败：stage {(diagnostics.screen.screen.recentFailures?.byStage || []).map((row) => `${row.key}×${row.count}`).join(', ') || '无'}
                                      {' · '}
                                      owner {(diagnostics.screen.screen.recentFailures?.byOwner || []).map((row) => `${row.key}×${row.count}`).join(', ') || '无'}
                                    </div>
                                  </div>
                                ) : null}
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
