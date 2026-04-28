import { spawn, type ChildProcess } from 'node:child_process';

let relayProc: ChildProcess | null = null;
let relayLastExitCode: number | null = null;
let relayLastSignal: NodeJS.Signals | null = null;
let relayLastError: string | null = null;
let relayLastUpdatedAt: string | null = null;

/**
 * 若设置 `COMPANION_RELAY_CMD`，在宿主启动后 **shell 执行**该命令拉起 Relay（如 `local-bridge`）。
 * 为避免与宿主同占 `18765`，子进程环境默认写入 **`COMPANION_HTTP_PORT=0`** 关闭子进程自带伴侣 HTTP（仅 WS 等）；
 * 若需子进程仍开 HTTP，设 **`COMPANION_RELAY_CHILD_HTTP_PORT=18766`** 或 **`keep`** 沿用当前环境变量。
 */
export function startRelayIfConfigured(): void {
  const cmd = process.env.COMPANION_RELAY_CMD?.trim();
  if (!cmd) return;
  if (relayProc && relayProc.exitCode === null && !relayProc.killed) return;

  const childEnv = { ...process.env } as NodeJS.ProcessEnv;
  const childPort = process.env.COMPANION_RELAY_CHILD_HTTP_PORT?.trim();
  if (childPort === 'keep') {
    /* 不改子进程 COMPANION_HTTP_PORT */
  } else {
    childEnv.COMPANION_HTTP_PORT = childPort || '0';
  }

  try {
    relayProc = spawn(cmd, [], {
      shell: true,
      stdio: 'inherit',
      env: childEnv,
      windowsHide: false,
    });
    relayLastError = null;
    relayLastUpdatedAt = new Date().toISOString();
  } catch (e) {
    console.error('[local-companion] COMPANION_RELAY_CMD 启动失败', e);
    relayLastError = e instanceof Error ? e.message : String(e);
    relayLastUpdatedAt = new Date().toISOString();
    relayProc = null;
    return;
  }

  relayProc.on('exit', (code, signal) => {
    console.log(`[local-companion] Relay 子进程退出 code=${code} signal=${signal ?? ''}`);
    relayLastExitCode = code ?? null;
    relayLastSignal = signal ?? null;
    relayLastUpdatedAt = new Date().toISOString();
    relayProc = null;
  });
  relayProc.on('error', (err) => {
    console.error('[local-companion] Relay 子进程错误', err);
    relayLastError = err instanceof Error ? err.message : String(err);
    relayLastUpdatedAt = new Date().toISOString();
    relayProc = null;
  });
  console.log(`[local-companion] 已按 COMPANION_RELAY_CMD 拉起 Relay 子进程（子 COMPANION_HTTP_PORT=${childEnv.COMPANION_HTTP_PORT ?? 'unchanged'}）`);
}

export type RelaySupervisorStatus = {
  configured: boolean;
  running: boolean;
  pid?: number;
  childHttpPortPolicy: string;
  lastExitCode: number | null;
  lastSignal: NodeJS.Signals | null;
  lastError: string | null;
  lastUpdatedAt: string | null;
};

export function getRelaySupervisorStatus(): RelaySupervisorStatus {
  const configured = Boolean(process.env.COMPANION_RELAY_CMD?.trim());
  const running = relayProc != null && relayProc.exitCode === null && !relayProc.killed;
  const childPort = process.env.COMPANION_RELAY_CHILD_HTTP_PORT?.trim();
  const childHttpPortPolicy = childPort === 'keep' ? 'keep' : childPort || '0';
  return {
    configured,
    running,
    pid: running && relayProc?.pid != null ? relayProc.pid : undefined,
    childHttpPortPolicy,
    lastExitCode: relayLastExitCode,
    lastSignal: relayLastSignal,
    lastError: relayLastError,
    lastUpdatedAt: relayLastUpdatedAt,
  };
}

export function stopRelayChild(): void {
  if (relayProc && !relayProc.killed) {
    try {
      relayProc.kill('SIGTERM');
    } catch {
      /* 忽略 */
    }
    relayProc = null;
  }
}
