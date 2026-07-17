import { readDb, writeDb, USE_POSTGRES, getPool, ensurePostgres } from '../auth-store.js';
import { applyAiJobStatusPatch } from './job.js';
import { withAiGatewayPostgresRetry } from './postgres-transient-retry.js';

const MAX_JSON_JOBS = 10000;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

function clampListLimit(value, maxLimit = MAX_LIST_LIMIT) {
  const max = Math.max(1, Math.min(5000, Math.floor(Number(maxLimit) || MAX_LIST_LIMIT)));
  return Math.min(max, Math.max(1, Math.floor(Number(value) || DEFAULT_LIST_LIMIT)));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeJobListFilters(options = {}) {
  return {
    userId: nonEmptyString(options.userId),
    status: nonEmptyString(options.status),
    provider: nonEmptyString(options.provider),
    model: nonEmptyString(options.model),
    modality: nonEmptyString(options.modality),
    capability: nonEmptyString(options.capability),
    q: nonEmptyString(options.q),
  };
}

function planMatchesJobListFilters(plan, filters) {
  const job = plan?.job || {};
  const route = plan?.route || {};
  const error = job.error || {};
  const provider = String(job.provider || route.providerId || '').trim();
  if (filters.userId && String(job.userId || '') !== filters.userId) return false;
  if (filters.status && String(job.status || '') !== filters.status) return false;
  if (filters.provider && provider !== filters.provider) return false;
  if (filters.model && String(job.model || '') !== filters.model) return false;
  if (filters.modality && String(job.modality || '') !== filters.modality) return false;
  if (filters.capability && String(job.capability || '') !== filters.capability) return false;
  if (filters.q) {
    const haystack = [
      job.id,
      job.correlationId,
      job.userId,
      job.status,
      job.modality,
      job.capability,
      job.provider,
      job.model,
      route.providerId,
      route.adapterId,
      route.workerId,
      route.channel,
      error.code,
      error.message,
    ].join('\n').toLowerCase();
    if (!haystack.includes(filters.q.toLowerCase())) return false;
  }
  return true;
}

function safeJsonParse(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function rowToPlan(row) {
  const job = {
    id: row.id,
    status: row.status,
    modality: row.modality,
    capability: row.capability,
    provider: row.provider || null,
    model: row.model || null,
    userId: row.user_id ?? row.userId ?? null,
    correlationId: row.correlation_id ?? row.correlationId,
    input: safeJsonParse(row.input_json ?? row.inputJson, {}),
    output: safeJsonParse(row.output_json ?? row.outputJson, undefined),
    artifacts: safeJsonParse(row.artifacts_json ?? row.artifactsJson, undefined),
    metadata: safeJsonParse(row.metadata_json ?? row.metadataJson, {}),
    error: safeJsonParse(row.error_json ?? row.errorJson, null),
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
    startedAt: row.started_at ?? row.startedAt ?? undefined,
    finishedAt: row.finished_at ?? row.finishedAt ?? undefined,
  };
  return {
    job,
    route: safeJsonParse(row.route_json ?? row.routeJson, null),
    adapterRequest: safeJsonParse(row.adapter_request_json ?? row.adapterRequestJson, null),
  };
}

function sanitizeAiGatewayJobInput(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitizeAiGatewayJobInput);
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/base64|dataurl|imageBase64DataUrl/i.test(key) && typeof raw === 'string') {
      out[key] = raw ? `[REDACTED_MEDIA:${raw.length} chars]` : '';
      continue;
    }
    if (key === 'multiviewImageBase64DataUrls' && raw && typeof raw === 'object') {
      out[key] = Object.fromEntries(
        Object.entries(raw).map(([slot, slotValue]) => [
          slot,
          typeof slotValue === 'string' && slotValue
            ? `[REDACTED_MEDIA:${slotValue.length} chars]`
            : slotValue,
        ])
      );
      continue;
    }
    out[key] = sanitizeAiGatewayJobInput(raw);
  }
  return out;
}

function sanitizeAiGatewayAdapterRequest(value) {
  if (!value || typeof value !== 'object') return value || {};
  return {
    ...value,
    body: sanitizeAiGatewayJobInput(value.body || {}),
  };
}

function planToJsonRow(plan) {
  return {
    id: plan.job.id,
    userId: plan.job.userId || null,
    status: plan.job.status,
    modality: plan.job.modality,
    capability: plan.job.capability,
    provider: plan.job.provider || null,
    model: plan.job.model || null,
    correlationId: plan.job.correlationId,
    inputJson: JSON.stringify(sanitizeAiGatewayJobInput(plan.job.input || {})),
    outputJson: plan.job.output === undefined ? null : JSON.stringify(plan.job.output),
    artifactsJson: plan.job.artifacts === undefined ? null : JSON.stringify(plan.job.artifacts),
    metadataJson: JSON.stringify(plan.job.metadata || {}),
    routeJson: JSON.stringify(plan.route || {}),
    adapterRequestJson: JSON.stringify(sanitizeAiGatewayAdapterRequest(plan.adapterRequest || {})),
    errorJson: plan.job.error ? JSON.stringify(plan.job.error) : null,
    createdAt: plan.job.createdAt,
    updatedAt: plan.job.updatedAt,
    startedAt: plan.job.startedAt || null,
    finishedAt: plan.job.finishedAt || null,
  };
}

export async function ensureAiGatewayJobsStore() {
  if (!USE_POSTGRES) return;
  await withAiGatewayPostgresRetry('ensureAiGatewayJobsStore', async () => {
    await ensurePostgres();
    const p = getPool();
    await p.query(`
      CREATE TABLE IF NOT EXISTS ai_gateway_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        modality TEXT NOT NULL,
        capability TEXT NOT NULL,
        provider TEXT NULL,
        model TEXT NULL,
        correlation_id TEXT NOT NULL,
        input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        route_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        adapter_request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        output_json JSONB NULL,
        artifacts_json JSONB NULL,
        error_json JSONB NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        started_at TIMESTAMPTZ NULL,
        finished_at TIMESTAMPTZ NULL
      );
    `);
    await p.query(`ALTER TABLE ai_gateway_jobs ADD COLUMN IF NOT EXISTS output_json JSONB NULL;`);
    await p.query(`ALTER TABLE ai_gateway_jobs ADD COLUMN IF NOT EXISTS artifacts_json JSONB NULL;`);
    await p.query(`ALTER TABLE ai_gateway_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NULL;`);
    await p.query(`ALTER TABLE ai_gateway_jobs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ NULL;`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_ai_gateway_jobs_user_created ON ai_gateway_jobs(user_id, created_at DESC);`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_ai_gateway_jobs_status_updated ON ai_gateway_jobs(status, updated_at DESC);`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_ai_gateway_jobs_correlation ON ai_gateway_jobs(correlation_id);`);
  });
}

export function createPersistentAiJobStore() {
  return {
    async put(plan) {
      if (USE_POSTGRES) {
        await ensureAiGatewayJobsStore();
        await withAiGatewayPostgresRetry('aiGatewayJobs.put', () => getPool().query(
          `INSERT INTO ai_gateway_jobs
           (id, user_id, status, modality, capability, provider, model, correlation_id,
            input_json, metadata_json, route_json, adapter_request_json, output_json, artifacts_json,
            error_json, created_at, updated_at, started_at, finished_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18,$19)
           ON CONFLICT (id) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             status = EXCLUDED.status,
             modality = EXCLUDED.modality,
             capability = EXCLUDED.capability,
             provider = EXCLUDED.provider,
             model = EXCLUDED.model,
             correlation_id = EXCLUDED.correlation_id,
             input_json = EXCLUDED.input_json,
             metadata_json = EXCLUDED.metadata_json,
             route_json = EXCLUDED.route_json,
             adapter_request_json = EXCLUDED.adapter_request_json,
             output_json = EXCLUDED.output_json,
             artifacts_json = EXCLUDED.artifacts_json,
             error_json = EXCLUDED.error_json,
             updated_at = EXCLUDED.updated_at,
             started_at = EXCLUDED.started_at,
             finished_at = EXCLUDED.finished_at`,
          [
            plan.job.id,
            plan.job.userId || null,
            plan.job.status,
            plan.job.modality,
            plan.job.capability,
            plan.job.provider || null,
            plan.job.model || null,
            plan.job.correlationId,
            JSON.stringify(sanitizeAiGatewayJobInput(plan.job.input || {})),
            JSON.stringify(plan.job.metadata || {}),
            JSON.stringify(plan.route || {}),
            JSON.stringify(sanitizeAiGatewayAdapterRequest(plan.adapterRequest || {})),
            plan.job.output === undefined ? null : JSON.stringify(plan.job.output),
            plan.job.artifacts === undefined ? null : JSON.stringify(plan.job.artifacts),
            plan.job.error ? JSON.stringify(plan.job.error) : null,
            plan.job.createdAt,
            plan.job.updatedAt,
            plan.job.startedAt || null,
            plan.job.finishedAt || null,
          ]
        ));
        return plan;
      }

      const db = readDb();
      if (!Array.isArray(db.aiGatewayJobs)) db.aiGatewayJobs = [];
      const row = planToJsonRow(plan);
      const idx = db.aiGatewayJobs.findIndex((item) => item.id === row.id);
      if (idx >= 0) db.aiGatewayJobs[idx] = row;
      else db.aiGatewayJobs.unshift(row);
      if (db.aiGatewayJobs.length > MAX_JSON_JOBS) db.aiGatewayJobs.length = MAX_JSON_JOBS;
      writeDb(db);
      return plan;
    },

    async get(id) {
      const key = String(id || '').trim();
      if (!key) return null;
      if (USE_POSTGRES) {
        await ensureAiGatewayJobsStore();
        const res = await withAiGatewayPostgresRetry('aiGatewayJobs.get', () =>
          getPool().query('SELECT * FROM ai_gateway_jobs WHERE id = $1 LIMIT 1', [key])
        );
        return res.rows[0] ? rowToPlan(res.rows[0]) : null;
      }

      const db = readDb();
      const row = Array.isArray(db.aiGatewayJobs) ? db.aiGatewayJobs.find((item) => item.id === key) : null;
      return row ? rowToPlan(row) : null;
    },

    async update(id, patch, options = {}) {
      const existing = await this.get(id);
      if (!existing) return null;
      const next = applyAiJobStatusPatch(existing, patch, options);
      return this.put(next);
    },

    async list(options = {}) {
      const limit = clampListLimit(options.limit, options.maxLimit);
      const filters = normalizeJobListFilters(options);
      if (USE_POSTGRES) {
        await ensureAiGatewayJobsStore();
        const where = [];
        const values = [];
        const addValue = (value) => {
          values.push(value);
          return `$${values.length}`;
        };
        if (filters.userId) where.push(`user_id = ${addValue(filters.userId)}`);
        if (filters.status) where.push(`status = ${addValue(filters.status)}`);
        if (filters.provider) {
          const p = addValue(filters.provider);
          where.push(`(provider = ${p} OR route_json->>'providerId' = ${p})`);
        }
        if (filters.model) where.push(`model = ${addValue(filters.model)}`);
        if (filters.modality) where.push(`modality = ${addValue(filters.modality)}`);
        if (filters.capability) where.push(`capability = ${addValue(filters.capability)}`);
        if (filters.q) {
          const p = addValue(`%${filters.q}%`);
          where.push(`(
            id ILIKE ${p}
            OR correlation_id ILIKE ${p}
            OR COALESCE(user_id, '') ILIKE ${p}
            OR COALESCE(provider, '') ILIKE ${p}
            OR COALESCE(model, '') ILIKE ${p}
            OR capability ILIKE ${p}
            OR modality ILIKE ${p}
            OR route_json::text ILIKE ${p}
            OR error_json::text ILIKE ${p}
          )`);
        }
        values.push(limit);
        const res = await withAiGatewayPostgresRetry('aiGatewayJobs.list', () => getPool().query(
          `SELECT * FROM ai_gateway_jobs
           ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY created_at DESC
           LIMIT $${values.length}`,
          values
        ));
        return res.rows.map(rowToPlan);
      }

      const db = readDb();
      const rows = Array.isArray(db.aiGatewayJobs) ? db.aiGatewayJobs : [];
      return rows
        .slice()
        .map(rowToPlan)
        .filter((plan) => planMatchesJobListFilters(plan, filters))
        .sort((a, b) => String(b.job?.createdAt || '').localeCompare(String(a.job?.createdAt || '')))
        .slice(0, limit)
        ;
    },
  };
}

export const persistentAiGatewayJobStore = createPersistentAiJobStore();
