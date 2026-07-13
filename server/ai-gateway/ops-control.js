import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { USE_POSTGRES, ensurePostgres, getPool } from '../auth-store.js';

const DEFAULT_CONFIG = Object.freeze({
  disabledProviders: [],
  disabledModels: [],
  modelOverrides: [],
});
const CONFIG_ROW_ID = 'default';

function opsControlDiskPath() {
  const custom = String(process.env.AI_GATEWAY_OPS_CONTROL_PATH || '').trim();
  return custom ? path.resolve(custom) : path.resolve(process.cwd(), 'server/data/ai-gateway-ops-control.json');
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
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

export function normalizeAiGatewayOpsControlConfig(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const modelOverrides = (Array.isArray(raw.modelOverrides) ? raw.modelOverrides : [])
    .map((item) => {
      const row = item && typeof item === 'object' ? item : {};
      const from = nonEmptyString(row.from);
      const to = nonEmptyString(row.to);
      if (!from || !to) return null;
      return {
        from,
        to,
        enabled: row.enabled !== false,
        reason: nonEmptyString(row.reason) || null,
      };
    })
    .filter(Boolean)
    .slice(0, 50);
  return {
    disabledProviders: uniqueStrings(raw.disabledProviders).slice(0, 50),
    disabledModels: uniqueStrings(raw.disabledModels).slice(0, 100),
    modelOverrides,
  };
}

export function resolveAiGatewayOpsControlSource() {
  const explicit = String(process.env.AI_GATEWAY_OPS_CONTROL_SOURCE || '').trim().toLowerCase();
  if (explicit === 'disk') return 'disk';
  if (explicit === 'db') return USE_POSTGRES ? 'db' : 'disk';
  return USE_POSTGRES ? 'db' : 'disk';
}

function withMeta(config, meta = {}) {
  const source = meta.source || resolveAiGatewayOpsControlSource();
  return {
    ...normalizeAiGatewayOpsControlConfig(config),
    updatedAt: meta.updatedAt || null,
    updatedByUserId: meta.updatedByUserId || null,
    source,
    path: source === 'disk' ? opsControlDiskPath() : null,
    storage: source === 'db' ? 'postgres' : 'disk',
  };
}

export function readAiGatewayOpsControlConfigSync() {
  try {
    const raw = fs.readFileSync(opsControlDiskPath(), 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return withMeta(parsed, {
      updatedAt: parsed.updatedAt || null,
      updatedByUserId: parsed.updatedByUserId || null,
    });
  } catch {
    return withMeta(DEFAULT_CONFIG);
  }
}

export async function readAiGatewayOpsControlConfig() {
  if (resolveAiGatewayOpsControlSource() === 'db') {
    await ensureAiGatewayOpsControlStore();
    const res = await getPool().query(
      'SELECT config_json, updated_at, updated_by_user_id FROM ai_gateway_ops_control WHERE id = $1 LIMIT 1',
      [CONFIG_ROW_ID]
    );
    if (!res.rows[0]) return withMeta(DEFAULT_CONFIG, { source: 'db' });
    const row = res.rows[0];
    const config = typeof row.config_json === 'object' ? row.config_json : JSON.parse(String(row.config_json || '{}'));
    return withMeta(config, {
      source: 'db',
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      updatedByUserId: row.updated_by_user_id || null,
    });
  }
  return readAiGatewayOpsControlConfigSync();
}

export async function writeAiGatewayOpsControlConfig(input, { updatedByUserId = null } = {}) {
  const config = normalizeAiGatewayOpsControlConfig(input);
  const payload = {
    ...config,
    updatedAt: new Date().toISOString(),
    updatedByUserId: nonEmptyString(updatedByUserId) || null,
  };
  if (resolveAiGatewayOpsControlSource() === 'db') {
    await ensureAiGatewayOpsControlStore();
    await getPool().query(
      `INSERT INTO ai_gateway_ops_control (id, config_json, updated_at, updated_by_user_id)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         config_json = EXCLUDED.config_json,
         updated_at = EXCLUDED.updated_at,
         updated_by_user_id = EXCLUDED.updated_by_user_id`,
      [CONFIG_ROW_ID, JSON.stringify(config), payload.updatedAt, payload.updatedByUserId]
    );
    return withMeta(config, { ...payload, source: 'db' });
  }
  const filePath = opsControlDiskPath();
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return withMeta(payload, payload);
}

export async function clearAiGatewayOpsControlConfig({ updatedByUserId = null } = {}) {
  return writeAiGatewayOpsControlConfig(DEFAULT_CONFIG, { updatedByUserId });
}

export function applyAiGatewayModelOverride(job, config = readAiGatewayOpsControlConfigSync()) {
  const model = nonEmptyString(job?.model);
  if (!model) return { job, applied: null };
  const override = (Array.isArray(config.modelOverrides) ? config.modelOverrides : []).find(
    (item) => item?.enabled !== false && nonEmptyString(item.from) === model && nonEmptyString(item.to)
  );
  if (!override) return { job, applied: null };
  return {
    job: {
      ...job,
      model: override.to,
      metadata: {
        ...(job.metadata && typeof job.metadata === 'object' ? job.metadata : {}),
        opsControl: {
          modelOverride: {
            from: model,
            to: override.to,
            reason: override.reason || null,
          },
        },
      },
    },
    applied: override,
  };
}

export function isProviderDisabled(providerId, config = readAiGatewayOpsControlConfigSync()) {
  const provider = nonEmptyString(providerId);
  return Boolean(provider && (config.disabledProviders || []).includes(provider));
}

export function isModelDisabled(model, config = readAiGatewayOpsControlConfigSync()) {
  const key = nonEmptyString(model);
  return Boolean(key && (config.disabledModels || []).includes(key));
}

let storeReady = false;

export async function ensureAiGatewayOpsControlStore() {
  if (storeReady) return;
  if (resolveAiGatewayOpsControlSource() !== 'db') {
    storeReady = true;
    return;
  }
  await ensurePostgres();
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ai_gateway_ops_control (
      id TEXT PRIMARY KEY DEFAULT 'default',
      config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL,
      updated_by_user_id TEXT NULL
    );
  `);
  storeReady = true;
}
