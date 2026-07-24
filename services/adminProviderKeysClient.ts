import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';

export type AdminProviderKeyRow = {
  id: string;
  provider: string;
  label: string;
  enabled: boolean;
  priority: number;
  rpm: number;
  secretPreview?: string;
  hasSecret?: boolean;
  secret?: string;
  credentials?: Record<string, string>;
  credentialsPreview?: Record<string, string>;
  hasCredentials?: boolean;
  updatedAt?: string | null;
  updatedByUserId?: string | null;
  runtime?: {
    lastUsedAt?: string | null;
    lastSuccessAt?: string | null;
    lastErrorAt?: string | null;
    lastError?: string | null;
    errorCount?: number;
    consecutiveErrorCount?: number;
    autoCooldownCount?: number;
    lastCooldownReason?: string | null;
    cooldownUntil?: string | null;
    coolingDown?: boolean;
    currentMinuteCount?: number;
    healthStatus?: 'healthy' | 'warning' | 'degraded' | 'cooling_down';
    suggestedAction?: string | null;
  };
};

export type AdminProviderKeysResponse = {
  ok?: boolean;
  keys: AdminProviderKeyRow[];
};

export type AdminProviderKeyEvent = {
  id: string;
  providerKeyId: string | null;
  provider: string | null;
  label: string | null;
  type: string;
  status: number | null;
  message: string | null;
  reason: string | null;
  retryable: boolean;
  cooldownUntil: string | null;
  consecutiveErrorCount: number | null;
  autoCooldownCount: number | null;
  createdAt: string | null;
};

export type AdminProviderKeyEventsResponse = {
  ok?: boolean;
  events: AdminProviderKeyEvent[];
  limit: number;
};

export type AdminProviderKeyHealthSummaryItem = {
  providerKeyId: string | null;
  provider: string | null;
  label: string | null;
  windowHours: number;
  totalEvents: number;
  successCount: number;
  errorCount: number;
  retryableErrorCount: number;
  status429Count: number;
  status5xxCount: number;
  cooldownCount: number;
  autoCooldownCount: number;
  manualCooldownCount: number;
  restoreCount: number;
  lastEventAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastCooldownAt: string | null;
  lastRestoreAt: string | null;
  lastErrorMessage: string | null;
  lastErrorStatus: number | null;
  failureRate: number;
  retryableFailureRate: number;
  healthStatus: 'idle' | 'healthy' | 'warning' | 'degraded' | 'rate_limited' | 'cooling_down';
  suggestedAction: string | null;
  automation?: {
    recommended: boolean;
    action: 'none' | 'cooldown_key';
    ttlMinutes: number;
    reason: string | null;
  };
};

export type AdminProviderKeyHealthSummaryResponse = {
  ok?: boolean;
  windowHours: number;
  since: string;
  generatedAt: string;
  totals: {
    windowHours: number;
    totalEvents: number;
    successCount: number;
    errorCount: number;
    retryableErrorCount: number;
    status429Count: number;
    status5xxCount: number;
    cooldownCount: number;
    autoCooldownCount: number;
    manualCooldownCount: number;
    restoreCount: number;
    failureRate: number;
    retryableFailureRate: number;
  };
  summaries: AdminProviderKeyHealthSummaryItem[];
};

export type AdminProviderKeyHealthAutomationResponse = {
  ok?: boolean;
  dryRun: boolean;
  generatedAt: string;
  windowHours: number;
  actions: Array<{
    providerKeyId: string;
    provider: string | null;
    label: string | null;
    action: 'cooldown_key';
    ttlMinutes: number;
    reason: string;
    applied: boolean;
  }>;
  summary: AdminProviderKeyHealthSummaryResponse;
  keys: AdminProviderKeyRow[];
};

export type AdminProviderKeySmokeTestResult = {
  ok: boolean;
  testedAt: string;
  providerKeyId: string | null;
  provider: string | null;
  label: string | null;
  status: 'passed' | 'failed';
  testLayer?: 'key_smoke';
  mode?: 'credentials_only' | 'real_upstream';
  createsGenerationTask?: boolean;
  route?: string | null;
  upstreamStatus?: number | null;
  latencyMs?: number | null;
  message: string;
  missingFields: string[];
  nextAction?: string | null;
};

export type AdminProviderKeySmokeTestResponse = {
  ok?: boolean;
  result: AdminProviderKeySmokeTestResult;
  keys: AdminProviderKeyRow[];
};

export type AdminModelOpsConfig = {
  version: number;
  imageRegistryAllowlist?: string[] | null;
  publishedCanonicalModelAllowlist?: string[] | null;
  imageModelPreference?: string[] | null;
  bindingOverrides?: unknown[] | null;
  providerOverrides?: unknown[] | null;
  endpointMappings?: unknown[] | null;
  wiringEdges?: unknown[] | null;
  updatedAt?: string | null;
  updatedByUserId?: string | null;
  source?: string | null;
  storage?: string | null;
  path?: string | null;
};

export type AdminModelOpsConfigResponse = {
  ok?: boolean;
  config: AdminModelOpsConfig;
};

export type AdminModelAvailabilityRouteSummary = {
  routeId?: string | null;
  providerId: string | null;
  modality: string | null;
  gatewayExecutionStatus: 'gateway_ready' | 'adapter_pending' | 'not_gateway_routed';
  executionStatus: string;
  platformKeyRequired: boolean;
  keyReady: boolean;
  selectable: boolean;
  reasonCode: 'ready' | 'key_missing' | 'adapter_pending' | 'parameter_pending' | 'route_ambiguous' | 'route_not_executable' | 'route_not_found';
  missingEndpointFields?: string[];
  priority?: number | null;
  fallbackPolicy?:
    | 'none'
    | 'on_error'
    | 'on_rate_limit'
    | 'on_timeout'
    | 'on_provider_degraded'
    | 'cost_optimized'
    | 'quality_first';
  fallbackMaxAttempts?: number;
};

export type AdminModelAvailabilitySummaryItem = {
  canonicalModelId: string;
  modality: string | null;
  status: 'ready' | 'key_missing' | 'adapter_pending' | 'parameter_pending' | 'route_ambiguous' | 'route_not_executable' | 'route_not_found';
  workspaceSelectable: boolean;
  reasonCode: 'ready' | 'key_missing' | 'adapter_pending' | 'parameter_pending' | 'route_ambiguous' | 'route_not_executable' | 'route_not_found';
  reason: string;
  routeIds?: string[];
  providers?: string[];
  priority?: number | null;
  routes: AdminModelAvailabilityRouteSummary[];
};

export type AdminModelAvailabilitySummaryResponse = {
  ok?: boolean;
  generatedAt: string;
  totals: {
    total: number;
    ready: number;
    keyMissing: number;
    adapterPending: number;
    parameterPending: number;
    routeAmbiguous?: number;
    routeMissing: number;
  };
  models: AdminModelAvailabilitySummaryItem[];
};

export type AdminModelRouteTestInput = {
  canonicalModelId: string;
  routeId?: string;
  modality?: string;
  providerId?: string;
  provider?: string;
  executionStatus?: string;
  requiresEndpointMapping?: boolean;
};

export type AdminModelRouteTestResult = {
  ok: boolean;
  status: 'passed' | 'failed';
  mode: 'route_guard';
  testLayer?: 'route_test';
  createsGenerationTask?: boolean;
  canonicalModelId: string | null;
  providerId: string | null;
  modality: string | null;
  code: string;
  message: string;
  route: {
    ruleId?: string;
    canonicalModelId?: string;
    providerId?: string;
    gatewayExecutionStatus?: string;
    executionStatus?: string;
    platformKeyRequired?: boolean;
  } | null;
  missingEndpointFields?: string[];
  routeIds?: string[];
  providers?: string[];
  priority?: number | null;
  nextAction?: string | null;
  testedAt: string;
};

export type AdminModelRouteTestResponse = {
  ok?: boolean;
  result: AdminModelRouteTestResult;
};

export type AdminModelGenerationTestInput = {
  canonicalModelId: string;
  routeId?: string;
  modality?: string;
  providerId?: string;
  provider?: string;
  executionStatus?: string;
  requiresEndpointMapping?: boolean;
};

export type AdminModelGenerationTestResult = {
  ok: boolean;
  status: 'passed' | 'failed';
  mode: 'real_generation';
  testLayer?: 'generation_test';
  createsGenerationTask?: boolean;
  canonicalModelId: string | null;
  providerId: string | null;
  modality: string | null;
  code: string;
  message: string;
  jobId: string | null;
  jobStatus: string | null;
  route: {
    ruleId?: string | null;
    providerId?: string | null;
    workerId?: string | null;
    adapterId?: string | null;
    gatewayExecutionStatus?: string | null;
    executionStatus?: string | null;
    platformKeyRequired?: boolean | null;
  } | null;
  artifacts: Array<{
    kind: string | null;
    hasUrl: boolean;
    source: string | null;
  }>;
  outputSummary?: {
    kind?: string;
    textPreview?: string;
  } | null;
  missingEndpointFields?: string[];
  routeIds?: string[];
  providers?: string[];
  priority?: number | null;
  nextAction?: string | null;
  testedAt: string;
};

export type AdminModelGenerationTestResponse = {
  ok?: boolean;
  result: AdminModelGenerationTestResult;
};

export type AdminModelDiagnosticsRunInput = {
  layers?: ReadonlyArray<'route' | 'generation'>;
  models: Array<
    | string
    | {
        canonicalModelId: string;
        routeId?: string;
        registryId?: string;
        modality?: string;
        providerId?: string;
        provider?: string;
        executionStatus?: string;
        requiresEndpointMapping?: boolean;
      }
  >;
};

export type AdminModelDiagnosticsRunResultItem = {
  canonicalModelId: string;
  providerId: string | null;
  modality: string | null;
  route?: AdminModelRouteTestResult;
  generation?: AdminModelGenerationTestResult;
};

export type AdminModelDiagnosticsRunResponse = {
  ok: boolean;
  code?: string;
  message?: string;
  layers: Array<'route' | 'generation'>;
  results: AdminModelDiagnosticsRunResultItem[];
  summary: {
    total: number;
    route: { tested: number; passed: number; failed: number };
    generation: { tested: number; passed: number; failed: number; createdJobs: number };
  };
  generatedAt: string;
};

export type AdminModelAvailabilitySummaryInput = {
  models: Array<{
    canonicalModelId: string;
    modality?: string;
    routes?: Array<{ routeId?: string; providerId?: string; modality?: string; executionStatus?: string; requiresEndpointMapping?: boolean }>;
  }>;
};

export async function fetchAdminProviderKeys() {
  return requestJson<AdminProviderKeysResponse>(apiUrl('/api/admin/ai-gateway/provider-keys'), {
    cache: 'no-store',
  });
}

export async function fetchAdminProviderKeyEvents(options: { limit?: number; keyId?: string; provider?: string } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(Math.min(500, Math.max(1, Math.floor(Number(options.limit || 50))))));
  if (options.keyId) params.set('keyId', options.keyId);
  if (options.provider) params.set('provider', options.provider);
  return requestJson<AdminProviderKeyEventsResponse>(
    apiUrl(`/api/admin/ai-gateway/provider-key-events?${params.toString()}`),
    { cache: 'no-store' }
  );
}

export async function fetchAdminProviderKeyHealthSummary(
  options: { windowHours?: number; keyId?: string; provider?: string } = {}
) {
  const params = new URLSearchParams();
  params.set('windowHours', String(Math.min(720, Math.max(1, Math.floor(Number(options.windowHours || 24))))));
  if (options.keyId) params.set('keyId', options.keyId);
  if (options.provider) params.set('provider', options.provider);
  return requestJson<AdminProviderKeyHealthSummaryResponse>(
    apiUrl(`/api/admin/ai-gateway/provider-key-health-summary?${params.toString()}`),
    { cache: 'no-store' }
  );
}

export async function applyAdminProviderKeyHealthAutomation(
  options: { windowHours?: number; keyId?: string; provider?: string; dryRun?: boolean } = {}
) {
  return requestJson<AdminProviderKeyHealthAutomationResponse>(
    apiUrl('/api/admin/ai-gateway/provider-key-health-automation'),
    {
      method: 'POST',
      body: JSON.stringify({
        windowHours: Math.min(720, Math.max(1, Math.floor(Number(options.windowHours || 24)))),
        keyId: options.keyId || '',
        provider: options.provider || '',
        dryRun: options.dryRun === true,
      }),
    }
  );
}

export async function saveAdminProviderKeys(keys: AdminProviderKeyRow[]) {
  return requestJson<AdminProviderKeysResponse>(apiUrl('/api/admin/ai-gateway/provider-keys'), {
    method: 'PUT',
    body: JSON.stringify({ keys }),
  });
}

export async function cooldownAdminProviderKey(id: string, input: { minutes?: number; reason?: string } = {}) {
  return requestJson<AdminProviderKeysResponse>(
    apiUrl(`/api/admin/ai-gateway/provider-keys/${encodeURIComponent(id)}/cooldown`),
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
}

export async function restoreAdminProviderKey(id: string) {
  return requestJson<AdminProviderKeysResponse>(
    apiUrl(`/api/admin/ai-gateway/provider-keys/${encodeURIComponent(id)}/restore`),
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
}

export async function smokeTestAdminProviderKey(id: string) {
  return requestJson<AdminProviderKeySmokeTestResponse>(
    apiUrl(`/api/admin/ai-gateway/provider-keys/${encodeURIComponent(id)}/smoke-test`),
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
}

export async function fetchAdminModelOpsConfig() {
  return requestJson<AdminModelOpsConfigResponse>(apiUrl('/api/admin/model-ops-config'), {
    cache: 'no-store',
  });
}

export async function saveAdminModelOpsConfig(config: AdminModelOpsConfig) {
  return requestJson<AdminModelOpsConfigResponse>(apiUrl('/api/admin/model-ops-config'), {
    method: 'PUT',
    body: JSON.stringify({ config }),
  });
}

export async function fetchAdminModelAvailabilitySummary(input: AdminModelAvailabilitySummaryInput) {
  return requestJson<AdminModelAvailabilitySummaryResponse>(apiUrl('/api/admin/model-availability-summary'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function testAdminModelRoute(input: AdminModelRouteTestInput) {
  return requestJson<AdminModelRouteTestResponse>(apiUrl('/api/admin/model-route-test'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function testAdminModelGeneration(input: AdminModelGenerationTestInput) {
  return requestJson<AdminModelGenerationTestResponse>(apiUrl('/api/admin/model-generation-test'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function runAdminModelDiagnostics(input: AdminModelDiagnosticsRunInput) {
  return requestJson<AdminModelDiagnosticsRunResponse>(apiUrl('/api/admin/model-diagnostics/run'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
