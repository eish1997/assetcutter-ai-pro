import {
  consumeCreditsInTx,
  consumeCreditsJson,
  ensureCreditStore,
  releaseCreditReserve,
} from '../credit-store.js';
import { getPool, readDb, USE_POSTGRES, writeDb } from '../auth-store.js';
import { listUsageEventsByCorrelationId } from '../usage-billing-store.js';
import { withAiGatewayPostgresRetry } from './postgres-transient-retry.js';

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

function creditsGateFromPlan(plan) {
  const metadata = plan?.job?.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {};
  const gate = metadata.creditsGate && typeof metadata.creditsGate === 'object' ? metadata.creditsGate : null;
  return gate;
}

function settlementAlreadyDone(plan) {
  const gate = creditsGateFromPlan(plan);
  return Boolean(gate?.settledAt || gate?.releasedAt);
}

function positiveInt(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function collectCreditsFromUnknown(value, out, depth = 0) {
  if (depth > 5 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectCreditsFromUnknown(item, out, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const obj = value;
  for (const key of ['creditsCharged', 'credits_charged', 'actualCredits', 'actual_credits', 'settledCredits']) {
    const credits = positiveInt(obj[key]);
    if (credits > 0) out.push(credits);
  }
  for (const child of Object.values(obj)) {
    collectCreditsFromUnknown(child, out, depth + 1);
  }
}

export function actualCreditsFromAiGatewayPlan(plan) {
  const job = plan?.job;
  const found = [];
  collectCreditsFromUnknown(job?.metadata?.usage, found);
  collectCreditsFromUnknown(job?.metadata?.metering, found);
  collectCreditsFromUnknown(job?.metadata?.billing, found);
  collectCreditsFromUnknown(job?.output, found);
  collectCreditsFromUnknown(job?.artifacts, found);
  if (!found.length) return { credits: 0, source: null };
  return { credits: found.reduce((sum, n) => sum + n, 0), source: 'job_usage' };
}

async function actualCreditsFromUsageEvents(job) {
  const correlationId = String(job?.correlationId || '').trim();
  if (!correlationId) return { credits: 0, source: null, eventCount: 0, usageEventId: null };
  try {
    const { events } = await listUsageEventsByCorrelationId(correlationId, { limit: 100 });
    const chargeable = events.filter((event) => String(event.status || 'succeeded') !== 'failed');
    const credits = chargeable.reduce((sum, event) => sum + positiveInt(event.creditsCharged), 0);
    return credits > 0
      ? { credits, source: 'usage_events', eventCount: chargeable.length, usageEventId: chargeable[0]?.id || null }
      : { credits: 0, source: null, eventCount: events.length, usageEventId: null };
  } catch {
    return { credits: 0, source: null, eventCount: 0, usageEventId: null };
  }
}

async function resolveSettlementCredits(plan, estimatedCredits) {
  const fromEvents = await actualCreditsFromUsageEvents(plan?.job);
  if (fromEvents.credits > 0) return fromEvents;
  const fromJob = actualCreditsFromAiGatewayPlan(plan);
  if (fromJob.credits > 0) return { ...fromJob, eventCount: 0 };
  return { credits: estimatedCredits, source: 'estimated', eventCount: 0 };
}

export async function settleAiGatewayJobCredits(plan) {
  const job = plan?.job;
  if (!job || !TERMINAL_STATUSES.has(job.status)) {
    return { settled: false, reason: 'not_terminal' };
  }
  if (settlementAlreadyDone(plan)) {
    return { settled: false, reason: 'already_settled' };
  }

  const gate = creditsGateFromPlan(plan);
  const reserveKey = String(gate?.reserveKey || '').trim();
  const userId = String(job.userId || '').trim();
  const estimatedCredits = Math.max(1, Math.floor(Number(gate?.estimatedCredits || gate?.reserveAmount || 0)));
  if (!reserveKey || !userId || !estimatedCredits || gate?.mode !== 'reserve') {
    return { settled: false, reason: 'no_reserve' };
  }

  if (job.status === 'succeeded') {
    const actual = await resolveSettlementCredits(plan, estimatedCredits);
    const result = await withAiGatewayPostgresRetry('aiGatewaySettlement.consumeReserve', () =>
      consumeAiGatewayReserve(userId, reserveKey, actual.credits, {
        jobId: job.id,
        usageEventId: actual.usageEventId || job.id,
      })
    );
    return {
      settled: true,
      action: 'charged',
      reserveKey,
      credits: actual.credits,
      estimatedCredits,
      settlementSource: actual.source,
      usageEventCount: actual.eventCount,
      usageEventId: actual.usageEventId || null,
      result,
    };
  }

  const result = await withAiGatewayPostgresRetry('aiGatewaySettlement.releaseReserve', () =>
    releaseCreditReserve(userId, reserveKey, { fullVoid: true })
  );
  return { settled: true, action: 'released', reserveKey, result };
}

async function consumeAiGatewayReserve(userId, reserveKey, credits, usageRef) {
  const jobId = String(usageRef?.jobId || usageRef || '').trim();
  const usageEventId = String(usageRef?.usageEventId || jobId).trim();
  const idempotencyKey = `aijob:settle:${jobId}`.slice(0, 200);
  if (USE_POSTGRES) {
    await ensureCreditStore();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await consumeCreditsInTx(client, userId, credits, {
        usageEventId,
        idempotencyKey,
        reserveKey,
      });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  const db = readDb();
  const result = consumeCreditsJson(db, userId, credits, {
    usageEventId,
    idempotencyKey,
    reserveKey,
  });
  writeDb(db);
  return result;
}

export function settlementMetadataPatch(plan, settlement) {
  if (!settlement?.settled) return {};
  const gate = creditsGateFromPlan(plan) || {};
  const now = new Date().toISOString();
  if (settlement.action === 'charged') {
    return {
      creditsGate: {
        ...gate,
        settledAt: now,
        settlementAction: 'charged',
        settledCredits: settlement.credits,
        estimatedCredits: settlement.estimatedCredits ?? gate.estimatedCredits,
        settlementSource: settlement.settlementSource || 'estimated',
        usageEventCount: settlement.usageEventCount || 0,
        usageEventId: settlement.usageEventId || null,
      },
    };
  }
  return {
    creditsGate: {
      ...gate,
      releasedAt: now,
      settlementAction: 'released',
    },
  };
}
