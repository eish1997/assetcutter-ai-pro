/**
 * 用量事件账本 — Postgres 或 auth-db.json 镜像（Phase 0）。
 */
import crypto from 'crypto';
import { readDb, writeDb, USE_POSTGRES, getPool, ensurePostgres } from './auth-store.js';
import { estimateCostFromCatalog } from './usage-price-catalog.js';
import { priceUsageQuote } from './pricing-engine.js';
import { getCatalogVersion, getCatalogVersionSync } from './price-catalog-store.js';
import {
  CreditsExceededError,
  ensureCreditStore,
  shouldChargeCreditsForEvent,
  usdEstToCredits,
} from './credit-store.js';
import {
  settleUsageEventInTx,
  settleUsageEventJson,
} from './settlement-service.js';
import { withAiGatewayPostgresRetry } from './ai-gateway/postgres-transient-retry.js';

const MAX_JSON_EVENTS = 20000;
const METER_KINDS = new Set(['token', 'image', 'second', 'task', 'byte']);
const STATUS_VALUES = new Set(['pending', 'succeeded', 'failed', 'refunded']);
const CONFIDENCE_VALUES = new Set(['exact', 'estimated', 'unknown']);

export function isUsageBillingEnabled() {
  const raw = String(process.env.USAGE_BILLING_ENABLED ?? 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEventInput(userId, raw, catalogVersion = null) {
  const idempotencyKey = String(raw?.idempotencyKey || raw?.idempotency_key || '').trim();
  if (!idempotencyKey || idempotencyKey.length > 200) return null;

  const provider = String(raw?.provider || '').trim().slice(0, 64);
  const billingSku = String(raw?.billingSku || raw?.billing_sku || '').trim().slice(0, 120);
  const meterKind = String(raw?.meterKind || raw?.meter_kind || '').trim();
  const unit = String(raw?.unit || '').trim().slice(0, 32);
  if (!provider || !billingSku || !METER_KINDS.has(meterKind) || !unit) return null;

  const status = String(raw?.status || 'succeeded').trim();
  if (!STATUS_VALUES.has(status)) return null;

  const costConfidence = String(raw?.costConfidence || raw?.cost_confidence || 'unknown').trim();
  if (!CONFIDENCE_VALUES.has(costConfidence)) return null;

  const quantityIn = raw?.quantityIn ?? raw?.quantity_in;
  const quantityOut = raw?.quantityOut ?? raw?.quantity_out;
  const quantity = raw?.quantity;

  let costUsdEst = raw?.costUsdEst ?? raw?.cost_usd_est;
  if (costUsdEst === undefined && raw?.meta?.byok !== true) {
    const meta = raw?.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta) ? raw.meta : null;
    costUsdEst = estimateCostFromCatalog(billingSku, {
      quantityIn,
      quantityOut,
      quantity,
      meterKind,
      imageOutputTokens:
        meta?.usagePart === 'output' &&
        meterKind === 'token' &&
        (meta?.outputKind === 'token' || meta?.outputKind === 'image'),
    });
  }
  if (raw?.meta?.byok === true) costUsdEst = null;

  const meta = raw?.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta) ? raw.meta : null;

  const clientCredits =
    raw?.creditsCharged ?? raw?.credits_charged;
  const clientCreditsValid =
    clientCredits != null && Number.isFinite(Number(clientCredits)) && Number(clientCredits) >= 0;

  let creditsCharged = 0;
  const chargeProbe = {
    status,
    billingSku,
    meterKind,
    quantityIn,
    quantityOut,
    quantity,
    costUsdEst: costUsdEst == null ? null : Number(costUsdEst),
    meta,
    metaJson: meta ? JSON.stringify(meta) : null,
  };
  if (shouldChargeCreditsForEvent(chargeProbe)) {
    if (clientCreditsValid) {
      creditsCharged = Math.floor(Number(clientCredits));
    } else {
      const quote = priceUsageQuote({
        billingSku,
        meterKind,
        quantityIn,
        quantityOut,
        quantity,
        usagePart: meta?.usagePart,
        outputKind: meta?.outputKind,
        byok: meta?.byok === true,
      });
      creditsCharged = quote.creditsCharge;
      if (costUsdEst != null && Number(costUsdEst) > 0) {
        creditsCharged = Math.max(creditsCharged, usdEstToCredits(Number(costUsdEst)));
      }
      if (quote.costUsdEst != null && costUsdEst == null) {
        costUsdEst = quote.costUsdEst;
      }
    }
  } else if (clientCreditsValid && meta?.externalCreditSettlement === true) {
    creditsCharged = Math.floor(Number(clientCredits));
  }

  return {
    id: crypto.randomUUID(),
    idempotencyKey,
    userId: String(userId || '').trim(),
    workspaceId: raw?.workspaceId ? String(raw.workspaceId).slice(0, 120) : null,
    projectId: raw?.projectId ? String(raw.projectId).slice(0, 120) : null,
    workflowStepId: raw?.workflowStepId ? String(raw.workflowStepId).slice(0, 120) : null,
    auditLogId: raw?.auditLogId ? String(raw.auditLogId).slice(0, 64) : null,
    provider,
    registryId: raw?.registryId ? String(raw.registryId).slice(0, 120) : null,
    billingSku,
    meterKind,
    quantityIn: quantityIn == null ? null : Number(quantityIn),
    quantityOut: quantityOut == null ? null : Number(quantityOut),
    quantity: quantity == null ? 0 : Number(quantity),
    unit,
    costUsdEst: costUsdEst == null ? null : Number(costUsdEst),
    costConfidence,
    status,
    upstreamTaskId: raw?.upstreamTaskId ? String(raw.upstreamTaskId).slice(0, 120) : null,
    requestId: raw?.requestId ? String(raw.requestId).slice(0, 120) : null,
    jobKind: raw?.jobKind ? String(raw.jobKind).slice(0, 64) : null,
    metaJson: meta ? JSON.stringify(meta) : null,
    createdAt: nowIso(),
    creditsCharged,
    catalogVersion: catalogVersion ? String(catalogVersion).slice(0, 120) : null,
  };
}

function mapRow(r) {
  let meta = null;
  const rawMeta = r.meta_json ?? r.metaJson;
  if (rawMeta) {
    try {
      meta = typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta;
    } catch {
      meta = null;
    }
  }
  return {
    id: r.id,
    idempotencyKey: r.idempotency_key ?? r.idempotencyKey,
    userId: r.user_id ?? r.userId,
    username: r.username ?? '',
    workspaceId: r.workspace_id ?? r.workspaceId ?? null,
    projectId: r.project_id ?? r.projectId ?? null,
    workflowStepId: r.workflow_step_id ?? r.workflowStepId ?? null,
    auditLogId: r.audit_log_id ?? r.auditLogId ?? null,
    provider: r.provider,
    registryId: r.registry_id ?? r.registryId ?? null,
    billingSku: r.billing_sku ?? r.billingSku,
    meterKind: r.meter_kind ?? r.meterKind,
    quantityIn: r.quantity_in != null ? Number(r.quantity_in) : r.quantityIn ?? null,
    quantityOut: r.quantity_out != null ? Number(r.quantity_out) : r.quantityOut ?? null,
    quantity: Number(r.quantity ?? 0),
    unit: r.unit,
    costUsdEst: r.cost_usd_est != null ? Number(r.cost_usd_est) : r.costUsdEst ?? null,
    costConfidence: r.cost_confidence ?? r.costConfidence ?? 'unknown',
    status: r.status,
    upstreamTaskId: r.upstream_task_id ?? r.upstreamTaskId ?? null,
    requestId: r.request_id ?? r.requestId ?? null,
    jobKind: r.job_kind ?? r.jobKind ?? null,
    meta,
    createdAt: r.created_at ?? r.createdAt,
    creditsCharged:
      r.credits_charged != null ? Number(r.credits_charged) : r.creditsCharged != null ? Number(r.creditsCharged) : null,
    catalogVersion: r.catalog_version ?? r.catalogVersion ?? null,
  };
}

export async function ensureUsageBillingStore() {
  if (!USE_POSTGRES) return;
  await withAiGatewayPostgresRetry('usageBilling.ensure', async () => {
    await ensurePostgres();
    const p = getPool();
    await p.query(`
      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        workspace_id TEXT NULL,
        project_id TEXT NULL,
        workflow_step_id TEXT NULL,
        audit_log_id TEXT NULL,
        provider TEXT NOT NULL,
        registry_id TEXT NULL,
        billing_sku TEXT NOT NULL,
        meter_kind TEXT NOT NULL CHECK (meter_kind IN ('token', 'image', 'second', 'task', 'byte')),
        quantity_in NUMERIC NULL,
        quantity_out NUMERIC NULL,
        quantity NUMERIC NOT NULL DEFAULT 0,
        unit TEXT NOT NULL,
        cost_usd_est NUMERIC NULL,
        cost_confidence TEXT NOT NULL DEFAULT 'unknown'
          CHECK (cost_confidence IN ('exact', 'estimated', 'unknown')),
        status TEXT NOT NULL DEFAULT 'succeeded'
          CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
        upstream_task_id TEXT NULL,
        request_id TEXT NULL,
        job_kind TEXT NULL,
        meta_json JSONB NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await p.query(
      `CREATE INDEX IF NOT EXISTS idx_usage_events_user_created ON usage_events(user_id, created_at DESC);`
    );
    await p.query(
      `CREATE INDEX IF NOT EXISTS idx_usage_events_billing_sku_created ON usage_events(billing_sku, created_at DESC);`
    );
    await p.query(`ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS credits_charged BIGINT NULL;`);
    await p.query(`ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS catalog_version TEXT NULL;`);
  });
}

/**
 * @param {string} userId
 * @param {object|object[]} rawEvents
 */
export async function insertUsageEvents(userId, rawEvents) {
  if (!isUsageBillingEnabled()) return { inserted: 0, skipped: 0, disabled: true };
  const uid = String(userId || '').trim();
  if (!uid) return { inserted: 0, skipped: 0 };
  const catalogVersion = await getCatalogVersion();
  const list = (Array.isArray(rawEvents) ? rawEvents : [rawEvents])
    .map((e) => normalizeEventInput(uid, e, catalogVersion))
    .filter(Boolean);
  if (!list.length) return { inserted: 0, skipped: 0 };

  if (USE_POSTGRES) {
    await ensureUsageBillingStore();
    await ensureCreditStore();
    let inserted = 0;
    for (const ev of list) {
      const didInsert = await withAiGatewayPostgresRetry('usageBilling.insertEvent', async () => {
        const p = getPool();
        const client = await p.connect();
        try {
          await client.query('BEGIN');
          const dup = await client.query(`SELECT id FROM usage_events WHERE idempotency_key = $1`, [ev.idempotencyKey]);
          if (dup.rows[0]) {
            await client.query('COMMIT');
            return false;
          }
          await settleUsageEventInTx(client, uid, ev);
          const res = await client.query(
            `INSERT INTO usage_events
             (id, idempotency_key, user_id, workspace_id, project_id, workflow_step_id, audit_log_id,
              provider, registry_id, billing_sku, meter_kind, quantity_in, quantity_out, quantity, unit,
              cost_usd_est, cost_confidence, status, upstream_task_id, request_id, job_kind, meta_json, credits_charged, catalog_version, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23,$24,$25)`,
            [
              ev.id,
              ev.idempotencyKey,
              ev.userId,
              ev.workspaceId,
              ev.projectId,
              ev.workflowStepId,
              ev.auditLogId,
              ev.provider,
              ev.registryId,
              ev.billingSku,
              ev.meterKind,
              ev.quantityIn,
              ev.quantityOut,
              ev.quantity,
              ev.unit,
              ev.costUsdEst,
              ev.costConfidence,
              ev.status,
              ev.upstreamTaskId,
              ev.requestId,
              ev.jobKind,
              ev.metaJson,
              ev.creditsCharged > 0 ? ev.creditsCharged : null,
              ev.catalogVersion,
              ev.createdAt,
            ]
          );
          await client.query('COMMIT');
          return res.rowCount > 0;
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          if (e instanceof CreditsExceededError) throw e;
          throw e;
        } finally {
          client.release();
        }
      });
      if (didInsert) inserted += 1;
    }
    return { inserted, skipped: list.length - inserted };
  }

  const rawList = Array.isArray(rawEvents) ? rawEvents : [rawEvents];
  const db = readDb();
  if (!Array.isArray(db.usageEvents)) db.usageEvents = [];
  const catalogVersionJson = getCatalogVersionSync();
  const existing = new Set(db.usageEvents.map((r) => r.idempotencyKey));
  let inserted = 0;
  for (const raw of rawList) {
    const ev = normalizeEventInput(uid, raw, catalogVersionJson);
    if (!ev) continue;
    if (existing.has(ev.idempotencyKey)) continue;
    try {
      settleUsageEventJson(db, uid, ev);
    } catch (e) {
      if (e instanceof CreditsExceededError) throw e;
      throw e;
    }
    db.usageEvents.push({
      id: ev.id,
      idempotencyKey: ev.idempotencyKey,
      userId: ev.userId,
      workspaceId: ev.workspaceId,
      projectId: ev.projectId,
      workflowStepId: ev.workflowStepId,
      auditLogId: ev.auditLogId,
      provider: ev.provider,
      registryId: ev.registryId,
      billingSku: ev.billingSku,
      meterKind: ev.meterKind,
      quantityIn: ev.quantityIn,
      quantityOut: ev.quantityOut,
      quantity: ev.quantity,
      unit: ev.unit,
      costUsdEst: ev.costUsdEst,
      costConfidence: ev.costConfidence,
      status: ev.status,
      upstreamTaskId: ev.upstreamTaskId,
      requestId: ev.requestId,
      jobKind: ev.jobKind,
      metaJson: ev.metaJson,
      creditsCharged: ev.creditsCharged > 0 ? ev.creditsCharged : null,
      catalogVersion: ev.catalogVersion,
      createdAt: ev.createdAt,
    });
    existing.add(ev.idempotencyKey);
    inserted += 1;
  }
  if (db.usageEvents.length > MAX_JSON_EVENTS) {
    db.usageEvents = db.usageEvents
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, MAX_JSON_EVENTS);
  }
  writeDb(db);
  return { inserted, skipped: rawList.length - inserted };
}

function usernameForUserId(db, userId) {
  const uid = String(userId || '').trim();
  if (!uid) return '';
  const u = (db.users || []).find((row) => String(row.id) === uid);
  return u?.username ? String(u.username) : '';
}

function usageEventMatchesCorrelationId(row, correlationId) {
  const cid = String(correlationId || '').trim();
  if (!cid) return true;
  if (String(row.upstreamTaskId || '') === cid) return true;
  if (String(row.requestId || '') === cid) return true;
  const meta = row.meta;
  if (meta && typeof meta === 'object' && String(meta.taskId || '') === cid) return true;
  return false;
}

function buildUsageListQuery(query = {}) {
  const userFilter = String(query.userId || '').trim();
  const strictUserId = Boolean(query.strictUserId);
  const billingSku = String(query.billingSku || '').trim();
  const provider = String(query.provider || '').trim();
  const projectId = String(query.projectId || '').trim();
  const workflowStepId = String(query.workflowStepId || '').trim();
  const correlationId = String(query.correlationId || '').trim();
  const fromIso = query.from ? new Date(query.from).toISOString() : '';
  const toIso = query.to ? new Date(query.to).toISOString() : '';
  const cursor = query.cursor || null;
  const clauses = [];
  const params = [];
  let i = 1;
  if (userFilter) {
    if (strictUserId) {
      clauses.push(`e.user_id = $${i++}`);
      params.push(userFilter);
    } else {
      clauses.push(`(e.user_id = $${i} OR u.username ILIKE $${i + 1})`);
      params.push(userFilter, `%${userFilter}%`);
      i += 2;
    }
  }
  if (projectId) {
    clauses.push(`e.project_id = $${i++}`);
    params.push(projectId);
  }
  if (workflowStepId) {
    clauses.push(`e.workflow_step_id = $${i++}`);
    params.push(workflowStepId);
  }
  if (correlationId) {
    clauses.push(
      `(e.upstream_task_id = $${i} OR e.request_id = $${i} OR (e.meta_json IS NOT NULL AND e.meta_json::jsonb->>'taskId' = $${i}))`
    );
    params.push(correlationId);
    i += 1;
  }
  if (billingSku) {
    clauses.push(`e.billing_sku = $${i++}`);
    params.push(billingSku);
  }
  if (provider) {
    clauses.push(`e.provider = $${i++}`);
    params.push(provider);
  }
  if (fromIso && !Number.isNaN(new Date(fromIso).getTime())) {
    clauses.push(`e.created_at >= $${i++}`);
    params.push(fromIso);
  }
  if (toIso && !Number.isNaN(new Date(toIso).getTime())) {
    clauses.push(`e.created_at <= $${i++}`);
    params.push(toIso);
  }
  if (cursor?.createdAt && cursor?.id) {
    clauses.push(`(e.created_at, e.id) < ($${i++}, $${i++})`);
    params.push(cursor.createdAt, String(cursor.id));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const fromSql = `FROM usage_events e LEFT JOIN users u ON u.id = e.user_id ${where}`;
  return { fromSql, params, nextParamIndex: i };
}

export function encodeUsageCursor(row) {
  if (!row?.createdAt || !row?.id) return null;
  const payload = JSON.stringify({ createdAt: row.createdAt, id: row.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeUsageCursor(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const parsed = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (!parsed?.id || !parsed.createdAt) return null;
    return { id: String(parsed.id), createdAt: String(parsed.createdAt) };
  } catch {
    return null;
  }
}

export async function listUsageEventsByCorrelationId(correlationId, query = {}) {
  const cid = String(correlationId || '').trim();
  if (!cid) return { events: [], total: 0, limit: 0, nextCursor: null };
  return listUsageEventsForAdmin({ ...query, correlationId: cid, limit: query.limit ?? 100 });
}

export async function listUsageEventsForAdmin(query = {}) {
  const requested = Number.parseInt(String(query.limit ?? '50'), 10) || 50;
  const max = Math.min(5000, Math.max(1, requested));

  if (USE_POSTGRES) {
    await ensureUsageBillingStore();
    const { fromSql, params, nextParamIndex } = buildUsageListQuery(query);
    const { countRes, res } = await withAiGatewayPostgresRetry('usageBilling.listAdmin', async () => {
      const p = getPool();
      const countRes = await p.query(`SELECT COUNT(*)::int AS c ${fromSql}`, params);
      const listParams = [...params, max + 1];
      const res = await p.query(
        `SELECT e.*, u.username
         ${fromSql}
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT $${nextParamIndex}`,
        listParams
      );
      return { countRes, res };
    });
    const total = Number(countRes.rows[0]?.c || 0);
    let events = res.rows.map((r) => mapRow(r));
    let nextCursor = null;
    if (events.length > max) {
      events = events.slice(0, max);
      nextCursor = encodeUsageCursor(events[events.length - 1]);
    }
    return { events, total, limit: max, nextCursor };
  }

  const db = readDb();
  const userFilter = String(query.userId || '').trim();
  const strictUserId = Boolean(query.strictUserId);
  const billingSku = String(query.billingSku || '').trim();
  const provider = String(query.provider || '').trim();
  const projectId = String(query.projectId || '').trim();
  const workflowStepId = String(query.workflowStepId || '').trim();
  const correlationId = String(query.correlationId || '').trim();
  const fromMs = query.from ? new Date(query.from).getTime() : NaN;
  const toMs = query.to ? new Date(query.to).getTime() : NaN;
  const cursor = query.cursor || null;

  let rows = (db.usageEvents || []).map((r) => {
    const row = mapRow(r);
    if (!row.username) row.username = usernameForUserId(db, row.userId);
    return row;
  });

  rows = rows.filter((r) => {
    if (userFilter) {
      if (strictUserId) {
        if (String(r.userId) !== userFilter) return false;
      } else {
        const term = userFilter.toLowerCase();
        const idMatch = String(r.userId) === userFilter;
        const nameMatch = String(r.username || '').toLowerCase().includes(term);
        if (!idMatch && !nameMatch) return false;
      }
    }
    if (projectId && String(r.projectId || '') !== projectId) return false;
    if (workflowStepId && String(r.workflowStepId || '') !== workflowStepId) return false;
    if (correlationId && !usageEventMatchesCorrelationId(r, correlationId)) return false;
    if (billingSku && r.billingSku !== billingSku) return false;
    if (provider && r.provider !== provider) return false;
    const ts = new Date(r.createdAt).getTime();
    if (Number.isFinite(fromMs) && ts < fromMs) return false;
    if (Number.isFinite(toMs) && ts > toMs) return false;
    if (cursor?.createdAt && cursor?.id) {
      const cts = new Date(cursor.createdAt).getTime();
      const rts = new Date(r.createdAt).getTime();
      if (rts > cts) return false;
      if (rts === cts && String(r.id) >= String(cursor.id)) return false;
    }
    return true;
  });

  rows.sort((a, b) => {
    const dt = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (dt !== 0) return dt;
    return String(b.id).localeCompare(String(a.id));
  });

  const total = rows.length;
  const events = rows.slice(0, max);
  const nextCursor =
    events.length >= max && rows.length > max ? encodeUsageCursor(events[events.length - 1]) : null;
  return { events, total, limit: max, nextCursor };
}

export async function summarizeUsageForAdmin(query = {}) {
  const { events } = await listUsageEventsForAdmin({ ...query, limit: 5000 });
  return summarizeUsageFromEvents(events);
}

function summarizeUsageFromEvents(events) {
  let totalCost = 0;
  let totalQuantity = 0;
  let totalCreditsCharged = 0;
  const bySku = {};
  for (const ev of events) {
    totalQuantity += Number(ev.quantity) || 0;
    if (ev.costUsdEst != null && Number.isFinite(ev.costUsdEst)) totalCost += ev.costUsdEst;
    if (ev.creditsCharged != null && Number.isFinite(ev.creditsCharged)) totalCreditsCharged += ev.creditsCharged;
    const sku = ev.billingSku || 'unknown';
    if (!bySku[sku]) {
      bySku[sku] = { billingSku: sku, count: 0, quantity: 0, costUsdEst: 0, creditsCharged: 0 };
    }
    bySku[sku].count += 1;
    bySku[sku].quantity += Number(ev.quantity) || 0;
    if (ev.costUsdEst != null) bySku[sku].costUsdEst += ev.costUsdEst;
    if (ev.creditsCharged != null) bySku[sku].creditsCharged += ev.creditsCharged;
  }
  return {
    eventCount: events.length,
    totalQuantity,
    totalCostUsdEst: Math.round(totalCost * 1e6) / 1e6,
    totalCreditsCharged,
    bySku: Object.values(bySku).sort((a, b) => b.costUsdEst - a.costUsdEst),
  };
}

export async function listUsageEventsForUser(userId, query = {}) {
  const uid = String(userId || '').trim();
  if (!uid) return { events: [], total: 0, limit: 50, nextCursor: null };
  return listUsageEventsForAdmin({ ...query, userId: uid, strictUserId: true });
}

export async function summarizeUsageForUser(userId, query = {}) {
  const uid = String(userId || '').trim();
  if (!uid) {
    const empty = summarizeUsageFromEvents([]);
    return { ...empty, today: empty, month: empty, projectId: query.projectId || null };
  }
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const base = { userId: uid, strictUserId: true, projectId: query.projectId || '' };
  const [overall, today, month] = await Promise.all([
    summarizeUsageForAdmin({ ...base, from: query.from || '', to: query.to || '' }),
    summarizeUsageForAdmin({ ...base, from: startOfToday.toISOString() }),
    summarizeUsageForAdmin({ ...base, from: startOfMonth.toISOString() }),
  ]);
  return {
    ...overall,
    today,
    month,
    projectId: query.projectId || null,
  };
}

export function formatUsageEventsCsv(events) {
  const header = [
    'created_at',
    'billing_sku',
    'meter_kind',
    'quantity',
    'quantity_in',
    'quantity_out',
    'unit',
    'cost_usd_est',
    'cost_confidence',
    'provider',
    'project_id',
    'workflow_step_id',
    'job_kind',
  ].join(',');
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = (events || []).map((ev) =>
    [
      ev.createdAt,
      ev.billingSku,
      ev.meterKind,
      ev.quantity,
      ev.quantityIn ?? '',
      ev.quantityOut ?? '',
      ev.unit,
      ev.costUsdEst ?? '',
      ev.costConfidence,
      ev.provider,
      ev.projectId ?? '',
      ev.workflowStepId ?? '',
      ev.jobKind ?? '',
    ]
      .map(esc)
      .join(',')
  );
  return `\uFEFF${header}\n${lines.join('\n')}\n`;
}
