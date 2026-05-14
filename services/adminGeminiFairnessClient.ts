import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';

export type GeminiFairnessConfig = Record<string, number>;

export async function fetchAdminGeminiFairnessConfig() {
  return requestJson<{ config: GeminiFairnessConfig; path: string }>(apiUrl('/api/admin/gemini-fairness-config'), {
    cache: 'no-store',
  });
}

export async function saveAdminGeminiFairnessConfig(config: GeminiFairnessConfig) {
  return requestJson<{ ok: boolean; config: GeminiFairnessConfig; path: string }>(
    apiUrl('/api/admin/gemini-fairness-config'),
    {
      method: 'PUT',
      body: JSON.stringify(config),
    }
  );
}

export async function clearAdminGeminiFairnessConfig() {
  return requestJson<{ ok: boolean; config: GeminiFairnessConfig; path: string }>(
    apiUrl('/api/admin/gemini-fairness-config'),
    { method: 'DELETE' }
  );
}
