#!/usr/bin/env node
/**
 * C1 env profile check — dev vs prod-like acceptance contract.
 *
 * Usage:
 *   node scripts/env-profile-check.mjs --profile=dev
 *   node scripts/env-profile-check.mjs --profile=prod-like
 *   npm run env:profile:check
 *   npm run env:profile:prod-like
 *
 * Exit 0 = all hard checks passed (warnings allowed).
 * Exit 1 = one or more hard failures.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const THIS_FILE = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  let profile = '';
  for (const a of argv) {
    if (a.startsWith('--profile=')) profile = a.slice('--profile='.length).trim();
    else if (a === '--profile' || a === '-p') {
      /* next handled below */
    }
  }
  for (let i = 0; i < argv.length; i += 1) {
    if ((argv[i] === '--profile' || argv[i] === '-p') && argv[i + 1]) {
      profile = String(argv[i + 1]).trim();
    }
  }
  if (!profile) profile = String(process.env.ENV_PROFILE || 'dev').trim();
  return { profile: profile.toLowerCase() };
}

/** Load KEY=VALUE from dotenv-style files without overriding existing process.env. */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function env(name) {
  const v = process.env[name];
  return v == null ? '' : String(v).trim();
}

function isTruthy(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function isFalseyExplicit(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '0' || s === 'false' || s === 'no' || s === 'off';
}

function hostKind(urlOrHost) {
  const raw = String(urlOrHost || '').trim();
  if (!raw) return 'empty';
  if (raw === 'same-origin') return 'same-origin';
  let host = raw;
  try {
    if (raw.includes('://')) host = new URL(raw).hostname;
  } catch {
    /* keep raw */
  }
  const h = host.toLowerCase();
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '[::1]' ||
    h.endsWith('.local')
  ) {
    return 'local';
  }
  if (h.includes('onrender.com') || h.includes('vercel.app') || h.includes('adrazzo.com')) {
    return 'cloud';
  }
  return 'remote';
}

/**
 * Pure check logic (exported for tests).
 * @param {Record<string, string>} e
 * @param {'dev'|'prod-like'} profile
 */
export function evaluateProfile(e, profile) {
  const fails = [];
  const warns = [];
  const infos = [];

  const get = (k) => (e[k] == null ? '' : String(e[k]).trim());

  const authBase = get('VITE_AUTH_API_BASE_URL');
  const proxyApi = get('VITE_AI_WORKER_PROXY_API');
  const proxyVertex = get('VITE_AI_WORKER_PROXY_API_VERTEX') || proxyApi;
  const upstream = get('AI_WORKER_PROXY_UPSTREAM_URL');
  const creditsGate = (get('AI_GATEWAY_CREDITS_GATE') || 'plan').toLowerCase();
  const creditsStrictRaw = get('AI_GATEWAY_CREDITS_GATE_STRICT').toLowerCase();
  const creditsStrictOn = creditsStrictRaw === 'true' || creditsStrictRaw === '1' || creditsStrictRaw === 'on';
  const execution = get('AI_GATEWAY_EXECUTION_ENABLED');
  const fairness = get('GEMINI_FAIRNESS_ENABLED');
  const vertexInterval = get('GEMINI_VERTEX_IMAGE_MIN_INTERVAL_MS');
  const keyFirst = get('VITE_USE_BROWSER_GEMINI_KEY_FIRST');
  const openaiDirect = get('VITE_OPENAI_DIRECT');
  const veDirect = get('VITE_VECTOR_ENGINE_DIRECT');
  const unsafeTencent = get('VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS');
  const tencentProxy = get('VITE_TENCENT_PROXY');
  const model3dExecution = get('VITE_AI_GATEWAY_MODEL3D_EXECUTION').toLowerCase();
  const model3dDisabled =
    model3dExecution === '0' ||
    model3dExecution === 'false' ||
    model3dExecution === 'off' ||
    model3dExecution === 'no';
  const opsUrl = get('VITE_MODEL_OPS_CONFIG_URL');
  const databaseUrl = get('DATABASE_URL');
  const r2Bucket = get('R2_BUCKET');

  const authKind = hostKind(authBase || 'http://127.0.0.1:9100');
  const proxyKind = hostKind(proxyApi);
  const vertexKind = hostKind(proxyVertex);
  const upstreamKind = hostKind(upstream);

  infos.push(`profile=${profile}`);
  infos.push(`auth=${authKind}${authBase ? ` (${authBase})` : ' (default local via Vite proxy)'}`);
  infos.push(`proxy=${proxyKind || 'empty'}${proxyApi ? ` (${proxyApi})` : ''}`);
  infos.push(`credits=${creditsGate}`);
  infos.push(`DATABASE_URL=${databaseUrl ? 'set' : 'missing(disk)'}`);

  // Shared: execution must not be explicitly false
  if (isFalseyExplicit(execution)) {
    fails.push('AI_GATEWAY_EXECUTION_ENABLED is false — jobs may create without handoff (fake 202)');
  }

  // False-green blacklist
  if (isTruthy(keyFirst)) {
    const msg = 'VITE_USE_BROWSER_GEMINI_KEY_FIRST=true — browser Key can fake-green locally';
    if (profile === 'prod-like') fails.push(msg);
    else warns.push(`${msg} (dev-only; not pre-release)`);
  }
  if (isTruthy(openaiDirect)) {
    const msg = 'VITE_OPENAI_DIRECT=true — local CORS proxy success ≠ production';
    if (profile === 'prod-like') fails.push(msg);
    else warns.push(`${msg} (dev-only)`);
  }
  if (isTruthy(veDirect)) {
    const msg = 'VITE_VECTOR_ENGINE_DIRECT=true — local CORS proxy success ≠ production';
    if (profile === 'prod-like') fails.push(msg);
    else warns.push(`${msg} (dev-only)`);
  }
  if (isTruthy(unsafeTencent)) {
    const msg = 'VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS=true — unsafe browser credentials';
    if (profile === 'prod-like') fails.push(msg);
    else warns.push(`${msg} (dev-only)`);
  }
  if (tencentProxy) {
    const msg =
      'VITE_TENCENT_PROXY set — local ai3d-proxy diagnostic only; user Hunyuan path is AI Gateway (C9/D4)';
    if (profile === 'prod-like') fails.push(msg);
    else warns.push(`${msg} (dev-only)`);
  }
  if (model3dDisabled) {
    const msg =
      `VITE_AI_GATEWAY_MODEL3D_EXECUTION=${model3dExecution} — re-opens Tripo user-Key bypass (D4)`;
    if (profile === 'prod-like') fails.push(msg);
    else warns.push(`${msg} (dev-only)`);
  }
  if (proxyKind === 'same-origin' || vertexKind === 'same-origin') {
    const msg = 'VITE_AI_WORKER_PROXY_API*=same-origin — local 9002 path; not prod-like';
    if (profile === 'prod-like') fails.push(msg);
    else warns.push(`${msg} (dev-only)`);
  }

  // Topology: local auth + cloud proxy
  const authIsLocal = authKind === 'local' || authKind === 'empty';
  const proxyIsCloud = proxyKind === 'cloud' || proxyKind === 'remote';
  if (authIsLocal && proxyIsCloud && proxyApi) {
    const msg =
      'topology mismatch: local auth world + cloud proxy — Cookie/credits/fairness may diverge (do not treat as pre-release)';
    if (profile === 'prod-like') fails.push(msg);
    else warns.push(msg);
  }

  if (opsUrl && !opsUrl.includes('/api/model-ops-config')) {
    warns.push(
      `VITE_MODEL_OPS_CONFIG_URL=${opsUrl} — frontend catalog may diverge from auth decision`
    );
  }

  // C14: missing R2 is never "prod-ready" even in local dev.
  if (!r2Bucket) {
    warns.push('R2_BUCKET missing — job success may use data URLs / ephemeral supplier links (C14)');
  }

  if (profile === 'dev') {
    if (creditsGate === 'plan' || creditsGate === 'off' || !creditsGate) {
      warns.push(`AI_GATEWAY_CREDITS_GATE=${creditsGate || 'plan'} — OK for dev; not pre-release`);
    }
    if (!databaseUrl) {
      warns.push('DATABASE_URL missing — using disk JSON for ops/keys (not same world as Render PG)');
    }
    if (!isTruthy(fairness) && fairness !== '') {
      /* non-prod default false is ok */
      infos.push('GEMINI_FAIRNESS_ENABLED not forced on (dev OK)');
    }
  }

  if (profile === 'prod-like') {
    if (creditsGate !== 'reserve') {
      fails.push(
        `AI_GATEWAY_CREDITS_GATE=${creditsGate || 'plan'} — prod-like requires reserve (got ${creditsGate || 'plan'})`
      );
    }
    if (!creditsStrictOn) {
      fails.push(
        `AI_GATEWAY_CREDITS_GATE_STRICT=${creditsStrictRaw || '(unset)'} — prod-like requires true (D2; refuse plan/off boot)`
      );
    }
    if (!databaseUrl) {
      fails.push('DATABASE_URL missing — prod-like requires Postgres (same ops/Key world as target)');
    }
    // C13: fairness + Vertex interval live on ai-worker-proxy.
    // Cloud Render proxy already defaults fairness=on / interval≈65s — accept that path.
    // Local/same-origin proxy must set knobs explicitly (or you are not prod-like).
    const proxyIsLocalWorld = proxyKind === 'local' || proxyKind === 'same-origin' || proxyKind === 'empty';
    if (proxyIsLocalWorld) {
      if (!isTruthy(fairness)) {
        fails.push(
          'GEMINI_FAIRNESS_ENABLED must be true for prod-like when using local/same-origin proxy (C13)'
        );
      }
      const intervalNum = Number(vertexInterval);
      if (vertexInterval === '' || !Number.isFinite(intervalNum) || intervalNum < 60000) {
        fails.push(
          `GEMINI_VERTEX_IMAGE_MIN_INTERVAL_MS=${vertexInterval || '(empty→0 local)'} — prod-like local proxy requires >= 60000 (C13)`
        );
      }
    } else {
      infos.push(
        'proxy is cloud/remote — fairness + Vertex interval expected on that proxy (Render defaults: fairness on, ~65s)'
      );
      if (isFalseyExplicit(fairness)) {
        warns.push(
          'local GEMINI_FAIRNESS_ENABLED=false while frontend hits cloud proxy — irrelevant to proxy process, but confusing; unset or set true'
        );
      }
    }
    if (authIsLocal && !proxyApi) {
      fails.push('prod-like: set VITE_AUTH_API_BASE_URL and VITE_AI_WORKER_PROXY_API to the same target world');
    }
    if (upstream && upstreamKind === 'local' && (proxyKind === 'cloud' || authKind === 'cloud')) {
      warns.push('AI_WORKER_PROXY_UPSTREAM_URL is local while frontend points cloud — check relay');
    }
  }

  return { fails, warns, infos, profile };
}

function main() {
  const { profile } = parseArgs(process.argv.slice(2));
  if (profile !== 'dev' && profile !== 'prod-like') {
    console.error(`[env-profile] unknown profile "${profile}" (use dev | prod-like)`);
    process.exit(2);
  }

  loadEnvFile(path.join(ROOT, '.env.local'));
  loadEnvFile(path.join(ROOT, '.env'));

  const snapshot = { ...process.env };
  const { fails, warns, infos } = evaluateProfile(snapshot, profile);

  console.log('[env-profile] check');
  for (const line of infos) console.log(`  · ${line}`);
  for (const line of warns) console.warn(`  WARN  ${line}`);
  for (const line of fails) console.error(`  FAIL  ${line}`);

  if (fails.length) {
    console.error(`[env-profile] FAILED (${fails.length} hard, ${warns.length} warn) profile=${profile}`);
    process.exit(1);
  }
  console.log(`[env-profile] OK (${warns.length} warn) profile=${profile}`);
  process.exit(0);
}

const invokedAsMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(THIS_FILE).href;

if (invokedAsMain) {
  main();
}
