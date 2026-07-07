/**
 * 工作流级先预扣费会话：分段任务在开始前一次性扣足，执行中复用 prechargeKey。
 */
import { dispatchCreditsBalanceChanged, proxyGateMinCreditsForJob } from '../shared/credits';
import {
  prechargePlatformCredits,
  releaseCreditReserve,
  type PrechargeCreditsResult,
} from './creditsApi';
import { setLastCreditsReserveKey } from './creditsProxyBridge';

export type CreditsPrechargeSession = {
  prechargeKey: string;
  amount: number;
  estimatedRemaining: number;
  scopeKey: string;
};

let activeSession: CreditsPrechargeSession | null = null;

export function peekCreditsPrechargeSession(): CreditsPrechargeSession | null {
  return activeSession;
}

/** runTask / gate 预扣成功后登记会话，供后续步骤复用同一 prechargeKey */
export function adoptCreditsPrechargeSession(res: PrechargeCreditsResult, scopeKey: string): void {
  const scope = String(scopeKey || '').trim();
  if (!scope || !res.prechargeKey) return;
  activeSession = {
    prechargeKey: res.prechargeKey,
    amount: res.amount,
    estimatedRemaining: res.remaining,
    scopeKey: scope,
  };
  setLastCreditsReserveKey(res.prechargeKey);
}

export function noteCreditsPrechargeAllocation(credits: number): void {
  if (!activeSession) return;
  const c = Math.max(0, Math.floor(Number(credits) || 0));
  activeSession.estimatedRemaining = Math.max(0, activeSession.estimatedRemaining - c);
}

/**
 * 任务开始前先预扣费（幂等 scopeKey 防重复提交双扣）
 * @deprecated Wave C：UI 不再调用；执行层改用 `PlatformReserve` / `prechargePlatformCredits`。
 */
export async function beginCreditsPrechargeSession(amount: number, scopeKey: string): Promise<CreditsPrechargeSession> {
  const amt = Math.max(1, Math.floor(Number(amount) || 1));
  const scope = String(scopeKey || '').trim() || `anon:${Date.now()}`;
  const res = await prechargePlatformCredits(amt, scope);
  activeSession = {
    prechargeKey: res.prechargeKey,
    amount: res.amount,
    estimatedRemaining: res.remaining,
    scopeKey: scope,
  };
  setLastCreditsReserveKey(res.prechargeKey);
  dispatchCreditsBalanceChanged();
  return activeSession;
}

export type CreditsPrechargeOutcome = 'success' | 'failed';

/**
 * 任务结束：success 退未用预扣；failed 全额退还（含已 allocate，能力集合失败）
 * @deprecated Wave C：UI 不再调用；执行层在 reserve release 时结算。
 */
export async function endCreditsPrechargeSession(
  outcome: CreditsPrechargeOutcome = 'success'
): Promise<void> {
  const session = activeSession;
  activeSession = null;
  if (!session) return;
  await releaseCreditReserve(session.prechargeKey, { fullVoid: outcome === 'failed' });
  dispatchCreditsBalanceChanged();
}

/** 当前会话是否还能覆盖下一步 AI 最低消耗 */
export function creditsPrechargeCoversJobKind(jobKind: string | null | undefined): boolean {
  const session = activeSession;
  if (!session) return false;
  const min = proxyGateMinCreditsForJob(jobKind);
  return session.estimatedRemaining >= min;
}
