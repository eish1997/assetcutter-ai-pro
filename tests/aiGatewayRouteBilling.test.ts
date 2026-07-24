import { describe, expect, it } from 'vitest';

import {
  meterKindForAiGatewayModality,
  resolveAiGatewayBillingSku,
  unitForAiGatewayMeter,
} from '../server/ai-gateway/route-billing.js';

describe('AI gateway route billing defaults', () => {
  it('keeps existing catalog SKUs for Gemini, OpenAI, Tripo, and Tencent routes', () => {
    expect(
      resolveAiGatewayBillingSku({
        job: { modality: 'image', model: 'gemini-3-pro-image-preview', input: {} },
        route: { providerId: 'vertex-site' },
      })
    ).toBe('image.gemini.pro');

    expect(
      resolveAiGatewayBillingSku({
        job: { modality: 'text', model: 'gpt-4o-mini', input: {} },
        route: { providerId: 'openai-official' },
      })
    ).toBe('llm.openai.gpt4o-mini');

    expect(
      resolveAiGatewayBillingSku({
        job: { modality: 'model3d', model: 'tripo-p1', input: {} },
        route: { providerId: 'tripo' },
      })
    ).toBe('3d.tripo.task');

    expect(
      resolveAiGatewayBillingSku({
        job: { modality: 'model3d', model: 'tencent-hunyuan-3d-rapid', input: {} },
        route: { providerId: 'tencent-hunyuan' },
      })
    ).toBe('3d.tencent.rapid');
  });

  it('uses stable provider/model SKUs for aggregator routes until price catalog overrides are added', () => {
    expect(
      resolveAiGatewayBillingSku({
        job: { modality: 'text', model: 'gpt-4o-mini', input: {} },
        route: { providerId: '302ai' },
      })
    ).toBe('text.302ai.gpt-4o-mini');

    expect(
      resolveAiGatewayBillingSku({
        job: { modality: 'image', model: 'gpt-image-2', input: {} },
        route: { providerId: 'aihubmix' },
      })
    ).toBe('image.aihubmix.gpt-image-2');
  });

  it('honors explicit billing SKU and normalizes meter units', () => {
    expect(
      resolveAiGatewayBillingSku({
        job: {
          modality: 'image',
          model: 'gpt-image-2',
          input: { billingSku: 'image.custom.route' },
        },
        route: { providerId: '302ai' },
      })
    ).toBe('image.custom.route');

    expect(meterKindForAiGatewayModality('text')).toBe('token');
    expect(meterKindForAiGatewayModality('video')).toBe('second');
    expect(unitForAiGatewayMeter('image')).toBe('image');
  });
});
