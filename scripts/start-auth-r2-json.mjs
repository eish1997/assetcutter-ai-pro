/**
 * 本地开发：加载 .env.local 的 R2 等变量，但跳过 DATABASE_URL，使用 auth-db.json + 9100。
 * 用于 Docker/PG 未启动时仍能拉能力商店 catalog。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env.local');
const env = { ...process.env, PORT: '9100' };

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    if (key === 'DATABASE_URL' || key === 'AUTH_PORT' || key === 'PORT') continue;
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
}

delete env.DATABASE_URL;
delete env.AUTH_PORT;
env.PORT = '9100';

const child = spawn('node', ['server/auth-api.js'], {
  cwd: root,
  env,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
