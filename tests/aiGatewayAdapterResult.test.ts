import { describe, expect, it } from 'vitest';

import {
  applyAiGatewayAdapterResult,
  jobPatchFromAdapterResult,
  normalizeAiGatewayAdapterResult,
  validateAiGatewayAdapterResult,
  validateJobAgainstAdapterContract,
} from '../server/ai-gateway/adapter-result.js';
import { finalizeAiGatewayTerminalPlan } from '../server/ai-gateway/execution-finalize.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';
import { extractRestorableAiJobArtifacts } from '../services/aiJobArtifacts';

function makeStorePlan(jobPatch = {}) {
  const store = createInMemoryAiJobStore();
  const plan = store.put({
    job: {
      id: 'job-contract-1',
      status: 'running',
      modality: 'image',
      model: 'gpt-image-2',
      provider: 'openai-official',
      ...jobPatch,
    },
    route: { providerId: 'openai-official', adapterId: 'openai-official', workerId: 'image-worker' },
  });
  return { store, plan };
}

describe('AiGatewayAdapterResult contract', () => {
  it('normalizes success artifacts and moves vendor fields into metadata', () => {
    const result = normalizeAiGatewayAdapterResult({
      status: 'succeeded',
      upstreamTaskId: 'up-1',
      artifacts: [{ kind: 'image', url: 'https://cdn.example/a.png', source: 'openai-official', taskId: 'up-1', billing: { actualCredits: 1 } }],
      usage: { actualCredits: 1 },
      output: { provider: 'openai-official', raw: { id: 'up-1' } },
    });
    expect(result).toMatchObject({
      status: 'succeeded',
      upstreamTaskId: 'up-1',
      artifacts: [{ kind: 'image', url: 'https://cdn.example/a.png', metadata: { source: 'openai-official', taskId: 'up-1' } }],
    });
    expect(validateAiGatewayAdapterResult(result, { modality: 'image' }).ok).toBe(true);
  });

  it('requires failureReason on failed results', () => {
    const result = normalizeAiGatewayAdapterResult({
      status: 'failed',
      error: { code: 'ARK_ASYNC_TASK_FAILED', message: 'boom' },
    });
    expect(result.failureReason?.code).toBeTruthy();
    expect(validateAiGatewayAdapterResult(result).ok).toBe(true);
  });

  it('rejects succeeded image jobs without artifacts via jobPatch', () => {
    const { patch, result } = jobPatchFromAdapterResult(
      { status: 'succeeded', output: { text: 'nope' } },
      { modality: 'image' }
    );
    expect(result.status).toBe('failed');
    expect(patch.status).toBe('failed');
    expect(patch.error?.code).toBe('AI_GATEWAY_ADAPTER_RESULT_INVALID');
    expect(patch.error?.failureReason || patch.metadata?.gatewayFailure).toBeTruthy();
  });

  it('finalize refuses to keep illegal succeeded jobs', async () => {
    const { store, plan } = makeStorePlan();
    const bad = store.update(plan.job.id, {
      status: 'succeeded',
      output: { text: 'not an image' },
      artifacts: [],
    });
    const finalized = await finalizeAiGatewayTerminalPlan(bad, store);
    expect(finalized.job.status).toBe('failed');
    expect(finalized.job.error?.code || finalized.job.metadata?.gatewayFailure?.code).toMatch(/ADAPTER_RESULT_INVALID|ARTIFACT/);
  });

  it('applyAiGatewayAdapterResult writes contract-shaped succeeded jobs', async () => {
    const { store, plan } = makeStorePlan();
    const { plan: next } = await applyAiGatewayAdapterResult(
      plan,
      {
        status: 'succeeded',
        artifacts: [{ kind: 'image', url: 'https://cdn.example/ok.png', source: 'openai-official' }],
        output: { provider: 'openai-official', raw: {} },
      },
      store
    );
    expect(next.job.status).toBe('succeeded');
    expect(next.job.artifacts?.[0]).toMatchObject({ kind: 'image', url: 'https://cdn.example/ok.png' });
    expect(next.job.artifacts?.[0].source).toBeUndefined();
    expect(next.job.artifacts?.[0].metadata?.source).toBe('openai-official');
    expect(validateJobAgainstAdapterContract(next.job).ok).toBe(true);
  });

  it('frontend restores artifacts from contract array without provider branches', () => {
    const artifacts = extractRestorableAiJobArtifacts({
      job: {
        id: 'j1',
        modality: 'image',
        artifacts: [{ kind: 'image', url: 'https://cdn.example/a.png', mimeType: 'image/png', metadata: { source: 'tripo' } }],
        output: { raw: { vendorOnlyUrl: 'https://cdn.example/should-not-prefer.png' } },
        metadata: {},
      },
      route: { providerId: 'tripo', adapterId: 'tripo-openapi' },
    } as any);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].url).toBe('https://cdn.example/a.png');
    expect(artifacts[0].kind).toBe('image');
  });
});
