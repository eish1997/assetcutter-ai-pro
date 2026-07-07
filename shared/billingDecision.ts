/**
 * 执行层显式传递的计费决策（不依赖 correlationContext peek）。
 * @see docs/adr/统一派发积分闸门-v2.md
 */
import type { BillingRouteDecision, BillingRouteKind } from './billingRoute';

export type PlatformReserve = {
  reserveKey: string;
  estimatedCredits: number;
  release: (outcome: 'success' | 'failed') => Promise<void>;
};

export type BillingDecision = BillingRouteDecision & {
  jobKind: string;
  registryId: string;
  role: 'text' | 'image';
  channel?: string;
  minCredits: number;
  platformReserve?: PlatformReserve;
};

export type { BillingRouteKind };
