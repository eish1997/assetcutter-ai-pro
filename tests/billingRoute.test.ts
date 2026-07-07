import { describe, expect, it } from 'vitest';
import {
  isPlatformMeteredGeminiRoute,
  isPlatformMeteredJobKindRoute,
  resolveBillingRoute,
} from '../shared/billingRoute';

describe('billingRoute', () => {
  it('gpt-image openai-official binding is BYOK', () => {
    const decision = resolveBillingRoute({
      jobKind: 'workflow_text_to_image',
      registryId: 'gpt-image-1.5',
      role: 'image',
      channel: 'openai-official',
    });
    expect(decision.routeKind).toBe('byok');
    expect(decision.channel).toBe('openai-official');
    expect(
      isPlatformMeteredGeminiRoute({
        registryId: 'gpt-image-1.5',
        role: 'image',
        bindingChannel: 'openai-official',
      })
    ).toBe(false);
  });

  it('vertex-proxy binding is platform', () => {
    const decision = resolveBillingRoute({
      jobKind: 'workflow_text_to_image',
      registryId: 'gemini-2.5-flash-image',
      role: 'image',
      channel: 'vertex-proxy',
    });
    expect(decision.routeKind).toBe('platform');
    expect(decision.channel).toBe('vertex-proxy');
    expect(
      isPlatformMeteredGeminiRoute({
        registryId: 'gemini-2.5-flash-image',
        role: 'image',
        bindingChannel: 'vertex-proxy',
      })
    ).toBe(true);
  });

  it('tripo 3d with API key is BYOK', () => {
    const decision = resolveBillingRoute({
      jobKind: 'workflow_generate_3d',
      generate3dProvider: 'tripo',
      hasTripoApiKey: true,
    });
    expect(decision.routeKind).toBe('byok');
    expect(
      isPlatformMeteredJobKindRoute({
        jobKind: 'workflow_generate_3d',
        generate3dProvider: 'tripo',
        hasTripoApiKey: true,
      })
    ).toBe(false);
  });

  it('tencent 3d with session creds is BYOK', () => {
    const decision = resolveBillingRoute({
      jobKind: 'workflow_generate_3d',
      generate3dProvider: 'tencent',
      hasTencentCreds: true,
    });
    expect(decision.routeKind).toBe('byok');
    expect(
      isPlatformMeteredJobKindRoute({
        jobKind: 'workflow_generate_3d',
        generate3dProvider: 'tencent',
        hasTencentCreds: true,
      })
    ).toBe(false);
  });

  it('jimeng workflow kinds are platform', () => {
    for (const jobKind of [
      'workflow_jimeng_image',
      'workflow_jimeng_video',
      'workflow_jimeng_digital_human',
    ]) {
      const decision = resolveBillingRoute({ jobKind });
      expect(decision.routeKind).toBe('platform');
    }
    expect(isPlatformMeteredJobKindRoute({ jobKind: 'workflow_jimeng_image' })).toBe(true);
  });

  it('workflow_generate_video is platform', () => {
    expect(resolveBillingRoute({ jobKind: 'workflow_generate_video' }).routeKind).toBe('platform');
  });

  it('tripo 3d without key stays platform', () => {
    expect(
      resolveBillingRoute({
        jobKind: 'workflow_generate_3d',
        generate3dProvider: 'tripo',
        hasTripoApiKey: false,
      }).routeKind
    ).toBe('platform');
  });
});
