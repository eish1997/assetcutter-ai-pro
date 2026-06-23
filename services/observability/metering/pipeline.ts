import type { UsageEventInput } from '../../../shared/usageBilling';
import type { MeterReading } from '../../../shared/observability/meterReading';
import { DEFAULT_PRICE_CATALOG, estimateUsageCostUsd, findPriceCatalogEntry } from './estimateCost';
import { resolveBillingSkuFromRegistry } from './resolveBillingSku';
import { splitMeterReadingToDrafts } from './splitDrafts';
import { emitUsageEvents } from '../usageEmitFacade';

export type EmitMeteredUsageArgs = {
  reading: MeterReading;
  registryId: string;
  billingSku?: string;
  idempotencyPrefix: string;
  requestId: string;
  jobKind?: string;
  upstreamTaskId?: string;
  extraMeta?: Record<string, unknown>;
};

/** L2 计量管线出口：MeterReading → 拆分 → 估价 → 写入 usage_events */
export function emitMeteredUsage(args: EmitMeteredUsageArgs): void {
  const registryId = String(args.registryId || '').trim();
  const billingSku =
    String(args.billingSku || '').trim() ||
    resolveBillingSkuFromRegistry(registryId, args.reading.modality);
  const entry = findPriceCatalogEntry(DEFAULT_PRICE_CATALOG, billingSku);
  const splitDrafts = splitMeterReadingToDrafts(args.reading);
  const prefix = String(args.idempotencyPrefix || '').trim();
  if (!prefix) return;

  const events: UsageEventInput[] = splitDrafts.map((draft) => {
    const costUsdEst = estimateUsageCostUsd(entry, {
      meterKind: draft.meterKind,
      quantityIn: draft.quantityIn,
      quantityOut: draft.quantityOut,
      quantity: draft.quantity,
      imageOutputTokens: draft.imageOutputTokens,
    });
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
      costUsdEst,
      costConfidence: draft.costConfidence,
      requestId: args.requestId,
      upstreamTaskId: args.upstreamTaskId,
      status: 'succeeded',
      meta:
        Object.keys(draft.meta).length || args.extraMeta
          ? { ...args.extraMeta, ...draft.meta }
          : undefined,
    };
  });

  emitUsageEvents(events);
}
