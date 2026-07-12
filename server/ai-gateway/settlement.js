import {
  consumeCreditsInTx,
  consumeCreditsJson,
  ensureCreditStore,
  releaseCreditReserve,
} from '../credit-store.js';
import { getPool, readDb, USE_POSTGRES, writeDb } from '../auth-store.js';

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
    const result = await consumeAiGatewayReserve(userId, reserveKey, estimatedCredits, job.id);
    return { settled: true, action: 'charged', reserveKey, credits: estimatedCredits, result };
  }

  const result = await releaseCreditReserve(userId, reserveKey, { fullVoid: true });
  return { settled: true, action: 'released', reserveKey, result };
}

async function consumeAiGatewayReserve(userId, reserveKey, credits, jobId) {
  const idempotencyKey = `aijob:settle:${jobId}`.slice(0, 200);
  if (USE_POSTGRES) {
    await ensureCreditStore();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await consumeCreditsInTx(client, userId, credits, {
        usageEventId: jobId,
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
    usageEventId: jobId,
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
