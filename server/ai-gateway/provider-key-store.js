import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { USE_POSTGRES, ensurePostgres, getPool } from '../auth-store.js';

const DEFAULT_PROVIDER = 'tripo';

function diskPath() {
  const custom = String(process.env.AI_GATEWAY_PROVIDER_KEYS_PATH || '').trim();
  return custom ? path.resolve(custom) : path.resolve(process.cwd(), 'server/data/ai-gateway-provider-keys.json');
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function createKeyId(provider = DEFAULT_PROVIDER) {
  return `aigkey_${provider}_${crypto.randomUUID()}`;
}

export function maskProviderSecret(secret) {
  const s = nonEmptyString(secret);
  if (!s) return '';
  if (s.length <= 10) return `${s.slice(0, 2)}****${s.slice(-2)}`;
  return `${s.slice(0, 6)}****${s.slice(-4)}`;
}

export function normalizeProviderKeyRow(input, existing = null) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const provider = nonEmptyString(raw.provider) || nonEmptyString(existing?.provider) || DEFAULT_PROVIDER;
  const secret = nonEmptyString(raw.secret) || nonEmptyString(raw.apiKey) || nonEmptyString(existing?.secret);
  return {
    id: nonEmptyString(raw.id) || nonEmptyString(existing?.id) || createKeyId(provider),
    provider,
    label: nonEmptyString(raw.label) || nonEmptyString(existing?.label) || provider,
    secret,
    enabled: raw.enabled !== false,
    priority: Math.max(1, Math.min(9999, Math.floor(Number(raw.priority ?? existing?.priority ?? 100)) || 100)),
    rpm: Math.max(0, Math.min(10000, Math.floor(Number(raw.rpm ?? existing?.rpm ?? 0)) || 0)),
    updatedAt: nonEmptyString(raw.updatedAt) || nonEmptyString(existing?.updatedAt) || null,
    updatedByUserId: nonEmptyString(raw.updatedByUserId) || nonEmptyString(existing?.updatedByUserId) || null,
  };
}

const keyRuntimeState = new Map();

function runtimeForKey(id) {
  const key = nonEmptyString(id);
  if (!key) return {};
  if (!keyRuntimeState.has(key)) {
    keyRuntimeState.set(key, {
      minuteBucket: 0,
      minuteCount: 0,
      cooldownUntil: 0,
      lastUsedAt: null,
      lastErrorAt: null,
      lastError: null,
      errorCount: 0,
    });
  }
  return keyRuntimeState.get(key);
}

function redactKey(row) {
  const runtime = runtimeForKey(row.id);
  const now = Date.now();
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    enabled: row.enabled !== false,
    priority: row.priority,
    rpm: row.rpm || 0,
    secretPreview: maskProviderSecret(row.secret),
    hasSecret: Boolean(nonEmptyString(row.secret)),
    updatedAt: row.updatedAt || null,
    updatedByUserId: row.updatedByUserId || null,
    runtime: {
      lastUsedAt: runtime.lastUsedAt || null,
      lastErrorAt: runtime.lastErrorAt || null,
      lastError: runtime.lastError || null,
      errorCount: runtime.errorCount || 0,
      cooldownUntil: runtime.cooldownUntil ? new Date(runtime.cooldownUntil).toISOString() : null,
      coolingDown: Boolean(runtime.cooldownUntil && runtime.cooldownUntil > now),
      currentMinuteCount: runtime.minuteCount || 0,
    },
  };
}

function envKeysForProvider(provider) {
  if (provider !== 'tripo') return [];
  const joined = String(process.env.TRIPO_API_KEYS || process.env.TRIPO_API_KEY || '').trim();
  if (!joined) return [];
  return joined
    .split(/[\n,;]/)
    .map((secret, index) => normalizeProviderKeyRow({
      id: `env_tripo_${index + 1}`,
      provider,
      label: index === 0 ? 'TRIPO_API_KEY' : `TRIPO_API_KEYS ${index + 1}`,
      secret,
      enabled: true,
      priority: 9000 + index,
    }))
    .filter((row) => row.secret);
}

function normalizeKeyList(rows) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizeProviderKeyRow(row);
    if (!normalized.secret || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
}

function readDiskRows() {
  try {
    const parsed = JSON.parse(fs.readFileSync(diskPath(), 'utf8') || '{}');
    return normalizeKeyList(parsed.keys || []);
  } catch {
    return [];
  }
}

async function writeDiskRows(rows, updatedByUserId = null) {
  const payload = {
    keys: normalizeKeyList(rows).map((row) => ({
      ...row,
      updatedAt: new Date().toISOString(),
      updatedByUserId: nonEmptyString(updatedByUserId) || row.updatedByUserId || null,
    })),
  };
  await fsPromises.mkdir(path.dirname(diskPath()), { recursive: true });
  await fsPromises.writeFile(diskPath(), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload.keys;
}

let storeReady = false;
const lastKeyIndexByProvider = new Map();

export async function ensureProviderKeyStore() {
  if (storeReady) return;
  if (!USE_POSTGRES) {
    storeReady = true;
    return;
  }
  await ensurePostgres();
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ai_gateway_provider_keys (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      secret TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      priority INTEGER NOT NULL DEFAULT 100,
      rpm INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL,
      updated_by_user_id TEXT NULL
    );
  `);
  await getPool().query(`CREATE INDEX IF NOT EXISTS idx_ai_gateway_provider_keys_provider ON ai_gateway_provider_keys(provider, enabled, priority);`);
  storeReady = true;
}

async function readDbRows() {
  await ensureProviderKeyStore();
  const res = await getPool().query(
    `SELECT id, provider, label, secret, enabled, priority, rpm, updated_at, updated_by_user_id
     FROM ai_gateway_provider_keys
     ORDER BY priority ASC, label ASC`
  );
  return res.rows.map((row) => normalizeProviderKeyRow({
    id: row.id,
    provider: row.provider,
    label: row.label,
    secret: row.secret,
    enabled: row.enabled,
    priority: row.priority,
    rpm: row.rpm,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedByUserId: row.updated_by_user_id || null,
  }));
}

async function writeDbRows(rows, updatedByUserId = null) {
  await ensureProviderKeyStore();
  const p = getPool();
  const now = new Date().toISOString();
  const next = normalizeKeyList(rows).map((row) => ({
    ...row,
    updatedAt: now,
    updatedByUserId: nonEmptyString(updatedByUserId) || row.updatedByUserId || null,
  }));
  await p.query('BEGIN');
  try {
    await p.query('DELETE FROM ai_gateway_provider_keys');
    for (const row of next) {
      await p.query(
        `INSERT INTO ai_gateway_provider_keys
         (id, provider, label, secret, enabled, priority, rpm, updated_at, updated_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.id, row.provider, row.label, row.secret, row.enabled !== false, row.priority, row.rpm || 0, row.updatedAt, row.updatedByUserId]
      );
    }
    await p.query('COMMIT');
  } catch (err) {
    await p.query('ROLLBACK');
    throw err;
  }
  return next;
}

export async function listProviderKeys({ includeSecrets = false } = {}) {
  const rows = USE_POSTGRES ? await readDbRows() : readDiskRows();
  const withEnv = [...rows, ...envKeysForProvider(DEFAULT_PROVIDER)];
  return includeSecrets ? withEnv : withEnv.map(redactKey);
}

export async function saveProviderKeys(rows, { updatedByUserId = null } = {}) {
  const saved = USE_POSTGRES ? await writeDbRows(rows, updatedByUserId) : await writeDiskRows(rows, updatedByUserId);
  return saved.map(redactKey);
}

export async function acquireProviderKey(provider = DEFAULT_PROVIDER) {
  const rows = await listProviderKeys({ includeSecrets: true });
  const now = Date.now();
  const minuteBucket = Math.floor(now / 60_000);
  const candidates = rows
    .filter((row) => {
      if (row.provider !== provider || row.enabled === false || !row.secret) return false;
      const runtime = runtimeForKey(row.id);
      if (runtime.cooldownUntil && runtime.cooldownUntil > now) return false;
      if (runtime.minuteBucket !== minuteBucket) {
        runtime.minuteBucket = minuteBucket;
        runtime.minuteCount = 0;
      }
      return !row.rpm || runtime.minuteCount < row.rpm;
    })
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
  if (!candidates.length) return null;
  const bestPriority = candidates[0].priority;
  const pool = candidates.filter((row) => row.priority === bestPriority);
  const last = lastKeyIndexByProvider.get(provider) ?? -1;
  const nextIndex = (last + 1) % pool.length;
  lastKeyIndexByProvider.set(provider, nextIndex);
  const key = pool[nextIndex];
  if (!key) return null;
  const runtime = runtimeForKey(key.id);
  runtime.minuteBucket = minuteBucket;
  runtime.minuteCount = (runtime.minuteCount || 0) + 1;
  runtime.lastUsedAt = new Date(now).toISOString();
  return {
    id: key.id,
    provider: key.provider,
    label: key.label,
    secret: key.secret,
    rpm: key.rpm || 0,
  };
}

export function recordProviderKeySuccess(id) {
  const runtime = runtimeForKey(id);
  runtime.lastUsedAt = new Date().toISOString();
  runtime.lastError = null;
}

export function recordProviderKeyError(id, error, options = {}) {
  const runtime = runtimeForKey(id);
  const message = error instanceof Error ? error.message : String(error || 'provider key error');
  const now = Date.now();
  runtime.lastErrorAt = new Date(now).toISOString();
  runtime.lastError = message.slice(0, 500);
  runtime.errorCount = (runtime.errorCount || 0) + 1;
  const cooldownMs = Number(options.cooldownMs || 0);
  if (cooldownMs > 0) runtime.cooldownUntil = Math.max(runtime.cooldownUntil || 0, now + cooldownMs);
}

export function resetProviderKeyRuntimeForTests() {
  keyRuntimeState.clear();
  lastKeyIndexByProvider.clear();
}
