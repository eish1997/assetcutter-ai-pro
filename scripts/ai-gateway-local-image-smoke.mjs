#!/usr/bin/env node
/**
 * R4.3: Local image smoke without Admin login.
 * Uses AI Gateway provider key pool + openai-official adapter (in-process).
 *
 *   npm run smoke:ai-gateway-local-image
 *   AI_GATEWAY_LOCAL_IMAGE_PROVIDER=302ai AI_GATEWAY_LOCAL_IMAGE_MODEL=gpt-image-1.5 npm run smoke:ai-gateway-local-image
 *   AI_GATEWAY_SMOKE_OPTIONAL=1  → exit 0 when no usable key
 */
import { createAiGatewayJobPlan } from '../server/ai-gateway/index.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';
import { startOpenAiOfficialExecution } from '../server/ai-gateway/adapters/openai-official-adapter.js';
import { readModelOpsConfig } from '../server/ai-gateway/model-ops-config-store.js';
import { applyOpenAiCompatibleProvidersFromOps } from '../server/ai-gateway/openai-compatible-config.js';
import { listProviderKeys } from '../server/ai-gateway/provider-key-store.js';

function optionalSkip() {
  return (
    String(process.env.AI_GATEWAY_SMOKE_OPTIONAL || '').trim() === '1' ||
    String(process.env.AI_GATEWAY_LOCAL_IMAGE_SMOKE_OPTIONAL || '').trim() === '1'
  );
}

function pickProviderKey(keys, providerId) {
  const rows = Array.isArray(keys) ? keys : [];
  return (
    rows.find(
      (row) =>
        String(row.provider || '').toLowerCase() === providerId &&
        row.enabled !== false &&
        Boolean(row.hasSecret || row.secret)
    ) || null
  );
}

async function main() {
  const providerId = String(process.env.AI_GATEWAY_LOCAL_IMAGE_PROVIDER || '302ai').trim().toLowerCase();
  const model = String(process.env.AI_GATEWAY_LOCAL_IMAGE_MODEL || 'gpt-image-1.5').trim();
  const keys = await listProviderKeys();
  const key = pickProviderKey(keys, providerId);
  if (!key) {
    console.error(`[smoke:ai-gateway-local-image] BLOCKED: no usable ${providerId} key in pool`);
    process.exit(optionalSkip() ? 0 : 2);
  }

  const ops = await readModelOpsConfig();
  applyOpenAiCompatibleProvidersFromOps(ops || {});

  const started = Date.now();
  const store = createInMemoryAiJobStore();
  const plan = await store.put(
    createAiGatewayJobPlan({
      id: `aijob_local_img_smoke_${Date.now()}`,
      modality: 'image',
      provider: providerId,
      model,
      input: {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'a simple green cube on white background, studio product photo, no text' }],
          },
        ],
        config: { imageConfig: { size: '1024x1024' } },
      },
    })
  );

  console.log(
    JSON.stringify({
      phase: 'planned',
      providerId: plan.route?.providerId,
      adapterId: plan.route?.adapterId,
      path: plan.workerRequest?.path,
      model: plan.workerRequest?.body?.model || model,
      keyId: key.id,
    })
  );

  await startOpenAiOfficialExecution(plan, { store });
  const done = await store.get(plan.job.id);
  const arts = Array.isArray(done?.job?.artifacts) ? done.job.artifacts : [];
  const summary = {
    phase: 'done',
    status: done?.job?.status,
    artifactCount: arts.length,
    elapsedMs: Date.now() - started,
    error: done?.job?.error || null,
  };
  console.log(JSON.stringify(summary));
  if (done?.job?.status !== 'succeeded' || arts.length < 1) {
    process.exit(1);
  }
  console.log('[smoke:ai-gateway-local-image] OK');
}

main().catch((err) => {
  console.error('[smoke:ai-gateway-local-image]', err instanceof Error ? err.message : err);
  process.exit(1);
});
