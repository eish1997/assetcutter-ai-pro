import { describe, expect, it } from 'vitest';
import { meterReadingFromGeminiProxy } from '../services/observability/metering/adapters/gemini';
import { DEFAULT_PRICE_CATALOG, estimateUsageCostUsd, findPriceCatalogEntry } from '../services/observability/metering/estimateCost';
import { splitMeterReadingToDrafts } from '../services/observability/metering/splitDrafts';

describe('metering pipeline', () => {
  it('splits gemini 4K image reading into :in and :out token drafts', () => {
    const reading = meterReadingFromGeminiProxy({
      registryId: 'gemini-3-pro-image-preview',
      provider: 'vertex',
      usageMetadata: { promptTokenCount: 1560, candidatesTokenCount: 2000 },
    });
    expect(reading.modality).toBe('image');
    const drafts = splitMeterReadingToDrafts(reading);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]!.idempotencySuffix).toBe(':in');
    expect(drafts[0]!.quantityIn).toBe(1560);
    expect(drafts[1]!.idempotencySuffix).toBe(':out');
    expect(drafts[1]!.quantityOut).toBe(2000);
    expect(drafts[1]!.imageOutputTokens).toBe(true);
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

  it('falls back to output_image when no candidate tokens', () => {
    const reading = meterReadingFromGeminiProxy({
      registryId: 'gemini-3.1-flash-image-preview',
      provider: 'vertex',
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 0 },
    });
    const drafts = splitMeterReadingToDrafts(reading);
    expect(drafts).toHaveLength(2);
    expect(drafts[1]!.meterKind).toBe('image');
    expect(drafts[1]!.meta).toMatchObject({ usagePart: 'output', outputKind: 'image' });
  });
});
