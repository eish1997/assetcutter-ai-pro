/**
 * 跨域 gemini-proxy 积分预扣 + HMAC 请求头（与 auth-api credits-proxy-bundle 对齐）。
 */
import { dispatchCreditsBalanceChanged } from '../shared/credits';
import { apiUrl } from './apiBase';
import { getGeminiFairnessRequestHeaders } from './geminiFairnessBridge';
import { requestJson } from './httpClient';
import { peekCreditsPrechargeSession } from './creditsPrechargeSession';

let lastCreditsReserveKey: string | null = null;

export function setLastCreditsReserveKey(key: string | null): void {
  lastCreditsReserveKey = key?.trim() || null;
}

export function getLastCreditsReserveKey(): string | null {
  return lastCreditsReserveKey;
}

export function clearLastCreditsReserveKey(): void {
  lastCreditsReserveKey = null;
}

type CreditsProxyBundleResponse = {
  ok?: boolean;
  disabled?: boolean;
  headers?: Record<string, string>;
  reserveKey?: string;
};

/** 生图/异步 proxy 提交前获取准入头（含预扣 reserveKey）。 */
export async function getCreditsProxyRequestHeaders(
  estimatedCredits: number
): Promise<Record<string, string>> {
  const fallback = getGeminiFairnessRequestHeaders();
  const existingKey = getLastCreditsReserveKey();
  if (existingKey) {
    return {
      ...fallback,
      'X-AC-Credits-Reserve': existingKey,
    };
  }
  const session = peekCreditsPrechargeSession();
  if (session?.prechargeKey) {
    lastCreditsReserveKey = session.prechargeKey;
    return {
      ...fallback,
      'X-AC-Credits-Reserve': session.prechargeKey,
    };
  }
  const min = Math.max(1, Math.floor(Number(estimatedCredits) || 1));
  try {
    const res = await requestJson<CreditsProxyBundleResponse>(
      apiUrl(`/api/auth/credits-proxy-bundle?estimatedCredits=${encodeURIComponent(String(min))}`),
      { cache: 'no-store' }
    );
    if (res.disabled) {
      lastCreditsReserveKey = null;
      return fallback;
    }
    lastCreditsReserveKey = res.reserveKey?.trim() || null;
    return { ...fallback, ...(res.headers || {}) };
  } catch {
    lastCreditsReserveKey = null;
    return fallback;
  }
}

/** 任务失败或未结算时释放预扣（幂等；已 consume 的路径重复释放无害）。 */
export async function releaseCreditsProxyReserve(): Promise<void> {
  const key = lastCreditsReserveKey;
  lastCreditsReserveKey = null;
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
