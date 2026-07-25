#!/usr/bin/env node
/**
 * C10 — Jimeng (volcengine-jimeng) Generation smoke.
 *
 *   npm run smoke:ai-gateway-jimeng
 *
 * Env: ADMIN_* ; AI_GATEWAY_JIMENG_PROVIDER_ID (default volcengine-jimeng)
 *      AI_GATEWAY_JIMENG_IMAGE_MODEL (default jimeng-image-t2i-v40)
 *      AI_GATEWAY_SMOKE_OPTIONAL=1 → SKIP when blocked
 */

import {
  isSmokeOptional,
  parseDryRunArgs,
  runKeyRouteGenerationLane,
} from './ai-gateway-smoke-lib.mjs';

async function main() {
  const { dryRun } = parseDryRunArgs(process.argv.slice(2));
  const optional = isSmokeOptional(process.env, 'AI_GATEWAY_JIMENG_SMOKE_OPTIONAL');
  const providerId = String(process.env.AI_GATEWAY_JIMENG_PROVIDER_ID || 'volcengine-jimeng').trim();
  const imageModel = String(process.env.AI_GATEWAY_JIMENG_IMAGE_MODEL || 'jimeng-image-t2i-v40').trim();
  const code = await runKeyRouteGenerationLane({
    laneTag: 'smoke:ai-gateway-jimeng',
    providerId,
    keyIdEnv: String(process.env.AI_GATEWAY_JIMENG_KEY_ID || '').trim(),
    models: [{ canonicalModelId: imageModel, modality: 'image', providerId }],
    requireProxyJobId: false,
    dryRun,
    optional,
  });
  process.exit(code);
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith('ai-gateway-jimeng-smoke.mjs') ||
    process.argv[1].includes('ai-gateway-jimeng-smoke'));

if (isDirect) {
  main().catch((err) => {
    console.error('[smoke:ai-gateway-jimeng]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
