/** 统一积分制 — 前后端对齐（server 侧见 server/credits-math.js，数值须一致） */

import { quoteGateMinCreditsForJob } from './pricing/pricingEngine';

export const CREDITS_PER_USD = 1000;

export const CREDITS_EXCEEDED_CODE = 'CREDITS_EXCEEDED';

export const LOGIN_REQUIRED_CODE = 'LOGIN_REQUIRED';

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
      if (cat === 'text_to_image' || cat === 'image_edit' || cat === 'image_to_image') {
        return 'workflow_text_to_image';
      }
      if (cat === 'understand') return 'workflow_understand';
      return 'workflow_chat';
    }
    case 'branch_capability_set':
      return 'workflow_text_to_image';
    default:
      return 'workflow_chat';
  }
}

/** 1 积分 ≈ $0.001 USD 估算成本 */
export function usdEstToCredits(costUsdEst: number | null | undefined): number {
  if (costUsdEst == null || !Number.isFinite(costUsdEst) || costUsdEst <= 0) return 0;
  return Math.ceil(costUsdEst * CREDITS_PER_USD);
}

export function proxyGateMinCreditsForJob(jobKind: string | null | undefined): number {
  return quoteGateMinCreditsForJob(jobKind);
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

export function creditsExceededUserMessage(available?: number, required?: number): string {
  const base =
    '积分不足，无法完成本次 AI 任务。请联系管理员发放积分，或在「设置 → AI 用量」查看余额与流水。';
  if (
    available != null &&
    required != null &&
    Number.isFinite(available) &&
    Number.isFinite(required) &&
    required > available
  ) {
    const shortfall = Math.max(1, Math.ceil(required - available));
    return `积分不足，还差 ${fmtCredits(shortfall)} 积分。请联系管理员发放积分，或在「设置 → AI 用量」查看余额与流水。`;
  }
  return base;
}

/** 余额请求进行中且尚无缓存值时（勿误报「积分不足」） */
export function creditsBalanceLoadingMessage(): string {
  return '正在读取积分余额，请稍候再试。';
}

/** 已登录但 balance API 失败（跨域 Cookie / 会话过期），与真「余额不足」区分 */
export function creditsBalanceUnavailableMessage(): string {
  return '无法读取积分余额，请重新登录或在「设置 → AI 用量」刷新；若仍失败请检查网络能否访问 auth-api。';
}

export function platformAiLoginRequiredMessage(): string {
  return '请先登录后再使用 AI 生成。';
}

export type CreditLedgerKind =
  | 'grant'
  | 'admin_deduct'
  | 'consume'
  | 'refund'
  | 'promo_grant'
  | 'promo_expire';

export type CreditBalance = {
  balance: number;
  reserved?: number;
  available?: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
  updatedAt?: string;
  /** 未过期活动桶剩余（优先消耗） */
  promoRemaining?: number;
  /** 永久积分 ≈ balance − promoRemaining */
  permanentBalance?: number;
  /** 最近一批活动积分到期时间（ISO） */
  nearestPromoExpiry?: string | null;
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

export function fmtCredits(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.floor(n).toLocaleString('zh-CN');
}

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
  promo_grant: '活动赠送',
  promo_expire: '活动到期清零',
};

/** 活动积分到期日（zh-CN 短日期，如 7/15） */
export function fmtPromoExpiryDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/** Chip / 侧栏：活动积分与最近到期提示 */
export function fmtPromoExpiryHint(
  promoRemaining: number | null | undefined,
  nearestExpiry: string | null | undefined
): string {
  if (!promoRemaining || promoRemaining <= 0 || !nearestExpiry) return '';
  const date = fmtPromoExpiryDate(nearestExpiry);
  if (!date) return '';
  return `活动 ${fmtCredits(promoRemaining)} · ${date} 到期`;
}

export function creditLedgerKindLabel(kind: CreditLedgerKind | string): string {
  return LEDGER_KIND_LABELS[kind as CreditLedgerKind] || kind;
}

/** 提交前预检：展示「约 N 积分起」 */
export function fmtProxyGateEstimate(jobKind: string | null | undefined): string {
  const n = proxyGateMinCreditsForJob(jobKind);
  if (n <= 0) return '';
  return `约 ${fmtCredits(n)} 积分起`;
}
