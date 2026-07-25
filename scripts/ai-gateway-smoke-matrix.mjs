#!/usr/bin/env node
/**
 * C10 / D1 — AI Gateway smoke matrix (302 + Vertex handoff + Jimeng + Tripo).
 *
 *   npm run smoke:ai-gateway-matrix
 *   npm run smoke:ai-gateway-matrix -- --dry-run
 *
 * Default: AI_GATEWAY_SMOKE_OPTIONAL=1 (missing creds → SKIP, exit 0).
 * Pre-release: AI_GATEWAY_SMOKE_OPTIONAL=0 + live (no --dry-run).
 * SMOKE_ALLOW_ROUTE_ONLY=1 — allow ok without a Generation lane (explicit only).
 *
 * Aggregate never reports status=ok for: all-SKIP, dry-run, or zero Generation lanes.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateLaneResults, isSmokeOptional } from './ai-gateway-smoke-lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const LANES = [
  { id: 'build-sha', script: 'check-build-sha-alignment.mjs', optionalEnv: 'AI_GATEWAY_BUILD_SHA_SMOKE_OPTIONAL' },
  { id: 'r2-media', script: 'check-ai-gateway-r2-media.mjs', optionalEnv: 'AI_GATEWAY_R2_SMOKE_OPTIONAL' },
  { id: '302', script: 'ai-gateway-302-staging-smoke.mjs', optionalEnv: 'AI_GATEWAY_302_SMOKE_OPTIONAL' },
  { id: 'vertex', script: 'ai-gateway-vertex-handoff-smoke.mjs', optionalEnv: 'AI_GATEWAY_VERTEX_SMOKE_OPTIONAL' },
  { id: 'jimeng', script: 'ai-gateway-jimeng-smoke.mjs', optionalEnv: 'AI_GATEWAY_JIMENG_SMOKE_OPTIONAL' },
  { id: 'tripo', script: 'ai-gateway-tripo-smoke.mjs', optionalEnv: 'AI_GATEWAY_TRIPO_SMOKE_OPTIONAL' },
];

function runLane(lane, { dryRun, optional }) {
  return new Promise((resolve) => {
    const scriptPath = path.join(ROOT, lane.script);
    const args = [scriptPath];
    if (dryRun) args.push('--dry-run');
    const env = {
      ...process.env,
      AI_GATEWAY_SMOKE_OPTIONAL: optional ? '1' : String(process.env.AI_GATEWAY_SMOKE_OPTIONAL || '0'),
      AI_GATEWAY_SMOKE_REPORT_BLOCKED: '1',
      [lane.optionalEnv]: optional ? '1' : String(process.env[lane.optionalEnv] || '0'),
    };
    // Align 302 legacy flag with matrix optional.
    if (lane.id === '302' && optional) env.AI_GATEWAY_302_SMOKE_OPTIONAL = '1';

    console.log(`[smoke:ai-gateway-matrix] ▶ ${lane.id}`);
    const child = spawn(process.execPath, args, {
      env,
      stdio: 'inherit',
      cwd: path.join(ROOT, '..'),
    });
    child.on('exit', (code, signal) => {
      const exitCode = signal ? 1 : Number(code ?? 1);
      console.log(`[smoke:ai-gateway-matrix] ■ ${lane.id} exit=${exitCode}`);
      resolve({ id: lane.id, exitCode });
    });
  });
}

export { aggregateLaneResults };

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  // Matrix defaults to optional SKIP unless explicitly disabled.
  const optional =
    process.env.AI_GATEWAY_SMOKE_OPTIONAL == null || process.env.AI_GATEWAY_SMOKE_OPTIONAL === ''
      ? true
      : isSmokeOptional(process.env);

  console.log(
    `[smoke:ai-gateway-matrix] lanes=${LANES.map((l) => l.id).join(',')} optional=${optional ? '1' : '0'} dryRun=${dryRun ? '1' : '0'}`
  );

  const allowRouteOnly = String(process.env.SMOKE_ALLOW_ROUTE_ONLY || '').trim() === '1';
  const results = [];
  for (const lane of LANES) {
    results.push(await runLane(lane, { dryRun, optional }));
  }

  const agg = aggregateLaneResults(results, { optional, dryRun, allowRouteOnly });
  const counts = agg.counts || {};
  console.log(
    '[smoke:ai-gateway-matrix] summary',
    JSON.stringify({
      status: agg.status,
      counts,
      hasGeneration: agg.hasGeneration,
      dryRun: agg.dryRun,
      allowRouteOnly,
      lanes: agg.lanes,
    })
  );

  if (typeof process.env.GITHUB_STEP_SUMMARY === 'string' && process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    const lines = [
      '### AI Gateway smoke matrix',
      '',
      `- status: \`${agg.status}\``,
      `- counts: ok=${counts.ok ?? 0} skipped=${counts.skipped ?? 0} failed=${counts.failed ?? 0} blocked=${counts.blocked ?? 0}`,
      `- hasGeneration: ${agg.hasGeneration ? 'yes' : 'no'}`,
      `- dryRun: ${dryRun ? 'yes' : 'no'}`,
      '',
      '**Do not treat dry-run / all-SKIP / incomplete as pre-release green.**',
      '',
    ];
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
    } catch {
      /* ignore summary write failures */
    }
  }

  if (agg.status === 'ok') {
    console.log('[smoke:ai-gateway-matrix] OK — ≥1 Generation lane live-passed; none failed');
  } else if (agg.status === 'skipped') {
    console.log(
      '[smoke:ai-gateway-matrix] SKIPPED (UNTESTED) — all lanes blocked/skipped; NOT a pre-release pass'
    );
  } else if (agg.status === 'dry_run') {
    console.log(
      '[smoke:ai-gateway-matrix] DRY-RUN only — Key/Route may have run; Generation skipped; NOT a pre-release pass'
    );
  } else if (agg.status === 'incomplete') {
    console.log(
      '[smoke:ai-gateway-matrix] INCOMPLETE — no Generation lane succeeded (build-sha/r2 alone ≠ green)'
    );
  } else if (agg.status === 'blocked') {
    console.error(
      '[smoke:ai-gateway-matrix] BLOCKED — missing credentials (set AI_GATEWAY_SMOKE_OPTIONAL=1 to SKIP)'
    );
  } else {
    console.error('[smoke:ai-gateway-matrix] FAILED — one or more lanes hard-failed with credentials present');
  }
  process.exit(agg.exitCode);
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith('ai-gateway-smoke-matrix.mjs') ||
    process.argv[1].includes('ai-gateway-smoke-matrix'));

if (isDirect) {
  main().catch((err) => {
    console.error('[smoke:ai-gateway-matrix]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
