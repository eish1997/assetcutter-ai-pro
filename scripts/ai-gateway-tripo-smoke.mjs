#!/usr/bin/env node
/**
 * C10 — Tripo platform Key + model3d Generation smoke.
 *
 *   npm run smoke:ai-gateway-tripo
 *
 * Env: ADMIN_* ; AI_GATEWAY_TRIPO_PROVIDER_ID (default tripo)
 *      AI_GATEWAY_TRIPO_MODEL (default tripo-p1)
 *      AI_GATEWAY_SMOKE_OPTIONAL=1 → SKIP when blocked
 */

import {
  isSmokeOptional,
  parseDryRunArgs,
  runKeyRouteGenerationLane,
} from './ai-gateway-smoke-lib.mjs';

async function main() {
  const { dryRun } = parseDryRunArgs(process.argv.slice(2));
  const optional = isSmokeOptional(process.env, 'AI_GATEWAY_TRIPO_SMOKE_OPTIONAL');
  const providerId = String(process.env.AI_GATEWAY_TRIPO_PROVIDER_ID || 'tripo').trim();
  const model = String(process.env.AI_GATEWAY_TRIPO_MODEL || 'tripo-p1').trim();
  const code = await runKeyRouteGenerationLane({
    laneTag: 'smoke:ai-gateway-tripo',
    providerId,
    keyIdEnv: String(process.env.AI_GATEWAY_TRIPO_KEY_ID || '').trim(),
    models: [{ canonicalModelId: model, modality: 'model3d', providerId }],
    requireProxyJobId: false,
    dryRun,
    optional,
  });
  process.exit(code);
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith('ai-gateway-tripo-smoke.mjs') ||
    process.argv[1].includes('ai-gateway-tripo-smoke'));

if (isDirect) {
  main().catch((err) => {
    console.error('[smoke:ai-gateway-tripo]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
