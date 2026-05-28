/**
 * 试用（代理）通道配额：登录用户由 auth-api 按账号计数；未登录为设备级 localStorage（可清空）。
 * 与 legacy `trial` 供应商解耦：凡走站点 bulk 代理且未自带 Gemini Key 时扣减。
 */
import { apiUrl } from './apiBase';
import { readLocalJson, scopedStorageKey, writeLocalJson } from './clientPersist';
import { HttpRequestError, requestJson } from './httpClient';
import { getUserApiKey } from './settingsStore';

/** 与 auth-api `TRIAL_GEMINI_DAILY_LIMIT` 对齐；访客提示与本地计数用同一上限（默认 20）。 */
function trialDailyLimitClient(): number {
  try {
    const raw = import.meta.env.VITE_TRIAL_GEMINI_DAILY_LIMIT;
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(1, Math.min(500, Math.floor(n)));
  } catch {
    /* ignore */
  }
  return 20;
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

/**
 * 在发起 `VITE_BULK_IMAGE_API` 异步任务前调用：占用一次试用额度（登录走服务端，未登录走本机计数）。
 */
export async function consumeTrialGeminiSlotBeforeProxyOrThrow(): Promise<void> {
  if (getUserApiKey()?.trim()) return;
  const limit = trialDailyLimitClient();
  try {
    await requestJson<{ ok?: boolean }>(apiUrl('/api/auth/trial-gemini/consume'), {
      method: 'POST',
      body: '{}',
    });
  } catch (e) {
    /** 404：多为本地 auth-api 未用当前代码重启，路由尚未挂载；与 401 一样走访客本机计数，避免能力名旁只显示「Not found」。 */
    if (e instanceof HttpRequestError && (e.status === 401 || e.status === 404)) {
      if (e.status === 404) {
        console.warn(
          '[trial-gemini] POST /api/auth/trial-gemini/consume 返回 404，已按访客额度本机计数。请确认已运行 npm run dev:auth-backend（9100）且为当前仓库版本。'
        );
      }
      consumeGuestTrialSlotOrThrow(limit);
      return;
    }
    if (e instanceof HttpRequestError && e.status === 429) {
      throw new Error(e.message || `试用通道每日限 ${limit} 次任务`);
    }
    const msg = String((e as Error)?.message ?? e);
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      try {
        if (import.meta.env.DEV) {
          console.warn(
            '[assetcutter] 试用额度接口未送达。请确认 auth-api 已监听 9100，且通过 Vite 同源访问 /api/auth（勿把 API 指到不可达地址）。'
          );
        }
      } catch {
        /* ignore */
      }
      throw new Error('无法连接账户服务，请检查网络后重试。');
    }
    throw e;
  }
}
