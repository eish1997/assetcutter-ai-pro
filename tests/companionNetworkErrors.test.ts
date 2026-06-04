import { describe, expect, it } from 'vitest';

import { humanMessageForCompanionClientFailure } from '../services/companionNetworkErrors';

describe('humanMessageForCompanionClientFailure', () => {
  it('maps fetch failed to actionable companion hint', () => {
    expect(humanMessageForCompanionClientFailure(undefined, 'fetch failed')).toContain('无法连接本地伴侣');
    expect(humanMessageForCompanionClientFailure(undefined, 'Failed to fetch')).toContain('无法连接本地伴侣');
  });

  it('maps bearer and origin codes', () => {
    expect(humanMessageForCompanionClientFailure('AUTH_TOKEN_REQUIRED', 'bearer_required')).toContain('通信密码');
    expect(humanMessageForCompanionClientFailure('AUTH_ORIGIN_DENIED', 'origin_not_allowed')).toContain('网站来源');
  });
});
