/**
 * B5 — platform credit settlement (reserve acquire / usage consume / release).
 */
import {
  reserveCredits,
  releaseCreditReserve,
  releaseCreditReserveInTx,
  releaseCreditReserveJson,
  consumeCreditsInTx,
  consumeCreditsJson,
  shouldChargeCreditsForEvent,
  ensureCreditStore,
} from './credit-store.js';
import { readDb, writeDb, USE_POSTGRES, getPool } from './auth-store.js';

export function parseCreditsReserveKeyFromMetaJson(metaJson) {
  if (!metaJson) return null;
  try {
    const meta = typeof metaJson === 'string' ? JSON.parse(metaJson) : metaJson;
    if (meta?.creditsReserveKey) return String(meta.creditsReserveKey).slice(0, 200);
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {string} userId
 * @param {number} amount
 * @param {string} idempotencyKey
 */
export async function acquirePlatformReserve(userId, amount, idempotencyKey) {
  return reserveCredits(userId, amount, { idempotencyKey });
}

/**
 * @param {string} userId
 * @param {string} reserveKey
 */
export async function releaseReserveFullVoid(userId, reserveKey) {
  return releaseCreditReserve(userId, reserveKey, { fullVoid: true });
}

/**
 * Per-event settlement extracted from usage-billing-store (PG transaction client).
 * @param {import('pg').PoolClient} client
 * @param {string} userId
 * @param {object} event normalized usage event
 */
export async function settleUsageEventInTx(client, userId, event) {
  const uid = String(userId || '').trim();
  const reserveKey = parseCreditsReserveKeyFromMetaJson(event.metaJson);
  if (shouldChargeCreditsForEvent(event)) {
    await consumeCreditsInTx(client, uid, event.creditsCharged, {
      usageEventId: event.id,
      idempotencyKey: event.idempotencyKey,
      reserveKey,
    });
    return { charged: true, credits: event.creditsCharged, reserveKey };
  }
  if (reserveKey) {
    await releaseCreditReserveInTx(client, uid, reserveKey);
    return { charged: false, released: true, reserveKey };
  }
  return { charged: false, released: false, reserveKey: null };
}

/**
 * Per-event settlement for JSON mirror (shared db object).
 * @param {object} db
 * @param {string} userId
 * @param {object} event
 */
export function settleUsageEventJson(db, userId, event) {
  const uid = String(userId || '').trim();
  const reserveKey = parseCreditsReserveKeyFromMetaJson(event.metaJson);
  if (shouldChargeCreditsForEvent(event)) {
    consumeCreditsJson(db, uid, event.creditsCharged, {
      usageEventId: event.id,
      idempotencyKey: event.idempotencyKey,
      reserveKey,
    });
    return { charged: true, credits: event.creditsCharged, reserveKey };
  }
  if (reserveKey) {
    releaseCreditReserveJson(db, uid, reserveKey);
    return { charged: false, released: true, reserveKey };
  }
  return { charged: false, released: false, reserveKey: null };
}

function sumChargeableCredits(events) {
  let total = 0;
  for (const ev of events) {
    if (shouldChargeCreditsForEvent(ev)) {
      total += Math.max(0, Math.floor(Number(ev.creditsCharged) || 0));
    }
  }
  return total;
}

/**
 * Batch settlement: consume total credits once, then release reserve remainder if any failed paths.
 * @param {string} userId
 * @param {{ reserveKey?: string, events?: object[], taskId?: string }} opts
 */
export async function settleUsageEvents(userId, opts = {}) {
  const uid = String(userId || '').trim();
  const events = Array.isArray(opts.events) ? opts.events : [];
  const reserveKey = opts.reserveKey
    ? String(opts.reserveKey).slice(0, 200)
    : parseCreditsReserveKeyFromMetaJson(events[0]?.metaJson);
  const taskId = opts.taskId ? String(opts.taskId) : null;

  if (!uid || !events.length) {
    return { totalCredits: 0, settled: 0, taskId, reserveKey: reserveKey ?? null };
  }

  const totalCredits = sumChargeableCredits(events);
  const hasFailed = events.some((ev) => String(ev.status || '') === 'failed');

  if (totalCredits <= 0 && !hasFailed) {
    return { totalCredits: 0, settled: events.length, taskId, reserveKey: reserveKey ?? null };
  }

  if (USE_POSTGRES) {
    await ensureCreditStore();
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      let settled = 0;
      if (totalCredits > 0) {
        await consumeCreditsInTx(client, uid, totalCredits, {
          usageEventId: events.find((e) => shouldChargeCreditsForEvent(e))?.id ?? null,
          idempotencyKey: taskId ? `settle:${taskId}` : null,
          reserveKey,
        });
        settled = events.filter((e) => shouldChargeCreditsForEvent(e)).length;
      } else if (hasFailed && reserveKey) {
        await releaseCreditReserveInTx(client, uid, reserveKey);
      }
      await client.query('COMMIT');
      return { totalCredits, settled, taskId, reserveKey: reserveKey ?? null };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  const db = readDb();
  if (totalCredits > 0) {
    consumeCreditsJson(db, uid, totalCredits, {
      usageEventId: events.find((e) => shouldChargeCreditsForEvent(e))?.id ?? null,
      idempotencyKey: taskId ? `settle:${taskId}` : null,
      reserveKey,
    });
  } else if (hasFailed && reserveKey) {
    releaseCreditReserveJson(db, uid, reserveKey);
  }
  writeDb(db);
  const settled = events.filter((e) => shouldChargeCreditsForEvent(e)).length;
  return { totalCredits, settled, taskId, reserveKey: reserveKey ?? null };
}
