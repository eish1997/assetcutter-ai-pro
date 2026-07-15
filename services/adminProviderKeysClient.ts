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
  mode?: 'credentials_only' | 'real_upstream';
  route?: string | null;
  upstreamStatus?: number | null;
  latencyMs?: number | null;
  message: string;
  missingFields: string[];
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
