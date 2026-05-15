/**
 * Script Hub — Postgres 存储（与 auth users 同库）。
 * 无 DATABASE_URL 时不初始化（script-hub-api 返回 503）。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import {
  scriptHubR2Enabled,
  buildScriptRevisionObjectKey,
  putScriptRevisionUtf8,
  getScriptRevisionUtf8,
  deleteScriptRevisionObjects,
} from './script-hub-r2.js';

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
let pool = null;
let ready = false;

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS script_hub_scripts (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    target_type TEXT NOT NULL CHECK (target_type IN ('maya', 'unreal')),
    visibility TEXT NOT NULL DEFAULT 'private'
      CHECK (visibility IN ('private', 'public', 'unlisted')),
    current_revision_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_user_id, slug)
  )`,
  `CREATE TABLE IF NOT EXISTS script_hub_revisions (
    id TEXT PRIMARY KEY,
    script_id TEXT NOT NULL REFERENCES script_hub_scripts(id) ON DELETE CASCADE,
    version INT NOT NULL,
    entrypoint TEXT NOT NULL DEFAULT 'run',
    schema_json JSONB NOT NULL,
    content_body TEXT NOT NULL,
    content_storage_key TEXT NOT NULL DEFAULT '',
    content_sha256 TEXT NOT NULL,
    content_byte_size INT NOT NULL,
    changelog TEXT NOT NULL DEFAULT '',
    created_by_user_id TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (script_id, version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_script_hub_scripts_owner ON script_hub_scripts(owner_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_script_hub_revisions_script ON script_hub_revisions(script_id)`,
  `ALTER TABLE script_hub_revisions ADD COLUMN IF NOT EXISTS content_storage_key TEXT NOT NULL DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS script_hub_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    script_id TEXT NOT NULL REFERENCES script_hub_scripts(id) ON DELETE CASCADE,
    revision_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    params_json JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    companion_job_id TEXT,
    exit_code INT,
    error_code TEXT,
    error_message TEXT,
    log_excerpt TEXT,
    duration_ms INT,
    client TEXT NOT NULL DEFAULT 'script-hub-web',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_script_hub_runs_user_created ON script_hub_runs(user_id, created_at DESC)`,
];

export function isScriptHubDbConfigured() {
  return Boolean(DATABASE_URL);
}

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export async function initScriptHubStore() {
  if (!DATABASE_URL) {
    ready = false;
    return;
  }
  const p = getPool();
  for (const sql of DDL_STATEMENTS) {
    await p.query(sql);
  }
  ready = true;
}

export function assertScriptHubStoreReady() {
  if (!DATABASE_URL || !ready) {
    throw new Error('Script Hub 需要 DATABASE_URL（与 auth-api 共用 Postgres）并已初始化');
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export function assertValidSlug(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (s.length < 3 || s.length > 64) throw new Error('slug 长度须在 3～64');
  if (!SLUG_RE.test(s)) throw new Error('slug 仅允许小写字母、数字、连字符，且不能以连字符开头或结尾');
  return s;
}

export function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export async function listScriptsForUser(ownerUserId) {
  assertScriptHubStoreReady();
  const p = getPool();
  const { rows } = await p.query(
    `SELECT s.id, s.slug, s.title, s.description, s.target_type, s.visibility, s.current_revision_id,
            s.created_at, s.updated_at,
            r.version AS rev_version, r.schema_json AS rev_schema
     FROM script_hub_scripts s
     LEFT JOIN script_hub_revisions r ON r.id = s.current_revision_id
     WHERE s.owner_user_id = $1
     ORDER BY s.updated_at DESC`,
    [ownerUserId],
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    targetType: row.target_type,
    visibility: row.visibility,
    currentRevision: row.current_revision_id
      ? { id: row.current_revision_id, version: row.rev_version, schema: row.rev_schema }
      : null,
    updatedAt: row.updated_at?.toISOString?.() || String(row.updated_at),
    createdAt: row.created_at?.toISOString?.() || String(row.created_at),
  }));
}

export async function getScriptForOwner(scriptId, ownerUserId) {
  assertScriptHubStoreReady();
  const p = getPool();
  const { rows } = await p.query(`SELECT * FROM script_hub_scripts WHERE id = $1 AND owner_user_id = $2`, [
    scriptId,
    ownerUserId,
  ]);
  return rows[0] || null;
}

export async function createScript(ownerUserId, { title, slug, targetType, description = '' }) {
  assertScriptHubStoreReady();
  const s = assertValidSlug(slug);
  if (targetType !== 'maya' && targetType !== 'unreal') throw new Error('targetType 须为 maya 或 unreal');
  const id = crypto.randomUUID();
  const p = getPool();
  try {
    await p.query(
      `INSERT INTO script_hub_scripts (id, owner_user_id, slug, title, description, target_type)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, ownerUserId, s, String(title || '').trim() || '未命名脚本', String(description), targetType],
    );
  } catch (e) {
    if (e && typeof e === 'object' && e.code === '23505') throw new Error('slug 已被占用');
    throw e;
  }
  return getScriptForOwner(id, ownerUserId);
}

export async function updateScriptMeta(scriptId, ownerUserId, patch) {
  assertScriptHubStoreReady();
  const row = await getScriptForOwner(scriptId, ownerUserId);
  if (!row) return null;
  const title = patch.title != null ? String(patch.title).trim() : row.title;
  const description = patch.description != null ? String(patch.description) : row.description;
  const visibility = patch.visibility != null ? String(patch.visibility) : row.visibility;
  if (!['private', 'public', 'unlisted'].includes(visibility)) throw new Error('visibility 非法');
  const p = getPool();
  await p.query(
    `UPDATE script_hub_scripts SET title = $1, description = $2, visibility = $3, updated_at = now() WHERE id = $4`,
    [title, description, visibility, scriptId],
  );
  return getScriptForOwner(scriptId, ownerUserId);
}

export async function deleteScript(scriptId, ownerUserId) {
  assertScriptHubStoreReady();
  const p = getPool();
  if (scriptHubR2Enabled()) {
    const { rows } = await p.query(
      `SELECT content_storage_key FROM script_hub_revisions r
       JOIN script_hub_scripts s ON s.id = r.script_id
       WHERE r.script_id = $1 AND s.owner_user_id = $2 AND COALESCE(r.content_storage_key, '') <> ''`,
      [scriptId, ownerUserId],
    );
    const keys = rows.map((x) => x.content_storage_key).filter(Boolean);
    await deleteScriptRevisionObjects(keys);
  }
  const r = await p.query(`DELETE FROM script_hub_scripts WHERE id = $1 AND owner_user_id = $2 RETURNING id`, [
    scriptId,
    ownerUserId,
  ]);
  return r.rowCount > 0;
}

export async function createRevision(scriptId, ownerUserId, { schemaJson, contentBody, changelog = '' }) {
  assertScriptHubStoreReady();
  const row = await getScriptForOwner(scriptId, ownerUserId);
  if (!row) return { error: 'not_found' };
  const body = String(contentBody ?? '');
  const maxBytes = Number(process.env.SCRIPT_HUB_MAX_REVISION_BYTES || 512 * 1024);
  const byteSize = Buffer.byteLength(body, 'utf8');
  if (byteSize > maxBytes) throw new Error(`脚本正文超过上限 ${maxBytes} 字节`);
  const revId = crypto.randomUUID();
  const sha = sha256Hex(body);
  const p = getPool();
  const v = await p.query(`SELECT COALESCE(MAX(version), 0) + 1 AS nv FROM script_hub_revisions WHERE script_id = $1`, [
    scriptId,
  ]);
  const version = Number(v.rows[0]?.nv || 1);
  const useR2 = scriptHubR2Enabled();
  const objectKey = useR2 ? buildScriptRevisionObjectKey(ownerUserId, scriptId, version) : '';
  let uploadedKey = '';
  try {
    if (useR2) {
      await putScriptRevisionUtf8(objectKey, body);
      uploadedKey = objectKey;
    }
    const bodyForDb = useR2 ? '' : body;
    const storageKey = useR2 ? objectKey : '';
    await p.query(
      `INSERT INTO script_hub_revisions
     (id, script_id, version, entrypoint, schema_json, content_body, content_storage_key, content_sha256, content_byte_size, changelog, created_by_user_id)
     VALUES ($1, $2, $3, 'run', $4::jsonb, $5, $6, $7, $8, $9, $10)`,
      [revId, scriptId, version, schemaJson, bodyForDb, storageKey, sha, byteSize, String(changelog), ownerUserId],
    );
    await p.query(`UPDATE script_hub_scripts SET current_revision_id = $1, updated_at = now() WHERE id = $2`, [
      revId,
      scriptId,
    ]);
    return { revisionId: revId, version, sha256: sha, byteSize, storageKey: storageKey || undefined };
  } catch (e) {
    if (uploadedKey) await deleteScriptRevisionObjects([uploadedKey]);
    throw e;
  }
}

export async function getRevisionContentForOwner(scriptId, revisionId, ownerUserId) {
  assertScriptHubStoreReady();
  const p = getPool();
  const { rows } = await p.query(
    `SELECT r.content_body, r.content_storage_key, r.schema_json, r.version, r.script_id, s.owner_user_id
     FROM script_hub_revisions r
     JOIN script_hub_scripts s ON s.id = r.script_id
     WHERE r.id = $1 AND r.script_id = $2 AND s.owner_user_id = $3`,
    [revisionId, scriptId, ownerUserId],
  );
  const row = rows[0];
  if (!row) return null;
  let content = String(row.content_body ?? '');
  const sk = String(row.content_storage_key || '').trim();
  if (sk) {
    content = await getScriptRevisionUtf8(sk);
  }
  return {
    content_body: content,
    schema_json: row.schema_json,
    version: row.version,
  };
}

export function rowToScriptApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    targetType: row.target_type,
    visibility: row.visibility,
    currentRevisionId: row.current_revision_id,
    createdAt: row.created_at?.toISOString?.() || String(row.created_at),
    updatedAt: row.updated_at?.toISOString?.() || String(row.updated_at),
  };
}

const RUN_LOG_MAX = 16_000;

export async function assertRevisionOwnedByUser(scriptId, revisionId, ownerUserId) {
  assertScriptHubStoreReady();
  const p = getPool();
  const { rows } = await p.query(
    `SELECT 1 FROM script_hub_revisions r
     JOIN script_hub_scripts s ON s.id = r.script_id
     WHERE r.id = $1 AND r.script_id = $2 AND s.owner_user_id = $3`,
    [revisionId, scriptId, ownerUserId],
  );
  return rows.length > 0;
}

export function rowToRunApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    scriptId: row.script_id,
    revisionId: row.revision_id,
    targetType: row.target_type,
    params: row.params_json,
    status: row.status,
    companionJobId: row.companion_job_id || undefined,
    exitCode: row.exit_code,
    errorCode: row.error_code || undefined,
    errorMessage: row.error_message || undefined,
    logExcerpt: row.log_excerpt || undefined,
    durationMs: row.duration_ms,
    client: row.client,
    createdAt: row.created_at?.toISOString?.() || String(row.created_at),
    finishedAt: row.finished_at?.toISOString?.() || null,
  };
}

export async function getScriptRunForOwner(runId, userId) {
  assertScriptHubStoreReady();
  const p = getPool();
  const { rows } = await p.query(`SELECT * FROM script_hub_runs WHERE id = $1 AND user_id = $2`, [runId, userId]);
  return rows[0] || null;
}

export async function createScriptRun(userId, { scriptId, revisionId, targetType, params, client }) {
  assertScriptHubStoreReady();
  const script = await getScriptForOwner(scriptId, userId);
  if (!script) return { error: 'not_found' };
  if (!(await assertRevisionOwnedByUser(scriptId, revisionId, userId))) return { error: 'not_found' };
  if (script.target_type !== targetType) throw new Error('targetType 与脚本不一致');
  const paramsObj = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  const id = crypto.randomUUID();
  const clientStr = String(client || 'script-hub-web').slice(0, 120);
  const pool = getPool();
  await pool.query(
    `INSERT INTO script_hub_runs
     (id, user_id, script_id, revision_id, target_type, params_json, status, client)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'queued', $7)`,
    [id, userId, scriptId, revisionId, targetType, JSON.stringify(paramsObj), clientStr],
  );
  return { run: rowToRunApi(await getScriptRunForOwner(id, userId)) };
}

export async function patchScriptRun(runId, userId, patch) {
  const cur = await getScriptRunForOwner(runId, userId);
  if (!cur) return null;
  const status = patch.status !== undefined ? String(patch.status) : cur.status;
  if (!['queued', 'running', 'completed', 'failed', 'cancelled'].includes(status)) throw new Error('status 非法');
  const exitCode = patch.exitCode !== undefined ? patch.exitCode : cur.exit_code;
  const errorCode = patch.errorCode !== undefined ? patch.errorCode : cur.error_code;
  const errorMessage = patch.errorMessage !== undefined ? patch.errorMessage : cur.error_message;
  const rawLog = patch.logExcerpt !== undefined ? patch.logExcerpt : cur.log_excerpt;
  const logExcerpt =
    rawLog == null ? null : String(rawLog).length <= RUN_LOG_MAX ? String(rawLog) : `${String(rawLog).slice(0, RUN_LOG_MAX)}…`;
  const durationMs = patch.durationMs !== undefined ? patch.durationMs : cur.duration_ms;
  const companionJobId =
    patch.companionJobId !== undefined ? (patch.companionJobId ? String(patch.companionJobId) : null) : cur.companion_job_id;
  const terminal = status === 'completed' || status === 'failed' || status === 'cancelled';
  const p = getPool();
  await p.query(
    `UPDATE script_hub_runs SET
       status = $1,
       exit_code = $2,
       error_code = $3,
       error_message = $4,
       log_excerpt = $5,
       duration_ms = $6,
       companion_job_id = $7,
       finished_at = CASE WHEN $8 THEN now() ELSE finished_at END
     WHERE id = $9 AND user_id = $10`,
    [status, exitCode, errorCode, errorMessage, logExcerpt, durationMs, companionJobId, terminal, runId, userId],
  );
  return rowToRunApi(await getScriptRunForOwner(runId, userId));
}

export async function listScriptRuns(userId, { limit = 50, scriptId } = {}) {
  assertScriptHubStoreReady();
  const parsed = Number.parseInt(String(limit ?? '50'), 10);
  const lim = Math.min(100, Math.max(1, Number.isFinite(parsed) ? parsed : 50));
  const p = getPool();
  const sid = scriptId && String(scriptId).trim() ? String(scriptId).trim() : '';
  const args = [userId];
  let sql = `SELECT * FROM script_hub_runs WHERE user_id = $1`;
  if (sid) {
    args.push(sid);
    sql += ` AND script_id = $2`;
  }
  args.push(lim);
  sql += ` ORDER BY created_at DESC LIMIT $${args.length}`;
  const { rows } = await p.query(sql, args);
  return rows.map((r) => rowToRunApi(r));
}
