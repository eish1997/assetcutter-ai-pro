import { getCompanionLocalToken, normalizeCompanionBaseUrl } from '../companionLocalPrefs';

export type CompanionClientResult<T> =
  | { ok: true; data: T; latencyMs: number; status: number }
  | { ok: false; error: string; status?: number; latencyMs?: number };

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export async function companionFetchJson<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<CompanionClientResult<T>> {
  const base = normalizeCompanionBaseUrl(baseUrl);
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const t0 = nowMs();
  try {
    const headers = new Headers(init?.headers);
    const token = getCompanionLocalToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const r = await fetch(url, { ...init, headers, mode: 'cors' });
    const latencyMs = Math.round(nowMs() - t0);
    const text = await r.text();
    let data: unknown = text;
    try {
      data = text ? (JSON.parse(text) as unknown) : ({} as T);
    } catch {
      /* 非 JSON 时 data 保持 string */
    }
    if (!r.ok) {
      return { ok: false as const, error: `HTTP ${r.status}`, status: r.status, latencyMs };
    }
    return { ok: true as const, data: data as T, latencyMs, status: r.status };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
      latencyMs: Math.round(nowMs() - t0),
    };
  }
}
