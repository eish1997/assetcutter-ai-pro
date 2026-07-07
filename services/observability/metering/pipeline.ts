import type { BillingDecision } from '../../../shared/billingDecision';
import type { UsageEventInput } from '../../../shared/usageBilling';
import type { MeterReading } from '../../../shared/observability/meterReading';
import { priceUsageQuote } from '../../../shared/pricing/pricingEngine';
import { DEFAULT_PRICE_CATALOG, estimateUsageCostUsd, findPriceCatalogEntry } from './estimateCost';
import { resolveBillingSkuFromRegistry } from './resolveBillingSku';
import { splitMeterReadingToDrafts } from './splitDrafts';
import { emitUsageEvents, emitUsageEventsAwait } from '../usageEmitFacade';

export type EmitMeteredUsageArgs = {
  reading: MeterReading;
  registryId: string;
  billingSku?: string;
  idempotencyPrefix: string;
  requestId: string;
  jobKind?: string;
  upstreamTaskId?: string;
  extraMeta?: Record<string, unknown>;
  billingDecision?: BillingDecision;
};

function buildMeteredUsageEvents(args: EmitMeteredUsageArgs): UsageEventInput[] {
  const registryId = String(args.registryId || '').trim();
  const billingSku =
    String(args.billingSku || '').trim() ||
    resolveBillingSkuFromRegistry(registryId, args.reading.modality);
  const entry = findPriceCatalogEntry(DEFAULT_PRICE_CATALOG, billingSku);
  const splitDrafts = splitMeterReadingToDrafts(args.reading);
  const prefix = String(args.idempotencyPrefix || '').trim();
  if (!prefix) return [];

  const byokFromDecision =
    args.billingDecision != null && args.billingDecision.routeKind !== 'platform';

  return splitDrafts.map((draft) => {
    let costUsdEst = estimateUsageCostUsd(entry, {
      meterKind: draft.meterKind,
      quantityIn: draft.quantityIn,
      quantityOut: draft.quantityOut,
      quantity: draft.quantity,
      imageOutputTokens: draft.imageOutputTokens,
    });
    if (byokFromDecision) {
      costUsdEst = null;
    }
    const meta: Record<string, unknown> =
      Object.keys(draft.meta).length || args.extraMeta
        ? { ...args.extraMeta, ...draft.meta }
        : {};
    if (byokFromDecision) {
      meta.byok = true;
    }
    const quote = priceUsageQuote({
      billingSku,
      meterKind: draft.meterKind,
      quantityIn: draft.quantityIn,
      quantityOut: draft.quantityOut,
      quantity: draft.quantity,
      usagePart: draft.meta.usagePart as 'input' | 'output' | undefined,
      outputKind: draft.meta.outputKind as string | undefined,
      imageOutputTokens: draft.imageOutputTokens,
      byok: byokFromDecision,
    });
    if (!byokFromDecision && quote.creditsCharge > 0) {
      meta.creditsCharge = quote.creditsCharge;
    }
    return {
      idempotencyKey: `${prefix}${draft.idempotencySuffix}`,
      provider: args.reading.provider,
      billingSku,
      meterKind: draft.meterKind,
      quantityIn: draft.quantityIn,
      quantityOut: draft.quantityOut,
      quantity: draft.quantity,
      unit: draft.unit,
      registryId,
      jobKind: args.jobKind,
      costUsdEst: quote.costUsdEst ?? costUsdEst,
      costConfidence: draft.costConfidence,
      creditsCharged: byokFromDecision ? 0 : quote.creditsCharge,
      requestId: args.requestId,
      upstreamTaskId: args.upstreamTaskId,
      status: 'succeeded' as const,
      meta: Object.keys(meta).length ? meta : undefined,
    };
  });
}

/** L2 计量管线出口：MeterReading → 拆分 → 估价 → 写入 usage_events（异步，兼容旧路径） */
export function emitMeteredUsage(args: EmitMeteredUsageArgs): void {
  const events = buildMeteredUsageEvents(args);
  if (!events.length) return;
  emitUsageEvents(events);
}

/** 同步扣费：须在 AI 成功返回给用户前 await */
export async function emitMeteredUsageAwait(args: EmitMeteredUsageArgs): Promise<void> {
  const events = buildMeteredUsageEvents(args);
  if (!events.length) return;
  await emitUsageEventsAwait(events);
}

import { peekCreditsPrechargeSession } from "./creditsPrechargeSession";

/** 交付后异步结算：无预扣会话时不阻塞返回；有会话时须 await（见 geminiService） */
export function emitMeteredUsageAfterDelivery(args: EmitMeteredUsageArgs): void {
  void emitMeteredUsageAwait(args).catch((e) => {
    try {
      const msg = e instanceof Error ? e.message : String(e);
      if (import.meta.env.DEV) {
        console.warn('[usage-billing] 交付后结算失败（将依赖对账/重试）:', msg);
      }
    } catch {
      /* ignore */
    }
  });
}
