import { upsertAdminUser } from '../server/auth-store.js';

const email = String(process.env.AUTH_ADMIN_EMAIL || '').trim().toLowerCase();
const username = String(process.env.AUTH_ADMIN_USERNAME || '').trim().toLowerCase();
const password = String(process.env.AUTH_ADMIN_PASSWORD || '');

if (!email || !password) {
  console.error('缺少 AUTH_ADMIN_EMAIL 或 AUTH_ADMIN_PASSWORD');
  process.exit(1);
}

async function main() {
  if (username) process.env.AUTH_ADMIN_USERNAME = username;
  const user = await upsertAdminUser({ email, password });
  console.log(`[seed-admin] ok: ${user.username}/${user.email} (${user.role})`);
}

main().catch((error) => {
  console.error('[seed-admin] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

