import { afterEach, describe, expect, it } from 'vitest';
import { aiGatewayHealthSnapshot, isAiGatewayExecutionEnabled } from '../server/ai-gateway/health.js';

describe('AI gateway health snapshot', () => {
  const prevExecution = process.env.AI_GATEWAY_EXECUTION_ENABLED;
  const prevCreditsGate = process.env.AI_GATEWAY_CREDITS_GATE;

  afterEach(() => {
    if (prevExecution === undefined) delete process.env.AI_GATEWAY_EXECUTION_ENABLED;
    else process.env.AI_GATEWAY_EXECUTION_ENABLED = prevExecution;
    if (prevCreditsGate === undefined) delete process.env.AI_GATEWAY_CREDITS_GATE;
    else process.env.AI_GATEWAY_CREDITS_GATE = prevCreditsGate;
  });

  it('reports dry-run job planning defaults', () => {
    delete process.env.AI_GATEWAY_EXECUTION_ENABLED;
    delete process.env.AI_GATEWAY_CREDITS_GATE;

    expect(isAiGatewayExecutionEnabled()).toBe(false);
    expect(aiGatewayHealthSnapshot()).toMatchObject({
      enabled: true,
      executionEnabled: false,
      creditsGateMode: 'plan',
      routes: {
        createJob: 'POST /ai-gateway/jobs',
        listJobs: 'GET /ai-gateway/jobs?limit=20',
        getJob: 'GET /ai-gateway/jobs/:id',
        updateJobStatus: 'PATCH /ai-gateway/jobs/:id',
        executeViaAuthApi: 'POST /api/ai/jobs (AI_GATEWAY_EXECUTION_ENABLED=true)',
      },
      adapters: ['gemini-proxy'],
    });
  });
});
