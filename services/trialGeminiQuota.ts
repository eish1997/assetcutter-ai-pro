/**
 * 代理通道准入：登录用户优先走积分闸门（CREDITS_BILLING）；关闭时回退 trial-gemini 日次；访客 localStorage。
 */
import { apiUrl } from './apiBase';
import { readLocalJson, scopedStorageKey, writeLocalJson } from './clientPersist';
import { HttpRequestError, requestJson } from './httpClient';
import { getUserApiKey } from './settingsStore';

/** 与 auth-api `TRIAL_GEMINI_DAILY_LIMIT` 对齐；访客提示与本地计数用同一上限（默认 60）。 */
export const DEFAULT_TRIAL_GEMINI_DAILY_LIMIT = 60;

function trialDailyLimitClient(): number {
  try {
    const raw = import.meta.env.VITE_TRIAL_GEMINI_DAILY_LIMIT;
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(1, Math.min(500, Math.floor(n)));
  } catch {
    /* ignore */
  }
  return DEFAULT_TRIAL_GEMINI_DAILY_LIMIT;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

type GuestTrialState = { day: string; count: number };

function guestStorageKey(): string {
  return scopedStorageKey('trial_gemini_daily_v1', null);
}

function normalizeGuestState(parsed: unknown): GuestTrialState | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.day !== 'string' || typeof o.count !== 'number') return null;
  if (!Number.isFinite(o.count)) return null;
  return { day: o.day, count: Math.max(0, Math.floor(o.count)) };
}

function consumeGuestTrialSlotOrThrow(limit: number): void {
  const key = guestStorageKey();
  const today = utcDay();
  const prev = readLocalJson<GuestTrialState | null>(key, null, normalizeGuestState);
  let count = 0;
  if (prev && prev.day === today) count = prev.count;
  if (count >= limit) {
    throw new Error(
      `试用通道每日限 ${limit} 次任务。未登录为设备计数；登录后可按账号统计。请明日再试、登录后重试，或改用自带 API Key 的供应商。`
    );
  }
  writeLocalJson(key, { day: today, count: count + 1 });
}

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

async function consumeLoggedInTrialGeminiSlotOrThrow(limit: number): Promise<void> {
  try {
    await requestJson<{ ok?: boolean }>(apiUrl('/api/auth/trial-gemini/consume'), {
      method: 'POST',
      body: '{}',
    });
  } catch (e) {
    if (e instanceof HttpRequestError && e.status === 429) {
      throw new Error(e.message || `试用通道每日限 ${limit} 次任务`);
    }
    if (e instanceof HttpRequestError && e.status === 403) {
      throw e;
    }
    throw e;
  }
}

/**
 * 在发起站点 bulk 代理任务前调用：登录用户走 `/api/auth/credits-gate`（积分制）或 trial 日次；访客本机计数。
 * @param estimatedCredits 预检最低消耗（默认 1；工作流按任务类型传入保守估计）
 */
export async function assertCreditsGateBeforeProxyOrThrow(estimatedCredits = 1): Promise<void> {
  if (getUserApiKey()?.trim()) return;
  const required = Math.max(1, Math.floor(Number(estimatedCredits) || 1));
  const limit = trialDailyLimitClient();
  try {
    const res = await requestJson<{ ok?: boolean; disabled?: boolean }>(apiUrl('/api/auth/credits-gate'), {
      method: 'POST',
      body: JSON.stringify({ estimatedCredits: required }),
    });
    if (res.disabled) {
      await consumeLoggedInTrialGeminiSlotOrThrow(limit);
    }
    return;
  } catch (e) {
    if (e instanceof HttpRequestError && (e.status === 401 || e.status === 404)) {
      if (e.status === 404) {
        console.warn(
          '[proxy-gate] POST /api/auth/credits-gate 返回 404，已按访客额度本机计数。请确认 auth-api 为当前版本。'
        );
      }
      consumeGuestTrialSlotOrThrow(limit);
      return;
    }
    if (e instanceof HttpRequestError && e.status === 429) {
      throw new Error(e.message || `试用通道每日限 ${limit} 次任务`);
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
