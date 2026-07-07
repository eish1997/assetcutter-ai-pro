import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import {
  getCreditBalance,
  grantPromoLot,
  prechargeCredits,
  promoExpireSweep,
  releaseCreditReserve,
  validateActiveCreditReserve,
} from '../server/credit-store.js';
import { readDb, writeDb } from '../server/auth-store.js';
import { resolveAuthDbFileForTests } from './helpers/authDbTestPath.js';

const DB_FILE = resolveAuthDbFileForTests();
const prevPromoLotsEnabled = process.env.CREDITS_PROMO_LOTS_ENABLED;

function resetCreditJson() {
  delete process.env.DATABASE_URL;
  process.env.CREDITS_BILLING_ENABLED = 'true';
  process.env.CREDITS_PROMO_LOTS_ENABLED = 'true';
  if (fs.existsSync(DB_FILE)) {
    let db = {
      version: 1,
      users: [],
      sessions: [],
      usageEvents: [],
      creditBalances: {},
      creditLedger: [],
      creditReserves: [],
      creditPromoLots: [],
    };
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '{}');
      if (parsed && typeof parsed === 'object') db = { ...db, ...parsed };
    } catch {
      /* keep defaults */
    }
    db.creditBalances = {};
    db.creditLedger = [];
    db.creditReserves = [];
    db.creditPromoLots = [];
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  }
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function backdateLotExpiry(lotId: string) {
  const db = readDb();
  const lot = (db.creditPromoLots || []).find((l: { id?: string }) => l.id === lotId);
  if (lot) lot.expiresAt = daysAgo(1);
  writeDb(db);
}

describe('precharge vs promo sweep race', () => {
  const userId = 'test-precharge-promo-race';

  beforeEach(() => {
    resetCreditJson();
  });

  afterEach(() => {
    if (prevPromoLotsEnabled === undefined) delete process.env.CREDITS_PROMO_LOTS_ENABLED;
    else process.env.CREDITS_PROMO_LOTS_ENABLED = prevPromoLotsEnabled;
  });

  it('precharge allocates promo lots so remaining matches balance split', async () => {
    const grant = await grantPromoLot(userId, 100, {
      campaignId: 'race-camp',
      expiresAt: daysFromNow(7),
      note: 'promo pool',
      createdBy: 'admin-1',
    });
    const pre = await prechargeCredits(userId, 40, { idempotencyKey: 'pc:race-1' });
    expect(pre.amount).toBe(40);

    const bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(60);

    const db = readDb();
    const lot = (db.creditPromoLots || []).find((l: { id?: string }) => l.id === grant.lotId);
    expect(lot?.remaining).toBe(60);

    const reserve = (db.creditReserves || []).find(
      (r: { idempotencyKey?: string }) => r.idempotencyKey === 'pc:race-1'
    );
    expect(reserve?.promoLotDeltas?.length).toBeGreaterThan(0);
  });

  it('sweep after precharge does not invalidate active precharge reserve', async () => {
    const grant = await grantPromoLot(userId, 100, {
      campaignId: 'race-expire',
      expiresAt: daysFromNow(3),
      note: 'will expire',
      createdBy: 'admin-1',
    });
    const pre = await prechargeCredits(userId, 50, { idempotencyKey: 'pc:race-expire' });
    expect(pre.remaining).toBe(50);

    backdateLotExpiry(grant.lotId);

    const dbBefore = readDb();
    expect(Math.floor(Number(dbBefore.creditBalances?.[userId]?.balance ?? 0))).toBe(50);

    const sweep = await promoExpireSweep();
    expect(sweep.expiredLots).toBeGreaterThanOrEqual(1);

    const bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(0);

    const valid = await validateActiveCreditReserve(userId, pre.prechargeKey, 1);
    expect(valid.ok).toBe(true);
  });

  it('fullVoid precharge restores promo lot remaining', async () => {
    const grant = await grantPromoLot(userId, 80, {
      campaignId: 'race-refund',
      expiresAt: daysFromNow(14),
      note: 'refund test',
      createdBy: 'admin-1',
    });
    const pre = await prechargeCredits(userId, 30, { idempotencyKey: 'pc:race-refund' });
    await releaseCreditReserve(userId, pre.prechargeKey, { fullVoid: true });

    const bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(80);

    const db = readDb();
    const lot = (db.creditPromoLots || []).find((l: { id?: string }) => l.id === grant.lotId);
    expect(lot?.remaining).toBe(80);
  });
});
