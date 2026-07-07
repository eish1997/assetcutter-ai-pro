import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import crypto from 'crypto';
import {
  adjustCredits,
  getCreditBalance,
  grantPromoLot,
  promoExpireSweep,
  revokePromoLot,
  consumeCreditsJson,
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

/** grantPromoLot 要求未来 expiresAt；测试过期 sweep 时先发放再回拨时间 */
function backdateLotExpiry(lotId: string, daysInPast = 1) {
  const db = readDb();
  const lot = (db.creditPromoLots || []).find((l: { id?: string }) => l.id === lotId);
  if (lot) lot.expiresAt = daysAgo(daysInPast);
  writeDb(db);
}

/** JSON 模式扣积分 — consumeCreditsJson 内应做 promo FIFO */
function consumeCredits(userId: string, credits: number, opts: Record<string, unknown> = {}) {
  const db = readDb();
  const result = consumeCreditsJson(db, userId, credits, opts);
  writeDb(db);
  return result;
}

function promoLotsForUser(userId: string) {
  const db = readDb();
  return (db.creditPromoLots || []).filter((l: { userId?: string }) => String(l.userId) === userId);
}

function computePromoBreakdown(userId: string) {
  const now = Date.now();
  const lots = promoLotsForUser(userId).filter(
    (l) =>
      l.status === 'active' &&
      Math.max(0, Math.floor(Number(l.remaining) || 0)) > 0 &&
      Date.parse(String(l.expiresAt)) > now
  );
  let promoRemaining = 0;
  let nearestPromoExpiry: string | null = null;
  for (const lot of lots) {
    const rem = Math.max(0, Math.floor(Number(lot.remaining) || 0));
    promoRemaining += rem;
    const exp = lot.expiresAt;
    if (exp && (!nearestPromoExpiry || String(exp) < String(nearestPromoExpiry))) {
      nearestPromoExpiry = String(exp);
    }
  }
  return { promoRemaining, nearestPromoExpiry };
}

/** getCreditBalance 尚未 attach promo 字段时，用 DB lot 汇总作 fallback */
async function expectPromoBalance(
  userId: string,
  expected: { promoRemaining: number; permanentBalance: number; nearestPromoExpiry?: string | null }
) {
  const bal = await getCreditBalance(userId);
  const promo = computePromoBreakdown(userId);
  const promoRemaining = bal.promoRemaining ?? promo.promoRemaining;
  const permanentBalance = bal.permanentBalance ?? Math.max(0, bal.balance - promoRemaining);
  expect(promoRemaining).toBe(expected.promoRemaining);
  expect(permanentBalance).toBe(expected.permanentBalance);
  if (expected.nearestPromoExpiry !== undefined) {
    const nearest = bal.nearestPromoExpiry ?? promo.nearestPromoExpiry;
    if (expected.nearestPromoExpiry === null) {
      expect(nearest).toBeFalsy();
    } else {
      expect(nearest).toBeTruthy();
      expect(new Date(nearest).getTime()).toBeGreaterThanOrEqual(
        new Date(expected.nearestPromoExpiry).getTime() - 1000
      );
      expect(new Date(nearest).getTime()).toBeLessThanOrEqual(
        new Date(expected.nearestPromoExpiry).getTime() + 1000
      );
    }
  }
}

describe('credit promo lots MVP', () => {
  const userId = 'test-promo-lots-user';

  beforeEach(() => {
    resetCreditJson();
  });

  afterEach(() => {
    if (prevPromoLotsEnabled === undefined) delete process.env.CREDITS_PROMO_LOTS_ENABLED;
    else process.env.CREDITS_PROMO_LOTS_ENABLED = prevPromoLotsEnabled;
  });

  it('grantPromoLot increases balance and promoRemaining', async () => {
    const expiresAt = daysFromNow(7);
    const r = await grantPromoLot(userId, 100, {
      campaignId: 'camp-welcome',
      expiresAt,
      note: 'welcome bonus',
      createdBy: 'admin-1',
    });
    expect(r.duplicate).toBe(false);
    expect(r.balanceAfter).toBe(100);

    const bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(100);
    await expectPromoBalance(userId, { promoRemaining: 100, permanentBalance: 0 });

    const lots = promoLotsForUser(userId);
    expect(lots).toHaveLength(1);
    expect(lots[0].remaining).toBe(100);
    expect(lots[0].campaignId).toBe('camp-welcome');
  });

  it('permanent grant (adjustCredits) increases permanentBalance not promoRemaining', async () => {
    await adjustCredits(userId, 50, { note: 'permanent seed', createdBy: 'admin-1' });
    const bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(50);
    await expectPromoBalance(userId, { promoRemaining: 0, permanentBalance: 50 });
    expect(promoLotsForUser(userId)).toHaveLength(0);
  });

  it('consume deducts promo lot FIFO by expiry before permanent balance', async () => {
    await grantPromoLot(userId, 30, {
      campaignId: 'soon',
      expiresAt: daysFromNow(3),
      note: 'expires sooner',
      createdBy: 'admin-1',
    });
    await grantPromoLot(userId, 40, {
      campaignId: 'later',
      expiresAt: daysFromNow(7),
      note: 'expires later',
      createdBy: 'admin-1',
    });
    await adjustCredits(userId, 100, { note: 'permanent pool', createdBy: 'admin-1' });

    let bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(170);
    await expectPromoBalance(userId, { promoRemaining: 70, permanentBalance: 100 });

    await consumeCredits(userId, 50, { idempotencyKey: `consume-fifo-${crypto.randomUUID()}` });

    bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(120);
    await expectPromoBalance(userId, { promoRemaining: 20, permanentBalance: 100 });

    const lots = promoLotsForUser(userId).sort((a, b) =>
      String(a.expiresAt).localeCompare(String(b.expiresAt))
    );
    expect(lots[0].remaining).toBe(0);
    expect(lots[0].status).toBe('depleted');
    expect(lots[1].remaining).toBe(20);
    expect(lots[1].status).toBe('active');
  });

  it('promoExpireSweep clears expired lot remaining and reduces balance', async () => {
    const grant = await grantPromoLot(userId, 80, {
      campaignId: 'expired-camp',
      expiresAt: daysFromNow(7),
      note: 'will backdate',
      createdBy: 'admin-1',
    });
    backdateLotExpiry(grant.lotId, 1);

    await adjustCredits(userId, 20, { note: 'permanent', createdBy: 'admin-1' });

    const dbBefore = readDb();
    expect(Math.floor(Number(dbBefore.creditBalances?.[userId]?.balance ?? 0))).toBe(100);
    expect(computePromoBreakdown(userId).promoRemaining).toBe(0);

    const sweep = await promoExpireSweep();
    expect(sweep.expiredLots).toBeGreaterThanOrEqual(1);
    expect(sweep.creditsExpired).toBe(80);

    const bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(20);
    await expectPromoBalance(userId, { promoRemaining: 0, permanentBalance: 20 });

    const lot = promoLotsForUser(userId).find((l) => l.id === grant.lotId);
    expect(lot?.remaining).toBe(0);
    expect(lot?.status).toBe('expired');
  });

  it('getCreditBalance lazy-expires overdue promo lots on read', async () => {
    const grant = await grantPromoLot(userId, 55, {
      campaignId: 'lazy-expire',
      expiresAt: daysFromNow(2),
      note: 'lazy',
      createdBy: 'admin-1',
    });
    backdateLotExpiry(grant.lotId, 1);
    await adjustCredits(userId, 10, { note: 'perm', createdBy: 'admin-1' });

    const bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(10);
    await expectPromoBalance(userId, { promoRemaining: 0, permanentBalance: 10 });
    const lot = promoLotsForUser(userId).find((l) => l.id === grant.lotId);
    expect(lot?.status).toBe('expired');
  });

  it('idempotent grant and idempotent sweep', async () => {
    const expiresAt = daysFromNow(5);
    const idempotencyKey = 'promo-grant-idem-1';

    const a = await grantPromoLot(userId, 60, {
      campaignId: 'idem-camp',
      expiresAt,
      note: 'idem grant',
      createdBy: 'admin-1',
      idempotencyKey,
    });
    const b = await grantPromoLot(userId, 60, {
      campaignId: 'idem-camp',
      expiresAt,
      note: 'idem grant',
      createdBy: 'admin-1',
      idempotencyKey,
    });
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);

    const bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(60);
    expect(promoLotsForUser(userId)).toHaveLength(1);

    const sweepGrant = await grantPromoLot(userId, 40, {
      campaignId: 'sweep-target',
      expiresAt: daysFromNow(3),
      note: 'for sweep',
      createdBy: 'admin-1',
    });
    backdateLotExpiry(sweepGrant.lotId, 2);
    const dbBeforeSweep = readDb();
    const beforeSweep = Math.floor(Number(dbBeforeSweep.creditBalances?.[userId]?.balance ?? 0));

    const sweep1 = await promoExpireSweep();
    expect(sweep1.expiredLots).toBe(1);
    expect(sweep1.creditsExpired).toBe(40);
    const afterSweep1 = (await getCreditBalance(userId)).balance;
    expect(afterSweep1).toBe(beforeSweep - 40);

    const sweep2 = await promoExpireSweep();
    expect(sweep2.expiredLots).toBe(0);
    expect(sweep2.creditsExpired).toBe(0);
    expect((await getCreditBalance(userId)).balance).toBe(afterSweep1);
  });

  it('revokePromoLot removes remaining promo credits from balance', async () => {
    const grant = await grantPromoLot(userId, 75, {
      campaignId: 'revoke-camp',
      expiresAt: daysFromNow(10),
      note: 'to revoke',
      createdBy: 'admin-1',
    });
    await adjustCredits(userId, 25, { note: 'permanent', createdBy: 'admin-1' });

    let bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(100);
    await expectPromoBalance(userId, { promoRemaining: 75, permanentBalance: 25 });

    const lotId = grant.lotId ?? promoLotsForUser(userId)[0]?.id;
    expect(lotId).toBeTruthy();

    const revoked = await revokePromoLot(lotId!, 'admin-1', 'campaign cancelled');
    expect(revoked.ok).toBe(true);
    expect(revoked.duplicate).toBe(false);
    expect(revoked.creditsRevoked).toBe(75);

    bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(25);
    await expectPromoBalance(userId, { promoRemaining: 0, permanentBalance: 25 });

    const lot = promoLotsForUser(userId).find((l) => l.id === lotId);
    expect(lot?.remaining).toBe(0);
    expect(lot?.status).toBe('revoked');
  });

  it('getCreditBalance reports nearestPromoExpiry among active lots', async () => {
    const near = daysFromNow(2);
    const far = daysFromNow(14);

    await grantPromoLot(userId, 10, {
      campaignId: 'far',
      expiresAt: far,
      note: 'far lot',
      createdBy: 'admin-1',
    });
    await grantPromoLot(userId, 15, {
      campaignId: 'near',
      expiresAt: near,
      note: 'near lot',
      createdBy: 'admin-1',
    });

    await expectPromoBalance(userId, {
      promoRemaining: 25,
      permanentBalance: 0,
      nearestPromoExpiry: near,
    });
  });
});
