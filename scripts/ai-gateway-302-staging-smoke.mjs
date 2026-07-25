#!/usr/bin/env node
/**
 * B15：预发 302.AI 真实冒烟门禁（Key Check → Route Check → Generation Test）。
 *
 * 用法：
 *   npm run smoke:ai-gateway-302
 *   npm run smoke:ai-gateway-302 -- --dry-run   # 只检查凭据/Key 是否具备，不打 Generation
 *
 * 必填环境（真实跑）：
 *   ADMIN_IDENTIFIER, ADMIN_PASSWORD
 *
 * 可选：
 *   AUTH_API_BASE（默认 https://assetcutter-auth-api.onrender.com）
 *   ADMIN_ORIGIN（默认 https://assetcutter-web.onrender.com）
 *   AI_GATEWAY_302_PROVIDER_ID（默认 302ai）
 *   AI_GATEWAY_302_TEXT_MODEL（默认 gpt-4o-mini）
 *   AI_GATEWAY_302_IMAGE_MODEL（默认 gpt-image-1.5，需在发布白名单内）
 *   AI_GATEWAY_302_KEY_ID（指定 Key；缺省取 provider 下第一条可用）
 *   AI_GATEWAY_302_SMOKE_OPTIONAL=1  — 缺凭据时 exit 0（SKIP）而非 exit 2（BLOCKED）
 */

import { fetch } from 'undici';
import { exitCodeForStatus as exitCodeForStatusLib } from './ai-gateway-smoke-lib.mjs';

const DEFAULT_AUTH = 'https://assetcutter-auth-api.onrender.com';
const DEFAULT_ORIGIN = 'https://assetcutter-web.onrender.com';

export function classifySmokePrereq({ identifier, password, hasProviderKey }) {
  if (!identifier || !password) {
    return { status: 'blocked', reason: 'missing_admin_credentials' };
  }
  if (!hasProviderKey) {
    return { status: 'blocked', reason: 'missing_302_provider_key' };
  }
  return { status: 'ready', reason: 'ok' };
}

/** Kept for B15 tests; delegates to shared lib (C10 reportBlocked). */
export function exitCodeForStatus(status, opts = {}) {
  return exitCodeForStatusLib(status, opts);
}

function parseArgs(argv) {
  const out = { dryRun: false };
  for (const item of argv) {
    if (item === '--dry-run') out.dryRun = true;
  }
  return out;
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

function inferModality(canonicalModelId) {
  const id = String(canonicalModelId || '').trim().toLowerCase();
  if (id.includes('image') || id.startsWith('dall-e') || id.startsWith('gpt-image')) return 'image';
  return 'text';
}

class AdminClient {
  constructor({ authBase, origin, identifier, password }) {
    this.authBase = authBase.replace(/\/+$/, '');
    this.origin = origin;
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

function pick302Key(keys, providerId, keyId) {
  const rows = Array.isArray(keys) ? keys : [];
  if (keyId) {
    return rows.find((row) => String(row.id) === String(keyId)) || null;
  }
  return (
    rows.find(
      (row) =>
        String(row.provider || '').toLowerCase() === providerId &&
        row.enabled !== false &&
        Boolean(row.hasSecret)
    ) || null
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const optional =
    String(process.env.AI_GATEWAY_302_SMOKE_OPTIONAL || '').trim() === '1' ||
    String(process.env.AI_GATEWAY_SMOKE_OPTIONAL || '').trim() === '1';
  const reportBlocked = String(process.env.AI_GATEWAY_SMOKE_REPORT_BLOCKED || '').trim() === '1';
  const exitOpts = { optional, reportBlocked };
  const identifier = String(process.env.ADMIN_IDENTIFIER || '').trim();
  const password = String(process.env.ADMIN_PASSWORD || '').trim();
  const providerId = String(process.env.AI_GATEWAY_302_PROVIDER_ID || '302ai').trim().toLowerCase();
  const textModel = String(process.env.AI_GATEWAY_302_TEXT_MODEL || 'gpt-4o-mini').trim();
  const imageModel = String(process.env.AI_GATEWAY_302_IMAGE_MODEL || 'gpt-image-1.5').trim();
  const keyIdEnv = String(process.env.AI_GATEWAY_302_KEY_ID || '').trim();

  const early = classifySmokePrereq({ identifier, password, hasProviderKey: true });
  if (early.status === 'blocked' && early.reason === 'missing_admin_credentials') {
    console.error('[smoke:ai-gateway-302] BLOCKED: set ADMIN_IDENTIFIER + ADMIN_PASSWORD');
    process.exit(exitCodeForStatus('blocked', exitOpts));
  }

  const client = new AdminClient({
    authBase: process.env.AUTH_API_BASE || DEFAULT_AUTH,
    origin: process.env.ADMIN_ORIGIN || DEFAULT_ORIGIN,
    identifier,
    password,
  });
  await client.login();

  const keyList = await client.get('/api/admin/ai-gateway/provider-keys');
  const key = pick302Key(keyList.keys, providerId, keyIdEnv || undefined);
  const prereq = classifySmokePrereq({ identifier, password, hasProviderKey: Boolean(key?.id) });
  if (prereq.status === 'blocked') {
    console.error(
      `[smoke:ai-gateway-302] BLOCKED: no usable ${providerId} key in pool (set AI_GATEWAY_302_KEY_ID or add Key)`
    );
    process.exit(exitCodeForStatus('blocked', exitOpts));
  }

  console.log('[smoke:ai-gateway-302] Key Check', key.id, key.label || '');
  const keySmoke = await client.post(
    `/api/admin/ai-gateway/provider-keys/${encodeURIComponent(key.id)}/smoke-test`,
    {}
  );
  if (!keySmoke?.ok) {
    console.error('[smoke:ai-gateway-302] Key Check failed', keySmoke?.message || keySmoke?.status || keySmoke);
    process.exit(1);
  }
  console.log('[smoke:ai-gateway-302] Key Check OK', keySmoke.status || keySmoke.mode || '');

  const models = [
    { canonicalModelId: textModel, modality: 'text', providerId },
    { canonicalModelId: imageModel, modality: 'image', providerId },
  ];

  for (const model of models) {
    console.log('[smoke:ai-gateway-302] Route Check', model.canonicalModelId);
    const route = await client.post('/api/admin/model-route-test', {
      canonicalModelId: model.canonicalModelId,
      modality: model.modality || inferModality(model.canonicalModelId),
      providerId: model.providerId,
    });
    if (!route?.ok && !route?.result?.ok) {
      console.error('[smoke:ai-gateway-302] Route Check failed', route?.result || route);
      process.exit(1);
    }
    console.log('[smoke:ai-gateway-302] Route Check OK', model.canonicalModelId);
  }

  if (args.dryRun) {
    console.log('[smoke:ai-gateway-302] dry-run: skip Generation Test');
    process.exit(0);
  }

  for (const model of models) {
    console.log('[smoke:ai-gateway-302] Generation Test', model.canonicalModelId, '(real job)');
    const gen = await client.post('/api/admin/model-generation-test', {
      canonicalModelId: model.canonicalModelId,
      modality: model.modality || inferModality(model.canonicalModelId),
      providerId: model.providerId,
    });
    if (!gen?.ok && !gen?.result?.ok) {
      console.error('[smoke:ai-gateway-302] Generation Test failed', gen?.result || gen);
      process.exit(1);
    }
    console.log(
      '[smoke:ai-gateway-302] Generation Test OK',
      model.canonicalModelId,
      gen?.result?.jobId || gen?.result?.status || ''
    );
  }

  console.log('[smoke:ai-gateway-302] OK — Key + Route + Generation (text+image)');
  process.exit(0);
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith('ai-gateway-302-staging-smoke.mjs') ||
    process.argv[1].includes('ai-gateway-302-staging-smoke'));

if (isDirect) {
  main().catch((err) => {
    console.error('[smoke:ai-gateway-302]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
