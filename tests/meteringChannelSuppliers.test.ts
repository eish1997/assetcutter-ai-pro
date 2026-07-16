import { describe, expect, it } from 'vitest';
import { meterReadingFromAiWorkerProxy } from '../services/observability/metering/adapters/gemini';
import { splitMeterReadingToDrafts } from '../services/observability/metering/splitDrafts';
import {
  resolveBillingSkuForTencent3dTask,
  resolveBillingSkuFromRegistry,
} from '../services/observability/metering/resolveBillingSku';
import { meterReadingFromTask } from '../services/observability/metering/adapters/task';
import { DEFAULT_PRICE_CATALOG, estimateUsageCostUsd, findPriceCatalogEntry } from '../services/observability/metering/estimateCost';
import {
  METERING_REGISTRY_ID_KEY,
  OPENAI_STREAM_USAGE_KEY,
  resolveMeteringRegistryId,
} from '../services/observability/metering/emitGeminiChannel';
import { setCorrelationContext, clearCorrelationContext } from '../services/observability/correlationContext';

describe('third-party channel metering', () => {
  it('resolves tencent 3d billing skus', () => {
    expect(resolveBillingSkuForTencent3dTask('pro')).toBe('3d.tencent.pro');
    expect(resolveBillingSkuForTencent3dTask('rapid')).toBe('3d.tencent.rapid');
    expect(resolveBillingSkuFromRegistry('tencent-hunyuan-3d-pro', '3d')).toBe('3d.tencent.pro');
    expect(resolveBillingSkuFromRegistry('tencent-hunyuan-3d-rapid', '3d')).toBe('3d.tencent.rapid');
    expect(resolveBillingSkuFromRegistry('tripo', '3d')).toBe('3d.tripo.task');
  });

  it('builds tencent task meter reading', () => {
    const reading = meterReadingFromTask({ provider: 'tencent-hunyuan', modality: '3d' });
    const drafts = splitMeterReadingToDrafts(reading);
    expect(drafts[0]!.meterKind).toBe('task');
    const entry = findPriceCatalogEntry(DEFAULT_PRICE_CATALOG, '3d.tencent.pro');
    expect(estimateUsageCostUsd(entry, { meterKind: 'task', quantity: 1 })).toBeCloseTo(0.8, 5);
  });

  it('builds vectorengine image reading with token usage', () => {
    const reading = meterReadingFromAiWorkerProxy({
      registryId: 'gemini-2.5-flash-image',
      provider: 'vectorengine',
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 800 },
    });
    const drafts = splitMeterReadingToDrafts(reading);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.meterKind).toBe('image');
    expect(drafts[0]!.meta).toMatchObject({ flatRate: true, promptTokenCount: 200 });
  });

  it('falls back to output_image for toapis when no usage metadata', () => {
    const reading = meterReadingFromAiWorkerProxy({
      registryId: 'gemini-3-pro-image-preview',
      provider: 'toapis',
      proxyResult: { candidates: [{ content: { parts: [{ inlineData: { data: 'x' } }] } }] },
    });
    const drafts = splitMeterReadingToDrafts(reading);
    expect(drafts.some((d) => d.meterKind === 'image')).toBe(true);
  });

  it('prefers config registry id over upstream model id', () => {
    clearCorrelationContext();
    expect(
      resolveMeteringRegistryId({
        model: 'gemini-2.5-flash',
        config: { [METERING_REGISTRY_ID_KEY]: 'gemini-3-flash-preview' },
      })
    ).toBe('gemini-3-flash-preview');
  });

  it('falls back to correlation context registry id', () => {
    setCorrelationContext({ registryId: 'gemini-3-pro-preview' });
    expect(resolveMeteringRegistryId({ model: 'gemini-2.5-pro' })).toBe('gemini-3-pro-preview');
    clearCorrelationContext();
  });

  it('parses openai stream usage marker into gemini metadata shape', () => {
    const chunk = {
      [OPENAI_STREAM_USAGE_KEY]: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
    };
    const reading = meterReadingFromAiWorkerProxy({
      registryId: 'gemini-3-flash-preview',
      provider: 'toapis',
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 34,
        totalTokenCount: 46,
      },
    });
    expect(reading.parts.some((p) => p.kind === 'input_token' && p.quantity === 12)).toBe(true);
    expect(chunk[OPENAI_STREAM_USAGE_KEY]?.total_tokens).toBe(46);
  });
});
