import { describe, expect, it } from 'vitest';
import { AiGatewayValidationError } from '../server/ai-gateway/job.js';
import {
  appendAiGatewayFallbackAttempt,
  classifyAiGatewayFallbackError,
  evaluateAiGatewayFallback,
  fallbackDisabledProviders,
  fallbackEnabledForPlan,
  fallbackMaxAttemptsForPlan,
  fallbackPoliciesForPlan,
  fallbackPolicyAllows,
} from '../server/ai-gateway/route-policy.js';

describe('AI gateway route fallback policy', () => {
  it('classifies retryable provider errors conservatively', () => {
    expect(classifyAiGatewayFallbackError(new Error('OpenAI rejected AI job handoff: HTTP 429 rate limit'))).toMatchObject({
      reason: 'rate_limit',
      retryable: true,
      status: 429,
    });
    expect(classifyAiGatewayFallbackError(new Error('OpenAI network unavailable: fetch failed'))).toMatchObject({
      reason: 'network_error',
      retryable: true,
    });
    expect(classifyAiGatewayFallbackError(new Error('OpenAI rejected AI job handoff: HTTP 401 invalid api key'))).toMatchObject({
      reason: 'http_401',
      retryable: false,
      status: 401,
      policyKind: 'none',
    });
  });

  it('does not retry AiGatewayValidationError (client/contract payload faults)', () => {
    const err = new AiGatewayValidationError(
      'Image payload contains unresolved blob URL inside data URL',
      'AI_GATEWAY_OPENAI_EDIT_IMAGE_INVALID'
    );
    expect(classifyAiGatewayFallbackError(err)).toMatchObject({
      reason: 'validation_error',
      retryable: false,
      policyKind: 'none',
    });
  });

  it('honors configured fallback policies instead of treating every retryable error the same', () => {
    const rateLimit = classifyAiGatewayFallbackError(new Error('OpenAI rejected AI job handoff: HTTP 429 rate limit'));
    const upstreamDown = classifyAiGatewayFallbackError(new Error('OpenAI rejected AI job handoff: HTTP 503 overloaded'));

    expect(fallbackPolicyAllows(rateLimit, ['on_rate_limit'])).toBe(true);
    expect(fallbackPolicyAllows(upstreamDown, ['on_rate_limit'])).toBe(false);
    expect(fallbackPolicyAllows(upstreamDown, ['on_provider_degraded'])).toBe(true);
    expect(fallbackPolicyAllows(upstreamDown, ['cost_optimized'])).toBe(true);
    expect(fallbackPolicyAllows(rateLimit, ['quality_first'])).toBe(true);
    expect(fallbackPolicyAllows(rateLimit, ['none'])).toBe(false);

    const plan = {
      job: {
        metadata: {
          aiGatewayFallback: {
            enabled: true,
            policy: 'on_rate_limit',
          },
        },
      },
    };
    expect(fallbackPoliciesForPlan(plan)).toEqual(['on_rate_limit']);
    expect(fallbackMaxAttemptsForPlan({ job: { metadata: { aiGatewayFallback: { maxAttempts: 2 } } } })).toBe(2);
    expect(fallbackMaxAttemptsForPlan({ job: { metadata: { aiGatewayFallback: { maxAttempts: 99 } } } })).toBe(5);
    expect(evaluateAiGatewayFallback(plan, new Error('OpenAI rejected AI job handoff: HTTP 429 rate limit'))).toMatchObject({
      shouldFallback: true,
      policyAllowed: true,
      policies: ['on_rate_limit'],
    });
    expect(evaluateAiGatewayFallback(plan, new Error('OpenAI rejected AI job handoff: HTTP 503 overloaded'))).toMatchObject({
      shouldFallback: false,
      skipReason: 'policy_disallowed',
      policies: ['on_rate_limit'],
    });
  });

  it('enables automatic fallback for inferred routes but not explicit providers by default', () => {
    expect(
      fallbackEnabledForPlan({
        job: { metadata: { modelRouteInference: { providerId: 'openai-official' } } },
      })
    ).toBe(true);
    expect(
      fallbackEnabledForPlan({
        job: { provider: 'openai-official', metadata: {} },
      })
    ).toBe(false);
    expect(
      fallbackEnabledForPlan({
        job: { provider: 'openai-official', metadata: { aiGatewayFallback: { enabled: true } } },
      })
    ).toBe(true);
    expect(
      fallbackEnabledForPlan({
        job: { provider: 'openai-official', metadata: { aiGatewayFallback: { autoSelectedProvider: true } } },
      })
    ).toBe(true);
  });

  it('records tried providers and disables them for the next route plan', () => {
    const metadata = appendAiGatewayFallbackAttempt({}, {
      providerId: 'openai-official',
      adapterId: 'openai-official',
      workerId: 'text-worker',
      reason: 'rate_limit',
      retryable: true,
      policyKind: 'on_rate_limit',
      policies: ['on_error'],
      policyAllowed: true,
      status: 429,
      message: 'rate limit',
    });

    expect(metadata.aiGatewayFallback.attempts).toHaveLength(1);
    expect(fallbackDisabledProviders({
      route: { providerId: 'tinysnow' },
      job: { metadata },
    })).toEqual(['openai-official', 'tinysnow']);
  });
});
