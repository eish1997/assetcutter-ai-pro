import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  adjustCredits,
  getCreditBalance,
  precheckCredits,
  reserveCredits,
  releaseCreditReserve,
  validateActiveCreditReserve,
} from '../server/credit-store.js';
import {
  signCreditsGatePayload,
  verifyCreditsGateSignature,
  signFairnessKeyHeader,
  verifyFairnessKeySignature,
} from '../server/credits-gate-hmac.js';
import { resolveAuthDbFileForTests } from './helpers/authDbTestPath.js';

const DB_FILE = resolveAuthDbFileForTests();

function resetCreditJson() {
  delete process.env.DATABASE_URL;
  process.env.CREDITS_BILLING_ENABLED = 'true';
  if (fs.existsSync(DB_FILE)) {
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
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  }
}

describe('credit reserve', () => {
  const userId = 'test-reserve-user';

  beforeEach(() => {
    resetCreditJson();
  });

  it('reduces available balance while reserved', async () => {
    await adjustCredits(userId, 100, { note: 'seed', createdBy: 'admin' });
    await reserveCredits(userId, 40, { idempotencyKey: 'r1' });
    const bal = await getCreditBalance(userId);
    expect(bal.balance).toBe(100);
    expect(bal.reserved).toBe(40);
    expect(bal.available).toBe(60);
    const check = await precheckCredits(userId, 70);
    expect(check.ok).toBe(false);
    expect(check.available).toBe(60);
  });

  it('blocks second reserve when available insufficient', async () => {
    await adjustCredits(userId, 50, { note: 'seed', createdBy: 'admin' });
    await reserveCredits(userId, 40, { idempotencyKey: 'r-a' });
    await expect(reserveCredits(userId, 20, { idempotencyKey: 'r-b' })).rejects.toThrow(/积分不足|CREDITS_EXCEEDED/i);
  });

  it('validates and releases reserve', async () => {
    await adjustCredits(userId, 200, { note: 'seed', createdBy: 'admin' });
    const r = await reserveCredits(userId, 30, { idempotencyKey: 'gate:test' });
    const valid = await validateActiveCreditReserve(userId, r.reserveKey, 30);
    expect(valid.ok).toBe(true);
    await releaseCreditReserve(userId, r.reserveKey);
    const bal = await getCreditBalance(userId);
    expect(bal.reserved).toBe(0);
    expect(bal.available).toBe(200);
  });

  it('idempotent reserve returns duplicate', async () => {
    await adjustCredits(userId, 100, { note: 'seed', createdBy: 'admin' });
    const a = await reserveCredits(userId, 10, { idempotencyKey: 'same-key' });
    const b = await reserveCredits(userId, 10, { idempotencyKey: 'same-key' });
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    const bal = await getCreditBalance(userId);
    expect(bal.reserved).toBe(10);
  });

  it('rejects idempotent reserve with mismatched amount', async () => {
    await adjustCredits(userId, 100, { note: 'seed', createdBy: 'admin' });
    await reserveCredits(userId, 10, { idempotencyKey: 'mismatch-key' });
    await expect(reserveCredits(userId, 20, { idempotencyKey: 'mismatch-key' })).rejects.toThrow(/幂等键冲突/);
  });
});

describe('credits-gate-hmac', () => {
  const prevSecret = process.env.GEMINI_PROXY_CREDITS_HMAC_SECRET;

  beforeEach(() => {
    process.env.GEMINI_PROXY_CREDITS_HMAC_SECRET = 'test-hmac-secret-for-credits';
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.GEMINI_PROXY_CREDITS_HMAC_SECRET;
    else process.env.GEMINI_PROXY_CREDITS_HMAC_SECRET = prevSecret;
  });

  it('signs and verifies credits gate payload', () => {
    const reserveKey = `proxy:${crypto.randomUUID()}`;
    const signed = signCreditsGatePayload({ userId: 'u1', estimatedCredits: 50, reserveKey });
    expect(signed?.fairnessKey).toBe('user:u1');
    expect(signed?.creditsGateSignature).toMatch(/^\d+\.[a-f0-9]+$/);
    const ok = verifyCreditsGateSignature({
      userId: 'u1',
      estimatedCredits: 50,
      reserveKey,
      sigHeader: signed!.creditsGateSignature,
    });
    expect(ok.ok).toBe(true);
  });

  it('accepts step estimate when signed envelope estimate is larger', () => {
    const reserveKey = `proxy:${crypto.randomUUID()}`;
    const signed = signCreditsGatePayload({ userId: 'u1', estimatedCredits: 149, reserveKey });
    const ok = verifyCreditsGateSignature({
      userId: 'u1',
      estimatedCredits: 15,
      signedEstimatedCredits: 149,
      reserveKey,
      sigHeader: signed!.creditsGateSignature,
    });
    expect(ok.ok).toBe(true);
    const tooHigh = verifyCreditsGateSignature({
      userId: 'u1',
      estimatedCredits: 200,
      signedEstimatedCredits: 149,
      reserveKey,
      sigHeader: signed!.creditsGateSignature,
    });
    expect(tooHigh.ok).toBe(false);
  });

  it('rejects tampered reserve key', () => {
    const signed = signCreditsGatePayload({
      userId: 'u1',
      estimatedCredits: 50,
      reserveKey: 'proxy:abc',
    });
    const bad = verifyCreditsGateSignature({
      userId: 'u1',
      estimatedCredits: 50,
      reserveKey: 'proxy:xyz',
      sigHeader: signed!.creditsGateSignature,
    });
    expect(bad.ok).toBe(false);
  });

  it('signs fairness key header', () => {
    const sig = signFairnessKeyHeader('user:abc');
    expect(sig).toBeTruthy();
    const v = verifyFairnessKeySignature('user:abc', sig!);
    expect(v.ok).toBe(true);
  });
});
