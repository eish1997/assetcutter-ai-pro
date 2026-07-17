import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { USE_POSTGRES, ensurePostgres, getPool } from '../auth-store.js';
import { withAiGatewayPostgresRetry } from './postgres-transient-retry.js';

const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  imageRegistryAllowlist: null,
  publishedCanonicalModelAllowlist: null,
  imageModelPreference: null,
  bindingOverrides: null,
  wiringEdges: null,
});
const CONFIG_ROW_ID = 'default';

function modelOpsConfigDiskPath() {
  const custom = String(process.env.MODEL_OPS_CONFIG_PATH || '').trim();
  return custom ? path.resolve(custom) : path.resolve(process.cwd(), 'server/data/model-ops-config.json');
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function resolveModelOpsConfigSource() {
  const explicit = String(process.env.MODEL_OPS_CONFIG_SOURCE || '').trim().toLowerCase();
  if (explicit === 'disk') return 'disk';
  if (explicit === 'db') return USE_POSTGRES ? 'db' : 'disk';
  return USE_POSTGRES ? 'db' : 'disk';
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const s = nonEmptyString(value);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function nullableStringList(value) {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const ids = uniqueStrings(value);
  return ids.length ? ids : null;
}

function normalizeBindingOverrides(value) {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .map((item) => {
      const row = item && typeof item === 'object' ? item : {};
      const bindingId = nonEmptyString(row.bindingId);
      if (!bindingId) return null;
      const priority = Number(row.priority);
      return {
        bindingId,
        enabled: row.enabled === undefined ? undefined : row.enabled === true,
        priority: Number.isFinite(priority) ? Math.floor(priority) : undefined,
        upstreamOverride: nonEmptyString(row.upstreamOverride) || undefined,
      };
    })
    .filter(Boolean);
  return rows.length ? rows : null;
}

function normalizeWiringEdges(value) {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .map((item) => {
      const row = item && typeof item === 'object' ? item : {};
      const edgeId = nonEmptyString(row.edgeId);
      const from = row.from && typeof row.from === 'object' ? row.from : {};
      const to = row.to && typeof row.to === 'object' ? row.to : {};
      const supplierId = nonEmptyString(from.supplierId);
      const outletId = nonEmptyString(from.outletId);
      const hubInId = nonEmptyString(to.hubInId);
      if (!edgeId || !supplierId || !outletId || !hubInId) return null;
      const priority = Number(row.priority);
      return {
        edgeId,
        from: { supplierId, outletId },
        to: { hubInId },
        priority: Number.isFinite(priority) ? Math.floor(priority) : 10,
        enabled: row.enabled === undefined ? undefined : row.enabled === true,
        upstreamOverride: nonEmptyString(row.upstreamOverride) || undefined,
      };
    })
    .filter(Boolean);
  return rows.length ? rows : null;
}

export function normalizeModelOpsConfig(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const version = Number(raw.version);
  const imageRegistryAllowlist = nullableStringList(raw.imageRegistryAllowlist);
  const publishedCanonicalModelAllowlist = nullableStringList(raw.publishedCanonicalModelAllowlist);
  const imageModelPreference = nullableStringList(raw.imageModelPreference ?? raw.gearPreference);
  const bindingOverrides = normalizeBindingOverrides(raw.bindingOverrides);
  const wiringEdges = normalizeWiringEdges(raw.wiringEdges);
  return {
    version: Number.isFinite(version) ? Math.max(1, Math.floor(version)) : DEFAULT_CONFIG.version,
    imageRegistryAllowlist:
      imageRegistryAllowlist === undefined ? DEFAULT_CONFIG.imageRegistryAllowlist : imageRegistryAllowlist,
    publishedCanonicalModelAllowlist:
      publishedCanonicalModelAllowlist === undefined
        ? DEFAULT_CONFIG.publishedCanonicalModelAllowlist
        : publishedCanonicalModelAllowlist,
    imageModelPreference: imageModelPreference === undefined ? DEFAULT_CONFIG.imageModelPreference : imageModelPreference,
    bindingOverrides: bindingOverrides === undefined ? DEFAULT_CONFIG.bindingOverrides : bindingOverrides,
    wiringEdges: wiringEdges === undefined ? DEFAULT_CONFIG.wiringEdges : wiringEdges,
  };
}

function withMeta(config, meta = {}) {
  const source = meta.source || resolveModelOpsConfigSource();
  return {
    ...normalizeModelOpsConfig(config),
    updatedAt: meta.updatedAt || null,
    updatedByUserId: meta.updatedByUserId || null,
    source,
    storage: source === 'db' ? 'postgres' : 'disk',
    path: source === 'disk' ? modelOpsConfigDiskPath() : null,
  };
}

export function readModelOpsConfigSync() {
  try {
    const raw = fs.readFileSync(modelOpsConfigDiskPath(), 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return withMeta(parsed, {
      updatedAt: parsed.updatedAt || null,
      updatedByUserId: parsed.updatedByUserId || null,
    });
  } catch {
    return withMeta(DEFAULT_CONFIG);
  }
}

export async function readModelOpsConfig() {
  if (resolveModelOpsConfigSource() === 'db') {
    const res = await withAiGatewayPostgresRetry('modelOpsConfig.read', async () => {
      await ensureModelOpsConfigStore();
      return getPool().query(
        'SELECT config_json, updated_at, updated_by_user_id FROM model_ops_config WHERE id = $1 LIMIT 1',
        [CONFIG_ROW_ID]
      );
    });
    if (!res.rows[0]) return withMeta(DEFAULT_CONFIG, { source: 'db' });
    const row = res.rows[0];
    const rawConfig = typeof row.config_json === 'object' ? row.config_json : JSON.parse(String(row.config_json || '{}'));
    return withMeta(rawConfig, {
      source: 'db',
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      updatedByUserId: row.updated_by_user_id || null,
    });
  }
  return readModelOpsConfigSync();
}

export async function writeModelOpsConfig(input, { updatedByUserId = null } = {}) {
  const config = normalizeModelOpsConfig(input);
  const payload = {
    ...config,
    updatedAt: new Date().toISOString(),
    updatedByUserId: nonEmptyString(updatedByUserId) || null,
  };
  if (resolveModelOpsConfigSource() === 'db') {
    await withAiGatewayPostgresRetry('modelOpsConfig.write', async () => {
      await ensureModelOpsConfigStore();
      await getPool().query(
        `INSERT INTO model_ops_config (id, config_json, updated_at, updated_by_user_id)
         VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (id) DO UPDATE SET
           config_json = EXCLUDED.config_json,
           updated_at = EXCLUDED.updated_at,
           updated_by_user_id = EXCLUDED.updated_by_user_id`,
        [CONFIG_ROW_ID, JSON.stringify(config), payload.updatedAt, payload.updatedByUserId]
      );
    });
    return withMeta(config, { ...payload, source: 'db' });
  }
  const filePath = modelOpsConfigDiskPath();
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return withMeta(payload, payload);
}

let storeReadySource = '';

export async function ensureModelOpsConfigStore() {
  const source = resolveModelOpsConfigSource();
  if (storeReadySource === source) return;
  if (source !== 'db') {
    storeReadySource = source;
    return;
  }
  await withAiGatewayPostgresRetry('modelOpsConfig.ensure', async () => {
    await ensurePostgres();
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS model_ops_config (
        id TEXT PRIMARY KEY DEFAULT 'default',
        config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL,
        updated_by_user_id TEXT NULL
      );
    `);
  });
  storeReadySource = source;
}
