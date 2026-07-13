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
  updatedAt?: string | null;
  updatedByUserId?: string | null;
  runtime?: {
    lastUsedAt?: string | null;
    lastErrorAt?: string | null;
    lastError?: string | null;
    errorCount?: number;
    cooldownUntil?: string | null;
    coolingDown?: boolean;
    currentMinuteCount?: number;
  };
};

export type AdminProviderKeysResponse = {
  ok?: boolean;
  keys: AdminProviderKeyRow[];
};

export async function fetchAdminProviderKeys() {
  return requestJson<AdminProviderKeysResponse>(apiUrl('/api/admin/ai-gateway/provider-keys'), {
    cache: 'no-store',
  });
}

export async function saveAdminProviderKeys(keys: AdminProviderKeyRow[]) {
  return requestJson<AdminProviderKeysResponse>(apiUrl('/api/admin/ai-gateway/provider-keys'), {
    method: 'PUT',
    body: JSON.stringify({ keys }),
  });
}
