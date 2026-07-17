import { describe, expect, it } from 'vitest';

import {
  resolveRequestedCanonicalModelId,
  validateAiGatewayModelPublication,
} from '../server/ai-gateway/model-publication-guard.js';
import { listExecutableAiGatewayModelRoutes } from '../shared/aiGatewayModelRoutes.js';
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
      providerId: 'vertex-site',
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
    expect(resolveExecutableModelRoute({ modality: 'text', model: 'doubao-seed-2-0-pro', provider: 'volcengine-ark' })).toMatchObject({
      canonicalModelId: 'doubao-seed-2-0-pro',
      providerId: 'volcengine-ark',
      executionStatus: 'platform_ready',
      platformKeyRequired: true,
    });
    expect(resolveExecutableModelRoute({ modality: 'image', model: 'doubao-seedream-5-0', provider: 'volcengine-ark' })).toMatchObject({
      canonicalModelId: 'doubao-seedream-5-0',
      providerId: 'volcengine-ark',
      executionStatus: 'platform_ready',
      platformKeyRequired: true,
    });
    expect(resolveExecutableModelRoute({ modality: 'video', model: 'doubao-seedance-2-0', provider: 'volcengine-ark' })).toMatchObject({
      canonicalModelId: 'doubao-seedance-2-0',
      providerId: 'volcengine-ark',
      executionStatus: 'platform_ready',
      platformKeyRequired: true,
    });
    expect(resolveExecutableModelRoute({ modality: 'model3d', model: 'doubao-seed3d-2-0', provider: 'volcengine-ark' })).toMatchObject({
      canonicalModelId: 'doubao-seed3d-2-0',
      providerId: 'volcengine-ark',
      executionStatus: 'platform_ready',
      platformKeyRequired: true,
    });
  });

  it('normalizes legacy channel and adapter provider ids before route validation', async () => {
    expect(resolveExecutableModelRoute({ modality: 'image', model: 'gemini-3-pro-image-preview', provider: 'vertex-proxy' })).toMatchObject({
      canonicalModelId: 'gemini-3-pro-image-preview',
      providerId: 'vertex-site',
    });
    expect(resolveExecutableModelRoute({ modality: 'image', model: 'gpt-image-2', provider: 'toapis-openai' })).toMatchObject({
      canonicalModelId: 'gpt-image-2',
      providerId: 'toapis',
    });
    expect(resolveExecutableModelRoute({ modality: 'image', model: 'doubao-seedream-5-0', provider: 'volcengine-ark-image' })).toMatchObject({
      canonicalModelId: 'doubao-seedream-5-0',
      providerId: 'volcengine-ark',
    });
    expect(resolveExecutableModelRoute({ modality: 'video', model: 'jimeng-video-ti2v-v30-pro', provider: 'jimeng-visual' })).toMatchObject({
      canonicalModelId: 'jimeng-video-ti2v-v30-pro',
      providerId: 'volcengine-jimeng',
    });
    expect(resolveExecutableModelRoute({ modality: 'model3d', model: 'tripo-p1', provider: 'tripo-openapi' })).toMatchObject({
      canonicalModelId: 'tripo-p1',
      providerId: 'tripo',
    });
    expect(resolveExecutableModelRoute({ modality: 'model3d', model: 'tencent-hunyuan-3d-rapid', provider: 'tencent-hunyuan-3d' })).toMatchObject({
      canonicalModelId: 'tencent-hunyuan-3d-rapid',
      providerId: 'tencent-hunyuan',
    });

    await expect(
      validateAiGatewayModelRouteExecutable(
        { modality: 'image', model: 'doubao-seedream-5-0', provider: 'volcengine-ark-image' },
        { listProviderKeys: async () => [{ provider: 'volcengine-ark-image', enabled: true, hasSecret: true }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      checked: true,
      route: { providerId: 'volcengine-ark' },
    });
  });

  it('removes paused providers from executable route candidates before planning', () => {
    expect(
      resolveExecutableModelRoute(
        { modality: 'image', model: 'doubao-seedream-5-0' },
        { disabledProviders: ['volcengine-ark'] }
      )
    ).toBeNull();
    expect(
      listExecutableAiGatewayModelRoutes({
        modality: 'image',
        model: 'gemini-3-pro-image-preview',
        disabledProviders: ['vertex-site'],
      }).map((route) => route.providerId)
    ).toEqual(['gemini-aistudio']);
  });

  it('reports paused providers separately from missing model routes', async () => {
    await expect(
      validateAiGatewayModelRouteExecutable(
        { modality: 'image', model: 'doubao-seedream-5-0' },
        {
          disabledProviders: ['volcengine-ark-image'],
          listProviderKeys: async () => [{ provider: 'volcengine-ark', enabled: true, hasSecret: true }],
        }
      )
    ).rejects.toMatchObject({
      code: 'AI_GATEWAY_PROVIDER_PAUSED',
      details: {
        providerIds: ['volcengine-ark'],
        canonicalModelId: 'doubao-seedream-5-0',
        modality: 'image',
      },
    });
  });

  it('identifies catalog models whose backend adapters are still pending', async () => {
    expect(resolveKnownPendingModelRoute({ modality: 'video', model: 'doubao-seedance-2-0' })).toBeNull();
    expect(resolveKnownPendingModelRoute({ modality: 'model3d', model: 'doubao-seed3d-2-0' })).toBeNull();
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

    await expect(
      validateAiGatewayModelRouteExecutable(
        { modality: 'image', model: 'gpt-image-2' },
        { listProviderKeys: async () => [{ provider: 'toapis', enabled: true, hasSecret: true }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      checked: true,
      route: { providerId: 'toapis' },
    });

    await expect(
      validateAiGatewayModelRouteExecutable(
        { modality: 'text', model: 'doubao-seed-2-0-pro', provider: 'volcengine-ark' },
        { listProviderKeys: async () => [{ provider: 'volcengine-ark', enabled: true, hasSecret: true }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      checked: true,
      route: { providerId: 'volcengine-ark' },
    });

    await expect(
      validateAiGatewayModelRouteExecutable(
        { modality: 'image', model: 'doubao-seedream-5-0', provider: 'volcengine-ark' },
        { listProviderKeys: async () => [{ provider: 'volcengine-ark', enabled: true, hasSecret: true }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      checked: true,
      route: { providerId: 'volcengine-ark' },
    });

    await expect(
      validateAiGatewayModelRouteExecutable(
        { modality: 'video', model: 'doubao-seedance-2-0', provider: 'volcengine-ark' },
        { listProviderKeys: async () => [{ provider: 'volcengine-ark', enabled: true, hasSecret: true }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      checked: true,
      route: { providerId: 'volcengine-ark' },
    });

    await expect(
      validateAiGatewayModelRouteExecutable(
        { modality: 'model3d', model: 'doubao-seed3d-2-0', provider: 'volcengine-ark' },
        { listProviderKeys: async () => [{ provider: 'volcengine-ark', enabled: true, hasSecret: true }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      checked: true,
      route: { providerId: 'volcengine-ark' },
    });
  });
});
