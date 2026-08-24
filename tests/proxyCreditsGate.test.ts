import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREDITS_EXCEEDED_CODE, LOGIN_REQUIRED_CODE } from '../shared/credits';
import { HttpRequestError } from '../services/httpClient';

vi.mock('../services/geminiFairnessBridge', () => ({
  getGeminiFairnessUserId: vi.fn(() => null),
}));

vi.mock('../services/creditsApi', () => ({
  assertCreditBalanceAtLeast: vi.fn(),
  prechargePlatformCredits: vi.fn(),
  fetchCreditBalance: vi.fn(),
}));

vi.mock('../services/settingsStore', () => ({
  getEnabledChannels: vi.fn(() => ['vertex-proxy']),
  isChannelReady: vi.fn(() => true),
  getTencentCreds: vi.fn(() => ({ secretId: '', secretKey: '' })),
  getUserApiKey: vi.fn(() => null),
  getTripoApiKey: vi.fn(() => null),
  hasUserCredentialsForChannel: vi.fn(() => false),
}));

vi.mock('../services/platformAiPath', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/platformAiPath')>();
  return {
    ...actual,
    isPlatformMeteredGeminiPath: vi.fn(actual.isPlatformMeteredGeminiPath),
    isPlatformMeteredJobKind: vi.fn(actual.isPlatformMeteredJobKind),
  };
});

import { getGeminiFairnessUserId } from '../services/geminiFairnessBridge';
import { assertCreditBalanceAtLeast, prechargePlatformCredits } from '../services/creditsApi';
import { getTencentCreds } from '../services/settingsStore';
import { isPlatformMeteredGeminiPath } from '../services/platformAiPath';
import {
  assertPlatformAiCreditsAllowed,
  assertUnifiedProxyCreditsGate,
  isPlatformAiSubmitBlocked,
  proxyCreditsBypassedByByok,
  proxyCreditsBypassedForCapabilityModule,
} from '../services/proxyCreditsGate';

describe('proxyCreditsGate', () => {
  beforeEach(() => {
    vi.mocked(getGeminiFairnessUserId).mockReturnValue(null);
    vi.mocked(assertCreditBalanceAtLeast).mockReset();
    vi.mocked(prechargePlatformCredits).mockReset();
    vi.mocked(getTencentCreds).mockReturnValue({ secretId: '', secretKey: '' });
  });

  it('bypasses precheck when job kind is not platform metered', async () => {
    vi.mocked(getTencentCreds).mockReturnValue({ secretId: 'sid', secretKey: 'skey' });
    vi.mocked(getGeminiFairnessUserId).mockReturnValue('u1');
    await assertPlatformAiCreditsAllowed('workflow_generate_3d');
    expect(assertCreditBalanceAtLeast).not.toHaveBeenCalled();
  });

  it('proxyCreditsBypassedByByok with tencent job kind', () => {
    expect(proxyCreditsBypassedByByok({ jobKind: 'workflow_generate_3d' })).toBe(false);
  });

  it('assertPlatformAiCreditsAllowed blocks when not logged in', async () => {
    await expect(assertPlatformAiCreditsAllowed('workflow_text_to_image')).rejects.toMatchObject({
      code: LOGIN_REQUIRED_CODE,
    });
    expect(assertCreditBalanceAtLeast).not.toHaveBeenCalled();
  });

  it('assertPlatformAiCreditsAllowed precharges when logged in', async () => {
    vi.mocked(getGeminiFairnessUserId).mockReturnValue('u1');
    vi.mocked(prechargePlatformCredits).mockResolvedValue({
      prechargeKey: 'pc:1',
      reserveKey: 'pc:1',
      amount: 134,
      remaining: 134,
    });
    await assertPlatformAiCreditsAllowed('workflow_text_to_image', 'u1');
    expect(prechargePlatformCredits).toHaveBeenCalledWith(134, undefined);
    expect(assertCreditBalanceAtLeast).not.toHaveBeenCalled();
  });

  it('blocks zero balance for logged-in user', async () => {
    vi.mocked(prechargePlatformCredits).mockRejectedValue(
      new HttpRequestError('积分不足', 403, CREDITS_EXCEEDED_CODE)
    );
    vi.mocked(getGeminiFairnessUserId).mockReturnValue('u1');
    await expect(assertUnifiedProxyCreditsGate('workflow_text_to_image')).rejects.toMatchObject({
      code: CREDITS_EXCEEDED_CODE,
    });
  });

  it('proxyCreditsBypassedForCapabilityModule bypasses when image+text paths are BYOK', () => {
    vi.mocked(isPlatformMeteredGeminiPath).mockReturnValue(false);
    expect(
      proxyCreditsBypassedForCapabilityModule({
        id: 'variant',
        label: '变体',
        category: 'image_to_image',
        engine: 'gen_image',
        instruction: 'test',
      })
    ).toBe(true);
  });

  it('proxyCreditsBypassedForCapabilityModule requires credits when image path is platform', () => {
    vi.mocked(isPlatformMeteredGeminiPath).mockImplementation((_id, role) => role === 'image');
    expect(
      proxyCreditsBypassedForCapabilityModule({
        id: 'variant',
        label: '变体',
        category: 'image_to_image',
        engine: 'gen_image',
        instruction: 'test',
      })
    ).toBe(false);
  });

  it('proxyCreditsBypassedForCapabilityModule honors group override image model', () => {
    vi.mocked(isPlatformMeteredGeminiPath).mockImplementation((id, role) => {
      if (role === 'image' && id === 'gpt-image-2') return false;
      return role === 'text';
    });
    expect(
      proxyCreditsBypassedForCapabilityModule(
        {
          id: 'variant',
          label: '变体',
          category: 'image_to_image',
          engine: 'gen_image',
          instruction: 'test',
          imageModelRegistryId: 'gemini-3-pro-image',
        },
        { overrideImageModelRegistryId: 'gpt-image-2', overrideSkipUnderstand: true }
      )
    ).toBe(true);
  });

  it('isPlatformAiSubmitBlocked requires login and sufficient balance', () => {
    expect(isPlatformAiSubmitBlocked(null, 0, false, 'workflow_text_to_image').blocked).toBe(true);
    expect(isPlatformAiSubmitBlocked('u1', 0, false, 'workflow_text_to_image').blocked).toBe(true);
    expect(isPlatformAiSubmitBlocked('u1', 133, false, 'workflow_text_to_image').blocked).toBe(true);
    expect(isPlatformAiSubmitBlocked('u1', 134, false, 'workflow_text_to_image').blocked).toBe(false);
    expect(isPlatformAiSubmitBlocked('u1', null, false, 'workflow_text_to_image').blocked).toBe(true);
    expect(isPlatformAiSubmitBlocked('u1', 0, true, 'workflow_text_to_image').blocked).toBe(true);
  });
});
