import { companionFetchJson } from './fetch';

export type CompanionProbeResult = {
  ok: boolean;
  latencyMs?: number;
  body?: unknown;
  error?: string;
};

export async function probeCompanionHealth(baseUrl: string): Promise<CompanionProbeResult> {
  const r = await companionFetchJson<unknown>(baseUrl, '/v1/health');
  if (r.ok === false) {
    return { ok: false, latencyMs: r.latencyMs, error: r.error, body: undefined };
  }
  return { ok: true, latencyMs: r.latencyMs, body: r.data };
}

export async function probeCompanionCapabilities(baseUrl: string): Promise<CompanionProbeResult> {
  const r = await companionFetchJson<unknown>(baseUrl, '/v1/capabilities');
  if (r.ok === false) {
    return { ok: false, latencyMs: r.latencyMs, error: r.error, body: undefined };
  }
  return { ok: true, latencyMs: r.latencyMs, body: r.data };
}

export { normalizeCompanionBaseUrl } from '../companionLocalPrefs';
