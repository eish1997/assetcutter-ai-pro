#!/usr/bin/env node
/**
 * C2 — read-only pull of online model-ops (+ redacted provider-key mirror) into local disk.
 *
 * Usage:
 *   ADMIN_IDENTIFIER=... ADMIN_PASSWORD=... npm run admin:pull-online-config
 *   npm run admin:pull-online-config -- --dry-run
 *
 * Never writes provider API secrets into ai-gateway-provider-keys.json.
 * Writes:
 *   server/data/model-ops-config.json
 *   server/data/ai-gateway-ops-control.json (if online returns config)
 *   server/data/ai-gateway-provider-keys.online-mirror.json (redacted; gitignored)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetch } from 'undici';

const ROOT = process.cwd();
const THIS_FILE = fileURLToPath(import.meta.url);
const DEFAULT_AUTH = 'https://assetcutter-auth-api.onrender.com';
const DEFAULT_ORIGIN = 'https://assetcutter-web.onrender.com';

const PATHS = {
  modelOps: path.join(ROOT, 'server/data/model-ops-config.json'),
  opsControl: path.join(ROOT, 'server/data/ai-gateway-ops-control.json'),
  keysMirror: path.join(ROOT, 'server/data/ai-gateway-provider-keys.online-mirror.json'),
  localKeys: path.join(ROOT, 'server/data/ai-gateway-provider-keys.json'),
};

export function redactProviderKeysPayload(result) {
  const keys = Array.isArray(result?.keys) ? result.keys : [];
  return {
    pulledAt: new Date().toISOString(),
    note: 'Redacted mirror only — secrets never written. Fill local ai-gateway-provider-keys.json via Admin or provider-key-upsert.',
    keys: keys.map((row) => ({
      id: row.id,
      provider: row.provider,
      label: row.label,
      enabled: row.enabled !== false,
      priority: row.priority,
      rpm: row.rpm || 0,
      secretPreview: row.secretPreview || null,
      hasSecret: Boolean(row.hasSecret),
      healthStatus: row.runtime?.healthStatus || null,
      baseUrl: row.credentials?.baseUrl || row.baseUrl || null,
    })),
  };
}

export function summarizeKeyGap(onlineMirror, localKeysRaw) {
  const online = onlineMirror?.keys || [];
  const localRows = Array.isArray(localKeysRaw?.keys)
    ? localKeysRaw.keys
    : Array.isArray(localKeysRaw)
      ? localKeysRaw
      : [];
  const localProviders = new Set(
    localRows.map((r) => String(r.provider || '').trim().toLowerCase()).filter(Boolean)
  );
  const missingLocally = online
    .filter((r) => r.enabled !== false && r.hasSecret)
    .filter((r) => !localProviders.has(String(r.provider || '').trim().toLowerCase()))
    .map((r) => ({ provider: r.provider, label: r.label, id: r.id }));
  return {
    onlineKeyCount: online.length,
    localKeyCount: localRows.length,
    missingLocally,
  };
}

export function extractPublishedAllowlist(modelOpsBody) {
  const config = modelOpsBody?.config && typeof modelOpsBody.config === 'object' ? modelOpsBody.config : modelOpsBody;
  const list = config?.publishedCanonicalModelAllowlist;
  return Array.isArray(list) ? list.map(String) : null;
}

function parseArgs(argv) {
  const out = { dryRun: false };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    if (a === '--help' || a === '-h') out.help = true;
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

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const bak = `${filePath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(filePath, bak);
  return bak;
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function loginAndGet(authBase, origin, identifier, password) {
  const res = await fetch(`${authBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ identifier, password }),
  });
  const text = await res.text();
  const cookie = cookieHeaderFromResponse(res);
  if (!res.ok || !cookie.includes('ac_session=')) {
    throw new Error(`Login failed: HTTP ${res.status} ${publicError(res, text)}`);
  }
  async function get(apiPath) {
    const r = await fetch(`${authBase}${apiPath}`, {
      method: 'GET',
      headers: { Origin: origin, Cookie: cookie },
    });
    const t = await r.text();
    let body = {};
    try {
      body = JSON.parse(t || '{}');
    } catch {
      body = { raw: t };
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${publicError(r, t)} ${apiPath}`);
    return body;
  }
  return { get, cookie };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Read-only pull online model-ops / ops-control / redacted keys → server/data/

  ADMIN_IDENTIFIER=... ADMIN_PASSWORD=... npm run admin:pull-online-config
  npm run admin:pull-online-config -- --dry-run

Optional: AUTH_API_BASE, ADMIN_ORIGIN
Never writes provider secrets into ai-gateway-provider-keys.json.`);
    return;
  }

  const identifier = String(process.env.ADMIN_IDENTIFIER || '').trim();
  const password = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!identifier || !password) {
    console.error('[pull-online-config] ADMIN_IDENTIFIER and ADMIN_PASSWORD are required');
    process.exit(2);
  }

  const authBase = String(process.env.AUTH_API_BASE || DEFAULT_AUTH).replace(/\/+$/, '');
  const origin = String(process.env.ADMIN_ORIGIN || DEFAULT_ORIGIN);
  const { get } = await loginAndGet(authBase, origin, identifier, password);

  const [modelOpsBody, opsControlBody, keysBody] = await Promise.all([
    get('/api/admin/model-ops-config'),
    get('/api/admin/ai-gateway/ops-control'),
    get('/api/admin/ai-gateway/provider-keys'),
  ]);

  const modelOpsConfig =
    modelOpsBody?.config && typeof modelOpsBody.config === 'object' ? modelOpsBody.config : modelOpsBody;
  const opsControlConfig =
    opsControlBody?.config && typeof opsControlBody.config === 'object'
      ? opsControlBody.config
      : opsControlBody;

  const mirror = redactProviderKeysPayload(keysBody);
  const localKeys = readJsonSafe(PATHS.localKeys);
  const gap = summarizeKeyGap(mirror, localKeys);
  const allowlist = extractPublishedAllowlist(modelOpsBody);

  console.log('[pull-online-config] source', authBase);
  console.log(
    '[pull-online-config] publishedCanonicalModelAllowlist',
    allowlist ? `${allowlist.length} models` : '(null/open)'
  );
  if (allowlist?.length) {
    console.log(`  · ${allowlist.slice(0, 12).join(', ')}${allowlist.length > 12 ? ' …' : ''}`);
  }
  console.log(
    `[pull-online-config] provider keys online=${gap.onlineKeyCount} local=${gap.localKeyCount} missingLocally=${gap.missingLocally.length}`
  );
  for (const m of gap.missingLocally.slice(0, 20)) {
    console.warn(`  WARN  online has secret for ${m.provider} (${m.label || m.id}) but local disk has no row`);
  }

  if (args.dryRun) {
    console.log('[pull-online-config] dry-run — no files written');
    process.exit(0);
  }

  const bakOps = backupFile(PATHS.modelOps);
  const bakCtrl = backupFile(PATHS.opsControl);
  writeJson(PATHS.modelOps, modelOpsConfig);
  if (opsControlConfig && typeof opsControlConfig === 'object') {
    writeJson(PATHS.opsControl, opsControlConfig);
  }
  writeJson(PATHS.keysMirror, mirror);

  console.log('[pull-online-config] wrote', PATHS.modelOps, bakOps ? `(backup ${path.basename(bakOps)})` : '');
  console.log('[pull-online-config] wrote', PATHS.opsControl, bakCtrl ? `(backup ${path.basename(bakCtrl)})` : '');
  console.log('[pull-online-config] wrote', PATHS.keysMirror, '(redacted)');
  console.log(
    '[pull-online-config] OK — restart auth-api to reload disk stores; do not commit provider secrets; review model-ops before git add'
  );
}

const invokedAsMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(THIS_FILE).href;

if (invokedAsMain) {
  main().catch((err) => {
    console.error('[pull-online-config]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
