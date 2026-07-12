import { describe, expect, it } from 'vitest';
import { actualCreditsFromAiGatewayPlan } from '../server/ai-gateway/settlement.js';

describe('AI gateway settlement usage extraction', () => {
  it('collects actual credits from job output and artifacts', () => {
    const actual = actualCreditsFromAiGatewayPlan({
      job: {
        output: { usage: { creditsCharged: 7 } },
        artifacts: [{ billing: { actualCredits: 5 } }],
      },
    });

    expect(actual).toEqual({ credits: 12, source: 'job_usage' });
  });

  it('ignores non-positive usage credits', () => {
    const actual = actualCreditsFromAiGatewayPlan({
      job: {
        metadata: { usage: { creditsCharged: 0 } },
        output: { usage: { creditsCharged: -3 } },
      },
    });

    expect(actual).toEqual({ credits: 0, source: null });
  });
});
