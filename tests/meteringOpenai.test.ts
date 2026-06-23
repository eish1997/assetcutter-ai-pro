import { describe, expect, it } from 'vitest';
import {
  meterReadingFromOpenAiChat,
  meterReadingFromOpenAiImage,
} from '../services/observability/metering/adapters/openai';
import {
  resolveBillingSkuForOpenAiModel,
  resolveBillingSkuFromRegistry,
} from '../services/observability/metering/resolveBillingSku';
import { splitMeterReadingToDrafts } from '../services/observability/metering/splitDrafts';
import { DEFAULT_PRICE_CATALOG, estimateUsageCostUsd, findPriceCatalogEntry } from '../services/observability/metering/estimateCost';
import { meterReadingFromTask } from '../services/observability/metering/adapters/task';

describe('openai metering', () => {
  it('resolves openai billing skus by registry', () => {
    expect(resolveBillingSkuForOpenAiModel('gpt-4o-mini', 'text')).toBe('llm.openai.gpt4o-mini');
    expect(resolveBillingSkuForOpenAiModel('gpt-4o', 'text')).toBe('llm.openai.gpt4o');
    expect(resolveBillingSkuForOpenAiModel('gpt-image-1.5', 'image')).toBe('image.openai.gpt15');
    expect(resolveBillingSkuForOpenAiModel('gpt-image-2', 'image')).toBe('image.openai.gpt2');
    expect(resolveBillingSkuFromRegistry('gpt-image-2', 'image')).toBe('image.openai.gpt2');
  });

  it('parses chat usage into text meter reading', () => {
    const reading = meterReadingFromOpenAiChat({
      registryId: 'gpt-4o-mini',
      provider: 'openai-official',
      raw: { usage: { prompt_tokens: 120, completion_tokens: 40 } },
    });
    expect(reading.modality).toBe('text');
    expect(reading.parts).toEqual([
      { kind: 'input_token', quantity: 120, unit: 'token' },
      { kind: 'output_token', quantity: 40, unit: 'token' },
    ]);
    const drafts = splitMeterReadingToDrafts(reading);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.quantityIn).toBe(120);
    expect(drafts[0]!.quantityOut).toBe(40);
  });

  it('splits gpt image usage into composite drafts', () => {
    const reading = meterReadingFromOpenAiImage({
      registryId: 'gpt-image-2',
      provider: 'openai-official',
      raw: { usage: { input_tokens: 500, output_tokens: 1200 } },
      generatedImage: true,
    });
    const drafts = splitMeterReadingToDrafts(reading);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]!.idempotencySuffix).toBe(':in');
    expect(drafts[1]!.idempotencySuffix).toBe(':out');
    expect(drafts[1]!.imageOutputTokens).toBe(true);
    const entry = findPriceCatalogEntry(DEFAULT_PRICE_CATALOG, 'image.openai.gpt2');
    const cost = estimateUsageCostUsd(entry, {
      meterKind: 'token',
      quantityOut: 1200,
      imageOutputTokens: true,
    });
    expect(cost).toBeCloseTo(0.036, 5);
  });

  it('falls back to output_image when image response has no usage tokens', () => {
    const reading = meterReadingFromOpenAiImage({
      registryId: 'gpt-image-1.5',
      provider: 'openai-official',
      raw: {},
      generatedImage: true,
    });
    const drafts = splitMeterReadingToDrafts(reading);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.meterKind).toBe('image');
    expect(drafts[0]!.meta).toMatchObject({ usagePart: 'output', outputKind: 'image' });
  });
});

describe('task metering', () => {
  it('builds tripo and video task readings', () => {
    const tripo = meterReadingFromTask({ provider: 'tripo', modality: '3d' });
    expect(splitMeterReadingToDrafts(tripo)[0]!.meterKind).toBe('task');
    const video = meterReadingFromTask({ provider: 'workflow-video', modality: 'video' });
    expect(splitMeterReadingToDrafts(video)[0]!.quantity).toBe(1);
  });
});
