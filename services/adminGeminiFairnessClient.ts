import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';

export type GeminiFairnessConfig = Record<string, number>;

export type GeminiFairnessConfigResponse = {
  config: GeminiFairnessConfig;
  source?: 'db' | 'disk' | 'env_only';
  storage?: string;
  path?: string | null;
  updatedAt?: string | null;
};

export async function fetchAdminGeminiFairnessConfig() {
  return requestJson<GeminiFairnessConfigResponse>(apiUrl('/api/admin/gemini-fairness-config'), {
    cache: 'no-store',
  });
}

export async function saveAdminGeminiFairnessConfig(config: GeminiFairnessConfig) {
  return requestJson<GeminiFairnessConfigResponse & { ok: boolean }>(
    apiUrl('/api/admin/gemini-fairness-config'),
    {
      method: 'PUT',
      body: JSON.stringify(config),
    }
  );
}

export async function clearAdminGeminiFairnessConfig() {
  return requestJson<GeminiFairnessConfigResponse & { ok: boolean }>(
    apiUrl('/api/admin/gemini-fairness-config'),
    { method: 'DELETE' }
  );
}
