import { describe, expect, it } from 'vitest';
import { priceUsageQuote, quoteGateMinCreditsForJob, userCreditsPerUnit, listPublicPriceCatalog } from '../shared/pricing/pricingEngine';
import type { PriceCatalogEntry } from '../shared/usageBilling';

describe('pricingEngine', () => {
  it('converts token cost to credits', () => {
    const quote = priceUsageQuote({
      billingSku: 'llm.gemini.flash',
      meterKind: 'token',
      quantityIn: 1_000_000,
      quantityOut: 500_000,
    });
    expect(quote.costUsdEst).toBeCloseTo(0.45, 5);
    expect(quote.creditsCharge).toBe(450);
  });

  it('returns zero credits for BYOK', () => {
    const quote = priceUsageQuote({
      billingSku: 'image.gemini.pro',
      meterKind: 'image',
      quantity: 1,
      byok: true,
    });
    expect(quote.creditsCharge).toBe(0);
    expect(quote.costUsdEst).toBeNull();
  });

  it('applies perUnit floor for image output', () => {
    const quote = priceUsageQuote({
      billingSku: 'image.gemini.flash',
      meterKind: 'image',
      quantity: 1,
    });
    expect(quote.costUsdEst).toBeCloseTo(0.039, 5);
    expect(quote.creditsCharge).toBe(39);
  });

  it('quoteGateMinCreditsForJob uses catalog perUnit max', () => {
    const min = quoteGateMinCreditsForJob('workflow_text_to_image');
    expect(min).toBeGreaterThanOrEqual(134);
  });

  it('userCreditsPerUnit prefers admin override over perUnit', () => {
    const entry: PriceCatalogEntry = {
      billingSku: 'image.gemini.flash',
      meterKind: 'image',
      perUnit: 0.039,
      userCreditsPerUnit: 55,
    };
    expect(userCreditsPerUnit(entry)).toBe(55);
    const quote = priceUsageQuote(
      { billingSku: 'image.gemini.flash', meterKind: 'image', quantity: 1 },
      entry
    );
    expect(quote.creditsCharge).toBe(55);
    expect(quote.floorApplied).toBe(true);
  });

  it('public price list shows C-end flat starting rate for llm SKUs', () => {
    const flash = listPublicPriceCatalog().find((r) => r.billingSku === 'llm.gemini.flash');
    expect(flash?.creditsPerUnit).toBe(10);
    expect(flash?.unitLabel).toContain('起');
    const pro = listPublicPriceCatalog().find((r) => r.billingSku === 'llm.gemini.pro');
    expect(pro?.creditsPerUnit).toBe(15);
  });
});
