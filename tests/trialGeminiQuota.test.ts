import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREDITS_EXCEEDED_CODE, LOGIN_REQUIRED_CODE } from '../shared/credits';
import { HttpRequestError } from '../services/httpClient';

vi.mock('../services/creditsApi', () => ({
  assertCreditBalanceAtLeast: vi.fn(),
}));

vi.mock('../services/httpClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/httpClient')>();
  return {
    ...actual,
    requestJson: vi.fn(),
  };
});

import { assertCreditBalanceAtLeast } from '../services/creditsApi';
import { requestJson } from '../services/httpClient';
import { assertCreditsGateBeforeProxyOrThrow } from '../services/trialGeminiQuota';

describe('trialGeminiQuota credits-gate fallback', () => {
  beforeEach(() => {
    vi.mocked(requestJson).mockReset();
    vi.mocked(assertCreditBalanceAtLeast).mockReset();
  });

  it('404 on credits-gate falls back to balance precheck for logged-in users', async () => {
    vi.mocked(requestJson).mockRejectedValue(new HttpRequestError('Not found', 404));
    vi.mocked(assertCreditBalanceAtLeast).mockResolvedValue(undefined);
    await assertCreditsGateBeforeProxyOrThrow(50);
    expect(assertCreditBalanceAtLeast).toHaveBeenCalledWith(50);
  });

  it('401 on credits-gate requires login instead of guest trial', async () => {
    vi.mocked(requestJson).mockRejectedValue(new HttpRequestError('Unauthorized', 401));
    vi.mocked(assertCreditBalanceAtLeast).mockRejectedValue(new HttpRequestError('Unauthorized', 401));
    await expect(assertCreditsGateBeforeProxyOrThrow(1)).rejects.toMatchObject({
      code: LOGIN_REQUIRED_CODE,
    });
  });

  it('404 + zero balance blocks', async () => {
    vi.mocked(requestJson).mockRejectedValue(new HttpRequestError('Not found', 404));
    vi.mocked(assertCreditBalanceAtLeast).mockRejectedValue(
      new HttpRequestError('积分不足，请联系管理员补充额度', 403, CREDITS_EXCEEDED_CODE)
    );
    await expect(assertCreditsGateBeforeProxyOrThrow(50)).rejects.toMatchObject({
      code: CREDITS_EXCEEDED_CODE,
    });
  });
});
