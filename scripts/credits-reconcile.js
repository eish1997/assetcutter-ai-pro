import { reconcileAllCredits, reconcileCreditsForUser } from '../server/credit-store.js';

const args = process.argv.slice(2);
const fix = args.includes('--fix');
const userArg = args.find((a) => a.startsWith('--user='));
const userId = userArg ? userArg.slice('--user='.length).trim() : '';

async function main() {
  const result = userId
    ? { users: [await reconcileCreditsForUser(userId, { fix })], issueCount: 0, userCount: 1 }
    : await reconcileAllCredits({ fix });

  if (!userId) {
    result.issueCount = result.users.reduce((sum, row) => sum + row.issues.length, 0);
  } else {
    result.issueCount = result.users[0]?.issues.length ?? 0;
  }

  for (const row of result.users) {
    if (!row.issues.length) {
      console.log(`[credits-reconcile] ok user=${row.userId} balance=${row.balance}`);
      continue;
    }
    console.log(`[credits-reconcile] issues user=${row.userId} (${row.issues.length})`);
    for (const issue of row.issues) {
      console.log(`  - [${issue.code}] ${issue.message}`);
    }
    if (row.fixed) {
      console.log(`  → fixed balance row from ledger aggregate (ledgerBalance=${row.ledgerBalance})`);
    }
  }

  console.log(
    `[credits-reconcile] done users=${result.userCount} issues=${result.issueCount}${fix ? ' (fix applied where possible)' : ''}`
  );

  if (result.issueCount > 0) process.exit(1);
}

main().catch((error) => {
  console.error('[credits-reconcile] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
