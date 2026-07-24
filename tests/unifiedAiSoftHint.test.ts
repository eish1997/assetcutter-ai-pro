import { describe, expect, it } from 'vitest';
import { resolveUnifiedAiSoftHint } from '../services/unifiedAiGateway';

describe('resolveUnifiedAiSoftHint (slice 2)', () => {
  it('maps upstream rate_limit failureReason to rate_limit', () => {
    expect(
      resolveUnifiedAiSoftHint({
        message: 'anything',
        failureReason: { stage: 'upstream', code: 'AI_GATEWAY_UPSTREAM_RATE_LIMITED' },
      })
    ).toBe('rate_limit');
  });

  it('maps upstream non-rate-limit failureReason to upstream_busy', () => {
    expect(
      resolveUnifiedAiSoftHint({
        failureReason: { stage: 'upstream', code: 'AI_GATEWAY_UPSTREAM_5XX' },
      })
    ).toBe('upstream_busy');
  });

  it('maps provider_key failureReason to auth_config', () => {
    expect(
      resolveUnifiedAiSoftHint({
        body: { failureReason: { stage: 'provider_key', code: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE' } },
      })
    ).toBe('auth_config');
  });

  it('does not guess from message strings when failureReason is missing', () => {
    expect(resolveUnifiedAiSoftHint({ message: 'HTTP 429 Too Many Requests / API key invalid' })).toBe('other');
    expect(resolveUnifiedAiSoftHint(new Error('rate limit 503 overloaded'))).toBe('other');
    expect(resolveUnifiedAiSoftHint(undefined)).toBe('other');
  });
});
