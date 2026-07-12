import { readDb, writeDb, USE_POSTGRES, getPool, ensurePostgres } from '../auth-store.js';
import { applyAiJobStatusPatch } from './job.js';

const MAX_JSON_JOBS = 10000;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

function clampListLimit(value) {
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(Number(value) || DEFAULT_LIST_LIMIT)));
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
    inputJson: JSON.stringify(plan.job.input || {}),
    outputJson: plan.job.output === undefined ? null : JSON.stringify(plan.job.output),
    artifactsJson: plan.job.artifacts === undefined ? null : JSON.stringify(plan.job.artifacts),
    metadataJson: JSON.stringify(plan.job.metadata || {}),
    routeJson: JSON.stringify(plan.route || {}),
    adapterRequestJson: JSON.stringify(plan.adapterRequest || {}),
    errorJson: plan.job.error ? JSON.stringify(plan.job.error) : null,
    createdAt: plan.job.createdAt,
    updatedAt: plan.job.updatedAt,
    startedAt: plan.job.startedAt || null,
    finishedAt: plan.job.finishedAt || null,
  };
}

export async function ensureAiGatewayJobsStore() {
  if (!USE_POSTGRES) return;
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
}

export function createPersistentAiJobStore() {
  return {
    async put(plan) {
      if (USE_POSTGRES) {
        await ensureAiGatewayJobsStore();
        await getPool().query(
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
            JSON.stringify(plan.job.input || {}),
            JSON.stringify(plan.job.metadata || {}),
            JSON.stringify(plan.route || {}),
            JSON.stringify(plan.adapterRequest || {}),
            plan.job.output === undefined ? null : JSON.stringify(plan.job.output),
            plan.job.artifacts === undefined ? null : JSON.stringify(plan.job.artifacts),
            plan.job.error ? JSON.stringify(plan.job.error) : null,
            plan.job.createdAt,
            plan.job.updatedAt,
            plan.job.startedAt || null,
            plan.job.finishedAt || null,
          ]
        );
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
        const res = await getPool().query('SELECT * FROM ai_gateway_jobs WHERE id = $1 LIMIT 1', [key]);
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
      const limit = clampListLimit(options.limit);
      const userId = String(options.userId || '').trim();
      if (USE_POSTGRES) {
        await ensureAiGatewayJobsStore();
        const res = userId
          ? await getPool().query('SELECT * FROM ai_gateway_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, limit])
          : await getPool().query('SELECT * FROM ai_gateway_jobs ORDER BY created_at DESC LIMIT $1', [limit]);
        return res.rows.map(rowToPlan);
      }

      const db = readDb();
      const rows = Array.isArray(db.aiGatewayJobs) ? db.aiGatewayJobs : [];
      return rows
        .slice()
        .filter((row) => !userId || String(row.userId || '') === userId)
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, limit)
        .map(rowToPlan);
    },
  };
}

export const persistentAiGatewayJobStore = createPersistentAiJobStore();
