import { persistentAiGatewayJobStore } from './persistent-job-store.js';
import { listUsageEventsForAdmin } from '../usage-billing-store.js';
import { summarizeProviderKeyHealth } from './provider-key-store.js';
import { USE_POSTGRES, ensurePostgres, getPool, readDb, writeDb } from '../auth-store.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const SNAPSHOT_VERSION = 1;

function clampDays(value) {
  const n = Math.floor(Number(value) || 7);
  return Math.max(1, Math.min(90, n));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function dayKey(value) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) return '';
  return new Date(time).toISOString().slice(0, 10);
}

function routeProvider(plan) {
  return (
    nonEmptyString(plan?.route?.providerId) ||
    nonEmptyString(plan?.job?.provider) ||
    nonEmptyString(plan?.route?.adapterId) ||
    'unknown'
  );
}

function modelKey(plan) {
  return nonEmptyString(plan?.job?.model) || nonEmptyString(plan?.job?.capability) || 'unknown';
}

function classifyJobError(plan) {
  const error = plan?.job?.error;
  const metadata = plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  const message = [
    error && typeof error === 'object' ? error.code : '',
    error && typeof error === 'object' ? error.message : error,
    metadata.proxyStatus,
    metadata.settlementSource,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/429|too many requests|rate.?limit|quota|rpm|resource_exhausted/.test(message)) return 'rate_limited';
  if (/login|required|unauth|401/.test(message)) return 'auth';
  if (/credit|balance|payment|reserve/.test(message)) return 'credits';
  if (/timeout|timed.?out|deadline/.test(message)) return 'timeout';
  if (message) return 'upstream';
  return null;
}

function emptyJobBucket(key) {
  return {
    key,
    total: 0,
    terminal: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    active: 0,
    rateLimited: 0,
    authErrors: 0,
    creditErrors: 0,
    timeoutErrors: 0,
    upstreamErrors: 0,
    failureRate: 0,
    rateLimitRate: 0,
  };
}

function addJobToBucket(bucket, plan) {
  const status = nonEmptyString(plan?.job?.status) || 'created';
  bucket.total += 1;
  if (TERMINAL_STATUSES.has(status)) bucket.terminal += 1;
  else bucket.active += 1;
  if (status === 'succeeded') bucket.succeeded += 1;
  if (status === 'failed') {
    bucket.failed += 1;
    const kind = classifyJobError(plan);
    if (kind === 'rate_limited') bucket.rateLimited += 1;
    else if (kind === 'auth') bucket.authErrors += 1;
    else if (kind === 'credits') bucket.creditErrors += 1;
    else if (kind === 'timeout') bucket.timeoutErrors += 1;
    else if (kind === 'upstream') bucket.upstreamErrors += 1;
  }
  if (status === 'cancelled') bucket.cancelled += 1;
}

function finalizeJobBucket(bucket) {
  return {
    ...bucket,
    failureRate: bucket.terminal ? bucket.failed / bucket.terminal : 0,
    rateLimitRate: bucket.failed ? bucket.rateLimited / bucket.failed : 0,
  };
}

function emptyUsageBucket(key) {
  return {
    key,
    eventCount: 0,
    succeeded: 0,
    failed: 0,
    totalQuantity: 0,
    totalCostUsdEst: 0,
    totalCreditsCharged: 0,
  };
}

function addUsageToBucket(bucket, event) {
  bucket.eventCount += 1;
  if (event.status === 'succeeded') bucket.succeeded += 1;
  if (event.status === 'failed') bucket.failed += 1;
  bucket.totalQuantity += Number(event.quantity) || 0;
  bucket.totalCostUsdEst += Number(event.costUsdEst) || 0;
  bucket.totalCreditsCharged += Number(event.creditsCharged) || 0;
}

function finalizeUsageBucket(bucket) {
  return {
    ...bucket,
    totalQuantity: Math.round(bucket.totalQuantity * 1000) / 1000,
    totalCostUsdEst: Math.round(bucket.totalCostUsdEst * 1e6) / 1e6,
    totalCreditsCharged: Math.round(bucket.totalCreditsCharged),
  };
}

function topBuckets(map, finalize, limit = 10) {
  return Array.from(map.values())
    .map(finalize)
    .sort((a, b) => {
      const left = b.failed ?? b.eventCount ?? b.total ?? 0;
      const right = a.failed ?? a.eventCount ?? a.total ?? 0;
      if (left !== right) return left - right;
      return String(a.key).localeCompare(String(b.key));
    })
    .slice(0, limit);
}

function normalizeRange(days, now = new Date()) {
  const end = new Date(now);
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);
  start.setUTCHours(0, 0, 0, 0);
  return { from: start.toISOString(), to: end.toISOString() };
}

function normalizeDay(value, now = new Date()) {
  const raw = nonEmptyString(value);
  const date = raw ? new Date(raw) : now;
  const time = date.getTime();
  if (!Number.isFinite(time)) return now.toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function rangeForDay(day) {
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(`${day}T23:59:59.999Z`);
  return { from: start.toISOString(), to: end.toISOString() };
}

function normalizeReportRange(query = {}, now = new Date()) {
  const fromRaw = nonEmptyString(query.from);
  const toRaw = nonEmptyString(query.to);
  const fromMs = fromRaw ? Date.parse(fromRaw) : NaN;
  const toMs = toRaw ? Date.parse(toRaw) : NaN;
  if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs >= fromMs) {
    return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), days: clampDays(Math.ceil((toMs - fromMs + 1) / DAY_MS)) };
  }
  const days = clampDays(query.days);
  return { ...normalizeRange(days, now), days };
}

export function buildAiGatewayTrendReportFromInputs({ jobs = [], usageEvents = [], keyHealth = null, days = 7, generatedAt = new Date().toISOString() } = {}) {
  const byDay = new Map();
  const byProvider = new Map();
  const byModel = new Map();
  const usageByDay = new Map();
  const usageByProvider = new Map();
  const usageBySku = new Map();

  for (const plan of Array.isArray(jobs) ? jobs : []) {
    const d = dayKey(plan?.job?.createdAt || plan?.job?.updatedAt);
    const provider = routeProvider(plan);
    const model = modelKey(plan);
    if (d) {
      if (!byDay.has(d)) byDay.set(d, emptyJobBucket(d));
      addJobToBucket(byDay.get(d), plan);
    }
    if (!byProvider.has(provider)) byProvider.set(provider, emptyJobBucket(provider));
    if (!byModel.has(model)) byModel.set(model, emptyJobBucket(model));
    addJobToBucket(byProvider.get(provider), plan);
    addJobToBucket(byModel.get(model), plan);
  }

  for (const event of Array.isArray(usageEvents) ? usageEvents : []) {
    const d = dayKey(event.createdAt);
    const provider = nonEmptyString(event.provider) || 'unknown';
    const sku = nonEmptyString(event.billingSku) || 'unknown';
    if (d) {
      if (!usageByDay.has(d)) usageByDay.set(d, emptyUsageBucket(d));
      addUsageToBucket(usageByDay.get(d), event);
    }
    if (!usageByProvider.has(provider)) usageByProvider.set(provider, emptyUsageBucket(provider));
    if (!usageBySku.has(sku)) usageBySku.set(sku, emptyUsageBucket(sku));
    addUsageToBucket(usageByProvider.get(provider), event);
    addUsageToBucket(usageBySku.get(sku), event);
  }

  const jobTotals = finalizeJobBucket(
    Array.from(byProvider.values()).reduce((acc, bucket) => {
      for (const key of Object.keys(acc)) {
        if (typeof acc[key] === 'number' && typeof bucket[key] === 'number') acc[key] += bucket[key];
      }
      return acc;
    }, emptyJobBucket('total'))
  );

  const usageTotals = finalizeUsageBucket(
    Array.from(usageByProvider.values()).reduce((acc, bucket) => {
      for (const key of Object.keys(acc)) {
        if (typeof acc[key] === 'number' && typeof bucket[key] === 'number') acc[key] += bucket[key];
      }
      return acc;
    }, emptyUsageBucket('total'))
  );

  return {
    generatedAt,
    days: clampDays(days),
    jobs: {
      totals: jobTotals,
      byDay: Array.from(byDay.values()).map(finalizeJobBucket).sort((a, b) => a.key.localeCompare(b.key)),
      byProvider: topBuckets(byProvider, finalizeJobBucket, 10),
      byModel: topBuckets(byModel, finalizeJobBucket, 10),
    },
    usage: {
      totals: usageTotals,
      byDay: Array.from(usageByDay.values()).map(finalizeUsageBucket).sort((a, b) => a.key.localeCompare(b.key)),
      byProvider: topBuckets(usageByProvider, finalizeUsageBucket, 10),
      bySku: topBuckets(usageBySku, finalizeUsageBucket, 10),
    },
    providerKeys: keyHealth || null,
  };
}

export async function buildAiGatewayTrendReport(query = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const { from, to, days } = normalizeReportRange(query, now);
  const store = options.store || persistentAiGatewayJobStore;
  const [jobs, usage, keyHealth] = await Promise.all([
    store.list({ limit: options.jobLimit || 5000, maxLimit: 5000 }),
    listUsageEventsForAdmin({ limit: options.usageLimit || 5000, from, to }),
    summarizeProviderKeyHealth({ windowHours: Math.min(720, days * 24) }).catch(() => null),
  ]);
  const filteredJobs = jobs.filter((plan) => {
    const ts = Date.parse(String(plan?.job?.createdAt || plan?.job?.updatedAt || ''));
    return Number.isFinite(ts) && ts >= Date.parse(from) && ts <= Date.parse(to);
  });
  return {
    ...buildAiGatewayTrendReportFromInputs({
      jobs: filteredJobs,
      usageEvents: usage.events || [],
      keyHealth,
      days,
      generatedAt: now.toISOString(),
    }),
    window: { from, to },
    sampleSize: {
      jobs: filteredJobs.length,
      usageEvents: usage.events?.length || 0,
      providerKeyEvents: keyHealth?.totals?.totalEvents || 0,
    },
    snapshots: options.includeSnapshots === false ? [] : await listAiGatewayTrendSnapshots({ days, now }),
  };
}

export async function ensureAiGatewayTrendSnapshotStore() {
  if (!USE_POSTGRES) return;
  await ensurePostgres();
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ai_gateway_trend_snapshots (
      day TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      report_json JSONB NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL
    );
  `);
  await getPool().query(`CREATE INDEX IF NOT EXISTS idx_ai_gateway_trend_snapshots_generated ON ai_gateway_trend_snapshots(generated_at DESC);`);
}

function publicSnapshot(row) {
  const report = row.report || row.reportJson || row.report_json || {};
  return {
    day: row.day,
    version: Number(row.version || SNAPSHOT_VERSION),
    generatedAt: row.generatedAt || row.generated_at || report.generatedAt || null,
    report,
  };
}

export async function saveAiGatewayTrendSnapshot(report, day) {
  const snapshotDay = normalizeDay(day);
  const payload = {
    ...report,
    snapshot: { day: snapshotDay, version: SNAPSHOT_VERSION },
  };
  const generatedAt = nonEmptyString(report?.generatedAt) || new Date().toISOString();
  if (USE_POSTGRES) {
    await ensureAiGatewayTrendSnapshotStore();
    await getPool().query(
      `INSERT INTO ai_gateway_trend_snapshots (day, version, report_json, generated_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (day) DO UPDATE SET
         version = EXCLUDED.version,
         report_json = EXCLUDED.report_json,
         generated_at = EXCLUDED.generated_at`,
      [snapshotDay, SNAPSHOT_VERSION, JSON.stringify(payload), generatedAt]
    );
    return publicSnapshot({ day: snapshotDay, version: SNAPSHOT_VERSION, reportJson: payload, generatedAt });
  }
  const db = readDb();
  if (!Array.isArray(db.aiGatewayTrendSnapshots)) db.aiGatewayTrendSnapshots = [];
  const next = publicSnapshot({ day: snapshotDay, version: SNAPSHOT_VERSION, reportJson: payload, generatedAt });
  const index = db.aiGatewayTrendSnapshots.findIndex((item) => item.day === snapshotDay);
  if (index >= 0) db.aiGatewayTrendSnapshots[index] = next;
  else db.aiGatewayTrendSnapshots.push(next);
  db.aiGatewayTrendSnapshots = db.aiGatewayTrendSnapshots
    .slice()
    .sort((a, b) => String(b.day).localeCompare(String(a.day)))
    .slice(0, 120);
  writeDb(db);
  return next;
}

export async function listAiGatewayTrendSnapshots(query = {}) {
  const days = clampDays(query.days || 30);
  const now = query.now instanceof Date ? query.now : new Date();
  const since = new Date(now.getTime() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  if (USE_POSTGRES) {
    await ensureAiGatewayTrendSnapshotStore();
    const res = await getPool().query(
      `SELECT day, version, report_json, generated_at
       FROM ai_gateway_trend_snapshots
       WHERE day >= $1
       ORDER BY day DESC
       LIMIT $2`,
      [since, Math.min(120, days)]
    );
    return res.rows.map(publicSnapshot);
  }
  const db = readDb();
  return (Array.isArray(db.aiGatewayTrendSnapshots) ? db.aiGatewayTrendSnapshots : [])
    .map(publicSnapshot)
    .filter((item) => item.day >= since)
    .sort((a, b) => String(b.day).localeCompare(String(a.day)))
    .slice(0, Math.min(120, days));
}

export async function refreshAiGatewayTrendSnapshot(input = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const day = normalizeDay(input.day, now);
  const range = rangeForDay(day);
  const report = await buildAiGatewayTrendReport(
    { from: range.from, to: range.to, days: 1 },
    { ...options, includeSnapshots: false, now: new Date(Math.min(now.getTime(), Date.parse(range.to))) }
  );
  return saveAiGatewayTrendSnapshot(report, day);
}
