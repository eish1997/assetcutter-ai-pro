import type { CreditBalance, CreditLedgerEntry } from '../shared/credits';
import { CREDITS_EXCEEDED_CODE, creditsExceededUserMessage } from '../shared/credits';
import { apiUrl } from './apiBase';
import { HttpRequestError, requestJson } from './httpClient';

export type CreditLedgerResponse = {
  entries: CreditLedgerEntry[];
  nextCursor: string | null;
  limit: number;
};

export async function fetchCreditBalance() {
  return requestJson<CreditBalance & { userId?: string }>(apiUrl('/api/credits/balance'), { cache: 'no-store' });
}

/** 登录用户积分预检；余额缺失或不足时 fail-closed */
export async function assertCreditBalanceAtLeast(min: number): Promise<void> {
  const required = Math.max(1, Math.floor(Number(min) || 1));
  const bal = await fetchCreditBalance();
  const available = Number(bal?.available ?? bal?.balance);
  if (!Number.isFinite(available) || available < required) {
    throw new HttpRequestError(
      creditsExceededUserMessage(Number.isFinite(available) ? available : undefined, required),
      403,
      CREDITS_EXCEEDED_CODE,
      {
        balance: Number.isFinite(available) ? available : undefined,
        available: Number.isFinite(available) ? available : undefined,
        required,
      }
    );
  }
}

export type PrechargeCreditsResult = {
  prechargeKey: string;
  reserveKey: string;
  amount: number;
  remaining: number;
  allocated?: number;
};

/** 先预扣费：立即扣减 balance，返回 prechargeKey 供后续 L2 结算 */
export async function prechargePlatformCredits(
  amount: number,
  scopeKey?: string
): Promise<PrechargeCreditsResult> {
  const amt = Math.max(1, Math.floor(Number(amount) || 1));
  const res = await requestJson<
    PrechargeCreditsResult & { ok?: boolean; disabled?: boolean; balance?: number }
  >(apiUrl('/api/auth/credits-precharge'), {
    method: 'POST',
    body: JSON.stringify({
      amount: amt,
      ...(scopeKey ? { scopeKey: String(scopeKey).trim() } : {}),
    }),
  });
  if (res.disabled) {
    return {
      prechargeKey: '',
      reserveKey: '',
      amount: 0,
      remaining: 0,
    };
  }
  const key = String(res.prechargeKey || res.reserveKey || '').trim();
  return {
    prechargeKey: key,
    reserveKey: key,
    amount: Number(res.amount) || amt,
    remaining: Number(res.remaining ?? res.amount) || amt,
    allocated: Number(res.allocated) || 0,
  };
}

export async function fetchCreditLedger(opts?: { limit?: number; cursor?: string }) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.cursor) params.set('cursor', opts.cursor);
  const qs = params.toString();
  return requestJson<CreditLedgerResponse>(apiUrl(`/api/credits/ledger${qs ? `?${qs}` : ''}`), {
    cache: 'no-store',
  });
}

/** 释放未结算的积分预扣；fullVoid 时全额退还并回滚 lifetimeSpent（任务失败无交付） */
export async function releaseCreditReserve(
  reserveKey: string,
  opts?: { fullVoid?: boolean }
): Promise<boolean> {
  const key = String(reserveKey || '').trim();
  if (!key) return false;
  try {
    const res = await requestJson<{ released?: boolean; disabled?: boolean }>(
      apiUrl('/api/auth/credits-release'),
      {
        method: 'POST',
        body: JSON.stringify({ reserveKey: key, fullVoid: Boolean(opts?.fullVoid) }),
      }
    );
    return Boolean(res.released);
  } catch {
    return false;
  }
}
