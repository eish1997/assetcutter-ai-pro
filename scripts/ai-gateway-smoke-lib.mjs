#!/usr/bin/env node
/**
 * C10 — shared helpers for AI Gateway staging smoke lanes.
 */

import { fetch } from 'undici';

export const DEFAULT_AUTH = 'https://assetcutter-auth-api.onrender.com';
export const DEFAULT_ORIGIN = 'https://assetcutter-web.onrender.com';

export function exitCodeForStatus(status, { optional = false, reportBlocked } = {}) {
  if (status === 'ok' || status === 'skipped') return 0;
  if (status === 'blocked') {
    // Matrix sets AI_GATEWAY_SMOKE_REPORT_BLOCKED=1 so SKIP can be distinguished from OK.
    const report =
      typeof reportBlocked === 'boolean'
        ? reportBlocked
        : String(process.env.AI_GATEWAY_SMOKE_REPORT_BLOCKED || '').trim() === '1';
    if (report) return 2;
    return optional ? 0 : 2;
  }
  return 1;
}

export function classifyAdminPrereq({ identifier, password }) {
  if (!identifier || !password) {
    return { status: 'blocked', reason: 'missing_admin_credentials' };
  }
  return { status: 'ready', reason: 'ok' };
}

export function classifyProviderKeyPrereq({ identifier, password, hasProviderKey, providerId }) {
  const admin = classifyAdminPrereq({ identifier, password });
  if (admin.status === 'blocked') return admin;
  if (!hasProviderKey) {
    return { status: 'blocked', reason: `missing_${providerId || 'provider'}_key` };
  }
  return { status: 'ready', reason: 'ok' };
}

export function isSmokeOptional(env = process.env, laneEnvKey = '') {
  if (laneEnvKey && String(env[laneEnvKey] || '').trim() === '1') return true;
  return String(env.AI_GATEWAY_SMOKE_OPTIONAL || '').trim() === '1';
}

export function parseDryRunArgs(argv) {
  return { dryRun: argv.includes('--dry-run') };
}

function cookieHeaderFromResponse(res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return raw
    .map((value) => String(value).split(';')[0])
    .filter(Boolean)
    .join('; ');
}

function publicError(res, text) {
  try {
    const parsed = JSON.parse(text || '{}');
    return parsed.message || parsed.error || parsed.code || text;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

export class AdminClient {
  constructor({ authBase, origin, identifier, password }) {
    this.authBase = String(authBase || DEFAULT_AUTH).replace(/\/+$/, '');
    this.origin = origin || DEFAULT_ORIGIN;
    this.identifier = identifier;
    this.password = password;
    this.cookie = '';
  }

  async login() {
    const res = await fetch(`${this.authBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: this.origin },
      body: JSON.stringify({ identifier: this.identifier, password: this.password }),
    });
    const text = await res.text();
    this.cookie = cookieHeaderFromResponse(res);
    if (!res.ok || !this.cookie.includes('ac_session=')) {
      throw new Error(`Login failed: HTTP ${res.status} ${publicError(res, text)}`);
    }
  }

  async request(path, init = {}) {
    const res = await fetch(`${this.authBase}${path}`, {
      ...init,
      headers: {
        Origin: this.origin,
        ...(init.headers || {}),
        Cookie: this.cookie,
      },
    });
    const text = await res.text();
    let body = {};
    try {
      body = JSON.parse(text || '{}');
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${publicError(res, text)}`);
    }
    return body;
  }

  get(path) {
    return this.request(path, { method: 'GET' });
  }

  post(path, body) {
    return this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }
}

export function pickProviderKey(keys, providerId, keyId) {
  const rows = Array.isArray(keys) ? keys : [];
  const provider = String(providerId || '').toLowerCase();
  if (keyId) {
    return rows.find((row) => String(row.id) === String(keyId)) || null;
  }
  return (
    rows.find(
      (row) =>
        String(row.provider || '').toLowerCase() === provider &&
        row.enabled !== false &&
        Boolean(row.hasSecret)
    ) || null
  );
}

export function extractProxyJobId(payload) {
  const result = payload?.result && typeof payload.result === 'object' ? payload.result : payload;
  const direct = String(result?.proxyJobId || '').trim();
  if (direct) return direct;
  const meta = result?.job?.metadata || result?.metadata || {};
  return String(meta.proxyJobId || result?.job?.proxyJobId || '').trim();
}

/** Lanes that can prove real Generation (not build-sha / r2-only). */
export const DEFAULT_GENERATION_LANE_IDS = ['302', 'vertex', 'jimeng', 'tripo'];

function countLaneStatuses(mapped) {
  const counts = { ok: 0, skipped: 0, blocked: 0, failed: 0 };
  for (const row of mapped) {
    if (counts[row.status] != null) counts[row.status] += 1;
  }
  return counts;
}

/**
 * Aggregate lane exit outcomes for the matrix runner (D1).
 * - All SKIP → `skipped` (exit 0 when optional) — never `ok`.
 * - `--dry-run` → `dry_run` (not `ok`) unless `allowRouteOnly`.
 * - Live `ok` requires ≥1 generation lane exit 0 (unless `allowRouteOnly`).
 *
 * @param {Array<{ id: string, exitCode: number }>} lanes
 * @param {{
 *   optional?: boolean,
 *   dryRun?: boolean,
 *   allowRouteOnly?: boolean,
 *   generationLaneIds?: string[],
 * }} opts
 */
export function aggregateLaneResults(
  lanes,
  {
    optional = true,
    dryRun = false,
    allowRouteOnly = false,
    generationLaneIds = DEFAULT_GENERATION_LANE_IDS,
  } = {}
) {
  const rows = Array.isArray(lanes) ? lanes : [];
  const genSet = new Set(
    (Array.isArray(generationLaneIds) ? generationLaneIds : DEFAULT_GENERATION_LANE_IDS).map(String)
  );
  const mapped = rows.map((lane) => {
    const code = Number(lane.exitCode);
    let status = 'failed';
    if (code === 0) status = 'ok';
    else if (code === 2) status = optional ? 'skipped' : 'blocked';
    return { id: lane.id, exitCode: code, status };
  });
  const counts = countLaneStatuses(mapped);
  const hasGenerationOk = mapped.some((r) => genSet.has(String(r.id)) && r.status === 'ok');
  const base = { lanes: mapped, counts, hasGeneration: hasGenerationOk, dryRun: Boolean(dryRun) };

  if (mapped.some((r) => r.status === 'failed')) {
    return { ...base, status: 'failed', exitCode: 1 };
  }
  if (mapped.some((r) => r.status === 'blocked')) {
    return { ...base, status: 'blocked', exitCode: 2 };
  }
  if (mapped.every((r) => r.status === 'skipped')) {
    return { ...base, status: 'skipped', exitCode: 0, hasGeneration: false };
  }

  if (dryRun) {
    if (allowRouteOnly) {
      return { ...base, status: 'ok', exitCode: 0, hasGeneration: false };
    }
    // Preflight with OPTIONAL=0 must not use dry-run as a live pass.
    return { ...base, status: 'dry_run', exitCode: optional ? 0 : 2, hasGeneration: false };
  }

  if (!hasGenerationOk && !allowRouteOnly) {
    return {
      ...base,
      status: 'incomplete',
      exitCode: optional ? 0 : 2,
      hasGeneration: false,
    };
  }

  return { ...base, status: 'ok', exitCode: 0 };
}

export async function runKeyRouteGenerationLane(options) {
  const {
    laneTag,
    providerId,
    models,
    keyIdEnv = '',
    requireProxyJobId = false,
    dryRun = false,
    optional = true,
    authBase = process.env.AUTH_API_BASE || DEFAULT_AUTH,
    origin = process.env.ADMIN_ORIGIN || DEFAULT_ORIGIN,
    identifier = String(process.env.ADMIN_IDENTIFIER || '').trim(),
    password = String(process.env.ADMIN_PASSWORD || '').trim(),
  } = options;

  const log = (msg, ...rest) => console.log(`[${laneTag}]`, msg, ...rest);
  const err = (msg, ...rest) => console.error(`[${laneTag}]`, msg, ...rest);

  const early = classifyAdminPrereq({ identifier, password });
  if (early.status === 'blocked') {
    err('BLOCKED: set ADMIN_IDENTIFIER + ADMIN_PASSWORD');
    return exitCodeForStatus('blocked', { optional });
  }

  const client = new AdminClient({ authBase, origin, identifier, password });
  await client.login();

  const keyList = await client.get('/api/admin/ai-gateway/provider-keys');
  const key = pickProviderKey(keyList.keys, providerId, keyIdEnv || undefined);
  const prereq = classifyProviderKeyPrereq({
    identifier,
    password,
    hasProviderKey: Boolean(key?.id),
    providerId,
  });
  if (prereq.status === 'blocked') {
    err(`BLOCKED: no usable ${providerId} key in pool`);
    return exitCodeForStatus('blocked', { optional });
  }

  log('Key Check', key.id, key.label || '');
  const keySmoke = await client.post(
    `/api/admin/ai-gateway/provider-keys/${encodeURIComponent(key.id)}/smoke-test`,
    {}
  );
  if (!keySmoke?.ok) {
    err('Key Check failed', keySmoke?.message || keySmoke?.status || keySmoke);
    return 1;
  }
  log('Key Check OK', keySmoke.status || keySmoke.mode || '');

  for (const model of models) {
    log('Route Check', model.canonicalModelId);
    const route = await client.post('/api/admin/model-route-test', {
      canonicalModelId: model.canonicalModelId,
      modality: model.modality,
      providerId: model.providerId || providerId,
    });
    if (!route?.ok && !route?.result?.ok) {
      err('Route Check failed', route?.result || route);
      return 1;
    }
    log('Route Check OK', model.canonicalModelId);
  }

  if (dryRun) {
    log('dry-run: skip Generation Test');
    return 0;
  }

  for (const model of models) {
    log('Generation Test', model.canonicalModelId, '(real job)');
    const gen = await client.post('/api/admin/model-generation-test', {
      canonicalModelId: model.canonicalModelId,
      modality: model.modality,
      providerId: model.providerId || providerId,
    });
    const result = gen?.result || gen;
    if (!gen?.ok && !result?.ok) {
      err('Generation Test failed', result || gen);
      return 1;
    }
    const proxyJobId = extractProxyJobId(gen);
    if (requireProxyJobId && !proxyJobId) {
      err('Generation OK but missing proxyJobId (Vertex/proxy handoff required)', result?.jobId || '');
      return 1;
    }
    log(
      'Generation Test OK',
      model.canonicalModelId,
      result?.jobId || result?.status || '',
      proxyJobId ? `proxyJobId=${proxyJobId}` : ''
    );
  }

  log('OK');
  return 0;
}
