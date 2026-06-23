import type { UsageGeminiMetadata, UsageMeterKind } from '../shared/usageBilling';
import {
  meterReadingFromGeminiProxy,
  parseGeminiTokenCounts,
  usageFromGeminiMetadata,
} from './observability/metering/adapters/gemini';
import { splitMeterReadingToDrafts } from './observability/metering/splitDrafts';

export {
  DEFAULT_PRICE_CATALOG,
  estimateUsageCostUsd,
  findPriceCatalogEntry,
} from './observability/metering/estimateCost';

export { emitMeteredUsage } from './observability/metering/pipeline';
export { meterReadingFromGeminiProxy, usageFromGeminiMetadata };

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

/** @deprecated 请使用 metering/splitDrafts + adapters/gemini；保留供既有单测 */
export function buildGeminiProxyUsageDrafts(args: {
  usageMetadata: UsageGeminiMetadata | null | undefined;
  role: 'text' | 'image';
}): GeminiProxyUsageDraft[] {
  const registryId = args.role === 'image' ? 'gemini-image-preview' : 'gemini-text';
  const reading = meterReadingFromGeminiProxy({
    registryId,
    provider: 'gemini',
    usageMetadata: args.usageMetadata,
  });
  return splitMeterReadingToDrafts(reading).map((draft) => ({
    idempotencySuffix: draft.idempotencySuffix,
    meter: {
      meterKind: draft.meterKind,
      quantityIn: draft.quantityIn,
      quantityOut: draft.quantityOut,
      quantity: draft.quantity,
      unit: draft.unit,
      costConfidence: draft.costConfidence,
    },
    meta: draft.meta,
  }));
}

/** @deprecated 使用 parseGeminiTokenCounts */
export function parseGeminiUsageTokenCounts(
  usage: UsageGeminiMetadata | null | undefined
): { prompt: number; candidates: number } {
  return parseGeminiTokenCounts(usage);
}
