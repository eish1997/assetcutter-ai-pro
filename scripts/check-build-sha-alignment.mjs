#!/usr/bin/env node
/**
 * C11 / D8 — compare buildSha across web / auth-api / ai-worker-proxy.
 *
 *   npm run smoke:build-sha
 *
 * Alignment requires all three reachable with the same sha (subset match ≠ ok).
 *
 * Env:
 *   WEB_HEALTH_URL (default https://assetcutter-web.onrender.com/healthz)
 *   AUTH_API_BASE  (default https://assetcutter-auth-api.onrender.com)
 *   AI_WORKER_PROXY_API / VITE_AI_WORKER_PROXY_API
 *   ALLOW_BUILD_SHA_MISMATCH=1 — warn only
 *   AI_GATEWAY_SMOKE_OPTIONAL=1 — unreachable → SKIP exit 0
 */

import { fetch } from 'undici';
import { exitCodeForStatus, isSmokeOptional } from './ai-gateway-smoke-lib.mjs';

const DEFAULT_WEB = 'https://assetcutter-web.onrender.com/healthz';
const DEFAULT_AUTH = 'https://assetcutter-auth-api.onrender.com';
const DEFAULT_PROXY = 'https://assetcutter-ai-worker-proxy.onrender.com';

/** D8 — all three must be reachable with the same sha (subset match is not alignment). */
export const REQUIRED_BUILD_SHA_SERVICE_IDS = ['web', 'auth-api', 'ai-worker-proxy'];

export function normalizeSha(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s || s === 'unknown' || s === 'null' || s === 'undefined') return '';
  return s.slice(0, 40);
}

/**
 * @param {Array<{ id: string, sha?: string, ok?: boolean, error?: string|null }>} rows
 * @param {{ requireAll?: string[] }} [opts]
 */
export function compareBuildShas(rows, { requireAll = REQUIRED_BUILD_SHA_SERVICE_IDS } = {}) {
  const required = Array.isArray(requireAll) && requireAll.length ? requireAll : REQUIRED_BUILD_SHA_SERVICE_IDS;
  const byId = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), row]));
  const present = [];
  const missing = [];

  for (const id of required) {
    const row = byId.get(id);
    const sha = normalizeSha(row?.sha);
    if (!row || row.ok === false || !sha) {
      missing.push(id);
      continue;
    }
    present.push({
      id,
      sha,
      ok: true,
      error: row.error || null,
    });
  }

  if (missing.length) {
    return {
      status: present.length ? 'incomplete' : 'blocked',
      reason: present.length ? 'missing_services' : 'no_reachable_build_sha',
      missing,
      shas: present,
    };
  }

  const unique = [...new Set(present.map((r) => r.sha))];
  if (unique.length === 1) {
    return { status: 'ok', reason: 'aligned', sha: unique[0], shas: present };
  }
  return { status: 'failed', reason: 'mismatch', shas: present, unique };
}

async function fetchHealth(url) {
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text || '{}');
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return body;
}

async function main() {
  const optional = isSmokeOptional(process.env, 'AI_GATEWAY_BUILD_SHA_SMOKE_OPTIONAL');
  const allowMismatch = String(process.env.ALLOW_BUILD_SHA_MISMATCH || '').trim() === '1';
  const webUrl = String(process.env.WEB_HEALTH_URL || DEFAULT_WEB).trim();
  const authBase = String(process.env.AUTH_API_BASE || DEFAULT_AUTH).replace(/\/+$/, '');
  const proxyBase = String(
    process.env.AI_WORKER_PROXY_API || process.env.VITE_AI_WORKER_PROXY_API || DEFAULT_PROXY
  )
    .trim()
    .replace(/\/+$/, '');

  const targets = [
    { id: 'web', url: webUrl },
    { id: 'auth-api', url: `${authBase}/healthz` },
    { id: 'ai-worker-proxy', url: `${proxyBase}/healthz` },
  ];

  const rows = [];
  for (const target of targets) {
    try {
      const body = await fetchHealth(target.url);
      const sha = body.buildSha || body.gitSha || body.build?.sha || '';
      console.log(`[smoke:build-sha] ${target.id}`, target.url, `buildSha=${sha || '(missing)'}`);
      rows.push({ id: target.id, sha, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[smoke:build-sha] ${target.id} unreachable:`, message);
      rows.push({ id: target.id, sha: '', ok: false, error: message });
    }
  }

  const cmp = compareBuildShas(rows);
  if (cmp.status === 'ok') {
    console.log(`[smoke:build-sha] OK — web+auth+proxy aligned sha=${cmp.sha}`);
    process.exit(0);
  }
  if (cmp.status === 'blocked') {
    console.error('[smoke:build-sha] BLOCKED: no reachable healthz with buildSha');
    process.exit(exitCodeForStatus('blocked', { optional, reportBlocked: true }));
  }
  if (cmp.status === 'incomplete') {
    console.error(
      '[smoke:build-sha] INCOMPLETE — need all of web/auth-api/ai-worker-proxy reachable with same sha; missing=',
      JSON.stringify(cmp.missing || [])
    );
    if (allowMismatch) {
      console.warn('[smoke:build-sha] ALLOW_BUILD_SHA_MISMATCH=1 — continuing with warning (incomplete)');
      process.exit(0);
    }
    process.exit(exitCodeForStatus('blocked', { optional, reportBlocked: true }));
  }
  console.error('[smoke:build-sha] MISMATCH', JSON.stringify(cmp.unique || cmp.shas));
  if (allowMismatch) {
    console.warn('[smoke:build-sha] ALLOW_BUILD_SHA_MISMATCH=1 — continuing with warning');
    process.exit(0);
  }
  process.exit(1);
}

export { compareBuildShas as aggregateBuildShaRows };

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith('check-build-sha-alignment.mjs') ||
    process.argv[1].includes('check-build-sha-alignment'));

if (isDirect) {
  main().catch((err) => {
    console.error('[smoke:build-sha]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
