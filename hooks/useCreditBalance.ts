import { useCallback, useEffect, useState } from 'react';
import { fetchCreditBalance } from '../services/creditsApi';
import { CREDITS_BALANCE_CHANGED_EVENT } from '../shared/credits';

export type CreditBalanceState = {
  balance: number | null;
  promoRemaining: number | null;
  permanentBalance: number | null;
  nearestPromoExpiry: string | null;
  loading: boolean;
  reload: () => Promise<void>;
};

/** 登录用户 AI 积分余额；监听 focus 与任务完成后的刷新事件 */
export function useCreditBalance(userId: string | null | undefined): CreditBalanceState {
  const [balance, setBalance] = useState<number | null>(null);
  const [promoRemaining, setPromoRemaining] = useState<number | null>(null);
  const [permanentBalance, setPermanentBalance] = useState<number | null>(null);
  const [nearestPromoExpiry, setNearestPromoExpiry] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!userId) {
      setBalance(null);
      setPromoRemaining(null);
      setPermanentBalance(null);
      setNearestPromoExpiry(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchCreditBalance();
      const available =
        typeof res.available === 'number'
          ? res.available
          : typeof res.balance === 'number'
            ? res.balance
            : 0;
      setBalance(available);
      setPromoRemaining(typeof res.promoRemaining === 'number' ? res.promoRemaining : null);
      setPermanentBalance(typeof res.permanentBalance === 'number' ? res.permanentBalance : null);
      setNearestPromoExpiry(res.nearestPromoExpiry ?? null);
    } catch {
      setBalance(null);
      setPromoRemaining(null);
      setPermanentBalance(null);
      setNearestPromoExpiry(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setBalance(null);
      setPromoRemaining(null);
      setPermanentBalance(null);
      setNearestPromoExpiry(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void reload();
  }, [userId, reload]);

  useEffect(() => {
    if (!userId) return;
    const onFocus = () => {
      void reload();
    };
    const onCreditsChanged = () => {
      void reload();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener(CREDITS_BALANCE_CHANGED_EVENT, onCreditsChanged);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(CREDITS_BALANCE_CHANGED_EVENT, onCreditsChanged);
    };
  }, [userId, reload]);

  return { balance, promoRemaining, permanentBalance, nearestPromoExpiry, loading, reload };
}
