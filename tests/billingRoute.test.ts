import { describe, expect, it } from 'vitest';
import {
  isPlatformMeteredGeminiRoute,
  isPlatformMeteredJobKindRoute,
  resolveBillingRoute,
} from '../shared/billingRoute';

describe('billingRoute', () => {
  it('gpt-image openai-official binding stays platform unless explicit BYOK', () => {
    const decision = resolveBillingRoute({
      jobKind: 'workflow_text_to_image',
      registryId: 'gpt-image-1.5',
      role: 'image',
      channel: 'openai-official',
    });
    expect(decision.routeKind).toBe('platform');
    expect(decision.channel).toBe('vertex-proxy');
    expect(
      isPlatformMeteredGeminiRoute({
        registryId: 'gpt-image-1.5',
        role: 'image',
        bindingChannel: 'openai-official',
      })
    ).toBe(true);

    const byok = resolveBillingRoute({
      jobKind: 'workflow_text_to_image',
      registryId: 'gpt-image-1.5',
      role: 'image',
      channel: 'openai-official',
      explicitByok: true,
    });
    expect(byok.routeKind).toBe('byok');
    expect(byok.channel).toBe('openai-official');
  });

  it('volcengine ark channel stays platform unless explicit BYOK', () => {
    const decision = resolveBillingRoute({
      jobKind: 'workflow_chat',
      registryId: 'doubao-seed-2-0-pro',
      role: 'text',
      channel: 'volcengine-ark',
    });
    expect(decision.routeKind).toBe('platform');
    expect(decision.channel).toBe('vertex-proxy');

    const byok = resolveBillingRoute({
      jobKind: 'workflow_chat',
      registryId: 'doubao-seed-2-0-pro',
      role: 'text',
      channel: 'volcengine-ark',
      explicitByok: true,
    });
    expect(byok.routeKind).toBe('byok');
    expect(byok.channel).toBe('volcengine-ark');
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

  it('tripo 3d with local API key stays platform unless explicit BYOK', () => {
    const decision = resolveBillingRoute({
      jobKind: 'workflow_generate_3d',
      generate3dProvider: 'tripo',
      hasTripoApiKey: true,
    });
    expect(decision.routeKind).toBe('platform');
    expect(
      isPlatformMeteredJobKindRoute({
        jobKind: 'workflow_generate_3d',
        generate3dProvider: 'tripo',
        hasTripoApiKey: true,
      })
    ).toBe(true);

    const byok = resolveBillingRoute({
      jobKind: 'workflow_generate_3d',
      generate3dProvider: 'tripo',
      hasTripoApiKey: true,
      explicitByok: true,
    });
    expect(byok.routeKind).toBe('byok');
  });

  it('tencent 3d with session creds stays platform unless explicit BYOK', () => {
    const decision = resolveBillingRoute({
      jobKind: 'workflow_generate_3d',
      generate3dProvider: 'tencent',
      hasTencentCreds: true,
    });
    expect(decision.routeKind).toBe('platform');
    expect(
      isPlatformMeteredJobKindRoute({
        jobKind: 'workflow_generate_3d',
        generate3dProvider: 'tencent',
        hasTencentCreds: true,
      })
    ).toBe(true);

    const byok = resolveBillingRoute({
      jobKind: 'workflow_generate_3d',
      generate3dProvider: 'tencent',
      hasTencentCreds: true,
      explicitByok: true,
    });
    expect(byok.routeKind).toBe('byok');
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
