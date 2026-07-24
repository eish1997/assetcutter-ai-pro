import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fetch as undiciFetch } from 'undici';
import { USE_POSTGRES, ensurePostgres, getPool } from '../auth-store.js';
import { withAiGatewayPostgresRetry } from './postgres-transient-retry.js';
import { signVolcengineRequest } from '../jimeng-sign.js';
import { openAiCompatibleConfigForProvider } from './openai-compatible-config.js';
import { readModelOpsConfig } from './model-ops-config-store.js';

const DEFAULT_PROVIDER = 'tripo';
const RETRYABLE_STATUS_RE = /\b(429|500|502|503|504|529)\b|too many requests|rate limit|timeout|econnreset|econnrefused|fetch failed|temporarily unavailable/i;

function diskPath() {
  const custom = String(process.env.AI_GATEWAY_PROVIDER_KEYS_PATH || '').trim();
  return custom ? path.resolve(custom) : path.resolve(process.cwd(), 'server/data/ai-gateway-provider-keys.json');
}

function eventsDiskPath() {
  const custom = String(process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_PATH || '').trim();
  if (custom) return path.resolve(custom);
  const parsed = path.parse(diskPath());
  return path.join(parsed.dir, `${parsed.name}-events${parsed.ext || '.json'}`);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function providerBaseUrlOverride(modelOpsConfig, providerId) {
  const rows = Array.isArray(modelOpsConfig?.providerOverrides) ? modelOpsConfig.providerOverrides : [];
  const row = rows.find((item) => nonEmptyString(item?.providerId) === providerId);
  return nonEmptyString(row?.baseUrl);
}

function providerRequestTimeoutMsOverride(modelOpsConfig, providerId) {
  const rows = Array.isArray(modelOpsConfig?.providerOverrides) ? modelOpsConfig.providerOverrides : [];
  const row = rows.find((item) => nonEmptyString(item?.providerId) === providerId);
  const n = Number(row?.requestTimeoutMs);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function credentialsWithProviderOverrides(credentials, providerId, modelOpsConfig) {
  const base = credentials && typeof credentials === 'object' ? { ...credentials } : {};
  const baseUrl = providerBaseUrlOverride(modelOpsConfig, providerId);
  const requestTimeoutMs = providerRequestTimeoutMsOverride(modelOpsConfig, providerId);
  return {
    ...base,
    ...(baseUrl ? { baseUrl } : {}),
    ...(requestTimeoutMs ? { requestTimeoutMs } : {}),
  };
}

function createKeyId(provider = DEFAULT_PROVIDER) {
  return `aigkey_${provider}_${crypto.randomUUID()}`;
}

function createEventId() {
  return `aigkeyevt_${Date.now()}_${crypto.randomUUID()}`;
}

function clampEventsLimit(limit = 100) {
  const n = Math.floor(Number(limit) || 100);
  return Math.max(1, Math.min(500, n));
}

function clampSummaryWindowHours(hours = 24) {
  const n = Math.floor(Number(hours) || 24);
  return Math.max(1, Math.min(24 * 30, n));
}

function maxStoredEvents() {
  const n = Math.floor(Number(process.env.AI_GATEWAY_PROVIDER_KEY_EVENTS_MAX || 5000));
  return Math.max(100, Math.min(100000, Number.isFinite(n) ? n : 5000));
}

export function maskProviderSecret(secret) {
  const s = nonEmptyString(secret);
  if (!s) return '';
  if (s.length <= 10) return `${s.slice(0, 2)}****${s.slice(-2)}`;
  return `${s.slice(0, 6)}****${s.slice(-4)}`;
}

function normalizeCredentials(value, existing = null) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const prev = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const out = {};
  for (const key of ['accessKeyId', 'secretAccessKey', 'apiKey', 'baseUrl', 'region', 'secretId', 'secretKey', 'endpointId']) {
    const next = nonEmptyString(raw[key]) || nonEmptyString(prev[key]);
    if (next) out[key] = next;
  }
  return out;
}

export function normalizeProviderKeyRow(input, existing = null) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const provider = nonEmptyString(raw.provider) || nonEmptyString(existing?.provider) || DEFAULT_PROVIDER;
  const secret = nonEmptyString(raw.secret) || nonEmptyString(raw.apiKey) || nonEmptyString(existing?.secret);
  const credentials = normalizeCredentials(raw.credentials, existing?.credentials);
  const rawId = nonEmptyString(raw.id);
  const id = rawId.startsWith('draft_') ? '' : rawId;
  return {
    id: id || nonEmptyString(existing?.id) || createKeyId(provider),
    provider,
    label: nonEmptyString(raw.label) || nonEmptyString(existing?.label) || provider,
    secret,
    credentials,
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
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      errorCount: 0,
      consecutiveErrorCount: 0,
      autoCooldownCount: 0,
      lastCooldownReason: null,
    });
  }
  return keyRuntimeState.get(key);
}

function retryableProviderKeyError(message, options = {}) {
  if (options.retryable === true) return true;
  const status = Math.floor(Number(options.status || 0));
  if (status === 429 || status >= 500) return true;
  return RETRYABLE_STATUS_RE.test(String(message || ''));
}

function autoCooldownConfig() {
  const enabledRaw = String(process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN || '').trim().toLowerCase();
  const enabled = !['0', 'false', 'off', 'no'].includes(enabledRaw);
  const threshold = Math.max(2, Math.min(20, Math.floor(Number(process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN_ERRORS || 3)) || 3));
  const cooldownMs = Math.max(30_000, Math.min(86_400_000, Math.floor(Number(process.env.AI_GATEWAY_PROVIDER_KEY_AUTO_COOLDOWN_MS || 300_000)) || 300_000));
  return { enabled, threshold, cooldownMs };
}

function providerKeyHealth(runtime, now = Date.now()) {
  const coolingDown = Boolean(runtime.cooldownUntil && runtime.cooldownUntil > now);
  const consecutive = Math.max(0, Math.floor(Number(runtime.consecutiveErrorCount || 0)));
  if (coolingDown) return { status: 'cooling_down', suggestedAction: 'wait_or_restore' };
  if (consecutive >= 3) return { status: 'degraded', suggestedAction: 'cooldown_or_check_key' };
  if (consecutive > 0) return { status: 'warning', suggestedAction: 'watch' };
  return { status: 'healthy', suggestedAction: null };
}

function redactKey(row) {
  const runtime = runtimeForKey(row.id);
  const now = Date.now();
  const health = providerKeyHealth(runtime, now);
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    enabled: row.enabled !== false,
    priority: row.priority,
    rpm: row.rpm || 0,
    secretPreview: maskProviderSecret(row.secret),
    hasSecret: Boolean(nonEmptyString(row.secret)),
    credentialsPreview: Object.fromEntries(
      Object.entries(row.credentials || {}).map(([key, value]) => [key, maskProviderSecret(value)])
    ),
    hasCredentials: Object.keys(row.credentials || {}).length > 0,
    updatedAt: row.updatedAt || null,
    updatedByUserId: row.updatedByUserId || null,
    runtime: {
      lastUsedAt: runtime.lastUsedAt || null,
      lastSuccessAt: runtime.lastSuccessAt || null,
      lastErrorAt: runtime.lastErrorAt || null,
      lastError: runtime.lastError || null,
      errorCount: runtime.errorCount || 0,
      consecutiveErrorCount: runtime.consecutiveErrorCount || 0,
      autoCooldownCount: runtime.autoCooldownCount || 0,
      lastCooldownReason: runtime.lastCooldownReason || null,
      cooldownUntil: runtime.cooldownUntil ? new Date(runtime.cooldownUntil).toISOString() : null,
      coolingDown: Boolean(runtime.cooldownUntil && runtime.cooldownUntil > now),
      currentMinuteCount: runtime.minuteCount || 0,
      healthStatus: health.status,
      suggestedAction: health.suggestedAction,
    },
  };
}

function providerKeySmokeRequirements(provider) {
  if (provider === 'vertex-site') {
    return {
      fields: ['secret'],
      label: 'Agent Platform API Key',
    };
  }
  if (provider === 'volcengine-jimeng') {
    return {
      fields: ['credentials.accessKeyId', 'credentials.secretAccessKey'],
      label: 'VOLCENGINE_ACCESS_KEY / VOLCENGINE_SECRET_KEY',
    };
  }
  if (provider === 'tencent-hunyuan') {
    return {
      fields: ['credentials.secretId', 'credentials.secretKey'],
      label: 'TENCENT_SECRET_ID / TENCENT_SECRET_KEY',
    };
  }
  if (provider === 'volcengine-ark') {
    return {
      fields: ['secret'],
      label: 'API Key',
    };
  }
  if (provider === 'openai-official') {
    return {
      fields: ['secret'],
      label: 'API Key',
    };
  }
  if (openAiCompatibleConfigForProvider(provider)) {
    return {
      fields: ['secret'],
      label: 'API Key',
    };
  }
  if (provider === 'vectorengine') {
    return {
      fields: ['secret', 'credentials.baseUrl'],
      label: 'API Key / Base URL',
    };
  }
  return {
    fields: ['secret'],
    label: 'API Key',
  };
}

function valueForSmokeField(row, field) {
  if (field === 'secret') return nonEmptyString(row.secret);
  const match = field.match(/^credentials\.(.+)$/);
  if (match) return nonEmptyString(row.credentials?.[match[1]]);
  return '';
}

function missingSmokeFields(row) {
  const requirements = providerKeySmokeRequirements(row.provider);
  return requirements.fields.filter((field) => !valueForSmokeField(row, field));
}

function providerKeySmokeMode(options = {}) {
  const raw = nonEmptyString(options.mode || process.env.AI_GATEWAY_PROVIDER_KEY_SMOKE_MODE).toLowerCase();
  if (['shape', 'credentials', 'credentials_only', 'credentialsonly'].includes(raw)) return 'credentials_only';
  if (['off', 'disabled', 'none'].includes(raw)) return 'disabled';
  return 'real';
}

function openAiCompatibleSmokeConfig(row, options = {}) {
  const provider = row.provider;
  const openAiConfig = openAiCompatibleConfigForProvider(provider);
  if (openAiConfig) {
    const optionBaseUrls = {
      'openai-official': options.openAiBaseUrl || process.env.AI_GATEWAY_OPENAI_BASE_URL,
      toapis: options.toapisBaseUrl,
      '302ai': options.aihub302BaseUrl,
      aihubmix: options.aihubmixBaseUrl,
      tinysnow: options.tinysnowBaseUrl,
      'volcengine-ark': options.arkBaseUrl,
    };
    return {
      baseUrl:
        nonEmptyString(optionBaseUrls[provider]) ||
        providerBaseUrlOverride(options.modelOpsConfig, provider) ||
        nonEmptyString(row.credentials?.baseUrl) ||
        openAiConfig.defaultBaseUrl,
      requestTimeoutMs: providerRequestTimeoutMsOverride(options.modelOpsConfig, provider),
      route: 'GET /models',
    };
  }
  if (provider === 'vectorengine') {
    return {
      baseUrl: nonEmptyString(options.vectorEngineBaseUrl || row.credentials?.baseUrl),
      route: 'GET /models',
    };
  }
  return null;
}

async function readSmokeJsonSafe(response) {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function smokeErrorMessage(data, fallback) {
  if (!data || typeof data !== 'object') return fallback;
  return (
    nonEmptyString(data.ResponseMetadata?.Error?.Message) ||
    nonEmptyString(data.ResponseMetadata?.Error?.Code) ||
    nonEmptyString(data.message) ||
    nonEmptyString(data.msg) ||
    nonEmptyString(data.error?.message) ||
    nonEmptyString(data.error) ||
    nonEmptyString(data.raw) ||
    fallback
  );
}

function volcengineVisualSmokeError(data, fallback) {
  const meta = data?.ResponseMetadata && typeof data.ResponseMetadata === 'object' ? data.ResponseMetadata : {};
  const err = meta.Error && typeof meta.Error === 'object' ? meta.Error : {};
  const code = nonEmptyString(err.Code) || nonEmptyString(data?.code);
  const message = nonEmptyString(err.Message) || nonEmptyString(data?.message);
  if (code && message) return `${code}: ${message}`;
  return message || code || smokeErrorMessage(data, fallback);
}

async function runVolcengineJimengSmoke(row, options = {}) {
  const fetchImpl = options.fetchImpl || undiciFetch;
  const credentials = row.credentials && typeof row.credentials === 'object' ? row.credentials : {};
  const host = nonEmptyString(options.jimengVisualHost || process.env.JIMENG_VISUAL_HOST) || 'visual.volcengineapi.com';
  const region = nonEmptyString(credentials.region || options.jimengVisualRegion || process.env.JIMENG_VISUAL_REGION) || 'cn-north-1';
  const version = nonEmptyString(options.jimengVisualVersion || process.env.JIMENG_VISUAL_VERSION) || '2022-08-31';
  const service = nonEmptyString(options.jimengVisualService || process.env.JIMENG_VISUAL_SERVICE) || 'cv';
  const query = { Action: 'CVSync2AsyncGetResult', Version: version };
  const body = JSON.stringify({
    req_key: nonEmptyString(options.jimengSmokeReqKey) || 'jimeng_t2i_v40',
    task_id: nonEmptyString(options.jimengSmokeTaskId) || 'assetcutter_provider_key_smoke',
  });
  const signed = signVolcengineRequest({
    method: 'POST',
    host,
    path: '/',
    query,
    body,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    region,
    service,
  });
  const started = Date.now();
  const response = await fetchImpl(`https://${host}/?Action=${encodeURIComponent(query.Action)}&Version=${encodeURIComponent(version)}`, {
    method: 'POST',
    headers: {
      Host: signed.host,
      'Content-Type': signed.contentType,
      'X-Date': signed.xDate,
      'X-Content-Sha256': signed.xContentSha256,
      Authorization: signed.authorization,
    },
    body,
    signal: AbortSignal.timeout(Number(options.timeoutMs || process.env.AI_GATEWAY_PROVIDER_KEY_SMOKE_TIMEOUT_MS || 15_000)),
  });
  const data = await readSmokeJsonSafe(response);
  const latencyMs = Date.now() - started;
  const upstreamError = data?.ResponseMetadata?.Error;
  const upstreamErrorCode = nonEmptyString(upstreamError?.Code);
  const isAuthFailure =
    response.status === 401 ||
    response.status === 403 ||
    /invalidaccesskey|signature|auth|permission|accessdenied/i.test(upstreamErrorCode);
  if (isAuthFailure) {
    const message = `Smoke test failed: upstream HTTP ${response.status} ${volcengineVisualSmokeError(data, 'Volcengine Visual probe rejected')}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return {
    supported: true,
    mode: 'real_upstream',
    route: 'POST CVSync2AsyncGetResult',
    upstreamStatus: response.status,
    latencyMs,
    message: response.ok
      ? 'Smoke test passed: Volcengine Visual credentials were accepted'
      : `Smoke test passed: Volcengine Visual credentials were accepted; upstream returned non-auth HTTP ${response.status}`,
  };
}

async function runRealProviderKeySmoke(row, options = {}) {
  const fetchImpl = options.fetchImpl || undiciFetch;
  if (row.provider === 'volcengine-jimeng') {
    return runVolcengineJimengSmoke(row, options);
  }
  const compatibleConfig = openAiCompatibleSmokeConfig(row, options);
  if (compatibleConfig?.baseUrl) {
    const baseUrl = compatibleConfig.baseUrl.replace(/\/+$/, '');
    const started = Date.now();
    const response = await fetchImpl(`${baseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${row.secret}` },
      signal: AbortSignal.timeout(Number(options.timeoutMs || compatibleConfig.requestTimeoutMs || process.env.AI_GATEWAY_PROVIDER_KEY_SMOKE_TIMEOUT_MS || 15_000)),
    });
    const data = await readSmokeJsonSafe(response);
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      const message = `Smoke test failed: upstream HTTP ${response.status} ${smokeErrorMessage(data, 'OpenAI-compatible probe rejected')}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return {
      supported: true,
      mode: 'real_upstream',
      route: compatibleConfig.route,
      upstreamStatus: response.status,
      latencyMs,
      message: 'Smoke test passed: upstream credentials accepted',
    };
  }
  if (row.provider !== 'tripo') {
    return {
      supported: false,
      mode: 'credentials_only',
      route: null,
      upstreamStatus: null,
      latencyMs: null,
      message: 'Smoke test passed: credentials shape is complete; real upstream probe is not configured for this provider yet',
    };
  }
  const baseUrl = nonEmptyString(options.tripoBaseUrl || process.env.AI_GATEWAY_TRIPO_OPENAPI_BASE_URL) || 'https://api.tripo3d.ai/v2/openapi';
  const pathName = nonEmptyString(options.tripoSmokePath || process.env.AI_GATEWAY_TRIPO_SMOKE_PATH) || '/user/balance';
  const url = `${baseUrl.replace(/\/+$/, '')}/${pathName.replace(/^\/+/, '')}`;
  const started = Date.now();
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${row.secret}` },
    signal: AbortSignal.timeout(Number(options.timeoutMs || process.env.AI_GATEWAY_PROVIDER_KEY_SMOKE_TIMEOUT_MS || 15_000)),
  });
  const data = await readSmokeJsonSafe(response);
  const latencyMs = Date.now() - started;
  if (!response.ok) {
    const message = `Smoke test failed: upstream HTTP ${response.status} ${smokeErrorMessage(data, 'Tripo probe rejected')}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return {
    supported: true,
    mode: 'real_upstream',
    route: 'GET /user/balance',
    upstreamStatus: response.status,
    latencyMs,
    message: 'Smoke test passed: upstream credentials accepted',
  };
}

function envKeysForProvider(provider) {
  if (provider === 'vertex-site') {
    const apiKey = nonEmptyString(
      process.env.GOOGLE_AGENT_PLATFORM_API_KEY ||
        process.env.AGENT_PLATFORM_API_KEY ||
        process.env.VERTEX_API_KEY
    );
    if (!apiKey) return [];
    return [
      normalizeProviderKeyRow({
        id: 'env_vertex_site_1',
        provider,
        label: 'GOOGLE_AGENT_PLATFORM_API_KEY',
        enabled: true,
        priority: 9000,
        secret: apiKey,
      }),
    ];
  }
  if (provider === 'volcengine-jimeng') {
    const accessKeyId = nonEmptyString(process.env.VOLCENGINE_ACCESS_KEY);
    const secretAccessKey = nonEmptyString(process.env.VOLCENGINE_SECRET_KEY);
    if (!accessKeyId || !secretAccessKey) return [];
    return [
      normalizeProviderKeyRow({
        id: 'env_volcengine_jimeng_1',
        provider,
        label: 'VOLCENGINE_ACCESS_KEY',
        enabled: true,
        priority: 9000,
        credentials: {
          accessKeyId,
          secretAccessKey,
          region: nonEmptyString(process.env.JIMENG_VISUAL_REGION),
        },
      }),
    ];
  }
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
    if ((!normalized.secret && !Object.keys(normalized.credentials || {}).length) || seen.has(normalized.id)) continue;
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
      credentials: row.credentials || {},
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
  await withAiGatewayPostgresRetry('providerKeyStore.ensure', async () => {
    await ensurePostgres();
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS ai_gateway_provider_keys (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        secret TEXT NOT NULL,
        credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        priority INTEGER NOT NULL DEFAULT 100,
        rpm INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL,
        updated_by_user_id TEXT NULL
      );
    `);
    await getPool().query(`CREATE INDEX IF NOT EXISTS idx_ai_gateway_provider_keys_provider ON ai_gateway_provider_keys(provider, enabled, priority);`);
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS ai_gateway_provider_key_events (
        id TEXT PRIMARY KEY,
        provider_key_id TEXT NOT NULL,
        provider TEXT NULL,
        label TEXT NULL,
        type TEXT NOT NULL,
        status INTEGER NULL,
        message TEXT NULL,
        reason TEXT NULL,
        retryable BOOLEAN NOT NULL DEFAULT FALSE,
        cooldown_until TIMESTAMPTZ NULL,
        consecutive_error_count INTEGER NULL,
        auto_cooldown_count INTEGER NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
    `);
    await getPool().query(`CREATE INDEX IF NOT EXISTS idx_ai_gateway_provider_key_events_key_created ON ai_gateway_provider_key_events(provider_key_id, created_at DESC);`);
    await getPool().query(`CREATE INDEX IF NOT EXISTS idx_ai_gateway_provider_key_events_provider_created ON ai_gateway_provider_key_events(provider, created_at DESC);`);
  });
  storeReady = true;
}

async function readDbRows() {
  await ensureProviderKeyStore();
  const res = await withAiGatewayPostgresRetry('providerKeyStore.readRows', async () => {
    await getPool().query(`ALTER TABLE ai_gateway_provider_keys ADD COLUMN IF NOT EXISTS credentials JSONB NOT NULL DEFAULT '{}'::jsonb;`);
    return getPool().query(
      `SELECT id, provider, label, secret, credentials, enabled, priority, rpm, updated_at, updated_by_user_id
       FROM ai_gateway_provider_keys
       ORDER BY priority ASC, label ASC`
    );
  });
  return res.rows.map((row) => normalizeProviderKeyRow({
    id: row.id,
    provider: row.provider,
    label: row.label,
    secret: row.secret,
    credentials: row.credentials || {},
    enabled: row.enabled,
    priority: row.priority,
    rpm: row.rpm,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedByUserId: row.updated_by_user_id || null,
  }));
}

async function writeDbRows(rows, updatedByUserId = null) {
  await ensureProviderKeyStore();
  const now = new Date().toISOString();
  const next = normalizeKeyList(rows).map((row) => ({
    ...row,
    updatedAt: now,
    updatedByUserId: nonEmptyString(updatedByUserId) || row.updatedByUserId || null,
  }));
  await withAiGatewayPostgresRetry('providerKeyStore.writeRows', async () => {
    const p = getPool();
    await p.query('BEGIN');
    try {
      await p.query('DELETE FROM ai_gateway_provider_keys');
      for (const row of next) {
        await p.query(
          `INSERT INTO ai_gateway_provider_keys
           (id, provider, label, secret, credentials, enabled, priority, rpm, updated_at, updated_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            row.id,
            row.provider,
            row.label,
            row.secret,
            JSON.stringify(row.credentials || {}),
            row.enabled !== false,
            row.priority,
            row.rpm || 0,
            row.updatedAt,
            row.updatedByUserId,
          ]
        );
      }
      await p.query('COMMIT');
    } catch (err) {
      await p.query('ROLLBACK').catch(() => {});
      throw err;
    }
  });
  return next;
}

export async function listProviderKeys({ includeSecrets = false } = {}) {
  const rows = USE_POSTGRES ? await readDbRows() : readDiskRows();
  const providers = new Set([DEFAULT_PROVIDER, ...rows.map((row) => row.provider), 'volcengine-jimeng', 'vertex-site']);
  const withEnv = [
    ...rows,
    ...Array.from(providers).flatMap((provider) => envKeysForProvider(provider)),
  ];
  return includeSecrets ? withEnv : withEnv.map(redactKey);
}

export async function saveProviderKeys(rows, { updatedByUserId = null } = {}) {
  const existingRows = await listProviderKeys({ includeSecrets: true });
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const mergedRows = (Array.isArray(rows) ? rows : []).map((row) => {
    const id = nonEmptyString(row?.id);
    return normalizeProviderKeyRow(row, id ? existingById.get(id) : null);
  });
  const saved = USE_POSTGRES ? await writeDbRows(mergedRows, updatedByUserId) : await writeDiskRows(mergedRows, updatedByUserId);
  return saved.map(redactKey);
}

export async function acquireProviderKey(provider = DEFAULT_PROVIDER) {
  const rows = await listProviderKeys({ includeSecrets: true });
  const modelOpsConfig = await readModelOpsConfig().catch(() => null);
  const now = Date.now();
  const minuteBucket = Math.floor(now / 60_000);
  const candidates = rows
    .filter((row) => {
      if (row.provider !== provider || row.enabled === false) return false;
      if (!row.secret && !Object.keys(row.credentials || {}).length) return false;
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
    credentials: credentialsWithProviderOverrides(key.credentials, key.provider, modelOpsConfig),
    rpm: key.rpm || 0,
  };
}

function publicEvent(row) {
  return {
    id: row.id,
    providerKeyId: row.providerKeyId || row.provider_key_id || null,
    provider: row.provider || null,
    label: row.label || null,
    type: row.type,
    status: row.status == null ? null : Number(row.status),
    message: row.message || null,
    reason: row.reason || null,
    retryable: Boolean(row.retryable),
    cooldownUntil: row.cooldownUntil || row.cooldown_until || null,
    consecutiveErrorCount: row.consecutiveErrorCount ?? row.consecutive_error_count ?? null,
    autoCooldownCount: row.autoCooldownCount ?? row.auto_cooldown_count ?? null,
    createdAt: row.createdAt || row.created_at || null,
  };
}

function readDiskEvents() {
  try {
    const parsed = JSON.parse(fs.readFileSync(eventsDiskPath(), 'utf8') || '{}');
    return Array.isArray(parsed.events) ? parsed.events.map(publicEvent) : [];
  } catch {
    return [];
  }
}

function writeDiskEvents(events) {
  const next = (Array.isArray(events) ? events : [])
    .map(publicEvent)
    .filter((event) => event.id && event.type && event.createdAt)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, maxStoredEvents());
  fs.mkdirSync(path.dirname(eventsDiskPath()), { recursive: true });
  fs.writeFileSync(eventsDiskPath(), `${JSON.stringify({ events: next }, null, 2)}\n`, 'utf8');
  return next;
}

function providerKeyRowForEvent(id) {
  const rows = readDiskRows();
  const envRows = [DEFAULT_PROVIDER, 'volcengine-jimeng'].flatMap((provider) => envKeysForProvider(provider));
  return [...rows, ...envRows].find((row) => row.id === id) || null;
}

function appendDiskEvent(event) {
  writeDiskEvents([publicEvent(event), ...readDiskEvents()]);
}

async function appendDbEvent(event) {
  await ensureProviderKeyStore();
  const e = publicEvent(event);
  await withAiGatewayPostgresRetry('providerKeyStore.appendEvent', () =>
    getPool().query(
      `INSERT INTO ai_gateway_provider_key_events
       (id, provider_key_id, provider, label, type, status, message, reason, retryable, cooldown_until, consecutive_error_count, auto_cooldown_count, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        e.id,
        e.providerKeyId,
        e.provider,
        e.label,
        e.type,
        e.status,
        e.message,
        e.reason,
        e.retryable,
        e.cooldownUntil,
        e.consecutiveErrorCount,
        e.autoCooldownCount,
        e.createdAt,
      ]
    )
  );
}

function recordProviderKeyEvent(id, type, fields = {}) {
  const key = nonEmptyString(id);
  if (!key) return null;
  const runtime = runtimeForKey(key);
  const row = fields.provider || fields.label ? null : providerKeyRowForEvent(key);
  const event = publicEvent({
    id: createEventId(),
    providerKeyId: key,
    provider: fields.provider || row?.provider || null,
    label: fields.label || row?.label || null,
    type,
    status: fields.status,
    message: fields.message,
    reason: fields.reason,
    retryable: fields.retryable,
    cooldownUntil: fields.cooldownUntil || (runtime.cooldownUntil ? new Date(runtime.cooldownUntil).toISOString() : null),
    consecutiveErrorCount: runtime.consecutiveErrorCount || 0,
    autoCooldownCount: runtime.autoCooldownCount || 0,
    createdAt: fields.createdAt || new Date().toISOString(),
  });
  if (USE_POSTGRES) void appendDbEvent(event).catch(() => {});
  else {
    try {
      appendDiskEvent(event);
    } catch {
      // Health history must never block provider execution.
    }
  }
  return event;
}

export async function listProviderKeyHealthEvents(options = {}) {
  const limit = clampEventsLimit(options.limit || 100);
  const keyId = nonEmptyString(options.keyId);
  const provider = nonEmptyString(options.provider);
  if (USE_POSTGRES) {
    await ensureProviderKeyStore();
    const where = [];
    const values = [];
    if (keyId) {
      values.push(keyId);
      where.push(`provider_key_id = $${values.length}`);
    }
    if (provider) {
      values.push(provider);
      where.push(`provider = $${values.length}`);
    }
    values.push(limit);
    const res = await withAiGatewayPostgresRetry('providerKeyStore.listHealthEvents', () =>
      getPool().query(
        `SELECT id, provider_key_id, provider, label, type, status, message, reason, retryable, cooldown_until, consecutive_error_count, auto_cooldown_count, created_at
         FROM ai_gateway_provider_key_events
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC
         LIMIT $${values.length}`,
        values
      )
    );
    return res.rows.map((row) => publicEvent({
      ...row,
      cooldownUntil: row.cooldown_until ? new Date(row.cooldown_until).toISOString() : null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    }));
  }
  return readDiskEvents()
    .filter((event) => !keyId || event.providerKeyId === keyId)
    .filter((event) => !provider || event.provider === provider)
    .slice(0, limit);
}

function emptyHealthSummaryBucket(row, windowHours) {
  return {
    providerKeyId: row.id || null,
    provider: row.provider || null,
    label: row.label || null,
    windowHours,
    totalEvents: 0,
    successCount: 0,
    errorCount: 0,
    retryableErrorCount: 0,
    status429Count: 0,
    status5xxCount: 0,
    cooldownCount: 0,
    autoCooldownCount: 0,
    manualCooldownCount: 0,
    restoreCount: 0,
    lastEventAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastCooldownAt: null,
    lastCooldownUntil: null,
    lastRestoreAt: null,
    lastErrorMessage: null,
    lastErrorStatus: null,
    failureRate: 0,
    retryableFailureRate: 0,
    healthStatus: 'idle',
    suggestedAction: null,
    automation: {
      recommended: false,
      action: 'none',
      ttlMinutes: 0,
      reason: null,
    },
  };
}

function applyEventToHealthSummary(bucket, event) {
  bucket.totalEvents += 1;
  if (!bucket.lastEventAt || String(event.createdAt || '').localeCompare(bucket.lastEventAt) > 0) {
    bucket.lastEventAt = event.createdAt || null;
  }
  if (event.type === 'success') {
    bucket.successCount += 1;
    if (!bucket.lastSuccessAt || String(event.createdAt || '').localeCompare(bucket.lastSuccessAt) > 0) {
      bucket.lastSuccessAt = event.createdAt || null;
    }
  }
  if (event.type === 'error') {
    bucket.errorCount += 1;
    if (event.retryable) bucket.retryableErrorCount += 1;
    if (Number(event.status) === 429) bucket.status429Count += 1;
    if (Number(event.status) >= 500) bucket.status5xxCount += 1;
    if (!bucket.lastErrorAt || String(event.createdAt || '').localeCompare(bucket.lastErrorAt) > 0) {
      bucket.lastErrorAt = event.createdAt || null;
      bucket.lastErrorMessage = event.reason || event.message || null;
      bucket.lastErrorStatus = event.status == null ? null : Number(event.status);
    }
  }
  if (['cooldown', 'auto_cooldown', 'manual_cooldown'].includes(event.type)) {
    bucket.cooldownCount += 1;
    if (event.type === 'auto_cooldown') bucket.autoCooldownCount += 1;
    if (event.type === 'manual_cooldown') bucket.manualCooldownCount += 1;
    if (!bucket.lastCooldownAt || String(event.createdAt || '').localeCompare(bucket.lastCooldownAt) > 0) {
      bucket.lastCooldownAt = event.createdAt || null;
      bucket.lastCooldownUntil = event.cooldownUntil || null;
    }
  }
  if (event.type === 'restore') {
    bucket.restoreCount += 1;
    if (!bucket.lastRestoreAt || String(event.createdAt || '').localeCompare(bucket.lastRestoreAt) > 0) {
      bucket.lastRestoreAt = event.createdAt || null;
    }
  }
}

function finalizeHealthSummaryBucket(bucket) {
  const attempts = bucket.successCount + bucket.errorCount;
  const now = Date.now();
  const cooldownUntilMs = bucket.lastCooldownUntil ? Date.parse(bucket.lastCooldownUntil) : 0;
  const restoreAfterCooldown =
    bucket.lastRestoreAt &&
    bucket.lastCooldownAt &&
    String(bucket.lastRestoreAt).localeCompare(String(bucket.lastCooldownAt)) > 0;
  const activeCooldown = Number.isFinite(cooldownUntilMs) && cooldownUntilMs > now && !restoreAfterCooldown;
  bucket.failureRate = attempts ? Number((bucket.errorCount / attempts).toFixed(4)) : 0;
  bucket.retryableFailureRate = attempts ? Number((bucket.retryableErrorCount / attempts).toFixed(4)) : 0;
  if (activeCooldown) {
    bucket.healthStatus = 'cooling_down';
    bucket.suggestedAction = 'check_or_restore';
  } else if (bucket.status429Count > 0) {
    bucket.healthStatus = 'rate_limited';
    bucket.suggestedAction = 'lower_rpm_or_add_keys';
  } else if (bucket.errorCount >= 3 || bucket.failureRate >= 0.5) {
    bucket.healthStatus = 'degraded';
    bucket.suggestedAction = 'check_provider_or_key';
  } else if (bucket.errorCount > 0) {
    bucket.healthStatus = 'warning';
    bucket.suggestedAction = 'watch';
  } else if (bucket.successCount > 0) {
    bucket.healthStatus = 'healthy';
    bucket.suggestedAction = null;
  }
  bucket.automation = recommendProviderKeyHealthAction(bucket);
  return bucket;
}

function providerKeyAutomationConfig() {
  const enabledRaw = String(process.env.AI_GATEWAY_PROVIDER_KEY_HEALTH_AUTOMATION || '').trim().toLowerCase();
  const enabled = !['0', 'false', 'off', 'no'].includes(enabledRaw);
  const minErrors = Math.max(1, Math.min(50, Math.floor(Number(process.env.AI_GATEWAY_PROVIDER_KEY_HEALTH_AUTOMATION_MIN_ERRORS || 2)) || 2));
  const failureRate = Math.max(0.05, Math.min(1, Number(process.env.AI_GATEWAY_PROVIDER_KEY_HEALTH_AUTOMATION_FAILURE_RATE || 0.5) || 0.5));
  const cooldownMinutes = Math.max(1, Math.min(1440, Math.floor(Number(process.env.AI_GATEWAY_PROVIDER_KEY_HEALTH_AUTOMATION_COOLDOWN_MINUTES || 15)) || 15));
  return { enabled, minErrors, failureRate, cooldownMinutes };
}

function recommendProviderKeyHealthAction(bucket) {
  const config = providerKeyAutomationConfig();
  if (!config.enabled || !bucket.providerKeyId || bucket.healthStatus === 'cooling_down') {
    return { recommended: false, action: 'none', ttlMinutes: 0, reason: null };
  }
  const enoughErrors = bucket.errorCount >= config.minErrors;
  const rateLimited = bucket.status429Count >= 1 && enoughErrors;
  const unstable =
    enoughErrors &&
    (bucket.failureRate >= config.failureRate || bucket.retryableFailureRate >= config.failureRate || bucket.status5xxCount >= config.minErrors);
  if (!rateLimited && !unstable) {
    return { recommended: false, action: 'none', ttlMinutes: 0, reason: null };
  }
  const reason = rateLimited
    ? `Auto suggestion: ${bucket.status429Count} rate-limit errors in ${bucket.windowHours}h`
    : `Auto suggestion: failure rate ${Math.round(bucket.failureRate * 100)}% in ${bucket.windowHours}h`;
  return {
    recommended: true,
    action: 'cooldown_key',
    ttlMinutes: config.cooldownMinutes,
    reason,
  };
}

async function readProviderKeyHealthEventsForSummary({ sinceIso, keyId, provider }) {
  if (USE_POSTGRES) {
    await ensureProviderKeyStore();
    const where = ['created_at >= $1'];
    const values = [sinceIso];
    if (keyId) {
      values.push(keyId);
      where.push(`provider_key_id = $${values.length}`);
    }
    if (provider) {
      values.push(provider);
      where.push(`provider = $${values.length}`);
    }
    const res = await withAiGatewayPostgresRetry('providerKeyStore.readHealthEventsForSummary', () =>
      getPool().query(
        `SELECT id, provider_key_id, provider, label, type, status, message, reason, retryable, cooldown_until, consecutive_error_count, auto_cooldown_count, created_at
         FROM ai_gateway_provider_key_events
         WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC`,
        values
      )
    );
    return res.rows.map((row) => publicEvent({
      ...row,
      cooldownUntil: row.cooldown_until ? new Date(row.cooldown_until).toISOString() : null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    }));
  }
  return readDiskEvents()
    .filter((event) => !sinceIso || String(event.createdAt || '').localeCompare(sinceIso) >= 0)
    .filter((event) => !keyId || event.providerKeyId === keyId)
    .filter((event) => !provider || event.provider === provider);
}

export async function summarizeProviderKeyHealth(options = {}) {
  const windowHours = clampSummaryWindowHours(options.windowHours || 24);
  const keyId = nonEmptyString(options.keyId);
  const provider = nonEmptyString(options.provider);
  const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const keys = (await listProviderKeys())
    .filter((row) => !keyId || row.id === keyId)
    .filter((row) => !provider || row.provider === provider);
  const buckets = new Map();
  for (const row of keys) {
    buckets.set(row.id, emptyHealthSummaryBucket(row, windowHours));
  }
  const events = await readProviderKeyHealthEventsForSummary({ sinceIso, keyId, provider });
  for (const event of events) {
    const id = event.providerKeyId || `provider:${event.provider || 'unknown'}`;
    if (!buckets.has(id)) {
      buckets.set(id, emptyHealthSummaryBucket({
        id,
        provider: event.provider || provider || null,
        label: event.label || event.providerKeyId || event.provider || id,
      }, windowHours));
    }
    const bucket = buckets.get(id);
    if (!bucket.provider && event.provider) bucket.provider = event.provider;
    if (!bucket.label && event.label) bucket.label = event.label;
    applyEventToHealthSummary(bucket, event);
  }
  const summaries = Array.from(buckets.values())
    .map(finalizeHealthSummaryBucket)
    .sort((a, b) => {
      const risk = (item) =>
        item.healthStatus === 'cooling_down' ? 5 :
        item.healthStatus === 'rate_limited' ? 4 :
        item.healthStatus === 'degraded' ? 3 :
        item.healthStatus === 'warning' ? 2 :
        item.healthStatus === 'healthy' ? 1 : 0;
      return risk(b) - risk(a) || String(b.lastEventAt || '').localeCompare(String(a.lastEventAt || '')) || String(a.label || '').localeCompare(String(b.label || ''));
    });
  const totals = summaries.reduce((acc, item) => {
    acc.totalEvents += item.totalEvents;
    acc.successCount += item.successCount;
    acc.errorCount += item.errorCount;
    acc.retryableErrorCount += item.retryableErrorCount;
    acc.status429Count += item.status429Count;
    acc.status5xxCount += item.status5xxCount;
    acc.cooldownCount += item.cooldownCount;
    acc.autoCooldownCount += item.autoCooldownCount;
    acc.manualCooldownCount += item.manualCooldownCount;
    acc.restoreCount += item.restoreCount;
    return acc;
  }, {
    windowHours,
    totalEvents: 0,
    successCount: 0,
    errorCount: 0,
    retryableErrorCount: 0,
    status429Count: 0,
    status5xxCount: 0,
    cooldownCount: 0,
    autoCooldownCount: 0,
    manualCooldownCount: 0,
    restoreCount: 0,
  });
  const attempts = totals.successCount + totals.errorCount;
  totals.failureRate = attempts ? Number((totals.errorCount / attempts).toFixed(4)) : 0;
  totals.retryableFailureRate = attempts ? Number((totals.retryableErrorCount / attempts).toFixed(4)) : 0;
  return {
    windowHours,
    since: sinceIso,
    generatedAt: new Date().toISOString(),
    totals,
    summaries,
  };
}

export async function applyProviderKeyHealthAutomation(options = {}) {
  const dryRun = options.dryRun === true;
  const report = await summarizeProviderKeyHealth(options);
  const actions = [];
  for (const item of report.summaries) {
    const automation = item.automation || {};
    if (!automation.recommended || automation.action !== 'cooldown_key' || !item.providerKeyId) continue;
    const action = {
      providerKeyId: item.providerKeyId,
      provider: item.provider,
      label: item.label,
      action: 'cooldown_key',
      ttlMinutes: automation.ttlMinutes || 15,
      reason: automation.reason || 'provider key health automation',
      applied: false,
    };
    if (!dryRun) {
      cooldownProviderKey(item.providerKeyId, {
        minutes: action.ttlMinutes,
        reason: action.reason,
      });
      action.applied = true;
    }
    actions.push(action);
  }
  const summary = dryRun || !actions.length ? report : await summarizeProviderKeyHealth(options);
  return {
    ok: true,
    dryRun,
    generatedAt: new Date().toISOString(),
    windowHours: summary.windowHours,
    actions,
    summary,
  };
}

async function smokeTestProviderKeyLegacy(id, options = {}) {
  const keyId = nonEmptyString(id);
  if (!keyId) {
    return {
      ok: false,
      testedAt: new Date().toISOString(),
      providerKeyId: null,
      provider: null,
      label: null,
      status: 'failed',
      message: '缺少 provider key id',
      missingFields: [],
    };
  }
  const rows = await listProviderKeys({ includeSecrets: true });
  const row = rows.find((item) => item.id === keyId);
  const testedAt = new Date().toISOString();
  if (!row) {
    return {
      ok: false,
      testedAt,
      providerKeyId: keyId,
      provider: null,
      label: null,
      status: 'failed',
      message: 'Provider key not found',
      missingFields: [],
    };
  }
  const missingFields = missingSmokeFields(row);
  if (missingFields.length > 0) {
    const message = `Smoke test failed: missing ${missingFields.join(', ')}`;
    recordProviderKeyError(keyId, new Error(message), {
      reason: nonEmptyString(options.reason) || '管理员手动 Smoke Test',
      retryable: false,
      status: 400,
    });
    return {
      ok: false,
      testedAt,
      providerKeyId: keyId,
      provider: row.provider,
      label: row.label,
      status: 'failed',
      message,
      missingFields,
    };
  }
  recordProviderKeySuccess(keyId);
  return {
    ok: true,
    testedAt,
    providerKeyId: keyId,
    provider: row.provider,
    label: row.label,
    status: 'passed',
    message: 'Smoke test passed: credentials shape is complete',
    missingFields: [],
  };
}

void smokeTestProviderKeyLegacy;

export async function smokeTestProviderKey(id, options = {}) {
  const keyId = nonEmptyString(id);
  const testedAt = new Date().toISOString();
  const baseResult = {
    testedAt,
    providerKeyId: keyId || null,
    provider: null,
    label: null,
    testLayer: 'key_smoke',
    mode: 'credentials_only',
    createsGenerationTask: false,
    route: null,
    upstreamStatus: null,
    latencyMs: null,
    missingFields: [],
    nextAction: null,
  };
  if (!keyId) {
    return {
      ...baseResult,
      ok: false,
      status: 'failed',
      message: 'Missing provider key id',
      nextAction: 'Select a saved provider key before testing',
    };
  }
  const rows = await listProviderKeys({ includeSecrets: true });
  const row = rows.find((item) => item.id === keyId);
  if (!row) {
    return {
      ...baseResult,
      ok: false,
      status: 'failed',
      message: 'Provider key not found',
      nextAction: 'Refresh provider keys and try again',
    };
  }
  const resultBase = {
    ...baseResult,
    provider: row.provider,
    label: row.label,
  };
  const missingFields = missingSmokeFields(row);
  if (missingFields.length > 0) {
    const message = `Smoke test failed: missing ${missingFields.join(', ')}`;
    recordProviderKeyError(keyId, new Error(message), {
      reason: nonEmptyString(options.reason) || 'Admin manual Smoke Test',
      retryable: false,
      status: 400,
    });
    return {
      ...resultBase,
      ok: false,
      status: 'failed',
      upstreamStatus: 400,
      message,
      missingFields,
      nextAction: 'Fill the required credential fields and save the key before testing again',
    };
  }
  const mode = providerKeySmokeMode(options);
  if (mode === 'disabled' || mode === 'credentials_only') {
    recordProviderKeySuccess(keyId);
    return {
      ...resultBase,
      ok: true,
      status: 'passed',
      message: 'Smoke test passed: credentials shape is complete',
      nextAction: 'Run Route Test on a published model to verify backend executability',
    };
  }
  let probe;
  try {
    const modelOpsConfig = options.modelOpsConfig || await readModelOpsConfig().catch(() => null);
    probe = await runRealProviderKeySmoke(row, { ...options, modelOpsConfig });
  } catch (error) {
    recordProviderKeyError(keyId, error, {
      reason: nonEmptyString(options.reason) || 'Admin manual Smoke Test',
      retryable: true,
      status: error?.status || 502,
    });
    return {
      ...resultBase,
      ok: false,
      status: 'failed',
      mode: 'real_upstream',
      route: row.provider === 'tripo'
        ? 'GET /user/balance'
        : row.provider === 'volcengine-jimeng'
          ? 'POST CVSync2AsyncGetResult'
          : null,
      upstreamStatus: error?.status || null,
      message: error instanceof Error ? error.message : String(error || 'Smoke test failed'),
      nextAction: 'Check key validity, upstream permissions, base URL, quota, and network reachability',
    };
  }
  recordProviderKeySuccess(keyId);
  return {
    ...resultBase,
    ok: true,
    status: 'passed',
    mode: probe.mode,
    route: probe.route,
    upstreamStatus: probe.upstreamStatus || null,
    latencyMs: probe.latencyMs || null,
    message: probe.message,
    nextAction: 'Run Route Test on a published model to verify backend executability',
  };
}

export function recordProviderKeySuccess(id) {
  const runtime = runtimeForKey(id);
  runtime.lastUsedAt = new Date().toISOString();
  runtime.lastSuccessAt = runtime.lastUsedAt;
  runtime.lastError = null;
  runtime.consecutiveErrorCount = 0;
  runtime.lastCooldownReason = null;
  recordProviderKeyEvent(id, 'success');
}

export function recordProviderKeyError(id, error, options = {}) {
  const runtime = runtimeForKey(id);
  const message = error instanceof Error ? error.message : String(error || 'provider key error');
  const now = Date.now();
  runtime.lastErrorAt = new Date(now).toISOString();
  runtime.lastError = message.slice(0, 500);
  runtime.errorCount = (runtime.errorCount || 0) + 1;
  runtime.consecutiveErrorCount = (runtime.consecutiveErrorCount || 0) + 1;
  const config = autoCooldownConfig();
  const retryable = retryableProviderKeyError(message, options);
  const explicitCooldownMs = Number(options.cooldownMs || 0);
  const autoCooldownMs =
    !explicitCooldownMs &&
    config.enabled &&
    retryable &&
    runtime.consecutiveErrorCount >= config.threshold
      ? config.cooldownMs
      : 0;
  const cooldownMs = explicitCooldownMs || autoCooldownMs;
  if (cooldownMs > 0) {
    runtime.cooldownUntil = Math.max(runtime.cooldownUntil || 0, now + cooldownMs);
    runtime.lastCooldownReason =
      nonEmptyString(options.reason) ||
      (autoCooldownMs ? `Auto cooldown after ${runtime.consecutiveErrorCount} consecutive provider errors` : message.slice(0, 200));
    if (autoCooldownMs) runtime.autoCooldownCount = (runtime.autoCooldownCount || 0) + 1;
  }
  recordProviderKeyEvent(id, 'error', {
    status: Math.floor(Number(options.status || 0)) || null,
    message,
    reason: nonEmptyString(options.reason),
    retryable,
  });
  if (autoCooldownMs) {
    recordProviderKeyEvent(id, 'auto_cooldown', {
      status: Math.floor(Number(options.status || 0)) || null,
      message,
      reason: runtime.lastCooldownReason,
      retryable,
    });
  } else if (explicitCooldownMs) {
    recordProviderKeyEvent(id, 'cooldown', {
      status: Math.floor(Number(options.status || 0)) || null,
      message,
      reason: runtime.lastCooldownReason,
      retryable,
    });
  }
}

export function cooldownProviderKey(id, options = {}) {
  const key = nonEmptyString(id);
  if (!key) return null;
  const runtime = runtimeForKey(key);
  const now = Date.now();
  const minutes = Math.max(1, Math.min(1440, Math.floor(Number(options.minutes || 10)) || 10));
  runtime.cooldownUntil = now + minutes * 60_000;
  runtime.lastErrorAt = new Date(now).toISOString();
  runtime.lastError = nonEmptyString(options.reason) || `Manual cooldown for ${minutes} minutes`;
  runtime.lastCooldownReason = runtime.lastError;
  runtime.errorCount = runtime.errorCount || 0;
  recordProviderKeyEvent(key, 'manual_cooldown', {
    reason: runtime.lastCooldownReason,
    retryable: false,
  });
  return runtime;
}

export function restoreProviderKey(id) {
  const key = nonEmptyString(id);
  if (!key) return null;
  const runtime = runtimeForKey(key);
  runtime.cooldownUntil = 0;
  runtime.lastError = null;
  runtime.lastCooldownReason = null;
  recordProviderKeyEvent(key, 'restore');
  return runtime;
}

export function resetProviderKeyRuntimeForTests() {
  keyRuntimeState.clear();
  lastKeyIndexByProvider.clear();
}
