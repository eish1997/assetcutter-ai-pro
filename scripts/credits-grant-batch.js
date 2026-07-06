import fs from 'fs';
import crypto from 'crypto';
import { findUserByLogin } from '../server/auth-store.js';
import { adjustCredits } from '../server/credit-store.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const filePath = args.find((a) => !a.startsWith('--'));

if (!filePath) {
  console.error('用法: node scripts/credits-grant-batch.js <credits-grant.csv> [--dry-run]');
  console.error('CSV 列: username,delta,note');
  process.exit(1);
}

function parseCsvLine(line) {
  const parts = line.split(',').map((s) => s.trim());
  if (parts.length < 3) return null;
  const username = parts[0];
  const delta = Math.floor(Number(parts[1]));
  const note = parts.slice(2).join(',').trim();
  if (!username || !Number.isFinite(delta) || delta === 0 || !note) return null;
  return { username, delta, note };
}

async function main() {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === 0 && /^username\s*,/i.test(line)) continue;

    const row = parseCsvLine(line);
    if (!row) {
      console.warn(`[credits-grant-batch] skip invalid line ${i + 1}: ${line}`);
      skipped += 1;
      continue;
    }

    const user = await findUserByLogin(row.username);
    if (!user) {
      console.warn(`[credits-grant-batch] user not found: ${row.username}`);
      failed += 1;
      continue;
    }

    const idempotencyKey = `batch:${crypto
      .createHash('sha256')
      .update(`${row.username}|${row.delta}|${row.note}`)
      .digest('hex')
      .slice(0, 32)}`;

    if (dryRun) {
      console.log(`[dry-run] ${row.username} (${user.id}) ${row.delta > 0 ? '+' : ''}${row.delta} — ${row.note}`);
      ok += 1;
      continue;
    }

    try {
      const result = await adjustCredits(user.id, row.delta, {
        note: row.note,
        createdBy: 'batch-script',
        idempotencyKey,
      });
      console.log(
        `[credits-grant-batch] ${row.username} delta=${row.delta} balanceAfter=${result.balanceAfter}${
          result.duplicate ? ' (duplicate)' : ''
        }`
      );
      ok += 1;
    } catch (e) {
      console.warn(
        `[credits-grant-batch] failed ${row.username}: ${e instanceof Error ? e.message : String(e)}`
      );
      failed += 1;
    }
  }

  console.log(`[credits-grant-batch] done ok=${ok} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('[credits-grant-batch] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
