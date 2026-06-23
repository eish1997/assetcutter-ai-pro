import type { PriceCatalogEntry, UsageMeterKind } from '../../../shared/usageBilling';
import { DEFAULT_PRICE_CATALOG } from '../../../shared/usageBillingCatalog';

export { DEFAULT_PRICE_CATALOG };

export function estimateUsageCostUsd(
  entry: PriceCatalogEntry | null | undefined,
  input: {
    meterKind: UsageMeterKind;
    quantityIn?: number;
    quantityOut?: number;
    quantity?: number;
    imageOutputTokens?: boolean;
  }
): number | null {
  if (!entry) return null;
  const markup = 1 + Math.max(0, Number(entry.markupPct) || 0) / 100;
  if (input.meterKind === 'token') {
    const inTok = Math.max(0, Number(input.quantityIn) || 0);
    const outTok = Math.max(0, Number(input.quantityOut) || 0);
    const inRate = Number(entry.inputPer1m);
    const useImageOutRate =
      Boolean(input.imageOutputTokens) ||
      (entry.meterKind === 'image' && outTok > 0 && inTok === 0);
    const outRate = useImageOutRate
      ? Number(entry.imageOutputPer1m ?? entry.outputPer1m)
      : Number(entry.outputPer1m);
    if (!Number.isFinite(inRate) && !Number.isFinite(outRate)) return null;
    const cost =
      (inTok / 1_000_000) * (Number.isFinite(inRate) ? inRate : 0) +
      (outTok / 1_000_000) * (Number.isFinite(outRate) ? outRate : 0);
    return Math.round(cost * markup * 1e8) / 1e8;
  }
  const per = Number(entry.perUnit);
  if (!Number.isFinite(per)) return null;
  const qty = Math.max(0, Number(input.quantity) || 0);
  return Math.round(qty * per * markup * 1e8) / 1e8;
}

export function findPriceCatalogEntry(
  catalog: PriceCatalogEntry[],
  billingSku: string
): PriceCatalogEntry | null {
  const sku = String(billingSku || '').trim();
  if (!sku) return null;
  return catalog.find((e) => e.billingSku === sku) ?? null;
}
