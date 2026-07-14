/**
 * afterShellExecution: 检测到成功的 `git push` 后自动跑开发日志 post-push。
 * 不挡推送；失败只打 stderr，exit 0（fail-open）。
 * 跳过：SKIP_DEV_LOG=1
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LOCK = path.join(ROOT, '.cache', 'dev-log-post-push.lock');
const LOCK_TTL_MS = 90_000;

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function looksLikeGitPush(command) {
  const c = String(command || '');
  // Plain push, or npm scripts that wrap push — not "git push --dry-run" alone without push intent
  if (/\bgit\s+push\b/i.test(c)) return true;
  if (/\bnpm\s+run\s+push(:|\b)/i.test(c)) return true;
  return false;
}

function pushLooksFailed(output) {
  const o = String(output || '');
  if (!o.trim()) return false;
  if (/\bfatal:/i.test(o)) return true;
  if (/\berror:\s+failed to push/i.test(o)) return true;
  if (/\b! \[rejected\]/i.test(o)) return true;
  if (/\bPermission denied\b/i.test(o)) return true;
  if (/\bCould not resolve host\b/i.test(o)) return true;
  if (/\bAuthentication failed\b/i.test(o)) return true;
  return false;
}

function acquireLock() {
  try {
    fs.mkdirSync(path.dirname(LOCK), { recursive: true });
    if (fs.existsSync(LOCK)) {
      const age = Date.now() - fs.statSync(LOCK).mtimeMs;
      if (age < LOCK_TTL_MS) return false;
    }
    fs.writeFileSync(LOCK, String(Date.now()), 'utf8');
    return true;
  } catch {
    return true;
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK)) fs.unlinkSync(LOCK);
  } catch {
    /* ignore */
  }
}

const raw = await readStdin();
let payload = {};
try {
  payload = JSON.parse(raw || '{}');
} catch {
  payload = {};
}

const command = String(payload.command || '');
const output = String(payload.output || '');

if (String(process.env.SKIP_DEV_LOG || '').trim() === '1') {
  process.exit(0);
}

if (!looksLikeGitPush(command)) {
  process.exit(0);
}

if (pushLooksFailed(output)) {
  console.error('[dev-log-after-push] skip: git push looks failed');
  process.exit(0);
}

if (!acquireLock()) {
  console.error('[dev-log-after-push] skip: lock held (recent run)');
  process.exit(0);
}

try {
  console.error('[dev-log-after-push] running npm run dev-log:post-push …');
  const r = spawnSync('npm', ['run', 'dev-log:post-push'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    env: process.env,
  });
  if (r.stdout) process.stderr.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`[dev-log-after-push] post-push exit ${r.status} (push already done; retry: npm run dev-log:post-push)`);
  } else {
    console.error('[dev-log-after-push] ok');
  }
} catch (e) {
  console.error('[dev-log-after-push] error:', e instanceof Error ? e.message : e);
} finally {
  releaseLock();
}

process.exit(0);
