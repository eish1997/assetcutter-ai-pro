import { describe, expect, it } from 'vitest';

import {
  buildProviderTaskUsage,
  extractOpenAiStyleTokenUsage,
  extractProviderConsumedCredits,
  extractProviderCostUsd,
} from '../server/ai-gateway/execution-usage.js';

describe('AI Gateway execution usage (B10)', () => {
  it('extracts OpenAI-compatible token usage and cost', () => {
    const raw = {
      id: 'resp_1',
      usage: {
        prompt_tokens: 120,
        completion_tokens: 40,
        total_tokens: 160,
        cost: 0.0123,
      },
    };
    expect(extractOpenAiStyleTokenUsage(raw)).toEqual({
      promptTokens: 120,
      completionTokens: 40,
      totalTokens: 160,
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 40,
        totalTokenCount: 160,
      },
    });
    expect(extractProviderCostUsd(raw)).toBe(0.0123);
  });

  it('extracts Tripo-style consumed credits', () => {
    expect(extractProviderConsumedCredits({ data: { consumed_credits: 18, status: 'success' } })).toBe(18);
    expect(extractProviderCostUsd({ data: { usage: { cost_usd: 0.5 } } })).toBe(0.5);
  });

  it('buildProviderTaskUsage surfaces promptTokens/costUsd for trend settlement', () => {
    const usage = buildProviderTaskUsage(
      {
        job: { modality: 'text', provider: '302ai', estimatedCredits: 3 },
        route: { providerId: '302ai' },
      },
      {
        provider: '302ai',
        meterKind: 'token',
        unit: 'token',
        quantity: 160,
        promptTokens: 120,
        completionTokens: 40,
        totalTokens: 160,
        costUsd: 0.0123,
        actualCredits: 5,
        startedAtMs: 1_000,
        completedAtMs: 1_500,
      }
    );
    expect(usage).toMatchObject({
      promptTokens: 120,
      completionTokens: 40,
      totalTokens: 160,
      costUsd: 0.0123,
      costUsdEst: 0.0123,
      actualCredits: 5,
      settlementSource: 'provider_task_usage',
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 40,
        totalTokenCount: 160,
      },
      durationMs: 500,
    });
  });
});
