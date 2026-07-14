import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { USE_POSTGRES, ensurePostgres, getPool } from '../auth-store.js';
import { buildAiGatewayOpsSummary } from './observability.js';

const DEFAULT_CONFIG = Object.freeze({
  disabledProviders: [],
  disabledModels: [],
  disabledProviderRules: [],
  disabledModelRules: [],
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

function futureIso(value, now = new Date()) {
  const raw = nonEmptyString(value);
  if (!raw) return null;
  const time = Date.parse(raw);
  if (!Number.isFinite(time) || time <= now.getTime()) return null;
  return new Date(time).toISOString();
}

function normalizePauseRules(values, keyName, now = new Date()) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const row = value && typeof value === 'object' ? value : {};
    const key = nonEmptyString(row[keyName] || row.key || row.id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      [keyName]: key,
      reason: nonEmptyString(row.reason) || null,
      expiresAt: futureIso(row.expiresAt, now),
      createdAt: nonEmptyString(row.createdAt) || null,
      createdByUserId: nonEmptyString(row.createdByUserId) || null,
    });
  }
  return out;
}

function mergePauseRules(values, keyName) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const key = nonEmptyString(value?.[keyName]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function pruneExpiredAiGatewayOpsControlConfig(input, now = new Date()) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const nowMs = now.getTime();
  const expired = [];
  const keepRule = (kind) => (item) => {
    const expiresAt = nonEmptyString(item?.expiresAt);
    if (!expiresAt) return true;
    const time = Date.parse(expiresAt);
    if (!Number.isFinite(time) || time > nowMs) return true;
    expired.push({ kind, key: item.provider || item.model || item.from || item.key || '', expiresAt });
    return false;
  };
  return {
    config: {
      ...raw,
      disabledProviderRules: (Array.isArray(raw.disabledProviderRules) ? raw.disabledProviderRules : []).filter(
        keepRule('provider')
      ),
      disabledModelRules: (Array.isArray(raw.disabledModelRules) ? raw.disabledModelRules : []).filter(keepRule('model')),
      modelOverrides: (Array.isArray(raw.modelOverrides) ? raw.modelOverrides : []).filter(keepRule('modelOverride')),
    },
    expired: expired.filter((item) => nonEmptyString(item.key)),
  };
}

export function normalizeAiGatewayOpsControlConfig(input, options = {}) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const now = options.now instanceof Date ? options.now : new Date();
  const pruned = pruneExpiredAiGatewayOpsControlConfig(raw, now).config;
  const disabledProviderRules = mergePauseRules([
    ...normalizePauseRules(pruned.disabledProviderRules, 'provider', now),
    ...uniqueStrings(pruned.disabledProviders).map((provider) => ({ provider })),
  ], 'provider').slice(0, 50);
  const disabledModelRules = mergePauseRules([
    ...normalizePauseRules(pruned.disabledModelRules, 'model', now),
    ...uniqueStrings(pruned.disabledModels).map((model) => ({ model })),
  ], 'model').slice(0, 100);
  const modelOverrides = (Array.isArray(pruned.modelOverrides) ? pruned.modelOverrides : [])
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
        expiresAt: futureIso(row.expiresAt, now),
      };
    })
    .filter(Boolean)
    .slice(0, 50);
  return {
    disabledProviders: uniqueStrings(disabledProviderRules.map((item) => item.provider)).slice(0, 50),
    disabledModels: uniqueStrings(disabledModelRules.map((item) => item.model)).slice(0, 100),
    disabledProviderRules,
    disabledModelRules,
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
    const rawConfig = typeof row.config_json === 'object' ? row.config_json : JSON.parse(String(row.config_json || '{}'));
    const { config, expired } = pruneExpiredAiGatewayOpsControlConfig(rawConfig);
    if (expired.length) {
      return writeAiGatewayOpsControlConfig(config, { updatedByUserId: 'system:ops-control-expire' });
    }
    return withMeta(config, {
      source: 'db',
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      updatedByUserId: row.updated_by_user_id || null,
    });
  }
  const config = readAiGatewayOpsControlConfigSync();
  const { config: pruned, expired } = pruneExpiredAiGatewayOpsControlConfig(config);
  if (expired.length) return writeAiGatewayOpsControlConfig(pruned, { updatedByUserId: 'system:ops-control-expire' });
  return config;
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

export function mergeAiGatewayOpsControlAction(input, action, { now = new Date(), defaultTtlMinutes = 60, updatedByUserId = null } = {}) {
  const config = normalizeAiGatewayOpsControlConfig(input, { now });
  const kind = nonEmptyString(action?.kind);
  const key = nonEmptyString(action?.key);
  if (!key || !['provider', 'model'].includes(kind)) return config;
  const ttl = Math.min(24 * 60, Math.max(5, Math.floor(Number(action?.ttlMinutes) || defaultTtlMinutes)));
  const expiresAt = new Date(now.getTime() + ttl * 60_000).toISOString();
  const reason = nonEmptyString(action?.reason) || 'ops suggestion';
  const row = {
    [kind]: key,
    reason,
    expiresAt,
    createdAt: now.toISOString(),
    createdByUserId: nonEmptyString(updatedByUserId) || null,
  };
  if (kind === 'provider') {
    return normalizeAiGatewayOpsControlConfig({
      ...config,
      disabledProviderRules: [...(config.disabledProviderRules || []).filter((item) => item.provider !== key), row],
    }, { now });
  }
  return normalizeAiGatewayOpsControlConfig({
    ...config,
    disabledModelRules: [...(config.disabledModelRules || []).filter((item) => item.model !== key), row],
  }, { now });
}

export function isAiGatewayAutoCircuitEnabled() {
  const raw = String(process.env.AI_GATEWAY_AUTO_CIRCUIT_ENABLED || '').trim().toLowerCase();
  if (!raw && (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test')) return false;
  if (!raw) return true;
  return !['0', 'false', 'off', 'no'].includes(raw);
}

export function aiGatewayAutoCircuitConfig(options = {}) {
  const numberFrom = (key, fallback, min, max) => {
    const camel = key.toLowerCase().replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
    const value = options[key] ?? options[camel] ?? process.env[`AI_GATEWAY_AUTO_CIRCUIT_${key}`];
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };
  const ratioFrom = (key, fallback) => {
    const camel = key.toLowerCase().replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
    const value = options[key] ?? options[camel] ?? process.env[`AI_GATEWAY_AUTO_CIRCUIT_${key}`];
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
  };
  return {
    enabled: options.enabled == null ? isAiGatewayAutoCircuitEnabled() : options.enabled !== false,
    windowLimit: numberFrom('WINDOW_LIMIT', 20, 3, 100),
    minTerminal: numberFrom('MIN_TERMINAL', 3, 1, 100),
    minFailures: numberFrom('MIN_FAILURES', 2, 1, 100),
    failureRate: ratioFrom('FAILURE_RATE', 0.6),
    minRateLimited: numberFrom('MIN_RATE_LIMITED', 1, 1, 100),
    ttlMinutes: numberFrom('TTL_MINUTES', 10, 5, 120),
  };
}

function autoCircuitErrorReason(error) {
  const msg = error instanceof Error ? error.message : String(error || '');
  if (/429|too many requests|resource_exhausted|rate.?limit|quota|rpm/i.test(msg)) return 'auto circuit: rate limited';
  if (/HTTP 5\d\d|503|502|504|upstream|overload|unavailable|timeout/i.test(msg)) return 'auto circuit: upstream unstable';
  return '';
}

export function evaluateAiGatewayProviderAutoCircuit(plans, provider, options = {}) {
  const config = aiGatewayAutoCircuitConfig(options);
  if (!config.enabled) return null;
  const key = nonEmptyString(provider);
  if (!key) return null;
  const items = (Array.isArray(plans) ? plans : []).filter((plan) => {
    const routeProvider = nonEmptyString(plan?.route?.providerId);
    const jobProvider = nonEmptyString(plan?.job?.provider);
    return routeProvider === key || jobProvider === key;
  });
  const summary = buildAiGatewayOpsSummary(items.slice(0, config.windowLimit), { limit: config.windowLimit });
  const group = (summary.byProvider || []).find((item) => item.key === key);
  if (!group) return null;
  const terminal = group.succeeded + group.failed + group.cancelled;
  if (terminal < config.minTerminal || group.failed < config.minFailures) return null;
  const rateLimited = group.errorCounts.rate_limited || 0;
  const shouldPauseForRateLimit = rateLimited >= config.minRateLimited;
  const shouldPauseForFailureRate = group.failureRate >= config.failureRate;
  if (!shouldPauseForRateLimit && !shouldPauseForFailureRate) return null;
  const reason = shouldPauseForRateLimit
    ? `auto circuit: ${rateLimited}/${group.failed} recent failures were rate limited`
    : `auto circuit: recent failure rate ${Math.round(group.failureRate * 100)}%`;
  return {
    kind: 'provider',
    key,
    reason,
    ttlMinutes: config.ttlMinutes,
    stats: {
      sampleSize: summary.sampleSize,
      terminal,
      failed: group.failed,
      succeeded: group.succeeded,
      cancelled: group.cancelled,
      failureRate: group.failureRate,
      rateLimitRate: group.rateLimitRate,
      rateLimited,
      windowLimit: config.windowLimit,
    },
  };
}

export async function maybeAutoPauseAiGatewayProvider(plan, error, options = {}) {
  if (!isAiGatewayAutoCircuitEnabled()) return null;
  const provider = nonEmptyString(plan?.route?.providerId || plan?.job?.provider);
  if (!provider) return null;
  const errorReason = autoCircuitErrorReason(error);
  if (!errorReason) return null;
  const action = evaluateAiGatewayProviderAutoCircuit(
    [plan, ...(Array.isArray(options.recentPlans) ? options.recentPlans : [])],
    provider,
    options
  );
  if (!action) return null;
  const current = options.currentConfig || await readAiGatewayOpsControlConfig();
  const next = mergeAiGatewayOpsControlAction(
    current,
    action,
    { updatedByUserId: 'system:auto-circuit' }
  );
  const written = await writeAiGatewayOpsControlConfig(next, { updatedByUserId: 'system:auto-circuit' });
  return { ...written, autoCircuitAction: action };
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
