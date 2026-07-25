import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_CATALOG } from '../shared/usageBillingCatalog';
import { presentationForSku } from '../shared/billingPresentation';
import {
  listPublicPriceCatalog,
  priceUsageQuote,
  publicListCreditsPerUnit,
  quoteGateMinCreditsForJob,
  userCreditsPerUnit,
} from '../shared/pricing/pricingEngine';

/** C 端公示积分（一口价 / 次起）；与 consumerPricing 对齐 */
const EXPECTED_PUBLIC: Record<
  string,
  { credits: number; unitHint: string; category: 'text' | 'image' | '3d' | 'video' }
> = {
  'copilot.codex.tokens': { credits: 10, unitHint: 'times', category: 'text' },
  'llm.gemini.flash': { credits: 10, unitHint: '起', category: 'text' },
  'llm.gemini.pro': { credits: 15, unitHint: '起', category: 'text' },
  'llm.openai.gpt4o-mini': { credits: 10, unitHint: '起', category: 'text' },
  'llm.openai.gpt4o': { credits: 15, unitHint: '起', category: 'text' },
  'image.gemini.flash': { credits: 39, unitHint: '一口价', category: 'image' },
  'image.gemini.pro': { credits: 134, unitHint: '一口价', category: 'image' },
  'image.openai.gpt15': { credits: 133, unitHint: '一口价', category: 'image' },
  'image.openai.gpt2': { credits: 67, unitHint: '一口价', category: 'image' },
  '3d.tripo.task': { credits: 500, unitHint: '一口价', category: '3d' },
  '3d.tencent.pro': { credits: 800, unitHint: '一口价', category: '3d' },
  '3d.tencent.rapid': { credits: 400, unitHint: '一口价', category: '3d' },
  'video.workflow.task': { credits: 200, unitHint: '一口价', category: 'video' },
  'image.jimeng.t2i-v40': { credits: 50, unitHint: '一口价', category: 'image' },
  'video.jimeng.ti2v-v30-pro': { credits: 250, unitHint: '一口价', category: 'video' },
};

describe('pricing catalog audit', () => {
  it('covers every DEFAULT_PRICE_CATALOG SKU', () => {
    expect(Object.keys(EXPECTED_PUBLIC).sort()).toEqual(
      DEFAULT_PRICE_CATALOG.map((e) => e.billingSku).sort()
    );
  });

  it('public price list matches seed rates for all SKUs', () => {
    const rows = listPublicPriceCatalog();
    for (const [sku, exp] of Object.entries(EXPECTED_PUBLIC)) {
      const row = rows.find((r) => r.billingSku === sku);
      expect(row, sku).toBeDefined();
      expect(row!.creditsPerUnit, sku).toBe(exp.credits);
      expect(row!.unitLabel, sku).toContain(exp.unitHint);
      expect(row!.category, sku).toBe(exp.category);
    }
  });

  it('publicListCreditsPerUnit ignores legacy token admin floor of 1', () => {
    const entry = DEFAULT_PRICE_CATALOG.find((e) => e.billingSku === 'llm.gemini.flash')!;
    expect(
      publicListCreditsPerUnit({ ...entry, userCreditsPerUnit: 1 })
    ).toBe(10);
  });

  it('userCreditsPerUnit billing floor stays 1 for token SKUs without override', () => {
    const entry = DEFAULT_PRICE_CATALOG.find((e) => e.billingSku === 'llm.gemini.flash')!;
    expect(userCreditsPerUnit(entry)).toBe(1);
  });

  it('prices Copilot Codex token usage through the shared token quota path', () => {
    const entry = DEFAULT_PRICE_CATALOG.find((e) => e.billingSku === 'copilot.codex.tokens')!;
    expect(entry).toBeDefined();
    expect(userCreditsPerUnit(entry)).toBe(1);
    const quote = priceUsageQuote({
      billingSku: 'copilot.codex.tokens',
      meterKind: 'token',
      quantityIn: 100,
      quantityOut: 35,
      quantity: 135,
    });
    expect(quote.creditsCharge).toBeGreaterThanOrEqual(1);
    expect(quote.creditsFloor).toBe(1);
  });

  it('settlement quotes align with per-task/per-image catalog', () => {
    const cases: Array<{ sku: string; meterKind: 'image' | 'task'; qty: number; credits: number }> = [
      { sku: 'image.gemini.pro', meterKind: 'image', qty: 1, credits: 134 },
      { sku: 'image.openai.gpt2', meterKind: 'image', qty: 1, credits: 67 },
      { sku: '3d.tencent.pro', meterKind: 'task', qty: 1, credits: 800 },
      { sku: '3d.tencent.rapid', meterKind: 'task', qty: 1, credits: 400 },
      { sku: 'image.jimeng.t2i-v40', meterKind: 'task', qty: 1, credits: 50 },
      { sku: 'video.jimeng.ti2v-v30-pro', meterKind: 'task', qty: 1, credits: 250 },
      { sku: 'video.workflow.task', meterKind: 'task', qty: 1, credits: 200 },
    ];
    for (const c of cases) {
      const q = priceUsageQuote({ billingSku: c.sku, meterKind: c.meterKind, quantity: c.qty });
      expect(q.creditsCharge, c.sku).toBe(c.credits);
    }
  });

  it('gate minimums use per-unit max for image/3d/video job kinds', () => {
    expect(quoteGateMinCreditsForJob('workflow_text_to_image')).toBe(134);
    expect(quoteGateMinCreditsForJob('workflow_generate_3d')).toBe(800);
    expect(quoteGateMinCreditsForJob('workflow_jimeng_image')).toBe(50);
    expect(quoteGateMinCreditsForJob('workflow_jimeng_video')).toBe(250);
    expect(quoteGateMinCreditsForJob('workflow_understand')).toBe(15);
    expect(quoteGateMinCreditsForJob('workflow_chat')).toBe(10);
  });

  it('presentation labels exist for all catalog SKUs', () => {
    for (const entry of DEFAULT_PRICE_CATALOG) {
      const p = presentationForSku(entry.billingSku);
      expect(p.label.length, entry.billingSku).toBeGreaterThan(0);
      expect(p.unitLabel.length, entry.billingSku).toBeGreaterThan(0);
    }
  });
});
