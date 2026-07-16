import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { USE_POSTGRES, getPool, ensurePostgres } from './auth-store.js';

const CONFIG_ROW_ID = 'default';

export const GEMINI_FAIRNESS_CONFIG_KEYS = new Set([
  'AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT',
  'GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT',
  'GEMINI_FAIRNESS_USER_MAX_QUEUED',
  'GEMINI_FAIRNESS_USER_SUBMIT_RPM',
  'GEMINI_FAIRNESS_ANON_MAX_IN_FLIGHT',
  'GEMINI_FAIRNESS_ANON_MAX_QUEUED',
  'GEMINI_FAIRNESS_ANON_SUBMIT_RPM',
  'GEMINI_FAIRNESS_GLOBAL_QUEUE_MAX',
  'GEMINI_FAIRNESS_KEY_MAX_LEN',
  'GEMINI_FAIRNESS_HMAC_SKEW_SEC',
]);

export const GEMINI_FAIRNESS_CLAMP = {
  AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT: [1, 64],
  GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT: [1, 32],
  GEMINI_FAIRNESS_USER_MAX_QUEUED: [1, 200],
  GEMINI_FAIRNESS_USER_SUBMIT_RPM: [1, 500],
  GEMINI_FAIRNESS_ANON_MAX_IN_FLIGHT: [1, 32],
  GEMINI_FAIRNESS_ANON_MAX_QUEUED: [1, 100],
  GEMINI_FAIRNESS_ANON_SUBMIT_RPM: [1, 500],
  GEMINI_FAIRNESS_GLOBAL_QUEUE_MAX: [10, 5000],
  GEMINI_FAIRNESS_KEY_MAX_LEN: [8, 512],
  GEMINI_FAIRNESS_HMAC_SKEW_SEC: [10, 600],
};

export function geminiFairnessDiskPath() {
  const custom = String(process.env.GEMINI_FAIRNESS_CONFIG_PATH || '').trim();
  return custom
    ? path.resolve(custom)
    : path.resolve(process.cwd(), 'server/data/gemini-fairness-config.json');
}

/** @returns {'env_only' | 'disk' | 'db'} */
export function resolveGeminiFairnessConfigSource() {
  const explicit = String(process.env.GEMINI_FAIRNESS_CONFIG_SOURCE || '').trim().toLowerCase();
  if (explicit === 'env_only') return 'env_only';
  if (explicit === 'disk') return 'disk';
  if (explicit === 'db') return USE_POSTGRES ? 'db' : 'disk';
  return USE_POSTGRES ? 'db' : 'disk';
}

export function clampGeminiFairnessValue(key, n) {
  const pair = GEMINI_FAIRNESS_CLAMP[key];
  if (!pair) return null;
  const [lo, hi] = pair;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

export function normalizeGeminiFairnessConfig(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'config 须为 JSON 对象' };
  }
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (!GEMINI_FAIRNESS_CONFIG_KEYS.has(k)) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) return { ok: false, error: `非法数值：${k}` };
    const c = clampGeminiFairnessValue(k, n);
    if (c == null) return { ok: false, error: `未知键：${k}` };
    out[k] = c;
  }
  return { ok: true, config: out };
}

function sanitizeConfigObject(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!GEMINI_FAIRNESS_CONFIG_KEYS.has(k)) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const c = clampGeminiFairnessValue(k, n);
    if (c != null) out[k] = c;
  }
  return out;
}

let storeReady = false;

async function ensureGeminiFairnessConfigTablePg(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS gemini_fairness_config (
      id TEXT PRIMARY KEY DEFAULT 'default',
      config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL,
      updated_by_user_id TEXT NULL
    );
  `);
}

async function readGeminiFairnessConfigFromDisk() {
  try {
    const raw = await fsPromises.readFile(geminiFairnessDiskPath(), 'utf8');
    const j = JSON.parse(raw);
    return sanitizeConfigObject(j);
  } catch {
    return {};
  }
}

async function writeGeminiFairnessConfigToDisk(config) {
  const filePath = geminiFairnessDiskPath();
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function readGeminiFairnessConfigFromDb() {
  await ensurePostgres();
  const p = getPool();
  const res = await p.query(
    'SELECT config_json, updated_at, updated_by_user_id FROM gemini_fairness_config WHERE id = $1 LIMIT 1',
    [CONFIG_ROW_ID]
  );
  if (!res.rows[0]) return { config: {}, updatedAt: null, updatedByUserId: null };
  const row = res.rows[0];
  const config = sanitizeConfigObject(
    typeof row.config_json === 'object' && row.config_json ? row.config_json : JSON.parse(String(row.config_json || '{}'))
  );
  return {
    config,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedByUserId: row.updated_by_user_id || null,
  };
}

async function writeGeminiFairnessConfigToDb(config, { updatedByUserId = null } = {}) {
  await ensurePostgres();
  const p = getPool();
  const ts = new Date().toISOString();
  const sanitized = sanitizeConfigObject(config);
  await p.query(
    `INSERT INTO gemini_fairness_config (id, config_json, updated_at, updated_by_user_id)
     VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       config_json = EXCLUDED.config_json,
       updated_at = EXCLUDED.updated_at,
       updated_by_user_id = EXCLUDED.updated_by_user_id`,
    [CONFIG_ROW_ID, JSON.stringify(sanitized), ts, updatedByUserId]
  );
  return { config: sanitized, updatedAt: ts, updatedByUserId };
}

async function migrateDiskToDbIfEmpty() {
  const { config } = await readGeminiFairnessConfigFromDb();
  if (Object.keys(config).length > 0) return false;
  const fromDisk = await readGeminiFairnessConfigFromDisk();
  if (!Object.keys(fromDisk).length) return false;
  await writeGeminiFairnessConfigToDb(fromDisk, { updatedByUserId: null });
  console.warn('[gemini-fairness-config] migrated disk JSON into Postgres (one-time)');
  return true;
}

export async function ensureGeminiFairnessConfigStore() {
  if (storeReady) return;
  const source = resolveGeminiFairnessConfigSource();
  if (source === 'db') {
    await ensurePostgres();
    await ensureGeminiFairnessConfigTablePg(getPool());
    await migrateDiskToDbIfEmpty();
  }
  storeReady = true;
}

export async function getGeminiFairnessConfigMeta() {
  await ensureGeminiFairnessConfigStore();
  const source = resolveGeminiFairnessConfigSource();
  if (source === 'env_only') {
    return { source, path: null, updatedAt: null, storage: 'env_only' };
  }
  if (source === 'disk') {
    return { source, path: geminiFairnessDiskPath(), updatedAt: null, storage: 'disk' };
  }
  const row = await readGeminiFairnessConfigFromDb();
  return {
    source: 'db',
    path: null,
    storage: 'postgres',
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId,
  };
}

export async function readGeminiFairnessConfig() {
  await ensureGeminiFairnessConfigStore();
  const source = resolveGeminiFairnessConfigSource();
  if (source === 'env_only') return {};
  if (source === 'disk') return readGeminiFairnessConfigFromDisk();
  const row = await readGeminiFairnessConfigFromDb();
  return row.config;
}

export async function writeGeminiFairnessConfig(config, { updatedByUserId = null } = {}) {
  await ensureGeminiFairnessConfigStore();
  const source = resolveGeminiFairnessConfigSource();
  const sanitized = sanitizeConfigObject(config);
  if (source === 'env_only') {
    throw new Error('GEMINI_FAIRNESS_CONFIG_SOURCE=env_only 时不可写入持久化配置');
  }
  if (source === 'disk') {
    await writeGeminiFairnessConfigToDisk(sanitized);
    return { config: sanitized, meta: await getGeminiFairnessConfigMeta() };
  }
  const row = await writeGeminiFairnessConfigToDb(sanitized, { updatedByUserId });
  return {
    config: row.config,
    meta: {
      source: 'db',
      storage: 'postgres',
      updatedAt: row.updatedAt,
      updatedByUserId: row.updatedByUserId,
    },
  };
}

export async function clearGeminiFairnessConfig({ updatedByUserId = null } = {}) {
  return writeGeminiFairnessConfig({}, { updatedByUserId });
}

/** ai-worker-proxy: preload + background refresh for db source */
let proxyCache = {};
let proxyCacheAt = 0;
let proxyRefreshPromise = null;
const PROXY_REFRESH_MS = 3000;

export async function refreshGeminiFairnessConfigCache() {
  const source = resolveGeminiFairnessConfigSource();
  if (source === 'env_only') {
    proxyCache = {};
    proxyCacheAt = Date.now();
    return proxyCache;
  }
  if (source === 'disk') {
    try {
      const filePath = geminiFairnessDiskPath();
      if (!fs.existsSync(filePath)) {
        proxyCache = {};
      } else {
        const raw = fs.readFileSync(filePath, 'utf8');
        proxyCache = sanitizeConfigObject(JSON.parse(raw));
      }
    } catch {
      proxyCache = {};
    }
    proxyCacheAt = Date.now();
    return proxyCache;
  }
  try {
    await ensureGeminiFairnessConfigStore();
    const row = await readGeminiFairnessConfigFromDb();
    proxyCache = row.config;
  } catch (e) {
    console.warn('[gemini-fairness-config] db refresh failed:', e instanceof Error ? e.message : String(e));
  }
  proxyCacheAt = Date.now();
  return proxyCache;
}

export async function initGeminiFairnessConfigLoader() {
  await refreshGeminiFairnessConfigCache();
  setInterval(() => {
    void refreshGeminiFairnessConfigCache();
  }, PROXY_REFRESH_MS).unref?.();
}

export function getGeminiFairnessConfigCacheSnapshot() {
  return { ...proxyCache, _loadedAt: proxyCacheAt, _source: resolveGeminiFairnessConfigSource() };
}

export function touchGeminiFairnessConfigCacheIfStale() {
  const source = resolveGeminiFairnessConfigSource();
  if (source === 'env_only') return;
  const now = Date.now();
  if (now - proxyCacheAt < PROXY_REFRESH_MS) return;
  if (!proxyRefreshPromise) {
    proxyRefreshPromise = refreshGeminiFairnessConfigCache().finally(() => {
      proxyRefreshPromise = null;
    });
  }
}
