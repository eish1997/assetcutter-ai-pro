import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  adjustCredits,
  getCreditBalance,
  reconcileCreditsForUser,
} from '../server/credit-store.js';
import { insertUsageEvents } from '../server/usage-billing-store.js';

/**
 * ADR §16 consume 矩阵 — 与 tests/credits.test.ts 互补，聚焦 usage↔ledger 一致性。
 */
const DB_FILE = path.resolve(process.cwd(), 'server/data/auth-db.json');

function resetCreditJson() {
  delete process.env.DATABASE_URL;
  process.env.CREDITS_BILLING_ENABLED = 'true';
  process.env.USAGE_BILLING_ENABLED = 'true';
  if (!fs.existsSync(DB_FILE)) return;
  let db = { version: 1, users: [], sessions: [], usageEvents: [], creditBalances: {}, creditLedger: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '{}');
    if (parsed && typeof parsed === 'object') db = { ...db, ...parsed };
  } catch {
    /* keep defaults */
  }
  db.creditBalances = {};
  db.creditLedger = [];
  db.usageEvents = [];
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

describe('credits consume integration (ADR §16)', () => {
  const userId = 'test-credits-consume-integration';

  beforeEach(() => {
    resetCreditJson();
  });

  it('duplicate idempotency_key does not double-charge', async () => {
    await adjustCredits(userId, 1000, { note: 'seed', createdBy: 'admin-1' });
    const event = {
      idempotencyKey: 'dup-consume-key',
      provider: 'vertex',
      billingSku: 'llm.gemini.flash',
      meterKind: 'token',
      quantity: 100,
      unit: 'token',
      costUsdEst: 0.002,
      costConfidence: 'estimated',
      status: 'succeeded',
    };
    await insertUsageEvents(userId, event);
    await insertUsageEvents(userId, event);
    const bal = await getCreditBalance(userId);
    expect(bal.lifetimeSpent).toBe(2);
    const row = await reconcileCreditsForUser(userId);
    expect(row.issues).toHaveLength(0);
  });

  it('failed usage status does not consume credits', async () => {
    await adjustCredits(userId, 500, { note: 'seed', createdBy: 'admin-1' });
    await insertUsageEvents(userId, {
      idempotencyKey: 'failed-event',
      provider: 'vertex',
      billingSku: 'llm.gemini.flash',
      meterKind: 'token',
      quantity: 100,
      unit: 'token',
      costUsdEst: 0.01,
      costConfidence: 'estimated',
      status: 'failed',
    });
    const bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(500);
    expect(bal.lifetimeSpent).toBe(0);
  });
});
