import { describe, expect, it } from 'vitest';

import {
  resolveRequestedCanonicalModelId,
  validateAiGatewayModelPublication,
} from '../server/ai-gateway/model-publication-guard.js';
import {
  resolveExecutableModelRoute,
  resolveKnownPendingModelRoute,
  validateAiGatewayModelRouteExecutable,
} from '../server/ai-gateway/model-route-guard.js';

describe('AI gateway model publication guard', () => {
  it('resolves canonical model id from new and legacy request fields', () => {
    expect(resolveRequestedCanonicalModelId({ canonicalModelId: 'gpt-4o-mini', model: 'ignored' })).toBe('gpt-4o-mini');
    expect(resolveRequestedCanonicalModelId({ metadata: { canonicalModelId: 'gemini-3-flash-preview' } })).toBe(
      'gemini-3-flash-preview'
    );
    expect(resolveRequestedCanonicalModelId({ registryId: 'gpt-image-2' })).toBe('gpt-image-2');
    expect(resolveRequestedCanonicalModelId({ input: { model: 'tripo-p1' } })).toBe('tripo-p1');
  });

  it('allows unrestricted model ops config', () => {
    expect(validateAiGatewayModelPublication({ model: 'anything' }, { publishedCanonicalModelAllowlist: null })).toEqual({
      ok: true,
      canonicalModelId: 'anything',
      restricted: false,
    });
  });

  it('rejects models outside the published allowlist', () => {
    expect(() =>
      validateAiGatewayModelPublication(
        { model: 'gpt-image-2' },
        { publishedCanonicalModelAllowlist: ['gemini-3-pro-image-preview'] }
      )
    ).toThrow('AI model is not published to the workspace: gpt-image-2');
  });

  it('resolves executable backend routes for gateway-ready models', () => {
    expect(resolveExecutableModelRoute({ modality: 'image', model: 'gemini-3-pro-image-preview' })).toMatchObject({
      canonicalModelId: 'gemini-3-pro-image-preview',
      providerId: 'vertex-gemini',
      executionStatus: 'platform_ready',
      platformKeyRequired: false,
    });
    expect(resolveExecutableModelRoute({ modality: 'model3d', model: 'tripo-p1', provider: 'tripo' })).toMatchObject({
      canonicalModelId: 'tripo-p1',
      providerId: 'tripo',
      platformKeyRequired: true,
    });
    expect(resolveExecutableModelRoute({ modality: 'image', model: 'gpt-image-2', provider: 'openai-official' })).toMatchObject({
      canonicalModelId: 'gpt-image-2',
      providerId: 'openai-official',
      executionStatus: 'platform_ready',
      platformKeyRequired: true,
    });
    expect(resolveExecutableModelRoute({ modality: 'image', model: 'gpt-image-2', provider: 'toapis' })).toMatchObject({
      canonicalModelId: 'gpt-image-2',
      providerId: 'toapis',
      executionStatus: 'platform_ready',
      platformKeyRequired: true,
    });
  });

  it('identifies catalog models whose backend adapters are still pending', async () => {
    expect(resolveKnownPendingModelRoute({ modality: 'image', model: 'doubao-seedream-5-0' })).toMatchObject({
      providerId: 'volcengine-ark',
      executionStatus: 'adapter_pending',
    });
    await expect(
      validateAiGatewayModelRouteExecutable(
        { modality: 'image', model: 'doubao-seedream-5-0' },
        { checkProviderKeys: false }
      )
    ).rejects.toMatchObject({
      code: 'AI_GATEWAY_MODEL_ADAPTER_PENDING',
    });
    expect(resolveKnownPendingModelRoute({ modality: 'image', model: 'gpt-image-2', provider: 'toapis' })).toBeNull();
  });

  it('requires an enabled platform key for platform-key routes', async () => {
    await expect(
      validateAiGatewayModelRouteExecutable(
        { modality: 'model3d', model: 'tripo-p1', provider: 'tripo' },
        { listProviderKeys: async () => [] }
      )
    ).rejects.toMatchObject({
      code: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE',
    });

    await expect(
      validateAiGatewayModelRouteExecutable(
        { modality: 'model3d', model: 'tripo-p1', provider: 'tripo' },
        {
          listProviderKeys: async () => [
            {
              provider: 'tripo',
              enabled: true,
              hasSecret: true,
            },
          ],
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      checked: true,
      route: { providerId: 'tripo' },
    });

    await expect(
      validateAiGatewayModelRouteExecutable(
        { modality: 'image', model: 'gpt-image-2', provider: 'openai-official' },
        { listProviderKeys: async () => [{ provider: 'openai-official', enabled: true, hasSecret: true }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      checked: true,
      route: { providerId: 'openai-official' },
    });

    await expect(
      validateAiGatewayModelRouteExecutable(
        { modality: 'image', model: 'gpt-image-2', provider: 'toapis' },
        { listProviderKeys: async () => [{ provider: 'toapis', enabled: true, hasSecret: true }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      checked: true,
      route: { providerId: 'toapis' },
    });
  });
});
