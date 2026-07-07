import { useCallback, useEffect, useState } from 'react';
import { fetchCreditBalance } from '../services/creditsApi';
import { CREDITS_BALANCE_CHANGED_EVENT } from '../shared/credits';

export type CreditBalanceState = {
  balance: number | null;
  loading: boolean;
  reload: () => Promise<void>;
};

/** 登录用户 AI 积分余额；监听 focus 与任务完成后的刷新事件 */
export function useCreditBalance(userId: string | null | undefined): CreditBalanceState {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!userId) {
      setBalance(null);
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
    } catch {
      setBalance(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setBalance(null);
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

  return { balance, loading, reload };
}
