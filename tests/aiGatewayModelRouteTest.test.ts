import { describe, expect, it } from 'vitest';

import { testAiGatewayModelRoute } from '../server/ai-gateway/model-route-test.js';

describe('AI gateway model route test', () => {
  it('passes executable routes when a usable platform key exists', async () => {
    const result = await testAiGatewayModelRoute(
      {
        canonicalModelId: 'gpt-image-2',
        modality: 'image',
        providerId: 'openai-official',
      },
      {
        listProviderKeys: async () => [{ provider: 'openai-official', enabled: true, hasSecret: true }],
      }
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'passed',
      mode: 'route_guard',
      canonicalModelId: 'gpt-image-2',
      providerId: 'openai-official',
      code: 'AI_GATEWAY_MODEL_ROUTE_READY',
    });
    expect(result.route).toMatchObject({ ruleId: 'openai-official-gateway' });
  });

  it('fails executable routes when the required platform key is missing', async () => {
    const result = await testAiGatewayModelRoute(
      {
        canonicalModelId: 'tripo-p1',
        modality: 'model3d',
        providerId: 'tripo',
      },
      { listProviderKeys: async () => [] }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      code: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE',
      canonicalModelId: 'tripo-p1',
      providerId: 'tripo',
    });
  });

  it('fails pending adapter routes without creating generation work', async () => {
    const result = await testAiGatewayModelRoute(
      {
        canonicalModelId: 'doubao-seedance-2-0',
        modality: 'video',
        providerId: 'volcengine-ark',
      },
      {
        listProviderKeys: async () => [{ provider: 'volcengine-ark', enabled: true, hasSecret: true }],
      }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      code: 'AI_GATEWAY_MODEL_ADAPTER_PENDING',
    });
  });

  it('fails routes that still need endpoint or parameter mapping', async () => {
    const result = await testAiGatewayModelRoute({
      canonicalModelId: 'custom-image-model',
      modality: 'image',
      providerId: 'volcengine-ark',
      executionStatus: 'requires_endpoint_mapping',
      requiresEndpointMapping: true,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      code: 'AI_GATEWAY_MODEL_PARAMETER_PENDING',
    });
  });
});
