#!/usr/bin/env node
/**
 * C4 — reject false-green Vite knobs in production builds / CI.
 *
 * Usage:
 *   node scripts/check-false-green-vite-env.mjs --mode=production
 *   npm run guard:false-green
 *
 * Exit 0 OK; exit 1 hard failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const THIS_FILE = fileURLToPath(import.meta.url);

const FORBIDDEN_TRUTHY = [
  'VITE_USE_BROWSER_GEMINI_KEY_FIRST',
  'VITE_OPENAI_DIRECT',
  'VITE_VECTOR_ENGINE_DIRECT',
  'VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS',
];

const PROXY_KEYS = ['VITE_AI_WORKER_PROXY_API', 'VITE_AI_WORKER_PROXY_API_VERTEX'];

/** D4: disabling Gateway 3D re-opens Tripo user-Key bypass. */
function isModel3dExecutionDisabled(env) {
  const raw = String(env.VITE_AI_GATEWAY_MODEL3D_EXECUTION || '').trim().toLowerCase();
  return raw === '0' || raw === 'false' || raw === 'off' || raw === 'no';
}

function parseArgs(argv) {
  let mode = '';
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--mode=')) mode = a.slice('--mode='.length).trim();
    else if (a === '--mode' && argv[i + 1]) mode = String(argv[++i]).trim();
  }
  if (!mode) {
    if (process.env.CI === 'true' || process.env.CI === '1') mode = 'production';
    else if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') mode = 'production';
    else mode = 'development';
  }
  return { mode: mode.toLowerCase() };
}

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
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
    out[key] = val;
  }
  return out;
}

function isTruthy(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/**
 * Merge Vite-like env layers for production guard.
 * Later layers override earlier (process.env wins).
 */
export function collectProductionViteEnv(root = ROOT, processEnv = process.env) {
  const files = ['.env', '.env.production', '.env.local', '.env.production.local'];
  const merged = {};
  for (const f of files) {
    Object.assign(merged, parseEnvFile(path.join(root, f)));
  }
  for (const [k, v] of Object.entries(processEnv)) {
    if (v != null && String(v).length) merged[k] = String(v);
  }
  return merged;
}

/**
 * @param {Record<string, string>} env
 * @param {'production'|'development'} mode
 */
export function evaluateFalseGreenViteEnv(env, mode) {
  const fails = [];
  const warns = [];
  if (mode !== 'production') {
    warns.push('mode=development — false-green knobs allowed (skipped hard fail)');
    return { fails, warns };
  }

  for (const key of FORBIDDEN_TRUTHY) {
    if (isTruthy(env[key])) {
      fails.push(`${key}=${env[key]} — forbidden in production build (false-green)`);
    }
  }
  for (const key of PROXY_KEYS) {
    const v = String(env[key] || '').trim().toLowerCase();
    if (v === 'same-origin') {
      fails.push(`${key}=same-origin — forbidden in production build (local proxy only)`);
    }
  }
  if (isModel3dExecutionDisabled(env)) {
    fails.push(
      `VITE_AI_GATEWAY_MODEL3D_EXECUTION=${env.VITE_AI_GATEWAY_MODEL3D_EXECUTION} — forbidden in production (re-opens Tripo user-Key bypass; D4)`
    );
  }
  const tencentProxy = String(env.VITE_TENCENT_PROXY || '').trim();
  if (tencentProxy) {
    fails.push(
      `VITE_TENCENT_PROXY=${tencentProxy} — forbidden in production build (local ai3d-proxy diagnostic only; D4)`
    );
  }
  return { fails, warns };
}

function main() {
  const { mode } = parseArgs(process.argv.slice(2));
  if (mode !== 'production' && mode !== 'development') {
    console.error(`[false-green] unknown mode "${mode}"`);
    process.exit(2);
  }

  const env = collectProductionViteEnv();
  const { fails, warns } = evaluateFalseGreenViteEnv(env, mode);

  console.log(`[false-green] mode=${mode}`);
  for (const w of warns) console.warn(`  WARN  ${w}`);
  for (const f of fails) console.error(`  FAIL  ${f}`);

  if (fails.length) {
    console.error(`[false-green] FAILED (${fails.length}) — unset these before production build`);
    process.exit(1);
  }
  console.log('[false-green] OK');
  process.exit(0);
}

const invokedAsMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(THIS_FILE).href;

if (invokedAsMain) {
  main();
}
