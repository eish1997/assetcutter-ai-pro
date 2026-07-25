#!/usr/bin/env node
/**
 * C10 — Gemini/Vertex proxy handoff smoke (assert proxyJobId).
 *
 *   npm run smoke:ai-gateway-vertex
 *   AI_GATEWAY_SMOKE_OPTIONAL=1 npm run smoke:ai-gateway-vertex
 *
 * Env:
 *   ADMIN_IDENTIFIER, ADMIN_PASSWORD
 *   AUTH_API_BASE / ADMIN_ORIGIN (defaults: production Render)
 *   AI_GATEWAY_VERTEX_PROVIDER_ID (default vertex-site)
 *   AI_GATEWAY_VERTEX_TEXT_MODEL (default gemini-2.5-flash)
 *   AI_GATEWAY_VERTEX_KEY_ID (optional)
 *   AI_GATEWAY_SMOKE_OPTIONAL=1 or AI_GATEWAY_VERTEX_SMOKE_OPTIONAL=1 → SKIP when blocked
 */

import {
  isSmokeOptional,
  parseDryRunArgs,
  runKeyRouteGenerationLane,
} from './ai-gateway-smoke-lib.mjs';

async function main() {
  const { dryRun } = parseDryRunArgs(process.argv.slice(2));
  const optional = isSmokeOptional(process.env, 'AI_GATEWAY_VERTEX_SMOKE_OPTIONAL');
  const providerId = String(process.env.AI_GATEWAY_VERTEX_PROVIDER_ID || 'vertex-site').trim();
  const textModel = String(process.env.AI_GATEWAY_VERTEX_TEXT_MODEL || 'gemini-2.5-flash').trim();
  const code = await runKeyRouteGenerationLane({
    laneTag: 'smoke:ai-gateway-vertex',
    providerId,
    keyIdEnv: String(process.env.AI_GATEWAY_VERTEX_KEY_ID || '').trim(),
    models: [{ canonicalModelId: textModel, modality: 'text', providerId }],
    requireProxyJobId: true,
    dryRun,
    optional,
  });
  process.exit(code);
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith('ai-gateway-vertex-handoff-smoke.mjs') ||
    process.argv[1].includes('ai-gateway-vertex-handoff-smoke'));

if (isDirect) {
  main().catch((err) => {
    console.error('[smoke:ai-gateway-vertex]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
