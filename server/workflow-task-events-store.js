/**
 * 工作流任务执行事件 — Postgres 或 auth-db.json 镜像。
 */
import { readDb, writeDb, USE_POSTGRES, getPool, ensurePostgres } from './auth-store.js';
import { isSyncableTaskEventCode } from '../shared/taskEventSyncPrefixes.js';

const MAX_JSON_EVENTS = 10000;
const MAX_BATCH = 50;

function isWorkflowTaskEventCode(code) {
  return isSyncableTaskEventCode(code);
}

function normalizeEventInput(userId, raw) {
  const id = String(raw?.id || '').trim();
  const ts = Number(raw?.ts);
  const level = String(raw?.level || '').trim();
  const code = String(raw?.code || '').trim();
  const message = String(raw?.message || '').trim();
  if (!id || !Number.isFinite(ts) || ts < 1) return null;
  if (!['info', 'warn', 'error'].includes(level)) return null;
  if (!code || code.length > 120) return null;
  if (!isWorkflowTaskEventCode(code)) return null;
  if (!message) return null;
  const detail =
    raw?.detail && typeof raw.detail === 'object' && !Array.isArray(raw.detail) ? raw.detail : null;
  return {
    id,
    userId,
    ts: Math.floor(ts),
    level,
    code: code.slice(0, 120),
    message: message.slice(0, 2000),
    assetId: raw?.assetId ? String(raw.assetId).slice(0, 120) : null,
    taskId: raw?.taskId ? String(raw.taskId).slice(0, 120) : null,
    displayKey: raw?.displayKey ? String(raw.displayKey).slice(0, 120) : null,
    detailJson: detail ? JSON.stringify(detail) : null,
  };
}

function mapRow(r) {
  let detail = null;
  const rawDetail = r.detail_json ?? r.detailJson;
  if (rawDetail) {
    try {
      detail = JSON.parse(rawDetail);
    } catch {
      detail = null;
    }
  }
  const tsMs = Number(r.ts);
  return {
    id: r.id,
    source: 'workflow',
    userId: r.user_id ?? r.userId,
    username: r.username ?? '',
    ts: new Date(tsMs).toISOString(),
    tsMs,
    level: r.level,
    code: r.code,
    message: r.message,
    assetId: r.asset_id ?? r.assetId ?? null,
    taskId: r.task_id ?? r.taskId ?? null,
    displayKey: r.display_key ?? r.displayKey ?? null,
    detail,
  };
}

export async function ensureWorkflowTaskEventsStore() {
  if (!USE_POSTGRES) return;
  await ensurePostgres();
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS workflow_task_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ts BIGINT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
      code TEXT NOT NULL,
      message TEXT NOT NULL,
      asset_id TEXT,
      task_id TEXT,
      display_key TEXT,
      detail_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_workflow_task_events_user_ts ON workflow_task_events(user_id, ts DESC);`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_workflow_task_events_ts ON workflow_task_events(ts DESC, id DESC);`
  );
}

export async function insertWorkflowTaskEvents(userId, events) {
  const uid = String(userId || '').trim();
  if (!uid) return { inserted: 0, skipped: 0 };
  const list = (events || [])
    .slice(0, MAX_BATCH)
    .map((e) => normalizeEventInput(uid, e))
    .filter(Boolean);
  if (!list.length) return { inserted: 0, skipped: 0 };

  if (USE_POSTGRES) {
    await ensureWorkflowTaskEventsStore();
    const p = getPool();
    let inserted = 0;
    for (const ev of list) {
      const res = await p.query(
        `INSERT INTO workflow_task_events
         (id, user_id, ts, level, code, message, asset_id, task_id, display_key, detail_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          ev.id,
          ev.userId,
          ev.ts,
          ev.level,
          ev.code,
          ev.message,
          ev.assetId,
          ev.taskId,
          ev.displayKey,
          ev.detailJson,
        ]
      );
      if (res.rowCount > 0) inserted += 1;
    }
    return { inserted, skipped: list.length - inserted };
  }

  const db = readDb();
  if (!Array.isArray(db.workflowTaskEvents)) db.workflowTaskEvents = [];
  const existing = new Set(db.workflowTaskEvents.map((r) => r.id));
  let inserted = 0;
  for (const ev of list) {
    if (existing.has(ev.id)) continue;
    db.workflowTaskEvents.push({
      id: ev.id,
      userId: ev.userId,
      ts: ev.ts,
      level: ev.level,
      code: ev.code,
      message: ev.message,
      assetId: ev.assetId,
      taskId: ev.taskId,
      displayKey: ev.displayKey,
      detailJson: ev.detailJson,
    });
    existing.add(ev.id);
    inserted += 1;
  }
  if (db.workflowTaskEvents.length > MAX_JSON_EVENTS) {
    db.workflowTaskEvents = db.workflowTaskEvents
      .slice()
      .sort((a, b) => Number(b.ts) - Number(a.ts))
      .slice(0, MAX_JSON_EVENTS);
  }
  writeDb(db);
  return { inserted, skipped: list.length - inserted };
}

function usernameForUserId(db, userId) {
  const uid = String(userId || '').trim();
  if (!uid) return '';
  const u = (db.users || []).find((row) => String(row.id) === uid);
  return u?.username ? String(u.username) : '';
}

function buildPostgresTaskEventListQuery(query = {}) {
  const userFilter = String(query.userId || '').trim();
  const level = String(query.level || '').trim();
  const code = String(query.code || '').trim();
  const fromMs = query.from ? new Date(query.from).getTime() : NaN;
  const toMs = query.to ? new Date(query.to).getTime() : NaN;
  const cursor = query.cursor || null;
  const clauses = [];
  const params = [];
  let i = 1;
  if (userFilter) {
    clauses.push(`(e.user_id = $${i} OR u.username ILIKE $${i + 1})`);
    params.push(userFilter, `%${userFilter}%`);
    i += 2;
  }
  if (level && ['info', 'warn', 'error'].includes(level)) {
    clauses.push(`e.level = $${i++}`);
    params.push(level);
  }
  if (code) {
    clauses.push(`e.code ILIKE $${i++}`);
    params.push(`%${code}%`);
  }
  if (Number.isFinite(fromMs)) {
    clauses.push(`e.ts >= $${i++}`);
    params.push(Math.floor(fromMs));
  }
  if (Number.isFinite(toMs)) {
    clauses.push(`e.ts <= $${i++}`);
    params.push(Math.floor(toMs));
  }
  if (cursor?.tsMs != null && cursor?.id) {
    clauses.push(`(e.ts, e.id) < ($${i++}, $${i++})`);
    params.push(Math.floor(cursor.tsMs), String(cursor.id));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const fromSql = `FROM workflow_task_events e LEFT JOIN users u ON u.id = e.user_id ${where}`;
  return { fromSql, params, nextParamIndex: i };
}

export async function listWorkflowTaskEventsForAdmin(query = {}) {
  const max = Math.min(100, Math.max(1, Number.parseInt(String(query.limit ?? '50'), 10) || 50));
  const userFilter = String(query.userId || '').trim();
  const level = String(query.level || '').trim();
  const code = String(query.code || '').trim();
  const fromMs = query.from ? new Date(query.from).getTime() : NaN;
  const toMs = query.to ? new Date(query.to).getTime() : NaN;
  const cursor = query.cursor || null;

  if (USE_POSTGRES) {
    await ensureWorkflowTaskEventsStore();
    const p = getPool();
    const { fromSql, params, nextParamIndex } = buildPostgresTaskEventListQuery(query);
    const countRes = await p.query(`SELECT COUNT(*)::int AS c ${fromSql}`, params);
    const total = Number(countRes.rows[0]?.c || 0);
    const listParams = [...params, max + 1];
    const res = await p.query(
      `SELECT e.*, u.username
       ${fromSql}
       ORDER BY e.ts DESC, e.id DESC
       LIMIT $${nextParamIndex}`,
      listParams
    );
    let logs = res.rows.map((r) => mapRow(r));
    let nextCursor = null;
    if (logs.length > max) {
      logs = logs.slice(0, max);
      nextCursor = encodeTaskEventCursor(logs[logs.length - 1]);
    }
    return { events: logs, total, limit: max, nextCursor };
  }

  const db = readDb();
  let rows = (db.workflowTaskEvents || []).map((r) => {
    const row = mapRow(r);
    if (!row.username) row.username = usernameForUserId(db, row.userId);
    return row;
  });
  rows = rows.filter((r) => {
    if (userFilter) {
      const term = userFilter.toLowerCase();
      const idMatch = String(r.userId) === userFilter;
      const nameMatch = String(r.username || '').toLowerCase().includes(term);
      if (!idMatch && !nameMatch) return false;
    }
    if (level && r.level !== level) return false;
    if (code && !String(r.code).toLowerCase().includes(code.toLowerCase())) return false;
    if (Number.isFinite(fromMs) && r.tsMs < fromMs) return false;
    if (Number.isFinite(toMs) && r.tsMs > toMs) return false;
    if (cursor?.tsMs != null && cursor?.id) {
      if (r.tsMs > cursor.tsMs) return false;
      if (r.tsMs === cursor.tsMs && String(r.id) >= String(cursor.id)) return false;
    }
    return true;
  });
  rows.sort((a, b) => {
    const dt = b.tsMs - a.tsMs;
    if (dt !== 0) return dt;
    return String(b.id).localeCompare(String(a.id));
  });
  const total = rows.length;
  const events = rows.slice(0, max);
  const nextCursor =
    events.length >= max && rows.length > max
      ? encodeTaskEventCursor(events[events.length - 1])
      : null;
  return { events, total, limit: max, nextCursor };
}

export { isWorkflowTaskEventCode, isSyncableTaskEventCode };

export function encodeTaskEventCursor(row) {
  if (!row?.tsMs || !row?.id) return null;
  const payload = JSON.stringify({
    tsMs: row.tsMs,
    id: row.id,
    source: row.source || 'workflow',
  });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeTaskEventCursor(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const parsed = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (!parsed?.id || parsed.tsMs == null) return null;
    return {
      tsMs: Number(parsed.tsMs),
      id: String(parsed.id),
      source: String(parsed.source || 'workflow'),
    };
  } catch {
    return null;
  }
}

export async function countWorkflowTaskEventsSince(sinceIso) {
  const since = sinceIso ? new Date(sinceIso).getTime() : NaN;
  if (!Number.isFinite(since)) return 0;
  if (USE_POSTGRES) {
    await ensureWorkflowTaskEventsStore();
    const p = getPool();
    const res = await p.query(`SELECT COUNT(*)::int AS c FROM workflow_task_events WHERE ts >= $1`, [
      Math.floor(since),
    ]);
    return Number(res.rows[0]?.c || 0);
  }
  const db = readDb();
  return (db.workflowTaskEvents || []).filter((e) => Number(e.ts) >= since).length;
}
