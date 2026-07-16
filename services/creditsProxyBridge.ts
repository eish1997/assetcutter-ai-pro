/**
 * 跨域 ai-worker-proxy 积分预扣 + HMAC 请求头（与 auth-api credits-proxy-bundle 对齐）。
 */
import { dispatchCreditsBalanceChanged } from '../shared/credits';
import { apiUrl } from './apiBase';
import { getGeminiFairnessRequestHeaders } from './geminiFairnessBridge';
import { HttpRequestError, requestJson } from './httpClient';
let lastCreditsReserveKey: string | null = null;
let lastCreditsProxyHeaders: Record<string, string> | null = null;
let lastCreditsProxyEstimate: number | null = null;

function clearCreditsProxyHeaderCache(): void {
  lastCreditsProxyHeaders = null;
  lastCreditsProxyEstimate = null;
}

export function setLastCreditsReserveKey(key: string | null): void {
  const next = key?.trim() || null;
  if (next !== lastCreditsReserveKey) clearCreditsProxyHeaderCache();
  lastCreditsReserveKey = next;
}

export function getLastCreditsReserveKey(): string | null {
  return lastCreditsReserveKey;
}

export function clearLastCreditsReserveKey(): void {
  lastCreditsReserveKey = null;
  clearCreditsProxyHeaderCache();
}

const FAIRNESS_HEADER_KEY = 'X-AC-Fairness-Key';

/** gate 已预扣时返回缓存的 proxy 准入头（不含 fairness）；缓存额度 ≥ 请求额度即可复用 */
export function getCachedCreditsProxyHeaders(estimatedCredits: number): Record<string, string> | null {
  const min = Math.max(1, Math.floor(Number(estimatedCredits) || 1));
  if (
    lastCreditsProxyHeaders &&
    lastCreditsProxyEstimate != null &&
    lastCreditsProxyEstimate >= min &&
    getLastCreditsReserveKey()
  ) {
    return { ...lastCreditsProxyHeaders };
  }
  return null;
}

/** 将 gate 取得的完整准入头写入模块缓存，供 AI Worker Proxy 复用 */
export function markCreditsProxyHeadersFromGate(
  headers: Record<string, string>,
  estimatedCredits: number
): void {
  const min = Math.max(1, Math.floor(Number(estimatedCredits) || 1));
  const reserveKey = headers['X-AC-Credits-Reserve']?.trim() || null;
  if (!reserveKey) return;
  const proxyHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k !== FAIRNESS_HEADER_KEY) proxyHeaders[k] = v;
  }
  const sameKey = getLastCreditsReserveKey() === reserveKey;
  setLastCreditsReserveKey(reserveKey);
  lastCreditsProxyHeaders = proxyHeaders;
  // 同 key 时勿把整包 estimate 缩成单步（否则下一步会误判并释放预扣）
  if (sameKey && lastCreditsProxyEstimate != null && lastCreditsProxyEstimate > min) {
    return;
  }
  lastCreditsProxyEstimate = min;
}

type CreditsProxyBundleResponse = {
  ok?: boolean;
  disabled?: boolean;
  headers?: Record<string, string>;
  reserveKey?: string;
};

function isCreditsBundleNetworkError(msg: string): boolean {
  return /failed to fetch|fetch failed|networkerror|load failed|econnrefused|network request failed/i.test(
    msg
  );
}

function creditsBundleUnavailableMessage(): string {
  try {
    if (import.meta.env.DEV) {
      return '无法连接 auth-api 积分预扣服务。请运行 npm run dev:auth-backend（9100），或注释 .env.local 中的 VITE_AUTH_API_BASE_URL 后重启 npm run dev。';
    }
  } catch {
    /* ignore */
  }
  return '无法连接积分服务，请检查网络或稍后重试。';
}

/** 生图/异步 proxy 提交前获取准入头（含预扣 reserveKey + HMAC 签名）。 */
export async function getCreditsProxyRequestHeaders(
  estimatedCredits: number
): Promise<Record<string, string>> {
  const fallback = getGeminiFairnessRequestHeaders();
  const min = Math.max(1, Math.floor(Number(estimatedCredits) || 1));
  const existingKey = getLastCreditsReserveKey();
  // 整包预扣（更大 estimate）可覆盖后续单步；勿因 149→15 误释放
  if (
    existingKey &&
    lastCreditsProxyHeaders &&
    lastCreditsProxyEstimate != null &&
    lastCreditsProxyEstimate >= min
  ) {
    return { ...fallback, ...lastCreditsProxyHeaders };
  }
  if (existingKey && lastCreditsProxyEstimate != null && lastCreditsProxyEstimate < min) {
    await releaseCreditsProxyReserve();
  } else if (existingKey && !lastCreditsProxyHeaders) {
    lastCreditsReserveKey = null;
    clearCreditsProxyHeaderCache();
  }
  try {
    const res = await requestJson<CreditsProxyBundleResponse>(
      apiUrl(`/api/auth/credits-proxy-bundle?estimatedCredits=${encodeURIComponent(String(min))}`),
      { cache: 'no-store' }
    );
    if (res.disabled) {
      lastCreditsReserveKey = null;
      clearCreditsProxyHeaderCache();
      return fallback;
    }
    lastCreditsReserveKey = res.reserveKey?.trim() || null;
    if (!lastCreditsReserveKey) {
      throw new HttpRequestError(
        '积分预扣未返回 reserveKey，请确认 auth-api 已部署最新版。',
        503,
        'CREDITS_BUNDLE_INVALID'
      );
    }
    const bundleHeaders: Record<string, string> = {
      ...(res.headers || {}),
      'X-AC-Credits-Reserve': lastCreditsReserveKey,
    };
    lastCreditsProxyHeaders = bundleHeaders;
    lastCreditsProxyEstimate = min;
    return { ...fallback, ...bundleHeaders };
  } catch (e) {
    lastCreditsReserveKey = null;
    clearCreditsProxyHeaderCache();
    if (e instanceof HttpRequestError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (isCreditsBundleNetworkError(msg)) {
      throw new HttpRequestError(creditsBundleUnavailableMessage(), 503, 'CREDITS_BUNDLE_UNAVAILABLE');
    }
    throw e;
  }
}

/** 任务失败或未结算时释放预扣（幂等；已 consume 的路径重复释放无害）。 */
export async function releaseCreditsProxyReserve(): Promise<void> {
  const key = lastCreditsReserveKey;
  lastCreditsReserveKey = null;
  clearCreditsProxyHeaderCache();
  if (!key) return;
  try {
    await requestJson<{ ok?: boolean; released?: boolean; disabled?: boolean }>(
      apiUrl('/api/auth/credits-release'),
      {
        method: 'POST',
        body: JSON.stringify({ reserveKey: key }),
      }
    );
    dispatchCreditsBalanceChanged();
  } catch {
    /* best-effort：TTL 仍会清理过期预扣 */
  }
}
