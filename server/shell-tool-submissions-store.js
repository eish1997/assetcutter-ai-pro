/**
 * User-submitted shell_tool_bundle awaiting admin approval.
 * Local JSON: server/data/shell-tool-submissions.json
 * Postgres when DATABASE_URL is set.
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';

const DATA_PATH = path.resolve(process.cwd(), 'server', 'data', 'shell-tool-submissions.json');
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const USE_PG = Boolean(DATABASE_URL);
const { Pool } = pg;
let pool = null;
let pgReady = false;

/** @typedef {{ id: string, status: 'pending'|'approved'|'rejected', toolId: string, semver: string, label: string, notes: string, fileName: string, r2Key: string, sha256: string, bytes: number, submittedByUserId: string, submittedByUsername: string, submittedAt: string, reviewedByUserId?: string, reviewedAt?: string, rejectReason?: string, artifactId?: string }} ShellToolSubmissionV1 */

function getPool() {
  if (!USE_PG) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

async function ensurePg() {
  if (!USE_PG || pgReady) return;
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS shell_tool_submissions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      tool_id TEXT NOT NULL,
      semver TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL,
      r2_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      bytes BIGINT NOT NULL,
      submitted_by_user_id TEXT NOT NULL DEFAULT '',
      submitted_by_username TEXT NOT NULL DEFAULT '',
      submitted_at TIMESTAMPTZ NOT NULL,
      reviewed_by_user_id TEXT,
      reviewed_at TIMESTAMPTZ,
      reject_reason TEXT,
      artifact_id TEXT
    );
  `);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_shell_tool_submissions_status ON shell_tool_submissions (status, submitted_at DESC);`,
  );
  pgReady = true;
}

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    status: r.status,
    toolId: r.tool_id,
    semver: r.semver,
    label: r.label || '',
    notes: r.notes || '',
    fileName: r.file_name,
    r2Key: r.r2_key,
    sha256: String(r.sha256 || '').toLowerCase(),
    bytes: Number(r.bytes) || 0,
    submittedByUserId: r.submitted_by_user_id || '',
    submittedByUsername: r.submitted_by_username || '',
    submittedAt: r.submitted_at ? new Date(r.submitted_at).toISOString() : '',
    reviewedByUserId: r.reviewed_by_user_id || undefined,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : undefined,
    rejectReason: r.reject_reason || undefined,
    artifactId: r.artifact_id || undefined,
  };
}

async function readLocal() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j.submissions) ? j.submissions : [];
  } catch {
    return [];
  }
}

async function writeLocal(list) {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, `${JSON.stringify({ submissions: list }, null, 2)}\n`, 'utf8');
}

/**
 * @param {Omit<ShellToolSubmissionV1, 'id'|'status'|'submittedAt'> & { id?: string }} input
 */
export async function addShellToolSubmission(input) {
  const id = input.id || crypto.randomUUID();
  const rec = {
    id,
    status: 'pending',
    toolId: String(input.toolId || '').trim(),
    semver: String(input.semver || '').trim(),
    label: String(input.label || '').trim(),
    notes: String(input.notes || '').trim(),
    fileName: String(input.fileName || '').trim(),
    r2Key: String(input.r2Key || '').trim(),
    sha256: String(input.sha256 || '').trim().toLowerCase(),
    bytes: Number(input.bytes) || 0,
    submittedByUserId: String(input.submittedByUserId || ''),
    submittedByUsername: String(input.submittedByUsername || ''),
    submittedAt: new Date().toISOString(),
  };
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(rec.toolId)) throw new Error('invalid toolId');
  if (!rec.semver || !rec.r2Key || !rec.sha256 || !rec.fileName) throw new Error('missing fields');

  if (USE_PG) {
    try {
      await ensurePg();
      const p = getPool();
      await p.query(
        `INSERT INTO shell_tool_submissions
          (id, status, tool_id, semver, label, notes, file_name, r2_key, sha256, bytes,
           submitted_by_user_id, submitted_by_username, submitted_at)
         VALUES ($1,'pending',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          rec.id,
          rec.toolId,
          rec.semver,
          rec.label,
          rec.notes,
          rec.fileName,
          rec.r2Key,
          rec.sha256,
          rec.bytes,
          rec.submittedByUserId,
          rec.submittedByUsername,
          rec.submittedAt,
        ],
      );
      return rec;
    } catch (e) {
      console.warn('[shell-tool-submissions] PG write failed, falling back to JSON:', e instanceof Error ? e.message : e);
    }
  }
  const list = await readLocal();
  list.unshift(rec);
  await writeLocal(list);
  return rec;
}

export async function listShellToolSubmissions(opts = {}) {
  const status = opts.status ? String(opts.status) : '';
  const userId = opts.userId ? String(opts.userId) : '';
  if (USE_PG) {
    try {
      await ensurePg();
      const p = getPool();
      const clauses = [];
      const params = [];
      if (status) {
        params.push(status);
        clauses.push(`status = $${params.length}`);
      }
      if (userId) {
        params.push(userId);
        clauses.push(`submitted_by_user_id = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const { rows } = await p.query(
        `SELECT * FROM shell_tool_submissions ${where} ORDER BY submitted_at DESC LIMIT 200`,
        params,
      );
      return rows.map(mapRow);
    } catch (e) {
      console.warn('[shell-tool-submissions] PG read failed:', e instanceof Error ? e.message : e);
    }
  }
  let list = await readLocal();
  if (status) list = list.filter((x) => x.status === status);
  if (userId) list = list.filter((x) => x.submittedByUserId === userId);
  return list;
}

export async function getShellToolSubmission(id) {
  const want = String(id || '').trim();
  if (!want) return null;
  if (USE_PG) {
    try {
      await ensurePg();
      const p = getPool();
      const { rows } = await p.query(`SELECT * FROM shell_tool_submissions WHERE id = $1`, [want]);
      return mapRow(rows[0]);
    } catch {
      /* fall through */
    }
  }
  const list = await readLocal();
  return list.find((x) => x.id === want) || null;
}

export async function updateShellToolSubmission(id, patch) {
  const want = String(id || '').trim();
  if (USE_PG) {
    try {
      await ensurePg();
      const cur = await getShellToolSubmission(want);
      if (!cur) return null;
      const next = { ...cur, ...patch };
      const p = getPool();
      await p.query(
        `UPDATE shell_tool_submissions SET
          status=$2, reviewed_by_user_id=$3, reviewed_at=$4, reject_reason=$5, artifact_id=$6
         WHERE id=$1`,
        [
          want,
          next.status,
          next.reviewedByUserId || null,
          next.reviewedAt || null,
          next.rejectReason || null,
          next.artifactId || null,
        ],
      );
      return next;
    } catch (e) {
      console.warn('[shell-tool-submissions] PG update failed:', e instanceof Error ? e.message : e);
    }
  }
  const list = await readLocal();
  const idx = list.findIndex((x) => x.id === want);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...patch };
  await writeLocal(list);
  return list[idx];
}

export const SHELL_TOOL_SUBMISSION_R2_PREFIX = 'public/companion-distribution/shell-tool-submissions/';
