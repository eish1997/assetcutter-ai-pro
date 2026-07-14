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
