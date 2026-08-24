import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  adjustCredits,
  getCreditBalance,
  reconcileCreditsForUser,
  prechargeCredits,
  releaseCreditReserve,
} from '../server/credit-store.js';
import { insertUsageEvents } from '../server/usage-billing-store.js';
import { resolveAuthDbFileForTests } from './helpers/authDbTestPath.js';

/**
 * ADR §16 consume 矩阵 — 与 tests/credits.test.ts 互补，聚焦 usage↔ledger 一致性。
 */
const DB_FILE = resolveAuthDbFileForTests();

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
  db.creditReserves = [];
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

  it('failed usage with prechargeKey releases unused prehold without charging', async () => {
    await adjustCredits(userId, 500, { note: 'seed', createdBy: 'admin-1' });
    const pre = await prechargeCredits(userId, 134, { idempotencyKey: 'proxy:failed-test' });
    let bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(366);
    await insertUsageEvents(userId, {
      idempotencyKey: 'failed-with-reserve',
      provider: 'vertex',
      billingSku: 'image.gemini.pro',
      meterKind: 'image',
      quantity: 1,
      unit: 'image',
      costUsdEst: 0.134,
      costConfidence: 'estimated',
      status: 'failed',
      meta: { creditsReserveKey: pre.prechargeKey },
    });
    bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(500);
    expect(bal.reserved).toBe(0);
    expect(bal.lifetimeSpent).toBe(0);
  });

  it('precharge deducts balance immediately and allocate on usage', async () => {
    await adjustCredits(userId, 500, { note: 'seed', createdBy: 'admin-1' });
    const pre = await prechargeCredits(userId, 200, { idempotencyKey: 'pc:usage' });
    let bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(300);
    await insertUsageEvents(userId, {
      idempotencyKey: 'precharge-usage-1',
      provider: 'vertex',
      billingSku: 'image.gemini.pro',
      meterKind: 'image',
      quantity: 1,
      unit: 'image',
      costUsdEst: 0.134,
      costConfidence: 'estimated',
      status: 'succeeded',
      meta: { creditsReserveKey: pre.prechargeKey },
    });
    bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(300);
    expect(bal.lifetimeSpent).toBe(134);
  });

  it('precharge reuses a larger unused bundle for a smaller image step', async () => {
    await adjustCredits(userId, 500, { note: 'seed', createdBy: 'admin-1' });
    const bundle = await prechargeCredits(userId, 149, { idempotencyKey: 'workflow:lineart-1' });
    const step = await prechargeCredits(userId, 134, { idempotencyKey: 'workflow:lineart-1' });
    expect(bundle.amount).toBe(149);
    expect(step.duplicate).toBe(true);
    expect(step.amount).toBe(149);
    expect(step.remaining).toBe(149);
    const bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(351);
  });

  it('precharge replaces stale same-key reserve when amount mismatches and unused', async () => {
    await adjustCredits(userId, 500, { note: 'seed', createdBy: 'admin-1' });
    await prechargeCredits(userId, 10, { idempotencyKey: 'workflow:task-1' });
    let bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(490);
    const pre = await prechargeCredits(userId, 149, { idempotencyKey: 'workflow:task-1' });
    expect(pre.amount).toBe(149);
    bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(351);
  });

  it('fullVoid precharge refunds entire pool and reverses allocated spent', async () => {
    await adjustCredits(userId, 500, { note: 'seed', createdBy: 'admin-1' });
    const pre = await prechargeCredits(userId, 268, { idempotencyKey: 'pc:void' });
    await insertUsageEvents(userId, {
      idempotencyKey: 'void-step-1',
      provider: 'vertex',
      billingSku: 'image.gemini.pro',
      meterKind: 'image',
      quantity: 1,
      unit: 'image',
      costUsdEst: 0.134,
      costConfidence: 'estimated',
      status: 'succeeded',
      meta: { creditsReserveKey: pre.prechargeKey },
    });
    let bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(232);
    expect(bal.lifetimeSpent).toBe(134);
    await releaseCreditReserve(userId, pre.prechargeKey, { fullVoid: true });
    bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(500);
    expect(bal.lifetimeSpent).toBe(0);
  });
});
