import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'fs';
import {
  adjustCredits,
  getCreditBalance,
  reserveCredits,
  validateActiveCreditReserve,
} from '../server/credit-store.js';
import { insertUsageEvents } from '../server/usage-billing-store.js';
import {
  acquirePlatformReserve,
  releaseReserveFullVoid,
  settleUsageEvents,
} from '../server/settlement-service.js';
import { resolveAuthDbFileForTests } from './helpers/authDbTestPath.js';

const DB_FILE = resolveAuthDbFileForTests();

function resetSettlementJson() {
  delete process.env.DATABASE_URL;
  process.env.CREDITS_BILLING_ENABLED = 'true';
  process.env.USAGE_BILLING_ENABLED = 'true';
  if (!fs.existsSync(DB_FILE)) return;
  let db = { version: 1, users: [], sessions: [], usageEvents: [], creditBalances: {}, creditLedger: [], creditReserves: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '{}');
    if (parsed && typeof parsed === 'object') db = { ...db, ...parsed };
  } catch {
    /* keep defaults */
  }
  db.creditBalances = {};
  db.creditLedger = [];
  db.creditReserves = [];
  db.usageEvents = [];
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

describe('settlementService', () => {
  const userId = 'test-settlement-user';

  beforeEach(() => {
    resetSettlementJson();
  });

  it('acquirePlatformReserve delegates to credit-store reserveCredits', async () => {
    await adjustCredits(userId, 200, { note: 'seed', createdBy: 'admin' });
    const r = await acquirePlatformReserve(userId, 50, 'settle-reserve-1');
    expect(r.reserveKey).toBe('settle-reserve-1');
    expect(r.amount).toBe(50);
    const bal = await getCreditBalance(userId);
    expect(bal.reserved).toBe(50);
    expect(bal.available).toBe(150);
  });

  it('insertUsageEvents consumes reserve on succeeded chargeable event', async () => {
    await adjustCredits(userId, 500, { note: 'seed', createdBy: 'admin' });
    await reserveCredits(userId, 100, { idempotencyKey: 'gate:task-1' });
    await insertUsageEvents(userId, {
      idempotencyKey: 'usage-settle-1',
      provider: 'vertex',
      billingSku: 'llm.gemini.flash',
      meterKind: 'token',
      quantityIn: 1000,
      quantityOut: 0,
      unit: 'token',
      status: 'succeeded',
      creditsCharged: 15,
      meta: { creditsReserveKey: 'gate:task-1' },
    });
    const bal = await getCreditBalance(userId);
    expect(bal.reserved).toBe(0);
    expect(bal.balance).toBeLessThan(500);
  });

  it('insertUsageEvents releases reserve on failed event', async () => {
    await adjustCredits(userId, 300, { note: 'seed', createdBy: 'admin' });
    await reserveCredits(userId, 80, { idempotencyKey: 'gate:fail-1' });
    await insertUsageEvents(userId, {
      idempotencyKey: 'usage-fail-1',
      provider: 'vertex',
      billingSku: 'llm.gemini.flash',
      meterKind: 'token',
      quantity: 0,
      unit: 'token',
      status: 'failed',
      meta: { creditsReserveKey: 'gate:fail-1' },
    });
    const bal = await getCreditBalance(userId);
    expect(bal.reserved).toBe(0);
    expect(bal.balance).toBe(300);
    const valid = await validateActiveCreditReserve(userId, 'gate:fail-1');
    expect(valid.ok).toBe(false);
  });

  it('releaseReserveFullVoid refunds precharged pool', async () => {
    await adjustCredits(userId, 400, { note: 'seed', createdBy: 'admin' });
    const r = await acquirePlatformReserve(userId, 60, 'void-reserve-1');
    await releaseReserveFullVoid(userId, r.reserveKey);
    const bal = await getCreditBalance(userId);
    expect(bal.reserved).toBe(0);
    expect(bal.available).toBe(400);
  });

  it('settleUsageEvents batch consumes total credits once', async () => {
    await adjustCredits(userId, 1000, { note: 'seed', createdBy: 'admin' });
    await reserveCredits(userId, 200, { idempotencyKey: 'gate:batch-1' });
    const events = [
      {
        id: 'ev-1',
        idempotencyKey: 'batch-ev-1',
        billingSku: 'llm.gemini.flash',
        meterKind: 'token',
        quantityIn: 500_000,
        quantityOut: 0,
        unit: 'token',
        status: 'succeeded',
        creditsCharged: 75,
        metaJson: JSON.stringify({ creditsReserveKey: 'gate:batch-1' }),
      },
      {
        id: 'ev-2',
        idempotencyKey: 'batch-ev-2',
        billingSku: 'llm.gemini.flash',
        meterKind: 'token',
        quantityIn: 500_000,
        quantityOut: 0,
        unit: 'token',
        status: 'succeeded',
        creditsCharged: 75,
        metaJson: JSON.stringify({ creditsReserveKey: 'gate:batch-1' }),
      },
    ];
    const result = await settleUsageEvents(userId, {
      reserveKey: 'gate:batch-1',
      events,
      taskId: 'task-batch-1',
    });
    expect(result.totalCredits).toBe(150);
    expect(result.settled).toBe(2);
    const bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(850);
    expect(bal.reserved).toBe(0);
  });
});
