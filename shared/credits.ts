/** 统一积分制 — 前后端对齐（server 侧见 server/credits-math.js，数值须一致） */

export const CREDITS_PER_USD = 1000;

export const CREDITS_EXCEEDED_CODE = 'CREDITS_EXCEEDED';

export const CREDITS_BALANCE_CHANGED_EVENT = 'ac:credits-balance-changed';

/** 顶栏 Chip 低余额着色阈值（低于此值且 >0 显示警告色） */
export const CREDITS_LOW_BALANCE_THRESHOLD = 50;

/** 工作流 proxy 准入：按任务类型估算最低消耗（与价目表量级对齐，偏保守） */
/** 工作流 runTask 分支 → proxy gate jobKind（预检与 server gate 对齐） */
export function proxyGateJobKindForWorkflowBranch(
  branch: string,
  module?: { category?: string } | null
): string {
  switch (branch) {
    case 'branch_generate_3d':
      return 'workflow_generate_3d';
    case 'branch_preset_execute_capability': {
      const cat = String(module?.category || '').trim();
      if (cat === 'generate_video') return 'workflow_generate_video';
      if (cat === 'text_to_image' || cat === 'image_edit') return 'workflow_text_to_image';
      if (cat === 'understand') return 'workflow_understand';
      return 'workflow_chat';
    }
    case 'branch_capability_set':
      return 'workflow_text_to_image';
    default:
      return 'workflow_chat';
  }
}

export function proxyGateMinCreditsForJob(jobKind: string | null | undefined): number {
  switch (String(jobKind || '').trim()) {
    case 'workflow_generate_3d':
      return 500;
    case 'workflow_generate_video':
      return 100;
    case 'workflow_text_to_image':
    case 'workflow_image_edit':
      return 50;
    case 'workflow_understand':
      return 5;
    case 'workflow_chat':
      return 2;
    default:
      return 1;
  }
}

export function dispatchCreditsBalanceChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CREDITS_BALANCE_CHANGED_EVENT));
}

export function isCreditsExceededError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: string }).code;
    if (code === CREDITS_EXCEEDED_CODE) return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /积分不足|CREDITS_EXCEEDED/i.test(msg);
}

export function creditsExceededUserMessage(): string {
  return '积分不足，无法完成本次 AI 任务。请联系管理员发放积分，或在「设置 → AI 用量」查看余额与流水。';
}

export type CreditLedgerKind = 'grant' | 'admin_deduct' | 'consume' | 'refund';

export type CreditBalance = {
  balance: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
  updatedAt?: string;
};

export type CreditLedgerEntry = {
  id: string;
  userId: string;
  delta: number;
  balanceAfter: number;
  kind: CreditLedgerKind;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
  createdBy?: string | null;
  createdAt: string;
};

/** 1 积分 ≈ $0.001 USD 估算成本 */
export function usdEstToCredits(costUsdEst: number | null | undefined): number {
  if (costUsdEst == null || !Number.isFinite(costUsdEst) || costUsdEst <= 0) return 0;
  return Math.ceil(costUsdEst * CREDITS_PER_USD);
}

export function fmtCredits(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.floor(n).toLocaleString('zh-CN');
}

/** 窄侧栏（约 56px）：短标签，完整值放 title */
export function fmtCreditsSidebar(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = Math.floor(n);
  if (v >= 100_000_000) {
    const yi = v / 100_000_000;
    return Number.isInteger(yi) ? `${yi}亿` : `${yi.toFixed(1).replace(/\.0$/, '')}亿`;
  }
  if (v >= 10_000) {
    const wan = v / 10_000;
    return Number.isInteger(wan) ? `${wan}万` : `${wan.toFixed(1).replace(/\.0$/, '')}万`;
  }
  if (v >= 1000) return String(v);
  return String(v);
}

const LEDGER_KIND_LABELS: Record<CreditLedgerKind, string> = {
  grant: '发放',
  admin_deduct: '扣回',
  consume: '消耗',
  refund: '退款',
};

export function creditLedgerKindLabel(kind: CreditLedgerKind | string): string {
  return LEDGER_KIND_LABELS[kind as CreditLedgerKind] || kind;
}
