#!/usr/bin/env node
/**
 * 一键开发：本机伴侣 + 由伴侣随启 SamLocal（与 COMPANION_SPAWN_SAM_LOCAL_* 一致）。
 * 勿同时再开 `npm run dev:sam-local`，否则端口冲突。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const env = {
  ...process.env,
  COMPANION_SPAWN_SAM_LOCAL_CMD: 'npm run dev:sam-local',
  COMPANION_SPAWN_SAM_LOCAL_CWD: repoRoot,
};

console.log('[companion-sam-stack] 启动 local-companion（将随启 SamLocal）…');
console.log('[companion-sam-stack] COMPANION_SPAWN_SAM_LOCAL_CWD=', repoRoot);

const child = spawn(npmCmd, ['run', 'local-companion:dev'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: isWin,
  env,
});

function shutdown(signal) {
  try {
    child.kill(signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM');
  } catch {
    /* ignore */
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
