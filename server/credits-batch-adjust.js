/**
 * 批量积分调整 — CLI 与管理 API 共用。
 */
import crypto from 'crypto';
import { findUserByLogin } from './auth-store.js';
import { adjustCredits } from './credit-store.js';

export function parseCreditsBatchCsvLine(line) {
  const parts = String(line || '')
    .split(',')
    .map((s) => s.trim());
  if (parts.length < 3) return null;
  const username = parts[0];
  const delta = Math.floor(Number(parts[1]));
  const note = parts.slice(2).join(',').trim();
  if (!username || !Number.isFinite(delta) || delta === 0 || !note) return null;
  return { username, delta, note };
}

export function batchAdjustIdempotencyKey(row) {
  return `batch:${crypto
    .createHash('sha256')
    .update(`${row.username}|${row.delta}|${row.note}`)
    .digest('hex')
    .slice(0, 32)}`;
}

/**
 * @param {Array<{ username: string, delta: number, note: string }>} rows
 * @param {{ dryRun?: boolean, createdBy?: string | null }} opts
 */
export async function runCreditsBatchAdjust(rows, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const createdBy = opts.createdBy ? String(opts.createdBy).trim() : null;
  const results = [];
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const parsed = parseCreditsBatchCsvLine(`${row.username},${row.delta},${row.note}`);
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

    const idempotencyKey = batchAdjustIdempotencyKey(parsed);

    if (dryRun) {
      results.push({
        username: parsed.username,
        userId: user.id,
        delta: parsed.delta,
        note: parsed.note,
        status: 'dry_run',
      });
      ok += 1;
      continue;
    }

    try {
      const result = await adjustCredits(user.id, parsed.delta, {
        note: parsed.note,
        createdBy,
        idempotencyKey,
      });
      results.push({
        username: parsed.username,
        userId: user.id,
        delta: parsed.delta,
        note: parsed.note,
        status: result.duplicate ? 'duplicate' : 'ok',
        balanceAfter: result.balanceAfter,
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
export function parseCreditsBatchCsv(rawCsv) {
  const lines = String(rawCsv || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === 0 && /^username\s*,/i.test(line)) continue;
    const row = parseCreditsBatchCsvLine(line);
    if (row) rows.push(row);
  }
  return rows;
}
