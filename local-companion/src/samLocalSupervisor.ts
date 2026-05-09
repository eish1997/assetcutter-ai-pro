import { spawn, type ChildProcess } from 'node:child_process';

let samProc: ChildProcess | null = null;
let samLastExitCode: number | null = null;
let samLastSignal: NodeJS.Signals | null = null;
let samLastError: string | null = null;
let samLastUpdatedAt: string | null = null;

/**
 * 若设置 **`COMPANION_SPAWN_SAM_LOCAL_CMD`**，在伴侣 HTTP 启动后 **shell 执行**该命令拉起 SamLocal（如 `npm run dev:sam-local`）。
 * 可选 **`COMPANION_SPAWN_SAM_LOCAL_CWD`** 作为子进程工作目录（例如 monorepo 根，便于 npm 脚本解析）。
 */
export function startSamLocalIfConfigured(): void {
  const cmd = process.env.COMPANION_SPAWN_SAM_LOCAL_CMD?.trim();
  if (!cmd) return;
  if (samProc && samProc.exitCode === null && !samProc.killed) return;

  const cwd = process.env.COMPANION_SPAWN_SAM_LOCAL_CWD?.trim();

  try {
    samProc = spawn(cmd, [], {
      shell: true,
      stdio: 'inherit',
      env: { ...process.env },
      windowsHide: false,
      ...(cwd ? { cwd } : {}),
    });
    samLastError = null;
    samLastUpdatedAt = new Date().toISOString();
  } catch (e) {
    console.error('[local-companion] COMPANION_SPAWN_SAM_LOCAL_CMD 启动失败', e);
    samLastError = e instanceof Error ? e.message : String(e);
    samLastUpdatedAt = new Date().toISOString();
    samProc = null;
    return;
  }

  samProc.on('exit', (code, signal) => {
    console.log(`[local-companion] SamLocal 子进程退出 code=${code} signal=${signal ?? ''}`);
    samLastExitCode = code ?? null;
    samLastSignal = signal ?? null;
    samLastUpdatedAt = new Date().toISOString();
    samProc = null;
  });
  samProc.on('error', (err) => {
    console.error('[local-companion] SamLocal 子进程错误', err);
    samLastError = err instanceof Error ? err.message : String(err);
    samLastUpdatedAt = new Date().toISOString();
    samProc = null;
  });
  console.log(
    `[local-companion] 已按 COMPANION_SPAWN_SAM_LOCAL_CMD 拉起 SamLocal（cwd=${cwd ?? 'inherit'}）`,
  );
}

export type SamLocalSupervisorStatus = {
  configured: boolean;
  running: boolean;
  pid?: number;
  cwd?: string;
  lastExitCode: number | null;
  lastSignal: NodeJS.Signals | null;
  lastError: string | null;
  lastUpdatedAt: string | null;
};

export function getSamLocalSupervisorStatus(): SamLocalSupervisorStatus {
  const configured = Boolean(process.env.COMPANION_SPAWN_SAM_LOCAL_CMD?.trim());
  const running = samProc != null && samProc.exitCode === null && !samProc.killed;
  const cwd = process.env.COMPANION_SPAWN_SAM_LOCAL_CWD?.trim();
  return {
    configured,
    running,
    pid: running && samProc?.pid != null ? samProc.pid : undefined,
    ...(cwd ? { cwd } : {}),
    lastExitCode: samLastExitCode,
    lastSignal: samLastSignal,
    lastError: samLastError,
    lastUpdatedAt: samLastUpdatedAt,
  };
}

export function stopSamLocalChild(): void {
  if (samProc && !samProc.killed) {
    try {
      samProc.kill('SIGTERM');
    } catch {
      /* 忽略 */
    }
    samProc = null;
  }
}
