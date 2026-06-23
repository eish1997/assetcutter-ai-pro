import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRICE_CATALOG,
  buildGeminiProxyUsageDrafts,
  estimateUsageCostUsd,
  findPriceCatalogEntry,
  usageFromGeminiMetadata,
} from '../services/usageCost';

describe('usageCost', () => {
  it('estimates token cost from catalog', () => {
    const entry = findPriceCatalogEntry(DEFAULT_PRICE_CATALOG, 'llm.gemini.flash');
    expect(entry).not.toBeNull();
    const cost = estimateUsageCostUsd(entry, {
      meterKind: 'token',
      quantityIn: 1_000_000,
      quantityOut: 500_000,
    });
    expect(cost).toBeCloseTo(0.15 + 0.3, 5);
  });

  it('estimates image per-unit cost', () => {
    const entry = findPriceCatalogEntry(DEFAULT_PRICE_CATALOG, 'image.gemini.flash');
    const cost = estimateUsageCostUsd(entry, { meterKind: 'image', quantity: 2 });
    expect(cost).toBeCloseTo(0.078, 5);
  });

  it('parses gemini usage metadata', () => {
    const m = usageFromGeminiMetadata({
      promptTokenCount: 100,
      candidatesTokenCount: 50,
      totalTokenCount: 150,
    });
    expect(m.meterKind).toBe('token');
    expect(m.quantityIn).toBe(100);
    expect(m.quantityOut).toBe(50);
    expect(m.costConfidence).toBe('exact');
  });

  it('falls back to one image when no token metadata', () => {
    const m = usageFromGeminiMetadata(null, 'image');
    expect(m.meterKind).toBe('image');
    expect(m.quantity).toBe(1);
    expect(m.costConfidence).toBe('estimated');
  });

  it('splits image proxy usage into input token and output image drafts', () => {
    const drafts = buildGeminiProxyUsageDrafts({
      role: 'image',
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 0 },
    });
    expect(drafts).toHaveLength(2);
    expect(drafts[0]!.idempotencySuffix).toBe(':in');
    expect(drafts[0]!.meter.meterKind).toBe('token');
    expect(drafts[0]!.meter.quantityIn).toBe(200);
    expect(drafts[1]!.idempotencySuffix).toBe(':out');
    expect(drafts[1]!.meter.meterKind).toBe('image');
    expect(drafts[1]!.meta).toMatchObject({ usagePart: 'output', outputKind: 'image' });
  });

  it('uses output token draft when candidates tokens are present', () => {
    const drafts = buildGeminiProxyUsageDrafts({
      role: 'image',
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40 },
    });
    expect(drafts).toHaveLength(2);
    expect(drafts[1]!.meter.meterKind).toBe('token');
    expect(drafts[1]!.meter.quantityOut).toBe(40);
    expect(drafts[1]!.meta).toMatchObject({ usagePart: 'output', outputKind: 'token' });
  });

  it('estimates image output token cost at imageOutputPer1m', () => {
    const entry = findPriceCatalogEntry(DEFAULT_PRICE_CATALOG, 'image.gemini.pro');
    const cost = estimateUsageCostUsd(entry, {
      meterKind: 'token',
      quantityOut: 2_000,
      imageOutputTokens: true,
    });
    expect(cost).toBeCloseTo(0.24, 5);
  });

  it('estimates image input token cost from image sku token rates', () => {
    const entry = findPriceCatalogEntry(DEFAULT_PRICE_CATALOG, 'image.gemini.flash');
    const cost = estimateUsageCostUsd(entry, {
      meterKind: 'token',
      quantityIn: 1_000_000,
      quantityOut: 0,
    });
    expect(cost).toBeCloseTo(0.3, 5);
  });
});
