import type { PriceCatalogEntry, UsageGeminiMetadata, UsageMeterKind } from '../shared/usageBilling';
import { DEFAULT_PRICE_CATALOG } from '../shared/usageBillingCatalog';

export { DEFAULT_PRICE_CATALOG };

export function estimateUsageCostUsd(
  entry: PriceCatalogEntry | null | undefined,
  input: {
    meterKind: UsageMeterKind;
    quantityIn?: number;
    quantityOut?: number;
    quantity?: number;
  }
): number | null {
  if (!entry) return null;
  const markup = 1 + Math.max(0, Number(entry.markupPct) || 0) / 100;
  if (input.meterKind === 'token') {
    const inTok = Math.max(0, Number(input.quantityIn) || 0);
    const outTok = Math.max(0, Number(input.quantityOut) || 0);
    const inRate = Number(entry.inputPer1m);
    const outRate = Number(entry.outputPer1m);
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

export type GeminiUsageMeterDraft = {
  meterKind: UsageMeterKind;
  quantityIn: number;
  quantityOut: number;
  quantity: number;
  unit: string;
  costConfidence: 'exact' | 'estimated';
};

export type GeminiProxyUsageDraft = {
  idempotencySuffix: string;
  meter: GeminiUsageMeterDraft;
  meta: Record<string, unknown>;
};

export function parseGeminiUsageTokenCounts(
  usage: UsageGeminiMetadata | null | undefined
): { prompt: number; candidates: number } {
  const prompt = Math.max(0, Math.floor(Number(usage?.promptTokenCount) || 0));
  const candidates = Math.max(0, Math.floor(Number(usage?.candidatesTokenCount) || 0));
  return { prompt, candidates };
}

/** 生图：输入 token（含参考图/文本）与输出 token/张 拆成独立幂等事件，对齐官方双维计费。 */
export function buildGeminiProxyUsageDrafts(args: {
  usageMetadata: UsageGeminiMetadata | null | undefined;
  role: 'text' | 'image';
}): GeminiProxyUsageDraft[] {
  const metaBase = args.usageMetadata ? { usageMetadata: args.usageMetadata } : {};
  if (args.role !== 'image') {
    const meter = usageFromGeminiMetadata(args.usageMetadata, 'token');
    return [{ idempotencySuffix: '', meter, meta: metaBase }];
  }

  const { prompt, candidates } = parseGeminiUsageTokenCounts(args.usageMetadata);
  const drafts: GeminiProxyUsageDraft[] = [];

  if (prompt > 0) {
    drafts.push({
      idempotencySuffix: ':in',
      meter: {
        meterKind: 'token',
        quantityIn: prompt,
        quantityOut: 0,
        quantity: prompt,
        unit: 'token',
        costConfidence: 'exact',
      },
      meta: { ...metaBase, usagePart: 'input' },
    });
  }

  if (candidates > 0) {
    drafts.push({
      idempotencySuffix: ':out',
      meter: {
        meterKind: 'token',
        quantityIn: 0,
        quantityOut: candidates,
        quantity: candidates,
        unit: 'token',
        costConfidence: 'exact',
      },
      meta: { ...metaBase, usagePart: 'output', outputKind: 'token' },
    });
  } else {
    drafts.push({
      idempotencySuffix: ':out',
      meter: {
        meterKind: 'image',
        quantityIn: 0,
        quantityOut: 0,
        quantity: 1,
        unit: 'image',
        costConfidence: 'estimated',
      },
      meta: { ...metaBase, usagePart: 'output', outputKind: 'image' },
    });
  }

  return drafts;
}

export function usageFromGeminiMetadata(
  usage: UsageGeminiMetadata | null | undefined,
  fallbackMeterKind: UsageMeterKind = 'token'
): {
  meterKind: UsageMeterKind;
  quantityIn: number;
  quantityOut: number;
  quantity: number;
  unit: string;
  costConfidence: 'exact' | 'estimated';
} {
  const prompt = Math.max(0, Math.floor(Number(usage?.promptTokenCount) || 0));
  const out = Math.max(0, Math.floor(Number(usage?.candidatesTokenCount) || 0));
  const total = Math.max(0, Math.floor(Number(usage?.totalTokenCount) || prompt + out));
  if (prompt > 0 || out > 0 || total > 0) {
    return {
      meterKind: 'token',
      quantityIn: prompt,
      quantityOut: out,
      quantity: total || prompt + out,
      unit: 'token',
      costConfidence: 'exact',
    };
  }
  if (fallbackMeterKind === 'image') {
    return {
      meterKind: 'image',
      quantityIn: 0,
      quantityOut: 0,
      quantity: 1,
      unit: 'image',
      costConfidence: 'estimated',
    };
  }
  return {
    meterKind: fallbackMeterKind,
    quantityIn: 0,
    quantityOut: 0,
    quantity: 0,
    unit: fallbackMeterKind,
    costConfidence: 'estimated' as const,
  };
}

export function findPriceCatalogEntry(
  catalog: PriceCatalogEntry[],
  billingSku: string
): PriceCatalogEntry | null {
  const sku = String(billingSku || '').trim();
  if (!sku) return null;
  return catalog.find((e) => e.billingSku === sku) ?? null;
}
