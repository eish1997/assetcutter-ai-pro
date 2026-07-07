/**
 * 促销积分（限时 lot）批量/单笔发放 — CLI 与管理 API 共用。
 */
import crypto from 'crypto';
import { findUserByLogin } from './auth-store.js';
import { grantPromoLot } from './credit-store.js';

/** @param {string} raw */
export function parsePromoExpiresAt(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  const rel = /^\+(\d+(?:\.\d+)?)([dh])$/i.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    const unit = rel[2].toLowerCase();
    const ms = unit === 'd' ? n * 24 * 60 * 60 * 1000 : n * 60 * 60 * 1000;
    return new Date(Date.now() + ms).toISOString();
  }

  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

/** @param {string} s */
export function looksLikePromoExpiresAt(s) {
  const v = String(s || '').trim();
  if (!v) return false;
  if (/^\+(\d+(?:\.\d+)?)[dh]$/i.test(v)) return true;
  return Number.isFinite(Date.parse(v));
}

/** @param {string} line */
export function parsePromoGrantCsvLine(line) {
  const parts = String(line || '')
    .split(',')
    .map((s) => s.trim());
  if (parts.length < 4) return null;

  const username = parts[0];
  const delta = Math.floor(Number(parts[1]));
  const note = parts[2];
  const expiresAtRaw = parts[3];
  const campaignId = (parts[4] || 'default').trim() || 'default';

  if (!username || !Number.isFinite(delta) || delta <= 0 || !note) return null;

  const expiresAt = parsePromoExpiresAt(expiresAtRaw);
  if (!expiresAt) return null;

  return { username, delta, note, expiresAt, campaignId };
}

/** @param {{ username: string, delta: number, note: string, expiresAt: string, campaignId: string }} row */
export function promoGrantIdempotencyKey(row) {
  return `promo-batch:${crypto
    .createHash('sha256')
    .update(`${row.username}|${row.delta}|${row.note}|${row.expiresAt}|${row.campaignId}`)
    .digest('hex')
    .slice(0, 32)}`;
}

/**
 * @param {string} userId
 * @param {number} amount
 * @param {{ campaignId?: string, expiresAt: string, note: string, createdBy?: string | null, idempotencyKey?: string | null }} opts
 */
export async function grantPromoToUser(userId, amount, opts = {}) {
  const uid = String(userId || '').trim();
  const amt = Math.floor(Number(amount));
  const note = String(opts.note || '').trim();
  const createdBy = opts.createdBy ? String(opts.createdBy).trim() : null;
  const idempotencyKey = opts.idempotencyKey ? String(opts.idempotencyKey).trim().slice(0, 200) : null;
  const campaignId = String(opts.campaignId || 'default').trim() || 'default';
  const expiresAt = parsePromoExpiresAt(opts.expiresAt);

  if (!uid) throw new Error('无效用户');
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('发放量须为正整数');
  if (!note || note.length > 500) throw new Error('备注必填且不超过 500 字');
  if (!expiresAt) throw new Error('expiresAt 无效（支持 ISO 或 +Nd/+Nh）');

  return grantPromoLot(uid, amt, {
    campaignId,
    expiresAt,
    note,
    createdBy,
    idempotencyKey,
  });
}

/**
 * @param {Array<{ username: string, delta: number, note: string, expiresAt: string, campaignId?: string }>} rows
 * @param {{ dryRun?: boolean, createdBy?: string | null }} opts
 */
export async function runPromoGrantBatch(rows, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const createdBy = opts.createdBy ? String(opts.createdBy).trim() : null;
  const results = [];
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const parsed = parsePromoGrantCsvLine(
      `${row.username},${row.delta},${row.note},${row.expiresAt}${row.campaignId ? `,${row.campaignId}` : ''}`
    );
    if (!parsed) {
      results.push({ username: row.username, status: 'skipped', error: 'invalid row' });
      skipped += 1;
      continue;
    }

    const user = await findUserByLogin(parsed.username);
    if (!user) {
      results.push({ username: parsed.username, status: 'failed', error: 'user not found' });
      failed += 1;
      continue;
    }

    const idempotencyKey = promoGrantIdempotencyKey(parsed);

    if (dryRun) {
      results.push({
        username: parsed.username,
        userId: user.id,
        delta: parsed.delta,
        note: parsed.note,
        expiresAt: parsed.expiresAt,
        campaignId: parsed.campaignId,
        status: 'dry_run',
      });
      ok += 1;
      continue;
    }

    try {
      const result = await grantPromoToUser(user.id, parsed.delta, {
        note: parsed.note,
        expiresAt: parsed.expiresAt,
        campaignId: parsed.campaignId,
        createdBy,
        idempotencyKey,
      });
      results.push({
        username: parsed.username,
        userId: user.id,
        delta: parsed.delta,
        note: parsed.note,
        expiresAt: parsed.expiresAt,
        campaignId: parsed.campaignId,
        status: result.duplicate ? 'duplicate' : 'ok',
        balanceAfter: result.balanceAfter,
        lotId: result.lotId,
        ledgerId: result.ledgerId,
      });
      ok += 1;
    } catch (e) {
      results.push({
        username: parsed.username,
        userId: user.id,
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      });
      failed += 1;
    }
  }

  return { successCount: ok, skipped, failed, results };
}

/** @param {string} rawCsv */
export function parsePromoGrantCsv(rawCsv) {
  const lines = String(rawCsv || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === 0 && /^username\s*,/i.test(line)) continue;
    const row = parsePromoGrantCsvLine(line);
    if (row) rows.push(row);
  }
  return rows;
}
