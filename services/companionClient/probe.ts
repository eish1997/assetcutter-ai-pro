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

export async function fetchCompanionRuntimeStatus(baseUrl: string): Promise<CompanionProbeResult> {
  const r = await companionFetchJson<unknown>(baseUrl, '/v1/runtime-status');
  if (r.ok === false) {
    return { ok: false, latencyMs: r.latencyMs, error: r.error, body: undefined };
  }
  return { ok: true, latencyMs: r.latencyMs, body: r.data };
}

/** 经伴侣转发探测 SamLocal `GET /health`（避免浏览器跨端口 CORS） */
export async function probeCompanionSamSegmentHealth(baseUrl: string): Promise<CompanionProbeResult> {
  const r = await companionFetchJson<unknown>(baseUrl, '/v1/debug/sam-segment-health');
  if (r.ok === false) {
    return { ok: false, latencyMs: r.latencyMs, error: r.error, body: undefined };
  }
  return { ok: true, latencyMs: r.latencyMs, body: r.data };
}

/** 经伴侣对 `COMPANION_REMBG_PYTHON` 执行 `import rembg` 轻量探测 */
export async function probeCompanionRembgHealth(baseUrl: string): Promise<CompanionProbeResult> {
  const r = await companionFetchJson<unknown>(baseUrl, '/v1/debug/rembg-health');
  if (r.ok === false) {
    return { ok: false, latencyMs: r.latencyMs, error: r.error, body: undefined };
  }
  return { ok: true, latencyMs: r.latencyMs, body: r.data };
}

export { normalizeCompanionBaseUrl } from '../companionLocalPrefs';
