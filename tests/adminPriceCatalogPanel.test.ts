import { describe, expect, it } from 'vitest';
import {
  billingSkuForAiGatewayRouteSuggestion,
  buildAiGatewayPriceSkuSuggestions,
  meterKindForAiGatewayPriceSuggestion,
} from '../components/admin/AdminPriceCatalogPanel';
import type { ModelRouteCatalogEntry } from '../services/modelRegistry';

function route(partial: Partial<ModelRouteCatalogEntry>): ModelRouteCatalogEntry {
  return {
    routeId: 'route-test',
    canonicalModelId: 'gpt-4o-mini',
    providerId: '302ai',
    providerModelId: 'gpt-4o-mini',
    modality: 'text',
    enabled: true,
    priority: 10,
    fallbackPolicy: 'none',
    source: 'provider-binding',
    executionStatus: 'platform_ready',
    gatewayExecutionStatus: 'ready',
    ...partial,
  } as ModelRouteCatalogEntry;
}

describe('AdminPriceCatalogPanel AI Gateway SKU suggestions', () => {
  it('derives the same stable aggregator SKU shape as route billing defaults', () => {
    expect(
      billingSkuForAiGatewayRouteSuggestion(
        route({ providerId: '302ai', providerModelId: 'gpt-4o-mini', modality: 'text' })
      )
    ).toBe('text.302ai.gpt-4o-mini');
    expect(
      billingSkuForAiGatewayRouteSuggestion(
        route({ providerId: 'aihubmix', providerModelId: 'gpt-image-2', modality: 'image' })
      )
    ).toBe('image.aihubmix.gpt-image-2');
  });

  it('suggests missing gateway route SKUs and skips existing catalog entries', () => {
    const suggestions = buildAiGatewayPriceSkuSuggestions(
      [{ billingSku: 'text.302ai.gpt-4o-mini' }],
      [
        route({ providerId: '302ai', providerModelId: 'gpt-4o-mini', modality: 'text' }),
        route({ providerId: 'aihubmix', providerModelId: 'gpt-image-2', modality: 'image' }),
        route({
          routeId: 'pending',
          providerId: 'volcengine-ark',
          providerModelId: 'doubao-seed-2-0-pro',
          modality: 'text',
          gatewayExecutionStatus: 'adapter_pending',
        }),
      ]
    );

    expect(suggestions.map((item) => item.billingSku)).toEqual(['image.aihubmix.gpt-image-2']);
    expect(suggestions[0]).toMatchObject({
      providerId: 'aihubmix',
      meterKind: 'image',
      routeEnabled: true,
    });
  });

  it('maps AI Gateway modalities to price catalog meter kinds', () => {
    expect(meterKindForAiGatewayPriceSuggestion('text')).toBe('token');
    expect(meterKindForAiGatewayPriceSuggestion('image')).toBe('image');
    expect(meterKindForAiGatewayPriceSuggestion('video')).toBe('second');
    expect(meterKindForAiGatewayPriceSuggestion('model3d')).toBe('task');
  });
});
