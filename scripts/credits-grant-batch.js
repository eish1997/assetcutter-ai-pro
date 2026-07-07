import fs from 'fs';
import { runCreditsBatchAdjust, parseCreditsBatchCsv } from '../server/credits-batch-adjust.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const filePath = args.find((a) => !a.startsWith('--'));

if (!filePath) {
  console.error('用法: node scripts/credits-grant-batch.js <credits-grant.csv> [--dry-run]');
  console.error('CSV 列: username,delta,note');
  process.exit(1);
}

async function main() {
  const raw = fs.readFileSync(filePath, 'utf8');
  const rows = parseCreditsBatchCsv(raw);
  const result = await runCreditsBatchAdjust(rows, { dryRun, createdBy: 'batch-script' });

  for (const row of result.results) {
    if (row.status === 'dry_run') {
      console.log(`[dry-run] ${row.username} (${row.userId}) ${row.delta > 0 ? '+' : ''}${row.delta} — ${row.note}`);
    } else if (row.status === 'ok' || row.status === 'duplicate') {
      console.log(
        `[credits-grant-batch] ${row.username} delta=${row.delta} balanceAfter=${row.balanceAfter}${
          row.status === 'duplicate' ? ' (duplicate)' : ''
        }`
      );
    } else {
      console.warn(`[credits-grant-batch] ${row.username}: ${row.error || row.status}`);
    }
  }

  console.log(
    `[credits-grant-batch] done ok=${result.successCount} skipped=${result.skipped} failed=${result.failed}`
  );
  if (result.failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('[credits-grant-batch] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
