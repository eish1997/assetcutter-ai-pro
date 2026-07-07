import { describe, expect, it } from 'vitest';
import {
  parsePromoGrantCsvLine,
  parsePromoExpiresAt,
  looksLikePromoExpiresAt,
} from '../server/credits-promo-grant.js';

describe('parsePromoGrantCsvLine', () => {
  it('parses +7d relative expiry', () => {
    const row = parsePromoGrantCsvLine('alice,500,signup bonus,+7d,welcome-2026');
    expect(row).toEqual({
      username: 'alice',
      delta: 500,
      note: 'signup bonus',
      expiresAt: expect.any(String),
      campaignId: 'welcome-2026',
    });
    const expMs = new Date(row!.expiresAt).getTime();
    const sevenDaysMs = 7 * 86_400_000;
    expect(expMs).toBeGreaterThan(Date.now());
    expect(expMs).toBeLessThanOrEqual(Date.now() + sevenDaysMs + 2000);
  });

  it('parses ISO expiry and default campaignId', () => {
    const row = parsePromoGrantCsvLine('bob,1200,aug promo,2026-08-01T12:00:00.000Z');
    expect(row?.username).toBe('bob');
    expect(row?.delta).toBe(1200);
    expect(row?.note).toBe('aug promo');
    expect(row?.expiresAt).toBe('2026-08-01T12:00:00.000Z');
    expect(row?.campaignId).toBe('default');
  });

  it('rejects invalid rows', () => {
    expect(parsePromoGrantCsvLine('')).toBeNull();
    expect(parsePromoGrantCsvLine('alice,0,note,+7d')).toBeNull();
    expect(parsePromoGrantCsvLine('alice,100,note,not-a-date')).toBeNull();
    expect(parsePromoGrantCsvLine('alice,100,,+7d')).toBeNull();
  });
});

describe('parsePromoExpiresAt', () => {
  it('accepts +7d and +12h', () => {
    const d7 = parsePromoExpiresAt('+7d');
    const h12 = parsePromoExpiresAt('+12h');
    expect(d7).toBeTruthy();
    expect(h12).toBeTruthy();
    expect(new Date(d7!).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(new Date(h12!).getTime()).toBeLessThanOrEqual(Date.now() + 12 * 3_600_000 + 1000);
  });

  it('looksLikePromoExpiresAt detects relative and ISO', () => {
    expect(looksLikePromoExpiresAt('+7d')).toBe(true);
    expect(looksLikePromoExpiresAt('2026-08-01T00:00:00.000Z')).toBe(true);
    expect(looksLikePromoExpiresAt('nope')).toBe(false);
  });
});
