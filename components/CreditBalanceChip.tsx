import React from 'react';
import { useAuth } from './auth/AuthContext';
import {
  CREDITS_LOW_BALANCE_THRESHOLD,
  fmtCredits,
  fmtCreditsSidebar,
} from '../shared/credits';
import { useCreditBalance } from '../hooks/useCreditBalance';

/** 侧栏底栏状态块（只读 / 可点共用外壳） */
export const SIDEBAR_STATUS_SHELL_CLASS =
  'flex w-full min-w-0 items-center justify-center rounded-lg bg-white/[0.05] px-2 py-2 ring-1 ring-white/[0.07]';

export const SIDEBAR_STATUS_BTN_CLASS = `${SIDEBAR_STATUS_SHELL_CLASS} gap-1.5 hover:bg-white/[0.08] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]`;

type CreditBalanceChipProps = {
  className?: string;
  balanceOverride?: number | null;
  loadingOverride?: boolean;
};

/** 侧栏底栏：只读积分余额（不跳转） */
export const CreditBalanceChip: React.FC<CreditBalanceChipProps> = ({
  className = '',
  balanceOverride,
  loadingOverride,
}) => {
  const { user } = useAuth();
  const hook = useCreditBalance(user?.id);
  const loading = loadingOverride ?? hook.loading;
  const balance = balanceOverride !== undefined ? balanceOverride : hook.balance;

  if (!user) return null;

  const label = loading ? '…' : fmtCreditsSidebar(balance);
  const title =
    loading
      ? '加载积分余额…'
      : balance == null
        ? '积分余额暂不可用'
        : balance <= 0
          ? `积分已用完（${fmtCredits(balance)}）`
          : balance < CREDITS_LOW_BALANCE_THRESHOLD
            ? `积分偏低：${fmtCredits(balance)}`
            : `剩余 AI 积分 ${fmtCredits(balance)}`;

  return (
    <div
      className={`${SIDEBAR_STATUS_SHELL_CLASS} ${className}`}
      title={title}
      role="status"
      aria-label={title}
    >
      <span className="text-[8px] font-bold leading-[1.25] tabular-nums text-gray-300">{label}</span>
    </div>
  );
};

export default CreditBalanceChip;
