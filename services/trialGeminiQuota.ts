/**
 * 代理通道准入：登录用户走积分闸门；未登录一律拒绝。
 */
import { LOGIN_REQUIRED_CODE, platformAiLoginRequiredMessage } from '../shared/credits';
import { apiUrl } from './apiBase';
import { assertCreditBalanceAtLeast } from './creditsApi';
import { HttpRequestError, requestJson } from './httpClient';

function throwProxyGateNetworkError(): never {
  try {
    if (import.meta.env.DEV) {
      console.warn(
        '[assetcutter] 代理准入接口未送达。请确认 auth-api 已监听 9100，且通过 Vite 同源访问 /api/auth（勿把 API 指到不可达地址）。'
      );
    }
  } catch {
    /* ignore */
  }
  throw new Error('无法连接账户服务，请检查网络后重试。');
}

/**
 * 在发起站点 bulk 代理任务前调用：须登录且积分足够。
 * @param estimatedCredits 预检最低消耗（默认 1；工作流按任务类型传入保守估计）
 */
export async function assertCreditsGateBeforeProxyOrThrow(estimatedCredits = 1): Promise<void> {
  const required = Math.max(1, Math.floor(Number(estimatedCredits) || 1));
  try {
    const res = await requestJson<{ ok?: boolean; disabled?: boolean }>(apiUrl('/api/auth/credits-gate'), {
      method: 'POST',
      body: JSON.stringify({ estimatedCredits: required }),
    });
    if (res.disabled) {
      await assertCreditBalanceAtLeast(required);
    }
    return;
  } catch (e) {
    if (e instanceof HttpRequestError && e.status === 404) {
      console.warn(
        '[proxy-gate] POST /api/auth/credits-gate 返回 404，回退 /api/credits/balance 预检。请确认 auth-api 为当前版本。'
      );
      try {
        await assertCreditBalanceAtLeast(required);
        return;
      } catch (inner) {
        if (inner instanceof HttpRequestError && inner.status === 401) {
          throw new HttpRequestError(platformAiLoginRequiredMessage(), 401, LOGIN_REQUIRED_CODE);
        }
        throw inner;
      }
    }
    if (e instanceof HttpRequestError && e.status === 401) {
      try {
        await assertCreditBalanceAtLeast(required);
        return;
      } catch (inner) {
        if (inner instanceof HttpRequestError && inner.status === 401) {
          throw new HttpRequestError(platformAiLoginRequiredMessage(), 401, LOGIN_REQUIRED_CODE);
        }
        throw inner;
      }
    }
    if (e instanceof HttpRequestError && e.status === 429) {
      throw new Error(e.message || '试用通道已达上限');
    }
    if (e instanceof HttpRequestError && e.status === 403) {
      throw e;
    }
    const msg = String((e as Error)?.message ?? e);
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      throwProxyGateNetworkError();
    }
    throw e;
  }
}

/** @deprecated 使用 assertCreditsGateBeforeProxyOrThrow */
export const consumeTrialGeminiSlotBeforeProxyOrThrow = assertCreditsGateBeforeProxyOrThrow;
