import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  adjustCredits,
  getCreditBalance,
  precheckCredits,
  CreditsExceededError,
  reconcileAllCredits,
  reconcileCreditsForUser,
} from '../server/credit-store.js';
import { insertUsageEvents } from '../server/usage-billing-store.js';
import { usdEstToCredits } from '../shared/credits';
import { resolveAuthDbFileForTests } from './helpers/authDbTestPath.js';

const DB_FILE = resolveAuthDbFileForTests();

function resetCreditJson() {
  delete process.env.DATABASE_URL;
  process.env.CREDITS_BILLING_ENABLED = 'true';
  process.env.USAGE_BILLING_ENABLED = 'true';
  if (fs.existsSync(DB_FILE)) {
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
}

describe('shared/credits usdEstToCredits', () => {
  it('ceil usd to credits', () => {
    expect(usdEstToCredits(0.0014)).toBe(2);
    expect(usdEstToCredits(0.134)).toBe(134);
    expect(usdEstToCredits(null)).toBe(0);
  });
});

describe('credit-store', () => {
  const userId = 'test-credits-user-1';

  beforeEach(() => {
    resetCreditJson();
  });

  it('grant increases balance', async () => {
    const r = await adjustCredits(userId, 5000, { note: 'test grant', createdBy: 'admin-1' });
    expect(r.balanceAfter).toBe(5000);
    const bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(5000);
    expect(bal.lifetimeGranted).toBe(5000);
  });

  it('deduct rejects over balance', async () => {
    await adjustCredits(userId, 100, { note: 'seed', createdBy: 'admin-1' });
    await expect(adjustCredits(userId, -200, { note: 'too much', createdBy: 'admin-1' })).rejects.toThrow(
      /不能超过/
    );
  });

  it('precheck fails when empty', async () => {
    const check = await precheckCredits(userId, 1);
    expect(check.ok).toBe(false);
  });

  it('consume via usage event deducts credits', async () => {
    await adjustCredits(userId, 100_000, { note: 'seed', createdBy: 'admin-1' });
    await insertUsageEvents(userId, {
      idempotencyKey: 'credit-consume-1',
      provider: 'vertex',
      billingSku: 'llm.gemini.flash',
      meterKind: 'token',
      quantityIn: 1000,
      quantityOut: 2000,
      quantity: 3000,
      unit: 'token',
      costConfidence: 'estimated',
      status: 'succeeded',
    });
    const bal = await getCreditBalance(userId);
    expect(bal.balance).toBeLessThan(100_000);
    expect(bal.lifetimeSpent).toBeGreaterThan(0);
  });

  it('throws CREDITS_EXCEEDED when balance insufficient', async () => {
    await expect(
      insertUsageEvents(userId, {
        idempotencyKey: 'credit-consume-fail',
        provider: 'tripo',
        billingSku: '3d.tripo.task',
        meterKind: 'task',
        quantity: 1,
        unit: 'task',
        costUsdEst: 0.5,
        costConfidence: 'estimated',
        status: 'succeeded',
      })
    ).rejects.toBeInstanceOf(CreditsExceededError);
  });

  it('BYOK usage does not deduct credits', async () => {
    await adjustCredits(userId, 100, { note: 'seed', createdBy: 'admin-1' });
    await insertUsageEvents(userId, {
      idempotencyKey: 'credit-byok-1',
      provider: 'vertex',
      billingSku: 'llm.gemini.flash',
      meterKind: 'token',
      quantity: 100,
      unit: 'token',
      costConfidence: 'unknown',
      status: 'succeeded',
      meta: { byok: true },
    });
    const bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(100);
  });
});

describe('credit-store reconcile', () => {
  const userId = 'test-credits-reconcile';

  beforeEach(() => {
    resetCreditJson();
  });

  it('reports zero issues for consistent grant + consume', async () => {
    await adjustCredits(userId, 500, { note: 'seed', createdBy: 'admin-1' });
    await insertUsageEvents(userId, {
      idempotencyKey: 'reconcile-usage-1',
      provider: 'vertex',
      billingSku: 'llm.gemini.flash',
      meterKind: 'token',
      quantity: 1000,
      unit: 'token',
      costUsdEst: 0.002,
      costConfidence: 'estimated',
      status: 'succeeded',
    });

    const row = await reconcileCreditsForUser(userId);
    expect(row.issues).toHaveLength(0);
    expect(row.balance).toBe(498);
  });

  it('detects balance mismatch and fixes from ledger aggregate', async () => {
    await adjustCredits(userId, 200, { note: 'seed', createdBy: 'admin-1' });
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.creditBalances[userId].balance = 999;
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');

    const before = await reconcileCreditsForUser(userId);
    expect(before.issues.some((i) => i.code === 'I2_balance')).toBe(true);

    const afterFix = await reconcileCreditsForUser(userId, { fix: true });
    expect(afterFix.fixed).toBe(true);

    const after = await reconcileCreditsForUser(userId);
    expect(after.issues.filter((i) => i.code === 'I2_balance')).toHaveLength(0);
  });

  it('reconcileAllCredits aggregates users', async () => {
    await adjustCredits(userId, 10, { note: 'a', createdBy: 'admin-1' });
    const res = await reconcileAllCredits();
    expect(res.userCount).toBeGreaterThanOrEqual(1);
    expect(res.issueCount).toBe(0);
  });
});
