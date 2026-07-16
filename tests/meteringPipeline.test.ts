import { describe, expect, it } from 'vitest';
import { meterReadingFromAiWorkerProxy } from '../services/observability/metering/adapters/gemini';
import { DEFAULT_PRICE_CATALOG, estimateUsageCostUsd, findPriceCatalogEntry } from '../services/observability/metering/estimateCost';
import { splitMeterReadingToDrafts } from '../services/observability/metering/splitDrafts';
import { priceUsageQuote } from '../shared/pricing/pricingEngine';

describe('metering pipeline', () => {
  it('emits one flat-rate image draft with prompt tokens in meta (C-end billing)', () => {
    const reading = meterReadingFromAiWorkerProxy({
      registryId: 'gemini-3-pro-image-preview',
      provider: 'vertex',
      usageMetadata: { promptTokenCount: 1560, candidatesTokenCount: 2000 },
    });
    expect(reading.modality).toBe('image');
    const drafts = splitMeterReadingToDrafts(reading);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.meterKind).toBe('image');
    expect(drafts[0]!.quantity).toBe(1);
    expect(drafts[0]!.meta).toMatchObject({
      flatRate: true,
      promptTokenCount: 1560,
      outputTokenCount: 2000,
      outputKind: 'image',
    });
  });

  it('prices image output tokens at imageOutputPer1m via split draft flag', () => {
    const entry = findPriceCatalogEntry(DEFAULT_PRICE_CATALOG, 'image.gemini.pro');
    const cost = estimateUsageCostUsd(entry, {
      meterKind: 'token',
      quantityOut: 2000,
      imageOutputTokens: true,
    });
    expect(cost).toBeCloseTo(0.24, 5);
  });

  it('falls back to one image when no candidate tokens', () => {
    const reading = meterReadingFromAiWorkerProxy({
      registryId: 'gemini-3.1-flash-image-preview',
      provider: 'vertex',
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 0 },
    });
    const drafts = splitMeterReadingToDrafts(reading);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.meterKind).toBe('image');
    expect(drafts[0]!.meta).toMatchObject({ flatRate: true, promptTokenCount: 200 });
  });

  it('applies perUnit floor for image.gemini.flash via priceUsageQuote', () => {
    const quote = priceUsageQuote({
      billingSku: 'image.gemini.flash',
      meterKind: 'image',
      quantity: 1,
    });
    expect(quote.costUsdEst).toBeCloseTo(0.039, 5);
    expect(quote.creditsCharge).toBe(39);
  });
});
