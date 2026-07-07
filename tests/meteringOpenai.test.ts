import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  meterReadingFromOpenAiChat,
  meterReadingFromOpenAiImage,
} from '../services/observability/metering/adapters/openai';
import { emitOpenAiMeteredUsage } from '../services/observability/metering/emitOpenAi';
import * as pipeline from '../services/observability/metering/pipeline';
import { emitMeteredUsageAwait } from '../services/observability/metering/pipeline';
import * as usageEmitFacade from '../services/observability/usageEmitFacade';
import {
  resolveBillingSkuForOpenAiModel,
  resolveBillingSkuFromRegistry,
} from '../services/observability/metering/resolveBillingSku';
import { splitMeterReadingToDrafts } from '../services/observability/metering/splitDrafts';
import { DEFAULT_PRICE_CATALOG, estimateUsageCostUsd, findPriceCatalogEntry } from '../services/observability/metering/estimateCost';
import { meterReadingFromTask } from '../services/observability/metering/adapters/task';

describe('openai metering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emitOpenAiMeteredUsage marks BYOK so site credits are not charged', () => {
    const spy = vi.spyOn(pipeline, 'emitMeteredUsage').mockImplementation(() => {});
    emitOpenAiMeteredUsage({
      registryId: 'gpt-image-1.5',
      reading: meterReadingFromOpenAiImage({
        registryId: 'gpt-image-1.5',
        provider: 'openai-official',
        raw: {},
        generatedImage: true,
      }),
      requestId: 'req-byok-test',
      jobKind: 'workflow_image',
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        extraMeta: { byok: true },
      })
    );
  });

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

  it('emits one flat-rate draft for gpt image usage', () => {
    const reading = meterReadingFromOpenAiImage({
      registryId: 'gpt-image-2',
      provider: 'openai-official',
      raw: { usage: { input_tokens: 500, output_tokens: 1200 } },
      generatedImage: true,
    });
    const drafts = splitMeterReadingToDrafts(reading);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.meterKind).toBe('image');
    expect(drafts[0]!.meta).toMatchObject({
      flatRate: true,
      promptTokenCount: 500,
      outputTokenCount: 1200,
    });
    const entry = findPriceCatalogEntry(DEFAULT_PRICE_CATALOG, 'image.openai.gpt2');
    const cost = estimateUsageCostUsd(entry, {
      meterKind: 'image',
      quantity: 1,
    });
    expect(cost).toBeCloseTo(0.067, 5);
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

describe('pipeline billingDecision', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears cost and marks byok when routeKind is byok', async () => {
    const spy = vi.spyOn(usageEmitFacade, 'emitUsageEventsAwait').mockResolvedValue();
    await emitMeteredUsageAwait({
      reading: meterReadingFromTask({ provider: 'tripo', modality: '3d' }),
      registryId: 'tripo',
      idempotencyPrefix: 'tripo-task:test-byok',
      requestId: 'test-byok',
      billingDecision: {
        routeKind: 'byok',
        jobKind: 'workflow_generate_3d',
        registryId: 'tripo',
        role: 'text',
        minCredits: 0,
      },
    });
    expect(spy).toHaveBeenCalledWith([
      expect.objectContaining({
        costUsdEst: null,
        meta: expect.objectContaining({ byok: true }),
      }),
    ]);
  });

  it('keeps cost estimate for platform routeKind', async () => {
    const spy = vi.spyOn(usageEmitFacade, 'emitUsageEventsAwait').mockResolvedValue();
    await emitMeteredUsageAwait({
      reading: meterReadingFromTask({ provider: 'tripo', modality: '3d' }),
      registryId: 'tripo',
      idempotencyPrefix: 'tripo-task:test-platform',
      requestId: 'test-platform',
      billingDecision: {
        routeKind: 'platform',
        jobKind: 'workflow_generate_3d',
        registryId: 'tripo',
        role: 'text',
        minCredits: 10,
      },
    });
    const events = spy.mock.calls[0]![0]!;
    expect(events[0]!.costUsdEst).not.toBeNull();
    expect(events[0]!.meta?.byok).toBeUndefined();
  });

  it('extraMeta byok fallback works without billingDecision', async () => {
    const spy = vi.spyOn(usageEmitFacade, 'emitUsageEventsAwait').mockResolvedValue();
    await emitMeteredUsageAwait({
      reading: meterReadingFromOpenAiImage({
        registryId: 'gpt-image-1.5',
        provider: 'openai-official',
        raw: {},
        generatedImage: true,
      }),
      registryId: 'gpt-image-1.5',
      idempotencyPrefix: 'openai-image:fallback',
      requestId: 'fallback',
      extraMeta: { byok: true },
    });
    expect(spy).toHaveBeenCalledWith([
      expect.objectContaining({
        meta: expect.objectContaining({ byok: true }),
      }),
    ]);
  });
});
